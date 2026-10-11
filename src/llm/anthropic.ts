// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/provider.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: streaming SSE, strict tools, retries, timeouts, abort.

/**
 * The Anthropic provider: one streamed assistant turn per call, over raw
 * fetch (the SDK pulls Node modules into a browser bundle).
 *
 * Anthropic blocks direct browser calls unless the request opts in, so we
 * send `anthropic-dangerous-direct-browser-access`. That is the documented
 * way to call the API from a page, and it is what keeps bring-your-own-key
 * working now that the skin is a web page. The key is read from the secret
 * store, put on this one request header, and never logged or echoed.
 *
 * Chromium 91 constraints shape the code: the body is read with
 * `getReader()` (no async iteration of streams), timeouts use AbortController
 * + setTimeout (no `AbortSignal.timeout`) and the caller's signal is merged by
 * hand (no `AbortSignal.any`).
 */
import { createTurnAssembler } from './assemble.ts';
import {
  abortedError,
  errorFromHttp,
  networkError,
  noApiKeyError,
  parseRetryAfter,
  streamDroppedError,
  timeoutError,
  unreadableReplyError,
} from './errors.ts';
import { modelInfo, supportsRefusalFallbacks } from './models.ts';
import { createSseParser, type SseEvent } from './sse.ts';
import { LlmError, type Effort, type LlmProvider, type LlmRequest, type LlmStreamEvent, type ToolDefinition } from './types.ts';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MAX_TOKENS = 16000;
export const DEFAULT_EFFORT: Effort = 'medium';
const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_FIRST_BYTE_MS = 60_000;
const DEFAULT_IDLE_MS = 90_000;
const DEFAULT_RETRY_BASE_MS = 1000;
const MAX_RETRY_AFTER_MS = 60_000;

/** Events we act on: unreadable data in one of them means a broken stream, not a new feature. */
const KNOWN_EVENTS: readonly string[] = [
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'error',
];

export interface AnthropicProviderOptions {
  /** Read at every call, so a key saved in Settings applies at once. */
  getApiKey: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeouts?: {
    /** From sending the request to the first byte of the body. Default 60 s. */
    firstByteMs?: number;
    /** Between two chunks of the body. Default 90 s. */
    idleMs?: number;
  };
  /** Retries before anything has streamed. Default 2. */
  maxRetries?: number;
  /** First retry delay, doubled each retry; `retry-after` wins when sent. Default 1000 ms. */
  retryBaseMs?: number;
}

export interface AnthropicHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function anthropicEndpoint(baseUrl: string = ANTHROPIC_BASE_URL): string {
  const base = baseUrl.trim().replace(/\/+$/, '') || ANTHROPIC_BASE_URL;
  return `${base}/v1/messages`;
}

function toWireTool(tool: ToolDefinition) {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema, strict: true };
}

/** Build the HTTP request for one streamed turn. Pure. */
export function buildAnthropicRequest(request: LlmRequest, apiKey: string, baseUrl?: string): AnthropicHttpRequest {
  const model = request.model.trim();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    // Without this, the browser request is rejected before it is even sent.
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  // No `thinking` (Opus 5.5 always thinks; the others default to adaptive) and
  // no sampling settings (current models reject them).
  const body: Record<string, unknown> = { model, max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS };
  if (request.system !== '') body.system = request.system;
  // Replayed verbatim: assistant turns are stored exactly as received.
  body.messages = request.messages;
  if (request.tools.length > 0) {
    body.tools = request.tools.map(toWireTool);
    // Opus 5.5 rejects forced tool use; strict schemas keep the inputs valid.
    body.tool_choice = { type: 'auto' };
  }
  body.stream = true;
  // Caches the stable prefix (tools, system, earlier turns) up to the last block.
  if (request.cache !== false) body.cache_control = { type: 'ephemeral' };
  if (modelInfo(model).supportsEffort) body.output_config = { effort: request.effort ?? DEFAULT_EFFORT };
  if (supportsRefusalFallbacks(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = REFUSAL_FALLBACK_BETA;
  }

  return { url: anthropicEndpoint(baseUrl), headers, body: JSON.stringify(body) };
}

/** Delay before retry number `attempt + 1`: 1 s, 2 s... or what `retry-after` asked for. */
export function backoffMs(attempt: number, baseMs: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  return baseMs * 2 ** attempt;
}

/** Settle with `promise`, or reject as soon as `signal` aborts (whatever the fetch implementation does). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => undefined);
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseEventData(event: SseEvent): unknown {
  try {
    return JSON.parse(event.data);
  } catch {
    if (KNOWN_EVENTS.includes(event.event)) throw unreadableReplyError();
    return null;
  }
}

/** Belt and braces: whatever a server echoed back, the key never reaches the UI. */
function scrubKey(error: LlmError, apiKey: string): LlmError {
  if (!error.message.includes(apiKey)) return error;
  return new LlmError(error.kind, error.message.split(apiKey).join('[key]'), error.status, error.retryable);
}

interface AttemptState {
  yielded: boolean;
  retryAfterMs: number | null;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const firstByteMs = options.timeouts?.firstByteMs ?? DEFAULT_FIRST_BYTE_MS;
  const idleMs = options.timeouts?.idleMs ?? DEFAULT_IDLE_MS;
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  // Resolved per call: test servers and service workers may swap fetch after startup.
  const doFetch = (url: string, init: RequestInit) =>
    options.fetch ? options.fetch(url, init) : globalThis.fetch(url, init);

  async function* attempt(
    http: AnthropicHttpRequest,
    callerSignal: AbortSignal | undefined,
    state: AttemptState,
  ): AsyncGenerator<LlmStreamEvent> {
    const controller = new AbortController();
    let timedOut: 'first_byte' | 'idle' | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (phase: 'first_byte' | 'idle', ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = phase;
        controller.abort();
      }, ms);
    };
    const disarm = () => clearTimeout(timer);
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      arm('first_byte', firstByteMs);
      let response: Response;
      try {
        response = await raceAbort(
          doFetch(http.url, { method: 'POST', headers: http.headers, body: http.body, signal: controller.signal }),
          controller.signal,
        );
      } catch (cause) {
        // In a browser a CORS rejection looks the same as being offline.
        throw controller.signal.aborted ? cause : networkError();
      }

      if (!response.ok) {
        state.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        let text = '';
        try {
          text = await raceAbort(response.text(), controller.signal);
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
        }
        throw errorFromHttp(response.status, text);
      }
      if (!(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
        throw unreadableReplyError();
      }

      reader = response.body.getReader();
      const parser = createSseParser();
      const assembler = createTurnAssembler();
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await raceAbort(reader.read(), controller.signal);
        } catch (cause) {
          throw controller.signal.aborted ? cause : streamDroppedError();
        }
        // The idle clock measures the network, not how long the caller takes per event.
        disarm();
        const sseEvents = chunk.done ? parser.end() : parser.push(chunk.value);
        for (const sse of sseEvents) {
          for (const event of assembler.push(parseEventData(sse))) {
            // One chunk can hold the rest of the reply: honour an abort between events.
            if (controller.signal.aborted) throw new Error('aborted');
            state.yielded = true;
            yield event;
          }
          if (assembler.finished) return;
        }
        if (chunk.done) throw streamDroppedError();
        arm('idle', idleMs);
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        if (callerSignal?.aborted) throw abortedError();
        if (timedOut !== null) throw timeoutError(timedOut);
      }
      throw cause;
    } finally {
      disarm();
      callerSignal?.removeEventListener('abort', onCallerAbort);
      reader?.cancel().catch(() => undefined);
    }
  }

  async function* streamTurn(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const signal = request.signal;
    if (signal?.aborted) throw abortedError();
    const apiKey = ((await options.getApiKey()) ?? '').trim();
    if (apiKey === '') throw noApiKeyError();
    const http = buildAnthropicRequest(request, apiKey, options.baseUrl);

    for (let retry = 0; ; retry++) {
      const state: AttemptState = { yielded: false, retryAfterMs: null };
      try {
        yield* attempt(http, signal, state);
        return;
      } catch (cause) {
        if (!(cause instanceof LlmError)) throw cause;
        const error = scrubKey(cause, apiKey);
        // Never retry once the caller has seen part of a turn: it would show twice.
        if (state.yielded || !error.retryable || retry >= maxRetries || signal?.aborted) throw error;
        await sleep(backoffMs(retry, retryBaseMs, state.retryAfterMs), signal);
      }
    }
  }

  return {
    id: 'anthropic',
    stream: (request) => streamTurn(request),
  };
}

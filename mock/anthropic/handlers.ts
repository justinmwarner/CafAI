/**
 * MSW handlers for the Anthropic Messages API, backed by the scripted fake
 * coach. Replies stream as `text/event-stream` with small delays between
 * events so the chat UI streams the way it will against the real API.
 *
 *   setupServer(...decaidHandlers, ...anthropicHandlers({ speed: Infinity }))  // Vitest
 *   startMockWorker({ extraHandlers: anthropicHandlers({ speed }) })           // dev / Playwright
 *
 * The demo (D76) asks for the real coach's pace and voice: a longer first
 * delay, jittered gaps, sentence pauses and `voice: 'demo'`. The defaults are
 * the test script's timing and strings, which the e2e specs rely on.
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { chunkEvents, streamDelays } from './pacing.ts';
import { createScenarioMemory, resetScenarioMemory, respond, type ScenarioMemory } from './scenario.ts';
import type { SseMessage } from './sse.ts';

export const ANTHROPIC_API_ORIGIN = 'https://api.anthropic.com';

export interface AnthropicMockOptions {
  /** Playback speed: 2 is twice as fast; Infinity (or 0) plays with no delays. Default 1. */
  speed?: number;
  /** Wait before the first event at speed 1 (time to first token). Default 400 ms. */
  firstEventDelayMs?: number;
  /** Wait between events at speed 1. Default 25 ms. */
  eventDelayMs?: number;
  /** Each gap between SSE events varies by up to ± this many ms (default 0). Deterministic. */
  jitterMs?: number;
  /** Extra pause after a text_delta whose text ends a sentence (., ?, ! or :, then optional closing quote/bracket and whitespace). Default 0. */
  sentencePauseMs?: number;
  /** 'terse' (default): today's strings. 'demo': fuller coaching prose; same decisions. */
  voice?: 'terse' | 'demo';
  /** Cut the byte stream into chunks of this many bytes, ignoring event boundaries. */
  chunkBytes?: number;
  /** Conversation memory; defaults to the shared one that resetAnthropicMock() clears. */
  memory?: ScenarioMemory;
  /** Default https://api.anthropic.com. */
  baseUrl?: string;
}

const sharedMemory = createScenarioMemory();

/** Forget every assistant turn the fake produced (between tests). */
export function resetAnthropicMock(): void {
  resetScenarioMemory(sharedMemory);
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'retry-after, request-id',
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `seed` drives the jitter: the same seed, the same gaps. */
function eventStream(events: SseMessage[], options: AnthropicMockOptions, seed: number): ReadableStream<Uint8Array> {
  const chunks = chunkEvents(events, options.chunkBytes);
  // One wait before each chunk, then one before the stream closes.
  const delays = streamDelays(chunks, options, seed);

  let next = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const ms = delays[next] ?? 0;
      if (ms > 0) await wait(ms);
      if (cancelled) return;
      const chunk = chunks[next];
      next += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk.bytes);
    },
    cancel() {
      cancelled = true;
    },
  });
}

export function anthropicHandlers(options: AnthropicMockOptions = {}): HttpHandler[] {
  const url = `${(options.baseUrl ?? ANTHROPIC_API_ORIGIN).replace(/\/+$/, '')}/v1/messages`;
  const memory = options.memory ?? sharedMemory;

  return [
    http.options(url, () => new HttpResponse(null, { status: 204, headers: CORS_HEADERS })),
    http.post(url, async ({ request }) => {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
      const result = respond(body, request.headers, memory, { voice: options.voice });
      if ('errorBody' in result) {
        return HttpResponse.json(result.errorBody, { status: result.status, headers: CORS_HEADERS });
      }
      // Seeded from the request count, so a replayed conversation (a reload of the demo) keeps its rhythm.
      return new HttpResponse(eventStream(result.events, options, result.turn), {
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }),
  ];
}

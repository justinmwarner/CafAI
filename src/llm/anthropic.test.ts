// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest + MSW; streaming SSE, tools, retries, timeouts, abort.
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anthropicHandlers, resetAnthropicMock } from '../../mock/anthropic/handlers.ts';
import { sseFrame } from '../../mock/anthropic/sse.ts';
import { TOOL_INPUTS } from '../coach/contract.ts';
import { trafficLog } from '../traffic/recorder.ts';
import { KEY_MARKER } from '../traffic/redact.ts';
import {
  anthropicEndpoint,
  backoffMs,
  buildAnthropicRequest,
  createAnthropicProvider,
  type AnthropicProviderOptions,
} from './anthropic.ts';
import { computerWording } from './errors.ts';
import { toToolDefinition } from './schema.ts';
import {
  LlmError,
  type ContentBlock,
  type LlmAssistantTurn,
  type LlmMessage,
  type LlmRequest,
  type LlmStreamEvent,
  type ToolUseBlock,
} from './types.ts';

const URL = 'https://api.anthropic.com/v1/messages';
const KEY = 'sk-ant-test-key-0123456789';

const server = setupServer(...anthropicHandlers({ speed: Infinity }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAnthropicMock();
});
afterAll(() => server.close());

const TOOLS = Object.entries(TOOL_INPUTS).map(([name, schema]) => toToolDefinition(name, `The ${name} tool.`, schema));

const INTAKE: LlmMessage = {
  role: 'user',
  content: [
    { type: 'text', text: 'Kiambu AA, light roast, washed' },
    { type: 'text', text: '[context]\n{"grinder":{"name":null,"setting":null},"scaleConnected":true}' },
  ],
};

function request(over: Partial<LlmRequest> = {}): LlmRequest {
  return { model: 'claude-opus-5-5', system: 'You are an espresso coach.', messages: [INTAKE], tools: TOOLS, ...over };
}

function provider(over: Partial<AnthropicProviderOptions> = {}) {
  return createAnthropicProvider({ getApiKey: () => Promise.resolve(KEY), retryBaseMs: 1, ...over });
}

async function collect(events: AsyncIterable<LlmStreamEvent>, seen: LlmStreamEvent[] = []): Promise<LlmStreamEvent[]> {
  for await (const event of events) seen.push(event);
  return seen;
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('expected the stream to fail');
}

function doneTurn(events: LlmStreamEvent[]): LlmAssistantTurn {
  const last = events.at(-1);
  if (last?.type !== 'message_done') throw new Error('the stream did not end with message_done');
  expect(events.filter((e) => e.type === 'message_done')).toHaveLength(1);
  return last.turn;
}

/** Counts requests and lets them fall through to the scripted fake (or answers the first N itself). */
function countRequests(answer?: (call: number) => Response | undefined) {
  const counter = { calls: 0 };
  server.use(
    http.post(URL, () => {
      counter.calls += 1;
      return answer?.(counter.calls);
    }),
  );
  return counter;
}

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });
const sse = (...events: Array<Record<string, unknown>>) =>
  new HttpResponse(events.map((data) => sseFrame({ event: String(data.type), data })).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
const MESSAGE_START = {
  type: 'message_start',
  message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 9, output_tokens: 1 } },
};

// ---- request shape ----------------------------------------------------------

describe('buildAnthropicRequest', () => {
  it('posts to the Messages endpoint with the key, the version and the browser opt-in header', () => {
    const http = buildAnthropicRequest(request(), KEY);
    expect(http.url).toBe('https://api.anthropic.com/v1/messages');
    expect(http.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      // Without this the browser call is refused before it is sent.
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(http.headers['authorization']).toBeUndefined();
  });

  it('builds a streaming body with strict tools, auto tool choice, caching and medium effort', () => {
    const body = JSON.parse(buildAnthropicRequest(request(), KEY).body);
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: 'You are an espresso coach.',
      messages: [INTAKE],
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, strict: true })),
      tool_choice: { type: 'auto' },
      stream: true,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
    });
    // Opus 5.5 always thinks and rejects sampling settings: none of these may be sent.
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'fallbacks']) expect(body).not.toHaveProperty(key);
  });

  it('leaves caching out of a request that will not repeat (a photo of the bag), so it is not written to the cache', () => {
    const body = JSON.parse(buildAnthropicRequest({ ...request(), cache: false }, KEY).body);
    expect(body).not.toHaveProperty('cache_control');
    expect(JSON.parse(buildAnthropicRequest({ ...request(), cache: true }, KEY).body).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends effort only to models that support it', () => {
    const effortOf = (model: string) => JSON.parse(buildAnthropicRequest(request({ model, effort: 'high' }), KEY).body).output_config;
    expect(effortOf('claude-sonnet-5')).toEqual({ effort: 'high' });
    expect(effortOf('claude-fable-5-1')).toEqual({ effort: 'high' });
    expect(effortOf('claude-haiku-4-5')).toBeUndefined();
    expect(effortOf('claude-unknown-1')).toBeUndefined();
  });

  it('asks for refusal fallbacks only for Opus 5 and Fable 5.1', () => {
    for (const model of ['claude-opus-5', 'claude-fable-5-1']) {
      const http = buildAnthropicRequest(request({ model }), KEY);
      expect(JSON.parse(http.body).fallbacks, model).toBe('default');
      expect(http.headers['anthropic-beta'], model).toBe('server-side-fallback-2026-07-01');
    }
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      const http = buildAnthropicRequest(request({ model }), KEY);
      expect(JSON.parse(http.body), model).not.toHaveProperty('fallbacks');
      expect(http.headers['anthropic-beta'], model).toBeUndefined();
    }
  });

  it('uses the requested max_tokens and leaves tools out when there are none', () => {
    const body = JSON.parse(buildAnthropicRequest(request({ maxTokens: 4000, tools: [] }), KEY).body);
    expect(body.max_tokens).toBe(4000);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('lets a custom base URL win and trims its trailing slash', () => {
    expect(anthropicEndpoint()).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicEndpoint('https://proxy.example/')).toBe('https://proxy.example/v1/messages');
    expect(buildAnthropicRequest(request(), KEY, 'https://proxy.example//').url).toBe('https://proxy.example/v1/messages');
  });

  it('JSON-encodes the conversation, so quotes and newlines survive', () => {
    const text = 'He said "sour"\nand it ran 19s\\fast';
    const body = JSON.parse(buildAnthropicRequest(request({ messages: [{ role: 'user', content: [{ type: 'text', text }] }] }), KEY).body);
    expect(body.messages[0].content[0].text).toBe(text);
  });

  it('replays stored assistant turns byte for byte', () => {
    const turn = {
      role: 'assistant' as const,
      content: [
        { type: 'thinking', thinking: '', signature: 'EqQBCkgIBRAB==' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'text', text: 'Hi', citations: null },
        { type: 'tool_use', id: 'toolu_1', name: 'get_bag_history', input: {} },
      ] as unknown as ContentBlock[],
    };
    const answer: LlmMessage = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"versions":[]}' }] };
    const body = JSON.parse(buildAnthropicRequest(request({ messages: [INTAKE, turn, answer] }), KEY).body);
    expect(JSON.stringify(body.messages)).toBe(JSON.stringify([INTAKE, turn, answer]));
  });

  it('puts the API key on the request header and nowhere else', () => {
    const http = buildAnthropicRequest(request(), KEY);
    expect(http.body).not.toContain(KEY);
    expect(http.url).not.toContain(KEY);
    expect(Object.values(http.headers).filter((v) => v.includes(KEY))).toHaveLength(1);
  });
});

describe('backoffMs', () => {
  it('waits 1 s then 2 s, or what retry-after asks for (capped at a minute)', () => {
    expect(backoffMs(0, 1000, null)).toBe(1000);
    expect(backoffMs(1, 1000, null)).toBe(2000);
    expect(backoffMs(0, 1000, 3000)).toBe(3000);
    expect(backoffMs(1, 1000, 0)).toBe(0);
    expect(backoffMs(0, 1000, 600_000)).toBe(60_000);
  });
});

// ---- streaming against the scripted fake ------------------------------------

describe('createAnthropicProvider: streaming', () => {
  it('streams text deltas, tool calls and one finished turn', async () => {
    const events = await collect(provider().stream(request()));
    expect(events[0]).toMatchObject({ type: 'message_start', model: 'claude-opus-5-5' });
    const text = events.flatMap((e) => (e.type === 'text_delta' ? [e.text] : [])).join('');
    expect(text).toBe('Lovely. Here is where I would start.');
    expect(events.filter((e) => e.type === 'text_delta').length).toBeGreaterThan(1);
    expect(events.flatMap((e) => (e.type === 'tool_use_start' ? [e.name] : []))).toEqual(['save_bag_details', 'propose_templates']);
    expect(events.filter((e) => e.type === 'block_stop').map((e) => (e as { index: number }).index)).toEqual([0, 1, 2, 3]);

    const turn = doneTurn(events);
    expect(turn.stopReason).toBe('tool_use');
    expect(turn.usage.inputTokens).toBeGreaterThan(0);
    expect(turn.usage.outputTokens).toBeGreaterThan(0);
    expect(turn.content[0]).toMatchObject({ type: 'thinking', thinking: '' });
    expect((turn.content[0] as { signature: string }).signature).toMatch(/^mock-sig-/);
    const save = turn.content[2] as ToolUseBlock;
    expect(save.name).toBe('save_bag_details');
    expect(save.input).toEqual({ name: 'Kiambu AA', roaster: null, origin: null, roastLevel: 'light', process: 'washed', notes: null, roastDate: null });
  });

  it('sends the headers and body the API requires', async () => {
    const seen: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
    server.use(
      http.post(URL, async ({ request: req }) => {
        seen.push({ headers: req.headers, body: (await req.clone().json()) as Record<string, unknown> });
      }),
    );
    await collect(provider().stream(request()));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get('x-api-key')).toBe(KEY);
    expect(seen[0]?.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(seen[0]?.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(seen[0]?.body.stream).toBe(true);
  });

  it('replays the turn it assembled exactly (the fake rejects any edit)', async () => {
    const first = doneTurn(await collect(provider().stream(request())));
    const [save, templates] = first.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const answers: LlmMessage = {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: save!.id, content: '{"saved":true}' },
        {
          type: 'tool_result',
          tool_use_id: templates!.id,
          content: '{"picked":"blooming-espresso","version":1,"title":"Kiambu AA v1","uploaded":true,"note":null}',
        },
      ],
    };
    const next = doneTurn(
      await collect(provider().stream(request({ messages: [INTAKE, { role: 'assistant', content: first.content }, answers] }))),
    );
    expect(next.content.filter((b) => b.type === 'text')).toEqual([
      { type: 'text', text: 'Loaded Kiambu AA v1. Pull a shot when you are ready; I will read the curves.' },
    ]);

    const edited = first.content.map((b) => (b.type === 'text' ? { ...b, text: 'Edited' } : b));
    const error = await failure(
      collect(provider().stream(request({ messages: [INTAKE, { role: 'assistant', content: edited }, answers] }))),
    );
    expect(error.kind).toBe('bad_request');
    expect(error.message).toMatch(/^Anthropic rejected the request: .*modified/);
  });

  it('works through a stream cut into small odd-sized chunks', async () => {
    server.use(...anthropicHandlers({ speed: Infinity, chunkBytes: 7 }));
    const turn = doneTurn(await collect(provider().stream(request())));
    expect(turn.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'tool_use']);
  });
});

// ---- errors ----------------------------------------------------------------

describe('createAnthropicProvider: errors', () => {
  it('asks for a key, without sending anything, when there is none', async () => {
    const counter = countRequests();
    for (const key of [null, '', '   ']) {
      const error = await failure(collect(provider({ getApiKey: () => Promise.resolve(key) }).stream(request())));
      expect(error.kind).toBe('no_api_key');
      expect(error.message).toBe('Add your Anthropic API key in Settings.');
    }
    expect(counter.calls).toBe(0);
  });

  it('maps a rejected key to auth and does not retry it', async () => {
    const counter = countRequests();
    const error = await failure(collect(provider({ getApiKey: () => Promise.resolve('sk-ant-invalid') }).stream(request())));
    expect(error).toMatchObject({ kind: 'auth', status: 401, retryable: false });
    expect(error.message).toMatch(/did not accept your API key/);
    expect(counter.calls).toBe(1);
  });

  it('retries an overloaded API twice, then reports it', async () => {
    const counter = countRequests();
    const error = await failure(collect(provider({ getApiKey: () => Promise.resolve('sk-ant-overloaded') }).stream(request())));
    expect(error).toMatchObject({ kind: 'overloaded', status: 529, retryable: true });
    expect(counter.calls).toBe(3);
  });

  it.each([
    [400, errorBody('invalid_request_error', 'model: claude-nope is not a valid model'), 'bad_request', 1],
    [404, errorBody('not_found_error', 'model: claude-nope'), 'bad_request', 1],
    [403, errorBody('permission_error', 'not allowed'), 'auth', 1],
    [429, errorBody('rate_limit_error', 'slow down'), 'rate_limit', 3],
    [500, errorBody('api_error', 'Internal server error'), 'server', 3],
    [503, errorBody('api_error', 'unavailable'), 'server', 3],
  ] as const)('maps HTTP %i to %s', async (status, body, kind, calls) => {
    const counter = countRequests(() => HttpResponse.json(body, { status, headers: { 'retry-after': '0' } }));
    const error = await failure(collect(provider().stream(request())));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(counter.calls).toBe(calls);
    if (status === 400) expect(error.message).toBe('Anthropic rejected the request: model: claude-nope is not a valid model');
  });

  it('maps an unreachable API to a network error and retries it', async () => {
    const counter = countRequests(() => HttpResponse.error());
    const error = await failure(collect(provider().stream(request())));
    expect(error).toMatchObject({ kind: 'network', retryable: true });
    expect(error.message).toBe("Could not reach Anthropic. Check this device's internet connection.");
    expect(counter.calls).toBe(3);
  });

  it('retries before the first byte, then succeeds', async () => {
    const counter = countRequests((call) =>
      call === 1 ? HttpResponse.json(errorBody('overloaded_error', 'Overloaded'), { status: 529 }) : undefined,
    );
    const turn = doneTurn(await collect(provider().stream(request())));
    expect(turn.stopReason).toBe('tool_use');
    expect(counter.calls).toBe(2);
  });

  it('retries an error event that arrives before anything was shown', async () => {
    const counter = countRequests((call) =>
      call === 1 ? sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) : undefined,
    );
    doneTurn(await collect(provider().stream(request())));
    expect(counter.calls).toBe(2);
  });

  it('never retries once anything has streamed', async () => {
    const counter = countRequests(() =>
      sse(
        MESSAGE_START,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half a' } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ),
    );
    const seen: LlmStreamEvent[] = [];
    const error = await failure(collect(provider().stream(request()), seen));
    expect(error.kind).toBe('overloaded');
    expect(seen.map((e) => e.type)).toEqual(['message_start', 'text_delta']);
    expect(counter.calls).toBe(1);
  });

  it('reports a stream that ends before the message did', async () => {
    countRequests(() => sse(MESSAGE_START, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    const error = await failure(collect(provider().stream(request())));
    expect(error).toMatchObject({ kind: 'network', retryable: true });
    expect(error.message).toMatch(/dropped/);
  });

  it('refuses a 200 that is not an event stream', async () => {
    countRequests(() => HttpResponse.json({ type: 'message', content: [] }));
    const error = await failure(collect(provider().stream(request())));
    expect(error.kind).toBe('protocol');
  });

  it('never echoes the key, even when a server puts it in an error', async () => {
    countRequests(() => HttpResponse.json(errorBody('invalid_request_error', `bad key ${KEY} here`), { status: 400 }));
    const error = await failure(collect(provider().stream(request())));
    expect(error.message).not.toContain(KEY);
    expect(error.message).toMatch(/rejected the request/);
  });
});

// ---- abort and timeouts -----------------------------------------------------

describe('createAnthropicProvider: abort and timeouts', () => {
  it('stops at once for an already-aborted signal, without a request', async () => {
    const counter = countRequests();
    const controller = new AbortController();
    controller.abort();
    const error = await failure(collect(provider().stream(request({ signal: controller.signal }))));
    expect(error.kind).toBe('aborted');
    expect(counter.calls).toBe(0);
  });

  it('stops mid-stream when the caller aborts, and reports aborted rather than a network error', async () => {
    server.use(...anthropicHandlers({ speed: 1, firstEventDelayMs: 0, eventDelayMs: 20 }));
    const controller = new AbortController();
    const seen: LlmStreamEvent[] = [];
    const run = collect(provider().stream(request({ signal: controller.signal })), seen);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const error = await failure(run);
    expect(error.kind).toBe('aborted');
    expect(seen.some((e) => e.type === 'message_done')).toBe(false);
  });

  it('stops even when the rest of the reply is already in the same chunk', async () => {
    server.use(...anthropicHandlers({ speed: Infinity, chunkBytes: 1_000_000 }));
    const controller = new AbortController();
    const seen: LlmStreamEvent[] = [];
    const run = (async () => {
      for await (const event of provider().stream(request({ signal: controller.signal }))) {
        seen.push(event);
        if (event.type === 'text_delta') controller.abort();
      }
    })();
    const error = await failure(run);
    expect(error.kind).toBe('aborted');
    expect(seen.filter((e) => e.type === 'text_delta')).toHaveLength(1);
    expect(seen.some((e) => e.type === 'message_done')).toBe(false);
  });

  it('times out waiting for the first byte', async () => {
    server.use(
      http.post(URL, async () => {
        await delay(500);
        return HttpResponse.json({});
      }),
    );
    const error = await failure(
      collect(provider({ maxRetries: 0, timeouts: { firstByteMs: 40, idleMs: 1000 } }).stream(request())),
    );
    expect(error).toMatchObject({ kind: 'network', retryable: true });
    expect(error.message).toMatch(/took too long/);
  });

  it('times out when the stream goes quiet', async () => {
    server.use(
      http.post(
        URL,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(sseFrame({ event: 'message_start', data: MESSAGE_START })));
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const seen: LlmStreamEvent[] = [];
    const error = await failure(collect(provider({ timeouts: { firstByteMs: 1000, idleMs: 40 } }).stream(request()), seen));
    expect(error.message).toMatch(/stalled/);
    expect(seen.map((e) => e.type)).toEqual(['message_start']);
  });
});

// ---- CafAI Bridge: the same API on the user's computer, its own wording ------

describe('createAnthropicProvider: CafAI Bridge wording', () => {
  const BRIDGE = 'http://192.168.1.20:8877';
  const BRIDGE_URL = `${BRIDGE}/v1/messages`;
  const CODE = 'ABCDEFGH';
  const bridge = (over: Partial<AnthropicProviderOptions> = {}) =>
    provider({ baseUrl: BRIDGE, getApiKey: () => Promise.resolve(CODE), wording: computerWording('192.168.1.20:8877'), ...over });
  const answer = (respond: () => Response | Promise<Response>) => server.use(http.post(BRIDGE_URL, respond));

  it('streams the scripted turn from the bridge with the code as the key', async () => {
    server.use(...anthropicHandlers({ speed: Infinity, baseUrl: BRIDGE }));
    const seen: string[] = [];
    server.use(
      http.post(BRIDGE_URL, ({ request: req }) => {
        seen.push(req.headers.get('x-api-key') ?? '');
      }),
    );
    expect(doneTurn(await collect(bridge().stream(request()))).stopReason).toBe('tool_use');
    expect(seen).toEqual([CODE]);
  });

  it('asks for the code, not a key', async () => {
    const error = await failure(collect(bridge({ getApiKey: () => Promise.resolve(null) }).stream(request())));
    expect(error).toMatchObject({ kind: 'no_api_key', message: 'Add the code CafAI Bridge shows on your computer in Settings.' });
  });

  it('names the address when the bridge cannot be reached', async () => {
    answer(() => HttpResponse.error());
    const error = await failure(collect(bridge({ maxRetries: 0 }).stream(request())));
    expect(error.message).toBe(
      'Could not reach CafAI Bridge at 192.168.1.20:8877. Check it is running on your computer and that this device is on the same network.',
    );
  });

  it('says your computer took too long, or stalled, or dropped the reply', async () => {
    answer(async () => {
      await delay(500);
      return HttpResponse.json({});
    });
    const slow = await failure(collect(bridge({ maxRetries: 0, timeouts: { firstByteMs: 40, idleMs: 1000 } }).stream(request())));
    expect(slow.message).toBe('Your computer took too long to answer. Try again.');

    server.resetHandlers();
    answer(
      () =>
        new HttpResponse(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseFrame({ event: 'message_start', data: MESSAGE_START })));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const stalled = await failure(collect(bridge({ timeouts: { firstByteMs: 1000, idleMs: 40 } }).stream(request())));
    expect(stalled.message).toBe('The reply from your computer stalled. Try again.');

    server.resetHandlers();
    answer(() => sse(MESSAGE_START, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    const dropped = await failure(collect(bridge().stream(request())));
    expect(dropped.message).toBe('The connection to your computer dropped before the reply finished. Try again.');
  });

  it('asks for an update when the reply cannot be read', async () => {
    const unreadable = 'CafAI Bridge sent a reply CafAI could not read. Update CafAI Bridge and try again.';
    answer(() => HttpResponse.json({ type: 'message', content: [] }));
    expect((await failure(collect(bridge().stream(request())))).message).toBe(unreadable);

    server.resetHandlers();
    answer(() => new HttpResponse('event: message_start\ndata: {not json\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    expect((await failure(collect(bridge().stream(request())))).message).toBe(unreadable);
  });

  it("shows the bridge's own sentence, from an error body or an error event, as it is", async () => {
    const signedOut = 'Claude Code on your computer is not signed in. Open a terminal there, run claude and sign in with /login.';
    answer(() => HttpResponse.json(errorBody('authentication_error', signedOut), { status: 401 }));
    expect(await failure(collect(bridge().stream(request())))).toMatchObject({ kind: 'auth', message: signedOut });

    server.resetHandlers();
    const failed = 'Claude Code on your computer stopped: the model ran out of room. Try again.';
    answer(() =>
      sse(
        MESSAGE_START,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'error', error: { type: 'invalid_request_error', message: failed } },
      ),
    );
    expect(await failure(collect(bridge().stream(request())))).toMatchObject({ kind: 'bad_request', message: failed });
  });

  it('asks shouldRetry about each retryable failure, and how the attempt went', async () => {
    const asked: Array<{ kind: string; status: number; streamOpened: boolean; timedOut: boolean }> = [];
    const never = (error: LlmError, context: { streamOpened: boolean; timedOut: boolean }) => {
      asked.push({ kind: error.kind, status: error.status, ...context });
      return false;
    };
    let calls = 0;
    answer(() => {
      calls += 1;
      return HttpResponse.json(errorBody('api_error', 'Every run is busy.'), { status: 503 });
    });
    await failure(collect(bridge({ shouldRetry: never }).stream(request())));
    answer(() => {
      calls += 1;
      return sse({ type: 'ping' }, { type: 'error', error: { type: 'overloaded_error', message: 'Claude is overloaded.' } });
    });
    await failure(collect(bridge({ shouldRetry: never }).stream(request())));
    answer(async () => {
      calls += 1;
      await delay(500);
      return HttpResponse.json({});
    });
    await failure(collect(bridge({ shouldRetry: never, timeouts: { firstByteMs: 40, idleMs: 1000 } }).stream(request())));
    // Not asked about what is never retried (a wrong code).
    answer(() => {
      calls += 1;
      return HttpResponse.json(errorBody('authentication_error', 'No.'), { status: 401 });
    });
    await failure(collect(bridge({ shouldRetry: never }).stream(request())));

    expect(calls).toBe(4);
    expect(asked).toEqual([
      { kind: 'server', status: 503, streamOpened: false, timedOut: false },
      { kind: 'overloaded', status: 529, streamOpened: true, timedOut: false },
      { kind: 'network', status: 0, streamOpened: false, timedOut: true },
    ]);
  });

  it('never echoes the code, as sent or as shown', async () => {
    for (const echoed of [CODE, 'ABCD-EFGH', 'abcd efgh']) {
      server.resetHandlers();
      answer(() => HttpResponse.json(errorBody('authentication_error', `Wrong code ${echoed}.`), { status: 401 }));
      const error = await failure(collect(bridge().stream(request())));
      expect(error.message).toBe('Wrong code [key].');
    }
  });

  it('never lets the code into the traffic log, sent or echoed (D139)', async () => {
    trafficLog.clear();
    answer(() => HttpResponse.json(errorBody('authentication_error', 'Wrong code ABCD-EFGH.'), { status: 401 }));
    await failure(collect(bridge().stream(request())));
    const [sent, received] = trafficLog.list();
    expect(sent).toMatchObject({ channel: 'coach', what: 'POST 192.168.1.20:8877/v1/messages' });
    expect(sent!.headers).toContain(`x-api-key: ${KEY_MARKER}`);
    expect(received).toMatchObject({ status: '401', failed: true });
    expect(received!.body).toContain(`Wrong code ${KEY_MARKER}.`);
    const everything = JSON.stringify(trafficLog.list());
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain('ABCD-EFGH');
  });
});

// ---- the traffic log --------------------------------------------------------

describe('createAnthropicProvider: the traffic log (D139)', () => {
  beforeEach(() => trafficLog.clear());

  it('keeps the request without the key, and the turn as assembled with its stop reason, usage and events', async () => {
    await collect(provider().stream(request()));
    const [sent, received] = trafficLog.list();
    expect(sent).toMatchObject({ direction: 'sent', channel: 'coach', what: 'POST api.anthropic.com/v1/messages', status: '' });
    expect(sent!.headers).toContain(`x-api-key: ${KEY_MARKER}`);
    expect(sent!.headers).toContain('anthropic-version: 2023-06-01');
    expect(JSON.parse(sent!.body)).toMatchObject({ model: 'claude-opus-5-5', stream: true, system: 'You are an espresso coach.' });
    expect(received).toMatchObject({ direction: 'received', channel: 'coach', status: '200 tool_use', failed: false });
    const reply = JSON.parse(received!.body) as LlmAssistantTurn;
    expect(reply.stopReason).toBe('tool_use');
    expect(reply.usage.inputTokens).toBeGreaterThan(0);
    expect(reply.content.map((block) => block.type)).toEqual(['thinking', 'text', 'tool_use', 'tool_use']);
    expect(received!.raw).toContain('event: message_start\ndata: {');
    expect(received!.raw).toContain('event: message_stop');
    expect(received!.size).toBeGreaterThan(received!.raw.length / 2);
    expect(received!.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(trafficLog.list())).not.toContain(KEY);
  });

  it('keeps an error reply, and each try as its own exchange', async () => {
    countRequests((call) => (call === 1 ? HttpResponse.json(errorBody('overloaded_error', 'Overloaded'), { status: 529 }) : undefined));
    await collect(provider().stream(request()));
    expect(trafficLog.list().map((entry) => `${entry.direction} ${entry.status}`)).toEqual([
      'sent ',
      'received 529',
      'sent ',
      'received 200 tool_use',
    ]);
    expect(trafficLog.list()[1]!.body).toContain('overloaded_error');
  });

  it('says how a request with no reply ended: no network, cancelled, a stream that broke', async () => {
    countRequests(() => HttpResponse.error());
    await failure(collect(provider({ maxRetries: 0 }).stream(request())));
    server.resetHandlers();
    server.use(...anthropicHandlers({ speed: 1, firstEventDelayMs: 0, eventDelayMs: 20 }));
    const controller = new AbortController();
    const run = collect(provider().stream(request({ signal: controller.signal })));
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await failure(run);
    server.resetHandlers();
    countRequests(() => sse(MESSAGE_START, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
    await failure(collect(provider({ maxRetries: 0 }).stream(request())));
    const received = trafficLog.list().filter((entry) => entry.direction === 'received');
    expect(received.map((entry) => [entry.status, entry.failed])).toEqual([
      ['network error', true],
      ['cancelled', true],
      ['overloaded', true],
    ]);
    expect(received[1]!.raw).toContain('event: message_start');
    expect(received[2]!.raw).toContain('event: error');
  });

  it('keeps a photo of the bag as its size', async () => {
    countRequests(() => HttpResponse.json(errorBody('invalid_request_error', 'No.'), { status: 400 }));
    const photo = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: `/9j/${'A'.repeat(8188)}` } };
    await failure(collect(provider({ maxRetries: 0 }).stream(request({ messages: [{ role: 'user', content: [photo] }] }))));
    const sent = trafficLog.list()[0]!;
    expect(sent.body).toContain('"data":"[image, 6 KB]"');
    expect(sent.body).not.toContain('AAAAAAAA');
    expect(sent.size).toBeGreaterThan(8000);
  });
});

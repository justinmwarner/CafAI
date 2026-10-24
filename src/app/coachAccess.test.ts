import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { anthropicHandlers, resetAnthropicMock } from '../../mock/anthropic/handlers.ts';
import { sseFrame } from '../../mock/anthropic/sse.ts';
import { TOOL_INPUTS } from '../coach/contract.ts';
import { toToolDefinition } from '../llm/schema.ts';
import { LlmError, type LlmMessage, type LlmRequest, type LlmStreamEvent } from '../llm/types.ts';
import { createMemoryCoachSourceStore, type CoachSource } from '../storage/coachSource.ts';
import type { SecretStore, Storage } from '../storage/types.ts';
import type { SpendCount } from '../spend/types.ts';
import { activeCredential, createCoachProvider, retryOnComputer, withCoachCredential } from './coachAccess.ts';

const KEY = 'sk-ant-test-key-0123456789';
const BRIDGE = 'http://192.168.1.20:8877';
const BRIDGE_MESSAGES = `${BRIDGE}/v1/messages`;
const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
const COMPUTER: CoachSource = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' };

const server = setupServer(...anthropicHandlers({ speed: Infinity }), ...anthropicHandlers({ speed: Infinity, baseUrl: BRIDGE }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAnthropicMock();
});
afterAll(() => server.close());

const TOOLS = Object.entries(TOOL_INPUTS).map(([name, schema]) => toToolDefinition(name, `The ${name} tool.`, schema));
const INTAKE: LlmMessage = { role: 'user', content: [{ type: 'text', text: 'Kiambu AA, light roast, washed' }] };
const REQUEST: LlmRequest = { model: 'claude-opus-5-5', system: 'You are an espresso coach.', messages: [INTAKE], tools: TOOLS };

function secrets(key: string | null = KEY): SecretStore {
  let stored = key;
  return {
    getApiKey: async () => stored,
    setApiKey: async (next) => {
      stored = next;
    },
    forgetApiKey: async () => {
      stored = null;
    },
  };
}

async function collect(events: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const seen: LlmStreamEvent[] = [];
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

/** Requests that reach `url`, counted and let through to the scripted coach (or answered by `answer`). */
function watch(url: string, answer?: () => Response | undefined) {
  const seen: Request[] = [];
  server.use(
    http.post(url, ({ request }) => {
      seen.push(request.clone());
      return answer?.();
    }),
  );
  return seen;
}

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });
const sse = (...events: Array<Record<string, unknown>>) =>
  new HttpResponse(events.map((data) => sseFrame({ event: String(data.type), data })).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });

function provider(source: Partial<CoachSource>, key: string | null = KEY) {
  const coachSource = createMemoryCoachSourceStore(source);
  return { coachSource, provider: createCoachProvider({ secrets: secrets(key), coachSource, retryBaseMs: 1 }) };
}

describe('createCoachProvider', () => {
  it('talks to Anthropic with the API key by default', async () => {
    const seen = watch(ANTHROPIC_MESSAGES);
    const events = await collect(provider({}).provider.stream(REQUEST));
    expect(events.at(-1)?.type).toBe('message_done');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get('x-api-key')).toBe(KEY);
  });

  it('talks to CafAI Bridge at its address with the code as the key when the coach runs on the computer', async () => {
    const seen = watch(BRIDGE_MESSAGES);
    const events = await collect(provider(COMPUTER, null).provider.stream(REQUEST));
    const done = events.at(-1);
    expect(done?.type === 'message_done' && done.turn.stopReason).toBe('tool_use');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers.get('x-api-key')).toBe('ABCDEFGH');
  });

  it('reads the source at every request, so a change in Settings applies to the next turn', async () => {
    const toAnthropic = watch(ANTHROPIC_MESSAGES);
    const toBridge = watch(BRIDGE_MESSAGES);
    const { coachSource, provider: coach } = provider({});
    await collect(coach.stream(REQUEST));
    await coachSource.set(COMPUTER);
    await collect(coach.stream(REQUEST));
    await coachSource.set({ ...COMPUTER, kind: 'anthropic' });
    await collect(coach.stream(REQUEST));
    expect([toAnthropic.length, toBridge.length]).toEqual([2, 1]);
  });

  it("asks for the code, in the bridge's words, without sending anything when there is none", async () => {
    const seen = watch(BRIDGE_MESSAGES);
    for (const code of ['', 'ABC']) {
      const error = await failure(collect(provider({ ...COMPUTER, code }).provider.stream(REQUEST)));
      expect(error).toMatchObject({ kind: 'no_api_key', message: 'Add the code CafAI Bridge shows on your computer in Settings.' });
    }
    expect(seen).toHaveLength(0);
  });

  it('asks for the address when there is none to send to', async () => {
    for (const address of ['', 'http://192.168.1.20/v1']) {
      const error = await failure(collect(provider({ ...COMPUTER, address }).provider.stream(REQUEST)));
      expect(error).toMatchObject({ kind: 'no_api_key', message: 'Add the address CafAI Bridge shows on your computer in Settings.' });
    }
  });

  it('names the address when the bridge cannot be reached', async () => {
    const seen = watch(BRIDGE_MESSAGES, () => HttpResponse.error());
    const error = await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
    expect(error).toMatchObject({
      kind: 'network',
      message: 'Could not reach CafAI Bridge at 192.168.1.20:8877. Check it is running on your computer and that this device is on the same network.',
    });
    expect(seen).toHaveLength(3);
  });

  it("shows the bridge's own sentences, which it writes for baristas", async () => {
    const cases: Array<[number, string, string, LlmError['kind']]> = [
      [401, 'authentication_error', 'Claude Code on your computer is not signed in. Open a terminal there, run claude and sign in with /login.', 'auth'],
      [404, 'not_found_error', 'Claude Code on your computer cannot use claude-opus-9. Pick another model in Settings.', 'bad_request'],
      [429, 'rate_limit_error', "Your Claude plan's usage limit is reached; it resets at 18:00.", 'rate_limit'],
      [503, 'overloaded_error', 'Every run on your computer is busy. Try again shortly.', 'overloaded'],
      [500, 'api_error', 'Claude Code on your computer did not answer. Update it (claude update) and try again.', 'server'],
    ];
    for (const [status, type, message, kind] of cases) {
      server.resetHandlers();
      watch(BRIDGE_MESSAGES, () => HttpResponse.json(errorBody(type, message), { status, headers: { 'retry-after': '0' } }));
      const error = await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
      expect(error, String(status)).toMatchObject({ kind, status, message });
    }
  });

  it("shows the bridge's sentence from an error event in the middle of a reply", async () => {
    watch(BRIDGE_MESSAGES, () => sse({ type: 'error', error: { type: 'authentication_error', message: 'Claude Code on your computer is not signed in.' } }));
    const error = await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
    expect(error).toMatchObject({ kind: 'auth', message: 'Claude Code on your computer is not signed in.' });
  });

  it('falls back to its own words when the bridge sent none', async () => {
    watch(BRIDGE_MESSAGES, () => new HttpResponse('Unauthorized', { status: 401 }));
    const error = await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
    expect(error).toMatchObject({ kind: 'auth', message: 'CafAI Bridge did not accept the code. Check it in Settings.' });
  });

  it('never shows the code, even when a server puts it in an error, with or without its dash', async () => {
    for (const echoed of ['ABCDEFGH', 'ABCD-EFGH', 'abcd-efgh']) {
      server.resetHandlers();
      watch(BRIDGE_MESSAGES, () => HttpResponse.json(errorBody('authentication_error', `The code ${echoed} is wrong.`), { status: 401 }));
      const error = await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
      expect(error.message).toBe('The code [key] is wrong.');
    }
  });

  it('asks an unreachable or busy bridge again, but nothing it already answered', async () => {
    const cases: Array<[string, () => Response, number]> = [
      ['unreachable', () => HttpResponse.error(), 3],
      ['every run busy', () => HttpResponse.json(errorBody('api_error', 'Every run on your computer is busy.'), { status: 503, headers: { 'retry-after': '0' } }), 3],
      ['locked out', () => HttpResponse.json(errorBody('rate_limit_error', 'Too many wrong codes from this device. Try again in 60 s.'), { status: 429, headers: { 'retry-after': '0' } }), 1],
      ['plan limit', () => sse({ type: 'ping' }, { type: 'error', error: { type: 'rate_limit_error', message: "Your Claude plan's usage limit is reached; it resets at 18:00." } }), 1],
      ['did not answer', () => sse({ type: 'ping' }, { type: 'error', error: { type: 'api_error', message: 'Claude Code on your computer did not answer.' } }), 1],
      ['overloaded', () => sse({ type: 'ping' }, { type: 'error', error: { type: 'overloaded_error', message: 'Claude is overloaded.' } }), 1],
      ['bridge trouble', () => HttpResponse.json(errorBody('api_error', 'Something broke.'), { status: 500 }), 1],
    ];
    for (const [name, respond, calls] of cases) {
      server.resetHandlers();
      const seen = watch(BRIDGE_MESSAGES, respond);
      await failure(collect(provider(COMPUTER).provider.stream(REQUEST)));
      expect(seen, name).toHaveLength(calls);
    }
  });

  it('waits once for a bridge that sends nothing at all, and says your computer took too long', async () => {
    const seen: Request[] = [];
    server.use(
      http.post(BRIDGE_MESSAGES, async ({ request }) => {
        seen.push(request);
        await delay(500);
        return HttpResponse.json({});
      }),
    );
    const coach = createCoachProvider({
      secrets: secrets(),
      coachSource: createMemoryCoachSourceStore(COMPUTER),
      retryBaseMs: 1,
      timeouts: { firstByteMs: 40 },
    });
    const error = await failure(collect(coach.stream(REQUEST)));
    expect(error.message).toBe('Your computer took too long to answer. Try again.');
    expect(seen).toHaveLength(1);
  });

  it('keeps retrying Anthropic as before', async () => {
    const seen = watch(ANTHROPIC_MESSAGES, () => HttpResponse.json(errorBody('rate_limit_error', 'slow down'), { status: 429, headers: { 'retry-after': '0' } }));
    await failure(collect(provider({}).provider.stream(REQUEST)));
    expect(seen).toHaveLength(3);
  });

  it('passes maxRetries on: the photo reader sends once', async () => {
    const seen = watch(BRIDGE_MESSAGES, () => HttpResponse.json(errorBody('overloaded_error', 'Claude is overloaded.'), { status: 529 }));
    const coach = createCoachProvider({ secrets: secrets(), coachSource: createMemoryCoachSourceStore(COMPUTER), maxRetries: 0 });
    await failure(collect(coach.stream(REQUEST)));
    expect(seen).toHaveLength(1);
  });
});

describe("counting what the coach used (D237)", () => {
  const AT = new Date('2026-10-24T09:30:00');
  /** A reply whose usage says exactly what it used: message_start's, then message_delta's. */
  const billed = () =>
    sse(
      {
        type: 'message_start',
        message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 900, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300, output_tokens: 1 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Grind finer.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40, server_tool_use: { web_search_requests: 1 } } },
      { type: 'message_stop' },
    );
  const USAGE = { inputTokens: 900, outputTokens: 40, cacheReadInputTokens: 4000, cacheCreationInputTokens: 300, webSearchRequests: 1 };

  function metered(source: Partial<CoachSource>, count?: (entry: SpendCount) => void) {
    const counts: SpendCount[] = [];
    const coach = createCoachProvider({
      secrets: secrets(),
      coachSource: createMemoryCoachSourceStore(source),
      retryBaseMs: 1,
      spend: { count: count ?? ((entry) => counts.push(entry)) },
      now: () => AT,
    });
    return { counts, coach };
  }

  it('counts each finished request once, with its model, what it was for, its call and the usage Anthropic reported', async () => {
    watch(ANTHROPIC_MESSAGES, billed);
    const { counts, coach } = metered({});
    await collect(coach.stream({ ...REQUEST, purpose: 'shot', call: 2 }));
    expect(counts).toEqual([{ at: AT, source: 'anthropic', model: 'claude-opus-5-5', kind: 'shot', call: 2, usage: USAGE }]);
  });

  it("counts a request that says nothing of itself as a reply's first call", async () => {
    watch(ANTHROPIC_MESSAGES, billed);
    const { counts, coach } = metered({});
    await collect(coach.stream(REQUEST));
    expect(counts).toMatchObject([{ kind: 'reply', call: 0 }]);
  });

  it('counts what CafAI Bridge reported as the computer\'s, whose plan pays for it', async () => {
    watch(BRIDGE_MESSAGES, billed);
    const { counts, coach } = metered(COMPUTER);
    await collect(coach.stream({ ...REQUEST, purpose: 'photo' }));
    expect(counts).toEqual([{ at: AT, source: 'computer', model: 'claude-opus-5-5', kind: 'photo', call: 0, usage: USAGE }]);
  });

  it('counts a request tried again once it got through, once', async () => {
    const seen = watch(ANTHROPIC_MESSAGES, () => (seen.length === 1 ? HttpResponse.json(errorBody('overloaded_error', 'Overloaded'), { status: 529 }) : billed()));
    const { counts, coach } = metered({});
    await collect(coach.stream(REQUEST));
    expect(seen).toHaveLength(2);
    expect(counts).toHaveLength(1);
  });

  it('counts nothing for a stream that fails before its end: what it used is not known', async () => {
    const cases: Array<[string, () => Response]> = [
      ['error event', () => sse({ ...MESSAGE_START_EVENT }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })],
      ['dropped', () => sse({ ...MESSAGE_START_EVENT }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })],
      ['refused', () => HttpResponse.json(errorBody('invalid_request_error', 'Bad request'), { status: 400 })],
    ];
    for (const [name, respond] of cases) {
      server.resetHandlers();
      watch(ANTHROPIC_MESSAGES, respond);
      const { counts, coach } = metered({});
      await failure(collect(coach.stream(REQUEST)));
      expect(counts, name).toEqual([]);
    }
  });

  it('never lets the count stand in the way of the reply', async () => {
    watch(ANTHROPIC_MESSAGES, billed);
    const { coach } = metered({}, () => {
      throw new Error('the counter broke');
    });
    const events = await collect(coach.stream(REQUEST));
    expect(events.at(-1)?.type).toBe('message_done');
  });
});

const MESSAGE_START_EVENT = {
  type: 'message_start',
  message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 9, output_tokens: 1 } },
};

describe('activeCredential', () => {
  it('is the API key while the coach runs on Anthropic', async () => {
    expect(await activeCredential(secrets(), createMemoryCoachSourceStore())).toBe(KEY);
    expect(await activeCredential(secrets(null), createMemoryCoachSourceStore(COMPUTER))).toBe('ABCDEFGH');
    expect(await activeCredential(secrets(null), createMemoryCoachSourceStore({ ...COMPUTER, kind: 'anthropic' }))).toBeNull();
  });

  it('is the code on the computer, once both the address and the code are valid', async () => {
    expect(await activeCredential(secrets(), createMemoryCoachSourceStore({ ...COMPUTER, code: 'abcd-efgh' }))).toBe('ABCDEFGH');
    expect(await activeCredential(secrets(), createMemoryCoachSourceStore({ ...COMPUTER, code: '' }))).toBeNull();
    expect(await activeCredential(secrets(), createMemoryCoachSourceStore({ ...COMPUTER, address: '' }))).toBeNull();
    expect(await activeCredential(secrets(), createMemoryCoachSourceStore({ ...COMPUTER, address: '192.168.1' }))).toBeNull();
  });
});

describe('retryOnComputer', () => {
  const network = new LlmError('network', 'x', 0, true);
  it('retries only a bridge that could not be reached or said it was busy, before its reply began', () => {
    expect(retryOnComputer(network, { streamOpened: false, timedOut: false })).toBe(true);
    expect(retryOnComputer(new LlmError('server', 'x', 503, true), { streamOpened: false, timedOut: false })).toBe(true);
    expect(retryOnComputer(network, { streamOpened: false, timedOut: true })).toBe(false);
    expect(retryOnComputer(network, { streamOpened: true, timedOut: false })).toBe(false);
    expect(retryOnComputer(new LlmError('server', 'x', 503, true), { streamOpened: true, timedOut: false })).toBe(false);
    expect(retryOnComputer(new LlmError('rate_limit', 'x', 429, true), { streamOpened: false, timedOut: false })).toBe(false);
    expect(retryOnComputer(new LlmError('overloaded', 'x', 529, true), { streamOpened: false, timedOut: false })).toBe(false);
  });
});

describe('withCoachCredential', () => {
  it('leaves the storage as it is without the store: the coach runs on Anthropic', () => {
    const storage = { secrets: secrets() } as unknown as Storage;
    expect(withCoachCredential(storage, undefined)).toBe(storage);
  });

  it("answers the engine's key check with what the selected source needs, and leaves the rest alone", async () => {
    const real = secrets(null);
    const storage = { bags: {}, settings: {}, secrets: real, mirror: {} } as unknown as Storage;
    const coachSource = createMemoryCoachSourceStore();
    const seen = withCoachCredential(storage, coachSource);

    expect(seen.bags).toBe(storage.bags);
    expect(seen.mirror).toBe(storage.mirror);
    expect(await seen.secrets.getApiKey()).toBeNull();
    await coachSource.set(COMPUTER);
    expect(await seen.secrets.getApiKey()).toBe('ABCDEFGH');
    // The key itself is still saved where Settings saves it.
    await seen.secrets.setApiKey(KEY);
    expect(await real.getApiKey()).toBe(KEY);
    await coachSource.set({ ...COMPUTER, kind: 'anthropic' });
    expect(await seen.secrets.getApiKey()).toBe(KEY);
  });
});

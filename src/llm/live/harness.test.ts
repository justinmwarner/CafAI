import { describe, expect, inject, it, vi } from 'vitest';
import { UNANSWERED_TEXT, grinderPayload, intakeBlocks, toolResult, userMessage } from '../../app/engine/protocol.ts';
import { AUTO_TOOLS, TOOL, type ToolName } from '../../coach/contract.ts';
import { COACH_TOOL_SPECS, TEMPLATES, buildSystemPrompt } from '../../coach/index.ts';
import {
  DEFAULT_MODEL,
  LlmError,
  buildAnthropicRequest,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
  type RunnerTool,
} from '../index.ts';
import {
  LIVE_SUITE_FLAG,
  NO_SHOTS_YET,
  bagNameOf,
  coachRunnerTools,
  contractProblems,
  describeFailure,
  errorResults,
  liveMode,
  recordBodies,
  scrubKey,
  sentMessagesJson,
  settle,
  templatePickedPayload,
  templatePickedTurn,
  withCallBudget,
} from './harness.ts';

/** A stand-in secret. Not shaped like an Anthropic key, so nothing key-shaped is written to the repository. */
const SECRET = 'live-test-secret-0123456789';
/** The Anthropic key prefix, assembled at run time for the same reason. */
const KEY_PREFIX = ['sk', 'ant', ''].join('-');

const S0 = { templateId: 'blooming-espresso', confidence: 'high', reason: 'A bloom suits a dense light roast.' };
const S1 = { templateId: 'd-flow', confidence: 'low', reason: 'Forgiving for most roasts.' };
const SAVE_INPUT = { name: 'Kiambu AA', roaster: null, origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null, roastDate: null };
const ASK_INPUT = { question: 'Milk or straight?', options: ['Straight', 'With milk'], multiSelect: false };

const INTAKE = userMessage(
  intakeBlocks('Kiambu AA, light roast, washed', {
    grinder: grinderPayload(null, null, null, false),
    scaleConnected: true,
    doseG: null,
    bag: null,
    roast: null,
    today: '2026-10-10',
  }),
);
const REPLY: LlmMessage = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig-1' },
    { type: 'text', text: 'Lovely. Here is where I would start.' },
    { type: 'tool_use', id: 'tu_save', name: TOOL.saveBagDetails, input: SAVE_INPUT },
    { type: 'tool_use', id: 'tu_ask', name: TOOL.askUser, input: ASK_INPUT },
    { type: 'tool_use', id: 'tu_pick', name: TOOL.proposeTemplates, input: { suggestions: [S0, S1] } },
  ],
};
const HELD = [toolResult('tu_save', { saved: true })];

describe('liveMode', () => {
  const withKey = { ANTHROPIC_API_KEY: SECRET };

  it('runs live under the live config when a key is set', () => {
    expect(liveMode(withKey, true)).toEqual({ kind: 'live', reason: '', allModels: false });
  });

  it('never runs outside the live config, whatever the environment says (npm test)', () => {
    const mode = liveMode({ ...withKey, LIVE_DRY_RUN: '1', LIVE_ALL_MODELS: '1' }, false);
    expect(mode.kind).toBe('skip');
    expect(mode.reason).toContain('npm run test:live');
  });

  it('skips without a key, and a blank key counts as none', () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '  \n' }]) {
      expect(liveMode(env, true)).toEqual({ kind: 'skip', reason: 'ANTHROPIC_API_KEY is not set', allModels: false });
    }
  });

  it('prefers the dry run to a key, so LIVE_DRY_RUN never spends anything', () => {
    expect(liveMode({ ...withKey, LIVE_DRY_RUN: '1' }, true).kind).toBe('dry-run');
    expect(liveMode({ LIVE_DRY_RUN: '1' }, true).kind).toBe('dry-run');
  });

  it('reads any dry-run value but an off word as on', () => {
    for (const value of ['1', 'true', 'yes', 'TRUE']) {
      expect(liveMode({ ...withKey, LIVE_DRY_RUN: value }, true).kind).toBe('dry-run');
    }
    for (const value of ['', '0', 'false', 'no', ' OFF ']) {
      expect(liveMode({ ...withKey, LIVE_DRY_RUN: value }, true).kind).toBe('live');
    }
  });

  it('adds the per-model requests only for LIVE_ALL_MODELS=1 exactly', () => {
    expect(liveMode({ ...withKey, LIVE_ALL_MODELS: '1' }, true).allModels).toBe(true);
    expect(liveMode({ LIVE_DRY_RUN: '1', LIVE_ALL_MODELS: '1' }, true).allModels).toBe(true);
    for (const value of ['', '0', 'true', 'yes']) {
      expect(liveMode({ ...withKey, LIVE_ALL_MODELS: value }, true).allModels).toBe(false);
    }
  });

  it('never carries the key', () => {
    for (const under of [true, false]) expect(JSON.stringify(liveMode(withKey, under))).not.toContain(SECRET);
  });

  it('is off under the unit config: only vitest.live.config.ts provides the flag', () => {
    expect(inject(LIVE_SUITE_FLAG)).toBeUndefined();
  });
});

describe('scrubKey', () => {
  it('replaces every copy of the key with [key]', () => {
    expect(scrubKey(`a ${SECRET} b ${SECRET}`, SECRET)).toBe('a [key] b [key]');
  });

  it('matches the trimmed key, which is what the client sends', () => {
    expect(scrubKey(`x ${SECRET} y`, `  ${SECRET}\n`)).toBe('x [key] y');
  });

  it('replaces the key literally, whatever characters it holds', () => {
    expect(scrubKey('a.b*c(d) and a.b*c(d)', 'a.b*c(d)')).toBe('[key] and [key]');
  });

  it('also replaces anything shaped like an Anthropic key, whole or cut short', () => {
    const other = `${KEY_PREFIX}api03-${'Ab_9-'.repeat(8)}`;
    expect(scrubKey(`old ${other}; start ${KEY_PREFIX}api0...`, SECRET)).toBe('old [key]; start [key]...');
  });

  it('leaves other text alone and never splits on a blank key', () => {
    const text = 'Anthropic rejected the request: model: claude-x';
    for (const key of ['', '   ', null, undefined]) expect(scrubKey(text, key)).toBe(text);
  });
});

describe('describeFailure', () => {
  it('gives the kind, the HTTP status and the message of a client error', () => {
    const error = new LlmError('bad_request', 'Anthropic rejected the request: model: claude-x', 404);
    expect(describeFailure(error, SECRET)).toBe('bad_request (HTTP 404): Anthropic rejected the request: model: claude-x');
  });

  it('leaves the status out when nothing answered', () => {
    const error = new LlmError('network', 'Could not reach Anthropic.', 0, true);
    expect(describeFailure(error, SECRET)).toBe('network: Could not reach Anthropic.');
  });

  it('scrubs the key from every kind of failure', () => {
    expect(describeFailure(new LlmError('auth', `refused ${SECRET}`, 401), SECRET)).toBe('auth (HTTP 401): refused [key]');
    expect(describeFailure(new TypeError(`fetch ${SECRET}`), SECRET)).toBe('TypeError: fetch [key]');
    expect(describeFailure(`thrown ${SECRET}`, SECRET)).toBe('thrown [key]');
  });

  it('keeps nothing but the name and message: no cause, no extra fields, no unknown objects', () => {
    const error = new Error('stream failed', { cause: { headers: { 'x-api-key': SECRET } } });
    Object.assign(error, { request: { headers: { 'x-api-key': SECRET } } });
    expect(describeFailure(error, null)).toBe('Error: stream failed');
    expect(describeFailure({ headers: { 'x-api-key': SECRET } }, null)).toBe('A non-error value was thrown.');
  });
});

describe('settle', () => {
  it('passes a value through', async () => {
    await expect(settle(() => Promise.resolve(42), SECRET)).resolves.toEqual({ ok: true, value: 42 });
  });

  it('turns a failure into a scrubbed line instead of throwing', async () => {
    const result = await settle(() => Promise.reject(new LlmError('auth', `key ${SECRET} refused`, 401)), SECRET);
    expect(result).toEqual({ ok: false, failure: 'auth (HTTP 401): key [key] refused' });
  });
});

describe('coachRunnerTools', () => {
  const tools = coachRunnerTools();
  const byName = (name: ToolName): RunnerTool => {
    const tool = tools.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`no ${name}`);
    return tool;
  };

  it('offers the nine contract tools in TOOL order, with the coach descriptions', () => {
    expect(tools.map((t) => t.definition.name)).toEqual(Object.values(TOOL));
    for (const name of Object.values(TOOL)) {
      expect(byName(name).definition.description).toBe(COACH_TOOL_SPECS[name].description);
    }
  });

  it('runs the automatic tools and leaves the rest to a tap', () => {
    for (const name of Object.values(TOOL)) {
      const auto = AUTO_TOOLS.includes(name);
      expect(byName(name).kind).toBe(auto ? 'auto' : 'ui');
      expect(byName(name).execute !== undefined).toBe(auto);
    }
  });

  it('answers save_bag_details with {"saved":true} and every query with "no shots yet"', async () => {
    expect(await byName(TOOL.saveBagDetails).execute?.(SAVE_INPUT)).toEqual({ content: '{"saved":true}' });
    for (const name of AUTO_TOOLS.filter((n) => n !== TOOL.saveBagDetails)) {
      expect(await byName(name).execute?.({ shot: 'latest' })).toEqual({ content: NO_SHOTS_YET, isError: true });
    }
  });

  it('checks inputs with zod and, like the engine, against the template catalog', () => {
    const pick = byName(TOOL.proposeTemplates);
    expect(pick.validate({ suggestions: [S0, S1] })).toEqual({ ok: true, value: { suggestions: [S0, S1] } });
    expect(pick.validate({ suggestions: [{ ...S0, templateId: 'turbo' }, S1] })).toEqual({
      ok: false,
      error: 'Unknown template id turbo. Use only: blooming-espresso, d-flow, londonium, allonge, gentle-and-sweet.',
    });
    expect(pick.validate({ suggestions: [S0, S0] })).toEqual({ ok: false, error: 'Suggest each template at most once.' });
    expect(pick.validate({ suggestions: [S0] })).toEqual({ ok: false, error: 'suggestions: expected at least 2 items' });
    expect(byName(TOOL.saveBagDetails).validate({ ...SAVE_INPUT, name: '' }).ok).toBe(false);
  });

  it('makes the request the engine makes: strict tools in order, tool_choice auto, the coach prompt, effort medium', () => {
    const http = buildAnthropicRequest(
      {
        model: DEFAULT_MODEL,
        system: buildSystemPrompt(TEMPLATES),
        messages: [INTAKE],
        tools: tools.map((t) => t.definition),
        effort: 'medium',
      },
      'placeholder',
    );
    const body = JSON.parse(http.body) as {
      tools: Array<{ name: string; strict: boolean }>;
      tool_choice: unknown;
      stream: boolean;
      system: string;
      output_config: unknown;
    };
    expect(body.tools.map((t) => t.name)).toEqual(Object.values(TOOL));
    expect(body.tools.every((t) => t.strict)).toBe(true);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.stream).toBe(true);
    expect(body.system).toBe(buildSystemPrompt(TEMPLATES));
    expect(body.output_config).toEqual({ effort: 'medium' });
  });
});

describe('contractProblems', () => {
  it('passes tool inputs that match the contract', () => {
    expect(contractProblems([INTAKE, REPLY])).toEqual([]);
  });

  it('names unknown tools and inputs the contract rejects', () => {
    const reply: LlmMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'a', name: 'web_search', input: {} },
        { type: 'tool_use', id: 'b', name: TOOL.proposeTemplates, input: { suggestions: [S0] } },
        { type: 'tool_use', id: 'c', name: 'constructor', input: {} },
      ],
    };
    expect(contractProblems([INTAKE, reply])).toEqual([
      'web_search: not a CafAI tool',
      'propose_templates: suggestions: expected at least 2 items',
      'constructor: not a CafAI tool',
    ]);
  });
});

describe('errorResults', () => {
  it('lists error results by tool name, but not the stub answers to queries', () => {
    const reply: LlmMessage = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'q', name: TOOL.getBagHistory, input: {} },
        { type: 'tool_use', id: 's', name: TOOL.saveBagDetails, input: {} },
      ],
    };
    const answers = userMessage([toolResult('q', NO_SHOTS_YET, true), toolResult('s', 'name: required', true)]);
    expect(errorResults([INTAKE, reply, answers], [toolResult('x', 'Unknown tool "x".', true)])).toEqual([
      'save_bag_details: name: required',
      'x: Unknown tool "x".',
    ]);
    expect(errorResults([INTAKE, REPLY], HELD)).toEqual([]);
  });
});

describe('the template pick', () => {
  const payload = templatePickedPayload('d-flow', 'Kiambu AA');

  it('has the ENGINE_PROTOCOL rule 2 shape: v1 at the 18 g reference (no dose in Decaid), on a connected machine', () => {
    expect(JSON.stringify(payload)).toBe(
      '{"picked":"d-flow","version":1,"title":"Kiambu AA v1","yieldG":50,"doseG":null,"uploaded":true,"onMachine":true,"loadError":null,"note":null}',
    );
    expect(templatePickedPayload('allonge', 'Kiambu AA')).toMatchObject({ yieldG: 90, doseG: null });
  });

  it('refuses a template outside the catalog', () => {
    expect(() => templatePickedPayload('turbo', 'Kiambu AA')).toThrow('turbo');
  });

  it('answers every call of the last turn in tool_use order, as engine.ts sendUser does', () => {
    expect(templatePickedTurn([INTAKE, REPLY], HELD, 'tu_pick', payload)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_save', content: '{"saved":true}' },
        { type: 'tool_result', tool_use_id: 'tu_ask', content: JSON.stringify(UNANSWERED_TEXT) },
        { type: 'tool_result', tool_use_id: 'tu_pick', content: JSON.stringify(payload) },
      ],
    });
  });

  it('refuses a pick that answers no pending call', () => {
    expect(() => templatePickedTurn([INTAKE], HELD, 'tu_pick', payload)).toThrow('tu_pick');
    expect(() => templatePickedTurn([INTAKE, REPLY], HELD, 'tu_other', payload)).toThrow('tu_other');
  });

  it('names the bag from the last valid save_bag_details, else "New bag" as the engine does', () => {
    expect(bagNameOf([INTAKE, REPLY])).toBe('Kiambu AA');
    const corrected: LlmMessage = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_fix', name: TOOL.saveBagDetails, input: { ...SAVE_INPUT, name: '  Kiambu AB ' } }],
    };
    const invalid: LlmMessage = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_bad', name: TOOL.saveBagDetails, input: { name: 'No other fields' } }],
    };
    expect(bagNameOf([INTAKE, REPLY, corrected, invalid])).toBe('Kiambu AB');
    expect(bagNameOf([INTAKE])).toBe('New bag');
  });
});

describe('withCallBudget', () => {
  const REQUEST: LlmRequest = { model: 'm', system: '', messages: [INTAKE], tools: [] };

  function fakeProvider() {
    let calls = 0;
    const provider: LlmProvider = {
      id: 'fake',
      async *stream(): AsyncGenerator<LlmStreamEvent> {
        calls += 1;
        yield { type: 'message_start', id: `msg_${calls}`, model: 'm' };
      },
    };
    return { provider, calls: () => calls };
  }

  async function drain(events: AsyncIterable<LlmStreamEvent>): Promise<number> {
    let count = 0;
    for await (const _event of events) count += 1;
    return count;
  }

  it('passes the stream through, counts requests and refuses to start one past the cap', async () => {
    const fake = fakeProvider();
    const budget = withCallBudget(fake.provider, 2);
    expect(budget.provider.id).toBe('fake');
    expect([budget.used, budget.remaining]).toEqual([0, 2]);
    expect(await drain(budget.provider.stream(REQUEST))).toBe(1);
    expect(await drain(budget.provider.stream(REQUEST))).toBe(1);
    expect([budget.used, budget.remaining, fake.calls()]).toEqual([2, 0, 2]);
    await expect(drain(budget.provider.stream(REQUEST))).rejects.toThrow('at most 2 API calls');
    expect(fake.calls()).toBe(2);
  });

  it('counts a request only once it starts, as the client only sends it then', async () => {
    const budget = withCallBudget(fakeProvider().provider, 1);
    budget.provider.stream(REQUEST);
    expect(budget.used).toBe(0);
    await drain(budget.provider.stream(REQUEST));
    expect(budget.used).toBe(1);
  });
});

describe('recordBodies', () => {
  it('keeps each request body, never the headers, and sends through the fetch of the moment', async () => {
    const recorder = recordBodies();
    const seen: unknown[][] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve(new Response('ok'));
    });
    try {
      const init = { method: 'POST', headers: { 'x-api-key': SECRET }, body: '{"messages":[]}' };
      const response = await recorder.fetch('https://api.anthropic.com/v1/messages', init);
      expect(await response.text()).toBe('ok');
      expect(seen).toEqual([['https://api.anthropic.com/v1/messages', init]]);
      expect(recorder.bodies).toEqual(['{"messages":[]}']);
      expect(JSON.stringify(recorder.bodies)).not.toContain(SECRET);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads back the messages a request carried, as JSON', () => {
    const body = JSON.stringify({ model: 'm', messages: [INTAKE, REPLY], stream: true });
    expect(sentMessagesJson(body)).toBe(JSON.stringify([INTAKE, REPLY]));
    expect(sentMessagesJson('not json')).toBeNull();
    expect(sentMessagesJson('{"model":"m"}')).toBeNull();
  });
});

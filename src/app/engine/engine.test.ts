import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { createCoachEngine, type CoachEngine } from './engine.ts';
import type { ApiPort, ChangePlan, CoachPort, LlmPort } from './ports.ts';
import { OTHER_OPTION, TOOL, type ProposeAdjustment } from '../../coach/contract.ts';
import type { ProfileJson, ShotSummary, Template } from '../../coach/types.ts';
import type { ShotRecord, Workflow, WorkflowContext } from '../../api/types.ts';
import type { ContentBlock, LlmMessage, PendingUiCall, RunResult, ToolResultBlock } from '../../llm/types.ts';
import { createFakeStorage, createFakeTelemetry, SAMPLE_WORKFLOW, type FakeStorage, type FakeTelemetry } from '../../ui/testing/fakeServices.ts';

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

const baseProfile: ProfileJson = {
  version: '2',
  title: 'D-Flow / default',
  notes: '',
  author: 'Decent',
  beverage_type: 'espresso',
  steps: [
    {
      name: 'Pouring',
      pump: 'flow',
      transition: 'fast',
      sensor: 'coffee',
      temperature: 88,
      seconds: 127,
      volume: 0,
      weight: 0,
      flow: 1.7,
      exit: null,
      limiter: { value: 8.5, range: 0.2 },
    },
  ],
  target_volume: 0,
  target_weight: 50,
  target_volume_count_start: 2,
  tank_temperature: 0,
};

function makeTemplate(id: string, name: string): Template {
  return {
    id,
    name,
    style: name,
    shape: `${name} shape`,
    description: 'desc',
    roastFit: ['medium'],
    decaidDefaultId: `profile:${id}`,
    source: { repo: 'decentespresso/decaid', file: `${id}.json`, commit: 'a45961b' },
    profile: baseProfile,
    levers: [],
    constraints: [],
  };
}

const TEMPLATES = [makeTemplate('d-flow', 'D-Flow'), makeTemplate('londonium', 'Londonium')];

const summary: ShotSummary = {
  shotId: 'shot-1',
  timestamp: '2026-10-03T08:00:00.000000',
  profileTitle: 'Kiambu AA v1',
  durationS: 30,
  doseG: 18,
  yieldG: 50.2,
  ratio: 2.79,
  targetYieldG: 50,
  timeToFirstDropS: 8,
  preinfusionEndS: 10,
  peakPressureBar: 8.4,
  peakPressureAtS: 14,
  meanPourFlowMlS: 1.7,
  meanPourWeightFlowGs: 1.6,
  meanTempC: 88,
  tempDeviationC: 0.3,
  resistanceTrend: 'flat',
  channelingFlags: [],
  stopReason: 'targetWeight',
  phases: [],
  series: { tS: [0], pressure: [0], flow: [0], weight: [0], weightFlow: [0], temperature: [88], targetPressure: [null], targetFlow: [null] },
};

function plan(input: ProposeAdjustment, profile: ProfileJson): ChangePlan {
  if (input.variable === 'profile') {
    const from = profile.steps[0]!.temperature;
    return {
      variable: 'profile',
      leverId: 'temp',
      label: 'Brew temperature',
      unit: '°C',
      from,
      to: input.value,
      newProfile: { ...profile, steps: profile.steps.map((s) => ({ ...s, temperature: input.value! })) },
      contextPatch: {},
      diffLines: [`Brew temperature: ${from} °C -> ${input.value} °C`],
      manualSteps: [],
      summary: input.summary,
      createsVersion: true,
    };
  }
  return {
    variable: input.variable,
    leverId: null,
    label: null,
    unit: null,
    from: null,
    to: null,
    newProfile: null,
    contextPatch: {},
    diffLines: [],
    manualSteps: input.variable === 'grind' ? ['Grind 1 step finer'] : [],
    summary: input.summary,
    createsVersion: false,
  };
}

const coach: CoachPort = {
  templates: TEMPLATES,
  getTemplate: (id) => TEMPLATES.find((t) => t.id === id),
  systemPrompt: () => 'SYSTEM',
  toolDescription: (name) => `desc ${name}`,
  readLeverValues: (_t, p) => ({ temp: p.steps[0]!.temperature }),
  validateProposal(input, context) {
    if (input.variable === 'profile') {
      if (input.lever !== 'temp' || input.value === null) return { ok: false, errors: ['Only temp exists here.'] };
      if (Math.abs(input.value - context.profile.steps[0]!.temperature) > 2) {
        return { ok: false, errors: ['temp: at most 2.0 °C per step.'] };
      }
    }
    return { ok: true, plan: plan(input, context.profile) };
  },
  summarizeShot: () => summary,
  versionTitle: (name, n) => `${name} v${n}`,
  buildVersionProfile: (_t, base, title) => ({ ...base, title }),
  withOther: (options) => [...options.filter((o) => o.toLowerCase() !== 'other'), OTHER_OPTION],
  queries: {
    getShotSummary: async (source, ref) => (await source.resolve(ref))?.summary ?? null,
    getShotSeries: async (source, ref, metric) => ((await source.resolve(ref)) ? { metric, values: [1, 2] } : null),
    getPhaseStats: async () => ({}),
    compareShots: async () => ({}),
    getBagHistory: (versions) => ({ versions: versions.length }),
  },
};

interface ApiCall {
  method: string;
  args: unknown[];
}

function makeApi(calls: ApiCall[]): ApiPort {
  let ids = 0;
  return {
    getWorkflow: async () => SAMPLE_WORKFLOW,
    updateWorkflow: async (patch) => {
      calls.push({ method: 'updateWorkflow', args: [patch] });
      return SAMPLE_WORKFLOW;
    },
    activateProfile: async (profile: ProfileJson, context: WorkflowContext) => {
      calls.push({ method: 'activateProfile', args: [profile, context] });
      return { ...SAMPLE_WORKFLOW, profile } as Workflow;
    },
    createProfileVersion: async (request) => {
      calls.push({ method: 'createProfileVersion', args: [request] });
      ids += 1;
      return {
        record: {
          id: `profile:${ids}`,
          profile: request.profile,
          metadataHash: '',
          compoundHash: '',
          parentId: request.parentId ?? null,
          visibility: 'visible',
          isDefault: false,
          createdAt: '',
          updatedAt: '',
          metadata: null,
        },
        deduped: false,
      };
    },
    getShot: async (id) => {
      calls.push({ method: 'getShot', args: [id] });
      return { id, timestamp: '', createdAt: '', updatedAt: '', workflow: SAMPLE_WORKFLOW, measurements: [] } as ShotRecord;
    },
    getLatestShot: async () => null,
  };
}

/** One scripted assistant turn per model call. */
type Script = () => ContentBlock[];

/**
 * A faithful miniature of runConversation: streams the scripted text,
 * appends the turn, runs auto tools and loops, stops on valid UI calls.
 */
function makeLlm(scripts: Script[], requests: LlmMessage[][]): LlmPort {
  return {
    provider: {
      id: 'fake',
      stream: () => {
        throw new Error('unused');
      },
    },
    toolDefinition: (name, description) => ({ name, description, inputSchema: {} }),
    validator: (schema: ZodType) => (input) => {
      const parsed = schema.safeParse(input);
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
    },
    async run(request): Promise<RunResult> {
      let messages = request.messages;
      for (;;) {
        requests.push(messages);
        const script = scripts.shift();
        if (!script) throw new Error('No scripted turn left');
        const content = script();
        request.onTurnStart?.();
        for (const block of content) if (block.type === 'text') request.onTextDelta?.(block.text);
        await request.onAppend({ role: 'assistant', content });
        messages = [...messages, { role: 'assistant', content }];
        const pendingUiCalls: PendingUiCall[] = [];
        const results: ToolResultBlock[] = [];
        for (const block of content) {
          if (block.type !== 'tool_use') continue;
          const tool = request.tools.find((t) => t.definition.name === block.name)!;
          const validation = tool.validate(block.input);
          if (!validation.ok) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: validation.error, is_error: true });
          } else if (tool.kind === 'auto') {
            const outcome = await tool.execute!(validation.value);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.content });
          } else {
            pendingUiCalls.push({ id: block.id, name: block.name, input: validation.value });
          }
        }
        if (pendingUiCalls.length > 0) {
          return { pendingUiCalls, heldResults: results, stopReason: 'tool_use', finalText: '' };
        }
        if (results.length === 0) return { pendingUiCalls, heldResults: [], stopReason: 'end_turn', finalText: '' };
        const user: LlmMessage = { role: 'user', content: results };
        await request.onAppend(user);
        messages = [...messages, user];
      }
    },
  };
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id, name, input });

const saveBag = toolUse('t-save', TOOL.saveBagDetails, {
  name: 'Kiambu AA',
  roaster: 'Square Mile',
  origin: 'Kenya',
  roastLevel: 'light',
  process: 'washed',
  notes: null,
});
const proposeTemplates = toolUse('t-tpl', TOOL.proposeTemplates, {
  suggestions: [
    { templateId: 'd-flow', confidence: 'high', reason: 'Fits a light washed Kenyan.' },
    { templateId: 'londonium', confidence: 'low', reason: 'If you like it heavier.' },
  ],
});
const askTaste = toolUse('t-ask', TOOL.askUser, {
  question: 'How did it taste?',
  options: ['Sour', 'Bitter', 'other'],
  multiSelect: false,
});
const proposeTemp = toolUse('t-adj', TOOL.proposeAdjustment, {
  variable: 'profile',
  lever: 'temp',
  value: 89,
  grind: null,
  summary: 'Raise brew temperature by 1 °C',
  rationale: 'Sour with a fast first drop.',
  expectedEffect: 'Sweeter, less sharp.',
  tips: ['Keep the dose the same.'],
});

function lastUserTurn(requests: LlmMessage[][]): ContentBlock[] {
  const messages = requests[requests.length - 1]!;
  const last = messages[messages.length - 1]!;
  expect(last.role).toBe('user');
  return last.content;
}

function parsed(block: ContentBlock | undefined): unknown {
  if (!block || block.type !== 'tool_result') throw new Error('not a tool_result');
  return JSON.parse(block.content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coach engine', () => {
  let storage: FakeStorage;
  let telemetry: FakeTelemetry;
  let apiCalls: ApiCall[];
  let requests: LlmMessage[][];
  let scripts: Script[];
  let engine: CoachEngine;

  function build(): CoachEngine {
    let counter = 0;
    return createCoachEngine({
      storage,
      telemetry,
      api: makeApi(apiCalls),
      coach,
      llm: makeLlm(scripts, requests),
      clock: { now: () => new Date('2026-10-03T08:00:00Z'), sleep: async () => {} },
      newId: (prefix) => `${prefix}-${++counter}-${Math.random().toString(16).slice(2, 6)}`,
    });
  }

  beforeEach(async () => {
    storage = createFakeStorage();
    storage.apiKey = 'sk-ant-test';
    telemetry = createFakeTelemetry();
    apiCalls = [];
    requests = [];
    scripts = [];
    engine = build();
    await engine.start();
  });

  async function throughTemplatePick() {
    await engine.newBag();
    expect(engine.getState().phase).toBe('intake');
    scripts.push(() => [text('Lovely. Here is where I would start.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    expect(engine.getState().phase).toBe('choosing_template');
    scripts.push(() => [text('Loaded. Pull a shot.')]);
    await engine.pickTemplate('t-tpl', 'd-flow');
  }

  async function throughShot() {
    await throughTemplatePick();
    scripts.push(() => [text('Got it.'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
  }

  async function throughProposal() {
    await throughShot();
    scripts.push(() => [toolUse('t-series', TOOL.getShotSeries, { shot: 'latest', metric: 'pressure', fromS: null, toS: null })]);
    scripts.push(() => [proposeTemp]);
    await engine.answerOptions('t-ask', ['Sour'], null);
    expect(engine.getState().phase).toBe('awaiting_confirmation');
  }

  it('starts a bag with the placeholder question and sends the intake turn with context', async () => {
    await engine.newBag();
    const first = engine.getState().messages[0]!;
    expect(first.role).toBe('assistant');
    expect(first.parts[0]).toMatchObject({ kind: 'text' });

    scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    const intake = requests[0]![0]!.content;
    expect(intake[0]).toEqual({ type: 'text', text: 'Kiambu AA, light, washed' });
    expect(intake[1]).toMatchObject({ type: 'text' });
    expect((intake[1] as { text: string }).text).toMatch(/^\[context\]\n\{"grinder"/);

    const state = engine.getState();
    expect(state.activeBag?.name).toBe('Kiambu AA');
    const cards = state.messages.flatMap((m) => m.parts).find((p) => p.kind === 'templates');
    expect(cards).toMatchObject({ kind: 'templates', requestId: 't-tpl' });
    if (cards?.kind === 'templates') expect(cards.items.map((i) => i.templateId)).toEqual(['d-flow', 'londonium']);
  });

  it('creates, uploads and activates "<Bean> v1" on a template tap', async () => {
    await throughTemplatePick();
    const create = apiCalls.find((c) => c.method === 'createProfileVersion')!;
    expect((create.args[0] as { profile: ProfileJson }).profile.title).toBe('Kiambu AA v1');
    const activation = apiCalls.find((c) => c.method === 'activateProfile')!;
    expect(activation.args[1]).toMatchObject({ targetYield: 50, coffeeName: 'Kiambu AA', coffeeRoaster: 'Square Mile' });

    const state = engine.getState();
    expect(state.activeVersion).toMatchObject({ version: 1, title: 'Kiambu AA v1', status: 'active', templateId: 'd-flow' });
    expect(state.phase).toBe('awaiting_shot');
    // Held save_bag_details result first, then the pick, in tool_use order.
    const turn = lastUserTurn(requests);
    expect(parsed(turn[0])).toEqual({ saved: true });
    expect(parsed(turn[1])).toMatchObject({ picked: 'd-flow', version: 1, title: 'Kiambu AA v1', uploaded: true });
  });

  it('turns a finished shot into an iteration, a shot card and an event turn', async () => {
    await throughShot();
    expect(apiCalls.some((c) => c.method === 'getShot' && c.args[0] === 'shot-1')).toBe(true);
    const iterations = await storage.iterations.listAll();
    expect(iterations).toHaveLength(1);
    expect(iterations[0]).toMatchObject({ shotId: 'shot-1', profileVersion: 1, outcome: 'pending' });

    const turn = lastUserTurn(requests);
    const event = turn.find((b) => b.type === 'text') as { text: string };
    expect(event.text.startsWith('[event:shot_completed]\n')).toBe(true);
    const payload = JSON.parse(event.text.split('\n')[1]!);
    expect(payload).toMatchObject({ shotId: 'shot-1', version: 1, templateId: 'd-flow', levers: { temp: 88 } });
    expect(payload.summary.series).toBeUndefined();

    const parts = engine.getState().messages.flatMap((m) => m.parts);
    expect(parts.some((p) => p.kind === 'shot')).toBe(true);
    const options = parts.find((p) => p.kind === 'options');
    expect(options?.kind === 'options' && options.options).toEqual(['Sour', 'Bitter', OTHER_OPTION]);
  });

  it('records feedback, runs query tools and shows one bounded change as a diff', async () => {
    await throughProposal();
    const iteration = (await storage.iterations.listAll())[0]!;
    expect(iteration.feedback).toEqual({ question: 'How did it taste?', selected: ['Sour'], otherText: null });
    expect(iteration.proposal).toMatchObject({ variable: 'profile', lever: 'temp', value: 89 });

    const diff = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'diff');
    expect(diff).toMatchObject({
      kind: 'diff',
      requestId: 't-adj',
      status: 'pending',
      versionLabel: 'Kiambu AA v2',
      lines: ['Brew temperature: 88 °C -> 89 °C'],
    });
    // The ask_user answer went back as a tool_result; the query result looped inside the run.
    const answerTurn = requests[requests.length - 2]!;
    const answer = answerTurn[answerTurn.length - 1]!.content[0];
    expect(parsed(answer)).toEqual({ selected: ['Sour'], other: null });
  });

  it('applies a confirmed change as v2 and can undo back to v1', async () => {
    await throughProposal();
    scripts.push(() => [text('Done. v2 is on the machine.')]);
    await engine.confirmChange('t-adj');

    const create = apiCalls.filter((c) => c.method === 'createProfileVersion')[1]!;
    const request = create.args[0] as { profile: ProfileJson; parentId?: string };
    expect(request.profile.title).toBe('Kiambu AA v2');
    expect(request.profile.steps[0]!.temperature).toBe(89);
    expect(request.parentId).toBe('profile:1');

    let state = engine.getState();
    expect(state.activeVersion).toMatchObject({ version: 2, status: 'active', change: { lever: 'temp', from: 88, to: 89 } });
    expect(state.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['1:superseded', '2:active']);
    expect(state.canUndo).toBe(true);
    expect((await storage.iterations.listAll())[0]!.outcome).toBe('applied');
    expect(parsed(lastUserTurn(requests)[0])).toEqual({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2' });

    scripts.push(() => [text('Back on v1.')]);
    await engine.undo();
    state = engine.getState();
    expect(state.activeVersion).toMatchObject({ version: 1, status: 'active' });
    expect(state.versions.map((v) => `${v.version}:${v.status}`)).toEqual(['1:active', '2:undone']);
    expect(state.canUndo).toBe(false);
    const lastActivation = apiCalls.filter((c) => c.method === 'activateProfile').pop()!;
    expect((lastActivation.args[0] as ProfileJson).steps[0]!.temperature).toBe(88);
    expect((await storage.iterations.listAll())[0]!.outcome).toBe('undone');
    const undoTurn = lastUserTurn(requests);
    expect((undoTurn[0] as { text: string }).text).toBe('[event:undo]\n{"from":2,"to":1,"title":"Kiambu AA v1"}');
    const diff = state.messages.flatMap((m) => m.parts).find((p) => p.kind === 'diff');
    expect(diff).toMatchObject({ status: 'undone' });
  });

  it('declines a change and tells the model', async () => {
    await throughProposal();
    scripts.push(() => [text('OK.')]);
    await engine.declineChange('t-adj');
    expect(parsed(lastUserTurn(requests)[0])).toEqual({ applied: false, reason: 'The user declined.' });
    expect((await storage.iterations.listAll())[0]!.outcome).toBe('declined');
    expect(engine.getState().activeVersion?.version).toBe(1);
  });

  it('rejects an out-of-bounds proposal back to the model instead of showing it', async () => {
    await throughShot();
    scripts.push(() => [
      toolUse('t-bad', TOOL.proposeAdjustment, { ...(proposeTemp as { input: object }).input, value: 95 }),
    ]);
    // The runner answers the invalid call with is_error and the model retries in the same run.
    scripts.push(() => [text('Sorry, that was too big a jump. Pull one more shot first.')]);
    await engine.answerOptions('t-ask', ['Sour'], null);
    expect(engine.getState().phase).toBe('awaiting_shot');
    expect(engine.getState().messages.flatMap((m) => m.parts).some((p) => p.kind === 'diff')).toBe(false);
    const turn = lastUserTurn(requests);
    expect(turn[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't-bad', is_error: true });
    expect((turn[0] as { content: string }).content).toContain('at most 2.0');
    expect((await storage.iterations.listAll())[0]!.proposal).toBeNull();
  });

  it('answers pending UI calls as unanswered when the user types instead', async () => {
    await throughShot();
    scripts.push(() => [text('Sure.')]);
    await engine.sendText('It was fine, actually');
    const turn = lastUserTurn(requests);
    expect(parsed(turn[0])).toEqual({ answered: false, note: 'The user typed a message instead.' });
    expect(turn[1]).toEqual({ type: 'text', text: 'It was fine, actually' });
  });

  it('asks for an API key instead of calling the model, then recovers via refresh and retry', async () => {
    storage.apiKey = null;
    await engine.newBag();
    await engine.sendText('Kiambu AA, light');
    expect(requests).toHaveLength(0);
    expect(engine.getState().error).toMatch(/API key/);
    expect(engine.getState().hasApiKey).toBe(false);

    storage.apiKey = 'sk-ant-test';
    await engine.refresh();
    expect(engine.getState().hasApiKey).toBe(true);
    expect(engine.getState().error).toBeNull();
    scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    expect(requests).toHaveLength(1);
  });

  it('recovers pending choices after a reload', async () => {
    await throughShot();
    engine.dispose();
    engine = build();
    await engine.start();
    expect(engine.getState().phase).toBe('awaiting_feedback');
    expect(engine.getState().activeVersion?.version).toBe(1);

    scripts.push(() => [text('Thanks.')]);
    await engine.answerOptions('t-ask', ['Bitter'], null);
    expect(parsed(lastUserTurn(requests)[0])).toEqual({ selected: ['Bitter'], other: null });
  });

  it('never sends the API key anywhere the UI can see', async () => {
    await throughProposal();
    const visible = JSON.stringify(engine.getState());
    expect(visible).not.toContain('sk-ant-test');
    const stored = JSON.stringify(await storage.porter.exportAll());
    expect(stored).not.toContain('sk-ant-test');
  });
});

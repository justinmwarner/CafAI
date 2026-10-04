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

function makeTemplate(id: string, name: string, profile: ProfileJson = baseProfile): Template {
  return {
    id,
    name,
    style: name,
    shape: `${name} shape`,
    description: 'desc',
    roastFit: ['medium'],
    decaidDefaultId: `profile:${id}`,
    source: { repo: 'decentespresso/decaid', file: `${id}.json`, commit: 'a45961b' },
    profile,
    levers: [],
    constraints: [],
  };
}

const TEMPLATES = [makeTemplate('d-flow', 'D-Flow'), makeTemplate('londonium', 'Londonium', { ...baseProfile, target_weight: 42 })];

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
  profileId: (p) => `id:${JSON.stringify((p as ProfileJson).steps)}:${(p as ProfileJson).target_weight}`,
  withOther: (options) => [...options.filter((o) => o.toLowerCase() !== 'other'), OTHER_OPTION],
  async runQuery(name, input, context) {
    if (name === TOOL.getBagHistory) return { content: JSON.stringify({ versions: context.versions.length }), isError: false };
    const ref = (input as { shot?: string }).shot ?? 'latest';
    const shot = await context.source.resolve(ref);
    if (!shot) return { content: 'No such shot.', isError: true };
    return { content: JSON.stringify({ shotId: shot.record.id, values: [1, 2] }), isError: false };
  },
};

interface ApiCall {
  method: string;
  args: unknown[];
}

const machine = {
  loaded: SAMPLE_WORKFLOW.profile as ProfileJson,
  /** The workflow context as Decaid keeps it: merged field by field, extras key by key. */
  context: { ...SAMPLE_WORKFLOW.context } as WorkflowContext,
  failActivations: 0,
  failUpdates: 0,
  missingShots: new Set<string>(),
};

function mergeContext(base: WorkflowContext, patch: WorkflowContext): WorkflowContext {
  return { ...base, ...patch, extras: { ...base.extras, ...patch.extras } };
}

function makeApi(calls: ApiCall[]): ApiPort {
  let ids = 0;
  // Like the machine: a shot runs whatever profile was activated last.
  machine.loaded = SAMPLE_WORKFLOW.profile as ProfileJson;
  machine.context = { ...SAMPLE_WORKFLOW.context } as WorkflowContext;
  machine.failActivations = 0;
  machine.failUpdates = 0;
  machine.missingShots.clear();
  return {
    getWorkflow: async () => ({ ...SAMPLE_WORKFLOW, profile: machine.loaded, context: machine.context }) as Workflow,
    updateWorkflow: async (patch) => {
      if (machine.failUpdates > 0) {
        machine.failUpdates -= 1;
        throw new Error('Decaid is not reachable.');
      }
      calls.push({ method: 'updateWorkflow', args: [patch] });
      return SAMPLE_WORKFLOW;
    },
    activateProfile: async (profile: ProfileJson, context: WorkflowContext) => {
      if (machine.failActivations > 0) {
        machine.failActivations -= 1;
        throw new Error('Decaid said no.');
      }
      calls.push({ method: 'activateProfile', args: [profile, context] });
      machine.loaded = profile;
      machine.context = mergeContext(machine.context, context);
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
      if (machine.missingShots.has(id)) throw new Error('404 Not found');
      const workflow = { ...SAMPLE_WORKFLOW, profile: machine.loaded, context: machine.context };
      return { id, timestamp: '', createdAt: '', updatedAt: '', workflow, measurements: [] } as ShotRecord;
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

/** The CafAI version id the fake machine's workflow context is tagged with. */
function taggedId(): unknown {
  return (machine.context.extras?.cafai as { versionId?: unknown } | undefined)?.versionId;
}

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

  /** Start another bag through intake and a template pick. */
  async function anotherBag(name: string, templateId: 'd-flow' | 'londonium') {
    await engine.newBag();
    scripts.push(() => [
      toolUse('t-save-2', TOOL.saveBagDetails, { name, roaster: null, origin: null, roastLevel: 'medium', process: null, notes: null }),
      toolUse('t-tpl-2', TOOL.proposeTemplates, {
        suggestions: [
          { templateId, confidence: 'high', reason: 'Fits.' },
          { templateId: templateId === 'd-flow' ? 'londonium' : 'd-flow', confidence: 'low', reason: 'Maybe.' },
        ],
      }),
    ]);
    await engine.sendText(`${name}, medium`);
    scripts.push(() => [text('Loaded.')]);
    await engine.pickTemplate('t-tpl-2', templateId);
    return engine.getState().activeBag!.id;
  }

  /** Pull a shot and report whether it was logged against the active version. */
  async function shotIsCredited(shotId: string): Promise<boolean> {
    const before = engine.getState().messages.length;
    scripts.push(() => [text('Got it.'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId, stopReason: 'targetWeight' });
    // Either a shot card (after its iteration was stored) or a warning arrives.
    await vi.waitFor(() => expect(engine.getState().messages.length).toBeGreaterThan(before));
    const credited = (await storage.iterations.listAll()).some((i) => i.shotId === shotId);
    if (credited) await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    else scripts.pop(); // the coach was not asked
    return credited;
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
    expect(parsed(lastUserTurn(requests)[0])).toEqual({ applied: true, variable: 'profile', version: 2, title: 'Kiambu AA v2', onMachine: true });

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

    // Adding the key answers the message that was waiting for it.
    storage.apiKey = 'sk-ant-test';
    scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
    await engine.refresh();
    expect(engine.getState().hasApiKey).toBe(true);
    expect(engine.getState().error).toBeNull();
    expect(requests).toHaveLength(1);
    expect(engine.getState().phase).toBe('choosing_template');
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

  it('reloads bags on refresh, e.g. after an import', async () => {
    await throughTemplatePick();
    const imported = { ...engine.getState().activeBag!, id: 'bag-imported', name: 'Imported bag', conversationId: 'conv-imported' };
    await storage.bags.put(imported);
    await engine.refresh();
    expect(engine.getState().bags.map((b) => b.id)).toContain('bag-imported');
    expect(engine.getState().activeBag?.name).toBe('Kiambu AA');
  });


  it('does not credit a shot that ran another profile, and offers to load the right one', async () => {
    await throughTemplatePick();
    machine.loaded = { ...baseProfile, title: 'Somebody else', target_weight: 99 };
    telemetry.emitShot({ type: 'finished', shotId: 'shot-x', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().error).toMatch(/not running Kiambu AA v1/));
    expect(await storage.iterations.listAll()).toHaveLength(0);
    const notice = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'notice' && p.tone === 'warning');
    expect(notice).toMatchObject({ text: expect.stringContaining('Somebody else') });
    await engine.retry();
    expect(machine.loaded.title).toBe('Kiambu AA v1');
    expect(engine.getState().error).toBeNull();
  });

  it('lets the user dismiss the load-problem banner', async () => {
    await throughTemplatePick();
    engine.dispose();
    engine = build();
    machine.loaded = { ...baseProfile, title: 'Picked in another skin', target_weight: 99 };
    await engine.start();
    await vi.waitFor(() => expect(engine.getState().error).toMatch(/Picked in another skin/));
    engine.dismissError();
    expect(engine.getState().error).toBeNull();
    scripts.push(() => [text('Noted.')]);
    await engine.sendText('Hello');
    expect(engine.getState().error).toBeNull();
  });

  it('says at start-up when the machine runs another profile, and loads the version only on Retry', async () => {
    await throughTemplatePick();
    engine.dispose();
    engine = build(); // a page load; the fake machine keeps running what it is told below
    machine.loaded = { ...baseProfile, title: 'Picked in another skin', target_weight: 99 };
    await engine.start();
    await vi.waitFor(() =>
      expect(engine.getState().error).toBe('The machine is running "Picked in another skin", not Kiambu AA v1. Tap Retry to load it.'),
    );
    expect(machine.loaded.title).toBe('Picked in another skin');
    await engine.retry();
    expect(machine.loaded.title).toBe('Kiambu AA v1');
    expect(engine.getState().error).toBeNull();
  });

  it('starts quietly when the machine already runs the active version', async () => {
    await throughTemplatePick();
    const v1 = machine.loaded;
    engine.dispose();
    engine = build();
    machine.loaded = v1;
    await engine.start();
    await engine.retry(); // runs after the queued start-up check
    expect(engine.getState().error).toBeNull();
    expect(engine.getState().activeVersion?.title).toBe('Kiambu AA v1');
  });

  it('remembers the new grinder setting after a confirmed grind change, here and in Decaid', async () => {
    await throughShot();
    scripts.push(() => [
      toolUse('t-grind', TOOL.proposeAdjustment, {
        variable: 'grind',
        lever: null,
        value: null,
        grind: { direction: 'finer', amount: 1, setting: '13' },
        summary: 'Grind 1 step finer, to 13',
        rationale: 'It ran fast.',
        expectedEffect: 'A slower, sweeter shot.',
        tips: [],
      }),
    ]);
    await engine.answerOptions('t-ask', ['Sour'], null);
    expect(engine.getState().phase).toBe('awaiting_confirmation');
    scripts.push(() => [text('Turn the dial, then pull another shot.')]);
    await engine.confirmChange('t-grind');
    expect((await storage.settings.get()).grinderSetting).toBe('13');
    const patches = apiCalls.filter((c) => c.method === 'updateWorkflow').map((c) => c.args[0]);
    expect(patches.at(-1)).toEqual({ context: { grinderSetting: '13' } });
    expect(engine.getState().activeVersion?.version).toBe(1);
  });

  it('confirms a grind move even when Decaid cannot take the new setting', async () => {
    await throughShot();
    scripts.push(() => [
      toolUse('t-grind', TOOL.proposeAdjustment, {
        variable: 'grind',
        lever: null,
        value: null,
        grind: { direction: 'coarser', amount: 1, setting: '15' },
        summary: 'Grind 1 step coarser, to 15',
        rationale: 'It ran slow.',
        expectedEffect: 'A faster, brighter shot.',
        tips: [],
      }),
    ]);
    await engine.answerOptions('t-ask', ['Bitter'], null);
    machine.failUpdates = 1;
    scripts.push(() => [text('Turn the dial, then pull another shot.')]);
    await engine.confirmChange('t-grind');
    expect(engine.getState().error).toBeNull();
    expect((await storage.settings.get()).grinderSetting).toBe('15');
    expect((await storage.iterations.listAll())[0]!.outcome).toBe('applied');
  });

  it('says when the machine dropped mid-shot, and Retry picks the shot up once Decaid has it', async () => {
    await throughTemplatePick();
    machine.missingShots.add('shot-lost');
    telemetry.setState({ machineConnected: false });
    telemetry.emitShot({ type: 'finished', shotId: 'shot-lost', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().error).toBe('Decaid has not saved that shot yet.'));
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ tone: 'warning', text: expect.stringContaining('disconnected during that shot') });
    // A doubling back-off: six requests, not a steady stream of 404s.
    expect(apiCalls.filter((c) => c.method === 'getShot')).toHaveLength(6);
    expect(await storage.iterations.listAll()).toHaveLength(0);

    machine.missingShots.delete('shot-lost');
    telemetry.setState({ machineConnected: true });
    scripts.push(() => [text('Got it.'), askTaste]);
    await engine.retry();
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    expect(engine.getState().error).toBeNull();
    expect((await storage.iterations.listAll()).map((i) => i.shotId)).toEqual(['shot-lost']);
  });

  it('tells the coach a version is saved but not on the machine while it is offline', async () => {
    telemetry.setState({ machineConnected: false });
    await throughTemplatePick();
    const result = requests
      .flat()
      .flatMap((m) => m.content)
      .find((b) => b.type === 'tool_result' && b.tool_use_id === 't-tpl');
    expect(parsed(result!)).toMatchObject({ uploaded: true, onMachine: false });
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ text: 'Saved Kiambu AA v1. Decaid loads it when the machine connects.' });
  });

  it('believes the machine when Decaid reports it refused the profile', async () => {
    const refusal = (timestamp: string) => ({
      kind: 'profileUploadFailed',
      severity: 'error',
      timestamp,
      deviceId: 'de1',
      deviceName: 'DE1',
      message: 'Could not upload the profile to the machine.',
      suggestion: null,
      details: null,
    });
    await throughTemplatePick();
    telemetry.setState({ connectionError: refusal('2026-10-03T08:01:00.000000') });
    await vi.waitFor(() => expect(engine.getState().error).toBe('The machine did not take Kiambu AA v1. Tap Retry to load it again.'));
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ tone: 'warning', text: expect.stringContaining('did not take Kiambu AA v1') });

    expect(await shotIsCredited('shot-refused')).toBe(false);
    await engine.retry(); // loads the version again
    expect(engine.getState().error).toBeNull();
    expect(await shotIsCredited('shot-loaded')).toBe(true);
  });

  it('ignores a refusal Decaid reported before CafAI started', async () => {
    await throughTemplatePick();
    engine.dispose();
    const v1 = machine.loaded;
    const context = machine.context;
    engine = build();
    machine.loaded = v1;
    machine.context = context;
    telemetry.setState({
      connectionError: {
        kind: 'profileUploadFailed',
        severity: 'error',
        timestamp: '2026-10-03T07:00:00.000000',
        deviceId: 'de1',
        deviceName: 'DE1',
        message: 'Could not upload the profile to the machine.',
        suggestion: null,
        details: null,
      },
    });
    await engine.start();
    await engine.retry(); // after the queued start-up check
    expect(engine.getState().error).toBeNull();
  });

  it('keeps the lost-shot Retry on the banner after the user talks to the coach', async () => {
    await throughTemplatePick();
    machine.missingShots.add('shot-lost');
    telemetry.emitShot({ type: 'finished', shotId: 'shot-lost', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().error).toBe('Decaid has not saved that shot yet.'));

    scripts.push(() => [text('Machines drop sometimes.')]);
    await engine.sendText('What happened?');
    expect(engine.getState().error).toBe('Decaid has not saved that shot yet.');

    machine.missingShots.delete('shot-lost');
    scripts.push(() => [text('Got it.'), askTaste]);
    await engine.retry();
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    expect(engine.getState().error).toBeNull();
    expect((await storage.iterations.listAll()).map((i) => i.shotId)).toEqual(['shot-lost']);
  });

  it('clears the missing-shot banner when the next shot arrives', async () => {
    await throughTemplatePick();
    machine.missingShots.add('shot-lost');
    telemetry.setState({ machineConnected: true });
    telemetry.emitShot({ type: 'finished', shotId: 'shot-lost', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().error).toBe('Decaid has not saved that shot yet.'));
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ text: expect.stringContaining('has not saved it') });

    scripts.push(() => [text('Got it.'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    expect(engine.getState().error).toBeNull();
    expect((await storage.iterations.listAll()).map((i) => i.shotId)).toEqual(['shot-2']);
  });

  it('loads the active version of a bag when the user switches back to it', async () => {
    await throughTemplatePick();
    const kiambu = engine.getState().activeBag!.id;
    await engine.newBag();
    scripts.push(() => [
      toolUse('t-save-b', TOOL.saveBagDetails, { name: 'Sumatra', roaster: null, origin: null, roastLevel: 'dark', process: null, notes: null }),
      toolUse('t-tpl-b', TOOL.proposeTemplates, {
        suggestions: [
          { templateId: 'londonium', confidence: 'high', reason: 'Dark.' },
          { templateId: 'd-flow', confidence: 'low', reason: 'Maybe.' },
        ],
      }),
    ]);
    await engine.sendText('Sumatra, dark');
    scripts.push(() => [text('Loaded.')]);
    await engine.pickTemplate('t-tpl-b', 'londonium');
    expect(machine.loaded.title).toBe('Sumatra v1');

    await engine.selectBag(kiambu);
    expect(machine.loaded.title).toBe('Kiambu AA v1');
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ text: 'Loaded Kiambu AA v1 on the machine.' });
  });

  it('tells the coach the grinder as last saved with every shot, and pushes a saved grinder to Decaid', async () => {
    await throughTemplatePick();
    const updatesBefore = apiCalls.filter((c) => c.method === 'updateWorkflow').length;
    await engine.refresh(); // nothing changed: no write
    expect(apiCalls.filter((c) => c.method === 'updateWorkflow')).toHaveLength(updatesBefore);

    await storage.settings.update({ grinderName: 'Niche Zero', grinderSetting: '13' });
    await engine.refresh();
    const patches = apiCalls.filter((c) => c.method === 'updateWorkflow').map((c) => c.args[0]);
    expect(patches.at(-1)).toEqual({ context: { grinderModel: 'Niche Zero', grinderSetting: '13' } });

    scripts.push(() => [text('Got it.'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId: 'shot-g', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    const shotEvent = requests
      .flat()
      .flatMap((m) => m.content)
      .find((b) => b.type === 'text' && b.text.startsWith('[event:shot_completed]'));
    const payload = JSON.parse((shotEvent as { text: string }).text.split('\n')[1]!);
    expect(payload.grinder).toEqual({ name: 'Niche Zero', setting: '13' });
  });

  it('keeps the bag on screen while a shot is pulled', async () => {
    await throughTemplatePick();
    const kiambu = engine.getState().activeBag!.id;
    const sumatra = await anotherBag('Sumatra', 'londonium');
    telemetry.setState({
      shotState: {
        event: 'state',
        timestamp: '2026-10-03T08:00:00.000000',
        shotId: 'shot-live',
        state: 'pouring',
        machineState: null,
        machineSubstate: null,
        profileFrame: null,
        scaleConnected: true,
        scaleLost: false,
        machineHasAutonomousSAW: false,
        decision: null,
      },
    });
    await engine.selectBag(kiambu);
    expect(engine.getState().activeBag!.id).toBe(sumatra);
    expect(engine.getState().error).toBe('Finish the shot first, then switch bags.');
    await engine.newBag();
    expect(engine.getState().activeBag!.id).toBe(sumatra);
  });

  it('tags every activation with the CafAI version it loads', async () => {
    await throughTemplatePick();
    const version = engine.getState().activeVersion!;
    const context = apiCalls.filter((c) => c.method === 'activateProfile').at(-1)!.args[1] as WorkflowContext;
    expect(context.extras).toEqual({ cafai: { versionId: version.id, bagId: engine.getState().activeBag!.id } });
  });

  it('does not credit a shot to a same-named bag whose load failed', async () => {
    await throughTemplatePick(); // "Kiambu AA" v1 from d-flow
    const first = engine.getState().activeBag!.id;
    const second = await anotherBag('Kiambu AA', 'londonium');
    await engine.selectBag(first);
    machine.failActivations = 1;
    await engine.selectBag(second); // the machine keeps the first bag's "Kiambu AA v1"
    expect(machine.loaded.target_weight).toBe(50);
    expect(await shotIsCredited('shot-same-name')).toBe(false);
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ tone: 'warning', text: expect.stringContaining('not part of this dial-in') });
  });

  it('does not credit a shot to a bag with the same brewing content whose load failed', async () => {
    await throughTemplatePick(); // Kiambu AA v1 from d-flow
    const kiambu = engine.getState().activeBag!.id;
    const yirga = await anotherBag('Yirgacheffe Konga', 'd-flow');
    await engine.selectBag(kiambu);
    machine.failActivations = 1;
    await engine.selectBag(yirga);
    expect(machine.loaded.title).toBe('Kiambu AA v1');
    expect(await shotIsCredited('shot-same-content')).toBe(false);
  });

  it('loads the selected bag even when another bag has the same name and the same content', async () => {
    await throughTemplatePick();
    const first = engine.getState().activeBag!.id;
    const second = await anotherBag('Kiambu AA', 'd-flow');
    const secondVersion = engine.getState().activeVersion!.id;
    await engine.selectBag(first);
    await engine.selectBag(second);
    expect(taggedId()).toBe(secondVersion);
    expect(await shotIsCredited('shot-twin')).toBe(true);
  });

  it('credits a shot of identical content loaded by another skin, but not a different profile', async () => {
    await throughTemplatePick();
    // Another skin loads the stock template: same brewing content, CafAI's tag stays.
    machine.loaded = { ...baseProfile, title: 'D-Flow / default' };
    expect(await shotIsCredited('shot-stock')).toBe(true);
    machine.loaded = { ...baseProfile, title: 'Something else', target_weight: 77 };
    expect(await shotIsCredited('shot-other')).toBe(false);
  });

  it('reloads a bag whose v1 has the same brewing content as the other bag, so its title and coffee win', async () => {
    await throughTemplatePick(); // Kiambu AA v1 from d-flow
    const kiambu = engine.getState().activeBag!.id;
    await engine.newBag();
    scripts.push(() => [
      toolUse('t-save-b', TOOL.saveBagDetails, { name: 'Sumatra', roaster: null, origin: null, roastLevel: 'medium', process: null, notes: null }),
      toolUse('t-tpl-b', TOOL.proposeTemplates, {
        suggestions: [
          { templateId: 'd-flow', confidence: 'high', reason: 'Balanced.' },
          { templateId: 'londonium', confidence: 'low', reason: 'Heavier.' },
        ],
      }),
    ]);
    await engine.sendText('Sumatra, medium');
    scripts.push(() => [text('Loaded.')]);
    await engine.pickTemplate('t-tpl-b', 'd-flow');
    expect(machine.loaded.title).toBe('Sumatra v1');

    const before = apiCalls.filter((c) => c.method === 'activateProfile').length;
    await engine.selectBag(kiambu);
    const activations = apiCalls.filter((c) => c.method === 'activateProfile');
    expect(activations).toHaveLength(before + 1);
    expect(machine.loaded.title).toBe('Kiambu AA v1');
    expect(activations.at(-1)!.args[1]).toMatchObject({ coffeeName: 'Kiambu AA' });
  });

  it('closes the taste chips and keeps the typed answer as feedback when the user types', async () => {
    await throughShot();
    scripts.push(() => [text('Noted.')]);
    await engine.sendText('Quite sour and thin');
    const options = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'options');
    expect(options).toMatchObject({ expired: true });
    expect((await storage.iterations.listAll())[0]!.feedback).toEqual({
      question: 'How did it taste?',
      selected: [],
      otherText: 'Quite sour and thin',
    });
  });

  it('asks for starting profiles, not the bag details again, once the suggestions were set aside', async () => {
    await engine.newBag();
    scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    scripts.push(() => [text('Blooming is the sweetest of them.')]);
    await engine.sendText('Which is sweetest?');
    expect(engine.getState().activeVersion).toBeNull();
    expect(engine.getState().phase).toBe('idle');
  });

  it('closes template cards and change cards that were answered by typing', async () => {
    await throughProposal();
    scripts.push(() => [text('Sure, ask away.')]);
    await engine.sendText('Why temperature and not grind?');
    const diff = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'diff');
    expect(diff).toMatchObject({ status: 'expired' });
    const templates = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'templates');
    expect(templates).toMatchObject({ pickedTemplateId: 'd-flow' });
  });

  it('keeps a change open when loading it fails, so Confirm can be tapped again', async () => {
    await throughProposal();
    machine.failActivations = 1;
    await engine.confirmChange('t-adj');
    let diff = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'diff');
    expect(diff).toMatchObject({ status: 'pending', error: 'Decaid said no.' });
    expect(engine.getState().error).toMatch(/not loaded/);
    expect(engine.getState().activeVersion?.version).toBe(1);

    scripts.push(() => [text('Done.')]);
    await engine.retry();
    diff = engine.getState().messages.flatMap((m) => m.parts).find((p) => p.kind === 'diff');
    expect(diff).toMatchObject({ status: 'applied' });
    expect(engine.getState().activeVersion?.version).toBe(2);
  });

  it('reuses an untouched new bag instead of creating another', async () => {
    await engine.newBag();
    await engine.newBag();
    expect(engine.getState().bags).toHaveLength(1);
  });

  it('marks an unanswered iteration superseded when the next shot arrives', async () => {
    await throughShot();
    scripts.push(() => [text('Again?'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
    await vi.waitFor(async () => expect(await storage.iterations.listAll()).toHaveLength(2));
    const [first, second] = await storage.iterations.listAll();
    expect(first!.outcome).toBe('superseded');
    expect(second!.outcome).toBe('pending');
  });

  it('clears details of the previous coffee from the workflow context', async () => {
    await throughTemplatePick();
    const context = apiCalls.find((c) => c.method === 'activateProfile')!.args[1] as Record<string, unknown>;
    expect(context).toMatchObject({ beanBatchId: null, grinderId: null, coffeeName: 'Kiambu AA' });
  });

  it('never sends the API key anywhere the UI can see', async () => {
    await throughProposal();
    const visible = JSON.stringify(engine.getState());
    expect(visible).not.toContain('sk-ant-test');
    const stored = JSON.stringify(await storage.porter.exportAll());
    expect(stored).not.toContain('sk-ant-test');
  });
});

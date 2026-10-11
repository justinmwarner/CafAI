import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { createCoachEngine, type CoachEngine, type EngineDeps, type PageVisibility } from './engine.ts';
import type { OutboxTimers } from './outbox.ts';
import type { ApiPort, ChangePlan, CoachPort, LlmPort, ProposalContext } from './ports.ts';
import { message, NEW_BAG_PROMPT, progressNoticePart } from './uiMessages.ts';
import { OTHER_OPTION, TOOL, type ProposeAdjustment } from '../../coach/contract.ts';
import { DOSE_RULES, knownDose, REFERENCE_DOSE_G } from '../../coach/dose.ts';
import { roastLine } from '../../coach/prompt.ts';
import { createShotSource, runQueryTool } from '../../coach/queries.ts';
import { proposalWordingError, validateProposal as validateWithCoach } from '../../coach/validator.ts';
import type { GrinderInfo, ProfileJson, ShotSummary, Template } from '../../coach/types.ts';
import type { MachineProfileStatus } from '../../api/machineProfile.ts';
import { driftLog } from '../../api/drift.ts';
import { PLUGIN } from '../../api/plugins.ts';
import type { BagPhoto, ExtractedBag } from '../../llm/extractBag.ts';
import {
  GatewayError,
  type Bean,
  type BeanBatch,
  type EnjoymentScale,
  type ShotAnnotations,
  type ShotRecord,
  type WireProfile,
  type Workflow,
  type WorkflowContext,
} from '../../api/types.ts';
import { LlmError, type ContentBlock, type LlmMessage, type PendingUiCall, type RunResult, type ToolResultBlock } from '../../llm/types.ts';
import type { Bag } from '../../storage/types.ts';
import type { CoachUiPart } from '../types.ts';
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

// D-Flow starts at the author's 1:2.8 (D57); the fake Londonium has no ratio, so v1 keeps its stop at 18 g.
const TEMPLATES = [
  { ...makeTemplate('d-flow', 'D-Flow'), startRatio: 2.8 },
  makeTemplate('londonium', 'Londonium', { ...baseProfile, target_weight: 42 }),
];

/** v1's ratio as the coach works it out: the author's, else the template's own stop at the 18 g reference dose. */
const startRatio = (template: Template) => template.startRatio ?? (template.profile.target_weight ?? 36) / REFERENCE_DOSE_G;

const NICHE: GrinderInfo = { model: 'Niche Zero', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null };
const ENCORE: GrinderInfo = {
  model: 'Baratza Encore ESP',
  settingType: 'preset',
  smallStep: null,
  bigStep: null,
  values: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
};

/** What the engine handed the coach with the last proposal it had checked. */
let lastProposalContext: ProposalContext | null = null;

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
    lastProposalContext = context;
    // Grind moves need no lever: the coach's own validator works them out on Decaid's grinder (D62).
    if (input.variable === 'grind') return validateWithCoach(input, context);
    if (input.variable === 'profile') {
      if (input.lever !== 'temp' || input.value === null) return { ok: false, errors: ['Only temp exists here.'] };
      if (Math.abs(input.value - context.profile.steps[0]!.temperature) > 2) {
        return { ok: false, errors: ['temp: at most 2.0 °C per step.'] };
      }
    }
    return { ok: true, plan: plan(input, context.profile) };
  },
  // The coach's own check (D127): a fresh expectedEffect that names a taste goes back to the model.
  proposalWordingError,
  summarizeShot: () => summary,
  versionTitle: (name, n) => `${name} v${n}`,
  buildVersionProfile: (_t, base, title) => ({ ...base, title }),
  buildStartingProfile: (template, doseG) => ({
    ...template.profile,
    target_weight: Math.round(startRatio(template) * (knownDose(doseG) ?? REFERENCE_DOSE_G)),
  }),
  knownDose,
  referenceDoseG: REFERENCE_DOSE_G,
  doseRange: { min: DOSE_RULES.min, max: DOSE_RULES.max },
  profileId: (p) => `id:${JSON.stringify((p as ProfileJson).steps)}:${(p as ProfileJson).target_weight}`,
  withOther: (options) => [...options.filter((o) => o.toLowerCase() !== 'other'), OTHER_OPTION],
  roastLine,
  async runQuery(name, input, context) {
    if (name === TOOL.getBagHistory) return { content: JSON.stringify({ versions: context.versions.length }), isError: false };
    // DYE2's setups are the coach's own query over what the engine read (6.5).
    if (name === TOOL.getRecentSetups) return runQueryTool(name, input, { ...context, source: createShotSource([]) });
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

/** How POST /machine/profile answers: a status, an error, or 'hold' until the test answers through `machine.held`. */
type BarrierAnswer = MachineProfileStatus | Error | 'hold';

const machine = {
  loaded: SAMPLE_WORKFLOW.profile as ProfileJson,
  /** The workflow context as Decaid keeps it: merged field by field, extras key by key. */
  context: { ...SAMPLE_WORKFLOW.context } as WorkflowContext,
  failActivations: 0,
  failUpdates: 0,
  missingShots: new Set<string>(),
  /** Shots Decaid saves late: how many more GETs answer 404. */
  shotMisses: new Map<string, number>(),
  /** The profile as the last workflow PUT answered it (a copy, as over the wire). */
  returned: null as WireProfile | null,
  barrier: 'loaded' as BarrierAnswer,
  held: null as { resolve(answer: MachineProfileStatus): void; reject(error: Error): void } | null,
  /** Shot annotations as Decaid keeps them: deep-merged, notes replaced. */
  annotations: new Map<string, ShotAnnotations>(),
  failShotUpdates: 0,
  /** How many more GET /workflow calls fail. */
  failWorkflowReads: 0,
  /** Decaid's grinder library, by id (D62). */
  grinders: new Map<string, GrinderInfo>(),
  /** How many more grinder reads fail. */
  failGrinderReads: 0,
  /** Grinder reads wait until the test calls `releaseGrinderReads()`. */
  holdGrinderReads: false,
  heldGrinderReads: [] as Array<() => void>,
  /** Every grinder read so far, so a test can wait until the engine has its answer. */
  grinderReads: [] as Array<Promise<unknown>>,
  /** POST /profiles answers 400 for any parent (a Decaid without the template's bundled default). */
  parentMissing: false,
  /** POST /profiles answers with a record Decaid already had (the same content). */
  dedupe: false,
  /** The next POST /profiles fails with this error. */
  createError: null as Error | null,
  /**
   * Whether this Decaid has the bean library (D102). Off by default, as on a
   * Decaid without the routes, so other tests never see CafAI add a bag to it.
   */
  beanLibrary: false,
  /** Decaid's bean library: beans and their batches. */
  beans: [] as Bean[],
  batches: [] as BeanBatch[],
  /** How many more bean library calls fail as if Decaid were away. */
  failBeanCalls: 0,
  /** Bean library calls wait until the test calls `releaseBeanCalls()`. */
  holdBeanCalls: false,
  heldBeanCalls: [] as Array<() => void>,
  /** The next PUT /workflow is refused with this error. */
  workflowRefusal: null as GatewayError | null,
  /** What Decaid's rating scale probe answers (D101): 10, 100, null when it could not be asked, or something that tells neither. */
  enjoymentScale: 10 as EnjoymentScale | null | 'unreadable',
  /** The next PUT /shots/{id} is refused with this error. */
  shotRefusal: null as GatewayError | null,
  /** Shot records come back without the profile in their workflow (5.10). */
  recordsWithoutProfile: false,
  /** GET /shots/{id} answers something CafAI cannot read. */
  unreadableRecords: false,
  /**
   * Decaid's key-value store as the plugins left it (D103), by
   * "namespace/key"; a function answers each read anew (and may throw, as
   * when Decaid is away).
   */
  store: new Map<string, unknown>(),
  /** A loaded plugin's endpoint replies, by "pluginId/endpoint"; an Error fails the call. */
  pluginEndpoints: new Map<string, unknown>(),
};

/** The coach's model reading a photo of a bag (6.8): what it was asked, and what it answers. */
const reader = {
  asked: [] as Array<{ model: string; photo: BagPhoto }>,
  answer: null as ExtractedBag | Error | null,
};

/** How the real client fails when Decaid does not answer. */
const unreachable = (path: string) => new GatewayError(0, path, 'Decaid is not reachable.', 'network');

function releaseGrinderReads(): void {
  machine.holdGrinderReads = false;
  for (const release of machine.heldGrinderReads.splice(0)) release();
}

function releaseBeanCalls(): void {
  machine.holdBeanCalls = false;
  for (const release of machine.heldBeanCalls.splice(0)) release();
}

function mergeContext(base: WorkflowContext, patch: WorkflowContext): WorkflowContext {
  return { ...base, ...patch, extras: { ...base.extras, ...patch.extras } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decaid's PUT /shots/{id}: maps merge recursively, everything else is replaced. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return result;
}

function makeApi(calls: ApiCall[]): ApiPort {
  let ids = 0;
  // Like the machine: a shot runs whatever profile was activated last.
  machine.loaded = SAMPLE_WORKFLOW.profile as ProfileJson;
  machine.context = { ...SAMPLE_WORKFLOW.context } as WorkflowContext;
  machine.failActivations = 0;
  machine.failUpdates = 0;
  machine.missingShots.clear();
  machine.shotMisses.clear();
  machine.returned = null;
  machine.barrier = 'loaded';
  machine.held = null;
  machine.annotations.clear();
  machine.failShotUpdates = 0;
  machine.failWorkflowReads = 0;
  machine.grinders.clear();
  machine.failGrinderReads = 0;
  machine.holdGrinderReads = false;
  machine.heldGrinderReads = [];
  machine.grinderReads = [];
  machine.parentMissing = false;
  machine.dedupe = false;
  machine.createError = null;
  machine.beanLibrary = false;
  machine.beans = [];
  machine.batches = [];
  machine.failBeanCalls = 0;
  machine.holdBeanCalls = false;
  machine.heldBeanCalls = [];
  machine.workflowRefusal = null;
  machine.enjoymentScale = 10;
  machine.shotRefusal = null;
  machine.recordsWithoutProfile = false;
  machine.unreadableRecords = false;
  machine.store = new Map();
  machine.pluginEndpoints = new Map();
  const shotRecord = (id: string) => {
    const workflow: Record<string, unknown> = { ...SAMPLE_WORKFLOW, profile: machine.loaded, context: machine.context };
    if (machine.recordsWithoutProfile) delete workflow.profile;
    const annotations = machine.annotations.get(id);
    return { id, timestamp: '', createdAt: '', updatedAt: '', workflow, measurements: [], ...(annotations ? { annotations } : {}) } as unknown as ShotRecord;
  };
  /** A bean library call: 404 without the library, fails while Decaid is away, else answers. */
  const beanCall = async <T>(method: string, args: unknown[], answer: () => T): Promise<T> => {
    calls.push({ method, args });
    if (machine.holdBeanCalls) await new Promise<void>((resolve) => machine.heldBeanCalls.push(resolve));
    if (!machine.beanLibrary) throw new GatewayError(404, '/api/v1/beans', 'Route not found', 'http');
    if (machine.failBeanCalls > 0) {
      machine.failBeanCalls -= 1;
      throw unreachable('/api/v1/beans');
    }
    return answer();
  };
  return {
    getWorkflow: async () => {
      calls.push({ method: 'getWorkflow', args: [] });
      if (machine.failWorkflowReads > 0) {
        machine.failWorkflowReads -= 1;
        throw unreachable('/api/v1/workflow');
      }
      return { ...SAMPLE_WORKFLOW, profile: machine.loaded, context: machine.context } as Workflow;
    },
    listBeans: () => beanCall('listBeans', [], () => machine.beans.filter((bean) => bean.archived !== true)),
    // Archived batches too: CafAI must leave them out itself.
    listBatches: (beanId) => beanCall('listBatches', [beanId], () => machine.batches.filter((batch) => batch.beanId === beanId)),
    listAllBatches: (options) =>
      beanCall('listAllBatches', [options], () => machine.batches.filter((batch) => options?.includeArchived === true || batch.archived !== true)),
    readStore: async (namespace, key) => {
      calls.push({ method: 'readStore', args: [namespace, key] });
      const value = machine.store.get(`${namespace}/${key}`);
      return typeof value === 'function' ? (value as () => unknown)() : (value ?? null);
    },
    getPluginEndpoint: async (pluginId, endpoint) => {
      calls.push({ method: 'getPluginEndpoint', args: [pluginId, endpoint] });
      const reply = machine.pluginEndpoints.get(`${pluginId}/${endpoint}`);
      if (reply instanceof Error) throw reply;
      return reply ?? null;
    },
    createBean: (request) =>
      beanCall('createBean', [request], () => {
        const bean: Bean = { id: `bean-${machine.beans.length + 1}`, archived: false, ...request };
        machine.beans.push(bean);
        return bean;
      }),
    createBatch: (beanId, request) =>
      beanCall('createBatch', [beanId, request], () => {
        const batch: BeanBatch = { id: `batch-${machine.batches.length + 1}`, beanId, frozen: false, archived: false, ...request };
        machine.batches.push(batch);
        return batch;
      }),
    probeEnjoymentScale: async () => {
      calls.push({ method: 'probeEnjoymentScale', args: [] });
      if (machine.enjoymentScale === 'unreadable') {
        throw new GatewayError(200, '/api/v1/shots/cafai-probe', "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply');
      }
      return machine.enjoymentScale;
    },
    getGrinder: (id) => {
      calls.push({ method: 'getGrinder', args: [id] });
      const read = (async () => {
        if (machine.holdGrinderReads) await new Promise<void>((resolve) => machine.heldGrinderReads.push(resolve));
        if (machine.failGrinderReads > 0) {
          machine.failGrinderReads -= 1;
          throw new GatewayError(0, `/api/v1/grinders/${id}`, 'Could not reach Decaid.', 'network');
        }
        return machine.grinders.get(id) ?? null;
      })();
      machine.grinderReads.push(read);
      return read;
    },
    updateWorkflow: async (patch) => {
      if (machine.failUpdates > 0) {
        machine.failUpdates -= 1;
        throw unreachable('/api/v1/workflow');
      }
      if (machine.workflowRefusal) {
        const refusal = machine.workflowRefusal;
        machine.workflowRefusal = null;
        calls.push({ method: 'updateWorkflow (refused)', args: [patch] });
        throw refusal;
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
      machine.returned = { ...profile };
      return { ...SAMPLE_WORKFLOW, profile: machine.returned } as Workflow;
    },
    loadProfileOnMachine: async (profile) => {
      calls.push({ method: 'loadProfileOnMachine', args: [profile] });
      const answer = machine.barrier;
      if (answer === 'hold') {
        return new Promise<MachineProfileStatus>((resolve, reject) => {
          machine.held = { resolve, reject };
        });
      }
      if (answer instanceof Error) throw answer;
      return answer;
    },
    updateShot: async (id, patch) => {
      if (machine.failShotUpdates > 0) {
        machine.failShotUpdates -= 1;
        throw unreachable(`/api/v1/shots/${id}`);
      }
      if (machine.shotRefusal) {
        const refusal = machine.shotRefusal;
        machine.shotRefusal = null;
        calls.push({ method: 'updateShot (refused)', args: [id, patch] });
        throw refusal;
      }
      calls.push({ method: 'updateShot', args: [id, patch] });
      const merged = deepMerge((machine.annotations.get(id) ?? {}) as Record<string, unknown>, (patch.annotations ?? {}) as Record<string, unknown>);
      machine.annotations.set(id, merged as ShotAnnotations);
      return shotRecord(id);
    },
    createProfileVersion: async (request) => {
      calls.push({ method: 'createProfileVersion', args: [request] });
      if (machine.createError) {
        const error = machine.createError;
        machine.createError = null;
        throw error;
      }
      if (request.parentId !== undefined && machine.parentMissing) {
        throw new GatewayError(400, '/api/v1/profiles', `Invalid argument(s): Parent profile not found: ${request.parentId}`);
      }
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
        deduped: machine.dedupe,
      };
    },
    getShot: async (id) => {
      calls.push({ method: 'getShot', args: [id] });
      if (machine.unreadableRecords) {
        throw new GatewayError(200, `/api/v1/shots/${id}`, "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply');
      }
      if (machine.missingShots.has(id)) throw new GatewayError(404, `/api/v1/shots/${id}`, 'Shot not found', 'http');
      const misses = machine.shotMisses.get(id) ?? 0;
      if (misses > 0) {
        machine.shotMisses.set(id, misses - 1);
        throw new GatewayError(404, `/api/v1/shots/${id}`, 'Shot not found', 'http');
      }
      return shotRecord(id);
    },
    getLatestShot: async () => null,
  };
}

/** Timers the test fires by hand (the outbox's 30 s retry). */
function manualTimers() {
  const scheduled = new Map<number, () => void>();
  const delays = new Map<number, number>();
  let next = 0;
  const timers: OutboxTimers = {
    setTimeout(callback, ms) {
      next += 1;
      scheduled.set(next, callback);
      delays.set(next, ms);
      return next;
    },
    clearTimeout(handle) {
      scheduled.delete(handle as number);
      delays.delete(handle as number);
    },
  };
  return {
    timers,
    delays: () => [...delays.values()],
    fire() {
      const due = [...scheduled.values()];
      scheduled.clear();
      delays.clear();
      for (const callback of due) callback();
    },
  };
}

/** Whether the page is in view, as the test sets it; hide() and show() tell the engine, like visibilitychange. */
function fakeVisibility() {
  let visible = true;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    visible = next;
    for (const listener of [...listeners]) listener();
  };
  const visibility: PageVisibility = {
    visible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { visibility, hide: () => set(false), show: () => set(true), listeners: () => listeners.size };
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
    async readBag(request) {
      reader.asked.push(request);
      if (reader.answer instanceof Error) throw reader.answer;
      if (!reader.answer) throw new Error('No photo answer scripted');
      return reader.answer;
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
            results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
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
  expectedEffect: 'More extraction at the same flow.',
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
  let timers: ReturnType<typeof manualTimers>;
  /** The machine check's 30 s beat, fired by hand. */
  let checks: ReturnType<typeof manualTimers>;
  let view: ReturnType<typeof fakeVisibility>;
  /** The engine's clock: tests move it on to space events apart. */
  let nowMs: number;
  /** Decaid's plugins that are running (D103). None by default. */
  let loadedPlugins: Set<string>;

  function build(extra: Partial<EngineDeps> = {}): CoachEngine {
    let counter = 0;
    return createCoachEngine({
      storage,
      telemetry,
      api: makeApi(apiCalls),
      coach,
      llm: makeLlm(scripts, requests),
      clock: { now: () => new Date(nowMs), sleep: async () => {} },
      newId: (prefix) => `${prefix}-${++counter}-${Math.random().toString(16).slice(2, 6)}`,
      timers: timers.timers,
      checkTimers: checks.timers,
      visibility: view.visibility,
      plugins: { isLoaded: (id) => loadedPlugins.has(id) },
      ...extra,
    });
  }

  beforeEach(async () => {
    storage = createFakeStorage();
    storage.apiKey = 'sk-ant-test';
    telemetry = createFakeTelemetry();
    apiCalls = [];
    requests = [];
    scripts = [];
    timers = manualTimers();
    checks = manualTimers();
    view = fakeVisibility();
    nowMs = Date.parse('2026-10-03T08:00:00Z');
    loadedPlugins = new Set();
    reader.asked = [];
    reader.answer = null;
    engine = build();
    await engine.start();
  });

  afterEach(() => {
    engine.dispose();
  });

  const allParts = (): CoachUiPart[] => engine.getState().messages.flatMap((m) => m.parts);
  const notices = () => allParts().filter((p): p is Extract<CoachUiPart, { kind: 'notice' }> => p.kind === 'notice');
  const progressNotices = () => notices().filter((p) => p.progress !== undefined);
  const callsOf = (method: string) => apiCalls.filter((c) => c.method === method);
  /** Let everything already queued in the engine run: a tap on a card that does not exist queues behind it and does nothing. */
  const drain = () => engine.declineChange('no-such-card');
  /** A new bag, with its bean card's read of Decaid's library done (in the background, landing in turn). */
  const openBag = async () => {
    await engine.newBag();
    await vi.waitFor(() => expect(allParts().some((p) => p.kind === 'beanPicker' && p.loading === true)).toBe(false));
    await drain();
  };

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
    telemetry.emitShot({ type: 'started', shotId });
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

  it('starts a bag with the bean card, then the placeholder question, and sends the intake turn with context', async () => {
    await engine.newBag();
    const [card, question] = engine.getState().messages;
    expect(card).toMatchObject({ role: 'assistant', parts: [{ kind: 'beanPicker', choice: null }] });
    expect(question).toMatchObject({ role: 'assistant', parts: [{ kind: 'text', text: NEW_BAG_PROMPT }] });

    scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    const intake = requests[0]![0]!.content;
    expect(intake[0]).toEqual({ type: 'text', text: 'Kiambu AA, light, washed' });
    expect(intake[1]).toMatchObject({ type: 'text' });
    expect((intake[1] as { text: string }).text).toMatch(/^\[context\]\n\{"grinder"/);
    // Described in the chat: nothing came from Decaid's library or a photo, and no roast date is known yet;
    // today's date, on this device's calendar, for a roast date said in words.
    const local = new Date(nowMs);
    const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(JSON.parse((intake[1] as { text: string }).text.split('\n')[1]!)).toMatchObject({ bag: null, roast: null, today });

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

  it('records a version in Decaid’s library only after the machine took it', async () => {
    await throughProposal();
    const creates = () => apiCalls.filter((c) => c.method === 'createProfileVersion').length;
    const before = creates();
    machine.failActivations = 1;
    await engine.confirmChange('t-adj');
    expect(engine.getState().error).toMatch(/The change was not loaded/);
    expect(creates()).toBe(before);

    scripts.push(() => [text('Done.')]);
    await engine.retry();
    expect(creates()).toBe(before + 1);
    expect(engine.getState().activeVersion?.title).toBe('Kiambu AA v2');
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
    expect(parsed(lastUserTurn(requests)[0])).toEqual({
      applied: true,
      variable: 'profile',
      version: 2,
      title: 'Kiambu AA v2',
      onMachine: true,
      loadError: null,
    });

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

  describe('expectedEffect is mechanics, never a taste (D127)', () => {
    const proposal = (id: string, expectedEffect: string) =>
      toolUse(id, TOOL.proposeAdjustment, { ...(proposeTemp as { input: Record<string, unknown> }).input, expectedEffect });

    it('sends a fresh change that promises a taste back to the coach, and shows the one it writes instead', async () => {
      await throughShot();
      scripts.push(() => [proposal('t-adj', 'Sweeter, less sharp.')]);
      scripts.push(() => [proposal('t-adj-2', 'More extraction at the same flow.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);

      // The first went back as an error naming the word, inside the same run; the second is the card.
      expect(lastUserTurn(requests)[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 't-adj',
        is_error: true,
        content: expect.stringContaining('expectedEffect names a taste ("Sweeter")'),
      });
      const diffs = allParts().filter((p) => p.kind === 'diff');
      expect(diffs).toEqual([expect.objectContaining({ requestId: 't-adj-2', status: 'pending', expectedEffect: 'More extraction at the same flow.' })]);
      expect(engine.getState().phase).toBe('awaiting_confirmation');
    });

    it('names a wrong number and a taste in one correction, so one retry fixes both', async () => {
      await throughShot();
      const both = toolUse('t-adj', TOOL.proposeAdjustment, {
        ...(proposeTemp as { input: Record<string, unknown> }).input,
        value: 93,
        expectedEffect: 'A rounder cup.',
      });
      scripts.push(() => [both]);
      scripts.push(() => [proposal('t-adj-2', 'More extraction at the same flow.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      const correction = lastUserTurn(requests)[0] as Extract<ContentBlock, { type: 'tool_result' }>;
      expect(correction).toMatchObject({ tool_use_id: 't-adj', is_error: true });
      expect(correction.content).toContain('temp: at most 2.0 °C per step.');
      expect(correction.content).toContain('expectedEffect names a taste ("rounder")');
      expect(allParts().filter((p) => p.kind === 'diff')).toEqual([expect.objectContaining({ requestId: 't-adj-2' })]);
    });

    it('keeps a stored change usable after a reload, whatever its wording: its card already shows it', async () => {
      await throughProposal();
      // The transcript of an older build, whose change promised a taste.
      const stored = (await storage.conversations.get(engine.getState().activeBag!.conversationId))!;
      const apiMessages = stored.apiMessages.map((m) => ({
        ...m,
        content: m.content.map((b) =>
          b.type === 'tool_use' && b.id === 't-adj' ? { ...b, input: { ...(b.input as object), expectedEffect: 'Sweeter, less sharp.' } } : b,
        ),
      }));
      await storage.conversations.put({ ...stored, apiMessages });
      engine.dispose();
      engine = build();
      await engine.start();
      expect(engine.getState().phase).toBe('awaiting_confirmation');

      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(engine.getState().activeVersion?.title).toBe('Kiambu AA v2');
    });
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
        expectedEffect: 'A slower shot that extracts a little more.',
        tips: [],
      }),
    ]);
    await engine.answerOptions('t-ask', ['Sour'], null);
    expect(engine.getState().phase).toBe('awaiting_confirmation');
    scripts.push(() => [text('Turn the dial, then pull another shot.')]);
    await engine.confirmChange('t-grind');
    expect((await storage.settings.get()).grinderSetting).toBe('13');
    const patches = apiCalls.filter((c) => c.method === 'updateWorkflow').map((c) => c.args[0]);
    // The whole grinder as last saved: one write per key, the latest wins (D64).
    expect(patches.at(-1)).toEqual({ context: { grinderId: null, grinderModel: null, grinderSetting: '13', grinderBurrs: null } });
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
        expectedEffect: 'A faster shot that extracts a little less.',
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
    expect(parsed(result!)).toMatchObject({ uploaded: true, onMachine: false, loadError: null });
    const notices = engine.getState().messages.flatMap((m) => m.parts).filter((p) => p.kind === 'notice');
    expect(notices.at(-1)).toMatchObject({ text: 'Saved Kiambu AA v1. Decaid loads it when the machine connects.' });
    // No machine to wait for: Decaid's barrier is not asked.
    expect(callsOf('loadProfileOnMachine')).toHaveLength(0);
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
    expect(patches.at(-1)).toEqual({ context: { grinderId: null, grinderModel: 'Niche Zero', grinderSetting: '13', grinderBurrs: null } });

    scripts.push(() => [text('Got it.'), askTaste]);
    telemetry.emitShot({ type: 'finished', shotId: 'shot-g', stopReason: 'targetWeight' });
    await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    const shotEvent = requests
      .flat()
      .flatMap((m) => m.content)
      .find((b) => b.type === 'text' && b.text.startsWith('[event:shot_completed]'));
    const payload = JSON.parse((shotEvent as { text: string }).text.split('\n')[1]!);
    // Typed in Settings, not linked to Decaid's grinder library: no steps to tell.
    expect(payload.grinder).toEqual({ name: 'Niche Zero', setting: '13', settingType: null, step: null, values: null, linked: false });
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
    expect(options).toMatchObject({ expired: true, setAsideReason: 'typed' });
    expect((await storage.iterations.listAll())[0]!.feedback).toEqual({
      question: 'How did it taste?',
      selected: [],
      otherText: 'Quite sour and thin',
    });
  });

  it('takes a pasted API key out before anything sees it', async () => {
    await engine.newBag();
    scripts.push(() => [
      text('Lovely.'),
      toolUse('t-save', TOOL.saveBagDetails, {
        name: 'sk-ant-api03-pasted-key-1234567890',
        roaster: null,
        origin: null,
        roastLevel: null,
        process: null,
        notes: 'from sk-ant-api03-pasted-key-1234567890',
      }),
      proposeTemplates,
    ]);
    await engine.sendText('sk-ant-api03-pasted-key-1234567890');
    const sent = JSON.stringify(requests.at(-1));
    expect(sent).not.toContain('sk-ant-');
    expect(sent).toContain('[API key removed]');
    const shown = JSON.stringify(engine.getState().messages);
    expect(shown).not.toContain('sk-ant-');
    expect(shown).toContain('That looked like an API key');
    // Even if a model put one into the bag details, it never becomes the bag name.
    expect(engine.getState().activeBag).toMatchObject({ name: 'key removed', notes: 'from key removed' });
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
    expect(diff).toMatchObject({ status: 'expired', setAsideReason: 'typed' });
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

  it("clears details of the previous coffee from the workflow context, another skin's grinder burrs too (5.2)", async () => {
    await throughTemplatePick();
    const context = apiCalls.find((c) => c.method === 'activateProfile')!.args[1] as Record<string, unknown>;
    expect(context).toMatchObject({
      beanBatchId: null,
      grinderId: null,
      grinderModel: null,
      grinderSetting: null,
      grinderBurrs: null,
      coffeeName: 'Kiambu AA',
      coffeeRoaster: 'Square Mile',
    });
  });

  it('never sends the API key anywhere the UI can see', async () => {
    await throughProposal();
    const visible = JSON.stringify(engine.getState());
    expect(visible).not.toContain('sk-ant-test');
    const stored = JSON.stringify(await storage.porter.exportAll());
    expect(stored).not.toContain('sk-ant-test');
  });

  // -------------------------------------------------------------------------
  // D55: a version is on the machine only once Decaid confirms the upload
  // -------------------------------------------------------------------------

  async function throughTemplateCards() {
    await engine.newBag();
    scripts.push(() => [text('Lovely. Here is where I would start.'), saveBag, proposeTemplates]);
    await engine.sendText('Kiambu AA, light, washed');
    expect(engine.getState().phase).toBe('choosing_template');
  }

  function machineReconnects() {
    telemetry.setState({ machineConnected: false });
    telemetry.setState({ machineConnected: true });
  }

  /** The devices socket closed and opened again: Decaid is reachable again. */
  function decaidBack() {
    telemetry.setState({ sockets: { ...telemetry.getState().sockets, devices: 'closed' } });
    telemetry.setState({ sockets: { ...telemetry.getState().sockets, devices: 'open' } });
  }

  const busyError = () =>
    new GatewayError(503, '/api/v1/machine/profile', 'The machine is busy with other changes. Wait a moment, then try again.');

  describe('waiting for the machine to hold a version (D55)', () => {
    it('shows a loading notice while Decaid uploads the version, then says it is loaded', async () => {
      await throughTemplateCards();
      machine.barrier = 'hold';
      scripts.push(() => [text('Loaded. Pull a shot.')]);
      const picking = engine.pickTemplate('t-tpl', 'd-flow');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());

      expect(progressNotices()).toEqual([
        { kind: 'notice', tone: 'info', text: 'Loading Kiambu AA v1 on the machine…', progress: { value: null, label: null } },
      ]);
      expect(engine.getState().busy).toBe(true);
      expect(engine.getState().activeVersion?.title).toBe('Kiambu AA v1');
      // The barrier posts the profile exactly as Decaid answered the workflow PUT.
      expect(callsOf('loadProfileOnMachine')[0]!.args[0]).toBe(machine.returned);

      machine.held!.resolve('loaded');
      await picking;
      expect(progressNotices()).toEqual([]);
      expect(notices().at(-1)).toEqual({ kind: 'notice', tone: 'success', text: 'Loaded Kiambu AA v1 on the machine.' });
      expect(parsed(lastUserTurn(requests)[1])).toMatchObject({ picked: 'd-flow', uploaded: true, onMachine: true });
      expect(engine.getState().busy).toBe(false);
    });

    it('never stores a progress notice, and drops one a stored conversation has', async () => {
      const stored: string[] = [];
      const put = storage.conversations.put;
      storage.conversations.put = async (conversation) => {
        stored.push(JSON.stringify(conversation.uiMessages));
        await put(conversation);
      };
      machine.shotMisses.set('shot-1', 2);
      await throughShot(); // a barrier and a shot search, both with progress
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.some((json) => json.includes('"progress"'))).toBe(false);

      // One that got stored anyway (an older build, a crash) is gone after a reload.
      const conversation = (await storage.conversations.get(engine.getState().activeBag!.conversationId))!;
      const stale = message('msg-stale', 'system', [progressNoticePart('Loading Kiambu AA v1 on the machine…', { value: null, label: null })], '2026-10-03T08:00:00.000Z');
      await put({ ...conversation, uiMessages: [...conversation.uiMessages, stale] });
      engine.dispose();
      engine = build();
      await engine.start();
      expect(engine.getState().messages.length).toBeGreaterThan(0);
      expect(progressNotices()).toEqual([]);
    });

    it('says Decaid loads a version on connect, and confirms it once the machine holds it', async () => {
      machine.barrier = 'offline';
      await throughTemplatePick();
      expect(notices().at(-1)).toMatchObject({ tone: 'info', text: 'Saved Kiambu AA v1. Decaid loads it when the machine connects.' });
      expect(parsed(lastUserTurn(requests)[1])).toMatchObject({ uploaded: true, onMachine: false });
      expect(engine.getState().error).toBeNull();

      machine.barrier = 'loaded';
      machineReconnects();
      await vi.waitFor(() => expect(notices().at(-1)).toMatchObject({ tone: 'success', text: 'Loaded Kiambu AA v1 on the machine.' }));
      expect(callsOf('loadProfileOnMachine')).toHaveLength(2);
      expect(callsOf('loadProfileOnMachine')[1]!.args[0]).toEqual(machine.loaded);
      // Once it is on the machine, a later connect asks nothing.
      machineReconnects();
      await drain();
      expect(callsOf('loadProfileOnMachine')).toHaveLength(2);
      expect(engine.getState().busy).toBe(false);
    });

    it('never posts a version on connect that the workflow no longer carries (D42)', async () => {
      machine.barrier = 'offline';
      await throughTemplatePick();
      machine.loaded = { ...baseProfile, title: 'Picked in another skin', target_weight: 99 };
      machineReconnects();
      await vi.waitFor(() =>
        expect(engine.getState().error).toBe('The machine is running "Picked in another skin", not Kiambu AA v1. Tap Retry to load it.'),
      );
      expect(callsOf('loadProfileOnMachine')).toHaveLength(1);
    });

    it('keeps a version whose load failed active, with a warning and Retry, and credits no shot until it loads', async () => {
      machine.barrier = new GatewayError(504, '/api/v1/machine/profile', 'The machine did not answer over Bluetooth in time. Check that it is awake, then try again.');
      await throughTemplatePick();
      expect(engine.getState().activeVersion).toMatchObject({ title: 'Kiambu AA v1', status: 'active' });
      expect(notices().at(-1)).toEqual({
        kind: 'notice',
        tone: 'warning',
        text: 'Kiambu AA v1 is saved, but the machine has not confirmed it. The machine did not answer over Bluetooth in time. Check that it is awake, then try again.',
      });
      expect(engine.getState().error).toBe('The machine has not confirmed Kiambu AA v1. Tap Retry to load it again.');
      // Connected, so not "Decaid loads it when the machine connects": the coach hears why instead.
      expect(parsed(lastUserTurn(requests)[1])).toMatchObject({
        uploaded: true,
        onMachine: null,
        loadError: 'The machine did not answer over Bluetooth in time. Check that it is awake, then try again.',
        note: null,
      });

      expect(await shotIsCredited('shot-early')).toBe(false);
      expect(notices().at(-1)).toMatchObject({
        tone: 'warning',
        text: 'That shot started before the machine finished loading Kiambu AA v1, so it is not part of this dial-in.',
      });

      machine.barrier = 'loaded';
      await engine.retry();
      expect(engine.getState().error).toBeNull();
      expect(notices().at(-1)).toMatchObject({ tone: 'success', text: 'Loaded Kiambu AA v1 on the machine.' });
      expect(await shotIsCredited('shot-late')).toBe(true);
    });

    it('confirms a version whose load failed when the machine reconnects', async () => {
      machine.barrier = busyError();
      await throughTemplatePick();
      expect(engine.getState().error).toBe('The machine has not confirmed Kiambu AA v1. Tap Retry to load it again.');
      machine.barrier = 'loaded';
      machineReconnects();
      await vi.waitFor(() => expect(notices().at(-1)).toMatchObject({ tone: 'success', text: 'Loaded Kiambu AA v1 on the machine.' }));
      expect(engine.getState().error).toBeNull();
    });

    it('puts a newer load problem on the banner in place of the older one', async () => {
      machine.barrier = busyError();
      await throughTemplatePick();
      expect(engine.getState().error).toBe('The machine has not confirmed Kiambu AA v1. Tap Retry to load it again.');
      machine.loaded = { ...baseProfile, title: 'Picked in another skin', target_weight: 99 };
      machineReconnects();
      await vi.waitFor(() =>
        expect(engine.getState().error).toBe('The machine is running "Picked in another skin", not Kiambu AA v1. Tap Retry to load it.'),
      );
    });

    it('applies a confirmed change whose load failed, but tells the coach it is not on the machine', async () => {
      await throughProposal();
      machine.barrier = busyError();
      scripts.push(() => [text('Saved v2.')]);
      await engine.confirmChange('t-adj');
      expect(parsed(lastUserTurn(requests)[0])).toEqual({
        applied: true,
        variable: 'profile',
        version: 2,
        title: 'Kiambu AA v2',
        onMachine: null,
        loadError: 'The machine is busy with other changes. Wait a moment, then try again.',
      });
      expect(engine.getState().activeVersion?.version).toBe(2);
      expect(allParts().find((p) => p.kind === 'diff')).toMatchObject({ status: 'applied' });
      expect(notices().at(-1)).toMatchObject({ tone: 'warning', text: expect.stringContaining('Kiambu AA v2 is saved, but the machine has not confirmed it.') });
      expect(engine.getState().error).toBe('The machine has not confirmed Kiambu AA v2. Tap Retry to load it again.');
    });

    it('keeps the old wording on an older Decaid without the route, and stops asking it', async () => {
      machine.barrier = 'unsupported';
      await throughProposal();
      const loadNotice = notices().find((p) => p.text.includes('Kiambu AA v1') && !p.text.includes(' stops at '));
      expect(loadNotice).toMatchObject({ tone: 'success', text: 'Loaded Kiambu AA v1 on the machine.' });
      expect(callsOf('loadProfileOnMachine')).toHaveLength(1);

      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(callsOf('loadProfileOnMachine')).toHaveLength(1);
      expect(parsed(lastUserTurn(requests)[0])).toMatchObject({ applied: true, version: 2, onMachine: true });
      expect(notices().at(-1)).toMatchObject({ tone: 'success', text: 'Loaded Kiambu AA v2 on the machine.' });
    });

    it('waits for the machine on undo and on a bag switch too', async () => {
      await throughProposal();
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      scripts.push(() => [text('Back on v1.')]);
      await engine.undo();
      expect(callsOf('loadProfileOnMachine')).toHaveLength(3);
      expect(notices().slice(-2).map((p) => p.text)).toEqual(['Back on Kiambu AA v1.', 'Loaded Kiambu AA v1 on the machine.']);

      const kiambu = engine.getState().activeBag!.id;
      await anotherBag('Sumatra', 'londonium');
      await engine.selectBag(kiambu);
      expect(callsOf('loadProfileOnMachine')).toHaveLength(5);
      expect(notices().at(-1)).toMatchObject({ text: 'Loaded Kiambu AA v1 on the machine.' });
      expect(engine.getState().busy).toBe(false);
    });

    it('does not credit a shot that started while the version was loading', async () => {
      await throughTemplateCards();
      machine.barrier = 'hold';
      scripts.push(() => [text('Loaded.')]);
      const picking = engine.pickTemplate('t-tpl', 'd-flow');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      telemetry.emitShot({ type: 'started', shotId: 'shot-early' });
      nowMs += 4000; // the upload went on for seconds after the shot started
      machine.held!.resolve('loaded');
      await picking;

      const before = engine.getState().messages.length;
      telemetry.emitShot({ type: 'finished', shotId: 'shot-early', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().messages.length).toBeGreaterThan(before));
      expect(notices().at(-1)).toMatchObject({
        tone: 'warning',
        text: 'That shot started before the machine finished loading Kiambu AA v1, so it is not part of this dial-in.',
      });
      expect(await storage.iterations.listAll()).toHaveLength(0);
      expect(engine.getState().busy).toBe(false);

      nowMs += 60_000;
      expect(await shotIsCredited('shot-after')).toBe(true);
    });

    it("credits a shot that started inside Decaid's guard after the upload", async () => {
      await throughTemplateCards();
      machine.barrier = 'hold';
      scripts.push(() => [text('Loaded.')]);
      const picking = engine.pickTemplate('t-tpl', 'd-flow');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      // CafAI's own espresso start waits behind the upload in Decaid's write
      // queue, so it can be seen a moment before the barrier's answer.
      telemetry.emitShot({ type: 'started', shotId: 'shot-queued' });
      nowMs += 200;
      machine.held!.resolve('loaded');
      await picking;
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-queued', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      expect((await storage.iterations.listAll()).map((i) => i.shotId)).toEqual(['shot-queued']);
    });
  });

  // -------------------------------------------------------------------------
  // D64: Decaid writes that failed are sent again
  // -------------------------------------------------------------------------

  describe('retrying Decaid writes (D64)', () => {
    const grinderWrites = () => callsOf('updateWorkflow').map((c) => c.args[0]);
    const unreachable = (setting: string) => `Decaid can't be reached right now. CafAI will send grinder setting ${setting} as soon as it can.`;

    async function throughGrindProposal(setting: string) {
      await throughShot();
      scripts.push(() => [
        toolUse('t-grind', TOOL.proposeAdjustment, {
          variable: 'grind',
          lever: null,
          value: null,
          grind: { direction: 'finer', amount: 1, setting },
          summary: `Grind 1 step finer, to ${setting}`,
          rationale: 'It ran fast.',
          expectedEffect: 'A slower shot that extracts a little more.',
          tips: [],
        }),
      ]);
      await engine.answerOptions('t-ask', ['Muddy'], null);
      expect(engine.getState().phase).toBe('awaiting_confirmation');
    }

    it('sends a confirmed grind setting once Decaid is back, and says so once', async () => {
      await throughGrindProposal('15');
      machine.failUpdates = 1;
      scripts.push(() => [text('Turn the dial, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      expect(engine.getState().error).toBeNull();
      expect(notices().filter((p) => p.text.startsWith("Decaid can't be reached"))).toEqual([
        { kind: 'notice', tone: 'warning', text: unreachable('15') },
      ]);
      expect(grinderWrites()).toEqual([]);

      decaidBack();
      await vi.waitFor(() => expect(grinderWrites()).toEqual([{ context: { grinderId: null, grinderModel: null, grinderSetting: '15', grinderBurrs: null } }]));
      expect(notices().filter((p) => p.text.startsWith("Decaid can't be reached"))).toHaveLength(1);
      expect(timers.delays()).toEqual([]);
    });

    it('sends a grinder saved in Settings while Decaid was away when the machine connects', async () => {
      await throughTemplatePick();
      await storage.settings.update({ grinderName: 'Niche Zero', grinderSetting: '14' });
      machine.failUpdates = 1;
      await engine.refresh();
      expect(notices().at(-1)).toMatchObject({ tone: 'warning', text: unreachable('14') });
      machineReconnects();
      await vi.waitFor(() => expect(grinderWrites().at(-1)).toEqual({ context: { grinderId: null, grinderModel: 'Niche Zero', grinderSetting: '14', grinderBurrs: null } }));
    });

    it('sends only the latest grinder', async () => {
      await throughTemplatePick();
      machine.failUpdates = 2;
      await storage.settings.update({ grinderSetting: '14' });
      await engine.refresh();
      await storage.settings.update({ grinderSetting: '13' });
      await engine.refresh();
      decaidBack();
      await vi.waitFor(() => expect(grinderWrites()).toHaveLength(1));
      await drain();
      expect(grinderWrites()).toEqual([{ context: { grinderId: null, grinderModel: null, grinderSetting: '13', grinderBurrs: null } }]);
    });

    it('tries again every 30 s while a write waits, and stops when it is through', async () => {
      await throughTemplatePick();
      await storage.settings.update({ grinderSetting: '14' });
      machine.failUpdates = 2;
      await engine.refresh();
      expect(timers.delays()).toEqual([30_000]);

      timers.fire();
      await vi.waitFor(() => expect(machine.failUpdates).toBe(0));
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      expect(grinderWrites()).toEqual([]);

      timers.fire();
      await vi.waitFor(() => expect(grinderWrites()).toEqual([{ context: { grinderId: null, grinderModel: null, grinderSetting: '14', grinderBurrs: null } }]));
      expect(timers.delays()).toEqual([]);
    });

    it('sends a waiting write before a finished shot is handled', async () => {
      await throughTemplatePick();
      await storage.settings.update({ grinderSetting: '14' });
      machine.failUpdates = 1;
      await engine.refresh();
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(grinderWrites()).toEqual([{ context: { grinderId: null, grinderModel: null, grinderSetting: '14', grinderBurrs: null } }]));
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    });

    it('lets a profile load carry a grinder write that waits', async () => {
      await throughProposal();
      await storage.settings.update({ grinderSetting: '14' });
      machine.failUpdates = 1;
      await engine.refresh();
      expect(timers.delays()).toEqual([30_000]);
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(callsOf('activateProfile').at(-1)!.args[1]).toMatchObject({ grinderModel: null, grinderSetting: '14' });
      expect(timers.delays()).toEqual([]);
      decaidBack();
      await drain();
      expect(grinderWrites()).toEqual([]);
    });

    it('stops trying when disposed', async () => {
      await throughTemplatePick();
      await storage.settings.update({ grinderSetting: '14' });
      machine.failUpdates = 1;
      await engine.refresh();
      expect(timers.delays()).toEqual([30_000]);
      engine.dispose();
      expect(timers.delays()).toEqual([]);
      decaidBack();
      expect(grinderWrites()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // D61: taste feedback and the star rating in Decaid's shot record
  // -------------------------------------------------------------------------

  describe("writing to Decaid's shot record (D61)", () => {
    async function answerTaste(selected: string[], other: string | null = null) {
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', selected, other);
    }

    it('writes the taste as a short notes line and extras.cafai', async () => {
      await throughShot();
      await answerTaste(['Sour']);
      await vi.waitFor(() => expect(callsOf('updateShot')).toHaveLength(1));
      const [shotId, patch] = callsOf('updateShot')[0]!.args;
      const v1 = engine.getState().versions[0]!;
      expect(shotId).toBe('shot-1');
      expect(patch).toEqual({
        annotations: {
          espressoNotes: 'Taste: Sour. Kiambu AA v1 (CafAI)',
          extras: {
            cafai: {
              bagId: engine.getState().activeBag!.id,
              versionId: v1.id,
              version: 1,
              selected: ['Sour'],
              text: null,
              notes: 'Taste: Sour. Kiambu AA v1 (CafAI)',
            },
          },
        },
      });
      // The coach hears nothing about it.
      expect(JSON.stringify(requests)).not.toContain('espressoNotes');
    });

    it('never clobbers notes a person wrote in Decaid', async () => {
      await throughShot();
      machine.annotations.set('shot-1', { espressoNotes: 'Lovely crema', extras: { visualizerId: 'v-1' } });
      await answerTaste(['Bitter']);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')?.espressoNotes).toBe('Lovely crema\nTaste: Bitter. Kiambu AA v1 (CafAI)'));
      expect(machine.annotations.get('shot-1')?.extras).toMatchObject({ visualizerId: 'v-1', cafai: { selected: ['Bitter'] } });
    });

    it('replaces notes that are exactly what CafAI wrote last time', async () => {
      await throughShot();
      const own = 'Taste: Sour. Kiambu AA v1 (CafAI)';
      machine.annotations.set('shot-1', { espressoNotes: own, extras: { cafai: { notes: own } } });
      await answerTaste(['Bitter']);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')?.espressoNotes).toBe('Taste: Bitter. Kiambu AA v1 (CafAI)'));
    });

    it('writes feedback typed while the taste question is open', async () => {
      await throughShot();
      scripts.push(() => [text('Noted.')]);
      await engine.sendText('Quite sour and thin');
      await vi.waitFor(() =>
        expect(machine.annotations.get('shot-1')).toMatchObject({
          espressoNotes: 'Taste: Quite sour and thin. Kiambu AA v1 (CafAI)',
          extras: { cafai: { selected: [], text: 'Quite sour and thin' } },
        }),
      );
    });

    it('keeps a key typed into Other away from Decaid and the coach', async () => {
      await throughShot();
      await answerTaste(['Other'], 'sour, sk-ant-api03-pasted-key-1234567890');
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toBeDefined());
      expect(JSON.stringify(machine.annotations.get('shot-1'))).not.toContain('sk-ant-');
      expect(machine.annotations.get('shot-1')?.espressoNotes).toBe('Taste: sour, [API key removed]. Kiambu AA v1 (CafAI)');
      expect(JSON.stringify(requests)).not.toContain('sk-ant-api03');
    });

    it('rates a shot: enjoyment is stars x 2, the stars stay on the card, and the coach hears nothing', async () => {
      await throughShot();
      const turns = requests.length;
      await engine.rateShot('shot-1', 4);
      expect(allParts().find((p) => p.kind === 'shot')).toMatchObject({ shotId: 'shot-1', stars: 4 });
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 8, extras: { cafai: { stars: 4 } } }));

      await engine.rateShot('shot-1', 2);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 4, extras: { cafai: { stars: 2 } } }));
      expect(requests).toHaveLength(turns);

      engine.dispose();
      engine = build();
      await engine.start();
      expect(allParts().find((p) => p.kind === 'shot')).toMatchObject({ stars: 2 });
    });

    it('ignores a rating outside one to five stars, or for a shot not in the chat', async () => {
      await throughShot();
      await engine.rateShot('shot-1', 0);
      await engine.rateShot('shot-1', 6);
      await engine.rateShot('shot-1', 2.5);
      await engine.rateShot('shot-elsewhere', 3);
      await drain();
      expect(callsOf('updateShot')).toEqual([]);
      expect(allParts().find((p) => p.kind === 'shot')).not.toHaveProperty('stars');
    });

    it('sends a shot write Decaid could not take again, with everything said so far', async () => {
      await throughShot();
      machine.failShotUpdates = 2;
      await answerTaste(['Sour']);
      await vi.waitFor(() => expect(machine.failShotUpdates).toBe(1));
      await engine.rateShot('shot-1', 5);
      await vi.waitFor(() => expect(machine.failShotUpdates).toBe(0));
      expect(machine.annotations.get('shot-1')).toBeUndefined();

      decaidBack();
      await vi.waitFor(() =>
        expect(machine.annotations.get('shot-1')).toMatchObject({
          espressoNotes: 'Taste: Sour. Kiambu AA v1 (CafAI)',
          enjoyment: 10,
          extras: { cafai: { selected: ['Sour'], stars: 5 } },
        }),
      );
      expect(callsOf('updateShot')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // D65: progress while CafAI looks for a shot
  // -------------------------------------------------------------------------

  describe('looking for a lost shot (D65)', () => {
    /** Every distinct search notice the chat showed, with whether the engine was busy then. */
    function watchSearch() {
      const seen: Array<{ label: string | null; value: number | null; busy: boolean }> = [];
      engine.subscribe(() => {
        const search = progressNotices().find((p) => p.text === 'Looking for that shot in Decaid…');
        if (!search?.progress) return;
        const entry = { ...search.progress, busy: engine.getState().busy };
        const last = seen[seen.length - 1];
        if (!last || last.label !== entry.label) seen.push(entry);
      });
      return seen;
    }

    it('shows the search after a miss, updates it on each try, and removes it when the shot is in', async () => {
      await throughTemplatePick();
      const seen = watchSearch();
      machine.shotMisses.set('shot-slow', 3);
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-slow', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));

      expect(seen.map((s) => s.label)).toEqual(['Try 2 of 6', 'Try 3 of 6', 'Try 4 of 6']);
      expect(seen.map((s) => s.value)).toEqual([1 / 6, 2 / 6, 3 / 6]);
      expect(seen.every((s) => s.busy)).toBe(true);
      expect(progressNotices()).toEqual([]);
      expect(allParts().some((p) => p.kind === 'shot')).toBe(true);
      // Updated in place: one notice at a time, never a trail of them.
      expect(engine.getState().messages.filter((m) => m.parts.some((p) => p.kind === 'notice' && p.progress))).toHaveLength(0);
    });

    it('shows nothing when Decaid has the shot at once', async () => {
      await throughTemplatePick();
      const seen = watchSearch();
      await shotIsCredited('shot-quick');
      expect(seen).toEqual([]);
    });

    it('gives way to the warning when the shot never arrives, and shows again on Retry', async () => {
      await throughTemplatePick();
      const seen = watchSearch();
      machine.missingShots.add('shot-lost');
      telemetry.emitShot({ type: 'finished', shotId: 'shot-lost', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().error).toBe('Decaid has not saved that shot yet.'));
      expect(seen.map((s) => s.label)).toEqual(['Try 2 of 6', 'Try 3 of 6', 'Try 4 of 6', 'Try 5 of 6', 'Try 6 of 6']);
      expect(progressNotices()).toEqual([]);
      expect(notices().at(-1)).toMatchObject({ tone: 'warning', text: expect.stringContaining('Decaid has not saved it') });
      expect(engine.getState().busy).toBe(false);

      seen.length = 0;
      await engine.retry();
      expect(seen.map((s) => s.label)).toEqual(['Try 2 of 6', 'Try 3 of 6', 'Try 4 of 6', 'Try 5 of 6', 'Try 6 of 6']);
      expect(progressNotices()).toEqual([]);
      expect(engine.getState().error).toBe('Decaid has not saved that shot yet.');
    });
  });

  // -------------------------------------------------------------------------
  // D57, D59: v1 starts from the dose, under the template's library entry
  // -------------------------------------------------------------------------

  describe('v1 from the dose (D57, D59)', () => {
    /** Decaid's dose, as the user or another skin set it (null: none). */
    function setDecaidDose(doseG: number | null) {
      const { targetDoseWeight: _previous, ...rest } = machine.context;
      machine.context = doseG === null ? rest : { ...rest, targetDoseWeight: doseG };
    }

    /** Open a bag with Decaid's 18 g dose, then change the dose in Decaid before the pick. */
    async function pickWithDose(doseG: number | null) {
      await throughTemplateCards();
      setDecaidDose(doseG);
      scripts.push(() => [text('Loaded. Pull a shot.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
    }

    const v1Activation = () => callsOf('activateProfile')[0]!.args as [ProfileJson, WorkflowContext];
    const pickedPayload = () => parsed(lastUserTurn(requests)[1]);
    const yieldNotices = () => notices().filter((p) => p.text.includes(' stops at '));

    it('starts v1 at the author ratio times a dose changed in Decaid after the bag opened (16 g)', async () => {
      await pickWithDose(16);
      const [profile, context] = v1Activation();
      expect(profile.target_weight).toBe(45);
      expect(context.targetYield).toBe(45);
      expect(engine.getState().activeVersion?.profile.target_weight).toBe(45);
      expect(yieldNotices()).toEqual([{ kind: 'notice', tone: 'info', text: 'Kiambu AA v1 stops at 45 g: 2.8 x the 16.0 g dose in Decaid.' }]);
      expect(pickedPayload()).toEqual({
        picked: 'd-flow',
        version: 1,
        title: 'Kiambu AA v1',
        yieldG: 45,
        doseG: 16,
        uploaded: true,
        onMachine: true,
        loadError: null,
        note: null,
      });
    });

    it('starts v1 at 50 g for an 18 g dose', async () => {
      await pickWithDose(18);
      const [profile, context] = v1Activation();
      expect(profile.target_weight).toBe(50);
      expect(context).toMatchObject({ targetYield: 50, targetDoseWeight: 18 });
      expect(yieldNotices().map((p) => p.text)).toEqual(['Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid.']);
      expect(pickedPayload()).toMatchObject({ yieldG: 50, doseG: 18 });
    });

    it('assumes 18 g when Decaid has no dose, and says how to change that', async () => {
      await pickWithDose(null);
      const [profile, context] = v1Activation();
      expect(profile.target_weight).toBe(50);
      expect(context.targetYield).toBe(50);
      expect(context).not.toHaveProperty('targetDoseWeight');
      expect(yieldNotices().map((p) => p.text)).toEqual([
        'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. CafAI found no dose in Decaid, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
      ]);
      expect(pickedPayload()).toMatchObject({ yieldG: 50, doseG: null });
    });

    it('treats a 7 g dose as unknown, and never writes it back over a dose the user sets later', async () => {
      await pickWithDose(7);
      const [profile, context] = v1Activation();
      expect(profile.target_weight).toBe(50);
      expect(context.targetYield).toBe(50);
      expect(context).not.toHaveProperty('targetDoseWeight');
      expect(yieldNotices().map((p) => p.text)).toEqual([
        'Kiambu AA v1 stops at 50 g: 2.8 x 18 g. The 7.0 g dose in Decaid is outside 12-25 g, so v1 assumes 18 g. Set your real dose in Decaid and CafAI will use it.',
      ]);
      expect(pickedPayload()).toMatchObject({ yieldG: 50, doseG: null });

      // The user sets the real dose, as the notice says; loading v2 must not put 7 g back.
      setDecaidDose(18);
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      scripts.push(() => [proposeTemp]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(engine.getState().activeVersion?.version).toBe(2);
      expect(callsOf('activateProfile')).toHaveLength(2);
      expect(callsOf('activateProfile')[1]!.args[1]).not.toHaveProperty('targetDoseWeight');
      expect(machine.context.targetDoseWeight).toBe(18);
    });

    it("keeps the session's dose when Decaid cannot be read at the pick", async () => {
      await throughTemplateCards(); // the bag opened with Decaid's 18 g
      setDecaidDose(16);
      machine.failWorkflowReads = 1;
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      expect(v1Activation()[0].target_weight).toBe(50);
      expect(pickedPayload()).toMatchObject({ yieldG: 50, doseG: 18 });
      expect(engine.getState().error).toBeNull();
    });

    it('says where v1 stops before it says the machine holds it', async () => {
      await pickWithDose(18);
      const texts = notices().map((p) => p.text);
      const stops = texts.indexOf('Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid.');
      expect(stops).toBeGreaterThanOrEqual(0);
      expect(stops).toBeLessThan(texts.indexOf('Loaded Kiambu AA v1 on the machine.'));
    });

    it('tells the coach the dose CafAI coaches from at intake', async () => {
      await throughTemplateCards();
      const intake = (requests[0]![0]!.content[1] as { text: string }).text;
      expect(JSON.parse(intake.split('\n')[1]!)).toMatchObject({ scaleConnected: true, doseG: 18 });

      setDecaidDose(7);
      await anotherBag('Sumatra', 'londonium');
      const second = requests.find((messages) => messages.length === 1 && JSON.stringify(messages).includes('Sumatra'))!;
      expect(JSON.parse((second[0]!.content[1] as { text: string }).text.split('\n')[1]!)).toMatchObject({ doseG: null });
    });

    it("records v1 under the template's bundled default in Decaid's library", async () => {
      await pickWithDose(16);
      const creates = callsOf('createProfileVersion');
      expect(creates).toHaveLength(1);
      expect(creates[0]!.args[0]).toMatchObject({
        parentId: 'profile:d-flow',
        metadata: { source: 'cafai', version: 1, templateId: 'd-flow' },
      });
      expect(engine.getState().activeVersion?.decaidProfileId).toBe('profile:1');
    });

    it('records v1 without a parent when Decaid answers 400 for it', async () => {
      machine.parentMissing = true;
      await pickWithDose(16);
      const requests400 = callsOf('createProfileVersion').map((c) => c.args[0] as { parentId?: string; profile: ProfileJson });
      expect(requests400).toHaveLength(2);
      expect(requests400[0]!.parentId).toBe('profile:d-flow');
      expect(requests400[1]).not.toHaveProperty('parentId');
      expect(requests400[1]!.profile).toEqual(requests400[0]!.profile);
      expect(engine.getState().activeVersion?.decaidProfileId).toBe('profile:1');
      expect(pickedPayload()).toMatchObject({ uploaded: true, onMachine: true, note: null });
      expect(engine.getState().error).toBeNull();
    });

    it('does not post again when the library write failed for another reason', async () => {
      machine.createError = new GatewayError(0, '/api/v1/profiles', 'Could not reach Decaid.', 'network');
      await pickWithDose(16);
      expect(callsOf('createProfileVersion')).toHaveLength(1);
      // Not loaded at all: neither on the machine nor waiting for it to connect.
      expect(pickedPayload()).toMatchObject({ uploaded: false, onMachine: null, loadError: null, note: 'Could not reach Decaid.' });
    });

    it('keeps the note when Decaid already had this exact profile', async () => {
      machine.dedupe = true;
      await pickWithDose(18);
      expect(pickedPayload()).toMatchObject({
        uploaded: true,
        note: 'Decaid already had this exact profile and kept its library entry; the machine shows the new title.',
      });
    });
  });

  // -------------------------------------------------------------------------
  // D62: the grinder linked from Decaid's grinder library
  // -------------------------------------------------------------------------

  describe("Decaid's grinder in the engine (D62)", () => {
    /** Until every grinder read so far has answered and the engine has taken the answer. */
    const grinderSettled = () => Promise.allSettled(machine.grinderReads);

    /** A page load with this grinder linked in Settings. */
    async function startLinked(id: string, info: GrinderInfo | null, setting: string, name = info?.model ?? 'Old grinder') {
      engine.dispose();
      engine = build();
      if (info) machine.grinders.set(id, info);
      await storage.settings.update({ grinderId: id, grinderName: name, grinderSetting: setting });
      await engine.start();
      await grinderSettled();
    }

    /** Settings saved (grinderId, grinderName, grinderSetting), then coach.refresh(), as the Settings screen does. */
    async function saveInSettings(id: string | null, info: GrinderInfo | null, setting: string, name = info?.model ?? null) {
      if (id !== null && info) machine.grinders.set(id, info);
      await storage.settings.update({ grinderId: id, grinderName: name, grinderSetting: setting });
      await engine.refresh();
      await grinderSettled();
    }

    const intakeGrinder = () => JSON.parse((requests[0]![0]!.content[1] as { text: string }).text.split('\n')[1]!).grinder;

    /** Every shot event the coach heard, oldest first. */
    function shotEvents(): Array<Record<string, unknown>> {
      return (requests.at(-1) ?? [])
        .flatMap((m) => m.content)
        .flatMap((b) => (b.type === 'text' && b.text.startsWith('[event:shot_completed]') ? [JSON.parse(b.text.split('\n')[1]!)] : []));
    }

    const grindMove = (grind: { direction: 'finer' | 'coarser'; amount: number | null; setting: string | null }, id = 't-grind') =>
      toolUse(id, TOOL.proposeAdjustment, {
        variable: 'grind',
        lever: null,
        value: null,
        grind,
        summary: 'Grind 1 step finer',
        rationale: 'It ran fast.',
        expectedEffect: 'A slower shot that extracts a little more.',
        tips: [],
      });

    const nicheOn = (setting: string) => ({ name: 'Niche Zero', setting, settingType: 'numeric', step: 0.5, values: null, linked: true });

    it("reads the linked grinder at start and tells the coach its dial at intake and with every shot", async () => {
      await startLinked('g-niche', NICHE, '15');
      expect(callsOf('getGrinder').map((c) => c.args)).toEqual([['g-niche']]);
      await throughShot();
      expect(intakeGrinder()).toEqual(nicheOn('15'));
      expect(shotEvents().map((e) => e.grinder)).toEqual([nicheOn('15')]);
    });

    it('sends the linked grinder with every activation (D62 supersedes D45)', async () => {
      await startLinked('g-niche', NICHE, '15');
      await throughTemplatePick();
      expect(callsOf('activateProfile').at(-1)!.args[1]).toMatchObject({ grinderId: 'g-niche', grinderModel: 'Niche Zero', grinderSetting: '15' });
    });

    it('works a relative grind move out on the grinder, and the setting reaches Settings, Decaid and the next shot', async () => {
      await startLinked('g-niche', NICHE, '15');
      await throughShot();
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: null })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      expect(engine.getState().phase).toBe('awaiting_confirmation');
      expect(lastProposalContext?.grinder).toEqual(NICHE);
      expect(allParts().find((p) => p.kind === 'diff')).toMatchObject({
        lines: ['Grind 1 step finer: 15 -> 14.5'],
        manualSteps: ['Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).'],
      });

      scripts.push(() => [text('Make that change, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      expect((await storage.settings.get()).grinderSetting).toBe('14.5');
      expect(callsOf('updateWorkflow').at(-1)!.args[0]).toEqual({
        context: { grinderId: 'g-niche', grinderModel: 'Niche Zero', grinderSetting: '14.5', grinderBurrs: null },
      });

      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      expect(shotEvents().map((e) => e.grinder)).toEqual([nicheOn('15'), nicheOn('14.5')]);
    });

    it('sends a worked-out setting Decaid could not take through the outbox, with the grinder id', async () => {
      await startLinked('g-niche', NICHE, '15');
      await throughShot();
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: null })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      machine.failUpdates = 1;
      scripts.push(() => [text('Make that change, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      expect(notices().at(-1)).toMatchObject({
        tone: 'warning',
        text: "Decaid can't be reached right now. CafAI will send grinder setting 14.5 as soon as it can.",
      });
      expect(callsOf('updateWorkflow')).toEqual([]);

      decaidBack();
      await vi.waitFor(() =>
        expect(callsOf('updateWorkflow').map((c) => c.args[0])).toEqual([
          { context: { grinderId: 'g-niche', grinderModel: 'Niche Zero', grinderSetting: '14.5', grinderBurrs: null } },
        ]),
      );
    });

    it("checks a setting the coach names against a preset grinder's list, inside the model run", async () => {
      await startLinked('g-encore', ENCORE, '5');
      await throughShot();
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: '4.5' }, 't-off-list')]);
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: '4' })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      const refused = lastUserTurn(requests)[0] as { tool_use_id: string; is_error?: boolean; content: string };
      expect(refused).toMatchObject({ tool_use_id: 't-off-list', is_error: true });
      expect(refused.content).toContain('grind.setting "4.5" is not one of your grinder\'s settings.');
      expect(allParts().find((p) => p.kind === 'diff')).toMatchObject({
        manualSteps: ['Set the grinder to 4 before the next shot (Decaid lists 12 settings for your Baratza Encore ESP).'],
      });
    });

    it('reads the grinder again after every refresh, and writes a changed one with its id', async () => {
      await startLinked('g-niche', NICHE, '15');
      await engine.refresh(); // nothing changed: read again, nothing written
      await grinderSettled();
      expect(callsOf('getGrinder').map((c) => c.args)).toEqual([['g-niche'], ['g-niche']]);
      expect(callsOf('updateWorkflow')).toEqual([]);

      // Another grinder with the same name and setting: only the id changed.
      await saveInSettings('g-niche-2', NICHE, '15');
      expect(callsOf('getGrinder').at(-1)!.args).toEqual(['g-niche-2']);
      expect(callsOf('updateWorkflow').map((c) => c.args[0])).toEqual([
        { context: { grinderId: 'g-niche-2', grinderModel: 'Niche Zero', grinderSetting: '15', grinderBurrs: null } },
      ]);

      await saveInSettings('g-encore', ENCORE, '5');
      expect(callsOf('updateWorkflow').at(-1)!.args[0]).toEqual({
        context: { grinderId: 'g-encore', grinderModel: 'Baratza Encore ESP', grinderSetting: '5', grinderBurrs: null },
      });
      await throughTemplateCards();
      expect(intakeGrinder()).toEqual({
        name: 'Baratza Encore ESP',
        setting: '5',
        settingType: 'preset',
        step: null,
        values: ENCORE.values,
        linked: true,
      });
    });

    it('keeps the steps it has when a read fails, and asks again on the next refresh', async () => {
      await startLinked('g-niche', NICHE, '15');
      machine.failGrinderReads = 1;
      await engine.refresh();
      await grinderSettled();
      expect(engine.getState().error).toBeNull();
      await throughTemplateCards();
      expect(intakeGrinder()).toEqual(nicheOn('15'));
    });

    it("never uses another grinder's steps: a failed read for a new grinder leaves none until a read works", async () => {
      await startLinked('g-niche', NICHE, '15');
      machine.failGrinderReads = 1;
      await saveInSettings('g-encore', ENCORE, '5');
      expect(engine.getState().error).toBeNull();
      await throughShot();
      expect(intakeGrinder()).toEqual({ name: 'Baratza Encore ESP', setting: '5', settingType: null, step: null, values: null, linked: true });

      await engine.refresh();
      await grinderSettled();
      scripts.push(() => [text('Again?'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(shotEvents()).toHaveLength(2));
      expect(shotEvents()[1]!.grinder).toEqual({
        name: 'Baratza Encore ESP',
        setting: '5',
        settingType: 'preset',
        step: null,
        values: ENCORE.values,
        linked: true,
      });
    });

    it('starts even when the grinder cannot be read, and a grinder Decaid no longer has gives no steps', async () => {
      engine.dispose();
      engine = build();
      machine.failGrinderReads = 1;
      await storage.settings.update({ grinderId: 'g-niche', grinderName: 'Niche Zero', grinderSetting: '15' });
      await engine.start();
      await grinderSettled();
      expect(engine.getState()).toMatchObject({ ready: true, error: null });

      await saveInSettings('g-gone', null, '7', 'Old grinder');
      expect(callsOf('getGrinder').at(-1)!.args).toEqual(['g-gone']);
      await throughTemplateCards();
      // Still linked, so the coach gives directions only.
      expect(intakeGrinder()).toEqual({ name: 'Old grinder', setting: '7', settingType: null, step: null, values: null, linked: true });
    });

    it('reads nothing when no grinder is linked, and forgets the steps when it is unlinked', async () => {
      expect(callsOf('getGrinder')).toEqual([]);
      await startLinked('g-niche', NICHE, '15');
      await saveInSettings(null, null, '15', 'Niche Zero');
      expect(callsOf('getGrinder')).toHaveLength(1);
      expect(callsOf('updateWorkflow').at(-1)!.args[0]).toEqual({ context: { grinderId: null, grinderModel: 'Niche Zero', grinderSetting: '15', grinderBurrs: null } });
      await throughShot();
      expect(intakeGrinder()).toEqual({ name: 'Niche Zero', setting: '15', settingType: null, step: null, values: null, linked: false });

      // Without Decaid's steps a relative move stays as the coach gave it.
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: null })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      expect(lastProposalContext?.grinder).toBeNull();
      scripts.push(() => [text('Make that change, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      expect((await storage.settings.get()).grinderSetting).toBe('15');
    });

    it('works a relative move out again at Confirm when a reload brought the card back before the grinder was read', async () => {
      await startLinked('g-niche', NICHE, '15');
      await throughShot();
      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: null })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      expect(allParts().find((p) => p.kind === 'diff')).toMatchObject({ manualSteps: [expect.stringContaining('Set the grinder to 14.5')] });

      // A page load: the card comes back from storage while the grinder is still being read.
      engine.dispose();
      engine = build();
      machine.grinders.set('g-niche', NICHE);
      machine.holdGrinderReads = true;
      await engine.start();
      expect(engine.getState().phase).toBe('awaiting_confirmation');
      releaseGrinderReads();
      await grinderSettled();

      scripts.push(() => [text('Make that change, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      expect((await storage.settings.get()).grinderSetting).toBe('14.5');
      expect(callsOf('updateWorkflow').at(-1)!.args[0]).toEqual({
        context: { grinderId: 'g-niche', grinderModel: 'Niche Zero', grinderSetting: '14.5', grinderBurrs: null },
      });
    });

    it('reads the grinder again with every shot: one Decaid no longer lists gets directions only, no old step', async () => {
      await startLinked('g-niche', NICHE, '15');
      await throughTemplatePick();
      expect(callsOf('getGrinder')).toHaveLength(1);
      // Deleted from Decaid's grinder library while CafAI runs.
      machine.grinders.delete('g-niche');
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      await grinderSettled();
      expect(callsOf('getGrinder').length).toBeGreaterThan(1);
      // The shot event already says so: still linked, no steps.
      expect(shotEvents().map((e) => e.grinder)).toEqual([
        { name: 'Niche Zero', setting: '15', settingType: null, step: null, values: null, linked: true },
      ]);

      scripts.push(() => [grindMove({ direction: 'finer', amount: 1, setting: null })]);
      await engine.answerOptions('t-ask', [OTHER_OPTION], 'Muddy');
      expect(lastProposalContext?.grinder).toBeNull();
      const card = allParts().find((p) => p.kind === 'diff');
      expect(card).toMatchObject({
        lines: ['Grind 1 step finer (now 15)'],
        manualSteps: ["Turn the grinder 1 step finer before the next shot. CafAI doesn't know your grinder's step size, so note the new setting in Settings."],
      });
      expect(JSON.stringify(card)).not.toContain('Decaid lists');
    });

    it('reads the grinder again when the page comes back into view, not while it is hidden', async () => {
      await startLinked('g-niche', NICHE, '15');
      view.hide();
      expect(callsOf('getGrinder')).toHaveLength(1);
      machine.grinders.set('g-niche', { ...NICHE, smallStep: 1 });
      view.show();
      await grinderSettled();
      expect(callsOf('getGrinder')).toHaveLength(2);
      await throughTemplateCards();
      expect(intakeGrinder()).toMatchObject({ step: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // D66, D52: another profile loaded behind CafAI's back
  // -------------------------------------------------------------------------

  describe("watching the machine's profile (D66, D52)", () => {
    const otherProfile = (title: string, targetWeight = 99): ProfileJson => ({ ...baseProfile, title, target_weight: targetWeight });
    const workflowReads = () => callsOf('getWorkflow').length;
    const pouring = {
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
    } as const;

    it('looks every 30 s and puts another profile on the banner with Retry', async () => {
      await throughTemplatePick();
      expect(checks.delays()).toEqual([30_000]);
      const beat = engine.getState().machineTick ?? -1;
      machine.loaded = otherProfile('Default');
      checks.fire();
      expect(engine.getState().machineTick).toBe(beat + 1);
      await vi.waitFor(() =>
        expect(engine.getState().error).toBe('The machine is running "Default", not Kiambu AA v1. Tap Retry to load it.'),
      );
      expect(checks.delays()).toEqual([30_000]);
      await engine.retry();
      expect(machine.loaded.title).toBe('Kiambu AA v1');
      expect(engine.getState().error).toBeNull();
    });

    it('never changes the machine itself (D42), and says nothing while the version is on it', async () => {
      await throughTemplatePick();
      const activations = callsOf('activateProfile').length;
      const reads = workflowReads();
      checks.fire();
      await drain();
      expect(workflowReads()).toBe(reads + 1);
      expect(engine.getState().error).toBeNull();
      machine.loaded = otherProfile('Default');
      checks.fire();
      await vi.waitFor(() => expect(engine.getState().error).toMatch(/"Default"/));
      expect(callsOf('activateProfile')).toHaveLength(activations);
      expect(callsOf('loadProfileOnMachine')).toHaveLength(1);
    });

    it('does not bring a dismissed mismatch back on every beat, but raises another profile (D52)', async () => {
      await throughTemplatePick();
      machine.loaded = otherProfile('Default');
      checks.fire();
      await vi.waitFor(() => expect(engine.getState().error).toMatch(/"Default"/));
      engine.dismissError();
      for (let i = 0; i < 3; i++) {
        checks.fire();
        await drain();
      }
      expect(engine.getState().error).toBeNull();

      machine.loaded = otherProfile('Picked in another skin', 98);
      checks.fire();
      await vi.waitFor(() =>
        expect(engine.getState().error).toBe('The machine is running "Picked in another skin", not Kiambu AA v1. Tap Retry to load it.'),
      );
    });

    it('raises the same profile again once the version was back on the machine in between', async () => {
      await throughTemplatePick();
      const v1 = machine.loaded;
      machine.loaded = otherProfile('Default');
      checks.fire();
      await vi.waitFor(() => expect(engine.getState().error).toMatch(/"Default"/));
      engine.dismissError();
      machine.loaded = v1; // loaded again in Decaid
      checks.fire();
      await drain();
      expect(engine.getState().error).toBeNull();
      machine.loaded = otherProfile('Default');
      checks.fire();
      await vi.waitFor(() => expect(engine.getState().error).toMatch(/"Default"/));
    });

    it('does not look while a shot runs or a version loads, but keeps the beat, and looks once right after the load', async () => {
      await throughProposal();
      machine.loaded = otherProfile('Default');
      telemetry.setState({ shotState: pouring });
      const reads = workflowReads();
      const beat = engine.getState().machineTick ?? -1;
      checks.fire();
      await drain();
      expect(workflowReads()).toBe(reads);
      expect(engine.getState().machineTick).toBe(beat + 1);
      telemetry.setState({ shotState: null });

      // A confirmed change on its way to the machine: two beats meanwhile, one look after it.
      machine.barrier = 'hold';
      scripts.push(() => [text('Done.')]);
      const confirming = engine.confirmChange('t-adj');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      machine.loaded = otherProfile('Default');
      const during = workflowReads();
      checks.fire();
      checks.fire();
      expect(engine.getState().machineTick).toBe(beat + 3);
      await Promise.resolve();
      expect(workflowReads()).toBe(during);
      machine.loaded = callsOf('activateProfile').at(-1)!.args[0] as ProfileJson;
      machine.held!.resolve('loaded');
      await confirming;
      await drain();
      expect(workflowReads()).toBe(during + 1);
      expect(engine.getState().error).toBeNull();
    });

    it('looks right after the reply when the beat came while the coach was replying, not at the next beat (D70)', async () => {
      await throughTemplateCards();
      let during = -1;
      scripts.push(() => {
        // Another skin loads a profile while the reply arrives, and the beat comes then (twice, even).
        machine.loaded = otherProfile('Default');
        during = workflowReads();
        checks.fire();
        checks.fire();
        return [text('Loaded. Pull a shot.')];
      });
      await engine.pickTemplate('t-tpl', 'd-flow');
      await drain();
      expect(workflowReads()).toBe(during + 1);
      expect(engine.getState().error).toBe('The machine is running "Default", not Kiambu AA v1. Tap Retry to load it.');
      // Once per profile still (D52): the next beat does not raise it again.
      engine.dismissError();
      checks.fire();
      await drain();
      expect(engine.getState().error).toBeNull();
    });

    it('a look that waited for the reply does not look while a shot is running by then', async () => {
      await throughTemplateCards();
      let during = -1;
      scripts.push(() => {
        // The beat comes while the coach replies, and a shot starts before the reply ends.
        machine.loaded = otherProfile('Default');
        during = workflowReads();
        checks.fire();
        telemetry.setState({ shotState: pouring });
        return [text('Loaded. Pull a shot.')];
      });
      await engine.pickTemplate('t-tpl', 'd-flow');
      await drain();
      expect(workflowReads()).toBe(during);
      expect(engine.getState().error).toBeNull();
    });

    it('looks when the page comes back into view, and not while it is hidden', async () => {
      await throughTemplatePick();
      machine.loaded = otherProfile('Default');
      view.hide();
      const beat = engine.getState().machineTick ?? -1;
      const reads = workflowReads();
      checks.fire();
      await drain();
      expect(engine.getState().machineTick).toBe(beat);
      expect(workflowReads()).toBe(reads);
      view.show();
      expect(engine.getState().machineTick).toBe(beat + 1);
      await vi.waitFor(() => expect(engine.getState().error).toMatch(/"Default"/));
    });

    it('names a same-named profile as another bag’s or version’s, not the same title twice (D41)', async () => {
      await throughTemplatePick();
      // Another bag's "Kiambu AA v1": the same profile, tagged with that bag's version.
      machine.context = { ...machine.context, extras: { cafai: { versionId: 'ver-other', bagId: 'bag-other' } } };
      checks.fire();
      await vi.waitFor(() =>
        expect(engine.getState().error).toBe(
          'The machine is running a different "Kiambu AA v1" (another bag or version). Tap Retry to load this bag\'s version.',
        ),
      );
      engine.dismissError();
      expect(await shotIsCredited('shot-twin')).toBe(false);
      expect(notices().at(-1)).toMatchObject({
        tone: 'warning',
        text: 'That shot ran a different "Kiambu AA v1" (another bag or version), so it is not part of this dial-in.',
      });
      // The banner after the shot; the next beat does not stack the same mismatch on it.
      expect(engine.getState().error).toBe('The machine is not running Kiambu AA v1. Tap Retry to load it.');
      engine.dismissError();
      checks.fire();
      await drain();
      expect(engine.getState().error).toBeNull();
    });

    it('stops looking when disposed', async () => {
      await throughTemplatePick();
      expect(checks.delays()).toEqual([30_000]);
      expect(view.listeners()).toBe(1);
      engine.dispose();
      expect(checks.delays()).toEqual([]);
      expect(view.listeners()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // D55: the active version's load state, for the Profile line
  // -------------------------------------------------------------------------

  describe("the active version's load state (D55)", () => {
    it('is loading while Decaid uploads the version, then loaded', async () => {
      expect(engine.getState().activeLoad).toBeNull();
      await throughTemplateCards();
      machine.barrier = 'hold';
      scripts.push(() => [text('Loaded.')]);
      const picking = engine.pickTemplate('t-tpl', 'd-flow');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      expect(engine.getState().activeLoad).toBe('loading');
      machine.held!.resolve('loaded');
      await picking;
      expect(engine.getState().activeLoad).toBe('loaded');
    });

    it('is failed after a failed barrier or a refusal Decaid reported, until a load works', async () => {
      machine.barrier = busyError();
      await throughTemplatePick();
      expect(engine.getState().activeLoad).toBe('failed');
      machine.barrier = 'loaded';
      await engine.retry();
      expect(engine.getState().activeLoad).toBe('loaded');

      telemetry.setState({
        connectionError: {
          kind: 'profileUploadFailed',
          severity: 'error',
          timestamp: '2026-10-03T08:05:00.000000',
          deviceId: 'de1',
          deviceName: 'DE1',
          message: 'Could not upload the profile to the machine.',
          suggestion: null,
          details: null,
        },
      });
      await vi.waitFor(() => expect(engine.getState().activeLoad).toBe('failed'));
    });

    it('is waiting with no machine, and assumed on an older Decaid', async () => {
      telemetry.setState({ machineConnected: false });
      await throughTemplatePick();
      expect(engine.getState().activeLoad).toBe('waiting');

      machine.barrier = 'unsupported';
      telemetry.setState({ machineConnected: true });
      await drain();
      expect(engine.getState().activeLoad).toBe('assumed');
      await anotherBag('Sumatra', 'londonium');
      expect(engine.getState().activeLoad).toBe('assumed');
    });

    it('is unknown after a reload, until CafAI loads a version', async () => {
      await throughTemplatePick();
      const v1 = machine.loaded;
      engine.dispose();
      engine = build();
      machine.loaded = v1;
      await engine.start();
      expect(engine.getState().activeVersion?.title).toBe('Kiambu AA v1');
      expect(engine.getState().activeLoad).toBeNull();
      expect(engine.getState().machineTick).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Undo marks only the iteration whose confirmed change made the version
  // -------------------------------------------------------------------------

  describe('undo and the iterations', () => {
    const askTasteAgain = (id: string) =>
      toolUse(id, TOOL.askUser, { question: 'How did it taste?', options: ['Sour', 'Bitter', 'other'], multiSelect: false });
    /** Brew temperature to `value` °C: a new version on Confirm. */
    const tempTo = (id: string, value: number) => toolUse(id, TOOL.proposeAdjustment, { ...(proposeTemp as { input: object }).input, value });
    /** A by-hand move at the grinder: no new version. */
    const grindFiner = toolUse('t-grind', TOOL.proposeAdjustment, {
      variable: 'grind',
      lever: null,
      value: null,
      grind: { direction: 'finer', amount: 1, setting: '13' },
      summary: 'Grind 1 step finer, to 13',
      rationale: 'It ran fast.',
      expectedEffect: 'A slower shot that extracts a little more.',
      tips: [],
    });

    /** A shot on the active version a minute after the last one; the coach asks how it tasted. */
    async function pullShot(shotId: string, askId: string) {
      nowMs += 60_000;
      scripts.push(() => [text('Got it.'), askTasteAgain(askId)]);
      telemetry.emitShot({ type: 'finished', shotId, stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    }

    /** Shot 1 on v1, answered; v2 (88 -> 89 °C) confirmed on its iteration. */
    async function throughV2() {
      await throughProposal();
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(engine.getState().activeVersion?.version).toBe(2);
    }

    async function undo(reply: string) {
      scripts.push(() => [text(reply)]);
      await engine.undo();
    }

    const versionStatuses = () => engine.getState().versions.map((v) => `${v.version}:${v.status}`);
    const outcomes = async () => (await storage.iterations.listAll()).map((i) => [i.shotId, i.change?.variable ?? null, i.outcome]);

    it('marks the iteration whose confirmed change made the version', async () => {
      await throughV2();
      await undo('Back on v1.');
      expect(versionStatuses()).toEqual(['1:active', '2:undone']);
      expect(await outcomes()).toEqual([['shot-1', 'profile', 'undone']]);
    });

    it('marks only the later of two versioned changes in a row, and the earlier on a second undo', async () => {
      await throughV2();
      await pullShot('shot-2', 't-ask-2');
      scripts.push(() => [tempTo('t-adj-2', 90)]);
      await engine.answerOptions('t-ask-2', ['Sour'], null);
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj-2');
      expect(engine.getState().activeVersion?.version).toBe(3);

      await undo('Back on v2.');
      expect(versionStatuses()).toEqual(['1:superseded', '2:active', '3:undone']);
      expect(await outcomes()).toEqual([
        ['shot-1', 'profile', 'applied'],
        ['shot-2', 'profile', 'undone'],
      ]);

      await undo('Back on v1.');
      expect(versionStatuses()).toEqual(['1:active', '2:undone', '3:undone']);
      expect(await outcomes()).toEqual([
        ['shot-1', 'profile', 'undone'],
        ['shot-2', 'profile', 'undone'],
      ]);
    });

    it('changes no iteration when the version came from a typed request, not even a by-hand change before it (D76)', async () => {
      await throughV2();
      // Shot 2 on v2: a by-hand grind move, confirmed.
      await pullShot('shot-2', 't-ask-2');
      scripts.push(() => [grindFiner]);
      await engine.answerOptions('t-ask-2', ['Sour'], null);
      scripts.push(() => [text('Turn the dial, then pull another shot.')]);
      await engine.confirmChange('t-grind');
      // Shot 3 on v2: v3 proposed, Not now.
      await pullShot('shot-3', 't-ask-3');
      scripts.push(() => [tempTo('t-adj-3', 90)]);
      await engine.answerOptions('t-ask-3', ['Sour'], null);
      scripts.push(() => [text('Staying on v2.')]);
      await engine.declineChange('t-adj-3');
      // Typed: v3 again, confirmed. No iteration waits for a decision, so none records it.
      scripts.push(() => [tempTo('t-adj-3b', 90)]);
      await engine.sendText('I want the hotter one after all.');
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj-3b');
      expect(engine.getState().activeVersion?.version).toBe(3);

      await undo('Back on v2.');
      expect(versionStatuses()).toEqual(['1:superseded', '2:active', '3:undone']);
      expect(await outcomes()).toEqual([
        ['shot-1', 'profile', 'applied'],
        ['shot-2', 'grind', 'applied'],
        ['shot-3', null, 'declined'],
      ]);
      // The rest of Undo is as before: the v3 card that was applied says undone.
      const diffs = allParts().filter((p): p is Extract<CoachUiPart, { kind: 'diff' }> => p.kind === 'diff');
      expect(diffs.map((d) => [d.requestId, d.status])).toEqual([
        ['t-adj', 'applied'],
        ['t-grind', 'applied'],
        ['t-adj-3', 'declined'],
        ['t-adj-3b', 'undone'],
      ]);
      expect(notices().at(-2)).toMatchObject({ text: 'Back on Kiambu AA v2.' });
    });
  });

  // -------------------------------------------------------------------------
  // What the cards say, and which answer is the shot's taste
  // -------------------------------------------------------------------------

  describe('cards and the taste', () => {
    const askPuck = (id: string) =>
      toolUse(id, TOOL.askUser, {
        question: 'What does the puck look like?',
        options: ['Pinholes', 'Wet patches', 'Looks even'],
        multiSelect: true,
      });
    const askTasteAs = (id: string) =>
      toolUse(id, TOOL.askUser, { question: 'How did it taste?', options: ['Sour', 'Bitter', 'other'], multiSelect: false });
    const keepRecipe = toolUse('t-keep', TOOL.proposeAdjustment, {
      variable: 'none',
      lever: null,
      value: null,
      grind: null,
      summary: 'Keep this recipe',
      rationale: 'Balanced and sweet at 30 s.',
      expectedEffect: 'The same cup again.',
      tips: [],
    });
    const optionCards = () => allParts().filter((p): p is Extract<CoachUiPart, { kind: 'options' }> => p.kind === 'options');
    const diffCards = () => allParts().filter((p): p is Extract<CoachUiPart, { kind: 'diff' }> => p.kind === 'diff');
    const card = (requestId: string) => allParts().find((p) => 'requestId' in p && p.requestId === requestId);
    const feedback = async () => (await storage.iterations.listAll())[0]!.feedback;
    const userBubbles = () =>
      engine
        .getState()
        .messages.filter((m) => m.role === 'user')
        .flatMap((m) => m.parts.map((p) => (p.kind === 'text' ? p.text : '')));

    /** Shot 1 on v1; the coach answers it with `ask`. */
    async function throughShotAsking(ask: ContentBlock) {
      await throughTemplatePick();
      scripts.push(() => [text('Got it.'), ask]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    }

    it('marks a proposal to keep the recipe as a keep card, and no other change', async () => {
      await throughShot();
      scripts.push(() => [text('That is the cup. Keep it.'), keepRecipe]);
      await engine.answerOptions('t-ask', ['Other'], 'Balanced and sweet');
      expect(diffCards()).toEqual([expect.objectContaining({ requestId: 't-keep', keep: true, versionLabel: null, lines: [], manualSteps: [] })]);

      scripts.push(() => [text('Pull the next one the same way.')]);
      await engine.confirmChange('t-keep');
      expect(card('t-keep')).toMatchObject({ status: 'applied', keep: true });
      expect((await storage.iterations.listAll())[0]!.outcome).toBe('kept');

      // A change made by hand, or one that makes a version, is no keep card.
      await pullAnother('shot-2', 't-ask-2');
      scripts.push(() => [toolUse('t-adj-2', TOOL.proposeAdjustment, { ...(proposeTemp as { input: object }).input })]);
      await engine.answerOptions('t-ask-2', ['Sour'], null);
      expect(card('t-adj-2')).not.toHaveProperty('keep');
    });

    async function pullAnother(shotId: string, askId: string) {
      nowMs += 60_000;
      scripts.push(() => [text('Got it.'), askTasteAs(askId)]);
      telemetry.emitShot({ type: 'finished', shotId, stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(card(askId)).toBeDefined());
    }

    it('records that a card was set aside because the barista typed in the chat', async () => {
      await throughShot();
      scripts.push(() => [text('Noted.')]);
      await engine.sendText('Can you explain the curve first?');
      expect(card('t-ask')).toMatchObject({ expired: true, setAsideReason: 'typed' });
    });

    it('records that a card was set aside because a new shot came in', async () => {
      await throughShot();
      await pullAnother('shot-2', 't-ask-2');
      expect(card('t-ask')).toMatchObject({ expired: true, setAsideReason: 'shot' });
      expect(card('t-ask-2')).not.toHaveProperty('expired');
      // The coach hears what it always heard.
      expect(parsed(lastUserTurn(requests)[0])).toEqual({ answered: false, note: 'A new shot was pulled instead.' });
    });

    it('records that a card was set aside because the barista tapped Undo', async () => {
      await throughProposal();
      scripts.push(() => [text('Done. One more step while we are here:'), toolUse('t-adj-2', TOOL.proposeAdjustment, { ...(proposeTemp as { input: object }).input, value: 90 })]);
      await engine.confirmChange('t-adj');
      expect(engine.getState().canUndo).toBe(true);
      expect(card('t-adj-2')).toMatchObject({ status: 'pending' });

      scripts.push(() => [text('Back on v1.')]);
      await engine.undo();
      expect(card('t-adj-2')).toMatchObject({ status: 'expired', setAsideReason: 'undo' });
      expect(parsed(lastUserTurn(requests)[0])).toEqual({ answered: false, note: 'The user undid the last change.' });
    });

    it('records that a card was set aside for anything else: here another card of the same turn was answered', async () => {
      await throughShot();
      scripts.push(() => [text('Two things.'), askPuck('t-puck'), proposeTemp]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      scripts.push(() => [text('Done.')]);
      await engine.confirmChange('t-adj');
      expect(card('t-puck')).toMatchObject({ expired: true, setAsideReason: 'other' });
      expect(card('t-adj')).toMatchObject({ status: 'applied' });
      expect(card('t-adj')).not.toHaveProperty('setAsideReason');
    });

    it('marks the question about the taste, and not a question about the puck', async () => {
      await throughShot();
      scripts.push(() => [text('And the puck?'), askPuck('t-puck')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      expect(optionCards().map((p) => [p.requestId, p.taste])).toEqual([
        ['t-ask', true],
        ['t-puck', false],
      ]);
    });

    it('keeps the answer to another question out of the taste: no feedback, no notes line', async () => {
      await throughShotAsking(askPuck('t-puck'));
      scripts.push(() => [text('Pinholes mean channels.')]);
      await engine.answerOptions('t-puck', ['Pinholes', 'Wet patches'], null);
      await drain();
      expect(await feedback()).toBeNull();
      expect(callsOf('updateShot')).toEqual([]);
      // It stays in the chat and reaches the coach as before.
      expect(userBubbles().at(-1)).toBe('Pinholes, Wet patches');
      expect(parsed(lastUserTurn(requests)[0])).toEqual({ selected: ['Pinholes', 'Wet patches'], other: null });
    });

    it('keeps the taste answer when the coach asks a follow-up about something else', async () => {
      await throughShot();
      scripts.push(() => [text('And the puck?'), askPuck('t-puck')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      await vi.waitFor(() => expect(callsOf('updateShot')).toHaveLength(1));
      scripts.push(() => [text('Pinholes mean channels.')]);
      await engine.answerOptions('t-puck', ['Pinholes'], 'near the edge');
      await drain();
      expect(await feedback()).toEqual({ question: 'How did it taste?', selected: ['Sour'], otherText: null });
      expect(callsOf('updateShot')).toHaveLength(1);
      expect(machine.annotations.get('shot-1')?.espressoNotes).toBe('Taste: Sour. Kiambu AA v1 (CafAI)');
    });

    it('still takes what was typed under Other on the taste question as the taste', async () => {
      await throughShot();
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Other'], 'Sweet but hollow');
      expect(await feedback()).toEqual({ question: 'How did it taste?', selected: ['Other'], otherText: 'Sweet but hollow' });
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')?.espressoNotes).toBe('Taste: Sweet but hollow. Kiambu AA v1 (CafAI)'));
    });

    it('keeps text typed while another question is open out of the taste', async () => {
      await throughShotAsking(askPuck('t-puck'));
      scripts.push(() => [text('Noted.')]);
      await engine.sendText('A few pinholes near the edge');
      await drain();
      expect(await feedback()).toBeNull();
      expect(callsOf('updateShot')).toEqual([]);
      expect(card('t-puck')).toMatchObject({ expired: true, setAsideReason: 'typed' });
    });

    it('stops asking for a confirmation once Confirm is tapped, while the change applies and loads', async () => {
      await throughProposal();
      const seen: string[] = [];
      engine.subscribe(() => {
        const status = diffCards()[0]?.status;
        const entry = `${status}:${engine.getState().phase}`;
        if (status !== 'pending' && seen.at(-1) !== entry) seen.push(entry);
      });
      machine.barrier = 'hold';
      scripts.push(() => [text('Done.')]);
      const confirming = engine.confirmChange('t-adj');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      expect(progressNotices().map((p) => p.text)).toEqual(['Loading Kiambu AA v2 on the machine…']);
      expect(engine.getState().phase).toBe('awaiting_shot');
      machine.held!.resolve('loaded');
      await confirming;
      expect(seen[0]).toBe('applying:awaiting_shot');
      expect(seen.filter((entry) => entry.endsWith(':awaiting_confirmation'))).toEqual([]);
    });

    it('asks for the confirmation again when the change could not be loaded', async () => {
      await throughProposal();
      machine.failActivations = 1;
      await engine.confirmChange('t-adj');
      expect(card('t-adj')).toMatchObject({ status: 'pending' });
      expect(engine.getState().phase).toBe('awaiting_confirmation');
    });
  });

  // -------------------------------------------------------------------------
  // D102: bags in Decaid's bean library
  // -------------------------------------------------------------------------

  describe("Decaid's bean library (D102)", () => {
    const ADDED = "Added to Decaid's beans.";
    const bag = () => engine.getState().activeBag;

    beforeEach(() => {
      machine.beanLibrary = true;
    });

    async function throughIntake(details: ContentBlock = saveBag) {
      await engine.newBag();
      scripts.push(() => [text('Lovely.'), details, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
    }

    /** The coach saves the bag's details again, as after a correction in the chat. */
    async function savedAgain(details: Record<string, unknown>) {
      scripts.push(() => [toolUse('t-save-again', TOOL.saveBagDetails, details)]);
      scripts.push(() => [text('Noted.')]);
      await engine.sendText('One more thing about the bag.');
    }

    const KIAMBU = { name: 'Kiambu AA', roaster: 'Square Mile', origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null };

    it('adds the bag to Decaid as a bean and a batch, links both, and says so once', async () => {
      await throughIntake();
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      expect(bag()).toMatchObject({ decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' });
      expect(await storage.bags.get(bag()!.id)).toMatchObject({ decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' });
      expect(callsOf('createBean').map((c) => c.args[0])).toEqual([
        { roaster: 'Square Mile', name: 'Kiambu AA', country: 'Kenya', processing: 'washed' },
      ]);
      expect(callsOf('createBatch').map((c) => c.args)).toEqual([['bean-1', { roastLevel: 'light' }]]);
      expect(notices().filter((p) => p.text === ADDED)).toEqual([{ kind: 'notice', tone: 'info', text: ADDED }]);
    });

    it('writes the linked batch into every load, with the coffee and its roaster (6.1)', async () => {
      await throughIntake();
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      expect(callsOf('activateProfile').at(-1)!.args[1]).toMatchObject({
        beanBatchId: 'batch-1',
        coffeeName: 'Kiambu AA',
        coffeeRoaster: 'Square Mile',
      });
    });

    it('reuses a bean with the same roaster and name, whatever the case and the spaces around them', async () => {
      machine.beans.push({ id: 'bean-9', roaster: ' square mile ', name: 'KIAMBU AA', archived: false });
      await throughIntake();
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      expect(callsOf('createBean')).toEqual([]);
      expect(callsOf('createBatch').map((c) => c.args[0])).toEqual(['bean-9']);
      expect(bag()).toMatchObject({ decaidBeanId: 'bean-9' });
    });

    describe("a reused bean's batch (a photo of a bag already in the library)", () => {
      const batchOf = (id: string, roastDate: string | null, archived = false): BeanBatch => ({
        id,
        beanId: 'bean-9',
        ...(roastDate ? { roastDate } : {}),
        frozen: false,
        archived,
      });

      beforeEach(() => {
        machine.beans.push({ id: 'bean-9', roaster: 'Square Mile', name: 'Kiambu AA', archived: false });
      });

      it('reuses the batch with the same roast date, never an archived one, and adds no second batch', async () => {
        machine.batches.push(batchOf('batch-gone', '2026-09-28T00:00:00.000Z', true), batchOf('batch-28', '2026-09-28T00:00:00.000Z'), batchOf('batch-30', '2026-09-30'));
        await throughIntake(toolUse('t-save', TOOL.saveBagDetails, { ...KIAMBU, roastDate: '2026-09-28' }));
        await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-28'));
        expect(bag()).toMatchObject({ decaidBeanId: 'bean-9' });
        expect(callsOf('createBatch')).toEqual([]);
        // Nothing was added, so the note does not say it was.
        expect(notices().map((p) => p.text)).toContain("Already in Decaid's beans.");
        expect(notices().some((p) => p.text === ADDED)).toBe(false);
      });

      it('adds a batch for a bag without a roast date: an undated batch may be an earlier bag of the same coffee', async () => {
        machine.batches.push(batchOf('batch-28', '2026-09-28'), batchOf('batch-undated', null));
        await throughIntake();
        await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-3'));
        expect(callsOf('createBatch').map((c) => c.args)).toEqual([['bean-9', { roastLevel: 'light' }]]);
        expect(notices().filter((p) => p.text === ADDED)).toHaveLength(1);
        expect(notices().some((p) => p.text === "Already in Decaid's beans.")).toBe(false);
      });

      it('adds a batch when none has the same roast date', async () => {
        machine.batches.push(batchOf('batch-28', '2026-09-28'));
        await throughIntake(toolUse('t-save', TOOL.saveBagDetails, { ...KIAMBU, roastDate: '2026-10-02' }));
        await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-2'));
        expect(callsOf('createBatch').map((c) => c.args)).toEqual([['bean-9', { roastDate: '2026-10-02', roastLevel: 'light' }]]);
        expect(notices().filter((p) => p.text === ADDED)).toHaveLength(1);
      });
    });

    it('gives a second bag of the same coffee a batch of its own when neither has a roast date', async () => {
      await throughIntake();
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      const first = bag()!.id;
      // The coffee bought again, described the same way.
      await engine.newBag();
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA again, light, washed');
      expect(bag()!.id).not.toBe(first);
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-2'));
      expect(bag()).toMatchObject({ decaidBeanId: 'bean-1' });
      expect(callsOf('createBean')).toHaveLength(1);
      expect(notices().map((p) => p.text)).toContain(ADDED);
      expect(notices().some((p) => p.text === "Already in Decaid's beans.")).toBe(false);
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      expect(callsOf('activateProfile').at(-1)!.args[1]).toMatchObject({ beanBatchId: 'batch-2' });
    });

    it('adds nothing for a bag without a name of its own: the placeholder "New bag" names no coffee', async () => {
      await throughIntake(toolUse('t-save', TOOL.saveBagDetails, { ...KIAMBU, name: 'New bag' }));
      await drain();
      expect(bag()).toMatchObject({ name: 'New bag', roaster: 'Square Mile' });
      // The bean card's own read only.
      expect(callsOf('listBeans')).toHaveLength(1);
      expect(callsOf('createBean')).toEqual([]);
      expect(bag()?.decaidBatchId ?? null).toBeNull();
      expect(notices().some((p) => p.text === ADDED)).toBe(false);
    });

    it('adds nothing for a bag without a roaster, since Decaid needs one', async () => {
      await throughIntake(toolUse('t-save', TOOL.saveBagDetails, { ...KIAMBU, roaster: null }));
      await drain();
      expect(callsOf('listBeans')).toHaveLength(1);
      expect(callsOf('createBean')).toEqual([]);
      expect(bag()?.decaidBatchId ?? null).toBeNull();
      expect(notices().some((p) => p.text === ADDED)).toBe(false);
    });

    it('leaves the bag unlinked while Decaid is away, says nothing, and tries again at the next save', async () => {
      await openBag();
      machine.failBeanCalls = 1;
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      // The bean card's read, then the failed one.
      await vi.waitFor(() => expect(callsOf('listBeans')).toHaveLength(2));
      await drain();
      expect(bag()?.decaidBatchId ?? null).toBeNull();
      expect(callsOf('createBean')).toEqual([]);
      expect(notices().some((p) => p.text === ADDED)).toBe(false);

      await savedAgain(KIAMBU);
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      expect(callsOf('createBean')).toHaveLength(1);
    });

    it('never edits or deletes a bean or batch: a detail corrected later changes the bag only', async () => {
      await throughIntake();
      await vi.waitFor(() => expect(bag()?.decaidBatchId).toBe('batch-1'));
      await savedAgain({ ...KIAMBU, name: 'Kiambu AA Peaberry' });
      await drain();
      expect(bag()).toMatchObject({ name: 'Kiambu AA Peaberry', decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' });
      // The bean card's read, then adding the bag; nothing after.
      expect(apiCalls.map((c) => c.method).filter((method) => /bean|batch/i.test(method))).toEqual([
        'listBeans',
        'listAllBatches',
        'listBeans',
        'createBean',
        'createBatch',
      ]);
      expect(machine.beans.map((bean) => bean.name)).toEqual(['Kiambu AA']);
      expect(machine.batches).toHaveLength(1);
    });

    it('links the bag it saved even when another bag is on screen by then', async () => {
      await openBag();
      machine.holdBeanCalls = true;
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      const kiambu = bag()!.id;
      // The next bag's card reads the library after the held calls are let go.
      const opening = engine.newBag();
      releaseBeanCalls();
      await opening;
      const other = bag()!.id;
      expect(other).not.toBe(kiambu);
      await vi.waitFor(async () => expect(await storage.bags.get(kiambu)).toMatchObject({ decaidBatchId: 'batch-1' }));
      await drain();
      expect(engine.getState().bags.find((b) => b.id === kiambu)).toMatchObject({ decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' });
      expect(bag()!.id).toBe(other);
      expect(bag()?.decaidBatchId ?? null).toBeNull();
      expect(notices().some((p) => p.text === ADDED)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 6.1: "Which coffee is it?", Decaid's bean library at intake
  // -------------------------------------------------------------------------

  const RED_BRICK: Bean = {
    id: 'bean-red',
    roaster: 'Square Mile Coffee Roasters',
    name: 'Red Brick',
    country: 'Brazil',
    region: 'Mogiana',
    processing: 'washed',
    notes: 'Chocolate, plum',
    archived: false,
  };
  const CHELCHELE: Bean = { id: 'bean-chel', roaster: 'Heart Coffee Roasters', name: 'Ethiopia Chelchele', country: 'Ethiopia', region: 'Guji', processing: 'natural', archived: false };
  const libraryBatch = (id: string, beanId: string, fields: Partial<BeanBatch> = {}): BeanBatch => ({
    id,
    beanId,
    frozen: false,
    archived: false,
    createdAt: '2026-09-01T08:00:00.000',
    ...fields,
  });
  /** A library like the mock's: two beans, a frozen batch, an archived one and one without a roast date. */
  function stockLibrary() {
    machine.beanLibrary = true;
    machine.beans = [RED_BRICK, CHELCHELE, { id: 'bean-old', roaster: 'Gone', name: 'Archived bean', archived: true }];
    machine.batches = [
      libraryBatch('batch-red-old', 'bean-red', { roastDate: '2026-08-01T00:00:00.000', roastLevel: 'Medium' }),
      libraryBatch('batch-red', 'bean-red', { roastDate: '2026-09-24T00:00:00.000', roastLevel: 'Medium' }),
      libraryBatch('batch-chel', 'bean-chel', {
        roastDate: '2026-09-03T00:00:00.000',
        roastLevel: 'Light',
        freezeDate: '2026-09-04T00:00:00.000',
        unfreezeDate: '2026-09-16T00:00:00.000',
      }),
      libraryBatch('batch-chel-gone', 'bean-chel', { roastDate: '2026-09-30T00:00:00.000', archived: true }),
      libraryBatch('batch-undated', 'bean-red', { createdAt: '2026-09-20T08:00:00.000' }),
      libraryBatch('batch-old-bean', 'bean-old', { roastDate: '2026-09-29T00:00:00.000' }),
    ];
  }
  type BeanCardPart = Extract<CoachUiPart, { kind: 'beanPicker' }>;
  type BagConfirmPart = Extract<CoachUiPart, { kind: 'bagConfirm' }>;
  const beanCard = () => allParts().find((p): p is BeanCardPart => p.kind === 'beanPicker');
  const confirmCard = () => allParts().find((p): p is BagConfirmPart => p.kind === 'bagConfirm');
  /** The [context] block of the latest intake turn, parsed. */
  const intakeContext = () => JSON.parse((requests[0]![0]!.content[1] as { text: string }).text.split('\n')[1]!);
  const roastToday = (date: string, freezer: { freezeDate: string | null; unfreezeDate: string | null } | null = null) =>
    roastLine(date, new Date(nowMs), freezer);

  describe('the bean card (6.1)', () => {
    it("asks which coffee it is first, with Decaid's batches newest roast first, then the coach's question", async () => {
      stockLibrary();
      await openBag();
      const [card, question] = engine.getState().messages;
      expect(question!.parts).toEqual([{ kind: 'text', text: NEW_BAG_PROMPT }]);
      const part = card!.parts[0] as BeanCardPart;
      expect(part.kind).toBe('beanPicker');
      expect(part.choice).toBeNull();
      expect(part.options.map((option) => option.batchId)).toEqual(['batch-red', 'batch-chel', 'batch-red-old', 'batch-undated']);
      expect(part.options[0]).toEqual({
        beanId: 'bean-red',
        batchId: 'batch-red',
        name: 'Red Brick',
        roaster: 'Square Mile Coffee Roasters',
        origin: 'Brazil, Mogiana',
        process: 'washed',
        notes: 'Chocolate, plum',
        roastLevel: 'medium',
        roastDate: '2026-09-24',
        freezeDate: null,
        unfreezeDate: null,
      });
      expect(part.options[1]).toMatchObject({ roastLevel: 'light', freezeDate: '2026-09-04', unfreezeDate: '2026-09-16' });
      expect(part.options[3]).toMatchObject({ roastDate: null, roastLevel: null });
      expect(engine.getState().phase).toBe('intake');
      // Two requests, whatever the size of the library: the beans, and every batch at once.
      expect(apiCalls.map((c) => c.method).filter((method) => /bean|batch/i.test(method))).toEqual(['listBeans', 'listAllBatches']);
    });

    it("shows the card at once, looking in Decaid's beans, and its rows once they are read", async () => {
      stockLibrary();
      machine.holdBeanCalls = true;
      await engine.newBag();
      expect(beanCard()).toMatchObject({ options: [], choice: null, loading: true });
      expect(engine.getState().messages[1]!.parts).toEqual([{ kind: 'text', text: NEW_BAG_PROMPT }]);
      expect(engine.getState().busy).toBe(false);
      // The barista can answer meanwhile: nothing waits for Decaid.
      await engine.declineChange('no-such-card');
      releaseBeanCalls();
      await vi.waitFor(() => expect(beanCard()).not.toHaveProperty('loading'));
      expect(beanCard()!.options.map((option) => option.batchId)).toEqual(['batch-red', 'batch-chel', 'batch-red-old', 'batch-undated']);
      const stored = await storage.conversations.get(engine.getState().activeBag!.conversationId);
      expect(stored!.uiMessages[0]!.parts[0]).toEqual(beanCard());
    });

    it('looks again after a reload that came while the card was still looking', async () => {
      stockLibrary();
      machine.holdBeanCalls = true;
      await engine.newBag();
      const firstReads = machine.heldBeanCalls.splice(0);
      expect(firstReads).toHaveLength(2);
      engine.dispose();
      engine = build();
      // The rebuilt machine starts afresh: the same library, its reads held again.
      stockLibrary();
      machine.holdBeanCalls = true;
      await engine.start();
      expect(beanCard()).toMatchObject({ loading: true });
      const storedCard = async () => (await storage.conversations.get(engine.getState().activeBag!.conversationId))!.uiMessages[0]!.parts[0];
      // The first engine's reads answer after the reload: it is gone, and writes nothing.
      for (const release of firstReads) release();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await storedCard()).toMatchObject({ loading: true });
      releaseBeanCalls();
      await vi.waitFor(() => expect(beanCard()).not.toHaveProperty('loading'));
      expect(beanCard()!.options).toHaveLength(4);
      await drain();
      expect(await storedCard()).toEqual(beanCard());
    });

    it('lets the barista answer while the card is still looking, and fills the rows on the card answered', async () => {
      stockLibrary();
      machine.holdBeanCalls = true;
      await engine.newBag();
      await engine.skipBeanPick();
      expect(beanCard()).toMatchObject({ choice: { kind: 'other' }, loading: true });
      releaseBeanCalls();
      await vi.waitFor(() => expect(beanCard()).not.toHaveProperty('loading'));
      expect(beanCard()).toMatchObject({ choice: { kind: 'other' } });
      expect(beanCard()!.options).toHaveLength(4);
    });

    it('lists at most eight batches, and cuts a long name to fit a profile title', async () => {
      machine.beanLibrary = true;
      machine.beans = [{ ...RED_BRICK, name: 'Red Brick Seasonal Espresso Blend, Autumn Edition' }];
      machine.batches = Array.from({ length: 10 }, (_, i) => libraryBatch(`batch-${i}`, 'bean-red', { roastDate: `2026-09-${String(10 + i)}` }));
      await openBag();
      expect(beanCard()!.options).toHaveLength(8);
      expect(beanCard()!.options[0]).toMatchObject({ batchId: 'batch-9', name: 'Red Brick Seasonal Espresso Blend, Autum' });
    });

    it('offers only a photo and something else when Decaid is out of reach', async () => {
      stockLibrary();
      machine.failBeanCalls = 1;
      await openBag();
      expect(beanCard()).toMatchObject({ options: [], choice: null });
      expect(beanCard()).not.toHaveProperty('loading');
      expect(engine.getState().messages[1]!.parts).toEqual([{ kind: 'text', text: NEW_BAG_PROMPT }]);
    });

    it("offers nothing to pick on a Decaid without the bean library's routes", async () => {
      await openBag();
      expect(beanCard()).toMatchObject({ options: [], choice: null });
      expect(engine.getState().messages[1]!.parts).toEqual([{ kind: 'text', text: NEW_BAG_PROMPT }]);
    });

    it('fills the bag from the batch, links both ids first, closes the card, and starts the intake with what was picked', async () => {
      stockLibrary();
      await openBag();
      scripts.push(() => [text('Lovely.'), toolUse('t-save', TOOL.saveBagDetails, { ...savedRedBrick(), roastDate: '2026-09-24' }), proposeTemplates]);
      await engine.pickBean('batch-red');
      expect(engine.getState().activeBag).toMatchObject({
        name: 'Red Brick',
        roaster: 'Square Mile Coffee Roasters',
        origin: 'Brazil, Mogiana',
        process: 'washed',
        notes: 'Chocolate, plum',
        roastLevel: 'medium',
        roastDate: '2026-09-24',
        decaidBeanId: 'bean-red',
        decaidBatchId: 'batch-red',
      });
      expect(beanCard()!.choice).toEqual({ kind: 'batch', batchId: 'batch-red' });
      const intake = requests[0]![0]!.content;
      expect(intake[0]).toEqual({
        type: 'text',
        text: "The user picked Red Brick by Square Mile Coffee Roasters from Decaid's bean library: Brazil, Mogiana; washed; medium roast; roasted 2026-09-24; tasting notes: Chocolate, plum.",
      });
      expect(intakeContext()).toMatchObject({
        bag: { name: 'Red Brick', roaster: 'Square Mile Coffee Roasters', origin: 'Brazil, Mogiana', roastLevel: 'medium', process: 'washed', notes: 'Chocolate, plum', roastDate: '2026-09-24' },
        roast: roastToday('2026-09-24'),
      });
      expect(engine.getState().phase).toBe('choosing_template');
      // The coach saved the details again: the bag was linked already, so Decaid gets no second bean or batch.
      await drain();
      expect(callsOf('createBean')).toEqual([]);
      expect(callsOf('createBatch')).toEqual([]);
      expect(await storage.bags.get(engine.getState().activeBag!.id)).toMatchObject({ decaidBeanId: 'bean-red', decaidBatchId: 'batch-red' });
    });

    it('tells the coach the age without the days the batch spent frozen', async () => {
      stockLibrary();
      await openBag();
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.pickBean('batch-chel');
      const roast = intakeContext().roast as string;
      expect(roast).toBe(roastToday('2026-09-03', { freezeDate: '2026-09-04', unfreezeDate: '2026-09-16' }));
      expect(roast).toMatch(/; 12 days in the freezer not counted\)$/);
    });

    it("closes the card on Something else, and what is typed next is today's intake", async () => {
      stockLibrary();
      await openBag();
      await engine.skipBeanPick();
      expect(beanCard()!.choice).toEqual({ kind: 'other' });
      expect(requests).toEqual([]);
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      expect(requests[0]![0]!.content[0]).toEqual({ type: 'text', text: 'Kiambu AA, light, washed' });
      expect(intakeContext()).toMatchObject({ bag: null, roast: null });
      expect(engine.getState().activeBag).toMatchObject({ name: 'Kiambu AA' });
    });

    it('sets the card aside when the bag is described in the chat instead', async () => {
      stockLibrary();
      await openBag();
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      expect(beanCard()).toMatchObject({ choice: null, expired: true, setAsideReason: 'typed' });
      // A tap on the card set aside does nothing.
      await engine.pickBean('batch-red');
      expect(engine.getState().activeBag).toMatchObject({ name: 'Kiambu AA' });
      expect(engine.getState().activeBag?.decaidBatchId).not.toBe('batch-red');
      expect(requests).toHaveLength(1);
    });

    it('rebuilds an open card from the stored chat after a reload, and a pick still works', async () => {
      stockLibrary();
      await openBag();
      engine.dispose();
      engine = build();
      await engine.start();
      expect(beanCard()).toMatchObject({ choice: null, options: [expect.objectContaining({ batchId: 'batch-red' }), expect.anything(), expect.anything(), expect.anything()] });
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.pickBean('batch-red');
      expect(engine.getState().activeBag).toMatchObject({ decaidBatchId: 'batch-red' });
      expect(engine.getState().phase).toBe('choosing_template');
    });

    it('ignores a batch the card does not offer, and an answer once the card is closed', async () => {
      stockLibrary();
      await openBag();
      await engine.pickBean('batch-chel-gone');
      expect(beanCard()!.choice).toBeNull();
      await engine.skipBeanPick();
      await engine.skipBeanPick();
      await engine.pickBean('batch-red');
      expect(beanCard()!.choice).toEqual({ kind: 'other' });
      expect(requests).toEqual([]);
    });
  });

  /** What the coach saves for Red Brick (the scripted save_bag_details input), without the roast date. */
  function savedRedBrick() {
    return { name: 'Red Brick', roaster: 'Square Mile Coffee Roasters', origin: 'Brazil, Mogiana', roastLevel: 'medium', process: 'washed', notes: 'Chocolate, plum' };
  }

  // -------------------------------------------------------------------------
  // 6.8: a photo of the bag
  // -------------------------------------------------------------------------

  describe('the bag photo (6.8)', () => {
    const PHOTO: BagPhoto = { mediaType: 'image/jpeg', data: 'UEhPVE8tT0YtVEhFLUJBRy1ieXRlcw==' };
    const READ: ExtractedBag = {
      name: 'Kiambu AA',
      roaster: 'Square Mile',
      origin: 'Kenya, Kiambu',
      process: 'washed',
      roastLevel: 'light',
      roastDate: '2026-09-28',
      notes: 'blackcurrant, grapefruit',
    };
    const CONFIRMED = { ...READ, name: 'Kiambu AA' };

    it("reads the photo with the coach's model, closes the bean card and shows the details to confirm", async () => {
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      expect(reader.asked).toEqual([{ model: 'claude-opus-5-5', photo: PHOTO }]);
      expect(beanCard()!.choice).toEqual({ kind: 'photo' });
      expect(confirmCard()).toEqual({ kind: 'bagConfirm', details: READ, confirmed: false });
      expect(engine.getState().busy).toBe(false);
      expect(progressNotices()).toEqual([]);
      expect(requests).toEqual([]);
    });

    it('leaves a name the bag does not show empty, for the barista to fill in', async () => {
      reader.answer = { ...READ, name: null };
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      expect(confirmCard()!.details.name).toBe('');
    });

    it("saves the confirmed details like save_bag_details, adds the bean to Decaid, and starts the intake with them", async () => {
      machine.beanLibrary = true;
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.confirmBag({ ...CONFIRMED, notes: 'blackcurrant, grapefruit, brown sugar' });
      expect(confirmCard()).toMatchObject({ confirmed: true, details: { notes: 'blackcurrant, grapefruit, brown sugar' } });
      expect(engine.getState().activeBag).toMatchObject({ name: 'Kiambu AA', roaster: 'Square Mile', roastDate: '2026-09-28', notes: 'blackcurrant, grapefruit, brown sugar' });
      expect(requests[0]![0]!.content[0]).toEqual({
        type: 'text',
        text: 'The user confirmed these details read from a photo of the bag: Kiambu AA by Square Mile; Kenya, Kiambu; washed; light roast; roasted 2026-09-28; tasting notes: blackcurrant, grapefruit, brown sugar.',
      });
      expect(intakeContext()).toMatchObject({ bag: { name: 'Kiambu AA', roastDate: '2026-09-28' }, roast: roastToday('2026-09-28') });
      // Added to Decaid's bean library as any saved bag is, the roast date with the batch.
      await vi.waitFor(() => expect(engine.getState().activeBag?.decaidBatchId).toBe('batch-1'));
      expect(callsOf('createBatch').map((c) => c.args)).toEqual([['bean-1', { roastDate: '2026-09-28', roastLevel: 'light' }]]);
    });

    it('keeps the photo out of storage and out of every request but the one that read it', async () => {
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.confirmBag(CONFIRMED);
      const kept = JSON.stringify(await storage.porter.exportAll()) + JSON.stringify(engine.getState()) + JSON.stringify(requests);
      expect(kept).not.toContain(PHOTO.data);
      expect(JSON.stringify(requests)).not.toContain('"image"');
    });

    it('says to add the API key first, and sends nothing, without one', async () => {
      storage.apiKey = null;
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      expect(reader.asked).toEqual([]);
      expect(notices().map((p) => p.text)).toContain('Add your API key in Settings first.');
      expect(beanCard()!.choice).toBeNull();
      expect(confirmCard()).toBeUndefined();
    });

    it('keeps the bean card open and says why when the photo cannot be read', async () => {
      reader.answer = new LlmError('protocol', "CafAI could not read the coffee's details in that photo. Try another one.");
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      expect(beanCard()!.choice).toBeNull();
      expect(confirmCard()).toBeUndefined();
      expect(notices().filter((p) => p.tone === 'warning').map((p) => p.text)).toEqual([
        "CafAI could not read the coffee's details in that photo. Try another one.",
      ]);
      expect(engine.getState().busy).toBe(false);
    });

    it('takes no confirm without a name, and nothing once the details are confirmed', async () => {
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      await engine.confirmBag({ ...CONFIRMED, name: '  ' });
      expect(confirmCard()!.confirmed).toBe(false);
      expect(requests).toEqual([]);
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.confirmBag(CONFIRMED);
      await engine.confirmBag({ ...CONFIRMED, name: 'Something else' });
      expect(engine.getState().activeBag?.name).toBe('Kiambu AA');
      expect(requests).toHaveLength(1);
    });

    it('sets the details aside when the bag is described in the chat instead', async () => {
      reader.answer = READ;
      await engine.newBag();
      await engine.readBagPhoto(PHOTO);
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      expect(confirmCard()).toMatchObject({ confirmed: false, expired: true, setAsideReason: 'typed' });
      expect(requests[0]![0]!.content[0]).toEqual({ type: 'text', text: 'Kiambu AA, light, washed' });
    });
  });

  // -------------------------------------------------------------------------
  // 6.1: the roast date and the coffee's age
  // -------------------------------------------------------------------------

  describe('the roast date (6.1)', () => {
    it("saves the roast date the coach read, before the bag's batch goes to Decaid with it", async () => {
      machine.beanLibrary = true;
      await engine.newBag();
      scripts.push(() => [text('Lovely.'), toolUse('t-save', TOOL.saveBagDetails, { ...savedRedBrick(), roastDate: '2026-09-28' }), proposeTemplates]);
      await engine.sendText('Red Brick, roasted 28 September');
      expect(engine.getState().activeBag?.roastDate).toBe('2026-09-28');
      await vi.waitFor(() => expect(callsOf('createBatch')).toHaveLength(1));
      expect(callsOf('createBatch')[0]!.args[1]).toEqual({ roastDate: '2026-09-28', roastLevel: 'medium' });
    });

    it('reads a save_bag_details written before the roast date existed (a stored chat) as a date nobody knows', async () => {
      await engine.newBag();
      expect(saveBag).not.toHaveProperty('input.roastDate');
      scripts.push(() => [text('Lovely.'), saveBag, proposeTemplates]);
      await engine.sendText('Kiambu AA, light, washed');
      expect(engine.getState().activeBag).toMatchObject({ name: 'Kiambu AA', roastDate: null });
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      expect(parsed(lastUserTurn(requests)[0])).toEqual({ saved: true });
    });

    it("tells the coach the coffee's age with every shot", async () => {
      stockLibrary();
      await openBag();
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.pickBean('batch-red');
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      nowMs += 2 * 24 * 60 * 60 * 1000;
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      const event = lastUserTurn(requests).find((b) => b.type === 'text') as { text: string };
      const payload = JSON.parse(event.text.split('\n')[1]!);
      expect(payload.roast).toBe(roastToday('2026-09-24'));
      expect(payload.roast).toMatch(/^Roasted 2026-09-24 \(1[01] days ago\)$/);
    });

    const DAY_MS = 24 * 60 * 60 * 1000;
    /** The day `ms` falls on, on this device's calendar. */
    const dayOn = (ms: number) => {
      const local = new Date(ms);
      return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    };
    /** The shot event's JSON in the latest user turn. */
    const shotEvent = () => {
      const event = lastUserTurn(requests).find((b) => b.type === 'text' && b.text.startsWith('[event:shot_completed]')) as { text: string };
      return JSON.parse(event.text.split('\n')[1]!) as { roast: string | null; today: string };
    };
    async function pickedChelcheleThenShot(beforeShot: () => void) {
      await openBag();
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.pickBean('batch-chel');
      scripts.push(() => [text('Loaded.')]);
      await engine.pickTemplate('t-tpl', 'd-flow');
      beforeShot();
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    }

    it('reads the batch again for the roast: a thaw recorded in Decaid after the pick counts', async () => {
      stockLibrary();
      const chel = machine.batches.find((batch) => batch.id === 'batch-chel')!;
      delete chel.unfreezeDate;
      await pickedChelcheleThenShot(() => {
        // Picked while still frozen, thawed in Decaid that day; the shot comes ten days later.
        chel.unfreezeDate = '2026-10-03T00:00:00.000';
        nowMs += 10 * DAY_MS;
      });
      const { roast } = shotEvent();
      expect(roast).toBe(roastToday('2026-09-03', { freezeDate: '2026-09-04', unfreezeDate: '2026-10-03' }));
      expect(roast).not.toBe(roastToday('2026-09-03', { freezeDate: '2026-09-04', unfreezeDate: null }));
      expect(callsOf('listAllBatches').at(-1)!.args).toEqual([{ includeArchived: true }]);
    });

    it('takes the freezer dates the card had while Decaid cannot be read', async () => {
      stockLibrary();
      await pickedChelcheleThenShot(() => {
        machine.batches.find((batch) => batch.id === 'batch-chel')!.unfreezeDate = '2026-10-01T00:00:00.000';
        machine.failBeanCalls = 1;
      });
      expect(machine.failBeanCalls).toBe(0);
      expect(shotEvent().roast).toBe(roastToday('2026-09-03', { freezeDate: '2026-09-04', unfreezeDate: '2026-09-16' }));
    });

    it('tells the coach the day of each shot too, for a roast date said in words after intake', async () => {
      await throughTemplatePick();
      const intakeDay = dayOn(nowMs);
      expect(intakeContext().today).toBe(intakeDay);
      nowMs += 5 * DAY_MS;
      scripts.push(() => [text('Got it.'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
      expect(shotEvent().today).toBe(dayOn(nowMs));
      expect(shotEvent().today).not.toBe(intakeDay);
    });
  });

  // -------------------------------------------------------------------------
  // 6.5: DYE2's recent setups
  // -------------------------------------------------------------------------

  describe("DYE2's recent setups (6.5)", () => {
    const recentFor = (batchId: string, grind: string) => ({
      id: `recent:${grind}`,
      auto: true,
      snapshot: { profileTitle: 'D-Flow / default', beanBatchId: batchId, coffeeName: 'Red Brick', coffeeRoaster: 'Square Mile Coffee Roasters', grindSetting: grind, dose: 18, drink: 36 },
      capturedAt: '2026-10-01T07:00:00.000',
    });

    /** Pick Red Brick; the coach looks at DYE2 before it suggests anything. */
    async function setupsAtIntake(addToLibrary: () => void = () => {}): Promise<unknown> {
      stockLibrary();
      addToLibrary();
      await openBag();
      scripts.push(() => [toolUse('t-dye2', TOOL.getRecentSetups, {})]);
      scripts.push(() => [text('Lovely.'), proposeTemplates]);
      await engine.pickBean('batch-red');
      const answer = requests[1]![requests[1]!.length - 1]!.content[0] as ToolResultBlock;
      return { content: answer.content, isError: answer.is_error ?? false };
    }

    it("answers from DYE2's endpoint while it is loaded, for this bag's batch, with DYE2's kit", async () => {
      loadedPlugins.add(PLUGIN.dye2);
      machine.pluginEndpoints.set('dye2.reaplugin/recent-favs', [recentFor('batch-red', '4.2'), recentFor('batch-other', '9')]);
      machine.store.set('dye2.reaplugin/equipment', [{ id: 'eqp-1', name: 'WDT tool' }]);
      machine.store.set('dye2.reaplugin/baskets', [{ id: 'bskt-1', name: 'VST 18g' }]);
      const { content, isError } = (await setupsAtIntake()) as { content: string; isError: boolean };
      expect(isError).toBe(false);
      expect(JSON.parse(content)).toEqual({
        available: true,
        setups: [
          {
            kind: 'recent',
            sameBatch: true,
            profileTitle: 'D-Flow / default',
            grindSetting: '4.2',
            doseG: 18,
            yieldG: 36,
            rpm: null,
            basket: null,
            date: '2026-10-01',
          },
        ],
        equipment: ['WDT tool'],
        baskets: ['VST 18g'],
      });
      expect(callsOf('getPluginEndpoint').map((c) => c.args)).toEqual([['dye2.reaplugin', 'recent-favs']]);
    });

    it("counts the setups of the same bean's earlier batches too, archived ones included, as another batch", async () => {
      loadedPlugins.add(PLUGIN.dye2);
      machine.pluginEndpoints.set('dye2.reaplugin/recent-favs', [
        recentFor('batch-red', '4.2'),
        recentFor('batch-red-old', '4.6'),
        recentFor('batch-red-archived', '4.8'),
        recentFor('batch-chel', '9'),
      ]);
      const { content } = (await setupsAtIntake(() => machine.batches.push(libraryBatch('batch-red-archived', 'bean-red', { archived: true })))) as {
        content: string;
      };
      expect((JSON.parse(content).setups as Array<{ grindSetting: string; sameBatch: boolean }>).map((s) => [s.grindSetting, s.sameBatch])).toEqual([
        ['4.2', true],
        ['4.6', false],
        ['4.8', false],
      ]);
      expect(callsOf('listAllBatches').at(-1)!.args).toEqual([{ includeArchived: true }]);
    });

    it("reads DYE2's keys from the store when it is not loaded", async () => {
      machine.store.set('dye2.reaplugin/autoFavourites', [recentFor('batch-red', '4.5')]);
      const { content } = (await setupsAtIntake()) as { content: string };
      expect(JSON.parse(content)).toMatchObject({ available: true, setups: [{ grindSetting: '4.5' }] });
      expect(callsOf('getPluginEndpoint')).toEqual([]);
    });

    it('answers {"available":false} without DYE2', async () => {
      const { content, isError } = (await setupsAtIntake()) as { content: string; isError: boolean };
      expect(isError).toBe(false);
      expect(JSON.parse(content)).toEqual({ available: false });
    });

    it("says so when Decaid's store cannot be read", async () => {
      machine.store.set('dye2.reaplugin/autoFavourites', () => {
        throw unreachable('/api/v1/store/dye2.reaplugin/autoFavourites');
      });
      const { content, isError } = (await setupsAtIntake()) as { content: string; isError: boolean };
      expect(isError).toBe(true);
      expect(content).toBe("Decaid can't be reached right now, so DYE2's setups could not be read.");
    });
  });

  // -------------------------------------------------------------------------
  // 6.4: the Visualizer link
  // -------------------------------------------------------------------------

  describe('the Visualizer link (6.4)', () => {
    const URL = 'https://visualizer.coffee/shots/viz-1';
    type ShotPart = Extract<CoachUiPart, { kind: 'shot' }>;
    const shotCard = () => allParts().find((p): p is ShotPart => p.kind === 'shot');
    const lastUploadReads = () => callsOf('readStore').filter((c) => c.args[1] === 'lastUploadedShot');

    it('puts On Visualizer on the shot card and the iteration once the plugin uploaded the shot', async () => {
      loadedPlugins.add(PLUGIN.visualizer);
      let reads = 0;
      machine.store.set('visualizer.reaplugin/lastUploadedShot', () => (++reads < 3 ? 'shot-0' : 'shot-1'));
      machine.store.set('visualizer.reaplugin/lastVisualizerId', 'viz-1');
      await throughShot();
      await vi.waitFor(() => expect(shotCard()?.visualizerUrl).toBe(URL));
      await vi.waitFor(async () => expect((await storage.iterations.listAll())[0]!.visualizerUrl).toBe(URL));
      expect(lastUploadReads()).toHaveLength(3);
      // Kept with the chat, so the card shows it after a reload too.
      await drain();
      const stored = await storage.conversations.get(engine.getState().activeBag!.conversationId);
      expect(stored!.uiMessages.flatMap((m) => m.parts).find((p) => p.kind === 'shot')).toMatchObject({ visualizerUrl: URL });
    });

    it('shows the link on the card at once, and keeps it in storage in turn with the change being confirmed', async () => {
      // Each 3 s wait ends when the test says.
      let endWait: (() => void) | null = null;
      engine.dispose();
      engine = build({
        clock: {
          now: () => new Date(nowMs),
          sleep: (ms) => (ms === 3000 ? new Promise<void>((resolve) => (endWait = resolve)) : Promise.resolve()),
        },
      });
      await engine.start();
      loadedPlugins.add(PLUGIN.visualizer);
      machine.store.set('visualizer.reaplugin/lastUploadedShot', 'shot-1');
      machine.store.set('visualizer.reaplugin/lastVisualizerId', 'viz-1');
      await throughProposal();
      await vi.waitFor(() => expect(endWait).not.toBeNull());
      // Confirm, and the machine takes its time: the engine is busy until it answers.
      machine.barrier = 'hold';
      scripts.push(() => [text('Done.')]);
      const confirming = engine.confirmChange('t-adj');
      await vi.waitFor(() => expect(machine.held).not.toBeNull());
      endWait!();
      await vi.waitFor(() => expect(shotCard()?.visualizerUrl).toBe(URL));
      // Stored only once the engine's turn comes, never inside another action's writes.
      expect((await storage.iterations.listAll())[0]!.visualizerUrl).toBeUndefined();
      machine.held!.resolve('loaded');
      await confirming;
      await drain();
      expect((await storage.iterations.listAll())[0]).toMatchObject({ outcome: 'applied', visualizerUrl: URL });
      const stored = await storage.conversations.get(engine.getState().activeBag!.conversationId);
      expect(stored!.uiMessages.flatMap((m) => m.parts).find((p) => p.kind === 'shot')).toMatchObject({ visualizerUrl: URL });
    });

    it('looks every 3 s and stops after 30 s without a match', async () => {
      engine.dispose();
      const sleeps: number[] = [];
      engine = build({ clock: { now: () => new Date(nowMs), sleep: async (ms) => void sleeps.push(ms) } });
      await engine.start();
      loadedPlugins.add(PLUGIN.visualizer);
      machine.store.set('visualizer.reaplugin/lastUploadedShot', 'shot-0');
      await throughShot();
      await vi.waitFor(() => expect(lastUploadReads()).toHaveLength(10));
      await drain();
      expect(lastUploadReads()).toHaveLength(10);
      expect(sleeps.filter((ms) => ms === 3000)).toHaveLength(10);
      expect(shotCard()!.visualizerUrl).toBeUndefined();
      expect((await storage.iterations.listAll())[0]!.visualizerUrl ?? null).toBeNull();
    });

    it('stops after 30 s of time, however long each look takes', async () => {
      engine.dispose();
      engine = build({ clock: { now: () => new Date(nowMs), sleep: async (ms) => void (nowMs += ms) } });
      await engine.start();
      loadedPlugins.add(PLUGIN.visualizer);
      // Each look takes Decaid 2 s: 5 s a round, so six rounds fill the 30 s.
      machine.store.set('visualizer.reaplugin/lastUploadedShot', () => {
        nowMs += 2000;
        return 'shot-0';
      });
      await throughShot();
      await vi.waitFor(() => expect(lastUploadReads()).toHaveLength(6));
      await drain();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(lastUploadReads()).toHaveLength(6);
    });

    it('looks for nothing without the plugin', async () => {
      machine.store.set('visualizer.reaplugin/lastUploadedShot', 'shot-1');
      await throughShot();
      await drain();
      expect(callsOf('readStore')).toEqual([]);
      expect(shotCard()!.visualizerUrl).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // D101: the stars on Decaid's own rating scale
  // -------------------------------------------------------------------------

  describe("Decaid's rating scale (D101)", () => {
    it('writes stars x 20 on a Decaid that rates out of 100', async () => {
      machine.enjoymentScale = 100;
      await throughShot();
      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 80, extras: { cafai: { stars: 4 } } }));
    });

    it('asks Decaid its scale once per session, and only when the first stars go out', async () => {
      await throughShot();
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      await vi.waitFor(() => expect(callsOf('updateShot')).toHaveLength(1));
      expect(callsOf('probeEnjoymentScale')).toEqual([]);

      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 8 }));
      await engine.rateShot('shot-1', 3);
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 6 }));
      expect(callsOf('probeEnjoymentScale')).toHaveLength(1);
    });

    it('holds the stars while Decaid cannot say its scale, sends the taste meanwhile, and asks again at the next try', async () => {
      machine.enjoymentScale = null;
      await throughShot();
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      await engine.rateShot('shot-1', 5);
      await vi.waitFor(() => expect(callsOf('probeEnjoymentScale')).toHaveLength(1));
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      expect(machine.annotations.get('shot-1')).toMatchObject({ espressoNotes: 'Taste: Sour. Kiambu AA v1 (CafAI)' });
      expect(machine.annotations.get('shot-1')).not.toHaveProperty('enjoyment');

      machine.enjoymentScale = 10;
      timers.fire();
      await vi.waitFor(() =>
        expect(machine.annotations.get('shot-1')).toMatchObject({
          espressoNotes: 'Taste: Sour. Kiambu AA v1 (CafAI)',
          enjoyment: 10,
          extras: { cafai: { selected: ['Sour'], stars: 5 } },
        }),
      );
      expect(callsOf('probeEnjoymentScale')).toHaveLength(2);
      expect(timers.delays()).toEqual([]);
    });

    it('after an answer that tells neither scale, asks again once per shot, not at every try', async () => {
      machine.enjoymentScale = 'unreadable';
      await throughShot();
      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(callsOf('probeEnjoymentScale')).toHaveLength(1));
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      timers.fire();
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      decaidBack();
      await drain();
      expect(callsOf('probeEnjoymentScale')).toHaveLength(1);
      expect(machine.annotations.get('shot-1')).toBeUndefined();

      // The next shot asks once more; this time Decaid answers.
      machine.enjoymentScale = 10;
      scripts.push(() => [text('Again?'), askTaste]);
      telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: 'targetWeight' });
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 8, extras: { cafai: { stars: 4 } } }));
      expect(callsOf('probeEnjoymentScale')).toHaveLength(2);
      await vi.waitFor(() => expect(engine.getState().phase).toBe('awaiting_feedback'));
    });
  });

  // -------------------------------------------------------------------------
  // 5.10-5.12: refused writes, the barrier, shot credit
  // -------------------------------------------------------------------------

  describe('writes Decaid refuses (5.11)', () => {
    const refusal = (status: number) =>
      new GatewayError(status, '/api/v1/shots/shot-1', 'enjoyment must be between 0 and 10', 'http', {
        error: 'Invalid request',
        message: 'Invalid argument(s): enjoyment must be between 0 and 10',
      });
    const refusals = () => notices().filter((p) => p.text.startsWith('Decaid would not save'));
    const drift = () => driftLog.list().map(({ source, problem }) => [source, problem]);

    beforeEach(() => {
      driftLog.clear();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('drops stars Decaid refuses, reports it, says once why, and never sends them again', async () => {
      await throughShot();
      machine.shotRefusal = refusal(400);
      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(refusals()).toHaveLength(1));
      expect(refusals()[0]).toEqual({
        kind: 'notice',
        tone: 'warning',
        text: 'Decaid would not save the stars for this shot: enjoyment must be between 0 and 10.',
      });
      expect(drift()).toContainEqual(['PUT /api/v1/shots/{id}', 'annotations: refused (HTTP 400)']);
      expect(timers.delays()).toEqual([]);

      decaidBack();
      await drain();
      expect(callsOf('updateShot (refused)')).toHaveLength(1);
      expect(callsOf('updateShot')).toEqual([]);
      expect(refusals()).toHaveLength(1);
    });

    it("says so in the shot's own bag when another bag is open by then, never in the bag on screen", async () => {
      const said = 'Decaid would not save the stars for this shot: enjoyment must be between 0 and 10.';
      const storedNotices = async (bag: Bag) =>
        ((await storage.conversations.get(bag.conversationId))?.uiMessages ?? [])
          .flatMap((m) => m.parts)
          .flatMap((part) => (part.kind === 'notice' ? [part.text] : []));
      await throughShot();
      const rated = engine.getState().activeBag!;
      // Rated while Decaid is away: the stars wait in the outbox.
      machine.failShotUpdates = 1;
      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      await engine.newBag();
      const open = engine.getState().activeBag!;
      expect(open.id).not.toBe(rated.id);

      // Decaid is back and refuses the stars.
      machine.shotRefusal = refusal(400);
      decaidBack();
      await vi.waitFor(async () => expect(await storedNotices(rated)).toContain(said));
      await drain();
      expect(refusals()).toEqual([]);
      expect(await storedNotices(open)).not.toContain(said);

      await engine.selectBag(rated.id);
      expect(refusals().map((p) => p.text)).toEqual([said]);
    });

    it('names the taste when Decaid refuses the notes', async () => {
      await throughShot();
      machine.shotRefusal = new GatewayError(400, '/api/v1/shots/shot-1', 'Decaid answered HTTP 400 for /api/v1/shots/shot-1.', 'http');
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      await vi.waitFor(() => expect(refusals()).toHaveLength(1));
      expect(refusals()[0]!.text).toBe('Decaid would not save the taste for this shot: Decaid answered HTTP 400 for /api/v1/shots/shot-1.');
    });

    it('drops the taste with a plain notice when the record cannot be read, never counting it as saved', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      await throughShot();
      machine.unreadableRecords = true;
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      const notSaved = () => notices().filter((p) => p.text.startsWith('CafAI could not save'));
      await vi.waitFor(() => expect(notSaved()).toHaveLength(1));
      // The detail goes to the log Decaid keeps, not into the chat.
      expect(notSaved()[0]).toEqual({ kind: 'notice', tone: 'warning', text: 'CafAI could not save the taste for this shot.' });
      expect(logged).toHaveBeenCalledWith('CafAI could not save the taste for this shot:', "Decaid sent a reply CafAI doesn't recognise.");
      expect(callsOf('updateShot')).toEqual([]);
      expect(timers.delays()).toEqual([]);
    });

    it('reports a record Decaid no longer has under the read, not as a refused write', async () => {
      await throughShot();
      machine.missingShots.add('shot-1');
      scripts.push(() => [text('Thanks.')]);
      await engine.answerOptions('t-ask', ['Sour'], null);
      await vi.waitFor(() => expect(refusals()).toHaveLength(1));
      expect(refusals()[0]!.text).toBe('Decaid would not save the taste for this shot: Shot not found.');
      expect(drift()).toContainEqual(['GET /api/v1/shots/{id}', 'record: refused (HTTP 404)']);
      expect(drift().filter(([source]) => source === 'PUT /api/v1/shots/{id}')).toEqual([]);
      expect(callsOf('updateShot')).toEqual([]);
    });

    it('keeps a write Decaid answered 409 or 503, says nothing, and sends it once Decaid takes it', async () => {
      await throughShot();
      machine.shotRefusal = refusal(409);
      await engine.rateShot('shot-1', 4);
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      machine.shotRefusal = refusal(503);
      timers.fire();
      await vi.waitFor(() => expect(callsOf('updateShot (refused)')).toHaveLength(2));
      await vi.waitFor(() => expect(timers.delays()).toEqual([30_000]));
      timers.fire();
      await vi.waitFor(() => expect(machine.annotations.get('shot-1')).toMatchObject({ enjoyment: 8 }));
      expect(refusals()).toEqual([]);
    });

    it('drops a grinder Decaid refuses, and says so instead of promising to send it later', async () => {
      await throughTemplatePick();
      await storage.settings.update({ grinderSetting: '14' });
      machine.workflowRefusal = new GatewayError(400, '/api/v1/workflow', 'grinderSetting must be a string', 'http');
      await engine.refresh();
      await vi.waitFor(() => expect(refusals()).toHaveLength(1));
      expect(refusals()[0]!.text).toBe('Decaid would not save the grinder for the next shots: grinderSetting must be a string.');
      expect(notices().some((p) => p.text.startsWith("Decaid can't be reached"))).toBe(false);
      expect(timers.delays()).toEqual([]);
      expect(drift()).toContainEqual(['PUT /api/v1/workflow', 'context: refused (HTTP 400)']);
    });
  });

  it('says once per session that this Decaid cannot confirm the machine took a profile (5.12)', async () => {
    const said = 'This Decaid cannot confirm that the machine took a profile, so CafAI will assume it did.';
    machine.barrier = 'unsupported';
    await throughProposal();
    scripts.push(() => [text('Done.')]);
    await engine.confirmChange('t-adj');
    expect(callsOf('activateProfile')).toHaveLength(2);
    expect(notices().filter((p) => p.text === said)).toEqual([{ kind: 'notice', tone: 'info', text: said }]);
  });

  it("credits a shot whose record does not say which profile ran, reports it, and says so (5.10)", async () => {
    driftLog.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await throughTemplatePick();
    machine.recordsWithoutProfile = true;
    expect(await shotIsCredited('shot-1')).toBe(true);
    expect(notices().filter((p) => p.text.startsWith("Decaid's record"))).toEqual([
      { kind: 'notice', tone: 'info', text: "Decaid's record did not say which profile ran; CafAI counted it for v1." },
    ]);
    expect(driftLog.list().map(({ source, problem }) => [source, problem])).toContainEqual([
      'GET /api/v1/shots/{id}',
      'workflow.profile: missing',
    ]);
  });

  // -------------------------------------------------------------------------
  // D100: bags back from Decaid's backup
  // -------------------------------------------------------------------------

  describe("bags back from Decaid's backup (5.4, 5.5)", () => {
    const BACK = "Your bags are back from Decaid's backup.";
    const at = '2026-10-01T08:00:00.000Z';
    const restoredBag: Bag = {
      id: 'bag-restored',
      name: 'Kiambu AA',
      roaster: 'Square Mile',
      origin: null,
      roastLevel: 'light',
      process: null,
      notes: null,
      templateId: null,
      activeVersionId: null,
      conversationId: 'conv-restored',
      archived: false,
      createdAt: at,
      updatedAt: at,
    };

    async function backupLanded() {
      await storage.bags.put(restoredBag);
      await storage.conversations.put({ id: 'conv-restored', bagId: 'bag-restored', apiMessages: [], uiMessages: [], createdAt: at, updatedAt: at });
      await storage.settings.update({ activeBagId: 'bag-restored' });
    }

    it('reads bags that came back after start, opens the last one, and says once that they are back', async () => {
      expect(engine.getState()).toMatchObject({ bags: [], phase: 'no_bag', restoredFromBackup: false });
      await backupLanded();
      await engine.restored();
      expect(engine.getState()).toMatchObject({ restoredFromBackup: true, activeBag: { id: 'bag-restored' } });
      expect(engine.getState().bags.map((b) => b.id)).toEqual(['bag-restored']);
      expect(notices().at(-1)).toEqual({ kind: 'notice', tone: 'success', text: BACK });
      expect((await storage.conversations.get('conv-restored'))!.uiMessages.at(-1)!.parts).toEqual([
        { kind: 'notice', tone: 'success', text: BACK },
      ]);

      await engine.restored();
      expect(notices().filter((p) => p.text === BACK)).toHaveLength(1);
    });

    it('starts knowing the start-up restore brought the bags back, for the key card (5.5)', async () => {
      engine.dispose();
      storage.apiKey = null;
      await backupLanded();
      engine = build({ restoredFromBackup: true });
      await engine.start();
      expect(engine.getState()).toMatchObject({ hasApiKey: false, restoredFromBackup: true, activeBag: { id: 'bag-restored' } });
      expect(notices().some((p) => p.text === BACK)).toBe(false);
    });
  });
});

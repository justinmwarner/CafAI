/**
 * What the coach engine needs from the other modules, as narrow ports.
 *
 * The engine was written while src/coach, src/llm and src/api were being
 * built in parallel, so it depends on these interfaces only; the composition
 * root (src/app/createServices.ts) adapts the real modules to them.
 */
import type { ZodType } from 'zod';
import type { MachineProfileStatus } from '../../api/machineProfile.ts';
import type {
  BatchCreateRequest,
  Bean,
  BeanBatch,
  BeanCreateRequest,
  EnjoymentScale,
  ProfileRecord,
  ShotRecord,
  ShotRecordSummary,
  ShotUpdateRequest,
  WireProfile,
  Workflow,
  WorkflowContext,
  WorkflowPatch,
} from '../../api/types.ts';
import type { ProposeAdjustment, ToolName } from '../../coach/contract.ts';
import type { GrinderInfo, LeverValues, ProfileJson, ShotSummary, Template } from '../../coach/types.ts';
import type { LlmProvider, RunRequest, RunResult, ToolDefinition, ToolValidation } from '../../llm/types.ts';
import type { IterationRecord, ProfileVersion } from '../../storage/types.ts';

/** A validated proposal, ready to show as a diff and apply on Confirm. */
export interface ChangePlan {
  variable: ProposeAdjustment['variable'];
  leverId: string | null;
  label: string | null;
  unit: string | null;
  from: number | null;
  to: number | null;
  /** The next version's profile (execution content), when the change creates a version. */
  newProfile: ProfileJson | null;
  /** Workflow context to set with the activation, e.g. a new targetYield. */
  contextPatch: { targetYield?: number; targetDoseWeight?: number; grinderSetting?: string };
  diffLines: string[];
  manualSteps: string[];
  summary: string;
  createsVersion: boolean;
  /** Adjustments the validator made, e.g. rounding to the lever's step. */
  notes?: string[];
}

export interface ProposalContext {
  template: Template;
  profile: ProfileJson;
  doseG: number | null;
  scaleConnected: boolean;
  grinderSetting: string | null;
  /**
   * The grinder linked from Decaid's library, with its steps (D62): a
   * relative grind move becomes the new setting, and a named one is checked
   * against the grinder's grid. Null when none is linked or it is not read.
   */
  grinder?: GrinderInfo | null;
}

export type ProposalValidation = { ok: true; plan: ChangePlan } | { ok: false; errors: string[] };

/** Resolves `latest`, `previous` or a shot id to a stored shot of the active bag. */
export interface ShotSource {
  resolve(ref: string): Promise<{ record: ShotRecord; summary: ShotSummary } | null>;
}

export interface CoachPort {
  templates: readonly Template[];
  getTemplate(id: string): Template | undefined;
  /** Stable for the whole session (prompt caching). */
  systemPrompt(): string;
  toolDescription(name: ToolName): string;
  readLeverValues(template: Template, profile: ProfileJson): LeverValues;
  validateProposal(input: ProposeAdjustment, context: ProposalContext): ProposalValidation;
  summarizeShot(record: ShotRecord): ShotSummary;
  versionTitle(bagName: string, version: number): string;
  buildVersionProfile(template: Template, base: ProfileJson, title: string, bagName: string): ProfileJson;
  /**
   * v1's profile for this dose (D57): the bundled profile with target_weight
   * at the author's ratio times the dose, or times referenceDoseG when the
   * dose is unknown or outside doseRange.
   */
  buildStartingProfile(template: Template, doseG: number | null): ProfileJson;
  /** The dose when CafAI coaches from it (inside doseRange), else null. */
  knownDose(doseG: number | null): number | null;
  /** The dose v1 assumes when Decaid has none CafAI coaches from (Decent's stock basket). */
  readonly referenceDoseG: number;
  /** The doses CafAI coaches from, in grams. */
  readonly doseRange: { min: number; max: number };
  /** Decaid's content-hash id of a profile (title excluded); throws on unusable input. */
  profileId(profile: unknown): string;
  /** Drops any model-sent "Other" and appends OTHER_OPTION last. */
  withOther(options: readonly string[]): string[];
  /** Run one read-only query tool (get_shot_summary, get_shot_series, ...) on validated input. */
  runQuery(name: ToolName, input: unknown, context: QueryContext): Promise<{ content: string; isError: boolean }>;
}

export interface QueryContext {
  source: ShotSource;
  versions: ProfileVersion[];
  iterations: IterationRecord[];
}

export interface LlmPort {
  provider: LlmProvider;
  run(request: RunRequest): Promise<RunResult>;
  toolDefinition(name: string, description: string, schema: ZodType): ToolDefinition;
  validator(schema: ZodType): (input: unknown) => ToolValidation;
}

export interface ApiPort {
  getWorkflow(): Promise<Workflow>;
  updateWorkflow(patch: WorkflowPatch): Promise<Workflow>;
  /** Full-profile activation in one PUT /workflow; refuses while a shot runs. */
  activateProfile(profile: ProfileJson, context: WorkflowContext, options: { shotRunning: boolean }): Promise<Workflow>;
  /** POST /profiles; `deduped` when Decaid returned an existing record with the same content. */
  createProfileVersion(request: {
    profile: ProfileJson;
    parentId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ record: ProfileRecord; deduped: boolean }>;
  getShot(id: string): Promise<ShotRecord>;
  getLatestShot(): Promise<ShotRecordSummary | null>;
  /**
   * POST /machine/profile with the profile exactly as Decaid returned it from
   * the workflow PUT: resolves once the machine holds it (D55). Throws a
   * GatewayError with a sentence when the upload failed.
   */
  loadProfileOnMachine(profile: WireProfile): Promise<MachineProfileStatus>;
  /** PUT /shots/{id}: Decaid deep-merges the annotations; the notes string is replaced. */
  updateShot(id: string, patch: ShotUpdateRequest): Promise<ShotRecord>;
  /**
   * Decaid's rating scale (D101): 10 or 100, or null when Decaid did not
   * answer or was busy. Throws when it answered something that tells neither
   * (reported as drift where it was read).
   */
  probeEnjoymentScale(): Promise<EnjoymentScale | null>;
  /**
   * GET /grinders/{id}: the grinder in Decaid's grinder library, reduced to
   * how its dial moves (D62). Null when Decaid has no grinder with that id;
   * throws when Decaid cannot be read.
   */
  getGrinder(id: string): Promise<GrinderInfo | null>;
  /**
   * GET /beans: the beans in Decaid's bean library that are not archived
   * (D102). Throws when Decaid cannot be read. CafAI only reads the library
   * and adds to it: it never edits or deletes a bean or batch, so the port
   * has no way to.
   */
  listBeans(): Promise<Bean[]>;
  /** POST /beans. */
  createBean(request: BeanCreateRequest): Promise<Bean>;
  /** POST /beans/{id}/batches. */
  createBatch(beanId: string, request: BatchCreateRequest): Promise<BeanBatch>;
}

export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

/** The zod schema for each tool (src/coach/contract.ts TOOL_INPUTS). */
export type ToolSchemas = Record<ToolName, ZodType>;

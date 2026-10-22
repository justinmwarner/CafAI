/**
 * What the coach engine needs from the other modules, as narrow ports.
 *
 * The engine was written while src/coach, src/llm and src/api were being
 * built in parallel, so it depends on these interfaces only; the composition
 * root (src/app/createServices.ts) adapts the real modules to them.
 */
import type { ZodType } from 'zod';
import type { GrinderCreateRequest } from '../../api/grinders.ts';
import type { MachineProfileStatus } from '../../api/machineProfile.ts';
import type { Dye2Data, PluginReads } from '../../api/pluginData.ts';
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
import type { ProposeAdjustment, ProposeTemplates, ToolName } from '../../coach/contract.ts';
import type { FunFactsSource } from '../../coach/facts/types.ts';
import type { BagIdentity } from '../../coach/queries.ts';
import type { FreezerDates } from '../../coach/roastAge.ts';
import type { GrinderInfo, LeverValues, ProfileJson, ShotSummary, Template } from '../../coach/types.ts';
import type { BagPhoto, ExtractedBag } from '../../llm/extractBag.ts';
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
  /**
   * The same for every request while the barista's temperature unit and the
   * source of fun facts stay (prompt caching): one prompt per unit (D175)
   * and per fun facts mode (D198, off and CafAI's list sharing one), so a
   * switch costs one request without the cache.
   */
  systemPrompt(funFacts: FunFactsSource): string;
  toolDescription(name: ToolName): string;
  readLeverValues(template: Template, profile: ProfileJson): LeverValues;
  validateProposal(input: ProposeAdjustment, context: ProposalContext): ProposalValidation;
  /**
   * A sentence for the model when a proposal it just wrote promises a taste
   * (D127): a propose_adjustment's expectedEffect, summary or tips, or a
   * propose_templates reason; else null. Never asked of a stored proposal:
   * its card already shows its words.
   */
  proposalWordingError(input: ProposeAdjustment | ProposeTemplates): string | null;
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
  /**
   * The roast as the coach reads it (6.1): "Roasted <date> (<n> days ago;
   * <m> days in the freezer not counted)", or null when the date is unknown.
   */
  roastLine(roastDate: string | null, today: Date, freezer: FreezerDates | null): string | null;
}

export interface QueryContext {
  source: ShotSource;
  versions: ProfileVersion[];
  iterations: IterationRecord[];
  /** get_recent_setups (6.5): DYE2's data as read from Decaid, null without DYE2. */
  dye2?: Dye2Data | null;
  /** get_recent_setups: the bag on screen. */
  bag?: BagIdentity;
}

export interface LlmPort {
  provider: LlmProvider;
  run(request: RunRequest): Promise<RunResult>;
  toolDefinition(name: string, description: string, schema: ZodType): ToolDefinition;
  validator(schema: ZodType): (input: unknown) => ToolValidation;
  /**
   * Read a photo of the bag with `model` (6.8): one request, the photo in it
   * and nowhere else. Throws an LlmError with a sentence when it cannot.
   * Optional: without it the bean card's photo has nothing to read it with.
   */
  readBag?(request: { model: string; photo: BagPhoto }): Promise<ExtractedBag>;
}

/**
 * What the engine reads and writes in Decaid. The plugin reads (D103) are
 * read-only: CafAI never writes a plugin's data, so the port has no way to.
 */
export interface ApiPort extends PluginReads {
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
   * The grinder a request describes, in Decaid's grinder library (D125): the
   * one Decaid already has (the same model, read afresh), or one POST
   * /grinders adds (`added`), with how its dial moves. Throws when Decaid
   * cannot be read or refuses it. CafAI only adds grinders: it never edits
   * or deletes one, so the port has no way to.
   */
  addGrinder(request: GrinderCreateRequest): Promise<{ id: string; model: string; burrs: string | null; info: GrinderInfo; added: boolean }>;
  /**
   * GET /beans: the beans in Decaid's bean library that are not archived
   * (D102). Throws when Decaid cannot be read. CafAI only reads the library
   * and adds to it: it never edits or deletes a bean or batch, so the port
   * has no way to.
   */
  listBeans(): Promise<Bean[]>;
  /** GET /beans/{id}/batches: a bean's unarchived batches. Throws when Decaid cannot be read. */
  listBatches(beanId: string): Promise<BeanBatch[]>;
  /** GET /bean-batches: every bean's batches in one request, archived ones only when asked. Throws when Decaid cannot be read. */
  listAllBatches(options?: { includeArchived?: boolean }): Promise<BeanBatch[]>;
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

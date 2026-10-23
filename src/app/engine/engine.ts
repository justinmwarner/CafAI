/**
 * The coach engine: turns app events (new bag, a tap, a finished shot, a
 * confirm or undo) into conversation turns, uploads, and stored records.
 *
 * - One bag = one conversation with an append-only API transcript.
 * - UI tools (template cards, option chips, the change diff) stop the model
 *   run; the user's tap answers them as tool_results in the next user turn.
 * - Every change to the machine is an explicit tap; nothing here uploads a
 *   profile on its own.
 * - A version is "on the machine" only once Decaid says the machine holds it
 *   (D55): every activation is a workflow PUT followed by Decaid's barrier.
 * - Decaid has no workflow stream, so CafAI looks at the workflow every 30 s
 *   while the page is in view, and when it comes back into view, and says
 *   when the machine runs another profile (D66). Looking never changes the
 *   machine (D42).
 * - Writes to Decaid that fail (a grinder setting, a shot's notes) wait in an
 *   outbox and go out again when Decaid is back (D64); a write Decaid refuses
 *   is dropped and the chat says so once (5.11).
 * - A shot card asks how the shot compared with the one before it (D126):
 *   the words stay on the card, Decaid's `enjoyment` gets a running score,
 *   and the coach hears the verdict with the next turn it is sent.
 * - A shot card takes a TDS from the barista's refractometer (D162): the
 *   card and the iteration keep it with the EY worked out from the card's
 *   dose and yield, Decaid's record gets both, and the coach hears it with
 *   the next turn it is sent, as a verdict.
 * - A run of a cleaning or calibration profile (the weekly clean's Forward
 *   Flush x5) is no shot: Decaid saves none, so CafAI neither looks for one
 *   nor says anything of it (D193).
 * - A run with less than 2 s of pour is no shot either: stopped in preheat,
 *   Decaid aborts it and keeps no record, so CafAI looks for none; stopped as
 *   the pour begins, its record holds too little of it. No card, no taste
 *   question, nothing to compare the next shot with; one quiet line says so
 *   (D204).
 * - A shot of a recipe the barista kept that ran like the last one gets one
 *   fun fact (D197): the coach's, shared with share_fun_fact, or else one of
 *   CafAI's own list, between the coach's words and its taste question. The
 *   source is the barista's choice in Settings (D198); the facts told stay
 *   on the device (D200), and the web mode carries Anthropic's web search
 *   until it proves unavailable (D203).
 * - A bag whose details were saved is added to Decaid's bean library in the
 *   background, and every load names its batch (D102).
 * - A new bag opens with "Which coffee is it?": a batch from Decaid's bean
 *   library, a photo of the bag read by the coach's model, or the bag
 *   described in the chat (6.1, 6.8). The coach hears the roast date, the
 *   coffee's age and today's date at intake and with every shot.
 * - Decaid's plugins are optional (D103): the coach may read DYE2's setups,
 *   and a shot the Visualizer plugin uploaded gets a link to its page.
 * - v1 starts from the dose Decaid has at the pick (D57). Grind moves use the
 *   steps of the grinder linked from Decaid's library (D62), read in the
 *   background so a slow or failed read never holds anything up. A grinder
 *   the barista names that is not linked can be added to the library from
 *   the coach's card, only on their tap (D125).
 * - Engine actions are serialized, so a shot that finishes mid-reply is
 *   handled after the reply, never interleaved with it.
 * - Everything is persisted as it happens (the WebView may be unloaded after
 *   ten minutes in the background without warning). Progress notices are the
 *   exception: they are never stored.
 * - Each coach step is counted for usage sharing (D-USAGE-4): a message, a
 *   bag's first details, a load, a shot read, a taste, a confirmed change or
 *   a kept recipe, an undo, a fun fact, a coach error. It goes nowhere unless
 *   the build and the device share.
 *
 * Turn conventions: docs/briefs/ENGINE_PROTOCOL.md.
 */
import {
  AUTO_TOOLS,
  BAG_LIMITS,
  TOOL,
  TOOL_INPUTS,
  toRoastLevel,
  type AskUser,
  type OfferGrinder,
  type ProposeAdjustment,
  type ProposeTemplates,
  type SaveBagDetails,
  type ShareFunFact,
  type ToolName,
} from '../../coach/contract.ts';
import { isTds, readingOf, roundTds, withTds } from '../../coach/extraction.ts';
import { loadFacts } from '../../coach/facts/load.ts';
import { ranLikeLast } from '../../coach/facts/likeLast.ts';
import { pickFact, toldLabels } from '../../coach/facts/pick.ts';
import { coachKey, createToldList, type ToldList } from '../../coach/facts/told.ts';
import { DEFAULT_FUN_FACTS, type FunFact, type FunFactsSource } from '../../coach/facts/types.ts';
import { factWordingError } from '../../coach/facts/wording.ts';
import { todayOf, writtenDate, type FreezerDates } from '../../coach/roastAge.ts';
import { MIN_SHOT_POUR_S, recordPourSeconds } from '../../coach/summary/summarize.ts';
import { reportDrift } from '../../api/drift.ts';
import { describeValue } from '../../api/frames.ts';
import { grinderRequest, NO_GRINDER_LIBRARY } from '../../api/grinders.ts';
import { readDye2, visualizerIdFor, visualizerShotUrl, type Dye2Data } from '../../api/pluginData.ts';
import { PLUGIN, type PluginDirectory } from '../../api/plugins.ts';
import {
  GatewayError,
  type BatchCreateRequest,
  type Bean,
  type BeanBatch,
  type BeanCreateRequest,
  type EnjoymentScale,
  type ShotAnnotationsPatch,
  type ShotRecord,
  type ShotStateEvent,
  type TelemetryStore,
  type WireProfile,
  type Workflow,
  type WorkflowContext,
} from '../../api/types.ts';
import { isShotRunning as shotInProgress } from '../../api/workflow.ts';
import { redactKeyLike } from '../../storage/redact.ts';
import type { GrinderInfo, ProfileJson, ShotSummary, Template } from '../../coach/types.ts';
import type { BagPhoto, ExtractedBag } from '../../llm/extractBag.ts';
import type { ContentBlock, Effort, LlmMessage, PendingUiCall, RunnerTool, RunResult, ToolResultBlock, ToolValidation } from '../../llm/types.ts';
import { resumesSearch, SEARCH_FIRST_MESSAGE, waitsOnServerTool } from '../../llm/runner.ts';
import { citedSites, siteOf, WEB_SEARCH_TOOL, webSearchUnavailable } from '../../llm/webSearch.ts';
import type {
  AppliedChange,
  Bag,
  ConversationRecord,
  IterationRecord,
  ProfileVersion,
  Settings,
  Storage,
} from '../../storage/types.ts';
import { NO_USAGE, type UsageTracker } from '../../usage/types.ts';
import type {
  BeanChoice,
  BeanPickerOption,
  CoachController,
  CoachPhase,
  CoachState,
  CoachUiMessage,
  CoachUiPart,
  NoticeProgress,
  SetAsideReason,
  ShotBaseline,
  ShotRating,
  ShotVerdict,
  TemplateCardItem,
  VersionLoad,
} from '../types.ts';
import { coachShares, previousLikeShot } from './funFacts.ts';
import { browserTimers, createOutbox, writeFailure, WriteLater, type OutboxTimers } from './outbox.ts';
import type { ApiPort, ChangePlan, Clock, CoachPort, LlmPort, ShotSource } from './ports.ts';
import {
  FACT_NOT_DUE,
  FACT_NOT_SHOWN_AGAIN,
  FACT_SHOWN,
  ONE_FACT_PER_REPLY,
  UNANSWERED_SHOT,
  UNANSWERED_TEXT,
  grinderPayload,
  intakeBlocks,
  photoIntakeText,
  pickedIntakeText,
  shotCompletedBlock,
  shotMeasuredBlock,
  shotRatedBlock,
  summaryForModel,
  textBlock,
  toolResult,
  unansweredToolUses,
  undoBlock,
  awaitingModel,
  type AdjustmentResultPayload,
  type GrinderOfferResultPayload,
  type TemplatePickedPayload,
} from './protocol.ts';
import { EXTRAS_KEY, cafaiNotesLine, isTasteQuestion, lastCafaiNotes, mergeNotes, tasteWords } from './shotNotes.ts';
import { setShotTds as setCardTds, shotCard, untoldReadings } from './shotReading.ts';
import {
  baselineFor,
  enjoymentFromScore,
  fillBaselines,
  isShotVerdict,
  needsBaseline,
  runningScore,
  untoldRatings,
  type CreditedShot,
} from './shotRating.ts';
import {
  NEW_BAG_PROMPT,
  appendText,
  bagConfirmPart,
  byRequestId,
  diffPart,
  factPart,
  filledBeanCard,
  finishStreaming,
  grinderOfferPart,
  isLoadingBeanCard,
  isOpenBagConfirm,
  isOpenBeanCard,
  loadingBeanPickerPart,
  message,
  noticePart,
  optionsPart,
  progressNoticePart,
  removeMessage,
  replaceParts,
  setAside,
  setDiffStatus,
  setGrinderOfferStatus,
  setShotRating,
  setVisualizerLink,
  shotPart,
  sourcesPart,
  startingYieldText,
  templatesPart,
  updatePart,
  withPart,
  withoutTransient,
} from './uiMessages.ts';

export interface EngineDeps {
  storage: Storage;
  telemetry: TelemetryStore;
  api: ApiPort;
  coach: CoachPort;
  llm: LlmPort;
  clock: Clock;
  newId(prefix: string): string;
  effort?: Effort;
  maxTokens?: number;
  /** How long to keep asking Decaid for a just-finished shot record. */
  shotFetch?: { attempts: number; delayMs: number };
  /** Timers for the outbox's retry every 30 s (the browser's by default). */
  timers?: OutboxTimers;
  /** Timers for the look at the machine's profile every 30 s (the browser's by default). */
  checkTimers?: OutboxTimers;
  /** Whether the page is in view, and when that changes (always in view by default). */
  visibility?: PageVisibility;
  /** The start-up restore brought the bags back from Decaid's backup (5.5). */
  restoredFromBackup?: boolean;
  /** Which of Decaid's optional plugins run (D103); none by default. */
  plugins?: Pick<PluginDirectory, 'isLoaded'>;
  /** The fun facts told on this device (D200); a list in memory by default. */
  told?: ToldList;
  /** CafAI's own fun facts (D199), read only when one is due; facts.json by default. */
  facts?: () => Promise<readonly FunFact[]>;
  /** Usage sharing's counts (D-USAGE-4); nothing by default. */
  usage?: UsageTracker;
}

/** The page's visibility: the WebView runs on with the page hidden behind another app or a dark screen. */
export interface PageVisibility {
  visible(): boolean;
  /** Calls `listener` when the page is shown or hidden; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const ALWAYS_VISIBLE: PageVisibility = { visible: () => true, subscribe: () => () => undefined };

export interface CoachEngine extends CoachController {
  start(): Promise<void>;
  dispose(): void;
  /** Records came back from Decaid's backup after start (5.4): read them again, and say so once. */
  restored(): Promise<void>;
}

const NO_PLUGINS: Pick<PluginDirectory, 'isLoaded'> = { isLoaded: () => false };

interface PendingCall {
  id: string;
  name: ToolName;
  input: unknown;
  plan?: ChangePlan;
  /** Rebuilt from the stored transcript (a reload), maybe before the grinder's steps were read. */
  recovered?: boolean;
  /** Confirm was tapped and the change is being applied: the phase no longer waits for it. */
  confirming?: boolean;
}

/** A coach tool as the runner sees it, and how a stored call of it is checked again after a reload. */
interface EngineTool extends RunnerTool {
  /** The checks of `validate`, without the wording of what the model wrote then (D127): its card already shows it. */
  validateStored(input: unknown): ToolValidation;
}

interface Session {
  bag: Bag;
  conversation: ConversationRecord;
  versions: ProfileVersion[];
  pending: PendingCall[];
  held: ToolResultBlock[];
  doseG: number | null;
  targetYieldG: number | null;
  /** The read of Decaid's dose and yield that started when the session opened. */
  numbers: Promise<void>;
  /**
   * The shot due a fun fact (D197), until a run that answers it ends: `shown`
   * once the coach shared one, else CafAI shows its own then. A run that
   * failed keeps it for the retry; the next shot replaces it.
   */
  factDue: { shotId: string; shown: boolean } | null;
  /**
   * The run going on answers something the barista typed, where they may
   * have asked for a fun fact (D201); a tap or a shot is not. Kept for the
   * Retry of a run that failed.
   */
  typedTurn: boolean;
}

/** What CafAI knows about a version on the machine (D55); see VersionLoad. A failed barrier leaves Decaid retrying its own upload. */
type LoadStatus = VersionLoad;

type LoadOutcome = { status: 'loaded' | 'waiting' | 'assumed' } | { status: 'failed'; reason: string };

interface ShotStart {
  shotId: string | null;
  /** The active version had not reached the machine when the shot started. */
  early: { versionId: string; status: LoadStatus; at: number } | null;
}

/**
 * A run of the machine that ended, as handleShotFinished reads it. Its Retry
 * looks again for the same object, so what was settled about the run holds
 * for every notice of it.
 */
interface ShotRun {
  shotId: string | null;
  started: ShotStart | null;
  /** runSaved()'s answer, asked as the run ended (D193). */
  saved: Promise<boolean | null>;
  /** Decaid aborted the run before its pour began, and so keeps no record of it (D204). */
  aborted: boolean;
  /** Decaid tore the run down mid-shot because the machine disconnected (D205). */
  disconnected: boolean;
  /** Decaid's stop decision for the run (targetWeight, apiStop, machineEnded…): it stopped the shot, so no disconnect cut it off (D205). */
  stopReason: string | null;
  /**
   * Whether the machine cut the shot off, settled by the first notice that
   * can know, and kept for every notice of it after (D205); null until then.
   */
  cutOff: boolean | null;
}

/** A problem that outlives other errors and chat turns: see `standing`. */
interface Standing {
  kind: 'load' | 'shot';
  message: string;
  retry: () => Promise<void>;
  /** A lost shot's run, which its Retry looks for. */
  run?: ShotRun;
}

/** What CafAI writes to a shot record's annotations (D61): notes and extras.cafai. */
interface TasteNote {
  bagId: string;
  versionId: string | null;
  version: number | null;
  selected: string[];
  text: string | null;
  notes: string;
}

/**
 * The barista's verdict as CafAI writes it to a shot record (D126): the
 * running score as `enjoyment`, and the verdict and what it was compared
 * with in extras.cafai.
 */
interface RatingNote extends ShotRating {
  comparedWith: ShotBaseline;
}

/**
 * The barista's reading as CafAI writes it to a shot record (D165):
 * drinkTds and drinkEy, `eyPct` null when CafAI could not work an EY out
 * (the card has no yield or no dose); `tdsPct` null clears both.
 */
interface ReadingNote {
  tdsPct: number | null;
  eyPct: number | null;
}

/** Everything CafAI still has to say about one shot; a newer write carries the older one's fields. */
interface ShotWrite {
  /** The bag whose chat has the shot: a write Decaid refuses is reported there, whichever bag is open by then. */
  bagId: string;
  taste?: TasteNote;
  rating?: RatingNote;
  reading?: ReadingNote;
}

const DEFAULT_YIELD_G = 36;
const STREAM_EMIT_MS = 50;
/** The banner while a finished shot has no record in Decaid (Retry looks again). */
const SHOT_NOT_SAVED = 'Decaid has not saved that shot yet.';
const SEARCH_NOTICE = 'Looking for that shot in Decaid…';
/** The chat's warning when a shot has no record in Decaid, by how the shot ended (D205). */
const CUT_OFF_NOTICE =
  'The machine disconnected during that shot, and Decaid has no record of it. When the machine is back, tap Retry to look again, or pull another shot.';
const NOT_SAVED_NOTICE = 'The shot finished, but Decaid has not saved it. Tap Retry to look again, or pull another shot.';
/** The same warning while Decaid is out of reach (D206): it says nothing of how the shot ended, which Decaid has not said. */
const UNREACHABLE_NOTICE =
  "Decaid can't be reached right now, so CafAI could not look for that shot. When it is back, tap Retry to look again, or pull another shot.";
/** The one line for a run stopped before it poured or in its first 2 s of pour (D204): no shot to taste, none to compare with. */
const NEVER_POURED = 'That shot stopped before it poured: nothing to taste.';
/**
 * Decaid answers the barrier 500 ms after the machine acknowledged the
 * profile's last write (its profileDownloadGuard), so a shot that started in
 * that window started after the upload.
 */
const UPLOAD_GUARD_MS = 500;
/**
 * How often CafAI looks at Decaid's workflow while the page is in view.
 * Decaid has no workflow stream, so this is how a profile loaded behind
 * CafAI's back (another skin, the machine's own screen) shows up before a
 * shot is wasted on it.
 */
export const MACHINE_CHECK_MS = 30_000;
const GRINDER_WRITE = 'grinder';
const SHOT_WRITE = 'shot:';
const shotWriteKey = (shotId: string) => `${SHOT_WRITE}${shotId}`;
/** A bag's name until its details are saved: it names no coffee. */
const NEW_BAG_NAME = 'New bag';
/** Said once per session, when Decaid has no barrier (5.12). */
const NO_BARRIER = 'This Decaid cannot confirm that the machine took a profile, so CafAI will assume it did.';
const ADDED_TO_BEANS = "Added to Decaid's beans.";
/** The bean and the batch were in the library already (a photo of a bag picked before): linked, nothing added. */
const ALREADY_IN_BEANS = "Already in Decaid's beans.";
const BAGS_ARE_BACK = "Your bags are back from Decaid's backup.";
/** The bean card lists at most this many batches (6.1). */
const MAX_BEAN_OPTIONS = 8;
const NEEDS_KEY = 'Add your API key in Settings first.';
const READING_BAG = 'Reading the bag…';
const NO_PHOTO_READER = 'CafAI cannot read photos here. Describe the bag in the chat.';
const DYE2_UNREACHABLE = "Decaid can't be reached right now, so DYE2's setups could not be read.";
/** Said once, when Anthropic refused the coach's web search (D203): turned off for the organisation, or of no use to it. */
const NO_WEB_SEARCH = 'Web search is not available for your Anthropic account, so the coach shares what it knows.';
/** How often, and for how long, CafAI looks for a shot's Visualizer upload: every 3 s for 30 s (streamline's rule, 6.4). */
const VISUALIZER_LOOK_MS = 3_000;
const VISUALIZER_WATCH_MS = 30_000;

/** Text from Decaid or a photo that travels on to the coach and Decaid: never a key (D37). */
function withoutKey(text: string | null): string | null {
  return text === null ? null : redactKeyLike(text, 'key removed');
}

/** Text cut to what a bag detail holds; blank, or not text, is null. */
function clip(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.trim().slice(0, max).trim() || null : null;
}

/** A batch as the bean card offers it, with the date it was added for the order. */
interface Pickable {
  option: BeanPickerOption;
  createdAt: string;
}

/** A batch of Decaid's bean library as a row of the bean card, filled the way a pick fills the bag (6.1). */
function pickable(bean: Bean, batch: BeanBatch): Pickable[] {
  const name = clip(bean.name, BAG_LIMITS.name);
  if (!name) return [];
  const origin = [clip(bean.country, BAG_LIMITS.origin), clip(bean.region, BAG_LIMITS.origin)].filter(Boolean).join(', ');
  return [
    {
      option: {
        beanId: bean.id,
        batchId: batch.id,
        name,
        roaster: clip(bean.roaster, BAG_LIMITS.roaster),
        origin: clip(origin, BAG_LIMITS.origin),
        process: clip(bean.processing, BAG_LIMITS.process),
        notes: clip(bean.notes, BAG_LIMITS.notes),
        roastLevel: toRoastLevel(batch.roastLevel),
        roastDate: writtenDate(batch.roastDate),
        freezeDate: writtenDate(batch.freezeDate),
        unfreezeDate: writtenDate(batch.unfreezeDate),
      },
      createdAt: typeof batch.createdAt === 'string' ? batch.createdAt : '',
    },
  ];
}

/** Newest roast first; batches without a roast date after them, the newest added first. */
function newestRoastFirst(a: Pickable, b: Pickable): number {
  const [roastA, roastB] = [a.option.roastDate, b.option.roastDate];
  if (roastA !== roastB) {
    if (roastA === null) return 1;
    if (roastB === null) return -1;
    return roastB.localeCompare(roastA);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** The bag's details as save_bag_details takes them. */
function bagDetails(bag: Bag): SaveBagDetails {
  return {
    name: bag.name,
    roaster: bag.roaster,
    origin: bag.origin,
    roastLevel: bag.roastLevel,
    process: bag.process,
    notes: bag.notes,
    roastDate: bag.roastDate ?? null,
  };
}

/**
 * A save_bag_details call written before roastDate existed (a stored chat
 * replayed after an update, a recorded one) reads as a roast date nobody
 * knows. The model itself always sends every key: its tools are strict.
 */
function withRoastDate(input: unknown): unknown {
  return typeof input === 'object' && input !== null && !Array.isArray(input) && !('roastDate' in input) ? { ...input, roastDate: null } : input;
}

/** A new bean for Decaid's library from a bag's details (D102); a detail CafAI does not know is left out. */
function beanRequest(bag: Bag, roaster: string, name: string): BeanCreateRequest {
  const request: BeanCreateRequest = { roaster, name };
  if (bag.origin) request.country = bag.origin;
  if (bag.process) request.processing = bag.process;
  if (bag.notes) request.notes = bag.notes;
  return request;
}

/** The bag's batch: its roast date and roast level, when known. */
function batchRequest(bag: Bag): BatchCreateRequest {
  const request: BatchCreateRequest = {};
  if (bag.roastDate) request.roastDate = bag.roastDate;
  if (bag.roastLevel) request.roastLevel = bag.roastLevel;
  return request;
}

/** Case and the spaces around it aside, the same name. */
function sameName(a: string | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

/** A write could not read the shot record it adds to (the notes, D61): the read is what failed. */
class RecordReadFailed extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(describe(reason));
    this.name = 'RecordReadFailed';
    this.reason = reason;
  }
}

/**
 * The beverage types whose runs Decaid never saves as shots: it gives such a
 * run a shot id and shotState frames like a shot's, and then keeps no record
 * of it (`_persistShotIfNeeded`, de1_state_manager.dart:835, 849, 911-917 at
 * aab5f93). Decent's Forward Flush x5, the weekly clean's profile, is one.
 */
const UNSAVED_BEVERAGES: ReadonlySet<string> = new Set(['cleaning', 'calibrate']);

/**
 * Whether Decaid saves a run of this profile as a shot. Its beverage type is
 * read as Decaid reads it: case aside, and none, or a name Decaid does not
 * know, is espresso (profile.dart:146-153), which Decaid saves.
 */
function savedAsShot(profile: unknown): boolean {
  const type = typeof profile === 'object' && profile !== null ? (profile as Record<string, unknown>).beverage_type : undefined;
  return !(typeof type === 'string' && UNSAVED_BEVERAGES.has(type.toLowerCase()));
}

/** The CafAI version id a workflow context was tagged with at activation, if any. */
function taggedVersionId(context: WorkflowContext | undefined): string | null {
  const tag = context?.extras?.[EXTRAS_KEY];
  if (typeof tag !== 'object' || tag === null) return null;
  const versionId = (tag as Record<string, unknown>).versionId;
  return typeof versionId === 'string' ? versionId : null;
}

/**
 * Whether this iteration's confirmed change made `version`: a shot on the
 * version's parent, applied, with the very change the version records. The
 * latest applied shot on the parent is not always it: only a profile change
 * makes a version, so a by-hand grind or dose move or a kept recipe never is,
 * and a change confirmed from a typed request was recorded on no iteration.
 */
function madeVersion(iteration: IterationRecord, version: ProfileVersion): boolean {
  const { change } = iteration;
  const made = version.change;
  if (iteration.outcome !== 'applied' || change?.variable !== 'profile' || !made) return false;
  if (version.parentVersionId === null || iteration.profileVersionId !== version.parentVersionId) return false;
  return change.variable === made.variable && change.lever === made.lever && change.from === made.from && change.to === made.to;
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function createCoachEngine(deps: EngineDeps): CoachEngine {
  const { storage, telemetry, api, coach, llm, clock } = deps;
  const effort: Effort = deps.effort ?? 'medium';
  const shotFetch = deps.shotFetch ?? { attempts: 6, delayMs: 500 };
  const checkTimers = deps.checkTimers ?? browserTimers;
  const visibility = deps.visibility ?? ALWAYS_VISIBLE;
  const plugins = deps.plugins ?? NO_PLUGINS;
  const told = deps.told ?? createToldList(null);
  const facts = deps.facts ?? loadFacts;
  const usage = deps.usage ?? NO_USAGE;

  let state: CoachState = {
    ready: false,
    bags: [],
    activeBag: null,
    activeVersion: null,
    versions: [],
    phase: 'no_bag',
    messages: [],
    busy: false,
    hasApiKey: false,
    error: null,
    canUndo: false,
    activeLoad: null,
    machineTick: 0,
    restoredFromBackup: deps.restoredFromBackup ?? false,
  };
  let settings: Settings = { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null };
  let session: Session | null = null;
  let lastFailed: (() => Promise<void>) | null = null;
  /**
   * A problem that outlives other errors and chat turns: the machine not
   * running the bag's version, or a finished shot Decaid has not saved.
   * emit() puts it on the banner, with its own Retry, whenever nothing else
   * is there.
   */
  let standing: Standing | null = null;

  /** Set (or clear) the standing problem; the banner follows when it shows the old one. */
  function replaceStanding(next: Standing | null): void {
    if (standing && state.error === standing.message) setError(null);
    standing = next;
  }

  function setLoadProblem(versionId: string, message: string): void {
    replaceStanding({ kind: 'load', message, retry: () => retryActivation(versionId) });
  }

  /** The problem is solved: off the banner too, if that is what it shows. */
  function clearStanding(kind: 'load' | 'shot'): void {
    if (standing?.kind === kind) replaceStanding(null);
  }
  const shotCache = new Map<string, ShotRecord>();
  const listeners = new Set<() => void>();
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeShot: (() => void) | null = null;
  let unsubscribeTelemetry: (() => void) | null = null;
  /** Decaid reported the machine refused this version's upload; cleared by a successful load. */
  let uploadFailedFor: string | null = null;
  /** The last version CafAI put in the workflow, and how far it got (D55); null since start-up. */
  let machineLoad: { versionId: string; status: LoadStatus; at: number } | null = null;
  /** False once Decaid answered the barrier with 404/405 (an older Decaid): not asked again this session. */
  let barrierSupported = true;
  /** The shot being pulled, as it started. */
  let shotStart: ShotStart | null = null;
  /**
   * What Decaid's shotState decisions said of its newest run, by the run's
   * shot id: that it aborted the run before the pour began, and so keeps no
   * record of it (D204), or tore it down because the machine disconnected
   * (D205). The frame that says so comes before the one that ends the
   * run, so it is known by the time the run's end is handled.
   */
  let runDecisions: { shotId: string; aborted: boolean; disconnected: boolean } | null = null;
  /**
   * The grinder linked in Settings, as Decaid's grinder library last
   * described it (D62), with the id it was read for: info is null when
   * Decaid has no grinder with that id. Null until a read answered.
   */
  let linkedGrinder: { id: string; info: GrinderInfo | null } | null = null;
  /** Numbers the grinder reads, so a slow answer never overwrites a newer one. */
  let grinderReads = 0;
  /** True while Decaid's barrier runs: a version is on its way to the machine. */
  let barrierInFlight = false;
  /**
   * The profile CafAI last said the machine runs instead of the active
   * version (version, title and content), so the 30 s look raises each
   * mismatch once: a banner the user dismissed stays dismissed (D52).
   */
  let mismatchSeen: string | null = null;
  let checkTimer: unknown = null;
  let checkQueued = false;
  let disposed = false;
  let unsubscribeVisibility: (() => void) | null = null;
  const outbox = createOutbox({ timers: deps.timers, onDrop: (key, error) => writeDropped(key, error) });
  const shotWrites = new Map<string, ShotWrite>();
  /** Decaid's rating scale once it said (D101); asked again while it is null. */
  let enjoymentScale: EnjoymentScale | null = null;
  /** The question in flight, so two writes never ask it twice. */
  let scaleProbe: Promise<EnjoymentScale | null> | null = null;
  /**
   * Decaid answered the question with something that tells neither scale
   * (reported as drift where it was read): it is asked again after the next
   * shot, not at every try of the waiting rating.
   */
  let scaleUnclear = false;
  /** False once Anthropic refused a request for its web search (D203): the coach shares what it knows for the rest of the session. */
  let webSearch = true;
  /** A fun fact was shown in the model run going on: one per run, the coach's or CafAI's. */
  let factShown = false;
  /** Bags being added to Decaid's bean library now, so a second save never adds a second batch. */
  const linking = new Set<string>();
  /** Bags whose bean card is reading Decaid's batches now, so a second open reads them once. */
  const filling = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const nowIso = () => clock.now().toISOString();

  // -------------------------------------------------------------------------
  // State plumbing
  // -------------------------------------------------------------------------

  function activeVersion(s: Session | null): ProfileVersion | null {
    if (!s?.bag.activeVersionId) return null;
    return s.versions.find((v) => v.id === s.bag.activeVersionId) ?? null;
  }

  function computePhase(s: Session | null): CoachPhase {
    if (!s) return 'no_bag';
    // A change being applied and loaded is no longer waiting for Confirm.
    const names = s.pending.filter((p) => !p.confirming).map((p) => p.name);
    if (names.includes(TOOL.proposeAdjustment)) return 'awaiting_confirmation';
    if (names.includes(TOOL.askUser)) return 'awaiting_feedback';
    if (names.includes(TOOL.proposeTemplates)) return 'choosing_template';
    // Described, but no profile yet (e.g. the suggestions were set aside).
    if (!activeVersion(s)) return s.conversation.apiMessages.length === 0 ? 'intake' : 'idle';
    return 'awaiting_shot';
  }

  function canUndo(s: Session | null): boolean {
    const current = activeVersion(s);
    return Boolean(current && current.parentVersionId && current.change && current.status === 'active');
  }

  /** How far the active version's load got (D55); null when CafAI has not loaded it since it started. */
  function activeLoad(s: Session | null): LoadStatus | null {
    const version = activeVersion(s);
    if (!version) return null;
    if (uploadFailedFor === version.id) return 'failed';
    return machineLoad?.versionId === version.id ? machineLoad.status : null;
  }

  function emit(): void {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (!state.error && standing && !state.busy) {
      state = { ...state, error: standing.message };
      lastFailed = standing.retry;
    }
    state = {
      ...state,
      activeBag: session?.bag ?? null,
      activeVersion: activeVersion(session),
      versions: session ? [...session.versions].sort((a, b) => a.version - b.version) : [],
      phase: computePhase(session),
      canUndo: !state.busy && canUndo(session),
      activeLoad: activeLoad(session),
    };
    for (const listener of [...listeners]) listener();
  }

  /** Streaming deltas arrive fast; coalesce them into ~20 renders a second. */
  function scheduleEmit(): void {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emit();
    }, STREAM_EMIT_MS);
  }

  function setMessages(messages: CoachUiMessage[]): void {
    state = { ...state, messages };
  }

  function addMessage(role: CoachUiMessage['role'], parts: CoachUiMessage['parts']): void {
    setMessages([...state.messages, message(deps.newId('msg'), role, parts, nowIso())]);
  }

  /** Show, or update in place, a transient progress notice; returns its message id. */
  function showProgress(messageId: string | null, text: string, progress: NoticeProgress): string {
    const parts: CoachUiPart[] = [progressNoticePart(text, progress)];
    if (messageId && state.messages.some((m) => m.id === messageId)) {
      setMessages(replaceParts(state.messages, messageId, parts));
      return messageId;
    }
    const id = deps.newId('msg');
    setMessages([...state.messages, message(id, 'system', parts, nowIso())]);
    return id;
  }

  function hideProgress(messageId: string): void {
    setMessages(removeMessage(state.messages, messageId));
  }

  function setError(error: string | null, retry: (() => Promise<void>) | null = null): void {
    state = { ...state, error };
    lastFailed = retry;
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  async function persistConversation(s: Session): Promise<void> {
    // Progress notices describe work in flight; a stored one would spin forever after a reload.
    s.conversation = { ...s.conversation, uiMessages: withoutTransient(state.messages), updatedAt: nowIso() };
    await storage.conversations.put(s.conversation);
  }

  async function persistBag(s: Session, patch: Partial<Bag>): Promise<void> {
    s.bag = { ...s.bag, ...patch, updatedAt: nowIso() };
    await storage.bags.put(s.bag);
    state = { ...state, bags: upsert(state.bags, s.bag) };
  }

  function upsert(bags: Bag[], bag: Bag): Bag[] {
    const index = bags.findIndex((b) => b.id === bag.id);
    if (index < 0) return [bag, ...bags];
    const next = bags.slice();
    next[index] = bag;
    return next;
  }

  function isShotRunning(): boolean {
    return shotInProgress(telemetry.getState());
  }

  /** Where a version stops, in grams: its own target_weight, else what Decaid had. */
  function versionYield(s: Session, profile: ProfileJson): number {
    return profile.target_weight ?? s.targetYieldG ?? DEFAULT_YIELD_G;
  }

  function workflowContext(
    s: Session,
    versionId: string,
    profile: ProfileJson,
    patch: ChangePlan['contextPatch'] = {},
  ): WorkflowContext {
    const context: WorkflowContext = {
      targetYield: patch.targetYield ?? versionYield(s, profile),
    };
    // A dose CafAI does not coach from counts as unknown (D57), so it is never
    // written back: the user may have set the real one in Decaid since, as
    // CafAI's notice asked.
    const dose = patch.targetDoseWeight ?? coach.knownDose(s.doseG);
    if (dose) context.targetDoseWeight = dose;
    // Decaid merges the context field by field, so anything left over from the
    // previous coffee (another skin's bean batch, the old roaster) would stick
    // to this coffee's shots: send the bag's own, or null to clear (D102).
    context.coffeeName = s.bag.name || null;
    context.coffeeRoaster = s.bag.roaster ?? null;
    context.beanBatchId = s.bag.decaidBatchId ?? null;
    Object.assign(context, grinderContext());
    // Which CafAI version this is: shot records keep the workflow, so a shot
    // can be told apart even from a same-named or same-content version.
    context.extras = { [EXTRAS_KEY]: { versionId, bagId: s.bag.id } };
    return context;
  }

  /**
   * The grinder as last saved, linked from Decaid's library (D62); null clears
   * another skin's. Its burrs are cleared too (5.2): a Decaid that keeps them
   * fills them in from its grinder library when it stores a shot.
   */
  function grinderContext(): Pick<WorkflowContext, 'grinderId' | 'grinderModel' | 'grinderSetting' | 'grinderBurrs'> {
    return {
      grinderId: settings.grinderId ?? null,
      grinderModel: settings.grinderName ?? null,
      grinderSetting: settings.grinderSetting ?? null,
      grinderBurrs: null,
    };
  }

  function sameContent(profile: WireProfile | ProfileJson, version: ProfileVersion): boolean {
    try {
      return coach.profileId(profile) === coach.profileId(version.profile);
    } catch {
      return false;
    }
  }

  /**
   * True when a shot record's workflow shows the machine ran this version.
   * The CafAI tag (context.extras.cafai) names the version that was loaded
   * last and tells same-named or same-content versions apart; the profile
   * must still match, because another skin can change the profile and leave
   * the tag (Decaid merges the context field by field). Without a tag only
   * identical brewing content counts: a title alone is not enough.
   */
  function ranVersion(workflow: Workflow, version: ProfileVersion): boolean {
    const tagged = taggedVersionId(workflow.context);
    if (tagged !== null && tagged !== version.id) return false;
    if (sameContent(workflow.profile, version)) return true;
    return tagged !== null && workflow.profile.title === version.title;
  }

  /**
   * True when the workflow carries this version exactly as CafAI loads it:
   * its tag (when there is one), its title and its brewing content. Two bags
   * whose v1 use the same template have identical content, and two bags can
   * share a name.
   */
  function carriesVersion(workflow: Workflow, version: ProfileVersion): boolean {
    if (!workflow.profile || workflow.profile.title !== version.title || !sameContent(workflow.profile, version)) {
      return false;
    }
    const tagged = taggedVersionId(workflow.context);
    return tagged === null || tagged === version.id;
  }

  /** The wording without Decaid's barrier (an older Decaid): trust the workflow, as before D55. */
  function loadedNotice(title: string) {
    return telemetry.getState().machineConnected
      ? noticePart('success', `Loaded ${title} on the machine.`)
      : noticePart('info', `Saved ${title}. Decaid loads it when the machine connects.`);
  }

  async function loadWorkflowNumbers(s: Session): Promise<void> {
    try {
      const workflow = await api.getWorkflow();
      s.doseG = workflow.context?.targetDoseWeight ?? null;
      s.targetYieldG = workflow.context?.targetYield ?? null;
    } catch {
      // Decaid unreachable: keep defaults; the user can still talk to the coach.
    }
  }

  // -------------------------------------------------------------------------
  // The grinder linked from Decaid's grinder library (D62)
  // -------------------------------------------------------------------------

  /**
   * Read the linked grinder's dial from Decaid's grinder library, in the
   * background: nothing waits for it, and nothing fails because of it. The
   * newest read wins. A read that fails keeps what CafAI had for that grinder
   * (or nothing); the next refresh asks again.
   */
  function loadGrinder(): void {
    const id = settings.grinderId ?? null;
    const read = ++grinderReads;
    if (id === null) {
      linkedGrinder = null;
      return;
    }
    api.getGrinder(id).then(
      (info) => {
        if (read === grinderReads) linkedGrinder = { id, info };
      },
      () => {
        // Decaid unreachable (or a Decaid without the library): keep what CafAI has.
      },
    );
  }

  /** The linked grinder's dial, when Decaid's library described it; never another grinder's. */
  function grinderInfo(): GrinderInfo | null {
    const id = settings.grinderId ?? null;
    return id !== null && linkedGrinder?.id === id ? linkedGrinder.info : null;
  }

  /** The grinder as the model hears it: as last saved, with its dial when Decaid knows it. */
  function grinderForModel() {
    return grinderPayload(settings.grinderName, settings.grinderSetting, grinderInfo(), (settings.grinderId ?? null) !== null);
  }

  // -------------------------------------------------------------------------
  // Writes to Decaid that must not be lost (D64)
  // -------------------------------------------------------------------------

  /**
   * Write the grinder as last saved to Decaid's workflow context, so the next
   * shots carry it (D54), with its id in Decaid's grinder library (D62). A
   * write Decaid cannot take now waits in the outbox; the chat says so once,
   * and nothing when it goes through later. One Decaid refuses is dropped,
   * and writeDropped says so instead.
   */
  async function sendGrinder(): Promise<void> {
    const grinder = grinderContext();
    const sent = await outbox.put(GRINDER_WRITE, () => api.updateWorkflow({ context: grinder }));
    const s = session;
    if (sent || !s) return;
    const what = grinder.grinderSetting ? `grinder setting ${grinder.grinderSetting}` : 'the grinder change';
    addMessage('system', [noticePart('warning', `Decaid can't be reached right now. CafAI will send ${what} as soon as it can.`)]);
    await persistConversation(s);
    emit();
  }

  /** Add to what CafAI writes to a shot's record, and send it all (latest wins in the outbox). */
  function queueShotWrite(shotId: string, change: ShotWrite): Promise<boolean> {
    shotWrites.set(shotId, { ...shotWrites.get(shotId), ...change });
    return outbox.put(shotWriteKey(shotId), () => writeShot(shotId));
  }

  /**
   * Decaid's rating scale (D101), asked once per session before the first
   * rating goes out: 10 on current builds, 100 on 0.8.6 field builds. Null
   * while Decaid could not be asked (the next try asks again) or after it
   * answered something that tells neither (asked again after the next shot).
   */
  function ratingScale(): Promise<EnjoymentScale | null> {
    if (enjoymentScale !== null) return Promise.resolve(enjoymentScale);
    if (scaleUnclear) return Promise.resolve(null);
    scaleProbe ??= api
      .probeEnjoymentScale()
      .catch(() => {
        scaleUnclear = true;
        return null;
      })
      .then((scale) => {
        enjoymentScale = scale;
        scaleProbe = null;
        return scale;
      });
    return scaleProbe;
  }

  /**
   * One PUT /shots/{id} with everything CafAI still has to say about the shot.
   * Safe to repeat: Decaid merges extras key by key, and CafAI's notes line
   * replaces its own previous line instead of piling up. The rating waits in
   * the outbox until Decaid has said its rating scale; the taste and a TDS
   * reading go on without it. Only the taste reads the record first (its
   * notes as they are now): a record CafAI cannot read, or one Decaid
   * refuses, costs the taste alone, and the reading and the rating still go
   * (D194).
   */
  async function writeShot(shotId: string): Promise<void> {
    const write = shotWrites.get(shotId);
    if (!write) return;
    const own: Record<string, unknown> = {};
    const annotations: ShotAnnotationsPatch = {};
    if (write.reading) {
      // Both, always (D165): a TDS CafAI has no EY for clears an EY another app worked out from another TDS.
      annotations.drinkTds = write.reading.tdsPct;
      annotations.drinkEy = write.reading.tdsPct === null ? null : write.reading.eyPct;
    }
    let unread: RecordReadFailed | null = null;
    if (write.taste) {
      try {
        // The notes as they are now: a person may have written some in Decaid since.
        const record = await api.getShot(shotId);
        shotCache.set(record.id, record);
        annotations.espressoNotes = mergeNotes(record.annotations?.espressoNotes, lastCafaiNotes(record.annotations), write.taste.notes);
        Object.assign(own, write.taste);
      } catch (error) {
        // The write waits while Decaid may answer later. Otherwise nothing was
        // written (an unreadable record is no write Decaid took): the read failed.
        if (writeFailure(error) === 'retry') throw error;
        unread = new RecordReadFailed(error);
      }
    }
    // The taste was all there was to say: the read's failure is the write's.
    if (unread && write.reading === undefined && write.rating === undefined) throw unread;
    const scale = write.rating === undefined ? null : await ratingScale();
    if (write.rating !== undefined && scale !== null) {
      annotations.enjoyment = enjoymentFromScore(write.rating.score, scale);
      own.verdict = write.rating.verdict;
      own.comparedWith = write.rating.comparedWith;
    }
    if (Object.keys(own).length > 0) annotations.extras = { [EXTRAS_KEY]: own };
    if (Object.keys(annotations).length > 0) {
      try {
        await api.updateShot(shotId, { annotations });
      } catch (error) {
        // Decaid took it and only its reply was unreadable (reported where it was read).
        if (writeFailure(error) !== 'landed') throw error;
      }
    }
    // A newer write came in meanwhile: it carries everything, the rating included, and reads for the taste again.
    if (shotWrites.get(shotId) !== write) return;
    // The rest went (or waits for the scale): the taste is all that was lost, and the chat says so.
    if (unread) shotWriteLost(write.bagId, { taste: write.taste }, unread);
    if (write.rating === undefined || scale !== null) {
      shotWrites.delete(shotId);
      return;
    }
    shotWrites.set(shotId, { bagId: write.bagId, rating: write.rating });
    throw new WriteLater('Decaid has not said which rating scale it uses yet.');
  }

  /**
   * A write that cannot succeed was dropped rather than tried forever (5.11):
   * a refusal is reported as drift under the request Decaid refused, and the
   * chat says once what was not saved: the shot's own bag's chat for a shot
   * write, the chat on screen for the grinder. A failure in CafAI itself gets
   * a plain sentence; its detail goes to the log Decaid keeps of the WebView.
   */
  function writeDropped(key: string, error: unknown): void {
    if (!key.startsWith(SHOT_WRITE)) {
      sayNotSaved('the grinder for the next shots', null, 'PUT /api/v1/workflow', 'context', error);
      return;
    }
    const shotId = key.slice(SHOT_WRITE.length);
    const write = shotWrites.get(shotId);
    shotWrites.delete(shotId);
    shotWriteLost(write?.bagId ?? null, write, error);
  }

  /**
   * Say what of a shot write was not saved (`lost`: whichever of its taste,
   * rating and reading it names), in the shot's own bag's chat: all of a
   * write that was dropped, or the taste alone when its read failed and the
   * rest went (D194).
   */
  function shotWriteLost(bagId: string | null, lost: Pick<ShotWrite, 'taste' | 'rating' | 'reading'> | undefined, error: unknown): void {
    const readFailed = error instanceof RecordReadFailed;
    const parts = [...(lost?.taste ? ['the taste'] : []), ...(lost?.rating ? ['the rating'] : []), ...(lost?.reading ? ['the TDS'] : [])];
    const listed = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    sayNotSaved(
      `${listed ?? 'the notes'} for this shot`,
      bagId,
      readFailed ? 'GET /api/v1/shots/{id}' : 'PUT /api/v1/shots/{id}',
      readFailed ? 'record' : 'annotations',
      readFailed ? error.reason : error,
    );
  }

  /** Say once that `what` was not saved: a refusal names Decaid's reason and is reported as drift under `source`. */
  function sayNotSaved(what: string, bagId: string | null, source: string, field: string, cause: unknown): void {
    const refused = cause instanceof GatewayError && cause.status >= 400 && cause.status < 500;
    let text: string;
    if (refused) {
      reportDrift(source, `${field}: refused (HTTP ${cause.status})`);
      text = `Decaid would not save ${what}: ${describe(cause).replace(/[.\s]+$/, '')}.`;
    } else {
      console.error(`CafAI could not save ${what}:`, describe(cause));
      text = `CafAI could not save ${what}.`;
    }
    const notice = noticePart('warning', text);
    void enqueue(async () => {
      const s = session;
      // The shot's bag is no longer on screen: the notice waits in its stored chat.
      if (bagId !== null && s?.bag.id !== bagId) return noteInStoredChat(bagId, notice);
      if (!s) return;
      addMessage('system', [notice]);
      await persistConversation(s);
      emit();
    });
  }

  /** A notice for a bag that is not on screen, at the end of its stored chat, where it shows when the bag is opened. */
  async function noteInStoredChat(bagId: string, part: CoachUiPart): Promise<void> {
    const bag = await storage.bags.get(bagId);
    const stored = bag ? await storage.conversations.get(bag.conversationId) : undefined;
    if (!stored) return;
    const at = nowIso();
    await storage.conversations.put({ ...stored, uiMessages: [...stored.uiMessages, message(deps.newId('msg'), 'system', [part], at)], updatedAt: at });
  }

  /**
   * The taste answer, on the iteration's shot record in Decaid (D61): a short
   * notes line and extras.cafai. Never a key (D37).
   */
  function noteTaste(s: Session, iteration: IterationRecord, selected: string[], text: string | null): void {
    if (!iteration.shotId) return;
    const words = tasteWords(selected, text);
    if (!words) return;
    usage.track('taste_given');
    const version = s.versions.find((v) => v.id === iteration.profileVersionId);
    const taste: TasteNote = {
      bagId: s.bag.id,
      versionId: iteration.profileVersionId,
      version: iteration.profileVersion,
      selected: selected.map((option) => redactKeyLike(option)),
      text: text === null ? null : redactKeyLike(text),
      notes: cafaiNotesLine(words, version?.title ?? s.bag.name),
    };
    void queueShotWrite(iteration.shotId, { bagId: s.bag.id, taste });
  }

  // -------------------------------------------------------------------------
  // Decaid's bean library (D102)
  // -------------------------------------------------------------------------

  /**
   * After a bag's details were saved: add it to Decaid's bean library, reusing
   * the bean with the same roaster and name or adding one, then reusing that
   * bean's unarchived batch with the bag's roast date when both dates are
   * known, or adding a batch, and keep both ids on the bag so every load names
   * its batch. Not for a bag without a roaster (Decaid needs one) or a name of
   * its own. In the background: nothing waits for it.
   * A failure (Decaid away, or a reply CafAI could not read, reported as
   * drift) leaves the bag unlinked for the next save to try again. CafAI never
   * edits or deletes a bean or a batch: a detail corrected later changes the
   * bag only.
   */
  function linkBag(bag: Bag): void {
    const roaster = bag.roaster?.trim() ?? '';
    const name = bag.name.trim();
    if (bag.decaidBatchId || !roaster || !name || name === NEW_BAG_NAME || linking.has(bag.id)) return;
    linking.add(bag.id);
    void (async () => {
      try {
        const beans = await api.listBeans();
        const known = beans.find((b) => sameName(b.roaster, roaster) && sameName(b.name, name));
        const bean = known ?? (await api.createBean(beanRequest(bag, roaster, name)));
        // A bean already in the library may hold this very bag, as when its photo was taken instead of picking it.
        // Only the roast date tells: an undated batch may be an earlier bag of the same coffee, so a bag
        // without a date gets a batch of its own rather than another bag's shots and setups.
        const roastDate = bag.roastDate ?? null;
        const same =
          known && roastDate !== null
            ? (await api.listBatches(bean.id)).find((b) => b.archived !== true && writtenDate(b.roastDate) === roastDate)
            : undefined;
        const batch = same ?? (await api.createBatch(bean.id, batchRequest(bag)));
        // In turn with the engine's actions, so the note never lands inside a reply.
        await enqueue(() => storeLink(bag.id, bean.id, batch.id, same ? ALREADY_IN_BEANS : ADDED_TO_BEANS));
      } catch {
        // The next save tries again.
      } finally {
        linking.delete(bag.id);
      }
    })();
  }

  /** Keep a bag's link to Decaid's bean library; say so (`note`) in its chat when it is on screen. */
  async function storeLink(bagId: string, beanId: string, batchId: string, note: string): Promise<void> {
    const link = { decaidBeanId: beanId, decaidBatchId: batchId };
    const s = session;
    if (s?.bag.id === bagId) {
      await persistBag(s, link);
      addMessage('system', [noticePart('info', note)]);
      await persistConversation(s);
    } else {
      const stored = await storage.bags.get(bagId);
      if (!stored) return;
      const linked: Bag = { ...stored, ...link, updatedAt: nowIso() };
      await storage.bags.put(linked);
      state = { ...state, bags: upsert(state.bags, linked) };
    }
    emit();
  }

  /**
   * The bag's details as the coach (save_bag_details) or the photo's confirm
   * card gave them, roast date included, then its place in Decaid's bean
   * library: saved first, as the batch Decaid gets is read from the bag.
   */
  async function saveBagDetails(s: Session, details: SaveBagDetails): Promise<void> {
    // The first details a bag gets, by the coach's tool or a confirmed photo: a dial-in has begun.
    if (s.bag.name === NEW_BAG_NAME) usage.track('bag_started');
    await persistBag(s, {
      name: withoutKey(details.name.trim()) || NEW_BAG_NAME,
      roaster: withoutKey(details.roaster),
      origin: withoutKey(details.origin),
      roastLevel: details.roastLevel,
      process: withoutKey(details.process),
      notes: withoutKey(details.notes),
      roastDate: details.roastDate,
    });
    emit();
    linkBag(s.bag);
  }

  // -------------------------------------------------------------------------
  // "Which coffee is it?": the bean card and the bag photo (6.1, 6.8)
  // -------------------------------------------------------------------------

  /**
   * The bean card's rows: Decaid's unarchived batches of unarchived beans,
   * newest roast first, at most 8, in two requests whatever the size of the
   * library (the beans, and every batch at once). None when the library is
   * empty or Decaid cannot be read.
   */
  async function beanOptions(): Promise<BeanPickerOption[]> {
    let beans: Bean[];
    let batches: BeanBatch[];
    try {
      [beans, batches] = await Promise.all([api.listBeans(), api.listAllBatches()]);
    } catch {
      return []; // Decaid away, or a Decaid without the bean library: a photo or something else.
    }
    const byId = new Map(beans.filter((bean) => bean.archived !== true).map((bean) => [bean.id, bean]));
    return batches
      .flatMap((batch) => {
        const bean = byId.get(batch.beanId);
        return bean && batch.archived !== true ? pickable(bean, batch) : [];
      })
      .sort(newestRoastFirst)
      .slice(0, MAX_BEAN_OPTIONS)
      .map(({ option }) => option);
  }

  /**
   * The bean card's rows, read in the background once the card is up: the
   * barista can take a photo or say something else meanwhile, and nothing
   * waits for Decaid. The rows land in turn with the engine's actions, on the
   * card still loading, answered or not; a bag no longer on screen keeps its
   * loading card, read again when the bag is opened.
   */
  function fillBeanCard(bagId: string): void {
    if (filling.has(bagId)) return;
    filling.add(bagId);
    void (async () => {
      try {
        const options = await beanOptions();
        await enqueue(async () => {
          const s = session;
          if (disposed || s?.bag.id !== bagId || !state.messages.some((m) => m.parts.some(isLoadingBeanCard))) return;
          setMessages(updatePart(state.messages, isLoadingBeanCard, (part) => filledBeanCard(part, options)));
          await persistConversation(s);
          emit();
        });
      } finally {
        filling.delete(bagId);
      }
    })();
  }

  /** The bean card while it waits for an answer, if the chat on screen has one. */
  function openBeanCard(): Extract<CoachUiPart, { kind: 'beanPicker' }> | null {
    for (const m of state.messages) {
      for (const part of m.parts) if (part.kind === 'beanPicker' && isOpenBeanCard(part)) return part;
    }
    return null;
  }

  function answerBeanCard(choice: BeanChoice): void {
    setMessages(updatePart(state.messages, isOpenBeanCard, (part) => (part.kind === 'beanPicker' ? { ...part, choice } : part)));
  }

  /** The freezer dates of the batch picked on the bean card, as Decaid had them then (6.1). */
  function pickedFreezer(batchId: string): FreezerDates | null {
    for (const m of state.messages) {
      for (const part of m.parts) {
        if (part.kind !== 'beanPicker' || part.choice?.kind !== 'batch' || part.choice.batchId !== batchId) continue;
        const option = part.options.find((o) => o.batchId === batchId);
        if (option) return { freezeDate: option.freezeDate, unfreezeDate: option.unfreezeDate };
      }
    }
    return null;
  }

  /**
   * The freezer dates of the bag's batch (6.1), read again from Decaid's bean
   * library, archived batches included: a batch frozen or thawed there after
   * the pick says so only there. While Decaid cannot be read, or no longer
   * lists the batch, as the bean card had them at the pick. Null for a bag
   * not linked to a batch.
   */
  async function freezerOf(s: Session): Promise<FreezerDates | null> {
    const batchId = s.bag.decaidBatchId ?? null;
    if (batchId === null) return null;
    try {
      const batch = (await api.listAllBatches({ includeArchived: true })).find((b) => b.id === batchId);
      if (batch) return { freezeDate: writtenDate(batch.freezeDate), unfreezeDate: writtenDate(batch.unfreezeDate) };
    } catch {
      // Decaid away, or a Decaid without the bean library: the card's row.
    }
    return pickedFreezer(batchId);
  }

  /** The roast as the coach reads it, the coffee's age counted to today (6.1); Decaid is read only when there is a roast date. */
  async function roastFor(s: Session): Promise<string | null> {
    const roastDate = s.bag.roastDate ?? null;
    if (roastDate === null) return null;
    const freezer = await freezerOf(s);
    return coach.roastLine(roastDate, clock.now(), freezer);
  }

  /**
   * The bag's first user turn (rule 1): the words, then the context block
   * with the grinder, the scale, the dose, the details already saved when
   * they came from Decaid's library or a confirmed photo, the roast, and
   * today's date (in the turn: the system prompt holds no dates).
   */
  async function startIntake(s: Session, words: string, bag: SaveBagDetails | null): Promise<void> {
    // A bag opened a moment ago: let its dose read finish.
    await s.numbers;
    const roast = await roastFor(s);
    const blocks = intakeBlocks(words, {
      grinder: grinderForModel(),
      scaleConnected: telemetry.getState().scaleConnected,
      doseG: coach.knownDose(s.doseG),
      bag,
      roast,
      today: todayOf(clock.now()),
    });
    await sendUser(s, new Map(), UNANSWERED_TEXT, blocks, 'typed');
  }

  /**
   * A batch picked on the bean card fills the bag (the bean's name, roaster,
   * country and region, process and notes; the batch's roast level and
   * date) and links it, both ids before anything else: a save_bag_details
   * after this finds the bag linked and adds no second batch (D102). Then
   * the coach's intake, told what was picked.
   */
  async function pickBean(batchId: string): Promise<void> {
    const s = session;
    const option = openBeanCard()?.options.find((o) => o.batchId === batchId);
    if (!s || !option) return;
    answerBeanCard({ kind: 'batch', batchId });
    if (s.bag.name === NEW_BAG_NAME) usage.track('bag_started');
    await persistBag(s, {
      name: withoutKey(option.name) || NEW_BAG_NAME,
      roaster: withoutKey(option.roaster),
      origin: withoutKey(option.origin),
      roastLevel: option.roastLevel,
      process: withoutKey(option.process),
      notes: withoutKey(option.notes),
      roastDate: option.roastDate,
      decaidBeanId: option.beanId,
      decaidBatchId: option.batchId,
    });
    emit();
    const bag = bagDetails(s.bag);
    await startIntake(s, pickedIntakeText(bag), bag);
  }

  /** "Something else": the card closes; the coach's question under it waits for the bag described in the chat. */
  async function skipBeanPick(): Promise<void> {
    const s = session;
    if (!s || !openBeanCard()) return;
    answerBeanCard({ kind: 'other' });
    await persistConversation(s);
    emit();
  }

  /**
   * A photo of the bag (6.8), read by the coach's model into details the
   * barista confirms. The photo goes into that one request and is dropped
   * with this call: never stored, mirrored, logged or kept in the transcript.
   * Unreadable, the bean card stays open and the chat says why.
   */
  async function readBagPhoto(photo: BagPhoto): Promise<void> {
    const s = session;
    if (!s || !openBeanCard()) return;
    const warn = async (text: string) => {
      addMessage('system', [noticePart('warning', text)]);
      await persistConversation(s);
      emit();
    };
    if (!llm.readBag) return warn(NO_PHOTO_READER);
    if (!(await storage.secrets.getApiKey())) return warn(NEEDS_KEY);
    state = { ...state, busy: true };
    const progressId = showProgress(null, READING_BAG, { value: null, label: null });
    emit();
    let read: ExtractedBag | null = null;
    let failure = '';
    try {
      read = await llm.readBag({ model: settings.model, photo });
    } catch (error) {
      failure = describe(error);
    }
    hideProgress(progressId);
    state = { ...state, busy: false };
    if (read) {
      answerBeanCard({ kind: 'photo' });
      addMessage('assistant', [
        bagConfirmPart({
          name: read.name ?? '',
          roaster: read.roaster,
          origin: read.origin,
          roastLevel: read.roastLevel,
          process: read.process,
          notes: read.notes,
          roastDate: read.roastDate,
        }),
      ]);
      await persistConversation(s);
      emit();
      return;
    }
    await warn(failure);
  }

  /** The photo's details as the barista confirmed them: saved like save_bag_details, then the coach's intake (6.8). */
  async function confirmBag(details: SaveBagDetails): Promise<void> {
    const s = session;
    if (!s || !state.messages.some((m) => m.parts.some(isOpenBagConfirm))) return;
    // The card asks for a name before it offers Confirm; anything else invalid is refused the same way.
    const parsed = TOOL_INPUTS[TOOL.saveBagDetails].safeParse(details);
    if (!parsed.success) return;
    const confirmed = parsed.data;
    setMessages(
      updatePart(state.messages, isOpenBagConfirm, (part) => (part.kind === 'bagConfirm' ? { ...part, details: confirmed, confirmed: true } : part)),
    );
    await saveBagDetails(s, confirmed);
    const bag = bagDetails(s.bag);
    await startIntake(s, photoIntakeText(bag), bag);
  }

  // -------------------------------------------------------------------------
  // The Visualizer link (6.4)
  // -------------------------------------------------------------------------

  /**
   * After a shot's card lands, while Decaid's Visualizer plugin runs: look
   * every 3 s, for 30 s of time however long each look takes, for the
   * plugin's upload of this shot. The link shows on the card at once and is
   * kept with the iteration and the chat in turn with the engine's actions,
   * so it never lands inside another action's writes. In the background; a
   * look Decaid does not answer is a look missed.
   */
  function watchVisualizer(s: Session, shotId: string, iterationId: string): void {
    if (!plugins.isLoaded(PLUGIN.visualizer)) return;
    void (async () => {
      const started = clock.now().getTime();
      let waited = 0;
      // A clock that stands still (a test's) still ends the watch: the waits add up to 30 s too.
      while (Math.max(clock.now().getTime() - started, waited) < VISUALIZER_WATCH_MS) {
        await clock.sleep(VISUALIZER_LOOK_MS);
        waited += VISUALIZER_LOOK_MS;
        if (disposed) return;
        let visualizerId: string | null;
        try {
          visualizerId = await visualizerIdFor(api, shotId);
        } catch {
          continue;
        }
        if (disposed) return;
        if (visualizerId === null) continue;
        const url = visualizerShotUrl(visualizerId);
        if (session?.bag.id === s.bag.id) {
          // Only a card changes, never the order of the chat: on screen now, kept in turn below.
          setMessages(setVisualizerLink(state.messages, shotId, url));
          emit();
        }
        await enqueue(() => storeVisualizerLink(s, shotId, iterationId, url));
        return;
      }
    })();
  }

  async function storeVisualizerLink(s: Session, shotId: string, iterationId: string, url: string): Promise<void> {
    if (disposed) return;
    const iteration = await storage.iterations.get(iterationId);
    if (iteration) await putIteration({ ...iteration, visualizerUrl: url });
    const current = session;
    if (current?.bag.id === s.bag.id) {
      // Again: an action since may have set the chat's messages from before the link.
      setMessages(setVisualizerLink(state.messages, shotId, url));
      await persistConversation(current);
      emit();
      return;
    }
    // Another bag is on screen by now: the link goes into this bag's stored chat.
    const stored = await storage.conversations.get(s.conversation.id);
    if (stored) await storage.conversations.put({ ...stored, uiMessages: setVisualizerLink(stored.uiMessages, shotId, url), updatedAt: nowIso() });
  }

  // -------------------------------------------------------------------------
  // Fun facts (D197-D203)
  // -------------------------------------------------------------------------

  /**
   * Where fun facts come from now (D198), read at each use: Settings' choice,
   * the coach and the list until someone chose; the web mode without its
   * search once Anthropic refused it this session (D203).
   */
  function funFactsSource(): FunFactsSource {
    const chosen = settings.funFacts ?? DEFAULT_FUN_FACTS;
    return chosen === 'web' && !webSearch ? 'coach' : chosen;
  }

  /** CafAI's own facts, read when one is due; none when they cannot be read, so only the coach's can show. */
  async function factList(): Promise<readonly FunFact[]> {
    try {
      return await facts();
    } catch {
      return [];
    }
  }

  /** A fact in an assistant message of its own (D202), on the told list (D200) under `key`. */
  function showFact(s: Session, part: CoachUiPart, key: string): void {
    usage.track('fun_fact_shown');
    addMessage('assistant', [part]);
    told.add({ key, bagId: s.bag.id, at: nowIso() });
    factShown = true;
    if (s.factDue) s.factDue.shown = true;
  }

  /**
   * The coach's fun fact (D201): told under its label, with its page's site
   * only in the web mode, where it may have read one (D203), and the call's
   * id, so a reload can say it was shown. One per run, and one per shot
   * (D197): with the reply to a shot due one, or when the barista typed what
   * the coach answers (they may have asked for one); any other is sent back,
   * so a fact sent back beside the taste question, CafAI's shown instead,
   * never brings a second under the barista's answer.
   */
  async function shareCoachFact(s: Session, input: ShareFunFact, callId: string | null): Promise<{ content: string; isError?: boolean }> {
    if (factShown) return { content: ONE_FACT_PER_REPLY, isError: true };
    const due = s.factDue !== null && !s.factDue.shown;
    if (!due && !s.typedTurn) return { content: FACT_NOT_DUE, isError: true };
    const site = funFactsSource() === 'web' ? siteOf(input.source) : null;
    showFact(s, factPart(input.fact, input.topic, site, callId ?? undefined), coachKey(input.about));
    await persistConversation(s);
    emit();
    return { content: JSON.stringify(FACT_SHOWN) };
  }

  /**
   * After the run that answers a shot due a fact (D201): CafAI's own when the
   * coach shared none, picked for the bag (D200), before the run's cards, so
   * it sits between the coach's words and its taste question.
   */
  async function showListFact(s: Session): Promise<void> {
    const due = s.factDue;
    s.factDue = null;
    if (!due || due.shown || funFactsSource() === 'off') return;
    const fact = pickFact(await factList(), s.bag, told.entries());
    if (fact) showFact(s, factPart(fact.text, fact.topic, siteOf(fact.source)), fact.id);
  }

  /**
   * Whether this shot is due a fun fact (D197): the bag's latest decided shot
   * was kept on the version this one ran, and this one ran like the latest
   * earlier shot on it. `iterations` are the bag's before this shot's own.
   */
  function factDueFor(iterations: readonly IterationRecord[], version: ProfileVersion, shotId: string, summary: ShotSummary): boolean {
    if (funFactsSource() === 'off') return false;
    const previous = previousLikeShot(iterations, version.id, shotId);
    return previous !== null && ranLikeLast(summary, previous);
  }

  // -------------------------------------------------------------------------
  // Shots and query tools
  // -------------------------------------------------------------------------

  async function bagIterations(s: Session): Promise<IterationRecord[]> {
    return storage.iterations.listByBag(s.bag.id);
  }

  /** Every shot CafAI credited to another bag, named by its bag: what a bag's first shot is compared with (D126). */
  async function shotsOfOtherBags(bagId: string): Promise<CreditedShot[]> {
    const names = new Map(state.bags.map((bag) => [bag.id, bag.name]));
    return (await storage.iterations.listAll()).flatMap((iteration) => {
      if (iteration.bagId === bagId || !iteration.shotId) return [];
      const name = names.get(iteration.bagId) ?? iteration.bagName;
      return [{ shotId: iteration.shotId, coffee: name && name !== NEW_BAG_NAME ? name : null, at: iteration.createdAt }];
    });
  }

  /**
   * Every batch of a linked bag's bean in Decaid's library, archived ones
   * too: DYE2's setups for an earlier batch of the same coffee (6.5). None
   * for a bag without a bean, or when Decaid cannot say.
   */
  async function beanBatchIds(bag: Bag): Promise<string[]> {
    const beanId = bag.decaidBeanId;
    if (!beanId) return [];
    try {
      return (await api.listAllBatches({ includeArchived: true })).filter((batch) => batch.beanId === beanId).map((batch) => batch.id);
    } catch {
      return [];
    }
  }

  const shotSource: ShotSource = {
    async resolve(ref) {
      const s = session;
      if (!s) return null;
      const withShots = (await bagIterations(s)).filter((i) => i.shotId);
      let iteration: IterationRecord | undefined;
      if (ref === 'latest') iteration = withShots[withShots.length - 1];
      else if (ref === 'previous') iteration = withShots[withShots.length - 2];
      else iteration = withShots.find((i) => i.shotId === ref);
      if (!iteration?.shotId) return null;
      let record = shotCache.get(iteration.shotId);
      if (!record) {
        record = await api.getShot(iteration.shotId);
        shotCache.set(record.id, record);
      }
      // Summaries restored from Decaid's KV backup carry an empty series.
      const stored = iteration.summary;
      if (stored && stored.series.tS.length > 0) return { record, summary: stored };
      // Rebuilt from the record, with the reading CafAI keeps (D166): Decaid's copy may still wait in the outbox.
      const rebuilt = coach.summarizeShot(record);
      return { record, summary: stored ? withTds(rebuilt, readingOf(stored)?.tdsPct ?? null) : rebuilt };
    },
  };

  /** `callId`: the call's tool_use id, which a fun fact keeps (D201); null when unknown. */
  async function executeAuto(name: ToolName, value: unknown, callId: string | null): Promise<{ content: string; isError?: boolean }> {
    const s = session;
    if (!s) return { content: JSON.stringify({ error: 'No bag is active.' }), isError: true };
    switch (name) {
      case TOOL.saveBagDetails: {
        // The bag name travels to Decaid (coffee name, profile titles): never a key.
        await saveBagDetails(s, value as SaveBagDetails);
        return { content: JSON.stringify({ saved: true }) };
      }
      case TOOL.getRecentSetups: {
        // Read-only: CafAI never writes DYE2's data (6.5).
        let dye2: Dye2Data | null;
        try {
          dye2 = await readDye2(api, plugins.isLoaded(PLUGIN.dye2));
        } catch {
          return { content: DYE2_UNREACHABLE, isError: true };
        }
        return coach.runQuery(name, value, {
          source: shotSource,
          versions: s.versions,
          iterations: await bagIterations(s),
          dye2,
          bag: { ...s.bag, beanBatchIds: dye2 ? await beanBatchIds(s.bag) : [] },
        });
      }
      case TOOL.getShotSummary:
      case TOOL.getShotSeries:
      case TOOL.getPhaseStats:
      case TOOL.compareShots:
      case TOOL.getBagHistory:
        return coach.runQuery(name, value, {
          source: shotSource,
          versions: s.versions,
          iterations: await bagIterations(s),
        });
      case TOOL.shareFunFact:
        return shareCoachFact(s, value as ShareFunFact, callId);
      default:
        return { content: JSON.stringify({ error: `${name} is not an automatic tool.` }), isError: true };
    }
  }

  function proposalContext(s: Session) {
    const current = activeVersion(s);
    if (!current) return null;
    const template = coach.getTemplate(current.templateId);
    if (!template) return null;
    return {
      template,
      profile: current.profile,
      doseG: s.doseG,
      scaleConnected: telemetry.getState().scaleConnected,
      grinderSetting: settings.grinderSetting,
      grinder: grinderInfo(),
    };
  }

  /**
   * Domain checks after the zod schema passed. Returns an error sentence or
   * null. `fresh`: the model just wrote the call, so a proposal's wording is
   * checked too (D127).
   */
  function domainError(name: ToolName, value: unknown, fresh: boolean): string | null {
    if (name === TOOL.proposeTemplates) {
      const ids = (value as ProposeTemplates).suggestions.map((s) => s.templateId);
      const unknown = ids.filter((id) => !coach.getTemplate(id));
      const idError =
        unknown.length > 0
          ? `Unknown template id ${unknown.join(', ')}. Use only: ${coach.templates.map((t) => t.id).join(', ')}.`
          : new Set(ids).size !== ids.length
            ? 'Suggest each template at most once.'
            : null;
      // Both at once, so one retry fixes the ids and the reasons (D127).
      const wording = fresh ? coach.proposalWordingError(value as ProposeTemplates) : null;
      const errors = [idError, wording].filter((e): e is string => e !== null);
      return errors.length > 0 ? errors.join(' ') : null;
    }
    if (name === TOOL.proposeAdjustment) {
      const s = session;
      const context = s ? proposalContext(s) : null;
      if (!context) return 'No profile version is active yet. Propose templates first.';
      const result = coach.validateProposal(value as ProposeAdjustment, context);
      // Both at once, so one retry fixes the numbers and the words.
      const wording = fresh ? coach.proposalWordingError(value as ProposeAdjustment) : null;
      const errors = [...(result.ok ? [] : result.errors), ...(wording ? [wording] : [])];
      return errors.length > 0 ? errors.join(' ') : null;
    }
    // A fact never says how the barista's cup tastes (D199); one stored, as the coach wrote it then, is not shown again anyway.
    if (name === TOOL.shareFunFact) return fresh ? factWordingError((value as ShareFunFact).fact) : null;
    return null;
  }

  const tools: EngineTool[] = (Object.values(TOOL) as ToolName[]).map((name) => {
    const schema = TOOL_INPUTS[name];
    const zodValidate = llm.validator(schema);
    const auto = AUTO_TOOLS.includes(name);
    const check = (input: unknown, fresh: boolean): ToolValidation => {
      const parsed = zodValidate(name === TOOL.saveBagDetails ? withRoastDate(input) : input);
      if (!parsed.ok) return parsed;
      const error = domainError(name, parsed.value, fresh);
      return error ? { ok: false, error } : parsed;
    };
    const tool: EngineTool = {
      definition: llm.toolDefinition(name, coach.toolDescription(name), schema),
      kind: auto ? 'auto' : 'ui',
      validate: (input) => check(input, true),
      validateStored: (input) => check(input, false),
    };
    if (auto) tool.execute = (value, call) => executeAuto(name, value, call.id);
    return tool;
  });
  // Every tool, so a call stored in any mode is still answered after a reload.
  const toolsByName = new Map(tools.map((t) => [t.definition.name, t]));
  const toolsWithoutFacts = tools.filter((t) => t.definition.name !== TOOL.shareFunFact);

  /** The tools a run offers (D198): share_fun_fact in the coach's modes only. */
  function toolsFor(source: FunFactsSource): EngineTool[] {
    return coachShares(source) ? tools : toolsWithoutFacts;
  }

  // -------------------------------------------------------------------------
  // Model runs
  // -------------------------------------------------------------------------

  /** Show a UI tool call the model is waiting on, and remember it. */
  async function presentUiCall(s: Session, call: PendingUiCall): Promise<void> {
    const name = call.name as ToolName;
    if (name === TOOL.proposeTemplates) {
      const input = call.input as ProposeTemplates;
      const items: TemplateCardItem[] = input.suggestions.flatMap((suggestion) => {
        const template = coach.getTemplate(suggestion.templateId);
        return template
          ? [
              {
                templateId: template.id,
                name: template.name,
                style: template.style,
                shape: template.shape,
                confidence: suggestion.confidence,
                reason: suggestion.reason,
              },
            ]
          : [];
      });
      addMessage('assistant', [templatesPart(call.id, items)]);
      s.pending.push({ id: call.id, name, input: call.input });
    } else if (name === TOOL.askUser) {
      const input = call.input as AskUser;
      addMessage('assistant', [
        optionsPart(call.id, input.question, coach.withOther(input.options), input.multiSelect, isTasteQuestion(input.question)),
      ]);
      s.pending.push({ id: call.id, name, input: call.input });
    } else if (name === TOOL.proposeAdjustment) {
      const input = call.input as ProposeAdjustment;
      const context = proposalContext(s);
      const validation = context ? coach.validateProposal(input, context) : null;
      if (!validation?.ok) return;
      const plan = validation.plan;
      const next = Math.max(0, ...s.versions.map((v) => v.version)) + 1;
      const tips = input.tips.length > 0 ? ` Tip: ${input.tips.join(' ')}` : '';
      const notes = plan.notes && plan.notes.length > 0 ? ` (${plan.notes.join(' ')})` : '';
      addMessage('assistant', [
        diffPart({
          requestId: call.id,
          summary: plan.summary || input.summary,
          lines: plan.diffLines.filter((line) => line !== (plan.summary || input.summary)),
          manualSteps: plan.manualSteps,
          rationale: `${input.rationale}${tips}${notes}`,
          expectedEffect: input.expectedEffect,
          versionLabel: plan.createsVersion ? coach.versionTitle(s.bag.name, next) : null,
          // Keeping the recipe is no change by hand: the card says so.
          keep: plan.variable === 'none',
        }),
      ]);
      s.pending.push({ id: call.id, name, input, plan });
      const iteration = await latestPendingIteration(s);
      if (iteration) await putIteration({ ...iteration, proposal: input });
    } else if (name === TOOL.offerGrinder) {
      // A card the barista answers: nothing reaches Decaid's grinder library before Add (D125).
      addMessage('assistant', [grinderOfferPart(call.id, call.input as OfferGrinder)]);
      s.pending.push({ id: call.id, name, input: call.input });
    }
  }

  /**
   * The grinder card comes alone (D125): offered beside another card, the
   * offer is answered with an error asking for it again once that card is
   * answered, and only the other card shows; a second offer in one reply too.
   */
  function crowdedGrinderOffers(calls: readonly { id: string; name: string }[]): ToolResultBlock[] {
    const offers = calls.filter((call) => call.name === TOOL.offerGrinder);
    const alone = offers.length === calls.length;
    return (alone ? offers.slice(1) : offers).map((call) =>
      toolResult(
        call.id,
        alone
          ? 'Offer one grinder at a time.'
          : 'Not shown: offer_grinder comes with no other card in the reply. Once the user has answered the other card, call offer_grinder again, on its own.',
        true,
      ),
    );
  }

  async function runModel(): Promise<void> {
    const s = session;
    if (!s) return;
    if (!(await storage.secrets.getApiKey())) {
      state = { ...state, hasApiKey: false };
      setError('Add your Anthropic API key in Settings to start coaching.', runModel);
      emit();
      return;
    }
    state = { ...state, busy: true, error: null };
    lastFailed = null;
    emit();
    let streamingId: string | null = null;
    factShown = false;
    // The prompt, the tools and the web search follow the fun facts mode of the moment (D198, D203).
    const run = (source: FunFactsSource) =>
      llm.run({
        provider: llm.provider,
        model: settings.model,
        system: coach.systemPrompt(source),
        effort,
        ...(deps.maxTokens ? { maxTokens: deps.maxTokens } : {}),
        messages: s.conversation.apiMessages,
        tools: toolsFor(source),
        // A stored search still waiting resumes with its tool whatever the mode, or the API refuses it (D203).
        ...(source === 'web' || resumesSearch(s.conversation.apiMessages) ? { serverTools: [WEB_SEARCH_TOOL] } : {}),
        onTurnStart: () => {
          streamingId = null;
        },
        onTextDelta: (delta) => {
          if (!streamingId) {
            streamingId = deps.newId('msg');
            setMessages([...state.messages, message(streamingId, 'assistant', [], nowIso())]);
          }
          setMessages(appendText(state.messages, streamingId, delta));
          scheduleEmit();
        },
        onAppend: async (appended) => {
          s.conversation = { ...s.conversation, apiMessages: [...s.conversation.apiMessages, appended] };
          // The sites the coach's words cite, under them (D203): Anthropic asks that search results shown to people say where they came from.
          const sites = appended.role === 'assistant' ? citedSites(appended.content) : [];
          if (sites.length > 0 && streamingId) setMessages(withPart(state.messages, streamingId, sourcesPart(sites)));
          await persistConversation(s);
        },
      });
    try {
      const source = funFactsSource();
      let result: RunResult;
      try {
        result = await run(source);
      } catch (error) {
        if (source !== 'web' || !webSearchUnavailable(error)) throw error;
        // Web search turned off for the organisation, or of no use to it: the same request without it, at once,
        // and none for the rest of the session, said once (D203).
        webSearch = false;
        setMessages(finishStreaming(state.messages));
        addMessage('system', [noticePart('info', NO_WEB_SEARCH)]);
        result = await run(funFactsSource());
      }
      setMessages(finishStreaming(state.messages));
      // CafAI's own fact when the coach shared none for a shot due one, before the taste question (D201).
      await showListFact(s);
      s.pending = [];
      const crowded = crowdedGrinderOffers(result.pendingUiCalls);
      s.held = [...result.heldResults, ...crowded];
      const unshown = new Set(crowded.map((held) => held.tool_use_id));
      for (const call of result.pendingUiCalls) if (!unshown.has(call.id)) await presentUiCall(s, call);
    } catch (error) {
      setMessages(finishStreaming(state.messages));
      setError(describe(error), runModel);
      usage.track('coach_error');
    } finally {
      state = { ...state, busy: false };
      await persistConversation(s);
      emit();
    }
  }

  /**
   * Answer every tool call the model is waiting on (in tool_use order), then
   * add the verdicts (D126) and TDS readings (D167) the coach has not heard and `extra` blocks,
   * append the user turn, and run the model. Cards left unanswered are set
   * aside, and say why: `setAsideFor`.
   */
  async function sendUser(
    s: Session,
    answers: Map<string, ToolResultBlock>,
    fallback: unknown,
    extra: ContentBlock[],
    setAsideFor: SetAsideReason,
  ): Promise<void> {
    // A stored search still waiting, its calls answered (a reload between appends), runs before anything else
    // is said (D203): a message after those results would join them, and the API would refuse every request.
    if (resumesSearch(s.conversation.apiMessages)) {
      await runModel();
      if (resumesSearch(s.conversation.apiMessages)) return;
    }
    const order = unansweredToolUses(s.conversation.apiMessages).map((u) => u.id);
    const byId = new Map<string, ToolResultBlock>();
    for (const held of s.held) byId.set(held.tool_use_id, held);
    for (const [id, result] of answers) byId.set(id, result);
    const results = order.map((id) => byId.get(id) ?? toolResult(id, fallback));
    const implicit = s.pending.filter((p) => !answers.has(p.id)).map((p) => p.id);
    if (implicit.length > 0) {
      let messages = state.messages;
      for (const id of implicit) {
        messages = updatePart(messages, byRequestId(id), (part) => setAside(part, setAsideFor));
      }
      setMessages(messages);
    }
    s.pending = [];
    s.held = [];
    if (results.length === 0 && extra.length === 0) return;
    // A verdict comes after the shot's own event left, so it rides with the next turn; so does a TDS reading (D167).
    // Untold means untold by this turn too: a shot's own event in `extra` tells the reading its record came with
    // (ENGINE_PROTOCOL rule 10), so the turn never carries that reading twice.
    const heard: LlmMessage[] = [...s.conversation.apiMessages, { role: 'user', content: extra }];
    const rated = untoldRatings(heard, state.messages).map(shotRatedBlock);
    const measured = untoldReadings(heard, state.messages).map(shotMeasuredBlock);
    const blocks: ContentBlock[] = [...results, ...rated, ...measured, ...extra];
    s.conversation = {
      ...s.conversation,
      apiMessages: [...s.conversation.apiMessages, { role: 'user', content: blocks }],
    };
    // What the barista typed may ask for a fun fact; a tap or a shot does not (D201).
    s.typedTurn = setAsideFor === 'typed';
    await persistConversation(s);
    await runModel();
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Rebuild pending calls from a stored transcript (after a reload). A turn
   * whose web search still waits beside its calls (a reload between appends,
   * D203) shows no card: each is answered as the runner answers it, and the
   * answers go in a message of their own, for Retry to resume the search.
   */
  async function recoverPending(s: Session): Promise<void> {
    s.pending = [];
    s.held = [];
    const last = s.conversation.apiMessages[s.conversation.apiMessages.length - 1];
    const searchWaits = last?.role === 'assistant' && waitsOnServerTool(last.content);
    for (const use of unansweredToolUses(s.conversation.apiMessages)) {
      const tool = toolsByName.get(use.name);
      if (!tool) {
        s.held.push(toolResult(use.id, `Unknown tool ${use.name}.`, true));
        continue;
      }
      const validation = tool.validateStored(use.input);
      if (!validation.ok) {
        s.held.push(toolResult(use.id, validation.error, true));
      } else if (use.name === TOOL.shareFunFact) {
        // Never shown twice: the chat says whether this call's fact is in it (D201).
        const inChat = state.messages.some((m) => m.parts.some((part) => part.kind === 'fact' && part.requestId === use.id));
        s.held.push(toolResult(use.id, inChat ? FACT_SHOWN : FACT_NOT_SHOWN_AGAIN));
      } else if (tool.kind === 'auto' && tool.execute) {
        const outcome = await tool.execute(validation.value, { id: use.id });
        s.held.push(toolResult(use.id, outcome.content, outcome.isError ?? false));
      } else if (searchWaits) {
        s.held.push(toolResult(use.id, SEARCH_FIRST_MESSAGE, true));
        // A card it may have shown before the reload no longer answers anything.
        setMessages(updatePart(state.messages, byRequestId(use.id), (part) => setAside(part, 'other')));
      } else if (use.name === TOOL.proposeAdjustment) {
        const context = proposalContext(s);
        const plan = context ? coach.validateProposal(validation.value as ProposeAdjustment, context) : null;
        if (plan?.ok) s.pending.push({ id: use.id, name: use.name, input: validation.value, plan: plan.plan, recovered: true });
        else s.held.push(toolResult(use.id, 'This proposal no longer applies to the active version.', true));
      } else {
        s.pending.push({ id: use.id, name: use.name as ToolName, input: validation.value });
      }
    }
    // As when the reply came: a grinder offer beside another card was never shown.
    const crowded = crowdedGrinderOffers(s.pending);
    const unshown = new Set(crowded.map((held) => held.tool_use_id));
    s.pending = s.pending.filter((p) => !unshown.has(p.id));
    s.held.push(...crowded);
    if (searchWaits && s.held.length > 0) {
      // Tool results alone, in tool_use order: the API runs the waiting search once they are in (D203).
      s.conversation = { ...s.conversation, apiMessages: [...s.conversation.apiMessages, { role: 'user', content: s.held }] };
      s.held = [];
      await persistConversation(s);
    }
  }

  async function openSession(bag: Bag): Promise<void> {
    const conversation = (await storage.conversations.get(bag.conversationId)) ?? {
      id: bag.conversationId,
      bagId: bag.id,
      apiMessages: [],
      uiMessages: [],
      createdAt: bag.createdAt,
      updatedAt: bag.updatedAt,
    };
    const s: Session = {
      bag,
      conversation,
      versions: await storage.versions.listByBag(bag.id),
      pending: [],
      held: [],
      doseG: null,
      targetYieldG: null,
      numbers: Promise.resolve(),
      factDue: null,
      typedTurn: false,
    };
    session = s;
    // A stored progress notice (an older build, a crash) describes work that is long over.
    state = { ...state, messages: withoutTransient(conversation.uiMessages), error: null };
    // Cards from before CafAI compared shots say what they compare with too (D126).
    if (state.messages.some((m) => m.parts.some(needsBaseline))) {
      setMessages(fillBaselines(state.messages, await shotsOfOtherBags(bag.id)));
    }
    lastFailed = null;
    await recoverPending(s);
    if (awaitingModel(s.conversation.apiMessages)) {
      setError("The coach's last reply did not finish. Tap Retry to ask again.", runModel);
    }
    settings = await storage.settings.update({ activeBagId: bag.id });
    emit();
    // In the background; the intake turn waits for it (it tells the coach the dose).
    s.numbers = loadWorkflowNumbers(s);
    // A bean card still without its rows: just made, or a reload came before they were read.
    if (state.messages.some((m) => m.parts.some(isLoadingBeanCard))) fillBeanCard(bag.id);
  }

  /**
   * A new bag and its chat: "Which coffee is it?" first (6.1), then the
   * coach's question, which takes the bag described in words. The card is up
   * at once and reads Decaid's batches in the background. A bag started by
   * typing (no card to answer) skips the card.
   */
  async function createBag(withBeanCard: boolean): Promise<Session> {
    const at = nowIso();
    const bag: Bag = {
      id: deps.newId('bag'),
      name: NEW_BAG_NAME,
      roaster: null,
      origin: null,
      roastLevel: null,
      process: null,
      notes: null,
      templateId: null,
      activeVersionId: null,
      conversationId: deps.newId('conv'),
      archived: false,
      createdAt: at,
      updatedAt: at,
    };
    const card = withBeanCard ? [message(deps.newId('msg'), 'assistant', [loadingBeanPickerPart()], at)] : [];
    const conversation: ConversationRecord = {
      id: bag.conversationId,
      bagId: bag.id,
      apiMessages: [],
      uiMessages: [...card, message(deps.newId('msg'), 'assistant', [{ kind: 'text', text: NEW_BAG_PROMPT }], at)],
      createdAt: at,
      updatedAt: at,
    };
    await storage.bags.put(bag);
    await storage.conversations.put(conversation);
    state = { ...state, bags: upsert(state.bags, bag) };
    await openSession(bag);
    return session!;
  }

  // -------------------------------------------------------------------------
  // Versions and iterations
  // -------------------------------------------------------------------------

  async function putIteration(record: IterationRecord): Promise<void> {
    await storage.iterations.put({ ...record, updatedAt: nowIso() });
  }

  async function latestPendingIteration(s: Session): Promise<IterationRecord | undefined> {
    const iterations = await bagIterations(s);
    return [...iterations].reverse().find((i) => i.outcome === 'pending');
  }

  async function saveVersions(s: Session, changed: ProfileVersion[]): Promise<void> {
    for (const version of changed) {
      await storage.versions.put(version);
      const index = s.versions.findIndex((v) => v.id === version.id);
      if (index < 0) s.versions.push(version);
      else s.versions[index] = version;
    }
  }

  /** Decaid says uploading the profile to the machine failed (ws/v1/devices). */
  async function onUploadFailed(message: string): Promise<void> {
    const s = session;
    const version = activeVersion(s);
    if (!s || !version) return;
    uploadFailedFor = version.id;
    setLoadProblem(version.id, `The machine did not take ${version.title}. Tap Retry to load it again.`);
    addMessage('system', [noticePart('warning', `The machine did not take ${version.title}: ${message}`)]);
    await persistConversation(s);
    emit();
  }

  /**
   * The shot being pulled belongs to the bag on screen: switching bags (or
   * starting one) mid-shot would check it against the wrong version and
   * lose it. The UI disables both; this is the engine's own guard.
   */
  function refuseDuringShot(): boolean {
    if (!isShotRunning()) return false;
    setError('Finish the shot first, then switch bags.');
    emit();
    return true;
  }

  function setMachineLoad(versionId: string, status: LoadStatus): void {
    machineLoad = { versionId, status, at: clock.now().getTime() };
  }

  /**
   * Put a version's profile in Decaid's workflow (one PUT with the context);
   * returns the workflow as Decaid answered. The machine gets it a moment
   * later: confirmOnMachine waits for that.
   */
  async function activate(
    s: Session,
    versionId: string,
    profile: ProfileJson,
    patch?: ChangePlan['contextPatch'],
  ): Promise<Workflow> {
    if (isShotRunning()) throw new Error('Wait for the shot to finish, then try again.');
    const context = workflowContext(s, versionId, profile, patch);
    const workflow = await api.activateProfile(profile, context, { shotRunning: false });
    // This context carried the grinder as last saved: a grinder write that waits is done.
    outbox.drop(GRINDER_WRITE);
    // The workflow carries a bag's version again: a profile seen there before is news if it comes back.
    mismatchSeen = null;
    setMachineLoad(versionId, 'loading');
    if (context.targetYield !== undefined) s.targetYieldG = context.targetYield;
    if (context.targetDoseWeight !== undefined) s.doseG = context.targetDoseWeight;
    return workflow;
  }

  /**
   * Wait until the machine holds the version Decaid just put in its workflow
   * (D55). The barrier posts the profile exactly as Decaid returned it, so it
   * only waits for Decaid's own upload and never changes what the machine
   * gets (D42). Shows a transient notice and keeps busy true meanwhile.
   */
  async function confirmOnMachine(versionId: string, title: string, profile: WireProfile): Promise<LoadOutcome> {
    let outcome: LoadOutcome;
    if (!barrierSupported) {
      outcome = { status: 'assumed' };
    } else if (!telemetry.getState().machineConnected) {
      // Decaid uploads it when the machine connects; onMachineConnected waits for that.
      outcome = { status: 'waiting' };
    } else {
      setMachineLoad(versionId, 'loading');
      state = { ...state, busy: true };
      const progressId = showProgress(null, `Loading ${title} on the machine…`, { value: null, label: null });
      emit();
      barrierInFlight = true;
      try {
        const answer = await api.loadProfileOnMachine(profile);
        if (answer === 'unsupported') {
          // Not asked again this session, so this is said once (5.12).
          barrierSupported = false;
          addMessage('system', [noticePart('info', NO_BARRIER)]);
        }
        outcome = { status: answer === 'loaded' ? 'loaded' : answer === 'offline' ? 'waiting' : 'assumed' };
      } catch (error) {
        outcome = { status: 'failed', reason: describe(error) };
      } finally {
        barrierInFlight = false;
      }
      hideProgress(progressId);
    }
    setMachineLoad(versionId, outcome.status);
    if (outcome.status === 'loaded' || outcome.status === 'assumed') {
      uploadFailedFor = null;
      // Every load ends here: v1, a confirmed version, an undo, a bag switch, Retry, one that waited for the machine.
      usage.track('profile_loaded');
    }
    return outcome;
  }

  /** Say how a load went, and set (or clear) the standing load problem. */
  function reportLoad(versionId: string, title: string, outcome: LoadOutcome): void {
    if (outcome.status === 'failed') {
      setLoadProblem(versionId, `The machine has not confirmed ${title}. Tap Retry to load it again.`);
      addMessage('system', [noticePart('warning', `${title} is saved, but the machine has not confirmed it. ${outcome.reason}`)]);
      return;
    }
    clearStanding('load');
    if (outcome.status === 'loaded') addMessage('system', [noticePart('success', `Loaded ${title} on the machine.`)]);
    else if (outcome.status === 'waiting') {
      addMessage('system', [noticePart('info', `Saved ${title}. Decaid loads it when the machine connects.`)]);
    } else addMessage('system', [loadedNotice(title)]);
  }

  /**
   * `onMachine` for the model: true for what the barrier confirmed (or,
   * without one, a connected machine); false only while no machine is
   * connected, which the coach reads as "Decaid loads it on connect"; null
   * when a connected machine has not confirmed it (loadError says why).
   */
  function onMachine(outcome: LoadOutcome): boolean | null {
    if (outcome.status === 'failed') return null;
    return outcome.status === 'loaded' || (outcome.status === 'assumed' && telemetry.getState().machineConnected);
  }

  function loadError(outcome: LoadOutcome): string | null {
    return outcome.status === 'failed' ? outcome.reason : null;
  }

  /**
   * The machine connected, and Decaid uploads the workflow's profile now. If
   * the active version was waiting for that (or its load failed), wait for
   * the upload and say when the machine holds it. Only when the workflow
   * still carries the version: posting it otherwise would change what the
   * machine gets (D42).
   */
  async function onMachineConnected(): Promise<void> {
    const s = session;
    const version = activeVersion(s);
    if (!s || !version || !barrierSupported) return;
    const load = machineLoad?.versionId === version.id ? machineLoad.status : null;
    if (load !== 'waiting' && load !== 'failed' && uploadFailedFor !== version.id) return;
    let workflow: Workflow;
    try {
      workflow = await api.getWorkflow();
    } catch {
      return; // Decaid unreachable: the next connect looks again.
    }
    if (!workflow.profile || !carriesVersion(workflow, version)) {
      if (workflow.profile) raiseMismatch(version, workflow.profile);
      emit();
      return;
    }
    const outcome = await confirmOnMachine(version.id, version.title, workflow.profile);
    if (outcome.status === 'loaded' || outcome.status === 'assumed') {
      clearStanding('load');
      addMessage('system', [noticePart('success', `Loaded ${version.title} on the machine.`)]);
    } else if (outcome.status === 'failed' && load === 'waiting') {
      reportLoad(version.id, version.title, outcome);
    }
    // Waiting again: the machine dropped before Decaid answered; the next connect tries again.
    state = { ...state, busy: false };
    await persistConversation(s);
    emit();
  }

  /** The active version's load state at a shot's start, when it had not reached the machine. */
  function earlyLoad(): ShotStart['early'] {
    const version = activeVersion(session);
    const load = machineLoad;
    if (!version || load?.versionId !== version.id) return null;
    if (load.status !== 'loading' && load.status !== 'waiting' && load.status !== 'failed') return null;
    return { versionId: version.id, status: load.status, at: clock.now().getTime() };
  }

  function takeShotStart(shotId: string | null): ShotStart | null {
    const start = shotStart;
    shotStart = null;
    // Without shotState frames the id may only be known at the end.
    if (!start || (start.shotId !== null && shotId !== null && start.shotId !== shotId)) return null;
    return start;
  }

  /**
   * A shotState frame: keep what its decision says of the run it names.
   * Decaid aborts a run stopped before the pour began and cleans it up
   * without saving it (shot_sequencer.dart:399-408, de1_state_manager.dart:
   * 854-864 at aab5f93), and tears a run down with a terminal decision when
   * the machine disconnects mid-shot (de1_state_manager.dart:965-985).
   */
  function noteDecision(frame: ShotStateEvent | null): void {
    const decision = frame?.decision ?? null;
    if (!frame?.shotId || !decision || (decision.kind !== 'abort' && decision.kind !== 'terminal')) return;
    const decided =
      runDecisions !== null && runDecisions.shotId === frame.shotId ? runDecisions : { shotId: frame.shotId, aborted: false, disconnected: false };
    if (decision.kind === 'abort') decided.aborted = true;
    else if (decision.reason === 'disconnected') decided.disconnected = true;
    runDecisions = decided;
  }

  /** The run that just ended, with what Decaid decided of it; `saved` is asked now (D193). */
  function endedRun(
    shotId: string | null,
    stopReason: string | null,
    started: ShotStart | null,
    saved: Promise<boolean | null>,
  ): ShotRun {
    const decided = shotId !== null && runDecisions?.shotId === shotId ? runDecisions : null;
    return {
      shotId,
      started,
      saved,
      aborted: decided?.aborted ?? false,
      disconnected: decided?.disconnected ?? false,
      stopReason,
      cutOff: null,
    };
  }

  /** True when a shot started before the machine had the version (D55). */
  function startedBeforeLoad(start: ShotStart | null, version: ProfileVersion): boolean {
    const early = start?.early;
    if (!early || early.versionId !== version.id) return false;
    const load = machineLoad?.versionId === version.id ? machineLoad : null;
    // An older Decaid has no barrier to wait for: the workflow is trusted, as before.
    if (load?.status === 'assumed') return false;
    if (early.status === 'failed') return true;
    // Decaid answers 500 ms after the machine acknowledged the last write: a
    // start seen within that guard came after the upload (CafAI's own
    // espresso start even waits for it in Decaid's write queue).
    return !(load?.status === 'loaded' && load.at - early.at <= UPLOAD_GUARD_MS);
  }

  // -------------------------------------------------------------------------
  // Shot finished
  // -------------------------------------------------------------------------

  /**
   * Whether Decaid keeps a record of the run that just ended (D193): false
   * for a run of a cleaning or calibration profile, which is no shot. Read
   * from Decaid's workflow as the run ends, the profile Decaid decides by then,
   * so a profile loaded behind CafAI's back (D70) counts too. Null when Decaid
   * did not answer: the run is then looked for as a shot, as before, so no
   * shot is lost to a read that failed.
   */
  async function runSaved(): Promise<boolean | null> {
    try {
      return savedAsShot((await api.getWorkflow()).profile);
    } catch {
      return null;
    }
  }

  /**
   * Decaid saves the record a moment after the shot ends. Ask again with a
   * doubling delay (0.5 s to 8 s by default, about 15 s in all), so a shot that
   * is never saved costs a handful of requests rather than a steady stream.
   * After the first miss the chat shows the search, updated on each try (D65).
   */
  async function fetchShot(shotId: string | null): Promise<ShotRecord | null> {
    let delayMs = shotFetch.delayMs;
    let progressId: string | null = null;
    try {
      for (let attempt = 0; attempt < shotFetch.attempts; attempt++) {
        try {
          if (shotId) return await api.getShot(shotId);
          const latest = await api.getLatestShot();
          if (latest) return await api.getShot(latest.id);
        } catch {
          // Not saved yet; ask again.
        }
        if (attempt < shotFetch.attempts - 1) {
          progressId = showProgress(progressId, SEARCH_NOTICE, {
            value: (attempt + 1) / shotFetch.attempts,
            label: `Try ${attempt + 2} of ${shotFetch.attempts}`,
          });
          emit();
          await clock.sleep(delayMs);
          delayMs *= 2;
        }
      }
      return null;
    } finally {
      if (progressId) hideProgress(progressId);
    }
  }

  /** The one quiet line for a run that never poured (D204). */
  async function sayNeverPoured(s: Session): Promise<void> {
    addMessage('system', [noticePart('info', NEVER_POURED)]);
    await persistConversation(s);
    emit();
  }

  /**
   * A run ended: credit its shot to the active version, or say why not. Its
   * Retry hands the same run back, so it looks for the same shot whatever the
   * workflow holds by then, and says what its first notice said.
   */
  async function handleShotFinished(run: ShotRun): Promise<void> {
    const s = session;
    if (!s) return;
    // A cleaning or calibration profile's run (the weekly clean's Forward Flush x5, say) is no shot: Decaid keeps no
    // record of it, so there is nothing to look for and nothing to say, and a problem on the banner stays (D193).
    if ((await run.saved) === false) return;
    // Stopped before the pour began: Decaid aborted the run and keeps no record of it, so there is nothing to look
    // for, and a problem on the banner stays (D204).
    if (run.aborted) return sayNeverPoured(s);
    const current = activeVersion(s);
    if (!current) {
      addMessage('system', [noticePart('info', 'Pick a starting profile first; that shot is not part of this dial-in.')]);
      await persistConversation(s);
      emit();
      return;
    }
    // Decaid just reported a shot: writes that wait go out now (D64).
    void outbox.flush();
    // A new shot (or Retry) replaces the hunt for the previous one; a run that turns out to hold no pour gives it back.
    const hunt = standing?.kind === 'shot' ? standing : null;
    clearStanding('shot');
    if (state.error === SHOT_NOT_SAVED) setError(null);
    state = { ...state, busy: true };
    emit();
    try {
      await creditShot(s, current, run, hunt);
    } finally {
      state = { ...state, busy: false };
      emit();
    }
  }

  async function creditShot(s: Session, current: ProfileVersion, run: ShotRun, hunt: Standing | null): Promise<void> {
    const record = await fetchShot(run.shotId);
    if (!record) {
      // Typically the machine dropped mid-shot, or Decaid is slow to save the
      // record, so Retry looks for it again. How the shot ended is settled
      // once, and every notice of it after says the same, whether the machine
      // is back by then or not (D205): cut off when Decaid tore the run down
      // as the machine dropped (Decaid 0.8.8 then saves nothing); finished
      // when Decaid stopped it, whatever the machine did after; else cut off
      // when the machine is away after the search (that frame can be missed),
      // but only while Decaid answers: out of reach, its last word on the
      // machine is no news (D206), so this notice says only that Decaid could
      // not be reached, and the next one settles it.
      const { unreachable, machineConnected } = telemetry.getState();
      run.cutOff ??= run.disconnected ? true : run.stopReason !== null ? false : unreachable ? null : !machineConnected;
      // A cut-off shot is known to be lost (Decaid keeps no record of a torn-down run); a finished one only once Decaid answered.
      const words = run.cutOff === true ? CUT_OFF_NOTICE : unreachable ? UNREACHABLE_NOTICE : NOT_SAVED_NOTICE;
      addMessage('system', [noticePart('warning', words)]);
      replaceStanding({ kind: 'shot', message: SHOT_NOT_SAVED, retry: () => handleShotFinished(run), run });
      await persistConversation(s);
      return;
    }
    const iterations = await bagIterations(s);
    if (iterations.some((i) => i.shotId === record.id)) return;
    const pour = recordPourSeconds(record);
    if (pour === null) {
      // No sample CafAI can read: Decaid records every run's first preheat sample, so its record changed shape (a
      // field renamed, a time CafAI cannot parse). Said in Settings > About, and the shot is credited as before, never
      // taken for a run that did not pour (D204).
      reportDrift('GET /api/v1/shots/{id}', 'measurements: no sample with a machine.timestamp CafAI can read');
    } else if (pour < MIN_SHOT_POUR_S) {
      // Stopped as the pour began, or within its first 2 s: no card, no taste question, and the pending iteration and
      // the next card's comparison stay with the shot before (D204). Another shot's hunt comes back to the banner;
      // this run's own, ended by its Retry, does not.
      if (hunt && hunt.run !== run && standing === null) standing = hunt;
      await sayNeverPoured(s);
      return;
    }
    // A record that does not say which profile ran is credited as before; the
    // chat says so with the shot card (5.10).
    const ran: unknown = record.workflow?.profile;
    const ranTitle: unknown = typeof ran === 'object' && ran !== null ? (ran as Record<string, unknown>).title : undefined;
    const saysWhichRan = typeof ranTitle === 'string';
    if (!saysWhichRan) {
      const problem =
        typeof ran === 'object' && ran !== null
          ? `workflow.profile.title: ${describeValue(ranTitle, 'string')}`
          : `workflow.profile: ${describeValue(ran, 'object')}`;
      reportDrift('GET /api/v1/shots/{id}', problem);
    }
    if (saysWhichRan && !ranVersion(record.workflow, current)) {
      // The machine ran something else (another bag's profile, or a load that
      // failed): crediting this shot to the active version would corrupt the dial-in.
      const ran = record.workflow.profile.title;
      addMessage('system', [
        noticePart(
          'warning',
          ran === current.title
            ? `That shot ran a different "${ran}" (another bag or version), so it is not part of this dial-in.`
            : `That shot ran "${ran}", not ${current.title}, so it is not part of this dial-in.`,
        ),
      ]);
      setLoadProblem(current.id, `The machine is not running ${current.title}. Tap Retry to load it.`);
      // Said once: the 30 s look does not raise the same profile again.
      mismatchSeen = mismatchKey(current, record.workflow.profile);
      await persistConversation(s);
      return;
    }
    if (startedBeforeLoad(run.started, current)) {
      // Decaid's workflow (and so the record) names the version, but the
      // machine was still taking it when the shot started.
      addMessage('system', [
        noticePart('warning', `That shot started before the machine finished loading ${current.title}, so it is not part of this dial-in.`),
      ]);
      await persistConversation(s);
      return;
    }
    if (uploadFailedFor === current.id) {
      // Decaid's workflow names this version, but the machine refused it, so
      // the shot ran whatever the machine had before.
      addMessage('system', [
        noticePart('warning', `The machine did not take ${current.title}, so that shot is not part of this dial-in. Tap Retry to load it.`),
      ]);
      await persistConversation(s);
      return;
    }
    for (const stale of iterations.filter((i) => i.outcome === 'pending')) {
      await putIteration({ ...stale, outcome: 'superseded' });
    }
    shotCache.set(record.id, record);
    let summary: ShotSummary;
    try {
      summary = coach.summarizeShot(record);
    } catch (error) {
      addMessage('system', [noticePart('warning', `Could not read that shot: ${describe(error)}`)]);
      await persistConversation(s);
      return;
    }
    // A bag's first shot is compared with the last shot of another coffee (D126).
    const firstShot = !state.messages.some((m) => m.parts.some((part) => part.kind === 'shot'));
    const others = firstShot ? await shotsOfOtherBags(s.bag.id) : [];
    const at = nowIso();
    const iterationId = deps.newId('iter');
    await putIteration({
      id: iterationId,
      bagId: s.bag.id,
      bagName: s.bag.name,
      profileVersionId: current.id,
      profileVersion: current.version,
      shotId: record.id,
      summary,
      feedback: null,
      proposal: null,
      change: null,
      outcome: 'pending',
      createdAt: at,
      updatedAt: at,
    });
    addMessage('system', [shotPart(record.id, summary)]);
    usage.track('shot_read');
    setMessages(fillBaselines(state.messages, others));
    watchVisualizer(s, record.id, iterationId);
    if (!saysWhichRan) {
      addMessage('system', [noticePart('info', `Decaid's record did not say which profile ran; CafAI counted it for v${current.version}.`)]);
    }
    // The card shows while the roast is worked out: its batch is read again from Decaid.
    emit();
    const roast = await roastFor(s);
    const template = coach.getTemplate(current.templateId);
    // One fact per shot (D197), decided from the iterations before this one's; one still due to an earlier shot
    // whose reply failed is dropped. In the coach's modes the coach hears it is due, and what was told (D201).
    s.factDue = factDueFor(iterations, current, record.id, summary) ? { shotId: record.id, shown: false } : null;
    const source = funFactsSource();
    const funFact = s.factDue && coachShares(source) ? { told: toldLabels(told.entries(), await factList()), web: source === 'web' } : null;
    const block = shotCompletedBlock({
      shotRef: 'latest',
      shotId: record.id,
      version: current.version,
      templateId: current.templateId,
      levers: template ? coach.readLeverValues(template, current.profile) : {},
      doseG: summary.doseG ?? s.doseG,
      targetYieldG: summary.targetYieldG ?? s.targetYieldG,
      grinder: grinderForModel(),
      roast,
      today: todayOf(clock.now()),
      summary: summaryForModel(summary),
      ...(funFact ? { funFact } : {}),
    });
    await sendUser(s, new Map(), UNANSWERED_SHOT, [block], 'shot');
  }

  // -------------------------------------------------------------------------
  // Controller
  // -------------------------------------------------------------------------

  function requireCall(s: Session, requestId: string, name: ToolName): PendingCall | null {
    return s.pending.find((p) => p.id === requestId && p.name === name) ?? null;
  }

  /**
   * POST v1 to Decaid's library under the template's bundled default (D59),
   * so the library shows where it came from. A Decaid without that default
   * (an older build, or one that never bundled it) answers 400 for the
   * parent: v1 is then recorded without one.
   */
  async function recordV1(template: Template, request: { profile: ProfileJson; metadata: Record<string, unknown> }) {
    try {
      return await api.createProfileVersion({ ...request, parentId: template.decaidDefaultId });
    } catch (error) {
      if (!(error instanceof GatewayError) || error.status !== 400) throw error;
      return api.createProfileVersion(request);
    }
  }

  async function pickTemplate(requestId: string, templateId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.proposeTemplates);
    const template = coach.getTemplate(templateId);
    if (!call || !template) return;
    setMessages(
      updatePart(state.messages, byRequestId(requestId), (part) =>
        part.kind === 'templates' ? { ...part, pickedTemplateId: templateId } : part,
      ),
    );
    state = { ...state, busy: true };
    emit();

    // v1 follows the dose (D57), and the dose may have changed in Decaid since
    // the bag opened: read it again (after the read the session started, so
    // that one cannot land last). A failed read keeps the session's dose.
    await s.numbers;
    await loadWorkflowNumbers(s);
    const decaidDoseG = s.doseG;
    const doseG = coach.knownDose(decaidDoseG);
    const title = coach.versionTitle(s.bag.name, 1);
    const profile = coach.buildVersionProfile(template, coach.buildStartingProfile(template, decaidDoseG), title, s.bag.name);
    const yieldG = versionYield(s, profile);
    const versionId = deps.newId('ver');
    let decaidProfileId: string | null = null;
    let uploaded = true;
    let note: string | null = null;
    let workflow: Workflow | null = null;
    try {
      const created = await recordV1(template, {
        profile,
        metadata: { source: 'cafai', bagId: s.bag.id, version: 1, templateId },
      });
      decaidProfileId = created.record.id;
      if (created.deduped) note = 'Decaid already had this exact profile and kept its library entry; the machine shows the new title.';
      workflow = await activate(s, versionId, profile);
    } catch (error) {
      uploaded = false;
      note = describe(error);
    }
    const version: ProfileVersion = {
      id: versionId,
      bagId: s.bag.id,
      version: 1,
      title,
      templateId,
      profile,
      decaidProfileId,
      parentVersionId: null,
      change: null,
      status: 'active',
      createdAt: nowIso(),
    };
    await saveVersions(s, [version]);
    await persistBag(s, { templateId, activeVersionId: version.id });
    // Where v1 stops and why, before the load: the barista may want another dose.
    const dose = { decaidG: decaidDoseG, knownG: doseG, assumedG: coach.referenceDoseG, range: coach.doseRange };
    addMessage('system', [noticePart('info', startingYieldText(title, yieldG, dose))]);
    // Not loaded at all (uploaded false) is neither on the machine nor waiting for it.
    let onMachineNow: boolean | null = null;
    let notConfirmed: string | null = null;
    if (workflow) {
      const outcome = await confirmOnMachine(version.id, title, workflow.profile);
      reportLoad(version.id, title, outcome);
      onMachineNow = onMachine(outcome);
      notConfirmed = loadError(outcome);
    } else {
      setLoadProblem(version.id, `Could not load ${title} on the machine. Tap Retry to try again.`);
      addMessage('system', [noticePart('error', `${title} is saved, but loading it on the machine failed: ${note}`)]);
    }
    state = { ...state, busy: false };
    emit();
    const picked: TemplatePickedPayload = {
      picked: templateId,
      version: 1,
      title,
      yieldG,
      doseG,
      uploaded,
      onMachine: onMachineNow,
      loadError: notConfirmed,
      note,
    };
    const answers = new Map([[call.id, toolResult(call.id, picked)]]);
    await sendUser(s, answers, UNANSWERED_TEXT, [], 'other');
  }

  /**
   * After the user switches bags: if the machine is not running this bag's
   * active version, load it (the tap on the bag is the request), and say so.
   */
  async function loadActiveVersionIfNeeded(): Promise<void> {
    const s = session;
    const version = activeVersion(s);
    if (!s || !version) return;
    try {
      const workflow = await api.getWorkflow();
      if (carriesVersion(workflow, version)) return;
      state = { ...state, busy: true };
      emit();
      const loaded = await activate(s, version.id, version.profile);
      reportLoad(version.id, version.title, await confirmOnMachine(version.id, version.title, loaded.profile));
    } catch (error) {
      setLoadProblem(version.id, `Could not load ${version.title}: ${describe(error)}`);
    }
    state = { ...state, busy: false };
    await persistConversation(s);
    emit();
  }

  /**
   * At start-up, every 30 s and when the page comes back into view, say so
   * when the machine runs something other than the active bag's version
   * (another skin, or a profile picked on the machine). Loading it is left to
   * the user's Retry: CafAI looking never changes the machine (D42).
   */
  async function checkMachineProfile(): Promise<void> {
    const s = session;
    const version = activeVersion(s);
    if (!s || !version) return;
    let workflow: Workflow;
    try {
      workflow = await api.getWorkflow();
    } catch {
      return; // Decaid unreachable: nothing to compare yet.
    }
    if (!workflow.profile) return;
    if (carriesVersion(workflow, version)) {
      mismatchSeen = null;
      return;
    }
    if (raiseMismatch(version, workflow.profile)) emit();
  }

  /** The profile the machine runs instead of `version`, as the 30 s look remembers it. */
  function mismatchKey(version: ProfileVersion, profile: WireProfile): string {
    let content: string;
    try {
      content = coach.profileId(profile);
    } catch {
      content = '';
    }
    return `${version.id}\n${profile.title}\n${content}`;
  }

  /** The machine has the version's title but not the version (D41): never the same title twice. */
  function runningOther(title: string, version: ProfileVersion): string {
    return title === version.title
      ? `The machine is running a different "${title}" (another bag or version). Tap Retry to load this bag's version.`
      : `The machine is running "${title}", not ${version.title}. Tap Retry to load it.`;
  }

  /**
   * Put "the machine runs another profile" on the banner, once per profile:
   * the same mismatch found again (every 30 s) never brings back a banner the
   * user dismissed (D52); a different profile does. True when raised.
   */
  function raiseMismatch(version: ProfileVersion, profile: WireProfile): boolean {
    const key = mismatchKey(version, profile);
    if (key === mismatchSeen) return false;
    mismatchSeen = key;
    setLoadProblem(version.id, runningOther(profile.title, version));
    return true;
  }

  /** Nothing else is going on: no reply or action in progress, no shot, no version on its way to the machine. */
  function quiet(): boolean {
    return !state.busy && !isShotRunning() && !barrierInFlight;
  }

  /**
   * The beat of the machine check (MACHINE_CHECK_MS, and the page coming back
   * into view). The Profile line reads Decaid's workflow on it (machineTick),
   * so it and the banner change together (D70). The look goes on the engine's
   * queue, at most one waiting: a beat while CafAI is busy (a reply, a load)
   * looks right after that action instead of 30 s later, and only if nothing
   * else is going on by then.
   */
  function machineBeat(): void {
    if (disposed || !visibility.visible()) return;
    state = { ...state, machineTick: (state.machineTick ?? 0) + 1 };
    emit();
    if (checkQueued) return;
    checkQueued = true;
    void enqueue(async () => {
      checkQueued = false;
      if (quiet()) await checkMachineProfile();
    });
  }

  function scheduleMachineBeats(): void {
    if (disposed) return;
    checkTimer = checkTimers.setTimeout(() => {
      checkTimer = null;
      machineBeat();
      scheduleMachineBeats();
    }, MACHINE_CHECK_MS);
  }

  /** Back in view after a while: what Decaid holds may have changed meanwhile. */
  function onVisibilityChange(): void {
    if (!visibility.visible()) return;
    // The linked grinder may have left Decaid's library (D62).
    loadGrinder();
    machineBeat();
  }

  async function retryActivation(versionId: string): Promise<void> {
    const s = session;
    const version = s?.versions.find((v) => v.id === versionId);
    if (!s || !version) return;
    state = { ...state, busy: true, error: null };
    emit();
    try {
      const workflow = await activate(s, version.id, version.profile);
      reportLoad(version.id, version.title, await confirmOnMachine(version.id, version.title, workflow.profile));
      lastFailed = null;
    } catch (error) {
      setError(`Could not load ${version.title}: ${describe(error)}`, () => retryActivation(versionId));
    } finally {
      state = { ...state, busy: false };
      await persistConversation(s);
      emit();
    }
  }

  async function answerOptions(requestId: string, selected: string[], otherText: string | null): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.askUser);
    if (!call) return;
    usage.track('coach_message');
    // Typed text, like a chat message: a pasted key never reaches the coach or Decaid (D37).
    const other = redactKeyLike(otherText?.trim() ?? '', '[API key removed]') || null;
    setMessages(
      updatePart(state.messages, byRequestId(requestId), (part) =>
        part.kind === 'options' ? { ...part, answer: { selected, otherText: other } } : part,
      ),
    );
    const said = tasteWords(selected, other);
    if (said) addMessage('user', [{ kind: 'text', text: said }]);
    emit();
    // Only the answer to the taste question is the shot's taste; any other
    // answer (the puck, a preference) stays in the chat and goes to the coach.
    const { question } = call.input as AskUser;
    const iteration = isTasteQuestion(question) ? await latestPendingIteration(s) : undefined;
    if (iteration) {
      await putIteration({ ...iteration, feedback: { question, selected, otherText: other } });
      noteTaste(s, iteration, selected, other);
    }
    const answers = new Map([[call.id, toolResult(call.id, { selected, other })]]);
    await sendUser(s, answers, { answered: false, note: 'Not answered.' }, [], 'other');
  }

  async function confirmChange(requestId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.proposeAdjustment);
    if (!call?.plan) return;
    const input = call.input as ProposeAdjustment;
    // A grind move rebuilt after a reload may have been worked out before the
    // grinder's steps were read again (they load in the background): work it
    // out again, so Confirm saves the setting its card shows.
    if (call.recovered && call.plan.variable === 'grind') {
      const context = proposalContext(s);
      const again = context ? coach.validateProposal(input, context) : null;
      if (again?.ok) call.plan = again.plan;
    }
    const plan = call.plan;
    call.confirming = true;
    setMessages(setDiffStatus(state.messages, requestId, 'applying'));
    state = { ...state, busy: true };
    emit();

    let versionNumber: number | null = null;
    let title: string | null = null;
    let loading: { versionId: string; profile: WireProfile } | null = null;
    try {
      const current = activeVersion(s);
      if (plan.createsVersion && plan.newProfile && current) {
        const template = coach.getTemplate(current.templateId);
        if (!template) throw new Error('The template of the active version is missing.');
        versionNumber = Math.max(...s.versions.map((v) => v.version)) + 1;
        title = coach.versionTitle(s.bag.name, versionNumber);
        const profile = coach.buildVersionProfile(template, plan.newProfile, title, s.bag.name);
        const nextId = deps.newId('ver');
        const workflow = await activate(s, nextId, profile, plan.contextPatch);
        // Recorded in Decaid's library only once Decaid took it, so a failed
        // PUT leaves no stray "vN" there. If only this fails, the version is
        // still in the workflow; just its library lineage is missing.
        let decaidProfileId: string | null = null;
        try {
          const created = await api.createProfileVersion({
            profile,
            ...(current.decaidProfileId ? { parentId: current.decaidProfileId } : {}),
            metadata: { source: 'cafai', bagId: s.bag.id, version: versionNumber, templateId: template.id },
          });
          decaidProfileId = created.record.id;
        } catch {
          // Library only; nothing to tell the barista.
        }
        const change: AppliedChange = {
          variable: plan.variable,
          lever: plan.leverId,
          from: plan.from,
          to: plan.to,
          diffLines: plan.diffLines,
          summary: plan.summary || input.summary,
        };
        const next: ProfileVersion = {
          id: nextId,
          bagId: s.bag.id,
          version: versionNumber,
          title,
          templateId: template.id,
          profile,
          decaidProfileId,
          parentVersionId: current.id,
          change,
          status: 'active',
          createdAt: nowIso(),
        };
        await saveVersions(s, [{ ...current, status: 'superseded' }, next]);
        await persistBag(s, { activeVersionId: next.id });
        loading = { versionId: nextId, profile: workflow.profile };
      } else if (plan.variable === 'dose' && plan.to !== null) {
        await api.updateWorkflow({ context: { targetDoseWeight: plan.to } });
        s.doseG = plan.to;
      } else if (plan.variable === 'grind') {
        // The new dial setting (the coach's, or worked out from a relative
        // move on the grinder's steps in Decaid's library, D62) goes with the
        // next shots, in CafAI and in Decaid's workflow context. A move CafAI
        // cannot size leaves the stored setting as the user last entered it.
        // The dial is turned by hand, so an unreachable Decaid does not block
        // the confirm; the outbox sends the setting once Decaid is back (D64).
        const setting = plan.contextPatch.grinderSetting ?? input.grind?.setting ?? null;
        if (setting) {
          settings = await storage.settings.update({ grinderSetting: setting });
          await sendGrinder();
        }
      }
      const iteration = await latestPendingIteration(s);
      if (iteration) {
        await putIteration({
          ...iteration,
          proposal: input,
          change: {
            variable: plan.variable,
            lever: plan.leverId,
            from: plan.from,
            to: plan.to,
            diffLines: plan.diffLines,
            summary: plan.summary || input.summary,
          },
          outcome: plan.variable === 'none' ? 'kept' : 'applied',
        });
      }
      setMessages(setDiffStatus(state.messages, requestId, 'applied'));
      usage.track(plan.variable === 'none' ? 'recipe_kept' : 'change_confirmed');
    } catch (error) {
      // Nothing changed in Decaid (a shot was running, Decaid refused): keep
      // the proposal open so Confirm can simply be tapped again.
      const reason = describe(error);
      call.confirming = false;
      setMessages(setDiffStatus(state.messages, requestId, 'pending', reason));
      state = { ...state, busy: false };
      setError(`The change was not loaded: ${reason}`, () => confirmChange(requestId));
      emit();
      return;
    }
    // Applied: the version exists and is active even if the machine has not
    // confirmed it yet; CafAI's own notice and banner say so (D55).
    let onMachineNow: boolean | null = null;
    let notConfirmed: string | null = null;
    if (loading && title) {
      const outcome = await confirmOnMachine(loading.versionId, title, loading.profile);
      reportLoad(loading.versionId, title, outcome);
      onMachineNow = onMachine(outcome);
      notConfirmed = loadError(outcome);
    }
    const payload: AdjustmentResultPayload = {
      applied: true,
      variable: plan.variable,
      version: versionNumber,
      title,
      onMachine: onMachineNow,
      loadError: notConfirmed,
    };
    state = { ...state, busy: false };
    emit();
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, [], 'other');
  }

  async function declineChange(requestId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.proposeAdjustment);
    if (!call) return;
    setMessages(setDiffStatus(state.messages, requestId, 'declined'));
    emit();
    const iteration = await latestPendingIteration(s);
    if (iteration) await putIteration({ ...iteration, proposal: call.input as ProposeAdjustment, outcome: 'declined' });
    const payload: AdjustmentResultPayload = { applied: false, reason: 'The user declined.' };
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, [], 'other');
  }

  /**
   * Add on the coach's grinder card (D125): the grinder the coach heard goes
   * into Decaid's grinder library, or the one Decaid already has is taken
   * (never a second entry), and it is linked as Settings links one: its id,
   * its model as the name, the dial's setting kept only when it was this
   * grinder's (another grinder's number means nothing here). The next shots carry it
   * in Decaid's workflow (D54), and the coach hears its dial. A failure says
   * why on the card, which stays open to tap again; the coach waits.
   */
  async function addGrinder(requestId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.offerGrinder);
    if (!call || call.confirming) return;
    const request = grinderRequest(call.input as OfferGrinder);
    if (!request) {
      // Only a model that was all key text cleans down to nothing: it never goes to Decaid (D69).
      setMessages(setGrinderOfferStatus(state.messages, requestId, 'pending', { error: 'That name looked like an API key.' }));
      emit();
      return;
    }
    call.confirming = true;
    setMessages(setGrinderOfferStatus(state.messages, requestId, 'adding'));
    state = { ...state, busy: true };
    emit();
    let linked: Awaited<ReturnType<ApiPort['addGrinder']>>;
    try {
      linked = await api.addGrinder(request);
    } catch (error) {
      call.confirming = false;
      const why = error instanceof GatewayError && error.status === 404 ? NO_GRINDER_LIBRARY : describe(error);
      setMessages(setGrinderOfferStatus(state.messages, requestId, 'pending', { error: why }));
      state = { ...state, busy: false };
      await persistConversation(s);
      emit();
      return;
    }
    const model = linked.model.trim();
    // The setting belonged to the grinder linked before (by id), else the one named (by model).
    const previousId = settings.grinderId ?? null;
    const previousName = settings.grinderName?.trim().toLowerCase() || null;
    const sameGrinder = previousId !== null ? previousId === linked.id : previousName === null || previousName === model.toLowerCase();
    settings = await storage.settings.update({
      grinderId: linked.id,
      grinderName: model || null,
      ...(sameGrinder ? {} : { grinderSetting: null }),
    });
    // Its dial as Decaid just answered it; a read still on its way is older.
    grinderReads += 1;
    linkedGrinder = { id: linked.id, info: linked.info };
    const burrs = linked.burrs?.trim();
    const linkedName = burrs ? `${model || 'Unnamed grinder'} (${burrs})` : model || 'Unnamed grinder';
    setMessages(setGrinderOfferStatus(state.messages, requestId, linked.added ? 'added' : 'existing', { linkedName }));
    state = { ...state, busy: false };
    emit();
    await sendGrinder();
    const payload: GrinderOfferResultPayload = { added: true, alreadyInDecaid: !linked.added, grinder: grinderForModel() };
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, [], 'other');
  }

  /** Not now on the grinder card: nothing is added, and the coach hears so. */
  async function declineGrinder(requestId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.offerGrinder);
    if (!call || call.confirming) return;
    setMessages(setGrinderOfferStatus(state.messages, requestId, 'declined'));
    emit();
    const payload: GrinderOfferResultPayload = { added: false, reason: 'The user chose not to add it.' };
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, [], 'other');
  }

  async function undo(): Promise<void> {
    const s = session;
    if (!s || !canUndo(s)) return;
    const current = activeVersion(s)!;
    const parent = s.versions.find((v) => v.id === current.parentVersionId);
    if (!parent) return;
    state = { ...state, busy: true, error: null };
    emit();
    let workflow: Workflow;
    try {
      workflow = await activate(s, parent.id, parent.profile);
    } catch (error) {
      state = { ...state, busy: false };
      setError(`Could not go back to ${parent.title}: ${describe(error)}`, undo);
      emit();
      return;
    }
    await saveVersions(s, [
      { ...current, status: 'undone' },
      { ...parent, status: 'active' },
    ]);
    await persistBag(s, { activeVersionId: parent.id });
    const iterations = await bagIterations(s);
    const maker = [...iterations].reverse().find((i) => madeVersion(i, current));
    if (maker) await putIteration({ ...maker, outcome: 'undone' });
    setMessages(
      updatePart(
        state.messages,
        (part) => part.kind === 'diff' && part.status === 'applied' && part.versionLabel === current.title,
        (part) => (part.kind === 'diff' ? { ...part, status: 'undone' } : part),
      ),
    );
    addMessage('system', [noticePart('info', `Back on ${parent.title}.`)]);
    usage.track('change_undone');
    reportLoad(parent.id, parent.title, await confirmOnMachine(parent.id, parent.title, workflow.profile));
    state = { ...state, busy: false };
    emit();
    await sendUser(
      s,
      new Map(),
      { answered: false, note: 'The user undid the last change.' },
      [undoBlock({ from: current.version, to: parent.version, title: parent.title })],
      'undo',
    );
  }

  async function rateShot(shotId: string, verdict: ShotVerdict): Promise<void> {
    const s = session;
    if (!s || !isShotVerdict(verdict)) return;
    const card = state.messages.flatMap((m) => m.parts).find((p) => p.kind === 'shot' && p.shotId === shotId);
    // Stars given before D126 stay as they were.
    if (!card || card.kind !== 'shot' || card.stars !== undefined || card.rating?.verdict === verdict) return;
    const baseline = card.baseline ?? baselineFor(state.messages, shotId, await shotsOfOtherBags(s.bag.id));
    const score = runningScore(state.messages, shotId, verdict);
    if (!baseline || score === null) return;
    // On the card, so it comes back with the transcript; the coach hears it with the next turn.
    setMessages(setShotRating(state.messages, shotId, baseline, { verdict, score }));
    await persistConversation(s);
    emit();
    void queueShotWrite(shotId, { bagId: s.bag.id, rating: { verdict, score, comparedWith: baseline } });
  }

  /**
   * The barista's TDS on a shot's card (D162-D167), or null to
   * remove it: the card and the shot's iteration keep it, with the EY worked
   * out from the card's own dose and yield; Decaid's record gets both through
   * the outbox (D64); the coach hears it with the next turn it is sent, as a
   * verdict. A TDS CafAI does not take, a shot no card shows, or the reading
   * the card already has does nothing.
   */
  async function setShotTds(shotId: string, tdsPct: number | null): Promise<void> {
    const s = session;
    if (!s || (tdsPct !== null && !isTds(tdsPct))) return;
    const card = shotCard(state.messages, shotId);
    if (!card) return;
    const tds = tdsPct === null ? null : roundTds(tdsPct);
    if ((readingOf(card.summary)?.tdsPct ?? null) === tds) return;
    // On the card, so it comes back with the transcript; the coach hears it with the next turn.
    setMessages(setCardTds(state.messages, shotId, tds));
    await persistConversation(s);
    emit();
    // CafAI's own record of the shot: History, the export and the backup keep it too (D166).
    const iteration = (await bagIterations(s)).find((i) => i.shotId === shotId);
    if (iteration?.summary) await putIteration({ ...iteration, summary: withTds(iteration.summary, tds) });
    const eyPct = readingOf(shotCard(state.messages, shotId)?.summary)?.eyPct ?? null;
    void queueShotWrite(shotId, { bagId: s.bag.id, reading: { tdsPct: tds, eyPct } });
  }

  async function sendText(text: string): Promise<void> {
    const typed = text.trim();
    if (!typed) return;
    usage.track('coach_message');
    const s = session ?? (await createBag(false));
    // The bag described in words instead of picked or read from a photo: those cards close (6.1, 6.8).
    for (const open of [isOpenBeanCard, isOpenBagConfirm]) {
      if (state.messages.some((m) => m.parts.some(open))) setMessages(updatePart(state.messages, open, (part) => setAside(part, 'typed')));
    }
    // A pasted API key never reaches the coach, the transcript or Decaid.
    const trimmed = redactKeyLike(typed, '[API key removed]');
    addMessage('user', [{ kind: 'text', text: trimmed }]);
    if (trimmed !== typed) {
      addMessage('system', [noticePart('info', 'That looked like an API key, so CafAI took it out. Keys go in Settings.')]);
    }
    emit();
    // Typed while the taste question is open, it is the taste; typed under
    // any other question, it is a reply like any other.
    const tasteQuestion = s.pending.find((p) => p.name === TOOL.askUser && isTasteQuestion((p.input as AskUser).question));
    if (tasteQuestion) {
      const iteration = await latestPendingIteration(s);
      if (iteration && !iteration.feedback) {
        await putIteration({
          ...iteration,
          feedback: { question: (tasteQuestion.input as AskUser).question, selected: [], otherText: trimmed },
        });
        noteTaste(s, iteration, [], trimmed);
      }
    }
    if (s.conversation.apiMessages.length === 0) {
      await startIntake(s, trimmed, null);
    } else {
      await sendUser(s, new Map(), UNANSWERED_TEXT, [textBlock(trimmed)], 'typed');
    }
  }

  async function refreshFromStorage(): Promise<void> {
    settings = await storage.settings.get();
    state = { ...state, hasApiKey: Boolean(await storage.secrets.getApiKey()) };
  }

  /**
   * Read the settings, the key and the bags again (after Settings saved, an
   * import, or a restore from Decaid's backup). True when a coach reply waited
   * for the key that is now there: the caller runs it once the screen is up
   * to date.
   */
  async function reread(): Promise<boolean> {
    const before = settings;
    await refreshFromStorage();
    const grinderChanged =
      settings.grinderName !== before.grinderName ||
      settings.grinderSetting !== before.grinderSetting ||
      (settings.grinderId ?? null) !== (before.grinderId ?? null);
    // The grinder's steps may have changed in Decaid's library too: read them again, in the background.
    loadGrinder();
    // After an import the bag list (and the active bag's records) may differ.
    const bags = (await storage.bags.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    state = { ...state, bags };
    const current = session;
    if (current) {
      const stored = bags.find((b) => b.id === current.bag.id);
      if (!stored) {
        session = null;
        state = { ...state, messages: [] };
      } else if (stored.updatedAt !== current.bag.updatedAt) {
        await openSession(stored);
      }
    } else {
      const active = bags.find((b) => b.id === settings.activeBagId);
      if (active) await openSession(active);
    }
    // The next shots should carry the grinder the user just saved (D54).
    // After the session is current, so a notice lands in the right chat.
    if (grinderChanged) await sendGrinder();
    const waitedForKey = state.hasApiKey && Boolean(state.error?.startsWith('Add your Anthropic API key'));
    if (waitedForKey) setError(null);
    return waitedForKey && session !== null && awaitingModel(session.conversation.apiMessages);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async start() {
      await refreshFromStorage();
      loadGrinder();
      const bags = (await storage.bags.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      state = { ...state, bags };
      const active = bags.find((b) => b.id === settings.activeBagId);
      if (active) await openSession(active);
      state = { ...state, ready: true };
      unsubscribeShot = telemetry.onShot((event) => {
        // The linked grinder may have left Decaid's library while CafAI runs
        // (D62): read it with every shot, in the background, so the shot
        // event and the next grind move use what Decaid lists now.
        loadGrinder();
        // How far the version had got matters at the start, not when the shot is handled.
        if (event.type === 'started') {
          shotStart = { shotId: event.shotId, early: earlyLoad() };
          return;
        }
        const started = takeShotStart(event.shotId);
        // A new shot: a rating scale Decaid could not tell is asked once more (D101).
        scaleUnclear = false;
        // Asked now, as Decaid decides whether to keep the run, not once a reply the queue waits on is done (D193).
        const run = endedRun(event.shotId, event.stopReason, started, runSaved());
        void enqueue(() => handleShotFinished(run));
      });
      // React only to reports that arrive while CafAI runs, not a stale one.
      let lastError = telemetry.getState().connectionError;
      let machineWasConnected = telemetry.getState().machineConnected;
      let devicesSocket = telemetry.getState().sockets.devices;
      let shotFrame = telemetry.getState().shotState;
      unsubscribeTelemetry = telemetry.subscribe(() => {
        const now = telemetry.getState();
        // Each new shotState frame: what Decaid decided of a run (D204, D205).
        if (now.shotState !== shotFrame) {
          shotFrame = now.shotState;
          noteDecision(shotFrame);
        }
        const error = now.connectionError;
        if (error !== lastError) {
          const fresh = error !== null && (lastError === null || error.timestamp !== lastError.timestamp || error.kind !== lastError.kind);
          lastError = error;
          if (fresh && error.kind === 'profileUploadFailed') void enqueue(() => onUploadFailed(error.message));
        }
        const connected = now.machineConnected && !machineWasConnected;
        const reachable = now.sockets.devices === 'open' && devicesSocket !== 'open';
        machineWasConnected = now.machineConnected;
        devicesSocket = now.sockets.devices;
        // Decaid is reachable again: writes that wait go out (D64).
        if (connected || reachable) void outbox.flush();
        if (connected) void enqueue(onMachineConnected);
      });
      unsubscribeVisibility = visibility.subscribe(onVisibilityChange);
      emit();
      void enqueue(checkMachineProfile);
      scheduleMachineBeats();
    },
    dispose() {
      disposed = true;
      unsubscribeShot?.();
      unsubscribeTelemetry?.();
      unsubscribeVisibility?.();
      if (checkTimer !== null) checkTimers.clearTimeout(checkTimer);
      checkTimer = null;
      outbox.dispose();
      if (emitTimer) clearTimeout(emitTimer);
      listeners.clear();
    },
    newBag: () =>
      enqueue(async () => {
        if (refuseDuringShot()) return;
        const current = session;
        if (current && current.conversation.apiMessages.length === 0 && !current.bag.templateId) return;
        standing = null;
        await createBag(true);
      }),
    selectBag: (bagId) =>
      enqueue(async () => {
        if (refuseDuringShot()) return;
        const bag = await storage.bags.get(bagId);
        if (!bag) return;
        standing = null; // both kinds belong to the bag being left
        await openSession(bag);
        await loadActiveVersionIfNeeded();
      }),
    sendText: (text) => enqueue(() => sendText(text)),
    pickTemplate: (requestId, templateId) => enqueue(() => pickTemplate(requestId, templateId)),
    answerOptions: (requestId, selected, otherText) => enqueue(() => answerOptions(requestId, selected, otherText)),
    confirmChange: (requestId) => enqueue(() => confirmChange(requestId)),
    declineChange: (requestId) => enqueue(() => declineChange(requestId)),
    undo: () => enqueue(() => undo()),
    rateShot: (shotId, verdict) => enqueue(() => rateShot(shotId, verdict)),
    setShotTds: (shotId, tdsPct) => enqueue(() => setShotTds(shotId, tdsPct)),
    pickBean: (batchId) => enqueue(() => pickBean(batchId)),
    skipBeanPick: () => enqueue(() => skipBeanPick()),
    readBagPhoto: (photo) => enqueue(() => readBagPhoto(photo)),
    confirmBag: (details) => enqueue(() => confirmBag(details)),
    addGrinder: (requestId) => enqueue(() => addGrinder(requestId)),
    declineGrinder: (requestId) => enqueue(() => declineGrinder(requestId)),
    retry: () =>
      enqueue(async () => {
        const task = lastFailed;
        if (!task) return;
        setError(null);
        emit();
        await task();
      }),
    dismissError() {
      // Dismissing also drops a standing problem, which would otherwise put
      // the banner straight back; a mismatched shot raises it again.
      standing = null;
      setError(null);
      emit();
    },
    refresh: () =>
      enqueue(async () => {
        const resume = await reread();
        emit();
        if (resume) await runModel();
      }),
    restored: () =>
      enqueue(async () => {
        const first = !state.restoredFromBackup;
        // Without a key, the key card says why it asks again (5.5).
        state = { ...state, restoredFromBackup: true };
        const resume = await reread();
        const s = session;
        if (first && s) {
          addMessage('system', [noticePart('success', BAGS_ARE_BACK)]);
          await persistConversation(s);
        }
        emit();
        if (resume) await runModel();
      }),
  };
}

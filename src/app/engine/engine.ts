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
 * - Writes to Decaid that fail (a grinder setting, a shot's notes) wait in an
 *   outbox and go out again when Decaid is back (D64).
 * - Engine actions are serialized, so a shot that finishes mid-reply is
 *   handled after the reply, never interleaved with it.
 * - Everything is persisted as it happens (the WebView may be unloaded after
 *   ten minutes in the background without warning). Progress notices are the
 *   exception: they are never stored.
 *
 * Turn conventions: docs/briefs/ENGINE_PROTOCOL.md.
 */
import {
  AUTO_TOOLS,
  TOOL,
  TOOL_INPUTS,
  type AskUser,
  type ProposeAdjustment,
  type ProposeTemplates,
  type SaveBagDetails,
  type ToolName,
} from '../../coach/contract.ts';
import type {
  ShotAnnotations,
  ShotRecord,
  TelemetryStore,
  WireProfile,
  Workflow,
  WorkflowContext,
} from '../../api/types.ts';
import { isShotRunning as shotInProgress } from '../../api/workflow.ts';
import { redactKeyLike } from '../../storage/redact.ts';
import type { ProfileJson, ShotSummary } from '../../coach/types.ts';
import type { ContentBlock, Effort, PendingUiCall, RunnerTool, ToolResultBlock } from '../../llm/types.ts';
import type {
  AppliedChange,
  Bag,
  ConversationRecord,
  IterationRecord,
  ProfileVersion,
  Settings,
  Storage,
} from '../../storage/types.ts';
import type {
  CoachController,
  CoachPhase,
  CoachState,
  CoachUiMessage,
  CoachUiPart,
  NoticeProgress,
  TemplateCardItem,
} from '../types.ts';
import { createOutbox, type OutboxTimers } from './outbox.ts';
import type { ApiPort, ChangePlan, Clock, CoachPort, LlmPort, ShotSource } from './ports.ts';
import {
  UNANSWERED_SHOT,
  UNANSWERED_TEXT,
  intakeBlocks,
  shotCompletedBlock,
  summaryForModel,
  textBlock,
  toolResult,
  unansweredToolUses,
  undoBlock,
  awaitingModel,
  type AdjustmentResultPayload,
  type TemplatePickedPayload,
} from './protocol.ts';
import { EXTRAS_KEY, cafaiNotesLine, lastCafaiNotes, mergeNotes, tasteWords } from './shotNotes.ts';
import {
  NEW_BAG_PROMPT,
  appendText,
  byRequestId,
  diffPart,
  finishStreaming,
  message,
  noticePart,
  optionsPart,
  progressNoticePart,
  removeMessage,
  replaceParts,
  setDiffStatus,
  setShotStars,
  shotPart,
  templatesPart,
  updatePart,
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
}

export interface CoachEngine extends CoachController {
  start(): Promise<void>;
  dispose(): void;
}

interface PendingCall {
  id: string;
  name: ToolName;
  input: unknown;
  plan?: ChangePlan;
}

interface Session {
  bag: Bag;
  conversation: ConversationRecord;
  versions: ProfileVersion[];
  pending: PendingCall[];
  held: ToolResultBlock[];
  doseG: number | null;
  targetYieldG: number | null;
}

/**
 * What CafAI knows about a version on the machine (D55):
 * - loading: Decaid has it in the workflow; CafAI waits for the machine;
 * - loaded: Decaid's barrier said the machine holds it;
 * - waiting: no machine; Decaid uploads it when the machine connects;
 * - failed: the barrier failed (Decaid keeps retrying its own upload);
 * - assumed: an older Decaid without the barrier, so the workflow is trusted.
 */
type LoadStatus = 'loading' | 'loaded' | 'waiting' | 'failed' | 'assumed';

type LoadOutcome = { status: 'loaded' | 'waiting' | 'assumed' } | { status: 'failed'; reason: string };

interface ShotStart {
  shotId: string | null;
  /** The active version had not reached the machine when the shot started. */
  early: { versionId: string; status: LoadStatus; at: number } | null;
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

/** Everything CafAI still has to say about one shot; a newer write carries the older one's fields. */
interface ShotWrite {
  taste?: TasteNote;
  stars?: number;
}

const DEFAULT_YIELD_G = 36;
const STREAM_EMIT_MS = 50;
/** The banner while a finished shot has no record in Decaid (Retry looks again). */
const SHOT_NOT_SAVED = 'Decaid has not saved that shot yet.';
const SEARCH_NOTICE = 'Looking for that shot in Decaid…';
/**
 * Decaid answers the barrier 500 ms after the machine acknowledged the
 * profile's last write (its profileDownloadGuard), so a shot that started in
 * that window started after the upload.
 */
const UPLOAD_GUARD_MS = 500;
const GRINDER_WRITE = 'grinder';
const shotWriteKey = (shotId: string) => `shot:${shotId}`;

/** The CafAI version id a workflow context was tagged with at activation, if any. */
function taggedVersionId(context: WorkflowContext | undefined): string | null {
  const tag = context?.extras?.[EXTRAS_KEY];
  if (typeof tag !== 'object' || tag === null) return null;
  const versionId = (tag as Record<string, unknown>).versionId;
  return typeof versionId === 'string' ? versionId : null;
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
  let standing: { kind: 'load' | 'shot'; message: string; retry: () => Promise<void> } | null = null;

  /** Set (or clear) the standing problem; the banner follows when it shows the old one. */
  function replaceStanding(next: typeof standing): void {
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
  const outbox = createOutbox({ timers: deps.timers });
  const shotWrites = new Map<string, ShotWrite>();
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
    const names = s.pending.map((p) => p.name);
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

  function workflowContext(
    s: Session,
    versionId: string,
    profile: ProfileJson,
    patch: ChangePlan['contextPatch'] = {},
  ): WorkflowContext {
    const context: WorkflowContext = {
      targetYield: patch.targetYield ?? profile.target_weight ?? s.targetYieldG ?? DEFAULT_YIELD_G,
    };
    const dose = patch.targetDoseWeight ?? s.doseG;
    if (dose) context.targetDoseWeight = dose;
    // Decaid merges the context field by field, so anything left over from the
    // previous coffee (another skin's bean batch, the old roaster) would stick
    // to this coffee's shots: send null to clear what CafAI does not know.
    context.coffeeName = s.bag.name || null;
    context.coffeeRoaster = s.bag.roaster ?? null;
    context.beanBatchId = null;
    context.grinderId = null;
    context.grinderModel = settings.grinderName ?? null;
    context.grinderSetting = settings.grinderSetting ?? null;
    // Which CafAI version this is: shot records keep the workflow, so a shot
    // can be told apart even from a same-named or same-content version.
    context.extras = { [EXTRAS_KEY]: { versionId, bagId: s.bag.id } };
    return context;
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
  // Writes to Decaid that must not be lost (D64)
  // -------------------------------------------------------------------------

  /**
   * Write the grinder as last saved to Decaid's workflow context, so the next
   * shots carry it (D54). A write Decaid cannot take now waits in the outbox;
   * the chat says so once, and nothing when it goes through later.
   */
  async function sendGrinder(): Promise<void> {
    const grinder = { grinderModel: settings.grinderName ?? null, grinderSetting: settings.grinderSetting ?? null };
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
    const next: ShotWrite = { ...shotWrites.get(shotId), ...change };
    shotWrites.set(shotId, next);
    return outbox.put(shotWriteKey(shotId), () => writeShot(shotId, next));
  }

  /**
   * One PUT /shots/{id} with everything CafAI has to say about the shot so
   * far. Safe to repeat: Decaid merges extras key by key, and CafAI's notes
   * line replaces its own previous line instead of piling up.
   */
  async function writeShot(shotId: string, write: ShotWrite): Promise<void> {
    const own: Record<string, unknown> = {};
    const annotations: ShotAnnotations = {};
    if (write.taste) {
      // The notes as they are now: a person may have written some in Decaid since.
      const record = await api.getShot(shotId);
      shotCache.set(record.id, record);
      annotations.espressoNotes = mergeNotes(record.annotations?.espressoNotes, lastCafaiNotes(record.annotations), write.taste.notes);
      Object.assign(own, write.taste);
    }
    if (write.stars !== undefined) {
      // Decaid's scale is 0-10 (Visualizer shows it x10).
      annotations.enjoyment = write.stars * 2;
      own.stars = write.stars;
    }
    annotations.extras = { [EXTRAS_KEY]: own };
    await api.updateShot(shotId, { annotations });
    if (shotWrites.get(shotId) === write) shotWrites.delete(shotId);
  }

  /**
   * The taste answer, on the iteration's shot record in Decaid (D61): a short
   * notes line and extras.cafai. Never a key (D37).
   */
  function noteTaste(s: Session, iteration: IterationRecord, selected: string[], text: string | null): void {
    if (!iteration.shotId) return;
    const words = tasteWords(selected, text);
    if (!words) return;
    const version = s.versions.find((v) => v.id === iteration.profileVersionId);
    const taste: TasteNote = {
      bagId: s.bag.id,
      versionId: iteration.profileVersionId,
      version: iteration.profileVersion,
      selected: selected.map((option) => redactKeyLike(option)),
      text: text === null ? null : redactKeyLike(text),
      notes: cafaiNotesLine(words, version?.title ?? s.bag.name),
    };
    void queueShotWrite(iteration.shotId, { taste });
  }

  // -------------------------------------------------------------------------
  // Shots and query tools
  // -------------------------------------------------------------------------

  async function bagIterations(s: Session): Promise<IterationRecord[]> {
    return storage.iterations.listByBag(s.bag.id);
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
      return { record, summary: stored && stored.series.tS.length > 0 ? stored : coach.summarizeShot(record) };
    },
  };

  async function executeAuto(name: ToolName, value: unknown): Promise<{ content: string; isError?: boolean }> {
    const s = session;
    if (!s) return { content: JSON.stringify({ error: 'No bag is active.' }), isError: true };
    switch (name) {
      case TOOL.saveBagDetails: {
        const details = value as SaveBagDetails;
        // The bag name travels to Decaid (coffee name, profile titles): never a key.
        const clean = (text: string | null) => (text === null ? null : redactKeyLike(text, 'key removed'));
        await persistBag(s, {
          name: clean(details.name.trim()) || 'New bag',
          roaster: clean(details.roaster),
          origin: clean(details.origin),
          roastLevel: details.roastLevel,
          process: clean(details.process),
          notes: clean(details.notes),
        });
        emit();
        return { content: JSON.stringify({ saved: true }) };
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
    };
  }

  /** Domain checks after the zod schema passed. Returns an error sentence or null. */
  function domainError(name: ToolName, value: unknown): string | null {
    if (name === TOOL.proposeTemplates) {
      const ids = (value as ProposeTemplates).suggestions.map((s) => s.templateId);
      const unknown = ids.filter((id) => !coach.getTemplate(id));
      if (unknown.length > 0) {
        return `Unknown template id ${unknown.join(', ')}. Use only: ${coach.templates.map((t) => t.id).join(', ')}.`;
      }
      if (new Set(ids).size !== ids.length) return 'Suggest each template at most once.';
      return null;
    }
    if (name === TOOL.proposeAdjustment) {
      const s = session;
      const context = s ? proposalContext(s) : null;
      if (!context) return 'No profile version is active yet. Propose templates first.';
      const result = coach.validateProposal(value as ProposeAdjustment, context);
      return result.ok ? null : result.errors.join(' ');
    }
    return null;
  }

  const tools: RunnerTool[] = (Object.values(TOOL) as ToolName[]).map((name) => {
    const schema = TOOL_INPUTS[name];
    const zodValidate = llm.validator(schema);
    const auto = AUTO_TOOLS.includes(name);
    const tool: RunnerTool = {
      definition: llm.toolDefinition(name, coach.toolDescription(name), schema),
      kind: auto ? 'auto' : 'ui',
      validate(input) {
        const parsed = zodValidate(input);
        if (!parsed.ok) return parsed;
        const error = domainError(name, parsed.value);
        return error ? { ok: false, error } : parsed;
      },
    };
    if (auto) tool.execute = (value) => executeAuto(name, value);
    return tool;
  });
  const toolsByName = new Map(tools.map((t) => [t.definition.name, t]));

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
      addMessage('assistant', [optionsPart(call.id, input.question, coach.withOther(input.options), input.multiSelect)]);
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
        }),
      ]);
      s.pending.push({ id: call.id, name, input, plan });
      const iteration = await latestPendingIteration(s);
      if (iteration) await putIteration({ ...iteration, proposal: input });
    }
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
    try {
      const result = await llm.run({
        provider: llm.provider,
        model: settings.model,
        system: coach.systemPrompt(),
        effort,
        ...(deps.maxTokens ? { maxTokens: deps.maxTokens } : {}),
        messages: s.conversation.apiMessages,
        tools,
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
          await persistConversation(s);
        },
      });
      setMessages(finishStreaming(state.messages));
      s.pending = [];
      s.held = result.heldResults;
      for (const call of result.pendingUiCalls) await presentUiCall(s, call);
    } catch (error) {
      setMessages(finishStreaming(state.messages));
      setError(describe(error), runModel);
    } finally {
      state = { ...state, busy: false };
      await persistConversation(s);
      emit();
    }
  }

  /**
   * Answer every tool call the model is waiting on (in tool_use order), then
   * add `extra` blocks, append the user turn, and run the model.
   */
  async function sendUser(
    s: Session,
    answers: Map<string, ToolResultBlock>,
    fallback: unknown,
    extra: ContentBlock[],
  ): Promise<void> {
    const order = unansweredToolUses(s.conversation.apiMessages).map((u) => u.id);
    const byId = new Map<string, ToolResultBlock>();
    for (const held of s.held) byId.set(held.tool_use_id, held);
    for (const [id, result] of answers) byId.set(id, result);
    const results = order.map((id) => byId.get(id) ?? toolResult(id, fallback));
    const implicit = s.pending.filter((p) => !answers.has(p.id)).map((p) => p.id);
    if (implicit.length > 0) {
      let messages = state.messages;
      for (const id of implicit) {
        messages = updatePart(messages, byRequestId(id), (part) => {
          if (part.kind === 'templates' || part.kind === 'options') return { ...part, expired: true };
          if (part.kind === 'diff' && part.status === 'pending') return { ...part, status: 'expired' };
          return part;
        });
      }
      setMessages(messages);
    }
    s.pending = [];
    s.held = [];
    const blocks: ContentBlock[] = [...results, ...extra];
    if (blocks.length === 0) return;
    s.conversation = {
      ...s.conversation,
      apiMessages: [...s.conversation.apiMessages, { role: 'user', content: blocks }],
    };
    await persistConversation(s);
    await runModel();
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** Rebuild pending calls from a stored transcript (after a reload). */
  async function recoverPending(s: Session): Promise<void> {
    s.pending = [];
    s.held = [];
    for (const use of unansweredToolUses(s.conversation.apiMessages)) {
      const tool = toolsByName.get(use.name);
      if (!tool) {
        s.held.push(toolResult(use.id, `Unknown tool ${use.name}.`, true));
        continue;
      }
      const validation = tool.validate(use.input);
      if (!validation.ok) {
        s.held.push(toolResult(use.id, validation.error, true));
      } else if (tool.kind === 'auto' && tool.execute) {
        const outcome = await tool.execute(validation.value);
        s.held.push(toolResult(use.id, outcome.content, outcome.isError ?? false));
      } else if (use.name === TOOL.proposeAdjustment) {
        const context = proposalContext(s);
        const plan = context ? coach.validateProposal(validation.value as ProposeAdjustment, context) : null;
        if (plan?.ok) s.pending.push({ id: use.id, name: use.name, input: validation.value, plan: plan.plan });
        else s.held.push(toolResult(use.id, 'This proposal no longer applies to the active version.', true));
      } else {
        s.pending.push({ id: use.id, name: use.name as ToolName, input: validation.value });
      }
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
    };
    session = s;
    // A stored progress notice (an older build, a crash) describes work that is long over.
    state = { ...state, messages: withoutTransient(conversation.uiMessages), error: null };
    lastFailed = null;
    await recoverPending(s);
    if (awaitingModel(s.conversation.apiMessages)) {
      setError("The coach's last reply did not finish. Tap Retry to ask again.", runModel);
    }
    settings = await storage.settings.update({ activeBagId: bag.id });
    emit();
    void loadWorkflowNumbers(s);
  }

  async function createBag(): Promise<Session> {
    const at = nowIso();
    const bag: Bag = {
      id: deps.newId('bag'),
      name: 'New bag',
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
    const conversation: ConversationRecord = {
      id: bag.conversationId,
      bagId: bag.id,
      apiMessages: [],
      uiMessages: [message(deps.newId('msg'), 'assistant', [{ kind: 'text', text: NEW_BAG_PROMPT }], at)],
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
      try {
        const answer = await api.loadProfileOnMachine(profile);
        if (answer === 'unsupported') barrierSupported = false;
        outcome = { status: answer === 'loaded' ? 'loaded' : answer === 'offline' ? 'waiting' : 'assumed' };
      } catch (error) {
        outcome = { status: 'failed', reason: describe(error) };
      }
      hideProgress(progressId);
    }
    setMachineLoad(versionId, outcome.status);
    if (outcome.status === 'loaded' || outcome.status === 'assumed') uploadFailedFor = null;
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

  /** `onMachine` for the model: only what the barrier confirmed (or, without one, a connected machine). */
  function onMachine(outcome: LoadOutcome): boolean {
    return outcome.status === 'loaded' || (outcome.status === 'assumed' && telemetry.getState().machineConnected);
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
      if (workflow.profile) {
        setLoadProblem(version.id, `The machine is running "${workflow.profile.title}", not ${version.title}. Tap Retry to load it.`);
      }
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

  async function handleShotFinished(shotId: string | null, started: ShotStart | null = null): Promise<void> {
    const s = session;
    if (!s) return;
    const current = activeVersion(s);
    if (!current) {
      addMessage('system', [noticePart('info', 'Pick a starting profile first; that shot is not part of this dial-in.')]);
      await persistConversation(s);
      emit();
      return;
    }
    // Decaid just reported a shot: writes that wait go out now (D64).
    void outbox.flush();
    // A new shot (or Retry) replaces the hunt for the previous one.
    clearStanding('shot');
    if (state.error === SHOT_NOT_SAVED) setError(null);
    state = { ...state, busy: true };
    emit();
    try {
      await creditShot(s, current, shotId, started);
    } finally {
      state = { ...state, busy: false };
      emit();
    }
  }

  async function creditShot(s: Session, current: ProfileVersion, shotId: string | null, started: ShotStart | null): Promise<void> {
    const record = await fetchShot(shotId);
    if (!record) {
      // Typically the machine dropped mid-shot. Decaid may still save the
      // record later (after a reconnect), so Retry looks for it again.
      const dropped = !telemetry.getState().machineConnected;
      addMessage('system', [
        noticePart(
          'warning',
          dropped
            ? 'The machine disconnected during that shot, and Decaid has no record of it. When the machine is back, tap Retry to look again, or pull another shot.'
            : 'The shot finished, but Decaid has not saved it. Tap Retry to look again, or pull another shot.',
        ),
      ]);
      replaceStanding({ kind: 'shot', message: SHOT_NOT_SAVED, retry: () => handleShotFinished(shotId, started) });
      await persistConversation(s);
      return;
    }
    const iterations = await bagIterations(s);
    if (iterations.some((i) => i.shotId === record.id)) return;
    if (record.workflow?.profile && !ranVersion(record.workflow, current)) {
      // The machine ran something else (another bag's profile, or a load that
      // failed): crediting this shot to the active version would corrupt the dial-in.
      addMessage('system', [
        noticePart(
          'warning',
          `That shot ran "${record.workflow.profile.title}", not ${current.title}, so it is not part of this dial-in.`,
        ),
      ]);
      setLoadProblem(current.id, `The machine is not running ${current.title}. Tap Retry to load it.`);
      await persistConversation(s);
      return;
    }
    if (startedBeforeLoad(started, current)) {
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
    const at = nowIso();
    await putIteration({
      id: deps.newId('iter'),
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
    const template = coach.getTemplate(current.templateId);
    const block = shotCompletedBlock({
      shotRef: 'latest',
      shotId: record.id,
      version: current.version,
      templateId: current.templateId,
      levers: template ? coach.readLeverValues(template, current.profile) : {},
      doseG: summary.doseG ?? s.doseG,
      targetYieldG: summary.targetYieldG ?? s.targetYieldG,
      grinder: { name: settings.grinderName, setting: settings.grinderSetting },
      summary: summaryForModel(summary),
    });
    emit();
    await sendUser(s, new Map(), UNANSWERED_SHOT, [block]);
  }

  // -------------------------------------------------------------------------
  // Controller
  // -------------------------------------------------------------------------

  function requireCall(s: Session, requestId: string, name: ToolName): PendingCall | null {
    return s.pending.find((p) => p.id === requestId && p.name === name) ?? null;
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

    const title = coach.versionTitle(s.bag.name, 1);
    const profile = coach.buildVersionProfile(template, template.profile, title, s.bag.name);
    const versionId = deps.newId('ver');
    let decaidProfileId: string | null = null;
    let uploaded = true;
    let note: string | null = null;
    let workflow: Workflow | null = null;
    try {
      const created = await api.createProfileVersion({
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
    let onMachineNow = false;
    if (workflow) {
      const outcome = await confirmOnMachine(version.id, title, workflow.profile);
      reportLoad(version.id, title, outcome);
      onMachineNow = onMachine(outcome);
      if (outcome.status === 'failed') note = note ? `${note} ${outcome.reason}` : outcome.reason;
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
      uploaded,
      onMachine: onMachineNow,
      note,
    };
    const answers = new Map([[call.id, toolResult(call.id, picked)]]);
    await sendUser(s, answers, UNANSWERED_TEXT, []);
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
   * At start-up, say so when the machine runs something other than the active
   * bag's version (another skin, or a profile picked on the machine). Loading
   * it is left to the user's Retry: opening CafAI alone never changes the machine.
   */
  async function checkMachineProfile(): Promise<void> {
    const s = session;
    const version = activeVersion(s);
    if (!s || !version) return;
    try {
      const workflow = await api.getWorkflow();
      if (!workflow.profile || carriesVersion(workflow, version)) return;
      setLoadProblem(version.id, `The machine is running "${workflow.profile.title}", not ${version.title}. Tap Retry to load it.`);
      emit();
    } catch {
      // Decaid unreachable: nothing to compare yet.
    }
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
    const iteration = await latestPendingIteration(s);
    if (iteration) {
      await putIteration({
        ...iteration,
        feedback: { question: (call.input as AskUser).question, selected, otherText: other },
      });
      noteTaste(s, iteration, selected, other);
    }
    const answers = new Map([[call.id, toolResult(call.id, { selected, other })]]);
    await sendUser(s, answers, { answered: false, note: 'Not answered.' }, []);
  }

  async function confirmChange(requestId: string): Promise<void> {
    const s = session;
    if (!s) return;
    const call = requireCall(s, requestId, TOOL.proposeAdjustment);
    const plan = call?.plan;
    if (!call || !plan) return;
    const input = call.input as ProposeAdjustment;
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
        // When the move names the new dial setting, the next shots carry it,
        // in CafAI and in Decaid's workflow context. A relative move ("1 step
        // finer") leaves the stored setting as the user last entered it. The
        // dial is turned by hand, so an unreachable Decaid does not block the
        // confirm; the outbox sends the setting once Decaid is back (D64).
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
    } catch (error) {
      // Nothing changed in Decaid (a shot was running, Decaid refused): keep
      // the proposal open so Confirm can simply be tapped again.
      const reason = describe(error);
      setMessages(setDiffStatus(state.messages, requestId, 'pending', reason));
      state = { ...state, busy: false };
      setError(`The change was not loaded: ${reason}`, () => confirmChange(requestId));
      emit();
      return;
    }
    // Applied: the version exists and is active even if the machine has not
    // confirmed it yet; CafAI's own notice and banner say so (D55).
    let onMachineNow: boolean | null = null;
    if (loading && title) {
      const outcome = await confirmOnMachine(loading.versionId, title, loading.profile);
      reportLoad(loading.versionId, title, outcome);
      onMachineNow = onMachine(outcome);
    }
    const payload: AdjustmentResultPayload = {
      applied: true,
      variable: plan.variable,
      version: versionNumber,
      title,
      onMachine: onMachineNow,
    };
    state = { ...state, busy: false };
    emit();
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, []);
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
    await sendUser(s, new Map([[call.id, toolResult(call.id, payload)]]), { answered: false, note: 'Not answered.' }, []);
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
    const applied = [...iterations]
      .reverse()
      .find((i) => i.outcome === 'applied' && i.profileVersionId === parent.id);
    if (applied) await putIteration({ ...applied, outcome: 'undone' });
    setMessages(
      updatePart(
        state.messages,
        (part) => part.kind === 'diff' && part.status === 'applied' && part.versionLabel === current.title,
        (part) => (part.kind === 'diff' ? { ...part, status: 'undone' } : part),
      ),
    );
    addMessage('system', [noticePart('info', `Back on ${parent.title}.`)]);
    reportLoad(parent.id, parent.title, await confirmOnMachine(parent.id, parent.title, workflow.profile));
    state = { ...state, busy: false };
    emit();
    await sendUser(s, new Map(), { answered: false, note: 'The user undid the last change.' }, [
      undoBlock({ from: current.version, to: parent.version, title: parent.title }),
    ]);
  }

  async function rateShot(shotId: string, stars: number): Promise<void> {
    const s = session;
    if (!s || !Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const card = state.messages.flatMap((m) => m.parts).find((p) => p.kind === 'shot' && p.shotId === shotId);
    if (!card || card.kind !== 'shot' || card.stars === stars) return;
    // On the card, so it comes back with the transcript; to the coach, never.
    setMessages(setShotStars(state.messages, shotId, stars));
    await persistConversation(s);
    emit();
    void queueShotWrite(shotId, { stars });
  }

  async function sendText(text: string): Promise<void> {
    const typed = text.trim();
    if (!typed) return;
    const s = session ?? (await createBag());
    // A pasted API key never reaches the coach, the transcript or Decaid.
    const trimmed = redactKeyLike(typed, '[API key removed]');
    addMessage('user', [{ kind: 'text', text: trimmed }]);
    if (trimmed !== typed) {
      addMessage('system', [noticePart('info', 'That looked like an API key, so CafAI took it out. Keys go in Settings.')]);
    }
    emit();
    const tasteQuestion = s.pending.find((p) => p.name === TOOL.askUser);
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
      const blocks = intakeBlocks(trimmed, {
        grinder: { name: settings.grinderName, setting: settings.grinderSetting },
        scaleConnected: telemetry.getState().scaleConnected,
      });
      await sendUser(s, new Map(), UNANSWERED_TEXT, blocks);
    } else {
      await sendUser(s, new Map(), UNANSWERED_TEXT, [textBlock(trimmed)]);
    }
  }

  async function refreshFromStorage(): Promise<void> {
    settings = await storage.settings.get();
    state = { ...state, hasApiKey: Boolean(await storage.secrets.getApiKey()) };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async start() {
      await refreshFromStorage();
      const bags = (await storage.bags.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      state = { ...state, bags };
      const active = bags.find((b) => b.id === settings.activeBagId);
      if (active) await openSession(active);
      state = { ...state, ready: true };
      unsubscribeShot = telemetry.onShot((event) => {
        // How far the version had got matters at the start, not when the shot is handled.
        if (event.type === 'started') {
          shotStart = { shotId: event.shotId, early: earlyLoad() };
          return;
        }
        const started = takeShotStart(event.shotId);
        void enqueue(() => handleShotFinished(event.shotId, started));
      });
      // React only to reports that arrive while CafAI runs, not a stale one.
      let lastError = telemetry.getState().connectionError;
      let machineWasConnected = telemetry.getState().machineConnected;
      let devicesSocket = telemetry.getState().sockets.devices;
      unsubscribeTelemetry = telemetry.subscribe(() => {
        const now = telemetry.getState();
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
      emit();
      void enqueue(checkMachineProfile);
    },
    dispose() {
      unsubscribeShot?.();
      unsubscribeTelemetry?.();
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
        await createBag();
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
    rateShot: (shotId, stars) => enqueue(() => rateShot(shotId, stars)),
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
        const before = settings;
        await refreshFromStorage();
        const grinderChanged = settings.grinderName !== before.grinderName || settings.grinderSetting !== before.grinderSetting;
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
        emit();
        if (waitedForKey && session && awaitingModel(session.conversation.apiMessages)) await runModel();
      }),
  };
}

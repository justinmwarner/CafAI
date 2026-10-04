/**
 * The coach engine: turns app events (new bag, a tap, a finished shot, a
 * confirm or undo) into conversation turns, uploads, and stored records.
 *
 * - One bag = one conversation with an append-only API transcript.
 * - UI tools (template cards, option chips, the change diff) stop the model
 *   run; the user's tap answers them as tool_results in the next user turn.
 * - Every change to the machine is an explicit tap; nothing here uploads a
 *   profile on its own.
 * - Engine actions are serialized, so a shot that finishes mid-reply is
 *   handled after the reply, never interleaved with it.
 * - Everything is persisted as it happens (the WebView may be unloaded after
 *   ten minutes in the background without warning).
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
import type { ShotRecord, TelemetryStore, WireProfile, WorkflowContext } from '../../api/types.ts';
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
import type { CoachController, CoachPhase, CoachState, CoachUiMessage, TemplateCardItem } from '../types.ts';
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
} from './protocol.ts';
import {
  NEW_BAG_PROMPT,
  appendText,
  byRequestId,
  diffPart,
  finishStreaming,
  message,
  noticePart,
  optionsPart,
  setDiffStatus,
  shotPart,
  templatesPart,
  updatePart,
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

const DEFAULT_YIELD_G = 36;
const STREAM_EMIT_MS = 50;
/** The banner while a finished shot has no record in Decaid (Retry looks again). */
const SHOT_NOT_SAVED = 'Decaid has not saved that shot yet.';

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
  /** A version CafAI considers active but that may not be on the machine (a failed load, or a shot that ran something else). */
  let loadProblem: { versionId: string; message: string } | null = null;
  const shotCache = new Map<string, ShotRecord>();
  const listeners = new Set<() => void>();
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeShot: (() => void) | null = null;
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
    if (!activeVersion(s)) return 'intake';
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
    if (!state.error && loadProblem && !state.busy) {
      const versionId = loadProblem.versionId;
      state = { ...state, error: loadProblem.message };
      lastFailed = () => retryActivation(versionId);
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
    s.conversation = { ...s.conversation, uiMessages: state.messages, updatedAt: nowIso() };
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
    const t = telemetry.getState();
    const shot = t.shotState?.state;
    return t.machine?.state.state === 'espresso' || shot === 'preheating' || shot === 'pouring' || shot === 'stopping';
  }

  function workflowContext(s: Session, profile: ProfileJson, patch: ChangePlan['contextPatch'] = {}): WorkflowContext {
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
    return context;
  }

  /** True when a profile (from the workflow or a shot record) is this version. */
  function runsVersion(profile: WireProfile | ProfileJson | undefined, version: ProfileVersion): boolean {
    if (!profile) return false;
    if (profile.title === version.title) return true;
    try {
      return coach.profileId(profile) === coach.profileId(version.profile);
    } catch {
      return false;
    }
  }

  /**
   * True when the workflow carries this version exactly as CafAI loads it:
   * same title and same brewing content. Two bags whose v1 use the same
   * template have identical content, so content alone would leave the other
   * bag's title and coffee details on the machine.
   */
  function carriesVersion(profile: WireProfile | ProfileJson | undefined, version: ProfileVersion): boolean {
    if (!profile || profile.title !== version.title) return false;
    try {
      return coach.profileId(profile) === coach.profileId(version.profile);
    } catch {
      return false;
    }
  }

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
        await persistBag(s, {
          name: details.name.trim(),
          roaster: details.roaster,
          origin: details.origin,
          roastLevel: details.roastLevel,
          process: details.process,
          notes: details.notes,
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
    state = { ...state, messages: conversation.uiMessages, error: null };
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

  /** Upload a version's profile and make it the workflow's profile. */
  async function activate(s: Session, profile: ProfileJson, patch?: ChangePlan['contextPatch']): Promise<void> {
    if (isShotRunning()) throw new Error('Wait for the shot to finish, then try again.');
    const context = workflowContext(s, profile, patch);
    await api.activateProfile(profile, context, { shotRunning: false });
    if (context.targetYield !== undefined) s.targetYieldG = context.targetYield;
    if (context.targetDoseWeight !== undefined) s.doseG = context.targetDoseWeight;
  }

  // -------------------------------------------------------------------------
  // Shot finished
  // -------------------------------------------------------------------------

  /**
   * Decaid saves the record a moment after the shot ends. Ask again with a
   * doubling delay (0.5 s to 8 s by default, about 15 s in all), so a shot that
   * is never saved costs a handful of requests rather than a steady stream.
   */
  async function fetchShot(shotId: string | null): Promise<ShotRecord | null> {
    let delayMs = shotFetch.delayMs;
    for (let attempt = 0; attempt < shotFetch.attempts; attempt++) {
      try {
        if (shotId) return await api.getShot(shotId);
        const latest = await api.getLatestShot();
        if (latest) return await api.getShot(latest.id);
      } catch {
        // Not saved yet; ask again.
      }
      if (attempt < shotFetch.attempts - 1) {
        await clock.sleep(delayMs);
        delayMs *= 2;
      }
    }
    return null;
  }

  async function handleShotFinished(shotId: string | null): Promise<void> {
    const s = session;
    if (!s) return;
    const current = activeVersion(s);
    if (!current) {
      addMessage('system', [noticePart('info', 'Pick a starting profile first; that shot is not part of this dial-in.')]);
      await persistConversation(s);
      emit();
      return;
    }
    if (state.error === SHOT_NOT_SAVED) setError(null);
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
      setError(SHOT_NOT_SAVED, () => handleShotFinished(shotId));
      await persistConversation(s);
      emit();
      return;
    }
    const iterations = await bagIterations(s);
    if (iterations.some((i) => i.shotId === record.id)) return;
    if (record.workflow?.profile && !runsVersion(record.workflow.profile, current)) {
      // The machine ran something else (another bag's profile, or a load that
      // failed): crediting this shot to the active version would corrupt the dial-in.
      addMessage('system', [
        noticePart(
          'warning',
          `That shot ran "${record.workflow.profile.title}", not ${current.title}, so it is not part of this dial-in.`,
        ),
      ]);
      loadProblem = { versionId: current.id, message: `The machine is not running ${current.title}. Tap Retry to load it.` };
      await persistConversation(s);
      emit();
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
      emit();
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
    let decaidProfileId: string | null = null;
    let uploaded = true;
    let note: string | null = null;
    try {
      const created = await api.createProfileVersion({
        profile,
        metadata: { source: 'cafai', bagId: s.bag.id, version: 1, templateId },
      });
      decaidProfileId = created.record.id;
      if (created.deduped) note = 'Decaid already had this exact profile and kept its library entry; the machine shows the new title.';
      await activate(s, profile);
    } catch (error) {
      uploaded = false;
      note = describe(error);
    }
    const version: ProfileVersion = {
      id: deps.newId('ver'),
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
    if (uploaded) loadProblem = null;
    else loadProblem = { versionId: version.id, message: `Could not load ${title} on the machine. Tap Retry to try again.` };
    addMessage('system', [
      uploaded ? loadedNotice(title) : noticePart('error', `${title} is saved, but loading it on the machine failed: ${note}`),
    ]);
    state = { ...state, busy: false };
    emit();
    const answers = new Map([[call.id, toolResult(call.id, { picked: templateId, version: 1, title, uploaded, note })]]);
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
      if (carriesVersion(workflow.profile, version)) return;
      await activate(s, version.profile);
      addMessage('system', [loadedNotice(version.title)]);
    } catch (error) {
      loadProblem = { versionId: version.id, message: `Could not load ${version.title}: ${describe(error)}` };
    }
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
      if (!workflow.profile || carriesVersion(workflow.profile, version)) return;
      loadProblem = {
        versionId: version.id,
        message: `The machine is running "${workflow.profile.title}", not ${version.title}. Tap Retry to load it.`,
      };
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
      await activate(s, version.profile);
      loadProblem = null;
      addMessage('system', [loadedNotice(version.title)]);
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
    const other = otherText?.trim() || null;
    setMessages(
      updatePart(state.messages, byRequestId(requestId), (part) =>
        part.kind === 'options' ? { ...part, answer: { selected, otherText: other } } : part,
      ),
    );
    const said = [...selected.filter((o) => !(other && o === 'Other')), ...(other ? [other] : [])].join(', ');
    if (said) addMessage('user', [{ kind: 'text', text: said }]);
    emit();
    const iteration = await latestPendingIteration(s);
    if (iteration) {
      await putIteration({
        ...iteration,
        feedback: { question: (call.input as AskUser).question, selected, otherText: other },
      });
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

    let payload: AdjustmentResultPayload;
    try {
      let versionNumber: number | null = null;
      let title: string | null = null;
      const current = activeVersion(s);
      if (plan.createsVersion && plan.newProfile && current) {
        const template = coach.getTemplate(current.templateId);
        if (!template) throw new Error('The template of the active version is missing.');
        versionNumber = Math.max(...s.versions.map((v) => v.version)) + 1;
        title = coach.versionTitle(s.bag.name, versionNumber);
        const profile = coach.buildVersionProfile(template, plan.newProfile, title, s.bag.name);
        const created = await api.createProfileVersion({
          profile,
          ...(current.decaidProfileId ? { parentId: current.decaidProfileId } : {}),
          metadata: { source: 'cafai', bagId: s.bag.id, version: versionNumber, templateId: template.id },
        });
        await activate(s, profile, plan.contextPatch);
        const change: AppliedChange = {
          variable: plan.variable,
          lever: plan.leverId,
          from: plan.from,
          to: plan.to,
          diffLines: plan.diffLines,
          summary: plan.summary || input.summary,
        };
        const next: ProfileVersion = {
          id: deps.newId('ver'),
          bagId: s.bag.id,
          version: versionNumber,
          title,
          templateId: template.id,
          profile,
          decaidProfileId: created.record.id,
          parentVersionId: current.id,
          change,
          status: 'active',
          createdAt: nowIso(),
        };
        await saveVersions(s, [{ ...current, status: 'superseded' }, next]);
        await persistBag(s, { activeVersionId: next.id });
      } else if (plan.variable === 'dose' && plan.to !== null) {
        await api.updateWorkflow({ context: { targetDoseWeight: plan.to } });
        s.doseG = plan.to;
      } else if (plan.variable === 'grind') {
        // When the move names the new dial setting, the next shots carry it,
        // in CafAI and in Decaid's workflow context. A relative move ("1 step
        // finer") leaves the stored setting as the user last entered it.
        const setting = plan.contextPatch.grinderSetting ?? input.grind?.setting ?? null;
        if (setting) {
          await api.updateWorkflow({ context: { grinderSetting: setting } });
          settings = await storage.settings.update({ grinderSetting: setting });
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
      if (title) {
        loadProblem = null;
        addMessage('system', [loadedNotice(title)]);
      }
      payload = { applied: true, variable: plan.variable, version: versionNumber, title };
    } catch (error) {
      // Nothing changed on the machine (a shot was running, Decaid refused):
      // keep the proposal open so Confirm can simply be tapped again.
      const reason = describe(error);
      setMessages(setDiffStatus(state.messages, requestId, 'pending', reason));
      state = { ...state, busy: false };
      setError(`The change was not loaded: ${reason}`, () => confirmChange(requestId));
      emit();
      return;
    }
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
    try {
      await activate(s, parent.profile);
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
    loadProblem = null;
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
    state = { ...state, busy: false };
    emit();
    await sendUser(s, new Map(), { answered: false, note: 'The user undid the last change.' }, [
      undoBlock({ from: current.version, to: parent.version, title: parent.title }),
    ]);
  }

  async function sendText(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const s = session ?? (await createBag());
    addMessage('user', [{ kind: 'text', text: trimmed }]);
    emit();
    const tasteQuestion = s.pending.find((p) => p.name === TOOL.askUser);
    if (tasteQuestion) {
      const iteration = await latestPendingIteration(s);
      if (iteration && !iteration.feedback) {
        await putIteration({
          ...iteration,
          feedback: { question: (tasteQuestion.input as AskUser).question, selected: [], otherText: trimmed },
        });
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
        if (event.type === 'finished') void enqueue(() => handleShotFinished(event.shotId));
      });
      emit();
      void enqueue(checkMachineProfile);
    },
    dispose() {
      unsubscribeShot?.();
      if (emitTimer) clearTimeout(emitTimer);
      listeners.clear();
    },
    newBag: () =>
      enqueue(async () => {
        const current = session;
        if (current && current.conversation.apiMessages.length === 0 && !current.bag.templateId) return;
        loadProblem = null;
        await createBag();
      }),
    selectBag: (bagId) =>
      enqueue(async () => {
        const bag = await storage.bags.get(bagId);
        if (!bag) return;
        loadProblem = null;
        await openSession(bag);
        await loadActiveVersionIfNeeded();
      }),
    sendText: (text) => enqueue(() => sendText(text)),
    pickTemplate: (requestId, templateId) => enqueue(() => pickTemplate(requestId, templateId)),
    answerOptions: (requestId, selected, otherText) => enqueue(() => answerOptions(requestId, selected, otherText)),
    confirmChange: (requestId) => enqueue(() => confirmChange(requestId)),
    declineChange: (requestId) => enqueue(() => declineChange(requestId)),
    undo: () => enqueue(() => undo()),
    retry: () =>
      enqueue(async () => {
        const task = lastFailed;
        if (!task) return;
        setError(null);
        emit();
        await task();
      }),
    dismissError() {
      // Dismissing also drops a pending load problem, which would otherwise
      // put the banner straight back; a mismatched shot raises it again.
      loadProblem = null;
      setError(null);
      emit();
    },
    refresh: () =>
      enqueue(async () => {
        await refreshFromStorage();
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
        const waitedForKey = state.hasApiKey && Boolean(state.error?.startsWith('Add your Anthropic API key'));
        if (waitedForKey) setError(null);
        emit();
        if (waitedForKey && session && awaitingModel(session.conversation.apiMessages)) await runModel();
      }),
  };
}

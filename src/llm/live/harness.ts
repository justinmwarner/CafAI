/**
 * The network-free half of the live API smoke test (anthropic.live.ts): when
 * it runs, the coach's tools built the way the engine builds them, the turn
 * the engine sends after a template pick, the contract checks, a hard cap on
 * model calls, and a scrubber that keeps the API key out of every failure.
 *
 * `npm test` never runs the live suite: *.live.ts is outside the unit include,
 * and only vitest.live.config.ts provides LIVE_SUITE_FLAG.
 */
import {
  UNANSWERED_TEXT,
  toolResult,
  unansweredToolUses,
  userMessage,
  type TemplatePickedPayload,
} from '../../app/engine/protocol.ts';
import { AUTO_TOOLS, TEMPLATE_IDS, TOOL, TOOL_INPUTS, type ProposeTemplates, type ToolName } from '../../coach/contract.ts';
import { COACH_TOOL_SPECS, getTemplate, startingYield, versionTitle } from '../../coach/index.ts';
import { redactKeyLike } from '../../storage/redact.ts';
import { describeIssues, toToolDefinition, zodValidator } from '../schema.ts';
import {
  LlmError,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
  type RunnerTool,
  type ToolOutcome,
  type ToolResultBlock,
} from '../types.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** True only under vitest.live.config.ts. */
    cafaiLiveSuite?: boolean;
  }
}

export const LIVE_SUITE_FLAG = 'cafaiLiveSuite';

// ---------------------------------------------------------------------------
// When to run
// ---------------------------------------------------------------------------

export interface LiveMode {
  /** `skip`: every check is reported as skipped. `dry-run`: the scripted fake over MSW. `live`: the real API. */
  kind: 'skip' | 'dry-run' | 'live';
  /** Why the suite is skipped; empty otherwise. Never holds the key. */
  reason: string;
  /** Check 3: one tiny request per model in the Settings picker. */
  allModels: boolean;
}

const OFF_WORDS: readonly string[] = ['', '0', 'false', 'no', 'off'];

/**
 * A dry run costs nothing, so it wins over a key and any value but an off
 * word turns it on. The extra paid requests of check 3 need exactly
 * LIVE_ALL_MODELS=1. Outside the live config nothing runs, whatever the
 * environment says: many machines set ANTHROPIC_API_KEY for other tools.
 */
export function liveMode(env: Readonly<Record<string, string | undefined>>, underLiveConfig: boolean): LiveMode {
  if (!underLiveConfig) return { kind: 'skip', reason: 'the live suite runs only with npm run test:live', allModels: false };
  const allModels = (env.LIVE_ALL_MODELS ?? '').trim() === '1';
  if (!OFF_WORDS.includes((env.LIVE_DRY_RUN ?? '').trim().toLowerCase())) return { kind: 'dry-run', reason: '', allModels };
  if ((env.ANTHROPIC_API_KEY ?? '').trim() !== '') return { kind: 'live', reason: '', allModels };
  return { kind: 'skip', reason: 'ANTHROPIC_API_KEY is not set', allModels: false };
}

// ---------------------------------------------------------------------------
// Keeping the key out of the output
// ---------------------------------------------------------------------------

export const KEY_MARK = '[key]';

/**
 * The text with the key replaced by [key], and with anything shaped like an
 * Anthropic key too (an older key, or the start of one, echoed back). The key
 * is matched trimmed, as the client sends it, and literally, never as a regex.
 */
export function scrubKey(text: string, key: string | null | undefined): string {
  const secret = (key ?? '').trim();
  const exact = secret === '' ? text : text.split(secret).join(KEY_MARK);
  return redactKeyLike(exact, KEY_MARK);
}

/**
 * One line for a failed call: the error kind, the HTTP status and the message
 * (for a rejected request, the API's own words). Nothing else from the error
 * is kept, so no cause or request detail can carry a header into the output.
 */
export function describeFailure(error: unknown, key: string | null | undefined): string {
  let text: string;
  if (error instanceof LlmError) text = `${error.kind}${error.status > 0 ? ` (HTTP ${error.status})` : ''}: ${error.message}`;
  else if (error instanceof Error) text = `${error.name}: ${error.message}`;
  else if (typeof error === 'string') text = error;
  else text = 'A non-error value was thrown.';
  return scrubKey(text, key);
}

export type Settled<T> = { ok: true; value: T } | { ok: false; failure: string };

/** Run one call; a failure comes back as a scrubbed line for the assertion message instead of a thrown error. */
export async function settle<T>(work: () => Promise<T>, key: string | null | undefined): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, failure: describeFailure(error, key) };
  }
}

// ---------------------------------------------------------------------------
// The coach's tools, as src/app/engine/engine.ts builds them
// ---------------------------------------------------------------------------

/** What the query stubs answer: the live suite has no shots to read. */
export const NO_SHOTS_YET = 'No shots yet for this bag.';

const CATALOG: readonly string[] = TEMPLATE_IDS;

/** The engine's own check on suggestions that passed zod (engine.ts domainError). */
function templateProblem(value: ProposeTemplates): string | null {
  const ids = value.suggestions.map((s) => s.templateId);
  const unknown = ids.filter((id) => !CATALOG.includes(id));
  if (unknown.length > 0) return `Unknown template id ${unknown.join(', ')}. Use only: ${CATALOG.join(', ')}.`;
  if (new Set(ids).size !== ids.length) return 'Suggest each template at most once.';
  return null;
}

function stubOutcome(name: ToolName): ToolOutcome {
  return name === TOOL.saveBagDetails ? { content: JSON.stringify({ saved: true }) } : { content: NO_SHOTS_YET, isError: true };
}

/**
 * The nine contract tools in TOOL order: strict definitions with the coach's
 * descriptions, zod validation plus the engine's template-id check, `auto`
 * stubs for AUTO_TOOLS and `ui` for the rest. propose_adjustment gets zod
 * only: the engine's bounds check needs an active version and the suite never
 * gets that far.
 */
export function coachRunnerTools(): RunnerTool[] {
  return (Object.values(TOOL) as ToolName[]).map((name) => {
    const schema = TOOL_INPUTS[name];
    const parse = zodValidator(schema);
    const auto = AUTO_TOOLS.includes(name);
    const tool: RunnerTool = {
      definition: toToolDefinition(name, COACH_TOOL_SPECS[name].description, schema),
      kind: auto ? 'auto' : 'ui',
      validate(input) {
        const parsed = parse(input);
        if (!parsed.ok || name !== TOOL.proposeTemplates) return parsed;
        const problem = templateProblem(parsed.value as ProposeTemplates);
        return problem === null ? parsed : { ok: false, error: problem };
      },
    };
    if (auto) tool.execute = () => Promise.resolve(stubOutcome(name));
    return tool;
  });
}

// ---------------------------------------------------------------------------
// Checking what the model sent
// ---------------------------------------------------------------------------

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_INPUTS, name);
}

/** Every tool call in the assistant turns that is not a CafAI tool or whose input fails its zod schema. */
export function contractProblems(messages: readonly LlmMessage[]): string[] {
  const problems: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;
      if (!isToolName(block.name)) {
        problems.push(`${block.name}: not a CafAI tool`);
        continue;
      }
      const parsed = TOOL_INPUTS[block.name].safeParse(block.input);
      if (!parsed.success) problems.push(`${block.name}: ${describeIssues(parsed.error.issues)}`);
    }
  }
  return problems;
}

/**
 * The tool results that went (or would go) back to the model as errors: a
 * rejected input, unparsable JSON, an unknown tool, a cut-off turn. The query
 * stubs' "no shots yet" is expected and left out.
 */
export function errorResults(messages: readonly LlmMessage[], held: readonly ToolResultBlock[] = []): string[] {
  const names = new Map<string, string>();
  const results: ToolResultBlock[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') names.set(block.id, block.name);
      else if (block.type === 'tool_result') results.push(block);
    }
  }
  return [...results, ...held]
    .filter((result) => result.is_error === true && result.content !== NO_SHOTS_YET)
    .map((result) => `${names.get(result.tool_use_id) ?? result.tool_use_id}: ${result.content}`);
}

// ---------------------------------------------------------------------------
// The turn the engine sends after a template tap (ENGINE_PROTOCOL rule 2)
// ---------------------------------------------------------------------------

/** The bag name the engine would hold: the last valid save_bag_details, else its default. */
export function bagNameOf(messages: readonly LlmMessage[]): string {
  let name = 'New bag';
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_use' || block.name !== TOOL.saveBagDetails) continue;
      const parsed = TOOL_INPUTS[TOOL.saveBagDetails].safeParse(block.input);
      if (parsed.success) name = parsed.data.name;
    }
  }
  return name;
}

/**
 * A successful pick, exactly as the engine sends it when Decaid has no dose:
 * v1 stops at the template's start ratio times the 18 g reference (D57), and
 * is saved and loaded on a connected machine.
 */
export function templatePickedPayload(templateId: string, bagName: string): TemplatePickedPayload {
  const template = getTemplate(templateId);
  if (!template) throw new Error(`No template ${templateId} in the catalog.`);
  return {
    picked: templateId,
    version: 1,
    title: versionTitle(bagName, 1),
    yieldG: startingYield(template, null),
    doseG: null,
    uploaded: true,
    onMachine: true,
    loadError: null,
    note: null,
  };
}

/**
 * One tool_result per call of the last assistant turn, in tool_use order: the
 * held automatic results, the pick, and "the user typed instead" for any other
 * UI call, exactly as engine.ts sendUser builds it.
 */
export function templatePickedTurn(
  transcript: readonly LlmMessage[],
  held: readonly ToolResultBlock[],
  pickId: string,
  payload: TemplatePickedPayload,
): LlmMessage {
  const uses = unansweredToolUses(transcript);
  if (!uses.some((use) => use.id === pickId)) throw new Error(`No pending tool call ${pickId} to answer.`);
  const answers = new Map<string, ToolResultBlock>(held.map((result) => [result.tool_use_id, result]));
  answers.set(pickId, toolResult(pickId, payload));
  return userMessage(uses.map((use) => answers.get(use.id) ?? toolResult(use.id, UNANSWERED_TEXT)));
}

// ---------------------------------------------------------------------------
// Spend and what went over the wire
// ---------------------------------------------------------------------------

export interface CallBudget {
  readonly provider: LlmProvider;
  /** Model requests started so far. */
  readonly used: number;
  readonly remaining: number;
}

/**
 * A provider that refuses to start a request past `max`, so the suite's spend
 * has a ceiling whatever the model does. A request counts when it starts (the
 * client is lazy too); the client's own retries of an unbilled 429, 5xx or 529
 * stay inside that one request, as in the app.
 */
export function withCallBudget(provider: LlmProvider, max: number): CallBudget {
  let used = 0;
  async function* stream(request: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (used >= max) throw new Error(`The live suite makes at most ${max} API calls here, and the model asked for another.`);
    used += 1;
    yield* provider.stream(request);
  }
  return {
    provider: { id: provider.id, stream },
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, max - used);
    },
  };
}

export interface BodyRecorder {
  /** Each request body sent, in order. Bodies only: the key travels in a header. */
  readonly bodies: readonly string[];
  readonly fetch: typeof globalThis.fetch;
}

/** A fetch for the provider's `fetch` option that remembers what the client sent. */
export function recordBodies(): BodyRecorder {
  const bodies: string[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === 'string') bodies.push(init.body);
    // Looked up per call: in the dry run MSW replaces the global fetch after start-up.
    return globalThis.fetch(input, init);
  };
  return { bodies, fetch };
}

/** The `messages` of a request body, serialized as the client serialized them; null when it has none. */
export function sentMessagesJson(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const messages = (parsed as { messages?: unknown }).messages;
  return Array.isArray(messages) ? JSON.stringify(messages) : null;
}

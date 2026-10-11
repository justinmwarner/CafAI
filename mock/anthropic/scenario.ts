/**
 * The scripted fake coach: a pure function from a Messages API request to the
 * streamed reply (or the error) a real model and API would give, following
 * docs/briefs/ENGINE_PROTOCOL.md ("Scripted fake model") exactly.
 *
 * It also polices the request the way the real API would, so engine bugs show
 * up in dev and tests instead of on a tablet: headers, streaming, tool_choice,
 * strict tools, tool_use / tool_result pairing, assistant prefill, and any
 * assistant turn it produced coming back modified (append-only history).
 *
 * The script decides; a voice (voice.ts) words it. The terse voice is the
 * default; the demo voice (demoVoice.ts) writes fuller prose around the same
 * tool calls.
 */
import { EVENT, TEMPLATE_IDS, TOOL, toRoastLevel, type ProposeAdjustment, type RoastLevel } from '../../src/coach/contract.ts';
import { resolveGrindMove } from '../../src/coach/grinder.ts';
import { pourTime } from '../../src/coach/summary/pourClock.ts';
import type { GrinderInfo } from '../../src/coach/types.ts';
import type { StopReason, TextBlock, ToolUseBlock } from '../../src/llm/types.ts';
import { DEMO_VOICE } from './demoVoice.ts';
import { encodeAssistantTurn, type SseMessage } from './sse.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';
import {
  TERSE_VOICE,
  type AppliedFacts,
  type ChangeFacts,
  type ChangeKind,
  type PickFacts,
  type ProposalText,
  type ShotStop,
  type Taste,
  type Voice,
  type VoiceName,
} from './voice.ts';

type Raw = Record<string, unknown>;

interface Message {
  role: string;
  content: Raw[];
}

export interface ScenarioMemory {
  /** Distinguishes ids and signatures across page loads (a reload starts a new memory). */
  readonly session: string;
  /** Assistant turns this fake produced, keyed by the signature of their thinking block. */
  readonly turns: Map<string, Raw[]>;
  /** tool_use id -> signature of the turn that produced it. */
  readonly toolIds: Map<string, string>;
  counter: number;
}

export function createScenarioMemory(options: { session?: string } = {}): ScenarioMemory {
  return {
    session: options.session ?? Date.now().toString(36),
    turns: new Map(),
    toolIds: new Map(),
    counter: 0,
  };
}

export function resetScenarioMemory(memory: ScenarioMemory): void {
  memory.turns.clear();
  memory.toolIds.clear();
  memory.counter = 0;
}

export interface AnthropicErrorBody {
  type: 'error';
  error: { type: string; message: string };
}

export type ScenarioResponse =
  /** `turn`: this reply's number in the memory (1 for the first), the request count. */
  | { status: 200; events: SseMessage[]; content: Raw[]; turn: number }
  | { status: number; errorBody: AnthropicErrorBody };

export interface RespondOptions {
  /** Default 'terse'. */
  voice?: VoiceName;
}

export interface HeaderSource {
  get(name: string): string | null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `[marker]\n{json}` -> the JSON payload, or null. */
function eventPayload(text: string): Raw | null {
  const newline = text.indexOf('\n');
  if (newline < 0) return null;
  const payload = parseJson(text.slice(newline + 1));
  return isRecord(payload) ? payload : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function hash(text: string): string {
  // FNV-1a: deterministic and short; collisions only matter for identical content.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function errorResponse(status: number, type: string, message: string): ScenarioResponse {
  return { status, errorBody: { type: 'error', error: { type, message } } };
}

const invalid = (message: string) => errorResponse(400, 'invalid_request_error', message);

function normalizeMessages(value: unknown): Message[] | null {
  if (!Array.isArray(value)) return null;
  const out: Message[] = [];
  for (const message of value) {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')) return null;
    const content =
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    if (!Array.isArray(content) || !content.every(isRecord)) return null;
    out.push({ role: message.role, content });
  }
  return out;
}

const toolUses = (message: Message | undefined) =>
  (message?.content ?? []).filter((b) => b.type === 'tool_use' && typeof b.id === 'string');
const toolResults = (message: Message | undefined) =>
  (message?.content ?? []).filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string');
const textsOf = (message: Message | undefined) =>
  (message?.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string);

function resultText(block: Raw): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content.filter(isRecord).map((b) => (typeof b.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Request checks
// ---------------------------------------------------------------------------

const IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The API takes images in user turns only, as base64 data of four types: a data URL or anything else is refused. */
function checkImages(messages: Message[]): ScenarioResponse | null {
  for (const [i, message] of messages.entries()) {
    for (const [j, block] of message.content.entries()) {
      if (block.type !== 'image') continue;
      if (message.role !== 'user') return invalid(`messages.${i}.content.${j}: images are only accepted in user messages.`);
      const source = isRecord(block.source) ? block.source : {};
      if (source.type !== 'base64' || typeof source.media_type !== 'string' || !IMAGE_TYPES.includes(source.media_type)) {
        return invalid(`messages.${i}.content.${j}.image.source: expected base64 data of type image/jpeg, image/png, image/gif or image/webp.`);
      }
      if (typeof source.data !== 'string' || !BASE64.test(source.data)) {
        return invalid(`messages.${i}.content.${j}.image.source.data: the image is not valid base64 data.`);
      }
    }
  }
  return null;
}

function checkHeaders(headers: HeaderSource): ScenarioResponse | null {
  if (!(headers.get('content-type') ?? '').includes('application/json')) {
    return invalid('content-type: expected application/json.');
  }
  const key = headers.get('x-api-key') ?? '';
  if (key.trim() === '') return invalid('x-api-key: header is required.');
  if (headers.get('anthropic-version') !== '2023-06-01') return invalid('anthropic-version: expected 2023-06-01.');
  if (headers.get('anthropic-dangerous-direct-browser-access') !== 'true') {
    return invalid('anthropic-dangerous-direct-browser-access: must be "true" for requests from a browser.');
  }
  if (key === 'sk-ant-invalid') return errorResponse(401, 'authentication_error', 'invalid x-api-key');
  if (key === 'sk-ant-overloaded') return errorResponse(529, 'overloaded_error', 'Overloaded');
  return null;
}

function checkBody(body: Raw, messages: Message[], memory: ScenarioMemory): ScenarioResponse | null {
  if (body.stream !== true) return invalid('stream: CafAI must stream replies (expected true).');
  if (typeof body.model !== 'string' || body.model === '') return invalid('model: field required.');
  if (typeof body.max_tokens !== 'number' || !Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
    return invalid('max_tokens: expected a positive integer.');
  }

  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) return invalid('tools: expected a list.');
  for (const [i, tool] of tools.entries()) {
    if (!isRecord(tool) || tool.strict !== true) return invalid(`tools.${i}.strict: every CafAI tool must be strict.`);
  }
  if (tools.length > 0 || body.tool_choice !== undefined) {
    const choice = body.tool_choice;
    if (!isRecord(choice) || choice.type !== 'auto') {
      return invalid('tool_choice: expected {"type":"auto"}; this model rejects forced tool use.');
    }
  }

  if (messages.length === 0) return invalid('messages: at least one message is required.');
  if (messages[messages.length - 1]?.role !== 'user') {
    return invalid('messages: the last message must be a user message (assistant prefill is not supported).');
  }
  const imageError = checkImages(messages);
  if (imageError) return imageError;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role === 'assistant') {
      const ids = toolUses(message).map((b) => b.id as string);
      if (ids.length === 0) continue;
      const next = messages[i + 1];
      const answered = new Set(next?.role === 'user' ? toolResults(next).map((b) => b.tool_use_id) : []);
      const missing = ids.filter((id) => !answered.has(id));
      if (missing.length > 0) {
        return invalid(
          `messages.${i + 1}: tool_use ids were found without tool_result blocks immediately after: ${missing.join(', ')}. ` +
            'Each tool_use block must have a corresponding tool_result block in the next message.',
        );
      }
    } else {
      const results = toolResults(message);
      if (results.length === 0) continue;
      const previous = messages[i - 1];
      const asked = new Set(previous?.role === 'assistant' ? toolUses(previous).map((b) => b.id) : []);
      const unexpected = results.map((b) => b.tool_use_id as string).filter((id) => !asked.has(id));
      if (unexpected.length > 0) {
        return invalid(
          `messages.${i}: unexpected tool_use_id found in tool_result blocks: ${unexpected.join(', ')}. ` +
            'Each tool_result block must have a corresponding tool_use block in the previous message.',
        );
      }
    }
  }

  for (const [i, message] of messages.entries()) {
    if (message.role !== 'assistant') continue;
    const first = message.content[0];
    let signature = first?.type === 'thinking' && typeof first.signature === 'string' ? first.signature : undefined;
    if (signature === undefined || !memory.turns.has(signature)) {
      // A turn whose thinking block was dropped is still recognised by its tool calls.
      signature = toolUses(message)
        .map((b) => memory.toolIds.get(b.id as string))
        .find((s) => s !== undefined);
    }
    const remembered = signature === undefined ? undefined : memory.turns.get(signature);
    if (remembered !== undefined && !deepEqual(remembered, message.content)) {
      return invalid(
        `messages.${i}: this assistant turn was modified on replay. Send assistant turns back exactly as received, thinking blocks included.`,
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

const QUERY_TOOLS: readonly string[] = [
  TOOL.getShotSeries,
  TOOL.getShotSummary,
  TOOL.getPhaseStats,
  TOOL.compareShots,
  TOOL.getBagHistory,
];

/** Highest brew temperature each template allows (docs/verified/03-profiles.md section 9). */
const TEMP_MAX: Record<string, number> = Object.fromEntries(
  TEMPLATES.map((template) => [template.id, template.levers.find((lever) => lever.id === 'temp')?.max ?? Infinity]),
);

/** Each template's yield lever range: a script proposal must stay inside it. */
const YIELD_RANGE: Record<string, { min: number; max: number }> = Object.fromEntries(
  TEMPLATES.map((template) => {
    const lever = template.levers.find((l) => l.id === 'yield');
    return [template.id, { min: lever?.min ?? 0, max: lever?.max ?? Infinity }];
  }),
);

const TASTE_OPTIONS = ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery'];

/** What each profile does with a coffee, never how the cup will taste (D127). */
const TEMPLATE_REASONS: Record<(typeof TEMPLATE_IDS)[number], string> = {
  'blooming-espresso': 'A bloom pause lets light, dense beans soak evenly before the pour.',
  'd-flow': 'A gentle soak, then a steady pour. Forgiving for most roasts.',
  londonium: 'A lever-style pressure decline, gentle on darker roasts that extract readily.',
  allonge: 'A long, fast shot that puts more water through very light roasts.',
  'gentle-and-sweet': 'A low 6 bar peak and a slow decline: gentle pressure all the way.',
};

const ORIGINS = [
  'Ethiopia',
  'Kenya',
  'Colombia',
  'Brazil',
  'Guatemala',
  'Costa Rica',
  'Panama',
  'Rwanda',
  'Burundi',
  'Peru',
  'Honduras',
  'El Salvador',
  'Indonesia',
  'Yemen',
  'Mexico',
];

type Reply = { blocks: Array<TextBlock | ToolUseBlock>; stopReason: StopReason };

interface Script {
  messages: Message[];
  newToolId(): string;
  voice: Voice;
}

/** tool_use id -> tool name, from the assistant turn just before message `index`. */
function toolNamesBefore(messages: Message[], index: number): Map<string, string> {
  for (let i = index - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'assistant') {
      return new Map(toolUses(message).map((b) => [b.id as string, String(b.name)]));
    }
  }
  return new Map();
}

interface NamedResult {
  name: string | null;
  payload: unknown;
  /** The engine answered with is_error (e.g. a proposal outside the template's bounds). */
  isError: boolean;
}

function namedResults(messages: Message[], index: number): NamedResult[] {
  const names = toolNamesBefore(messages, index);
  return toolResults(messages[index]).map((b) => ({
    name: names.get(b.tool_use_id as string) ?? null,
    payload: parseJson(resultText(b)),
    isError: b.is_error === true,
  }));
}

function currentVersion(messages: Message[]): number {
  let version = 1;
  messages.forEach((message, i) => {
    if (message.role !== 'user') return;
    for (const { payload } of namedResults(messages, i)) {
      if (!isRecord(payload)) continue;
      const v = num(payload.version);
      if (v !== null && (typeof payload.picked === 'string' || payload.applied === true)) version = v;
    }
    for (const text of textsOf(message)) {
      const payload = eventPayload(text);
      if (text.startsWith(EVENT.shotCompleted)) version = num(payload?.version) ?? version;
      if (text.startsWith(EVENT.undo)) version = num(payload?.to) ?? version;
    }
  });
  return version;
}

/** A question about the taste ("How did it taste?"), not about the puck or anything else. */
const TASTE_QUESTION = /\btast(?:e|ed|es|ing)\b/i;

/** Text the user typed, not an event or context block the engine added. */
const typedTexts = (message: Message | undefined) => textsOf(message).filter((t) => !t.startsWith('[event:') && !t.startsWith(EVENT.context));

/**
 * Rule 3b: the text typed after a shot that set the taste question aside
 * (its ask_user answered with {"answered":false}), lower-cased. The app keeps
 * that text as the shot's taste (D79), so it is the taste answer, read as the
 * same words under "Other" are: a taste word picks the move, none means one
 * step finer. Null when no taste question was set aside for it.
 */
function typedTaste(messages: Message[], index: number): string | null {
  const message = messages[index];
  if (message?.role !== 'user') return null;
  const words = typedTexts(message).join(' ').toLowerCase();
  if (words.trim() === '' || latestShot(messages.slice(0, index)) === null) return null;
  const asked = new Map(toolUses(messages[index - 1]).map((b) => [b.id as string, b]));
  const setAside = toolResults(message).some((block) => {
    const payload = parseJson(resultText(block));
    const call = asked.get(block.tool_use_id as string);
    const question = isRecord(call?.input) ? call.input.question : undefined;
    return (
      isRecord(payload) &&
      payload.answered === false &&
      call?.name === TOOL.askUser &&
      typeof question === 'string' &&
      TASTE_QUESTION.test(question)
    );
  });
  return setAside ? words : null;
}

/** The most recent taste answer: a real ask_user answer ("selected" plus "other") or a typed taste (rule 3b), lower-cased. */
function latestAnswer(messages: Message[]): string {
  let answer = '';
  messages.forEach((message, i) => {
    if (message.role !== 'user') return;
    for (const { name, payload } of namedResults(messages, i)) {
      if (name !== TOOL.askUser || !isRecord(payload) || !Array.isArray(payload.selected)) continue;
      const other = typeof payload.other === 'string' ? payload.other : '';
      answer = `${payload.selected.filter((s) => typeof s === 'string').join(' ')} ${other}`.toLowerCase();
    }
    answer = typedTaste(messages, i) ?? answer;
  });
  return answer;
}

function latestShot(messages: Message[]): Raw | null {
  let shot: Raw | null = null;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const text of textsOf(message)) if (text.startsWith(EVENT.shotCompleted)) shot = eventPayload(text) ?? shot;
  }
  return shot;
}

/**
 * The grinder as last told: from the latest shot event or, before any shot,
 * the intake context block. A shot event from before the grinder was sent
 * carries none.
 */
function latestGrinder(messages: Message[]): Raw | null {
  let grinder: Raw | null = null;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const text of textsOf(message)) {
      if (!text.startsWith(EVENT.context) && !text.startsWith(EVENT.shotCompleted)) continue;
      const told = eventPayload(text)?.grinder;
      if (isRecord(told)) grinder = told;
    }
  }
  return grinder;
}

/** The dial Decaid's grinder library describes (a numeric `step` or a list of `values`), else null. */
function libraryDial(grinder: Raw): GrinderInfo | null {
  const model = typeof grinder.name === 'string' ? grinder.name : '';
  const step = num(grinder.step);
  if (step !== null && step > 0) return { model, settingType: 'numeric', smallStep: step, bigStep: null, values: null };
  const values = Array.isArray(grinder.values) ? grinder.values.filter((v): v is string => typeof v === 'string') : [];
  return values.length > 0 ? { model, settingType: 'preset', smallStep: null, bigStep: null, values } : null;
}

type GrindDirection = 'finer' | 'coarser';

/**
 * One step finer (or coarser) than the dial now, or null when it cannot be
 * named. With Decaid's step or list the move is worked out the way CafAI's
 * validator does it (and printed the same: "15" with step 0.5 is "14.5"
 * finer and "15.5" coarser; with a list, the entry before or after). A
 * grinder linked from Decaid's library without them (Decaid no longer lists
 * it, or has no step for it) gets directions only, as Settings tells the
 * user. Otherwise a plain number goes down (finer) or up (coarser) by 1, as
 * the script did before the grinder library: the common convention is that a
 * lower number is finer.
 */
function movedSetting(messages: Message[], direction: GrindDirection): string | null {
  const grinder = latestGrinder(messages);
  if (!grinder) return null;
  const setting = typeof grinder.setting === 'string' ? grinder.setting.trim() : '';
  const dial = libraryDial(grinder);
  if (dial) {
    const move = resolveGrindMove(dial, setting, { direction, amount: 1, setting: null });
    return move?.ok ? move.move.setting : null;
  }
  if (grinder.linked === true) return null;
  if (!/^\d+(\.\d+)?$/.test(setting)) return null;
  const moved = Number(setting) + (direction === 'finer' ? -1 : 1);
  return moved >= 0 ? String(Math.round(moved * 100) / 100) : null;
}

/** A proposed change as the script decides it; the voice adds the summary, rationale and expected effect. */
interface Change {
  kind: ChangeKind;
  input: Pick<ProposeAdjustment, 'variable' | 'lever' | 'value' | 'grind'>;
  tips: string[];
}

const SAME_PREP = ['Keep the same dose, grind and puck prep.'];
const NO_CHANGE = { variable: 'none', lever: null, value: null, grind: null } as const;

function proposalInput(change: Change, text: ProposalText): ProposeAdjustment {
  return { ...change.input, summary: text.summary, rationale: text.rationale, expectedEffect: text.expectedEffect, tips: change.tips };
}

/** The answer's taste, first match wins: "Sour / sharp" with "Bitter / harsh" is sour. Typed tastes (rule 3b) read the same words. */
function tasteOf(answer: string): Taste {
  if (answer.includes('sour')) return 'sour';
  if (answer.includes('bitter')) return 'bitter';
  if (answer.includes('weak') || answer.includes('watery')) return 'weak';
  if (answer.includes('strong')) return 'strong';
  if (answer.includes('balanced')) return 'balanced';
  return 'other';
}

/** Within this much of its yield lever, a shot that did not stop on weight still counts as having reached it. */
const REACHED_WITHIN_G = 1;

/**
 * How the shot ended against the yield its lever aims at. A yield move only
 * changes the cup when the shot gets there: a Blooming shot that runs out of
 * steps at 41.5 g never meets a stop at 48 g or 52 g.
 */
function stopOf(shot: Raw | null): ShotStop | null {
  if (!shot) return null;
  const summary = isRecord(shot.summary) ? shot.summary : {};
  const levers = isRecord(shot.levers) ? shot.levers : {};
  const yieldG = num(summary.yieldG);
  const targetG = num(levers.yield);
  const near = yieldG !== null && targetG !== null && Math.abs(yieldG - targetG) <= REACHED_WITHIN_G + 1e-9;
  return { reached: summary.stopReason === 'targetWeight' || near, yieldG, targetG };
}

function chooseChange(messages: Message[]): Change {
  const taste = tasteOf(latestAnswer(messages));
  const shot = latestShot(messages);
  const levers = isRecord(shot?.levers) ? shot.levers : {};
  const templateId = typeof shot?.templateId === 'string' ? shot.templateId : '';
  const temp = num(levers.temp);
  const yieldG = num(levers.yield);
  const stop = stopOf(shot);
  const yieldRange = YIELD_RANGE[templateId] ?? { min: 0, max: Infinity };
  // A yield move only when the shot reached its yield; else the grind moves instead.
  const yieldCan = (to: number) => stop?.reached === true && yieldG !== null && to >= yieldRange.min && to <= yieldRange.max;
  const profile = (kind: ChangeKind, lever: string, value: number): Change => ({
    kind,
    input: { variable: 'profile', lever, value, grind: null },
    tips: SAME_PREP,
  });

  if (taste === 'sour') {
    if (temp !== null && temp + 1 <= (TEMP_MAX[templateId] ?? Infinity)) return profile('warmer', 'temp', temp + 1);
    if (yieldG !== null && yieldCan(yieldG + 2)) return profile('longerForSour', 'yield', yieldG + 2);
  } else if (taste === 'bitter') {
    if (temp !== null) return profile('cooler', 'temp', temp - 1);
  } else if (taste === 'weak') {
    if (yieldG !== null && yieldCan(yieldG - 2)) return profile('shorter', 'yield', yieldG - 2);
  } else if (taste === 'strong') {
    if (yieldG !== null && yieldCan(yieldG + 2)) return profile('longer', 'yield', yieldG + 2);
    // Never finer: that would make a strong cup stronger.
    return grindMove(messages, 'coarser');
  } else if (taste === 'balanced') {
    return { kind: 'keep', input: NO_CHANGE, tips: ['Note your grind setting so you can repeat it.'] };
  }
  return grindMove(messages, 'finer');
}

function grindMove(messages: Message[], direction: GrindDirection): Change {
  return {
    kind: direction,
    input: { variable: 'grind', lever: null, value: null, grind: { direction, amount: 1, setting: movedSetting(messages, direction) } },
    tips: ['Keep the same dose.'],
  };
}

/** The top of a pressure series among `results` (a get_shot_series answer). */
function seriesPeak(results: NamedResult[]): number | null {
  for (const { name, payload, isError } of results) {
    if (name !== TOOL.getShotSeries || isError || !isRecord(payload) || payload.metric !== 'pressure') continue;
    const values = (Array.isArray(payload.values) ? payload.values : []).map(num).filter((bar): bar is number => bar !== null);
    if (values.length > 0) return Math.max(...values);
  }
  return null;
}

/**
 * The latest shot's peak and when it came, from its shot event's summary: the
 * numbers its shot card shows, the time counted from the start of the pour
 * (minus the summary's pourStartS, never below 0; a summary without one keeps
 * its time). Without them, the top of the series just read, with no time: a
 * series rounded to 1 Hz can tie along a plateau, so its first top is not the
 * summary's moment.
 */
function peakOf(messages: Message[], results: NamedResult[]): { bar: number | null; atS: number | null } {
  const summary = latestShot(messages)?.summary;
  if (!isRecord(summary)) return { bar: seriesPeak(results), atS: null };
  const bar = num(summary.peakPressureBar);
  if (bar !== null) return { bar, atS: pourTime(num(summary.peakPressureAtS), num(summary.pourStartS)) };
  return { bar: seriesPeak(results), atS: null };
}

/** What a voice may say about a change: the taste, the roast, the peak, how the shot ended and the latest shot's channeling flags. */
function changeFacts(messages: Message[], change: Change, results: NamedResult[], afterRejection: boolean): ChangeFacts {
  const peak = peakOf(messages, results);
  const shot = latestShot(messages);
  const summary = shot?.summary;
  const flags = isRecord(summary) && Array.isArray(summary.channelingFlags) ? summary.channelingFlags : null;
  return {
    kind: change.kind,
    taste: tasteOf(latestAnswer(messages)),
    roastLevel: savedRoast(messages),
    grindSetting: change.input.grind?.setting ?? null,
    peakPressureBar: peak.bar,
    peakPressureAtS: peak.atS,
    stop: stopOf(shot),
    channelingFlags: flags?.filter((flag): flag is string => typeof flag === 'string') ?? null,
    afterRejection,
  };
}

function appliedFacts(payload: Raw): AppliedFacts {
  const facts = { version: num(payload.version), title: typeof payload.title === 'string' ? payload.title : null };
  if (payload.variable === 'grind' || payload.variable === 'dose') return { status: 'manual', ...facts };
  if (payload.variable === 'none') return { status: 'kept', ...facts };
  // Connected, but not confirmed: the banner's Retry, not a wait for the machine to connect.
  if (typeof payload.loadError === 'string') return { status: 'notConfirmed', ...facts };
  if (payload.onMachine === false) return { status: 'offline', ...facts };
  return { status: 'loaded', ...facts };
}

function pickStatus(payload: Raw): PickFacts['status'] {
  if (payload.uploaded === false) return 'notUploaded';
  if (typeof payload.loadError === 'string') return 'notConfirmed';
  if (payload.onMachine === false) return 'offline';
  return 'loaded';
}

function detectRoast(text: string): RoastLevel | null {
  if (/\bmedium[- ]light\b/i.test(text)) return 'medium-light';
  if (/\bmedium[- ]dark\b/i.test(text)) return 'medium-dark';
  if (/\blight\b/i.test(text)) return 'light';
  if (/\bdark\b/i.test(text)) return 'dark';
  if (/\bmedium\b/i.test(text)) return 'medium';
  return null;
}

function detectProcess(text: string): string | null {
  return ['washed', 'natural', 'honey', 'anaerobic'].find((p) => new RegExp(`\\b${p}\\b`, 'i').test(text)) ?? null;
}

function detectOrigin(text: string): string | null {
  return ORIGINS.find((o) => new RegExp(`\\b${o}\\b`, 'i').test(text)) ?? null;
}

function suggestionsFor(roastLevel: RoastLevel | null) {
  const ranking: Array<[(typeof TEMPLATE_IDS)[number], 'high' | 'medium' | 'low']> =
    roastLevel === 'light'
      ? [
          ['blooming-espresso', 'high'],
          ['allonge', 'medium'],
          ['d-flow', 'low'],
        ]
      : roastLevel === 'dark'
        ? [
            ['londonium', 'high'],
            ['gentle-and-sweet', 'medium'],
            ['d-flow', 'low'],
          ]
        : [
            ['d-flow', 'high'],
            ['gentle-and-sweet', 'medium'],
            ['blooming-espresso', 'medium'],
            ['londonium', 'low'],
          ];
  return ranking.map(([templateId, confidence]) => ({ templateId, confidence, reason: TEMPLATE_REASONS[templateId] }));
}

/**
 * The bag's details CafAI saved before the intake, when it picked them from
 * Decaid's bean library or read them from a photo the user confirmed: the
 * first message's context block carries them as "bag" (6.1, 6.8). Else null.
 */
function knownBag(messages: Message[]): Raw | null {
  const first = messages.find((m) => m.role === 'user');
  for (const text of textsOf(first)) {
    if (!text.startsWith(EVENT.context)) continue;
    const bag = eventPayload(text)?.bag;
    if (isRecord(bag)) return bag;
  }
  return null;
}

/** The roast level saved at intake (the save_bag_details call, or the bag CafAI saved itself), else read from the bag description. */
function savedRoast(messages: Message[]): RoastLevel | null {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of toolUses(message)) {
      if (block.name !== TOOL.saveBagDetails || !isRecord(block.input)) continue;
      const level = block.input.roastLevel;
      if (typeof level === 'string') return level as RoastLevel;
    }
  }
  const known = knownBag(messages);
  if (known) return toRoastLevel(known.roastLevel);
  const description = messages.find((m) => m.role === 'user')?.content.find((b) => b.type === 'text');
  return typeof description?.text === 'string' ? detectRoast(description.text) : null;
}

/** True once a template was picked (a propose_templates result naming one). */
function templatePicked(messages: Message[]): boolean {
  return messages.some(
    (message, i) =>
      message.role === 'user' &&
      namedResults(messages, i).some(
        (r) => r.name === TOOL.proposeTemplates && isRecord(r.payload) && typeof r.payload.picked === 'string',
      ),
  );
}

function intake(script: Script, description: string): Reply {
  const name = (description.split(',')[0] ?? '').trim().slice(0, 40).trim() || 'My coffee';
  const roastLevel = detectRoast(description);
  const origin = detectOrigin(description);
  const process = detectProcess(description);
  const suggestions = suggestionsFor(roastLevel);
  return {
    blocks: [
      { type: 'text', text: script.voice.intake({ name, roastLevel, process, origin, topTemplate: suggestions[0]!.templateId }) },
      {
        type: 'tool_use',
        id: script.newToolId(),
        name: TOOL.saveBagDetails,
        input: { name, roaster: null, origin, roastLevel, process, notes: null, roastDate: null },
      },
      {
        type: 'tool_use',
        id: script.newToolId(),
        name: TOOL.proposeTemplates,
        input: { suggestions },
      },
    ],
    stopReason: 'tool_use',
  };
}

const textOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Rule 7a: the details are saved already (picked from Decaid's library, or a confirmed photo): only the templates. */
function knownBagIntake(script: Script, bag: Raw): Reply {
  const roastLevel = toRoastLevel(bag.roastLevel);
  const suggestions = suggestionsFor(roastLevel);
  const facts = { name: textOf(bag.name) ?? 'My coffee', roastLevel, process: textOf(bag.process), origin: textOf(bag.origin) };
  return {
    blocks: [
      { type: 'text', text: script.voice.intake({ ...facts, topTemplate: suggestions[0]!.templateId }) },
      { type: 'tool_use', id: script.newToolId(), name: TOOL.proposeTemplates, input: { suggestions } },
    ],
    stopReason: 'tool_use',
  };
}

const say = (text: string): Reply => ({ blocks: [{ type: 'text', text }], stopReason: 'end_turn' });

/**
 * What the scripted coach reads on any photo of a bag (6.8): one canned bag,
 * in the JSON src/llm/extractBag.ts asks for. Not a bag in the mock's own
 * bean library, so a confirmed photo adds a bean and a batch to it.
 */
export const BAG_PHOTO_ANSWER = {
  name: 'Kiambu AA',
  roaster: 'Square Mile',
  origin: 'Kenya, Kiambu',
  process: 'washed',
  roastLevel: 'light',
  roastDate: '2026-09-28',
  notes: 'blackcurrant, grapefruit, brown sugar',
} as const;

/** Rule 0: a request with a photo in it is CafAI reading a bag (src/llm/extractBag.ts), never a turn of the coach's chat. */
function readsPhoto(messages: Message[]): boolean {
  return messages.some((message) => message.content.some((block) => block.type === 'image'));
}

function decide(script: Script): Reply {
  const { messages, voice } = script;
  // 0. A photo of the bag: the canned bag's details, as JSON.
  if (readsPhoto(messages)) return say(JSON.stringify(BAG_PHOTO_ANSWER));
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  const results = namedResults(messages, lastIndex);
  const texts = textsOf(last);
  // A result marked {"answered":false} only closes a question the user talked
  // past (ENGINE_PROTOCOL rule 7); it is never a pick, a taste or a decision.
  const answered = (r: (typeof results)[number]) => !(isRecord(r.payload) && r.payload.answered === false);
  const resultFor = (name: string) => results.find((r) => r.name === name && answered(r));

  // 1. The user decided on a proposed change (or CafAI rejected it).
  const decision = resultFor(TOOL.proposeAdjustment);
  if (decision?.isError) {
    // Outside the template's bounds: try the grind instead, or, if that was
    // the grind already, keep the recipe.
    const rejected = toolUses(messages[lastIndex - 1]).find((b) => b.name === TOOL.proposeAdjustment);
    const wasGrind = isRecord(rejected?.input) && rejected.input.variable === 'grind';
    const next: Change = wasGrind ? { kind: 'keepAfterRejectedGrind', input: NO_CHANGE, tips: SAME_PREP } : grindMove(messages, 'finer');
    const facts = changeFacts(messages, next, [], true);
    return {
      blocks: [
        { type: 'text', text: voice.rejected(facts) },
        { type: 'tool_use', id: script.newToolId(), name: TOOL.proposeAdjustment, input: proposalInput(next, voice.proposalText(facts)) },
      ],
      stopReason: 'tool_use',
    };
  }
  if (decision) {
    const payload = isRecord(decision.payload) ? decision.payload : {};
    if (payload.applied === true) return say(voice.applied(appliedFacts(payload)));
    return say(voice.declined({ version: currentVersion(messages) }));
  }

  // 2. A query came back: propose one change.
  if (results.some((r) => r.name !== null && QUERY_TOOLS.includes(r.name))) {
    const change = chooseChange(messages);
    const facts = changeFacts(messages, change, results, false);
    const lead = voice.proposalLead(facts);
    const proposal: ToolUseBlock = {
      type: 'tool_use',
      id: script.newToolId(),
      name: TOOL.proposeAdjustment,
      input: proposalInput(change, voice.proposalText(facts)),
    };
    return { blocks: lead === null ? [proposal] : [{ type: 'text', text: lead }, proposal], stopReason: 'tool_use' };
  }

  // 3. The taste answer, or (3b) text typed after a shot instead of a tap,
  // which set the taste question aside and so is the taste: look at the curve.
  if (resultFor(TOOL.askUser) || typedTaste(messages, lastIndex) !== null) {
    return {
      blocks: [
        { type: 'text', text: voice.tasteAnswer({ taste: tasteOf(latestAnswer(messages)), roastLevel: savedRoast(messages) }) },
        {
          type: 'tool_use',
          id: script.newToolId(),
          name: TOOL.getShotSeries,
          input: { shot: 'latest', metric: 'pressure', fromS: null, toS: null },
        },
      ],
      stopReason: 'tool_use',
    };
  }

  // 4. A shot finished: sum it up and ask how it tasted.
  const shotText = texts.find((t) => t.startsWith(EVENT.shotCompleted));
  if (shotText !== undefined) {
    const payload = eventPayload(shotText);
    const summary = isRecord(payload?.summary) ? payload.summary : {};
    const shot = { durationS: num(summary.durationS), yieldG: num(summary.yieldG), doseG: num(summary.doseG) ?? num(payload?.doseG) };
    return {
      blocks: [
        { type: 'text', text: voice.shotCompleted(shot) },
        {
          type: 'tool_use',
          id: script.newToolId(),
          name: TOOL.askUser,
          input: { question: 'How did it taste?', options: TASTE_OPTIONS, multiSelect: false },
        },
      ],
      stopReason: 'tool_use',
    };
  }

  // 5. A template was picked.
  const picked = resultFor(TOOL.proposeTemplates);
  if (picked) {
    const payload = isRecord(picked.payload) ? picked.payload : {};
    return say(
      voice.picked({
        title: typeof payload.title === 'string' ? payload.title : null,
        status: pickStatus(payload),
        yieldG: num(payload.yieldG),
        doseG: num(payload.doseG),
      }),
    );
  }

  // 6. Undo.
  const undoText = texts.find((t) => t.startsWith(EVENT.undo));
  if (undoText !== undefined) {
    const payload = eventPayload(undoText);
    const to = num(payload?.to) ?? currentVersion(messages);
    return say(voice.undo({ to, title: typeof payload?.title === 'string' ? payload.title : null }));
  }

  // 7. The bag description, before anything was saved.
  const plain = texts.find((t) => !t.startsWith('[event:') && !t.startsWith(EVENT.context));
  const known = knownBag(messages);
  const saved = known !== null || messages.some((m) => m.role === 'assistant' && toolUses(m).some((b) => b.name === TOOL.saveBagDetails));
  if (plain !== undefined && !saved) return intake(script, plain);

  // 7a. A bag CafAI saved itself, picked from Decaid's library or read from a
  // photo: nothing to save, so the starting profiles alone.
  if (plain !== undefined && known !== null && messages.length === 1) return knownBagIntake(script, known);

  // 7b. Described, but no starting profile picked (the suggestions were set
  // aside): offer them again.
  if (plain !== undefined && !templatePicked(messages)) {
    const roastLevel = savedRoast(messages);
    const suggestions = suggestionsFor(roastLevel);
    return {
      blocks: [
        { type: 'text', text: voice.templatesAgain({ roastLevel, topTemplate: suggestions[0]!.templateId }) },
        {
          type: 'tool_use',
          id: script.newToolId(),
          name: TOOL.proposeTemplates,
          input: { suggestions },
        },
      ],
      stopReason: 'tool_use',
    };
  }

  // 8. Anything else.
  return say(voice.fallback());
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function respond(
  requestBody: unknown,
  headers: HeaderSource,
  memory: ScenarioMemory,
  options: RespondOptions = {},
): ScenarioResponse {
  const headerError = checkHeaders(headers);
  if (headerError) return headerError;
  if (!isRecord(requestBody)) return invalid('body: expected a JSON object.');
  const messages = normalizeMessages(requestBody.messages);
  if (messages === null) return invalid('messages: expected a list of user and assistant messages.');
  const bodyError = checkBody(requestBody, messages, memory);
  if (bodyError) return bodyError;

  memory.counter += 1;
  const turn = memory.counter;
  let toolCount = 0;
  const reply = decide({
    messages,
    newToolId: () => `toolu_mock_${memory.session}_${turn}_${++toolCount}`,
    voice: options.voice === 'demo' ? DEMO_VOICE : TERSE_VOICE,
  });

  const signature = `mock-sig-${memory.session}-${turn}-${hash(JSON.stringify(reply.blocks))}`;
  const encoded = encodeAssistantTurn(reply.blocks, {
    id: `msg_mock_${memory.session}_${turn}`,
    model: requestBody.model as string,
    stopReason: reply.stopReason,
    signature,
    inputTokens: Math.ceil(JSON.stringify(requestBody).length / 4),
  });
  const content = encoded.content as unknown as Raw[];
  memory.turns.set(signature, content);
  for (const block of toolUses({ role: 'assistant', content })) memory.toolIds.set(block.id as string, signature);
  return { status: 200, events: encoded.events, content, turn };
}

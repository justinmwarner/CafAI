/**
 * The scripted fake coach: a pure function from a Messages API request to the
 * streamed reply (or the error) a real model and API would give, following
 * docs/briefs/ENGINE_PROTOCOL.md ("Scripted fake model") exactly.
 *
 * It also polices the request the way the real API would, so engine bugs show
 * up in dev and tests instead of on a tablet: headers, streaming, tool_choice,
 * strict tools, tool_use / tool_result pairing, assistant prefill, and any
 * assistant turn it produced coming back modified (append-only history).
 */
import { EVENT, TEMPLATE_IDS, TOOL, type ProposeAdjustment, type RoastLevel } from '../../src/coach/contract.ts';
import { resolveGrindMove } from '../../src/coach/grinder.ts';
import type { GrinderInfo } from '../../src/coach/types.ts';
import type { StopReason, TextBlock, ToolUseBlock } from '../../src/llm/types.ts';
import { encodeAssistantTurn, type SseMessage } from './sse.ts';
import { TEMPLATES } from '../../src/coach/templates/index.ts';

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
  | { status: 200; events: SseMessage[]; content: Raw[] }
  | { status: number; errorBody: AnthropicErrorBody };

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

const TEMPLATE_REASONS: Record<(typeof TEMPLATE_IDS)[number], string> = {
  'blooming-espresso': 'A bloom pause suits light, dense beans and brings out their sweetness.',
  'd-flow': 'A gentle soak, then a steady pour. Forgiving and balanced for most roasts.',
  londonium: 'A lever-style pressure decline keeps darker roasts smooth and rich.',
  allonge: 'A long, fast shot that makes very light roasts sweet and fruity.',
  'gentle-and-sweet': 'A low 6 bar peak and a slow decline: easy, low in acidity, good with milk.',
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

/** The most recent real ask_user answer ("selected" plus "other"), lower-cased. */
function latestAnswer(messages: Message[]): string {
  let answer = '';
  messages.forEach((message, i) => {
    if (message.role !== 'user') return;
    for (const { name, payload } of namedResults(messages, i)) {
      if (name !== TOOL.askUser || !isRecord(payload) || !Array.isArray(payload.selected)) continue;
      const other = typeof payload.other === 'string' ? payload.other : '';
      answer = `${payload.selected.filter((s) => typeof s === 'string').join(' ')} ${other}`.toLowerCase();
    }
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

/**
 * One step finer than the dial now, or null when it cannot be named. With
 * Decaid's step or list the move is worked out the way CafAI's validator
 * does it (and printed the same: "15" with step 0.5 is "14.5"; with a list,
 * the previous entry). Without them, a plain number goes down by 1, as the
 * script did before the grinder library: the common convention is that a
 * lower number is finer.
 */
function finerSetting(messages: Message[]): string | null {
  const grinder = latestGrinder(messages);
  if (!grinder) return null;
  const setting = typeof grinder.setting === 'string' ? grinder.setting.trim() : '';
  const dial = libraryDial(grinder);
  if (dial) {
    const move = resolveGrindMove(dial, setting, { direction: 'finer', amount: 1, setting: null });
    return move?.ok ? move.move.setting : null;
  }
  if (!/^\d+(\.\d+)?$/.test(setting)) return null;
  const finer = Number(setting) - 1;
  return finer >= 0 ? String(Math.round(finer * 100) / 100) : null;
}

function proposal(
  change: Pick<ProposeAdjustment, 'variable' | 'lever' | 'value' | 'grind'>,
  summary: string,
  rationale: string,
  expectedEffect: string,
  tips: string[],
): ProposeAdjustment {
  return { ...change, summary, rationale, expectedEffect, tips };
}

const SAME_PREP = ['Keep the same dose, grind and puck prep.'];

function chooseAdjustment(messages: Message[]): ProposeAdjustment {
  const answer = latestAnswer(messages);
  const shot = latestShot(messages);
  const levers = isRecord(shot?.levers) ? shot.levers : {};
  const templateId = typeof shot?.templateId === 'string' ? shot.templateId : '';
  const temp = num(levers.temp);
  const yieldG = num(levers.yield);
  const yieldRange = YIELD_RANGE[templateId] ?? { min: 0, max: Infinity };
  const yieldCan = (to: number) => yieldG !== null && to >= yieldRange.min && to <= yieldRange.max;
  const profile = (lever: string, value: number) => ({ variable: 'profile' as const, lever, value, grind: null });

  if (answer.includes('sour')) {
    if (temp !== null && temp + 1 <= (TEMP_MAX[templateId] ?? Infinity)) {
      return proposal(
        profile('temp', temp + 1),
        'Raise brew temperature by 1 °C',
        'It tasted sour, which usually means under-extraction. A little more heat pulls out more sweetness.',
        'Less sharpness and more sweetness.',
        SAME_PREP,
      );
    }
    if (yieldG !== null && yieldCan(yieldG + 2)) {
      return proposal(
        profile('yield', yieldG + 2),
        'Lengthen the yield by 2 g',
        'It tasted sour and the temperature is already at the top of this profile, so a longer ratio extracts a little more.',
        'A rounder, less sharp cup.',
        SAME_PREP,
      );
    }
  } else if (answer.includes('bitter')) {
    if (temp !== null) {
      return proposal(
        profile('temp', temp - 1),
        'Lower brew temperature by 1 °C',
        'It tasted bitter, which usually means over-extraction. A little less heat softens the finish.',
        'A softer, less harsh finish.',
        SAME_PREP,
      );
    }
  } else if (answer.includes('weak')) {
    if (yieldG !== null && yieldCan(yieldG - 2)) {
      return proposal(
        profile('yield', yieldG - 2),
        'Shorten the yield by 2 g',
        'It tasted weak, so a shorter ratio will concentrate the cup.',
        'More body and intensity.',
        SAME_PREP,
      );
    }
  } else if (answer.includes('strong')) {
    if (yieldG !== null && yieldCan(yieldG + 2)) {
      return proposal(
        profile('yield', yieldG + 2),
        'Lengthen the yield by 2 g',
        'It tasted too strong, so a longer ratio will open it up.',
        'A lighter, clearer cup.',
        SAME_PREP,
      );
    }
  } else if (answer.includes('balanced')) {
    return proposal(
      { variable: 'none', lever: null, value: null, grind: null },
      'Keep everything as it is',
      'It tasted balanced and sweet. This recipe is dialled in, so lock it in.',
      'The same good cup again.',
      ['Note your grind setting so you can repeat it.'],
    );
  }
  return grindFiner(messages);
}

function grindFiner(messages: Message[]): ProposeAdjustment {
  const finer = finerSetting(messages);
  return proposal(
    { variable: 'grind', lever: null, value: null, grind: { direction: 'finer', amount: 1, setting: finer } },
    finer === null ? 'Grind 1 step finer' : `Grind 1 step finer, to ${finer}`,
    'The taste did not point to one clear fix, so slow the shot slightly with a finer grind.',
    'A slightly slower shot with more sweetness.',
    ['Keep the same dose.'],
  );
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

/** The roast level saved at intake (the save_bag_details call), else read from the bag description. */
function savedRoast(messages: Message[]): RoastLevel | null {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of toolUses(message)) {
      if (block.name !== TOOL.saveBagDetails || !isRecord(block.input)) continue;
      const level = block.input.roastLevel;
      if (typeof level === 'string') return level as RoastLevel;
    }
  }
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
  return {
    blocks: [
      { type: 'text', text: 'Lovely. Here is where I would start.' },
      {
        type: 'tool_use',
        id: script.newToolId(),
        name: TOOL.saveBagDetails,
        input: {
          name,
          roaster: null,
          origin: detectOrigin(description),
          roastLevel,
          process: detectProcess(description),
          notes: null,
        },
      },
      {
        type: 'tool_use',
        id: script.newToolId(),
        name: TOOL.proposeTemplates,
        input: { suggestions: suggestionsFor(roastLevel) },
      },
    ],
    stopReason: 'tool_use',
  };
}

const say = (text: string): Reply => ({ blocks: [{ type: 'text', text }], stopReason: 'end_turn' });

function formatNumber(value: unknown): string {
  const n = num(value);
  return n === null ? '?' : String(Math.round(n * 10) / 10);
}

function decide(script: Script): Reply {
  const { messages } = script;
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
    const next = wasGrind
      ? proposal(
          { variable: 'none', lever: null, value: null, grind: null },
          'Keep everything as it is',
          'That change is outside what this profile allows, so keep this recipe for one more shot.',
          'The same cup, to taste again.',
          SAME_PREP,
        )
      : grindFiner(messages);
    return {
      blocks: [
        { type: 'text', text: 'That one is outside what this profile allows. Here is another change.' },
        { type: 'tool_use', id: script.newToolId(), name: TOOL.proposeAdjustment, input: next },
      ],
      stopReason: 'tool_use',
    };
  }
  if (decision) {
    const payload = isRecord(decision.payload) ? decision.payload : {};
    if (payload.applied === true) {
      if (payload.variable === 'grind' || payload.variable === 'dose') return say('Make that change, then pull another shot.');
      if (payload.variable === 'none') return say('Locked in. Keep pulling shots like this one.');
      if (payload.onMachine === false) {
        return say(`Saved v${formatNumber(payload.version)}. Decaid loads it when the machine connects; pull another shot after that.`);
      }
      return say(`Done. v${formatNumber(payload.version)} is on the machine. Pull another shot and tell me how it tastes.`);
    }
    return say(`OK, we keep v${currentVersion(messages)} as it is. Tell me what you would like to try instead.`);
  }

  // 2. A query came back: propose one change.
  if (results.some((r) => r.name !== null && QUERY_TOOLS.includes(r.name))) {
    return {
      blocks: [{ type: 'tool_use', id: script.newToolId(), name: TOOL.proposeAdjustment, input: chooseAdjustment(messages) }],
      stopReason: 'tool_use',
    };
  }

  // 3. The taste answer: look at the curve.
  if (resultFor(TOOL.askUser)) {
    return {
      blocks: [
        { type: 'text', text: 'Thanks. Let me look at the pressure curve.' },
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
    const summary = eventPayload(shotText)?.summary;
    const facts = isRecord(summary) ? summary : {};
    return {
      blocks: [
        { type: 'text', text: `Got it: ${formatNumber(facts.durationS)} s, ${formatNumber(facts.yieldG)} g out.` },
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
    const title = typeof payload.title === 'string' ? payload.title : 'the profile';
    if (payload.uploaded === false) {
      return say(`I saved ${title}, but it did not load on the machine. Tap Retry above, then pull a shot.`);
    }
    if (payload.onMachine === false) {
      return say(`Saved ${title}. Decaid loads it when the machine connects; pull a shot after that.`);
    }
    return say(`Loaded ${title}. Pull a shot when you are ready; I will read the curves.`);
  }

  // 6. Undo.
  const undoText = texts.find((t) => t.startsWith(EVENT.undo));
  if (undoText !== undefined) {
    const to = num(eventPayload(undoText)?.to) ?? currentVersion(messages);
    return say(`Back on v${to}. Pull a shot when you are ready.`);
  }

  // 7. The bag description, before anything was saved.
  const plain = texts.find((t) => !t.startsWith('[event:') && !t.startsWith(EVENT.context));
  const saved = messages.some((m) => m.role === 'assistant' && toolUses(m).some((b) => b.name === TOOL.saveBagDetails));
  if (plain !== undefined && !saved) return intake(script, plain);

  // 7b. Described, but no starting profile picked (the suggestions were set
  // aside): offer them again.
  if (plain !== undefined && !templatePicked(messages)) {
    return {
      blocks: [
        { type: 'text', text: 'Here are the starting profiles again. Tap one to begin.' },
        {
          type: 'tool_use',
          id: script.newToolId(),
          name: TOOL.proposeTemplates,
          input: { suggestions: suggestionsFor(savedRoast(messages)) },
        },
      ],
      stopReason: 'tool_use',
    };
  }

  // 8. Anything else.
  return say('Got it. Pull a shot when you are ready, or tell me more about the coffee.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function respond(requestBody: unknown, headers: HeaderSource, memory: ScenarioMemory): ScenarioResponse {
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
  return { status: 200, events: encoded.events, content };
}

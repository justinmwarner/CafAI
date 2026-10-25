/**
 * The LLM provider contract.
 *
 * Content blocks mirror the Anthropic Messages API wire shapes. Anthropic is
 * the only provider wired into the UI; any other provider translates to and
 * from these shapes at its own boundary.
 *
 * Conversations are APPEND-ONLY. Assistant turns are stored exactly as the
 * provider returned them, thinking blocks and signatures included, and replayed
 * unchanged. Current Claude models reject (or silently degrade on) edited
 * history, so nothing may rewrite, reorder or drop earlier turns.
 */
import type { SpendKind } from '../spend/types.ts';

/** JSON Schema object (draft 2020-12 subset accepted by strict tool use). */
export type JsonSchema = Record<string, unknown>;

export interface TextBlock {
  type: 'text';
  text: string;
  /** The pages a text draws on (web search, D203): opaque `encrypted_index` included, replay unchanged. */
  citations?: Array<Record<string, unknown>> | null;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  /** Raw model output. Never trusted: validate with the tool's schema first. */
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** JSON text or plain text handed back to the model. */
  content: string;
  is_error?: boolean;
}

/** Opaque reasoning blocks. Keep and replay them unchanged; never display or edit. */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

/** A photo of the bag (6.8): sent in one request that reads its details, never in a conversation, never stored. */
export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
}

/** A call of a tool the provider runs itself (web search, D203): the server answers it in the same turn, never CafAI. */
export interface ServerToolUseBlock {
  type: 'server_tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** One page a web search found. `encrypted_content` is the page for later turns: replay it unchanged. */
export interface WebSearchResult {
  type: 'web_search_result';
  url: string;
  title: string;
  encrypted_content: string;
  page_age?: string | null;
}

/** A web search's results, or its error (`max_uses_exceeded`, `unavailable`...), in the assistant's own turn. */
export interface WebSearchToolResultBlock {
  type: 'web_search_tool_result';
  tool_use_id: string;
  content: WebSearchResult[] | { type: 'web_search_tool_result_error'; error_code: string };
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ImageBlock
  | ServerToolUseBlock
  | WebSearchToolResultBlock;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

/** A client tool offered to the model. */
export interface ToolDefinition {
  name: string;
  description: string;
  /**
   * Strict-mode JSON schema: every object has additionalProperties:false and
   * lists all properties in `required` (optional = nullable). Numeric, string
   * and array-length constraints are NOT sent (strict mode rejects them); the
   * coach enforces those client-side with zod after parsing.
   */
  inputSchema: JsonSchema;
}

/**
 * A tool the provider runs itself (Anthropic's server tools), sent as its
 * wire object: Anthropic's web search for a fun fact (D203),
 * `{type: 'web_search_20250305', name: 'web_search', max_uses: 1}`. Its
 * calls and results come back as blocks of the assistant's own turn
 * (`server_tool_use`, `web_search_tool_result`), kept and replayed unchanged.
 */
export interface ServerToolDefinition {
  type: string;
  name: string;
  [field: string]: unknown;
}

export type Effort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  model: string;
  /** Stable system prompt. Keep it byte-identical across turns so it caches. */
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  /** Tools the provider runs itself, after the client tools; absent or empty for none (D203). */
  serverTools?: ServerToolDefinition[];
  maxTokens?: number;
  /** Ignored for models that do not support effort (Haiku 4.5, no longer offered). */
  effort?: Effort;
  /**
   * False for a request that will not repeat (a photo of the bag): nothing is
   * written to the prompt cache, which bills a write at 1.25x the input.
   * Cached by default.
   */
  cache?: boolean;
  /**
   * What the request is for, for the coach's usage and cost (D237): a reply
   * by default. CafAI's own: never sent.
   */
  purpose?: SpendKind;
  /** Which model call of its reply this is: 0 (the default) for the first, as a reply's tool loop goes on (D237). Never sent. */
  call?: number;
  signal?: AbortSignal;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'pause_turn';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** Searches the server ran for the turn (D203), when it said. */
  webSearchRequests?: number;
}

/** A finished assistant turn, assembled from the stream. */
export interface LlmAssistantTurn {
  id: string;
  model: string;
  /** Exactly as returned, in order, including thinking blocks. Replay unchanged. */
  content: ContentBlock[];
  stopReason: StopReason | (string & {});
  usage: LlmUsage;
}

/** Incremental events while a turn streams. `index` is the content block index. */
export type LlmStreamEvent =
  | { type: 'message_start'; id: string; model: string }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'tool_use_start'; index: number; id: string; name: string }
  | { type: 'block_stop'; index: number }
  | { type: 'message_done'; turn: LlmAssistantTurn };

export type LlmErrorKind =
  | 'no_api_key'
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'bad_request'
  | 'network'
  | 'aborted'
  | 'server'
  | 'refusal'
  | 'protocol';

/** Every provider failure surfaces as this, with a sentence a barista can act on. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number;
  readonly retryable: boolean;

  constructor(kind: LlmErrorKind, message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'openai' | 'compatible' | 'fake';
  /**
   * Stream one assistant turn. Yields incremental events and ends with exactly
   * one `message_done`. Throws LlmError on failure (including mid-stream).
   */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

// ---------------------------------------------------------------------------
// The tool-loop runner (implemented in src/llm/runner.ts)
// ---------------------------------------------------------------------------

export interface ToolOutcome {
  /** JSON text (preferred) or plain text handed back to the model. */
  content: string;
  isError?: boolean;
}

export type ToolValidation = { ok: true; value: unknown } | { ok: false; error: string };

export interface RunnerTool {
  definition: ToolDefinition;
  /**
   * `auto`: the runner executes it and keeps going.
   * `ui`: the runner stops and returns the call; the app answers it later
   * (with a tool_result in the next user message) once the user has tapped.
   */
  kind: 'auto' | 'ui';
  /** Schema-validate raw model input (zod). Invalid input is answered with an is_error result. */
  validate(input: unknown): ToolValidation;
  /** Required for `auto` tools. Receives the validated value, and the call's tool_use id. */
  execute?(value: unknown, call: { id: string }): Promise<ToolOutcome>;
}

export interface PendingUiCall {
  id: string;
  name: string;
  /** Already validated. */
  input: unknown;
}

export interface RunRequest {
  provider: LlmProvider;
  model: string;
  system: string;
  effort?: Effort;
  maxTokens?: number;
  /** The append-only transcript so far; must end with a user message. */
  messages: LlmMessage[];
  tools: RunnerTool[];
  /** Tools the provider runs itself, passed on with every model call of the run (D203). */
  serverTools?: ServerToolDefinition[];
  /** What the run is for (D237): every model call of it carries it, with its number. A reply by default. */
  purpose?: SpendKind;
  signal?: AbortSignal;
  /**
   * Called once for every message the runner appends (assistant turns and
   * tool_result user messages), in order, so the caller can persist at once.
   * A turn the server paused (`pause_turn`) comes with the turn that finishes
   * it, as consecutive assistant messages, which the API takes as one (D203).
   */
  onAppend(message: LlmMessage): void | Promise<void>;
  /** Streaming text of the current assistant turn, for display. */
  onTextDelta?(delta: string): void;
  /** Called when a new assistant turn starts streaming. */
  onTurnStart?(): void;
  /** Hard cap on model calls per run (default 6); going on after a `pause_turn` is one. */
  maxModelCalls?: number;
}

export interface RunResult {
  /** Valid UI tool calls, in order. Each must be answered in the next user message. */
  pendingUiCalls: PendingUiCall[];
  /**
   * Results for the other tool calls of the turn that produced pendingUiCalls.
   * The caller sends them in the same user message as the UI answers.
   */
  heldResults: ToolResultBlock[];
  stopReason: string;
  /** Text of the final assistant turn, the parts a `pause_turn` split off included. */
  finalText: string;
}

/** A second price tier for long prompts (Haiku 5.5's, D242), in USD per million tokens as ModelInfo's. */
export interface LongPromptPrices {
  /** A request whose prompt (input plus cache reads and writes) passes this many tokens is priced at this tier. */
  aboveTokens: number;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
  /**
   * USD per million tokens, as Anthropic's pricing page gave them on
   * PRICES_AS_OF (models.ts): the cost hint in Settings and the coach's
   * estimated cost (D237). 0 is "not known" (an id typed by hand).
   */
  inputPerMTok: number;
  outputPerMTok: number;
  /** A write to the prompt cache: the 5-minute cache CafAI asks for, 1.25x the input. */
  cacheWritePerMTok: number;
  /** A read from the prompt cache: 0.05x the input on Opus 5.5 and Sonnet 5.5, 0.025x on Fable 5.1, 0.1x on the others. */
  cacheReadPerMTok: number;
  /** Absent for a model priced the same whatever the prompt's length. */
  longPrompt?: LongPromptPrices;
  supportsEffort: boolean;
}

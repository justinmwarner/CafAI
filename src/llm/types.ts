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

/** JSON Schema object (draft 2020-12 subset accepted by strict tool use). */
export type JsonSchema = Record<string, unknown>;

export interface TextBlock {
  type: 'text';
  text: string;
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

/** Seam for bag photos (picked via <input type="file">). Not used tonight. */
export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ImageBlock;

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

export type Effort = 'low' | 'medium' | 'high';

export interface LlmRequest {
  model: string;
  /** Stable system prompt. Keep it byte-identical across turns so it caches. */
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  /** Ignored for models that do not support effort (Haiku 4.5). */
  effort?: Effort;
  signal?: AbortSignal;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'pause_turn';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
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
  /** Required for `auto` tools. Receives the validated value. */
  execute?(value: unknown): Promise<ToolOutcome>;
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
  signal?: AbortSignal;
  /**
   * Called once for every message the runner appends (assistant turns and
   * tool_result user messages), in order, so the caller can persist at once.
   */
  onAppend(message: LlmMessage): void | Promise<void>;
  /** Streaming text of the current assistant turn, for display. */
  onTextDelta?(delta: string): void;
  /** Called when a new assistant turn starts streaming. */
  onTurnStart?(): void;
  /** Hard cap on model calls per run (default 6). */
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
  /** Text of the final assistant turn. */
  finalText: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
  /** USD per million tokens, for the cost hint in Settings. */
  inputPerMTok: number;
  outputPerMTok: number;
  supportsEffort: boolean;
}

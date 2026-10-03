/**
 * The tool loop: stream a turn, run the tools the coach may run on its own,
 * hand the ones that need a tap back to the caller, repeat.
 *
 * The transcript stays valid for the API at every point where this returns or
 * throws: once an assistant turn with tool calls is appended, every call gets
 * a tool_result (in one user message, in tool_use order), unless a UI call is
 * pending, in which case the caller sends the held results together with the
 * user's answers. A refused turn is never appended.
 */
import { refusalError, stuckError } from './errors.ts';
import { unparsedToolInput } from './toolInput.ts';
import {
  LlmError,
  type ContentBlock,
  type LlmAssistantTurn,
  type LlmMessage,
  type LlmRequest,
  type PendingUiCall,
  type RunRequest,
  type RunResult,
  type RunnerTool,
  type ToolResultBlock,
  type ToolUseBlock,
} from './types.ts';

export const DEFAULT_MAX_MODEL_CALLS = 6;
export const CUT_OFF_MESSAGE = 'Your output was cut off; answer again more briefly.';

/** The visible text of a turn. Text blocks can split mid-sentence, so they join with nothing. */
export function contentText(content: readonly ContentBlock[]): string {
  return content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

function toolResult(id: string, content: string, isError: boolean): ToolResultBlock {
  return isError ? { type: 'tool_result', tool_use_id: id, content, is_error: true } : { type: 'tool_result', tool_use_id: id, content };
}

type Handled = { result: ToolResultBlock } | { pending: PendingUiCall };

async function handleToolUse(use: ToolUseBlock, tools: Map<string, RunnerTool>): Promise<Handled> {
  const fail = (content: string): Handled => ({ result: toolResult(use.id, content, true) });

  const tool = tools.get(use.name);
  if (!tool) return fail(`Unknown tool "${use.name}". Use one of: ${[...tools.keys()].join(', ')}.`);

  const raw = unparsedToolInput(use);
  if (raw !== undefined) return fail(JSON.stringify({ INVALID_JSON: raw }));

  let validation: ReturnType<RunnerTool['validate']>;
  try {
    validation = tool.validate(use.input);
  } catch (error) {
    return fail(`The input for "${use.name}" could not be checked: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!validation.ok) return fail(validation.error);

  if (tool.kind === 'ui') return { pending: { id: use.id, name: use.name, input: validation.value } };
  if (!tool.execute) return fail(`The tool "${use.name}" cannot run here.`);
  try {
    const outcome = await tool.execute(validation.value);
    return { result: toolResult(use.id, outcome.content, outcome.isError === true) };
  } catch (error) {
    const reason = error instanceof Error && error.message !== '' ? error.message : 'unknown error';
    return fail(`The tool "${use.name}" failed: ${reason}`);
  }
}

async function streamTurn(run: RunRequest, messages: LlmMessage[]): Promise<LlmAssistantTurn> {
  const request: LlmRequest = {
    model: run.model,
    system: run.system,
    // A copy: the provider must never see later appends to this run's transcript.
    messages: [...messages],
    tools: run.tools.map((tool) => tool.definition),
  };
  if (run.maxTokens !== undefined) request.maxTokens = run.maxTokens;
  if (run.effort !== undefined) request.effort = run.effort;
  if (run.signal !== undefined) request.signal = run.signal;

  let turn: LlmAssistantTurn | null = null;
  for await (const event of run.provider.stream(request)) {
    if (event.type === 'message_start') run.onTurnStart?.();
    else if (event.type === 'text_delta') run.onTextDelta?.(event.text);
    else if (event.type === 'message_done') turn = event.turn;
  }
  if (turn === null) throw new LlmError('protocol', "The coach's reply ended early. Try again.");
  return turn;
}

function finish(turn: LlmAssistantTurn, pendingUiCalls: PendingUiCall[], heldResults: ToolResultBlock[]): RunResult {
  return { pendingUiCalls, heldResults, stopReason: turn.stopReason, finalText: contentText(turn.content) };
}

export async function runConversation(run: RunRequest): Promise<RunResult> {
  if (run.messages[run.messages.length - 1]?.role !== 'user') {
    throw new LlmError('protocol', 'The conversation must end with a user message.');
  }
  const maxCalls = run.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
  const tools = new Map(run.tools.map((tool) => [tool.definition.name, tool]));
  const messages = [...run.messages];

  for (let calls = 0; ; ) {
    if (calls >= maxCalls) throw stuckError();
    calls += 1;

    const turn = await streamTurn(run, messages);
    // Refused output is discarded, never stored or replayed.
    if (turn.stopReason === 'refusal') throw refusalError();

    const assistant: LlmMessage = { role: 'assistant', content: turn.content };
    messages.push(assistant);
    await run.onAppend(assistant);

    const uses = turn.content.filter(isToolUse);
    if (uses.length === 0) return finish(turn, [], []);

    const results: ToolResultBlock[] = [];
    const pending: PendingUiCall[] = [];
    for (const use of uses) {
      if (turn.stopReason === 'max_tokens') {
        // A cut-off call may carry truncated input that happens to validate: never run it.
        results.push(toolResult(use.id, CUT_OFF_MESSAGE, true));
        continue;
      }
      const handled = await handleToolUse(use, tools);
      if ('pending' in handled) pending.push(handled.pending);
      else results.push(handled.result);
    }
    if (pending.length > 0) return finish(turn, pending, results);

    const answers: LlmMessage = { role: 'user', content: results };
    messages.push(answers);
    await run.onAppend(answers);
  }
}

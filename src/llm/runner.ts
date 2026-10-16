/**
 * The tool loop: stream a turn, run the tools the coach may run on its own,
 * hand the ones that need a tap back to the caller, repeat.
 *
 * The transcript stays valid for the API at every point where this returns or
 * throws: once an assistant turn with tool calls is appended, every call gets
 * a tool_result (in one user message, in tool_use order), unless a UI call is
 * pending, in which case the caller sends the held results together with the
 * user's answers. A refused turn is never appended, and a turn the server
 * paused (`pause_turn`, its own web search, D203) only with the turn that
 * finishes it.
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

/**
 * The visible text of a turn. Text blocks next to each other join with nothing
 * (citations split one mid-sentence); text with another block between (a web
 * search, D203) starts a paragraph.
 */
export function contentText(content: readonly ContentBlock[]): string {
  let text = '';
  let apart = false;
  for (const block of content) {
    if (block.type !== 'text') {
      apart = true;
      continue;
    }
    if (block.text === '') continue;
    if (apart && text !== '') text += '\n\n';
    text += block.text;
    apart = false;
  }
  return text;
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
  if (run.serverTools !== undefined && run.serverTools.length > 0) request.serverTools = [...run.serverTools];
  if (run.maxTokens !== undefined) request.maxTokens = run.maxTokens;
  if (run.effort !== undefined) request.effort = run.effort;
  if (run.signal !== undefined) request.signal = run.signal;

  let turn: LlmAssistantTurn | null = null;
  // As contentText joins them: a block between two texts (a web search) is a paragraph break.
  let lastText = -1;
  for await (const event of run.provider.stream(request)) {
    if (event.type === 'message_start') run.onTurnStart?.();
    else if (event.type === 'text_delta') {
      if (lastText >= 0 && event.index > lastText + 1) run.onTextDelta?.('\n\n');
      lastText = event.index;
      run.onTextDelta?.(event.text);
    } else if (event.type === 'message_done') turn = event.turn;
  }
  if (turn === null) throw new LlmError('protocol', "The coach's reply ended early. Try again.");
  return turn;
}

/** `before`: what the turn's paused parts said (pause_turn), in order. */
function finish(turn: LlmAssistantTurn, before: readonly LlmMessage[], pendingUiCalls: PendingUiCall[], heldResults: ToolResultBlock[]): RunResult {
  const content = [...before.flatMap((message) => message.content), ...turn.content];
  return { pendingUiCalls, heldResults, stopReason: turn.stopReason, finalText: contentText(content) };
}

export async function runConversation(run: RunRequest): Promise<RunResult> {
  if (run.messages[run.messages.length - 1]?.role !== 'user') {
    throw new LlmError('protocol', 'The conversation must end with a user message.');
  }
  const maxCalls = run.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
  const tools = new Map(run.tools.map((tool) => [tool.definition.name, tool]));
  const messages = [...run.messages];
  /** Parts of the turn the server paused, sent back but not yet appended. */
  let paused: LlmMessage[] = [];

  for (let calls = 0; ; ) {
    if (calls >= maxCalls) throw stuckError();
    calls += 1;

    const turn = await streamTurn(run, messages);
    // Refused output is discarded, never stored or replayed.
    if (turn.stopReason === 'refusal') throw refusalError();

    const assistant: LlmMessage = { role: 'assistant', content: turn.content };
    messages.push(assistant);
    const uses = turn.content.filter(isToolUse);
    if (turn.stopReason === 'pause_turn' && uses.length === 0) {
      // The server paused its own loop (a web search, D203): the turn goes back as it is, with no new user
      // message, and the server goes on. Appended with the rest, so a failure leaves the user message last.
      paused.push(assistant);
      continue;
    }
    const before = paused;
    paused = [];
    for (const part of before) await run.onAppend(part);
    await run.onAppend(assistant);

    if (uses.length === 0) return finish(turn, before, [], []);

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
    if (pending.length > 0) return finish(turn, before, pending, results);

    const answers: LlmMessage = { role: 'user', content: results };
    messages.push(answers);
    await run.onAppend(answers);
  }
}

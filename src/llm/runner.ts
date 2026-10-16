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
 * The answer to a card the coach called beside a web search still waiting
 * (D203): the API runs such a search only once that card's result comes
 * back, in a message of tool results alone, which a tap and the verdicts and
 * readings riding with it could never be. So the card is never shown: it
 * goes back at once, the search runs, and the coach asks again.
 */
export const SEARCH_FIRST_MESSAGE = 'Not shown: a web search was still waiting beside this call. Let the search finish on its own first, then call this tool again.';

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

/** True when a server tool call of the turn (a web search) has no result in it yet: one called beside a client tool (D203). */
export function waitsOnServerTool(content: readonly ContentBlock[]): boolean {
  const answered = new Set<string>();
  for (const block of content) {
    const result = block as { type: string; tool_use_id?: unknown };
    if (result.type !== 'tool_result' && result.type.endsWith('_tool_result') && typeof result.tool_use_id === 'string') answered.add(result.tool_use_id);
  }
  return content.some((block) => block.type === 'server_tool_use' && !answered.has(block.id));
}

/**
 * True when a stored transcript ends on a search still waiting, its client
 * calls answered (a reload between appends, D203): the next request must
 * carry the search tool, and nothing may be said after those results before
 * the search ran, or the API refuses every request from then on.
 */
export function resumesSearch(messages: readonly LlmMessage[]): boolean {
  const last = messages[messages.length - 1];
  const turn = messages[messages.length - 2];
  return last?.role === 'user' && turn?.role === 'assistant' && waitsOnServerTool(turn.content);
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
    const outcome = await tool.execute(validation.value, { id: use.id });
    return { result: toolResult(use.id, outcome.content, outcome.isError === true) };
  } catch (error) {
    const reason = error instanceof Error && error.message !== '' ? error.message : 'unknown error';
    return fail(`The tool "${use.name}" failed: ${reason}`);
  }
}

/**
 * `paused`: parts of this turn the server paused (pause_turn, D203). Its rest
 * streams on in the same bubble: no new turn start, and a paragraph break
 * first when those parts said something.
 */
async function streamTurn(run: RunRequest, messages: LlmMessage[], paused: readonly LlmMessage[]): Promise<LlmAssistantTurn> {
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
  const spokeBefore = contentText(paused.flatMap((message) => message.content)) !== '';
  for await (const event of run.provider.stream(request)) {
    if (event.type === 'message_start') {
      if (paused.length === 0) run.onTurnStart?.();
    } else if (event.type === 'text_delta') {
      if (lastText >= 0 ? event.index > lastText + 1 : spokeBefore) run.onTextDelta?.('\n\n');
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
  /**
   * Messages sent back but not yet appended (D203): the parts of a turn the
   * server paused, or a turn whose web search waits beside client calls, with
   * their results. Appended with the turn that finishes them, so a failure
   * leaves the user message last and a retry asks again.
   */
  let held: LlmMessage[] = [];
  /** What was held last is a turn the server paused: its rest streams on in the same bubble. */
  let goingOn = false;

  for (let calls = 0; ; ) {
    if (calls >= maxCalls) throw stuckError();
    calls += 1;

    const turn = await streamTurn(run, messages, goingOn ? held : []);
    // Refused output is discarded, never stored or replayed.
    if (turn.stopReason === 'refusal') throw refusalError();

    const assistant: LlmMessage = { role: 'assistant', content: turn.content };
    messages.push(assistant);
    const uses = turn.content.filter(isToolUse);
    if (turn.stopReason === 'pause_turn' && uses.length === 0) {
      // The server paused its own loop (a web search, D203): the turn goes back as it is, with no new user
      // message, and the server goes on.
      held.push(assistant);
      goingOn = true;
      continue;
    }
    // A search called beside client calls runs only once their results come back, in a message of tool
    // results alone (D203): no card may wait for a tap then, and the turn and its results are held until
    // the turn that finishes the search comes, as a paused turn is.
    const searchWaits = uses.length > 0 && waitsOnServerTool(turn.content);
    const before = searchWaits ? [] : held;
    if (!searchWaits) {
      held = [];
      goingOn = false;
      for (const part of before) await run.onAppend(part);
      await run.onAppend(assistant);
      if (uses.length === 0) return finish(turn, before, [], []);
    }

    const results: ToolResultBlock[] = [];
    const pending: PendingUiCall[] = [];
    for (const use of uses) {
      if (turn.stopReason === 'max_tokens') {
        // A cut-off call may carry truncated input that happens to validate: never run it.
        results.push(toolResult(use.id, CUT_OFF_MESSAGE, true));
        continue;
      }
      const handled = await handleToolUse(use, tools);
      if (!('pending' in handled)) results.push(handled.result);
      else if (searchWaits) results.push(toolResult(use.id, SEARCH_FIRST_MESSAGE, true));
      else pending.push(handled.pending);
    }
    if (searchWaits) {
      const answers: LlmMessage = { role: 'user', content: results };
      messages.push(answers);
      held.push(assistant, answers);
      goingOn = false;
      continue;
    }
    if (pending.length > 0) return finish(turn, before, pending, results);

    const answers: LlmMessage = { role: 'user', content: results };
    messages.push(answers);
    await run.onAppend(answers);
  }
}

/**
 * Reading a coach transcript (docs/briefs/ENGINE_PROTOCOL.md turn formats):
 * the events the engine sends, the tool calls the coach made and the results
 * that answered them. The demo's coach turns quote numbers from here, so
 * every number they say is one the request really holds, and the tests use
 * it to check the stored transcript is one the API would accept.
 */
import { EVENT, type ToolName } from '../../src/coach/contract.ts';
import type { ContentBlock, LlmMessage, ToolResultBlock, ToolUseBlock } from '../../src/llm/types.ts';

const isToolUse = (block: ContentBlock): block is ToolUseBlock => block.type === 'tool_use';
const isToolResult = (block: ContentBlock): block is ToolResultBlock => block.type === 'tool_result';

export function toolUses(message: LlmMessage | undefined): ToolUseBlock[] {
  return message?.content.filter(isToolUse) ?? [];
}

export function toolResults(message: LlmMessage | undefined): ToolResultBlock[] {
  return message?.content.filter(isToolResult) ?? [];
}

function texts(message: LlmMessage): string[] {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The payload of the latest `[marker]\n{json}` text in the user turns, or null. */
export function latestEvent<T>(messages: readonly LlmMessage[], marker: string): T | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'user') continue;
    const text = [...texts(message)].reverse().find((t) => t.startsWith(`${marker}\n`));
    if (text !== undefined) return parse(text.slice(marker.length + 1)) as T;
  }
  return null;
}

/** The latest input the coach gave `name`, or null. */
export function latestToolInput<T>(messages: readonly LlmMessage[], name: ToolName): T | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const use = [...toolUses(messages[i])].reverse().find((block) => block.name === name);
    if (use) return use.input as T;
  }
  return null;
}

/** The parsed result answering `name` in the last user turn (tool names come from the turn before it), or null. */
export function lastResult<T>(messages: readonly LlmMessage[], name: ToolName): T | null {
  const last = messages[messages.length - 1];
  const before = messages[messages.length - 2];
  if (!last || last.role !== 'user' || !before) return null;
  const ids = new Set(toolUses(before).filter((block) => block.name === name).map((block) => block.id));
  const result = toolResults(last).find((block) => ids.has(block.tool_use_id));
  return result ? (parse(result.content) as T) : null;
}

/**
 * Everything in a transcript that the API (and the scripted coach) would
 * refuse: roles that do not alternate, a first or empty turn that is not the
 * user's, an assistant turn that does not open with a signed thinking block,
 * a tool_use not answered by a tool_result in the very next user turn, or a
 * result that answers nothing. A transcript may end with an assistant turn
 * whose tool calls wait for the user: those are listed as `open`.
 */
export function transcriptProblems(messages: readonly LlmMessage[]): { problems: string[]; open: ToolUseBlock[] } {
  const problems: string[] = [];
  messages.forEach((message, i) => {
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (message.role !== expected) problems.push(`messages[${i}] is ${message.role}, expected ${expected}`);
    if (message.content.length === 0) problems.push(`messages[${i}] is empty`);
    if (message.role === 'assistant') {
      const first = message.content[0];
      if (first?.type !== 'thinking' || typeof first.signature !== 'string' || first.signature === '') {
        problems.push(`messages[${i}] does not open with a signed thinking block`);
      }
      const next = messages[i + 1];
      if (!next) return;
      const answered = new Set(toolResults(next).map((block) => block.tool_use_id));
      for (const use of toolUses(message)) {
        if (!answered.has(use.id)) problems.push(`messages[${i}] tool_use ${use.id} has no tool_result in messages[${i + 1}]`);
      }
    } else {
      const asked = new Set(toolUses(messages[i - 1]).map((block) => block.id));
      for (const result of toolResults(message)) {
        if (!asked.has(result.tool_use_id)) problems.push(`messages[${i}] answers ${result.tool_use_id}, which the turn before did not call`);
      }
    }
  });
  const last = messages[messages.length - 1];
  return { problems, open: last?.role === 'assistant' ? toolUses(last) : [] };
}

export { EVENT };

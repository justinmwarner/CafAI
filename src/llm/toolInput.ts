/**
 * Tool input the model sent that was not valid JSON.
 *
 * A replayed `tool_use` block must carry an object as its `input`, or every
 * later request of this append-only conversation is rejected. So the stored
 * block gets `{}`, and the raw text is kept here, beside it, for the runner to
 * hand back in an INVALID_JSON error within the same run. A WeakMap keeps it
 * out of storage and off the wire.
 */
import type { ToolUseBlock } from './types.ts';

const unparsed = new WeakMap<ToolUseBlock, string>();

export function markUnparsedToolInput(block: ToolUseBlock, raw: string): void {
  unparsed.set(block, raw);
}

/** The raw text of an input that did not parse, or undefined when the input is usable JSON. */
export function unparsedToolInput(block: ToolUseBlock): string | undefined {
  const raw = unparsed.get(block);
  if (raw !== undefined) return raw;
  // A provider that keeps the raw string in `input` itself.
  return typeof block.input === 'string' ? block.input : undefined;
}

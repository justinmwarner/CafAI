/**
 * The engine side of docs/briefs/ENGINE_PROTOCOL.md: how app events become
 * user turns, and how to recover pending tool calls from a stored transcript.
 * Pure functions; the scripted fake model in mock/anthropic parses exactly
 * these shapes.
 */
import { EVENT } from '../../coach/contract.ts';
import type { ShotSummary } from '../../coach/types.ts';
import type { ContentBlock, LlmMessage, TextBlock, ToolResultBlock, ToolUseBlock } from '../../llm/types.ts';

export function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

export function toolResult(toolUseId: string, payload: unknown, isError = false): ToolResultBlock {
  const block: ToolResultBlock = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
  if (isError) block.is_error = true;
  return block;
}

export function userMessage(blocks: ContentBlock[]): LlmMessage {
  return { role: 'user', content: blocks };
}

export interface IntakeContext {
  grinder: { name: string | null; setting: string | null };
  scaleConnected: boolean;
}

/** The first user turn of a bag: the user's words plus the app context block. */
export function intakeBlocks(text: string, context: IntakeContext): ContentBlock[] {
  return [textBlock(text), textBlock(`${EVENT.context}\n${JSON.stringify(context)}`)];
}

export const UNANSWERED_TEXT = { answered: false, note: 'The user typed a message instead.' } as const;
export const UNANSWERED_SHOT = { answered: false, note: 'A new shot was pulled instead.' } as const;

export interface ShotCompletedPayload {
  shotRef: 'latest';
  shotId: string;
  version: number;
  templateId: string;
  levers: Record<string, number>;
  doseG: number | null;
  targetYieldG: number | null;
  summary: Omit<ShotSummary, 'series'>;
}

export function summaryForModel(summary: ShotSummary): Omit<ShotSummary, 'series'> {
  const { series: _series, ...rest } = summary;
  return rest;
}

export function shotCompletedBlock(payload: ShotCompletedPayload): TextBlock {
  return textBlock(`${EVENT.shotCompleted}\n${JSON.stringify(payload)}`);
}

export function undoBlock(payload: { from: number; to: number; title: string }): TextBlock {
  return textBlock(`${EVENT.undo}\n${JSON.stringify(payload)}`);
}

export interface TemplatePickedPayload {
  picked: string;
  version: 1;
  title: string;
  uploaded: boolean;
  note: string | null;
}

export type AdjustmentResultPayload =
  | { applied: true; variable: string; version: number | null; title: string | null }
  | { applied: false; reason: string }
  | { applied: false; error: string };

/**
 * Tool calls the model is still waiting on: the tool_use blocks of a
 * transcript that ends with an assistant turn. (After a run stops on UI tools
 * the transcript ends there until the user answers.)
 */
export function unansweredToolUses(messages: readonly LlmMessage[]): ToolUseBlock[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return [];
  return last.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');
}

/** True when the transcript ends with a user turn, i.e. a model call is owed. */
export function awaitingModel(messages: readonly LlmMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role === 'user';
}

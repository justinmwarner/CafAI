/**
 * The engine side of docs/briefs/ENGINE_PROTOCOL.md: how app events become
 * user turns, and how to recover pending tool calls from a stored transcript.
 * Pure functions; the scripted fake model in mock/anthropic parses exactly
 * these shapes.
 */
import { EVENT } from '../../coach/contract.ts';
import type { GrinderInfo, ShotSummary } from '../../coach/types.ts';
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

/**
 * The grinder as the model hears it (rules 1 and 3): name and setting as
 * last saved, and how its dial moves when it is linked to Decaid's grinder
 * library (D62). The engine always sends every field, built by
 * grinderPayload(). The library fields stay optional only because the live
 * API check (src/llm/live/anthropic.live.ts) still builds its intake with the
 * older shape.
 */
export interface GrinderPayload {
  name: string | null;
  setting: string | null;
  /** Null when no grinder from Decaid's library is linked, or Decaid has no record of it. */
  settingType?: GrinderInfo['settingType'] | null;
  /** A numeric dial's small step; null when unknown. */
  step?: number | null;
  /** A preset grinder's settings, finest first; null when unknown. */
  values?: string[] | null;
  /**
   * Settings links this grinder from Decaid's library, also when Decaid no
   * longer lists it or has no step data for it: then the coach gives
   * directions only, as Settings tells the user.
   */
  linked?: boolean;
}

/** The grinder for the model: as last saved, with what Decaid's grinder library says about its dial. */
export function grinderPayload(
  name: string | null,
  setting: string | null,
  dial: GrinderInfo | null,
  linked: boolean,
): Required<GrinderPayload> {
  const step = dial?.settingType === 'numeric' ? dial.smallStep : null;
  const values = dial?.settingType === 'preset' ? dial.values : null;
  return {
    name,
    setting,
    settingType: dial?.settingType ?? null,
    step: step !== null && Number.isFinite(step) && step > 0 ? step : null,
    values: values && values.length > 0 ? [...values] : null,
    linked,
  };
}

export interface IntakeContext {
  grinder: GrinderPayload;
  scaleConnected: boolean;
  /**
   * The dose in Decaid when CafAI coaches from it (12-25 g), else null. The
   * engine always sends it; optional only for the live API check's intake
   * (see GrinderPayload).
   */
  doseG?: number | null;
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
  /** The grinder as the user last saved it (Settings, or a confirmed grind move). */
  grinder: GrinderPayload;
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
  /** Where v1 stops, in grams: the author's ratio times doseG, or times 18 g (D57). */
  yieldG: number;
  /** The dose v1's yield was worked out from; null when v1 assumed 18 g (none in Decaid, or outside 12-25 g). */
  doseG: number | null;
  uploaded: boolean;
  /**
   * True once the machine holds v1. False only while the machine is not
   * connected: Decaid loads the version when it connects. Null otherwise: the
   * load failed (uploaded false, see note) or the connected machine has not
   * confirmed it (loadError).
   */
  onMachine: boolean | null;
  /** Why the connected machine has not confirmed the version (Decaid's barrier failed, D55); null otherwise. */
  loadError: string | null;
  note: string | null;
}

export type AdjustmentResultPayload =
  /**
   * onMachine and loadError: as for a template pick, for the new version;
   * onMachine is also null when no profile changed (grind, dose, none).
   */
  | { applied: true; variable: string; version: number | null; title: string | null; onMachine: boolean | null; loadError: string | null }
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

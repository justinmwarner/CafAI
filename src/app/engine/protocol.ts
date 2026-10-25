/**
 * The engine side of docs/briefs/ENGINE_PROTOCOL.md: how app events become
 * user turns, and how to recover pending tool calls from a stored transcript.
 * Pure functions; the scripted fake model in mock/anthropic parses exactly
 * these shapes.
 */
import { EVENT, type SaveBagDetails } from '../../coach/contract.ts';
import { finestFirst } from '../../coach/grinder.ts';
import type { GrinderInfo, ShotSummary } from '../../coach/types.ts';
import type { ContentBlock, LlmMessage, TextBlock, ToolResultBlock, ToolUseBlock } from '../../llm/types.ts';
import type { ShotBaseline } from '../types.ts';

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
 * last saved, which way its numbers go finer (D241), and how its dial moves
 * when it is linked to Decaid's grinder library (D62). Every field is always
 * sent, null when unknown; build it with grinderPayload().
 */
export interface GrinderPayload {
  name: string | null;
  setting: string | null;
  /**
   * Which way the grinder's numbers go finer, for a linked grinder and a
   * typed one alike: "higher" when the barista said higher numbers are finer
   * on it (Settings > Grinder > Finer is, D241), else "lower" (D62).
   */
  finer: 'lower' | 'higher';
  /** Null when no grinder from Decaid's library is linked, or Decaid has no record of it. */
  settingType: GrinderInfo['settingType'] | null;
  /** A numeric dial's small step; null when unknown. */
  step: number | null;
  /** A preset grinder's settings, finest first whichever way its numbers go (finestFirst); null when unknown. */
  values: string[] | null;
  /**
   * Settings links this grinder from Decaid's library, also when Decaid no
   * longer lists it or has no step data for it: then the coach gives
   * directions only, as Settings tells the user.
   */
  linked: boolean;
}

/**
 * The grinder for the model: as last saved, with what Decaid's grinder
 * library says about its dial, and which way is finer (D241): the dial's
 * own `finerIsHigher` unless `finerIsHigher` is given, as it must be for a
 * typed grinder, which has no dial to carry it. The dial's `values` are in
 * Decaid's order; the payload's run finest first.
 */
export function grinderPayload(
  name: string | null,
  setting: string | null,
  dial: GrinderInfo | null,
  linked: boolean,
  finerIsHigher = dial?.finerIsHigher === true,
): GrinderPayload {
  const step = dial?.settingType === 'numeric' ? dial.smallStep : null;
  const values = dial?.settingType === 'preset' ? dial.values : null;
  return {
    name,
    setting,
    finer: finerIsHigher ? 'higher' : 'lower',
    settingType: dial?.settingType ?? null,
    step: step !== null && Number.isFinite(step) && step > 0 ? step : null,
    values: values && values.length > 0 ? finestFirst(values, finerIsHigher) : null,
    linked,
  };
}

export interface IntakeContext {
  grinder: GrinderPayload;
  scaleConnected: boolean;
  /** The dose in Decaid when CafAI coaches from it (12-25 g), else null. */
  doseG: number | null;
  /**
   * The bag's details when they came from Decaid's bean library or a photo
   * of the bag the user confirmed (6.1, 6.8): already saved. Null when the
   * user describes the bag.
   */
  bag: SaveBagDetails | null;
  /** "Roasted <date> (<n> days ago...)" when the roast date is known, else null (6.1). */
  roast: string | null;
  /** Today's date where the user is, "YYYY-MM-DD": what a roast date said in words counts from. */
  today: string;
}

/** The first user turn of a bag: the user's words plus the app context block. */
export function intakeBlocks(text: string, context: IntakeContext): ContentBlock[] {
  return [textBlock(text), textBlock(`${EVENT.context}\n${JSON.stringify(context)}`)];
}

/** A bag's details in one line for the coach, fields apart by semicolons (an origin has commas of its own). */
function bagFacts(bag: SaveBagDetails): string[] {
  return [
    bag.origin,
    bag.process,
    bag.roastLevel ? `${bag.roastLevel} roast` : null,
    bag.roastDate ? `roasted ${bag.roastDate}` : null,
    bag.notes ? `tasting notes: ${bag.notes}` : null,
  ].filter((fact): fact is string => fact !== null && fact !== '');
}

/** The first words of a bag picked from Decaid's bean library (6.1). */
export function pickedIntakeText(bag: SaveBagDetails): string {
  const by = bag.roaster ? ` by ${bag.roaster}` : '';
  const facts = bagFacts(bag);
  return `The user picked ${bag.name}${by} from Decaid's bean library: ${facts.length > 0 ? facts.join('; ') : 'no other details'}.`;
}

/** The first words of a bag read from a photo the user confirmed (6.8). */
export function photoIntakeText(bag: SaveBagDetails): string {
  const coffee = bag.roaster ? `${bag.name} by ${bag.roaster}` : bag.name;
  return `The user confirmed these details read from a photo of the bag: ${[coffee, ...bagFacts(bag)].join('; ')}.`;
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
  /** The roast as at intake, its age counted to the day of the shot (6.1); null when the roast date is unknown. */
  roast: string | null;
  /** The day of the shot where the user is, "YYYY-MM-DD": a roast date said in words after it counts from here, not from intake. */
  today: string;
  summary: Omit<ShotSummary, 'series'>;
  /**
   * A fun fact is due (D197, D201): the barista kept this recipe and the shot
   * ran like the last one. `told` names the 40 facts told most recently, any
   * bag's, newest first; `web` is true when the coach may search for one
   * (D203). Only in the coach's modes and only when due; absent otherwise.
   */
  funFact?: { told: string[]; web: boolean };
}

export function summaryForModel(summary: ShotSummary): Omit<ShotSummary, 'series'> {
  const { series: _series, ...rest } = summary;
  return rest;
}

export function shotCompletedBlock(payload: ShotCompletedPayload): TextBlock {
  return textBlock(`${EVENT.shotCompleted}\n${JSON.stringify(payload)}`);
}

/**
 * The barista's verdict on a shot (D126): the word they tapped on its card,
 * in lower case, and what the shot was compared with. It goes with the next
 * user turn after the verdict was given or changed, since the shot's own
 * event left before the barista could answer.
 */
export interface ShotRatedPayload {
  shotId: string;
  verdict: string;
  comparedWith: ShotBaseline;
}

export function shotRatedBlock(payload: ShotRatedPayload): TextBlock {
  return textBlock(`${EVENT.shotRated}\n${JSON.stringify(payload)}`);
}

/**
 * The barista's refractometer reading of a shot (D167): the TDS they
 * typed on its card and the EY CafAI worked out from it with the card's dose
 * and yield (null without either), or `tdsPct` null when they removed the
 * reading. Like a verdict, it goes with the next user turn after the reading
 * was given, changed or removed.
 */
export interface ShotMeasuredPayload {
  shotId: string;
  tdsPct: number | null;
  eyPct: number | null;
  doseG: number | null;
  yieldG: number | null;
}

export function shotMeasuredBlock(payload: ShotMeasuredPayload): TextBlock {
  return textBlock(`${EVENT.shotMeasured}\n${JSON.stringify(payload)}`);
}

/** The share_fun_fact result once the fact is in the chat (D201). */
export const FACT_SHOWN = { shown: true } as const;
/** A second share_fun_fact in one model run: sent back, never shown. */
export const ONE_FACT_PER_REPLY = 'One fun fact per reply.';
/** A share_fun_fact with no shot due one and nothing the barista typed: one fact per shot (D197), or one asked for. */
export const FACT_NOT_DUE = 'Not shown: a fun fact goes once with a shot whose event carries "funFact", or when the barista asks for one.';
/** A share_fun_fact found unanswered after a reload whose fact is not in the chat: it is not shown now. */
export const FACT_NOT_SHOWN_AGAIN = { shown: false, note: 'CafAI reloaded before answering this call; the fact is not shown again.' } as const;

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
 * The offer_grinder result (D125): the grinder CafAI linked, as the model
 * hears a grinder (`alreadyInDecaid` when Decaid had it, so nothing was
 * added), or that the user chose Not now.
 */
export type GrinderOfferResultPayload =
  | { added: true; alreadyInDecaid: boolean; grinder: GrinderPayload }
  | { added: false; reason: string };

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

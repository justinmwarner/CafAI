/**
 * The barista's refractometer reading on a shot's card (D166, D167):
 * it lives in the card's summary (tdsPct and eyPct, src/coach/extraction.ts),
 * and the coach hears it with the next turn it is sent, as it hears a verdict
 * (D126).
 *
 * The transcript is the record of what the coach heard, so the readings it
 * has yet to hear are the cards whose reading is not the last one the
 * transcript told for their shot: a reading is told once, a changed one
 * again, and a removed one as removed (only when one was told), and a reload
 * before the next turn loses none of them.
 */
import { EVENT } from '../../coach/contract.ts';
import { readingOf, withTds } from '../../coach/extraction.ts';
import type { LlmMessage } from '../../llm/types.ts';
import type { CoachUiMessage, CoachUiPart } from '../types.ts';
import type { ShotMeasuredPayload } from './protocol.ts';
import { updatePart } from './uiMessages.ts';

type ShotPart = Extract<CoachUiPart, { kind: 'shot' }>;

/** The card of `shotId` in the chat, or undefined. */
export function shotCard(messages: readonly CoachUiMessage[], shotId: string): ShotPart | undefined {
  for (const m of messages) {
    for (const part of m.parts) if (part.kind === 'shot' && part.shotId === shotId) return part;
  }
  return undefined;
}

/** The chat with the card of `shotId` holding the reading `tdsPct` (null: none) in its summary, its EY worked out from the card's dose and yield. */
export function setShotTds(messages: readonly CoachUiMessage[], shotId: string, tdsPct: number | null): CoachUiMessage[] {
  return updatePart(
    messages,
    (part) => part.kind === 'shot' && part.shotId === shotId,
    (part) => (part.kind === 'shot' ? { ...part, summary: withTds(part.summary, tdsPct) } : part),
  );
}

/** What the transcript last said about a shot's reading: null numbers for none. */
interface Told {
  tdsPct: number | null;
  eyPct: number | null;
}

function payloadOf(text: string, marker: string): Record<string, unknown> | null {
  if (!text.startsWith(`${marker}\n`)) return null;
  try {
    const payload: unknown = JSON.parse(text.slice(marker.length + 1));
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The reading a transcript block told: a reading event, or a shot's own event,
 * whose summary carries the reading its record came with (or none).
 */
function toldReading(text: string): { shotId: string; told: Told } | null {
  const measured = payloadOf(text, EVENT.shotMeasured);
  if (measured) {
    const { shotId } = measured;
    return typeof shotId === 'string' ? { shotId, told: { tdsPct: numberOrNull(measured.tdsPct), eyPct: numberOrNull(measured.eyPct) } } : null;
  }
  const shot = payloadOf(text, EVENT.shotCompleted);
  if (!shot || typeof shot.shotId !== 'string') return null;
  const summary = typeof shot.summary === 'object' && shot.summary !== null ? (shot.summary as Record<string, unknown>) : {};
  const reading = readingOf({ tdsPct: summary.tdsPct as number | undefined, eyPct: summary.eyPct as number | null | undefined });
  return { shotId: shot.shotId, told: { tdsPct: reading?.tdsPct ?? null, eyPct: reading?.eyPct ?? null } };
}

/**
 * The readings the coach has not heard, in the chat's order: each card whose
 * reading (or its absence, once one was told) is not what the transcript
 * last told for its shot. A card whose summary CafAI cannot read is not told.
 */
export function untoldReadings(apiMessages: readonly LlmMessage[], messages: readonly CoachUiMessage[]): ShotMeasuredPayload[] {
  const told = new Map<string, Told>();
  for (const turn of apiMessages) {
    if (turn.role !== 'user') continue;
    for (const block of turn.content) {
      const said = block.type === 'text' ? toldReading(block.text) : null;
      if (said) told.set(said.shotId, said.told);
    }
  }
  const untold: ShotMeasuredPayload[] = [];
  for (const m of messages) {
    for (const part of m.parts) {
      if (part.kind !== 'shot' || typeof part.summary !== 'object' || part.summary === null) continue;
      const reading = readingOf(part.summary);
      const before = told.get(part.shotId) ?? { tdsPct: null, eyPct: null };
      const now: Told = { tdsPct: reading?.tdsPct ?? null, eyPct: reading?.eyPct ?? null };
      if (before.tdsPct === now.tdsPct && before.eyPct === now.eyPct) continue;
      untold.push({ shotId: part.shotId, ...now, doseG: numberOrNull(part.summary.doseG), yieldG: numberOrNull(part.summary.yieldG) });
    }
  }
  return untold;
}

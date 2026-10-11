/**
 * The barista's verdict on a shot (D126): what the shot is compared with,
 * the running score Decaid's `enjoyment` gets, and which verdicts the coach
 * has yet to hear.
 *
 * The words are CafAI's truth and stay on the shot card. Decaid and
 * Visualizer still want a number, so each verdict also gets a running score
 * out of 10: a bag's first rated shot starts at the middle, and each later
 * one is the score of the shot it was compared with plus one step per word
 * (two for "much"), kept within 0-10. A shot nobody rated carries the score
 * before it, and stars given before D126 count as twice their number, as
 * they were written. A Decaid that rates out of 100 gets ten times the
 * score (D101), so Visualizer shows the same number from either.
 */
import type { EnjoymentScale } from '../../api/types.ts';
import { EVENT } from '../../coach/contract.ts';
import type { LlmMessage } from '../../llm/types.ts';
import { SHOT_VERDICTS, SHOT_VERDICT_WORDS, type CoachUiMessage, type CoachUiPart, type ShotBaseline, type ShotVerdict } from '../types.ts';
import type { ShotRatedPayload } from './protocol.ts';

type ShotPart = Extract<CoachUiPart, { kind: 'shot' }>;

/** The running score of a bag's first rated shot, out of 10. */
export const MIDDLE_SCORE = 5;
/** The top of the running score; its bottom is 0. */
export const TOP_SCORE = 10;
/** How far one word moves the score, out of 10; "much" moves it twice as far. */
export const SCORE_STEP = 1;

const STEPS: Readonly<Record<ShotVerdict, number>> = { muchWorse: -2, worse: -1, same: 0, better: 1, muchBetter: 2 };

export function isShotVerdict(value: unknown): value is ShotVerdict {
  return typeof value === 'string' && (SHOT_VERDICTS as readonly string[]).includes(value);
}

/** The word on the card in lower case, as the coach hears it. */
export function verdictWord(verdict: ShotVerdict): string {
  return SHOT_VERDICT_WORDS[verdict].toLowerCase();
}

/** The shot cards of a chat in order, each with when it was posted. */
function shotCards(messages: readonly CoachUiMessage[]): Array<{ part: ShotPart; at: string }> {
  return messages.flatMap((m) => m.parts.flatMap((part) => (part.kind === 'shot' ? [{ part, at: m.createdAt }] : [])));
}

/**
 * A card's score out of 10: its verdict's, or stars from before D126 at
 * twice their number; null when unrated, or when what is stored is not a
 * number (an edited import), so the score before it counts instead.
 */
export function scoreOf(part: ShotPart): number | null {
  const score = part.rating ? part.rating.score : typeof part.stars === 'number' ? part.stars * 2 : null;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}

/**
 * The running score out of 10 for `verdict` on the card of `shotId`: the
 * score of the card before it, or of the latest scored card before that,
 * moved by the verdict's steps; the middle when no card before it has a
 * score, as for the bag's first rated shot. Null when the chat has no such
 * card.
 */
export function runningScore(messages: readonly CoachUiMessage[], shotId: string, verdict: ShotVerdict): number | null {
  const cards = shotCards(messages).map((card) => card.part);
  const index = cards.findIndex((card) => card.shotId === shotId);
  if (index < 0) return null;
  const before = cards
    .slice(0, index)
    .reverse()
    .map(scoreOf)
    .find((score): score is number => score !== null);
  if (before === undefined) return MIDDLE_SCORE;
  return Math.min(TOP_SCORE, Math.max(0, before + SCORE_STEP * STEPS[verdict]));
}

/** A running score as Decaid's `enjoyment` on the scale it uses (D101): as it is out of 10, ten times it out of 100. */
export function enjoymentFromScore(score: number, scale: EnjoymentScale): number {
  return score * (scale / TOP_SCORE);
}

/** A shot CafAI credited to another bag: what a bag's first shot may be compared with. */
export interface CreditedShot {
  shotId: string;
  /** That bag's name, or null while it has none. */
  coffee: string | null;
  /** When CafAI credited it (ISO 8601). */
  at: string;
}

/**
 * What the card of `shotId` compares the shot with (D126): the shot card
 * before it in the chat; for the chat's first shot, the last of `others`
 * (shots of other bags) credited by the time it was posted; without one,
 * the coffee the barista usually enjoys. Null when the chat has no such
 * card.
 */
export function baselineFor(messages: readonly CoachUiMessage[], shotId: string, others: readonly CreditedShot[]): ShotBaseline | null {
  const cards = shotCards(messages);
  const index = cards.findIndex((card) => card.part.shotId === shotId);
  if (index < 0) return null;
  const previous = cards[index - 1];
  if (previous) return { kind: 'previous', shotId: previous.part.shotId };
  // A card whose time cannot be read compares with the last shot of all.
  const posted = Date.parse(cards[index]!.at);
  const until = Number.isNaN(posted) ? Infinity : posted;
  let last: { shot: CreditedShot; at: number } | null = null;
  for (const shot of others) {
    const at = Date.parse(shot.at);
    if (at <= until && (last === null || at > last.at)) last = { shot, at };
  }
  return last ? { kind: 'otherCoffee', shotId: last.shot.shotId, coffee: last.shot.coffee } : { kind: 'usual' };
}

/** A card that does not say yet what it compares with: made before D126, and neither rated nor starred. */
export function needsBaseline(part: CoachUiPart): boolean {
  return part.kind === 'shot' && part.baseline === undefined && part.rating === undefined && part.stars === undefined;
}

/** The chat with a baseline on every card that needs one (`others` as for baselineFor); unchanged messages keep their identity. */
export function fillBaselines(messages: CoachUiMessage[], others: readonly CreditedShot[]): CoachUiMessage[] {
  if (!messages.some((m) => m.parts.some(needsBaseline))) return messages;
  return messages.map((m) => {
    if (!m.parts.some(needsBaseline)) return m;
    const parts = m.parts.map((part) => {
      if (part.kind !== 'shot' || !needsBaseline(part)) return part;
      const baseline = baselineFor(messages, part.shotId, others);
      return baseline ? { ...part, baseline } : part;
    });
    return { ...m, parts };
  });
}

/** The verdict a transcript block told, or null for any other block. */
function toldVerdict(text: string): { shotId: string; verdict: string } | null {
  if (!text.startsWith(`${EVENT.shotRated}\n`)) return null;
  try {
    const payload: unknown = JSON.parse(text.slice(EVENT.shotRated.length + 1));
    if (typeof payload !== 'object' || payload === null) return null;
    const { shotId, verdict } = payload as Record<string, unknown>;
    return typeof shotId === 'string' && typeof verdict === 'string' ? { shotId, verdict } : null;
  } catch {
    return null;
  }
}

/**
 * The verdicts the coach has not heard (D126), in the chat's order: each
 * rated card whose verdict is not the last one the transcript told for its
 * shot. The transcript is the record of what the coach heard, so a verdict
 * is told once, a changed one is told again, and a reload before the next
 * turn loses neither.
 */
export function untoldRatings(apiMessages: readonly LlmMessage[], messages: readonly CoachUiMessage[]): ShotRatedPayload[] {
  const told = new Map<string, string>();
  for (const turn of apiMessages) {
    if (turn.role !== 'user') continue;
    for (const block of turn.content) {
      const said = block.type === 'text' ? toldVerdict(block.text) : null;
      if (said) told.set(said.shotId, said.verdict);
    }
  }
  return shotCards(messages).flatMap(({ part }) => {
    if (!part.rating || !part.baseline) return [];
    const verdict = verdictWord(part.rating.verdict);
    return told.get(part.shotId) === verdict ? [] : [{ shotId: part.shotId, verdict, comparedWith: part.baseline }];
  });
}

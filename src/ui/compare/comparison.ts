/**
 * The shot drawn faintly under another (D-CURVE-1 to D-CURVE-5): which one,
 * its curve on the pour's clock, and the words that name it. Pure.
 *
 * Which shot: the one the card's question names (its baseline, D126), so the
 * card never asks about one shot and draws another. The previous shot in the
 * bag's chat for most shots; a bag's first shot is compared with the last
 * shot of another coffee; the very first with the coffee the barista usually
 * enjoys, which has no curve, so that card draws its own shot alone.
 *
 * The clock: both curves count from the pour's start (`pourStartS`, the
 * first frame after preheat), as the Shot view's clock and the card's times
 * do, so two shots whose preheats differ still line up.
 */
import type { CoachUiMessage, CoachUiPart, ShotBaseline } from '../../app/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import { formatBar, formatGrams, formatSeconds } from '../chat/format.ts';

/** The shot to draw under another, and the words the key gives it. */
export interface ComparisonTarget {
  shotId: string;
  /** "Previous shot", "Last shot of Red Brick", or "Last shot" while that bag had no name. */
  name: string;
}

export const PREVIOUS_SHOT = 'Previous shot';

/** The shot a card's question names, or null when it names none (the usual coffee, no question). */
export function comparisonTarget(baseline: ShotBaseline | null | undefined): ComparisonTarget | null {
  if (!baseline) return null;
  if (baseline.kind === 'previous') return { shotId: baseline.shotId, name: PREVIOUS_SHOT };
  if (baseline.kind === 'otherCoffee') {
    return { shotId: baseline.shotId, name: baseline.coffee ? `Last shot of ${baseline.coffee}` : 'Last shot' };
  }
  return null;
}

export function sameTarget(a: ComparisonTarget | null, b: ComparisonTarget | null): boolean {
  return a === b || (a !== null && b !== null && a.shotId === b.shotId && a.name === b.name);
}

/** A shot's pressure and flow, its times in seconds from the pour's start, ascending. */
export interface PourCurve {
  t: readonly number[];
  pressure: readonly (number | null)[];
  flow: readonly (number | null)[];
  /** The time of the curve's last point: where it ends (0 with none). */
  endS: number;
}

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const curves = new WeakMap<ShotSummary, PourCurve>();

/**
 * The summary's ~1 Hz pressure and flow on the pour's clock: the preheat
 * left out but for its last point, pinned at 0, so the curve starts where the
 * pour does. A summary saved before CafAI recorded `pourStartS` keeps its own
 * times, as its card always showed them. Worked out once per summary.
 */
export function pourCurve(summary: ShotSummary): PourCurve {
  const known = curves.get(summary);
  if (known) return known;
  const start = finite(summary.pourStartS) ?? 0;
  const { tS, pressure, flow } = summary.series;
  const t: number[] = [];
  const p: (number | null)[] = [];
  const f: (number | null)[] = [];
  const count = Math.min(tS.length, pressure.length, flow.length);
  for (let i = 0; i < count; i += 1) {
    const raw = finite(tS[i]);
    if (raw === null) continue;
    const at = raw - start;
    if (at < 0) {
      // Only the preheat's last point, as the pour's start.
      const next = finite(tS[i + 1]);
      if (next === null || next - start <= 0) continue;
    }
    const time = Math.max(0, at);
    if (t.length > 0 && time <= t[t.length - 1]!) continue;
    t.push(time);
    p.push(finite(pressure[i]));
    f.push(finite(flow[i]));
  }
  const curve: PourCurve = { t, pressure: p, flow: f, endS: t.length > 0 ? t[t.length - 1]! : 0 };
  curves.set(summary, curve);
  return curve;
}

/** True when the curve has something to draw: two points or more, one with a reading. */
export function hasCurve(curve: PourCurve): boolean {
  return curve.t.length >= 2 && (curve.pressure.some((v) => v !== null) || curve.flow.some((v) => v !== null));
}

type ShotPart = Extract<CoachUiPart, { kind: 'shot' }>;

const cardIndex = new WeakMap<readonly CoachUiMessage[], Map<string, ShotPart>>();

/** Every shot card of a chat by its shot id, built once per messages array (the engine replaces it on every change). */
function shotCards(messages: readonly CoachUiMessage[]): Map<string, ShotPart> {
  const known = cardIndex.get(messages);
  if (known) return known;
  const cards = new Map<string, ShotPart>();
  for (const message of messages) {
    for (const part of message.parts) if (part.kind === 'shot') cards.set(part.shotId, part);
  }
  cardIndex.set(messages, cards);
  return cards;
}

/** The chat's card for a shot, or null. */
export function shotCardOf(messages: readonly CoachUiMessage[], shotId: string): ShotPart | null {
  return shotCards(messages).get(shotId) ?? null;
}

/** The shot's summary from its card in the chat, when the card is there and keeps a curve; null otherwise. */
export function chatShotSummary(messages: readonly CoachUiMessage[], shotId: string): ShotSummary | null {
  const summary = shotCardOf(messages, shotId)?.summary;
  return summary && Array.isArray(summary.series?.tS) && hasCurve(pourCurve(summary)) ? summary : null;
}

/** The newest shot card's shot id, leaving out `except` (the shot on screen); null without one. */
export function newestShotId(messages: readonly CoachUiMessage[], except: string | null = null): string | null {
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    const parts = messages[m]!.parts;
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p]!;
      if (part.kind === 'shot' && part.shotId !== except) return part.shotId;
    }
  }
  return null;
}

/** "previous shot", "last shot of Red Brick": the key's name inside a sentence. */
function inSentence(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** What the plot or the card's curves add to their name when a shot is drawn under them. */
export function underThem(target: ComparisonTarget): string {
  return `with the pressure and flow of your ${inSentence(target.name)} under them`;
}

/** The shot under, for a screen reader: "Previous shot: 28.1 s, peak pressure 9.0 bar." */
export function describeShot(target: ComparisonTarget, summary: ShotSummary): string {
  const facts = [formatSeconds(finite(summary.durationS))];
  const peak = finite(summary.peakPressureBar);
  if (peak !== null) facts.push(`peak pressure ${formatBar(peak)}`);
  return `${target.name}: ${facts.join(', ')}.`;
}

/** The Shot view's key line after the name: "28.1 s · 36.2 g" (the yield left out when there is none). */
export function keyFacts(summary: ShotSummary): string {
  const facts = [formatSeconds(finite(summary.durationS))];
  const yieldG = finite(summary.yieldG);
  if (yieldG !== null) facts.push(formatGrams(yieldG));
  return facts.join(' · ');
}

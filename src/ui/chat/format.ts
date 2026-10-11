/**
 * Display formatting shared by the chat cards and the history screen.
 * Numbers are shown to one decimal, the precision the shot summary is
 * rounded to, so cards and the model talk about the same values.
 */
import type { SetAsideReason } from '../../app/types.ts';
import type { Confidence } from '../../coach/contract.ts';
import type { ShotSummary } from '../../coach/types.ts';

const DASH = '–';

function oneDecimal(value: number | null, unit: string): string {
  return value === null || !Number.isFinite(value) ? DASH : `${value.toFixed(1)} ${unit}`;
}

export function formatSeconds(seconds: number | null): string {
  return oneDecimal(seconds, 's');
}

export function formatGrams(grams: number | null): string {
  return oneDecimal(grams, 'g');
}

export function formatBar(bar: number | null): string {
  return oneDecimal(bar, 'bar');
}

export function formatRatio(ratio: number | null): string {
  return ratio === null || !Number.isFinite(ratio) ? DASH : `1:${ratio.toFixed(1)}`;
}

/** Brew ratio (yield / dose): the summary's own value, else computed when both weights are known. */
export function shotRatio(summary: Pick<ShotSummary, 'ratio' | 'doseG' | 'yieldG'>): number | null {
  if (summary.ratio !== null) return summary.ratio;
  if (summary.doseG === null || summary.yieldG === null || summary.doseG <= 0) return null;
  return summary.yieldG / summary.doseG;
}

const CHANNELING_WORDS: Record<string, string> = {
  pressure_dip: 'Pressure dipped after the peak',
  pressure_dip_after_peak: 'Pressure dipped after the peak',
  flow_instability: 'Flow was unsteady',
  flow_divergence: 'Pump and scale flow disagreed',
  pump_scale_divergence: 'Pump and scale flow disagreed',
  early_drops: 'Early drips',
  early_first_drops: 'Early drips',
  resistance_trend: 'Puck resistance fell during the pour',
  falling_resistance: 'Puck resistance fell during the pour',
};

/** A channeling indicator name (from the shot summarizer) as words a barista reads at a glance. */
export function describeChannelingFlag(flag: string): string {
  const known = CHANNELING_WORDS[flag];
  if (known) return known;
  const words = flag
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function confidenceLabel(confidence: Confidence): string {
  return `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`;
}

/**
 * Why a card was set aside, as one sentence. `typed` is the card's own
 * wording for a reply typed in the chat; a card stored before CafAI recorded
 * the reason reads as the conversation having moved on.
 */
export function setAsideNote(reason: SetAsideReason | undefined, typed: string): string {
  switch (reason) {
    case 'typed':
      return typed;
    case 'undo':
      return 'Set aside when you tapped Undo.';
    case 'shot':
      return 'Set aside: a new shot came in.';
    default:
      return 'Set aside: the conversation moved on.';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "3 Oct 2026, 08:05" in local time. Built by hand rather than with
 * toLocaleString so it reads the same on every tablet locale.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hh}:${mm}`;
}

/**
 * "3 Sep 2026" for a calendar day ("YYYY-MM-DD"), read from its own digits:
 * through Date a plain date is midnight UTC, the day before west of Greenwich.
 */
export function formatDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : day;
}

export interface DiffLineParts {
  label: string;
  before: string;
  after: string;
}

/**
 * Splits the coach's plain-language diff lines ("Yield: 36 g -> 38 g") so a
 * card can dim the old value and stress the new one. Other lines stay whole.
 */
export function splitDiffLine(line: string): DiffLineParts | null {
  const match = /^([^:]+):\s*(.+?)\s*(?:->|→)\s*(.+)$/.exec(line);
  if (!match) return null;
  const [, label, before, after] = match;
  if (!label || !before || !after) return null;
  return { label: label.trim(), before: before.trim(), after: after.trim() };
}

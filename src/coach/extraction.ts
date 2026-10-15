/**
 * TDS and EY (D-TDS-1 to D-TDS-3): the barista's refractometer reading on a
 * shot's card, and the extraction yield CafAI works out from it.
 *
 * TDS (total dissolved solids) is what a refractometer reads: the share of
 * the drink that is dissolved coffee, in %. EY (extraction yield) is the
 * share of the dose that ended up in the cup: TDS x yield / dose. CafAI uses
 * the dose and the yield on the shot's card (the summary's doseG and yieldG,
 * the numbers its ratio comes from), so EY = TDS x ratio, and a barista can
 * check it by hand from the card.
 *
 * Plain functions: the card's field, the engine and the summariser share them.
 */
import type { ShotSummary } from './types.ts';

/** The smallest TDS CafAI takes, % (refractometers read to 0.01 %). */
export const TDS_MIN_PCT = 0.01;
/** The largest TDS CafAI takes, %: the top of the refractometers baristas use (VST, Atago, DiFluid read 0-25 %). */
export const TDS_MAX_PCT = 25;
/** More than this EY, %, is more than coffee gives up: the reading, the dose or the yield is off (D-TDS-8). */
export const EY_MAX_PCT = 30;

const round = (value: number, digits: number) => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

/** A TDS as CafAI keeps it: to 0.01 %. */
export const roundTds = (tdsPct: number) => round(tdsPct, 2);

/** A TDS CafAI takes: a finite number of more than 0 and at most 25 %, once rounded to 0.01. */
export function isTds(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const rounded = roundTds(value);
  return rounded >= TDS_MIN_PCT && rounded <= TDS_MAX_PCT;
}

const positive = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/**
 * EY, % to 0.1: TDS x yield / dose. Null without a dose or a yield (no scale,
 * a scale CafAI does not trust, no dose in Decaid): the TDS stands alone.
 */
export function extractionYield(tdsPct: number, doseG: number | null | undefined, yieldG: number | null | undefined): number | null {
  const dose = positive(doseG);
  const cup = positive(yieldG);
  if (dose === null || cup === null || !Number.isFinite(tdsPct)) return null;
  return round((tdsPct * cup) / dose, 1);
}

/** What a shot's summary says about its reading. */
export interface ShotReading {
  tdsPct: number;
  /** Null when the shot has no dose or no yield. */
  eyPct: number | null;
}

/** A summary's reading, or null when it has none (or one CafAI cannot read: an edited import). */
export function readingOf(summary: Pick<ShotSummary, 'tdsPct' | 'eyPct'> | null | undefined): ShotReading | null {
  const tds = summary?.tdsPct;
  if (!isTds(tds)) return null;
  const ey = summary?.eyPct;
  return { tdsPct: roundTds(tds), eyPct: typeof ey === 'number' && Number.isFinite(ey) ? ey : null };
}

/**
 * The summary with a reading (its EY worked out from the summary's own dose
 * and yield), or without one: `null` takes both numbers out. A TDS CafAI
 * does not take leaves the summary as it was. Never changes the summary
 * passed in.
 */
export function withTds<S extends ShotSummary>(summary: S, tdsPct: number | null): S {
  if (tdsPct === null) {
    if (!('tdsPct' in summary) && !('eyPct' in summary)) return summary;
    const { tdsPct: _tds, eyPct: _ey, ...rest } = summary;
    return rest as S;
  }
  if (!isTds(tdsPct)) return summary;
  const tds = roundTds(tdsPct);
  return { ...summary, tdsPct: tds, eyPct: extractionYield(tds, summary.doseG, summary.yieldG) };
}

/** The field's words when what was typed is not a TDS CafAI takes. */
export const TDS_NOT_A_NUMBER = 'Type the TDS as a number, like 9.25.';
export const TDS_TOO_LOW = 'A TDS is more than 0, like 9.25.';
export const TDS_TOO_HIGH = `That is more than a refractometer reads (${TDS_MAX_PCT} %). Check the number.`;

export type TdsInput = { ok: true; tdsPct: number | null } | { ok: false; message: string };

/**
 * What the card's field makes of what was typed: a TDS to 0.01 %, null for
 * nothing (no reading), or why not. A comma reads as a decimal point (the
 * numeric keyboard of some locales offers only a comma), and a "%" at the
 * end, or spaces, are allowed.
 */
export function readTdsInput(text: string): TdsInput {
  const trimmed = text.trim().replace(/\s*%$/, '').trim();
  if (trimmed === '') return { ok: true, tdsPct: null };
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return { ok: false, message: TDS_NOT_A_NUMBER };
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, message: TDS_NOT_A_NUMBER };
  const tdsPct = roundTds(value);
  if (tdsPct < TDS_MIN_PCT) return { ok: false, message: TDS_TOO_LOW };
  if (tdsPct > TDS_MAX_PCT) return { ok: false, message: TDS_TOO_HIGH };
  return { ok: true, tdsPct };
}

/** "9.25 %": a TDS as the card, History and the coach's words show it, always to 0.01. */
export function formatTds(tdsPct: number): string {
  return `${roundTds(tdsPct).toFixed(2)} %`;
}

/** "20.8 %": an EY as the card shows it, to 0.1. */
export function formatEy(eyPct: number): string {
  return `${round(eyPct, 1).toFixed(1)} %`;
}

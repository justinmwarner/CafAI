/**
 * How Settings > Coach > Usage and cost writes its numbers (D239): tokens in
 * k and M, dollars to the cent (and a cost under a cent as under one, so a
 * month of a few Haiku replies never reads as free), shares in whole percent,
 * and days as the barista says them. A number and its unit, and a date's
 * parts, are joined by no-break spaces, so a narrow card never parts them at
 * a line's end.
 */
import { formatUsd, resumeDay } from '../../spend/budget.ts';
import type { BudgetState } from '../../spend/types.ts';

const NBSP = '\xa0';

const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * "950", "4.3 k", "412 k", "1.2 M": one decimal under ten of a unit, whole
 * ones above, so a count never shows "10.0 k".
 */
export function formatTokens(count: number): string {
  const tokens = Math.max(0, Math.round(count));
  if (tokens < 1000) return String(tokens);
  if (tokens < 9_950) return `${(tokens / 1000).toFixed(1)}${NBSP}k`;
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}${NBSP}k`;
  if (tokens < 9_950_000) return `${(tokens / 1_000_000).toFixed(1)}${NBSP}M`;
  return `${grouped(Math.round(tokens / 1_000_000))}${NBSP}M`;
}

/** "$1.84"; a cost that rounds to no cents but is not nothing, "< $0.01". */
export function formatCost(micros: number): string {
  return micros > 0 && micros < 5_000 ? `<${NBSP}$0.01` : formatUsd(micros);
}

/** A share, 0 to 1 (or past 1), as "37 %". */
export function formatPercent(share: number): string {
  return `${Math.round(Math.max(0, share) * 100)}${NBSP}%`;
}

/**
 * The month's spend as a whole percent of the budget, rounded but kept on
 * its own side of each step (D240: near from 80 %, over at 100 %), so the
 * words beside the meter never say 80 % while the meter is still green, or
 * 100 % before the budget is reached. Null without a budget.
 */
export function budgetPercent(state: BudgetState): number | null {
  if (state.ratio === null) return null;
  const percent = Math.round(state.ratio * 100);
  if (state.step === 'under') return Math.min(percent, 79);
  if (state.step === 'near') return Math.min(Math.max(percent, 80), 99);
  return Math.max(percent, 100);
}

/** 'YYYY-MM-DD' as "4 October", kept on one line. */
export function sayDay(day: string): string {
  return resumeDay(day).replace(' ', NBSP);
}

/** 'YYYY-MM-DD' as "24 October 2026", kept on one line. */
export function sayDate(day: string): string {
  return `${sayDay(day)}${NBSP}${day.slice(0, 4)}`;
}

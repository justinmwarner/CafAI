/**
 * How old a coffee is (6.1): calendar days from its roast date to today,
 * less the days its batch spent in a freezer when Decaid's bean library
 * says so. Dates are calendar days, "YYYY-MM-DD".
 *
 * A roast, freeze or thaw date names a day, not an instant, so it is read as
 * written whatever zone its timestamp carries: Decaid writes a date it was
 * given as local time without a zone and echoes one given in UTC as UTC, and
 * DYE2 writes roast dates with toISOString(). Read on the local calendar, a
 * UTC midnight would be the day before west of Greenwich. Only a moment
 * something happened (DYE2's capturedAt) moves to this device's calendar.
 */

/** A batch's freezer dates, as Decaid's bean library records them. */
export interface FreezerDates {
  freezeDate?: string | null;
  /** Absent or null while the batch has not been thawed. */
  unfreezeDate?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A date, alone or at the start of a timestamp (any zone, or none). */
const WRITTEN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ]\d{2}:\d{2})/;
/** A timestamp whose zone is given ('Z' or an offset): it names an instant. */
const ZONED = /^\d{4}-\d{2}-\d{2}[T ].*(?:Z|[+-]\d{2}:?\d{2})$/i;

const pad = (n: number) => String(n).padStart(2, '0');

function calendarDate(year: number, month: number, day: number): string | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The day a date or timestamp is written with, "YYYY-MM-DD", whatever its zone; null for anything else. */
export function writtenDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = WRITTEN.exec(value.trim());
  return match ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/**
 * The day an instant falls on, on this device's calendar: a timestamp with a
 * zone moves to local time; a plain date or a zone-less timestamp is local
 * already. Null for anything else.
 */
export function localDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!ZONED.test(text)) return writtenDate(text);
  const at = new Date(text.replace(' ', 'T'));
  return Number.isNaN(at.getTime()) || writtenDate(text) === null ? null : dayOf(at);
}

/** Today on this device's calendar. */
function dayOf(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function daysBetween(from: string, to: string): number {
  const ms = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

/**
 * The days the batch spent frozen since the roast: from its freeze date to
 * its thaw date, or to today while it has none; never before the roast or
 * after today. 0 without freezer dates CafAI can read.
 */
export function freezerDays(roastDate: string | null | undefined, today: Date, batch?: FreezerDates | null): number {
  const roast = writtenDate(roastDate);
  const frozen = writtenDate(batch?.freezeDate);
  if (!roast || !frozen) return 0;
  const now = dayOf(today);
  const thawed = writtenDate(batch?.unfreezeDate) ?? now;
  const from = frozen > roast ? frozen : roast;
  const to = thawed < now ? thawed : now;
  return Math.max(0, daysBetween(from, to));
}

/**
 * The coffee's age in days: from the roast date to today, the days in the
 * freezer not counted. Null for a date CafAI cannot read or one after today.
 */
export function roastAgeDays(roastDate: string | null | undefined, today: Date, batch?: FreezerDates | null): number | null {
  const roast = writtenDate(roastDate);
  if (!roast) return null;
  const age = daysBetween(roast, dayOf(today));
  return age < 0 ? null : age - freezerDays(roast, today, batch);
}

/** Today's date on this device's calendar, "YYYY-MM-DD": what the coach counts a roast date in words from. */
export function todayOf(now: Date): string {
  return dayOf(now);
}

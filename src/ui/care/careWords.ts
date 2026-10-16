/**
 * What machine care's reminders say (D-CARE-1 to D-CARE-6): the stats card's
 * line, each step's last time on the Care screen, and what the water and the
 * intake filter set. Built by hand rather than with toLocaleString, so it
 * reads the same on every tablet locale (as src/ui/chat/format.ts does).
 */
import { DAY_MS, type StepStatus, type TrackedStepId } from '../../app/care/careRules.ts';
import type { CareSettings } from '../../storage/types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1,520": a comma every three digits, whatever the locale. */
export function grouped(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 shot", "41 shots", "1,520 shots". */
export function plural(n: number, word: string): string {
  return `${grouped(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** A stretch of time in the unit a barista would say it in: "9 days", "2 weeks", "13 months", "2 years". */
export function timeSpan(days: number): string {
  const whole = Math.max(0, Math.floor(days));
  if (whole < 14) return plural(whole, 'day');
  if (whole < 63) return plural(Math.floor(whole / 7), 'week');
  if (whole < 730) return plural(Math.floor(whole / 30.44), 'month');
  return plural(Math.floor(whole / 365.25), 'year');
}

/** "3 Oct", with the year when it is not this one: "3 Oct 2025". */
export function shortDate(ms: number, nowMs: number): string {
  const date = new Date(ms);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(nowMs).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** Calendar days from one moment to another, in local time: 0 the same day, 1 the day before. */
function calendarDays(fromMs: number, toMs: number): number {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(to) - start(from)) / DAY_MS);
}

/** "today", "yesterday", "9 days ago", "2 weeks ago". */
export function ago(atMs: number, nowMs: number): string {
  const days = calendarDays(atMs, nowMs);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${timeSpan(days)} ago`;
}

/** The steps with a reminder, by the short name the stats card's line gives them. */
export const LINE_NAMES = {
  'detergent-clean': 'Weekly clean',
  rinza: 'Rinza',
  'intake-filter': 'Intake filter',
  'group-parts': 'Group head soak',
  descale: 'Descale',
} as const satisfies Partial<Record<TrackedStepId, string>>;

/** What a due step's line counts: its shots or steams, or the time; the descale whichever made it due. */
function measure(status: StepStatus): string {
  const { reminder, shots, steams, days } = status;
  if (reminder?.counts === 'shots' && shots !== null) return plural(shots, 'shot');
  if (reminder?.counts === 'steams' && steams !== null) return plural(steams, 'steam');
  if (reminder?.shots !== undefined && shots !== null && days !== null && shots / reminder.shots >= days / reminder.days) return plural(shots, 'shot');
  return timeSpan(days ?? 0);
}

/**
 * The stats card's line for the most overdue step (D-CARE-6): "Weekly clean
 * due: 41 shots since the last", or since the day CafAI began counting for a
 * step never marked done.
 */
export function dueLine(status: StepStatus, nowMs: number): string {
  const name = (LINE_NAMES as Partial<Record<TrackedStepId, string>>)[status.step] ?? 'Machine care';
  const record = status.record;
  const since = record?.doneAt ? 'since the last' : `since ${shortDate(Date.parse(record?.countFrom ?? ''), nowMs)}`;
  return `${name} due: ${measure(status)} ${since}`;
}

/** What the machine's own cycle was, for a step CafAI saw done. */
const SEEN_CYCLES: Partial<Record<TrackedStepId, string>> = { 'detergent-clean': 'Clean', descale: 'Descale' };

/** A step's last time on the Care screen, in parts the row sets apart. */
export interface StepLine {
  /** "Due", for a step that is: said first, in the warning colour. */
  due: boolean;
  /** "Done today", "Last done 9 days ago", "Not marked done since 3 Oct". */
  last: string;
  /** Done today: in the success colour, with a check. */
  doneToday: boolean;
  /** The rest, joined by middle dots: "41 shots since", "due in 5 days"; empty when there is none. */
  details: string[];
}

export function stepLine(status: StepStatus, nowMs: number): StepLine {
  const { record, reminder, shots, steams } = status;
  const doneMs = record?.doneAt ? Date.parse(record.doneAt) : NaN;
  const done = Number.isFinite(doneMs);
  const doneToday = done && calendarDays(doneMs, nowMs) <= 0;
  let last: string;
  if (doneToday) last = 'Done today';
  else if (done) last = `Last done ${ago(doneMs, nowMs)}`;
  else last = record ? `Not marked done since ${shortDate(Date.parse(record.countFrom), nowMs)}` : 'Not marked done yet';
  const details: string[] = [];
  if (done && record?.by === 'seen' && SEEN_CYCLES[status.step]) details.push(`CafAI saw the machine's ${SEEN_CYCLES[status.step]}`);
  if (reminder && record) {
    const counted = reminder.counts === 'steams' ? steams : reminder.needs === 'shot' || reminder.shots !== undefined ? shots : null;
    const word = reminder.counts === 'steams' ? 'steam' : 'shot';
    if (counted !== null && !doneToday) details.push(counted === 0 ? `no ${word}s since` : `${plural(counted, word)} since`);
    if (!status.due && status.used && status.dueAtMs !== null) {
      // To the nearest day: the screen's clock moves once a minute, so a step marked a moment ago is a week away, not 8 days.
      const left = Math.round((status.dueAtMs - nowMs) / DAY_MS);
      details.push(left < 1 ? 'due today' : `due in ${timeSpan(left)}`);
    }
  }
  return { due: status.due, last, doneToday, details };
}

/** What sets the descale's reminder, as the descale step says it (D-CARE-5). */
export function waterLine(water: CareSettings['water']): string {
  switch (water) {
    case 'under30':
      return 'Your water is under 30 ppm: it needs no descaling, so CafAI does not remind you.';
    case 'to120':
      return 'Your water is 30 to 120 ppm: CafAI reminds you after a year, or 1,500 shots.';
    case 'over120':
      return 'Your water is over 120 ppm: CafAI reminds you after six months, or 800 shots.';
    default:
      return 'CafAI does not know your water, so it reminds you as for 30 to 120 ppm: after a year, or 1,500 shots.';
  }
}

/** What sets the intake filter's reminder (D-CARE-5). */
export function filterLine(filter: CareSettings['filter']): string {
  switch (filter) {
    case 'v1':
      return 'Your filter is V1: CafAI reminds you every two weeks.';
    case 'v2':
      return 'Your filter is V2: CafAI reminds you every month.';
    default:
      return 'CafAI does not know which filter you have, so it reminds you as for V1: every two weeks.';
  }
}

/** Settings > Machine care's fields, in Decent's words. */
export const WATER_CHOICES: ReadonlyArray<{ value: CareSettings['water']; label: string }> = [
  { value: null, label: 'Not sure' },
  { value: 'under30', label: 'Under 30 ppm (distilled, RO, very soft)' },
  { value: 'to120', label: '30 to 120 ppm' },
  { value: 'over120', label: 'Over 120 ppm' },
];

export const FILTER_CHOICES: ReadonlyArray<{ value: CareSettings['filter']; label: string }> = [
  { value: null, label: 'Not sure' },
  { value: 'v1', label: 'V1 (citric acid)' },
  { value: 'v2', label: 'V2 (baking soda)' },
];

export const WATER_HELP =
  'Its total dissolved solids (TDS), from a TDS meter or your water report. Decent: under 30 ppm, never descale; up to 120 ppm, once a year; over 120 ppm, at least twice a year.';
export const FILTER_HELP = "The filter at the tank's intake; Decent's page shows which one you have. V1 every week or two, V2 at least once a month.";
export const REMINDERS_LABEL = 'Remind me on the stats card';
export const REMINDERS_HELP = "A line on the stats card when the weekly clean, Rinza, the intake filter, the group head's soak or a descale is due.";

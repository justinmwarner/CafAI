/**
 * The words and sums of Settings > Sleep and wake (D157-D160): Decaid's wake
 * schedules said as a barista reads them, when the next one wakes the
 * machine, the choices for keeping it awake after, and the idle sleep's
 * stepper. Times are "HH:MM", 24-hour, as CafAI writes every time
 * (src/ui/chat/format.ts), in the clock of the device Decaid runs on.
 */
import type { WakeSchedule } from '../../api/types.ts';
import type { DrinkFieldSpec } from './drinkSettings.ts';

export interface Weekday {
  /** ISO, as Decaid numbers them: 1 = Monday to 7 = Sunday. */
  day: number;
  short: string;
  name: string;
}

/** Monday first, as Decaid's own page lays them out. */
export const WEEKDAYS: readonly Weekday[] = [
  { day: 1, short: 'Mon', name: 'Monday' },
  { day: 2, short: 'Tue', name: 'Tuesday' },
  { day: 3, short: 'Wed', name: 'Wednesday' },
  { day: 4, short: 'Thu', name: 'Thursday' },
  { day: 5, short: 'Fri', name: 'Friday' },
  { day: 6, short: 'Sat', name: 'Saturday' },
  { day: 7, short: 'Sun', name: 'Sunday' },
];

const ALL_DAYS = WEEKDAYS.map(({ day }) => day);

/** Decaid's default idle sleep (settings_controller.dart:65 at aab5f93): Sleep when idle turned on from never starts here. */
export const DEFAULT_SLEEP_MINUTES = 30;

/** A new wake time starts at Decaid's own page's 06:00, every day. */
export const NEW_WAKE_TIME = '06:00';

/**
 * A new wake time keeps the machine awake for an hour (D159): with only the
 * idle sleep, a machine woken at 06:30 is asleep again at 07:00 when nobody
 * has come to it.
 */
export const NEW_KEEP_AWAKE = 60;

/** The keep-awake windows offered, in minutes (Decaid takes 1-720); null is none. */
export const KEEP_AWAKE_CHOICES: readonly (number | null)[] = [null, 30, 60, 90, 120, 180, 240, 360, 480, 720];

/**
 * The idle sleep's stepper. Decaid takes 0-240 minutes, 0 meaning never; here
 * never is Sleep when idle turned off (D158), so the stepper starts at 1.
 */
export const SLEEP_AFTER: DrinkFieldSpec = {
  key: 'sleepTimeoutMinutes',
  label: 'Sleep after',
  shortLabel: 'Sleep after',
  unit: 'min',
  spokenUnit: 'minutes',
  integer: true,
  step: 5,
  range: { min: 1, max: 240 },
};

/** Each day once, in order, 1-7 only: the days as Decaid keeps them. */
function cleanDays(days: readonly number[]): number[] {
  return ALL_DAYS.filter((day) => days.includes(day));
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** "Every day", "Weekdays", "Weekends", or the days in order: "Mon, Wed, Fri". No days is every day, as in Decaid. */
export function describeDays(days: readonly number[]): string {
  const clean = cleanDays(days);
  if (clean.length === 0 || clean.length === 7) return 'Every day';
  if (sameDays(clean, [1, 2, 3, 4, 5])) return 'Weekdays';
  if (sameDays(clean, [6, 7])) return 'Weekends';
  return clean.map((day) => WEEKDAYS[day - 1]?.short ?? '').join(', ');
}

/** The days a schedule's toggles show: every day is all seven on. */
export function daysPicked(days: readonly number[]): number[] {
  const clean = cleanDays(days);
  return clean.length === 0 ? [...ALL_DAYS] : clean;
}

/** What goes to Decaid for the days picked: all seven is every day, which Decaid keeps as none (its own page does the same). */
export function daysToStore(picked: readonly number[]): number[] {
  const clean = cleanDays(picked);
  return clean.length === 7 ? [] : clean;
}

/** "30 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** A keep-awake choice as the dialog's select offers it. */
export function describeKeepAwake(minutes: number | null): string {
  return minutes === null ? 'Sleep when idle, as usual' : `Stay awake for ${formatMinutes(minutes)}`;
}

/** The line under a wake time: "Weekdays · stays awake for 1 h". */
export function describeSchedule(schedule: WakeSchedule): string {
  const days = describeDays(schedule.daysOfWeek);
  return schedule.keepAwakeFor ? `${days} · stays awake for ${formatMinutes(schedule.keepAwakeFor)}` : days;
}

/** The same said aloud, for the row's button: "06:30, Weekdays, stays awake for 1 h, off". */
export function speakSchedule(schedule: WakeSchedule): string {
  const parts = [schedule.time, describeDays(schedule.daysOfWeek)];
  if (schedule.keepAwakeFor) parts.push(`stays awake for ${formatMinutes(schedule.keepAwakeFor)}`);
  if (!schedule.enabled) parts.push('off');
  return parts.join(', ');
}

/** Earliest first, as a day runs; at the same time, the one with the earliest day first. */
export function sortSchedules(schedules: readonly WakeSchedule[]): WakeSchedule[] {
  const firstDay = (schedule: WakeSchedule) => daysPicked(schedule.daysOfWeek)[0] ?? 0;
  return [...schedules].sort((a, b) => a.time.localeCompare(b.time) || firstDay(a) - firstDay(b));
}

/** Hours and minutes of "HH:MM", or null for anything else. */
function clock(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** ISO weekday of a local date: 1 = Monday to 7 = Sunday. */
function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export interface NextWake {
  schedule: WakeSchedule;
  /** Local time. */
  at: Date;
}

/**
 * The next time a schedule that is on wakes the machine, after `now`, or null
 * when none is on. Decaid wakes at the start of the minute (it checks every
 * 30 s, presence_controller.dart:471-511 at aab5f93), so a schedule whose
 * minute has begun counts from its next day.
 */
export function nextWake(schedules: readonly WakeSchedule[], now: Date): NextWake | null {
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
    const weekday = isoWeekday(day);
    let best: NextWake | null = null;
    for (const schedule of schedules) {
      const time = clock(schedule.time);
      if (!schedule.enabled || time === null || !daysPicked(schedule.daysOfWeek).includes(weekday)) continue;
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute);
      if (at.getTime() > now.getTime() && (best === null || at.getTime() < best.at.getTime())) best = { schedule, at };
    }
    if (best !== null) return best;
  }
  return null;
}

/** Whole calendar days from `now`'s day to `at`'s. */
function daysBetween(now: Date, at: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** "today at 06:30", "tomorrow at 06:30", "Friday at 06:30", "next Friday at 06:30". */
export function describeWhen(at: Date, now: Date): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const ahead = daysBetween(now, at);
  const name = WEEKDAYS[isoWeekday(at) - 1]?.name ?? '';
  if (ahead <= 0) return `today at ${time}`;
  if (ahead === 1) return `tomorrow at ${time}`;
  return ahead >= 7 ? `next ${name} at ${time}` : `${name} at ${time}`;
}

/**
 * "07:30" while a wake's keep-awake window runs: from Decaid's keepAwakeUntil,
 * a local time without a zone ("2026-10-15T07:30:00.000"), read from its own
 * digits. Null when there is none, or it has passed.
 */
export function keptAwakeUntil(value: string | null | undefined, now: Date): string | null {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const end = new Date(year ?? 0, (month ?? 1) - 1, day, hour, minute);
  return end.getTime() > now.getTime() ? `${match[4]}:${match[5]}` : null;
}

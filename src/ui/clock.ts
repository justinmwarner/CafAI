/**
 * Clock times as the barista chose to read them (D245): 24-hour, "14:30",
 * as every time read until the choice came, or 12-hour, "2:30 pm". Built by
 * hand rather than with toLocaleTimeString, so a time reads the same on
 * every tablet locale (src/ui/chat/format.ts does dates the same way).
 *
 * Pure: each screen passes the format it reads from useClockFormat()
 * (src/app/services.tsx), so nothing here keeps a format of its own.
 * Decaid keeps its wake times as "HH:MM" whatever is shown
 * (src/ui/settings/wakeSchedule.ts reads and writes them).
 */
import type { ClockFormat } from '../storage/types.ts';

export type { ClockFormat };

/** Morning or afternoon on the 12-hour clock. */
export type ClockHalf = 'am' | 'pm';

/** How much of a time shows: "14:30", "14:30:05" or "14:30:05.123". */
export type ClockPrecision = 'minute' | 'second' | 'millisecond';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** The 24-hour day's hour (0-23) as the 12-hour clock says it: 0 is 12 am, 12 is 12 pm, 13 is 1 pm. */
export function toTwelveHour(hour: number): { hour: number; half: ClockHalf } {
  return { hour: hour % 12 === 0 ? 12 : hour % 12, half: hour < 12 ? 'am' : 'pm' };
}

/** The hour said on the 12-hour clock (1-12) and its half, as the 24-hour day's hour (0-23). */
export function fromTwelveHour(hour: number, half: ClockHalf): number {
  return (hour % 12) + (half === 'pm' ? 12 : 0);
}

/** `rest` (":30", ":30:05") after the hour, in the format: "14:30" or "2:30 pm". */
function withHour(hour: number, rest: string, format: ClockFormat): string {
  if (format === '24h') return `${pad(hour)}${rest}`;
  const said = toTwelveHour(hour);
  return `${said.hour}${rest} ${said.half}`;
}

/** "14:30" or "2:30 pm"; midnight "00:05" or "12:05 am", noon "12:00" or "12:00 pm". */
export function formatClock(hour: number, minute: number, format: ClockFormat): string {
  return withHour(hour, `:${pad(minute)}`, format);
}

/** A date's local time: "21:04" or "9:04 pm"; to the second "21:04:05" or "9:04:05 pm", and so on. */
export function formatTime(date: Date, format: ClockFormat, precision: ClockPrecision = 'minute'): string {
  let rest = `:${pad(date.getMinutes())}`;
  if (precision !== 'minute') rest += `:${pad(date.getSeconds())}`;
  if (precision === 'millisecond') rest += `.${pad(date.getMilliseconds(), 3)}`;
  return withHour(date.getHours(), rest, format);
}

const TYPED = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s*m\.?)?\s*$/i;

/**
 * A typed time as hours (0-23) and minutes, or null when it is not one.
 * Either notation is read whatever the format: "14:30", "6:05", "2:30 pm",
 * "2:30pm", "2 pm", "12:05 a.m.". The format decides only a bare time that
 * could be either half: on the 24-hour clock "2:30" is 02:30; on the 12-hour
 * one it is unread, while "14:30" or "0:30" can only be one time.
 */
export function parseClockText(text: string, format: ClockFormat): { hour: number; minute: number } | null {
  const match = TYPED.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (minute > 59) return null;
  const half = match[3]?.toLowerCase();
  if (half === 'a' || half === 'p') {
    return hour >= 1 && hour <= 12 ? { hour: fromTwelveHour(hour, half === 'a' ? 'am' : 'pm'), minute } : null;
  }
  // An hour alone is a number, not a time.
  if (match[2] === undefined || hour > 23) return null;
  if (format === '12h' && hour >= 1 && hour <= 12) return null;
  return { hour, minute };
}

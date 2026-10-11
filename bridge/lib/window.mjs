// When a scheduled bridge runs: a daily window such as 05:00-10:00 in local
// time (--window), every day or Monday to Friday (--weekdays).
//
// A window may cross midnight (22:00-02:00); with --weekdays it belongs to the
// day it starts on, so Friday's 22:00-02:00 runs into Saturday. Times are
// wall-clock times built with the Date constructor, so a daylight-saving change
// moves them with the clock. Every function takes the clock as an argument.

/**
 * @typedef {object} BridgeWindow
 * @property {number} start     Minutes after midnight.
 * @property {number} end       Minutes after midnight; less than `start` when the window crosses midnight.
 * @property {boolean} weekdays Monday to Friday only.
 * @property {string} text      "05:00-10:00".
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "5:00" or "05:00" as minutes after midnight, or null. */
export function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

/** Minutes after midnight as "05:00". */
export function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * "05:00-10:00" as a window, or null unless it is two different times.
 * @param {string} text
 * @param {{ weekdays?: boolean }} [options]
 * @returns {BridgeWindow | null}
 */
export function parseWindow(text, { weekdays = false } = {}) {
  const parts = String(text ?? '').split('-');
  if (parts.length !== 2) return null;
  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  if (start === null || end === null || start === end) return null;
  return { start, end, weekdays: Boolean(weekdays), text: `${formatTime(start)}-${formatTime(end)}` };
}

/** The local day `days` after `date`'s, at `minutes` after midnight. */
function atMinutes(date, days, minutes) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function dayAllowed(window, date) {
  const day = date.getDay();
  return !window.weekdays || (day >= 1 && day <= 5);
}

/**
 * The run of the window that `now` falls in, or null outside it.
 * @param {BridgeWindow} window
 * @param {Date} now
 * @returns {{ start: Date, end: Date } | null}
 */
export function currentWindow(window, now) {
  const crosses = window.end < window.start;
  // A window crossing midnight that started yesterday may still be open.
  for (const days of crosses ? [0, -1] : [0]) {
    const start = atMinutes(now, days, window.start);
    if (!dayAllowed(window, start)) continue;
    const end = atMinutes(now, days + (crosses ? 1 : 0), window.end);
    if (now >= start && now < end) return { start, end };
  }
  return null;
}

/** Whether the bridge should be running at `now`. */
export function inWindow(window, now) {
  return currentWindow(window, now) !== null;
}

/** Milliseconds until the window `now` is in closes; 0 outside it. */
export function msUntilEnd(window, now) {
  const current = currentWindow(window, now);
  return current ? current.end.getTime() - now.getTime() : 0;
}

/** When the window next opens after `now`. */
export function nextStart(window, now) {
  for (let days = 0; days <= 7; days++) {
    const start = atMinutes(now, days, window.start);
    if (start > now && dayAllowed(window, start)) return start;
  }
  return atMinutes(now, 1, window.start);
}

/** "every day, 05:00-10:00" or "Monday to Friday, 05:00-10:00". */
export function describeWindow(window) {
  return `${window.weekdays ? 'Monday to Friday' : 'every day'}, ${window.text}`;
}

/** "today at 05:00", "tomorrow at 05:00" or "on Monday at 05:00". */
export function describeWhen(date, now) {
  const time = formatTime(date.getHours() * 60 + date.getMinutes());
  const days = Math.round((atMinutes(date, 0, 0) - atMinutes(now, 0, 0)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${DAY_NAMES[date.getDay()]} at ${time}`;
}

/**
 * Call `onEnd` when the window `now()` is in closes. The timer is re-armed at
 * most a minute at a time and the end is worked out from the clock each time,
 * so a timer that fires early (or late, after sleep) or a daylight-saving
 * change cannot end the bridge at the wrong time. Returns a function that
 * cancels it.
 * @param {BridgeWindow} window
 * @param {{ now: () => Date, setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (timer: unknown) => void }} clock
 * @param {() => void} onEnd
 */
export function armWindowEnd(window, clock, onEnd) {
  let timer = null;
  let cancelled = false;
  const check = () => {
    if (cancelled) return;
    const ms = msUntilEnd(window, clock.now());
    if (ms <= 0) {
      onEnd();
      return;
    }
    timer = clock.setTimer(check, Math.min(ms, 60_000));
  };
  check();
  return () => {
    cancelled = true;
    if (timer !== null) clock.clearTimer(timer);
  };
}

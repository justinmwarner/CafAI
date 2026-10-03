/**
 * Time for the mock.
 *
 * Data timestamps must look like Decaid's (local zone-less microseconds for
 * telemetry, UTC with Z for devices and shot createdAt) and stay realistic
 * even when a shot is played faster than real time. The data clock follows
 * the wall clock but jumps forward when a fast-played shot has stamped
 * frames ahead of it, so timestamps never repeat or run backwards.
 */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function split(ms: number): { date: Date; micros: number } {
  const totalMicros = Math.round(ms * 1000);
  const wholeMs = Math.floor(totalMicros / 1000);
  const micros = ((totalMicros % 1_000_000) + 1_000_000) % 1_000_000;
  return { date: new Date(wholeMs), micros };
}

/** "2026-10-03T08:15:02.731455" in the local zone (Dart's local toIso8601String). */
export function formatLocalTimestamp(ms: number): string {
  const { date, micros } = split(ms);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(micros, 6)}`
  );
}

/** "2026-10-03T06:15:41.902117Z" (Dart's UTC toIso8601String). */
export function formatUtcTimestamp(ms: number): string {
  const { date, micros } = split(ms);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(micros, 6)}Z`
  );
}

export interface DataClock {
  /** Epoch ms for the next data timestamp. */
  now(): number;
  /** Move data time forward to at least `ms` (used after a fast-played shot). */
  advanceTo(ms: number): void;
}

export function createDataClock(wallNow: () => number = Date.now): DataClock {
  let offset = 0;
  return {
    now: () => wallNow() + offset,
    advanceTo(ms) {
      const current = wallNow() + offset;
      if (ms > current) offset += ms - current;
    },
  };
}

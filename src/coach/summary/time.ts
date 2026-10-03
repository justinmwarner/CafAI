/**
 * Decaid's telemetry timestamps, e.g. "2026-09-29T12:47:13.366017": local
 * time, no zone, microseconds. Only differences within one shot matter, so a
 * zone-less value is read as if it were UTC. Values with "Z" or an offset are
 * converted to UTC; never subtract a zone-less value from a zoned one.
 *
 * Date.parse is avoided on purpose: engines disagree on zone-less strings
 * (local vs UTC) and it drops the microseconds.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/;

/** Microseconds since the epoch (zone-less read as UTC), or null when unreadable. */
export function parseTimestampMicros(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = ISO.exec(text.trim());
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;

  let ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const zone = match[8];
  if (zone && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }
  const fraction = match[7] ?? '';
  const micros = fraction === '' ? 0 : Number(fraction.slice(0, 6).padEnd(6, '0'));
  return ms * 1000 + micros;
}

/** Seconds from `from` to `to`, or null when either is unreadable. */
export function elapsedSeconds(from: string, to: string): number | null {
  const a = parseTimestampMicros(from);
  const b = parseTimestampMicros(to);
  return a === null || b === null ? null : (b - a) / 1e6;
}

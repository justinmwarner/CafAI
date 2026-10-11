/**
 * Decaid timestamps.
 *
 * Decaid writes Dart `DateTime.toIso8601String()`: machine, scale and shot
 * state timestamps (and shot/profile record times) are LOCAL with no zone and
 * microseconds ("2026-09-29T12:53:54.216425"), while shot createdAt/updatedAt
 * and devices frames are UTC with a Z. `Date.parse` is not specified for the
 * zone-less microsecond form, and Chromium 91 and Node disagree on it, so the
 * parse is done by hand. Never subtract a zone-less value from a Z value.
 */

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function offsetMinutes(zone: string): number {
  if (zone === 'Z' || zone === 'z') return 0;
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return sign * (hours * 60 + minutes);
}

/**
 * Epoch milliseconds for a Decaid timestamp, or NaN when it is not one.
 *
 * Accepts 0-6 fraction digits (longer fractions are truncated to the
 * microsecond) and an optional `Z` or `+hh:mm` offset; zone-less values are
 * read as local time, which is the gateway's clock when the skin runs on the
 * tablet. Microseconds are kept as a fraction of a millisecond so sample
 * spacing stays exact.
 */
export function parseDecaidTimestamp(text: string): number {
  if (typeof text !== 'string') return NaN;
  const match = TIMESTAMP.exec(text.trim());
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return NaN;
  if (hour > 23 || minute > 59 || second > 59) return NaN;

  const fraction = match[7] ?? '';
  const micros = fraction ? Number(`${fraction}000000`.slice(0, 6)) : 0;
  const wholeMs = Math.floor(micros / 1000);
  const subMs = (micros % 1000) / 1000;
  const zone = match[8];

  let epoch: number;
  if (zone === undefined) {
    const local = new Date(year, month - 1, day, hour, minute, second, wholeMs);
    // Years below 100 would otherwise be read as 19xx.
    local.setFullYear(year);
    epoch = local.getTime();
  } else {
    epoch = Date.UTC(year, month - 1, day, hour, minute, second, wholeMs) - offsetMinutes(zone) * 60_000;
  }
  return epoch + subMs;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * A moment as Decaid writes a local time ("2026-09-29T12:53:54.216000"):
 * zone-less, on this device's clock, with microseconds. For a frame that
 * came without a timestamp CafAI can read (frames.ts), so it takes the time
 * it arrived; parseDecaidTimestamp reads it back to the same moment.
 */
export function formatDecaidTimestamp(date: Date): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}000`;
  return `${day}T${time}`;
}

/**
 * The traffic log as text (D139): one line per entry for the list, and the
 * whole log under a header for Share and Copy; Email gets the newest entries
 * that fit in a mailto: link. Pure: the UI passes the clock and the device.
 *
 * What the log view and Settings' summary show follows the clock the barista
 * chose (D245, src/ui/clock.ts); the shared text stays 24-hour, to the
 * millisecond, with its UTC offset: a record for whoever reads it, the same
 * from every device.
 */
import { formatTime, type ClockFormat } from '../ui/clock.ts';
import { safeSlice, type TrafficChannel, type TrafficDirection, type TrafficEntry } from './recorder.ts';
import { KEY_MARKER } from './redact.ts';

export const CHANNEL_LABEL: Readonly<Record<TrafficChannel, string>> = { rest: 'REST', socket: 'WS', coach: 'Coach' };
export const DIRECTION_ARROW: Readonly<Record<TrafficDirection, string>> = { sent: '↑', received: '↓' };

/** What the shared text's header says about where the log was taken. */
export interface LogContext {
  appVersion: string;
  /** Null when CafAI does not know it (Decaid could not be asked). */
  decaidVersion: string | null;
  /** Where CafAI reaches Decaid: "http://192.168.1.20:8080". */
  decaidOrigin: string;
  userAgent: string;
  /** "962 x 602, pixel ratio 1.33 (screen 1280 x 800)". */
  screen: string;
  now: Date;
}

/** A mailto: link longer than this may not open everywhere; Email cuts the log to fit (see emailBody). */
export const MAILTO_MAX_CHARS = 8000;
/** Where Share and Copy are, as Settings' groups name it (D233). */
const LOG_PLACE = 'Settings > Data and privacy > Log';
/** A body in an email keeps at most this much. */
const EMAIL_BODY_CHARS = 600;

const pad = (value: number) => String(value).padStart(2, '0');

/** "21:04:05", or with milliseconds "21:04:05.123", in local time; "9:04:05 pm" on the 12-hour clock. */
export function formatClock(at: number, withMs = false, clock: ClockFormat = '24h'): string {
  return formatTime(new Date(at), clock, withMs ? 'millisecond' : 'second');
}

/** "21:04" or "9:04 pm", local: since when Settings' summary counts. */
export function formatHourMinute(at: number, clock: ClockFormat): string {
  return formatTime(new Date(at), clock);
}

/** "2026-10-11 21:04", local. */
export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "UTC+02:00": the offset of the times in the log. */
function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "412 B", "3.2 KB", "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The entry's facts after its name, as the list and the text show them: "200 · 57 ms · 3.2 KB · +4 more". */
export function entryFacts(entry: TrafficEntry): string[] {
  const facts: string[] = [];
  if (entry.status) facts.push(entry.status);
  if (entry.durationMs !== null) facts.push(`${entry.durationMs} ms`);
  if (entry.size !== null) facts.push(formatBytes(entry.size));
  if (entry.more > 0) facts.push(`+${entry.more} more`);
  return facts;
}

/** "21:04:05.123 ↓ REST GET /api/v1/workflow · 200 · 57 ms · 3.2 KB"; the time 12-hour in the log view when chosen. */
export function entryLine(entry: TrafficEntry, clock: ClockFormat = '24h'): string {
  const head = `${formatClock(entry.at, true, clock)} ${DIRECTION_ARROW[entry.direction]} ${CHANNEL_LABEL[entry.channel]} ${entry.what}`;
  return [head, ...entryFacts(entry)].join(' · ');
}

/** The entry's line, then its headers, body and stream events, each as it was kept (bodies cut to `bodyChars`). */
export function formatEntry(entry: TrafficEntry, bodyChars = Number.POSITIVE_INFINITY): string {
  const shorten = (text: string) => (text.length > bodyChars ? `${safeSlice(text, bodyChars)} [… shortened]` : text);
  const lines = [entryLine(entry)];
  if (entry.headers) lines.push(entry.headers);
  if (entry.body) lines.push(shorten(entry.body));
  if (entry.raw) {
    lines.push('Stream events:');
    lines.push(shorten(entry.raw.trimEnd()));
  }
  return lines.join('\n');
}

/** "CafAI log, 2026-10-11 21:15": the email's subject and the shared file's title. */
export function logTitle(now: Date): string {
  return `CafAI log, ${formatDateTime(now)}`;
}

/** "cafai-log-2026-10-11-2115.txt". */
export function logFileName(now: Date): string {
  return `cafai-log-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`;
}

/** "2026-10-11 21:04:05", local. */
function formatStamp(at: number): string {
  return `${formatDateTime(new Date(at))}:${pad(new Date(at).getSeconds())}`;
}

/** The header every shared copy starts with: versions, device, time range, count, and that the key is never in it. */
export function logHeader(entries: readonly TrafficEntry[], context: LogContext): string {
  const first = entries[0];
  const last = entries[entries.length - 1];
  let range = 'No entries.';
  if (first && last) {
    // The end's date only when the log runs past midnight.
    const end = new Date(first.at).toDateString() === new Date(last.at).toDateString() ? formatClock(last.at) : formatStamp(last.at);
    range = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, ${formatStamp(first.at)} to ${end} (${utcOffset(new Date(last.at))}), oldest first`;
  }
  return [
    logTitle(context.now),
    `CafAI ${context.appVersion}, Decaid ${context.decaidVersion ?? 'version unknown'} at ${context.decaidOrigin}`,
    `Browser: ${context.userAgent}`,
    `Screen: ${context.screen}`,
    `Entries: ${range}`,
    'Live frames: a machine or scale snapshot at most once a second per channel; "+N more" counts the frames not kept.',
    `The API key and CafAI Bridge's pairing code are never in this log: ${KEY_MARKER} marks where one was taken out.`,
  ].join('\n');
}

/** The whole log, for Share and Copy. */
export function formatTrafficLog(entries: readonly TrafficEntry[], context: LogContext): string {
  return [logHeader(entries, context), ...entries.map((entry) => formatEntry(entry))].join('\n\n') + '\n';
}

/** Half of a character written as two (a lone surrogate), which encodeURIComponent throws on. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` as a mailto: link carries it (RFC 6068: CRLF line breaks, percent-encoded); never throws. */
function encodeForMail(text: string): string {
  return encodeURIComponent(text.replace(LONE_SURROGATE, '�').replace(/\n/g, '\r\n'));
}

/** How long `text` is once it is in a mailto: link. */
function encodedLength(text: string): number {
  return encodeForMail(text).length;
}

/**
 * The email's body: the header, then the newest entries whose bodies,
 * shortened, fit in a mailto: link of `maxChars` with `subject`, oldest
 * first; and when anything was left out or shortened, a line saying so and
 * that Share or Copy has all of it.
 */
export function emailBody(entries: readonly TrafficEntry[], context: LogContext, maxChars = MAILTO_MAX_CHARS): string {
  const header = logHeader(entries, context);
  const subject = logTitle(context.now);
  // The note's room is kept from the start, so it always fits.
  const noteRoom = 400;
  let budget = maxChars - `mailto:?subject=${encodeForMail(subject)}&body=`.length - encodedLength(header) - noteRoom;
  const kept: string[] = [];
  let shortened = false;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    const text = formatEntry(entry, EMAIL_BODY_CHARS);
    const cost = encodedLength(`\n\n${text}`);
    if (cost > budget) break;
    budget -= cost;
    kept.push(text);
    if (entry.body.length > EMAIL_BODY_CHARS || entry.raw.length > EMAIL_BODY_CHARS) shortened = true;
  }
  const left = entries.length - kept.length;
  const parts = [header];
  if (left > 0) {
    parts.push(
      `Cut to fit an email: the oldest ${left} of ${entries.length} entries are left out${shortened ? ' and long bodies are shortened' : ''}. Share or Copy in CafAI's ${LOG_PLACE} has all of it.`,
    );
  } else if (shortened) {
    parts.push(`Long bodies are shortened to fit an email. Share or Copy in CafAI's ${LOG_PLACE} has all of it.`);
  }
  return [...parts, ...kept.reverse()].join('\n\n') + '\n';
}

/** The mailto: link Email opens: no address, the log's title as the subject. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeForMail(subject)}&body=${encodeForMail(body)}`;
}

/** A number JSON.parse cannot hold exactly (more than 15 digits): pretty-printing would change it. */
const LONG_NUMBER = /(?:^|[^\d."\w])-?\d{16,}/;

/**
 * A body for the eye: JSON pretty-printed when it is JSON, anything else as
 * it is, and as it is too when re-printing would change a number in it.
 */
export function prettyBody(body: string): string {
  const text = body.trim();
  if (!(text.startsWith('{') || text.startsWith('['))) return body;
  if (LONG_NUMBER.test(text)) return body;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return body;
  }
}

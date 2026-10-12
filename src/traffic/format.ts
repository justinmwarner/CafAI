/**
 * The traffic log as text (D139): one line per entry for the list, and the
 * whole log under a header for Share and Copy; Email gets the newest entries
 * that fit in a mailto: link. Pure: the UI passes the clock and the device.
 */
import type { TrafficChannel, TrafficDirection, TrafficEntry } from './recorder.ts';
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
/** A body in an email keeps at most this much. */
const EMAIL_BODY_CHARS = 600;

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** "21:04:05", or with milliseconds "21:04:05.123", in local time. */
export function formatClock(at: number, withMs = false): string {
  const date = new Date(at);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return withMs ? `${clock}.${pad(date.getMilliseconds(), 3)}` : clock;
}

/** "21:04", local. */
export function formatHourMinute(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

/** "21:04:05.123 ↓ REST GET /api/v1/workflow · 200 · 57 ms · 3.2 KB". */
export function entryLine(entry: TrafficEntry): string {
  const head = `${formatClock(entry.at, true)} ${DIRECTION_ARROW[entry.direction]} ${CHANNEL_LABEL[entry.channel]} ${entry.what}`;
  return [head, ...entryFacts(entry)].join(' · ');
}

/** The entry's line, then its headers, body and stream events, each as it was kept (bodies cut to `bodyChars`). */
export function formatEntry(entry: TrafficEntry, bodyChars = Number.POSITIVE_INFINITY): string {
  const lines = [entryLine(entry)];
  if (entry.headers) lines.push(entry.headers);
  if (entry.body) lines.push(entry.body.length > bodyChars ? `${entry.body.slice(0, bodyChars)} [… shortened]` : entry.body);
  if (entry.raw) {
    lines.push('Stream events:');
    lines.push(entry.raw.length > bodyChars ? `${entry.raw.slice(0, bodyChars)} [… shortened]` : entry.raw.trimEnd());
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

/** The header every shared copy starts with: versions, device, time range, count, and that the key is never in it. */
export function logHeader(entries: readonly TrafficEntry[], context: LogContext): string {
  const first = entries[0];
  const last = entries[entries.length - 1];
  const range =
    first && last
      ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, ${formatDateTime(new Date(first.at))}:${pad(new Date(first.at).getSeconds())} to ${formatClock(last.at)} (${utcOffset(new Date(last.at))}), oldest first`
      : 'No entries.';
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

/** How long `text` is once it is in a mailto: link (RFC 6068: CRLF line breaks, percent-encoded). */
function encodedLength(text: string): number {
  return encodeURIComponent(text.replace(/\n/g, '\r\n')).length;
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
  let budget = maxChars - `mailto:?subject=${encodeURIComponent(subject)}&body=`.length - encodedLength(header) - noteRoom;
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
      `Cut to fit an email: the oldest ${left} of ${entries.length} entries are left out${shortened ? ' and long bodies are shortened' : ''}. Share or Copy in CafAI's Settings > Log has all of it.`,
    );
  } else if (shortened) {
    parts.push("Long bodies are shortened to fit an email. Share or Copy in CafAI's Settings > Log has all of it.");
  }
  return [...parts, ...kept.reverse()].join('\n\n') + '\n';
}

/** The mailto: link Email opens: no address, the log's title as the subject. */
export function mailtoHref(subject: string, body: string): string {
  const encode = (text: string) => encodeURIComponent(text.replace(/\n/g, '\r\n'));
  return `mailto:?subject=${encode(subject)}&body=${encode(body)}`;
}

/** A body for the eye: JSON pretty-printed when it is JSON, anything else as it is. */
export function prettyBody(body: string): string {
  const text = body.trim();
  if (!(text.startsWith('{') || text.startsWith('['))) return body;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return body;
  }
}

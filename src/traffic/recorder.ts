/**
 * The traffic log (D139): what CafAI sends to and gets from Decaid (REST and
 * WebSockets) and the coach (Anthropic or CafAI Bridge), as it went over the
 * wire, for Settings > Log. Recorded where the traffic passes, not at the
 * call sites: `src/api/http.ts` for every REST call, `src/api/telemetry.ts`
 * for every socket, `src/llm/anthropic.ts` for the coach's turns and
 * `src/llm/bridgeClient.ts` for CafAI Bridge's Test and Find. The mock Decaid
 * and the scripted coach answer through the same code, so the log works in
 * mock mode and in the e2e suite too.
 *
 * One ring buffer in memory, always on, never stored or sent anywhere: only
 * the barista's Share, Email or Copy takes it off the page. It keeps the
 * last 1000 entries and about 4 MB of text, dropping the oldest; one body
 * keeps at most 256 KB (a coach request, or a chat's backup to Decaid, is
 * 50 to 200 KB).
 *
 * Live frames: the machine's and the scale's snapshots (and time-to-ready's)
 * stream several times a second. A streaming channel keeps at most one frame
 * a second; the frames after it are counted on it ("+4 more"). Every other
 * channel keeps each frame that says something new, and counts a repeat that
 * comes within the second. Frames may fill at most half the entries, so a
 * busy machine never pushes the REST calls and the coach out of the log.
 *
 * Nothing renders while nobody looks: recording is a push and a counter, and
 * listeners hear of changes at most twice a second, so a log view that is
 * closed (no listener) costs no render at all.
 *
 * Everything goes through redact.ts on the way in: the API key and the
 * bridge's pairing code never enter the buffer.
 */
import { isKeyStoreCall, KEY_COPY_MARKER, redactHeaders, redactText, type HeaderSource } from './redact.ts';

export type TrafficChannel = 'rest' | 'socket' | 'coach';
export type TrafficDirection = 'sent' | 'received';

export interface TrafficEntry {
  /** Ascending from 1 for the page's life: React's key, and the order. */
  readonly id: number;
  /** Epoch ms. */
  readonly at: number;
  readonly direction: TrafficDirection;
  readonly channel: TrafficChannel;
  /** "GET /api/v1/workflow", "ws/v1/machine/snapshot", "POST api.anthropic.com/v1/messages". */
  readonly what: string;
  /** "200", "200 end_turn", "open", "closed 1006", "timeout", "network error"; '' for a request. */
  readonly status: string;
  /** An HTTP error, no answer, a socket error or unexpected close, a stream that broke. */
  readonly failed: boolean;
  /** From the request to the end of its reply, on an exchange's received entry. */
  readonly durationMs: number | null;
  /** Bytes of the body as it went over the wire, before anything was taken out or cut. */
  readonly size: number | null;
  /** "name: value" lines; a secret header's value is never kept. */
  readonly headers: string;
  readonly body: string;
  /** The coach's stream events as they came (capped), under its assembled reply. */
  readonly raw: string;
  /** A WebSocket frame: the Live frames share of the log. */
  readonly frame: boolean;
  /** Frames of the same channel after this one that were counted, not kept. */
  readonly more: number;
}

export interface TrafficInput {
  direction: TrafficDirection;
  channel: TrafficChannel;
  what: string;
  status?: string;
  failed?: boolean;
  durationMs?: number | null;
  /** By default the body's UTF-8 length. */
  size?: number | null;
  headers?: HeaderSource;
  body?: string;
  raw?: string;
  /** Values to take out of everything, besides the secret headers' own (redact.ts). */
  secrets?: readonly string[];
}

export const MAX_ENTRIES = 1000;
export const MAX_FRAME_ENTRIES = 500;
export const MAX_TEXT_CHARS = 4_000_000;
export const MAX_BODY_CHARS = 256 * 1024;
export const MAX_RAW_CHARS = 32 * 1024;
/** A streaming channel keeps one frame per this long. */
export const FRAME_EVERY_MS = 1000;
/** Listeners hear of changes at most once per this long. */
export const NOTIFY_EVERY_MS = 500;

export interface TrafficTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TrafficLogOptions {
  maxEntries?: number;
  maxFrameEntries?: number;
  maxTextChars?: number;
  maxBodyChars?: number;
  maxRawChars?: number;
  frameEveryMs?: number;
  notifyEveryMs?: number;
  now?: () => number;
  timers?: TrafficTimers;
}

export interface TrafficLog {
  /** Redacts, cuts and keeps one entry. */
  add(input: TrafficInput): void;
  /** A frame received on a socket (`what` names the channel); a `streaming` channel keeps one a second. */
  frame(what: string, data: string, streaming: boolean): void;
  /** A channel's socket opened: its next frame is kept whatever came before. */
  resetFrames(what: string): void;
  /** Oldest first; the same array until something changes (for useSyncExternalStore). */
  list(): readonly TrafficEntry[];
  /** When the log began holding what it holds: the page's start, or the last Clear. */
  since(): number;
  /** The log's clock (epoch ms). */
  now(): number;
  subscribe(listener: () => void): () => void;
  clear(): void;
}

/** Bytes `text` takes as UTF-8, without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function kilobytes(chars: number): string {
  return chars >= 1024 * 1024 ? `${(chars / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(chars / 1024))} KB`;
}

/** "POST api.anthropic.com/v1/messages": a request to a whole URL as the log names it. */
export function trafficName(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    return `${method} ${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return `${method} ${url}`;
  }
}

/** At most `max` characters, and a line that says how much was cut. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[cut here: ${kilobytes(text.length - max)} more]`;
}

/** What an entry counts against the text cap. */
function weight(entry: TrafficEntry): number {
  return entry.what.length + entry.status.length + entry.headers.length + entry.body.length + entry.raw.length;
}

export function createTrafficLog(options: TrafficLogOptions = {}): TrafficLog {
  const now = options.now ?? (() => Date.now());
  const timers: TrafficTimers = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxFrameEntries = options.maxFrameEntries ?? MAX_FRAME_ENTRIES;
  const maxTextChars = options.maxTextChars ?? MAX_TEXT_CHARS;
  const maxBodyChars = options.maxBodyChars ?? MAX_BODY_CHARS;
  const maxRawChars = options.maxRawChars ?? MAX_RAW_CHARS;
  const frameEveryMs = options.frameEveryMs ?? FRAME_EVERY_MS;
  const notifyEveryMs = options.notifyEveryMs ?? NOTIFY_EVERY_MS;

  const entries: TrafficEntry[] = [];
  let snapshot: readonly TrafficEntry[] | null = null;
  let chars = 0;
  let frames = 0;
  let nextId = 1;
  let startedAt = now();
  /** Per socket channel: its last kept frame (redacted body, for "something new"), when, and which entry. */
  const lastFrames = new Map<string, { at: number; body: string; id: number }>();
  const listeners = new Set<() => void>();
  let pending: unknown = null;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function changed(): void {
    snapshot = null;
    if (listeners.size === 0 || pending !== null) return;
    pending = timers.setTimeout(() => {
      pending = null;
      notify();
    }, notifyEveryMs);
  }

  function removeAt(index: number): void {
    const [gone] = entries.splice(index, 1);
    if (!gone) return;
    chars -= weight(gone);
    if (gone.frame) frames -= 1;
  }

  function push(entry: TrafficEntry): void {
    entries.push(entry);
    chars += weight(entry);
    if (entry.frame) frames += 1;
    while (frames > maxFrameEntries) removeAt(entries.findIndex((kept) => kept.frame));
    while (entries.length > maxEntries || (chars > maxTextChars && entries.length > 1)) removeAt(0);
    changed();
  }

  function build(input: TrafficInput, frame: boolean): TrafficEntry {
    const headers = redactHeaders(input.headers);
    const secrets = [...(input.secrets ?? []), ...headers.secrets];
    const what = redactText(input.what, secrets);
    const original = input.body ?? '';
    // The key's copy in Decaid is the key itself, whatever it looks like (D99): no body there is kept.
    const body = isKeyStoreCall(what) ? (original === '' ? '' : KEY_COPY_MARKER) : cutText(redactText(original, secrets), maxBodyChars);
    return {
      id: nextId++,
      at: now(),
      direction: input.direction,
      channel: input.channel,
      what,
      status: redactText(input.status ?? '', secrets),
      failed: input.failed ?? false,
      durationMs: input.durationMs ?? null,
      size: input.size !== undefined ? input.size : original === '' ? null : utf8Length(original),
      headers: headers.text,
      body,
      raw: cutText(redactText(input.raw ?? '', secrets), maxRawChars),
      frame,
      more: 0,
    };
  }

  /** The index of the entry with this id, looked for from the newest end, where a channel's last frame is. */
  function indexOf(id: number): number {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (entry.id === id) return i;
      if (entry.id < id) return -1;
    }
    return -1;
  }

  return {
    add(input) {
      push(build(input, false));
    },
    frame(what, data, streaming) {
      const at = now();
      const last = lastFrames.get(what);
      if (last && at - last.at < frameEveryMs) {
        // Inside the second: a streaming channel counts every frame; another counts only a repeat.
        const repeat = streaming || redactText(data) === last.body;
        if (repeat) {
          const index = indexOf(last.id);
          const entry = index >= 0 ? entries[index] : undefined;
          if (entry) {
            entries[index] = { ...entry, more: entry.more + 1 };
            changed();
          }
          return;
        }
      }
      const entry = build({ direction: 'received', channel: 'socket', what, status: 'frame', body: data }, true);
      lastFrames.set(what, { at, body: entry.body, id: entry.id });
      push(entry);
    },
    resetFrames(what) {
      lastFrames.delete(what);
    },
    list() {
      snapshot ??= entries.slice();
      return snapshot;
    },
    since: () => startedAt,
    now,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && pending !== null) {
          timers.clearTimeout(pending);
          pending = null;
        }
      };
    },
    clear() {
      entries.length = 0;
      chars = 0;
      frames = 0;
      lastFrames.clear();
      startedAt = now();
      snapshot = null;
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
      notify();
    },
  };
}

/** The app-wide log. A module singleton, like the drift log (src/api/drift.ts): the choke points record into it. */
export const trafficLog: TrafficLog = createTrafficLog();

export interface ReplyOptions {
  headers?: HeaderSource;
  body?: string;
  /** The coach's stream events, under the assembled reply in `body`. */
  raw?: string;
  /** Said after the status: "200 end_turn". */
  outcome?: string;
  /** Bytes on the wire, when `body` is not what came (a stream's assembled reply). */
  size?: number;
  /** By default a status of 400 or more. */
  failed?: boolean;
}

/** One HTTP exchange: its request is kept at once, its reply (or what became of it) once, whichever comes first. */
export interface TrafficExchange {
  reply(status: number, options?: ReplyOptions): void;
  /** No reply: "timeout", "network error", "cancelled". */
  fail(outcome: string, options?: { body?: string; raw?: string }): void;
}

/**
 * Keep a request and return what keeps its reply. The values of the
 * request's secret headers are taken out of the reply too: a server that
 * echoes the key or the pairing code back shows the marker.
 */
export function recordExchange(
  channel: 'rest' | 'coach',
  what: string,
  request: { headers?: HeaderSource; body?: string } = {},
  log: TrafficLog = trafficLog,
): TrafficExchange {
  const started = log.now();
  const { secrets } = redactHeaders(request.headers);
  log.add({ direction: 'sent', channel, what, headers: request.headers, body: request.body });
  let done = false;
  const finish = (input: Omit<TrafficInput, 'direction' | 'channel' | 'what'>) => {
    if (done) return;
    done = true;
    log.add({ ...input, direction: 'received', channel, what, durationMs: log.now() - started, secrets });
  };
  return {
    reply(status, options = {}) {
      finish({
        status: options.outcome ? `${status} ${options.outcome}` : String(status),
        failed: options.failed ?? status >= 400,
        headers: options.headers,
        body: options.body,
        raw: options.raw,
        size: options.size,
      });
    },
    fail(outcome, options = {}) {
      finish({ status: outcome, failed: true, body: options.body, raw: options.raw });
    },
  };
}

/**
 * Something that happened to a socket: CafAI opening or closing it (sent),
 * or it opening, closing or failing (received). A socket that opens keeps
 * its first frame.
 */
export function recordSocket(what: string, direction: TrafficDirection, status: string, failed = false, log: TrafficLog = trafficLog): void {
  if (direction === 'received' && status === 'open') log.resetFrames(what);
  log.add({ direction, channel: 'socket', what, status, failed });
}

/** A frame received on a socket. */
export function recordFrame(what: string, data: string, streaming: boolean, log: TrafficLog = trafficLog): void {
  log.frame(what, data, streaming);
}

/**
 * The coach's stream events as they came, as SSE text, up to `maxChars`;
 * after that only counted. Its bytes are the wire's.
 */
export function createStreamCapture(maxChars: number = MAX_RAW_CHARS) {
  let text = '';
  let skipped = 0;
  let bytes = 0;
  return {
    bytes(count: number) {
      bytes += count;
    },
    event(event: string, data: string) {
      const piece = `event: ${event}\ndata: ${data}\n\n`;
      if (skipped === 0 && text.length + piece.length <= maxChars) text += piece;
      else skipped += 1;
    },
    get size() {
      return bytes;
    },
    text() {
      return skipped === 0 ? text : `${text}[${skipped} more ${skipped === 1 ? 'event' : 'events'} not kept]\n`;
    },
  };
}

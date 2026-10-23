/**
 * Decaid's display socket, ws/v1/display (D224): the tablet's
 * brightness and its wake lock, for the screensaver (src/app/saverScreen.ts).
 *
 * Decaid sends the display's state as it opens and after every change (and
 * every command); it takes `setBrightness` (0-100, 100 handing the screen
 * back to Android's own brightness), `requestWakeLock` and
 * `releaseWakeLock`, and lets go of a wake lock asked for on a socket when
 * that socket closes (contract/decaid/spec/websocket_v1.yml; seen on Decaid
 * 0.8.8's simulator on 2026-10-22: one frame on connect, one or more after
 * each command, and the lock gone with the socket, the brightness kept).
 * The REST wake lock is never used: it outlives CafAI
 * (docs/verified/01-platform.md, rule 20).
 *
 * One socket, and only while wanted: reconnected after a real close or an
 * error with telemetry's backoff, 1 s doubling to 30 s and reset by an
 * open, and at once when the page comes back into view (src/api/telemetry.ts).
 * It is the one socket CafAI sends on. Its opening, closing, errors, frames
 * and the commands sent go into the traffic log (D139). A frame CafAI cannot
 * read is dropped and reported (D95); nothing here throws.
 */
import { recordFrame, recordSocket } from '../traffic/recorder.ts';
import { reportDrift } from './drift.ts';
import { describeValue } from './frames.ts';
import type { TimerApi, VisibilitySource } from './telemetry.ts';

const PATH = '/ws/v1/display';
/** The channel as the traffic log and the drift log name it. */
const NAME = 'ws/v1/display';
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/** What Decaid says of the display (DisplayState), the parts CafAI reads. */
export interface DisplayState {
  /** The brightness on screen, 0-100: below the requested one while a low battery caps it. */
  brightness: number;
  /** The brightness asked for, 0-100; 100 means Android's own. */
  requestedBrightness: number;
  /** A wake lock is on: Decaid's own (the machine awake) or a skin's. */
  wakeLockEnabled: boolean;
  /** A skin asked for one. */
  wakeLockOverride: boolean;
}

export type DisplayCommand =
  | { command: 'setBrightness'; brightness: number }
  | { command: 'requestWakeLock' }
  | { command: 'releaseWakeLock' };

/** What a listener hears: the socket opened (a new opening), a state frame came, or the socket closed. */
export type DisplayEvent = 'open' | 'state' | 'closed';

export interface DisplayChannelOptions {
  /** e.g. "ws://localhost:8080" (client.wsOrigin). */
  wsOrigin: string;
  /** Defaults to the global WebSocket, resolved per connection so a mock installed later still applies. */
  WebSocketImpl?: typeof WebSocket;
  /** Timer functions (default the globals, resolved per call). */
  timers?: TimerApi;
  /** Defaults to `document` when there is one. */
  visibility?: VisibilitySource | null;
}

export interface DisplayChannel {
  /** Opens the socket and keeps it open, reconnecting (true), or closes it for good (false). */
  want(open: boolean): void;
  /** Sends a command on the open socket; false when there is none open to take it. */
  send(command: DisplayCommand): boolean;
  /** Whether the socket is open. */
  isOpen(): boolean;
  /** The display's state from the latest frame since this opening; null until the first. */
  state(): DisplayState | null;
  subscribe(listener: (event: DisplayEvent) => void): () => void;
}

function integer(value: unknown, field: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  reportDrift(NAME, `${field}: ${describeValue(value, 'number')}`);
  return null;
}

function flag(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  reportDrift(NAME, `${field}: ${describeValue(value, 'boolean')}`);
  return false;
}

/** A DisplayState frame, or null when it carries no brightness CafAI can read. */
export function parseDisplayFrame(value: unknown): DisplayState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reportDrift(NAME, `frame: ${describeValue(value, 'object')}`);
    return null;
  }
  const frame = value as Record<string, unknown>;
  const brightness = integer(frame['brightness'], 'brightness');
  const requestedBrightness = integer(frame['requestedBrightness'], 'requestedBrightness');
  if (brightness === null || requestedBrightness === null) return null;
  return {
    brightness,
    requestedBrightness,
    wakeLockEnabled: flag(frame['wakeLockEnabled'], 'wakeLockEnabled'),
    wakeLockOverride: flag(frame['wakeLockOverride'], 'wakeLockOverride'),
  };
}

export function createDisplayChannel(options: DisplayChannelOptions): DisplayChannel {
  const timers: TimerApi = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const visibility: VisibilitySource | null =
    options.visibility !== undefined ? options.visibility : typeof document === 'undefined' ? null : document;
  const url = `${options.wsOrigin.replace(/\/+$/, '')}${PATH}`;
  const listeners = new Set<(event: DisplayEvent) => void>();

  let wanted = false;
  let socket: WebSocket | null = null;
  let open = false;
  let current: DisplayState | null = null;
  let attempt = 0;
  let retry: unknown = null;

  function tell(event: DisplayEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // One broken listener must not stop the others.
      }
    }
  }

  function clearRetry(): void {
    if (retry !== null) timers.clearTimeout(retry);
    retry = null;
  }

  function scheduleReconnect(): void {
    if (!wanted || retry !== null) return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
    attempt += 1;
    retry = timers.setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  }

  /** Forget a socket; an error and the close that follows it schedule one reconnect. */
  function drop(gone: WebSocket, reconnect: boolean): void {
    if (socket !== gone) return;
    socket = null;
    gone.onopen = null;
    gone.onmessage = null;
    gone.onclose = null;
    gone.onerror = null;
    try {
      gone.close();
    } catch {
      // Already closed.
    }
    const wasOpen = open;
    open = false;
    current = null;
    if (wasOpen) tell('closed');
    if (reconnect) scheduleReconnect();
  }

  function connect(): void {
    if (!wanted || socket) return;
    clearRetry();
    const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
    recordSocket(NAME, 'sent', 'connect');
    let next: WebSocket;
    try {
      next = new Impl(url);
    } catch {
      recordSocket(NAME, 'received', 'could not open', true);
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      if (socket !== next) return;
      recordSocket(NAME, 'received', 'open');
      attempt = 0;
      open = true;
      current = null;
      tell('open');
    };
    next.onmessage = (event: MessageEvent) => {
      if (socket !== next) return;
      const data = String(event.data);
      recordFrame(NAME, data, false);
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      const frame = parseDisplayFrame(value);
      if (!frame) return;
      current = frame;
      tell('state');
    };
    next.onclose = (event) => {
      if (socket === next) {
        // 1000 is a normal close; anything else (1006: the connection was lost) is not.
        const code = event?.code;
        recordSocket(NAME, 'received', code ? `closed ${code}${event.reason ? ` ${event.reason}` : ''}` : 'closed', code !== 1000);
      }
      drop(next, true);
    };
    next.onerror = () => {
      if (socket === next) recordSocket(NAME, 'received', 'error', true);
      drop(next, true);
    };
  }

  function onVisibilityChange(): void {
    if (!wanted || visibility?.visibilityState !== 'visible' || socket) return;
    // Back in view: no waiting out the backoff.
    connect();
  }

  return {
    want(next) {
      if (next === wanted) {
        if (next) connect();
        return;
      }
      wanted = next;
      if (next) {
        visibility?.addEventListener('visibilitychange', onVisibilityChange);
        connect();
        return;
      }
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      clearRetry();
      attempt = 0;
      if (!socket) return;
      recordSocket(NAME, 'sent', 'close');
      drop(socket, false);
    },
    send(command) {
      if (!socket || !open) return false;
      const text = JSON.stringify(command);
      try {
        socket.send(text);
      } catch {
        return false;
      }
      recordSocket(NAME, 'sent', text);
      return true;
    },
    isOpen: () => open,
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

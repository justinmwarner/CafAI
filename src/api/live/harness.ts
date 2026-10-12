/**
 * The helpers of CafAI's checks against a running Decaid (read.decaid.ts,
 * write.decaid.ts, shot.decaid.ts; spec 4.4): a fetch that records every
 * exchange, so each reply CafAI's client read is checked against the pinned
 * spec without asking Decaid twice; the channels CafAI's telemetry opens and
 * its parser for each; WebSocket watches and polling; the undo list that puts
 * every write back; and the guard that keeps writes off a real machine (D104).
 *
 * `npm test` never runs the suites: *.decaid.ts is outside the unit include,
 * and only vitest.decaid.config.ts provides DECAID_SUITE_FLAG (env.ts).
 */
import type { SpecValidator } from '../../../contract/decaid/schema.ts';
import {
  parseDevicesFrame,
  parseMachineFrame,
  parseScaleFrame,
  parseShotSettingsFrame,
  parseShotStateFrame,
  parseWaterLevelsFrame,
} from '../frames.ts';
import { createTelemetryStore, parseTimeToReadyFrame } from '../telemetry.ts';
import type { DecaidSettings, DeviceEntry, WorkflowContext } from '../types.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const METHODS: ReadonlySet<string> = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'DELETE']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parsed JSON, the text itself when it is not JSON, undefined when there is none. */
function bodyOf(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// What went over the wire
// ---------------------------------------------------------------------------

export interface Exchange {
  method: string;
  /** The path and query as sent: "/api/v1/store/cafai?full=1". */
  path: string;
  status: number;
  /** The JSON body sent, parsed; undefined when none was. */
  sent: unknown;
  /** The reply: parsed JSON, the text when it is not JSON, undefined when empty. */
  body: unknown;
}

export interface ExchangeRecorder {
  /** Every exchange so far, in order. */
  readonly exchanges: Exchange[];
  /** For the `fetch` option of createDecaidClient and of the calls beside it. */
  readonly fetch: typeof globalThis.fetch;
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  return new URL(typeof input === 'string' ? input : input.url);
}

/** A fetch that remembers each exchange and hands the caller the reply unread. */
export function recordExchanges(): ExchangeRecorder {
  const exchanges: Exchange[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Looked up per call, so a test can stub the global.
    const response = await globalThis.fetch(input, init);
    const url = urlOf(input);
    const text = await response.clone().text();
    exchanges.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: `${url.pathname}${url.search}`,
      status: response.status,
      sent: typeof init?.body === 'string' ? bodyOf(init.body) : undefined,
      body: bodyOf(text),
    });
    return response;
  };
  return { exchanges, fetch };
}

/**
 * Where the 2xx replies, and the bodies sent with them, differ from the
 * pinned spec: "PUT /api/v1/workflow 200: profile/steps/0/exit: must be
 * object". The validator skips the known exceptions (contract/decaid/drift.ts).
 * Refused requests are left to each test: a refusal is often the point (the
 * rating-scale probe sends an out-of-range rating on purpose).
 */
export function specProblems(validator: Pick<SpecValidator, 'response' | 'request'>, exchanges: readonly Exchange[]): string[] {
  const problems = new Set<string>();
  for (const exchange of exchanges) {
    if (exchange.status < 200 || exchange.status > 299 || !METHODS.has(exchange.method)) continue;
    const method = exchange.method as HttpMethod;
    const path = exchange.path.split('?')[0] ?? exchange.path;
    const where = `${method} ${exchange.path} ${exchange.status}`;
    if ((method === 'POST' || method === 'PUT') && exchange.sent !== undefined) {
      for (const problem of validator.request(method, path, exchange.sent)) problems.add(`${where}, request: ${problem}`);
    }
    for (const problem of validator.response(method, path, exchange.status, exchange.body)) problems.add(`${where}: ${problem}`);
  }
  return [...problems];
}

// ---------------------------------------------------------------------------
// The WebSocket channels
// ---------------------------------------------------------------------------

/** CafAI's parser for each channel its telemetry store opens; null means CafAI could not use the frame. */
export const FRAME_PARSERS: Readonly<Record<string, (value: unknown) => unknown>> = {
  '/ws/v1/machine/snapshot': parseMachineFrame,
  '/ws/v1/scale/snapshot': parseScaleFrame,
  '/ws/v1/devices': parseDevicesFrame,
  '/ws/v1/machine/shotState': parseShotStateFrame,
  '/ws/v1/machine/waterLevels': parseWaterLevelsFrame,
  '/ws/v1/machine/shotSettings': parseShotSettingsFrame,
  '/ws/v1/plugins/time-to-ready.reaplugin/timeToReady': parseTimeToReadyFrame,
};

/**
 * The paths of the channels CafAI's telemetry store opens, learnt from the
 * store itself (started once with sockets that only note their address), so
 * the suite checks whatever CafAI opens rather than a copy of the list:
 * Decaid's own (`decaid`), and the ones it opens only while Decaid has their
 * plugin loaded (`plugins`: time-to-ready's, D103).
 */
export function openedChannels(): { decaid: string[]; plugins: string[] } {
  const opened: string[] = [];
  class AddressOnlySocket {
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    constructor(url: string) {
      opened.push(new URL(url).pathname);
    }
    close(): void {}
  }
  const store = createTelemetryStore({
    client: {
      getDevices: () => Promise.resolve([]),
      getMachineState: () => Promise.reject(new Error('Not used: the store stops before it seeds.')),
    },
    wsOrigin: 'ws://decaid.invalid',
    WebSocketImpl: AddressOnlySocket as unknown as typeof WebSocket,
    visibility: null,
  });
  store.start();
  const decaid = [...opened];
  store.watchTimeToReady(true);
  const plugins = opened.slice(decaid.length);
  store.stop();
  return { decaid, plugins };
}

/** The channels CafAI's telemetry store always opens (openedChannels). */
export function telemetryChannels(): string[] {
  return openedChannels().decaid;
}

/** The spec's name for a channel: "ws/v1/machine/snapshot". */
export function channelName(path: string): string {
  return path.replace(/^\/+/, '');
}

export interface FrameCheck {
  /** What CafAI's parser made of each frame it could use. */
  parsed: unknown[];
  /** Frames that are not JSON, that CafAI's parser refused, or that differ from the pinned spec. */
  problems: string[];
}

/** Each frame through CafAI's parser for its channel and the pinned spec's schema. */
export function checkFrames(path: string, frames: readonly string[], validator: Pick<SpecValidator, 'frame'>): FrameCheck {
  const channel = channelName(path);
  const parse = FRAME_PARSERS[path];
  if (!parse) return { parsed: [], problems: [`CafAI opens ${channel}, but the live suite has no parser for it (FRAME_PARSERS in harness.ts).`] };
  const parsed: unknown[] = [];
  const spec = new Set<string>();
  let notJson = 0;
  const refused: string[] = [];
  for (const text of frames) {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      notJson += 1;
      continue;
    }
    const result = parse(value);
    if (result === null) refused.push(text);
    else parsed.push(result);
    for (const problem of validator.frame(channel, value)) spec.add(problem);
  }
  const problems: string[] = [];
  if (notJson > 0) problems.push(notJson === 1 ? '1 frame is not JSON' : `${notJson} frames are not JSON`);
  const example = refused[0];
  if (example !== undefined) problems.push(`CafAI’s parser refused ${refused.length} of ${frames.length} frames, e.g. ${example.slice(0, 200)}`);
  return { parsed, problems: [...problems, ...spec] };
}

export interface ChannelWatch {
  readonly path: string;
  /** Every text frame so far, in order. */
  readonly frames: readonly string[];
  /** True once the socket opened. */
  readonly opened: boolean;
  /** How the socket ended by itself ("error", "closed 1006"), or null. */
  readonly ended: string | null;
  close(): void;
}

/** Listen to a channel with Node's own WebSocket, keeping every frame until close(). */
export function watchChannel(wsOrigin: string, path: string): ChannelWatch {
  const frames: string[] = [];
  let opened = false;
  let ended: string | null = null;
  let socket: WebSocket | null = null;
  try {
    socket = new WebSocket(`${wsOrigin}${path}`);
  } catch (error) {
    ended = `could not open: ${describeError(error)}`;
  }
  if (socket) {
    socket.onopen = () => {
      opened = true;
    };
    socket.onmessage = (event: MessageEvent) => {
      frames.push(typeof event.data === 'string' ? event.data : String(event.data));
    };
    socket.onerror = () => {
      ended ??= 'error';
    };
    socket.onclose = (event: CloseEvent) => {
      ended ??= `closed ${event.code}`;
    };
  }
  return {
    path,
    frames,
    get opened() {
      return opened;
    },
    get ended() {
      return ended;
    },
    close() {
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      socket = null;
    },
  };
}

/** Listen to every channel at once for `ms`, then close them. */
export async function captureChannels(wsOrigin: string, paths: readonly string[], ms: number): Promise<Map<string, ChannelWatch>> {
  const watches = new Map(paths.map((path) => [path, watchChannel(wsOrigin, path)] as const));
  await sleep(ms);
  for (const watch of watches.values()) watch.close();
  return watches;
}

/**
 * Poll `check` until it gives a value (anything but null or undefined) and
 * resolve with it; reject after `timeoutMs` saying what never happened.
 */
export async function waitUntil<T>(
  check: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
  what: string,
  everyMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error(`Gave up after ${timeoutMs / 1000} s waiting for ${what}.`);
    await sleep(everyMs);
  }
}

// ---------------------------------------------------------------------------
// Putting writes back
// ---------------------------------------------------------------------------

export interface UndoList {
  /**
   * Remember how to put a write back, before making it; the newest is put
   * back first. Returns a function that puts this one back now, once (one
   * that fails stays for runAll).
   */
  add(what: string, undo: () => Promise<unknown>): () => Promise<void>;
  /** Put back what is left, newest first, every one even after a failure. Answers the failures; never throws. */
  runAll(): Promise<string[]>;
}

export function createUndoList(): UndoList {
  const pending: Array<{ what: string; undo: () => Promise<unknown> }> = [];
  return {
    add(what, undo) {
      const entry = { what, undo };
      pending.push(entry);
      return async () => {
        if (!pending.includes(entry)) return;
        await undo();
        const index = pending.indexOf(entry);
        if (index !== -1) pending.splice(index, 1);
      };
    },
    async runAll() {
      const failures: string[] = [];
      for (let entry = pending.pop(); entry; entry = pending.pop()) {
        try {
          await entry.undo();
        } catch (error) {
          failures.push(`${entry.what}: ${describeError(error)}`);
        }
      }
      return failures;
    },
  };
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with every object's keys sorted: key order never counts. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const show = (value: unknown) => (value === null || value === undefined ? 'none' : stableJson(value));

/** Every key the test added, at any depth, as null; the original's own values as they were. */
function undoMerge(original: Json, sent: Json): Json {
  const out: Json = { ...original };
  for (const [key, value] of Object.entries(sent)) {
    const before = original[key];
    if (before === undefined || before === null) out[key] = null;
    else if (isRecord(before) && isRecord(value)) out[key] = undoMerge(before, value);
  }
  return out;
}

/**
 * The context to PUT so the workflow's context is the original again.
 * Decaid merges objects key by key (extras too) and drops a context key set
 * to null, so every key the test added goes back as null. Decaid refuses a
 * null targetYield, so one the test added goes back as 0, stop-at-weight off.
 */
export function restoreContext(original: WorkflowContext | undefined, sent: WorkflowContext): WorkflowContext {
  const context = undoMerge({ ...original }, { ...sent });
  if (context.targetYield === null) context.targetYield = 0;
  return context as WorkflowContext;
}

/** The first value CafAI sent that Decaid did not keep ("extras.cafai.bagId: sent ..., got none"), or null. */
export function contextNotKept(sent: WorkflowContext, got: WorkflowContext | undefined): string | null {
  const walk = (want: Json, have: Json, at: string): string | null => {
    for (const [key, value] of Object.entries(want)) {
      const path = at === '' ? key : `${at}.${key}`;
      const kept = have[key];
      if (isRecord(value) && isRecord(kept)) {
        const nested = walk(value, kept, path);
        if (nested !== null) return nested;
      } else if (stableJson(value) !== stableJson(kept)) {
        return `${path}: sent ${show(value)}, got ${show(kept)}`;
      }
    }
    return null;
  };
  return walk({ ...sent }, { ...got }, '');
}

/** Without the keys set to null, at any depth: a key Decaid left out and one set to null are the same. */
function withoutNulls(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const out: Json = {};
  for (const [key, item] of Object.entries(value)) if (item !== null && item !== undefined) out[key] = withoutNulls(item);
  return out;
}

/** The first context key whose value differs, with both values, or null when they match. No target yield and 0 (off) are the same. */
export function contextDifference(expected: WorkflowContext | undefined, got: WorkflowContext | undefined): string | null {
  const normal = (context: WorkflowContext | undefined) => {
    const out = withoutNulls({ ...context }) as Json;
    if (out.targetYield === 0) delete out.targetYield;
    return out;
  };
  const want = normal(expected);
  const have = normal(got);
  for (const key of new Set([...Object.keys(want), ...Object.keys(have)])) {
    if (stableJson(want[key]) !== stableJson(have[key])) return `${key}: expected ${show(want[key])}, got ${show(have[key])}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writes only against a simulator (D104)
// ---------------------------------------------------------------------------

/** The ids Decaid gives its simulated machines (lib/src/services/simulated_device_service.dart). */
export const SIMULATED_MACHINE_IDS: ReadonlySet<string> = new Set(['MockDe1', 'MockBengle', 'MockReplayDe1']);
/** The simulatedDevices kinds that add a machine. */
const SIMULATED_MACHINE_KINDS: ReadonlySet<string> = new Set(['machine', 'bengle', 'replay']);

/**
 * Why this Decaid is not a simulator, or null when it is: it simulates a
 * machine, and no machine it has connected is a real one. The write and shot
 * suites refuse to run otherwise.
 */
export function simulatorProblem(settings: DecaidSettings, devices: readonly DeviceEntry[]): string | null {
  const simulated = Array.isArray(settings.simulatedDevices) ? (settings.simulatedDevices as unknown[]) : [];
  if (!simulated.some((kind) => typeof kind === 'string' && SIMULATED_MACHINE_KINDS.has(kind))) {
    return 'Decaid simulates no machine (Settings > Advanced > Simulated Devices)';
  }
  const real = devices.filter((device) => device.type === 'machine' && device.state === 'connected' && !SIMULATED_MACHINE_IDS.has(device.id));
  if (real.length > 0) return `a real machine is connected: ${real.map((device) => device.name).join(', ')}`;
  return null;
}

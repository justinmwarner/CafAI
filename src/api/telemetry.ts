// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/live.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: six channels, an immutable store, backoff 1-30 s,
// visibility reconnect, a silent-socket watchdog, shotState-driven lifecycle and timestamped samples.
/**
 * Live telemetry from Decaid's WebSockets, as an external store.
 *
 * Rules (docs/verified/02-api.md section 4, 01-platform.md section 9):
 *   - One socket per channel, reconnected only after a real close or error,
 *     with exponential backoff 1 s -> 30 s that resets on open, and at once
 *     when the page becomes visible again.
 *   - Link state comes only from ws/v1/devices (plus a REST seed at start,
 *     and again when Decaid comes back). Machine sockets stay open and
 *     silent while the DE1 is away, so silence is not death; a watchdog
 *     reopens the machine socket only when devices says the machine is
 *     connected and nothing arrived for 20 s.
 *   - Decaid is out of reach (`unreachable`) once its devices socket has not
 *     been open for 2.5 s, whatever the machine was: a socket between
 *     retries is not an outage, and a page out of sight does not count the
 *     time. What Decaid said last stays in the state, but is news again only
 *     once Decaid says which devices are connected: its devices frame,
 *     replayed on connect, or GET /devices, asked again as the socket opens.
 *     A Decaid gone without a word (no close ever arrives) leaves its
 *     sockets looking open: the watchdog that reopens a silent machine
 *     socket reopens the devices socket with it.
 *   - State is replaced, never mutated, so useSyncExternalStore selectors
 *     re-render only what changed. Live samples go to onSample listeners,
 *     not into state, so a 5 Hz shot never re-renders the app.
 *   - Malformed frames are ignored; nothing here throws.
 *   - Shots follow shotState, and the machine state stands in whenever
 *     shotState says nothing this build can read (5.9): a shot is never
 *     missed because Decaid renamed its shot states.
 *   - time-to-ready.reaplugin's channel opens only while followed
 *     (watchTimeToReady, while Decaid has the plugin loaded: D103), with the
 *     same reconnects; its socket is not one of `sockets`, which say whether
 *     Decaid itself can be reached. Only its estimate is kept, never its
 *     status, by streamline's rules (heating-countdown.js).
 *   - Every socket opened here goes into the traffic log (D139): its
 *     opening, closing and errors, and its frames, the streaming channels'
 *     at most once a second (src/traffic/recorder.ts). CafAI sends nothing
 *     on these sockets.
 */
import { recordFrame, recordSocket } from '../traffic/recorder.ts';
import { reportDrift } from './drift.ts';
import {
  describeValue,
  deviceConnections,
  KNOWN_SHOT_STATES,
  parseDevicesFrame,
  parseMachineFrame,
  parseScaleFrame,
  parseShotSettingsFrame,
  parseShotStateFrame,
  parseWaterLevelsFrame,
} from './frames.ts';
import { isShotMachineState } from './machineStates.ts';
import { parseDecaidTimestamp } from './time.ts';
import type {
  ConnectionError,
  DecaidClient,
  LiveSample,
  MachineFrame,
  ShotLifecycleEvent,
  ShotStateEvent,
  SocketStatus,
  TelemetryState,
  TelemetryStore,
  TimeToReadyFrame,
} from './types.ts';

type Channel = keyof TelemetryState['sockets'];
/** The six channels, and the plugin's, which opens only while followed. */
type SlotChannel = Channel | 'timeToReady';

const CHANNEL_PATHS: Readonly<Record<Channel, string>> = {
  machine: '/ws/v1/machine/snapshot',
  scale: '/ws/v1/scale/snapshot',
  devices: '/ws/v1/devices',
  shotState: '/ws/v1/machine/shotState',
  waterLevels: '/ws/v1/machine/waterLevels',
  shotSettings: '/ws/v1/machine/shotSettings',
};
const CHANNELS = Object.keys(CHANNEL_PATHS) as Channel[];
const TIME_TO_READY_PATH = '/ws/v1/plugins/time-to-ready.reaplugin/timeToReady';
const pathOf = (channel: SlotChannel) => (channel === 'timeToReady' ? TIME_TO_READY_PATH : CHANNEL_PATHS[channel]);
/** The channel as the traffic log names it: "ws/v1/machine/snapshot". */
const trafficName = (channel: SlotChannel) => pathOf(channel).slice(1);
/** The channels that send several frames a second: the traffic log keeps one a second of each. */
const STREAMING: ReadonlySet<SlotChannel> = new Set<SlotChannel>(['machine', 'scale', 'timeToReady']);

const TIME_TO_READY = 'ws/v1/plugins/time-to-ready.reaplugin/timeToReady';
/** The statuses time-to-ready.reaplugin sends (plugin.js at aab5f93); any other is kept, and reported. */
const TIME_TO_READY_STATUSES: ReadonlySet<string> = new Set(['heating', 'reached', 'not_heating', 'insufficient_data']);

/**
 * A time-to-ready.reaplugin frame: its status (one this build does not know
 * is kept) and its estimate, null when the plugin has none or sent one that
 * is not a number. A frame without a status cannot be used. What is wrong
 * goes to the drift log.
 */
export function parseTimeToReadyFrame(value: unknown): TimeToReadyFrame | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reportDrift(TIME_TO_READY, `frame: ${describeValue(value, 'object')}`);
    return null;
  }
  const { status, remainingTimeMs } = value as Record<string, unknown>;
  if (typeof status !== 'string') {
    reportDrift(TIME_TO_READY, `status: ${describeValue(status, 'string')}`);
    return null;
  }
  if (!TIME_TO_READY_STATUSES.has(status)) reportDrift(TIME_TO_READY, `status: unknown value "${status}"`);
  const estimate = typeof remainingTimeMs === 'number' && Number.isFinite(remainingTimeMs) ? remainingTimeMs : null;
  // The plugin sends null while it has no estimate; anything else that is not a number is new.
  if (estimate === null && remainingTimeMs !== null) reportDrift(TIME_TO_READY, `remainingTimeMs: ${describeValue(remainingTimeMs, 'number')}`);
  return { status, remainingTimeMs: estimate };
}

/** An estimate goes this long after the plugin's last frame: its socket has gone quiet (streamline's TTR_STALE_MS). */
const READY_STALE_MS = 6000;
/** How long past its deadline an estimate holds at zero: a machine can heat longer than predicted (streamline's TTR_OVERRUN_MS). */
const READY_OVERRUN_MS = 10_000;
/** Never more than five minutes: above that the estimate is noise (streamline's TTR_CAP_S; the plugin clamps to it too). */
const READY_CAP_MS = 300_000;

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** The devices socket down this long, between retries or not, is Decaid out of reach (`unreachable`). */
const UNREACHABLE_AFTER_MS = 2500;
const WATCHDOG_EVERY_MS = 5000;
const MACHINE_SILENCE_MS = 20_000;
/** How long the machine is in a shot state, with no shotState frame this build can read, before the machine state starts the shot. */
const SHOT_STATE_WAIT_MS = 3000;
/** Frames kept from that wait, for the shot's first seconds (about 15 at Decaid's rate). */
const MAX_WAITING_FRAMES = 100;

export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the store needs from `document` to reconnect when the page returns. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface TelemetryStoreOptions {
  /** REST client for the start-up seed (GET /devices, GET /machine/state). */
  client: Pick<DecaidClient, 'getDevices' | 'getMachineState'>;
  /** e.g. "ws://localhost:8080" (client.wsOrigin). */
  wsOrigin: string;
  /** Defaults to the global WebSocket, resolved per connection so a mock installed later still applies. */
  WebSocketImpl?: typeof WebSocket;
  /** Clock for the watchdog (default Date.now). */
  now?: () => number;
  /** Timer functions (default the globals, resolved per call). */
  timers?: TimerApi;
  /** Defaults to `document` when there is one. */
  visibility?: VisibilitySource | null;
}

interface Slot {
  channel: SlotChannel;
  socket: WebSocket | null;
  attempt: number;
  retry: unknown;
  lastFrameAt: number;
}

interface ShotTracking {
  id: string | null;
  /** Timestamp (epoch ms) of the shot's first espresso frame: t = 0 for samples. */
  t0: number | null;
  stopReason: string | null;
  source: 'shotState' | 'machine';
}

/** The machine's current stretch in a shot state (espresso, and skipStep between steps). */
interface EspressoStretch {
  /** When its first frame arrived (the store's clock). */
  since: number;
  /** Its frames while no shot covers it yet, for the shot that may start. */
  frames: MachineFrame[];
  /** A shot has covered it: the machine state starts no other in it. */
  covered: boolean;
}

const INITIAL_STATE: TelemetryState = {
  sockets: { machine: 'closed', scale: 'closed', devices: 'closed', shotState: 'closed', waterLevels: 'closed', shotSettings: 'closed' },
  unreachable: false,
  machineConnected: false,
  scaleConnected: false,
  machine: null,
  scale: null,
  waterLevels: null,
  shotSettings: null,
  shotState: null,
  devices: null,
  connectionError: null,
  timeToReady: null,
};

function sameError(a: ConnectionError | null, b: ConnectionError | null): boolean {
  if (a === null || b === null) return a === b;
  return a.timestamp === b.timestamp && a.kind === b.kind;
}

function notifyAll<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch {
      // One broken listener must not stop telemetry for the rest of the app.
    }
  }
}

export function createTelemetryStore(options: TelemetryStoreOptions): TelemetryStore {
  const now = options.now ?? (() => Date.now());
  const timers: TimerApi = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const visibility: VisibilitySource | null =
    options.visibility !== undefined ? options.visibility : typeof document === 'undefined' ? null : document;
  const origin = options.wsOrigin.replace(/\/+$/, '');

  let state: TelemetryState = INITIAL_STATE;
  const changeListeners = new Set<() => void>();
  const sampleListeners = new Set<(sample: LiveSample) => void>();
  const shotListeners = new Set<(event: ShotLifecycleEvent) => void>();
  const slots = Object.fromEntries(
    CHANNELS.map((channel) => [channel, { channel, socket: null, attempt: 0, retry: null, lastFrameAt: 0 } satisfies Slot]),
  ) as Record<Channel, Slot>;
  const timeToReadySlot: Slot = { channel: 'timeToReady', socket: null, attempt: 0, retry: null, lastFrameAt: 0 };
  let followingTimeToReady = false;
  /** When the machine will be ready by the plugin's last estimate (the store's clock), and the timer that drops it. */
  let readyDeadline: number | null = null;
  let readyExpiry: unknown = null;

  let running = false;
  let runId = 0;
  let watchdog: unknown = null;
  /** The timer that makes the devices socket's absence an outage (watchForOutage). */
  let outage: unknown = null;
  let devicesSeen = false;
  let machineSeen = false;
  let shotStateSeen = false;
  /** When the last shotState frame with a state this build knows arrived. */
  let knownShotStateAt = Number.NEGATIVE_INFINITY;
  let machineConnectedSince = 0;
  let shot: ShotTracking | null = null;
  let espresso: EspressoStretch | null = null;

  // ---- state -------------------------------------------------------------------------

  function update(patch: Partial<TelemetryState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof TelemetryState>) {
      if (state[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    if (patch.machineConnected === true && !state.machineConnected) machineConnectedSince = now();
    state = { ...state, ...patch };
    notifyAll(changeListeners, undefined);
  }

  function setSocket(channel: SlotChannel, status: SocketStatus): void {
    if (channel === 'timeToReady') return;
    if (state.sockets[channel] !== status) update({ sockets: { ...state.sockets, [channel]: status } });
    if (channel === 'devices') followDevicesSocket(status);
  }

  // ---- Decaid out of reach ---------------------------------------------------------------

  /** Whether Decaid can be reached follows its devices socket. */
  function followDevicesSocket(status: SocketStatus): void {
    if (status !== 'open') {
      watchForOutage();
      return;
    }
    cancelOutageWatch();
    // Back: Decaid replays its devices on connect; REST says it too, in case that frame is one CafAI cannot read.
    if (state.unreachable) void seedFromRest(runId);
  }

  /** From now, UNREACHABLE_AFTER_MS without the devices socket open is an outage. */
  function watchForOutage(): void {
    if (!running || outage !== null || state.unreachable) return;
    outage = timers.setTimeout(() => {
      outage = null;
      // Out of sight the time does not count: back in view, the sockets reconnect at once and get the moment again.
      if (!running || state.sockets.devices === 'open' || visibility?.visibilityState === 'hidden') return;
      // Whatever Decaid says next is its first word since, the REST seed's too.
      devicesSeen = false;
      machineSeen = false;
      update({ unreachable: true });
    }, UNREACHABLE_AFTER_MS);
  }

  function cancelOutageWatch(): void {
    if (outage !== null) timers.clearTimeout(outage);
    outage = null;
  }

  // ---- shot lifecycle -------------------------------------------------------------------

  function emitShot(event: ShotLifecycleEvent): void {
    notifyAll(shotListeners, event);
  }

  function sample(frame: MachineFrame): void {
    if (!shot) return;
    const at = parseDecaidTimestamp(frame.timestamp);
    if (!Number.isFinite(at)) return;
    if (shot.t0 === null) {
      if (!isShotMachineState(frame.state.state)) return;
      shot.t0 = at;
    }
    const tS = (at - shot.t0) / 1000;
    if (tS < 0) return;
    notifyAll(sampleListeners, { tS, machine: frame, scale: state.scale });
  }

  function startShot(id: string | null, source: ShotTracking['source']): void {
    shot = { id, t0: null, stopReason: null, source };
    emitShot({ type: 'started', shotId: id });
    const waited = espresso?.frames ?? [];
    if (espresso) {
      espresso.covered = true;
      espresso.frames = [];
    }
    // The frames the machine sent before CafAI heard of the shot belong to
    // it, the first of them t = 0. The first espresso frame can arrive just
    // before the shotState frame that announces the shot.
    if (waited.length > 0) for (const frame of waited) sample(frame);
    else if (source === 'shotState' && state.machine && isShotMachineState(state.machine.state.state)) sample(state.machine);
  }

  function finishShot(): void {
    const done = shot;
    if (!done) return;
    shot = null;
    emitShot({ type: 'finished', shotId: done.id, stopReason: done.stopReason });
  }

  function onShotState(event: ShotStateEvent): void {
    shotStateSeen = true;
    // A state this build does not know, renamed or new, says nothing about
    // the shot: the machine state stands in (frames.ts reports it).
    if (!KNOWN_SHOT_STATES.has(event.state)) return;
    knownShotStateAt = now();
    if (shot?.source === 'machine') {
      shot.source = 'shotState';
      shot.id ??= event.shotId;
    }
    const starting = event.state === 'preheating' || event.state === 'pouring';
    if (starting && shot && event.shotId && shot.id && event.shotId !== shot.id) finishShot();
    if (starting && !shot) startShot(event.shotId, 'shotState');
    if (shot && event.decision?.kind === 'stop') shot.stopReason = event.decision.reason;
    if (shot && (event.state === 'finished' || event.state === 'idle')) finishShot();
  }

  function onMachineFrame(frame: MachineFrame): void {
    // skipStep is the shot too: Decaid's name for the moment it moves to its next step.
    if (!isShotMachineState(frame.state.state)) {
      espresso = null;
      // A shot the machine state started ends with it; shotState ends its
      // own, after Decaid's stopping phase.
      if (shot?.source === 'machine') {
        finishShot();
        return;
      }
      sample(frame);
      return;
    }
    espresso ??= { since: now(), frames: [], covered: shot !== null };
    if (!espresso.covered) {
      // Without shotState frames (older gateways), a shot is the time spent
      // in the shot states. Once they come, they get a moment to announce
      // the shot in words this build knows.
      const quiet = now() - Math.max(espresso.since, knownShotStateAt);
      if (shotStateSeen && quiet < SHOT_STATE_WAIT_MS) {
        if (espresso.frames.length < MAX_WAITING_FRAMES) espresso.frames.push(frame);
        return;
      }
      startShot(null, 'machine');
    }
    sample(frame);
  }

  // ---- frames --------------------------------------------------------------------------

  function handle(channel: SlotChannel, value: unknown): void {
    switch (channel) {
      case 'machine': {
        const frame = parseMachineFrame(value);
        if (!frame) return;
        machineSeen = true;
        update({ machine: frame });
        onMachineFrame(frame);
        return;
      }
      case 'scale': {
        const frame = parseScaleFrame(value);
        if (!frame) return;
        if (frame.kind === 'status') update({ scaleConnected: frame.connected, scale: frame.connected ? state.scale : null });
        else update({ scale: frame.snapshot, scaleConnected: true });
        return;
      }
      case 'devices': {
        const devices = parseDevicesFrame(value);
        if (!devices) return;
        devicesSeen = true;
        const links = deviceConnections(devices) ?? { machine: false, scale: false };
        const error = devices.connectionStatus.error;
        update({
          devices,
          machineConnected: links.machine,
          scaleConnected: links.scale,
          connectionError: sameError(state.connectionError, error) ? state.connectionError : error,
          // Decaid has said which devices are connected: back in reach, with the real link in the same change.
          unreachable: false,
        });
        return;
      }
      case 'shotState': {
        const event = parseShotStateFrame(value);
        if (!event) return;
        update({ shotState: event });
        onShotState(event);
        return;
      }
      case 'waterLevels': {
        const levels = parseWaterLevelsFrame(value);
        if (levels) update({ waterLevels: levels });
        return;
      }
      case 'shotSettings': {
        const settings = parseShotSettingsFrame(value);
        if (settings) update({ shotSettings: settings });
        return;
      }
      case 'timeToReady': {
        const frame = parseTimeToReadyFrame(value);
        if (frame) onTimeToReady(frame);
        return;
      }
    }
  }

  // ---- time-to-ready ---------------------------------------------------------------------

  /**
   * The plugin works its status out from a 2 s temperature slope on every
   * snapshot, so at rest it moves between reached, not_heating and heating:
   * the status decides nothing here, and a frame without a number (most of
   * them) wipes nothing. A heating frame with a number sets the deadline;
   * every frame keeps it alive (streamline's readTimeToReadyFrame).
   */
  function onTimeToReady(frame: TimeToReadyFrame): void {
    const at = now();
    const estimate = frame.remainingTimeMs;
    if (frame.status === 'heating' && estimate !== null && estimate > 0) readyDeadline = at + estimate;
    if (readyDeadline === null || at - readyDeadline > READY_OVERRUN_MS) {
      dropReadyEstimate();
      return;
    }
    if (readyExpiry !== null) timers.clearTimeout(readyExpiry);
    readyExpiry = timers.setTimeout(dropReadyEstimate, READY_STALE_MS);
    update({ timeToReady: Math.min(Math.max(readyDeadline - at, 0), READY_CAP_MS) });
  }

  function dropReadyEstimate(): void {
    if (readyExpiry !== null) timers.clearTimeout(readyExpiry);
    readyExpiry = null;
    readyDeadline = null;
    update({ timeToReady: null });
  }

  // ---- sockets -------------------------------------------------------------------------

  function clearRetry(slot: Slot): void {
    if (slot.retry !== null) timers.clearTimeout(slot.retry);
    slot.retry = null;
  }

  function detach(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }

  /** The plugin's channel only while it is followed. */
  const wanted = (slot: Slot) => slot.channel !== 'timeToReady' || followingTimeToReady;

  function scheduleReconnect(slot: Slot): void {
    if (!running || slot.retry !== null || !wanted(slot)) return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** slot.attempt);
    slot.attempt += 1;
    slot.retry = timers.setTimeout(() => {
      slot.retry = null;
      connect(slot);
    }, delay);
  }

  /** Forget a socket; an error and the close that follows it schedule one reconnect. */
  function drop(slot: Slot, socket: WebSocket, reconnect: boolean): void {
    if (slot.socket !== socket) return;
    slot.socket = null;
    detach(socket);
    try {
      socket.close();
    } catch {
      // Already closed.
    }
    setSocket(slot.channel, 'closed');
    if (reconnect) scheduleReconnect(slot);
  }

  function connect(slot: Slot): void {
    if (!running || slot.socket || !wanted(slot)) return;
    clearRetry(slot);
    const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
    const name = trafficName(slot.channel);
    recordSocket(name, 'sent', 'connect');
    let socket: WebSocket;
    try {
      socket = new Impl(`${origin}${pathOf(slot.channel)}`);
    } catch {
      recordSocket(name, 'received', 'could not open', true);
      setSocket(slot.channel, 'closed');
      scheduleReconnect(slot);
      return;
    }
    slot.socket = socket;
    setSocket(slot.channel, 'connecting');
    socket.onopen = () => {
      if (slot.socket !== socket) return;
      recordSocket(name, 'received', 'open');
      slot.attempt = 0;
      slot.lastFrameAt = now();
      setSocket(slot.channel, 'open');
    };
    socket.onmessage = (event: MessageEvent) => {
      if (slot.socket !== socket) return;
      slot.lastFrameAt = now();
      const data = String(event.data);
      recordFrame(name, data, STREAMING.has(slot.channel));
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      try {
        handle(slot.channel, value);
      } catch {
        // A frame we cannot use is dropped, never fatal.
      }
    };
    socket.onclose = (event) => {
      if (slot.socket === socket) {
        // 1000 is a normal close; anything else (1006: the connection was lost) is not.
        const code = event?.code;
        recordSocket(name, 'received', code ? `closed ${code}${event.reason ? ` ${event.reason}` : ''}` : 'closed', code !== 1000);
      }
      drop(slot, socket, true);
    };
    socket.onerror = () => {
      if (slot.socket === socket) recordSocket(name, 'received', 'error', true);
      drop(slot, socket, true);
    };
  }

  function checkMachineSilence(): void {
    const slot = slots.machine;
    const socket = slot.socket;
    if (!running || !socket || !state.machineConnected || state.sockets.machine !== 'open') return;
    // Silence only counts while devices says the machine is there.
    const quietSince = Math.max(slot.lastFrameAt, machineConnectedSince);
    if (now() - quietSince < MACHINE_SILENCE_MS) return;
    const silent = `silent ${Math.round(MACHINE_SILENCE_MS / 1000)} s`;
    recordSocket(trafficName(slot.channel), 'sent', `close (${silent})`);
    drop(slot, socket, false);
    connect(slot);
    // So quiet a machine may be a Decaid gone without a word: a tablet that lost its power or its Wi-Fi sends no
    // close, and nothing pings, so its devices socket would look open for ever. Opened again, a gone Decaid's is
    // out of reach UNREACHABLE_AFTER_MS later; a healthy one replays its devices long before, the link unchanged.
    const devices = slots.devices;
    if (devices.socket && state.sockets.devices === 'open') {
      recordSocket(trafficName(devices.channel), 'sent', `close (machine ${silent})`);
      drop(devices, devices.socket, false);
      connect(devices);
    }
  }

  function scheduleWatchdog(): void {
    watchdog = timers.setTimeout(() => {
      watchdog = null;
      checkMachineSilence();
      if (running) scheduleWatchdog();
    }, WATCHDOG_EVERY_MS);
  }

  function onVisibilityChange(): void {
    if (!running || visibility?.visibilityState !== 'visible') return;
    for (const slot of [...CHANNELS.map((channel) => slots[channel]), timeToReadySlot]) {
      if (!slot.socket) connect(slot);
    }
    // Time out of sight did not count (watchForOutage): the reconnect just made gets the moment first.
    cancelOutageWatch();
    if (state.sockets.devices !== 'open') watchForOutage();
    checkMachineSilence();
  }

  /** Closes a socket for good: no reconnect, and the backoff starts over. */
  function close(slot: Slot): void {
    clearRetry(slot);
    slot.attempt = 0;
    if (!slot.socket) return;
    recordSocket(trafficName(slot.channel), 'sent', 'close');
    drop(slot, slot.socket, false);
  }

  async function seedFromRest(id: number): Promise<void> {
    try {
      const devices = await options.client.getDevices();
      if (id !== runId || devicesSeen) return;
      const links = deviceConnections({ devices }) ?? { machine: false, scale: false };
      const patch: Partial<TelemetryState> = { machineConnected: links.machine, scaleConnected: links.scale };
      // With its devices socket open again, Decaid has said which devices are connected: back in reach.
      if (state.sockets.devices === 'open') patch.unreachable = false;
      update(patch);
    } catch {
      return;
    }
    // After a page reload the snapshot socket may not send a fresh frame for
    // a while; seed the machine panel from REST (read like a frame by the client).
    if (!state.machineConnected) return;
    try {
      const frame = await options.client.getMachineState();
      if (id !== runId || machineSeen) return;
      update({ machine: frame });
    } catch {
      // Not connected after all, a reply CafAI could not read, or a timeout: the sockets will tell us.
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    onSample(listener) {
      sampleListeners.add(listener);
      return () => void sampleListeners.delete(listener);
    },
    onShot(listener) {
      shotListeners.add(listener);
      return () => void shotListeners.delete(listener);
    },
    start() {
      if (running) return;
      running = true;
      runId += 1;
      devicesSeen = false;
      machineSeen = false;
      for (const channel of CHANNELS) connect(slots[channel]);
      connect(timeToReadySlot);
      scheduleWatchdog();
      visibility?.addEventListener('visibilitychange', onVisibilityChange);
      void seedFromRest(runId);
    },
    stop() {
      if (!running) return;
      running = false;
      runId += 1;
      if (watchdog !== null) timers.clearTimeout(watchdog);
      watchdog = null;
      cancelOutageWatch();
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      for (const channel of CHANNELS) close(slots[channel]);
      close(timeToReadySlot);
      dropReadyEstimate();
      // Whatever shot was open is unknown now; the next start re-learns it.
      shot = null;
      espresso = null;
    },
    watchTimeToReady(on) {
      if (on === followingTimeToReady) return;
      followingTimeToReady = on;
      if (on) {
        connect(timeToReadySlot);
        return;
      }
      close(timeToReadySlot);
      // An estimate nothing updates any more is not one.
      dropReadyEstimate();
    },
  };
}

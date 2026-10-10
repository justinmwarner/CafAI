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
 *   - Link state comes only from ws/v1/devices (plus a REST seed at start).
 *     Machine sockets stay open and silent while the DE1 is away, so silence
 *     is not death; a watchdog reopens the machine socket only when devices
 *     says the machine is connected and nothing arrived for 20 s.
 *   - State is replaced, never mutated, so useSyncExternalStore selectors
 *     re-render only what changed. Live samples go to onSample listeners,
 *     not into state, so a 5 Hz shot never re-renders the app.
 *   - Malformed frames are ignored; nothing here throws.
 *   - Shots follow shotState, and the machine state stands in whenever
 *     shotState says nothing this build can read (5.9): a shot is never
 *     missed because Decaid renamed its shot states.
 */
import {
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
} from './types.ts';

type Channel = keyof TelemetryState['sockets'];

const CHANNEL_PATHS: Readonly<Record<Channel, string>> = {
  machine: '/ws/v1/machine/snapshot',
  scale: '/ws/v1/scale/snapshot',
  devices: '/ws/v1/devices',
  shotState: '/ws/v1/machine/shotState',
  waterLevels: '/ws/v1/machine/waterLevels',
  shotSettings: '/ws/v1/machine/shotSettings',
};
const CHANNELS = Object.keys(CHANNEL_PATHS) as Channel[];

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
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
  channel: Channel;
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
  machineConnected: false,
  scaleConnected: false,
  machine: null,
  scale: null,
  waterLevels: null,
  shotSettings: null,
  shotState: null,
  devices: null,
  connectionError: null,
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

  let running = false;
  let runId = 0;
  let watchdog: unknown = null;
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

  function setSocket(channel: Channel, status: SocketStatus): void {
    if (state.sockets[channel] === status) return;
    update({ sockets: { ...state.sockets, [channel]: status } });
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

  function handle(channel: Channel, value: unknown): void {
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
    }
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

  function scheduleReconnect(slot: Slot): void {
    if (!running || slot.retry !== null) return;
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
    if (!running || slot.socket) return;
    clearRetry(slot);
    const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
    let socket: WebSocket;
    try {
      socket = new Impl(`${origin}${CHANNEL_PATHS[slot.channel]}`);
    } catch {
      setSocket(slot.channel, 'closed');
      scheduleReconnect(slot);
      return;
    }
    slot.socket = socket;
    setSocket(slot.channel, 'connecting');
    socket.onopen = () => {
      if (slot.socket !== socket) return;
      slot.attempt = 0;
      slot.lastFrameAt = now();
      setSocket(slot.channel, 'open');
    };
    socket.onmessage = (event: MessageEvent) => {
      if (slot.socket !== socket) return;
      slot.lastFrameAt = now();
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      try {
        handle(slot.channel, value);
      } catch {
        // A frame we cannot use is dropped, never fatal.
      }
    };
    socket.onclose = () => drop(slot, socket, true);
    socket.onerror = () => drop(slot, socket, true);
  }

  function checkMachineSilence(): void {
    const slot = slots.machine;
    const socket = slot.socket;
    if (!running || !socket || !state.machineConnected || state.sockets.machine !== 'open') return;
    // Silence only counts while devices says the machine is there.
    const quietSince = Math.max(slot.lastFrameAt, machineConnectedSince);
    if (now() - quietSince < MACHINE_SILENCE_MS) return;
    drop(slot, socket, false);
    connect(slot);
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
    for (const channel of CHANNELS) {
      const slot = slots[channel];
      if (!slot.socket) connect(slot);
    }
    checkMachineSilence();
  }

  async function seedFromRest(id: number): Promise<void> {
    try {
      const devices = await options.client.getDevices();
      if (id !== runId || devicesSeen) return;
      const links = deviceConnections({ devices }) ?? { machine: false, scale: false };
      update({ machineConnected: links.machine, scaleConnected: links.scale });
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
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      for (const channel of CHANNELS) {
        const slot = slots[channel];
        clearRetry(slot);
        slot.attempt = 0;
        if (slot.socket) drop(slot, slot.socket, false);
      }
      // Whatever shot was open is unknown now; the next start re-learns it.
      shot = null;
      espresso = null;
    },
  };
}

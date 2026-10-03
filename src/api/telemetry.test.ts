import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../mock/fixtures/index.ts';
import { createTelemetryStore, type TelemetryStoreOptions } from './telemetry.ts';
import { createFakeWebSocket, type FakeWebSocketFactory } from './testing/fakeWebSocket.ts';
import type {
  ConnectionError,
  DecaidClient,
  DevicesState,
  LiveSample,
  MachineSnapshot,
  ShotLifecycleEvent,
  ShotStateEvent,
  TelemetryStore,
} from './types.ts';

const PATHS = {
  machine: '/ws/v1/machine/snapshot',
  scale: '/ws/v1/scale/snapshot',
  devices: '/ws/v1/devices',
  shotState: '/ws/v1/machine/shotState',
  waterLevels: '/ws/v1/machine/waterLevels',
  shotSettings: '/ws/v1/machine/shotSettings',
} as const;

function devicesFrame(machine: 'connected' | 'disconnected', scale: 'connected' | 'disconnected' = 'connected', error: ConnectionError | null = null): DevicesState {
  const frame = fixtures.devicesWs();
  frame.devices = frame.devices.map((device) =>
    device.type === 'machine' ? { ...device, state: machine, available: machine === 'connected' } : { ...device, state: scale },
  );
  frame.connectionStatus.error = error;
  return frame;
}

function machineFrame(state: string, substate: string, timestamp: string, extra: Partial<MachineSnapshot> = {}): MachineSnapshot {
  return { ...fixtures.machineState(), state: { state, substate }, timestamp, ...extra };
}

function shotEvent(state: ShotStateEvent['state'], extra: Partial<ShotStateEvent> = {}): ShotStateEvent {
  return {
    event: 'state',
    timestamp: '2026-10-03T08:15:02.725113',
    shotId: 'shot-1',
    state,
    machineState: 'espresso',
    machineSubstate: 'preparingForShot',
    profileFrame: 0,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
    ...extra,
  };
}

interface Harness {
  store: TelemetryStore;
  ws: FakeWebSocketFactory;
  client: { getDevices: ReturnType<typeof vi.fn>; getMachineState: ReturnType<typeof vi.fn> };
  shots: ShotLifecycleEvent[];
  samples: LiveSample[];
  changes: () => number;
  visibility: { visibilityState: string; fire(): void };
  open(): void;
}

function harness(overrides: Partial<TelemetryStoreOptions> = {}, rest: { devices?: unknown; machine?: unknown } = {}): Harness {
  const ws = createFakeWebSocket();
  const client = {
    getDevices: vi.fn(async () => {
      if (rest.devices instanceof Error) throw rest.devices;
      return (rest.devices ?? []) as never;
    }),
    getMachineState: vi.fn(async () => {
      if (rest.machine instanceof Error) throw rest.machine;
      return rest.machine as never;
    }),
  };
  const listeners = new Set<() => void>();
  const visibility = {
    visibilityState: 'visible',
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    fire() {
      for (const listener of [...listeners]) listener();
    },
  };
  const store = createTelemetryStore({
    client: client as unknown as DecaidClient,
    wsOrigin: 'ws://tablet.local:8080',
    WebSocketImpl: ws.WebSocketImpl as unknown as typeof WebSocket,
    visibility,
    ...overrides,
  });
  const shots: ShotLifecycleEvent[] = [];
  const samples: LiveSample[] = [];
  let count = 0;
  store.onShot((event) => shots.push(event));
  store.onSample((sample) => samples.push(sample));
  store.subscribe(() => (count += 1));
  return {
    store,
    ws,
    client,
    shots,
    samples,
    changes: () => count,
    visibility,
    open() {
      for (const path of Object.values(PATHS)) ws.latest(path).open();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 3, 8, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sockets', () => {
  it('opens exactly one socket per channel on the gateway origin', () => {
    const h = harness();
    h.store.start();
    h.store.start();
    expect(h.ws.sockets.map((s) => s.url).sort()).toEqual(Object.values(PATHS).map((p) => `ws://tablet.local:8080${p}`).sort());
    expect(h.store.getState().sockets).toEqual({
      machine: 'connecting',
      scale: 'connecting',
      devices: 'connecting',
      shotState: 'connecting',
      waterLevels: 'connecting',
      shotSettings: 'connecting',
    });
    h.open();
    expect(Object.values(h.store.getState().sockets).every((s) => s === 'open')).toBe(true);
  });

  it('reconnects only after a close, with backoff 1 s doubling to 30 s, reset on open', async () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.devices).drop();
    expect(h.store.getState().sockets.devices).toBe('closed');

    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const before = h.ws.sockets.length;
      let waited = 0;
      while (h.ws.sockets.length === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
        if (waited > 60_000) throw new Error('no reconnect');
      }
      delays.push(waited);
      h.ws.latest(PATHS.devices).drop();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);

    await vi.advanceTimersByTimeAsync(30_000);
    h.ws.latest(PATHS.devices).open();
    h.ws.latest(PATHS.devices).drop();
    const before = h.ws.sockets.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.ws.sockets.length, 'backoff reset after a successful open').toBe(before + 1);
  });

  it('an error followed by a close schedules one reconnect, never two sockets', async () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.machine).fail();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.ws.live(PATHS.machine)).toHaveLength(1);
    expect(h.ws.sockets.filter((s) => s.path === PATHS.machine)).toHaveLength(2);
  });

  it('reconnects a closed socket at once when the page becomes visible', async () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.scale).drop();
    await vi.advanceTimersByTimeAsync(1000);
    h.ws.latest(PATHS.scale).drop();
    const before = h.ws.sockets.length;
    h.visibility.visibilityState = 'hidden';
    h.visibility.fire();
    expect(h.ws.sockets.length).toBe(before);
    h.visibility.visibilityState = 'visible';
    h.visibility.fire();
    expect(h.ws.sockets.length).toBe(before + 1);
    // The pending backoff timer must not open a second socket later.
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.ws.live(PATHS.scale)).toHaveLength(1);
    // Open sockets are left alone.
    h.visibility.fire();
    expect(h.ws.live(PATHS.scale)).toHaveLength(1);
  });

  it('stop closes everything and nothing reconnects afterwards', async () => {
    const h = harness();
    h.store.start();
    h.open();
    h.store.stop();
    expect(h.ws.sockets.every((s) => s.closedByClient)).toBe(true);
    expect(Object.values(h.store.getState().sockets).every((s) => s === 'closed')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.ws.sockets).toHaveLength(6);
    h.store.start();
    expect(h.ws.sockets).toHaveLength(12);
  });

  it('a constructor that throws is retried with backoff', async () => {
    let calls = 0;
    const ws = createFakeWebSocket();
    class Flaky extends ws.WebSocketImpl {
      constructor(url: string) {
        calls += 1;
        if (calls <= 6) throw new Error('SecurityError');
        super(url);
      }
    }
    const h = harness({ WebSocketImpl: Flaky as unknown as typeof WebSocket });
    h.store.start();
    expect(h.store.getState().sockets.machine).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.sockets.length).toBeGreaterThan(0);
  });
});

describe('link state', () => {
  it('comes only from ws/v1/devices, never from machine frames', () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.machine).message(machineFrame('idle', 'idle', '2026-10-03T08:00:00.100000'));
    expect(h.store.getState().machineConnected).toBe(false);
    expect(h.store.getState().machine?.state.state).toBe('idle');

    h.ws.latest(PATHS.devices).message(devicesFrame('connected'));
    expect(h.store.getState()).toMatchObject({ machineConnected: true, scaleConnected: true });

    h.ws.latest(PATHS.devices).message(devicesFrame('disconnected'));
    h.ws.latest(PATHS.machine).message(machineFrame('idle', 'idle', '2026-10-03T08:00:00.300000'));
    expect(h.store.getState().machineConnected, 'a late snapshot does not override devices').toBe(false);
  });

  it('is seeded from REST at start: GET /devices, then GET /machine/state when connected', async () => {
    const snapshot = fixtures.machineState();
    const h = harness({}, { devices: devicesFrame('connected').devices, machine: snapshot });
    h.store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.client.getDevices).toHaveBeenCalledTimes(1);
    expect(h.client.getMachineState).toHaveBeenCalledTimes(1);
    expect(h.store.getState()).toMatchObject({ machineConnected: true, scaleConnected: true, machine: snapshot });
  });

  it('does not ask for the machine state when the machine is away, and survives REST failures', async () => {
    const away = harness({}, { devices: devicesFrame('disconnected').devices });
    away.store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(away.client.getMachineState).not.toHaveBeenCalled();

    const broken = harness({}, { devices: new Error('network') });
    broken.store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(broken.store.getState().machineConnected).toBe(false);
  });

  it('a socket frame that arrived first wins over the slower REST seed', async () => {
    let resolveDevices: (value: unknown) => void = () => {};
    const h = harness();
    h.client.getDevices.mockImplementation(() => new Promise((resolve) => (resolveDevices = resolve)));
    h.store.start();
    h.open();
    h.ws.latest(PATHS.devices).message(devicesFrame('disconnected'));
    resolveDevices(devicesFrame('connected').devices);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.getState().machineConnected).toBe(false);
  });

  it('scale frames branch on status vs weight', () => {
    const h = harness();
    h.store.start();
    h.open();
    const scale = h.ws.latest(PATHS.scale);
    scale.message({ status: 'connected' });
    expect(h.store.getState().scaleConnected).toBe(true);
    scale.message(fixtures.scaleSnapshotWs());
    expect(h.store.getState().scale).toEqual(fixtures.scaleSnapshotWs());
    scale.message({ status: 'disconnected' });
    expect(h.store.getState()).toMatchObject({ scaleConnected: false, scale: null });
  });

  it('connectionError follows devices, de-duplicated by timestamp', () => {
    const h = harness();
    h.store.start();
    h.open();
    const error: ConnectionError = {
      kind: 'profileUploadFailed',
      severity: 'warning',
      timestamp: '2026-10-03T06:20:00.000000Z',
      deviceId: null,
      deviceName: null,
      message: 'Profile upload failed. Retrying.',
      suggestion: null,
      details: null,
    };
    h.ws.latest(PATHS.devices).message(devicesFrame('connected', 'connected', error));
    const first = h.store.getState().connectionError;
    expect(first).toMatchObject({ kind: 'profileUploadFailed' });
    h.ws.latest(PATHS.devices).message(devicesFrame('connected', 'connected', { ...error }));
    expect(h.store.getState().connectionError, 'same event, same object').toBe(first);
    h.ws.latest(PATHS.devices).message(devicesFrame('connected', 'connected', { ...error, timestamp: '2026-10-03T06:21:00.000000Z' }));
    expect(h.store.getState().connectionError).not.toBe(first);
    h.ws.latest(PATHS.devices).message(devicesFrame('connected'));
    expect(h.store.getState().connectionError).toBeNull();
  });

  it('keeps water levels and shot settings', () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.waterLevels).message(fixtures.waterLevelsWs());
    h.ws.latest(PATHS.shotSettings).message(fixtures.shotSettings());
    expect(h.store.getState()).toMatchObject({ waterLevels: fixtures.waterLevelsWs(), shotSettings: fixtures.shotSettings() });
  });

  it('ignores malformed frames without throwing or notifying', () => {
    const h = harness();
    h.store.start();
    h.open();
    const before = h.store.getState();
    const changes = h.changes();
    for (const path of Object.values(PATHS)) {
      for (const junk of ['{not json', '42', '[]', 'null', JSON.stringify({ hello: 'world' })]) {
        expect(() => h.ws.latest(path).message(junk)).not.toThrow();
      }
    }
    expect(h.store.getState()).toBe(before);
    expect(h.changes()).toBe(changes);
  });

  it('replaces state immutably and survives a throwing listener', () => {
    const h = harness();
    h.store.subscribe(() => {
      throw new Error('listener bug');
    });
    h.store.start();
    const before = h.store.getState();
    h.open();
    h.ws.latest(PATHS.devices).message(devicesFrame('connected'));
    const after = h.store.getState();
    expect(after).not.toBe(before);
    expect(before.machineConnected).toBe(false);
    expect(after.machineConnected).toBe(true);
  });
});

describe('watchdog', () => {
  it('reopens a silent machine socket only while devices says the machine is connected', async () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.devices).message(devicesFrame('disconnected'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.ws.sockets.filter((s) => s.path === PATHS.machine), 'silence is not death').toHaveLength(1);

    h.ws.latest(PATHS.devices).message(devicesFrame('connected'));
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(5000);
      h.ws.latest(PATHS.machine).message(machineFrame('idle', 'idle', '2026-10-03T08:01:00.000000'));
    }
    expect(h.ws.sockets.filter((s) => s.path === PATHS.machine), 'frames keep it alive').toHaveLength(1);

    await vi.advanceTimersByTimeAsync(25_000);
    const machineSockets = h.ws.sockets.filter((s) => s.path === PATHS.machine);
    expect(machineSockets).toHaveLength(2);
    expect(machineSockets[0]!.closedByClient).toBe(true);
    expect(h.ws.live(PATHS.machine)).toHaveLength(1);
  });
});

describe('shot lifecycle and live samples', () => {
  function shotHarness() {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.devices).message(devicesFrame('connected'));
    h.ws.latest(PATHS.shotState).message(shotEvent('idle', { shotId: null, machineState: null, machineSubstate: null }));
    return h;
  }

  it('prefers shotState: started once, finished once with the stop reason', () => {
    const h = shotHarness();
    const machine = h.ws.latest(PATHS.machine);
    const shotState = h.ws.latest(PATHS.shotState);
    const scale = h.ws.latest(PATHS.scale);

    shotState.message(shotEvent('preheating'));
    machine.message(machineFrame('espresso', 'preparingForShot', '2026-10-03T08:15:02.725113'));
    shotState.message(shotEvent('preheating'));
    machine.message(machineFrame('espresso', 'preinfusion', '2026-10-03T08:15:07.345113'));
    shotState.message(shotEvent('pouring'));
    scale.message({ ...fixtures.scaleSnapshotWs(), weight: 12.3 });
    machine.message(machineFrame('espresso', 'pouring', '2026-10-03T08:15:22.314113'));
    shotState.message(
      shotEvent('pouring', { event: 'decision', decision: { kind: 'advance', reason: 'profileAdvance', details: null, data: null } }),
    );
    shotState.message(
      shotEvent('pouring', { event: 'decision', decision: { kind: 'stop', reason: 'targetWeight', details: 'Target weight 36.0g reached', data: null } }),
    );
    shotState.message(shotEvent('stopping'));
    machine.message(machineFrame('idle', 'idle', '2026-10-03T08:15:38.100000'));
    shotState.message(shotEvent('finished'));
    machine.message(machineFrame('idle', 'idle', '2026-10-03T08:15:39.100000'));
    shotState.message(shotEvent('idle', { shotId: null }));

    expect(h.shots).toEqual([
      { type: 'started', shotId: 'shot-1' },
      { type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' },
    ]);
    expect(h.samples.map((s) => Number(s.tS.toFixed(3)))).toEqual([0, 4.62, 19.589, 35.375]);
    expect(h.samples[2]!.scale?.weight).toBe(12.3);
    expect(h.samples[0]!.scale).toBeNull();
    expect(h.samples.at(-1)!.machine.state.state, 'frames up to the finish are samples').toBe('idle');
  });

  it('catches the first espresso frame when it arrives before the shotState frame', () => {
    const h = shotHarness();
    h.ws.latest(PATHS.machine).message(machineFrame('espresso', 'preparingForShot', '2026-10-03T08:15:02.725113'));
    h.ws.latest(PATHS.shotState).message(shotEvent('preheating'));
    h.ws.latest(PATHS.machine).message(machineFrame('espresso', 'preparingForShot', '2026-10-03T08:15:02.925113'));
    expect(h.shots).toEqual([{ type: 'started', shotId: 'shot-1' }]);
    expect(h.samples.map((s) => Number(s.tS.toFixed(3)))).toEqual([0, 0.2]);
  });

  it('an aborted shot finishes without a stop reason', () => {
    const h = shotHarness();
    h.ws.latest(PATHS.shotState).message(shotEvent('preheating'));
    h.ws.latest(PATHS.shotState).message(
      shotEvent('preheating', { event: 'decision', decision: { kind: 'abort', reason: 'apiStop', details: null, data: null } }),
    );
    h.ws.latest(PATHS.shotState).message(shotEvent('idle', { shotId: null }));
    expect(h.shots).toEqual([
      { type: 'started', shotId: 'shot-1' },
      { type: 'finished', shotId: 'shot-1', stopReason: null },
    ]);
  });

  it('a replayed finished or stopping frame does not invent a shot', () => {
    const h = harness();
    h.store.start();
    h.open();
    h.ws.latest(PATHS.shotState).message(shotEvent('finished'));
    h.ws.latest(PATHS.shotState).message(shotEvent('stopping'));
    expect(h.shots).toEqual([]);
  });

  it('a new shot id while one is open closes the old shot first', () => {
    const h = shotHarness();
    h.ws.latest(PATHS.shotState).message(shotEvent('pouring'));
    h.ws.latest(PATHS.shotState).message(shotEvent('preheating', { shotId: 'shot-2' }));
    expect(h.shots).toEqual([
      { type: 'started', shotId: 'shot-1' },
      { type: 'finished', shotId: 'shot-1', stopReason: null },
      { type: 'started', shotId: 'shot-2' },
    ]);
  });

  it('falls back to machine state transitions when Decaid sends no shotState frames', () => {
    const h = harness();
    h.store.start();
    h.open();
    const machine = h.ws.latest(PATHS.machine);
    machine.message(machineFrame('idle', 'idle', '2026-10-03T08:15:00.000000'));
    machine.message(machineFrame('espresso', 'preparingForShot', '2026-10-03T08:15:01.000000'));
    machine.message(machineFrame('espresso', 'pouring', '2026-10-03T08:15:11.500000'));
    machine.message(machineFrame('idle', 'idle', '2026-10-03T08:15:30.000000'));
    expect(h.shots).toEqual([
      { type: 'started', shotId: null },
      { type: 'finished', shotId: null, stopReason: null },
    ]);
    expect(h.samples.map((s) => s.tS)).toEqual([0, 10.5]);
  });

  it('unsubscribing stops delivery', () => {
    const h = shotHarness();
    const extra: LiveSample[] = [];
    const off = h.store.onSample((sample) => extra.push(sample));
    off();
    h.ws.latest(PATHS.shotState).message(shotEvent('preheating'));
    h.ws.latest(PATHS.machine).message(machineFrame('espresso', 'preparingForShot', '2026-10-03T08:15:02.725113'));
    expect(extra).toEqual([]);
    expect(h.samples).toHaveLength(1);
  });
});

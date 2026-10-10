import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../mock/fixtures/index.ts';
import { driftLog } from './drift.ts';
import { createTelemetryStore, type TelemetryStoreOptions } from './telemetry.ts';
import { createFakeWebSocket, type FakeWebSocketFactory } from './testing/fakeWebSocket.ts';
import type {
  ConnectionError,
  DecaidClient,
  DevicesState,
  LiveSample,
  MachineFrame,
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
  driftLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('keeps a missing reading null, never 0, from the socket and from the REST seed (5.8)', async () => {
    const { groupTemperature: _group, ...seed } = fixtures.machineState();
    const seeded: MachineFrame = { ...seed, groupTemperature: null };
    const h = harness({}, { devices: devicesFrame('connected').devices, machine: seeded });
    h.store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.getState().machine?.groupTemperature).toBeNull();
    h.open();
    const { pressure: _pressure, ...frame } = machineFrame('idle', 'idle', '2026-10-03T08:00:01.000000');
    h.ws.latest(PATHS.machine).message(frame);
    expect(h.store.getState().machine).toMatchObject({ pressure: null, groupTemperature: frame.groupTemperature });
    expect(driftLog.list().map((entry) => entry.problem)).toEqual(['pressure: missing']);
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

  describe('when shotState frames come but none can be read (5.9)', () => {
    /** Machine time t seconds into the shot, which starts at 08:15:00. */
    const at = (t: number) => `2026-10-03T08:15:${t.toFixed(6).padStart(9, '0')}`;

    it('renamed shot states: the machine state stands in after 3 s, one start and one finish', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      const shotState = h.ws.latest(PATHS.shotState);
      machine.message(machineFrame('idle', 'idle', '2026-10-03T08:14:59.000000'));

      machine.message(machineFrame('espresso', 'preparingForShot', at(0)));
      shotState.message(shotEvent('brewing'));
      await vi.advanceTimersByTimeAsync(1000);
      machine.message(machineFrame('espresso', 'preparingForShot', at(1)));
      expect(h.shots, 'shotState gets 3 s to speak').toEqual([]);

      await vi.advanceTimersByTimeAsync(2000);
      machine.message(machineFrame('espresso', 'preinfusion', at(3)));
      expect(h.shots).toEqual([{ type: 'started', shotId: null }]);
      // The frames the machine sent while CafAI waited belong to the shot: t = 0 is its first.
      expect(h.samples.map((s) => s.tS)).toEqual([0, 1, 3]);

      for (const t of [4, 5, 6]) {
        await vi.advanceTimersByTimeAsync(1000);
        machine.message(machineFrame('espresso', 'pouring', at(t)));
      }
      shotState.message(shotEvent('done'));
      machine.message(machineFrame('idle', 'idle', at(7)));
      shotState.message(shotEvent('idle', { shotId: null }));
      machine.message(machineFrame('idle', 'idle', at(8)));

      expect(h.shots).toEqual([
        { type: 'started', shotId: null },
        { type: 'finished', shotId: null, stopReason: null },
      ]);
      expect(h.samples.map((s) => s.tS)).toEqual([0, 1, 3, 4, 5, 6]);
      expect(driftLog.list().map(({ source, problem }) => `${source} ${problem}`)).toEqual([
        'ws/v1/machine/shotState state: unknown value "brewing"',
        'ws/v1/machine/shotState state: unknown value "done"',
      ]);
    });

    it('normal shotState frames still win, however long the shot runs: no double events', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      const shotState = h.ws.latest(PATHS.shotState);
      machine.message(machineFrame('espresso', 'preparingForShot', at(0)));
      await vi.advanceTimersByTimeAsync(50);
      shotState.message(shotEvent('preheating'));
      for (let t = 1; t <= 12; t += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        machine.message(machineFrame('espresso', t < 4 ? 'preinfusion' : 'pouring', at(t)));
        if (t === 4) shotState.message(shotEvent('pouring'));
      }
      shotState.message(shotEvent('pouring', { event: 'decision', decision: { kind: 'stop', reason: 'targetWeight', details: null, data: null } }));
      shotState.message(shotEvent('stopping'));
      // Decaid stays in its stopping state while the cup settles; the machine may linger in espresso a while.
      for (let t = 13; t <= 17; t += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        machine.message(machineFrame(t < 16 ? 'espresso' : 'idle', t < 16 ? 'pouringDone' : 'idle', at(t)));
      }
      shotState.message(shotEvent('finished'));
      shotState.message(shotEvent('idle', { shotId: null }));
      for (let t = 18; t <= 22; t += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        machine.message(machineFrame('idle', 'idle', at(t)));
      }
      expect(h.shots).toEqual([
        { type: 'started', shotId: 'shot-1' },
        { type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' },
      ]);
      expect(driftLog.list()).toEqual([]);
    });

    it('a finished shot is never started again by the machine lingering in espresso', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      const shotState = h.ws.latest(PATHS.shotState);
      shotState.message(shotEvent('preheating'));
      machine.message(machineFrame('espresso', 'pouring', at(0)));
      shotState.message(shotEvent('finished'));
      for (let t = 1; t <= 6; t += 1) {
        await vi.advanceTimersByTimeAsync(1000);
        machine.message(machineFrame('espresso', 'pouringDone', at(t)));
      }
      expect(h.shots).toEqual([
        { type: 'started', shotId: 'shot-1' },
        { type: 'finished', shotId: 'shot-1', stopReason: null },
      ]);
    });

    it('a readable shotState frame that comes late takes over the shot: still one start and one finish', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      const shotState = h.ws.latest(PATHS.shotState);
      machine.message(machineFrame('espresso', 'preinfusion', at(0)));
      await vi.advanceTimersByTimeAsync(3000);
      machine.message(machineFrame('espresso', 'pouring', at(3)));
      shotState.message(shotEvent('pouring', { shotId: 'shot-7' }));
      // Decaid's shotState ends the shot now, after its stopping phase, not the machine.
      machine.message(machineFrame('idle', 'idle', at(20)));
      expect(h.shots).toEqual([{ type: 'started', shotId: null }]);
      shotState.message(shotEvent('finished', { shotId: 'shot-7' }));
      expect(h.shots).toEqual([
        { type: 'started', shotId: null },
        { type: 'finished', shotId: 'shot-7', stopReason: null },
      ]);
    });

    it('a skipStep frame mid-pour is part of the shot: still one start and one finish', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      const shotState = h.ws.latest(PATHS.shotState);
      machine.message(machineFrame('espresso', 'preinfusion', at(0)));
      shotState.message(shotEvent('brewing'));
      await vi.advanceTimersByTimeAsync(3000);
      machine.message(machineFrame('espresso', 'pouring', at(3)));
      await vi.advanceTimersByTimeAsync(1000);
      // Decaid maps the DE1's move to its next step to skipStep, for a frame or so.
      machine.message(machineFrame('skipStep', 'pouring', at(4)));
      await vi.advanceTimersByTimeAsync(1000);
      machine.message(machineFrame('espresso', 'pouring', at(5)));
      machine.message(machineFrame('idle', 'idle', at(6)));
      expect(h.shots).toEqual([
        { type: 'started', shotId: null },
        { type: 'finished', shotId: null, stopReason: null },
      ]);
      expect(h.samples.map((s) => s.tS)).toEqual([0, 3, 4, 5]);
    });

    it('a shot that starts on a skipStep frame is still a shot', async () => {
      const h = harness();
      h.store.start();
      h.open();
      const machine = h.ws.latest(PATHS.machine);
      // No shotState channel at all (an older gateway): the machine state alone.
      machine.message(machineFrame('skipStep', 'pouring', at(0)));
      machine.message(machineFrame('espresso', 'pouring', at(1)));
      machine.message(machineFrame('idle', 'idle', at(2)));
      expect(h.shots).toEqual([
        { type: 'started', shotId: null },
        { type: 'finished', shotId: null, stopReason: null },
      ]);
      expect(h.samples.map((s) => s.tS)).toEqual([0, 1]);
    });

    it('a moment in espresso shorter than the wait starts nothing', async () => {
      const h = shotHarness();
      const machine = h.ws.latest(PATHS.machine);
      machine.message(machineFrame('espresso', 'preparingForShot', at(0)));
      await vi.advanceTimersByTimeAsync(1000);
      machine.message(machineFrame('idle', 'idle', at(1)));
      await vi.advanceTimersByTimeAsync(5000);
      machine.message(machineFrame('idle', 'idle', at(6)));
      expect(h.shots).toEqual([]);
      expect(h.samples).toEqual([]);
    });
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

// ---- time-to-ready.reaplugin (spec 6.3) ----------------------------------------------------

const TIME_TO_READY = '/ws/v1/plugins/time-to-ready.reaplugin/timeToReady';

/** A frame as the plugin emits it (plugin.js at aab5f93): its estimate, and the temperatures it came from. */
function readyFrame(status: string, remainingTimeMs: unknown, extra: Record<string, unknown> = {}) {
  return { status, remainingTimeMs, heatingRate: 0.2, message: 'Estimated 2m 30s remaining', currentTemp: 70, targetTemp: 92, timestamp: 1_791_000_000_000, ...extra };
}

describe('time-to-ready (6.3)', () => {
  it('opens the plugin channel only while watched, and closes it when unwatched, forgetting the estimate', () => {
    const h = harness();
    h.store.start();
    expect(h.ws.sockets.some((s) => s.path === TIME_TO_READY), 'not with the other six').toBe(false);
    expect(h.store.getState().timeToReady).toBeNull();

    h.store.watchTimeToReady(true);
    h.store.watchTimeToReady(true);
    expect(h.ws.live(TIME_TO_READY)).toHaveLength(1);
    expect(h.ws.latest(TIME_TO_READY).url).toBe(`ws://tablet.local:8080${TIME_TO_READY}`);
    // Not one of the channels whose sockets the machine alert watches.
    expect(Object.keys(h.store.getState().sockets)).not.toContain('timeToReady');

    h.ws.latest(TIME_TO_READY).open().message(readyFrame('heating', 150_000));
    expect(h.store.getState().timeToReady).toBe(150_000);

    h.store.watchTimeToReady(false);
    expect(h.ws.latest(TIME_TO_READY).closedByClient).toBe(true);
    expect(h.store.getState().timeToReady).toBeNull();
  });

  it('waits for start, closes with stop (forgetting the estimate), and opens again with the next start while still watched', () => {
    const h = harness();
    h.store.watchTimeToReady(true);
    expect(h.ws.sockets).toHaveLength(0);
    h.store.start();
    h.ws.latest(TIME_TO_READY).open().message(readyFrame('heating', 150_000));
    h.store.stop();
    expect(h.ws.sockets.every((s) => s.closedByClient)).toBe(true);
    expect(h.store.getState().timeToReady).toBeNull();
    h.store.start();
    expect(h.ws.live(TIME_TO_READY)).toHaveLength(1);
  });

  it("takes only the plugin's number: a heating frame sets it, any other frame keeps it, counted down from its deadline", async () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    const socket = h.ws.latest(TIME_TO_READY).open();
    const estimate = () => h.store.getState().timeToReady;

    socket.message(readyFrame('insufficient_data', null));
    socket.message(readyFrame('reached', 0));
    expect(estimate(), 'no estimate yet').toBeNull();
    socket.message(readyFrame('heating', 150_000));
    expect(estimate()).toBe(150_000);

    // The plugin's status moves with every snapshot: none of these is a number to use.
    await vi.advanceTimersByTimeAsync(1000);
    socket.message(readyFrame('not_heating', null));
    expect(estimate()).toBe(149_000);
    await vi.advanceTimersByTimeAsync(1000);
    socket.message(readyFrame('reached', 0));
    const { remainingTimeMs: _gone, ...withoutEstimate } = readyFrame('heating', 0);
    socket.message(withoutEstimate);
    socket.message(readyFrame('heating', '2 min'));
    socket.message(readyFrame('heating', null));
    expect(estimate()).toBe(148_000);

    socket.message(readyFrame('heating', 90_000));
    expect(estimate()).toBe(90_000);
    // Never more than five minutes: above that the plugin's estimate is noise.
    socket.message(readyFrame('heating', 1_200_000));
    expect(estimate()).toBe(300_000);
    expect(driftLog.list().map((entry) => entry.problem)).toEqual(['remainingTimeMs: missing', 'remainingTimeMs: expected number, got string']);
  });

  it('goes 6 s after the last frame of any kind: the socket has gone quiet', async () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    const socket = h.ws.latest(TIME_TO_READY).open();
    socket.message(readyFrame('heating', 150_000));
    // Every frame keeps it alive, numbers or not.
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(5000);
      socket.message(readyFrame('not_heating', null));
    }
    expect(h.store.getState().timeToReady).toBe(130_000);
    await vi.advanceTimersByTimeAsync(5999);
    expect(h.store.getState().timeToReady).toBe(130_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.store.getState().timeToReady).toBeNull();
  });

  it('holds at zero past its deadline while the machine heats on, and goes 10 s after it', async () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    const socket = h.ws.latest(TIME_TO_READY).open();
    socket.message(readyFrame('heating', 4000));
    // Frames keep coming every 2 s, so only the deadline can end it.
    const tick = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      socket.message(readyFrame('reached', 0));
    };
    await tick(2000);
    expect(h.store.getState().timeToReady).toBe(2000);
    await tick(2000);
    expect(h.store.getState().timeToReady, 'at the deadline').toBe(0);
    for (let i = 0; i < 5; i += 1) await tick(2000);
    expect(h.store.getState().timeToReady, '10 s past it').toBe(0);
    await tick(1);
    expect(h.store.getState().timeToReady).toBeNull();
  });

  it('reports a status it does not know without using it, and drops what it cannot read, reporting it', () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    const socket = h.ws.latest(TIME_TO_READY).open();
    socket.message(readyFrame('cooling', 60_000));
    expect(h.store.getState().timeToReady).toBeNull();
    const before = h.store.getState();
    for (const junk of ['{not json', '42', '[]', 'null', JSON.stringify({ remainingTimeMs: 5 })]) {
      expect(() => socket.message(junk)).not.toThrow();
    }
    expect(h.store.getState()).toBe(before);
    expect(driftLog.list().map((entry) => `${entry.source} ${entry.problem}`)).toEqual([
      'ws/v1/plugins/time-to-ready.reaplugin/timeToReady status: unknown value "cooling"',
      'ws/v1/plugins/time-to-ready.reaplugin/timeToReady frame: expected object, got number',
      'ws/v1/plugins/time-to-ready.reaplugin/timeToReady frame: expected object, got array',
      'ws/v1/plugins/time-to-ready.reaplugin/timeToReady frame: expected object, got null',
      'ws/v1/plugins/time-to-ready.reaplugin/timeToReady status: missing',
    ]);
  });

  it('a frame that says the same again changes nothing', () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    const socket = h.ws.latest(TIME_TO_READY).open();
    socket.message(readyFrame('heating', 60_000));
    const changes = h.changes();
    socket.message(readyFrame('heating', 60_000, { currentTemp: 71 }));
    socket.message(readyFrame('not_heating', null));
    expect(h.changes()).toBe(changes);
  });

  it('reconnects with backoff while watched, at once when the page comes back, and never once unwatched', async () => {
    const h = harness();
    h.store.start();
    h.store.watchTimeToReady(true);
    h.ws.latest(TIME_TO_READY).open().drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.ws.live(TIME_TO_READY)).toHaveLength(1);

    h.ws.latest(TIME_TO_READY).drop();
    h.visibility.fire();
    expect(h.ws.live(TIME_TO_READY)).toHaveLength(1);

    h.ws.latest(TIME_TO_READY).drop();
    h.store.watchTimeToReady(false);
    const opened = () => h.ws.sockets.filter((s) => s.path === TIME_TO_READY).length;
    const before = opened();
    await vi.advanceTimersByTimeAsync(60_000);
    h.visibility.fire();
    expect(opened()).toBe(before);
  });
});

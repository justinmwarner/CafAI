// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/live-connections.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, the verified frame types, and parsers for every channel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures, cremaFixtures } from '../../mock/fixtures/index.ts';
import { driftLog } from './drift.ts';
import { AT_REST_STATES, DO_NOT_INTERRUPT_STATES, RUNNING_STATES } from './machineStates.ts';
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

const drift = () => driftLog.list().map(({ source, problem }) => ({ source, problem }));
const problems = () => driftLog.list().map((entry) => entry.problem);

beforeEach(() => {
  driftLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('scale frames (ported)', () => {
  it('scale status frames are distinct from live weight frames', () => {
    expect(parseScaleFrame({ status: 'connected' })).toEqual({ kind: 'status', connected: true });
    expect(parseScaleFrame({ status: 'disconnected' })).toEqual({ kind: 'status', connected: false });
    expect(parseScaleFrame({ weight: 18.5, weightFlow: 2.1, battery: 84 })).toEqual({
      kind: 'snapshot',
      snapshot: { timestamp: '', weight: 18.5, weightFlow: 2.1, battery: 84, timerValue: null },
    });
    expect(parseScaleFrame({ weight: Number.NaN })).toBeNull();
    expect(parseScaleFrame({ nope: true })).toBeNull();
  });

  it('reads the verified weight frame unchanged', () => {
    const frame = fixtures.scaleSnapshotWs();
    expect(parseScaleFrame(frame)).toEqual({ kind: 'snapshot', snapshot: frame });
    expect(parseScaleFrame(cremaFixtures.scaleFrames().weight)).toMatchObject({ kind: 'snapshot' });
  });
});

describe('device connections (ported)', () => {
  it('device connection state is derived from connected hardware', () => {
    const connected = deviceConnections({
      devices: [
        { id: 'm1', name: 'DE1', type: 'machine', state: 'connected' },
        { id: 's1', name: 'Scale', type: 'scale', state: 'discovered' },
      ],
    });
    expect(connected).toEqual({ machine: true, scale: false });
    expect(deviceConnections({ devices: [] })).toEqual({ machine: false, scale: false });
    expect(deviceConnections({ devices: 'not an array' })).toBeNull();
  });

  it('an auxiliary (dosing) scale is not the brewing scale', () => {
    expect(
      deviceConnections({ devices: [{ id: 's2', name: 'Lunar', type: 'scale', state: 'connected', connectionRole: 'auxiliary' }] }),
    ).toEqual({ machine: false, scale: false });
  });

  it('a switched-off machine Decaid remembers is not connected', () => {
    expect(deviceConnections({ devices: cremaFixtures.switchedOffMachine() })).toEqual({ machine: false, scale: true });
  });
});

describe('tolerant parsers', () => {
  it('accept the verified example frames', () => {
    expect(parseMachineFrame(fixtures.machineSnapshotWs())).toEqual(fixtures.machineSnapshotWs());
    expect(parseDevicesFrame(fixtures.devicesWs())).toMatchObject({ scanning: false, connectionStatus: { phase: 'ready', error: null } });
    expect(parseShotStateFrame(fixtures.shotStateWs())).toEqual(fixtures.shotStateWs());
    expect(parseWaterLevelsFrame(fixtures.waterLevelsWs())).toEqual(fixtures.waterLevelsWs());
    expect(parseShotSettingsFrame(fixtures.shotSettings())).toEqual(fixtures.shotSettings());
  });

  it('reject malformed frames instead of throwing', () => {
    const junk: unknown[] = [null, undefined, 42, 'text', [], {}, { state: 'idle' }, { timestamp: '2026-10-03T08:15:02.725113', state: { substate: 'idle' } }];
    for (const value of junk) {
      expect(parseMachineFrame(value)).toBeNull();
      expect(parseDevicesFrame(value)).toBeNull();
      expect(parseShotStateFrame(value)).toBeNull();
      expect(parseWaterLevelsFrame(value)).toBeNull();
      expect(parseShotSettingsFrame(value)).toBeNull();
      expect(parseScaleFrame(value)).toBeNull();
    }
  });

  it('keep a usable frame whose reading is missing: the reading is null, never 0 (5.8)', () => {
    const frame = { ...fixtures.machineSnapshotWs() } as Record<string, unknown>;
    delete frame.steamTemperature;
    expect(parseMachineFrame(frame)?.steamTemperature).toBeNull();
    expect(parseMachineFrame({ ...frame, state: { state: 'espresso' } })?.state).toEqual({ state: 'espresso', substate: '' });
  });

  it('keep an unknown shot state or device kind (enums are open)', () => {
    expect(parseShotStateFrame({ ...fixtures.shotStateWs(), state: 'warming' })?.state).toBe('warming');
    const devices = fixtures.devicesWs();
    devices.devices.push({ name: 'Grinder', id: 'g1', state: 'connected', type: 'grinder', available: true });
    expect(parseDevicesFrame(devices)?.devices).toHaveLength(3);
  });

  it('a devices frame without connectionStatus still yields a usable state', () => {
    expect(parseDevicesFrame({ devices: [], scanning: false })).toMatchObject({
      devices: [],
      connectionStatus: { phase: 'idle', error: null, foundMachines: [], foundScales: [], pendingAmbiguity: null },
    });
  });
});

describe('what a frame lacks is drift (D95)', () => {
  it('a frame without groupTemperature gives null and one drift entry, however often it comes', () => {
    const { groupTemperature: _group, ...frame } = fixtures.machineSnapshotWs();
    for (let i = 0; i < 3; i += 1) expect(parseMachineFrame(frame)?.groupTemperature).toBeNull();
    expect(drift()).toEqual([{ source: 'ws/v1/machine/snapshot', problem: 'groupTemperature: missing' }]);
    expect(driftLog.list()[0]!.count).toBe(3);
  });

  it('a reading of another type is null too, and says what came', () => {
    const frame = { ...fixtures.machineSnapshotWs(), pressure: '9.0', flow: null };
    expect(parseMachineFrame(frame)).toMatchObject({ pressure: null, flow: null, groupTemperature: frame.groupTemperature });
    expect(drift()).toEqual([
      { source: 'ws/v1/machine/snapshot', problem: 'flow: expected number, got null' },
      { source: 'ws/v1/machine/snapshot', problem: 'pressure: expected number, got string' },
    ]);
  });

  it('a verified frame reports nothing', () => {
    parseMachineFrame(fixtures.machineSnapshotWs());
    parseMachineFrame(fixtures.machineState());
    parseShotStateFrame(fixtures.shotStateWs());
    expect(drift()).toEqual([]);
  });

  it('a machine state CafAI does not know is kept, and reported (D97)', () => {
    expect(parseMachineFrame({ ...fixtures.machineSnapshotWs(), state: { state: 'brewing', substate: 'pouring' } })?.state.state).toBe('brewing');
    // Every state machineStates.ts sorts is known (machineStates.test.ts checks that list against Decaid's).
    for (const state of [...RUNNING_STATES, ...AT_REST_STATES, ...DO_NOT_INTERRUPT_STATES]) {
      parseMachineFrame({ ...fixtures.machineSnapshotWs(), state: { state, substate: 'idle' } });
    }
    expect(drift()).toEqual([{ source: 'ws/v1/machine/snapshot', problem: 'state: unknown value "brewing"' }]);
  });

  it("knows every state Decaid's ShotState has", () => {
    expect([...KNOWN_SHOT_STATES].sort()).toEqual(['finished', 'idle', 'pouring', 'preheating', 'stopping']);
  });

  it('a machine frame without a state CafAI can read is dropped and reported', () => {
    expect(parseMachineFrame({ ...fixtures.machineSnapshotWs(), state: 'idle' })).toBeNull();
    expect(parseMachineFrame({ ...fixtures.machineSnapshotWs(), state: { substate: 'idle' } })).toBeNull();
    expect(drift()).toEqual([
      { source: 'ws/v1/machine/snapshot', problem: 'state: expected object, got string' },
      { source: 'ws/v1/machine/snapshot', problem: 'state.state: missing' },
    ]);
  });

  it('a timestamp CafAI cannot read is reported, and the frame keeps its state and readings at the time it arrived', () => {
    const arrived = new Date(2026, 9, 10, 8, 0, 1, 500);
    const sent = fixtures.machineSnapshotWs();
    const espresso = { ...sent, state: { state: 'espresso', substate: 'pouring' } };
    for (const timestamp of [1727600034216, undefined, 'yesterday']) {
      const frame = parseMachineFrame({ ...espresso, timestamp }, 'ws/v1/machine/snapshot', () => arrived);
      // The controls go by the state: Stop stays during a shot.
      expect(frame?.state).toEqual({ state: 'espresso', substate: 'pouring' });
      expect(frame?.pressure).toBe(sent.pressure);
      expect(frame?.timestamp).toBe('2026-10-10T08:00:01.500000');
    }
    expect(problems()).toEqual(['timestamp: expected string, got number', 'timestamp: missing', 'timestamp: not a time']);
  });

  it('names the route it was given, for the REST seed', () => {
    const { flow: _flow, ...frame } = fixtures.machineState();
    expect(parseMachineFrame(frame, 'GET /api/v1/machine/state')?.flow).toBeNull();
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'flow: missing' }]);
  });

  it('a renamed shot state is kept and reported (5.9)', () => {
    for (const state of ['brewing', 'brewing', 'done']) parseShotStateFrame({ ...fixtures.shotStateWs(), state });
    for (const state of KNOWN_SHOT_STATES) parseShotStateFrame({ ...fixtures.shotStateWs(), state });
    expect(drift()).toEqual([
      { source: 'ws/v1/machine/shotState', problem: 'state: unknown value "brewing"' },
      { source: 'ws/v1/machine/shotState', problem: 'state: unknown value "done"' },
    ]);
  });
});

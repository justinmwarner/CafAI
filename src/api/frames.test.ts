// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/live-connections.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, the verified frame types, and parsers for every channel.
import { describe, expect, it } from 'vitest';
import { fixtures, cremaFixtures } from '../../mock/fixtures/index.ts';
import {
  deviceConnections,
  parseDevicesFrame,
  parseMachineFrame,
  parseScaleFrame,
  parseShotSettingsFrame,
  parseShotStateFrame,
  parseWaterLevelsFrame,
} from './frames.ts';

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
    const junk: unknown[] = [null, undefined, 42, 'text', [], {}, { state: 'idle' }, { timestamp: 5, state: { state: 'idle' } }];
    for (const value of junk) {
      expect(parseMachineFrame(value)).toBeNull();
      expect(parseDevicesFrame(value)).toBeNull();
      expect(parseShotStateFrame(value)).toBeNull();
      expect(parseWaterLevelsFrame(value)).toBeNull();
      expect(parseShotSettingsFrame(value)).toBeNull();
      expect(parseScaleFrame(value)).toBeNull();
    }
  });

  it('fill a missing machine field with 0 rather than dropping a usable frame', () => {
    const frame = { ...fixtures.machineSnapshotWs() } as Record<string, unknown>;
    delete frame.steamTemperature;
    expect(parseMachineFrame(frame)?.steamTemperature).toBe(0);
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

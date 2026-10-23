import { describe, expect, it } from 'vitest';
import type { TelemetryState } from '../../api/types.ts';
import { IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import {
  confirmedAsleep,
  dimTo,
  msUntilWanted,
  SAVER_BRIGHTNESS,
  SAVER_IDLE_MS,
  SAVER_SETTLE_MS,
  SAVER_SHOW_MS,
  saverWanted,
  type SaverInputs,
} from './policy.ts';

function telemetry(state: string | null, patch: Partial<TelemetryState> = {}): TelemetryState {
  const machine = state === null ? null : { ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } };
  return { ...IDLE_TELEMETRY, machineConnected: true, unreachable: false, machine, ...patch } as TelemetryState;
}

const UP: SaverInputs = { on: true, insideDecaid: true, asleep: true, untouchedMs: SAVER_IDLE_MS, asleepMs: SAVER_IDLE_MS };

describe('the numbers', () => {
  it('a minute untouched, 30 minutes shown, dimmed to 30, asleep 3 s without a break', () => {
    expect(SAVER_IDLE_MS).toBe(60_000);
    expect(SAVER_SHOW_MS).toBe(1_800_000);
    expect(SAVER_BRIGHTNESS).toBe(30);
    expect(SAVER_SETTLE_MS).toBe(3_000);
  });
});

describe('confirmedAsleep (spec 3, Asleep)', () => {
  it('is the machine connected, Decaid reachable and sleeping in its frames', () => {
    expect(confirmedAsleep(telemetry('sleeping'))).toBe(true);
  });

  it.each([
    ['awake', telemetry('idle')],
    ['heating', telemetry('heating')],
    ['in a shot', telemetry('espresso')],
    ['no frame yet', telemetry(null)],
    ['not connected (off, or never paired)', telemetry('sleeping', { machineConnected: false })],
    ["Decaid out of reach: its last word is no news", telemetry('sleeping', { unreachable: true })],
  ])('is not, %s', (_name, state) => {
    expect(confirmedAsleep(state)).toBe(false);
  });
});

describe('saverWanted (spec 3)', () => {
  it('Up: on, inside Decaid, confirmed asleep and a minute untouched', () => {
    expect(saverWanted(UP)).toBe(true);
    expect(saverWanted({ ...UP, untouchedMs: 3_600_000 })).toBe(true);
  });

  it('both sides of the minute', () => {
    expect(saverWanted({ ...UP, untouchedMs: SAVER_IDLE_MS - 1 })).toBe(false);
    expect(saverWanted({ ...UP, untouchedMs: SAVER_IDLE_MS })).toBe(true);
  });

  it('Where: never outside Decaid, on a phone or a computer', () => {
    expect(saverWanted({ ...UP, insideDecaid: false, untouchedMs: 3_600_000 })).toBe(false);
  });

  it('Down by itself: the machine anything but confirmed asleep, or the screensaver turned off', () => {
    expect(saverWanted({ ...UP, asleep: false })).toBe(false);
    expect(saverWanted({ ...UP, on: false })).toBe(false);
  });

  it('Again: a tap is a touch, so it comes back only after another minute untouched', () => {
    expect(saverWanted({ ...UP, untouchedMs: 0 })).toBe(false);
    expect(saverWanted({ ...UP, untouchedMs: 30_000 })).toBe(false);
    expect(saverWanted({ ...UP, untouchedMs: 60_000 })).toBe(true);
  });

  it('reads a broken count as just touched', () => {
    expect(saverWanted({ ...UP, untouchedMs: Number.NaN })).toBe(false);
  });

  it('waits for Decaid to have said asleep 3 s without a break: a frame left from before a dropped link says it until a fresh one comes', () => {
    expect(saverWanted({ ...UP, untouchedMs: 3_600_000, asleepMs: 0 })).toBe(false);
    expect(saverWanted({ ...UP, untouchedMs: 3_600_000, asleepMs: SAVER_SETTLE_MS - 1 })).toBe(false);
    expect(saverWanted({ ...UP, untouchedMs: 3_600_000, asleepMs: SAVER_SETTLE_MS })).toBe(true);
    expect(saverWanted({ ...UP, untouchedMs: 3_600_000, asleepMs: Number.NaN })).toBe(false);
  });
});

describe('msUntilWanted', () => {
  it('counts down the minute while asleep, and is nothing when time alone cannot bring it', () => {
    expect(msUntilWanted({ ...UP, untouchedMs: 15_000 })).toBe(45_000);
    expect(msUntilWanted(UP)).toBe(0);
    expect(msUntilWanted({ ...UP, untouchedMs: 90_000 })).toBe(0);
    expect(msUntilWanted({ ...UP, asleep: false })).toBeNull();
    expect(msUntilWanted({ ...UP, on: false })).toBeNull();
    expect(msUntilWanted({ ...UP, insideDecaid: false })).toBeNull();
  });

  it('counts down whichever is longer, the minute untouched or the 3 s asleep', () => {
    expect(msUntilWanted({ ...UP, untouchedMs: 3_600_000, asleepMs: 1_000 })).toBe(2_000);
    expect(msUntilWanted({ ...UP, untouchedMs: 59_000, asleepMs: 1_000 })).toBe(2_000);
    expect(msUntilWanted({ ...UP, untouchedMs: 50_000, asleepMs: 1_000 })).toBe(10_000);
  });
});

describe('dimTo (spec 4, It comes up)', () => {
  it('dims to 30, or leaves a lower brightness where it is', () => {
    expect(dimTo(100)).toBe(30);
    expect(dimTo(31)).toBe(30);
    expect(dimTo(30)).toBe(30);
    expect(dimTo(12)).toBe(12);
    expect(dimTo(0)).toBe(0);
  });

  it('reads a value Decaid should never send as 30, within 0 to 100', () => {
    expect(dimTo(Number.NaN)).toBe(30);
    expect(dimTo(-5)).toBe(0);
    expect(dimTo(12.4)).toBe(12);
  });
});

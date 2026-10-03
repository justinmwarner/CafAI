import { describe, expect, it } from 'vitest';
import { isRunningMachineState, machineControls, type MachineControlInput } from './commands.ts';

const idle: MachineControlInput = {
  connected: true,
  state: 'idle',
  scaleConnected: true,
  hasGhc: false,
  pending: null,
};

describe('isRunningMachineState', () => {
  it('knows what Stop can end', () => {
    for (const state of ['espresso', 'steam', 'hotWater', 'flush', 'steamRinse', 'skipStep', 'cleaning', 'descaling', 'airPurge']) {
      expect(isRunningMachineState(state)).toBe(true);
    }
    for (const state of ['idle', 'sleeping', 'heating', 'needsWater', 'error', 'booting', 'whatever', null, undefined]) {
      expect(isRunningMachineState(state)).toBe(false);
    }
  });
});

describe('machineControls', () => {
  it('lets an idle machine start anything, and Stop has nothing to stop', () => {
    const model = machineControls(idle);
    expect(model.startsVisible).toBe(true);
    expect(model.startsEnabled).toBe(true);
    expect(model.startReason).toBeNull();
    expect(model.running).toBe(false);
    expect(model.stopEnabled).toBe(false);
    expect(model.stopProminent).toBe(false);
    expect(model.sleepWake).toEqual({ command: 'sleeping', label: 'Sleep', enabled: true });
    expect(model.tareEnabled).toBe(true);
  });

  it('commands nothing without a connected machine, and says why', () => {
    const model = machineControls({ ...idle, connected: false, state: null });
    expect(model.startsEnabled).toBe(false);
    expect(model.startReason).toMatch(/not connected/i);
    expect(model.startReason).toMatch(/wake the DE1/i);
    expect(model.stopEnabled).toBe(false);
    expect(model.sleepWake.enabled).toBe(false);
  });

  it('ignores a stale frame once the link is down', () => {
    const model = machineControls({ ...idle, connected: false, state: 'espresso' });
    expect(model.running).toBe(false);
    expect(model.stopEnabled).toBe(false);
    expect(model.startsEnabled).toBe(false);
  });

  it('will not brew on a sleeping machine, and offers Wake', () => {
    const model = machineControls({ ...idle, state: 'sleeping' });
    expect(model.startsEnabled).toBe(false);
    expect(model.startReason).toMatch(/asleep/i);
    expect(model.sleepWake).toEqual({ command: 'idle', label: 'Wake', enabled: true });
  });

  it('while something runs, Stop is prominent and the other starts are disabled', () => {
    for (const state of ['espresso', 'steam', 'hotWater', 'flush']) {
      const model = machineControls({ ...idle, state });
      expect(model.running).toBe(true);
      expect(model.stopEnabled).toBe(true);
      expect(model.stopProminent).toBe(true);
      expect(model.startsEnabled).toBe(false);
      // Sleeping mid-shot is never what anyone meant.
      expect(model.sleepWake.enabled).toBe(false);
    }
  });

  it('never blocks Stop behind a command in flight', () => {
    const model = machineControls({ ...idle, state: 'espresso', pending: 'espresso' });
    expect(model.stopEnabled).toBe(true);
  });

  it('a command in flight disables the starts rather than queueing presses', () => {
    const model = machineControls({ ...idle, pending: 'steam' });
    expect(model.startsEnabled).toBe(false);
    expect(model.sleepWake.enabled).toBe(false);
    expect(model.tareEnabled).toBe(false);
  });

  it('a GHC machine starts from its own buttons but keeps Stop and Sleep here', () => {
    const atRest = machineControls({ ...idle, hasGhc: true });
    expect(atRest.startsVisible).toBe(false);
    expect(atRest.startReason).toBe('Start on the machine');
    expect(atRest.sleepWake.enabled).toBe(true);

    const pulling = machineControls({ ...idle, hasGhc: true, state: 'espresso' });
    expect(pulling.startsVisible).toBe(false);
    expect(pulling.stopEnabled).toBe(true);
    expect(pulling.stopProminent).toBe(true);
  });

  it('treats an unknown GHC answer as no GHC', () => {
    expect(machineControls({ ...idle, hasGhc: null }).startsVisible).toBe(true);
  });

  it('cannot tare without a scale, and says why', () => {
    const model = machineControls({ ...idle, scaleConnected: false });
    expect(model.tareEnabled).toBe(false);
    expect(model.tareReason).toMatch(/connect a scale/i);
    // The scale is reached through Decaid, so it does not need the machine.
    expect(machineControls({ ...idle, connected: false, state: null }).tareEnabled).toBe(true);
  });

  it('explains the other states that block a start', () => {
    expect(machineControls({ ...idle, state: 'needsWater' }).startReason).toMatch(/refill/i);
    expect(machineControls({ ...idle, state: 'error' }).startReason).toMatch(/error/i);
    expect(machineControls({ ...idle, state: 'booting' }).startReason).toMatch(/busy/i);
    expect(machineControls({ ...idle, state: 'someFutureState' }).startsEnabled).toBe(false);
    expect(machineControls({ ...idle, state: null }).startReason).toMatch(/waiting/i);
  });

  it('lets a heating machine start; the machine waits for temperature itself', () => {
    expect(machineControls({ ...idle, state: 'heating' }).startsEnabled).toBe(true);
    expect(machineControls({ ...idle, state: 'schedIdle' }).startsEnabled).toBe(true);
  });
});

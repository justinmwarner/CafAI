import { describe, expect, it } from 'vitest';
import { machineControls, type MachineControlInput } from './commands.ts';

// Which state is which (running, at rest, not to interrupt) is tested with
// the list itself, in src/api/machineStates.test.ts.

const idle: MachineControlInput = {
  connected: true,
  unreachable: false,
  state: 'idle',
  scaleConnected: true,
  hasGhc: false,
  pending: null,
};

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

  it('holds every command but Stop while Decaid is out of reach, whatever the machine was, and says why', () => {
    // The last word from Decaid: a connected machine at rest, a scale.
    const model = machineControls({ ...idle, unreachable: true });
    expect(model.startsVisible).toBe(true);
    expect(model.startsEnabled).toBe(false);
    expect(model.startReason).toBe("Can't reach Decaid.");
    expect(model.sleepWake).toEqual({ command: 'sleeping', label: 'Sleep', enabled: false });
    expect(model.tareEnabled).toBe(false);
    expect(model.tareReason).toBe("Can't reach Decaid.");
    expect(machineControls({ ...idle, unreachable: true, state: 'sleeping' }).sleepWake).toEqual({ command: 'idle', label: 'Wake', enabled: false });
    // Back in reach, all of it again.
    expect(machineControls({ ...idle, unreachable: false }).startsEnabled).toBe(true);
  });

  it('keeps Stop where it was, live, while Decaid is out of reach (D90, D97): its REST may still answer', () => {
    for (const state of ['espresso', 'steam', 'brewing']) {
      const model = machineControls({ ...idle, unreachable: true, state });
      expect(model.running, state).toBe(true);
      expect(model.stopEnabled, state).toBe(true);
      expect(model.stopProminent, state).toBe(true);
      expect(model.startsEnabled, state).toBe(false);
    }
    const ghc = machineControls({ ...idle, unreachable: true, hasGhc: true, state: 'espresso' });
    expect(ghc.stopEnabled).toBe(true);
    // A group-head machine still starts from its own buttons.
    expect(machineControls({ ...idle, unreachable: true, hasGhc: true }).startReason).toBe('Start on the machine');
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

  it('offers Stop in a state it does not know, and nothing else (D97)', () => {
    const model = machineControls({ ...idle, state: 'brewing' });
    expect(model.running).toBe(true);
    expect(model.stopEnabled).toBe(true);
    expect(model.stopProminent).toBe(true);
    expect(model.startsEnabled).toBe(false);
    expect(model.startReason).toMatch(/busy/i);
    expect(model.sleepWake.enabled).toBe(false);
    // Not without a machine.
    expect(machineControls({ ...idle, connected: false, state: 'brewing' }).stopEnabled).toBe(false);
  });

  it('never interrupts a firmware upgrade, a calibration or a self test: no Stop, no Sleep', () => {
    for (const state of ['fwUpgrade', 'calibration', 'selfTest']) {
      const model = machineControls({ ...idle, state });
      expect(model.running, state).toBe(false);
      expect(model.stopEnabled, state).toBe(false);
      expect(model.startsEnabled, state).toBe(false);
      expect(model.sleepWake.enabled, state).toBe(false);
    }
  });
});

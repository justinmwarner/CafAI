import { describe, expect, it } from 'vitest';
import {
  AT_REST_STATES,
  DO_NOT_INTERRUPT_STATES,
  isKnownMachineState,
  isRunningMachineState,
  isShotMachineState,
  isStoppableMachineState,
  RUNNING_STATES,
} from './machineStates.ts';

describe('machine states', () => {
  it("sorts every state Decaid's MachineState has, each once", () => {
    const sorted = [...RUNNING_STATES, ...AT_REST_STATES, ...DO_NOT_INTERRUPT_STATES];
    expect(sorted.sort()).toEqual(
      [
        'booting', 'busy', 'idle', 'schedIdle', 'sleeping', 'heating', 'preheating', 'espresso', 'hotWater', 'flush', 'steam',
        'steamRinse', 'skipStep', 'cleaning', 'descaling', 'calibration', 'selfTest', 'airPurge', 'needsWater', 'error', 'fwUpgrade',
      ].sort(),
    );
    for (const state of sorted) expect(isKnownMachineState(state), state).toBe(true);
    expect(isKnownMachineState('brewing')).toBe(false);
  });

  it('knows what Stop can end', () => {
    for (const state of ['espresso', 'steam', 'hotWater', 'flush', 'steamRinse', 'skipStep', 'cleaning', 'descaling', 'airPurge']) {
      expect(isRunningMachineState(state)).toBe(true);
    }
    for (const state of ['idle', 'sleeping', 'heating', 'needsWater', 'error', 'booting', 'whatever', null, undefined]) {
      expect(isRunningMachineState(state)).toBe(false);
    }
  });

  it('a shot is espresso, and skipStep while it moves to its next step', () => {
    expect(isShotMachineState('espresso')).toBe(true);
    expect(isShotMachineState('skipStep')).toBe(true);
    for (const state of ['idle', 'steam', 'brewing', null, undefined]) expect(isShotMachineState(state)).toBe(false);
  });
});

describe('isStoppableMachineState (D97)', () => {
  it('Stop for the known running states', () => {
    for (const state of RUNNING_STATES) expect(isStoppableMachineState(state), state).toBe(true);
  });

  it('Stop for a state CafAI does not know: whatever it is doing may need stopping', () => {
    expect(isStoppableMachineState('brewing')).toBe(true);
    expect(isStoppableMachineState('someFutureState')).toBe(true);
  });

  it('no Stop at rest, and never during a firmware upgrade, a calibration or a self test', () => {
    for (const state of ['idle', 'schedIdle', 'sleeping', 'heating', 'preheating', 'booting', 'busy', 'needsWater', 'error']) {
      expect(isStoppableMachineState(state), state).toBe(false);
    }
    for (const state of ['fwUpgrade', 'calibration', 'selfTest']) expect(isStoppableMachineState(state), state).toBe(false);
    for (const state of [null, undefined, '']) expect(isStoppableMachineState(state)).toBe(false);
  });
});

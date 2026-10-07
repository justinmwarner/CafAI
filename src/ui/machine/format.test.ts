import { describe, expect, it } from 'vitest';
import {
  describeMachineState,
  formatSeconds,
  formatTemperature,
  formatWaterLevel,
  formatWeight,
  isWaterLow,
  splitUnit,
} from './format.ts';

describe('describeMachineState', () => {
  it('says "Not connected" whenever the machine link is down, whatever the last frame said', () => {
    expect(describeMachineState('idle', 'idle', false)).toBe('Not connected');
    expect(describeMachineState('espresso', 'pouring', false)).toBe('Not connected');
    expect(describeMachineState(null, null, false)).toBe('Not connected');
  });

  it('names the everyday states in plain words', () => {
    expect(describeMachineState('idle', 'idle', true)).toBe('Ready');
    expect(describeMachineState('schedIdle', 'idle', true)).toBe('Ready');
    expect(describeMachineState('sleeping', 'idle', true)).toBe('Sleeping');
    expect(describeMachineState('heating', 'idle', true)).toBe('Heating');
    expect(describeMachineState('preheating', 'idle', true)).toBe('Heating');
    expect(describeMachineState('steam', 'pouring', true)).toBe('Steaming');
    expect(describeMachineState('flush', 'pouring', true)).toBe('Flushing');
    expect(describeMachineState('hotWater', 'pouring', true)).toBe('Hot water');
    expect(describeMachineState('needsWater', 'idle', true)).toBe('Needs water');
    expect(describeMachineState('error', 'errorGeneric', true)).toBe('Error');
  });

  it('names the shot phase', () => {
    expect(describeMachineState('espresso', 'preparingForShot', true)).toBe('Pulling a shot: preheating');
    expect(describeMachineState('espresso', 'preinfusion', true)).toBe('Pulling a shot: preinfusion');
    expect(describeMachineState('espresso', 'pouring', true)).toBe('Pulling a shot: pouring');
    expect(describeMachineState('espresso', 'pouringDone', true)).toBe('Pulling a shot: ending');
    expect(describeMachineState('espresso', 'somethingNew', true)).toBe('Pulling a shot');
    expect(describeMachineState('espresso', null, true)).toBe('Pulling a shot');
  });

  it("names the profile's running step during preinfusion and the pour", () => {
    // Blooming Espresso's bloom: the pump is off for 30 s, but the substate says pouring.
    expect(describeMachineState('espresso', 'pouring', true, 'pause')).toBe('Pulling a shot: pause');
    expect(describeMachineState('espresso', 'preinfusion', true, 'Fill')).toBe('Pulling a shot: Fill');
    expect(describeMachineState('skipStep', 'pouring', true, 'ramp')).toBe('Pulling a shot: ramp');
    // Preheat shows the last shot's step, and the end is no step.
    expect(describeMachineState('espresso', 'preparingForShot', true, 'pause')).toBe('Pulling a shot: preheating');
    expect(describeMachineState('espresso', 'pouringDone', true, 'pause')).toBe('Pulling a shot: ending');
    // No usable name: the phase, as before.
    expect(describeMachineState('espresso', 'pouring', true, '  ')).toBe('Pulling a shot: pouring');
    expect(describeMachineState('espresso', 'pouring', true, null)).toBe('Pulling a shot: pouring');
    expect(describeMachineState('steam', 'pouring', true, 'pause')).toBe('Steaming');
    expect(describeMachineState('espresso', 'pouring', false, 'pause')).toBe('Not connected');
  });

  it('covers the maintenance states', () => {
    expect(describeMachineState('booting', 'idle', true)).toBe('Starting up');
    expect(describeMachineState('cleaning', 'cleaningGroup', true)).toBe('Cleaning');
    expect(describeMachineState('descaling', 'idle', true)).toBe('Descaling');
    expect(describeMachineState('fwUpgrade', 'idle', true)).toBe('Updating firmware');
  });

  it('never crashes on a state it has not heard of', () => {
    expect(describeMachineState('someFutureState', 'idle', true)).toBe('Some future state');
    expect(describeMachineState('', '', true)).toBe('Connected');
    expect(describeMachineState(null, null, true)).toBe('Connected');
  });
});

describe('readouts', () => {
  it('formats temperatures', () => {
    expect(formatTemperature(92.44)).toBe('92.4 °C');
    expect(formatTemperature(140, 0)).toBe('140 °C');
    expect(formatTemperature(null)).toBe('—');
    expect(formatTemperature(Number.NaN)).toBe('—');
  });

  it('formats weight without a minus sign on a resting scale', () => {
    expect(formatWeight(18.44)).toBe('18.4 g');
    expect(formatWeight(-0.04)).toBe('0.0 g');
    expect(formatWeight(-0.3)).toBe('-0.3 g');
    expect(formatWeight(undefined)).toBe('—');
  });

  it('formats the water tank level', () => {
    expect(formatWaterLevel({ currentLevel: 40.4, refillLevel: 5 })).toBe('40 mm');
    expect(formatWaterLevel(null)).toBe('—');
    expect(isWaterLow({ currentLevel: 5, refillLevel: 5 })).toBe(true);
    expect(isWaterLow({ currentLevel: 4, refillLevel: 5 })).toBe(true);
    expect(isWaterLow({ currentLevel: 6, refillLevel: 5 })).toBe(false);
    expect(isWaterLow(null)).toBe(false);
  });

  it('formats seconds for the shot timer', () => {
    expect(formatSeconds(27.44)).toBe('27.4 s');
    expect(formatSeconds(0)).toBe('0.0 s');
    expect(formatSeconds(null)).toBe('0.0 s');
    expect(formatSeconds(-1)).toBe('0.0 s');
  });
});

describe('splitUnit', () => {
  it('splits a readout into its number and unit', () => {
    expect(splitUnit('97.7 °C')).toEqual({ value: '97.7', unit: '°C' });
    expect(splitUnit('31 mm')).toEqual({ value: '31', unit: 'mm' });
    expect(splitUnit('0.0 g')).toEqual({ value: '0.0', unit: 'g' });
    expect(splitUnit('-1.5 g')).toEqual({ value: '-1.5', unit: 'g' });
  });

  it('leaves a dash or words whole', () => {
    expect(splitUnit('—')).toEqual({ value: '—', unit: null });
    expect(splitUnit('No scale')).toEqual({ value: 'No scale', unit: null });
  });
});

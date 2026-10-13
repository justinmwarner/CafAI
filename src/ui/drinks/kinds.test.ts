import { describe, expect, it } from 'vitest';
import { DRINK_KINDS, drinkOfState } from './kinds.ts';

describe('drinkOfState', () => {
  it('maps each drink state to its drink, steamRinse to steam', () => {
    expect(drinkOfState('steam')).toBe('steam');
    expect(drinkOfState('steamRinse')).toBe('steam');
    expect(drinkOfState('hotWater')).toBe('hotWater');
    expect(drinkOfState('flush')).toBe('flush');
  });

  it('is null for a shot, a cycle, rest and nothing', () => {
    for (const state of ['espresso', 'skipStep', 'airPurge', 'cleaning', 'descaling', 'idle', 'sleeping', 'heating', 'someNewState', '', null, undefined]) {
      expect(drinkOfState(state), String(state)).toBeNull();
    }
  });

  it('lists the drinks in the machine row order', () => {
    expect(DRINK_KINDS).toEqual(['steam', 'flush', 'hotWater']);
  });
});

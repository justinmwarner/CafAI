import { describe, expect, it } from 'vitest';
import { screenOf } from './screens.ts';

describe('screenOf (D213)', () => {
  it("names every route, and never a bag's id", () => {
    expect(screenOf({ name: 'coach' })).toBe('coach');
    expect(screenOf({ name: 'shot' })).toBe('shot');
    expect(screenOf({ name: 'history' })).toBe('history');
    expect(screenOf({ name: 'history', bagId: 'bag-123' })).toBe('history-bag');
    expect(screenOf({ name: 'settings' })).toBe('settings');
    expect(screenOf({ name: 'settings', group: 'coach' })).toBe('settings-coach');
    expect(screenOf({ name: 'settings', group: 'data' })).toBe('settings-data');
    expect(screenOf({ name: 'care', routine: 'weekly' })).toBe('care');
    expect(screenOf({ name: 'drink', drink: 'steam' })).toBe('steam');
    expect(screenOf({ name: 'drink', drink: 'hotWater' })).toBe('hot-water');
    expect(screenOf({ name: 'drink', drink: 'flush' })).toBe('flush');
  });
});

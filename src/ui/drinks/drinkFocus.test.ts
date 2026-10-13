import { describe, expect, it } from 'vitest';
import { drinkStarted, goBackLabel, goBackRoute, NO_ORIGIN } from './drinkFocus.ts';

describe('drinkStarted', () => {
  it("switches to the drink's view and remembers the screen it took over", () => {
    expect(drinkStarted(NO_ORIGIN, { kind: 'steam', typing: false, shown: { name: 'settings' } })).toEqual({
      state: { origin: { name: 'settings' } },
      go: { name: 'drink', drink: 'steam' },
    });
  });

  it('stays while the barista types, and when the view is already there', () => {
    const origin = { origin: { name: 'coach' as const } };
    expect(drinkStarted(origin, { kind: 'flush', typing: true, shown: { name: 'history' } })).toEqual({ state: origin, go: null });
    expect(drinkStarted(origin, { kind: 'flush', typing: false, shown: { name: 'drink', drink: 'flush' } })).toEqual({ state: origin, go: null });
  });

  it("from one drink's view to another's, keeps the screen the first took over", () => {
    const origin = { origin: { name: 'history' as const, bagId: 'b1' } };
    const step = drinkStarted(origin, { kind: 'hotWater', typing: false, shown: { name: 'drink', drink: 'steam' } });
    expect(step).toEqual({ state: origin, go: { name: 'drink', drink: 'hotWater' } });
    expect(step.state).toBe(origin);
  });
});

describe('Go back', () => {
  it('goes to the screen taken over, or the coach', () => {
    expect(goBackRoute(NO_ORIGIN)).toEqual({ name: 'coach' });
    expect(goBackRoute({ origin: { name: 'shot' } })).toEqual({ name: 'shot' });
  });

  it('says where to a screen reader', () => {
    expect(goBackLabel({ name: 'coach' })).toBe('Go back to the coach');
    expect(goBackLabel({ name: 'shot' })).toBe('Go back to the shot');
    expect(goBackLabel({ name: 'history' })).toBe('Go back to History');
    expect(goBackLabel({ name: 'settings' })).toBe('Go back to Settings');
  });
});

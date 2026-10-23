import { describe, expect, it } from 'vitest';
import { drinkReturn, IDLE_RETURN, secondsLeft, type ReturnState } from './drinkReturn.ts';

/** Run 4 ended at 1 s on the clock; going back by itself is on, after 10 s. */
const ended = { type: 'ended', runId: 4, lost: false, goBack: true, seconds: 10, now: 1000 } as const;
const counting: ReturnState = { kind: 'counting', runId: 4, until: 11_000, seconds: 10 };
const kept: ReturnState = { kind: 'kept', runId: 4 };

describe('drinkReturn', () => {
  it('counts down from the end of a run the view saw live, for the seconds set', () => {
    expect(drinkReturn(IDLE_RETURN, ended)).toEqual({ state: counting, goBack: false });
    expect(drinkReturn(IDLE_RETURN, { ...ended, seconds: 25 }).state).toEqual({ kind: 'counting', runId: 4, until: 26_000, seconds: 25 });
  });

  it('does not count with going back by itself off, nor after the connection was lost', () => {
    expect(drinkReturn(IDLE_RETURN, { ...ended, goBack: false })).toEqual({ state: IDLE_RETURN, goBack: false });
    expect(drinkReturn(IDLE_RETURN, { ...ended, lost: true })).toEqual({ state: IDLE_RETURN, goBack: false });
  });

  it('counts afresh for the next run, whatever became of the last', () => {
    const next = { ...ended, runId: 5, now: 30_000 };
    expect(drinkReturn(kept, next).state).toEqual({ kind: 'counting', runId: 5, until: 40_000, seconds: 10 });
    expect(drinkReturn(counting, next).state).toEqual({ kind: 'counting', runId: 5, until: 40_000, seconds: 10 });
    expect(drinkReturn(counting, { ...next, goBack: false }).state).toEqual(IDLE_RETURN);
  });

  it('Stay, a tap in the view or the drink starting again keeps the view for this run', () => {
    expect(drinkReturn(counting, { type: 'kept' })).toEqual({ state: kept, goBack: false });
  });

  it('keeping changes nothing while nothing counts', () => {
    expect(drinkReturn(IDLE_RETURN, { type: 'kept' })).toEqual({ state: IDLE_RETURN, goBack: false });
    expect(drinkReturn(kept, { type: 'kept' }).state).toBe(kept);
  });

  it('a tick before zero changes nothing, typing or not', () => {
    expect(drinkReturn(counting, { type: 'tick', now: 10_999, typing: false })).toEqual({ state: counting, goBack: false });
    expect(drinkReturn(counting, { type: 'tick', now: 5000, typing: true })).toEqual({ state: counting, goBack: false });
  });

  it('goes back at zero, or at the first tick past it, once', () => {
    const step = drinkReturn(counting, { type: 'tick', now: 11_000, typing: false });
    expect(step).toEqual({ state: IDLE_RETURN, goBack: true });
    expect(drinkReturn(step.state, { type: 'tick', now: 11_250, typing: false })).toEqual({ state: IDLE_RETURN, goBack: false });
    expect(drinkReturn(counting, { type: 'tick', now: 12_400, typing: false }).goBack).toBe(true);
  });

  it('at zero with a field that takes text focused, keeps the view rather than pull it from under the keyboard', () => {
    expect(drinkReturn(counting, { type: 'tick', now: 11_000, typing: true })).toEqual({ state: kept, goBack: false });
  });

  it('a tick while nothing counts changes nothing', () => {
    expect(drinkReturn(IDLE_RETURN, { type: 'tick', now: 99_000, typing: false })).toEqual({ state: IDLE_RETURN, goBack: false });
    expect(drinkReturn(kept, { type: 'tick', now: 99_000, typing: false })).toEqual({ state: kept, goBack: false });
  });
});

describe('secondsLeft', () => {
  it('says the whole seconds left, rounded up: 10 at the start, 1 in the last second', () => {
    expect(secondsLeft(counting, 1000)).toBe(10);
    expect(secondsLeft(counting, 1001)).toBe(10);
    expect(secondsLeft(counting, 2000)).toBe(9);
    expect(secondsLeft(counting, 10_000)).toBe(1);
    expect(secondsLeft(counting, 10_999)).toBe(1);
  });

  it('never says less than nothing', () => {
    expect(secondsLeft(counting, 11_000)).toBe(0);
    expect(secondsLeft(counting, 12_400)).toBe(0);
  });

  it('says nothing unless it counts', () => {
    expect(secondsLeft(IDLE_RETURN, 1000)).toBeNull();
    expect(secondsLeft(kept, 1000)).toBeNull();
  });
});

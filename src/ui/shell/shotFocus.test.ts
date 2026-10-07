import { describe, expect, it } from 'vitest';
import { IDLE, OUTCOME_WAIT_MS, shotFocus, type FocusState } from './shotFocus.ts';

describe('shotFocus', () => {
  it('a shot starting while not typing and not on the shot route switches there by itself', () => {
    expect(shotFocus(IDLE, { type: 'shotStarted', typing: false, onShotRoute: false })).toEqual({
      state: { kind: 'live', auto: true },
      command: 'goShot',
    });
  });

  it('a shot starting while the barista is typing to the coach does not switch', () => {
    expect(shotFocus(IDLE, { type: 'shotStarted', typing: true, onShotRoute: false })).toEqual({
      state: { kind: 'live', auto: false },
      command: null,
    });
  });

  it('a shot starting while already on the shot route does not switch', () => {
    expect(shotFocus(IDLE, { type: 'shotStarted', typing: false, onShotRoute: true })).toEqual({
      state: { kind: 'live', auto: false },
      command: null,
    });
  });

  it('a user navigation cancels the automatic return while live or over, and changes nothing while idle', () => {
    const live: FocusState = { kind: 'live', auto: true };
    expect(shotFocus(live, { type: 'userNavigated' })).toEqual({ state: { kind: 'live', auto: false }, command: null });

    const over: FocusState = { kind: 'over', auto: true, at: 1000 };
    expect(shotFocus(over, { type: 'userNavigated' })).toEqual({ state: { kind: 'over', auto: false, at: 1000 }, command: null });

    const step = shotFocus(IDLE, { type: 'userNavigated' });
    expect(step.command).toBeNull();
    expect(step.state).toBe(IDLE);
  });

  it('finishing turns live into over, carrying auto over', () => {
    expect(shotFocus({ kind: 'live', auto: true }, { type: 'shotFinished', at: 5000 })).toEqual({
      state: { kind: 'over', auto: true, at: 5000 },
      command: null,
    });
    expect(shotFocus({ kind: 'live', auto: false }, { type: 'shotFinished', at: 5000 })).toEqual({
      state: { kind: 'over', auto: false, at: 5000 },
      command: null,
    });
  });

  it('the outcome reaching the chat during over goes back to the coach only when the switch there was automatic', () => {
    expect(shotFocus({ kind: 'over', auto: true, at: 1000 }, { type: 'outcomeAdded' })).toEqual({
      state: IDLE,
      command: 'goCoach',
    });
    expect(shotFocus({ kind: 'over', auto: false, at: 1000 }, { type: 'outcomeAdded' })).toEqual({
      state: IDLE,
      command: null,
    });
  });

  it('a tick before 8 s of waiting for the outcome changes nothing, and settles once 8 s have passed', () => {
    const over: FocusState = { kind: 'over', auto: true, at: 1000 };
    expect(shotFocus(over, { type: 'tick', now: 1000 + OUTCOME_WAIT_MS - 1 })).toEqual({ state: over, command: null });
    expect(shotFocus(over, { type: 'tick', now: 1000 + OUTCOME_WAIT_MS })).toEqual({ state: IDLE, command: 'goCoach' });

    const manual: FocusState = { kind: 'over', auto: false, at: 1000 };
    expect(shotFocus(manual, { type: 'tick', now: 1000 + OUTCOME_WAIT_MS })).toEqual({ state: IDLE, command: null });
  });

  it('a second start during over begins a new live, auto decided by the same rule as a first start', () => {
    const over: FocusState = { kind: 'over', auto: true, at: 1000 };
    expect(shotFocus(over, { type: 'shotStarted', typing: false, onShotRoute: false })).toEqual({
      state: { kind: 'live', auto: true },
      command: 'goShot',
    });
    expect(shotFocus(over, { type: 'shotStarted', typing: true, onShotRoute: false })).toEqual({
      state: { kind: 'live', auto: false },
      command: null,
    });
  });

  it('a finish, an outcome or a tick while idle change nothing', () => {
    expect(shotFocus(IDLE, { type: 'shotFinished', at: 1000 })).toEqual({ state: IDLE, command: null });
    expect(shotFocus(IDLE, { type: 'outcomeAdded' })).toEqual({ state: IDLE, command: null });
    expect(shotFocus(IDLE, { type: 'tick', now: 1000 })).toEqual({ state: IDLE, command: null });
  });

  it('an outcome during live is ignored, as when the app opened mid-shot with no finish seen', () => {
    const live: FocusState = { kind: 'live', auto: true };
    expect(shotFocus(live, { type: 'outcomeAdded' })).toEqual({ state: live, command: null });
  });

  it('OUTCOME_WAIT_MS is 8 s', () => {
    expect(OUTCOME_WAIT_MS).toBe(8000);
  });
});

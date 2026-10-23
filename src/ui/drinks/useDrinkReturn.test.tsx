// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DrinkRun } from './drinkTrace.ts';
import { useDrinkReturn } from './useDrinkReturn.ts';
import type { DrinkScreenView } from './useDrinkScreens.ts';

/** A steam run as the view hears of it: only its id and how it ended matter here. */
const steam = (id: number, live: boolean, lost = false): DrinkRun => ({
  kind: 'steam',
  id,
  live,
  lost,
  t: [],
  flow: [],
  pressure: [],
  steamTemperature: [],
  groupTemperature: [],
  weight: [],
  working: [],
  latest: null,
  elapsedS: 0,
  waterMl: 0,
});

const ON: DrinkScreenView = { scene: 'spray', goBack: true, goBackSeconds: 10 };
const OFF: DrinkScreenView = { ...ON, goBack: false };

function view(run: DrinkRun | null, screen: DrinkScreenView = ON) {
  const goBack = vi.fn();
  const hook = renderHook((props: { run: DrinkRun | null; screen: DrinkScreenView }) => useDrinkReturn(props.run, props.screen, goBack), {
    initialProps: { run, screen },
  });
  const show = (next: DrinkRun | null, nextScreen: DrinkScreenView = screen) => hook.rerender({ run: next, screen: nextScreen });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { goBack, hook, show, wait, left: () => hook.result.current.countdown?.left ?? null };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDrinkReturn', () => {
  it('counts down from the end of a run it saw live, then goes back, once', () => {
    const { goBack, show, wait, left, hook } = view(steam(1, true));
    expect(left()).toBeNull();
    show(steam(1, false));
    expect(hook.result.current.countdown).toEqual({ left: 10, seconds: 10, until: Date.now() + 10_000 });
    wait(1000);
    expect(left()).toBe(9);
    wait(8999);
    expect(left()).toBe(1);
    expect(goBack).not.toHaveBeenCalled();
    wait(1);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(hook.result.current.countdown).toBeNull();
    expect(hook.result.current.kept).toBe(false);
    wait(20_000);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('never counts for a run that was over before the view saw it', () => {
    const { goBack, wait, left } = view(steam(1, false));
    expect(left()).toBeNull();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('counts for the seconds set', () => {
    const { show, hook } = view(steam(1, true), { ...ON, goBackSeconds: 25 });
    show(steam(1, false));
    expect(hook.result.current.countdown).toEqual({ left: 25, seconds: 25, until: Date.now() + 25_000 });
  });

  it('Stay keeps the view for this run', () => {
    const { goBack, show, wait, left, hook } = view(steam(1, true));
    show(steam(1, false));
    expect(hook.result.current.kept).toBe(false);
    wait(3000);
    act(() => hook.result.current.keep());
    expect(left()).toBeNull();
    expect(hook.result.current.kept).toBe(true);
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('at zero, a field that takes text with focus keeps the view, rather than pull it from under the keyboard', () => {
    const field = document.body.appendChild(document.createElement('textarea'));
    try {
      const { goBack, show, wait, left } = view(steam(1, true));
      show(steam(1, false));
      field.focus();
      wait(10_000);
      expect(goBack).not.toHaveBeenCalled();
      expect(left()).toBeNull();
    } finally {
      field.remove();
    }
  });

  it('never counts for a run the connection going away cut short', () => {
    const { goBack, show, wait, left } = view(steam(1, true));
    show(steam(1, false, true));
    expect(left()).toBeNull();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('never counts with going back by itself off', () => {
    const { goBack, show, wait, left } = view(steam(1, true), OFF);
    show(steam(1, false));
    expect(left()).toBeNull();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('stops when going back by itself is turned off while it counts', () => {
    const { goBack, show, wait, left } = view(steam(1, true));
    show(steam(1, false));
    show(steam(1, false), OFF);
    expect(left()).toBeNull();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('the drink starting again keeps the view, and the new run counts afresh once it ends', () => {
    const { goBack, show, wait, left } = view(steam(1, true));
    show(steam(1, false));
    wait(4000);
    show(steam(2, true));
    expect(left()).toBeNull();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
    show(steam(2, false));
    expect(left()).toBe(10);
    wait(10_000);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('stops with the view', () => {
    const { goBack, show, wait, hook } = view(steam(1, true));
    show(steam(1, false));
    hook.unmount();
    wait(20_000);
    expect(goBack).not.toHaveBeenCalled();
  });
});

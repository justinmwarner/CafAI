import { describe, expect, it } from 'vitest';
import { backingScale, MAX_STEP_MS, playFor, runSaver, stepFor, type FrameClock } from './runner.ts';
import type { SaverInstance } from './types.ts';

/** A clock whose frames come only when the test says, every `every` ms. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const waiting = new Map<number, () => void>();
  const clock: FrameClock = {
    now: () => now,
    request(callback) {
      const handle = next++;
      waiting.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      waiting.delete(handle);
    },
  };
  return {
    clock,
    /** One display frame, `ms` after the last. */
    frame(ms: number) {
      now += ms;
      const callbacks = [...waiting.values()];
      waiting.clear();
      for (const callback of callbacks) callback();
    },
    pending: () => waiting.size,
  };
}

function recorder() {
  const steps: number[] = [];
  let draws = 0;
  const instance: SaverInstance = {
    step: (dt) => steps.push(dt),
    draw: () => {
      draws += 1;
    },
    resize: () => {},
    still: () => {},
    dispose: () => {},
  };
  return { instance, steps, draws: () => draws };
}

describe('runSaver', () => {
  it('draws on its first frame, then steps and draws at most 30 times a second', () => {
    const time = fakeClock();
    const saver = recorder();
    runSaver(saver.instance, { clock: time.clock });
    time.frame(16.7);
    expect(saver.draws()).toBe(1);
    expect(saver.steps).toEqual([]);
    // 60 Hz display frames: every second one steps.
    for (let i = 0; i < 6; i += 1) time.frame(16.7);
    expect(saver.steps).toHaveLength(3);
    for (const dt of saver.steps) expect(dt).toBeCloseTo(33.4, 5);
    expect(saver.draws()).toBe(4);
  });

  it('steps a long gap as a tenth of a second', () => {
    const time = fakeClock();
    const saver = recorder();
    runSaver(saver.instance, { clock: time.clock });
    time.frame(16);
    time.frame(5_000);
    expect(saver.steps).toEqual([MAX_STEP_MS]);
  });

  it('pauses, and after a resume only draws on its first frame', () => {
    const time = fakeClock();
    const saver = recorder();
    const run = runSaver(saver.instance, { clock: time.clock });
    time.frame(16);
    time.frame(40);
    expect(saver.steps).toHaveLength(1);
    run.pause();
    expect(time.pending()).toBe(0);
    time.frame(10_000);
    run.resume();
    time.frame(16);
    expect(saver.steps).toHaveLength(1);
    time.frame(40);
    expect(saver.steps).toEqual([40, 40]);
  });

  it('stops for good', () => {
    const time = fakeClock();
    const saver = recorder();
    const run = runSaver(saver.instance, { clock: time.clock });
    time.frame(16);
    run.stop();
    run.resume();
    time.frame(40);
    expect(saver.draws()).toBe(1);
    expect(time.pending()).toBe(0);
  });

  it('stops and reports a screensaver that throws', () => {
    const time = fakeClock();
    const errors: unknown[] = [];
    const broken: SaverInstance = {
      ...recorder().instance,
      draw: () => {
        throw new Error('no context');
      },
    };
    runSaver(broken, { clock: time.clock, onError: (error) => errors.push(error) });
    time.frame(16);
    expect(errors).toHaveLength(1);
    expect(time.pending()).toBe(0);
  });
});

describe('stepFor', () => {
  it('steps through the time in 30 fps frames, the last one short', () => {
    const saver = recorder();
    stepFor(saver.instance, 110);
    expect(saver.steps).toHaveLength(4);
    expect(saver.steps[3]).toBeCloseTo(10, 9);
    expect(saver.steps.reduce((sum, dt) => sum + dt, 0)).toBeCloseTo(110, 9);
    expect(saver.draws()).toBe(0);
  });
});

describe('playFor', () => {
  it('draws first, then steps and draws each 30 fps frame', () => {
    const saver = recorder();
    playFor(saver.instance, 110);
    expect(saver.steps).toHaveLength(4);
    expect(saver.draws()).toBe(5);
  });

  it('draws once for no time at all', () => {
    const saver = recorder();
    playFor(saver.instance, 0);
    expect(saver.steps).toEqual([]);
    expect(saver.draws()).toBe(1);
  });
});

describe('backingScale', () => {
  it('follows the pixel ratio between 1 and 1.5', () => {
    expect(backingScale(1.33)).toBe(1.33);
    expect(backingScale(1.125)).toBe(1.125);
    expect(backingScale(3)).toBe(1.5);
    expect(backingScale(0.5)).toBe(1);
    expect(backingScale(Number.NaN)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { CYCLE_MIN_MS, NO_CYCLE, watchCycle, type CycleSeen, type CycleWatch } from './cycleWatch.ts';

/** Frames one second apart, as [state, at] pairs; the cycles seen along the way. */
function play(frames: ReadonlyArray<readonly [string | null, number]>): CycleSeen[] {
  let watch: CycleWatch = NO_CYCLE;
  const seen: CycleSeen[] = [];
  for (const [state, at] of frames) {
    const next = watchCycle(watch, state, at);
    watch = next.watch;
    if (next.seen) seen.push(next.seen);
  }
  return seen;
}

const run = (state: string, fromS: number, toS: number) =>
  Array.from({ length: toS - fromS + 1 }, (_, i) => [state, (fromS + i) * 1000] as const);

describe('seen, then gone (D-CARE-4)', () => {
  it('a Clean seen for a minute, then idle, marks the weekly clean at its last frame', () => {
    expect(play([...run('idle', 0, 2), ...run('cleaning', 3, 400), ['idle', 401_000]])).toEqual([{ step: 'detergent-clean', atMs: 400_000 }]);
  });

  it('a Descale marks the descale', () => {
    expect(play([...run('descaling', 0, 1800), ['sleeping', 1_801_000]])).toEqual([{ step: 'descale', atMs: 1_800_000 }]);
  });

  it('one stopped within a minute was not run', () => {
    expect(play([...run('cleaning', 0, (CYCLE_MIN_MS - 1000) / 1000), ['idle', CYCLE_MIN_MS]])).toEqual([]);
  });

  it('a socket gone quiet ends nothing: the cycle ends at the first frame CafAI sees again', () => {
    expect(play([...run('cleaning', 0, 30), [null, 31_000], [null, 600_000], ...run('cleaning', 601, 640), ['idle', 641_000]])).toEqual([
      { step: 'detergent-clean', atMs: 640_000 },
    ]);
    // Blind for the end of it: done when the machine is seen again, at the last frame seen running.
    expect(play([...run('cleaning', 0, 120), [null, 121_000], ['idle', 900_000]])).toEqual([{ step: 'detergent-clean', atMs: 120_000 }]);
  });

  it('shots, drinks and sleep are no cycle', () => {
    expect(play([...run('espresso', 0, 120), ...run('steam', 121, 300), ...run('flush', 301, 400), ['sleeping', 401_000]])).toEqual([]);
  });

  it('a Descale right after a Clean ends the Clean', () => {
    expect(play([...run('cleaning', 0, 100), ...run('descaling', 101, 300), ['idle', 301_000]])).toEqual([
      { step: 'detergent-clean', atMs: 100_000 },
      { step: 'descale', atMs: 300_000 },
    ]);
  });
});

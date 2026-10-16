import { describe, expect, it } from 'vitest';
import { CYCLE_MIN_MS, NO_CYCLE, watchCycle, type CycleSeen, type CycleWatch } from './cycleWatch.ts';

/** CafAI gets each frame this long after the machine's own time: its clock and Decaid's never quite agree. */
const LAG_MS = 7_000_000;

/** Frames as [state, the frame's own time] pairs; the cycles seen along the way. */
function play(frames: ReadonlyArray<readonly [string, number]>): CycleSeen[] {
  let watch: CycleWatch = NO_CYCLE;
  const seen: CycleSeen[] = [];
  for (const [state, atMs] of frames) {
    const next = watchCycle(watch, { state, atMs, seenMs: atMs + LAG_MS });
    watch = next.watch;
    if (next.seen) seen.push(next.seen);
  }
  return seen;
}

/** A frame a second, by the frames' own times. */
const run = (state: string, fromS: number, toS: number) => Array.from({ length: toS - fromS + 1 }, (_, i) => [state, (fromS + i) * 1000] as const);

describe('seen, then gone (D186)', () => {
  it('a Clean seen for a minute, then idle, marks the weekly clean when CafAI got its last frame', () => {
    expect(play([...run('idle', 0, 2), ...run('cleaning', 3, 400), ['idle', 401_000]])).toEqual([{ step: 'detergent-clean', atMs: 400_000 + LAG_MS }]);
  });

  it('a Descale marks the descale', () => {
    expect(play([...run('descaling', 0, 1800), ['sleeping', 1_801_000]])).toEqual([{ step: 'descale', atMs: 1_800_000 + LAG_MS }]);
  });

  it('one stopped within a minute was not run', () => {
    expect(play([...run('cleaning', 0, (CYCLE_MIN_MS - 1000) / 1000), ['idle', CYCLE_MIN_MS]])).toEqual([]);
  });

  it("measures the minute by the frames' own times, however late or bunched CafAI got them", () => {
    // Ten seconds of a Clean by the machine's clock, though CafAI got the frames a minute apart.
    let watch: CycleWatch = NO_CYCLE;
    watch = watchCycle(watch, { state: 'cleaning', atMs: 0, seenMs: 0 }).watch;
    watch = watchCycle(watch, { state: 'cleaning', atMs: 10_000, seenMs: 70_000 }).watch;
    expect(watchCycle(watch, { state: 'idle', atMs: 11_000, seenMs: 71_000 }).seen).toBeNull();
  });

  it('a gap ends nothing: the cycle ends at the first frame after it, counted by the frames on either side', () => {
    // A socket gone quiet in the middle of a Clean, then frames again while it runs.
    expect(play([...run('cleaning', 0, 30), ...run('cleaning', 601, 640), ['idle', 641_000]])).toEqual([{ step: 'detergent-clean', atMs: 640_000 + LAG_MS }]);
    // Blind for the end of it: done when the machine is seen again, at the last frame seen running.
    expect(play([...run('cleaning', 0, 120), ['idle', 900_000]])).toEqual([{ step: 'detergent-clean', atMs: 120_000 + LAG_MS }]);
    // A Clean stopped after ten seconds, then a gap: ten seconds, however long the gap.
    expect(play([...run('cleaning', 0, 10), ['idle', 90_000]])).toEqual([]);
  });

  it('shots, drinks and sleep are no cycle', () => {
    expect(play([...run('espresso', 0, 120), ...run('steam', 121, 300), ...run('flush', 301, 400), ['sleeping', 401_000]])).toEqual([]);
  });

  it('a Descale right after a Clean ends the Clean', () => {
    expect(play([...run('cleaning', 0, 100), ...run('descaling', 101, 300), ['idle', 301_000]])).toEqual([
      { step: 'detergent-clean', atMs: 100_000 + LAG_MS },
      { step: 'descale', atMs: 300_000 + LAG_MS },
    ]);
  });
});

/**
 * Whether a shot ran like the one before it on the same recipe (D197): the
 * pour time, the yield, the peak pressure and the first drop each close to
 * the earlier shot's, the same stop reason, and no channeling flag the
 * earlier shot did not raise. Only such a shot of a kept recipe gets a fun
 * fact: one that ran differently is the coach's to explain.
 */
import type { ShotSummary } from '../types.ts';

/** How far each number may move and still be the same shot: seconds, grams, bar, seconds. */
export const LIKE_LAST = { durationS: 3, yieldG: 1.5, peakPressureBar: 1, firstDropS: 3 } as const;

/** Within `limit` of each other; a number either shot lacks is not compared. */
function close(a: number | null, b: number | null, limit: number): boolean {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return true;
  // The hair over the limit is floating point: 28.4 + 3 is not quite 31.4.
  return Math.abs(a - b) <= limit + 1e-9;
}

export function ranLikeLast(shot: ShotSummary, previous: ShotSummary): boolean {
  return (
    close(shot.durationS, previous.durationS, LIKE_LAST.durationS) &&
    close(shot.yieldG, previous.yieldG, LIKE_LAST.yieldG) &&
    close(shot.peakPressureBar, previous.peakPressureBar, LIKE_LAST.peakPressureBar) &&
    close(shot.timeToFirstDropS, previous.timeToFirstDropS, LIKE_LAST.firstDropS) &&
    (shot.stopReason === null || previous.stopReason === null || shot.stopReason === previous.stopReason) &&
    shot.channelingFlags.every((flag) => previous.channelingFlags.includes(flag))
  );
}

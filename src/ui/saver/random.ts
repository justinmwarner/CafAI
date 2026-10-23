/**
 * The seeded random every screensaver draws from (D226): the same seed
 * gives the same numbers in the same order, so a day's screensaver, a still
 * and a test's frame can be made again exactly. Mulberry32: tiny, fast, and
 * plenty for pictures (not for anything secret).
 */

export type Random = () => number;

/** A random in [0, 1), seeded. Any number seeds it; its 32 low bits count. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [min, max). */
export function between(random: Random, min: number, max: number): number {
  return min + (max - min) * random();
}

/** A whole number in [min, max]. */
export function wholeBetween(random: Random, min: number, max: number): number {
  return Math.min(max, min + Math.floor((max - min + 1) * random()));
}

/** One of the items, each as likely. */
export function pickOne<T>(random: Random, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickOne needs at least one item');
  return items[Math.min(items.length - 1, Math.floor(items.length * random()))]!;
}

/**
 * The number of the local calendar day `time` falls on: the seed of the
 * day's screensaver, and what "a different one each day" counts by.
 */
export function localDayNumber(time: Date): number {
  return Math.floor(Date.UTC(time.getFullYear(), time.getMonth(), time.getDate()) / 86_400_000);
}

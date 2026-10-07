import { describe, expect, it } from 'vitest';
import { pourTime } from './pourClock.ts';

describe('pourTime: a time on the record clock as the barista sees it, from the start of the pour', () => {
  it('counts from pourStartS, to the summary\'s 0.1 s', () => {
    expect(pourTime(61, 2)).toBe(59);
    expect(pourTime(6.6, 2)).toBe(4.6);
    // Differences of one-decimal values carry float noise; the result does not.
    expect(pourTime(61.4, 2.2)).toBe(59.2);
    expect(pourTime(62.7, 2.2)).toBe(60.5);
    expect(pourTime(9.8, 2.8)).toBe(7);
  });

  it('never goes below 0: a moment in preheat is the start of the pour', () => {
    expect(pourTime(1.2, 2)).toBe(0);
    expect(pourTime(2, 2)).toBe(0);
    expect(Object.is(pourTime(2, 2), 0)).toBe(true);
  });

  it('keeps the time of a summary saved before pourStartS, and has no time to give without one', () => {
    expect(pourTime(61, undefined)).toBe(61);
    expect(pourTime(61, null)).toBe(61);
    expect(pourTime(null, 2)).toBeNull();
    expect(pourTime(Number.NaN, 2)).toBeNull();
  });
});

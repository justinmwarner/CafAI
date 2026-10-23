import { describe, expect, it } from 'vitest';
import { between, createRandom, localDayNumber, pickOne, wholeBetween } from './random.ts';

describe('createRandom', () => {
  it('gives the same numbers for the same seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const first = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(first);
  });

  it('gives different numbers for another seed', () => {
    const a = createRandom(1);
    const b = createRandom(2);
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });

  it('stays in [0, 1) and spreads over it', () => {
    const random = createRandom(7);
    const values = Array.from({ length: 10_000 }, () => random());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('takes any number as a seed', () => {
    for (const seed of [0, -1, 2 ** 40 + 3, 0.5, Number.MAX_SAFE_INTEGER]) {
      const value = createRandom(seed)();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('between, wholeBetween and pickOne', () => {
  it('keep to their bounds', () => {
    const random = createRandom(3);
    for (let i = 0; i < 2_000; i += 1) {
      const real = between(random, -2, 5);
      expect(real).toBeGreaterThanOrEqual(-2);
      expect(real).toBeLessThan(5);
      const whole = wholeBetween(random, 1, 6);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(1);
      expect(whole).toBeLessThanOrEqual(6);
    }
  });

  it('reaches both ends of a whole range', () => {
    const random = createRandom(9);
    const seen = new Set(Array.from({ length: 500 }, () => wholeBetween(random, 1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('picks every item in time, and refuses an empty list', () => {
    const random = createRandom(11);
    const seen = new Set(Array.from({ length: 200 }, () => pickOne(random, ['a', 'b', 'c'])));
    expect(seen.size).toBe(3);
    expect(() => pickOne(random, [])).toThrow();
  });
});

describe('localDayNumber', () => {
  it('is the same all day and one more the next day', () => {
    const morning = new Date(2026, 9, 22, 0, 0, 1);
    const night = new Date(2026, 9, 22, 23, 59, 59);
    const next = new Date(2026, 9, 23, 0, 0, 0);
    expect(localDayNumber(night)).toBe(localDayNumber(morning));
    expect(localDayNumber(next)).toBe(localDayNumber(morning) + 1);
  });
});

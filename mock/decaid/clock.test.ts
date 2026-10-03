import { describe, expect, it } from 'vitest';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import { createDataClock, formatLocalTimestamp, formatUtcTimestamp } from './clock.ts';

describe('timestamp formatting', () => {
  it('writes local zone-less timestamps with microseconds, like Dart', () => {
    for (const text of ['2026-10-03T08:15:02.731455', '2026-09-29T12:53:54.216425', '2026-01-01T00:00:00.000001']) {
      expect(formatLocalTimestamp(parseDecaidTimestamp(text))).toBe(text);
    }
    expect(formatLocalTimestamp(new Date(2026, 9, 3, 8, 15, 2, 5).getTime())).toBe('2026-10-03T08:15:02.005000');
  });

  it('writes UTC timestamps with a Z', () => {
    for (const text of ['2026-10-03T06:15:41.902117Z', '2026-10-03T06:15:20.044319Z']) {
      expect(formatUtcTimestamp(parseDecaidTimestamp(text))).toBe(text);
    }
  });

  it('carries a rounded-up microsecond into the next second', () => {
    const ms = new Date(2026, 9, 3, 8, 15, 2, 999).getTime() + 0.9999;
    expect(formatLocalTimestamp(ms)).toBe('2026-10-03T08:15:03.000000');
  });
});

describe('createDataClock', () => {
  it('follows the wall clock and never goes backwards after a fast-forward', () => {
    let wall = 1_000;
    const clock = createDataClock(() => wall);
    expect(clock.now()).toBe(1_000);
    clock.advanceTo(5_000);
    expect(clock.now()).toBe(5_000);
    wall = 2_000;
    expect(clock.now(), 'the skipped time is kept').toBe(6_000);
    clock.advanceTo(100);
    expect(clock.now()).toBe(6_000);
  });
});

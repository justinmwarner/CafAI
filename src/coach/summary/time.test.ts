import { describe, expect, it } from 'vitest';

import { elapsedSeconds, parseTimestampMicros } from './time.ts';

describe('parseTimestampMicros', () => {
  it('reads Decaid local zone-less timestamps with microseconds', () => {
    const a = parseTimestampMicros('2026-09-29T12:47:13.366017');
    const b = parseTimestampMicros('2026-09-29T12:47:13.634017');
    expect(a).not.toBeNull();
    expect(b! - a!).toBe(268000);
  });

  it('accepts 0-9 fraction digits, Z and offsets', () => {
    expect(parseTimestampMicros('2026-09-29T12:47:13')).toBe(Date.UTC(2026, 8, 29, 12, 47, 13) * 1000);
    expect(parseTimestampMicros('2026-09-29T12:47:13.5')).toBe(Date.UTC(2026, 8, 29, 12, 47, 13) * 1000 + 500000);
    expect(parseTimestampMicros('2026-09-29T12:47:13.123456789')).toBe(Date.UTC(2026, 8, 29, 12, 47, 13) * 1000 + 123456);
    expect(parseTimestampMicros('2026-09-29T10:48:02.048495Z')).toBe(Date.UTC(2026, 8, 29, 10, 48, 2) * 1000 + 48495);
    expect(parseTimestampMicros('2026-09-29T12:48:02+02:00')).toBe(Date.UTC(2026, 8, 29, 10, 48, 2) * 1000);
    expect(parseTimestampMicros('2026-09-29T08:48:02-0200')).toBe(Date.UTC(2026, 8, 29, 10, 48, 2) * 1000);
  });

  it('returns null for anything that is not an ISO date-time', () => {
    for (const bad of ['', 'yesterday', '2026-13-01T00:00:00', '2026-09-29', '2026-09-29T25:00:00', null, 5]) {
      expect(parseTimestampMicros(bad), String(bad)).toBeNull();
    }
  });
});

describe('elapsedSeconds', () => {
  it('measures between two zone-less timestamps', () => {
    expect(elapsedSeconds('2026-10-03T08:15:02.725113', '2026-10-03T08:15:37.687113')).toBe(34.962);
    expect(elapsedSeconds('nope', '2026-10-03T08:15:37.687113')).toBeNull();
  });
});

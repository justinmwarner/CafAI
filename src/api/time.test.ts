import { describe, expect, it } from 'vitest';
import { formatDecaidTimestamp, parseDecaidTimestamp } from './time.ts';

describe('formatDecaidTimestamp', () => {
  it("writes a moment as Decaid writes a local time, which reads back to the same moment", () => {
    const moment = new Date(2026, 9, 10, 7, 5, 3, 42);
    expect(formatDecaidTimestamp(moment)).toBe('2026-10-10T07:05:03.042000');
    expect(parseDecaidTimestamp(formatDecaidTimestamp(moment))).toBe(moment.getTime());
  });
});

// Values below are taken from docs/verified/examples (machine, scale and shot
// timestamps are local and zone-less; devices and shot createdAt carry a Z).

describe('parseDecaidTimestamp', () => {
  it('reads a zone-less machine timestamp as local time and keeps the microseconds', () => {
    const ms = parseDecaidTimestamp('2026-09-29T12:53:54.216425');
    expect(ms).toBeCloseTo(new Date(2026, 8, 29, 12, 53, 54, 216).getTime() + 0.425, 3);
  });

  it('reads UTC timestamps that end in Z', () => {
    expect(parseDecaidTimestamp('2026-10-03T06:15:20.044319Z')).toBeCloseTo(Date.UTC(2026, 9, 3, 6, 15, 20, 44) + 0.319, 3);
    expect(parseDecaidTimestamp('2026-09-16T06:30:56Z')).toBe(Date.UTC(2026, 8, 16, 6, 30, 56));
  });

  it('applies an explicit offset', () => {
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.731455+02:00')).toBeCloseTo(Date.UTC(2026, 9, 3, 6, 15, 2, 731) + 0.455, 3);
    expect(parseDecaidTimestamp('2026-10-03T01:00:00-05:30')).toBe(Date.UTC(2026, 9, 3, 6, 30, 0));
    expect(parseDecaidTimestamp('2026-10-03T08:00:00+0200')).toBe(Date.UTC(2026, 9, 3, 6, 0, 0));
  });

  it('accepts zero to six fraction digits (and truncates longer ones)', () => {
    const base = new Date(2026, 9, 3, 8, 15, 2).getTime();
    expect(parseDecaidTimestamp('2026-10-03T08:15:02')).toBe(base);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.7')).toBe(base + 700);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.73')).toBe(base + 730);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.731')).toBe(base + 731);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.7314')).toBeCloseTo(base + 731.4, 3);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.731455')).toBeCloseTo(base + 731.455, 3);
    expect(parseDecaidTimestamp('2026-10-03T08:15:02.731455999')).toBeCloseTo(base + 731.455, 3);
  });

  it('accepts a space instead of T, as Dart DateTime.toString() writes', () => {
    expect(parseDecaidTimestamp('2026-10-03 08:15:02.5')).toBe(new Date(2026, 9, 3, 8, 15, 2, 500).getTime());
  });

  it('measures shot time from the example record', () => {
    // shot-record.json: the shot timestamp is about 6 ms after the first sample.
    const first = parseDecaidTimestamp('2026-10-03T08:15:02.725113');
    const start = parseDecaidTimestamp('2026-10-03T08:15:02.731455');
    expect(start - first).toBeCloseTo(6.342, 2);
    const last = parseDecaidTimestamp('2026-10-03T08:15:37.687113');
    expect((last - first) / 1000).toBeCloseTo(34.962, 5);
  });

  it('returns NaN for anything that is not a Decaid timestamp', () => {
    const bad: unknown[] = [
      '',
      'yesterday',
      '2026-10-03',
      '2026-13-01T00:00:00',
      '2026-02-30T00:00:00',
      '2026-10-03T25:00:00',
      '2026-10-03T08:61:00',
      '2026-10-03T08:15:02+2',
      '2026-10-03T08:15:02.',
      null,
      undefined,
      42,
    ];
    for (const value of bad) {
      expect(parseDecaidTimestamp(value as string), String(value)).toBeNaN();
    }
  });
});

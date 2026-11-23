import { describe, expect, it } from 'vitest';
import { createTracker, DROP_AFTER_MS, normalizeHex, TRAIL_POINTS } from './tracker.ts';

const snap = (aircraft: object[]) => ({ nowMs: null, aircraft });

describe('the tracker', () => {
  it('keeps the last 20 positions as a trail, oldest first', () => {
    const tracker = createTracker();
    for (let i = 0; i < 25; i += 1) tracker.ingest(snap([{ hex: 'A12AC7', lat: 41 + i / 100, lon: -88 }]), 1000 * i);
    const [plane] = tracker.current(25_000);
    expect(plane?.hex).toBe('a12ac7');
    expect(plane?.trail).toHaveLength(TRAIL_POINTS);
    expect(plane?.trail[0]).toEqual([-88, 41.05]);
    expect(plane?.trail[TRAIL_POINTS - 1]).toEqual([-88, 41.24]);
  });

  it('dates a position by seen_pos against when the answer arrived', () => {
    const tracker = createTracker();
    tracker.ingest(snap([{ hex: 'aba30b', lat: 41.99, lon: -87.93, seen_pos: 20.856, seen: 0.5 }]), 100_000);
    expect(tracker.current(100_000)[0]).toMatchObject({ positionAt: 79_144, heardAt: 99_500 });
  });

  it('keeps a newer position when an older one arrives late', () => {
    const tracker = createTracker();
    tracker.ingest(snap([{ hex: 'a', lat: 2, lon: 2 }]), 10_000);
    tracker.ingest(snap([{ hex: 'a', lat: 1, lon: 1, seen_pos: 5 }]), 11_000);
    expect(tracker.current(11_000)[0]).toMatchObject({ lat: 2, lon: 2, trail: [[2, 2]] });
  });

  it('drops an aircraft not heard of for a minute', () => {
    const tracker = createTracker();
    tracker.ingest(snap([{ hex: 'a', lat: 1, lon: 1 }, { hex: 'b', lat: 1, lon: 1 }]), 0);
    tracker.ingest(snap([{ hex: 'b', lat: 1.1, lon: 1 }]), 30_000);
    expect(tracker.current(DROP_AFTER_MS).map((plane) => plane.hex)).toEqual(['a', 'b']);
    expect(tracker.current(DROP_AFTER_MS + 1).map((plane) => plane.hex)).toEqual(['b']);
  });

  it('skips aircraft without an address or a position', () => {
    const tracker = createTracker();
    tracker.ingest(snap([{ lat: 1, lon: 1 }, { hex: 'c' }, { hex: ' ', lat: 1, lon: 1 }]), 0);
    expect(tracker.current(0)).toEqual([]);
    expect(normalizeHex('~2A00C1')).toBe('~2a00c1');
  });
});

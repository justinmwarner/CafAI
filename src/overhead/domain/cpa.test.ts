import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings.ts';
import { board, bucketFor, bucketLabel } from './buckets.ts';
import { closestApproach, cpaLabel } from './cpa.ts';
import { destinationPoint, MILES_PER_NM } from './geo.ts';

/** Anywhere will do; this is O'Hare's reference point. */
const HOME = { lat: 41.9786, lon: -87.9048 };
const RULES = { ...DEFAULT_SETTINGS };

const east = (nm: number) => destinationPoint(HOME, nm, 90);
const eastAndNorth = (eastNm: number, northNm: number) => destinationPoint(east(eastNm), northNm, 0);

describe('the four known answers (the brief, section 2)', () => {
  it('1. 4 nm due east, track 270°, 240 kt: closest in 60 s, directly over', () => {
    const cpa = closestApproach(HOME, { position: east(4), groundSpeedKt: 240, trackDeg: 270 });
    expect(cpa?.timeToCpaSeconds).toBeCloseTo(60, 0);
    expect(cpa?.distanceMiles).toBeLessThan(0.01);
    expect(cpa?.side).toBeNull();
    expect(cpaLabel(cpa as NonNullable<typeof cpa>)).toBe('directly over');
    expect(bucketLabel(bucketFor(cpa, RULES) as NonNullable<ReturnType<typeof bucketFor>>)).toBe('1 min');
    // 30 s later it is Now.
    expect(bucketFor(cpa, RULES, 30)).toEqual({ kind: 'now' });
  });

  it('2. 4 nm east and 1 nm north, track 270°, 240 kt: closest in 60 s, about 1.15 mi north', () => {
    const cpa = closestApproach(HOME, { position: eastAndNorth(4, 1), groundSpeedKt: 240, trackDeg: 270 });
    expect(cpa?.timeToCpaSeconds).toBeCloseTo(60, 0);
    expect(cpa?.distanceMiles).toBeCloseTo(1 * MILES_PER_NM, 2);
    expect(cpa?.distanceMiles).toBeCloseTo(1.15, 1);
    expect(cpa?.side).toBe('north');
    // A westbound great circle bends a little south of the parallel: 1.149 mi, so "1.1 mi north".
    expect(cpaLabel(cpa as NonNullable<typeof cpa>)).toBe('1.1 mi north');
    // 1.15 mi is inside "soon" (1.5 mi) but outside "now" (0.5 mi), even at its closest.
    expect(bucketFor(cpa, RULES)).toMatchObject({ kind: 'soon', minutes: 1 });
    expect(bucketFor(cpa, RULES, 60)).toMatchObject({ kind: 'passed' });
  });

  it('3. moving away: time to CPA negative; excluded, or "Just passed" within 60 s', () => {
    // 3 nm east, flying east: overhead 45 s ago (at 30 s it would still be Now, by the brief's ±30 s).
    const justGone = closestApproach(HOME, { position: east(3), groundSpeedKt: 240, trackDeg: 90 });
    expect(justGone?.timeToCpaSeconds).toBeCloseTo(-45, 0);
    expect(bucketFor(justGone, RULES)).toMatchObject({ kind: 'passed' });
    expect(bucketLabel(bucketFor(justGone, RULES) as NonNullable<ReturnType<typeof bucketFor>>)).toBe('Just passed');

    const atTheEdge = closestApproach(HOME, { position: east(4), groundSpeedKt: 240, trackDeg: 90 });
    expect(atTheEdge?.timeToCpaSeconds).toBeCloseTo(-60, 0);
    expect(bucketFor(atTheEdge, RULES, 0.5)).toBeNull();

    const longGone = closestApproach(HOME, { position: east(8), groundSpeedKt: 240, trackDeg: 90 });
    expect(longGone?.timeToCpaSeconds).toBeCloseTo(-120, 0);
    expect(bucketFor(longGone, RULES)).toBeNull();
  });

  it('4. no ground speed or no track: off the board, still on the map', () => {
    expect(closestApproach(HOME, { position: east(1), groundSpeedKt: 0, trackDeg: 270 })).toBeNull();
    expect(closestApproach(HOME, { position: east(1), groundSpeedKt: null, trackDeg: 270 })).toBeNull();
    expect(closestApproach(HOME, { position: east(1), groundSpeedKt: 240, trackDeg: null })).toBeNull();
    const parked = { onGround: false, altitudeFt: 2000, cpa: null, positionAt: 0, lat: east(1).lat, lon: east(1).lon };
    expect(board([parked], RULES, 0)).toEqual([]);
  });
});

describe('closest approach', () => {
  it('names the side the closest point is on', () => {
    // Flying north 2 nm west of home: passes 2.3 mi west.
    const cpa = closestApproach(HOME, { position: destinationPoint(destinationPoint(HOME, 2, 270), 3, 180), groundSpeedKt: 180, trackDeg: 0 });
    expect(cpa?.side).toBe('west');
    expect(cpa?.distanceMiles).toBeCloseTo(2 * MILES_PER_NM, 2);
    expect(cpa?.timeToCpaSeconds).toBeCloseTo(60, 0);
  });

  it('works at an angle', () => {
    // From the southwest, heading northeast straight over home, 6 nm out at 360 kt: a minute.
    const cpa = closestApproach(HOME, { position: destinationPoint(HOME, 6, 225), groundSpeedKt: 360, trackDeg: 45 });
    expect(cpa?.timeToCpaSeconds).toBeCloseTo(60, 0);
    expect(cpa?.distanceMiles).toBeLessThan(0.02);
  });
});

describe('the buckets', () => {
  const cpa = (timeToCpaSeconds: number, distanceMiles: number) => ({ timeToCpaSeconds, distanceMiles, side: null });

  it('Now: within 0.5 mi and 30 s either side', () => {
    expect(bucketFor(cpa(30, 0.5), RULES)).toEqual({ kind: 'now' });
    expect(bucketFor(cpa(-30, 0.2), RULES)).toEqual({ kind: 'now' });
    expect(bucketFor(cpa(31, 0.2), RULES)).toMatchObject({ kind: 'soon', minutes: 1 });
    expect(bucketFor(cpa(10, 0.6), RULES)).toMatchObject({ kind: 'soon' });
  });

  it('In N min: approaching, within 1.5 mi, within 10 min', () => {
    expect(bucketFor(cpa(150, 1.5), RULES)).toMatchObject({ kind: 'soon', minutes: 3 });
    expect(bucketFor(cpa(600, 1), RULES)).toMatchObject({ kind: 'soon', minutes: 10 });
    expect(bucketFor(cpa(601, 1), RULES)).toBeNull();
    expect(bucketFor(cpa(120, 1.6), RULES)).toBeNull();
  });

  it('Just passed: 0 to 60 s after, then dropped', () => {
    expect(bucketFor(cpa(-31, 1), RULES)).toMatchObject({ kind: 'passed', secondsAgo: 31 });
    expect(bucketFor(cpa(-60, 1), RULES)).toMatchObject({ kind: 'passed' });
    expect(bucketFor(cpa(-61, 1), RULES)).toBeNull();
    expect(bucketFor(cpa(-10, 2), RULES)).toBeNull();
  });

  it('follows the settings', () => {
    const wide = { ...RULES, nowCpaMiles: 1, nowWindowSeconds: 60, soonCpaMiles: 3, soonWithinMinutes: 2, passedForSeconds: 10 };
    expect(bucketFor(cpa(55, 0.9), wide)).toEqual({ kind: 'now' });
    expect(bucketFor(cpa(150, 2), wide)).toBeNull();
    expect(bucketFor(cpa(-70, 2), wide)).toBeNull();
  });

  it('runs down as time passes, without the CPA being worked out again', () => {
    const coming = cpa(200, 0.3);
    expect(bucketFor(coming, RULES, 0)).toMatchObject({ kind: 'soon', minutes: 3 });
    expect(bucketFor(coming, RULES, 175)).toEqual({ kind: 'now' });
    expect(bucketFor(coming, RULES, 240)).toMatchObject({ kind: 'passed' });
    expect(bucketFor(coming, RULES, 261)).toBeNull();
  });
});

describe('the board', () => {
  const plane = (hex: string, t: number, miles: number, altitudeFt: number | null = 3000, onGround = false) => ({
    hex,
    onGround,
    altitudeFt,
    positionAt: 1_000_000,
    cpa: { timeToCpaSeconds: t, distanceMiles: miles, side: null },
  });

  it('lists Now first, then the soonest, then the most recently passed', () => {
    const list = board([plane('late', 400, 1), plane('gone', -20, 1), plane('now', 5, 0.1), plane('soon', 90, 1), plane('older', -50, 1)], RULES, 1_000_000);
    expect(list.map((entry) => entry.aircraft.hex)).toEqual(['now', 'soon', 'late', 'gone', 'older']);
  });

  it('lists only what flies at or below the ceiling', () => {
    const list = board([plane('low', 60, 0.1, 10_000), plane('high', 60, 0.1, 10_001), plane('taxi', 60, 0.1, null, true), plane('unknown', 60, 0.1, null)], RULES, 1_000_000);
    expect(list.map((entry) => entry.aircraft.hex)).toEqual(['low']);
  });

  it('counts the time since each position', () => {
    const list = board([plane('a', 100, 0.2)], RULES, 1_000_000 + 80_000);
    expect(list[0]?.bucket).toEqual({ kind: 'now' });
  });
});

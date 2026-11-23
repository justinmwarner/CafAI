import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readReadsbBody, readsbNowMs, type ReadsbAircraft } from './readsb.ts';

const dir = new URL('../../../fixtures/overhead/', import.meta.url);
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

/** Every provider fixture recorded in Wave 0 (docs/overhead/DISCOVERY.md, section 4). */
const POSITION_FIXTURES = readdirSync(dir).filter((name) => /^(adsbfi|adsblol|airplaneslive)-.*\.json$/.test(name));

describe('the providers’ answers, read with the derived types', () => {
  it('finds the recorded fixtures', () => {
    expect(POSITION_FIXTURES).toEqual(['adsbfi-point-ord.json', 'adsblol-point-ord.json', 'airplaneslive-point-ord-403.json']);
  });

  it.each(POSITION_FIXTURES.filter((name) => !name.includes('403')))('%s parses, every aircraft with the fields Overhead reads typed as declared', (name) => {
    const snapshot = readReadsbBody(load(name));
    expect(snapshot).not.toBeNull();
    const aircraft = snapshot?.aircraft ?? [];
    expect(aircraft.length).toBeGreaterThan(40);
    const typed = (plane: ReadsbAircraft) => {
      expect(typeof plane.hex).toBe('string');
      expect(plane.hex).toMatch(/^~?[0-9a-f]{6}$/);
      for (const field of ['flight', 'r', 't', 'desc', 'ownOp', 'category', 'squawk'] as const) {
        if (plane[field] !== undefined) expect(typeof plane[field]).toBe('string');
      }
      for (const field of ['gs', 'track', 'baro_rate', 'lat', 'lon', 'seen_pos', 'seen'] as const) {
        if (plane[field] !== undefined) expect(Number.isFinite(plane[field])).toBe(true);
      }
      if (plane.alt_baro !== undefined) expect(typeof plane.alt_baro === 'number' || plane.alt_baro === 'ground').toBe(true);
    };
    aircraft.forEach(typed);
    // What the fixtures showed and Overhead must cope with.
    expect(aircraft.some((plane) => plane.alt_baro === 'ground')).toBe(true);
    expect(aircraft.some((plane) => plane.alt_baro === 'ground' && plane.track === undefined)).toBe(true);
    expect(aircraft.some((plane) => plane.flight === undefined)).toBe(true);
    expect(aircraft.some((plane) => typeof plane.flight === 'string' && plane.flight.endsWith(' '))).toBe(true);
  });

  it('reads adsb.fi’s `now` in seconds and adsb.lol’s in milliseconds as the same clock', () => {
    const fi = readReadsbBody(load('adsbfi-point-ord.json'));
    const lol = readReadsbBody(load('adsblol-point-ord.json'));
    expect(fi?.nowMs).toBe(1795440148000);
    expect(lol?.nowMs).toBe(1795440150002);
    expect(Math.abs((fi?.nowMs ?? 0) - (lol?.nowMs ?? 0))).toBeLessThan(10_000);
  });

  it('adsb.fi alone names types and owners', () => {
    const fi = readReadsbBody(load('adsbfi-point-ord.json'))?.aircraft ?? [];
    const lol = readReadsbBody(load('adsblol-point-ord.json'))?.aircraft ?? [];
    expect(fi.find((plane) => plane.hex === 'a12ac7')?.desc).toBe('BOEING 737 MAX 9');
    expect(lol.some((plane) => plane.desc !== undefined || plane.ownOp !== undefined)).toBe(false);
  });

  it('reads airplanes.live’s refusal, and anything else that is not aircraft, as nothing', () => {
    expect(readReadsbBody(load('airplaneslive-point-ord-403.json'))).toBeNull();
    expect(readReadsbBody('<html>')).toBeNull();
    expect(readReadsbBody({ ac: 'none' })).toBeNull();
    expect(readReadsbBody(null)).toBeNull();
    expect(readReadsbBody({ ac: [{ hex: 'abc123' }, 7, null] })?.aircraft).toEqual([{ hex: 'abc123' }]);
  });

  it('ignores a `now` that is not a time', () => {
    expect(readsbNowMs('1795440148')).toBeNull();
    expect(readsbNowMs(-1)).toBeNull();
    expect(readsbNowMs(Number.NaN)).toBeNull();
  });
});

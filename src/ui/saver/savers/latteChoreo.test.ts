import { describe, expect, it } from 'vitest';
import { CHOREOGRAPHIES, createPitcherState, pitcherAt, type Choreography, type PourId } from './latteChoreo.ts';

const POURS = Object.values(CHOREOGRAPHIES);

/** The pitcher at `t`, a fresh state each time. */
function at(choreo: Choreography, t: number) {
  return pitcherAt(choreo, t, createPitcherState());
}

describe('the choreographies', () => {
  it('are the four pours, each named as it shows under the cup', () => {
    expect(Object.keys(CHOREOGRAPHIES).sort()).toEqual(['heart', 'rosetta', 'swan', 'tulip']);
    for (const [id, choreo] of Object.entries(CHOREOGRAPHIES)) expect(choreo.id).toBe(id as PourId);
    expect(POURS.map((choreo) => choreo.name).sort()).toEqual(['Heart', 'Rosetta', 'Swan', 'Tulip']);
  });

  it('are each a timeline from 0 to about 25 s, its keys in order, its last at the end', () => {
    for (const choreo of POURS) {
      const times = choreo.keys.map((key) => key.t);
      expect(times[0], choreo.id).toBe(0);
      expect(times[times.length - 1], choreo.id).toBe(choreo.duration);
      expect(choreo.duration, choreo.id).toBeGreaterThanOrEqual(22);
      expect(choreo.duration, choreo.id).toBeLessThanOrEqual(28);
      for (let i = 1; i < times.length; i += 1) expect(times[i]!, `${choreo.id} key ${i}`).toBeGreaterThan(times[i - 1]!);
    }
  });

  it('keep every key in bounds: on the coffee, height, flow and lean between 0 and 1, the wiggle never past the wall', () => {
    for (const choreo of POURS) {
      choreo.keys.forEach((key, i) => {
        const where = `${choreo.id} key ${i}`;
        expect(Math.hypot(key.x, key.y) + key.wiggle, where).toBeLessThan(0.95);
        for (const value of [key.height, key.flow, key.lean ?? 0]) {
          expect(value, where).toBeGreaterThanOrEqual(0);
          expect(value, where).toBeLessThanOrEqual(1);
        }
        expect(key.wiggle, where).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(key.heading ?? 0), where).toBe(true);
      });
    }
  });

  it('start with no milk, pour the base from high, come down for the foam, and end with the milk stopped', () => {
    for (const choreo of POURS) {
      const first = choreo.keys[0]!;
      const last = choreo.keys[choreo.keys.length - 1]!;
      expect(first.flow, choreo.id).toBe(0);
      expect(last.flow, choreo.id).toBe(0);
      // The base: high, with milk, for the first few seconds.
      const base = at(choreo, 3);
      expect(base.height, choreo.id).toBe(1);
      expect(base.flow, choreo.id).toBeGreaterThan(0.5);
      // Somewhere, low and flowing: the foam comes up.
      const low = choreo.keys.some((key) => key.height <= 0.1 && key.flow >= 0.5);
      expect(low, choreo.id).toBe(true);
    }
  });

  it('finish with a pull-through: the pitcher lifted a little, a thin stream drawn on across the cup', () => {
    for (const id of ['heart', 'tulip', 'rosetta'] as const) {
      const choreo = CHOREOGRAPHIES[id];
      const pulls = choreo.keys.filter((key) => key.height > 0.4 && key.height < 0.7 && key.flow > 0 && key.flow < 0.5);
      const ys = pulls.map((key) => key.y);
      // From behind the middle to well in front of it, down the middle.
      expect(Math.min(...ys), id).toBeLessThan(-0.6);
      expect(Math.max(...ys), id).toBeGreaterThan(0.6);
      for (const key of pulls) expect(key.x, id).toBe(0);
    }
  });

  it('pour the tulip as discs one behind the other, and the rosetta and the swan wiggling as they draw back', () => {
    const discs = CHOREOGRAPHIES.tulip.keys.filter((key) => key.height <= 0.1 && key.flow >= 0.5);
    const places = [...new Set(discs.map((key) => key.y))];
    expect(places.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < places.length; i += 1) expect(places[i]!).toBeLessThan(places[i - 1]!);
    for (const id of ['rosetta', 'swan'] as const) {
      const choreo = CHOREOGRAPHIES[id];
      expect(choreo.wiggleRate, id).toBeGreaterThan(0.5);
      expect(choreo.keys.some((key) => key.wiggle > 0.05 && key.height <= 0.1), id).toBe(true);
    }
  });
});

describe('pitcherAt', () => {
  it('is each key at its moment, and the first and the last before and after them', () => {
    const choreo = CHOREOGRAPHIES.heart;
    for (const key of choreo.keys) {
      const state = at(choreo, key.t);
      expect(state.x).toBeCloseTo(key.x, 9);
      expect(state.y).toBeCloseTo(key.y, 9);
      expect(state.height).toBeCloseTo(key.height, 9);
      expect(state.flow).toBeCloseTo(key.flow, 9);
    }
    expect(at(choreo, -5)).toEqual(at(choreo, 0));
    expect(at(choreo, choreo.duration + 50)).toEqual(at(choreo, choreo.duration));
  });

  it('eases between two keys: halfway in time is halfway there, a quarter in is less than a quarter there', () => {
    const choreo: Choreography = {
      id: 'heart',
      name: 'Test',
      duration: 2,
      wiggleRate: 0,
      keys: [
        { t: 0, x: 0, y: -0.5, height: 1, flow: 0, wiggle: 0 },
        { t: 2, x: 0, y: 0.5, height: 0, flow: 1, wiggle: 0 },
      ],
    };
    expect(at(choreo, 1).y).toBeCloseTo(0, 9);
    expect(at(choreo, 0.5).y).toBeLessThan(-0.25);
    // At an even pace, a quarter in is a quarter there.
    const even: Choreography = { ...choreo, keys: [choreo.keys[0]!, { ...choreo.keys[1]!, pace: 'even' }] };
    expect(at(even, 0.5).y).toBeCloseTo(-0.25, 9);
  });

  it('wiggles side to side, across the way the stream pushes, at the pour’s rate', () => {
    const choreo: Choreography = {
      id: 'rosetta',
      name: 'Test',
      duration: 4,
      wiggleRate: 1,
      keys: [
        { t: 0, x: 0, y: 0, height: 0, flow: 1, wiggle: 0.1 },
        { t: 4, x: 0, y: 0, height: 0, flow: 1, wiggle: 0.1 },
      ],
    };
    // A quarter of a wiggle in, it is all the way to one side; three quarters in, the other.
    expect(at(choreo, 0.25).x).toBeCloseTo(0.1, 9);
    expect(at(choreo, 0.75).x).toBeCloseTo(-0.1, 9);
    expect(at(choreo, 0.25).y).toBeCloseTo(0, 9);
    // Pushing to the right instead, it wiggles up and down the screen.
    const turned: Choreography = { ...choreo, keys: choreo.keys.map((key) => ({ ...key, heading: Math.PI / 2 })) };
    expect(at(turned, 0.25).x).toBeCloseTo(0, 9);
    expect(Math.abs(at(turned, 0.25).y)).toBeCloseTo(0.1, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import { CHOREOGRAPHIES, type Choreography, type PitcherKey } from './latteChoreo.ts';
import {
  ADMIRE_S,
  advanceLatte,
  cellAt,
  cellCentre,
  CLEAR_S,
  createLatteModel,
  createSurface,
  cremaPainter,
  FIELD_HZ,
  GRID,
  insideCup,
  IN_ROTATION,
  pourWhole,
  startPour,
  TONE_GRID,
  type LatteSurface,
} from './latteModel.ts';

const FRAME_MS = 1000 / 30;

/** The foam at a point of the surface. */
function foamAt(surface: LatteSurface, x: number, y: number): number {
  return surface.foam[cellAt(x, y)]!;
}

/** How much of the coffee is white (cells at 0.5 or more). */
function whiteCells(surface: LatteSurface): number {
  let count = 0;
  for (const value of surface.foam) if (value >= 0.5) count += 1;
  return count;
}

/** The pours' fields at moments through them: every value a number, between 0 and 1, the foam only on the coffee. */
function checkBounds(surface: LatteSurface, where: string): void {
  surface.foam.forEach((value, index) => {
    if (!(value >= 0 && value <= 1)) throw new Error(`${where}: foam ${value} at ${index}`);
    if (!insideCup(index) && value !== 0) throw new Error(`${where}: foam ${value} outside the cup at ${index}`);
  });
  for (const value of surface.tone) if (!(value >= 0 && value <= 1)) throw new Error(`${where}: tone ${value}`);
}

/** A pour of the test's own: a key at each moment given, the rest as the first key says. */
function pourOf(keys: PitcherKey[]): Choreography {
  return { id: 'heart', name: 'Test', duration: keys[keys.length - 1]!.t, wiggleRate: 0, keys };
}

function pour(choreo: Choreography, seconds: number, surface = createSurface()): LatteSurface {
  const pouring = startPour(surface, choreo);
  for (let i = 0; i < Math.round(seconds * FIELD_HZ); i += 1) pouring.advance();
  return surface;
}

describe('the surface', () => {
  it('keeps the foam in the cup and every value between 0 and 1, whatever is poured', () => {
    for (const choreo of Object.values(CHOREOGRAPHIES)) {
      const surface = createSurface();
      cremaPainter(createRandom(3)).paint(surface.tone, TONE_GRID);
      const pouring = startPour(surface, choreo);
      const steps = Math.round(choreo.duration * FIELD_HZ);
      for (let i = 1; i <= steps; i += 1) {
        pouring.advance();
        if (i % 15 === 0) checkBounds(surface, `${choreo.id} at ${i} steps`);
      }
      checkBounds(surface, `${choreo.id} poured`);
      expect(whiteCells(surface), choreo.id).toBeGreaterThan(1500);
    }
  });

  it('grows a white disc where a low stream pours, round and about where it lands', () => {
    const keys: PitcherKey[] = [
      { t: 0, x: 0.2, y: -0.1, height: 0.05, flow: 0.9, wiggle: 0 },
      { t: 12, x: 0.2, y: -0.1, height: 0.05, flow: 0.9, wiggle: 0 },
    ];
    const surface = createSurface();
    const pouring = startPour(surface, pourOf(keys));
    const sizes: number[] = [];
    for (let second = 1; second <= 12; second += 1) {
      for (let i = 0; i < FIELD_HZ; i += 1) pouring.advance();
      sizes.push(whiteCells(surface));
    }
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
    // After 12 s, about the area the source pushes out (0.11 a second at this flow, of the cup's π).
    const share = sizes[sizes.length - 1]! / (Math.PI * (GRID / 2) ** 2);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.5);
    // Round, and centred where the stream lands.
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    surface.foam.forEach((value, index) => {
      if (value < 0.5) return;
      sumX += cellCentre(index % GRID);
      sumY += cellCentre(Math.floor(index / GRID));
      count += 1;
    });
    expect(sumX / count).toBeCloseTo(0.2, 1);
    expect(sumY / count).toBeCloseTo(-0.1, 1);
    const radius = Math.sqrt(share);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      expect(foamAt(surface, 0.2 + 0.85 * radius * Math.cos(angle), -0.1 + 0.85 * radius * Math.sin(angle))).toBeGreaterThan(0.5);
      expect(foamAt(surface, 0.2 + 1.2 * radius * Math.cos(angle), -0.1 + 1.2 * radius * Math.sin(angle))).toBeLessThan(0.5);
    }
  });

  it('lays no foam from high, where the milk dives under, and lays it ahead of the stream when it leans', () => {
    const high = pour(
      pourOf([
        { t: 0, x: 0, y: 0, height: 1, flow: 0.9, wiggle: 0 },
        { t: 8, x: 0, y: 0, height: 1, flow: 0.9, wiggle: 0 },
      ]),
      8,
    );
    expect(whiteCells(high)).toBe(0);
    const leaning = pour(
      pourOf([
        { t: 0, x: 0, y: 0, height: 0.05, flow: 0.9, wiggle: 0, lean: 0.9 },
        { t: 6, x: 0, y: 0, height: 0.05, flow: 0.9, wiggle: 0, lean: 0.9 },
      ]),
      6,
    );
    // More of it in front (down the screen) than behind.
    let ahead = 0;
    let behind = 0;
    leaning.foam.forEach((value, index) => {
      if (value < 0.5) return;
      if (cellCentre(Math.floor(index / GRID)) > 0) ahead += 1;
      else behind += 1;
    });
    expect(ahead).toBeGreaterThan(2 * behind);
  });

  it('pours a heart: white down the middle below the centre, a cleft at the top, a point at the bottom, left and right alike', () => {
    const surface = pourWhole(CHOREOGRAPHIES.heart, 1);
    // Down the middle, below the centre (past the thin line the pull-through leaves under the cleft): white, to the point.
    for (const y of [0.15, 0.3, 0.45, 0.6]) expect(foamAt(surface, 0, y), `y ${y}`).toBeGreaterThan(0.5);
    // The cleft: crema on the middle line at the top, between the two lobes.
    expect(foamAt(surface, 0, -0.5)).toBeLessThan(0.5);
    expect(foamAt(surface, -0.28, -0.45)).toBeGreaterThan(0.5);
    expect(foamAt(surface, 0.28, -0.45)).toBeGreaterThan(0.5);
    // The point: narrower toward the bottom.
    const width = (y: number) => {
      let cells = 0;
      for (let x = -0.99; x < 1; x += 2 / GRID) if (foamAt(surface, x, y) >= 0.5) cells += 1;
      return cells;
    };
    expect(width(0.55)).toBeLessThan(width(0.25) * 0.6);
    expect(width(0.25)).toBeLessThan(width(-0.2));
    // Left and right alike.
    let off = 0;
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) off += Math.abs(surface.foam[row * GRID + col]! - surface.foam[row * GRID + (GRID - 1 - col)]!);
    }
    expect(off / (GRID * GRID)).toBeLessThan(0.002);
  });

  it('pours a tulip: layers one above the other down the middle, a heart on top', () => {
    const surface = pourWhole(CHOREOGRAPHIES.tulip, 1);
    // Off the middle line, crossing the layers from the top: white and crema, again and again.
    let layers = 0;
    let was = false;
    for (let y = -0.95; y < 0.95; y += 0.005) {
      const white = foamAt(surface, 0.18, y) >= 0.5;
      if (white && !was) layers += 1;
      was = white;
    }
    expect(layers).toBeGreaterThanOrEqual(3);
    expect(foamAt(surface, 0, -0.62)).toBeGreaterThan(0.5);
  });

  it('pours a rosetta: many thin leaves, one above another, either side of a stem', () => {
    const surface = pourWhole(CHOREOGRAPHIES.rosetta, 1);
    for (const x of [-0.18, 0.18]) {
      let leaves = 0;
      let was = false;
      for (let y = -0.95; y < 0.95; y += 0.004) {
        const white = foamAt(surface, x, y) >= 0.5;
        if (white && !was) leaves += 1;
        was = white;
      }
      expect(leaves, `x ${x}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('pours a swan: a wing of leaves to the right, a thin neck to the left of it, a head at the top', () => {
    const surface = pourWhole(CHOREOGRAPHIES.swan, 1);
    const runs = (y: number, fromX: number, toX: number) => {
      let count = 0;
      let cells = 0;
      let was = false;
      for (let x = fromX; x < toX; x += 2 / GRID) {
        const white = foamAt(surface, x, y) >= 0.5;
        if (white && !was) count += 1;
        if (white) cells += 1;
        was = white;
      }
      return { count, cells };
    };
    // The wing: leaf after leaf across it.
    expect(runs(0.1, 0, 0.6).count).toBeGreaterThanOrEqual(4);
    // The neck: one thin line, crema either side.
    const neck = runs(0, -0.45, -0.08);
    expect(neck.count).toBe(1);
    expect(neck.cells).toBeLessThanOrEqual(6);
    // The head, up on the left, and nothing above the wing on the right.
    expect(foamAt(surface, -0.35, -0.45)).toBeGreaterThan(0.5);
    expect(foamAt(surface, 0.5, -0.5)).toBeLessThan(0.5);
  });
});

describe('createLatteModel', () => {
  it('moves on in fixed steps, 15 a second, so one long step is as good as many short ones', () => {
    const one = createLatteModel(4);
    const many = createLatteModel(4);
    one.step(5000);
    for (let i = 0; i < 150; i += 1) many.step(FRAME_MS);
    expect(one.time).toBeCloseTo(5, 9);
    expect(many.time).toBeCloseTo(5, 9);
    expect(Array.from(one.surface.foam)).toEqual(Array.from(many.surface.foam));
    expect(Array.from(one.surface.tone)).toEqual(Array.from(many.surface.tone));
  });

  it('is the same picture for the same seed and the same steps, and another crema for another seed', () => {
    const a = createLatteModel(5);
    const b = createLatteModel(5);
    const c = createLatteModel(6);
    for (const model of [a, b, c]) advanceLatte(model, 22_000);
    expect(Array.from(a.surface.foam)).toEqual(Array.from(b.surface.foam));
    expect(Array.from(a.surface.tone)).toEqual(Array.from(b.surface.tone));
    expect(Array.from(a.surface.tone)).not.toEqual(Array.from(c.surface.tone));
  });

  it('takes any step, however enormous or odd, without hanging or going wrong', () => {
    const model = createLatteModel(1);
    model.step(Number.MAX_VALUE);
    model.step(Infinity);
    model.step(Number.NaN);
    model.step(-30);
    model.step(0);
    // Two steps, each held to ten seconds; the odd ones did nothing.
    expect(model.time).toBeCloseTo(20, 6);
    checkBounds(model.surface, 'after odd steps');
  });

  it('pours each in turn: about 25 s pouring, 12 s to admire, then the cup clears to fresh crema for the next', () => {
    const model = createLatteModel(2);
    expect(model.phase).toBe('pour');
    expect(model.choreo.id).toBe(IN_ROTATION[0]);
    const seen: string[] = [];
    let last = '';
    for (let i = 0; i < 30 * 170; i += 1) {
      model.step(FRAME_MS);
      const now = `${model.choreo.id} ${model.phase}`;
      if (now !== last) seen.push(now);
      last = now;
    }
    const expected = IN_ROTATION.flatMap((id) => [`${id} pour`, `${id} admire`, `${id} clear`]);
    expect(seen.slice(0, expected.length)).toEqual(expected);
    expect(seen[expected.length]).toBe(`${IN_ROTATION[0]} pour`);
  });

  it('flows only while it pours, holds the pour still while it is admired, and clears it away', () => {
    const model = createLatteModel(3);
    advanceLatte(model, CHOREOGRAPHIES.heart.duration * 1000 + 2000);
    expect(model.phase).toBe('admire');
    expect(model.pitcher.flow).toBe(0);
    expect(model.foamShown).toBe(1);
    const admired = Array.from(model.surface.foam);
    const version = model.version;
    advanceLatte(model, (ADMIRE_S - 4) * 1000);
    expect(Array.from(model.surface.foam)).toEqual(admired);
    expect(model.version).toBe(version);
    advanceLatte(model, 3500);
    expect(model.phase).toBe('clear');
    expect(model.version).toBeGreaterThan(version);
    expect(model.foamShown).toBeGreaterThan(0);
    expect(model.foamShown).toBeLessThan(1);
    advanceLatte(model, CLEAR_S * 1000);
    expect(model.phase).toBe('pour');
    expect(model.choreo.id).toBe('tulip');
    expect(whiteCells(model.surface)).toBe(0);
    expect(model.foamShown).toBe(1);
  });

  it('keeps to the pours it is given', () => {
    const model = createLatteModel(1, ['tulip']);
    expect(model.choreo.id).toBe('tulip');
    advanceLatte(model, (CHOREOGRAPHIES.tulip.duration + ADMIRE_S + CLEAR_S + 1) * 1000);
    expect(model.choreo.id).toBe('tulip');
    expect(createLatteModel(1, []).choreo.id).toBe(IN_ROTATION[0]);
  });
});

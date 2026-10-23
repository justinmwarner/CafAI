import { describe, expect, it } from 'vitest';
import {
  advanceLava,
  CELL,
  createLavaModel,
  FLOOR,
  GRID_COLS,
  GRID_LEFT,
  GRID_ROWS,
  GRID_TOP,
  innerHalfWidth,
  ISO,
  MAX_BLOBS,
  MIN_BLOBS,
  SURFACE,
  type LavaModel,
} from './lavaModel.ts';

const FRAME_MS = 1000 / 30;

function fieldOf(model: LavaModel): Float32Array {
  const out = new Float32Array(GRID_COLS * GRID_ROWS);
  model.field(out);
  return out;
}

/** How many separate pieces of cream the field makes (4-connected cells at or above ISO). */
function pieces(field: Float32Array): number {
  const seen = new Uint8Array(field.length);
  let count = 0;
  for (let start = 0; start < field.length; start += 1) {
    if (seen[start] || field[start]! < ISO) continue;
    count += 1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop()!;
      const col = at % GRID_COLS;
      const row = (at - col) / GRID_COLS;
      const next = [col > 0 ? at - 1 : -1, col < GRID_COLS - 1 ? at + 1 : -1, row > 0 ? at - GRID_COLS : -1, row < GRID_ROWS - 1 ? at + GRID_COLS : -1];
      for (const cell of next) {
        if (cell >= 0 && !seen[cell] && field[cell]! >= ISO) {
          seen[cell] = 1;
          stack.push(cell);
        }
      }
    }
  }
  return count;
}

/** The field's value at a point of the glass. */
function valueAt(field: Float32Array, x: number, y: number): number {
  return field[Math.floor((GRID_TOP - y) / CELL) * GRID_COLS + Math.floor((x - GRID_LEFT) / CELL)]!;
}

function snapshot(model: LavaModel) {
  return { blobs: model.blobs.map((blob) => ({ ...blob })), field: Array.from(fieldOf(model)) };
}

describe('createLavaModel', () => {
  it('has seven to nine blobs, as the seed says', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const count = createLavaModel(seed).blobs.length;
      expect(count).toBeGreaterThanOrEqual(MIN_BLOBS);
      expect(count).toBeLessThanOrEqual(MAX_BLOBS);
      counts.add(count);
    }
    expect([...counts].sort()).toEqual([7, 8, 9]);
  });

  it('is the same picture for the same seed and the same steps, and another for another seed', () => {
    const a = createLavaModel(5);
    const b = createLavaModel(5);
    const c = createLavaModel(6);
    for (const model of [a, b, c]) advanceLava(model, 20_000);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a).field).not.toEqual(snapshot(c).field);
  });

  it('steps in pieces of 50 ms at most, so one long step is as good as many short ones', () => {
    const one = createLavaModel(2);
    const many = createLavaModel(2);
    one.step(5000);
    for (let i = 0; i < 100; i += 1) many.step(50);
    expect(snapshot(one)).toEqual(snapshot(many));
    const before = snapshot(one);
    one.step(0);
    one.step(-30);
    expect(snapshot(one)).toEqual(before);
  });

  it('takes any step, however enormous or odd, without hanging or going wrong', () => {
    const model = createLavaModel(1);
    model.step(Number.MAX_VALUE);
    model.step(Infinity);
    model.step(Number.NaN);
    // Two steps, each held to ten seconds; the odd one did nothing.
    expect(model.time).toBeCloseTo(20, 6);
    expect(model.blobs.every((blob) => Number.isFinite(blob.x) && Number.isFinite(blob.y))).toBe(true);
  });

  it('keeps every blob inside the glass, away from its walls, its floor and the surface', () => {
    let outside = 0;
    for (const seed of [1, 2, 3]) {
      const model = createLavaModel(seed);
      for (let i = 0; i < 30 * 240; i += 1) {
        model.step(FRAME_MS);
        for (const blob of model.blobs) {
          const inside =
            blob.y - 0.65 * blob.r >= FLOOR &&
            blob.y + 0.75 * blob.r <= SURFACE &&
            Math.abs(blob.x) + 0.65 * blob.r <= innerHalfWidth(blob.y);
          if (!inside) outside += 1;
        }
      }
    }
    expect(outside).toBe(0);
  });

  it('goes at about 15 px a second where it is on the move, never much faster', () => {
    let sum = 0;
    let count = 0;
    let fastest = 0;
    for (const seed of [1, 2, 3, 4]) {
      const model = createLavaModel(seed);
      for (let i = 0; i < 30 * 240; i += 1) {
        model.step(FRAME_MS);
        for (const blob of model.blobs) {
          const height = (blob.y - FLOOR) / (SURFACE - FLOOR);
          fastest = Math.max(fastest, Math.abs(blob.vy));
          if (height > 0.3 && height < 0.6) {
            sum += Math.abs(blob.vy);
            count += 1;
          }
        }
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(sum / count).toBeGreaterThan(12);
    expect(sum / count).toBeLessThan(18);
    expect(fastest).toBeLessThan(26);
  });

  it('rises when it is warm and sinks when it is cool, warmed at the bottom and cooled at the top', () => {
    const model = createLavaModel(3);
    const blob = model.blobs[0]!;
    // Cold on the floor: it warms there, and comes up.
    blob.y = FLOOR + 0.7 * blob.r;
    blob.vy = 0;
    blob.heat = 0;
    const lowStart = blob.y;
    advanceLava(model, 40_000);
    const rose = Math.max(blob.y - lowStart, 0);
    expect(rose).toBeGreaterThan(60);

    // Warm at the top: it cools there, and goes down.
    blob.y = SURFACE - 0.8 * blob.r;
    blob.vy = 0;
    blob.heat = 1;
    const highStart = blob.y;
    let lowest = blob.y;
    for (let i = 0; i < 30 * 40; i += 1) {
      model.step(FRAME_MS);
      lowest = Math.min(lowest, blob.y);
    }
    expect(highStart - lowest).toBeGreaterThan(60);
  });

  it('sends every blob up and down the glass again and again', () => {
    const model = createLavaModel(4);
    const rose = new Set<number>();
    const sank = new Set<number>();
    const top = new Set<number>();
    const bottom = new Set<number>();
    for (let i = 0; i < 30 * 300; i += 1) {
      model.step(FRAME_MS);
      model.blobs.forEach((blob, index) => {
        const height = (blob.y - FLOOR) / (SURFACE - FLOOR);
        if (blob.vy > 5) rose.add(index);
        if (blob.vy < -5) sank.add(index);
        if (height > 0.8) top.add(index);
        if (height < 0.2) bottom.add(index);
      });
    }
    const all = model.blobs.length;
    expect(rose.size).toBe(all);
    expect(sank.size).toBe(all);
    expect(top.size).toBe(all);
    expect(bottom.size).toBe(all);
  });

  it('wobbles sideways: no blob keeps to one line', () => {
    const model = createLavaModel(2);
    const lows = model.blobs.map(() => Infinity);
    const highs = model.blobs.map(() => -Infinity);
    for (let i = 0; i < 30 * 120; i += 1) {
      model.step(FRAME_MS);
      model.blobs.forEach((blob, index) => {
        lows[index] = Math.min(lows[index]!, blob.x);
        highs[index] = Math.max(highs[index]!, blob.x);
      });
    }
    model.blobs.forEach((_, index) => expect(highs[index]! - lows[index]!).toBeGreaterThan(15));
  });
});

describe('the field', () => {
  it('is cream where blobs are and not a flood, and never a number that is not one', () => {
    const model = createLavaModel(1);
    let wrong = 0;
    let least = 1;
    let most = 0;
    for (let i = 0; i < 30 * 180; i += 1) {
      model.step(FRAME_MS);
      if (i % 30 !== 0) continue;
      const field = fieldOf(model);
      let cream = 0;
      for (const value of field) {
        if (!Number.isFinite(value) || value < 0) wrong += 1;
        if (value >= ISO) cream += 1;
      }
      const share = cream / field.length;
      least = Math.min(least, share);
      most = Math.max(most, share);
    }
    expect(wrong).toBe(0);
    expect(least).toBeGreaterThan(0.08);
    expect(most).toBeLessThan(0.4);
  });

  it('has a lone blob round at its radius, where the field crosses ISO', () => {
    const model = createLavaModel(7);
    // Every blob out of the way, up in the glass, but one in the middle.
    model.blobs.forEach((blob, index) => {
      blob.x = (index % 2 === 0 ? -1 : 1) * 40;
      blob.y = SURFACE - 30 - Math.floor(index / 2) * 5;
      blob.r = 4;
    });
    const blob = model.blobs[0]!;
    blob.x = 0;
    blob.y = 200;
    blob.r = 24;
    blob.stretch = 1;
    const field = fieldOf(model);
    expect(valueAt(field, 0, 200)).toBeGreaterThan(0.95);
    expect(valueAt(field, 20, 200)).toBeGreaterThan(ISO);
    expect(valueAt(field, 30, 200)).toBeLessThan(ISO);
    expect(valueAt(field, 0, 200 + 20)).toBeGreaterThan(ISO);
    expect(valueAt(field, 0, 200 + 30)).toBeLessThan(ISO);
  });

  it('merges blobs that meet and splits those that part', () => {
    const model = createLavaModel(2);
    const counts: number[] = [];
    let changes = 0;
    for (let i = 0; i < 30 * 240; i += 1) {
      model.step(FRAME_MS);
      if (i % 30 !== 0) continue;
      const count = pieces(fieldOf(model));
      if (counts.length > 0 && count !== counts[counts.length - 1]) changes += 1;
      counts.push(count);
    }
    expect(new Set(counts).size).toBeGreaterThanOrEqual(4);
    expect(changes).toBeGreaterThanOrEqual(20);
  });

  it('has a pool of cream on the floor, thin and flat, that the blobs sink into and rise from', () => {
    const model = createLavaModel(7);
    // Every blob up in the glass and well apart.
    model.blobs.forEach((blob, index) => {
      blob.x = (index % 2 === 0 ? -1 : 1) * 45;
      blob.y = SURFACE - 40 - Math.floor(index / 2) * 6;
      blob.r = 4;
    });
    const field = fieldOf(model);
    for (const x of [-50, 0, 50]) {
      expect(valueAt(field, x, FLOOR + 6)).toBeGreaterThan(ISO);
      expect(valueAt(field, x, FLOOR + 60)).toBeLessThan(ISO);
    }
  });
});

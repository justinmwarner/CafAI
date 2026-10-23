import { describe, expect, it } from 'vitest';
import { advanceSteam, COLS, CELL, createSteamModel, LEFT, lifeEnvelope, MAX_LIFE, MIN_LIFE, PARTICLES, RISE_SPEED, ROWS, STRANDS, TOP, type SteamModel } from './steamModel.ts';

function total(model: SteamModel): number {
  let sum = 0;
  for (const value of model.density) sum += value;
  return sum;
}

function snapshot(model: SteamModel) {
  return { x: Array.from(model.x), y: Array.from(model.y), age: Array.from(model.age), density: Array.from(model.density) };
}

describe('createSteamModel', () => {
  it('has a few hundred particles, in strands', () => {
    const model = createSteamModel(1);
    expect(model.count).toBe(PARTICLES);
    expect(PARTICLES).toBeGreaterThanOrEqual(200);
    expect(PARTICLES).toBeLessThanOrEqual(500);
    expect(new Set(Array.from(model.strand)).size).toBe(STRANDS);
  });

  it('is the same picture for the same seed and the same steps, and another for another seed', () => {
    const a = createSteamModel(7);
    const b = createSteamModel(7);
    const c = createSteamModel(8);
    for (const model of [a, b, c]) advanceSteam(model, 9000);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a).density).not.toEqual(snapshot(c).density);
  });

  it('steps in pieces of 50 ms at most, so one long step is as good as many short ones', () => {
    const one = createSteamModel(2);
    const many = createSteamModel(2);
    one.step(5000);
    for (let i = 0; i < 100; i += 1) many.step(50);
    expect(snapshot(one)).toEqual(snapshot(many));
    const before = snapshot(one);
    one.step(0);
    one.step(-40);
    expect(snapshot(one)).toEqual(before);
  });

  it('takes any step, however enormous or odd, without hanging or going wrong', () => {
    const model = createSteamModel(1);
    model.step(Number.MAX_VALUE);
    model.step(Infinity);
    model.step(Number.NaN);
    // Two steps, each held to ten seconds; the odd one did nothing.
    expect(model.time).toBeCloseTo(20, 6);
    expect(Array.from(model.density).every(Number.isFinite)).toBe(true);
  });

  it('starts from nothing and has built its trails by 12 s', () => {
    const model = createSteamModel(1);
    expect(total(model)).toBe(0);
    advanceSteam(model, 1000);
    const early = total(model);
    advanceSteam(model, 11_000);
    expect(early).toBeGreaterThan(0);
    expect(total(model)).toBeGreaterThan(early * 5);
  });

  it('gives each particle 6 to 10 s of life, as often as it is born again', () => {
    const model = createSteamModel(3);
    const lives = new Set<number>();
    for (let i = 0; i < 30 * 30; i += 1) {
      model.step(1000 / 30);
      for (let p = 0; p < model.count; p += 1) lives.add(model.life[p]!);
    }
    // 340 first lives and a good many born again in 30 s.
    expect(lives.size).toBeGreaterThan(PARTICLES * 2);
    expect(Math.min(...lives)).toBeGreaterThanOrEqual(MIN_LIFE);
    expect(Math.max(...lives)).toBeLessThanOrEqual(MAX_LIFE);
  });

  it('keeps every particle on screen: inside the buffer, above the rim', () => {
    let outside = 0;
    let seen = 0;
    for (const seed of [1, 2]) {
      const model = createSteamModel(seed);
      for (let i = 0; i < 30 * 30; i += 1) {
        model.step(1000 / 30);
        for (let p = 0; p < model.count; p += 1) {
          if (model.born[p] === 0) continue;
          seen += 1;
          if (model.x[p]! <= LEFT || model.x[p]! >= -LEFT || model.y[p]! < 0 || model.y[p]! > TOP) outside += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(30_000);
    expect(outside).toBe(0);
  });

  it('rises at about 35 px a second on average', () => {
    const model = createSteamModel(4);
    advanceSteam(model, 12_000);
    let distance = 0;
    let seconds = 0;
    const dt = 1000 / 30;
    for (let i = 0; i < 30 * 25; i += 1) {
      const before = Float64Array.from(model.y);
      const lived = Float64Array.from(model.age);
      model.step(dt);
      for (let p = 0; p < model.count; p += 1) {
        // A particle born again this step jumped back to the rim: not a rise.
        if (model.age[p]! < lived[p]!) continue;
        distance += model.y[p]! - before[p]!;
        seconds += dt / 1000;
      }
    }
    expect(RISE_SPEED).toBe(35);
    const speed = distance / seconds;
    expect(speed).toBeGreaterThan(30);
    expect(speed).toBeLessThan(40);
  });

  it('rises as a plume: tall, narrow, and fading out at the top, not a wall', () => {
    const model = createSteamModel(1);
    advanceSteam(model, 12_000);
    const rowsWithSteam: number[] = [];
    let mass = 0;
    let weightedX = 0;
    for (let row = 0; row < ROWS; row += 1) {
      let rowTotal = 0;
      for (let col = 0; col < COLS; col += 1) {
        const value = model.density[row * COLS + col]!;
        rowTotal += value;
        mass += value;
        weightedX += value * (LEFT + (col + 0.5) * CELL);
      }
      if (rowTotal > 0.02) rowsWithSteam.push(TOP - (row + 0.5) * CELL);
    }
    // From the rim to well over 200 units above it, and not through the top of the buffer.
    expect(Math.min(...rowsWithSteam)).toBeLessThan(40);
    expect(Math.max(...rowsWithSteam)).toBeGreaterThan(200);
    expect(Math.max(...rowsWithSteam)).toBeLessThan(TOP - 20);
    // About over the cup, never piled against a side.
    expect(Math.abs(weightedX / mass)).toBeLessThan(70);
  });

  it('keeps density a real number, never huge, and clear of the page around the plume', () => {
    const model = createSteamModel(5);
    advanceSteam(model, 30_000);
    let largest = 0;
    let finite = true;
    let busy = 0;
    for (const value of model.density) {
      if (!Number.isFinite(value)) finite = false;
      if (value > 0.01) busy += 1;
      largest = Math.max(largest, value);
    }
    expect(finite).toBe(true);
    expect(largest).toBeGreaterThan(0.05);
    expect(largest).toBeLessThan(2.4);
    // A plume, not a haze: well under half the buffer has steam in it that could be seen.
    expect(busy).toBeGreaterThan(COLS * ROWS * 0.02);
    expect(busy).toBeLessThan(COLS * ROWS * 0.3);
  });

  it('fades exactly to nothing once no more steam comes: the page is left clean', () => {
    const model = createSteamModel(5);
    advanceSteam(model, 15_000);
    expect(total(model)).toBeGreaterThan(1);
    // The cup goes cold: nothing is born again.
    for (let p = 0; p < model.count; p += 1) {
      model.born[p] = 0;
      model.age[p] = -1e9;
    }
    advanceSteam(model, 20_000);
    expect(total(model)).toBe(0);
  });

  it('lays down about as much steam however long the steps are', () => {
    const totals = [1000 / 60, 1000 / 30, 100].map((stepMs) => {
      const model = createSteamModel(6);
      advanceSteam(model, 14_000, stepMs);
      return total(model);
    });
    const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    for (const value of totals) expect(Math.abs(value - mean) / mean).toBeLessThan(0.2);
  });
});

describe('lifeEnvelope', () => {
  it('fades in, holds, and fades out', () => {
    expect(lifeEnvelope(0)).toBe(0);
    expect(lifeEnvelope(1)).toBe(0);
    expect(lifeEnvelope(0.04)).toBeGreaterThan(0);
    expect(lifeEnvelope(0.04)).toBeLessThan(1);
    expect(lifeEnvelope(0.2)).toBe(1);
    expect(lifeEnvelope(0.5)).toBe(1);
    expect(lifeEnvelope(0.75)).toBeGreaterThan(0);
    expect(lifeEnvelope(0.75)).toBeLessThan(1);
    expect(lifeEnvelope(0.95)).toBeLessThan(lifeEnvelope(0.75));
  });
});

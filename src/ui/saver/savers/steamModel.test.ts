import { describe, expect, it } from 'vitest';
import {
  advanceSteam,
  backlight,
  CELL,
  coffeeSpan,
  COFFEE_DROP,
  COFFEE_HALF_WIDTH,
  COLS,
  createSteamModel,
  DRIFT_X,
  DRIFT_Y,
  GLOW_X,
  GLOW_Y,
  HAZE_CELL,
  HAZE_COLS,
  HAZE_ROWS,
  LEFT,
  lifeEnvelope,
  MAX_LIFE,
  MIN_LIFE,
  MOUTH_HALF_WIDTH,
  PARTICLES,
  RISE_SPEED,
  sceneDrift,
  ROWS,
  STRANDS,
  TOP,
  VIEW_COS,
  VIEW_SIN,
  type SteamModel,
} from './steamModel.ts';

function sum(values: Float32Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function total(model: SteamModel): number {
  return sum(model.density);
}

function snapshot(model: SteamModel) {
  return { x: Array.from(model.x), y: Array.from(model.y), age: Array.from(model.age), density: Array.from(model.density), haze: Array.from(model.haze) };
}

/** How far across a buffer's mass spreads: the standard deviation of x, weighted by density. */
function spreadAcross(values: Float32Array, cols: number, rows: number, cell: number, fromRow = 0, toRow = rows): number {
  let mass = 0;
  let first = 0;
  let second = 0;
  for (let row = fromRow; row < toRow; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = values[row * cols + col]!;
      const x = LEFT + (col + 0.5) * cell;
      mass += value;
      first += value * x;
      second += value * x * x;
    }
  }
  const mean = first / mass;
  return Math.sqrt(Math.max(0, second / mass - mean * mean));
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
    expect([a.driftX, a.driftY]).toEqual([b.driftX, b.driftY]);
    expect(snapshot(a).density).not.toEqual(snapshot(c).density);
    expect(snapshot(a).haze).not.toEqual(snapshot(c).haze);
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
    expect(Array.from(model.haze).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(model.driftX) && Number.isFinite(model.driftY)).toBe(true);
  });

  it('starts from nothing and has built its trails and its body by 12 s', () => {
    const model = createSteamModel(1);
    expect(total(model)).toBe(0);
    expect(sum(model.haze)).toBe(0);
    advanceSteam(model, 1000);
    const early = total(model);
    const earlyBody = sum(model.haze);
    advanceSteam(model, 11_000);
    expect(early).toBeGreaterThan(0);
    expect(earlyBody).toBeGreaterThan(0);
    expect(total(model)).toBeGreaterThan(early * 5);
    expect(sum(model.haze)).toBeGreaterThan(earlyBody * 5);
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

  it('lets the steam leave the coffee: each particle born on the coffee showing inside the rim', () => {
    const model = createSteamModel(4);
    let births = 0;
    let wrong = 0;
    const lived = Float64Array.from(model.age);
    for (let i = 0; i < 30 * 20; i += 1) {
      const wasBorn = Uint8Array.from(model.born);
      model.step(1000 / 30);
      for (let p = 0; p < model.count; p += 1) {
        // Born this step, or born again (its age started over): where it is now is a frame's rise from the coffee.
        if (!(wasBorn[p] === 0 && model.born[p] === 1) && !(model.age[p]! < lived[p]!)) continue;
        births += 1;
        const span = coffeeSpan(model.x[p]!);
        if (!span || model.y[p]! < span.low - 1 || model.y[p]! > span.high + 3) wrong += 1;
      }
      lived.set(model.age);
    }
    expect(births).toBeGreaterThan(300);
    expect(wrong).toBe(0);
  });

  it('keeps every particle on screen: inside the buffer, and held by the cup until it clears the rim', () => {
    let outside = 0;
    let seen = 0;
    const lowest = -COFFEE_DROP * VIEW_COS - COFFEE_HALF_WIDTH * VIEW_SIN;
    for (const seed of [1, 2]) {
      const model = createSteamModel(seed);
      for (let i = 0; i < 30 * 30; i += 1) {
        model.step(1000 / 30);
        for (let p = 0; p < model.count; p += 1) {
          if (model.born[p] === 0) continue;
          seen += 1;
          const x = model.x[p]!;
          const y = model.y[p]!;
          if (x <= LEFT || x >= -LEFT || y < lowest || y > TOP) outside += 1;
          // Below the rim, inside the cup.
          else if (y < 0 && Math.abs(x) > MOUTH_HALF_WIDTH) outside += 1;
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
        // A particle born again this step jumped back to the coffee: not a rise.
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

  it('wraps the filaments in a body: broader and fainter than they are, rising and spreading', () => {
    const model = createSteamModel(6);
    advanceSteam(model, 15_000);
    expect(HAZE_COLS * HAZE_CELL).toBe(COLS * CELL);
    expect(HAZE_ROWS * HAZE_CELL).toBe(ROWS * CELL);
    // Broader: a body, not lines. The area where it shows at a tenth of its most is far larger than the filaments'.
    const area = (values: Float32Array, cell: number) => {
      const most = Math.max(...values);
      return values.filter((value) => value > most / 10).length * cell * cell;
    };
    expect(area(model.haze, HAZE_CELL)).toBeGreaterThan(area(model.density, CELL) * 2);
    // Fainter: no cell of it as dense as the filaments' densest.
    expect(Math.max(...model.haze)).toBeLessThan(Math.max(...model.density));
    // And so at any height: high up, where the wisps have curled, the body still spreads wider than they do.
    const high = [(TOP - 300) / HAZE_CELL, (TOP - 180) / HAZE_CELL] as const;
    expect(spreadAcross(model.haze, HAZE_COLS, HAZE_ROWS, HAZE_CELL, ...high)).toBeGreaterThan(
      spreadAcross(model.density, COLS, ROWS, CELL, (high[0] * HAZE_CELL) / CELL, (high[1] * HAZE_CELL) / CELL),
    );
    expect(Array.from(model.haze).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it('fades exactly to nothing once no more steam comes: the page is left clean', () => {
    const model = createSteamModel(5);
    advanceSteam(model, 15_000);
    expect(total(model)).toBeGreaterThan(1);
    expect(sum(model.haze)).toBeGreaterThan(0.1);
    // The cup goes cold: nothing is born again.
    for (let p = 0; p < model.count; p += 1) {
      model.born[p] = 0;
      model.age[p] = -1e9;
    }
    advanceSteam(model, 30_000);
    expect(total(model)).toBe(0);
    expect(sum(model.haze)).toBe(0);
  });

  it('lays down about as much steam however long the steps are', () => {
    const models = [1000 / 60, 1000 / 30, 100].map((stepMs) => {
      const model = createSteamModel(6);
      advanceSteam(model, 14_000, stepMs);
      return model;
    });
    for (const amount of [total, (model: SteamModel) => sum(model.haze)]) {
      const values = models.map(amount);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      for (const value of values) expect(Math.abs(value - mean) / mean).toBeLessThan(0.2);
    }
  });

  it('drifts with the steps, as sceneDrift says', () => {
    const model = createSteamModel(9);
    advanceSteam(model, 3000);
    expect([model.driftX, model.driftY]).toEqual(Object.values(sceneDrift(9, model.time)));
    expect(sceneDrift(9, 0)).not.toEqual(sceneDrift(10, 0));
  });
});

describe('sceneDrift', () => {
  it('moves the scene a few pixels over minutes, never far, never fast', () => {
    for (const seed of [1, 20_385]) {
      const xs: number[] = [];
      const ys: number[] = [];
      let fastest = 0;
      let last = sceneDrift(seed, 0);
      // The thirty minutes of a showing, a reading every ten seconds.
      for (let seconds = 10; seconds <= 1800; seconds += 10) {
        const now = sceneDrift(seed, seconds);
        xs.push(now.x);
        ys.push(now.y);
        fastest = Math.max(fastest, Math.hypot(now.x - last.x, now.y - last.y) * 6);
        last = now;
      }
      expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(DRIFT_X);
      expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(DRIFT_Y);
      // A few pixels a minute at most...
      expect(fastest).toBeLessThan(6);
      // ...and over half an hour it has been most of the way across its range, both ways.
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(DRIFT_X);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DRIFT_Y);
    }
  });
});

describe('coffeeSpan', () => {
  it('is the coffee showing inside the rim: below the rim, as wide as the coffee, cut by the near lip', () => {
    const middle = coffeeSpan(0)!;
    expect(middle.low).toBeCloseTo(-MOUTH_HALF_WIDTH * VIEW_SIN, 6);
    expect(middle.high).toBeCloseTo(-COFFEE_DROP * VIEW_COS + COFFEE_HALF_WIDTH * VIEW_SIN, 6);
    expect(middle.high).toBeGreaterThan(0);
    const side = coffeeSpan(COFFEE_HALF_WIDTH * 0.9)!;
    expect(side.high - side.low).toBeLessThan(middle.high - middle.low);
    expect(coffeeSpan(COFFEE_HALF_WIDTH + 1)).toBeNull();
    expect(coffeeSpan(-30)).toEqual(coffeeSpan(30));
  });
});

describe('backlight', () => {
  it('is brightest where the steam crosses the glow, fading toward the cup and with height above it', () => {
    expect(backlight(GLOW_X, GLOW_Y)).toBeCloseTo(1, 6);
    expect(backlight(GLOW_X, 0)).toBeLessThan(0.6);
    expect(backlight(GLOW_X, 0)).toBeGreaterThan(0.2);
    expect(backlight(GLOW_X, GLOW_Y + 200)).toBeLessThan(backlight(GLOW_X, GLOW_Y + 100));
    expect(backlight(GLOW_X, GLOW_Y + 100)).toBeLessThan(backlight(GLOW_X, GLOW_Y));
    expect(backlight(GLOW_X + 180, GLOW_Y)).toBeLessThan(0.5);
    for (const [x, y] of [
      [0, 0],
      [-200, 448],
      [200, -30],
    ] as const) {
      expect(backlight(x, y)).toBeGreaterThanOrEqual(0);
      expect(backlight(x, y)).toBeLessThanOrEqual(1);
    }
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

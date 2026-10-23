import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import { createNoise, curl } from './noise.ts';

function samples(noise: ReturnType<typeof createNoise>, count: number): number[] {
  const random = createRandom(99);
  return Array.from({ length: count }, () => noise(random() * 40 - 20, random() * 40 - 20, random() * 40 - 20));
}

describe('createNoise', () => {
  it('gives the same field for the same seed and another for another seed', () => {
    const a = createNoise(createRandom(5));
    const b = createNoise(createRandom(5));
    const c = createNoise(createRandom(6));
    const points: [number, number, number][] = [
      [0.3, 0.7, 0.1],
      [4.25, -3.5, 12.5],
      [-17.2, 8.8, 0.9],
    ];
    expect(points.map(([x, y, z]) => a(x, y, z))).toEqual(points.map(([x, y, z]) => b(x, y, z)));
    expect(points.map(([x, y, z]) => a(x, y, z))).not.toEqual(points.map(([x, y, z]) => c(x, y, z)));
  });

  it('stays between -1 and 1, around zero, and uses the range', () => {
    const values = samples(createNoise(createRandom(1)), 20_000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.max(...values)).toBeGreaterThan(0.5);
    expect(Math.min(...values)).toBeLessThan(-0.5);
  });

  it('is zero on the lattice and smooth between its points', () => {
    const noise = createNoise(createRandom(3));
    expect(noise(4, 7, 2)).toBeCloseTo(0, 12);
    expect(noise(-3, 0, 9)).toBeCloseTo(0, 12);
    let largest = 0;
    for (let x = -5; x < 5; x += 0.01) largest = Math.max(largest, Math.abs(noise(x + 0.01, 1.3, 0.4) - noise(x, 1.3, 0.4)));
    expect(largest).toBeLessThan(0.05);
  });
});

describe('curl', () => {
  it('has no sources or sinks: its divergence is zero wherever it is taken', () => {
    const noise = createNoise(createRandom(8));
    const random = createRandom(2);
    const here: [number, number] = [0, 0];
    const east: [number, number] = [0, 0];
    const west: [number, number] = [0, 0];
    const north: [number, number] = [0, 0];
    const south: [number, number] = [0, 0];
    const h = 0.05;
    for (let i = 0; i < 50; i += 1) {
      const x = random() * 10;
      const y = random() * 10;
      const t = random() * 10;
      curl(noise, x, y, t, here);
      curl(noise, x + h, y, t, east);
      curl(noise, x - h, y, t, west);
      curl(noise, x, y + h, t, north);
      curl(noise, x, y - h, t, south);
      const divergence = (east[0] - west[0]) / (2 * h) + (north[1] - south[1]) / (2 * h);
      const speed = Math.hypot(here[0], here[1]);
      expect(Math.abs(divergence)).toBeLessThan(0.05 + 0.05 * speed);
    }
  });

  it('swirls: the flow has a size, and it turns', () => {
    const noise = createNoise(createRandom(4));
    const out: [number, number] = [0, 0];
    const random = createRandom(7);
    let total = 0;
    let turning = 0;
    for (let i = 0; i < 400; i += 1) {
      curl(noise, random() * 20, random() * 20, random() * 20, out);
      total += Math.hypot(out[0], out[1]);
      if (out[0] > 0) turning += 1;
    }
    expect(total / 400).toBeGreaterThan(0.3);
    expect(total / 400).toBeLessThan(3);
    // It runs both ways across, not always one.
    expect(turning).toBeGreaterThan(100);
    expect(turning).toBeLessThan(300);
  });
});

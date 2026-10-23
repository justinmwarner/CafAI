/**
 * Seeded smooth noise for the screensavers (D-SAVER-4, D-SAVER-5): Perlin's
 * gradient noise in three dimensions, its table shuffled by the seeded
 * random, so the same seed gives the same field. Rising Steam asks it for a
 * potential and takes the curl of that: a flow that swirls and curls but
 * never gathers or thins, with the third axis letting it drift with time.
 */
import type { Random } from '../random.ts';

/** A smooth function of three numbers, between -1 and 1. */
export type Noise3 = (x: number, y: number, z: number) => number;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

/** Perlin's improved gradient: one of twelve directions, by the low bits of the hash. */
function gradient(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Gradient noise whose lattice is shuffled by `random`: zero on the lattice points, smooth between them. */
export function createNoise(random: Random): Noise3 {
  const order = Array.from({ length: 256 }, (_, index) => index);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    const held = order[i]!;
    order[i] = order[j]!;
    order[j] = held;
  }
  const table = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) table[i] = order[i & 255]!;

  return (x, y, z) => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);
    const cellX = floorX & 255;
    const cellY = floorY & 255;
    const cellZ = floorZ & 255;
    const dx = x - floorX;
    const dy = y - floorY;
    const dz = z - floorZ;
    const u = fade(dx);
    const v = fade(dy);
    const w = fade(dz);

    const a = table[cellX]! + cellY;
    const aa = table[a]! + cellZ;
    const ab = table[a + 1]! + cellZ;
    const b = table[cellX + 1]! + cellY;
    const ba = table[b]! + cellZ;
    const bb = table[b + 1]! + cellZ;

    return lerp(
      w,
      lerp(
        v,
        lerp(u, gradient(table[aa]!, dx, dy, dz), gradient(table[ba]!, dx - 1, dy, dz)),
        lerp(u, gradient(table[ab]!, dx, dy - 1, dz), gradient(table[bb]!, dx - 1, dy - 1, dz)),
      ),
      lerp(
        v,
        lerp(u, gradient(table[aa + 1]!, dx, dy, dz - 1), gradient(table[ba + 1]!, dx - 1, dy, dz - 1)),
        lerp(u, gradient(table[ab + 1]!, dx, dy - 1, dz - 1), gradient(table[bb + 1]!, dx - 1, dy - 1, dz - 1)),
      ),
    );
  };
}

/**
 * The velocity (vx, vy) of the flow whose stream function is `potential`,
 * written into `out`: the curl of the potential, taken over `span` on either
 * side. Such a flow has no sources and no sinks (what flows in flows out), so
 * particles carried by it swirl without gathering in clumps or thinning out.
 */
export function curl(potential: Noise3, x: number, y: number, z: number, out: [number, number], span = 0.01): void {
  const width = 2 * span;
  out[0] = (potential(x, y + span, z) - potential(x, y - span, z)) / width;
  out[1] = -(potential(x + span, y, z) - potential(x - span, y, z)) / width;
}

/**
 * The model behind Lava Latte (D-SAVER-5), pure: no canvas, no clock. Seven to
 * nine blobs of cream drift in a glass of coffee as they do in a lava lamp:
 * warmed at the bottom each rises, cooled at the top each sinks, wobbling
 * sideways as it goes, at about 15 px/s. The blobs are metaballs: the field
 * is the sum of a soft bump around each one (and a thin pool of cream on the
 * glass's floor), the cream is where the sum is high, so blobs that meet
 * merge and blobs that part split, with a neck between them for a moment. The
 * picture is a function of the seed and the steps.
 *
 * Units are design pixels, a pixel on a screen 962 wide and 602 high, so
 * the glass is 70% of the height: y runs up from the bottom of the glass, x
 * across from its axis.
 */
import { between, createRandom, wholeBetween, type Random } from '../random.ts';

/** The glass: its outside, from the side, a little wider at the rim than at the foot. */
export const GLASS = {
  height: 421,
  bottomHalf: 72,
  topHalf: 90,
  wall: 3,
  /** The thickness of its bottom. */
  base: 14,
  /** The coffee comes this far up the glass. */
  level: 0.93,
} as const;

/** Where the coffee begins and ends, up the glass. */
export const FLOOR = GLASS.base;
export const SURFACE = GLASS.height * GLASS.level;

/** Half the width of the coffee at a height. */
export function innerHalfWidth(y: number): number {
  return GLASS.bottomHalf - GLASS.wall + (GLASS.topHalf - GLASS.bottomHalf) * (y / GLASS.height);
}

/** The field's grid: coarse cells of CELL units, covering the coffee, a row at a time from the top. */
export const CELL = 4;
export const GRID_COLS = 44;
export const GRID_ROWS = 96;
export const GRID_LEFT = -88;
export const GRID_TOP = FLOOR + GRID_ROWS * CELL;

/** Where the field says cream: a lone blob of radius r is a round one of radius r. */
export const ISO = 0.5;
/** How far a blob's bump reaches, in radii: where (1 - d²/R²)² is ISO at a distance of one radius. */
const REACH = 1 / Math.sqrt(1 - Math.sqrt(ISO));

/** The pool of cream on the glass's floor, and how far up its bump reaches. */
const POOL_REACH = 70;

/** Blobs: how many (a lamp's worth), and how long a blob takes to pick up the speed its heat asks of it (seconds). */
export const MIN_BLOBS = 7;
export const MAX_BLOBS = 9;
const VERTICAL_LAG = 2.5;
/** The model moves on in pieces of this many milliseconds at most, and by this many in one step at most, whatever it is asked. */
const SUB_STEP_MS = 50;
const MAX_STEP_TOTAL_MS = 10_000;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** One blob of cream. */
export interface CreamBlob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its radius when it is alone. */
  r: number;
  /** 0 is cold and sinks, 1 is warm and rises. */
  heat: number;
  /** How long it is up and down compared to across: 1 is round; a blob on the move is stretched. */
  stretch: number;
  /** The fastest it goes up or down (units a second). */
  speed: number;
  /** Seconds it takes to warm at the bottom and to cool at the top. */
  warming: number;
  cooling: number;
  /** Where it sways about, and the two sways it makes about that: size, rate (radians a second) and phase. */
  home: number;
  sway: readonly [size: number, rate: number, phase: number];
  swell: readonly [size: number, rate: number, phase: number];
}

export interface LavaModel {
  /** Seconds stepped so far. */
  readonly time: number;
  readonly blobs: readonly CreamBlob[];
  /** Writes the field over the coffee into `out`, GRID_COLS * GRID_ROWS: the sum of the blobs' bumps and the pool's. Cream where it is ISO or more. */
  field(out: Float32Array): void;
  step(dtMs: number): void;
}

export function createLavaModel(seed: number): LavaModel {
  const random: Random = createRandom(seed);
  const count = wholeBetween(random, MIN_BLOBS, MAX_BLOBS);

  // Spread the blobs over the glass from the start, each a different height and a different side.
  const heights = Array.from({ length: count }, (_, i) => (i + random()) / count);
  const homes = Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * 2 * 46);
  for (const list of [heights, homes]) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      const held = list[i]!;
      list[i] = list[j]!;
      list[j] = held;
    }
  }

  const blobs: CreamBlob[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = between(random, 14, 27);
    // Half start warm, half cold, none lukewarm, so every blob is on its way somewhere.
    const heat = random() < 0.5 ? between(random, 0.05, 0.3) : between(random, 0.7, 0.95);
    const speed = between(random, 18, 26);
    const y = FLOOR + 0.7 * r + heights[i]! * (SURFACE - FLOOR - 1.8 * r);
    blobs.push({
      x: homes[i]!,
      y,
      vx: 0,
      vy: (2 * heat - 1) * speed,
      r,
      heat,
      stretch: 1,
      speed,
      warming: between(random, 5, 12),
      cooling: between(random, 5, 12),
      home: homes[i]!,
      sway: [between(random, 9, 17), (2 * Math.PI) / between(random, 8, 14), between(random, 0, 2 * Math.PI)],
      swell: [between(random, 3, 7), (2 * Math.PI) / between(random, 3.5, 6.5), between(random, 0, 2 * Math.PI)],
    });
  }
  let time = 0;

  function advance(dt: number): void {
    time += dt;
    for (const blob of blobs) {
      // Warmed on the floor, cooled at the top, and where it is between it keeps what it has.
      const height = clamp01((blob.y - FLOOR) / (SURFACE - FLOOR));
      const warming = 1 - smoothstep(0.1, 0.3, height);
      const cooling = smoothstep(0.62, 0.84, height);
      blob.heat = clamp01(blob.heat + (((1 - blob.heat) * warming) / blob.warming - (blob.heat * cooling) / blob.cooling) * dt);
      const lift = 2 * blob.heat - 1;
      blob.vy += (lift * blob.speed - blob.vy) * (1 - Math.exp(-dt / VERTICAL_LAG));
      blob.y += blob.vy * dt;
      const lowest = FLOOR + 0.7 * blob.r;
      const highest = SURFACE - 1.1 * blob.r;
      if (blob.y < lowest) {
        blob.y = lowest;
        blob.vy = Math.max(blob.vy, 0);
      } else if (blob.y > highest) {
        blob.y = highest;
        blob.vy = Math.min(blob.vy, 0);
      }

      // Sideways it follows a slow wobble of its own, like a spring, never through the glass.
      const room = Math.max(0, innerHalfWidth(blob.y) - 0.7 * blob.r);
      const wobble =
        blob.home + blob.sway[0] * Math.sin(blob.sway[1] * time + blob.sway[2]) + blob.swell[0] * Math.sin(blob.swell[1] * time + blob.swell[2]);
      const aim = Math.max(-room, Math.min(room, wobble));
      blob.vx += ((aim - blob.x) * 3 - blob.vx * 3.2) * dt;
      blob.x += blob.vx * dt;
      if (Math.abs(blob.x) > room) {
        blob.x = Math.sign(blob.x) * room;
        blob.vx = 0;
      }

      // A blob on the move is drawn out, up and down.
      blob.stretch += (1 + 0.45 * Math.abs(lift) - blob.stretch) * (1 - Math.exp(-dt / 1.5));
    }
  }

  function field(out: Float32Array): void {
    out.fill(0);
    for (const blob of blobs) {
      const across = Math.sqrt(1 / blob.stretch) * REACH * blob.r;
      const up = Math.sqrt(blob.stretch) * REACH * blob.r;
      const firstCol = Math.max(0, Math.floor((blob.x - across - GRID_LEFT) / CELL));
      const lastCol = Math.min(GRID_COLS - 1, Math.floor((blob.x + across - GRID_LEFT) / CELL));
      const firstRow = Math.max(0, Math.floor((GRID_TOP - (blob.y + up)) / CELL));
      const lastRow = Math.min(GRID_ROWS - 1, Math.floor((GRID_TOP - (blob.y - up)) / CELL));
      for (let row = firstRow; row <= lastRow; row += 1) {
        const dy = (GRID_TOP - (row + 0.5) * CELL - blob.y) / up;
        const rest = 1 - dy * dy;
        if (rest <= 0) continue;
        for (let col = firstCol; col <= lastCol; col += 1) {
          const dx = (GRID_LEFT + (col + 0.5) * CELL - blob.x) / across;
          const left = rest - dx * dx;
          if (left > 0) out[row * GRID_COLS + col] = out[row * GRID_COLS + col]! + left * left;
        }
      }
    }

    // The pool on the floor, its surface moving a little, as if it were warm.
    const poolRows = Math.min(GRID_ROWS, Math.ceil((POOL_REACH * 1.2) / CELL));
    for (let step = 0; step < poolRows; step += 1) {
      const row = GRID_ROWS - 1 - step;
      const above = GRID_TOP - (row + 0.5) * CELL - FLOOR;
      for (let col = 0; col < GRID_COLS; col += 1) {
        const x = GRID_LEFT + (col + 0.5) * CELL;
        const reach = POOL_REACH * (1 + 0.1 * Math.sin(x * 0.045 + time * 0.35) + 0.06 * Math.sin(x * 0.11 - time * 0.5 + 1.7));
        const rest = 1 - above / reach;
        if (rest > 0) out[row * GRID_COLS + col] = out[row * GRID_COLS + col]! + rest * rest;
      }
    }
  }

  return {
    get time() {
      return time;
    },
    blobs,
    field,
    step(dtMs) {
      let left = Math.min(dtMs, MAX_STEP_TOTAL_MS);
      while (left > 0) {
        const piece = Math.min(left, SUB_STEP_MS);
        advance(piece / 1000);
        left -= piece;
      }
    },
  };
}

/** Steps a model through `ms`, a 30 fps frame at a time: for stills and tests. */
export function advanceLava(model: LavaModel, ms: number, stepMs = 1000 / 30): void {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    model.step(dt);
    left -= dt;
  }
}

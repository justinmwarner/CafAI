/**
 * The model behind Rising Steam (D-SAVER-5), pure: no canvas, no clock. A few
 * hundred particles are born at the cup's rim, rise at about 35 px/s on a
 * curl-noise flow that drifts slowly with time, live 6 to 10 s and fade in
 * and out. Each step lays a short soft stroke from where a particle was to
 * where it is into a small density buffer, and the buffer fades a little, so
 * the wisps leave trails. The picture is a function of the seed and the steps.
 *
 * Why a buffer of our own and not a canvas faded with a translucent fill: an
 * 8-bit canvas never fades all the way back to the page, a pixel that is a few
 * levels off stays a few levels off (the rounding eats a slow fade), and the
 * steam would leave a faint ghost where it has passed. Here the density is
 * a float, fades exactly, and reaches zero.
 *
 * Units are design pixels, a pixel on a screen 962 wide: x runs across from the
 * cup's axis, y up from its rim.
 */
import { between, createRandom, type Random } from '../random.ts';
import { createNoise, curl, type Noise3 } from './noise.ts';

/** Half the cup's rim, which is the steam's mouth. */
export const RIM_HALF_WIDTH = 74;

/** The trail buffer: cells of CELL units, covering x from LEFT to -LEFT and y from TOP down to TOP - ROWS * CELL. */
export const CELL = 2;
export const COLS = 200;
export const ROWS = 230;
export const LEFT = -200;
export const TOP = 448;

/** Particles, the strands of steam they make up, the lifetimes they live (seconds), and the speed they rise at (units a second, on average). */
export const PARTICLES = 340;
export const STRANDS = 6;
export const MIN_LIFE = 6;
export const MAX_LIFE = 10;
export const RISE_SPEED = 35;

/** How long a trail takes to fade to a third (seconds). */
const TRAIL_SECONDS = 1;
/** Density laid down by a particle at full strength, a second. */
const DEPOSIT_RATE = 3.7;
/** How much of a stroke goes into the mist round it. */
const MIST_SHARE = 0.3;
/** Below this a cell is empty. */
const DENSITY_FLOOR = 1e-4;
/** The model moves on in pieces of this many milliseconds at most, and by this many in one step at most, whatever it is asked. */
const SUB_STEP_MS = 50;
const MAX_STEP_TOTAL_MS = 10_000;

/** The size of the swirls, in units, and how long the flow takes to change into another (seconds). */
const SWIRL_SIZE = 170;
const SWIRL_DRIFT_SECONDS = 15;
/** The swirl's speed (units a second) at the rim and well above it, where the air is less still. */
const SWIRL_NEAR = 14;
const SWIRL_FAR = 55;
/** The height at which the steam is as free as it gets. */
const FREE_HEIGHT = 300;
/** Past this far from the axis the flow turns the steam back. */
const SOFT_WALL = 150;
/** The most (units a second) an updraught adds to the rise or takes from it. */
const MAX_DRAUGHT = 24;
/** Between these heights the steam thins out to nothing, so none is left at the top of the buffer. */
const THIN_FROM = 290;
const THIN_TO = 430;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** How strongly a particle at this point of its life shows: in over the first twelfth, out over the second half. */
export function lifeEnvelope(fraction: number): number {
  return smoothstep(0, 0.08, fraction) * (1 - smoothstep(0.5, 1, fraction));
}

export interface SteamModel {
  /** Seconds stepped so far. */
  readonly time: number;
  readonly count: number;
  /** Where each particle is (born or not), in the units above. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Seconds lived; negative while it waits to be born. */
  readonly age: Float64Array;
  readonly life: Float64Array;
  /** 0 until it is born. */
  readonly born: Uint8Array;
  /** How bright this one is (the steam comes in puffs). */
  readonly weight: Float64Array;
  /** Which strand of steam it belongs to, 0 to STRANDS - 1. */
  readonly strand: Uint8Array;
  /** Density of the trails, COLS * ROWS, a row at a time from the top. */
  readonly density: Float32Array;
  step(dtMs: number): void;
}

export function createSteamModel(seed: number): SteamModel {
  const random: Random = createRandom(seed);
  const noise = createNoise(random);

  // A stream function: two octaves of noise, the second smaller and quicker.
  const potential: Noise3 = (px, py, pz) => noise(px, py, pz) + 0.4 * noise(px * 2.03 + 11.5, py * 2.03 + 3.7, pz * 1.7 + 7.1);
  const puffs: Noise3 = (px, py, pz) => noise(px + 31.7, py + 5.3, pz + 77.7);

  const x = new Float64Array(PARTICLES);
  const y = new Float64Array(PARTICLES);
  const age = new Float64Array(PARTICLES);
  const life = new Float64Array(PARTICLES);
  const born = new Uint8Array(PARTICLES);
  const weight = new Float64Array(PARTICLES);
  const strand = new Uint8Array(PARTICLES);
  const jitter = new Float64Array(PARTICLES);
  const density = new Float32Array(COLS * ROWS);
  const velocity: [number, number] = [0, 0];
  let time = 0;

  // The steam is a few strands: each leaves the coffee at a place of its own and
  // curls on its own stretch of the flow, a little quicker or slower, a little
  // more or less swirled, so it rises as several wisps and not as one.
  const strandAt = new Float64Array(STRANDS);
  const strandShift = new Float64Array(STRANDS);
  const strandTime = new Float64Array(STRANDS);
  const strandSpeed = new Float64Array(STRANDS);
  const strandSwirl = new Float64Array(STRANDS);
  for (let s = 0; s < STRANDS; s += 1) {
    strandAt[s] = ((s + 0.5) / STRANDS - 0.5) * 2 * RIM_HALF_WIDTH * 0.7 + between(random, -5, 5);
    strandShift[s] = between(random, -0.8, 0.8) * SWIRL_SIZE;
    strandTime[s] = between(random, 0, SWIRL_DRIFT_SECONDS);
    strandSpeed[s] = between(random, 0.9, 1.1);
    strandSwirl[s] = between(random, 0.75, 1.25);
  }

  // The first wave is staggered over a lifetime, so the steam rises from
  // nothing at the first moment and has reached full length after ten seconds.
  for (let i = 0; i < PARTICLES; i += 1) {
    strand[i] = Math.min(STRANDS - 1, Math.floor(random() * STRANDS));
    jitter[i] = between(random, -0.1, 0.1) * SWIRL_SIZE;
    life[i] = between(random, MIN_LIFE, MAX_LIFE);
    age[i] = -between(random, 0, life[i]!);
  }

  function spawn(i: number): void {
    const spread = (random() + random() + random() - 1.5) / 1.5;
    x[i] = strandAt[strand[i]!]! + spread * 12;
    y[i] = between(random, 0, 4);
    life[i] = between(random, MIN_LIFE, MAX_LIFE);
    // The steam comes off the coffee in puffs, a few seconds apart and a few
    // finger-widths across; they stay bright as they curl up.
    weight[i] = 0.5 + 1.0 * smoothstep(-0.4, 0.5, puffs(x[i]! / 50, time / 2.4, 3.3));
  }

  /** The velocity of the air where particle `i` is: rising, swirled, and swayed a little by a draught. */
  function flow(i: number, px: number, py: number, t: number): void {
    const s = strand[i]!;
    const height = clamp01(py / FREE_HEIGHT);
    curl(potential, (px + strandShift[s]! + jitter[i]!) / SWIRL_SIZE, py / SWIRL_SIZE, (t + strandTime[s]!) / SWIRL_DRIFT_SECONDS, velocity);
    const swirl = (SWIRL_NEAR + (SWIRL_FAR - SWIRL_NEAR) * height) * strandSwirl[s]!;
    const draught = 7 * Math.sin(t * 0.27 + 1.3) + 4 * Math.sin(t * 0.61 + 4);
    let vx = swirl * velocity[0] + draught * height;
    // Up and down draughts add to the rise, up to a point: a wisp may catch one, but none carries it away.
    const vy = RISE_SPEED * strandSpeed[s]! * (0.8 + 0.3 * height) + MAX_DRAUGHT * Math.tanh((0.3 * swirl * velocity[1]) / MAX_DRAUGHT);
    const outside = Math.abs(px) - SOFT_WALL;
    if (outside > 0) vx -= Math.sign(px) * outside * 1.2;
    velocity[0] = vx;
    velocity[1] = vy;
  }

  /** Adds `amount` to the four cells around a point, shared by how near each is. */
  function dab(px: number, py: number, amount: number): void {
    const cx = (px - LEFT) / CELL - 0.5;
    const cy = (TOP - py) / CELL - 0.5;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    if (ix < 0 || iy < 0 || ix + 1 >= COLS || iy + 1 >= ROWS) return;
    const fx = cx - ix;
    const fy = cy - iy;
    const at = iy * COLS + ix;
    density[at] = density[at]! + amount * (1 - fx) * (1 - fy);
    density[at + 1] = density[at + 1]! + amount * fx * (1 - fy);
    density[at + COLS] = density[at + COLS]! + amount * (1 - fx) * fy;
    density[at + COLS + 1] = density[at + COLS + 1]! + amount * fx * fy;
  }

  /**
   * A soft stroke's worth at a point: most of `amount` in four dabs `blur` to
   * each side, which is the wisp, and the rest in four wider ones, which is the
   * faint mist round it.
   */
  function splat(px: number, py: number, amount: number, blur: number): void {
    const core = (amount * (1 - MIST_SHARE)) / 4;
    dab(px - blur, py - blur, core);
    dab(px + blur, py - blur, core);
    dab(px - blur, py + blur, core);
    dab(px + blur, py + blur, core);
    const wide = blur * 3 + CELL;
    const mist = (amount * MIST_SHARE) / 4;
    dab(px - wide, py - wide, mist);
    dab(px + wide, py - wide, mist);
    dab(px - wide, py + wide, mist);
    dab(px + wide, py + wide, mist);
  }

  function advance(dt: number): void {
    time += dt;
    const keep = Math.exp(-dt / TRAIL_SECONDS);
    for (let c = 0; c < density.length; c += 1) {
      const faded = density[c]! * keep;
      density[c] = faded < DENSITY_FLOOR ? 0 : faded;
    }

    for (let i = 0; i < PARTICLES; i += 1) {
      let lived = age[i]! + dt;
      if (born[i] === 0) {
        if (lived < 0) {
          age[i] = lived;
          continue;
        }
        born[i] = 1;
        spawn(i);
      } else if (lived >= life[i]!) {
        lived -= life[i]!;
        spawn(i);
      }
      age[i] = lived;

      const fromX = x[i]!;
      const fromY = y[i]!;
      flow(i, fromX, fromY, time);
      const toX = Math.max(LEFT + 4, Math.min(-LEFT - 4, fromX + velocity[0] * dt));
      const toY = fromY + velocity[1] * dt;
      x[i] = toX;
      y[i] = toY;
      if (toY > TOP - 4) {
        // Out of the top of the buffer: it has thinned away long before this.
        age[i] = life[i]!;
        continue;
      }

      const height = clamp01(toY / FREE_HEIGHT);
      const strength = weight[i]! * lifeEnvelope(lived / life[i]!) * (1 - 0.4 * height) * (1 - smoothstep(THIN_FROM, THIN_TO, toY));
      if (strength <= 0) continue;
      // The higher it is the softer it gets: the wisps spread and thin as they rise.
      const blur = CELL * (0.45 + 2 * height * height);
      // Spread over the stroke, a point for about every cell it crosses.
      const length = Math.hypot(toX - fromX, toY - fromY);
      const points = Math.max(1, Math.ceil(length / (CELL * 0.6)));
      const amount = (DEPOSIT_RATE * strength * dt) / points;
      for (let p = 1; p <= points; p += 1) {
        const along = p / points;
        splat(fromX + (toX - fromX) * along, fromY + (toY - fromY) * along, amount, blur);
      }
    }
  }

  return {
    get time() {
      return time;
    },
    count: PARTICLES,
    x,
    y,
    age,
    life,
    born,
    weight,
    strand,
    density,
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
export function advanceSteam(model: SteamModel, ms: number, stepMs = 1000 / 30): void {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    model.step(dt);
    left -= dt;
  }
}

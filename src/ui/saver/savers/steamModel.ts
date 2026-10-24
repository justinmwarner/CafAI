/**
 * The model behind Rising Steam (D227, D-STEAM-2), pure: no canvas, no clock.
 * A few hundred particles leave the coffee's surface, rise at about 35 px/s on
 * a curl-noise flow that drifts slowly with time, live 6 to 10 s and fade in
 * and out. The steam they make is two layers. The filaments: each step lays a
 * short soft stroke from where a particle was to where it is into a fine
 * density buffer, which fades within a second or so, so the wisps leave
 * trails. The body: each particle also feeds a coarse buffer that rises with
 * the warm air, spreads and fades slowly, a broad faint haze round the wisps.
 * The picture is a function of the seed and the steps.
 *
 * Why buffers of our own and not a canvas faded with a translucent fill: an
 * 8-bit canvas never fades all the way back to the page, a pixel that is a few
 * levels off stays a few levels off (the rounding eats a slow fade), and the
 * steam would leave a faint ghost where it has passed. Here the density is
 * a float, fades exactly, and reaches zero.
 *
 * Units are design pixels, a pixel on a screen 962 wide: x runs across from the
 * cup's axis, y up from the middle of its rim, as the screen shows them. The
 * cup is seen from a little above (VIEW_SIN), so the coffee shows as a flat
 * ellipse inside the rim, a little below it.
 */
import { between, createRandom, type Random } from '../random.ts';
import { createNoise, curl, type Noise3 } from './noise.ts';

/**
 * How the scene is seen (D-STEAM-1): from a little above, so a circle lying
 * flat shows VIEW_SIN of its width as its height. The eye looks down about
 * 17.5 degrees.
 */
export const VIEW_SIN = 0.3;
export const VIEW_COS = Math.sqrt(1 - VIEW_SIN * VIEW_SIN);

/**
 * The cup is drawn in units of its own (steamStill.ts), each CUP_SCALE of a
 * design pixel: about 175 px across its rim on a screen 962 wide.
 */
export const CUP_SCALE = 1.12;
/** Half the cup's rim, outside, and half its mouth, inside the lip. */
export const RIM_HALF_WIDTH = 78 * CUP_SCALE;
export const MOUTH_HALF_WIDTH = 73.6 * CUP_SCALE;
/** How far below the rim the coffee stands, and half its width there: the steam leaves this surface. */
export const COFFEE_DROP = 11 * CUP_SCALE;
export const COFFEE_HALF_WIDTH = 72.4 * CUP_SCALE;

/** The filaments' buffer: cells of CELL units, covering x from LEFT to -LEFT and y from TOP down to TOP - ROWS * CELL. */
export const CELL = 2;
export const COLS = 200;
export const ROWS = 240;
export const LEFT = -200;
export const TOP = 448;

/** The body's buffer: the same box in cells of HAZE_CELL units. */
export const HAZE_CELL = 8;
export const HAZE_COLS = (COLS * CELL) / HAZE_CELL;
export const HAZE_ROWS = (ROWS * CELL) / HAZE_CELL;

/** Particles, the strands of steam they make up, the lifetimes they live (seconds), and the speed they rise at (units a second, on average). */
export const PARTICLES = 340;
export const STRANDS = 6;
export const MIN_LIFE = 6;
export const MAX_LIFE = 10;
export const RISE_SPEED = 35;

/** How long a filament's trail takes to fade to a third (seconds). */
const TRAIL_SECONDS = 0.9;
/** Density laid down by a particle at full strength, a second. */
const DEPOSIT_RATE = 3.7;
/** How much of a stroke goes into the mist round it. */
const MIST_SHARE = 0.18;
/** The body: how long it takes to fade to a third (seconds), how fast it rises (units a second), how fast it spreads (cells² a second), and how much a particle feeds it a second. */
const HAZE_SECONDS = 2.4;
const HAZE_RISE = 26;
const HAZE_SPREAD = 1.6;
const HAZE_RATE = 0.16;
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

/**
 * The key light (D-STEAM-2): a warm light behind the cup and above it, out
 * of the picture, whose glow sits behind the steam. Where the steam crosses
 * it the steam is lit from behind and shows bright; away from it, it shows
 * faint. Its middle and its reach, in the units above.
 */
export const GLOW_X = -34;
export const GLOW_Y = 205;
export const GLOW_REACH = 150;

/** The whole scene drifts this far each way at most (units), over minutes, so nothing bright stays in one place (D-STEAM-1). */
export const DRIFT_X = 6;
export const DRIFT_Y = 3.5;
/** The drift's two periods (seconds): coprime-ish, so its path takes hours to repeat. */
const DRIFT_PERIOD_X = 503;
const DRIFT_PERIOD_Y = 367;

/**
 * How far the whole scene has drifted from its place `seconds` into a showing
 * (units, y up): two slow sines, their phases from the seed.
 */
export function sceneDrift(seed: number, seconds: number): { x: number; y: number } {
  const random = createRandom(Math.imul(seed | 0, 0x45d9f3b) ^ 0x7f4a7c15);
  const phaseX = random() * Math.PI * 2;
  const phaseY = random() * Math.PI * 2;
  return {
    x: DRIFT_X * Math.sin((seconds * 2 * Math.PI) / DRIFT_PERIOD_X + phaseX),
    y: DRIFT_Y * Math.sin((seconds * 2 * Math.PI) / DRIFT_PERIOD_Y + phaseY),
  };
}

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

/**
 * How much of the key light reaches the eye through the steam at (x, y),
 * 0 to 1: most where the steam crosses the glow behind it, less away from it,
 * and fading out with height above it.
 */
export function backlight(x: number, y: number): number {
  const dx = (x - GLOW_X) / GLOW_REACH;
  const dy = (y - GLOW_Y) / (GLOW_REACH * (y > GLOW_Y ? 0.9 : 1.25));
  return Math.exp(-0.5 * (dx * dx + dy * dy));
}

/** The visible stretch of the coffee's surface at x, inside the rim: its lowest and highest y (y up from the rim). */
export function coffeeSpan(x: number): { low: number; high: number } | null {
  const across = Math.abs(x);
  if (across >= COFFEE_HALF_WIDTH) return null;
  const middle = -COFFEE_DROP * VIEW_COS;
  const half = Math.sqrt(COFFEE_HALF_WIDTH * COFFEE_HALF_WIDTH - across * across) * VIEW_SIN;
  // The near lip hides the coffee's near edge: what shows starts at the mouth's near edge.
  const mouth = across < MOUTH_HALF_WIDTH ? -Math.sqrt(MOUTH_HALF_WIDTH * MOUTH_HALF_WIDTH - across * across) * VIEW_SIN : 0;
  const low = Math.max(middle - half, mouth);
  const high = middle + half;
  return high > low ? { low, high } : null;
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
  /** Density of the filaments, COLS * ROWS, a row at a time from the top. */
  readonly density: Float32Array;
  /** Density of the body, HAZE_COLS * HAZE_ROWS, a row at a time from the top. */
  readonly haze: Float32Array;
  /** How far the whole scene has drifted from its place now (units, y up). */
  readonly driftX: number;
  readonly driftY: number;
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
  const haze = new Float32Array(HAZE_COLS * HAZE_ROWS);
  const spread = new Float32Array(HAZE_COLS * HAZE_ROWS);
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
    strandAt[s] = ((s + 0.5) / STRANDS - 0.5) * 2 * MOUTH_HALF_WIDTH * 0.7 + between(random, -5, 5);
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
    const across = (random() + random() + random() - 1.5) / 1.5;
    const at = strandAt[strand[i]!]! + across * 12;
    // Somewhere on the coffee showing at that place, from the near lip to the far side.
    const span = coffeeSpan(at) ?? { low: 0, high: 4 };
    x[i] = at;
    y[i] = between(random, span.low + 0.15 * (span.high - span.low), span.high);
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
    // Below the rim the cup's walls hold it in.
    if (py < 0) {
      const room = MOUTH_HALF_WIDTH * 0.92 - Math.abs(px);
      if (room < 0) vx += Math.sign(px) * room * 4;
    }
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

  /** The same for the body's coarse cells. */
  function feedHaze(px: number, py: number, amount: number): void {
    const cx = (px - LEFT) / HAZE_CELL - 0.5;
    const cy = (TOP - py) / HAZE_CELL - 0.5;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    if (ix < 0 || iy < 0 || ix + 1 >= HAZE_COLS || iy + 1 >= HAZE_ROWS) return;
    const fx = cx - ix;
    const fy = cy - iy;
    const at = iy * HAZE_COLS + ix;
    haze[at] = haze[at]! + amount * (1 - fx) * (1 - fy);
    haze[at + 1] = haze[at + 1]! + amount * fx * (1 - fy);
    haze[at + HAZE_COLS] = haze[at + HAZE_COLS]! + amount * (1 - fx) * fy;
    haze[at + HAZE_COLS + 1] = haze[at + HAZE_COLS + 1]! + amount * fx * fy;
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

  /** The body rises with the warm air, spreads and fades: one piece of a step. */
  function moveHaze(dt: number): void {
    const keep = Math.exp(-dt / HAZE_SECONDS);
    // Rising: each cell takes a share of the one below it (rows run from the top).
    const rise = Math.min(1, (HAZE_RISE * dt) / HAZE_CELL);
    // Spreading: a share to each side, held well under a quarter so it stays smooth and stable.
    const share = Math.min(0.2, HAZE_SPREAD * dt);
    for (let row = 0; row < HAZE_ROWS; row += 1) {
      const below = row + 1 < HAZE_ROWS ? row + 1 : row;
      for (let col = 0; col < HAZE_COLS; col += 1) {
        const at = row * HAZE_COLS + col;
        const here = haze[at]!;
        spread[at] = here + rise * ((below === row ? 0 : haze[below * HAZE_COLS + col]!) - here);
      }
    }
    for (let row = 0; row < HAZE_ROWS; row += 1) {
      for (let col = 0; col < HAZE_COLS; col += 1) {
        const at = row * HAZE_COLS + col;
        const here = spread[at]!;
        const left = col > 0 ? spread[at - 1]! : 0;
        const right = col + 1 < HAZE_COLS ? spread[at + 1]! : 0;
        const up = row > 0 ? spread[at - HAZE_COLS]! : 0;
        const down = row + 1 < HAZE_ROWS ? spread[at + HAZE_COLS]! : 0;
        const next = (here + share * (left + right + up + down - 4 * here)) * keep;
        haze[at] = next < DENSITY_FLOOR ? 0 : next;
      }
    }
  }

  function advance(dt: number): void {
    time += dt;
    const keep = Math.exp(-dt / TRAIL_SECONDS);
    for (let c = 0; c < density.length; c += 1) {
      const faded = density[c]! * keep;
      density[c] = faded < DENSITY_FLOOR ? 0 : faded;
    }
    moveHaze(dt);

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
      feedHaze(toX, toY, HAZE_RATE * strength * dt);
      // The higher it is the softer it gets: the wisps spread and thin as they rise.
      const blur = CELL * (0.4 + 1.4 * height * height);
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
    haze,
    get driftX() {
      return sceneDrift(seed, time).x;
    },
    get driftY() {
      return sceneDrift(seed, time).y;
    },
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

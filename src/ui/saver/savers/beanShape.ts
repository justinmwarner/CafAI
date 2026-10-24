/**
 * One roasted coffee bean, lit (D227, D264). A bean is a small solid:
 * an oval about 1.4 times as long as it is wide, a flat side with the centre
 * cut running down it (a fold, so a dark core between two lips), and a domed
 * back with no cut. It is lit as a still life is: a warm key light from the
 * upper left, a dim fill, a warm rim light from behind on the lower right
 * (the roaster's drum light behind the beans), and the glint of the key light
 * on the skin, strong on the oily dark roasts.
 *
 * Beanfield draws its beans from sprites made here, pixel by pixel:
 * beanGeometry() casts a ray from each pixel at the bean, rolled some way
 * about its long axis, and keeps where it lands (the surface's normal, and how
 * deep in the cut it is); shadeBean() lights that for a roast, with the light
 * coming from the side it will come from once the sprite is turned to the
 * bean's place on the screen (spriteView). The Bouncing Portafilter's corner
 * burst draws its few beans as paths instead (drawBean). Nothing here is newer
 * than Chromium 91's canvas, and nothing but drawBean touches a canvas at all.
 */
import { parseHex } from '../../color.ts';
import { createRandom } from '../random.ts';
import { createNoise } from './noise.ts';
import type { Roast } from './roasts.ts';

/** A bean's length over its width. */
export const BEAN_RATIO = 1.38;

/** The front has the cut; the back is the round side. */
export type BeanSide = 'front' | 'back';

// The solid, in half-widths: x along the bean (to ±BEAN_RATIO), y across
// (to ±1), z out of the flat side. The back is half an ellipsoid DOME deep,
// the flat side half of one only FACE deep, so it swells a little.
const DOME = 0.92;
const FACE = 0.2;
/** It rolls about its centre of mass, this far behind the flat side's rim. */
const AXIS = (3 / 8) * (DOME - FACE);
/** How far from that axis any of it reaches: the rim, across the middle. */
const REACH = Math.sqrt(1 + AXIS * AXIS);

// The cut down the flat side: a slow S, widest in the middle and closing
// toward the ends, sloping down to a fold whose core is all but black.
const CUT_SWAY = 0.1;
const CUT_HALF_WIDTH = 0.22;
const CUT_END = 0.86;
const CUT_DEPTH = 0.2;
const CUT_CORE = 0.92;
const CUT_CORE_WIDTH = 0.36;

/**
 * The skin's grain: smooth noise fixed to the solid (every bean has the same
 * skin, so its sprites can be shared), a little uneven in colour and blotchy
 * where the oil lies, so a glint breaks up as it does on a real bean. Where a
 * point is across the bean settles where it is on each half, so the grain is
 * worked out once into a table for each half, the first time it is wanted.
 */
const GRAIN_SCALE = 6.5;
const GRAIN_COLS = 168;
const GRAIN_ROWS = 122;
let grainTables: readonly [back: Float32Array, face: Float32Array] | null = null;

function makeGrainTables(): readonly [Float32Array, Float32Array] {
  const noise = createNoise(createRandom(0xbea4));
  return [DOME, FACE].map((depth) => {
    const table = new Float32Array(GRAIN_COLS * GRAIN_ROWS);
    const sign = depth === DOME ? -1 : 1;
    for (let row = 0; row < GRAIN_ROWS; row += 1) {
      const y = (row / (GRAIN_ROWS - 1)) * 2 - 1;
      for (let col = 0; col < GRAIN_COLS; col += 1) {
        const x = ((col / (GRAIN_COLS - 1)) * 2 - 1) * BEAN_RATIO;
        const z = sign * depth * Math.sqrt(Math.max(0, 1 - (x * x) / (BEAN_RATIO * BEAN_RATIO) - y * y));
        // Two scales of it, each the noise and the noise turned half round about the bean's
        // middle, added, so the grain too looks the same turned half round (shadeBean's `turned`).
        const gx = x * GRAIN_SCALE;
        const gy = y * GRAIN_SCALE;
        const gz = z * GRAIN_SCALE;
        const coarse = noise(gx, gy, gz) + noise(-gx, -gy, gz);
        const fine = noise(gx * 2.3, gy * 2.3, gz * 2.3 + 7.1) + noise(-gx * 2.3, -gy * 2.3, gz * 2.3 + 7.1);
        table[row * GRAIN_COLS + col] = Math.min(1, Math.max(0, 0.5 + 0.42 * (coarse + 0.5 * fine)));
      }
    }
    return table;
  }) as unknown as readonly [Float32Array, Float32Array];
}

/** The grain, about 0 to 1, at (x, y) on the back or the flat side: from its table, between its four nearest entries. */
function grainAt(onFace: boolean, x: number, y: number): number {
  grainTables ??= makeGrainTables();
  const table = grainTables[onFace ? 1 : 0];
  const col = Math.min(GRAIN_COLS - 1.001, Math.max(0, (x / BEAN_RATIO + 1) * 0.5 * (GRAIN_COLS - 1)));
  const row = Math.min(GRAIN_ROWS - 1.001, Math.max(0, (y + 1) * 0.5 * (GRAIN_ROWS - 1)));
  const c = col | 0;
  const r = row | 0;
  const fx = col - c;
  const fy = row - r;
  const at = r * GRAIN_COLS + c;
  const top = table[at]! + (table[at + 1]! - table[at]!) * fx;
  const bottom = table[at + GRAIN_COLS]! + (table[at + GRAIN_COLS + 1]! - table[at + GRAIN_COLS]!) * fx;
  return top + (bottom - top) * fy;
}

/** Room around a sprite's bean, px. */
export const SPRITE_PAD = 2;

/**
 * The sprites: frames of a bean rolling once about its long axis, and the
 * sides the key light may come from, half a turn of them (a bean turned half
 * round is the same bean rolled the other way: its solid, the S of its cut
 * included, looks the same turned half round about its middle).
 */
export const ROLL_FRAMES = 24;
export const SPIN_BINS = 4;
const ROLL_STEP = (2 * Math.PI) / ROLL_FRAMES;
const SPIN_STEP = Math.PI / SPIN_BINS;

type Vec3 = readonly [number, number, number];

function normalise(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/**
 * The lights, on the screen (x right, y down, z toward the viewer): the key
 * from the upper left and a little in front, the rim from behind on the lower
 * right. Their light is linear, 1 the key's full strength.
 */
export const KEY_LIGHT = normalise(-0.5, -0.62, 0.6);
const RIM_LIGHT = normalise(0.6, 0.62, -0.5);
const AMBIENT = 0.16;
/** The key's strength, so a side three quarters toward it shows the roast's own colour. */
const KEY = (1 - AMBIENT) / 0.75;
/** Light wraps a little past the side the key faces, as it does on a skin that is not quite matte. */
const WRAP = 0.3;
/** The back light: on a side turned to it, in the bean's own colour; on the edge it grazes, a warm glint of its own (the roast's rim). */
const BACK = 0.55;
const BACK_COLOUR: Vec3 = [1, 0.72, 0.45];
const RIM = 2.3;
const KEY_COLOUR: Vec3 = [1, 0.95, 0.88];
const GLINT_COLOUR: Vec3 = [1, 0.9, 0.76];

const mod = (value: number, by: number) => ((value % by) + by) % by;

/** Where a bean's silhouette reaches across its long axis, in half-widths from the axis it rolls on. */
export interface Extent {
  low: number;
  high: number;
}

/** The farthest any of a bean rolled by `roll` reaches toward +y on the screen (across it), from the axis. */
function reachToward(roll: number): number {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  // Each half of the solid reaches farthest on its curve while that point is on its own side, and else at the rim.
  const face = s <= 0 ? Math.sqrt(c * c + FACE * FACE * s * s) : Math.abs(c);
  const back = s >= 0 ? Math.sqrt(c * c + DOME * DOME * s * s) : Math.abs(c);
  return Math.max(face, back) - AXIS * s;
}

/** The bean's extent across its long axis on the screen, rolled by `roll` (0 shows the flat side): 2 wide face on, about 1.1 edge on. */
export function rollExtent(roll: number, out: Extent = { low: 0, high: 0 }): Extent {
  out.high = reachToward(roll);
  out.low = -reachToward(roll + Math.PI);
  return out;
}

/** One sprite's bean, unlit: per pixel, how much of it the bean covers, which way its surface faces and how open it is (the cut is not). */
export interface BeanGeometry {
  /** The sprite, px; the axis the bean rolls on runs across its middle. */
  width: number;
  height: number;
  /** The bean's length in it, px. */
  length: number;
  /** 0-255: how much of each pixel the bean covers. */
  coverage: Uint8Array;
  /** The surface's normal at each pixel, x then y; z toward the viewer is what is left of a unit vector. */
  normal: Float32Array;
  /** 0-255: 255 on open skin, less down in the cut. */
  open: Uint8Array;
  /** 0-255: the skin's grain at each pixel. */
  grain: Uint8Array;
  /** 0-255: how much of the key's glint the skin gives back there, the oil lying in patches, more on the round back than the flat side. */
  oil: Uint8Array;
}

/** The size of the sprite for a bean `length` px long: the same at every roll, so the frames line up. */
export function spriteSize(length: number): { width: number; height: number } {
  const perUnit = length / (2 * BEAN_RATIO);
  return { width: Math.ceil(length) + 2 * SPRITE_PAD, height: Math.ceil(2 * REACH * perUnit) + 2 * SPRITE_PAD };
}

/** Where a ray met the bean: the surface's normal on the screen, how open the skin is there, its grain and its oil. */
interface Hit {
  nx: number;
  ny: number;
  nz: number;
  open: number;
  grain: number;
  oil: number;
}

/**
 * The bean `length` px long, rolled by `roll` about its long axis (0 shows the
 * flat side, π the back). One ray goes through the middle of each pixel; a
 * pixel where its neighbours differ (the bean's edge, the cut, the rounded rim
 * of the flat side) is cast again with `samples` × `samples` rays, so the
 * edge and the cut are smooth even small.
 */
export function beanGeometry(length: number, roll: number, samples: number): BeanGeometry {
  const { width, height } = spriteSize(length);
  const perUnit = length / (2 * BEAN_RATIO);
  const pixels = width * height;
  const coverage = new Uint8Array(pixels);
  const normal = new Float32Array(pixels * 2);
  const open = new Uint8Array(pixels);
  const grain = new Uint8Array(pixels);
  const oil = new Uint8Array(pixels);
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const hit: Hit = { nx: 0, ny: 0, nz: 0, open: 1, grain: 0, oil: 0 };

  // The first look: one ray a pixel.
  const met = new Uint8Array(pixels);
  const STRIDE = 6;
  const first = new Float32Array(pixels * STRIDE);
  for (let row = 0; row < height; row += 1) {
    const y = (row + 0.5 - height / 2) / perUnit;
    for (let col = 0; col < width; col += 1) {
      if (!castRay((col + 0.5 - width / 2) / perUnit, y, cos, sin, hit)) continue;
      const at = row * width + col;
      const o = at * STRIDE;
      met[at] = 1;
      first[o] = hit.nx;
      first[o + 1] = hit.ny;
      first[o + 2] = hit.nz;
      first[o + 3] = hit.open;
      first[o + 4] = hit.grain;
      first[o + 5] = hit.oil;
    }
  }

  const n = Math.max(1, Math.round(samples));
  const each = 1 / (n * n);
  /** Whether the pixel at `at` and the one at `other` look alike: both missed, or both met open skin facing much the same way. */
  const alike = (at: number, other: number): boolean => {
    if (met[at] !== met[other]) return false;
    if (met[at] === 0) return true;
    const a = at * STRIDE;
    const b = other * STRIDE;
    if (first[a + 3]! < 0.995 || first[b + 3]! < 0.995) return false;
    return first[a]! * first[b]! + first[a + 1]! * first[b + 1]! + first[a + 2]! * first[b + 2]! > 0.985;
  };

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const at = row * width + col;
      const even =
        (col === 0 || alike(at, at - 1)) &&
        (col === width - 1 || alike(at, at + 1)) &&
        (row === 0 || alike(at, at - width)) &&
        (row === height - 1 || alike(at, at + width));
      if (even) {
        if (met[at] === 0) continue;
        const o = at * STRIDE;
        coverage[at] = 255;
        normal[at * 2] = first[o]!;
        normal[at * 2 + 1] = first[o + 1]!;
        open[at] = Math.round(first[o + 3]! * 255);
        grain[at] = Math.round(first[o + 4]! * 255);
        oil[at] = Math.round(first[o + 5]! * 255);
        continue;
      }
      // Uneven: cast it again, finely.
      let count = 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let sOpen = 0;
      let sGrain = 0;
      let sOil = 0;
      for (let j = 0; j < n; j += 1) {
        const y = (row + (j + 0.5) / n - height / 2) / perUnit;
        for (let i = 0; i < n; i += 1) {
          if (!castRay((col + (i + 0.5) / n - width / 2) / perUnit, y, cos, sin, hit)) continue;
          count += 1;
          sx += hit.nx;
          sy += hit.ny;
          sz += hit.nz;
          sOpen += hit.open;
          sGrain += hit.grain;
          sOil += hit.oil;
        }
      }
      if (count === 0) continue;
      const size = Math.sqrt(sx * sx + sy * sy + Math.max(sz, 1e-6) ** 2);
      coverage[at] = Math.round(count * each * 255);
      normal[at * 2] = sx / size;
      normal[at * 2 + 1] = sy / size;
      open[at] = Math.round((sOpen / count) * 255);
      grain[at] = Math.round((sGrain / count) * 255);
      oil[at] = Math.round((sOil / count) * 255);
    }
  }
  return { width, height, length, coverage, normal, open, grain, oil };
}

const A2 = BEAN_RATIO * BEAN_RATIO;

/**
 * One ray, straight at the screen through (x, y) in half-widths from the
 * bean's axis: whether it meets the bean, and if so where (into `hit`). The
 * solid is convex and lies inside the ellipsoid of its back, so the ray meets
 * the back where it meets that ellipsoid behind the rim, and else the flat
 * side, if anything.
 */
function castRay(x: number, y: number, cos: number, sin: number, hit: Hit): boolean {
  const room = 1 - (x * x) / A2;
  if (room <= 0) return false;
  // Along the ray (t toward the viewer), in the bean's own frame: y' = p + sin t, z' = u + cos t.
  const p = y * cos;
  const u = -y * sin - AXIS;
  return meet(DOME, x, p, u, room, cos, sin, hit) || meet(FACE, x, p, u, room, cos, sin, hit);
}

/** The ray meeting the half of the solid that is `depth` deep (the back or the flat side), if it does on that half. */
function meet(depth: number, x: number, p: number, u: number, room: number, cos: number, sin: number, hit: Hit): boolean {
  const k2 = depth * depth;
  const qa = sin * sin + (cos * cos) / k2;
  const qb = p * sin + (u * cos) / k2;
  const qc = p * p + (u * u) / k2 - room;
  const disc = qb * qb - qa * qc;
  if (disc < 0) return false;
  const t = (-qb + Math.sqrt(disc)) / qa;
  const by = p + sin * t;
  const bz = u + cos * t;
  if (depth === DOME ? bz > 0 : bz < 0) return false;
  let nx = x / A2;
  let ny = by;
  let nz = bz / k2;
  let size = Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx /= size;
  ny /= size;
  nz /= size;
  hit.open = 1;
  if (depth === FACE) {
    // Tipped into the cut where the ray is in it: hit.nx and ny come back as the slope to take off.
    hit.nx = 0;
    hit.ny = 0;
    cut(x, by, hit);
    nx -= hit.nx;
    ny -= hit.ny;
    size = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= size;
    ny /= size;
    nz /= size;
  }
  // Rolled back onto the screen.
  let sy = ny * cos - nz * sin;
  let sz = ny * sin + nz * cos;
  if (sz < 0) {
    // A slope of the cut seen past edge on: no farther than edge on.
    const across = Math.sqrt(nx * nx + sy * sy);
    nx /= across;
    sy /= across;
    sz = 0;
  }
  hit.nx = nx;
  hit.ny = sy;
  hit.nz = sz;
  const grain = grainAt(depth === FACE, x, by);
  hit.grain = grain;
  // The oil: in patches along the grain, smooth on the round back, sparse on the wrinkled flat side.
  hit.oil = depth === DOME ? 0.45 + 0.55 * smoothstep(0.3, 0.75, grain) : 0.12 + 0.48 * smoothstep(0.5, 0.85, grain);
  return true;
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * The cut at (x, y) on the flat side: the slope of the fold there (into
 * `hit.nx` and `hit.ny`, to take off the normal) and how open the skin is
 * (into `hit.open`), both left alone outside it.
 */
function cut(x: number, y: number, hit: Hit): void {
  const end = CUT_END * BEAN_RATIO;
  if (Math.abs(x) >= end) return;
  const along = x / end;
  const half = CUT_HALF_WIDTH * (1 - along * along);
  const wave = (Math.PI * x) / BEAN_RATIO;
  const centre = CUT_SWAY * Math.sin(wave);
  const across = (y - centre) / half;
  if (Math.abs(across) >= 1) return;
  // Down into the fold: h = -DEPTH (1 + cos πu) / 2 across it, so its slopes face its middle.
  const slope = ((CUT_DEPTH * Math.PI) / 2) * Math.sin(Math.PI * across);
  const centreSlope = ((CUT_SWAY * Math.PI) / BEAN_RATIO) * Math.cos(wave);
  const halfSlope = (-2 * CUT_HALF_WIDTH * along) / end;
  hit.nx = (slope * -(centreSlope + across * halfSlope)) / half;
  hit.ny = slope / half;
  hit.open = 1 - CUT_CORE * Math.exp(-((across / CUT_CORE_WIDTH) ** 2));
}

/** A roast's bean, ready to light: its colours as linear light. */
export interface BeanLook {
  body: Vec3;
  crease: Vec3;
  rim: Vec3;
  /** The glint: its strength, and how tight it is. */
  glint: number;
  shine: number;
  /** A broad, faint sheen under the glint. */
  sheen: number;
}

function toLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linear(hex: string): Vec3 {
  const [r, g, b] = parseHex(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

export function beanLook(roast: Roast): BeanLook {
  return {
    body: linear(roast.body),
    crease: linear(roast.crease),
    rim: linear(roast.rim),
    glint: 0.1 + 1.1 * roast.gloss,
    shine: 24 + 90 * roast.gloss,
    sheen: 0.02 + 0.05 * roast.gloss,
  };
}

/** The lights in a sprite's own frame: the screen's turned back by the turn the sprite will be shown at. */
export interface BeanLight {
  key: Vec3;
  half: Vec3;
  rim: Vec3;
}

/** The lights for a sprite that will be shown turned by `turn` (rad, clockwise on the screen). */
export function beanLight(turn: number): BeanLight {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const back = ([x, y, z]: Vec3): Vec3 => [x * c + y * s, -x * s + y * c, z];
  const key = back(KEY_LIGHT);
  return { key, half: normalise(key[0], key[1], key[2] + 1), rim: back(RIM_LIGHT) };
}

/** Linear light to an sRGB byte, through a table; past 0.8 eased toward white rather than cut. */
const ENCODE_SIZE = 4096;
const ENCODE_TOP = 1.6;
const ENCODE_SCALE = (ENCODE_SIZE - 1) / ENCODE_TOP;
const ENCODE = (() => {
  const table = new Uint8Array(ENCODE_SIZE);
  for (let i = 0; i < ENCODE_SIZE; i += 1) {
    let v = i / ENCODE_SCALE;
    if (v > 0.8) v = 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2));
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    table[i] = Math.round(Math.min(1, c) * 255);
  }
  return table;
})();

/** The glint and the sheen, by how squarely the surface faces halfway between the key and the viewer: a table, not a pow() a pixel. */
const GLINT_SIZE = 512;

function glintTable(look: BeanLook): Float32Array {
  const table = new Float32Array(GLINT_SIZE);
  for (let i = 0; i < GLINT_SIZE; i += 1) {
    const facing = i / (GLINT_SIZE - 1);
    table[i] = look.glint * facing ** look.shine + look.sheen * facing ** 6;
  }
  return table;
}

/** How the grain shades the skin, a little darker or lighter, by grain 0 to 255. */
const MOTTLE = new Float32Array(256);
for (let i = 0; i < 256; i += 1) MOTTLE[i] = 0.93 + (0.14 * i) / 255;

/**
 * Lights `geometry` as `look` under `light`, into `out` (RGBA, straight
 * alpha, the geometry's size). `turned` lights it turned half round in its
 * sprite instead: a bean looks the same turned half round about its middle,
 * so the frame at roll -θ is the frame at θ turned, and needs no rays of its
 * own.
 */
export function shadeBean(geometry: BeanGeometry, look: BeanLook, light: BeanLight, out: Uint8ClampedArray, turned = false): void {
  const { coverage, normal, open, grain, oil } = geometry;
  const last = coverage.length - 1;
  const flip = turned ? -1 : 1;
  const [kx, ky, kz] = light.key;
  const [hx, hy, hz] = light.half;
  const [rx, ry, rz] = light.rim;
  const glints = glintTable(look);
  // The body under the key, and under the back light.
  const br = look.body[0] * KEY_COLOUR[0];
  const bg = look.body[1] * KEY_COLOUR[1];
  const bb = look.body[2] * KEY_COLOUR[2];
  const ar = look.body[0] * BACK_COLOUR[0];
  const ag = look.body[1] * BACK_COLOUR[1];
  const ab = look.body[2] * BACK_COLOUR[2];
  const [cr, cg, cb] = look.crease;
  const rr = look.rim[0] * RIM;
  const rg = look.rim[1] * RIM;
  const rb = look.rim[2] * RIM;
  const top = ENCODE_SIZE - 1;
  const glintTop = GLINT_SIZE - 1;
  out.fill(0);
  for (let to = 0; to <= last; to += 1) {
    const at = turned ? last - to : to;
    const covered = coverage[at]!;
    if (covered === 0) continue;
    const nx = flip * normal[at * 2]!;
    const ny = flip * normal[at * 2 + 1]!;
    const nz2 = 1 - nx * nx - ny * ny;
    const nz = nz2 > 0 ? Math.sqrt(nz2) : 0;
    const skin = open[at]! / 255;
    const spot = grain[at]!;
    const facing = nx * kx + ny * ky + nz * kz;
    const diffuse = facing > -WRAP ? (facing + WRAP) / (1 + WRAP) : 0;
    const lit = (AMBIENT + KEY * diffuse) * skin * MOTTLE[spot]!;
    const half = nx * hx + ny * hy + nz * hz;
    const glint = half > 0 ? (glints[(half * glintTop + 0.5) | 0]! * skin * skin * oil[at]!) / 255 : 0;
    // The back light: a side turned to it takes it in its own colour; only the edge it grazes glints.
    const toBack = nx * rx + ny * ry + nz * rz;
    const back = toBack > 0 ? BACK * toBack * skin : 0;
    const edge = (1 - nz) * (1 - nz);
    const rim = toBack > 0 ? toBack * toBack * edge * edge * skin : 0;
    const fold = (1 - skin) * (AMBIENT + 0.35 * diffuse);
    const r = br * lit + ar * back + cr * fold + glint * GLINT_COLOUR[0] + rr * rim;
    const g = bg * lit + ag * back + cg * fold + glint * GLINT_COLOUR[1] + rg * rim;
    const b = bb * lit + ab * back + cb * fold + glint * GLINT_COLOUR[2] + rb * rim;
    const o = to * 4;
    out[o] = ENCODE[r < ENCODE_TOP ? (r * ENCODE_SCALE + 0.5) | 0 : top]!;
    out[o + 1] = ENCODE[g < ENCODE_TOP ? (g * ENCODE_SCALE + 0.5) | 0 : top]!;
    out[o + 2] = ENCODE[b < ENCODE_TOP ? (b * ENCODE_SCALE + 0.5) | 0 : top]!;
    out[o + 3] = covered;
  }
}

/** The sprite a bean is drawn from, and how to show it. */
export interface SpriteView {
  /** The roll frame (0 to ROLL_FRAMES - 1) and the key light's bin (0 to SPIN_BINS - 1). */
  frame: number;
  bin: number;
  /** The sprite's turn on the screen, rad: within half a bin of the turn it was lit for. */
  turn: number;
  /** The roll the bean is at, as this sprite sees it: the frame's own is within half a frame of it. */
  roll: number;
}

export function emptyView(): SpriteView {
  return { frame: 0, bin: 0, turn: 0, roll: 0 };
}

/**
 * The sprite that shows a bean turned by `spin` (its long axis's angle on
 * the screen) and rolled by `roll`, written into `out`: the frame nearest its
 * roll, lit for the turn nearest its own. A bean turned half round is shown
 * as the bean rolled the other way, turned back half round.
 */
export function spriteView(spin: number, roll: number, out: SpriteView): SpriteView {
  const turn = mod(spin, 2 * Math.PI);
  const bin = Math.round(turn / SPIN_STEP) % (2 * SPIN_BINS);
  const over = bin >= SPIN_BINS;
  out.bin = over ? bin - SPIN_BINS : bin;
  out.turn = over ? turn - Math.PI : turn;
  out.roll = mod(over ? -roll : roll, 2 * Math.PI);
  out.frame = Math.round(out.roll / ROLL_STEP) % ROLL_FRAMES;
  return out;
}

/** The turn a bin's sprites are lit for. */
export function binTurn(bin: number): number {
  return bin * SPIN_STEP;
}

/** The roll a frame shows. */
export function frameRoll(frame: number): number {
  return frame * ROLL_STEP;
}

/** The frame whose rays a frame is lit from: the second half of a roll is the first half turned half round (shadeBean's `turned`). */
export function sourceFrame(frame: number): number {
  return frame <= ROLL_FRAMES / 2 ? frame : ROLL_FRAMES - frame;
}

export function isTurnedFrame(frame: number): boolean {
  return frame > ROLL_FRAMES / 2;
}

/** The turn of the context drawn into, where the browser can say it (getTransform): 0 where it cannot. */
function turnOf(ctx: CanvasRenderingContext2D): number {
  if (typeof ctx.getTransform !== 'function') return 0;
  const m = ctx.getTransform();
  return Math.atan2(m.b, m.a);
}

/**
 * A bean drawn as it is, with paths, centred on the origin with its long
 * axis along x: the Bouncing Portafilter's few burst beans. Lit as the
 * sprites are, from the upper left of the screen whatever the context's turn
 * (where the browser can tell it): the body rounded by a gradient, a rim
 * light along its lower right, on the front the cut (a dark core, its far
 * slope catching the light), and on the oily roasts a glint.
 */
export function drawBean(ctx: CanvasRenderingContext2D, length: number, roast: Roast, side: BeanSide): void {
  const rx = length / 2;
  const ry = rx / BEAN_RATIO;
  // The key light's direction in the bean's own frame.
  const keyAngle = Math.atan2(KEY_LIGHT[1], KEY_LIGHT[0]) - turnOf(ctx);
  const lx = Math.cos(keyAngle);
  const ly = Math.sin(keyAngle);

  ctx.save();
  // The body: a round gradient squeezed into the oval, brightest toward the light.
  ctx.save();
  ctx.scale(1, ry / rx);
  const body = ctx.createRadialGradient(lx * rx * 0.42, ly * rx * 0.42, rx * 0.05, -lx * rx * 0.1, -ly * rx * 0.1, rx * 1.08);
  body.addColorStop(0, roast.highlight);
  body.addColorStop(0.5, roast.body);
  body.addColorStop(1, roast.shade);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The rim light, along the edge away from the key.
  const away = Math.atan2(-ly * rx, -lx * ry);
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(0.5, rx - 0.6), Math.max(0.5, ry - 0.6), 0, away - 1.1, away + 1.1);
  ctx.lineWidth = Math.max(1, length * 0.045);
  ctx.lineCap = 'round';
  ctx.strokeStyle = roast.rim;
  ctx.globalAlpha *= 0.85;
  ctx.stroke();
  ctx.globalAlpha /= 0.85;

  if (side === 'front') {
    // The cut: an S along the long axis; its far slope lit, then its dark core.
    const crease = () => {
      ctx.beginPath();
      ctx.moveTo(-0.86 * rx, 0);
      ctx.bezierCurveTo(-0.45 * rx, -0.34 * ry, -0.2 * rx, -0.26 * ry, 0, 0);
      ctx.bezierCurveTo(0.2 * rx, 0.26 * ry, 0.45 * rx, 0.34 * ry, 0.86 * rx, 0);
    };
    const width = Math.max(1, length * 0.065);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.save();
    ctx.translate(-lx * width * 0.6, -ly * width * 0.6);
    ctx.lineWidth = width;
    ctx.strokeStyle = roast.highlight;
    ctx.globalAlpha *= 0.55;
    crease();
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = width * 0.75;
    ctx.strokeStyle = roast.crease;
    crease();
    ctx.stroke();
  }

  if (roast.gloss > 0.15) {
    // The glint of the key light on an oily skin.
    const gx = lx * rx * 0.38;
    const gy = ly * ry * 0.45;
    const spot = ctx.createRadialGradient(gx, gy, 0, gx, gy, ry * 0.5);
    spot.addColorStop(0, `rgba(255, 246, 230, ${Math.min(0.85, roast.gloss)})`);
    spot.addColorStop(1, 'rgba(255, 246, 230, 0)');
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(gx, gy, ry * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Rising Steam's still life (D-STEAM-1), pure: a porcelain cup of coffee on
 * its saucer, on a table never seen but for the shadow on it, lit by a warm
 * key light behind the cup and above it (the light the steam glows in) and a
 * soft fill from the front. It is rendered once, per pixel, at the screen's
 * scale (steam.ts does it whenever the size changes) into two straight-alpha
 * RGBA images: everything, and the cup's near side alone, which steam.ts lays
 * over the steam, so that steam low in the cup stays behind its near wall.
 *
 * How. The cup and the saucer are solids of revolution seen from a little
 * above (VIEW_SIN) with no perspective, so each is its profile (radius against
 * height) turned about the axis, and the visible surface along any column of
 * the image comes from rasterizing the profile into a depth buffer for that
 * column, two samples a pixel each way. The handle is a tube along a curve
 * beside the cup. Each sample is shaded: the glaze as a wrapped diffuse (the
 * soft light porcelain lets through) and a Fresnel reflection of the room and
 * its two lights; the coffee as its crema, a pale ring at the wall and a
 * lighter swirl; soft shadows from the key light found against the profiles;
 * and the table as nothing but its shadow. A pixel whose samples all see the
 * same thing is shaded once.
 *
 * Units: the still life's own, CUP_SCALE design pixels each (steamModel.ts);
 * the images come out in device pixels. World space: X right, Y up from the
 * table, Z toward the eye; the images': x right and y down from the middle of
 * the cup's rim.
 */
import { parseHex } from '../../color.ts';
import { createRandom } from '../random.ts';
import { createNoise, type Noise3 } from './noise.ts';
import { COFFEE_DROP, CUP_SCALE, MOUTH_HALF_WIDTH, RIM_HALF_WIDTH, VIEW_COS, VIEW_SIN } from './steamModel.ts';

const SIN = VIEW_SIN;
const COS = VIEW_COS;

/** The rim and the mouth, in the still life's units. */
const RIM_R = RIM_HALF_WIDTH / CUP_SCALE;
const MOUTH_R = MOUTH_HALF_WIDTH / CUP_SCALE;
/** Heights above the table: the saucer's flat middle the cup stands in, the top of the cup's foot, the top of its lip, the coffee. */
const WELL = 4;
const FOOT_TOP = 9;
export const RIM_TOP = 88;
const LIP = (RIM_R - MOUTH_R) / 2;
const LIP_MIDDLE = RIM_R - LIP;
const WALL_TOP = RIM_TOP - LIP;
export const COFFEE_LEVEL = RIM_TOP - COFFEE_DROP / CUP_SCALE;
/** The saucer: its outer edge, and the round bead along it. */
export const SAUCER_RADIUS = 136;
const BEAD = 3.8;
const BEAD_R = SAUCER_RADIUS - BEAD;
export const BEAD_Y = 9.8;
/** Where the saucer's underside meets the table. */
const SAUCER_FOOT = 64;
/** On the screen, in design units below the middle of the rim: the saucer's near edge, and the table straight under the rim. */
export const SAUCER_BELOW_RIM = ((RIM_TOP - BEAD_Y) * COS + SAUCER_RADIUS * SIN) * CUP_SCALE;
export const TABLE_BELOW_RIM = RIM_TOP * COS * CUP_SCALE;
/** The cup's foot, bottom and top. */
const FOOT_BOTTOM_R = 31;
const FOOT_TOP_R = 32.5;

/** Where a point of the still life's world shows on the screen, in design units from the middle of the rim, y down. */
export function onScreen(x: number, y: number, z: number): { x: number; y: number } {
  return { x: x * CUP_SCALE, y: (RIM_TOP * COS - (y * COS - z * SIN)) * CUP_SCALE };
}

/** What a sample sees. */
const NOTHING = 0;
const OUTER = 1;
const LIP_PART = 2;
const INNER = 3;
const COFFEE = 4;
const SAUCER_TOP = 5;
const SAUCER_BEAD = 6;
const SAUCER_UNDER = 7;
const HANDLE = 8;

/** The image's extent round the middle of the rim (units): the saucer, and the shadow the cup throws forward. */
const EXTENT_LEFT = 148;
const EXTENT_RIGHT = 170;
const EXTENT_UP = 34;
const EXTENT_DOWN = 158;

/** Samples a pixel each way. */
const SUB = 2;

type Vec = [number, number, number];

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalize(v: Vec): Vec {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Toward the eye. */
const VIEW: Vec = [0, SIN, COS];

/**
 * The lights (D-STEAM-1). The key: warm, behind the cup, a little above it and
 * to the left, near enough that its angle changes across the cup: it lights
 * the steam from behind, rims the cup and lies low across the saucer. The
 * fill: a soft, cooler light from in front and to the right. The strip: a tall
 * narrow light in front and to the left, seen only in the glaze, as a
 * highlight down the cup. The room: dark, the page's colour, a little lighter
 * overhead.
 */
export const KEY_AT: Vec = [-190, 175, -540];
const KEY: Vec = [1.7, 1.26, 0.79];
/** The key's distance from the cup's middle, squared: where it reaches at full strength. */
const KEY_DISTANCE_SQUARED = KEY_AT[0] * KEY_AT[0] + (KEY_AT[1] - 50) * (KEY_AT[1] - 50) + KEY_AT[2] * KEY_AT[2];
/** The key is a spot on the cup: full within KEY_FULL of its aim (as a cosine), nothing past KEY_EDGE, so the saucer's rim falls into the dark. */
const KEY_AIM: Vec = normalize([-KEY_AT[0], 62 - KEY_AT[1], -KEY_AT[2]]);
const KEY_FULL = Math.cos((4 * Math.PI) / 180);
const KEY_EDGE = Math.cos((14 * Math.PI) / 180);
const FILL_TOWARD: Vec = normalize([0.5, 0.26, 0.83]);
const FILL: Vec = [0.74, 0.75, 0.8];
/** The strip's bearing from the eye (radians, left is negative), how narrow it shows, and its brightness. */
const STRIP_BEARING = -0.62;
const STRIP_WIDTH = 0.09;
const STRIP: Vec = [1.05, 1.03, 1.0];
const SKY: Vec = [0.075, 0.073, 0.073];
const BOUNCE: Vec = [0.06, 0.042, 0.028];
/** The glaze: a warm white; how far light wraps round it; how much it reflects head-on. */
const GLAZE: Vec = [0.84, 0.8, 0.72];
const WRAP = 0.2;
const GLAZE_F0 = 0.045;
/** The coffee's colours: its dark body, the crema at the wall, the swirl's paler crema (linear). */
const COFFEE_DARK: Vec = [0.026, 0.011, 0.0045];
const CREMA: Vec = [0.46, 0.22, 0.075];
const CREMA_PALE: Vec = [0.66, 0.41, 0.18];
const COFFEE_F0 = 0.03;
/** Crema is foam, nearly matte: of the sheen a liquid at that angle would show, the coffee keeps this much. */
const COFFEE_SHEEN = 0.4;
/** The soft light the coffee gets from the fill, in front, whatever the fill's angle. */
const COFFEE_FILL = 0.42;
/** How dark the table's shadow is at its darkest, and its soft contact round the saucer. */
const SHADOW_DARK = 0.62;
const CONTACT_DARK = 0.42;
/** Exposure before the tone curve. */
const EXPOSURE = 1;

/** The key's direction from the cup as a whole, for what the glaze reflects. */
const KEY_FROM_CUP = normalize([KEY_AT[0], KEY_AT[1] - RIM_TOP * 0.6, KEY_AT[2]]);

function bezier(t: number, a: number, b: number, c: number, d: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** A profile: radius and height along it, its outward normal, and what each piece is. */
interface Profile {
  count: number;
  r: Float64Array;
  y: Float64Array;
  nr: Float64Array;
  ny: Float64Array;
  part: Uint8Array;
}

function profileFrom(points: ReadonlyArray<readonly [number, number, number, number, number]>): Profile {
  const count = points.length;
  const profile: Profile = {
    count,
    r: new Float64Array(count),
    y: new Float64Array(count),
    nr: new Float64Array(count),
    ny: new Float64Array(count),
    part: new Uint8Array(count),
  };
  points.forEach(([r, y, nr, ny, part], i) => {
    const length = Math.hypot(nr, ny) || 1;
    profile.r[i] = r;
    profile.y[i] = y;
    profile.nr[i] = nr / length;
    profile.ny[i] = ny / length;
    profile.part[i] = part;
  });
  return profile;
}

/** The bowl's outer wall, foot to lip: a cubic from (FOOT_TOP_R, FOOT_TOP) to (RIM_R, WALL_TOP), steep near the rim and round below. */
const BOWL_R = [FOOT_TOP_R, 66, 75.6, RIM_R] as const;
const BOWL_Y = [FOOT_TOP, 18, 66, WALL_TOP] as const;

/** The cup's outer radius at a height, lip and foot included; 0 above and below it. */
export function outerRadius(y: number): number {
  if (y < WELL || y > RIM_TOP) return 0;
  if (y <= FOOT_TOP) return FOOT_BOTTOM_R + ((FOOT_TOP_R - FOOT_BOTTOM_R) * (y - WELL)) / (FOOT_TOP - WELL);
  if (y >= WALL_TOP) return LIP_MIDDLE + Math.sqrt(Math.max(0, LIP * LIP - (y - WALL_TOP) * (y - WALL_TOP)));
  // The bowl's cubic is monotonic in height: find its parameter by halving.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, ...BOWL_Y) < y) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, ...BOWL_R);
}

/** The cup's inner radius at a height, from the coffee up through the lip; 0 where there is no hollow. */
export function innerRadius(y: number): number {
  if (y < COFFEE_LEVEL || y > RIM_TOP) return 0;
  if (y >= WALL_TOP) return LIP_MIDDLE - Math.sqrt(Math.max(0, LIP * LIP - (y - WALL_TOP) * (y - WALL_TOP)));
  return outerRadius(y) - 2 * LIP;
}

/** Half the coffee's width: the hollow's radius at the coffee. */
export const COFFEE_RADIUS = outerRadius(COFFEE_LEVEL) - 2 * LIP;

function cupProfile(): Profile {
  const points: [number, number, number, number, number][] = [];
  // The foot's outer face, bottom to top, leaning in a little.
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    points.push([FOOT_BOTTOM_R + (FOOT_TOP_R - FOOT_BOTTOM_R) * t, WELL + (FOOT_TOP - WELL) * t, FOOT_TOP - WELL, -(FOOT_TOP_R - FOOT_BOTTOM_R), OUTER]);
  }
  // The bowl, foot to lip.
  const bowl = 64;
  for (let i = 1; i <= bowl; i += 1) {
    const t = i / bowl;
    const dt = 1e-4;
    const dr = bezier(Math.min(1, t + dt), ...BOWL_R) - bezier(Math.max(0, t - dt), ...BOWL_R);
    const dy = bezier(Math.min(1, t + dt), ...BOWL_Y) - bezier(Math.max(0, t - dt), ...BOWL_Y);
    points.push([bezier(t, ...BOWL_R), bezier(t, ...BOWL_Y), dy, -dr, OUTER]);
  }
  // The lip: a half round over the top, outside to inside.
  const round = 20;
  for (let i = 1; i < round; i += 1) {
    const angle = (Math.PI * i) / round;
    points.push([LIP_MIDDLE + LIP * Math.cos(angle), WALL_TOP + LIP * Math.sin(angle), Math.cos(angle), Math.sin(angle), LIP_PART]);
  }
  // The inner wall, lip down to the coffee: the outer wall's taper, a wall's thickness in.
  const inner = 8;
  for (let i = 0; i <= inner; i += 1) {
    const y = WALL_TOP + (COFFEE_LEVEL - WALL_TOP) * (i / inner);
    const slope = (outerRadius(y + 0.05) - outerRadius(y - 0.05)) / 0.1;
    points.push([outerRadius(y) - 2 * LIP, y, -1, slope, INNER]);
  }
  // The coffee, wall to middle.
  const across = 6;
  for (let i = 0; i <= across; i += 1) points.push([COFFEE_RADIUS * (1 - i / across), COFFEE_LEVEL, 0, 1, COFFEE]);
  return profileFrom(points);
}

/** The saucer's top: flat in the well, rising in a shallow dish to the bead. */
const DISH_FROM = 46;
const BEAD_START_ANGLE = (165 * Math.PI) / 180;
const DISH_TO = BEAD_R + BEAD * Math.cos(BEAD_START_ANGLE);
const DISH_TOP = BEAD_Y + BEAD * Math.sin(BEAD_START_ANGLE);
const DISH_POWER = 1.7;

function dishHeight(r: number): number {
  if (r <= DISH_FROM) return WELL;
  return WELL + (DISH_TOP - WELL) * Math.pow((r - DISH_FROM) / (DISH_TO - DISH_FROM), DISH_POWER);
}

function saucerProfile(): Profile {
  const points: [number, number, number, number, number][] = [];
  const well = 2;
  for (let i = 0; i <= well; i += 1) points.push([(DISH_FROM * i) / well, WELL, 0, 1, SAUCER_TOP]);
  const dish = 32;
  for (let i = 1; i <= dish; i += 1) {
    const r = DISH_FROM + ((DISH_TO - DISH_FROM) * i) / dish;
    const slope = (dishHeight(r + 0.05) - dishHeight(r - 0.05)) / 0.1;
    points.push([r, dishHeight(r), -slope, 1, SAUCER_TOP]);
  }
  // The bead, over the top and down round its outer side.
  const bead = 28;
  const endAngle = -Math.PI / 2;
  for (let i = 1; i <= bead; i += 1) {
    const angle = BEAD_START_ANGLE + ((endAngle - BEAD_START_ANGLE) * i) / bead;
    points.push([BEAD_R + BEAD * Math.cos(angle), BEAD_Y + BEAD * Math.sin(angle), Math.cos(angle), Math.sin(angle), SAUCER_BEAD]);
  }
  // The underside, in toward the foot ring: hidden but for its outer edge.
  const under = 3;
  for (let i = 1; i <= under; i += 1) {
    const r = BEAD_R - ((BEAD_R - SAUCER_FOOT) * i) / under;
    const y = BEAD_Y - BEAD - ((BEAD_Y - BEAD) * i) / under;
    points.push([r, y, -0.1, -1, SAUCER_UNDER]);
  }
  return profileFrom(points);
}

/** Tables of the cup's outer and inner radius by height, for the shadows. */
const TABLE_STEP = 0.25;
const TABLE_SIZE = Math.ceil((RIM_TOP - WELL) / TABLE_STEP) + 2;
let tables: { outer: Float64Array; inner: Float64Array } | null = null;

function radiusTables(): { outer: Float64Array; inner: Float64Array } {
  if (!tables) {
    const outer = new Float64Array(TABLE_SIZE);
    const inner = new Float64Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const y = WELL + i * TABLE_STEP;
      outer[i] = outerRadius(y);
      inner[i] = innerRadius(y);
    }
    tables = { outer, inner };
  }
  return tables;
}

function tableAt(table: Float64Array, y: number): number {
  const at = (y - WELL) / TABLE_STEP;
  if (at <= 0) return table[0]!;
  const i = Math.floor(at);
  if (i >= TABLE_SIZE - 1) return table[TABLE_SIZE - 1]!;
  const f = at - i;
  return table[i]! * (1 - f) + table[i + 1]! * f;
}

/** The saucer's outline radius at a height, for the table's shadow. */
function saucerRadius(y: number): number {
  if (y < 0 || y > BEAD_Y + BEAD) return 0;
  if (y >= BEAD_Y - BEAD) {
    const dy = y - BEAD_Y;
    return BEAD_R + Math.sqrt(Math.max(0, BEAD * BEAD - dy * dy));
  }
  return SAUCER_FOOT + ((BEAD_R - SAUCER_FOOT) * y) / (BEAD_Y - BEAD);
}

/** The handle: a tube along a curve beside the cup, in the plane through its axis, joining the wall at two heights. */
const HANDLE_UPPER = RIM_TOP - 17;
const HANDLE_LOWER = RIM_TOP - 53;
const HANDLE_THICK = 5;
const HANDLE_POINTS = 40;

interface Handle {
  /** Centreline points in the world (Z = 0), and their height on the image (v, up). */
  x: Float64Array;
  y: Float64Array;
  v: Float64Array;
  /** The tube's radius at each point: a little fuller where it meets the cup. */
  radius: Float64Array;
}

function handleCurve(): Handle {
  const upperR = outerRadius(HANDLE_UPPER);
  const lowerR = outerRadius(HANDLE_LOWER);
  const px = [upperR - 4, upperR + 34, lowerR + 44, lowerR - 4] as const;
  const py = [HANDLE_UPPER, HANDLE_UPPER + 6, HANDLE_LOWER - 9, HANDLE_LOWER] as const;
  const handle: Handle = {
    x: new Float64Array(HANDLE_POINTS + 1),
    y: new Float64Array(HANDLE_POINTS + 1),
    v: new Float64Array(HANDLE_POINTS + 1),
    radius: new Float64Array(HANDLE_POINTS + 1),
  };
  for (let i = 0; i <= HANDLE_POINTS; i += 1) {
    const t = i / HANDLE_POINTS;
    const y = bezier(t, ...py);
    handle.x[i] = bezier(t, ...px);
    handle.y[i] = y;
    handle.v[i] = y * COS;
    // Fuller at the two joins, slimmest partway round.
    handle.radius[i] = HANDLE_THICK * (1 + 0.32 * Math.exp(-((t / 0.12) ** 2)) + 0.22 * Math.exp(-(((1 - t) / 0.1) ** 2)) - 0.08 * Math.sin(Math.PI * t));
  }
  return handle;
}

/** The cup's shadow's soft edge (units): this wide where it begins, and wider by this much a unit away from the cup (the key is a broad light). */
const PENUMBRA_NEAR = 1.8;
const PENUMBRA_GROWTH = 0.1;

/** The light from the key reaching a point outside the cup, 0 to 1, as the cup's body lets it by. */
export function cupShadow(px: number, py: number, pz: number, lx: number, ly: number, lz: number): number {
  if (ly <= 0.01) return 1;
  // Where the way to the light passes nearest the cup's axis, seen from above: well clear of the rim, nothing to march.
  const across = lx * lx + lz * lz;
  const nearest = across > 0 ? Math.max(0, -(px * lx + pz * lz) / across) : 0;
  const nx = px + nearest * lx;
  const nz = pz + nearest * lz;
  const reach = RIM_R + PENUMBRA_NEAR + 0.2 + PENUMBRA_GROWTH * Math.max(0, (RIM_TOP - py) / ly);
  if (nx * nx + nz * nz > reach * reach) return 1;
  const { outer } = radiusTables();
  let light = 1;
  const from = Math.max(py, WELL);
  const steps = 24;
  for (let k = 0; k <= steps; k += 1) {
    const y = from + ((RIM_TOP - from) * k) / steps;
    const s = (y - py) / ly;
    if (s < 0.5) continue;
    const qx = px + s * lx;
    const qz = pz + s * lz;
    const margin = Math.sqrt(qx * qx + qz * qz) - tableAt(outer, y);
    // The farther the cup is from the point, the softer its edge.
    const soft = PENUMBRA_NEAR + PENUMBRA_GROWTH * s;
    light = Math.min(light, smoothstep(-soft, soft, margin));
    if (light <= 0) return 0;
  }
  return light;
}

/** The same from the cup's own walls for a point inside it (the coffee, the inner wall): the light must leave by the mouth. */
function cavityShadow(px: number, py: number, pz: number, lx: number, ly: number, lz: number): number {
  if (ly <= 0.01) return 0;
  const { inner } = radiusTables();
  let light = 1;
  const steps = 10;
  for (let k = 1; k <= steps; k += 1) {
    const y = py + ((RIM_TOP - py) * k) / steps;
    const s = (y - py) / ly;
    const qx = px + s * lx;
    const qz = pz + s * lz;
    const margin = tableAt(inner, y) - Math.sqrt(qx * qx + qz * qz);
    const soft = 0.5 + 0.05 * s;
    light = Math.min(light, smoothstep(-soft, soft, margin));
    if (light <= 0) return 0;
  }
  return light;
}

/** The saucer's shadow on the table. */
function saucerShadow(px: number, pz: number, lx: number, ly: number, lz: number): number {
  if (ly <= 0.01) return 1;
  let light = 1;
  const top = BEAD_Y + BEAD;
  const steps = 8;
  for (let k = 1; k <= steps; k += 1) {
    const y = (top * k) / steps;
    const s = y / ly;
    const qx = px + s * lx;
    const qz = pz + s * lz;
    const margin = Math.sqrt(qx * qx + qz * qz) - saucerRadius(y);
    const soft = 1.5 + 0.08 * s;
    light = Math.min(light, smoothstep(-soft, soft, margin));
  }
  return light;
}

/** The ACES filmic curve (Narkowicz's fit): soft highlights, a gentle toe. */
function toneCurve(value: number): number {
  const v = Math.max(0, value * EXPOSURE);
  return clamp01((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14));
}

/** Linear 0-1 to an sRGB byte, by table. */
const ENCODE_SIZE = 4096;
let encodeTable: Uint8Array | null = null;

function encodeTableOf(): Uint8Array {
  if (!encodeTable) {
    encodeTable = new Uint8Array(ENCODE_SIZE + 1);
    for (let i = 0; i <= ENCODE_SIZE; i += 1) {
      const v = i / ENCODE_SIZE;
      const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      encodeTable[i] = Math.round(clamp01(encoded) * 255);
    }
  }
  return encodeTable;
}

function decode(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** The crema's colour at a point of the coffee (world X, Z), linear, into `out`. */
function cremaColour(noise: Noise3, turn: number, wx: number, wz: number, out: Vec): void {
  const px = wx / COFFEE_RADIUS;
  const pz = wz / COFFEE_RADIUS;
  const rho = Math.min(1, Math.sqrt(px * px + pz * pz));
  const angle = Math.atan2(pz, px);
  // The ring where the crema clings to the cup, its inner edge a little ragged.
  const ragged = 0.045 * noise(Math.cos(angle) * 2.2 + 3.1, Math.sin(angle) * 2.2 + 1.7, 0.5);
  const ring = smoothstep(0.8, 0.95, rho + ragged);
  // One lazy arm of paler crema, wound from the middle out, broken by the noise.
  const wind = angle + turn + 4.8 * rho + 0.9 * noise(px * 1.4 + 7.3, pz * 1.4 + 2.9, 1.5);
  const arm = Math.pow(0.5 + 0.5 * Math.cos(wind), 7) * smoothstep(0.08, 0.36, rho) * (1 - smoothstep(0.7, 0.92, rho));
  // A little mottling, as crema has.
  const mottle = 1 + 0.1 * noise(px * 4.5 + 11.1, pz * 4.5 + 4.4, 2.5);
  const cream = clamp01(0.9 * ring + 0.75 * arm);
  const pale = clamp01(arm * 0.9 + ring * 0.2);
  // A thin darker meniscus right at the wall.
  const meniscus = 1 - 0.3 * smoothstep(0.985, 1, rho);
  for (let c = 0; c < 3; c += 1) {
    const base = COFFEE_DARK[c]! + (CREMA[c]! - COFFEE_DARK[c]!) * cream;
    out[c] = (base + (CREMA_PALE[c]! - base) * pale * cream) * mottle * meniscus;
  }
}

export interface StillLifeOptions {
  /** Device pixels a design unit. */
  pixelsPerUnit: number;
  /** The page's colour (#rrggbb): the room the glaze reflects. */
  background: string;
  /** The crema's swirl differs a little with the seed. */
  seed: number;
}

export interface StillLife {
  width: number;
  height: number;
  /** Where the middle of the cup's rim is in the images (device pixels from the top left; whole numbers). */
  originX: number;
  originY: number;
  /** Everything: the table's shadow, the saucer, the cup and the coffee. Straight-alpha RGBA, a row at a time. */
  back: Uint8ClampedArray<ArrayBuffer>;
  /** The cup's near side alone (its outer wall, the near half of its lip, the handle): what the steam rises behind. */
  front: Uint8ClampedArray<ArrayBuffer>;
}

/** The table's shadow is worked out every this many pixels each way, and filled in between: it is soft. */
const SHADOW_GRID = 3;
/** The cup's shadow on the saucer, worked out on a grid over the saucer this many units apart: it is soft too. */
const SAUCER_GRID_STEP = 2.5;
const SAUCER_GRID_SIZE = Math.ceil((2 * SAUCER_RADIUS) / SAUCER_GRID_STEP) + 2;

/** Whether what a sample sees is in front of the steam. */
function inFront(kind: number, facing: number): boolean {
  return kind === OUTER || kind === HANDLE || (kind === LIP_PART && facing > 0);
}

/**
 * One rendering. A class, not closures, so its few hot methods are the same
 * functions every time and the engine optimizes them once.
 */
class StillLifeRenderer {
  readonly ppu: number;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  /** The images' left and top edges, in units from the middle of the rim. */
  readonly left: number;
  readonly up: number;
  /** Sample rows in a column, the height of one in units, and v (up the image: Y·COS − Z·SIN) at the rim. */
  readonly rows: number;
  readonly unitRow: number;
  readonly rimV: number;
  readonly room: Vec;
  readonly noise: Noise3;
  readonly turn: number;
  readonly profiles: readonly Profile[];
  readonly reach: readonly number[];
  readonly handle = handleCurve();
  /** The handle's box (pixels) and, for each of its pixels, the piece of the curve nearest it. */
  readonly hx0: number;
  readonly hx1: number;
  readonly hy0: number;
  readonly hy1: number;
  readonly hint: Int16Array;
  /** One pixel column's samples: nearest depth, what, where along its profile, and which side of the axis. */
  readonly depth: Float64Array;
  readonly what: Uint8Array;
  readonly where: Float64Array;
  readonly side: Int8Array;
  /** The table's darkness on the coarse grid. */
  readonly shadowCols: number;
  readonly shadowGrid: Float32Array;
  /** The key's light on the saucer's top, as the cup lets it by, on a grid over (x, z). */
  readonly saucerGrid: Float32Array;
  readonly back: Uint8ClampedArray<ArrayBuffer>;
  readonly front: Uint8ClampedArray<ArrayBuffer>;
  readonly encode = encodeTableOf();
  // Scratch, reused by every sample.
  readonly colour: Vec = [0, 0, 0];
  readonly albedo: Vec = [0, 0, 0];
  readonly shine: Vec = [0, 0, 0];
  readonly lightTo: Vec = [0, 0, 0];
  /** The first and last sample rows the current column's surfaces reach: outside them, only the table. */
  hitFirst = 0;
  hitLast = -1;
  nearIndex = 0;
  nearAlong = 0;
  nearDistance = 0;
  readonly surfaceKey = new Int16Array(SUB * SUB);
  readonly surfaceCount = new Int16Array(SUB * SUB);
  readonly surfaceSample = new Int16Array(SUB * SUB);

  constructor(options: StillLifeOptions) {
    // Device pixels a unit of the still life's own.
    this.ppu = Math.max(0.05, options.pixelsPerUnit) * CUP_SCALE;
    this.originX = Math.round(EXTENT_LEFT * this.ppu);
    this.originY = Math.round(EXTENT_UP * this.ppu);
    this.width = this.originX + Math.round(EXTENT_RIGHT * this.ppu);
    this.height = this.originY + Math.round(EXTENT_DOWN * this.ppu);
    this.left = this.originX / this.ppu;
    this.up = this.originY / this.ppu;
    this.rows = this.height * SUB;
    this.unitRow = 1 / (this.ppu * SUB);
    this.rimV = RIM_TOP * COS;
    const [red, green, blue] = parseHex(options.background);
    this.room = [decode(red), decode(green), decode(blue)];
    const random = createRandom(Math.imul(options.seed | 0, 0x2c1b3c6d) ^ 0x51ed27);
    this.noise = createNoise(random);
    this.turn = random() * Math.PI * 2;
    this.profiles = [cupProfile(), saucerProfile()];
    this.reach = this.profiles.map((profile) => Math.max(...profile.r));
    this.depth = new Float64Array(SUB * this.rows);
    this.what = new Uint8Array(SUB * this.rows);
    this.where = new Float64Array(SUB * this.rows);
    this.side = new Int8Array(SUB * this.rows);
    this.back = new Uint8ClampedArray(this.width * this.height * 4);
    this.front = new Uint8ClampedArray(this.width * this.height * 4);

    const handle = this.handle;
    let handleLeft = Infinity;
    let handleRight = -Infinity;
    let handleTop = -Infinity;
    let handleBottom = Infinity;
    for (let i = 0; i <= HANDLE_POINTS; i += 1) {
      const reach = handle.radius[i]! + 1;
      handleLeft = Math.min(handleLeft, handle.x[i]! - reach);
      handleRight = Math.max(handleRight, handle.x[i]! + reach);
      handleTop = Math.max(handleTop, handle.v[i]! + reach);
      handleBottom = Math.min(handleBottom, handle.v[i]! - reach);
    }
    this.hx0 = Math.max(0, Math.floor((handleLeft + this.left) * this.ppu));
    this.hx1 = Math.min(this.width - 1, Math.ceil((handleRight + this.left) * this.ppu));
    this.hy0 = Math.max(0, Math.floor((this.rimV + this.up - handleTop) * this.ppu));
    this.hy1 = Math.min(this.height - 1, Math.ceil((this.rimV + this.up - handleBottom) * this.ppu));
    const handleWidth = Math.max(0, this.hx1 - this.hx0 + 1);
    this.hint = new Int16Array(handleWidth * Math.max(0, this.hy1 - this.hy0 + 1));
    for (let py = this.hy0; py <= this.hy1; py += 1) {
      for (let px = this.hx0; px <= this.hx1; px += 1) {
        this.nearestOnHandle(this.sampleX(px, 1), this.rowV(py * SUB + 1), 0, HANDLE_POINTS);
        this.hint[(py - this.hy0) * handleWidth + (px - this.hx0)] = this.nearIndex;
      }
    }

    this.saucerGrid = new Float32Array(SAUCER_GRID_SIZE * SAUCER_GRID_SIZE);
    for (let iz = 0; iz < SAUCER_GRID_SIZE; iz += 1) {
      for (let ix = 0; ix < SAUCER_GRID_SIZE; ix += 1) {
        const x = -SAUCER_RADIUS + ix * SAUCER_GRID_STEP;
        const z = -SAUCER_RADIUS + iz * SAUCER_GRID_STEP;
        const y = dishHeight(Math.min(DISH_TO, Math.sqrt(x * x + z * z)));
        this.towardKey(x, y, z);
        this.saucerGrid[iz * SAUCER_GRID_SIZE + ix] = cupShadow(x, y, z, this.lightTo[0], this.lightTo[1], this.lightTo[2]);
      }
    }

    this.shadowCols = Math.ceil(this.width / SHADOW_GRID) + 2;
    const shadowRows = Math.ceil(this.height / SHADOW_GRID) + 2;
    this.shadowGrid = new Float32Array(this.shadowCols * shadowRows);
    for (let gy = 0; gy < shadowRows; gy += 1) {
      for (let gx = 0; gx < this.shadowCols; gx += 1) {
        this.shadowGrid[gy * this.shadowCols + gx] = this.tableShadow(-this.left + (gx * SHADOW_GRID) / this.ppu, this.rimV + this.up - (gy * SHADOW_GRID) / this.ppu);
      }
    }
  }

  /** x (units) of sample column sc of pixel column px. */
  sampleX(px: number, sc: number): number {
    return -this.left + (px + (sc + 0.5) / SUB) / this.ppu;
  }

  /** v at the middle of sample row j. */
  rowV(j: number): number {
    return this.rimV + this.up - (j + 0.5) * this.unitRow;
  }

  render(): StillLife {
    for (let px = 0; px < this.width; px += 1) {
      this.depth.fill(-Infinity);
      this.what.fill(NOTHING);
      this.hitFirst = this.rows;
      this.hitLast = -1;
      for (let sc = 0; sc < SUB; sc += 1) {
        const x = this.sampleX(px, sc);
        this.rasterizeProfiles(x, sc * this.rows);
        if (px >= this.hx0 && px <= this.hx1) this.rasterizeHandle(px, x, sc * this.rows);
      }
      this.resolveColumn(px);
    }
    return { width: this.width, height: this.height, originX: this.originX, originY: this.originY, back: this.back, front: this.front };
  }

  /** The cup's and the saucer's profiles, turned about the axis, into one column of samples at x. */
  rasterizeProfiles(x: number, base: number): void {
    const across = Math.abs(x);
    const rows = this.rows;
    const depth = this.depth;
    // Rows of the samples, from v: (rimV + up − v) / unitRow − 0.5.
    const rowScale = 1 / this.unitRow;
    const rowOffset = (this.rimV + this.up) * rowScale - 0.5;
    for (let p = 0; p < this.profiles.length; p += 1) {
      if (across >= this.reach[p]!) continue;
      const profile = this.profiles[p]!;
      const pr = profile.r;
      const py = profile.y;
      const parts = profile.part;
      for (let k = 0; k + 1 < profile.count; k += 1) {
        const ra = pr[k]!;
        const rb = pr[k + 1]!;
        if (ra < across && rb < across) continue;
        let fa = 0;
        let fb = 1;
        if (ra < across) fa = (across - ra) / (rb - ra);
        if (rb < across) fb = (across - ra) / (rb - ra);
        const ya = py[k]!;
        const yb = py[k + 1]!;
        const r0 = ra + (rb - ra) * fa;
        const r1 = ra + (rb - ra) * fb;
        const y0 = ya + (yb - ya) * fa;
        const y1 = ya + (yb - ya) * fb;
        const z0 = Math.sqrt(Math.max(0, r0 * r0 - across * across));
        const z1 = Math.sqrt(Math.max(0, r1 * r1 - across * across));
        const part = parts[k]!;
        // Seen from above, the outer wall shows only its near side and the hollow only its far side.
        const nearSide = part === INNER ? -1 : 1;
        const farSide = part === OUTER || part === SAUCER_UNDER ? 1 : -1;
        for (let facing = nearSide; facing >= farSide; facing -= 2) {
          const row0 = rowOffset - (y0 * COS - facing * z0 * SIN) * rowScale;
          const row1 = rowOffset - (y1 * COS - facing * z1 * SIN) * rowScale;
          const first = Math.max(0, Math.ceil(Math.min(row0, row1)));
          const last = Math.min(rows - 1, Math.floor(Math.max(row0, row1)));
          if (last < first) continue;
          if (first < this.hitFirst) this.hitFirst = first;
          if (last > this.hitLast) this.hitLast = last;
          const t0 = y0 * SIN + facing * z0 * COS;
          const t1 = y1 * SIN + facing * z1 * COS;
          const span = row1 - row0;
          for (let j = first; j <= last; j += 1) {
            const along = span === 0 ? 0 : (j - row0) / span;
            const t = t0 + (t1 - t0) * along;
            const at = base + j;
            if (t > depth[at]!) {
              depth[at] = t;
              this.what[at] = part;
              this.where[at] = k + fa + (fb - fa) * along;
              this.side[at] = facing;
            }
          }
        }
      }
    }
  }

  /** The handle into one column of samples at x, where the column crosses its box. */
  rasterizeHandle(px: number, x: number, base: number): void {
    const handle = this.handle;
    const handleWidth = this.hx1 - this.hx0 + 1;
    for (let j = this.hy0 * SUB; j < (this.hy1 + 1) * SUB; j += 1) {
      const v = this.rowV(j);
      const guess = this.hint[(Math.floor(j / SUB) - this.hy0) * handleWidth + (px - this.hx0)]!;
      this.nearestOnHandle(x, v, guess - 4, guess + 5);
      const i = this.nearIndex;
      const radius = handle.radius[i]! + (handle.radius[i + 1]! - handle.radius[i]!) * this.nearAlong;
      if (this.nearDistance >= radius) continue;
      const cy = handle.y[i]! + (handle.y[i + 1]! - handle.y[i]!) * this.nearAlong;
      // The centreline's depth (it lies at Z = 0) and the tube's near surface above it.
      const t = cy * SIN + Math.sqrt(radius * radius - this.nearDistance * this.nearDistance);
      const at = base + j;
      if (j < this.hitFirst) this.hitFirst = j;
      if (j > this.hitLast) this.hitLast = j;
      if (t > this.depth[at]!) {
        this.depth[at] = t;
        this.what[at] = HANDLE;
        this.where[at] = i + this.nearAlong;
        this.side[at] = 1;
      }
    }
  }

  /** The handle's nearest point to (x, v) on the image, among pieces from..to: its piece, how far along, its distance. */
  nearestOnHandle(x: number, v: number, from: number, to: number): void {
    const handle = this.handle;
    let best = Infinity;
    for (let i = Math.max(0, from); i < Math.min(HANDLE_POINTS, to); i += 1) {
      const ax = handle.x[i]!;
      const av = handle.v[i]!;
      const dx = handle.x[i + 1]! - ax;
      const dv = handle.v[i + 1]! - av;
      const along = clamp01(((x - ax) * dx + (v - av) * dv) / (dx * dx + dv * dv || 1));
      const ex = ax + dx * along - x;
      const ev = av + dv * along - v;
      const distance = ex * ex + ev * ev;
      if (distance < best) {
        best = distance;
        this.nearIndex = i;
        this.nearAlong = along;
      }
    }
    this.nearDistance = Math.sqrt(best);
  }

  /**
   * One column's pixels: the surfaces its samples see, each with how many
   * see it and the first that does, shaded once apiece (the middle sample's
   * alone where all see the same stretch of the same thing) and blended by
   * those counts, over the table's shadow.
   */
  resolveColumn(px: number): void {
    const rows = this.rows;
    const what = this.what;
    const where = this.where;
    const side = this.side;
    const keys = this.surfaceKey;
    const counts = this.surfaceCount;
    const samples = this.surfaceSample;
    const encode = this.encode;
    const count = SUB * SUB;
    const gx = px / SHADOW_GRID;
    const gx0 = Math.floor(gx);
    const fx = gx - gx0;
    const pyFirst = Math.floor(this.hitFirst / SUB);
    const pyLast = Math.floor(this.hitLast / SUB);
    for (let py = 0; py < this.height; py += 1) {
      const out = (py * this.width + px) * 4;
      if (py < pyFirst || py > pyLast) {
        // Only the table: its shadow, black at the shadow's alpha.
        const dark = this.gridShadow(gx0, fx, py);
        if (dark > 0) this.back[out + 3] = Math.round(dark * 255);
        continue;
      }
      const centre = rows + py * SUB + 1;
      const kind = what[centre]!;
      const middle = where[centre]!;
      let same = true;
      for (let sc = 0; sc < SUB && same; sc += 1) {
        const first = sc * rows + py * SUB;
        for (let at = first; at < first + SUB; at += 1) {
          // Far along the profile from the middle sample: another stretch of it in front of this one (the bowl over its foot).
          if (what[at] !== kind || (kind !== NOTHING && Math.abs(where[at]! - middle) > 3)) {
            same = false;
            break;
          }
        }
      }
      let surfaces = 0;
      if (same) {
        keys[0] = kind * 2 + (side[centre]! > 0 ? 1 : 0);
        counts[0] = count;
        samples[0] = SUB + 1;
        surfaces = 1;
      } else {
        for (let n = 0; n < count; n += 1) {
          const at = Math.floor(n / SUB) * rows + py * SUB + (n % SUB);
          const key = what[at]! * 2 + (side[at]! > 0 ? 1 : 0);
          let s = 0;
          while (s < surfaces && keys[s] !== key) s += 1;
          if (s === surfaces) {
            keys[s] = key;
            counts[s] = 0;
            samples[s] = n;
            surfaces += 1;
          }
          counts[s] = counts[s]! + 1;
        }
      }
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      let shadow = 0;
      let frontRed = 0;
      let frontGreen = 0;
      let frontBlue = 0;
      let frontCount = 0;
      for (let s = 0; s < surfaces; s += 1) {
        const n = samples[s]!;
        const sc = Math.floor(n / SUB);
        const sr = n % SUB;
        const at = sc * rows + py * SUB + sr;
        const seen = counts[s]!;
        const sampleKind = what[at]!;
        if (sampleKind === NOTHING) {
          shadow += this.gridShadow(gx0, fx, py) * seen;
          continue;
        }
        this.shadeSample(this.sampleX(px, sc), this.rowV(py * SUB + sr), sampleKind, where[at]!, side[at]!);
        const r = toneCurve(this.colour[0]) * seen;
        const g = toneCurve(this.colour[1]) * seen;
        const b = toneCurve(this.colour[2]) * seen;
        red += r;
        green += g;
        blue += b;
        covered += seen;
        if (inFront(sampleKind, side[at]!)) {
          frontRed += r;
          frontGreen += g;
          frontBlue += b;
          frontCount += seen;
        }
      }
      // Over the page: what is covered in its colour, the rest the page darkened by the shadow (black at that alpha).
      const weight = covered + shadow;
      if (weight > 0) {
        this.back[out] = encode[Math.round(clamp01(red / weight) * ENCODE_SIZE)]!;
        this.back[out + 1] = encode[Math.round(clamp01(green / weight) * ENCODE_SIZE)]!;
        this.back[out + 2] = encode[Math.round(clamp01(blue / weight) * ENCODE_SIZE)]!;
        this.back[out + 3] = Math.round((weight / count) * 255);
      }
      if (frontCount > 0) {
        this.front[out] = encode[Math.round(clamp01(frontRed / frontCount) * ENCODE_SIZE)]!;
        this.front[out + 1] = encode[Math.round(clamp01(frontGreen / frontCount) * ENCODE_SIZE)]!;
        this.front[out + 2] = encode[Math.round(clamp01(frontBlue / frontCount) * ENCODE_SIZE)]!;
        this.front[out + 3] = Math.round((frontCount / count) * 255);
      }
    }
  }

  /** The table's darkness at pixel row py of the column at grid x gx0 + fx, from the coarse grid. */
  gridShadow(gx0: number, fx: number, py: number): number {
    const gy = py / SHADOW_GRID;
    const gy0 = Math.floor(gy);
    const fy = gy - gy0;
    const grid = this.shadowGrid;
    const cols = this.shadowCols;
    const top = grid[gy0 * cols + gx0]! * (1 - fx) + grid[gy0 * cols + gx0 + 1]! * fx;
    const bottom = grid[(gy0 + 1) * cols + gx0]! * (1 - fx) + grid[(gy0 + 1) * cols + gx0 + 1]! * fx;
    return top * (1 - fy) + bottom * fy;
  }

  /**
   * Fills lightTo with the unit direction from a point to the key light, and
   * returns how strongly the key reaches it: by the square of the distance, 1
   * at the cup's middle, so what is nearer the light is lit more, and within
   * the spot's cone.
   */
  towardKey(px: number, py: number, pz: number): number {
    const dx = KEY_AT[0] - px;
    const dy = KEY_AT[1] - py;
    const dz = KEY_AT[2] - pz;
    const squared = dx * dx + dy * dy + dz * dz;
    const distance = Math.sqrt(squared);
    const lightTo = this.lightTo;
    lightTo[0] = dx / distance;
    lightTo[1] = dy / distance;
    lightTo[2] = dz / distance;
    const aim = -(lightTo[0] * KEY_AIM[0] + lightTo[1] * KEY_AIM[1] + lightTo[2] * KEY_AIM[2]);
    return (KEY_DISTANCE_SQUARED / squared) * smoothstep(KEY_EDGE, KEY_FULL, aim);
  }

  /** The room as the glaze and the coffee reflect it in a direction: dark, but for the lights. Into `shine`. */
  reflected(rx: number, ry: number, rz: number): void {
    const towardKeyLight = rx * KEY_FROM_CUP[0] + ry * KEY_FROM_CUP[1] + rz * KEY_FROM_CUP[2];
    const towardFill = rx * FILL_TOWARD[0] + ry * FILL_TOWARD[1] + rz * FILL_TOWARD[2];
    // (The key's bright core and the strip fall to nothing well before these cut-offs.)
    const keyGlow = 0.22 * Math.exp(7 * (towardKeyLight - 1)) + (towardKeyLight > 0.9 ? 1.3 * Math.exp(140 * (towardKeyLight - 1)) : 0);
    const fillGlow = 0.5 * Math.exp(26 * (towardFill - 1));
    // The strip: narrow across, tall, from well below the eye's level to a little above it.
    let strip = 0;
    if (ry > -0.98 && ry < 0.55 && rx < 0) {
      const bearing = (Math.atan2(rx, rz) - STRIP_BEARING) / STRIP_WIDTH;
      strip = Math.exp(-bearing * bearing) * smoothstep(-0.98, -0.75, ry) * (1 - smoothstep(0.25, 0.55, ry));
    }
    const overhead = 0.5 + 0.5 * ry;
    const room = this.room;
    const shine = this.shine;
    for (let c = 0; c < 3; c += 1) shine[c] = room[c]! * (0.7 + 0.8 * overhead) + KEY[c]! * keyGlow + FILL[c]! * fillGlow + STRIP[c]! * strip;
  }

  /**
   * Shades the glaze with a normal, the key's direction already in lightTo:
   * the wrapped diffuse from the key (`keyReach` of it reaching the point), the
   * fill and the room, darkened by `occlusion`, and the room's reflection by
   * Fresnel's law, the key's own part of it only where `keyLight` lets the key
   * fall. Into `colour`.
   */
  shadeGlaze(nx: number, ny: number, nz: number, keyReach: number, keyLight: number, occlusion: number): void {
    const lightTo = this.lightTo;
    const facing = nx * lightTo[0] + ny * lightTo[1] + nz * lightTo[2];
    const key = Math.max(0, (facing + WRAP) / (1 + WRAP)) * keyReach;
    const fill = Math.max(0, nx * FILL_TOWARD[0] + ny * FILL_TOWARD[1] + nz * FILL_TOWARD[2]);
    const up = 0.5 + 0.5 * ny;
    const toEye = Math.max(0, nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2]);
    const grazing = 1 - toEye;
    const grazing2 = grazing * grazing;
    const fresnel = GLAZE_F0 + (1 - GLAZE_F0) * grazing2 * grazing2 * grazing;
    this.reflected(2 * toEye * nx - VIEW[0], 2 * toEye * ny - VIEW[1], 2 * toEye * nz - VIEW[2]);
    // The key's own reflection only where its light can fall.
    const shade = (0.35 + 0.65 * keyLight) * (0.55 + 0.45 * occlusion);
    const colour = this.colour;
    const shine = this.shine;
    for (let c = 0; c < 3; c += 1) {
      const diffuse = GLAZE[c]! * (KEY[c]! * key + FILL[c]! * fill + SKY[c]! * up + BOUNCE[c]! * (1 - up)) * occlusion;
      colour[c] = diffuse * (1 - fresnel) + shine[c]! * fresnel * shade;
    }
  }

  /** Shades the coffee at a point of its surface. Into `colour`. */
  shadeCoffee(px: number, pz: number): void {
    const py = COFFEE_LEVEL;
    const albedo = this.albedo;
    cremaColour(this.noise, this.turn, px, pz, albedo);
    const reach = this.towardKey(px, py, pz);
    const lightTo = this.lightTo;
    const keyLight = cavityShadow(px, py, pz, lightTo[0], lightTo[1], lightTo[2]);
    const key = Math.max(0, lightTo[1]) * keyLight * reach;
    const fill = COFFEE_FILL;
    const rho = Math.sqrt(px * px + pz * pz) / COFFEE_RADIUS;
    const occlusion = 0.84 + 0.16 * (1 - smoothstep(0.9, 1, rho));
    // A liquid's gloss: the key's soft highlight where the angles meet, and the room in a Fresnel sheen.
    const hx = lightTo[0] + VIEW[0];
    const hy = lightTo[1] + VIEW[1];
    const hz = lightTo[2] + VIEW[2];
    const half = hy / Math.sqrt(hx * hx + hy * hy + hz * hz);
    const gloss = Math.pow(Math.max(0, half), 70) * keyLight;
    const fresnel = COFFEE_F0 + (1 - COFFEE_F0) * Math.pow(1 - SIN, 5);
    this.reflected(0, SIN, -COS);
    const colour = this.colour;
    const shine = this.shine;
    for (let c = 0; c < 3; c += 1) {
      const diffuse = albedo[c]! * (KEY[c]! * key + FILL[c]! * fill + SKY[c]!) * occlusion;
      colour[c] = diffuse * (1 - fresnel) + (shine[c]! * fresnel * COFFEE_SHEEN + KEY[c]! * gloss * 0.5) * occlusion;
    }
  }

  /** Shades what a sample at (x, v) sees, by its kind, its place along its profile and its side. Into `colour`. */
  shadeSample(x: number, v: number, kind: number, at: number, facing: number): void {
    if (kind === HANDLE) {
      // The tube's surface toward the eye, above its centreline's nearest point.
      this.nearestOnHandle(x, v, Math.floor(at) - 2, Math.floor(at) + 3);
      const handle = this.handle;
      const i = this.nearIndex;
      const along = this.nearAlong;
      const cx = handle.x[i]! + (handle.x[i + 1]! - handle.x[i]!) * along;
      const cy = handle.y[i]! + (handle.y[i + 1]! - handle.y[i]!) * along;
      const radius = handle.radius[i]! + (handle.radius[i + 1]! - handle.radius[i]!) * along;
      const ox = (x - cx) / radius;
      const ov = (v - cy * COS) / radius;
      const outward = Math.sqrt(Math.max(0, 1 - ox * ox - ov * ov));
      // On the image, x is the world's x and up is (0, COS, -SIN); the rest of the normal faces the eye.
      const nx = ox;
      const ny = ov * COS + outward * VIEW[1];
      const nz = -ov * SIN + outward * VIEW[2];
      const px = cx + nx * radius;
      const py = cy + ny * radius;
      const pz = nz * radius;
      const reach = this.towardKey(px, py, pz);
      const keyLight = cupShadow(px, py, pz, this.lightTo[0], this.lightTo[1], this.lightTo[2]);
      this.shadeGlaze(nx, ny, nz, reach * keyLight, keyLight, 0.86);
      return;
    }
    if (kind === COFFEE) {
      // Flat: the point under the sample is exact.
      this.shadeCoffee(x, (COFFEE_LEVEL * COS - v) / SIN);
      return;
    }
    // The place along the profile the rasterizer found: interpolated down the column, so a little off within a
    // piece, which moves the normal by a degree at most (the coffee, whose pattern would show it, is exact above).
    const profile = this.profiles[kind >= SAUCER_TOP ? 1 : 0]!;
    const i = Math.min(profile.count - 2, Math.floor(at));
    const f = at - i;
    const r = profile.r[i]! + (profile.r[i + 1]! - profile.r[i]!) * f;
    const y = profile.y[i]! + (profile.y[i + 1]! - profile.y[i]!) * f;
    let nr = profile.nr[i]! + (profile.nr[i + 1]! - profile.nr[i]!) * f;
    let ny = profile.ny[i]! + (profile.ny[i + 1]! - profile.ny[i]!) * f;
    const length = Math.sqrt(nr * nr + ny * ny) || 1;
    nr /= length;
    ny /= length;
    const z = facing * Math.sqrt(Math.max(0, r * r - x * x));
    const radial = r > 1e-6 ? 1 / r : 0;
    const nx = nr * x * radial;
    const nz = nr * z * radial;
    const reach = this.towardKey(x, y, z);
    const lightTo = this.lightTo;
    let keyLight = 1;
    let occlusion = 1;
    if (kind === OUTER) {
      // The bowl's underside, near the saucer, sees less of the room.
      occlusion = 0.5 + 0.5 * smoothstep(FOOT_TOP - 2, FOOT_TOP + 30, y);
    } else if (kind === INNER) {
      keyLight = cavityShadow(x, y, z, lightTo[0], lightTo[1], lightTo[2]);
      occlusion = 0.58 + 0.42 * smoothstep(COFFEE_LEVEL, WALL_TOP + LIP, y);
    } else if (kind === SAUCER_TOP || kind === SAUCER_BEAD) {
      keyLight = this.saucerLight(x, z);
      // Where the cup stands: the saucer round its foot sees little of the room.
      occlusion = 1 - 0.62 * Math.exp(-Math.max(0, r - FOOT_BOTTOM_R) / 7.5);
    }
    this.shadeGlaze(nx, ny, nz, reach * keyLight, keyLight, occlusion);
  }

  /** The key's light on the saucer at (x, z), as the cup lets it by: from the coarse grid. */
  saucerLight(x: number, z: number): number {
    const gx = Math.min(SAUCER_GRID_SIZE - 1.001, Math.max(0, (x + SAUCER_RADIUS) / SAUCER_GRID_STEP));
    const gz = Math.min(SAUCER_GRID_SIZE - 1.001, Math.max(0, (z + SAUCER_RADIUS) / SAUCER_GRID_STEP));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const grid = this.saucerGrid;
    const at = iz * SAUCER_GRID_SIZE + ix;
    const near = grid[at]! * (1 - fx) + grid[at + 1]! * fx;
    const far = grid[at + SAUCER_GRID_SIZE]! * (1 - fx) + grid[at + SAUCER_GRID_SIZE + 1]! * fx;
    return near * (1 - fz) + far * fz;
  }

  /** How dark the table is at the point under (x, v), 0 to 1. */
  tableShadow(x: number, v: number): number {
    const z = -v / SIN;
    const r = Math.sqrt(x * x + z * z);
    const contact = r < SAUCER_RADIUS + 60 ? Math.exp(-Math.max(0, r - (SAUCER_RADIUS - 6)) / 9) : 0;
    let lit = 1;
    if (r < SAUCER_RADIUS + 140) {
      this.towardKey(x, 0, z);
      const lightTo = this.lightTo;
      lit = Math.min(saucerShadow(x, z, lightTo[0], lightTo[1], lightTo[2]), cupShadow(x, 0, z, lightTo[0], lightTo[1], lightTo[2]));
    }
    // The cast shadow fades as it leaves the saucer (the key is a broad light).
    const fade = Math.exp(-Math.max(0, r - SAUCER_RADIUS) / 70);
    return clamp01(1 - (1 - SHADOW_DARK * (1 - lit) * fade) * (1 - CONTACT_DARK * contact));
  }
}

/** Renders the still life at one scale. Pure: the same options give the same pixels. */
export function renderStillLife(options: StillLifeOptions): StillLife {
  return new StillLifeRenderer(options).render();
}

/**
 * The model behind Latte Art (D228, D270), pure: no canvas, no clock.
 * The cup's surface is two fields on grids: the foam (0 is crema, 1 the white
 * of the milk) and the crema's tone (its tiger-striped marbling, 0 its
 * lightest, 1 its darkest streaks). An unseen pitcher pours, from a timeline
 * of where its stream lands, how high it is, how much milk comes and how it
 * wiggles (latteChoreo.ts), and the pour moves the surface: no fluid
 * dynamics, a velocity made from the pour alone.
 *
 * - The source: where the stream lands it pushes the surface outward, so
 *   foam that comes up there grows into a white disc and pushes the foam
 *   before it forward into rings. Leaning forward, it pushes more ahead than
 *   behind, as a pitcher tipped forward does. The foam comes up only while the
 *   pitcher is low and the flow high; from high, the milk dives under and only
 *   stirs the crema.
 * - The drag: a stream lifted a little digs in and drags the surface near it
 *   along as the pitcher moves. Thin and quick, as a pull-through, it is a
 *   narrow drag along its path, which cuts a heart's cleft where it goes in
 *   and draws out its point where it comes out. At the surface it drags only
 *   a little, so its wiggle sways the foam it lays without smearing it.
 * - The wall: nothing flows through it; the surface slows to a stop at it,
 *   so the crema pushed there gathers in a ring.
 *
 * The fields are carried by that velocity a fixed step at a time
 * (semi-Lagrangian, with MacCormack's correction so the edges stay crisp),
 * FIELD_HZ steps a second whatever the frame rate, so the picture is a
 * function of the seed and the time stepped alone. Each pour is followed by
 * time to admire it, then the cup clears (the foam settles away, the crema
 * comes back fresh) for the next, in turn.
 *
 * Units are the coffee's radius: x across, y toward the front of the cup
 * (down the screen), the centre at 0. The grids cover the square round it.
 */
import { between, createRandom, type Random } from '../random.ts';
import { CHOREOGRAPHIES, createPitcherState, pitcherAt, type Choreography, type PitcherState, type PourId } from './latteChoreo.ts';
import { createNoise, type Noise3 } from './noise.ts';

/** Cells across the foam's grid, which spans the coffee's diameter. */
export const GRID = 192;
/** One of its cells, in the coffee's radius. */
export const CELL = 2 / GRID;
/** The crema's tone is a softer thing: its grid has half as many cells across. */
export const TONE_GRID = GRID / 2;
export const TONE_CELL = 2 / TONE_GRID;
/** The fields move on this many fixed steps a second. */
export const FIELD_HZ = 15;
const FIELD_DT = 1 / FIELD_HZ;

/** After a pour, this long to admire it, then this long for the cup to clear (seconds). */
export const ADMIRE_S = 12;
export const CLEAR_S = 3;

/** The pours that come round, in turn (D271). */
export const IN_ROTATION: readonly PourId[] = ['heart', 'tulip', 'rosetta', 'swan'];

/** The model moves on by this many milliseconds in one step at most, whatever it is asked. */
const MAX_STEP_TOTAL_MS = 10_000;

// The pour's velocity. Areas are in the coffee's radius squared (the cup's surface is π).
/** The surface the source pushes out a second at full flow: the pitcher low, and high. */
const PUSH_LOW = 0.11;
const PUSH_HIGH = 0.025;
/** The source's core: inside it the push eases off to nothing at the landing point. */
const CORE = 0.045;
/** How much of the stream's own motion the surface right under it takes on, and how far that reaches for a stream of 0.45. */
const DRAG = 0.85;
const DRAG_REACH = 0.22;
/** A stream at the surface drags only this share as much: its wiggle sways the surface near it, and no more, or a rosetta's leaves run together. */
const DRAG_LOW = 0.1;
/** Past this many reaches the drag is left out (the kernel is under 1%). */
const DRAG_CUTOFF = 4.5;
/** The surface slows to a stop over this much of the radius at the wall. */
const WALL_BAND = 0.1;
/** A cell displaced by less than this (in cells) in a step stays put. */
const STILL = 0.004;
/** The foam is moved only within this many cells of where it is (and its first pass this many more): more than anything moves in a step, or all of it is. */
const MARGIN = 10;

// The foam coming up.
/** How fast the foam comes up at full flow (a second), and how wide a patch of it under the stream. */
const RISE_RATE = 14;
const RISE_REACH = 0.03;
/** The pitcher is low from here down (foam comes up), high from here up (it dives under). */
const LOW_FROM = 0.2;
const HIGH_FROM = 0.55;
/** The milk diving under from high lightens the crema where it lands, this much a second, over this reach. */
const MIX_RATE = 0.5;
const MIX_REACH = 0.09;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The x (or y) of a column's (or row's) centre on a grid of `size` cells across. */
export function cellCentre(index: number, size = GRID): number {
  return -1 + ((index + 0.5) * 2) / size;
}

/** The index nearest a point of the surface on a grid of `size` cells across. */
export function cellAt(x: number, y: number, size = GRID): number {
  const col = Math.min(size - 1, Math.max(0, Math.floor(((x + 1) * size) / 2)));
  const row = Math.min(size - 1, Math.max(0, Math.floor(((y + 1) * size) / 2)));
  return row * size + col;
}

/** A grid's cells on the coffee: each row's first and last inside the wall, and how far into the cup each cell is (1 inside, easing to 0 at the wall). */
interface Shape {
  size: number;
  first: Int32Array;
  last: Int32Array;
  wall: Float32Array;
}

function shapeOf(size: number): Shape {
  const first = new Int32Array(size).fill(size);
  const last = new Int32Array(size).fill(-1);
  const wall = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const r = Math.hypot(cellCentre(col, size), cellCentre(row, size));
      if (r >= 1) continue;
      wall[row * size + col] = smoothstep(1, 1 - WALL_BAND, r);
      first[row] = Math.min(first[row]!, col);
      last[row] = Math.max(last[row]!, col);
    }
  }
  return { size, first, last, wall };
}

const FOAM_SHAPE = shapeOf(GRID);
const TONE_SHAPE = shapeOf(TONE_GRID);

/** Whether a cell of the foam's grid is on the coffee (its centre inside the wall). */
export function insideCup(index: number): boolean {
  const col = index % GRID;
  const row = (index - col) / GRID;
  return col >= FOAM_SHAPE.first[row]! && col <= FOAM_SHAPE.last[row]!;
}

/** The surface: the foam, GRID * GRID, and the crema's tone, TONE_GRID * TONE_GRID, each a row at a time from the back of the cup. */
export interface LatteSurface {
  readonly foam: Float32Array;
  readonly tone: Float32Array;
}

export function createSurface(): LatteSurface {
  return { foam: new Float32Array(GRID * GRID), tone: new Float32Array(TONE_GRID * TONE_GRID) };
}

/** A grid's space for one step, kept from step to step: its displacements and MacCormack's in-betweens. */
interface Passes {
  dx: Float32Array;
  dy: Float32Array;
  hat: Float32Array;
  low: Float32Array;
  high: Float32Array;
}

function passes(size: number): Passes {
  const cells = size * size;
  return { dx: new Float32Array(cells), dy: new Float32Array(cells), hat: new Float32Array(cells), low: new Float32Array(cells), high: new Float32Array(cells) };
}

/** Space one step of a pour works in: each grid's, and where the foam is with the boxes round it the two passes go over. */
interface Scratch {
  foam: Passes;
  tone: Passes;
  extent: Box;
  inner: Box;
  outer: Box;
}

function createScratch(): Scratch {
  return { foam: passes(GRID), tone: passes(TONE_GRID), extent: [0, -1, 0, -1], inner: [0, -1, 0, -1], outer: [0, -1, 0, -1] };
}

const ALL_FOAM: Box = [0, GRID - 1, 0, GRID - 1];
const ALL_TONE: Box = [0, TONE_GRID - 1, 0, TONE_GRID - 1];

/** The box of cells where `field` (the foam's grid) is not 0, into `out`; false where it is 0 everywhere. */
function extentOf(field: Float32Array, out: Box): boolean {
  let top = GRID;
  let bottom = -1;
  let left = GRID;
  let right = -1;
  for (let row = 0; row < GRID; row += 1) {
    const start = row * GRID;
    for (let col = 0; col < GRID; col += 1) {
      if (field[start + col]! > 0) {
        if (row < top) top = row;
        bottom = row;
        if (col < left) left = col;
        if (col > right) right = col;
      }
    }
  }
  out[0] = top;
  out[1] = bottom;
  out[2] = left;
  out[3] = right;
  return bottom >= 0;
}

/** `box` grown by `by` cells all round, held to the grid, into `out`. */
function grown(box: Box, by: number, out: Box): Box {
  out[0] = Math.max(0, box[0] - by);
  out[1] = Math.min(GRID - 1, box[1] + by);
  out[2] = Math.max(0, box[2] - by);
  out[3] = Math.min(GRID - 1, box[3] + by);
  return out;
}

/** How low the pitcher is: 1 at the surface (the foam comes up), 0 high (the milk dives under). */
export function lowness(height: number): number {
  return 1 - smoothstep(LOW_FROM, HIGH_FROM, height);
}

/** How much of the stream's motion it drags the surface by: a stream lifted a little digs in; one at the surface mostly lays its foam; one high dives through. */
export function dragOf(flow: number, height: number): number {
  return DRAG * smoothstep(0, 0.3, flow) * (DRAG_LOW + (1 - DRAG_LOW) * smoothstep(0.1, 0.4, height)) * (1 - 0.9 * smoothstep(0.6, 0.85, height));
}

/** Rows and columns of a grid, first to last, both in. */
type Box = [top: number, bottom: number, left: number, right: number];

/**
 * Writes the displacement, in its cells, of each cell of a grid's `box` over
 * `dt` seconds of the pour: the source where the stream lands, the drag of
 * the stream moving from `from` to `to` over the step, and the wall. Returns
 * the furthest any of them moves, in cells.
 */
function pourVelocity(from: PitcherState, to: PitcherState, dt: number, shape: Shape, dx: Float32Array, dy: Float32Array, box: Box): number {
  const { size, first, last, wall } = shape;
  const [top, bottom, left, right] = box;
  const flow = to.flow;
  const scale = (dt * size) / 2;
  let furthest = 0;

  // The source, all over the cup: outward from where the stream lands, more of it forward when it leans.
  // (1 + lean cos θ) / r has no sinks or sources of its own, so it only moves the surface about.
  const low = lowness(to.height);
  const gain = (flow * (PUSH_HIGH + (PUSH_LOW - PUSH_HIGH) * low)) / (2 * Math.PI);
  const lean = to.lean * low;
  const forwardX = Math.sin(to.heading);
  const forwardY = Math.cos(to.heading);
  const core2 = CORE * CORE;
  for (let row = top; row <= bottom; row += 1) {
    const oy = cellCentre(row, size) - to.y;
    const end = Math.min(right, last[row]!);
    for (let col = Math.max(left, first[row]!); col <= end; col += 1) {
      const index = row * size + col;
      const ox = cellCentre(col, size) - to.x;
      const d2 = ox * ox + oy * oy + core2;
      const s = (lean > 0 ? (gain * (1 + (lean * (ox * forwardX + oy * forwardY)) / Math.sqrt(d2))) / d2 : gain / d2) * wall[index]! * scale;
      dx[index] = s * ox;
      dy[index] = s * oy;
      const most = Math.abs(s) * Math.max(Math.abs(ox), Math.abs(oy));
      if (most > furthest) furthest = most;
    }
  }

  // The drag, near the stretch the stream moved over in the step.
  const drag = dragOf(flow, to.height);
  const vx = (to.x - from.x) / dt;
  const vy = (to.y - from.y) / dt;
  if (drag <= 0 || vx * vx + vy * vy < 1e-8) return furthest;
  // A thinner stream drags a narrower band.
  const reach = DRAG_REACH * Math.min(1.2, Math.max(0.4, Math.sqrt(flow / 0.45)));
  const near = reach * DRAG_CUTOFF;
  const firstRow = Math.max(top, Math.floor(((Math.min(from.y, to.y) - near + 1) * size) / 2));
  const lastRow = Math.min(bottom, Math.ceil(((Math.max(from.y, to.y) + near + 1) * size) / 2));
  const firstCol = Math.max(left, Math.floor(((Math.min(from.x, to.x) - near + 1) * size) / 2));
  const lastCol = Math.min(right, Math.ceil(((Math.max(from.x, to.x) + near + 1) * size) / 2));
  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const length2 = sx * sx + sy * sy;
  const cutoff2 = DRAG_CUTOFF * DRAG_CUTOFF;
  const pushX = drag * vx * scale;
  const pushY = drag * vy * scale;
  furthest += drag * Math.max(Math.abs(vx), Math.abs(vy)) * scale;
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = cellCentre(row, size);
    const start = Math.max(firstCol, first[row]!);
    const end = Math.min(lastCol, last[row]!);
    for (let col = start; col <= end; col += 1) {
      const x = cellCentre(col, size);
      // The distance to the stretch, in reaches.
      let t = length2 > 1e-12 ? ((x - from.x) * sx + (y - from.y) * sy) / length2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - from.x - t * sx;
      const ey = y - from.y - t * sy;
      const q = (ex * ex + ey * ey) / (reach * reach);
      if (q >= cutoff2) continue;
      // A cusp, sharpest on the path, so a cleft and a point come out as Vs.
      const index = row * size + col;
      const k = Math.exp(-Math.sqrt(q)) * wall[index]!;
      dx[index] = dx[index]! + pushX * k;
      dy[index] = dy[index]! + pushY * k;
    }
  }
  return furthest;
}

/**
 * Carries `field` (a grid of `shape`) by the displacements `dx`, `dy`:
 * semi-Lagrangian (each cell takes the value from where its surface came
 * from, bilinearly), then MacCormack's correction (the step undone, and half
 * the error put back), held between the values it came from, so nothing
 * overshoots and edges stay crisp where plain bilinear steps would blur them.
 * The first pass goes over `outer`, the second, which reads what the first
 * wrote a displacement away, over `inner`, a margin inside it: only `inner`
 * changes.
 */
function carry(field: Float32Array, shape: Shape, work: Passes, outer: Box, inner: Box): void {
  const { size, first, last } = shape;
  const { dx, dy, hat, low, high } = work;
  const edge = size - 1.001;
  for (let row = outer[0]; row <= outer[1]; row += 1) {
    const start = first[row]!;
    const end = last[row]!;
    for (let col = outer[2]; col <= outer[3]; col += 1) {
      const index = row * size + col;
      const ddx = dx[index]!;
      const ddy = dy[index]!;
      const here = field[index]!;
      // Off the coffee, and where nothing moves, the first pass keeps what is there.
      if (col < start || col > end || (ddx < STILL && ddx > -STILL && ddy < STILL && ddy > -STILL)) {
        hat[index] = here;
        low[index] = here;
        high[index] = here;
        continue;
      }
      let sx = col - ddx;
      let sy = row - ddy;
      sx = sx < 0 ? 0 : sx > edge ? edge : sx;
      sy = sy < 0 ? 0 : sy > edge ? edge : sy;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const at = y0 * size + x0;
      const a = field[at]!;
      const b = field[at + 1]!;
      const c = field[at + size]!;
      const d = field[at + size + 1]!;
      hat[index] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      let lo = a < b ? a : b;
      let hi = a < b ? b : a;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
      low[index] = lo;
      high[index] = hi;
    }
  }
  for (let row = inner[0]; row <= inner[1]; row += 1) {
    const end = Math.min(inner[3], last[row]!);
    for (let col = Math.max(inner[2], first[row]!); col <= end; col += 1) {
      const index = row * size + col;
      const ddx = dx[index]!;
      const ddy = dy[index]!;
      if (ddx < STILL && ddx > -STILL && ddy < STILL && ddy > -STILL) continue;
      // Come from where all is one value (inside the white, out in the crema): that is the value.
      const lo = low[index]!;
      const hi = high[index]!;
      if (lo === hi) {
        field[index] = lo;
        continue;
      }
      let sx = col + ddx;
      let sy = row + ddy;
      sx = sx < 0 ? 0 : sx > edge ? edge : sx;
      sy = sy < 0 ? 0 : sy > edge ? edge : sy;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const at = y0 * size + x0;
      const a = hat[at]!;
      const b = hat[at + 1]!;
      const c = hat[at + size]!;
      const d = hat[at + size + 1]!;
      const back = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      const corrected = hat[index]! + 0.5 * (field[index]! - back);
      field[index] = corrected < lo ? lo : corrected > hi ? hi : corrected;
    }
  }
}

/**
 * Where the pitcher is low, the foam comes up under the stream, along the
 * stretch it moved over in the step; where it is high, the milk diving under
 * lightens the crema a little.
 */
function rise(surface: LatteSurface, from: PitcherState, to: PitcherState, dt: number): void {
  const flow = to.flow;
  if (flow <= 0) return;
  const low = lowness(to.height);
  const rate = RISE_RATE * flow * low * dt;
  const patch = RISE_REACH * (0.55 + 0.45 * flow);
  if (rate > 0) lay(surface.foam, FOAM_SHAPE, from, to, patch, (value, k) => value + (1 - value) * Math.min(1, rate * k));
  const mix = MIX_RATE * flow * (1 - low) * dt;
  if (mix > 0) lay(surface.tone, TONE_SHAPE, from, to, MIX_REACH, (value, k) => value * (1 - Math.min(1, mix * k)));
}

/** Changes the cells of a grid within `reach` of the stretch from `from` to `to`, by how near each is (1 on it, 0 at the reach). */
function lay(field: Float32Array, shape: Shape, from: PitcherState, to: PitcherState, reach: number, change: (value: number, nearness: number) => number): void {
  const { size, first, last, wall } = shape;
  const firstRow = Math.max(0, Math.floor(((Math.min(from.y, to.y) - reach + 1) * size) / 2));
  const lastRow = Math.min(size - 1, Math.ceil(((Math.max(from.y, to.y) + reach + 1) * size) / 2));
  const firstCol = Math.max(0, Math.floor(((Math.min(from.x, to.x) - reach + 1) * size) / 2));
  const lastCol = Math.min(size - 1, Math.ceil(((Math.max(from.x, to.x) + reach + 1) * size) / 2));
  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const length2 = sx * sx + sy * sy;
  const reach2 = reach * reach;
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = cellCentre(row, size);
    const start = Math.max(firstCol, first[row]!);
    const end = Math.min(lastCol, last[row]!);
    for (let col = start; col <= end; col += 1) {
      const x = cellCentre(col, size);
      let t = length2 > 1e-12 ? ((x - from.x) * sx + (y - from.y) * sy) / length2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - from.x - t * sx;
      const ey = y - from.y - t * sy;
      const d2 = ex * ex + ey * ey;
      if (d2 >= reach2) continue;
      const index = row * size + col;
      const near = 1 - d2 / reach2;
      field[index] = change(field[index]!, near * near * wall[index]!);
    }
  }
}

/**
 * A fresh crema, painted a few rows at a time: tiger-striped streaks wound
 * round the middle as the shot swirled into the cup, flecks, and a broad wash,
 * from the seeded noise. 0 is the crema's lightest, 1 its darkest.
 */
export interface CremaPainter {
  /** Paints the next `rows` rows into `out` (TONE_GRID * TONE_GRID); true once every row is painted. */
  paint(out: Float32Array, rows: number): boolean;
}

export function cremaPainter(random: Random): CremaPainter {
  const noise: Noise3 = createNoise(random);
  const swirl = between(random, 1.4, 2.4) * (random() < 0.5 ? -1 : 1);
  const turn = between(random, 0, 2 * Math.PI);
  const depth = between(random, 0, 50);
  let next = 0;
  return {
    paint(out, rows) {
      const until = Math.min(TONE_GRID, next + rows);
      for (let row = next; row < until; row += 1) {
        const y = cellCentre(row, TONE_GRID);
        for (let col = 0; col < TONE_GRID; col += 1) {
          const x = cellCentre(col, TONE_GRID);
          const angle = turn + swirl * Math.hypot(x, y);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const u = x * cos - y * sin;
          const v = x * sin + y * cos;
          const streak = noise(u * 2.2 + 3.1, v * 7 + 1.7, depth) + 0.5 * noise(u * 4.4 + 9.2, v * 14 + 4.4, depth + 3.3);
          const fleck = noise(x * 13 + 2.2, y * 13 + 7.9, depth + 7.7);
          const broad = noise(x * 1.6 + 5.5, y * 1.6 + 2.3, depth + 1.9);
          out[row * TONE_GRID + col] = clamp01(0.36 + 0.3 * smoothstep(-0.2, 0.6, streak) + 0.2 * fleck + 0.16 * broad);
        }
      }
      next = until;
      return next >= TONE_GRID;
    },
  };
}

/** A pour in progress on a surface: one fixed step at a time, from its choreography. */
export interface Pouring {
  readonly choreo: Choreography;
  /** Seconds poured so far. */
  readonly time: number;
  /** The pitcher now. */
  readonly pitcher: PitcherState;
  /** Moves the pour on by one fixed step, 1 / FIELD_HZ seconds. */
  advance(): void;
}

/** A pour on `surface`, a step of `stepSeconds` (1 / FIELD_HZ unless said) at a time. */
export function startPour(surface: LatteSurface, choreo: Choreography, stepSeconds = FIELD_DT): Pouring {
  const scratch = createScratch();
  const before = createPitcherState();
  const now = createPitcherState();
  pitcherAt(choreo, 0, now);
  let time = 0;
  return {
    choreo,
    get time() {
      return time;
    },
    pitcher: now,
    advance() {
      Object.assign(before, now);
      time += stepSeconds;
      pitcherAt(choreo, time, now);
      if (now.flow > 0 || before.flow > 0) {
        // The crema's tone, all over the cup, on its own coarser grid.
        const { tone, foam, extent, inner, outer } = scratch;
        pourVelocity(before, now, stepSeconds, TONE_SHAPE, tone.dx, tone.dy, ALL_TONE);
        carry(surface.tone, TONE_SHAPE, tone, ALL_TONE, ALL_TONE);
        // The foam, only round where it is: where there is none, none comes from anywhere it cannot reach in a step.
        if (extentOf(surface.foam, extent)) {
          grown(extent, MARGIN, inner);
          grown(extent, 2 * MARGIN, outer);
          if (pourVelocity(before, now, stepSeconds, FOAM_SHAPE, foam.dx, foam.dy, outer) <= MARGIN - 2) {
            carry(surface.foam, FOAM_SHAPE, foam, outer, inner);
          } else {
            // Something moves further than the margin in this step: all of it, this once.
            pourVelocity(before, now, stepSeconds, FOAM_SHAPE, foam.dx, foam.dy, ALL_FOAM);
            carry(surface.foam, FOAM_SHAPE, foam, ALL_FOAM, ALL_FOAM);
          }
        }
      }
      rise(surface, before, now, stepSeconds);
    },
  };
}

/** Pours `choreo` whole on a fresh surface, `hz` steps a second: for stills and tests. */
export function pourWhole(choreo: Choreography, seed: number, hz = FIELD_HZ): LatteSurface {
  const surface = createSurface();
  cremaPainter(createRandom(seed)).paint(surface.tone, TONE_GRID);
  const pour = startPour(surface, choreo, 1 / hz);
  const steps = Math.round(choreo.duration * hz);
  for (let i = 0; i < steps; i += 1) pour.advance();
  return surface;
}

export type LattePhase = 'pour' | 'admire' | 'clear';

export interface LatteModel {
  /** Seconds stepped so far: a whole number of field steps. */
  readonly time: number;
  readonly surface: LatteSurface;
  /** Counts the changes to the surface: the same number, the same surface (it holds still while a pour is admired). */
  readonly version: number;
  /** The pour on the cup: pouring, being admired, or clearing away. */
  readonly choreo: Choreography;
  readonly phase: LattePhase;
  /** Seconds into the phase. */
  readonly phaseTime: number;
  /** The pitcher now: its flow is 0 between pours. */
  readonly pitcher: PitcherState;
  /** How much of the foam shows: 1, easing to 0 as the cup clears. */
  readonly foamShown: number;
  step(dtMs: number): void;
}

/** The rows of the next crema painted each step of the admiring, so it is ready when the cup clears. */
const CREMA_ROWS_A_STEP = Math.ceil(TONE_GRID / (ADMIRE_S * FIELD_HZ - 2));

export function createLatteModel(seed: number, rotation: readonly PourId[] = IN_ROTATION): LatteModel {
  const random = createRandom(seed);
  const order = rotation.length > 0 ? rotation : IN_ROTATION;
  const surface = createSurface();
  cremaPainter(random).paint(surface.tone, TONE_GRID);
  const nextTone = new Float32Array(TONE_GRID * TONE_GRID);
  let painter: CremaPainter | null = null;
  const idle = createPitcherState();
  let count = 0;
  let pouring = startPour(surface, CHOREOGRAPHIES[order[0]!]);
  let phase: LattePhase = 'pour';
  let phaseTime = 0;
  let time = 0;
  let owed = 0;
  let version = 0;

  function tick(): void {
    time += FIELD_DT;
    phaseTime += FIELD_DT;
    if (phase !== 'admire') version += 1;
    if (phase === 'pour') {
      pouring.advance();
      if (phaseTime >= pouring.choreo.duration - 1e-9) {
        phase = 'admire';
        phaseTime = 0;
        painter = cremaPainter(random);
      }
    } else if (phase === 'admire') {
      painter?.paint(nextTone, CREMA_ROWS_A_STEP);
      if (phaseTime >= ADMIRE_S - 1e-9) {
        painter?.paint(nextTone, TONE_GRID);
        painter = null;
        phase = 'clear';
        phaseTime = 0;
      }
    } else {
      // The crema comes back as the foam settles away: by the end of the clearing it is the fresh one.
      const left = Math.max(FIELD_DT, CLEAR_S - phaseTime + FIELD_DT);
      const k = Math.min(1, FIELD_DT / left);
      const tone = surface.tone;
      for (let i = 0; i < tone.length; i += 1) tone[i] = tone[i]! + (nextTone[i]! - tone[i]!) * k;
      if (phaseTime >= CLEAR_S - 1e-9) {
        surface.foam.fill(0);
        tone.set(nextTone);
        count += 1;
        pouring = startPour(surface, CHOREOGRAPHIES[order[count % order.length]!]);
        phase = 'pour';
        phaseTime = 0;
      }
    }
  }

  return {
    get time() {
      return time;
    },
    surface,
    get version() {
      return version;
    },
    get choreo() {
      return pouring.choreo;
    },
    get phase() {
      return phase;
    },
    get phaseTime() {
      return phaseTime;
    },
    get pitcher() {
      return phase === 'pour' ? pouring.pitcher : idle;
    },
    get foamShown() {
      return phase === 'clear' ? 1 - smoothstep(0, CLEAR_S, phaseTime) : 1;
    },
    step(dtMs) {
      if (!(dtMs > 0)) return;
      owed += Math.min(dtMs, MAX_STEP_TOTAL_MS) / 1000;
      while (owed >= FIELD_DT - 1e-9) {
        owed -= FIELD_DT;
        tick();
      }
    },
  };
}

/** Steps a model through `ms`, a 30 fps frame at a time: for stills and tests. */
export function advanceLatte(model: LatteModel, ms: number, stepMs = 1000 / 30): void {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    model.step(dt);
    left -= dt;
  }
}

/**
 * Espresso Pipes' growth (D261) as pure code, after Windows' 3D Pipes:
 * three to five pipes grow a cell at a time through a grid of cells, each
 * at its own pace of a segment every 80 to 120 ms, going straight on and now
 * and then turning at a joint. A pipe boxed in by the walls and the other
 * pipes stops, and a new one starts at a free cell elsewhere. About one turn
 * in thirty is a coffee fitting instead of a plain ball: a pressure gauge, a
 * valve wheel or a small espresso cup. At 60 % of the grid full, or 4 minutes
 * into a layout, the picture fades to the page and a new layout starts.
 *
 * The drawing (pipes.ts) only builds and paints what is here, in cell units:
 * the finished parts of the layout (straight runs and joints) and the run
 * each growing pipe is drawing out now, its length a fraction of a cell more
 * every frame, so a segment never pops in whole. Every random number comes
 * from the seed and every change from step(), and each event (a pipe reaching
 * a cell, a new pipe, the fade) happens at its own time whatever the steps,
 * so the same seed gives the same picture at the same moment.
 */
import { between, createRandom, wholeBetween, type Random } from '../random.ts';

/** The grid, in cells: wide, a screen's shape across, and as deep as it is tall. */
export interface Grid {
  x: number;
  y: number;
  z: number;
}
export const GRID: Grid = { x: 20, y: 12, z: 12 };

/** How many pipes grow at once in a layout, least and most. */
export const PIPES_AT_ONCE: readonly [least: number, most: number] = [3, 5];
/** A segment, one cell further, takes this long, ms: each pipe keeps a pace of its own. */
export const SEGMENT_MS: readonly [fastest: number, slowest: number] = [80, 120];
/** Where a pipe could go straight on, the chance it turns anyway. */
export const TURN_CHANCE = 0.2;
/** A turn toward or away from the camera is this much less likely than one across: runs across the screen read better. */
export const DEPTH_WEIGHT = 0.7;
/**
 * About one joint (a turn) in thirty is a coffee fitting. A fitting stands out
 * along the axis neither pipe of its turn takes, and reads only where that
 * axis faces the camera (a gauge's dial, a wheel) or points up (a cup): one
 * due at a turn whose free axis runs across the screen waits for the next
 * turn where it reads.
 */
export const FITTING_CHANCE = 1 / 30;
/** Where the fitting faces the camera, the chance it is a gauge, else a valve wheel. */
export const GAUGE_SHARE = 0.6;
/** The layout fades once this much of the grid is taken... */
export const FULL_SHARE = 0.6;
/** ...or this long after it began. */
export const LAYOUT_MS = 240_000;
/** The fade to the page, and the empty page after it before the next layout. */
export const FADE_MS = 2500;
export const BLANK_MS = 700;
/** A boxed-in pipe's place is taken by a new one this long after, ms. */
export const RESTART_MS: readonly [soonest: number, latest: number] = [300, 900];
/** A layout's pipes start one after another, each this long after the last, ms. */
export const STAGGER_MS: readonly [soonest: number, latest: number] = [250, 1100];
/** The longest step taken in one go: the host's are a tenth of a second at most, and a broken or endless one must not hang it. */
export const MAX_STEP_MS = 10_000;
/** A ball grows to its size over this long after the pipe reaches it, a fitting's piece over the longer time. */
export const JOINT_GROW_MS = 110;
export const FITTING_GROW_MS = 320;
/** The still: a layout grown to this share of the grid. */
export const STILL_FILL = 0.42;

/**
 * Each pipe is one metal. A layout's few pipes take turns at the three bright
 * ones, in a shuffled order dealt again every three pipes, so every layout
 * shows all three; now and then the dark anodised one takes a turn instead,
 * never two pipes running.
 */
export type Metal = 'copper' | 'brass' | 'chrome' | 'anodised';
const BRIGHT_METALS: readonly Metal[] = ['copper', 'brass', 'chrome'];
export const ANODISED_CHANCE = 0.12;

/** What stands at a joint: a ball, or one of the coffee fittings. */
export type Fitting = 'ball' | 'gauge' | 'wheel' | 'cup';

/** One of the six ways along the grid: +x, -x, +y (up), -y, +z (toward the camera), -z. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5;
export const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const ALL_DIRECTIONS: readonly Direction[] = [0, 1, 2, 3, 4, 5];
/** The axis a direction runs along: 0 x, 1 y, 2 z. */
export const axisOf = (direction: Direction): number => direction >> 1;
export const opposite = (direction: Direction): Direction => (direction ^ 1) as Direction;

/** A cell of the grid: whole numbers from 0 to the grid's size less one. */
export type Cell = readonly [x: number, y: number, z: number];

/** A finished straight run: from a cell's centre, `length` whole cells on. */
export interface RunPart {
  kind: 'run';
  /** The pipe it belongs to: pipes are numbered from 0 in each layout. */
  pipe: number;
  metal: Metal;
  from: Cell;
  direction: Direction;
  length: number;
}

/** A joint: where a pipe starts, turns or stops. */
export interface JointPart {
  kind: 'joint';
  pipe: number;
  metal: Metal;
  at: Cell;
  fitting: Fitting;
  /** For a fitting, the way it faces: the gauge's dial, the wheel's stem, the cup's up. */
  facing: Direction;
  /** For a cup, the side its handle is on. */
  handle: Direction;
  /** When it came, in the layout's ms: it grows in from then (jointGrowth). */
  born: number;
  /** A pipe's first joint grows from nothing; the others from the pipe's own width. */
  start: boolean;
}

export type PipePart = RunPart | JointPart;

/** The run a pipe is growing now: from a cell's centre, `length` cells on, a fraction included. */
export interface GrowingRun {
  pipe: number;
  metal: Metal;
  from: Cell;
  direction: Direction;
  length: number;
}

export interface PipesModel {
  readonly grid: Grid;
  /** Layouts begun since it came up: the first is 0, and a new one starts the picture over. */
  layout: number;
  /** Ms since it came up, and since this layout began. */
  time: number;
  layoutTime: number;
  /** The finished parts of this layout, in the order they were made; a new array for each layout. */
  parts: PipePart[];
  /** The pipes growing now, each with the run it is drawing out. */
  growing: GrowingRun[];
  /** The share of the grid's cells taken. */
  fill: number;
  /** How far the picture has faded to the page: 0 while it grows, 1 at the end of the fade. */
  fade: number;
  /** This layout's turns, and how many of them were coffee fittings. */
  turns: number;
  fittings: number;
  /** How many pipes grow at once in this layout, and how many have started. */
  pipesAtOnce: number;
  started: number;
  step(dtMs: number): void;
}

/** How far a joint has grown in, 0 to 1, `ageMs` after it came: eased, so it settles into its size. */
export function jointGrowth(ageMs: number, growMs = JOINT_GROW_MS): number {
  const t = Math.min(1, Math.max(0, ageMs / growMs));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

interface Pipe {
  id: number;
  metal: Metal;
  /** The cell it last reached: the segment in flight grows from here, one cell on along `direction`. */
  x: number;
  y: number;
  z: number;
  direction: Direction;
  /** The current run: where it began and the whole cells done since. */
  runFrom: Cell;
  runCells: number;
  /** When the segment in flight began, in the model's ms, and how long a segment takes this pipe. */
  segmentStart: number;
  segmentMs: number;
  /** What the drawing reads. */
  view: GrowingRun;
}

export function createPipesModel(seed: number, grid: Grid = GRID): PipesModel {
  const random: Random = createRandom(seed);
  const total = grid.x * grid.y * grid.z;
  const fullCount = Math.ceil(total * FULL_SHARE);
  const taken = new Uint8Array(total);
  let takenCount = 0;
  let time = 0;
  let layoutStart = 0;
  let fadeStart: number | null = null;
  let pipes: Pipe[] = [];
  /** When the next pipes are due, in the model's ms, soonest first. */
  let starts: number[] = [];
  /** The bright metals left in this deal, the last of them dealt, and the last pipe's metal. */
  let deal: Metal[] = [];
  let lastBright: Metal | null = null;
  let lastMetal: Metal | null = null;
  /** A fitting has come due at a turn where it would not read, and waits for one where it does. */
  let fittingDue = false;

  const model: PipesModel = {
    grid,
    layout: 0,
    time: 0,
    layoutTime: 0,
    parts: [],
    growing: [],
    fill: 0,
    fade: 0,
    turns: 0,
    fittings: 0,
    pipesAtOnce: 0,
    started: 0,
    step(dtMs) {
      // A broken time is none, and no step is longer than MAX_STEP_MS.
      const ms = Number.isFinite(dtMs) ? Math.min(Math.max(0, dtMs), MAX_STEP_MS) : 0;
      const target = time + ms;
      for (;;) {
        const due = nextEvent();
        if (due === null || due.at > target) break;
        time = due.at;
        due.run();
        if (fadeStart === null && takenCount >= fullCount) beginFade();
      }
      time = target;
      refresh();
    },
  };

  const index = (x: number, y: number, z: number) => x + grid.x * (y + grid.y * z);
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < grid.x && y < grid.y && z < grid.z;
  const free = (x: number, y: number, z: number) => inside(x, y, z) && taken[index(x, y, z)] === 0;

  const take = (x: number, y: number, z: number) => {
    taken[index(x, y, z)] = 1;
    takenCount += 1;
  };

  /** The ways out of a cell into a free one, `from` (the way the pipe came) excluded. */
  const waysOut = (x: number, y: number, z: number, came: Direction | null): Direction[] =>
    ALL_DIRECTIONS.filter((direction) => {
      if (came !== null && direction === opposite(came)) return false;
      const [dx, dy, dz] = STEPS[direction]!;
      return free(x + dx, y + dy, z + dz);
    });

  /** An index into `weights`, each as likely as its weight. */
  const weighted = (weights: readonly number[]): number => {
    let left = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < weights.length; i += 1) {
      left -= weights[i]!;
      if (left < 0) return i;
    }
    return weights.length - 1;
  };

  /** One of the directions, a turn into the depth a little less likely. */
  const pickDirection = (options: readonly Direction[]): Direction =>
    options[weighted(options.map((direction) => (axisOf(direction) === 2 ? DEPTH_WEIGHT : 1)))]!;

  /** Each pipe one metal: the next of the bright ones dealt, or now and then the anodised one; never the same two running. */
  const pickMetal = (): Metal => {
    if (lastMetal !== 'anodised' && random() < ANODISED_CHANCE) {
      lastMetal = 'anodised';
      return lastMetal;
    }
    if (deal.length === 0) {
      deal = [...BRIGHT_METALS];
      for (let i = deal.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [deal[i], deal[j]] = [deal[j]!, deal[i]!];
      }
      // The new deal does not start with the metal the last one ended on.
      if (deal[0] === lastBright) [deal[0], deal[1]] = [deal[1]!, deal[0]!];
    }
    lastBright = deal.shift()!;
    lastMetal = lastBright;
    return lastMetal;
  };

  /** A free cell with a free cell beside it, for a new pipe: a few tries at random, then the first such cell from a random place on. */
  const findStart = (): Cell | null => {
    const fits = (x: number, y: number, z: number) => free(x, y, z) && waysOut(x, y, z, null).length > 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = wholeBetween(random, 0, grid.x - 1);
      const y = wholeBetween(random, 0, grid.y - 1);
      const z = wholeBetween(random, 0, grid.z - 1);
      if (fits(x, y, z)) return [x, y, z];
    }
    const offset = wholeBetween(random, 0, total - 1);
    for (let i = 0; i < total; i += 1) {
      const at = (offset + i) % total;
      const x = at % grid.x;
      const y = Math.floor(at / grid.x) % grid.y;
      const z = Math.floor(at / (grid.x * grid.y));
      if (fits(x, y, z)) return [x, y, z];
    }
    return null;
  };

  const layoutTime = () => time - layoutStart;

  /** The joint where a pipe that came along `came` leaves along `goes`: a ball, or now and then a coffee fitting. */
  const turnJoint = (pipe: Pipe, came: Direction, goes: Direction): JointPart => {
    model.turns += 1;
    if (!fittingDue && random() < FITTING_CHANCE) fittingDue = true;
    // The axis neither pipe takes: a fitting stands out along it.
    const across = 3 - axisOf(came) - axisOf(goes);
    let fitting: Fitting = 'ball';
    let facing: Direction = 2;
    let handle: Direction = 0;
    if (fittingDue && across === 2) {
      // Its dial, or its wheel, toward the camera.
      fitting = random() < GAUGE_SHARE ? 'gauge' : 'wheel';
      facing = 4;
    } else if (fittingDue && across === 1) {
      // Both pipes level, nothing above: a cup sits on it, its handle on the side along x that neither pipe takes, seen side on.
      fitting = 'cup';
      const takenX = axisOf(came) === 0 ? opposite(came) : goes;
      handle = opposite(takenX);
    }
    if (fitting !== 'ball') {
      fittingDue = false;
      model.fittings += 1;
    }
    return { kind: 'joint', pipe: pipe.id, metal: pipe.metal, at: [pipe.x, pipe.y, pipe.z], fitting, facing, handle, born: layoutTime(), start: false };
  };

  const endRun = (pipe: Pipe) => {
    if (pipe.runCells > 0) {
      model.parts.push({ kind: 'run', pipe: pipe.id, metal: pipe.metal, from: pipe.runFrom, direction: pipe.direction, length: pipe.runCells });
    }
  };

  /** A pipe has reached the next cell: on, round a turn, or stopped where it is boxed in. */
  const arrive = (pipe: Pipe) => {
    const [dx, dy, dz] = STEPS[pipe.direction]!;
    pipe.x += dx;
    pipe.y += dy;
    pipe.z += dz;
    pipe.runCells += 1;
    const options = waysOut(pipe.x, pipe.y, pipe.z, pipe.direction);
    if (options.length === 0) {
      endRun(pipe);
      model.parts.push({ kind: 'joint', pipe: pipe.id, metal: pipe.metal, at: [pipe.x, pipe.y, pipe.z], fitting: 'ball', facing: 2, handle: 0, born: layoutTime(), start: false });
      pipes = pipes.filter((other) => other !== pipe);
      starts.push(time + between(random, RESTART_MS[0], RESTART_MS[1]));
      starts.sort((a, b) => a - b);
      return;
    }
    const straight = options.includes(pipe.direction);
    const turns = options.filter((direction) => direction !== pipe.direction);
    const goes = straight && (turns.length === 0 || random() >= TURN_CHANCE) ? pipe.direction : pickDirection(turns);
    if (goes !== pipe.direction) {
      endRun(pipe);
      model.parts.push(turnJoint(pipe, pipe.direction, goes));
      pipe.runFrom = [pipe.x, pipe.y, pipe.z];
      pipe.runCells = 0;
      pipe.direction = goes;
    }
    const [nx, ny, nz] = STEPS[goes]!;
    take(pipe.x + nx, pipe.y + ny, pipe.z + nz);
    pipe.segmentStart = time;
  };

  /** A new pipe at a free cell: a ball, and its first segment under way. */
  const startPipe = () => {
    const cell = findStart();
    if (cell === null) {
      // Nowhere left to start: the grid is as full as it gets.
      beginFade();
      return;
    }
    const [x, y, z] = cell;
    take(x, y, z);
    const metal = pickMetal();
    const id = model.started;
    model.started += 1;
    model.parts.push({ kind: 'joint', pipe: id, metal, at: cell, fitting: 'ball', facing: 2, handle: 0, born: layoutTime(), start: true });
    const direction = pickDirection(waysOut(x, y, z, null));
    const [dx, dy, dz] = STEPS[direction]!;
    take(x + dx, y + dy, z + dz);
    const view: GrowingRun = { pipe: id, metal, from: cell, direction, length: 0 };
    pipes.push({ id, metal, x, y, z, direction, runFrom: cell, runCells: 0, segmentStart: time, segmentMs: between(random, SEGMENT_MS[0], SEGMENT_MS[1]), view });
  };

  const beginFade = () => {
    if (fadeStart === null) fadeStart = time;
  };

  /** A new layout: an empty grid, three to five pipes, the first now and the others one after another. */
  const beginLayout = () => {
    taken.fill(0);
    takenCount = 0;
    layoutStart = time;
    fadeStart = null;
    pipes = [];
    model.parts = [];
    model.turns = 0;
    model.fittings = 0;
    model.started = 0;
    fittingDue = false;
    deal = [];
    lastBright = null;
    lastMetal = null;
    const count = wholeBetween(random, PIPES_AT_ONCE[0], PIPES_AT_ONCE[1]);
    model.pipesAtOnce = count;
    let at = time + between(random, 0, STAGGER_MS[0]);
    starts = [];
    for (let i = 0; i < count; i += 1) {
      starts.push(at);
      at += between(random, STAGGER_MS[0], STAGGER_MS[1]);
    }
  };

  interface Due {
    at: number;
    run(): void;
  }

  /** The soonest thing to happen: a pipe reaching a cell, a new pipe, the fade, or the next layout. */
  const nextEvent = (): Due | null => {
    if (fadeStart !== null) {
      return {
        at: fadeStart + FADE_MS + BLANK_MS,
        run: () => {
          model.layout += 1;
          beginLayout();
        },
      };
    }
    let soonest: Due | null = null;
    for (const pipe of pipes) {
      const at = pipe.segmentStart + pipe.segmentMs;
      if (soonest === null || at < soonest.at) soonest = { at, run: () => arrive(pipe) };
    }
    const nextStart = starts[0];
    if (nextStart !== undefined && (soonest === null || nextStart < soonest.at)) {
      soonest = {
        at: nextStart,
        run: () => {
          starts.shift();
          startPipe();
        },
      };
    }
    const limit = layoutStart + LAYOUT_MS;
    if (soonest === null || limit < soonest.at) soonest = { at: limit, run: beginFade };
    return soonest;
  };

  /** What the drawing reads, as of now: growth stands still while the picture fades. */
  const refresh = () => {
    model.time = time;
    model.layoutTime = time - layoutStart;
    model.fill = takenCount / total;
    // The fade eases in and out of the page.
    const faded = fadeStart === null ? 0 : Math.min(1, (time - fadeStart) / FADE_MS);
    model.fade = faded * faded * (3 - 2 * faded);
    const until = fadeStart ?? time;
    model.growing = pipes.map((pipe) => {
      const progress = Math.min(1, Math.max(0, (until - pipe.segmentStart) / pipe.segmentMs));
      pipe.view.from = pipe.runFrom;
      pipe.view.direction = pipe.direction;
      pipe.view.length = pipe.runCells + progress;
      return pipe.view;
    });
  };

  beginLayout();
  refresh();
  return model;
}

/** The still's layout: a fresh one from the seed, grown to STILL_FILL of the grid a frame at a time, before any fade. */
export function growForStill(seed: number, grid: Grid = GRID, frameMs = 1000 / 30): PipesModel {
  const model = createPipesModel(seed, grid);
  // A bound, for a grid that could never fill so far: the 4 minutes.
  for (let t = 0; t < LAYOUT_MS && model.fill < STILL_FILL && model.fade === 0; t += frameMs) model.step(frameMs);
  return model;
}

import { describe, expect, it } from 'vitest';
import {
  axisOf,
  BLANK_MS,
  createPipesModel,
  FADE_MS,
  FITTING_CHANCE,
  FULL_SHARE,
  GRID,
  growForStill,
  JOINT_GROW_MS,
  jointGrowth,
  LAYOUT_MS,
  MAX_STEP_MS,
  opposite,
  PIPES_AT_ONCE,
  SEGMENT_MS,
  STEPS,
  STILL_FILL,
  type Cell,
  type Grid,
  type JointPart,
  type PipePart,
  type PipesModel,
  type RunPart,
} from './pipesModel.ts';

const FRAME_MS = 1000 / 30;

function snapshot(model: PipesModel) {
  return {
    layout: model.layout,
    layoutTime: model.layoutTime,
    fill: model.fill,
    fade: model.fade,
    parts: model.parts.map((part) => ({ ...part })),
    growing: model.growing.map((run) => ({ ...run })),
  };
}

/** Steps a frame at a time until `done`, or `limit` ms. */
function stepUntil(model: PipesModel, done: (model: PipesModel) => boolean, limit = 600_000): void {
  for (let t = 0; t < limit && !done(model); t += FRAME_MS) model.step(FRAME_MS);
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const along = (from: Cell, direction: number, n: number): Cell => {
  const [dx, dy, dz] = STEPS[direction]!;
  return [from[0] + dx * n, from[1] + dy * n, from[2] + dz * n];
};

/** Every cell a layout's pipes take, and which pipe took it; throws on a cell taken twice or off the grid. */
function cellsTaken(model: PipesModel): Map<string, number> {
  const cells = new Map<string, number>();
  const claim = (cell: Cell, pipe: number) => {
    const [x, y, z] = cell;
    if (x < 0 || y < 0 || z < 0 || x >= model.grid.x || y >= model.grid.y || z >= model.grid.z) throw new Error(`off the grid: ${key(x, y, z)}`);
    const owner = cells.get(key(x, y, z));
    if (owner !== undefined && owner !== pipe) throw new Error(`pipes ${owner} and ${pipe} both at ${key(x, y, z)}`);
    cells.set(key(x, y, z), pipe);
  };
  for (const part of model.parts) {
    if (part.kind === 'joint') claim(part.at, part.pipe);
    else for (let i = 0; i <= part.length; i += 1) claim(along(part.from, part.direction, i), part.pipe);
  }
  // A growing pipe has taken the cell its segment in flight is going to.
  for (const run of model.growing) for (let i = 0; i <= Math.floor(run.length) + 1; i += 1) claim(along(run.from, run.direction, i), run.pipe);
  return cells;
}

/** Each pipe's parts in order. */
function pipesOf(parts: readonly PipePart[]): Map<number, PipePart[]> {
  const byPipe = new Map<number, PipePart[]>();
  for (const part of parts) byPipe.set(part.pipe, [...(byPipe.get(part.pipe) ?? []), part]);
  return byPipe;
}

/** The turns' joints with the runs either side: the way the pipe came in and the way it went on. */
function turnsOf(parts: readonly PipePart[]): { joint: JointPart; came: RunPart; goes: RunPart }[] {
  const turns: { joint: JointPart; came: RunPart; goes: RunPart }[] = [];
  for (const own of pipesOf(parts).values()) {
    for (let i = 1; i + 1 < own.length; i += 1) {
      const [came, joint, goes] = [own[i - 1]!, own[i]!, own[i + 1]!];
      if (joint.kind === 'joint' && came.kind === 'run' && goes.kind === 'run') turns.push({ joint, came, goes });
    }
  }
  return turns;
}

describe('createPipesModel', () => {
  it('is the same picture for the same seed and the same steps, and another for another seed', () => {
    const a = createPipesModel(5);
    const b = createPipesModel(5);
    const c = createPipesModel(6);
    for (const model of [a, b, c]) for (let i = 0; i < 300; i += 1) model.step(FRAME_MS);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(a).parts).not.toEqual(snapshot(c).parts);
  });

  it('takes its steps in any pieces: one long step is as good as many short ones', () => {
    const one = createPipesModel(2);
    const fifties = createPipesModel(2);
    const fives = createPipesModel(2);
    one.step(5000);
    for (let i = 0; i < 100; i += 1) fifties.step(50);
    for (let i = 0; i < 1000; i += 1) fives.step(5);
    expect(snapshot(fifties)).toEqual(snapshot(one));
    expect(snapshot(fives)).toEqual(snapshot(one));
  });

  it('takes any step, however enormous or odd, without hanging or going wrong', () => {
    const model = createPipesModel(1);
    model.step(Number.NaN);
    model.step(-30);
    model.step(Infinity);
    expect(model.time).toBe(0);
    model.step(Number.MAX_VALUE);
    // Held to MAX_STEP_MS.
    expect(model.time).toBe(MAX_STEP_MS);
    expect(model.parts.length).toBeGreaterThan(0);
  });

  it('grows three to five pipes at a time, as the seed says, and starts new ones as others stop', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const model = createPipesModel(seed);
      let most = 0;
      stepUntil(model, (m) => {
        most = Math.max(most, m.growing.length);
        expect(m.growing.length).toBeLessThanOrEqual(m.pipesAtOnce);
        return m.fade > 0;
      });
      expect(model.pipesAtOnce).toBeGreaterThanOrEqual(PIPES_AT_ONCE[0]);
      expect(model.pipesAtOnce).toBeLessThanOrEqual(PIPES_AT_ONCE[1]);
      expect(most).toBe(model.pipesAtOnce);
      // Boxed-in pipes were followed by new ones.
      expect(model.started).toBeGreaterThan(model.pipesAtOnce);
      counts.add(model.pipesAtOnce);
    }
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });

  it('grows each pipe smoothly, a segment every 80 to 120 ms: a run lengthens a little every step and never jumps', () => {
    const model = createPipesModel(3);
    const before = new Map<number, { from: Cell; direction: number; length: number }>();
    let measured = 0;
    for (let i = 0; i < 1500; i += 1) {
      model.step(10);
      for (const run of model.growing) {
        const last = before.get(run.pipe);
        if (last && last.from === run.from && last.direction === run.direction) {
          const grown = run.length - last.length;
          expect(grown).toBeGreaterThanOrEqual(10 / SEGMENT_MS[1] - 1e-9);
          expect(grown).toBeLessThanOrEqual(10 / SEGMENT_MS[0] + 1e-9);
          measured += 1;
        }
        before.set(run.pipe, { from: run.from, direction: run.direction, length: run.length });
      }
    }
    expect(measured).toBeGreaterThan(1000);
  });

  it('never grows two pipes through one cell, keeps them on the grid, and turns them only at right angles', () => {
    for (const seed of [1, 4, 9]) {
      const model = createPipesModel(seed);
      for (let i = 0; i < 40; i += 1) {
        for (let j = 0; j < 30; j += 1) model.step(FRAME_MS);
        expect(() => cellsTaken(model)).not.toThrow();
      }
      for (const own of pipesOf(model.parts).values()) {
        // A ball where it starts, then runs and joints by turns, each run starting at the joint before it and ending at the next.
        const first = own[0]!;
        expect(first.kind === 'joint' && first.start).toBe(true);
        for (let i = 1; i < own.length; i += 1) {
          const part = own[i]!;
          const previous = own[i - 1]!;
          expect(part.kind).not.toBe(previous.kind);
          if (part.kind === 'run' && previous.kind === 'joint') expect(part.from).toEqual(previous.at);
          if (part.kind === 'joint' && previous.kind === 'run') {
            expect(part.at).toEqual(along(previous.from, previous.direction, previous.length));
            expect(part.start).toBe(false);
          }
        }
      }
      for (const { came, goes } of turnsOf(model.parts)) expect(axisOf(goes.direction)).not.toBe(axisOf(came.direction));
    }
  });

  it('stops a pipe that is boxed in with a ball, and starts a new one at a free cell', () => {
    // A flat grid: pipes box each other in quickly.
    const grid: Grid = { x: 12, y: 1, z: 12 };
    let ended = 0;
    let restarted = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const model = createPipesModel(seed, grid);
      stepUntil(model, (m) => m.fade > 0);
      expect(() => cellsTaken(model)).not.toThrow();
      const growing = new Set(model.growing.map((run) => run.pipe));
      for (const [pipe, own] of pipesOf(model.parts)) {
        const last = own[own.length - 1]!;
        if (growing.has(pipe) || own.length < 2) continue;
        // Stopped: its last part is a ball where it was boxed in.
        expect(last.kind === 'joint' && last.fitting === 'ball' && !last.start).toBe(true);
        ended += 1;
      }
      restarted += model.started - model.pipesAtOnce;
    }
    expect(ended).toBeGreaterThan(10);
    expect(restarted).toBeGreaterThan(5);
  });

  it('makes about one turn in thirty a coffee fitting, each turned to be seen', () => {
    let turns = 0;
    let fittings = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const model = createPipesModel(seed);
      stepUntil(model, (m) => m.fade > 0);
      turns += model.turns;
      fittings += model.fittings;
      for (const { joint, came, goes } of turnsOf(model.parts)) {
        if (joint.fitting === 'ball') continue;
        kinds.add(joint.fitting);
        const axes = [axisOf(came.direction), axisOf(goes.direction)].sort();
        if (joint.fitting === 'cup') {
          // Both pipes level, nothing above; the handle along x, on a side no pipe takes.
          expect(axes).toEqual([0, 2]);
          expect(axisOf(joint.handle)).toBe(0);
          expect(joint.handle).not.toBe(opposite(came.direction));
          expect(joint.handle).not.toBe(goes.direction);
        } else {
          // The dial or the wheel toward the camera, the pipes across the screen.
          expect(axes).toEqual([0, 1]);
          expect(joint.facing).toBe(4);
        }
      }
    }
    expect(fittings / turns).toBeGreaterThan(FITTING_CHANCE * 0.7);
    expect(fittings / turns).toBeLessThan(FITTING_CHANCE * 1.3);
    expect([...kinds].sort()).toEqual(['cup', 'gauge', 'wheel']);
  });

  it('gives each pipe one metal: every layout copper, brass and chrome, the anodised now and then, never the same two running', () => {
    let anodised = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const model = createPipesModel(seed);
      stepUntil(model, (m) => m.fade > 0);
      const metals = [...pipesOf(model.parts).values()].map((own) => own[0]!.metal);
      for (const own of pipesOf(model.parts).values()) expect(new Set(own.map((part) => part.metal)).size).toBe(1);
      for (let i = 1; i < metals.length; i += 1) expect(metals[i]).not.toBe(metals[i - 1]);
      const bright = metals.filter((metal) => metal !== 'anodised');
      if (bright.length >= 3) expect(new Set(bright.slice(0, 3)).size).toBe(3);
      anodised += metals.filter((metal) => metal === 'anodised').length;
    }
    expect(anodised).toBeGreaterThan(0);
  });

  it('fades to the page at 60 % of the grid full, growth standing still, then starts a new layout', () => {
    const model = createPipesModel(7);
    stepUntil(model, (m) => m.fade > 0);
    expect(model.layout).toBe(0);
    expect(model.fill).toBeGreaterThanOrEqual(FULL_SHARE);
    expect(model.fill).toBeLessThan(FULL_SHARE + 0.01);
    expect(model.layoutTime).toBeLessThan(LAYOUT_MS);
    const full = snapshot(model);
    // Through the fade nothing grows, and it reaches the page.
    for (let t = 0; t < FADE_MS - 100; t += FRAME_MS) model.step(FRAME_MS);
    expect(model.fade).toBeLessThan(1);
    expect(snapshot(model).parts).toEqual(full.parts);
    expect(snapshot(model).growing).toEqual(full.growing);
    model.step(100);
    expect(model.fade).toBe(1);
    model.step(BLANK_MS - 50);
    expect(model.layout).toBe(0);
    // The next layout: an empty grid that grows again, laid out anew.
    model.step(100);
    expect(model.layout).toBe(1);
    expect(model.fade).toBe(0);
    expect(model.fill).toBeLessThan(0.01);
    stepUntil(model, (m) => m.parts.length >= 20);
    expect(model.parts.slice(0, 20)).not.toEqual(full.parts.slice(0, 20));
  });

  it('fades after 4 minutes where the grid never fills so far', () => {
    const model = createPipesModel(4, { x: 60, y: 40, z: 40 });
    for (let t = 0; t < LAYOUT_MS - 1000; t += 100) model.step(100);
    expect(model.fade).toBe(0);
    model.step(1000);
    expect(model.fill).toBeLessThan(FULL_SHARE);
    expect(model.fade).toBeCloseTo(0, 6);
    model.step(FADE_MS / 2);
    expect(model.fade).toBeCloseTo(0.5, 6);
  });

  it('grows its joints in: from nothing for a pipe’s first, eased, whole once grown', () => {
    expect(jointGrowth(0)).toBe(0);
    expect(jointGrowth(JOINT_GROW_MS)).toBe(1);
    expect(jointGrowth(10 * JOINT_GROW_MS)).toBe(1);
    expect(jointGrowth(-5)).toBe(0);
    let last = 0;
    for (let t = 1; t <= JOINT_GROW_MS; t += 1) {
      const grown = jointGrowth(t);
      expect(grown).toBeGreaterThan(last);
      last = grown;
    }
    // Eased out: most of the way there in the first half.
    expect(jointGrowth(JOINT_GROW_MS / 2)).toBeGreaterThan(0.8);
  });
});

describe('growForStill', () => {
  it('is a well-grown layout from the seed, before any fade', () => {
    for (const seed of [1, 2, 3]) {
      const model = growForStill(seed);
      expect(model.fill).toBeGreaterThanOrEqual(STILL_FILL);
      expect(model.fill).toBeLessThan(FULL_SHARE);
      expect(model.fade).toBe(0);
      expect(model.grid).toEqual(GRID);
      expect(snapshot(growForStill(seed))).toEqual(snapshot(model));
    }
  });
});

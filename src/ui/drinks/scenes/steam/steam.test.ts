import { describe, expect, it } from 'vitest';
import { C } from '../canvas.ts';
import { FRAME_S, sceneRun, type RunShape } from '../testing/sceneRun.ts';
import { drawCalls, stubFrame, type StubContext, type StubFrame } from '../testing/stubContext.ts';
import type { Scene, SceneFactory, SceneInput } from '../types.ts';
import { createRosetta } from './rosetta.ts';
import { createSimpleSteam } from './simple.ts';
import { createSpray } from './spray.ts';
import { createWhirlpool } from './whirlpool.ts';

/** The same random numbers every run, so a test draws the same particles each time. */
function seeded(start: number): () => number {
  let seed = start;
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** sceneRun's heating lasts 1.5 s; the index of the input `seconds` into the work. */
const workAt = (seconds: number) => Math.round((1.5 + seconds) / FRAME_S);
const calls = (frame: StubFrame) => drawCalls(frame.ctx) + drawCalls(frame.layerCtx);
const named = (ctx: StubContext, name: string) => ctx.calls.filter((call) => call.name === name);

/** The scene moved on through `inputs` (all of them, or up to `until`), as the canvas's loop would. */
function play(scene: Scene, inputs: readonly SceneInput[], until = inputs.length - 1): SceneInput {
  for (const input of inputs.slice(0, until + 1)) scene.update(FRAME_S, input);
  return inputs[until]!;
}

const SCENES: readonly (readonly [string, SceneFactory])[] = [
  ['Wand and spray', createSpray],
  ['Whirlpool', createWhirlpool],
  ['Rosetta', createRosetta],
  ['Simple', createSimpleSteam],
];

for (const [name, make] of SCENES) {
  describe(name, () => {
    it('updates and draws through a whole run in both modes without a call a browser would refuse', () => {
      /** The most drawing calls one frame took, drawing every `every`th frame. */
      const most = (mode: 'dark' | 'light', shape: RunShape, every: number) => {
        const scene = make(seeded(7));
        let calls = 0;
        sceneRun('steam', shape).forEach((input, i) => {
          scene.update(FRAME_S, input);
          if (i % every !== 0) return;
          const frame = stubFrame({ mode, done: input.phase === 'done' });
          scene.draw(frame, input);
          calls = Math.max(calls, drawCalls(frame.ctx) + drawCalls(frame.layerCtx));
        });
        return calls;
      };
      expect(most('dark', {}, 1)).toBeLessThan(5000);
      expect(most('light', {}, 1)).toBeLessThan(5000);
      // The particles stay within bounds however hard the machine steams.
      expect(most('dark', { strength: 2.2, heat: 1.15 }, 4)).toBeLessThan(5000);
    });

    it('draws while the steam works, and cuts what moves out behind the figures', () => {
      const scene = make(seeded(7));
      const input = play(scene, sceneRun('steam'), workAt(6));
      expect(input.phase).toBe('working');
      const frame = stubFrame();
      scene.draw(frame, input);
      expect(calls(frame)).toBeGreaterThan(20);
      expect(frame.cuts).not.toEqual([]);
      expect(named(frame.ctx, 'blit'), 'every cut layer is drawn').toHaveLength(frame.cuts.length);
    });

    it('draws a still frame anywhere in a run without update', () => {
      const inputs = sceneRun('steam');
      for (const at of [0, workAt(0.5), workAt(6), workAt(11.9), inputs.length - 1]) {
        const input = inputs[at]!;
        const frame = stubFrame({ still: true, done: input.phase === 'done' });
        expect(() => make(seeded(7)).draw(frame, input)).not.toThrow();
        expect(calls(frame), input.phase).toBeGreaterThan(0);
      }
    });

    it('stops settling within 3 s of the run ending', () => {
      const scene = make(seeded(7));
      let ended: number | null = null;
      sceneRun('steam', { afterS: 4 }).forEach((input, i) => {
        scene.update(FRAME_S, input);
        if (input.phase !== 'done') return;
        ended ??= i;
        if ((i - ended) * FRAME_S >= 3) expect(scene.settling(), `${((i - ended) * FRAME_S).toFixed(2)} s after`).toBe(false);
      });
      expect(ended).not.toBeNull();
    });
  });
}

/** Drawing calls summed over 2 s of work at `strength`. */
function drawnOverWork(make: SceneFactory, strength: number): number {
  const scene = make(seeded(7));
  let sum = 0;
  for (const input of sceneRun('steam', { strength, workS: 2, afterS: 0 })) {
    scene.update(FRAME_S, input);
    if (input.phase !== 'working') continue;
    const frame = stubFrame();
    scene.draw(frame, input);
    sum += calls(frame);
  }
  return sum;
}

describe('Wand and spray', () => {
  it('follows strength: a strong steam draws more than a weak one', () => {
    expect(drawnOverWork(createSpray, 1.8)).toBeGreaterThan(drawnOverWork(createSpray, 0.4) * 1.5);
  });

  it('lets its steam show behind the figures at a tenth of its strength, no more', () => {
    const scene = createSpray(seeded(7));
    const input = play(scene, sceneRun('steam'), workAt(6));
    const frame = stubFrame();
    scene.draw(frame, input);
    expect(frame.cuts).toEqual([0.9]);
  });

  it('puffs from the tip while it purges, and gives off nothing once it is done', () => {
    const puffs = (phase: 'purging' | 'done') => {
      const scene = createSpray(seeded(7));
      const input: SceneInput = { kind: 'steam', phase, live: phase === 'purging', progress: 1, strength: 0, heat: 1, warmth: 1 };
      for (let i = 0; i < 30; i += 1) scene.update(FRAME_S, input);
      const frame = stubFrame({ done: phase === 'done' });
      scene.draw(frame, input);
      return named(frame.layerCtx, 'createRadialGradient').map((call) => call.args as number[]);
    };
    const purge = puffs('purging');
    expect(purge.length).toBeGreaterThan(5);
    // Each puff's centre: above the tip, near it.
    expect(purge.every(([x, y]) => Math.abs(x! - 184) < 30 && y! < 205)).toBe(true);
    expect(puffs('done')).toEqual([]);
  });
});

describe('Whirlpool', () => {
  it('follows strength: a strong steam draws more than a weak one', () => {
    expect(drawnOverWork(createWhirlpool, 1.8)).toBeGreaterThan(drawnOverWork(createWhirlpool, 0.4));
  });

  it('cuts its foam out behind the figures entirely', () => {
    const scene = createWhirlpool(seeded(7));
    const input = play(scene, sceneRun('steam'), workAt(6));
    const frame = stubFrame();
    scene.draw(frame, input);
    expect(frame.cuts).toEqual([1]);
  });
});

describe('Rosetta', () => {
  /** The ellipses a still frame fills at `progress`: two a leaf, the base under them and the dot on top. */
  const ellipses = (progress: number, phase: SceneInput['phase'] = 'working') => {
    const frame = stubFrame({ still: true, done: phase === 'done' });
    const input: SceneInput = { kind: 'steam', phase, live: phase !== 'done', progress, strength: 1, heat: 1, warmth: progress };
    createRosetta(seeded(7)).draw(frame, input);
    return named(frame.ctx, 'ellipse').length;
  };

  it('pours a leaf for every twelfth of the steam time, twelve in all', () => {
    expect(ellipses(0)).toBe(0);
    expect(ellipses(0.5)).toBe(1 + 6 * 2);
    expect(ellipses(1)).toBe(1 + 12 * 2 + 1);
  });

  it('draws the pull-through’s stem once done, cut out behind the figures, and none while it pours', () => {
    const live = stubFrame({ still: true });
    createRosetta(seeded(7)).draw(live, { kind: 'steam', phase: 'working', live: true, progress: 1, strength: 1, heat: 1, warmth: 1 });
    expect(live.cuts).toEqual([1]);
    const done = stubFrame({ still: true, done: true });
    createRosetta(seeded(7)).draw(done, { kind: 'steam', phase: 'done', live: false, progress: 1, strength: 0, heat: 1, warmth: 1 });
    expect(done.cuts).toEqual([1, 1]);
    const stem = named(done.layerCtx, 'moveTo').find((call) => call.args[0] === C);
    expect(stem).toBeDefined();
  });

  it('draws the pull-through as the run ends, and settles once it is drawn', () => {
    const scene = createRosetta(seeded(7));
    const inputs = sceneRun('steam', { afterS: 2 });
    const ended = inputs.findIndex((input) => input.phase === 'done');
    play(scene, inputs, ended + 1);
    expect(scene.settling(), 'drawing its stem').toBe(true);
    play(scene, inputs.slice(ended + 2));
    expect(scene.settling()).toBe(false);
  });

  it('does not draw the pull-through for a run cut short, nor before any run', () => {
    for (const phase of ['lost', 'idle'] as const) {
      const scene = createRosetta(seeded(7));
      const input: SceneInput = { kind: 'steam', phase, live: false, progress: phase === 'idle' ? 0 : 0.6, strength: 0, heat: 1, warmth: 0.6 };
      for (let i = 0; i < 120; i += 1) scene.update(FRAME_S, input);
      const frame = stubFrame();
      scene.draw(frame, input);
      expect(frame.cuts, phase).toEqual([1]);
      expect(scene.settling(), phase).toBe(false);
    }
  });
});

describe('Simple', () => {
  const FLOOR = C + 99;
  const DEPTH = 99 * 2;
  /** Where the milk's wave starts, its first point. */
  const milkTop = (progress: number) => {
    const frame = stubFrame({ still: true });
    createSimpleSteam(seeded(7)).draw(frame, { kind: 'steam', phase: 'working', live: true, progress, strength: 1, heat: 1, warmth: progress });
    return named(frame.ctx, 'moveTo')[0]!.args;
  };

  it('fills the milk from 17% of the inside to 32% with the steam time', () => {
    expect(milkTop(0)[1]).toBeCloseTo(FLOOR - 0.17 * DEPTH, 6);
    expect(milkTop(1)[1]).toBeCloseTo(FLOOR - 0.32 * DEPTH, 6);
  });

  it('sends three wisps up only while it runs, and none drawn still', () => {
    /** The curves drawn on the layer: the milk's surface is eight, each wisp two. */
    const curves = (frame: StubFrame) => named(frame.layerCtx, 'bezierCurveTo').length;
    const scene = createSimpleSteam(seeded(7));
    const inputs = sceneRun('steam', { afterS: 1 });
    const working = play(scene, inputs, workAt(4));
    const live = stubFrame();
    scene.draw(live, working);
    expect(curves(live)).toBe(8 + 3 * 2);
    const still = stubFrame({ still: true });
    scene.draw(still, working);
    expect(curves(still)).toBe(8);
    const done = play(scene, inputs);
    const after = stubFrame({ done: true });
    scene.draw(after, done);
    expect(curves(after)).toBe(8);
    expect(scene.settling()).toBe(false);
  });
});

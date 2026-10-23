import { describe, expect, it } from 'vitest';
import { FRAME_S, sceneRun } from '../testing/sceneRun.ts';
import { drawCalls, stubFrame, type StubFrame } from '../testing/stubContext.ts';
import type { Scene, SceneInput } from '../types.ts';
import { createAbove } from './above.ts';
import { createPour } from './pour.ts';
import { createSimpleHotWater } from './simple.ts';

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Every drawing call a frame took, on the canvas and on its layer. */
const calls = (frame: StubFrame) => drawCalls(frame.ctx) + drawCalls(frame.layerCtx);

/** Moves the scene on through the run up to `at` seconds in, and gives the input there. */
function runTo(scene: Scene, run: readonly SceneInput[], at: number): SceneInput {
  const last = Math.min(run.length - 1, Math.round(at / FRAME_S));
  for (const input of run.slice(0, last + 1)) scene.update(FRAME_S, input);
  return run[last]!;
}

/** sceneRun's moments: heating, mid-pour, and done. */
const HEATING_S = 0.5;
const POURING_S = 8;
const DONE_S = 15;

for (const [name, make] of [['Pour', createPour], ['From above', createAbove], ['Simple', createSimpleHotWater]] as const) {
  // Simple is D149's scene: it follows no strength and has no drops to settle.
  const simple = make === createSimpleHotWater;
  describe(name, () => {
    it('updates and draws through a whole run in both modes without a call a browser would refuse', () => {
      for (const mode of ['dark', 'light'] as const) {
        const scene = make(seeded(7));
        for (const input of sceneRun('hotWater')) {
          scene.update(FRAME_S, input);
          const frame = stubFrame({ mode, done: input.phase === 'done' });
          scene.draw(frame, input);
          expect(calls(frame)).toBeLessThan(5000);
        }
      }
    });

    it('keeps what it draws bounded through a pour as hard as a machine goes', () => {
      const scene = make(seeded(7));
      sceneRun('hotWater', { workS: 10, strength: 2.2 }).forEach((input, i) => {
        scene.update(FRAME_S, input);
        if (i % 6 !== 0) return;
        const frame = stubFrame({ done: input.phase === 'done' });
        scene.draw(frame, input);
        expect(calls(frame)).toBeLessThan(5000);
      });
    });

    it('draws while the water pours, and cuts what moves out behind the figures', () => {
      const scene = make(seeded(7));
      const input = runTo(scene, sceneRun('hotWater'), POURING_S);
      expect(input.phase).toBe('working');
      const frame = stubFrame();
      scene.draw(frame, input);
      expect(calls(frame)).toBeGreaterThan(20);
      expect(frame.cuts).not.toEqual([]);
      // Vapour may show a tenth of itself through the figures; nothing else may.
      for (const amount of frame.cuts) expect(amount).toBeGreaterThanOrEqual(0.9);
      expect(frame.ctx.calls.some((call) => call.name === 'blit')).toBe(true);
    });

    it('draws a still frame anywhere in a run without update', () => {
      const run = sceneRun('hotWater');
      for (const at of [HEATING_S, POURING_S, DONE_S]) {
        const input = run[Math.round(at / FRAME_S)]!;
        const frame = stubFrame({ still: true, done: input.phase === 'done' });
        make(seeded(7)).draw(frame, input);
        expect(calls(frame)).toBeGreaterThan(0);
        // Reduced motion turned on mid-run: what had moved is not drawn, so the frame is the same.
        const moved = make(seeded(7));
        runTo(moved, run, at);
        const after = stubFrame({ still: true, done: input.phase === 'done' });
        moved.draw(after, input);
        expect(calls(after)).toBe(calls(frame));
      }
    });

    it('stops settling within 3 s of the run ending', () => {
      const scene = make(seeded(7));
      const run = sceneRun('hotWater', { afterS: 4 });
      const end = run.findIndex((input) => !input.live);
      run.forEach((input, i) => {
        scene.update(FRAME_S, input);
        // The new scenes still move a moment after the water stops: drops fall, rings spread.
        if (i === end && !simple) expect(scene.settling()).toBe(true);
        if (i - end >= Math.round(3 / FRAME_S)) expect(scene.settling()).toBe(false);
      });
    });

    if (!simple) {
      it('follows strength: a strong pour draws more than a weak one', () => {
        const drawn = (strength: number) => {
          const scene = make(seeded(7));
          let sum = 0;
          // The heating, then 2 s of the pour.
          for (const input of sceneRun('hotWater', { strength }).slice(0, Math.round(3.5 / FRAME_S))) {
            scene.update(FRAME_S, input);
            if (input.phase !== 'working') continue;
            const frame = stubFrame();
            scene.draw(frame, input);
            sum += calls(frame);
          }
          return sum;
        };
        expect(drawn(1.8)).toBeGreaterThan(drawn(0.4));
      });
    }
  });
}

describe('Simple (today’s stream and water)', () => {
  /** The dashed stream, as the frame drew it on its layer. */
  const streams = (frame: StubFrame) => frame.layerCtx.calls.filter((call) => call.name === 'setLineDash' && JSON.stringify(call.args) === '[[12,9]]');

  it('falls a dashed stream while the machine runs, and none once it stops', () => {
    const scene = createSimpleHotWater();
    const run = sceneRun('hotWater');
    const pouring = stubFrame();
    scene.draw(pouring, runTo(scene, run, POURING_S));
    expect(streams(pouring)).toHaveLength(1);
    const done = stubFrame({ done: true });
    scene.draw(done, runTo(scene, run, DONE_S));
    expect(streams(done)).toEqual([]);
  });

  it('fills the inside of the ring to the progress', () => {
    const scene = createSimpleHotWater();
    const surface = (progress: number) => {
      const frame = stubFrame({ still: true });
      scene.draw(frame, { ...sceneRun('hotWater')[0]!, phase: 'working', live: true, progress });
      return frame.ctx.calls.find((call) => call.name === 'moveTo')!.args[1];
    };
    // The floor of the ring's inside at 136 + 99, its top at 136 - 99.
    expect(surface(0)).toBeCloseTo(235, 6);
    expect(surface(0.5)).toBeCloseTo(136, 6);
    expect(surface(1)).toBeCloseTo(37, 6);
  });
});

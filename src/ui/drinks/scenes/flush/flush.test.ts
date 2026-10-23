import { describe, expect, it } from 'vitest';
import { FRAME_S, sceneRun } from '../testing/sceneRun.ts';
import { drawCalls, stubFrame, type StubFrame } from '../testing/stubContext.ts';
import type { Scene, SceneInput } from '../types.ts';
import { createScreen } from './screen.ts';
import { createShower } from './shower.ts';
import { createSimpleFlush } from './simple.ts';

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

/** sceneRun's moments: heating, mid-flush, and done. */
const HEATING_S = 0.5;
const FLUSHING_S = 8;
const DONE_S = 15;

for (const [name, make] of [['Shower', createShower], ['Screen', createScreen], ['Simple', createSimpleFlush]] as const) {
  // Simple is D149's scene: it follows no strength, has no drops to settle and keeps the flow's blue.
  const simple = make === createSimpleFlush;
  describe(name, () => {
    it('updates and draws through a whole run in both modes without a call a browser would refuse', () => {
      for (const mode of ['dark', 'light'] as const) {
        const scene = make(seeded(7));
        for (const input of sceneRun('flush')) {
          scene.update(FRAME_S, input);
          const frame = stubFrame({ mode, done: input.phase === 'done' });
          scene.draw(frame, input);
          expect(calls(frame)).toBeLessThan(5000);
        }
      }
    });

    it('keeps what it draws bounded through a flush as hard as a machine goes', () => {
      const scene = make(seeded(7));
      sceneRun('flush', { workS: 10, strength: 2.2 }).forEach((input, i) => {
        scene.update(FRAME_S, input);
        if (i % 6 !== 0) return;
        const frame = stubFrame({ done: input.phase === 'done' });
        scene.draw(frame, input);
        expect(calls(frame)).toBeLessThan(5000);
      });
    });

    it('draws while the water runs, and cuts what moves out behind the figures', () => {
      const scene = make(seeded(7));
      const input = runTo(scene, sceneRun('flush'), FLUSHING_S);
      expect(input.phase).toBe('working');
      const frame = stubFrame();
      scene.draw(frame, input);
      expect(calls(frame)).toBeGreaterThan(20);
      expect(frame.cuts).not.toEqual([]);
      for (const amount of frame.cuts) expect(amount).toBe(1);
      expect(frame.ctx.calls.some((call) => call.name === 'blit')).toBe(true);
    });

    it('draws a still frame anywhere in a run without update', () => {
      const run = sceneRun('flush');
      for (const at of [HEATING_S, FLUSHING_S, DONE_S]) {
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
      const run = sceneRun('flush', { afterS: 4 });
      const end = run.findIndex((input) => !input.live);
      run.forEach((input, i) => {
        scene.update(FRAME_S, input);
        // The new scenes still move a moment after the water stops: the last drops fall.
        if (i === end && !simple) expect(scene.settling()).toBe(true);
        if (i - end >= Math.round(3 / FRAME_S)) expect(scene.settling()).toBe(false);
      });
    });

    if (!simple) {
      it('follows strength: a strong flush draws more than a weak one', () => {
        const drawn = (strength: number) => {
          const scene = make(seeded(7));
          let sum = 0;
          // The heating, then 2 s of the flush.
          for (const input of sceneRun('flush', { strength }).slice(0, Math.round(3.5 / FRAME_S))) {
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

      it('colours the water by the group against its target: a cool group and a warm one differ', () => {
        /** The colours the frame stroked and filled with, their alpha left out. */
        const colours = (heat: number) => {
          const scene = make(seeded(7));
          const frame = stubFrame();
          scene.draw(frame, runTo(scene, sceneRun('flush', { heat }), FLUSHING_S));
          const styles = [...frame.ctx.calls, ...frame.layerCtx.calls].filter((call) => call.name === 'set strokeStyle' || call.name === 'set fillStyle');
          return new Set(styles.map((call) => String(call.args[0]).replace(/,[\d.]+\)$/, ')')));
        };
        const cool = colours(0);
        expect([...colours(1)].filter((colour) => !cool.has(colour))).not.toEqual([]);
      });
    }
  });
}

describe('Simple (today’s screen and streaks)', () => {
  /** The streaks' strokes on the frame's layer. */
  const streaks = (frame: StubFrame) => frame.layerCtx.calls.filter((call) => call.name === 'stroke');

  it('pours five streaks from the screen while the water runs, and none once it stops; the screen stays', () => {
    const scene = createSimpleFlush();
    const run = sceneRun('flush');
    const flushing = stubFrame();
    scene.draw(flushing, runTo(scene, run, FLUSHING_S));
    expect(streaks(flushing)).toHaveLength(5);
    const done = stubFrame({ done: true });
    scene.draw(done, runTo(scene, run, DONE_S));
    expect(streaks(done)).toEqual([]);
    for (const frame of [flushing, done]) {
      expect(frame.ctx.calls.filter((call) => call.name === 'moveTo' || call.name === 'lineTo').map((call) => call.args)).toEqual([
        [104, 44],
        [168, 44],
      ]);
    }
  });
});

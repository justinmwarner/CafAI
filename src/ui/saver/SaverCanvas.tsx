/**
 * One canvas screensaver on a canvas filling the overlay (D-SAVER-4, D-SAVER-5):
 * sized at the device's pixel ratio (at most 1.5) and again as the canvas
 * changes size, run on the shared 30 fps loop (runner.ts) and paused while
 * the page is hidden. Under reduced motion it paints the screensaver's still
 * instead, and again each minute; with `at` it plays every frame up to that
 * moment, each stepped and drawn as the loop would (a screensaver whose
 * trails build up frame by frame, Brew Rain's, needs the draws), and holds
 * the last (the mock builds' held Preview, for screenshots and the smoke
 * test). The canvas has no background of its own: the overlay's is behind
 * it, and a screensaver may set one on its canvas. The screensaver gets its
 * context itself, and is sized before its first draw. A screensaver that
 * cannot get its context, or throws, reports it (`onFail`) for the overlay
 * to show Nightstand instead; nothing here throws.
 */
import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';
import { backingScale, runSaver, SAVER_FPS, sizeSaver, type SaverRun } from './runner.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from './types.ts';

/** Under reduced motion the still is painted again this often: a screen never holds one picture all night. */
export const STILL_EVERY_MS = 60_000;

/**
 * Plays a screensaver to `ms` as its loop would at 30 fps, every frame drawn:
 * the first frame only draws, each after it steps a frame's time and draws.
 */
export function playTo(instance: SaverInstance, ms: number): void {
  const frame = 1000 / SAVER_FPS;
  instance.draw();
  // Whole frames counted, not subtracted, so no sliver of a frame is left over to draw once more.
  const whole = Math.floor(ms / frame + 1e-9);
  for (let i = 0; i < whole; i += 1) {
    instance.step(frame);
    instance.draw();
  }
  const rest = ms - whole * frame;
  if (rest > 1e-6) {
    instance.step(rest);
    instance.draw();
  }
}

export interface SaverCanvasProps {
  saver: CanvasSaver;
  env: SaverEnv;
  /** Reduced motion: the still, again each minute. */
  still: boolean;
  /** Step to this moment (ms) and hold; null runs it. */
  at: number | null;
  /** It could not start, or threw: show Nightstand instead. */
  onFail(error: unknown): void;
  /** The first picture is on the canvas. */
  onPainted?(): void;
}

const ids = new WeakMap<object, number>();
let lastId = 0;

/** A number for an object, the same for as long as it lives. */
function idOf(value: object): number {
  let id = ids.get(value);
  if (id === undefined) {
    lastId += 1;
    id = lastId;
    ids.set(value, id);
  }
  return id;
}

/**
 * A fresh <canvas> for every screensaver started: a canvas keeps its first
 * context, attributes and drawing state included (Bouncing Portafilter's and
 * Beanfield's are opaque, Brew Rain's must not be), so nothing ever starts on
 * a canvas another start used. Any change of what it draws, or how, is a new
 * canvas and a new start.
 */
export function SaverCanvas(props: SaverCanvasProps) {
  const { saver, env, still, at } = props;
  return <OneCanvas key={`${idOf(saver)} ${idOf(env)} ${still ? 'still' : (at ?? 'running')}`} {...props} />;
}

function OneCanvas({ saver, env, still, at, onFail, onPainted }: SaverCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The callbacks of the latest render, so a new function each render does not start the screensaver over.
  const callbacks = useRef({ onFail, onPainted });
  useEffect(() => {
    callbacks.current = { onFail, onPainted };
  });

  // Once per canvas: the key above makes any change of these a new canvas.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let created: SaverInstance | null;
    try {
      created = saver.create(canvas, env);
    } catch (error) {
      callbacks.current.onFail(error);
      return;
    }
    if (!created) {
      callbacks.current.onFail(new Error(`${saver.label} could not get its ${saver.context} context.`));
      return;
    }
    const instance = created;
    let run: SaverRun | null = null;
    let stillTimer: ReturnType<typeof setInterval> | null = null;
    let failed = false;
    let painted = false;

    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      run?.stop();
      if (stillTimer !== null) clearInterval(stillTimer);
      callbacks.current.onFail(error);
    };
    const paintedOnce = () => {
      if (painted) return;
      painted = true;
      callbacks.current.onPainted?.();
    };
    /** Paints what this mode shows now: the still, the held moment, or (running) nothing, the next frame will. */
    const repaint = () => {
      if (still) instance.still();
      else if (at !== null) instance.draw();
    };
    let size = '';
    /** Sizes the canvas and the screensaver to the canvas's box; true when that changed anything. */
    const fit = (): boolean => {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      const scale = backingScale(window.devicePixelRatio);
      const next = `${width}x${height}@${scale}`;
      if (next === size) return false;
      size = next;
      sizeSaver(canvas, instance, width, height, scale);
      return true;
    };

    try {
      fit();
      if (still) {
        instance.still();
        paintedOnce();
        stillTimer = setInterval(() => {
          try {
            instance.still();
          } catch (error) {
            fail(error);
          }
        }, STILL_EVERY_MS);
      } else if (at !== null) {
        playTo(instance, at);
        paintedOnce();
      } else {
        // The loop's first frame only draws: that is the first picture.
        const watched: SaverInstance = {
          step: (dtMs) => instance.step(dtMs),
          draw: () => {
            instance.draw();
            paintedOnce();
          },
          resize: (width, height, scale) => instance.resize(width, height, scale),
          still: () => instance.still(),
          dispose: () => instance.dispose(),
        };
        run = runSaver(watched, { onError: fail });
        if (document.visibilityState === 'hidden') run.pause();
      }
    } catch (error) {
      fail(error);
    }

    // A new size only: the observer's first call, at the size just set, changes nothing (a still or a held frame stays as painted).
    const resized = new ResizeObserver(() => {
      if (failed) return;
      try {
        if (fit()) repaint();
      } catch (error) {
        fail(error);
      }
    });
    resized.observe(canvas);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') run?.pause();
      else run?.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      resized.disconnect();
      run?.stop();
      if (stillTimer !== null) clearInterval(stillTimer);
      try {
        instance.dispose();
      } catch {
        // Gone either way.
      }
    };
  }, [saver, env, still, at]);

  return (
    <Box
      component="canvas"
      ref={ref}
      data-testid={TID.saverCanvas}
      data-saver={saver.id}
      data-motion={still ? 'still' : at !== null ? 'held' : 'running'}
      aria-hidden
      sx={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}

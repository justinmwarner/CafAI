/**
 * The frame loop a screensaver runs on (D-SAVER-4), shared by the overlay
 * and the dev preview: at most 30 frames a second, each a step by the time
 * since the last frame, then a draw. A gap longer than MAX_STEP_MS (a slow
 * frame, the page hidden and back) is stepped as MAX_STEP_MS, so nothing
 * leaps; after a resume the first frame only draws. A screensaver that throws
 * is stopped and reported, for the host to show Nightstand instead.
 */
import type { SaverInstance } from './types.ts';

export const SAVER_FPS = 30;

/** The longest step a frame may take: a tenth of a second. */
export const MAX_STEP_MS = 100;

/** The canvas's backing scale: the device's pixel ratio, at most 1.5 (finer costs a weak tablet more than it shows). */
export function backingScale(devicePixelRatio: number): number {
  return Math.min(Math.max(Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1, 1), 1.5);
}

/** Sizes the canvas's backing store for a CSS size and a scale, and tells the screensaver. */
export function sizeSaver(canvas: HTMLCanvasElement, instance: SaverInstance, width: number, height: number, scale: number): void {
  const backingWidth = Math.max(1, Math.round(width * scale));
  const backingHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  instance.resize(width, height, scale);
}

/** Steps a screensaver through `ms`, a 30 fps frame at a time, drawing nothing: for stills, tests and screenshots. */
export function stepFor(instance: SaverInstance, ms: number, stepMs = 1000 / SAVER_FPS): void {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    instance.step(dt);
    left -= dt;
  }
}

export interface FrameClock {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** requestAnimationFrame, or a 16 ms timer where there is none. */
export function browserClock(win: Window = window): FrameClock {
  const hasFrames = typeof win.requestAnimationFrame === 'function';
  return {
    now: () => win.performance.now(),
    request: (callback) => (hasFrames ? win.requestAnimationFrame(callback) : win.setTimeout(callback, 16)),
    cancel: (handle) => (hasFrames ? win.cancelAnimationFrame(handle) : win.clearTimeout(handle)),
  };
}

export interface SaverRun {
  /** Stops the frames (the page is hidden). */
  pause(): void;
  /** Starts them again; the first frame only draws. */
  resume(): void;
  /** For good: the screensaver is not disposed here, its owner does that. */
  stop(): void;
}

export interface RunOptions {
  fps?: number;
  clock?: FrameClock;
  /** A step or a draw threw; the run has stopped. */
  onError?: (error: unknown) => void;
}

export function runSaver(instance: SaverInstance, options: RunOptions = {}): SaverRun {
  const interval = 1000 / (options.fps ?? SAVER_FPS);
  const clock = options.clock ?? browserClock();
  let last: number | null = null;
  let handle: number | null = null;
  let paused = false;
  let stopped = false;

  const halt = () => {
    if (handle !== null) clock.cancel(handle);
    handle = null;
  };

  const frame = () => {
    handle = null;
    if (stopped || paused) return;
    const now = clock.now();
    try {
      if (last === null) {
        last = now;
        instance.draw();
      } else if (now - last >= interval - 2) {
        // The 2 ms of slack: at 60 Hz a frame lands every 16.7 ms, give or
        // take, so a 33.3 ms interval is two of them, not three.
        const elapsed = now - last;
        last = now;
        instance.step(Math.min(elapsed, MAX_STEP_MS));
        instance.draw();
      }
    } catch (error) {
      stopped = true;
      options.onError?.(error);
      return;
    }
    handle = clock.request(frame);
  };

  handle = clock.request(frame);

  return {
    pause() {
      if (stopped || paused) return;
      paused = true;
      halt();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      last = null;
      handle = clock.request(frame);
    },
    stop() {
      stopped = true;
      halt();
    },
  };
}

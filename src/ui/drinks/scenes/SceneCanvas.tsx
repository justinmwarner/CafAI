/**
 * The scene inside a drink's dial (the design's sections 4 and 8, D-SCENE-1
 * to D-SCENE-3): a canvas under the dial's ring, the whole dial's size, its
 * backing store at up to twice the device's pixel ratio. It makes one scene
 * (registry.ts) per run, and another when the barista picks another, and
 * feeds it one SceneInput a frame, read from the run as it stands; the scene
 * draws itself clipped to the inside of the ring, cutting out behind the
 * figures what must not cross them.
 *
 * Frames never re-render React (D148/D149): React hears of a run starting or
 * ending, the scene or the size changing, and starts the loop over with what
 * it heard; each frame reads the run itself. The loop runs while the run is
 * live, then while the scene settles (at most 3 s), and stops; it pauses
 * while the page is hidden. Under reduced motion there is no loop: the scene
 * is drawn still on every new reading. Without a 2D context (jsdom) nothing is
 * drawn and no loop runs.
 */
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { useTheme } from '@mui/material/styles';
import { useServices } from '../../../app/services.tsx';
import { drinkTraceFor, type DrinkRun } from '../drinkTrace.ts';
import type { DrinkKind } from '../kinds.ts';
import { BOX, C, clamp, drawFiguresMask, INSIDE, TAU } from './canvas.ts';
import { sceneColors, themeColorSource, type SceneColors } from './colors.ts';
import { createScene } from './registry.ts';
import { sceneInput } from './sceneInput.ts';
import type { Scene, SceneFrame, SceneInput, SceneSets } from './types.ts';

/** The longest a scene goes on moving once its run is over. */
const SETTLE_MS = 3000;
/** The longest step one frame moves a scene on, s: a slow frame does not make it leap. */
const MAX_STEP_S = 0.05;
/** Steps that bring a scene to rest at once: as far as it could have settled. */
const REST_STEPS = Math.round(SETTLE_MS / 1000 / MAX_STEP_S);
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const CANVAS_STYLE: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };

function motionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
}

function onMotionPreference(onChange: () => void): () => void {
  const list = motionQuery();
  if (!list) return () => undefined;
  // Older WebViews have only the deprecated addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

const prefersReducedMotion = () => motionQuery()?.matches ?? false;

function onVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const pageHidden = () => document.visibilityState === 'hidden';

/** A canvas's 2D context, or null in an engine without one (jsdom, which says so on the console when asked). */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d');
}

/** An offscreen canvas `px` square, with its context. */
function sheet(px: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = context2d(canvas);
  return ctx ? { canvas, ctx } : null;
}

interface Look {
  readonly colors: SceneColors;
  readonly mode: 'dark' | 'light';
  readonly still: boolean;
  readonly done: boolean;
}

interface Painter {
  /** Clears the canvas and draws the scene on it, clipped to the inside of the ring. */
  draw(scene: Scene, input: SceneInput, look: Look): void;
  /** Clears the canvas and its context's whole state, which a scene that threw may have left saved. */
  reset(): void;
}

/**
 * What draws scenes onto `canvas` at `px` pixels square: its context in the
 * 272 box, one offscreen layer, and the figures' cut-outs drawn once, one
 * for a live run and one with the check's circle too.
 */
function createPainter(canvas: HTMLCanvasElement, px: number): Painter | null {
  const ctx = context2d(canvas);
  const layer = sheet(px);
  const liveMask = sheet(px);
  const doneMask = sheet(px);
  if (!ctx || !layer || !liveMask || !doneMask) return null;
  drawFiguresMask(liveMask.ctx, px, false);
  drawFiguresMask(doneMask.ctx, px, true);
  const k = px / BOX;
  let done = false;
  const methods: Pick<SceneFrame, 'layer' | 'cutFigures' | 'blit'> = {
    layer() {
      const l = layer.ctx;
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.clearRect(0, 0, px, px);
      // Cleared of whatever the last scene or frame left set, as a fresh layer would be.
      l.globalAlpha = 1;
      l.globalCompositeOperation = 'source-over';
      l.setLineDash([]);
      l.lineDashOffset = 0;
      l.setTransform(k, 0, 0, k, 0, 0);
      return l;
    },
    cutFigures(amount) {
      const l = layer.ctx;
      l.save();
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'destination-out';
      l.globalAlpha = amount;
      l.drawImage(done ? doneMask.canvas : liveMask.canvas, 0, 0);
      l.restore();
    },
    blit() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    },
  };
  return {
    draw(scene, input, look) {
      done = look.done;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, px, px);
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.beginPath();
      ctx.arc(C, C, INSIDE, 0, TAU);
      ctx.clip();
      try {
        scene.draw({ ctx, ...look, ...methods }, input);
      } finally {
        ctx.restore();
      }
    },
    reset() {
      // Chromium 91 has no ctx.reset(): setting the canvas's size does the same.
      canvas.width = px;
    },
  };
}

/** The scene drawn for one run and one choice of scene, and what it has seen of the run. */
interface Made {
  readonly key: string;
  readonly scene: Scene;
  /** It saw the run live, so it settles after it. */
  sawLive: boolean;
  /** performance.now() when it first saw the run over (or none yet), for the settling's limit. */
  endedAt: number | null;
  /** It has been moved on at all: a scene only ever drawn still has not. */
  moved: boolean;
  /** It threw: it draws no more. */
  broken: boolean;
}

export interface SceneCanvasProps {
  kind: DrinkKind;
  /** The scene's id (catalog.ts); one the drink does not have draws its default. */
  scene: string;
  run: DrinkRun | null;
  /** What the dial counts toward, or null. */
  target: number | null;
  sets: SceneSets;
  /** The dial's size in px. */
  size: number;
}

export function SceneCanvas({ kind, scene, run, target, sets, size }: SceneCanvasProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const theme = useTheme();
  const colors = sceneColors(themeColorSource(theme));
  const mode = theme.palette.mode;
  const still = useSyncExternalStore(onMotionPreference, prefersReducedMotion, () => false);
  const hidden = useSyncExternalStore(onVisibility, pageHidden, () => false);
  const px = Math.round(size * Math.min(2, devicePixelRatio || 1));
  const canvas = useRef<HTMLCanvasElement>(null);
  const painter = useRef<{ px: number; painter: Painter | null } | null>(null);
  const made = useRef<Made | null>(null);
  const runId = run?.id ?? null;
  const live = run?.live ?? false;

  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return undefined;
    // One painter per size: its layer and the figures' cut-outs are drawn at the canvas's size.
    if (painter.current?.px !== px) painter.current = { px, painter: createPainter(node, px) };
    const paint = painter.current.painter;
    if (!paint) return undefined;
    const key = `${kind} ${scene} ${runId ?? 'none'}`;
    if (made.current?.key !== key) made.current = { key, scene: createScene(kind, scene), sawLive: false, endedAt: null, moved: false, broken: false };
    const current = made.current;
    const read = () => sceneInput(kind, run, target, sets);
    const note = (input: SceneInput, at: number) => {
      if (input.live) current.sawLive = true;
      else if (current.endedAt === null) current.endedAt = at;
    };
    // Moves the scene on `steps` times by `dt`, then draws it. A scene that throws (a call the browser
    // refuses) draws no more, rather than take the view down with it.
    const show = (input: SceneInput, dt: number, steps: number) => {
      if (current.broken) return;
      try {
        for (let i = 0; i < steps; i += 1) current.scene.update(dt, input);
        if (steps > 0) current.moved = true;
        paint.draw(current.scene, input, { colors, mode, still, done: input.phase === 'done' });
      } catch (error) {
        current.broken = true;
        paint.reset();
        console.error("CafAI stopped drawing the drink's scene:", error instanceof Error ? error.message : String(error));
      }
    };

    const input = read();
    const at = performance.now();
    note(input, at);
    // Nothing live and the scene never moved on (a run over before it was made, or none yet), or past its
    // settling and still mid-motion (the run ended while the page was hidden): it comes to rest at once.
    const overdue = current.moved && current.endedAt !== null && at - current.endedAt >= SETTLE_MS && current.scene.settling();
    show(input, MAX_STEP_S, !input.live && !still && (!current.moved || overdue) ? REST_STEPS : 0);
    if (still) {
      if (run === null || !input.live || hidden) return undefined;
      return trace.onData((changed) => {
        if (changed === run) show(read(), 0, 0);
      });
    }
    const moving = (at: number, now: SceneInput) =>
      !current.broken &&
      (now.live || (current.sawLive && current.endedAt !== null && at - current.endedAt < SETTLE_MS && current.scene.settling()));
    if (hidden || !moving(performance.now(), input)) return undefined;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(at) {
      // A frame can be stamped before the clock read as the loop began: never a step backwards.
      const dt = clamp((at - last) / 1000, 0, MAX_STEP_S);
      last = at;
      const now = read();
      note(now, at);
      show(now, dt, 1);
      if (moving(at, now)) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // `live` too: a run that ends is the same object, and the loop goes on to settle it.
  }, [trace, kind, scene, run, runId, live, target, sets, colors, mode, still, hidden, px]);

  return <canvas ref={canvas} width={px} height={px} aria-hidden style={CANVAS_STYLE} />;
}

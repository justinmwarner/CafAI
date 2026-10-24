/**
 * What a screensaver is to the host that shows it (D227): a module that
 * draws on a canvas the host owns, stepped by the host's clock, so the same
 * seed and the same steps always give the same picture. The host
 * (SaverOverlay, and the dev preview in src/ui/preview/saverPreview.ts) sizes
 * the canvas, runs the frames at 30 a second at most, pauses them while the
 * page is hidden, and shows Nightstand instead should a screensaver throw or
 * be unable to start.
 *
 * Nightstand is the one screensaver that is not a canvas: it is text, drawn
 * by React (SaverOverlay), so it has an id and a label but no module here.
 */
import type { Palette } from '../palette.ts';

/** Every screensaver, in Settings' order (docs/superpowers/specs/2026-10-22-screensavers-design.md). */
export type SaverId = 'nightstand' | 'portafilter' | 'pipes' | 'beanfield' | 'steam' | 'lava' | 'rain' | 'latte';

/** The canvas ones: every screensaver but Nightstand. */
export type CanvasSaverId = Exclude<SaverId, 'nightstand'>;

/** What the host gives a screensaver to draw with. */
export interface SaverEnv {
  /** The dark palette of the barista's tint, whatever their light or dark mode (D226). */
  palette: Palette;
  /** The same seed gives the same screensaver: the day's number on the tablet, a fixed one in tests. */
  seed: number;
  /**
   * A few short numbers from the last shot, as CafAI writes them ("9.0",
   * "36.4", "28"), for a screensaver that likes to show some (Brew Rain).
   * Often empty: no shot yet.
   */
  numbers: readonly string[];
}

/** One running screensaver on one canvas. */
export interface SaverInstance {
  /**
   * Moves the picture on by `dtMs` milliseconds. Every change of state
   * happens here and nowhere else, from `dtMs` and the seeded random alone
   * (never Date.now or Math.random), so a test can step to any moment.
   */
  step(dtMs: number): void;
  /** Paints the current state. Draws nothing new between two steps. */
  draw(): void;
  /**
   * The canvas's size in CSS pixels, and the backing scale the host set it
   * up at (canvas.width is width × scale). Called once before the first
   * draw and again whenever the size changes.
   */
  resize(width: number, height: number, scale: number): void;
  /**
   * Paints one picture that stands for this screensaver, for reduced motion
   * (D226). It may step a fresh state of its own to get there. The host
   * calls it in place of step and draw, and again each minute.
   */
  still(): void;
  /** Lets go of anything held (offscreen canvases, buffers, GL objects). */
  dispose(): void;
}

/** A canvas screensaver: its id, its name in Settings, and how to start one. */
export interface CanvasSaver {
  id: CanvasSaverId;
  /** As Settings lists it ("Bouncing Portafilter"). */
  label: string;
  /** The context it draws with: the host can tell beforehand whether it can run here. */
  context: '2d' | 'webgl';
  /** A running screensaver, or null when the canvas cannot give it its context. */
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null;
}

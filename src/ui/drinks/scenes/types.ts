/**
 * A drink's scene (docs/superpowers/specs/2026-10-22-drink-scenes-design.md,
 * D217-D220): what the dial draws inside its ring while the
 * machine steams, pours hot water or flushes, the barista's choice per drink
 * in Settings > Drink screens.
 *
 * A scene is a small object that moves on with time (update) and draws
 * itself (draw), handed one SceneInput a frame by SceneCanvas.tsx. It never
 * touches React or the DOM, so it is tested against a stub context.
 */
import type { DrinkKind } from '../kinds.ts';
import type { SceneColors } from './colors.ts';

/** What the machine does, as a scene shows it. */
export type ScenePhase =
  /** No run to show yet. */
  | 'idle'
  /** The heater still warms (`preparingForShot`): nothing flows. */
  | 'heating'
  /** The drink does its work. */
  | 'working'
  /** Steam paused (`pausedSteam`). */
  | 'paused'
  /** The wand purges after steaming (`puffing`). */
  | 'purging'
  /** The wand's rinse (`steamRinse`). */
  | 'rinsing'
  /** The run is over, by the machine's word. */
  | 'done'
  /** The machine went away mid-run. */
  | 'lost';

/** The numbers a scene follows (the design's section 3), read afresh every frame by sceneInput.ts. */
export interface SceneInput {
  readonly kind: DrinkKind;
  readonly phase: ScenePhase;
  /** The machine runs this drink now: heating, working, paused, purging or rinsing. */
  readonly live: boolean;
  /** How far toward what stops the drink, 0-1. */
  readonly progress: number;
  /** How hard it works: 0 while it does no work, about 1 as set, at most 2.2. */
  readonly strength: number;
  /** How much steam or vapour it gives off, 0-1.15. */
  readonly heat: number;
  /** Its colour, cold (0) to warm (1); the ring's arc takes it too. */
  readonly warmth: number;
}

/** What the drink was set to, for the numbers its scene follows; null where nobody gave one. */
export interface SceneSets {
  /** ml/s: the steam's, the hot water's or the flush's flow set. */
  readonly flow: number | null;
  /** °C: the steam heater's set (null while steam is off), the hot water's, or the group's target. */
  readonly temperature: number | null;
}

/** What a scene draws with: the dial's canvas in its 272 box, already clipped to the inside of the ring. */
export interface SceneFrame {
  readonly ctx: CanvasRenderingContext2D;
  readonly colors: SceneColors;
  readonly mode: 'dark' | 'light';
  /** Reduced motion: draw the scene still, as the reading stands; update is never called. */
  readonly still: boolean;
  /** The run is over: the check shows above the figures, and its circle is cut out too. */
  readonly done: boolean;
  /** A cleared offscreen layer in the same box, for whatever must be cut out behind the figures. */
  layer(): CanvasRenderingContext2D;
  /** Cuts the figures out of the layer: 1 takes all of it there, 0.9 leaves a tenth (steam and vapour may show that much). */
  cutFigures(amount: number): void;
  /** Draws the layer onto the canvas. */
  blit(): void;
}

export interface Scene {
  /** Moves the scene on `dt` seconds (0-0.05) toward what the input says. */
  update(dt: number, input: SceneInput): void;
  /** Draws the scene as it stands. */
  draw(frame: SceneFrame, input: SceneInput): void;
  /** Still moving with the run over (a whirlpool coasting, a pull-through drawing, drops falling): the loop runs while true. */
  settling(): boolean;
}

/** Makes a scene; `random` is Math.random but for tests, which pass a seeded one. */
export type SceneFactory = (random?: () => number) => Scene;

/**
 * What every scene draws with (the design's section 4): the dial's drawing
 * box, the figures' cut-out, and small helpers for motion. The canvas API
 * used here and in the scenes is Chromium 91's: no roundRect, and no filter
 * redrawn every frame.
 */
import { css, type Oklab } from './colors.ts';
import type { Scene } from './types.ts';

/** The dial's drawing box (DrinkDial.tsx), its centre and the inside of its ring. */
export const BOX = 272;
export const C = BOX / 2;
export const INSIDE = 99;
export const TAU = Math.PI * 2;

/** An ellipse fully cut out inside (rx by ry about x, y), fading out to `fade` times its size. */
export interface CutOut {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly fade: number;
}

/** The number and its "of" line. */
export const FIGURES: CutOut = { x: 136, y: 138, rx: 84, ry: 50, fade: 1.4 };
/** The done check, above the figures. */
export const CHECK: CutOut = { x: 136, y: 75, rx: 20, ry: 20, fade: 1.7 };

/**
 * Draws the figures' cut-out (and the check's, once done) into `ctx`, a
 * canvas `px` pixels square: opaque where a scene must not draw. Drawn once
 * per size and kind of frame, then laid over a layer with destination-out.
 */
export function drawFiguresMask(ctx: CanvasRenderingContext2D, px: number, done: boolean): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  const k = px / BOX;
  for (const cut of done ? [FIGURES, CHECK] : [FIGURES]) {
    ctx.setTransform(k, 0, 0, (k * cut.ry) / cut.rx, k * cut.x, k * cut.y);
    const fade = ctx.createRadialGradient(0, 0, cut.rx, 0, 0, cut.rx * cut.fade);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.beginPath();
    ctx.arc(0, 0, cut.rx * cut.fade, 0, TAU);
    ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** `current` eased toward `target` over `dt` seconds, with time constant `tau`. */
export function smooth(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** Quick at first, settling at 1. */
export function ease(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A puff of steam or vapour: a soft disc that grows as it drifts up, fading in and out over its life. */
export interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Growth of its radius, units a second. */
  grow: number;
  age: number;
  max: number;
  /** Its strength at its fullest, before the colours' steam strength. */
  alpha: number;
  /** A phase for its sideways drift. */
  seed: number;
}

/** Moves puffs on and drops the spent ones; `t` is the scene's clock, for the drift. */
export function movePuffs(puffs: Puff[], dt: number, t: number): Puff[] {
  for (const p of puffs) {
    p.age += dt;
    p.x += (p.vx + 6 * Math.sin(t * 0.8 + p.seed)) * dt;
    p.y += p.vy * dt;
    p.vy *= Math.exp(-0.1 * dt);
    p.r += p.grow * dt;
  }
  return puffs.filter((p) => p.age < p.max);
}

/** A puff drawn soft-edged: steam has no edge (DESIGN.md's one gradient inside the dial). */
export function drawPuff(ctx: CanvasRenderingContext2D, puff: Puff, color: Oklab, strength: number): void {
  const envelope = Math.min(1, puff.age / 0.45) * Math.min(1, (puff.max - puff.age) / 1.3);
  const a = puff.alpha * envelope * strength;
  if (a <= 0.003 || puff.r <= 0) return;
  const soft = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.r);
  soft.addColorStop(0, css(color, a));
  soft.addColorStop(0.55, css(color, a * 0.55));
  soft.addColorStop(1, css(color, 0));
  ctx.fillStyle = soft;
  ctx.beginPath();
  ctx.arc(puff.x, puff.y, puff.r, 0, TAU);
  ctx.fill();
}

/** A scene that draws nothing: what a scene file holds until it is built. */
export function blankScene(): Scene {
  return { update: () => undefined, draw: () => undefined, settling: () => false };
}

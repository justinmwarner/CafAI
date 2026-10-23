/**
 * Steam's Simple scene (the design's section 4, D-SCENE-1): the dial's scene
 * before the drink scenes (D149), as it was, drawn on the canvas. The milk's
 * wash fills the bottom of the ring's inside, rising from 17% of it to 32%
 * with the steam time, its wave sliding one length in 2.2 s while the machine
 * runs; its surface is a line in the muted ink; three wisps rise from it, one
 * every 1.2 s, each for 3.6 s. The ring takes the warmth (DrinkDial.tsx).
 *
 * The surface line and the wisps are cut out behind the figures; the wash
 * sits under them, as it did. Still, it draws the milk and its surface, and
 * no wisps.
 */
import { BOX, C, INSIDE } from '../canvas.ts';
import { css } from '../colors.ts';
import type { SceneFactory, SceneFrame, SceneInput } from '../types.ts';

/** The inside of the ring: its floor and its depth. */
const FLOOR = C + INSIDE;
const DEPTH = INSIDE * 2;
const MILK_FROM = 0.17;
const MILK_RISE = 0.15;
/** The wave: 80 units a length and 5 high, wide enough to slide one length and still cover the inside. */
const WAVE = 80;
const WAVE_S = 2.2;
const WAVE_FROM = 20;
const WAVE_TO = 340;
const WAVE_HEIGHT = 5;
/** The wisps' places along the surface, and their timing. */
const WISPS = [110, 136, 162];
const WISP_S = 3.6;
const WISP_GAP_S = 1.2;
/** How far a wisp rises over its 3.6 s, from just under the surface. */
const WISP_FROM = 6;
const WISP_RISE = 128;
/** A wisp's opacity through its rise, as [time, opacity]. */
const WISP_OPACITY: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.14, 0.9],
  [0.72, 0.65],
  [1, 0],
];

/** CSS's cubic-bezier(x1, y1, x2, y2): the wisps rose with one, quick then slowing. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const along = (p1: number, p2: number, u: number) => 3 * p1 * u * (1 - u) ** 2 + 3 * p2 * u * u * (1 - u) + u ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (along(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return along(y1, y2, (lo + hi) / 2);
  };
}

const RISE = cubicBezier(0.3, 0.6, 0.5, 1);

/** A wisp's opacity `u` of the way through its rise, eased between the steps as CSS eases each keyframe. */
function wispOpacity(u: number): number {
  for (let i = 1; i < WISP_OPACITY.length; i += 1) {
    const [from, start] = WISP_OPACITY[i - 1]!;
    const [to, end] = WISP_OPACITY[i]!;
    if (u <= to) return start + (end - start) * RISE((u - from) / (to - from));
  }
  return 0;
}

/** The milk's wave along its surface at `top`, slid `offset` to the left. */
function wave(ctx: CanvasRenderingContext2D, top: number, offset: number): void {
  ctx.moveTo(WAVE_FROM + offset, top);
  for (let x = WAVE_FROM + offset; x < WAVE_TO + offset; x += WAVE) {
    ctx.bezierCurveTo(x + 13, top - WAVE_HEIGHT, x + 27, top - WAVE_HEIGHT, x + 40, top);
    ctx.bezierCurveTo(x + 53, top + WAVE_HEIGHT, x + 67, top + WAVE_HEIGHT, x + 80, top);
  }
}

export const createSimpleSteam: SceneFactory = () => {
  /** Seconds the machine has run this drink: the wave's and the wisps' clock. */
  let running = 0;

  function update(dt: number, input: SceneInput): void {
    if (input.live) running += dt;
  }

  function draw(frame: SceneFrame, input: SceneInput): void {
    const { ctx, colors } = frame;
    const top = FLOOR - (MILK_FROM + MILK_RISE * input.progress) * DEPTH;
    const offset = frame.still ? 0 : -((running % WAVE_S) / WAVE_S) * WAVE;
    ctx.fillStyle = css(colors.milkWash);
    ctx.beginPath();
    wave(ctx, top, offset);
    ctx.lineTo(WAVE_TO + offset, BOX);
    ctx.lineTo(WAVE_FROM + offset, BOX);
    ctx.closePath();
    ctx.fill();

    const lines = frame.layer();
    lines.lineCap = 'round';
    lines.strokeStyle = css(colors.inkMuted, 0.55);
    lines.lineWidth = 2;
    lines.beginPath();
    wave(lines, top, offset);
    lines.stroke();
    // Wisps only while the machine runs: they stop, and go, with it.
    if (input.live && !frame.still) {
      lines.lineWidth = 3;
      WISPS.forEach((x, i) => {
        const since = running - i * WISP_GAP_S;
        if (since < 0) return;
        const u = (since % WISP_S) / WISP_S;
        const alpha = wispOpacity(u);
        if (alpha <= 0) return;
        const y = top - 4 - (i === 1 ? 4 : 0) + WISP_FROM - WISP_RISE * RISE(u);
        lines.strokeStyle = css(colors.inkMuted, alpha);
        lines.beginPath();
        lines.moveTo(x, y);
        lines.bezierCurveTo(x - 7, y - 9, x + 6, y - 16, x, y - 25);
        lines.bezierCurveTo(x - 6, y - 34, x + 7, y - 41, x + 1, y - 50);
        lines.stroke();
      });
    }
    frame.cutFigures(1);
    frame.blit();
  }

  // Nothing moves once the run is over: the wave stops where it is and the wisps go.
  return { update, draw, settling: () => false };
};

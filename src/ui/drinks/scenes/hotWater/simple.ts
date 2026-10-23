/**
 * Hot water: Simple, the stream and water of D149 (docs/superpowers/specs/
 * 2026-10-22-drink-scenes-design.md, section 4; D217), drawn on the
 * canvas as the dial drew them in SVG before the scenes: the water's wash
 * filling the inside of the ring to the progress, a wave in the flow's blue
 * along its surface, sliding while the machine runs, and a dashed stream in
 * the same blue falling into it from the top until the run ends. The surface
 * and the stream are cut out behind the figures. The level glides to each
 * new reading, as the SVG's did; reduced motion draws it all still at the
 * reading.
 */
import { C, INSIDE, smooth } from '../canvas.ts';
import { css } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

/** The floor of the ring's inside and its depth: the water fills it to the progress. */
const FLOOR = C + INSIDE;
const DEPTH = 2 * INSIDE;
/** Below the floor, where the water's body ends; the frame's clip rounds it. */
const BOTTOM = FLOOR + 10;
/** The wave: up then down every 80 units, its curves' handles 4 units off the surface; it slides one length in 4.2 s. */
const WAVE = 80;
const SWELL = 4;
const SLIDE_S = 4.2;
/** The stream: 4 wide, from above the ring's inside, its dashes (12 on, 9 off) falling 24 units in 0.62 s. */
const STREAM_TOP = 30;
const STREAM_DASH = [12, 9];
const STREAM_REPEAT = 12 + 9;
const STREAM_SPEED = 24 / 0.62;
/** How quickly the level catches up with a new reading, about as the SVG's 250 ms glide did. */
const LEVEL_TAU = 0.12;

/** The wave along the surface at `y`, from `left`: four lengths, wider than the ring whichever way it has slid. */
function traceWave(ctx: CanvasRenderingContext2D, left: number, y: number): void {
  ctx.moveTo(left, y);
  for (let x = left; x < left + 4 * WAVE; x += WAVE) {
    ctx.bezierCurveTo(x + 13, y - SWELL, x + 27, y - SWELL, x + 40, y);
    ctx.bezierCurveTo(x + 53, y + SWELL, x + 67, y + SWELL, x + 80, y);
  }
}

export const createSimpleHotWater: SceneFactory = () => {
  /** The water's clock: it runs while the machine does. */
  let t = 0;
  /** The level shown, gliding toward the newest reading; null until the first. */
  let level: number | null = null;
  let reading = 0;

  return {
    update(dt, input) {
      if (input.live) t += dt;
      reading = input.progress;
      level = level === null ? reading : smooth(level, reading, dt, LEVEL_TAU);
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      const surface = FLOOR - DEPTH * (frame.still || level === null ? input.progress : level);
      const left = 20 - ((t / SLIDE_S) % 1) * WAVE;

      // The water, a fill under the figures that keeps their contrast (D149).
      ctx.beginPath();
      traceWave(ctx, left, surface);
      ctx.lineTo(left + 4 * WAVE, BOTTOM);
      ctx.lineTo(left, BOTTOM);
      ctx.closePath();
      ctx.fillStyle = css(colors.waterWash);
      ctx.fill();

      // The stream, falling into the water while the machine runs, and the surface's line, cut out behind the figures.
      const layer = frame.layer();
      layer.strokeStyle = css(colors.flow);
      if (input.live) {
        layer.save();
        layer.beginPath();
        traceWave(layer, left, surface);
        layer.lineTo(left + 4 * WAVE, 0);
        layer.lineTo(left, 0);
        layer.closePath();
        layer.clip();
        layer.lineWidth = 4;
        layer.lineCap = 'round';
        layer.setLineDash(STREAM_DASH);
        layer.lineDashOffset = -((t * STREAM_SPEED) % STREAM_REPEAT);
        layer.beginPath();
        layer.moveTo(C, STREAM_TOP);
        layer.lineTo(C, FLOOR);
        layer.stroke();
        layer.restore();
      }
      layer.lineWidth = 2;
      layer.setLineDash([]);
      layer.beginPath();
      traceWave(layer, left, surface);
      layer.stroke();
      frame.cutFigures(1);
      frame.blit();
    },

    // Only the level moves on after the run, catching up with the last reading.
    settling: () => level !== null && Math.abs(level - reading) > 0.001,
  };
};

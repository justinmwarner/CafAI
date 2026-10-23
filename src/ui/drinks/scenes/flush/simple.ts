/**
 * Flush: Simple, the screen and streaks of D149 (docs/superpowers/specs/
 * 2026-10-22-drink-scenes-design.md, section 4; D217), drawn on the
 * canvas as the dial drew them in SVG before the scenes: the shower screen, a
 * bar in the muted ink, and five dashed streaks in the flow's blue fanning out
 * from under it to the floor of the ring while the machine runs, gone once it
 * stops. The streaks are cut out behind the figures. Reduced motion draws
 * them still.
 */
import { C, INSIDE } from '../canvas.ts';
import { css } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

/** The streaks run from under the screen to the floor of the ring's inside. */
const TOP = 54;
const FLOOR = C + INSIDE;
/** Their dashes, 9 on and 15 off, fall one repeat in `fall` seconds, `lead` seconds ahead of a streak that starts with the run. */
const DASH = [9, 15];
const REPEAT = 9 + 15;
const STREAKS = [
  { x: 106, fall: 0.7, lead: 0 },
  { x: 121, fall: 0.82, lead: 0.3 },
  { x: 136, fall: 0.66, lead: 0.5 },
  { x: 151, fall: 0.7, lead: 0 },
  { x: 166, fall: 0.82, lead: 0.3 },
] as const;

export const createSimpleFlush: SceneFactory = () => {
  /** The water's clock: it runs while the machine does. */
  let t = 0;

  return {
    update(dt, input) {
      if (input.live) t += dt;
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      // The shower screen.
      ctx.strokeStyle = css(colors.inkMuted);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(104, 44);
      ctx.lineTo(168, 44);
      ctx.stroke();
      if (!input.live) return;

      // The streaks, fanning out as they fall, cut out behind the figures.
      const layer = frame.layer();
      layer.strokeStyle = css(colors.flow, 0.7);
      layer.lineWidth = 2;
      layer.lineCap = 'round';
      layer.setLineDash(DASH);
      for (const { x, fall, lead } of STREAKS) {
        layer.lineDashOffset = -REPEAT * (((t + lead) / fall) % 1);
        layer.beginPath();
        layer.moveTo(x, TOP);
        layer.lineTo(x + (x - C) / 16, FLOOR);
        layer.stroke();
      }
      layer.setLineDash([]);
      frame.cutFigures(1);
      frame.blit();
    },

    // The streaks go the moment the water stops; nothing else moves.
    settling: () => false,
  };
};

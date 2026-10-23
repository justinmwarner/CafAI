/**
 * Flush: Shower, the default (docs/superpowers/specs/2026-10-22-drink-scenes-design.md,
 * section 4; D217, D218). The group from the side: the group head
 * and its shower screen at the top, thirteen streams falling from it, fanning
 * out a little, to the drip tray's grate, and splashing there; the streams and
 * the splash are cut out behind the figures.
 *
 * The strength sets how fast the streams fall and how much they splash. The
 * warmth (the group against its target) colours the water: blue while the
 * group is cool, warm as it reaches the target, which is what a flush before
 * a shot is for; the ring takes the same colour. Reduced motion draws the
 * streams still while the water runs.
 */
import { C, smooth, TAU } from '../canvas.ts';
import { css, mixOklab } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

/** Under the shower screen, where the streams start, and the drip tray's grate, where they land. */
const SCREEN_Y = 56;
const TRAY = 214;
const STREAMS = 13;
/** The longest the scene moves on after the flush (the design's section 4). */
const SETTLE_S = 3;

/** A drop of the splash, thrown up from the grate. */
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  max: number;
}

/** Where stream `i` is at height `y`: across the screen at the top, a little wider at the grate. */
function streamX(i: number, y: number): number {
  const x0 = 92 + (i * 88) / (STREAMS - 1);
  return x0 + (x0 - C) * 0.28 * ((y - SCREEN_Y) / (TRAY - SCREEN_Y));
}

export const createShower: SceneFactory = (random = Math.random) => {
  /** The strength, smoothed. */
  let s = 0;
  /** How far the water has fallen, for the streams' dashes. */
  let fall = 0;
  /** Seconds since the flush ended. */
  let after = 0;
  let splash: Drop[] = [];
  /** How much of the next drop of splash is due: it appears as this reaches one. */
  let due = 0;
  /** How much of the streams shows: they thin in and out with the strength. */
  const streamsShown = () => Math.min(1, s * 1.5);

  return {
    update(dt, input) {
      after = input.live ? 0 : after + dt;
      s = smooth(s, input.phase === 'working' ? input.strength : 0, dt, 0.2);
      fall += dt * (90 + 150 * Math.min(1.3, s));
      if (s > 0.05) {
        due += dt * 70 * s;
        while (due >= 1) {
          due -= 1;
          const x = streamX(Math.floor(random() * STREAMS), TRAY);
          splash.push({ x: x + (random() - 0.5) * 3, y: TRAY - 1, vx: (random() - 0.5) * 60, vy: -(25 + 55 * random()), age: 0, max: 0.5 });
        }
      }
      for (const drop of splash) {
        drop.age += dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        drop.vy += 340 * dt;
      }
      splash = splash.filter((drop) => drop.age < drop.max && drop.y <= TRAY);
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      const water = mixOklab(colors.flushCold, colors.flushWarm, input.warmth);

      // The group head, and its shower screen under it: a bar with round ends (Chromium 91 has no roundRect), lit along its top.
      ctx.fillStyle = css(colors.steelDark);
      ctx.fillRect(70, 20, 132, 28);
      ctx.fillStyle = css(colors.steel);
      ctx.beginPath();
      ctx.arc(88.5, 50.5, 4.5, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.arc(183.5, 50.5, 4.5, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css(colors.steelLight, 0.7);
      ctx.fillRect(90, 47, 92, 1.4);
      // The drip tray's grate: its edge, and its bars below.
      ctx.strokeStyle = css(colors.steel);
      ctx.lineWidth = 3;
      ctx.lineCap = 'butt';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(40, TRAY + 2);
      ctx.lineTo(232, TRAY + 2);
      ctx.stroke();
      ctx.strokeStyle = css(colors.steelDark);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 50; x < 226; x += 9) {
        ctx.moveTo(x, TRAY + 6);
        ctx.lineTo(x, TRAY + 13);
      }
      ctx.stroke();

      // The streams, each its own dashes at its own speed, and the splash, cut out behind the figures.
      const shown = frame.still ? (input.phase === 'working' ? 1 : 0) : streamsShown();
      const splashing = !frame.still && splash.length > 0;
      if (shown <= 0.02 && !splashing) return;
      const layer = frame.layer();
      if (shown > 0.02) {
        layer.strokeStyle = css(water, 0.85 * shown);
        layer.lineWidth = 1.7;
        layer.lineCap = 'round';
        for (let i = 0; i < STREAMS; i++) {
          layer.setLineDash([6 + (i % 3), 8 + ((i * 7) % 5)]);
          layer.lineDashOffset = -(fall * (1 + 0.08 * (i % 4))) - i * 5;
          layer.beginPath();
          layer.moveTo(streamX(i, SCREEN_Y), SCREEN_Y);
          layer.lineTo(streamX(i, TRAY), TRAY);
          layer.stroke();
        }
        layer.setLineDash([]);
      }
      if (splashing) {
        for (const drop of splash) {
          layer.fillStyle = css(water, 0.85 * (1 - drop.age / drop.max));
          layer.beginPath();
          layer.arc(drop.x, drop.y, 1.1, 0, TAU);
          layer.fill();
        }
      }
      frame.cutFigures(1);
      frame.blit();
    },

    settling() {
      return (streamsShown() > 0.02 || splash.length > 0) && after < SETTLE_S;
    },
  };
};

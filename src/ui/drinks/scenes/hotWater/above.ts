/**
 * Hot water: From above (docs/superpowers/specs/2026-10-22-drink-scenes-design.md,
 * section 4; D217, D218). Looking down into the cup: rings spread
 * from where the stream lands, off centre above and right of the figures, as
 * often as the strength says; the water deepens with the progress, in tones
 * the figures keep their contrast on (palette.test.ts); vapour drifts over it
 * with the heat (the temperature set), and on while the scene settles after
 * the pour. The rings and the vapour are cut out behind the figures. Reduced
 * motion draws the water still, and where the stream lands while it pours.
 */
import { C, drawPuff, ease, INSIDE, movePuffs, smooth, TAU, type Puff } from '../canvas.ts';
import { css, mixOklab } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

/** Where the stream lands. */
const LAND = { x: 186, y: 78 };
/** The longest the scene moves on after the pour (the design's section 4). */
const SETTLE_S = 3;

/** A ring spreading from where the stream lands. */
interface Ring {
  age: number;
  max: number;
  /** Its strength at its start. */
  alpha: number;
}

/** A square over the whole inside of the ring, which the frame's clip rounds. */
function fillInside(ctx: CanvasRenderingContext2D): void {
  ctx.fillRect(C - INSIDE - 6, C - INSIDE - 6, 2 * INSIDE + 12, 2 * INSIDE + 12);
}

export const createAbove: SceneFactory = (random = Math.random) => {
  /** The scene's clock, for the vapour's drift. */
  let t = 0;
  /** The strength, smoothed. */
  let s = 0;
  /** Seconds since the pour ended. */
  let after = 0;
  let rings: Ring[] = [];
  let puffs: Puff[] = [];
  /** How much of the next ring and puff is due: each appears as its count reaches one. */
  const due = { ring: 0, puff: 0 };
  /** How much of the stream's landing shows: it comes and goes with the strength. */
  const landingShown = () => Math.min(1, s * 1.6);

  return {
    update(dt, input) {
      t += dt;
      after = input.live ? 0 : after + dt;
      const working = input.phase === 'working';
      s = smooth(s, working ? input.strength : 0, dt, 0.25);
      if (working) {
        due.ring += dt * (1 + 2.4 * s);
        while (due.ring >= 1) {
          due.ring -= 1;
          rings.push({ age: 0, max: 2.8 + 0.6 * random(), alpha: 0.6 + 0.4 * random() });
        }
      }
      for (const ring of rings) ring.age += dt;
      rings = rings.filter((ring) => ring.age < ring.max);
      // Vapour, the more the hotter the water was set, and on after the pour.
      due.puff += dt * 2.2 * input.heat * (working ? 1 : input.live ? 0 : 0.5);
      while (due.puff >= 1) {
        due.puff -= 1;
        puffs.push({
          x: 50 + 172 * random(),
          y: 50 + 172 * random(),
          vx: 6 + 6 * random(),
          vy: -(3 + 4 * random()),
          r: 14 + 10 * random(),
          grow: 5 + 4 * random(),
          age: 0,
          max: 4 + 2 * random(),
          alpha: (0.05 + 0.05 * random()) * input.heat,
          seed: random() * 6,
        });
      }
      puffs = movePuffs(puffs, dt, t);
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      // The water, deeper as the cup fills, and darker toward the cup's wall.
      ctx.fillStyle = css(mixOklab(colors.shallow, colors.deep, input.progress));
      fillInside(ctx);
      const wall = ctx.createRadialGradient(C, C, 64, C, C, INSIDE);
      wall.addColorStop(0, css(colors.deep, 0));
      wall.addColorStop(1, css(colors.deep, 0.6));
      ctx.fillStyle = wall;
      fillInside(ctx);

      // The rings, each with a fainter one just inside it, and the vapour over them, cut out behind the figures.
      if (!frame.still && rings.length + puffs.length > 0) {
        const layer = frame.layer();
        layer.setLineDash([]);
        for (const ring of rings) {
          const u = ring.age / ring.max;
          const radius = 5 + 160 * ease(u);
          const alpha = ring.alpha * (1 - u) ** 1.4;
          layer.strokeStyle = css(colors.ripple, 0.6 * alpha);
          layer.lineWidth = 1.6;
          layer.beginPath();
          layer.arc(LAND.x, LAND.y, radius, 0, TAU);
          layer.stroke();
          layer.strokeStyle = css(colors.ripple, 0.25 * alpha);
          layer.lineWidth = 1;
          layer.beginPath();
          layer.arc(LAND.x, LAND.y, radius * 0.86, 0, TAU);
          layer.stroke();
        }
        for (const puff of puffs) drawPuff(layer, puff, colors.steam, colors.steamStrength);
        frame.cutFigures(1);
        frame.blit();
      }

      // Where the stream lands: its column seen end on, foaming while it pours.
      const shown = frame.still ? (input.phase === 'working' ? 1 : 0) : landingShown();
      if (shown > 0.02) {
        const foam = ctx.createRadialGradient(LAND.x, LAND.y, 0, LAND.x, LAND.y, 11);
        foam.addColorStop(0, css(colors.foam, 0.85 * shown));
        foam.addColorStop(1, css(colors.foam, 0));
        ctx.fillStyle = foam;
        ctx.beginPath();
        ctx.arc(LAND.x, LAND.y, 11, 0, TAU);
        ctx.fill();
        ctx.fillStyle = css(colors.ripple, shown);
        ctx.beginPath();
        ctx.arc(LAND.x, LAND.y, 2 + 1.8 * Math.min(1.3, frame.still ? input.strength : s), 0, TAU);
        ctx.fill();
      }
    },

    settling() {
      const moving = landingShown() > 0.02 || rings.length + puffs.length > 0;
      return moving && after < SETTLE_S;
    },
  };
};

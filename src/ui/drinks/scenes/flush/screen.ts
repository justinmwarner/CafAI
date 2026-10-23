/**
 * Flush: Screen (docs/superpowers/specs/2026-10-22-drink-scenes-design.md,
 * section 4; D217, D218). The shower screen from below: its holes
 * in seven rings, and drops swelling out of them and falling toward the
 * barista, as many as the strength says, coloured as in Shower by the warmth
 * (the group against its target). The steel under the figures keeps their
 * contrast (palette.test.ts); the holes and the drops are cut out there, so
 * the screen behind the figures is plain. Reduced motion draws a drop at
 * every sixth hole, still, while the water runs.
 */
import { C, INSIDE, smooth, TAU } from '../canvas.ts';
import { css, mixOklab, type Oklab } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

const HOLE_R = 1.25;
/** The longest the scene moves on after the flush (the design's section 4). */
const SETTLE_S = 3;

interface Hole {
  readonly x: number;
  readonly y: number;
}

/** A drop coming out of a hole. */
interface Drop extends Hole {
  age: number;
  readonly max: number;
}

/** The holes: seven rings 11.5 units apart, about 9.5 apart along each, each ring turned a little from the last. */
const HOLES: readonly Hole[] = (() => {
  const holes: Hole[] = [];
  for (let k = 1; k <= 7; k++) {
    const r = 11.5 * k;
    const n = Math.round((TAU * r) / 9.5);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * TAU + k * 0.3;
      holes.push({ x: C + Math.cos(a) * r, y: C + Math.sin(a) * r });
    }
  }
  return holes;
})();
/** Under reduced motion, a drop at every sixth hole, still, part way out. */
const STILL_HOLES = HOLES.filter((_, i) => i % 6 === 0);
const STILL_U = 0.4;

/** A square over the whole inside of the ring, which the frame's clip rounds. */
function fillInside(ctx: CanvasRenderingContext2D): void {
  ctx.fillRect(C - INSIDE - 6, C - INSIDE - 6, 2 * INSIDE + 12, 2 * INSIDE + 12);
}

/** The water's colours: a drop's body, the rim it is outlined with, and its highlight. */
interface DropColours {
  readonly body: Oklab;
  readonly rim: Oklab;
  readonly light: Oklab;
}

/**
 * A drop out of the hole at `x`, `y`, `u` of the way through its fall (0-1):
 * it swells as it comes toward the barista, drifting out from the centre as
 * it nears, and fades.
 */
function drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, colours: DropColours): void {
  const r = 0.8 + 4.4 * u;
  const a = 0.9 * (1 - u) ** 1.2;
  const dx = x + (x - C) * 0.06 * u;
  const dy = y + (y - C) * 0.06 * u;
  ctx.fillStyle = css(colours.body, a * 0.85);
  ctx.beginPath();
  ctx.arc(dx, dy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = css(colours.rim, a);
  ctx.stroke();
  ctx.fillStyle = css(colours.light, a);
  ctx.beginPath();
  ctx.arc(dx - r * 0.32, dy - r * 0.32, r * 0.28, 0, TAU);
  ctx.fill();
}

export const createScreen: SceneFactory = (random = Math.random) => {
  /** The strength, smoothed. */
  let s = 0;
  /** Seconds since the flush ended. */
  let after = 0;
  let drops: Drop[] = [];
  /** How much of the next drop is due: it appears as this reaches one. */
  let due = 0;

  return {
    update(dt, input) {
      after = input.live ? 0 : after + dt;
      s = smooth(s, input.phase === 'working' ? input.strength : 0, dt, 0.2);
      if (s > 0.03) {
        due += dt * 90 * s;
        while (due >= 1) {
          due -= 1;
          const hole = HOLES[Math.floor(random() * HOLES.length)]!;
          drops.push({ x: hole.x, y: hole.y, age: 0, max: 0.5 + 0.35 * random() });
        }
      }
      for (const drop of drops) drop.age += dt;
      drops = drops.filter((drop) => drop.age < drop.max);
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      const water = mixOklab(colors.flushCold, colors.flushWarm, input.warmth);
      const colours: DropColours = { body: mixOklab(water, colors.foam, 0.4), rim: water, light: colors.foam };

      // The screen's steel, a bevel toward its rim, and the shadow at the rim.
      ctx.fillStyle = css(colors.screen);
      fillInside(ctx);
      const bevel = ctx.createRadialGradient(C, C, 86, C, C, INSIDE);
      bevel.addColorStop(0, css(colors.screenBevel, 0));
      bevel.addColorStop(0.5, css(colors.screenBevel, 0.9));
      bevel.addColorStop(1, css(colors.screenHole, 0.8));
      ctx.fillStyle = bevel;
      fillInside(ctx);

      // The holes, in one path, then the drops coming out of them, all cut out behind the figures.
      const layer = frame.layer();
      layer.fillStyle = css(colors.screenHole, 0.9);
      layer.beginPath();
      for (const hole of HOLES) {
        layer.moveTo(hole.x + HOLE_R, hole.y);
        layer.arc(hole.x, hole.y, HOLE_R, 0, TAU);
      }
      layer.fill();
      layer.lineWidth = 1;
      layer.setLineDash([]);
      if (!frame.still) {
        for (const drop of drops) drawDrop(layer, drop.x, drop.y, drop.age / drop.max, colours);
      } else if (input.phase === 'working') {
        for (const hole of STILL_HOLES) drawDrop(layer, hole.x, hole.y, STILL_U, colours);
      }
      frame.cutFigures(1);
      frame.blit();
    },

    settling() {
      return (s > 0.03 || drops.length > 0) && after < SETTLE_S;
    },
  };
};

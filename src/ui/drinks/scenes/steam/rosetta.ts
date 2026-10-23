/**
 * Steam's Rosetta (the design's section 4, D217): latte art, the cup
 * from above, as the mockup's Art draws it. Crema, and a rosetta pouring in:
 * twelve leaves, one per twelfth of the steam time, the newest wiggling in as
 * the pitcher does; once the steam is done, the pull-through draws its stem.
 * The milk's white warms with progress. Flow and pressure do not show:
 * nothing in a cup follows them.
 *
 * The leaves sit under the figures, which keep their contrast on them: in
 * light mode by the palette (palette.test.ts), in dark mode by the crema halo
 * DrinkDial gives the figures. The crema's flecks and the stem, a line, are
 * cut out behind them.
 */
import { C, clamp, ease, INSIDE, smooth, TAU } from '../canvas.ts';
import { css, mixOklab, type Oklab } from '../colors.ts';
import type { SceneFactory, SceneFrame, SceneInput } from '../types.ts';

const LEAVES = 12;
const FLECKS = 70;
/** A square just round the inside of the ring. */
const SQUARE = { at: 30, size: 212 };
/** The stem: from just above the top leaf, this long once it is drawn through. */
const STEM_TOP = 58;
const STEM = 166;
/** The pull-through takes this long. */
const PULL_S = 0.8;

/** How far leaf `i` has poured at `progress`, 0-1. */
const leafAt = (progress: number, i: number) => clamp(progress * LEAVES - i, 0, 1);

export const createRosetta: SceneFactory = (random = Math.random) => {
  const flecks = Array.from({ length: FLECKS }, () => ({
    r: 20 + 76 * Math.sqrt(random()),
    a: random() * TAU,
    size: 0.6 + 1.4 * random(),
    alpha: 0.25 + 0.4 * random(),
  }));
  /** Each leaf as poured so far, easing toward the progress. */
  const grown = new Array<number>(LEAVES).fill(0);
  let pull = 0;
  let done = false;
  let progress = 0;
  let t = 0;

  function update(dt: number, input: SceneInput): void {
    t += dt;
    progress = input.progress;
    for (let i = 0; i < LEAVES; i += 1) grown[i] = smooth(grown[i]!, leafAt(progress, i), dt, 0.3);
    // The pull-through finishes a rosetta the steam finished: not one the machine going away cut short.
    done = input.phase === 'done';
    pull = done ? Math.min(1, pull + dt / PULL_S) : 0;
  }

  /** The leaves, the base under them and the dot on top, in the milk's colour. */
  function pour(ctx: CanvasRenderingContext2D, color: Oklab, leaves: readonly number[], still: boolean): void {
    const first = leaves[0]!;
    if (first > 0.01) {
      const u = Math.min(1, first * 1.5);
      ctx.fillStyle = css(color, u);
      ctx.beginPath();
      ctx.ellipse(C, 214, 26 * (0.5 + 0.5 * u), 8 * (0.5 + 0.5 * u), 0, 0, TAU);
      ctx.fill();
    }
    leaves.forEach((g, i) => {
      if (g <= 0.01) return;
      const y = 194 - i * 10.8;
      const w = (46 - 2.3 * i) * (0.65 + 0.35 * g);
      const h = w * 0.62;
      const thick = (4.8 - 0.18 * i) * (0.6 + 0.4 * g);
      // The newest leaf wiggles in as the pitcher does.
      const x = C + (still ? 0 : Math.sin(t * 10 + i) * 3.2 * (1 - g));
      ctx.fillStyle = css(color, Math.min(1, g * 1.4));
      ctx.beginPath();
      ctx.ellipse(x, y + h, w, h, 0, Math.PI + 0.16, TAU - 0.16);
      ctx.ellipse(x, y + h + thick, w * 0.94, h * 0.92, 0, TAU - 0.28, Math.PI + 0.28, true);
      ctx.closePath();
      ctx.fill();
    });
    const last = leaves[LEAVES - 1]!;
    if (last > 0.6) {
      ctx.fillStyle = css(color, (last - 0.6) / 0.4);
      ctx.beginPath();
      ctx.ellipse(C, 64, 6, 7, 0, 0, TAU);
      ctx.fill();
    }
  }

  function draw(frame: SceneFrame, input: SceneInput): void {
    const { ctx, colors } = frame;
    const crema = ctx.createRadialGradient(C - 10, C - 14, 10, C, C, INSIDE);
    crema.addColorStop(0, css(mixOklab(colors.crema, colors.cremaLight, 0.5)));
    crema.addColorStop(0.72, css(colors.crema));
    crema.addColorStop(1, css(colors.cremaRim));
    ctx.fillStyle = crema;
    ctx.fillRect(SQUARE.at, SQUARE.at, SQUARE.size, SQUARE.size);
    const flecked = frame.layer();
    for (const f of flecks) {
      flecked.fillStyle = css(colors.cremaLight, f.alpha);
      flecked.beginPath();
      flecked.arc(C + Math.cos(f.a) * f.r, C + Math.sin(f.a) * f.r, f.size, 0, TAU);
      flecked.fill();
    }
    frame.cutFigures(1);
    frame.blit();

    // Still, the rosetta stands as the reading does: every leaf poured so far, and the stem once done.
    const milk = mixOklab(colors.artCold, colors.artWarm, input.warmth);
    const leaves = frame.still ? grown.map((_, i) => leafAt(input.progress, i)) : grown;
    pour(ctx, milk, leaves, frame.still);
    const drawn = frame.still ? (input.phase === 'done' ? 1 : 0) : pull;
    if (drawn > 0) {
      const stem = frame.layer();
      stem.lineCap = 'round';
      stem.strokeStyle = css(milk);
      stem.lineWidth = 2;
      stem.beginPath();
      stem.moveTo(C, STEM_TOP);
      stem.lineTo(C, STEM_TOP + STEM * ease(drawn));
      stem.stroke();
      frame.cutFigures(1);
      frame.blit();
    }
  }

  return {
    update,
    draw,
    // The stem still drawing through, or a leaf still pouring in.
    settling: () => (done && pull < 1) || grown.some((g, i) => Math.abs(g - leafAt(progress, i)) > 0.01),
  };
};

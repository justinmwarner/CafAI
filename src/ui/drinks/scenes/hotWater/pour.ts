/**
 * Hot water: Pour, the default (docs/superpowers/specs/2026-10-22-drink-scenes-design.md,
 * section 4; D-SCENE-1, D-SCENE-2). The cup from the side: a steel spout at
 * the top, and a stream falling from it, behind the figures and cut out there,
 * into water that rises toward the volume as the progress does, staying under
 * the figures.
 *
 * The strength sets the stream's width and speed, and with them the splash,
 * the rings it sends across the surface and the bubbles it carries down. The
 * heat (the temperature set) sets how much vapour rises off the water, which
 * keeps rising while the scene settles after the pour. The warmth colours the
 * water: bluer when it is set cool, warmer when set hot. Reduced motion draws
 * the water still, and the stream while it pours.
 */
import { C, drawPuff, movePuffs, smooth, TAU, type Puff } from '../canvas.ts';
import { css, mixOklab } from '../colors.ts';
import type { SceneFactory } from '../types.ts';

/** The spout's mouth, above the figures: the stream falls from here. */
const SPOUT_Y = 56;
/** The water's surface when the cup is empty, and how far it rises to the volume. */
const EMPTY_Y = 228;
const RISE = 36;
/** The water's span across the cup and below the ring's floor; the frame's clip rounds it. */
const LEFT = 28;
const RIGHT = 244;
const BOTTOM = 240;
/** The longest the scene moves on after the pour (the design's section 4): the vapour would rise for good. */
const SETTLE_S = 3;

/** A bubble the stream carries down, rising back as it slows. */
interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  max: number;
  r: number;
}

/** A drop of the splash, thrown up where the stream lands. */
interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  max: number;
}

/** A ring spreading across the surface from the stream. */
interface Ring {
  age: number;
  max: number;
}

export const createPour: SceneFactory = (random = Math.random) => {
  /** The scene's clock, for the vapour's drift. */
  let t = 0;
  /** The strength, smoothed. */
  let s = 0;
  /** The surface's swell, and how far the stream has run, for its thread of light. */
  let swell = 0;
  let run = 0;
  /** Seconds since the pour ended. */
  let after = 0;
  let bubbles: Bubble[] = [];
  let drops: Drop[] = [];
  let rings: Ring[] = [];
  let puffs: Puff[] = [];
  /** How much of the next bubble, drop, ring and puff is due: each appears as its count reaches one. */
  const due = { bubble: 0, drop: 0, ring: 0, puff: 0 };

  const levelAt = (progress: number) => EMPTY_Y - RISE * progress;
  const surfaceAt = (x: number, level: number, strength: number) =>
    level + (0.7 + 1.5 * strength) * Math.sin(x * 0.05 + swell) + (0.3 + 0.9 * strength) * Math.sin(x * 0.13 - swell * 1.7);
  const traceSurface = (ctx: CanvasRenderingContext2D, level: number, strength: number) => {
    ctx.moveTo(LEFT, surfaceAt(LEFT, level, strength));
    for (let x = LEFT + 4; x <= RIGHT; x += 4) ctx.lineTo(x, surfaceAt(x, level, strength));
  };
  /** How much of the stream shows: it thins in and out with the strength. */
  const streamShown = () => Math.min(1, s * 1.6);

  return {
    update(dt, input) {
      t += dt;
      after = input.live ? 0 : after + dt;
      const working = input.phase === 'working';
      s = smooth(s, working ? input.strength : 0, dt, 0.25);
      const level = levelAt(input.progress);
      swell += dt * ((input.live ? 0.3 : 0) + 1.6 * s);
      run += dt * (70 + 130 * s);
      if (s > 0.05) {
        // What the stream carries down, throws up and sends across the surface, as hard as it pours.
        due.bubble += dt * 38 * s;
        while (due.bubble >= 1) {
          due.bubble -= 1;
          bubbles.push({
            x: C + (random() - 0.5) * 8,
            y: level + 2,
            vx: (random() - 0.5) * 40,
            vy: 40 + 60 * random() * Math.min(1.3, s),
            age: 0,
            max: 0.9 + 0.6 * random(),
            r: 0.6 + 1.1 * random(),
          });
        }
        due.drop += dt * 22 * s;
        while (due.drop >= 1) {
          due.drop -= 1;
          const angle = -Math.PI / 2 + (random() - 0.5) * 2.4;
          const speed = 25 + 45 * random();
          drops.push({ x: C + (random() - 0.5) * 5, y: level - 1, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, max: 0.7 });
        }
        due.ring += dt * 2.6 * Math.min(1.4, s);
        while (due.ring >= 1) {
          due.ring -= 1;
          rings.push({ age: 0, max: 1.5 });
        }
      }
      // Hot water steams, the more the hotter it was set, and on after the pour.
      due.puff += dt * input.heat * (working ? 6 : input.live ? 0 : 2.5);
      while (due.puff >= 1) {
        due.puff -= 1;
        puffs.push({
          x: 66 + 140 * random(),
          y: level - 3,
          vx: (random() - 0.5) * 5,
          vy: -(12 + 10 * random()),
          r: 6 + 4 * random(),
          grow: 7 + 5 * random(),
          age: 0,
          max: 3.6 + 1.6 * random(),
          alpha: (0.07 + 0.06 * random()) * input.heat,
          seed: random() * 6,
        });
      }
      for (const bubble of bubbles) {
        bubble.age += dt;
        bubble.x += bubble.vx * dt;
        bubble.y += bubble.vy * dt;
        bubble.vy -= 170 * dt;
        bubble.vx *= Math.exp(-3 * dt);
      }
      bubbles = bubbles.filter((bubble) => bubble.age < bubble.max && bubble.y > level);
      for (const drop of drops) {
        drop.age += dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        drop.vy += 320 * dt;
      }
      drops = drops.filter((drop) => drop.age < drop.max && drop.y <= level + 1);
      for (const ring of rings) ring.age += dt;
      rings = rings.filter((ring) => ring.age < ring.max);
      puffs = movePuffs(puffs, dt, t);
    },

    draw(frame, input) {
      const { ctx, colors } = frame;
      const strength = frame.still ? 0 : s;
      const level = levelAt(input.progress);
      const water = mixOklab(colors.waterCold, colors.waterWarm, input.warmth);
      const line = mixOklab(colors.waterLineCold, colors.waterLineWarm, input.warmth);

      // The vapour, behind everything else: a tenth of it may pass behind the figures.
      if (!frame.still && puffs.length > 0) {
        const vapour = frame.layer();
        for (const puff of puffs) drawPuff(vapour, puff, colors.steam, colors.steamStrength);
        frame.cutFigures(0.9);
        frame.blit();
      }

      // The water, a glow under its surface, and the bubbles the stream carries down.
      ctx.beginPath();
      traceSurface(ctx, level, strength);
      ctx.lineTo(RIGHT, BOTTOM);
      ctx.lineTo(LEFT, BOTTOM);
      ctx.closePath();
      ctx.fillStyle = css(water);
      ctx.fill();
      ctx.setLineDash([]);
      ctx.save();
      ctx.clip();
      const glow = ctx.createLinearGradient(0, level - 4, 0, level + 14);
      glow.addColorStop(0, css(line, 0.32));
      glow.addColorStop(1, css(line, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(LEFT, level - 6, RIGHT - LEFT, 22);
      if (!frame.still) {
        ctx.lineWidth = 0.9;
        for (const bubble of bubbles) {
          ctx.strokeStyle = css(line, 0.7 * (1 - bubble.age / bubble.max));
          ctx.beginPath();
          ctx.arc(bubble.x, bubble.y, bubble.r, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.beginPath();
      traceSurface(ctx, level, strength);
      ctx.strokeStyle = css(line, 0.85);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // The stream, its splash and the rings it sends out, cut out behind the figures.
      const shown = frame.still ? (input.phase === 'working' ? 1 : 0) : streamShown();
      const splashing = !frame.still && rings.length + drops.length > 0;
      if (shown > 0.02 || splashing) {
        const layer = frame.layer();
        if (shown > 0.02) {
          const width = 1.6 + 4.2 * Math.min(1.3, frame.still ? input.strength : s);
          layer.fillStyle = css(line, 0.8 * shown);
          layer.fillRect(C - width / 2, SPOUT_Y + 2, width, level - SPOUT_Y - 1);
          // A thread of light running down it at the stream's speed.
          layer.strokeStyle = css(colors.foam, 0.75 * shown);
          layer.lineWidth = 1;
          layer.lineCap = 'butt';
          layer.setLineDash([5, 11]);
          layer.lineDashOffset = -run;
          layer.beginPath();
          layer.moveTo(C - width * 0.18, SPOUT_Y + 2);
          layer.lineTo(C - width * 0.18, level);
          layer.stroke();
          layer.setLineDash([]);
        }
        if (splashing) {
          layer.lineWidth = 1.1;
          layer.setLineDash([]);
          for (const ring of rings) {
            const u = ring.age / ring.max;
            const rx = 5 + 74 * u;
            layer.strokeStyle = css(line, 0.55 * (1 - u));
            layer.beginPath();
            layer.ellipse(C, level + 0.5, rx, rx * 0.13, 0, 0, TAU);
            layer.stroke();
          }
          for (const drop of drops) {
            layer.fillStyle = css(line, 0.85 * (1 - drop.age / drop.max));
            layer.beginPath();
            layer.arc(drop.x, drop.y, 1.2, 0, TAU);
            layer.fill();
          }
        }
        frame.cutFigures(1);
        frame.blit();
      }

      // The spout: a steel tube down from the top, lit on its left, its mouth above the figures.
      ctx.fillStyle = css(colors.steel);
      ctx.fillRect(C - 6, 28, 12, SPOUT_Y - 28);
      ctx.fillStyle = css(colors.steelLight, 0.85);
      ctx.fillRect(C - 4.5, 28, 1.5, SPOUT_Y - 28);
      ctx.fillStyle = css(colors.steelDark, 0.9);
      ctx.fillRect(C + 3.2, 28, 1.5, SPOUT_Y - 28);
      ctx.fillStyle = css(colors.steelHole);
      ctx.beginPath();
      ctx.ellipse(C, SPOUT_Y, 4.6, 1.6, 0, 0, TAU);
      ctx.fill();
    },

    settling() {
      const moving = streamShown() > 0.02 || bubbles.length + drops.length + rings.length + puffs.length > 0;
      return moving && after < SETTLE_S;
    },
  };
};

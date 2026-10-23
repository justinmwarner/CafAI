/**
 * Steam's Wand and spray, the default (the design's section 4, D-SCENE-1):
 * the pitcher from the side, as the mockup's Spray draws it. The wand dips in
 * from the right, its tip just under the milk at first (the stretch) and
 * deeper as the milk grows. Steam jets from the tip, its spray and the milk's
 * roll as strong as the strength; microfoam bubbles circle with the roll, big
 * early and finer as it textures, and pop at the surface while it stretches.
 * Steam rises round the wand with strength and heat and, as the milk gets
 * hot, off the whole surface. The milk warms from a cold blue-white to cream
 * and grows 13 units, fastest early. Purging, a puff from the tip; done, the
 * milk settles, glossy.
 *
 * The milk stays below the figures' line, so only the steam passes behind
 * the figures, cut out there to a tenth of its strength.
 */
import { C, drawPuff, ease, movePuffs, smooth, TAU, type Puff } from '../canvas.ts';
import { css, mixOklab, type SceneColors } from '../colors.ts';
import type { SceneFactory, SceneFrame, SceneInput } from '../types.ts';

/** The wand: where it comes in at the right, and its tip in the milk. */
const WAND = { x: 266, y: 136 };
const TIP = { x: 184, y: 205 };
const LENGTH = Math.hypot(TIP.x - WAND.x, TIP.y - WAND.y);
/** Down the wand, toward its tip. */
const ALONG = { x: (TIP.x - WAND.x) / LENGTH, y: (TIP.y - WAND.y) / LENGTH };
/** Across the wand, toward its lit upper left edge. */
const ACROSS = { x: -Math.abs(ALONG.y), y: -Math.abs(ALONG.x) };
/** The pitcher's bottom, under the ring; the milk drawn across the inside and below it. */
const BOTTOM = 236;
const LEFT = 28;
const RIGHT = 244;
const BELOW = 240;
/** Once the run is over, steam still in the air thins away within this, inside the canvas's 3 s of settling. */
const LINGER_S = 2.6;

/** A jet of steam from the tip, as a short streak. */
interface Jet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  max: number;
}

/** A microfoam bubble circling with the milk's roll: its angle and distance out on the roll, and a jitter off it. */
interface Bubble {
  angle: number;
  out: number;
  /** How fast it goes round, against the roll's. */
  speed: number;
  jx: number;
  jy: number;
  age: number;
  max: number;
  r: number;
  alpha: number;
}

/** A bubble popping at the surface while the milk stretches. */
interface Pop {
  x: number;
  age: number;
  max: number;
}

/** The milk's surface, 203 at the start and 190 at the end of the steam, rising fastest early. */
const levelAt = (progress: number) => 203 - 13 * ease(progress);
/** Where the wand meets the surface. */
const wandX = (level: number) => WAND.x + (TIP.x - WAND.x) * ((level - WAND.y) / (TIP.y - WAND.y));
/** The milk's roll: an ellipse about the middle of its depth. */
const rollAt = (level: number) => ({ cy: level + (BOTTOM - level) * 0.5, rx: 66, ry: (BOTTOM - level) * 0.36 });

function drawWand(ctx: CanvasRenderingContext2D, colors: SceneColors): void {
  const neck = { x: TIP.x - ALONG.x * 8, y: TIP.y - ALONG.y * 8 };
  const shaft = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(WAND.x + dx, WAND.y + dy);
    ctx.lineTo(neck.x + dx, neck.y + dy);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(colors.steel);
  ctx.lineWidth = 7;
  shaft(0, 0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = css(colors.steelLight, 0.85);
  shaft(ACROSS.x * 2.2, ACROSS.y * 2.2);
  ctx.strokeStyle = css(colors.steelDark, 0.9);
  shaft(-ACROSS.x * 2.4, -ACROSS.y * 2.4);
  // The nozzle, lit on the same side, and the hole the steam leaves by.
  const nozzle = { x: TIP.x - ALONG.x * 3, y: TIP.y - ALONG.y * 3 };
  ctx.fillStyle = css(colors.steel);
  ctx.beginPath();
  ctx.arc(nozzle.x, nozzle.y, 5, 0, TAU);
  ctx.fill();
  const lit = Math.atan2(ACROSS.y, ACROSS.x);
  ctx.strokeStyle = css(colors.steelLight, 0.7);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(nozzle.x, nozzle.y, 3.6, lit - 0.9, lit + 0.9);
  ctx.stroke();
  ctx.fillStyle = css(colors.steelHole);
  ctx.beginPath();
  ctx.arc(TIP.x + ALONG.x * 1.2, TIP.y + ALONG.y * 1.2, 1.5, 0, TAU);
  ctx.fill();
}

export const createSpray: SceneFactory = (random = Math.random) => {
  let jets: Jet[] = [];
  let bubbles: Bubble[] = [];
  let pops: Pop[] = [];
  let puffs: Puff[] = [];
  /** The steam's strength, smoothed; the surface's two waves; the scene's clock. */
  let s = 0;
  let phase1 = 0;
  let phase2 = 0;
  let t = 0;
  /** What is owed of each kind of particle: a fraction carried from frame to frame. */
  const owed = { jets: 0, wand: 0, surface: 0, pops: 0, heating: 0, purge: 0 };

  /** The milk's surface at x: its far side (behind the wand), or its near side, dimpled where the wand goes in. */
  function surface(x: number, level: number, strength: number, far: boolean): number {
    const swell = 1 + 2.6 * strength;
    const ripple = 0.3 + 1.3 * strength;
    if (far) return level - 2.5 + 0.8 * swell * Math.sin(x * 0.038 - phase1 * 0.8 + 1.7);
    const dimple = (1.2 + 2.2 * strength) * Math.exp(-(((x - wandX(level)) / 9) ** 2));
    return level + swell * Math.sin(x * 0.045 + phase1) + ripple * Math.sin(x * 0.11 - phase2 * 1.3) + dimple;
  }

  function trace(ctx: CanvasRenderingContext2D, level: number, strength: number, far: boolean): void {
    ctx.moveTo(LEFT, surface(LEFT, level, strength, far));
    for (let x = LEFT + 4; x <= RIGHT; x += 4) ctx.lineTo(x, surface(x, level, strength, far));
  }

  function puff(x: number, y: number, weight: number, heat: number): void {
    puffs.push({
      x,
      y,
      vx: (random() - 0.5) * 7,
      vy: -(16 + 14 * random()) * (0.75 + 0.4 * Math.min(1.4, s)),
      r: 7 + 5 * random(),
      grow: 8 + 5 * random(),
      age: 0,
      max: 4 + 2 * random(),
      alpha: (0.1 + 0.08 * random()) * Math.min(1, heat) * weight,
      seed: random() * 6,
    });
  }

  /** A jet spent in the milk becomes a bubble on the roll, as far out on it as the jet reached. */
  function bubble(x: number, y: number, level: number, progress: number): void {
    const roll = rollAt(level);
    const dx = (x - C) / roll.rx;
    const dy = (y - roll.cy) / roll.ry;
    const big = progress < 0.3;
    bubbles.push({
      angle: Math.atan2(dy, dx),
      out: Math.min(1, Math.max(0.2, Math.hypot(dx, dy) + (random() - 0.5) * 0.35)),
      speed: 0.9 + 0.7 * random(),
      jx: (random() - 0.5) * 10,
      jy: (random() - 0.5) * 6,
      age: 0,
      max: 1.4 + 1.6 * random(),
      r: big ? 0.9 + random() : 0.5 + 0.6 * random(),
      alpha: 0.25 + 0.3 * random(),
    });
  }

  function update(dt: number, input: SceneInput): void {
    t += dt;
    // Paused is working with no strength.
    const working = input.phase === 'working' || input.phase === 'paused';
    const purging = input.phase === 'purging' || input.phase === 'rinsing';
    s = smooth(s, working ? input.strength : 0, dt, 0.35);
    const live = input.live ? 1 : 0;
    phase1 += dt * (0.25 * live + 1.4 * s);
    phase2 += dt * (0.4 * live + 2.3 * s);
    const level = levelAt(input.progress);

    if (working) owed.jets += dt * 95 * s * Math.min(1, input.heat);
    for (; owed.jets >= 1; owed.jets -= 1) {
      const angle = Math.atan2(ALONG.y, ALONG.x) + (random() - 0.5) * 0.9;
      const speed = (50 + 70 * random()) * (0.55 + 0.55 * s);
      jets.push({ x: TIP.x + ALONG.x * 2, y: TIP.y + ALONG.y * 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, max: 0.2 + 0.2 * random() });
    }
    const drag = Math.exp(-5 * dt);
    for (const jet of jets) {
      jet.x += jet.vx * dt;
      jet.y += jet.vy * dt;
      jet.vx *= drag;
      jet.vy *= drag;
      jet.age += dt;
      if (jet.age >= jet.max && random() < 0.8) bubble(jet.x, jet.y, level, input.progress);
    }
    jets = jets.filter((jet) => jet.age < jet.max);
    for (const b of bubbles) {
      b.angle += dt * b.speed * (0.35 + 1.5 * s);
      b.age += dt;
    }
    bubbles = bubbles.filter((b) => b.age < b.max);

    // The stretch: big bubbles pop at the surface early on.
    if (working && input.progress < 0.35) owed.pops += dt * 8 * s;
    for (; owed.pops >= 1; owed.pops -= 1) pops.push({ x: 160 + 44 * random(), age: 0, max: 0.35 });
    for (const pop of pops) pop.age += dt;
    pops = pops.filter((pop) => pop.age < pop.max);

    // Steam rising: round the wand with the steam's strength, off the whole surface as the milk gets hot.
    if (working) {
      owed.wand += dt * 9 * Math.max(0.2, s) * input.heat;
      owed.surface += dt * 9 * input.progress * (0.5 + 0.5 * Math.min(1, s));
    }
    if (purging) owed.purge += dt * 26;
    if (input.phase === 'heating') owed.heating += dt * 2.2;
    for (; owed.wand >= 1; owed.wand -= 1) puff(176 + 40 * random(), level - 2, 1, input.heat);
    for (; owed.surface >= 1; owed.surface -= 1) puff(64 + 140 * random(), level - 3, 0.8, input.heat);
    for (; owed.purge >= 1; owed.purge -= 1) {
      puffs.push({
        x: TIP.x - 6 + 12 * random(),
        y: TIP.y - 10,
        vx: -14 + 28 * random(),
        vy: -(44 + 30 * random()),
        r: 4 + 3 * random(),
        grow: 12 + 6 * random(),
        age: 0,
        max: 1.3 + 0.6 * random(),
        alpha: 0.22 + 0.1 * random(),
        seed: random() * 6,
      });
    }
    // A thin thread of steam from the tip while the heater warms.
    for (; owed.heating >= 1; owed.heating -= 1) {
      puffs.push({ x: TIP.x - 1 + 2 * random(), y: TIP.y - 7, vx: -2 + 4 * random(), vy: -(9 + 6 * random()), r: 2.5, grow: 4, age: 0, max: 2, alpha: 0.09, seed: random() * 6 });
    }
    if (!input.live) for (const p of puffs) p.max = Math.min(p.max, p.age + LINGER_S);
    puffs = movePuffs(puffs, dt, t);
  }

  function draw(frame: SceneFrame, input: SceneInput): void {
    const { ctx, colors } = frame;
    // Still, the milk lies flat and nothing flies: no steam, jets, bubbles or pops.
    const strength = frame.still ? 0 : s;
    const level = levelAt(input.progress);
    const roll = rollAt(level);
    const milk = mixOklab(colors.milkCold, colors.milkWarm, input.warmth);
    const foam = mixOklab(colors.foam, milk, 0.2);

    // The steam, behind the milk and the wand.
    if (!frame.still && puffs.length > 0) {
      const layer = frame.layer();
      for (const p of puffs) drawPuff(layer, p, colors.steam, colors.steamStrength);
      frame.cutFigures(0.9);
      frame.blit();
    }

    // The milk's far side, then the wand, then the near side a little see-through, so the tip shows under the surface.
    ctx.fillStyle = css(mixOklab(milk, colors.background, 0.3));
    ctx.beginPath();
    trace(ctx, level, strength, true);
    ctx.lineTo(RIGHT, BELOW);
    ctx.lineTo(LEFT, BELOW);
    ctx.closePath();
    ctx.fill();
    drawWand(ctx, colors);
    ctx.beginPath();
    trace(ctx, level, strength, false);
    ctx.lineTo(RIGHT, BELOW);
    ctx.lineTo(LEFT, BELOW);
    ctx.closePath();
    ctx.fillStyle = css(milk, 0.93);
    ctx.fill();

    // Inside the milk: its gloss under the surface, the roll's glow at the tip, the bubbles and the jets.
    ctx.save();
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, level - 5, 0, level + 14);
    gloss.addColorStop(0, css(foam, frame.mode === 'dark' ? 0.32 : 0.7));
    gloss.addColorStop(1, css(foam, 0));
    ctx.fillStyle = gloss;
    ctx.fillRect(LEFT, level - 8, RIGHT - LEFT, 24);
    if (strength > 0.02) {
      const glow = ctx.createRadialGradient(TIP.x - 6, TIP.y + 4, 0, TIP.x - 6, TIP.y + 4, 26);
      glow.addColorStop(0, css(foam, 0.42 * Math.min(1, strength)));
      glow.addColorStop(1, css(foam, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(TIP.x - 34, TIP.y - 24, 56, 56);
    }
    if (!frame.still) {
      for (const b of bubbles) {
        ctx.fillStyle = css(foam, b.alpha * Math.min(1, b.age / 0.15) * Math.min(1, (b.max - b.age) / 0.5));
        ctx.beginPath();
        ctx.arc(C + roll.rx * b.out * Math.cos(b.angle) + b.jx, roll.cy + roll.ry * b.out * Math.sin(b.angle) + b.jy, b.r, 0, TAU);
        ctx.fill();
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.5;
      for (const jet of jets) {
        ctx.strokeStyle = css(foam, 0.85 * (1 - jet.age / jet.max));
        ctx.beginPath();
        ctx.moveTo(jet.x, jet.y);
        ctx.lineTo(jet.x - jet.vx * 0.045, jet.y - jet.vy * 0.045);
        ctx.stroke();
      }
    }
    ctx.restore();

    // The surface's line, brighter once the milk settles, and the stretch's pops on it.
    ctx.beginPath();
    trace(ctx, level, strength, false);
    ctx.strokeStyle = css(foam, input.live ? 0.55 : 0.75);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (!frame.still) {
      ctx.lineWidth = 1;
      for (const pop of pops) {
        const u = pop.age / pop.max;
        ctx.strokeStyle = css(foam, 0.6 * (1 - u));
        ctx.beginPath();
        ctx.arc(pop.x, surface(pop.x, level, strength, false) - 1, 0.5 + 3.5 * u, 0, TAU);
        ctx.stroke();
      }
    }
  }

  return {
    update,
    draw,
    // Steam still in the air, jets and bubbles still in the milk, the roll still easing.
    settling: () => puffs.length > 0 || jets.length > 0 || bubbles.length > 0 || pops.length > 0 || s > 0.01,
  };
};

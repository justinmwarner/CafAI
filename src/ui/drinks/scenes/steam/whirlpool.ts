/**
 * Steam's Whirlpool (the design's section 4, D217): looking down into the
 * pitcher, as the mockup's Whirl draws it. The milk turns, foam spiralling in
 * from the rim, as fast as the strength; the tip sits off centre, where a
 * barista holds it, churning while it steams; specks big early, finer later.
 * The milk under the figures warms within the contrast the figures need
 * (palette.test.ts). Done, it coasts to a stop and goes glossy, within the
 * canvas's 3 s of settling.
 *
 * The foam and its gloss are cut out behind the figures entirely; the wand
 * stays above and to their right.
 */
import { C, INSIDE, smooth, TAU } from '../canvas.ts';
import { css, mixOklab } from '../colors.ts';
import type { SceneFactory, SceneFrame, SceneInput } from '../types.ts';

/** The wand from above: its shaft coming in at the top right, and its tip in the milk. */
const SHAFT = { x: 244, y: 22 };
const TIP = { x: 183, y: 83 };
/** A square just round the inside of the ring. */
const SQUARE = { at: 30, size: 212 };
const STREAKS = 46;
const SPECKS = 150;
const MAX_SPECKS = 240;
/** How much the foam shows and how glossy the milk is, turning and at rest. */
const TURNING = { foam: 1, gloss: 0.35 };
const AT_REST = { foam: 0.3, gloss: 1 };

/** A streak of foam on its way in from the rim: a short arc that curls inward. */
interface Streak {
  r: number;
  a: number;
  /** Its length, radians. */
  len: number;
  width: number;
  alpha: number;
  /** How fast it is drawn in toward the middle. */
  inward: number;
  /** How far in it curls along its length. */
  curl: number;
}

interface Speck {
  r: number;
  a: number;
  alpha: number;
  inward: number;
  /** Its size against the others. */
  k: number;
}

export const createWhirlpool: SceneFactory = (random = Math.random) => {
  /** A streak anywhere on the milk (at the start), or a new one coming in at the rim. */
  const streak = (anywhere: boolean): Streak => ({
    r: anywhere ? 24 + 72 * random() : 92 + 6 * random(),
    a: random() * TAU,
    len: 0.35 + 0.75 * random(),
    width: 0.9 + 1.7 * random(),
    alpha: 0.3 + 0.5 * random(),
    inward: 0.5 + 0.9 * random(),
    curl: 3 + 6 * random(),
  });
  const speck = (anywhere: boolean): Speck => ({
    r: anywhere ? 14 + 84 * random() : 90 + 8 * random(),
    a: random() * TAU,
    alpha: 0.35 + 0.55 * random(),
    inward: 0.8 + 1.4 * random(),
    k: random(),
  });
  const streaks = Array.from({ length: STREAKS }, () => streak(true));
  const specks = Array.from({ length: SPECKS }, () => speck(true));
  /** The spin, smoothed from the strength; the scene's clock; specks owed to the tip's churn. */
  let s = 0;
  let t = 0;
  let owed = 0;
  let foam = TURNING.foam;
  let gloss = TURNING.gloss;
  let resting = false;

  function update(dt: number, input: SceneInput): void {
    t += dt;
    // Paused is working with no strength.
    const working = input.phase === 'working' || input.phase === 'paused';
    resting = !input.live;
    // It spins up with the steam and coasts once it stops; once the run is over it comes to rest within the settling.
    s = smooth(s, working ? input.strength : 0, dt, working ? 0.6 : resting ? 0.7 : 1.4);
    const spin = (working ? 0.12 : 0) + 2.1 * s;
    const goal = resting ? AT_REST : TURNING;
    foam = smooth(foam, goal.foam, dt, resting ? 0.6 : 1.5);
    gloss = smooth(gloss, goal.gloss, dt, resting ? 0.6 : 1.2);
    const drawn = working ? 1 : 0.3;
    streaks.forEach((k, i) => {
      k.a += dt * spin * (1.3 - (0.6 * k.r) / INSIDE);
      k.r -= dt * k.inward * (0.6 + 5 * s) * drawn;
      if (k.r < 16) streaks[i] = streak(false);
    });
    specks.forEach((p, i) => {
      p.a += dt * spin * (1.35 - (0.6 * p.r) / INSIDE);
      p.r -= dt * p.inward * (0.8 + 7 * s) * drawn;
      if (p.r < 10) specks[i] = speck(false);
    });
    // The tip churns specks into the milk as it steams.
    if (working) owed += dt * 30 * s;
    for (; owed >= 1; owed -= 1) {
      const dx = TIP.x - C + (random() - 0.5) * 12;
      const dy = TIP.y - C + (random() - 0.5) * 12;
      specks.push({ ...speck(false), r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) });
      if (specks.length > MAX_SPECKS) specks.shift();
    }
  }

  /** A streak's arc from its head, curling inward, `out` units further out (its shadow) or on it. */
  function spiral(layer: CanvasRenderingContext2D, k: Streak, out: number): void {
    layer.beginPath();
    for (let j = 0; j <= 8; j += 1) {
      const a = k.a + (k.len * j) / 8;
      const r = k.r + out - (k.curl * j) / 8;
      const x = C + Math.cos(a) * r;
      const y = C + Math.sin(a) * r;
      if (j === 0) layer.moveTo(x, y);
      else layer.lineTo(x, y);
    }
  }

  function draw(frame: SceneFrame, input: SceneInput): void {
    const { ctx, colors } = frame;
    // Still, the milk shows as the reading stands: turning while the run is live, at rest once it is over.
    const look = frame.still ? (input.live ? TURNING : AT_REST) : { foam, gloss };
    ctx.fillStyle = css(mixOklab(colors.swirlCold, colors.swirlWarm, input.warmth));
    ctx.fillRect(SQUARE.at, SQUARE.at, SQUARE.size, SQUARE.size);
    // The trough at the rim, where the milk climbs the pitcher's wall.
    const rim = ctx.createRadialGradient(C, C, 62, C, C, INSIDE);
    rim.addColorStop(0, css(colors.swirlTrough, 0));
    rim.addColorStop(1, css(colors.swirlTrough, 0.55));
    ctx.fillStyle = rim;
    ctx.fillRect(SQUARE.at, SQUARE.at, SQUARE.size, SQUARE.size);

    const layer = frame.layer();
    layer.lineCap = 'round';
    layer.lineJoin = 'round';
    for (const k of streaks) {
      const alpha = k.alpha * look.foam * Math.min(1, (INSIDE - k.r) / 8 + 0.15);
      spiral(layer, k, 1.8);
      layer.strokeStyle = css(colors.swirlTrough, alpha * 0.5);
      layer.lineWidth = k.width + 0.6;
      layer.stroke();
      spiral(layer, k, 0);
      layer.strokeStyle = css(colors.swirlFoam, alpha);
      layer.lineWidth = k.width;
      layer.stroke();
    }
    // Specks big while the milk stretches, finer as it textures.
    const size = 1.9 - 1.3 * input.progress;
    for (const p of specks) {
      layer.fillStyle = css(colors.swirlFoam, p.alpha * look.foam);
      layer.beginPath();
      layer.arc(C + Math.cos(p.a) * p.r, C + Math.sin(p.a) * p.r, size * (0.6 + 0.8 * p.k), 0, TAU);
      layer.fill();
    }
    const sheen = layer.createRadialGradient(C - 36, C - 42, 4, C - 36, C - 42, 58);
    sheen.addColorStop(0, css(colors.sheen, 0.1 * look.gloss * colors.sheenStrength));
    sheen.addColorStop(1, css(colors.sheen, 0));
    layer.fillStyle = sheen;
    layer.fillRect(SQUARE.at, SQUARE.at, SQUARE.size, SQUARE.size);
    frame.cutFigures(1);
    frame.blit();

    // The wand from above, lit along its top edge, and its tip churning the milk while it steams.
    ctx.lineCap = 'round';
    ctx.strokeStyle = css(colors.steel);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(SHAFT.x, SHAFT.y);
    ctx.lineTo(TIP.x, TIP.y);
    ctx.stroke();
    ctx.strokeStyle = css(colors.steelLight, 0.8);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(SHAFT.x - 2, SHAFT.y - 2);
    ctx.lineTo(TIP.x - 2, TIP.y - 2);
    ctx.stroke();
    const churn = frame.still ? 0 : Math.min(1, s);
    if (churn > 0.01) {
      ctx.strokeStyle = css(colors.swirlFoam, 0.55 * churn);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 7; i += 1) {
        const from = t * (4 + 2 * churn) + (i * TAU) / 7;
        ctx.beginPath();
        ctx.arc(TIP.x, TIP.y, 8.5 + (i % 3) * 1.6, from, from + 0.7);
        ctx.stroke();
      }
    }
    ctx.fillStyle = css(colors.steel);
    ctx.beginPath();
    ctx.arc(TIP.x, TIP.y, 5.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = css(colors.steelHole);
    ctx.beginPath();
    ctx.arc(TIP.x, TIP.y, 1.8, 0, TAU);
    ctx.fill();
  }

  const goal = () => (resting ? AT_REST : TURNING);
  return {
    update,
    draw,
    // Still turning, or its foam and gloss still on their way to how they rest.
    settling: () => s > 0.02 || Math.abs(foam - goal().foam) > 0.01 || Math.abs(gloss - goal().gloss) > 0.01,
  };
};

/**
 * Brew Rain (D-RAIN-1 to D-RAIN-3, D-RAIN-6): after The Matrix's falling
 * code, water falls from a group head's shower screen and brews on its way
 * down into the cup. Along the top, the underside of the dispersion screen:
 * brushed steel with rows of small holes, a column under each hole of the
 * front two rows. Down each column a head falls, a coffee glyph (a bean, a
 * drop, a cup, cherries, a leaf, steam, a latte-art heart: rainGlyphs.ts) or
 * a letter of coffee's words and numbers in Figtree; pale water near the top,
 * crema gold further down, amber near the cup, each glowing softly; its trail
 * sinks through amber and espresso brown into the page. The far columns,
 * between the near ones, are smaller, slower and fainter. Every few seconds a
 * column spells a word (ESPRESSO, 9 BAR, the last shot's 36.4), lit a moment.
 * At the bottom, the cup: coffee under its crema, a slow wave on the surface,
 * and each head that reaches it drops in with a splash and rings spreading on
 * the crema. Where everything is is rainModel.ts.
 *
 * The trail is the classic one: a canvas of its own, faded a little each
 * frame, where only the cells the heads leave are painted (the fade is of the
 * paint's opacity: fading toward the page's colour would never arrive at it,
 * 8-bit colour rounding a dark page's blue away a little each frame). Each
 * frame copies it onto the screensaver's canvas, whose own background is the
 * page, and draws over it, crisp: the words, the heads with their glow, the
 * cup and the shower screen, from sprites drawn once a size.
 */
import { hexToOklab, mixOklab, oklabToRgb, oklch, parseHex } from '../../color.ts';
import { createRandom } from '../random.ts';
import type { CanvasSaver, SaverInstance } from '../types.ts';
import { paintGlyph } from './rainGlyphs.ts';
import {
  createRainModel,
  FAR,
  isStillMoment,
  isSymbol,
  layoutFor,
  letterAlpha,
  LEVEL_FULL,
  levelY,
  NEAR,
  PITCH,
  rippleAt,
  rowY,
  surfaceAt,
  WAVE_REACH,
  type RainColumn,
  type RainLayer,
  type RainLayout,
  type RainModel,
} from './rainModel.ts';

const FAMILY = '"Figtree", system-ui, sans-serif';
/** How much more transparent the trail's paint gets each frame, at 30 frames a second. */
const FADE_PER_FRAME = 0.044;
const FRAME_MS = 1000 / 30;
/** The trail fades every other frame, by both frames' worth: half the work, and no eye sees a fade 15 times a second. */
const FADE_EVERY_MS = 2 * FRAME_MS - 1;
/** The colours down the screen come in this many steps, each with its glow drawn once. */
const STEPS = 16;
/** A near head's glow reaches this far from its middle, px; a far one's is scaled to its size. */
const GLOW_RADIUS = 30;
/** A far column, against a near one: its colours this far toward the page, its glow this bright. */
const FAR_FADE = 0.42;
const FAR_GLOW = 0.45;
/** How deep the crema is under the surface, px, before the coffee: this, or less on a short screen (a share of its height). */
const CREMA_DEPTH = 20;
const CREMA_SHARE = 0.034;
/** Below this size, px, there is no rain to draw: the scene waits for a size it can fall on. */
const MIN_WIDTH = 2 * PITCH;
const MIN_HEIGHT = 120;
/** A rain laid out again for a new size plays this long first, so it falls as it was rather than starting afresh. */
const REPLAY_MS = 4000;
/** After this long without a frame, whatever the trail held has faded: it starts clean. */
const TRAIL_GONE_MS = 3000;
/** The surface's line is drawn through a point every this many px. */
const WAVE_STEP = 8;
/** A head lights the crema under it from this many rows above it; the light lies in a patch this wide and tall, px. */
const REFLECTION_ROWS = 5;
const REFLECTION: readonly [number, number] = [76, 14];
/** The holes' rows on the screen's underside, up from its front edge, px: the front row over the near columns, the next over the far ones. */
const HOLE_ROWS = [
  { up: 10, size: 1, offset: NEAR.offset },
  { up: 17, size: 0.8, offset: FAR.offset },
  { up: 22.5, size: 0.65, offset: NEAR.offset },
  { up: 27, size: 0.53, offset: FAR.offset },
  { up: 30.5, size: 0.43, offset: NEAR.offset },
] as const;

type Lch = readonly [lightness: number, chroma: number, hue: number];

/** A colour ramp in OKLCH, sampled at a share 0 (the top) to 1 (the cup). */
type Ramp = readonly (readonly [at: number, colour: Lch])[];

/** The heads: pale water at the top, crema gold, then amber by the cup. */
const HEAD_RAMP: Ramp = [
  [0, [0.95, 0.03, 225]],
  [0.3, [0.92, 0.07, 95]],
  [0.6, [0.86, 0.12, 80]],
  [1, [0.79, 0.14, 64]],
];
/** The trails: what the water has brewed, gold near the top to amber and a reddish brown below. */
const TRAIL_RAMP: Ramp = [
  [0, [0.82, 0.08, 90]],
  [0.45, [0.75, 0.125, 72]],
  [1, [0.66, 0.13, 55]],
];

/** The shower screen's steel, from the back of its underside to the front, and its holes and lip. */
const STEEL_BACK: Lch = [0.3, 0.006, 250];
const STEEL_FRONT: Lch = [0.5, 0.008, 250];
const STEEL_LIGHT: Lch = [0.86, 0.006, 250];
const STEEL_EDGE: Lch = [0.36, 0.008, 250];
const HOLE: Lch = [0.12, 0.004, 250];

/** The cup: the crema at its surface and deeper, the coffee under it. */
const CREMA_TOP: Lch = [0.86, 0.06, 82];
const CREMA_LIGHT: Lch = [0.76, 0.09, 72];
const CREMA_MID: Lch = [0.64, 0.105, 60];
const CREMA_LOW: Lch = [0.46, 0.085, 50];
const COFFEE_TOP: Lch = [0.3, 0.055, 45];
const COFFEE_LOW: Lch = [0.22, 0.035, 42];
const SURFACE_LINE: Lch = [0.94, 0.04, 88];
const RIPPLE: Lch = [0.95, 0.035, 88];
const RIPPLE_TROUGH: Lch = [0.5, 0.08, 55];
const DROPLET: Lch = [0.9, 0.08, 82];

const css = ([l, c, h]: Lch) => oklch(l, c, h);

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Two colours mixed in OKLab, as hex. */
function mix(from: string, to: string, t: number): string {
  const [r, g, b] = oklabToRgb(mixOklab(hexToOklab(from), hexToOklab(to), t));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A ramp's colour at `share` (0 to 1). */
function sample(ramp: Ramp, share: number): string {
  const t = Math.min(1, Math.max(0, share));
  for (let i = 1; i < ramp.length; i += 1) {
    const [at, colour] = ramp[i]!;
    if (t <= at) {
      const [lastAt, last] = ramp[i - 1]!;
      return mix(css(last), css(colour), (t - lastAt) / (at - lastAt));
    }
  }
  return css(ramp[ramp.length - 1]![1]);
}

/** A layer's colours at one step down the screen: its heads' and its trail's, each with the darker shade of their fine lines. */
interface Shades {
  head: string;
  headDetail: string;
  trail: string;
  trailDetail: string;
}

/** One step down the screen: each layer's shades, and the near heads' glow. */
interface Step {
  near: Shades;
  far: Shades;
  glow: HTMLCanvasElement;
}

/** What a column's head was last painted as: its cell, its glyph, and whether it is a letter of a word. */
interface Painted {
  row: number;
  glyph: string;
  bright: boolean;
}

/** A cell of the trail a head has left: its column and row, its glyph, and when it was left, ms. */
interface TrailCell {
  col: number;
  row: number;
  glyph: string;
  at: number;
}

export const rain: CanvasSaver = {
  id: 'rain',
  label: 'Brew Rain',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const doc = canvas.ownerDocument;
    const trail = doc.createElement('canvas');
    const trailCtx = trail.getContext('2d');
    if (!trailCtx) return null;
    const page = env.palette.background;
    // The page is the canvas's own background: each frame copies the trail over it as it is, clear where it is clear.
    const hostBackground = canvas.style.backgroundColor;
    canvas.style.backgroundColor = page;

    let layout: RainLayout | null = null;
    let model: RainModel | null = null;
    let width = 0;
    let height = 0;
    let scale = 1;
    /**
     * The trail's own scale: a CSS pixel to a pixel, below the canvas's on a finer screen. Its fade is
     * most of what a frame costs where a canvas is drawn without the GPU, and a fading trail shows no
     * difference; the heads, the words, the screen and the cup are drawn at the canvas's scale.
     */
    let trailScale = 1;
    /** The first frame after a size change starts from nothing painted, rather than fading what was. */
    let blank = true;
    /** Time stepped since the trail last faded: the fade goes by it, so a slow frame fades as much as the time it covers. */
    let pendingMs = 0;
    let painted: (Painted | null)[] = [];
    /** Each layer's floor when the trail was last cleared below it. */
    const clearedFloors = new Map<RainLayer, number>();
    let steps: Step[] = [];
    let screen: HTMLCanvasElement | null = null;
    let cup: HTMLCanvasElement | null = null;
    let cupPattern: CanvasPattern | null = null;
    /** Where the cup's sprite starts above the level, px. */
    let cupAbove = 0;
    let glowAbove: HTMLCanvasElement | null = null;
    let dropSprite: HTMLCanvasElement | null = null;
    /** The fonts each context holds: set only when they change, and forgotten when a canvas is resized (that resets its context). */
    let mainFont = '';
    let trailFont = '';

    const sprite = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
      const made = doc.createElement('canvas');
      made.width = Math.max(1, Math.ceil(w));
      made.height = Math.max(1, Math.ceil(h));
      const made2d = made.getContext('2d');
      return made2d ? [made, made2d] : null;
    };

    const release = (sprites: (HTMLCanvasElement | null)[]) => {
      for (const one of sprites) {
        if (one) {
          one.width = 0;
          one.height = 0;
        }
      }
    };

    /** A soft round glow of `colour`, brightest in the middle: drawn added to what is under it. */
    const makeGlow = (colour: string, radius: number, strength: number): HTMLCanvasElement | null => {
      const size = Math.ceil(radius * 2 * scale);
      const made = sprite(size, size);
      if (!made) return null;
      const [glow, g] = made;
      const middle = size / 2;
      const gradient = g.createRadialGradient(middle, middle, 0, middle, middle, middle);
      // About a Gaussian: soft all the way out, nothing at the edge.
      for (const [at, share] of [
        [0, 1],
        [0.15, 0.82],
        [0.3, 0.52],
        [0.5, 0.22],
        [0.7, 0.07],
        [1, 0],
      ] as const) {
        gradient.addColorStop(at, rgba(colour, strength * share));
      }
      g.fillStyle = gradient;
      g.fillRect(0, 0, size, size);
      return glow;
    };

    /** The underside of the shower screen along the top: brushed steel, rows of holes, a lit lip. */
    const makeScreen = (found: RainLayout): HTMLCanvasElement | null => {
      const made = sprite(width * scale, found.band * scale);
      if (!made) return null;
      const [band, g] = made;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      const steel = g.createLinearGradient(0, 0, 0, found.band);
      steel.addColorStop(0, css(STEEL_BACK));
      steel.addColorStop(0.75, css(STEEL_FRONT));
      steel.addColorStop(1, mix(css(STEEL_FRONT), css(STEEL_LIGHT), 0.2));
      g.fillStyle = steel;
      g.fillRect(0, 0, width, found.band);
      // Brushed: fine streaks along it, a little lighter or darker, seeded so each size draws the same.
      const next = createRandom(0x5c4ee7);
      g.setTransform(1, 0, 0, 1, 0, 0);
      const streaks = Math.round(found.band * scale * 7);
      for (let i = 0; i < streaks; i += 1) {
        const y = Math.floor(next() * found.band * scale);
        const x = next() * width * scale;
        const length = (0.08 + next() * 0.5) * width * scale;
        g.fillStyle = next() < 0.5 ? `rgba(255, 255, 255, ${0.025 + next() * 0.05})` : `rgba(0, 0, 0, ${0.04 + next() * 0.07})`;
        g.fillRect(x - length / 2, y, length, 1);
      }
      g.setTransform(scale, 0, 0, scale, 0, 0);
      // The holes, each row further back smaller and closer to the last, staggered by half a pitch.
      for (const row of HOLE_ROWS) {
        const y = found.band - row.up;
        const rx = 2.6 * row.size;
        const ry = 1.5 * row.size;
        if (y - 2 * ry < 1) continue;
        let x = found.left + row.offset * PITCH;
        while (x - PITCH > -rx) x -= PITCH;
        for (; x < width + rx; x += PITCH) {
          // The hole's rim, lit along its near edge, then the hole.
          g.fillStyle = rgba(css(STEEL_LIGHT), 0.6 * row.size);
          g.beginPath();
          g.ellipse(x, y + ry * 0.5, rx * 1.12, ry * 1.12, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = css(HOLE);
          g.beginPath();
          g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      // The lip along the front: a lit edge, then its darker face.
      g.fillStyle = css(STEEL_LIGHT);
      g.fillRect(0, found.band - 4, width, 1.2);
      g.fillStyle = mix(css(STEEL_FRONT), css(STEEL_EDGE), 0.5);
      g.fillRect(0, found.band - 2.8, width, 0.8);
      g.fillStyle = css(STEEL_EDGE);
      g.fillRect(0, found.band - 2, width, 2);
      // The light falls off toward its ends, as across a round screen.
      const ends = g.createLinearGradient(0, 0, width, 0);
      ends.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
      ends.addColorStop(0.28, 'rgba(0, 0, 0, 0)');
      ends.addColorStop(0.72, 'rgba(0, 0, 0, 0)');
      ends.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      g.fillStyle = ends;
      g.fillRect(0, 0, width, found.band);
      return band;
    };

    /** The cup's coffee from just above the level to the screen's bottom when it is fullest: crema over coffee, mottled. */
    const makeCup = (found: RainLayout): HTMLCanvasElement | null => {
      cupAbove = WAVE_REACH + 3;
      const tall = found.height * LEVEL_FULL + cupAbove + 2;
      const made = sprite(width * scale, tall * scale);
      if (!made) return null;
      const [made2, g] = made;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      const top = cupAbove - WAVE_REACH;
      // The crema thins on a short screen, so its layers always fit in the sprite; the depth is still kept within
      // the gradient, as addColorStop throws outside 0 to 1 (D-SAVE-3, D-RAIN-6).
      const crema = Math.min(CREMA_DEPTH, found.height * CREMA_SHARE);
      const depth = (y: number) => Math.min(1, Math.max(0, (y - top) / (tall - top)));
      const body = g.createLinearGradient(0, top, 0, tall);
      body.addColorStop(0, css(CREMA_TOP));
      body.addColorStop(depth(top + Math.min(2.5, crema * 0.15)), css(CREMA_LIGHT));
      body.addColorStop(depth(top + crema * 0.45), css(CREMA_MID));
      body.addColorStop(depth(top + crema), css(CREMA_LOW));
      body.addColorStop(depth(top + crema * 1.5), css(COFFEE_TOP));
      body.addColorStop(1, css(COFFEE_LOW));
      g.fillStyle = css(CREMA_TOP);
      g.fillRect(0, 0, width, top);
      g.fillStyle = body;
      g.fillRect(0, top, width, tall - top);
      // The crema's mottle, seeded so each size draws the same: soft lighter and darker clouds,
      // the tiger's darker flecks low in it, and fine bubbles near its top.
      const next = createRandom(0xc4e3a);
      const cloud = (x: number, y: number, rx: number, ry: number, colour: string, alpha: number) => {
        g.save();
        g.translate(x, y);
        g.scale(rx, ry);
        const soft = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        soft.addColorStop(0, rgba(colour, alpha));
        soft.addColorStop(1, rgba(colour, 0));
        g.fillStyle = soft;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      };
      const clouds = Math.round(width / 26);
      for (let i = 0; i < clouds; i += 1) {
        const lighter = next() < 0.5;
        cloud(next() * width, top + 2 + next() * crema * 0.8, 20 + next() * 50, 3 + next() * 4, css(lighter ? CREMA_TOP : CREMA_LOW), 0.16 + next() * 0.16);
      }
      const flecks = Math.round(width / 9);
      for (let i = 0; i < flecks; i += 1) {
        cloud(next() * width, top + crema * (0.4 + next() * 0.55), 1.5 + next() * 2.5, 3 + next() * 4, css(CREMA_LOW), 0.22 + next() * 0.25);
      }
      const bubbles = Math.round(width / 6);
      for (let i = 0; i < bubbles; i += 1) {
        g.fillStyle = rgba(css(SURFACE_LINE), 0.2 + next() * 0.3);
        g.beginPath();
        g.arc(next() * width, top + 1 + next() * 6, 0.35 + next() * 0.75, 0, Math.PI * 2);
        g.fill();
      }
      return made2;
    };

    /** Warm light off the crema, rising a little way into the air above it. */
    const makeGlowAbove = (): HTMLCanvasElement | null => {
      const tall = 46;
      const made = sprite(1, tall * scale);
      if (!made) return null;
      const [made2, g] = made;
      const gradient = g.createLinearGradient(0, 0, 0, tall * scale);
      gradient.addColorStop(0, rgba(css(CREMA_MID), 0));
      gradient.addColorStop(0.6, rgba(css(CREMA_MID), 0.05));
      gradient.addColorStop(1, rgba(css(CREMA_TOP), 0.14));
      g.fillStyle = gradient;
      g.fillRect(0, 0, 1, tall * scale);
      return made2;
    };

    /** The drop a head lets go into the cup: amber, lit from the top left. */
    const makeDrop = (): HTMLCanvasElement | null => {
      const w = 9;
      const h = 13;
      const made = sprite(w * scale, h * scale);
      if (!made) return null;
      const [made2, g] = made;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.translate(w / 2, h / 2);
      const amber = sample(HEAD_RAMP, 1);
      const shade = g.createRadialGradient(-1.3, 1, 0.5, 0, 1.5, 5);
      shade.addColorStop(0, mix(amber, '#ffffff', 0.45));
      shade.addColorStop(0.6, amber);
      shade.addColorStop(1, mix(amber, page, 0.35));
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(0, -6);
      g.bezierCurveTo(1, -4, 3.8, -1.2, 3.8, 1.8);
      g.arc(0, 1.8, 3.8, 0, Math.PI);
      g.bezierCurveTo(-3.8, -1.2, -1, -4, 0, -6);
      g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.75)';
      g.beginPath();
      g.ellipse(-1.3, 1.2, 0.8, 1.3, 0.4, 0, Math.PI * 2);
      g.fill();
      return made2;
    };

    const releaseSprites = () => {
      release([screen, cup, glowAbove, dropSprite, ...steps.map((one) => one.glow)]);
      screen = null;
      cup = null;
      cupPattern = null;
      glowAbove = null;
      dropSprite = null;
      steps = [];
    };

    const makeSprites = (found: RainLayout) => {
      releaseSprites();
      const shades = (head: string, trailColour: string): Shades => ({
        head,
        headDetail: mix(head, page, 0.62),
        trail: trailColour,
        trailDetail: mix(trailColour, page, 0.6),
      });
      for (let i = 0; i < STEPS; i += 1) {
        const share = i / (STEPS - 1);
        const head = sample(HEAD_RAMP, share);
        const trailColour = sample(TRAIL_RAMP, share);
        const glow = makeGlow(head, GLOW_RADIUS, 0.32);
        if (!glow) return;
        steps.push({ near: shades(head, trailColour), far: shades(mix(head, page, FAR_FADE), mix(trailColour, page, FAR_FADE)), glow });
      }
      screen = makeScreen(found);
      cup = makeCup(found);
      cupPattern = cup ? ctx.createPattern(cup, 'repeat-x') : null;
      glowAbove = makeGlowAbove();
      dropSprite = makeDrop();
    };

    /** The colour step for a column's row: how far down it is, from the top to its layer's floor. */
    const stepFor = (found: RainModel, layer: RainLayer, row: number): Step => {
      const floor = found.floorOf(layer);
      const share = floor > 1 ? row / (floor - 1) : 0;
      return steps[Math.min(STEPS - 1, Math.max(0, Math.round(share * (STEPS - 1))))]!;
    };

    const shadesOf = (step: Step, layer: RainLayer): Shades => (layer === NEAR ? step.near : step.far);

    /** The middle of a column's cell, px. */
    const cellY = (found: RainModel, column: RainColumn, row: number) => rowY(found.layout, row, column.layer) + column.layer.row / 2;

    /** A glyph in its cell, centred; `on` is the context, `font` the font it holds now (returned, maybe changed). */
    const glyphAt = (on: CanvasRenderingContext2D, font: string, glyph: string, x: number, y: number, size: number, colour: string, detail: string, at = scale): string => {
      if (glyph === '' || glyph === ' ') return font;
      if (isSymbol(glyph)) {
        const unit = size * 0.92 * at;
        on.setTransform(unit, 0, 0, unit, x * at, y * at);
        paintGlyph(on, glyph, colour, detail);
        return font;
      }
      on.setTransform(at, 0, 0, at, 0, 0);
      const wanted = `700 ${size}px ${FAMILY}`;
      if (font !== wanted) on.font = wanted;
      on.fillStyle = colour;
      on.fillText(glyph, x, y + size * 0.36);
      return wanted;
    };

    /** The lowest edge, px, the trail can reach: the deepest of the layers' floors. */
    const trailBottom = (found: RainModel) => Math.max(rowY(found.layout, found.floorOf(NEAR), NEAR), rowY(found.layout, found.floorOf(FAR), FAR));

    /** The trail: fade it, paint the cells the heads have left, wipe the ends. */
    const drawTrail = (found: RainModel) => {
      const at = found.layout;
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (blank) {
        trailCtx.clearRect(0, 0, trail.width, trail.height);
        pendingMs = 0;
      } else if (pendingMs >= FADE_EVERY_MS) {
        const fade = 1 - Math.pow(1 - FADE_PER_FRAME, pendingMs / FRAME_MS);
        pendingMs = 0;
        if (fade > 0.0005) {
          trailCtx.globalCompositeOperation = 'destination-out';
          trailCtx.globalAlpha = fade;
          trailCtx.fillStyle = '#000000';
          // Only the rows between the screen and the cup ever hold any.
          const from = Math.floor(at.band * trailScale);
          trailCtx.fillRect(0, from, trail.width, Math.ceil(trailBottom(found) * trailScale) - from + 1);
          trailCtx.globalCompositeOperation = 'source-over';
          trailCtx.globalAlpha = 1;
        }
      }
      trailCtx.setTransform(trailScale, 0, 0, trailScale, 0, 0);
      // The cup has risen over a layer's row: what was painted in it is under the coffee now, and goes.
      for (const layer of [NEAR, FAR]) {
        const floor = found.floorOf(layer);
        if (floor < (clearedFloors.get(layer) ?? floor)) {
          for (const column of found.columns) {
            if (column.layer === layer) trailCtx.clearRect(column.x - layer.cell / 2, rowY(at, floor, layer), layer.cell, height);
          }
        }
        clearedFloors.set(layer, floor);
      }
      trailCtx.textAlign = 'center';
      trailCtx.textBaseline = 'alphabetic';
      for (const event of found.takeEvents()) {
        const before = painted[event.col];
        const column = found.columns[event.col]!;
        if (before && !before.bright) {
          // The head moves on: its cell turns to the trail. A word's letter stays lit instead (drawLetters).
          const shades = shadesOf(stepFor(found, column.layer, before.row), column.layer);
          trailFont = glyphAt(trailCtx, trailFont, before.glyph, column.x, cellY(found, column, before.row), column.size, shades.trail, shades.trailDetail, trailScale);
        }
        painted[event.col] = event.glyph ? { row: event.row, glyph: event.glyph, bright: event.bright } : null;
        if (event.erase >= 0) {
          trailCtx.setTransform(trailScale, 0, 0, trailScale, 0, 0);
          trailCtx.clearRect(column.x - column.layer.cell / 2, rowY(at, event.erase, column.layer), column.layer.cell, column.layer.row);
        }
      }
    };

    /** The cup: the crema's moving surface over the coffee, its lit line, and the light off it. */
    const drawCup = (found: RainModel) => {
      const at = found.layout;
      const time = found.time;
      const level = levelY(at, time);
      if (glowAbove) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(glowAbove, 0, 0, 1, glowAbove.height, 0, Math.round((level - 46) * scale), canvas.width, glowAbove.height);
      }
      const top = Math.round((level - cupAbove) * scale);
      ctx.setTransform(1, 0, 0, 1, 0, top);
      ctx.beginPath();
      const surface: number[] = [];
      for (let x = 0; x <= width + WAVE_STEP; x += WAVE_STEP) surface.push(surfaceAt(at, x, time));
      surface.forEach((y, i) => {
        const px = i * WAVE_STEP * scale;
        const py = y * scale - top;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      const bottom = canvas.height - top + 1;
      ctx.lineTo((surface.length - 1) * WAVE_STEP * scale, bottom);
      ctx.lineTo(0, bottom);
      ctx.closePath();
      if (cupPattern) {
        ctx.fillStyle = cupPattern;
        ctx.fill();
      }
      // The surface's lit line.
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.beginPath();
      surface.forEach((y, i) => {
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * WAVE_STEP, y);
      });
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(css(SURFACE_LINE), 0.85);
      ctx.stroke();
    };

    /** The heads and drops close above the cup light the crema under them: a soft warm patch, brighter as they near it. */
    const drawReflections = (found: RainModel) => {
      const glow = steps[STEPS - 1]?.glow;
      if (!glow) return;
      const at = found.layout;
      const light = (x: number, closeness: number, size: number) => {
        if (closeness <= 0) return;
        const w = REFLECTION[0] * size * scale;
        const h = REFLECTION[1] * size * scale;
        const y = (surfaceAt(at, x, found.time) + 2.5 * size) * scale;
        ctx.globalAlpha = Math.min(1, closeness) * Math.min(1, closeness) * (size < 1 ? FAR_GLOW : 0.85);
        ctx.drawImage(glow, x * scale - w / 2, y - h / 2, w, h);
      };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const column of found.columns) {
        if (column.row < 0 || column.glyph === '') continue;
        const above = found.floorOf(column.layer) - column.y;
        if (above < REFLECTION_ROWS) light(column.x, 1 - above / REFLECTION_ROWS, column.layer === NEAR ? 1 : FAR.row / NEAR.row);
      }
      for (const drop of found.drops) light(drop.x, 1 - (surfaceAt(at, drop.x, found.time) - drop.y) / (REFLECTION_ROWS * NEAR.row), drop.size);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    /** The rings on the crema, the droplets of the splashes, and the drops on their way in. */
    const drawSplashes = (found: RainModel) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineWidth = 1.1;
      // Each ring a trough in shadow and its crest lit just above it: one shows on the crema, the other on the page.
      const trough = css(RIPPLE_TROUGH);
      const crest = css(RIPPLE);
      for (const ripple of found.ripples) {
        const { spread, alpha } = rippleAt(ripple.age);
        if (alpha <= 0.01) continue;
        const rx = 1.5 + ripple.reach * spread;
        const ry = 0.8 + rx * 0.2;
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = trough;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y + 2.2, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.9;
        ctx.strokeStyle = crest;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y + 1.1, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(DROPLET);
      for (const droplet of found.droplets) {
        ctx.beginPath();
        ctx.arc(droplet.x, droplet.y, droplet.size, 0, Math.PI * 2);
        ctx.fill();
      }
      const last = steps[STEPS - 1];
      if (dropSprite && last) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (const drop of found.drops) {
          const x = drop.x * scale;
          const y = drop.y * scale;
          const glowSize = last.glow.width * drop.size;
          ctx.globalAlpha = drop.size < 1 ? FAR_GLOW + 0.15 : 1;
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(last.glow, Math.round(x - glowSize / 2), Math.round(y - glowSize / 2), glowSize, glowSize);
          ctx.globalCompositeOperation = 'source-over';
          const w = dropSprite.width * drop.size;
          const h = dropSprite.height * drop.size;
          ctx.drawImage(dropSprite, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
        }
        ctx.globalAlpha = 1;
      }
    };

    /** The heads, each with its glow: the far ones first, smaller and fainter. */
    const drawHeads = (found: RainModel) => {
      const showing = (column: RainColumn) => column.row >= 0 && column.row < found.floorOf(column.layer);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const layer of [FAR, NEAR]) {
        const size = layer === NEAR ? 1 : FAR.row / NEAR.row;
        ctx.globalAlpha = layer === NEAR ? 1 : FAR_GLOW;
        for (const column of found.columns) {
          if (column.layer !== layer || !showing(column) || column.glyph === '') continue;
          const glow = stepFor(found, layer, column.row).glow;
          const glowSize = glow.width * size;
          ctx.drawImage(glow, Math.round(column.x * scale - glowSize / 2), Math.round(cellY(found, column, column.row) * scale - glowSize / 2), glowSize, glowSize);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const layer of [FAR, NEAR]) {
        for (const column of found.columns) {
          if (column.layer !== layer || !showing(column)) continue;
          const shades = shadesOf(stepFor(found, layer, column.row), layer);
          mainFont = glyphAt(ctx, mainFont, column.glyph, column.x, cellY(found, column, column.row), column.size, shades.head, shades.headDetail);
        }
      }
    };

    /** The letters of words, lit a while where their heads spelled them, glowing a little. */
    const drawLetters = (found: RainModel) => {
      const lit = found.letters.filter((letter) => {
        const column = found.columns[letter.col]!;
        // Its head is still on it, and draws it.
        return !(column.row === letter.row && column.bright);
      });
      if (lit.length === 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const letter of lit) {
        const column = found.columns[letter.col]!;
        const glow = stepFor(found, column.layer, letter.row).glow;
        ctx.globalAlpha = letterAlpha(letter.age) * 0.6;
        ctx.drawImage(glow, Math.round(column.x * scale - glow.width / 2), Math.round(cellY(found, column, letter.row) * scale - glow.height / 2));
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const letter of lit) {
        const column = found.columns[letter.col]!;
        const shades = shadesOf(stepFor(found, column.layer, letter.row), column.layer);
        ctx.globalAlpha = letterAlpha(letter.age);
        mainFont = glyphAt(ctx, mainFont, letter.glyph, column.x, cellY(found, column, letter.row), letter.size, shades.head, shades.headDetail);
      }
      ctx.globalAlpha = 1;
    };

    /** A bead of water swelling at its hole as a column is about to fall, and glinting there while its head leaves. */
    const drawBeads = (found: RainModel) => {
      const first = steps[0];
      if (!first) return;
      const at = found.layout;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const column of found.columns) {
        const near = column.layer === NEAR;
        // Swelling over the last two rows of its wait, then going with the head over its first two.
        const swell = column.y < 0 ? 1 + column.y / 2 : 1 - column.y / 2;
        if (swell <= 0 || column.y < -2 || column.y > 2) continue;
        const size = near ? 1 : 0.7;
        const y = at.band - (near ? HOLE_ROWS[0].up : HOLE_ROWS[1].up) + 1.2 * size;
        ctx.globalAlpha = (near ? 0.9 : 0.55) * swell;
        ctx.fillStyle = near ? first.near.head : first.far.head;
        ctx.beginPath();
        ctx.ellipse(column.x, y + 1.2 * swell * size, (1.3 + 1.2 * swell) * size, (1.1 + 1.9 * swell) * size, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      if (!model || !layout || !ready() || steps.length === 0) return;
      // Back after a while without frames (the canvas too small to draw on meanwhile): what the trail held has faded.
      if (pendingMs > TRAIL_GONE_MS) {
        blank = true;
        painted = model.columns.map(() => null);
      }
      drawTrail(model);
      blank = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // A copy, not a blend, of only the rows the trail can be in: the fastest way to put it down, and it
      // clears the rest of last frame with it (the screen and the cup are drawn again over it).
      const from = Math.floor(layout.band * trailScale);
      const to = Math.min(trail.height, Math.ceil(trailBottom(model) * trailScale) + 1);
      const below = Math.floor((to * scale) / trailScale);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(trail, 0, from, trail.width, to - from, 0, (from * scale) / trailScale, canvas.width, below - (from * scale) / trailScale);
      ctx.globalCompositeOperation = 'source-over';
      // WebKit's copy leaves what is outside the image: clear under it, down to the cup (the screen covers above).
      ctx.clearRect(0, below, canvas.width, canvas.height - below);
      drawLetters(model);
      drawHeads(model);
      drawCup(model);
      drawReflections(model);
      drawSplashes(model);
      if (screen) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(screen, 0, 0);
      }
      drawBeads(model);
    };

    /** A new model for this size, from `at` ms on: the same seed gives the same rain at the same size. */
    const start = (at = 0) => {
      layout = layoutFor(width, height);
      model = createRainModel(env.seed, layout, env.numbers, at);
      painted = model.columns.map(() => null);
      clearedFloors.clear();
      blank = true;
      pendingMs = 0;
    };

    /** What the scene (the layout, the model, the trail and the sprites) was built for: empty before the first size. */
    let built = '';
    const sizeKey = () => `${width}x${height}@${scale}`;
    /** Whether the scene is built for the canvas's size now, and so can be drawn. */
    const ready = () => built !== '' && built === sizeKey();

    /**
     * Plays the rain on until `done` says so, a step of `stepMs` at a time, drawing no frame on the way, then
     * paints its trail as it stands, each cell a head has left that no wipe has taken since, at the opacity
     * the fade has left it, and the frame over it. The picture the frames would have built, for a sliver of
     * their cost: a frame's fade of the whole trail is most of what one costs where a canvas is drawn
     * without the GPU, and a still or a new size would pay for dozens at once.
     */
    const playTo = (done: (found: RainModel) => boolean, stepMs: (found: RainModel) => number = () => FRAME_MS) => {
      const found = model!;
      const cells = new Map<number, TrailCell>();
      const heads = painted.slice();
      const cellOf = (col: number, row: number) => col * 65_536 + row;
      while (!done(found)) {
        found.step(stepMs(found));
        for (const event of found.takeEvents()) {
          const before = heads[event.col];
          if (before && !before.bright) cells.set(cellOf(event.col, before.row), { col: event.col, row: before.row, glyph: before.glyph, at: found.time });
          heads[event.col] = event.glyph ? { row: event.row, glyph: event.glyph, bright: event.bright } : null;
          if (event.erase >= 0) cells.delete(cellOf(event.col, event.erase));
        }
      }
      painted = heads;
      trailCtx.setTransform(1, 0, 0, 1, 0, 0);
      trailCtx.clearRect(0, 0, trail.width, trail.height);
      trailCtx.textAlign = 'center';
      trailCtx.textBaseline = 'alphabetic';
      for (const cell of cells.values()) {
        const column = found.columns[cell.col]!;
        const alpha = Math.pow(1 - FADE_PER_FRAME, (found.time - cell.at) / FRAME_MS);
        // Faded to nothing, or under the coffee since the cup rose over it.
        if (alpha < 0.02 || cell.row >= found.floorOf(column.layer)) continue;
        const shades = shadesOf(stepFor(found, column.layer, cell.row), column.layer);
        trailCtx.globalAlpha = alpha;
        trailFont = glyphAt(trailCtx, trailFont, cell.glyph, column.x, cellY(found, column, cell.row), column.size, shades.trail, shades.trailDetail, trailScale);
      }
      trailCtx.globalAlpha = 1;
      for (const layer of [NEAR, FAR]) clearedFloors.set(layer, found.floorOf(layer));
      blank = false;
      pendingMs = 0;
      draw();
    };

    /** The still once painted at a size, and the size: every still there is the same picture, so it is copied, not played again. */
    let stillPicture: HTMLCanvasElement | null = null;
    let stillOf = '';

    /**
     * The scene for the size now. A rain already falling goes on at the time it had got to: the cup as full,
     * the rain laid out afresh and played a few seconds, so it falls as it was (a held picture is played to
     * its moment again).
     */
    const build = () => {
      const carried = model ? model.time : 0;
      built = sizeKey();
      trailScale = Math.min(1, scale);
      trail.width = Math.max(1, Math.round(width * trailScale));
      trail.height = Math.max(1, Math.round(height * trailScale));
      trailFont = '';
      release([stillPicture]);
      stillPicture = null;
      stillOf = '';
      const replay = Math.min(carried, REPLAY_MS);
      start(carried - replay);
      if (layout) makeSprites(layout);
      if (replay > 0) {
        const end = carried;
        playTo(
          (found) => found.time >= end - 1e-6,
          (found) => Math.min(FRAME_MS, end - found.time),
        );
      }
    };

    // Figtree is most likely here already (CafAI sets everything in it); if not, ask for the weight the letters use.
    if (doc.fonts) void doc.fonts.load(`700 20px ${FAMILY}`, 'ESPRESSO 0123456789').catch(() => undefined);

    const instance: SaverInstance = {
      step(dtMs) {
        if (!model) return;
        model.step(dtMs);
        pendingMs += dtMs;
      },
      draw,
      resize(nextWidth, nextHeight, nextScale) {
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        // A new size resets the canvas's context, and with it the font it held.
        mainFont = '';
        // Too small to draw on (a canvas not laid out yet, or a screenshot's passing resize to 1x1): the scene
        // waits as it is for a size it can fall on (D-RAIN-6).
        if (width < MIN_WIDTH || height < MIN_HEIGHT) return;
        // Back at the size it was built for: the rain goes on as it was, painted again at once, as resizing
        // the canvas cleared it.
        if (sizeKey() === built) {
          draw();
          return;
        }
        build();
      },
      still() {
        if (!ready() || !layout) return;
        if (stillPicture && stillOf === built) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'copy';
          ctx.drawImage(stillPicture, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          return;
        }
        // The rain falls to the still's moment (D-RAIN-3) and is painted there, once for this size.
        start();
        playTo(isStillMoment);
        const kept = stillPicture ?? doc.createElement('canvas');
        kept.width = canvas.width;
        kept.height = canvas.height;
        const keep = kept.getContext('2d');
        if (!keep) return;
        keep.drawImage(canvas, 0, 0);
        stillPicture = kept;
        stillOf = built;
      },
      dispose() {
        canvas.style.backgroundColor = hostBackground;
        releaseSprites();
        release([trail, stillPicture]);
        stillPicture = null;
        stillOf = '';
        model = null;
        layout = null;
        painted = [];
        built = '';
      },
    };
    return instance;
  },
};

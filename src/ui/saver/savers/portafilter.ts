/**
 * Bouncing Portafilter, after the DVD logo's bounce (D227, D255,
 * D256): a logo, a portafilter from the side over "CafAI" over a flat
 * oval with ESPRESSO cut out of it (portafilterLogo.ts), drifts about and
 * bounces off the edges, lit softly from above and glowing a little on the
 * page in its own colour. Each wall it meets turns it one roast along, green
 * to French, crossing over in 300 ms; a corner throws a dozen beans and a
 * ring of light out of it and shows "Corner 2" by the logo for 3 s. The bounce
 * itself is portafilterModel.ts; this only paints it, with the dark palette
 * and the roasts' colours, from sprites drawn once a size (the logo and its
 * glow in each roast, the ring), and the burst's few beans as they fly, lit
 * from the screen's upper left however they turn.
 */
import { parseHex } from '../../color.ts';
import type { CanvasSaver, SaverInstance } from '../types.ts';
import { drawBean } from './beanShape.ts';
import { CAPTION, FAMILY, layoutLogo, paintLogo, TITLE, type LogoLayout } from './portafilterLogo.ts';
import {
  BADGE_ASPECT,
  burstAlpha,
  BURST_MS,
  cornerLabelAlpha,
  createPortafilterModel,
  MIN_SCREEN,
  ringAt,
  roastBetween,
  shownTone,
} from './portafilterModel.ts';
import { ROASTS } from './roasts.ts';

/** The glow reaches this far out from the logo, as a share of its width. */
const GLOW_REACH = 0.2;
/** How strongly the glow shows. */
const GLOW_ALPHA = 0.68;
/** A burst's beans grow to this many times their length over the burst, as they come out at you. */
const BEAN_GROWTH = 1.3;
/** The ring of light spreads this far, as a share of the screen's shorter side. */
const RING_REACH = 0.55;
/** The ring's warm light. */
const RING_LIGHT = '#fff1d6';

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The logo in one roast: its sprite, and its glow's. */
interface Dressed {
  logo: HTMLCanvasElement;
  glow: HTMLCanvasElement;
}

export const portafilter: CanvasSaver = {
  id: 'portafilter',
  label: 'Bouncing Portafilter',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const doc = canvas.ownerDocument;
    const { palette } = env;
    let model = createPortafilterModel(env.seed);
    let width = 0;
    let height = 0;
    let scale = 1;
    let layout: LogoLayout | null = null;
    let dressed: Dressed[] = [];
    let ring: HTMLCanvasElement | null = null;
    let flash: HTMLCanvasElement | null = null;
    let disposed = false;
    let labelFont = '';
    let labelSize = 13;

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

    const releaseSprites = () => {
      release([...dressed.flatMap((one) => [one.logo, one.glow]), ring, flash]);
      dressed = [];
      ring = null;
      flash = null;
    };

    /** The logo in a roast's colour, a pixel of room round it. */
    const makeLogo = (found: LogoLayout, colour: string): HTMLCanvasElement | null => {
      const w = found.forWidth;
      const made = sprite(w * scale + 2, w * BADGE_ASPECT * scale + 2);
      if (!made) return null;
      const [logo, g] = made;
      g.setTransform(scale, 0, 0, scale, 1, 1);
      paintLogo(g, found, colour, palette.background);
      return logo;
    };

    /** The logo's shape blurred, in its colour: a soft light on the page around it. */
    const makeGlow = (found: LogoLayout, colour: string): HTMLCanvasElement | null => {
      const w = found.forWidth;
      const pad = w * GLOW_REACH;
      const made = sprite((w + 2 * pad) * scale, (w * BADGE_ASPECT + 2 * pad) * scale);
      if (!made) return null;
      const [glow, g] = made;
      // Only the shadow lands on the sprite: the shape is drawn far off it, the shadow brought back.
      const away = (w + 2 * pad) * 4 * scale;
      g.shadowColor = rgba(colour, 0.85);
      g.shadowBlur = pad * 0.75 * scale;
      g.shadowOffsetX = away;
      g.setTransform(scale, 0, 0, scale, pad * scale - away, pad * scale);
      paintLogo(g, found, colour, colour, true);
      return glow;
    };

    /** A soft ring of warm light, drawn scaled up as it spreads. */
    const makeRing = (): HTMLCanvasElement | null => {
      const size = 256;
      const made = sprite(size, size);
      if (!made) return null;
      const [made2, g] = made;
      const middle = size / 2;
      const light = g.createRadialGradient(middle, middle, 0, middle, middle, middle);
      light.addColorStop(0, rgba(RING_LIGHT, 0));
      light.addColorStop(0.6, rgba(RING_LIGHT, 0));
      light.addColorStop(0.8, rgba(RING_LIGHT, 0.35));
      light.addColorStop(0.87, rgba(RING_LIGHT, 0.85));
      light.addColorStop(0.92, rgba(RING_LIGHT, 0.35));
      light.addColorStop(1, rgba(RING_LIGHT, 0));
      g.fillStyle = light;
      g.fillRect(0, 0, size, size);
      return made2;
    };

    /** The flash in the corner as the ring leaves it: a soft round light, brightest in the middle. */
    const makeFlash = (): HTMLCanvasElement | null => {
      const size = 128;
      const made = sprite(size, size);
      if (!made) return null;
      const [made2, g] = made;
      const middle = size / 2;
      const light = g.createRadialGradient(middle, middle, 0, middle, middle, middle);
      light.addColorStop(0, rgba(RING_LIGHT, 0.7));
      light.addColorStop(0.3, rgba(RING_LIGHT, 0.3));
      light.addColorStop(0.6, rgba(RING_LIGHT, 0.08));
      light.addColorStop(1, rgba(RING_LIGHT, 0));
      g.fillStyle = light;
      g.fillRect(0, 0, size, size);
      return made2;
    };

    const makeSprites = () => {
      releaseSprites();
      if (model.w <= 0) return;
      layout = layoutLogo(ctx, model.w);
      for (const roast of ROASTS) {
        const logo = makeLogo(layout, roast.badge);
        const glow = makeGlow(layout, roast.badge);
        if (!logo || !glow) return;
        dressed.push({ logo, glow });
      }
      ring = makeRing();
      flash = makeFlash();
      labelSize = Math.max(13, model.w * 0.085);
      labelFont = `600 ${labelSize}px ${FAMILY}`;
    };

    /** The ring of light a corner throws, spreading out of it, and the flash it leaves. */
    const drawRing = () => {
      const { spread, alpha } = ringAt(model.cornerAge);
      if (alpha <= 0.005) return;
      const shorter = Math.min(width, height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      if (flash) {
        const glow = shorter * 0.3 * (0.6 + 0.4 * spread);
        ctx.globalAlpha = alpha * (1 - spread);
        ctx.drawImage(flash, model.cornerX - glow, model.cornerY - glow, glow * 2, glow * 2);
      }
      if (ring) {
        const radius = (0.05 + 0.95 * spread) * RING_REACH * shorter;
        ctx.globalAlpha = alpha;
        ctx.drawImage(ring, model.cornerX - radius, model.cornerY - radius, radius * 2, radius * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    /**
     * The corner's beans flying out at you: growing a little, solid for half their time, then fading. Drawn
     * as they are, each frame of a burst (a dozen, for 1.2 s), into the turned context: drawBean keeps the
     * key light at the screen's upper left however a bean spins, where a turned sprite would turn its light.
     */
    const drawBeans = () => {
      for (const bean of model.burst) {
        const roast = ROASTS[bean.roast];
        if (!roast) continue;
        const grown = 1 + (BEAN_GROWTH - 1) * Math.min(1, bean.age / BURST_MS);
        const cos = Math.cos(bean.angle) * scale;
        const sin = Math.sin(bean.angle) * scale;
        ctx.setTransform(cos, sin, -sin, cos, bean.x * scale, bean.y * scale);
        ctx.globalAlpha = Math.min(1, 2 * burstAlpha(bean.age));
        drawBean(ctx, bean.length * grown, roast, 'front');
      }
      ctx.globalAlpha = 1;
    };

    /** The logo's glow and the logo, crossing from one roast to the next. */
    const drawLogo = () => {
      const { from, to, mix } = roastBetween(shownTone(model));
      const first = dressed[from];
      const second = dressed[to];
      if (!first || !second) return;
      const pad = model.w * GLOW_REACH;
      // The logo's corner lands on a whole device pixel, so its edges stay sharp as it drifts.
      const left = Math.round(model.x * scale);
      const top = Math.round(model.y * scale);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = GLOW_ALPHA * (1 - mix);
      ctx.drawImage(first.glow, left - Math.round(pad * scale), top - Math.round(pad * scale));
      if (mix > 0) {
        ctx.globalAlpha = GLOW_ALPHA * mix;
        ctx.drawImage(second.glow, left - Math.round(pad * scale), top - Math.round(pad * scale));
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(first.logo, left - 1, top - 1);
      if (mix > 0) {
        ctx.globalAlpha = mix;
        ctx.drawImage(second.logo, left - 1, top - 1);
        ctx.globalAlpha = 1;
      }
    };

    const drawLabel = () => {
      const alpha = cornerLabelAlpha(model.cornerAge);
      if (model.corners === 0 || alpha <= 0) return;
      const gap = model.w * 0.05;
      // Under the logo, or above it where the screen's edge leaves no room.
      const below = model.y + model.h + gap + labelSize * 1.3 <= height;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.ink;
      ctx.font = labelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`Corner ${model.corners}`, model.x + model.w / 2, below ? model.y + model.h + gap + labelSize : model.y - gap);
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      // No screen to bounce on (MIN_SCREEN): nothing to draw on either.
      if (width < MIN_SCREEN || height < MIN_SCREEN) return;
      if (!layout || layout.forWidth !== model.w || dressed.length === 0) makeSprites();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawRing();
      drawLogo();
      drawBeans();
      drawLabel();
    };

    // Figtree loads when first asked for, and the logo is measured with it:
    // measure again and paint again once it is here.
    if (doc.fonts) {
      void Promise.all([
        doc.fonts.load(`italic 800 40px ${FAMILY}`, TITLE),
        doc.fonts.load(`700 24px ${FAMILY}`, CAPTION),
        doc.fonts.load(`600 16px ${FAMILY}`, 'Corner 0123456789'),
      ])
        .then(() => {
          if (disposed) return;
          layout = null;
          draw();
        })
        .catch(() => undefined);
    }

    const instance: SaverInstance = {
      step(dtMs) {
        model.step(dtMs);
      },
      draw,
      resize(nextWidth, nextHeight, nextScale) {
        width = nextWidth;
        height = nextHeight;
        // The sprites are drawn at the backing scale: a new one draws them again (a new width does, in draw).
        if (nextScale !== scale) layout = null;
        scale = nextScale;
        // A size too small to bounce on changes nothing in the model (MIN_SCREEN, D257), and is not drawn on; back
        // at a size, the logo goes on where it was, painted again at once, as resizing the canvas cleared it.
        model.resize(width, height);
        draw();
      },
      still() {
        model = createPortafilterModel(env.seed);
        model.resize(width, height);
        draw();
      },
      dispose() {
        disposed = true;
        releaseSprites();
        layout = null;
      },
    };
    return instance;
  },
};

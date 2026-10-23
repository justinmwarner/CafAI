/**
 * Bouncing Portafilter, after the DVD logo's bounce (D-SAVER-5): a badge,
 * "CafAI" in Figtree over a flat oval with ESPRESSO cut out of it in the page's
 * colour, drifts about and bounces off the edges. Each wall it meets turns it
 * one roast along, green to French; a corner throws a dozen beans and shows
 * "Corner 2" by the badge for 3 s. The bounce itself is portafilterModel.ts;
 * this only paints it, with the dark palette and the roasts' colours.
 */
import type { CanvasSaver, SaverInstance } from '../types.ts';
import { drawBean } from './beanShape.ts';
import { BADGE_ASPECT, burstAlpha, cornerLabelAlpha, createPortafilterModel } from './portafilterModel.ts';
import { ROASTS } from './roasts.ts';

const FAMILY = '"Figtree", system-ui, sans-serif';
const TITLE = 'CafAI';
const CAPTION = 'ESPRESSO';

/** Where everything sits inside a badge `forWidth` px wide: measured with the font, so made again once Figtree has loaded. */
interface Layout {
  forWidth: number;
  titleFont: string;
  titleX: number;
  titleBaseline: number;
  ovalY: number;
  ovalHeight: number;
  captionFont: string;
  captionBaseline: number;
  captionLetters: { letter: string; x: number }[];
  labelFont: string;
  labelSize: number;
}

const sum = (numbers: number[]) => numbers.reduce((total, next) => total + next, 0);

function layoutBadge(ctx: CanvasRenderingContext2D, width: number): Layout {
  const ovalHeight = width / 4;
  const ovalY = width * BADGE_ASPECT - ovalHeight;

  // Measured left-aligned, whatever the last paint left the context at.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // "CafAI", sized so that its ink spans the badge, standing just above the oval.
  const probe = 100;
  ctx.font = `italic 800 ${probe}px ${FAMILY}`;
  const probeBox = ctx.measureText(TITLE);
  const probeInk = probeBox.actualBoundingBoxLeft + probeBox.actualBoundingBoxRight;
  const titleSize = probeInk > 0 ? (probe * width) / probeInk : width * 0.38;
  const titleFont = `italic 800 ${titleSize}px ${FAMILY}`;
  ctx.font = titleFont;
  const titleBox = ctx.measureText(TITLE);

  // ESPRESSO a letter at a time (Chromium 91's canvas has no letter-spacing), spread over most of the oval.
  const letters = Array.from(CAPTION);
  const target = width * 0.7;
  let captionSize = ovalHeight * 0.5;
  const measure = () => {
    ctx.font = `700 ${captionSize}px ${FAMILY}`;
    return letters.map((letter) => ctx.measureText(letter).width);
  };
  let advances = measure();
  if (sum(advances) > target) {
    captionSize *= target / sum(advances);
    advances = measure();
  }
  const gap = Math.max(0, (target - sum(advances)) / (letters.length - 1));
  let x = (width - sum(advances) - gap * (letters.length - 1)) / 2;
  const captionLetters = letters.map((letter, i) => {
    const placed = { letter, x };
    x += advances[i]! + gap;
    return placed;
  });
  const captionFont = `700 ${captionSize}px ${FAMILY}`;
  ctx.font = captionFont;
  const capHeight = ctx.measureText('E').actualBoundingBoxAscent;

  const labelSize = Math.max(13, width * 0.085);
  return {
    forWidth: width,
    titleFont,
    titleX: titleBox.actualBoundingBoxLeft,
    titleBaseline: ovalY - width * 0.04,
    ovalY,
    ovalHeight,
    captionFont,
    captionBaseline: ovalY + ovalHeight / 2 + capHeight / 2,
    captionLetters,
    labelFont: `600 ${labelSize}px ${FAMILY}`,
    labelSize,
  };
}

export const portafilter: CanvasSaver = {
  id: 'portafilter',
  label: 'Bouncing Portafilter',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const { palette } = env;
    let model = createPortafilterModel(env.seed);
    let width = 0;
    let height = 0;
    let scale = 1;
    let layout: Layout | null = null;
    let disposed = false;

    const drawBurst = () => {
      for (const bean of model.burst) {
        const cos = Math.cos(bean.angle) * scale;
        const sin = Math.sin(bean.angle) * scale;
        ctx.setTransform(cos, sin, -sin, cos, bean.x * scale, bean.y * scale);
        ctx.globalAlpha = burstAlpha(bean.age);
        drawBean(ctx, bean.length, ROASTS[bean.roast]!, 'front');
      }
      ctx.globalAlpha = 1;
    };

    const drawBadge = (found: Layout) => {
      // The badge's corner lands on a whole device pixel, so its edges stay sharp as it drifts.
      ctx.setTransform(scale, 0, 0, scale, Math.round(model.x * scale), Math.round(model.y * scale));
      ctx.fillStyle = ROASTS[model.roast]!.badge;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = found.titleFont;
      ctx.fillText(TITLE, found.titleX, found.titleBaseline);
      ctx.beginPath();
      ctx.ellipse(model.w / 2, found.ovalY + found.ovalHeight / 2, model.w / 2, found.ovalHeight / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.background;
      ctx.font = found.captionFont;
      for (const { letter, x } of found.captionLetters) ctx.fillText(letter, x, found.captionBaseline);
    };

    const drawLabel = (found: Layout) => {
      const alpha = cornerLabelAlpha(model.cornerAge);
      if (model.corners === 0 || alpha <= 0) return;
      const gap = model.w * 0.05;
      // Under the badge, or above it where the screen's edge leaves no room.
      const below = model.y + model.h + gap + found.labelSize * 1.3 <= height;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.ink;
      ctx.font = found.labelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`Corner ${model.corners}`, model.x + model.w / 2, below ? model.y + model.h + gap + found.labelSize : model.y - gap);
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      if (width <= 0 || height <= 0) return;
      if (!layout || layout.forWidth !== model.w) layout = layoutBadge(ctx, model.w);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawBurst();
      drawBadge(layout);
      drawLabel(layout);
    };

    // Figtree loads when first asked for, and the badge is measured with it:
    // measure again and paint again once it is here.
    if (typeof document !== 'undefined' && document.fonts) {
      void Promise.all([
        document.fonts.load(`italic 800 40px ${FAMILY}`, TITLE),
        document.fonts.load(`700 24px ${FAMILY}`, CAPTION),
        document.fonts.load(`600 16px ${FAMILY}`, 'Corner 0123456789'),
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
        scale = nextScale;
        model.resize(width, height);
        layout = null;
      },
      still() {
        model = createPortafilterModel(env.seed);
        if (width > 0) model.resize(width, height);
        draw();
      },
      dispose() {
        disposed = true;
        layout = null;
      },
    };
    return instance;
  },
};

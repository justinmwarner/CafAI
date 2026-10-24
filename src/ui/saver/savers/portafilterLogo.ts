/**
 * The Bouncing Portafilter's logo (D-RAIN-4): a portafilter from the side,
 * drawn in code as a logo mark (its handle, the group ring with its two lugs,
 * the basket and the double spout), over "CafAI" in Figtree, extra bold and
 * italic, over a flat oval with ESPRESSO cut out of it: the DVD logo's layout,
 * never its mark. The whole logo in one colour, a satin light from above
 * giving it a little volume. Measured with the font, so laid out again once
 * Figtree has loaded; drawn once a colour into a sprite (portafilter.ts).
 */
import { hexToOklab, mixOklab, oklabToRgb } from '../../color.ts';
import { BADGE_ASPECT } from './portafilterModel.ts';

export const FAMILY = '"Figtree", system-ui, sans-serif';
export const TITLE = 'CafAI';
export const CAPTION = 'ESPRESSO';

/** The logo's parts, top to bottom, in shares of its width: the mark (its height over its width), the gap under it, the oval. */
const MARK_WIDTH = 0.86;
const MARK_ASPECT = 0.35;
const MARK_GAP = 0.045;
const OVAL_HEIGHT = 0.25;

/** Where everything sits inside a logo `forWidth` px wide. */
export interface LogoLayout {
  forWidth: number;
  titleFont: string;
  titleX: number;
  titleBaseline: number;
  /** The title's ink, top and bottom. */
  titleTop: number;
  titleBottom: number;
  ovalY: number;
  ovalHeight: number;
  captionFont: string;
  captionBaseline: number;
  captionLetters: { letter: string; x: number }[];
}

const sum = (numbers: number[]) => numbers.reduce((total, next) => total + next, 0);

export function layoutLogo(ctx: CanvasRenderingContext2D, width: number): LogoLayout {
  const height = width * BADGE_ASPECT;
  const ovalHeight = width * OVAL_HEIGHT;
  const ovalY = height - ovalHeight;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // "CafAI", sized so that its ink spans the logo, between the mark and the oval.
  const probe = 100;
  ctx.font = `italic 800 ${probe}px ${FAMILY}`;
  const probeBox = ctx.measureText(TITLE);
  const probeInk = probeBox.actualBoundingBoxLeft + probeBox.actualBoundingBoxRight;
  const room = ovalY - width * (MARK_WIDTH * MARK_ASPECT + MARK_GAP) - width * 0.035;
  let titleSize = probeInk > 0 ? (probe * width * 0.97) / probeInk : width * 0.38;
  const probeTall = probeBox.actualBoundingBoxAscent + probeBox.actualBoundingBoxDescent;
  if (probeTall > 0) titleSize = Math.min(titleSize, (probe * room) / probeTall);
  const titleFont = `italic 800 ${titleSize}px ${FAMILY}`;
  ctx.font = titleFont;
  const titleBox = ctx.measureText(TITLE);
  const inkWidth = titleBox.actualBoundingBoxLeft + titleBox.actualBoundingBoxRight;
  const titleBaseline = ovalY - width * 0.035 - titleBox.actualBoundingBoxDescent;

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

  return {
    forWidth: width,
    titleFont,
    titleX: (width - inkWidth) / 2 + titleBox.actualBoundingBoxLeft,
    titleBaseline,
    titleTop: titleBaseline - titleBox.actualBoundingBoxAscent,
    titleBottom: titleBaseline + titleBox.actualBoundingBoxDescent,
    ovalY,
    ovalHeight,
    captionFont,
    captionBaseline: ovalY + ovalHeight / 2 + capHeight / 2,
    captionLetters,
  };
}

/**
 * The portafilter's parts as one path, in a box `w` wide whose top left is the
 * origin: the group ring and its lugs, the basket under it, the double spout,
 * and the handle out to the right.
 */
function markPath(w: number): Path2D {
  const u = (n: number) => n * w;
  const path = new Path2D();
  const rounded = (x0: number, y0: number, x1: number, y1: number, r: number) => {
    path.moveTo(u(x0 + r), u(y0));
    path.lineTo(u(x1 - r), u(y0));
    path.arcTo(u(x1), u(y0), u(x1), u(y0 + r), u(r));
    path.lineTo(u(x1), u(y1 - r));
    path.arcTo(u(x1), u(y1), u(x1 - r), u(y1), u(r));
    path.lineTo(u(x0 + r), u(y1));
    path.arcTo(u(x0), u(y1), u(x0), u(y1 - r), u(r));
    path.lineTo(u(x0), u(y0 + r));
    path.arcTo(u(x0), u(y0), u(x0 + r), u(y0), u(r));
    path.closePath();
  };
  // The group ring, and its two lugs: wedges reaching out from its top.
  rounded(0.06, 0, 0.4, 0.052, 0.01);
  path.moveTo(u(0.062), u(0.005));
  path.lineTo(u(0.03), u(0.011));
  path.quadraticCurveTo(u(0.022), u(0.022), u(0.03), u(0.033));
  path.lineTo(u(0.062), u(0.04));
  path.closePath();
  path.moveTo(u(0.398), u(0.005));
  path.lineTo(u(0.43), u(0.011));
  path.quadraticCurveTo(u(0.438), u(0.022), u(0.43), u(0.033));
  path.lineTo(u(0.398), u(0.04));
  path.closePath();
  // The basket's body under the ring, rounding to its foot.
  path.moveTo(u(0.072), u(0.066));
  path.lineTo(u(0.388), u(0.066));
  path.bezierCurveTo(u(0.388), u(0.15), u(0.33), u(0.205), u(0.23), u(0.205));
  path.bezierCurveTo(u(0.13), u(0.205), u(0.072), u(0.15), u(0.072), u(0.066));
  path.closePath();
  // The double spout: a short stem under the foot, forking into two nozzles that lean out.
  path.moveTo(u(0.207), u(0.2));
  path.lineTo(u(0.253), u(0.2));
  path.lineTo(u(0.253), u(0.226));
  path.lineTo(u(0.3), u(0.274));
  path.lineTo(u(0.3), u(0.296));
  path.lineTo(u(0.268), u(0.296));
  path.lineTo(u(0.268), u(0.284));
  path.lineTo(u(0.23), u(0.247));
  path.lineTo(u(0.192), u(0.284));
  path.lineTo(u(0.192), u(0.296));
  path.lineTo(u(0.16), u(0.296));
  path.lineTo(u(0.16), u(0.274));
  path.lineTo(u(0.207), u(0.226));
  path.closePath();
  // A drop under each nozzle: the shot.
  for (const x of [0.176, 0.284]) {
    path.moveTo(u(x), u(0.312));
    path.bezierCurveTo(u(x + 0.004), u(0.32), u(x + 0.013), u(0.328), u(x + 0.013), u(0.337));
    path.arc(u(x), u(0.337), u(0.013), 0, Math.PI);
    path.bezierCurveTo(u(x - 0.013), u(0.328), u(x - 0.004), u(0.32), u(x), u(0.312));
    path.closePath();
  }
  // The handle: a neck out of the basket, a collar, then the grip, thickening to a round end.
  path.moveTo(u(0.37), u(0.082));
  path.lineTo(u(0.53), u(0.09));
  path.lineTo(u(0.53), u(0.128));
  path.lineTo(u(0.37), u(0.136));
  path.closePath();
  rounded(0.522, 0.074, 0.566, 0.144, 0.01);
  path.moveTo(u(0.574), u(0.086));
  path.bezierCurveTo(u(0.7), u(0.082), u(0.86), u(0.072), u(0.935), u(0.07));
  path.bezierCurveTo(u(0.982), u(0.069), u(1.0), u(0.094), u(1.0), u(0.113));
  path.bezierCurveTo(u(1.0), u(0.134), u(0.982), u(0.158), u(0.935), u(0.158));
  path.bezierCurveTo(u(0.86), u(0.156), u(0.7), u(0.142), u(0.574), u(0.134));
  path.closePath();
  return path;
}

function mix(from: string, to: string, t: number): string {
  const [r, g, b] = oklabToRgb(mixOklab(hexToOklab(from), hexToOklab(to), t));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A satin fill from `top` to `bottom` (px, in the context's space): lit at the top, the colour itself below. */
function satin(ctx: CanvasRenderingContext2D, colour: string, top: number, bottom: number): CanvasGradient {
  const light = ctx.createLinearGradient(0, top, 0, bottom);
  light.addColorStop(0, mix(colour, '#ffffff', 0.42));
  light.addColorStop(0.45, mix(colour, '#ffffff', 0.12));
  light.addColorStop(1, colour);
  return light;
}

/**
 * Paints the logo `layout.forWidth` px wide with its top left at the
 * context's origin, in `colour`; ESPRESSO is cut out in `page`. With `flat`,
 * every part in `colour` alone (the glow's shape).
 */
export function paintLogo(ctx: CanvasRenderingContext2D, layout: LogoLayout, colour: string, page: string, flat = false): void {
  const width = layout.forWidth;
  const markWidth = width * MARK_WIDTH;

  ctx.save();
  ctx.translate((width - markWidth) / 2, 0);
  ctx.fillStyle = flat ? colour : satin(ctx, colour, 0, markWidth * MARK_ASPECT);
  ctx.fill(markPath(markWidth));
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = layout.titleFont;
  ctx.fillStyle = flat ? colour : satin(ctx, colour, layout.titleTop, layout.titleBottom);
  ctx.fillText(TITLE, layout.titleX, layout.titleBaseline);

  ctx.fillStyle = flat ? colour : satin(ctx, colour, layout.ovalY, layout.ovalY + layout.ovalHeight);
  ctx.beginPath();
  ctx.ellipse(width / 2, layout.ovalY + layout.ovalHeight / 2, width / 2, layout.ovalHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (flat) return;
  ctx.fillStyle = page;
  ctx.font = layout.captionFont;
  for (const { letter, x } of layout.captionLetters) ctx.fillText(letter, x, layout.captionBaseline);
}

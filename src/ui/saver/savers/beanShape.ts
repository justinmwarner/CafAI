/**
 * One coffee bean on a canvas (D227), centred on the origin with its
 * long axis along x: an oval of about 1.45:1 with a lighter rim, so the
 * darkest roasts show on the dark page, and on its front a darker S-shaped
 * crease. Beanfield draws these once into sprites; the Bouncing Portafilter's
 * corner burst draws them as they are. Plain canvas calls, nothing newer than
 * Chromium 91 has.
 */
import type { Roast } from './roasts.ts';

/** A bean's length over its width. */
export const BEAN_RATIO = 1.45;

/** The front has the crease; the back is the round side. */
export type BeanSide = 'front' | 'back';

export function drawBean(ctx: CanvasRenderingContext2D, length: number, roast: Roast, side: BeanSide): void {
  const rim = Math.max(1, length * 0.06);
  const rx = length / 2 - rim / 2;
  const ry = length / 2 / BEAN_RATIO - rim / 2;

  // The body: a round gradient squeezed into the oval, lit from one side.
  ctx.save();
  ctx.scale(1, ry / rx);
  const lit = side === 'front' ? -1 : 1;
  const body = ctx.createRadialGradient(lit * rx * 0.28, -rx * 0.3, rx * 0.05, 0, 0, rx * 1.05);
  body.addColorStop(0, roast.highlight);
  body.addColorStop(0.55, roast.body);
  body.addColorStop(1, roast.shade);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The rim, drawn after the body so it is the same width all the way round.
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = rim;
  ctx.strokeStyle = roast.rim;
  ctx.stroke();

  if (side === 'back') return;

  // The crease: an S along the long axis, from one tip to the other.
  const crease = () => {
    ctx.beginPath();
    ctx.moveTo(-0.8 * rx, 0.1 * ry);
    ctx.bezierCurveTo(-0.5 * rx, -0.7 * ry, -0.14 * rx, -0.7 * ry, 0, 0);
    ctx.bezierCurveTo(0.14 * rx, 0.7 * ry, 0.5 * rx, 0.7 * ry, 0.8 * rx, -0.1 * ry);
  };
  const width = Math.max(1, length * 0.075);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  if (length >= 28) {
    // The far lip of the crease catching the light, just under it.
    ctx.save();
    ctx.translate(0, width * 0.75);
    ctx.globalAlpha *= 0.35;
    ctx.strokeStyle = roast.highlight;
    crease();
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = roast.crease;
  crease();
  ctx.stroke();
}

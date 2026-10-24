/**
 * Lava Latte, after the lava lamp (D227, D267-D269): a tall glass
 * of coffee seen from the side, lit from below as a lava lamp is by its bulb,
 * with blobs of cream rising and sinking in it, merging and splitting. The
 * motion and the field are lavaModel.ts; this file lights them.
 *
 * The glass has thickness (an outer and an inner edge, the glass faintly
 * tinted between them, a heavy foot), vertical streaks of light down its
 * sides and a rim seen from a little above. The light under it glows through
 * the foot, turns the bottom of the coffee amber, deepening to espresso
 * toward the top, spills onto the page around the glass and pools on what it
 * stands on. The cream takes it from below: brighter undersides, a soft glow
 * at its thin edges, shaded from the field's slope taken as a normal. The
 * page around, the coffee and the glass are made once at a resize; each frame
 * shades the cream on the field's grid and puts the layers together where the
 * glass has drifted to.
 */
import { oklch, parseHex } from '../../color.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from '../types.ts';
import {
  advanceLava,
  bulbLight,
  CELL,
  createLavaModel,
  drift,
  DRIFT,
  fieldSlope,
  FLOOR,
  GLASS,
  GRID_COLS,
  GRID_LEFT,
  GRID_ROWS,
  GRID_TOP,
  innerHalfWidth,
  ISO,
  smoothstep,
  SURFACE,
  type LavaModel,
} from './lavaModel.ts';

/** The still is the frame at this moment (D227): the blobs are well on their way. */
const STILL_MS = 20_000;

/**
 * The field is worked out on the coarse grid; it is shaded on one three
 * times as fine, each fine pixel taking its value and its slope from the four
 * nearest cells, so the soft edge and the shading are smooth where the grid is
 * coarse, and the canvas does the rest.
 */
const FINE = 3;
const FINE_COLS = GRID_COLS * FINE;
const FINE_ROWS = GRID_ROWS * FINE;

/** For each fine column (or row): the two cells it lies between, and how far toward the second. */
function cellsAround(count: number): { first: Int32Array; second: Int32Array; toward: Float32Array } {
  const fine = count * FINE;
  const first = new Int32Array(fine);
  const second = new Int32Array(fine);
  const toward = new Float32Array(fine);
  for (let i = 0; i < fine; i += 1) {
    const cell = (i + 0.5) / FINE - 0.5;
    const low = Math.floor(cell);
    first[i] = Math.max(0, low);
    second[i] = Math.min(count - 1, low + 1);
    toward[i] = cell - low;
  }
  return { first, second, toward };
}

const COLUMNS = cellsAround(GRID_COLS);
const ROWS = cellsAround(GRID_ROWS);

/** Where the field is cream: softly, from ISO - SOFT_EDGE to ISO + SOFT_EDGE. */
const SOFT_EDGE = 0.045;
/** How steeply the cream's surface turns away where the field falls: its slope a cell, taken as a normal's tilt. */
const RELIEF = 13;

/** The light: the bulb's colour as linear light, warm; and how it comes at the cream, from below and a little in front. */
const BULB_COLOUR = [1, 0.66, 0.34] as const;
const FROM_BELOW = (() => {
  const length = Math.hypot(0, 1, 0.5);
  return [0, 1 / length, 0.5 / length] as const;
})();

/** The cream's own colour, as linear light, and the parts of its light. */
const CREAM = linearOf(oklch(0.94, 0.028, 84));
const CREAM_FILL = 0.28;
const CREAM_BULB = 1.0;
const CREAM_THROUGH = 0.3;
const CREAM_RIM = 0.85;
const CREAM_SHEEN = 0.16;
/** A faint room light from the upper left in front, so a high blob far from the bulb still has a shape. */
const ROOM = (() => {
  const length = Math.hypot(-0.5, -0.7, 0.5);
  return [-0.5 / length, -0.7 / length, 0.5 / length] as const;
})();
const ROOM_HALF = (() => {
  const length = Math.hypot(ROOM[0], ROOM[1], ROOM[2] + 1);
  return [ROOM[0] / length, ROOM[1] / length, (ROOM[2] + 1) / length] as const;
})();
const ROOM_LIGHT = 0.34;
/** The coffee round the cream gives it a little of its own warmth, high or low. */
const COFFEE_BOUNCE = 0.1;

/** The coffee, as the bulb's light goes through it: gold where it is strongest, amber, brown, espresso where none is left. */
const COFFEE_GOLD = linearOf(oklch(0.72, 0.13, 70));
const COFFEE_AMBER = linearOf(oklch(0.52, 0.12, 56));
const COFFEE_BROWN = linearOf(oklch(0.33, 0.07, 48));
const COFFEE_ESPRESSO = linearOf(oklch(0.235, 0.038, 46));

/** The halo the bulb casts on the page around the glass, and the pool on what it stands on: their warm light, at most. */
const HALO = { colour: '#e8954a', strength: 0.26, reach: 340, pool: 0.34 } as const;

/** The glass: its faint tint, its edges' and streaks' light, and the rim seen from a little above (its ellipse this flat). */
const GLASS_TINT = oklch(0.84, 0.025, 190);
const GLASS_EDGE = oklch(0.94, 0.012, 85);
const RIM_TILT = 0.075;
/** The radius of the glass's corners, outside and in, in design units. */
const OUTER_CORNER = 16;
const INNER_CORNER = 9;
/** A thin layer of milk foam on the coffee: a latte. */
const FOAM = 9;
const FOAM_COLOUR = oklch(0.9, 0.03, 82);

/** Room around the glass in its own layers, design units: for the rim above and the light under the foot. */
const MARGIN = 18;
/** The glass mirrored in what it stands on: this faint at its foot, gone this far below it (design units). */
const REFLECTION = 0.3;
const REFLECTION_DEPTH = 56;

type Rgb = readonly [number, number, number];

function linearOf(hex: string): Rgb {
  const [r, g, b] = parseHex(hex);
  const one = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [one(r), one(g), one(b)];
}

/** Linear light 0-2 to an sRGB byte, through a table. */
const ENCODE_TOP = 2;
const ENCODE_SIZE = 4096;
const ENCODE_SCALE = (ENCODE_SIZE - 1) / ENCODE_TOP;
const ENCODE = (() => {
  const table = new Uint8Array(ENCODE_SIZE);
  for (let i = 0; i < ENCODE_SIZE; i += 1) {
    let v = i / ENCODE_SCALE;
    if (v > 0.85) v = 0.85 + 0.15 * (1 - Math.exp(-(v - 0.85) / 0.15));
    table[i] = Math.round(Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  }
  return table;
})();

function encode(value: number): number {
  return ENCODE[value < ENCODE_TOP ? (value * ENCODE_SCALE + 0.5) | 0 : ENCODE_SIZE - 1]!;
}

/** A little noise under a byte's rounding, from a pixel's place: so a slow gradient shows no rings. */
function dither(x: number, y: number): number {
  let hash = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  return ((hash >>> 8) & 0xff) / 255 - 0.5;
}

/** Where the glass is: design units to canvas px, y up from the bottom of the glass, x across from its axis. */
interface Place {
  unit: number;
  x(px: number): number;
  y(py: number): number;
}

function place(originX: number, originY: number, unit: number): Place {
  return { unit, x: (px) => originX + px * unit, y: (py) => originY - py * unit };
}

/** The glass's outline, its top open: down the left wall, round the foot and up the right. */
function traceOutside(context: CanvasRenderingContext2D, at: Place): void {
  const radius = OUTER_CORNER * at.unit;
  context.moveTo(at.x(-GLASS.topHalf), at.y(GLASS.height));
  context.arcTo(at.x(-GLASS.bottomHalf), at.y(0), at.x(GLASS.bottomHalf), at.y(0), radius);
  context.arcTo(at.x(GLASS.bottomHalf), at.y(0), at.x(GLASS.topHalf), at.y(GLASS.height), radius);
  context.lineTo(at.x(GLASS.topHalf), at.y(GLASS.height));
}

/** The inside of the glass: up from its floor to its rim, closed across the rim. */
function traceInside(context: CanvasRenderingContext2D, at: Place, top: number = GLASS.height): void {
  const radius = INNER_CORNER * at.unit;
  const floorHalf = innerHalfWidth(FLOOR);
  const topHalf = innerHalfWidth(top);
  context.moveTo(at.x(-topHalf), at.y(top));
  context.arcTo(at.x(-floorHalf), at.y(FLOOR), at.x(floorHalf), at.y(FLOOR), radius);
  context.arcTo(at.x(floorHalf), at.y(FLOOR), at.x(topHalf), at.y(top), radius);
  context.lineTo(at.x(topHalf), at.y(top));
  context.closePath();
}

/** The coffee: inside the glass, from its floor up to the surface, closed along the surface. */
function traceCoffee(context: CanvasRenderingContext2D, at: Place): void {
  traceInside(context, at, SURFACE);
}

/** A canvas for a layer, `width` by `height` device px, with its 2D context; null where none can be had. */
function layerCanvas(doc: Document, width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
}

/**
 * The bulb's light on the page around the glass and on what it stands on,
 * lit pixel by pixel at `share` of the canvas's size (it has no detail to
 * lose), its glass at (originX, originY) device px: a warm halo, strongest
 * low, and a flat pool under the foot.
 */
function makeHalo(doc: Document, width: number, height: number, share: number, originX: number, originY: number, unit: number) {
  const made = layerCanvas(doc, width * share, height * share);
  if (!made) return null;
  const { canvas, context } = made;
  const image = context.createImageData(canvas.width, canvas.height);
  const data = image.data;
  const [r, g, b] = parseHex(HALO.colour);
  const perPixel = 1 / (unit * share);
  for (let row = 0; row < canvas.height; row += 1) {
    const py = (originY * share - (row + 0.5)) * perPixel;
    for (let col = 0; col < canvas.width; col += 1) {
      const px = (col + 0.5 - originX * share) * perPixel;
      // The halo: round the lower glass, reaching up the page further than out.
      const d = Math.hypot(px / 1.15, (py - GLASS.height * 0.22) / 1.3) / HALO.reach;
      const fall = d < 1 ? (1 - d) * (1 - d) : 0;
      let light = HALO.strength * fall * fall * (3 - 2 * fall);
      // The pool: flat under the foot, as a surface seen from a little above.
      if (py < 0.5 * FLOOR) {
        const p = Math.hypot(px / (GLASS.bottomHalf * 2.4), (py + 3) / 22);
        if (p < 1) light += HALO.pool * (1 - p) * (1 - p);
      }
      const alpha = light * 255 + dither(col, row);
      if (alpha <= 0) continue;
      const at = (row * canvas.width + col) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = alpha;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * The coffee and the light in the glass's foot, behind the cream, lit pixel by
 * pixel (dithered, so its long fall from gold to espresso shows no rings) and
 * cut to the glass's inside by a path: `at` places the glass in this layer.
 */
function makeCoffee(doc: Document, width: number, height: number, at: Place, scale: number) {
  const made = layerCanvas(doc, width, height);
  if (!made) return null;
  const { canvas, context } = made;
  const image = context.createImageData(canvas.width, canvas.height);
  const data = image.data;
  const perPixel = 1 / (at.unit * scale);
  const originX = at.x(0) * scale;
  const originY = at.y(0) * scale;
  for (let row = 0; row < canvas.height; row += 1) {
    const py = (originY - (row + 0.5)) * perPixel;
    if (py < FLOOR - 4 || py > SURFACE + 4) continue;
    const bulb = bulbLight(py);
    const half = innerHalfWidth(py);
    for (let col = 0; col < canvas.width; col += 1) {
      const px = (col + 0.5) * perPixel - originX * perPixel;
      const across = Math.min(1, Math.abs(px) / half);
      // A column of coffee: thicker in the middle, so darker toward the walls and brighter where the light comes up through it.
      const depth = Math.sqrt(1 - across * across);
      const glow = bulb * (0.55 + 0.45 * depth);
      // Espresso through brown and amber to gold as the light grows.
      const t = Math.min(1, glow * 1.35) * 3;
      const from = t < 1 ? COFFEE_ESPRESSO : t < 2 ? COFFEE_BROWN : COFFEE_AMBER;
      const to = t < 1 ? COFFEE_BROWN : t < 2 ? COFFEE_AMBER : COFFEE_GOLD;
      const toward = t < 1 ? t : t < 2 ? t - 1 : t - 2;
      const shade = 0.72 + 0.28 * depth;
      const at4 = (row * canvas.width + col) * 4;
      const noise = dither(col, row);
      data[at4] = encode((from[0] + (to[0] - from[0]) * toward) * shade) + noise;
      data[at4 + 1] = encode((from[1] + (to[1] - from[1]) * toward) * shade) + noise;
      data[at4 + 2] = encode((from[2] + (to[2] - from[2]) * toward) * shade) + noise;
      data[at4 + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  // Cut to the coffee, its edge drawn smooth by the canvas.
  context.globalCompositeOperation = 'destination-in';
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.beginPath();
  traceCoffee(context, at);
  context.fill();
  context.globalCompositeOperation = 'source-over';

  // The foot: solid glass, the bulb's light coming up through it, brightest at its heart.
  context.save();
  context.beginPath();
  traceOutside(context, at);
  context.closePath();
  context.clip();
  const footGlow = context.createLinearGradient(0, at.y(-2), 0, at.y(FLOOR + 6));
  footGlow.addColorStop(0, 'rgba(255, 196, 120, 0.85)');
  footGlow.addColorStop(0.45, 'rgba(240, 150, 70, 0.55)');
  footGlow.addColorStop(1, 'rgba(210, 120, 50, 0)');
  context.fillStyle = footGlow;
  context.fillRect(at.x(-GLASS.topHalf), at.y(FLOOR + 6), 2 * GLASS.topHalf * at.unit, (FLOOR + 8) * at.unit);
  const footCore = context.createRadialGradient(at.x(0), at.y(4), 0, at.x(0), at.y(4), GLASS.bottomHalf * at.unit);
  footCore.addColorStop(0, 'rgba(255, 226, 170, 0.55)');
  footCore.addColorStop(1, 'rgba(255, 190, 110, 0)');
  context.fillStyle = footCore;
  context.fillRect(at.x(-GLASS.topHalf), at.y(FLOOR + 6), 2 * GLASS.topHalf * at.unit, (FLOOR + 8) * at.unit);
  context.restore();
  return canvas;
}

/** The glass's outer half width at a height. */
function outsideHalf(y: number): number {
  return GLASS.bottomHalf + ((GLASS.topHalf - GLASS.bottomHalf) * y) / GLASS.height;
}

/**
 * The streaks of the room's light down the glass, drawn on their own canvas
 * and faded toward their ends there, then laid on `context`: each one a band
 * `from` to `to` of the glass's half width across (negative is left), from
 * `low` to `high` up it, brightest (`alpha`) along its middle.
 */
function streaks(
  doc: Document,
  context: CanvasRenderingContext2D,
  at: Place,
  scale: number,
  bands: readonly (readonly [from: number, to: number, alpha: number, low: number, high: number])[],
): void {
  const made = layerCanvas(doc, context.canvas.width, context.canvas.height);
  if (!made) return;
  const own = made.context;
  own.setTransform(scale, 0, 0, scale, 0, 0);
  for (const [from, to, alpha, low, high] of bands) {
    // A band following the glass's taper, light across its middle.
    const middle = (low + high) / 2;
    const gradient = own.createLinearGradient(at.x(from * outsideHalf(middle)), 0, at.x(to * outsideHalf(middle)), 0);
    gradient.addColorStop(0, 'rgba(255, 250, 240, 0)');
    gradient.addColorStop(0.5, `rgba(255, 250, 240, ${alpha})`);
    gradient.addColorStop(1, 'rgba(255, 250, 240, 0)');
    own.fillStyle = gradient;
    own.beginPath();
    own.moveTo(at.x(from * outsideHalf(low)), at.y(low));
    own.lineTo(at.x(to * outsideHalf(low)), at.y(low));
    own.lineTo(at.x(to * outsideHalf(high)), at.y(high));
    own.lineTo(at.x(from * outsideHalf(high)), at.y(high));
    own.closePath();
    own.fill();
    // Faded toward its ends.
    own.globalCompositeOperation = 'destination-out';
    const fade = own.createLinearGradient(0, at.y(high), 0, at.y(low));
    fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
    fade.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(0.65, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
    own.fillStyle = fade;
    // Over all of the band, which is wider where the glass is.
    const ends = [from * outsideHalf(low), to * outsideHalf(low), from * outsideHalf(high), to * outsideHalf(high)].map((x) => at.x(x));
    const left = Math.min(...ends) - 1;
    own.fillRect(left, at.y(high), Math.max(...ends) + 1 - left, (high - low) * at.unit);
    own.globalCompositeOperation = 'source-over';
  }
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(made.canvas, 0, 0);
  context.restore();
  made.canvas.width = 0;
  made.canvas.height = 0;
}

/** The glass in front of the coffee and the cream: its walls, its edges, its streaks, its rim, and the foam on the coffee. */
function makeFront(doc: Document, width: number, height: number, at: Place, scale: number) {
  const made = layerCanvas(doc, width, height);
  if (!made) return null;
  const { canvas, context } = made;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  const [tr, tg, tb] = parseHex(GLASS_TINT);
  const [er, eg, eb] = parseHex(GLASS_EDGE);

  // The walls and the foot: the glass between its outer and inner edges, faintly tinted.
  context.save();
  context.beginPath();
  traceOutside(context, at);
  context.closePath();
  traceInside(context, at);
  context.fillStyle = `rgba(${tr}, ${tg}, ${tb}, 0.13)`;
  context.fill('evenodd');
  context.restore();

  // The milk foam on top of the coffee: a pale band, its top a flat ellipse seen from a little above.
  const surfaceHalf = innerHalfWidth(SURFACE);
  context.save();
  context.beginPath();
  traceCoffee(context, at);
  context.clip();
  const foam = context.createLinearGradient(0, at.y(SURFACE), 0, at.y(SURFACE - FOAM * 1.8));
  const [fr, fg, fb] = parseHex(FOAM_COLOUR);
  foam.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, 0.92)`);
  foam.addColorStop(0.5, `rgba(${fr}, ${fg}, ${fb}, 0.7)`);
  foam.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 0)`);
  context.fillStyle = foam;
  context.fillRect(at.x(-surfaceHalf), at.y(SURFACE), 2 * surfaceHalf * at.unit, FOAM * 1.8 * at.unit);
  context.restore();
  const top = context.createLinearGradient(at.x(-surfaceHalf), 0, at.x(surfaceHalf), 0);
  top.addColorStop(0, oklch(0.8, 0.03, 80));
  top.addColorStop(0.35, oklch(0.93, 0.025, 85));
  top.addColorStop(1, oklch(0.78, 0.035, 78));
  context.fillStyle = top;
  context.beginPath();
  context.ellipse(at.x(0), at.y(SURFACE), surfaceHalf * at.unit, surfaceHalf * RIM_TILT * at.unit, 0, 0, Math.PI * 2);
  context.fill();

  // The rim: the top of the wall, a ring seen from a little above, its far side faint through the glass.
  const rimOut = GLASS.topHalf;
  const rimIn = innerHalfWidth(GLASS.height);
  context.beginPath();
  context.ellipse(at.x(0), at.y(GLASS.height), rimOut * at.unit, rimOut * RIM_TILT * at.unit, 0, 0, Math.PI * 2);
  context.ellipse(at.x(0), at.y(GLASS.height), rimIn * at.unit, rimIn * RIM_TILT * at.unit, 0, 0, Math.PI * 2);
  context.fillStyle = `rgba(${tr}, ${tg}, ${tb}, 0.3)`;
  context.fill('evenodd');
  context.lineWidth = Math.max(0.75, 0.9 * at.unit);
  context.strokeStyle = `rgba(${er}, ${eg}, ${eb}, 0.32)`;
  context.beginPath();
  context.ellipse(at.x(0), at.y(GLASS.height), rimIn * at.unit, rimIn * RIM_TILT * at.unit, 0, Math.PI, Math.PI * 2);
  context.stroke();
  context.strokeStyle = `rgba(${er}, ${eg}, ${eb}, 0.7)`;
  context.lineWidth = Math.max(1, 1.2 * at.unit);
  context.beginPath();
  context.ellipse(at.x(0), at.y(GLASS.height), rimOut * at.unit, rimOut * RIM_TILT * at.unit, 0, 0, Math.PI);
  context.stroke();

  // The edges: the outside bright where the glass turns away (its edge catches light), the inside fainter.
  context.lineWidth = Math.max(1, 1.3 * at.unit);
  context.strokeStyle = `rgba(${er}, ${eg}, ${eb}, 0.55)`;
  context.beginPath();
  traceOutside(context, at);
  context.stroke();
  context.lineWidth = Math.max(0.75, 0.8 * at.unit);
  context.strokeStyle = `rgba(${er}, ${eg}, ${eb}, 0.22)`;
  context.beginPath();
  traceInside(context, at);
  context.stroke();

  // The streaks: the room's light down the glass, a broad soft one and a fine bright one on the left, a faint one on the right.
  streaks(doc, context, at, scale, [
    [-0.95, -0.7, 0.3, FLOOR - 6, GLASS.height - 6],
    [-0.62, -0.54, 0.22, FLOOR + 60, GLASS.height - 50],
    [0.7, 0.9, 0.14, FLOOR + 20, GLASS.height - 24],
  ]);

  // The foot's base, lit from right under it.
  const base = context.createLinearGradient(at.x(-GLASS.bottomHalf), 0, at.x(GLASS.bottomHalf), 0);
  base.addColorStop(0, 'rgba(255, 210, 150, 0)');
  base.addColorStop(0.5, 'rgba(255, 214, 160, 0.9)');
  base.addColorStop(1, 'rgba(255, 210, 150, 0)');
  context.strokeStyle = base;
  context.lineWidth = Math.max(1, 1.6 * at.unit);
  context.beginPath();
  context.moveTo(at.x(-GLASS.bottomHalf + OUTER_CORNER), at.y(0.6));
  context.lineTo(at.x(GLASS.bottomHalf - OUTER_CORNER), at.y(0.6));
  context.stroke();
  return canvas;
}

/**
 * The glass's foot and the bottom of the coffee mirrored in what it stands
 * on: the coffee and the glass layers turned upside down about the glass's
 * bottom (`bottomRow` device px down them), faint and fading over `depth`
 * device px, made at half size, which softens it as a glossy surface would.
 */
function makeReflection(doc: Document, layers: readonly HTMLCanvasElement[], width: number, bottomRow: number, depth: number) {
  const made = layerCanvas(doc, width / 2, depth / 2);
  if (!made) return null;
  const { canvas, context } = made;
  context.setTransform(0.5, 0, 0, -0.5, 0, bottomRow / 2);
  for (const layer of layers) context.drawImage(layer, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  const fade = context.createLinearGradient(0, 0, 0, canvas.height);
  fade.addColorStop(0, `rgba(0, 0, 0, ${REFLECTION})`);
  fade.addColorStop(0.35, `rgba(0, 0, 0, ${REFLECTION * 0.35})`);
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = fade;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

export const lava: CanvasSaver = {
  id: 'lava',
  label: 'Lava Latte',
  context: '2d',
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const doc = canvas.ownerDocument;
    const made = layerCanvas(doc, FINE_COLS, FINE_ROWS);
    if (!made) return null;
    let layer: HTMLCanvasElement | null = made.canvas;
    const layerContext = made.context;
    let image: ImageData | null = layerContext.createImageData(FINE_COLS, FINE_ROWS);
    let field: Float32Array | null = new Float32Array(GRID_COLS * GRID_ROWS);
    let slopeX: Float32Array | null = new Float32Array(GRID_COLS * GRID_ROWS);
    let slopeY: Float32Array | null = new Float32Array(GRID_COLS * GRID_ROWS);
    /** The bulb's light at each fine row's height. */
    const rowLight = new Float32Array(FINE_ROWS);
    for (let row = 0; row < FINE_ROWS; row += 1) rowLight[row] = bulbLight(GRID_TOP - ((row + 0.5) * CELL) / FINE);
    /** Where the field is cream, by its value: a table. */
    const COVER_SIZE = 512;
    const COVER_RANGE = 2;
    const cover = new Float32Array(COVER_SIZE);
    for (let i = 0; i < COVER_SIZE; i += 1) cover[i] = smoothstep(ISO - SOFT_EDGE, ISO + SOFT_EDGE, (i / (COVER_SIZE - 1)) * COVER_RANGE);
    const coverScale = (COVER_SIZE - 1) / COVER_RANGE;
    /** The relief, by the field's value: all of it at the cream's edge, a fifth of it deep inside. */
    const DEEP_RANGE = 2;
    const relieves = new Float32Array(COVER_SIZE);
    for (let i = 0; i < COVER_SIZE; i += 1) relieves[i] = RELIEF * (1 - 0.8 * smoothstep(ISO + 0.12, ISO + 0.75, (i / (COVER_SIZE - 1)) * DEEP_RANGE));
    const deepScale = (COVER_SIZE - 1) / DEEP_RANGE;

    let model: LavaModel | null = createLavaModel(env.seed);
    let width = 0;
    let height = 0;
    let scale = 1;
    let unit = 1;
    let halo: HTMLCanvasElement | null = null;
    let coffee: HTMLCanvasElement | null = null;
    let front: HTMLCanvasElement | null = null;
    let reflection: HTMLCanvasElement | null = null;
    /** How far past the screen's edges the halo reaches, CSS px: as far as the glass drifts. */
    let haloRoom = 0;
    const offset = { x: 0, y: 0 };
    /** The stills painted so far: each is a minute further along the drift. */
    let stills = 0;
    /** The layers' size, design units round the glass's origin: x ±BOX_HALF, y from BOX_LOW to BOX_HIGH. */
    const BOX_HALF = GLASS.topHalf + MARGIN;
    const BOX_LOW = -MARGIN;
    const BOX_HIGH = GLASS.height + MARGIN;
    const HALO_SHARE = 0.5;

    const release = (layerToGo: HTMLCanvasElement | null) => {
      if (layerToGo) {
        layerToGo.width = 0;
        layerToGo.height = 0;
      }
    };

    /** The cream, shaded into the fine layer. */
    const shadeCream = (shown: LavaModel) => {
      if (!image || !field || !slopeX || !slopeY) return;
      shown.field(field);
      fieldSlope(field, slopeX, slopeY);
      const data = image.data;
      data.fill(0);
      const [cr, cg, cb] = CREAM;
      for (let row = 0; row < FINE_ROWS; row += 1) {
        const top = ROWS.first[row]! * GRID_COLS;
        const bottom = ROWS.second[row]! * GRID_COLS;
        const down = ROWS.toward[row]!;
        const bulb = rowLight[row]!;
        for (let col = 0; col < FINE_COLS; col += 1) {
          const left = COLUMNS.first[col]!;
          const right = COLUMNS.second[col]!;
          const across = COLUMNS.toward[col]!;
          // The four cells round it, and their shares.
          const a = top + left;
          const b = top + right;
          const c = bottom + left;
          const d = bottom + right;
          const wa = (1 - across) * (1 - down);
          const wb = across * (1 - down);
          const wc = (1 - across) * down;
          const wd = across * down;
          const value = wa * field[a]! + wb * field[b]! + wc * field[c]! + wd * field[d]!;
          if (value < ISO - SOFT_EDGE) continue;
          const alpha = value >= COVER_RANGE ? 1 : cover[(value * coverScale) | 0]!;
          // The surface's normal from the field's slope: it faces the viewer where the field is flat, and turns out where it falls.
          const sx = wa * slopeX[a]! + wb * slopeX[b]! + wc * slopeX[c]! + wd * slopeX[d]!;
          const sy = wa * slopeY[a]! + wb * slopeY[b]! + wc * slopeY[c]! + wd * slopeY[d]!;
          // Deep in the cream the slope is only blobs inside one another: flattened there, so merged blobs are one body.
          const relief = value >= DEEP_RANGE ? RELIEF * 0.2 : relieves[(value * deepScale) | 0]!;
          let nx = -relief * sx;
          let ny = -relief * sy;
          const size = Math.sqrt(nx * nx + ny * ny + 1);
          nx /= size;
          ny /= size;
          const nz = 1 / size;
          const below = nx * FROM_BELOW[0] + ny * FROM_BELOW[1] + nz * FROM_BELOW[2];
          const room = nx * ROOM[0] + ny * ROOM[1] + nz * ROOM[2];
          const half = nx * ROOM_HALF[0] + ny * ROOM_HALF[1] + nz * ROOM_HALF[2];
          const edge = (1 - nz) * (1 - nz);
          // The bulb's light: on the undersides, through the cream, and glowing at its thin edges.
          const warm = bulb * (CREAM_BULB * (below > 0 ? below : 0) + CREAM_THROUGH + CREAM_RIM * edge) + COFFEE_BOUNCE;
          const white = CREAM_FILL + ROOM_LIGHT * (room > 0 ? room : 0);
          const sheen = half > 0.9 ? CREAM_SHEEN * ((half - 0.9) / 0.1) ** 3 : 0;
          const o = (row * FINE_COLS + col) * 4;
          data[o] = encode(cr * (white + warm * BULB_COLOUR[0]) + sheen);
          data[o + 1] = encode(cg * (white + warm * BULB_COLOUR[1]) + sheen);
          data[o + 2] = encode(cb * (white + warm * BULB_COLOUR[2]) + sheen);
          data[o + 3] = alpha * 255;
        }
      }
      layerContext.putImageData(image, 0, 0);
    };

    const paint = (shown: LavaModel, driftSeconds = shown.time) => {
      if (!layer || !coffee || !front || width <= 0 || height <= 0) return;
      // Where the glass has drifted to, to the whole device pixel, so its fine edges stay sharp.
      drift(driftSeconds, offset);
      const originX = Math.round((width / 2 + offset.x * unit) * scale) / scale;
      const originY = Math.round((height / 2 + (GLASS.height * unit) / 2 - offset.y * unit) * scale) / scale;
      const at = place(originX, originY, unit);

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = env.palette.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      if (halo) {
        // The halo is made round the glass's place undrifted, a drift's room past the screen's edges, and moves with it.
        const restX = Math.round((width / 2) * scale) / scale;
        const restY = Math.round((height / 2 + (GLASS.height * unit) / 2) * scale) / scale;
        const room = haloRoom * scale;
        context.drawImage(halo, (originX - restX) * scale - room, (originY - restY) * scale - room, canvas.width + 2 * room, canvas.height + 2 * room);
      }
      const boxX = Math.round(at.x(-BOX_HALF) * scale);
      const boxY = Math.round(at.y(BOX_HIGH) * scale);
      if (reflection) {
        const bottomRow = Math.round(BOX_HIGH * unit * scale);
        context.drawImage(reflection, boxX, boxY + bottomRow, reflection.width * 2, reflection.height * 2);
      }
      context.drawImage(coffee, boxX, boxY);

      // The cream, cut to the coffee.
      shadeCream(shown);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.save();
      context.beginPath();
      traceCoffee(context, at);
      context.clip();
      context.drawImage(layer, at.x(GRID_LEFT), at.y(GRID_TOP), GRID_COLS * CELL * unit, GRID_ROWS * CELL * unit);
      context.restore();

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(front, boxX, boxY);
    };

    return {
      step(dtMs) {
        model?.step(dtMs);
      },
      draw() {
        if (model) paint(model);
      },
      resize(nextWidth, nextHeight, nextScale) {
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        release(halo);
        release(coffee);
        release(front);
        release(reflection);
        halo = null;
        coffee = null;
        front = null;
        reflection = null;
        if (width <= 0 || height <= 0) return;
        // The glass is 70% of the screen's height, and sits in the middle of it.
        unit = Math.max(0.1, Math.min(height / 602, width / 260));
        const restX = Math.round((width / 2) * scale) / scale;
        const restY = Math.round((height / 2 + (GLASS.height * unit) / 2) * scale) / scale;
        haloRoom = Math.ceil((Math.max(DRIFT.x, DRIFT.y) + 2) * unit);
        const room = haloRoom * scale;
        halo = makeHalo(doc, canvas.width + 2 * room, canvas.height + 2 * room, HALO_SHARE, restX * scale + room, restY * scale + room, unit * scale);
        // The glass's own layers, its origin placed in them.
        const boxWidth = 2 * BOX_HALF * unit * scale;
        const boxHeight = (BOX_HIGH - BOX_LOW) * unit * scale;
        const inBox = place(BOX_HALF * unit, BOX_HIGH * unit, unit);
        coffee = makeCoffee(doc, boxWidth, boxHeight, inBox, scale);
        front = makeFront(doc, boxWidth, boxHeight, inBox, scale);
        if (coffee && front) {
          reflection = makeReflection(doc, [coffee, front], boxWidth, Math.round(BOX_HIGH * unit * scale), REFLECTION_DEPTH * unit * scale);
        }
      },
      still() {
        const fresh = createLavaModel(env.seed);
        advanceLava(fresh, STILL_MS);
        // Painted again each minute under reduced motion: a minute further along the drift each time,
        // so the glass never stands in one place all night there either (D269, D249).
        paint(fresh, fresh.time + 60 * stills);
        stills += 1;
      },
      dispose() {
        release(layer);
        release(halo);
        release(coffee);
        release(front);
        release(reflection);
        layer = null;
        halo = null;
        coffee = null;
        front = null;
        reflection = null;
        image = null;
        field = null;
        slopeX = null;
        slopeY = null;
        model = null;
      },
    };
  },
};

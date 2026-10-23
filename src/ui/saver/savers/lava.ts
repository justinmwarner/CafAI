/**
 * Lava Latte, after the lava lamp (D-SAVER-5): a tall glass of coffee seen
 * from the side, a little tapered, with blobs of cream rising and sinking in
 * it, merging and splitting. The motion and the field are lavaModel.ts; this
 * file colours the field, scales it up smoothly from its coarse grid, clips it
 * to the coffee and draws the glass round it. The glass is drawn in the page's
 * muted ink, and the coffee and the cream in their own browns and whites.
 */
import { blend, oklch, parseHex } from '../../color.ts';
import type { Palette } from '../../palette.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from '../types.ts';
import {
  advanceLava,
  CELL,
  createLavaModel,
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

/** The still is the frame at this moment (D-SAVER-5): the blobs are well on their way. */
const STILL_MS = 20_000;

/**
 * The field is worked out on the coarse grid; it is shaded on one twice as
 * fine, each fine pixel taking its value from the four nearest cells, so the
 * soft edge is smooth where the grid is coarse, and the canvas does the rest.
 */
const FINE = 2;
const FINE_COLS = GRID_COLS * FINE;
const FINE_ROWS = GRID_ROWS * FINE;

/** The field's colours: the cream is where it is ISO or more, softly, and lighter the deeper in. */
const LUT_SIZE = 256;
const FIELD_RANGE = 2.4;
const SOFT_EDGE = 0.1;

const LINE_WIDTH = 1.8;

/** The coffee, deep at the bottom and lighter at the top, and the cream, a little tan at its edge. */
const COFFEE_BOTTOM = oklch(0.35, 0.05, 52);
const COFFEE_TOP = oklch(0.47, 0.07, 60);
const CREAM_EDGE = oklch(0.82, 0.05, 74);
const CREAM_CORE = oklch(0.94, 0.03, 85);

/** The radius of the glass's corners, outside and in, in design units. */
const OUTER_CORNER = 12;
const INNER_CORNER = 8;

function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  const edge = parseHex(CREAM_EDGE);
  const core = parseHex(CREAM_CORE);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const field = (i / (LUT_SIZE - 1)) * FIELD_RANGE;
    const alpha = smoothstep(ISO - SOFT_EDGE, ISO + SOFT_EDGE, field);
    const depth = smoothstep(ISO, 1.5, field);
    for (let channel = 0; channel < 3; channel += 1) {
      lut[i * 4 + channel] = Math.round(edge[channel]! + (core[channel]! - edge[channel]!) * depth);
    }
    lut[i * 4 + 3] = Math.round(alpha * 255);
  }
  return lut;
}

interface Layout {
  unit: number;
  /** Canvas coordinates of a glass point: x across from its axis, y up from the bottom of the glass. */
  x(px: number): number;
  y(py: number): number;
}

function layoutFor(width: number, height: number): Layout {
  // The glass is 70% of the screen's height, and sits in the middle of it.
  const unit = Math.max(0.1, Math.min(height / 602, width / 260));
  const centreX = width / 2;
  const bottomY = height / 2 + (GLASS.height * unit) / 2;
  return { unit, x: (px) => centreX + px * unit, y: (py) => bottomY - py * unit };
}

/** The glass's outline, its top open: down the left wall, round the foot and up the right. */
function traceOutside(context: CanvasRenderingContext2D, at: Layout): void {
  const radius = OUTER_CORNER * at.unit;
  context.moveTo(at.x(-GLASS.topHalf), at.y(GLASS.height));
  context.arcTo(at.x(-GLASS.bottomHalf), at.y(0), at.x(GLASS.bottomHalf), at.y(0), radius);
  context.arcTo(at.x(GLASS.bottomHalf), at.y(0), at.x(GLASS.topHalf), at.y(GLASS.height), radius);
  context.lineTo(at.x(GLASS.topHalf), at.y(GLASS.height));
}

/** The coffee: inside the glass, from its floor up to the surface, closed along the surface. */
function traceCoffee(context: CanvasRenderingContext2D, at: Layout): void {
  const radius = INNER_CORNER * at.unit;
  const floorHalf = innerHalfWidth(FLOOR);
  const surfaceHalf = innerHalfWidth(SURFACE);
  context.moveTo(at.x(-surfaceHalf), at.y(SURFACE));
  context.arcTo(at.x(-floorHalf), at.y(FLOOR), at.x(floorHalf), at.y(FLOOR), radius);
  context.arcTo(at.x(floorHalf), at.y(FLOOR), at.x(surfaceHalf), at.y(SURFACE), radius);
  context.lineTo(at.x(surfaceHalf), at.y(SURFACE));
  context.closePath();
}

function drawGlass(context: CanvasRenderingContext2D, palette: Palette, at: Layout): void {
  context.lineJoin = 'round';
  context.lineCap = 'round';

  // The coffee's surface, a little lighter than the coffee below it.
  context.lineWidth = Math.max(1, 1.4 * at.unit);
  context.strokeStyle = blend(CREAM_EDGE, COFFEE_TOP, 0.35);
  context.beginPath();
  context.moveTo(at.x(-innerHalfWidth(SURFACE)), at.y(SURFACE));
  context.lineTo(at.x(innerHalfWidth(SURFACE)), at.y(SURFACE));
  context.stroke();

  // The glass, in the muted ink.
  context.lineWidth = Math.max(1.25, LINE_WIDTH * at.unit);
  context.strokeStyle = palette.inkMuted;
  context.beginPath();
  traceOutside(context, at);
  context.stroke();

  // And what it stands on.
  context.lineWidth = Math.max(1, 1.4 * at.unit);
  context.strokeStyle = palette.line;
  context.beginPath();
  context.moveTo(at.x(-160), at.y(-2));
  context.lineTo(at.x(160), at.y(-2));
  context.stroke();
}

export const lava: CanvasSaver = {
  id: 'lava',
  label: 'Lava Latte',
  context: '2d',
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const made = canvas.ownerDocument.createElement('canvas');
    made.width = FINE_COLS;
    made.height = FINE_ROWS;
    const madeContext = made.getContext('2d');
    if (!madeContext) return null;
    let layer: HTMLCanvasElement | null = made;
    let layerContext: CanvasRenderingContext2D | null = madeContext;
    let image: ImageData | null = madeContext.createImageData(FINE_COLS, FINE_ROWS);
    let field: Float32Array | null = new Float32Array(GRID_COLS * GRID_ROWS);
    const lut = buildLut();
    const tableScale = (LUT_SIZE - 1) / FIELD_RANGE;

    let model: LavaModel | null = createLavaModel(env.seed);
    let width = 0;
    let height = 0;
    let scale = 1;
    let at: Layout | null = null;
    let coffee: CanvasGradient | null = null;

    const paint = (shown: LavaModel) => {
      if (!layer || !layerContext || !image || !field || !at || !coffee) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = env.palette.background;
      context.fillRect(0, 0, width, height);

      // The coffee, and over it the cream, clipped to the coffee.
      context.beginPath();
      traceCoffee(context, at);
      context.fillStyle = coffee;
      context.fill();

      shown.field(field);
      const data = image.data;
      for (let row = 0; row < FINE_ROWS; row += 1) {
        const cellRow = row >> 1;
        const nearRow = (row & 1) === 0 ? Math.max(0, cellRow - 1) : Math.min(GRID_ROWS - 1, cellRow + 1);
        for (let col = 0; col < FINE_COLS; col += 1) {
          const cellCol = col >> 1;
          const nearCol = (col & 1) === 0 ? Math.max(0, cellCol - 1) : Math.min(GRID_COLS - 1, cellCol + 1);
          const value =
            0.5625 * field[cellRow * GRID_COLS + cellCol]! +
            0.1875 * (field[cellRow * GRID_COLS + nearCol]! + field[nearRow * GRID_COLS + cellCol]!) +
            0.0625 * field[nearRow * GRID_COLS + nearCol]!;
          const index = Math.min(LUT_SIZE - 1, (value * tableScale) | 0) * 4;
          const at = (row * FINE_COLS + col) * 4;
          data[at] = lut[index]!;
          data[at + 1] = lut[index + 1]!;
          data[at + 2] = lut[index + 2]!;
          data[at + 3] = lut[index + 3]!;
        }
      }
      layerContext.putImageData(image, 0, 0);
      context.save();
      context.beginPath();
      traceCoffee(context, at);
      context.clip();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'low';
      context.drawImage(layer, at.x(GRID_LEFT), at.y(GRID_TOP), GRID_COLS * CELL * at.unit, GRID_ROWS * CELL * at.unit);
      context.restore();

      drawGlass(context, env.palette, at);
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
        at = width > 0 && height > 0 ? layoutFor(width, height) : null;
        if (at) {
          coffee = context.createLinearGradient(0, at.y(SURFACE), 0, at.y(FLOOR));
          coffee.addColorStop(0, COFFEE_TOP);
          coffee.addColorStop(1, COFFEE_BOTTOM);
        }
      },
      still() {
        const fresh = createLavaModel(env.seed);
        advanceLava(fresh, STILL_MS);
        paint(fresh);
      },
      dispose() {
        if (layer) {
          layer.width = 0;
          layer.height = 0;
        }
        layer = null;
        layerContext = null;
        image = null;
        field = null;
        coffee = null;
        model = null;
      },
    };
  },
};

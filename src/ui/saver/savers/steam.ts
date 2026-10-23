/**
 * Rising Steam, after Flurry and Mystify (D227): a cup and its saucer
 * drawn as a quiet outline at the bottom centre, and steam rising from the
 * rim in slow curls that leave faint trails. The motion is steamModel.ts; this
 * file turns its density into ink at low alpha, smoothly scaled up from a
 * small buffer, and draws the cup. No glow, nothing added: the steam is the
 * page's ink laid thinly over the page.
 */
import { parseHex } from '../../color.ts';
import type { Palette } from '../../palette.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from '../types.ts';
import { advanceSteam, CELL, COLS, createSteamModel, LEFT, RIM_HALF_WIDTH, ROWS, TOP, type SteamModel } from './steamModel.ts';

/** The still is the frame at this moment (D227): the steam has reached its full height and the trails have built up. */
const STILL_MS = 12_000;

/** Density to alpha: soft, so overlapping wisps thicken without ever turning solid. */
const MAX_ALPHA = 0.8;
const GAIN = 1.2;
const TABLE_SIZE = 1024;
const TABLE_RANGE = 2.4;

/** The cup's outline, in design units from the middle of its rim (y down). */
const CUP_DEPTH = 113;
const RIM_RISE = 7;
const LINE_WIDTH = 1.7;

type Point = readonly [number, number];

/** A point on a cubic curve. */
function cubicAt(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** The right wall of the bowl, rim to foot: the handle grows out of it. */
const WALL: readonly [Point, Point, Point, Point] = [
  [RIM_HALF_WIDTH, 0],
  [RIM_HALF_WIDTH, 38],
  [58, 74],
  [26, 88],
];

function drawCup(context: CanvasRenderingContext2D, palette: Palette, centreX: number, rimY: number, unit: number): void {
  const x = (px: number) => centreX + px * unit;
  const y = (py: number) => rimY + py * unit;
  const move = (px: number, py: number) => context.moveTo(x(px), y(py));
  const line = (px: number, py: number) => context.lineTo(x(px), y(py));
  const curve = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) =>
    context.bezierCurveTo(x(c1x), y(c1y), x(c2x), y(c2y), x(px), y(py));

  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = Math.max(1.25, LINE_WIDTH * unit);
  context.strokeStyle = palette.inkMuted;
  context.fillStyle = palette.surface;

  // The bowl: down the left wall, across the foot, up the right wall.
  const bowl = () => {
    move(-RIM_HALF_WIDTH, 0);
    curve(-RIM_HALF_WIDTH, 38, -58, 74, -26, 88);
    line(-23, 96);
    line(23, 96);
    line(26, 88);
    curve(58, 74, RIM_HALF_WIDTH, 38, RIM_HALF_WIDTH, 0);
  };
  context.beginPath();
  bowl();
  context.fill();
  context.beginPath();
  bowl();
  context.stroke();

  // The rim, seen from a little above, with the coffee's dark surface inside it.
  context.beginPath();
  context.ellipse(centreX, rimY, RIM_HALF_WIDTH * unit, RIM_RISE * unit, 0, 0, Math.PI * 2);
  context.fillStyle = palette.background;
  context.fill();
  context.stroke();

  // The handle: an outer curve and an inner one, both out of the right wall.
  const [outerStartX, outerStartY] = cubicAt(0.1, ...WALL);
  const [outerEndX, outerEndY] = cubicAt(0.64, ...WALL);
  const [innerStartX, innerStartY] = cubicAt(0.22, ...WALL);
  const [innerEndX, innerEndY] = cubicAt(0.55, ...WALL);
  context.beginPath();
  move(outerStartX, outerStartY);
  curve(outerStartX + 50, outerStartY - 16, outerEndX + 74, outerEndY + 14, outerEndX, outerEndY);
  move(innerStartX, innerStartY);
  curve(innerStartX + 30, innerStartY - 8, innerEndX + 40, innerEndY + 8, innerEndX, innerEndY);
  context.stroke();

  // The saucer: its rim a little dished, its underside a shallow curve.
  context.beginPath();
  move(-122, 91);
  context.quadraticCurveTo(x(0), y(101), x(122), y(91));
  curve(112, 106, 70, CUP_DEPTH, 0, CUP_DEPTH);
  curve(-70, CUP_DEPTH, -112, 106, -122, 91);
  context.closePath();
  context.stroke();
}

export const steam: CanvasSaver = {
  id: 'steam',
  label: 'Rising Steam',
  context: '2d',
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const made = canvas.ownerDocument.createElement('canvas');
    made.width = COLS;
    made.height = ROWS;
    const madeContext = made.getContext('2d');
    if (!madeContext) return null;
    let layer: HTMLCanvasElement | null = made;
    let layerContext: CanvasRenderingContext2D | null = madeContext;

    // The steam is the page's ink: every pixel of the buffer has its colour, only the alpha changes.
    let image: ImageData | null = madeContext.createImageData(COLS, ROWS);
    const [inkRed, inkGreen, inkBlue] = parseHex(env.palette.ink);
    for (let i = 0; i < COLS * ROWS; i += 1) {
      image.data[i * 4] = inkRed;
      image.data[i * 4 + 1] = inkGreen;
      image.data[i * 4 + 2] = inkBlue;
    }
    const alphaOf = new Uint8ClampedArray(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i += 1) {
      const alpha = Math.round(255 * MAX_ALPHA * (1 - Math.exp(-GAIN * (i / (TABLE_SIZE - 1)) * TABLE_RANGE)));
      alphaOf[i] = alpha < 2 ? 0 : alpha;
    }
    const tableScale = (TABLE_SIZE - 1) / TABLE_RANGE;

    let model: SteamModel | null = createSteamModel(env.seed);
    // The still's steam, grown once from a fresh model: it is the same each time it is painted.
    let grown: SteamModel | null = null;
    let width = 0;
    let height = 0;
    let scale = 1;

    const paint = (shown: SteamModel) => {
      if (!layer || !layerContext || !image || width === 0 || height === 0) return;
      const unit = Math.max(0.1, Math.min(width / 962, height / 602));
      const centreX = width / 2;
      const rimY = height * 0.92 - CUP_DEPTH * unit;

      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = env.palette.background;
      context.fillRect(0, 0, width, height);
      drawCup(context, env.palette, centreX, rimY, unit);

      // The steam as alpha, and the box that holds all that shows of it: only that is
      // sent to the layer and scaled up, which is most of what a frame costs.
      const data = image.data;
      const density = shown.density;
      let firstCol = COLS;
      let lastCol = -1;
      let firstRow = ROWS;
      let lastRow = -1;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const i = row * COLS + col;
          const level = density[i]! * tableScale;
          const alpha = level <= 0 ? 0 : alphaOf[level >= TABLE_SIZE - 1 ? TABLE_SIZE - 1 : level | 0]!;
          data[i * 4 + 3] = alpha;
          if (alpha === 0) continue;
          if (col < firstCol) firstCol = col;
          if (col > lastCol) lastCol = col;
          if (row < firstRow) firstRow = row;
          lastRow = row;
        }
      }
      if (lastRow < 0) return;
      // One empty cell all round, so the scaling fades to nothing at the edge of the box.
      firstCol = Math.max(0, firstCol - 1);
      lastCol = Math.min(COLS - 1, lastCol + 1);
      firstRow = Math.max(0, firstRow - 1);
      lastRow = Math.min(ROWS - 1, lastRow + 1);
      const boxWidth = lastCol - firstCol + 1;
      const boxHeight = lastRow - firstRow + 1;
      layerContext.putImageData(image, 0, 0, firstCol, firstRow, boxWidth, boxHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'low';
      context.drawImage(
        layer,
        firstCol,
        firstRow,
        boxWidth,
        boxHeight,
        centreX + (LEFT + firstCol * CELL) * unit,
        rimY - (TOP - firstRow * CELL) * unit,
        boxWidth * CELL * unit,
        boxHeight * CELL * unit,
      );
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
      },
      still() {
        if (!grown) {
          grown = createSteamModel(env.seed);
          advanceSteam(grown, STILL_MS);
        }
        paint(grown);
      },
      dispose() {
        if (layer) {
          layer.width = 0;
          layer.height = 0;
        }
        layer = null;
        layerContext = null;
        image = null;
        model = null;
        grown = null;
      },
    };
  },
};

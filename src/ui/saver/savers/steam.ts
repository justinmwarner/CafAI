/**
 * Rising Steam, after Flurry and Mystify (D227), redrawn as a lit still
 * life (D258, D259): a porcelain cup of coffee on its saucer at the
 * bottom of the screen, a warm light behind it and above, and steam rising
 * from the coffee in slow curls, bright where it crosses the light and faint
 * away from it. The cup, the saucer and the shadow they throw are rendered
 * once at each size (steamStill.ts) onto a backdrop with the light's glow;
 * the steam is steamModel.ts's two buffers, a broad faint body and finer
 * filaments, turned into light at each frame and smoothly scaled up from
 * their small grids; then the cup's near side goes back over the steam, which
 * rises from inside it. The whole scene drifts a few pixels over minutes, so
 * the bright cup never sits in one place all night.
 */
import { parseHex } from '../../color.ts';
import type { CanvasSaver, SaverEnv, SaverInstance } from '../types.ts';
import {
  advanceSteam,
  backlight,
  CELL,
  COLS,
  createSteamModel,
  DRIFT_X,
  DRIFT_Y,
  GLOW_REACH,
  GLOW_X,
  GLOW_Y,
  HAZE_CELL,
  HAZE_COLS,
  HAZE_ROWS,
  LEFT,
  ROWS,
  sceneDrift,
  TOP,
  VIEW_SIN,
  type SteamModel,
} from './steamModel.ts';
import { renderStillLife, SAUCER_BELOW_RIM, TABLE_BELOW_RIM } from './steamStill.ts';

/** The still is the frame at this moment (D227): the steam has reached its full height and the trails have built up. */
const STILL_MS = 12_000;

/** The saucer's near edge sits this far down the screen. */
const SAUCER_EDGE_AT = 0.94;

/** Density to alpha: soft, so overlapping wisps thicken without ever turning solid. The body is fainter than the filaments. */
const FINE_ALPHA = 0.92;
const FINE_GAIN = 1.55;
const BODY_ALPHA = 0.5;
const BODY_GAIN = 3.2;
const TABLE_SIZE = 1024;
const TABLE_RANGE = 2.4;
/** How much the light brings the steam out: away from it the steam shows at SHADE of its strength. */
const SHADE = 0.3;

/** The steam's colour lit from behind, and away from the light (sRGB). */
const STEAM_LIT = '#fff6ea';
const STEAM_DIM = '#b8b3ab';
/** The key light's glow in the air behind the steam, and on the unseen table (sRGB, and alpha at its middle). */
const GLOW = '#ffb877';
const GLOW_ALPHA = 0.15;
const POOL_ALPHA = 0.085;

interface Layer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  image: ImageData;
  /** How strongly the light brings out each cell (SHADE to 1). */
  gain: Float32Array;
}

/** A small canvas the size of a buffer, its pixels coloured once by the light, so that each frame only sets alpha. */
function makeLayer(doc: Document, cols: number, rows: number, cell: number): Layer | null {
  const canvas = doc.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(cols, rows);
  const gain = new Float32Array(cols * rows);
  const lit = parseHex(STEAM_LIT);
  const dim = parseHex(STEAM_DIM);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const light = backlight(LEFT + (col + 0.5) * cell, TOP - (row + 0.5) * cell);
      const i = row * cols + col;
      for (let c = 0; c < 3; c += 1) image.data[i * 4 + c] = Math.round(dim[c]! + (lit[c]! - dim[c]!) * light);
      gain[i] = SHADE + (1 - SHADE) * light;
    }
  }
  return { canvas, context, image, gain };
}

function alphaTable(maxAlpha: number, gain: number): Uint8ClampedArray {
  const table = new Uint8ClampedArray(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i += 1) {
    const alpha = Math.round(255 * maxAlpha * (1 - Math.exp(-gain * (i / (TABLE_SIZE - 1)) * TABLE_RANGE)));
    table[i] = alpha < 2 ? 0 : alpha;
  }
  return table;
}

function release(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export const steam: CanvasSaver = {
  id: 'steam',
  label: 'Rising Steam',
  context: '2d',
  create(canvas: HTMLCanvasElement, env: SaverEnv): SaverInstance | null {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const doc = canvas.ownerDocument;
    let fine = makeLayer(doc, COLS, ROWS, CELL);
    let body = makeLayer(doc, HAZE_COLS, HAZE_ROWS, HAZE_CELL);
    if (!fine || !body) return null;
    const fineAlpha = alphaTable(FINE_ALPHA, FINE_GAIN);
    const bodyAlpha = alphaTable(BODY_ALPHA, BODY_GAIN);
    const tableScale = (TABLE_SIZE - 1) / TABLE_RANGE;

    let model: SteamModel | null = createSteamModel(env.seed);
    // The still's steam, grown once from a fresh model: it is the same each time it is painted.
    let grown: SteamModel | null = null;
    /** How many times the still has been painted (the host paints it again each minute). */
    let stills = 0;
    let width = 0;
    let height = 0;
    let scale = 1;
    let unit = 1;
    /** The middle of the rim, in CSS px, before the drift. */
    let rimX = 0;
    let rimY = 0;
    /** The page, the glow and the still life, a margin larger than the screen all round for the drift. */
    let backdrop: HTMLCanvasElement | null = null;
    let margin = 0;
    /** The cup's near side, and where its top left goes (device px) before the drift. */
    let front: HTMLCanvasElement | null = null;
    let frontX = 0;
    let frontY = 0;
    /** The scale the still life was rendered at, so a resize to the same size renders nothing again. */
    let renderedAt = 0;

    const build = () => {
      if (width <= 0 || height <= 0) return;
      const pixelsPerUnit = unit * scale;
      const still = renderStillLife({ pixelsPerUnit, background: env.palette.background, seed: env.seed });
      release(front);
      front = doc.createElement('canvas');
      front.width = still.width;
      front.height = still.height;
      const backImage = doc.createElement('canvas');
      backImage.width = still.width;
      backImage.height = still.height;
      const frontContext = front.getContext('2d');
      const backContext = backImage.getContext('2d');
      if (frontContext) frontContext.putImageData(new ImageData(still.front, still.width, still.height), 0, 0);
      if (backContext) backContext.putImageData(new ImageData(still.back, still.width, still.height), 0, 0);
      frontX = Math.round(rimX * scale) - still.originX;
      frontY = Math.round(rimY * scale) - still.originY;

      release(backdrop);
      backdrop = doc.createElement('canvas');
      margin = Math.ceil((Math.max(DRIFT_X, DRIFT_Y) + 2) * pixelsPerUnit);
      backdrop.width = Math.round(width * scale) + 2 * margin;
      backdrop.height = Math.round(height * scale) + 2 * margin;
      const back = backdrop.getContext('2d');
      if (back) {
        back.fillStyle = env.palette.background;
        back.fillRect(0, 0, backdrop.width, backdrop.height);
        const [red, green, blue] = parseHex(GLOW);
        const glowColour = (alpha: number) => `rgba(${red}, ${green}, ${blue}, ${alpha})`;
        // The key light's glow in the air behind the steam: brightest where the steam crosses it.
        const glowX = margin + (rimX + GLOW_X * unit) * scale;
        const glowY = margin + (rimY - GLOW_Y * unit) * scale;
        const glowRadius = GLOW_REACH * 2.3 * pixelsPerUnit;
        const glow = back.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
        glow.addColorStop(0, glowColour(GLOW_ALPHA));
        glow.addColorStop(0.3, glowColour(GLOW_ALPHA * 0.62));
        glow.addColorStop(0.62, glowColour(GLOW_ALPHA * 0.2));
        glow.addColorStop(1, glowColour(0));
        back.fillStyle = glow;
        back.fillRect(0, 0, backdrop.width, backdrop.height);
        // The same light lying on the unseen table, behind and round the saucer: an ellipse, the table seen low.
        const poolX = margin + (rimX - 30 * unit) * scale;
        const poolY = margin + (rimY + (TABLE_BELOW_RIM - 70 * VIEW_SIN) * unit) * scale;
        back.save();
        back.translate(poolX, poolY);
        back.scale(1, VIEW_SIN * 1.4);
        const poolRadius = 250 * pixelsPerUnit;
        const pool = back.createRadialGradient(0, 0, 0, 0, 0, poolRadius);
        pool.addColorStop(0, glowColour(POOL_ALPHA));
        pool.addColorStop(0.55, glowColour(POOL_ALPHA * 0.45));
        pool.addColorStop(1, glowColour(0));
        back.fillStyle = pool;
        back.fillRect(-poolRadius, -poolRadius, poolRadius * 2, poolRadius * 2);
        back.restore();
        back.drawImage(backImage, margin + frontX, margin + frontY);
      }
      release(backImage);
      renderedAt = pixelsPerUnit;
    };

    /** The steam's layer as alpha from a buffer, scaled up onto the screen with its middle of the rim at (cx, cy) CSS px. */
    const paintLayer = (layer: Layer, values: Float32Array, cols: number, rows: number, cell: number, table: Uint8ClampedArray, cx: number, cy: number) => {
      const data = layer.image.data;
      const gain = layer.gain;
      let firstCol = cols;
      let lastCol = -1;
      let firstRow = rows;
      let lastRow = -1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const i = row * cols + col;
          const level = values[i]! * gain[i]! * tableScale;
          const alpha = level <= 0 ? 0 : table[level >= TABLE_SIZE - 1 ? TABLE_SIZE - 1 : level | 0]!;
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
      lastCol = Math.min(cols - 1, lastCol + 1);
      firstRow = Math.max(0, firstRow - 1);
      lastRow = Math.min(rows - 1, lastRow + 1);
      const boxWidth = lastCol - firstCol + 1;
      const boxHeight = lastRow - firstRow + 1;
      layer.context.putImageData(layer.image, 0, 0, firstCol, firstRow, boxWidth, boxHeight);
      context.drawImage(
        layer.canvas,
        firstCol,
        firstRow,
        boxWidth,
        boxHeight,
        cx + (LEFT + firstCol * cell) * unit,
        cy - (TOP - firstRow * cell) * unit,
        boxWidth * cell * unit,
        boxHeight * cell * unit,
      );
    };

    /** Paints a state of the steam, the scene drifted to where it is `driftSeconds` into the showing. */
    const paint = (shown: SteamModel, driftSeconds = shown.time) => {
      if (!backdrop || !front || !fine || !body || width === 0 || height === 0) return;
      // The drift, in whole device pixels, so the still life stays crisp.
      const drift = sceneDrift(env.seed, driftSeconds);
      const dx = Math.round(drift.x * unit * scale);
      const dy = Math.round(-drift.y * unit * scale);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(backdrop, dx - margin, dy - margin);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'low';
      const cx = rimX + dx / scale;
      const cy = rimY + dy / scale;
      paintLayer(body, shown.haze, HAZE_COLS, HAZE_ROWS, HAZE_CELL, bodyAlpha, cx, cy);
      paintLayer(fine, shown.density, COLS, ROWS, CELL, fineAlpha, cx, cy);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(front, frontX + dx, frontY + dy);
    };

    return {
      step(dtMs) {
        model?.step(dtMs);
      },
      draw() {
        if (model) paint(model);
      },
      resize(nextWidth, nextHeight, nextScale) {
        const changed = nextWidth !== width || nextHeight !== height || nextScale !== scale;
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        unit = Math.max(0.1, Math.min(width / 962, height / 602));
        rimX = width / 2;
        rimY = height * SAUCER_EDGE_AT - SAUCER_BELOW_RIM * unit;
        if (changed || renderedAt !== unit * scale) build();
      },
      still() {
        if (!grown) {
          grown = createSteamModel(env.seed);
          advanceSteam(grown, STILL_MS);
        }
        // The same steam each time, but the scene a minute further along its drift: a jump of a pixel or so, not motion.
        paint(grown, STILL_MS / 1000 + stills * 60);
        stills += 1;
      },
      dispose() {
        release(backdrop);
        release(front);
        release(fine?.canvas ?? null);
        release(body?.canvas ?? null);
        backdrop = null;
        front = null;
        fine = null;
        body = null;
        model = null;
        grown = null;
      },
    };
  },
};

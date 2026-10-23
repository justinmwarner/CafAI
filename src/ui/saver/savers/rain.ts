/**
 * Brew Rain, after The Matrix's falling code (D-SAVER-5): columns of katakana
 * (the letters of コーヒー, エスプレッソ, ラテ and カフェ) and digits fall down the
 * dark screen, a near-white head ahead of a trail in the shot graph's pressure
 * green, and every few seconds one column spells a coffee word, or one of the
 * last shot's numbers, instead. The classic trail: each frame fades what is
 * painted a little and paints only the heads, and the cell a head has just
 * left, turned to the trail's colour. Where the heads are is rainModel.ts. The
 * katakana come from the device's own font.
 *
 * The canvas is left transparent where nothing is painted, over the page's
 * colour as its own CSS background, and the fade is of the paint's opacity.
 * Fading the picture toward the page's colour instead would never arrive at
 * it: 8-bit colour rounds a very dark page's blue away a little each frame, so
 * the whole canvas drifts to another shade and every wiped cell shows as a box.
 */
import type { CanvasSaver, SaverInstance } from '../types.ts';
import { columnsFor, COLUMN_PITCH, createRainModel, ROW_HEIGHT, rowsFor, type RainModel } from './rainModel.ts';

/** Figtree has no katakana: the device's own Japanese font (a few common names, Android's first), and sans-serif to end on. */
const FONT_STACK = '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
/** How much more transparent the paint gets each frame, at 30 frames a second. */
const FADE_PER_FRAME = 0.04;
const FRAME_MS = 1000 / 30;
/** The still is the frame at 8 s; the trails have faded within the last few of them, so only those are painted. */
const STILL_MS = 8000;
const STILL_PAINTED_MS = 3000;

/** What a column's head was last painted as: its cell, and whether it is a letter of a word. */
interface Painted {
  row: number;
  glyph: string;
  bright: boolean;
}

export const rain: CanvasSaver = {
  id: 'rain',
  label: 'Brew Rain',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { palette } = env;
    const headColour = palette.ink;
    const trailColour = palette.graph.pressure;
    const hostBackground = canvas.style.backgroundColor;
    canvas.style.backgroundColor = palette.background;
    let model: RainModel | null = null;
    let width = 0;
    let height = 0;
    let scale = 1;
    /** Where the first column starts: the columns are centred on the screen. */
    let left = 0;
    /** The first frame after a size change starts from nothing painted, rather than fading what was. */
    let blank = true;
    /** Time stepped since the last frame: the fade goes by it, so a slow frame fades as much as the time it covers. */
    let pendingMs = 0;
    let painted: (Painted | null)[] = [];
    const fonts = new Map<number, string>();
    /** The font the context holds: set only when it changes, and forgotten when the canvas is resized (that resets the context). */
    let currentFont = '';

    const clearCell = (col: number, row: number) => {
      // A pixel wider each side than the column's pitch: the glyphs leave that much room.
      ctx.clearRect(left + col * COLUMN_PITCH - 1, row * ROW_HEIGHT, COLUMN_PITCH + 2, ROW_HEIGHT);
    };

    const paintGlyph = (glyph: string, col: number, row: number, colour: string, size: number) => {
      let font = fonts.get(size);
      if (!font) {
        font = `${size}px ${FONT_STACK}`;
        fonts.set(size, font);
      }
      if (currentFont !== font) {
        ctx.font = font;
        currentFont = font;
      }
      ctx.fillStyle = colour;
      ctx.fillText(glyph, left + col * COLUMN_PITCH + COLUMN_PITCH / 2, row * ROW_HEIGHT + ROW_HEIGHT / 2);
    };

    const draw = () => {
      if (!model || width <= 0 || height <= 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (blank) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        blank = false;
      } else {
        const fade = 1 - Math.pow(1 - FADE_PER_FRAME, pendingMs / FRAME_MS);
        if (fade > 0.0005) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.globalAlpha = fade;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
      pendingMs = 0;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const event of model.takeEvents()) {
        const before = painted[event.col];
        if (before && !before.bright) {
          // The head moves on: its cell turns to the trail.
          clearCell(event.col, before.row);
          paintGlyph(before.glyph, event.col, before.row, trailColour, model.columns[event.col]!.size);
        }
        painted[event.col] = event.glyph ? { row: event.row, glyph: event.glyph, bright: event.bright } : null;
        if (event.erase >= 0) clearCell(event.col, event.erase);
      }
      // The heads, every frame, so they stay as bright as they began.
      const rows = model.rows;
      model.columns.forEach((column, col) => {
        if (column.glyph === '' || column.row < 0 || column.row >= rows) return;
        clearCell(col, column.row);
        paintGlyph(column.glyph, col, column.row, headColour, column.size);
      });
    };

    /** A new model for this size: the same seed gives the same rain at the same size. */
    const start = () => {
      model = createRainModel(env.seed, columnsFor(width), rowsFor(height), env.numbers);
      left = (width - model.columns.length * COLUMN_PITCH) / 2;
      painted = model.columns.map(() => null);
      blank = true;
      pendingMs = 0;
      currentFont = '';
    };

    const instance: SaverInstance = {
      step(dtMs) {
        if (!model) return;
        model.step(dtMs);
        pendingMs += dtMs;
      },
      draw,
      resize(nextWidth, nextHeight, nextScale) {
        // The same size again: the canvas keeps what is painted on it, so the rain goes on.
        if (model && nextWidth === width && nextHeight === height && nextScale === scale) return;
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        start();
      },
      still() {
        if (width <= 0 || height <= 0) return;
        start();
        // The rain has fallen for 8 s with its trails built up frame by frame: the first five seconds only
        // move the heads on (their trails would be gone), the last three are painted.
        for (let rest = STILL_MS - STILL_PAINTED_MS; rest > 0; rest -= FRAME_MS) {
          model!.step(Math.min(FRAME_MS, rest));
          model!.takeEvents();
        }
        for (let rest = STILL_PAINTED_MS; rest > 0; rest -= FRAME_MS) {
          instance.step(Math.min(FRAME_MS, rest));
          draw();
        }
      },
      dispose() {
        canvas.style.backgroundColor = hostBackground;
        model = null;
        painted = [];
        fonts.clear();
      },
    };
    return instance;
  },
};

/**
 * Brew Rain's columns (D-SAVER-5) as pure code: a head falls down each column
 * at 6 to 14 rows a second, a new glyph in each cell it enters, and the
 * drawing (rain.ts) keeps the classic trail by fading the whole canvas a
 * little each frame and painting only what the model reports. Every few
 * seconds one column spells a word, top to bottom, with the glyphs it is about
 * to enter: a coffee word in katakana, or one of the last shot's numbers.
 * Every random number comes from the seed and every change from step().
 *
 * step() does not paint, so it says what happened: for each cell a head
 * entered, an event, with the cell that has now trailed far enough behind it
 * to be wiped clean (a column's trail ends there; the fade has all but taken
 * it, and the wipe takes what 8-bit colour would leave behind).
 */
import { between, createRandom, pickOne, type Random } from '../random.ts';

/** Columns about this far apart, px. */
export const COLUMN_PITCH = 20;
/** A row, px: the glyphs are 16 to 18 px. */
export const ROW_HEIGHT = 19;
export const GLYPH_SIZES: readonly number[] = [16, 17, 18];
/** How fast a head falls, rows a second, least and most. */
export const SPEED_ROWS: readonly [least: number, most: number] = [6, 14];
/** How long a trail lasts: its length in rows is the speed times this. */
export const TRAIL_SECONDS = 2.8;
/** A column waits above the screen for between this many rows (and, at the very start, up to the second) before it begins again. */
const GAP_ROWS: readonly [number, number] = [2, 30];
const FIRST_GAP_ROWS = 60;
/** A word every so often: between these, ms (the first a little later, when the rain has spread out). */
export const WORD_EVERY_MS: readonly [least: number, most: number] = [3000, 6000];
const FIRST_WORD_MS: readonly [number, number] = [5000, 8000];
/** If no column has room for the word just now, look again after this. */
const WORD_RETRY_MS = 500;
/** Events nobody has taken (a screensaver stepped without painting) are kept to this many. */
export const MAX_EVENTS = 4000;

/** The words a column spells. */
export const WORDS: readonly string[] = ['エスプレッソ', 'コーヒー', 'ラテ', 'カフェ'];
/** The katakana of those words, each once, and the digits: what the heads are made of. */
export const KATAKANA: readonly string[] = Array.from(new Set(Array.from(WORDS.join(''))));
export const DIGITS: readonly string[] = Array.from('0123456789');
export const GLYPHS: readonly string[] = [...KATAKANA, ...DIGITS];

export interface RainColumn {
  /** The head's place in rows, fractional; negative while the column waits above the screen. */
  y: number;
  /** The last cell the head entered; -1 before the first. */
  row: number;
  /** Rows a second. */
  speed: number;
  /** The trail's length in rows. */
  lag: number;
  /** The glyph's size, px. */
  size: number;
  /** What is in the head's cell while it is on the screen: empty otherwise. */
  glyph: string;
  /** Whether that glyph is a letter of a word (it stays bright as it fades). */
  bright: boolean;
  /** The rest of the word this column is spelling. */
  word: string[];
}

/** A head entering a cell. */
export interface RainEvent {
  col: number;
  row: number;
  /** What it put there: empty once the head is below the last row, going on with only the wiping. */
  glyph: string;
  /** A letter of a word, not a random glyph. */
  bright: boolean;
  /** The cell to wipe clean now, the trail's last: -1 for none. */
  erase: number;
}

export interface RainModel {
  readonly columns: RainColumn[];
  readonly rows: number;
  /** The events since the last call, in order. */
  takeEvents(): RainEvent[];
  step(dtMs: number): void;
}

/** How many columns fit a screen this wide. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor(width / COLUMN_PITCH));
}

/** How many rows fit a screen this high, the last one cut off if need be. */
export function rowsFor(height: number): number {
  return Math.max(1, Math.ceil(height / ROW_HEIGHT));
}

export function createRainModel(seed: number, columnCount: number, rows: number, numbers: readonly string[] = []): RainModel {
  const random: Random = createRandom(seed);
  const spellable = [...WORDS, ...numbers.map((text) => text.replace(/\s+/g, '')).filter((text) => text.length > 0)];
  let events: RainEvent[] = [];
  let wordIn = between(random, FIRST_WORD_MS[0], FIRST_WORD_MS[1]);

  /** The column's next fall: a new speed, and a wait above the screen first. */
  const restart = (column: RainColumn, gapRows: number) => {
    column.speed = between(random, SPEED_ROWS[0], SPEED_ROWS[1]);
    column.lag = Math.round(column.speed * TRAIL_SECONDS);
    column.y = -gapRows;
    column.row = -1;
    column.glyph = '';
    column.bright = false;
    column.word = [];
  };

  const columns: RainColumn[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    const column: RainColumn = { y: 0, row: -1, speed: 0, lag: 0, size: pickOne(random, GLYPH_SIZES), glyph: '', bright: false, word: [] };
    restart(column, between(random, 0, FIRST_GAP_ROWS));
    columns.push(column);
  }

  /** Gives a word to a column that has the room to spell it below its head. */
  const spell = () => {
    const text = pickOne(random, spellable);
    const letters = Array.from(text);
    const room: number[] = [];
    columns.forEach((column, c) => {
      if (column.word.length === 0 && column.row >= 0 && column.row + letters.length < rows) room.push(c);
    });
    if (room.length === 0) {
      wordIn = WORD_RETRY_MS;
      return;
    }
    columns[pickOne(random, room)]!.word = letters;
    wordIn = between(random, WORD_EVERY_MS[0], WORD_EVERY_MS[1]);
  };

  return {
    columns,
    rows,
    takeEvents() {
      const taken = events;
      events = [];
      return taken;
    },
    step(dtMs) {
      const ms = Math.max(0, dtMs);
      wordIn -= ms;
      if (wordIn <= 0) spell();
      const seconds = ms / 1000;
      columns.forEach((column, c) => {
        column.y += column.speed * seconds;
        const target = Math.floor(column.y);
        while (column.row < target) {
          column.row += 1;
          const onScreen = column.row < rows;
          if (onScreen) {
            column.bright = column.word.length > 0;
            column.glyph = column.bright ? column.word.shift()! : pickOne(random, GLYPHS);
          } else {
            column.bright = false;
            column.glyph = '';
          }
          const erase = column.row - column.lag;
          events.push({ col: c, row: column.row, glyph: column.glyph, bright: column.bright, erase: erase >= 0 && erase < rows ? erase : -1 });
          // The last cell wiped is the screen's own last: the fall is over.
          if (erase >= rows - 1) {
            restart(column, between(random, GAP_ROWS[0], GAP_ROWS[1]));
            break;
          }
        }
      });
      if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS / 2);
    },
  };
}

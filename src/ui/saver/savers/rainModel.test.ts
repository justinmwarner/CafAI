import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import {
  columnsFor,
  COLUMN_PITCH,
  createRainModel,
  DIGITS,
  GLYPH_SIZES,
  GLYPHS,
  KATAKANA,
  MAX_EVENTS,
  type RainEvent,
  type RainModel,
  rowsFor,
  SPEED_ROWS,
  TRAIL_SECONDS,
  WORD_EVERY_MS,
  WORDS,
} from './rainModel.ts';

const FRAME_MS = 1000 / 30;
const COLUMNS = 48;
const ROWS = 32;

/** Steps for `ms` and gives every event on the way, in order. */
function run(model: RainModel, ms: number, frameMs = FRAME_MS): RainEvent[] {
  const all: RainEvent[] = [];
  for (let left = ms; left > 0; left -= frameMs) {
    model.step(Math.min(frameMs, left));
    all.push(...model.takeEvents());
  }
  return all;
}

describe('the grid', () => {
  it('has columns about 20 px apart and rows for 16 to 18 px glyphs', () => {
    expect(COLUMN_PITCH).toBe(20);
    expect(columnsFor(962)).toBe(48);
    expect(columnsFor(1280)).toBe(64);
    expect(columnsFor(5)).toBe(1);
    expect(rowsFor(602)).toBe(32);
    expect(rowsFor(0)).toBe(1);
    expect([...GLYPH_SIZES]).toEqual([16, 17, 18]);
  });

  it('is made of the katakana of the four coffee words, and digits', () => {
    expect([...WORDS]).toEqual(['エスプレッソ', 'コーヒー', 'ラテ', 'カフェ']);
    for (const letter of Array.from(WORDS.join(''))) expect(KATAKANA).toContain(letter);
    expect(new Set(KATAKANA).size).toBe(KATAKANA.length);
    for (const glyph of KATAKANA) expect(glyph).toMatch(/[゠-ヿ]/);
    expect([...DIGITS]).toEqual(Array.from('0123456789'));
    expect(GLYPHS).toHaveLength(KATAKANA.length + 10);
  });
});

describe('the columns', () => {
  it('give the same events after the same steps, and others for another seed', () => {
    const events = (seed: number) => {
      const model = createRainModel(seed, COLUMNS, ROWS, ['9.0', '36.4']);
      const dts = createRandom(4);
      const all: RainEvent[] = [];
      for (let i = 0; i < 1500; i += 1) {
        model.step(5 + dts() * 95);
        all.push(...model.takeEvents());
      }
      return { all, columns: model.columns };
    };
    expect(events(2)).toEqual(events(2));
    expect(events(2)).not.toEqual(events(3));
  });

  it('are as many as asked, each with a glyph size of 16 to 18 and a fall of 6 to 14 rows a second', () => {
    const model = createRainModel(1, COLUMNS, ROWS);
    expect(model.columns).toHaveLength(COLUMNS);
    expect(model.rows).toBe(ROWS);
    run(model, 60_000);
    const sizes = new Set<number>();
    for (const column of model.columns) {
      sizes.add(column.size);
      expect(GLYPH_SIZES).toContain(column.size);
      expect(column.speed).toBeGreaterThanOrEqual(SPEED_ROWS[0]);
      expect(column.speed).toBeLessThanOrEqual(SPEED_ROWS[1]);
      expect(column.lag).toBe(Math.round(column.speed * TRAIL_SECONDS));
    }
    expect(sizes.size).toBe(3);
  });

  it('send a head down one cell at a time, from the top to past the bottom, at its own speed', () => {
    const model = createRainModel(3, 1, ROWS);
    const events = run(model, 90_000);
    const first = events.findIndex((event) => event.row === 0);
    expect(first).toBeGreaterThanOrEqual(0);
    let last = -1;
    let falls = 0;
    for (const event of events) {
      if (event.row === 0) {
        expect(last === -1 || last >= ROWS - 1).toBe(true);
        falls += 1;
      } else {
        expect(event.row).toBe(last + 1);
      }
      last = event.row;
    }
    expect(falls).toBeGreaterThanOrEqual(2);
  });

  it('move a head at the column\'s speed: its rows a second', () => {
    const model = createRainModel(5, 6, 10_000);
    run(model, 20_000);
    for (const column of model.columns) {
      expect(column.row).toBeGreaterThan(0);
    }
    const before = model.columns.map((column) => column.y);
    run(model, 2000);
    model.columns.forEach((column, i) => {
      expect(column.y - before[i]!).toBeCloseTo(column.speed * 2, 6);
    });
  });

  it('put a glyph from the set in each cell, only the first time a head enters it', () => {
    const model = createRainModel(1, COLUMNS, ROWS);
    const events = run(model, 30_000);
    expect(events.length).toBeGreaterThan(2000);
    for (const event of events) {
      if (event.row < ROWS) {
        if (!event.bright) expect(GLYPHS).toContain(event.glyph);
      } else {
        expect(event.glyph).toBe('');
      }
    }
    const used = new Set(events.filter((event) => event.row < ROWS && !event.bright).map((event) => event.glyph));
    expect(used.size).toBe(GLYPHS.length);
  });

  it('wipe each cell clean once, a trail\'s length behind the head, so no trail is left on the screen', () => {
    const model = createRainModel(2, 4, ROWS);
    const events = run(model, 120_000);
    const longestTrail = Math.round(SPEED_ROWS[1] * TRAIL_SECONDS);
    const lit = new Map<string, boolean>();
    for (const event of events) {
      if (event.row < ROWS) lit.set(`${event.col},${event.row}`, true);
      if (event.erase >= 0) {
        expect(lit.get(`${event.col},${event.erase}`), `cell ${event.col},${event.erase}`).toBe(true);
        lit.set(`${event.col},${event.erase}`, false);
        expect(event.row - event.erase).toBeGreaterThanOrEqual(1);
        expect(event.row - event.erase).toBeLessThanOrEqual(longestTrail);
      }
    }
    // Only a fall still going on, in each of the four columns, may have cells lit.
    const stillLit = [...lit.entries()].filter(([, on]) => on).length;
    expect(stillLit).toBeLessThanOrEqual(4 * longestTrail);
  });

  it('leave no cell lit once a fall is over', () => {
    const model = createRainModel(9, 1, ROWS);
    const lit = new Set<number>();
    let falls = 0;
    let waiting = true;
    for (let i = 0; i < 180 * 30; i += 1) {
      model.step(FRAME_MS);
      for (const event of model.takeEvents()) {
        if (event.row < ROWS) lit.add(event.row);
        if (event.erase >= 0) lit.delete(event.erase);
      }
      const nowWaiting = model.columns[0]!.row === -1;
      if (nowWaiting) expect([...lit]).toEqual([]);
      if (nowWaiting && !waiting) falls += 1;
      waiting = nowWaiting;
    }
    expect(falls).toBeGreaterThan(8);
  });

  it('wait above the screen between falls, so not every column rains at once', () => {
    const model = createRainModel(1, COLUMNS, ROWS);
    run(model, 20_000);
    let active = 0;
    for (let i = 0; i < 600; i += 1) {
      model.step(FRAME_MS);
      model.takeEvents();
      active += model.columns.filter((column) => column.row >= 0 && column.row < ROWS).length;
    }
    const average = active / 600;
    expect(average).toBeGreaterThan(COLUMNS * 0.25);
    expect(average).toBeLessThan(COLUMNS * 0.8);
  });

  it('keep the events nobody takes to a bounded number', () => {
    const model = createRainModel(1, COLUMNS, ROWS);
    for (let i = 0; i < 60 * 30 * 10; i += 1) model.step(FRAME_MS);
    expect(model.takeEvents().length).toBeLessThanOrEqual(MAX_EVENTS);
  });
});

describe('the words', () => {
  /** Every word spelled: the letters of one column, in consecutive rows, bright. */
  function spelled(events: RainEvent[]): { col: number; row: number; text: string }[] {
    const found: { col: number; row: number; text: string }[] = [];
    const byColumn = new Map<number, RainEvent[]>();
    for (const event of events) {
      const list = byColumn.get(event.col);
      if (list) list.push(event);
      else byColumn.set(event.col, [event]);
    }
    for (const [col, list] of byColumn) {
      let open: { col: number; row: number; text: string } | null = null;
      for (const event of list) {
        if (event.bright) {
          if (open) open.text += event.glyph;
          else open = { col, row: event.row, text: event.glyph };
        } else if (open) {
          found.push(open);
          open = null;
        }
      }
      if (open) found.push(open);
    }
    return found;
  }

  it('come every few seconds, one column spelling a coffee word top to bottom', () => {
    const model = createRainModel(1, COLUMNS, ROWS);
    const words = spelled(run(model, 120_000));
    expect(words.length).toBeGreaterThanOrEqual(120_000 / WORD_EVERY_MS[1] - 2);
    expect(words.length).toBeLessThanOrEqual(120_000 / WORD_EVERY_MS[0] + 2);
    for (const word of words) {
      expect(WORDS, `${word.text} in column ${word.col}`).toContain(word.text);
      expect(word.row + word.text.length).toBeLessThanOrEqual(ROWS);
    }
    expect(new Set(words.map((word) => word.text)).size).toBe(WORDS.length);
  });

  it('put each letter in the next row down, the first of them just below where the head was', () => {
    const model = createRainModel(4, COLUMNS, ROWS);
    const events = run(model, 60_000);
    const seen = new Set<string>();
    let letters = 0;
    for (const event of events) {
      if (event.bright) {
        letters += 1;
        expect(seen.has(`${event.col},${event.row - 1}`), `a head above the letter at ${event.col},${event.row}`).toBe(true);
      }
      seen.add(`${event.col},${event.row}`);
    }
    expect(letters).toBeGreaterThan(20);
  });

  it('include the last shot\'s numbers among them, spelled as CafAI writes them', () => {
    const model = createRainModel(1, COLUMNS, ROWS, ['9.0', '36.4', '28']);
    const words = spelled(run(model, 240_000)).map((word) => word.text);
    for (const number of ['9.0', '36.4', '28']) expect(words, number).toContain(number);
    for (const text of words) expect([...WORDS, '9.0', '36.4', '28']).toContain(text);
  });

  it('are only the four words when there are no numbers', () => {
    const model = createRainModel(1, COLUMNS, ROWS, []);
    const words = spelled(run(model, 120_000)).map((word) => word.text);
    expect(words.length).toBeGreaterThan(10);
    for (const text of words) expect(WORDS).toContain(text);
  });

  it('look again soon when no column has the room, and still never spell a word that does not fit', () => {
    const model = createRainModel(1, 2, 5);
    const words = spelled(run(model, 120_000));
    for (const word of words) expect(word.row + word.text.length).toBeLessThanOrEqual(5);
  });
});

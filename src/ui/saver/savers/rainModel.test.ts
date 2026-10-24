import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import {
  BREW_NUMBERS,
  createRainModel,
  DROPLETS,
  FAR,
  FILL_MS,
  floorAt,
  GLYPHS,
  isStillMoment,
  isSymbol,
  layoutFor,
  LETTER_FADE_MS,
  LETTER_HOLD_MS,
  letterAlpha,
  LETTERS,
  LEVEL_FULL,
  LEVEL_START,
  levelAt,
  levelY,
  MAX_DROPLETS,
  MAX_EVENTS,
  MAX_RIPPLES,
  NEAR,
  PITCH,
  type RainEvent,
  type RainModel,
  RIPPLE_MS,
  RIPPLE_REACH,
  rippleAt,
  rowY,
  STILL_FROM_MS,
  STILL_LATEST_MS,
  surfaceAt,
  SYMBOLS,
  TRAIL_SECONDS,
  WAVE_REACH,
  WORD_EVERY_MS,
  WORDS,
} from './rainModel.ts';

const FRAME_MS = 1000 / 30;
const SCREEN = layoutFor(962, 602);

/** Steps for `ms` and gives every event on the way, in order. */
function run(model: RainModel, ms: number, frameMs = FRAME_MS): RainEvent[] {
  const all: RainEvent[] = [];
  for (let left = ms; left > 0; left -= frameMs) {
    model.step(Math.min(frameMs, left));
    all.push(...model.takeEvents());
  }
  return all;
}

/** A screen `pitches` near columns wide (a far one between each two), tall enough for about `rows` near rows above the coffee. */
function screen(pitches: number, rows = 20) {
  const band = layoutFor(100, 602).band;
  return layoutFor(pitches * PITCH, Math.round((band + rows * NEAR.row + WAVE_REACH + 2) / (1 - LEVEL_START)));
}

describe('the screen', () => {
  it('has a shower screen along the top, a near column under each hole of its front row and a far one under each of the next', () => {
    expect(PITCH).toBe(32);
    expect(SCREEN.pitches).toBe(30);
    expect(SCREEN.left).toBe(1);
    expect(SCREEN.band).toBe(33);
    expect(layoutFor(100, 200).band).toBe(20);
    expect(layoutFor(100, 2000).band).toBe(40);
    const model = createRainModel(1, SCREEN);
    const near = model.columns.filter((column) => column.layer === NEAR);
    const far = model.columns.filter((column) => column.layer === FAR);
    expect(near).toHaveLength(30);
    expect(far).toHaveLength(29);
    expect(model.columns.slice(0, 30)).toEqual(near);
    expect(near[0]!.x).toBe(17);
    expect(near[29]!.x).toBe(945);
    expect(far[0]!.x).toBe(33);
    expect(rowY(SCREEN, 0)).toBe(SCREEN.band);
    expect(rowY(SCREEN, 2)).toBe(SCREEN.band + 2 * NEAR.row);
    expect(rowY(SCREEN, 2, FAR)).toBe(SCREEN.band + 2 * FAR.row);
  });

  it('keeps each far column between two near ones, its cells clear of theirs', () => {
    const model = createRainModel(1, SCREEN);
    for (const far of model.columns.filter((column) => column.layer === FAR)) {
      for (const near of model.columns.filter((column) => column.layer === NEAR)) {
        expect(Math.abs(far.x - near.x)).toBeGreaterThanOrEqual((NEAR.cell + FAR.cell) / 2);
      }
    }
    expect(Math.max(...NEAR.sizes) * 0.92).toBeLessThanOrEqual(NEAR.cell);
    expect(Math.max(...FAR.sizes) * 0.92).toBeLessThanOrEqual(FAR.cell);
  });

  it('rains coffee: seven symbols, and the Latin letters and figures of its words and numbers, no katakana', () => {
    expect([...SYMBOLS]).toEqual(['bean', 'drop', 'cup', 'cherry', 'leaf', 'steam', 'heart']);
    for (const symbol of SYMBOLS) expect(isSymbol(symbol)).toBe(true);
    for (const text of [...WORDS, ...BREW_NUMBERS]) {
      for (const letter of Array.from(text.replace(/ /g, ''))) expect(LETTERS, `${letter} of ${text}`).toContain(letter);
    }
    for (const letter of LETTERS) {
      expect(letter).toMatch(/^[A-Z0-9°:gs]$/);
      expect(isSymbol(letter)).toBe(false);
    }
    expect(new Set(LETTERS).size).toBe(LETTERS.length);
    for (const digit of '0123456789') expect(LETTERS).toContain(digit);
    expect(GLYPHS).toEqual([...SYMBOLS, ...LETTERS]);
    for (const word of WORDS) expect(word).toMatch(/^[A-Z]+$/);
    expect(WORDS).toContain('ESPRESSO');
    expect(BREW_NUMBERS).toContain('9 BAR');
  });
});

describe('the cup', () => {
  it('fills slowly while it shows: from an eighth of the screen to more over 30 minutes, then back', () => {
    expect(levelAt(0)).toBeCloseTo(LEVEL_START, 9);
    expect(levelAt(FILL_MS)).toBeCloseTo(LEVEL_FULL, 9);
    expect(levelAt(2 * FILL_MS)).toBeCloseTo(LEVEL_START, 9);
    expect(levelAt(FILL_MS / 2)).toBeCloseTo((LEVEL_START + LEVEL_FULL) / 2, 9);
    let last = levelAt(0);
    for (let ms = 60_000; ms <= FILL_MS; ms += 60_000) {
      const level = levelAt(ms);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it('moves its surface a few px a minute at most, so nothing bright stays put (burn-in)', () => {
    let fastest = 0;
    for (let ms = 0; ms < 2 * FILL_MS; ms += 60_000) {
      fastest = Math.max(fastest, Math.abs(levelY(SCREEN, ms + 60_000) - levelY(SCREEN, ms)));
    }
    expect(fastest).toBeGreaterThan(1);
    expect(fastest).toBeLessThan(3);
    expect(levelY(SCREEN, 0) - levelY(SCREEN, FILL_MS)).toBeGreaterThan(30);
  });

  it('waves its surface gently about the level, and keeps every row a head enters above it', () => {
    for (const ms of [0, 5000, 61_000, FILL_MS, 1.5 * FILL_MS]) {
      for (const layer of [NEAR, FAR]) {
        const floor = floorAt(SCREEN, ms, layer);
        for (let x = 0; x <= SCREEN.width; x += 7) {
          const surface = surfaceAt(SCREEN, x, ms);
          expect(Math.abs(surface - levelY(SCREEN, ms))).toBeLessThanOrEqual(WAVE_REACH);
          expect(rowY(SCREEN, floor, layer)).toBeLessThanOrEqual(surface);
        }
        expect(rowY(SCREEN, floor + 1, layer)).toBeGreaterThan(levelY(SCREEN, ms) - WAVE_REACH);
      }
    }
    expect(floorAt(SCREEN, 0)).toBe(20);
    expect(floorAt(SCREEN, 0, FAR)).toBe(30);
    expect(floorAt(SCREEN, FILL_MS)).toBeLessThan(floorAt(SCREEN, 0));
  });
});

describe('the columns', () => {
  it('give the same events after the same steps, and others for another seed', () => {
    const events = (seed: number) => {
      const model = createRainModel(seed, SCREEN, ['9.0', '36.4']);
      const dts = createRandom(4);
      const all: RainEvent[] = [];
      for (let i = 0; i < 1500; i += 1) {
        model.step(5 + dts() * 95);
        all.push(...model.takeEvents());
      }
      return { all, columns: model.columns, ripples: model.ripples, droplets: model.droplets, letters: model.letters };
    };
    expect(events(2)).toEqual(events(2));
    expect(events(2)).not.toEqual(events(3));
  });

  it('fall at their layer\'s speeds, with its sizes: the far ones smaller and slower', () => {
    const model = createRainModel(1, SCREEN);
    run(model, 60_000);
    for (const layer of [NEAR, FAR]) {
      const sizes = new Set<number>();
      for (const column of model.columns.filter((one) => one.layer === layer)) {
        sizes.add(column.size);
        expect(layer.sizes).toContain(column.size);
        expect(column.speed).toBeGreaterThanOrEqual(layer.speed[0]);
        expect(column.speed).toBeLessThanOrEqual(layer.speed[1]);
        expect(column.lag).toBe(Math.round(column.speed * TRAIL_SECONDS));
      }
      expect(sizes.size).toBe(layer.sizes.length);
    }
    expect(Math.max(...FAR.sizes)).toBeLessThan(Math.min(...NEAR.sizes));
    expect(FAR.speed[1] * FAR.row).toBeLessThan(NEAR.speed[1] * NEAR.row);
  });

  it('send a head down one cell at a time, from under the screen into the coffee', () => {
    const model = createRainModel(3, screen(1));
    const events = run(model, 90_000);
    let last = -1;
    let falls = 0;
    for (const event of events) {
      if (event.row === 0) {
        expect(last === -1 || last >= model.floor - 1).toBe(true);
        falls += 1;
      } else {
        expect(event.row).toBe(last + 1);
      }
      last = event.row;
    }
    expect(falls).toBeGreaterThanOrEqual(2);
  });

  it('move a head at the column\'s speed: its rows a second', () => {
    const model = createRainModel(5, screen(6, 400));
    run(model, 30_000);
    for (const column of model.columns) expect(column.row).toBeGreaterThan(0);
    const before = model.columns.map((column) => column.y);
    run(model, 2000);
    model.columns.forEach((column, i) => {
      expect(column.y - before[i]!).toBeCloseTo(column.speed * 2, 6);
    });
  });

  it('put a glyph from the set in each cell above the coffee, nothing below: near a symbol three times in four, far always', () => {
    const model = createRainModel(1, SCREEN);
    const events = run(model, 30_000);
    expect(events.length).toBeGreaterThan(1500);
    const random = (layer: typeof NEAR) =>
      events.filter((event) => model.columns[event.col]!.layer === layer && event.row < model.floorOf(layer) && !event.bright);
    for (const event of events) {
      if (event.row >= model.floorOf(model.columns[event.col]!.layer)) expect(event.glyph).toBe('');
    }
    const near = random(NEAR);
    for (const event of near) expect(GLYPHS).toContain(event.glyph);
    expect(new Set(near.map((event) => event.glyph)).size).toBe(GLYPHS.length);
    const symbols = near.filter((event) => isSymbol(event.glyph)).length / near.length;
    expect(symbols).toBeGreaterThan(0.68);
    expect(symbols).toBeLessThan(0.82);
    const far = random(FAR);
    expect(far.length).toBeGreaterThan(100);
    for (const event of far) expect(isSymbol(event.glyph)).toBe(true);
  });

  it('wipe each cell clean once, a trail\'s length behind the head, so no trail is left on the screen', () => {
    const model = createRainModel(2, screen(4));
    const events = run(model, 120_000);
    const longestTrail = Math.round(NEAR.speed[1] * TRAIL_SECONDS);
    const lit = new Map<string, boolean>();
    for (const event of events) {
      if (event.glyph !== '') lit.set(`${event.col},${event.row}`, true);
      if (event.erase >= 0) {
        expect(lit.get(`${event.col},${event.erase}`), `cell ${event.col},${event.erase}`).toBe(true);
        lit.set(`${event.col},${event.erase}`, false);
        expect(event.row - event.erase).toBeGreaterThanOrEqual(1);
        expect(event.row - event.erase).toBeLessThanOrEqual(longestTrail);
      }
    }
    const stillLit = [...lit.entries()].filter(([, on]) => on).length;
    expect(stillLit).toBeLessThanOrEqual(model.columns.length * longestTrail);
  });

  it('leave no cell lit once a fall is over', () => {
    const model = createRainModel(9, screen(1));
    const lit = new Set<number>();
    let falls = 0;
    let waiting = true;
    for (let i = 0; i < 180 * 30; i += 1) {
      model.step(FRAME_MS);
      for (const event of model.takeEvents()) {
        if (event.glyph !== '') lit.add(event.row);
        if (event.erase >= 0) lit.delete(event.erase);
      }
      const nowWaiting = model.columns[0]!.row === -1;
      if (nowWaiting) expect([...lit]).toEqual([]);
      if (nowWaiting && !waiting) falls += 1;
      waiting = nowWaiting;
    }
    expect(falls).toBeGreaterThan(8);
  });

  it('wait above the screen between falls, so the rain is not a wall: about a third of the near columns at a time, fewer far', () => {
    const model = createRainModel(1, SCREEN);
    run(model, 20_000);
    const active = { near: 0, far: 0 };
    for (let i = 0; i < 900; i += 1) {
      model.step(FRAME_MS);
      model.takeEvents();
      for (const column of model.columns) {
        if (column.row >= 0 && column.row < model.floorOf(column.layer)) active[column.layer === NEAR ? 'near' : 'far'] += 1;
      }
    }
    const near = active.near / 900 / SCREEN.pitches;
    const far = active.far / 900 / (SCREEN.pitches - 1);
    expect(near).toBeGreaterThan(0.2);
    expect(near).toBeLessThan(0.5);
    expect(far).toBeGreaterThan(0.08);
    expect(far).toBeLessThan(near);
  });

  it('keep the events nobody takes to a bounded number', () => {
    const model = createRainModel(1, SCREEN);
    for (let i = 0; i < 60 * 30 * 10; i += 1) model.step(FRAME_MS);
    expect(model.takeEvents().length).toBeLessThanOrEqual(MAX_EVENTS);
  });

  it('stop above the coffee as the cup fills', () => {
    const model = createRainModel(4, SCREEN);
    const startFloor = model.floor;
    for (let i = 0; i < FILL_MS / 100; i += 1) {
      model.step(100);
      for (const event of model.takeEvents()) {
        if (event.glyph !== '') expect(event.row).toBeLessThan(model.floorOf(model.columns[event.col]!.layer));
      }
    }
    expect(model.floor).toBeLessThan(startFloor);
  });
});

describe('the drops', () => {
  it('fall from each head that reaches the coffee, one a fall, from its column, and land on the surface', () => {
    const model = createRainModel(6, screen(1));
    let drops = 0;
    let landings = 0;
    let lastRipples = 0;
    let falls = 0;
    let wasFalling = false;
    for (let i = 0; i < 120 * 30; i += 1) {
      const before = model.drops.length;
      model.step(FRAME_MS);
      model.takeEvents();
      if (model.drops.length > before) drops += model.drops.length - before;
      for (const drop of model.drops) {
        expect(drop.x).toBe(model.columns[0]!.x);
        expect(drop.y).toBeLessThan(surfaceAt(model.layout, drop.x, model.time) + 1e-9);
      }
      if (model.ripples.length > lastRipples) landings += 1;
      lastRipples = model.ripples.length;
      const falling = model.columns[0]!.row >= 0;
      if (falling && !wasFalling) falls += 1;
      wasFalling = falling;
    }
    expect(drops).toBeGreaterThanOrEqual(falls - 1);
    expect(drops).toBeLessThanOrEqual(falls);
    expect(landings).toBeGreaterThan(5);
  });

  it('make two rings and a few droplets where they land, on the surface; smaller for a far drop', () => {
    const model = createRainModel(2, SCREEN);
    const seen = { near: false, far: false };
    for (let i = 0; i < 60 * 30 && !(seen.near && seen.far); i += 1) {
      const falling = model.drops.map((drop) => ({ ...drop }));
      model.step(FRAME_MS);
      model.takeEvents();
      for (const drop of falling) {
        if (model.drops.some((still) => still.col === drop.col)) continue;
        // This drop landed in this step: its rings are the last made at its place.
        const rings = model.ripples.filter((ripple) => ripple.x === drop.x && ripple.age <= FRAME_MS);
        expect(rings).toHaveLength(2);
        expect(rings[1]!.age).toBeLessThan(rings[0]!.age);
        expect(Math.abs(rings[0]!.y - surfaceAt(model.layout, drop.x, model.time))).toBeLessThan(3);
        const far = drop.size < 1;
        expect(rings[0]!.reach).toBeGreaterThanOrEqual(RIPPLE_REACH[0] * drop.size - 1e-9);
        expect(rings[0]!.reach).toBeLessThanOrEqual(RIPPLE_REACH[1] * drop.size + 1e-9);
        seen[far ? 'far' : 'near'] = true;
      }
    }
    expect(seen).toEqual({ near: true, far: true });
    expect(model.droplets.length + DROPLETS[0]).toBeGreaterThan(0);
  });

  it('let droplets fall back into the cup and rings fade within their time, and keep both to a bounded number', () => {
    const model = createRainModel(3, SCREEN);
    let most = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      model.step(FRAME_MS);
      model.takeEvents();
      for (const ripple of model.ripples) expect(ripple.age).toBeLessThan(RIPPLE_MS);
      for (const droplet of model.droplets) expect(droplet.vy < 0 || droplet.y < droplet.surface).toBe(true);
      expect(model.ripples.length).toBeLessThanOrEqual(MAX_RIPPLES);
      expect(model.droplets.length).toBeLessThanOrEqual(MAX_DROPLETS);
      most = Math.max(most, model.droplets.length);
    }
    expect(most).toBeGreaterThan(DROPLETS[0]);
  });

  it('spread a ring fast at first and slowing, bright soon after it begins and gone at its end', () => {
    expect(rippleAt(-10)).toEqual({ spread: 0, alpha: 0 });
    expect(rippleAt(RIPPLE_MS)).toEqual({ spread: 0, alpha: 0 });
    let last = -1;
    for (let age = 0; age < RIPPLE_MS; age += 50) {
      const { spread, alpha } = rippleAt(age);
      expect(spread).toBeGreaterThanOrEqual(last);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      last = spread;
    }
    expect(rippleAt(RIPPLE_MS / 4).spread).toBeGreaterThan(0.5);
    expect(rippleAt(150).alpha).toBeGreaterThan(0.6);
    expect(rippleAt(RIPPLE_MS - 20).alpha).toBeLessThan(0.01);
  });
});

describe('the words', () => {
  /** Every word spelled in full: the letters of one column, in consecutive rows, bright (not one the column is still spelling). */
  function spelled(events: RainEvent[], model: RainModel): { col: number; row: number; text: string }[] {
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
      if (open && model.columns[col]!.word.length === 0) found.push(open);
    }
    return found;
  }

  it('come every few seconds, a near column spelling a coffee word or a brew number top to bottom', () => {
    const model = createRainModel(1, SCREEN);
    const words = spelled(run(model, 240_000), model);
    expect(words.length).toBeGreaterThanOrEqual(240_000 / WORD_EVERY_MS[1] - 2);
    expect(words.length).toBeLessThanOrEqual(240_000 / WORD_EVERY_MS[0] + 2);
    for (const word of words) {
      expect([...WORDS, ...BREW_NUMBERS], `${word.text} in column ${word.col}`).toContain(word.text);
      expect(model.columns[word.col]!.layer).toBe(NEAR);
      expect(word.row + word.text.length).toBeLessThanOrEqual(model.floor);
    }
    const texts = new Set(words.map((word) => word.text));
    for (const word of WORDS) expect(texts, word).toContain(word);
    const share = words.filter((word) => WORDS.includes(word.text)).length / words.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.75);
  });

  it('put each letter in the next row down, the first of them just below where the head was, a space left empty', () => {
    const model = createRainModel(4, SCREEN);
    const events = run(model, 120_000);
    const seen = new Set<string>();
    let letters = 0;
    let spaces = 0;
    for (const event of events) {
      if (event.bright) {
        letters += 1;
        if (event.glyph === ' ') spaces += 1;
        expect(seen.has(`${event.col},${event.row - 1}`), `a head above the letter at ${event.col},${event.row}`).toBe(true);
      }
      seen.add(`${event.col},${event.row}`);
    }
    expect(letters).toBeGreaterThan(40);
    expect(spaces).toBeGreaterThan(0);
  });

  it('include the last shot\'s numbers among them, spelled as CafAI writes them', () => {
    const model = createRainModel(1, SCREEN, ['9.0', '36.4', '28']);
    const words = spelled(run(model, 600_000), model).map((word) => word.text);
    for (const number of ['9.0', '36.4', '28']) expect(words, number).toContain(number);
    for (const text of words) expect([...WORDS, ...BREW_NUMBERS, '9.0', '36.4', '28']).toContain(text);
  });

  it('are the words and the brew numbers alone when there is no shot', () => {
    const model = createRainModel(1, SCREEN, []);
    const words = spelled(run(model, 120_000), model).map((word) => word.text);
    expect(words.length).toBeGreaterThan(10);
    for (const text of words) expect([...WORDS, ...BREW_NUMBERS]).toContain(text);
  });

  it('look again soon when no column has the room, and still never spell a word that does not fit', () => {
    const model = createRainModel(1, screen(2, 5));
    const words = spelled(run(model, 120_000), model);
    for (const word of words) expect(word.row + word.text.length).toBeLessThanOrEqual(model.floor);
  });

  it('stay lit where they were spelled for a moment, then fade, every letter but a space', () => {
    expect(letterAlpha(0)).toBe(1);
    expect(letterAlpha(LETTER_HOLD_MS)).toBe(1);
    expect(letterAlpha(LETTER_HOLD_MS + LETTER_FADE_MS / 2)).toBeGreaterThan(0);
    expect(letterAlpha(LETTER_HOLD_MS + LETTER_FADE_MS / 2)).toBeLessThan(0.5);
    expect(letterAlpha(LETTER_HOLD_MS + LETTER_FADE_MS)).toBe(0);
    const model = createRainModel(2, SCREEN);
    let lit = 0;
    for (let i = 0; i < 120 * 30; i += 1) {
      model.step(FRAME_MS);
      for (const event of model.takeEvents()) {
        if (event.bright && event.glyph !== ' ') {
          lit += 1;
          const letter = model.letters.find((one) => one.col === event.col && one.row === event.row);
          expect(letter?.glyph).toBe(event.glyph);
          expect(letter!.age).toBeLessThan(FRAME_MS + 1e-9);
        }
      }
      for (const letter of model.letters) {
        expect(letter.glyph).not.toBe(' ');
        expect(letter.age).toBeLessThan(LETTER_HOLD_MS + LETTER_FADE_MS);
      }
    }
    expect(lit).toBeGreaterThan(40);
  });
});

describe('the still', () => {
  it('is the moment, from 8 s on, a word has just been spelled in full, all its letters lit; 14 s at the latest', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const model = createRainModel(seed, SCREEN, ['9.0', '36.4', '28']);
      while (!isStillMoment(model)) {
        model.step(FRAME_MS);
        model.takeEvents();
      }
      expect(model.time, `seed ${seed}`).toBeGreaterThanOrEqual(STILL_FROM_MS);
      expect(model.time, `seed ${seed}`).toBeLessThanOrEqual(STILL_LATEST_MS + FRAME_MS);
      if (model.time < STILL_LATEST_MS) {
        expect(model.wordEndedAt).not.toBeNull();
        expect(model.letters.length, `seed ${seed}`).toBeGreaterThan(0);
        for (const letter of model.letters.filter((one) => one.age < 1500)) expect(letterAlpha(letter.age)).toBe(1);
      }
    }
  });

  it('comes at the same moment every time for a seed', () => {
    const moment = (seed: number) => {
      const model = createRainModel(seed, SCREEN);
      while (!isStillMoment(model)) model.step(FRAME_MS);
      return model.time;
    };
    expect(moment(5)).toBe(moment(5));
  });
});

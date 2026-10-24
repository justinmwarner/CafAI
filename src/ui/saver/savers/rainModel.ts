/**
 * Brew Rain's model (D-RAIN-1 to D-RAIN-3) as pure code: water falls from
 * the holes of a group head's shower screen, in columns, and brews on its way
 * down into the cup below. A head falls down each column, a new glyph in each
 * cell it enters (a coffee symbol, or a letter or figure of coffee's words and
 * numbers), and the drawing (rain.ts) keeps the classic trail by fading what
 * it painted a little each frame and painting only what the model reports.
 *
 * Two layers, for depth: the near columns, under the front row of holes, and
 * between them the far ones, under the row behind it: smaller, slower, sparser
 * and fainter, symbols only. Every few seconds a near column spells a word,
 * top to bottom: a coffee word, a brew number, or one of the last shot's
 * numbers, its letters lit a while where they were spelled. A head that
 * reaches the coffee lets go a drop, which lands with a splash and rings
 * spreading on the crema. The cup fills slowly while it shows. Every random
 * number comes from the seed and every change from step().
 *
 * step() does not paint, so it says what happened: for each cell a head
 * entered, an event, with the cell that has now trailed far enough behind it
 * to be wiped clean (a column's trail ends there; the fade has all but taken
 * it, and the wipe takes what 8-bit colour would leave behind).
 */
import { between, createRandom, pickOne, wholeBetween, type Random } from '../random.ts';

/** The shower screen's holes are this far apart along each row, px: a near column under each of the front row's, a far one under each of the next row's, between them. */
export const PITCH = 32;

/** What sets a layer of the rain apart. */
export interface RainLayer {
  /** Where its columns are, as a share of a pitch: 0.5 under the front row's holes, 0 under the next row's, between them. */
  offset: number;
  /** A row, px. */
  row: number;
  /** Its glyphs' sizes, px: a column keeps one. */
  sizes: readonly number[];
  /** How fast a head falls, rows a second, least and most. */
  speed: readonly [least: number, most: number];
  /** How many rows a column waits above the screen between falls, least and most. */
  gap: readonly [least: number, most: number];
  /** How wide a cell is, px: the room its glyphs keep inside, and what a wipe clears (a layer's cells never meet the other's glyphs). */
  cell: number;
  /** A head's glyph is a symbol this often; otherwise a letter or a figure. */
  symbols: number;
  /** Whether its columns spell words. */
  words: boolean;
  /** Its splashes, against a near one's: how far the rings spread, how big the drop and the droplets. */
  splash: number;
}

export const NEAR: RainLayer = { offset: 0.5, row: 24, sizes: [18, 19, 20], speed: [5, 11], gap: [14, 60], cell: 20, symbols: 0.85, words: true, splash: 1 };
export const FAR: RainLayer = { offset: 0, row: 16, sizes: [12, 13], speed: [3.5, 7], gap: [34, 120], cell: 12, symbols: 1, words: false, splash: 0.55 };

/** How long a trail lasts: its length in rows is the speed times this. */
export const TRAIL_SECONDS = 2.3;
/** At the very start, a column waits up to this many rows, so the rain begins scattered. */
const FIRST_GAP_ROWS = 60;
/** A word every so often: between these, ms (the first a little later, when the rain has spread out). */
export const WORD_EVERY_MS: readonly [least: number, most: number] = [3000, 6000];
const FIRST_WORD_MS: readonly [number, number] = [5000, 7000];
/** If no column has room for the word just now, look again after this. */
const WORD_RETRY_MS = 500;
/** Events nobody has taken (a screensaver stepped without painting) are kept to this many. */
export const MAX_EVENTS = 4000;

/** The coffee words a column spells, in Latin capitals. */
export const WORDS: readonly string[] = ['ESPRESSO', 'CREMA', 'RISTRETTO', 'LUNGO', 'DOPPIO', 'BLOOM', 'CORTADO', 'MACCHIATO'];
/** The brew's numbers a column spells: a space is a cell left empty. */
export const BREW_NUMBERS: readonly string[] = ['9 BAR', '93°', '1:2', '18 g', '36 g', '28 s'];
/** Of what a column spells, this share is a word; the rest a number, the brew's or the last shot's. */
export const WORD_SHARE = 0.6;

/** The coffee symbols, drawn as paths (rainGlyphs.ts). */
export const SYMBOLS = ['bean', 'drop', 'cup', 'cherry', 'leaf', 'steam', 'heart'] as const;
export type RainSymbol = (typeof SYMBOLS)[number];
/** The letters and figures of the words and the brew numbers, each once, and every digit. */
export const LETTERS: readonly string[] = Array.from(new Set(Array.from([...WORDS, ...BREW_NUMBERS, '0123456789'].join('').replace(/\s+/g, ''))));
/** What the heads are made of: the symbols, then the letters and figures. */
export const GLYPHS: readonly string[] = [...SYMBOLS, ...LETTERS];

export function isSymbol(glyph: string): glyph is RainSymbol {
  return (SYMBOLS as readonly string[]).includes(glyph);
}

/** The cup's coffee, a share of the screen's height: this much at first, rising to LEVEL_FULL over FILL_MS, then back as slowly, and so on. */
export const LEVEL_START = 0.12;
export const LEVEL_FULL = 0.18;
export const FILL_MS = 30 * 60_000;
/** The crema's surface moves in two slow waves, together at most this many px from the level. */
export const WAVE_REACH = 3.2;

/** A drop falls the last bit into the cup with this pull, px a second a second. */
export const DROP_GRAVITY = 1600;
/** A ring on the crema spreads and fades over this long; each landing makes two, the second this much later. */
export const RIPPLE_MS = 1500;
export const RIPPLE_GAP_MS = 180;
/** How far a near drop's ring spreads, px across its half. */
export const RIPPLE_REACH: readonly [least: number, most: number] = [16, 26];
/** A near splash throws this many droplets (a far one fewer), which fall back with this pull. */
export const DROPLETS: readonly [least: number, most: number] = [4, 6];
export const DROPLET_GRAVITY = 900;
/** Rings and droplets are kept to these many (the oldest go first). */
export const MAX_RIPPLES = 90;
export const MAX_DROPLETS = 120;

/** A word's letter stays lit this long after its head has spelled it, then fades over LETTER_FADE_MS: long enough to read. */
export const LETTER_HOLD_MS = 1600;
export const LETTER_FADE_MS = 1400;

/** The still (D-RAIN-3): from 8 s on, the first moment a word has just been spelled in full; 14 s at the latest. */
export const STILL_FROM_MS = 8000;
export const STILL_LATEST_MS = 14_000;
/** "Just": its last letter came between these long ago, ms (every letter still lit). */
const STILL_WORD_AGE: readonly [number, number] = [300, 900];

/** Where everything sits on a screen of a size: the shower screen along the top, the columns under its holes. */
export interface RainLayout {
  width: number;
  height: number;
  /** The shower screen's band along the top, px tall: every column's row 0 starts under it. */
  band: number;
  /** How many near columns: a far one between each two. */
  pitches: number;
  /** Where the first pitch starts: the holes are centred. */
  left: number;
}

export interface RainColumn {
  layer: RainLayer;
  /** Its middle, px. */
  x: number;
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
  /** What is in the head's cell while it is above the coffee: empty otherwise. A space is a word's gap. */
  glyph: string;
  /** Whether that glyph is a letter of a word. */
  bright: boolean;
  /** The rest of the word this column is spelling. */
  word: string[];
  /** Whether this fall has let its drop go. */
  landed: boolean;
}

/** A head entering a cell. */
export interface RainEvent {
  col: number;
  row: number;
  /** What it put there: empty once the head is in the coffee, going on with only the wiping. */
  glyph: string;
  /** A letter of a word, not a random glyph. */
  bright: boolean;
  /** The cell to wipe clean now, the trail's last: -1 for none. */
  erase: number;
}

/** A letter of a word, lit in its cell while it lasts. */
export interface LitLetter {
  col: number;
  row: number;
  glyph: string;
  /** Its size, px: its column's. */
  size: number;
  /** Ms since its head spelled it. */
  age: number;
}

/** The drop a head lets go into the cup. */
export interface RainDrop {
  col: number;
  x: number;
  y: number;
  /** Px a second, downward. */
  vy: number;
  /** Its size against a near drop's. */
  size: number;
}

/** A ring spreading on the crema. */
export interface Ripple {
  x: number;
  y: number;
  /** Ms since it began; negative while it waits to. */
  age: number;
  /** How far it spreads, px across its half. */
  reach: number;
}

/** A droplet a splash threw up. */
export interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it came from: it is gone when it falls back below this. */
  surface: number;
  /** Its radius, px. */
  size: number;
}

export interface RainModel {
  readonly layout: RainLayout;
  /** The near columns, left to right, then the far ones. */
  readonly columns: RainColumn[];
  /** Ms stepped since it began. */
  readonly time: number;
  /** The near columns' first row the heads do not enter: its cell would reach the coffee. Moves up slowly as the cup fills. */
  readonly floor: number;
  /** The same for any layer. */
  floorOf(layer: RainLayer): number;
  /** The letters of words still lit, oldest first. */
  readonly letters: LitLetter[];
  readonly drops: RainDrop[];
  readonly ripples: Ripple[];
  readonly droplets: Droplet[];
  /** When the last word's last letter was spelled, ms; null before the first. */
  readonly wordEndedAt: number | null;
  /** The events since the last call, in order. */
  takeEvents(): RainEvent[];
  step(dtMs: number): void;
}

/** The shower screen's band along the top: about an eighteenth of the screen's height, 20 to 40 px. */
export function bandFor(height: number): number {
  return Math.round(Math.min(40, Math.max(20, height * 0.055)));
}

export function layoutFor(width: number, height: number): RainLayout {
  const pitches = Math.max(1, Math.floor(width / PITCH));
  return { width, height, band: bandFor(height), pitches, left: (width - pitches * PITCH) / 2 };
}

/** The top of a layer's row, px. */
export function rowY(layout: RainLayout, row: number, layer: RainLayer = NEAR): number {
  return layout.band + row * layer.row;
}

/** The coffee in the cup at `ms`, a share of the screen's height: easing from LEVEL_START up to LEVEL_FULL over FILL_MS, and back. */
export function levelAt(ms: number): number {
  const phase = (Math.max(0, ms) % (2 * FILL_MS)) / FILL_MS;
  const t = phase <= 1 ? phase : 2 - phase;
  return LEVEL_START + ((LEVEL_FULL - LEVEL_START) * (1 - Math.cos(Math.PI * t))) / 2;
}

/** The level's line, px from the top, at `ms`: where the crema's surface is when still. */
export function levelY(layout: RainLayout, ms: number): number {
  return layout.height * (1 - levelAt(ms));
}

/** The crema's surface at `x`, px from the top, at `ms`: the level, moved by two slow waves. */
export function surfaceAt(layout: RainLayout, x: number, ms: number): number {
  const t = ms / 1000;
  return levelY(layout, ms) + 2.1 * Math.sin(x * 0.0165 + t * 0.9) + 1.1 * Math.sin(x * 0.043 - t * 1.4);
}

/** A layer's first row a head does not enter at `ms`: the one whose cell would reach the surface at its highest. */
export function floorAt(layout: RainLayout, ms: number, layer: RainLayer = NEAR): number {
  return Math.max(1, Math.floor((levelY(layout, ms) - WAVE_REACH - layout.band) / layer.row));
}

/** A ring `age` ms after it began: how far it has spread (0 to 1 of its reach) and how bright it is (0 to 1). */
export function rippleAt(age: number): { spread: number; alpha: number } {
  if (age < 0 || age >= RIPPLE_MS) return { spread: 0, alpha: 0 };
  const t = age / RIPPLE_MS;
  // Fast at first and slowing, as a ring does; fading as it goes.
  const spread = 1 - (1 - t) * (1 - t) * (1 - t);
  const alpha = Math.min(1, t * 12) * (1 - t) * (1 - t);
  return { spread, alpha };
}

/** How lit a word's letter is, `age` ms after it was spelled: 1, then fading to 0. */
export function letterAlpha(age: number): number {
  if (age <= LETTER_HOLD_MS) return 1;
  const t = (age - LETTER_HOLD_MS) / LETTER_FADE_MS;
  return t >= 1 ? 0 : (1 - t) * (1 - t);
}

/** True when this is the still's moment (D-RAIN-3): a word just spelled in full, from 8 s on; or 14 s. */
export function isStillMoment(model: Pick<RainModel, 'time' | 'wordEndedAt'>): boolean {
  if (model.time >= STILL_LATEST_MS) return true;
  if (model.time < STILL_FROM_MS || model.wordEndedAt === null) return false;
  const age = model.time - model.wordEndedAt;
  return age >= STILL_WORD_AGE[0] && age <= STILL_WORD_AGE[1];
}

export function createRainModel(seed: number, layout: RainLayout, numbers: readonly string[] = []): RainModel {
  const random: Random = createRandom(seed);
  const shotNumbers = numbers.map((text) => text.trim()).filter((text) => text.length > 0);
  const figures = [...BREW_NUMBERS, ...shotNumbers];
  let events: RainEvent[] = [];
  let wordIn = between(random, FIRST_WORD_MS[0], FIRST_WORD_MS[1]);
  let time = 0;
  const floors = new Map<RainLayer, number>([
    [NEAR, floorAt(layout, 0, NEAR)],
    [FAR, floorAt(layout, 0, FAR)],
  ]);
  let wordEndedAt: number | null = null;
  let letters: LitLetter[] = [];
  const drops: RainDrop[] = [];
  let ripples: Ripple[] = [];
  let droplets: Droplet[] = [];

  /** The column's next fall: a new speed, and a wait above the screen first. */
  const restart = (column: RainColumn, gapRows: number) => {
    column.speed = between(random, column.layer.speed[0], column.layer.speed[1]);
    column.lag = Math.round(column.speed * TRAIL_SECONDS);
    column.y = -gapRows;
    column.row = -1;
    column.glyph = '';
    column.bright = false;
    column.word = [];
    column.landed = false;
  };

  const columns: RainColumn[] = [];
  const add = (layer: RainLayer, x: number) => {
    const column: RainColumn = { layer, x, y: 0, row: -1, speed: 0, lag: 0, size: pickOne(random, layer.sizes), glyph: '', bright: false, word: [], landed: false };
    restart(column, between(random, 0, FIRST_GAP_ROWS));
    columns.push(column);
  };
  for (let p = 0; p < layout.pitches; p += 1) add(NEAR, layout.left + (p + NEAR.offset) * PITCH);
  for (let p = 1; p < layout.pitches; p += 1) add(FAR, layout.left + (p + FAR.offset) * PITCH);

  const randomGlyph = (layer: RainLayer): string => (random() < layer.symbols ? pickOne(random, SYMBOLS) : pickOne(random, LETTERS));

  /** Gives a word to a near column that has the room to spell it below its head, and a row to spare should the cup rise meanwhile. */
  const spell = () => {
    const text = random() < WORD_SHARE || figures.length === 0 ? pickOne(random, WORDS) : pickOne(random, figures);
    const spelling = Array.from(text);
    const floor = floors.get(NEAR)!;
    const room: number[] = [];
    columns.forEach((column, c) => {
      if (column.layer.words && column.word.length === 0 && column.row >= 0 && column.row + spelling.length < floor - 1) room.push(c);
    });
    if (room.length === 0) {
      wordIn = WORD_RETRY_MS;
      return;
    }
    columns[pickOne(random, room)]!.word = spelling;
    wordIn = between(random, WORD_EVERY_MS[0], WORD_EVERY_MS[1]);
  };

  /** A drop lands: two rings on the crema, and a few droplets thrown up; all smaller for a far one. */
  const splash = (x: number, y: number, size: number) => {
    const reach = between(random, RIPPLE_REACH[0], RIPPLE_REACH[1]) * size;
    ripples.push({ x, y, age: 0, reach }, { x, y, age: -RIPPLE_GAP_MS, reach: reach * 0.7 });
    const count = Math.max(1, Math.round(wholeBetween(random, DROPLETS[0], DROPLETS[1]) * size));
    for (let i = 0; i < count; i += 1) {
      const side = random() < 0.5 ? -1 : 1;
      droplets.push({
        x,
        y: y - 1,
        vx: side * between(random, 14, 60) * size,
        vy: -between(random, 90, 190) * Math.sqrt(size),
        surface: y,
        size: between(random, 1.1, 2.1) * size,
      });
    }
    if (ripples.length > MAX_RIPPLES) ripples = ripples.slice(ripples.length - MAX_RIPPLES);
    if (droplets.length > MAX_DROPLETS) droplets = droplets.slice(droplets.length - MAX_DROPLETS);
  };

  const model: RainModel = {
    layout,
    columns,
    get time() {
      return time;
    },
    get floor() {
      return floors.get(NEAR)!;
    },
    floorOf(layer) {
      return floors.get(layer) ?? floorAt(layout, time, layer);
    },
    get letters() {
      return letters;
    },
    drops,
    get ripples() {
      return ripples;
    },
    get droplets() {
      return droplets;
    },
    get wordEndedAt() {
      return wordEndedAt;
    },
    takeEvents() {
      const taken = events;
      events = [];
      return taken;
    },
    step(dtMs) {
      const ms = Math.max(0, dtMs);
      const seconds = ms / 1000;
      time += ms;
      for (const layer of floors.keys()) floors.set(layer, floorAt(layout, time, layer));
      wordIn -= ms;
      if (wordIn <= 0) spell();
      // Letters age before the heads spell new ones, so a new letter starts at 0.
      for (const letter of letters) letter.age += ms;
      if (letters.length > 0 && letters[0]!.age >= LETTER_HOLD_MS + LETTER_FADE_MS) letters = letters.filter((letter) => letter.age < LETTER_HOLD_MS + LETTER_FADE_MS);

      columns.forEach((column, c) => {
        const { layer } = column;
        const floor = floors.get(layer)!;
        column.y += column.speed * seconds;
        const target = Math.floor(column.y);
        while (column.row < target) {
          column.row += 1;
          if (column.row < floor) {
            column.bright = column.word.length > 0;
            column.glyph = column.bright ? column.word.shift()! : randomGlyph(layer);
            if (column.bright && column.glyph !== ' ') letters.push({ col: c, row: column.row, glyph: column.glyph, size: column.size, age: 0 });
            if (column.bright && column.word.length === 0) wordEndedAt = time;
          } else {
            column.bright = false;
            column.glyph = '';
            column.word = [];
            if (!column.landed) {
              // The head reaches the coffee: its drop falls the rest of the way from the last cell.
              column.landed = true;
              drops.push({ col: c, x: column.x, y: rowY(layout, column.row, layer) - layer.row / 2, vy: column.speed * layer.row, size: layer.splash });
            }
          }
          const erase = column.row - column.lag;
          events.push({ col: c, row: column.row, glyph: column.glyph, bright: column.bright, erase: erase >= 0 && erase < floor ? erase : -1 });
          // The last cell wiped is the last above the coffee: the fall is over.
          if (erase >= floor - 1) {
            restart(column, between(random, layer.gap[0], layer.gap[1]));
            break;
          }
        }
      });

      for (let i = drops.length - 1; i >= 0; i -= 1) {
        const drop = drops[i]!;
        drop.vy += DROP_GRAVITY * seconds;
        drop.y += drop.vy * seconds;
        const surface = surfaceAt(layout, drop.x, time);
        if (drop.y >= surface) {
          drops.splice(i, 1);
          splash(drop.x, surface, drop.size);
        }
      }

      // A landing's second ring is younger than the next landing's first: they are not in order of age.
      for (const ripple of ripples) ripple.age += ms;
      if (ripples.length > 0) ripples = ripples.filter((ripple) => ripple.age < RIPPLE_MS);

      for (const droplet of droplets) {
        droplet.vy += DROPLET_GRAVITY * seconds;
        droplet.x += droplet.vx * seconds;
        droplet.y += droplet.vy * seconds;
      }
      if (droplets.length > 0) droplets = droplets.filter((droplet) => droplet.vy < 0 || droplet.y < droplet.surface);

      if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS / 2);
    },
  };
  return model;
}

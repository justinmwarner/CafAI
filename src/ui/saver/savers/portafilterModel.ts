/**
 * The bounce of the Bouncing Portafilter (D227, D-RAIN-4, D-RAIN-5) as pure
 * code: where the logo is, how it turns at the walls, which roast it wears
 * and how far its colour has crossed to it, the corners it has found and the
 * beans and the ring of light a corner throws. The drawing (portafilter.ts)
 * only paints what is here; every random number comes from the seed and every
 * change from step(), so the same seed and steps give the same picture.
 *
 * The logo (the badge) drifts at 70 px a second on each axis, as the DVD logo
 * does. Each wall it meets moves its colour one roast along, crossing over in
 * 300 ms; a corner, both walls in the one step, throws a dozen beans and a
 * ring of light out of it and is counted ("Corner 2"). A real corner is rare
 * (about one in half an hour), so the logo is set down on a path that finds
 * its first one within the first minute or two, and goes on bouncing as it
 * would after that.
 */
import { between, createRandom, wholeBetween, type Random } from '../random.ts';
import { nextRoast, ROASTS } from './roasts.ts';

/** The badge's speed on each axis, px a second. */
export const BADGE_SPEED = 70;
/** About a fifth of the screen wide. */
export const BADGE_WIDTH_SHARE = 0.2;
/** Its height over its width: the portafilter over the lettering over a 4:1 oval (portafilterLogo.ts). */
export const BADGE_ASPECT = 0.88;
/** A wall's change of roast crosses over this long. */
export const ROAST_FADE_MS = 300;
/** A corner's ring of light spreads out of it and fades over this long. */
export const RING_MS = 900;
/**
 * A screen smaller than this either way, px, is no screen to bounce on (a
 * canvas not laid out yet, or a screenshot that shrinks the page to 1x1 for a
 * moment): the logo keeps its place, its path and its planned first corner
 * for when the size comes back (D-RAIN-6).
 */
export const MIN_SCREEN = 16;
/** "Corner 2" shows this long by the badge. */
export const CORNER_LABEL_MS = 3000;
/** The label fades over its last part. */
export const CORNER_LABEL_FADE_MS = 500;
/** A burst's beans fade over this long. */
export const BURST_MS = 1200;
export const BURST_BEANS = 12;
/** The first corner comes between these (ms after the screensaver came up). */
export const FIRST_CORNER_MS: readonly [earliest: number, latest: number] = [45_000, 100_000];
/** How fast a burst bean slows, per second. */
const BURST_DRAG = 1.2;

export interface BurstBean {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** The long axis, px. */
  length: number;
  /** An index into ROASTS. */
  roast: number;
  /** Ms since the burst; gone at BURST_MS. */
  age: number;
}

/** Where the badge starts, instead of the seeded path (for tests). */
export interface PortafilterStart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  roast: number;
}

export interface PortafilterModel {
  /** The screen, px. */
  width: number;
  height: number;
  /** The badge's box, px: its top left corner and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** An index into ROASTS: the colour it wears, or is crossing to. */
  roast: number;
  /**
   * The colour shown, as a place along the roasts counted on and on (roast r
   * is r, r + 7, ...): crossing from `toneFrom` to `toneTo` over ROAST_FADE_MS
   * of `toneAge` (shownTone). A wall that comes mid-crossing starts the next
   * from where it had got to.
   */
  toneFrom: number;
  toneTo: number;
  toneAge: number;
  /** Walls met since it came up. */
  walls: number;
  /** Corners found since it came up. */
  corners: number;
  /** Ms since the last corner; Infinity before the first. */
  cornerAge: number;
  /** The screen's corner the last one was found in, px: where its ring of light spreads from. */
  cornerX: number;
  cornerY: number;
  /** The beans of the last corner, while they last. */
  burst: BurstBean[];
  /** When the first corner is due, as planned when the badge was set down; null once a resize spoils the plan, or with a start of its own. */
  firstCornerMs: number | null;
  /** The screen's size in px; the first call sets the badge down. */
  resize(width: number, height: number): void;
  step(dtMs: number): void;
}

/** How opaque a burst bean is: 1 at the burst, 0 when it is over. */
export function burstAlpha(ageMs: number): number {
  return Math.min(1, Math.max(0, 1 - ageMs / BURST_MS));
}

/** The colour shown, as a place along the roasts counted on and on: eased from `toneFrom` to `toneTo`. */
export function shownTone(model: Pick<PortafilterModel, 'toneFrom' | 'toneTo' | 'toneAge'>): number {
  const t = Math.min(1, Math.max(0, model.toneAge / ROAST_FADE_MS));
  const eased = t * t * (3 - 2 * t);
  return model.toneFrom + (model.toneTo - model.toneFrom) * eased;
}

/** A place along the roasts as the two roasts it lies between and how far it is from the first to the second. */
export function roastBetween(tone: number): { from: number; to: number; mix: number } {
  const whole = Math.floor(tone + 1e-9);
  const from = ((whole % ROASTS.length) + ROASTS.length) % ROASTS.length;
  return { from, to: nextRoast(from), mix: Math.max(0, tone - whole) };
}

/** A corner's ring of light `ageMs` after it: how far it has spread (0 to 1 of its reach) and how bright it is (0 to 1). */
export function ringAt(ageMs: number): { spread: number; alpha: number } {
  if (!(ageMs >= 0) || ageMs >= RING_MS) return { spread: 0, alpha: 0 };
  const t = ageMs / RING_MS;
  return { spread: 1 - (1 - t) * (1 - t), alpha: Math.min(1, t * 10) * (1 - t) * (1 - t) };
}

/** How opaque "Corner N" is, `cornerAgeMs` after the corner: 0 once it has shown for 3 s. */
export function cornerLabelAlpha(cornerAgeMs: number): number {
  if (cornerAgeMs >= CORNER_LABEL_MS) return 0;
  return Math.min(1, (CORNER_LABEL_MS - cornerAgeMs) / CORNER_LABEL_FADE_MS);
}

/** The badge's width on a screen this wide. */
export function badgeWidth(screenWidth: number): number {
  return Math.min(screenWidth * 0.5, Math.max(120, screenWidth * BADGE_WIDTH_SHARE));
}

interface Move {
  position: number;
  velocity: number;
  hits: number;
}

/** One axis moved on by `seconds`, turned back at 0 and at `range` as often as it meets them. */
function bounce(position: number, velocity: number, seconds: number, range: number): Move {
  if (range <= 0) return { position: 0, velocity, hits: 0 };
  let p = position + velocity * seconds;
  let v = velocity;
  let hits = 0;
  while ((p < 0 || p > range) && hits < 8) {
    if (p < 0) {
      p = -p;
      v = Math.abs(v);
    } else {
      p = 2 * range - p;
      v = -Math.abs(v);
    }
    hits += 1;
  }
  return { position: Math.min(range, Math.max(0, p)), velocity: v, hits };
}

/**
 * Where an axis must start, and which way it must head, to meet the wall at
 * its low end (or its high end) after `travel` px: the path run backwards
 * from the wall, which folds back on itself at both walls.
 */
function aim(range: number, wallAtHigh: boolean, travel: number): { position: number; direction: 1 | -1 } {
  if (range <= 0) return { position: 0, direction: 1 };
  const along = travel % (2 * range);
  const towardWall = along < range;
  const away = towardWall ? along : 2 * range - along;
  const position = wallAtHigh ? range - away : away;
  const toward = wallAtHigh ? 1 : -1;
  return { position, direction: towardWall ? toward : (-toward as 1 | -1) };
}

export function createPortafilterModel(seed: number, start?: PortafilterStart): PortafilterModel {
  const random: Random = createRandom(seed);
  let placed = false;
  let rangeX = 0;
  let rangeY = 0;

  const model: PortafilterModel = {
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    vx: BADGE_SPEED,
    vy: BADGE_SPEED,
    roast: 0,
    toneFrom: 0,
    toneTo: 0,
    toneAge: ROAST_FADE_MS,
    walls: 0,
    corners: 0,
    cornerAge: Infinity,
    cornerX: 0,
    cornerY: 0,
    burst: [],
    firstCornerMs: null,

    resize(width, height) {
      if (width < MIN_SCREEN || height < MIN_SCREEN) return;
      model.width = width;
      model.height = height;
      model.w = badgeWidth(width);
      model.h = model.w * BADGE_ASPECT;
      const nextX = Math.max(0, width - model.w);
      const nextY = Math.max(0, height - model.h);
      if (!placed) {
        // Nothing to set it down on until the screen has a size.
        if (width <= 0 || height <= 0) return;
        placed = true;
        place(nextX, nextY);
      } else if (nextX !== rangeX || nextY !== rangeY) {
        // The same place in proportion; any plan for the first corner is off.
        model.x = rangeX > 0 ? (model.x / rangeX) * nextX : 0;
        model.y = rangeY > 0 ? (model.y / rangeY) * nextY : 0;
        model.firstCornerMs = null;
      }
      rangeX = nextX;
      rangeY = nextY;
    },

    step(dtMs) {
      const ms = Math.max(0, dtMs);
      const seconds = ms / 1000;
      model.cornerAge += ms;
      model.toneAge += ms;
      stepBurst(seconds, ms);
      if (!placed) return;
      const moveX = bounce(model.x, model.vx, seconds, rangeX);
      const moveY = bounce(model.y, model.vy, seconds, rangeY);
      model.x = moveX.position;
      model.vx = moveX.velocity;
      model.y = moveY.position;
      model.vy = moveY.velocity;
      const hits = moveX.hits + moveY.hits;
      if (hits === 0) return;
      model.walls += hits;
      for (let i = 0; i < hits; i += 1) model.roast = nextRoast(model.roast);
      // The colour crosses on from wherever it had got to.
      model.toneFrom = shownTone(model);
      model.toneTo += hits;
      model.toneAge = 0;
      if (moveX.hits > 0 && moveY.hits > 0) {
        model.corners += 1;
        model.cornerAge = 0;
        model.cornerX = moveX.velocity > 0 ? 0 : model.width;
        model.cornerY = moveY.velocity > 0 ? 0 : model.height;
        throwBeans(model.cornerX, model.cornerY);
      }
    },
  };

  /** The seeded place: on a path that finds a corner in the first minute or two. */
  function place(nextRangeX: number, nextRangeY: number): void {
    model.roast = wholeBetween(random, 0, ROASTS.length - 1);
    if (start) {
      model.x = start.x;
      model.y = start.y;
      model.vx = start.vx;
      model.vy = start.vy;
      model.roast = start.roast;
    }
    model.toneFrom = model.roast;
    model.toneTo = model.roast;
    model.toneAge = ROAST_FADE_MS;
    if (start) return;
    const cornerAtRight = random() < 0.5;
    const cornerAtBottom = random() < 0.5;
    // The first corner's time is drawn again until the badge starts well clear of the walls
    // (the still shows that place): on some screens a path starts at a corner of its own.
    const clear = (position: number, range: number) => position >= range * 0.12 && position <= range * 0.88;
    let ms = 0;
    let across = aim(nextRangeX, cornerAtRight, 0);
    let down = aim(nextRangeY, cornerAtBottom, 0);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      ms = between(random, FIRST_CORNER_MS[0], FIRST_CORNER_MS[1]);
      const travel = (BADGE_SPEED * ms) / 1000;
      across = aim(nextRangeX, cornerAtRight, travel);
      down = aim(nextRangeY, cornerAtBottom, travel);
      if (clear(across.position, nextRangeX) && clear(down.position, nextRangeY)) break;
    }
    model.x = across.position;
    model.y = down.position;
    model.vx = across.direction * BADGE_SPEED;
    model.vy = down.direction * BADGE_SPEED;
    model.firstCornerMs = ms;
  }

  /** A dozen beans out of the screen's corner at (cornerX, cornerY), into the screen. */
  function throwBeans(cornerX: number, cornerY: number): void {
    const intoX = cornerX === 0 ? 1 : -1;
    const intoY = cornerY === 0 ? 1 : -1;
    model.burst = [];
    for (let i = 0; i < BURST_BEANS; i += 1) {
      const heading = between(random, 0.12, Math.PI / 2 - 0.12);
      const speed = between(random, 0.3, 0.7) * model.width;
      const length = between(random, 0.1, 0.15) * model.w;
      model.burst.push({
        x: cornerX + (intoX * length) / 2,
        y: cornerY + (intoY * length) / 2,
        vx: intoX * Math.cos(heading) * speed,
        vy: intoY * Math.sin(heading) * speed,
        angle: between(random, 0, Math.PI * 2),
        spin: between(random, -8, 8),
        length,
        roast: wholeBetween(random, 0, ROASTS.length - 1),
        age: 0,
      });
    }
  }

  function stepBurst(seconds: number, ms: number): void {
    if (model.burst.length === 0) return;
    const slow = Math.exp(-BURST_DRAG * seconds);
    for (const bean of model.burst) {
      bean.age += ms;
      bean.x += bean.vx * seconds;
      bean.y += bean.vy * seconds;
      bean.vx *= slow;
      bean.vy *= slow;
      bean.angle += bean.spin * seconds;
    }
    model.burst = model.burst.filter((bean) => bean.age < BURST_MS);
  }

  return model;
}

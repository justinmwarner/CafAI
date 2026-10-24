/**
 * Beanfield, after Windows' Starfield (D227, D264, D265): about 180
 * roasted coffee beans coming toward you through a deep box out of the warm
 * glow of a roaster's drum light, small, dim and hazy far away, crisp and
 * full as they pass, each rolling slowly about its long axis so it shows its
 * flat side with the cut down it, its edge and its round back in turn, all lit
 * by one key light from the upper left. The fastest near ones streak a little.
 *
 * Each bean is a sprite lit pixel by pixel in beanShape.ts: a frame of its
 * roll, lit for its turn on the screen, made the first time it is wanted at
 * one of a few sizes and kept (the biggest sizes only so many, the oldest let
 * go first). Each frame only places them; where they are is beanfieldModel.ts.
 */
import { parseHex } from '../../color.ts';
import type { CanvasSaver, SaverInstance } from '../types.ts';
import {
  BEAN_SIZE,
  createBeanfieldModel,
  depthAlpha,
  FAR_LENGTH_SHARE,
  projectBean,
  type Projection,
  screenVelocity,
  turnOf,
  Z_NEAR,
} from './beanfieldModel.ts';
import {
  BEAN_RATIO,
  type BeanGeometry,
  beanGeometry,
  beanLight,
  beanLook,
  binTurn,
  emptyView,
  type Extent,
  frameRoll,
  isTurnedFrame,
  ROLL_FRAMES,
  rollExtent,
  shadeBean,
  sourceFrame,
  SPIN_BINS,
  spriteSize,
  spriteView,
} from './beanShape.ts';
import { ROASTS } from './roasts.ts';

/** The still is the frame at 6 s. */
const STILL_MS = 6000;
const FRAME_MS = 1000 / 30;

/** The biggest sprite's bean, device px: a nearer one is drawn a little larger than it. */
const LARGEST = 168;
/** How many sprite pixels a size keeps at most: all of the small sizes' sprites, the big ones' most recently used. */
const KEEP_PIXELS = 1_300_000;
/**
 * What a frame may make of a big size (a bean this long, device px, or
 * longer) at most: sprites, and the rays of roll frames, which cost far more.
 * Past that, a bean is drawn from a frame of its roll already made, one or
 * two away, or else from the next size down, a little enlarged; so no frame
 * takes long, and the first second of a showing does not stutter. A still
 * makes all it needs.
 */
const BIG = 64;
const BIG_SPRITES_A_FRAME = 2;
const BIG_RAYS_A_FRAME = 1;

/**
 * The drum light behind the field (D265): a warm glow deep in the middle,
 * as much of it as this over the page at its heart, fading out over this
 * share of the screen's longer side, and breathing slowly.
 */
const GLOW = { colour: '#e0903e', strength: 0.16, reach: 0.55, breath: 0.12, breathSeconds: 14 } as const;

/** A bean faster than this across the screen (CSS px a second) streaks, fully at STREAK_FULL; the streak is its path over the last STREAK_SECONDS. */
const STREAK_FROM = 160;
const STREAK_FULL = 420;
const STREAK_SECONDS = 0.06;
const STREAK_GHOSTS = [0.22, 0.16, 0.11, 0.07, 0.04] as const;

/** Each roast's look and each bin's light, worked out once. */
const LOOKS = ROASTS.map(beanLook);
const LIGHTS = Array.from({ length: SPIN_BINS }, (_, bin) => beanLight(binTurn(bin)));

/** One size of sprite. */
interface Level {
  /** The bean's length in its sprites, device px, and the sprites' size. */
  length: number;
  width: number;
  height: number;
  /** Rays a pixel side where the bean's edge or its cut needs them. */
  samples: number;
  /** A roll frame's rays, cast when first wanted (only the first half of the roll's: the rest are those turned). */
  geometry: (BeanGeometry | undefined)[];
  /** The lit sprites, by key, the most recently used last. */
  sprites: Map<number, HTMLCanvasElement>;
  keep: number;
  /** The pixels a sprite is lit into before they go onto its canvas: one for the size. */
  image: ImageData | null;
}

/** The glow is made at this share of the canvas's size, and drawn up to it: it has no detail to lose. */
const GLOW_SHARE = 0.5;

/**
 * A warm glow on a canvas, its alpha dithered (a hash of each pixel's place)
 * so its slow fall to nothing shows no rings.
 */
function makeGlow(doc: Document, width: number, height: number): HTMLCanvasElement | null {
  const glow = doc.createElement('canvas');
  glow.width = width;
  glow.height = height;
  const glowContext = glow.getContext('2d');
  if (!glowContext) return null;
  const image = glowContext.createImageData(width, height);
  const data = image.data;
  const [r, g, b] = parseHex(GLOW.colour);
  const cx = width / 2;
  const cy = height / 2;
  const reach = GLOW.reach * Math.max(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15) / reach;
      if (d >= 1) continue;
      const fall = (1 - d) * (1 - d);
      const strength = fall * fall * (3 - 2 * fall) * GLOW.strength;
      // A little noise under the rounding, from the pixel's place.
      let hash = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
      hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
      const noise = ((hash >>> 8) & 0xff) / 255 - 0.5;
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = strength * 255 + noise;
    }
  }
  glowContext.putImageData(image, 0, 0);
  return glow;
}

export const beanfield: CanvasSaver = {
  id: 'beanfield',
  label: 'Beanfield',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const doc = canvas.ownerDocument;
    const { palette } = env;
    let model = createBeanfieldModel(env.seed);
    /** Where the drum light is in its breath, 0 to 1. */
    let breath = 0;
    let width = 0;
    let height = 0;
    let scale = 1;
    let levels: Level[] = [];
    let glow: HTMLCanvasElement | null = null;
    const at: Projection = { x: 0, y: 0, length: 0 };
    const view = emptyView();
    const exact: Extent = { low: 0, high: 0 };
    const framed: Extent = { low: 0, high: 0 };
    const velocity = { x: 0, y: 0 };

    const geometryFor = (level: Level, frame: number): BeanGeometry => {
      const source = sourceFrame(frame);
      let geometry = level.geometry[source];
      if (!geometry) {
        geometry = beanGeometry(level.length, frameRoll(source), level.samples);
        level.geometry[source] = geometry;
      }
      return geometry;
    };

    /** Big sprites, and big roll frames' rays, this frame may still make. */
    let bigSpritesLeft = BIG_SPRITES_A_FRAME;
    let bigRaysLeft = BIG_RAYS_A_FRAME;
    /** The size of the sprite spriteFor found last: smaller than asked for where it fell back. */
    let drawnLevel: Level | null = null;

    const keyOf = (roast: number, frame: number, bin: number) => (roast * ROLL_FRAMES + frame) * SPIN_BINS + bin;

    /** A sprite already made, marked as the most recently used (it goes last, the last to be let go). */
    const madeSprite = (level: Level, key: number): HTMLCanvasElement | undefined => {
      const sprite = level.sprites.get(key);
      if (sprite) {
        level.sprites.delete(key);
        level.sprites.set(key, sprite);
      }
      return sprite;
    };

    /**
     * The lit sprite for `view` at the size `levelIndex`, made the first time
     * it is wanted (in the canvas of the one let go for it, once the size
     * keeps all it may). Past what a frame may make of a big size, a frame of
     * the roll one or two away that is made already (`view.frame` says which),
     * or else the size below. `drawnLevel` says which size it is.
     */
    const spriteFor = (levelIndex: number, roast: number): HTMLCanvasElement => {
      const level = levels[levelIndex]!;
      const { frame, bin } = view;
      drawnLevel = level;
      const found = madeSprite(level, keyOf(roast, frame, bin));
      if (found) return found;
      if (level.length >= BIG) {
        const needsRays = !level.geometry[sourceFrame(frame)];
        if (bigSpritesLeft <= 0 || (needsRays && bigRaysLeft <= 0)) {
          for (const away of [1, -1, 2, -2]) {
            const near = (frame + away + ROLL_FRAMES) % ROLL_FRAMES;
            const nearSprite = madeSprite(level, keyOf(roast, near, bin));
            if (nearSprite) {
              view.frame = near;
              return nearSprite;
            }
          }
          if (levelIndex > 0) return spriteFor(levelIndex - 1, roast);
        }
        bigSpritesLeft -= 1;
        if (needsRays) bigRaysLeft -= 1;
      }
      let sprite: HTMLCanvasElement;
      if (level.sprites.size >= level.keep) {
        const oldest = level.sprites.keys().next().value!;
        sprite = level.sprites.get(oldest)!;
        level.sprites.delete(oldest);
      } else {
        sprite = doc.createElement('canvas');
        sprite.width = level.width;
        sprite.height = level.height;
      }
      const spriteContext = sprite.getContext('2d');
      if (spriteContext) {
        level.image ??= spriteContext.createImageData(level.width, level.height);
        shadeBean(geometryFor(level, frame), LOOKS[roast]!, LIGHTS[bin]!, level.image.data, isTurnedFrame(frame));
        spriteContext.putImageData(level.image, 0, 0);
      }
      level.sprites.set(keyOf(roast, frame, bin), sprite);
      return sprite;
    };

    /** The smallest size at least as long as this (device px): so a bean is only ever scaled down, by less than half, but past the biggest. */
    const levelFor = (deviceLength: number): number => {
      for (let i = 0; i < levels.length; i += 1) if (levels[i]!.length >= deviceLength) return i;
      return levels.length - 1;
    };

    const releaseSprites = () => {
      for (const level of levels) {
        for (const sprite of level.sprites.values()) {
          sprite.width = 0;
          sprite.height = 0;
        }
        level.sprites.clear();
      }
      levels = [];
      if (glow) {
        glow.width = 0;
        glow.height = 0;
      }
      glow = null;
    };

    /** One bean's sprite at the transform that puts it where it is, turned, sized and rolled: with alpha already set. */
    const place = (sprite: HTMLCanvasElement, level: Level, x: number, y: number, unit: number, squeeze: number, shift: number) => {
      const cos = Math.cos(view.turn) * unit;
      const sin = Math.sin(view.turn) * unit;
      ctx.setTransform(cos, sin, -sin * squeeze, cos * squeeze, x, y);
      ctx.drawImage(sprite, -level.width / 2, -level.height / 2 + shift / squeeze);
    };

    /** Paints the field; `makeAll`, for a still, makes every sprite it wants, however long that takes. */
    const paint = (makeAll: boolean) => {
      if (width <= 0 || height <= 0 || levels.length === 0) return;
      bigSpritesLeft = makeAll ? Infinity : BIG_SPRITES_A_FRAME;
      bigRaysLeft = makeAll ? Infinity : BIG_RAYS_A_FRAME;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (glow) {
        ctx.globalAlpha = 1 - GLOW.breath * (0.5 + 0.5 * Math.cos(2 * Math.PI * breath));
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(glow, 0, 0, canvas.width, canvas.height);
      }
      for (const index of model.order) {
        const bean = model.beans[index]!;
        const opacity = depthAlpha(bean.z);
        if (opacity < 0.01) continue;
        projectBean(bean, width, height, at);
        // Off the screen: nothing to draw.
        if (at.x < -at.length || at.x > width + at.length || at.y < -at.length || at.y > height + at.length) continue;
        // Lit for the bean's own angle, turned to its wobble: the light keeps its side on every bean.
        spriteView(bean.spin, bean.roll, view);
        view.turn += turnOf(bean) - bean.spin;
        const sprite = spriteFor(levelFor(at.length * scale), bean.roast);
        const level = drawnLevel!;
        // The frame's silhouette stretched to the roll's own, so the bean's edge rolls smoothly between frames.
        rollExtent(view.roll, exact);
        rollExtent(frameRoll(view.frame), framed);
        const squeeze = (exact.high - exact.low) / (framed.high - framed.low);
        const perUnit = level.length / (2 * BEAN_RATIO);
        const shift = ((exact.high + exact.low) / 2 - ((framed.high + framed.low) / 2) * squeeze) * perUnit;
        const unit = (at.length * scale) / level.length;
        const x = at.x * scale;
        const y = at.y * scale;

        // The fastest near ones leave a faint streak behind them.
        screenVelocity(bean, width, height, velocity);
        const speed = Math.hypot(velocity.x, velocity.y);
        if (speed > STREAK_FROM) {
          const strength = Math.min(1, (speed - STREAK_FROM) / (STREAK_FULL - STREAK_FROM));
          for (let i = 0; i < STREAK_GHOSTS.length; i += 1) {
            const back = ((i + 1) / STREAK_GHOSTS.length) * STREAK_SECONDS * scale;
            ctx.globalAlpha = opacity * strength * STREAK_GHOSTS[i]!;
            place(sprite, level, x - velocity.x * back, y - velocity.y * back, unit, squeeze, shift);
          }
        }
        ctx.globalAlpha = opacity;
        place(sprite, level, x, y, unit, squeeze, shift);
      }
      ctx.globalAlpha = 1;
    };

    const instance: SaverInstance = {
      step(dtMs) {
        model.step(dtMs);
        if (Number.isFinite(dtMs) && dtMs > 0) breath = (breath + Math.min(dtMs, 10_000) / 1000 / GLOW.breathSeconds) % 1;
      },
      draw() {
        paint(false);
      },
      resize(nextWidth, nextHeight, nextScale) {
        if (nextWidth === width && nextHeight === height && nextScale === scale) return;
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        releaseSprites();
        if (width <= 0 || height <= 0) return;
        // The nearest, largest bean sets the biggest sprite (up to LARGEST); each size below is half the one above.
        const largest = Math.min(LARGEST, ((FAR_LENGTH_SHARE * Math.min(width, height)) / Z_NEAR) * BEAN_SIZE[1] * scale);
        for (let length = Math.max(8, Math.ceil(largest)); length >= 10; length = Math.ceil(length / 2)) {
          const size = spriteSize(length);
          levels.unshift({
            length,
            width: size.width,
            height: size.height,
            samples: length >= 80 ? 2 : length >= 30 ? 3 : 4,
            geometry: [],
            sprites: new Map(),
            keep: Math.max(24, Math.floor(KEEP_PIXELS / (size.width * size.height))),
            image: null,
          });
        }
        glow = makeGlow(doc, Math.ceil(canvas.width * GLOW_SHARE), Math.ceil(canvas.height * GLOW_SHARE));
      },
      still() {
        model = createBeanfieldModel(env.seed);
        breath = 0;
        for (let left = STILL_MS; left > 0; left -= FRAME_MS) instance.step(Math.min(FRAME_MS, left));
        paint(true);
      },
      dispose() {
        releaseSprites();
      },
    };
    return instance;
  },
};

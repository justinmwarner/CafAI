/**
 * Beanfield, after Windows' Starfield (D227): about 180 coffee beans
 * coming toward you through a deep box, small and faint far away, large as
 * they pass, each turning slowly and tumbling so that it now and then shows its
 * back. The beans are pre-drawn into small sprites (one a roast, front and
 * back, at a few sizes) and each frame only places them; where they are is
 * beanfieldModel.ts.
 */
import type { CanvasSaver, SaverInstance } from '../types.ts';
import {
  BEAN_SIZE,
  createBeanfieldModel,
  depthAlpha,
  FAR_LENGTH_SHARE,
  projectBean,
  squeezeOf,
  type Projection,
  Z_NEAR,
} from './beanfieldModel.ts';
import { BEAN_RATIO, drawBean, type BeanSide } from './beanShape.ts';
import { ROASTS } from './roasts.ts';

/** The still is the frame at 6 s. */
const STILL_MS = 6000;
const FRAME_MS = 1000 / 30;
/** Room around a sprite's bean for the rim's outer half. */
const SPRITE_PAD = 2;

export const beanfield: CanvasSaver = {
  id: 'beanfield',
  label: 'Beanfield',
  context: '2d',
  create(canvas, env) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const { palette } = env;
    let model = createBeanfieldModel(env.seed);
    let width = 0;
    let height = 0;
    let scale = 1;
    /** The bean lengths the sprites are drawn at, in device px, smallest first: each about half the next. */
    let levels: number[] = [];
    let sprites: (HTMLCanvasElement | undefined)[] = [];
    const at: Projection = { x: 0, y: 0, length: 0 };

    const makeSprite = (length: number, roast: number, side: BeanSide): HTMLCanvasElement => {
      const sprite = canvas.ownerDocument.createElement('canvas');
      sprite.width = Math.ceil(length) + 2 * SPRITE_PAD;
      sprite.height = Math.ceil(length / BEAN_RATIO) + 2 * SPRITE_PAD;
      const spriteContext = sprite.getContext('2d');
      if (spriteContext) {
        spriteContext.translate(sprite.width / 2, sprite.height / 2);
        drawBean(spriteContext, length, ROASTS[roast]!, side);
      }
      return sprite;
    };

    /** Drawn the first time it is wanted. */
    const spriteFor = (level: number, roast: number, side: BeanSide): HTMLCanvasElement => {
      const index = (level * ROASTS.length + roast) * 2 + (side === 'front' ? 0 : 1);
      let sprite = sprites[index];
      if (!sprite) {
        sprite = makeSprite(levels[level]!, roast, side);
        sprites[index] = sprite;
      }
      return sprite;
    };

    /** The smallest sprite at least as long as this (device px): so a bean is only ever scaled down, by less than half. */
    const levelFor = (deviceLength: number): number => {
      for (let i = 0; i < levels.length; i += 1) if (levels[i]! >= deviceLength) return i;
      return levels.length - 1;
    };

    const releaseSprites = () => {
      for (const sprite of sprites) {
        if (sprite) {
          sprite.width = 0;
          sprite.height = 0;
        }
      }
      sprites = [];
    };

    const draw = () => {
      if (width <= 0 || height <= 0 || levels.length === 0) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let alpha = 1;
      for (const index of model.order) {
        const bean = model.beans[index]!;
        const opacity = depthAlpha(bean.z);
        if (opacity < 0.01) continue;
        projectBean(bean, width, height, at);
        // Off the screen: nothing to draw.
        if (at.x < -at.length || at.x > width + at.length || at.y < -at.length || at.y > height + at.length) continue;
        const squeeze = squeezeOf(bean.tumble);
        const squeezed = Math.abs(squeeze);
        const level = levelFor(at.length * scale);
        const sprite = spriteFor(level, bean.roast, squeeze > 0 ? 'front' : 'back');
        const unit = at.length / levels[level]!;
        const cos = Math.cos(bean.spin) * scale;
        const sin = Math.sin(bean.spin) * scale;
        const kx = bean.squeezesLength ? squeezed : 1;
        const ky = bean.squeezesLength ? 1 : squeezed;
        ctx.setTransform(cos * kx, sin * kx, -sin * ky, cos * ky, at.x * scale, at.y * scale);
        if (opacity !== alpha) {
          ctx.globalAlpha = opacity;
          alpha = opacity;
        }
        ctx.drawImage(sprite, (-sprite.width * unit) / 2, (-sprite.height * unit) / 2, sprite.width * unit, sprite.height * unit);
      }
      ctx.globalAlpha = 1;
    };

    const instance: SaverInstance = {
      step(dtMs) {
        model.step(dtMs);
      },
      draw,
      resize(nextWidth, nextHeight, nextScale) {
        if (nextWidth === width && nextHeight === height && nextScale === scale) return;
        width = nextWidth;
        height = nextHeight;
        scale = nextScale;
        // The nearest, largest bean sets the biggest sprite; each level below is half the one above.
        const largest = ((FAR_LENGTH_SHARE * Math.min(width, height)) / Z_NEAR) * BEAN_SIZE[1] * scale;
        levels = [];
        for (let length = Math.max(8, Math.ceil(largest)); length >= 6; length = Math.ceil(length / 2)) levels.unshift(length);
        releaseSprites();
      },
      still() {
        model = createBeanfieldModel(env.seed);
        for (let left = STILL_MS; left > 0; left -= FRAME_MS) model.step(Math.min(FRAME_MS, left));
        draw();
      },
      dispose() {
        releaseSprites();
        levels = [];
      },
    };
    return instance;
  },
};

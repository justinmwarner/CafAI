/**
 * Beanfield's beans (D227, D264) as pure code: about 180 of them in a
 * deep box coming toward the viewer, each from far away to past the viewer in
 * about 8 s and then, far away again, at a new place. The drawing
 * (beanfield.ts) paints what is here; every random number comes from the seed
 * and every change from step(), so the same seed and steps give the same
 * picture.
 *
 * A bean at (x, y, z) shows at x / z and y / z screen halves from the centre,
 * at a size that grows as 1 / z, so it moves outward faster as it comes, as
 * stars do in Starfield. It leaves the screen's edge a little before it is
 * past the viewer (see CENTRE_CLEAR), and counts as in the box until then.
 * Each rolls about its long axis, so it shows its flat side, its edge and its
 * round back in turn, its long axis keeping its angle on the screen but for a
 * small wobble: so the key light stays where it is on every bean (D264).
 */
import { between, createRandom, wholeBetween, type Random } from '../random.ts';
import { ROASTS } from './roasts.ts';

/** About 180 beans. */
export const BEAN_COUNT = 180;
/** The box: far end, near end (a bean this near is past you), and how long a bean takes from one to the other. */
export const Z_FAR = 1;
export const Z_NEAR = 0.1;
export const CROSSING_MS = 8000;
/** The longest step taken in one go: the host's are a tenth of a second at most, and a broken or endless one must not hang it. */
export const MAX_STEP_MS = 10_000;
/** The box's half width and half height, in screen halves at the far end: a field that fills the middle of the screen far away, and the whole of it as it comes on. */
export const BOX = 0.4;
/**
 * No bean is born closer than this to the middle line of the box, in either
 * direction: it would fly straight at the viewer and be seen to vanish when
 * past. Every bean leaves the screen's edge before it reaches Z_NEAR.
 */
export const CENTRE_CLEAR = 0.13;
/** A bean's length at the far end, as a share of the screen's shorter side. */
export const FAR_LENGTH_SHARE = 0.02;
/** The far part of the box in which beans come out of the page, so none is seen to appear: a share of its depth. */
const FADE_IN_SHARE = 0.12;
/**
 * The haze (D265): a bean far away shows only this much of itself over
 * the page, more as it comes, and all of itself from CLEAR_Z on, so the far
 * ones are dim and near the page's colour and the near ones crisp and full.
 */
export const HAZE_FAR = 0.3;
export const CLEAR_Z = 0.32;
/** Beans differ a little in size: this much of the nominal length, least and most. */
export const BEAN_SIZE: readonly [least: number, most: number] = [0.85, 1.2];
/** How fast the beans come, in depth a second. */
const DEPTH_RATE = ((Z_FAR - Z_NEAR) * 1000) / CROSSING_MS;
/** A bean's wobble about its angle on the screen, rad either way. */
export const WOBBLE = 0.12;

export interface FieldBean {
  /** Place in the box: x and y in [-BOX, BOX], z in [Z_NEAR, Z_FAR]. */
  x: number;
  y: number;
  z: number;
  /** Its long axis's angle on the screen, rad, about which it wobbles a little: its phase, and how fast that goes, rad a second. */
  spin: number;
  wobble: number;
  wobbleRate: number;
  /** Its roll about its long axis, rad (0 shows its flat side, π its back), and how fast. */
  roll: number;
  rollRate: number;
  /** An index into ROASTS. */
  roast: number;
  /** A little of the nominal size: within BEAN_SIZE. */
  size: number;
}

export interface BeanfieldModel {
  readonly beans: FieldBean[];
  /** Indices into `beans`, far to near: the order to draw them in. */
  readonly order: number[];
  /** Beans that went past the viewer and came back far away, since it began. */
  recycled: number;
  step(dtMs: number): void;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * How much of a bean at depth z shows over the page: 0 at the far end, where
 * it is the page's colour, rising quickly to the haze's HAZE_FAR, then
 * through the haze to all of it from CLEAR_Z on.
 */
export function depthAlpha(z: number): number {
  const fadeIn = smooth(clamp01((Z_FAR - z) / (FADE_IN_SHARE * (Z_FAR - Z_NEAR))));
  const haze = 1 - (1 - HAZE_FAR) * smooth(clamp01((z - CLEAR_Z) / (Z_FAR - CLEAR_Z)));
  return fadeIn * haze;
}

export interface Projection {
  /** The bean's centre on the screen, px. */
  x: number;
  y: number;
  /** Its length, px. */
  length: number;
}

/** Where a bean shows on a screen of this size, written into `out`. */
export function projectBean(bean: FieldBean, width: number, height: number, out: Projection): Projection {
  out.x = width / 2 + (bean.x / bean.z) * (width / 2);
  out.y = height / 2 + (bean.y / bean.z) * (height / 2);
  out.length = ((FAR_LENGTH_SHARE * Math.min(width, height)) / bean.z) * bean.size;
  return out;
}

/** The angle a bean's long axis shows at on the screen: its own, wobbling. */
export function turnOf(bean: FieldBean): number {
  return bean.spin + WOBBLE * Math.sin(bean.wobble);
}

/** How fast a bean crosses a screen of this size, px a second, written into `out`: straight out from the middle, faster the nearer it is. */
export function screenVelocity(bean: FieldBean, width: number, height: number, out: { x: number; y: number }): { x: number; y: number } {
  const pull = DEPTH_RATE / (bean.z * bean.z);
  out.x = (width / 2) * bean.x * pull;
  out.y = (height / 2) * bean.y * pull;
  return out;
}

function respawn(bean: FieldBean, z: number, random: Random): void {
  do {
    bean.x = between(random, -BOX, BOX);
    bean.y = between(random, -BOX, BOX);
  } while (Math.max(Math.abs(bean.x), Math.abs(bean.y)) < CENTRE_CLEAR);
  bean.z = z;
  bean.spin = between(random, 0, Math.PI * 2);
  bean.wobble = between(random, 0, Math.PI * 2);
  bean.wobbleRate = between(random, 0.6, 1.3);
  bean.roll = between(random, 0, Math.PI * 2);
  bean.rollRate = between(random, 0.5, 1.3) * (random() < 0.5 ? -1 : 1);
  bean.roast = wholeBetween(random, 0, ROASTS.length - 1);
  bean.size = between(random, BEAN_SIZE[0], BEAN_SIZE[1]);
}

export function createBeanfieldModel(seed: number, count = BEAN_COUNT): BeanfieldModel {
  const random = createRandom(seed);
  const depth = Z_FAR - Z_NEAR;
  const beans: FieldBean[] = [];
  for (let i = 0; i < count; i += 1) {
    const bean: FieldBean = { x: 0, y: 0, z: 0, spin: 0, wobble: 0, wobbleRate: 0, roll: 0, rollRate: 0, roast: 0, size: 1 };
    // The first frame is a whole field, not only a far wall of beans.
    respawn(bean, between(random, Z_NEAR, Z_FAR), random);
    beans.push(bean);
  }
  const order = beans.map((_, i) => i);

  /** Far to near; the order barely changes from one step to the next, so insertion sort. */
  const sortOrder = () => {
    for (let i = 1; i < order.length; i += 1) {
      const index = order[i]!;
      const z = beans[index]!.z;
      let j = i - 1;
      while (j >= 0 && beans[order[j]!]!.z < z) {
        order[j + 1] = order[j]!;
        j -= 1;
      }
      order[j + 1] = index;
    }
  };
  sortOrder();

  const model: BeanfieldModel = {
    beans,
    order,
    recycled: 0,
    step(dtMs) {
      // A broken time is none, and no step is longer than MAX_STEP_MS.
      const ms = Number.isFinite(dtMs) ? Math.min(Math.max(0, dtMs), MAX_STEP_MS) : 0;
      const seconds = ms / 1000;
      const dz = (depth * ms) / CROSSING_MS;
      for (const bean of beans) {
        // Kept within a turn, so a showing of hours loses nothing to rounding.
        bean.wobble = (bean.wobble + bean.wobbleRate * seconds) % (Math.PI * 2);
        bean.roll = (bean.roll + bean.rollRate * seconds) % (Math.PI * 2);
        bean.z -= dz;
        if (bean.z < Z_NEAR) {
          // Past the viewer: far away again at a new place, keeping the part of the step it overshot by.
          const z = bean.z + depth * Math.ceil((Z_NEAR - bean.z) / depth);
          respawn(bean, Math.min(Z_FAR, z), random);
          model.recycled += 1;
        }
      }
      sortOrder();
    },
  };
  return model;
}

/**
 * Beanfield's beans (D-SAVER-5) as pure code: about 180 of them in a deep box
 * coming toward the viewer, each from far away to past the viewer in about 8 s
 * and then, far away again, at a new place. The drawing (beanfield.ts) paints
 * what is here; every random number comes from the seed and every change from
 * step(), so the same seed and steps give the same picture.
 *
 * A bean at (x, y, z) shows at x / z and y / z screen halves from the centre,
 * at a size that grows as 1 / z, so it moves outward faster as it comes, as
 * stars do in Starfield. It leaves the screen's edge a little before it is
 * past the viewer (see CENTRE_CLEAR), and counts as in the box until then.
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
/** The far part of the box in which beans fade in from the page, as a share of its depth. */
const FADE_IN_SHARE = 0.3;
/** Beans differ a little in size: this much of the nominal length, least and most. */
export const BEAN_SIZE: readonly [least: number, most: number] = [0.85, 1.2];
/** The least a tumbling bean is squeezed (edge-on), so it never vanishes. */
export const MIN_SQUEEZE = 0.1;

export interface FieldBean {
  /** Place in the box: x and y in [-BOX, BOX], z in [Z_NEAR, Z_FAR]. */
  x: number;
  y: number;
  z: number;
  /** Its turning in the picture's plane, rad, and how fast, rad a second. */
  spin: number;
  spinRate: number;
  /** Its tumbling: the cosine of this squeezes one axis, and turns the bean over when it goes below zero. */
  tumble: number;
  tumbleRate: number;
  /** Which axis the tumble squeezes: its length, or else its width. */
  squeezesLength: boolean;
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

/** How opaque a bean at depth z is: 0 at the far end, where it is the page's colour, and 1 from a third of the way in. */
export function depthAlpha(z: number): number {
  const t = (Z_FAR - z) / (FADE_IN_SHARE * (Z_FAR - Z_NEAR));
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** What a tumbling bean shows: the cosine of its phase, kept clear of zero. Below zero it has turned over and shows its back. */
export function squeezeOf(tumble: number): number {
  const c = Math.cos(tumble);
  return Math.abs(c) < MIN_SQUEEZE ? (c < 0 ? -MIN_SQUEEZE : MIN_SQUEEZE) : c;
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

function respawn(bean: FieldBean, z: number, random: Random): void {
  do {
    bean.x = between(random, -BOX, BOX);
    bean.y = between(random, -BOX, BOX);
  } while (Math.max(Math.abs(bean.x), Math.abs(bean.y)) < CENTRE_CLEAR);
  bean.z = z;
  bean.spin = between(random, 0, Math.PI * 2);
  bean.spinRate = between(random, 0.15, 0.55) * (random() < 0.5 ? -1 : 1);
  bean.tumble = between(random, 0, Math.PI * 2);
  bean.tumbleRate = between(random, 0.7, 1.8) * (random() < 0.5 ? -1 : 1);
  bean.squeezesLength = random() < 0.35;
  bean.roast = wholeBetween(random, 0, ROASTS.length - 1);
  bean.size = between(random, BEAN_SIZE[0], BEAN_SIZE[1]);
}

export function createBeanfieldModel(seed: number, count = BEAN_COUNT): BeanfieldModel {
  const random = createRandom(seed);
  const depth = Z_FAR - Z_NEAR;
  const beans: FieldBean[] = [];
  for (let i = 0; i < count; i += 1) {
    const bean: FieldBean = {
      x: 0,
      y: 0,
      z: 0,
      spin: 0,
      spinRate: 0,
      tumble: 0,
      tumbleRate: 0,
      squeezesLength: false,
      roast: 0,
      size: 1,
    };
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
        bean.spin += bean.spinRate * seconds;
        bean.tumble += bean.tumbleRate * seconds;
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

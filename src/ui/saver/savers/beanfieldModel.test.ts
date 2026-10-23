import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import {
  BEAN_COUNT,
  BOX,
  CENTRE_CLEAR,
  CROSSING_MS,
  createBeanfieldModel,
  depthAlpha,
  FAR_LENGTH_SHARE,
  MIN_SQUEEZE,
  projectBean,
  squeezeOf,
  type BeanfieldModel,
  type FieldBean,
  type Projection,
  Z_FAR,
  Z_NEAR,
} from './beanfieldModel.ts';
import { ROASTS } from './roasts.ts';

const FRAME_MS = 1000 / 30;

function stepFor(model: BeanfieldModel, ms: number, frameMs = FRAME_MS): void {
  for (let left = ms; left > 0; left -= frameMs) model.step(Math.min(frameMs, left));
}

function bean(patch: Partial<FieldBean> = {}): FieldBean {
  return { x: 0, y: 0, z: 0.5, spin: 0, spinRate: 0, tumble: 0, tumbleRate: 0, squeezesLength: false, roast: 0, size: 1, ...patch };
}

function insideTheBox(model: BeanfieldModel): void {
  for (const b of model.beans) {
    expect(Math.abs(b.x)).toBeLessThanOrEqual(BOX);
    expect(Math.abs(b.y)).toBeLessThanOrEqual(BOX);
    expect(Math.max(Math.abs(b.x), Math.abs(b.y))).toBeGreaterThanOrEqual(CENTRE_CLEAR);
    expect(b.z).toBeGreaterThanOrEqual(Z_NEAR);
    expect(b.z).toBeLessThanOrEqual(Z_FAR);
  }
}

describe('the beans', () => {
  it('number about 180, through the whole depth of the box from the first frame', () => {
    const model = createBeanfieldModel(1);
    expect(model.beans).toHaveLength(BEAN_COUNT);
    expect(BEAN_COUNT).toBe(180);
    insideTheBox(model);
    const far = model.beans.filter((b) => b.z > 0.7 * Z_FAR).length;
    const near = model.beans.filter((b) => b.z < 0.3 * Z_FAR).length;
    expect(far).toBeGreaterThan(30);
    expect(near).toBeGreaterThan(30);
  });

  it('give the same state after the same steps, and another for another seed', () => {
    const run = (seed: number) => {
      const model = createBeanfieldModel(seed);
      const dts = createRandom(5);
      for (let i = 0; i < 2000; i += 1) model.step(5 + dts() * 95);
      return { beans: model.beans, order: model.order, recycled: model.recycled };
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it('are all off the screen by the time they are past the viewer, so none is seen to vanish', () => {
    // At Z_NEAR a bean is this many screen halves out; its own half length needs well under the first one.
    const out = CENTRE_CLEAR / Z_NEAR;
    expect(out).toBeGreaterThan(1.2);
    const model = createBeanfieldModel(1);
    const at: Projection = { x: 0, y: 0, length: 0 };
    for (let i = 0; i < 20; i += 1) {
      stepFor(model, 1500);
      for (const b of model.beans) {
        projectBean({ ...b, z: Z_NEAR }, 962, 602, at);
        const reach = at.length / 2;
        const off = at.x + reach < 0 || at.x - reach > 962 || at.y + reach < 0 || at.y - reach > 602;
        expect(off).toBe(true);
      }
    }
  });

  it('stay in the box, whatever the steps, even one of twenty seconds', () => {
    const model = createBeanfieldModel(2);
    const dts = createRandom(8);
    for (let i = 0; i < 3000; i += 1) {
      model.step(1 + dts() * 99);
      if (i % 300 === 0) insideTheBox(model);
    }
    insideTheBox(model);
    model.step(20_000);
    insideTheBox(model);
  });

  it('come toward the viewer, the whole depth of the box in 8 s', () => {
    const model = createBeanfieldModel(1);
    const before = model.beans.map((b) => b.z);
    model.step(100);
    const dz = ((Z_FAR - Z_NEAR) * 100) / CROSSING_MS;
    let moved = 0;
    model.beans.forEach((b, i) => {
      if (b.z < before[i]!) {
        expect(before[i]! - b.z).toBeCloseTo(dz, 9);
        moved += 1;
      }
    });
    expect(moved).toBeGreaterThan(BEAN_COUNT - 5);
    expect(CROSSING_MS).toBe(8000);
  });

  it('take about 8 s from far to past you, then are far away again at a new place and in new colours', () => {
    const model = createBeanfieldModel(7, 1);
    const only = model.beans[0]!;
    // Run to its first recycling, then time the next whole crossing.
    let guard = 0;
    while (model.recycled === 0 && guard < 1000) {
      model.step(FRAME_MS);
      guard += 1;
    }
    expect(model.recycled).toBe(1);
    expect(only.z).toBeGreaterThan(Z_FAR - 0.02);
    const placeBefore = { x: only.x, y: only.y, roast: only.roast, size: only.size };
    let time = 0;
    while (model.recycled === 1 && time < 20_000) {
      model.step(FRAME_MS);
      time += FRAME_MS;
    }
    expect(model.recycled).toBe(2);
    expect(Math.abs(time - CROSSING_MS)).toBeLessThanOrEqual(2 * FRAME_MS);
    expect(only.z).toBeGreaterThan(Z_FAR - 0.02);
    expect(`${only.x},${only.y}`).not.toBe(`${placeBefore.x},${placeBefore.y}`);
  });

  it('are recycled at about one in eight a second, a field that never runs out', () => {
    const model = createBeanfieldModel(1);
    stepFor(model, 16_000);
    expect(model.recycled).toBeGreaterThan(BEAN_COUNT * 2 * 0.9);
    expect(model.recycled).toBeLessThan(BEAN_COUNT * 2 * 1.1);
  });

  it('keep the draw order far to near', () => {
    const model = createBeanfieldModel(5);
    for (let i = 0; i < 400; i += 1) {
      model.step(FRAME_MS);
      if (i % 40 === 0) {
        expect(new Set(model.order).size).toBe(BEAN_COUNT);
        for (let k = 1; k < model.order.length; k += 1) {
          expect(model.beans[model.order[k - 1]!]!.z).toBeGreaterThanOrEqual(model.beans[model.order[k]!]!.z);
        }
      }
    }
  });

  it('come in all seven roasts, green to dark', () => {
    const model = createBeanfieldModel(1);
    stepFor(model, 10_000);
    const counts = new Array<number>(ROASTS.length).fill(0);
    for (const b of model.beans) counts[b.roast] = counts[b.roast]! + 1;
    for (const count of counts) expect(count).toBeGreaterThan(8);
  });

  it('turn slowly and tumble, a flip now and then', () => {
    const model = createBeanfieldModel(2);
    for (const b of model.beans) {
      expect(Math.abs(b.spinRate)).toBeLessThanOrEqual(0.55);
      expect(Math.abs(b.tumbleRate)).toBeGreaterThanOrEqual(0.7);
    }
    const first = model.beans.map((b) => ({ spin: b.spin, tumble: b.tumble, z: b.z }));
    model.step(500);
    model.beans.forEach((b, i) => {
      if (b.z < first[i]!.z) {
        expect(b.spin).not.toBe(first[i]!.spin);
        expect(b.tumble).not.toBe(first[i]!.tumble);
      }
    });
    // Over a few seconds some bean is on its face and some on its back.
    stepFor(model, 3000);
    expect(model.beans.some((b) => squeezeOf(b.tumble) > 0)).toBe(true);
    expect(model.beans.some((b) => squeezeOf(b.tumble) < 0)).toBe(true);
    expect(model.beans.some((b) => b.squeezesLength)).toBe(true);
    expect(model.beans.some((b) => !b.squeezesLength)).toBe(true);
  });
});

describe('squeezeOf', () => {
  it('is the cosine of the phase, and never quite zero', () => {
    expect(squeezeOf(0)).toBe(1);
    expect(squeezeOf(Math.PI)).toBe(-1);
    expect(squeezeOf(Math.PI / 3)).toBeCloseTo(0.5, 9);
    expect(squeezeOf(Math.PI / 2)).toBe(MIN_SQUEEZE);
    expect(squeezeOf(-Math.PI / 2 + 0.01)).toBe(MIN_SQUEEZE);
    expect(squeezeOf((3 * Math.PI) / 2 + 0.001)).toBe(MIN_SQUEEZE);
    expect(squeezeOf(Math.PI / 2 + 0.01)).toBe(-MIN_SQUEEZE);
  });
});

describe('depthAlpha', () => {
  it('fades the far beans in from the page', () => {
    expect(depthAlpha(Z_FAR)).toBe(0);
    expect(depthAlpha(Z_NEAR)).toBe(1);
    expect(depthAlpha(0.5)).toBe(1);
    let last = 0;
    for (let z = Z_FAR; z >= Z_NEAR; z -= 0.01) {
      const alpha = depthAlpha(z);
      expect(alpha).toBeGreaterThanOrEqual(last - 1e-12);
      last = alpha;
    }
    expect(depthAlpha(Z_FAR - 0.05)).toBeLessThan(0.2);
  });
});

describe('projectBean', () => {
  const out: Projection = { x: 0, y: 0, length: 0 };

  it('shows a bean in the middle of the box in the middle of the screen', () => {
    projectBean(bean({ x: 0, y: 0, z: 0.4 }), 962, 602, out);
    expect(out.x).toBeCloseTo(481, 9);
    expect(out.y).toBeCloseTo(301, 9);
  });

  it('shows a bean right of centre at the right, and further out the nearer it comes', () => {
    const far = { ...projectBean(bean({ x: 0.4, y: -0.2, z: 1 }), 962, 602, out) };
    const near = { ...projectBean(bean({ x: 0.4, y: -0.2, z: 0.5 }), 962, 602, out) };
    expect(far.x).toBeGreaterThan(481);
    expect(far.y).toBeLessThan(301);
    expect(near.x - 481).toBeCloseTo(2 * (far.x - 481), 9);
    expect(301 - near.y).toBeCloseTo(2 * (301 - far.y), 9);
  });

  it('draws a bean larger the nearer it is: tiny far away, big as it passes', () => {
    const far = projectBean(bean({ z: Z_FAR }), 962, 602, out).length;
    expect(far).toBeCloseTo(FAR_LENGTH_SHARE * 602, 9);
    expect(far).toBeLessThan(16);
    const near = projectBean(bean({ z: Z_NEAR }), 962, 602, out).length;
    expect(near / far).toBeCloseTo(Z_FAR / Z_NEAR, 9);
    expect(near).toBeGreaterThan(80);
    expect(near).toBeLessThan(160);
  });

  it('puts a bean at the screen edge where its x is as far from the middle as its z', () => {
    projectBean(bean({ x: 1, y: 1, z: 1 }), 962, 602, out);
    expect(out.x).toBeCloseTo(962, 9);
    expect(out.y).toBeCloseTo(602, 9);
  });
});

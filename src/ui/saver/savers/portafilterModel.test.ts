import { describe, expect, it } from 'vitest';
import { createRandom } from '../random.ts';
import {
  BADGE_SPEED,
  badgeWidth,
  BURST_BEANS,
  BURST_MS,
  burstAlpha,
  CORNER_LABEL_MS,
  cornerLabelAlpha,
  createPortafilterModel,
  FIRST_CORNER_MS,
  type PortafilterModel,
  type PortafilterStart,
} from './portafilterModel.ts';
import { ROASTS } from './roasts.ts';

const FRAME_MS = 1000 / 30;

/** A model on a 962×602 screen, set down where a test says (or on the seeded path). */
function model(seed = 1, start?: PortafilterStart, width = 962, height = 602): PortafilterModel {
  const made = createPortafilterModel(seed, start);
  made.resize(width, height);
  return made;
}

function stepFor(made: PortafilterModel, ms: number, frameMs = FRAME_MS): void {
  for (let left = ms; left > 0; left -= frameMs) made.step(Math.min(frameMs, left));
}

/** The state a picture is made of. */
function snapshot(made: PortafilterModel) {
  const { x, y, w, h, vx, vy, roast, walls, corners, cornerAge, burst } = made;
  return { x, y, w, h, vx, vy, roast, walls, corners, cornerAge, burst };
}

describe('the badge', () => {
  it('is about a fifth of the screen wide, and never more than half of it', () => {
    const made = model();
    expect(made.w).toBeCloseTo(962 * 0.2, 5);
    expect(made.h / made.w).toBeGreaterThan(0.45);
    expect(made.h / made.w).toBeLessThan(0.65);
    expect(badgeWidth(100)).toBe(50);
    expect(badgeWidth(300)).toBe(120);
    expect(badgeWidth(2000)).toBe(400);
  });

  it('is set down at a seeded place, the same one every time and another for another seed', () => {
    expect(snapshot(model(7))).toEqual(snapshot(model(7)));
    const places = new Set([1, 2, 3, 4, 5, 6].map((seed) => `${model(seed).x.toFixed(2)},${model(seed).y.toFixed(2)}`));
    expect(places.size).toBeGreaterThan(4);
  });

  it('is set down well clear of the walls, so the still shows the whole badge in the open', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const [width, height] of [
        [962, 602],
        [1280, 800],
      ] as const) {
        const made = model(seed, undefined, width, height);
        const rangeX = width - made.w;
        const rangeY = height - made.h;
        expect(made.x, `seed ${seed}`).toBeGreaterThanOrEqual(rangeX * 0.12);
        expect(made.x, `seed ${seed}`).toBeLessThanOrEqual(rangeX * 0.88);
        expect(made.y, `seed ${seed}`).toBeGreaterThanOrEqual(rangeY * 0.12);
        expect(made.y, `seed ${seed}`).toBeLessThanOrEqual(rangeY * 0.88);
      }
    }
  });

  it('drifts at 70 px a second on both axes, whichever way it heads', () => {
    for (const seed of [1, 2, 3, 4]) {
      const made = model(seed);
      expect(Math.abs(made.vx)).toBe(BADGE_SPEED);
      expect(Math.abs(made.vy)).toBe(BADGE_SPEED);
    }
    const made = model(1, { x: 300, y: 200, vx: 70, vy: -70, roast: 0 });
    stepFor(made, 1000);
    expect(made.x).toBeCloseTo(370, 3);
    expect(made.y).toBeCloseTo(130, 3);
  });

  it('gives the same state after the same steps, and another for another seed', () => {
    const run = (seed: number) => {
      const made = model(seed);
      const dts = createRandom(99);
      for (let i = 0; i < 3000; i += 1) made.step(5 + dts() * 95);
      return snapshot(made);
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('stays inside the screen for half an hour of uneven frames', () => {
    for (const seed of [1, 2, 3]) {
      const made = model(seed);
      const dts = createRandom(seed + 10);
      let time = 0;
      while (time < 30 * 60_000) {
        const dt = 8 + dts() * 92;
        made.step(dt);
        time += dt;
        expect(made.x).toBeGreaterThanOrEqual(0);
        expect(made.y).toBeGreaterThanOrEqual(0);
        expect(made.x + made.w).toBeLessThanOrEqual(made.width + 1e-9);
        expect(made.y + made.h).toBeLessThanOrEqual(made.height + 1e-9);
      }
    }
  });

  it('keeps its place in proportion when the screen changes size', () => {
    const made = model(3);
    const shareX = made.x / (962 - made.w);
    const shareY = made.y / (602 - made.h);
    made.resize(1280, 800);
    expect(made.w).toBeCloseTo(256, 5);
    expect(made.x / (1280 - made.w)).toBeCloseTo(shareX, 6);
    expect(made.y / (800 - made.h)).toBeCloseTo(shareY, 6);
    made.resize(400, 300);
    expect(made.x + made.w).toBeLessThanOrEqual(400 + 1e-9);
    expect(made.y + made.h).toBeLessThanOrEqual(300 + 1e-9);
  });

  it('copes with a screen shorter than the badge', () => {
    const made = model(1, undefined, 962, 60);
    stepFor(made, 60_000);
    expect(made.y).toBe(0);
    expect(Number.isFinite(made.x)).toBe(true);
    expect(made.walls).toBeGreaterThan(0);
    expect(made.corners).toBe(0);
  });
});

describe('the walls and the roasts', () => {
  it('turns back at a wall and moves the colour one roast along', () => {
    const made = model(1, { x: 5, y: 300, vx: -70, vy: 70, roast: 2 });
    made.step(100);
    expect(made.x).toBeCloseTo(2, 5);
    expect(made.vx).toBe(70);
    expect(made.vy).toBe(70);
    expect(made.walls).toBe(1);
    expect(made.roast).toBe(3);
    expect(made.corners).toBe(0);
    expect(made.burst).toEqual([]);
  });

  it('turns back at the far walls too', () => {
    const right = model(1, { x: 962 * 0.8 - 1, y: 100, vx: 70, vy: 70, roast: 0 });
    right.step(100);
    expect(right.vx).toBe(-70);
    expect(right.x + right.w).toBeLessThan(962);
    expect(right.roast).toBe(1);
    const bottom = model(1, { x: 100, y: 602 - 0.56 * 192.4 - 1, vx: 70, vy: 70, roast: 0 });
    bottom.step(100);
    expect(bottom.vy).toBe(-70);
    expect(bottom.roast).toBe(1);
  });

  it('goes round: French is followed by green', () => {
    const made = model(1, { x: 5, y: 300, vx: -70, vy: 70, roast: ROASTS.length - 1 });
    made.step(100);
    expect(made.roast).toBe(0);
  });

  it('walks every roast in turn along a long run', () => {
    const made = model(2);
    const seen: number[] = [made.roast];
    let walls = made.walls;
    for (let i = 0; i < 20 * 30 * 60; i += 1) {
      made.step(FRAME_MS);
      if (made.walls !== walls) {
        walls = made.walls;
        seen.push(made.roast);
      }
    }
    expect(seen.length).toBeGreaterThan(14);
    for (let i = 1; i < seen.length; i += 1) {
      // A corner moves two roasts at once; a lone wall moves one.
      const step = (seen[i]! - seen[i - 1]! + ROASTS.length) % ROASTS.length;
      expect([1, 2]).toContain(step);
    }
    expect(new Set(seen).size).toBe(ROASTS.length);
  });
});

describe('the corners', () => {
  it('counts a corner when both walls are met in the one step, moving the colour two roasts', () => {
    const made = model(1, { x: 3, y: 3, vx: -70, vy: -70, roast: 1 });
    made.step(100);
    expect(made.corners).toBe(1);
    expect(made.walls).toBe(2);
    expect(made.roast).toBe(3);
    expect(made.cornerAge).toBe(0);
  });

  it('throws a dozen beans into the screen from the corner it found, fading over 1.2 s', () => {
    const topLeft = model(1, { x: 3, y: 3, vx: -70, vy: -70, roast: 0 });
    topLeft.step(100);
    expect(topLeft.burst).toHaveLength(BURST_BEANS);
    expect(BURST_BEANS).toBe(12);
    for (const bean of topLeft.burst) {
      expect(bean.vx).toBeGreaterThan(0);
      expect(bean.vy).toBeGreaterThan(0);
      expect(bean.age).toBe(0);
      expect(bean.length).toBeGreaterThan(12);
      expect(bean.length).toBeLessThan(32);
    }
    const bottomRight = model(1, { x: 962 * 0.8 - 1, y: 602 - 0.56 * 192.4 - 1, vx: 70, vy: 70, roast: 0 });
    bottomRight.step(100);
    expect(bottomRight.corners).toBe(1);
    for (const bean of bottomRight.burst) {
      expect(bean.vx).toBeLessThan(0);
      expect(bean.vy).toBeLessThan(0);
      expect(bean.x).toBeGreaterThan(900);
      expect(bean.y).toBeGreaterThan(500);
    }
    stepFor(topLeft, 600);
    expect(topLeft.burst).toHaveLength(BURST_BEANS);
    expect(burstAlpha(topLeft.burst[0]!.age)).toBeCloseTo(0.5, 1);
    stepFor(topLeft, 700);
    expect(topLeft.burst).toEqual([]);
  });

  it('fades a bean from 1 to 0 over 1.2 s', () => {
    expect(burstAlpha(0)).toBe(1);
    expect(burstAlpha(BURST_MS / 2)).toBeCloseTo(0.5, 5);
    expect(burstAlpha(BURST_MS)).toBe(0);
    expect(burstAlpha(5000)).toBe(0);
  });

  it('shows "Corner N" for 3 s, fading at the end, and counts on', () => {
    const made = model(1, { x: 3, y: 3, vx: -70, vy: -70, roast: 0 });
    expect(cornerLabelAlpha(made.cornerAge)).toBe(0);
    made.step(100);
    expect(made.corners).toBe(1);
    expect(cornerLabelAlpha(made.cornerAge)).toBe(1);
    stepFor(made, 2000);
    expect(cornerLabelAlpha(made.cornerAge)).toBe(1);
    stepFor(made, 800);
    expect(cornerLabelAlpha(made.cornerAge)).toBeGreaterThan(0);
    expect(cornerLabelAlpha(made.cornerAge)).toBeLessThan(1);
    stepFor(made, 400);
    expect(made.cornerAge).toBeGreaterThan(CORNER_LABEL_MS);
    expect(cornerLabelAlpha(made.cornerAge)).toBe(0);
    // Put the badge at another corner: the second is "Corner 2" and the label starts over.
    made.x = 962 - made.w - 3;
    made.y = 602 - made.h - 3;
    made.vx = 70;
    made.vy = 70;
    made.step(100);
    expect(made.corners).toBe(2);
    expect(cornerLabelAlpha(made.cornerAge)).toBe(1);
  });

  it('does not count two walls in two different steps', () => {
    const made = model(1, { x: 3, y: 300, vx: -70, vy: 70, roast: 0 });
    made.step(100);
    made.y = 602 - made.h - 3;
    made.step(100);
    expect(made.walls).toBe(2);
    expect(made.corners).toBe(0);
  });

  it('finds its first corner when it was planned to, a minute or so in, whatever the seed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const made = model(seed);
      const due = made.firstCornerMs!;
      expect(due).toBeGreaterThanOrEqual(FIRST_CORNER_MS[0]);
      expect(due).toBeLessThanOrEqual(FIRST_CORNER_MS[1]);
      let time = 0;
      while (made.corners === 0 && time < due + 5000) {
        made.step(FRAME_MS);
        time += FRAME_MS;
      }
      expect(made.corners, `seed ${seed}`).toBe(1);
      expect(Math.abs(time - due), `seed ${seed}`).toBeLessThanOrEqual(FRAME_MS + 1);
    }
  });

  it('finds that corner whatever the frame length, steps of a tenth of a second included', () => {
    for (const frameMs of [16.7, 33.3, 100]) {
      const made = model(4);
      const due = made.firstCornerMs!;
      stepFor(made, due - 2 * frameMs, frameMs);
      expect(made.corners).toBe(0);
      stepFor(made, 4 * frameMs, frameMs);
      expect(made.corners).toBe(1);
    }
  });

  it('plans no corner for a badge put down by hand, nor after the screen changes size', () => {
    expect(model(1, { x: 10, y: 10, vx: 70, vy: 70, roast: 0 }).firstCornerMs).toBeNull();
    const made = model(2);
    expect(made.firstCornerMs).not.toBeNull();
    made.resize(1000, 700);
    expect(made.firstCornerMs).toBeNull();
  });

  it('is a rare thing after the first: not one a minute', () => {
    const made = model(3);
    stepFor(made, 30 * 60_000);
    expect(made.corners).toBeGreaterThanOrEqual(1);
    expect(made.corners).toBeLessThan(10);
  });
});

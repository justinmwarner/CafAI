import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../color.ts';
import { paletteFor } from '../../appearance.ts';
import { COFFEE_HALF_WIDTH, CUP_SCALE, MOUTH_HALF_WIDTH, RIM_HALF_WIDTH } from './steamModel.ts';
import {
  BEAD_Y,
  COFFEE_LEVEL,
  COFFEE_RADIUS,
  cupShadow,
  innerRadius,
  KEY_AT,
  onScreen,
  outerRadius,
  renderStillLife,
  RIM_TOP,
  SAUCER_BELOW_RIM,
  SAUCER_RADIUS,
  type StillLife,
} from './steamStill.ts';

const PAGE = paletteFor({ mode: 'dark', tint: 'crema' }, false).background;
/** Small, so the tests are quick; the screen's own scale is 1.33 or so. */
const SCALE = 0.7;
const still = renderStillLife({ pixelsPerUnit: SCALE, background: PAGE, seed: 1 });

/** The pixel of an image under a point of the still life's world. */
function pixelAt(image: StillLife, which: 'back' | 'front', x: number, y: number, z: number): [number, number, number, number] {
  const at = onScreen(x, y, z);
  const px = Math.round(image.originX + at.x * SCALE);
  const py = Math.round(image.originY + at.y * SCALE);
  const i = (py * image.width + px) * 4;
  const data = image[which];
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
}

const hex = ([r, g, b]: readonly number[]) => `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
const lightness = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

/** Points of the scene: the cup's near wall partway down, the middle of the coffee, the saucer in front of the cup, the far rim. */
type Point = readonly [number, number, number];
const WALL: Point = [0, RIM_TOP - 30, outerRadius(RIM_TOP - 30) - 0.5];
const COFFEE: Point = [0, COFFEE_LEVEL, -COFFEE_RADIUS * 0.3];
const SAUCER: Point = [-70, 7, 70];
const FAR_RIM: Point = [0, RIM_TOP - 0.3, -outerRadius(RIM_TOP - 2.2)];

describe('the still life', () => {
  it('is rendered round the middle of the rim, the saucer and its shadow inside the image', () => {
    expect(still.width).toBeGreaterThan(200);
    expect(still.height).toBeGreaterThan(100);
    expect(Number.isInteger(still.originX) && Number.isInteger(still.originY)).toBe(true);
    expect(still.back.length).toBe(still.width * still.height * 4);
    expect(still.front.length).toBe(still.back.length);
    // Opaque where the cup, the coffee and the saucer are; nothing in the far corners, the table there unlit and unshaded.
    for (const point of [WALL, COFFEE, SAUCER, FAR_RIM]) expect(pixelAt(still, 'back', ...point)[3]).toBe(255);
    expect(still.back[3]).toBe(0);
    expect(still.back[(still.width - 1) * 4 + 3]).toBe(0);
    // The saucer's near edge is where steam.ts puts it.
    const edge = onScreen(0, BEAD_Y, SAUCER_RADIUS);
    expect(edge.y).toBeCloseTo(SAUCER_BELOW_RIM, 6);
  });

  it('is the same for the same options; the seed changes only the crema', () => {
    const again = renderStillLife({ pixelsPerUnit: SCALE, background: PAGE, seed: 1 });
    expect(again.back).toEqual(still.back);
    expect(again.front).toEqual(still.front);
    const other = renderStillLife({ pixelsPerUnit: SCALE, background: PAGE, seed: 2 });
    expect(other.back).not.toEqual(still.back);
    expect(pixelAt(other, 'back', ...WALL)).toEqual(pixelAt(still, 'back', ...WALL));
    expect(pixelAt(other, 'back', ...SAUCER)).toEqual(pixelAt(still, 'back', ...SAUCER));
  });

  it('lights the cup a warm white, holds the coffee dark under its crema, and keeps them clear of the page', () => {
    const wall = pixelAt(still, 'back', ...WALL);
    const coffee = pixelAt(still, 'back', ...COFFEE);
    // Porcelain: light, a warm white (no blue cast), and at least 3:1 on the page, as the subject must be on a dimmed screen.
    expect(lightness(wall)).toBeGreaterThan(140);
    expect(wall[0]).toBeGreaterThanOrEqual(wall[2]);
    expect(contrastRatio(hex(wall), PAGE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hex(pixelAt(still, 'back', ...SAUCER)), PAGE)).toBeGreaterThanOrEqual(3);
    // Coffee: far darker than the cup, and brown.
    expect(lightness(coffee)).toBeLessThan(lightness(wall) * 0.6);
    expect(coffee[0]).toBeGreaterThan(coffee[1]);
    expect(coffee[1]).toBeGreaterThan(coffee[2]);
    // The rim catches the light more than the wall below it.
    expect(lightness(pixelAt(still, 'back', ...FAR_RIM))).toBeGreaterThan(lightness(wall) * 0.9);
  });

  it('gives steam.ts the cup’s near side alone, to lay over the steam that rises inside it', () => {
    expect(pixelAt(still, 'front', ...WALL)[3]).toBe(255);
    expect(pixelAt(still, 'front', ...WALL).slice(0, 3)).toEqual(pixelAt(still, 'back', ...WALL).slice(0, 3));
    // The near lip is in front; the coffee, the far rim and the saucer are not.
    expect(pixelAt(still, 'front', 0, RIM_TOP - 0.3, outerRadius(RIM_TOP - 2.2))[3]).toBeGreaterThan(200);
    for (const point of [COFFEE, FAR_RIM, SAUCER]) expect(pixelAt(still, 'front', ...point)[3]).toBe(0);
  });

  it('throws its shadow forward, away from the light behind, darker in front of the saucer than toward the light', () => {
    // The table as far from the saucer's middle, in front of it and off to its far side, toward the light.
    const inFront = pixelAt(still, 'back', 30, 0, SAUCER_RADIUS + 14);
    const towardLight = pixelAt(still, 'back', -SAUCER_RADIUS - 15, 0, -30);
    // On the table, the shadow is black at some alpha over the page.
    expect(inFront[3]).toBeGreaterThan(towardLight[3] + 20);
    expect(inFront.slice(0, 3)).toEqual([0, 0, 0]);
    // On the saucer: in front of the cup and to the right, away from the key, it is in the cup's shadow; behind and to the left, lit.
    const towardKey = (x: number, y: number, z: number) => {
      const d = [KEY_AT[0] - x, KEY_AT[1] - y, KEY_AT[2] - z];
      const length = Math.hypot(d[0]!, d[1]!, d[2]!);
      return [d[0]! / length, d[1]! / length, d[2]! / length] as const;
    };
    expect(cupShadow(25, 6, 95, ...towardKey(25, 6, 95))).toBeLessThan(0.5);
    expect(cupShadow(-40, 6, -95, ...towardKey(-40, 6, -95))).toBe(1);
  });

  it('is the cup the steam rises from: its rim, its mouth and its coffee are steamModel.ts’s', () => {
    expect(outerRadius(RIM_TOP - 3) * CUP_SCALE).toBeCloseTo(RIM_HALF_WIDTH, 0);
    expect(innerRadius(RIM_TOP - 3) * CUP_SCALE).toBeCloseTo(MOUTH_HALF_WIDTH, 0);
    expect(Math.abs(COFFEE_RADIUS * CUP_SCALE - COFFEE_HALF_WIDTH)).toBeLessThan(0.6);
    // Narrower toward the foot, as a bowl is.
    expect(outerRadius(20)).toBeLessThan(outerRadius(60));
    expect(outerRadius(RIM_TOP + 1)).toBe(0);
  });

  it('scales with the screen: twice the pixels a unit, twice the image', () => {
    const big = renderStillLife({ pixelsPerUnit: SCALE * 2, background: PAGE, seed: 1 });
    expect(Math.abs(big.width - still.width * 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(big.height - still.height * 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(big.originX - still.originX * 2)).toBeLessThanOrEqual(1);
  });
});

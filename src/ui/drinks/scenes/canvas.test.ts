import { describe, expect, it } from 'vitest';
import { hexToOklab } from '../../color.ts';
import { BOX, CHECK, clamp, drawFiguresMask, drawPuff, ease, FIGURES, movePuffs, smooth, type Puff } from './canvas.ts';
import { stubContext } from './testing/stubContext.ts';

const puff = (over: Partial<Puff> = {}): Puff => ({ x: 100, y: 180, vx: 0, vy: -20, r: 6, grow: 8, age: 1, max: 4, alpha: 0.2, seed: 0, ...over });

describe('the scenes’ helpers', () => {
  it('eases toward a target, never past it', () => {
    expect(smooth(0, 1, 0, 0.3)).toBe(0);
    const once = smooth(0, 1, 0.1, 0.3);
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan(1);
    expect(smooth(0, 1, 10, 0.3)).toBeCloseTo(1, 6);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.75);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it('moves puffs up and on, growing, and drops the spent ones', () => {
    const rising = puff();
    const spent = puff({ age: 3.99 });
    const left = movePuffs([rising, spent], 0.05, 0);
    expect(left).toEqual([rising]);
    expect(rising.y).toBeLessThan(180);
    expect(rising.r).toBeGreaterThan(6);
  });

  it('draws a puff soft-edged, and nothing for one too faint to see', () => {
    const ctx = stubContext();
    drawPuff(ctx, puff(), hexToOklab('#ffffff'), 1);
    expect(ctx.calls.map((c) => c.name)).toEqual(['createRadialGradient', 'addColorStop', 'addColorStop', 'addColorStop', 'set fillStyle', 'beginPath', 'arc', 'fill']);
    const faint = stubContext();
    drawPuff(faint, puff({ age: 0 }), hexToOklab('#ffffff'), 1);
    expect(faint.calls).toEqual([]);
  });

  it('cuts out the figures, and the check too once done, at the canvas’s size', () => {
    const live = stubContext();
    drawFiguresMask(live, 544, false);
    expect(live.calls.filter((c) => c.name === 'fill')).toHaveLength(1);
    const done = stubContext();
    drawFiguresMask(done, 544, true);
    expect(done.calls.filter((c) => c.name === 'fill')).toHaveLength(2);
    // Scaled from the drawing box to the canvas, and squashed to the ellipse's height.
    const transforms = done.calls.filter((c) => c.name === 'setTransform').map((c) => c.args);
    const k = 544 / BOX;
    expect(transforms).toContainEqual([k, 0, 0, (k * FIGURES.ry) / FIGURES.rx, k * FIGURES.x, k * FIGURES.y]);
    expect(transforms).toContainEqual([k, 0, 0, k, k * CHECK.x, k * CHECK.y]);
  });

  it('stands in for a browser that refuses a negative radius, a number that is not one, and roundRect', () => {
    const ctx = stubContext();
    expect(() => ctx.arc(0, 0, -1, 0, 1)).toThrow(/negative radius/);
    expect(() => ctx.ellipse(0, 0, 1, Number.NaN, 0, 0, 1)).toThrow(/NaN/);
    expect(() => ctx.roundRect(0, 0, 1, 1, 1)).toThrow(/Chromium 99/);
    expect(() => {
      ctx.lineWidth = Number.POSITIVE_INFINITY;
    }).toThrow(/Infinity/);
  });
});

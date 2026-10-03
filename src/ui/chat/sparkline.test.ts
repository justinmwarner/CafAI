import { describe, expect, it } from 'vitest';
import { sparklinePath } from './sparkline.ts';

const box = { width: 100, height: 50, tMax: 10, yMax: 10 };

describe('sparklinePath', () => {
  it('maps time to x and value to y, origin at the bottom left', () => {
    expect(sparklinePath([0, 5, 10], [0, 5, 10], box)).toBe('M0,50L50,25L100,0');
  });

  it('breaks the line at missing readings', () => {
    expect(sparklinePath([0, 2, 4, 6], [1, null, 3, 4], box)).toBe('M0,45M40,35L60,30');
  });

  it('clamps values to the axis', () => {
    expect(sparklinePath([0, 10], [-2, 14], box)).toBe('M0,50L100,0');
  });

  it('rounds coordinates to one decimal', () => {
    expect(sparklinePath([0, 3], [1, 3.34], box)).toBe('M0,45L30,33.3');
  });

  it('returns an empty path when there is nothing to draw', () => {
    expect(sparklinePath([], [], box)).toBe('');
    expect(sparklinePath([0, 1], [null, null], box)).toBe('');
    expect(sparklinePath([0, 1], [1, 2], { ...box, tMax: 0 })).toBe('');
  });

  it('ignores readings without a timestamp', () => {
    expect(sparklinePath([0], [1, 2, 3], box)).toBe('M0,45');
  });
});

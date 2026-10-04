import { describe, expect, it } from 'vitest';

import { COACH_HEURISTICS } from './heuristics.ts';
import { startRatioOf } from './start.ts';
import { getTemplate } from './templates/index.ts';

/** "- Medium roasts: d-flow (...), ratio about 1:2.5-1:3." -> the first template named and its ratio range. */
const RATIO_LINE = /^- [^:]+: ([a-z-]+)\b.*ratio about 1:(\d+(?:\.\d+)?)-1:(\d+(?:\.\d+)?)\.$/;

describe('COACH_HEURISTICS', () => {
  it("puts medium roasts around D-Flow's own 1:2.8 start", () => {
    expect(COACH_HEURISTICS.text).toContain('- Medium roasts: d-flow (blooming-espresso also works), ratio about 1:2.5-1:3.');
    expect(COACH_HEURISTICS.text).not.toContain('1:2-1:2.5');
  });

  it('keeps v1 of each template it names inside the ratio it recommends, so the coach does not shorten v1 by reflex', () => {
    const lines = COACH_HEURISTICS.text.split('\n').flatMap((line) => {
      const match = RATIO_LINE.exec(line);
      return match ? [{ id: match[1]!, lo: Number(match[2]), hi: Number(match[3]) }] : [];
    });
    expect(lines.map((line) => line.id)).toEqual(['blooming-espresso', 'd-flow', 'londonium']);
    for (const { id, lo, hi } of lines) {
      const ratio = startRatioOf(getTemplate(id)!);
      expect(ratio, id).toBeGreaterThanOrEqual(lo);
      expect(ratio, id).toBeLessThanOrEqual(hi);
    }
  });

  it('is still the placeholder block', () => {
    expect(COACH_HEURISTICS.status).toBe('placeholder');
  });
});

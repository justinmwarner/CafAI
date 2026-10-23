import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../color.ts';
import { buildPalette, customTint, TINTS } from '../../palette.ts';
import { nextRoast, ROASTS } from './roasts.ts';

/** The dark page of every named tint and of every whole hue of the custom slider. */
function darkPages(): string[] {
  const pages = TINTS.map((tint) => buildPalette('dark', tint).background);
  for (let hue = 0; hue < 360; hue += 1) pages.push(buildPalette('dark', customTint(hue)).background);
  return pages;
}

describe('the seven roasts', () => {
  it('go from green to French', () => {
    expect(ROASTS.map((roast) => roast.name)).toEqual(['Green', 'Yellow', 'Cinnamon', 'City', 'Full City', 'Vienna', 'French']);
  });

  it('come round: French is followed by green', () => {
    expect(nextRoast(0)).toBe(1);
    expect(nextRoast(5)).toBe(6);
    expect(nextRoast(6)).toBe(0);
  });

  it('give a badge at least 3:1 against the dark page, in every tint and at every hue', () => {
    const pages = darkPages();
    for (const roast of ROASTS) {
      for (const page of pages) expect(contrastRatio(roast.badge, page), `${roast.name} on ${page}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('give a rim that shows on the dark page even where the bean itself hardly does', () => {
    const pages = darkPages();
    for (const roast of ROASTS) {
      for (const page of pages) expect(contrastRatio(roast.rim, page), `${roast.name} on ${page}`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(roast.rim, roast.body)).toBeGreaterThan(1.5);
    }
  });

  it('darken the bean from roast to roast, each badge a different colour', () => {
    const darkness = ROASTS.map((roast) => contrastRatio(roast.body, '#000000'));
    for (let i = 2; i < darkness.length; i += 1) expect(darkness[i]!).toBeLessThan(darkness[i - 1]!);
    expect(new Set(ROASTS.map((roast) => roast.badge)).size).toBe(ROASTS.length);
    for (const roast of ROASTS) {
      for (const colour of [roast.badge, roast.highlight, roast.body, roast.shade, roast.rim, roast.crease]) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

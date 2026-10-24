import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToOklab } from '../../color.ts';
import { buildPalette, customTint, TINTS } from '../../palette.ts';
import { nextRoast, ROASTS } from './roasts.ts';

/** The dark page of every named tint and of every whole hue of the custom slider. */
function darkPages(): string[] {
  const pages = TINTS.map((tint) => buildPalette('dark', tint).background);
  for (let hue = 0; hue < 360; hue += 1) pages.push(buildPalette('dark', customTint(hue)).background);
  return pages;
}

/** A colour's chroma and hue (degrees) in OKLCH. */
function lch(hex: string): { chroma: number; hue: number } {
  const [, a, b] = hexToOklab(hex);
  return { chroma: Math.hypot(a, b), hue: (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360 };
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

  it('give a rim light that shows on the dark page even where the bean itself hardly does', () => {
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
      expect(contrastRatio(roast.highlight, '#000000')).toBeGreaterThan(contrastRatio(roast.body, '#000000'));
      expect(contrastRatio(roast.shade, '#000000')).toBeLessThan(contrastRatio(roast.body, '#000000'));
    }
  });

  it("are a roaster's stages, not a paint box: green coffee a pale grey-green, the yellowing straw, never lemon", () => {
    const [green, yellow] = ROASTS;
    for (const colour of [green!.body, green!.badge]) {
      expect(lch(colour).chroma).toBeLessThan(0.065);
      expect(lch(colour).hue).toBeGreaterThan(100);
      expect(lch(colour).hue).toBeLessThan(145);
    }
    // Lemon is a strong yellow, up past 95°; straw and tan are muted and toward orange.
    for (const colour of [yellow!.body, yellow!.badge]) {
      expect(lch(colour).chroma).toBeLessThan(0.085);
      expect(lch(colour).hue).toBeGreaterThan(70);
      expect(lch(colour).hue).toBeLessThan(92);
    }
    // From cinnamon on, browns, redder as they darken.
    const hues = ROASTS.slice(2).map((roast) => lch(roast.body).hue);
    for (const hue of hues) {
      expect(hue).toBeGreaterThan(35);
      expect(hue).toBeLessThan(70);
    }
    for (let i = 1; i < hues.length; i += 1) expect(hues[i]!).toBeLessThan(hues[i - 1]!);
  });

  it('grow oilier as they darken, the oil showing from full city on', () => {
    for (let i = 1; i < ROASTS.length; i += 1) expect(ROASTS[i]!.gloss).toBeGreaterThan(ROASTS[i - 1]!.gloss);
    for (const roast of ROASTS) {
      expect(roast.gloss).toBeGreaterThanOrEqual(0);
      expect(roast.gloss).toBeLessThanOrEqual(1);
    }
    expect(ROASTS.find((roast) => roast.name === 'City')!.gloss).toBeLessThan(0.2);
    expect(ROASTS.find((roast) => roast.name === 'French')!.gloss).toBeGreaterThan(0.6);
  });
});

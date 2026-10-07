import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, oklch, parseHex } from './color.ts';

/**
 * An inverse derived independently of color.ts (Ottosson's
 * linear_srgb_to_oklab, run on parseHex's bytes), so the gamut-mapping tests
 * below check the production matrices against a second source, not against
 * themselves.
 */
function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = parseHex(hex);
  const srgbToLinear = (byte: number) => {
    const v = byte / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const lms = [
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  ] as const;
  const l_ = Math.cbrt(lms[0]);
  const m_ = Math.cbrt(lms[1]);
  const s_ = Math.cbrt(lms[2]);
  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bLab);
  const h = ((Math.atan2(bLab, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

/** Degrees between two hues, the short way round the circle. */
function hueDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe('oklch', () => {
  it('converts the achromatic ends and a mid grey exactly', () => {
    expect(oklch(0, 0, 0)).toBe('#000000');
    expect(oklch(1, 0, 0)).toBe('#ffffff');
    // L 0.5 is linear 0.125, which sRGB encodes as 99.
    expect(oklch(0.5, 0, 0)).toBe('#636363');
  });

  it('converts sRGB red from its OKLCH coordinates', () => {
    expect(oklch(0.627955, 0.257683, 29.2339)).toBe('#ff0000');
  });

  it('converts the other two primaries from their OKLCH coordinates', () => {
    expect(oklch(0.452014, 0.313214, 264.052)).toBe('#0000ff');
    expect(oklch(0.86644, 0.294827, 142.495)).toBe('#00ff00');
  });

  it('pins a colour outside sRGB to its known gamut-mapped hex', () => {
    expect(oklch(0.7, 0.4, 145)).toBe('#00bf34');
  });

  it('keeps the lightness and hue of a colour outside sRGB, with less chroma, landing on the gamut edge', () => {
    for (const l of [0.3, 0.5, 0.7, 0.85]) {
      for (let h = 0; h < 360; h += 15) {
        // Chroma 0.4 is out of sRGB gamut at every one of these lightnesses and hues.
        const hex = oklch(l, 0.4, h);
        const got = hexToOklch(hex);
        expect(Math.abs(got.l - l)).toBeLessThan(0.005);
        expect(hueDiff(got.h, h)).toBeLessThan(3);
        expect(got.c).toBeLessThan(0.4);
        expect(parseHex(hex).some((v) => v === 0 || v === 255)).toBe(true);
      }
    }
  });

  it('round-trips an in-gamut colour through the independent inverse', () => {
    for (const l of [0.3, 0.5, 0.7, 0.9]) {
      for (let h = 0; h < 360; h += 30) {
        const got = hexToOklch(oklch(l, 0.05, h));
        expect(Math.abs(got.l - l)).toBeLessThan(0.005);
        expect(Math.abs(got.c - 0.05)).toBeLessThan(0.005);
      }
    }
  });

  it('always returns #rrggbb', () => {
    for (const [l, c, h] of [[0.2, 0.3, 260], [0.95, 0.2, 100], [0.5, 0.5, 330]] as const) {
      expect(oklch(l, c, h)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('wraps hue past 360 and clamps lightness outside 0-1', () => {
    expect(oklch(0.7, 0.1, 370)).toBe(oklch(0.7, 0.1, 10));
    expect(oklch(-0.1, 0.1, 30)).toBe('#000000');
    expect(oklch(1.2, 0.1, 30)).toBe('#ffffff');
  });

  it('rejects non-finite input', () => {
    expect(() => oklch(Number.NaN, 0.1, 30)).toThrow(/Not a colour/);
    expect(() => oklch(0.5, 0.1, Number.POSITIVE_INFINITY)).toThrow(/Not a colour/);
    expect(() => oklch(0.5, Number.NaN, 30)).toThrow(/Not a colour/);
  });
});

describe('parseHex', () => {
  it('reads #rrggbb in either case', () => {
    expect(parseHex('#C8a27A')).toEqual([200, 162, 122]);
  });

  it('refuses anything else', () => {
    expect(() => parseHex('red')).toThrow(/#rrggbb/);
    expect(() => parseHex('#abc')).toThrow(/#rrggbb/);
  });
});

describe('blend', () => {
  it('mixes a colour over another at the given opacity', () => {
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(blend('#c8a27a', '#14100d', 1)).toBe('#c8a27a');
    expect(blend('#c8a27a', '#14100d', 0)).toBe('#14100d');
  });

  it('rejects an alpha outside 0-1', () => {
    expect(() => blend('#ffffff', '#000000', -0.5)).toThrow(/0-1/);
    expect(() => blend('#ffffff', '#000000', 1.5)).toThrow(/0-1/);
    expect(() => blend('#ffffff', '#000000', Number.NaN)).toThrow(/0-1/);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes 4.5:1 on white.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    // Red and blue weigh very differently from grey at the same lightness,
    // so these catch a wrong luminance weight that the greys above cannot.
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(4.0, 2);
    expect(contrastRatio('#0000ff', '#ffffff')).toBeCloseTo(8.59, 2);
  });

  it('does not depend on the order', () => {
    expect(contrastRatio('#14100d', '#c8a27a')).toBe(contrastRatio('#c8a27a', '#14100d'));
  });
});

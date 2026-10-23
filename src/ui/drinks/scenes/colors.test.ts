import { describe, expect, it } from 'vitest';
import { hexToOklab } from '../../color.ts';
import { buildPalette, namedTint } from '../../palette.ts';
import { createCafaiTheme } from '../../theme.ts';
import { css, paletteColorSource, sceneColors, themeColorSource, warmthColor } from './colors.ts';

describe('the scenes’ colours', () => {
  const dark = buildPalette('dark', namedTint('crema'));
  const light = buildPalette('light', namedTint('matcha'));

  it('reads every scene role in OKLab, with the page, the muted ink, the washes and the flow’s blue', () => {
    const colors = sceneColors(paletteColorSource(dark));
    for (const role of Object.keys(dark.scene) as (keyof typeof dark.scene)[]) {
      expect(colors[role]).toEqual(hexToOklab(dark.scene[role]));
    }
    expect(colors.background).toEqual(hexToOklab(dark.background));
    expect(colors.inkMuted).toEqual(hexToOklab(dark.inkMuted));
    expect(colors.milkWash).toEqual(hexToOklab(dark.milkWash));
    expect(colors.waterWash).toEqual(hexToOklab(dark.waterWash));
    expect(colors.flow).toEqual(hexToOklab(dark.graph.flow));
  });

  it('reads the same from the theme as from the palette it was built from, once per look', () => {
    const fromPalette = sceneColors(paletteColorSource(light));
    expect(sceneColors(themeColorSource(createCafaiTheme(light)))).toBe(fromPalette);
    expect(sceneColors(paletteColorSource(light))).toBe(fromPalette);
    expect(sceneColors(paletteColorSource(buildPalette('light', namedTint('cherry'))))).not.toBe(fromPalette);
  });

  it('shows steam harder on a light page, where it is grey, than on a dark one', () => {
    expect(sceneColors(paletteColorSource(light)).steamStrength).toBeGreaterThan(sceneColors(paletteColorSource(dark)).steamStrength);
  });

  it('writes a colour out as rgba, its alpha clamped', () => {
    expect(css(hexToOklab('#3a7bd5'))).toBe('rgba(58,123,213,1.000)');
    expect(css(hexToOklab('#3a7bd5'), 0.25)).toBe('rgba(58,123,213,0.250)');
    expect(css(hexToOklab('#000000'), -1)).toBe('rgba(0,0,0,0.000)');
    expect(css(hexToOklab('#ffffff'), 3)).toBe('rgba(255,255,255,1.000)');
  });

  it('runs the ring from its cold end to its warm end', () => {
    const colors = sceneColors(paletteColorSource(dark));
    expect(warmthColor(colors, 0)).toEqual(colors.warmCold);
    expect(warmthColor(colors, 1)).toEqual(colors.warmHot);
    expect(warmthColor(colors, 5)).toEqual(colors.warmHot);
  });
});

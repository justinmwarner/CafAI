import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color.ts';
import { buildPalette, customTint, DEFAULT_TINT_ID, namedTint, TINTS, type Palette, type ThemeMode, type Tint } from './palette.ts';

const MODES: readonly ThemeMode[] = ['dark', 'light'];

/** Every named tint, then every hue the custom slider can reach. */
const ALL_TINTS: readonly (readonly [string, Tint])[] = [
  ...TINTS.map((tint) => [tint.name, tint] as const),
  ...Array.from({ length: 360 }, (_, hue) => [`hue ${hue}`, customTint(hue)] as const),
];

function colours(palette: Palette): string[] {
  const { mode: _mode, graph, ...flat } = palette;
  return [...Object.values(flat), ...Object.values(graph)];
}

describe('the tints', () => {
  it('have unique ids, with Crema the default and first', () => {
    expect(new Set(TINTS.map((t) => t.id)).size).toBe(TINTS.length);
    expect(DEFAULT_TINT_ID).toBe('crema');
    expect(TINTS[0]!.id).toBe('crema');
    expect(TINTS.map((t) => t.name)).toEqual(['Crema', 'Matcha', 'Lagoon', 'Ocean', 'Plum', 'Cherry', 'Steel']);
  });

  it('look up by id', () => {
    expect(namedTint('matcha').hue).toBe(138);
  });

  it('wrap and round a custom hue into 0-359', () => {
    expect(customTint(370).hue).toBe(10);
    expect(customTint(-20).hue).toBe(340);
    expect(customTint(12.6).hue).toBe(13);
    expect(customTint(360).hue).toBe(0);
  });
});

describe('buildPalette', () => {
  it('writes every colour as #rrggbb', () => {
    for (const mode of MODES) {
      for (const tint of TINTS) {
        for (const colour of colours(buildPalette(mode, tint))) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('says which mode it is for', () => {
    expect(buildPalette('dark', namedTint('crema')).mode).toBe('dark');
    expect(buildPalette('light', namedTint('crema')).mode).toBe('light');
  });

  it('keeps the colours that carry meaning the same in every tint', () => {
    for (const mode of MODES) {
      const crema = buildPalette(mode, namedTint('crema'));
      for (const tint of TINTS) {
        const p = buildPalette(mode, tint);
        expect([p.success, p.warning, p.error, p.info, p.live]).toEqual([crema.success, crema.warning, crema.error, crema.info, crema.live]);
        expect([p.graph.pressure, p.graph.flow, p.graph.weightFlow, p.graph.weight]).toEqual([
          crema.graph.pressure,
          crema.graph.flow,
          crema.graph.weightFlow,
          crema.graph.weight,
        ]);
      }
    }
  });

  it('gives each tint its own accent and leans the neutrals toward it', () => {
    const accents = new Set(TINTS.map((t) => buildPalette('dark', t).accent));
    expect(accents.size).toBe(TINTS.length);
    expect(buildPalette('dark', namedTint('matcha')).background).not.toBe(buildPalette('dark', namedTint('cherry')).background);
  });

  it('is dark on dark and light on light', () => {
    const dark = buildPalette('dark', namedTint('crema'));
    const light = buildPalette('light', namedTint('crema'));
    expect(contrastRatio(dark.background, '#000000')).toBeLessThan(2);
    expect(contrastRatio(light.background, '#ffffff')).toBeLessThan(1.2);
  });
});

/** The pairs the UI draws (spec section 3, "Contrast, enforced by tests"). */
const PAIRS: readonly (readonly [string, number, (p: Palette) => readonly (readonly [string, string])[]])[] = [
  ['ink on background, surface, raised', 7, (p) => [[p.ink, p.background], [p.ink, p.surface], [p.ink, p.raised]]],
  ['inkMuted on background, surface, raised', 4.5, (p) => [[p.inkMuted, p.background], [p.inkMuted, p.surface], [p.inkMuted, p.raised]]],
  ['accent on background and surface', 4.5, (p) => [[p.accent, p.background], [p.accent, p.surface]]],
  ['accent on accentSoft', 4.5, (p) => [[p.accent, p.accentSoft]]],
  ['onAccent on accent', 4.5, (p) => [[p.onAccent, p.accent]]],
  [
    'status colours on background and surface',
    4.5,
    (p) => [p.success, p.warning, p.error, p.info].flatMap((c) => [[c, p.background], [c, p.surface]] as const),
  ],
  ['onError on error', 4.5, (p) => [[p.onError, p.error]]],
  // Tonal buttons in a status colour (Forget key, Stop at rest) draw it on the raised fill.
  [
    'status colours on raised',
    4.5,
    (p) => [p.success, p.warning, p.error].map((c) => [c, p.raised] as const),
  ],
  [
    'graph series on background and surface',
    3,
    (p) =>
      [p.graph.pressure, p.graph.flow, p.graph.weightFlow, p.graph.weight].flatMap(
        (c) => [[c, p.background], [c, p.surface]] as const,
      ),
  ],
];

describe('contrast (WCAG AA) in every tint, at every hue, in both modes', () => {
  for (const [name, minimum, pairs] of PAIRS) {
    it(`${name}: at least ${minimum}:1`, () => {
      const failures: string[] = [];
      for (const mode of MODES) {
        for (const [tintName, tint] of ALL_TINTS) {
          for (const [fg, bg] of pairs(buildPalette(mode, tint))) {
            const ratio = contrastRatio(fg, bg);
            if (ratio < minimum) failures.push(`${mode} ${tintName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { blend, contrastRatio } from './color.ts';
import { buildPalette, customTint, DEFAULT_TINT_ID, namedTint, TINTS, type Palette, type ThemeMode, type Tint } from './palette.ts';

const MODES: readonly ThemeMode[] = ['dark', 'light'];

/** Every named tint, then every hue the custom slider can reach. */
const ALL_TINTS: readonly (readonly [string, Tint])[] = [
  ...TINTS.map((tint) => [tint.name, tint] as const),
  ...Array.from({ length: 360 }, (_, hue) => [`hue ${hue}`, customTint(hue)] as const),
];

function colours(palette: Palette): string[] {
  const { mode: _mode, graph, scene, ...flat } = palette;
  return [...Object.values(flat), ...Object.values(graph), ...Object.values(scene)];
}

describe('the tints', () => {
  it('have unique ids, with Crema the default and first', () => {
    expect(new Set(TINTS.map((t) => t.id)).size).toBe(TINTS.length);
    expect(DEFAULT_TINT_ID).toBe('crema');
    expect(TINTS[0]!.id).toBe('crema');
    expect(TINTS.map((t) => t.name)).toEqual(['Crema', 'Matcha', 'Cold Brew', 'Blueberry', 'Plum', 'Cherry', 'Tamper']);
  });

  it('are ids storage keeps: short lowercase words (src/storage/settings.ts)', () => {
    for (const tint of TINTS) expect(tint.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
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

  it('washes pressure and flow toward the page for the shot drawn under another, and the muted ink for its key (D180)', () => {
    for (const [mode, share] of [['dark', 0.45], ['light', 0.5]] as const) {
      for (const tint of [namedTint('crema'), namedTint('matcha'), customTint(300)]) {
        const p = buildPalette(mode, tint);
        expect(p.graph.pressureGuide).toBe(blend(p.graph.pressure, p.background, share));
        expect(p.graph.flowGuide).toBe(blend(p.graph.flow, p.background, share));
        expect(p.graph.guide).toBe(blend(p.inkMuted, p.background, share));
      }
    }
  });

  it('washes the flow blue and the ink over the page for the dial', () => {
    const dark = buildPalette('dark', namedTint('crema'));
    expect(dark.waterWash).toBe(blend(dark.graph.flow, dark.background, 0.22));
    expect(dark.milkWash).toBe(blend(dark.ink, dark.background, 0.09));
    const light = buildPalette('light', namedTint('crema'));
    expect(light.waterWash).toBe(blend(light.graph.flow, light.background, 0.16));
  });

  it('keeps the scenes’ colours the same in every tint, one set per mode', () => {
    for (const mode of MODES) {
      const crema = buildPalette(mode, namedTint('crema'));
      for (const tint of TINTS) expect(buildPalette(mode, tint).scene).toEqual(crema.scene);
    }
    expect(buildPalette('dark', namedTint('crema')).scene).not.toEqual(buildPalette('light', namedTint('crema')).scene);
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
  // Also what is set aside (the starting profiles not picked, an undone
  // version, a closed question's other answers) and every placeholder: the
  // muted ink at full strength, never faded with opacity.
  ['inkMuted on background, surface, raised', 4.5, (p) => [[p.inkMuted, p.background], [p.inkMuted, p.surface], [p.inkMuted, p.raised]]],
  ['accent on background and surface', 4.5, (p) => [[p.accent, p.background], [p.accent, p.surface]]],
  ['accent on accentSoft', 4.5, (p) => [[p.accent, p.accentSoft]]],
  // Go back's label and its seconds over the countdown's wash (D-BACK-1).
  ['ink and inkMuted on accentWash', 4.5, (p) => [[p.ink, p.accentWash], [p.inkMuted, p.accentWash]]],
  // The wash must show on the tonal button it drains across.
  ['accentWash off the raised fill', 1.15, (p) => [[p.accentWash, p.raised]]],
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
  // A chip outlined in a status colour or the accent (confidence, a version's
  // status) carries its meaning in the outline too; the theme draws it opaque.
  [
    'chip outlines: status colours and the accent on background and surface',
    3,
    (p) => [p.success, p.warning, p.error, p.info, p.accent].flatMap((c) => [[c, p.background], [c, p.surface]] as const),
  ],
  [
    'graph series on background and surface',
    3,
    (p) =>
      [p.graph.pressure, p.graph.flow, p.graph.weightFlow, p.graph.weight].flatMap(
        (c) => [[c, p.background], [c, p.surface]] as const,
      ),
  ],
  // The shot drawn faintly under another (D180): wide bands, faint by
  // design, so below a series' 3:1, but seen on the page and the card; and
  // this shot's line, where it runs over its own band, still stands out.
  // In light mode a series is about 4.5:1 against the page, which leaves
  // about 2:1 each way for a band between them.
  [
    "the shot under: its bands and its key's swatch on background and surface",
    1.9,
    (p) => [p.graph.pressureGuide, p.graph.flowGuide, p.graph.guide].flatMap((c) => [[c, p.background], [c, p.surface]] as const),
  ],
  ["this shot's pressure and flow over their own bands", 2, (p) => [[p.graph.pressure, p.graph.pressureGuide], [p.graph.flow, p.graph.flowGuide]]],
  // Lines that cross the other band: weight flow runs along the flow band for
  // most of a pour. They differ from it in hue too (orange, tan or green on
  // blue, blue on green), and light mode leaves weight flow, about 3.5:1
  // against the page, about 1.65:1 against the flow band.
  [
    "this shot's lines crossing the other bands",
    1.6,
    (p) => [
      [p.graph.pressure, p.graph.flowGuide],
      [p.graph.flow, p.graph.pressureGuide],
      ...[p.graph.weight, p.graph.weightFlow].flatMap((c) => [[c, p.graph.pressureGuide], [c, p.graph.flowGuide]] as const),
    ],
  ],
  // The steam, hot water and flush dial (D149): its number in ink and its
  // "of" line in ink-muted sit over the water and the milk inside the ring.
  ['ink on the dial’s water and milk', 7, (p) => [[p.ink, p.waterWash], [p.ink, p.milkWash]]],
  ['inkMuted on the dial’s water and milk', 4.5, (p) => [[p.inkMuted, p.waterWash], [p.inkMuted, p.milkWash]]],
  // The drinks' scenes (D-SCENE-4): the fills a scene puts under the figures.
  // A ramp's mix runs between its ends in lightness, so the ends stand for it.
  // The rosetta's figures sit on its white milk in dark mode with a halo of
  // the crema behind them, so dark mode's crema stands for what they read on.
  ['ink on the scenes’ fills under the figures', 7, (p) => sceneFills(p).map((fill) => [p.ink, fill] as const)],
  ['inkMuted on the scenes’ fills under the figures', 4.5, (p) => sceneFills(p).map((fill) => [p.inkMuted, fill] as const)],
  // The ring's arc and tip in the warmth ramp: a reading's graphic, as the graph's series.
  ['the warmth ramp on the page', 3, (p) => [[p.scene.warmCold, p.background], [p.scene.warmHot, p.background]]],
];

/** The scenes' fills that sit under the dial's figures, in this palette's mode. */
function sceneFills(p: Palette): string[] {
  const s = p.scene;
  const rosetta = p.mode === 'dark' ? [s.crema] : [s.crema, s.artCold, s.artWarm];
  return [s.swirlCold, s.swirlWarm, s.shallow, s.deep, s.screen, ...rosetta];
}

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

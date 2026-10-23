/**
 * CafAI's colours, built from one tint and a mode.
 *
 * A tint is a hue, how colourful the accent is, and how far the neutrals
 * (backgrounds, text, lines) lean toward that hue. Everything else follows
 * from it, so a green or a blue CafAI is as finished as the brown one. The
 * colours that carry meaning never follow the tint: success green, warning
 * amber, error red, and the shot graph's series (pressure green, flow blue,
 * as on Decent's own charts).
 *
 * The lightness values are chosen so every pair the UI draws passes WCAG AA
 * in both modes and at every hue; palette.test.ts sweeps them all.
 */
import { blend, oklch } from './color.ts';

export type ThemeMode = 'dark' | 'light';

export interface Tint {
  /** OKLCH hue, degrees. */
  hue: number;
  /** Chroma of the accent. */
  chroma: number;
  /** Chroma the neutrals lean toward the hue with. */
  neutral: number;
  /** Accent lightness per mode, for a tint whose accent would otherwise read like the muted text (a grey). */
  accentLightness?: { dark: number; light: number };
}

export type TintId = 'crema' | 'matcha' | 'cold-brew' | 'blueberry' | 'plum' | 'cherry' | 'tamper';

export interface NamedTint extends Tint {
  id: TintId;
  name: string;
}

/**
 * The named tints, in the order the Appearance settings list them, each named
 * for coffee (D123): the crema, a matcha latte, cold brew's ice, three tasting
 * notes (blueberry, plum, and the cherry coffee grows in) and the steel of a
 * tamper. Storage reads the old ids (lagoon, ocean, steel) as the new ones
 * (src/storage/settings.ts).
 */
export const TINTS: readonly NamedTint[] = [
  { id: 'crema', name: 'Crema', hue: 68, chroma: 0.085, neutral: 0.014 },
  { id: 'matcha', name: 'Matcha', hue: 138, chroma: 0.11, neutral: 0.014 },
  { id: 'cold-brew', name: 'Cold Brew', hue: 200, chroma: 0.09, neutral: 0.014 },
  { id: 'blueberry', name: 'Blueberry', hue: 265, chroma: 0.12, neutral: 0.016 },
  { id: 'plum', name: 'Plum', hue: 320, chroma: 0.11, neutral: 0.014 },
  { id: 'cherry', name: 'Cherry', hue: 22, chroma: 0.13, neutral: 0.014 },
  { id: 'tamper', name: 'Tamper', hue: 250, chroma: 0.025, neutral: 0.006, accentLightness: { dark: 0.88, light: 0.36 } },
];

export const DEFAULT_TINT_ID: TintId = 'crema';

export function namedTint(id: TintId): NamedTint {
  return TINTS.find((tint) => tint.id === id) ?? TINTS[0]!;
}

/** The tint for a hue picked on the custom slider; any number comes back as a whole degree, 0-359. */
export function customTint(hue: number): Tint {
  return { hue: ((Math.round(hue) % 360) + 360) % 360, chroma: 0.11, neutral: 0.014 };
}

export interface GraphPalette {
  pressure: string;
  flow: string;
  weightFlow: string;
  weight: string;
  /** Grid lines. */
  grid: string;
  /** Axis labels. */
  axis: string;
  /**
   * The shot drawn faintly under this one (D180): pressure and flow as
   * wide bands of their own colour washed toward the page, opaque, so the
   * contrast sweep checks them.
   */
  pressureGuide: string;
  flowGuide: string;
  /** The key's swatch for that band: the muted ink, washed the same way. */
  guide: string;
}

export interface Palette {
  mode: ThemeMode;
  /** The page. */
  background: string;
  /** Cards, bars, panels. */
  surface: string;
  /** Tonal buttons and bubbles: a step above the surface. */
  raised: string;
  /** Body text. */
  ink: string;
  /** Secondary text. */
  inkMuted: string;
  /** Dividers and card borders. */
  line: string;
  /** Primary actions and the current selection. */
  accent: string;
  /** A wash of the accent, behind the current navigation item. */
  accentSoft: string;
  /**
   * A stronger wash of the accent over the raised fill: Go back's countdown
   * draining (D221). accentSoft is all but the raised fill in light mode.
   */
  countdownWash: string;
  /** Text and icons on the accent. */
  onAccent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Text on a filled error button (Stop while a shot runs). */
  onError: string;
  /** The pulsing dot of a live shot. */
  live: string;
  /** The water inside the steam, hot water and flush dial: the flow's blue washed over the page (D149). */
  waterWash: string;
  /** The milk inside the steam dial: the ink washed over the page. */
  milkWash: string;
  graph: GraphPalette;
  /** The drinks' scenes inside the dial (D220). */
  scene: ScenePalette;
}

/**
 * The drinks' scenes inside the dial (D220, docs/superpowers/specs/
 * 2026-10-22-drink-scenes-design.md, section 5): the same in every tint, as
 * the graph's colours are, one set per mode. A pair named cold and warm (or
 * shallow and deep) is a ramp a scene mixes in OKLab as a run goes
 * (src/ui/drinks/scenes/colors.ts). A fill that sits under the dial's figures
 * keeps their contrast, and the warmth ramp 3:1 on the page (palette.test.ts).
 */
export interface ScenePalette {
  /** The warmth ramp the ring's arc and its tip take, cold to warm. */
  warmCold: string;
  warmHot: string;
  /** Wand and spray: the milk, cold and warm (below the figures), its foam and bubbles, and the steam over it. */
  milkCold: string;
  milkWarm: string;
  foam: string;
  steam: string;
  /** Steel: a wand, a spout, a group head; its lit and shaded edges; an opening in it. */
  steel: string;
  steelLight: string;
  steelDark: string;
  steelHole: string;
  /** Whirlpool: the milk from above, under the figures, cold and warm; its foam, the foam's trough, its gloss. */
  swirlCold: string;
  swirlWarm: string;
  swirlFoam: string;
  swirlTrough: string;
  sheen: string;
  /** Rosetta: the crema, its rim and its lighter flecks; the poured milk, cold and warm. */
  crema: string;
  cremaRim: string;
  cremaLight: string;
  artCold: string;
  artWarm: string;
  /** Pour: the water (below the figures), cold and warm, and its lines: surface, stream, rings, bubbles. */
  waterCold: string;
  waterWarm: string;
  waterLineCold: string;
  waterLineWarm: string;
  /** From above: the water under the figures, shallow and deep, and the rings on it. */
  shallow: string;
  deep: string;
  ripple: string;
  /** Shower and Screen: the flush's water, cold and warm. */
  flushCold: string;
  flushWarm: string;
  /** Screen: the shower screen's steel under the figures, its bevel and its holes. */
  screen: string;
  screenBevel: string;
  screenHole: string;
}

type Lch = readonly [lightness: number, chroma: number, hue: number];

/**
 * The scenes' colours in OKLCH, per mode, as the mockup draws them. Dark mode's
 * fills under the figures stay at or below lightness 0.37 and light mode's at
 * or above 0.86, so ink and ink-muted keep 7:1 and 4.5:1 on them.
 */
const SCENE: Record<ThemeMode, Record<keyof ScenePalette, Lch>> = {
  dark: {
    warmCold: [0.9, 0.035, 235],
    warmHot: [0.85, 0.09, 68],
    milkCold: [0.6, 0.03, 235],
    milkWarm: [0.77, 0.05, 82],
    foam: [0.95, 0.015, 85],
    steam: [0.97, 0.006, 80],
    steel: [0.6, 0.008, 250],
    steelLight: [0.85, 0.006, 250],
    steelDark: [0.4, 0.01, 250],
    steelHole: [0.18, 0.01, 250],
    swirlCold: [0.325, 0.014, 240],
    swirlWarm: [0.37, 0.036, 72],
    swirlFoam: [0.76, 0.025, 80],
    swirlTrough: [0.24, 0.02, 60],
    sheen: [0.95, 0.01, 80],
    crema: [0.34, 0.045, 62],
    cremaRim: [0.24, 0.04, 55],
    cremaLight: [0.42, 0.055, 66],
    artCold: [0.93, 0.012, 240],
    artWarm: [0.92, 0.04, 85],
    waterCold: [0.44, 0.075, 242],
    waterWarm: [0.46, 0.05, 220],
    waterLineCold: [0.8, 0.09, 240],
    waterLineWarm: [0.84, 0.06, 215],
    shallow: [0.35, 0.045, 232],
    deep: [0.28, 0.06, 245],
    ripple: [0.8, 0.07, 235],
    flushCold: [0.78, 0.1, 240],
    flushWarm: [0.8, 0.12, 52],
    screen: [0.31, 0.006, 250],
    screenBevel: [0.44, 0.008, 250],
    screenHole: [0.19, 0.005, 250],
  },
  light: {
    warmCold: [0.46, 0.075, 240],
    warmHot: [0.56, 0.13, 48],
    milkCold: [0.85, 0.028, 235],
    milkWarm: [0.875, 0.048, 82],
    foam: [0.995, 0.004, 85],
    steam: [0.74, 0.014, 250],
    steel: [0.72, 0.008, 250],
    steelLight: [0.93, 0.004, 250],
    steelDark: [0.52, 0.01, 250],
    steelHole: [0.3, 0.01, 250],
    swirlCold: [0.93, 0.014, 240],
    swirlWarm: [0.9, 0.04, 80],
    swirlFoam: [0.995, 0.004, 85],
    swirlTrough: [0.8, 0.03, 70],
    sheen: [1, 0, 0],
    crema: [0.88, 0.045, 70],
    cremaRim: [0.79, 0.05, 66],
    cremaLight: [0.9, 0.04, 75],
    artCold: [0.99, 0.005, 240],
    artWarm: [0.985, 0.022, 85],
    waterCold: [0.83, 0.055, 240],
    waterWarm: [0.85, 0.04, 220],
    waterLineCold: [0.5, 0.12, 245],
    waterLineWarm: [0.52, 0.08, 220],
    shallow: [0.935, 0.025, 232],
    deep: [0.875, 0.045, 242],
    ripple: [0.55, 0.1, 240],
    flushCold: [0.54, 0.14, 245],
    flushWarm: [0.6, 0.16, 45],
    screen: [0.915, 0.004, 250],
    screenBevel: [0.82, 0.006, 250],
    screenHole: [0.7, 0.006, 250],
  },
};

/** Built once per mode: the scenes' colours do not follow the tint. */
const builtScenes: Partial<Record<ThemeMode, Readonly<ScenePalette>>> = {};

function scenePalette(mode: ThemeMode): Readonly<ScenePalette> {
  const built = builtScenes[mode];
  if (built) return built;
  const roles = Object.entries(SCENE[mode]).map(([role, [l, c, h]]) => [role, oklch(l, c, h)] as const);
  const scene = Object.freeze(Object.fromEntries(roles) as Record<keyof ScenePalette, string>);
  builtScenes[mode] = scene;
  return scene;
}

/** The colours that carry meaning: the same in every tint. */
const FIXED: Record<ThemeMode, Record<'success' | 'warning' | 'error' | 'info' | 'live' | 'pressure' | 'flow' | 'weightFlow' | 'weight', Lch>> = {
  dark: {
    success: [0.8, 0.14, 155],
    warning: [0.83, 0.13, 85],
    error: [0.72, 0.15, 25],
    info: [0.74, 0.12, 245],
    live: [0.68, 0.19, 25],
    pressure: [0.8, 0.14, 160],
    flow: [0.74, 0.12, 245],
    weightFlow: [0.78, 0.13, 55],
    weight: [0.82, 0.05, 70],
  },
  light: {
    success: [0.5, 0.13, 155],
    warning: [0.52, 0.12, 75],
    error: [0.53, 0.18, 25],
    info: [0.52, 0.15, 250],
    live: [0.58, 0.2, 25],
    pressure: [0.55, 0.14, 160],
    flow: [0.52, 0.15, 250],
    weightFlow: [0.62, 0.15, 55],
    weight: [0.55, 0.06, 65],
  },
};

type NeutralRole = 'background' | 'surface' | 'raised' | 'ink' | 'inkMuted';

/** Each neutral's lightness, and how much of the tint's neutral chroma it takes. */
const NEUTRALS: Record<ThemeMode, Record<NeutralRole, readonly [lightness: number, share: number]>> = {
  dark: {
    background: [0.17, 1],
    surface: [0.205, 1.15],
    raised: [0.25, 1.3],
    ink: [0.95, 0.9],
    inkMuted: [0.76, 1.2],
  },
  light: {
    background: [0.975, 0.5],
    surface: [0.995, 0.25],
    raised: [0.945, 0.8],
    ink: [0.24, 1.5],
    inkMuted: [0.47, 2],
  },
};

const ACCENT_LIGHTNESS: Record<ThemeMode, number> = { dark: 0.76, light: 0.5 };

/**
 * How much of a series' colour the band under it keeps over the page
 * (D180): enough to be seen, little enough that this shot's line stays
 * readable on top of it. Light mode leaves less room: a series there is
 * about 4.5:1 against the page, so a band between them gets about 2:1 each way.
 */
const GUIDE_SHARE: Record<ThemeMode, number> = { dark: 0.45, light: 0.5 };

export function buildPalette(mode: ThemeMode, tint: Tint): Palette {
  const dark = mode === 'dark';
  const neutral = (role: NeutralRole) => {
    const [lightness, share] = NEUTRALS[mode][role];
    return oklch(lightness, tint.neutral * share, tint.hue);
  };
  const fixed = (role: keyof (typeof FIXED)['dark']) => {
    const [l, c, h] = FIXED[mode][role];
    return oklch(l, c, h);
  };

  const background = neutral('background');
  const surface = neutral('surface');
  const ink = neutral('ink');
  const inkMuted = neutral('inkMuted');
  const accent = oklch(tint.accentLightness?.[mode] ?? ACCENT_LIGHTNESS[mode], tint.chroma, tint.hue);
  const flow = fixed('flow');
  const pressure = fixed('pressure');
  const guide = (colour: string) => blend(colour, background, GUIDE_SHARE[mode]);
  return {
    mode,
    background,
    surface,
    raised: neutral('raised'),
    ink,
    inkMuted,
    line: blend(ink, background, dark ? 0.12 : 0.14),
    accent,
    accentSoft: blend(accent, surface, dark ? 0.16 : 0.12),
    countdownWash: blend(accent, neutral('raised'), dark ? 0.16 : 0.14),
    onAccent: dark ? oklch(0.2, tint.neutral * 2, tint.hue) : oklch(0.99, 0.005, tint.hue),
    success: fixed('success'),
    warning: fixed('warning'),
    error: fixed('error'),
    info: fixed('info'),
    onError: dark ? oklch(0.2, 0.02, 25) : oklch(0.99, 0.005, 25),
    live: fixed('live'),
    waterWash: blend(flow, background, dark ? 0.22 : 0.16),
    milkWash: blend(ink, background, 0.09),
    scene: scenePalette(mode),
    graph: {
      pressure,
      flow,
      weightFlow: fixed('weightFlow'),
      weight: fixed('weight'),
      grid: blend(ink, background, 0.08),
      axis: inkMuted,
      pressureGuide: guide(pressure),
      flowGuide: guide(flow),
      guide: guide(inkMuted),
    },
  };
}

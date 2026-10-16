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
}

type Lch = readonly [lightness: number, chroma: number, hue: number];

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
    onAccent: dark ? oklch(0.2, tint.neutral * 2, tint.hue) : oklch(0.99, 0.005, tint.hue),
    success: fixed('success'),
    warning: fixed('warning'),
    error: fixed('error'),
    info: fixed('info'),
    onError: dark ? oklch(0.2, 0.02, 25) : oklch(0.99, 0.005, 25),
    live: fixed('live'),
    waterWash: blend(flow, background, dark ? 0.22 : 0.16),
    milkWash: blend(ink, background, 0.09),
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

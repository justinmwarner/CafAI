/**
 * The scenes' colours (palette.scene, D220) in OKLab, read once per
 * look, so a scene mixes a ramp every frame (the milk from cold to warm,
 * the ring) without parsing hex; css() writes a colour out as the canvas
 * takes it. The Simple scenes (D149's) also take the dial's washes, the
 * flow's blue and the muted ink.
 */
import type { Theme } from '@mui/material/styles';
import { hexToOklab, mixOklab, oklabToRgb, type Oklab } from '../../color.ts';
import type { Palette, ScenePalette } from '../../palette.ts';

export type { Oklab };
export { mixOklab };

/** What the scenes' colours are read from: a palette, or the theme built from one. */
export interface SceneColorSource {
  readonly mode: 'dark' | 'light';
  /** The page under the dial. */
  readonly background: string;
  readonly inkMuted: string;
  readonly milkWash: string;
  readonly waterWash: string;
  /** The flow's blue (Decent's graph). */
  readonly flow: string;
  readonly scene: ScenePalette;
}

export type SceneColors = { readonly [Role in keyof ScenePalette]: Oklab } & {
  readonly background: Oklab;
  readonly inkMuted: Oklab;
  readonly milkWash: Oklab;
  readonly waterWash: Oklab;
  readonly flow: Oklab;
  /** How strongly steam and vapour show: white steam on a dark page needs less than grey steam on a light one. */
  readonly steamStrength: number;
  /** How strongly a surface's gloss shows. */
  readonly sheenStrength: number;
};

export function paletteColorSource(palette: Palette): SceneColorSource {
  const { mode, background, inkMuted, milkWash, waterWash, scene } = palette;
  return { mode, background, inkMuted, milkWash, waterWash, flow: palette.graph.flow, scene };
}

export function themeColorSource(theme: Theme): SceneColorSource {
  const { cafai } = theme.palette;
  return {
    mode: theme.palette.mode,
    background: theme.palette.background.default,
    inkMuted: theme.palette.text.secondary,
    milkWash: cafai.milkWash,
    waterWash: cafai.waterWash,
    flow: cafai.graph.flow,
    scene: cafai.scene,
  };
}

/** Worked out looks, by what tells them apart: few, unless the custom hue's slider is dragged. */
const read = new Map<string, SceneColors>();
const MAX_KEPT = 64;

/** The scenes' colours for a look, in OKLab, worked out once per look. */
export function sceneColors(source: SceneColorSource): SceneColors {
  const key = `${source.mode} ${source.background} ${source.inkMuted} ${source.milkWash} ${source.waterWash}`;
  const known = read.get(key);
  if (known) return known;
  const roles = Object.entries(source.scene).map(([role, hex]) => [role, hexToOklab(hex)] as const);
  const dark = source.mode === 'dark';
  const colors: SceneColors = {
    ...(Object.fromEntries(roles) as { [Role in keyof ScenePalette]: Oklab }),
    background: hexToOklab(source.background),
    inkMuted: hexToOklab(source.inkMuted),
    milkWash: hexToOklab(source.milkWash),
    waterWash: hexToOklab(source.waterWash),
    flow: hexToOklab(source.flow),
    steamStrength: dark ? 1.3 : 1.5,
    sheenStrength: dark ? 1 : 3,
  };
  if (read.size >= MAX_KEPT) read.clear();
  read.set(key, colors);
  return colors;
}

/** A colour as the canvas takes it, at `alpha` (clamped to 0-1). */
export function css(color: Oklab, alpha = 1): string {
  const [r, g, b] = oklabToRgb(color);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** The ring's arc and tip at a warmth, 0 cold to 1 warm. */
export function warmthColor(colors: SceneColors, warmth: number): Oklab {
  return mixOklab(colors.warmCold, colors.warmHot, warmth);
}

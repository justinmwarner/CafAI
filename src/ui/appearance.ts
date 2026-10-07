/**
 * From the stored appearance (storage/types.ts) to the palette the theme is
 * built from, and the few resolved colours kept for the screens that show
 * before the app has read its settings (main.tsx's boot screen, the watchdog
 * page in index.html).
 */
import type { Appearance } from '../storage/types.ts';
import { buildPalette, customTint, DEFAULT_TINT_ID, namedTint, TINTS, type Palette, type ThemeMode, type Tint, type TintId } from './palette.ts';

export function resolveMode(mode: Appearance['mode'], prefersDark: boolean): ThemeMode {
  if (mode === 'auto') return prefersDark ? 'dark' : 'light';
  return mode;
}

function isTintId(id: string): id is TintId {
  return TINTS.some((tint) => tint.id === id);
}

/** A named tint (an id this build does not know reads as the default), or the slider's hue. */
export function resolveTint(tint: Appearance['tint']): Tint {
  if (typeof tint === 'string') return namedTint(isTintId(tint) ? tint : DEFAULT_TINT_ID);
  return customTint(tint.hue);
}

const palettes = new Map<string, Palette>();

/** The palette for an appearance on this device, built once per mode and tint. */
export function paletteFor(appearance: Appearance, prefersDark: boolean): Palette {
  const mode = resolveMode(appearance.mode, prefersDark);
  const tint = appearance.tint;
  const key = `${mode}|${typeof tint === 'string' ? (isTintId(tint) ? tint : DEFAULT_TINT_ID) : `hue ${customTint(tint.hue).hue}`}`;
  let palette = palettes.get(key);
  if (!palette) {
    palette = buildPalette(mode, resolveTint(tint));
    palettes.set(key, palette);
  }
  return palette;
}

/** What the boot screens draw with: the last look the app showed. */
export interface BootColors {
  background: string;
  surface: string;
  ink: string;
  inkMuted: string;
  line: string;
  accent: string;
}

export const BOOT_COLORS_KEY = 'cafai.appearance.boot';

const BOOT_FIELDS = ['background', 'surface', 'ink', 'inkMuted', 'line', 'accent'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

export function bootColors(palette: Palette): BootColors {
  return {
    background: palette.background,
    surface: palette.surface,
    ink: palette.ink,
    inkMuted: palette.inkMuted,
    line: palette.line,
    accent: palette.accent,
  };
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Keeps the colours for the next start; storage that is full or blocked is not worth a word. */
export function saveBootColors(storage: Pick<KeyValueStore, 'setItem'>, colors: BootColors): void {
  try {
    storage.setItem(BOOT_COLORS_KEY, JSON.stringify(colors));
  } catch {
    // The boot screens fall back to the default look.
  }
}

export function loadBootColors(storage: Pick<KeyValueStore, 'getItem'>): BootColors | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(BOOT_COLORS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!BOOT_FIELDS.every((field) => typeof record[field] === 'string' && HEX.test(record[field] as string))) return null;
    return {
      background: record['background'] as string,
      surface: record['surface'] as string,
      ink: record['ink'] as string,
      inkMuted: record['inkMuted'] as string,
      line: record['line'] as string,
      accent: record['accent'] as string,
    };
  } catch {
    return null;
  }
}

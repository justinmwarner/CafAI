import { describe, expect, it } from 'vitest';
import { buildPalette, customTint, namedTint } from './palette.ts';
import { BOOT_COLORS_KEY, bootColors, loadBootColors, paletteFor, resolveMode, resolveTint, saveBootColors } from './appearance.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
}

describe('resolveMode', () => {
  it('uses dark and light as they are, and the device for auto', () => {
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('auto', true)).toBe('dark');
    expect(resolveMode('auto', false)).toBe('light');
  });
});

describe('resolveTint', () => {
  it('finds a named tint, reads an unknown id as Crema, and builds a hue', () => {
    expect(resolveTint('matcha')).toBe(namedTint('matcha'));
    expect(resolveTint('forest')).toBe(namedTint('crema'));
    expect(resolveTint({ hue: 210 })).toEqual(customTint(210));
  });
});

describe('paletteFor', () => {
  it('builds the palette for the resolved mode and tint, once', () => {
    const p = paletteFor({ mode: 'auto', tint: 'ocean' }, false);
    expect(p).toEqual(buildPalette('light', namedTint('ocean')));
    expect(paletteFor({ mode: 'light', tint: 'ocean' }, true)).toBe(p);
  });
});

describe('boot colours', () => {
  const palette = buildPalette('light', namedTint('matcha'));

  it('save and load the few colours the boot screens use', () => {
    const storage = memoryStorage();
    saveBootColors(storage, bootColors(palette));
    expect(JSON.parse(storage.items.get(BOOT_COLORS_KEY)!)).toEqual(bootColors(palette));
    expect(loadBootColors(storage)).toEqual(bootColors(palette));
    expect(bootColors(palette)).toEqual({
      background: palette.background,
      surface: palette.surface,
      ink: palette.ink,
      inkMuted: palette.inkMuted,
      line: palette.line,
      accent: palette.accent,
    });
  });

  it('ignore anything that is not six #rrggbb colours', () => {
    for (const raw of ['not json', '{"background":"red"}', 'null', '[]']) {
      expect(loadBootColors(memoryStorage({ [BOOT_COLORS_KEY]: raw }))).toBeNull();
    }
    expect(loadBootColors(memoryStorage())).toBeNull();
  });

  it('never throw when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadBootColors(blocked)).toBeNull();
    expect(() => saveBootColors(blocked, bootColors(palette))).not.toThrow();
  });
});

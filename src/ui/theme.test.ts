import { describe, expect, it } from 'vitest';
import { createCafaiTheme, TOUCH_TARGET } from './theme.ts';

describe('theme', () => {
  const theme = createCafaiTheme();

  it('is dark with the crema accent', () => {
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main.toLowerCase()).toBe('#c8a27a');
  });

  it('makes every touch control at least 48 px tall', () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(48);
    const overrides = theme.components!;
    expect(overrides.MuiButton?.styleOverrides?.root).toMatchObject({ minHeight: TOUCH_TARGET });
    expect(overrides.MuiButton?.styleOverrides?.sizeSmall).toMatchObject({ minHeight: TOUCH_TARGET });
    expect(overrides.MuiIconButton?.styleOverrides?.root).toMatchObject({ minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET });
    expect(overrides.MuiChip?.styleOverrides?.clickable).toMatchObject({ minHeight: TOUCH_TARGET });
  });

  it('publishes the --safe-* variables and touch rules through CssBaseline', () => {
    const baseline = theme.components!.MuiCssBaseline!.styleOverrides as Record<string, Record<string, string>>;
    expect(baseline[':root']).toMatchObject({ '--safe-bottom': 'env(safe-area-inset-bottom, 0px)' });
    expect(baseline.html).toMatchObject({ touchAction: 'manipulation' });
    expect(baseline['*']).toMatchObject({ WebkitTapHighlightColor: 'transparent' });
    expect(baseline['button, a, [role="button"], .MuiButtonBase-root']).toMatchObject({ userSelect: 'none' });
  });
});

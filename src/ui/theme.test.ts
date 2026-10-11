import { describe, expect, it } from 'vitest';
import { buildPalette, namedTint } from './palette.ts';
import { createCafaiTheme, FONT_FAMILY, theme, TOUCH_TARGET } from './theme.ts';

describe('theme', () => {
  const crema = buildPalette('dark', namedTint('crema'));

  it('defaults to dark Crema', () => {
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe(crema.accent);
    expect(theme.palette.background.default).toBe(crema.background);
  });

  it('takes every colour from the palette it is given', () => {
    const p = buildPalette('light', namedTint('matcha'));
    const t = createCafaiTheme(p);
    expect(t.palette.mode).toBe('light');
    expect(t.palette.primary.main).toBe(p.accent);
    expect(t.palette.primary.contrastText).toBe(p.onAccent);
    expect(t.palette.error.contrastText).toBe(p.onError);
    expect(t.palette.background).toMatchObject({ default: p.background, paper: p.surface });
    expect(t.palette.text).toMatchObject({ primary: p.ink, secondary: p.inkMuted });
    expect(t.palette.divider).toBe(p.line);
    expect(t.palette.cafai).toEqual({ raised: p.raised, accentSoft: p.accentSoft, live: p.live, graph: p.graph });
  });

  it('sets everything in Figtree, with the arrows fallback next', () => {
    expect(FONT_FAMILY.startsWith('"Figtree", "CafAI Symbols"')).toBe(true);
    expect(theme.typography.fontFamily).toBe(FONT_FAMILY);
    expect(theme.typography.readout).toMatchObject({ fontFamily: FONT_FAMILY, fontVariantNumeric: 'tabular-nums' });
    expect(theme.typography.display).toMatchObject({ fontVariantNumeric: 'tabular-nums' });
    expect(theme.typography.label).toMatchObject({ fontSize: '0.8125rem' });
    // Labels are sentence case now; nothing renders in capitals by default.
    expect(theme.typography.overline).toMatchObject({ textTransform: 'none' });
    expect(theme.typography.button).toMatchObject({ textTransform: 'none' });
  });

  it('has a tonal button variant on the raised colour', () => {
    const variants = theme.components!.MuiButton!.variants!;
    const tonal = variants.find((v) => typeof v.props === 'object' && v.props.variant === 'tonal' && v.props.color === undefined);
    expect(tonal?.style).toMatchObject({ backgroundColor: crema.raised, color: crema.ink });
    const error = variants.find((v) => typeof v.props === 'object' && v.props.variant === 'tonal' && v.props.color === 'error');
    expect(error?.style).toMatchObject({ color: crema.error });
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

  it('paints the page itself in the look, taking over from the boot colours in index.html', () => {
    const p = buildPalette('light', namedTint('matcha'));
    const baseline = createCafaiTheme(p).components!.MuiCssBaseline!.styleOverrides as Record<string, Record<string, string>>;
    expect(baseline.html).toMatchObject({ backgroundColor: p.background });
  });

  it("sets form controls in the page's typeface: a browser gives a bare button its own", () => {
    const baseline = theme.components!.MuiCssBaseline!.styleOverrides as Record<string, Record<string, string>>;
    expect(baseline['button, input, select, textarea']).toEqual({ fontFamily: 'inherit' });
  });

  it('draws placeholders in the muted ink at full strength, not faded', () => {
    const p = buildPalette('light', namedTint('tamper'));
    const input = createCafaiTheme(p).components!.MuiInputBase!.styleOverrides!.input as Record<string, unknown>;
    expect(input['&::placeholder']).toEqual({ color: p.inkMuted, opacity: 1 });
  });

  it('outlines a chip in a status colour or the accent in that colour, opaque, as the contrast sweep checks it', () => {
    const p = buildPalette('light', namedTint('matcha'));
    const variants = createCafaiTheme(p).components!.MuiChip!.variants!;
    const outline = (color: string) =>
      variants.find((v) => typeof v.props === 'object' && v.props.variant === 'outlined' && v.props.color === color)?.style;
    expect(outline('primary')).toEqual({ borderColor: p.accent });
    expect(outline('success')).toEqual({ borderColor: p.success });
    expect(outline('warning')).toEqual({ borderColor: p.warning });
    expect(outline('error')).toEqual({ borderColor: p.error });
    expect(outline('info')).toEqual({ borderColor: p.info });
  });
});

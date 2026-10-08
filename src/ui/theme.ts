/**
 * CafAI's look, built from one palette (palette.ts): Figtree throughout, type
 * sized to be read from a step back from the machine, quiet tonal surfaces
 * instead of outlines, and every control at least 48 px tall because it is
 * pressed by a wet thumb, not a mouse.
 *
 * Plain palette colours only (no `cssVariables`): MUI's CSS-variable mode can
 * emit color-mix(), which the Chromium 91 WebView does not understand.
 */
import type { CSSProperties } from 'react';
import { createTheme, type Theme } from '@mui/material/styles';
import { blend } from './color.ts';
import { buildPalette, DEFAULT_TINT_ID, namedTint, type GraphPalette, type Palette } from './palette.ts';

/** Figtree for everything; the arrows it lacks (→) come from the CafAI Symbols faces (fonts-symbols.css). */
export const FONT_FAMILY = '"Figtree", "CafAI Symbols", system-ui, "Helvetica", "Arial", sans-serif';

/** Smallest comfortable touch target, in CSS px. */
export const TOUCH_TARGET = 48;

/** The palette colours MUI has no slot for: `theme.palette.cafai`, and in sx `bgcolor: 'cafai.raised'`. */
export interface CafaiColors {
  raised: string;
  accentSoft: string;
  live: string;
  graph: GraphPalette;
}

declare module '@mui/material/styles' {
  interface Palette {
    cafai: CafaiColors;
  }
  interface PaletteOptions {
    cafai?: CafaiColors;
  }
  interface TypographyVariants {
    display: CSSProperties;
    readoutLarge: CSSProperties;
    readout: CSSProperties;
    label: CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: CSSProperties;
    readoutLarge?: CSSProperties;
    readout?: CSSProperties;
    label?: CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true;
    readoutLarge: true;
    readout: true;
    label: true;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

const tabular = { fontVariantNumeric: 'tabular-nums' } as const;

export function createCafaiTheme(palette: Palette = buildPalette('dark', namedTint(DEFAULT_TINT_ID))): Theme {
  const dark = palette.mode === 'dark';
  const tonalHover = blend(palette.ink, palette.raised, dark ? 0.08 : 0.06);
  const tonalDisabled = blend(palette.ink, palette.raised, 0.38);
  return createTheme({
    // Opt-in keyboard focus ring; touch users never see it.
    focusVisible: true,
    palette: {
      mode: palette.mode,
      primary: { main: palette.accent, contrastText: palette.onAccent },
      // Unused by CafAI; set so nothing falls back to MUI's purple.
      secondary: { main: palette.inkMuted, contrastText: palette.background },
      error: { main: palette.error, contrastText: palette.onError },
      warning: { main: palette.warning },
      success: { main: palette.success },
      info: { main: palette.info },
      background: { default: palette.background, paper: palette.surface },
      text: { primary: palette.ink, secondary: palette.inkMuted },
      divider: palette.line,
      cafai: { raised: palette.raised, accentSoft: palette.accentSoft, live: palette.live, graph: palette.graph },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY,
      fontWeightMedium: 550,
      fontWeightBold: 700,
      // The live shot's timer.
      display: { fontFamily: FONT_FAMILY, fontSize: '2.875rem', fontWeight: 650, lineHeight: 1, letterSpacing: '-0.02em', ...tabular },
      // The live shot's readouts.
      readoutLarge: { fontFamily: FONT_FAMILY, fontSize: '1.875rem', fontWeight: 650, lineHeight: 1.1, letterSpacing: '-0.01em', ...tabular },
      h4: { fontSize: '1.75rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.015em' },
      // The machine's state line.
      h5: { fontSize: '1.4375rem', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.01em' },
      // Screen titles and the bag.
      h6: { fontSize: '1.1875rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.005em' },
      subtitle1: { fontSize: '1.0625rem', fontWeight: 650, lineHeight: 1.35 },
      subtitle2: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.4 },
      body1: { fontSize: '1rem', lineHeight: 1.55 },
      body2: { fontSize: '0.9375rem', lineHeight: 1.5 },
      // Machine readouts.
      readout: { fontFamily: FONT_FAMILY, fontSize: '1.1875rem', fontWeight: 650, lineHeight: 1.2, ...tabular },
      // Readout and field labels, sentence case.
      label: { fontFamily: FONT_FAMILY, fontSize: '0.8125rem', fontWeight: 550, lineHeight: 1.3 },
      button: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.25, textTransform: 'none', letterSpacing: '0.005em' },
      caption: { fontSize: '0.8125rem', lineHeight: 1.35 },
      // Kept for any stray use, but in sentence case like the labels.
      overline: { fontSize: '0.8125rem', fontWeight: 550, lineHeight: 1.3, letterSpacing: 0, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Insets reach the layout only through these variables, so the
          // safe-area module (and the dev/tablet.html harness) can override
          // what env() reports.
          ':root': {
            '--safe-top': 'env(safe-area-inset-top, 0px)',
            '--safe-right': 'env(safe-area-inset-right, 0px)',
            '--safe-bottom': 'env(safe-area-inset-bottom, 0px)',
            '--safe-left': 'env(safe-area-inset-left, 0px)',
          },
          'html, body, #root': { height: '100%' },
          html: { touchAction: 'manipulation' },
          // The shell owns scrolling; the page itself never scrolls or bounces.
          body: { overflow: 'hidden', overscrollBehavior: 'none' },
          '*': { WebkitTapHighlightColor: 'transparent' },
          // A long press on a button must not select its label or open a callout.
          'button, a, [role="button"], .MuiButtonBase-root': {
            touchAction: 'manipulation',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          },
          // Even line lengths on headings; engines before Chromium 114 simply ignore it.
          'h1, h2, h3': { textWrap: 'balance' },
          // Asked for less motion: every animation, MUI's spinners and progress
          // bars included, settles at once. Each one has words beside it that
          // say what is happening, so nothing is lost by holding still.
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          // Dark-mode elevation overlays would grey the tinted surfaces.
          root: { backgroundImage: 'none' },
          outlined: { borderRadius: 16 },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: TOUCH_TARGET, borderRadius: 12, lineHeight: 1.25 },
          sizeSmall: { minHeight: TOUCH_TARGET },
          sizeLarge: { minHeight: 56, fontSize: '1.0625rem' },
        },
        variants: [
          {
            // Secondary actions: a quiet filled button on the raised colour, no outline.
            props: { variant: 'tonal' },
            style: {
              padding: '6px 16px',
              backgroundColor: palette.raised,
              color: palette.ink,
              '@media (hover: hover)': { '&:hover': { backgroundColor: tonalHover } },
              '&.Mui-disabled': { backgroundColor: palette.raised, color: tonalDisabled },
            },
          },
          { props: { variant: 'tonal', color: 'error' }, style: { color: palette.error } },
          { props: { variant: 'tonal', color: 'warning' }, style: { color: palette.warning } },
          { props: { variant: 'tonal', color: 'success' }, style: { color: palette.success } },
        ],
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET } },
      },
      MuiToggleButton: {
        styleOverrides: { root: { minHeight: TOUCH_TARGET, textTransform: 'none' } },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontSize: '0.9375rem' },
          // Anything tappable is a full touch target; status chips stay compact.
          clickable: { minHeight: TOUCH_TARGET, height: 'auto', borderRadius: TOUCH_TARGET / 2 },
          deletable: { minHeight: TOUCH_TARGET, height: 'auto', borderRadius: TOUCH_TARGET / 2 },
        },
      },
      MuiTab: { styleOverrides: { root: { minHeight: TOUCH_TARGET, textTransform: 'none' } } },
      MuiListItemButton: { styleOverrides: { root: { minHeight: TOUCH_TARGET } } },
      MuiMenuItem: { styleOverrides: { root: { minHeight: TOUCH_TARGET } } },
    },
  });
}

/** The default look (dark, Crema), for code without an appearance of its own: the app until stage 2, tests, previews. */
export const theme = createCafaiTheme();

/**
 * CafAI's look: a dark espresso bar, one warm crema accent, type sized to be
 * read from a step back from the machine, and every control at least 48 px
 * tall because it is pressed by a wet thumb, not a mouse.
 *
 * Plain palette colors only (no `cssVariables`): MUI's CSS-variable mode can
 * emit color-mix(), which the Chromium 91 WebView does not understand.
 */
import { createTheme, type Theme } from '@mui/material/styles';

export const FONT_FAMILY = '"Roboto", "Helvetica", "Arial", sans-serif';

/** Raw tokens, for the few places that draw outside MUI (the uPlot canvas). */
export const tokens = {
  background: '#14100D',
  surface: '#1E1813',
  surfaceRaised: '#2A211B',
  line: 'rgba(246, 236, 227, 0.12)',
  ink: '#F6ECE3',
  inkMuted: 'rgba(246, 236, 227, 0.7)',
  crema: '#C8A27A',
  cremaInk: '#1B130C',
} as const;

/** Shot graph colors, after Crema: green pressure, blue flow, amber weight flow. */
export const graphColors = {
  pressure: '#5FD3A0',
  flow: '#5AAEF2',
  weightFlow: '#F0A35E',
  weight: '#D9C4A8',
  grid: 'rgba(246, 236, 227, 0.08)',
  axis: 'rgba(246, 236, 227, 0.62)',
} as const;

/** Smallest comfortable touch target, in CSS px. */
export const TOUCH_TARGET = 48;

export function createCafaiTheme(): Theme {
  return createTheme({
    // Opt-in keyboard focus ring; touch users never see it.
    focusVisible: true,
    palette: {
      mode: 'dark',
      primary: { main: tokens.crema, light: '#DDBF9C', dark: '#9E7A55', contrastText: tokens.cremaInk },
      secondary: { main: '#8FB9A8', contrastText: tokens.cremaInk },
      error: { main: '#F07D6B' },
      warning: { main: '#F0C05E' },
      success: { main: '#5FD3A0' },
      info: { main: '#6BB5F0' },
      background: { default: tokens.background, paper: tokens.surface },
      text: { primary: tokens.ink, secondary: tokens.inkMuted },
      divider: tokens.line,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY,
      h4: { fontSize: '1.75rem', fontWeight: 500, lineHeight: 1.2 },
      h5: { fontSize: '1.375rem', fontWeight: 500, lineHeight: 1.25 },
      h6: { fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.3 },
      subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.4 },
      subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.4 },
      body1: { fontSize: '1rem', lineHeight: 1.5 },
      body2: { fontSize: '0.9375rem', lineHeight: 1.45 },
      button: { fontSize: '1rem', fontWeight: 500, textTransform: 'none', letterSpacing: '0.01em' },
      caption: { fontSize: '0.8125rem', lineHeight: 1.35 },
      overline: { fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.08em', lineHeight: 1.6 },
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
        },
      },
      MuiPaper: {
        // Dark-mode elevation overlays turn the warm surfaces grey.
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { minHeight: TOUCH_TARGET, borderRadius: 12, lineHeight: 1.25 },
          sizeSmall: { minHeight: TOUCH_TARGET },
          sizeLarge: { minHeight: 56, fontSize: '1.0625rem' },
        },
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

export const theme = createCafaiTheme();

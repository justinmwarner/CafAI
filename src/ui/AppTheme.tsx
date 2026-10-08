import { useEffect, useMemo, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { useAppearance } from '../app/services.tsx';
import { bootColors, paletteFor, saveBootColors } from './appearance.ts';
import type { Palette } from './palette.ts';
import { usePrefersDark } from './platform/usePrefersDark.ts';
import { createCafaiTheme } from './theme.ts';

const themes = new WeakMap<Palette, Theme>();

/** One MUI theme per palette, so switching back to a look costs nothing. */
function themeFor(palette: Palette): Theme {
  let theme = themes.get(palette);
  if (!theme) {
    theme = createCafaiTheme(palette);
    themes.set(palette, theme);
  }
  return theme;
}

/**
 * The theme for the appearance in Settings (and, in Auto, the device's dark
 * preference), plus CssBaseline: touch rules, insets, no page scroll, and the
 * colour scheme, so native controls (select lists, scrollbars) match.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const appearance = useAppearance();
  const prefersDark = usePrefersDark();
  const palette = paletteFor(appearance, prefersDark);
  const theme = useMemo(() => themeFor(palette), [palette]);
  // The boot screens of the next start show this look too.
  useEffect(() => {
    try {
      saveBootColors(window.localStorage, bootColors(palette));
    } catch {
      // Storage blocked (reading window.localStorage throws): the boot screens keep the default look.
    }
  }, [palette]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}

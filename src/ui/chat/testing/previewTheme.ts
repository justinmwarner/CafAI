/**
 * Stand-in for the shell's theme (owned by the baseline UI workstream) so the
 * chat screens can be tested and previewed on their own. Mirrors the shell
 * brief: dark, crema primary, 48 px touch targets. Not shipped.
 */
import { createTheme } from '@mui/material/styles';

export const previewTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#C8A27A' },
    background: { default: '#131110', paper: '#1d1a18' },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { styleOverrides: { root: { minHeight: 48, textTransform: 'none' } } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 48, minHeight: 48 } } },
    MuiChip: { styleOverrides: { root: { minHeight: 48 } } },
  },
});

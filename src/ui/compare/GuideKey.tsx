/**
 * The key for the shot drawn under another (D-CURVE-3): a pale band, the
 * form the shot under takes, beside its name. The band is neutral (the muted
 * ink washed toward the page, `graph.guide`) because it stands for the form
 * in both colours, as the dashed target does on Decent's charts; this shot's
 * lines keep their own colour keys.
 */
import Box from '@mui/material/Box';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';

/** The band's swatch: as wide as a series key, as tall as a band reads beside a line. */
export function GuideSwatch({ width = 12, height = 6, sx }: { width?: number; height?: number; sx?: SxProps<Theme> }) {
  const theme = useTheme();
  return (
    <Box
      component="span"
      aria-hidden
      sx={[
        { display: 'inline-block', flex: 'none', width, height, borderRadius: `${height / 2}px`, bgcolor: theme.palette.cafai.graph.guide },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}

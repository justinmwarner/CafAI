/**
 * The usage card's thin meter (D239, D240): what it went on, the plan's use
 * on the computer, and the month's spend against the budget. A 6 px round
 * track in raised, filled from the left in a theme colour: the accent, or
 * the budget's success, warning and error. Drawn for the eye only: the words
 * beside it say the same for everyone (the share, the percent), so colour is
 * never the only signal and assistive tech reads the words.
 */
import Box from '@mui/material/Box';

export interface UsageMeterProps {
  /** How full, 0 to 1; past either end it is drawn empty or full. */
  share: number;
  /** A theme colour for the fill (sx): the accent unless told. */
  color?: string;
}

export function UsageMeter({ share, color = 'primary.main' }: UsageMeterProps) {
  const filled = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  return (
    <Box aria-hidden className="usage-meter" sx={{ height: 6, borderRadius: '999px', bgcolor: 'cafai.raised', overflow: 'hidden' }}>
      <Box
        className="usage-meter-fill"
        sx={{ height: '100%', width: `${Math.round(filled * 1000) / 10}%`, bgcolor: color, borderRadius: '999px' }}
      />
    </Box>
  );
}

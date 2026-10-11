/**
 * A prompt chip right above the composer, as drawn (DESIGN: stats-prompt):
 * 40 px, the surface colour inside a line, an ink-muted icon; an invisible
 * band 5 px above and below makes its touch area the full 48 px, and a touch
 * leaves no hover colour behind. Stats, Taste words and Need help? share it.
 */
export const promptChipSx = {
  position: 'relative',
  height: 40,
  minHeight: 40,
  borderRadius: '20px',
  bgcolor: 'background.paper',
  borderColor: 'divider',
  fontWeight: 600,
  // A tap leaves :hover behind on a touch screen: the chip keeps its colour.
  '&.MuiChip-clickable:hover': { bgcolor: 'background.paper' },
  '& .MuiChip-icon': { color: 'text.secondary', fontSize: 18, ml: '10px' },
  '& .MuiChip-label': { pr: '13px' },
  // From inside the 1 px border: 5 px out each way makes 48.
  '&::after': { content: '""', position: 'absolute', top: -5, right: 0, bottom: -5, left: 0 },
} as const;

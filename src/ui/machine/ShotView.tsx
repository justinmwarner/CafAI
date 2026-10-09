/**
 * The Shot view (#/shot): the big graph, and the coach saying it is watching.
 * The tablet's main pane under the top bar, and the phone's Shot tab.
 *
 * Laid out for its own box rather than the window's (useOwnLayout.ts), as
 * the main pane loses height to an alert and a phone's tabs or rail:
 *
 * - wide (a tablet): the step beside the caption and four readouts in a row,
 *   across the pane up to MAX_WIDTH, so the numbers and the curves stay
 *   within a glance on a wide screen;
 * - narrow (an upright phone, under NARROW_BELOW): the step on a line of its
 *   own and the readouts two by two;
 * - short (a phone on its side, under SHORT_BELOW): four readouts in a row in
 *   the smaller sizes, with less air, so 120 px of plot and the coach's note
 *   still fit under them.
 *
 * The plot takes what is left, at least PLOT_MIN_HEIGHT; should even that not
 * fit (an alert on the smallest phone on its side), the view scrolls rather
 * than cutting off the note.
 */
import { useRef } from 'react';
import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';
import { CoachNote } from './CoachNote.tsx';
import { LiveShotGraph } from './LiveShotGraph.tsx';
import { useOwnLayout } from './useOwnLayout.ts';

const MAX_WIDTH = 960;
const NARROW_BELOW = 600;
const SHORT_BELOW = 440;
const PLOT_MIN_HEIGHT = 120;

type Arrangement = 'wide' | 'narrow' | 'short';

function arrangement(width: number, height: number): Arrangement {
  if (height > 0 && height < SHORT_BELOW) return 'short';
  if (width > 0 && width < NARROW_BELOW) return 'narrow';
  return 'wide';
}

export function ShotView({ awaitingOutcome }: { awaitingOutcome: boolean }) {
  const view = useRef<HTMLDivElement>(null);
  const layout = useOwnLayout(view, arrangement);
  return (
    <Box
      ref={view}
      data-testid={TID.shotView}
      sx={{
        height: '100%',
        minHeight: 0,
        width: '100%',
        maxWidth: MAX_WIDTH,
        mx: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: layout === 'short' ? 1 : 1.25,
        px: layout === 'wide' ? 2.5 : 1.5,
        py: layout === 'short' ? 1 : 1.75,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <LiveShotGraph
        variant="full"
        narrow={layout === 'narrow'}
        compact={layout === 'short'}
        minPlotHeight={PLOT_MIN_HEIGHT}
      />
      <CoachNote awaitingOutcome={awaitingOutcome} />
    </Box>
  );
}

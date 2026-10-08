import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';
import { CoachNote } from './CoachNote.tsx';
import { LiveShotGraph } from './LiveShotGraph.tsx';

/** The tablet's main pane during a shot (#/shot): the big graph, and the coach saying it is watching. */
export function ShotView({ awaitingOutcome }: { awaitingOutcome: boolean }) {
  return (
    <Box data-testid={TID.shotView} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.25, px: 2.5, py: 1.75 }}>
      <LiveShotGraph variant="full" />
      <CoachNote awaitingOutcome={awaitingOutcome} />
    </Box>
  );
}

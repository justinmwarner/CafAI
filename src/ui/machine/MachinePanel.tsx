/**
 * The machine column: status on top, the buttons in the middle, the live
 * graph filling the rest. The graph sits lowest on purpose: Decaid floats its
 * exit-hint snackbar over the bottom of the screen for 10 s after the skin
 * opens, so nothing that must be tapped lives down there.
 */
import Box from '@mui/material/Box';
import { LiveShotGraph } from './LiveShotGraph.tsx';
import { MachineControls } from './MachineControls.tsx';
import { MachineStatus } from './MachineStatus.tsx';

export interface MachinePanelProps {
  /** Show the live shot graph (default true). */
  showGraph?: boolean;
}

export function MachinePanel({ showGraph = true }: MachinePanelProps) {
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        px: 1.5,
        py: 1.25,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <MachineStatus />
      <MachineControls />
      {showGraph && <LiveShotGraph />}
    </Box>
  );
}

/**
 * The machine column: status on top, the buttons in the middle, the live
 * graph filling the rest. The graph sits lowest on purpose: Decaid floats its
 * exit-hint snackbar over the bottom of the screen for 10 s after the skin
 * opens, so nothing that must be tapped lives down there.
 *
 * On a tablet the graph is the preview card that opens the Shot view (and is
 * left out while the main pane shows it); on a phone the panel is the whole
 * Machine tab, with the big graph and the coach's note under the buttons.
 */
import Box from '@mui/material/Box';
import { CoachNote } from './CoachNote.tsx';
import { LiveShotGraph } from './LiveShotGraph.tsx';
import { MachineControls } from './MachineControls.tsx';
import { MachineStatus } from './MachineStatus.tsx';

export interface MachinePanelProps {
  /** 'preview' (tablet: the panel graph as a button to the Shot view), 'full' (phone's Machine tab: the big graph and the note), 'none'. */
  graph?: 'preview' | 'full' | 'none';
  onOpenGraph?: () => void;
  /** For graph="full": the note's "Reading the shot" state. */
  awaitingOutcome?: boolean;
  /** Older prop: false means graph="none". */
  showGraph?: boolean;
}

export function MachinePanel({ graph = 'preview', onOpenGraph, awaitingOutcome = false, showGraph = true }: MachinePanelProps) {
  const shown = showGraph ? graph : 'none';
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
      {/* Either graph grows into the height the status and buttons leave; a short screen scrolls the column instead of squashing the plot. */}
      {shown === 'preview' && <LiveShotGraph onOpen={onOpenGraph} />}
      {shown === 'full' && (
        <>
          <LiveShotGraph variant="full" />
          <CoachNote awaitingOutcome={awaitingOutcome} />
        </>
      )}
    </Box>
  );
}

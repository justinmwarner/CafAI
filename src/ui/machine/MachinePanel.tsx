/**
 * The machine column: status on top, the buttons in the middle, the live
 * graph filling the rest. The graph sits lowest on purpose: Decaid floats its
 * exit-hint snackbar over the bottom of the screen for 10 s after the skin
 * opens, so nothing that must be tapped lives down there.
 *
 * On a tablet the graph is the preview card that opens the Shot view (and is
 * left out while the main pane shows it); on a phone the panel is the whole
 * Machine tab, with the big graph and the coach's note under the buttons.
 *
 * A phone on its side has the height for the buttons or for the graph, not
 * both, so there the panel splits in two columns (`columns={2}`): status and
 * buttons on the left, scrolling inside their column if they must, and the
 * graph and the note on the right at full height, no scrolling needed.
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
  /** 2: status and buttons in a left column, the graph in a right one (a phone on its side). Default 1. */
  columns?: 1 | 2;
}

/** The plot's smallest height beside the buttons, where the whole column is one short screen tall. */
const SPLIT_MIN_PLOT_HEIGHT = 110;

export function MachinePanel({
  graph = 'preview',
  onOpenGraph,
  awaitingOutcome = false,
  showGraph = true,
  columns = 1,
}: MachinePanelProps) {
  const shown = showGraph ? graph : 'none';
  const split = columns === 2 && shown !== 'none';
  const minPlotHeight = split ? SPLIT_MIN_PLOT_HEIGHT : undefined;
  // The same elements in both arrangements (one column lets the wrappers'
  // children flow as if the wrappers were not there), so turning the phone
  // never remounts the buttons: a command in flight stays in flight.
  const column = {
    display: split ? 'flex' : 'contents',
    flexDirection: 'column',
    // Side by side the screen is short: a little less air, so Stop shows whole wherever it fits.
    gap: split ? 0.75 : 1.25,
    minWidth: 0,
    minHeight: 0,
  } as const;
  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: split ? 'row' : 'column',
        gap: split ? 2 : 1.25,
        px: 1.5,
        py: split ? 0.5 : 1.25,
        overflowY: split ? 'hidden' : 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <Box sx={{ ...column, ...(split ? { flex: '0 0 45%', overflowY: 'auto', overscrollBehavior: 'contain' } : null) }}>
        <MachineStatus />
        <MachineControls />
      </Box>
      {shown !== 'none' && (
        <Box sx={{ ...column, ...(split ? { flex: '1 1 0' } : null) }}>
          {/* Either graph grows into the height the status and buttons leave; a short screen scrolls the column instead of squashing the plot. */}
          {shown === 'preview' && <LiveShotGraph onOpen={onOpenGraph} minPlotHeight={minPlotHeight} />}
          {shown === 'full' && (
            <>
              <LiveShotGraph variant="full" minPlotHeight={minPlotHeight} />
              <CoachNote awaitingOutcome={awaitingOutcome} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

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
 *
 * An upright phone too short for all of it at once gives the shot the room
 * of the status and the start buttons, from the shot's start until the chat
 * has its outcome: the big graph is drawn over them, they stay in their
 * places, hidden, and the coach's note goes under Stop. Nothing above Stop
 * changes height, so Stop stays exactly where it was. A tab the barista has
 * scrolled keeps the usual arrangement: the shorter one would scroll it back.
 */
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import Box from '@mui/material/Box';
import { useServices } from '../../app/services.tsx';
import { CoachNote } from './CoachNote.tsx';
import { LiveShotGraph } from './LiveShotGraph.tsx';
import { MachineControls, START_HEIGHT } from './MachineControls.tsx';
import { MachineStatus } from './MachineStatus.tsx';
import { shotTraceFor } from './shotTrace.ts';

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
/**
 * The preview card's: its plot gives way this far before the 962x602 column
 * scrolls, room for a reason under the buttons with the last shot's values in
 * the legend.
 */
const PREVIEW_MIN_PLOT_HEIGHT = 64;
/** An upright phone's big graph under the buttons. */
const PHONE_MIN_PLOT_HEIGHT = 120;
/**
 * Below this an upright phone's tab cannot hold the status, the buttons, the
 * big graph (PHONE_MIN_PLOT_HEIGHT of plot) and a three-line note at once.
 */
const SHOT_COVERS_BELOW = 660;
/** The panel's gap between the status and the buttons, in px (`gap: 1.25`). */
const GAP_PX = 10;
/** How far the shot reaches into the 8 px between the start row and Stop. */
const INTO_STOP_GAP_PX = 4;

const neverChanges = () => () => {};

/** The panel's height and whether it is scrolled to its top, while `watch`. */
function usePanelRoom(panel: RefObject<HTMLDivElement | null>, watch: boolean): { height: number; atTop: boolean } {
  const [height, setHeight] = useState(0);
  const [atTop, setAtTop] = useState(true);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!watch || !element) return;
    const measure = () => setHeight(element.clientHeight);
    const scrolled = () => setAtTop(element.scrollTop <= 0);
    measure();
    scrolled();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(element);
    else window.addEventListener('resize', measure);
    element.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      element.removeEventListener('scroll', scrolled);
    };
  }, [panel, watch]);
  return { height, atTop };
}

export function MachinePanel({
  graph = 'preview',
  onOpenGraph,
  awaitingOutcome = false,
  showGraph = true,
  columns = 1,
}: MachinePanelProps) {
  const shown = showGraph ? graph : 'none';
  const split = columns === 2 && shown !== 'none';
  const upright = shown === 'full' && !split;
  const panel = useRef<HTMLDivElement>(null);
  const room = usePanelRoom(panel, upright);
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  // Only an upright phone's tab changes with the shot, so only it hears of one.
  const live = useSyncExternalStore(upright ? trace.subscribe : neverChanges, () => upright && trace.getState().phase === 'live');
  // The same rule as the coach's note: the shot holds the screen until the chat has its outcome.
  const covered = upright && room.height > 0 && room.height < SHOT_COVERS_BELOW && room.atTop && (live || awaitingOutcome);
  // The same elements in every arrangement (one column lets the wrappers'
  // children flow as if the wrappers were not there), so turning the phone, or
  // the shot covering the status, never remounts the buttons: a command in
  // flight stays in flight.
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
      ref={panel}
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
        <Box sx={{ position: 'relative' }}>
          <Box sx={covered ? { visibility: 'hidden' } : undefined}>
            <MachineStatus />
          </Box>
          {covered && (
            // Over the status and the start row, down to just above Stop, never over it.
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: `-${GAP_PX + START_HEIGHT + INTO_STOP_GAP_PX}px`,
                left: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <LiveShotGraph variant="full" minPlotHeight={0} />
            </Box>
          )}
        </Box>
        <MachineControls startsCovered={covered} />
      </Box>
      {shown !== 'none' && (
        <Box sx={{ ...column, ...(split ? { flex: '1 1 0' } : null) }}>
          {/* Either graph grows into the height the status and buttons leave; a short screen scrolls the column instead of squashing the plot. */}
          {shown === 'preview' && <LiveShotGraph onOpen={onOpenGraph} minPlotHeight={PREVIEW_MIN_PLOT_HEIGHT} />}
          {shown === 'full' && (
            <>
              {!covered && (
                <LiveShotGraph variant="full" compact={split} minPlotHeight={split ? SPLIT_MIN_PLOT_HEIGHT : PHONE_MIN_PLOT_HEIGHT} />
              )}
              <CoachNote awaitingOutcome={awaitingOutcome} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * The Shot view (#/shot): the big graph, the coach saying it is watching, and
 * Next step while a step runs that has another after it (spec 6.7). The
 * tablet's main pane under the top bar, and the phone's Shot tab.
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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import { isShotMachineState } from '../../api/machineStates.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { CoachNote } from './CoachNote.tsx';
import { LiveShotGraph } from './LiveShotGraph.tsx';
import { useSharedLoadedProfile } from './LoadedProfileContext.tsx';
import { machineCommandsFor } from './useMachineCommands.ts';
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

/** Substates in which a profile step runs; in the preheat before them the step index is still the last shot's. */
const STEP_SUBSTATES: ReadonlySet<string> = new Set(['preinfusion', 'pouring']);
/** After a tap, how long Next step waits at most for the machine to show its next step. */
const SKIP_HOLD_MS = 1500;

/**
 * Moves the shot on to the profile's next step, through the app's one
 * command sender, as the machine row's buttons do: held while any command is
 * in flight or Decaid is out of reach, sent once per tap, a failure shown in
 * the machine alert. Only while a step runs and the profile in Decaid's
 * workflow (the shell's one read) has another after it; it stays through
 * skipStep, Decaid's name for the moment the machine moves on. Its icon
 * alone, named, where the room is short, so the coach's note keeps its width.
 *
 * Decaid answers the skip before a snapshot shows the next step, and unlike
 * Stop a second skip is not the same as one: it would take the step after.
 * So after a tap it waits for the machine to show another step, or
 * SKIP_HOLD_MS for a skip the machine never shows.
 */
function NextStep({ iconOnly }: { iconOnly: boolean }) {
  const { decaid } = useServices();
  const commands = useMemo(() => machineCommandsFor(decaid), [decaid]);
  const pending = useSyncExternalStore(commands.subscribe, () => commands.getState().pending);
  const unreachable = useTelemetry((s) => s.unreachable);
  const steps = useSharedLoadedProfile()?.stepNames?.length ?? 0;
  const frame = useTelemetry((s) => (s.machineConnected ? (s.machine?.profileFrame ?? null) : null));
  /** The step the last tap skipped from, until the hold is over. */
  const [skippedFrom, setSkippedFrom] = useState<number | null>(null);
  useEffect(() => {
    if (skippedFrom === null) return;
    const timer = setTimeout(() => setSkippedFrom(null), SKIP_HOLD_MS);
    return () => clearTimeout(timer);
  }, [skippedFrom]);
  const held = skippedFrom !== null && skippedFrom === frame;
  const shown = useTelemetry((s) => {
    const machine = s.machineConnected ? s.machine : null;
    const frame = machine?.profileFrame;
    return (
      isShotMachineState(machine?.state?.state) &&
      STEP_SUBSTATES.has(machine?.state?.substate ?? '') &&
      typeof frame === 'number' &&
      Number.isInteger(frame) &&
      frame >= 0 &&
      frame + 1 < steps
    );
  });
  if (!shown) return null;
  return (
    <Button
      data-testid={TID.nextStep}
      variant="tonal"
      aria-label={iconOnly ? 'Next step' : undefined}
      startIcon={iconOnly ? undefined : <SkipNextRounded />}
      disabled={pending !== null || held || unreachable}
      loading={pending === 'skipStep'}
      onClick={() => {
        setSkippedFrom(frame);
        void commands.send('skipStep', "Couldn't move to the next step.");
      }}
      sx={{ gridColumn: 2, ml: 1.25, ...(iconOnly ? { minWidth: 48, px: 0 } : { px: 2 }) }}
    >
      {iconOnly ? <SkipNextRounded /> : 'Next step'}
    </Button>
  );
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
      {/* Under the plot, never over the curves: the note, and Next step at the row's end. Nothing showing, no row. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'end', '&:empty': { display: 'none' } }}>
        <CoachNote awaitingOutcome={awaitingOutcome} />
        <NextStep iconOnly={layout !== 'wide'} />
      </Box>
    </Box>
  );
}

/**
 * A drink's view (#/steam, #/hot-water, #/flush; D146-D149): while the machine
 * steams, pours hot water or flushes, the main pane shows it happening, as the
 * Shot view shows a shot. The header names the drink and its phase, with Go
 * back once nothing runs; the dial counts toward what stops the drink; the
 * readouts and the trace say what the machine reports; the drink's own
 * settings sit under them.
 *
 * Laid out for its own box (useOwnLayout.ts), with the Shot view's
 * thresholds:
 *
 * - wide (a tablet): the dial at the left, the readouts over the trace beside
 *   it, the settings across the bottom with their fields side by side;
 * - narrow (an upright phone or small tablet, under NARROW_BELOW): one
 *   column, the settings one row each, the view scrolling inside itself;
 * - short (a phone on its side, under SHORT_BELOW): the dial at the left, and
 *   beside it the header, the readouts and the settings, which scroll; no
 *   trace.
 *
 * Stop is not here: it stays in the top bar, in the running start's place
 * (D90). Every part keeps its place in the tree in every layout, so a rotation
 * keeps a half-typed setting.
 *
 * Once a run the view saw ends with Done, it goes back by itself (D-BACK-1,
 * useDrinkReturn.ts), unless that drink's Go back by itself is off: Go back
 * counts the seconds down after its label over a wash of the accent that
 * drains with them, and Stay sits before it. Stay, or any pointer down or key
 * press in the view, keeps the view for that run; the status says once where
 * it is going, never second by second.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type SyntheticEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/material/styles';
import AirRounded from '@mui/icons-material/AirRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { useOwnLayout } from '../machine/useOwnLayout.ts';
import type { Route } from '../router.ts';
import { useDrinkPresets } from '../settings/useDrinkPresets.ts';
import { LiveDot } from '../shell/ShotTime.tsx';
import { TID } from '../testIds.ts';
import { DrinkDial } from './DrinkDial.tsx';
import { goBackLabel, goBackWords } from './drinkFocus.ts';
import { drinkTarget, hotWaterTimeLimit, phaseWords } from './drinkModel.ts';
import { DrinkReadouts } from './DrinkReadouts.tsx';
import { DrinkSettingsCard } from './DrinkSettingsCard.tsx';
import { DrinkTraceChart } from './DrinkTraceChart.tsx';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';
import type { GoBackOptions } from './useDrinkFocus.ts';
import { useDrinkReturn } from './useDrinkReturn.ts';
import { useDrinkScreen } from './useDrinkScreens.ts';

const MAX_WIDTH = 960;
/**
 * Under this the dial, three readouts and three or four steppers side by side
 * do not fit (an iPad mini or a small tablet upright, in the phone's shell):
 * one column. Every Decent tablet is wider.
 */
const NARROW_BELOW = 800;
const SHORT_BELOW = 440;

type Arrangement = 'wide' | 'narrow' | 'short';

function arrangement(width: number, height: number): Arrangement {
  if (height > 0 && height < SHORT_BELOW) return 'short';
  if (width > 0 && width < NARROW_BELOW) return 'narrow';
  return 'wide';
}

/** Each drink's name and the machine row's own icon (MachineRow.tsx). */
const DRINK: Record<DrinkKind, { name: string; icon: ReactElement }> = {
  steam: { name: 'Steam', icon: <AirRounded /> },
  hotWater: { name: 'Hot water', icon: <WaterDropRounded /> },
  flush: { name: 'Flush', icon: <ShowerRounded /> },
};

const DIAL_SIZE: Record<Arrangement, number> = { wide: 272, narrow: 212, short: 184 };

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/**
 * Under this width the header has no room for Stay and the counting Go back
 * beside the drink's name and phase (an upright phone; hot water's, the
 * widest, takes 447 px): from the countdown until the view goes or the drink
 * runs again, they take a row of their own under them, so nothing below moves
 * as the barista keeps the view.
 */
const COUNTDOWN_ROW = 470;

/** Room for the countdown beside the name; assumed before the header is measured, and without layout. */
const countdownFits = (width: number) => width === 0 || width >= COUNTDOWN_ROW;

/** Go back's wash of the accent, full to nothing, its right edge moving left. */
const drain = keyframes`
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
`;

const visuallyHidden = {
  position: 'absolute',
  // Strings: in sx a bare 1 is 100%.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

const viewSx = (layout: Arrangement) =>
  ({
    height: '100%',
    minHeight: 0,
    width: '100%',
    maxWidth: MAX_WIDTH,
    mx: 'auto',
    display: 'grid',
    overscrollBehavior: 'contain',
    ...(layout === 'wide'
      ? {
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          // The middle row never shrinks under the dial: short of room (an alert under the top bar), the view scrolls.
          gridTemplateRows: 'auto 1fr auto',
          gridTemplateAreas: '"head head" "dial side" "set set"',
          columnGap: 4,
          rowGap: 1.25,
          px: 2.5,
          py: 1.75,
          overflowY: 'auto',
        }
      : layout === 'narrow'
        ? {
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateAreas: '"head" "dial" "side" "set"',
            alignContent: 'start',
            rowGap: 1.5,
            px: 2,
            py: 1.5,
            overflowY: 'auto',
          }
        : {
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gridTemplateRows: 'auto auto minmax(0, 1fr)',
            gridTemplateAreas: '"dial head" "dial side" "dial set"',
            columnGap: 2.5,
            rowGap: 1.25,
            px: 1.75,
            py: 1,
            overflow: 'hidden',
          }),
  }) as const;

/**
 * The phase in words, a polite status: it changes a few times a run, never
 * with every frame. While the view counts down to going back, a screen reader
 * hears where to (`going`) after Done, once; the seconds are on Go back.
 */
function Phase({ kind, run, going }: { kind: DrinkKind; run: DrinkRun | null; going: string | null }) {
  const words = useTelemetry((s) => phaseWords(kind, run, s.machineConnected ? s.machine : null));
  const done = words === 'Done';
  return (
    <Typography
      data-testid={TID.drinkPhase}
      variant="body2"
      component="p"
      role="status"
      noWrap
      sx={{ fontWeight: 550, color: done ? 'success.main' : 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
    >
      {words ? <span aria-hidden>·</span> : null}
      {done ? <CheckRounded aria-hidden sx={{ fontSize: 18 }} /> : null}
      {words}
      {done && going !== null ? (
        <Box component="span" sx={visuallyHidden}>
          {`. ${going}`}
        </Box>
      ) : null}
    </Typography>
  );
}

export interface DrinkViewProps {
  kind: DrinkKind;
  /** Where Go back goes, for its name. */
  back: Route;
  /** `{ auto: true }` when the view goes back by itself, which guards the pane it returns to. */
  onGoBack(options?: GoBackOptions): void;
}

export function DrinkView({ kind, back, onGoBack }: DrinkViewProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  // React hears of a run starting and ending only; the dial, the trace and the readouts follow the frames themselves.
  useSyncExternalStore(trace.subscribe, trace.getState);
  const run = trace.runOf(kind);
  const live = run?.live ?? false;
  const view = useRef<HTMLDivElement>(null);
  const layout = useOwnLayout(view, arrangement);
  const drinks = useDrinkPresets();
  const screen = useDrinkScreen(kind);
  const shotSettings = useTelemetry((s) => s.shotSettings);
  const liveTarget = drinkTarget(kind, shotSettings, drinks.presets);
  const liveTimeSet = kind === 'hotWater' ? hotWaterTimeLimit(shotSettings, drinks.presets) : liveTarget;
  // A run's targets as it ran: a setting changed once it is over is for the next run, not this one's dial.
  const [held, setHeld] = useState<{ runId: number; target: number | null; timeSet: number | null } | null>(null);
  useEffect(() => {
    if (run !== null && live) setHeld({ runId: run.id, target: liveTarget, timeSet: liveTimeSet });
  }, [run, live, liveTarget, liveTimeSet]);
  const kept = run !== null && !live && held?.runId === run.id ? held : null;
  const target = kept ? kept.target : liveTarget;
  const timeSet = kept ? kept.timeSet : liveTimeSet;
  const { name, icon } = DRINK[kind];

  const returning = useDrinkReturn(run, screen, () => onGoBack({ auto: true }));
  const { countdown } = returning;
  const head = useRef<HTMLDivElement>(null);
  const roomy = useOwnLayout(head, countdownFits);
  // Short of room, Stay and the counting Go back go under the name, and stay there once the barista keeps the view.
  const ownRow = !roomy && !live && (countdown !== null || returning.kept);
  const actions = useRef<HTMLDivElement>(null);
  const goBackButton = useRef<HTMLButtonElement>(null);
  // Any pointer down or key press in the view keeps it, but on Stay and Go back, which do what they say by their clicks.
  const keepUnlessActions = (event: SyntheticEvent) => {
    if (!(event.target instanceof Node && actions.current?.contains(event.target))) returning.keep();
  };
  const stay = () => {
    // Stay goes with the countdown: the focus moves on to Go back rather than to nothing.
    goBackButton.current?.focus();
    returning.keep();
  };
  const where = goBackWords(back);
  const going = countdown === null ? null : `Going back${where === null ? '' : ` to ${where}`} in ${countdown.seconds} seconds.`;

  return (
    <Box
      ref={view}
      data-testid={TID.drinkView}
      data-drink={kind}
      onPointerDownCapture={countdown === null ? undefined : keepUnlessActions}
      onKeyDownCapture={countdown === null ? undefined : keepUnlessActions}
      sx={viewSx(layout)}
    >
      <Box
        ref={head}
        sx={{
          gridArea: 'head',
          display: 'flex',
          flexWrap: ownRow ? 'wrap' : 'nowrap',
          alignItems: 'center',
          columnGap: 1.25,
          rowGap: 1,
          minHeight: 48,
          minWidth: 0,
        }}
      >
        {live ? <LiveDot size={9} /> : null}
        <Box sx={{ display: 'flex', color: 'text.secondary', flex: 'none' }}>{icon}</Box>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 'none' }}>
          {name}
        </Typography>
        <Phase kind={kind} run={run} going={going} />
        {/* 48 px tall, so the name stays put when the countdown takes a row of its own under it. */}
        <Box sx={{ flex: '1 1 auto', minHeight: 48 }} />
        {live ? null : (
          <Box ref={actions} sx={{ flex: ownRow ? '1 0 100%' : 'none', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
            {countdown === null ? null : (
              <Button data-testid={TID.drinkStay} aria-label="Stay on this screen" onClick={stay} sx={{ flex: 'none', px: 1.75 }}>
                Stay
              </Button>
            )}
            <Button
              ref={goBackButton}
              data-testid={TID.drinkGoBack}
              variant="tonal"
              aria-label={goBackLabel(back)}
              startIcon={<ArrowBackRounded />}
              onClick={() => onGoBack()}
              // A stacking context and edges of its own: the countdown's wash sits under the label, inside the corners.
              sx={{ flex: 'none', px: 2, isolation: 'isolate', overflow: 'hidden' }}
            >
              {countdown === null ? null : (
                <Box
                  key={countdown.until}
                  component="span"
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    zIndex: -1,
                    bgcolor: 'cafai.accentWash',
                    transformOrigin: 'left',
                    animation: `${drain} ${countdown.seconds}s linear forwards`,
                    // A wash that cannot drain says nothing: under reduced motion the seconds count alone.
                    [REDUCED_MOTION]: { display: 'none' },
                  }}
                />
              )}
              Go back
              {countdown === null ? null : (
                <Box
                  component="span"
                  data-testid={TID.drinkGoBackSeconds}
                  // As wide as "10 s" and then some, so the button keeps its width as the seconds fall.
                  sx={{ ml: 1, minWidth: '2.6em', textAlign: 'right', color: 'text.secondary', fontWeight: 550, fontVariantNumeric: 'tabular-nums' }}
                >
                  {countdown.left} s
                </Box>
              )}
            </Button>
          </Box>
        )}
      </Box>
      <Box sx={{ gridArea: 'dial', alignSelf: 'center', justifySelf: 'center' }}>
        <DrinkDial kind={kind} run={run} target={target} size={DIAL_SIZE[layout]} scene={screen.scene} presets={drinks.presets} />
      </Box>
      <Box sx={{ gridArea: 'side', alignSelf: 'center', minWidth: 0, display: 'flex', flexDirection: 'column', gap: layout === 'wide' ? 2 : 1.5 }}>
        <DrinkReadouts kind={kind} run={run} presets={drinks.presets} small={layout !== 'wide'} />
        {layout === 'short' ? null : (
          <DrinkTraceChart
            kind={kind}
            run={run}
            timeSet={timeSet}
            volumeSet={kind === 'hotWater' ? target : null}
            height={layout === 'wide' ? 88 : 56}
          />
        )}
      </Box>
      <Box sx={{ gridArea: 'set', minHeight: 0, ...(layout === 'short' ? { overflowY: 'auto', overscrollBehavior: 'contain' } : null) }}>
        <DrinkSettingsCard kind={kind} drinks={drinks} layout={layout === 'wide' ? 'columns' : 'rows'} />
      </Box>
    </Box>
  );
}

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
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
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
import { goBackLabel } from './drinkFocus.ts';
import { drinkTarget, hotWaterTimeLimit, phaseWords } from './drinkModel.ts';
import { DrinkReadouts } from './DrinkReadouts.tsx';
import { DrinkSettingsCard } from './DrinkSettingsCard.tsx';
import { DrinkTraceChart } from './DrinkTraceChart.tsx';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';
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

/** The phase in words, a polite status: it changes a few times a run, never with every frame. */
function Phase({ kind, run }: { kind: DrinkKind; run: DrinkRun | null }) {
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
    </Typography>
  );
}

export interface DrinkViewProps {
  kind: DrinkKind;
  /** Where Go back goes, for its name. */
  back: Route;
  onGoBack(): void;
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

  return (
    <Box ref={view} data-testid={TID.drinkView} data-drink={kind} sx={viewSx(layout)}>
      <Box sx={{ gridArea: 'head', display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 48, minWidth: 0 }}>
        {live ? <LiveDot size={9} /> : null}
        <Box sx={{ display: 'flex', color: 'text.secondary', flex: 'none' }}>{icon}</Box>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 'none' }}>
          {name}
        </Typography>
        <Phase kind={kind} run={run} />
        <Box sx={{ flex: '1 1 auto' }} />
        {live ? null : (
          <Button
            data-testid={TID.drinkGoBack}
            variant="tonal"
            aria-label={goBackLabel(back)}
            startIcon={<ArrowBackRounded />}
            onClick={onGoBack}
            sx={{ flex: 'none', px: 2 }}
          >
            Go back
          </Button>
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

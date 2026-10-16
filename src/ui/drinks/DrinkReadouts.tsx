/**
 * A drink's readouts (the design's section 4): three, each a label (with its
 * series' swatch where the trace draws it), the value in readout-large and a
 * caption line kept even when empty, so the rows line up and nothing moves
 * when a caption comes or goes. The Shot view's readouts, for a drink.
 *
 * They re-render only when a value or a caption they show changes, not with
 * every frame: the hook below hands React the same list until one does.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useServices, useTemperatureUnit } from '../../app/services.tsx';
import { splitUnit } from '../machine/format.ts';
import { TID } from '../testIds.ts';
import { drinkReadouts, type DrinkPresets, type Readout, type Swatch } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

const SWATCH: Record<Swatch, string> = {
  pressure: 'cafai.graph.pressure',
  flow: 'cafai.graph.flow',
  weight: 'cafai.graph.weight',
};

/** The readouts now: the same array until something on show changes. */
export function useDrinkReadouts(kind: DrinkKind, run: DrinkRun | null, presets: DrinkPresets | null): readonly Readout[] {
  const { telemetry } = useServices();
  const unit = useTemperatureUnit();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const last = useRef<{ key: string; readouts: Readout[] } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stopTelemetry = telemetry.subscribe(onChange);
      const stopData = trace.onData(onChange);
      return () => {
        stopTelemetry();
        stopData();
      };
    },
    [telemetry, trace],
  );
  const read = () => {
    const now = telemetry.getState();
    const readouts = drinkReadouts(kind, {
      frame: now.machineConnected ? now.machine : null,
      scaleWeight: now.scaleConnected ? (now.scale?.weight ?? null) : null,
      scaleConnected: now.scaleConnected,
      shotSettings: now.shotSettings,
      presets,
      run,
      unit,
    });
    const key = readouts.map((r) => `${r.key}=${r.value}|${r.caption}|${r.swatch ?? ''}`).join(';');
    if (last.current?.key !== key) last.current = { key, readouts };
    return last.current.readouts;
  };
  return useSyncExternalStore(subscribe, read);
}

function ReadoutCell({ readout, small }: { readout: Readout; small: boolean }) {
  const { value, unit } = splitUnit(readout.value);
  return (
    <Box data-testid={TID.drinkReadout(readout.key)} sx={{ minWidth: 0 }}>
      <Typography variant="label" component="div" color="text.secondary" noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {readout.swatch ? (
          <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: '2px', flex: 'none', bgcolor: SWATCH[readout.swatch] }} />
        ) : null}
        {readout.label}
      </Typography>
      <Typography variant="readoutLarge" component="div" noWrap sx={small ? { fontSize: '1.5rem' } : undefined}>
        {value}
        {unit ? (
          <Box component="span" sx={{ fontSize: '0.6em', fontWeight: 550, color: 'text.secondary', letterSpacing: 0 }}>
            {' '}
            {unit}
          </Box>
        ) : null}
      </Typography>
      <Typography variant="caption" component="div" color="text.secondary" noWrap sx={{ minHeight: '1.35em', fontVariantNumeric: 'tabular-nums' }}>
        {readout.caption || ' '}
      </Typography>
    </Box>
  );
}

export interface DrinkReadoutsProps {
  kind: DrinkKind;
  run: DrinkRun | null;
  presets: DrinkPresets | null;
  /** A phone's smaller values. */
  small: boolean;
}

export function DrinkReadouts({ kind, run, presets, small }: DrinkReadoutsProps) {
  const readouts = useDrinkReadouts(kind, run, presets);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${readouts.length}, minmax(0, 1fr))`, columnGap: small ? 2 : 2.25, rowGap: 1.5 }}>
      {readouts.map((readout) => (
        <ReadoutCell key={readout.key} readout={readout} small={small} />
      ))}
    </Box>
  );
}

/**
 * The run so far, under the readouts (the design's section 4): Decent's
 * colours, three grid lines, no y labels (the readouts carry the values), the
 * time under it. Drawn straight into its paths on each frame, never through
 * React, as the shot graph is. The plot stretches to its box; its lines keep
 * their width (non-scaling-stroke), and each line's newest point is a dot
 * while the drink runs.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { sparklinePath } from '../chat/sparkline.ts';
import { TID } from '../testIds.ts';
import { traceLines, traceSpan, type Swatch } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

/** The plot's width in its own units; it stretches to the box. */
const WIDTH = 600;
/** Drawn bottom to top: the weight under the flow, the pressure on top. */
const KEYS: readonly Swatch[] = ['weight', 'flow', 'pressure'];
/** A path's last point: where its dot goes. */
const LAST_POINT = /[ML](-?[\d.]+),(-?[\d.]+)$/;

export interface DrinkTraceChartProps {
  kind: DrinkKind;
  run: DrinkRun | null;
  /** The time set (steam, flush) or hot water's time limit. */
  timeSet: number | null;
  /** The hot water volume set, the weight line's top. */
  volumeSet: number | null;
  height: number;
}

export function DrinkTraceChart({ kind, run, timeSet, volumeSet, height }: DrinkTraceChartProps) {
  const { telemetry } = useServices();
  const theme = useTheme();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const paths = useRef<Partial<Record<Swatch, SVGPathElement | null>>>({});
  const dots = useRef<Partial<Record<Swatch, SVGPathElement | null>>>({});
  const span = useRef<HTMLSpanElement>(null);
  const live = run?.live ?? false;
  const colour: Record<Swatch, string> = {
    pressure: theme.palette.cafai.graph.pressure,
    flow: theme.palette.cafai.graph.flow,
    weight: theme.palette.cafai.graph.weight,
  };

  useLayoutEffect(() => {
    const draw = () => {
      const tMax = traceSpan(run, timeSet);
      if (span.current) span.current.textContent = `${Math.round(tMax)} s`;
      const lines = run === null ? [] : traceLines(kind, run, volumeSet);
      for (const key of KEYS) {
        const line = lines.find((l) => l.key === key);
        const d = line && run ? sparklinePath(run.t, line.values, { width: WIDTH, height, tMax, yMax: line.yMax }) : '';
        paths.current[key]?.setAttribute('d', d);
        // The newest point: a zero-length segment whose round cap draws a dot.
        const last = LAST_POINT.exec(d);
        dots.current[key]?.setAttribute('d', live && last ? `M${last[1]},${last[2]}L${last[1]},${last[2]}` : '');
      }
    };
    draw();
    if (!live || run === null) return undefined;
    return trace.onData((changed) => {
      if (changed === run) draw();
    });
  }, [trace, kind, run, timeSet, volumeSet, height, live]);

  const grid = theme.palette.cafai.graph.grid;
  return (
    <Box data-testid={TID.drinkTrace}>
      <Box
        component="svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        aria-hidden
        sx={{ display: 'block', width: '100%', height, overflow: 'visible' }}
      >
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={WIDTH} y1={f * height} y2={f * height} stroke={grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {KEYS.map((key) => (
          <path
            key={key}
            ref={(node) => {
              paths.current[key] = node;
            }}
            data-testid={`trace-${key}`}
            fill="none"
            stroke={colour[key]}
            strokeWidth={key === 'weight' ? 1.5 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {KEYS.map((key) => (
          <path
            key={`${key}-dot`}
            ref={(node) => {
              dots.current[key] = node;
            }}
            fill="none"
            stroke={colour[key]}
            strokeWidth={7}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="label" component="span" color="text.secondary">
          0 s
        </Typography>
        <Typography ref={span} variant="label" component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} />
      </Box>
    </Box>
  );
}

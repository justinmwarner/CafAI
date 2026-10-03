/**
 * The live shot graph: pressure, flow and weight flow on one 0-12 axis (bar
 * and ml/s share a scale, as on the DE1's own chart), the cup weight on the
 * right, and the profile's targets dashed.
 *
 * Samples never touch React state. They go into a plain buffer and reach the
 * canvas through uPlot's setData at most once per animation frame; the timer
 * and the legend readouts are written straight into their DOM nodes. React
 * re-renders this component twice per shot (started, finished), not per frame.
 */
import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { FONT_FAMILY, graphColors } from '../theme.ts';
import { TID } from '../testIds.ts';
import { formatSeconds } from './format.ts';
import { createShotBuffer, type SeriesKey, type ShotValues } from './shotBuffer.ts';

/** The x axis always shows at least this much, so a fresh shot is not stretched across the width. */
const MIN_WINDOW_S = 30;
const MIN_WEIGHT_G = 50;
const TARGET_DASH = [6, 5];
/** Axis sizes in px; the empty-state hint is centred in the plotting area between them. */
const AXIS = { left: 30, right: 40, bottom: 26, top: 10 } as const;

interface LegendItem {
  key: SeriesKey;
  label: string;
  unit: string;
  color: string;
}

const LEGEND: readonly LegendItem[] = [
  { key: 'pressure', label: 'Pressure', unit: 'bar', color: graphColors.pressure },
  { key: 'flow', label: 'Flow', unit: 'ml/s', color: graphColors.flow },
  { key: 'weightFlow', label: 'Weight flow', unit: 'g/s', color: graphColors.weightFlow },
  { key: 'weight', label: 'Weight', unit: 'g', color: graphColors.weight },
];

// Blank until there is a shot; "— bar" beside every key reads as a fault.
const legendValue = (item: LegendItem, values: ShotValues | null) => {
  const value = values?.[item.key];
  return value === null || value === undefined ? '' : `${value.toFixed(1)} ${item.unit}`;
};

const finiteMax = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function graphOptions(width: number, height: number): uPlot.Options {
  const font = `12px ${FONT_FAMILY}`;
  const line = (stroke: string, scale: string, width: number, dash?: number[]): uPlot.Series => ({
    scale,
    stroke,
    width,
    dash,
    points: { show: false },
  });
  return {
    width,
    height,
    // Touch-first: no hover cursor, no drag-to-zoom.
    cursor: { show: false, drag: { x: false, y: false } },
    legend: { show: false },
    padding: [AXIS.top, 4, 0, 0],
    scales: {
      x: { time: false, range: (_plot, _min, max) => [0, Math.max(MIN_WINDOW_S, Math.ceil(finiteMax(max)))] },
      y: { auto: false, range: [0, 12] },
      w: {
        range: (_plot, _min, max) => [0, Math.max(MIN_WEIGHT_G, Math.ceil((finiteMax(max) * 1.15) / 10) * 10)],
      },
    },
    axes: [
      {
        scale: 'x',
        stroke: graphColors.axis,
        font,
        size: AXIS.bottom,
        space: 44,
        grid: { stroke: graphColors.grid, width: 1 },
        ticks: { show: false },
        values: (_plot, splits) => splits.map((v) => `${v}s`),
      },
      {
        scale: 'y',
        stroke: graphColors.axis,
        font,
        size: AXIS.left,
        grid: { stroke: graphColors.grid, width: 1 },
        ticks: { show: false },
        // Crema's 3-bar grid, thinned when the panel is short (an alert is showing).
        splits: (plot) => (plot.height - AXIS.top - AXIS.bottom < 72 ? [0, 6, 12] : [0, 3, 6, 9, 12]),
      },
      {
        scale: 'w',
        side: 1,
        stroke: graphColors.weight,
        font,
        size: AXIS.right,
        space: 40,
        grid: { show: false },
        ticks: { show: false },
        values: (_plot, splits) => splits.map((v) => `${v}g`),
      },
    ],
    // Same order as SERIES_KEYS: targets underneath, pressure on top.
    series: [
      {},
      line(graphColors.pressure, 'y', 1.5, TARGET_DASH),
      line(graphColors.flow, 'y', 1.5, TARGET_DASH),
      line(graphColors.weight, 'w', 1.5),
      line(graphColors.weightFlow, 'y', 2),
      line(graphColors.flow, 'y', 2.5),
      line(graphColors.pressure, 'y', 2.5),
    ],
  };
}

function measure(host: HTMLElement) {
  return { width: Math.max(160, Math.floor(host.clientWidth)), height: Math.max(80, Math.floor(host.clientHeight)) };
}

// A backgrounded WebView pauses animation frames; the buffer simply catches up on return.
const nextFrame: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => window.setTimeout(cb, 16);
const cancelFrame: (handle: number) => void =
  typeof cancelAnimationFrame === 'function' ? (h) => cancelAnimationFrame(h) : (h) => window.clearTimeout(h);

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

type Phase = 'empty' | 'live' | 'done';

export interface LiveShotGraphProps {
  /** Smallest height of the plot area itself, in px. */
  minPlotHeight?: number;
}

export function LiveShotGraph({ minPlotHeight = 90 }: LiveShotGraphProps) {
  const { telemetry } = useServices();
  const plotHost = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const readouts = useRef<Partial<Record<SeriesKey, HTMLSpanElement | null>>>({});
  const [phase, setPhase] = useState<Phase>('empty');

  useEffect(() => {
    const host = plotHost.current;
    if (!host) return;
    const buffer = createShotBuffer();
    const size = measure(host);
    const plot = new uPlot(graphOptions(size.width, size.height), buffer.data, host);
    let frame: number | null = null;
    let showingShot = false;

    const paint = () => {
      frame = null;
      plot.setData(buffer.data);
      if (timer.current) timer.current.textContent = formatSeconds(buffer.elapsedS());
      const latest = buffer.latest();
      for (const item of LEGEND) {
        const node = readouts.current[item.key];
        if (node) node.textContent = legendValue(item, latest);
      }
    };
    const schedule = () => {
      if (frame === null) frame = nextFrame(paint);
    };

    const stopSamples = telemetry.onSample((sample) => {
      if (!buffer.push(sample)) return;
      // Mounted mid-shot: the first plotted frame is the start we missed.
      if (!showingShot) {
        showingShot = true;
        setPhase('live');
      }
      schedule();
    });
    const stopShots = telemetry.onShot((event) => {
      if (event.type === 'started') {
        buffer.reset();
        if (frame !== null) cancelFrame(frame);
        // Paint at once so uPlot never redraws from emptied arrays with stale indexes.
        paint();
        showingShot = true;
        setPhase('live');
      } else {
        // Keep the finished shot on screen until the next one starts.
        setPhase(buffer.length > 0 ? 'done' : 'empty');
      }
    });

    let last = size;
    const resize = () => {
      const next = measure(host);
      if (next.width === last.width && next.height === last.height) return;
      last = next;
      plot.setSize(next);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(host);
    else window.addEventListener('resize', resize);

    return () => {
      stopSamples();
      stopShots();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      if (frame !== null) cancelFrame(frame);
      plot.destroy();
    };
  }, [telemetry]);

  const caption = phase === 'live' ? 'Live shot' : phase === 'done' ? 'Last shot' : 'Shot graph';
  return (
    <Box
      component="section"
      aria-label="Shot graph"
      data-testid={TID.liveGraph}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: minPlotHeight + 64,
        borderTop: 1,
        borderColor: 'divider',
        pt: 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {phase === 'live' && (
            <Box
              component="span"
              aria-hidden
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', animation: `${pulse} 1.6s ease-in-out infinite` }}
            />
          )}
          <Typography variant="subtitle1" component="h2" noWrap>
            {caption}
          </Typography>
        </Box>
        <Typography
          ref={timer}
          data-testid={TID.shotTimer}
          component="span"
          aria-label="Shot time"
          sx={{ fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}
        >
          {formatSeconds(0)}
        </Typography>
      </Box>

      <Box
        ref={plotHost}
        role="img"
        aria-label="Pressure, flow and weight over the shot"
        sx={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: minPlotHeight,
          overflow: 'hidden',
          mt: 0.5,
          '& .uplot': { position: 'absolute', top: 0, left: 0, fontFamily: FONT_FAMILY },
        }}
      >
        {phase === 'empty' && (
          <Box
            sx={{
              position: 'absolute',
              top: AXIS.top,
              right: AXIS.right,
              bottom: AXIS.bottom,
              left: AXIS.left,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ bgcolor: 'background.default', px: 1, borderRadius: 1 }}>
              Pull a shot to see it here.
            </Typography>
          </Box>
        )}
      </Box>

      <Box
        component="ul"
        aria-label="Graph legend"
        sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}
      >
        {LEGEND.map((item) => (
          <Box component="li" key={item.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: 1, bgcolor: item.color }} />
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography
              variant="caption"
              ref={(node: HTMLSpanElement | null) => {
                readouts.current[item.key] = node;
              }}
              sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}
            >
              {legendValue(item, null)}
            </Typography>
          </Box>
        ))}
        <Box component="li" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Box component="span" aria-hidden sx={{ width: 16, borderTop: '2px dashed', borderColor: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">
            target
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

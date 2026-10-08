/**
 * The phone's way back to the shot from the Coach tab: while a shot runs, or
 * its outcome is still on its way to the chat, a strip at the top of the tab
 * with the time, the weight and the pressure, a small chart of pressure and
 * flow, and a chevron. The whole strip is one button to the Machine tab, and
 * it goes once the outcome is in the chat.
 *
 * Like the graphs, it keeps no samples and re-renders for none: the numbers
 * and the two lines are written into their nodes from the app's shot
 * recording (shotTrace.ts) whenever it changes.
 */
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { keyframes, useTheme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { sparklinePath } from '../chat/sparkline.ts';
import { formatSeconds } from '../machine/format.ts';
import { SERIES_KEYS, type ShotBuffer } from '../machine/shotBuffer.ts';
import { shotTraceFor } from '../machine/shotTrace.ts';
import { TID } from '../testIds.ts';
import { LiveDot } from './ShotTime.tsx';

const CHART_WIDTH = 104;
const CHART_HEIGHT = 38;
/** Inside the chart, so a 2 px line at the edge is not cut in half. */
const CHART_INSET = 1;
/** As on the big graph: at least 30 s across, so a fresh shot is not stretched, and pressure and flow on one 0-12 scale. */
const MIN_WINDOW_S = 30;
const Y_MAX = 12;
const PRESSURE_COLUMN = SERIES_KEYS.indexOf('pressure') + 1;
const FLOW_COLUMN = SERIES_KEYS.indexOf('flow') + 1;

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const enter = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
`;

// One decimal and the unit, as the graph's legend writes them.
const reading = (value: number | null | undefined, unit: string): string | null =>
  value === null || value === undefined ? null : `${value.toFixed(1)} ${unit}`;

/** " · 11.5 g · 5.0 bar" after the time; a reading the shot does not have (no scale) is left out. */
function readings(buffer: ShotBuffer): string {
  const latest = buffer.latest();
  return [reading(latest?.weight, 'g'), reading(latest?.pressure, 'bar')]
    .filter((text): text is string => text !== null)
    .map((text) => ` · ${text}`)
    .join('');
}

function chartLine(buffer: ShotBuffer, column: number): string {
  const xs = buffer.data[0];
  return sparklinePath(xs, buffer.data[column] ?? [], {
    width: CHART_WIDTH - 2 * CHART_INSET,
    height: CHART_HEIGHT - 2 * CHART_INSET,
    tMax: Math.max(MIN_WINDOW_S, xs[xs.length - 1] ?? 0),
    yMax: Y_MAX,
  });
}

export interface LiveStripProps {
  /** From the shell's focus hook: the pour is over and the chat has not had the shot's outcome yet. */
  awaitingOutcome: boolean;
  /** Opens the Machine tab: a normal navigation, the barista's choice. */
  onOpen: () => void;
}

export function LiveStrip({ awaitingOutcome, onOpen }: LiveStripProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const live = useSyncExternalStore(trace.subscribe, () => trace.getState().phase === 'live');
  const shown = live || awaitingOutcome;
  const colors = useTheme().palette.cafai.graph;
  const time = useRef<HTMLSpanElement>(null);
  const rest = useRef<HTMLSpanElement>(null);
  const pressure = useRef<SVGPathElement>(null);
  const flow = useRef<SVGPathElement>(null);

  // Before paint, so the strip never shows without its numbers.
  useLayoutEffect(() => {
    if (!shown) return;
    const { buffer } = trace;
    const paint = () => {
      if (time.current) time.current.textContent = formatSeconds(buffer.elapsedS());
      if (rest.current) rest.current.textContent = readings(buffer);
      pressure.current?.setAttribute('d', chartLine(buffer, PRESSURE_COLUMN));
      flow.current?.setAttribute('d', chartLine(buffer, FLOW_COLUMN));
    };
    paint();
    return trace.onData(paint);
  }, [trace, shown]);

  if (!shown) return null;
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label="Open the live shot"
      data-testid={TID.liveStrip}
      sx={{
        flex: 'none',
        height: 64,
        m: '10px 12px 0',
        pl: 1.75,
        pr: 1.25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1.25,
        // A string: a bare number here would be a multiple of the theme's radius.
        borderRadius: '16px',
        bgcolor: 'cafai.accentSoft',
        color: 'text.primary',
        fontFamily: 'inherit',
        textAlign: 'left',
        animation: `${enter} 200ms ease-out`,
        [REDUCED_MOTION]: { animation: 'none' },
      }}
    >
      <Box component="span" sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '7px', typography: 'subtitle2', fontWeight: 700 }}>
          {live && <LiveDot size={9} />}
          {/* Once the pour is over the shot is the last one, as the graph's own caption says. */}
          {live ? 'Live shot' : 'Last shot'}
        </Box>
        <Box
          component="span"
          sx={{
            mt: '2px',
            typography: 'body2',
            fontSize: '0.84375rem',
            fontWeight: 550,
            lineHeight: 1.35,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <Box component="span" ref={time} sx={{ color: 'text.primary', fontWeight: 650 }} />
          <span ref={rest} />
        </Box>
      </Box>
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block', flex: 'none' }}
      >
        <g
          transform={`translate(${CHART_INSET} ${CHART_INSET})`}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {/* Pressure drawn last, on top, as on the big graph. */}
          <path ref={flow} stroke={colors.flow} />
          <path ref={pressure} stroke={colors.pressure} />
        </g>
      </svg>
      <ChevronRightRounded aria-hidden sx={{ flex: 'none', color: 'text.secondary' }} />
    </ButtonBase>
  );
}

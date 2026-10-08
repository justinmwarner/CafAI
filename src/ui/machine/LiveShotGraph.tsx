/**
 * The live shot graph: pressure, flow and weight flow on one 0-12 axis (bar
 * and ml/s share a scale, as on the DE1's own chart), the cup weight on the
 * right, and the profile's targets dashed.
 *
 * The graph keeps no samples of its own: it draws from the app-wide recording
 * of the shot (shotTrace.ts), so a graph opened mid-shot, or rebuilt for a new
 * theme, has the shot from its first frame. Samples never touch React state.
 * They reach the canvas through uPlot's setData at most once per animation
 * frame; the timer and the legend readouts are written straight into their
 * DOM nodes. React re-renders this component a few times per shot (started,
 * finished, its card), not per frame.
 *
 * The timer counts the pour only. After the pour Decaid stays in its stopping
 * state for 4-5 s (the cup weight settles, the shot is stored) before it says
 * finished: the graph plots on through it, the timer stops where the pour did,
 * on the last frame Decaid records (shotBuffer.ts).
 *
 * Once the chat has the shot's card, the timer and the weight show the card's
 * numbers: the pour time and Decaid's yield, the cup weight Decaid settles on
 * after the drips (`actualYield`). The weight read live can differ from it a
 * little, and the panel must not say one number while the card says another.
 *
 * Two looks around the same plot, refs and paint loop. 'panel' is the machine
 * column's graph: caption, timer and a small legend; with `onOpen` the whole
 * card is the tablet's button to the Shot view. 'full' is the Shot view (and
 * the phone's Machine tab): the running step, the timer in display size and
 * four big readouts in place of the legend.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { keyframes, useTheme } from '@mui/material/styles';
import { useCoach, useServices, useTelemetry } from '../../app/services.tsx';
import type { CoachUiMessage } from '../../app/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import type { GraphPalette } from '../palette.ts';
import { TID } from '../testIds.ts';
import { formatSeconds } from './format.ts';
import { useSharedLoadedProfile } from './LoadedProfileContext.tsx';
import { stepProgress } from './loadedProfileModel.ts';
import type { SeriesKey, ShotValues } from './shotBuffer.ts';
import { shotTraceFor } from './shotTrace.ts';

/** The x axis always shows at least this much, so a fresh shot is not stretched across the width. */
const MIN_WINDOW_S = 30;
const MIN_WEIGHT_G = 50;
const TARGET_DASH = [6, 5];
/** Axis sizes in px; the empty-state hint is centred in the plotting area between them. */
const AXIS = { left: 30, right: 40, bottom: 26, top: 10 } as const;

type LegendKey = 'pressure' | 'flow' | 'weightFlow' | 'weight';

interface LegendItem {
  key: LegendKey;
  label: string;
  unit: string;
}

const PRESSURE: LegendItem = { key: 'pressure', label: 'Pressure', unit: 'bar' };
const FLOW: LegendItem = { key: 'flow', label: 'Flow', unit: 'ml/s' };
const WEIGHT_FLOW: LegendItem = { key: 'weightFlow', label: 'Weight flow', unit: 'g/s' };
const WEIGHT: LegendItem = { key: 'weight', label: 'Weight', unit: 'g' };

const LEGEND: readonly LegendItem[] = [PRESSURE, FLOW, WEIGHT_FLOW, WEIGHT];
/** The Shot view's four readouts, in its own order; paint() fills them by key, as it does the legend. */
const READOUTS: readonly LegendItem[] = [PRESSURE, FLOW, WEIGHT, WEIGHT_FLOW];

// Blank until there is a shot; "— bar" beside every key reads as a fault.
const reading = (value: number | null | undefined, unit: string) =>
  value === null || value === undefined ? '' : `${value.toFixed(1)} ${unit}`;

const legendValue = (item: LegendItem, values: ShotValues | null) => reading(values?.[item.key], item.unit);

/** The numbers on a shot's card in the chat. */
interface CardNumbers {
  durationS: number;
  yieldG: number | null;
}

/** The summary on the chat's card for a shot, newest first; null while there is none. */
function cardSummary(messages: readonly CoachUiMessage[], shotId: string | null): ShotSummary | null {
  if (shotId === null) return null;
  for (let m = messages.length - 1; m >= 0; m -= 1) {
    for (const part of messages[m]!.parts) {
      if (part.kind === 'shot' && part.shotId === shotId) return part.summary;
    }
  }
  return null;
}

/** The card's time and yield for a finished shot, once the chat has its card. */
function useCardNumbers(shotId: string | null): CardNumbers | null {
  const durationS = useCoach((s) => cardSummary(s.messages, shotId)?.durationS ?? null);
  const yieldG = useCoach((s) => cardSummary(s.messages, shotId)?.yieldG ?? null);
  return useMemo(() => (durationS === null ? null : { durationS, yieldG }), [durationS, yieldG]);
}

const finiteMax = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function graphOptions(width: number, height: number, colors: GraphPalette, fontFamily: string): uPlot.Options {
  const font = `12px ${fontFamily}`;
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
        stroke: colors.axis,
        font,
        size: AXIS.bottom,
        space: 44,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { show: false },
        values: (_plot, splits) => splits.map((v) => `${v}s`),
      },
      {
        scale: 'y',
        stroke: colors.axis,
        font,
        size: AXIS.left,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { show: false },
        // Crema's 3-bar grid, thinned when the panel is short (an alert is showing).
        splits: (plot) => (plot.height - AXIS.top - AXIS.bottom < 72 ? [0, 6, 12] : [0, 3, 6, 9, 12]),
      },
      {
        scale: 'w',
        side: 1,
        stroke: colors.weight,
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
      line(colors.pressure, 'y', 1.5, TARGET_DASH),
      line(colors.flow, 'y', 1.5, TARGET_DASH),
      line(colors.weight, 'w', 1.5),
      line(colors.weightFlow, 'y', 2),
      line(colors.flow, 'y', 2.5),
      line(colors.pressure, 'y', 2.5),
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

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** The live shot's dot: it pulses, and holds still under reduced motion. */
function LiveDot({ size }: { size: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '50%',
        bgcolor: 'cafai.live',
        animation: `${pulse} 1.6s ease-in-out infinite`,
        [REDUCED_MOTION]: { animation: 'none' },
      }}
    />
  );
}

/**
 * "Pour · step 3 of 3" beside the Shot view's caption. Its own component, so
 * the machine frames it watches re-render this line alone, and only when the
 * step changes.
 */
function StepProgress({ stepNames }: { stepNames: readonly string[] }) {
  const text = useTelemetry((s) => stepProgress(stepNames, s.machine?.profileFrame));
  if (text === null) return null;
  return (
    <Typography variant="body2" component="span" color="text.secondary" noWrap sx={{ minWidth: 0, fontWeight: 550 }}>
      {text}
    </Typography>
  );
}

export interface LiveShotGraphProps {
  /** Smallest height of the plot area itself, in px (90 in the panel, 160 in full). */
  minPlotHeight?: number;
  /** 'panel' (the machine column's graph, as today) or 'full' (the Shot view: big timer and readouts). */
  variant?: 'panel' | 'full';
  /** Makes the whole panel a button that opens the Shot view (the tablet's preview chart). Panel only. */
  onOpen?: () => void;
}

export function LiveShotGraph({ minPlotHeight, variant = 'panel', onOpen }: LiveShotGraphProps) {
  const full = variant === 'full';
  // The full graph is the view the preview opens, never a button to itself.
  const button = !full && onOpen !== undefined;
  const plotMinHeight = minPlotHeight ?? (full ? 160 : 90);
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const { phase, finishedShotId } = useSyncExternalStore(trace.subscribe, trace.getState);
  const plotHost = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const readouts = useRef<Partial<Record<SeriesKey, HTMLSpanElement | null>>>({});
  const card = useCardNumbers(finishedShotId);
  const shownCard = useRef<CardNumbers | null>(null);
  const repaint = useRef<(() => void) | null>(null);
  // The Shot view's step and target come from the app's one workflow read;
  // outside the shell (a component test) there is none and they stay blank.
  const shared = useSharedLoadedProfile();
  const stepNames = full ? (shared?.stepNames ?? null) : null;
  const targetYieldG = full ? (shared?.targetYieldG ?? null) : null;
  // uPlot paints a canvas, out of sx's reach, so it takes the theme's graph
  // colours and font as values. Both stay the same objects for as long as the
  // theme does, so on their own they never re-create the plot.
  const muiTheme = useTheme();
  const colors = muiTheme.palette.cafai.graph;
  const fontFamily = muiTheme.typography.fontFamily ?? 'sans-serif';

  useEffect(() => {
    const host = plotHost.current;
    if (!host) return;
    const { buffer } = trace;
    const size = measure(host);
    const plot = new uPlot(graphOptions(size.width, size.height, colors, fontFamily), buffer.data, host);
    let frame: number | null = null;

    const paint = () => {
      frame = null;
      plot.setData(buffer.data);
      const numbers = shownCard.current;
      if (timer.current) timer.current.textContent = formatSeconds(numbers ? numbers.durationS : buffer.elapsedS());
      const latest = buffer.latest();
      for (const item of LEGEND) {
        const node = readouts.current[item.key];
        if (!node) continue;
        node.textContent = numbers && item.key === 'weight' ? reading(numbers.yieldG, item.unit) : legendValue(item, latest);
      }
    };
    const schedule = () => {
      if (frame === null) frame = nextFrame(paint);
    };
    repaint.current = schedule;
    // A plot rebuilt mid-shot (a new theme), or opened after a shot, shows its time and readouts at once.
    if (buffer.length > 0) paint();

    const stopData = trace.onData((change) => {
      if (change === 'reset') {
        if (frame !== null) cancelFrame(frame);
        frame = null;
        // The last shot's card numbers go with it, before this paint.
        shownCard.current = null;
        // Paint at once so uPlot never redraws from emptied arrays with stale indexes.
        paint();
      } else {
        schedule();
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
      stopData();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      if (frame !== null) cancelFrame(frame);
      repaint.current = null;
      plot.destroy();
    };
    // Another look, or the preview card coming or going, puts the plot in
    // another host node: a new plot there, painted from the trace at once.
  }, [trace, colors, fontFamily, full, button]);

  // Once in, the card's numbers stay until the next shot starts, even when the
  // chat moves to another bag and the card leaves the messages.
  useEffect(() => {
    if (card === null || shownCard.current === card) return;
    shownCard.current = card;
    repaint.current?.();
  }, [card]);

  const caption = phase === 'live' ? 'Live shot' : phase === 'done' ? 'Last shot' : 'Shot graph';
  const readoutRef = (key: SeriesKey) => (node: HTMLSpanElement | null) => {
    readouts.current[key] = node;
  };

  const plot = (
    <Box
      ref={plotHost}
      role="img"
      aria-label="Pressure, flow and weight over the shot"
      sx={{
        position: 'relative',
        flex: '1 1 auto',
        minHeight: plotMinHeight,
        overflow: 'hidden',
        mt: full ? 0 : 0.5,
        '& .uplot': { position: 'absolute', top: 0, left: 0, fontFamily },
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
          {/* Masks the grid lines behind it, so it takes the colour of what the plot sits on. */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ bgcolor: button ? 'background.paper' : 'background.default', px: 1, borderRadius: 1 }}
          >
            Pull a shot to see it here.
          </Typography>
        </Box>
      )}
    </Box>
  );

  if (full) {
    // Viewport widths stand in for the container's (the Chromium 91 WebView
    // has no container queries): the Shot view of a tablet held upright and
    // a phone on its side get smaller readouts, an upright phone's Machine tab
    // the phone sizes of the mockup, so four readouts with their units always
    // fit side by side.
    const narrow = muiTheme.breakpoints.down('md');
    const phone = muiTheme.breakpoints.down('sm');
    return (
      <Box
        component="section"
        aria-label="Shot graph"
        data-testid={TID.liveGraph}
        sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', gap: 1.25 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {phase === 'live' && <LiveDot size={9} />}
          <Typography variant="subtitle1" component="h2" noWrap sx={{ flex: 'none', fontWeight: 700 }}>
            {caption}
          </Typography>
          {phase === 'live' && stepNames !== null && <StepProgress stepNames={stepNames} />}
          <Typography
            ref={timer}
            data-testid={TID.shotTimer}
            variant="display"
            component="span"
            aria-label="Shot time"
            sx={{ flex: 'none', ml: 'auto', [phone]: { fontSize: '2.125rem' } }}
          >
            {formatSeconds(0)}
          </Typography>
        </Box>

        <Box
          component="ul"
          aria-label="Shot readouts"
          sx={{
            listStyle: 'none',
            m: 0,
            p: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 1.25,
            [phone]: { columnGap: 0.5 },
          }}
        >
          {READOUTS.map((item) => (
            <Box component="li" key={item.key} sx={{ minWidth: 0 }}>
              <Typography variant="label" component="div" color="text.secondary" noWrap sx={{ [phone]: { fontSize: '0.71875rem' } }}>
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    display: 'inline-block',
                    width: 12,
                    height: 3,
                    borderRadius: 1,
                    bgcolor: colors[item.key],
                    verticalAlign: 'middle',
                    mr: 0.75,
                    [phone]: { width: 10, mr: 0.5 },
                  }}
                />
                {item.label}
              </Typography>
              {/* No overflow clip: at this line height it would cut the descender of the g. */}
              <Typography
                variant="readoutLarge"
                component="div"
                sx={{ whiteSpace: 'nowrap', minHeight: '1.1em', [narrow]: { fontSize: '1.5rem' }, [phone]: { fontSize: '1.125rem' } }}
              >
                <span ref={readoutRef(item.key)}>{legendValue(item, null)}</span>
                {/* Beside the node paint() writes, never in it, so the target survives every frame.
                    Not before a shot: the weight is blank then, and "of 36" alone reads as a fault. */}
                {item.key === 'weight' && targetYieldG !== null && phase !== 'empty' && (
                  <Box
                    component="span"
                    sx={{ fontSize: '0.5em', fontWeight: 550, letterSpacing: 0, color: 'text.secondary', [phone]: { display: 'none' } }}
                  >
                    {` of ${Math.round(targetYieldG)}`}
                  </Box>
                )}
              </Typography>
            </Box>
          ))}
        </Box>

        {plot}
      </Box>
    );
  }

  const panel = (
    <Box
      component="section"
      aria-label="Shot graph"
      data-testid={TID.liveGraph}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: plotMinHeight + 64,
        // The preview card draws its own edge.
        ...(button ? null : { borderTop: 1, borderColor: 'divider', pt: 0.75 }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {phase === 'live' && <LiveDot size={8} />}
          <Typography variant="subtitle1" component="h2" noWrap>
            {caption}
          </Typography>
        </Box>
        <Typography
          ref={timer}
          data-testid={TID.shotTimer}
          variant="readout"
          component="span"
          aria-label="Shot time"
          sx={{ fontSize: '1.25rem', ...(button ? { ml: 'auto' } : null) }}
        >
          {formatSeconds(0)}
        </Typography>
        {button && <ChevronRightRounded aria-hidden sx={{ flex: 'none', color: 'primary.main', fontSize: '1.25rem' }} />}
      </Box>

      {plot}

      <Box
        component="ul"
        aria-label="Graph legend"
        sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}
      >
        {LEGEND.map((item) => (
          <Box component="li" key={item.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: 1, bgcolor: colors[item.key] }} />
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
            <Typography
              variant="caption"
              ref={readoutRef(item.key)}
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

  if (!button) return panel;
  return (
    <ButtonBase
      component="div"
      onClick={onOpen}
      aria-label="Open the shot graph"
      data-testid={TID.previewGraph}
      sx={{
        flex: '1 1 auto',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        textAlign: 'left',
        // A string: a bare number here would be a multiple of the theme's radius.
        borderRadius: '14px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        p: '10px 12px 8px',
      }}
    >
      {panel}
    </ButtonBase>
  );
}

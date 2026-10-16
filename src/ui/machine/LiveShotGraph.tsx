/**
 * The live shot graph: pressure, flow and weight flow on one 0-12 axis (bar
 * and ml/s share a scale, as on the DE1's own chart), the cup weight on the
 * right, and the profile's targets dashed.
 *
 * The graph keeps no samples of its own: it draws from the app-wide recording
 * of the shot (shotTrace.ts), so a graph opened mid-shot, or rebuilt for a new
 * theme, has the shot from its first frame. Samples never touch React state.
 * They reach the canvas through uPlot's setData at most once per animation
 * frame; the timer and the readouts are written straight into their DOM
 * nodes. React re-renders this component a few times per shot (started,
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
 * little, and the graph must not say one number while the card says another.
 *
 * It is the Shot view's graph, on a tablet and on a phone's Shot tab: the
 * running step, the timer in display size and four big readouts over the
 * plot.
 *
 * Before the first shot there is no time to show: the timer shows a dash.
 *
 * Under the shot, faint, the shot it is compared with (D178 to
 * D182): while it pulls the bag's previous shot, once its card is in the
 * one the card asks about. Its pressure and flow are wide pale bands drawn
 * after the grid and before every series (compare/guide.ts), the time axis
 * runs to the longer of the two, and a line over the plot names it.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes, useTheme } from '@mui/material/styles';
import { useCoach, useServices, useTelemetry } from '../../app/services.tsx';
import type { CoachUiMessage } from '../../app/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import { hasCurve, keyFacts, pourCurve, underThem, type PourCurve } from '../compare/comparison.ts';
import { drawGuide } from '../compare/guide.ts';
import { GuideSwatch } from '../compare/GuideKey.tsx';
import { useComparisonSummary, useShotViewComparison } from '../compare/useComparison.ts';
import type { GraphPalette } from '../palette.ts';
import { TID } from '../testIds.ts';
import { DASH, formatSeconds } from './format.ts';
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

type ReadoutKey = 'pressure' | 'flow' | 'weightFlow' | 'weight';

interface ReadoutItem {
  key: ReadoutKey;
  label: string;
  unit: string;
}

const PRESSURE: ReadoutItem = { key: 'pressure', label: 'Pressure', unit: 'bar' };
const FLOW: ReadoutItem = { key: 'flow', label: 'Flow', unit: 'ml/s' };
const WEIGHT_FLOW: ReadoutItem = { key: 'weightFlow', label: 'Weight flow', unit: 'g/s' };
const WEIGHT: ReadoutItem = { key: 'weight', label: 'Weight', unit: 'g' };

/** The Shot view's four readouts, in its own order; paint() fills them by key. */
const READOUTS: readonly ReadoutItem[] = [PRESSURE, FLOW, WEIGHT, WEIGHT_FLOW];

// Blank until there is a shot; "— bar" beside every key reads as a fault.
const reading = (value: number | null | undefined, unit: string) =>
  value === null || value === undefined ? '' : `${value.toFixed(1)} ${unit}`;

/** The machine's own readouts, as against the scale's. */
const MACHINE_READOUTS: ReadonlySet<ReadoutKey> = new Set(['pressure', 'flow']);

const readoutValue = (item: ReadoutItem, values: ShotValues | null) => {
  const value = values?.[item.key] ?? null;
  // A reading the machine did not send during a shot: the dash, never a 0 (5.8).
  if (value === null && values !== null && MACHINE_READOUTS.has(item.key)) return DASH;
  return reading(value, item.unit);
};

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

/** Canvas pixels per CSS pixel, as uPlot draws them (1 under the test's stand-in). */
const canvasRatio = (): number => {
  const ratio = (uPlot as { pxRatio?: unknown }).pxRatio;
  return typeof ratio === 'number' && ratio > 0 ? ratio : 1;
};

/** `guide`: the shot drawn under this one, read at each draw so a new one needs no new plot. */
function graphOptions(width: number, height: number, colors: GraphPalette, fontFamily: string, guide: () => PourCurve | null): uPlot.Options {
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
      // To the longer of this shot and the one under it (D182): a live
      // shot's axis then holds still as it passes the previous one's time.
      x: {
        time: false,
        range: (_plot, _min, max) => [0, Math.max(MIN_WINDOW_S, Math.ceil(finiteMax(max)), Math.ceil(guide()?.endS ?? 0))],
      },
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
        // Crema's 3-bar grid, thinned when the plot is short (a phone on its side, an alert showing).
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
    // After the grid, before the first series: the shot under lies under everything this shot draws.
    hooks: {
      drawAxes: [
        (plot) => {
          const curve = guide();
          if (curve) drawGuide(plot, curve, colors, canvasRatio());
        },
      ],
    },
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
 * "Pour · step 3 of 3" beside the Shot view's caption (under it on a phone).
 * Its own component, so the machine frames it watches re-render this line
 * alone, and only when the step changes. Without names (none read yet, a step
 * the profile does not name, the pour over) the line stays, empty, so nothing
 * under it moves as the steps change.
 */
function StepProgress({ stepNames }: { stepNames: readonly string[] | null }) {
  const text = useTelemetry((s) => (stepNames === null ? null : stepProgress(stepNames, s.machine?.profileFrame)));
  return (
    <Typography
      variant="body2"
      component="span"
      color="text.secondary"
      noWrap
      title={text ?? undefined}
      sx={{ gridArea: 'step', minWidth: 0, minHeight: '1.35em', lineHeight: 1.35, fontWeight: 550 }}
    >
      {text}
    </Typography>
  );
}

export interface LiveShotGraphProps {
  /** Smallest height of the plot area itself, in px (160 unless given). */
  minPlotHeight?: number;
  /** The Shot view's look: big timer and readouts. The only one since the machine column's small panel went (D90). */
  variant?: 'full';
  /**
   * The view is short (a phone on its side), so the timer and the readouts
   * take the phone's smaller sizes and the plot keeps its room over the
   * coach's note.
   */
  compact?: boolean;
  /**
   * The view is narrow (an upright phone, under 600 px wide): the step takes
   * a line of its own under the caption, and the readouts go two by two, so
   * each keeps a size read from a step back.
   */
  narrow?: boolean;
}

export function LiveShotGraph({ minPlotHeight = 160, compact = false, narrow = false }: LiveShotGraphProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const { phase, finishedShotId } = useSyncExternalStore(trace.subscribe, trace.getState);
  const plotHost = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLSpanElement>(null);
  const readouts = useRef<Partial<Record<SeriesKey, HTMLSpanElement | null>>>({});
  const card = useCardNumbers(finishedShotId);
  const shownCard = useRef<CardNumbers | null>(null);
  const repaint = useRef<(() => void) | null>(null);
  // The shot under this one (D178): which, then its curve, from the chat or once from Decaid.
  const comparison = useShotViewComparison();
  const target = useSyncExternalStore(comparison.subscribe, comparison.getTarget);
  const previous = useComparisonSummary(target);
  const guide = useMemo(() => {
    const curve = previous ? pourCurve(previous) : null;
    return curve && hasCurve(curve) ? curve : null;
  }, [previous]);
  const guideRef = useRef<PourCurve | null>(null);
  // Before the plot's own effect, so a plot made with a guide known draws it from its first paint.
  useEffect(() => {
    guideRef.current = guide;
    repaint.current?.();
  }, [guide]);
  // The Shot view's step and target come from the app's one workflow read;
  // outside the shell (a component test) there is none and they stay blank.
  const shared = useSharedLoadedProfile();
  const stepNames = shared?.stepNames ?? null;
  const targetYieldG = shared?.targetYieldG ?? null;
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
    const plot = new uPlot(graphOptions(size.width, size.height, colors, fontFamily, () => guideRef.current), buffer.data, host);
    let frame: number | null = null;

    const paint = () => {
      frame = null;
      plot.setData(buffer.data);
      const numbers = shownCard.current;
      if (timer.current) timer.current.textContent = formatSeconds(numbers ? numbers.durationS : buffer.elapsedS());
      const latest = buffer.latest();
      for (const item of READOUTS) {
        const node = readouts.current[item.key];
        if (!node) continue;
        node.textContent = numbers && item.key === 'weight' ? reading(numbers.yieldG, item.unit) : readoutValue(item, latest);
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
    // A new palette or font makes a new plot, painted from the trace at once.
  }, [trace, colors, fontFamily]);

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

  // Only with a shot on the plot to compare (the store gives none before any shot).
  const under = guide !== null && target !== null && previous !== null ? { target, previous } : null;
  const plot = (
    <Box
      ref={plotHost}
      role="img"
      aria-label={under ? `Pressure, flow and weight over the shot, ${underThem(under.target)}` : 'Pressure, flow and weight over the shot'}
      sx={{
        position: 'relative',
        flex: '1 1 auto',
        minHeight: minPlotHeight,
        overflow: 'hidden',
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
          <Typography variant="body2" color="text.secondary" sx={{ bgcolor: 'background.default', px: 1, borderRadius: 1 }}>
            Pull a shot to see it here.
          </Typography>
        </Box>
      )}
    </Box>
  );

  // The Shot view says how much room it has (`narrow`, `compact`: it
  // measures its own box, as the Chromium 91 WebView has no container
  // queries). Beyond that the window's width steps the readouts down on a
  // tablet held upright, where the view is as wide as the window.
  const upright = muiTheme.breakpoints.down('md');
  const phoneSizes = narrow || compact;
  return (
    <Box
      component="section"
      aria-label="Shot graph"
      data-testid={TID.liveGraph}
      sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', gap: compact ? 1 : 1.25 }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          gridTemplateAreas: '"caption step timer"',
          alignItems: 'center',
          columnGap: 1.25,
          // An upright phone leaves the step no room beside the caption: it takes the line under it, whole.
          ...(narrow ? { gridTemplateColumns: 'minmax(0, 1fr) auto', gridTemplateAreas: '"caption timer" "step step"', rowGap: '2px' } : null),
        }}
      >
        <Box sx={{ gridArea: 'caption', display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {phase === 'live' && <LiveDot size={9} />}
          <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 700 }}>
            {caption}
          </Typography>
        </Box>
        {phase !== 'empty' && <StepProgress stepNames={phase === 'live' ? stepNames : null} />}
        <Typography
          ref={timer}
          data-testid={TID.shotTimer}
          variant="display"
          component="span"
          aria-label="Shot time"
          sx={{ gridArea: 'timer', justifySelf: 'end', ...(phoneSizes ? { fontSize: '2.125rem' } : null) }}
        >
          {phase === 'empty' ? DASH : formatSeconds(0)}
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
          gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
          columnGap: narrow ? 2 : 1.25,
          rowGap: 1,
        }}
      >
        {READOUTS.map((item) => (
          <Box component="li" key={item.key} sx={{ minWidth: 0 }}>
            <Typography variant="label" component="div" color="text.secondary" noWrap>
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
                }}
              />
              {item.label}
            </Typography>
            {/* No overflow clip: at this line height it would cut the descender of the g. */}
            <Typography
              variant="readoutLarge"
              component="div"
              sx={{
                whiteSpace: 'nowrap',
                minHeight: '1.1em',
                ...(phoneSizes ? { fontSize: '1.5rem' } : { [upright]: { fontSize: '1.5rem' } }),
              }}
            >
              <span ref={readoutRef(item.key)}>{readoutValue(item, null)}</span>
              {/* Beside the node paint() writes, never in it, so the target survives every frame.
                  Not before a shot: the weight is blank then, and "of 36" alone reads as a fault. */}
              {item.key === 'weight' && targetYieldG !== null && phase !== 'empty' && (
                <Box
                  component="span"
                  sx={{ fontSize: '0.5em', fontWeight: 550, letterSpacing: 0, color: 'text.secondary' }}
                >
                  {` of ${Math.round(targetYieldG)}`}
                </Box>
              )}
            </Typography>
          </Box>
        ))}
      </Box>

      {under ? (
        // The key for the band under the curves (D180): its form, the shot's name, its time and yield. One line, cut short rather than wrapped.
        <Typography
          variant="label"
          component="p"
          color="text.secondary"
          data-testid={TID.shotGuideKey}
          sx={{ m: 0, display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
        >
          <GuideSwatch width={16} height={7} />
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {`${under.target.name} · ${keyFacts(under.previous)}`}
          </Box>
        </Typography>
      ) : null}

      {plot}
    </Box>
  );
}

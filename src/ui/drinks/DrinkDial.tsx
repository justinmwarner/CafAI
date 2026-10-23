/**
 * The dial of a drink's view (the design's section 5, D149): a ring that fills
 * toward what stops the drink (the steam time, the hot water volume, the flush
 * time), the number in the middle, and a small scene inside that moves only
 * while the machine runs: milk with steam rising from it, water filling under
 * a falling stream, a shower screen pouring. Ink for steam, which is white;
 * the flow's blue for the water drinks.
 *
 * Frames never re-render it: it draws each one from the drinks' recording
 * (drinkTrace.ts) straight into its nodes (the arc, the tip, the level, the
 * number), as the shot timer writes its time. React hears of a new run, a run
 * ending or a new target only.
 *
 * The scene sits behind the number and fades out across its band, so no line
 * ever crosses the figures. Every loop stops under reduced motion and once the
 * run is over; the arc, the level and the number still move, because they are
 * the readings.
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes, type Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import { useServices } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { dialReading, dialSpoken, type DrinkPresets } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

/** The drawing's box; the dial is drawn once and scaled to its size. */
const BOX = 272;
const C = BOX / 2;
const RING = 112;
/** The inside of the ring, the scene's room: its floor and its depth. */
const INSIDE = 99;
const FLOOR = C + INSIDE;
const DEPTH = INSIDE * 2;
/** Steam's milk fills the bottom of the room, rising from 17% to 32% with the steam's time. */
const MILK_FROM = 0.17;
const MILK_RISE = 0.15;
/** The number's band (as fractions of the box): the scene fades out across it. */
const BAND = { from: 0.34, to: 0.68 };

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const major = i % 5 === 0;
  const inner = major ? 120 : 124;
  return { major, x1: C + Math.cos(angle) * inner, y1: C + Math.sin(angle) * inner, x2: C + Math.cos(angle) * 133, y2: C + Math.sin(angle) * 133 };
});

/** A wave 80 units long on the floor, wide enough to slide one length and still cover the room. */
function wave(amplitude: number): string {
  let d = `M20 ${FLOOR}`;
  for (let x = 20; x < 340; x += 80) d += ` c13 ${-amplitude} 27 ${-amplitude} 40 0 s27 ${amplitude} 40 0`;
  return d;
}
const WATER_TOP = wave(4);
const WATER_BODY = `${WATER_TOP} L340 ${FLOOR + DEPTH + 20} L20 ${FLOOR + DEPTH + 20} Z`;
const MILK_TOP = wave(5);
const MILK_BODY = `${MILK_TOP} L340 ${FLOOR + DEPTH + 20} L20 ${FLOOR + DEPTH + 20} Z`;
/** Three wisps rising from the milk's surface (drawn on the floor, moved with the level). */
const WISPS = [110, 136, 162].map((x, i) => `M${x} ${FLOOR - 4 - (i === 1 ? 4 : 0)}c-7-9 6-16 0-25s7-16 1-25`);
const STREAKS = [106, 121, 136, 151, 166];

const slide = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-80px); }
`;
const fall = keyframes`
  to { stroke-dashoffset: -24; }
`;
const rise = keyframes`
  0% { transform: translateY(6px); opacity: 0; }
  14% { opacity: 0.9; }
  72% { opacity: 0.65; }
  100% { transform: translateY(-122px); opacity: 0; }
`;
const enter = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** The dial's look, from the theme: ink for steam, the flow's blue for water. */
const dialStyles = (theme: Theme, water: boolean): SystemStyleObject<Theme> => {
  const series = water ? theme.palette.cafai.graph.flow : theme.palette.text.primary;
  return {
    position: 'relative',
    flex: 'none',
    // The drawing alone: the done check inside the dial is an svg too.
    '& > svg': { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' },
    '& .tick': { stroke: theme.palette.cafai.graph.grid, strokeWidth: 2, strokeLinecap: 'round' },
    '& .tick.major': { stroke: theme.palette.divider, strokeWidth: 2.5 },
    '& .track': { fill: 'none', stroke: theme.palette.cafai.raised, strokeWidth: 10 },
    '& .arc': { fill: 'none', stroke: series, strokeWidth: 10, strokeLinecap: 'round', transition: 'stroke-dasharray 250ms linear' },
    '& .tip': { transformOrigin: `${C}px ${C}px`, transition: 'transform 250ms linear' },
    '& .tip circle': { fill: series, stroke: theme.palette.background.default, strokeWidth: 3 },
    '& .level': { transition: 'transform 250ms linear' },
    '& .water-body': { fill: theme.palette.cafai.waterWash },
    '& .water-top': { fill: 'none', stroke: theme.palette.cafai.graph.flow, strokeWidth: 2 },
    '& .milk-body': { fill: theme.palette.cafai.milkWash },
    '& .milk-top': { fill: 'none', stroke: theme.palette.text.secondary, strokeWidth: 2, opacity: 0.55 },
    '& .wisp': { fill: 'none', stroke: theme.palette.text.secondary, strokeWidth: 3, strokeLinecap: 'round', opacity: 0 },
    '& .stream': { fill: 'none', stroke: theme.palette.cafai.graph.flow, strokeWidth: 4, strokeLinecap: 'round', strokeDasharray: '12 9' },
    '& .streak': {
      fill: 'none',
      stroke: theme.palette.cafai.graph.flow,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeDasharray: '9 15',
      opacity: 0.7,
    },
    '& .screen': { stroke: theme.palette.text.secondary, strokeWidth: 5, strokeLinecap: 'round' },
    // Once the drink is over (or before it), no water falls.
    '&[data-moving="false"] .stream, &[data-moving="false"] .streak': { display: 'none' },
    // The loops run only while the machine does.
    '&[data-moving="true"] .wave': { animation: `${slide} 4.2s linear infinite` },
    '&[data-moving="true"] .milk-level .wave': { animationDuration: '2.2s' },
    '&[data-moving="true"] .wisp': { animation: `${rise} 3.6s cubic-bezier(0.3, 0.6, 0.5, 1) infinite` },
    '&[data-moving="true"] .wisp-2': { animationDelay: '1.2s' },
    '&[data-moving="true"] .wisp-3': { animationDelay: '2.4s' },
    '&[data-moving="true"] .stream': { animation: `${fall} 0.62s linear infinite` },
    '&[data-moving="true"] .streak': { animation: `${fall} 0.7s linear infinite` },
    '&[data-moving="true"] .streak-2': { animationDuration: '0.82s', animationDelay: '-0.3s' },
    '&[data-moving="true"] .streak-3': { animationDuration: '0.66s', animationDelay: '-0.5s' },
    '& .done-check': { animation: `${enter} 200ms ease-out both` },
    [REDUCED_MOTION]: {
      '& .arc, & .tip, & .level': { transition: 'none' },
      '&[data-moving="true"] .wave, &[data-moving="true"] .wisp, &[data-moving="true"] .stream, &[data-moving="true"] .streak, & .done-check': {
        animation: 'none',
      },
      '& .wisp': { display: 'none' },
    },
  };
};

export interface DrinkDialProps {
  kind: DrinkKind;
  run: DrinkRun | null;
  /** What stops the drink, or null when nobody gave it. */
  target: number | null;
  /** Its size in px: 272 on a tablet, 212 on an upright phone, 184 on a phone on its side. */
  size: number;
  /** The scene it draws inside the ring, one the drink has (scenes/catalog.ts, Settings > Drink screens). */
  scene: string;
  /** The drink's settings in Decaid's workflow, for the flow and temperature its scene follows (D-SCENE-2). */
  presets: DrinkPresets | null;
}

export function DrinkDial({ kind, run, target, size, scene }: DrinkDialProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  // SVG ids are document-wide; React's own ids hold characters url(#…) does not take.
  const id = `dial${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const live = run?.live ?? false;
  // A run the machine's going away cut short is not done: no check for it.
  const done = run !== null && !run.live && !run.lost;
  const water = kind !== 'steam';
  const root = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const tip = useRef<SVGGElement>(null);
  const levels = useRef<SVGGElement[]>([]);
  const value = useRef<HTMLSpanElement>(null);
  const unit = useRef<HTMLSpanElement>(null);
  const of = useRef<HTMLDivElement>(null);
  const levelRef = (index: number) => (node: SVGGElement | null) => {
    if (node) levels.current[index] = node;
  };

  useLayoutEffect(() => {
    const draw = () => {
      const reading = dialReading(kind, run, target);
      // The dial's name in words, rewritten only when it changes (about once a second), never read out by itself.
      const spoken = dialSpoken(kind, run, target);
      if (root.current && root.current.getAttribute('aria-label') !== spoken) root.current.setAttribute('aria-label', spoken);
      if (value.current) value.current.textContent = reading.number;
      // A space before the unit, as every reading has one (DESIGN.md, Numbers), for a screen reader too.
      if (unit.current) unit.current.textContent = reading.unit === null ? '' : ` ${reading.unit}`;
      if (of.current) of.current.textContent = reading.of ?? '';
      const share = reading.share;
      if (arc.current) {
        arc.current.style.display = share === null ? 'none' : '';
        if (share !== null) arc.current.style.strokeDasharray = `${(share * 100).toFixed(2)} 100`;
      }
      if (tip.current) {
        tip.current.style.display = share === null || !live ? 'none' : '';
        if (share !== null) tip.current.style.transform = `rotate(${(share * 360).toFixed(2)}deg)`;
      }
      const level = kind === 'hotWater' ? (share ?? 0) : MILK_FROM + MILK_RISE * (share ?? 0);
      for (const node of levels.current) node.style.transform = `translateY(${(-level * DEPTH).toFixed(1)}px)`;
    };
    draw();
    if (!live || run === null) return undefined;
    return trace.onData((changed) => {
      if (changed === run) draw();
    });
  }, [trace, kind, run, target, live]);

  const fontSize = size >= 260 ? '2.875rem' : size >= 200 ? '2.125rem' : '2rem';
  return (
    <Box
      ref={root}
      role="img"
      data-testid={TID.drinkDial}
      data-moving={live ? 'true' : 'false'}
      data-scene={scene}
      sx={(theme) => ({ width: size, height: size, ...dialStyles(theme, water) })}
    >
      <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden focusable="false">
        <defs>
          <clipPath id={`${id}-inside`}>
            <circle cx={C} cy={C} r={INSIDE} />
          </clipPath>
          <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset={BAND.from - 0.04} stopColor="#fff" />
            <stop offset={BAND.from + 0.02} stopColor="#000" />
            <stop offset={BAND.to - 0.02} stopColor="#000" />
            <stop offset={BAND.to + 0.04} stopColor="#fff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id={`${id}-behind`} maskUnits="userSpaceOnUse" x="0" y="0" width={BOX} height={BOX}>
            <rect width={BOX} height={BOX} fill={`url(#${id}-band)`} />
          </mask>
        </defs>
        {TICKS.map((tick, i) => (
          <line key={i} className={tick.major ? 'tick major' : 'tick'} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
        <circle className="track" cx={C} cy={C} r={RING} />
        <g clipPath={`url(#${id}-inside)`}>
          {/* The fills under the number; every line (a surface, a wisp, a stream) is masked out across its band. */}
          {kind === 'steam' ? (
            <>
              <g className="level milk-level" ref={levelRef(0)}>
                <path className="milk-body wave" d={MILK_BODY} />
              </g>
              <g mask={`url(#${id}-behind)`}>
                <g className="level milk-level" ref={levelRef(1)}>
                  <path className="milk-top wave" d={MILK_TOP} />
                </g>
                <g className="level" ref={levelRef(2)}>
                  {WISPS.map((d, i) => (
                    <path key={d} className={`wisp wisp-${i + 1}`} d={d} />
                  ))}
                </g>
              </g>
            </>
          ) : kind === 'hotWater' ? (
            <>
              <line className="stream" x1={C} y1={30} x2={C} y2={FLOOR} mask={`url(#${id}-behind)`} />
              <g className="level" ref={levelRef(0)}>
                <path className="water-body wave" d={WATER_BODY} />
              </g>
              <g mask={`url(#${id}-behind)`}>
                <g className="level" ref={levelRef(1)}>
                  <path className="water-top wave" d={WATER_TOP} />
                </g>
              </g>
            </>
          ) : (
            <>
              <line className="screen" x1={104} y1={44} x2={168} y2={44} />
              <g mask={`url(#${id}-behind)`}>
                {STREAKS.map((x, i) => (
                  <line key={x} className={`streak streak-${(i % 3) + 1}`} x1={x} y1={54} x2={x + (x - C) / 16} y2={FLOOR} />
                ))}
              </g>
            </>
          )}
        </g>
        <circle ref={arc} className="arc" cx={C} cy={C} r={RING} pathLength={100} transform={`rotate(-90 ${C} ${C})`} />
        <g ref={tip} className="tip">
          <circle cx={C} cy={C - RING} r={8} />
        </g>
      </svg>
      {/* What the dial shows, drawn: its name above says it in words. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        {done ? <CheckCircleRounded className="done-check" aria-hidden sx={{ fontSize: 28, color: 'success.main', mb: 0.75 }} /> : null}
        <Typography component="div" variant="display" sx={{ fontSize, whiteSpace: 'nowrap' }}>
          <span ref={value} data-testid={TID.drinkDialValue} />
          <Box component="span" ref={unit} sx={{ fontSize: '0.5em', fontWeight: 550, color: 'text.secondary', letterSpacing: 0, whiteSpace: 'pre' }} />
        </Typography>
        <Typography
          ref={of}
          data-testid={TID.drinkDialOf}
          variant="label"
          component="div"
          color="text.secondary"
          sx={{ mt: 1, minHeight: '1.3em', fontVariantNumeric: 'tabular-nums' }}
        />
      </Box>
    </Box>
  );
}

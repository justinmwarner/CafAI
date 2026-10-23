/**
 * The dial of a drink's view (the design's section 5, D149; the drink scenes,
 * D-SCENE-1 to D-SCENE-3): a ring that fills toward what stops the drink (the
 * steam time, the hot water volume, the flush time), the number in the
 * middle, and inside the ring the drink's scene, the barista's choice in
 * Settings > Drink screens, drawn on a canvas under the ring
 * (scenes/SceneCanvas.tsx). The ring's arc and its tip take the drink's
 * warmth, cold to warm (D-SCENE-2): the milk warming with the steam time, the
 * hot water's temperature set, the group against its target.
 *
 * Frames never re-render it: it draws each one from the drinks' recording
 * (drinkTrace.ts) straight into its nodes (the arc, the tip, the number), as
 * the shot timer writes its time, and the scene draws itself. React hears of
 * a new run, a run ending or a new target only.
 *
 * Nothing the scene draws crosses the figures: what moves, and every line,
 * fades out behind them, and the done check sits above them without moving
 * them. On the rosetta in dark mode the figures carry a halo of crema, so
 * they read on its white leaves. Under reduced motion the scene is drawn
 * still on every reading; the arc and the number still move, because they
 * are the readings.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes, useTheme, type Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { dialReading, dialSpoken, type DrinkPresets } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';
import { BOX, C, CHECK } from './scenes/canvas.ts';
import { sceneFor } from './scenes/catalog.ts';
import { css, sceneColors, themeColorSource, warmthColor } from './scenes/colors.ts';
import { SceneCanvas } from './scenes/SceneCanvas.tsx';
import { sceneInput, sceneSets } from './scenes/sceneInput.ts';
import type { SceneSets } from './scenes/types.ts';

const RING = 112;
/** The done check at the dial's full size; it scales with the dial, as the figures and the scene do. */
const CHECK_PX = 28;

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const major = i % 5 === 0;
  const inner = major ? 120 : 124;
  return { major, x1: C + Math.cos(angle) * inner, y1: C + Math.sin(angle) * inner, x2: C + Math.cos(angle) * 133, y2: C + Math.sin(angle) * 133 };
});

const enter = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** The dial's look, from the theme. The arc's and the tip's colour is the drink's warmth, set with them each frame. */
const dialStyles = (theme: Theme): SystemStyleObject<Theme> => ({
  position: 'relative',
  flex: 'none',
  // The drawing alone: the done check inside the dial is an svg too.
  '& > svg': { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' },
  '& .tick': { stroke: theme.palette.cafai.graph.grid, strokeWidth: 2, strokeLinecap: 'round' },
  '& .tick.major': { stroke: theme.palette.divider, strokeWidth: 2.5 },
  '& .track': { fill: 'none', stroke: theme.palette.cafai.raised, strokeWidth: 10 },
  '& .arc': { fill: 'none', strokeWidth: 10, strokeLinecap: 'round', transition: 'stroke-dasharray 250ms linear' },
  '& .tip': { transformOrigin: `${C}px ${C}px`, transition: 'transform 250ms linear' },
  '& .tip circle': { stroke: theme.palette.background.default, strokeWidth: 3 },
  '& .done-check': { animation: `${enter} 200ms ease-out both` },
  [REDUCED_MOTION]: {
    '& .arc, & .tip': { transition: 'none' },
    '& .done-check': { animation: 'none' },
  },
});

/** A halo of `color` round each figure: five soft shadows, the widest 12 px. */
const halo = (color: string) => [1, 2, 3, 6, 12].map((blur) => `0 0 ${blur}px ${color}`).join(', ');

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

export function DrinkDial({ kind, run, target, size, scene, presets }: DrinkDialProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const theme = useTheme();
  const colors = sceneColors(themeColorSource(theme));
  const shotSettings = useTelemetry((s) => s.shotSettings);
  // What the drink was set to: the run's first frame gives the flush its target, which holds through the run.
  const liveSets = useMemo(() => sceneSets(kind, shotSettings, presets, run?.latest ?? null), [kind, shotSettings, presets, run]);
  const live = run?.live ?? false;
  // A run's sets as it ran, as the view holds its target: a temperature set once it is over is for the next run, not this one's colour.
  const [held, setHeld] = useState<{ runId: number; sets: SceneSets } | null>(null);
  useEffect(() => {
    if (run !== null && live) setHeld({ runId: run.id, sets: liveSets });
  }, [run, live, liveSets]);
  const sets = run !== null && !live && held?.runId === run.id ? held.sets : liveSets;
  // A run the machine's going away cut short is not done: no check for it.
  const done = run !== null && !run.live && !run.lost;
  const root = useRef<HTMLDivElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const tip = useRef<SVGGElement>(null);
  const tipDot = useRef<SVGCircleElement>(null);
  const value = useRef<HTMLSpanElement>(null);
  const unit = useRef<HTMLSpanElement>(null);
  const of = useRef<HTMLDivElement>(null);

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
      const color = css(warmthColor(colors, sceneInput(kind, run, target, sets).warmth));
      if (arc.current) {
        arc.current.style.display = share === null ? 'none' : '';
        arc.current.style.stroke = color;
        if (share !== null) arc.current.style.strokeDasharray = `${(share * 100).toFixed(2)} 100`;
      }
      if (tipDot.current) tipDot.current.style.fill = color;
      if (tip.current) {
        tip.current.style.display = share === null || !live ? 'none' : '';
        if (share !== null) tip.current.style.transform = `rotate(${(share * 360).toFixed(2)}deg)`;
      }
    };
    draw();
    if (!live || run === null) return undefined;
    return trace.onData((changed) => {
      if (changed === run) draw();
    });
  }, [trace, kind, run, target, live, sets, colors]);

  const fontSize = size >= 260 ? '2.875rem' : size >= 200 ? '2.125rem' : '2rem';
  const checkPx = Math.round((CHECK_PX * size) / BOX);
  const haloed = kind === 'steam' && sceneFor(kind, scene) === 'rosetta' && theme.palette.mode === 'dark';
  return (
    <Box
      ref={root}
      role="img"
      data-testid={TID.drinkDial}
      data-moving={live ? 'true' : 'false'}
      data-scene={scene}
      sx={{ width: size, height: size, ...dialStyles(theme) }}
    >
      <SceneCanvas kind={kind} scene={scene} run={run} target={target} sets={sets} size={size} />
      <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden focusable="false">
        {TICKS.map((tick, i) => (
          <line key={i} className={tick.major ? 'tick major' : 'tick'} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
        <circle className="track" cx={C} cy={C} r={RING} />
        <circle ref={arc} className="arc" cx={C} cy={C} r={RING} pathLength={100} transform={`rotate(-90 ${C} ${C})`} />
        <g ref={tip} className="tip">
          <circle ref={tipDot} cx={C} cy={C - RING} r={8} />
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
          textShadow: haloed ? halo(theme.palette.cafai.scene.crema) : undefined,
        }}
      >
        {/* Centred where the scene cuts out its circle, so the figures do not move when it shows. */}
        {done ? (
          <CheckCircleRounded
            className="done-check"
            aria-hidden
            sx={{
              position: 'absolute',
              top: `calc(${((CHECK.y / BOX) * 100).toFixed(2)}% - ${checkPx / 2}px)`,
              left: `calc(50% - ${checkPx / 2}px)`,
              fontSize: checkPx,
              color: 'success.main',
            }}
          />
        ) : null}
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

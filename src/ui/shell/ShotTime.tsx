/**
 * The live shot in the navigation: the pulsing dot and the running pour time
 * ("Shot 42.0 s" in the tablet's top bar, "42 s" in the phone's Machine tab).
 *
 * The time is written straight into its node whenever the app's shot
 * recording changes (shotTrace.ts), so a frame re-renders nothing; React
 * hears only of the shot starting and ending.
 */
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import { keyframes } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { formatSeconds } from '../machine/format.ts';
import { shotTraceFor } from '../machine/shotTrace.ts';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** The live shot's dot: it pulses, and holds still under reduced motion. */
export function LiveDot({ size }: { size: number }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-block',
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

/** True while a shot runs (the recording's phase is live); re-renders only when that changes. */
export function useShotLive(): boolean {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  return useSyncExternalStore(trace.subscribe, () => trace.getState().phase === 'live');
}

function pourTime(seconds: number | null, short: boolean): string {
  if (!short) return formatSeconds(seconds);
  const shown = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return `${Math.round(shown)} s`;
}

export interface ShotTimeProps {
  /** Whole seconds ("42 s"), for the phone's tab; otherwise tenths ("42.0 s"). */
  short?: boolean;
}

/** The running pour time, or nothing while no shot is live. */
export function ShotTime({ short = false }: ShotTimeProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const live = useSyncExternalStore(trace.subscribe, () => trace.getState().phase === 'live');
  const node = useRef<HTMLSpanElement>(null);

  // Before paint, so a label that appears mid-shot never shows a blank first.
  useLayoutEffect(() => {
    const element = node.current;
    if (!live || !element) return;
    const write = () => {
      const text = pourTime(trace.buffer.elapsedS(), short);
      if (element.textContent !== text) element.textContent = text;
    };
    write();
    return trace.onData(write);
  }, [trace, live, short]);

  if (!live) return null;
  return (
    <Box
      component="span"
      ref={node}
      // Room for "00.0 s" from the start, so the label does not grow as the seconds tick past ten.
      sx={{ display: 'inline-block', minWidth: short ? undefined : '3.3em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    />
  );
}

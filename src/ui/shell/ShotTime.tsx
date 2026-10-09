/**
 * The live shot in the navigation: the pulsing dot and the running pour time,
 * in tenths as the live strip has it ("Shot 42.0 s" in the tablet's top bar,
 * "42.0 s" in the phone's Shot tab).
 *
 * The time is written straight into its node whenever the app's shot
 * recording changes (shotTrace.ts), so a frame re-renders nothing; React
 * hears only of the shot starting and ending. The Shot tab's name, with the
 * whole seconds, is written the same way.
 */
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';
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

/** The whole seconds of the time on screen: 4.96 s shows as "5.0 s", so 5. */
function wholeSeconds(seconds: number | null): number {
  const shown = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.floor(Math.round(shown * 10) / 10);
}

/** The running pour time ("42.0 s"), or nothing while no shot is live. */
export function ShotTime() {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
  const live = useSyncExternalStore(trace.subscribe, () => trace.getState().phase === 'live');
  const node = useRef<HTMLSpanElement>(null);

  // Before paint, so a label that appears mid-shot never shows a blank first.
  useLayoutEffect(() => {
    const element = node.current;
    if (!live || !element) return;
    const write = () => {
      const text = formatSeconds(trace.buffer.elapsedS());
      if (element.textContent !== text) element.textContent = text;
    };
    write();
    return trace.onData(write);
  }, [trace, live]);

  if (!live) return null;
  return (
    <Box
      component="span"
      ref={node}
      // Room for "00.0 s" from the start, so the label does not grow as the seconds tick past ten.
      sx={{ display: 'inline-block', minWidth: '3.3em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    />
  );
}

/**
 * While `live`, names `node` with the running pour time in whole seconds, in
 * `name`'s words (the Shot tab's "Shot, running, 42 seconds").
 * Written straight into the node like the time, and only as a second passes,
 * so a screen reader is not handed a new name ten times a second.
 */
export function useShotTimeName(node: RefObject<HTMLElement | null>, live: boolean, name: (seconds: number) => string): void {
  const { telemetry } = useServices();
  const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);

  useLayoutEffect(() => {
    const element = node.current;
    if (!live || !element) return;
    const write = () => {
      const text = name(wholeSeconds(trace.buffer.elapsedS()));
      if (element.getAttribute('aria-label') !== text) element.setAttribute('aria-label', text);
    };
    write();
    const stop = trace.onData(write);
    return () => {
      stop();
      element.removeAttribute('aria-label');
    };
  }, [trace, node, live, name]);
}

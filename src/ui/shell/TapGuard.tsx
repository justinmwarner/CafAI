/**
 * A moment of deafness after the app switched screens by itself: until
 * `until` (useShotFocus sets it 350 ms ahead) a transparent sheet over the
 * pane that switched takes every tap and does nothing with it, so a tap meant
 * for the screen that was there cannot land on the one that just appeared
 * (a taste chip, a star, Steam).
 *
 * It covers that pane and nothing else: on a tablet the machine column, Stop
 * included, never stops taking taps. The window still hears the tap first
 * (capture), so it still counts as someone at the machine (the heartbeat).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';

/** A tap's press and the click it makes; a press is also what moves focus or starts a text selection. */
const SWALLOWED = ['pointerdown', 'touchstart', 'click'] as const;

function swallow(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export function TapGuard({ until }: { until: number | null }) {
  // The guard that ran out; a new `until` is a new guard.
  const [expired, setExpired] = useState<number | null>(null);
  const node = useRef<HTMLDivElement>(null);
  const active = until !== null && until !== expired && Date.now() < until;

  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => setExpired(until), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);

  // Native listeners, not React's: touchstart has to be a non-passive listener for
  // preventDefault to stop the click and the focus change, and stopping the event
  // here keeps it from every listener above, React's included.
  useLayoutEffect(() => {
    const element = node.current;
    if (!active || !element) return;
    for (const type of SWALLOWED) element.addEventListener(type, swallow, { capture: true, passive: false });
    return () => {
      for (const type of SWALLOWED) element.removeEventListener(type, swallow, { capture: true });
    };
  }, [active]);

  if (!active) return null;
  return (
    <Box
      ref={node}
      data-testid={TID.tapGuard}
      aria-hidden
      sx={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, bgcolor: 'transparent' }}
    />
  );
}

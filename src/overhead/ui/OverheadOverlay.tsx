/**
 * Overhead over CafAI (the brief, section 3; docs/overhead/README.md).
 *
 * Up: Overhead on (its plugin answers and its setting is on), inside
 * Decaid's WebView, the machine idle, asleep or not connected (never busy:
 * policy.ts), and no touch for its minutes (3 unless set). While it is on,
 * the classic screensaver stands down (SaverOverlay, DECISIONS O17).
 *
 * While it shows it asks the plugin every few seconds, which keeps the
 * plugin polling for it; holds the screen on through Decaid's display socket
 * (services.saverScreen, D224), dimmed only in the night hours set (the
 * brief's night mode), and gives the brightness back as it goes. With the
 * machine asleep it turns black after SAVER_SHOW_MS and lets the screen go,
 * as the classic screensaver does: the plugin then stops asking anyone.
 *
 * Down: any tap or key, swallowed so it never reaches what is underneath
 * (the classic screensaver's sheet and guard, without waking the machine);
 * or by itself when the machine turns busy or Overhead is turned off.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import { useAppearance, useServices, useTelemetry } from '../../app/services.tsx';
import { paletteFor } from '../../ui/appearance.ts';
import { usePrefersReducedMotion } from '../../ui/platform/usePrefersReducedMotion.ts';
import { confirmedAsleep, SAVER_SHOW_MS } from '../../ui/saver/policy.ts';
import { TID } from '../../ui/testIds.ts';
import type { OverheadPayload } from '../shared/payload.ts';
import { inNightWindow, MIN_POLL_SECONDS } from '../shared/settings.ts';
import { createAvailabilityStore, overheadOn, registerPageAvailability } from './availability.ts';
import { NO_OVERHEAD, type OverheadClient } from './client.ts';
import { OverheadMap } from './OverheadMap.tsx';
import { OverheadScreen, type MapViewProps } from './OverheadScreen.tsx';
import { machineBusy, OVERHEAD_IDLE_MINUTES, overheadMsUntilWanted } from './policy.ts';
import { overheadPreview, overheadPreviewFromUrl, useOverheadPreview, type OverheadPreviewStore } from './preview.ts';

/** After the waking tap's finger lifts, the clear sheet stays this long (the classic screensaver's 350 ms). */
export const GUARD_AFTER_UP_MS = 350;
export const GUARD_MAX_MS = 5000;

export interface OverheadOverlayProps {
  preview?: OverheadPreviewStore;
  /** The map; MapLibre's unless a test passes its own. */
  renderMap?: (props: MapViewProps) => ReactNode;
  /** The plugin's endpoints; the services' (Decaid's) unless a test passes its own. */
  client?: OverheadClient;
}

const defaultRenderMap = (props: MapViewProps) => <OverheadMap {...props} />;

function minutesOfDay(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

/** The brightness to hold while it shows: the night level in the night hours, else the barista's own (100 leaves it). */
export function overheadBrightness(payload: OverheadPayload | null, now: number): number {
  if (payload === null) return 100;
  const { nightDimStart, nightDimEnd, nightBrightness } = payload.settings;
  return inNightWindow(nightDimStart, nightDimEnd, minutesOfDay(now)) ? nightBrightness : 100;
}

export function OverheadOverlay({ preview = overheadPreview, renderMap = defaultRenderMap, client }: OverheadOverlayProps) {
  const { host, saverScreen, overhead: servicesClient } = useServices();
  const appearance = useAppearance();
  const reducedMotion = usePrefersReducedMotion();
  const busy = useTelemetry(machineBusy);
  const asleep = useTelemetry(confirmedAsleep);
  const overhead = client ?? servicesClient ?? NO_OVERHEAD;
  const availabilityStore = useMemo(() => createAvailabilityStore(overhead), [overhead]);
  useEffect(() => registerPageAvailability(availabilityStore), [availabilityStore]);
  useEffect(() => availabilityStore.start(), [availabilityStore]);
  const availability = useSyncExternalStore(availabilityStore.subscribe, availabilityStore.get);
  const on = overheadOn(availability);
  const idleMinutes = availability.settings?.idleMinutes ?? OVERHEAD_IDLE_MINUTES;
  const previewed = useOverheadPreview(preview);

  const lastTouch = useRef(Date.now());
  const [showing, setShowing] = useState(false);
  const [black, setBlack] = useState(false);
  const [guarding, setGuarding] = useState(false);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const [payload, setPayload] = useState<OverheadPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [wide, setWide] = useState(() => window.innerWidth >= window.innerHeight);

  const active = showing || previewed !== null;
  const mock = previewed?.mock ?? false;

  // Every touch on the page counts, wherever it lands.
  useEffect(() => {
    const touched = () => {
      lastTouch.current = Date.now();
    };
    window.addEventListener('pointerdown', touched, { capture: true, passive: true });
    window.addEventListener('keydown', touched, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', touched, { capture: true });
      window.removeEventListener('keydown', touched, { capture: true });
    };
  }, []);

  // In mock builds only: ?overheadPreview=1 or =mock opens Preview at start (the screenshots).
  useEffect(() => {
    if (import.meta.env.MODE !== 'mock') return;
    const request = overheadPreviewFromUrl(window.location.search);
    if (request) preview.show(request);
  }, [preview]);

  // Up: checked again when the minutes untouched would be over.
  useEffect(() => {
    if (showing) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const wait = overheadMsUntilWanted({ available: on, insideDecaid: host.insideDecaid, busy, untouchedMs: Date.now() - lastTouch.current, idleMinutes });
      if (wait === null) return;
      if (wait > 0) {
        timer = setTimeout(check, wait);
        return;
      }
      preview.hide();
      setBlack(false);
      setShowing(true);
    };
    check();
    return () => clearTimeout(timer);
  }, [on, host.insideDecaid, busy, idleMinutes, showing, preview]);

  // Down by itself: the machine turned busy (never over a shot), or Overhead was turned off.
  useEffect(() => {
    if (showing && (busy || !on)) setShowing(false);
  }, [showing, busy, on]);

  // The clock the board counts down by, and the layout.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const resize = () => setWide(window.innerWidth >= window.innerHeight);
    resize();
    window.addEventListener('resize', resize);
    return () => {
      clearInterval(tick);
      window.removeEventListener('resize', resize);
    };
  }, [active]);

  // Asking the plugin while it shows (and not black), paused while the page is hidden.
  const pollSeconds = Math.max(MIN_POLL_SECONDS, payload?.settings.pollIntervalSeconds ?? 5);
  useEffect(() => {
    if (!active || black) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(read, 1000);
        return;
      }
      try {
        const next = await overhead.overhead({ active: true, mock });
        if (cancelled) return;
        setPayload(next);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
      if (!cancelled) timer = setTimeout(read, pollSeconds * 1000);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, black, overhead, mock, pollSeconds]);

  // Gone: forget the last answer, so the next showing starts from Loading rather than old aircraft.
  useEffect(() => {
    if (active) return;
    setPayload(null);
    setError(null);
  }, [active]);

  // The screen while it shows for real: held on, dimmed only at night; given back as it goes.
  const brightness = overheadBrightness(payload, now);
  useEffect(() => {
    if (!showing || black) return;
    saverScreen?.hold(brightness);
  }, [showing, black, brightness, saverScreen]);
  useEffect(() => {
    if (!showing) return;
    return () => saverScreen?.restore();
  }, [showing, saverScreen]);

  // With the machine asleep, after SAVER_SHOW_MS: black, and the screen let go (the plugin stops asking anyone).
  useEffect(() => {
    if (!showing || !asleep) return;
    const timer = setTimeout(() => {
      setBlack(true);
      saverScreen?.release();
    }, SAVER_SHOW_MS);
    return () => clearTimeout(timer);
  }, [showing, asleep, saverScreen]);

  // The screen turned back on with it black: it starts over.
  useEffect(() => {
    if (!showing || !black) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setBlack(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [showing, black]);

  /** A tap or a key: it goes. */
  const dismiss = useRef<(by: 'pointer' | 'key') => void>(() => undefined);
  useLayoutEffect(() => {
    dismiss.current = (by) => {
      if (!active) return;
      lastTouch.current = Date.now();
      setShowing(false);
      preview.hide();
      if (by === 'pointer') setGuarding(true);
    };
  });

  // The sheet takes the whole tap: its press, the touch and the click, never reaching what is underneath.
  useLayoutEffect(() => {
    if (!sheet) return;
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const press = (event: Event) => {
      swallow(event);
      dismiss.current('pointer');
    };
    sheet.addEventListener('pointerdown', press, { capture: true, passive: false });
    for (const type of ['touchstart', 'click', 'contextmenu'] as const) sheet.addEventListener(type, swallow, { capture: true, passive: false });
    return () => {
      sheet.removeEventListener('pointerdown', press, { capture: true });
      for (const type of ['touchstart', 'click', 'contextmenu'] as const) sheet.removeEventListener(type, swallow, { capture: true });
    };
  }, [sheet]);

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dismiss.current('key');
    };
    window.addEventListener('keydown', key, { capture: true });
    return () => window.removeEventListener('keydown', key, { capture: true });
  }, [active]);

  // After the tap: the clear sheet until the finger lifts and a moment after.
  useLayoutEffect(() => {
    if (!guarding) return;
    let lift: ReturnType<typeof setTimeout> | undefined;
    const done = () => setGuarding(false);
    const lifted = () => {
      clearTimeout(lift);
      lift = setTimeout(done, GUARD_AFTER_UP_MS);
    };
    const cap = setTimeout(done, GUARD_MAX_MS);
    const types = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;
    for (const type of types) window.addEventListener(type, lifted, { capture: true });
    return () => {
      clearTimeout(lift);
      clearTimeout(cap);
      for (const type of types) window.removeEventListener(type, lifted, { capture: true });
    };
  }, [guarding]);

  const palette = paletteFor({ mode: 'dark', tint: appearance.tint }, false);
  const ready = useCallback((node: HTMLDivElement | null) => setSheet(node), []);
  if (!active && !guarding) return null;
  const phase = !active ? 'gone' : black ? 'black' : previewed !== null && !showing ? 'preview' : 'showing';
  return (
    <Portal>
      <Box
        ref={ready}
        role={active ? 'button' : undefined}
        aria-label={active ? 'Close Overhead' : undefined}
        aria-hidden={active ? undefined : true}
        data-testid={active ? TID.overhead : TID.overheadGuard}
        data-phase={phase}
        sx={(theme) => ({
          position: 'fixed',
          inset: 0,
          // Over the classic screensaver too, should both ever be up.
          zIndex: theme.zIndex.tooltip + 2,
          overflow: 'hidden',
          bgcolor: !active ? 'transparent' : black ? '#000' : palette.background,
          color: palette.ink,
          touchAction: 'none',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        })}
      >
        {active && !black ? (
          <>
            <OverheadScreen payload={payload} error={error} now={now} palette={palette} reducedMotion={reducedMotion} wide={wide} renderMap={renderMap} />
            {payload !== null ? <Box component="span" data-testid={TID.overheadReady} hidden /> : null}
          </>
        ) : null}
      </Box>
    </Portal>
  );
}

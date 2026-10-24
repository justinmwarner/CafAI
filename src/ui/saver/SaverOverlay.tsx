/**
 * The screensaver over CafAI (D223-D226), mounted as the last
 * child of the shell's root and drawn through a portal over everything, the
 * top bar and any dialog left open included.
 *
 * Up: on in Settings, inside Decaid, the machine confirmed asleep and the
 * screen untouched for a minute, or the minutes Settings chose (policy.ts,
 * D247), counted from the page's load at first and from every pointerdown or
 * keydown on the window since (the events the heartbeat counts). It dims the
 * tablet to 30, or the brightness Settings chose, and holds it on
 * (services.saverScreen); 30 minutes on it turns black and lets the screen
 * go, and if the page shows again (the screen was turned back on) with the
 * machine still asleep it starts over.
 *
 * Down: a tap, swallowed as TapGuard swallows one (native listeners, capture,
 * non-passive), so it never lands on what is underneath: the clear sheet
 * stays until the finger lifts and a moment after, for the tap's click. The
 * tap wakes the machine with the Wake button's own command, so its spinner
 * and any error show where they always do; when no wake can be sent just
 * then, it only clears the screensaver. A key does the same. By itself: the
 * machine anything but confirmed asleep, or the screensaver turned off.
 *
 * Preview (preview.ts) shows the same way anywhere, never dims, never holds
 * the screen and never wakes the machine; a tap closes it. A screensaver
 * that cannot start, or throws, gives way to Nightstand for the rest of that
 * showing.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import { useAppearance, useCoach, useScreensaverSetting, useServices, useTelemetry } from '../../app/services.tsx';
import { paletteFor } from '../appearance.ts';
import { useMachineCommands } from '../machine/useMachineCommands.ts';
import type { Palette } from '../palette.ts';
import { usePrefersReducedMotion } from '../platform/usePrefersReducedMotion.ts';
import { TID } from '../testIds.ts';
import { resolvePick, runnableHere } from './daily.ts';
import { lastShotSummary, Nightstand, shotNumbers } from './Nightstand.tsx';
import { confirmedAsleep, msUntilWanted, SAVER_SHOW_MS, saverBrightness, saverIdleMs } from './policy.ts';
import { previewFromUrl, saverPreview, usePreviewedSaver, type SaverPreviewStore } from './preview.ts';
import { localDayNumber } from './random.ts';
import { canvasSaver } from './registry.ts';
import { SaverCanvas } from './SaverCanvas.tsx';
import type { CanvasSaver, SaverEnv, SaverId } from './types.ts';

/** After the waking tap's finger lifts, the clear sheet stays this long, so the tap's click lands nowhere (TapGuard's 350 ms). */
export const GUARD_AFTER_UP_MS = 350;
/** And never longer than this, whatever the finger does. */
export const GUARD_MAX_MS = 5000;

/** One showing: a new one starts it over (dimmed and held again, another 30 minutes, the picture from its start). */
interface Showing {
  /** The local day it came up on: the day's pick and its seed. */
  day: number;
  /** Counts the showings of the page's life. */
  n: number;
}

/** A showing or a Preview: what a failure or a first picture belongs to. */
type Shown = Showing | { id: SaverId; seed: number; at: number | null };

let showings = 0;

export interface SaverOverlayProps {
  /** The Preview store; the app's own unless a test passes one. */
  preview?: SaverPreviewStore;
  /** The canvas screensaver with an id; the registry's unless a test passes its own. */
  saverFor?: (id: string) => CanvasSaver | undefined;
}

function startShowing(): Showing {
  showings += 1;
  return { day: localDayNumber(new Date()), n: showings };
}

/** Sends the Wake button's own command, while the overlay shows; mounted only then, so it asks the machine nothing otherwise. */
function WakeOnTap({ wake }: { wake: MutableRefObject<(() => void) | null> }) {
  const { model, sleepWake } = useMachineCommands();
  const can = model.sleepWake.label === 'Wake' && model.sleepWake.enabled;
  useLayoutEffect(() => {
    wake.current = can ? sleepWake : null;
    return () => {
      wake.current = null;
    };
  });
  return null;
}

interface ContentProps {
  id: SaverId;
  seed: number;
  at: number | null;
  palette: Palette;
  fallback: boolean;
  saverFor: (id: string) => CanvasSaver | undefined;
  onFail(error?: unknown): void;
  onPainted(): void;
}

/** The screensaver itself, mounted only while it shows: the last shot's numbers are read only then. */
function SaverContent({ id, seed, at, palette, fallback, saverFor, onFail, onPainted }: ContentProps) {
  const reducedMotion = usePrefersReducedMotion();
  const numbersKey = useCoach((state) => shotNumbers(lastShotSummary(state.messages)).join(' '));
  const env = useMemo<SaverEnv>(() => ({ palette, seed, numbers: numbersKey ? numbersKey.split(' ') : [] }), [palette, seed, numbersKey]);
  const saver = id === 'nightstand' ? undefined : saverFor(id);
  if (!saver || fallback) return <Nightstand palette={palette} seed={seed} onPainted={onPainted} />;
  return <SaverCanvas saver={saver} env={env} still={reducedMotion && at === null} at={at} onFail={onFail} onPainted={onPainted} />;
}

export function SaverOverlay({ preview = saverPreview, saverFor = canvasSaver }: SaverOverlayProps) {
  const { host, saverScreen } = useServices();
  const setting = useScreensaverSetting();
  const asleep = useTelemetry(confirmedAsleep);
  const previewed = usePreviewedSaver(preview);
  const appearance = useAppearance();
  const eligible = setting.on && host.insideDecaid && asleep;
  // Settings' wait and brightness (D247): the wait is read whenever it changes; the brightness as each showing begins.
  const idleMs = saverIdleMs(setting);
  const brightness = useRef(saverBrightness(setting));
  useLayoutEffect(() => {
    brightness.current = saverBrightness(setting);
  });

  const lastTouch = useRef(Date.now());
  const [shown, setShown] = useState<Showing | null>(null);
  const [blackFor, setBlackFor] = useState<Showing | null>(null);
  const [failedFor, setFailedFor] = useState<Shown | null>(null);
  const [paintedFor, setPaintedFor] = useState<Shown | null>(null);
  const [guarding, setGuarding] = useState(false);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const wake = useRef<(() => void) | null>(null);

  const showing = eligible && shown !== null;
  const previewing = !showing && previewed !== null;
  const active = showing || previewing;
  const black = showing && blackFor === shown;
  const current: Shown | null = showing ? shown : previewing ? previewed : null;

  // Every touch on the page counts, wherever it lands: the heartbeat's events.
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

  // In mock builds only: ?saverPreview=<id>&saverAt=<ms> opens Preview at start (the screenshots, the Chromium 91 smoke).
  useEffect(() => {
    if (import.meta.env.MODE !== 'mock') return;
    const request = previewFromUrl(window.location.search);
    if (request) preview.show(request.id, { at: request.at, seed: localDayNumber(new Date()) });
  }, [preview]);

  // When Decaid's frames began saying asleep, this time: its word must stand a few seconds (SAVER_SETTLE_MS) before it counts.
  // Before the effect below, which reads it as `asleep` turns true.
  const asleepSince = useRef(Date.now());
  useEffect(() => {
    if (asleep) asleepSince.current = Date.now();
  }, [asleep]);

  // Up: checked again when the wait untouched (or the few seconds asleep) would be over, for as long as the machine stays asleep.
  useEffect(() => {
    if (shown !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const now = Date.now();
      const wait = msUntilWanted({
        on: setting.on,
        insideDecaid: host.insideDecaid,
        asleep,
        untouchedMs: now - lastTouch.current,
        asleepMs: now - asleepSince.current,
        idleMs,
      });
      if (wait === null) return;
      if (wait > 0) {
        timer = setTimeout(check, wait);
        return;
      }
      // The real one takes over from a Preview left open: it dims and holds the screen.
      preview.hide();
      setShown(startShowing());
    };
    check();
    return () => clearTimeout(timer);
  }, [setting.on, host.insideDecaid, asleep, shown, preview, idleMs]);

  // Down by itself: the machine woke (or the link went), or the screensaver was turned off.
  useEffect(() => {
    if (!eligible) setShown(null);
  }, [eligible]);

  // It goes, however it goes: the brightness back and the wake lock let go.
  useEffect(() => {
    if (!showing) return;
    return () => saverScreen?.restore();
  }, [showing, saverScreen]);

  // It comes up, or starts over: dimmed and held on, then after 30 minutes black, and the screen let go.
  useEffect(() => {
    if (!showing || shown === null) return;
    saverScreen?.hold(brightness.current);
    const timer = setTimeout(() => {
      setBlackFor(shown);
      saverScreen?.release();
    }, SAVER_SHOW_MS);
    return () => clearTimeout(timer);
  }, [showing, shown, saverScreen]);

  // The page shows again (the screen was turned back on): with the machine still asleep, it starts over.
  useEffect(() => {
    if (!showing) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setShown(startShowing());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [showing]);

  /** A tap or a key on the screensaver: it goes, and the real one wakes the machine. */
  const dismiss = useRef<(by: 'pointer' | 'key') => void>(() => undefined);
  useLayoutEffect(() => {
    dismiss.current = (by) => {
      if (!active) return;
      lastTouch.current = Date.now();
      if (showing) {
        wake.current?.();
        setShown(null);
      } else {
        preview.hide();
      }
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

  // A key while it shows: swallowed, and it goes.
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

  const fail = useCallback(
    (error?: unknown) => {
      // Said once in the console (Decaid's WebView log on a tablet), so a screensaver that gives way on a device can be found (D251).
      console.warn(`CafAI: a screensaver stopped (${error instanceof Error ? error.message : String(error)}); Nightstand shows instead.`);
      setFailedFor(current);
    },
    [current],
  );
  const painted = useCallback(() => setPaintedFor(current), [current]);

  if (!active && !guarding) return null;
  const palette = paletteFor({ mode: 'dark', tint: appearance.tint }, false);
  const id: SaverId | null = showing && shown ? resolvePick(setting.pick, runnableHere(), shown.day) : previewing ? previewed.id : null;
  const seed = showing && shown ? shown.day : (previewed?.seed ?? 1);
  const at = previewing ? previewed.at : null;
  const phase = !active ? 'gone' : black ? 'black' : previewing ? 'preview' : 'showing';
  return (
    <Portal>
      <Box
        ref={setSheet}
        role={active ? 'button' : undefined}
        aria-label={active ? (previewing ? 'Close the preview' : 'Wake the machine') : undefined}
        aria-hidden={active ? undefined : true}
        data-testid={active ? TID.saver : TID.saverGuard}
        data-saver={active ? (id ?? undefined) : undefined}
        data-fallback={active && current !== null && failedFor === current ? '1' : undefined}
        data-phase={phase}
        sx={(theme) => ({
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: theme.zIndex.tooltip + 1,
          overflow: 'hidden',
          bgcolor: !active ? 'transparent' : black ? '#000' : palette.background,
          touchAction: 'none',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        })}
      >
        {showing ? <WakeOnTap wake={wake} /> : null}
        {active && !black && id !== null ? (
          <SaverContent
            key={`${id} ${seed} ${showing && shown ? shown.n : 'preview'}`}
            id={id}
            seed={seed}
            at={at}
            palette={palette}
            fallback={current !== null && failedFor === current}
            saverFor={saverFor}
            onFail={fail}
            onPainted={painted}
          />
        ) : null}
        {active && !black && current !== null && paintedFor === current ? <Box component="span" data-testid={TID.saverReady} hidden /> : null}
      </Box>
    </Portal>
  );
}

/**
 * The drink focus rules (drinkFocus.ts) wired to the app, as useShotFocus.ts
 * wires the shot's: the drinks' recording (drinkTrace.ts) in, the router out.
 * A run's start switches to its view with location.replace, so Back in a
 * browser goes where the barista went, and guards the pane it switched for
 * GUARD_MS (TapGuard.tsx); a run already under way when the app starts (after
 * Decaid reloads the skin) takes the screen too. Go back returns, the same
 * way, to the screen the view took over; when the view goes back by itself
 * (useDrinkReturn.ts, D221), that is a switch of the app's too, and the
 * pane it returns to is guarded as well.
 *
 * It never sends anything to the machine.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import { isCareVideoOpen } from '../care/videoHold.ts';
import { navigate, parseRoute, replaceRoute, routeHref, type Route } from '../router.ts';
import { holdsRuns } from '../shell/bagSetup.ts';
import { GUARD_MS, isTextEntry } from '../shell/useShotFocus.ts';
import { drinkOpened, drinkStarted, goBackRoute, NO_ORIGIN, type DrinkFocusState } from './drinkFocus.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

/** A run that started on the new bag screen and stayed off the screen (D277). */
export interface HeldDrink {
  kind: DrinkKind;
  /** The run's id (drinkTrace.ts): the line offering it is dismissed for this run only. */
  id: number;
}

export interface GoBackOptions {
  /** The view goes back by itself: the pane it returns to is guarded, as after a switch. */
  auto?: boolean;
}

export interface DrinkFocus {
  /** Until when (epoch ms) the pane the app just switched to ignores taps; null when it takes them. */
  guardUntil: number | null;
  /** Where Go back goes. */
  back: Route;
  goBack(options?: GoBackOptions): void;
  /** The run that started on the new bag screen and stayed off it, while it runs (D277); null otherwise. */
  held: HeldDrink | null;
  /** Open the held run's view, the barista's tap: Go back returns to the screen it leaves. */
  openHeld(): void;
}

export function useDrinkFocus(): DrinkFocus {
  const { telemetry, coach } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const [guardUntil, setGuardUntil] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldDrink | null>(null);
  const heldRef = useRef(held);
  const [focus, setFocus] = useState<DrinkFocusState>(NO_ORIGIN);
  const focusRef = useRef(focus);
  const switchRef = useRef<((target: Route) => void) | null>(null);

  useEffect(() => {
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    // The app's own switch: a replace, then the guard over the pane it switched.
    const switchTo = (target: Route) => {
      // A hash the screen has not caught up with yet: nothing to switch, nothing to guard.
      if (window.location.hash === routeHref(target)) return;
      if (guardTimer !== null) clearTimeout(guardTimer);
      setGuardUntil(Date.now() + GUARD_MS);
      guardTimer = setTimeout(() => {
        guardTimer = null;
        setGuardUntil(null);
      }, GUARD_MS);
      replaceRoute(target);
    };
    switchRef.current = switchTo;
    const started = (run: DrinkRun) => {
      // The screen on show from the hash, not the last render: the shot focus may have switched a moment ago, before React heard.
      const shown = parseRoute(window.location.hash);
      // The new bag screen keeps its place, and offers the view instead (D277).
      const setup = holdsRuns(shown, coach.getState());
      const nowHeld = setup ? { kind: run.kind, id: run.id } : null;
      heldRef.current = nowHeld;
      setHeld(nowHeld);
      const held = setup || (shown.name === 'care' && isCareVideoOpen());
      const step = drinkStarted(focusRef.current, { kind: run.kind, typing: isTextEntry(document.activeElement), held, shown });
      if (step.state !== focusRef.current) {
        focusRef.current = step.state;
        setFocus(step.state);
      }
      if (step.go !== null) switchTo(step.go);
    };
    // A run under way before anyone listened (the app opened mid-steam) takes the screen as a new one would.
    const live = trace.getState().live;
    const under = live === null ? null : trace.runOf(live);
    if (under) started(under);
    const stop = trace.onRun((event) => {
      if (event.type === 'started') started(event.run);
      else if (heldRef.current?.id === event.run.id) {
        heldRef.current = null;
        setHeld(null);
      }
    });
    return () => {
      stop();
      switchRef.current = null;
      if (guardTimer !== null) clearTimeout(guardTimer);
    };
  }, [trace, coach]);

  const goBack = useCallback((options?: GoBackOptions) => {
    const target = goBackRoute(focusRef.current);
    // Tapped, it is the barista's own move: nothing to guard.
    if (options?.auto === true && switchRef.current !== null) switchRef.current(target);
    else replaceRoute(target);
  }, []);
  const openHeld = useCallback(() => {
    const run = heldRef.current;
    if (run === null) return;
    const step = drinkOpened(focusRef.current, run.kind, parseRoute(window.location.hash));
    if (step.state !== focusRef.current) {
      focusRef.current = step.state;
      setFocus(step.state);
    }
    // Tapped, it is the barista's own move: nothing to guard, and a new entry, as Open the shot makes, so Back in a
    // browser returns to the bag being set up.
    navigate(step.go);
  }, []);
  return { guardUntil, back: goBackRoute(focus), goBack, held, openHeld };
}

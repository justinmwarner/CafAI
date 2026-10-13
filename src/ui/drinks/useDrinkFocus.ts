/**
 * The drink focus rules (drinkFocus.ts) wired to the app, as useShotFocus.ts
 * wires the shot's: the drinks' recording (drinkTrace.ts) in, the router out.
 * A run's start switches to its view with location.replace, so Back in a
 * browser goes where the barista went, and guards the pane it switched for
 * GUARD_MS (TapGuard.tsx); a run already under way when the app starts (after
 * Decaid reloads the skin) takes the screen too. Go back returns, the same
 * way, to the screen the view took over.
 *
 * It never sends anything to the machine.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import { replaceRoute, routeHref, type Route } from '../router.ts';
import { GUARD_MS, isTextEntry } from '../shell/useShotFocus.ts';
import { drinkStarted, goBackRoute, NO_ORIGIN, type DrinkFocusState } from './drinkFocus.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';

export interface DrinkFocus {
  /** Until when (epoch ms) the pane the app just switched to ignores taps; null when it takes them. */
  guardUntil: number | null;
  /** Where Go back goes. */
  back: Route;
  goBack(): void;
}

export function useDrinkFocus(route: Route): DrinkFocus {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const [guardUntil, setGuardUntil] = useState<number | null>(null);
  const [focus, setFocus] = useState<DrinkFocusState>(NO_ORIGIN);
  const focusRef = useRef(focus);
  /** The route on screen, for the runs that start between renders. */
  const shown = useRef(route);
  useLayoutEffect(() => {
    shown.current = route;
  }, [route]);

  useEffect(() => {
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    const started = (run: DrinkRun) => {
      const step = drinkStarted(focusRef.current, { kind: run.kind, typing: isTextEntry(document.activeElement), shown: shown.current });
      if (step.state !== focusRef.current) {
        focusRef.current = step.state;
        setFocus(step.state);
      }
      if (step.go === null || window.location.hash === routeHref(step.go)) return;
      if (guardTimer !== null) clearTimeout(guardTimer);
      setGuardUntil(Date.now() + GUARD_MS);
      guardTimer = setTimeout(() => {
        guardTimer = null;
        setGuardUntil(null);
      }, GUARD_MS);
      replaceRoute(step.go);
    };
    // A run under way before anyone listened (the app opened mid-steam) takes the screen as a new one would.
    const live = trace.getState().live;
    const under = live === null ? null : trace.runOf(live);
    if (under) started(under);
    const stop = trace.onRun((event) => {
      if (event.type === 'started') started(event.run);
    });
    return () => {
      stop();
      if (guardTimer !== null) clearTimeout(guardTimer);
    };
  }, [trace]);

  const goBack = useCallback(() => replaceRoute(goBackRoute(focusRef.current)), []);
  return { guardUntil, back: goBackRoute(focus), goBack };
}

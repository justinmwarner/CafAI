/**
 * Going back by itself (D221): the rules (drinkReturn.ts) wired to a
 * drink's view, as useDrinkFocus.ts wires the switch to it. The view's run and
 * the drink's screen setting come in; Go back goes out, at zero.
 *
 * Only the end of a run this view saw live counts down: a view opened on a
 * finished run never goes back by itself. While it counts, the clock is read
 * every TICK_MS, and the view re-renders only as a whole second passes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTextEntry } from '../shell/useShotFocus.ts';
import { drinkReturn, IDLE_RETURN, secondsLeft, type ReturnEvent, type ReturnState } from './drinkReturn.ts';
import type { DrinkRun } from './drinkTrace.ts';
import type { DrinkScreenView } from './useDrinkScreens.ts';

/** How often the countdown reads the clock: the seconds on Go back turn within a quarter of a second of the real ones. */
const TICK_MS = 250;

export interface Countdown {
  /** Whole seconds left before the view goes back by itself. */
  readonly left: number;
  /** Its length in seconds. */
  readonly seconds: number;
  /** When (epoch ms) it reaches zero. */
  readonly until: number;
}

export interface DrinkReturn {
  /** The countdown to going back by itself; null unless it counts down. */
  countdown: Countdown | null;
  /** The barista kept the view after this run's countdown began. */
  kept: boolean;
  /** Stay, or a pointer down or key press in the view: the view stays for this run. */
  keep(): void;
}

export function useDrinkReturn(run: DrinkRun | null, screen: DrinkScreenView, goBack: () => void): DrinkReturn {
  const [state, setState] = useState<ReturnState>(IDLE_RETURN);
  // Kept apart from the state, so a tick re-renders the view only as a whole second passes.
  const [left, setLeft] = useState(0);
  const stateRef = useRef(state);
  // The newest setting and Go back, for the run's end and the clock, which come between renders.
  const latest = useRef({ screen, goBack });
  useLayoutEffect(() => {
    latest.current = { screen, goBack };
  });

  const dispatch = useCallback((event: ReturnEvent) => {
    const step = drinkReturn(stateRef.current, event);
    stateRef.current = step.state;
    setState(step.state);
    setLeft(secondsLeft(step.state, Date.now()) ?? 0);
    if (step.goBack) latest.current.goBack();
  }, []);

  // The run this view saw live: only its end counts down. Before paint, so Done's first frame already counts.
  const seen = useRef<number | null>(null);
  const live = run?.live ?? false;
  useLayoutEffect(() => {
    if (run === null) return;
    if (live) {
      // The drink starting again keeps the view for the run it counted down after.
      if (seen.current !== run.id) dispatch({ type: 'kept' });
      seen.current = run.id;
    } else if (seen.current === run.id) {
      seen.current = null;
      const { goBack: on, goBackSeconds } = latest.current.screen;
      dispatch({ type: 'ended', runId: run.id, lost: run.lost, goBack: on, seconds: goBackSeconds, now: Date.now() });
    }
  }, [run, live, dispatch]);

  // Going back by itself turned off while it counts: the view stays.
  useEffect(() => {
    if (!screen.goBack) dispatch({ type: 'kept' });
  }, [screen.goBack, dispatch]);

  const counting = state.kind === 'counting';
  useEffect(() => {
    if (!counting) return;
    const ticker = setInterval(() => dispatch({ type: 'tick', now: Date.now(), typing: isTextEntry(document.activeElement) }), TICK_MS);
    return () => clearInterval(ticker);
  }, [counting, dispatch]);

  const keep = useCallback(() => dispatch({ type: 'kept' }), [dispatch]);
  return {
    countdown: state.kind === 'counting' ? { left, seconds: state.seconds, until: state.until } : null,
    kept: state.kind === 'kept',
    keep,
  };
}

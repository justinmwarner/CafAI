/**
 * The shot focus rules (shotFocus.ts) wired to the app: telemetry's shot
 * lifecycle and the chat's messages in, the router out. The reducer decides
 * when the screen switches by itself; this hook only feeds it events, carries
 * out what it says, and tells the shell how long to guard the screen it
 * switched to (TapGuard.tsx).
 *
 * It never sends anything to the machine and keeps no coaching state.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import type { CoachUiMessage } from '../../app/types.ts';
import { parseRoute, replaceRoute, routeHref, sameRoute, type Route, type RouteName } from '../router.ts';
import { IDLE, shotFocus, type FocusCommand, type FocusEvent, type FocusState } from './shotFocus.ts';

/** How long the screen the app just switched to ignores taps, in ms. */
export const GUARD_MS = 350;

/** How often the wait for the shot's outcome looks at the clock. */
const TICK_MS = 1000;

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * True for an element that takes typed text: a textarea, a text-like input or
 * an editable element. Focus there means the barista is typing (and a phone's
 * on-screen keyboard is up); a button, a checkbox or a select is not typing.
 */
export function isTextEntry(target: EventTarget | null | undefined): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  // `type` reads 'text' for an input with no type (or one this engine does not know).
  if (target.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  const editable = target.getAttribute('contenteditable');
  return editable === 'true' || editable === '';
}

/**
 * What became of the shot, in the chat: its card, or a notice that says
 * something (it was not part of this dial-in, Decaid has no record of it).
 * The transient "Looking for that shot in Decaid..." notice carries progress
 * and says nothing yet.
 */
function isOutcome(message: CoachUiMessage): boolean {
  return message.parts.some((part) => part.kind === 'shot' || (part.kind === 'notice' && !part.progress));
}

export interface ShotFocus {
  /** The pour is over and the chat has not had the shot's outcome yet (the coach note's "Reading the shot"). */
  awaitingOutcome: boolean;
  /** Until when (epoch ms) the screen the app just switched to ignores taps; null when it takes them. */
  guardUntil: number | null;
}

/**
 * The route on screen now, from the hash: not the last render's, which lags
 * a moment behind another switch of the app's (a drink's view taking the
 * screen, useDrinkFocus.ts) until React hears of it.
 */
const onScreen = (): Route => parseRoute(window.location.hash);

export function useShotFocus(route: Route): ShotFocus {
  const { telemetry, coach } = useServices();
  const [awaitingOutcome, setAwaitingOutcome] = useState(false);
  const [guardUntil, setGuardUntil] = useState<number | null>(null);
  const focus = useRef<FocusState>(IDLE);
  /** The route of the app's own switch on its way, so its arrival is not taken for the barista's move. */
  const ownSwitch = useRef<RouteName | null>(null);
  const dispatchRef = useRef<((event: FocusEvent) => void) | null>(null);

  useEffect(() => {
    let ticker: ReturnType<typeof setInterval> | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    // The chat's messages when the pour was reported over: only one added after that can be its outcome.
    let before: ReadonlySet<string> = new Set();

    const switchTo = (target: Route) => {
      // A hash the screen has not caught up with yet: nothing to switch, nothing to guard.
      if (window.location.hash === routeHref(target)) return;
      ownSwitch.current = target.name;
      if (guardTimer !== null) clearTimeout(guardTimer);
      setGuardUntil(Date.now() + GUARD_MS);
      guardTimer = setTimeout(() => {
        guardTimer = null;
        setGuardUntil(null);
      }, GUARD_MS);
      // A replace, not a new entry: Back in a phone's browser goes where the barista went, not where the app went.
      replaceRoute(target);
    };

    const carryOut = (command: FocusCommand) => {
      if (command === 'goShot') switchTo({ name: 'shot' });
      // Back to the coach only from the Shot route the app put the barista on.
      else if (command === 'goCoach' && onScreen().name === 'shot') switchTo({ name: 'coach' });
    };

    const dispatch = (event: FocusEvent) => {
      const wasOver = focus.current.kind === 'over';
      const step = shotFocus(focus.current, event);
      focus.current = step.state;
      const over = step.state.kind === 'over';
      if (over !== wasOver) setAwaitingOutcome(over);
      if (over && ticker === null) {
        ticker = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), TICK_MS);
      } else if (!over && ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
      carryOut(step.command);
    };
    dispatchRef.current = dispatch;

    const stopShots = telemetry.onShot((event) => {
      if (event.type === 'started') {
        dispatch({
          type: 'shotStarted',
          typing: isTextEntry(document.activeElement),
          onShotRoute: onScreen().name === 'shot',
        });
        return;
      }
      before = new Set(coach.getState().messages.map((message) => message.id));
      dispatch({ type: 'shotFinished', at: Date.now() });
    });
    const stopChat = coach.subscribe(() => {
      if (focus.current.kind !== 'over') return;
      if (coach.getState().messages.some((message) => !before.has(message.id) && isOutcome(message))) {
        dispatch({ type: 'outcomeAdded' });
      }
    });

    return () => {
      stopShots();
      stopChat();
      dispatchRef.current = null;
      if (ticker !== null) clearInterval(ticker);
      if (guardTimer !== null) clearTimeout(guardTimer);
    };
  }, [telemetry, coach]);

  // A route change the app did not make is the barista's choice, and it wins:
  // no automatic return for this shot.
  const previous = useRef(route);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = route;
    if (sameRoute(from, route)) return;
    const own = ownSwitch.current === route.name;
    ownSwitch.current = null;
    if (!own) dispatchRef.current?.({ type: 'userNavigated' });
  }, [route]);

  return { awaitingOutcome, guardUntil };
}

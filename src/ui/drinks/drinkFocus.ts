/**
 * When CafAI switches to a drink's view by itself, and where Go back goes
 * (D146). A pure reducer, as shotFocus.ts is: useDrinkFocus.ts feeds it the
 * runs and the screen on show and carries out what it says.
 *
 * A run's start switches to its drink's view, unless the barista is typing (a
 * phone's keyboard may be up, a sentence half written) or the view is already
 * on screen. The screen the view took over is remembered for Go back: the
 * last screen that was not a drink's view, so hot water after a flush still
 * goes back to the coach. There is no return of its own (the owner's choice,
 * 2026-10-13): the view stays, with the result, until the barista leaves it.
 */
import type { Route } from '../router.ts';
import type { DrinkKind } from './kinds.ts';

export interface DrinkFocusState {
  /** The screen the last switch took over (never a drink's view); null before any. */
  readonly origin: Route | null;
}

export const NO_ORIGIN: DrinkFocusState = { origin: null };

export interface DrinkStarted {
  kind: DrinkKind;
  /** A field that takes typed text has focus (useShotFocus.ts's isTextEntry). */
  typing: boolean;
  /** The route on screen as the run started. */
  shown: Route;
}

export interface DrinkFocusStep {
  state: DrinkFocusState;
  /** Where to switch, or null to stay. */
  go: Route | null;
}

export function drinkStarted(state: DrinkFocusState, event: DrinkStarted): DrinkFocusStep {
  const there = event.shown.name === 'drink' && event.shown.drink === event.kind;
  if (event.typing || there) return { state, go: null };
  const origin = event.shown.name === 'drink' ? state.origin : event.shown;
  return { state: origin === state.origin ? state : { origin }, go: { name: 'drink', drink: event.kind } };
}

/** Where Go back goes: the screen the view took over, or the coach. */
export function goBackRoute(state: DrinkFocusState): Route {
  return state.origin ?? { name: 'coach' };
}

/** Go back's name for a screen reader, which says where. */
export function goBackLabel(route: Route): string {
  switch (route.name) {
    case 'coach':
      return 'Go back to the coach';
    case 'shot':
      return 'Go back to the shot';
    case 'history':
      return 'Go back to History';
    case 'settings':
      return 'Go back to Settings';
    case 'care':
      return 'Go back to Machine care';
    case 'drink':
      return 'Go back';
  }
}

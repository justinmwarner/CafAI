/**
 * When a drink's view goes back by itself (D221). A pure reducer, as
 * drinkFocus.ts is: useDrinkReturn.ts feeds it the runs the view saw and the
 * clock, and carries out what it says.
 *
 * A run the view saw live that ends with the machine's word (Done, not
 * Connection lost), with that drink's Go back by itself on, starts a
 * countdown of its seconds. It stops for this run, the view staying as it is,
 * on Stay, any pointer down or key press inside the view, the drink starting
 * again, or the setting turned off. At zero the view goes back, unless a field
 * that takes typed text has focus: then it stays, rather than pull the screen
 * from under a keyboard.
 */

export type ReturnState =
  | { readonly kind: 'idle' }
  /** Going back at `until` (epoch ms), `seconds` after the run ended. */
  | { readonly kind: 'counting'; readonly runId: number; readonly until: number; readonly seconds: number }
  /** The barista kept the view for this run. */
  | { readonly kind: 'kept'; readonly runId: number };

export type ReturnEvent =
  /** The view saw this run live, then it ended. */
  | { readonly type: 'ended'; readonly runId: number; readonly lost: boolean; readonly goBack: boolean; readonly seconds: number; readonly now: number }
  /** Stay, a pointer down or key press in the view, the run's drink starting again, the setting turned off. */
  | { readonly type: 'kept' }
  /** The clock, with whether a field that takes typed text has focus (useShotFocus.ts's isTextEntry). */
  | { readonly type: 'tick'; readonly now: number; readonly typing: boolean };

export interface ReturnStep {
  readonly state: ReturnState;
  /** Go back now. */
  readonly goBack: boolean;
}

export const IDLE_RETURN: ReturnState = { kind: 'idle' };

const stay = (state: ReturnState): ReturnStep => ({ state, goBack: false });

export function drinkReturn(state: ReturnState, event: ReturnEvent): ReturnStep {
  switch (event.type) {
    case 'ended':
      if (!event.goBack || event.lost) return stay(IDLE_RETURN);
      return stay({ kind: 'counting', runId: event.runId, until: event.now + event.seconds * 1000, seconds: event.seconds });
    case 'kept':
      return stay(state.kind === 'counting' ? { kind: 'kept', runId: state.runId } : state);
    case 'tick':
      if (state.kind !== 'counting' || event.now < state.until) return stay(state);
      return event.typing ? stay({ kind: 'kept', runId: state.runId }) : { state: IDLE_RETURN, goBack: true };
  }
}

/** Whole seconds left, rounded up, for the button; null unless counting. */
export function secondsLeft(state: ReturnState, now: number): number | null {
  if (state.kind !== 'counting') return null;
  return Math.max(0, Math.ceil((state.until - now) / 1000));
}

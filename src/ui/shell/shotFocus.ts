/**
 * When CafAI switches screens by itself around a shot. A pure reducer: the
 * hook that wires it to telemetry, the chat and the router feeds it events
 * and carries out its commands, so every rule is testable without a DOM.
 */

/** How long after the pour finished the app waits for the chat before going back anyway. */
export const OUTCOME_WAIT_MS = 8000;

export type FocusState =
  | { kind: 'idle' }
  /**
   * A shot is running; `auto` when the app put the barista on the Shot route
   * itself; `held` when it started on the new bag screen (D277), where no
   * coach reads it, so its end waits for no outcome.
   */
  | { kind: 'live'; auto: boolean; held?: boolean }
  /** The pour is over; waiting for the chat to get the shot's card or notice. */
  | { kind: 'over'; auto: boolean; at: number };

export type FocusEvent =
  /** `held`: the new bag screen is up (bagSetup.ts, D277), so the shot stays off the screen, as while typing. */
  | { type: 'shotStarted'; typing: boolean; onShotRoute: boolean; held?: boolean }
  | { type: 'userNavigated' }
  | { type: 'shotFinished'; at: number }
  | { type: 'outcomeAdded' }
  | { type: 'tick'; now: number };

export type FocusCommand = 'goShot' | 'goCoach' | null;

export interface FocusStep {
  state: FocusState;
  command: FocusCommand;
}

export const IDLE: FocusState = { kind: 'idle' };

export function shotFocus(state: FocusState, event: FocusEvent): FocusStep {
  switch (event.type) {
    case 'shotStarted': {
      const held = event.held === true;
      const switchNow = !event.typing && !event.onShotRoute && !held;
      return { state: held ? { kind: 'live', auto: false, held } : { kind: 'live', auto: switchNow }, command: switchNow ? 'goShot' : null };
    }
    case 'userNavigated':
      return { state: state.kind === 'idle' ? state : { ...state, auto: false }, command: null };
    case 'shotFinished':
      if (state.kind === 'live' && state.held === true) return { state: IDLE, command: null };
      return state.kind === 'live' ? { state: { kind: 'over', auto: state.auto, at: event.at }, command: null } : { state, command: null };
    case 'outcomeAdded':
      return state.kind === 'over' ? settle(state) : { state, command: null };
    case 'tick':
      return state.kind === 'over' && event.now - state.at >= OUTCOME_WAIT_MS ? settle(state) : { state, command: null };
  }
}

function settle(state: Extract<FocusState, { kind: 'over' }>): FocusStep {
  return { state: IDLE, command: state.auto ? 'goCoach' : null };
}

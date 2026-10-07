/**
 * When CafAI switches screens by itself around a shot. A pure reducer: the
 * hook that wires it to telemetry, the chat and the router feeds it events
 * and carries out its commands, so every rule is testable without a DOM.
 */

/** How long after the pour finished the app waits for the chat before going back anyway. */
export const OUTCOME_WAIT_MS = 8000;

export type FocusState =
  | { kind: 'idle' }
  /** A shot is running; `auto` when the app put the barista on the Shot route itself. */
  | { kind: 'live'; auto: boolean }
  /** The pour is over; waiting for the chat to get the shot's card or notice. */
  | { kind: 'over'; auto: boolean; at: number };

export type FocusEvent =
  | { type: 'shotStarted'; typing: boolean; onShotRoute: boolean }
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
      const switchNow = !event.typing && !event.onShotRoute;
      return { state: { kind: 'live', auto: switchNow }, command: switchNow ? 'goShot' : null };
    }
    case 'userNavigated':
      return { state: state.kind === 'idle' ? state : { ...state, auto: false }, command: null };
    case 'shotFinished':
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

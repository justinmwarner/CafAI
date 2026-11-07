/**
 * The new bag screen (D277): the coach's screen while a bag is being set up,
 * that is a bag on screen with no starting profile yet ("Which coffee is
 * it?", its details, the starting profiles). The barista is typing or
 * photographing a bag there, so a run the machine starts then (Espresso
 * tapped by mistake, the steam wand's lever) does not take the screen: the
 * screen stays, and a line at its top offers the run's view (HeldRunAlert).
 * The coach says nothing of such a shot either (D276).
 */
import type { CoachState } from '../../app/types.ts';
import type { DrinkKind } from '../drinks/kinds.ts';
import type { Route } from '../router.ts';

/** What a run is: a shot, or one of the drinks with a view of its own. */
export type RunKind = 'shot' | DrinkKind;

type SetupFacts = Pick<CoachState, 'ready' | 'hasApiKey' | 'activeBag' | 'activeVersion'>;

/** The coach shows a bag still being set up: its chat is on screen, and it has no starting profile yet. */
export function settingUpBag(state: SetupFacts): boolean {
  return state.ready && state.hasApiKey && state.activeBag !== null && state.activeVersion === null;
}

/** A run that starts now stays off the screen: the new bag screen is up (the coach's route, a bag being set up). */
export function holdsRuns(route: Route, state: SetupFacts): boolean {
  return route.name === 'coach' && settingUpBag(state);
}

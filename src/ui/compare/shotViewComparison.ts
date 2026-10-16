/**
 * The shot the Shot view draws under the one it shows (D178, D179).
 *
 * The view shows the app's one recorded shot (shotTrace.ts). While it pulls
 * it has no card yet, so the guide is the bag's newest card, the shot its
 * card will be compared with when it lands. Once the shot's card is in the
 * chat, the view draws what that card asks about, as the card itself does,
 * and keeps it for that shot even when the chat moves to another bag and the
 * card leaves the messages. Before any shot nothing is drawn.
 *
 * A finished shot without its card (still on its way, never coming because
 * it ran another profile, or not to be matched because Decaid gave it no id)
 * keeps the guide it pulled with, never the newest card of the chat, which
 * by then may be its own or another bag's.
 *
 * The shell creates it when the app starts (useShotViewComparison), so it
 * has followed every shot and card whether a graph was on screen or not.
 */
import type { CoachController } from '../../app/types.ts';
import type { ShotTrace } from '../machine/shotTrace.ts';
import { comparisonTarget, newestShotId, PREVIOUS_SHOT, sameTarget, shotCardOf, type ComparisonTarget } from './comparison.ts';

export interface ShotViewComparison {
  /** The shot to draw under the recorded one; the same object until it changes, as useSyncExternalStore needs. */
  getTarget(): ComparisonTarget | null;
  /** Told when the target changes. */
  subscribe(listener: () => void): () => void;
}

type TraceSource = Pick<ShotTrace, 'getState' | 'subscribe'>;
type CoachSource = Pick<CoachController, 'getState' | 'subscribe'>;

const previousShot = (shotId: string | null): ComparisonTarget | null => (shotId === null ? null : { shotId, name: PREVIOUS_SHOT });

export function createShotViewComparison(trace: TraceSource, coach: CoachSource): ShotViewComparison {
  /** What the finished shot's card asks about, once seen. */
  let fromCard: { shotId: string; target: ComparisonTarget | null } | null = null;
  /** The guide while the shot pulled. */
  let whilePulling: ComparisonTarget | null = null;
  let current: ComparisonTarget | null = null;

  const compute = (): ComparisonTarget | null => {
    const { phase, finishedShotId } = trace.getState();
    if (phase === 'empty') {
      whilePulling = null;
      return null;
    }
    const messages = coach.getState().messages;
    if (phase === 'live') {
      whilePulling = previousShot(newestShotId(messages));
      return whilePulling;
    }
    if (finishedShotId !== null) {
      const card = shotCardOf(messages, finishedShotId);
      // A card rated with stars before D126 asks nothing, so names no shot.
      if (card) fromCard = { shotId: finishedShotId, target: comparisonTarget(card.stars === undefined ? card.baseline : null) };
      if (fromCard?.shotId === finishedShotId) return fromCard.target;
    }
    // Done, its card still on its way, or never coming (a shot of another
    // profile): the guide it pulled with, never the newest card of a chat
    // that may since have moved to another bag.
    return whilePulling;
  };

  const listeners = new Set<() => void>();
  // Followed from the store's creation on, whether a graph is on screen or
  // not, so a card seen while the barista was elsewhere is still known.
  const update = () => {
    const next = compute();
    if (sameTarget(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  trace.subscribe(update);
  coach.subscribe(update);
  update();

  return {
    getTarget: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const stores = new WeakMap<object, WeakMap<object, ShotViewComparison>>();

/** The one comparison for a trace and a coach, for as long as both live. */
export function shotViewComparisonFor(trace: TraceSource, coach: CoachSource): ShotViewComparison {
  let byCoach = stores.get(trace);
  if (!byCoach) {
    byCoach = new WeakMap();
    stores.set(trace, byCoach);
  }
  let store = byCoach.get(coach);
  if (!store) {
    store = createShotViewComparison(trace, coach);
    byCoach.set(coach, store);
  }
  return store;
}

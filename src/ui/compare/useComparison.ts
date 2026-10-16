/**
 * The summary of the shot to draw under another (D181): from its card
 * in the chat on screen when it is there with a curve, with no request;
 * otherwise read once from Decaid (comparisonShots.ts). Null until there is
 * one to draw, and for good when there is none: the caller then draws its
 * own shot alone, and says nothing.
 *
 * Outside a ServicesProvider (a card drawn on its own, in a test or a
 * preview) there is no chat and no Decaid, so nothing is drawn under.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalServices, useServices } from '../../app/services.tsx';
import type { ShotSummary } from '../../coach/types.ts';
import { shotTraceFor } from '../machine/shotTrace.ts';
import { chatShotSummary, shotCardOf, type ComparisonTarget } from './comparison.ts';
import { comparisonShotsFor } from './comparisonShots.ts';
import { shotViewComparisonFor, type ShotViewComparison } from './shotViewComparison.ts';

const noSubscription = () => () => {};

/**
 * `holder`: the shot whose card draws the shot under, or null for the Shot
 * view. Decaid is asked only while the chat on screen still holds that card:
 * when the chat moves to another bag, the old bag's cards render once more
 * against the new bag's messages before they go, and none of them may read
 * its previous shot from Decaid then. A shot already read is drawn either way.
 */
export function useComparisonSummary(target: ComparisonTarget | null, holder: string | null = null): ShotSummary | null {
  const services = useOptionalServices();
  const coach = services?.coach ?? null;
  const decaid = services?.decaid ?? null;
  const shots = useMemo(() => (decaid ? comparisonShotsFor(decaid) : null), [decaid]);
  const shotId = target?.shotId ?? null;
  // The card's summary keeps its identity while its message does, so a
  // reply streaming into the chat does not re-render the curves.
  const fromChat = useSyncExternalStore(coach ? coach.subscribe : noSubscription, () =>
    coach && shotId !== null ? chatShotSummary(coach.getState().messages, shotId) : null,
  );
  const held = useSyncExternalStore(coach ? coach.subscribe : noSubscription, () =>
    holder === null || (coach !== null && shotCardOf(coach.getState().messages, holder) !== null),
  );
  const fromDecaid = useSyncExternalStore(shots ? shots.subscribe : noSubscription, () =>
    shots && shotId !== null ? shots.peek(shotId) : undefined,
  );
  const wanted = shots !== null && shotId !== null && fromChat === null && held;
  useEffect(() => {
    if (wanted && shots && shotId !== null) void shots.load(shotId);
  }, [wanted, shots, shotId]);
  return fromChat ?? (shotId !== null ? (fromDecaid ?? null) : null);
}

/**
 * The Shot view's shot under, for the app's one shot recording (D179).
 * The shell calls it when it mounts, so the comparison follows the chat from
 * the app's start, whether a graph is on screen or not.
 */
export function useShotViewComparison(): ShotViewComparison {
  const { telemetry, coach } = useServices();
  return useMemo(() => shotViewComparisonFor(shotTraceFor(telemetry), coach), [telemetry, coach]);
}

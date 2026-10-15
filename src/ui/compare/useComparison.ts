/**
 * The summary of the shot to draw under another (D-CURVE-4): from its card
 * in the chat on screen when it is there with a curve, with no request;
 * otherwise read once from Decaid (comparisonShots.ts). Null until there is
 * one to draw, and for good when there is none: the caller then draws its
 * own shot alone, and says nothing.
 *
 * Outside a ServicesProvider (a card drawn on its own, in a test or a
 * preview) there is no chat and no Decaid, so nothing is drawn under.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalServices } from '../../app/services.tsx';
import type { ShotSummary } from '../../coach/types.ts';
import { chatShotSummary, type ComparisonTarget } from './comparison.ts';
import { comparisonShotsFor } from './comparisonShots.ts';

const noSubscription = () => () => {};

export function useComparisonSummary(target: ComparisonTarget | null): ShotSummary | null {
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
  const fromDecaid = useSyncExternalStore(shots ? shots.subscribe : noSubscription, () =>
    shots && shotId !== null ? shots.peek(shotId) : undefined,
  );
  const wanted = shots !== null && shotId !== null && fromChat === null;
  useEffect(() => {
    if (wanted && shots && shotId !== null) void shots.load(shotId);
  }, [wanted, shots, shotId]);
  return fromChat ?? (wanted ? (fromDecaid ?? null) : null);
}

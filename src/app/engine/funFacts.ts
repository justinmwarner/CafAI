/**
 * When a fun fact is due (D197): the bag's latest decided shot (its question
 * answered, not set aside by a newer shot) was kept, on the version the new
 * shot ran, and the new shot ran like the latest earlier shot on that
 * version (ranLikeLast). This finds that earlier shot.
 */
import type { FunFactsSource } from '../../coach/facts/types.ts';
import type { ShotSummary } from '../../coach/types.ts';
import type { IterationRecord } from '../../storage/types.ts';

/** The coach shares facts itself (D198, D201): its mode and the web mode. In the others it hears nothing of them. */
export function coachShares(source: FunFactsSource): boolean {
  return source === 'coach' || source === 'web';
}

/**
 * The latest earlier shot on `versionId` to compare the new shot with, once
 * the barista kept that version's recipe and decided nothing since; null when
 * the bag is not dialed in. `iterations` are the bag's, oldest first, with or
 * without the new shot's own (`shotId`): only those before it count.
 */
export function previousLikeShot(iterations: readonly IterationRecord[], versionId: string, shotId: string): ShotSummary | null {
  const own = iterations.findIndex((iteration) => iteration.shotId === shotId);
  const earlier = (own < 0 ? iterations : iterations.slice(0, own)).filter((iteration) => iteration.shotId);
  const decided = earlier.filter((iteration) => iteration.outcome !== 'pending' && iteration.outcome !== 'superseded');
  const latest = decided[decided.length - 1];
  if (latest?.outcome !== 'kept' || latest.profileVersionId !== versionId) return null;
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const iteration = earlier[i]!;
    if (iteration.profileVersionId === versionId && iteration.summary) return iteration.summary;
  }
  return null;
}

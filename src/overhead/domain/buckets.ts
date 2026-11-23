/**
 * The board's buckets (the brief, section 2), every threshold a setting:
 *
 * | Bucket | Rule |
 * |---|---|
 * | Now | passes within nowCpaMiles, and its closest point is within ± nowWindowSeconds |
 * | In N min | approaching, passes within soonCpaMiles, closest point within soonWithinMinutes |
 * | Just passed | 0 to passedForSeconds after its closest point, having passed within soonCpaMiles |
 *
 * Anything else is not on the board. Only aircraft in the air at or below
 * the list ceiling are listed; the map shows everything.
 *
 * The CPA is computed once, at the position's time; holding a straight line,
 * the closest point does not move and only the time to it runs down, so the
 * skin re-buckets every second from `elapsedSeconds` without asking again.
 */
import type { Cpa, OverheadAircraft } from '../shared/payload.ts';
import type { OverheadSettings } from '../shared/settings.ts';

export type BucketRules = Pick<OverheadSettings, 'nowCpaMiles' | 'nowWindowSeconds' | 'soonCpaMiles' | 'soonWithinMinutes' | 'passedForSeconds'>;

export type Bucket = { kind: 'now' } | { kind: 'soon'; minutes: number; seconds: number } | { kind: 'passed'; secondsAgo: number };

/** The bucket `elapsedSeconds` after the CPA was computed, or null when it is not on the board. */
export function bucketFor(cpa: Cpa | null, rules: BucketRules, elapsedSeconds = 0): Bucket | null {
  if (cpa === null) return null;
  const t = cpa.timeToCpaSeconds - elapsedSeconds;
  if (cpa.distanceMiles <= rules.nowCpaMiles && Math.abs(t) <= rules.nowWindowSeconds) return { kind: 'now' };
  if (cpa.distanceMiles > rules.soonCpaMiles) return null;
  if (t > 0 && t <= rules.soonWithinMinutes * 60) return { kind: 'soon', minutes: Math.max(1, Math.round(t / 60)), seconds: t };
  if (t <= 0 && -t <= rules.passedForSeconds) return { kind: 'passed', secondsAgo: -t };
  return null;
}

/** "Now", "2 min", "Just passed". */
export function bucketLabel(bucket: Bucket): string {
  if (bucket.kind === 'now') return 'Now';
  if (bucket.kind === 'soon') return `${bucket.minutes} min`;
  return 'Just passed';
}

/** Whether the board lists it at all: in the air, at or below the ceiling. */
export function listable(aircraft: Pick<OverheadAircraft, 'onGround' | 'altitudeFt'>, ceilingFt: number): boolean {
  return !aircraft.onGround && aircraft.altitudeFt !== null && aircraft.altitudeFt <= ceilingFt;
}

export interface BoardEntry<T> {
  aircraft: T;
  bucket: Bucket;
}

/**
 * The board: listable aircraft that fall in a bucket, Now first, then the
 * soonest, then the most recently passed.
 */
export function board<T extends Pick<OverheadAircraft, 'onGround' | 'altitudeFt' | 'cpa' | 'positionAt'>>(
  aircraft: readonly T[],
  rules: BucketRules & { listCeilingFt: number },
  now: number,
): Array<BoardEntry<T>> {
  const rank = (bucket: Bucket) => (bucket.kind === 'now' ? 0 : bucket.kind === 'soon' ? 1 : 2);
  const order = (bucket: Bucket) => (bucket.kind === 'soon' ? bucket.seconds : bucket.kind === 'passed' ? bucket.secondsAgo : 0);
  return aircraft
    .filter((plane) => listable(plane, rules.listCeilingFt))
    .flatMap((plane) => {
      const bucket = bucketFor(plane.cpa, rules, Math.max(0, (now - plane.positionAt) / 1000));
      return bucket === null ? [] : [{ aircraft: plane, bucket }];
    })
    .sort((a, b) => rank(a.bucket) - rank(b.bucket) || order(a.bucket) - order(b.bucket));
}

/**
 * The pour clock: every time a barista sees counts from the start of the pour.
 *
 * A shot summary keeps its times on the record's clock, where t = 0 is the
 * start of preheat (about 2 s before the pour in the mock, 1-6.5 s on a real
 * DE1), because the coach's heuristics and query tools read them there. Its
 * durationS is the pour, so a peak "at 61 s" of a "60.0 s" shot would come
 * after the end of the shot. pourStartS says where the pour starts on the
 * record's clock; the shot card, the coach and the demo voice show a time
 * minus it.
 */

/**
 * `t` (seconds on the record's clock) counted from the start of the pour,
 * never below 0, to the summary's 0.1 s. A summary saved before pourStartS
 * keeps its time as it was; null when there is no time.
 */
export function pourTime(t: number | null, pourStartS: number | null | undefined): number | null {
  if (t === null || !Number.isFinite(t)) return null;
  const start = typeof pourStartS === 'number' && Number.isFinite(pourStartS) ? pourStartS : 0;
  // Both are one-decimal values: round their difference back to one decimal (61.4 - 2.2 is 59.199999...).
  const counted = Number((t - start).toFixed(1));
  return counted > 0 ? counted : 0;
}

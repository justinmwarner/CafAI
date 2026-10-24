/**
 * The day records the coach's usage is kept in (D238), as pure functions the
 * store, Decaid's copy, the service and the fakes share.
 *
 * One record per day, device, source, model and kind. A device's counts only
 * grow, so where two copies of a record differ, the one with more requests
 * is the newer: merging never adds two copies together, which keeps a merge
 * safe to repeat (a copy read back from Decaid, a second device's write).
 */
import type { RequestCost } from './pricing.ts';
import type { SpendCount, SpendKind, SpendRecord, SpendSource } from './types.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** 'YYYY-MM-DD' on this device's calendar: a reply at 00:30 is the new day's wherever UTC is. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM' on this device's calendar. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The month before `month` ('YYYY-MM'). */
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return index === 0 ? `${year - 1}-12` : `${year}-${pad(index)}`;
}

/** The first day of the month after `date`'s, 'YYYY-MM-DD': when a pause lifts by itself (D240). */
export function nextMonthStart(date: Date): string {
  return dayOf(new Date(date.getFullYear(), date.getMonth() + 1, 1));
}

/** Where a record is kept: `${day}|${device}|${source}|${model}|${kind}`. */
export function recordKey(record: Pick<SpendRecord, 'day' | 'device' | 'source' | 'model' | 'kind'>): string {
  return `${record.day}|${record.device}|${record.source}|${record.model}|${record.kind}`;
}

const tokens = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** One request as a record of its own, on `device`, priced as `cost`: what is added to the day's. */
export function countRecord(count: SpendCount, device: string, cost: RequestCost): SpendRecord {
  const { usage } = count;
  return {
    day: dayOf(count.at),
    device,
    source: count.source,
    model: count.model,
    kind: count.kind,
    requests: 1,
    // A reply is one to six requests: its first call starts it.
    replies: count.call === 0 ? 1 : 0,
    inputTokens: tokens(usage.inputTokens),
    outputTokens: tokens(usage.outputTokens),
    cacheReadTokens: tokens(usage.cacheReadInputTokens),
    cacheWriteTokens: tokens(usage.cacheCreationInputTokens),
    webSearches: tokens(usage.webSearchRequests),
    costMicros: cost.costMicros,
    webSearchMicros: cost.webSearchMicros,
    unpriced: cost.priced ? 0 : 1,
  };
}

const COUNTED = [
  'requests',
  'replies',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'webSearches',
  'costMicros',
  'webSearchMicros',
  'unpriced',
] as const;

/** `delta` added to `record`, field by field; with no record yet, `delta`. */
export function addRecords(record: SpendRecord | undefined, delta: SpendRecord): SpendRecord {
  if (!record) return { ...delta };
  const sum: SpendRecord = { ...record };
  for (const field of COUNTED) sum[field] = record[field] + delta[field];
  return sum;
}

/**
 * `incoming` merged into `base`, per key: the record with more requests wins,
 * a tie keeps the base's. The base's order, then records it did not have.
 */
export function mergeRecords(base: readonly SpendRecord[], incoming: readonly SpendRecord[]): { records: SpendRecord[]; changed: boolean } {
  const merged = new Map(base.map((record) => [recordKey(record), record]));
  let changed = false;
  for (const record of incoming) {
    const key = recordKey(record);
    const held = merged.get(key);
    if (held && held.requests >= record.requests) continue;
    merged.set(key, record);
    changed = true;
  }
  return { records: [...merged.values()], changed };
}

const SOURCES: readonly SpendSource[] = ['anthropic', 'computer'];
const KINDS: readonly SpendKind[] = ['reply', 'shot', 'photo'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value !== '' && value.length <= max;

/** A record as kept on this device or in Decaid's copy, or null for anything else: only its own fields survive. */
export function readRecord(value: unknown): SpendRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { day, device, source, model, kind } = raw;
  if (!text(day, 10) || !DAY.test(day) || !text(device, 40) || !text(model, 100)) return null;
  if (!SOURCES.some((s) => s === source) || !KINDS.some((k) => k === kind)) return null;
  const record = { day, device, model, source: source as SpendSource, kind: kind as SpendKind } as SpendRecord;
  for (const field of COUNTED) {
    const count = raw[field];
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
    record[field] = count;
  }
  return record;
}

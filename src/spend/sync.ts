/**
 * The coach's usage shared through Decaid's store (D238): namespace
 * `cafai-spend`, one key per month (`2026-10`) holding every device's records
 * of it as `{ v: 1, records }`.
 *
 * Why Decaid: the bill is the API key's, whichever device spent it, so the
 * budget adds every device's spend; and an iPad's Decaid update moves CafAI
 * to a new origin with empty storage (D231), which brings the month back from
 * here instead of starting it at zero. Not in the main mirror (`cafai`): its
 * copy is one device's snapshot, last writer wins, which would drop a second
 * device's spend.
 *
 * A device writes only its own records, put into what the month's key holds
 * (per record, the one with more requests wins: a device's counts only grow),
 * 2 s after the last count; every other entry stays as it is, read here or
 * not, so a kind or a field a newer CafAI added survives this one's write.
 * Two devices writing at the same moment can lose one's write: each write and
 * each refresh puts back whatever Decaid lacks of this device's records, so
 * the copy comes right at the next one. Decaid unreachable: the counts are
 * kept here, and written at the next count or refresh, no more than once a
 * minute; a refresh asked for within that minute (Decaid back after a
 * restart) runs once it is up. Nothing here ever throws into the coach.
 */
import type { KvClient } from '../api/types.ts';
import { isNewer, readRecord, recordKey } from './records.ts';
import type { SpendRecord } from './types.ts';

export const SPEND_NAMESPACE = 'cafai-spend';
/** The value's shape this build writes; a month a newer CafAI wrote in a shape of its own is left alone. */
const COPY_VERSION = 1;
const MONTH = /^\d{4}-\d{2}$/;
const DEBOUNCE_MS = 2000;
const RETRY_MS = 60_000;

export interface SyncTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserTimers: SyncTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SpendSyncOptions {
  kv: KvClient;
  /** This device's id: only its own records are written. */
  deviceId: string;
  /** Every record this device holds now. */
  held(): readonly SpendRecord[];
  /** Records read from Decaid's copy, merged in where this device keeps them; true when anything changed. */
  mergeIn(records: readonly SpendRecord[]): boolean | Promise<boolean>;
  /** Milliseconds, for the once-a-minute rule; Date.now by default. */
  now?: () => number;
  timers?: SyncTimers;
}

export interface SpendSync {
  /** A count changed `month`'s records here ('YYYY-MM'): its copy is written 2 s after the last such change. */
  changed(month: string): void;
  /** Read every month's copy, merge it in, and write back what Decaid lacks of this device's records. Never rejects. */
  refresh(): Promise<void>;
  dispose(): void;
}

/**
 * A month's entries as Decaid holds them, or null for a value a newer CafAI
 * wrote in a shape of its own. No value, or one that is not a copy at all,
 * holds none, and is written over.
 */
function copyEntries(value: unknown): unknown[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw['v'] === 'number' && raw['v'] !== COPY_VERSION) return null;
  if (raw['v'] !== COPY_VERSION || !Array.isArray(raw['records'])) return [];
  return raw['records'] as unknown[];
}

/** The entries this build reads as records. */
const readable = (entries: readonly unknown[]): SpendRecord[] =>
  entries.map(readRecord).filter((record): record is SpendRecord => record !== null);

/**
 * The month's entries with this device's records put in where they are newer
 * or missing, in the copy's order, then the ones it lacked. Every other entry
 * is kept as it is, read here or not.
 */
function withOwn(entries: readonly unknown[], own: readonly SpendRecord[]): { entries: unknown[]; changed: boolean } {
  const mine = new Map(own.map((record) => [recordKey(record), record]));
  let changed = false;
  const next = entries.map((entry) => {
    const there = readRecord(entry);
    const record = there ? mine.get(recordKey(there)) : undefined;
    if (!there || !record) return entry;
    mine.delete(recordKey(there));
    if (!isNewer(record, there)) return entry;
    changed = true;
    return record;
  });
  for (const record of mine.values()) {
    next.push(record);
    changed = true;
  }
  return { entries: next, changed };
}

export function createSpendSync(options: SpendSyncOptions): SpendSync {
  const { kv, deviceId } = options;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? browserTimers;
  /** Months whose copy lacks something of this device's. */
  const owed = new Set<string>();
  let timer: unknown = null;
  /** A refresh asked for within the minute after a failure, run once the minute is up. */
  let retryTimer: unknown = null;
  /** When Decaid last failed to answer; null since it last did. */
  let failedAt: number | null = null;
  let disposed = false;
  // One read or write at a time, in turn.
  let queue: Promise<void> = Promise.resolve();
  const inTurn = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** How long until Decaid may be asked again after a failure: once a minute at most. */
  const waitAfterFailure = () => (failedAt === null ? 0 : Math.max(0, failedAt + RETRY_MS - now()));

  const ownOf = (month: string) => options.held().filter((record) => record.device === deviceId && record.day.slice(0, 7) === month);

  async function mergeIn(records: readonly SpendRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
      await options.mergeIn(records);
    } catch {
      // Kept here or not, the copy in Decaid still holds them.
    }
  }

  /** Each owed month: read its copy, take in the other devices' records, write this device's in when it lacks them. */
  async function write(): Promise<void> {
    for (const month of [...owed]) {
      if (disposed) return;
      // No longer owed while its write is out: a count landing meanwhile owes it again, and its own timer writes it.
      owed.delete(month);
      const own = ownOf(month);
      try {
        const entries = copyEntries(await kv.get<unknown>(SPEND_NAMESPACE, month));
        failedAt = null;
        if (entries !== null) {
          await mergeIn(readable(entries));
          const next = withOwn(entries, own);
          if (next.changed) await kv.set(SPEND_NAMESPACE, month, { v: COPY_VERSION, records: next.entries });
        }
      } catch {
        // Decaid did not answer: this month and the rest wait for the next count or refresh.
        owed.add(month);
        failedAt = now();
        return;
      }
    }
  }

  function schedule(): void {
    if (disposed) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(
      () => {
        timer = null;
        void inTurn(write);
      },
      Math.max(DEBOUNCE_MS, waitAfterFailure()),
    );
  }

  function refresh(): Promise<void> {
    return inTurn(async () => {
      if (disposed) return;
      const wait = waitAfterFailure();
      if (wait > 0) {
        // Asked again within the minute (Decaid back after a restart): once it is up.
        retryTimer ??= timers.setTimeout(() => {
          retryTimer = null;
          void refresh();
        }, wait);
        return;
      }
      let data: Record<string, unknown>;
      try {
        const answer = await kv.getAll(SPEND_NAMESPACE);
        failedAt = null;
        // Never so, with no ETag sent; the type has it.
        if (answer.notModified) return;
        data = answer.data;
      } catch {
        failedAt = now();
        return;
      }
      const copies = new Map<string, SpendRecord[] | null>();
      for (const [month, value] of Object.entries(data)) {
        if (!MONTH.test(month)) continue;
        const entries = copyEntries(value);
        copies.set(month, entries === null ? null : readable(entries));
      }
      await mergeIn([...copies.values()].flatMap((records) => records ?? []));
      // What Decaid lacks of this device's: a write lost while it was away, or to a second device's at the same moment.
      for (const record of options.held()) {
        if (record.device !== deviceId) continue;
        const month = record.day.slice(0, 7);
        const copy = copies.get(month);
        if (copy === null) continue;
        if (isNewer(record, copy?.find((held) => recordKey(held) === recordKey(record)))) owed.add(month);
      }
      if (owed.size > 0) await write();
    });
  }

  return {
    changed(month) {
      if (!MONTH.test(month)) return;
      owed.add(month);
      schedule();
    },
    refresh,
    dispose() {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      timer = null;
      retryTimer = null;
    },
  };
}

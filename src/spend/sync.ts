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
 * A device writes only its own records, merged into what the month's key
 * holds (per record, the one with more requests wins: a device's counts only
 * grow), 2 s after the last count. Two devices writing at the same moment can
 * lose one's write: each write and each refresh puts back whatever Decaid
 * lacks of this device's records, so the copy comes right at the next one.
 * Decaid unreachable: the counts are kept here, and written at the next
 * count or refresh, no more than once a minute. Nothing here ever throws into
 * the coach.
 */
import type { KvClient } from '../api/types.ts';
import { mergeRecords, readRecord, recordKey } from './records.ts';
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

const browserTimers: SyncTimers = {
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
 * The records a month's value holds, or null for a value a newer CafAI wrote
 * in a shape of its own. No value, or one that is not a copy at all, holds
 * none, and is written over.
 */
function readCopy(value: unknown): SpendRecord[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw['v'] === 'number' && raw['v'] !== COPY_VERSION) return null;
  if (raw['v'] !== COPY_VERSION || !Array.isArray(raw['records'])) return [];
  return raw['records'].map(readRecord).filter((record): record is SpendRecord => record !== null);
}

export function createSpendSync(options: SpendSyncOptions): SpendSync {
  const { kv, deviceId } = options;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? browserTimers;
  /** Months whose copy lacks something of this device's. */
  const owed = new Set<string>();
  let timer: unknown = null;
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
      const own = ownOf(month);
      try {
        const copy = readCopy(await kv.get<unknown>(SPEND_NAMESPACE, month));
        failedAt = null;
        if (copy !== null) {
          await mergeIn(copy);
          const merged = mergeRecords(copy, own);
          if (merged.changed) await kv.set(SPEND_NAMESPACE, month, { v: COPY_VERSION, records: merged.records });
        }
        owed.delete(month);
      } catch {
        // Decaid did not answer: the rest wait for the next count or refresh.
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

  return {
    changed(month) {
      if (!MONTH.test(month)) return;
      owed.add(month);
      schedule();
    },
    refresh: () =>
      inTurn(async () => {
        if (disposed || waitAfterFailure() > 0) return;
        let data: Record<string, unknown>;
        try {
          const answer = await kv.getAll(SPEND_NAMESPACE);
          failedAt = null;
          if (answer.notModified) return;
          data = answer.data;
        } catch {
          failedAt = now();
          return;
        }
        const copies = new Map<string, SpendRecord[] | null>();
        for (const [month, value] of Object.entries(data)) {
          if (MONTH.test(month)) copies.set(month, readCopy(value));
        }
        await mergeIn([...copies.values()].flatMap((records) => records ?? []));
        // What Decaid lacks of this device's: a write lost while it was away, or to a second device's at the same moment.
        for (const record of options.held()) {
          if (record.device !== deviceId) continue;
          const month = record.day.slice(0, 7);
          const copy = copies.get(month);
          if (copy === null) continue;
          const there = copy?.find((held) => recordKey(held) === recordKey(record));
          if (!there || there.requests < record.requests) owed.add(month);
        }
        if (owed.size > 0) await write();
      }),
    dispose() {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

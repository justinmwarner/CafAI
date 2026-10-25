/**
 * The coach's usage and cost as one service (D237-D240): counting each
 * finished request, keeping it on the device (store.ts) and in Decaid
 * (sync.ts), the totals Settings shows (summary.ts) and the month's budget
 * (budget.ts).
 *
 * The records live in memory too, so the totals and the budget are known at
 * once and without waiting, which the coach needs before each reply; the
 * device's database and Decaid's copy follow behind. Nothing here throws
 * into the coach.
 */
import type { KvClient } from '../api/types.ts';
import type { ModelInfo } from '../llm/types.ts';
import { createDbHandle } from '../storage/db.ts';
import { budgetState } from './budget.ts';
import { requestCost } from './pricing.ts';
import { addRecords, countRecord, dayOf, isNewer, recordKey } from './records.ts';
import { createIdbSpendStore, createMemorySpendStore, openSpendDb, spendDeviceId, SPEND_DB_NAME, type SpendStore } from './store.ts';
import { summarize } from './summary.ts';
import { browserTimers, createSpendSync, type SyncTimers } from './sync.ts';
import type { SpendRecord, SpendService, SpendSummary } from './types.ts';

export interface SpendServiceOptions {
  store: SpendStore;
  /** Decaid's store, for the copy every device shares; without it the counts stay on this device. */
  kv?: KvClient;
  /** This device's id in the records (store.ts spendDeviceId). */
  deviceId: string;
  /** What the device's database held at start (store.list()). */
  initial?: readonly SpendRecord[];
  /** The models whose prices a count is worked out with: the catalog's (KNOWN_MODELS). */
  models: readonly ModelInfo[];
  now?: () => Date;
  /** The timers of Decaid's copy and of the summary's midnight (the browser's by default). */
  timers?: SyncTimers;
}

export interface CreatedSpendService extends SpendService {
  /** Stops the Decaid copy's timer. */
  dispose(): void;
}

export function createSpendService(options: SpendServiceOptions): CreatedSpendService {
  const { store, deviceId } = options;
  const now = options.now ?? (() => new Date());
  const timers = options.timers ?? browserTimers;
  const prices = new Map(options.models.map((model) => [model.id, model]));
  const records = new Map((options.initial ?? []).map((record) => [recordKey(record), record]));
  const listeners = new Set<() => void>();
  /** Bumped at every change: the summary is worked out again only after one, or on a new day. */
  let version = 0;
  let cached: { version: number; day: string; summary: SpendSummary } | null = null;
  /** Midnight, while a screen listens: its "today" turns over with nothing counted. */
  let dayTimer: unknown = null;

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // One screen's trouble is not the count's.
      }
    }
  }

  function changed(): void {
    version += 1;
    notify();
  }

  function watchTheDay(): void {
    if (dayTimer !== null || listeners.size === 0) return;
    const at = now();
    const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime();
    dayTimer = timers.setTimeout(
      () => {
        dayTimer = null;
        notify();
        watchTheDay();
      },
      // A second past it, so the new day has begun.
      midnight - at.getTime() + 1000,
    );
  }

  function stopWatchingTheDay(): void {
    if (dayTimer !== null) timers.clearTimeout(dayTimer);
    dayTimer = null;
  }

  /** Records that came from Decaid's copy, or from another page's count: per key, more requests wins. */
  function take(incoming: readonly SpendRecord[]): boolean {
    let any = false;
    for (const record of incoming) {
      const key = recordKey(record);
      if (!isNewer(record, records.get(key))) continue;
      records.set(key, record);
      any = true;
    }
    if (any) changed();
    return any;
  }

  const sync = options.kv
    ? createSpendSync({
        kv: options.kv,
        deviceId,
        held: () => [...records.values()],
        async mergeIn(incoming) {
          const any = take(incoming);
          if (any) await store.merge(incoming).catch(() => undefined);
          return any;
        },
        timers,
      })
    : null;

  function summary(at: Date = now()): SpendSummary {
    const day = dayOf(at);
    if (cached && cached.version === version && cached.day === day) return cached.summary;
    const result = summarize(records.values(), at);
    cached = { version, day, summary: result };
    return result;
  }

  return {
    count(entry) {
      try {
        const delta = countRecord(entry, deviceId, requestCost(prices.get(entry.model.trim()), entry.usage));
        const key = recordKey(delta);
        records.set(key, addRecords(records.get(key), delta));
        // Kept on the device behind the count: another page's counts of the same key come back with it.
        Promise.resolve()
          .then(() => store.add(delta))
          .then(
            (stored) => void take([stored]),
            () => undefined,
          );
        sync?.changed(delta.day.slice(0, 7));
        changed();
      } catch {
        // An estimate: a count lost is better than a reply lost.
      }
    },
    summary,
    budget: (budget, at = now()) => budgetState(budget, summary(at).anthropic.month.costMicros, at),
    subscribe(listener) {
      listeners.add(listener);
      watchTheDay();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopWatchingTheDay();
      };
    },
    refresh: () => (sync ? sync.refresh() : Promise.resolve()),
    dispose() {
      sync?.dispose();
      stopWatchingTheDay();
      listeners.clear();
    },
  };
}

export interface OpenSpendOptions {
  kv: KvClient;
  /** The device's own storage, where its id is kept; null when blocked. */
  deviceStorage: globalThis.Storage | null;
  models: readonly ModelInfo[];
  /** For tests: the database's name. */
  dbName?: string;
  now?: () => Date;
}

/**
 * The service as CafAI starts it (createServices.ts): the device's database
 * opened and read, this device's id made once. A database the device refuses
 * leaves the counts in memory for the page's life; Decaid's copy still gets
 * them.
 */
export async function openSpendService(options: OpenSpendOptions): Promise<CreatedSpendService> {
  const handle = createDbHandle((onLost) => openSpendDb(options.dbName ?? SPEND_DB_NAME, onLost));
  let store: SpendStore = createIdbSpendStore(() => handle.get());
  let initial: SpendRecord[];
  try {
    initial = await store.list();
  } catch {
    handle.close();
    store = createMemorySpendStore();
    initial = [];
  }
  const service = createSpendService({
    store,
    kv: options.kv,
    deviceId: spendDeviceId(options.deviceStorage),
    initial,
    models: options.models,
    now: options.now,
  });
  return {
    ...service,
    dispose() {
      service.dispose();
      handle.close();
    },
  };
}

/**
 * While the DEBUG flag is on, once a start is slow: which of CafAI's
 * databases still take a transaction, read-only and read-write, each on a
 * connection of its own and each given a few seconds. IndexedDB queues a
 * read-write transaction behind any open transaction on the same stores (a
 * read-only one too) and lets reads run beside reads, so a write held up by a
 * transaction another page left open shows as reads that answer and writes
 * that do not. Last, a database of the probe's own: whether this WebView
 * writes anywhere at all.
 *
 * The read-write probes only read (one get), so they change nothing, and a
 * database CafAI has not made yet is left unmade.
 */
import { SPEND_DB_NAME } from '../spend/store.ts';
import { CARE_DB_NAME } from '../storage/careDb.ts';
import { COACH_SOURCE_DB_NAME } from '../storage/coachSource.ts';
import { CAFAI_DB_NAME, DATA_STORES } from '../storage/db.ts';
import { SECRETS_DB_NAME } from '../storage/secrets.ts';

export const PROBE_DB_NAME = 'cafai-debug-probe';
const PROBE_STORE = 'probe';
const PROBE_KEY = 'cafai-debug-probe';
export const PROBE_TIMEOUT_MS = 3000;

export interface ProbeStep {
  name: string;
  db: string;
  stores: string[];
  mode: IDBTransactionMode;
  /** The probe's own database: made when missing, and written to (a put and a delete). */
  scratch?: { durability: 'strict' | 'relaxed' };
}

export interface ProbeResult {
  name: string;
  /** ok: it committed; timeout: no answer in time (aborted then); missing: the database is not there; error: it failed. */
  outcome: 'ok' | 'timeout' | 'missing' | 'error';
  ms: number;
  /** For a timeout: whether the database opened, or the transaction never finished. */
  stuckAt?: 'open' | 'transaction';
  error?: string;
}

const OTHER_DATABASES: Array<[string, string]> = [
  [CARE_DB_NAME, 'care'],
  [SECRETS_DB_NAME, 'secrets'],
  [COACH_SOURCE_DB_NAME, 'source'],
  [SPEND_DB_NAME, 'days'],
];

/** Reads first, then writes (a write that waits would hold up a later read of its stores), then the probe's own database. */
export const PROBE_PLAN: ProbeStep[][] = [
  [
    { name: 'cafai: read settings', db: CAFAI_DB_NAME, stores: ['settings'], mode: 'readonly' },
    { name: 'cafai: read every store', db: CAFAI_DB_NAME, stores: [...DATA_STORES], mode: 'readonly' },
    ...OTHER_DATABASES.map(([db, store]): ProbeStep => ({ name: `${db}: read`, db, stores: [store], mode: 'readonly' })),
  ],
  [
    ...DATA_STORES.map((store): ProbeStep => ({ name: `cafai: write ${store}`, db: CAFAI_DB_NAME, stores: [store], mode: 'readwrite' })),
    ...OTHER_DATABASES.map(([db, store]): ProbeStep => ({ name: `${db}: write`, db, stores: [store], mode: 'readwrite' })),
  ],
  [
    { name: `${PROBE_DB_NAME}: write, strict`, db: PROBE_DB_NAME, stores: [PROBE_STORE], mode: 'readwrite', scratch: { durability: 'strict' } },
    { name: `${PROBE_DB_NAME}: write, relaxed`, db: PROBE_DB_NAME, stores: [PROBE_STORE], mode: 'readwrite', scratch: { durability: 'relaxed' } },
  ],
];

class Missing extends Error {}
class TimedOut extends Error {}

/** Open at version 1, CafAI's for every database so far. One that does not exist is not made, unless it is the probe's own. */
function openAtVersionOne(factory: IDBFactory, name: string, makeIt: boolean): { opened: Promise<IDBDatabase>; late(close: boolean): void } {
  let lateClose = false;
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = (event) => {
      if (makeIt && event.oldVersion === 0) {
        request.result.createObjectStore(PROBE_STORE);
        return;
      }
      // Made now, it would be at version 1 without its stores, and CafAI's own open would never add them.
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      if (lateClose) request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      const error = request.error;
      reject(error?.name === 'AbortError' ? new Missing() : (error ?? new Error('open failed')));
    };
  });
  return {
    opened,
    late(close) {
      lateClose = close;
    },
  };
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimedOut()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('failed'));
  });
}

export async function runProbe(factory: IDBFactory, step: ProbeStep, timeoutMs = PROBE_TIMEOUT_MS, clock: { now(): number } = Date): Promise<ProbeResult> {
  const started = clock.now();
  const ms = () => clock.now() - started;
  const open = openAtVersionOne(factory, step.db, step.scratch !== undefined);
  let db: IDBDatabase | null = null;
  let tx: IDBTransaction | null = null;
  try {
    try {
      db = await within(open.opened, timeoutMs);
    } catch (error) {
      if (error instanceof TimedOut) {
        open.late(true);
        return { name: step.name, outcome: 'timeout', ms: ms(), stuckAt: 'open' };
      }
      throw error;
    }
    tx = step.scratch ? db.transaction(step.stores, step.mode, { durability: step.scratch.durability }) : db.transaction(step.stores, step.mode);
    const done = finished(tx);
    for (const store of step.stores) {
      const objects = tx.objectStore(store);
      if (step.scratch) {
        objects.put(new Date(clock.now()).toISOString(), PROBE_KEY);
        objects.delete(PROBE_KEY);
      } else {
        objects.get(PROBE_KEY);
      }
    }
    await within(done, Math.max(1, timeoutMs - ms()));
    return { name: step.name, outcome: 'ok', ms: ms() };
  } catch (error) {
    if (error instanceof Missing) return { name: step.name, outcome: 'missing', ms: ms() };
    if (error instanceof TimedOut) {
      // Out of the queue: a write left waiting would hold up later reads of its stores.
      try {
        tx?.abort();
      } catch {
        // It finished meanwhile.
      }
      return { name: step.name, outcome: 'timeout', ms: ms(), stuckAt: 'transaction' };
    }
    const named = error as { name?: unknown; message?: unknown } | null;
    return { name: step.name, outcome: 'error', ms: ms(), error: `${String(named?.name ?? 'Error')}: ${String(named?.message ?? error)}` };
  } finally {
    db?.close();
  }
}

/** Every step of the plan, a phase at a time; the steps of a phase at once. */
export async function probeIndexedDb(factory: IDBFactory, plan: ProbeStep[][] = PROBE_PLAN, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const phase of plan) {
    results.push(...(await Promise.all(phase.map((step) => runProbe(factory, step, timeoutMs)))));
  }
  return results;
}

/** For the console: "cafai: write settings timeout (transaction) 3001 ms; …", the ones that answered summed up. */
export function describeProbes(results: ProbeResult[]): string {
  const ok = results.filter((r) => r.outcome === 'ok').length;
  const rest = results
    .filter((r) => r.outcome !== 'ok')
    .map((r) => `${r.name} ${r.outcome}${r.stuckAt ? ` (${r.stuckAt})` : ''}${r.error ? ` ${r.error}` : ''} ${r.ms} ms`);
  return [`${ok} of ${results.length} answered`, ...rest].join('; ');
}

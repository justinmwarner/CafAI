/**
 * The coach's usage on this device (D238): day records in an IndexedDB
 * database of their own, `cafai-spend`, as machine care has `cafai-care`
 * (D189): CafAI's own database stays at version 1, so a tablet put back on an
 * older CafAI still opens it.
 *
 * Never in the mirror, the export or the import: the records are shared
 * through Decaid's store month by month instead (sync.ts), where every
 * device's add up. Token counts and dollars only.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { closeEventTarget, DURABLE, type LostReason } from '../storage/db.ts';
import { newId } from '../util/id.ts';
import { addRecords, isNewer, recordKey, readRecord } from './records.ts';
import type { SpendRecord } from './types.ts';

export const SPEND_DB_NAME = 'cafai-spend';
const SPEND_DB_VERSION = 1;

export interface SpendDbSchema extends DBSchema {
  /** Day records, by recordKey: day, device, source, model and kind. */
  days: { key: string; value: SpendRecord };
}

export type SpendDb = IDBPDatabase<SpendDbSchema>;

export function openSpendDb(name = SPEND_DB_NAME, onLost?: (reason: LostReason) => void): Promise<SpendDb> {
  return openDB<SpendDbSchema>(name, SPEND_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('days');
    },
    blocking(_currentVersion, blockedVersion, event) {
      closeEventTarget(event);
      onLost?.(blockedVersion === null ? 'deleted' : 'upgraded');
    },
    terminated() {
      onLost?.('terminated');
    },
  });
}

export interface SpendStore {
  /** Add one request's record (records.ts countRecord) to its day's; resolves with the day's record as now kept. */
  add(delta: SpendRecord): Promise<SpendRecord>;
  /** Every record, in key order. */
  list(): Promise<SpendRecord[]>;
  /** Per key, the record with more requests wins (a device's counts only grow); true when anything changed. */
  merge(records: readonly SpendRecord[]): Promise<boolean>;
}

/** The records in `db`, each change one durable transaction. */
export function createIdbSpendStore(db: () => Promise<SpendDb>): SpendStore {
  return {
    async add(delta) {
      const key = recordKey(delta);
      const tx = (await db()).transaction('days', 'readwrite', DURABLE);
      const stored = await tx.store.get(key);
      const record = addRecords(readRecord(stored) ?? undefined, delta);
      await Promise.all([tx.store.put(record, key), tx.done]);
      return record;
    },
    async list() {
      const records = await (await db()).getAll('days');
      return records.map(readRecord).filter((record): record is SpendRecord => record !== null);
    },
    async merge(records) {
      if (records.length === 0) return false;
      const tx = (await db()).transaction('days', 'readwrite', DURABLE);
      let changed = false;
      for (const record of records) {
        const key = recordKey(record);
        if (!isNewer(record, readRecord(await tx.store.get(key)))) continue;
        await tx.store.put(record, key);
        changed = true;
      }
      await tx.done;
      return changed;
    },
  };
}

/** The same in memory: for the fakes, and a device whose storage refuses IndexedDB (the counts last the page's life). */
export function createMemorySpendStore(seed: readonly SpendRecord[] = []): SpendStore {
  const records = new Map(seed.map((record) => [recordKey(record), { ...record }]));
  return {
    async add(delta) {
      const key = recordKey(delta);
      const record = addRecords(records.get(key), delta);
      records.set(key, record);
      return { ...record };
    },
    async list() {
      return [...records.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, record]) => ({ ...record }));
    },
    async merge(incoming) {
      let changed = false;
      for (const record of incoming) {
        const key = recordKey(record);
        if (!isNewer(record, records.get(key))) continue;
        records.set(key, { ...record });
        changed = true;
      }
      return changed;
    },
  };
}

/** Where this device's id is kept, in the device's own storage like the care counts' cache. */
export const SPEND_DEVICE_KEY = 'cafai.spend.device';

const DEVICE_ID = /^[0-9a-f]{8}$/;

/**
 * This device's id in the records (D238): 8 random characters, made once and
 * kept in `storage`. Storage that is blocked makes a new one for the page,
 * whose counts then add up as another device's would. A device moved to a
 * new origin (an iPad's Decaid update, D231) is a new device too; its old
 * records come back from Decaid's copy under the old id.
 */
export function spendDeviceId(storage: globalThis.Storage | null): string {
  try {
    const kept = storage?.getItem(SPEND_DEVICE_KEY) ?? null;
    if (kept !== null && DEVICE_ID.test(kept)) return kept;
  } catch {
    // Storage blocked: a new id below.
  }
  const id = newId().replace(/-/g, '').slice(0, 8);
  try {
    storage?.setItem(SPEND_DEVICE_KEY, id);
  } catch {
    // Kept for this page only.
  }
  return id;
}

/**
 * Machine care's steps (D189): one record per step of the cleaning guide
 * beyond Daily, in an IndexedDB database of their own, as the API key is
 * (secrets.ts).
 *
 * Why not a store in CafAI's database (db.ts): a new store there means a new
 * version of it, and IndexedDB opens no database at a version lower than the
 * one on disk. CafAI 0.1.2 opens version 1, so a tablet put back on it would
 * stop at "CafAI could not start" on every load, before it ever reached
 * Decaid's backup. A database of its own leaves that one as every CafAI so
 * far made it.
 *
 * Like the bags, the records are mirrored to Decaid's store (mirror.ts) and
 * travel in the export and the import (porter.ts); Storage.care hides where
 * they live.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { closeEventTarget, DURABLE, type LostReason } from './db.ts';
import { toStorageError } from './errors.ts';
import { byId } from './repositories.ts';
import type { CareRecord, CareRepository } from './types.ts';

export const CARE_DB_NAME = 'cafai-care';
const CARE_DB_VERSION = 1;

export interface CareDbSchema extends DBSchema {
  /** By the step's id. */
  care: { key: string; value: CareRecord };
}

export type CareDb = IDBPDatabase<CareDbSchema>;

export function openCareDb(name = CARE_DB_NAME, onLost?: (reason: LostReason) => void): Promise<CareDb> {
  return openDB<CareDbSchema>(name, CARE_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('care', { keyPath: 'id' });
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

export interface CareRepositoryDeps {
  db: () => Promise<CareDb>;
  /** Called after every committed write: the mirror's schedulePush. */
  onWrite: () => void;
}

/** The records as the repositories keep the others (repositories.ts): every write durable, then the mirror told. */
export function createCareRepository(deps: CareRepositoryDeps): CareRepository {
  function wrote(): void {
    try {
      deps.onWrite();
    } catch {
      // The data is committed; a mirror problem must not report it as lost.
    }
  }

  return {
    async list() {
      try {
        return (await (await deps.db()).getAll('care')).sort(byId);
      } catch (error) {
        throw toStorageError(error, 'read');
      }
    },
    async put(record) {
      try {
        const tx = (await deps.db()).transaction('care', 'readwrite', DURABLE);
        await Promise.all([tx.store.put(record), tx.done]);
      } catch (error) {
        throw toStorageError(error, 'write');
      }
      wrote();
    },
  };
}

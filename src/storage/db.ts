/**
 * CafAI's IndexedDB database: the primary store for bags, profile versions,
 * iterations, conversations, settings and machine care's steps.
 *
 * Decaid serves the skin from a stable per-skin origin, so this database
 * survives restarts and same-id updates. It can still be hidden (temporary
 * fallback origin, changed app-data path), which is why the non-secret data is
 * also mirrored to Decaid's key-value store (mirror.ts). The API key is not
 * here at all: it lives in its own database (secrets.ts).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Bag, CareRecord, ConversationRecord, IterationRecord, ProfileVersion, Settings } from './types.ts';
import { StorageError, toStorageError } from './errors.ts';

export const CAFAI_DB_NAME = 'cafai';
/** 2: the care store (D189). */
export const CAFAI_DB_VERSION = 2;
/** The settings store holds exactly one record, under this key. */
export const SETTINGS_KEY = 'current';

export interface CafaiDbSchema extends DBSchema {
  bags: { key: string; value: Bag };
  versions: { key: string; value: ProfileVersion; indexes: { bagId: string } };
  iterations: { key: string; value: IterationRecord; indexes: { bagId: string; createdAt: string } };
  conversations: { key: string; value: ConversationRecord };
  settings: { key: string; value: Settings };
  /** Machine care's steps, by the step's id (D189). */
  care: { key: string; value: CareRecord };
}

export type CafaiDb = IDBPDatabase<CafaiDbSchema>;

export const DATA_STORES = ['bags', 'versions', 'iterations', 'conversations', 'settings', 'care'] as const;

/**
 * Every write waits for the data to reach disk before it resolves. Writes are
 * a few per user action, and the WebView can be killed at any moment after ten
 * minutes in the background, so the extra flush is worth it.
 */
export const DURABLE = { durability: 'strict' } as const;

/**
 * Why an open connection went away:
 * `upgraded` - a newer CafAI opened the database with a higher version;
 * `deleted` - the database was deleted (site data cleared);
 * `terminated` - the browser closed the connection abnormally.
 */
export type LostReason = 'upgraded' | 'deleted' | 'terminated';

export function openCafaiDb(name = CAFAI_DB_NAME, onLost?: (reason: LostReason) => void): Promise<CafaiDb> {
  return openDB<CafaiDbSchema>(name, CAFAI_DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('bags', { keyPath: 'id' });
        db.createObjectStore('versions', { keyPath: 'id' }).createIndex('bagId', 'bagId');
        const iterations = db.createObjectStore('iterations', { keyPath: 'id' });
        iterations.createIndex('bagId', 'bagId');
        iterations.createIndex('createdAt', 'createdAt');
        db.createObjectStore('conversations', { keyPath: 'id' });
        db.createObjectStore('settings');
      }
      // Only adds a store: everything a version-1 database holds stays as it was.
      if (oldVersion < 2) db.createObjectStore('care', { keyPath: 'id' });
    },
    // Nothing of ours to close here: the older connection belongs to another
    // window, whose own `blocking` handler below closes it, and then this open
    // completes on its own.
    blocked() {},
    blocking(_currentVersion, blockedVersion, event) {
      closeEventTarget(event);
      onLost?.(blockedVersion === null ? 'deleted' : 'upgraded');
    },
    terminated() {
      onLost?.('terminated');
    },
  });
}

/** A connection that must not stand in the way of an upgrade or a delete. */
export function closeEventTarget(event: Event): void {
  const target = event.target as { close?: () => void } | null;
  target?.close?.();
}

/** Read every data store in one transaction, so the result is consistent. */
export async function readAll(db: CafaiDb): Promise<{
  settings: unknown;
  bags: Bag[];
  versions: ProfileVersion[];
  iterations: IterationRecord[];
  conversations: ConversationRecord[];
  care: CareRecord[];
}> {
  const tx = db.transaction(DATA_STORES, 'readonly');
  const [settings, bags, versions, iterations, conversations, care] = await Promise.all([
    tx.objectStore('settings').get(SETTINGS_KEY),
    tx.objectStore('bags').getAll(),
    tx.objectStore('versions').getAll(),
    tx.objectStore('iterations').getAll(),
    tx.objectStore('conversations').getAll(),
    tx.objectStore('care').getAll(),
    tx.done,
  ]);
  return { settings, bags, versions, iterations, conversations, care };
}

export interface DbHandle<T> {
  /** The open connection; opened on first use and reopened after the browser dropped it. */
  get(): Promise<T>;
  close(): void;
}

/**
 * Lazily (re)opening access to a database.
 *
 * A connection closed by the browser is simply reopened. One closed because a
 * newer CafAI upgraded the schema is not: reopening at the old version fails,
 * and this page's code no longer matches the data, so the user is asked to
 * reload instead.
 */
export function createDbHandle<T extends { close(): void }>(
  open: (onLost: (reason: LostReason) => void) => Promise<T>,
): DbHandle<T> {
  let current: Promise<T> | null = null;
  let superseded = false;
  let closed = false;

  return {
    get() {
      if (superseded) return Promise.reject(new StorageError('superseded'));
      if (closed) return Promise.reject(new StorageError('unavailable', 'CafAI closed its storage. Reload the page.'));
      if (current === null) {
        const attempt: Promise<T> = open((reason) => {
          if (reason === 'upgraded') superseded = true;
          if (current === attempt) current = null;
        }).catch((error: unknown) => {
          if (current === attempt) current = null;
          throw toStorageError(error, 'unavailable');
        });
        current = attempt;
      }
      return current;
    },
    close() {
      closed = true;
      const pending = current;
      current = null;
      void pending?.then(
        (db) => db.close(),
        () => undefined,
      );
    },
  };
}

/**
 * Ask the browser not to evict this origin's storage under pressure.
 * Best effort: WebViews may refuse silently, and nothing waits on the answer.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : (navigator.storage as StorageManager | undefined);
    if (!storage || typeof storage.persist !== 'function') return false;
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}


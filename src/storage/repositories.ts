/**
 * IndexedDB implementations of the repository interfaces.
 *
 * Persist immediately: every write resolves only after its transaction has
 * committed, because the WebView is unloaded after ten minutes in the
 * background and nothing may wait for unload. Records are stored exactly as
 * given (the engine owns `updatedAt`). After each committed write the mirror
 * is asked for a debounced push to Decaid; a failing mirror never turns a
 * committed write into an error.
 */
import { DURABLE, SETTINGS_KEY, type CafaiDb, type CafaiDbSchema } from './db.ts';
import { toStorageError } from './errors.ts';
import { applySettingsPatch, normalizeSettings } from './settings.ts';
import type {
  BagRepository,
  CareRepository,
  ConversationRepository,
  IterationRepository,
  SettingsRepository,
  VersionRepository,
} from './types.ts';

export interface RepositoryDeps {
  db: () => Promise<CafaiDb>;
  /** Called after every committed write: the mirror's schedulePush. */
  onWrite: () => void;
  defaultModel: string;
}

export interface Repositories {
  bags: BagRepository;
  versions: VersionRepository;
  iterations: IterationRepository;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  care: CareRepository;
}

type RecordStore = 'bags' | 'versions' | 'iterations' | 'conversations' | 'care';

/** Oldest first; the id breaks ties so the order never depends on the store. */
export function byCreatedAt<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** By id: machine care's records, one per step (D-CARE-7). */
export function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function createRepositories(deps: RepositoryDeps): Repositories {
  async function read<T>(run: (db: CafaiDb) => Promise<T>): Promise<T> {
    try {
      return await run(await deps.db());
    } catch (error) {
      throw toStorageError(error, 'read');
    }
  }

  async function write<T>(run: (db: CafaiDb) => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await run(await deps.db());
    } catch (error) {
      throw toStorageError(error, 'write');
    }
    try {
      deps.onWrite();
    } catch {
      // The data is committed; a mirror problem must not report it as lost.
    }
    return result;
  }

  function put<N extends RecordStore>(store: N, value: CafaiDbSchema[N]['value']): Promise<void> {
    return write(async (db) => {
      const tx = db.transaction(store, 'readwrite', DURABLE);
      await Promise.all([tx.store.put(value), tx.done]);
    });
  }

  return {
    bags: {
      list: () => read(async (db) => (await db.getAll('bags')).sort(byCreatedAt)),
      get: (id) => read((db) => db.get('bags', id)),
      put: (bag) => put('bags', bag),
    },
    versions: {
      listByBag: (bagId) =>
        read(async (db) =>
          (await db.getAllFromIndex('versions', 'bagId', bagId)).sort((a, b) => a.version - b.version || byCreatedAt(a, b)),
        ),
      get: (id) => read((db) => db.get('versions', id)),
      put: (version) => put('versions', version),
    },
    iterations: {
      listByBag: (bagId) => read(async (db) => (await db.getAllFromIndex('iterations', 'bagId', bagId)).sort(byCreatedAt)),
      // A plain getAll rather than the createdAt index: a record with a
      // malformed createdAt would be missing from the index and so vanish from
      // this list while still showing up per bag.
      listAll: () => read(async (db) => (await db.getAll('iterations')).sort(byCreatedAt)),
      get: (id) => read((db) => db.get('iterations', id)),
      put: (record) => put('iterations', record),
    },
    conversations: {
      get: (id) => read((db) => db.get('conversations', id)),
      put: (conversation) => put('conversations', conversation),
    },
    settings: {
      get: () => read(async (db) => normalizeSettings(await db.get('settings', SETTINGS_KEY), deps.defaultModel)),
      // Read and write in one transaction, so concurrent patches queue up
      // instead of overwriting each other.
      update: (patch) =>
        write(async (db) => {
          const tx = db.transaction('settings', 'readwrite', DURABLE);
          const current = normalizeSettings(await tx.store.get(SETTINGS_KEY), deps.defaultModel);
          const next = applySettingsPatch(current, patch, deps.defaultModel);
          await Promise.all([tx.store.put(next, SETTINGS_KEY), tx.done]);
          return next;
        }),
    },
    care: {
      list: () => read(async (db) => (await db.getAll('care')).sort(byId)),
      put: (record) => put('care', record),
    },
  };
}

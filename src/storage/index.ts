/**
 * CafAI storage: IndexedDB as the primary store, the API key in its own
 * local-only database, JSON export/import, and a debounced mirror of the
 * non-secret data to Decaid's key-value store (namespace `cafai`).
 *
 * Start-up, for the app shell:
 *   const storage = await createIdbStorage({ kv: decaid.kv, appVersion, defaultModel });
 *   await restoreFromMirrorIfEmpty(storage);   // never throws
 */
import type { KvClient } from '../api/types.ts';
import { CAFAI_DB_NAME, createDbHandle, openCafaiDb, readAll, requestPersistentStorage } from './db.ts';
import { toStorageError } from './errors.ts';
import { createKeyBackup } from './keyBackup.ts';
import { DecaidKvMirror } from './mirror.ts';
import { createDataPorter, ImportError } from './porter.ts';
import { createRepositories } from './repositories.ts';
import { openSecretStore, SECRETS_DB_NAME } from './secrets.ts';
import type { Storage } from './types.ts';

export interface CreateIdbStorageOptions {
  /** Decaid's key-value client (DecaidClient.kv). */
  kv: KvClient;
  appVersion: string;
  /** The model a fresh install starts with (src/llm/models.ts). */
  defaultModel: string;
  /** IndexedDB name for CafAI's data; tests use a unique one. */
  dbName?: string;
  /** IndexedDB name for the API key. */
  secretsDbName?: string;
  now?: () => Date;
  /** Mirror debounce, default 2000 ms. */
  debounceMs?: number;
}

export interface IdbStorage extends Storage {
  /** The mirror, with diagnostics (lastError, lastPushAt) beyond the KvMirror contract. */
  readonly mirror: DecaidKvMirror;
  /** Stop the mirror's timers and close both databases. */
  close(): void;
}

/**
 * Open (creating on first use) CafAI's databases and wire the repositories,
 * secret store, porter and mirror. Rejects with a StorageError sentence when
 * the browser blocks IndexedDB.
 */
export async function createIdbStorage(options: CreateIdbStorageOptions): Promise<IdbStorage> {
  const { kv, appVersion, defaultModel } = options;
  const now = options.now ?? (() => new Date());
  const dbName = options.dbName ?? CAFAI_DB_NAME;
  const handle = createDbHandle((onLost) => openCafaiDb(dbName, onLost));
  const db = () => handle.get();

  let startedEmpty: boolean;
  try {
    startedEmpty = (await (await db()).count('bags')) === 0;
  } catch (error) {
    handle.close();
    throw toStorageError(error, 'unavailable');
  }
  let secrets: Awaited<ReturnType<typeof openSecretStore>>;
  try {
    secrets = await openSecretStore(options.secretsDbName ?? SECRETS_DB_NAME);
  } catch (error) {
    handle.close();
    throw error;
  }
  void requestPersistentStorage();

  const mirror = new DecaidKvMirror({
    kv,
    appVersion,
    defaultModel,
    now,
    debounceMs: options.debounceMs,
    source: {
      read: async () => readAll(await db()),
      apiKey: () => secrets.getApiKey(),
    },
  });
  const repositories = createRepositories({ db, defaultModel, onWrite: () => mirror.schedulePush() });
  const porter = createDataPorter({ db, secrets, mirror, appVersion, defaultModel, now });
  const keyBackup = createKeyBackup(kv, secrets);

  // A store that started this session empty (first run, or browser storage
  // lost) must not overwrite a backup it has not seen: if the start-up
  // restore could not read Decaid, the first push merges the backup in before
  // writing anything, and waits (retrying) while Decaid stays unreadable.
  if (startedEmpty) {
    mirror.setGate(async () => {
      const remote = await mirror.pull();
      if (remote === null) return;
      try {
        await porter.importAll(remote, 'merge');
      } catch (error) {
        // A backup this version cannot read is no backup; do not block on it.
        if (!(error instanceof ImportError)) throw error;
      }
    });
  }

  return {
    ...repositories,
    secrets,
    porter,
    mirror,
    keyBackup,
    close() {
      mirror.dispose();
      handle.close();
      secrets.close();
    },
  };
}

/**
 * When this device has no bags and Decaid holds a backup, merge it in
 * (Crema's rule: fill blanks, never overwrite local). Resolves true when
 * records were restored. Never throws: a failed restore must not stop start-up.
 */
export async function restoreFromMirrorIfEmpty(storage: Storage): Promise<boolean> {
  try {
    if ((await storage.bags.list()).length > 0) return false;
    const remote = await storage.mirror.pull();
    if (remote === null) return false;
    const { imported } = await storage.porter.importAll(remote, 'merge');
    return imported > 0;
  } catch {
    return false;
  }
}

export { createDbHandle, openCafaiDb, CAFAI_DB_NAME } from './db.ts';
export { StorageError, STORAGE_MESSAGES, type StorageErrorKind } from './errors.ts';
export {
  conversationKey,
  DecaidKvMirror,
  KV_NAMESPACE,
  type MirrorMeta,
  type MirrorSnapshot,
  type MirrorSource,
} from './mirror.ts';
export { exportFileName, ImportError, IMPORT_MESSAGES, parseCafaiExport, serializeExport } from './porter.ts';
export { isReady, redactSecret, SECRETS_DB_NAME } from './secrets.ts';
export { DEFAULT_APPEARANCE, defaultSettings, normalizeAppearance, sameAppearance } from './settings.ts';
export type { Appearance, AppearanceMode } from './types.ts';

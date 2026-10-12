/**
 * CafAI storage: IndexedDB as the primary store, the API key in its own
 * local-only database, JSON export/import, and a debounced mirror of the
 * non-secret data to Decaid's key-value store (namespace `cafai`).
 *
 * Start-up, for the app shell:
 *   const storage = await createIdbStorage({ kv: decaid.kv, appVersion, defaultModel });
 *   const restore = await restoreFromMirrorIfEmpty(storage);   // never throws
 *   if (restore === 'unreachable') startLateRestore(storage, { onRestored });
 */
import { GatewayError, type KvClient } from '../api/types.ts';
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
  /**
   * Calls `listener` when the first push of a store that started empty merged
   * records from Decaid's backup in (5.4): they came back after start, so the
   * screens read them again. Returns the unsubscribe.
   */
  onRestored(listener: () => void): () => void;
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
  const keyBackup = createKeyBackup(kv, secrets, secrets.keyCopy);
  const restoredListeners = new Set<() => void>();

  // A store that started this session empty (first run, or browser storage
  // lost) must not overwrite a backup it has not seen: if the start-up
  // restore could not read Decaid, the first push merges the backup in before
  // writing anything, and waits (retrying) while Decaid does not answer or
  // answers something CafAI cannot read (never taken for an empty backup).
  if (startedEmpty) {
    mirror.setGate(async () => {
      const remote = await mirror.pull();
      if (remote === null) return;
      let imported = 0;
      try {
        imported = (await porter.importAll(remote, 'merge')).imported;
      } catch (error) {
        // A backup this version cannot read is no backup; do not block on it.
        if (!(error instanceof ImportError)) throw error;
      }
      if (imported > 0) for (const listener of [...restoredListeners]) listener();
    });
  }

  return {
    ...repositories,
    secrets,
    porter,
    mirror,
    keyBackup,
    onRestored(listener) {
      restoredListeners.add(listener);
      return () => void restoredListeners.delete(listener);
    },
    close() {
      mirror.dispose();
      handle.close();
      secrets.close();
    },
  };
}

/**
 * What a restore from Decaid's backup found (5.3, 5.4):
 * - `restored`: records came back;
 * - `nothing`: nothing to restore (this device has bags, Decaid holds no
 *   backup, or nothing in it is new here);
 * - `unreachable`: Decaid did not answer (no answer, a timeout, busy), so it
 *   is worth trying again;
 * - `unreadable`: Decaid answered something CafAI cannot read (the reader
 *   reported it as drift); never taken for an empty backup.
 */
export type RestoreResult = 'restored' | 'nothing' | 'unreachable' | 'unreadable';

function restoreFailure(error: unknown): 'unreachable' | 'unreadable' {
  if (!(error instanceof GatewayError)) return 'unreadable';
  if (error.code === 'network' || error.code === 'timeout') return 'unreachable';
  return error.status >= 500 || error.status === 408 || error.status === 429 ? 'unreachable' : 'unreadable';
}

/**
 * Merge Decaid's backup in (Crema's rule: fill blanks, never overwrite newer
 * records here). Never throws: a failed restore must not stop start-up.
 */
export async function restoreFromMirror(storage: Storage): Promise<RestoreResult> {
  try {
    const remote = await storage.mirror.pull();
    if (remote === null) return 'nothing';
    const { imported } = await storage.porter.importAll(remote, 'merge');
    return imported > 0 ? 'restored' : 'nothing';
  } catch (error) {
    // A backup this version cannot read is no backup, as for the first push.
    return error instanceof ImportError ? 'nothing' : restoreFailure(error);
  }
}

/** At start-up: when this device has no bags, merge Decaid's backup in. Never throws. */
export async function restoreFromMirrorIfEmpty(storage: Storage): Promise<RestoreResult> {
  try {
    if ((await storage.bags.list()).length > 0) return 'nothing';
  } catch (error) {
    return restoreFailure(error);
  }
  return restoreFromMirror(storage);
}

/** Timers for the late restore (the browser's by default). */
export interface RestoreTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The late restore tries 2 s after start, doubling to every 30 s, for 10 minutes. */
export const LATE_RESTORE_FIRST_MS = 2000;
export const LATE_RESTORE_MAX_MS = 30_000;
export const LATE_RESTORE_FOR_MS = 10 * 60_000;

export interface LateRestoreOptions {
  /** Records came back (`records`), or the API key from its copy in Decaid (`key`). */
  onRestored(restored: { records: boolean; key: boolean }): void;
  timers?: RestoreTimers;
  now?: () => number;
}

export interface LateRestore {
  /** Try now, unless a try is running: Decaid may be back (the machine connected, the page is in view again). */
  retryNow(): void;
  /** Resolves when no try is running. */
  settled(): Promise<void>;
  stop(): void;
}

const browserTimers: RestoreTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * After a start-up restore that could not reach Decaid (D100): Decaid may
 * still be starting (after an update, say), so keep trying its backup until
 * records come back or Decaid says it holds none. The tries run on a timer
 * for 10 minutes and whenever `retryNow` says Decaid may be back. Each try
 * also sends what the API key's copy in Decaid is owed and brings the key
 * back from it, unless the key was forgotten on this device (D99). The store
 * started empty, so a try merges the backup in even if a bag was started
 * meanwhile: a merge fills blanks only.
 */
export function startLateRestore(storage: Storage, options: LateRestoreOptions): LateRestore {
  const timers = options.timers ?? browserTimers;
  const now = options.now ?? (() => Date.now());
  const until = now() + LATE_RESTORE_FOR_MS;
  let delay = LATE_RESTORE_FIRST_MS;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let done = false;

  function schedule(): void {
    if (done || timer !== null || now() >= until) return;
    timer = timers.setTimeout(() => {
      timer = null;
      attempt();
    }, delay);
    delay = Math.min(delay * 2, LATE_RESTORE_MAX_MS);
  }

  async function tryOnce(): Promise<void> {
    const [records, key] = await Promise.all([
      restoreFromMirror(storage),
      storage.keyBackup.restoreIfMissing().catch(() => false),
    ]);
    if (done) return;
    if (records === 'restored' || records === 'nothing') done = true;
    if (records === 'restored' || key) options.onRestored({ records: records === 'restored', key });
    schedule();
  }

  function attempt(): void {
    if (done || running) return;
    running = tryOnce().finally(() => {
      running = null;
    });
  }

  schedule();
  return {
    retryNow() {
      if (done || running) return;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      attempt();
    },
    settled: () => running ?? Promise.resolve(),
    stop() {
      done = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
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

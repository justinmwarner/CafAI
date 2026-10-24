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
import { CARE_DB_NAME, createCareRepository, openCareDb } from './careDb.ts';
import type { CoachSourceBackup } from './coachSourceBackup.ts';
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
  /** IndexedDB name for machine care's steps (D189). */
  careDbName?: string;
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
   * screens read them again. `records`: bags, versions, iterations or chats
   * came back; false when machine care's last times alone did (D189), which
   * are no bags to announce. Returns the unsubscribe.
   */
  onRestored(listener: (restored: { records: boolean }) => void): () => void;
  /** Stop the mirror's timers and close the databases. */
  close(): void;
}

/**
 * Open (creating on first use) CafAI's databases and wire the repositories,
 * secret store, porter and mirror. Rejects with a StorageError sentence when
 * the browser blocks IndexedDB, or when a database was saved by a newer
 * CafAI than this one.
 */
export async function createIdbStorage(options: CreateIdbStorageOptions): Promise<IdbStorage> {
  const { kv, appVersion, defaultModel } = options;
  const now = options.now ?? (() => new Date());
  const dbName = options.dbName ?? CAFAI_DB_NAME;
  const careDbName = options.careDbName ?? CARE_DB_NAME;
  const handle = createDbHandle((onLost) => openCafaiDb(dbName, onLost));
  const careHandle = createDbHandle((onLost) => openCareDb(careDbName, onLost));
  const db = () => handle.get();
  const careDb = () => careHandle.get();
  const closeDbs = () => {
    handle.close();
    careHandle.close();
  };

  let startedEmpty: boolean;
  try {
    startedEmpty = (await (await db()).count('bags')) === 0;
    // At start-up, not at the first count, as the key's: machine care's steps must open too.
    await careDb();
  } catch (error) {
    closeDbs();
    throw toStorageError(error, 'unavailable');
  }
  let secrets: Awaited<ReturnType<typeof openSecretStore>>;
  try {
    secrets = await openSecretStore(options.secretsDbName ?? SECRETS_DB_NAME);
  } catch (error) {
    closeDbs();
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
      read: async () => ({ ...(await readAll(await db())), care: await (await careDb()).getAll('care') }),
      apiKey: () => secrets.getApiKey(),
    },
  });
  const repositories = createRepositories({ db, defaultModel, onWrite: () => mirror.schedulePush() });
  const care = createCareRepository({ db: careDb, onWrite: () => mirror.schedulePush() });
  const porter = createDataPorter({ db, careDb, secrets, mirror, appVersion, defaultModel, now });
  const keyBackup = createKeyBackup(kv, secrets, secrets.keyCopy);
  const restoredListeners = new Set<(restored: { records: boolean }) => void>();

  // A store that started this session empty (first run, or browser storage
  // lost) must not overwrite a backup it has not seen: if the start-up
  // restore could not read Decaid, the first push merges the backup in before
  // writing anything, and waits (retrying) while Decaid does not answer or
  // answers something CafAI cannot read (never taken for an empty backup).
  if (startedEmpty) {
    mirror.setGate(async () => {
      const remote = await mirror.pull();
      if (remote === null) return;
      let merged = { imported: 0, care: 0 };
      try {
        merged = await porter.importAll(remote, 'merge');
      } catch (error) {
        // A backup this version cannot read is no backup; do not block on it.
        if (!(error instanceof ImportError)) throw error;
      }
      const restored = { records: merged.imported > merged.care };
      if (merged.imported > 0) for (const listener of [...restoredListeners]) listener(restored);
    });
  }

  return {
    ...repositories,
    care,
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
      closeDbs();
      secrets.close();
    },
  };
}

/**
 * What a restore from Decaid's backup found (5.3, 5.4):
 * - `restored`: records came back: bags, versions, iterations or chats
 *   (machine care's last times with them, maybe);
 * - `care`: machine care's last times came back, and nothing else (D189):
 *   the device's first look was backed up, say, before any bag. No bags to
 *   say are back;
 * - `nothing`: nothing to restore (this device has bags, Decaid holds no
 *   backup, or nothing in it is new here);
 * - `unreachable`: Decaid did not answer (no answer, a timeout, busy), so it
 *   is worth trying again;
 * - `unreadable`: Decaid answered something CafAI cannot read (the reader
 *   reported it as drift); never taken for an empty backup.
 */
export type RestoreResult = 'restored' | 'care' | 'nothing' | 'unreachable' | 'unreadable';

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
    const { imported, care } = await storage.porter.importAll(remote, 'merge');
    if (imported > care) return 'restored';
    return care > 0 ? 'care' : 'nothing';
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
  /**
   * Records came back (`records`: bags, versions, iterations or chats),
   * machine care's last times alone (`care`), the API key from its copy in
   * Decaid (`key`), or where the coach runs from its own (`coachSource`).
   */
  onRestored(restored: { records: boolean; care: boolean; key: boolean; coachSource: boolean }): void;
  /**
   * Where the coach runs, copied in Decaid (D229): each try brings it back,
   * and once Decaid's backup has come back, which may bring back the choice
   * to keep it there (D230), syncs it. Absent when this device's storage
   * refused the source.
   */
  coachSource?: Pick<CoachSourceBackup, 'restoreIfMissing' | 'sync'>;
  timers?: RestoreTimers;
  now?: () => number;
}

export interface LateRestore {
  /** Try now, unless a try is running: Decaid may be back (the machine connected, the page is in view again). */
  retryNow(): void;
  /** True until a try has found Decaid's backup (records, machine care's alone, or none), or stop(). */
  pending(): boolean;
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
 * back from it, unless the key was forgotten on this device (D99), and brings
 * where the coach runs back from its copy (D229); only once a try has found
 * the backup, whose settings may say that copy was turned off before a move,
 * does it sync that copy (D230). The store started empty, so a try merges the
 * backup in even if a bag was started meanwhile: a merge fills blanks only.
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
    const [records, key] = await Promise.all([restoreFromMirror(storage), storage.keyBackup.restoreIfMissing().catch(() => false)]);
    const found = records === 'restored' || records === 'care' || records === 'nothing';
    // After the backup, whose settings may say the copy was turned off before a move (D230).
    const source = options.coachSource;
    const coachSource = source ? await (found ? source.sync() : source.restoreIfMissing()).catch(() => false) : false;
    if (done) return;
    if (found) done = true;
    if (records === 'restored' || records === 'care' || key || coachSource) {
      options.onRestored({ records: records === 'restored', care: records === 'care', key, coachSource });
    }
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
    pending: () => !done,
    settled: () => running ?? Promise.resolve(),
    stop() {
      done = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

export { createDbHandle, openCafaiDb, CAFAI_DB_NAME } from './db.ts';
export { CARE_DB_NAME } from './careDb.ts';
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

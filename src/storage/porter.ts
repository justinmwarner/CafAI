/**
 * JSON export and import of everything CafAI stores, except the API key.
 *
 * The export is the user's own backup and the way to move to another device,
 * so it holds the full records (series included). An import is validated
 * completely before anything is written, and then written in one transaction:
 * a damaged file or a failed write leaves the database exactly as it was.
 *
 *   replace - clear the data stores and write the file's records and settings.
 *   merge   - add records missing here, take records whose updatedAt (for
 *             profile versions, createdAt) is newer than ours, and fill blank
 *             settings; whatever is newer here stays. A care step's record
 *             goes by its last time instead (careRecordWins, D-CARE-7).
 *
 * Neither touches the API key: it lives in a separate database this module
 * never opens. The export only reads the key to blank it out wherever a user
 * pasted it into their data.
 */
import type { IDBPTransaction } from 'idb';
import { DATA_STORES, DURABLE, readAll, SETTINGS_KEY, type CafaiDb, type CafaiDbSchema } from './db.ts';
import { toStorageError } from './errors.ts';
import { byCreatedAt, byId } from './repositories.ts';
import { describePath, ExportSchema } from './schema.ts';
import { redactSecret } from './secrets.ts';
import { fillBlankSettings, normalizeSettings } from './settings.ts';
import type { CafaiExport, CareRecord, DataPorter, SecretStore } from './types.ts';

export const IMPORT_MESSAGES = {
  notAnExport: 'This is not a CafAI export file.',
  newerVersion: 'This file comes from a newer version of CafAI. Update CafAI, then import it again.',
  damaged: (where: string) => `This CafAI export file is damaged, so nothing was imported (the problem is at ${where}).`,
} as const;

/** A file that cannot be imported; `message` says why in one sentence. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface PorterDeps {
  db: () => Promise<CafaiDb>;
  /** Read only to keep the key out of exports. */
  secrets: Pick<SecretStore, 'getApiKey'>;
  mirror: { schedulePush(): void; noteReplaced?(): void };
  appVersion: string;
  defaultModel: string;
  now: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate an export (the parsed object, or its JSON text). Throws ImportError
 * with a sentence for the user; returns the records as they will be stored.
 */
export function parseCafaiExport(data: unknown): CafaiExport {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new ImportError(IMPORT_MESSAGES.notAnExport);
    }
  }
  if (!isRecord(value) || value['format'] !== 'cafai-export') throw new ImportError(IMPORT_MESSAGES.notAnExport);
  const version = value['schemaVersion'];
  if (version !== 1) {
    throw new ImportError(typeof version === 'number' && version > 1 ? IMPORT_MESSAGES.newerVersion : IMPORT_MESSAGES.notAnExport);
  }
  const result = ExportSchema.safeParse(value);
  if (!result.success) throw new ImportError(IMPORT_MESSAGES.damaged(describePath(result.error.issues[0]?.path ?? [])));
  return result.data;
}

/** Pretty JSON, for a file a person might open. */
export function serializeExport(data: CafaiExport): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** `cafai-export-2026-10-03.json`, in the user's local date. */
export function exportFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `cafai-export-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

function redactValue<T>(value: T, secret: string | null): T {
  if (!secret) return value;
  const json = JSON.stringify(value);
  const redacted = redactSecret(json, secret);
  return redacted === json ? value : (JSON.parse(redacted) as T);
}

/** Is `incoming` strictly newer than `local`? A record without a usable stamp here loses. */
function isNewer(incoming: unknown, local: unknown): boolean {
  if (typeof local !== 'string') return true;
  if (typeof incoming !== 'string') return false;
  const a = Date.parse(incoming);
  const b = Date.parse(local);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a > b;
  return incoming > local;
}

type WriteTx = IDBPTransaction<CafaiDbSchema, typeof DATA_STORES, 'readwrite'>;

/**
 * Run the import's writes in one transaction. A write can throw synchronously
 * (an uncloneable value); IndexedDB does not abort the transaction for that,
 * so abort it here, or the clears of a replace would commit on their own.
 */
async function inOneTransaction(db: CafaiDb, run: (tx: WriteTx, pending: Promise<unknown>[]) => Promise<void>): Promise<void> {
  const tx = db.transaction(DATA_STORES, 'readwrite', DURABLE);
  const pending: Promise<unknown>[] = [];
  try {
    await run(tx, pending);
  } catch (error) {
    for (const request of [...pending, tx.done]) request.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // Already finished or aborted.
    }
    throw error;
  }
  await Promise.all([...pending, tx.done]);
}

async function replaceAll(db: CafaiDb, data: CafaiExport, defaultModel: string): Promise<number> {
  const care = data.care ?? [];
  await inOneTransaction(db, async (tx, pending) => {
    for (const name of DATA_STORES) pending.push(tx.objectStore(name).clear());
    for (const bag of data.bags) pending.push(tx.objectStore('bags').put(bag));
    for (const version of data.versions) pending.push(tx.objectStore('versions').put(version));
    for (const record of data.iterations) pending.push(tx.objectStore('iterations').put(record));
    for (const conversation of data.conversations) pending.push(tx.objectStore('conversations').put(conversation));
    for (const record of care) pending.push(tx.objectStore('care').put(record));
    pending.push(tx.objectStore('settings').put(normalizeSettings(data.settings, defaultModel), SETTINGS_KEY));
  });
  return data.bags.length + data.versions.length + data.iterations.length + data.conversations.length + care.length;
}

/**
 * Whether an incoming care record should replace this device's (D-CARE-7):
 * the later last done wins, a done one wins over one never done, and of two
 * never done the earlier start, from which the count is truer. updatedAt
 * cannot decide: a device that lost its storage starts counting afresh, and
 * its new records must not outrank the ones a backup brings back.
 */
export function careRecordWins(incoming: CareRecord, local: CareRecord): boolean {
  if (incoming.doneAt !== null && local.doneAt !== null) return isNewer(incoming.doneAt, local.doneAt);
  if (incoming.doneAt !== null || local.doneAt !== null) return incoming.doneAt !== null;
  return isNewer(local.countFrom, incoming.countFrom);
}

interface KeyedStore<T> {
  get(key: string): Promise<T | undefined>;
  put(value: T): Promise<unknown>;
}

async function putIfNewer<T extends { id: string }>(store: KeyedStore<T>, record: T, stamp: (r: T) => unknown): Promise<boolean> {
  const local = await store.get(record.id);
  if (local !== undefined && !isNewer(stamp(record), stamp(local))) return false;
  await store.put(record);
  return true;
}

async function mergeAll(db: CafaiDb, data: CafaiExport, defaultModel: string): Promise<number> {
  let imported = 0;
  await inOneTransaction(db, async (tx) => {
    const count = (written: boolean) => {
      if (written) imported += 1;
    };
    for (const bag of data.bags) count(await putIfNewer(tx.objectStore('bags'), bag, (r) => r.updatedAt));
    for (const version of data.versions) count(await putIfNewer(tx.objectStore('versions'), version, (r) => r.createdAt));
    for (const record of data.iterations) count(await putIfNewer(tx.objectStore('iterations'), record, (r) => r.updatedAt));
    for (const conversation of data.conversations) {
      count(await putIfNewer(tx.objectStore('conversations'), conversation, (r) => r.updatedAt));
    }
    const care = tx.objectStore('care');
    for (const record of data.care ?? []) {
      const local = await care.get(record.id);
      if (local !== undefined && !careRecordWins(record, local)) continue;
      await care.put(record);
      count(true);
    }
    const settings = tx.objectStore('settings');
    const local = normalizeSettings(await settings.get(SETTINGS_KEY), defaultModel);
    const merged = fillBlankSettings(local, normalizeSettings(data.settings, defaultModel), defaultModel);
    if (JSON.stringify(merged) !== JSON.stringify(local)) await settings.put(merged, SETTINGS_KEY);
  });
  return imported;
}

export function createDataPorter(deps: PorterDeps): DataPorter {
  return {
    async exportAll() {
      let stored: Awaited<ReturnType<typeof readAll>>;
      try {
        stored = await readAll(await deps.db());
      } catch (error) {
        throw toStorageError(error, 'read');
      }
      const data: CafaiExport = {
        format: 'cafai-export',
        schemaVersion: 1,
        exportedAt: deps.now().toISOString(),
        appVersion: deps.appVersion,
        settings: normalizeSettings(stored.settings, deps.defaultModel),
        bags: stored.bags.sort(byCreatedAt),
        versions: stored.versions.sort(byCreatedAt),
        iterations: stored.iterations.sort(byCreatedAt),
        conversations: stored.conversations.sort(byCreatedAt),
        care: stored.care.sort(byId),
      };
      // The key is not part of any record; this only catches one pasted into a
      // note or the chat. If the key cannot be read, the export still goes
      // ahead: the file stays in the user's hands.
      const apiKey = await deps.secrets.getApiKey().catch(() => null);
      return redactValue(data, apiKey);
    },

    async importAll(data, mode) {
      const incoming = parseCafaiExport(data);
      let imported: number;
      try {
        const db = await deps.db();
        imported = mode === 'replace' ? await replaceAll(db, incoming, deps.defaultModel) : await mergeAll(db, incoming, deps.defaultModel);
      } catch (error) {
        throw toStorageError(error, 'write');
      }
      if (mode === 'replace') deps.mirror.noteReplaced?.();
      deps.mirror.schedulePush();
      return { imported };
    },
  };
}

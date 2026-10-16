/**
 * JSON export and import of everything CafAI stores, except the API key.
 *
 * The export is the user's own backup and the way to move to another device,
 * so it holds the full records (series included). An import is validated
 * completely before anything is written, and then written in one transaction
 * per database: CafAI's records and settings in one, machine care's steps
 * (their own database, careDb.ts) in a second. A damaged file leaves both
 * exactly as they were, and so does a failed write in the first; one in the
 * second leaves the care steps as they were.
 *
 *   replace - clear the data stores and write the file's records and settings.
 *   merge   - add records missing here, take records whose updatedAt (for
 *             profile versions, createdAt) is newer than ours, and fill blank
 *             settings; whatever is newer here stays. A care step's record
 *             goes by its last time instead (careRecordWins, D189).
 *
 * Neither touches the API key: it lives in a separate database this module
 * never opens. The export only reads the key to blank it out wherever a user
 * pasted it into their data.
 */
import type { CareDb } from './careDb.ts';
import { DATA_STORES, DURABLE, readAll, SETTINGS_KEY, type CafaiDb } from './db.ts';
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
  /** Machine care's own database (careDb.ts, D189). */
  careDb: () => Promise<CareDb>;
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

/**
 * Run an import's writes in one transaction. A write can throw synchronously
 * (an uncloneable value); IndexedDB does not abort the transaction for that,
 * so abort it here, or the clears of a replace would commit on their own.
 */
async function inOneTransaction<T extends { done: Promise<void>; abort(): void }>(
  tx: T,
  run: (tx: T, pending: Promise<unknown>[]) => Promise<void>,
): Promise<void> {
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
  await inOneTransaction(db.transaction(DATA_STORES, 'readwrite', DURABLE), async (tx, pending) => {
    for (const name of DATA_STORES) pending.push(tx.objectStore(name).clear());
    for (const bag of data.bags) pending.push(tx.objectStore('bags').put(bag));
    for (const version of data.versions) pending.push(tx.objectStore('versions').put(version));
    for (const record of data.iterations) pending.push(tx.objectStore('iterations').put(record));
    for (const conversation of data.conversations) pending.push(tx.objectStore('conversations').put(conversation));
    pending.push(tx.objectStore('settings').put(normalizeSettings(data.settings, defaultModel), SETTINGS_KEY));
  });
  return data.bags.length + data.versions.length + data.iterations.length + data.conversations.length;
}

/** Replace takes the file's steps, none for a file made before them (D189). */
async function replaceCare(db: CareDb, records: readonly CareRecord[]): Promise<number> {
  await inOneTransaction(db.transaction('care', 'readwrite', DURABLE), async (tx, pending) => {
    pending.push(tx.store.clear());
    for (const record of records) pending.push(tx.store.put(record));
  });
  return records.length;
}

/**
 * Whether an incoming care record should replace this device's (D189):
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
  await inOneTransaction(db.transaction(DATA_STORES, 'readwrite', DURABLE), async (tx) => {
    const count = (written: boolean) => {
      if (written) imported += 1;
    };
    for (const bag of data.bags) count(await putIfNewer(tx.objectStore('bags'), bag, (r) => r.updatedAt));
    for (const version of data.versions) count(await putIfNewer(tx.objectStore('versions'), version, (r) => r.createdAt));
    for (const record of data.iterations) count(await putIfNewer(tx.objectStore('iterations'), record, (r) => r.updatedAt));
    for (const conversation of data.conversations) {
      count(await putIfNewer(tx.objectStore('conversations'), conversation, (r) => r.updatedAt));
    }
    const settings = tx.objectStore('settings');
    const local = normalizeSettings(await settings.get(SETTINGS_KEY), defaultModel);
    const merged = fillBlankSettings(local, normalizeSettings(data.settings, defaultModel), defaultModel);
    if (JSON.stringify(merged) !== JSON.stringify(local)) await settings.put(merged, SETTINGS_KEY);
  });
  return imported;
}

/** A merge takes a step's record when it wins (careRecordWins); a file without steps leaves them as they were. */
async function mergeCare(db: CareDb, records: readonly CareRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  let imported = 0;
  await inOneTransaction(db.transaction('care', 'readwrite', DURABLE), async (tx) => {
    for (const record of records) {
      const local = await tx.store.get(record.id);
      if (local !== undefined && !careRecordWins(record, local)) continue;
      await tx.store.put(record);
      imported += 1;
    }
  });
  return imported;
}

export function createDataPorter(deps: PorterDeps): DataPorter {
  return {
    async exportAll() {
      let stored: Awaited<ReturnType<typeof readAll>>;
      let care: CareRecord[];
      try {
        stored = await readAll(await deps.db());
        care = await (await deps.careDb()).getAll('care');
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
        care: care.sort(byId),
      };
      // The key is not part of any record; this only catches one pasted into a
      // note or the chat. If the key cannot be read, the export still goes
      // ahead: the file stays in the user's hands.
      const apiKey = await deps.secrets.getApiKey().catch(() => null);
      return redactValue(data, apiKey);
    },

    async importAll(data, mode) {
      const incoming = parseCafaiExport(data);
      let records: number;
      let care: number;
      try {
        // Both open before anything is written: a care database that cannot be opened stops the import whole.
        const db = await deps.db();
        const careDb = await deps.careDb();
        if (mode === 'replace') {
          records = await replaceAll(db, incoming, deps.defaultModel);
          care = await replaceCare(careDb, incoming.care ?? []);
        } else {
          records = await mergeAll(db, incoming, deps.defaultModel);
          care = await mergeCare(careDb, incoming.care ?? []);
        }
      } catch (error) {
        throw toStorageError(error, 'write');
      }
      if (mode === 'replace') deps.mirror.noteReplaced?.();
      deps.mirror.schedulePush();
      return { imported: records + care, care };
    },
  };
}

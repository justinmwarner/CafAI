import { deleteDB, openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { CARE_DB_NAME, createCareRepository, openCareDb, type CareDb } from './careDb.ts';
import { createDbHandle, type LostReason } from './db.ts';
import { STORAGE_MESSAGES } from './errors.ts';
import { makeCareRecord, uniqueDbName } from './testing/fixtures.ts';

function setup() {
  const name = uniqueDbName('care');
  const handle = createDbHandle((onLost) => openCareDb(name, onLost));
  const writes = { count: 0 };
  const care = createCareRepository({ db: () => handle.get(), onWrite: () => void (writes.count += 1) });
  return { name, handle, writes, care };
}

/** A second, independent connection only sees committed data. */
async function readCommitted<T>(name: string, read: (db: CareDb) => Promise<T>): Promise<T> {
  const db = (await openDB(name)) as unknown as CareDb;
  try {
    return await read(db);
  } finally {
    db.close();
  }
}

describe('openCareDb (D189)', () => {
  it("is a database of its own, cafai-care, with one store of the steps by their id", async () => {
    const db = await openCareDb();
    expect(db.name).toBe(CARE_DB_NAME);
    expect(CARE_DB_NAME).toBe('cafai-care');
    expect([...db.objectStoreNames]).toEqual(['care']);
    expect(db.transaction('care').store.keyPath).toBe('id');
    db.close();
    await deleteDB(CARE_DB_NAME);
  });

  it('closes itself when a newer version wants to upgrade, or the database is deleted', { timeout: 3000 }, async () => {
    const name = uniqueDbName('care');
    const lost: LostReason[] = [];
    await openCareDb(name, (reason) => lost.push(reason));
    // Hangs (and the test times out) if the old connection stays open.
    (await openDB(name, 2)).close();
    await openCareDb(uniqueDbName('care'), (reason) => lost.push(reason)).then(async (db) => {
      await deleteDB(db.name);
    });
    expect(lost).toEqual(['upgraded', 'deleted']);
  });

  it('says one a newer CafAI saved needs that CafAI', async () => {
    const name = uniqueDbName('care');
    (await openDB(name, 2)).close();
    const handle = createDbHandle((onLost) => openCareDb(name, onLost));
    await expect(handle.get()).rejects.toMatchObject({ name: 'StorageError', kind: 'newer', message: STORAGE_MESSAGES.newer });
  });
});

describe('the care repository (D189)', () => {
  it('keeps one record per step, by its id, committed by the time put() resolves, and asks for a push', async () => {
    const { name, care, writes } = setup();
    expect(await care.list()).toEqual([]);
    await care.put(makeCareRecord({ id: 'rinza' }));
    await care.put(makeCareRecord());
    expect((await care.list()).map((record) => record.id)).toEqual(['detergent-clean', 'rinza']);
    await care.put(makeCareRecord({ doneAt: '2026-10-09T08:00:00.000Z', shotTotal: 160 }));
    expect(await readCommitted(name, (db) => db.get('care', 'detergent-clean'))).toEqual(makeCareRecord({ doneAt: '2026-10-09T08:00:00.000Z', shotTotal: 160 }));
    expect(await care.list()).toHaveLength(2);
    expect(writes.count).toBe(3);
  });

  it('says what failed in plain words, and asks for no push after a failed write', async () => {
    const writes = { count: 0 };
    const care = createCareRepository({
      db: () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')),
      onWrite: () => void (writes.count += 1),
    });
    await expect(care.put(makeCareRecord())).rejects.toMatchObject({ kind: 'quota', message: STORAGE_MESSAGES.quota });
    const unreadable = createCareRepository({ db: () => Promise.reject(new DOMException('backing store', 'UnknownError')), onWrite: () => undefined });
    await expect(unreadable.list()).rejects.toMatchObject({ kind: 'read', message: STORAGE_MESSAGES.read });
    expect(writes.count).toBe(0);
  });
});

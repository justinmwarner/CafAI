import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import {
  CAFAI_DB_VERSION,
  createDbHandle,
  openCafaiDb,
  readAll,
  requestPersistentStorage,
  SETTINGS_KEY,
  type LostReason,
} from './db.ts';
import { StorageError, STORAGE_MESSAGES, toStorageError } from './errors.ts';
import { makeBag, makeConversation, makeIteration, makeSettings, makeVersion, uniqueDbName } from './testing/fixtures.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openCafaiDb', () => {
  it('creates the five stores with their key paths and indexes', async () => {
    const db = await openCafaiDb(uniqueDbName());
    expect([...db.objectStoreNames].sort()).toEqual(['bags', 'conversations', 'iterations', 'settings', 'versions']);
    const tx = db.transaction(['bags', 'versions', 'iterations', 'conversations', 'settings']);
    expect(tx.objectStore('bags').keyPath).toBe('id');
    expect(tx.objectStore('versions').keyPath).toBe('id');
    expect([...tx.objectStore('versions').indexNames]).toEqual(['bagId']);
    expect(tx.objectStore('iterations').keyPath).toBe('id');
    expect([...tx.objectStore('iterations').indexNames].sort()).toEqual(['bagId', 'createdAt']);
    expect(tx.objectStore('conversations').keyPath).toBe('id');
    // One settings record under a fixed key, so no key path.
    expect(tx.objectStore('settings').keyPath).toBeNull();
    await tx.done;
    db.close();
  });

  it('is called cafai unless told otherwise', async () => {
    const db = await openCafaiDb();
    expect(db.name).toBe('cafai');
    db.close();
    await deleteDB('cafai');
  });

  it('closes itself when a newer version wants to upgrade, instead of blocking it', { timeout: 3000 }, async () => {
    const name = uniqueDbName();
    const lost: LostReason[] = [];
    await openCafaiDb(name, (reason) => lost.push(reason));
    // Hangs (and the test times out) if the old connection stays open.
    const newer = await openDB(name, CAFAI_DB_VERSION + 1);
    newer.close();
    expect(lost).toEqual(['upgraded']);
  });

  it('closes itself when the database is deleted', { timeout: 3000 }, async () => {
    const name = uniqueDbName();
    const lost: LostReason[] = [];
    await openCafaiDb(name, (reason) => lost.push(reason));
    await deleteDB(name);
    expect(lost).toEqual(['deleted']);
  });
});

describe('readAll', () => {
  it('reads every store in one snapshot', async () => {
    const db = await openCafaiDb(uniqueDbName());
    await db.put('bags', makeBag());
    await db.put('versions', makeVersion());
    await db.put('iterations', makeIteration());
    await db.put('conversations', makeConversation());
    await db.put('settings', makeSettings({ grinderName: 'Niche Zero' }), SETTINGS_KEY);
    const all = await readAll(db);
    expect(all.bags).toEqual([makeBag()]);
    expect(all.versions).toEqual([makeVersion()]);
    expect(all.iterations).toEqual([makeIteration()]);
    expect(all.conversations).toEqual([makeConversation()]);
    expect(all.settings).toEqual(makeSettings({ grinderName: 'Niche Zero' }));
    db.close();
  });
});

describe('createDbHandle', () => {
  function fakeDb() {
    return { closed: false, close() { this.closed = true; } };
  }

  it('opens once and shares the connection', async () => {
    const open = vi.fn(async () => fakeDb());
    const handle = createDbHandle(open);
    const [a, b] = await Promise.all([handle.get(), handle.get()]);
    expect(a).toBe(b);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reopens after the browser dropped the connection', async () => {
    let onLost: ((reason: LostReason) => void) | null = null;
    const open = vi.fn(async (lost: (reason: LostReason) => void) => {
      onLost = lost;
      return fakeDb();
    });
    const handle = createDbHandle(open);
    const first = await handle.get();
    onLost!('terminated');
    const second = await handle.get();
    expect(second).not.toBe(first);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('refuses to reopen once a newer version took over, and says to reload', async () => {
    let onLost: ((reason: LostReason) => void) | null = null;
    const handle = createDbHandle(async (lost) => {
      onLost = lost;
      return fakeDb();
    });
    await handle.get();
    onLost!('upgraded');
    await expect(handle.get()).rejects.toMatchObject({ name: 'StorageError', kind: 'superseded', message: STORAGE_MESSAGES.superseded });
  });

  it('tries again after a failed open, and explains the failure in plain words', async () => {
    const open = vi
      .fn<() => Promise<ReturnType<typeof fakeDb>>>()
      .mockRejectedValueOnce(new DOMException('The operation failed for reasons unrelated to the database itself', 'UnknownError'))
      .mockResolvedValueOnce(fakeDb());
    const handle = createDbHandle(open);
    await expect(handle.get()).rejects.toMatchObject({ kind: 'unavailable', message: STORAGE_MESSAGES.unavailable });
    await expect(handle.get()).resolves.toBeDefined();
  });

  it('closes the connection and refuses further use after close()', async () => {
    const db = fakeDb();
    const handle = createDbHandle(async () => db);
    await handle.get();
    handle.close();
    await Promise.resolve();
    expect(db.closed).toBe(true);
    await expect(handle.get()).rejects.toBeInstanceOf(StorageError);
  });
});

describe('toStorageError', () => {
  it('turns a full disk into a sentence a barista can act on', () => {
    const error = toStorageError(new DOMException('The quota has been exceeded.', 'QuotaExceededError'), 'write');
    expect(error).toMatchObject({ name: 'StorageError', kind: 'quota', message: STORAGE_MESSAGES.quota, detail: 'QuotaExceededError' });
  });

  it('never repeats the original message, which may quote stored data', () => {
    const error = toStorageError(new Error('DataCloneError: could not clone {"secret":"x"}'), 'write');
    expect(error.message).toBe(STORAGE_MESSAGES.write);
    expect(error.message).not.toContain('secret');
  });

  it('passes a StorageError through unchanged', () => {
    const original = new StorageError('superseded', STORAGE_MESSAGES.superseded);
    expect(toStorageError(original, 'read')).toBe(original);
  });

  it('names the device, never a tablet: a phone keeps its own copy of CafAI too', () => {
    expect(STORAGE_MESSAGES.quota).toBe(
      'This device is out of storage space, so the change was not saved. Free up some space and try again.',
    );
    expect(STORAGE_MESSAGES.read).toBe('Could not read the saved data on this device. Reload the page and try again.');
    expect(STORAGE_MESSAGES.write).toBe('Could not save to this device. Try again.');
    for (const message of Object.values(STORAGE_MESSAGES)) expect(message).not.toMatch(/tablet/i);
  });
});

describe('requestPersistentStorage', () => {
  it('asks the browser to keep this origin’s storage', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when storage is already persistent', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('is a quiet no-op where the API is missing or refuses', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentStorage()).resolves.toBe(false);
    vi.stubGlobal('navigator', { storage: { persist: async () => Promise.reject(new Error('denied')) } });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});

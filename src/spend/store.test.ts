import { deleteDB, openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { createDbHandle } from '../storage/db.ts';
import { uniqueDbName } from '../storage/testing/fixtures.ts';
import { recordKey } from './records.ts';
import {
  SPEND_DB_NAME,
  SPEND_DEVICE_KEY,
  createIdbSpendStore,
  createMemorySpendStore,
  openSpendDb,
  spendDeviceId,
  type SpendStore,
} from './store.ts';
import { makeRecord } from './testing/fixtures.ts';

function idbStore(): { name: string; store: SpendStore } {
  const name = uniqueDbName('spend');
  const handle = createDbHandle((onLost) => openSpendDb(name, onLost));
  return { name, store: createIdbSpendStore(() => handle.get()) };
}

describe('openSpendDb (D238)', () => {
  it('is a database of its own, cafai-spend, version 1, with one store of day records', async () => {
    const db = await openSpendDb();
    expect(db.name).toBe(SPEND_DB_NAME);
    expect(SPEND_DB_NAME).toBe('cafai-spend');
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual(['days']);
    db.close();
    await deleteDB(SPEND_DB_NAME);
  });
});

for (const [name, make] of [
  ['the IndexedDB store', () => idbStore().store],
  ['the store in memory', () => createMemorySpendStore()],
] as const) {
  describe(`${name} (D238)`, () => {
    it("adds each request to its day's record, per key, and says what it holds now", async () => {
      const store = make();
      expect(await store.add(makeRecord())).toEqual(makeRecord());
      expect(await store.add(makeRecord({ replies: 0 }))).toMatchObject({ requests: 2, replies: 1, inputTokens: 1800, costMicros: 35800 });
      await store.add(makeRecord({ kind: 'shot' }));
      await store.add(makeRecord({ model: 'claude-haiku-5-5' }));
      expect((await store.list()).map((record) => [recordKey(record), record.requests])).toEqual([
        ['2026-10-24|dev12345|anthropic|claude-haiku-5-5|reply', 1],
        ['2026-10-24|dev12345|anthropic|claude-opus-5-5|reply', 2],
        ['2026-10-24|dev12345|anthropic|claude-opus-5-5|shot', 1],
      ]);
    });

    it('starts a new record on a new day', async () => {
      const store = make();
      await store.add(makeRecord());
      await store.add(makeRecord({ day: '2026-10-25' }));
      expect((await store.list()).map((record) => [record.day, record.requests])).toEqual([
        ['2026-10-24', 1],
        ['2026-10-25', 1],
      ]);
    });

    it('merges records per key, keeping the one with more requests, and says whether anything changed', async () => {
      const store = make();
      await store.add(makeRecord());
      await store.add(makeRecord());
      expect(await store.merge([makeRecord({ requests: 1 })])).toBe(false);
      expect(await store.merge([makeRecord({ requests: 5, costMicros: 1 }), makeRecord({ device: 'other999' })])).toBe(true);
      expect((await store.list()).map((record) => [record.device, record.requests, record.costMicros])).toEqual([
        ['dev12345', 5, 1],
        ['other999', 1, 17900],
      ]);
      expect(await store.merge([])).toBe(false);
    });
  });
}

describe('the IndexedDB store, read by another connection (D238)', () => {
  it('has committed a count by the time add() resolves', async () => {
    const { name, store } = idbStore();
    await store.add(makeRecord());
    const db = await openDB(name);
    expect(await db.getAll('days')).toEqual([makeRecord()]);
    db.close();
  });
});

describe('spendDeviceId (D238)', () => {
  function memoryStorage(): globalThis.Storage {
    const items = new Map<string, string>();
    return {
      get length() {
        return items.size;
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, value),
    };
  }

  it("makes a random 8-character id once and keeps it in the device's own storage", () => {
    const storage = memoryStorage();
    const id = spendDeviceId(storage);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(storage.getItem(SPEND_DEVICE_KEY)).toBe(id);
    expect(SPEND_DEVICE_KEY).toBe('cafai.spend.device');
    expect(spendDeviceId(storage)).toBe(id);
  });

  it('makes a new one for a page whose storage is blocked or holds something else', () => {
    expect(spendDeviceId(null)).toMatch(/^[0-9a-f]{8}$/);
    const storage = memoryStorage();
    storage.setItem(SPEND_DEVICE_KEY, 'not an id at all, far too long to be one');
    expect(spendDeviceId(storage)).toMatch(/^[0-9a-f]{8}$/);
    const throwing = { ...memoryStorage(), getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as globalThis.Storage;
    expect(spendDeviceId(throwing)).toMatch(/^[0-9a-f]{8}$/);
  });
});

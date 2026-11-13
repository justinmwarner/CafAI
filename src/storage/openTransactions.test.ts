import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { describeTransactions, stackFrames, watchTransactions, type TransactionWatch } from './openTransactions.ts';

let counter = 0;

function openDb(stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`open-transactions-test-${++counter}`, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function ended(tx: IDBTransaction): Promise<string> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve('complete');
    tx.onabort = () => resolve('abort');
  });
}

describe('watchTransactions', () => {
  let watch: TransactionWatch | null = null;
  afterEach(() => {
    watch?.stop();
    watch = null;
  });

  it('lists a transaction while it is open, with its stores, mode and age, and drops it once it ends', async () => {
    let now = 1_000;
    watch = watchTransactions(globalThis, { now: () => now });
    const db = await openDb(['settings', 'bags']);
    const tx = db.transaction(['settings'], 'readwrite');
    tx.objectStore('settings').put('dark', 'appearance');
    now = 1_250;
    expect(watch.inFlight()).toEqual([
      {
        id: expect.any(Number),
        db: db.name,
        mode: 'readwrite',
        stores: ['settings'],
        openedAt: new Date(1_000).toISOString(),
        ageMs: 250,
        stack: expect.any(Array),
      },
    ]);
    expect(describeTransactions(watch.inFlight())).toBe(`${db.name} readwrite [settings] 250 ms`);
    expect(await ended(tx)).toBe('complete');
    expect(watch.inFlight()).toEqual([]);
    expect(describeTransactions([])).toBe('no IndexedDB transaction open');
    db.close();
  });

  it("sees the idb library's shortcuts too, which open a transaction of their own", async () => {
    watch = watchTransactions(globalThis);
    const db = await openDB(`open-transactions-test-${++counter}`, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore('settings');
      },
    });
    const read = db.get('settings', 'current');
    expect(watch.inFlight().map((t) => `${t.mode} ${t.stores.join(',')}`)).toEqual(['readonly settings']);
    await read;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watch.inFlight()).toEqual([]);
    db.close();
  });

  it('aborts what is still open, says which, and lists them no more', async () => {
    watch = watchTransactions(globalThis);
    const db = await openDb(['settings']);
    const tx = db.transaction(['settings'], 'readonly');
    tx.objectStore('settings').get('current');
    const end = ended(tx);
    const aborted = watch.abortAll();
    expect(aborted.map((t) => `${t.db} ${t.mode} [${t.stores.join(',')}]`)).toEqual([`${db.name} readonly [settings]`]);
    // Gone at once: a page put away may never see its abort event.
    expect(watch.inFlight()).toEqual([]);
    expect(watch.lastAborted()).toEqual(aborted);
    expect(await end).toBe('abort');
    expect(watch.abortAll()).toEqual([]);
    expect(watch.lastAborted()).toEqual([]);
    db.close();
  });

  it('notes the stack only while stacks are on', async () => {
    watch = watchTransactions(globalThis, Date, { stacks: false });
    const db = await openDb(['settings']);
    db.transaction('settings').objectStore('settings').get('a');
    expect(watch.inFlight()[0]!.stack).toEqual([]);
    watch.setStacks(true);
    db.transaction('settings').objectStore('settings').get('b');
    expect(watch.inFlight()[1]!.stack.length).toBeGreaterThan(0);
    db.close();
  });

  it('puts IDBDatabase.prototype.transaction back when it stops', () => {
    const original = IDBDatabase.prototype.transaction;
    const stopped = watchTransactions(globalThis);
    expect(IDBDatabase.prototype.transaction).not.toBe(original);
    stopped.stop();
    expect(IDBDatabase.prototype.transaction).toBe(original);
  });
});

describe('stackFrames', () => {
  it("drops the watch's own frames and keeps at most twelve, each cut short", () => {
    const stack = ['Error', '    at transaction (openTransactions.ts:1:1)', ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (${'x'.repeat(300)})`)].join('\n');
    const frames = stackFrames(stack, 1);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toMatch(/^at frame0 /);
    expect(frames[0]!.length).toBeLessThanOrEqual(201);
    expect(stackFrames(undefined, 1)).toEqual([]);
  });
});

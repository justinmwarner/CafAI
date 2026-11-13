import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { describeTransactions, stackFrames, watchFetch, watchIndexedDb, type IndexedDbWatch } from './watch.ts';

let counter = 0;

function openDb(stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`watch-test-${++counter}`, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<string> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve('complete');
    tx.onabort = () => resolve('abort');
  });
}

describe('watchIndexedDb', () => {
  let watch: IndexedDbWatch | null = null;
  afterEach(() => {
    watch?.stop();
    watch = null;
  });

  it('lists a transaction while it is open, with its stores, mode and age, and drops it once it ends', async () => {
    let now = 1_000;
    watch = watchIndexedDb(globalThis, { now: () => now });
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
    expect(await done(tx)).toBe('complete');
    expect(watch.inFlight()).toEqual([]);
    expect(describeTransactions([])).toBe('no IndexedDB transaction open');
    db.close();
  });

  it("sees the idb library's shortcuts too, which open a transaction of their own", async () => {
    watch = watchIndexedDb(globalThis);
    const db = await openDB(`watch-test-${++counter}`, 1, {
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

  it('aborts what is still open when asked', async () => {
    watch = watchIndexedDb(globalThis);
    const db = await openDb(['settings']);
    const tx = db.transaction(['settings'], 'readwrite');
    tx.objectStore('settings').put('x', 'y');
    const ended = done(tx);
    expect(watch.abortAll()).toBe(1);
    expect(await ended).toBe('abort');
    expect(watch.inFlight()).toEqual([]);
    expect(watch.abortAll()).toBe(0);
    db.close();
  });

  it('puts IDBDatabase.prototype.transaction back when it stops', () => {
    const original = IDBDatabase.prototype.transaction;
    const stopped = watchIndexedDb(globalThis);
    expect(IDBDatabase.prototype.transaction).not.toBe(original);
    stopped.stop();
    expect(IDBDatabase.prototype.transaction).toBe(original);
  });
});

describe('stackFrames', () => {
  it('drops the watch\'s own frames and keeps at most twelve, each cut short', () => {
    const stack = ['Error', '    at transaction (watch.ts:1:1)', ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (${'x'.repeat(300)})`)].join('\n');
    const frames = stackFrames(stack, 1);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toMatch(/^at frame0 /);
    expect(frames[0]!.length).toBeLessThanOrEqual(201);
    expect(stackFrames(undefined, 1)).toEqual([]);
  });
});

describe('watchFetch', () => {
  it("lists a request while it waits, without a beacon's code, and drops it once it is answered", async () => {
    let answer: (response: Response) => void = () => {};
    const scope = { fetch: (() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch };
    let now = 5_000;
    const watch = watchFetch(scope, { now: () => now });
    const waiting = scope.fetch('http://192.168.1.90:8877/v1/debug/report?code=ABCDEFGH&x=1', { method: 'post' });
    now = 5_400;
    expect(watch.inFlight()).toEqual([
      { id: 1, method: 'POST', url: 'http://192.168.1.90:8877/v1/debug/report?code=…&x=1', startedAt: new Date(5_000).toISOString(), ageMs: 400 },
    ]);
    answer(new Response('{}'));
    await waiting;
    await Promise.resolve();
    expect(watch.inFlight()).toEqual([]);
    watch.stop();
  });

  it('drops a request that failed too, and puts fetch back when it stops', async () => {
    const original = (() => Promise.reject(new TypeError('Load failed'))) as typeof fetch;
    const scope = { fetch: original };
    const watch = watchFetch(scope);
    await expect(scope.fetch('http://localhost:8080/api/v1/workflow')).rejects.toThrow('Load failed');
    await Promise.resolve();
    expect(watch.inFlight()).toEqual([]);
    watch.stop();
    expect(scope.fetch).toBe(original);
  });
});

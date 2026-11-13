import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openCafaiDb } from '../storage/db.ts';
import { describeProbes, PROBE_DB_NAME, PROBE_PLAN, probeIndexedDb, runProbe, type ProbeStep } from './probe.ts';

/**
 * A transaction another connection keeps open by asking again in every
 * answer, as a page stopped in the middle of one would: read-only, over the
 * settings store.
 */
function holdOpen(db: IDBDatabase, store: string): { release(): Promise<void> } {
  let holding = true;
  const tx = db.transaction([store], 'readonly');
  const ended = new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
  });
  const ask = () => {
    const request = tx.objectStore(store).get('current');
    request.onsuccess = () => {
      if (holding) ask();
    };
  };
  ask();
  return {
    release() {
      holding = false;
      return ended;
    },
  };
}

function rawOpen(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('probeIndexedDb', () => {
  it("answers ok for CafAI's databases when nothing holds them, and leaves the missing ones unmade", async () => {
    const factory = new IDBFactory();
    globalThis.indexedDB = factory;
    (await openCafaiDb()).close();
    const results = await probeIndexedDb(factory, PROBE_PLAN, 1000);
    const byName = new Map(results.map((r) => [r.name, r]));
    expect(byName.get('cafai: read settings')?.outcome).toBe('ok');
    expect(byName.get('cafai: write settings')?.outcome).toBe('ok');
    expect(byName.get('cafai-care: read')?.outcome).toBe('missing');
    expect(byName.get(`${PROBE_DB_NAME}: write, strict`)?.outcome).toBe('ok');
    const names = (await factory.databases()).map((d) => d.name).sort();
    expect(names).toEqual(['cafai', PROBE_DB_NAME]);
  });

  it('shows a write held up by a read another connection keeps open, while reads still answer', async () => {
    const factory = new IDBFactory();
    globalThis.indexedDB = factory;
    (await openCafaiDb()).close();
    const other = await rawOpen(factory, 'cafai');
    const held = holdOpen(other, 'settings');
    const steps: ProbeStep[] = [
      { name: 'read settings', db: 'cafai', stores: ['settings'], mode: 'readonly' },
      { name: 'write bags', db: 'cafai', stores: ['bags'], mode: 'readwrite' },
    ];
    const reads = await Promise.all(steps.map((step) => runProbe(factory, step, 300)));
    expect(reads.map((r) => r.outcome)).toEqual(['ok', 'ok']);
    const write = await runProbe(factory, { name: 'write settings', db: 'cafai', stores: ['settings'], mode: 'readwrite' }, 300);
    expect(write).toMatchObject({ outcome: 'timeout', stuckAt: 'transaction' });
    await held.release();
    // The timed-out write left the queue: the next one goes at once.
    expect((await runProbe(factory, { name: 'write settings', db: 'cafai', stores: ['settings'], mode: 'readwrite' }, 1000)).outcome).toBe('ok');
    other.close();
  });

  it("does not make CafAI's database when it is not there", async () => {
    const factory = new IDBFactory();
    const result = await runProbe(factory, { name: 'cafai: read settings', db: 'cafai', stores: ['settings'], mode: 'readonly' }, 500);
    expect(result.outcome).toBe('missing');
    expect(await factory.databases()).toEqual([]);
    // CafAI's own open still makes it whole afterwards.
    const db = await rawOpen(factory, 'cafai');
    expect(db.version).toBe(1);
    db.close();
  });

  it('sums up what answered and names what did not', () => {
    expect(
      describeProbes([
        { name: 'cafai: read settings', outcome: 'ok', ms: 3 },
        { name: 'cafai: write settings', outcome: 'timeout', stuckAt: 'transaction', ms: 3001 },
        { name: 'cafai-care: read', outcome: 'missing', ms: 1 },
      ]),
    ).toBe('1 of 3 answered; cafai: write settings timeout (transaction) 3001 ms; cafai-care: read missing 1 ms');
  });
});

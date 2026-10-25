import { deleteDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import type { KvClient } from '../api/types.ts';
import { KNOWN_MODELS } from '../llm/models.ts';
import { uniqueDbName } from '../storage/testing/fixtures.ts';
import { createSpendService, openSpendService } from './service.ts';
import { createMemorySpendStore, SPEND_DEVICE_KEY, type SpendStore } from './store.ts';
import { SPEND_NAMESPACE, type SyncTimers } from './sync.ts';
import { makeRecord } from './testing/fixtures.ts';
import type { SpendCount, SpendRecord } from './types.ts';

const NOW = new Date(2026, 9, 24, 15, 0);

const COUNT: SpendCount = {
  at: new Date(2026, 9, 24, 9, 30),
  source: 'anthropic',
  model: 'claude-opus-5-5',
  kind: 'reply',
  call: 0,
  usage: { inputTokens: 900, outputTokens: 40, cacheReadInputTokens: 4000, cacheCreationInputTokens: 300, webSearchRequests: 1 },
};

/** Decaid's store in memory. */
function memoryKv(seed: Record<string, unknown> = {}): KvClient & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(seed).map(([key, value]) => [`${SPEND_NAMESPACE}/${key}`, value]));
  return {
    data,
    list: async () => [],
    getAll: async (ns) => ({
      notModified: false,
      etag: null,
      data: Object.fromEntries([...data].filter(([key]) => key.startsWith(`${ns}/`)).map(([key, value]) => [key.slice(ns.length + 1), value])),
    }),
    get: async <T>(ns: string, key: string) => (data.get(`${ns}/${key}`) as T | undefined) ?? null,
    set: async (ns, key, value) => void data.set(`${ns}/${key}`, JSON.parse(JSON.stringify(value))),
    delete: async (ns, key) => void data.delete(`${ns}/${key}`),
  };
}

/** Timers that run when the test says, with the delays they were set for. */
function heldTimers(): SyncTimers & { fire(): void; delays: number[] } {
  const due = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 0;
  return {
    delays,
    setTimeout(callback, ms) {
      next += 1;
      due.set(next, callback);
      delays.push(ms);
      return next;
    },
    clearTimeout: (handle) => void due.delete(handle as number),
    fire() {
      const callbacks = [...due.values()];
      due.clear();
      for (const callback of callbacks) callback();
    },
  };
}

function service(over: { store?: SpendStore; kv?: KvClient; initial?: SpendRecord[]; timers?: SyncTimers } = {}) {
  return createSpendService({
    store: over.store ?? createMemorySpendStore(over.initial),
    kv: over.kv,
    deviceId: 'dev12345',
    initial: over.initial,
    models: KNOWN_MODELS,
    now: () => NOW,
    timers: over.timers ?? heldTimers(),
  });
}

describe('the spend service (D237-D240)', () => {
  it("counts a request at the catalog's prices into this month's totals at once", () => {
    const spend = service();
    spend.count(COUNT);
    // 900 x $4 + 40 x $20 + 4,000 x $0.20 + 300 x $5, and a search.
    expect(spend.summary().anthropic.month).toMatchObject({ costMicros: 6700 + 10_000, tokens: 5240, requests: 1, replies: 1, webSearches: 1 });
    spend.count({ ...COUNT, call: 1, kind: 'shot' });
    expect(spend.summary().anthropic.month).toMatchObject({ requests: 2, replies: 1 });
    expect(spend.summary().anthropic.month.byKind).toEqual({ reply: 6700, shot: 6700, photo: 0, web: 20_000 });
  });

  it('counts the tokens of a model typed by hand without a price, and names it', () => {
    const spend = service();
    spend.count({ ...COUNT, model: 'claude-future-9', usage: { inputTokens: 1000, outputTokens: 10 } });
    expect(spend.summary().anthropic.month).toMatchObject({ costMicros: 0, tokens: 1010, requests: 1 });
    expect(spend.summary().unpricedModels).toEqual(['claude-future-9']);
  });

  it("keeps the computer's tokens at the API's prices apart from the key's dollars", () => {
    const spend = service();
    spend.count({ ...COUNT, source: 'computer' });
    expect(spend.summary().anthropic.month.costMicros).toBe(0);
    expect(spend.summary().computer.month.costMicros).toBe(16_700);
  });

  it('starts from the records kept on the device', () => {
    const spend = service({ initial: [makeRecord({ requests: 4, costMicros: 70_000 })] });
    expect(spend.summary().anthropic.month).toMatchObject({ requests: 4, costMicros: 70_000 });
  });

  it('gives the same summary until something changes, and tells subscribers of each change', () => {
    const spend = service();
    const listener = vi.fn();
    const stop = spend.subscribe(listener);
    const before = spend.summary();
    expect(spend.summary()).toBe(before);
    spend.count(COUNT);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(spend.summary()).not.toBe(before);
    stop();
    spend.count(COUNT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells its subscribers when the day turns, so today starts again with nothing counted', () => {
    const timers = heldTimers();
    const spend = service({ timers });
    const listener = vi.fn();
    const stop = spend.subscribe(listener);
    // From 15:00 to a second past midnight.
    expect(timers.delays).toEqual([9 * 3_600_000 + 1000]);
    timers.fire();
    expect(listener).toHaveBeenCalledTimes(1);
    // The next midnight's, at once.
    expect(timers.delays).toHaveLength(2);
    stop();
    timers.fire();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps each count on the device', async () => {
    const store = createMemorySpendStore();
    const spend = service({ store });
    spend.count(COUNT);
    spend.count(COUNT);
    await vi.waitFor(async () => expect((await store.list()).map((record) => record.requests)).toEqual([2]));
  });

  it('never throws into the coach, whatever the store does', async () => {
    const store: SpendStore = {
      add: async () => {
        throw new Error('QuotaExceededError');
      },
      list: async () => [],
      merge: async () => {
        throw new Error('QuotaExceededError');
      },
    };
    const spend = service({ store });
    expect(() => spend.count(COUNT)).not.toThrow();
    expect(() => spend.count({ ...COUNT, usage: null as unknown as SpendCount['usage'] })).not.toThrow();
    expect(spend.summary().anthropic.month.requests).toBe(1);
  });

  it("measures the month's API-key spend against the budget, every device's added", () => {
    const spend = service({ initial: [makeRecord({ device: 'other999', costMicros: 3_900_000 }), makeRecord({ source: 'computer', costMicros: 9_000_000 })] });
    const budget = { monthlyUsd: 5, pauseAtBudget: true };
    expect(spend.budget(budget)).toMatchObject({ spentMicros: 3_900_000, step: 'under', paused: false });
    spend.count({ ...COUNT, usage: { inputTokens: 25_000, outputTokens: 0 } });
    expect(spend.budget(budget)).toMatchObject({ spentMicros: 4_000_000, step: 'near' });
    spend.count({ ...COUNT, usage: { inputTokens: 250_000, outputTokens: 0 } });
    expect(spend.budget(budget)).toMatchObject({ spentMicros: 5_000_000, step: 'over', paused: true, resumesOn: '2026-11-01' });
    expect(spend.budget(undefined).step).toBe('none');
    expect(spend.budget(budget, new Date(2026, 10, 1, 0, 1))).toMatchObject({ spentMicros: 0, paused: false });
  });

  it("copies the month to Decaid after a count, and merges Decaid's copy in at refresh", async () => {
    const kv = memoryKv({ '2026-10': { v: 1, records: [makeRecord({ device: 'other999', costMicros: 40_000 })] } });
    const timers = heldTimers();
    const spend = service({ kv, timers });
    const listener = vi.fn();
    spend.subscribe(listener);
    await spend.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(spend.summary().anthropic.month.costMicros).toBe(40_000);
    spend.count(COUNT);
    timers.fire();
    await vi.waitFor(() =>
      expect((kv.data.get(`${SPEND_NAMESPACE}/2026-10`) as { records: SpendRecord[] }).records.map((record) => record.device)).toEqual(['other999', 'dev12345']),
    );
  });

  it('refreshes to nothing without Decaid', async () => {
    await expect(service().refresh()).resolves.toBeUndefined();
  });
});

describe('openSpendService (D238)', () => {
  it("opens the device's database, starts from what it holds, and makes this device's id once", async () => {
    const dbName = uniqueDbName('spend');
    const items = new Map<string, string>();
    const deviceStorage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } as unknown as globalThis.Storage;
    const first = await openSpendService({ kv: memoryKv(), deviceStorage, models: KNOWN_MODELS, dbName, now: () => NOW });
    first.count(COUNT);
    await vi.waitFor(async () => {
      const again = await openSpendService({ kv: memoryKv(), deviceStorage, models: KNOWN_MODELS, dbName, now: () => NOW });
      expect(again.summary().anthropic.month.requests).toBe(1);
      again.dispose();
    });
    expect(items.get(SPEND_DEVICE_KEY)).toMatch(/^[0-9a-f]{8}$/);
    first.dispose();
    await deleteDB(dbName);
  });
});

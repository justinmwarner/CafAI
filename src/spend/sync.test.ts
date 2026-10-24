import { describe, expect, it } from 'vitest';
import type { KvClient } from '../api/types.ts';
import { mergeRecords } from './records.ts';
import { SPEND_NAMESPACE, createSpendSync, type SyncTimers } from './sync.ts';
import { makeRecord } from './testing/fixtures.ts';
import type { SpendRecord } from './types.ts';

/** Decaid's store in memory; `down` makes every call fail as an unreachable Decaid would. */
function fakeKv() {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  const state = { down: false };
  const reach = (call: string) => {
    calls.push(call);
    if (state.down) throw new TypeError('Failed to fetch');
  };
  const kv: KvClient = {
    list: async (ns) => {
      reach(`list ${ns}`);
      return [...data.keys()].filter((key) => key.startsWith(`${ns}/`)).map((key) => key.slice(ns.length + 1));
    },
    getAll: async (ns) => {
      reach(`getAll ${ns}`);
      const entries = [...data].filter(([key]) => key.startsWith(`${ns}/`)).map(([key, value]) => [key.slice(ns.length + 1), jsonCopy(value)]);
      return { notModified: false, etag: null, data: Object.fromEntries(entries) };
    },
    get: async <T>(ns: string, key: string) => {
      reach(`get ${ns}/${key}`);
      return (jsonCopy(data.get(`${ns}/${key}`)) as T | undefined) ?? null;
    },
    set: async (ns, key, value) => {
      reach(`set ${ns}/${key}`);
      data.set(`${ns}/${key}`, jsonCopy(value));
    },
    delete: async (ns, key) => {
      reach(`delete ${ns}/${key}`);
      data.delete(`${ns}/${key}`);
    },
  };
  return { kv, data, calls, state, month: (month: string) => data.get(`${SPEND_NAMESPACE}/${month}`) as { v: number; records: SpendRecord[] } | undefined };
}

/** JSON in, JSON out, as Decaid's store keeps it. */
function jsonCopy(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Timers fired by hand, with a clock the test moves. */
function manualClock() {
  let nowMs = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let next = 0;
  const timers: SyncTimers = {
    setTimeout(callback, ms) {
      next += 1;
      pending.set(next, { at: nowMs + ms, callback });
      return next;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    now: () => nowMs,
    /** Move the clock on and fire what is due by then. */
    advance(ms: number) {
      nowMs += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at > nowMs) continue;
        pending.delete(id);
        timer.callback();
      }
    },
    pending: () => [...pending.values()].map((timer) => timer.at - nowMs),
  };
}

/** One device: what it holds (the service's records), and its copy's sync. */
function device(id: string, kv: KvClient, clock = manualClock()) {
  let held: SpendRecord[] = [];
  const merged: SpendRecord[][] = [];
  const sync = createSpendSync({
    kv,
    deviceId: id,
    held: () => held,
    mergeIn: (records) => {
      merged.push([...records]);
      const result = mergeRecords(held, records);
      held = result.records;
      return result.changed;
    },
    now: clock.now,
    timers: clock.timers,
  });
  return {
    sync,
    clock,
    merged,
    held: () => held,
    /** A count here: the record grows, and the sync hears its month changed. */
    count(record: SpendRecord) {
      held = mergeRecords(held, [record]).records;
      sync.changed(record.day.slice(0, 7));
    },
  };
}

/** Let the promise chain a fired timer started run to its end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the coach's usage in Decaid (D238)", () => {
  it("writes this device's records of the month 2 s after the last count, merged with what Decaid holds", async () => {
    const decaid = fakeKv();
    const a = device('dev12345', decaid.kv);
    a.count(makeRecord({ requests: 1 }));
    a.clock.advance(1000);
    a.count(makeRecord({ requests: 2 }));
    a.clock.advance(1999);
    await settle();
    expect(decaid.calls).toEqual([]);
    a.clock.advance(1);
    await settle();
    expect(decaid.calls).toEqual([`get ${SPEND_NAMESPACE}/2026-10`, `set ${SPEND_NAMESPACE}/2026-10`]);
    expect(decaid.month('2026-10')).toEqual({ v: 1, records: [makeRecord({ requests: 2 })] });
  });

  it("keeps both devices' records when each writes in turn: neither overwrites the other's", async () => {
    const decaid = fakeKv();
    const a = device('dev12345', decaid.kv);
    const b = device('other999', decaid.kv);
    a.count(makeRecord());
    a.clock.advance(2000);
    await settle();
    b.count(makeRecord({ device: 'other999', model: 'claude-haiku-5-5', requests: 4 }));
    b.clock.advance(2000);
    await settle();
    a.count(makeRecord({ requests: 3 }));
    a.clock.advance(2000);
    await settle();
    expect(decaid.month('2026-10')!.records.map((record) => [record.device, record.requests])).toEqual([
      ['dev12345', 3],
      ['other999', 4],
    ]);
    // Each write brought the other's records here too.
    expect(a.held().map((record) => record.device)).toEqual(['dev12345', 'other999']);
  });

  it('writes nothing when Decaid already holds what this device has', async () => {
    const decaid = fakeKv();
    decaid.data.set(`${SPEND_NAMESPACE}/2026-10`, { v: 1, records: [makeRecord({ requests: 5 })] });
    const a = device('dev12345', decaid.kv);
    a.count(makeRecord({ requests: 5 }));
    a.clock.advance(2000);
    await settle();
    expect(decaid.calls).toEqual([`get ${SPEND_NAMESPACE}/2026-10`]);
  });

  it("brings the month back to a new origin, an empty device with a new id, at refresh (an iPad's Decaid update, D231)", async () => {
    const decaid = fakeKv();
    const old = makeRecord({ device: 'olddevic', requests: 12, costMicros: 840_000 });
    const lastMonth = makeRecord({ device: 'olddevic', day: '2026-09-30' });
    decaid.data.set(`${SPEND_NAMESPACE}/2026-10`, { v: 1, records: [old] });
    decaid.data.set(`${SPEND_NAMESPACE}/2026-09`, { v: 1, records: [lastMonth] });
    const fresh = device('newdevic', decaid.kv);
    await fresh.sync.refresh();
    expect(decaid.calls).toEqual([`getAll ${SPEND_NAMESPACE}`]);
    expect(fresh.held()).toEqual(expect.arrayContaining([old, lastMonth]));
    expect(fresh.held()).toHaveLength(2);
  });

  it("writes back at refresh what Decaid's copy lacks of this device's records: a write lost while it was away, or to a second device's at the same moment", async () => {
    const decaid = fakeKv();
    decaid.data.set(`${SPEND_NAMESPACE}/2026-10`, { v: 1, records: [makeRecord({ device: 'other999' }), makeRecord({ requests: 1 })] });
    const a = device('dev12345', decaid.kv);
    a.count(makeRecord({ requests: 4 }));
    a.count(makeRecord({ day: '2026-09-12' }));
    await a.sync.refresh();
    expect(decaid.month('2026-10')!.records.map((record) => [record.device, record.requests])).toEqual([
      ['other999', 1],
      ['dev12345', 4],
    ]);
    expect(decaid.month('2026-09')).toEqual({ v: 1, records: [makeRecord({ day: '2026-09-12' })] });
  });

  it('keeps going while Decaid is unreachable, and writes when the next count comes, at most once a minute', async () => {
    const decaid = fakeKv();
    const a = device('dev12345', decaid.kv);
    decaid.state.down = true;
    a.count(makeRecord());
    a.clock.advance(2000);
    await settle();
    expect(decaid.calls).toEqual([`get ${SPEND_NAMESPACE}/2026-10`]);
    decaid.state.down = false;
    // A count 10 s later waits for the minute since the failure.
    a.clock.advance(10_000);
    a.count(makeRecord({ requests: 2 }));
    expect(a.clock.pending()).toEqual([50_000]);
    a.clock.advance(49_999);
    await settle();
    expect(decaid.calls).toHaveLength(1);
    a.clock.advance(1);
    await settle();
    expect(decaid.month('2026-10')).toEqual({ v: 1, records: [makeRecord({ requests: 2 })] });
  });

  it('reads nothing at a refresh within a minute of a failure, and never rejects', async () => {
    const decaid = fakeKv();
    const a = device('dev12345', decaid.kv);
    decaid.state.down = true;
    await expect(a.sync.refresh()).resolves.toBeUndefined();
    decaid.state.down = false;
    a.clock.advance(30_000);
    await a.sync.refresh();
    expect(decaid.calls).toEqual([`getAll ${SPEND_NAMESPACE}`]);
    a.clock.advance(30_000);
    await a.sync.refresh();
    expect(decaid.calls).toEqual([`getAll ${SPEND_NAMESPACE}`, `getAll ${SPEND_NAMESPACE}`]);
  });

  it("leaves a month a newer CafAI wrote in a shape of its own alone, and reads only records that read", async () => {
    const decaid = fakeKv();
    decaid.data.set(`${SPEND_NAMESPACE}/2026-10`, { v: 2, rows: [] });
    decaid.data.set(`${SPEND_NAMESPACE}/2026-09`, { v: 1, records: [makeRecord({ day: '2026-09-01', device: 'other999' }), { nonsense: true }] });
    decaid.data.set(`${SPEND_NAMESPACE}/notes`, { v: 1, records: [makeRecord({ device: 'stray999' })] });
    const a = device('dev12345', decaid.kv);
    a.count(makeRecord());
    await a.sync.refresh();
    expect(a.held().map((record) => record.device)).toEqual(['dev12345', 'other999']);
    a.clock.advance(2000);
    await settle();
    expect(decaid.month('2026-10')).toEqual({ v: 2, rows: [] });
  });

  it('stops its timer when disposed', async () => {
    const decaid = fakeKv();
    const a = device('dev12345', decaid.kv);
    a.count(makeRecord());
    a.sync.dispose();
    a.clock.advance(5000);
    await settle();
    expect(decaid.calls).toEqual([]);
  });
});

import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unexpectedReply } from '../api/readers.ts';
import { GatewayError } from '../api/types.ts';
import {
  createIdbStorage,
  exportFileName,
  LATE_RESTORE_FOR_MS,
  restoreFromMirror,
  restoreFromMirrorIfEmpty,
  serializeExport,
  startLateRestore,
  STORAGE_MESSAGES,
  type CreateIdbStorageOptions,
  type IdbStorage,
  type LateRestore,
  type RestoreTimers,
} from './index.ts';
import { KEY_NAME, KEY_NAMESPACE } from './keyBackup.ts';
import { createMemoryKv, type MemoryKv } from './testing/memoryKv.ts';
import type { Bag, IterationRecord } from './types.ts';
import {
  API_KEY,
  MODEL,
  makeBag,
  makeCareRecord,
  makeConversation,
  makeIteration,
  makeSettings,
  makeVersion,
  uniqueDbName,
} from './testing/fixtures.ts';

const NOW = new Date('2026-10-03T09:30:00.000Z');
const opened: IdbStorage[] = [];
const restores: LateRestore[] = [];

afterEach(() => {
  for (const restore of restores.splice(0)) restore.stop();
  for (const storage of opened.splice(0)) storage.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** How the KV client fails when Decaid does not answer, and when it answers something CafAI cannot read. */
const away = () => new GatewayError(0, '/api/v1/store/cafai?full=1', 'Decaid is not answering.', 'network');
const garbled = () => unexpectedReply('GET /api/v1/store/{ns}?full=1', '/api/v1/store/cafai?full=1');

/** Timers the test fires by hand, with the clock they run on. */
function manualTimers() {
  const scheduled = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const clock = { now: Date.parse('2026-10-03T09:30:00.000Z') };
  const timers: RestoreTimers = {
    setTimeout(callback, ms) {
      next += 1;
      scheduled.set(next, { callback, ms });
      return next;
    },
    clearTimeout(handle) {
      scheduled.delete(handle as number);
    },
  };
  return {
    timers,
    now: () => clock.now,
    delays: () => [...scheduled.values()].map((timer) => timer.ms),
    /** Move the clock on by the next delay and fire it. */
    fire() {
      const due = [...scheduled.values()];
      scheduled.clear();
      for (const timer of due) {
        clock.now += timer.ms;
        timer.callback();
      }
    },
  };
}

function names() {
  return { dbName: uniqueDbName(), careDbName: uniqueDbName('care'), secretsDbName: uniqueDbName('secrets') };
}

async function open(kv: MemoryKv, where = names(), extra: Partial<CreateIdbStorageOptions> = {}): Promise<IdbStorage> {
  const storage = await createIdbStorage({ kv, appVersion: '1.2.3', defaultModel: MODEL, now: () => NOW, ...where, ...extra });
  opened.push(storage);
  return storage;
}

async function seed(storage: IdbStorage): Promise<void> {
  await storage.bags.put(makeBag());
  await storage.versions.put(makeVersion());
  await storage.iterations.put(makeIteration());
  await storage.conversations.put(makeConversation());
  await storage.settings.update({ grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' });
}

const OTHER_BAG: Bag = makeBag({
  id: 'bag_other',
  name: 'Brazil Cerrado',
  conversationId: 'conv_other',
  createdAt: '2026-10-03T09:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
});

function bagIds(value: unknown): string[] {
  return (value as Bag[]).map((bag) => bag.id).sort();
}

describe('createIdbStorage', () => {
  it('wires every repository, the secrets, the porter and the mirror together', async () => {
    const storage = await open(createMemoryKv());
    await seed(storage);
    await storage.secrets.setApiKey(API_KEY);
    expect(await storage.bags.list()).toEqual([makeBag()]);
    expect(await storage.versions.listByBag('bag_kiambu')).toEqual([makeVersion()]);
    expect(await storage.iterations.listByBag('bag_kiambu')).toEqual([makeIteration()]);
    expect(await storage.conversations.get('conv_kiambu')).toEqual(makeConversation());
    expect(await storage.secrets.getApiKey()).toBe(API_KEY);
    expect((await storage.porter.exportAll()).bags).toEqual([makeBag()]);
    expect(storage.mirror.lastError).toBeNull();
  });

  it('keeps every record, the settings and the key across a reload', async () => {
    const kv = createMemoryKv();
    const where = names();
    const first = await open(kv, where);
    await seed(first);
    await first.secrets.setApiKey(API_KEY);
    first.close();

    const second = await open(kv, where);
    expect(await second.bags.list()).toEqual([makeBag()]);
    expect(await second.versions.listByBag('bag_kiambu')).toEqual([makeVersion()]);
    expect(await second.iterations.listAll()).toEqual([makeIteration()]);
    expect(await second.conversations.get('conv_kiambu')).toEqual(makeConversation());
    expect(await second.settings.get()).toEqual(makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' }));
    expect(await second.secrets.getApiKey()).toBe(API_KEY);
  });

  it('copies a settings change to Decaid two seconds after it is saved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const kv = createMemoryKv();
    const storage = await open(kv);
    await storage.settings.update({ grinderName: 'Niche Zero' });
    vi.advanceTimersByTime(1999);
    await storage.mirror.settled();
    expect(kv.writes()).toEqual([]);
    vi.advanceTimersByTime(1);
    await storage.mirror.settled();
    expect(kv.values()['settings']).toEqual(makeSettings({ grinderName: 'Niche Zero' }));
  });

  it('never sends the stored API key to Decaid and never exports it', async () => {
    const kv = createMemoryKv();
    const storage = await open(kv);
    await storage.secrets.setApiKey(API_KEY);
    await seed(storage);
    await storage.bags.put(makeBag({ notes: `pasted ${API_KEY}` }));
    await storage.mirror.pushNow();
    const texts = Object.values(kv.texts());
    expect(texts.length).toBeGreaterThanOrEqual(6);
    for (const text of texts) expect(text).not.toContain(API_KEY);
    expect(serializeExport(await storage.porter.exportAll())).not.toContain(API_KEY);
    expect(await storage.secrets.getApiKey()).toBe(API_KEY);
  });

  it('leaves the API key alone when an import replaces everything', async () => {
    const storage = await open(createMemoryKv());
    await storage.secrets.setApiKey(API_KEY);
    await seed(storage);
    const empty = { ...(await storage.porter.exportAll()), bags: [], versions: [], iterations: [], conversations: [] };
    await storage.porter.importAll(empty, 'replace');
    expect(await storage.bags.list()).toEqual([]);
    expect(await storage.secrets.getApiKey()).toBe(API_KEY);
  });

  it('keeps what the key copy in Decaid is owed across a reload: a key forgotten while Decaid was away never comes back (D99)', async () => {
    const kv = createMemoryKv();
    const where = names();
    const first = await open(kv, where);
    await first.keyBackup.saveKey(API_KEY, false);
    await first.keyBackup.setOn(true);
    kv.failNext('delete', 1, away());
    expect(await first.keyBackup.forgetKey(true)).toBe(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({ [KEY_NAME]: API_KEY });
    first.close();

    // The next start: the delete goes out first, and nothing comes back.
    const second = await open(kv, where);
    expect(await second.keyBackup.restoreIfMissing()).toBe(false);
    expect(kv.values(KEY_NAMESPACE)).toEqual({});
    expect(await second.secrets.getApiKey()).toBeNull();
  });

  it('says in plain words when the browser blocks storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(open(createMemoryKv())).rejects.toMatchObject({ name: 'StorageError', kind: 'unavailable' });
  });

  it("keeps machine care's steps in their own database, so CafAI 0.1.2 still opens its own at version 1 (D189)", async () => {
    const where = names();
    const storage = await open(createMemoryKv(), where);
    await seed(storage);
    await storage.care.put(makeCareRecord());
    storage.close();

    // 0.1.2 opens version 1 with no upgrade to run: a higher version stopped it at "CafAI could not start".
    const cafai012 = await openDB(where.dbName, 1);
    expect(cafai012.version).toBe(1);
    expect([...cafai012.objectStoreNames].sort()).toEqual(['bags', 'conversations', 'iterations', 'settings', 'versions']);
    expect(await cafai012.getAll('bags')).toEqual([makeBag()]);
    cafai012.close();
    const care = await openDB(where.careDbName);
    expect(await care.getAll('care')).toEqual([makeCareRecord()]);
    care.close();

    // And back on this CafAI, everything is where it was.
    const again = await open(createMemoryKv(), where);
    expect(await again.bags.list()).toEqual([makeBag()]);
    expect(await again.care.list()).toEqual([makeCareRecord()]);
    expect((await again.porter.exportAll()).care).toEqual([makeCareRecord()]);
  });

  it('says a database a newer CafAI saved needs that CafAI, whichever of them it is', async () => {
    for (const which of ['dbName', 'careDbName', 'secretsDbName'] as const) {
      const where = names();
      (await openDB(where[which], 5)).close();
      await expect(open(createMemoryKv(), where), which).rejects.toMatchObject({ name: 'StorageError', kind: 'newer', message: STORAGE_MESSAGES.newer });
    }
  });

  it('exports the porter helpers', () => {
    expect(exportFileName(new Date(2026, 9, 3))).toBe('cafai-export-2026-10-03.json');
  });
});

describe('restoreFromMirrorIfEmpty', () => {
  it('restores the mirrored data into an empty store', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const fresh = await open(kv);
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('restored');
    expect(await fresh.bags.list()).toEqual([makeBag()]);
    expect(await fresh.versions.listByBag('bag_kiambu')).toEqual([makeVersion()]);
    expect(await fresh.conversations.get('conv_kiambu')).toEqual(makeConversation());
    const [iteration] = await fresh.iterations.listAll();
    const summary = {
      ...makeIteration().summary!,
      series: { tS: [], pressure: [], flow: [], weight: [], weightFlow: [], temperature: [], targetPressure: [], targetFlow: [] },
    };
    expect(iteration).toEqual({ ...makeIteration(), summary } as IterationRecord);
    expect(await fresh.settings.get()).toEqual(makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' }));
  });

  it("brings machine care's last times back, over the counts a fresh device began meanwhile (D189)", async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await original.care.put(makeCareRecord());
    await original.mirror.pushNow();

    const fresh = await open(kv);
    // The fresh device began counting before the backup came back.
    await fresh.care.put(makeCareRecord({ doneAt: null, by: null, countFrom: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:00.000Z' }));
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('restored');
    expect(await fresh.care.list()).toEqual([makeCareRecord()]);
  });

  it('only fills blank settings, keeping the ones already set here', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.settings.update({ model: 'claude-sonnet-5' });
    await original.mirror.pushNow();

    const fresh = await open(kv);
    await fresh.settings.update({ model: 'claude-haiku-4-5', grinderName: 'Lagom 01' });
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('restored');
    expect(await fresh.settings.get()).toEqual(
      makeSettings({ model: 'claude-haiku-4-5', grinderName: 'Lagom 01', grinderSetting: '14', activeBagId: 'bag_kiambu' }),
    );
  });

  it('does nothing when this device already has bags', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const other = await open(kv);
    await other.bags.put(OTHER_BAG);
    expect(await restoreFromMirrorIfEmpty(other)).toBe('nothing');
    expect(await other.bags.list()).toEqual([OTHER_BAG]);
  });

  it('does nothing when the mirror is empty', async () => {
    const storage = await open(createMemoryKv());
    expect(await restoreFromMirrorIfEmpty(storage)).toBe('nothing');
    expect(await storage.bags.list()).toEqual([]);
  });

  it('tells a Decaid that does not answer from one that answers something CafAI cannot read, and never throws (5.3)', async () => {
    const kv = createMemoryKv();
    const storage = await open(kv);
    kv.failNext('getAll', 1, away());
    expect(await restoreFromMirrorIfEmpty(storage)).toBe('unreachable');
    kv.failNext('getAll', 1, new GatewayError(0, '/api/v1/store/cafai?full=1', 'Decaid did not answer in time.', 'timeout'));
    expect(await restoreFromMirrorIfEmpty(storage)).toBe('unreachable');
    kv.failNext('getAll', 1, new GatewayError(503, '/api/v1/store/cafai?full=1', 'Decaid is busy. Try again in a moment.', 'http'));
    expect(await restoreFromMirrorIfEmpty(storage)).toBe('unreachable');
    kv.failNext('getAll', 1, garbled());
    expect(await restoreFromMirrorIfEmpty(storage)).toBe('unreadable');
    expect(await storage.bags.list()).toEqual([]);
  });

  it('takes a backup this version cannot import for no backup, as the first push does', async () => {
    const storage = await open(createMemoryKv());
    const newer = { ...storage, mirror: { ...storage.mirror, pull: async () => ({ format: 'cafai-export', schemaVersion: 2 }) } };
    expect(await restoreFromMirror(newer as unknown as IdbStorage)).toBe('nothing');
  });

  it('merges the backup in after start even when a bag was started meanwhile, filling blanks only', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const fresh = await open(kv);
    await fresh.bags.put(OTHER_BAG);
    expect(await restoreFromMirror(fresh)).toBe('restored');
    expect(bagIds(await fresh.bags.list())).toEqual(['bag_kiambu', 'bag_other']);
    expect(await restoreFromMirror(fresh)).toBe('nothing');
  });
});

describe('startLateRestore (5.4)', () => {
  async function backedUp(kv: MemoryKv): Promise<void> {
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();
    original.close();
  }

  function start(storage: IdbStorage, clock: ReturnType<typeof manualTimers>) {
    const onRestored = vi.fn();
    const late = startLateRestore(storage, { onRestored, timers: clock.timers, now: clock.now });
    restores.push(late);
    return { late, onRestored };
  }

  const fullReads = (kv: MemoryKv) => kv.calls.filter((call) => call.method === 'getAll' && call.namespace === 'cafai').length;

  it('keeps trying while Decaid does not answer, 2 s doubling to 30 s, and restores once it does', async () => {
    const kv = createMemoryKv();
    await backedUp(kv);
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 5, away());
    const { late, onRestored } = start(fresh, clock);

    const delays: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      delays.push(...clock.delays());
      clock.fire();
      await late.settled();
    }
    expect(delays).toEqual([2000, 4000, 8000, 16_000, 30_000]);
    expect(onRestored).not.toHaveBeenCalled();
    expect(clock.delays()).toEqual([30_000]);

    clock.fire();
    await late.settled();
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith({ records: true, key: false });
    expect(await fresh.bags.list()).toEqual([makeBag()]);
    expect(clock.delays()).toEqual([]);
  });

  it('tries at once when told Decaid may be back, and stops for good once Decaid says it holds nothing', async () => {
    const kv = createMemoryKv();
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 1, away());
    const { late, onRestored } = start(fresh, clock);
    late.retryNow();
    await late.settled();
    expect(fullReads(kv)).toBe(1);
    expect(clock.delays()).toEqual([4000]);

    late.retryNow();
    await late.settled();
    expect(fullReads(kv)).toBe(2);
    expect(clock.delays()).toEqual([]);
    late.retryNow();
    clock.fire();
    await late.settled();
    expect(fullReads(kv)).toBe(2);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('keeps trying after an unreadable reply, never taking it for an empty backup', async () => {
    const kv = createMemoryKv();
    await backedUp(kv);
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 1, garbled());
    const { late, onRestored } = start(fresh, clock);
    clock.fire();
    await late.settled();
    expect(onRestored).not.toHaveBeenCalled();
    expect(await fresh.bags.list()).toEqual([]);
    expect(clock.delays()).toEqual([4000]);
    clock.fire();
    await late.settled();
    expect(onRestored).toHaveBeenCalledWith({ records: true, key: false });
  });

  it('stops the timed tries after 10 minutes, but still restores when told Decaid is back later', async () => {
    const kv = createMemoryKv();
    await backedUp(kv);
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 1000, away());
    const { late, onRestored } = start(fresh, clock);
    const started = clock.now();
    while (clock.delays().length > 0) {
      clock.fire();
      await late.settled();
    }
    expect(clock.now() - started).toBeGreaterThanOrEqual(LATE_RESTORE_FOR_MS - 30_000);
    expect(clock.now() - started).toBeLessThanOrEqual(LATE_RESTORE_FOR_MS + 30_000);
    expect(onRestored).not.toHaveBeenCalled();

    kv.failNext('getAll', 0);
    late.retryNow();
    await late.settled();
    expect(onRestored).toHaveBeenCalledWith({ records: true, key: false });
  });

  it('brings the API key back from its copy in Decaid in the same tries, and writes nothing to Decaid (D99)', async () => {
    const kv = createMemoryKv({ [KEY_NAMESPACE]: { [KEY_NAME]: API_KEY } });
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 1, away());
    kv.failNext('get', 1, away());
    const { late, onRestored } = start(fresh, clock);
    clock.fire();
    await late.settled();
    expect(await fresh.secrets.getApiKey()).toBeNull();
    expect(onRestored).not.toHaveBeenCalled();

    clock.fire();
    await late.settled();
    expect(onRestored).toHaveBeenCalledWith({ records: false, key: true });
    expect(await fresh.secrets.getApiKey()).toBe(API_KEY);
    expect(kv.writes()).toEqual([]);
  });

  it('stops when told to', async () => {
    const kv = createMemoryKv();
    const fresh = await open(kv);
    const clock = manualTimers();
    kv.failNext('getAll', 5, away());
    const { late } = start(fresh, clock);
    late.stop();
    expect(clock.delays()).toEqual([]);
    late.retryNow();
    await late.settled();
    expect(fullReads(kv)).toBe(0);
  });
});

describe('backup safety', () => {
  it('an empty store never overwrites the backup while Decaid cannot be read, and merges it in first once it can', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    kv.failNext('getAll', 3, away());
    const fresh = await open(kv);
    const restored = vi.fn();
    fresh.onRestored(restored);
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('unreachable');
    await fresh.bags.put(OTHER_BAG);

    await fresh.mirror.pushNow();
    await fresh.mirror.pushNow();
    expect(kv.writes().filter((call) => call.key === 'bags')).toHaveLength(1);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_kiambu']);
    expect(fresh.mirror.lastError).toBe('Could not back up to Decaid: Decaid is not answering.');
    expect(restored).not.toHaveBeenCalled();

    await fresh.mirror.pushNow();
    expect(fresh.mirror.lastError).toBeNull();
    expect(bagIds(await fresh.bags.list())).toEqual(['bag_kiambu', 'bag_other']);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_kiambu', 'bag_other']);
    expect(kv.values()['conv.bag_kiambu']).toEqual(makeConversation());
    // The records the first push merged in came back after start: the screens are told (5.4).
    expect(restored).toHaveBeenCalledTimes(1);
  });

  it('an empty store never pushes while Decaid answers something CafAI cannot read (5.3)', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();
    const before = kv.writes().length;

    kv.failNext('getAll', 3, garbled());
    const fresh = await open(kv);
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('unreadable');
    await fresh.bags.put(OTHER_BAG);
    await fresh.mirror.pushNow();
    await fresh.mirror.pushNow();
    expect(kv.writes()).toHaveLength(before);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_kiambu']);
    expect(fresh.mirror.lastError).toBe("Could not back up to Decaid: Decaid sent a reply CafAI doesn't recognise.");
  });

  it('says nothing when the first push finds nothing new in the backup', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const fresh = await open(kv);
    const restored = vi.fn();
    fresh.onRestored(restored);
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe('restored');
    await fresh.settings.update({ grinderSetting: '15' });
    await fresh.mirror.pushNow();
    expect(fresh.mirror.lastError).toBeNull();
    expect(restored).not.toHaveBeenCalled();
  });

  it('after an import that replaced everything, the old backup is not merged back', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const fresh = await open(kv);
    const file = { ...(await fresh.porter.exportAll()), bags: [OTHER_BAG] };
    await fresh.porter.importAll(file, 'replace');
    await fresh.mirror.pushNow();
    expect(bagIds(await fresh.bags.list())).toEqual(['bag_other']);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_other']);
    expect(kv.values()['conv.bag_kiambu']).toBeUndefined();
  });

  it('a store that had data at start is the reference: its push replaces the mirrored lists', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    const where = names();
    const local = await open(kv, where);
    await local.bags.put(OTHER_BAG);
    local.close();
    const reloaded = await open(kv, where);
    await reloaded.mirror.pushNow();
    expect(bagIds(await reloaded.bags.list())).toEqual(['bag_other']);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_other']);
  });
});

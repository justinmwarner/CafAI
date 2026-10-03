import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIdbStorage,
  exportFileName,
  restoreFromMirrorIfEmpty,
  serializeExport,
  type CreateIdbStorageOptions,
  type IdbStorage,
} from './index.ts';
import { createMemoryKv, type MemoryKv } from './testing/memoryKv.ts';
import type { Bag, IterationRecord } from './types.ts';
import {
  API_KEY,
  MODEL,
  makeBag,
  makeConversation,
  makeIteration,
  makeSettings,
  makeVersion,
  uniqueDbName,
} from './testing/fixtures.ts';

const NOW = new Date('2026-10-03T09:30:00.000Z');
const opened: IdbStorage[] = [];

afterEach(() => {
  for (const storage of opened.splice(0)) storage.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function names() {
  return { dbName: uniqueDbName(), secretsDbName: uniqueDbName('secrets') };
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

  it('says in plain words when the browser blocks storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(open(createMemoryKv())).rejects.toMatchObject({ name: 'StorageError', kind: 'unavailable' });
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
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe(true);
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

  it('only fills blank settings, keeping the ones already set here', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.settings.update({ model: 'claude-sonnet-5' });
    await original.mirror.pushNow();

    const fresh = await open(kv);
    await fresh.settings.update({ model: 'claude-haiku-4-5', grinderName: 'Lagom 01' });
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe(true);
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
    expect(await restoreFromMirrorIfEmpty(other)).toBe(false);
    expect(await other.bags.list()).toEqual([OTHER_BAG]);
  });

  it('does nothing when the mirror is empty', async () => {
    const storage = await open(createMemoryKv());
    expect(await restoreFromMirrorIfEmpty(storage)).toBe(false);
    expect(await storage.bags.list()).toEqual([]);
  });

  it('returns false instead of throwing when Decaid cannot be read', async () => {
    const kv = createMemoryKv();
    kv.failNext('getAll');
    const storage = await open(kv);
    expect(await restoreFromMirrorIfEmpty(storage)).toBe(false);
  });
});

describe('backup safety', () => {
  it('an empty store never overwrites the backup while Decaid cannot be read, and merges it in first once it can', async () => {
    const kv = createMemoryKv();
    const original = await open(kv);
    await seed(original);
    await original.mirror.pushNow();

    kv.failNext('getAll', 3);
    const fresh = await open(kv);
    expect(await restoreFromMirrorIfEmpty(fresh)).toBe(false);
    await fresh.bags.put(OTHER_BAG);

    await fresh.mirror.pushNow();
    await fresh.mirror.pushNow();
    expect(kv.writes().filter((call) => call.key === 'bags')).toHaveLength(1);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_kiambu']);
    expect(fresh.mirror.lastError).toBe('Could not back up to Decaid: Decaid is not answering.');

    await fresh.mirror.pushNow();
    expect(fresh.mirror.lastError).toBeNull();
    expect(bagIds(await fresh.bags.list())).toEqual(['bag_kiambu', 'bag_other']);
    expect(bagIds(kv.values()['bags'])).toEqual(['bag_kiambu', 'bag_other']);
    expect(kv.values()['conv.bag_kiambu']).toEqual(makeConversation());
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

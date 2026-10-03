import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { createDbHandle, openCafaiDb, SETTINGS_KEY, type CafaiDb } from './db.ts';
import { createRepositories } from './repositories.ts';
import { STORAGE_MESSAGES } from './errors.ts';
import type { Bag } from './types.ts';
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

function setup() {
  const name = uniqueDbName();
  const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
  const writes = { count: 0 };
  const repos = createRepositories({ db: () => handle.get(), onWrite: () => void (writes.count += 1), defaultModel: MODEL });
  return { name, handle, writes, repos };
}

/** A second, independent connection only sees committed data. */
async function readCommitted<T>(name: string, read: (db: CafaiDb) => Promise<T>): Promise<T> {
  const db = (await openDB(name)) as unknown as CafaiDb;
  try {
    return await read(db);
  } finally {
    db.close();
  }
}

describe('BagRepository', () => {
  it('stores a bag exactly as given and reads it back', async () => {
    const { repos } = setup();
    const bag = { ...makeBag(), extra: { kept: true } } as Bag;
    await repos.bags.put(bag);
    expect(await repos.bags.get(bag.id)).toEqual(bag);
  });

  it('has committed the bag by the time put() resolves', async () => {
    const { name, repos } = setup();
    await repos.bags.put(makeBag());
    expect(await readCommitted(name, (db) => db.get('bags', 'bag_kiambu'))).toEqual(makeBag());
  });

  it('returns undefined for an unknown bag', async () => {
    const { repos } = setup();
    expect(await repos.bags.get('nope')).toBeUndefined();
  });

  it('replaces a bag with the same id', async () => {
    const { repos } = setup();
    await repos.bags.put(makeBag());
    await repos.bags.put(makeBag({ name: 'Kiambu AA (2nd bag)', updatedAt: '2026-10-02T08:00:00.000Z' }));
    expect(await repos.bags.list()).toEqual([makeBag({ name: 'Kiambu AA (2nd bag)', updatedAt: '2026-10-02T08:00:00.000Z' })]);
  });

  it('lists bags oldest first', async () => {
    const { repos } = setup();
    const newer = makeBag({ id: 'bag_a', createdAt: '2026-10-02T08:00:00.000Z' });
    const older = makeBag({ id: 'bag_z', createdAt: '2026-09-20T08:00:00.000Z' });
    await repos.bags.put(newer);
    await repos.bags.put(older);
    expect((await repos.bags.list()).map((bag) => bag.id)).toEqual(['bag_z', 'bag_a']);
  });

  it('asks for a mirror push after every successful write', async () => {
    const { repos, writes } = setup();
    await repos.bags.put(makeBag());
    await repos.versions.put(makeVersion());
    await repos.iterations.put(makeIteration());
    await repos.conversations.put(makeConversation());
    await repos.settings.update({ grinderName: 'Niche Zero' });
    expect(writes.count).toBe(5);
  });

  it('does not ask for a push when the write fails, and says so in plain words', async () => {
    const { repos, writes } = setup();
    const broken = { ...makeBag(), id: undefined } as unknown as Bag;
    await expect(repos.bags.put(broken)).rejects.toMatchObject({ name: 'StorageError', message: STORAGE_MESSAGES.write });
    expect(writes.count).toBe(0);
  });

  it('never lets a failing push hook turn a committed write into an error', async () => {
    const name = uniqueDbName();
    const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
    const repos = createRepositories({
      db: () => handle.get(),
      onWrite: () => {
        throw new Error('mirror bug');
      },
      defaultModel: MODEL,
    });
    await expect(repos.bags.put(makeBag())).resolves.toBeUndefined();
    expect(await repos.bags.get('bag_kiambu')).toEqual(makeBag());
  });
});

describe('VersionRepository', () => {
  it('lists only the versions of one bag, sorted by version number', async () => {
    const { repos } = setup();
    await repos.versions.put(makeVersion({ id: 'v3', version: 3, createdAt: '2026-10-01T09:00:00.000Z' }));
    await repos.versions.put(makeVersion({ id: 'v1', version: 1, createdAt: '2026-10-01T09:20:00.000Z' }));
    await repos.versions.put(makeVersion({ id: 'v2', version: 2 }));
    await repos.versions.put(makeVersion({ id: 'other', bagId: 'bag_other' }));
    expect((await repos.versions.listByBag('bag_kiambu')).map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(await repos.versions.listByBag('bag_none')).toEqual([]);
  });

  it('gets and replaces a version', async () => {
    const { repos } = setup();
    await repos.versions.put(makeVersion());
    await repos.versions.put(makeVersion({ status: 'superseded' }));
    expect(await repos.versions.get('ver_kiambu_1')).toEqual(makeVersion({ status: 'superseded' }));
    expect(await repos.versions.get('nope')).toBeUndefined();
  });
});

describe('IterationRepository', () => {
  it('lists one bag’s iterations by createdAt', async () => {
    const { repos } = setup();
    await repos.iterations.put(makeIteration({ id: 'b', createdAt: '2026-10-01T11:00:00.000Z' }));
    await repos.iterations.put(makeIteration({ id: 'a', createdAt: '2026-10-01T10:00:00.000Z' }));
    await repos.iterations.put(makeIteration({ id: 'x', bagId: 'bag_other', createdAt: '2026-10-01T09:00:00.000Z' }));
    expect((await repos.iterations.listByBag('bag_kiambu')).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('lists every iteration by createdAt', async () => {
    const { repos } = setup();
    await repos.iterations.put(makeIteration({ id: 'b', createdAt: '2026-10-01T11:00:00.000Z' }));
    await repos.iterations.put(makeIteration({ id: 'x', bagId: 'bag_other', createdAt: '2026-10-01T09:00:00.000Z' }));
    await repos.iterations.put(makeIteration({ id: 'a', createdAt: '2026-10-01T10:00:00.000Z' }));
    expect((await repos.iterations.listAll()).map((i) => i.id)).toEqual(['x', 'a', 'b']);
  });

  it('gets and replaces an iteration, full series included', async () => {
    const { repos } = setup();
    await repos.iterations.put(makeIteration());
    await repos.iterations.put(makeIteration({ outcome: 'applied', updatedAt: '2026-10-01T10:09:00.000Z' }));
    const stored = await repos.iterations.get('it_kiambu_1');
    expect(stored).toEqual(makeIteration({ outcome: 'applied', updatedAt: '2026-10-01T10:09:00.000Z' }));
    expect(stored?.summary?.series.tS).toHaveLength(32);
  });
});

describe('ConversationRepository', () => {
  it('stores the transcript exactly, thinking blocks and signatures included', async () => {
    const { repos } = setup();
    await repos.conversations.put(makeConversation());
    expect(await repos.conversations.get('conv_kiambu')).toEqual(makeConversation());
    expect(await repos.conversations.get('nope')).toBeUndefined();
  });
});

describe('SettingsRepository', () => {
  it('starts from the defaults', async () => {
    const { repos } = setup();
    expect(await repos.settings.get()).toEqual(makeSettings());
  });

  it('applies a patch, returns the result and keeps it', async () => {
    const { name, repos } = setup();
    const next = await repos.settings.update({ grinderName: 'Niche Zero', grinderSetting: '14' });
    expect(next).toEqual(makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14' }));
    expect(await repos.settings.get()).toEqual(next);
    expect(await readCommitted(name, (db) => db.get('settings', SETTINGS_KEY))).toEqual(next);
  });

  it('keeps earlier fields across patches', async () => {
    const { repos } = setup();
    await repos.settings.update({ grinderName: 'Niche Zero' });
    await repos.settings.update({ activeBagId: 'bag_kiambu' });
    expect(await repos.settings.get()).toEqual(makeSettings({ grinderName: 'Niche Zero', activeBagId: 'bag_kiambu' }));
  });

  it('applies concurrent patches one after the other, losing neither', async () => {
    const { repos } = setup();
    await Promise.all([repos.settings.update({ grinderName: 'Lagom 01' }), repos.settings.update({ grinderSetting: '0.4' })]);
    expect(await repos.settings.get()).toEqual(makeSettings({ grinderName: 'Lagom 01', grinderSetting: '0.4' }));
  });

  it('never stores anything but the four settings, even if a caller passes an API key', async () => {
    const { name, repos } = setup();
    await repos.settings.update({ grinderName: 'Niche Zero', apiKey: API_KEY } as never);
    const raw = await readCommitted(name, (db) => db.get('settings', SETTINGS_KEY));
    expect(raw).toEqual(makeSettings({ grinderName: 'Niche Zero' }));
    expect(JSON.stringify(raw)).not.toContain(API_KEY);
  });

  it('reads a damaged settings record leniently', async () => {
    const { name, repos } = setup();
    await repos.settings.get();
    const db = (await openDB(name)) as unknown as CafaiDb;
    await db.put('settings', { model: 7, grinderName: 'Niche Zero' } as never, SETTINGS_KEY);
    db.close();
    expect(await repos.settings.get()).toEqual(makeSettings({ grinderName: 'Niche Zero' }));
  });
});

describe('failures', () => {
  it('turns a read failure into a sentence', async () => {
    const repos = createRepositories({
      db: () => Promise.reject(new DOMException('Internal error opening backing store', 'UnknownError')),
      onWrite: () => undefined,
      defaultModel: MODEL,
    });
    await expect(repos.bags.list()).rejects.toMatchObject({ name: 'StorageError', kind: 'read', message: STORAGE_MESSAGES.read });
  });

  it('reports a full disk as such', async () => {
    const repos = createRepositories({
      db: () => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')),
      onWrite: () => undefined,
      defaultModel: MODEL,
    });
    await expect(repos.iterations.put(makeIteration())).rejects.toMatchObject({ kind: 'quota', message: STORAGE_MESSAGES.quota });
  });
});

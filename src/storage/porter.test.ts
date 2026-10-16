import { describe, expect, it } from 'vitest';
import { createCareRepository, openCareDb } from './careDb.ts';
import { createDbHandle, openCafaiDb } from './db.ts';
import { createRepositories } from './repositories.ts';
import { openSecretStore, REDACTED } from './secrets.ts';
import {
  careRecordWins,
  createDataPorter,
  exportFileName,
  ImportError,
  IMPORT_MESSAGES,
  parseCafaiExport,
  serializeExport,
} from './porter.ts';
import { DEFAULT_APPEARANCE } from './settings.ts';
import type { CafaiExport, SecretStore } from './types.ts';
import {
  API_KEY,
  MODEL,
  makeBag,
  makeCareRecord,
  makeConversation,
  makeIteration,
  makeSettings,
  makeSummary,
  makeVersion,
  uniqueDbName,
} from './testing/fixtures.ts';

const NOW = new Date('2026-10-03T09:30:00.000Z');

async function setup(secrets?: Pick<SecretStore, 'getApiKey'>) {
  const name = uniqueDbName();
  const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
  const careHandle = createDbHandle((onLost) => openCareDb(uniqueDbName('care'), onLost));
  const db = () => handle.get();
  const careDb = () => careHandle.get();
  const repos = { ...createRepositories({ db, onWrite: () => undefined, defaultModel: MODEL }), care: createCareRepository({ db: careDb, onWrite: () => undefined }) };
  const mirror = {
    pushes: 0,
    replaced: 0,
    schedulePush() {
      mirror.pushes += 1;
    },
    noteReplaced() {
      mirror.replaced += 1;
    },
  };
  const porter = createDataPorter({
    db,
    careDb,
    secrets: secrets ?? { getApiKey: async () => null },
    mirror,
    appVersion: '1.2.3',
    defaultModel: MODEL,
    now: () => NOW,
  });
  return { repos, porter, mirror, careHandle };
}

const VERSION_2 = makeVersion({
  id: 'ver_kiambu_2',
  version: 2,
  title: 'Kiambu AA v2',
  parentVersionId: 'ver_kiambu_1',
  change: {
    variable: 'profile',
    lever: 'temp',
    from: 92,
    to: 93,
    diffLines: ['Brew temperature: 92.0 °C -> 93.0 °C (all steps)'],
    summary: 'Raise brew temperature by 1 °C',
  },
  createdAt: '2026-10-01T10:08:00.000Z',
});

async function seed(repos: Awaited<ReturnType<typeof setup>>['repos']) {
  await repos.bags.put(makeBag());
  await repos.versions.put(makeVersion({ status: 'superseded' }));
  await repos.versions.put(VERSION_2);
  await repos.iterations.put(makeIteration({ outcome: 'applied', change: VERSION_2.change }));
  await repos.conversations.put(makeConversation());
  await repos.settings.update({ grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' });
}

function exportOf(overrides: Partial<CafaiExport> = {}): CafaiExport {
  return {
    format: 'cafai-export',
    schemaVersion: 1,
    exportedAt: NOW.toISOString(),
    appVersion: '1.2.3',
    settings: makeSettings(),
    bags: [],
    versions: [],
    iterations: [],
    conversations: [],
    care: [],
    ...overrides,
  };
}

describe('exportAll', () => {
  it('exports every record and the settings, marked as a CafAI export', async () => {
    const { repos, porter } = await setup();
    await seed(repos);
    expect(await porter.exportAll()).toEqual(
      exportOf({
        settings: makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' }),
        bags: [makeBag()],
        versions: [makeVersion({ status: 'superseded' }), VERSION_2],
        iterations: [makeIteration({ outcome: 'applied', change: VERSION_2.change })],
        conversations: [makeConversation()],
      }),
    );
  });

  it('exports an empty store as empty lists and default settings', async () => {
    const { porter } = await setup();
    expect(await porter.exportAll()).toEqual(exportOf());
  });

  it('contains no API key, not even one pasted into a note or the chat', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    await secrets.setApiKey(API_KEY);
    const { repos, porter } = await setup(secrets);
    await seed(repos);
    await repos.bags.put(makeBag({ notes: `my key is ${API_KEY}` }));
    await repos.conversations.put(
      makeConversation({ apiMessages: [{ role: 'user', content: [{ type: 'text', text: `use ${API_KEY}` }] }] }),
    );
    const text = serializeExport(await porter.exportAll());
    expect(text).not.toContain(API_KEY);
    expect(text).toContain(REDACTED);
    expect(text).not.toMatch(/apiKey/i);
  });
});

describe('serializeExport and exportFileName', () => {
  it('serializes as pretty JSON that parses back to the same export', () => {
    const data = exportOf({ bags: [makeBag()] });
    const text = serializeExport(data);
    expect(text).toContain('\n  "format": "cafai-export"');
    expect(JSON.parse(text)).toEqual(data);
  });

  it('names the file after the local date', () => {
    expect(exportFileName(new Date(2026, 9, 3, 23, 59))).toBe('cafai-export-2026-10-03.json');
    expect(exportFileName(new Date(2027, 0, 9, 0, 1))).toBe('cafai-export-2027-01-09.json');
  });
});

describe('import validation', () => {
  it('rejects anything that is not a CafAI export with one clear sentence', async () => {
    const { porter } = await setup();
    for (const data of [null, [], 'hello', '{not json', 42, {}, { format: 'other', schemaVersion: 1 }]) {
      await expect(porter.importAll(data, 'merge')).rejects.toThrow(new ImportError(IMPORT_MESSAGES.notAnExport));
    }
    expect(IMPORT_MESSAGES.notAnExport).toBe('This is not a CafAI export file.');
  });

  it('asks for an update when the file comes from a newer CafAI', async () => {
    const { porter } = await setup();
    await expect(porter.importAll({ ...exportOf(), schemaVersion: 2 }, 'merge')).rejects.toThrow(IMPORT_MESSAGES.newerVersion);
  });

  it('names the damaged field and imports nothing', async () => {
    const { repos, porter } = await setup();
    const damaged = exportOf({ bags: [makeBag({ id: 'bag_ok' }), { ...makeBag(), name: 5 } as never] });
    const error: unknown = await porter.importAll(damaged, 'replace').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as Error).message).toBe(
      'This CafAI export file is damaged, so nothing was imported (the problem is at bags[1].name).',
    );
    expect(await repos.bags.list()).toEqual([]);
  });

  it('accepts the JSON text of an export as well as the parsed object', async () => {
    const { repos, porter } = await setup();
    await porter.importAll(serializeExport(exportOf({ bags: [makeBag()] })), 'merge');
    expect(await repos.bags.list()).toEqual([makeBag()]);
  });

  it('reads a missing nullable field as null (JSON drops undefined)', () => {
    const { roaster: _roaster, ...bagWithoutRoaster } = makeBag();
    const parsed = parseCafaiExport(exportOf({ bags: [bagWithoutRoaster as never] }));
    expect(parsed.bags[0]?.roaster).toBeNull();
  });

  it('drops unknown fields of a record but keeps nested data exactly as stored', () => {
    const profile = { ...makeVersion().profile, future_key: 'kept' };
    const conversation = makeConversation({
      apiMessages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 's', extra: 1 } as never] }],
    });
    const parsed = parseCafaiExport(
      exportOf({
        bags: [{ ...makeBag(), legacy: true } as never],
        versions: [makeVersion({ profile })],
        conversations: [conversation],
      }),
    );
    expect(parsed.bags[0]).toEqual(makeBag());
    expect(parsed.versions[0]?.profile).toEqual(profile);
    expect(JSON.stringify(parsed.conversations[0]?.apiMessages)).toBe(JSON.stringify(conversation.apiMessages));
  });

  it("keeps an iteration's Visualizer link, and leaves an older iteration without one as it was (6.4)", () => {
    const url = 'https://visualizer.coffee/shots/c5b6b2b8-0f2e';
    const parsed = parseCafaiExport(exportOf({ iterations: [makeIteration({ visualizerUrl: url }), makeIteration({ id: 'iter_older' })] }));
    expect(parsed.iterations[0]?.visualizerUrl).toBe(url);
    expect(parsed.iterations[1]).not.toHaveProperty('visualizerUrl');
    expect(() => parseCafaiExport(exportOf({ iterations: [makeIteration({ visualizerUrl: 42 as never })] }))).toThrow(ImportError);
  });

  it("keeps a shot's TDS and EY in its summary, and refuses numbers that are not numbers (D166)", () => {
    const measured = { ...makeSummary(), tdsPct: 9.25, eyPct: 20.8 };
    const noEy = { ...makeSummary(), tdsPct: 9.25, eyPct: null };
    const parsed = parseCafaiExport(exportOf({ iterations: [makeIteration({ summary: measured }), makeIteration({ id: 'iter_no_ey', summary: noEy })] }));
    expect(parsed.iterations[0]?.summary).toEqual(measured);
    expect(parsed.iterations[1]?.summary).toEqual(noEy);
    expect(() => parseCafaiExport(exportOf({ iterations: [makeIteration({ summary: { ...makeSummary(), tdsPct: '9.25' as never } })] }))).toThrow(ImportError);
  });

  it('accepts iterations without summary.series, as restored from the mirror', () => {
    const { series: _series, ...summary } = makeSummary();
    const parsed = parseCafaiExport(exportOf({ iterations: [makeIteration({ summary: summary as never })] }));
    expect(parsed.iterations[0]?.summary).toEqual(summary);
  });

  it('never accepts an API key in the settings', () => {
    const parsed = parseCafaiExport({ ...exportOf(), settings: { ...makeSettings(), apiKey: API_KEY } });
    expect(JSON.stringify(parsed)).not.toContain(API_KEY);
  });

  it('reads an export made before grinder links as not linked', () => {
    const older = { model: MODEL, grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: 'bag_kiambu' };
    const parsed = parseCafaiExport({ ...exportOf(), settings: older });
    expect(parsed.settings).toEqual({ ...older, grinderId: null });
  });

  it('keeps a linked grinder, and refuses a link that is not text', () => {
    const linked = makeSettings({ grinderName: 'Niche Zero', grinderId: 'c0ffee00-0a5e-4c1e-8a11-000000000001' });
    expect(parseCafaiExport(exportOf({ settings: linked })).settings).toEqual(linked);
    expect(() => parseCafaiExport({ ...exportOf(), settings: { ...linked, grinderId: 42 } })).toThrow(ImportError);
  });
});

describe('importAll replace', () => {
  it('round-trips an export into another store', async () => {
    const a = await setup();
    await seed(a.repos);
    const exported = await a.porter.exportAll();
    const b = await setup();
    await b.porter.importAll(JSON.parse(serializeExport(exported)), 'replace');
    expect(await b.porter.exportAll()).toEqual(exported);
  });

  it('removes local records that are not in the file and takes the file’s settings', async () => {
    const { repos, porter } = await setup();
    await seed(repos);
    await porter.importAll(exportOf({ bags: [makeBag({ id: 'bag_new' })], settings: makeSettings({ grinderName: 'Lagom 01' }) }), 'replace');
    expect((await repos.bags.list()).map((bag) => bag.id)).toEqual(['bag_new']);
    expect(await repos.versions.listByBag('bag_kiambu')).toEqual([]);
    expect(await repos.iterations.listAll()).toEqual([]);
    expect(await repos.conversations.get('conv_kiambu')).toBeUndefined();
    expect(await repos.settings.get()).toEqual(makeSettings({ grinderName: 'Lagom 01' }));
  });

  it('never touches the API key', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    await secrets.setApiKey(API_KEY);
    const { repos, porter } = await setup(secrets);
    await seed(repos);
    await porter.importAll(exportOf(), 'replace');
    expect(await secrets.getApiKey()).toBe(API_KEY);
  });

  it('round-trips a grinder linked to Decaid, and loads an older file as not linked', async () => {
    const linked = makeSettings({ grinderName: 'Niche Zero', grinderSetting: '14', grinderId: 'c0ffee00-0a5e-4c1e-8a11-000000000001' });
    const a = await setup();
    await a.porter.importAll(exportOf({ settings: linked }), 'replace');
    expect(await a.repos.settings.get()).toEqual(linked);
    expect((await a.porter.exportAll()).settings).toEqual(linked);

    const older = { model: MODEL, grinderName: 'DF64', grinderSetting: '2.5', activeBagId: null };
    await a.porter.importAll({ ...exportOf(), settings: older }, 'replace');
    expect(await a.repos.settings.get()).toEqual({ ...older, grinderId: null, appearance: DEFAULT_APPEARANCE });
  });

  it('returns the number of records imported and asks the mirror to push the new state', async () => {
    const a = await setup();
    await seed(a.repos);
    const exported = await a.porter.exportAll();
    const b = await setup();
    expect(await b.porter.importAll(exported, 'replace')).toEqual({ imported: 5 });
    expect(b.mirror).toMatchObject({ pushes: 1, replaced: 1 });
  });

  it('changes nothing when a record cannot be written', async () => {
    const { repos, porter } = await setup();
    await seed(repos);
    const unstorable = makeVersion({ id: 'ver_bad', profile: { ...makeVersion().profile, hook: () => 1 } as never });
    await expect(porter.importAll(exportOf({ versions: [unstorable] }), 'replace')).rejects.toMatchObject({ name: 'StorageError' });
    expect(await repos.bags.list()).toEqual([makeBag()]);
    expect(await repos.settings.get()).toMatchObject({ grinderName: 'Niche Zero' });
  });
});

describe('importAll merge', () => {
  it('round-trips an export into an empty store', async () => {
    const a = await setup();
    await seed(a.repos);
    const exported = await a.porter.exportAll();
    const b = await setup();
    expect(await b.porter.importAll(serializeExport(exported), 'merge')).toEqual({ imported: 5 });
    expect(await b.porter.exportAll()).toEqual(exported);
  });

  it('adds records that are missing locally', async () => {
    const { repos, porter } = await setup();
    await repos.bags.put(makeBag({ id: 'bag_local' }));
    const result = await porter.importAll(exportOf({ bags: [makeBag()], iterations: [makeIteration()] }), 'merge');
    expect(result).toEqual({ imported: 2 });
    expect((await repos.bags.list()).map((bag) => bag.id).sort()).toEqual(['bag_kiambu', 'bag_local']);
  });

  it('takes a record whose incoming updatedAt is newer', async () => {
    const { repos, porter } = await setup();
    await repos.bags.put(makeBag({ name: 'old', updatedAt: '2026-10-01T08:00:00.000Z' }));
    await porter.importAll(exportOf({ bags: [makeBag({ name: 'new', updatedAt: '2026-10-02T08:00:00.000Z' })] }), 'merge');
    expect((await repos.bags.get('bag_kiambu'))?.name).toBe('new');
  });

  it('keeps a local record that is newer or just as new', async () => {
    const { repos, porter } = await setup();
    await repos.bags.put(makeBag({ name: 'local', updatedAt: '2026-10-02T08:00:00.000Z' }));
    await repos.conversations.put(makeConversation({ updatedAt: '2026-10-01T10:05:40.000Z' }));
    const result = await porter.importAll(
      exportOf({
        bags: [makeBag({ name: 'older', updatedAt: '2026-10-01T08:00:00.000Z' })],
        conversations: [makeConversation({ apiMessages: [], updatedAt: '2026-10-01T10:05:40.000Z' })],
      }),
      'merge',
    );
    expect(result).toEqual({ imported: 0 });
    expect((await repos.bags.get('bag_kiambu'))?.name).toBe('local');
    expect((await repos.conversations.get('conv_kiambu'))?.apiMessages).toHaveLength(3);
  });

  it('compares profile versions by createdAt', async () => {
    const { repos, porter } = await setup();
    await repos.versions.put(makeVersion({ status: 'active', createdAt: '2026-10-01T08:01:00.000Z' }));
    await porter.importAll(exportOf({ versions: [makeVersion({ status: 'superseded', createdAt: '2026-10-01T09:00:00.000Z' })] }), 'merge');
    expect((await repos.versions.get('ver_kiambu_1'))?.status).toBe('superseded');
  });

  it('fills blank settings and keeps the ones set on this device', async () => {
    const { repos, porter } = await setup();
    await repos.settings.update({ grinderName: 'Niche Zero' });
    await porter.importAll(
      exportOf({ settings: makeSettings({ model: 'claude-sonnet-5', grinderName: 'Lagom 01', grinderSetting: '0.4' }) }),
      'merge',
    );
    expect(await repos.settings.get()).toEqual(
      makeSettings({ model: 'claude-sonnet-5', grinderName: 'Niche Zero', grinderSetting: '0.4' }),
    );
  });

  it('fills a blank grinder with the incoming one, link included', async () => {
    const { repos, porter } = await setup();
    await porter.importAll(exportOf({ settings: makeSettings({ grinderName: 'Niche Zero', grinderId: 'g-1' }) }), 'merge');
    expect(await repos.settings.get()).toMatchObject({ grinderName: 'Niche Zero', grinderId: 'g-1' });
  });

  it('asks the mirror to push, without claiming local data was replaced', async () => {
    const { porter, mirror } = await setup();
    await porter.importAll(exportOf({ bags: [makeBag()] }), 'merge');
    expect(mirror).toMatchObject({ pushes: 1, replaced: 0 });
  });
});

describe("machine care's records (D189)", () => {
  const NEVER = { doneAt: null, by: null } as const;

  it('travel in the export and back, and a replace takes the file’s', async () => {
    const a = await setup();
    await a.repos.care.put(makeCareRecord({ id: 'rinza' }));
    await a.repos.care.put(makeCareRecord());
    const file = await a.porter.exportAll();
    expect(file.care?.map((record) => record.id)).toEqual(['detergent-clean', 'rinza']);

    const b = await setup();
    await b.repos.care.put(makeCareRecord({ id: 'descale' }));
    expect(await b.porter.importAll(JSON.parse(serializeExport(file)), 'replace')).toEqual({ imported: 2 });
    expect(await b.repos.care.list()).toEqual(file.care);
  });

  it('live in their own database: one that cannot be opened stops an import before anything is written', async () => {
    const name = uniqueDbName();
    const handle = createDbHandle((onLost) => openCafaiDb(name, onLost));
    const porter = createDataPorter({
      db: () => handle.get(),
      careDb: () => Promise.reject(new DOMException('The requested version (1) is less than the existing version (2).', 'VersionError')),
      secrets: { getApiKey: async () => null },
      mirror: { schedulePush: () => undefined },
      appVersion: '1.2.3',
      defaultModel: MODEL,
      now: () => NOW,
    });
    await expect(porter.importAll(exportOf({ bags: [makeBag()], care: [makeCareRecord()] }), 'replace')).rejects.toMatchObject({ kind: 'newer' });
    const db = await handle.get();
    expect(await db.getAll('bags')).toEqual([]);
    handle.close();
  });

  it('an older file, without them, imports and leaves the steps as they were on a merge', async () => {
    const { repos, porter } = await setup();
    await repos.care.put(makeCareRecord());
    const { care: _care, ...older } = exportOf({ bags: [makeBag()] });
    await porter.importAll(older, 'merge');
    expect(await repos.care.list()).toEqual([makeCareRecord()]);
    expect(parseCafaiExport(older).care).toBeUndefined();
  });

  it('a merge keeps the later last time, whatever the records’ updatedAt says', async () => {
    const { repos, porter } = await setup();
    await repos.care.put(makeCareRecord({ doneAt: '2026-10-08T08:00:00.000Z', updatedAt: '2026-10-08T08:00:00.000Z' }));
    const older = makeCareRecord({ doneAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-12T08:00:00.000Z' });
    expect(await porter.importAll(exportOf({ care: [older] }), 'merge')).toEqual({ imported: 0 });
    const later = makeCareRecord({ doneAt: '2026-10-11T08:00:00.000Z', shotTotal: 180 });
    expect(await porter.importAll(exportOf({ care: [later, makeCareRecord({ id: 'rinza' })] }), 'merge')).toEqual({ imported: 2 });
    expect(await repos.care.list()).toEqual([later, makeCareRecord({ id: 'rinza' })]);
  });

  it('a record marked done outranks one never marked, and of two never marked the earlier start wins', () => {
    const done = makeCareRecord();
    const fresh = makeCareRecord({ ...NEVER, countFrom: '2026-10-14T08:00:00.000Z', updatedAt: '2026-10-14T08:00:00.000Z' });
    const earlier = makeCareRecord({ ...NEVER, countFrom: '2026-09-20T08:00:00.000Z' });
    expect(careRecordWins(done, fresh)).toBe(true);
    expect(careRecordWins(fresh, done)).toBe(false);
    expect(careRecordWins(earlier, fresh)).toBe(true);
    expect(careRecordWins(fresh, earlier)).toBe(false);
    expect(careRecordWins(done, done)).toBe(false);
  });

  it('reads what it cannot use as unknown, so a file from a newer CafAI still imports; a record without its step or times is damage', () => {
    const odd = { ...makeCareRecord(), by: 'machine', shotTotal: -3, steamTotal: 'many', extra: true };
    expect(parseCafaiExport(exportOf({ care: [odd as never] })).care).toEqual([makeCareRecord({ by: null, shotTotal: null, steamTotal: null })]);
    expect(() => parseCafaiExport(exportOf({ care: [{ ...makeCareRecord(), countFrom: '' }] }))).toThrow(IMPORT_MESSAGES.damaged('care[0].countFrom'));
  });
});

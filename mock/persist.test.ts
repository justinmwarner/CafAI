import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShotRecord } from '../src/api/types.ts';
import type { DecaidProfileRecord } from './decaid/profiles.ts';
import { fixtures } from './fixtures/index.ts';
import { createShotPlayer } from './decaid/shotPlayer.ts';
import { createMockDecaid, type MockDecaid } from './decaid/state.ts';
import { createMockServer } from './node.ts';
import {
  MAX_SNAPSHOT_CHARS,
  MOCK_STORE_KEY,
  MOCK_STORE_PREFIX,
  parseSnapshot,
  restoreStore,
  serializeSnapshot,
  snapshotStore,
  startMockPersistence,
  type MockPersistenceEnv,
  type MockStoreSnapshot,
} from './persist.ts';

const BLOOMING = 'profile:7438cb7266f60558b48f';
const DFLOW = 'profile:59036f8846b1ed3b4255';
const EXAMPLE_SHOT = fixtures.shotRecord().id;

afterEach(() => {
  vi.useRealTimers();
});

/** A store after a CafAI session: the backup keys, two versions as profiles (v1 hidden), the workflow on v2, a shot. */
function usedStore(): MockDecaid {
  const state = createMockDecaid();
  const bundled = state.getProfile(BLOOMING).profile;
  const v1 = state.createProfile({
    profile: { ...bundled, title: 'Kiambu AA v1', target_weight: 50 },
    parentId: BLOOMING,
    metadata: { source: 'cafai', iteration: 1 },
  });
  const v2Profile = {
    ...v1.profile,
    title: 'Kiambu AA v2',
    steps: v1.profile.steps.map((step) => ({ ...step, temperature: step.temperature + 1 })),
  };
  state.createProfile({ profile: v2Profile, parentId: v1.id, metadata: { source: 'cafai', iteration: 2 } });
  state.setProfileVisibility(v1.id, { visibility: 'hidden' });
  // CafAI clears the context fields it does not know (D45), so the saved
  // workflow lacks fields the fresh mock's example workflow has.
  state.updateWorkflow({
    profile: v2Profile,
    context: { targetYield: 50, coffeeName: 'Kiambu AA', grinderId: null, beanBatchId: null, extras: { cafai: { versionId: 'ver-2', bagId: 'bag-1' } } },
  });
  const shot: ShotRecord = { ...fixtures.shotRecord(), id: 'shot-kiambu', timestamp: '2026-10-04T09:00:00.000000', workflow: state.getWorkflow() };
  state.addShot(shot);
  state.updateShot('shot-kiambu', { annotations: { espressoNotes: 'Sour / sharp (CafAI)' } });
  state.kvSet('cafai', 'settings', JSON.stringify({ model: 'claude-opus-5-5', activeBagId: 'bag-1' }));
  state.kvSet('cafai', 'bags', JSON.stringify([{ id: 'bag-1', name: 'Kiambu AA' }]));
  state.kvSet('cafai', 'conv.bag-1', JSON.stringify({ id: 'conv-1', uiMessages: [{ text: 'Kiambu AA, light roast, washed' }] }));
  state.kvSet('cafai', 'meta', JSON.stringify({ schemaVersion: 1, pages: { bags: 1 } }));
  state.clock.advanceTo(state.clock.now() + 60_000);
  return state;
}

/** CafAI's profile records, without the timestamps a restore cannot set. */
function cafaiProfiles(state: MockDecaid): Array<Omit<DecaidProfileRecord, 'createdAt' | 'updatedAt'>> {
  return state
    .listProfiles({ includeHidden: true })
    .filter((record) => !record.isDefault)
    .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...rest }) => rest)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function roundTrip(snapshot: MockStoreSnapshot): MockStoreSnapshot {
  const serialized = serializeSnapshot(snapshot);
  expect(serialized).not.toBeNull();
  const parsed = parseSnapshot(serialized!.text);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe('snapshotStore + restoreStore', () => {
  it('round-trips the cafai namespace, shots, workflow and CafAI profiles into a fresh mock', () => {
    const state = usedStore();
    const snapshot = roundTrip(snapshotStore(state));
    const fresh = createMockDecaid();
    const report = restoreStore(fresh, snapshot);

    expect(report.skipped).toEqual([]);
    expect(fresh.kvKeys('cafai')).toEqual(state.kvKeys('cafai'));
    expect(fresh.kvAll('cafai')).toEqual(state.kvAll('cafai'));
    expect(fresh.getShotIds()).toEqual(state.getShotIds());
    for (const id of state.getShotIds()) expect(fresh.getShot(id)).toEqual(state.getShot(id));
    expect(fresh.getWorkflow()).toEqual(state.getWorkflow());
    expect(fresh.getWorkflow().context).not.toHaveProperty('grinderId');
    expect(cafaiProfiles(fresh)).toEqual(cafaiProfiles(state));
    const v1 = cafaiProfiles(fresh).find((record) => record.profile.title === 'Kiambu AA v1');
    expect(v1).toMatchObject({ parentId: BLOOMING, visibility: 'hidden' });
  });

  it('restores a bean and batch CafAI created, alongside the two seeded ones, and the cafai-key namespace (D4/D10)', () => {
    const state = usedStore();
    const bean = state.createBean({ roaster: 'Heart', name: 'Ethiopia' });
    const batch = state.createBatch(bean.id, { roastLevel: 'light' });
    state.kvSet('cafai-key', 'anthropic', '"sk-ant-mock"');
    const snapshot = roundTrip(snapshotStore(state));
    const fresh = createMockDecaid();
    const report = restoreStore(fresh, snapshot);

    expect(report.skipped).toEqual([]);
    expect(fresh.getBean(bean.id)).toEqual(state.getBean(bean.id));
    expect(fresh.getBatch(batch.id)).toEqual(state.getBatch(batch.id));
    expect(fresh.listBeans({ includeArchived: true }).map((b) => b.id).sort()).toEqual(
      state.listBeans({ includeArchived: true }).map((b) => b.id).sort(),
    );
    expect(fresh.kvGet('cafai-key', 'anthropic')).toBe('sk-ant-mock');
  });

  it('restores where the coach runs, copied in Decaid (D229)', () => {
    const state = usedStore();
    const source = { kind: 'computer', address: '127.0.0.1:8877', code: 'ABCDEFGH' };
    state.kvSet('cafai-coach-source', 'current', JSON.stringify(source));
    const fresh = createMockDecaid();
    restoreStore(fresh, roundTrip(snapshotStore(state)));
    expect(fresh.kvGet('cafai-coach-source', 'current')).toEqual(source);
  });

  it('keeps data time moving forward across the reload', () => {
    const state = usedStore();
    const snapshot = snapshotStore(state);
    const fresh = createMockDecaid();
    restoreStore(fresh, snapshot);
    expect(fresh.clock.now()).toBeGreaterThanOrEqual(snapshot.clockMs);
  });

  it('saves only cafai, cafai-key and cafai-coach-source, and the profiles CafAI created, never the request log', () => {
    const state = usedStore();
    state.kvSet('dye2.reaplugin', 'beans', JSON.stringify([{ name: 'not ours' }]));
    state.logRequest({ method: 'POST', path: '/api/v1/store/cafai/bags', query: '', body: [] });
    const snapshot = snapshotStore(state);
    expect(Object.keys(snapshot.kv)).toEqual(['cafai', 'cafai-key', 'cafai-coach-source']);
    expect(snapshot.profiles.length).toBeGreaterThan(0);
    expect(snapshot.profiles.every((record) => !record.isDefault)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('"requests"');
  });

  it('does not duplicate bundled profiles, even when restored twice', () => {
    const state = usedStore();
    // A v1 equal to a bundled default dedupes to it: nothing of CafAI's to save.
    state.createProfile({ profile: state.getProfile(DFLOW).profile });
    const snapshot = snapshotStore(state);
    const fresh = createMockDecaid();
    restoreStore(fresh, snapshot);
    restoreStore(fresh, snapshot);

    const ids = fresh.listProfiles({ includeHidden: true }).map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(state.listProfiles({ includeHidden: true }).map((record) => record.id).sort());
    const bundled = (mock: MockDecaid) => mock.listProfiles({ includeHidden: true }).filter((record) => record.isDefault);
    expect(bundled(fresh)).toEqual(bundled(createMockDecaid()));
  });

  it('keeps the steam records, without their measurements, which nothing reads (D191)', () => {
    const state = createMockDecaid();
    const machine = state.getMachineSnapshot();
    state.addSteam({ id: 'steam-1', timestamp: '2026-10-04T08:30:00.000000', measurements: [{ machine, milkTemperature: null }], workflow: state.getWorkflow() });
    const snapshot = roundTrip(snapshotStore(state));
    expect(snapshot.steams?.map((steam) => steam.measurements)).toEqual([[]]);
    const fresh = createMockDecaid();
    expect(restoreStore(fresh, snapshot).skipped).toEqual([]);
    expect(fresh.getSteamIds()).toEqual(['steam-1']);
    expect(fresh.getLatestSteam()).toEqual(state.getLatestSteam());
  });

  it('restores a store saved before the mock kept steam records', () => {
    const { steams: _steams, ...older } = snapshotStore(usedStore());
    const fresh = createMockDecaid();
    expect(restoreStore(fresh, older).skipped).toEqual([]);
    expect(fresh.getSteamIds()).toEqual([]);
  });

  it('restores the shot set exactly: a shot deleted before the save stays deleted', () => {
    const state = createMockDecaid();
    state.deleteShot(EXAMPLE_SHOT);
    const fresh = createMockDecaid();
    expect(fresh.getShotIds()).toEqual([EXAMPLE_SHOT]);
    restoreStore(fresh, snapshotStore(state));
    expect(fresh.getShotIds()).toEqual([]);
  });

  it('replaces the workflow context extras instead of merging them', () => {
    const saved = createMockDecaid();
    saved.updateWorkflow({ context: { extras: { cafai: { versionId: 'ver-2' } } } });
    const fresh = createMockDecaid();
    fresh.updateWorkflow({ context: { extras: { cafai: { versionId: 'ver-1', stale: true }, other: 1 } } });
    restoreStore(fresh, snapshotStore(saved));
    expect(fresh.getWorkflow()).toEqual(saved.getWorkflow());
  });

  it('keeps a profile whose parent is gone, without its lineage', () => {
    const state = usedStore();
    const snapshot = snapshotStore(state);
    const orphan = snapshot.profiles.find((record) => record.profile.title === 'Kiambu AA v1')!;
    const fresh = createMockDecaid();
    restoreStore(fresh, { ...snapshot, profiles: [{ ...orphan, parentId: 'profile:00000000000000000000' }] });
    expect(fresh.getProfile(orphan.id)).toMatchObject({ parentId: null, visibility: 'hidden', metadata: orphan.metadata });
  });

  it('restores the title and metadata of a profile Decaid already had under the same content', () => {
    const state = createMockDecaid();
    const example = state.listProfiles({}).find((record) => !record.isDefault)!;
    state.updateProfile(example.id, { profile: { ...example.profile, title: 'Renamed v1' }, metadata: { source: 'cafai', renamed: true } });
    const fresh = createMockDecaid();
    restoreStore(fresh, snapshotStore(state));
    expect(fresh.getProfile(example.id)).toMatchObject({ profile: { title: 'Renamed v1' }, metadata: { source: 'cafai', renamed: true } });
  });
});

describe('parseSnapshot', () => {
  const valid = snapshotStore(createMockDecaid());
  const text = (patch: Record<string, unknown>) => JSON.stringify({ ...valid, ...patch });

  it('reads back what serializeSnapshot wrote', () => {
    expect(parseSnapshot(serializeSnapshot(valid)!.text)).toEqual(valid);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['not JSON', '{"format":"cafai-mock-store",'],
    ['not an object', '[]'],
    ['another format', text({ format: 'something-else' })],
    ['a newer version', text({ version: 2 })],
    ['no data clock', text({ clockMs: 'soon' })],
    ['kv not a map', text({ kv: [] })],
    ['a namespace not a map', text({ kv: { cafai: 'bags' } })],
    ['shots not a list', text({ shots: {} })],
    ['a shot without an id', text({ shots: [{ ...fixtures.shotRecord(), id: '' }] })],
    ['a shot without its workflow', text({ shots: [{ ...fixtures.shotRecord(), workflow: null }] })],
    ['steams not a list', text({ steams: {} })],
    ['a steam without an id', text({ steams: [{ id: '', timestamp: '2026-10-04T08:30:00.000000', measurements: [], workflow: valid.workflow }] })],
    ['no workflow', text({ workflow: null })],
    ['a workflow without a profile', text({ workflow: { ...valid.workflow, profile: 'D-Flow' } })],
    ['a profile without content', text({ profiles: [{ ...valid.profiles[0], profile: null }] })],
    ['a profile with an unknown visibility', text({ profiles: [{ ...valid.profiles[0], visibility: 'gone' }] })],
  ])('%s: treated as no snapshot', (_label, input) => {
    expect(parseSnapshot(input)).toBeNull();
  });
});

describe('serializeSnapshot', () => {
  function threeShots(): MockStoreSnapshot {
    const state = createMockDecaid({ seedExamples: false });
    const stamps = ['2026-10-04T09:00:00.000000', '2026-10-04T08:00:00.000000', '2026-10-04T10:00:00.000000'];
    stamps.forEach((timestamp, index) => state.addShot({ ...fixtures.shotRecord(), id: `shot-${index}`, timestamp }));
    return snapshotStore(state);
  }

  it('keeps everything that fits', () => {
    const snapshot = threeShots();
    expect(serializeSnapshot(snapshot)).toEqual({ text: JSON.stringify(snapshot), droppedShots: 0 });
  });

  it('drops the oldest shots first to stay under the limit', () => {
    const snapshot = threeShots();
    const result = serializeSnapshot(snapshot, JSON.stringify(snapshot).length - 1);
    expect(result?.droppedShots).toBe(1);
    expect(result!.text.length).toBeLessThan(JSON.stringify(snapshot).length);
    expect(parseSnapshot(result!.text)!.shots.map((shot) => shot.id)).toEqual(['shot-0', 'shot-2']);
  });

  it('gives up when even the store without shots is too large', () => {
    expect(serializeSnapshot(threeShots(), 100)).toBeNull();
  });

  it('a handful of scripted shots fits well inside the limit', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const player = createShotPlayer(state, { speed: 10 });
    for (let shot = 0; shot < 5; shot += 1) {
      expect(player.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(player.activity).toBeNull();
    }
    player.dispose();
    const result = serializeSnapshot(snapshotStore(state));
    expect(result?.droppedShots).toBe(0);
    expect(result!.text.length).toBeLessThan(MAX_SNAPSHOT_CHARS / 4);
  });
});

describe('startMockPersistence', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    return {
      items,
      getItem: vi.fn((key: string) => items.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        items.set(key, value);
      }),
    };
  }

  function setup(search: string, initial: Record<string, string> = {}) {
    const storage = memoryStorage(initial);
    const events = new EventTarget();
    const warnings: string[] = [];
    const env: MockPersistenceEnv = { search, storage, events, pollMs: 100, warn: (message) => warnings.push(message) };
    return { storage, events, warnings, env };
  }

  function saved(storage: { items: Map<string, string> }): MockStoreSnapshot | null {
    return parseSnapshot(storage.items.get(MOCK_STORE_KEY) ?? null);
  }

  it('does nothing without ?mockPersist=1', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, events, env } = setup('?mockSpeed=25');
    expect(startMockPersistence(state, env)).toBeNull();
    state.logRequest({ method: 'POST', path: '/api/v1/store/cafai/bags', query: '', body: [] });
    state.kvSet('cafai', 'bags', '[]');
    events.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps its key apart from CafAI’s own localStorage keys', () => {
    expect(MOCK_STORE_KEY.startsWith(MOCK_STORE_PREFIX)).toBe(true);
    expect(MOCK_STORE_PREFIX.startsWith('cafai.')).toBe(false);
  });

  it('saves after a request that changed the store, not after reads', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, env } = setup('?mockSpeed=25&mockPersist=1');
    const persistence = startMockPersistence(state, env);
    expect(persistence?.restored).toBe(false);

    state.logRequest({ method: 'GET', path: '/api/v1/workflow', query: '', body: null });
    await vi.advanceTimersByTimeAsync(250);
    expect(storage.setItem).not.toHaveBeenCalled();

    state.logRequest({ method: 'POST', path: '/api/v1/store/cafai/bags', query: '', body: [] });
    state.kvSet('cafai', 'bags', JSON.stringify([{ id: 'bag-1', name: 'Kiambu AA' }]));
    await vi.advanceTimersByTimeAsync(250);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(saved(storage)?.kv['cafai']).toEqual({ bags: [{ id: 'bag-1', name: 'Kiambu AA' }] });

    // Nothing new: no second write.
    state.logRequest({ method: 'GET', path: '/api/v1/store/cafai', query: '?full=1', body: null });
    await vi.advanceTimersByTimeAsync(250);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    persistence?.stop();
  });

  it('still notices writes once the request log is full and trimmed', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(state, env);
    for (let i = 0; i < 600; i += 1) state.logRequest({ method: 'GET', path: '/api/v1/devices', query: '', body: null });
    await vi.advanceTimersByTimeAsync(250);
    for (let i = 0; i < 600; i += 1) state.logRequest({ method: 'GET', path: '/api/v1/devices', query: '', body: null });
    state.logRequest({ method: 'DELETE', path: '/api/v1/store/cafai/conv.bag-1', query: '', body: null });
    await vi.advanceTimersByTimeAsync(250);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    persistence?.stop();
  });

  it('saves a shot the player recorded without a request', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(state, env);
    state.addShot({ ...fixtures.shotRecord(), id: 'shot-new' });
    await vi.advanceTimersByTimeAsync(250);
    expect(saved(storage)?.shots.map((shot) => shot.id)).toContain('shot-new');
    persistence?.stop();
  });

  it('saves a steam record the player recorded without a request', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(state, env);
    state.addSteam({ id: 'steam-new', timestamp: '2026-10-04T08:30:00.000000', measurements: [], workflow: state.getWorkflow() });
    await vi.advanceTimersByTimeAsync(250);
    expect(saved(storage)?.steams?.map((steam) => steam.id)).toEqual(['steam-new']);
    persistence?.stop();
  });

  it('saves on pagehide', () => {
    const state = createMockDecaid();
    const { storage, events, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(state, env);
    state.kvSet('cafai', 'settings', JSON.stringify({ activeBagId: 'bag-1' }));
    events.dispatchEvent(new Event('pagehide'));
    expect(saved(storage)?.kv['cafai']).toEqual({ settings: { activeBagId: 'bag-1' } });
    persistence?.stop();
  });

  it('restores the saved store at start, before anything else runs', () => {
    const before = usedStore();
    const { env } = setup('?mockPersist=1', { [MOCK_STORE_KEY]: serializeSnapshot(snapshotStore(before))!.text });
    const state = createMockDecaid();
    const persistence = startMockPersistence(state, env);
    expect(persistence?.restored).toBe(true);
    expect(state.kvAll('cafai')).toEqual(before.kvAll('cafai'));
    expect(state.getShotIds()).toEqual(before.getShotIds());
    expect(state.getWorkflow()).toEqual(before.getWorkflow());
    expect(cafaiProfiles(state)).toEqual(cafaiProfiles(before));
    persistence?.stop();
  });

  it('starts a normal fresh store when the saved one is corrupt', () => {
    const { warnings, env } = setup('?mockPersist=1', { [MOCK_STORE_KEY]: '{"format":"cafai-mock-store","kv":' });
    const state = createMockDecaid();
    const persistence = startMockPersistence(state, env);
    expect(persistence?.restored).toBe(false);
    const fresh = createMockDecaid();
    expect(state.kvKeys('cafai')).toEqual([]);
    expect(state.getShotIds()).toEqual(fresh.getShotIds());
    expect(state.getWorkflow()).toEqual(fresh.getWorkflow());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain('cafai-mock-store');
    persistence?.stop();
  });

  it('reports a failed write instead of throwing', () => {
    const state = createMockDecaid();
    const { storage, warnings, env } = setup('?mockPersist=1');
    storage.setItem.mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const persistence = startMockPersistence(state, env)!;
    expect(() => persistence.save()).not.toThrow();
    expect(warnings.join(' ')).toContain('QuotaExceededError');
    persistence.stop();
  });

  it('stops saving after stop()', async () => {
    vi.useFakeTimers();
    const state = createMockDecaid();
    const { storage, events, env } = setup('?mockPersist=1');
    startMockPersistence(state, env)!.stop();
    state.logRequest({ method: 'PUT', path: '/api/v1/workflow', query: '', body: {} });
    await vi.advanceTimersByTimeAsync(250);
    events.dispatchEvent(new Event('pagehide'));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('saves a write that came through the mock’s HTTP handlers', async () => {
    const mock = createMockServer();
    const { storage, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(mock.state, { ...env, pollMs: 10 });
    mock.server.listen({ onUnhandledRequest: 'error' });
    try {
      const response = await fetch('http://localhost:8080/api/v1/store/cafai/bags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id: 'bag-1', name: 'Kiambu AA' }]),
      });
      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(saved(storage)?.kv['cafai']).toEqual({ bags: [{ id: 'bag-1', name: 'Kiambu AA' }] }));
    } finally {
      persistence?.stop();
      mock.close();
    }
  });

  it('a bean created through POST /api/v1/beans survives a reload (D4)', async () => {
    const mock = createMockServer();
    const { storage, env } = setup('?mockPersist=1');
    const persistence = startMockPersistence(mock.state, { ...env, pollMs: 10 });
    mock.server.listen({ onUnhandledRequest: 'error' });
    let beanId: string;
    try {
      const response = await fetch('http://localhost:8080/api/v1/beans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roaster: 'Heart', name: 'Ethiopia' }),
      });
      expect(response.status).toBe(201);
      beanId = ((await response.json()) as { id: string }).id;
      await vi.waitFor(() => expect(saved(storage)?.beans.map((bean) => bean.id)).toContain(beanId));
    } finally {
      persistence?.stop();
      mock.close();
    }

    // The reload: a fresh mock restores from exactly what was saved.
    const reloaded = createMockDecaid();
    const report = restoreStore(reloaded, saved(storage)!);
    expect(report.skipped).toEqual([]);
    expect(reloaded.getBean(beanId)).toMatchObject({ roaster: 'Heart', name: 'Ethiopia' });
  });
});

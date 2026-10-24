import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../storage/index.ts';
import type { Settings, SettingsRepository } from '../storage/types.ts';
import { createDisplayPrefsStore } from './displayPrefs.ts';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    model: 'claude-opus-5-5',
    grinderName: null,
    grinderSetting: null,
    grinderId: null,
    activeBagId: null,
    appearance: DEFAULT_APPEARANCE,
    ...overrides,
  };
}

interface FakeSettingsRepo extends SettingsRepository {
  updates: Partial<Settings>[];
  releases: Array<() => void>;
  fail: boolean;
}

/** `hold`: update() settles only when its entry in `releases` is called. */
function fakeSettingsRepo(initial: Settings, options: { hold?: boolean } = {}): FakeSettingsRepo {
  let settings = initial;
  const repo: FakeSettingsRepo = {
    updates: [],
    releases: [],
    fail: false,
    get: async () => settings,
    async update(patch: Partial<Settings>) {
      repo.updates.push(patch);
      if (repo.fail) throw new Error('The disk is full.');
      settings = { ...settings, ...patch };
      const saved = settings;
      if (!options.hold) return saved;
      return new Promise<Settings>((resolve) => repo.releases.push(() => resolve(saved)));
    },
  };
  return repo;
}

describe('createDisplayPrefsStore', () => {
  it('starts from the saved choices, and 24-hour with the TDS cell shown without them (D245, D246)', () => {
    const saved = createDisplayPrefsStore(fakeSettingsRepo(makeSettings()), { clock: '12h', showTds: false });
    expect([saved.clock(), saved.showTds()]).toEqual(['12h', false]);
    const none = createDisplayPrefsStore(fakeSettingsRepo(makeSettings()));
    expect([none.clock(), none.showTds()]).toEqual(['24h', true]);
  });

  it('setClock() shows at once, tells subscribers once, and saves the choice alone with the settings', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    const store = createDisplayPrefsStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const saving = store.setClock('12h');
    expect(store.clock()).toBe('12h');
    expect(calls).toBe(1);
    await saving;
    expect(repo.updates).toEqual([{ clock: '12h' }]);
    expect(calls).toBe(1);
  });

  it('setShowTds() shows at once and saves the switch alone, the clock left as it is', async () => {
    const repo = fakeSettingsRepo(makeSettings({ clock: '12h' }));
    const store = createDisplayPrefsStore(repo, { clock: '12h' });
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const saving = store.setShowTds(false);
    expect(store.showTds()).toBe(false);
    expect(calls).toBe(1);
    await saving;
    expect(repo.updates).toEqual([{ showTds: false }]);
    expect([store.clock(), store.showTds(), calls]).toEqual(['12h', false, 1]);
  });

  it('a choice made while an earlier one of the same saves wins', async () => {
    const repo = fakeSettingsRepo(makeSettings(), { hold: true });
    const store = createDisplayPrefsStore(repo);
    const first = store.setClock('12h');
    const second = store.setClock('24h');
    repo.releases[1]!();
    await second;
    repo.releases[0]!();
    await first;
    expect(store.clock()).toBe('24h');
  });

  it('a save of one field never puts back the other while that one is still saving', async () => {
    const repo = fakeSettingsRepo(makeSettings(), { hold: true });
    const store = createDisplayPrefsStore(repo);
    const clock = store.setClock('12h');
    const tds = store.setShowTds(false);
    // The switch's save answers first, with the clock already saved; then the clock's.
    repo.releases[1]!();
    await tds;
    repo.releases[0]!();
    await clock;
    expect([store.clock(), store.showTds()]).toEqual(['12h', false]);
  });

  it('a failed save rejects, and the choice stays on screen for this session', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    repo.fail = true;
    const store = createDisplayPrefsStore(repo);
    await expect(store.setClock('12h')).rejects.toThrow('The disk is full.');
    await expect(store.setShowTds(false)).rejects.toThrow('The disk is full.');
    expect([store.clock(), store.showTds()]).toEqual(['12h', false]);
  });

  it('reload() reads both again, after an import or a restore, telling subscribers once', async () => {
    const repo = fakeSettingsRepo(makeSettings({ clock: '12h', showTds: false }));
    const store = createDisplayPrefsStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    await store.reload();
    expect([store.clock(), store.showTds(), calls]).toEqual(['12h', false, 1]);
    // Nothing changed: nobody hears of it.
    await store.reload();
    expect(calls).toBe(1);
  });

  it('a subscriber that leaves hears nothing more', async () => {
    const store = createDisplayPrefsStore(fakeSettingsRepo(makeSettings()));
    let calls = 0;
    const leave = store.subscribe(() => void (calls += 1));
    leave();
    await store.setClock('12h');
    await store.setShowTds(false);
    expect(calls).toBe(0);
  });
});

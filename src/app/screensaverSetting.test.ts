import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../storage/index.ts';
import { DEFAULT_SCREENSAVER } from '../storage/settings.ts';
import type { Settings, SettingsRepository } from '../storage/types.ts';
import { createScreensaverSettingStore } from './screensaverSetting.ts';

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

describe('createScreensaverSettingStore', () => {
  it('starts from the saved setting, and on, a different one each day, without one', () => {
    const saved = createScreensaverSettingStore(fakeSettingsRepo(makeSettings()), { on: false, pick: 'rain' });
    expect(saved.get()).toEqual({ on: false, pick: 'rain' });
    expect(createScreensaverSettingStore(fakeSettingsRepo(makeSettings())).get()).toEqual(DEFAULT_SCREENSAVER);
  });

  it('set() shows at once, tells subscribers once, and saves the setting with the others', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    const store = createScreensaverSettingStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const saving = store.set({ on: false, pick: 'daily' });
    expect(store.get()).toEqual({ on: false, pick: 'daily' });
    expect(calls).toBe(1);
    await saving;
    expect(repo.updates).toEqual([{ screensaver: { on: false, pick: 'daily' } }]);
    expect(calls).toBe(1);
  });

  it('keeps the same object until the setting changes, as useSyncExternalStore needs', async () => {
    const store = createScreensaverSettingStore(fakeSettingsRepo(makeSettings()));
    const first = store.get();
    await store.set({ on: true, pick: 'daily' });
    expect(store.get()).toBe(first);
    await store.set({ on: true, pick: 'lava' });
    expect(store.get()).not.toBe(first);
  });

  it('a change made while an earlier one saves wins', async () => {
    const repo = fakeSettingsRepo(makeSettings(), { hold: true });
    const store = createScreensaverSettingStore(repo);
    const first = store.set({ on: true, pick: 'beanfield' });
    const second = store.set({ on: true, pick: 'steam' });
    repo.releases[1]!();
    await second;
    repo.releases[0]!();
    await first;
    expect(store.get()).toEqual({ on: true, pick: 'steam' });
  });

  it('a failed save rejects, and the change stays on screen for this session', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    repo.fail = true;
    const store = createScreensaverSettingStore(repo);
    await expect(store.set({ on: false, pick: 'daily' })).rejects.toThrow('The disk is full.');
    expect(store.get()).toEqual({ on: false, pick: 'daily' });
  });

  it('reload() reads the saved setting again, after an import or a restore', async () => {
    const repo = fakeSettingsRepo(makeSettings({ screensaver: { on: true, pick: 'portafilter' } }));
    const store = createScreensaverSettingStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    await store.reload();
    expect(store.get()).toEqual({ on: true, pick: 'portafilter' });
    expect(calls).toBe(1);
    // Nothing changed: nobody hears of it.
    await store.reload();
    expect(calls).toBe(1);
  });

  it('a subscriber that leaves hears nothing more', async () => {
    const store = createScreensaverSettingStore(fakeSettingsRepo(makeSettings()));
    let calls = 0;
    const leave = store.subscribe(() => void (calls += 1));
    leave();
    await store.set({ on: false, pick: 'daily' });
    expect(calls).toBe(0);
  });
});

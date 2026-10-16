import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../storage/index.ts';
import type { Settings, SettingsRepository } from '../storage/types.ts';
import { createTemperatureUnitStore } from './temperatureUnit.ts';

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

describe('createTemperatureUnitStore', () => {
  it('starts from the saved choice, and in °C without one', () => {
    expect(createTemperatureUnitStore(fakeSettingsRepo(makeSettings()), 'fahrenheit').get()).toBe('fahrenheit');
    expect(createTemperatureUnitStore(fakeSettingsRepo(makeSettings())).get()).toBe('celsius');
  });

  it('says whether a unit was chosen: not from the default °C, yes from a saved one or a set, even of °C (D176)', async () => {
    expect(createTemperatureUnitStore(fakeSettingsRepo(makeSettings()), 'celsius').chosen()).toBe(true);
    const repo = fakeSettingsRepo(makeSettings());
    const store = createTemperatureUnitStore(repo);
    expect(store.chosen()).toBe(false);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    await store.set('celsius');
    // Still °C, but chosen now: subscribers hear it, so words start following the unit.
    expect([store.get(), store.chosen(), calls]).toEqual(['celsius', true, 1]);
  });

  it('set() shows at once, tells subscribers once, and saves the choice with the settings', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    const store = createTemperatureUnitStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const saving = store.set('fahrenheit');
    expect(store.get()).toBe('fahrenheit');
    expect(calls).toBe(1);
    await saving;
    expect(repo.updates).toEqual([{ temperatureUnit: 'fahrenheit' }]);
    expect(calls).toBe(1);
  });

  it('a choice made while an earlier one saves wins', async () => {
    const repo = fakeSettingsRepo(makeSettings(), { hold: true });
    const store = createTemperatureUnitStore(repo);
    const first = store.set('fahrenheit');
    const second = store.set('celsius');
    repo.releases[1]!();
    await second;
    repo.releases[0]!();
    await first;
    expect(store.get()).toBe('celsius');
  });

  it('a failed save rejects, and the choice stays on screen for this session', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    repo.fail = true;
    const store = createTemperatureUnitStore(repo);
    await expect(store.set('fahrenheit')).rejects.toThrow('The disk is full.');
    expect(store.get()).toBe('fahrenheit');
  });

  it('reload() reads the saved choice again, after an import or a restore', async () => {
    const repo = fakeSettingsRepo(makeSettings({ temperatureUnit: 'fahrenheit' }));
    const store = createTemperatureUnitStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    await store.reload();
    expect(store.get()).toBe('fahrenheit');
    expect(calls).toBe(1);
    // Nothing changed: nobody hears of it.
    await store.reload();
    expect(calls).toBe(1);
  });

  it('a subscriber that leaves hears nothing more', async () => {
    const store = createTemperatureUnitStore(fakeSettingsRepo(makeSettings()));
    let calls = 0;
    const leave = store.subscribe(() => void (calls += 1));
    leave();
    await store.set('fahrenheit');
    expect(calls).toBe(0);
  });
});

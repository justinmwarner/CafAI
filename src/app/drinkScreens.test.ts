import { describe, expect, it } from 'vitest';
import { applySettingsPatch, defaultSettings } from '../storage/settings.ts';
import type { Settings, SettingsPatch, SettingsRepository } from '../storage/types.ts';
import { createDrinkScreensStore, DEFAULT_GO_BACK, DEFAULT_GO_BACK_SECONDS, resolveDrinkScreens } from './drinkScreens.ts';

const MODEL = 'claude-opus-5-5';

interface FakeSettingsRepo extends SettingsRepository {
  updates: SettingsPatch[];
  releases: Array<() => void>;
  fail: boolean;
  replace(next: Settings): void;
}

/** The real patch rules over memory; `hold`: update() settles only when its entry in `releases` is called. */
function fakeSettingsRepo(initial: Settings, options: { hold?: boolean } = {}): FakeSettingsRepo {
  let settings = initial;
  const repo: FakeSettingsRepo = {
    updates: [],
    releases: [],
    fail: false,
    replace: (next) => void (settings = next),
    get: async () => settings,
    async update(patch) {
      repo.updates.push(patch);
      if (repo.fail) throw new Error('The disk is full.');
      settings = applySettingsPatch(settings, patch, MODEL);
      const saved = settings;
      if (!options.hold) return saved;
      return new Promise<Settings>((resolve) => repo.releases.push(() => resolve(saved)));
    },
  };
  return repo;
}

describe('the drinks’ screens as live state', () => {
  it('reads every drink as its default scene, going back after 10 s, until someone chooses', () => {
    const store = createDrinkScreensStore(fakeSettingsRepo(defaultSettings(MODEL)));
    expect(DEFAULT_GO_BACK).toBe(true);
    expect(DEFAULT_GO_BACK_SECONDS).toBe(10);
    for (const kind of ['steam', 'hotWater', 'flush'] as const) {
      expect(store.get()[kind]).toEqual({ scene: null, goBack: true, goBackSeconds: 10 });
    }
  });

  it('starts from what was saved, each missing field as its default', () => {
    const store = createDrinkScreensStore(fakeSettingsRepo(defaultSettings(MODEL)), { steam: { scene: 'whirlpool' }, flush: { goBack: false } });
    expect(store.get().steam).toEqual({ scene: 'whirlpool', goBack: true, goBackSeconds: 10 });
    expect(store.get().flush).toEqual({ scene: null, goBack: false, goBackSeconds: 10 });
    expect(store.get().hotWater).toEqual(resolveDrinkScreens(undefined).hotWater);
  });

  it('shows a change at once, saves just that field, and tells its listeners', async () => {
    const repo = fakeSettingsRepo(defaultSettings(MODEL));
    const store = createDrinkScreensStore(repo);
    let heard = 0;
    store.subscribe(() => (heard += 1));
    const saving = store.set('steam', { goBackSeconds: 25 });
    expect(store.get().steam.goBackSeconds).toBe(25);
    expect(heard).toBe(1);
    await saving;
    expect(repo.updates).toEqual([{ drinkScreens: { steam: { goBackSeconds: 25 } } }]);
    expect(heard).toBe(1);
    await store.set('steam', { scene: 'rosetta' });
    expect(store.get().steam).toEqual({ scene: 'rosetta', goBack: true, goBackSeconds: 25 });
  });

  it('lets the newest change win when two are saving at once', async () => {
    const repo = fakeSettingsRepo(defaultSettings(MODEL), { hold: true });
    const store = createDrinkScreensStore(repo);
    const first = store.set('flush', { goBackSeconds: 5 });
    const second = store.set('flush', { goBackSeconds: 30 });
    repo.releases[1]!();
    await second;
    repo.releases[0]!();
    await first;
    expect(store.get().flush.goBackSeconds).toBe(30);
  });

  it('keeps a change on screen for the session when it cannot be saved, and says so', async () => {
    const repo = fakeSettingsRepo(defaultSettings(MODEL));
    repo.fail = true;
    const store = createDrinkScreensStore(repo);
    await expect(store.set('hotWater', { goBack: false })).rejects.toThrow('The disk is full.');
    expect(store.get().hotWater.goBack).toBe(false);
  });

  it('keeps a refused change on screen after another change saves, until it saves itself', async () => {
    const repo = fakeSettingsRepo(defaultSettings(MODEL));
    const store = createDrinkScreensStore(repo);
    repo.fail = true;
    await expect(store.set('steam', { goBack: false })).rejects.toThrow('The disk is full.');
    repo.fail = false;
    await store.set('steam', { scene: 'whirlpool' });
    expect(store.get().steam).toEqual({ scene: 'whirlpool', goBack: false, goBackSeconds: 10 });
    await store.reload();
    expect(store.get().steam.goBack).toBe(false);
    await store.set('steam', { goBack: false });
    expect((await repo.get()).drinkScreens?.steam).toEqual({ scene: 'whirlpool', goBack: false });
    repo.replace({ ...defaultSettings(MODEL), drinkScreens: { steam: { goBack: true } } });
    await store.reload();
    expect(store.get().steam.goBack).toBe(true);
  });

  it('reads the saved choices again after an import or a restore', async () => {
    const repo = fakeSettingsRepo(defaultSettings(MODEL));
    const store = createDrinkScreensStore(repo);
    repo.replace({ ...defaultSettings(MODEL), drinkScreens: { hotWater: { scene: 'above' } } });
    let heard = 0;
    store.subscribe(() => (heard += 1));
    await store.reload();
    expect(store.get().hotWater.scene).toBe('above');
    expect(heard).toBe(1);
    await store.reload();
    expect(heard).toBe(1);
  });
});

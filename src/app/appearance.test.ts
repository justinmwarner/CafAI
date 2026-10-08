import { describe, expect, it } from 'vitest';
import { createAppearanceStore } from './appearance.ts';
import { DEFAULT_APPEARANCE } from '../storage/index.ts';
import type { Appearance, Settings, SettingsRepository } from '../storage/types.ts';

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
  /** One resolver per in-flight update() call, in call order; call it to let that save finish. */
  releases: Array<() => void>;
}

/** `hold`: update() does not settle until its matching entry in `releases` is called. */
function fakeSettingsRepo(initial: Settings, options: { hold?: boolean } = {}): FakeSettingsRepo {
  let settings = initial;
  const updates: Partial<Settings>[] = [];
  const releases: Array<() => void> = [];
  return {
    updates,
    releases,
    get: async () => settings,
    async update(patch) {
      updates.push(patch);
      settings = { ...settings, ...patch };
      const saved = settings;
      if (!options.hold) return saved;
      return new Promise<Settings>((resolve) => releases.push(() => resolve(saved)));
    },
  };
}

describe('createAppearanceStore', () => {
  it('starts from the given initial appearance', () => {
    const repo = fakeSettingsRepo(makeSettings());
    const initial: Appearance = { mode: 'light', tint: 'matcha' };
    expect(createAppearanceStore(repo, initial).get()).toEqual(initial);
  });

  it('defaults to dark crema without an initial appearance', () => {
    const repo = fakeSettingsRepo(makeSettings());
    expect(createAppearanceStore(repo).get()).toEqual({ mode: 'dark', tint: 'crema' });
  });

  it('set() applies at once, tells subscribers once, and saves through settings.update', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    const store = createAppearanceStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const next: Appearance = { mode: 'light', tint: 'matcha' };

    const saving = store.set(next);
    // Applied synchronously: get() already reflects it before the save settles.
    expect(store.get()).toEqual(next);
    expect(calls).toBe(1);

    await saving;
    expect(repo.updates).toEqual([{ appearance: next }]);
    expect(calls).toBe(1);
  });

  it('preview() applies and tells subscribers without saving; an equal preview tells nobody', () => {
    const repo = fakeSettingsRepo(makeSettings());
    const store = createAppearanceStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));
    const next: Appearance = { mode: 'dark', tint: { hue: 42 } };

    store.preview(next);
    expect(store.get()).toEqual(next);
    expect(calls).toBe(1);
    expect(repo.updates).toEqual([]);

    // Same appearance, new object: nobody is told twice.
    store.preview({ mode: 'dark', tint: { hue: 42 } });
    expect(calls).toBe(1);
    expect(repo.updates).toEqual([]);
  });

  it('lets a quick second set() win even when the first save finishes late', async () => {
    const repo = fakeSettingsRepo(makeSettings(), { hold: true });
    const store = createAppearanceStore(repo);

    const first = store.set({ mode: 'dark', tint: { hue: 100 } });
    const second = store.set({ mode: 'dark', tint: { hue: 120 } });
    expect(repo.releases).toHaveLength(2);

    // The second save finishes first; the first save arrives late, after it.
    repo.releases[1]!();
    repo.releases[0]!();
    await Promise.all([first, second]);

    expect(store.get()).toEqual({ mode: 'dark', tint: { hue: 120 } });
  });

  it('reload() re-reads the saved appearance', async () => {
    const saved: Appearance = { mode: 'light', tint: 'matcha' };
    const repo = fakeSettingsRepo(makeSettings({ appearance: saved }));
    const store = createAppearanceStore(repo);
    let calls = 0;
    store.subscribe(() => void (calls += 1));

    await store.reload();
    expect(store.get()).toEqual(saved);
    expect(calls).toBe(1);
  });

  it('a failed save rejects with the repository error and the change stays on screen', async () => {
    const repo = fakeSettingsRepo(makeSettings());
    const boom = new Error('offline');
    repo.update = async () => {
      throw boom;
    };
    const store = createAppearanceStore(repo);
    const next: Appearance = { mode: 'light', tint: 'matcha' };

    await expect(store.set(next)).rejects.toBe(boom);
    expect(store.get()).toEqual(next);
  });
});

# UX stage 2: Appearance (mode, tint, hue) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A barista picks Dark, Light or Auto and a tint (seven named, or any hue) in Settings; every screen, the live graph included, re-themes at once, the choice is saved with the settings (so it is mirrored to Decaid and exported), and the screens shown before the app loads use the last look.

**Architecture:** `appearance` joins `Settings` (storage, read leniently). An `AppearanceStore` in Services holds the live value, applies a change at once and saves it. `AppTheme` resolves appearance plus the device's dark preference to a palette (stage 1's `buildPalette`) and a cached MUI theme, and caches a few resolved colours in `localStorage` for `main.tsx`'s boot screen and `index.html`'s watchdog page. The shot recording moves out of `LiveShotGraph` into an app-wide `ShotTrace` (planned for stage 3, pulled forward), so a graph rebuilt for a new palette keeps the shot it is showing.

**Tech Stack:** React 19, TypeScript 5.9, MUI 9.4, IndexedDB via `idb`, uPlot, Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md`, section 3 ("The appearance setting", "Settings: Appearance") and section 9 stage 2.

## Ground rules (every task)

- Repo `E:\source\cafai`, branch `feat/ux-modes-theme`. Bash with POSIX paths (`/e/source/cafai`).
- No state-changing git (the controller commits). Edit/Write tools only (LF). No em dashes.
- Imports with extensions, `import type` for types, no enums/namespaces.
- Chromium 91: no `oklch()`/`color-mix()`, no `:has()`, no dynamic `import()` in app code.
- Capture exit codes (`> /tmp/x.log 2>&1; echo exit=$?`). Before reporting: `npx tsc -p tsconfig.json --noEmit`, `npx eslint <paths>`, `npx vitest run <related>`.
- Tasks may run in parallel with other agents on other files; a whole-repo typecheck error in a file you did not touch is theirs: report, do not fix.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/storage/types.ts` | modify | `AppearanceMode`, `Appearance`, `Settings.appearance?` |
| `src/storage/settings.ts` (+ test) | modify | `DEFAULT_APPEARANCE`, `normalizeAppearance`, `sameAppearance`, field in normalize/patch/fill-blanks |
| `src/storage/index.ts` | modify | re-export the new names |
| `src/ui/appearance.ts` (+ test) | create | `resolveMode`, `resolveTint`, `paletteFor`, boot colours (`bootColors`, `saveBootColors`, `loadBootColors`) |
| `src/app/appearance.ts` (+ test) | create | `AppearanceStore`: `get`, `subscribe`, `preview`, `set`, `reload` |
| `src/app/types.ts`, `src/app/services.tsx`, `src/app/createServices.ts` | modify | `Services.appearance`, `useAppearance()` |
| `src/ui/testing/fakeServices.ts` | modify | a real store over the fake settings |
| `src/ui/platform/usePrefersDark.ts` (+ test) | create | the device's dark preference, live |
| `src/ui/AppTheme.tsx` (+ test) | rewrite | appearance to theme, `enableColorScheme`, boot colours |
| `src/main.tsx`, `index.html`, `src/ui/platform/engineScript.test.ts` | modify | boot screens in the last look |
| `src/ui/machine/shotTrace.ts` (+ test) | create | the app-wide shot recording |
| `src/ui/machine/LiveShotGraph.tsx` (+ test) | modify | draws from the trace, rebuilt on a theme change |
| `src/ui/shell/AppShell.tsx` | modify | starts the trace with the app |
| `src/ui/settings/AppearanceSection.tsx` (+ test), `SettingsScreen.tsx`, `src/ui/testIds.ts` | create/modify | the Appearance section, first on Settings |
| `src/ui/history/HistoryScreen.tsx` | modify | an import reloads the appearance |
| `e2e/appearance.spec.ts` | create | light Matcha applies everywhere and survives a reload |
| `DECISIONS.md` | modify | D82, D83 |

---

### Task 1: `appearance` in the settings (storage)

**Files:** `src/storage/types.ts`, `src/storage/settings.ts`, `src/storage/index.ts`, tests in `src/storage/settings.test.ts` (and any storage test that compares a whole `Settings` object).

- [ ] **Step 1: Types** — in `src/storage/types.ts`, above `export interface Settings`:

```ts
/** Dark, light, or whatever the device is set to. */
export type AppearanceMode = 'dark' | 'light' | 'auto';

/**
 * How CafAI looks: a mode and a tint. The tint is a named tint's id (the list
 * lives with the palette, src/ui/palette.ts) or a hue from the custom slider.
 * Storage keeps any well-formed id; the UI reads one it does not know as the
 * default tint, so a tint a newer CafAI added survives a read by an older one.
 */
export interface Appearance {
  mode: AppearanceMode;
  tint: string | { hue: number };
}
```
and inside `Settings`, after `activeBagId`:
```ts
  /**
   * How CafAI looks. Storage always reads and writes it (the default when
   * absent); it is optional only so that older Settings literals compile.
   */
  appearance?: Appearance;
```

- [ ] **Step 2: Failing tests** — append to `src/storage/settings.test.ts` (extend its imports with `DEFAULT_APPEARANCE, normalizeAppearance, sameAppearance`):

```ts
describe('appearance', () => {
  it('defaults to dark Crema, today\'s look', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ mode: 'dark', tint: 'crema' });
    expect(defaultSettings(MODEL).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeSettings({ model: MODEL }, MODEL).appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps a valid mode and tint', () => {
    expect(normalizeAppearance({ mode: 'light', tint: 'matcha' })).toEqual({ mode: 'light', tint: 'matcha' });
    expect(normalizeAppearance({ mode: 'auto', tint: { hue: 210 } })).toEqual({ mode: 'auto', tint: { hue: 210 } });
    // An id this build does not know is kept; the UI decides what it looks like.
    expect(normalizeAppearance({ mode: 'dark', tint: 'forest' })).toEqual({ mode: 'dark', tint: 'forest' });
  });

  it('falls back field by field', () => {
    expect(normalizeAppearance({ mode: 'sepia', tint: 'matcha' })).toEqual({ mode: 'dark', tint: 'matcha' });
    expect(normalizeAppearance({ mode: 'light', tint: 'Not An Id!' })).toEqual({ mode: 'light', tint: 'crema' });
    expect(normalizeAppearance({ mode: 'light', tint: { hue: 'red' } })).toEqual({ mode: 'light', tint: 'crema' });
    expect(normalizeAppearance({ mode: 'light', tint: { hue: Number.NaN } })).toEqual({ mode: 'light', tint: 'crema' });
    for (const raw of [undefined, null, 'dark', 7, []]) expect(normalizeAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });

  it('wraps and rounds a stored hue', () => {
    expect(normalizeAppearance({ mode: 'dark', tint: { hue: 370.4 } }).tint).toEqual({ hue: 10 });
    expect(normalizeAppearance({ mode: 'dark', tint: { hue: -20 } }).tint).toEqual({ hue: 340 });
  });

  it('is patched like any other setting', () => {
    const next = applySettingsPatch(defaultSettings(MODEL), { appearance: { mode: 'light', tint: { hue: 120 } } }, MODEL);
    expect(next.appearance).toEqual({ mode: 'light', tint: { hue: 120 } });
    expect(applySettingsPatch(next, { grinderSetting: '14' }, MODEL).appearance).toEqual({ mode: 'light', tint: { hue: 120 } });
  });

  it('takes an imported appearance only while this device still has the default', () => {
    const incoming = { ...defaultSettings(MODEL), appearance: { mode: 'light' as const, tint: 'ocean' } };
    expect(fillBlankSettings(defaultSettings(MODEL), incoming, MODEL).appearance).toEqual({ mode: 'light', tint: 'ocean' });
    const mine = { ...defaultSettings(MODEL), appearance: { mode: 'auto' as const, tint: 'plum' } };
    expect(fillBlankSettings(mine, incoming, MODEL).appearance).toEqual({ mode: 'auto', tint: 'plum' });
  });

  it('compares appearances by value', () => {
    expect(sameAppearance({ mode: 'dark', tint: { hue: 5 } }, { mode: 'dark', tint: { hue: 5 } })).toBe(true);
    expect(sameAppearance({ mode: 'dark', tint: 'crema' }, { mode: 'dark', tint: { hue: 68 } })).toBe(false);
    expect(sameAppearance({ mode: 'dark', tint: 'crema' }, { mode: 'light', tint: 'crema' })).toBe(false);
  });

  it('survives the Decaid mirror', () => {
    // Look at the other mirror tests in this file for buildMirrorEntries/exportFromMirror's exact arguments;
    // build a snapshot whose settings carry { mode: 'light', tint: { hue: 200 } } and expect it back unchanged.
  });
});
```
For the mirror case, copy the setup of an existing mirror round-trip test in this file and assert `restored.settings.appearance` equals `{ mode: 'light', tint: { hue: 200 } }`.

Run: `npx vitest run src/storage/settings.test.ts > /tmp/s1.log 2>&1; echo exit=$?` — expected exit=1.

- [ ] **Step 3: Implement** — in `src/storage/settings.ts`:

```ts
import type { Appearance, AppearanceMode, Settings } from './types.ts';

/** Today's look. */
export const DEFAULT_APPEARANCE: Appearance = { mode: 'dark', tint: 'crema' };

const MODES: readonly AppearanceMode[] = ['dark', 'light', 'auto'];
/** A tint id is a short lowercase word; nothing else (a pasted key included) is ever kept. */
const TINT_ID = /^[a-z][a-z0-9-]{0,31}$/;

function normalizeTint(raw: unknown): Appearance['tint'] {
  if (typeof raw === 'string' && TINT_ID.test(raw)) return raw;
  if (isRecord(raw) && typeof raw['hue'] === 'number' && Number.isFinite(raw['hue'])) {
    return { hue: ((Math.round(raw['hue']) % 360) + 360) % 360 };
  }
  return DEFAULT_APPEARANCE.tint;
}

/** A stored appearance, read leniently: anything unusable falls back to the default, field by field. */
export function normalizeAppearance(raw: unknown): Appearance {
  if (!isRecord(raw)) return DEFAULT_APPEARANCE;
  const mode = MODES.find((m) => m === raw['mode']) ?? DEFAULT_APPEARANCE.mode;
  return { mode, tint: normalizeTint(raw['tint']) };
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  if (a.mode !== b.mode) return false;
  if (typeof a.tint === 'string' || typeof b.tint === 'string') return a.tint === b.tint;
  return a.tint.hue === b.tint.hue;
}
```
then: `defaultSettings` returns `{ ..., activeBagId: null, appearance: DEFAULT_APPEARANCE }`; `normalizeSettings` adds `appearance: normalizeAppearance(raw['appearance'])` to the returned object; `FIELDS` gains `'appearance'`; `fillBlankSettings` returns, in addition,

```ts
    // Like the model: a look chosen on this device wins; the default takes the imported one.
    appearance: sameAppearance(local.appearance ?? DEFAULT_APPEARANCE, DEFAULT_APPEARANCE)
      ? (incoming.appearance ?? DEFAULT_APPEARANCE)
      : (local.appearance ?? DEFAULT_APPEARANCE),
```
(also update its doc comment: "The appearance, like the model, is adopted only while it is still the default."). In `src/storage/index.ts`, export `DEFAULT_APPEARANCE`, `normalizeAppearance`, `sameAppearance` and the `Appearance`, `AppearanceMode` types alongside the existing settings exports (follow the file's pattern).

- [ ] **Step 4: Fix the shape assertions** — run `npx vitest run src/storage src/app > /tmp/s1.log 2>&1; echo exit=$?`. Tests that compare a whole `Settings` (for example `defaultSettings` toEqual a literal, the "falls back field by field" case, the "never carries fields outside Settings" key list, `porter.test.ts` "older" settings) now also see `appearance: DEFAULT_APPEARANCE`: add it to their expected values. Do not change what any test asserts otherwise. Expected after: exit=0.

- [ ] **Step 5:** typecheck and lint `src/storage`; report.

---

### Task 2: From appearance to palette, and the boot colours (`src/ui/appearance.ts`)

**Files:** create `src/ui/appearance.ts`, `src/ui/appearance.test.ts`.

- [ ] **Step 1: Failing test** — `src/ui/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPalette, customTint, namedTint } from './palette.ts';
import { BOOT_COLORS_KEY, bootColors, loadBootColors, paletteFor, resolveMode, resolveTint, saveBootColors } from './appearance.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
}

describe('resolveMode', () => {
  it('uses dark and light as they are, and the device for auto', () => {
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('auto', true)).toBe('dark');
    expect(resolveMode('auto', false)).toBe('light');
  });
});

describe('resolveTint', () => {
  it('finds a named tint, reads an unknown id as Crema, and builds a hue', () => {
    expect(resolveTint('matcha')).toBe(namedTint('matcha'));
    expect(resolveTint('forest')).toBe(namedTint('crema'));
    expect(resolveTint({ hue: 210 })).toEqual(customTint(210));
  });
});

describe('paletteFor', () => {
  it('builds the palette for the resolved mode and tint, once', () => {
    const p = paletteFor({ mode: 'auto', tint: 'ocean' }, false);
    expect(p).toEqual(buildPalette('light', namedTint('ocean')));
    expect(paletteFor({ mode: 'light', tint: 'ocean' }, true)).toBe(p);
  });
});

describe('boot colours', () => {
  const palette = buildPalette('light', namedTint('matcha'));

  it('save and load the few colours the boot screens use', () => {
    const storage = memoryStorage();
    saveBootColors(storage, bootColors(palette));
    expect(JSON.parse(storage.items.get(BOOT_COLORS_KEY)!)).toEqual(bootColors(palette));
    expect(loadBootColors(storage)).toEqual(bootColors(palette));
    expect(bootColors(palette)).toEqual({
      background: palette.background,
      surface: palette.surface,
      ink: palette.ink,
      inkMuted: palette.inkMuted,
      line: palette.line,
      accent: palette.accent,
    });
  });

  it('ignore anything that is not six #rrggbb colours', () => {
    for (const raw of ['not json', '{"background":"red"}', 'null', '[]']) {
      expect(loadBootColors(memoryStorage({ [BOOT_COLORS_KEY]: raw }))).toBeNull();
    }
    expect(loadBootColors(memoryStorage())).toBeNull();
  });

  it('never throw when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadBootColors(blocked)).toBeNull();
    expect(() => saveBootColors(blocked, bootColors(palette))).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement** — `src/ui/appearance.ts`:

```ts
/**
 * From the stored appearance (storage/types.ts) to the palette the theme is
 * built from, and the few resolved colours kept for the screens that show
 * before the app has read its settings (main.tsx's boot screen, the watchdog
 * page in index.html).
 */
import type { Appearance } from '../storage/types.ts';
import { buildPalette, customTint, DEFAULT_TINT_ID, namedTint, TINTS, type Palette, type ThemeMode, type Tint, type TintId } from './palette.ts';

export function resolveMode(mode: Appearance['mode'], prefersDark: boolean): ThemeMode {
  if (mode === 'auto') return prefersDark ? 'dark' : 'light';
  return mode;
}

function isTintId(id: string): id is TintId {
  return TINTS.some((tint) => tint.id === id);
}

/** A named tint (an id this build does not know reads as the default), or the slider's hue. */
export function resolveTint(tint: Appearance['tint']): Tint {
  if (typeof tint === 'string') return namedTint(isTintId(tint) ? tint : DEFAULT_TINT_ID);
  return customTint(tint.hue);
}

const palettes = new Map<string, Palette>();

/** The palette for an appearance on this device, built once per mode and tint. */
export function paletteFor(appearance: Appearance, prefersDark: boolean): Palette {
  const mode = resolveMode(appearance.mode, prefersDark);
  const tint = appearance.tint;
  const key = `${mode}|${typeof tint === 'string' ? (isTintId(tint) ? tint : DEFAULT_TINT_ID) : `hue ${customTint(tint.hue).hue}`}`;
  let palette = palettes.get(key);
  if (!palette) {
    palette = buildPalette(mode, resolveTint(tint));
    palettes.set(key, palette);
  }
  return palette;
}

/** What the boot screens draw with: the last look the app showed. */
export interface BootColors {
  background: string;
  surface: string;
  ink: string;
  inkMuted: string;
  line: string;
  accent: string;
}

export const BOOT_COLORS_KEY = 'cafai.appearance.boot';

const BOOT_FIELDS = ['background', 'surface', 'ink', 'inkMuted', 'line', 'accent'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

export function bootColors(palette: Palette): BootColors {
  return {
    background: palette.background,
    surface: palette.surface,
    ink: palette.ink,
    inkMuted: palette.inkMuted,
    line: palette.line,
    accent: palette.accent,
  };
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Keeps the colours for the next start; storage that is full or blocked is not worth a word. */
export function saveBootColors(storage: Pick<KeyValueStore, 'setItem'>, colors: BootColors): void {
  try {
    storage.setItem(BOOT_COLORS_KEY, JSON.stringify(colors));
  } catch {
    // The boot screens fall back to the default look.
  }
}

export function loadBootColors(storage: Pick<KeyValueStore, 'getItem'>): BootColors | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(BOOT_COLORS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!BOOT_FIELDS.every((field) => typeof record[field] === 'string' && HEX.test(record[field] as string))) return null;
    return bootColors(record as unknown as Palette);
  } catch {
    return null;
  }
}
```

- [ ] **Step 3:** run the test (exit 0), typecheck, lint; report.

---

### Task 3: The appearance store in Services

**Files:** create `src/app/appearance.ts`, `src/app/appearance.test.ts`; modify `src/app/types.ts`, `src/app/services.tsx`, `src/app/createServices.ts`, `src/ui/testing/fakeServices.ts`.

- [ ] **Step 1: Failing test** — `src/app/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Appearance, Settings, SettingsRepository } from '../storage/types.ts';
import { createAppearanceStore } from './appearance.ts';

function fakeSettings(initial: Partial<Settings> = {}) {
  let settings = { model: 'm', grinderName: null, grinderSetting: null, activeBagId: null, ...initial } as Settings;
  const updates: Partial<Settings>[] = [];
  let release: (() => void) | null = null;
  const repo: SettingsRepository & { updates: typeof updates; hold(): void; release(): void } = {
    updates,
    get: async () => settings,
    update: async (patch) => {
      updates.push(patch);
      if (release === null && holding) await new Promise<void>((resolve) => (release = resolve));
      settings = { ...settings, ...patch };
      return settings;
    },
    hold: () => void (holding = true),
    release: () => {
      holding = false;
      release?.();
      release = null;
    },
  };
  let holding = false;
  return repo;
}

const LIGHT_MATCHA: Appearance = { mode: 'light', tint: 'matcha' };

describe('createAppearanceStore', () => {
  it('starts from what it is given', () => {
    expect(createAppearanceStore(fakeSettings(), LIGHT_MATCHA).get()).toEqual(LIGHT_MATCHA);
    expect(createAppearanceStore(fakeSettings()).get()).toEqual({ mode: 'dark', tint: 'crema' });
  });

  it('applies a change at once, tells subscribers, and saves it', async () => {
    const settings = fakeSettings();
    const store = createAppearanceStore(settings);
    let told = 0;
    store.subscribe(() => (told += 1));
    const saving = store.set(LIGHT_MATCHA);
    expect(store.get()).toEqual(LIGHT_MATCHA);
    expect(told).toBe(1);
    await saving;
    expect(settings.updates).toEqual([{ appearance: LIGHT_MATCHA }]);
  });

  it('previews without saving, and says nothing when nothing changed', () => {
    const settings = fakeSettings();
    const store = createAppearanceStore(settings);
    let told = 0;
    store.subscribe(() => (told += 1));
    store.preview({ mode: 'dark', tint: { hue: 140 } });
    store.preview({ mode: 'dark', tint: { hue: 140 } });
    expect(store.get()).toEqual({ mode: 'dark', tint: { hue: 140 } });
    expect(told).toBe(1);
    expect(settings.updates).toEqual([]);
  });

  it('keeps the latest of quick changes when the saves land late', async () => {
    const settings = fakeSettings();
    const store = createAppearanceStore(settings);
    settings.hold();
    const first = store.set({ mode: 'dark', tint: { hue: 100 } });
    const second = store.set({ mode: 'dark', tint: { hue: 120 } });
    settings.release();
    await Promise.all([first, second]);
    expect(store.get()).toEqual({ mode: 'dark', tint: { hue: 120 } });
  });

  it('reloads what was saved, after an import', async () => {
    const settings = fakeSettings({ appearance: LIGHT_MATCHA });
    const store = createAppearanceStore(settings);
    await store.reload();
    expect(store.get()).toEqual(LIGHT_MATCHA);
  });

  it('rejects when saving fails, and keeps the change on screen', async () => {
    const settings = fakeSettings();
    settings.update = async () => {
      throw new Error('disk full');
    };
    const store = createAppearanceStore(settings);
    await expect(store.set(LIGHT_MATCHA)).rejects.toThrow('disk full');
    expect(store.get()).toEqual(LIGHT_MATCHA);
  });
});
```
(Tidy the `fakeSettings` helper if the hold/release plumbing reads awkwardly; the behaviour under test is what matters.)

- [ ] **Step 2: Implement** — `src/app/appearance.ts`:

```ts
/**
 * The appearance setting as live state. A change shows at once (the theme
 * re-renders) and is saved with the other settings, so it is mirrored to
 * Decaid and exported like them.
 */
import { DEFAULT_APPEARANCE, normalizeAppearance, sameAppearance } from '../storage/settings.ts';
import type { Appearance, SettingsRepository } from '../storage/types.ts';

export interface AppearanceStore {
  get(): Appearance;
  subscribe(listener: () => void): () => void;
  /** Shows an appearance without saving it (the hue slider while it is dragged). */
  preview(next: Appearance): void;
  /** Shows and saves an appearance. A failed save rejects; the change stays on screen for this session. */
  set(next: Appearance): Promise<void>;
  /** Re-reads the saved appearance (after an import). */
  reload(): Promise<void>;
}

export function createAppearanceStore(settings: SettingsRepository, initial: Appearance = DEFAULT_APPEARANCE): AppearanceStore {
  let current = initial;
  let latest = 0;
  const listeners = new Set<() => void>();
  const show = (next: Appearance) => {
    if (sameAppearance(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    preview: show,
    async set(next) {
      const ticket = ++latest;
      show(next);
      const saved = await settings.update({ appearance: next });
      // A later change may have been made while this one was saving: that one wins.
      if (ticket === latest) show(normalizeAppearance(saved.appearance));
    },
    async reload() {
      show(normalizeAppearance((await settings.get()).appearance));
    },
  };
}
```

- [ ] **Step 3: Wire it** —
  - `src/app/types.ts`: `import type { AppearanceStore } from './appearance.ts';` and in `Services` add `appearance: AppearanceStore;` with the doc line `/** How CafAI looks: the appearance setting as live state. */`.
  - `src/app/services.tsx`: add
    ```ts
    /** The appearance to render (Settings > Appearance). */
    export function useAppearance(): Appearance {
      const { appearance } = useServices();
      return useSyncExternalStore(appearance.subscribe, appearance.get);
    }
    ```
    (import the `Appearance` type from `../storage/types.ts`).
  - `src/app/createServices.ts`: after `await restoreFromMirrorIfEmpty(storage);` add
    `const appearance = createAppearanceStore(storage.settings, (await storage.settings.get()).appearance);`
    and include `appearance` in the returned object.
  - `src/ui/testing/fakeServices.ts`: in `createFakeServices`, build the storage first, then
    `appearance: createAppearanceStore(storage.settings, options.storage?.settings?.appearance)`; extend `FakeServices` with `appearance: AppearanceStore` (it is the real store over the fake settings).
- [ ] **Step 4:** `npx vitest run src/app src/ui > /tmp/s3.log 2>&1; echo exit=$?` (exit 0), whole-repo typecheck, lint; report.

---

### Task 4: The theme follows the appearance

**Files:** create `src/ui/platform/usePrefersDark.ts` (+ test), `src/ui/AppTheme.test.tsx`; rewrite `src/ui/AppTheme.tsx`; modify `src/main.tsx`, `index.html`, `src/ui/platform/engineScript.test.ts` only if it pins the page's colours.

- [ ] **Step 1: `usePrefersDark`**:

```ts
/**
 * Whether the device asks for dark mode, live. Decaid's WebView may never
 * report it (docs/HARDWARE_TEST_PLAN.md); then Auto shows light.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  if (!list) return () => {};
  // Older WebViews have only the deprecated addListener.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  list.addListener(onChange);
  return () => list.removeListener(onChange);
}

const read = () => query()?.matches ?? false;

export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
```
Test (jsdom): stub `window.matchMedia` with a controllable list (matches flag + change listeners), render a component that prints `usePrefersDark()`, flip it and fire `change`, expect the text to follow; with `matchMedia` deleted, expect `false`.

- [ ] **Step 2: `AppTheme`** — replace `src/ui/AppTheme.tsx`:

```tsx
import { useEffect, useMemo, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { useAppearance } from '../app/services.tsx';
import { bootColors, paletteFor, saveBootColors } from './appearance.ts';
import type { Palette } from './palette.ts';
import { usePrefersDark } from './platform/usePrefersDark.ts';
import { createCafaiTheme } from './theme.ts';

const themes = new WeakMap<Palette, Theme>();

/** One MUI theme per palette, so switching back to a look costs nothing. */
function themeFor(palette: Palette): Theme {
  let theme = themes.get(palette);
  if (!theme) {
    theme = createCafaiTheme(palette);
    themes.set(palette, theme);
  }
  return theme;
}

/**
 * The theme for the appearance in Settings (and, in Auto, the device's dark
 * preference), plus CssBaseline: touch rules, insets, no page scroll, and the
 * colour scheme, so native controls (select lists, scrollbars) match.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const appearance = useAppearance();
  const prefersDark = usePrefersDark();
  const palette = paletteFor(appearance, prefersDark);
  const theme = useMemo(() => themeFor(palette), [palette]);
  // The boot screens of the next start show this look too.
  useEffect(() => saveBootColors(window.localStorage, bootColors(palette)), [palette]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
```
(`window.localStorage` itself can throw when storage is blocked: wrap the access in the effect in `try`, or pass a getter; `saveBootColors` already swallows `setItem` errors.)

Test `src/ui/AppTheme.test.tsx` (jsdom): render `<ServicesProvider services={createFakeServices({ storage: { settings: { ...settings, appearance: { mode: 'light', tint: 'matcha' } } } })}><AppTheme><Probe /></AppTheme></ServicesProvider>` where `Probe` prints `useTheme().palette.mode` and `palette.primary.main`; expect light and Matcha's light accent; `act(() => services.appearance.preview({ mode: 'dark', tint: 'crema' }))` flips it to dark Crema; `localStorage.getItem('cafai.appearance.boot')` holds the dark Crema boot colours.

- [ ] **Step 3: Boot screen** — in `src/main.tsx`, `const BOOT = buildPalette(...)` becomes
```ts
// Before the app (and its appearance setting) loads: the look it showed last, or the default.
const BOOT = readBootColors() ?? bootColors(buildPalette('dark', namedTint(DEFAULT_TINT_ID)));
```
with
```ts
function readBootColors() {
  try {
    return loadBootColors(window.localStorage);
  } catch {
    return null;
  }
}
```
and imports from `./ui/appearance.ts`. `BOOT.line`, `BOOT.ink`, `BOOT.background`, `BOOT.inkMuted` keep working.

- [ ] **Step 4: Watchdog page** — in `index.html`'s ES5 script (keep it ES5: `var`, `function`, no arrows, no template literals): add

```js
        // The last look the app showed (src/ui/appearance.ts writes it), else the default.
        function bootColors() {
          var colors = { background: '#14100D', ink: '#F6ECE3', line: 'rgba(246,236,227,0.4)' };
          var raw;
          try {
            raw = JSON.parse(win.localStorage.getItem('cafai.appearance.boot') || 'null');
          } catch (unreadable) {
            raw = null;
          }
          if (raw && /^#[0-9a-f]{6}$/i.test(raw.background) && /^#[0-9a-f]{6}$/i.test(raw.ink) && /^#[0-9a-f]{6}$/i.test(raw.line)) {
            colors = raw;
          }
          return colors;
        }
```
make `CONTROL_CSS` a function `controlCss(colors)` that uses `colors.line` for the border and `colors.ink` for the text, and in `show()` use `colors.background` / `colors.ink` instead of `#14100D` / `#F6ECE3`, and `font-family:Figtree,Helvetica,Arial,sans-serif`. Run `npx vitest run src/ui/platform/engineScript.test.ts`; if a test pins the old colours or CONTROL_CSS, update it to the new values and add one case: with `cafai.appearance.boot` holding light colours, the failure page uses them.

- [ ] **Step 5:** `npx vitest run src/ui src/app > /tmp/s4.log 2>&1; echo exit=$?`, typecheck, lint; report.

---

### Task 5: One shot recording for the whole app (`ShotTrace`)

**Files:** create `src/ui/machine/shotTrace.ts`, `src/ui/machine/shotTrace.test.ts`; modify `src/ui/machine/LiveShotGraph.tsx`, `src/ui/machine/LiveShotGraph.test.tsx`, `src/ui/shell/AppShell.tsx`.

Today `LiveShotGraph` builds its buffer inside the effect that creates the uPlot instance, so a plot rebuilt for a new palette (the effect depends on the graph colours) would start empty mid-shot, and stage 3's second graph would miss the shot's start. The recording moves to one trace per telemetry store; graphs draw from it.

- [ ] **Step 1: `shotTrace.ts`**:

```ts
/**
 * The live shot, recorded once for the whole app. Every graph draws from the
 * same buffer, so a graph opened mid-shot has the shot from its first frame
 * and a graph rebuilt for a new theme loses nothing.
 *
 * Samples never touch React state: they go into the buffer and the graphs
 * are told to repaint. React hears only of the phase, a few times a shot.
 */
import type { TelemetryStore } from '../../api/types.ts';
import { createShotBuffer, type ShotBuffer } from './shotBuffer.ts';

export type ShotPhase = 'empty' | 'live' | 'done';

export interface ShotTraceState {
  phase: ShotPhase;
  /** The finished shot on screen, whose card's numbers replace the live ones; null while live or empty. */
  finishedShotId: string | null;
}

/** A new shot emptied the arrays (repaint now, before uPlot redraws from stale indexes), or frames arrived. */
export type ShotDataChange = 'reset' | 'frames';

export interface ShotTrace {
  readonly buffer: ShotBuffer;
  getState(): ShotTraceState;
  subscribe(listener: () => void): () => void;
  onData(listener: (change: ShotDataChange) => void): () => void;
}

/** Decaid's shot states once the pour is over. */
const POUR_OVER: ReadonlySet<string> = new Set(['stopping', 'finished']);

export function createShotTrace(telemetry: TelemetryStore): ShotTrace {
  const buffer = createShotBuffer();
  let state: ShotTraceState = { phase: 'empty', finishedShotId: null };
  let showingShot = false;
  const listeners = new Set<() => void>();
  const dataListeners = new Set<(change: ShotDataChange) => void>();

  const setState = (next: ShotTraceState) => {
    if (next.phase === state.phase && next.finishedShotId === state.finishedShotId) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const changed = (change: ShotDataChange) => {
    for (const listener of [...dataListeners]) listener(change);
  };

  telemetry.onSample((sample) => {
    if (!buffer.push(sample)) return;
    // Started mid-shot: the first plotted frame is the start we missed.
    if (!showingShot) {
      showingShot = true;
      setState({ phase: 'live', finishedShotId: null });
    }
    changed('frames');
  });
  telemetry.onShot((event) => {
    if (event.type === 'started') {
      buffer.reset();
      showingShot = true;
      changed('reset');
      setState({ phase: 'live', finishedShotId: null });
    } else {
      // The finished shot stays on screen until the next one starts.
      setState(buffer.length > 0 ? { phase: 'done', finishedShotId: event.shotId } : { phase: 'empty', finishedShotId: null });
    }
  });
  // Decaid's stopping (or finished) frame carries the timestamp of the machine
  // frame it stopped on. Only a change counts, so a state still showing from
  // the last shot never stops the next shot's clock.
  let shotState = telemetry.getState().shotState;
  telemetry.subscribe(() => {
    const next = telemetry.getState().shotState;
    if (next === shotState) return;
    shotState = next;
    if (next && POUR_OVER.has(next.state) && buffer.endPour(next.timestamp)) changed('frames');
  });

  return {
    buffer,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => void dataListeners.delete(listener);
    },
  };
}

const traces = new WeakMap<TelemetryStore, ShotTrace>();

/** The app's one trace for a telemetry store, recording from its first use for as long as the store lives. */
export function shotTraceFor(telemetry: TelemetryStore): ShotTrace {
  let trace = traces.get(telemetry);
  if (!trace) {
    trace = createShotTrace(telemetry);
    traces.set(telemetry, trace);
  }
  return trace;
}
```
Tests (`shotTrace.test.ts`, Node, with `createFakeTelemetry` from `../testing/fakeServices.ts` and a `sample(t)` helper like LiveShotGraph.test.tsx's): started resets the buffer and reports `'reset'` then phase live; frames report `'frames'`; finished with data gives `{ phase: 'done', finishedShotId }`, without data `{ phase: 'empty' }`; a sample before any started event (opened mid-shot) goes live; a stopping shotState frame calls `endPour` (the buffer's `pourEndS()` stops moving); `shotTraceFor` returns the same trace for the same store and a new one for another.

- [ ] **Step 2: `LiveShotGraph` draws from the trace** — in `src/ui/machine/LiveShotGraph.tsx`:
  - Replace the per-instance state `const [phase, setPhase] = useState<Phase>('empty');` and `const [finishedShotId, setFinishedShotId] = useState<string | null>(null);` with
    ```ts
    const trace = useMemo(() => shotTraceFor(telemetry), [telemetry]);
    const { phase, finishedShotId } = useSyncExternalStore(trace.subscribe, trace.getState);
    ```
    (remove the local `Phase` type and `POUR_OVER`, now in shotTrace.ts).
  - The plot effect no longer creates a buffer or subscribes to telemetry; it uses `const { buffer } = trace;`, creates the plot from `buffer.data`, keeps `paint`/`schedule`/resize exactly as they are, paints at once when `buffer.length > 0` (a plot rebuilt mid-shot, or opened after the shot), and subscribes:
    ```ts
    const stopData = trace.onData((change) => {
      if (change === 'reset') {
        if (frame !== null) cancelFrame(frame);
        frame = null;
        // The last shot's card numbers go with it, before this paint.
        shownCard.current = null;
        paint();
      } else {
        schedule();
      }
    });
    ```
    and its cleanup calls `stopData()` (instead of the three telemetry unsubscribes). Dependencies: `[trace, colors, fontFamily]`.
  - The card-numbers effect and the markup stay as they are.
- [ ] **Step 3: Tests** — `LiveShotGraph.test.tsx`: run it. The case "subscribes to samples on mount and lets go on unmount" now expects the trace to keep recording: after `unmount()`, `sampleListenerCount` stays `1` and the plot is destroyed; rename it to "draws from the app-wide recording, which outlives the graph". Add: "rebuilds the plot for a new palette and keeps the shot": render inside a `ThemeProvider` whose theme comes from `createCafaiTheme(buildPalette('dark', namedTint('crema')))`, emit started and three samples, `rerender` with a light Matcha theme, expect `fakePlots.length` 2, the first destroyed, and the second's last `setDataCalls` entry to have the same x values as before. Every other case must pass unchanged; if one cannot, explain why in the report.
- [ ] **Step 4: Start recording with the app** — in `src/ui/shell/AppShell.tsx`, after `useHeartbeatOnInteraction(heartbeat);` add
  ```ts
  // Record shots from the start, whether or not a graph is on screen (the phone's other tabs).
  useMemo(() => shotTraceFor(telemetry), [telemetry]);
  ```
  (take `telemetry` from `useServices()`; import `useMemo`; if the linter objects to an unused memo, call `shotTraceFor(telemetry)` in a `useEffect` instead.)
- [ ] **Step 5:** `npx vitest run src/ui > /tmp/s5.log 2>&1; echo exit=$?`, typecheck, lint; report.

---

### Task 6: Settings > Appearance

**Files:** create `src/ui/settings/AppearanceSection.tsx`, `src/ui/settings/AppearanceSection.test.tsx`; modify `src/ui/settings/SettingsScreen.tsx`, `src/ui/testIds.ts`, `src/ui/history/HistoryScreen.tsx`.

- [ ] **Step 1: Test ids** — add to `TID` in `src/ui/testIds.ts`, in the Settings group:
  ```ts
  appearanceMode: (mode: string) => `appearance-mode-${mode}`,
  tintSwatch: (id: string) => `tint-${id}`,
  tintHue: 'tint-hue',
  ```
- [ ] **Step 2: Failing tests** — `AppearanceSection.test.tsx` (jsdom; `import '../chat/testing/setup.ts'`; render with `renderWithServices` from `../chat/testing/render.tsx`, which provides fake services and the theme):
  - shows Dark, Light and Auto as a single choice with Dark chosen by default (`aria-pressed` or `aria-checked`), and the Auto helper text "Auto follows this device's light or dark setting.";
  - tapping Light calls the store: afterwards `services.appearance.get()` is `{ mode: 'light', tint: 'crema' }` and `services.storage` settings hold it (await the update);
  - lists the seven named tints and Custom as radios named "Crema" ... "Steel", "Custom", with Crema checked; tapping Matcha sets `tint: 'matcha'`;
  - the hue slider (`TID.tintHue`, a slider role with an accessible name "Custom hue") moved with the keyboard (focus it, press ArrowRight) previews then saves `tint: { hue: <a number> }`, and checks Custom;
  - a failed save shows "Could not save the appearance:" with the error text (make `services.storage.settings.update` reject).
- [ ] **Step 3: Implement `AppearanceSection.tsx`** — a `Section` like the others in SettingsScreen (move `Section` to its own small export if needed, or pass `title`/children the same way) titled "Appearance":
  - **Mode**: MUI `ToggleButtonGroup` (`exclusive`, `fullWidth`, each `ToggleButton` 48 px, icons `DarkModeRounded`, `LightModeRounded`, `BrightnessAutoRounded`, labels "Dark", "Light", "Auto", `data-testid={TID.appearanceMode(mode)}`), `aria-label="Mode"`; under it `Typography variant="body2" color="text.secondary"`: "Auto follows this device's light or dark setting."
  - **Tint**: a `role="radiogroup"` labelled "Tint", a 4-column grid of 48 px round swatch buttons with the name under each (`variant="label"`). Each swatch draws its own tint in the current mode: outer circle `buildPalette(mode, tint).accent`, inner circle that palette's `background` (inset 9 px), `role="radio"`, `aria-checked`, `aria-label` the tint's name, `data-testid={TID.tintSwatch(id)}`; the checked one gets a 2 px ring in `text.primary` offset by 3 px (box-shadow, not an outline that clips). The eighth is Custom: a conic-gradient ring of the hue wheel (computed hex stops from `oklch(0.76, 0.11, h)` for h = 0, 30, ... 360, so no `oklch()` reaches CSS), checked when the tint is a hue; tapping it sets `{ hue: <the slider's current hue> }`.
  - **Custom hue**: MUI `Slider` min 0, max 359, step 1, `aria-label="Custom hue"`, `data-testid={TID.tintHue}`, value = the tint's hue (or the current named tint's hue), its rail a linear-gradient of the same hex stops, the thumb filled with the current accent and enlarged so its touch area is 48 px (`'& .MuiSlider-thumb': { width: 28, height: 28 }`, `'& .MuiSlider-thumb::after': { width: 48, height: 48 }`); `onChange` previews (`appearance.preview`), `onChangeCommitted` saves (`appearance.set`).
  - Helper text: "The tint colours the buttons and tints the backgrounds. Shot graph colours never change: pressure green, flow blue."
  - Every change goes through `useServices().appearance.set(next)`; a rejection shows an `Alert severity="error"`: `Could not save the appearance: ${message}` (dismissible, like the other sections).
  Read the current value with `useAppearance()`, and the mode for the swatches with `usePrefersDark()` + `resolveMode` (from `../appearance.ts`).
- [ ] **Step 4: First on Settings** — in `SettingsScreen`, render `<AppearanceSection />` before `<ApiKeySection />`.
- [ ] **Step 5: An import reloads it** — in `HistoryScreen`'s `onImport`, next to `coach.refresh().catch(() => undefined);` add `appearance.reload().catch(() => undefined);` (take `appearance` from `useServices()`).
- [ ] **Step 6:** `npx vitest run src/ui/settings src/ui/history > /tmp/s6.log 2>&1; echo exit=$?`, typecheck, lint; report.

---

### Task 7: End-to-end and the light-mode look (controller)

- [ ] **Step 1: `e2e/appearance.spec.ts`**:

```ts
import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openApp } from './helpers.ts';

test('a light Matcha look applies to every screen and survives a reload', async ({ page }) => {
  await openApp(page, '#/settings');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await page.getByTestId(TID.appearanceMode('light')).click();
  await page.getByTestId(TID.tintSwatch('matcha')).click();
  await expect.poll(background).not.toBe(dark);
  const light = await background();
  await page.getByTestId(TID.navCoach).click();
  expect(await background()).toBe(light);
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  expect(await background()).toBe(light);
});
```
(`openApp` waits for `appReady`. If the mock build does not persist storage across a reload, use `openAppWithSwitches(page, { mockPersist: '1' }, '#/settings')`, as `e2e/restore.spec.ts` does, and say so.)

- [ ] **Step 2:** free port 4174, run the full e2e suite (three tablet projects), the Chromium 91 smoke and loop, and screenshots of the demo in light Matcha and light Crema at 962x602 and 1280x800 on coach, history, settings and mid-shot. Fix what light mode exposes (x-chat's composer and bubbles, native select popups, chips, the graph's grid) in a follow-up task if needed.
- [ ] **Step 3: Decisions** — append to the "UX: modes and theme" section of `DECISIONS.md`:

```markdown
- **D82. The appearance is a setting, with a boot cache.** `Settings.appearance`
  (`{ mode: dark | light | auto, tint: <id> | { hue } }`, default dark Crema)
  is read leniently, mirrored to Decaid and exported like the other settings;
  an import adopts it only while this device still has the default (like the
  model). Storage keeps any well-formed tint id and the UI reads an unknown
  one as Crema, so a newer CafAI's tint survives an older one. An
  `AppearanceStore` in Services applies a change at once and saves it; the
  hue slider previews while dragged and saves on release. The last resolved
  colours are kept in localStorage (`cafai.appearance.boot`) for main.tsx's
  boot screen and index.html's watchdog page. Auto follows
  prefers-color-scheme; whether Decaid's WebView reports it is on the
  hardware plan, and it shows light where the query never matches.
- **D83. One shot recording for the app (ShotTrace), a stage early.** The
  buffer moved out of LiveShotGraph into a trace per telemetry store, started
  with the shell, so a graph rebuilt for a new palette keeps the shot and
  stage 3's second graph has the shot from its first frame. The trace outlives
  any graph.
```
Also add to `docs/HARDWARE_TEST_PLAN.md`: "Appearance Auto: set the tablet to dark mode, choose Auto in Settings > Appearance, and note whether CafAI turns dark (it shows light if Decaid's WebView never reports the preference)."

# Usage analytics with Microsoft Clarity: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release builds share how CafAI is used with Microsoft Clarity:
- in Europe, only after the barista says yes;
- elsewhere by default, with a notice;
- with a Settings switch on every device;
- with every word hidden;
- with eleven coach events for funnels and the screen in the address for
  heatmaps.

**Architecture:**
- A small module, `src/usage/`, holds:
  - the region rule;
  - the device's answer in localStorage;
  - CafAI's own Clarity loader;
  - the address helper;
  - a service, a state machine that loads nothing before `start()`.
- `createServices` creates the service only when the build has a project ID.
- The coach engine gets a `UsageTracker` dependency, a no-op by default.
- The UI adds:
  - a card or notice in the chat's prompt row;
  - a switch in Settings > About;
  - mask attributes.
- The e2e drives it through a mock-mode seam (`?mockUsage=1`), with Clarity's
  hosts routed to a stub.

**Tech Stack:** TypeScript 5.9, React 19, MUI 9, @mui/x-chat, Vite 8 (Chromium
91 target), Vitest 5 (jsdom), Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-22-usage-analytics-design.md`
(decisions D-USAGE-1 to D-USAGE-7, numbered after the merge).

**Work in:** `E:\source\cafai-usage-analytics` (branch `feat/usage-analytics`,
off `main` at ccf48e2). Run every command from that folder.

---

## File map

| File | Does |
|---|---|
| `src/usage/types.ts` (new) | The event names, the tag names, `UsageTracker` and `NO_USAGE`. |
| `src/usage/region.ts` (new) | `consentRule()`, the ask-first rule, and `readRegionSignals()`. |
| `src/usage/choice.ts` (new) | The device's answer under `cafai.usage.choice`. |
| `src/usage/clarity.ts` (new) | Clarity's queue stub and one async script tag. |
| `src/usage/address.ts` (new) | `withScreen()` and `mirrorScreen()` for the `screen` parameter. |
| `src/usage/mask.ts` (new) | `MASK` and `SECRET_FIELD`, the attributes Clarity obeys. |
| `src/usage/projectId.ts` (new) | Which Clarity project a build reports to, or null. |
| `src/usage/service.ts` (new) | `createUsageService()`, the state machine. |
| `src/ui/usage/screens.ts` (new) | `screenOf(route)`, a route's name in the address. |
| `src/ui/usage/useUsage.ts` (new) | The hook the card and the switch read. |
| `src/ui/usage/UsagePrompt.tsx` (new) | The card (ask first) and the notice. |
| `src/ui/settings/UsageRow.tsx` (new) | The About switch. |
| `src/app/types.ts` | Adds `usage?: UsageService` to `Services`. |
| `src/app/createServices.ts` | Creates the service; adds the version, host and coach-source tags; passes it to the engine. |
| `src/app/App.tsx` | Adds `UsageTracking`: start, screen and layout. |
| `src/app/engine/engine.ts` | Adds `deps.usage` and eleven `track` calls. |
| `src/ui/chat/ChatSurface.tsx` | Masks the chat, puts the secret marker on the composer, and adds the card to `PromptRow`. |
| `src/ui/settings/SettingsScreen.tsx` | Key field marker, `coach_setup` on save, and the About row. |
| `src/ui/settings/CoachSourceSection.tsx` | Code field marker and `coach_setup` on save. |
| `src/ui/settings/LogView.tsx` | Masks the log. |
| `src/ui/testIds.ts` | Adds four ids. |
| `src/vite-env.d.ts` | Types `VITE_CLARITY_PROJECT_ID`. |
| `.github/workflows/release.yml` | Passes the repository variable to `release:zip`. |
| `e2e/usage.spec.ts` (new) | The card, the notice, Turn off, and the demo. |
| Docs | DECISIONS, README, SECURITY, DESIGN, CHANGELOG and QUESTIONS (Task 10). |

---

### Task 1: The region rule

**Files:**
- Create: `src/usage/region.ts`
- Test: `src/usage/region.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/usage/region.test.ts
import { describe, expect, it } from 'vitest';
import { consentRule, regionOf } from './region.ts';

const rule = (timeZone: string | undefined, languages: string[] = ['en-US']) => consentRule({ timeZone, languages });

describe('consentRule (D-USAGE-2)', () => {
  it('asks first in every European zone', () => {
    for (const zone of ['Europe/Berlin', 'Europe/London', 'Europe/Zurich', 'Europe/Dublin', 'Europe/Istanbul', 'Europe/Kyiv']) {
      expect(rule(zone), zone).toBe('ask');
    }
  });

  it('asks first in the European zones outside Europe/', () => {
    const zones = [
      'Asia/Nicosia', 'Asia/Famagusta', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Reykjavik',
      'Atlantic/Faroe', 'Africa/Ceuta', 'Arctic/Longyearbyen', 'America/Cayenne', 'America/Guadeloupe',
      'America/Martinique', 'America/Marigot', 'Indian/Reunion', 'Indian/Mayotte',
    ];
    for (const zone of zones) expect(rule(zone), zone).toBe('ask');
  });

  it('asks first when the zone says nothing', () => {
    for (const zone of [undefined, '', 'UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+1', 'Universal', 'Zulu']) expect(rule(zone), String(zone)).toBe('ask');
  });

  it('asks first when a language names a European country', () => {
    for (const tag of ['de-DE', 'en-GB', 'fr-CH', 'nb-NO', 'is-IS', 'de-LI', 'en-IE', 'pt-PT', 'el-GR', 'en-150', 'sr-Latn-RS-x-y']) {
      const expected = tag === 'sr-Latn-RS-x-y' ? 'notice' : 'ask';
      expect(rule('America/Chicago', ['en-US', tag]), tag).toBe(expected);
    }
  });

  it('is the notice elsewhere', () => {
    for (const zone of ['America/Chicago', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Hong_Kong', 'America/Sao_Paulo']) {
      expect(rule(zone), zone).toBe('notice');
    }
    expect(rule('America/Chicago', [])).toBe('notice');
    expect(rule('America/Chicago', ['en', 'es-419', 'zh-Hant-TW'])).toBe('notice');
  });
});

describe('regionOf', () => {
  it("reads a language tag's region", () => {
    expect(regionOf('de-DE')).toBe('DE');
    expect(regionOf('en_gb')).toBe('GB');
    expect(regionOf('zh-Hant-TW')).toBe('TW');
    expect(regionOf('es-419')).toBe('419');
    expect(regionOf('en')).toBeNull();
    expect(regionOf('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/usage/region.test.ts`
Expected: FAIL, `Failed to resolve import "./region.ts"`.

- [ ] **Step 3: Write the module**

```ts
// src/usage/region.ts
/**
 * Where CafAI asks before sharing usage (D-USAGE-2). Clarity enforces a
 * consent signal for visitors in the EEA, the UK and Switzerland; CafAI
 * decides on the device, from its time zone and languages, and asks whenever
 * it is unsure: asking someone who did not need asking costs one tap. A
 * tablet left on another zone is still covered, because outside the
 * ask-first case CafAI claims no consent and Clarity's own check of the
 * upload's address keeps cookies off for a European household.
 */

export type ConsentRule = 'ask' | 'notice';

export interface RegionSignals {
  /** The device's IANA time zone, or undefined when it cannot be read. */
  timeZone: string | undefined;
  /** The device's languages, most preferred first. */
  languages: readonly string[];
}

/** European zones outside the Europe/ prefix: Cyprus, the Atlantic islands, Ceuta, Svalbard and France's overseas regions. */
const EUROPEAN_ZONES: ReadonlySet<string> = new Set([
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Atlantic/Canary',
  'Atlantic/Madeira',
  'Atlantic/Azores',
  'Atlantic/Reykjavik',
  'Atlantic/Faroe',
  'Africa/Ceuta',
  'Arctic/Longyearbyen',
  'America/Cayenne',
  'America/Guadeloupe',
  'America/Martinique',
  'America/Marigot',
  'Indian/Reunion',
  'Indian/Mayotte',
]);

/** Zones that say nothing about where the device is. */
const SAYS_NOTHING: ReadonlySet<string> = new Set(['UTC', 'UCT', 'GMT', 'UNIVERSAL', 'ZULU', 'GREENWICH']);

/**
 * Language regions that ask first: the EU, Iceland, Liechtenstein and Norway
 * (the EEA), the UK and Switzerland, the Crown dependencies and Gibraltar,
 * the EU's own regions with codes of their own (Åland, the Canaries, Ceuta
 * and Melilla, France's overseas regions), the Faroes and Svalbard, and
 * Europe as a whole (150).
 */
const ASK_REGIONS: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'UK', 'CH',
  'GI', 'IM', 'JE', 'GG',
  'AX', 'IC', 'EA', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  'FO', 'SJ',
  'EU', '150',
]);

function saysNothing(zone: string): boolean {
  const upper = zone.toUpperCase();
  return upper === '' || SAYS_NOTHING.has(upper) || upper.startsWith('ETC/');
}

/** A language tag's region (de-DE -> DE, zh-Hant-TW -> TW, es-419 -> 419), or null when it names none. */
export function regionOf(tag: string): string | null {
  const parts = tag.split(/[-_]/);
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]!;
    // A singleton (x, u, t...) starts the extensions: nothing after it is a region.
    if (part.length === 1) return null;
    if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase();
  }
  return null;
}

export function consentRule({ timeZone, languages }: RegionSignals): ConsentRule {
  if (timeZone === undefined || saysNothing(timeZone)) return 'ask';
  if (timeZone.startsWith('Europe/') || EUROPEAN_ZONES.has(timeZone)) return 'ask';
  for (const tag of languages) {
    const region = regionOf(tag);
    if (region !== null && ASK_REGIONS.has(region)) return 'ask';
  }
  return 'notice';
}

/** What this device says, read defensively: an Intl or a navigator that throws says nothing. */
export function readRegionSignals(win: Pick<Window, 'navigator'>): RegionSignals {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timeZone = undefined;
  }
  let languages: readonly string[] = [];
  try {
    const { navigator } = win;
    languages = navigator.languages && navigator.languages.length > 0 ? [...navigator.languages] : navigator.language ? [navigator.language] : [];
  } catch {
    languages = [];
  }
  return { timeZone, languages };
}
```

The test's `sr-Latn-RS-x-y` expects `notice` because RS (Serbia) is not on
the list. The singleton rule stops at `x`, after RS has already been read.

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/usage/region.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usage/region.ts src/usage/region.test.ts
git commit -m "feat: usage sharing's region rule: a European time zone or language, or none that says anything, asks first (D-USAGE-2)"
```

### Task 2: The device's answer

**Files:**
- Create: `src/usage/choice.ts`
- Test: `src/usage/choice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/usage/choice.test.ts
import { describe, expect, it } from 'vitest';
import { CHOICE_KEY, readChoice, WORDING, writeChoice, type UsageChoice } from './choice.ts';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), map };
}

const YES: UsageChoice = { choice: 'yes', at: '2026-10-22T08:00:00.000Z', wording: WORDING, rule: 'ask' };

describe('the device choice (D-USAGE-3)', () => {
  it('reads back what was written, under cafai.usage.choice', () => {
    const storage = memory();
    writeChoice(storage, YES);
    expect(JSON.parse(storage.map.get(CHOICE_KEY)!)).toEqual(YES);
    expect(readChoice(storage)).toEqual(YES);
  });

  it('reads nothing chosen from no storage, nothing stored, junk or a record of another shape', () => {
    expect(readChoice(null)).toBeNull();
    expect(readChoice(memory())).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: '{not json' }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: JSON.stringify({ ...YES, choice: 'maybe' }) }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: JSON.stringify({ ...YES, rule: 'other' }) }))).toBeNull();
    expect(readChoice(memory({ [CHOICE_KEY]: '"yes"' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readChoice(broken)).toBeNull();
    expect(() => writeChoice(broken, YES)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/usage/choice.test.ts`
Expected: FAIL, `Failed to resolve import "./choice.ts"`.

- [ ] **Step 3: Write the module**

```ts
// src/usage/choice.ts
/**
 * The device's answer about usage sharing (D-USAGE-3), in the device's own
 * storage under cafai.usage.choice, as the told fun facts are (D200): never
 * mirrored to Decaid or exported, so each device decides for itself.
 * Storage that is blocked or holds something else reads as no answer, and an
 * answer it cannot keep holds for the page.
 */
import type { ConsentRule } from './region.ts';

export const CHOICE_KEY = 'cafai.usage.choice';

/** The card's and the notice's wording, kept with each answer as the record of what was answered. */
export const WORDING = 1;

export interface UsageChoice {
  choice: 'yes' | 'no';
  /** When it was given, ISO. */
  at: string;
  /** The wording answered (WORDING). */
  wording: number;
  /** The rule the device was under when it answered. */
  rule: ConsentRule;
}

type DeviceStorage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function readChoice(storage: DeviceStorage | null): UsageChoice | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(CHOICE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const { choice, at, wording, rule } = raw as Record<string, unknown>;
    if (choice !== 'yes' && choice !== 'no') return null;
    if (typeof at !== 'string' || typeof wording !== 'number') return null;
    if (rule !== 'ask' && rule !== 'notice') return null;
    return { choice, at, wording, rule };
  } catch {
    return null;
  }
}

export function writeChoice(storage: DeviceStorage | null, choice: UsageChoice): void {
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Blocked or full: the answer holds for this page only.
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/usage/choice.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usage/choice.ts src/usage/choice.test.ts
git commit -m "feat: usage sharing's answer, kept on the device only, never mirrored or exported (D-USAGE-3)"
```

### Task 3: The loader, the address and the masks

**Files:**
- Create: `src/usage/types.ts`, `src/usage/clarity.ts`, `src/usage/address.ts`, `src/usage/mask.ts`
- Test: `src/usage/clarity.test.ts`, `src/usage/address.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/usage/clarity.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { CLARITY_TAG, loadClarity } from './clarity.ts';

type Stubbed = Window & { clarity?: ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] } };

afterEach(() => {
  document.querySelectorAll('script[data-cafai-clarity]').forEach((script) => script.remove());
  delete (window as Stubbed).clarity;
});

describe('loadClarity (D-USAGE-6)', () => {
  it("adds Clarity's tag once, async, and queues the calls made before it runs", () => {
    const call = loadClarity(window, 'abc123');
    loadClarity(window, 'abc123');
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-cafai-clarity]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe(`${CLARITY_TAG}abc123`);
    expect(scripts[0]!.async).toBe(true);
    call('event', 'shot_read');
    const queue = (window as Stubbed).clarity!.q!;
    expect(Array.from(queue[0]!)).toEqual(['event', 'shot_read']);
  });

  it("never lets Clarity's own trouble out", () => {
    (window as Stubbed).clarity = () => {
      throw new Error('broken');
    };
    const call = loadClarity(window, 'abc123');
    expect(() => call('event', 'shot_read')).not.toThrow();
  });
});
```

```ts
// src/usage/address.test.ts
import { describe, expect, it, vi } from 'vitest';
import { mirrorScreen, withScreen } from './address.ts';

describe('withScreen (D-USAGE-4)', () => {
  it("sets the screen beside Decaid's cache buster and the hash", () => {
    expect(withScreen('http://localhost:24800/?_=1730000000000#/settings', 'settings')).toBe(
      'http://localhost:24800/?_=1730000000000&screen=settings#/settings',
    );
  });

  it('replaces a screen already there and keeps every other parameter', () => {
    expect(withScreen('http://192.168.1.42:24800/?screen=coach&mockSpeed=25#/shot', 'shot')).toBe(
      'http://192.168.1.42:24800/?screen=shot&mockSpeed=25#/shot',
    );
  });

  it('takes the screen out for null, leaving no empty query behind', () => {
    expect(withScreen('http://localhost:24800/?screen=coach#/', null)).toBe('http://localhost:24800/#/');
    expect(withScreen('http://localhost:24800/?_=1&screen=coach#/', null)).toBe('http://localhost:24800/?_=1#/');
  });
});

describe('mirrorScreen', () => {
  it('replaces the history entry only when the address changes', () => {
    const replaceState = vi.fn();
    const win = { location: { href: 'http://localhost:24800/#/' }, history: { state: null, replaceState } };
    mirrorScreen(win as unknown as Window, null);
    expect(replaceState).not.toHaveBeenCalled();
    mirrorScreen(win as unknown as Window, 'coach');
    expect(replaceState).toHaveBeenCalledWith(null, '', 'http://localhost:24800/?screen=coach#/');
  });

  it('shrugs off a history that refuses', () => {
    const win = {
      location: { href: 'http://localhost:24800/#/' },
      history: {
        state: null,
        replaceState: () => {
          throw new Error('SecurityError');
        },
      },
    };
    expect(() => mirrorScreen(win as unknown as Window, 'coach')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/usage/clarity.test.ts src/usage/address.test.ts`
Expected: FAIL, the imports do not resolve.

- [ ] **Step 3: Write the modules**

```ts
// src/usage/types.ts
/**
 * Usage sharing's vocabulary (D-USAGE-4): the coach steps CafAI counts, each
 * a Clarity custom event a funnel can use (Clarity takes up to 20), and the
 * tags a session carries for Clarity's filters.
 */
export const USAGE_EVENTS = [
  'coach_setup',
  'coach_message',
  'bag_started',
  'profile_loaded',
  'shot_read',
  'taste_given',
  'change_confirmed',
  'change_undone',
  'recipe_kept',
  'fun_fact_shown',
  'coach_error',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

export type UsageTag = 'cafai_version' | 'coach_source' | 'host' | 'layout' | 'rule';

/** What the engine and the screens call; a no-op where the build shares nothing. */
export interface UsageTracker {
  track(event: UsageEvent): void;
}

export const NO_USAGE: UsageTracker = { track: () => undefined };
```

```ts
// src/usage/clarity.ts
/**
 * Microsoft Clarity's tag, loaded by CafAI itself (D-USAGE-6): the queue stub
 * Clarity's own snippet defines, then one async script, so calls made before
 * the script arrives wait in the queue. A load that fails or is blocked
 * changes nothing on screen and logs nothing: Decaid serves the console to
 * the network.
 */
export const CLARITY_TAG = 'https://www.clarity.ms/tag/';

export type ClarityCall = (...args: unknown[]) => void;

type ClarityStub = ClarityCall & { q?: IArguments[] };

export function loadClarity(win: Window, projectId: string): ClarityCall {
  const host = win as unknown as { clarity?: ClarityStub };
  if (!host.clarity) {
    const stub: ClarityStub = function () {
      // Clarity reads its queue as the snippet leaves it: the calls' own arguments objects.
      // eslint-disable-next-line prefer-rest-params
      (stub.q = stub.q || []).push(arguments);
    };
    host.clarity = stub;
  }
  const doc = win.document;
  if (!doc.querySelector('script[data-cafai-clarity]')) {
    const script = doc.createElement('script');
    script.async = true;
    script.src = CLARITY_TAG + encodeURIComponent(projectId);
    script.setAttribute('data-cafai-clarity', '');
    (doc.head || doc.body).appendChild(script);
  }
  return (...args) => {
    try {
      host.clarity?.(...args);
    } catch {
      // Clarity's own trouble is never CafAI's.
    }
  };
}
```

```ts
// src/usage/address.ts
/**
 * The screen in the page's address (D-USAGE-4). CafAI routes by hash, and
 * Clarity starts a page view only when the rest of the address changes, so
 * while the device shares, the open screen also sits in the query as
 * `screen`, set with history.replaceState: no reload, no hash change, no new
 * history entry, and every other parameter (Decaid's `?_=<ms>`, the mock
 * switches) as it was. The router reads only the hash.
 */
export const SCREEN_PARAM = 'screen';

/** The address with `screen` set to `screen`, or taken out for null. */
export function withScreen(href: string, screen: string | null): string {
  const url = new URL(href);
  if (screen === null) url.searchParams.delete(SCREEN_PARAM);
  else url.searchParams.set(SCREEN_PARAM, screen);
  return url.toString();
}

export function mirrorScreen(win: Pick<Window, 'location' | 'history'>, screen: string | null): void {
  const next = withScreen(win.location.href, screen);
  if (next === win.location.href) return;
  try {
    win.history.replaceState(win.history.state, '', next);
  } catch {
    // A page that may not rewrite its address keeps it: the screen stays out of it.
  }
}
```

```ts
// src/usage/mask.ts
/**
 * What Clarity must never see (D-USAGE-5), as attributes it obeys
 * (clarity-js, read 2026-10-22). MASK hides an element's text and images,
 * its children's too. Clarity ignores it on a form field. It drops a field
 * entirely (no value, no hash of one) only when one of the field's
 * attribute values holds a word such as "secret" (its MaskExcludeList), so
 * the API key, the pairing code and the composer carry SECRET_FIELD.
 */
export const MASK = { 'data-clarity-mask': 'true' } as const;
export const SECRET_FIELD = { 'data-private': 'secret' } as const;
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/usage/clarity.test.ts src/usage/address.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usage/types.ts src/usage/clarity.ts src/usage/address.ts src/usage/mask.ts src/usage/clarity.test.ts src/usage/address.test.ts
git commit -m "feat: usage sharing's Clarity loader, the screen in the address and the attributes Clarity obeys (D-USAGE-4 to D-USAGE-6)"
```

### Task 4: The project ID

**Files:**
- Create: `src/usage/projectId.ts`
- Modify: `src/vite-env.d.ts`
- Test: `src/usage/projectId.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/usage/projectId.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clarityProjectId, MOCK_PROJECT_ID } from './projectId.ts';

const at = (search: string) => ({ location: { search } }) as unknown as Window;

afterEach(() => vi.unstubAllEnvs());

describe('clarityProjectId (D-USAGE-6)', () => {
  it("is a production build's VITE_CLARITY_PROJECT_ID, trimmed", () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', ' abc123 ');
    expect(clarityProjectId(at(''))).toBe('abc123');
  });

  it('is none for a production build without one', () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', '');
    expect(clarityProjectId(at(''))).toBeNull();
  });

  it('is none in dev and tests, whatever the shell holds', () => {
    vi.stubEnv('VITE_CLARITY_PROJECT_ID', 'abc123');
    for (const mode of ['development', 'test']) {
      vi.stubEnv('MODE', mode);
      expect(clarityProjectId(at('')), mode).toBeNull();
    }
  });

  it("is the e2e's stand-in in mock mode only with ?mockUsage=1, never in the demo", () => {
    vi.stubEnv('MODE', 'mock');
    expect(clarityProjectId(at('?mockUsage=1'))).toBe(MOCK_PROJECT_ID);
    expect(clarityProjectId(at('?mockUsage=1&demo=1'))).toBeNull();
    expect(clarityProjectId(at('?mockSpeed=25'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/usage/projectId.test.ts`
Expected: FAIL, `Failed to resolve import "./projectId.ts"`.

- [ ] **Step 3: Write the module and the env type**

```ts
// src/usage/projectId.ts
/**
 * Which Clarity project this build reports to (D-USAGE-6), or null. Only a
 * production build reads VITE_CLARITY_PROJECT_ID (release.yml sets it from a
 * repository variable, so a fork's build has none), never dev or the tests,
 * whatever the shell holds. Mock mode reports to a stand-in only when the e2e
 * asks with ?mockUsage=1, with Clarity's hosts routed to a stub; the demo
 * never does.
 */
export const MOCK_PROJECT_ID = 'cafai-e2e';

export function clarityProjectId(win: Pick<Window, 'location'>): string | null {
  const mode = import.meta.env.MODE;
  if (mode === 'mock') {
    const params = new URLSearchParams(win.location.search);
    return params.get('mockUsage') === '1' && params.get('demo') !== '1' ? MOCK_PROJECT_ID : null;
  }
  if (mode !== 'production') return null;
  const id = (import.meta.env.VITE_CLARITY_PROJECT_ID ?? '').trim();
  return id === '' ? null : id;
}
```

Append to `src/vite-env.d.ts`:

```ts

interface ImportMetaEnv {
  /** Microsoft Clarity's project for release builds (D-USAGE-6), from release.yml; read by production builds only. */
  readonly VITE_CLARITY_PROJECT_ID?: string;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/usage/projectId.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usage/projectId.ts src/usage/projectId.test.ts src/vite-env.d.ts
git commit -m "feat: usage sharing's project ID: a production build's VITE_CLARITY_PROJECT_ID, the e2e's stand-in in mock mode, nothing anywhere else (D-USAGE-6)"
```

### Task 5: The service

**Files:**
- Create: `src/usage/service.ts`
- Test: `src/usage/service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/usage/service.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { CHOICE_KEY } from './choice.ts';
import type { ClarityCall } from './clarity.ts';
import type { RegionSignals } from './region.ts';
import { createUsageService } from './service.ts';

const EUROPE: RegionSignals = { timeZone: 'Europe/Berlin', languages: ['de-DE'] };
const AMERICA: RegionSignals = { timeZone: 'America/Chicago', languages: ['en-US'] };

let calls: unknown[][];
let loads: number;
let store: Map<string, string>;
const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
const load = (): ClarityCall => {
  loads += 1;
  return (...args) => void calls.push(args);
};
const service = (signals: RegionSignals) =>
  createUsageService({ win: window, projectId: 'abc123', storage, now: () => new Date('2026-10-22T08:00:00Z'), load, signals });
const named = (name: string) => calls.filter((call) => call[0] === name);

beforeEach(() => {
  calls = [];
  loads = 0;
  store = new Map();
  window.history.replaceState(null, '', '/#/');
});

describe('usage sharing (D-USAGE-3)', () => {
  it('asks first in Europe and loads nothing until yes', () => {
    const usage = service(EUROPE);
    expect(usage.getState()).toEqual({ sharing: false, prompt: 'card', rule: 'ask' });
    usage.start();
    usage.track('shot_read');
    usage.screen('coach');
    expect(loads).toBe(0);
    expect(window.location.search).toBe('');

    usage.choose(true);
    expect(loads).toBe(1);
    expect(calls[0]).toEqual(['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    expect(named('set')).toContainEqual(['set', 'rule', 'ask']);
    expect(window.location.search).toBe('?screen=coach');
    expect(usage.getState()).toEqual({ sharing: true, prompt: null, rule: 'ask' });
    expect(JSON.parse(store.get(CHOICE_KEY)!)).toEqual({ choice: 'yes', at: '2026-10-22T08:00:00.000Z', wording: 1, rule: 'ask' });
  });

  it('No thanks loads nothing, now or at the next start', () => {
    service(EUROPE).choose(false);
    const again = service(EUROPE);
    again.start();
    expect(again.getState()).toEqual({ sharing: false, prompt: null, rule: 'ask' });
    expect(loads).toBe(0);
  });

  it('shares elsewhere from the start, with the notice, claiming no consent', () => {
    const usage = service(AMERICA);
    expect(usage.getState()).toEqual({ sharing: true, prompt: 'notice', rule: 'notice' });
    usage.track('coach_message');
    usage.start();
    expect(loads).toBe(1);
    expect(calls[0]).toEqual(['consentv2', { ad_Storage: 'denied' }]);
    // An event from before the start goes once Clarity is there.
    expect(named('event')).toEqual([['event', 'coach_message']]);
    usage.track('shot_read');
    expect(named('event')).toEqual([['event', 'coach_message'], ['event', 'shot_read']]);
  });

  it('OK keeps sharing and puts the notice away', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.choose(true);
    expect(usage.getState()).toEqual({ sharing: true, prompt: null, rule: 'notice' });
    expect(named('consentv2')).toHaveLength(1);
  });

  it('Turn off erases and stops Clarity, takes the screen out and sends nothing more', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.screen('settings');
    expect(window.location.search).toBe('?screen=settings');
    usage.choose(false);
    expect(named('consent')).toEqual([['consent', false]]);
    expect(named('stop')).toEqual([['stop']]);
    expect(window.location.search).toBe('');
    usage.track('shot_read');
    usage.tag('layout', 'phone');
    usage.screen('coach');
    expect(named('event')).toEqual([]);
    expect(named('set').some((call) => call[1] === 'layout')).toBe(false);
    expect(window.location.search).toBe('');
  });

  it('turned back on in the same page, starts Clarity again', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.choose(false);
    usage.choose(true);
    expect(loads).toBe(1);
    expect(named('start')).toEqual([['start']]);
    expect(named('consentv2')).toHaveLength(2);
  });

  it('a stored answer stands, under either rule', () => {
    store.set(CHOICE_KEY, JSON.stringify({ choice: 'no', at: '2026-10-01T00:00:00.000Z', wording: 1, rule: 'notice' }));
    const usage = service(AMERICA);
    usage.start();
    expect(usage.getState()).toEqual({ sharing: false, prompt: null, rule: 'notice' });
    expect(loads).toBe(0);
  });

  it('sends each tag once, and again only when it changes', () => {
    const usage = service(AMERICA);
    usage.tag('cafai_version', '0.1.3');
    usage.start();
    usage.tag('coach_source', 'none');
    usage.tag('coach_source', 'none');
    usage.tag('coach_source', 'api-key');
    expect(named('set')).toEqual([
      ['set', 'rule', 'notice'],
      ['set', 'cafai_version', '0.1.3'],
      ['set', 'coach_source', 'none'],
      ['set', 'coach_source', 'api-key'],
    ]);
  });

  it('starts once', () => {
    const usage = service(AMERICA);
    usage.start();
    usage.start();
    expect(loads).toBe(1);
    expect(named('consentv2')).toHaveLength(1);
  });

  it('tells its listeners when the state changes', () => {
    const usage = service(EUROPE);
    let heard = 0;
    const stop = usage.subscribe(() => (heard += 1));
    usage.choose(true);
    stop();
    usage.choose(false);
    expect(heard).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/usage/service.test.ts`
Expected: FAIL, `Failed to resolve import "./service.ts"`.

- [ ] **Step 3: Write the service**

```ts
// src/usage/service.ts
/**
 * Usage sharing (D-USAGE-1 to D-USAGE-6): the rule this device is under, its
 * answer, Clarity's loading and consent, and the events, tags and screens
 * that go to Clarity while the device shares. Nothing loads before start(),
 * which the app calls once it has rendered.
 */
import { mirrorScreen } from './address.ts';
import { readChoice, WORDING, writeChoice, type UsageChoice } from './choice.ts';
import { loadClarity, type ClarityCall } from './clarity.ts';
import { consentRule, readRegionSignals, type ConsentRule, type RegionSignals } from './region.ts';
import type { UsageEvent, UsageTag, UsageTracker } from './types.ts';

export interface UsageState {
  /** Whether usage goes to Clarity (once started). */
  sharing: boolean;
  /** What waits at the foot of the chat: the card (ask first), the notice, or nothing once answered. */
  prompt: 'card' | 'notice' | null;
  rule: ConsentRule;
}

export interface UsageService extends UsageTracker {
  getState(): UsageState;
  subscribe(listener: () => void): () => void;
  /** Load Clarity if the device shares; once, after the app's first render. */
  start(): void;
  /** The card's or the notice's answer, or the switch: true shares, false stops. Kept on the device. */
  choose(share: boolean): void;
  /** A tag for the session, sent when it changes. */
  tag(key: UsageTag, value: string): void;
  /** The screen now open, by its name in the address. */
  screen(name: string): void;
}

export interface UsageDeps {
  win: Window;
  projectId: string;
  /** The device's own storage (localStorage), or null where it is blocked. */
  storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null;
  now(): Date;
  /** Clarity's loader (the real one by default). */
  load?: (win: Window, projectId: string) => ClarityCall;
  /** What the device says about where it is (read from it by default). */
  signals?: RegionSignals;
}

/** Events counted before start() on a device that shares wait for Clarity, at most this many. */
const EARLY_CAP = 50;

function stateFor(choice: UsageChoice | null, rule: ConsentRule): UsageState {
  if (choice) return { sharing: choice.choice === 'yes', prompt: null, rule };
  return rule === 'ask' ? { sharing: false, prompt: 'card', rule } : { sharing: true, prompt: 'notice', rule };
}

export function createUsageService(deps: UsageDeps): UsageService {
  const { win, projectId, storage, now } = deps;
  const load = deps.load ?? loadClarity;
  const rule = consentRule(deps.signals ?? readRegionSignals(win));
  let choice = readChoice(storage);
  let state = stateFor(choice, rule);
  let started = false;
  let clarity: ClarityCall | null = null;
  /** Stopped in this page: turned on again, Clarity starts over. */
  let stopped = false;
  const early: UsageEvent[] = [];
  const tags = new Map<UsageTag, string>([['rule', rule]]);
  const sent = new Map<UsageTag, string>();
  let screenName: string | null = null;
  const listeners = new Set<() => void>();

  const live = () => clarity !== null && !stopped;

  function sendTags(): void {
    if (!clarity || stopped) return;
    for (const [key, value] of tags) {
      if (sent.get(key) === value) continue;
      clarity('set', key, value);
      sent.set(key, value);
    }
  }

  function begin(): void {
    if (!clarity) clarity = load(win, projectId);
    else if (stopped) clarity('start');
    stopped = false;
    // Analytics consent only where CafAI asked and heard yes; elsewhere it claims none, and keeps ads off (D-USAGE-3).
    if (choice?.choice === 'yes' && choice.rule === 'ask') clarity('consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' });
    else clarity('consentv2', { ad_Storage: 'denied' });
    sendTags();
    if (screenName !== null) mirrorScreen(win, screenName);
    for (const event of early.splice(0)) clarity('event', event);
  }

  function end(): void {
    early.length = 0;
    mirrorScreen(win, null);
    if (!live()) return;
    clarity!('consent', false);
    clarity!('stop');
    stopped = true;
    sent.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      if (state.sharing) begin();
      else mirrorScreen(win, null);
    },
    choose(share) {
      const was = state.sharing;
      choice = { choice: share ? 'yes' : 'no', at: now().toISOString(), wording: WORDING, rule };
      writeChoice(storage, choice);
      state = stateFor(choice, rule);
      if (started && share && !was) begin();
      if (!share && was) end();
      for (const listener of listeners) listener();
    },
    track(event) {
      if (!state.sharing) return;
      if (live()) clarity!('event', event);
      else if (!started && early.length < EARLY_CAP) early.push(event);
    },
    tag(key, value) {
      tags.set(key, value);
      if (state.sharing) sendTags();
    },
    screen(name) {
      screenName = name;
      if (state.sharing && live()) mirrorScreen(win, name);
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/usage/service.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/usage/service.ts src/usage/service.test.ts
git commit -m "feat: usage sharing's service: the card in Europe, the notice elsewhere, analytics consent only where asked, ads off, Turn off erases and stops Clarity (D-USAGE-3)"
```

### Task 6: Wiring

**Files:**
- Modify: `src/app/types.ts` (the `Services` interface)
- Modify: `src/app/createServices.ts`
- Modify: `src/app/App.tsx`
- Create: `src/ui/usage/screens.ts`
- Test: `src/ui/usage/screens.test.ts`, `src/app/createServices.test.ts` (one case)
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write the failing test for the screen names**

```ts
// src/ui/usage/screens.test.ts
import { describe, expect, it } from 'vitest';
import { screenOf } from './screens.ts';

describe('screenOf (D-USAGE-4)', () => {
  it("names every route, and never a bag's id", () => {
    expect(screenOf({ name: 'coach' })).toBe('coach');
    expect(screenOf({ name: 'shot' })).toBe('shot');
    expect(screenOf({ name: 'history' })).toBe('history');
    expect(screenOf({ name: 'history', bagId: 'bag-123' })).toBe('history-bag');
    expect(screenOf({ name: 'settings' })).toBe('settings');
    expect(screenOf({ name: 'care', routine: 'weekly' })).toBe('care');
    expect(screenOf({ name: 'drink', drink: 'steam' })).toBe('steam');
    expect(screenOf({ name: 'drink', drink: 'hotWater' })).toBe('hot-water');
    expect(screenOf({ name: 'drink', drink: 'flush' })).toBe('flush');
  });
});
```

Run: `npx vitest run src/ui/usage/screens.test.ts`
Expected: FAIL, the import does not resolve.

- [ ] **Step 2: Write `screens.ts`**

```ts
// src/ui/usage/screens.ts
import type { Route } from '../router.ts';

/** A route's name in the address while the device shares usage (D-USAGE-4): never a bag's id. */
export function screenOf(route: Route): string {
  switch (route.name) {
    case 'history':
      return route.bagId ? 'history-bag' : 'history';
    case 'drink':
      return route.drink === 'hotWater' ? 'hot-water' : route.drink;
    default:
      return route.name;
  }
}
```

Run: `npx vitest run src/ui/usage/screens.test.ts`
Expected: PASS.

- [ ] **Step 3: Add `usage` to `Services`** (`src/app/types.ts`, after `care?: CareService;`)

```ts
  /**
   * Usage sharing with Microsoft Clarity (D-USAGE-1): only in a build with
   * Clarity's project ID (src/usage/projectId.ts). Fakes, previews and
   * every other build leave it out, and then no card, notice or switch shows.
   */
  usage?: UsageService;
```

with `import type { UsageService } from '../usage/service.ts';` among the
type imports.

- [ ] **Step 4: Create the service in `createServices`**

In `src/app/createServices.ts`, add the imports:

```ts
import { clarityProjectId } from '../usage/projectId.ts';
import { createUsageService } from '../usage/service.ts';
```

After the `deviceStorage` block (the `try { deviceStorage = win.localStorage; }` lines), add:

```ts
  // Usage sharing (D-USAGE-1): a build with Clarity's project ID only, and nothing loads before the
  // app has rendered (App.tsx). Its answer lives in the device's own storage, like the care counts' cache.
  const clarityProject = clarityProjectId(win);
  const usage = clarityProject ? createUsageService({ win, projectId: clarityProject, storage: deviceStorage, now: () => new Date() }) : undefined;
  usage?.tag('cafai_version', APP_VERSION);
  usage?.tag('host', host.platform ?? 'browser');
```

Pass it to the engine. Add `usage,` to the `createCoachEngine({ ... })`
argument, after `told: createToldList(deviceStorage),`.

After `await coach.start();`, add:

```ts
  // Which coach this device runs, for Clarity's filters (D-USAGE-4): none until the chosen source has its key or code.
  let sourceKind = (await coachSource?.get().catch(() => null))?.kind ?? 'anthropic';
  const tagCoachSource = () =>
    usage?.tag('coach_source', !coach.getState().hasApiKey ? 'none' : sourceKind === 'computer' ? 'bridge' : 'api-key');
  const stopSourceTag = usage
    ? coachSource?.subscribe((source) => {
        sourceKind = source.kind;
        tagCoachSource();
      })
    : undefined;
  const stopCoachTag = usage ? coach.subscribe(tagCoachSource) : undefined;
  tagCoachSource();
```

In the returned object, add `usage,` after `care,`. In `dispose()`, add
`stopSourceTag?.();` and `stopCoachTag?.();` before `coach.dispose();`.

Check that `coach.subscribe` returns an unsubscribe function, as
`telemetry.subscribe` does (`src/app/engine/engine.ts`, `CoachEngine`). If its
listener receives arguments, wrap it: `coach.subscribe(() => tagCoachSource())`.

- [ ] **Step 5: Start it, and tell it each screen and the layout** (`src/app/App.tsx`)

Add the imports:

```ts
import { useServices } from './services.tsx';
import { useLayout } from '../ui/shell/layout.ts';
import { screenOf } from '../ui/usage/screens.ts';
```

`./services.tsx` is already imported for `ServicesProvider`, so merge the
two into one import line. Add, above `Routed`:

```tsx
/**
 * Usage sharing's hooks into the app (D-USAGE-4, D-USAGE-6): it starts once
 * the app has rendered, then hears each screen and the layout.
 */
function UsageTracking({ route }: { route: Route }) {
  const { usage } = useServices();
  const layout = useLayout().mode;
  useEffect(() => usage?.start(), [usage]);
  useEffect(() => usage?.screen(screenOf(route)), [usage, route]);
  useEffect(() => usage?.tag('layout', layout), [usage, layout]);
  return null;
}
```

In `Routed`, return the tracker beside the shell:

```tsx
  return (
    <>
      <UsageTracking route={route} />
      <AppShell route={route} onNavigate={navigate}>
        {screen}
      </AppShell>
    </>
  );
```

- [ ] **Step 6: Release builds get the ID** (`.github/workflows/release.yml`)

```yaml
      - run: npm run release:zip
        env:
          # Usage sharing's Clarity project (D-USAGE-6): a repository variable, so a fork's build has none.
          VITE_CLARITY_PROJECT_ID: ${{ vars.CLARITY_PROJECT_ID }}
```

- [ ] **Step 7: A test that the services carry no usage without an ID**

In `src/app/createServices.test.ts`, inside its existing top-level
`describe` and using its existing setup, add one case modelled on the
nearest test that awaits `createServices(window)`:

```ts
  it('has no usage sharing without a Clarity project (D-USAGE-6)', async () => {
    const services = await createServices(window);
    expect(services.usage).toBeUndefined();
    services.dispose();
  });
```

If that file builds its services through a helper, call the helper instead
of `createServices(window)`, as its other cases do.

- [ ] **Step 8: Run the checks**

Run: `npx tsc -p tsconfig.json --noEmit` (expected: no output)
Run: `npx vitest run src/app src/ui/usage src/usage` (expected: PASS)

- [ ] **Step 9: Commit**

```bash
git add src/app/types.ts src/app/createServices.ts src/app/App.tsx src/ui/usage/screens.ts src/ui/usage/screens.test.ts src/app/createServices.test.ts .github/workflows/release.yml
git commit -m "feat: usage sharing wired in: created only with a project ID, started after the first render, told each screen, the layout, the version, the host and the coach source; release builds take the ID from a repository variable (D-USAGE-1, D-USAGE-4, D-USAGE-6)"
```

### Task 7: The coach engine's events

**Files:**
- Modify: `src/app/engine/engine.ts`
- Test: `src/app/engine/engine.test.ts` (a new `describe` inside `describe('coach engine')`)

- [ ] **Step 1: Write the failing test.** Add it at the end of `describe('coach engine', ...)`, so it uses that block's `build`, `throughTemplatePick`, `throughShot`, `throughProposal`, `scripts` and `telemetry`:

```ts
  describe('usage events (D-USAGE-4)', () => {
    let events: string[];
    const count = (name: string) => events.filter((event) => event === name).length;

    beforeEach(async () => {
      engine.dispose();
      events = [];
      engine = build({ usage: { track: (event) => void events.push(event) } });
      await engine.start();
    });

    it('counts the first words, the bag, the load and the shot', async () => {
      await throughShot();
      expect(count('coach_message')).toBe(1);
      expect(count('bag_started')).toBe(1);
      expect(count('profile_loaded')).toBe(1);
      expect(count('shot_read')).toBe(1);
      expect(events.indexOf('bag_started')).toBeLessThan(events.indexOf('profile_loaded'));
      expect(events.indexOf('profile_loaded')).toBeLessThan(events.indexOf('shot_read'));
    });

    it('counts a tapped taste as a taste and a message, and a confirmed change', async () => {
      await throughProposal();
      expect(count('taste_given')).toBe(1);
      expect(count('coach_message')).toBe(2);
      scripts.push(() => [text('Loaded v2.')]);
      await engine.confirmChange('t-adj');
      expect(count('change_confirmed')).toBe(1);
      expect(count('recipe_kept')).toBe(0);
    });

    it('counts an undo', async () => {
      await throughProposal();
      scripts.push(() => [text('Loaded v2.')]);
      await engine.confirmChange('t-adj');
      scripts.push(() => [text('Back.')]);
      await engine.undo();
      expect(count('change_undone')).toBe(1);
    });

    it('counts a coach turn that ends in an error', async () => {
      await engine.newBag();
      scripts.push(() => {
        throw new Error('overloaded');
      });
      await engine.sendText('Kiambu AA');
      expect(count('coach_error')).toBe(1);
    });

    it('does not count a bag twice when the coach corrects its details', async () => {
      await throughTemplatePick();
      scripts.push(() => [
        toolUse('t-save-again', TOOL.saveBagDetails, { name: 'Kiambu AA (corrected)', roaster: null, origin: null, roastLevel: 'light', process: null, notes: null }),
        text('Fixed.'),
      ]);
      await engine.sendText('It is the corrected one');
      expect(count('bag_started')).toBe(1);
    });
  });
```

Before you run it, check two things in the test file:

- **Script shapes.** The scripted coach's step for a thrown error (`makeLlm`)
  and the confirm flow's follow-up must match what the file's existing tests
  do. Find one existing test of a failing turn (search for `throw new Error`
  inside `scripts.push`) and one of `confirmChange('t-adj')`, and make these
  cases' scripts match theirs exactly. The assertions on `events` stay as
  written.
- **`fun_fact_shown` and `recipe_kept`.** The fun-facts cases in this file
  already drive a kept recipe and a shown fact. Find the one that confirms
  `variable: 'none'` (`recipe_kept`) and the one that shows a list fact
  (`fun_fact_shown`). Add one assertion to each, under its own build with
  `usage`, in the same style as the cases above.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/app/engine/engine.test.ts -t "usage events"`
Expected: FAIL. The events stay empty, and `usage` is not a key of
`EngineDeps` (a type error under vitest is fine; tsc catches it in Step 4).

- [ ] **Step 3: Add the dependency and the calls** (`src/app/engine/engine.ts`)

Import: `import { NO_USAGE, type UsageTracker } from '../../usage/types.ts';`

`EngineDeps`, after `facts?`:

```ts
  /** Usage sharing's counts (D-USAGE-4); nothing by default. */
  usage?: UsageTracker;
```

`createCoachEngine`, after `const facts = deps.facts ?? loadFacts;`:

```ts
  const usage = deps.usage ?? NO_USAGE;
```

The calls, each at the place named:

1. `saveBagDetails`, as its first line: the first details a bag gets, by the coach's tool or a confirmed photo.
   ```ts
    if (s.bag.name === NEW_BAG_NAME) usage.track('bag_started');
   ```
2. `pickBean`, just before `await persistBag(s, {`: the same line.
   ```ts
    if (s.bag.name === NEW_BAG_NAME) usage.track('bag_started');
   ```
3. `noteTaste`, after `if (!words) return;`:
   ```ts
    usage.track('taste_given');
   ```
4. `showFact`, as its first line:
   ```ts
    usage.track('fun_fact_shown');
   ```
5. `runModel`'s `catch (error) {`, after `setError(describe(error), runModel);`:
   ```ts
      usage.track('coach_error');
   ```
6. `confirmOnMachine`, replacing `if (outcome.status === 'loaded' || outcome.status === 'assumed') uploadFailedFor = null;`. Every load goes through here: v1, a confirmed version, undo, a bag switch, Retry and a load that waited for the machine.
   ```ts
    if (outcome.status === 'loaded' || outcome.status === 'assumed') {
      uploadFailedFor = null;
      usage.track('profile_loaded');
    }
   ```
7. `creditShot`, after `addMessage('system', [shotPart(record.id, summary)]);`:
   ```ts
    usage.track('shot_read');
   ```
8. `answerOptions`, after `if (!call) return;`: a tapped choice starts a coach turn.
   ```ts
    usage.track('coach_message');
   ```
9. `confirmChange`, after `setMessages(setDiffStatus(state.messages, requestId, 'applied'));`:
   ```ts
      usage.track(plan.variable === 'none' ? 'recipe_kept' : 'change_confirmed');
   ```
10. `undo`, after ``addMessage('system', [noticePart('info', `Back on ${parent.title}.`)]);``:
    ```ts
    usage.track('change_undone');
    ```
11. `sendText`, after `if (!typed) return;`:
    ```ts
    usage.track('coach_message');
    ```

- [ ] **Step 4: Run the engine tests and the typecheck**

Run: `npx vitest run src/app/engine`
Expected: PASS. The whole engine suite must still pass.
Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/app/engine/engine.ts src/app/engine/engine.test.ts
git commit -m "feat: the coach's steps counted for usage sharing: a message, the bag's first details, every load, a shot read, a taste, a confirmed change or a kept recipe, an undo, a fun fact and a coach error (D-USAGE-4)"
```

### Task 8: The card, the notice, the switch and the masks

**Files:**
- Create: `src/ui/usage/useUsage.ts`, `src/ui/usage/UsagePrompt.tsx`, `src/ui/settings/UsageRow.tsx`
- Modify: `src/ui/testIds.ts`, `src/ui/chat/ChatSurface.tsx`, `src/ui/settings/SettingsScreen.tsx`, `src/ui/settings/CoachSourceSection.tsx`, `src/ui/settings/LogView.tsx`
- Test: `src/ui/usage/UsagePrompt.test.tsx`, `src/ui/settings/UsageRow.test.tsx`, plus one case each in `ChatSurface.test.tsx`, `SettingsScreen.test.tsx`, `CoachSourceSection.test.tsx` and `LogView.test.tsx`

- [ ] **Step 1: The test IDs** (`src/ui/testIds.ts`, a new group before the closing `}` of `TID`)

```ts
  // Usage sharing (D-USAGE-3)
  usagePrompt: 'usage-prompt',
  usageYes: 'usage-yes',
  usageNo: 'usage-no',
  usageSwitch: 'usage-switch',
```

- [ ] **Step 2: Write the failing tests**

```tsx
// src/ui/usage/UsagePrompt.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsagePrompt } from './UsagePrompt.tsx';
import { UsageContextForTests } from './useUsage.ts';
import type { UsageService, UsageState } from '../../usage/service.ts';
import { TID } from '../testIds.ts';

function fakeUsage(state: UsageState): UsageService & { choose: ReturnType<typeof vi.fn> } {
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    start: vi.fn(),
    choose: vi.fn(),
    tag: vi.fn(),
    screen: vi.fn(),
    track: vi.fn(),
  };
}

const renderWith = (usage: UsageService | null) =>
  render(
    <UsageContextForTests value={usage}>
      <UsagePrompt />
    </UsageContextForTests>,
  );

describe('UsagePrompt (D-USAGE-3)', () => {
  it('asks first, and Yes, share or No thanks answers', async () => {
    const usage = fakeUsage({ sharing: false, prompt: 'card', rule: 'ask' });
    renderWith(usage);
    expect(screen.getByTestId(TID.usagePrompt)).toHaveTextContent('Help improve CafAI?');
    await userEvent.click(screen.getByTestId(TID.usageYes));
    expect(usage.choose).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByTestId(TID.usageNo));
    expect(usage.choose).toHaveBeenCalledWith(false);
    expect(screen.getByTestId(TID.usageYes)).toHaveTextContent('Yes, share');
    expect(screen.getByTestId(TID.usageNo)).toHaveTextContent('No thanks');
  });

  it('tells elsewhere, with OK and Turn off', () => {
    renderWith(fakeUsage({ sharing: true, prompt: 'notice', rule: 'notice' }));
    expect(screen.getByTestId(TID.usagePrompt)).toHaveTextContent('Microsoft Clarity');
    expect(screen.getByTestId(TID.usageYes)).toHaveTextContent('OK');
    expect(screen.getByTestId(TID.usageNo)).toHaveTextContent('Turn off');
  });

  it("links to the README's privacy section", () => {
    renderWith(fakeUsage({ sharing: false, prompt: 'card', rule: 'ask' }));
    expect(screen.getByRole('link', { name: 'What is shared' })).toHaveAttribute('href', 'https://github.com/justinmwarner/CafAI#privacy');
  });

  it('shows nothing once answered, or where the build shares nothing', () => {
    const { container } = renderWith(fakeUsage({ sharing: true, prompt: null, rule: 'notice' }));
    expect(container).toBeEmptyDOMElement();
    const none = renderWith(null);
    expect(none.container).toBeEmptyDOMElement();
  });
});
```

```tsx
// src/ui/settings/UsageRow.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UsageRow } from './UsageRow.tsx';
import { UsageContextForTests } from '../usage/useUsage.ts';
import type { UsageService } from '../../usage/service.ts';
import { TID } from '../testIds.ts';

describe('UsageRow (D-USAGE-3)', () => {
  it('shows the device sharing and turns it off', async () => {
    const choose = vi.fn();
    const usage: UsageService = {
      getState: () => ({ sharing: true, prompt: 'notice', rule: 'notice' }),
      subscribe: () => () => undefined,
      start: vi.fn(),
      choose,
      tag: vi.fn(),
      screen: vi.fn(),
      track: vi.fn(),
    };
    render(
      <UsageContextForTests value={usage}>
        <UsageRow />
      </UsageContextForTests>,
    );
    const toggle = screen.getByTestId(TID.usageSwitch);
    expect(toggle).toBeChecked();
    expect(screen.getByText("Share usage with CafAI's developer")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(choose).toHaveBeenCalledWith(false);
  });

  it('is not there where the build shares nothing', () => {
    const { container } = render(
      <UsageContextForTests value={null}>
        <UsageRow />
      </UsageContextForTests>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

Run: `npx vitest run src/ui/usage src/ui/settings/UsageRow.test.tsx`
Expected: FAIL, the imports do not resolve.

- [ ] **Step 3: Write the hook, the prompt and the row**

```ts
// src/ui/usage/useUsage.ts
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useOptionalServices } from '../../app/services.tsx';
import type { UsageService, UsageState } from '../../usage/service.ts';

/** A test's or a preview's own usage service, in place of the services' (undefined: use the services'). */
const UsageOverride = createContext<UsageService | null | undefined>(undefined);

export function UsageContextForTests({ value, children }: { value: UsageService | null; children: ReactNode }) {
  return createElement(UsageOverride.Provider, { value }, children);
}

const unchanging = () => () => undefined;
const nothing = () => null;

/** Usage sharing and its state, or nulls where the build shares nothing or outside a ServicesProvider. */
export function useUsage(): { usage: UsageService | null; state: UsageState | null } {
  const override = useContext(UsageOverride);
  const services = useOptionalServices();
  const usage = override !== undefined ? override : (services?.usage ?? null);
  const state = useSyncExternalStore(usage ? usage.subscribe : unchanging, usage ? usage.getState : nothing);
  return { usage, state };
}
```

```tsx
// src/ui/usage/UsagePrompt.tsx
/**
 * Usage sharing's card and notice (D-USAGE-3), at the foot of the chat in
 * the prompt row: the device's, never the bag's, so never in a transcript,
 * the backup or an export. The card asks first (Europe, D-USAGE-2); the
 * notice tells, elsewhere. Each stays until answered, and nothing waits on it.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useOptionalServices } from '../../app/services.tsx';
import { outsideLinkProps } from '../care/videoPlace.ts';
import { TID } from '../testIds.ts';
import { useUsage } from './useUsage.ts';

export const PRIVACY_URL = 'https://github.com/justinmwarner/CafAI#privacy';

const CARD = {
  title: 'Help improve CafAI?',
  body: 'Share how you use CafAI with its developer through Microsoft Clarity: the screens you open, where you tap and scroll, and steps such as a shot read or a change confirmed. All text is hidden: never your words, your coffee or your key. Settings > About turns it off.',
  yes: 'Yes, share',
  no: 'No thanks',
};

const NOTICE = {
  title: null,
  body: 'CafAI shares how you use it with its developer through Microsoft Clarity: screens, taps and steps such as a shot read, with all text hidden. Settings > About turns it off.',
  yes: 'OK',
  no: 'Turn off',
};

export function UsagePrompt() {
  const { usage, state } = useUsage();
  const host = useOptionalServices()?.host;
  if (!usage || !state?.prompt) return null;
  const words = state.prompt === 'card' ? CARD : NOTICE;
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Usage sharing"
      data-testid={TID.usagePrompt}
      sx={{ flexBasis: '100%', p: 1.5, bgcolor: 'background.paper' }}
    >
      {words.title ? (
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {words.title}
        </Typography>
      ) : null}
      <Typography variant="body2">{words.body}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
        <Button variant="contained" data-testid={TID.usageYes} onClick={() => usage.choose(true)} sx={{ minHeight: 48 }}>
          {words.yes}
        </Button>
        <Button variant="text" data-testid={TID.usageNo} onClick={() => usage.choose(false)} sx={{ minHeight: 48 }}>
          {words.no}
        </Button>
        <Link href={PRIVACY_URL} {...outsideLinkProps({ insideDecaid: host?.insideDecaid ?? false })} variant="body2" sx={{ ml: 'auto' }}>
          What is shared
        </Link>
      </Box>
    </Paper>
  );
}
```

Check `outsideLinkProps`'s parameter type in `src/ui/care/videoPlace.ts`
(its test calls it with `{ insideDecaid: false }`). Pass what it takes.

```tsx
// src/ui/settings/UsageRow.tsx
/** Settings > About's usage switch (D-USAGE-3): on every device, under either rule; a change is the device's answer. */
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { TID } from '../testIds.ts';
import { useUsage } from '../usage/useUsage.ts';

const switchLabelSx = { minHeight: 48 } as const;

export function UsageRow() {
  const { usage, state } = useUsage();
  if (!usage || !state) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <FormControlLabel
        control={
          <Switch
            checked={state.sharing}
            onChange={(event) => usage.choose(event.target.checked)}
            slotProps={{ input: { 'data-testid': TID.usageSwitch } }}
          />
        }
        label="Share usage with CafAI's developer"
        sx={switchLabelSx}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Screens, taps and coach steps go to Microsoft Clarity, with all text hidden.
      </Typography>
    </Box>
  );
}
```

The `slotProps.input` `data-testid` relies on the module augmentation at the
top of `SettingsScreen.tsx` (`SwitchInputSlotPropsOverrides`). It is global,
so it applies here too.

Run: `npx vitest run src/ui/usage src/ui/settings/UsageRow.test.tsx`
Expected: PASS.

- [ ] **Step 4: Put them in place, and mark what Clarity must not see**

`src/ui/chat/ChatSurface.tsx`:

- Imports:
  ```ts
  import { MASK, SECRET_FIELD } from '../../usage/mask.ts';
  import { UsagePrompt } from '../usage/UsagePrompt.tsx';
  ```
- `PromptRow`: read `busy` with the rest, and draw the prompt first, while
  no coach turn runs. The full-width card takes its own line in the wrapping
  row.
  ```tsx
  function PromptRow() {
    const { actions, busy, hasStats, tasteOpen } = usePartsContext();
    const short = useLayout().nav === 'rail';
    return (
      <Box sx={short ? shortPromptRowSx : promptRowSx}>
        {busy ? null : <UsagePrompt />}
        {hasStats ? (
  ```
  The rest is unchanged.
- The root box masks the whole chat: transcript, cards, prompt row and
  composer lane.
  ```tsx
      <Box ref={rootRef} data-testid={TID.chat} data-busy={busy || undefined} {...MASK} sx={chatSx}>
  ```
- `composerInput` slot props: add `...SECRET_FIELD,` after `'data-testid': TID.composerInput,`.

`src/ui/settings/SettingsScreen.tsx`:

- Imports:
  ```ts
  import { SECRET_FIELD } from '../../usage/mask.ts';
  import { UsageRow } from './UsageRow.tsx';
  ```
- `ApiKeySection`: take `usage` from `useServices()`
  (`const { storage, coach, usage } = useServices();`). In `save`, after
  `await coach.refresh();`:
  ```ts
      usage?.track('coach_setup');
  ```
- The key field's `htmlInput`: add `...SECRET_FIELD,` after `'data-testid': TID.apiKeyInput,`.
- `AboutSection`: add `<UsageRow />` after `<AboutDecaid decaidVersion={decaidVersion} />`.

`src/ui/settings/CoachSourceSection.tsx`:

- Import: `import { SECRET_FIELD } from '../../usage/mask.ts';`
- In `CoachSourceForm`, read `usage` from its `useServices()` call. In
  `save`, after `refreshCoach();`:
  ```ts
      usage?.track('coach_setup');
  ```
- The code field's `htmlInput`: add `...SECRET_FIELD,` after `'data-testid': TID.computerCode,`.

`src/ui/settings/LogView.tsx`:

- Import: `import { MASK } from '../../usage/mask.ts';`
- `LogViewContent`'s root: `<Box data-testid={TID.logView} {...MASK} sx={{`.

- [ ] **Step 5: One case each for the marks and the counts**

- `src/ui/chat/ChatSurface.test.tsx`, using the file's own render helper:
  ```tsx
  it('masks the chat for Clarity and keeps the composer out of it entirely (D-USAGE-5)', () => {
    // render as the file's other cases do
    expect(screen.getByTestId(TID.chat)).toHaveAttribute('data-clarity-mask', 'true');
    expect(screen.getByTestId(TID.composerInput)).toHaveAttribute('data-private', 'secret');
  });
  ```
- `src/ui/settings/SettingsScreen.test.tsx`: the API key field
  (`TID.apiKeyInput`, the input itself) has `data-private="secret"` both
  hidden and after Show. Saving a key calls `usage.track('coach_setup')` once
  when the services carry a fake `usage`. Build the fake as in
  `UsageRow.test.tsx`, passed through the file's services helper.
- `src/ui/settings/CoachSourceSection.test.tsx`: the code field
  (`TID.computerCode`) has `data-private="secret"`, and saving the Bridge's
  address and code tracks `coach_setup` once.
- `src/ui/settings/LogView.test.tsx`: `TID.logView` has `data-clarity-mask="true"`.

Write each one in the style of its file's neighbours. These files' helpers
differ, so read the nearest test of the same element first.

- [ ] **Step 6: Run the UI tests, the typecheck and lint**

Run: `npx vitest run src/ui`
Expected: PASS.
Run: `npx tsc -p tsconfig.json --noEmit && npx eslint src`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/ui src/usage
git commit -m "feat: usage sharing on screen: the card in Europe and the notice elsewhere in the chat's prompt row, the switch in Settings > About, coach_setup on a saved key or Bridge, the chat and the log masked, and the key, the code and the composer kept out of Clarity entirely (D-USAGE-3, D-USAGE-5)"
```

### Task 9: The e2e

**Files:**
- Create: `e2e/usage.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/usage.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { openAppWithSwitches, recordRequests } from './helpers.ts';

/**
 * Usage sharing (D-USAGE-1 to D-USAGE-6) through mock mode's ?mockUsage=1:
 * Clarity's hosts answer with a stub that records every call, and nothing
 * real leaves the machine.
 */
const CLARITY = /^https:\/\/([a-z0-9-]+\.)*clarity\.ms\//;
const STUB = `
  window.__clarityCalls = Array.prototype.slice.call(window.clarity.q || []).map(function (a) { return Array.prototype.slice.call(a); });
  window.clarity = function () { window.__clarityCalls.push(Array.prototype.slice.call(arguments)); };
`;

async function stubClarity(page: Page): Promise<void> {
  await page.route(CLARITY, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
}

const clarityCalls = (page: Page) => page.evaluate(() => (window as unknown as { __clarityCalls?: unknown[][] }).__clarityCalls ?? []);
const toClarity = (seen: { url: string }[]) => seen.filter((request) => CLARITY.test(request.url));

test.describe('in Europe', () => {
  test.use({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });

  test('asks first, and loads nothing from Clarity before Yes, share', async ({ page }) => {
    await stubClarity(page);
    const seen = recordRequests(page);
    await openAppWithSwitches(page, { mockUsage: '1' });
    await expect(page.getByTestId(TID.usagePrompt)).toContainText('Help improve CafAI?');
    expect(toClarity(seen)).toEqual([]);

    await page.getByTestId(TID.usageYes).click();
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
    await expect.poll(() => toClarity(seen).length).toBeGreaterThan(0);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    await expect.poll(() => new URL(page.url()).searchParams.get('screen')).toBe('coach');
  });
});

test.describe('elsewhere', () => {
  test.use({ timezoneId: 'America/Chicago', locale: 'en-US' });

  test('shares with the notice, and Turn off stops it', async ({ page }) => {
    await stubClarity(page);
    const seen = recordRequests(page);
    await openAppWithSwitches(page, { mockUsage: '1' });
    await expect(page.getByTestId(TID.usagePrompt)).toContainText('Microsoft Clarity');
    await expect.poll(() => toClarity(seen).length).toBeGreaterThan(0);
    await expect.poll(() => clarityCalls(page)).toContainEqual(['consentv2', { ad_Storage: 'denied' }]);

    await page.getByTestId(TID.usageNo).click();
    await expect.poll(() => clarityCalls(page)).toContainEqual(['stop']);
    expect(new URL(page.url()).searchParams.get('screen')).toBeNull();
  });

  test('never in the demo, nor in mock mode without the switch', async ({ page }) => {
    await stubClarity(page);
    const seen = recordRequests(page);
    await openAppWithSwitches(page, {});
    await expect(page.getByTestId(TID.chat)).toBeVisible();
    await openAppWithSwitches(page, { mockUsage: '1', demo: '1' });
    await expect(page.getByTestId(TID.chat)).toBeVisible();
    expect(toClarity(seen)).toEqual([]);
    await expect(page.getByTestId(TID.usagePrompt)).toHaveCount(0);
  });
});
```

The prompt row draws only while x-chat has suggestions. CafAI always passes
Stats on the coach screen, so the card is there whenever the chat shows. If
the demo's `openAppWithSwitches` waits on something other than `appReady`,
follow `e2e/demo.spec.ts`.

The mock build runs MSW's service worker. `e2e/care.spec.ts` stubs Google's
hosts with `page.route` under it, so start there. If the stub never sees the
tag's request (the worker passed it through), route with
`page.context().route` instead, which also sees a service worker's requests.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/usage.spec.ts --project=tablet-962x602`
Expected: 3 passed. The first run builds the mock bundle, which takes a few minutes.

- [ ] **Step 3: Commit**

```bash
git add e2e/usage.spec.ts
git commit -m "test: usage sharing end to end: the card in Europe with nothing from Clarity before yes, the notice and Turn off elsewhere, and never in the demo or plain mock mode (D-USAGE-2, D-USAGE-3, D-USAGE-6)"
```

### Task 10: The docs

Write them in the project's voice. The decisions are the record.

- **DECISIONS.md:** a `### Usage analytics (2026-10-22)` section at the end,
  with D-USAGE-1 to D-USAGE-7 as the spec's sections 2 to 10 decide them. Say
  why for each, in the file's style.
- **README.md:**
  - Privacy: a bullet on usage sharing covering:
    - what goes to Microsoft Clarity: screens, taps, scrolls, the eleven
      steps and the five tags;
    - that all text is hidden, the key, the code and the composer entirely;
    - the region rule;
    - that Microsoft may use the data, including for advertising, with a
      link to <https://www.microsoft.com/privacy/privacystatement>;
    - how to turn it off;
    - that only release builds have it.
  - First run: one step for the card or the notice.
  - Screens and looks or Settings: the About switch.
  - The mock switches table: `?mockUsage=1`.
- **SECURITY.md:** a "Usage sharing" block covering:
  - what Clarity can and cannot see;
  - `data-private="secret"` on the key, the code and the composer, and
    `data-clarity-mask` on the chat and the log;
  - that the account token's meta is never recorded.
- **DESIGN.md:** the card and notice (prompt row, full width, Paper
  outlined, 48 px buttons) and the About row.
- **CHANGELOG.md:** one entry under `## Unreleased`.
- **QUESTIONS.md:** the test run (D-USAGE-7) as the next step for the owner,
  needing their Clarity project ID and a `CLARITY_PROJECT_ID` repository
  variable.

Commit: `docs: usage sharing in DECISIONS (D-USAGE-1 to D-USAGE-7), the README's privacy, first run and Settings, SECURITY, DESIGN, the changelog and QUESTIONS`

### Task 11: Verify, review and land

- [ ] Run `npm run verify > .verify/usage-verify.log 2>&1; echo exit=$?` in the worktree. It runs typecheck, lint, test, build, release:zip and e2e. Expected: `exit=0`. Use `E2E_PORT=4175` if another checkout's e2e holds 4174.
- [ ] One combined review of the branch (correctness, the spec, the docs).
  Fix what it finds, and run `npm run verify` again.
- [ ] Number the decisions:
  - Merge `main` into the branch.
  - In the main checkout, add `USAGE` to `.verify/renumber-decisions.mjs`
    `FAMILY` and its `git grep` pattern.
  - Run it with the next free number (the last D-number in DECISIONS.md
    plus one), first `--dry`, then for real.
  - Rewrap joined ranges.
- [ ] Land in local `main` with the guarded merge, without checking out
  main: `git commit-tree`, then `git update-ref refs/heads/main <new> <old>`.
  Never push unless asked.

### Task 12 (the owner): the test run (D-USAGE-7)

Needs a Clarity project (clarity.microsoft.com, Strict masking). With its ID:

1. `VITE_CLARITY_PROJECT_ID=<id> npm run release:zip`.
2. Run it in the Decaid simulator and in Chrome on localhost. Check the
   spec's section 10 items 1 to 6.
3. Install the zip on the tablet (Skins > + > ZIP file) for a day.
4. Then set the repository variable `CLARITY_PROJECT_ID`, so releases carry
   it.

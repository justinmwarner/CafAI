# Machine care: the cleaning guide, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings > Machine care opens a Care screen (`#/care`) with Decent's cleaning routine by how often, one routine at a time, each step with its moment in Decent's video, which plays in place where Decaid lets it and is a link to YouTube elsewhere.

**Architecture:** The guide is data (`src/ui/care/careGuide.ts`) with pure helpers for the video's addresses; a new route `{ name: 'care', routine }` lives under Settings (`placeOf` marks Settings current); the screen (`CareScreen.tsx`) lays itself out for its own box (`useOwnLayout`) and keeps one state, the moment playing. Whether the player may be framed comes from Decaid's own `__DECENT_HOST__.platform`, read into `HostEnvironment.platform`.

**Tech Stack:** React 19, MUI 9 (CafAI's theme: `variant="tonal"`, `label` typography, `cafai.raised` and `cafai.accentSoft`), Vitest + Testing Library (jsdom), Playwright against the mock build.

**Spec:** `docs/superpowers/specs/2026-10-15-machine-care-design.md` (section numbers below refer to it). Branch `feat/machine-care`.

**Rules the code keeps (CONTRIBUTING.md):** Chromium 91 (no newer browser APIs; `aspect-ratio` is fine from 88), test ids only from `src/ui/testIds.ts`, plain words on screen, no em dashes in copy, LF line endings (write files with the editor tools, never Python's `write_text`), capture exit codes (`cmd > log 2>&1; echo exit=$?`).

---

## File structure

| File | Responsibility |
|---|---|
| `src/ui/care/routines.ts` (new) | `RoutineId`, `ROUTINE_IDS`: the routines' ids and order, shared by the router and the guide |
| `src/ui/care/careGuide.ts` (new) | The guide as data (video, routines, steps with sources), `routineOf`, `formatMoment`, `embedUrl`, `watchUrl`, `CARE_VIDEO_MINUTES`, `CARE_SOURCES` |
| `src/ui/care/videoPlace.ts` (new) | `videoPlaysInPlace(host)`, `outsideLinkProps(host)` |
| `src/ui/care/MomentButton.tsx` (new) | A moment: a button that plays in place, or a link to YouTube at that time |
| `src/ui/care/CareVideo.tsx` (new) | The video card: poster, compact row, player, links |
| `src/ui/care/CareSegments.tsx` (new) | The routines' tab list |
| `src/ui/care/RoutineCard.tsx` (new) | A routine's card: header, numbered steps, sources line |
| `src/ui/care/CareScreen.tsx` (new) | The screen: header, layout, the moment playing |
| `src/ui/settings/CareSection.tsx` (new) | Settings > Machine care |
| `src/ui/router.ts` | The care route, its paths, `placeOf` |
| `src/ui/drinks/drinkFocus.ts` | Go back's name for Care |
| `src/api/types.ts`, `src/api/host.ts` | `HostEnvironment.platform` |
| `src/ui/testing/fakeServices.ts` | The fake host's `platform` |
| `src/ui/testIds.ts` | The care ids |
| `src/app/App.tsx` | The care route's screen |
| `src/ui/shell/AppShell.tsx` | `aria-current` by `placeOf` |
| `src/ui/settings/SettingsScreen.tsx` | The new section after Steam, hot water and flush |
| `e2e/care.spec.ts` (new), `playwright.config.ts` | End to end, tablets and phones |
| `e2e/screenshots/readme.shots.ts` | A README picture of Care |
| Docs | DECISIONS (D152-D155), DESIGN, README, CHANGELOG, HARDWARE_TEST_PLAN (14), ROADMAP, MORNING |

---

### Task 1: The care route

**Files:**
- Create: `src/ui/care/routines.ts`
- Modify: `src/ui/router.ts`, `src/ui/drinks/drinkFocus.ts`
- Test: `src/ui/router.test.ts`, `src/ui/drinks/drinkFocus.test.ts`

- [ ] **Step 1: Create the routines' ids**

`src/ui/care/routines.ts`:

```ts
/**
 * The cleaning guide's routines, by how often (D153): one at a time on the
 * Care screen, and part of its address (`#/care/weekly`).
 */
export type RoutineId = 'daily' | 'weekly' | 'monthly' | 'asNeeded';

/** In the order the segments show them. */
export const ROUTINE_IDS: readonly RoutineId[] = ['daily', 'weekly', 'monthly', 'asNeeded'];
```

- [ ] **Step 2: Write the failing router tests**

In `src/ui/router.test.ts`, change the import to
`import { isRemembered, parseRoute, placeOf, routeHref, sameRoute, type Route } from './router.ts';`
and add, inside `describe('parseRoute', ...)`:

```ts
  it('reads the cleaning guide and its routine', () => {
    expect(parseRoute('#/care')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/weekly')).toEqual({ name: 'care', routine: 'weekly' });
    expect(parseRoute('#/Care/Monthly')).toEqual({ name: 'care', routine: 'monthly' });
    expect(parseRoute('#/care/as-needed')).toEqual({ name: 'care', routine: 'asNeeded' });
    expect(parseRoute('#/care/weekly?_=1')).toEqual({ name: 'care', routine: 'weekly' });
    // An unknown routine is Daily; anything deeper is not the guide.
    expect(parseRoute('#/care/asNeeded')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/yearly')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/weekly/extra')).toEqual({ name: 'coach' });
  });
```

inside `describe('routeHref', ...)`:

```ts
  it("builds the cleaning guide's links", () => {
    expect(routeHref({ name: 'care', routine: 'daily' })).toBe('#/care');
    expect(routeHref({ name: 'care', routine: 'weekly' })).toBe('#/care/weekly');
    expect(routeHref({ name: 'care', routine: 'monthly' })).toBe('#/care/monthly');
    expect(routeHref({ name: 'care', routine: 'asNeeded' })).toBe('#/care/as-needed');
  });
```

and add these to the `routes` array of `'round-trips through parseRoute'`:

```ts
      { name: 'care', routine: 'daily' },
      { name: 'care', routine: 'weekly' },
      { name: 'care', routine: 'monthly' },
      { name: 'care', routine: 'asNeeded' },
```

inside `describe('sameRoute', ...)`:

```ts
  it('compares the guide by routine', () => {
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'care', routine: 'daily' })).toBe(true);
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'care', routine: 'weekly' })).toBe(false);
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'settings' })).toBe(false);
  });
```

in `describe('isRemembered', ...)`'s test add
`expect(isRemembered({ name: 'care', routine: 'monthly' })).toBe(true);`, and at the end of the file:

```ts
describe('placeOf', () => {
  it("puts the guide under Settings, and a drink's view nowhere", () => {
    expect(placeOf({ name: 'care', routine: 'weekly' })).toBe('settings');
    expect(placeOf({ name: 'drink', drink: 'steam' })).toBeNull();
    expect(placeOf({ name: 'history', bagId: 'b' })).toBe('history');
    expect(placeOf({ name: 'settings' })).toBe('settings');
    expect(placeOf({ name: 'shot' })).toBe('shot');
    expect(placeOf({ name: 'coach' })).toBe('coach');
  });
});
```

In `src/ui/drinks/drinkFocus.test.ts`, in `'says where to a screen reader'` add
`expect(goBackLabel({ name: 'care', routine: 'daily' })).toBe('Go back to Machine care');`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/ui/router.test.ts src/ui/drinks/drinkFocus.test.ts`
Expected: FAIL (`placeOf` is not exported; the care routes parse as the coach).

- [ ] **Step 4: Implement the route**

In `src/ui/router.ts`:

```ts
import type { RoutineId } from './care/routines.ts';
import { ROUTINE_IDS } from './care/routines.ts';
```

(after the existing `DrinkKind` import; one `import { ROUTINE_IDS, type RoutineId } from './care/routines.ts';` is the same). The `Route` union gains, after `settings`:

```ts
  /** Settings > Machine care's guide (D152), on one of its routines (D153). */
  | { name: 'care'; routine: RoutineId }
```

Under `DRINK_OF_PATH` add:

```ts
/** Each routine by its path: Daily is the guide's own `#/care`, the others `#/care/weekly` and so on. */
const ROUTINE_PATHS: Readonly<Record<RoutineId, string>> = { daily: '', weekly: 'weekly', monthly: 'monthly', asNeeded: 'as-needed' };
const ROUTINE_OF_PATH: ReadonlyMap<string, RoutineId> = new Map(ROUTINE_IDS.map((routine) => [ROUTINE_PATHS[routine], routine]));
```

In `parseRoute`, inside `if (segments.length === 1) {`, after the `shot` line:

```ts
    if (screen === 'care') return { name: 'care', routine: 'daily' };
```

and after the history two-segment block:

```ts
  if (screen === 'care' && segments.length === 2) {
    return { name: 'care', routine: ROUTINE_OF_PATH.get(segments[1]!.toLowerCase()) ?? 'daily' };
  }
```

In `routeHref`'s switch, after `case 'settings':`:

```ts
    case 'care': {
      const path = ROUTINE_PATHS[route.routine];
      return path ? `#/care/${path}` : '#/care';
    }
```

In `sameRoute`, before the last line:

```ts
  if (a.name === 'care' && b.name === 'care') return a.routine === b.routine;
```

After `isRemembered`:

```ts
/**
 * The place in the navigation a route belongs to, which the top bar and the
 * tabs mark current: the cleaning guide is Settings' (D152), a drink's view
 * no place's (D146).
 */
export function placeOf(route: Route): RouteName | null {
  if (route.name === 'drink') return null;
  if (route.name === 'care') return 'settings';
  return route.name;
}
```

In `src/ui/drinks/drinkFocus.ts`, `goBackLabel`'s switch, after `case 'settings':`:

```ts
    case 'care':
      return 'Go back to Machine care';
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/ui/router.test.ts src/ui/drinks/drinkFocus.test.ts > .verify/t1.log 2>&1; echo exit=$?` then `npm run typecheck > .verify/t1-tc.log 2>&1; echo exit=$?`
Expected: exit=0 both. If the typecheck names another exhaustive switch on `route.name`, give it a `care` case that treats Care as Settings.

- [ ] **Step 6: Commit**

```bash
git add src/ui/care/routines.ts src/ui/router.ts src/ui/router.test.ts src/ui/drinks/drinkFocus.ts src/ui/drinks/drinkFocus.test.ts
git commit -m "feat: the cleaning guide's route, #/care and its routines, under Settings (D152, D153)"
```

---

### Task 2: Where the video may play

**Files:**
- Create: `src/ui/care/videoPlace.ts`, `src/ui/care/videoPlace.test.ts`
- Modify: `src/api/types.ts` (HostEnvironment), `src/api/host.ts`, `src/ui/testing/fakeServices.ts`
- Test: `src/api/host.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/api/host.test.ts`, inside the host detection `describe`, add:

```ts
  it("reads Decaid's platform, lowercased, only inside Decaid", () => {
    expect(detectHost(fakeWindow({ decentHost: { platform: 'android', version: '0.9.0' } }).win).platform).toBe('android');
    expect(detectHost(fakeWindow({ decentHost: { platform: ' Windows ' } }).win).platform).toBe('windows');
    expect(detectHost(fakeWindow({ decentHost: { version: '0.9.0' } }).win).platform).toBeNull();
    expect(detectHost(fakeWindow({ decentHost: { platform: 7 } }).win).platform).toBeNull();
    expect(detectHost(fakeWindow({ decentHost: true }).win).platform).toBeNull();
    expect(detectHost(fakeWindow().win).platform).toBeNull();
  });
```

`src/ui/care/videoPlace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { outsideLinkProps, videoPlaysInPlace } from './videoPlace.ts';

describe('videoPlaysInPlace', () => {
  it('in a browser, and inside Decaid on Android', () => {
    expect(videoPlaysInPlace({ insideDecaid: false, platform: null })).toBe(true);
    expect(videoPlaysInPlace({ insideDecaid: true, platform: 'android' })).toBe(true);
  });

  it('nowhere else inside Decaid, nor where Decaid does not say', () => {
    for (const platform of ['windows', 'macos', 'ios', 'linux', 'fuchsia', null]) {
      expect(videoPlaysInPlace({ insideDecaid: true, platform })).toBe(false);
    }
  });
});

describe('outsideLinkProps', () => {
  it('a plain link inside Decaid, which opens it in the system browser', () => {
    expect(outsideLinkProps({ insideDecaid: true })).toEqual({});
  });

  it('a new tab in a browser, so CafAI stays open', () => {
    expect(outsideLinkProps({ insideDecaid: false })).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/api/host.test.ts src/ui/care/videoPlace.test.ts`
Expected: FAIL (`platform` undefined; the module does not exist).

- [ ] **Step 3: Implement**

`src/api/types.ts`, in `HostEnvironment` after `hostVersion`:

```ts
  /**
   * Decaid's platform from __DECENT_HOST__ ('android', 'ios', 'macos',
   * 'windows', 'linux'), lowercased; null outside Decaid or when it does not
   * say. The cleaning guide's video plays in place only on Android (D154).
   */
  platform: string | null;
```

`src/api/host.ts`, after `hostVersionOf`:

```ts
function platformOf(decentHost: unknown): string | null {
  if (typeof decentHost !== 'object' || decentHost === null) return null;
  const platform = (decentHost as { platform?: unknown }).platform;
  return typeof platform === 'string' && platform.trim() ? platform.trim().toLowerCase() : null;
}
```

and in `detectHost`'s returned object, after `hostVersion`:

```ts
    platform: insideDecaid ? platformOf(decentHost) : null,
```

`src/ui/testing/fakeServices.ts`: add `platform?: string | null;` to `createFakeServices`'s options (after `insideDecaid?: boolean;`), and in the fake host after `hostVersion`:

```ts
    // Inside Decaid a Decent tablet unless a test says otherwise.
    platform: options.platform !== undefined ? options.platform : options.insideDecaid ? 'android' : null,
```

`src/ui/care/videoPlace.ts`:

```ts
/**
 * Whether YouTube's player may be put on CafAI's page, and how links to
 * outside pages open (D154).
 *
 * Decaid's navigation guard (`classifySkinNavigation`, Decaid's
 * lib/src/skin_feature/skin_view.dart) sends every http(s) page outside the
 * skin's own to the system browser, a frame's included, wherever the WebView
 * asks it about frames: on Windows (tried with Decaid 0.8.8: the frame stayed
 * empty and YouTube opened in the browser), and on iOS and macOS, whose
 * WKWebView asks too. Android's WebView never asks about a frame's http(s)
 * loads, so there, as in any browser, the player plays in place.
 */
import type { HostEnvironment } from '../../api/types.ts';

export function videoPlaysInPlace(host: Pick<HostEnvironment, 'insideDecaid' | 'platform'>): boolean {
  return !host.insideDecaid || host.platform === 'android';
}

/**
 * Inside Decaid a plain link, which Decaid opens in the system browser (as
 * On Visualizer, D121); in a browser a new tab, so CafAI stays open.
 */
export function outsideLinkProps(host: Pick<HostEnvironment, 'insideDecaid'>): { target?: '_blank'; rel?: string } {
  return host.insideDecaid ? {} : { target: '_blank', rel: 'noopener noreferrer' };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/api/host.test.ts src/ui/care/videoPlace.test.ts > .verify/t2.log 2>&1; echo exit=$?` then `npm run typecheck > .verify/t2-tc.log 2>&1; echo exit=$?`
Expected: exit=0 both.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/host.ts src/api/host.test.ts src/ui/testing/fakeServices.ts src/ui/care/videoPlace.ts src/ui/care/videoPlace.test.ts
git commit -m "feat: CafAI reads Decaid's platform, and the guide's video plays in place only in a browser or on Android (D154)"
```

---

### Task 3: The guide as data

**Files:**
- Create: `src/ui/care/careGuide.ts`, `src/ui/care/careGuide.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/ui/care/careGuide.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CARE_VIDEO, CARE_VIDEO_MINUTES, embedUrl, formatMoment, routineOf, ROUTINES, watchUrl } from './careGuide.ts';
import { ROUTINE_IDS } from './routines.ts';

const STEPS = ROUTINES.flatMap((routine) => routine.steps);

describe('the guide', () => {
  it("has the four routines, in the segments' order, each with steps", () => {
    expect(ROUTINES.map((routine) => routine.id)).toEqual(ROUTINE_IDS);
    for (const routine of ROUTINES) expect(routine.steps.length).toBeGreaterThan(0);
  });

  it('gives every step a unique id, apart from the routines, a title and a how', () => {
    const ids = STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ROUTINE_IDS) expect(ids).not.toContain(id);
    for (const step of STEPS) {
      expect(step.title.trim()).not.toBe('');
      expect(step.how.trim()).not.toBe('');
    }
  });

  it('keeps every moment inside the video, in whole seconds', () => {
    const moments = ROUTINES.flatMap((routine) => [routine.moment, ...routine.steps.map((step) => step.moment)]).filter(
      (moment): moment is number => moment !== undefined,
    );
    // The description's key moments, and 6:52, 15:04 and 21:36 from the captions (D155).
    expect([...moments].sort((a, b) => a - b)).toEqual([20, 108, 310, 412, 460, 473, 671, 904, 996, 1016, 1296]);
    for (const moment of moments) {
      expect(Number.isInteger(moment)).toBe(true);
      expect(moment).toBeGreaterThanOrEqual(0);
      expect(moment).toBeLessThan(CARE_VIDEO.seconds);
    }
  });

  it("links only to Decent's own pages, over https", () => {
    const links = STEPS.flatMap((step) => (step.link ? [step.link] : []));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.url).toMatch(/^https:\/\/decentespresso\.com\//);
  });

  it('writes plain words: no em dashes, and every how ends a sentence', () => {
    for (const step of STEPS) {
      for (const text of [step.title, step.when, step.how, step.where, step.note]) {
        if (text !== undefined) expect(text).not.toMatch(/—/);
      }
      expect(step.how).toMatch(/\.$/);
    }
  });

  it('finds a routine by id', () => {
    expect(routineOf('weekly').label).toBe('Weekly');
    expect(routineOf('asNeeded').label).toBe('As needed');
  });
});

describe('formatMoment', () => {
  it('is minutes and two-digit seconds', () => {
    expect(formatMoment(0)).toBe('0:00');
    expect(formatMoment(20)).toBe('0:20');
    expect(formatMoment(108)).toBe('1:48');
    expect(formatMoment(1016)).toBe('16:56');
    expect(formatMoment(1296.9)).toBe('21:36');
  });
});

describe("the video's addresses", () => {
  it('embeds from youtube-nocookie at the moment, playing', () => {
    expect(embedUrl(108)).toBe('https://www.youtube-nocookie.com/embed/0cm1JxB_6bI?start=108&autoplay=1&rel=0&playsinline=1');
    expect(embedUrl(0)).toBe('https://www.youtube-nocookie.com/embed/0cm1JxB_6bI?start=0&autoplay=1&rel=0&playsinline=1');
  });

  it('links to YouTube at the moment, or at the start', () => {
    expect(watchUrl(1016)).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI&t=1016s');
    expect(watchUrl()).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI');
    expect(watchUrl(0)).toBe('https://www.youtube.com/watch?v=0cm1JxB_6bI');
  });

  it("says the video's length in whole minutes", () => {
    expect(CARE_VIDEO_MINUTES).toBe('22 min');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/care/careGuide.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the guide**

`src/ui/care/careGuide.ts`:

```ts
/**
 * The cleaning guide (D151, D155): Decent's routine for the DE1 by how often,
 * each step with a line on how and, where Decent's video shows it, its moment
 * there. The words are CafAI's own, from the video ("How often/to clean DE1",
 * Decent Espresso Tech, 2022) and Decent's current pages, read on 2026-10-15;
 * each step's sources are in the comment above it. Where the video and the
 * pages differ, the step follows the pages and its note says so. Nothing here
 * reaches the network: the screen builds the video's addresses on a tap.
 */
import type { RoutineId } from './routines.ts';

export interface CareLink {
  /** What the link says: "Decent's descaling steps". */
  label: string;
  /** Always one of Decent's pages (careGuide.test.ts checks). */
  url: string;
}

export interface CareStep {
  /** Unique in the guide, and never a routine's id: the step's test ids use it. */
  id: string;
  title: string;
  /** When, where the routine alone does not say: "After the day's last shot". */
  when?: string;
  how: string;
  /** Where to run what CafAI cannot run yet: "From streamline for now: …". */
  where?: string;
  /** Where the video and Decent's pages differ, or a thing worth knowing. */
  note?: string;
  link?: CareLink;
  /** Where the video shows it, in seconds. */
  moment?: number;
}

export interface CareRoutine {
  id: RoutineId;
  /** The segment's word, and the routine's heading. */
  label: string;
  /** How often, as a sentence: "Once a week." */
  cadence: string;
  /** The routine's own part of the video, in seconds. */
  moment?: number;
  steps: readonly CareStep[];
}

/** Decent's video, as YouTube lists it. */
export const CARE_VIDEO = {
  id: '0cm1JxB_6bI',
  title: 'How often/to clean DE1',
  channel: 'Decent Espresso Tech',
  year: 2022,
  /** Its length: 22:33. */
  seconds: 1353,
} as const;

/** "22 min". */
export const CARE_VIDEO_MINUTES = `${Math.floor(CARE_VIDEO.seconds / 60)} min`;

/** The line at the end of every routine. */
export const CARE_SOURCES =
  "From Decent's video (March 2022) and Decent's own pages. Where they differ, the steps follow the pages and say so.";

const DESCALING_PAGE = 'https://decentespresso.com/docs/de1_descaling_instructions';
const STEAM_TIP_PAGE = 'https://decentespresso.com/docs/how_to_replace_your_steam_tip';

export const ROUTINES: readonly CareRoutine[] = [
  {
    id: 'daily',
    label: 'Daily',
    cadence: 'On days you pull shots.',
    moment: 20,
    steps: [
      // Quick start p.25 (take the jug away; a burst clears the wand; point it at the drip tray) and the group head
      // controller page ("Remove the milk jug before it does!").
      {
        id: 'purge-wand',
        title: 'Purge and wipe the steam wand',
        when: 'Each time you steam',
        how: 'Take the jug away as steam stops: the DE1 clears the wand a moment later. Point it at the drip tray, then wipe it with a damp cloth.',
      },
      // Quick start p.34 (daily with clean water, no detergent; "Use the Forward Flush x5 preset or the Flush button", at least
      // twice) and the video at 1:48 (a blind basket, Forward Flush x5 twice).
      {
        id: 'flush-group',
        title: 'Flush the group head',
        when: "After the day's last shot",
        how: 'Blind basket in, then Flush at least twice. Water only.',
        note: "Decent's Forward Flush x5 profile does the same in pulses, as in the video; streamline can run it.",
        moment: 108,
      },
      // Quick start pp.35-36 (wipe the shower screen; flush again with a coffee basket; rinse the portafilter).
      {
        id: 'wipe-screen',
        title: 'Wipe the shower screen',
        when: 'After the flush',
        how: 'Wipe the screen under the group head with a damp cloth. Then a coffee basket in, one more Flush, and rinse the portafilter.',
      },
      // Quick start p.37 (wipe the wand and steam clean water at the day's end; after a lot of milk, Rinza soaked about
      // 10 minutes, "Do not steam!").
      {
        id: 'rinse-wand',
        title: 'Rinse the steam wand',
        when: "When you're done for the day",
        how: "Wipe it, and steam a jug of clean water through. After a lot of milk, first soak the tip in Rinza solution for about 10 minutes: soak it, don't steam it.",
      },
    ],
  },
  {
    id: 'weekly',
    label: 'Weekly',
    cadence: 'Once a week.',
    moment: 460,
    steps: [
      // The Forward Flush x5 profile's own notes (Decaid's assets/defaultProfiles/Cleaning__Forward_Flush_x5_2.json: 3 g, half a
      // teaspoon) and the video at 7:53 (3 g); quick start pp.40-41 (a tablespoon of Cafiza, until no suds, then a coffee basket
      // and Flush; never detergent in the tank). Clean: Decent's app tour at 26:23 (a blind basket, a spoonful, Clean).
      {
        id: 'detergent-clean',
        title: 'Clean the group head with detergent',
        how: '3 g (half a teaspoon) of espresso machine detergent in the blind basket, then the Forward Flush x5 profile until no suds show. Coffee basket in, then Flush. Never put detergent in the tank.',
        where: 'From streamline for now: the profile, or its Clean (Settings > Maintenance).',
        note: "Decent's quick start says a tablespoon; the profile's notes and the video, half a teaspoon.",
        moment: 473,
      },
      // Quick start p.39 (about 30 ml in 500 ml, or one tablet, steamed; then clean water twice) and the video at 11:11.
      {
        id: 'rinza',
        title: 'Steam Rinza through the wand',
        how: '30 ml of Rinza in 500 ml of water (or one tablet), steamed until it boils; then clean water, twice.',
        moment: 671,
      },
      // Quick start p.38 (weekly, soap and water) and the video at 6:52 (daily for hygiene; the tank, tray and cover in a
      // dishwasher).
      {
        id: 'tank-tray',
        title: 'Wash the water tank and drip tray',
        how: 'The tank, the drip tray and its cover, with soap and water.',
        note: "The video washes them every day, in a dishwasher; Decent's pages say weekly, with soap and water.",
        moment: 412,
      },
      // Decent's "The actual flow rate has become lower than the machine's reading" (V1: citric acid, weekly or fortnightly;
      // V2: baking soda, at least monthly, a pipe cleaner if clogged), the video's description (V2: baking soda, 30 minutes to
      // an hour) and 15:04, the time that page links in the video.
      {
        id: 'intake-filter',
        title: 'Clean the intake filter',
        how: "The filter at the tank's intake (the thimble). V1: soak it in citric acid for 30 minutes, every week or two. V2: in baking soda, at least monthly, with a pipe cleaner if it's clogged.",
        moment: 904,
      },
    ],
  },
  {
    id: 'monthly',
    label: 'Monthly',
    cadence: 'Every two to four weeks.',
    moment: 996,
    steps: [
      // Quick start pp.42-45 (machine off; the centre screw, then three; mind the temperature probe; 15 g of detergent in
      // about 500 g of hot water, overnight; the inner diffuser back first); the video at 16:56 (every two weeks, switched off
      // at the back); the v1.44 blog and Decent's group head upgrade video (Torx: T20 in the centre, T10 for the three).
      {
        id: 'group-parts',
        title: "Soak the group head's parts",
        how: 'Machine off. The centre screw frees the shower screen and a diffuser, three more the inner one (mind the temperature probe). Soak them overnight in 15 g of detergent in 500 ml of hot water; refit the inner diffuser first.',
        note: 'The video does this every two weeks. Since v1.44 (2023) the screws are Torx: T20 in the centre, T10 for the three.',
        moment: 1016,
      },
      // Decent's gasket page ("A dirty gasket is just as bad as a tired one") and its gasket video (water beading round the
      // portafilter; don't leave the portafilter locked in).
      {
        id: 'gasket',
        title: 'Look at the group gasket',
        how: 'While the parts are off, wipe the gasket. Hard, cracked, or water beading round the portafilter in a shot: time for a new one. Between sessions, leave the portafilter out.',
      },
    ],
  },
  {
    id: 'asNeeded',
    label: 'As needed',
    cadence: 'When your water, the steam or a move calls for it.',
    steps: [
      // The water page (under 30 ppm never; 30 to 120 ppm yearly; over 120 ppm at least twice a year); the descaling page (under
      // 120 ppm every year or two; citric acid only; the steam heater off and down to 60 °C, up to an hour; 80 g in 1,540 ml;
      // the steam tip off; 7 to 8 litres to rinse); the app tour (steam starting to oscillate); the video at 21:36 (hardly
      // needed with 60 to 120 ppm water).
      {
        id: 'descale',
        title: 'Descale',
        when: 'Water under 30 ppm: never. 30 to 120 ppm: every year or two. Over 120 ppm: twice a year or more. Sooner if the steam starts to pulse.',
        how: "Citric acid only. Steam heater off until it's down to 60 °C (up to an hour), steam tip off, then the DE1's Descale with 80 g of citric acid in 1.5 litres of water. Rinse well: plan on 7 to 8 litres.",
        where: 'From streamline for now: Settings > Maintenance > Machine Descaling.',
        note: "The video says water of 60 to 120 ppm hardly needs it; Decent's pages say every year or two.",
        link: { label: "Decent's descaling steps", url: DESCALING_PAGE },
        moment: 1296,
      },
      // Quick start p.37 ("For stubborn clogs, unscrew the wand tip, soak it, and run a needle through the hole") and the steam
      // tip page (off and cool; a spoon on the inner tube so it is not pulled out; both O-rings); the video at 5:10 (every
      // night).
      {
        id: 'steam-tip',
        title: 'Unclog the steam tip',
        when: 'When it clogs',
        how: 'Machine off and cool. Unscrew the tip, pressing a spoon on the tube inside so it stays put; soak the tip in hot water, push a needle through, check both O-rings, refit.',
        note: "The video takes the tip off every night; Decent's pages, only for a stubborn clog.",
        link: { label: "Decent's steam tip page", url: STEAM_TIP_PAGE },
        moment: 310,
      },
      // Decent's app tour at 36:41 (the tank forward; a minute or two; the water into the tank) and de1app ("You can turn your
      // machine off once it is out of water").
      {
        id: 'transport',
        title: 'Empty the machine to move it',
        when: 'Before a move, or a long time unused',
        how: "The DE1's Transport: with the water tank pulled forward, it empties its water into the tank in a minute or two. Then turn it off.",
        where: 'From streamline for now: Settings > Maintenance > Transport Mode.',
      },
    ],
  },
];

export function routineOf(id: RoutineId): CareRoutine {
  return ROUTINES.find((routine) => routine.id === id) ?? ROUTINES[0]!;
}

/** A moment as the video's own clock shows it: "1:48", "16:56". */
export function formatMoment(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** YouTube's player from its privacy-enhanced domain, at the moment, playing (D154). */
export function embedUrl(seconds: number): string {
  const start = Math.max(0, Math.floor(seconds));
  return `https://www.youtube-nocookie.com/embed/${CARE_VIDEO.id}?start=${start}&autoplay=1&rel=0&playsinline=1`;
}

/** The video on YouTube, at the moment (none for the start). */
export function watchUrl(seconds = 0): string {
  const start = Math.max(0, Math.floor(seconds));
  const page = `https://www.youtube.com/watch?v=${CARE_VIDEO.id}`;
  return start > 0 ? `${page}&t=${start}s` : page;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/care/careGuide.test.ts > .verify/t3.log 2>&1; echo exit=$?`
Expected: exit=0.

- [ ] **Step 5: Commit**

```bash
git add src/ui/care/careGuide.ts src/ui/care/careGuide.test.ts
git commit -m "feat: the cleaning guide's words, from Decent's video and pages, with the video's moments (D155)"
```

---

### Task 4: Test ids

**Files:** Modify `src/ui/testIds.ts`

- [ ] **Step 1: Add the ids**, after the drink view's ids (`drinkSettingsCard`):

```ts

  // Settings > Machine care and its cleaning guide (D152-D155)
  careSection: 'care-section',
  careOpen: 'care-open',
  careScreen: 'care-screen',
  careBack: 'care-back',
  careSegment: (routine: string) => `care-segment-${slug(routine)}`,
  careRoutine: 'care-routine',
  careStep: (id: string) => `care-step-${slug(id)}`,
  /** A step's moment by the step's id, a routine's by the routine's id. */
  careMoment: (id: string) => `care-moment-${slug(id)}`,
  careLink: (id: string) => `care-link-${slug(id)}`,
  careVideo: 'care-video',
  carePoster: 'care-poster',
  carePlayer: 'care-player',
  careWatch: 'care-watch',
```

- [ ] **Step 2: Typecheck and commit**

Run: `npm run typecheck > .verify/t4.log 2>&1; echo exit=$?` (exit=0), then

```bash
git add src/ui/testIds.ts
git commit -m "test: the cleaning guide's test ids (D152-D155)"
```

---

### Task 5: The moment button and the video card

**Files:**
- Create: `src/ui/care/MomentButton.tsx`, `src/ui/care/CareVideo.tsx`
- Test: `src/ui/care/CareVideo.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/ui/care/CareVideo.test.tsx`:

```tsx
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { embedUrl, watchUrl } from './careGuide.ts';
import { CareVideo, LOADS_FROM_YOUTUBE, OPENS_IN_BROWSER, type Playing } from './CareVideo.tsx';
import { MomentButton } from './MomentButton.tsx';

afterEach(() => cleanup());

const NEW_TAB = { target: '_blank' as const, rel: 'noopener noreferrer' };

function video(props: Partial<Parameters<typeof CareVideo>[0]> = {}) {
  const onPlayFromStart = vi.fn();
  renderWithServices(
    <CareVideo inPlace compact={false} playing={null} onPlayFromStart={onPlayFromStart} linkProps={NEW_TAB} {...props} />,
  );
  return { onPlayFromStart };
}

describe('CareVideo', () => {
  it("before a tap: CafAI's own poster, nothing framed, and Watch on YouTube", async () => {
    const { onPlayFromStart } = video();
    expect(screen.queryByTestId(TID.carePlayer)).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText(LOADS_FROM_YOUTUBE)).toBeInTheDocument();
    const watch = screen.getByTestId(TID.careWatch);
    expect(watch).toHaveAttribute('href', watchUrl());
    expect(watch).toHaveAttribute('target', '_blank');
    await userEvent.click(screen.getByRole('button', { name: "Play Decent's video: How often/to clean DE1" }));
    expect(onPlayFromStart).toHaveBeenCalledTimes(1);
  });

  it('on a narrow screen, one short row until a tap', async () => {
    const { onPlayFromStart } = video({ compact: true });
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Decent's video · 22 min");
    expect(screen.queryByTestId(TID.careWatch)).toBeNull();
    await userEvent.click(screen.getByTestId(TID.carePoster));
    expect(onPlayFromStart).toHaveBeenCalledTimes(1);
  });

  it('playing: the player at the moment, and what plays', () => {
    const playing: Playing = { start: 108, key: 'flush-group', label: 'Flush the group head', take: 1 };
    video({ playing });
    const player = screen.getByTestId(TID.carePlayer);
    expect(player.tagName).toBe('IFRAME');
    expect(player).toHaveAttribute('src', embedUrl(108));
    expect(player).toHaveAttribute('title', "Decent's video: How often/to clean DE1");
    expect(player).toHaveAttribute('allow', expect.stringContaining('autoplay'));
    expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(screen.getByText(/Playing from/)).toHaveTextContent('Playing from 1:48: Flush the group head');
  });

  it('from the poster: playing from the start', () => {
    video({ playing: { start: 0, key: 'poster', label: null, take: 1 } });
    expect(screen.getByText('Playing from the start')).toBeInTheDocument();
  });

  it('where it cannot play in place: no poster, no player, and the card says Decaid opens it', () => {
    video({ inPlace: false, linkProps: {} });
    expect(screen.queryByTestId(TID.carePoster)).toBeNull();
    expect(screen.queryByTestId(TID.carePlayer)).toBeNull();
    expect(screen.getByText(OPENS_IN_BROWSER)).toBeInTheDocument();
    expect(screen.getByTestId(TID.careWatch)).not.toHaveAttribute('target');
  });
});

describe('MomentButton', () => {
  it('in place: a button named for its time and what it shows, pressed while it plays', async () => {
    const onPlay = vi.fn();
    renderWithServices(<MomentButton seconds={108} what="Flush the group head" link={false} playing onPlay={onPlay} testId="m" />);
    const button = screen.getByRole('button', { name: 'Play from 1:48: Flush the group head' });
    expect(button).toHaveTextContent('1:48');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('as a link: YouTube at that time', () => {
    renderWithServices(<MomentButton seconds={1016} what="Soak the group head's parts" link linkProps={{}} testId="m" />);
    const link = screen.getByRole('link', { name: "Watch from 16:56 on YouTube: Soak the group head's parts" });
    expect(link).toHaveAttribute('href', watchUrl(1016));
    expect(link).not.toHaveAttribute('target');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/care/CareVideo.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write MomentButton**

`src/ui/care/MomentButton.tsx`:

```tsx
/**
 * A moment in Decent's video (D154): a play icon and the time, "1:48", in
 * tabular figures. Where the player plays in place, a button that starts it
 * there and stays marked (the accent wash, aria-pressed) while that moment
 * plays; elsewhere a link to YouTube at that time, which Decaid opens in the
 * system browser.
 */
import Button from '@mui/material/Button';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import { formatMoment, watchUrl } from './careGuide.ts';

export interface MomentButtonProps {
  seconds: number;
  /** What the moment shows, for its name: "Flush the group head", "Daily". */
  what: string;
  /** A link to YouTube instead of a button (videoPlace.ts). */
  link: boolean;
  /** How a link opens (outsideLinkProps). */
  linkProps?: { target?: '_blank'; rel?: string };
  /** A button's: whether this moment is the one playing. */
  playing?: boolean;
  onPlay?: () => void;
  testId: string;
  /** In a step's row: up 10 px, so the time sits on the title's line. */
  nudge?: boolean;
}

export function MomentButton({ seconds, what, link, linkProps, playing = false, onPlay, testId, nudge = false }: MomentButtonProps) {
  const time = formatMoment(seconds);
  const sx = {
    flex: 'none',
    alignSelf: 'start',
    minHeight: 48,
    pl: 1,
    pr: 1.5,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    '& .MuiButton-startIcon': { mr: 0.75 },
    // The "opens elsewhere" icon after a link's time, smaller than the play icon.
    '& .MuiButton-endIcon > *:nth-of-type(1)': { fontSize: 16 },
    ...(nudge ? { mt: '-10px' } : null),
    ...(playing ? { bgcolor: 'cafai.accentSoft', '&:hover': { bgcolor: 'cafai.accentSoft' } } : null),
  } as const;
  if (link) {
    return (
      <Button
        component="a"
        href={watchUrl(seconds)}
        {...linkProps}
        variant="text"
        startIcon={<PlayCircleRoundedIcon />}
        endIcon={<OpenInNewRoundedIcon />}
        aria-label={`Watch from ${time} on YouTube: ${what}`}
        data-testid={testId}
        sx={sx}
      >
        {time}
      </Button>
    );
  }
  return (
    <Button
      variant="text"
      startIcon={<PlayCircleRoundedIcon />}
      aria-pressed={playing}
      aria-label={`Play from ${time}: ${what}`}
      data-testid={testId}
      onClick={onPlay}
      sx={sx}
    >
      {time}
    </Button>
  );
}
```

- [ ] **Step 4: Write CareVideo**

`src/ui/care/CareVideo.tsx`:

```tsx
/**
 * Decent's video on the Care screen (D154). Nothing comes from YouTube until
 * a tap: before it, CafAI's own poster (one short row on a narrow screen);
 * after it, YouTube's player at the moment tapped, made again on every tap
 * (a new key), so a moment always starts where it says. Where the player
 * cannot play in place (inside Decaid off Android) there is no poster: the
 * card says Decaid opens the video in the browser, and the moments are links.
 */
import type { Ref } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { TID } from '../testIds.ts';
import { CARE_VIDEO, CARE_VIDEO_MINUTES, embedUrl, formatMoment, watchUrl } from './careGuide.ts';

/** What plays: its moment, the words for it, and the tap that started it. */
export interface Playing {
  start: number;
  /** The moment that started it (a step's id, a routine's id), or 'poster'. */
  key: string;
  /** "Flush the group head"; null from the poster. */
  label: string | null;
  /** Counts the taps: a new player for each. */
  take: number;
}

export interface CareVideoProps {
  /** YouTube's player can play here (videoPlace.ts); otherwise links. */
  inPlace: boolean;
  /** The narrow screen: one short row until a tap. */
  compact: boolean;
  playing: Playing | null;
  onPlayFromStart(): void;
  linkProps: { target?: '_blank'; rel?: string };
  ref?: Ref<HTMLDivElement>;
}

export const LOADS_FROM_YOUTUBE = 'Loads from YouTube when you tap play.';
export const OPENS_IN_BROWSER = 'Decaid opens the video in your browser: each time starts it at that step.';
const DETAILS = `${CARE_VIDEO.channel} · ${CARE_VIDEO_MINUTES} · ${CARE_VIDEO.year}`;
const PLAY_NAME = `Play Decent's video: ${CARE_VIDEO.title}`;

const cardSx = { borderRadius: '16px', p: 1.5, bgcolor: 'background.paper' } as const;
/** 16:9 at the card's width. */
const frameSx = { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden' } as const;

function playCircleSx(size: number) {
  return {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: '50%',
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
}

function WatchLink({ linkProps }: { linkProps: CareVideoProps['linkProps'] }) {
  return (
    <Button
      component="a"
      href={watchUrl()}
      {...linkProps}
      variant="text"
      endIcon={<OpenInNewRoundedIcon />}
      data-testid={TID.careWatch}
      sx={{ minHeight: 48, mt: 0.5, ml: -1, px: 1 }}
    >
      Watch on YouTube
    </Button>
  );
}

export function CareVideo({ inPlace, compact, playing, onPlayFromStart, linkProps, ref }: CareVideoProps) {
  if (!inPlace) {
    return (
      <Paper ref={ref} variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {CARE_VIDEO.title}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {DETAILS}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {OPENS_IN_BROWSER}
        </Typography>
        <WatchLink linkProps={linkProps} />
      </Paper>
    );
  }
  if (playing) {
    return (
      <Paper ref={ref} variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
        <Box sx={{ ...frameSx, bgcolor: 'cafai.raised' }}>
          <Box
            component="iframe"
            key={playing.take}
            data-testid={TID.carePlayer}
            src={embedUrl(playing.start)}
            title={`Decent's video: ${CARE_VIDEO.title}`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          />
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>
          {playing.label === null ? (
            'Playing from the start'
          ) : (
            <>
              Playing from{' '}
              <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoment(playing.start)}
              </Box>
              : {playing.label}
            </>
          )}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {CARE_VIDEO.title} · {CARE_VIDEO.channel}
        </Typography>
        <WatchLink linkProps={linkProps} />
      </Paper>
    );
  }
  if (compact) {
    return (
      <Paper ref={ref} variant="outlined" data-testid={TID.careVideo} sx={{ ...cardSx, p: 0, overflow: 'hidden' }}>
        <ButtonBase
          data-testid={TID.carePoster}
          aria-label={PLAY_NAME}
          onClick={onPlayFromStart}
          sx={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '48px minmax(0, 1fr)',
            columnGap: 1.5,
            alignItems: 'center',
            justifyContent: 'stretch',
            textAlign: 'left',
            p: 1,
            pr: 1.5,
            fontFamily: 'inherit',
            color: 'text.primary',
          }}
        >
          <Box component="span" sx={playCircleSx(48)}>
            <PlayArrowRoundedIcon sx={{ fontSize: 28, ml: '2px' }} />
          </Box>
          <Box component="span" sx={{ minWidth: 0 }}>
            <Typography component="span" variant="body2" sx={{ display: 'block', fontWeight: 600 }}>
              Decent's video · {CARE_VIDEO_MINUTES}
            </Typography>
            <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              {LOADS_FROM_YOUTUBE}
            </Typography>
          </Box>
        </ButtonBase>
      </Paper>
    );
  }
  return (
    <Paper ref={ref} variant="outlined" data-testid={TID.careVideo} sx={cardSx}>
      <ButtonBase
        data-testid={TID.carePoster}
        aria-label={PLAY_NAME}
        onClick={onPlayFromStart}
        sx={{
          ...frameSx,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          bgcolor: 'cafai.raised',
          color: 'text.primary',
          fontFamily: 'inherit',
        }}
      >
        <Box component="span" sx={playCircleSx(64)}>
          <PlayArrowRoundedIcon sx={{ fontSize: 36, ml: '3px' }} />
        </Box>
        <Box component="span" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          Play Decent's video
        </Box>
      </ButtonBase>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1.25 }}>
        {CARE_VIDEO.title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {DETAILS}
      </Typography>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.75 }}>
        {LOADS_FROM_YOUTUBE}
      </Typography>
      <WatchLink linkProps={linkProps} />
    </Paper>
  );
}
```

(React 19: `ref` is an ordinary prop on a function component, so no `forwardRef`.)

- [ ] **Step 5: Run the tests, the typecheck and lint on the new files**

Run: `npx vitest run src/ui/care/CareVideo.test.tsx > .verify/t5.log 2>&1; echo exit=$?`, `npm run typecheck > .verify/t5-tc.log 2>&1; echo exit=$?`, `npx eslint src/ui/care > .verify/t5-lint.log 2>&1; echo exit=$?`
Expected: exit=0 for all three.

- [ ] **Step 6: Commit**

```bash
git add src/ui/care/MomentButton.tsx src/ui/care/CareVideo.tsx src/ui/care/CareVideo.test.tsx
git commit -m "feat: Decent's video card and the moments: CafAI's poster until a tap, YouTube's player in place, or links (D154)"
```

---

### Task 6: The routines' segments and a routine's card

**Files:**
- Create: `src/ui/care/CareSegments.tsx`, `src/ui/care/RoutineCard.tsx`
- Test: `src/ui/care/RoutineCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/ui/care/RoutineCard.test.tsx`:

```tsx
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { CARE_SOURCES, routineOf, watchUrl } from './careGuide.ts';
import { CareSegments } from './CareSegments.tsx';
import { RoutineCard } from './RoutineCard.tsx';
import type { RoutineId } from './routines.ts';

afterEach(() => cleanup());

const tabIdOf = (routine: RoutineId) => `tab-${routine}`;

describe('CareSegments', () => {
  function segments(routine: RoutineId = 'daily') {
    const onChange = vi.fn();
    renderWithServices(<CareSegments routine={routine} onChange={onChange} panelId="panel" tabIdOf={tabIdOf} />);
    return { onChange };
  }

  it('is a tab list of the four routines, the chosen one selected and the only tab stop', () => {
    segments('weekly');
    const list = screen.getByRole('tablist', { name: 'How often' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Daily', 'Weekly', 'Monthly', 'As needed']);
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveAttribute('aria-selected', 'false');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-controls', 'panel');
    expect(screen.getByTestId(TID.careSegment('asNeeded'))).toHaveTextContent('As needed');
  });

  it('a tap asks for that routine', async () => {
    const { onChange } = segments();
    await userEvent.click(screen.getByRole('tab', { name: 'Monthly' }));
    expect(onChange).toHaveBeenCalledWith('monthly');
  });

  it('the arrow keys, Home and End move the choice and the focus, round the ends', async () => {
    const { onChange } = segments('daily');
    screen.getByRole('tab', { name: 'Daily' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('weekly');
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('asNeeded');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('daily');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('asNeeded');
  });
});

describe('RoutineCard', () => {
  function card(routine: RoutineId, options: { numbered?: boolean; links?: boolean; playingKey?: string | null } = {}) {
    const onPlay = vi.fn();
    renderWithServices(
      <RoutineCard
        routine={routineOf(routine)}
        numbered={options.numbered ?? true}
        links={options.links ?? false}
        linkProps={{}}
        playingKey={options.playingKey ?? null}
        onPlay={onPlay}
        panelId="panel"
        tabId="tab-x"
      />,
    );
    return { onPlay };
  }

  it("is the routine's tab panel: its name, how often, its steps in order and the sources", () => {
    card('daily');
    const panel = screen.getByTestId(TID.careRoutine);
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('id', 'panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-x');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Daily');
    expect(within(panel).getByText('On days you pull shots.')).toBeInTheDocument();
    const steps = within(panel).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Purge and wipe the steam wand',
      'Flush the group head',
      'Wipe the shower screen',
      'Rinse the steam wand',
    ]);
    expect(within(panel).getByText(CARE_SOURCES)).toBeInTheDocument();
  });

  it('numbers the steps on a wide screen only', () => {
    card('daily', { numbered: true });
    expect(within(screen.getByTestId(TID.careStep('flush-group'))).getByText('2')).toBeInTheDocument();
    cleanup();
    card('daily', { numbered: false });
    expect(within(screen.getByTestId(TID.careStep('flush-group'))).queryByText('2')).toBeNull();
  });

  it('shows a step whole: when, how, where, the note and the link', () => {
    card('asNeeded');
    const step = screen.getByTestId(TID.careStep('descale'));
    expect(step).toHaveTextContent('Sooner if the steam starts to pulse.');
    expect(step).toHaveTextContent('Citric acid only.');
    expect(step).toHaveTextContent('From streamline for now: Settings > Maintenance > Machine Descaling.');
    expect(step).toHaveTextContent("Decent's pages say every year or two.");
    expect(within(step).getByRole('link', { name: "Decent's descaling steps" })).toHaveAttribute(
      'href',
      'https://decentespresso.com/docs/de1_descaling_instructions',
    );
    expect(screen.getByTestId(TID.careLink('descale'))).toBeInTheDocument();
  });

  it("plays a step's moment, and the routine's own", async () => {
    const { onPlay } = card('weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Play from 11:11: Steam Rinza through the wand' }));
    expect(onPlay).toHaveBeenLastCalledWith(671, 'rinza', 'Steam Rinza through the wand');
    await userEvent.click(screen.getByTestId(TID.careMoment('weekly')));
    expect(onPlay).toHaveBeenLastCalledWith(460, 'weekly', 'Weekly');
  });

  it('marks the moment playing', () => {
    card('weekly', { playingKey: 'rinza' });
    expect(screen.getByTestId(TID.careMoment('rinza'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(TID.careMoment('tank-tray'))).toHaveAttribute('aria-pressed', 'false');
  });

  it('as links, each moment is YouTube at its time', () => {
    card('monthly', { links: true });
    expect(screen.getByTestId(TID.careMoment('group-parts'))).toHaveAttribute('href', watchUrl(1016));
    expect(screen.getByTestId(TID.careMoment('monthly'))).toHaveAttribute('href', watchUrl(996));
  });

  it('a step without a moment has none', () => {
    card('monthly');
    expect(screen.queryByTestId(TID.careMoment('gasket'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/care/RoutineCard.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write CareSegments**

`src/ui/care/CareSegments.tsx`:

```tsx
/**
 * The routines, one at a time (D153): a tab list drawn as the Mode control's
 * segments (DESIGN.md, Appearance controls): a raised track, the chosen one a
 * surface pill with an ink label. A tap or an arrow key asks the screen for
 * that routine; the arrow keys, Home and End move the focus with the choice,
 * round the ends, and the chosen tab is the only Tab stop.
 */
import { useRef, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { SxProps, Theme } from '@mui/material/styles';
import { TID } from '../testIds.ts';
import { ROUTINES } from './careGuide.ts';
import type { RoutineId } from './routines.ts';

export interface CareSegmentsProps {
  routine: RoutineId;
  onChange(routine: RoutineId): void;
  /** The routine's card, which every tab controls. */
  panelId: string;
  tabIdOf(routine: RoutineId): string;
}

const trackSx = {
  display: 'grid',
  gridTemplateColumns: `repeat(${ROUTINES.length}, minmax(0, 1fr))`,
  gap: '4px',
  p: '4px',
  bgcolor: 'cafai.raised',
  borderRadius: '14px',
} as const;

const segmentSx: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  minHeight: 48,
  px: 0.5,
  borderRadius: '10px',
  color: 'text.secondary',
  fontFamily: 'inherit',
  fontSize: '0.9375rem',
  fontWeight: 600,
  lineHeight: 1.2,
  textAlign: 'center',
  transition: theme.transitions.create(['background-color', 'color', 'box-shadow'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&[aria-selected="true"]': {
    bgcolor: 'background.paper',
    color: 'text.primary',
    boxShadow: `0 1px 2px rgba(0, 0, 0, ${theme.palette.mode === 'dark' ? 0.35 : 0.14})`,
  },
});

export function CareSegments({ routine, onChange, panelId, tabIdOf }: CareSegmentsProps) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const at = (index + ROUTINES.length) % ROUTINES.length;
    onChange(ROUTINES[at]!.id);
    tabs.current[at]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? ROUTINES.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    move(to);
  };
  return (
    <Box role="tablist" aria-label="How often" sx={trackSx}>
      {ROUTINES.map((each, index) => {
        const selected = each.id === routine;
        return (
          <ButtonBase
            key={each.id}
            ref={(node: HTMLButtonElement | null) => {
              tabs.current[index] = node;
            }}
            role="tab"
            id={tabIdOf(each.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            data-testid={TID.careSegment(each.id)}
            onClick={() => onChange(each.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            sx={segmentSx}
          >
            {each.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Write RoutineCard**

`src/ui/care/RoutineCard.tsx`:

```tsx
/**
 * A routine of the cleaning guide (D153, D155), the routines' tab panel: its
 * name and how often, its own part of Decent's video, then its steps in
 * order (numbered on a wide screen): what, when, how, where to run it for
 * now, the note where the video and Decent's pages differ, a link to
 * Decent's page, and the step's moment. The sources close it.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { TID } from '../testIds.ts';
import { CARE_SOURCES, type CareRoutine, type CareStep } from './careGuide.ts';
import { MomentButton } from './MomentButton.tsx';

export interface RoutineCardProps {
  routine: CareRoutine;
  /** Numbers before the steps (a wide screen). */
  numbered: boolean;
  /** Moments as links to YouTube (videoPlace.ts). */
  links: boolean;
  linkProps: { target?: '_blank'; rel?: string };
  /** The moment playing, by its key. */
  playingKey: string | null;
  onPlay(start: number, key: string, label: string): void;
  panelId: string;
  tabId: string;
}

const numberSx = {
  width: 28,
  height: 28,
  mt: '1px',
  borderRadius: '50%',
  bgcolor: 'cafai.raised',
  color: 'text.secondary',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  typography: 'label',
  fontWeight: 650,
} as const;

function Step({ step, number, props }: { step: CareStep; number: number; props: RoutineCardProps }) {
  const { numbered, links, linkProps, playingKey, onPlay } = props;
  return (
    <Box
      component="li"
      data-testid={TID.careStep(step.id)}
      sx={{
        display: 'grid',
        gridTemplateColumns: numbered ? '28px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
        columnGap: 1.5,
        alignItems: 'start',
        py: 1.5,
        borderTop: number === 1 ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      {numbered ? (
        <Box aria-hidden sx={numberSx}>
          {number}
        </Box>
      ) : null}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {step.title}
        </Typography>
        {step.when ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: '1px' }}>
            {step.when}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {step.how}
        </Typography>
        {step.where ? (
          <Typography variant="label" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {step.where}
          </Typography>
        ) : null}
        {step.note ? (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 0.75, color: 'text.secondary' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, mt: '1px', flex: 'none' }} />
            <Typography variant="label" component="p">
              {step.note}
            </Typography>
          </Box>
        ) : null}
        {step.link ? (
          <Button
            component="a"
            href={step.link.url}
            {...linkProps}
            variant="text"
            endIcon={<OpenInNewRoundedIcon />}
            data-testid={TID.careLink(step.id)}
            sx={{ minHeight: 48, mt: 0.25, ml: -1, px: 1 }}
          >
            {step.link.label}
          </Button>
        ) : null}
      </Box>
      {step.moment === undefined ? (
        <span />
      ) : (
        <MomentButton
          seconds={step.moment}
          what={step.title}
          link={links}
          linkProps={linkProps}
          playing={playingKey === step.id}
          onPlay={() => onPlay(step.moment!, step.id, step.title)}
          testId={TID.careMoment(step.id)}
          nudge
        />
      )}
    </Box>
  );
}

export function RoutineCard(props: RoutineCardProps) {
  const { routine, links, linkProps, playingKey, onPlay, panelId, tabId } = props;
  return (
    <Paper
      variant="outlined"
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      data-testid={TID.careRoutine}
      sx={{ borderRadius: '16px', px: 2, bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 1.25, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {routine.label}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {routine.cadence}
          </Typography>
        </Box>
        {routine.moment === undefined ? null : (
          <MomentButton
            seconds={routine.moment}
            what={routine.label}
            link={links}
            linkProps={linkProps}
            playing={playingKey === routine.id}
            onPlay={() => onPlay(routine.moment!, routine.id, routine.label)}
            testId={TID.careMoment(routine.id)}
          />
        )}
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {routine.steps.map((step, index) => (
          <Step key={step.id} step={step} number={index + 1} props={props} />
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', pt: 1.25, pb: 1.75, borderTop: 1, borderColor: 'divider' }}>
        {CARE_SOURCES}
      </Typography>
    </Paper>
  );
}
```

- [ ] **Step 5: Run the tests, the typecheck and lint**

Run: `npx vitest run src/ui/care/RoutineCard.test.tsx > .verify/t6.log 2>&1; echo exit=$?`, `npm run typecheck > .verify/t6-tc.log 2>&1; echo exit=$?`, `npx eslint src/ui/care > .verify/t6-lint.log 2>&1; echo exit=$?`
Expected: exit=0 for all three.

- [ ] **Step 6: Commit**

```bash
git add src/ui/care/CareSegments.tsx src/ui/care/RoutineCard.tsx src/ui/care/RoutineCard.test.tsx
git commit -m "feat: the routines as segments and a routine's card, its steps with when, how, notes and moments (D153, D155)"
```

---

### Task 7: The Care screen

**Files:**
- Create: `src/ui/care/CareScreen.tsx`
- Test: `src/ui/care/CareScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/ui/care/CareScreen.test.tsx`:

```tsx
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { embedUrl, watchUrl } from './careGuide.ts';
import { CareScreen, WIDE_FROM } from './CareScreen.tsx';
import type { RoutineId } from './routines.ts';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

/** The screen's own width, as useOwnLayout reads it (jsdom lays nothing out). */
function ownWidth(width: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
}

function care(options: { routine?: RoutineId; width?: number; insideDecaid?: boolean; platform?: string | null } = {}) {
  ownWidth(options.width ?? 962);
  const onRoutine = vi.fn();
  const onBack = vi.fn();
  const services = createFakeServices({ insideDecaid: options.insideDecaid, platform: options.platform });
  const view = renderWithServices(<CareScreen routine={options.routine ?? 'daily'} onRoutine={onRoutine} onBack={onBack} />, services);
  return { ...view, onRoutine, onBack };
}

describe('CareScreen', () => {
  it('opens on the routine it is given, with the routines and the title', () => {
    care({ routine: 'weekly' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Machine care');
    expect(screen.getByRole('tab', { name: 'Weekly' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Weekly' })).toHaveTextContent('Steam Rinza through the wand');
  });

  it('a segment asks the app for that routine', async () => {
    const { onRoutine } = care();
    await userEvent.click(screen.getByTestId(TID.careSegment('monthly')));
    expect(onRoutine).toHaveBeenCalledWith('monthly');
  });

  it('the back arrow goes to Settings', async () => {
    const { onBack } = care();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('nothing from YouTube until a tap; a moment then plays in place, marked', async () => {
    care();
    expect(document.querySelector('iframe')).toBeNull();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(108));
    expect(screen.getByTestId(TID.careMoment('flush-group'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(TID.careVideo)).toHaveTextContent('Playing from 1:48: Flush the group head');
  });

  it('another moment moves the player; the same one starts it again', async () => {
    care();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const first = screen.getByTestId(TID.carePlayer);
    await userEvent.click(screen.getByTestId(TID.careMoment('daily')));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(20));
    expect(screen.getByTestId(TID.careMoment('flush-group'))).toHaveAttribute('aria-pressed', 'false');
    const second = screen.getByTestId(TID.carePlayer);
    await userEvent.click(screen.getByTestId(TID.careMoment('daily')));
    expect(screen.getByTestId(TID.carePlayer)).not.toBe(second);
    expect(second).not.toBe(first);
  });

  it('the poster plays from the start', async () => {
    care();
    await userEvent.click(screen.getByTestId(TID.carePoster));
    expect(screen.getByTestId(TID.carePlayer)).toHaveAttribute('src', embedUrl(0));
  });

  it('the player keeps playing when the routine changes', async () => {
    const { rerenderWith, onRoutine, onBack } = care();
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const player = screen.getByTestId(TID.carePlayer);
    rerenderWith(<CareScreen routine="weekly" onRoutine={onRoutine} onBack={onBack} />);
    expect(screen.getByTestId(TID.carePlayer)).toBe(player);
  });

  it('wide: the steps numbered, the poster in full', () => {
    care({ width: WIDE_FROM });
    expect(screen.getByTestId(TID.careStep('flush-group'))).toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Play Decent's video");
  });

  it('narrow: no numbers, the short row, and the player kept when the width crosses the line', async () => {
    let width = WIDE_FROM - 1;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    const services = createFakeServices();
    renderWithServices(<CareScreen routine="daily" onRoutine={vi.fn()} onBack={vi.fn()} />, services);
    expect(screen.getByTestId(TID.careStep('flush-group'))).not.toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePoster)).toHaveTextContent("Decent's video · 22 min");
    await userEvent.click(screen.getByTestId(TID.careMoment('flush-group')));
    const player = screen.getByTestId(TID.carePlayer);
    width = WIDE_FROM + 200;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(screen.getByTestId(TID.careStep('flush-group'))).toHaveTextContent(/^2/);
    expect(screen.getByTestId(TID.carePlayer)).toBe(player);
  });

  it('inside Decaid off Android: links, no poster, nothing framed', () => {
    care({ routine: 'monthly', insideDecaid: true, platform: 'windows' });
    expect(screen.queryByTestId(TID.carePoster)).toBeNull();
    const moment = screen.getByTestId(TID.careMoment('group-parts'));
    expect(moment).toHaveAttribute('href', watchUrl(1016));
    expect(moment).not.toHaveAttribute('target');
    expect(screen.getByTestId(TID.careWatch)).toHaveAttribute('href', watchUrl());
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('inside Decaid on Android: in place, and its links open in the system browser', () => {
    care({ routine: 'asNeeded', insideDecaid: true, platform: 'android' });
    expect(screen.getByTestId(TID.carePoster)).toBeInTheDocument();
    expect(screen.getByTestId(TID.careWatch)).not.toHaveAttribute('target');
    expect(screen.getByTestId(TID.careLink('descale'))).not.toHaveAttribute('target');
  });

  it("in a browser, links open a new tab", () => {
    care({ routine: 'asNeeded' });
    expect(screen.getByTestId(TID.careWatch)).toHaveAttribute('target', '_blank');
    expect(screen.getByTestId(TID.careLink('steam-tip'))).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/care/CareScreen.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the screen**

`src/ui/care/CareScreen.tsx`:

```tsx
/**
 * Settings > Machine care's guide (#/care, D152-D155): Decent's cleaning
 * routine by how often, one routine at a time, each step with a line on how
 * and its moment in Decent's video. Nothing loads from YouTube until a tap;
 * the player plays in place where it can (videoPlace.ts) and the moments are
 * links to YouTube elsewhere.
 *
 * Laid out for its own box (useOwnLayout.ts): from 840 px the routines and
 * the steps on the left, the video beside them; under it one column, the
 * video between the routines and the steps. Both keep the same elements in
 * the same order, so crossing the line (a tablet turned upright) keeps the
 * player playing.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useServices } from '../../app/services.tsx';
import { useOwnLayout } from '../machine/useOwnLayout.ts';
import { TID } from '../testIds.ts';
import { routineOf } from './careGuide.ts';
import { CareSegments } from './CareSegments.tsx';
import { CareVideo, type Playing } from './CareVideo.tsx';
import { RoutineCard } from './RoutineCard.tsx';
import type { RoutineId } from './routines.ts';
import { outsideLinkProps, videoPlaysInPlace } from './videoPlace.ts';

export interface CareScreenProps {
  routine: RoutineId;
  /** A segment chosen: the app replaces the address, so Back leaves Care. */
  onRoutine(routine: RoutineId): void;
  /** The back arrow: to Settings. */
  onBack(): void;
}

/** Two columns from this own width: every Decent tablet, an iPad on its side. */
export const WIDE_FROM = 840;
const chooseWide = (width: number) => width >= WIDE_FROM;

const PANEL_ID = 'care-routine-panel';
const tabIdOf = (routine: RoutineId) => `care-tab-${routine}`;

const wideSx = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 360px',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  gridTemplateAreas: '"seg video" "routine video"',
  columnGap: '20px',
  rowGap: '12px',
  px: 2,
  pt: 1.5,
} as const;

const narrowSx = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  px: 2,
  pt: 1.5,
} as const;

export function CareScreen({ routine, onRoutine, onBack }: CareScreenProps) {
  const { host } = useServices();
  const inPlace = videoPlaysInPlace(host);
  const linkProps = outsideLinkProps(host);
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLDivElement>(null);
  const wide = useOwnLayout(box, chooseWide);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const play = (start: number, key: string, label: string | null) =>
    setPlaying((current) => ({ start, key, label, take: (current?.take ?? 0) + 1 }));

  // In one column the player may be above the step that started it: bring it into view.
  const take = playing?.take ?? 0;
  useEffect(() => {
    if (take === 0 || wide) return;
    const node = video.current;
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [take, wide]);

  return (
    <Box ref={box} data-testid={TID.careScreen} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          minHeight: 57,
          pl: 0.5,
          pr: 2,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <IconButton data-testid={TID.careBack} aria-label="Back to Settings" onClick={onBack} sx={{ color: 'text.primary', borderRadius: '12px' }}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h6" component="h1">
          Machine care
        </Typography>
      </Box>
      <Box sx={wide ? wideSx : narrowSx}>
        <Box sx={{ gridArea: 'seg', minWidth: 0 }}>
          <CareSegments routine={routine} onChange={onRoutine} panelId={PANEL_ID} tabIdOf={tabIdOf} />
        </Box>
        <Box sx={{ gridArea: 'video', alignSelf: 'start', minWidth: 0 }}>
          <CareVideo
            ref={video}
            inPlace={inPlace}
            compact={!wide}
            playing={playing}
            onPlayFromStart={() => play(0, 'poster', null)}
            linkProps={linkProps}
          />
        </Box>
        {/* Keyed by the routine, so a new routine starts at its top. */}
        <Box key={routine} sx={wide ? { gridArea: 'routine', minHeight: 0, overflowY: 'auto', pb: 2 } : { pb: 2 }}>
          <RoutineCard
            routine={routineOf(routine)}
            numbered={wide}
            links={!inPlace}
            linkProps={linkProps}
            playingKey={playing?.key ?? null}
            onPlay={play}
            panelId={PANEL_ID}
            tabId={tabIdOf(routine)}
          />
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run the tests, the typecheck and lint**

Run: `npx vitest run src/ui/care > .verify/t7.log 2>&1; echo exit=$?`, `npm run typecheck > .verify/t7-tc.log 2>&1; echo exit=$?`, `npx eslint src/ui/care > .verify/t7-lint.log 2>&1; echo exit=$?`
Expected: exit=0 for all three.

- [ ] **Step 5: Commit**

```bash
git add src/ui/care/CareScreen.tsx src/ui/care/CareScreen.test.tsx
git commit -m "feat: the Care screen: the routines, the steps and Decent's video, beside them on a tablet and in one column on a phone (D152-D155)"
```

---

### Task 8: Wiring: the route's screen, the place, Settings

**Files:**
- Create: `src/ui/settings/CareSection.tsx`, `src/ui/settings/CareSection.test.tsx`
- Modify: `src/app/App.tsx`, `src/ui/shell/AppShell.tsx`, `src/ui/settings/SettingsScreen.tsx`
- Test: `src/ui/shell/AppShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/ui/settings/CareSection.test.tsx`:

```tsx
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { TID } from '../testIds.ts';
import { CARE_LINE, CareSection } from './CareSection.tsx';

afterEach(() => cleanup());

describe('Settings > Machine care', () => {
  it('says what the guide is, and links to it', () => {
    renderWithServices(<CareSection />);
    const section = screen.getByRole('region', { name: 'Machine care' });
    expect(within(section).getByText(CARE_LINE)).toBeInTheDocument();
    const open = within(section).getByRole('link', { name: 'Cleaning guide' });
    expect(open).toHaveAttribute('href', '#/care');
    expect(open).toBe(screen.getByTestId(TID.careOpen));
  });
});
```

In `src/ui/shell/AppShell.test.tsx`, inside `describe('AppShell', ...)` (the tablet one):

```tsx
  it('marks Settings current on the cleaning guide, which is under it', () => {
    renderShell({ name: 'care', routine: 'weekly' });
    expect(screen.getByTestId(TID.navSettings)).toHaveAttribute('aria-current', 'page');
    for (const id of [TID.navCoach, TID.navShot, TID.navHistory]) expect(screen.getByTestId(id)).not.toHaveAttribute('aria-current');
  });
```

and inside `describe('AppShell on a phone', ...)`:

```tsx
  it("marks the Settings tab current on the cleaning guide", () => {
    renderShell({ name: 'care', routine: 'daily' });
    expect(screen.getByTestId(TID.tabSettings)).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId(TID.tabCoach)).not.toHaveAttribute('aria-current');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/settings/CareSection.test.tsx src/ui/shell/AppShell.test.tsx`
Expected: FAIL (no CareSection; Settings not current on care).

- [ ] **Step 3: Implement**

`src/ui/settings/CareSection.tsx`:

```tsx
/**
 * Settings > Machine care (D152): the way into the cleaning guide (#/care).
 * Nothing here is a setting yet; the reminders, the third machine care item,
 * will add the water's hardness.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import { routeHref } from '../router.ts';
import { TID } from '../testIds.ts';
import { Section } from './Section.tsx';

export const CARE_LINE = "What to clean every day, week and month, with Decent's video.";

export function CareSection() {
  return (
    <Section title="Machine care">
      <Box data-testid={TID.careSection}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {CARE_LINE}
        </Typography>
        <Button
          variant="tonal"
          href={routeHref({ name: 'care', routine: 'daily' })}
          startIcon={<CleaningServicesRoundedIcon />}
          data-testid={TID.careOpen}
          sx={{ minHeight: 48 }}
        >
          Cleaning guide
        </Button>
      </Box>
    </Section>
  );
}
```

`src/ui/settings/SettingsScreen.tsx`: import `import { CareSection } from './CareSection.tsx';` (alphabetically after `AppearanceSection`), and in `SettingsScreen`'s stack put `<CareSection />` right after `<DrinkSettingsSection />`.

`src/ui/shell/AppShell.tsx`: change the router import to
`import { placeOf, type Route, type RouteName } from '../router.ts';`, then in `TopBar`
`<NavButton key={item.name} item={item} active={placeOf(route) === item.name} onNavigate={onNavigate} />`
and in `Tabs`
`<Tab key={item.name} item={item} active={placeOf(route) === item.name} rail={rail} onNavigate={onNavigate} />`.

`src/app/App.tsx`: import `import { CareScreen } from '../ui/care/CareScreen.tsx';`, add `replaceRoute` to the router import
(`import { isRemembered, navigate, replaceRoute, routeHref, useRoute, type Route } from '../ui/router.ts';`), and in `Routed`, after the settings branch:

```tsx
  } else if (route.name === 'care') {
    screen = (
      <CareScreen
        routine={route.routine}
        onRoutine={(routine) => replaceRoute({ name: 'care', routine })}
        onBack={() => navigate({ name: 'settings' })}
      />
    );
```

- [ ] **Step 4: Run the whole unit suite, typecheck and lint**

Run: `npm test > .verify/t8.log 2>&1; echo exit=$?`, `npm run typecheck > .verify/t8-tc.log 2>&1; echo exit=$?`, `npm run lint > .verify/t8-lint.log 2>&1; echo exit=$?`
Expected: exit=0 for all three. A Settings test that counts sections or snapshots their order may need Machine care added: add it after "Steam, hot water and flush".

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings/CareSection.tsx src/ui/settings/CareSection.test.tsx src/ui/settings/SettingsScreen.tsx src/ui/shell/AppShell.tsx src/ui/shell/AppShell.test.tsx src/app/App.tsx
git commit -m "feat: Settings > Machine care opens the cleaning guide, and the shell keeps Settings lit on it (D152)"
```

---

### Task 9: End to end

**Files:**
- Create: `e2e/care.spec.ts`
- Modify: `playwright.config.ts` (`PHONE_SPECS` gains `care`)

- [ ] **Step 1: Write the spec**

`e2e/care.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { isPhone, openApp } from './helpers.ts';

/**
 * Settings > Machine care and its cleaning guide (D152-D155), on the tablets
 * and the phones. YouTube is never reached from a test: anything bound for it
 * gets a stub page, and the requests are counted.
 */
async function stubYouTube(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/^https:\/\/(www\.)?youtube(-nocookie)?\.com\//, async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub player</title><p>stub</p>' });
  });
  return asked;
}

function settingsPlace(page: Page) {
  return page.getByTestId(isPhone(page) ? TID.tabSettings : TID.navSettings);
}

test('Settings > Machine care opens the guide on Daily, under Settings, with nothing from YouTube', async ({ page }) => {
  const asked = await stubYouTube(page);
  await openApp(page, '#/settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/#\/care$/);
  await expect(page.getByTestId(TID.careScreen)).toBeVisible();
  await expect(settingsPlace(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId(TID.careSegment('daily'))).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Flush the group head');
  await expect(page.getByTestId(TID.carePlayer)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('the routines switch in place, the address follows, and a reload keeps it', async ({ page }) => {
  await stubYouTube(page);
  await openApp(page, '#/care');
  await page.getByTestId(TID.careSegment('weekly')).click();
  await expect(page).toHaveURL(/#\/care\/weekly$/);
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Steam Rinza through the wand');
  await page.reload();
  await expect(page.getByTestId(TID.careSegment('weekly'))).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(TID.careSegment('asNeeded')).click();
  await expect(page).toHaveURL(/#\/care\/as-needed$/);
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Descale');
});

test('a moment plays the video in place at its time, in view', async ({ page }) => {
  const asked = await stubYouTube(page);
  await openApp(page, '#/care');
  const moment = page.getByTestId(TID.careMoment('flush-group'));
  await moment.click();
  const player = page.getByTestId(TID.carePlayer);
  await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/0cm1JxB_6bI\?start=108&autoplay=1/);
  await expect(moment).toHaveAttribute('aria-pressed', 'true');
  await expect(player).toBeInViewport();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith('https://www.youtube-nocookie.com/'))).toBe(true);
});

test('inside Decaid on Windows the moments are links to YouTube, and nothing is framed', async ({ page }) => {
  const asked = await stubYouTube(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'windows', version: '0.8.8', build: '2900', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
  await openApp(page, '#/care/monthly');
  const moment = page.getByTestId(TID.careMoment('group-parts'));
  await expect(moment).toHaveAttribute('href', 'https://www.youtube.com/watch?v=0cm1JxB_6bI&t=1016s');
  await expect(moment).not.toHaveAttribute('target');
  await expect(page.getByTestId(TID.carePoster)).toHaveCount(0);
  await expect(page.getByTestId(TID.careWatch)).toHaveAttribute('href', 'https://www.youtube.com/watch?v=0cm1JxB_6bI');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('the back arrow returns to Settings', async ({ page }) => {
  await openApp(page, '#/care/weekly');
  await page.getByTestId(TID.careBack).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId(TID.careSection)).toBeAttached();
});
```

- [ ] **Step 2: Run it on every size**

In `playwright.config.ts`, add `care` to `PHONE_SPECS`'s alternation (after `drink-views`). Then:
Run: `npx playwright test e2e/care.spec.ts > .verify/t9.log 2>&1; echo exit=$?`
Expected: exit=0, five tests on each of the five projects (the three tablets and the two phones).

- [ ] **Step 3: Commit**

```bash
git add e2e/care.spec.ts playwright.config.ts
git commit -m "test: e2e for the cleaning guide on the tablets and the phones: Settings opens it, the routines, a moment in place, links in Decaid on Windows (D152-D155)"
```

---

### Task 10: A README picture

**Files:** Modify `e2e/screenshots/readme.shots.ts`, `README.md`; create `docs/images/tablet-care.png`

- [ ] **Step 1: Add the scene**, after the settings scene:

```ts
test('care: the cleaning guide, Weekly', async ({ page }) => {
  test.skip(isPhone(page), 'The README shows the cleaning guide on the tablet only.');
  await openDemo(page);
  await goTo(page, 'settings');
  const open = page.getByTestId(TID.careOpen);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.getByTestId(TID.careSegment('weekly')).click();
  await expect(page.getByTestId(TID.careRoutine)).toContainText('Steam Rinza through the wand');
  await snap(page, 'care');
});
```

- [ ] **Step 2: Take it**

Run: `npx playwright test --config playwright.screenshots.config.ts -g "care" > .verify/t10.log 2>&1; echo exit=$?`
Expected: exit=0 and `docs/images/tablet-care.png` written (under 300 KB). Look at it.

- [ ] **Step 3: Add it to README's Screenshots table**, as a new row after the Settings/phone row:

```markdown
| **Settings > Machine care: Decent's cleaning routine, Weekly** | |
| ![Machine care on a tablet: the Weekly routine's steps, each with its time in Decent's video, beside the video's card](docs/images/tablet-care.png) | |
```

- [ ] **Step 4: Commit**

```bash
git add e2e/screenshots/readme.shots.ts docs/images/tablet-care.png README.md
git commit -m "docs: a README picture of the cleaning guide (D152)"
```

---

### Task 11: The docs

**Files:** `DECISIONS.md`, `DESIGN.md`, `README.md`, `CHANGELOG.md`, `docs/HARDWARE_TEST_PLAN.md`, `docs/ROADMAP.md`, `MORNING.md`

- [ ] **Step 1: DECISIONS.md**: a new section at the end, `### The cleaning guide (2026-10-15)`, with D152 (Settings > Machine care opens `#/care`, Settings lit, the four places kept: the owner's choice; 18 px to spare at 962 px), D153 (one routine at a time, in the address, replaced not pushed: the owner's choice), D154 (the player in place only in a browser or on Android, tried on Decaid 0.8.8 for Windows and Chromium 153 and 91; nothing from YouTube before a tap; links elsewhere; `HostEnvironment.platform`), D155 (the words follow Decent's pages and say so; the calls listed in the spec's section 4; "From streamline for now"; the roadmap's corrections). Each: a bold one-sentence title, what was decided with the files in backticks, then "Why:".

- [ ] **Step 2: DESIGN.md**: a `### Machine care` section in Components after `### The log` describing the screen as built (header, segments, routine card, steps, moments, video card in its four states, the two layouts, Settings' section); add Machine care to the Settings card list under Cards ("…, Steam, hot water and flush, Machine care, About"); in Line length, "the Care screen's video column 360 px". Read the code, not the spec, for numbers.

- [ ] **Step 3: README.md**: in Screens and looks, a bullet **Settings > Machine care** (the routines, the moments, in place or links, offline words); in Privacy, the YouTube bullet (nothing until a tap; `youtube-nocookie.com`; then Google sees the device's address and that it played; links inside Decaid off Android); in Project layout's `src/ui` row, "the cleaning guide".

- [ ] **Step 4: CHANGELOG.md**: under Unreleased > The everyday skin, a bullet for Settings > Machine care.

- [ ] **Step 5: docs/HARDWARE_TEST_PLAN.md**: `## 14. Machine care: the cleaning guide's video (D152-D155)` before `## Results`: on a Decent tablet (Care opens from Settings; 1:48 plays in place with sound and no browser; 0:20 restarts; full screen and back; offline the words show), on an iPad or a Mac with Decaid (no poster; 16:56 opens YouTube at 16:56; CafAI stays).

- [ ] **Step 6: docs/ROADMAP.md**: item 1 of Machine care becomes "built on 2026-10-15" with the spec link and what is left (section 14 of the hardware plan); item 2's sentence on the guide's flushes says the weekly clean is the profile and the daily flush is Flush.

- [ ] **Step 7: MORNING.md**: a new "Newest (2026-10-15)" paragraph at the top (what was built, the Windows finding, what the checks gave), the 2026-10-13 one becoming "Before that".

- [ ] **Step 8: Commit**

```bash
git add DECISIONS.md DESIGN.md README.md CHANGELOG.md docs/HARDWARE_TEST_PLAN.md docs/ROADMAP.md MORNING.md
git commit -m "docs: the cleaning guide in DECISIONS (D152-D155), DESIGN, README, the changelog, the hardware test plan, the roadmap and MORNING"
```

---

### Task 12: Verify, review, land

- [ ] **Step 1: The checks**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run release:zip`, each as `cmd > .verify/v-<name>.log 2>&1; echo exit=$?`; then `npm run e2e > .verify/v-e2e.log 2>&1; echo exit=$?` (nothing else serving on port 4174). All exit=0.
- [ ] **Step 2: Chromium 91**: `npm run build:mock`, then `node tools/chrome91/smoke.mjs --dist ../../dist-mock --wait "document.querySelector('[data-testid=care-screen]')" --hash "?mockSpeed=25#/care/weekly" --name care > .verify/v-c91.log 2>&1; echo exit=$?`. Expected: exit=0, no page errors.
- [ ] **Step 3: One review** of `main..feat/machine-care` (correctness, the spec's rules, Chromium 91, privacy: no request to Google before a tap). Fix what it finds; re-run the affected checks.
- [ ] **Step 4: Land in main**: merge `main` into the branch, verify there, then a merge commit with `main` as first parent written with `git commit-tree` and `git update-ref refs/heads/main <new> <old>` (a guarded move, so another session's `main` is never checked out under it). Do not push.

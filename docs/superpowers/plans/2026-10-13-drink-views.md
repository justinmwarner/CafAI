# Steam, hot water and flush views: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the DE1 steams, pours hot water or flushes, CafAI's main pane switches to that drink's own view: an animated dial toward the drink's target, live readouts and a trace, and the drink's settings (held while it runs), with Go back once it is done.

**Architecture:** A session-long recorder (`drinkTrace.ts`) follows telemetry and keeps each drink's run outside React, as `shotTrace.ts` does for shots. A pure focus reducer (`drinkFocus.ts`) and its hook switch to `#/steam`, `#/hot-water` or `#/flush` with `location.replace` and the shell's tap guard. The view (`DrinkView.tsx`) draws the dial and trace imperatively from the recorder and reuses the Settings steppers, moved into `DrinkFields.tsx` and `useDrinkPresets.ts`. The mock Decaid runs each drink for its real time or volume.

**Tech Stack:** React 19, MUI 9 (sx, keyframes), TypeScript 5.9, Vitest 5 + Testing Library (jsdom), Playwright 1.63, MSW mock of Decaid.

**Spec:** `docs/superpowers/specs/2026-10-13-drink-views-design.md`. Mockup: `docs/superpowers/specs/2026-10-13-drink-views.mockup.html`.

**Conventions (read before any task):**
- Windows checkout, LF line endings (`.gitattributes eol=lf`). Edit with the Edit/Write tools; never `Path.write_text` (CRLF).
- Capture exit codes: `cmd > log 2>&1; echo exit=$?` (a pipe hides them).
- Comments in this codebase explain *why* in full sentences, British-leaning plain English, no em dashes in UI copy. Match the density of the surrounding file.
- Unit tests: `npx vitest run <path>`. DOM tests start with `// @vitest-environment jsdom`.
- Commit messages follow the log: `feat: …`, `fix: …`, `test: …`, `docs: …`, lower case after the colon, with the decision number (D146-D150) where one applies.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/ui/drinks/kinds.ts` | new | `DrinkKind`, the machine states each drink runs in |
| `src/ui/router.ts` | edit | `{ name: 'drink', drink }` routes, `isRemembered` |
| `src/app/App.tsx` | edit | never remember a drink's route |
| `src/ui/palette.ts`, `src/ui/theme.ts` | edit | `waterWash`, `milkWash` |
| `src/ui/drinks/drinkTrace.ts` | new | the app's one recording of drinks |
| `src/ui/settings/DrinkFields.tsx` | new | the stepper and a drink's fields, laid out by their parent |
| `src/ui/settings/useDrinkPresets.ts` | new | reading and writing Decaid's drink presets |
| `src/ui/settings/DrinkSettingsSection.tsx` | edit | uses the two above, unchanged on screen |
| `mock/decaid/shotPlayer.ts` | edit | steam, hot water and flush for their real time or volume |
| `src/ui/drinks/drinkModel.ts` | new | phases, targets, dial reading, readouts, trace lines (pure) |
| `src/ui/drinks/drinkFocus.ts`, `useDrinkFocus.ts` | new | switching to a drink's view, Go back |
| `src/ui/drinks/DrinkDial.tsx`, `DrinkTraceChart.tsx`, `DrinkReadouts.tsx`, `DrinkSettingsCard.tsx`, `DrinkView.tsx` | new | the view |
| `src/ui/shell/AppShell.tsx` | edit | records drinks, draws the view over the coach, merges the guards |
| `src/ui/testIds.ts` | edit | the view's test ids |
| `e2e/drink-views.spec.ts`, `playwright.config.ts` | new, edit | end to end on tablets and phones |
| `DESIGN.md`, `DECISIONS.md`, `README.md`, `CHANGELOG.md` | edit | D146-D150 and the view's description |

Order: Tasks 1-2 first (shared types). Then 3, 4 and 5 are independent (disjoint files) and can run in parallel. Task 6 needs 3; Task 7 needs 1 and 3; Task 8 needs 2, 3, 4, 6 and 7; Task 9 needs 7 and 8; Task 10 needs 5 and 9; Task 11 last.

---

### Task 1: Drink kinds and routes

**Files:**
- Create: `src/ui/drinks/kinds.ts`, `src/ui/drinks/kinds.test.ts`
- Modify: `src/ui/router.ts`, `src/ui/router.test.ts`, `src/app/App.tsx:28-34, 51-54`

- [ ] **Step 1: Write the failing tests**

`src/ui/drinks/kinds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRINK_KINDS, drinkOfState } from './kinds.ts';

describe('drinkOfState', () => {
  it('maps each drink state to its drink, steamRinse to steam', () => {
    expect(drinkOfState('steam')).toBe('steam');
    expect(drinkOfState('steamRinse')).toBe('steam');
    expect(drinkOfState('hotWater')).toBe('hotWater');
    expect(drinkOfState('flush')).toBe('flush');
  });

  it('is null for a shot, a cycle, rest and nothing', () => {
    for (const state of ['espresso', 'skipStep', 'airPurge', 'cleaning', 'descaling', 'idle', 'sleeping', 'heating', 'someNewState', '', null, undefined]) {
      expect(drinkOfState(state), String(state)).toBeNull();
    }
  });

  it('lists the drinks in the machine row order', () => {
    expect(DRINK_KINDS).toEqual(['steam', 'flush', 'hotWater']);
  });
});
```

Add to `src/ui/router.test.ts` (inside `describe('parseRoute', …)`, after "reads the shot route"):

```ts
  it("reads a drink's view", () => {
    expect(parseRoute('#/steam')).toEqual({ name: 'drink', drink: 'steam' });
    expect(parseRoute('#/hot-water')).toEqual({ name: 'drink', drink: 'hotWater' });
    expect(parseRoute('#/Flush/')).toEqual({ name: 'drink', drink: 'flush' });
    expect(parseRoute('#/hotWater')).toEqual({ name: 'coach' });
    expect(parseRoute('#/steam/extra')).toEqual({ name: 'coach' });
  });
```

In `describe('routeHref', …)` add `{ name: 'drink', drink: 'steam' }`, `{ name: 'drink', drink: 'hotWater' }` and `{ name: 'drink', drink: 'flush' }` to the round-trip list, and this test:

```ts
  it("builds a drink's link", () => {
    expect(routeHref({ name: 'drink', drink: 'hotWater' })).toBe('#/hot-water');
  });
```

In `describe('sameRoute', …)` add:

```ts
  it('compares drinks by drink', () => {
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'drink', drink: 'steam' })).toBe(true);
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'drink', drink: 'flush' })).toBe(false);
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'shot' })).toBe(false);
  });
```

And a new block at the end:

```ts
describe('isRemembered', () => {
  it("remembers every place but a drink's view", () => {
    expect(isRemembered({ name: 'coach' })).toBe(true);
    expect(isRemembered({ name: 'shot' })).toBe(true);
    expect(isRemembered({ name: 'history', bagId: 'b' })).toBe(true);
    expect(isRemembered({ name: 'settings' })).toBe(true);
    expect(isRemembered({ name: 'drink', drink: 'steam' })).toBe(false);
  });
});
```

Change the import line to `import { isRemembered, parseRoute, routeHref, sameRoute, type Route } from './router.ts';`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/drinks/kinds.test.ts src/ui/router.test.ts`
Expected: FAIL (kinds.ts missing; drink routes parse as the coach; `isRemembered` not exported).

- [ ] **Step 3: Write `src/ui/drinks/kinds.ts`**

```ts
/**
 * The drinks besides espresso that the machine row starts, Steam, Flush and
 * Hot water, and the machine states each one runs in (Decaid's names,
 * src/api/machineStates.ts). steamRinse follows steam (Decaid: "Cleaning
 * steam wand"), so it is part of steam's run, as Stop already sits in Steam's
 * place for it (MachineRow.tsx). An air purge, cleaning and descaling are no
 * drink: they have no view of their own.
 */
export type DrinkKind = 'steam' | 'hotWater' | 'flush';

/** In the machine row's order. */
export const DRINK_KINDS: readonly DrinkKind[] = ['steam', 'flush', 'hotWater'];

/** The drink a machine state belongs to, or null for anything else. */
export function drinkOfState(state: string | null | undefined): DrinkKind | null {
  switch (state) {
    case 'steam':
    case 'steamRinse':
      return 'steam';
    case 'hotWater':
      return 'hotWater';
    case 'flush':
      return 'flush';
    default:
      return null;
  }
}
```

- [ ] **Step 4: Change `src/ui/router.ts`**

Replace the `Route` type and `COACH` constant with:

```ts
import type { DrinkKind } from './drinks/kinds.ts';

export type Route =
  | { name: 'coach' }
  | { name: 'history'; bagId?: string }
  | { name: 'settings' }
  | { name: 'shot' }
  /** A drink's view while it runs: the app's to open (useDrinkFocus.ts), never a place in the navigation. */
  | { name: 'drink'; drink: DrinkKind };

export type RouteName = Route['name'];

const COACH: Route = { name: 'coach' };

/** Each drink's view by its path: `#/steam`, `#/hot-water`, `#/flush`. */
const DRINK_PATHS: Readonly<Record<DrinkKind, string>> = { steam: 'steam', hotWater: 'hot-water', flush: 'flush' };
const DRINK_OF_PATH: ReadonlyMap<string, DrinkKind> = new Map(
  (Object.keys(DRINK_PATHS) as DrinkKind[]).map((drink) => [DRINK_PATHS[drink], drink]),
);
```

In `parseRoute`, inside `if (segments.length === 1) {`, before `return COACH;`:

```ts
    const drink = DRINK_OF_PATH.get(screen);
    if (drink) return { name: 'drink', drink };
```

In `routeHref`'s switch add:

```ts
    case 'drink':
      return `#/${DRINK_PATHS[route.drink]}`;
```

In `sameRoute`, before the last return:

```ts
  if (a.name === 'drink' && b.name === 'drink') return a.drink === b.drink;
```

After `sameRoute` add:

```ts
/**
 * Whether the app may reopen on this route after Decaid reloads it (App.tsx
 * remembers the last route): not a drink's view, which belongs to a run that
 * is over by then. A reload opens the screen under it instead.
 */
export function isRemembered(route: Route): boolean {
  return route.name !== 'drink';
}
```

- [ ] **Step 5: Change `src/app/App.tsx`**

Import `isRemembered` with the router's other names, and make `rememberRoute` start with:

```ts
function rememberRoute(route: Route): void {
  if (!isRemembered(route)) return;
```

Change the comment in `Routed`'s `else` branch to:

```ts
    // The coach, the shot and the drinks' routes alike: the shell lays the
    // Shot view or a drink's view over the coach, and the same element in the
    // same place keeps the coach mounted across the switch, scroll and draft intact.
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run src/ui/drinks/kinds.test.ts src/ui/router.test.ts src/ui/router.dom.test.tsx > .verify/t1.log 2>&1; echo exit=$?` then `npx tsc -p tsconfig.json --noEmit > .verify/t1-tsc.log 2>&1; echo exit=$?`
Expected: exit=0 for both. (`AppShell.tsx` compiles: a `drink` route matches no nav item, so nothing is current on it.)

- [ ] **Step 7: Commit**

```bash
git add src/ui/drinks/kinds.ts src/ui/drinks/kinds.test.ts src/ui/router.ts src/ui/router.test.ts src/app/App.tsx
git commit -m "feat: routes for the steam, hot water and flush views, never remembered across a reload (D146)"
```

---

### Task 2: The dial's water and milk colours

**Files:**
- Modify: `src/ui/palette.ts:75-104, 167-197`, `src/ui/palette.test.ts:87-123`, `src/ui/theme.ts:21-27, 86`, `src/ui/theme.test.ts:24`

- [ ] **Step 1: Write the failing tests**

In `src/ui/palette.test.ts`, add to `PAIRS` after the `'graph series on background and surface'` entry:

```ts
  // The steam, hot water and flush dial (D149): its number in ink and its
  // "of" line in ink-muted sit over the water and the milk inside the ring.
  ['ink on the dial’s water and milk', 7, (p) => [[p.ink, p.waterWash], [p.ink, p.milkWash]]],
  ['inkMuted on the dial’s water and milk', 4.5, (p) => [[p.inkMuted, p.waterWash], [p.inkMuted, p.milkWash]]],
```

Add to `describe('buildPalette', …)`:

```ts
  it('washes the flow blue and the ink over the page for the dial', () => {
    const dark = buildPalette('dark', namedTint('crema'));
    expect(dark.waterWash).toBe(blend(dark.graph.flow, dark.background, 0.22));
    expect(dark.milkWash).toBe(blend(dark.ink, dark.background, 0.09));
    const light = buildPalette('light', namedTint('crema'));
    expect(light.waterWash).toBe(blend(light.graph.flow, light.background, 0.16));
  });
```

(import `blend` from `./color.ts` alongside `contrastRatio`).

In `src/ui/theme.test.ts:24` change the expectation to:

```ts
    expect(t.palette.cafai).toEqual({ raised: p.raised, accentSoft: p.accentSoft, live: p.live, graph: p.graph, waterWash: p.waterWash, milkWash: p.milkWash });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/palette.test.ts src/ui/theme.test.ts`
Expected: FAIL (`waterWash` undefined).

- [ ] **Step 3: Add the roles**

In `src/ui/palette.ts`, in `interface Palette` after `live`:

```ts
  /** The water inside the steam, hot water and flush dial: the flow's blue washed over the page (D149). */
  waterWash: string;
  /** The milk inside the steam dial: the ink washed over the page. */
  milkWash: string;
```

In `buildPalette`, before `return {`, add `const flow = fixed('flow');`, then in the returned object after `live: fixed('live'),`:

```ts
    waterWash: blend(flow, background, dark ? 0.22 : 0.16),
    milkWash: blend(ink, background, 0.09),
```

and in `graph` use `flow,` instead of `flow: fixed('flow'),`.

In `src/ui/theme.ts`, `interface CafaiColors` gains:

```ts
  /** The dial's water and milk (DrinkDial.tsx). */
  waterWash: string;
  milkWash: string;
```

and line 86 becomes:

```ts
      cafai: { raised: palette.raised, accentSoft: palette.accentSoft, live: palette.live, graph: palette.graph, waterWash: palette.waterWash, milkWash: palette.milkWash },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/palette.test.ts src/ui/theme.test.ts src/ui/AppTheme.test.tsx > .verify/t2.log 2>&1; echo exit=$?`
Expected: exit=0. If a contrast pair fails at some hue, raise `0.16` in light mode or lower `0.22` in dark mode until the sweep passes, and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/ui/palette.ts src/ui/palette.test.ts src/ui/theme.ts src/ui/theme.test.ts
git commit -m "feat: the dial's water and milk colours, checked in every tint (D149)"
```

---

### Task 3: The drinks' recording

**Files:**
- Create: `src/ui/drinks/drinkTrace.ts`, `src/ui/drinks/drinkTrace.test.ts`

- [ ] **Step 1: Write the failing test**

`src/ui/drinks/drinkTrace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame, TelemetryState } from '../../api/types.ts';
import { createFakeTelemetry, IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { createDrinkTrace, drinkTraceFor, MAX_FRAMES, type DrinkRunEvent } from './drinkTrace.ts';

const T0 = new Date(2026, 9, 13, 8, 0, 0).getTime();

/** A machine frame `s` seconds after T0, a new object every time, as telemetry makes them. */
function frame(s: number, state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame {
  return { ...IDLE_TELEMETRY.machine!, timestamp: formatLocalTimestamp(T0 + s * 1000), state: { state, substate }, flow: 0, pressure: 0, ...values };
}

function recording(initial: Partial<TelemetryState> = {}) {
  const telemetry = createFakeTelemetry(initial);
  const trace = createDrinkTrace(telemetry);
  const heard: string[] = [];
  trace.onRun((event: DrinkRunEvent) => heard.push(`${event.type}:${event.run.kind}:${event.run.id}`));
  trace.onData((run) => heard.push(`data:${run.kind}`));
  const send = (f: MachineFrame) => telemetry.setState({ machine: f });
  return { telemetry, trace, heard, send };
}

describe('createDrinkTrace', () => {
  it('starts a run at the first frame in a drink state and ends it at the first frame outside', () => {
    const { trace, heard, send } = recording();
    send(frame(0, 'idle', 'idle'));
    expect(trace.getState()).toEqual({ live: null, runId: 0 });
    send(frame(1, 'steam', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'steam', runId: 1 });
    send(frame(1.5, 'steam', 'pouring'));
    send(frame(2, 'idle', 'idle'));
    expect(trace.getState()).toEqual({ live: null, runId: 1 });
    expect(heard).toEqual(['started:steam:1', 'data:steam', 'data:steam', 'ended:steam:1']);
    const run = trace.runOf('steam')!;
    expect(run.live).toBe(false);
    expect(run.lost).toBe(false);
  });

  it('counts the time from the first frame past heating, in the machine’s own timestamps', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'preparingForShot'));
    send(frame(1, 'steam', 'preparingForShot'));
    expect(trace.runOf('steam')!.elapsedS).toBe(0);
    expect(trace.runOf('steam')!.t).toEqual([]);
    send(frame(2, 'steam', 'pouring'));
    send(frame(2.25, 'steam', 'pouring'));
    send(frame(2.5, 'steam', 'pouring'));
    const run = trace.runOf('steam')!;
    expect(run.t).toEqual([0, 0.25, 0.5]);
    expect(run.elapsedS).toBeCloseTo(0.5, 6);
  });

  it('stops the clock while steam is paused or the wand purges or rinses, and keeps the frames', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    send(frame(1, 'steam', 'pouring'));
    send(frame(2, 'steam', 'puffing'));
    send(frame(3, 'steam', 'puffing'));
    send(frame(4, 'steamRinse', 'idle'));
    const run = trace.runOf('steam')!;
    expect(run.live).toBe(true);
    expect(run.elapsedS).toBeCloseTo(2, 6);
    expect(run.t).toEqual([0, 1, 2, 3, 4]);
    expect(run.working).toEqual([true, true, false, false, false]);
  });

  it('sums the water from the flow, only while the drink works', () => {
    const { trace, send } = recording();
    send(frame(0, 'hotWater', 'preparingForShot', { flow: 3 }));
    send(frame(1, 'hotWater', 'pouring', { flow: 4 }));
    send(frame(2, 'hotWater', 'pouring', { flow: 6 }));
    send(frame(3, 'hotWater', 'pouring', { flow: 6 }));
    // (4 + 6) / 2 * 1 + (6 + 6) / 2 * 1
    expect(trace.runOf('hotWater')!.waterMl).toBeCloseTo(11, 6);
  });

  it('never sums a negative flow into the water', () => {
    const { trace, send } = recording();
    send(frame(0, 'flush', 'pouring', { flow: -0.4 }));
    send(frame(1, 'flush', 'pouring', { flow: -0.2 }));
    expect(trace.runOf('flush')!.waterMl).toBe(0);
  });

  it('keeps the series and the scale reading with each frame', () => {
    const { telemetry, trace, send } = recording();
    telemetry.setState({ scale: { timestamp: '', weight: 12.5, weightFlow: 2, battery: null, timerValue: null } });
    send(frame(0, 'hotWater', 'pouring', { flow: 5, pressure: 0.4, steamTemperature: 150, groupTemperature: 91 }));
    const run = trace.runOf('hotWater')!;
    expect(run.flow).toEqual([5]);
    expect(run.pressure).toEqual([0.4]);
    expect(run.steamTemperature).toEqual([150]);
    expect(run.groupTemperature).toEqual([91]);
    expect(run.weight).toEqual([12.5]);
  });

  it('records no weight without a scale', () => {
    const { trace, send } = recording({ scaleConnected: false });
    send(frame(0, 'hotWater', 'pouring', { flow: 5 }));
    expect(trace.runOf('hotWater')!.weight).toEqual([null]);
  });

  it('leaves out a frame older than the last, but still shows it as the newest frame', () => {
    const { trace, send } = recording();
    send(frame(1, 'flush', 'pouring', { flow: 6 }));
    send(frame(2, 'flush', 'pouring', { flow: 6 }));
    const late = frame(1.5, 'flush', 'pouring', { flow: 6 });
    send(late);
    const run = trace.runOf('flush')!;
    expect(run.t).toEqual([0, 1]);
    expect(run.latest).toBe(late);
  });

  it('ends a run as lost when the machine goes away, and ignores the stale frame afterwards', () => {
    const { telemetry, trace, heard, send } = recording();
    send(frame(0, 'hotWater', 'pouring'));
    telemetry.setState({ machineConnected: false });
    expect(trace.getState().live).toBeNull();
    expect(trace.runOf('hotWater')!.lost).toBe(true);
    telemetry.setState({ machineConnected: true });
    expect(trace.getState().live).toBeNull();
    expect(heard.filter((h) => h.startsWith('started'))).toEqual(['started:hotWater:1']);
  });

  it('starts a new run for another drink, or the same drink again, and keeps the last run of each', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    send(frame(1, 'flush', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'flush', runId: 2 });
    expect(trace.runOf('steam')!.live).toBe(false);
    send(frame(2, 'idle', 'idle'));
    send(frame(3, 'steam', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'steam', runId: 3 });
    expect(trace.runOf('steam')!.id).toBe(3);
    expect(trace.runOf('flush')!.id).toBe(2);
    expect(trace.runOf('hotWater')).toBeNull();
  });

  it('picks up a run already under way when it starts recording', () => {
    const { trace } = recording({ machine: frame(0, 'steam', 'pouring') });
    expect(trace.getState()).toEqual({ live: 'steam', runId: 1 });
  });

  it('returns the same state object until a run starts or ends', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    const live = trace.getState();
    send(frame(1, 'steam', 'pouring'));
    expect(trace.getState()).toBe(live);
  });

  it('keeps counting past MAX_FRAMES but stops growing its arrays', () => {
    const { trace, send } = recording();
    for (let i = 0; i <= MAX_FRAMES + 5; i += 1) send(frame(i * 0.1, 'flush', 'pouring', { flow: 1 }));
    const run = trace.runOf('flush')!;
    expect(run.t.length).toBe(MAX_FRAMES);
    expect(run.elapsedS).toBeCloseTo((MAX_FRAMES + 5) * 0.1, 3);
  });

  it('tells an unsubscribed listener nothing', () => {
    const telemetry = createFakeTelemetry();
    const trace = createDrinkTrace(telemetry);
    const heard: string[] = [];
    const a = trace.onRun(() => heard.push('run'));
    const b = trace.onData(() => heard.push('data'));
    const c = trace.subscribe(() => heard.push('state'));
    a();
    b();
    c();
    telemetry.setState({ machine: frame(0, 'steam', 'pouring') });
    expect(heard).toEqual([]);
  });
});

describe('drinkTraceFor', () => {
  it('keeps one recording per telemetry store', () => {
    const one = createFakeTelemetry();
    const trace = drinkTraceFor(one);
    expect(drinkTraceFor(one)).toBe(trace);
    expect(drinkTraceFor(createFakeTelemetry())).not.toBe(trace);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/drinks/drinkTrace.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/ui/drinks/drinkTrace.ts`**

```ts
/**
 * Steam, hot water and flush, recorded once for the whole app, as
 * shotTrace.ts records a shot: every drink's view draws from the same run, so
 * a view opened mid-run has it from its first frame (D148).
 *
 * A run starts at the first machine frame in one of a drink's states
 * (kinds.ts) and ends at the first frame in any other state, or when the
 * machine goes away. The drink's time counts only while it does its work:
 * not while the heater still warms (preparingForShot), nor while steam is
 * paused or the wand purges or rinses (pausedSteam, puffing, steamRinse). It
 * runs on the machine's own frame timestamps, as the shot timer does, from the
 * first frame past heating. Its water is the flow summed over the same time.
 * A frame older than the last is left out, as the shot graph leaves it out.
 *
 * Frames never touch React state: views hear of each (onData) and draw it
 * themselves. React hears only of a run starting and ending (subscribe). The
 * last run of each drink stays for the session, so a drink's view opened
 * later shows it.
 */
import { parseDecaidTimestamp } from '../../api/time.ts';
import type { MachineFrame, TelemetryStore } from '../../api/types.ts';
import { drinkOfState, type DrinkKind } from './kinds.ts';

/** The heater is still warming: the drink has not begun. */
const HEATING = 'preparingForShot';
/** Substates in which the drink does not do its work: warming, steam paused, the wand's purge. */
const RESTING_SUBSTATES: ReadonlySet<string> = new Set([HEATING, 'pausedSteam', 'puffing']);
/** A quarter of an hour at ten frames a second; a run longer than that keeps its sums, not its frames. */
export const MAX_FRAMES = 9000;

export interface DrinkRun {
  readonly kind: DrinkKind;
  /** 1 for the app's first run, counting up, so a view can tell a new run from the one it drew. */
  readonly id: number;
  /** True until the run ends. */
  readonly live: boolean;
  /** The run ended because the machine went away. */
  readonly lost: boolean;
  /** Seconds from the drink's first working frame, one per frame recorded from then on. */
  readonly t: readonly number[];
  readonly flow: readonly (number | null)[];
  readonly pressure: readonly (number | null)[];
  readonly steamTemperature: readonly (number | null)[];
  readonly groupTemperature: readonly (number | null)[];
  /** What the scale read at each frame; null without a reading. */
  readonly weight: readonly (number | null)[];
  /** Whether the drink did its work at each frame (its time counted after it). */
  readonly working: readonly boolean[];
  /** The run's newest frame, heating included. */
  readonly latest: MachineFrame | null;
  /** Seconds the drink has done its work; fixed once the run ends. */
  readonly elapsedS: number;
  /** Millilitres the machine has measured through, its flow summed over the working time. */
  readonly waterMl: number;
}

export interface DrinkTraceState {
  /** The drink running now, or null. */
  readonly live: DrinkKind | null;
  /** The newest run's id, 0 before the first. */
  readonly runId: number;
}

export interface DrinkRunEvent {
  type: 'started' | 'ended';
  run: DrinkRun;
}

export interface DrinkTrace {
  /** The same object until a run starts or ends, as useSyncExternalStore needs. */
  getState(): DrinkTraceState;
  subscribe(listener: () => void): () => void;
  /** Told when a run starts and when it ends. */
  onRun(listener: (event: DrinkRunEvent) => void): () => void;
  /** Told on every frame recorded into the live run. */
  onData(listener: (run: DrinkRun) => void): () => void;
  /** The live run of `kind`, or its last one this session, or null. */
  runOf(kind: DrinkKind): DrinkRun | null;
}

interface Recording {
  kind: DrinkKind;
  id: number;
  live: boolean;
  lost: boolean;
  t: number[];
  flow: (number | null)[];
  pressure: (number | null)[];
  steamTemperature: (number | null)[];
  groupTemperature: (number | null)[];
  weight: (number | null)[];
  working: boolean[];
  latest: MachineFrame | null;
  elapsedS: number;
  waterMl: number;
  /** Machine time (epoch ms) of the first working frame, or null while the heater warms. */
  startAt: number | null;
  /** Machine time of the last frame recorded, whether the drink worked then, and its flow. */
  lastAt: number | null;
  lastWorking: boolean;
  lastFlow: number | null;
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One broken view must not stop the others for the rest of the run. */
function callSafely(listener: () => void): void {
  try {
    listener();
  } catch {
    // As the telemetry store's own listeners: the next frame tries again.
  }
}

function newRecording(kind: DrinkKind, id: number): Recording {
  return {
    kind,
    id,
    live: true,
    lost: false,
    t: [],
    flow: [],
    pressure: [],
    steamTemperature: [],
    groupTemperature: [],
    weight: [],
    working: [],
    latest: null,
    elapsedS: 0,
    waterMl: 0,
    startAt: null,
    lastAt: null,
    lastWorking: false,
    lastFlow: null,
  };
}

/** Adds a frame to a run; false when it changed nothing a view draws (a late frame). */
function record(run: Recording, frame: MachineFrame, weight: number | null): boolean {
  run.latest = frame;
  const at = parseDecaidTimestamp(frame.timestamp);
  if (!Number.isFinite(at)) return true;
  const substate = frame.state.substate;
  if (run.startAt === null) {
    // Nothing to count while the heater warms; the first frame past it is the drink's time zero.
    if (substate === HEATING) return true;
    run.startAt = at;
  } else if (run.lastAt !== null && at <= run.lastAt) {
    // A late frame would be drawn backwards; the newest frame still says what the machine does.
    return true;
  }
  const working = frame.state.state !== 'steamRinse' && !RESTING_SUBSTATES.has(substate);
  const flow = finite(frame.flow);
  if (run.lastAt !== null && run.lastWorking) {
    const seconds = (at - run.lastAt) / 1000;
    run.elapsedS += seconds;
    if (flow !== null && run.lastFlow !== null) run.waterMl += Math.max(0, ((flow + run.lastFlow) / 2) * seconds);
  }
  run.lastAt = at;
  run.lastWorking = working;
  run.lastFlow = working ? flow : null;
  if (run.t.length < MAX_FRAMES) {
    run.t.push((at - run.startAt) / 1000);
    run.flow.push(flow);
    run.pressure.push(finite(frame.pressure));
    run.steamTemperature.push(finite(frame.steamTemperature));
    run.groupTemperature.push(finite(frame.groupTemperature));
    run.weight.push(weight);
    run.working.push(working);
  }
  return true;
}

export function createDrinkTrace(telemetry: TelemetryStore): DrinkTrace {
  let state: DrinkTraceState = { live: null, runId: 0 };
  let current: Recording | null = null;
  const lastRuns = new Map<DrinkKind, Recording>();
  let seen: MachineFrame | null = null;
  const listeners = new Set<() => void>();
  const runListeners = new Set<(event: DrinkRunEvent) => void>();
  const dataListeners = new Set<(run: DrinkRun) => void>();

  const setState = (next: DrinkTraceState) => {
    state = next;
    for (const listener of [...listeners]) callSafely(listener);
  };
  const tellRun = (event: DrinkRunEvent) => {
    for (const listener of [...runListeners]) callSafely(() => listener(event));
  };

  function begin(kind: DrinkKind): Recording {
    const run = newRecording(kind, state.runId + 1);
    current = run;
    lastRuns.set(kind, run);
    setState({ live: kind, runId: run.id });
    tellRun({ type: 'started', run });
    return run;
  }

  function end(lost: boolean): void {
    const run = current;
    if (!run) return;
    current = null;
    run.live = false;
    run.lost = lost;
    setState({ live: null, runId: state.runId });
    tellRun({ type: 'ended', run });
  }

  function take(frame: MachineFrame): void {
    const kind = drinkOfState(frame.state?.state);
    if (current && current.kind !== kind) end(false);
    if (kind === null) return;
    const run = current ?? begin(kind);
    const now = telemetry.getState();
    const weight = now.scaleConnected ? finite(now.scale?.weight) : null;
    if (record(run, frame, weight)) for (const listener of [...dataListeners]) callSafely(() => listener(run));
  }

  function check(): void {
    const now = telemetry.getState();
    if (!now.machineConnected) {
      // A frame left over from before the machine went away describes nothing real.
      end(true);
      seen = now.machine;
      return;
    }
    if (now.machine === null || now.machine === seen) return;
    seen = now.machine;
    take(now.machine);
  }

  check();
  telemetry.subscribe(check);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onRun(listener) {
      runListeners.add(listener);
      return () => void runListeners.delete(listener);
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => void dataListeners.delete(listener);
    },
    runOf: (kind) => (current?.kind === kind ? current : (lastRuns.get(kind) ?? null)),
  };
}

const traces = new WeakMap<TelemetryStore, DrinkTrace>();

/** The app's one recording for a telemetry store, recording from its first use for as long as the store lives. */
export function drinkTraceFor(telemetry: TelemetryStore): DrinkTrace {
  let trace = traces.get(telemetry);
  if (!trace) {
    trace = createDrinkTrace(telemetry);
    traces.set(telemetry, trace);
  }
  return trace;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/ui/drinks/drinkTrace.test.ts > .verify/t3.log 2>&1; echo exit=$?`
Expected: exit=0, every test passing. (`end(true)` with no live run does nothing, so the disconnected case and the "already under way" case hold.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/drinks/drinkTrace.ts src/ui/drinks/drinkTrace.test.ts
git commit -m "feat: one recording of steam, hot water and flush runs for the whole app, its time and water counted on the machine's clock (D148)"
```

---

### Task 4: The stepper, shared by Settings and the drinks' views

**Files:**
- Create: `src/ui/settings/DrinkFields.tsx`, `src/ui/settings/useDrinkPresets.ts`, `src/ui/settings/DrinkFields.test.tsx`
- Modify: `src/ui/settings/DrinkSettingsSection.tsx` (shrinks to the section around them)
- Test (must stay green, unchanged): `src/ui/settings/DrinkSettingsSection.test.tsx`

This is a move, not a rewrite: the stepper's code, its comments and the write logic move as they are. Two things change: the stepper's arrangement comes from a `layout` prop (`'responsive'`, Settings' existing breakpoint behaviour, stays the default) and a drink's fields can render without the Settings heading.

- [ ] **Step 1: Write the failing test**

`src/ui/settings/DrinkFields.test.tsx`:

```tsx
// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { DrinkFieldsGrid, drinksFor, PRESET_KEY } from './DrinkFields.tsx';

const steam = drinksFor(null).find((drink) => drink.key === PRESET_KEY.steam)!;

function renderGrid(layout: 'responsive' | 'rows' | 'columns', disabled = false) {
  const onCommit = vi.fn();
  renderWithServices(
    <DrinkFieldsGrid
      drink={steam}
      data={SAMPLE_WORKFLOW.steamSettings}
      loaded
      disabled={disabled}
      pending={{}}
      failed={{}}
      onCommit={onCommit}
      layout={layout}
    />,
  );
  return { onCommit };
}

describe('DrinkFieldsGrid', () => {
  it('maps each drink to its preset', () => {
    expect(PRESET_KEY).toEqual({ steam: 'steamSettings', hotWater: 'hotWaterData', flush: 'rinseData' });
  });

  for (const layout of ['responsive', 'rows', 'columns'] as const) {
    it(`draws the drink's steppers in ${layout}, each named for its drink`, async () => {
      const { onCommit } = renderGrid(layout);
      expect(screen.getByRole('spinbutton', { name: 'Steam temperature' })).toHaveValue('150');
      expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toHaveValue('50');
      expect(screen.getByRole('spinbutton', { name: 'Steam flow' })).toHaveValue('0.8');
      await userEvent.click(screen.getByRole('button', { name: 'More steam time' }));
      expect(onCommit).toHaveBeenCalledWith(steam, steam.fields[1], 55);
    });
  }

  it('holds every stepper when disabled, its value still showing', () => {
    renderGrid('columns', true);
    expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Steam time' })).toHaveValue('50');
    expect(screen.getByRole('button', { name: 'More steam time' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/settings/DrinkFields.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/ui/settings/DrinkFields.tsx`**

Move from `DrinkSettingsSection.tsx`, verbatim with their comments: the imports they need; `UNREADABLE`, `SAVING`, `SAVING_AFTER_MS`; `PresetKey`, `Presets`, `Drink`, `drinksFor`, `fieldValue`, `withField`, `valueWidth`, `fieldId`, `useHeldFor`, `fieldsSx`, `fieldSx`, `noteSx`, `labelSx`, `stepperSx`, `DrinkFieldProps`, `DrinkField`. Export `PresetKey`, `Presets`, `Drink`, `drinksFor`, `fieldValue`, `withField`, `fieldId`, `DrinkField`. Then make these changes:

1. Add, after `drinksFor`:

```tsx
/** Each drink's preset on Decaid's workflow. */
export const PRESET_KEY: Readonly<Record<DrinkKind, PresetKey>> = { steam: 'steamSettings', hotWater: 'hotWaterData', flush: 'rinseData' };

/**
 * How a drink's settings sit: 'responsive' as Settings has them (one row per
 * setting on a phone, the label over the stepper from 600 px), 'rows' always
 * one row per setting, 'columns' side by side, each label over its stepper. A
 * drink's view picks by its own width (DrinkView.tsx), not the window's.
 */
export type DrinkFieldsLayout = 'responsive' | 'rows' | 'columns';
```

(import `type DrinkKind` from `'../drinks/kinds.ts'`).

2. Replace `fieldsSx`, `fieldSx` and `labelSx` with functions of the layout (the `'responsive'` values are exactly today's):

```tsx
/** The grid a drink's settings share: one row per setting, or side by side. */
function fieldsSx(layout: DrinkFieldsLayout, count: number): SxProps<Theme> {
  const rows = {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 184px)',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 2,
    rowGap: 1,
  } as const;
  if (layout === 'rows') return rows;
  if (layout === 'columns') return { display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, alignItems: 'start', columnGap: 2, rowGap: 1.5 };
  return {
    display: 'grid',
    gridTemplateColumns: { xs: 'max-content minmax(0, 184px)', sm: 'minmax(0, 1fr)' },
    justifyContent: { xs: 'space-between', sm: 'stretch' },
    alignItems: 'center',
    columnGap: 2,
    rowGap: { xs: 1, sm: 1.5 },
  };
}

/** One setting: in a row its label, stepper and note join the grid; stacked, a column of its own. */
function fieldSx(layout: DrinkFieldsLayout): SxProps<Theme> {
  if (layout === 'rows') return { display: 'contents' };
  if (layout === 'columns') return { display: 'grid', rowGap: 0.75 };
  return { display: { xs: 'contents', sm: 'grid' }, rowGap: 0.75 };
}

/** A row's label, read like a list; over the stepper a muted field label, as Appearance has them. */
function labelSx(layout: DrinkFieldsLayout): SxProps<Theme> {
  return (theme) => {
    const row = { ...theme.typography.body2, color: theme.palette.text.primary };
    const stacked = { ...theme.typography.label, color: theme.palette.text.secondary };
    if (layout === 'rows') return row;
    if (layout === 'columns') return stacked;
    return { ...row, [theme.breakpoints.up('sm')]: stacked };
  };
}
```

3. `DrinkFieldProps` gains `layout: DrinkFieldsLayout;`, `DrinkField` takes it, and uses `sx={fieldSx(layout)}` on its outer Box and `sx={labelSx(layout)}` on its label.

4. Add the fields without a heading, which `DrinkGroup` (Settings) and the drink's view both use:

```tsx
export interface DrinkFieldsGridProps {
  drink: Drink;
  data: object | null;
  /** Decaid's presets are in: a dash now means Decaid sent something CafAI could not read. */
  loaded: boolean;
  disabled: boolean;
  pending: Readonly<Record<string, number>>;
  failed: Readonly<Record<string, string>>;
  onCommit(drink: Drink, spec: DrinkFieldSpec, value: number): void;
  layout?: DrinkFieldsLayout;
}

/** One drink's settings, without a heading: the caller names them. */
export function DrinkFieldsGrid({ drink, data, loaded, disabled, pending, failed, onCommit, layout = 'responsive' }: DrinkFieldsGridProps) {
  return (
    <Box sx={fieldsSx(layout, drink.fields.length)}>
      {drink.fields.map((spec) => {
        const id = fieldId(drink.key, spec.key);
        return (
          <DrinkField
            key={spec.key}
            spec={spec}
            value={fieldValue(data, spec.key)}
            loaded={loaded}
            disabled={disabled}
            saving={(pending[id] ?? 0) > 0}
            error={failed[id] ?? null}
            layout={layout}
            onCommit={(value) => onCommit(drink, spec, value)}
          />
        );
      })}
    </Box>
  );
}
```

Update the file's top comment to say what it holds: "The stepper of Settings > Steam, hot water and flush and a drink's set of them (D124), shared with each drink's view (D147). How they read and write is useDrinkPresets.ts; the ranges and steps are drinkSettings.ts." Keep the paragraph about the stepper (spin button, Less and More out of the tab order, "Saving…") from the section's old comment.

- [ ] **Step 4: Create `src/ui/settings/useDrinkPresets.ts`**

Move `DrinkSettingsSection`'s state, effects and `write`/`commit` here, verbatim with their comments, returning:

```ts
/** Why every field is held now, or null when they can be changed. */
export type DrinkSettingsReason = 'notConnected' | 'running' | 'reading' | null;

export interface DrinkPresetsState {
  /** The machine's model, which decides steam temperature's ceiling (DE1 160, Bengle 165); null until known. */
  model: string | null;
  /** Decaid's three presets as last read or written; null until Decaid answers. */
  presets: Presets | null;
  loaded: boolean;
  /** Why reading the presets failed, until a Retry reads them. */
  loadError: string | null;
  retry(): void;
  /** Writes still on their way and why a field's last write failed, by fieldId. */
  pending: Readonly<Record<string, number>>;
  failed: Readonly<Record<string, string>>;
  /** Every field held: no machine, the machine running (D114), or the presets not in yet. */
  disabled: boolean;
  /** One reason at a time: without a machine, what it runs says nothing. */
  reason: DrinkSettingsReason;
  /** Sends a value the barista chose, unless the machine has started, or gone, since the tap. */
  commit(drink: Drink, spec: DrinkFieldSpec, value: number): void;
}

export function useDrinkPresets(): DrinkPresetsState {
  // … the moved body, unchanged, with:
  //   retry: () => setReads((count) => count + 1)
  //   reason: !connected ? 'notConnected' : blocked ? 'running' : !loaded && loadError === null ? 'reading' : null
  // and `errorText` moved here with it.
}
```

Its top comment: "Decaid's drink presets (the workflow's steamSettings, hotWaterData and rinseData) for one screen: read once on mount (and by Retry), written one field at a time with PUT /api/v1/workflow, never while the machine runs or no machine is connected (D114: the machine is using them then; Decaid refuses them without a DE1). Settings > Steam, hot water and flush and each drink's view use it." followed by the write paragraph moved from the section's comment ("A blur, a stepper tap or an arrow key only ever writes a value the user actually chose…", "A write still on its way after 0.4 s says "Saving…"…").

- [ ] **Step 5: Shrink `src/ui/settings/DrinkSettingsSection.tsx`**

It keeps its top comment (trimmed to the section: the line, the groups, the layout by drink), `HELP`, `NOT_WHILE_RUNNING`, `NOT_CONNECTED`, `READING`, `mutedSx`, `DrinkGroup` (heading plus `<DrinkFieldsGrid … />` with the default layout), `groupsSx`, `lineSx`, and becomes:

```tsx
const REASON_WORDS: Record<NonNullable<DrinkSettingsReason>, string> = {
  notConnected: NOT_CONNECTED,
  running: NOT_WHILE_RUNNING,
  reading: READING,
};

export function DrinkSettingsSection() {
  const drinks = useDrinkPresets();
  const reason = drinks.reason === null ? null : REASON_WORDS[drinks.reason];
  return (
    <Section title="Steam, hot water and flush">
      <Stack spacing={2} data-testid={TID.drinkSettings}>
        <Box sx={lineSx}>
          <Typography variant="body2" role="status" sx={mutedSx}>
            {reason}
          </Typography>
          {reason === null ? (
            <Typography variant="body2" sx={mutedSx}>
              {HELP}
            </Typography>
          ) : null}
        </Box>
        {drinks.loadError ? (
          <Alert
            severity="error"
            sx={{ alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
            action={
              <Button color="inherit" onClick={drinks.retry} sx={{ minHeight: 48 }}>
                Retry
              </Button>
            }
          >
            {drinks.loadError}
          </Alert>
        ) : null}
        <Box sx={groupsSx}>
          {drinksFor(drinks.model).map((drink) => (
            <DrinkGroup
              key={drink.key}
              drink={drink}
              data={drinks.presets?.[drink.key] ?? null}
              loaded={drinks.loaded}
              disabled={drinks.disabled}
              pending={drinks.pending}
              failed={drinks.failed}
              onCommit={drinks.commit}
            />
          ))}
        </Box>
      </Stack>
    </Section>
  );
}
```

`DrinkGroup`:

```tsx
/** One drink: the machine row's icon and its name, then its settings. A group, named by its heading. */
function DrinkGroup(props: DrinkFieldsGridProps) {
  const headingId = useId();
  return (
    <Box role="group" aria-labelledby={headingId}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary' }}>
        {props.drink.icon}
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ color: 'text.primary' }}>
          {props.drink.name}
        </Typography>
      </Box>
      <DrinkFieldsGrid {...props} />
    </Box>
  );
}
```

- [ ] **Step 6: Run the section's tests and the new ones**

Run: `npx vitest run src/ui/settings > .verify/t4.log 2>&1; echo exit=$?`
Expected: exit=0. `DrinkSettingsSection.test.tsx` passes without a change: if it does not, the move changed behaviour; fix the move, not the test.
Then: `npx tsc -p tsconfig.json --noEmit > .verify/t4-tsc.log 2>&1; echo exit=$?` and `npx eslint src/ui/settings > .verify/t4-lint.log 2>&1; echo exit=$?`, both exit=0.

- [ ] **Step 7: Commit**

```bash
git add src/ui/settings/DrinkFields.tsx src/ui/settings/DrinkFields.test.tsx src/ui/settings/useDrinkPresets.ts src/ui/settings/DrinkSettingsSection.tsx
git commit -m "refactor: the drink stepper and its reads and writes move out of Settings, for the drinks' views to share, its arrangement given by its parent (D147)"
```

---

### Task 5: The mock steams, pours and flushes for their real time

**Files:**
- Modify: `mock/decaid/shotPlayer.ts:979-1029` (activities), `mock/decaid/shotPlayer.test.ts:521-532`, `mock/decaid/state.ts` (`updateWorkflow`, near line 846), `mock/decaid/state.test.ts`

- [ ] **Step 0: The machine's shot settings follow the workflow, as Decaid's DE1 write makes them**

Decaid writes a changed steam or hot water preset to the DE1's ShotSettings at once (`de1_controller.dart` `_writeSteamSettings` / `_writeHotWaterSettings`, D114), and the machine's `ws/v1/machine/shotSettings` channel then says so. The mock's channel never changes today, so after a PUT the drinks' views (which read their targets from it, D148) would show the old time. Add to `mock/decaid/state.test.ts`:

```ts
describe('the shot settings follow the workflow', () => {
  it("a steam or hot water change reaches the machine's shot settings, and its channel", () => {
    const state = createMockDecaid({ seedExamples: false });
    const heard: unknown[] = [];
    state.on('shotSettings', (settings) => heard.push(settings));
    state.updateWorkflow({ steamSettings: { duration: 55 }, hotWaterData: { volume: 120 } });
    expect(state.getShotSettings()).toMatchObject({ targetSteamDuration: 55, targetHotWaterVolume: 120, targetSteamTemp: 150 });
    expect(heard).toHaveLength(1);
  });

  it('steam below 135 °C reaches the machine as 0, steam off', () => {
    const state = createMockDecaid({ seedExamples: false });
    state.updateWorkflow({ steamSettings: { targetTemperature: 0 } });
    expect(state.getShotSettings().targetSteamTemp).toBe(0);
  });

  it('a change to anything else sends nothing', () => {
    const state = createMockDecaid({ seedExamples: false });
    const heard: unknown[] = [];
    state.on('shotSettings', (settings) => heard.push(settings));
    state.updateWorkflow({ rinseData: { duration: 12 } });
    expect(heard).toEqual([]);
  });
});
```

(use the file's existing imports; add `createMockDecaid` if it is not imported). In `mock/decaid/state.ts`, inside `createMockDecaid`, next to `let shotSettings = fixtures.shotSettings();`, add:

```ts
  /**
   * Decaid writes a changed steam or hot water preset to the DE1's shot
   * settings at once (de1_controller.dart _writeSteamSettings,
   * _writeHotWaterSettings; steam under 135 °C goes as 0, off), and the
   * machine's shotSettings channel says so.
   */
  function shotSettingsFromWorkflow(): void {
    const steam = workflow.steamSettings;
    const water = workflow.hotWaterData;
    const steamTemp = steam.targetTemperature ?? shotSettings.targetSteamTemp;
    const next: ShotSettings = {
      ...shotSettings,
      targetSteamTemp: steamTemp < 135 ? 0 : steamTemp,
      targetSteamDuration: steam.duration ?? shotSettings.targetSteamDuration,
      targetHotWaterTemp: water.targetTemperature ?? shotSettings.targetHotWaterTemp,
      targetHotWaterVolume: water.volume ?? shotSettings.targetHotWaterVolume,
      targetHotWaterDuration: water.duration ?? shotSettings.targetHotWaterDuration,
    };
    if (JSON.stringify(next) === JSON.stringify(shotSettings)) return;
    shotSettings = next;
    if (machineConnected) emit('shotSettings', clone(shotSettings));
  }
```

and call `shotSettingsFromWorkflow();` in `updateWorkflow` right after `workflow = normalizeWorkflow(merged);` (inside the `try`). Run `npx vitest run mock/decaid/state.test.ts mock/decaid/handlers.test.ts mock/decaid/contract.test.ts`, expect exit 0 (if a handlers test counted shotSettings frames, it now sees one more after a steam or hot water PUT: correct it to expect it).

- [ ] **Step 1: Write the failing tests**

In `mock/decaid/shotPlayer.test.ts`, replace the test `'steam, flush and hot water run for a few seconds and return to idle'` with:

```ts
  /** Seconds of data time the frames in `substate` of `state` cover (each frame is FRAME_MS). */
  const secondsIn = (frames: MachineSnapshot[], state: string, substate: string) =>
    (frames.filter((f) => f.state.state === state && f.state.substate === substate).length * FRAME_MS) / 1000;
  const runsOf = (frames: MachineSnapshot[]) => {
    const runs: string[] = [];
    for (const f of frames) {
      const name = `${f.state.state}/${f.state.substate}`;
      if (runs.at(-1) !== name) runs.push(name);
    }
    return runs;
  };

  it('steam warms, steams for the steam time set, purges the wand, then rests', async () => {
    const { player, machine } = setup();
    player.command('steam');
    expect(player.activity).toBe('steam');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();
    expect(runsOf(machine)).toEqual(['steam/preparingForShot', 'steam/pouring', 'steam/puffing', 'idle/idle']);
    // The fixture's workflow: 50 s at 0.8 ml/s and 150 °C.
    expect(secondsIn(machine, 'steam', 'pouring')).toBeCloseTo(50, 0);
    const steaming = machine.filter((f) => f.state.substate === 'pouring');
    expect(Math.min(...steaming.map((f) => f.flow))).toBeGreaterThan(0.6);
    expect(Math.max(...steaming.map((f) => f.flow))).toBeLessThan(1);
    expect(Math.min(...steaming.map((f) => f.pressure))).toBeGreaterThan(1.4);
    expect(Math.max(...steaming.map((f) => f.steamTemperature))).toBeLessThanOrEqual(150);
    for (const f of steaming) expect(Number.isInteger(f.steamTemperature)).toBe(true);
  });

  it('hot water pours until the volume set, the scale weighing what it poured', async () => {
    const { player, machine, state } = setup();
    player.command('hotWater');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();
    expect(runsOf(machine)).toEqual(['hotWater/preparingForShot', 'hotWater/pouring', 'idle/idle']);
    const pouring = machine.filter((f) => f.state.substate === 'pouring');
    const water = pouring.reduce((sum, f) => sum + (f.flow * FRAME_MS) / 1000, 0);
    // The fixture's 50 ml, at the mock's 8 ml/s at most.
    expect(water).toBeGreaterThanOrEqual(50);
    expect(water).toBeLessThan(52);
    expect(Math.max(...pouring.map((f) => f.flow))).toBeCloseTo(8, 1);
    expect(state.getScaleSnapshot()!.weight).toBeGreaterThan(45);
  });

  it('hot water stops at its time limit when the volume would take longer', async () => {
    const { player, machine, state } = setup();
    state.updateWorkflow({ hotWaterData: { flow: 1, duration: 5 } });
    player.command('hotWater');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();
    expect(secondsIn(machine, 'hotWater', 'pouring')).toBeCloseTo(5, 0);
  });

  it('flush runs for the flush time set at the flow set', async () => {
    const { player, machine } = setup();
    player.command('flush');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();
    expect(runsOf(machine)).toEqual(['flush/preparingForShot', 'flush/pouring', 'idle/idle']);
    // The fixture's 10 s at 6 ml/s.
    expect(secondsIn(machine, 'flush', 'pouring')).toBeCloseTo(10, 0);
    expect(machine.filter((f) => f.state.substate === 'pouring').at(-1)!.flow).toBeCloseTo(6, 1);
  });

  it('Stop ends a drink on the next frame', async () => {
    const { player, machine } = setup();
    player.command('steam');
    await vi.advanceTimersByTimeAsync(300);
    player.command('idle');
    await vi.advanceTimersByTimeAsync(100);
    expect(player.activity).toBeNull();
    expect(machine.at(-1)!.state).toEqual({ state: 'idle', substate: 'idle' });
  });

  it('a steam rinse keeps its short run', async () => {
    const { player, machine } = setup();
    player.command('steamRinse');
    await vi.advanceTimersByTimeAsync(800);
    expect(player.activity).toBeNull();
    expect(machine.some((f) => f.state.state === 'steamRinse' && f.state.substate === 'pouring')).toBe(true);
  });
```

Import `FRAME_MS` from `./shotPlayer.ts` with the other names.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run mock/decaid/shotPlayer.test.ts`
Expected: FAIL (the activities last 20 frames, with no `puffing` and no scale).

- [ ] **Step 3: Implement the drinks in `mock/decaid/shotPlayer.ts`**

Above `createShotPlayer`, add:

```ts
/**
 * Steam, hot water and flush as a DE1 runs them (D150): a heater's warm-up
 * (preparingForShot), then the drink until the time or the volume set in the
 * workflow (re-read every frame, as Decaid writes it to the machine at once),
 * with readings shaped like the machine's own; steam ends with the wand's
 * purge (puffing). The other activities keep their short generic run.
 */
type MockDrink = 'steam' | 'hotWater' | 'flush';
const MOCK_DRINKS: ReadonlySet<MockActivity> = new Set<MockActivity>(['steam', 'hotWater', 'flush']);
/** Frames of preparingForShot before the drink's work starts. */
const DRINK_WARMUP_FRAMES: Readonly<Record<MockDrink, number>> = { steam: 2, hotWater: 2, flush: 1 };
/** The steam wand's purge after the steam, in frames. */
const STEAM_PURGE_FRAMES = 3;
/** Frames hot water takes to reach its flow, and a flush its. */
const WATER_RAMP_FRAMES = 5;
const FLUSH_RAMP_FRAMES = 3;
/** The mock pours hot water at 8 ml/s at most, whatever is set (the DE1's own ceiling is near it). */
const HOT_WATER_MAX_FLOW = 8;
/** The cup on the scale lags the water by about this much. */
const SCALE_LAG_ML = 1.5;

interface DrinkRunState {
  /** Frames since the start. */
  frame: number;
  /** Seconds of the drink's work so far. */
  workS: number;
  waterMl: number;
  purge: number;
}
```

In `createShotPlayer`, next to `let activityFrame = 0;`, add `let drinkRun: DrinkRunState = { frame: 0, workS: 0, waterMl: 0, purge: 0 };`.

Add, after `activityValues` (which stays for the generic activities):

```ts
  /** The scale weighs the hot water: tared as the water starts, the cup's weight then following the water. */
  function weighWater(waterMl: number, flow: number, at: number): void {
    const scale = state.getScaleSnapshot();
    if (!scale) return;
    state.setScaleWeight({ ...scale, timestamp: formatLocalTimestamp(at), weight: quantize(Math.max(0, waterMl - SCALE_LAG_ML), 10), weightFlow: quantize(flow, 10) });
  }

  function drinkTick(name: MockDrink): void {
    timer = null;
    if (!state.isMachineConnected()) {
      settle();
      return;
    }
    const current = state.getMachineSnapshot();
    const at = Math.max(state.clock.now(), parseDecaidTimestamp(current.timestamp) + FRAME_MS);
    const workflow = state.getWorkflow();
    const run = drinkRun;
    const dt = FRAME_MS / 1000;
    const warming = run.frame < DRINK_WARMUP_FRAMES[name];
    const k = run.frame - DRINK_WARMUP_FRAMES[name];
    let finished = activityStop;
    let substate = warming ? 'preparingForShot' : 'pouring';
    let flow = 0;
    let pressure = 0.002;
    let mix = current.mixTemperature;
    let group = current.groupTemperature;
    let steamTemperature = current.steamTemperature;
    if (name === 'hotWater' && run.frame === 0) weighWater(0, 0, at);
    if (!finished && !warming) {
      if (name === 'steam') {
        const steam = workflow.steamSettings;
        if (run.workS >= (steam.duration ?? 50) - 1e-9) {
          if (run.purge >= STEAM_PURGE_FRAMES) finished = true;
          else {
            substate = 'puffing';
            pressure = 1.2 - run.purge * 0.35;
            run.purge += 1;
          }
        } else {
          flow = (steam.flow ?? 0.8) + 0.06 * Math.sin(k * 0.9);
          pressure = 1.9 + 0.25 * Math.sin(k * 0.7) + 0.08 * Math.sin(k * 2.3);
          // The heater sags a few degrees under the draw and recovers.
          steamTemperature = Math.round((steam.targetTemperature ?? 150) - 3 + 2 * Math.sin(k / 6));
          run.workS += dt;
        }
      } else if (name === 'hotWater') {
        const water = workflow.hotWaterData;
        if (run.waterMl >= (water.volume ?? 50) || run.workS >= (water.duration ?? 30) - 1e-9) finished = true;
        else {
          flow = Math.min(water.flow ?? 10, HOT_WATER_MAX_FLOW) * Math.min(1, (k + 1) / WATER_RAMP_FRAMES);
          pressure = 0.4;
          mix = water.targetTemperature ?? 75;
          run.waterMl += flow * dt;
          run.workS += dt;
          weighWater(run.waterMl, flow, at);
        }
      } else {
        const rinse = workflow.rinseData;
        if (run.workS >= (rinse.duration ?? 10) - 1e-9) finished = true;
        else {
          flow = (rinse.flow ?? 6) * Math.min(1, (k + 1) / FLUSH_RAMP_FRAMES);
          pressure = 0.6;
          mix = rinse.targetTemperature ?? 90;
          // Water through the group brings it toward its target.
          group = group + (current.targetGroupTemperature - group) * 0.15;
          run.workS += dt;
        }
      }
    }
    if (finished) {
      substate = 'idle';
      if (name === 'steam') steamTemperature = workflow.steamSettings.targetTemperature ?? current.steamTemperature;
    }
    state.setMachineSnapshot({
      ...current,
      timestamp: formatLocalTimestamp(at),
      state: { state: finished ? 'idle' : name, substate },
      flow: quantize(flow, 4096),
      pressure: quantize(pressure, 4096),
      targetFlow: quantize(substate === 'pouring' ? flow : 0, 16),
      targetPressure: 0,
      mixTemperature: quantize(mix, 256),
      groupTemperature: quantize(group, 65536),
      steamTemperature,
    });
    state.clock.advanceTo(at + 1);
    run.frame += 1;
    if (finished) {
      settle();
      return;
    }
    timer = setTimeout(activityTick, wallDelay());
  }
```

At the top of `activityTick`, after `if (!name || name === 'espresso') return;`, add:

```ts
    if (MOCK_DRINKS.has(name)) {
      drinkTick(name as MockDrink);
      return;
    }
```

In `beginActivity`, after `activityStop = false;`, add `drinkRun = { frame: 0, workS: 0, waterMl: 0, purge: 0 };`.

- [ ] **Step 4: Run the mock's tests**

Run: `npx vitest run mock > .verify/t5.log 2>&1; echo exit=$?`
Expected: exit=0. (`mock/node.test.ts`, `persist.test.ts` and the handlers' tests still pass: only the three drinks changed.)

- [ ] **Step 5: Commit**

```bash
git add mock/decaid/shotPlayer.ts mock/decaid/shotPlayer.test.ts mock/decaid/state.ts mock/decaid/state.test.ts
git commit -m "feat: the mock steams, pours and flushes for the time or volume set, the wand purging after steam and the scale weighing hot water; its shot settings follow the workflow (D150)"
```

---

### Task 6: What a drink's view says

**Files:**
- Create: `src/ui/drinks/drinkModel.ts`, `src/ui/drinks/drinkModel.test.ts`

- [ ] **Step 1: Write the failing test**

`src/ui/drinks/drinkModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MachineFrame, ShotSettings } from '../../api/types.ts';
import { IDLE_TELEMETRY, SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import {
  dialReading,
  drinkReadouts,
  drinkTarget,
  hotWaterTimeLimit,
  phaseWords,
  steamTemperatureSet,
  traceLines,
  traceSpan,
  type DrinkPresets,
  type ReadoutInput,
} from './drinkModel.ts';
import type { DrinkRun } from './drinkTrace.ts';

const PRESETS: DrinkPresets = { steamSettings: SAMPLE_WORKFLOW.steamSettings, hotWaterData: SAMPLE_WORKFLOW.hotWaterData, rinseData: SAMPLE_WORKFLOW.rinseData };
const SHOT_SETTINGS: ShotSettings = {
  steamSetting: 0,
  targetSteamTemp: 155,
  targetSteamDuration: 45,
  targetHotWaterTemp: 80,
  targetHotWaterVolume: 120,
  targetHotWaterDuration: 40,
  targetShotVolume: 0,
  groupTemp: 93,
};
const machine = (state: string, substate: string, values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  state: { state, substate },
  ...values,
});

function run(overrides: Partial<DrinkRun> = {}): DrinkRun {
  return {
    kind: 'steam',
    id: 1,
    live: true,
    lost: false,
    t: [],
    flow: [],
    pressure: [],
    steamTemperature: [],
    groupTemperature: [],
    weight: [],
    working: [],
    latest: null,
    elapsedS: 0,
    waterMl: 0,
    ...overrides,
  };
}

describe('phaseWords', () => {
  it('says nothing without a run, Done after one, and Connection lost when the machine went away', () => {
    expect(phaseWords('steam', null, null)).toBeNull();
    expect(phaseWords('steam', run({ live: false }), null)).toBe('Done');
    expect(phaseWords('flush', run({ live: false, lost: true }), null)).toBe('Connection lost');
  });

  it('names steam’s phases', () => {
    const live = run();
    expect(phaseWords('steam', live, machine('steam', 'preparingForShot'))).toBe('Heating');
    expect(phaseWords('steam', live, machine('steam', 'pouring'))).toBe('Steaming');
    // Decaid's simulator steams in substate idle.
    expect(phaseWords('steam', live, machine('steam', 'idle'))).toBe('Steaming');
    expect(phaseWords('steam', live, machine('steam', 'pausedSteam'))).toBe('Paused');
    expect(phaseWords('steam', live, machine('steam', 'puffing'))).toBe('Purging');
    expect(phaseWords('steam', live, machine('steamRinse', 'idle'))).toBe('Rinsing the wand');
  });

  it('names hot water’s and flush’s', () => {
    expect(phaseWords('hotWater', run(), machine('hotWater', 'preparingForShot'))).toBe('Heating');
    expect(phaseWords('hotWater', run(), machine('hotWater', 'pouring'))).toBe('Pouring');
    expect(phaseWords('flush', run(), machine('flush', 'pouring'))).toBe('Flushing');
  });
});

describe('targets', () => {
  it("takes the machine's live settings first, then Decaid's workflow", () => {
    expect(drinkTarget('steam', SHOT_SETTINGS, PRESETS)).toBe(45);
    expect(drinkTarget('steam', null, PRESETS)).toBe(50);
    expect(drinkTarget('hotWater', SHOT_SETTINGS, PRESETS)).toBe(120);
    expect(drinkTarget('hotWater', null, PRESETS)).toBe(50);
    expect(drinkTarget('flush', SHOT_SETTINGS, PRESETS)).toBe(10);
    expect(hotWaterTimeLimit(SHOT_SETTINGS, PRESETS)).toBe(40);
    expect(hotWaterTimeLimit(null, PRESETS)).toBe(30);
  });

  it('gives none that nobody set, and none of 0', () => {
    expect(drinkTarget('steam', null, null)).toBeNull();
    expect(drinkTarget('flush', null, { ...PRESETS, rinseData: { ...PRESETS.rinseData, duration: 0 } })).toBeNull();
    expect(drinkTarget('hotWater', { ...SHOT_SETTINGS, targetHotWaterVolume: 0 }, null)).toBeNull();
  });

  it('gives the steam temperature set only while steam is on', () => {
    expect(steamTemperatureSet(SHOT_SETTINGS, PRESETS)).toBe(155);
    expect(steamTemperatureSet(null, PRESETS)).toBe(150);
    expect(steamTemperatureSet(null, { ...PRESETS, steamSettings: { ...PRESETS.steamSettings, targetTemperature: 0 } })).toBeNull();
  });
});

describe('dialReading', () => {
  it('counts steam and flush in tenths of a second, hot water in whole millilitres', () => {
    expect(dialReading('steam', run({ elapsedS: 23.44 }), 50)).toEqual({ number: '23.4', unit: 's', of: 'of 50 s', share: 23.44 / 50 });
    expect(dialReading('hotWater', run({ kind: 'hotWater', waterMl: 111.6 }), 200)).toEqual({ number: '112', unit: 'ml', of: 'of 200 ml', share: 111.6 / 200 });
  });

  it('caps the share at 1, and draws no share without a target', () => {
    expect(dialReading('flush', run({ kind: 'flush', elapsedS: 12 }), 10).share).toBe(1);
    expect(dialReading('flush', run({ kind: 'flush', elapsedS: 3 }), null)).toEqual({ number: '3.0', unit: 's', of: null, share: null });
  });

  it('shows a dash with no unit and no share before any run', () => {
    expect(dialReading('steam', null, 50)).toEqual({ number: '—', unit: null, of: 'of 50 s', share: null });
  });

  it('says how long a finished hot water took', () => {
    expect(dialReading('hotWater', run({ kind: 'hotWater', live: false, waterMl: 198, elapsedS: 38.62 }), 200).of).toBe('in 38.6 s');
  });
});

const input = (overrides: Partial<ReadoutInput> = {}): ReadoutInput => ({
  frame: machine('steam', 'pouring', { steamTemperature: 152, pressure: 1.94, flow: 0.81, groupTemperature: 91.84, targetGroupTemperature: 93 }),
  scaleWeight: 94.83,
  scaleConnected: true,
  shotSettings: null,
  presets: PRESETS,
  run: run(),
  ...overrides,
});

describe('drinkReadouts while it runs', () => {
  it('steam: the heater against the temperature set, its pressure and flow', () => {
    expect(drinkReadouts('steam', input())).toEqual([
      { key: 'steam', label: 'Steam', value: '152 °C', caption: 'set 150', swatch: null },
      { key: 'pressure', label: 'Pressure', value: '1.9 bar', caption: '', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: '0.8 ml/s', caption: 'set 0.8', swatch: 'flow' },
    ]);
  });

  it('hot water: its flow, the scale and the time against the limit', () => {
    const hot = input({ frame: machine('hotWater', 'pouring', { flow: 7.96 }), run: run({ kind: 'hotWater', elapsedS: 18.47 }) });
    expect(drinkReadouts('hotWater', hot)).toEqual([
      { key: 'flow', label: 'Flow', value: '8.0 ml/s', caption: 'set 10.0', swatch: 'flow' },
      { key: 'scale', label: 'Scale', value: '94.8 g', caption: 'in the cup', swatch: 'weight' },
      { key: 'time', label: 'Time', value: '18.5 s', caption: 'stops by 30 s', swatch: null },
    ]);
  });

  it('hot water without a scale says so, with a dash', () => {
    const readouts = drinkReadouts('hotWater', input({ scaleConnected: false, scaleWeight: null }));
    expect(readouts[1]).toEqual({ key: 'scale', label: 'Scale', value: '—', caption: 'No scale', swatch: null });
  });

  it('flush: the water so far, its flow and the group against its target', () => {
    const flush = input({ frame: machine('flush', 'pouring', { flow: 6.02, groupTemperature: 91.84, targetGroupTemperature: 93 }), run: run({ kind: 'flush', waterMl: 16.4 }) });
    expect(drinkReadouts('flush', flush)).toEqual([
      { key: 'water', label: 'Water', value: '16 ml', caption: 'so far', swatch: null },
      { key: 'flow', label: 'Flow', value: '6.0 ml/s', caption: 'set 6.0', swatch: 'flow' },
      { key: 'group', label: 'Group', value: '91.8 °C', caption: 'target 93.0', swatch: null },
    ]);
  });

  it('shows a dash for a reading the machine has not given, and while it is away', () => {
    const away = drinkReadouts('steam', input({ frame: null }));
    expect(away.map((r) => r.value)).toEqual(['—', '—', '—']);
  });
});

describe('drinkReadouts once it is done', () => {
  const doneSteam = run({
    live: false,
    t: [0, 1, 2, 3],
    working: [true, true, true, false],
    flow: [0.7, 0.9, 0.8, 0],
    pressure: [1.8, 2.0, 1.9, 0.9],
    steamTemperature: [151, 149, 148, 150],
  });

  it('steam: the heater at the end of the steaming, pressure and flow averaged over it', () => {
    expect(drinkReadouts('steam', input({ run: doneSteam }))).toEqual([
      { key: 'steam', label: 'Steam', value: '148 °C', caption: 'at the end', swatch: null },
      { key: 'pressure', label: 'Pressure', value: '1.9 bar', caption: 'average', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: '0.8 ml/s', caption: 'average', swatch: 'flow' },
    ]);
  });

  it('hot water: flow averaged, the scale at the end, the time it took', () => {
    const hot = run({ kind: 'hotWater', live: false, elapsedS: 38.62, t: [0, 1], working: [true, true], flow: [5, 5.2], weight: [0, 195.24] });
    expect(drinkReadouts('hotWater', input({ run: hot }))).toEqual([
      { key: 'flow', label: 'Flow', value: '5.1 ml/s', caption: 'average', swatch: 'flow' },
      { key: 'scale', label: 'Scale', value: '195.2 g', caption: 'in the cup', swatch: 'weight' },
      { key: 'time', label: 'Time', value: '38.6 s', caption: '', swatch: null },
    ]);
  });

  it('flush: the water through the group, flow averaged, the group at the end', () => {
    const flush = run({ kind: 'flush', live: false, waterMl: 41.2, t: [0, 1], working: [true, true], flow: [8, 8.2], groupTemperature: [91, 92.4], latest: machine('idle', 'idle', { targetGroupTemperature: 93 }) });
    expect(drinkReadouts('flush', input({ run: flush }))).toEqual([
      { key: 'water', label: 'Water', value: '41 ml', caption: 'through the group', swatch: null },
      { key: 'flow', label: 'Flow', value: '8.1 ml/s', caption: 'average', swatch: 'flow' },
      { key: 'group', label: 'Group', value: '92.4 °C', caption: 'target 93.0', swatch: null },
    ]);
  });
});

describe('the trace', () => {
  it("runs to the time set, the hot water's limit, or the run's own time, whichever is longest", () => {
    expect(traceSpan(run({ t: [0, 10] }), 50)).toBe(50);
    expect(traceSpan(run({ t: [0, 62] }), 50)).toBe(62);
    expect(traceSpan(null, null)).toBe(5);
  });

  it('draws steam’s flow then pressure on one axis of at least 3', () => {
    const lines = traceLines('steam', run({ flow: [0.8], pressure: [2.4] }), null);
    expect(lines.map((l) => [l.key, l.yMax])).toEqual([
      ['flow', 3],
      ['pressure', 3],
    ]);
    expect(traceLines('steam', run({ flow: [0.8], pressure: [3.6] }), null)[1]!.yMax).toBe(4);
  });

  it("draws hot water's weight up to the volume set, under its flow, only when the scale read something", () => {
    const withScale = traceLines('hotWater', run({ kind: 'hotWater', flow: [8], weight: [12] }), 200);
    expect(withScale.map((l) => [l.key, l.yMax])).toEqual([
      ['weight', 200],
      ['flow', 10],
    ]);
    expect(traceLines('hotWater', run({ kind: 'hotWater', flow: [8], weight: [null] }), 200).map((l) => l.key)).toEqual(['flow']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/drinks/drinkModel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/ui/drinks/drinkModel.ts`**

```ts
/**
 * What a drink's view says (the design's section 4), as pure functions of the
 * run (drinkTrace.ts), the machine's frame and the settings: the phase in
 * words, what stops the drink, the dial's number, each readout with its
 * caption, and the trace's lines. A value nobody gave is a dash; a target
 * nobody gave is not drawn (D148).
 *
 * Targets come from the machine's own live settings when Decaid has sent them
 * (ws/v1/machine/shotSettings), and from Decaid's workflow otherwise; the flush
 * has no live setting. Hot water shows no live temperature: during hot water
 * the snapshot's mixTemperature is not the water's (Decaid's spec).
 */
import type { MachineFrame, ShotSettings, Workflow } from '../../api/types.ts';
import { DASH, formatSeconds, formatTemperature, formatWeight } from '../machine/format.ts';
import type { DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

export type DrinkPresets = Pick<Workflow, 'steamSettings' | 'hotWaterData' | 'rinseData'>;

/** Steam is off in Decaid below this (de1_controller.dart:575 at aab5f93, drinkSettings.ts). */
const STEAM_ON_FROM = 135;
/** A trace is never narrower than this, so a run that just began is not stretched across the width. */
const MIN_SPAN_S = 5;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): number | null => (finite(value) && value > 0 ? value : null);
/** A target as it reads: whole numbers whole, anything else to one decimal. */
const plain = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const oneDecimal = (value: number | null | undefined, unit: string): string => (finite(value) ? `${value.toFixed(1)} ${unit}` : DASH);

export function phaseWords(kind: DrinkKind, run: DrinkRun | null, frame: MachineFrame | null): string | null {
  if (run === null) return null;
  if (!run.live) return run.lost ? 'Connection lost' : 'Done';
  const state = frame?.state?.state;
  const substate = frame?.state?.substate;
  if (substate === 'preparingForShot') return 'Heating';
  if (kind === 'steam') {
    if (state === 'steamRinse') return 'Rinsing the wand';
    if (substate === 'pausedSteam') return 'Paused';
    if (substate === 'puffing') return 'Purging';
    return 'Steaming';
  }
  return kind === 'hotWater' ? 'Pouring' : 'Flushing';
}

/** What stops the drink: the steam and flush time in seconds, the hot water volume in ml. */
export function drinkTarget(kind: DrinkKind, shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  switch (kind) {
    case 'steam':
      return positive(shotSettings?.targetSteamDuration) ?? positive(presets?.steamSettings?.duration);
    case 'hotWater':
      return positive(shotSettings?.targetHotWaterVolume) ?? positive(presets?.hotWaterData?.volume);
    case 'flush':
      return positive(presets?.rinseData?.duration);
  }
}

/** Hot water's time limit, which stops it if the volume has not. */
export function hotWaterTimeLimit(shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  return positive(shotSettings?.targetHotWaterDuration) ?? positive(presets?.hotWaterData?.duration);
}

/** The steam temperature set, while steam is on. */
export function steamTemperatureSet(shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  const set = positive(shotSettings?.targetSteamTemp) ?? positive(presets?.steamSettings?.targetTemperature);
  return set !== null && set >= STEAM_ON_FROM ? set : null;
}

export interface DialReading {
  /** The number in the middle: the drink's time in tenths, or its water in whole ml; a dash before any run. */
  number: string;
  /** Its unit, or null beside a dash. */
  unit: string | null;
  /** The line under it: "of 50 s", or once hot water is done "in 38.6 s"; null without a target. */
  of: string | null;
  /** How far toward the target, 0 to 1; null without a run or a target. */
  share: number | null;
}

export function dialReading(kind: DrinkKind, run: DrinkRun | null, target: number | null): DialReading {
  const water = kind === 'hotWater';
  const unit = water ? 'ml' : 's';
  const value = run === null ? null : water ? run.waterMl : run.elapsedS;
  let of = target === null ? null : `of ${plain(target)} ${unit}`;
  if (water && run !== null && !run.live) of = `in ${run.elapsedS.toFixed(1)} s`;
  if (value === null) return { number: DASH, unit: null, of, share: null };
  return {
    number: water ? String(Math.round(value)) : value.toFixed(1),
    unit,
    of,
    share: target === null ? null : Math.min(1, Math.max(0, value / target)),
  };
}

/** A readout's series colour, as the trace draws it. */
export type Swatch = 'pressure' | 'flow' | 'weight';

export interface Readout {
  key: string;
  label: string;
  /** The number with its unit ("1.9 bar"), or a dash. */
  value: string;
  /** The line under it ("set 0.8", "average"); empty, never missing, so the rows line up. */
  caption: string;
  swatch: Swatch | null;
}

export interface ReadoutInput {
  /** The machine's frame now, or null while it is away. */
  frame: MachineFrame | null;
  /** The scale's weight now, or null without one. */
  scaleWeight: number | null;
  scaleConnected: boolean;
  shotSettings: ShotSettings | null;
  presets: DrinkPresets | null;
  run: DrinkRun | null;
}

/** The mean of a series over the frames the drink worked in; null with none. */
function average(values: readonly (number | null)[], working: readonly boolean[]): number | null {
  let sum = 0;
  let count = 0;
  values.forEach((value, i) => {
    if (working[i] && finite(value)) {
      sum += value;
      count += 1;
    }
  });
  return count === 0 ? null : sum / count;
}

/** A series' last reading, in a working frame when `working` is given. */
function lastOf(values: readonly (number | null)[], working?: readonly boolean[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if ((working === undefined || working[i]) && finite(value)) return value;
  }
  return null;
}

const setCaption = (value: number | null | undefined): string => (finite(value) ? `set ${value.toFixed(1)}` : '');

export function drinkReadouts(kind: DrinkKind, input: ReadoutInput): Readout[] {
  const { frame, run, presets } = input;
  const done = run !== null && !run.live;
  if (kind === 'steam') {
    const set = steamTemperatureSet(input.shotSettings, presets);
    if (done) {
      return [
        { key: 'steam', label: 'Steam', value: formatTemperature(lastOf(run.steamTemperature, run.working), 0), caption: 'at the end', swatch: null },
        { key: 'pressure', label: 'Pressure', value: oneDecimal(average(run.pressure, run.working), 'bar'), caption: 'average', swatch: 'pressure' },
        { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
      ];
    }
    return [
      { key: 'steam', label: 'Steam', value: formatTemperature(frame?.steamTemperature, 0), caption: set === null ? '' : `set ${set}`, swatch: null },
      { key: 'pressure', label: 'Pressure', value: oneDecimal(frame?.pressure, 'bar'), caption: '', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.steamSettings?.flow), swatch: 'flow' },
    ];
  }
  if (kind === 'hotWater') {
    const weighed = done ? run.weight.some(finite) : input.scaleConnected;
    const scale: Readout = weighed
      ? { key: 'scale', label: 'Scale', value: formatWeight(done ? lastOf(run.weight) : input.scaleWeight), caption: 'in the cup', swatch: 'weight' }
      : { key: 'scale', label: 'Scale', value: DASH, caption: 'No scale', swatch: null };
    if (done) {
      return [
        { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
        scale,
        { key: 'time', label: 'Time', value: formatSeconds(run.elapsedS), caption: '', swatch: null },
      ];
    }
    const limit = hotWaterTimeLimit(input.shotSettings, presets);
    return [
      { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.hotWaterData?.flow), swatch: 'flow' },
      scale,
      { key: 'time', label: 'Time', value: run === null ? DASH : formatSeconds(run.elapsedS), caption: limit === null ? '' : `stops by ${plain(limit)} s`, swatch: null },
    ];
  }
  const target = done ? run.latest?.targetGroupTemperature : frame?.targetGroupTemperature;
  const groupCaption = finite(target) ? `target ${target.toFixed(1)}` : '';
  if (done) {
    return [
      { key: 'water', label: 'Water', value: `${Math.round(run.waterMl)} ml`, caption: 'through the group', swatch: null },
      { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
      { key: 'group', label: 'Group', value: formatTemperature(lastOf(run.groupTemperature)), caption: groupCaption, swatch: null },
    ];
  }
  return [
    { key: 'water', label: 'Water', value: run === null ? DASH : `${Math.round(run.waterMl)} ml`, caption: run === null ? '' : 'so far', swatch: null },
    { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.rinseData?.flow), swatch: 'flow' },
    { key: 'group', label: 'Group', value: formatTemperature(frame?.groupTemperature), caption: groupCaption, swatch: null },
  ];
}

export interface TraceLine {
  key: Swatch;
  values: readonly (number | null)[];
  /** The value at the top of the plot. */
  yMax: number;
}

/** The highest reading of a series, or 0. */
function highest(values: readonly (number | null)[]): number {
  let high = 0;
  for (const value of values) if (finite(value) && value > high) high = value;
  return high;
}

/** The trace's lines, in draw order (the last on top). */
export function traceLines(kind: DrinkKind, run: DrinkRun, volumeSet: number | null): TraceLine[] {
  if (kind === 'steam') {
    const yMax = Math.max(3, Math.ceil(Math.max(highest(run.flow), highest(run.pressure))));
    return [
      { key: 'flow', values: run.flow, yMax },
      { key: 'pressure', values: run.pressure, yMax },
    ];
  }
  const flow: TraceLine = { key: 'flow', values: run.flow, yMax: Math.max(10, Math.ceil(highest(run.flow))) };
  if (kind === 'hotWater' && run.weight.some(finite)) {
    return [{ key: 'weight', values: run.weight, yMax: Math.max(volumeSet ?? 0, Math.ceil(highest(run.weight)), 1) }, flow];
  }
  return [flow];
}

/** Seconds at the trace's right edge: the time set (or hot water's limit), or the run's own, whichever is longer. */
export function traceSpan(run: DrinkRun | null, timeSet: number | null): number {
  const ran = run === null || run.t.length === 0 ? 0 : run.t[run.t.length - 1]!;
  return Math.max(timeSet ?? 0, ran, MIN_SPAN_S);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/ui/drinks/drinkModel.test.ts > .verify/t6.log 2>&1; echo exit=$?`
Expected: exit=0. (Check `formatTemperature(152, 0)` gives `'152 °C'` and `formatWeight(94.83)` `'94.8 g'` from `src/ui/machine/format.ts`; the expectations follow them.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/drinks/drinkModel.ts src/ui/drinks/drinkModel.test.ts
git commit -m "feat: what a drink's view says: its phase, its target, the dial's number and the readouts, live and once done (D148)"
```

---

### Task 7: Switching to a drink's view, and Go back

**Files:**
- Create: `src/ui/drinks/drinkFocus.ts`, `src/ui/drinks/drinkFocus.test.ts`, `src/ui/drinks/useDrinkFocus.ts`, `src/ui/drinks/useDrinkFocus.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/ui/drinks/drinkFocus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { drinkStarted, goBackLabel, goBackRoute, NO_ORIGIN } from './drinkFocus.ts';

describe('drinkStarted', () => {
  it("switches to the drink's view and remembers the screen it took over", () => {
    expect(drinkStarted(NO_ORIGIN, { kind: 'steam', typing: false, shown: { name: 'settings' } })).toEqual({
      state: { origin: { name: 'settings' } },
      go: { name: 'drink', drink: 'steam' },
    });
  });

  it('stays while the barista types, and when the view is already there', () => {
    const origin = { origin: { name: 'coach' as const } };
    expect(drinkStarted(origin, { kind: 'flush', typing: true, shown: { name: 'history' } })).toEqual({ state: origin, go: null });
    expect(drinkStarted(origin, { kind: 'flush', typing: false, shown: { name: 'drink', drink: 'flush' } })).toEqual({ state: origin, go: null });
  });

  it("from one drink's view to another's, keeps the screen the first took over", () => {
    const origin = { origin: { name: 'history' as const, bagId: 'b1' } };
    expect(drinkStarted(origin, { kind: 'hotWater', typing: false, shown: { name: 'drink', drink: 'steam' } })).toEqual({
      state: origin,
      go: { name: 'drink', drink: 'hotWater' },
    });
  });
});

describe('Go back', () => {
  it('goes to the screen taken over, or the coach', () => {
    expect(goBackRoute(NO_ORIGIN)).toEqual({ name: 'coach' });
    expect(goBackRoute({ origin: { name: 'shot' } })).toEqual({ name: 'shot' });
  });

  it('says where to a screen reader', () => {
    expect(goBackLabel({ name: 'coach' })).toBe('Go back to the coach');
    expect(goBackLabel({ name: 'shot' })).toBe('Go back to the shot');
    expect(goBackLabel({ name: 'history' })).toBe('Go back to History');
    expect(goBackLabel({ name: 'settings' })).toBe('Go back to Settings');
  });
});
```

`src/ui/drinks/useDrinkFocus.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../api/types.ts';
import { navigate, useRoute } from '../router.ts';
import { GUARD_MS } from '../shell/useShotFocus.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { useDrinkFocus } from './useDrinkFocus.ts';

let seconds = 0;
const frame = (state: string, substate = 'pouring'): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 13, 8).getTime() + (seconds += 0.25) * 1000),
  state: { state, substate },
});

function Harness() {
  const route = useRoute();
  const { guardUntil, back, goBack } = useDrinkFocus(route);
  return (
    <div>
      <output data-testid="route">{route.name === 'drink' ? `drink:${route.drink}` : route.name}</output>
      <output data-testid="guard">{guardUntil === null ? 'none' : String(guardUntil)}</output>
      <output data-testid="back">{back.name}</output>
      <button type="button" onClick={goBack}>
        Go back
      </button>
      <textarea aria-label="Draft" />
    </div>
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
const text = (id: string) => screen.getByTestId(id).textContent;
const send = (services: FakeServices, f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));

function renderHarness(): FakeServices {
  const services = createFakeServices();
  renderWithServices(<Harness />, services);
  return services;
}

beforeEach(async () => {
  window.location.hash = '#/settings';
  await new Promise((resolve) => setImmediate(resolve));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDrinkFocus', () => {
  it("a drink starting switches to its view by itself, replacing the entry, and Go back returns", async () => {
    const services = renderHarness();
    const entries = window.history.length;
    send(services, frame('steam'));
    expect(window.location.hash).toBe('#/steam');
    expect(window.history.length).toBe(entries);
    await settle();
    expect(text('route')).toBe('drink:steam');
    expect(text('back')).toBe('settings');

    send(services, frame('idle', 'idle'));
    act(() => screen.getByRole('button', { name: 'Go back' }).click());
    expect(window.location.hash).toBe('#/settings');
    expect(window.history.length).toBe(entries);
  });

  it('stays put while the barista types', async () => {
    const services = renderHarness();
    act(() => screen.getByLabelText('Draft').focus());
    send(services, frame('hotWater'));
    expect(window.location.hash).toBe('#/settings');
  });

  it('does not switch back by itself when the run ends', async () => {
    const services = renderHarness();
    send(services, frame('flush'));
    await settle();
    send(services, frame('idle', 'idle'));
    await settle();
    expect(window.location.hash).toBe('#/flush');
  });

  it("a move of the barista's is theirs: the next run switches again, and goes back to where they were", async () => {
    const services = renderHarness();
    send(services, frame('flush'));
    send(services, frame('idle', 'idle'));
    await settle();
    act(() => navigate({ name: 'history' }));
    await settle();
    send(services, frame('hotWater'));
    expect(window.location.hash).toBe('#/hot-water');
    await settle();
    expect(text('back')).toBe('history');
  });

  it(`guards the screen for ${GUARD_MS} ms after it switches`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const services = renderHarness();
    const at = Date.now();
    send(services, frame('steam'));
    expect(text('guard')).toBe(String(at + GUARD_MS));
    act(() => vi.advanceTimersByTime(GUARD_MS));
    expect(text('guard')).toBe('none');
  });

  it('takes the screen for a run already under way when it starts', async () => {
    const services = createFakeServices({ telemetry: { machine: frame('steam') } });
    renderWithServices(<Harness />, services);
    expect(window.location.hash).toBe('#/steam');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/drinks/drinkFocus.test.ts src/ui/drinks/useDrinkFocus.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/ui/drinks/drinkFocus.ts`**

```ts
/**
 * When CafAI switches to a drink's view by itself, and where Go back goes
 * (D146). A pure reducer, as shotFocus.ts is: useDrinkFocus.ts feeds it the
 * runs and the screen on show and carries out what it says.
 *
 * A run's start switches to its drink's view, unless the barista is typing (a
 * phone's keyboard may be up, a sentence half written) or the view is already
 * on screen. The screen the view took over is remembered for Go back: the
 * last screen that was not a drink's view, so hot water after a flush still
 * goes back to the coach. There is no return of its own (the owner's choice,
 * 2026-10-13): the view stays, with the result, until the barista leaves it.
 */
import type { Route } from '../router.ts';
import type { DrinkKind } from './kinds.ts';

export interface DrinkFocusState {
  /** The screen the last switch took over (never a drink's view); null before any. */
  readonly origin: Route | null;
}

export const NO_ORIGIN: DrinkFocusState = { origin: null };

export interface DrinkStarted {
  kind: DrinkKind;
  /** A field that takes typed text has focus (useShotFocus.ts's isTextEntry). */
  typing: boolean;
  /** The route on screen as the run started. */
  shown: Route;
}

export interface DrinkFocusStep {
  state: DrinkFocusState;
  /** Where to switch, or null to stay. */
  go: Route | null;
}

export function drinkStarted(state: DrinkFocusState, event: DrinkStarted): DrinkFocusStep {
  const there = event.shown.name === 'drink' && event.shown.drink === event.kind;
  if (event.typing || there) return { state, go: null };
  const origin = event.shown.name === 'drink' ? state.origin : event.shown;
  return { state: origin === state.origin ? state : { origin }, go: { name: 'drink', drink: event.kind } };
}

/** Where Go back goes: the screen the view took over, or the coach. */
export function goBackRoute(state: DrinkFocusState): Route {
  return state.origin ?? { name: 'coach' };
}

/** Go back's name for a screen reader, which says where. */
export function goBackLabel(route: Route): string {
  switch (route.name) {
    case 'coach':
      return 'Go back to the coach';
    case 'shot':
      return 'Go back to the shot';
    case 'history':
      return 'Go back to History';
    case 'settings':
      return 'Go back to Settings';
    case 'drink':
      return 'Go back';
  }
}
```

- [ ] **Step 4: Write `src/ui/drinks/useDrinkFocus.ts`**

```ts
/**
 * The drink focus rules (drinkFocus.ts) wired to the app, as useShotFocus.ts
 * wires the shot's: the drinks' recording (drinkTrace.ts) in, the router out.
 * A run's start switches to its view with location.replace, so Back in a
 * browser goes where the barista went, and guards the pane it switched for
 * GUARD_MS (TapGuard.tsx); a run already under way when the app starts (after
 * Decaid reloads the skin) takes the screen too. Go back returns, the same
 * way, to the screen the view took over.
 *
 * It never sends anything to the machine.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import { replaceRoute, routeHref, type Route } from '../router.ts';
import { GUARD_MS, isTextEntry } from '../shell/useShotFocus.ts';
import { drinkStarted, goBackRoute, NO_ORIGIN, type DrinkFocusState } from './drinkFocus.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';

export interface DrinkFocus {
  /** Until when (epoch ms) the pane the app just switched to ignores taps; null when it takes them. */
  guardUntil: number | null;
  /** Where Go back goes. */
  back: Route;
  goBack(): void;
}

export function useDrinkFocus(route: Route): DrinkFocus {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const [guardUntil, setGuardUntil] = useState<number | null>(null);
  const [focus, setFocus] = useState<DrinkFocusState>(NO_ORIGIN);
  const focusRef = useRef(focus);
  /** The route on screen, for the runs that start between renders. */
  const shown = useRef(route);
  useLayoutEffect(() => {
    shown.current = route;
  }, [route]);

  useEffect(() => {
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    const started = (run: DrinkRun) => {
      const step = drinkStarted(focusRef.current, { kind: run.kind, typing: isTextEntry(document.activeElement), shown: shown.current });
      if (step.state !== focusRef.current) {
        focusRef.current = step.state;
        setFocus(step.state);
      }
      if (step.go === null || window.location.hash === routeHref(step.go)) return;
      if (guardTimer !== null) clearTimeout(guardTimer);
      setGuardUntil(Date.now() + GUARD_MS);
      guardTimer = setTimeout(() => {
        guardTimer = null;
        setGuardUntil(null);
      }, GUARD_MS);
      replaceRoute(step.go);
    };
    const live = trace.getState().live;
    const under = live === null ? null : trace.runOf(live);
    if (under) started(under);
    const stop = trace.onRun((event) => {
      if (event.type === 'started') started(event.run);
    });
    return () => {
      stop();
      if (guardTimer !== null) clearTimeout(guardTimer);
    };
  }, [trace]);

  const goBack = useCallback(() => replaceRoute(goBackRoute(focusRef.current)), []);
  return { guardUntil, back: goBackRoute(focus), goBack };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/drinks > .verify/t7.log 2>&1; echo exit=$?`
Expected: exit=0.

- [ ] **Step 6: Commit**

```bash
git add src/ui/drinks/drinkFocus.ts src/ui/drinks/drinkFocus.test.ts src/ui/drinks/useDrinkFocus.ts src/ui/drinks/useDrinkFocus.test.tsx
git commit -m "feat: a drink starting takes the screen to its view, not while typing, and Go back returns to the screen it took over (D146)"
```

---

### Task 8: The view

**Files:**
- Create: `src/ui/drinks/DrinkDial.tsx`, `src/ui/drinks/DrinkTraceChart.tsx`, `src/ui/drinks/DrinkReadouts.tsx`, `src/ui/drinks/DrinkSettingsCard.tsx`, `src/ui/drinks/DrinkView.tsx`, `src/ui/drinks/DrinkView.test.tsx`
- Modify: `src/ui/testIds.ts` (after `nextStep`)

- [ ] **Step 1: Add the test ids**

In `src/ui/testIds.ts`, after `nextStep: 'next-step',`:

```ts
  // A drink's view while it runs (D146): steam, hot water or flush
  drinkView: 'drink-view',
  drinkPhase: 'drink-phase',
  drinkGoBack: 'drink-go-back',
  drinkDial: 'drink-dial',
  drinkDialValue: 'drink-dial-value',
  drinkDialOf: 'drink-dial-of',
  drinkReadout: (key: string) => `drink-readout-${slug(key)}`,
  drinkTrace: 'drink-trace',
  drinkSettingsCard: 'drink-settings-card',
```

- [ ] **Step 2: Write the failing component test**

`src/ui/drinks/DrinkView.test.tsx`:

```tsx
// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame } from '../../api/types.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { TID } from '../testIds.ts';
import { DrinkView } from './DrinkView.tsx';
import { drinkTraceFor } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

let seconds = 0;
const frame = (state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: formatLocalTimestamp(new Date(2026, 9, 13, 8).getTime() + (seconds += 0.5) * 1000),
  state: { state, substate },
  ...values,
});

function renderView(kind: DrinkKind, services: FakeServices = createFakeServices()) {
  drinkTraceFor(services.telemetry);
  const onGoBack = vi.fn();
  renderWithServices(<DrinkView kind={kind} back={{ name: 'settings' }} onGoBack={onGoBack} />, services);
  const send = (f: MachineFrame) => act(() => services.telemetry.setState({ machine: f }));
  return { services, onGoBack, send };
}

describe('DrinkView', () => {
  it('names the drink and says its phase as the machine moves through it', async () => {
    const { send } = renderView('steam');
    expect(screen.getByRole('heading', { name: 'Steam' })).toBeInTheDocument();
    send(frame('steam', 'preparingForShot'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Heating');
    send(frame('steam', 'pouring', { steamTemperature: 152, pressure: 1.9, flow: 0.8 }));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Steaming');
    send(frame('steam', 'puffing'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Purging');
    send(frame('idle', 'idle'));
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('Done');
  });

  it("counts the drink toward its target on the dial, from the machine's own settings", async () => {
    const services = createFakeServices();
    const { send } = renderView('steam', services);
    await screen.findByText('Changes go to Decaid at once.');
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    send(frame('steam', 'pouring'));
    expect(screen.getByTestId(TID.drinkDialValue)).toHaveTextContent('1.0');
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 50 s');
    act(() =>
      services.telemetry.setState({
        shotSettings: { steamSetting: 0, targetSteamTemp: 150, targetSteamDuration: 40, targetHotWaterTemp: 75, targetHotWaterVolume: 50, targetHotWaterDuration: 30, targetShotVolume: 0, groupTemp: 93 },
      }),
    );
    expect(screen.getByTestId(TID.drinkDialOf)).toHaveTextContent('of 40 s');
  });

  it('shows the readouts of the drink, live', async () => {
    const { send } = renderView('steam');
    send(frame('steam', 'pouring', { steamTemperature: 152, pressure: 1.94, flow: 0.81 }));
    expect(screen.getByTestId(TID.drinkReadout('steam'))).toHaveTextContent('152 °C');
    expect(screen.getByTestId(TID.drinkReadout('pressure'))).toHaveTextContent('1.9 bar');
    expect(screen.getByTestId(TID.drinkReadout('flow'))).toHaveTextContent('0.8 ml/s');
  });

  it('holds the settings while the drink runs, and lets them change once it stops', async () => {
    const { services, send } = renderView('flush');
    await screen.findByText('Changes go to Decaid at once.');
    send(frame('flush', 'pouring'));
    const time = screen.getByRole('spinbutton', { name: 'Flush time' });
    expect(time).toBeDisabled();
    expect(screen.getByText('Change these once it stops: the machine is using them now.')).toBeInTheDocument();
    send(frame('idle', 'idle'));
    expect(time).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'More flush time' }));
    expect(services.decaid.calls.find((call) => call.method === 'updateWorkflow')?.args).toEqual([{ rinseData: { duration: 11 } }]);
  });

  it('offers Go back only while nothing runs, named for where it goes', async () => {
    const { onGoBack, send } = renderView('hotWater');
    expect(screen.getByRole('button', { name: 'Go back to Settings' })).toBeInTheDocument();
    send(frame('hotWater', 'pouring'));
    expect(screen.queryByRole('button', { name: 'Go back to Settings' })).toBeNull();
    send(frame('idle', 'idle'));
    await userEvent.click(screen.getByRole('button', { name: 'Go back to Settings' }));
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it("says nothing of a phase, and shows a dash on the dial, before the drink's first run", () => {
    renderView('flush');
    expect(screen.getByTestId(TID.drinkPhase)).toHaveTextContent('');
    expect(screen.getByTestId(TID.drinkDialValue)).toHaveTextContent('—');
  });

  it('keeps the loops still once the run is over', () => {
    const { send } = renderView('hotWater');
    send(frame('hotWater', 'pouring'));
    expect(screen.getByTestId(TID.drinkDial)).toHaveAttribute('data-moving', 'true');
    send(frame('idle', 'idle'));
    expect(screen.getByTestId(TID.drinkDial)).toHaveAttribute('data-moving', 'false');
  });

  it("draws the trace of the run's flow", () => {
    const { send } = renderView('flush');
    send(frame('flush', 'pouring', { flow: 6 }));
    send(frame('flush', 'pouring', { flow: 6 }));
    const trace = screen.getByTestId(TID.drinkTrace);
    expect(within(trace).getByTestId('trace-flow').getAttribute('d')).toMatch(/^M0,/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/ui/drinks/DrinkView.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/ui/drinks/DrinkDial.tsx`**

```tsx
/**
 * The dial of a drink's view (the design's section 5, D149): a ring that fills
 * toward what stops the drink (the steam time, the hot water volume, the flush
 * time), the number in the middle, and a small scene inside that moves only
 * while the machine runs: milk with steam rising from it, water filling under
 * a falling stream, a shower screen pouring. Ink for steam, which is white;
 * the flow's blue for the water drinks.
 *
 * Frames never re-render it: it draws each one from the drinks' recording
 * (drinkTrace.ts) straight into its nodes (the arc, the tip, the level, the
 * number), as the shot timer writes its time. React hears of a new run, a run
 * ending or a new target only.
 *
 * The scene sits behind the number and fades out across its band, so no line
 * ever crosses the figures. Every loop stops under reduced motion and once the
 * run is over; the arc, the level and the number still move, because they are
 * the readings.
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { keyframes, type SxProps, type Theme } from '@mui/material/styles';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import { useServices } from '../../app/services.tsx';
import { TID } from '../testIds.ts';
import { dialReading } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

/** The drawing's box; the dial is drawn once and scaled to its size. */
const BOX = 272;
const C = BOX / 2;
const RING = 112;
/** The inside of the ring, the scene's room: its floor and its depth. */
const INSIDE = 99;
const FLOOR = C + INSIDE;
const DEPTH = INSIDE * 2;
/** Steam's milk fills the bottom of the room, rising from 17% to 32% with the steam's time. */
const MILK_FROM = 0.17;
const MILK_RISE = 0.15;
/** The number's band (as fractions of the box): the scene fades out across it. */
const BAND = { from: 0.34, to: 0.68 };

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
  const major = i % 5 === 0;
  const inner = major ? 120 : 124;
  return { major, x1: C + Math.cos(angle) * inner, y1: C + Math.sin(angle) * inner, x2: C + Math.cos(angle) * 133, y2: C + Math.sin(angle) * 133 };
});

/** A wave 80 units long on the floor, wide enough to slide one length and still cover the room. */
function wave(amplitude: number): string {
  let d = `M20 ${FLOOR}`;
  for (let x = 20; x < 340; x += 80) d += ` c13 ${-amplitude} 27 ${-amplitude} 40 0 s27 ${amplitude} 40 0`;
  return d;
}
const WATER_TOP = wave(4);
const WATER_BODY = `${WATER_TOP} L340 ${FLOOR + DEPTH + 20} L20 ${FLOOR + DEPTH + 20} Z`;
const MILK_TOP = wave(5);
const MILK_BODY = `${MILK_TOP} L340 ${FLOOR + DEPTH + 20} L20 ${FLOOR + DEPTH + 20} Z`;
/** Three wisps rising from the milk's surface (drawn on the floor, moved with the level). */
const WISPS = [110, 136, 162].map((x, i) => `M${x} ${FLOOR - 4 - (i === 1 ? 4 : 0)}c-7-9 6-16 0-25s7-16 1-25`);
const STREAKS = [106, 121, 136, 151, 166];

const slide = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(-80px); }
`;
const fall = keyframes`
  to { stroke-dashoffset: -24; }
`;
const rise = keyframes`
  0% { transform: translateY(6px); opacity: 0; }
  14% { opacity: 0.9; }
  72% { opacity: 0.65; }
  100% { transform: translateY(-122px); opacity: 0; }
`;
const enter = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const dialSx = (water: boolean): SxProps<Theme> => (theme) => {
  const series = water ? theme.palette.cafai.graph.flow : theme.palette.text.primary;
  return {
    position: 'relative',
    flex: 'none',
    '& svg': { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' },
    '& .tick': { stroke: theme.palette.cafai.graph.grid, strokeWidth: 2, strokeLinecap: 'round' },
    '& .tick.major': { stroke: theme.palette.divider, strokeWidth: 2.5 },
    '& .track': { fill: 'none', stroke: theme.palette.cafai.raised, strokeWidth: 10 },
    '& .arc': { fill: 'none', stroke: series, strokeWidth: 10, strokeLinecap: 'round', transition: 'stroke-dasharray 250ms linear' },
    '& .tip': { transformOrigin: `${C}px ${C}px`, transition: 'transform 250ms linear' },
    '& .tip circle': { fill: series, stroke: theme.palette.background.default, strokeWidth: 3 },
    '& .level': { transition: 'transform 250ms linear' },
    '& .water-body': { fill: theme.palette.cafai.waterWash },
    '& .water-top': { fill: 'none', stroke: theme.palette.cafai.graph.flow, strokeWidth: 2 },
    '& .milk-body': { fill: theme.palette.cafai.milkWash },
    '& .milk-top': { fill: 'none', stroke: theme.palette.text.secondary, strokeWidth: 2, opacity: 0.55 },
    '& .wisp': { fill: 'none', stroke: theme.palette.text.secondary, strokeWidth: 3, strokeLinecap: 'round', opacity: 0 },
    '& .stream': { fill: 'none', stroke: theme.palette.cafai.graph.flow, strokeWidth: 4, strokeLinecap: 'round', strokeDasharray: '12 9' },
    '& .streak': { fill: 'none', stroke: theme.palette.cafai.graph.flow, strokeWidth: 2, strokeLinecap: 'round', strokeDasharray: '9 15', opacity: 0.7 },
    '& .screen': { stroke: theme.palette.text.secondary, strokeWidth: 5, strokeLinecap: 'round' },
    // The loops run only while the machine does.
    '&[data-moving="true"] .wave': { animation: `${slide} 4.2s linear infinite` },
    '&[data-moving="true"] .milk-level .wave': { animationDuration: '2.2s' },
    '&[data-moving="true"] .wisp': { animation: `${rise} 3.6s cubic-bezier(0.3, 0.6, 0.5, 1) infinite` },
    '&[data-moving="true"] .wisp-2': { animationDelay: '1.2s' },
    '&[data-moving="true"] .wisp-3': { animationDelay: '2.4s' },
    '&[data-moving="true"] .stream': { animation: `${fall} 0.62s linear infinite` },
    '&[data-moving="true"] .streak': { animation: `${fall} 0.7s linear infinite` },
    '&[data-moving="true"] .streak-2': { animationDuration: '0.82s', animationDelay: '-0.3s' },
    '&[data-moving="true"] .streak-3': { animationDuration: '0.66s', animationDelay: '-0.5s' },
    '& .done-check': { animation: `${enter} 200ms ease-out both` },
    [REDUCED_MOTION]: {
      '& .arc, & .tip, & .level': { transition: 'none' },
      '&[data-moving="true"] .wave, &[data-moving="true"] .wisp, &[data-moving="true"] .stream, &[data-moving="true"] .streak, & .done-check': { animation: 'none' },
      '& .wisp': { display: 'none' },
    },
  };
};

export interface DrinkDialProps {
  kind: DrinkKind;
  run: DrinkRun | null;
  /** What stops the drink, or null when nobody gave it. */
  target: number | null;
  /** Its size in px: 272 on a tablet, 212 on an upright phone, 184 on a phone on its side. */
  size: number;
}

export function DrinkDial({ kind, run, target, size }: DrinkDialProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  // SVG ids are document-wide; React's own ids hold characters url(#…) does not take.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const live = run?.live ?? false;
  const done = run !== null && !run.live;
  const water = kind !== 'steam';
  const arc = useRef<SVGCircleElement>(null);
  const tip = useRef<SVGGElement>(null);
  const levels = useRef<SVGGElement[]>([]);
  const value = useRef<HTMLSpanElement>(null);
  const unit = useRef<HTMLSpanElement>(null);
  const of = useRef<HTMLDivElement>(null);
  const levelRef = (index: number) => (node: SVGGElement | null) => {
    if (node) levels.current[index] = node;
  };

  useLayoutEffect(() => {
    const draw = () => {
      const reading = dialReading(kind, run, target);
      if (value.current) value.current.textContent = reading.number;
      if (unit.current) unit.current.textContent = reading.unit ?? '';
      if (of.current) of.current.textContent = reading.of ?? '';
      const share = reading.share;
      if (arc.current) {
        arc.current.style.display = share === null ? 'none' : '';
        if (share !== null) arc.current.style.strokeDasharray = `${(share * 100).toFixed(2)} 100`;
      }
      if (tip.current) {
        tip.current.style.display = share === null || !live ? 'none' : '';
        if (share !== null) tip.current.style.transform = `rotate(${(share * 360).toFixed(2)}deg)`;
      }
      const level = kind === 'hotWater' ? (share ?? 0) : MILK_FROM + MILK_RISE * (share ?? 0);
      for (const node of levels.current) node.style.transform = `translateY(${(-level * DEPTH).toFixed(1)}px)`;
    };
    draw();
    if (!live || run === null) return undefined;
    return trace.onData((changed) => {
      if (changed === run) draw();
    });
  }, [trace, kind, run, target, live]);

  const fontSize = size >= 260 ? '2.875rem' : size >= 200 ? '2.125rem' : '2rem';
  return (
    <Box data-testid={TID.drinkDial} data-moving={live ? 'true' : 'false'} sx={[{ width: size, height: size }, dialSx(water)]}>
      <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden focusable="false">
        <defs>
          <clipPath id={`${id}-inside`}>
            <circle cx={C} cy={C} r={INSIDE} />
          </clipPath>
          <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset={BAND.from - 0.04} stopColor="#fff" />
            <stop offset={BAND.from + 0.02} stopColor="#000" />
            <stop offset={BAND.to - 0.02} stopColor="#000" />
            <stop offset={BAND.to + 0.04} stopColor="#fff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id={`${id}-behind`} maskUnits="userSpaceOnUse" x="0" y="0" width={BOX} height={BOX}>
            <rect width={BOX} height={BOX} fill={`url(#${id}-band)`} />
          </mask>
        </defs>
        {TICKS.map((tick, i) => (
          <line key={i} className={tick.major ? 'tick major' : 'tick'} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
        <circle className="track" cx={C} cy={C} r={RING} />
        <g clipPath={`url(#${id}-inside)`}>
          {kind === 'steam' ? (
            <>
              <g className="level milk-level" ref={levelRef(0)}>
                <path className="milk-body wave" d={MILK_BODY} />
                <path className="milk-top wave" d={MILK_TOP} />
              </g>
              <g mask={`url(#${id}-behind)`}>
                <g className="level" ref={levelRef(1)}>
                  {WISPS.map((d, i) => (
                    <path key={d} className={`wisp wisp-${i + 1}`} d={d} />
                  ))}
                </g>
              </g>
            </>
          ) : kind === 'hotWater' ? (
            <>
              <line className="stream" x1={C} y1={30} x2={C} y2={FLOOR} mask={`url(#${id}-behind)`} />
              <g className="level" ref={levelRef(0)}>
                <path className="water-body wave" d={WATER_BODY} />
                <path className="water-top wave" d={WATER_TOP} />
              </g>
            </>
          ) : (
            <>
              <line className="screen" x1={104} y1={44} x2={168} y2={44} />
              <g mask={`url(#${id}-behind)`}>
                {STREAKS.map((x, i) => (
                  <line key={x} className={`streak streak-${(i % 3) + 1}`} x1={x} y1={54} x2={x + (x - C) / 16} y2={FLOOR} />
                ))}
              </g>
            </>
          )}
        </g>
        <circle ref={arc} className="arc" cx={C} cy={C} r={RING} pathLength={100} transform={`rotate(-90 ${C} ${C})`} />
        <g ref={tip} className="tip">
          <circle cx={C} cy={C - RING} r={8} />
        </g>
      </svg>
      <Box sx={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {done ? <CheckCircleRounded className="done-check" aria-hidden sx={{ fontSize: 28, color: 'success.main', mb: 0.75 }} /> : null}
        <Typography component="div" variant="display" sx={{ fontSize, whiteSpace: 'nowrap' }}>
          <span ref={value} data-testid={TID.drinkDialValue} />
          <Box component="span" ref={unit} sx={{ fontSize: '0.5em', fontWeight: 550, color: 'text.secondary', ml: '4px', letterSpacing: 0 }} />
        </Typography>
        <Typography ref={of} data-testid={TID.drinkDialOf} variant="label" component="div" color="text.secondary" sx={{ mt: 1, minHeight: '1.3em', fontVariantNumeric: 'tabular-nums' }} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Write `src/ui/drinks/DrinkTraceChart.tsx`**

```tsx
/**
 * The run so far, under the readouts (the design's section 4): Decent's
 * colours, three grid lines, no y labels (the readouts carry the values), the
 * time under it. Drawn straight into its paths on each frame, never through
 * React, as the shot graph is. The plot stretches to its box; its lines keep
 * their width (non-scaling-stroke), and each line's newest point is a dot
 * while the drink runs.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useServices } from '../../app/services.tsx';
import { sparklinePath } from '../chat/sparkline.ts';
import { TID } from '../testIds.ts';
import { traceLines, traceSpan, type Swatch } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

/** The plot's width in its own units; it stretches to the box. */
const WIDTH = 600;
const KEYS: readonly Swatch[] = ['weight', 'flow', 'pressure'];

export interface DrinkTraceChartProps {
  kind: DrinkKind;
  run: DrinkRun | null;
  /** The time set (steam, flush) or hot water's time limit. */
  timeSet: number | null;
  /** The hot water volume set, the weight line's top. */
  volumeSet: number | null;
  height: number;
}

export function DrinkTraceChart({ kind, run, timeSet, volumeSet, height }: DrinkTraceChartProps) {
  const { telemetry } = useServices();
  const theme = useTheme();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const paths = useRef<Partial<Record<Swatch, SVGPathElement | null>>>({});
  const dots = useRef<Partial<Record<Swatch, SVGPathElement | null>>>({});
  const span = useRef<HTMLSpanElement>(null);
  const live = run?.live ?? false;
  const colour: Record<Swatch, string> = {
    pressure: theme.palette.cafai.graph.pressure,
    flow: theme.palette.cafai.graph.flow,
    weight: theme.palette.cafai.graph.weight,
  };

  useLayoutEffect(() => {
    const draw = () => {
      const tMax = traceSpan(run, timeSet);
      if (span.current) span.current.textContent = `${Math.round(tMax)} s`;
      const lines = run === null ? [] : traceLines(kind, run, volumeSet);
      for (const key of KEYS) {
        const line = lines.find((l) => l.key === key);
        const path = paths.current[key];
        const dot = dots.current[key];
        const d = line && run ? sparklinePath(run.t, line.values, { width: WIDTH, height, tMax, yMax: line.yMax }) : '';
        path?.setAttribute('d', d);
        // The newest point: a zero-length segment whose round cap draws a dot.
        const last = d.match(/[ML](-?[\d.]+),(-?[\d.]+)$/);
        dot?.setAttribute('d', live && last ? `M${last[1]},${last[2]}L${last[1]},${last[2]}` : '');
      }
    };
    draw();
    if (!live || run === null) return undefined;
    return trace.onData((changed) => {
      if (changed === run) draw();
    });
  }, [trace, kind, run, timeSet, volumeSet, height, live]);

  const grid = theme.palette.cafai.graph.grid;
  return (
    <Box data-testid={TID.drinkTrace}>
      <Box component="svg" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden sx={{ display: 'block', width: '100%', height, overflow: 'visible' }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={WIDTH} y1={f * height} y2={f * height} stroke={grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {KEYS.map((key) => (
          <path
            key={key}
            ref={(node) => {
              paths.current[key] = node;
            }}
            data-testid={`trace-${key}`}
            fill="none"
            stroke={colour[key]}
            strokeWidth={key === 'weight' ? 1.5 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {KEYS.map((key) => (
          <path
            key={`${key}-dot`}
            ref={(node) => {
              dots.current[key] = node;
            }}
            stroke={colour[key]}
            strokeWidth={7}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="label" component="span" color="text.secondary">
          0 s
        </Typography>
        <Typography ref={span} variant="label" component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 6: Write `src/ui/drinks/DrinkReadouts.tsx`**

```tsx
/**
 * A drink's readouts (the design's section 4): three, each a label (with its
 * series' swatch where the trace draws it), the value in readout-large and a
 * caption line kept even when empty, so the rows line up and nothing moves
 * when a caption comes or goes. The Shot view's readouts, for a drink.
 *
 * They re-render only when a value or a caption they show changes, not with
 * every frame: the hook below hands React the same list until one does.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useServices } from '../../app/services.tsx';
import { splitUnit } from '../machine/format.ts';
import { TID } from '../testIds.ts';
import { drinkReadouts, type DrinkPresets, type Readout, type Swatch } from './drinkModel.ts';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

const SWATCH: Record<Swatch, string> = {
  pressure: 'cafai.graph.pressure',
  flow: 'cafai.graph.flow',
  weight: 'cafai.graph.weight',
};

/** The readouts now: the same array until something on show changes. */
export function useDrinkReadouts(kind: DrinkKind, run: DrinkRun | null, presets: DrinkPresets | null): readonly Readout[] {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  const last = useRef<{ key: string; readouts: Readout[] } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stopTelemetry = telemetry.subscribe(onChange);
      const stopData = trace.onData(onChange);
      return () => {
        stopTelemetry();
        stopData();
      };
    },
    [telemetry, trace],
  );
  const read = () => {
    const now = telemetry.getState();
    const readouts = drinkReadouts(kind, {
      frame: now.machineConnected ? now.machine : null,
      scaleWeight: now.scaleConnected ? (now.scale?.weight ?? null) : null,
      scaleConnected: now.scaleConnected,
      shotSettings: now.shotSettings,
      presets,
      run,
    });
    const key = readouts.map((r) => `${r.key}=${r.value}|${r.caption}|${r.swatch ?? ''}`).join(';');
    if (last.current?.key !== key) last.current = { key, readouts };
    return last.current.readouts;
  };
  return useSyncExternalStore(subscribe, read);
}

function ReadoutCell({ readout, small }: { readout: Readout; small: boolean }) {
  const { value, unit } = splitUnit(readout.value);
  return (
    <Box data-testid={TID.drinkReadout(readout.key)} sx={{ minWidth: 0 }}>
      <Typography variant="label" component="div" color="text.secondary" noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {readout.swatch ? <Box component="span" aria-hidden sx={{ width: 12, height: 3, borderRadius: '2px', flex: 'none', bgcolor: SWATCH[readout.swatch] }} /> : null}
        {readout.label}
      </Typography>
      <Typography variant="readoutLarge" component="div" noWrap sx={small ? { fontSize: '1.5rem' } : undefined}>
        {value}
        {unit ? (
          <Box component="span" sx={{ fontSize: '0.6em', fontWeight: 550, color: 'text.secondary', ml: '3px', letterSpacing: 0 }}>
            {unit}
          </Box>
        ) : null}
      </Typography>
      <Typography variant="caption" component="div" color="text.secondary" noWrap sx={{ minHeight: '1.35em', fontVariantNumeric: 'tabular-nums' }}>
        {readout.caption || ' '}
      </Typography>
    </Box>
  );
}

export function DrinkReadouts({ kind, run, presets, small }: { kind: DrinkKind; run: DrinkRun | null; presets: DrinkPresets | null; small: boolean }) {
  const readouts = useDrinkReadouts(kind, run, presets);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${readouts.length}, minmax(0, 1fr))`, columnGap: small ? 2 : 2.25, rowGap: 1.5 }}>
      {readouts.map((readout) => (
        <ReadoutCell key={readout.key} readout={readout} small={small} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 7: Write `src/ui/drinks/DrinkSettingsCard.tsx`**

```tsx
/**
 * The drink's own settings on its view (D147): the steppers of Settings >
 * Steam, hot water and flush for this one drink (DrinkFields.tsx), read and
 * written as they are there (useDrinkPresets.ts). Held while anything runs,
 * as everywhere (D114: the machine is using them; the owner kept that rule
 * for the views, 2026-10-13), and live the moment the run ends, so a steam
 * that was too short is one tap from a longer one. The line under the title
 * says which, in a box that keeps its height, so the steppers never move
 * when the run ends.
 */
import { useId } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { DrinkFieldsGrid, drinksFor, PRESET_KEY } from '../settings/DrinkFields.tsx';
import type { DrinkPresetsState } from '../settings/useDrinkPresets.ts';
import { TID } from '../testIds.ts';
import type { DrinkKind } from './kinds.ts';

const WORDS = {
  running: 'Change these once it stops: the machine is using them now.',
  notConnected: 'Connect the DE1 to change these.',
  reading: "Reading Decaid's drink settings…",
  ready: 'Changes go to Decaid at once.',
} as const;

export function DrinkSettingsCard({ kind, drinks, layout }: { kind: DrinkKind; drinks: DrinkPresetsState; layout: 'rows' | 'columns' }) {
  const headingId = useId();
  const drink = drinksFor(drinks.model).find((d) => d.key === PRESET_KEY[kind])!;
  const rows = layout === 'rows';
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={headingId}
      data-testid={TID.drinkSettingsCard}
      sx={{ p: rows ? '10px 14px 12px' : '12px 16px 14px', bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: rows ? 'block' : 'flex', alignItems: 'baseline', columnGap: 1.25, mb: 1.25 }}>
        <Typography id={headingId} variant="subtitle2" component="h3" sx={{ flex: 'none' }}>
          {drink.name} settings
        </Typography>
        {/* Two lines kept on a narrow card, one on a wide one: the steppers never move as the words change. */}
        <Typography variant="body2" role="status" color="text.secondary" sx={{ minHeight: rows ? '3em' : '1.5em' }}>
          {WORDS[drinks.reason ?? 'ready']}
        </Typography>
      </Box>
      {drinks.loadError ? (
        <Alert
          severity="error"
          sx={{ mb: 1.25, alignItems: 'center', '& .MuiAlert-action': { pt: 0, alignItems: 'center' } }}
          action={
            <Button color="inherit" onClick={drinks.retry} sx={{ minHeight: 48 }}>
              Retry
            </Button>
          }
        >
          {drinks.loadError}
        </Alert>
      ) : null}
      <DrinkFieldsGrid
        drink={drink}
        data={drinks.presets?.[drink.key] ?? null}
        loaded={drinks.loaded}
        disabled={drinks.disabled}
        pending={drinks.pending}
        failed={drinks.failed}
        onCommit={drinks.commit}
        layout={layout}
      />
    </Paper>
  );
}
```

- [ ] **Step 8: Write `src/ui/drinks/DrinkView.tsx`**

```tsx
/**
 * A drink's view (#/steam, #/hot-water, #/flush; D146-D149): while the machine
 * steams, pours hot water or flushes, the main pane shows it happening, as the
 * Shot view shows a shot. The header names the drink and its phase, with Go
 * back once nothing runs; the dial counts toward what stops the drink; the
 * readouts and the trace say what the machine reports; the drink's own
 * settings sit under them.
 *
 * Laid out for its own box (useOwnLayout.ts), with the Shot view's
 * thresholds:
 *
 * - wide (a tablet): the dial at the left, the readouts over the trace beside
 *   it, the settings across the bottom with their fields side by side;
 * - narrow (an upright phone, under NARROW_BELOW): one column, the settings
 *   one row each, the view scrolling inside itself;
 * - short (a phone on its side, under SHORT_BELOW): the dial at the left, and
 *   beside it the header, the readouts and the settings, which scroll; no
 *   trace.
 *
 * Stop is not here: it stays in the top bar, in the running start's place
 * (D90). Every part keeps its place in the tree in every layout, so a rotation
 * keeps a half-typed setting.
 */
import { useMemo, useRef, useSyncExternalStore, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import AirRounded from '@mui/icons-material/AirRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ShowerRounded from '@mui/icons-material/ShowerRounded';
import WaterDropRounded from '@mui/icons-material/WaterDropRounded';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { useOwnLayout } from '../machine/useOwnLayout.ts';
import type { Route } from '../router.ts';
import { useDrinkPresets } from '../settings/useDrinkPresets.ts';
import { LiveDot } from '../shell/ShotTime.tsx';
import { TID } from '../testIds.ts';
import { DrinkDial } from './DrinkDial.tsx';
import { goBackLabel } from './drinkFocus.ts';
import { drinkTarget, hotWaterTimeLimit, phaseWords } from './drinkModel.ts';
import { DrinkReadouts } from './DrinkReadouts.tsx';
import { DrinkSettingsCard } from './DrinkSettingsCard.tsx';
import { DrinkTraceChart } from './DrinkTraceChart.tsx';
import { drinkTraceFor, type DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

const MAX_WIDTH = 960;
const NARROW_BELOW = 600;
const SHORT_BELOW = 440;

type Arrangement = 'wide' | 'narrow' | 'short';

function arrangement(width: number, height: number): Arrangement {
  if (height > 0 && height < SHORT_BELOW) return 'short';
  if (width > 0 && width < NARROW_BELOW) return 'narrow';
  return 'wide';
}

/** Each drink's name and the machine row's own icon (MachineRow.tsx). */
const DRINK: Record<DrinkKind, { name: string; icon: ReactElement }> = {
  steam: { name: 'Steam', icon: <AirRounded /> },
  hotWater: { name: 'Hot water', icon: <WaterDropRounded /> },
  flush: { name: 'Flush', icon: <ShowerRounded /> },
};

const DIAL_SIZE: Record<Arrangement, number> = { wide: 272, narrow: 212, short: 184 };

const viewSx = (layout: Arrangement) =>
  ({
    height: '100%',
    minHeight: 0,
    width: '100%',
    maxWidth: MAX_WIDTH,
    mx: 'auto',
    display: 'grid',
    overscrollBehavior: 'contain',
    ...(layout === 'wide'
      ? {
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
          gridTemplateAreas: '"head head" "dial side" "set set"',
          columnGap: 4,
          rowGap: 1.25,
          px: 2.5,
          py: 1.75,
          overflowY: 'auto',
        }
      : layout === 'narrow'
        ? {
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateAreas: '"head" "dial" "side" "set"',
            alignContent: 'start',
            rowGap: 1.5,
            px: 2,
            py: 1.5,
            overflowY: 'auto',
          }
        : {
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gridTemplateRows: 'auto auto minmax(0, 1fr)',
            gridTemplateAreas: '"dial head" "dial side" "dial set"',
            columnGap: 2.5,
            rowGap: 1.25,
            px: 1.75,
            py: 1,
            overflow: 'hidden',
          }),
  }) as const;

function Phase({ kind, run }: { kind: DrinkKind; run: DrinkRun | null }) {
  const words = useTelemetry((s) => phaseWords(kind, run, s.machineConnected ? s.machine : null));
  const done = words === 'Done';
  return (
    <Typography
      data-testid={TID.drinkPhase}
      variant="body2"
      component="p"
      role="status"
      noWrap
      sx={{ fontWeight: 550, color: done ? 'success.main' : 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
    >
      {words ? <span aria-hidden>·</span> : null}
      {done ? <CheckRounded aria-hidden sx={{ fontSize: 18 }} /> : null}
      {words}
    </Typography>
  );
}

export interface DrinkViewProps {
  kind: DrinkKind;
  /** Where Go back goes, for its name. */
  back: Route;
  onGoBack(): void;
}

export function DrinkView({ kind, back, onGoBack }: DrinkViewProps) {
  const { telemetry } = useServices();
  const trace = useMemo(() => drinkTraceFor(telemetry), [telemetry]);
  // React hears of a run starting and ending only; the dial, the trace and the readouts follow the frames themselves.
  useSyncExternalStore(trace.subscribe, trace.getState);
  const run = trace.runOf(kind);
  const live = run?.live ?? false;
  const view = useRef<HTMLDivElement>(null);
  const layout = useOwnLayout(view, arrangement);
  const drinks = useDrinkPresets();
  const shotSettings = useTelemetry((s) => s.shotSettings);
  const target = drinkTarget(kind, shotSettings, drinks.presets);
  const timeSet = kind === 'hotWater' ? hotWaterTimeLimit(shotSettings, drinks.presets) : target;
  const { name, icon } = DRINK[kind];

  return (
    <Box ref={view} data-testid={TID.drinkView} data-drink={kind} sx={viewSx(layout)}>
      <Box sx={{ gridArea: 'head', display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 48, minWidth: 0 }}>
        {live ? <LiveDot size={9} /> : null}
        <Box sx={{ display: 'flex', color: 'text.secondary', flex: 'none' }}>{icon}</Box>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 'none' }}>
          {name}
        </Typography>
        <Phase kind={kind} run={run} />
        <Box sx={{ flex: '1 1 auto' }} />
        {live ? null : (
          <Button
            data-testid={TID.drinkGoBack}
            variant="tonal"
            aria-label={goBackLabel(back)}
            startIcon={<ArrowBackRounded />}
            onClick={onGoBack}
            sx={{ flex: 'none', px: 2 }}
          >
            Go back
          </Button>
        )}
      </Box>
      <Box sx={{ gridArea: 'dial', alignSelf: 'center', justifySelf: 'center' }}>
        <DrinkDial kind={kind} run={run} target={target} size={DIAL_SIZE[layout]} />
      </Box>
      <Box sx={{ gridArea: 'side', alignSelf: 'center', minWidth: 0, display: 'flex', flexDirection: 'column', gap: layout === 'wide' ? 2 : 1.5 }}>
        <DrinkReadouts kind={kind} run={run} presets={drinks.presets} small={layout !== 'wide'} />
        {layout === 'short' ? null : (
          <DrinkTraceChart kind={kind} run={run} timeSet={timeSet} volumeSet={kind === 'hotWater' ? target : null} height={layout === 'wide' ? 88 : 56} />
        )}
      </Box>
      <Box sx={{ gridArea: 'set', minHeight: 0, ...(layout === 'short' ? { overflowY: 'auto', overscrollBehavior: 'contain' } : null) }}>
        <DrinkSettingsCard kind={kind} drinks={drinks} layout={layout === 'wide' ? 'columns' : 'rows'} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 9: Run the view's tests, the type check and lint**

Run: `npx vitest run src/ui/drinks > .verify/t8.log 2>&1; echo exit=$?`
Then: `npx tsc -p tsconfig.json --noEmit > .verify/t8-tsc.log 2>&1; echo exit=$?` and `npx eslint src/ui/drinks > .verify/t8-lint.log 2>&1; echo exit=$?`
Expected: exit=0 for all three. Where jsdom lacks `ResizeObserver`, `useOwnLayout` falls back to window resizes and the view is `wide` (0 x 0 measures as wide), so the tests see the wide tree. If `pathLength` or `vectorEffect` trip TypeScript's SVG typings, pass them as `{...{ pathLength: 100 }}` style props or `vectorEffect="non-scaling-stroke"` as written (React types accept both).

- [ ] **Step 10: Commit**

```bash
git add src/ui/testIds.ts src/ui/drinks/DrinkDial.tsx src/ui/drinks/DrinkTraceChart.tsx src/ui/drinks/DrinkReadouts.tsx src/ui/drinks/DrinkSettingsCard.tsx src/ui/drinks/DrinkView.tsx src/ui/drinks/DrinkView.test.tsx
git commit -m "feat: the steam, hot water and flush views: a dial with a scene that moves while the machine runs, the drink's readouts and trace, and its settings held until it stops (D146-D149)"
```

---

### Task 9: The shell draws the views

**Files:**
- Modify: `src/ui/shell/AppShell.tsx:45-63, 566-590`, `src/ui/shell/AppShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/shell/AppShell.test.tsx`, after the test `'the coach route shows the routed screen and no Shot view'` (it uses the file's own `renderShell`):

```tsx
  it("on a drink's route the main pane shows that drink's view over the routed screen, kept mounted and hidden, with no place current", () => {
    renderShell({ name: 'drink', drink: 'steam' });
    const main = screen.getByRole('main');
    expect(within(main).getByTestId(TID.drinkView)).toHaveAttribute('data-drink', 'steam');
    const routed = screen.getByText('routed screen');
    expect(main).toContainElement(routed);
    expect(routed).not.toBeVisible();
    for (const id of [TID.navCoach, TID.navShot, TID.navHistory, TID.navSettings]) {
      expect(screen.getByTestId(id)).not.toHaveAttribute('aria-current');
    }
    expect(within(screen.getByRole('banner')).getByTestId(TID.machineRow)).toBeInTheDocument();
  });

  it('a drink starting switches the main pane to its view by itself and guards the pane, never the top bar', () => {
    window.location.hash = '#/';
    const { services } = renderShell();
    act(() =>
      services.telemetry.setState({
        machine: { ...IDLE_TELEMETRY.machine!, timestamp: '2026-10-13T08:00:01.000000', state: { state: 'steam', substate: 'pouring' } },
      }),
    );
    expect(window.location.hash).toBe('#/steam');
    expect(within(screen.getByRole('main')).getByTestId(TID.tapGuard)).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByTestId(TID.tapGuard)).toBeNull();
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/shell/AppShell.test.tsx`
Expected: FAIL (no drink view in the shell).

- [ ] **Step 3: Change `src/ui/shell/AppShell.tsx`**

Imports:

```tsx
import { DrinkView } from '../drinks/DrinkView.tsx';
import { drinkTraceFor } from '../drinks/drinkTrace.ts';
import { useDrinkFocus } from '../drinks/useDrinkFocus.ts';
```

Above `Shell`:

```tsx
/** The later of two guards: whichever focus switched last guards the pane. */
function laterGuard(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
```

In `Shell`, after `shotTraceFor(telemetry);`:

```tsx
  // And its one recording of steam, hot water and flush, for the same reason (D148).
  drinkTraceFor(telemetry);
  const { awaitingOutcome, guardUntil: shotGuard } = useShotFocus(route);
  const drinkFocus = useDrinkFocus(route);
  const guardUntil = laterGuard(shotGuard, drinkFocus.guardUntil);
```

(replacing the old `const { awaitingOutcome, guardUntil } = useShotFocus(route);`), and the overlay:

```tsx
  // The Shot route, or a drink's, in both layouts: the view at the main pane's full width, over the coach.
  const overlay =
    route.name === 'shot' ? (
      <ShotView awaitingOutcome={awaitingOutcome} />
    ) : route.name === 'drink' ? (
      <DrinkView key={route.drink} kind={route.drink} back={drinkFocus.back} onGoBack={drinkFocus.goBack} />
    ) : null;
```

Add to the file's top comment, after the paragraph about the coach staying mounted under the Shot view: "A drink's view (steam, hot water, flush) lies over the coach the same way while it runs and after (D146): the app switches to it when the machine starts one, as it does for a shot."

- [ ] **Step 4: Run the shell's tests and the whole unit suite**

Run: `npx vitest run src/ui/shell > .verify/t9.log 2>&1; echo exit=$?` then `npm test > .verify/t9-all.log 2>&1; echo exit=$?`
Expected: exit=0 for both.

- [ ] **Step 5: Commit**

```bash
git add src/ui/shell/AppShell.tsx src/ui/shell/AppShell.test.tsx
git commit -m "feat: the shell records the drinks, lays a drink's view over the coach and guards the pane for whichever switch came last (D146)"
```

---

### Task 10: End to end

**Files:**
- Create: `e2e/drink-views.spec.ts`
- Modify: `playwright.config.ts:9` (PHONE_SPECS)

- [ ] **Step 1: Add the spec to the phones**

In `playwright.config.ts`, add `drink-views` to `PHONE_SPECS`:

```ts
const PHONE_SPECS = /(phone-baseline|shot-focus|appearance|chat-first|decaid-features|decaid-safety|decaid-intake|taste-words|traffic-log|drink-views)\.spec\.ts/;
```

- [ ] **Step 2: Write `e2e/drink-views.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { isPhone, machineRow, openApp } from './helpers.ts';

/**
 * Steam, hot water and flush take the screen while they run (D146-D150): the
 * mock runs each for the time or volume set in its workflow (steam 50 s,
 * hot water 50 ml, flush 10 s), compressed 25 times, so a run is over in a
 * couple of seconds.
 */

/** Start a drink on the machine itself (its group head, or Decaid's own screen): no tap in CafAI. */
async function startOnMachine(page: Page, drink: 'steam' | 'hotWater' | 'flush'): Promise<void> {
  await page.evaluate((name) => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.command(name), drink);
}

/** The mock machine is running nothing. */
async function machineIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.player.activity ?? null)).toBeNull();
}

const view = (page: Page) => page.getByTestId(TID.drinkView);
const hash = (page: Page) => new URL(page.url()).hash;

test('Steam from the row takes the screen, Stop in its place; its settings wait for the end, then Go back', async ({ page }) => {
  await openApp(page);
  await machineRow(page).getByTestId(TID.steamButton).click();
  await expect(view(page)).toHaveAttribute('data-drink', 'steam');
  expect(hash(page)).toBe('#/steam');
  await expect(machineRow(page).getByTestId(TID.stopButton)).toBeVisible();

  const time = view(page).getByRole('spinbutton', { name: 'Steam time' });
  await expect(time).toBeDisabled();
  await expect(view(page).getByTestId(TID.drinkGoBack)).toHaveCount(0);

  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  await expect(view(page).getByTestId(TID.drinkDialOf)).toHaveText('of 50 s');
  await expect(time).toBeEnabled();
  await view(page).getByRole('button', { name: 'More steam time' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow().steamSettings.duration))
    .toBe(55);

  await view(page).getByRole('button', { name: 'Go back to the coach' }).click();
  await expect(view(page)).toHaveCount(0);
  expect(hash(page)).toBe('#/');
});

test('hot water started on the machine takes the screen from Settings, counts its water, and Go back returns there', async ({ page }) => {
  await openApp(page, '#/settings');
  await startOnMachine(page, 'hotWater');
  await expect(view(page)).toHaveAttribute('data-drink', 'hotWater');
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  const water = Number(await view(page).getByTestId(TID.drinkDialValue).textContent());
  expect(water).toBeGreaterThanOrEqual(45);
  expect(water).toBeLessThanOrEqual(55);
  await expect(view(page).getByTestId(TID.drinkDialOf)).toHaveText(/^in \d+\.\d s$/);
  await view(page).getByRole('button', { name: 'Go back to Settings' }).click();
  await expect(page.getByTestId(TID.drinkSettings)).toBeVisible();
});

test('a flush counts its time toward the flush time and holds the result', async ({ page }) => {
  await openApp(page);
  await machineRow(page).getByTestId(TID.flushButton).click();
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  await expect(view(page).getByTestId(TID.drinkDialValue)).toHaveText(/^(9\.\d|10\.\d)$/);
  await expect(view(page).getByTestId(TID.drinkReadout('water'))).toContainText('ml');
  await page.waitForTimeout(1000);
  expect(hash(page)).toBe('#/flush');
});

test('no switch while the barista types', async ({ page }) => {
  await openApp(page, '#/settings');
  await page.getByTestId(TID.apiKeyInput).click();
  await startOnMachine(page, 'flush');
  await machineIdle(page);
  expect(hash(page)).toBe('#/settings');
  await expect(view(page)).toHaveCount(0);
});

test('on a phone the tabs stay, none of them current, while a drink has the screen', async ({ page }) => {
  test.skip(!isPhone(page), 'the phone layout only');
  await openApp(page);
  await startOnMachine(page, 'steam');
  await expect(view(page)).toBeVisible();
  for (const id of [TID.tabCoach, TID.tabShot, TID.tabHistory, TID.tabSettings]) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).not.toHaveAttribute('aria-current', 'page');
  }
});
```

- [ ] **Step 3: Build and run the spec**

Run: `npm run build:mock > .verify/t10-build.log 2>&1; echo exit=$?` then `npx playwright test e2e/drink-views.spec.ts > .verify/t10.log 2>&1; echo exit=$?`
Expected: exit=0 on every project (three tablets, two phones; the phone-only test skips on tablets). Never run two Playwright runs at once from this checkout (they share port 4174 and `test-results/`).

- [ ] **Step 4: Run the whole e2e suite**

Run: `npm run e2e > .verify/t10-all.log 2>&1; echo exit=$?`
Expected: exit=0. `baseline.spec.ts`'s steam test still passes (the stats card's state line is read by its text, which the hidden coach keeps). If another spec now lands on a drink's view where it expected the coach, make that spec go back (`TID.drinkGoBack`) rather than change the behaviour.

- [ ] **Step 5: Commit**

```bash
git add e2e/drink-views.spec.ts playwright.config.ts
git commit -m "test: e2e for the drinks' views on the tablets and the phones: the switch from the row and from the machine, held then live settings, Go back, no switch while typing (D146-D150)"
```

---

### Task 11: The docs

**Files:**
- Modify: `DECISIONS.md` (append a section), `DESIGN.md` (frontmatter colours; section 1's layouts paragraph; section 2's roles table; section 5: a new "### The drinks' views" after "### The coach's note", and "### Steam, hot water and flush"; "### Motion"), `README.md` (the feature list), `CHANGELOG.md` (`## Unreleased`)

- [ ] **Step 1: DECISIONS.md**

Append:

```markdown
### Steam, hot water and flush views (2026-10-13)

D141-D144 are left to the work running beside this one, as before; this starts at D146.

- **D146. Steam, hot water and flush take the screen while they run.** When
  the machine starts one, from CafAI's top bar, the group head or Decaid, the
  main pane switches to that drink's view (`#/steam`, `#/hot-water`,
  `#/flush`) with `location.replace` and the 350 ms tap guard, as a shot does
  (D85); not while a text field has focus, nor when the view is already up;
  a run already under way when CafAI starts takes it too. There is no return
  of its own: the view stays after the run, and **Go back** (shown only once
  nothing runs, so a thumb aiming for Stop cannot land on it) returns, with
  `location.replace`, to the screen the view took over, or the coach. The
  views are not places in the navigation, and a drink's route is never
  remembered across a reload. Why: the owner's ask ("have the screen go to a
  different page that shows it happening") and answer ("Stay on the view, you
  can have a Go back button"); Stop stays in the top bar (D90).
- **D147. The view's settings are Settings' steppers, held while anything
  runs.** The stepper and its reads and writes moved out of
  `DrinkSettingsSection.tsx` into `DrinkFields.tsx` and `useDrinkPresets.ts`;
  the stepper takes its arrangement from its parent (rows or columns), since
  the view's card is laid out for its own width. Decaid's own steam screen
  changes the steam time (+10 s) and flow while steaming; the owner kept
  D114's rule instead, so the steppers show, held, with the reason, and come
  alive the moment the run ends.
- **D148. What the views show, and from where.** One recording of drinks for
  the app (`drinkTrace.ts`, as `shotTrace.ts` for shots): a run is the frames
  in a drink's states (steam with steamRinse, hot water, flush); its time
  counts on the machine's timestamps from the first frame past heating, and
  stops while steam is paused or the wand purges or rinses; its water is the
  flow summed over that time. Targets come from the machine's live settings
  (`ws/v1/machine/shotSettings`) before Decaid's workflow. Steam shows the
  heater against its setting, pressure and flow; hot water its flow, the scale
  and the time against its limit, and no live temperature, because during hot
  water `mixTemperature` is not the water's (Decaid's spec); flush its water,
  flow and the group against its target. Done, the readouts become the run's:
  averages over the working frames and the values at the end.
- **D149. The dial, and its motion.** A ring that fills toward the target
  with a tip at its end, ink for steam and the flow's blue for water, over a
  scene that moves only while the machine runs (steam rising from milk, water
  filling under a stream, a shower screen pouring), faded out behind the
  number. Loops stop under reduced motion and when the run ends; the arc, the
  level and the number keep moving because they are readings. Two palette
  roles, `waterWash` and `milkWash`, with ink and ink-muted on both in the
  contrast sweep.
- **D150. The mock runs drinks for their real time or volume.** Steam warms,
  steams for the time set and purges the wand (puffing); hot water pours until
  the volume or the time limit, its scale weighing it; a flush runs for its
  time at its flow, the group closing on its target; all re-read the workflow
  every frame. Before this every drink lasted 20 frames, about 4 s, whatever
  was set, which no view of a run could be tested against.
```

- [ ] **Step 2: DESIGN.md**

1. In the frontmatter `colors:` list, after `graph-weight`, add (values from `buildPalette('dark', namedTint('crema'))`, computed 2026-10-13):

```yaml
  water-wash: "#26323c"        # waterWash: graph-flow at 22% over background (16% light), the dial's water
  milk-wash: "#28221d"         # milkWash: ink at 9% over background, the steam dial's milk
```

2. In section 2's roles table, after the `graph-axis` row, add:

```markdown
| water-wash | waterWash | `cafai.waterWash` | #26323c | #d2e0e9 | the water inside the steam, hot water and flush dial (D149) |
| milk-wash | milkWash | `cafai.milkWash` | #28221d | #e7e2de | the milk inside the steam dial |
```

and in "### How the tinted roles are built" add a line: "`waterWash` is `graph-flow` at 22% over background (16% in light); `milkWash` is ink at 9% over background. Ink (7:1) and ink-muted (4.5:1) are checked on both: the dial's number and its "of" line sit over them (worst case 4.95:1, light mode, hue 152, ink-muted on the water)."
3. In section 1, "Two layouts", after the Tablet bullet's sentence on the Shot view, add: "When steam, hot water or flush starts, the main pane becomes that drink's view in the same way (D146)."
4. Add a new section after "### The coach's note":

```markdown
### The drinks' views

`src/ui/drinks/` (D146-D150): `DrinkView.tsx`, with `DrinkDial.tsx`, `DrinkReadouts.tsx`, `DrinkTraceChart.tsx` and `DrinkSettingsCard.tsx`; the rules in `drinkModel.ts`, the switch in `drinkFocus.ts`, the recording in `drinkTrace.ts`. While the machine steams, pours hot water or flushes, and after, until the barista leaves.

- **Switch**: a run's start puts the main pane on `#/steam`, `#/hot-water` or `#/flush` by itself (`location.replace`, the 350 ms tap guard), unless a text field has focus or the view is already up; a run already under way when CafAI starts takes it too. No return of its own.
- **Layout**: laid out for its own box with the Shot view's thresholds. Wide (a tablet): at most 960 px, 20 px sides, the header (48 px), the dial at the left and, 32 px beside it, the readouts over the trace (88 px), then the settings card across the width with its fields side by side. Narrow (under 600 px wide): one column, scrolling; the dial 212 px, the trace 56 px, the settings one row each. Short (under 440 px tall): the dial (184 px) at the left, the header, the readouts and the settings (scrolling) beside it; no trace.
- **Header**: the 9 px live dot while it runs, the machine row's icon for the drink (ink-muted), its name (subtitle at 700), then " · " and the phase (body-small at 550, ink-muted, a polite status): Heating, Steaming, Paused, Purging, Rinsing the wand, Pouring, Flushing, then Done (success, after a check) or Connection lost. **Go back** (tonal, a back arrow) at the end once nothing runs, named for where it goes ("Go back to Settings"), returning with `location.replace` to the screen the view took over.
- **Dial**: 272 px (212, 184 on the phones). Sixty ticks (every fifth longer, `line`; the rest `graph-grid`), a 10 px track in `raised`, the arc filled to the share of the target from the top with round caps and an 8 px tip ringed in the background colour (ink for steam, `graph-flow` for water), easing 250 ms linear between frames. In the middle the number in `display` (46 px; 34 and 32 px on the phones) with its unit at half size in ink-muted, "of 50 s" under it (`label`); done, a 28 px success check above it. The scene, clipped inside the ring and faded out behind the number: steam's milk (`milk-wash`, its surface a wave) rising slowly with three wisps of steam; hot water's water (`water-wash`, its surface a `graph-flow` wave) at the share of the volume, a dashed stream falling into it; flush's screen with five dashed streams.
- **Readouts**: three, the Shot view's: a `label` with the series swatch where the trace draws it, the value in `readout-large` (30 px; 24 px on the phones) with its unit at 0.6em, and a caption line kept even when empty. Steam: Steam (°C, "set 150"), Pressure, Flow ("set 0.8"). Hot water: Flow, Scale ("in the cup", or a dash and "No scale"), Time ("stops by 30 s"). Flush: Water ("so far"), Flow, Group ("target 93.0"). Done: averages over the working frames ("average") and values at the end ("at the end").
- **Trace**: the run so far: steam's flow and pressure, hot water's flow and (with a scale) weight scaled to the volume set, flush's flow; three grid lines in `graph-grid`, no y labels, "0 s" and the right edge's time under it in `label`; a 7 px dot on each line's newest point while it runs.
- **Settings card**: an outlined card, "Steam settings" (subtitle2) and its line in body-small ink-muted, then the drink's steppers (see Steam, hot water and flush): "Change these once it stops: the machine is using them now." while anything runs (every stepper held), "Changes go to Decaid at once." otherwise. The line keeps its height (two lines in a narrow card), so the steppers never move as it changes.
```

5. In "### Steam, hot water and flush", add after its first paragraph: "The stepper and its reads and writes live in `DrinkFields.tsx` and `useDrinkPresets.ts`, shared with each drink's view (D147); the arrangement (one row per setting, or label over stepper) is the parent's to choose."
6. In "### Motion", add a bullet: "**The drinks' dial** (D149): while the machine runs, the waves slide one length in 4.2 s (2.2 s for the milk), the wisps rise over 3.6 s, 1.2 s apart, the streams fall in 0.6 to 0.8 s, all linear and looping; they stop when the run ends and under reduced motion (the wisps hide), while the arc, the tip and the level ease 250 ms linear between frames (at once under reduced motion)."

- [ ] **Step 3: README.md and CHANGELOG.md**

In README.md's description of the everyday skin (search for "steam, flush, hot water"), add a sentence: "Steam, hot water and flush each get a live view while they run: a dial that fills toward the time or volume set, the machine's readings and the drink's own settings." In CHANGELOG.md under `## Unreleased` add:

```markdown
### The everyday skin

- Steam, hot water and flush take the screen while they run, as a shot
  does: a dial fills toward the time or volume set, with steam rising, water
  filling or the shower screen pouring while the machine works; the
  readings (steam temperature, pressure and flow; hot water's flow, the
  scale and the time; the flush's water, flow and group temperature) and a
  trace of the run; and the drink's settings, which you can change the moment
  it stops. **Go back** returns to where you were.
```

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md DESIGN.md README.md CHANGELOG.md
git commit -m "docs: D146-D150, the drinks' views in DESIGN, README and the changelog"
```

---

## Verification (after Task 11)

- [ ] `npm run verify > .verify/verify.log 2>&1; echo exit=$?` (typecheck, lint, unit tests, build, release zip, e2e). Expected: exit=0.
- [ ] Look at the views in the mock build at 962x602 and 390x844 (`npm run dev:mock`, start Steam, Hot water and Flush from the top bar) and compare them with the mockup's renders in `docs/superpowers/specs/assets/drink-views-*.png`.
- [ ] One combined review of the branch's diff against the spec (correctness, the design's rules, reduced motion, Chromium 91: no `inset`, no `aspect-ratio` reliance, no `color-mix()`), fixes applied directly.
- [ ] Land in `main` per the owner's rule (merge commit, guarded `update-ref`); push only when asked.

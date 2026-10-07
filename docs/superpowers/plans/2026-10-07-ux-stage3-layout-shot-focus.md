# UX stage 3: tablet and phone modes, shot focus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CafAI picks a tablet or a phone layout from the screen size; when a shot starts the screen shows a big live graph by itself (with a small coach note saying it is watching), and when the shot's outcome reaches the chat it goes back to the coach. The chart is always one tap away.

**Architecture:** A pure `layout.ts` decides tablet / phone (and the phone's bar or rail) from the viewport. A new `shot` route is the Shot view on a tablet and the Machine tab on a phone. A pure `shotFocus` reducer decides when the app switches by itself; a hook wires it to telemetry, the coach's messages and the router, and a tap guard stops a tap meant for the old screen landing on the new one. Every graph draws from stage 2's `ShotTrace`. The loaded-profile reading is lifted into a context so the coach note and the Shot view share the machine column's single 30 s poll.

**Tech Stack:** React 19, TypeScript 5.9, MUI 9.4, uPlot, Vitest + jsdom, Playwright (new phone projects), puppeteer 9 (Chromium 91 loop).

**Spec:** `docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md`, sections 1 and 2, mockups `2026-10-07-ux-modes-and-theme.mockup.html`.

## Ground rules (every task)

- Repo `E:\source\cafai`, branch `feat/ux-modes-theme`, Bash with POSIX paths. No state-changing git (the controller commits). Edit/Write tools only (LF). No em dashes in code comments or UI text.
- Imports with extensions, `import type` for types. Chromium 91: no `:has()`, `inert`, container queries, `dvh`, `color-mix()`, `oklch()`; no dynamic `import()`.
- Keep every existing test id and accessible name. Touch targets stay 48 px. Exit and Decaid settings on every screen in both layouts.
- Capture exit codes (`> /tmp/x.log 2>&1; echo exit=$?`). Before reporting: whole-repo `npx tsc -p tsconfig.json --noEmit`, `npx eslint <paths>`, `npx vitest run <related>`. Parallel agents may have work in progress in other files; report errors there, do not fix them.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/ui/shell/layout.ts` (+ test) | create | `layoutMode`, `phoneNav`, `machineColumnWidth`, `useLayout()` |
| `src/ui/router.ts` (+ tests) | modify | `{ name: 'shot' }` at `#/shot`, `replaceRoute` |
| `src/ui/shell/shotFocus.ts` (+ test) | create | pure reducer: when the app switches by itself |
| `src/ui/shell/useShotFocus.ts` (+ test) | create | wires the reducer to telemetry, the chat and the router; the guard flag |
| `src/ui/shell/TapGuard.tsx` | create | swallows taps for 350 ms after an automatic switch |
| `src/ui/machine/LoadedProfileContext.tsx` | create | the shared loaded-profile reading (one poll) |
| `src/ui/machine/useLoadedProfile.ts`, `LoadedProfile.tsx`, `loadedProfileModel.ts` | modify | the target yield; LoadedProfile reads the shared value when there is one |
| `src/ui/machine/LiveShotGraph.tsx` (+ test) | modify | `variant: 'panel' \| 'full'`, `onOpen` (the preview chart is a button) |
| `src/ui/machine/CoachNote.tsx` (+ test) | create | "I'm watching this shot..." |
| `src/ui/machine/ShotView.tsx` | create | the full graph and the note |
| `src/ui/machine/MachinePanel.tsx` | modify | `graph: 'preview' \| 'full' \| 'none'` |
| `src/ui/shell/LiveStrip.tsx` | create | the phone's live strip on the Coach tab |
| `src/ui/shell/ShotTime.tsx` | create | the running pour time written into a node (nav labels) |
| `src/ui/shell/AppShell.tsx` (+ test) | rewrite | tablet shell, phone shell (bar or rail), the coach kept mounted under the Shot view |
| `src/app/App.tsx` | modify | coach and shot routes share one CoachScreen |
| `src/ui/chat/ChatSurface.tsx`, `parts/ShotCard.tsx`, `CoachScreen.tsx` | modify | "Graph" on the newest shot card |
| `src/ui/testIds.ts` | modify | new ids |
| `playwright.config.ts`, `e2e/phone-baseline.spec.ts`, `e2e/shot-focus.spec.ts`, other specs | create/modify | phone projects, shot focus end to end |
| `tools/chrome91/loop.mjs` | modify | taps wait until the element is the hit target |

---

### Task 1: Layout modes and the shot route (pure)

**Files:** create `src/ui/shell/layout.ts`, `src/ui/shell/layout.test.ts`; modify `src/ui/router.ts`, `src/ui/router.test.ts`, `src/ui/testIds.ts`.

- [ ] **Step 1: Tests first** — `src/ui/shell/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutMode, machineColumnWidth, phoneNav } from './layout.ts';

describe('layoutMode', () => {
  it('is a tablet at 800 x 500 and up, a phone below', () => {
    for (const [w, h] of [[962, 602], [1007, 602], [1140, 712], [1280, 800], [1920, 1200], [1024, 768], [820, 1180]] as const) {
      expect(layoutMode(w, h)).toBe('tablet');
    }
    for (const [w, h] of [[390, 844], [844, 390], [744, 1133], [799, 600], [1000, 499]] as const) {
      expect(layoutMode(w, h)).toBe('phone');
    }
  });
});

describe('phoneNav', () => {
  it('is a bottom bar, or a side rail when the phone lies on its side', () => {
    expect(phoneNav(390, 844)).toBe('bar');
    expect(phoneNav(844, 390)).toBe('rail');
    expect(phoneNav(700, 499)).toBe('rail');
    expect(phoneNav(700, 500)).toBe('bar');
  });
});

describe('machineColumnWidth', () => {
  it('grows with the screen', () => {
    expect(machineColumnWidth(962)).toBe(340);
    expect(machineColumnWidth(1199)).toBe(340);
    expect(machineColumnWidth(1280)).toBe(400);
    expect(machineColumnWidth(1599)).toBe(400);
    expect(machineColumnWidth(1920)).toBe(480);
  });
});
```

`src/ui/router.test.ts` additions (keep the existing cases):

```ts
  it('reads the shot route', () => {
    expect(parseRoute('#/shot')).toEqual({ name: 'shot' });
    expect(parseRoute('#/SHOT/')).toEqual({ name: 'shot' });
    expect(routeHref({ name: 'shot' })).toBe('#/shot');
    expect(sameRoute({ name: 'shot' }, { name: 'shot' })).toBe(true);
  });
```
plus a jsdom case (in `router.dom.test.tsx`) that `replaceRoute({ name: 'shot' })` changes `location.hash` to `#/shot` without adding a history entry (`history.length` unchanged).

- [ ] **Step 2: `layout.ts`**:

```ts
/**
 * Which layout the screen gets. A pure function of the viewport, re-read on
 * resize and rotation: every Decent tablet (962x602 and up) and an iPad are
 * tablets; a phone, in either orientation, is a phone. A phone on its side
 * keeps its height for the content: the tabs become a rail.
 */
import { useSyncExternalStore } from 'react';

export type LayoutMode = 'tablet' | 'phone';
export type PhoneNav = 'bar' | 'rail';

export function layoutMode(width: number, height: number): LayoutMode {
  return width >= 800 && height >= 500 ? 'tablet' : 'phone';
}

export function phoneNav(_width: number, height: number): PhoneNav {
  return height < 500 ? 'rail' : 'bar';
}

/** The tablet's machine column: wider on bigger screens, so the readouts and buttons breathe. */
export function machineColumnWidth(width: number): number {
  if (width < 1200) return 340;
  if (width < 1600) return 400;
  return 480;
}

export interface Layout {
  mode: LayoutMode;
  nav: PhoneNav;
  width: number;
  height: number;
}

let cached: Layout | null = null;

function read(): Layout {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (cached && cached.width === width && cached.height === height) return cached;
  cached = { mode: layoutMode(width, height), nav: phoneNav(width, height), width, height };
  return cached;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

const SERVER: Layout = { mode: 'tablet', nav: 'bar', width: 962, height: 602 };

/** The layout for the window right now; re-renders only when it changes size. */
export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
```

- [ ] **Step 3: The route** — in `src/ui/router.ts`: `Route` gains `| { name: 'shot' }`; `parseRoute` returns `{ name: 'shot' }` for `shot`; `routeHref` gives `'#/shot'`; add

```ts
/**
 * Go to a route without a new history entry: the app's own switches (a shot
 * starting, its outcome arriving), so Back in a browser goes where the
 * barista went, not where the app went.
 */
export function replaceRoute(route: Route, win: Window = window): void {
  const href = routeHref(route);
  if (win.location.hash === href) return;
  win.location.replace(`${win.location.pathname}${win.location.search}${href}`);
}
```
and update the module comment's route list. In `src/ui/testIds.ts` add (Shell group): `navShot: 'nav-shot'`, `tabCoach: 'tab-coach'`, `tabMachine: 'tab-machine'`, `tabHistory: 'tab-history'`, `tabSettings: 'tab-settings'`, `liveStrip: 'live-strip'`, `shotView: 'shot-view'`, `coachNote: 'coach-note'`, `previewGraph: 'preview-graph'`, `tapGuard: 'tap-guard'`; (Chat group) `openShotGraph: 'open-shot-graph'`.

- [ ] **Step 4:** tests pass, typecheck, lint; report.

---

### Task 2: When the app switches by itself (`shotFocus`, pure)

**Files:** create `src/ui/shell/shotFocus.ts`, `src/ui/shell/shotFocus.test.ts`.

Rules (spec section 2): a shot start shows the Shot route unless a text field has focus or the barista is already there; the barista moving during the shot cancels the automatic return; once the chat gets the shot's outcome, or 8 s after the pour finished, whichever comes first, the app returns to the Coach if it was the automatic switch that put the barista on the Shot route.

- [ ] **Step 1: Tests** — `shotFocus.test.ts` covers, each as its own case: start while not typing and not on the Shot route gives `goShot` and `{ kind: 'live', auto: true }`; start while typing gives no command and `auto: false`; start while already on the Shot route gives no command and `auto: false`; a user navigation during `live` or `over` sets `auto: false`, and in `idle` changes nothing; finish turns `live` into `over` with `at`; the outcome during `over` with `auto` gives `goCoach` and `idle`, without `auto` gives `idle` and no command; a tick 7.9 s after finish changes nothing, at 8 s gives `goCoach` (if auto) and `idle`; a second start during `over` is a new `live` (auto by the same rule); finish or outcome in `idle` changes nothing; the outcome during `live` (no finish seen, e.g. the app opened mid-shot) is ignored.

- [ ] **Step 2: Implement**:

```ts
/**
 * When CafAI switches screens by itself around a shot (spec section 2). A
 * pure reducer: the hook in useShotFocus.ts feeds it events and carries out
 * its commands, so every rule is testable without a DOM.
 */

/** How long after the pour finished the app waits for the chat before going back anyway. */
export const OUTCOME_WAIT_MS = 8000;

export type FocusState =
  | { kind: 'idle' }
  /** A shot is running; `auto` when the app put the barista on the Shot route itself. */
  | { kind: 'live'; auto: boolean }
  /** The pour is over; waiting for the chat to get the shot's card or notice. */
  | { kind: 'over'; auto: boolean; at: number };

export type FocusEvent =
  | { type: 'shotStarted'; typing: boolean; onShotRoute: boolean }
  | { type: 'userNavigated' }
  | { type: 'shotFinished'; at: number }
  | { type: 'outcomeAdded' }
  | { type: 'tick'; now: number };

export type FocusCommand = 'goShot' | 'goCoach' | null;

export interface FocusStep {
  state: FocusState;
  command: FocusCommand;
}

export const IDLE: FocusState = { kind: 'idle' };

export function shotFocus(state: FocusState, event: FocusEvent): FocusStep {
  switch (event.type) {
    case 'shotStarted': {
      const switchNow = !event.typing && !event.onShotRoute;
      return { state: { kind: 'live', auto: switchNow }, command: switchNow ? 'goShot' : null };
    }
    case 'userNavigated':
      return { state: state.kind === 'idle' ? state : { ...state, auto: false }, command: null };
    case 'shotFinished':
      return state.kind === 'live' ? { state: { kind: 'over', auto: state.auto, at: event.at }, command: null } : { state, command: null };
    case 'outcomeAdded':
      return state.kind === 'over' ? settle(state) : { state, command: null };
    case 'tick':
      return state.kind === 'over' && event.now - state.at >= OUTCOME_WAIT_MS ? settle(state) : { state, command: null };
  }
}

function settle(state: Extract<FocusState, { kind: 'over' }>): FocusStep {
  return { state: IDLE, command: state.auto ? 'goCoach' : null };
}
```

- [ ] **Step 3:** tests pass, typecheck, lint; report.

---

### Task 3: The shared loaded profile, graph variants, the coach note and the Shot view

**Files:** create `src/ui/machine/LoadedProfileContext.tsx`, `src/ui/machine/CoachNote.tsx` (+ `CoachNote.test.tsx`), `src/ui/machine/ShotView.tsx`; modify `src/ui/machine/useLoadedProfile.ts`, `loadedProfileModel.ts` (+ test), `LoadedProfile.tsx`, `LiveShotGraph.tsx` (+ test), `MachinePanel.tsx` (+ test).

- [ ] **Step 1: Target yield in the reading** — `LoadedProfileState` (useLoadedProfile.ts) gains `targetYieldG: number | null`: the workflow's `context.targetYield` when it is a positive finite number (read in the same `getWorkflow` read, kept in state like `stepNames`). Add a `workflowTargetYield(workflow)` helper in `loadedProfileModel.ts` with a test (positive number kept; 0, negative, missing, non-number give null).

- [ ] **Step 2: One reading for the app** — `LoadedProfileContext.tsx`:

```tsx
/**
 * The loaded-profile reading (useLoadedProfile.ts), shared: the shell reads
 * Decaid's workflow once on the engine's beat, and the machine column's
 * Profile line, the Shot view's step and the coach note all show that one
 * reading. Outside a provider (a component test) a component reads its own.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useLoadedProfile, type LoadedProfileState } from './useLoadedProfile.ts';

const LoadedProfileContext = createContext<LoadedProfileState | null>(null);

export function LoadedProfileProvider({ children }: { children: ReactNode }) {
  return <LoadedProfileContext.Provider value={useLoadedProfile()}>{children}</LoadedProfileContext.Provider>;
}

/** The shared reading, or null outside a provider. */
export function useSharedLoadedProfile(): LoadedProfileState | null {
  return useContext(LoadedProfileContext);
}
```
`LoadedProfile.tsx` splits into a view and two thin wrappers, so no hook is ever conditional:
```tsx
export function LoadedProfile(props: LoadedProfileProps) {
  const shared = useSharedLoadedProfile();
  return shared ? <LoadedProfileView state={shared} {...props} /> : <OwnLoadedProfile {...props} />;
}

function OwnLoadedProfile(props: LoadedProfileProps) {
  return <LoadedProfileView state={useLoadedProfile()} {...props} />;
}
```
where `LoadedProfileView` is today's body, taking `state` instead of calling the hook (it still calls `onStepNames` in its effect). `LoadedProfile.test.tsx` and `MachinePanel.test.tsx` must pass unchanged (they render without a provider).

- [ ] **Step 3: Graph variants** — `LiveShotGraph` gains props:
```ts
export interface LiveShotGraphProps {
  /** Smallest height of the plot area itself, in px. */
  minPlotHeight?: number;
  /** 'panel' (the machine column's graph, as today) or 'full' (the Shot view: big timer and readouts). */
  variant?: 'panel' | 'full';
  /** Makes the whole panel a button that opens the Shot view (the tablet's preview chart). */
  onOpen?: () => void;
}
```
`variant="panel"` renders exactly today's markup (caption, timer, plot, legend). With `onOpen`, the panel sits in an MUI `ButtonBase` (`component="div"`, full width, `aria-label="Open the shot graph"`, `data-testid={TID.previewGraph}`, rounded 14 px, `bgcolor: 'background.paper'`, 1 px divider border, padding 1.25/1.5), the caption row ends with a `ChevronRightRounded` in the accent, and the legend stays.
`variant="full"` (spec section 2, "The Shot view"; mockup's right-hand tablet frame):
  1. Header row: the live dot (pulsing as today), the caption ("Live shot" / "Last shot" / "Shot graph") in `subtitle1`, the step text in `body2` muted, a spacer, the timer in `variant="display"` (same `ref`, `data-testid={TID.shotTimer}`, `aria-label="Shot time"`; units written as today by `formatSeconds`).
     Step text: while `phase === 'live'`, from the shared reading's `stepNames` and telemetry's `machine.profileFrame`: `"<step name> · step <n> of <total>"` (n = frame + 1); just `"<step name>"` when there is one step; nothing when the names or the frame are unknown or out of range.
  2. A 4-column readout row (`display: grid`, `repeat(4, minmax(0, 1fr))`): for Pressure, Flow, Weight, Weight flow, a `label` with the series swatch (12 x 3 px, the graph colour) and the name, then the value in `variant="readoutLarge"` written into the same `readouts.current[key]` nodes the legend uses today (so `paint()` needs no change), with the unit inside the node's text as today. After the weight value, when `targetYieldG` is known, a muted `" of <n>"` (`Math.round`).
  3. The plot, filling the rest (`flex: 1 1 auto`, `minPlotHeight` 160 by default for full).
  No legend in `full` (the readouts carry the names and swatches); the empty-state hint stays.
  Keep one component and one paint loop: the variants differ only in markup around the same refs. Tests: the existing cases run against the default (`panel`); add cases that `full` shows the four labelled readouts and writes the latest values into them, shows the step text from a provided reading, shows "of 50" with a target, and that `onOpen` makes a button named "Open the shot graph" that calls it.

- [ ] **Step 4: The coach note** — `CoachNote.tsx` (spec section 2, "The coach's note"):

```ts
export interface CoachNoteProps {
  /** From useShotFocus: the pour is over and the chat has not had the shot's outcome yet. */
  awaitingOutcome: boolean;
}
```
Renders nothing unless the trace's phase is `live` or `awaitingOutcome` is true. Otherwise a row (`role="status"`, `data-testid={TID.coachNote}`): a 34 px round avatar (`bgcolor: 'cafai.accentSoft'`, `color: 'primary.main'`, a small `ForumRounded` icon) and a bubble (`bgcolor: 'cafai.raised'`, radius `16px 16px 16px 6px`, `px: 1.75, py: 1.1`, `body2` 15 px), entering with a 200 ms fade and 6 px rise (no motion under `prefers-reduced-motion`). Text, first match wins:

| Condition | Text |
|---|---|
| `awaitingOutcome` | `Done. Reading the shot...` followed by three 5 px dots that pulse in turn (static under reduced motion) |
| no API key (`useCoach(s => s.hasApiKey)` false) | `Add your API key in Settings, and I'll read your shots.` |
| no active bag or no active version | `I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots.` |
| shared reading's title is known and is not the active version's title | `This shot runs "<title>", not <version title>, so it won't be part of this dial-in.` |
| shared reading's mark is `loading` or `notConfirmed` | `I'm watching, but <version title> isn't confirmed on the machine yet, so this shot may not count.` |
| otherwise | `I'm watching this shot. I'll read the curves once it's done.` |

(Use the typographic apostrophe-free ASCII `'` as in the rest of CafAI's copy; the three dots in "Reading the shot..." are the visible dots, so the text itself ends at "shot"; give the dots `aria-hidden` and put "Done. Reading the shot." in a visually hidden span for screen readers.) Without a shared reading (outside the provider) the title and mark rows are skipped. Tests (jsdom, with fake services): one case per row, plus "renders nothing when idle".

- [ ] **Step 5: The Shot view** — `ShotView.tsx`:
```tsx
/** The tablet's main pane during a shot (#/shot): the big graph, and the coach saying it is watching. */
export function ShotView({ awaitingOutcome }: { awaitingOutcome: boolean }) {
  return (
    <Box data-testid={TID.shotView} sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.25, px: 2.5, py: 1.75 }}>
      <LiveShotGraph variant="full" />
      <CoachNote awaitingOutcome={awaitingOutcome} />
    </Box>
  );
}
```
(the graph's root takes `flex: 1 1 auto`; drop its `borderTop` in `full`.)

- [ ] **Step 6: MachinePanel** — props become:
```ts
export interface MachinePanelProps {
  /** 'preview' (tablet: the panel graph as a button to the Shot view), 'full' (phone's Machine tab: the big graph and the note), 'none'. */
  graph?: 'preview' | 'full' | 'none';
  onOpenGraph?: () => void;
  /** For graph="full": the note's "Reading the shot..." state. */
  awaitingOutcome?: boolean;
}
```
`'preview'` (default) renders `<LiveShotGraph onOpen={onOpenGraph} />` (or the plain panel without `onOpenGraph`); `'full'` renders `<LiveShotGraph variant="full" />` then `<CoachNote awaitingOutcome={awaitingOutcome ?? false} />`; `'none'` nothing. Keep `showGraph` working as an alias (`showGraph={false}` means `'none'`) if any test uses it; check with grep.

- [ ] **Step 7:** `npx vitest run src/ui/machine > /tmp/s3t3.log 2>&1; echo exit=$?` (0), typecheck, lint; report.

---

### Task 4: The shells, the focus hook, the guard, and App

**Files:** create `src/ui/shell/useShotFocus.ts` (+ test), `src/ui/shell/TapGuard.tsx`, `src/ui/shell/ShotTime.tsx`, `src/ui/shell/LiveStrip.tsx`; rewrite `src/ui/shell/AppShell.tsx` (+ update `AppShell.test.tsx`); modify `src/app/App.tsx`.

- [ ] **Step 1: `useShotFocus`** — the hook (`useShotFocus(route: Route): { awaitingOutcome: boolean; guardUntil: number | null }`):
  - holds `FocusState` in a ref (and `awaitingOutcome = state.kind === 'over'` in React state, set only when it changes);
  - `telemetry.onShot('started')` dispatches `shotStarted` with `typing` = the focused element is a `textarea`, an `input` whose type is text-like (text, search, email, url, tel, password, number, or none), or `[contenteditable="true"]`, and `onShotRoute` = the current route is `shot`;
  - `telemetry.onShot('finished')` dispatches `shotFinished` with `Date.now()`, and records the ids of the coach's messages at that moment;
  - the coach store (`coach.subscribe`): when the state is `over`, a message whose id was not recorded and that has a `shot` part, or a `notice` part without `progress`, dispatches `outcomeAdded` (the transient "Looking for that shot in Decaid..." progress notice does not count);
  - while `over`, a 1 s interval dispatches `tick`;
  - a route change it did not make itself dispatches `userNavigated` (it marks its own switches with a ref before calling `replaceRoute` and clears the mark when the route arrives);
  - commands: `goShot` calls `replaceRoute({ name: 'shot' })`; `goCoach` calls `replaceRoute({ name: 'coach' })` only if the route is still `shot`; each automatic switch sets `guardUntil = Date.now() + 350` (React state; cleared after 350 ms).
  Tests (jsdom, fake services, `vi.useFakeTimers()` where needed): a shot start switches to `#/shot` with `location.replace`; while typing in a textarea it does not; finishing then adding a shot card returns to `#/` ; a progress notice does not; 8 s without an outcome returns anyway; a manual navigation during the shot cancels the return; `guardUntil` is set on each automatic switch.

- [ ] **Step 2: `TapGuard`** — renders a transparent, absolutely positioned overlay (`inset: 0`, `zIndex` above the pane's content, `data-testid={TID.tapGuard}`, `aria-hidden`) that swallows `pointerdown`, `click` and `touchstart` (`preventDefault` + `stopPropagation` in capture), while `Date.now() < until`, removing itself on a timer. Placed inside the tablet's main pane (never over the machine column, so Stop always takes taps) and over the phone's content area.

- [ ] **Step 3: `ShotTime` and the live labels** — `ShotTime` writes the trace's pour time (`formatSeconds(trace.buffer.elapsedS())`, or a short form for the tab, e.g. `"42 s"` via `Math.round`) into a `span` on every trace data change (no React re-render per frame), and renders nothing unless the trace's phase is `live`. The tablet's Shot nav item reads `Shot` normally and, while live, shows the live dot (`cafai.live`, 9 px) + `Shot` + `<ShotTime />`; the phone's Machine tab shows the dot + `<ShotTime short />` in place of its label (its accessible name: `Machine, shot running`).

- [ ] **Step 4: `LiveStrip` (phone, Coach tab)** — shown while the trace is `live` or `awaitingOutcome`: a 64 px rounded button (`data-testid={TID.liveStrip}`, `aria-label="Open the live shot"`, `bgcolor: 'cafai.accentSoft'`, radius 16, margin 1.25 x 1.5) with the dot and "Live shot" (subtitle2 700), a line of `time · weight · pressure` written into nodes per frame (tabular), a 104 x 38 mini chart (pressure and flow; an SVG whose paths are rebuilt from the trace's buffer on each data change with `sparklinePath` from `src/ui/chat/sparkline.ts`), and a chevron. Tapping it navigates to `#/shot` (a normal navigation: the barista's choice).

- [ ] **Step 5: `AppShell`** — keeps its props (`route`, `onNavigate`, `children`, `machinePanel`) and test ids; wraps everything in `LoadedProfileProvider`; starts the trace (`shotTraceFor(telemetry)`) and the focus hook; picks the layout with `useLayout()`.
  - **Tablet** (mockup, tablet frames): the 56 px top bar with Brand, then nav **Coach · Shot · History · Settings** (Shot: `data-testid={TID.navShot}`, icon `ShowChartRounded`; the live label from step 3), spacer, Decaid settings, Exit; the old-engine warning; then the machine column (`width: machineColumnWidth(width)`), with `MachinePanel graph={route.name === 'shot' ? 'none' : 'preview'} onOpenGraph={() => onNavigate({ name: 'shot' })}` (or the `machinePanel` prop when given); and the main pane (`position: relative`) holding `children` in a box that is `visibility: hidden` while the route is `shot` (the coach stays mounted, keeping its scroll and draft), the `ShotView` absolutely over it on the `shot` route, and the `TapGuard`.
  - **Phone** (mockup, phone frames): a 52 px top bar (Brand, spacer, a text button `Decaid` with `OpenInNewRounded` (same `TID.decaidSettings`, same href), Exit (tonal, `TID.exitToSkins`)); the old-engine warning; the content area (`position: relative`, flex 1): on `coach`, the `LiveStrip` above `children`; on `shot`, `MachinePanel graph="full"` absolutely over the (hidden) `children`; on history and settings, `children`; the `TapGuard` over the content; then the tabs: **Coach · Machine · History · Settings** (`TID.tabCoach`, `TID.tabMachine` (route `shot`), `TID.tabHistory`, `TID.tabSettings`; 48 px targets; icon above a 12.5 px label; the current one in the accent with a 58 x 30 `accentSoft` pill behind its icon) as a bottom bar (height 64 + `var(--safe-bottom)`, padding-bottom the inset) or, when `nav === 'rail'`, a left rail (80 px + `var(--safe-left)`, items stacked, content to its right).
  - The tabs (bar or rail) hide while a text-like field has focus (`focusin`/`focusout` on `document`, same test as the hook's `typing`), so the on-screen keyboard leaves the chat room.
  - Both: no edge gestures, the page never scrolls, insets through the `--safe-*` variables as today, Exit and Decaid settings always present. The existing desktop nav test ids (`navCoach`, `navHistory`, `navSettings`) stay on the tablet; on the phone the tabs carry the `tab*` ids.
  Update `AppShell.test.tsx`: existing cases keep passing at the default jsdom size (1024 x 768, a tablet); add cases at a phone size (set `window.innerWidth/innerHeight` and fire `resize`): the tabs render, Exit and Decaid settings are present, the Machine tab navigates to `shot`, the tabs hide when a textarea has focus; at 844 x 390 the rail renders.

- [ ] **Step 6: `App.tsx`** — `Routed`: for `coach` and `shot`, `screen = <CoachScreen />` (the same element in the same place, so React keeps it mounted across the switch); history and settings as today.

- [ ] **Step 7:** `npx vitest run src/ui src/app > /tmp/s3t4.log 2>&1; echo exit=$?` (0), typecheck, lint; report.

---

### Task 5: "Graph" on the newest shot card

**Files:** `src/ui/chat/parts/ShotCard.tsx` (+ test), `src/ui/chat/ChatSurface.tsx` (+ test), `src/ui/chat/CoachScreen.tsx`.

- [ ] `ShotCard` gains `onOpenGraph?: () => void`: when given, a text button "Graph" with a `ChevronRightRounded` end icon (`data-testid={TID.openShotGraph}`, 48 px tall, accent) sits beside the sparkline. `ChatSurfaceProps` gains `graphShotId?: string | null` and `onOpenGraph?(): void`; the parts context carries them and `ShotView` passes `onOpenGraph` only to the card whose `shotId === graphShotId`. `CoachScreen` passes `graphShotId` = the trace's `finishedShotId` (via `useSyncExternalStore` on `shotTraceFor(telemetry)`) and `onOpenGraph={() => navigate({ name: 'shot' })}`. Tests: only the matching card shows "Graph", and tapping it calls `onOpenGraph`.

---

### Task 6: End to end, both layouts (controller-led)

- [ ] **`playwright.config.ts`**: add projects `phone-390x844` (`viewport 390x844`, `deviceScaleFactor: 2`, `hasTouch: true`, `isMobile: true`) and `phone-landscape-844x390`, both with `testMatch: /(phone-baseline|shot-focus|appearance)\.spec\.ts/`; the three tablet projects get `testIgnore: /phone-baseline\.spec\.ts/`.
- [ ] **`e2e/phone-baseline.spec.ts`**: every tab renders its screen; Exit and Decaid settings are visible on each; nothing overflows sideways (`document.documentElement.scrollWidth <= innerWidth`); the Machine tab shows Espresso, Stop and the graph.
- [ ] **`e2e/shot-focus.spec.ts`** (all projects): with a bag and v1 loaded (reuse the full-loop helpers), tap Espresso: the Shot view (tablet) or the Machine tab's full graph (phone) appears by itself with the coach note; when the shot card arrives the coach is back by itself; on the coach, the preview chart (tablet) or the live strip (phone, during a shot) opens the graph; typing in the composer when the shot starts keeps the coach.
- [ ] **Existing tablet specs**: run them all; a spec that interacts with the chat during a shot now finds it hidden behind the Shot view: wait for the coach to return (the shot card visible) before acting, or navigate back explicitly; never weaken an assertion.
- [ ] **`tools/chrome91/loop.mjs`**: `tap()` waits until `document.elementFromPoint` at the element's centre is the element or inside it (the tap guard) before clicking.
- [ ] Run everything (unit, e2e in all five projects, both Chromium 91 runs), screenshots at the five sizes in dark Crema and light Matcha, fix what they show.

---

### Task 7: Docs (controller)

- [ ] `DECISIONS.md`: D84 layout modes (breakpoints, the shot route shared by the Shot view and the Machine tab), D85 shot focus (rules, `location.replace`, the 350 ms guard on the switched pane only on a tablet, the coach kept mounted), D86 the coach note's rows and the shared loaded-profile reading.
- [ ] `README.md`: the layouts, the Shot view, Appearance.
- [ ] `DESIGN.md` (new, project root): the visual system as built (palette roles and tints, type scale, components: tonal button, cards, readouts, nav, tabs, note), in the Stitch DESIGN.md format.
- [ ] `docs/HARDWARE_TEST_PLAN.md`: the phone layout inside Decaid on a phone, Auto mode.
- [ ] `MORNING.md`: what changed, what was verified, what to look at first.

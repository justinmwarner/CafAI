# Chat first, the machine on demand: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the machine column: the chat opens with a live stats card that goes away once the chat moves on, a Stats prompt brings it back, a row of the four start buttons (the running one turns into Stop) sits in the top bar, and the graph opens from Shot.

**Architecture:** Three new machine components (`MachineRow`, `StatsCard`, `MachineAlerts`) built from the column's existing readouts and controls model; the chat shows the card as a screen-only synthetic message at the end of x-chat's list, driven by a small per-services state; the shell drops the column and `MachinePanel`, puts the row in both top bars and the alert under them, and renames the phone's Machine tab to Shot.

**Tech stack:** React 19, TypeScript 5.9, MUI 9, @mui/x-chat (alpha), uPlot, vitest + Testing Library (jsdom), Playwright, the Chromium 91 tools in `tools/chrome91/`.

**Spec:** `docs/superpowers/specs/2026-10-08-chat-first-machine-design.md` (rules table in section 3). Mockup and renders beside it.

**Process rules for every agent:** work in `E:\source\cafai` on `feat/ux-modes-theme`; no state-changing git (the integrator commits after each wave); only your own files; Chromium 91 (no CSS or JS newer than it); no em dashes in UI text or comments; match the surrounding code; never write or log an API key; write files with the Write and Edit tools; keep LF line endings; never use port 4174 except the e2e agent; capture exit codes as `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`.

---

## File structure

| File | Wave | Owner | Responsibility |
|---|---|---|---|
| `src/ui/testIds.ts` | 0 | integrator | new ids: `machineRow`, `statsCard`, `statsPrompt`, `machineAlerts`, `tabShot` |
| `src/ui/machine/MachineRow.tsx` (+ test) | 0 stub, 1 | machine | the top bar's start row; the running one is Stop; Wake while asleep |
| `src/ui/machine/StatsCard.tsx` (+ test) | 0 stub, 1 | machine | the live stats card |
| `src/ui/machine/MachineAlerts.tsx` (+ test) | 0 stub, 1 | machine | the slim alert under the top bar |
| `src/ui/machine/MachineStatus.tsx`, `MachineControls.tsx`, `LoadedProfile.tsx`, `ShotView.tsx`, `LiveShotGraph.tsx` | 1 | machine | share their pieces with the new components; ShotView works narrow |
| `src/ui/chat/statsCard.ts` (+ test) | 1 | chat | the card's state, per services instance |
| `src/ui/chat/ChatSurface.tsx`, `CoachScreen.tsx` (+ tests) | 1 | chat | the synthetic message, the Stats prompt, opening and bag switches |
| `src/ui/shell/AppShell.tsx`, `layout.ts` (+ tests) | 1 | shell | no column; the row in both top bars; the alert; the Shot tab |
| `src/ui/machine/MachinePanel.tsx`, `MachinePanel.test.tsx` | 1 | shell | deleted once AppShell no longer imports them |
| `e2e/**`, `playwright.config.ts`, `tools/chrome91/**` | 2 | e2e | the suite and the loop follow the new places |
| `DECISIONS.md`, `DESIGN.md`, `README.md`, `docs/HARDWARE_TEST_PLAN.md` | 2 | docs | D90-D92 and the docs |

---

### Task 0: Stubs and ids (integrator, before wave 1)

**Files:** Modify `src/ui/testIds.ts`; create the three stubs.

- [ ] **Step 1: Add the ids** in `TID`, after `tapGuard`:

```ts
  tabShot: 'tab-shot',
  machineRow: 'machine-row',
  statsCard: 'stats-card',
  statsPrompt: 'stats-prompt',
  machineAlerts: 'machine-alerts',
```

`tabMachine` stays until the e2e agent has moved the specs to `tabShot`; the e2e agent removes it.

- [ ] **Step 2: Create the stubs** (replaced in wave 1):

```tsx
// src/ui/machine/MachineRow.tsx
import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';

export interface MachineRowProps {
  /** Icons only, for a phone's top bar; otherwise each icon over its label. */
  icons?: boolean;
}

export function MachineRow({ icons = false }: MachineRowProps) {
  return <Box data-testid={TID.machineRow} data-icons={icons ? 'true' : undefined} />;
}
```

```tsx
// src/ui/machine/StatsCard.tsx
import Box from '@mui/material/Box';
import { TID } from '../testIds.ts';

export function StatsCard() {
  return <Box data-testid={TID.statsCard} />;
}
```

```tsx
// src/ui/machine/MachineAlerts.tsx
export function MachineAlerts() {
  return null;
}
```

- [ ] **Step 3:** `npm run typecheck` and `npm run lint` pass.

---

### Task 1: The machine pieces (machine agent, wave 1)

**Files:** Create/replace `src/ui/machine/MachineRow.tsx`, `StatsCard.tsx`, `MachineAlerts.tsx` and their tests; modify `MachineStatus.tsx`, `MachineControls.tsx`, `LoadedProfile.tsx`, `ShotView.tsx`, `LiveShotGraph.tsx` as needed. Do not touch `MachinePanel.tsx` or its test (the shell agent deletes them); keep the exports `MachinePanel` uses compiling until then.

The row's slot for a running state: `espresso` and `skipStep` the Espresso slot; `steam` and `steamRinse` Steam; `flush` and `airPurge` Flush; `hotWater` Hot water; anything else running (`cleaning`, `descaling`) the first slot. The controls model is `machineControls()` in `commands.ts`; the sending logic (one command in flight, Stop never blocked, errors as a sentence) is in `MachineControls.tsx`: move it into a hook (for example `useMachineCommands()`) that both the row and the card use, rather than copying it.

- [ ] **Step 1: Write the failing row tests** in `src/ui/machine/MachineRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineSnapshot, TelemetryState } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, type FakeServices } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { MachineRow } from './MachineRow.tsx';

const withState = (state: string, substate = 'pouring'): Partial<TelemetryState> => ({
  machine: { ...IDLE_TELEMETRY.machine!, state: { state, substate } as MachineSnapshot['state'] },
});

async function renderRow(services: FakeServices = createFakeServices(), icons = false) {
  const view = renderWithServices(<MachineRow icons={icons} />, services);
  await act(async () => {});
  return view;
}

const labels = () => within(screen.getByTestId(TID.machineRow)).getAllByRole('button').map((b) => b.textContent);
const stateCalls = (services: FakeServices) =>
  services.decaid.calls.filter((call) => call.method === 'setMachineState').map((call) => call.args[0]);

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('MachineRow', () => {
  it('offers the four starts while the machine is ready', async () => {
    await renderRow();
    expect(labels()).toEqual(['Espresso', 'Steam', 'Flush', 'Hot water']);
    for (const id of [TID.espressoButton, TID.steamButton, TID.flushButton, TID.hotWaterButton]) {
      expect(screen.getByTestId(id)).toBeEnabled();
    }
    expect(screen.queryByTestId(TID.stopButton)).not.toBeInTheDocument();
  });

  it('turns the running start into Stop in its own place and holds the others', async () => {
    await renderRow(createFakeServices({ telemetry: withState('steam') }));
    expect(labels()).toEqual(['Espresso', 'Stop', 'Flush', 'Hot water']);
    expect(screen.getByTestId(TID.stopButton)).toBeEnabled();
    expect(screen.getByTestId(TID.espressoButton)).toBeDisabled();
  });

  it('stops the machine from Stop', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('espresso') }));
    await userEvent.click(screen.getByTestId(TID.stopButton));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('shows Wake alone while the machine sleeps', async () => {
    const { services } = await renderRow(createFakeServices({ telemetry: withState('sleeping', 'idle') }));
    expect(labels()).toEqual(['Wake']);
    await userEvent.click(screen.getByRole('button', { name: 'Wake' }));
    expect(stateCalls(services)).toEqual(['idle']);
  });

  it('names each button for screen readers when it shows icons only', async () => {
    await renderRow(createFakeServices(), true);
    for (const name of ['Espresso', 'Steam', 'Flush', 'Hot water']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
```

Add a group-head case in the way `MachinePanel.test.tsx` covers a GHC machine: nothing in the row while idle, Stop alone while something runs. Add a disconnected case: the starts are disabled.

- [ ] **Step 2:** `npx vitest run src/ui/machine/MachineRow.test.tsx`: fails (the stub renders no buttons).
- [ ] **Step 3: Build `MachineRow`.** Tablet: 54 px wide buttons, icon over an 11.5 px label, 48 px tall; icons mode: 44 px square, `aria-label` with the name. Stop: filled in `error` with `onError` text, same box. Keep the existing ids (`espressoButton`, `steamButton`, `flushButton`, `hotWaterButton`, `stopButton`) on these buttons. An error from a command shows the way the column showed it (a short note the shell can place; keep it compact, for example a tooltip-free snackbar or a small alert under the top bar via `MachineAlerts`; your call, documented in the report).
- [ ] **Step 4:** the row tests pass.
- [ ] **Step 5: Write the failing card tests** in `src/ui/machine/StatsCard.test.tsx`: an idle machine shows Ready, both connection dots, Group with its target, Steam, Water, Scale and the loaded profile (move the matching assertions from `MachinePanel.test.tsx`'s "status" block: `machineState`, `connectionStatus`, `groupTemp`, `steamTemp`, `waterLevel`, `scaleWeight` keep their ids inside the card); Tare sends `tareScale`; Sleep sends `sleeping`; a running machine shows the state line ("Pulling a shot: ...") live; the card is narrow-aware (two by two under 520 px of its own width, four in a row above; test with a `ResizeObserver` stub or by the class or prop you choose).
- [ ] **Step 6: Build `StatsCard`** from `MachineStatus`'s pieces (export what it needs: the connection row, the state line, the readouts) and `LoadedProfile`. Its frame matches the chat's cards (surface, line border, 16 px radius). No graph.
- [ ] **Step 7: Write the failing alert tests** in `src/ui/machine/MachineAlerts.test.tsx`: nothing for a connected, ready machine; "Not connected" with the existing reason when disconnected; the connection error notice text (from `MachineStatus`'s `ConnectionErrorNotice`); a refill notice when the water is low or the state is `needsWater`.
- [ ] **Step 8: Build `MachineAlerts`**: one slim MUI `Alert` (dense, 40 px or so), the most important problem first; `data-testid={TID.machineAlerts}`.
- [ ] **Step 9: ShotView narrow.** `ShotView` will also be the phone's Shot tab (360 to 844 px wide): the readouts wrap two by two under 600 px of width, the step line gets its own line on narrow widths (the `compact` prop of `LiveShotGraph`'s full variant exists for this), the plot fills what is left (at least 120 px). Add a test for the narrow arrangement.
- [ ] **Step 10:** `npm run typecheck`, `npm run lint`, `npx vitest run src/ui/machine` pass. Report: files, the hook you extracted, how a command error shows, anything the shell must know.

---

### Task 2: The card in the chat, and the Stats prompt (chat agent, wave 1)

**Files:** Create `src/ui/chat/statsCard.ts` (+ test); modify `src/ui/chat/ChatSurface.tsx`, `src/ui/chat/CoachScreen.tsx` and their tests; `src/app/**` only if the state needs a home there.

- [ ] **Step 1: Write the failing state tests** in `src/ui/chat/statsCard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createStatsCardState, statsCardShown } from './statsCard.ts';

describe('the stats card state', () => {
  it('shows after the newest message once the chat first opens', () => {
    const state = createStatsCardState();
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(false);
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(true);
  });

  it('opens once a session', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    state.hide();
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm2')).toBe(false);
  });

  it('goes away as soon as anything new lands', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm3')).toBe(false);
  });

  it('comes back after the newest message on Stats', () => {
    const state = createStatsCardState();
    state.open('bag-1', 'm2');
    state.show('bag-1', 'm5');
    expect(statsCardShown(state.getSnapshot(), 'bag-1', 'm5')).toBe(true);
  });

  it('shows in an empty chat until the first message', () => {
    const state = createStatsCardState();
    state.open(null, null);
    expect(statsCardShown(state.getSnapshot(), null, null)).toBe(true);
    expect(statsCardShown(state.getSnapshot(), null, 'm1')).toBe(false);
  });

  it('tells its listeners', () => {
    const state = createStatsCardState();
    let calls = 0;
    const stop = state.subscribe(() => {
      calls += 1;
    });
    state.open('bag-1', 'm2');
    state.show('bag-1', 'm3');
    state.hide();
    stop();
    state.show('bag-1', 'm4');
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2:** the tests fail (no module).
- [ ] **Step 3: Write `statsCard.ts`**:

```ts
/**
 * The stats card's place in the chat: shown after one message of one bag's
 * chat, until anything new lands there. Screen-only state for this session:
 * never stored, never sent to the coach.
 */
export interface StatsCardSnapshot {
  /** Null while hidden. */
  readonly at: { readonly bagId: string | null; readonly afterId: string | null } | null;
  readonly opened: boolean;
}

export interface StatsCardState {
  getSnapshot(): StatsCardSnapshot;
  subscribe(listener: () => void): () => void;
  /** The chat's first showing this session: the card follows its newest message. */
  open(bagId: string | null, newestId: string | null): void;
  /** The Stats prompt: the card moves to after the newest message. */
  show(bagId: string | null, newestId: string | null): void;
  hide(): void;
}

export function statsCardShown(snapshot: StatsCardSnapshot, bagId: string | null, newestId: string | null): boolean {
  return snapshot.at !== null && snapshot.at.bagId === bagId && snapshot.at.afterId === newestId;
}

export function createStatsCardState(): StatsCardState {
  let snapshot: StatsCardSnapshot = { at: null, opened: false };
  const listeners = new Set<() => void>();
  const set = (next: StatsCardSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open(bagId, newestId) {
      if (snapshot.opened) return;
      set({ at: { bagId, afterId: newestId }, opened: true });
    },
    show(bagId, newestId) {
      set({ at: { bagId, afterId: newestId }, opened: true });
    },
    hide() {
      if (snapshot.at !== null) set({ ...snapshot, at: null });
    },
  };
}
```

Add `statsCardFor(key: object): StatsCardState` (a WeakMap, as `shotTraceFor` does for telemetry) keyed by an object that lives as long as the services instance (the coach service, for example), so a visit to History and back keeps the card.
- [ ] **Step 4:** the state tests pass.
- [ ] **Step 5: Write the failing surface tests** (`ChatSurface.test.tsx`, `CoachScreen.test.tsx`): the card renders after the newest message on first open (`TID.statsCard` is the last item of the list); a new message (send one through the composer) takes it away; the `TID.statsPrompt` chip above the composer brings it back at the end; the chip is there with an empty chat and mid-conversation; switching bags hides it; the card is not in the stored conversation and not in what the coach is sent (assert on the coach service's input or the stored messages in the fake services).
- [ ] **Step 6: Build it.** In `ChatSurface`, append one synthetic x-chat message after the real ones when `statsCardShown(...)` is true: id `cafai-stats`, role `assistant`, one part of a new data type under the existing `DATA_PREFIX` (for example `${DATA_PREFIX}stats`), rendered by `<StatsCard />` from `src/ui/machine/StatsCard.tsx` (a stub until the machine agent lands it; import it, do not reimplement it). The "thinking" row, when busy, stays last. The prompt row: one MUI `Chip` (clickable, outlined, 40 px tall, `SpeedRounded` icon, label "Stats", `data-testid={TID.statsPrompt}`) in a row above the composer, inside the same lane as the composer (`max-width` and margins as the composer's). A tap calls `show(bagId, newestId)` and lets `followNewest` bring the card into view. `CoachScreen` calls `open` the first time the chat shows (with the newest message's id, or null for an empty chat) and `hide` when the bag changes.
- [ ] **Step 7:** `npm run typecheck`, `npm run lint`, `npx vitest run src/ui/chat` pass. Report: files, where the state lives, and how the synthetic message is kept out of storage and the coach.

---

### Task 3: The shell (shell agent, wave 1)

**Files:** Modify `src/ui/shell/AppShell.tsx`, `src/ui/shell/layout.ts`, `src/ui/shell/AppShell.test.tsx` (and `layout.test.ts`); delete `src/ui/machine/MachinePanel.tsx` and `src/ui/machine/MachinePanel.test.tsx` once nothing imports them; anything else in `src/ui/shell/**` or `src/ui/App.tsx` that names the column.

- [ ] **Step 1: Write the failing shell tests** in `AppShell.test.tsx`:
  - a tablet (962x602) has no machine column (`queryByRole('complementary', { name: 'Machine' })` is null) and the main pane spans the window;
  - the tablet's top bar holds `TID.machineRow` between the places and Decaid's buttons;
  - a phone's (390x844) top bar holds `TID.machineRow` with `data-icons="true"`, and its tabs are Coach, Shot, History, Settings (`TID.tabShot` labelled "Shot", no "Machine");
  - on its side (844x390) the rail has the same four;
  - the phone's Shot tab shows `TID.shotView`;
  - `TID.machineAlerts`, when it renders, sits directly under the top bar (render `MachineAlerts`' real component with disconnected telemetry once the machine agent lands it; until then assert the slot);
  - the tap guard (`TID.tapGuard`) lies inside the main pane and never over the top bar, on a tablet and a phone.
  Remove the tests of the column, the preview card and the `machinePanel` prop.
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Build it.** Drop the column (`machineColumnWidth` and its uses go), the `machinePanel` prop, and `MachinePanel`. Tablet top bar: brand, Coach, Shot, History, Settings, a flexible gap, `<MachineRow />`, a hairline, Decaid settings as an icon button (accessible name "Decaid settings"), Exit. Measure at 962 px with the Shot item counting ("● Shot 12.4 s"): nothing wraps or clips. Phone top bar: brand, gap, `<MachineRow icons />`, Exit as an icon button (Decaid settings stays reachable where it is today on the phone; keep it). `<MachineAlerts />` right under either top bar. The phone's `shot` route renders `<ShotView awaitingOutcome=... />` (the same component the tablet shows); the tab's label is "Shot" with `TID.tabShot`, and its live time and accessible name (D88) stay. The tap guard covers the main pane only. The live strip on the phone's Coach tab stays.
- [ ] **Step 4:** delete `MachinePanel.tsx` and its test; `grep -rn MachinePanel src` finds nothing.
- [ ] **Step 5:** `npm run typecheck`, `npm run lint`, `npx vitest run src/ui/shell src/ui/App` pass. Check in a browser on your own server (`npx vite --mode mock --port 5182 --strictPort`; demo `/?demo=1&mockSpeed=3#/`): 962x602, 1280x800, 390x844, 844x390, 360x640; screenshot each into `test-results/chat-first-shell/`. Report: files, measurements of the top bar at 962 px idle and mid-shot.

---

### Task 4: The suite and the loop (e2e agent, wave 2, after tasks 1-3)

**Files:** `e2e/**`, `playwright.config.ts`, `tools/chrome91/**`; `src/ui/testIds.ts` only to remove `tabMachine`.

- [ ] **Step 1:** `npm run build:mock` then `npx playwright test` (the suite owns port 4174; nothing else may use it) and list what fails.
- [ ] **Step 2:** move the specs to the new places: Espresso and Stop in the top bar row; the machine's readings (`machineState`, `groupTemp`, ...) inside `TID.statsCard`; the Shot tab (`tabShot`) for the phone's Machine tab; the preview chart's tests to the Shot nav item. Update `e2e/helpers.ts` (`pullShotOnMachine`, `goTo`) and `tools/chrome91/loop.mjs` the same way. Remove `tabMachine` from `src/ui/testIds.ts`.
- [ ] **Step 3: Add `e2e/chat-first.spec.ts`** for the spec's rules: the card is there on load and live (the group temperature changes as the mock heats); a sent message takes it away; Stats brings it back at the end; a reload shows it again; Espresso turns into Stop in the same box (compare bounding boxes) and Stop ends the shot; the Shot item opens the graph; on a phone the Stop in the top bar works during the 350 ms after the automatic switch (a raw touch 80 ms after the hash becomes `#/shot`).
- [ ] **Step 4:** the whole suite passes on all five projects; `npm run build:mock && npm run smoke:chrome91 && npm run smoke:chrome91:loop` pass. Report the numbers.

### Task 5: The docs (docs agent, wave 2, beside task 4)

**Files:** `DECISIONS.md` (D90 the column goes, the machine row, Stop in the running button's place; D91 the stats card and the Stats prompt; D92 the graph from Shot, the Shot tab, the tap guard off the top bar; note that D87's short-phone cover and the phone guard over Stop are superseded), `DESIGN.md` (the shell, the row, the card, the prompt), `README.md` ("Screens and looks"), `docs/HARDWARE_TEST_PLAN.md` section 11 (Stop from the top bar mid-shot; the stats card live on the tablet).

---

### Task 6: Integration (integrator)

- [ ] After wave 1: review the three diffs, `npm run typecheck && npm run lint && npm test`, commit per agent.
- [ ] After wave 2: `npm run verify`, the Chromium 91 smoke and loop, commit.
- [ ] One fresh-eyes check of the new flows (`docs/briefs/verify-chat-first.md`), fixes, MORNING.md.

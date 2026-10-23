# Screensavers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A screensaver over CafAI on the tablet while the machine sleeps, a tap waking it, the screen held on and dimmed for 30 minutes, chosen in Settings > Screensaver from Nightstand and five canvas screensavers (spec: `docs/superpowers/specs/2026-10-22-screensavers-design.md`, D223-D228).

**Architecture:** Each canvas screensaver is a module behind one interface (`src/ui/saver/types.ts`), stepped by a shared 30 fps loop (`runner.ts`) and listed by a registry. The overlay, mounted last in the shell, decides when one shows (a pure policy), swallows the waking tap and calls the Wake button's command; a display socket to Decaid dims the tablet and holds it on. The setting is a store like the temperature unit's.

**Tech Stack:** TypeScript 5.9, React 19 + MUI 9, Canvas 2D (Chromium 91), vitest 5, Playwright, MSW (mock Decaid).

**Base:** branch `feat/screensavers`, the commit with the spec, this plan and the shared groundwork below. Three builders work at once, each in a worktree of its own on disjoint files; the owner wants pace (no check-ins while building, one combined review at the end) and watches token spend (no more than three agents at once, screenshots kept few and small).

---

## Shared groundwork (done, in the base commit)

- `src/ui/saver/types.ts`: `SaverId` (`'nightstand' | 'portafilter' | 'beanfield' | 'steam' | 'lava' | 'rain'`), `CanvasSaverId`, `SaverEnv` (`palette`, `seed`, `numbers`), `SaverInstance` (`step`, `draw`, `resize`, `still`, `dispose`), `CanvasSaver` (`id`, `label`, `context`, `create`).
- `src/ui/saver/random.ts`: `createRandom(seed)`, `between`, `wholeBetween`, `pickOne`, `localDayNumber(date)`, with tests.
- `src/ui/saver/runner.ts`: `runSaver(instance, {fps, clock, onError})` returning `{pause, resume, stop}`; `stepFor(instance, ms)`; `sizeSaver(canvas, instance, width, height, scale)`; `backingScale(dpr)`; `SAVER_FPS`, `MAX_STEP_MS`; with tests.
- `src/ui/saver/registry.ts`: `CANVAS_SAVERS`, `SAVERS` (Nightstand first, `context: 'text'`), `isSaverId`, `canvasSaver(id)`.
- `src/ui/saver/savers/{portafilter,beanfield,steam,lava,rain}.ts`: placeholders from `savers/placeholder.ts`, each exporting its `CanvasSaver` under its id's name (`export const beanfield`). Builders replace them; `placeholder.ts` goes at the merge.
- `dev/preview-saver.html` + `src/ui/preview/saverPreview.ts`: one canvas screensaver on the whole window. `?saver=<id>&seed=1&at=<ms>&still=1&tint=<id|hue>&numbers=9.0,36.4,28&fps=1`; `<body data-ready="1">` once painted.
- `scripts/shoot-saver.mjs`: screenshots the preview into `.verify/` (`node scripts/shoot-saver.mjs --port 5192 --saver beanfield --at 6000`), and prints frame timing with `--fps 1 --wait 3000`.
- `eslint.config.js`: the canvas's `roundRect` and `createConicGradient` (Chromium 99+) are refused.

## Everyone

- **Start**: `cd` into your worktree for every command (its path is in your brief); `npm ci` is done there. Run `git log --oneline -1` and check you are on your branch at the base commit.
- **Checks before each commit**: `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`, and `npx vitest run <your test files>`, all clean. Capture exit codes (`cmd > .verify/x.log 2>&1; echo exit=$?`): a pipe into `tail` hides a failure.
- **Ports**: your dev server and e2e ports are in your brief (another session runs CafAI's own suite on 4174 and 4176); stop every server you start before you finish.
- **Commits**: on your branch, in the repo's style (`feat: ...`, one sentence that says what the barista gets, decisions cited as D-SAVER-1 to D-SAVER-6 while building, numbered D223-D228 at the merge). Never a real decision number above D209 while building.
- **Files**: only the ones your task lists. If a shared file needs a change, say so in your report instead.
- **Report** when done: your commits, what you could not do, any change you would make to the spec or a shared file, and your screenshots' paths.

## Task H: the host (builder H)

**Files:**
- Create: `src/ui/saver/policy.ts`, `daily.ts`, `preview.ts`, `SaverOverlay.tsx`, `SaverCanvas.tsx`, `Nightstand.tsx` (each with tests); `src/api/display.ts` (+ test); `src/app/saverScreen.ts` (+ test); `src/app/screensaverSetting.ts` (+ test); `src/ui/platform/usePrefersReducedMotion.ts` (+ test); `src/ui/settings/ScreensaverSection.tsx` (+ test); `e2e/screensaver.spec.ts`; a screenshot scene in `e2e/screenshots/`.
- Modify: `src/ui/shell/AppShell.tsx` (mount the overlay as the root's last child); `src/storage/types.ts`, `schema.ts`, `settings.ts` (+ `settings.test.ts`); `src/app/types.ts`, `createServices.ts`, `services.tsx`; `src/ui/settings/SettingsScreen.tsx` (the section after Sleep and wake); `src/ui/testIds.ts`; `src/ui/testing/fakeServices.ts`; `mock/decaid/ws.ts`, `mock/decaid/state.ts` (the display socket); the mock's URL options for Preview (below); `src/api/testing/fakeWebSocket.ts` (record sends); docs: `PRODUCT.md`, `DESIGN.md`, `DECISIONS.md`, `README.md`, `CHANGELOG.md`, `docs/HARDWARE_TEST_PLAN.md`, `QUESTIONS.md`, and `SECURITY.md` if it lists what CafAI talks to.
- Not yours: `src/ui/saver/types.ts`, `random.ts`, `runner.ts`, `registry.ts`, `savers/**`, `src/ui/preview/saverPreview.ts`, `dev/**`, `scripts/shoot-saver.mjs`.

Interfaces (others and the review rely on these names):

```ts
// src/ui/saver/policy.ts (pure)
export const SAVER_IDLE_MS = 60_000;          // asleep and untouched this long: up
export const SAVER_SHOW_MS = 30 * 60_000;     // then black, the wake lock let go
export const SAVER_BRIGHTNESS = 30;
export interface SaverInputs { on: boolean; insideDecaid: boolean; asleep: boolean; untouchedMs: number }
export function saverWanted(inputs: SaverInputs): boolean;
/** Confirmed asleep (spec 3): connected, reachable, and `sleeping` in Decaid's frames. */
export function confirmedAsleep(telemetry: TelemetrySnapshot): boolean; // the telemetry store's state type
/** The brightness to dim to: SAVER_BRIGHTNESS, or the barista's own when it is lower. */
export function dimTo(requestedBrightness: number): number;

// src/ui/saver/daily.ts
/** "A different one each day": the ids in a fixed shuffled order, one a day; none twice running. */
export function dailyPick(available: readonly SaverId[], day: number): SaverId;
/** What shows for a pick: 'daily' resolved; an id this device cannot run, or does not know, is the day's pick. */
export function resolvePick(pick: string, available: readonly SaverId[], day: number): SaverId;

// src/storage/types.ts
export interface ScreensaverSetting { on: boolean; pick: string } // pick: a SaverId or 'daily'; storage keeps any short string, the UI resolves it
// Settings.screensaver?: ScreensaverSetting — absent until changed on this device, read as DEFAULT_SCREENSAVER
export const DEFAULT_SCREENSAVER: ScreensaverSetting = { on: true, pick: 'daily' };

// src/app/screensaverSetting.ts — as src/app/temperatureUnit.ts: get(), subscribe(), set(next) (shows at once, saves; a failed save rejects), reload()
// services.screensaver; useScreensaverSetting() in src/app/services.tsx

// src/api/display.ts
export interface DisplayState { brightness: number; requestedBrightness: number; wakeLockEnabled: boolean; wakeLockOverride: boolean }
export type DisplayCommand = { command: 'setBrightness'; brightness: number } | { command: 'requestWakeLock' } | { command: 'releaseWakeLock' };
// createDisplayChannel({ wsOrigin, ... }): want(open: boolean); send(command): boolean; state(): DisplayState | null (null until the first frame since this opening);
// subscribe(listener); one socket while wanted, reconnecting 1 s -> 30 s (as telemetry's slots), recorded in the traffic log.

// src/app/saverScreen.ts
export const SAVER_BRIGHTNESS_KEY = 'cafai.saver.brightness';
// createSaverScreen(channel, storage): hold() (spec 4 "It comes up" and "reconnects"), release() ("30 minutes later"), restore() ("It goes", and at start with a value left over)

// src/ui/saver/preview.ts — a tiny store: show(id: SaverId), hide(), current(): SaverId | null, subscribe(); usePreviewedSaver()
```

Behaviour: the spec, sections 3 (every row), 4 (every row), 5 and 6; Nightstand as in section 7.

- [ ] **H1. The setting.** `Settings.screensaver` in storage (types, schema, normalise: `on` a boolean else true, `pick` a string of 1-40 characters else `'daily'`; `FIELDS`; `fillBlankSettings`, the local choice winning), tests beside the fun facts' and the temperature unit's. The store, wired in `createServices` and `services.tsx`; `fakeServices` gets it. Commit.
- [ ] **H2. The policy, the day's pick, reduced motion.** `policy.ts`, `daily.ts`, `usePrefersReducedMotion.ts` (copy `usePrefersDark.ts`), with table tests: every row of spec 3 and both sides of the minute; `dailyPick` over 30 days gives each id in turn and never the same twice running, and skips one not available. Commit.
- [ ] **H3. The display socket and the screen.** `display.ts` after telemetry's slot (`src/api/telemetry.ts`: connect, back-off, visibility); `fakeWebSocket.ts` records `send`; `saverScreen.ts`. Tests: frames in, commands out, a reconnect, closing on `want(false)`; remember once, dim to 30 or less, hold asks again after a reconnect, release lets the lock go and keeps the dim, restore puts the value back and forgets it, a start with a value left over restores, a failed socket changes nothing on screen. The mock: `/ws/v1/display` in `mock/decaid/ws.ts` (`WS_CHANNEL_PATHS`), its state on connect and on change, the commands applied and recorded in mock state (as the devices channel takes commands). Commit.
- [ ] **H4. The overlay and Nightstand.** `SaverOverlay.tsx` mounted as the last child of the shell's root (`AppShell.tsx`, after the main row): fixed, inset 0, over everything (top bar included). Touches: a window capture-phase `pointerdown` and `keydown` listener keeps the last touch (the heartbeat's events). Up and down by `saverWanted` (re-checked on a timer while asleep and untouched), the 30 minutes (then black and `release()`), `visibilitychange` back to visible starting it over. The tap: swallowed as `TapGuard` does (native capture, non-passive, `preventDefault` + `stopPropagation` on `pointerdown`, `touchstart`, `click`), then `sleepWake()` from `useMachineCommands()` when its model allows a wake. `SaverCanvas.tsx`: a canvas filling the overlay, `sizeSaver` with `backingScale(devicePixelRatio)`, a ResizeObserver, `runSaver` (paused while hidden), `still()` each minute under reduced motion, `dispose()` on unmount, Nightstand instead when `create` returns null or `onError` fires. Nightstand per spec 7 (the next wake time from `getPresenceSettings()` and the words in `src/ui/settings/wakeSchedule.ts`; the bag and the last shot as CafAI already writes them). Preview from `preview.ts`: anywhere, never dims, never wakes. In mock builds only, `?saverPreview=<id>&saverAt=<ms>` opens Preview at start, stepped to that moment and held, with `data-testid` `saver-ready` once painted (for the screenshots and the Chromium 91 smoke). Tests (jsdom; stub `getContext` as `src/ui/care/guide.test.ts` does): up after the minute, down on wake, the tap swallowed and the wake sent once, a disabled wake only clears, black after 30 minutes, the fallback to Nightstand. Commit.
- [ ] **H5. Settings > Screensaver.** `ScreensaverSection.tsx` after `SleepWakeSection` in `SettingsScreen.tsx`: the switch, the choice ("A different one each day" first, then `SAVERS`), the line under it (spec 5; outside Decaid the extra sentence), Preview; applied at once with the store, its error shown as `TemperatureUnitRow.tsx` shows one. A WebGL screensaver greyed out when WebGL cannot start (none in this step: keep the check, keyed on `context === 'webgl'`). Test IDs in `testIds.ts`. Commit.
- [ ] **H6. e2e, screenshots, Chromium 91.** `e2e/screensaver.spec.ts` (inside Decaid as `e2e/care.spec.ts` pretends; the mock machine asleep with `window.__CAFAI_MOCK__.player.command('sleeping')`; `page.clock` for the minute and the 30 minutes): spec 10's e2e list. Run with `E2E_PORT` from your brief: `npx playwright test e2e/screensaver.spec.ts`. A screenshot scene (Settings > Screensaver; and each screensaver at 962×602 through `saverPreview`/`saverAt`), run with `SCREENSHOTS_PORT` from your brief. The Chromium 91 smoke: `npm run build:mock`, then `node tools/chrome91/smoke.mjs --dist ../../dist-mock --wait "document.querySelector('[data-testid=saver-ready]')" --hash "?mockSpeed=25&saverPreview=<id>&saverAt=3000#/" --name saver-<id>` (run from `tools/chrome91`) for each id. Commit.
- [ ] **H7. Docs.** PRODUCT.md (the one place for play, spec 6); DESIGN.md (a Screensaver section: the overlay, the six and the two to come, the colours, the motion exception, the Settings row, the tap); DECISIONS.md, a section `### Screensavers (2026-10-22)` at the end with D223-D228 from the spec, each with its why; README (Settings > Screensaver, and the dev preview beside the other dev pages); CHANGELOG (Unreleased); HARDWARE_TEST_PLAN (a section and its results rows, spec 10); QUESTIONS (the brightness of 30, the minute, "A different one each day" as the default, the katakana's font). Commit.

## Task A: Bouncing Portafilter, Beanfield, Brew Rain (builder A)

**Files:**
- Replace: `src/ui/saver/savers/portafilter.ts`, `beanfield.ts`, `rain.ts` (keep each export's name, id and label).
- Create: a pure model beside each where it helps (`portafilterModel.ts`, `beanfieldModel.ts`, `rainModel.ts`) with its `.test.ts`.
- Not yours: everything else.

## Task B: Rising Steam, Lava Latte (builder B)

**Files:**
- Replace: `src/ui/saver/savers/steam.ts`, `lava.ts` (keep each export's name, id and label).
- Create: `steamModel.ts`, `lavaModel.ts` (and a small seeded noise module, `noise.ts`, if you need one), each with its `.test.ts`.
- Not yours: everything else.

## Tasks A and B: how each screensaver is built

What each draws is in the spec, section 7, "The first step"; follow it. For each:

- [ ] **1. The model**, pure and tested (Node, no canvas): the state and `step(dtMs)` from the seeded random alone. Tests: the same seed gives the same state after the same steps; the things the spec names stay where it says (inside the screen, the glass, the box), recycle, bounce, count corners, spell words.
- [ ] **2. The drawing**: `create(canvas, env)` gets its `2d` context (null without one), `resize` keeps the size and calls `setTransform(scale, 0, 0, scale, 0, 0)` before drawing, `draw` paints from the model with `env.palette` (dark), `still` paints the spec's still from a fresh model, `dispose` lets go of offscreen canvases. Chromium 91's canvas only (lint refuses `roundRect` and `createConicGradient`; also avoid `ctx.reset()`, `ctx.letterSpacing`).
- [ ] **3. A look**: start the dev server on your port (`npx vite --port <port> --strictPort`), then `node scripts/shoot-saver.mjs --port <port> --saver <id> --at <ms>` at two or three moments, the still (`--still 1`), and one other tint (`--tint matcha`); look at each PNG and fix what is off. At most about ten screenshots a screensaver.
- [ ] **4. Timing**: `node scripts/shoot-saver.mjs --port <port> --saver <id> --fps 1 --wait 3000` reports frames a second and the milliseconds a frame takes: aim under 4 ms here at 962×602.
- [ ] **5. Commit** each screensaver on its own (`feat: Beanfield, after Windows' Starfield: ... (D227)`).

## After the builders (the lead)

- [ ] Merge the three branches into `feat/screensavers`; delete `savers/placeholder.ts`; `npm run verify` (typecheck, lint, unit, build, release zip, e2e on a port of its own), the Chromium 91 smoke for each screensaver, the screenshot scene.
- [ ] One combined review (code and spec), its fixes.
- [ ] Into `main`, numbering the decisions (`node .verify/renumber-decisions.mjs 210`), and the check-in with the owner: what was built, how it looks, the tokens spent, and whether to go on to Espresso Pipes and Latte Art.

# Brief: baseline skin UI (shell + machine)

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/ui/**` EXCEPT `src/ui/chat/**`, `src/ui/history/**`,
`src/ui/settings/**` (the chat UI agent's), `src/ui/testIds.ts` and
`src/ui/testing/fakeServices.ts` (shared, read-only). You also own `dev/**`.

**Read:** `src/app/types.ts` (`Services`), `src/app/services.tsx`
(`useServices`, `useTelemetry`), `src/api/types.ts` (`DecaidClient`,
`TelemetryStore`, `HostEnvironment`, `GatewayError`), `src/ui/testIds.ts`,
`src/ui/testing/fakeServices.ts` (use these fakes in tests and previews),
`docs/verified/01-platform.md` sections 5, 7, 10 and 15,
`docs/verified/02-api.md` sections 3-5, `DECISIONS.md` D9, D12, D13, D15,
`docs/CREMA_PORT_PLAN.md` sections 3.2, 3.3, 10 "[6] Baseline UI".

**Crema to port:** `safearea.ts` as-is (+ `safearea.test.ts`), `dev/ipad.html`
-> `dev/tablet.html`, `dev/vite.probe.config.ts` (adapt), and re-express the
machine-command rules from `main.ts`/`views.ts` as tested React code (no code
port of Crema screens).

## Design

Chat-first, touch-first, dark espresso-bar look, legible at arm's length.
The smallest layout is **962x602 CSS px** (a 1280x800 tablet at DPR 1.33);
also 1140x712, 1280x800, 1920x1200. Touch targets at least 48 px, no hover
dependence, no edge gestures (Android edge swipes exit the skin), keep the
bottom-most strip free of must-tap controls (Decaid shows an exit hint
snackbar there for 10 s). Respect safe-area insets via the ported module's
`--safe-*` CSS variables. Never re-render the tree on WebSocket ticks: read
telemetry with `useTelemetry(selector)` selecting primitives, and drive the
graph imperatively.

## Build

1. `theme.ts` + `fonts.ts`: MUI theme (dark; warm crema primary such as
   `#C8A27A`; readable type scale; buttons/IconButtons/chips min-height 48;
   CssBaseline additions: `touch-action: manipulation`, no tap highlight,
   `user-select: none` on controls) and self-hosted Roboto via
   `@fontsource/roboto` latin subsets only (400, 500, 700).
2. `platform/safeArea.ts` (ported) and `platform/useHeartbeatOnInteraction.ts`
   (window `pointerdown` + `keydown` capture listeners ->
   `services.heartbeat.notify()`; cleaned up on unmount).
3. `router.ts`: tiny hash router. Routes `#/` (coach), `#/history`,
   `#/history/<bagId>`, `#/settings`; tolerate `?_=<ms>` in the URL; unknown
   -> coach. `useRoute(): Route`, `navigate(route)`, `routeHref(route)`.
4. `shell/AppShell.tsx`: `<AppShell route onNavigate>{content}</AppShell>`.
   Top bar: CafAI mark, nav (Coach / History / Settings with icons and
   labels; `TID.navCoach` etc.), a "Decaid settings" button
   (`TID.decaidSettings`, full-page navigation to `host.settingsUrl`), and an
   ALWAYS-visible Exit button (`TID.exitToSkins`, calls
   `host.exitToSkinSwitcher()`; label "Exit" with a tooltip-free subtitle
   such as "to Decaid" inside Decaid, "Skins" in a browser). Body: the
   machine panel on the left (about 360 px at 962 wide, wider on big
   screens) and the routed content on the right, both filling the height
   without page scrolling (inner areas scroll). Render
   `data-testid={TID.appReady}` on the root. Mount the heartbeat hook here.
5. `machine/MachinePanel.tsx` with small subcomponents:
   - Status: connection (machine and scale, from telemetry; "Not connected"
     when the machine link is down), state in plain words via
     `machine/format.ts` `describeMachineState(state, substate, connected)`
     ("Ready", "Sleeping", "Heating", "Pulling a shot: preinfusion",
     "Steaming", "Flushing", "Hot water", "Needs water", "Error"), group temp
     vs target (`TID.groupTemp`), steam temp (`TID.steamTemp`), water level
     (`TID.waterLevel`), scale weight (`TID.scaleWeight`), connection error
     from `telemetry.connectionError` (e.g. `profileUploadFailed`).
   - Controls: Espresso (`TID.espressoButton`), Steam, Flush, Hot water, and
     Stop (`TID.stopButton`, sends `idle`) as large buttons; Sleep/Wake
     (`TID.sleepWakeButton`: `sleeping` / `idle`); Tare
     (`TID.tareButton`). Rules (from Crema, as tests): while espresso, steam,
     flush or hot water runs, show Stop prominently and disable the other
     starts; nothing is commandable without a connected machine (disabled
     with the reason shown); machines with a group-head controller
     (`getMachineInfo().GHC`, fetched when connected) start shots from the
     machine, so show "Start on the machine" instead of start buttons but
     keep Stop/Sleep; tare is disabled without a scale. Show command errors
     (`GatewayError.message`) inline; never retry commands automatically.
   - `machine/LiveShotGraph.tsx` (`TID.liveGraph`) with uPlot: pressure,
     flow, weight flow (shared 0-12 axis for bar and ml/s, Crema's rule),
     weight (right axis), target pressure and target flow dashed; x in
     seconds; reset on `onShot` `started`; keep the last shot after
     `finished`; samples from `telemetry.onSample` pushed with `setData` at
     most once per animation frame; resize with ResizeObserver; a shot timer
     (`TID.shotTimer`). No React state per sample.
6. `dev/tablet.html` (port of Crema's `ipad.html`): presets for 962x602,
   1007x602, 1140x712, 1280x800, 1920x1200 and iPad 1194x834; inject
   `--safe-*`; `?src=` default `/index.html#/`; `bare=1`.
7. A dev preview page for your own visual check: `dev/preview-shell.html` +
   `src/ui/preview/shellPreview.tsx` rendering `AppShell` + `MachinePanel`
   with `createFakeServices()` and a timer that feeds fake samples. Run
   `npx vite --port 5181 --strictPort` and take screenshots with a short
   Playwright script at 962x602 and 1280x800, then LOOK at them with the
   Read tool and fix what looks wrong. Delete temporary scripts afterwards
   (keep the preview page).

## Tests (RTL, jsdom)

Panel states from a fake telemetry store (connected / disconnected /
sleeping / pulling); each button sends the right state; Stop while running;
disabled without a machine; GHC hint; tare disabled without a scale and its
error shown; Exit calls `host.exitToSkinSwitcher()`; the settings button
targets `host.settingsUrl`; router parsing; heartbeat hook; the graph
subscribes to and unsubscribes from `onSample` (mock `uplot` with
`vi.mock`, since jsdom has no canvas); the ported safe-area tests.

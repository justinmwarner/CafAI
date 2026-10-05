# Workstream: simulator (test CafAI in a desktop browser against Decaid's own simulator)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own").

## Goal

The owner wants to test CafAI on their Windows computer, in a browser,
against Decaid's own simulated machine. Research (2026-10-05, from Decaid's
source at E:\source\cafai\.ref\decaid and its v0.8.7 release; not yet tried
on this machine) found it already works without code changes:

- Decaid's ready-made Windows build (`decaid-windows-x64-latest.zip` from
  https://github.com/decentespresso/decaid/releases/latest) has a simulated
  machine and scale: "Try Demo Mode" on the device-scan screen (one session),
  or Settings > Advanced > Simulated Devices with Machine and Scale only
  (kept; turning on Bengle too adds a second machine), or
  `POST /api/v1/settings {"simulatedDevices":["machine","scale"]}` then a
  restart (`lib/src/services/simulated_device_service.dart:47-80`,
  `lib/src/settings/advanced_page.dart:139-173`,
  `device_discovery_feature/scan_flow_view.dart:68-82`,
  `services/webserver/settings_handler.dart:278-298`).
- Its API listens on 0.0.0.0:8080 (Decaid refuses to start when 8080 is
  taken); skins are served behind port 3000 (nothing else may use 3000).
- `npm run dev` at http://localhost:5173 talks to localhost:8080 (no
  `reaHostname` needed; remove a leftover one). Dev mode calls the real
  Anthropic API, so it needs a real key.
- CafAI can also run inside Decaid's window: `npm run release:zip` then
  Skins > + > ZIP file, or `Decaid.exe --skin-path E:\source\cafai\dist`
  (`lib/src/cli/cli_args.dart:29-59`). Settings > Advanced > Simulated
  WebViews > Teclast P80X shows it at 962x602.
- What the simulator exercises: Decaid's real REST and WebSocket API, the
  machine-load barrier (succeeding instantly), espresso that follows the
  profile and stops at weight on the simulated scale, saved shots with notes
  and ratings, the grinder library and KV store (real storage, empty at
  first). What it cannot: grind effects (random puck resistance per shot),
  group-head starts, slow or failed uploads (use CafAI's `?mockUploadMs` and
  `?mockNoMachineProfile`), Chromium 91, dropped devices.

## What to build

1. **A coach-only mock.** Today mock mode always starts the mock Decaid and
   the scripted coach together (`src/main.tsx` `startMocks`), and the mock
   Decaid catches every request to port 8080, so the simulator cannot be
   paired with the scripted coach and every simulator test spends real API
   tokens. Add a URL switch `?mockDecaid=0` (read once at start, documented
   with the others) that starts only the scripted Anthropic mock, so every
   Decaid call goes to the real Decaid (the simulator on localhost:8080, or
   `localStorage.reaHostname`). No `window.__CAFAI_MOCK__` then, and
   `?mockPersist` does nothing. Add an npm script `dev:sim` that serves mock
   mode and opens `/?mockDecaid=0` (for example `vite --mode mock --open
   "/?mockDecaid=0"`). Production builds must still contain no mock code.
2. **Dev and mock dev side by side.** Give mock mode its own Vite cache
   folder (`cacheDir`, e.g. `node_modules/.vite-mock`), because mock mode
   adds a plugin and Vite would otherwise keep rebuilding the shared cache
   when `npm run dev` and `npm run dev:mock` run at once.
3. **`docs/SIMULATOR.md`** (new): the steps above, written for the owner on
   Windows, in order: download and run Decaid (unknown-publisher warning;
   `--bypass-onboarding`), skip login, Try Demo Mode or the Settings
   switches, check `http://localhost:8080/api/v1/devices` lists the mock
   machine and scale, then either `npm run dev` (real coach, real key) or
   `npm run dev:sim` (scripted coach, no key needed beyond any placeholder),
   clearing a leftover `reaHostname`; running CafAI inside Decaid's window;
   what the simulator can and cannot test. Mark clearly what was verified from
   source only and what has not been tried. Add a short pointer in README's
   "Develop" section (replace its vague "or the Decaid simulator" with a link).

## You own (create or modify only these)

- `src/main.tsx` (the mock-mode branch only), `mock/browser.ts`,
  `mock/decaid/urlOptions.ts` (+ test) if the switch belongs there, new
  `mock/*.ts` helpers with tests.
- `vite.config.ts` (`cacheDir` only), `package.json` (the `dev:sim` script
  only).
- `docs/SIMULATOR.md` (new), and README.md's "Develop" section only.

Read-only: everything else. Another workstream is changing
`src/app/engine/**`, `src/ui/machine/**`, `src/llm/live/anthropic.live.ts`
and `e2e/verifier-fixes.spec.ts` right now.

## Tests and verification

Unit tests for whatever decides which mocks start (factor it into a pure
function if that helps), the switch, and that the default is unchanged. Run
and report exit codes (capture with `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`,
never through `| tail`): `npm ci` (first), `npx tsc -p tsconfig.json
--noEmit`, `npx eslint .`, `npx vitest run`, `npm run build` (then check
`dist/` holds no mock code: search for `__CAFAI_MOCK__` and `mockDecaid`),
`npm run build:mock`. You may start `npx vite --mode mock --port 5199
--strictPort` briefly to check that `/?mockDecaid=0` loads with no
`__CAFAI_MOCK__` and that the scripted coach still answers, then stop it and
leave nothing running; never use ports 4174, 5173, 8080 or 3000. No
Playwright. Final message (at most 50 lines): worktree path and branch, files
changed, tests added, commands with exit codes, anything not verified.

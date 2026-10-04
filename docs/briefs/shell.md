# Workstream: shell (old-engine warning, loaded profile in the machine panel)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Two small, separate features.

## Goal 1: warn on a browser engine older than Chromium 91 (QUESTIONS #4)

The owner's answer: "we do not need to worry about browser support. We can
add a warning if that is possible." CafAI is built for and verified on
Chromium 91 (D3, D40); the build target stays `chrome91` (D50). Add a warning,
nothing more:

1. **Inline check in `index.html`.** A small classic `<script>` (ES5 only: no
   arrow functions, `let`/`const`, template literals, or anything Chromium
   49 could not parse) placed before the module script. **Inside Decaid's
   WebView `navigator.userAgent` is the literal string "Decent"**
   (`docs/verified/01-platform.md` line 191), so support is decided by
   feature detection (correction sent to the agent after launch):
   - `chromium` (message only): the major version from
     `navigator.userAgentData.brands` when present, else `Chrome/NN` in the
     user agent, else null;
   - `supported`: false when a known `chromium` is below 91; otherwise a
     syntax probe, `new Function('class A { #x; static has(o) { return #x in
     o; } } return A.has(new A());')`: private brand checks shipped in V8 9.1
     (Chromium 91), so a SyntaxError means older than the floor (false),
     success means true, any other error (e.g. a CSP EvalError) means null
     (unknown: never warn on unknown);
   - the result, with what decided it, goes on `window.__CAFAI_ENGINE__`,
     e.g. `{ chromium: null, supported: false, reason: 'probe' }`. The
     messages name the version only when it is known;
   - one `console.info` line, `[CafAI] engine check: {...}` (chromium,
     supported, reason only), so the hardware session can read the result
     from Decaid's saved WebView console (`GET /api/v1/webview/logs`). Never
     an error-level line: the Chromium 91 smoke test fails on those.
2. **Start-up watchdog in the same script.** If the app never starts
   (an engine that cannot parse the bundle or run modules leaves `#root`
   empty; `src/main.tsx` renders "Starting CafAI…" into `#root` as its first
   act), then after about 15 s (8 s in the first version; raised in review,
   because nobody has timed a cold start on a Decent tablet), or at once on a
   script `SyntaxError` caught by a `window` `error` listener or a failed load
   of the bundle itself (a capture-phase `error` listener, added in review),
   replace the page with a plain message: "CafAI
   could not start on this tablet's browser engine (Chromium NN). It needs
   Chromium 91 or newer." plus two full-size (48 px) controls: **Exit to
   Decaid** (`window.decentApp.exitToDashboard()` when it exists, else the
   settings URL) and **Decaid settings** (a link to
   `http://<host>:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI`,
   host = `localStorage.reaHostname || location.hostname`, D13/D14). There must
   always be a way back to Decaid (D12). The watchdog must never fire in a
   normal start (the e2e suites and both Chromium 91 runs must stay green with
   zero console errors).
3. **In-app warning.** When `window.__CAFAI_ENGINE__.supported === false` and
   the app did start, `AppShell` shows a dismissible warning between the top
   bar and the columns: "This tablet runs Chromium NN. CafAI is tested on
   Chromium 91 and newer, so some parts may not work." Dismissal is remembered
   per engine version in `localStorage` (key `cafai.engineWarning`). It must
   not cover any control, and the app must still fit 962x602 with it shown.
   Nothing changes on Chromium 91 and newer.

## Goal 2: show which profile is loaded, in the machine panel

MORNING.md lists it as a gap: "the machine panel does not show which profile
is loaded (the coach and the banner say so when it matters)". Add a
**Profile** line to `MachineStatus`:

- The value is the title of the profile in Decaid's current workflow
  (`services.decaid.getWorkflow()` -> `profile.title`). Decaid has no workflow
  WebSocket, so read it: on mount; when the coach's active version changes or
  a new chat message arrives (`useCoach`, debounced ~500 ms); when a shot
  finishes (`telemetry.onShot`); when the machine connects; and every 30 s
  while the page is visible (another skin or the machine's own screen can
  change it). At most one request in flight; a failed read keeps the last
  value (or "—" when there is none) and never shows an error of its own.
- When the workflow's CafAI tag (`context.extras.cafai.versionId`, D41) names
  the active bag's version and the titles match, mark it as this bag's
  version (e.g. a small check or "this bag"). Otherwise show only the title:
  the panel never claims a match it cannot see. While the machine is not
  connected, say Decaid loads it when the machine connects (D42 wording:
  never "on the machine" while offline).
- Long titles truncate with an ellipsis (full title in the `title`
  attribute) in the 360 px column at 962x602; nothing in the panel may wrap
  or move other readouts.

## You own (create or modify only these)

- `index.html` (the inline script only; keep the module script tag as is).
- `src/ui/shell/AppShell.tsx`, `src/ui/shell/AppShell.test.tsx`.
- `src/ui/machine/**` (e.g. `MachineStatus.tsx`, a new `LoadedProfile.tsx` or
  `useLoadedProfile.ts`, their tests).
- New: `src/ui/platform/engineCheck.ts` (+ test) if you want shared parsing
  helpers for AppShell; and a test that loads `index.html`, extracts the
  inline script and runs it in jsdom with fake user agents (e.g.
  `src/ui/platform/engineScript.test.ts`).
- New e2e specs (you may not run them): `e2e/engine-warning.spec.ts`,
  `e2e/machine-profile.spec.ts`.

Read-only for you: everything else, notably `src/main.tsx`, `src/ui/testIds.ts`
(locate new elements by role and accessible name instead), `src/app/**`,
`src/ui/chat/**`, `src/ui/testing/fakeServices.ts` (override methods on the
fake you get back inside your own tests instead), `mock/**`, `package.json`,
`vite.config.ts`, `scripts/release-zip.mjs`.

## Interfaces to keep

`AppShell` props and its `data-testid`s; `MachinePanel`/`MachineStatus`
exports; the `TID` ids already rendered. `window.__CAFAI_ENGINE__` is new:
declare its type where you use it.

## Tests you must add and how to verify

- Inline script (jsdom, fake UAs): Chrome/85 -> `supported: false`; Chrome/91
  and Chrome/120 -> `supported: true`; an iOS Safari UA -> `null`, no warning;
  empty `#root` after the watchdog delay (fake timers) -> the fallback with
  both controls; a rendered `#root` -> no fallback; `exitToDashboard` called
  when present.
- AppShell: the warning shows for `supported: false`, hides on dismiss and
  stays hidden for that version; absent otherwise.
- Machine panel: title shown; "this bag" only with tag and title matching;
  offline wording; refresh on active-version change and on shot finish; a
  failing read keeps the last value.
- E2E (written, not run): Chromium 85 user agent (`test.use({ userAgent })`)
  shows the in-app warning, dismiss works; the default UA shows none; aborting
  the app bundle request (`page.route` on the entry script) shows the
  fallback with Exit and Decaid settings. Machine panel: after picking a
  template the Profile line shows "<Bean> v1"; after a confirmed change, v2.
- Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
  never through `| tail`): `npm ci` (first, in your worktree),
  `npx tsc -p tsconfig.json --noEmit`, `npx eslint .` (or your paths plus
  `index.html` is not linted: say how you checked the inline script is ES5),
  `npx vitest run` (whole unit suite), `npm run build` (the release script
  must still accept the output; also run `npm run release:zip`).
- Do not run Playwright or the Chromium 91 tools (the coordinator does).

## Report back (your last message, at most 60 lines)

Files changed; tests added (counts, passing?); every command with its exit
code; how the inline script was checked for ES5; screenshots are not needed;
known gaps.

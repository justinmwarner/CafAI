# Crema → CafAI port plan

Audit of `yarneo/crema` `web/` (the Decaid edition) to decide what CafAI ports, adapts or drops.
CafAI ports Crema's non-UI logic where it fits and none of its screens.

- **Source:** `E:\source\cafai\crema`, commit `628cd714fa1a3a5194ea0e4c579d54ae1e38353c` (2026-09-24, "docs: v1.1.2 changelog"). Full history, not shallow: 57 commits, 17 of them touching `web/` (2026-09-02 → 2026-09-15).
- **Versions:** repo `VERSION` = `1.1.2` (the release tags). `web/package.json` and `web/public/manifest.json` = `0.2.1`. The skin numbers its own line: 0.1.0 → 0.2.0 at v1.1.0 → 0.2.1 at v1.1.1. A skin installed from tag v1.1.2 therefore reports version 0.2.1.
- **Audit date:** 2026-10-03. Nothing in the Crema tree was modified. `npm ci` created `web/node_modules/`, which git ignores. A production build was written to a temp dir and then deleted. `git status` in the clone is clean.
- **Cross-checks:** some Crema assumptions were checked against the Decaid reference checkout `E:\source\cafai\.ref\decaid`. That checkout is shallow, at HEAD `a45961b` (2026-10-01). Those findings are marked **[Decaid HEAD]**. Re-verify them against whichever Decaid version CafAI pins.

## 0. At a glance

- **Size.** `web/` has 31 source files (10,252 lines) and 19 test files (3,850 lines, 361 tests). It has **zero runtime dependencies**: devDeps are only `typescript`, `vite` and `@types/node`.
- **The UI shell is most of the code.** `main.ts` (2,714), `ui/views.ts` (1,668), `styles.css` (1,317) and `ui/scrub.ts` (209) make up 58 % of the source lines. All four are dropped. The rest is small, pure and well tested.
- **Tests.** `npm test` uses Node's built-in runner, not Vitest. Result: **361/361 pass** in about 1.2 s. `tsc --noEmit` is clean and `vite build` succeeds.
- **Verdicts across 63 rows:** PORT AS-IS 19, ADAPT 29, DROP 15. Details are in §2.
- **Best assets:**
  - `advice/phases.ts`: stall pressure decides whether the fix is grind or profile.
  - `domain/recipe.ts` + `domain/trail.ts` + `advice/attempts.ts`: the diff, the held fields, and the "already tried" log.
  - `gateway/client.ts` patterns: deadlines, error unwrapping, the four profile fields, and single-device connect.
  - `safearea.ts`.
  - The prompt wording in `advice/prompt.ts`.
- **Five things I found that Crema's own tests do not catch:**
  1. The settings mirror is never written in normal use (§3.5).
  2. Three `Array.prototype.at(-1)` calls shipped in the bundle despite the Chrome 78 target (§3.6).
  3. The UI still re-renders the whole tree on every WebSocket sample during a shot (§3.3).
  4. The prompt labels t = 0 as "first drop" when it is actually pump start (§4.3).
  5. The starter prompt tells the model "you have web search", but direct API calls attach no tools (§4.3).

---

## 1. Provenance, licence, credits

### 1.1 Licence

- `crema/LICENSE` is the **verbatim GNU GPL v3 text** ("GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007", 35,823 bytes, ends at "END OF TERMS AND CONDITIONS" plus the "How to Apply" appendix).
- `skin/Crema/LICENSE` is byte-identical: both have md5 `e62637ea8a114355b985fd86c9ffbd6e`.
- The only copyright line in either file is the FSF's own line for the licence text: ` Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>`.
- **Version grant:** the README says "GPLv3". Nothing anywhere says "or (at your option) any later version", so by GPLv3 §14 the code is **GPL-3.0-only**.

### 1.2 Copyright notice format

**There is none.** I searched with `git grep -i "copyright|(c) 20|SPDX"` across the whole repo. Apart from the two LICENSE copies and binary font files, nothing matches.

- No file in `web/`, `skin/` or `server/` has a per-file header or SPDX identifier.
- `web/package.json` has **no `license` field**.
- `web/public/manifest.json:6` has `"author": "yarneo"`.
- No line anywhere names a copyright holder. Authorship is implied: all 57 commits are by **Yarden (GitHub `yarneo`)**, and the manifest names `yarneo`.
- The only repo-level attribution is in `README.md:324-328`:

> ## License & credits
>
> GPLv3 (see [skin/Crema/LICENSE](skin/Crema/LICENSE)). Crema is a fork of the
> MimojaCafe skin for de1app. Splash photo by
> [Clint McKoy / Unsplash](https://unsplash.com/@clintmckoy).

### 1.3 Lineage and credit mentions

- **MimojaCafe:**
  - In `README.md:326-327` (quoted above).
  - In `skin/` only. Examples: `skin/Crema/ai/home.tcl:45`, "MimojaCafe - the skin Crema forked from - has always hidden them in that case…"; `skin/Crema/theme.tcl:1-4` (`init_MimojaCafe_dui_theme`); and the `::skin::mimojacafe::*` namespaces in `skin.tcl` and `interfaces/*.tcl`.
  - **None in `web/`.** `git grep -i mimoja -- web` returns nothing. The `web/` TypeScript is a new codebase. It contains no MimojaCafe code.
- **Ported "from the Tcl skin":** these `web/` comments say the logic was ported from the Tcl skin. Most point at Crema's own `skin/Crema/ai/*.tcl` advisor modules, such as `llm.tcl` ("Crema standalone LLM client"), which Crema added to the fork. The palette credits point at the Tcl skin's `::crema_light_theme` (`skin/Crema/settings.tcl:65`) and only describe a design. No Tcl code was translated for the palette.
  - `domain/grind.ts:2`
  - `advice/parse.ts:48,193` (`extract_json`, the DE1 limits)
  - `advice/provider.ts:4` (`llm.tcl`)
  - `advice/curves.ts:6,18,38`
  - `advice/prompt.ts:131,215`
  - `advice/schema.ts:4,117`
  - `advice/discover.ts:4`
  - `domain/profile.ts:86`
  - `ui/views.ts:290` (the instruction as headline)
  - `styles.css:13,64,364` (palette and headline)
- **Decent Streamline:** `gateway/workflow.ts:12` mentions it ("matches how Decent's own Streamline skin describes its temperature control"). This is a design reference only. No code was copied.
- **Splash photo:** `skin/Crema/splash_copyright.txt` credits Clint McKoy / Unsplash. It applies to `skin/` only; `web/` uses no images.

### 1.4 Recommendation for CafAI

1. Every file derived from Crema should carry a header, because GPLv3 §5(a) requires a "prominent notice … that you modified it, and giving a relevant date". For example:

   ```ts
   // SPDX-License-Identifier: GPL-3.0-only
   // Derived from Crema web/src/advice/phases.ts (https://github.com/yarneo/crema
   // @ 628cd714fa1a3a5194ea0e4c579d54ae1e38353c), Copyright (C) 2026 Yarden (yarneo).
   // Modified for CafAI, 2026-10: <one-line summary of the change>.
   ```

2. Add a `CREDITS.md` (or a NOTICE section in the README). It should list every ported file with its Crema source path and commit, and credit Crema as "a fork of the MimojaCafe skin for de1app". Crema's README leads with that lineage even though `web/` contains no MimojaCafe code.
3. **Licence conflict:** the CafAI scaffold's `package.json` (as observed on 2026-10-03) declares `"license": "GPL-3.0-or-later"`. Crema grants only v3, so Crema-derived files cannot be "or later". Choose one:
   - license CafAI as `GPL-3.0-only`, or
   - keep `-or-later` for CafAI's own files and mark the Crema-derived files `GPL-3.0-only` in their SPDX headers and in `CREDITS.md`.

   This is decision C1 in §9.

---

## 2. Module map

Key to the columns:

- **Kind:** logic, UI, mixed, config, dev, or test.
- **Tests covering it:** test file, rough count, and a quality rating:
  - *thorough*: the important behaviour and edge cases are pinned.
  - *partial*: some functions are covered and others are not.
  - *none*.
- **Target paths** follow CafAI's architecture. Test files are co-located as `*.test.ts`, which matches the scaffold's Vitest include `src/**/*.test.{ts,tsx}`.
- **Imports:** every `src` import is internal. Crema has no external runtime imports anywhere; tests use only `node:test` and `node:assert/strict`.

### 2.1 Config, dev and scripts

| Path | Lines | What it does | Imports | Kind | Tests | Verdict | CafAI target | Rationale |
|---|---|---|---|---|---|---|---|---|
| `web/package.json` | 21 | npm scripts: `dev`, `dev:lan`, `build` (`tsc --noEmit && vite build`), `test` (`node --test --experimental-strip-types "src/test/*.test.ts"`), `validate:manifest`, `release:zip` (shells out to POSIX `rm` and `zip`). devDeps: `@types/node ^22.20.1`, `typescript ^5.7.3`, `vite ^6.0.7`. | — | config | none | ADAPT | `package.json` (exists in the scaffold) | Keep the script names and the version-as-single-source idea. Replace the shell `zip` with a Node script, because the developer machine runs Windows. Switch the test runner to Vitest. |
| `web/package-lock.json` | 1197 | Lockfile v3, 67 packages (TS 5.9.3, Vite 6.4.3, esbuild 0.25.12, Rollup 4.63.1). | — | config | — | DROP | — | Regenerate. |
| `web/tsconfig.json` | 22 | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly`, `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` (both for Node strip-types), `types:["node"]`, ES2022, bundler resolution, `noEmit`. | — | config | — | ADAPT | `tsconfig.json` | The scaffold already has the same strictness set and `erasableSyntaxOnly`. Ported files keep their `.ts` import specifiers unchanged, because the scaffold sets `allowImportingTsExtensions` and `noEmit`. |
| `web/vite.config.ts` | 13 | `base:'./'`, `build.target:'chrome78'`, `outDir:'dist'`, dev server `127.0.0.1:5173`. | `vite` | config | — | ADAPT | `vite.config.ts` | Keep `base:'./'`. Change the target to `chrome91`, which the scaffold has already done. |
| `web/index.html` | 19 | `viewport-fit=cover`, `color-scheme`, `#app` mount, then the absolute same-origin `<script src="/__decent/skin-api.js">` (which provides `window.decentApp.exitToDashboard()`), then the module entry. | — | config | — | ADAPT | `index.html` | Keep `viewport-fit=cover` and the skin-api script tag **verbatim**. Decaid serves the script at that absolute same-origin path (`doc/Skins.md:3374`). |
| `web/public/manifest.json` | 8 | Decaid skin manifest: `id`, `name`, `description`, `version`, `author`, `repository`. | — | config | validate script | ADAPT | `public/manifest.json`, plus an identical `public/skin-manifest.json` | Change `id` to `cafai`. Generate both files from `package.json`. **[Decaid HEAD]** `skin-manifest.json` wins over `manifest.json` (`lib/src/webui_support/webui_storage.dart:998-1013,1107-1119`), so the two must match. |
| `web/scripts/validate-manifest.mjs` | 38 | Fails the release if `public/` or `dist/manifest.json` is missing any of `id`, `name`, `description`, `version`, `author`; if `id` fails `^[a-z0-9][a-z0-9_-]*$`; or if `version` differs from `package.json`. | `node:fs`, `node:path` | dev | none | PORT AS-IS (then extend) | `scripts/validate-manifest.mjs` | Extend it to also check: `skin-manifest.json` matches `manifest.json`; `index.html` sits at the dist root; the version is numeric dot-segments (per the MSL convention); and the zip root layout. |
| `web/dev/ipad.html` | 53 | iframe harness for vite dev: `?w&h&inset&src&bare&tab`. Draws the home-indicator strip, injects `--safe-bottom` into the framed document, can click a tab by its text, and sets `document.title='ready'` for screenshot scripts. | — | dev | none | ADAPT | `dev/tablet.html` | This is the only way to see the inset bug on a desktop. Add presets for the Teclast P85Pro (1280×800 @ DPR 1.125, about 1138×711 CSS px) and the iPad Air (1180×820, inset 20). Deep-link with `#/route` instead of clicking tab text. `?empty=1` is vestigial. |
| `web/dev/vite.probe.config.ts` | 133 | Dev-only Vite config. Injects a probe script that every 1.2 s measures `--safe-*`, whether the tab row clears the safe line and whether content clears the dock, then beacons JSON to a `/__probe` middleware that logs it in the terminal. `?sweep=1` walks the tabs. | `vite`, `../vite.config.ts` | dev | none | ADAPT | `dev/vite.probe.config.ts` | Swap Crema's CSS selectors (`.tabs`, `.nav-dock`, …) for `data-testid` hooks. Keep the probe ES5-safe for old WebViews. `.demo-banner` is vestigial. |
| `web/README.md` | 162 | Decaid edition README: install, the platform shape, the simulated-devices curl recipe, install-from-URL, and a status checklist. | — | docs | — | DROP (harvest) | `docs/DEV.md` | Copy over the dev recipes: `simulatedDevices`, connecting `MockDe1`/`MockScale` by id, `POST /api/v1/webui/skins/install/url`, `PUT /api/v1/webui/skins/default` (**[Decaid HEAD]** confirms PUT, and `RESEARCH.md:53` wrongly says POST), and "restart to load a new default skin". |
| `web/.gitignore` | 4 | Ignores `node_modules/`, `dist/`, `*.zip`. | — | config | — | ADAPT | `.gitignore` | Add `.vite/`. |
| `web/.vite/deps/_metadata.json` | 7 | Vite dep-optimizer cache, committed by accident in `601af56`. | — | — | — | DROP | — | Cache file. |
| `web/.vite/deps/package.json` | 3 | Same cache. | — | — | — | DROP | — | Cache file. |
| `web/src/vite-env.d.ts` | 22 | Types `VITE_GATEWAY` and `window.decentApp.exitToDashboard?()`. | `vite/client` | config | — | ADAPT | `src/vite-env.d.ts` | Keep the `DecentApp` typing. |

### 2.2 Source

| Path | Lines | What it does | Imports | Kind | Tests | Verdict | CafAI target | Rationale |
|---|---|---|---|---|---|---|---|---|
| `src/main.ts` | 2714 | The entire app shell: a global mutable `state`, `render()` via `root.innerHTML`, delegated click/submit/change/input handlers, the LiveMonitor wiring, the advice loop (get, reconsider, starter, apply, undo), bean/bag/profile/water actions, settings save/hydrate/mirror, the chime, and the boot sequence. | almost every module plus `./styles.css` | mixed (mostly UI) | **none** | DROP (extract logic) | Decisions go to `src/coach/*`, I/O orchestration to `src/api/apply.ts` and `src/storage/*` (§10) | Not portable: an innerHTML shell with one global state object. Its orchestration rules are hard-won and must be re-expressed as tested services: apply order (`:1400-1483`), undo (`:2517-2525`), per-bean presets (`:1587-1652`), mirror and hydrate (`:1883-1923`), REST seeding at boot (`:2683-2692`), duplicate titles (`:2212-2225`), the water-field whitelist (`:2018-2092`), starter gating (`:488-534`). |
| `src/styles.css` | 1317 | The whole visual system: dark/light tokens, the `--safe-*` inset variables, layout, `.no-flex-gap` fallbacks, tap targets. | — | UI | none | DROP (harvest tokens) | `src/ui/theme.ts`, global CSS | MUI theme replaces it. Keep the safe-area variable pattern (`:43-58`, `:385-406`, `:821-848`), tap targets of at least 44–46 px (`:858`), `touch-action:manipulation`, and `svg[data-scrub]{touch-action:none}` (`:1216`). |
| `src/ui/views.ts` | 1668 | Pure "model in, HTML string out" views for every screen, plus a handful of pure helpers. | domain/*, advice/provider, schema, phases | UI | `views.test.ts` (~88) thorough (HTML assertions) | DROP (extract helpers) | `src/coach/diffText.ts` (`leadChange` `:205-232`); `src/ui/machine/commands.ts` (`isRunningMachineState` `:1547-1551`, action-bar rules `:1576-1610`); `src/coach/quickReplies.ts` (`REBUTTAL_OPTIONS` `:1215-1222`); `src/coach/beans.ts` (`ROAST_LEVELS` `:997`, `formatBagSize` `:1004`); `src/coach/summary/stages.ts` (goal-curve stage detection `:567-586`) | The screens are not ported. The helpers are good. Note: it uses `.at(-1)` at `:558`, `:584` and `:706` (§3.6). |
| `src/ui/scrub.ts` | 209 | "Hold the graph to read values": inverts SVG polyline coordinates back to time and value; pointer capture. | — | UI | `scrub.test.ts` 10 thorough (pure parts only) | DROP | — | CafAI charts with uPlot (canvas, in the scaffold), whose cursor and legend do this already. If an SVG chart is ever hand-drawn, `nearestIndex` is reusable. |
| `src/live.ts` | 266 | The `LiveMonitor` class: four WebSockets (`/ws/v1/machine/snapshot`, `/ws/v1/scale/snapshot`, `/ws/v1/devices`, `/ws/v1/machine/waterLevels`), unconditional reconnect with backoff, shot start and end detection on `state.state === 'espresso'`, sample accumulation. Also `parseScaleFrame`, `deviceConnections`, `toCurves`. | gateway/types | logic (I/O) | `live-connections.test.ts` 2, `prompt.test.ts` 2 (`toCurves`): **partial**; LiveMonitor itself untested | ADAPT | `src/api/ws.ts` (socket slots), `src/api/liveShot.ts` (pure accumulator) | Keep per-stream reconnect and the rule that device state comes only from `/ws/v1/devices`. Add: a silent-socket watchdog, `visibilitychange` handling, timestamps taken from snapshots, `substate` markers. Split the pure reducer out so it can be tested. |
| `src/store.ts` | 247 | Decaid KV store client: namespace `crema`, keys `shot-index`, `shot-<id>`, `bean-dial-in-<beanId>`, `settings-mirror`. GET treats a 404 as null; POST writes; DELETE removes. Also `ShotRecord`, `newShotRecord`, `hasCurves` (legacy-safe) and `needsRating` (30-minute window). | gateway/client, domain/rating, recipe, advice/schema, curves | logic (I/O) | `settings-mirror.test.ts` 2, `prompt.test.ts` 4: **partial** (index, readRecent and delete untested) | ADAPT | `src/api/kv.ts` (KV client), `src/storage/mirror.ts` (mirror), `src/coach/shotRecord.ts` (`hasCurves`, `needsRating`) | The KV store becomes a mirror, not the primary store. Change the namespace to `cafai` and never write Crema's keys. `readRecent` fires up to 100 parallel GETs at boot. The index is updated by an unguarded read-modify-write. Records hold full-resolution curves, although the comment at `:42` says "downsampled". |
| `src/settings.ts` | 125 | `localStorage` key `crema.settings.v1` holds provider, apiKey, model, baseUrl, grinderName, grinderRange and theme. Loads validated and wrapped in try. `saveSettings` returns false when storage throws. `isReady` (the Mac server needs a baseUrl). GHC cached in `crema.machine.ghc.v1`. | advice/provider | logic | `provider.test.ts` 1 (`isReady`): **partial** | ADAPT | `src/storage/settings.ts`, `src/storage/secrets.ts` | Move settings to IndexedDB behind a repository. Keep the API key in its own local-only record: never exported, never mirrored. Keep the GHC cache, which avoids a layout flicker. |
| `src/safearea.ts` | 132 | Resolves the bottom inset: believe a non-zero `env()`; otherwise infer one (20 px on tablets, 34 or 21 on phones) when a touch device's page fills the whole screen. Publishes `--safe-bottom`. Watches resize and orientation. | — | logic (DOM glue) | `safearea.test.ts` 10 thorough (pure); `applySafeArea` untested | PORT AS-IS | `src/ui/platform/safeArea.ts` | Hard-won and measured on a real iPad in Decaid 0.8.6. Call it before the first paint and expose `--safe-*` to the MUI theme. |
| `src/compat.ts` | 53 | Measures whether flexbox `gap` works (missing before Chrome 84) and sets `.no-flex-gap`. | — | logic (DOM) | `views.test.ts` 2 partial | DROP | — | Chrome 91 supports flex gap. Keep the lesson that unit tests in Node cannot catch browser-version gaps. |
| `src/formstate.ts` | 251 | Before each `innerHTML` render, captures dirty form controls, focus/caret and scroll positions; restores them after. | — | logic (DOM) | `formstate.test.ts` 9 partial (capture/restore DOM untested) | DROP | — | React controlled inputs make this unnecessary. Keep the rule: never let a background update wipe user input or scroll position. |
| `src/gateway/client.ts` | 351 | Decaid REST client. Origin resolution (`hostname:8080`, `VITE_GATEWAY` override). 8 s `AbortController` deadline on every call. JSON error unwrapping. Workflow, profiles, beans, batches, devices, scale tare, machine state and info, shots. `createProfile` fills the four required fields. `connectKind` runs a quick scan, then a full scan, then connects by id. | ./types | logic (I/O) | `gateway.test.ts` ~20 + `profile.test.ts` 3: **thorough** (stubbed fetch) | ADAPT | `src/api/client.ts` | Keep almost all of it. Add heartbeat, a runtime host override, and typed errors. `readShots` (`:348`) is dead code. Merge with the OpenAPI-generated types. |
| `src/gateway/types.ts` | 188 | Hand-narrowed wire types, verified against a live gateway: `grinderSetting` is a string; profile = domain Profile; machine state; devices; beans and batches; steam, hot water, rinse. | domain/profile | logic (types) | n/a | ADAPT | `src/api/types.ts` | Generate the base types from `rest_v1.yml` and keep Crema's verified annotations as overrides and comments. |
| `src/gateway/workflow.ts` | 109 | `workflowToRecipe` (temperature = the hottest step; grind parsed from its string). `diffToWorkflowPatch` sends only the changed context fields; a temperature change sends the full profile with every step shifted. `undoPatch` sends explicit nulls. | domain/grind, profile, recipe, ./types | logic | `gateway.test.ts` 14 thorough | ADAPT | `src/api/workflow.ts` | **[Decaid HEAD]** PUT rejects `null` for `context.targetYield` and for the `steamSettings` fields (`workflow_handler.dart:160-173`). Undo must not send them. Temperature changes go through the template validator. |
| `src/gateway/devices.ts` | 31 | `describeFailedConnect`: "paired but not responding" (`available:false`), versus "not found", versus "found but would not connect". | ./types | logic | `gateway.test.ts` 3 thorough | PORT AS-IS | `src/api/devices.ts` | Measured on a real DE1. |
| `src/domain/recipe.ts` | 227 | The `Recipe` model, `diffRecipe` (changes plus held fields, per-field epsilon, `FLOAT_SLACK`), `applyDiff`, `formatValue`, `describeApplied`. | ./grind | logic | `recipe.test.ts` 18 thorough | PORT AS-IS | `src/coach/recipe.ts` | The base of CafAI's plain-language diff. Several bug fixes are encoded here (§3.8). |
| `src/domain/grind.ts` | 95 | `snapGrind` (0.05 grid), `formatGrind`, `isSaneGrind` (0 < g ≤ 100, **never clamped** to the user-typed range), `resolveGrind` (target over delta), `parseGrinderRange`, `startingGrind` (midpoint of the range). | — | logic | `parse.test.ts` 5 + `grind-entry.test.ts` 4 thorough | ADAPT | `src/coach/grind.ts` | Make the 0.05 grid a per-grinder step, because 0.05 suits a Lagom and not every grinder. Keep the no-clamp lesson. |
| `src/domain/trail.ts` | 135 | `buildTrail`: one node per shot, labelled with the single change, with a direction and a dialled-in flag (score ≥ 4). `isConverging` needs at least 3 rated shots. | ./recipe | logic | `trail.test.ts` 9 thorough | PORT AS-IS | `src/coach/trail.ts` | Pure, and the base of the attempt log. |
| `src/domain/rating.ts` | 62 | Four closed questions (taste, body, flow, finish) plus a 1–5 score. `describeRating` gives a prompt line. | — | logic | `prompt.test.ts` 3 partial | ADAPT | `src/coach/rating.ts` | Chat quick replies. Map the score to Decaid's `annotations.enjoyment`, whose scale differs between versions. |
| `src/domain/profile.ts` | 251 | The canonical v2 profile and step types (nested `exit {type, condition, value}`, verified on 0.8.4). `readProfileStep`/`readExit` normalise numbers and enums and translate the Tcl flat exit fields. Also `profileTemperature`, `shiftProfileTemperature`, `profilePlan` and `describePlan`. | — | logic | `profile.test.ts` 9 + `profile-plan.test.ts` 7 + `gateway.test.ts` 3 thorough | PORT AS-IS | `src/coach/profile.ts` | Use it for reading and analysis only. Profiles sent in a PUT must keep GET's exact values and types (§9 C18). |
| `src/domain/profile-edit.ts` | 163 | Immutable editor operations: `newProfile`, `duplicateProfile`, `editStep` (switching pump moves the target to the other axis), `add`/`remove`/`moveStep`, `profileProblem`. | ./profile | logic | `profile-edit.test.ts` 11 thorough | ADAPT (defer) | `src/coach/profileEdit.ts` | The model must never change step count, order or pump. Keep `editStep`-style immutable setters for applying template deltas. The human step editor is out of v1 scope. |
| `src/domain/last.ts` | 12 | `last()`: avoids `Array.prototype.at` (Chrome 92+). | — | logic | indirect only | PORT AS-IS | `src/util/last.ts` | Chrome 91 also lacks `.at`. Keep this, or rely on the scaffold's `plugin-legacy` `modernPolyfills` and lint for it. |
| `src/advice/schema.ts` | 125 | The `Advice` type (diagnosis, confidence, actions grind/dose/yield/temp with reasons, profile keep/switch/create, `screenSummary`, ≤3 evidence windows). `ADVICE_SCHEMA_TEXT` and `ADVICE_RULES` are prompt strings. | domain/profile | logic | indirect (parse, prompt) partial | ADAPT | `src/coach/schema.ts` (zod), `src/llm/tools.ts` | Replace the free-text schema with strict tool definitions plus zod. Drop `create`. Keep the evidence windows and per-field reasons. |
| `src/advice/parse.ts` | 332 | Tolerant parsing: brace-depth JSON extraction; number coercion (Unicode minus, units); evidence windows clamped to the shot; `switch`/`create` downgraded to `keep` when unusable; created profiles clamped to DE1 limits (P 0–10, F 0–8, T 80–98, ≤6 steps); never throws. | ./schema, domain/profile | logic | `parse.test.ts` 25 thorough | ADAPT | `src/llm/parse.ts` (fallback extraction), `src/coach/validator.ts` | Keep `extractJsonObject`, `coerceNumber` and `readEvidence` for fallback and evidence. Created-profile handling goes away. Clamping is replaced by explicit validation (§9 C3). |
| `src/advice/proposal.ts` | 93 | Turns advice into the fields Crema is willing to apply. Plausibility bounds: dose 0–60, yield 0–200, temp 60–110; grind via `resolveGrind`; profile title. `adviceToDiff`. | domain/grind, recipe, ./schema | logic | `parse.test.ts` 3 partial | ADAPT | `src/coach/validator.ts` | Becomes CafAI's bounded validator: template-declared fields, absolute bounds and per-turn step limits. |
| `src/advice/prompt.ts` | 226 | `buildPrompt` (bean/age, grinder units, recipe and actual yield, taste, downsampled curves, flow-phase narrative, attempt log, rebuttal, rules, schema) and `buildStarterPrompt` (first shot of a bag). `daysOffRoast`. | domain/grind, recipe, rating, trail, ./attempts, curves, phases, schema | logic | `prompt.test.ts` 24 thorough (string assertions) | ADAPT | `src/coach/prompt/{system,shotContext,starter,reconsider}.ts` | The wording is valuable (§4.3). Restructure into a frozen system prompt plus per-turn context plus tools. |
| `src/advice/provider.ts` | 337 | Five providers (anthropic, openai, google, compatible, server). Pure `buildRequest` and `extractReplyText`. Model list and defaults. Human-readable HTTP error mapping. `askProvider` (one-shot, non-streaming, no tools, no timeout, no retry). | — | logic (I/O) | `provider.test.ts` 28 thorough (non-streaming) | ADAPT | `src/llm/anthropic.ts`, `src/llm/errors.ts`, `src/llm/models.ts`, `src/llm/types.ts` | Reuse the Anthropic headers, endpoint and error mapping. Add SSE, tools, a system prompt, abort/timeout and retries. Only Anthropic is wired into the UI (§4). |
| `src/advice/curves.ts` | 108 | `downsample` (even stride, real samples, ≤60 points), weight-flow trust gate (peak in (0.3, 6) g/s), `buildCurvePayload` (no basket temp), `shotDuration`, `brewRatio`. | domain/last | logic | `curves.test.ts` 13 thorough | PORT AS-IS | `src/coach/summary/curves.ts` | Feeds the summariser. Add time-based resampling on top (§5). |
| `src/advice/phases.ts` | 202 | Flow-phase analysis: sustained pour start (> 0.8, holding > 0.3 for 2 samples), time to first real flow, pour average and peak, stall pressure average and peak, choked flag, `stallVerdict` (≥ 6 bar choking, ≤ 4 bar under-pressured), and the prompt narrative. | — | logic | `phases.test.ts` 16 thorough (synthetic data) | PORT AS-IS | `src/coach/summary/phases.ts` | The densest espresso knowledge in Crema (§5). |
| `src/advice/attempts.ts` | 73 | Builds "ALREADY TRIED on this bean" from the trail: change, score before and after, outcome; last 6. | domain/trail | logic | `trail.test.ts` 4 + `prompt.test.ts` 1 thorough | PORT AS-IS | `src/coach/attempts.ts` | The cheapest large gain in advice quality, per Crema's own note. |
| `src/advice/discover.ts` | 128 | Finds the Mac advisor server again by sweeping the saved IP's /24 with `/health` probes (24 at a time, 1.2 s each, first hit wins). | — | logic (I/O) | `discover.test.ts` 12 thorough | DROP | — | Only for the local-Mac provider. CafAI wires only Anthropic. |

### 2.3 Tests (all on `node:test` + `node:assert/strict`)

Conversion is mechanical: replace `import { test } from 'node:test'` (or `import test from 'node:test'`) with `import { test } from 'vitest'`. `node:assert/strict` works unchanged under Vitest in Node.

| Path | Lines | Covers (count) | Imports | Verdict | CafAI target | Notes |
|---|---|---|---|---|---|---|
| `src/test/curves.test.ts` | 98 | curves.ts (13) | advice/curves | PORT AS-IS | `src/coach/summary/curves.test.ts` | Includes the basket-temp and trust-gate regressions. |
| `src/test/discover.test.ts` | 123 | discover.ts (12) | advice/discover | DROP | — | Module dropped. |
| `src/test/formstate.test.ts` | 91 | formstate.ts (9) | formstate | DROP | — | Module dropped. Keep the "restore only what the user touched" idea as an RTL test. |
| `src/test/gateway.test.ts` | 456 | client (20), workflow (14), devices (3) | gateway/*, domain/recipe | ADAPT | `src/api/{client,workflow,devices}.test.ts` | Split by module. Rewrite the explicit-null undo test (`:155-163`) for **[Decaid HEAD]** null rejection. Optionally move the stubs to MSW. |
| `src/test/grind-entry.test.ts` | 39 | grind.ts (4) | domain/grind | PORT AS-IS | `src/coach/grind.test.ts` | Unset-grind regression. |
| `src/test/live-connections.test.ts` | 28 | live.ts (2) | live | PORT AS-IS | `src/api/ws.test.ts` | Add LiveMonitor reconnect, watchdog and shot-detection tests (there are none today). |
| `src/test/parse.test.ts` | 323 | parse (25), grind (5), proposal (3) | advice/parse, proposal, domain/grind, recipe | ADAPT | `src/llm/parse.test.ts`, `src/coach/validator.test.ts`, `src/coach/grind.test.ts` | Keep extraction, coercion, evidence and grind. Replace the created-profile clamp tests (`:265-323`) with template-bound validator tests. |
| `src/test/phases.test.ts` | 132 | phases.ts (16) | advice/phases | PORT AS-IS | `src/coach/summary/phases.test.ts` | Add tests on recorded Decaid shots. |
| `src/test/profile.test.ts` | 120 | profile.ts (9), client `describeGatewayError` (3) | domain/profile, gateway/client | PORT AS-IS (split) | `src/coach/profile.test.ts`, `src/api/client.test.ts` | Contains the **verbatim live Decaid 0.8.4 step** (`:11-23`) and error body (`:106`): lift both into `mock/fixtures`. |
| `src/test/profile-edit.test.ts` | 105 | profile-edit.ts (11) | domain/profile-edit | ADAPT (defer) | `src/coach/profileEdit.test.ts` | Keep the pump-axis and immutability tests. |
| `src/test/profile-plan.test.ts` | 88 | profile.ts plan (7) | domain/profile | PORT AS-IS | `src/coach/profile.test.ts` | |
| `src/test/prompt.test.ts` | 346 | prompt (24), rating (3), `toCurves` (2), store `hasCurves`/`needsRating` (4) | advice/prompt, domain/*, live, store | ADAPT | `src/coach/prompt/*.test.ts`, `src/coach/shotRecord.test.ts` | String assertions follow CafAI's wording. Keep every regression test (`:183-200`, `:301-346`). |
| `src/test/provider.test.ts` | 277 | provider (28), settings `isReady` (1) | settings, advice/provider | ADAPT | `src/llm/anthropic.test.ts`, `src/llm/errors.test.ts` | Keep the Anthropic header, key-placement and error-mapping tests. Drop the OpenAI, Google, compatible and server tests. Add SSE parsing and tool-use tests. |
| `src/test/recipe.test.ts` | 188 | recipe.ts (18) | domain/recipe | PORT AS-IS | `src/coach/recipe.test.ts` | Epsilon-step and re-diff regressions. |
| `src/test/safearea.test.ts` | 115 | safearea.ts (10) | safearea | PORT AS-IS | `src/ui/platform/safeArea.test.ts` | Measured iPad numbers. |
| `src/test/scrub.test.ts` | 86 | scrub.ts (10) | ui/scrub | DROP | — | Module dropped (uPlot). |
| `src/test/settings-mirror.test.ts` | 58 | store mirror (2) | gateway/client, store | ADAPT | `src/storage/mirror.test.ts` | Namespace `cafai`. Add **wiring** tests: every committed settings change mirrors (§3.5). Keep "never carries the API key". |
| `src/test/trail.test.ts` | 115 | trail (9), attempts (4) | domain/trail, advice/attempts, domain/recipe | PORT AS-IS | `src/coach/trail.test.ts`, `src/coach/attempts.test.ts` | |
| `src/test/views.test.ts` | 1062 | views (88), compat (2) | ui/views, domain/*, compat | DROP (extract) | `src/coach/diffText.test.ts` | Port the 6 `leadChange` tests (`:843-874`). Rewrite the behavioural rules as RTL tests for CafAI's own UI: nothing commandable without a machine, Stop-only while running, exactly one way out, model text escaped, and so on. |

### 2.4 Repo-level files outside `web/` (release context only)

| Path | What it does | Verdict for CafAI |
|---|---|---|
| `.github/workflows/release.yml` (52 lines) | On a `v*` tag or manual dispatch: Node 22, `npm ci`, `npm test`, `npm run release:zip` in `web/`; `./build.sh` for the Tcl skin; release notes from the tag annotation; `softprops/action-gh-release@v2` uploads `web/Crema-Decaid.zip` and `dist/Crema.zip`. | ADAPT. The scaffold's `release.yml` already does this with `gh release create`, plus a tag-equals-version check. |
| `build.sh`, `dev.sh`, `DEPLOY.md`, `tools/tclcheck.tcl` | Tcl skin bundle, desktop simulator, Mac-server docs. | DROP. |
| `LICENSE` | Verbatim GPL-3.0 text. | Reuse the text as CafAI's `LICENSE` (§1). |
| `VERSION` | `1.1.2`, which has drifted from the skin version. | DROP. One version source: `package.json`. |
| `README.md` | Two-editions README; licence and credits at `:324-328`. | Credit in `CREDITS.md`. |

---

## 3. Hard-won fixes (keep these)

### 3.1 The four required profile fields

`gateway/client.ts:211-231` (`createProfile`):

```ts
    // Decaid rejects a profile that omits any of these, one field per attempt
    // ("Invalid argument(s): Profile must have \"tank_temperature\""), and a
    // profile Crema authored carries none of them: both the AI's profiles and
    // the step editor's failed to save with a bare "Invalid request". They are
    // filled here, at the wire, so no author of a profile can miss one.
    //
    // Zero is off in each case: no volumetric stop, no volume count start, and
    // no tank target — which is what Decent's own shipped profiles use.
    const complete: ProfileWire = { ...profile };
    complete.version ??= '2';
    complete.target_volume ??= 0;
    complete.target_volume_count_start ??= 0;
    complete.tank_temperature ??= 0;
```

- **Shape:** the POST body is `{ profile: complete }`. **[Decaid HEAD]** confirms this and also accepts an optional `parentId` (`profile_handler.dart:117-123`). CafAI can use `parentId` to link a "<Bean> v<n>" profile to its template.
- **Tests:**
  - `gateway.test.ts:413-437`: the fields are filled.
  - `gateway.test.ts:439-456`: a duplicate keeps its own values.
  - `gateway.test.ts:287-309`: the exact payload. Commit `cb46c63` notes "The existing test had pinned the broken payload and passed throughout".
- `profile-edit.ts:60-63` sets `version:'2'` on a new profile.
- **[Decaid HEAD]** `Profile._parse` (`lib/src/models/data/profile.dart:59-71`) now enforces a non-empty `title`, a non-empty `steps`, `tank_temperature` and `target_volume_count_start`. `version` and `target_volume` are optional there. Send all four anyway, as CafAI's rule says.
- **Related [Decaid HEAD] finding:** `deepMergeJson` (`lib/src/models/data/json_utils.dart`) merges maps recursively and **replaces lists**. Two consequences:
  - Profile-level keys you omit on `PUT /api/v1/workflow` **silently keep the previous profile's values**. This is the real reason activation must send the complete profile.
  - `steps` is replaced wholesale.

### 3.2 Safe-area handling

`safearea.ts:80-93`:

```ts
export function resolveBottomInset(facts: ViewportFacts): number {
  // A browser that reports an inset is telling the truth; never second-guess it.
  if (facts.envBottomPx > 0) return facts.envBottomPx;

  // No touch, no home indicator. Desktop keeps its pixels.
  if (facts.maxTouchPoints <= 0) return 0;

  if (!isFullBleed(facts)) return 0;

  const shortEdge = Math.min(facts.screenWidth, facts.screenHeight);
  if (shortEdge > PHONE_MAX_SHORT_EDGE_PX) return INDICATOR_TABLET;

  return facts.innerHeight > facts.innerWidth ? INDICATOR_PHONE_PORTRAIT : INDICATOR_PHONE_LANDSCAPE;
}
```

- **Why:** `safearea.ts:5-11` explains it. "measured on an iPad Air (4th gen) running Decaid 0.8.6, the page gets the entire 1180x820 screen and every inset reports 0".
- **Wiring:**
  - `applySafeArea` (`:112-125`) publishes `--safe-bottom`.
  - `watchSafeArea` (`:128-132`) re-runs it on resize, and on `orientationchange` after a 120 ms delay.
  - `main.ts:2664-2669` calls it **before the first render**.
- **CSS:**
  - `styles.css:43-58` defines `--safe-top/right/bottom/left` (defaulting to `env()`) and `--dock-height`.
  - `:385-406` pads `.app` with them.
  - `:821-848` makes `.nav-dock` own the bottom inset ("Padding rather than `bottom:` so the dock's background still runs to the physical edge").
  - `index.html:5` sets `viewport-fit=cover`.
- **Tests:** `safearea.test.ts` (10), using measured Safari and Decaid viewport facts.
- **Dev:** `dev/ipad.html` injects `--safe-bottom` into the framed document. `dev/vite.probe.config.ts` reads the variables on a real device.

### 3.3 Avoiding a full re-render on every WebSocket tick

Crema re-renders by replacing the whole `innerHTML` (`main.ts:815-872`). It fixed the worst per-tick renders, and only part of the problem.

**Fixed:**

- `main.ts:949-962` (`onSnapshot`):

  ```ts
    // Group temperature is tracked but not drawn anywhere, and on a live
    // machine it changes several times a second. Re-rendering for it rebuilt
    // the whole brew screen at that rate, which replaced every button on it
    // between a finger going down and coming up — taps were landing in the
    // gaps. Only the machine state is on screen, so only it renders.
    const shown = next !== state.machineState;
    ...
    if (shown && state.tab === 'brew') render();
  ```

- `main.ts:937-947` (`onDevices`) builds a before/after signature string and renders only when it changed: "A BLE connect emits a burst of these … Re-rendering on every one threw the brew grid away".
- In-place DOM patches with no render:
  - scale weight: `main.ts:976-980` (`[data-live-scale]`)
  - water level: `:989-993` (`[data-live-water]`)
  - the asking clock: `:1096-1112` (`[data-asking-elapsed]`)
  - settings chrome: `:1928-1959` (`refreshSetupChrome`)
- `formstate.ts` restores typed values and scroll position across renders (§3.7).

**Not fixed:** `main.ts:1008-1011`:

```ts
  onShotSample(shot) {
    state.live = shot;
    if (state.tab === 'brew') render();
  },
```

During a shot the whole tree is rebuilt on every machine snapshot.

**CafAI:**

- Keep live telemetry in an external store read through selector subscriptions (`useSyncExternalStore`).
- Push chart points straight into uPlot (`setData` in a `requestAnimationFrame` or throttled at about 4–5 Hz).
- Never put telemetry ticks in React state that drives layout.
- Add a test that counts renders per frame.

### 3.4 WebSocket reconnect and open-but-silent sockets

**Reconnect.** `live.ts:20` sets `RETRY_MS = [500, 1000, 2000, 5000, 10_000]`. `:133-151`:

```ts
    socket.onopen = () => {
      nextRetry = 0;
    };
    ...
    socket.onclose = () => {
      this.sockets = this.sockets.filter((candidate) => candidate !== socket);
      this.scheduleReconnect(path, onMessage, nextRetry + 1);
    };
    // An error is always followed by a close, so retry is handled there.
    socket.onerror = () => {};
```

**Socket state is not hardware state.** `live.ts:114-118`: "the machine and scale sockets remain open while their device is disconnected, so socket state must never be presented as hardware state". `deviceConnections` (`:43-52`) derives connection only from `/ws/v1/devices`.

**Boot seeding.** `main.ts:2683-2692`: "the websocket may not emit a fresh state snapshot after a page reload. Seed the controls from REST" (`GET /api/v1/machine/state`).

**Gaps CafAI must close:**

- **No open-but-silent watchdog.** No timer notices a socket that stays open but stops sending frames, so the power-cycle case in RESEARCH §2 is unhandled.
- No `visibilitychange` handling.
- `LiveMonitor.stop()` is never called.
- `ingest()` calls `onMachineConnectionChange(true)` on **every** snapshot (`live.ts:205`). A late snapshot can therefore override a "disconnected" from the devices socket.
- None of this is tested.

**Recommendation:** use a per-socket slot with:

- a silence timeout. While the device is reported connected and no frame arrives within N seconds, close and reopen the socket.
- jittered backoff.
- a reconnect on `visibilitychange`.
- connection state taken only from `/ws/v1/devices`.

### 3.5 Settings mirror to Decaid's store (fix incomplete)

- **Endpoint:** `GET`/`POST /api/v1/store/crema/settings-mirror` (`store.ts:19-21,94-96,155-161`). **[Decaid HEAD]** `doc/Skins.md:1335-1371` documents `GET`/`POST`/`DELETE /api/v1/store/{namespace}/{key}` (404 when missing) and `GET /api/v1/store/{namespace}` (lists keys).
- **Keys mirrored:** `provider`, `model`, `baseUrl`, `grinderName`, `grinderRange`, `theme` (the `SettingsMirror` interface at `store.ts:78-85`).
- **The API key is excluded** by an explicit projection at `main.ts:1890-1893`:

  ```ts
  function mirrorSettings(): Promise<boolean> {
    const { provider, model, baseUrl, grinderName, grinderRange, theme } = state.settings;
    return store.saveSettingsMirror({ provider, model, baseUrl, grinderName, grinderRange, theme });
  }
  ```

  It is pinned by `settings-mirror.test.ts:44-58` ("the mirror never carries the API key, whatever is in settings").
- **Hydration** (`main.ts:1895-1923`) "Only ever fills blanks". The mirror's provider is adopted only when the local one is the default `anthropic`. The mirror's theme is adopted only when local is `dark` and the mirror says `light`.
- **Bug I found while auditing (static reading; not reproduced in a browser):**
  - `mirrorSettings()` is called **only** from `saveSetup` (`main.ts:1875`), and `saveSetup` runs **only** on the settings form's `submit` event (`:2536`).
  - The form has no submit button and several text and password inputs (`views.ts:1407-1442`). By the HTML implicit-submission rules, pressing Enter does nothing, so `submit` never fires.
  - Every real save path writes `localStorage` but never the mirror: autosave on `change` (`autosaveSetup`, `:1961-1974`), the theme chips (`:2192-2198`), the model picker (`:2576-2586`), and server rediscovery (`:1090-1091`).
  - So the v1.1.1 "settings survive a reinstall" fix is effectively unreachable. The test checks the Store round trip, not the wiring.
- **CafAI:**
  - Mirror from the repository layer on every committed change (debounced, retried).
  - Test end to end: a UI change leads to a KV POST.
  - Keep the key-exclusion test.

### 3.6 Chromium/WebView compatibility shims

- **Build target:** `vite.config.ts:7-11` sets `chrome78`, so esbuild lowers optional chaining and `??` ("the difference between a working page and a blank one", commit `601af56`).
- **`Array.prototype.at`:** `domain/last.ts:1-12` replaces it: "`Array.prototype.at(-1)` … landed in Chrome 92".
- **Flex `gap`:** `compat.ts:19-53` measures it rather than feature-querying, because "`@supports (gap: 1px)` answers true on Chrome 78 and tells you nothing". `styles.css:338-370` holds the margin fallbacks.
- **Regressions shipped:**
  - `ui/views.ts:558`, `:584` and `:706` call `.at(-1)`.
  - I built the bundle and confirmed it contains **3 `.at(-1)` calls**.
  - On Chrome 78 **and on CafAI's Chrome 91** each call throws a `TypeError` in one of three situations:
    - a chart draws a previous-shot comparison (`:558`);
    - a chart finds a profile stage change in the goal curves (`:584`), which happens on almost every real multi-step shot;
    - the detailed overlay opens with scale weight (`:706`).
  - The Node tests pass because Node has `.at`.
  - `styles.css:836` uses `max()`, which the comment at `:391-392` says it avoids (Chrome 79+).
- **CafAI:**
  - Target `chrome91`. Drop `compat.ts`, since flex gap works from Chrome 84.
  - Keep `last()` or rely on the scaffold's `@vitejs/plugin-legacy` `modernPolyfills` (core-js covers `.at`).
  - Keep the scaffold's ESLint ban list for unpolyfillable APIs.
  - Keep the real-Chromium-91 smoke test (`tools/chrome91`). Unit tests in Node or jsdom cannot catch these.

### 3.7 Form state preservation

- **Rule** (`formstate.ts:66-70`): restore only what the user changed.

  ```ts
  export function isDirty(control: ControlLike): boolean {
    if (!control.name) return false;
    if (isToggle(control.type)) return control.checked !== control.defaultChecked;
    return control.value !== control.defaultValue;
  }
  ```

- **Mechanics:**
  - Forms are keyed by `data-action` plus `data-id`, which survive a re-render (`:79-82`).
  - Scroll containers are keyed by selector plus index (`:136-157`).
  - Focus and caret are restored only when `document.hasFocus()` (`:239-250`), so "returning from the background should not summon the keyboard".
  - Wiring is in `main.ts:815-823,870-871`. `formSubmitted()` (`:808-813`) skips forms that were just submitted successfully.
  - The rebuttal textareas are mirrored into state (`:2623-2634`), and the filter caret is restored (`:2636-2645`).
- **The bug it fixed** (`formstate.ts:4-10`): "Backgrounding the app and returning to it cleared a half-filled bag, and the same bug ate text in Settings".
- **CafAI:** use controlled inputs and keep drafts in a store. The chat composer draft should also survive the 10-minute background unload, so persist it to IndexedDB.

### 3.8 Other bug fixes encoded in code or tests

| Fix | Code | Test |
|---|---|---|
| A step of exactly one epsilon was swallowed by float error ("trapped the grind between 0.75 and 0.80"). Fixed with `FLOAT_SLACK = 1e-9`. | `domain/recipe.ts:92-111` | `recipe.test.ts:77-109` |
| Never clamp the grind to the user-typed range: the Tcl skin "dragged the advisor's correct 0.15 up to 0.4". | `domain/grind.ts:25-38` | `parse.test.ts:203-208` |
| An unset grind made both steppers dead. Now it seeds from the middle of the range, or the value can be typed. | `domain/grind.ts:81-95`, `main.ts:1513-1521` | `grind-entry.test.ts`, `views.test.ts:684-700` |
| Undo sends `null` for fields that had no value, so the applied value does not survive. **[Decaid HEAD]** now rejects null `targetYield`. | `gateway/workflow.ts:96-100` | `gateway.test.ts:155-163` |
| Advice must be re-diffed against the recipe it was **given for**, not the live one; otherwise reopening it showed an empty card. | `main.ts:204-212`, `:2454-2466` | `recipe.test.ts:165-188` |
| The starting-point banner listed only `changes`, not the held fields. | `domain/recipe.ts:186-227` | `recipe.test.ts:119-137` |
| Old records with no `curves` key crashed the brew screen (`undefined !== null`). | `store.ts:214-233` | `prompt.test.ts:183-200` |
| Reopening an unrated shot at boot is limited to 30 minutes and respects "rate later". | `store.ts:235-247` | `prompt.test.ts:202-217` |
| The starter prompt quoted the grind left on the dial, which anchored the model to it. | `advice/prompt.ts:203-209` | `prompt.test.ts:301-310` |
| Reasons must justify the number; uncertainty belongs in `confidence`. | `advice/prompt.ts:220` | `prompt.test.ts:340-346` |
| Basket temperature runs about 20 °C cool and misleads temperature advice, so it is never sent. | `advice/curves.ts:70-77` | `curves.test.ts:63-67` |
| A missing or asleep scale yields a garbage weight curve, so the curve is trust-gated. | `advice/curves.ts:33-53` | `curves.test.ts:38-53` |
| A lone first-drops spike is not the start of the pour (hold check). | `advice/phases.ts:82-104` | `phases.test.ts:93-103` |
| Evidence windows outside the shot are dropped or clamped, with at most 3 windows of up to 40 characters each. | `advice/parse.ts:144-186` | `parse.test.ts:113-145` |
| "Stating the limits in the prompt is not enforcing them": authored profiles are clamped to DE1 limits. | `advice/parse.ts:192-218` | `parse.test.ts:288-323` |
| Profile shape: a nested `exit` object, not the Tcl flat fields (verified on Decaid 0.8.4). Flat fields from models are still translated. | `domain/profile.ts:1-15,83-115` | `profile.test.ts:7-74` |
| A step carries only its driven axis; switching pump moves the target ("nine bar and nine mL/s are not the same shot"). | `domain/profile.ts:151-154`, `profile-edit.ts:93-126` | `profile.test.ts:41-49`, `profile-edit.test.ts:23-41` |
| Decaid error bodies are JSON (`{"error":"DeviceNotConnectedException: …"}`); unwrap them and drop the class name. | `gateway/client.ts:86-115` | `profile.test.ts:104-120` |
| Every gateway call has a deadline (8 s, 25 s for a full BLE scan): "A gateway that has lost its machine can accept a connection and then never answer". | `gateway/client.ts:9-11,142-172,297-317` | `gateway.test.ts:358-385` |
| `scan?connect=true` "churned Bluetooth for the machine as well, and a DE1 that is mid-handshake drops". Now quick scan, then full scan, then connect one device by id. | `gateway/client.ts:284-317` | `gateway.test.ts:247-285` |
| `available:false` means paired but off, not missing. | `gateway/devices.ts:10-31` | `gateway.test.ts:389-411` |
| Cache whether the machine has a GHC, so the brew layout does not flicker; never clear it on disconnect. | `settings.ts:98-125`, `main.ts:134-140,1325-1347` | — |
| Apply order: create or switch the profile **first**, then recompute and write grind, dose, yield and temperature against the new profile so they win. | `main.ts:1400-1444` | — |
| AI profiles always saved under their own title (`AI · <bean>`). | `main.ts:1416-1424` | — |
| Duplicate titles get `(copy n)` (Crema assumed the title is in the content hash; see §9 C21). | `main.ts:2212-2225`, `profile-edit.ts:71-85` | `profile-edit.test.ts:76-93` |
| A profile switch matches titles case-insensitively and fails loudly when the profile is not installed. | `main.ts:1428-1436` | — |
| No Mac-server default URL: localhost is wrong on every device but the Mac. | `provider.ts:90-94`, `settings.ts:88-96` | `provider.test.ts:271-277`, `views.test.ts:378-399` |
| Model picker offers exact published ids ("four plausible spellings, one of which works"). | `provider.ts:44-64` | `provider.test.ts:251-269` |
| One way out of the skin: `exitToDashboard()` inside Decaid; otherwise `…/api/v1/plugins/settings.reaplugin/ui?backName=Crema`. | `views.ts:61-91`, `main.ts:844-848,2318-2323` | `views.test.ts:403-492` |
| Model text is HTML-escaped, so it cannot inject markup. | `views.ts:20-23` | `views.test.ts:94-98` |
| Sample data is never drawn under the user's own bean name. | `main.ts:404-411` | `views.test.ts:619-635` |
| Water-setting steppers are whitelisted per field and stop at zero. | `main.ts:2018-2092` | `views.test.ts:580-600` |
| The shot chime's AudioContext is unlocked on the first `pointerdown` and audio failures are swallowed. | `main.ts:85-115,2674` | — |
| A grind correction recorded on the rating screen (the grind actually used). | `main.ts:1230-1235`, `views.ts:1488-1493` | — |
| Stage labels are spaced in pixels; the evidence label sits on its own row. | `views.ts:587-612` | `views.test.ts:963-992` |

---

## 4. LLM layer

### 4.1 How `provider.ts` calls Anthropic

- **Endpoint:** `POST {baseUrl}/v1/messages`. The base defaults to `https://api.anthropic.com` (`:81-98,109-119`) and the user can override it.
- **Headers** (`:152-158`): `content-type: application/json`, `x-api-key: <key>`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` ("Without this, the browser request is rejected before it is even sent"). There is no `anthropic-beta` header.
- **Body** (`:160-164`): `{ model, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }`. There is **no `system` prompt, no tools, no `tool_choice`, no `stream`, no `thinking`/`output_config`, and no temperature**. Everything goes in one user message.
- **Models** (`KNOWN_MODELS`, `:53-64`): `claude-opus-5` ("Best reasoning"), `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5`. The **default is `claude-haiku-4-5`** (`:76-77`). The Settings picker offers "Default", the known ids, or "Other…" for free text.
- **Streaming:** none. A request blocks for 15–60 s, and the UI ticks a clock in place (`main.ts:1096-1118`).
- **Reply extraction** (`:188-207`): concatenates `content[].type === 'text'` blocks and ignores thinking blocks. **It never checks `stop_reason`.** A `max_tokens` truncation shows up as a JSON parse error; a `refusal` is not detected.
- **JSON parsing and validation:** the prompt asks for "ONLY a valid JSON object"; then `parseAdvice` (`parse.ts:280-332`) extracts the first balanced object, coerces fields by hand, and downgrades invalid actions. There is **no schema library** and no re-ask on failure. The raw error is shown.
- **Retries:** none.
- **Timeouts:** none. `AskOptions.signal` exists (`:291-294`) but `main.ts` never passes one, so a hung request leaves the "Reading your shot…" strip counting forever.
- **Errors:**
  - `ProviderError(status)` with mapped messages (`describeHttpError`, `:257-289`): 400 bad model, 401/403 key, 404 endpoint/model, 429 rate limit, 5xx "trouble at its end".
  - Self-hosted 5xx bodies are surfaced through `extractErrorDetail` (`:234-255`), which reads `{detail}`, `{error}` or `{error:{message}}`.
  - A network failure says "allows requests from this page", because in a browser a CORS block looks like a network error.
  - `AbortError` propagates.
- **Key handling:** the key is read from `localStorage` and sent only in `x-api-key`. Tests pin that it never appears in the body or URL (`provider.test.ts:212-219`). It is never logged: there are no `console.*` calls anywhere in `web/src`.
- **"Test request"** (`main.ts:1976-1992`) sends `'Reply with exactly OK. This is a connection test; do not add anything else.'`.

### 4.2 The other providers, and fit with `LlmProvider`

- **openai, google, compatible and server** all use OpenAI-style `chat/completions`:
  - Bearer auth, omitted when there is no key (`:167-174`).
  - Google's base already includes `/v1beta/openai`, so its endpoint is `{base}/chat/completions`.
  - Reasoning models (`/^(o[0-9]|gpt-5)/`) get `max_completion_tokens: 25000` and `reasoning_effort: 'low'` instead of `max_tokens` (`:130-139`).
  - The `server` provider (a FastAPI app on the user's Mac that routes to `claude -p`) needs `/health → {ok:true}` and `/v1/chat/completions` from `server/advisor/main.py`. If the server fails, `discover.ts` sweeps the LAN for it (`main.ts:1080-1094`).
- **Fit:** the per-provider request and response code is already pure (`buildRequest`, `extractReplyText`, `describeHttpError`), so it **wraps cleanly** behind an interface. But Crema's abstraction is "prompt string in, text out", single turn, with no streaming or tools. CafAI's `LlmProvider` needs `stream({ system, messages, tools, images }, signal) → AsyncIterable<LlmEvent>`, so `askProvider` cannot be reused as-is. A minimal shape:

  ```ts
  interface LlmProvider { id: 'anthropic'; stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmEvent> }
  type LlmEvent =
    | { type: 'text'; delta: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }   // emitted on content_block_stop, unvalidated
    | { type: 'done'; stopReason: string; usage?: unknown }
    | { type: 'error'; error: LlmError };
  ```

  - Normalise Anthropic `tool_use` and `input_json_delta`, and later OpenAI `tool_calls` deltas, into these events.
  - Wire **only Anthropic** into the UI, as CafAI's rule says.
  - Do not port Crema's OpenAI, Google, compatible and server code yet. It is untested against streaming and tools, and it adds surface area.
- **SDK or fetch:** the scaffold's ESLint config already forbids `@anthropic-ai/sdk` ("pulls Node modules into the browser bundle") and points at `src/llm/anthropic.ts`. That matches Crema's thin-`fetch` approach.
  - Extend `buildRequest` into a streaming client.
  - Read the body with `response.body.getReader()` plus `TextDecoder`. `for await` over a `ReadableStream` does not work in Chromium 91, which the scaffold lints for.
- **Deltas CafAI must add.** These are current API facts from the bundled `claude-api` reference (cached 2026-06-24); verify them at build time.
  1. **Streaming SSE events:**
     - `message_start`
     - `content_block_start`
     - `content_block_delta`, with `delta.type` of `text_delta` or `input_json_delta` (plus thinking deltas)
     - `content_block_stop`
     - `message_delta` (`stop_reason`, `usage`)
     - `message_stop`

     Ignore unknown events and surface `error` events.
  2. **Tools with `tool_choice: {type: "auto"}` only.** Claude Opus 5.5 (`claude-opus-5-5`) and Claude Fable 5.1 return **400** for `any` or `tool`. With `auto`, check whether a tool call was actually made and re-prompt if not.
  3. **Schema-valid arguments** come from `strict: true` on the tool definition, with `additionalProperties: false` and `required`. JSON outputs use `output_config.format`.
  4. **Strict schemas cannot express `minimum`, `maximum`, `minLength` or `maxLength`.** Bounds must be enforced client-side, which is exactly CafAI's `src/coach/validator.ts`. Validate every tool input with zod even with `strict`, and treat a failure as an `is_error` `tool_result`.
  5. **Handle `stop_reason`** values `max_tokens`, `refusal` and `tool_use` before reading content.
  6. **Opus 5.5 specifics:**
     - Thinking cannot be disabled; effort defaults to `medium`.
     - **Preserved thinking:** keep the chat history append-only. Freeze `system` and `tools` for a conversation, and replay assistant content blocks unchanged.
     - Assistant prefill returns 400. Crema never uses prefill.
  7. **Models:**
     - The reference lists `claude-opus-5-5` ($4/$20, marked "launching"), `claude-opus-5`, `claude-sonnet-5` ($2/$10), `claude-haiku-4-5` and `claude-fable-5-1`.
     - `RESEARCH.md:246` mentions "Sonnet 5.5 at $2/$10", which the reference does not list. **Verify.**
     - Crema's ids are valid but stale (no Opus 5.5) and hard-coded. Keep the list in config.
  8. **Prompt caching:** put the frozen rules, the templates and the tool definitions first (`tools`, then `system`), and per-shot data last. Crema rebuilds a single monolithic prompt every time.

### 4.3 The advisor prompt (`prompt.ts`)

**`buildPrompt` (`:151-192`), in order.** Its own comment explains the ordering: "rules and schema go last … what the model is most likely to still be following".

1. Role: "You are an expert espresso barista helping dial in a Decent DE1." plus "You are given one shot: what was set, what the machine actually did, and how it tasted."
2. **Bean line** (`:72-79`): roaster and name, roast level, "N days off roast". Roast date comes from the batch, and anything 10 years old or more, or in the future, is dropped.
3. **Grinder line** (`:81-87`): "Express any grind change in ITS dial units." The range is used "to size your move", never to clamp.
4. **Recipe line** (`:113-126`): profile; dose; target versus **actual** yield; ratio computed from the actual yield; brew temperature (the hottest step); grind; shot duration.
5. **Tasted:** `taste=…, body=…, flow=…, finish=…, score=n/5`, or "not rated".
6. **Curves:** JSON, downsampled to at most 60 points. Keys: `elapsed_s`, `pressure_bar`, `flow_mls`, plus `weight_out_gs` (when trusted) and `pressure_target_bar`/`flow_target_mls` (when captured).
7. **Flow-phase narrative** (`phases.ts:168-192`): numbers plus the stall-pressure rule.
8. **Attempt log** (`attempts.ts:62-73`): "ALREADY TRIED on this bean … Do not repeat a change that made it worse".
9. **Reconsider block** (`:135-148`): names both failure modes, "never just repeat the same words, and never cave reflexively".
10. `## RULES` (`schema.ts:115-125`):
    - change ONE thing;
    - be proactive about the profile shape;
    - DE1 limits for authored profiles;
    - **"IF THE SHOT IS ALREADY GOOD — rated 4-5/5 … LOCK IT IN, not tinker"**;
    - leave untouched fields null;
    - at most 3 evidence windows;
    - JSON only, with no double quotes inside strings.
11. `## SCHEMA` (`schema.ts:89-108`).

**`buildStarterPrompt` (`:195-226`)** is for a new bag with no shot yet:

- Says "There is NO shot data".
- Gives the bean, and grinder guidance (look it up; the typed range "is their own estimate").
- Gives the current dose, yield and temperature but **not** the leftover grind.
- Lists the installed profile titles; `switch_to` must match one exactly.
- Roast heuristics.
- Asks for "an absolute setting on this grinder's own scale". It notes that "Espresso usually sits in the finer part of a grinder's overall travel" and asks for "a forgiving, slightly-fine setting rather than a gushing one".
- Evidence must be `[]`; reasons justify numbers; then the schema.

**Reusable for CafAI's coach prompt (system prompt plus per-turn context):**

- the role and framing
- the bean, grinder and recipe lines
- the ratio from actual yield
- the rating line
- the whole phase narrative (§5)
- the attempt log
- the reconsider wording (anti-sycophancy and anti-stubbornness)
- one change at a time
- lock in a good shot
- evidence windows
- all of the starter guidance (ignore the leftover grind, use an absolute setting, err slightly fine, reasons versus confidence)

**Not reusable, or must be fixed:**

1. **The free-text `## SCHEMA` and "Respond with ONLY a valid JSON object".** Replace with strict tool definitions such as `propose_adjustment`, plus zod.
2. **`created_profile`, and the DE1-limit sentence for authored profiles.** Replace with the template's declared adjustable fields and bounds, injected from the template.
3. **"you have web search, so do not guess"** (`:103`) is false for direct API calls, which attach no tools; only the Mac server's `claude -p` has web search. Either attach the server web-search tool deliberately (a cost and latency decision) or remove the claim.
4. **Time-axis mislabel:**
   - Curves and evidence say "seconds from first drop" (`prompt.ts:171`, `schema.ts:23,93`).
   - But `elapsedS` counts from when the machine entered `espresso` (`live.ts:211-217`). That includes preinfusion.
   - The phase line then reports "time-to-first-real-flow was ~8s" on the same axis, so the prompt contradicts itself.
   - CafAI should label t = 0 as pump start and report first drop separately.
5. Switching by profile **title** becomes switching by template id.

---

## 5. Shot data handling (feeds CafAI's summariser)

**Where the data comes from.** Crema never reads Decaid's shot records: `Gateway.readShots` (`client.ts:348`) is dead code. It builds its own curves from WebSocket frames (`live.ts:204-236`):

- `elapsedS`: the **client clock** (`Date.now()`) since `state.state` became `'espresso'`.
- From the machine snapshot: `pressure`, `flow`, `targetPressure`, `targetFlow`, and `groupTemperature ?? mixTemperature`.
- From the scale: `weight` and `weightFlow`, taking the **latest scale frame**, which is not time-aligned.

It ignores:

- `state.substate` (the preinfusion and pour markers)
- `timestamp`
- `targetGroupTemperature`/`targetMixTemperature`
- the `shotState` channel

A shot needs at least 4 samples. `toCurves` (`:240-266`) keeps each optional series only if every sample has it. Records store **full-resolution** curves; only the prompt payload is downsampled.

| Metric | Function (file:line) | Computed from | Tests |
|---|---|---|---|
| Shot duration (s, 1 dp) | `shotDuration` `curves.ts:99-102` | last `elapsedS` | `curves.test.ts:84-87` |
| Brew ratio "1:x.x" | `brewRatio` `curves.ts:105-108` | dose and **actual** yield (the prompt prefers `finalYieldG`, the last scale `weight`) | `curves.test.ts:89-98` |
| Downsampled curves (≤60 points, real samples) | `downsample` `curves.ts:22-31` | any series | `curves.test.ts:15-34` |
| Is the weight-flow curve trustworthy | `isWeightCurveTrustworthy` `curves.ts:45-53` | finite `weightFlow`, peak in (0.3, 6) g/s | `curves.test.ts:38-53` |
| Prompt curve payload | `buildCurvePayload` `curves.ts:78-96` | elapsed, pressure, flow, trusted weight flow, goals; **no basket temp** | `curves.test.ts:63-80` |
| Time to first real flow ("preinfusionS") | `analyseFlowPhases` + `findPourStart` `phases.ts:89-160` | **weight flow** when its peak > 0.3, else machine flow. Start = output > 0.8 with the next 2 samples > 0.3. | `phases.test.ts:24-48,93-108` |
| Pour duration, average, peak (g/s or mL/s) | same | output from the pour start to the end | same |
| Stall pressure average and peak (bar) | `stats()` `phases.ts:65-80` | `pressureBar` over [0, pour start) | `phases.test.ts:52-64` |
| Choked flag | `phases.ts:132-144` | no sustained pour | `phases.test.ts:58-64,105-108` |
| Stall verdict | `stallVerdict` `phases.ts:198-202` | ≥6 bar means choking (coarsen); ≤4 bar means under-pressured (fix the profile, keep the grind); in between, no claim | `phases.test.ts:66-77` |
| Profile stage boundaries | inside `renderShot` `views.ts:567-586` (UI only) | `pressureGoal`/`flowGoal`: a change of control mode, or a jump > 0.4 bar or > 0.7 mL/s, at least 0.5 s apart | label spacing only (`views.test.ts:963-992`) |
| Peak pressure, peak flow, final weight, first flow | `renderGraphOverlay` `views.ts:705-721` (UI only, **not sent to the model**) | max of the series, last weight | `views.test.ts:774-790` |
| Attempts (change, score before and after, outcome) | `extractAttempts` `attempts.ts:30-50` | trail nodes | `trail.test.ts:87-115` |
| Convergence and dialled-in state | `buildTrail`, `isConverging` `trail.ts:96-135` | per-bag shots, rating score (≥4 = dialled in) | `trail.test.ts:26-83` |

`advice/discover.ts` is **not** shot analysis. It sweeps the LAN for the Mac server (§2.2) and is dropped.

**Test quality.**

- **Thorough** for the pure functions: 13 curve tests, 16 phase tests, 13 trail and attempt tests.
- But every test uses **synthetic** arrays.
- Nothing tests capture: the LiveMonitor, the time base, or scale alignment.
- No recorded real shot is used as a fixture.

**What CafAI's summariser needs that Crema lacks** (`RESEARCH.md:306-309`):

- **Time base:** use Decaid's shot record (`/api/v1/shots/{id}` measurements at about 4 Hz, including `targetPressure`/`targetFlow` and `substate`) as the source for analysis. Keep the WebSocket only for the live display.
- **First drop:** time to first drop from cumulative cup weight (separate from "first real flow"). Preinfusion end from `substate`.
- **Pressure and flow summary:** peak pressure (currently UI only), mean flow, temperature deviation from target (targets not captured), and target compliance per controlled phase (goals are captured but unused).
- **Channel health:** resistance (P/F²) trend, and channeling flags: a pressure dip after the peak, unstable flow, pump flow diverging from scale flow, early first drops. RESEARCH points to decaid-mcp and decentespresso-mcp definitions.
- **Dose and yield:** take them from `annotations.actualDoseWeight` and `actualYield` when present.
- **Resampling:** resample to 0.5–1 s by time. Crema uses a fixed 60-point stride, so its resolution varies with shot length.

**Plan.** Port `curves.ts` and `phases.ts` unchanged as the first layer. Add `summary/stages.ts`, lifted from the `views.ts` stage detection, and new modules (`summary/compliance.ts`, `summary/channeling.ts`, `summary/resample.ts`) with fixtures recorded from MockDe1 and real shots.

---

## 6. Release zip and dev harness

### 6.1 How the zip is built

- **Command:** `npm run release:zip`, defined as `npm run build && npm run validate:manifest && rm -f Crema-Decaid.zip && (cd dist && zip -qr ../Crema-Decaid.zip . -x '*.DS_Store')` (`package.json:14`). It needs POSIX `rm` and `zip`, so it does not run on Windows.
- **Contents:** the contents of `dist/` at the zip **root**: `index.html`, `manifest.json` (copied from `public/`), `assets/index-<hash>.js` and `assets/index-<hash>.css`.
- **My build of the audited commit:**
  - `index.html`: 0.74 kB
  - CSS: 48.25 kB (9.78 kB gzipped)
  - JS: 149.61 kB (46.14 kB gzipped)
  - 31 modules; no fonts, images or service worker
- **`index.html` in `dist`:** the relative module script `./assets/…` (from `base:'./'`) plus the untouched absolute `<script src="/__decent/skin-api.js">`. Vite warns that it "can't be bundled without type=module", which is expected.
- **Why root layout:** `README.md:55-56` says "Decaid needs the built `Crema-Decaid.zip`, which has `index.html` and `manifest.json` at its root". **[Decaid HEAD]**:
  - `_installFromZip` also unwraps a single top-level folder (`webui_storage.dart:1083-1089`).
  - It reads `skin-manifest.json` **before** `manifest.json` (`:998-1013`, `:1107-1119`).
  - It uses `id`, `name`, `description` and `version`.
  - It rejects unsafe ids (`doc/Skins.md:2991`).
  - Ship both files, identical.
- **The manifest:** `public/manifest.json` is `{ id: "crema", name: "Crema", description, version: "0.2.1", author: "yarneo", repository }`. It has no `entry` and no `license`.
- **Validation rules** (`scripts/validate-manifest.mjs`):
  - Checks every manifest that exists (`public/` and/or `dist/`).
  - `id`, `name`, `description`, `version` and `author` must be non-empty strings.
  - `id` must match `^[a-z0-9][a-z0-9_-]*$`.
  - `version` must equal `package.json`'s version.
  - Gaps: no version-format check (MSL requires numeric dot-segments), no `skin-manifest.json` parity check, and no check of the zip root.

### 6.2 CI

- **One workflow,** `.github/workflows/release.yml`, triggered by a `v*` tag or manual dispatch:
  - `ubuntu-latest`, Node 22, npm cache keyed on `web/package-lock.json`.
  - In `web/`: `npm ci`, `npm test`, `npm run release:zip`.
  - Root: `./build.sh` for the Tcl skin.
  - Release notes come from the tag annotation (`git tag -l --format='%(contents)'`).
  - `softprops/action-gh-release@v2` uploads `dist/Crema.zip` and `web/Crema-Decaid.zip`.
  - Permissions: `contents: write`.
- **No CI on push or PR.** Tests run only when a release is tagged.
- **CafAI's scaffold** already has `ci.yml` (push and PR: typecheck, lint, test, build, `release:zip`, Playwright e2e, and an informational real-Chromium-91 smoke job) and a `release.yml` that checks the tag matches `package.json` and uses `gh release create … release/*.zip`. Keep those. They already do everything Crema's workflow does, including release notes from the tag annotation, so there is nothing to port.

### 6.3 `dev/ipad.html` and `dev/vite.probe.config.ts`

- **`ipad.html`.** Served only by `vite dev`, because it sits outside `public/`. Open `/dev/ipad.html?w=1194&h=834&inset=21`.
  - It frames the app in an iframe and draws a striped home-indicator strip.
  - On iframe load it sets `--safe-bottom` on the inner document. This is why the stylesheet reads insets through `--safe-*` and not `env()` directly.
  - `bare=1` removes the harness chrome, for exact-size headless screenshots.
  - `tab=Shots` clicks a button whose text matches after 1.5 s, then sets `document.title='ready'` after a further 1.2 s, as a synchronisation point for screenshot scripts.
- **`vite.probe.config.ts`.** Started with `npx vite --config dev/vite.probe.config.ts --host 0.0.0.0 --port 5180` and opened on the real tablet.
  - It reuses the base config and injects a probe script (ES5-style, so it runs on old WebViews).
  - Every 1.2 s the probe measures the `--safe-*` variables (via a `position:fixed;height:var(--safe-x)` div), the tab row's bottom against the safe line, the number of header rows, content bottom against the dock top, and vertical and horizontal overflow.
  - It sends the result as JSON on an `Image` GET to `/__probe`. A middleware logs it in the terminal and returns 204.
  - `?sweep=1` walks the tabs.
  - "a layout claim about the tablet can be checked instead of assumed."
- **Reuse in CafAI:**
  - **`dev/tablet.html`:** presets for `teclast` (1280×800 at DPR 1.125, a viewport of about 1138×711 CSS px) and `ipad-air` (1180×820, inset 20). Use `src=/#/<route>` for hash deep links instead of `tab=`. Keep `bare` and `ready` for Playwright screenshots.
  - **Probe:** keep the beacon middleware. Measure `data-testid="nav"`, `data-testid="skin-exit"` and `data-testid="composer"`. Also report `visualViewport` (on-screen keyboard overlap matters for a chat composer) and `devicePixelRatio`.

---

## 7. Package and tooling facts

- **Dependencies:**
  - Runtime: **none**.
  - devDependencies: `@types/node ^22.20.1` (locked 22.20.1), `typescript ^5.7.3` (locked 5.9.3), `vite ^6.0.7` (locked 6.4.3, with esbuild 0.25.12 and Rollup 4.63.1).
  - Lockfile v3, 67 packages, `npm audit` reports 0 vulnerabilities.
  - No React or framework, no charting library, no schema library, no linter, no formatter, no coverage tool.
- **Vite** (`vite.config.ts`): `base:'./'` ("Decaid serves an installed skin from its own folder under /web-ui/<id>/"), `build.target:'chrome78'`, `outDir:'dist'`, `emptyOutDir:true`, dev server `127.0.0.1:5173`, `dev:lan` with `--host 0.0.0.0`. `VITE_GATEWAY` overrides the gateway origin at build or dev time only; there is no runtime override.
- **TypeScript:** strict, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules` and `erasableSyntaxOnly`. Parameter properties and enums are banned so that Node's strip-only mode can run the tests (comment at `client.ts:33-36`). `exactOptionalPropertyTypes:false`. Imports use `.ts` extensions. `tsc --noEmit` is clean at this commit.
- **Test setup:**
  - Node's built-in runner: `node --test --experimental-strip-types "src/test/*.test.ts"`.
  - **No Vitest, no jsdom or happy-dom, no mocking library, no MSW.**
  - `fetch` is injected as a constructor or option argument (`Gateway({fetch})`, `askProvider(…, {fetch, signal})`, `discoverServer(…, {fetch})`) and stubbed with `new Response(...)`.
  - DOM-touching code is tested with structural fakes (`formstate.test.ts:83-91`, `views.test.ts:812-839`) or not at all.
  - Assertions use `node:assert/strict`, with `assert.rejects` for async code.
  - **CafAI's scaffold**, for comparison: Vitest 5 (Node environment by default; `// @vitest-environment jsdom` per UI file), Testing Library, `fake-indexeddb`, MSW 2, Playwright, zod 4, `idb`, uPlot, MUI 9.4, `@mui/x-chat` alpha.18, `@vitejs/plugin-legacy` (`modernPolyfills`, `chrome >= 91`), `fflate` (zip), and an ESLint ban list for Chromium 91. Crema's injection-friendly style (`fetch` as a parameter) works well with MSW and is worth keeping.

---

## 8. Test results

- **Run** in `E:\source\cafai\crema\web` with local Node v24.13.1 and npm 11.8.0:
  - `npm ci`: OK, 0 vulnerabilities.
  - `npm test`: **`tests 361 · pass 361 · fail 0 · cancelled 0 · skipped 0 · todo 0`**, 1,157 ms, 19 files, 0 suites. Every test is flat `test()`; there is no `describe`.
- **Per-file counts:** views 90, gateway 37, parse 33, prompt 33, provider 29, recipe 18, phases 16, curves 13, trail 13, discover 12, profile 12, profile-edit 11, safearea 10, scrub 10, formstate 9, profile-plan 7, grind-entry 4, live-connections 2, settings-mirror 2.
- **`npx vitest run`:** not applicable, so not run. Vitest is not a dependency, and every test imports `node:test`, so Vitest would not collect them without the import swap in §2.3.
- **Also run:** `npx tsc --noEmit` is clean. `npx vite build --outDir <temp>` succeeds (sizes in §6.1). The output was deleted and `git status` is clean.
- **Notable gaps:**
  1. `main.ts` (2,714 lines) has **no tests**. That covers apply order, undo, hydrating and mirroring settings (where the §3.5 bug hides), shot-end record creation, the boot sequence and discovery fallback.
  2. `LiveMonitor` is untested: reconnect and backoff, shot start and end, and the late-snapshot flapping.
  3. `Store` writes are untested: the index read-modify-write, `readRecent`, deletes, bean presets.
  4. `loadSettings` and `saveSettings` are untested.
  5. No real DOM tests. `captureForms`/`restoreForms`, `applySafeArea` and `attachScrub` are exercised only through fakes.
  6. No browser-version tests, so the `.at()` regression passes in Node.
  7. No streaming, tool-use, timeout or retry tests, because those features do not exist.
  8. Every shot-analysis test uses synthetic data, and every advice fixture is hand-written JSON. There are no recorded model outputs.
  9. Prompt tests are string-match assertions. This is deliberate, but brittle when wording changes.
  10. CI runs tests only on a release tag.

---

## 9. Conflicts with CafAI rules (for DECISIONS.md)

Format: **Crema approach** → **CafAI rule** → **recommended resolution**.

1. **C1 — Licence.** Crema is "GPLv3" with no "or later" and no per-file headers (§1). → CafAI is GPL-3.0, and the scaffold declares `GPL-3.0-or-later`. → License CafAI `GPL-3.0-only`, or mark each Crema-derived file `SPDX-License-Identifier: GPL-3.0-only` with a modification notice and list it in `CREDITS.md`.
2. **C2 — Free-form AI profiles.** `profile.action: "create"` (`schema.ts:101-105`, `parse.ts:220-240`, `main.ts:1413-1427`). → The model may adjust only template-declared fields within bounds, and never pump type, step order, step count, sensor or exit type. → Remove `create`. Add a strict `propose_adjustment` tool, `{templateId, changes:[{field, value, reason}]}`, validated by `src/coach/validator.ts` against the template's declared fields and bounds. Keep Crema's DE1 hard limits (P 0–10, F 0–8, T 80–98) as an outer guard.
3. **C3 — Silent clamping and dropping.** Out-of-range values are clamped silently (`parse.ts:206-218`) or dropped (`proposal.ts:33-37`). → Validate every model output against a schema and bounds. → Reject invalid fields explicitly: return an `is_error` `tool_result` naming the bound, allow one re-ask, then show the user what was refused. Never clamp silently.
4. **C4 — Bounds are plausibility only.** Dose 0–60, yield 0–200, temp 60–110, grind 0–100, with no limit per iteration. → Bounded adjustments. → Add per-turn step limits (for example temperature ±1 °C, at most ±2) and absolute template bounds. Keep Crema's lesson: **never clamp the grind to the user-typed range**. Bound the grind by sanity plus the largest move allowed per turn, relative to the grinder's dial step.
5. **C5 — Profile switching.** The model switches to any installed profile by exact title (`prompt.ts:210`, `main.ts:1428-1436`). → Template-bound coaching. → The model may switch only among CafAI templates, by `templateId`, and the user confirms. Unknown ids are rejected.
6. **C6 — Free-text JSON.** The response format is given as prose (`ADVICE_SCHEMA_TEXT`) and parsed tolerantly. → Tool use with `tool_choice: "auto"`, and every output validated. → Use strict tools plus zod. Keep `extractJsonObject` only as a fallback for text-only replies. When no tool call arrives, re-prompt.
7. **C7 — No streaming.** One-shot requests (`askProvider`). → Streaming is required. → Write a new `src/llm/anthropic.ts` SSE client using `body.getReader()` (§4.2).
8. **C8 — Five providers in the UI**, plus Mac-server LAN discovery. → Only Anthropic is wired into the UI, behind `LlmProvider`. → Define the interface and register only Anthropic. Drop `discover.ts` and the OpenAI, Google, compatible and server UI.
9. **C9 — No timeout, retry, `stop_reason` check or user cancel** (`provider.ts:297-337`; `main.ts` never passes a signal). → A robust LLM layer. → Add an `AbortController` (user cancel plus an overall timeout), backoff retries for 429/529/5xx that respect `retry-after`, and explicit handling of `max_tokens` and `refusal`.
10. **C10 — One user message, no system prompt, no conversation.** → A chat-first coach. → Freeze the system prompt and tool set per conversation. Append shot context as new user turns or tool results, keeping history append-only (required by preserved thinking on Opus 5.5 and Fable 5.1). Cache the stable prefix.
11. **C11 — Hard-coded model ids**, default `claude-haiku-4-5`, and no Opus 5.5 (`provider.ts:53-79`). → Keep the model list in config. → Put the model list in `src/llm/models.ts`, with the default recorded in DECISIONS.md. Verify the ids at build time; note the Sonnet "5.5" discrepancy (§4.2).
12. **C12 — The KV store is the primary shot store**, with no IndexedDB and no export or import (`store.ts`). → IndexedDB behind repository interfaces, persisted immediately, JSON export and import, non-secret data mirrored to Decaid KV. → Make IndexedDB primary. `src/storage/mirror.ts` mirrors to the `cafai` namespace. Mirror summaries, not raw curves, because KV limits are unknown. Restore from `GET /api/v1/store/cafai` on an empty database.
13. **C13 — The settings mirror is effectively never written** (§3.5). → Persist immediately and mirror. → Mirror from the repository on every committed change, and add a wiring test.
14. **C14 — API key storage.** The key sits in `localStorage` `crema.settings.v1` alongside ordinary settings. → The key stays local only: never logged, never in shot data. → Keep it in a separate local-only record, excluded from export and the mirror. Add "Forget key". Keep Crema's tests that the key appears only in the header and never in the mirror.
15. **C15 — Namespace.** Crema writes `crema/*` KV keys. → Do not write keys you don't own (the DYE2 rule). → Use the `cafai` namespace only. Optionally import `crema/*` records read-only.
16. **C16 — Build target `chrome78` with Chrome 78 shims.** → `chrome91`. → Target `chrome91` and drop `compat.ts`. Handle `.at` with `last()` or polyfills plus lint (Crema shipped this regression; §3.6). Keep the real-Chromium-91 smoke test.
17. **C17 — No URL routing.** Tabs live in memory (`main.ts:2115-2123`). → Hash routing. → Use a hash router. The dev harness deep-links with `#/route`.
18. **C18 — Profile value types are normalised.** `readProfileStep` normalises values; the AI and editor paths POST normalised profiles. → Activation is a PUT of the **complete** profile, mirroring the types GET returns, with one exit per step. → Build adjusted profiles by cloning the template or GET JSON **verbatim** and changing only the declared fields. Never round-trip through `readProfileStep` before a PUT. Always send every profile key, because **[Decaid HEAD]** deep merge keeps omitted keys from the previous profile. Crema's single `exit` object already satisfies "one exit".
19. **C19 — Undo with explicit nulls** (`workflow.ts:96-100`). → Activation and undo must be accepted by the pinned Decaid. **[Decaid HEAD]** rejects null `context.targetYield` and null `steamSettings` fields. → Undo restores previous values only. For a non-nullable field that had no prior value, keep the applied value and say so. Test against the pinned Decaid.
20. **C20 — Four fields filled only at `createProfile`.** → New profiles must include `tank_temperature`, `target_volume`, `target_volume_count_start` and `version`. → Port the wire-level fill as-is, and also assert the four fields in the validator before the POST.
21. **C21 — Assumes the title is part of the content hash** (`profile-edit.ts:71-77`, `main.ts:2216-2221`). → Coach-owned version history. → **[Decaid HEAD]** `profile_hash.dart` hashes the content **without** the title, so identical content dedups to one id. Treat Decaid ids as opaque. Keep the per-bean version history ("<Bean> v<n>") in IndexedDB. Link versions with `parentId` on POST.
22. **C22 — No heartbeat.** → Send a heartbeat on user interaction. → `POST /api/v1/machine/heartbeat` (**[Decaid HEAD]** `doc/Skins.md:1515-1532`; the server throttles to once per 30 s), sent on `pointerdown` and `keydown`, throttled client-side.
23. **C23 — The exit control is hidden on focus screens.** The way out sits in the status strip, which `styles.css:862` hides while a shot awaits rating or advice is shown (`.app--focus`). → Always provide a way back to the skin switcher. → Make the exit control persistent on every route, including full-screen chat. Use `exitToDashboard()` inside Decaid, with the fallback `…/settings.reaplugin/ui?backName=CafAI`.
24. **C24 — Full re-render per sample during shots, and innerHTML with form-state restoration.** → No full re-render per WebSocket tick. → Use an external telemetry store with selector subscriptions, push chart data imperatively to uPlot (rAF or throttled), and use controlled inputs (§3.3, §3.7).
25. **C25 — No silent-socket detection, no visibility handling.** → A robust WebSocket manager (RESEARCH §2). → Per-socket watchdog, visibility reconnect, and connection state only from `/ws/v1/devices` (§3.4).
26. **C26 — Shots captured from WebSocket frames on the client clock, never linked to Decaid's shot records.** → Shot summariser fed by Decaid data. → Take canonical measurements from `/api/v1/shots`, keyed by Decaid's shot id, and use the WebSocket for live display only. Map the rating to `annotations.enjoyment` at the Decaid boundary (scale differs by version; a separate decision).
27. **C27 — Prompt claims tools it does not attach** ("you have web search", `prompt.ts:103`). → Tool use is explicit. → Claim only the tools attached to the request. Decide whether to attach server web search for grinder lookup.
28. **C28 — Time-axis mislabel** ("seconds from first drop" while t = 0 is pump start). → The summary must be correct. → Label t = 0 as shot start, and compute first drop separately (§4.3).
29. **C29 — Fonts and layout.** System font stacks; layout tuned for iPad and desktop (`styles.css` breakpoints at 1240, 1100, 900 and 700 px). → Self-hosted fonts; touch-first at 1280×800. → Bundle Roboto with `@fontsource` (already in the scaffold). Design for 1280×800 and also check about 1138×711 CSS px (the Teclast at DPR 1.125). Keep tap targets of at least 44–46 px and `touch-action: manipulation`.
30. **C30 — Gateway host.** `location.hostname:8080` with only a build-time `VITE_GATEWAY` override. → Default to `window.location.hostname:8080`, which matches. → Keep `resolveGatewayOrigin` (including the `https` mirroring). Decide whether to add a runtime override such as the MSL `localStorage.reaHostname` convention.
31. **C31 — Tooling.** Node's test runner, a shell `zip`, CI only on tags. → Vitest and MSW, a Windows-capable release script, CI on every push. → Convert tests with the import swap. Write `scripts/release-zip.mjs` with `fflate`, validating the root layout and both manifests. Keep the scaffold's `ci.yml`.

---

## 10. Port order, by workstream

The recommended sequence is the numbers in brackets. Pure logic goes first because it carries most of the test value and depends on nothing. Every ported file gets the §1.4 header. Tests are converted to Vitest with the §2.3 import swap.

### [1] Tooling (do first; it unblocks everything)

- **Port:**
  - `web/scripts/validate-manifest.mjs` → `scripts/validate-manifest.mjs`. Extend it with: `skin-manifest.json` parity, version format, the zip root, and `dist/index.html`.
  - `web/public/manifest.json` → `public/manifest.json` and `public/skin-manifest.json`, generated from `package.json` with `id:"cafai"`.
  - `web/dev/ipad.html` → `dev/tablet.html`.
  - `web/dev/vite.probe.config.ts` → `dev/vite.probe.config.ts` (§6.3).
  - From `web/index.html`, carry over `viewport-fit=cover` and the `/__decent/skin-api.js` tag.
  - From `web/src/vite-env.d.ts`, carry over the `DecentApp` typing.
- **New:**
  - `scripts/release-zip.mjs` (fflate, replacing the shell `zip`).
  - A codemod that swaps `node:test` imports.
- **Tests:** none to port. Write new validator script tests in `scripts/*.test.mjs`.

### [2] api + mock

- **Port:**
  - `gateway/devices.ts` → `src/api/devices.ts`. AS-IS.
  - `gateway/client.ts` → `src/api/client.ts`. ADAPT: add heartbeat and typed errors; keep the deadlines, `describeGatewayError`, the `createProfile` four-field fill and `connectKind`.
  - `gateway/types.ts` → `src/api/types.ts`. ADAPT on top of `openapi-typescript` output.
  - `gateway/workflow.ts` → `src/api/workflow.ts`. ADAPT the undo nulls.
  - `live.ts` → `src/api/ws.ts` plus `src/api/liveShot.ts`. ADAPT: watchdog, visibility, timestamps, substate.
  - `store.ts` (KV client part) → `src/api/kv.ts`.
- **Tests:**
  - `gateway.test.ts`, split into `client`, `workflow` and `devices` (37 tests). Rewrite `:155-163`.
  - `profile.test.ts:104-120` (3, error bodies).
  - `live-connections.test.ts` (2).
  - New: LiveMonitor reconnect, watchdog and shot-detection tests. None exist today.
- **`mock/` fixtures to lift:**
  - the verbatim Decaid 0.8.4 step (`profile.test.ts:11-23`)
  - the workflow fixture (`gateway.test.ts:16-34`)
  - the verbatim error body (`profile.test.ts:106`)
  - the `available:false` device list (`gateway.test.ts:389-396`)
  - scale status and snapshot frames (`live-connections.test.ts:6-15`)
  - snapshots recorded from the Decaid MockDe1 (`web/README.md:79-90` recipe)

### [3] Coach logic (pure; can run in parallel with [2])

**PORT AS-IS:**

| Crema file | CafAI target | Tests |
|---|---|---|
| `domain/recipe.ts` | `src/coach/recipe.ts` | `recipe.test.ts`, 18 |
| `domain/trail.ts` | `src/coach/trail.ts` | `trail.test.ts`, 9 |
| `advice/attempts.ts` | `src/coach/attempts.ts` | `trail.test.ts`, 4 |
| `domain/profile.ts` | `src/coach/profile.ts` | `profile.test.ts`, 9; `profile-plan.test.ts`, 7 |
| `advice/curves.ts` | `src/coach/summary/curves.ts` | `curves.test.ts`, 13 |
| `advice/phases.ts` | `src/coach/summary/phases.ts` | `phases.test.ts`, 16 |
| `domain/last.ts` | `src/util/last.ts` | — |

**ADAPT:**

- `domain/grind.ts` → `src/coach/grind.ts`: make the grid step configurable. Tests: `parse.test.ts` grind (5) and `grind-entry.test.ts` (4).
- `domain/rating.ts` → `src/coach/rating.ts`: add the enjoyment mapping. Tests: `prompt.test.ts` rating (3).
- `advice/proposal.ts` → `src/coach/validator.ts`: the bounded validator. Rewrite `parse.test.ts` proposal (3); new tests per template bound.
- `advice/schema.ts` → `src/coach/schema.ts`: zod.
- `store.ts` `hasCurves`/`needsRating` → `src/coach/shotRecord.ts`. Tests: `prompt.test.ts` (4).
- `advice/prompt.ts` → `src/coach/prompt/*`. Tests: `prompt.test.ts`, 24, adapted.
- From `views.ts`, extract:
  - `leadChange` → `src/coach/diffText.ts` (`views.test.ts:843-874`, 6 tests)
  - the stage detection → `src/coach/summary/stages.ts` (new tests)
  - `REBUTTAL_OPTIONS` → `src/coach/quickReplies.ts`
  - `ROAST_LEVELS`/`formatBagSize` → `src/coach/beans.ts`

**DEFER:** `domain/profile-edit.ts` → `src/coach/profileEdit.ts`. Tests: `profile-edit.test.ts` (11).

**New:**

- the template model, `src/coach/templates/`, snapshotted from Decaid's bundled profiles (RESEARCH §3)
- the summariser additions from §5

### [4] Storage

- **Port:**
  - `settings.ts` → `src/storage/settings.ts` plus `src/storage/secrets.ts` (ADAPT to IndexedDB).
  - `store.ts` mirror half → `src/storage/mirror.ts` (ADAPT: `cafai` namespace, summaries only).
  - `main.ts:1883-1923` hydrate and mirror rules → `src/storage/mirror.ts`. Keep "fill blanks only, never overwrite local"; fix the trigger.
  - `main.ts:1587-1652` per-bean presets → `src/storage/beanPresets.ts`.
- **Tests:**
  - `settings-mirror.test.ts` (2, adapted).
  - `provider.test.ts:271-277` (`isReady`), re-targeted to "an Anthropic key is present".
  - New: repository tests on `fake-indexeddb`, export/import round trip, mirror wiring, and the key never appearing in export or mirror.

### [5] LLM

- **Port:**
  - `advice/provider.ts` → `src/llm/anthropic.ts`. ADAPT: keep the headers, endpoint and `buildRequest`. Add system prompt, tools, `stream:true`, the SSE reader, abort, timeout, retries and `stop_reason` handling.
  - Plus `src/llm/errors.ts` (`describeHttpError`, `extractErrorDetail`), `src/llm/models.ts` and `src/llm/types.ts` (`LlmProvider`).
  - `advice/parse.ts` → `src/llm/parse.ts`, keeping `extractJsonObject`, `coerceNumber` and `readEvidence`.
  - New `src/llm/tools.ts`: strict tool schemas, with zod on the way in.
- **Tests:**
  - `provider.test.ts`: the Anthropic and error-mapping subset (about 18 of 29 tests), adapted.
  - `parse.test.ts`: extraction, coercion and evidence (13).
  - New: SSE parsing over chunked fixtures, tool-call assembly from `input_json_delta`, the auto-with-no-tool-call re-prompt, and the `refusal`/`max_tokens` paths, all with MSW-mocked SSE.

### [6] Baseline UI (machine, beans, profiles, shots, settings)

- **Port:** `safearea.ts` → `src/ui/platform/safeArea.ts` (AS-IS; `safearea.test.ts`, 10).
- **Rules to re-express from `main.ts` and `views.ts`** (no code port), as RTL tests:
  - the machine commands (`isRunningMachineState`, Stop-only while running, nothing commandable without a connected machine, GHC empties the rail)
  - the water-field whitelist
  - the exit control (persistent; §9 C23)
  - device connect flows using `describeFailedConnect`
  - per-bag dial-in grouping (`main.ts:282-330`: `bagIdentity`, `sameDialIn`)
  - comparison shots (`:360-383`)
  - the starter gating (roast level required, `:488-534`)
  - the GHC cache
  - the REST seeding at boot (`:2683-2692`)
  - the heartbeat
- **Charts:** uPlot. Take the visual rules from `views.ts:538-703`: a shared 0–12 axis for bar and mL/s; goal lines; the previous shot; evidence bands; stage labels spaced in pixels.

### [7] Chat UI

- **Concepts to port, no code:**
  - the advice card as a diff, with **held** fields, the lead change as the headline, and "Use for next shot", "Undo" and "Close" (`views.ts:257-327`)
  - the starting-point card variant (no "before" values)
  - `REBUTTAL_OPTIONS` as quick-reply chips
  - the four-tap rating as quick replies
  - in-place elapsed counters while streaming (the pattern from `main.ts:1096-1118`)
  - reopening advice against its original `adviceBase` (`main.ts:204-212`)
  - "Reading your shot… You can keep using the skin" (`views.ts:362-372`)
- **Tests:** RTL tests rewritten from `views.test.ts:62-98,272-330,843-934`.

---

## Appendix A — Crema facts verified on live Decaid (0.8.4 / 0.8.6)

These come from Crema's comments and commits. Keep them as fixtures and tests:

- `GET /api/v1/workflow` answers with no DE1 connected.
- Errors are JSON: `HTTP 500 {"error":"DeviceNotConnectedException: machine not connected"}`.
- Profile steps use a nested `exit` object and numeric values; `version` is the string `"2"`.
- `scan?quick=true` "comes back empty while a full scan finds the machine every time" on a real DE1.
- A switched-off DE1 is still listed, with `available:false`.
- MockDe1 does not implement `machine/waterLevels`.
- Skins installed by copying files fail because the app container is sandboxed; use `POST /api/v1/webui/skins/install/url`.
- A new default skin loads only after a restart.
- `PUT /api/v1/webui/skins/default {"skinId":…}`. This matches **[Decaid HEAD]** `webui_handler.dart:16`; RESEARCH says POST, which is wrong.
- Decaid's WebView reports all safe-area insets as 0 while the page fills the screen (iPad Air, Decaid 0.8.6).
- `localStorage` is scoped to the port the skin is served from and was lost on reinstall (v1.1.1). **[Decaid HEAD]** `doc/Skins.md:67-90` now promises stable per-skin origins, with a temporary-origin fallback. Design for loss anyway.

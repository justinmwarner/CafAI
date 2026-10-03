# VERIFIED — what the sources actually say

Phase 0 of the CafAI build. Every fact here was read from the repositories
below at the listed commits (file:line citations are in the detailed
documents). Where a repo and `docs/RESEARCH.md` disagree, **the repo wins**.

| Repo | Commit read | Commit date |
|---|---|---|
| [decentespresso/decaid](https://github.com/decentespresso/decaid) | `a45961b323831d2170b3e7f3fef7c72fdd341642` | 2026-10-01 |
| [yarneo/crema](https://github.com/yarneo/crema) | `628cd714fa1a3a5194ea0e4c579d54ae1e38353c` | 2026-09-24 |
| [decentespresso/streamline-js](https://github.com/decentespresso/streamline-js) | `cb058cad8a08904889b817de944566dfe1dd8a9a` | 2026-10-02 |
| [decentespresso/dye2](https://github.com/decentespresso/dye2) | `2684b67494954028b98e6725ed28f18328015ae0` | 2026-09-30 |
| [pudabassman/decaid-zen](https://github.com/pudabassman/decaid-zen) | `ba6282fcc3fc3a160bbd1942b066f49b73afd380` | 2026-09-24 |
| [allofmeng/MSL](https://github.com/allofmeng/MSL) | `965af5cb3f42fcc29e6f4aeb74defc0dd07f099f` | 2026-09-28 |
| [The-Walker443/decaid-mcp](https://github.com/The-Walker443/decaid-mcp) | `aecef96b870e4f3567ed5f08c876f77adf25f5a7` | 2026-09-29 |

Detailed, cited write-ups:

- [verified/01-platform.md](verified/01-platform.md): manifest, zip layout,
  origins and storage, heartbeat, KV store, exit, settings link, WebView limits.
- [verified/02-api.md](verified/02-api.md): REST and WebSocket contracts, with
  23 example payloads in [verified/examples/](verified/examples/).
- [verified/03-profiles.md](verified/03-profiles.md): Profile v2 fields,
  limits, identity hashing, and the three coach templates with lever bounds.
- [CREMA_PORT_PLAN.md](CREMA_PORT_PLAN.md): module-by-module Crema audit.

The Decaid clone is shallow and untagged, so its release number cannot be
read from source; it is newer than 0.8.6+2801 (the field version that the
decaid-mcp fixtures were captured from). CafAI shows the live version from
`GET /api/v1/info` / `window.__DECENT_HOST__`.

## 1. Skin platform (doc/Skins.md + Dart code)

- **Manifest:** Decaid reads `skin-manifest.json`, falling back to
  `manifest.json`. Only `id`, `name`, `description`, `version` are read, all
  JSON **strings**; a numeric `version` makes the skin silently vanish from
  the list. There is no `entry` field; `index.html` is always the start page.
  `id` becomes the install folder, which fixes the port, the origin and the
  saved browser data, so it must never change (`cafai`).
- **Zip:** files at the root (or exactly one top-level folder). A GitHub
  release install takes the first `.zip` asset; updates are detected by a new
  release tag, polled every 12 h, and files are replaced in place while the
  page runs (so lazy chunks can 404).
- **Install endpoints:** `POST /api/v1/webui/skins/install/github-release
  {repo, asset?, prerelease?}`, `.../install/url {url}`; default skin is
  `PUT /api/v1/webui/skins/default {skinId}` (not POST).
- **Origins and storage:** each skin gets a stable port (24800-28895) keyed to
  its folder; `:3000` only 307-redirects to it. localStorage and IndexedDB
  survive restarts and same-id updates; sessionStorage does not. If the port
  cannot be bound, that run gets a temporary origin with empty storage.
- **Background:** after 10 minutes in the background the page is unloaded and
  later reloaded at `/?_=<timestamp>` (the hash route is lost). No SPA
  fallback (deep paths 404), no-store caching, WebView cache disabled.
- **Heartbeat:** `POST /api/v1/machine/heartbeat`, no body, returns
  `{timeout}` (seconds to auto-sleep, or -1). Send on real user input.
- **KV store:** `/api/v1/store/<ns>[/<key>]`. `GET <ns>` lists keys,
  `?full=1` returns the whole map with an ETag (304 on `If-None-Match`);
  `POST` stores any JSON up to 1 MiB and returns `{}`; `DELETE` returns `{}`;
  **a missing key is 200 `null`** (spec and docs say 404). No auth; included
  in backups. DYE2 owns `dye2.reaplugin` (read-only for everyone else). CafAI
  uses `cafai`.
- **Leaving the skin:** `window.decentApp.exitToDashboard()` (from the
  injected `/__decent/skin-api.js`) when `window.__DECENT_HOST__` exists;
  the dashboard has the Skins page. In-skin skin switching strands the page on
  a dead port. Android Back / edge swipes also exit, so no edge gestures.
- **Settings link:**
  `http://${location.hostname}:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI`.
- **Host:** `localStorage.reaHostname || location.hostname`, port 8080; every
  API call is cross-origin. CORS allows only `Accept, Accept-Encoding,
  Authorization, Content-Type, DNT, Origin, User-Agent, If-None-Match`.
- **WebView:** user agent is exactly `Decent`; no camera or microphone
  (`getUserMedia` unavailable); edge-to-edge with no reported safe-area
  insets; real tablet CSS viewports 962x602, 1007x602 and 1140x712. Console
  output is saved and readable over the LAN (never log secrets).

## 2. REST and WebSocket API (assets/api/*.yml + handlers)

- **Machine:** `GET /machine/info`, `GET /machine/state` (500 with no DE1),
  `GET /machine/capabilities` (exists), `PUT /machine/state/{espresso|steam|
  hotWater|flush|idle|sleeping|skipStep}` with no body. `idle` stops anything
  and wakes; sleep is `sleeping`. 400 `block_no_scale` can block espresso.
- **Scale:** `PUT /scale/tare` (500 with no scale). Decaid tares twice at
  every shot start, so CafAI never tares for espresso.
- **Workflow:** `GET`/`PUT /api/v1/workflow`. PUT **deep-merges** objects key
  by key and **replaces arrays wholesale**; omitted profile keys are inherited
  from the previous profile, so the full ten-key profile is always sent. The
  workflow profile has no id. The machine upload happens **after** the
  response, with no success signal (only `profileUploadFailed` on
  `ws/v1/devices`). Do not PUT during a shot (the record copies the workflow
  at shot end).
- **Stop-at-weight reads `context.targetYield`** (a JSON number; 0 = off;
  null rejected), not `profile.target_weight`.
- **Profiles:** `POST /api/v1/profiles {profile, parentId?, metadata?}`.
  Identical execution content returns the **existing** record (201) with its
  old title. A content-changing `PUT /profiles/{id}` deletes the old id.
- **Shots:** `GET /shots?limit&offset` → `{items,total,limit,offset}`,
  `/shots/latest`, `/shots/{id}` with `measurements: [{machine, scale,
  volume}]`. Real sampling is ~3.7 Hz (docs say 10 Hz); recording starts at
  preheat and stops at the stop decision. Yield is `annotations.actualYield`;
  enjoyment is 0-10. `PUT /shots/{id}` deep-merges.
- **WebSockets:** `ws/v1/machine/snapshot`, `machine/shotSettings`,
  `machine/waterLevels`, `machine/shotState` (carries `shotId` = shot record
  id), `scale/snapshot` (`{status}` or weight frames), `devices` (the only
  source of machine link state). Machine sockets stay open and silent while
  the machine is away and re-attach automatically. `ws/v1/machine/state` does
  not exist.
- **Timestamps:** telemetry and profile timestamps are local without a zone;
  shot `createdAt`/`updatedAt` and devices timestamps are UTC with `Z`.

## 3. Profile v2

- GET returns **JSON numbers**; only `version` (`"2"`) and the enums are
  strings; `target_volume_count_start` is an integer. CafAI sends numbers.
- Required on create: non-empty `title` and `steps`, `tank_temperature`,
  `target_volume_count_start`. Each step needs `name, pump, transition,
  sensor, temperature, seconds, volume` plus `pressure` (pressure pump) or
  `flow` (flow pump); a missing step field is a 500. Errors carry a `message`.
- One firmware `exit` per step; `seconds`, `volume` and the app-side `weight`
  can also end a step. `limiter.value` caps flow on a pressure step and
  pressure on a flow step.
- Decaid validates **no ranges**; the DE1 encoder silently wraps (16 bar
  becomes 0 bar). CafAI enforces its own bounds.
- Id = `"profile:" + sha256(sorted-key JSON of version, beverage_type, steps,
  tank_temperature, target_weight, target_volume,
  target_volume_count_start)[0:20]`. Title, notes and author are not hashed.
- Templates copied byte-for-byte to `src/coach/templates/source/`:
  Blooming Espresso (`profile:7438cb7266f60558b48f`), D-Flow / default
  (`profile:59036f8846b1ed3b4255`), Londonium (`profile:729d284747718d27c93a`).

## 4. Crema (web/ only)

- 361/361 tests pass on Node's test runner; `tsc` and `vite build` are clean.
- No per-file copyright headers; GPLv3 without "or later"; holder yarneo.
  README credits the MimojaCafe de1app skin lineage.
- Hard-won fixes kept: required profile fields filled at the wire, safe-area
  inference, no full re-render per tick, devices-only link state, settings
  mirror without the key. Bugs not to port: the mirror is never written,
  `.at(-1)` ships to Chromium 91, full re-render on every sample during a shot.

## 5. Chromium 91 (tested, not inferred)

A probe built with this repo's toolchain (MUI 9.4, `@mui/x-chat`
9.0.0-alpha.18, uPlot, idb, zod; `target: chrome91`; usage-based core-js
polyfills) loaded in a real `HeadlessChrome/91.0.4469.0` with zero errors,
correct layout, and a working x-chat send/stream/reply round trip.
Re-run with `npm run smoke:chrome91` (needs `npm ci` in `tools/chrome91`).

The finished app was then verified the same way: `npm run smoke:chrome91`
loads the mock-mode build with zero errors, and `npm run smoke:chrome91:loop`
drives the whole coach loop (settings, new bag, templates, v1, scripted shot,
taste chip, confirmed v2) in Chromium 91 with zero page or console errors.
One incompatibility was found and fixed on the way: MSW's mock worker (test
infrastructure only) called `crypto.randomUUID`, which Chromium 91 lacks.

## 6. Where RESEARCH.md was wrong (repo wins)

1. Required profile fields are title, steps, `tank_temperature`,
   `target_volume_count_start` (not `target_volume`/`version`), and the 400 is
   not bare: it carries a `message`.
2. Stop-at-weight is `context.targetYield`, not `target_weight`.
3. Numbers are accepted and returned; profiles are not string-typed.
4. Identical content dedupes to the existing record; title edits keep the id;
   step renames change it. Ids are computable.
5. A step has one firmware exit, but `seconds`, `volume` and `weight` also end it.
6. No 20-step limit is enforced (20 is a de1app convention).
7. `PUT /api/v1/webui/skins/default` (not POST); no `tag` in the
   github-release body; `entry` is not a manifest field.
8. `:3000` only redirects; `GET /machine/capabilities` exists;
   `ws/v1/machine/state` does not; dosing-scale routes do not exist.
9. Machine sockets re-attach after a power cycle; reconnect only on `close`.
10. Same-id updates keep the origin and storage; real tablet viewports are
    smaller than 1280x800 CSS px.
11. Without a heartbeat, auto-sleep still fires (30 min after idle).
12. The supported way back is `exitToDashboard()`, not a link to Streamline.
13. Sonnet "5.5" is not a model; the current Sonnet is `claude-sonnet-5`.

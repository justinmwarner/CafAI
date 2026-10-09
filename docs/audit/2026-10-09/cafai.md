# CafAI ↔ Decaid integration inventory

Audit of CafAI at HEAD `cf5cce1` (2026-10-09), read-only. All paths are relative to the repo root unless absolute. Baseline checked during the audit: `npm run typecheck` is clean; `npx vitest run src/api` passes (13 files, 172 tests).

CafAI's view of Decaid was verified once, against Decaid source commit `a45961b` (2026-10-01) plus real Decaid 0.8.6+2801 captures (`docs/VERIFIED.md:7-30`, `src/api/types.ts:1-17`). Nothing in the code or CI re-checks that view against a newer Decaid.

---

## 1. Every Decaid integration point

### 1.1 Host, origin and host globals

| Concern | Where | Behaviour / failure handling |
|---|---|---|
| API origin | `src/api/host.ts:17` (`GATEWAY_PORT = 8080`), `:44-55` `resolveGatewayOrigin`, `:73-75` `defaultGatewayOrigin`; used at `src/app/createServices.ts:27` | `${protocol}//${location.hostname}:8080`, scheme mirrors the page (https → https). Every call is cross-origin. |
| Developer override | `src/api/host.ts:20` (`localStorage.reaHostname`), `:63-70` | Bare host, `host:port`, or full origin. Storage access errors → no override. |
| WebSocket origin | `src/api/host.ts:58-60` | `http(s)` → `ws(s)` on the same host/port. |
| No custom headers (CORS allow-list) | `src/api/http.ts:12-13, 143-148` | Only `Content-Type` (when there is a body) and `If-None-Match` (KV, `src/api/kv.ts:46`). |
| Deadlines | `src/api/http.ts:17` (8 s default, covers body read `:151-163`); `src/api/client.ts:34` (workflow PUT 15 s), `:36-37` (scan 6 s / 25 s); `src/api/machineProfile.ts:29` (barrier 20 s); `src/ui/settings/SettingsScreen.tsx:230` (grinder list 5 s) | Timeout → `GatewayError(code 'timeout')`; network failure → `code 'network'` (`src/api/http.ts:164-173`). |
| Admission control | `src/api/http.ts:121-129, 185-191` | A **GET** answered 429/503 is retried once after `Retry-After` (capped 10 s). State changes never retried. |
| `window.__DECENT_HOST__` | `src/api/host.ts:27-33, 89-95, 105-116` | Truthiness = "inside Decaid" (`insideDecaid`); `.version` (string or finite number) = `hostVersion`, shown in Settings › About (`src/ui/settings/SettingsScreen.tsx:392-418`). Changes exit label (`src/ui/shell/AppShell.tsx:115, 252`) and skips file download in History export (`src/ui/history/HistoryScreen.tsx:462-464`). |
| `window.decentApp.exitToDashboard()` | `src/api/host.ts:117-127` | Resolved at tap time; called only if `__DECENT_HOST__` is present and it is a function; otherwise navigates to the settings URL. Buttons: `src/ui/shell/AppShell.tsx:250-286`, boot/error screen `src/main.tsx:40-71`. |
| Decaid settings link | `src/api/host.ts:110-111` | `http://<host>:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI` (host from the override when set). Always `http:`. Links: `src/ui/shell/AppShell.tsx:289-295` (D13), `src/main.tsx:65`. |
| `window.__CAFAI_ENGINE__` (not Decaid) | `index.html` inline check, `src/ui/shell/AppShell.tsx:489-531` | The "older engine" warning is about the WebView's **Chromium** version (< 91, D58), not the Decaid version. |

### 1.2 REST endpoints actually used in production

`requestValue` throws `'Decaid sent an empty reply.'` on a 200 `null`/empty body (`src/api/http.ts:217-222`); `requestJson` returns `null` (`:212-215`); a non-JSON 2xx throws `'Decaid sent a reply CafAI could not read.'` (`:203-206`). Errors go through `interpretGatewayError` (`src/api/http.ts:88-114`): `type` codes `block_no_scale` / `block_tare_during_shot`, text match `/not connected|no (machine|scale) connected/` → `code 'not_connected'`, `admission_limit` → "busy", otherwise the first of `message`/`details`/`error` with the exception prefix stripped, or `Decaid answered HTTP <status> for <path>.`

| Method + path | Client function | Feature / UI using it | Failure handling |
|---|---|---|---|
| `GET /api/v1/info` | `getInfo`, `src/api/client.ts:76` (`requestValue<BuildInfo>`) | Settings › About "Decaid <fullVersion‖version>", only when `__DECENT_HOST__` gave no version (`src/ui/settings/SettingsScreen.tsx:392-418`) | Any failure → "Decaid version unknown (not connected)". **Display only; never gates anything.** |
| `GET /api/v1/machine/info` | `getMachineInfo`, `src/api/client.ts:79` | `useHasGhc` (`src/ui/machine/useHasGhc.ts:10-35`): `GHC === true` hides the on-screen start buttons (`src/ui/machine/commands.ts:77-89`); cached in `localStorage['cafai.machine.ghc.v1']` (`src/ui/machine/ghcCache.ts:9-37`) | Read on every machine connect; failure keeps the cached value. |
| `GET /api/v1/machine/state` | `getMachineState`, `src/api/client.ts:84` | Telemetry start-up seed, only when `GET /devices` says the machine is connected (`src/api/telemetry.ts:396-406`); parsed with `parseMachineFrame` | Errors swallowed; the sockets take over. |
| `PUT /api/v1/machine/state/{espresso\|steam\|hotWater\|flush\|idle\|sleeping}` | `setMachineState`, `src/api/client.ts:94-96` (`CommandableState`, `src/api/types.ts:62-63`; `skipStep` typed but never sent) | Machine row Espresso/Steam/Flush/Hot water/Stop/Wake (`src/ui/machine/MachineRow.tsx:40-45, 148-185`), stats card Sleep/Wake (`src/ui/machine/StatsCard.tsx:43-74`) through `useMachineCommands` (`src/ui/machine/useMachineCommands.ts:62-78, 124-146`) | One command in flight app-wide (Stop always goes), never retried; failure kept as a sentence in the machine alert (`src/ui/machine/MachineAlerts.tsx:123-125`) until dismissed or the next command. Stop = `idle`; Sleep = `sleeping`; Wake = `idle`. |
| `PUT /api/v1/scale/tare` | `tareScale`, `src/api/client.ts:105-107` | Stats card Tare (`useMachineCommands.ts:143`); never before espresso (`src/api/types.ts:449`) | As above; `block_tare_during_shot` mapped (`src/api/http.ts:52-55`). |
| `POST /api/v1/machine/heartbeat` | `heartbeat`, `src/api/client.ts:97-100` | `createHeartbeat` (`src/api/heartbeat.ts:17-39`, ≥ 15 s apart, D15), fired on `pointerdown`/`keydown` capture (`src/ui/platform/useHeartbeatOnInteraction.ts:12-22`, mounted `src/ui/shell/AppShell.tsx:547-548`) | All failures swallowed; non-number `timeout` → `-1`; the value is never used. |
| `GET /api/v1/devices` | `getDevices`, `src/api/client.ts:102-104` | Telemetry start-up seed of machine/scale link (`src/api/telemetry.ts:387-395`) | Errors swallowed; `null` → `[]`; ignored once a devices frame has arrived. |
| `GET /api/v1/workflow` | `getWorkflow`, `src/api/client.ts:109` | Engine: dose and yield at bag open and template pick (`src/app/engine/engine.ts:535-543, 1433-1434`), machine-connected upload wait (`:1168-1196`), bag switch (`:1508-1525`), "machine runs another profile" check at start, every 30 s while visible and on return to view (`:213, 1533-1549, 1595-1622`). UI: Profile line, step names, stop-at-weight target (`src/ui/machine/useLoadedProfile.ts:48-139`, `src/ui/machine/loadedProfileModel.ts:33-108`) | Engine: unreachable → keep defaults / skip this look; bag switch failure → standing "Could not load …" banner with Retry. UI: a failed read keeps the last reading silently (`loadedProfileModel.ts:153-185`). |
| `PUT /api/v1/workflow` (profile + context) | `updateWorkflow`, `src/api/client.ts:110-111` via `activateProfile` (`src/api/workflow.ts:121-149`) via `engine.activate` (`src/app/engine/engine.ts:1078-1095`) | v1 on template pick (`:1416-1502`), Confirm of a profile change (`:1670-1806`), Undo (`:1821-1864`), Retry (`:1624-1641`), bag switch (`:1508-1525`) | Refused locally while a shot runs, when `targetYield` is not a non-negative number, or when any of the ten profile keys is missing. Response profile compared with what was sent (`findProfileMismatch`, `src/api/workflow.ts:94-109, 143-147`) → `activation_mismatch` error. Failures → chat notice + standing banner with Retry; Confirm keeps the proposal open. |
| `PUT /api/v1/workflow` (context only) | same | Grinder id/model/setting (`engine.ts:593-606`, outbox key `grinder`, D54/D62/D64); dose change (`engine.ts:1741-1743`) | Grinder: outbox retry every 30 s and on reconnect/shot; one "can't be reached" notice; dropped when a later activation carries it (`:1088`). Dose: error banner, proposal stays open. |
| `POST /api/v1/machine/profile` (D55 "barrier") | `loadProfileOnMachine`, `src/api/machineProfile.ts:65-83` (own transport, 20 s) | `engine.confirmOnMachine` (`src/app/engine/engine.ts:1103-1130`) after every activation, only while `ws/v1/devices` says the machine is connected; posts the profile **exactly as Decaid returned it** from the PUT | 200 → `loaded`; **404/405 → `unsupported` → barrier disabled for the session, loads are "assumed"** (`engine.ts:303-304, 1105-1106, 1118`); `not_connected` → `waiting` (re-tried on machine connect, `:1168-1196`); 503/504/409/timeout → sentences (`machineProfile.ts:44-58`) → `failed` + "Retry" banner. |
| `POST /api/v1/profiles` | `createProfile`, `src/api/client.ts:121-138` (fills `version`, `target_volume`, `target_volume_count_start`, `tank_temperature` if absent) via `createProfileVersion` (`src/api/workflow.ts:159-169`) | v1 under the template's bundled Decaid default (`recordV1`, `engine.ts:1407-1414`, ids at `src/coach/templates/index.ts:81, 141, 223, 286, 335`); later versions after activation, parent = previous version's Decaid id (`engine.ts:1707-1716`) | v1: a 400 → retried without `parentId`; **any other error, including a TypeError from an unexpected response body, aborts v1's activation** (`engine.ts:1445-1456`). vN: swallowed ("library only"). Dedupe detected by title/parent mismatch → note (`workflow.ts:167`, `engine.ts:1451`). |
| `GET /api/v1/shots/latest` | `getLatestShot`, `src/api/client.ts:143` | `fetchShot` when the shot ended without a `shotId` (`engine.ts:1246-1247`) | Retried inside `fetchShot`. |
| `GET /api/v1/shots/{id}` | `getShot`, `src/api/client.ts:144` | After every finished shot (`fetchShot` → `creditShot`, `engine.ts:1239-1391`, then `summarizeShot`); coach query tools (`shotSource`, `engine.ts:668-687`); re-read of notes before writing taste (`engine.ts:620-628`) | `fetchShot`: 6 tries, 0.5 → 8 s doubling (~15 s), progress notice (D65), then a warning and a standing "Retry" banner. Query tools: error becomes an error `tool_result` for the model (`src/llm/runner.ts:64-70`). Notes read: failure → outbox retry. |
| `PUT /api/v1/shots/{id}` | `updateShot`, `src/api/client.ts:145-146` | Taste line in `espressoNotes` + `annotations.extras.cafai` (D61, `engine.ts:644-658`, `src/app/engine/shotNotes.ts:39-68`); stars → `enjoyment = stars × 2` (`engine.ts:630-633, 1866-1876`) | Outbox key `shot:<id>` (`src/app/engine/outbox.ts`), retried every 30 s, on reconnect and after the next shot; **silent**; in memory only (lost on reload). Response ignored. |
| `GET /api/v1/grinders[?includeArchived=true]` | `listGrinders`, `src/api/grinders.ts:117-124` (own transport) | Settings grinder picker (`src/ui/settings/SettingsScreen.tsx:266-281`) | 404 (older Decaid) → empty list (`src/ui/settings/grinderPicker.ts:35-37`); other errors → "unavailable", free-text fields. |
| `GET /api/v1/grinders/{id}` | `getGrinder`, `src/api/grinders.ts:130-133` | Engine background read of the linked grinder's steps (D62): at start, with every shot, on return to view, on settings save (`engine.ts:555-581, 1929, 1939, 1620, 2032`) | Failure keeps the last answer; 404 → `null` = "no longer in Decaid's library" (an older Decaid without the route reads the same way). |
| `GET /api/v1/store/cafai?full=1` (+ `If-None-Match`) | `kv.getAll`, `src/api/kv.ts:43-52` | Mirror restore at boot (`src/storage/index.ts:118-128`, `src/app/createServices.ts:32-35`), the "empty store" gate before the first push (`src/storage/index.ts:83-98`), and once per session to learn what Decaid holds (`src/storage/mirror.ts:398-409`) | Restore never throws. Gate failure blocks every push and retries (15 s doubling to 5 min, `mirror.ts:47-48, 388-396`). **A non-object body is coerced to `{}` ("no backup")** (`kv.ts:50`). ETag is never actually sent by the mirror (no caller passes one). |
| `POST /api/v1/store/cafai/{key}` | `kv.set`, `src/api/kv.ts:59-74` | Debounced mirror push (2 s) of settings, bags, versions, iterations (without series), conversations (`mirror.ts:178-208, 411-466`); also on page hide (`createServices.ts:59-63`) | Per-key failure → `lastError` + retry. `keepalive` when < 60 KiB. `null`/`undefined` → DELETE instead. **`lastError`/`lastPushAt` are not shown anywhere in the UI.** |
| `DELETE /api/v1/store/cafai/{key}` | `kv.delete`, `src/api/kv.ts:76-78` (404 tolerated) | Mirror removes stale pages / conversations (`mirror.ts:439-448`) | Same as above. |

### 1.3 WebSocket channels

All six are opened at start (`src/api/telemetry.ts:37-45, 423-433`): one socket per channel, reconnect only after a close/error with backoff 1 s → 30 s that resets on open (`:47-48, 296-304`), reconnect at once when the page becomes visible (`:378-385`), and a machine-socket watchdog that reopens it after 20 s of silence **only while devices says the machine is connected** (`:49-50, 359-368`). Malformed JSON or frames are dropped (`:340-354`). The only socket failure the user ever sees is the devices socket: "Can't reach Decaid. Trying again…" after 2.5 s (`src/ui/machine/MachineAlerts.tsx:29, 114, 131-132`).

| Channel | Parser | Consumers |
|---|---|---|
| `/ws/v1/machine/snapshot` | `parseMachineFrame`, `src/api/frames.ts:60-78` (needs `timestamp` string + `state.state` string; numbers default to **0**) | Readouts (`src/ui/machine/MachineStatus.tsx:99-173`), state line, control model (`src/ui/machine/commands.ts:72-101`), alerts for `error`/`needsWater` (`MachineAlerts.tsx:115-118`), live samples → shot graph and timer (`src/api/telemetry.ts:174-185`, `src/ui/machine/shotTrace.ts:68-76`, `src/ui/machine/shotBuffer.ts`), shot detection fallback when no `shotState` frame was ever seen (`telemetry.ts:215-227`). |
| `/ws/v1/scale/snapshot` | `parseScaleFrame`, `frames.ts:41-57` (`status` frame vs `weight` frame) | Scale readout, `scaleConnected`, graph weight series, Tare enablement, proposal context (`engine.ts:732`). |
| `/ws/v1/devices` | `parseDevicesFrame` + `deviceConnections`, `frames.ts:80-149` | **Sole source of `machineConnected`/`scaleConnected`** (machine = `type 'machine' && state 'connected'`; scale excludes `connectionRole 'auxiliary'`) and of `connectionError`. Gates every control, the barrier, "not connected" alert; `profileUploadFailed` → "machine did not take" notice (`engine.ts:1949-1958, 1046-1055`); reconnect → outbox flush and upload wait (`:1960-1966`). |
| `/ws/v1/machine/shotState` | `parseShotStateFrame`, `frames.ts:151-177` | Shot lifecycle (`telemetry.ts:202-213`: start on `preheating`/`pouring`, finish on `finished`/`idle`, `decision.kind 'stop'` → `stopReason`, `shotId` = record id) → engine `handleShotFinished`, shot focus (`src/ui/shell/useShotFocus.ts:108`), Profile line re-read (`useLoadedProfile.ts:81-83`); `stopping`/`finished` timestamp stops the live clock (`shotTrace.ts:40-41, 93-99`, `shotBuffer.ts:149-158`). |
| `/ws/v1/machine/waterLevels` | `parseWaterLevelsFrame`, `frames.ts:180-183` (`refillLevel` defaults to 0) | Water readout and "Refill" alert (`src/ui/machine/format.ts:97-104`, `MachineStatus.tsx:163-167`, `MachineAlerts.tsx:116-120`). |
| `/ws/v1/machine/shotSettings` | `parseShotSettingsFrame`, `frames.ts:185-206` (all eight numbers or nothing) | Stored in telemetry state only; **no consumer**. |

### 1.4 KV store: namespace and keys

Namespace `cafai` (`src/storage/mirror.ts:38`). Keys (`mirror.ts:19-29`): `meta` (`{schemaVersion: 1, appVersion, updatedAt, pages, skipped}`, written last), `settings`, `bags`, `versions`, `iterations` (summaries without `series`), `bags.N`/`versions.N`/`iterations.N` pages above 256 KiB, `conv.<bagId>` (skipped above 512 KiB). Values capped at 1 MiB − 4 KiB (`:45-46`, Decaid's 413 limit). Keys are restricted client-side to `[A-Za-z0-9._~!$&'()*+,;=:@-]` because Decaid does not URL-decode them (`src/api/kv.ts:18-26`) and to `[a-z0-9._-]{1,200}` by the mirror (`mirror.ts:87-100`). The API key is never written; anything containing it is redacted (`mirror.ts:13-17, 181`). Restore validates every record with zod (`mirror.ts:233-259`, `src/storage/schema.ts:117-170`). CafAI never reads other namespaces (no DYE2 integration).

### 1.5 Workflow tagging, shot annotations, Visualizer

- Every activation writes `context.extras.cafai = {versionId, bagId}` and clears foreign context fields with explicit `null`s (`coffeeName`, `coffeeRoaster`, `beanBatchId`, grinder fields) (`engine.ts:461-489`). The tag is read back by `taggedVersionId` (`engine.ts:217-223`) and `readLoadedProfile` (`loadedProfileModel.ts:16-17, 33-43`).
- Shot annotations written: `espressoNotes` (CafAI's own line, merged with a person's notes, `shotNotes.ts:54-68`), `extras.cafai` (taste, version, stars), `enjoyment` = stars × 2 on Decaid's 0-10 scale (`engine.ts:630-633`).
- **Visualizer:** no integration. The only link is the comment that Decaid's Visualizer upload shows enjoyment × 10 (`engine.ts:631`); CafAI relies on Decaid uploading shots itself.

### 1.6 Client surface that exists but is not used in production

`getSettings` (`client.ts:77`), `getCapabilities` (`:85-89`), `listProfiles` (`:113-119`), `getProfile` (`:120`), `updateProfile` (`:139`), `listShots` (`:141-142`), `scanDevices`/`connectDevice`/`connectKind` (`:150-177`), `kv.list`/`kv.get` (`kv.ts:38-41, 54-57`), `describeFailedConnect` (`src/api/devices.ts:18-27`). They are exercised only by tests and by the hand-written fake client (`src/ui/testing/fakeServices.ts:172-199`).

### 1.7 Decaid features CafAI does not touch

No device scan/connect UI; no steam/hot-water/flush **settings** (workflow `steamSettings`/`hotWaterData`/`rinseData` and `POST /machine/shotSettings` are never written; only the start commands); no `gatewayMode`/`blockOnNoScale` check (recommended in `docs/verified/02-api.md:832`, `getSettings` unused); no Bengle detection via capabilities; no display/brightness/wake-lock; no DYE2 data; no beans/batches; no Visualizer.

---

## 2. Wire types and how they are checked

### 2.1 Definition

- `src/api/types.ts` (529 lines) is hand-written from `docs/verified/02-api.md`, with the rule "the Dart code wins where the OpenAPI/AsyncAPI specs drift. Enums are open" (`:1-17`). Enums are open unions `… | (string & {})` (`:46, 60, 144, 153, 156, 169-170, 179, 195, 288`). The profile shape comes from the coach (`ProfileJson`, `src/coach/types.ts`; `WireProfile`, `types.ts:249-250`).
- `openapi-typescript@7.13.0` is a devDependency (`package.json:65`) and pins the TypeScript version (`DECISIONS.md:35-37`, D5), but **no script or file uses it**; no types are generated from `assets/api/rest_v1.yml` or `websocket_v1.yml`.
- zod is used for CafAI's own data (`src/storage/schema.ts`) and the LLM tool contract (`src/coach/contract.ts`); **no Decaid payload has a zod schema**.

### 2.2 Payloads with runtime validation

| Payload | Check | Where |
|---|---|---|
| All six WebSocket channels | Hand-written guards; malformed → `null` → frame dropped | `src/api/frames.ts`, `telemetry.ts:231-280` |
| `GET /machine/state` | Re-parsed with `parseMachineFrame` | `telemetry.ts:402` |
| `GET /devices` | `deviceConnections` guard; `null` → `[]` | `client.ts:103`, `frames.ts:142-149` |
| Heartbeat | `typeof timeout === 'number'` else `-1` | `client.ts:99` |
| Capabilities (unused) | string filter | `client.ts:86-88` |
| Grinders | `parseGrinder` (needs `id` + `model`; drops malformed optional fields; `settingType` `preset`/`values` → preset, anything else → numeric) | `src/api/grinders.ts:86-110` |
| KV list / full map | string filter / plain-object check (else `{}`) | `kv.ts:40, 50` |
| Error bodies | `asErrorBody` keeps only string `error/message/details/type/st` | `http.ts:57-65` |
| KV mirror contents (CafAI's own records stored in Decaid) | zod per record; bad records dropped one by one | `mirror.ts:212-259`, `schema.ts:101-182` |
| Workflow PUT response profile | Semantic read-back against the sent profile (not a schema) | `workflow.ts:94-109, 143-147` |
| Workflow in the Profile line | `typeof` guards on `profile.title`, `steps`, `context.extras.cafai`, `context.targetYield` | `loadedProfileModel.ts:33-58, 105-108` |
| Shot record (for the summary) | Field-by-field tolerant readers (`toNumber`, `toText`, `positive`) | `src/coach/summary/analysis.ts:45-102`, `summarize.ts:45, 207-243` |
| Profiles for hashing | `parseDecaidProfile` (Decaid-exact; throws `ProfileError`), callers catch | `src/coach/profile.ts`, `profileId.ts:88-90`, `engine.ts:491-497, 1552-1560` |
| `__DECENT_HOST__.version` | string or finite number | `host.ts:89-95` |

### 2.3 Payloads trusted blindly

`requestValue<T>`/`requestJson<T>` is a generic cast of `JSON.parse` (`src/api/http.ts:202`); there is no shape check behind these types.

| Payload | What CafAI reads without checking |
|---|---|
| `BuildInfo` (`client.ts:76`) | `fullVersion`, `version` (display only) |
| `MachineInfo` (`:79`) | `GHC` (compared `=== true`, so effectively guarded) |
| `Workflow` from GET and PUT (`:109-111`) | `context.targetDoseWeight` / `targetYield` (`engine.ts:538-539`, no type check; `knownDose` guards later, `src/coach/dose.ts:21-24`), `profile.title` (`engine.ts:511, 521, 1315`), `profile` passed verbatim to the barrier (`:1117, 1185`) and to the hash (`:493`) |
| `ProfileRecord` from POST (`:137`) | `record.profile.title`, `record.parentId` (`workflow.ts:167`), `record.id` (`engine.ts:1450, 1713`) |
| `ShotRecordSummary` (`:143`) | `latest.id` |
| `ShotRecord` (`:144`) | `record.id` (`engine.ts:1311, 1351`), `record.workflow.profile` / `.context.extras` (`:1312-1326`), `record.annotations.espressoNotes` (`:627`) |
| PUT responses for shots/state/tare/KV | ignored |

### 2.4 Unknown enums, missing fields, extra fields, `null`

- **Unknown enum strings** are kept by the parsers (`frames.ts:7-10`) and shown humanized ("someFutureState" → "Some future state", `src/ui/machine/format.ts:52-60, 80`). But behaviour is **allow-listed**: starts are enabled only in `idle/schedIdle/heating/preheating` (`commands.ts:34`), **Stop only in nine known running states** (`commands.ts:21-31, 76, 91`; `MachineRow.tsx:153-169` renders no Stop otherwise); a shot starts only on `shotState.state` `preheating`/`pouring` and ends on `finished`/`idle` (`telemetry.ts:208-212`); the link is up only for `state === 'connected'` (`frames.ts:146-147`); `pendingAmbiguity` and `connectionRole` are restricted to known values (`frames.ts:89, 125`); unknown grinder `settingType` → numeric (`grinders.ts:95`).
- **Missing fields:** machine numbers → `0` (shown as "0.0 °C", not a dash, `frames.ts:34, 67-76`); scale `weightFlow` → 0, `battery`/`timerValue` → null; water `refillLevel` → 0 (refill alert never fires); device `name` → id; shotState booleans → false; REST objects read with optional chaining where the engine expects absence (`record.workflow?.profile`, `workflow.context?.…`, `record.annotations?.…`).
- **Extra fields:** frame parsers copy only known keys; REST objects carry extras through untouched (the barrier re-posts Decaid's own profile, so a new Decaid profile key round-trips). Hashing drops unknown profile keys as Decaid did at `a45961b`.
- **`null` bodies:** valid for `getLatestShot`, `getDevices` (→ `[]`), KV miss, state/tare/barrier; any route read with `requestValue` (info, machine info, workflow GET/PUT, profile POST, shot GET/PUT) throws "Decaid sent an empty reply."

### 2.5 If Decaid renamed a field or changed its type

| Payload / field | Effect in CafAI | Loud or silent |
|---|---|---|
| devices `devices[]`, `type: 'machine'`, `state: 'connected'` | `machineConnected` never true: "Not connected" everywhere, all controls disabled, barrier skipped, uploads "waiting" | Loud, total |
| shotState `state` vocabulary, `event` | No shot ever starts or finishes once any frame parsed (machine-state fallback is disabled after the first shotState frame, `telemetry.ts:146, 203, 218`) → no shot record fetched, coach never hears about shots, graph never resets | **Silent** |
| shotState `shotId` | Falls back to `GET /shots/latest` | Degraded |
| shotState `decision.kind`/`reason` | `stopReason` lost from the lifecycle event | Silent, minor |
| machine `timestamp` (e.g. epoch number) or `state` object | Every machine frame dropped: no readouts, no live graph | Loud-ish (dashes) |
| machine numeric fields (`groupTemperature`, `pressure`, …) | Shown as 0, plotted as 0 | **Silent wrong values** |
| machine state names (`espresso`, `sleeping`, `idle`, …) | Starts disabled ("busy"); no Stop button for an unknown running state; GHC hint unaffected | Loud-ish; Stop loss is a safety concern |
| scale `weight` / `status` | Frames dropped; weight "—" | Loud-ish |
| waterLevels `currentLevel` / `refillLevel` | Dash / refill alert never fires | Silent for `refillLevel` |
| workflow `profile` key or 10-key shape, `context.targetYield` | Activation read-back fails (`activation_mismatch`) → every load refused with a banner; Profile line blank | Loud |
| workflow profile normalisation (e.g. `version` coerced, `weight: null` → `0`, rounding) | `findProfileMismatch` fails every activation | Loud (blocks all loads) |
| workflow `context.extras` merge semantics | Tag lost → "This bag" mark and ran-version checks fall back to content only | Silent, degraded |
| POST `/profiles` response (`profile`, `id`, `parentId`) | `record.profile.title` TypeError → v1 activation aborted; vN library lineage silently lost | Loud for v1 |
| `/machine/profile` route removed or renamed | 404 → `unsupported` → loads "assumed" without confirmation for the session | **Silent downgrade** |
| shot record `workflow` | `creditShot`'s "machine ran another profile" guard is skipped (`engine.ts:1312`): every shot credited to the active version | **Silent data corruption** |
| shot record `measurements[].machine.timestamp`/fields | Summary empty or zeros (duration 0), coach advice based on nothing | Silent |
| shot record `annotations.espressoNotes` type | `mergeNotes` calls `.trim()` on a non-string → TypeError → outbox retries forever | **Silent** |
| shot `enjoyment` range/validation | PUT 400 → outbox retries forever | **Silent** |
| KV `?full=1` shape (array, `null`, string values) | Coerced to `{}` → "no backup"; on an empty device the first push **overwrites `bags`/`versions`/`iterations`/`settings` with empty lists** | **Silent data loss** |
| KV namespace read answering 404 (as the spec says for misses) | Gate never passes on a fresh install → backups never written | **Silent** (`lastError` not shown) |
| KV miss semantics (200 null ↔ 404) | Both tolerated | Safe |
| grinder `settingSmallStep`/`settingValues` | Steps "none": coach says which way, not how far | Silent, graceful |
| grinder route removed | Picker shows an empty list; linked grinder reads as deleted | Silent, graceful |
| error text "not connected" | `not_connected` code lost: barrier reports `failed` instead of `waiting` | Loud but wrong |
| policy `type` strings | Generic message from `details` | Loud, fine |
| `BuildInfo` fields | "version unknown" | Silent, harmless |
| `MachineInfo.GHC` | Start buttons shown on a GHC machine | Silent UX |

---

## 3. The Decaid mock and the contract picture

### 3.1 How the mock runs

- **Browser:** an MSW service worker. Handlers are registered in the order Decaid, the scripted coach, then a plain-text 404 fallback for any other `/api/*` (`mock/browser.ts:76-96`; `mock/decaid/handlers.ts:358-364`). It is loaded only in mock mode (`src/main.tsx:73-116`; `mock/plan.ts:64-74`). Production builds contain no mock and no worker (`vite.config.ts:11-13, 28-48`; checked by `scripts/release-zip.mjs:52-68`).
- **Vitest:** `setupServer` (`mock/node.ts:28-42`).
- **Demo build:** no HTTP at all. `mockDecaidPort` calls `MockDecaid` methods directly, so status codes and `http.ts` error mapping are skipped (`mock/demo/decaidPort.ts:18-45`).
- **Routes:** every route CafAI calls is implemented, and WebSocket paths match the client exactly (`mock/decaid/ws.ts:17-24` vs `src/api/telemetry.ts:37-44`). Each channel replays its latest state on connect (`ws.ts:31-47`). No client call is unmocked; the settings page is only navigated to.

### 3.2 Where responses and frames come from

- **Copied from fixtures at start-up:** `/info`, machine info (GHC overridden), the first machine snapshot (fresh timestamp), shot settings, water levels, the workflow, the example profile records and shot, device names/ids/`charging`, and two error bodies (`mock/decaid/state.ts:341-372, 426`; `handlers.ts:140, 150, 175`).
- **Hand-written:** devices state, scale frames, the first idle shotState, the seeded grinders and every other error body (`state.ts:352-354, 376-388, 420-436, 556-559`; `mock/decaid/grinders.ts:35-82`).
- **Ports of Decaid's Dart code at `a45961b`:** profile parse and hash (`mock/decaid/profiles.ts:130-180`), workflow normalisation and the targetYield rule (`mock/decaid/workflow.ts:77-161`), deep merge (`mock/decaid/json.ts:16-24`), the barrier behind a FIFO write queue with an 800 ms upload (`mock/decaid/machine.ts:1-28, 105-151`).
- **Generated:** the shot player makes 5 Hz machine and scale frames, shotState events and the saved ShotRecord (`mock/decaid/shotPlayer.ts:1-21, 256-270, 719-746, 789-812`).
- **Fixtures vs examples:** all 23 JSON files in `mock/fixtures/` are byte-identical to `docs/verified/examples/` (`diff -rq` shows only `_README.md`, `crema.ts`, `index.ts`). Nothing enforces this. **Seven fixtures are referenced nowhere:** `error`, `heartbeat`, `kvGet`, `scaleStatusWs`, `shotsList`, `shotUpdateRequest`, `workflowPutRequest`. Fixtures are cast, not type-checked (`mock/fixtures/index.ts:54-60`).
- **Provenance of the examples** (`docs/verified/examples/_README.md`): generated by one throwaway script from Decaid's serializers at `a45961b` and sanity-checked against real 0.8.6+2801 captures. The only real capture is `build-info.json` (with `localIp` added). There is no regeneration or sync procedure. `mock/fixtures/crema.ts` holds Crema's live 0.8.4/0.8.6 payloads; tests only.
- **Static where Decaid varies:** `/info` is always 0.8.6+2801; capabilities always `[]`; settings a hand-written default (`state.ts:259-272, 537-540`); shotState always `scaleLost:false`, `machineHasAutonomousSAW:false` (`shotPlayer.ts:266-267`).
- **Error paths only by injection:** 503/504/409 on the barrier and 429/503 on GETs come only from `failNext` (`state.ts:82-94, 976-990`). 405 is never produced (the barrier's "older Decaid" is always a 404, `handlers.ts:191`). `profileUploadFailed` is raised only by hand (`state.ts:157-158, 442-453`).
- **URL switches** (`mock/decaid/urlOptions.ts:17-34`; `mock/browser.ts:13-33`): `mockSpeed`, `mockMachine=0`, `mockScale=0`, `mockGhc=1`, `mockExamples=0`, `mockUploadMs`, `mockGrinders=0`, and `mockNoMachineProfile=1`, the only "older Decaid" switch. `mockDecaid=0` turns the Decaid mock off (`mock/plan.ts:7-9, 68`). There is no switch for a Decaid without shotState, without the grinder routes, or with an older `/info`.

### 3.3 Contract checks

- **None against Decaid.** No test compares the mock or `types.ts` with Decaid's OpenAPI/AsyncAPI specs or with a running Decaid. The specs exist only in the gitignored `.ref/decaid` clone (`.gitignore:20-22`), so CI cannot see them. `openapi-typescript` is unused (§2.1). RESEARCH.md proposed "MSW contract tests against rest_v1.yml" (`docs/RESEARCH.md:104, 319`); never built.
- **Mock and client check each other, not Decaid:** the mock imports CafAI's own `src/api/types.ts` (`mock/decaid/state.ts:11-30`).
- **Mock-vs-example tests are partly circular:** the seeded workflow and shot equal the fixtures they were seeded from (`mock/decaid/state.test.ts:42-44, 62-67`); `getInfo` equals the fixture (`src/api/client.test.ts:221`). The meaningful one is the hash port reproducing `profile-record.json`'s id, metadataHash and compoundHash (`mock/decaid/profiles.test.ts:116-136`; `src/coach/profileId.test.ts:8-35`). No test compares generated frames or records with the examples field by field.

### 3.4 How the tests reach the Decaid boundary

- **`src/api` unit tests** (`npx vitest run src/api`: 13 files, 172 tests, pass): `client.test.ts` is half hand-stubbed fetch (`:18-208`) and half every method against the MSW mock, with unhandled requests failing the test (`:212-354`). `telemetry.mock.test.ts` runs the real store and client through a whole shot, a machine drop and reconnects (`:22-91`). `frames.test.ts` parses fixtures and Crema's live payloads (`:59-66`). `http`, `machineProfile`, `heartbeat`, `host`, `time` use hand-written stubs. Older-Decaid cases: `machineProfile.test.ts:66`, `grinders.test.ts:87-100`, `telemetry.test.ts:473` (no shotState frames).
- **Parsers on real data:** `summarizeShot` and the analysis run on the verified example and on real anonymised 0.8.6+2801 shots from decaid-mcp, compared with decaid-mcp's golden values (`src/coach/summary/summarize.test.ts:5-191`; `analysis.test.ts:4-125`; `src/coach/__fixtures__/SOURCES.md:22-38`).
- **UI fake:** `src/ui/testing/fakeServices.ts` is a hand-written `DecaidClient` (version 0.9.0, model DE1Pro), kept in sync only by the TypeScript interface (`:137-213`).
- **e2e (Playwright):** 19 specs against a mock-mode production build served on :4174, "never real hardware" (`playwright.config.ts:3-4, 93-98`). They drive the in-page mock with URL switches and `window.__CAFAI_MOCK__` (`e2e/helpers.ts:9-10, 159-161`). Boundary specs: machine commands (`baseline.spec.ts:30-57`, `chat-first.spec.ts:117-125, 254-430`), barrier and older Decaid (`machine-load.spec.ts:37, 52`), barrier 504 (`verifier-fixes.spec.ts:63-74`), shot writes and a workflow 503 then retry (`decaid-writes.spec.ts:37, 71-105`), shot record 404s (`shot-search.spec.ts:43-67`), KV restore (`restore.spec.ts`), grinders, and nothing key-shaped reaching Decaid (`settings-privacy.spec.ts:67-115`).
- **Chromium 91:** `tools/chrome91/smoke.mjs` and `loop.mjs` load the mock build in puppeteer 9's Chromium 91 (`package.json:25, 28`); MSW mock only.
- **Live tests:** `npm run test:live` is the Anthropic API only (`vitest.live.config.ts:1-25`; `src/llm/live/anthropic.live.ts`). **No automated test targets a real Decaid or the simulator.**
- **Simulator:** `npm run dev:sim` = mock mode with `?mockDecaid=0`. Only the coach is scripted, inside the page's `fetch`; no service worker starts and WebSockets are untouched, so every Decaid call goes to a real Decaid (`package.json:14`; `src/main.tsx:95-100`; `mock/coachOnly.ts:21-50`; D74). The procedure in `docs/SIMULATOR.md` is manual.

## 4. Existing compatibility protections

| Protection | Where | What it covers | What it does not |
|---|---|---|---|
| Decaid version read | `GET /api/v1/info` / `__DECENT_HOST__.version`, Settings › About (`SettingsScreen.tsx:392-418`) | A human can see the version | **Never compared or gated; no minimum version anywhere** (manifest has no such field) |
| "Older engine" warning (D58) | `index.html` inline check (Chromium ≥ 91, syntax probe, 15 s fallback page); `AppShell.tsx:489-531` | Old WebView engines | Not about Decaid |
| Behavioural feature detection | Barrier 404/405 → `unsupported` (`machineProfile.ts:76-77`; `engine.ts:303-304, 1118`); grinder library 404 → empty list / null (`grinderPicker.ts:35-37`; `grinders.ts:130-133`); v1 parent 400 → retry without parent (`engine.ts:1407-1414`); no shotState frames → machine-state fallback (`telemetry.ts:215-227`); `GET /machine/info` failure → cached GHC (`useHasGhc.ts:25-27`); duplicate `manifest.json` for older Decaid builds (D11) | Missing routes and channels | Changed shapes; capabilities never used |
| Tolerant parsing | WebSocket parsers (`frames.ts`), shot summary (`analysis.ts`, `summarize.ts`), grinders, open enum types, humanized unknown states (`format.ts:52-60`) | Malformed frames never crash a screen | Drops or zero-fills silently |
| Read-back of the workflow PUT | `findProfileMismatch` (`workflow.ts:94-109, 143-147`) | Decaid changing the profile it stores, loudly | Context fields; Decaid changing normalisation blocks every load |
| Barrier (D55) | `machineProfile.ts`; `engine.ts:1103-1130` | Confirms the machine holds the profile | Silently off after one 404/405 |
| Resilience | Deadlines (`http.ts:17`); GET retry on 429/503 (`:185-191`); socket backoff, visibility reconnect, watchdog (`telemetry.ts`); outbox (D64); shot-record retries (D65); KV mirror retry (`mirror.ts:388-396`) | Outages and slowness | Persistent 4xx: retried forever, silently |
| Mock built from the source | `mock/decaid` ports Decaid `a45961b` behaviour | Quirks such as KV 200 null, deep merge, dedupe, barrier | Frozen at one commit; no re-sync procedure |
| CI | `.github/workflows/ci.yml`: typecheck, lint, unit (src, mock, scripts), build, release-zip validation, e2e; informational Chromium 91 job (`continue-on-error`). `release.yml`: tag = package version, typecheck, lint, unit, zip; **no e2e, no Chromium 91** | Regressions against the mock | **No Decaid compatibility step: no spec diff, no live or simulator run, no version pin** |
| Simulator path | `npm run dev:sim`, `docs/SIMULATOR.md` | Manual run against a real Decaid (0.8.7+2847 once) | Not automated; not in CI |
| Hardware plan | `docs/HARDWARE_TEST_PLAN.md` | Records Decaid version, DE1 model and firmware at the first session (`:28-29`); barrier timing, annotations, grind direction | Not yet run |

In short: protection is **behavioural and per feature** (handle a 404, tolerate a malformed frame). Nothing pins, compares or tests the shape of Decaid's answers against a live or newer Decaid.

## 5. Decaid facts CafAI depends on

"Doc" cites the verified write-ups (`docs/verified/01-platform.md` = 01, `02-api.md` = 02, `03-profiles.md` = 03), all read from Decaid `a45961b`. "If it changes" says what CafAI would do; **silent** marks the dangerous ones.

### 5.1 Platform (skin hosting, WebView, storage)

| # | Fact | Doc | Code relying on it | If it changes |
|---|---|---|---|---|
| P1 | REST + WS on port 8080 of the page's host; skin on its own port; CORS allows only standard headers + `If-None-Match` | 01:170-176; 02:93-95 | `host.ts:17, 44-60`; `http.ts:12-13, 143-148` | Every call fails: "Could not reach Decaid" / devices alert. Loud. |
| P2 | Manifest `skin-manifest.json` (then `manifest.json`), only `id/name/description/version`, all strings; `id` fixes folder → port → origin → storage | 01:27-47, 89-103 | `skin.config.json`, `scripts/release-zip.mjs` | Skin vanishes from the list or loses its storage. Loud at install. |
| P3 | GitHub release install takes the first `.zip` asset; updates keyed on tag; files replaced in place while the page runs | 01:64-69 | `.github/workflows/release.yml`; one entry chunk `vite.config.ts:104-108`; `#remend` alias `:76-84` | A lazy chunk could 404 (avoided). |
| P4 | Per-skin stable origin; a temporary origin with empty storage on port-bind failure; KV unaffected by origin | 01:91-103 | KV mirror + restore (`src/storage/index.ts:113-128`, `createServices.ts:32-35`) | — |
| P5 | Backgrounded page unloaded after 10 min and reloaded at `/?_=<ms>` (hash lost); no-store caching; no SPA fallback | 01:194, 215-216 | Route restore `src/app/App.tsx:13-25`; push on hide `createServices.ts:59-63`; engine persists as it goes (`engine.ts:23-25`); hash router `src/ui/router.ts` | Harmless if relaxed. |
| P6 | `window.__DECENT_HOST__` injected at document start (`{app, platform, version, build, commit}`), absent in a LAN browser | 01:159 | `host.ts:89-95, 105-116`; About; History export (`HistoryScreen.tsx:462-464`) | "inside Decaid" misdetected; version unknown. Mostly silent, low impact. |
| P7 | `window.decentApp.exitToDashboard()` from injected `/__decent/skin-api.js` | 01:142, 157-158 | `host.ts:117-127` | Exit falls back to the settings URL. Safe. |
| P8 | Settings UI at `/api/v1/plugins/settings.reaplugin/ui?backName=…`; only `http://localhost:8080/api/v1/plugins/*` opens in place | 01:164-168 | `host.ts:99-111` | Dead link (loud when tapped). |
| P9 | `POST /machine/heartbeat` (no body) restarts auto-sleep; `{timeout}` or −1 | 01:105-111 | `heartbeat.ts`, `client.ts:97-100`, `useHeartbeatOnInteraction.ts` | Machine sleeps on its timer while someone reads the coach. **Silent.** |
| P10 | KV: miss = 200 `null` (404 tolerated); POST stores any JSON ≤ 1 MiB → 200 `{}`; DELETE → 200 `{}`; `?full=1` → `{key: value}` map + ETag; keys/namespaces not URL-decoded; a JSON `null` body is stored as `"null"`; no auth; in backups; `cafai` unused elsewhere | 01:113-138, 226-232; 02:703-719 | `kv.ts:5-12, 19-26, 43-78`; `mirror.ts:38, 45-46, 87-100`; restore/gate `src/storage/index.ts:83-128` | `?full=1` shape change → treated as no backup and **overwritten on an empty device**; namespace 404 → first push blocked forever. **Silent.** |
| P11 | Admission control: 429/503 with `Retry-After: 1` | 01:185; 02:101-103 | `http.ts:121-129, 185-191` | — |
| P12 | WebView: UA `Decent`, some tablets on Chromium 91, no camera/mic, downloads go nowhere, console logs readable over the LAN | 01:189-196 | chrome91 target `vite.config.ts:53-62, 99-101`; engine warning (`index.html`, `AppShell.tsx:489-531`); History export copies instead (`HistoryScreen.tsx:462-464`) | — |

### 5.2 Telemetry and machine control

| # | Fact | Doc | Code relying on it | If it changes |
|---|---|---|---|---|
| T1 | Link state comes only from `ws/v1/devices`: machine = `type 'machine' && state 'connected'`; replayed on connect; machine sockets stay open and silent while the machine is away, then re-bind | 02:241-247, 324-331; 01:178-184 | `frames.ts:136-149`; `telemetry.ts:8-20, 248-261, 359-368`; all controls `commands.ts:73-78` | App-wide "Not connected". Loud. |
| T2 | Scale socket: `{status}` frames and weight frames; auxiliary scales marked `connectionRole` | 02:245, 262-273, 343 | `frames.ts:40-57, 147` | Weight disappears. Loud-ish. |
| T3 | `shotState` frames: `state` ∈ idle/preheating/pouring/stopping/finished, `shotId` = `ShotRecord.id`, latest frame replayed on connect, `decision.kind 'stop'` + `reason`, `timestamp` = the machine frame it stopped on | 02:244, 278-297 | `telemetry.ts:202-213`; `shotTrace.ts:40-41, 93-99`; `shotBuffer.ts:46-53, 149-158`; `engine.ts:1935-1947` | **Shots never detected (silent).** |
| T4 | Machine states: commands `espresso/steam/hotWater/flush/idle/sleeping`; `idle` stops and wakes; `sleeping` not `sleep`; `heating`/`preheating` never come from a DE1 | 02:129-196 | `types.ts:24-63`; `commands.ts:21-34, 64-70`; `format.ts:13-50`; `MachineRow.tsx:51-65` | Starts disabled; no Stop for an unknown running state. |
| T5 | Substates `preparingForShot/preinfusion/pouring/pouringDone/idle` frame a shot and the pour clock | 02:136-142, 166-176, 641-661 | `shotBuffer.ts:59-61, 127-147`; `summarize.ts:28-31, 104-140`; `format.ts:38-50` | Pour time wrong. Silent. |
| T6 | Snapshot fields and units; `targetFlow`/`targetPressure` 0 for the inactive pump; `profileFrame` 0-based and stale until the first step; snapshot rate variable (~3.7 Hz) | 02:144-159, 250-260 | `frames.ts:60-78` (missing → 0); `shotBuffer.ts:77-81`; `MachineStatus.tsx:146-173`; `loadedProfileModel.ts:66-98`; `summarize.ts:142-165` | Zeros shown. **Silent.** |
| T7 | Timestamps: telemetry, shotState, `ShotRecord.timestamp` local zone-less with µs; shot `createdAt/updatedAt` and devices UTC `Z` | 02:686; 01:— | `src/api/time.ts:1-67`; `src/coach/summary/time.ts`; `telemetry.ts:176`; `shotBuffer.ts:135, 154` | Numeric timestamps drop every frame; mixed zones misplace the stop. |
| T8 | Errors: `{error}`, `{error,message}`, `{details,type}`, `{error,st}`, plain-text 404/500; "DeviceNotConnectedException: machine not connected" | 02:725-737 | `http.ts:49-114`; `machineProfile.ts:13-20, 50-58, 80` | Generic messages; `waiting` becomes `failed`. |
| T9 | `PUT /machine/state/{s}` → 200 `null`; 400 `block_no_scale`; 500 on unknown name / no machine | 02:49, 178-196 | `client.ts:94-96`; `http.ts:52-55` | — |
| T10 | Decaid tares twice and starts the scale timer at espresso start, so a skin never tares for espresso | 02:344 | `types.ts:449`; tare only on demand | — |
| T11 | `GET /machine/info` → `GHC` boolean | 02:120-127 | `useHasGhc.ts:21`; `commands.ts:77-89` | Start buttons on a GHC machine. Silent UX. |
| T12 | Water levels in mm; refill when `currentLevel ≤ refillLevel` | 02:230 | `format.ts:97-104` | Refill alert silent. |
| T13 | Decaid's gateway mode is not `full` (else no tare, no stop-at-weight) | 02:832 | **not checked** (`getSettings` unused) | Shots overshoot the target yield silently. |

### 5.3 Workflow, profiles and the machine upload

| # | Fact | Doc | Code relying on it | If it changes |
|---|---|---|---|---|
| W1 | `PUT /workflow` deep-merges objects key by key, replaces arrays, drops unknown keys, answers the merged workflow; so the full ten-key profile is always sent | 02:386-432; 03:231 | `workflow.ts:1-15, 30-42, 134-141` | — (CafAI already sends everything) |
| W2 | Response profile equals what was sent after Decaid's normalisation (numbers, active pump axis, explicit nulls) | 02:396, 572-578 | `findProfileMismatch` `workflow.ts:53-109, 143-147` | Every activation refused (`activation_mismatch`). Loud, blocking. |
| W3 | `context.targetYield` is THE stop-at-weight target: a JSON number, 0 = off, `null`/string → 400; `profile.target_weight` ignored at run time | 02:391-394, 436-439 | `workflow.ts:130-133`; `engine.ts:457-469` | If `target_weight` regained authority CafAI still writes both (`03:596`). |
| W4 | `context` merges per field; explicit `null` clears; `extras` deep-merged per key | 02:434 | `engine.ts:475-487` (nulls to clear another skin's data; `extras.cafai` tag) | Tag or clearing lost. Silent. |
| W5 | The PUT waits for steam/water writes (hence 15 s) and the profile upload to the DE1 happens **after** the response; failure only as `profileUploadFailed` on devices | 02:397-402 | `client.ts:33-34`; `engine.ts:1045-1055, 1949-1958` | — |
| W6 | `POST /api/v1/machine/profile` is a barrier: same FIFO Bluetooth queue, 200 `null` after every write is acknowledged + a 500 ms guard (at once if equal); 500 not connected; 503 queue full/unavailable; 504 BLE timeout; 404 on older Decaid | **not in 02-api.md**; documented in `machineProfile.ts:1-21` (from `de1handler.dart`) | `machineProfile.ts:65-83`; `engine.ts:201-206` (`UPLOAD_GUARD_MS = 500`), `1103-1130`, `1216-1227` | Route gone → confirmations silently "assumed". **Silent.** |
| W7 | Shot records copy the workflow at the **end** of the shot, so no workflow PUT during a shot | 02:441 | `workflow.ts:44-49, 127-129`; `engine.ts:1084` | — |
| W8 | Profile wire format: JSON numbers (Dart doubles), `target_volume_count_start` int, `version` string, only the active pump key, `exit/limiter/weight` explicit `null`; required title, steps, `tank_temperature`, `target_volume_count_start` (0.8.6 also refused missing `version`/`target_volume`); Decaid range-checks nothing | 02:460-578; 03:5-117, 238-250 | `client.ts:121-138`; `src/coach/profile.ts` (`normalizeProfile`); bounds in `src/coach/validator.ts` | A new required field → 400 with a message. Loud. |
| W9 | Profile id = `"profile:" + sha256(sorted Dart-JSON of 7 fields)[0:20]` (title/notes/author excluded) | 02:509-537; 03:167-211 | `src/coach/profileId.ts`; `sameContent` `engine.ts:491-497`; mismatch key `:1552-1560` | Both sides are hashed by CafAI, so comparisons survive; bundled-default ids would stop matching (below). |
| W10 | Bundled defaults exist with ids `profile:7438cb…`, `59036f…`, `729d28…`, `372f1b…`, `1baa29…` (re-seeded; content change hides the old id) | 03:201-209, 233-236 | `src/coach/templates/index.ts:81, 141, 223, 286, 335`; `recordV1` `engine.ts:1401-1414` | 400 → v1 recorded without a parent. Graceful. |
| W11 | `POST /profiles` with existing content returns that record with 201 (old title, parent, visibility) | 02:547; 03:215 | `workflow.ts:151-169`; `engine.ts:1451` | — |
| W12 | Workflow profile has no id; CafAI identifies it by tag + title + content | 02:427-430 | `engine.ts:499-526`; `loadedProfileModel.ts:1-12, 110-113` | — |

### 5.4 Shots, annotations, grinders

| # | Fact | Doc | Code relying on it | If it changes |
|---|---|---|---|---|
| S1 | `GET /shots/{id}` → full record with `workflow` (incl. profile + context), `measurements[{machine, scale, volume}]` from preheat to the stop decision (stop frame not recorded), `annotations.actualYield` settled, `actualDoseWeight` = target dose, `stopReason` open set | 02:582-661 | `summarize.ts:5-22, 207-243`; `analysis.ts:63-102`; `engine.ts:1292-1391` | Renamed `workflow` → shots credited without the ran-version guard. **Silent.** |
| S2 | The record appears a few seconds after the shot; `/shots/latest` → summary or `null` | 02:637, 843 | `fetchShot` `engine.ts:1233-1265` (≈ 15 s budget) | A slower save shows "not saved yet" + Retry. Loud. |
| S3 | `PUT /shots/{id}` deep-merges; `annotations.extras` merged per key; `espressoNotes` replaced; `enjoyment` validated 0-10; `null` clears | 02:663-678 | `shotNotes.ts:5-8, 54-68`; `engine.ts:615-638` | Validation change → write retried forever. **Silent.** |
| S4 | Grinder library: `GET /grinders` (archived hidden unless `includeArchived=true`), `GET /grinders/{id}` 404 when missing; `settingType` numeric/preset, `settingValues`, `settingSmallStep/BigStep`; Decaid does not check `context.grinderId` exists | 02:692-699 | `grinders.ts:1-149`; `grinderPicker.ts:35-37`; `engine.ts:593-606` | Steps "none". Graceful. |

## 6. Known gaps, stubs and open questions

### 6.1 What has (not) been run against real Decaid

- **No real DE1 or Decent tablet yet:** "Everything in CafAI so far was verified against mocks built from Decaid's source; nothing has touched a real machine" (`docs/HARDWARE_TEST_PLAN.md:3-4`); "Nothing has touched a real DE1 or the real API" (`MORNING.md:342-343`; the `test:live` it mentions is the Anthropic API only, `vitest.live.config.ts:1-7`).
- **Real Decaid software ran once:** the Windows simulator, Decaid 0.8.7+2847, on 2026-10-05, full loop in coach-only mode, normal mode and inside Decaid's window (D74, `DECISIONS.md:521-535`; `docs/SIMULATOR.md:205-212`). Not tried there: the ZIP install, simulated tablet sizes, gateway modes with CafAI (`docs/SIMULATOR.md:210-212`). The simulator cannot test grind effects, group-head starts, slow or failed uploads, Chromium 91 or devices dropping (`docs/SIMULATOR.md:229-239`).
- **The mock claims to be 0.8.6+2801** (`mock/fixtures/build-info.json:6, 9`) while it implements `a45961b` behaviour (`mock/decaid/state.ts:4-9`).

### 6.2 Open questions in the planning docs

| Item | Where | Decaid dependency |
|---|---|---|
| Does the D55 barrier behave on a real DE1; how long does an upload take; group-head latch | `QUESTIONS.md:8-16`; `MORNING.md:355-356`; `DECISIONS.md:372-375`; `docs/HARDWARE_TEST_PLAN.md:86-135` | W6 |
| Fingerprint each shot's targets against the version (D55 option 2) | `QUESTIONS.md:40-45`; `MORNING.md:365-366` | S1 |
| Grinder direction (Decaid's library has none; CafAI assumes lower = finer, presets finest first) | `QUESTIONS.md:17-21`; D62 `DECISIONS.md:432-444`; `src/coach/grinder.ts:5-8` | S4 |
| v1 starting yields: Blooming v1 ends at 42-48 g on the mock and on the 0.8.7 simulator, so its 50 g stop never fires | `QUESTIONS.md:22-34`; `MORNING.md:230-233` | W3 |
| Enjoyment written only from stars | `QUESTIONS.md:35-39` | S3 |
| Start-up fallback of the engine check (15 s) never timed on a tablet | `QUESTIONS.md:46-49`; D58 `DECISIONS.md:404-406` | P12 |
| A dose changed in Decaid mid-bag is re-read only at bag open / template pick | `QUESTIONS.md:54-56`; `engine.ts:535-543, 988, 1433-1434` | W4 |
| Whether the WebView reports `prefers-color-scheme` | D82 `DECISIONS.md:640-642`; `docs/HARDWARE_TEST_PLAN.md:259-263` | P12 |
| Origin follows the install path: an iOS container move loses local storage and the key | `QUESTIONS.md:140-149`; `docs/verified/01-platform.md:327` | P4 |
| Chromium floor on shipping tablets unknown | `QUESTIONS.md:114-125`; `docs/verified/01-platform.md:326` | P12 |
| Platform open questions: safe-area insets, file input, CORS on uncaught 500s, Hive key limits, which release `a45961b` is, `clearAllCache`, nightly restart | `docs/verified/01-platform.md:324-337` | P1, P10 |
| API drift list: no positive upload signal (now D55), dedupe, 0.8.6 vs `a45961b` required fields, hash portability, timestamp zones, KV spec-vs-code, undocumented status codes, sample rate, enum lists, step limit | `docs/verified/02-api.md:860-907` | W2, W6, W8, W9, T7, P10 |
| Another skin rewriting `context.targetYield`; `target_weight` regaining stop-at-weight authority | `docs/verified/03-profiles.md:591-596` | W3 |

### 6.3 Known gaps and stubs

- **Writes waiting for Decaid are in memory only:** a reload drops pending grinder, notes and stars writes (D64, `DECISIONS.md:456-462`; `QUESTIONS.md:50-53`; `MORNING.md:349`; `src/app/engine/outbox.ts:15-17`).
- **A shot stopped during preheat** triggers up to six `GET /shots/{id}` 404s (`DECISIONS.md:682-690`; `MORNING.md:155-158`; `docs/HARDWARE_TEST_PLAN.md:193-208`).
- **Gateway Mode "Full"** does not stop at the target weight "and CafAI never stops a shot itself, so do not use Full" (`docs/SIMULATOR.md:194-200`). Not in DECISIONS.md and **not detected in code**: `getSettings` is never called, so `gatewayMode` and `blockOnNoScale` (`src/api/types.ts:380-386`) are never read, contrary to `docs/verified/02-api.md:832`.
- **No Bengle detection** via `GET /machine/capabilities` (`client.ts:85-89` unused), contrary to `docs/verified/02-api.md:833`.
- **Not built** (`MORNING.md:346-348`; `docs/ROADMAP.md:56-59`): steam and hot-water editors, device-connect screens ("the client has `connectKind()`"), a screensaver; Decaid beans and batches are not linked (only coffee name and roaster travel).
- **Another skin's `targetYield`:** the 30 s check compares the profile's title, content and tag (`engine.ts:520-526, 1533-1549`), not `context.targetYield`, so a yield rewritten behind CafAI's back is only visible as the Shot view's "of N g" (`loadedProfileModel.ts:105-108`); `docs/verified/03-profiles.md:594` recommends re-reading before a shot.
- **KV backup health is invisible:** `DecaidKvMirror.lastError`/`lastPushAt` (`src/storage/mirror.ts:304-312`) have no UI.
- **Barrier downgrade is invisible:** after one 404/405, loads are "assumed" for the rest of the session (`engine.ts:303-304, 1118`) with no notice that confirmation is off.
- **`ws/v1/machine/shotSettings` is subscribed but unused** (`telemetry.ts:43, 274-277`).
- **Code markers:** no TODO / FIXME / XXX / HACK anywhere in `src/` or `mock/`. Older-Decaid fallbacks are commented at `src/api/machineProfile.ts:20, 33-34`, `src/api/grinders.ts:9-13, 113-116`, `src/app/engine/engine.ts:303, 528, 1220`, `src/app/types.ts:160`, `src/ui/machine/useHasGhc.ts:26`, `src/ui/machine/loadedProfileModel.ts:118-126`. `src/api/client.ts:48`: device connection is "not covered yet" by the contract. Pins to `a45961b`: `src/coach/templates/index.ts:24-25` (`DECAID_COMMIT`), `src/coach/profileId.ts:4-17`, `src/coach/profile.ts:10`, `src/api/types.ts:4`.

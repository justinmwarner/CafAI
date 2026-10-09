# Decaid skin-facing platform audit (for CafAI)

- **Repo:** `.ref\decaid` (decentespresso/decaid), HEAD `af4e995` (2026-10-08, "fix(plugins): reject BigInt device payload values").
- **Baseline:** CafAI facts were verified at `a45961b` (2026-10-01). The clone is **shallow with `a45961b` as its boundary** (`git rev-parse --is-shallow-repository` = true, 41 commits), so history before `a45961b` cannot be inspected. `git log -S` attributes everything older to `a45961b`.
- **Method:** read-only. Docs, both specs, every handler under `lib/src/services/webserver/`, `lib/src/webui_support/`, `lib/src/skin_feature/`, `main.dart`/`app.dart` wiring, workflows. A script compared every route registered in the Dart handlers with the OpenAPI/AsyncAPI specs (`route_diff.js`, output `route_diff_af4e995.txt`; spec listing `spec_listing_af4e995.txt`, all in this folder).
- **Status legend used below:** **S** = in `assets/api/rest_v1.yml` (OpenAPI 3.0.3) or `assets/api/websocket_v1.yml` (AsyncAPI 3.1.0); **D** = only in prose docs (`doc/Api.md`, `doc/Skins.md`); **C** = code only.
- **Gap:** the two helper sub-agents (headless CI, plugin/Visualizer diffs) hit usage limits without reporting. Both areas were covered directly with targeted reads instead. Nothing was built or run, so every runtime claim comes from reading the code.

---

## 0. Headline findings

1. **Surface size.** 159 REST route registrations plus 15 WebSocket routes on `:8080`. Every one maps to the specs except for 3 explainable cases (catch-all routing, a CORS preflight, and one simulate-only debug route). There are 159 spec operations and 15 AsyncAPI channels (section 1.21).
2. **Only three JS bridges exist.** `window.__DECENT_HOST__` is a frozen identity object (`skin_view.dart:803-828`). `window.decentApp.exitToDashboard()` comes from an injected same-origin script (`webui_service.dart:96-105`). The account-proxy token is passed through a `<meta>` tag (`webui_service.dart:43-70`). There are **no** `addJavaScriptHandler` channels, no share bridge and no download handler. Everything else is plain REST/WS (searching `addJavaScriptHandler|callHandler` in `lib/` finds nothing).
3. **New this week:** live camera through `getUserMedia({video:true,audio:false})` with per-skin Ask/Allow/Deny consent (Android, iOS, macOS). Microphone requests are always denied. On Android, `<input type=file>` handling is now done by Decaid: ordinary picks use the system picker, and `capture` needs a native confirmation for every capture, images only (`skin_camera_*.dart`, `skin_view.dart:654-660`).
4. **No API versioning or compatibility policy.** Both specs say `info.version: 1.0.0`, and that value is unchanged across the visible history. There is no CHANGELOG; release notes are generated from merged PRs (`release.yml:808-833`). `GET /api/v1/info` returns the build (version/commit/branch), not an API version. CI does not lint the specs or check them against the code; 8 targeted unit tests pin individual schema fragments.
5. **Spec and doc drift is real** (section 3.5). Examples:
   - The machine-state enums in both specs disagree with the code: `schedIdle` is missing, the WS spec lists a nonexistent `transportMode`, and both specs (and Skins.md) spell `cleaingGroup` while the code emits `cleaningGroup`.
   - `PUT /scale/tare` with no scale returns **500**, but the spec and Skins.md say 404.
   - The KV store returns `200 null` / `{}` where the spec says 404 / 204 / `{deleted}`.
   - The legacy workflow fields are described three contradictory ways.
   - `/api/v1/webview/logs` is plain text although the spec says JSON.
   - Skins.md's `{"usb": true}` example actually turns the USB charger **off**.
6. **Changes `a45961b..af4e995` are additive for skins.** No endpoint, field or enum value was removed. A skin could notice:
   - the new `grinderBurrs` workflow/shot context field (with new Visualizer upload/back-sync behaviour);
   - optional `controls`/`surfaces` on `GET /api/v1/grinder/info`;
   - plugin route IDs are now percent-decoded once;
   - plugin scales can now fill `GET /api/v1/scale/info`;
   - camera and file-input behaviour.

   The only change with a realistic CafAI impact is `grinderBurrs`: CafAI clears foreign grinder context fields, but it cannot know about this new one (section 4.3).
7. **Headless CI is feasible.** Decaid's own PR CI already builds the Linux release bundle and launches it under `xvfb-run -a … --no-account` (`pr-checks.yml:284-342`). Simulated devices can be enabled two ways:
   - at compile time (`--dart-define=simulate=machine,scale`, which also unlocks `/api/v1/debug/*`);
   - at runtime through `POST /api/v1/settings {"simulatedDevices":[...]}`. This works even in a downloaded release build (`main.dart:702-711`).

   Releases publish Linux x64 and arm64 `.tar.gz` and AppImage files, with `-latest` aliases (`release.yml:322-452, 803-806`). `--skin-path` serves a skin folder directly (`cli_args.dart:40`, `main.dart:740-743`).

---

## 1. The complete skin-facing API surface

### 1.0 Cross-cutting conventions (all `:8080`)

| Topic | Behaviour | Source |
|---|---|---|
| Bind | REST+WS on `0.0.0.0:8080`. A failed bind shows a "port conflict" app instead of running without an API. | `webserver_service.dart:363-401`, `doc/AI_API_NOTES.md:247-301` |
| CORS | `shelf_cors_headers` with `Access-Control-Allow-Origin: *`. Exposed headers: `ETag, Location, Content-Disposition, Retry-After, X-Request-Id`. Allowed request headers: `Accept, Accept-Encoding, Authorization, Content-Type, DNT, Origin, User-Agent, If-None-Match`. The account-proxy path narrows the allowed origin to the skin origins. | `webserver_service.dart:134-140, 500-527, 590-632` |
| Response shape | **Bare JSON**, no envelope (`jsonOk(data)` = `jsonEncode(data)`). Many mutations answer `200` with body `null`. Errors are usually `{"error": "..."}`, sometimes `{error, st}` (stack trace), `{e, st}`, `{message}` or `{details, type}`. | `json_response.dart:7-72`; examples `de1handler.dart:713-716`, `devices_handler.dart:248`, `settings_handler.dart:81-83`, `de1handler.dart:843-846` |
| Admission control | `/api/` limits: 128 concurrent / 1024 per s globally, 32 / 256 per client, then `429` (per client) or `503` (global) with `Retry-After: 1`. WS upgrades: 128 open / 32 per client. `OPTIONS`, static and `/ws/` requests bypass the REST gate. | `doc/Api.md:27-44`, `doc/AI_API_NOTES.md:84-96`, `rest_v1.yml:15-22` |
| Body limits | "Control" bodies: 64 KiB / 10 s. "Ordinary": 1 MiB / 30 s. Over the limit → `413`; too slow → `408`. Workflow PUT: 1 MiB, at most 8 queued, 30 s queue wait → `503`. | `doc/Api.md:40-44`, `rest_v1.yml:23-32`, `workflow_handler.dart:15-18, 54-105` |
| Conditional GET | Strong `ETag` and `If-None-Match` → `304` on `GET /beans`, `/beans/{id}/batches`, `/grinders`, `/profiles`, `/shots`, and `/store/{ns}?full=1`. | `doc/Api.md:48-70, 552`, `json_response.dart:10-21`, `kv_store_handler.dart:12-14` |
| Path IDs | Opaque IDs (sensor IDs, scale IDs, and since `945f31f` plugin id/endpoint) are percent-encoded once by the client and decoded once by the server. Host-assigned UUIDs are unchanged. **KV namespace/key are NOT decoded.** | `opaque_path_component.dart:1`, `scale_handler.dart:96-102`, `sensors_handler.dart:20-54`, `plugins_handler.dart:292-293, 356-357`, `kv_store_handler.dart:8, 19-20`, `AGENTS.md` (Hard Rules) |
| Auth | None, except the account-proxy path (Bearer token). | `doc/Api.md:653-655`, `proxy_auth_middleware.dart` |

### 1.1 Machine (DE1 / Bengle)

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/machine/info` | Model, firmware version, serial, `GHC`, `extra` (e.g. `refillKit`) | S | `de1handler.dart:21, 807-811` |
| GET | `/api/v1/machine/state` | One `MachineSnapshot` (same shape as the WS snapshot) | S | `:22, 813-818` |
| PUT | `/api/v1/machine/state/{newState}` | Request a state. Any `MachineState` name is accepted (`byName`); `idle` bypasses the write queue. Returns `400 {type:"block_no_scale"}` when `blockOnNoScale` applies. | S | `:23, 820-857` |
| POST / OPTIONS | `/api/v1/machine/profile` | Upload a v2 profile JSON directly (outside the workflow); 200 `null`. The OPTIONS route is a hand-written CORS preflight. | S / C (OPTIONS) | `:24-35, 859-877` |
| POST | `/api/v1/machine/shotSettings` | Write shot settings. **All 8 fields are required** (section 3.5). | S | `:36, 879-898` |
| GET | `/api/v1/machine/capabilities` | `{capabilities:[...]}`: Bengle list, or `[]` on a DE1 | S | `:38-54` |
| GET / PUT | `/api/v1/machine/cupWarmer` | Bengle cup warmer (404 elsewhere) | S | `:56-127` |
| GET / PUT | `/api/v1/machine/cupWarmer/preheat` | Bengle scheduled pre-warm | S | `:128-189` |
| GET / PUT | `/api/v1/machine/ledStrip` | Bengle LED palette (PUT echoes the stored palette) | S | `:208-251`, `AI_API_NOTES.md:115-142` |
| POST | `/api/v1/machine/ledStrip/commit`, `/ledStrip/reset` | Compatibility no-op / re-read | S | `:252-274` |
| GET / PUT | `/api/v1/machine/scaleCalibration` | Bengle integrated-scale calibration | S | `:275-347` |
| POST | `/api/v1/machine/waterLevels` | Set `refillLevel` only; 202, empty body | S | `:348-375` |
| GET / POST | `/api/v1/machine/settings` | fan, usb (`"enable"`/`"disable"` on write, bool on read), flush/hot-water/steam flows, tankTemp, steamPurgeMode; POST → 202 | S | `:377-450` |
| GET / POST | `/api/v1/machine/settings/advanced` | Heater phases, idle temp, voltage, refill-kit override | S | `:452-535` |
| DELETE | `/api/v1/machine/settings/reset` | Reset machine settings | S | `:669-676` |
| GET / POST | `/api/v1/machine/calibration` | Flow estimation multiplier | S | `:536-572` |
| GET / PUT | `/api/v1/machine/calibration/{target}` | Sensor calibration: flow / pressure / temperature | S | `:573-668` |
| GET / POST / DELETE | `/api/v1/machine/firmware` | Firmware catalog; raw upload (NDJSON progress); cancel | S | `firmware_handler.dart:47-50` |
| POST | `/api/v1/machine/firmware/apply` | Managed firmware apply | S | `firmware_handler.dart:49` |
| POST | `/api/v1/machine/heartbeat` | User presence → `{timeout: secondsRemaining}`, or `-1` when presence tracking is off or there is no machine | S | `presence_handler.dart:15, 24-31`, `presence_controller.dart:104-115` |

If no machine is connected, every `withDe1` route returns **500** with `{"error":"DeviceNotConnectedException: machine not connected"}` (`de1handler.dart:682-687, 713-714`, `errors.dart:22-24`).

### 1.2 Workflow, profiles

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/workflow` | Current workflow: `{id, name, description, profile, context?, steamSettings, hotWaterData, rinseData, machine?}` | S | `workflow_handler.dart:45, 49-52`, `workflow.dart:95-107` |
| PUT | `/api/v1/workflow` | Deep-merge patch, FIFO-serialized, writes to the machine, returns the resulting workflow. Explicit `null` for `steamSettings`, `context` or `context.targetYield` → 400. Non-numeric `targetYield` → 400. 409/429/503/408/413 as documented. | S | `:46, 54-221`, `doc/Api.md:286-322`, `doc/AI_API_NOTES.md:391-490` |
| GET | `/api/v1/profiles` | List (`visibility`, `includeHidden`, `parentId`); ETag | S | `profile_handler.dart:10, 34-71` |
| GET | `/api/v1/profiles/defaults` | Bundled default profiles | S | `:12` |
| GET | `/api/v1/profiles/export` | Export all profiles | S | `:13` |
| GET / PUT / DELETE | `/api/v1/profiles/{id}` | Get / update (tri-state metadata; `profile:null` → 400) / soft-delete | S | `:15-21` |
| POST | `/api/v1/profiles` | Create (content-hash id); 201 | S | `:17` |
| PUT | `/api/v1/profiles/{id}/visibility` | visible / hidden / deleted | S | `:23` |
| GET | `/api/v1/profiles/{id}/lineage` | Version tree | S | `:25` |
| POST | `/api/v1/profiles/import` | Batch import | S | `:27` |
| POST | `/api/v1/profiles/restore/{filename}` | Restore a bundled default | S | `:29` |
| DELETE | `/api/v1/profiles/{id}/purge` | Permanent delete (not defaults) | S | `:31` |

`WorkflowContext` fields: `targetDoseWeight`, `targetYield`, `targetWaterVolume`, `grinderId`, `grinderModel`, **`grinderBurrs` (new)**, `grinderSetting`, `beanBatchId`, `coffeeName`, `coffeeRoaster`, `finalBeverageType`, `baristaName`, `drinkerName`, `extras`. Null fields are omitted on output (`workflow_context.dart:64-82`). The spec matches (`rest_v1.yml:8371+`, patch schema `:8270+`).

### 1.3 Shots and steam history

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/shots` | Paginated `{items,total,limit,offset}` without measurements. Filters: `grinderId`, `grinderModel`, `beanId`, `beanBatchId`, `coffeeName`, `coffeeRoaster`, `profileTitle`, `search`, `order=asc\|desc`. Legacy `ids=` returns a **plain array with measurements**. ETag. | S | `shots_handler.dart:28, 36-145` |
| GET | `/api/v1/shots/ids` | All IDs; no ordering, query ignored | S | `:29, 158-166` |
| GET | `/api/v1/shots/latest` | Latest record without measurements; `200 null` when there are none | S | `:30, 168-176` |
| GET / PUT / DELETE | `/api/v1/shots/{id}` | Full record with measurements / deep-merge update (annotations; also `workflow.context`, e.g. `grinderBurrs:null`) / delete. `enjoyment` is 0-10. `createdAt`/`updatedAt`/`measurements` in a PUT → 400. | S | `:31-33, 178-…`, `doc/Api.md:206-244`, `test/webserver/shots_handler_test.dart` (new burrs test) |
| GET | `/api/v1/steams`, `/steams/ids`, `/steams/latest`, `/steams/{id}` (+ PUT, DELETE) | Milk-steaming records | S | `steams_handler.dart:18-23` |

### 1.4 Scale(s)

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/scale/info` | Connected-scale metadata `{firmwareVersion?, batteryLevel?}`; `{}` if unknown; `503` if no scale. The route is `/scale/{command}` and only `info` is valid. | S | `scale_handler.dart:22-40` |
| PUT | `/api/v1/scale/tare` | Tare the primary scale (`/scale/{command}`, only `tare`). `400 {type:"block_tare_during_shot"}` under lockout; **no scale → 500** | S | `:41-63, 130-141` |
| PUT | `/api/v1/scale/timer/{start\|stop\|reset}` | Scale timer; no scale → 500 | S | `:64-90` |
| PUT | `/api/v1/scales/{id}/tare` | Tare a primary or auxiliary scale by opaque id; 404 if unknown | S | `:92, 96-128` |

### 1.5 Devices

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/devices` | Inventory: `[{name,id,state,type,available,connectionRole?}]`. `type` ∈ machine/scale/sensor/grinder. `state` ∈ discovered/connecting/connected/disconnecting/disconnected. | S | `devices_handler.dart:243-250, 825-907`, `device.dart:6, 43-49` |
| GET | `/api/v1/devices/scan?connect=&quick=` | Scan and fill missing slots. `quick=true` → `[]` immediately. | S | `:251-282` |
| PUT | `/api/v1/devices/connect` / `disconnect` / `forget` | `deviceId` in the body (or `?deviceId=`); `connectionRole` for scales | S | `:284-287, 307-…` |
| GET / POST / DELETE | `/api/v1/devices/wifi` | Manual Wi-Fi scale endpoints | S | `wifi_scale_handler.dart:17-19` |
| GET | `/api/v1/diagnostics/ble` | Read-only BLE diagnostics | S | `ble_diagnostics_handler.dart:19` |

### 1.6 Grinder: runtime device, records, beans

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/grinder/info` | `{deviceId, capabilities[], controls?, surfaces?}` (`controls`/`surfaces` new this week); 503 if none | S | `grinder_handler.dart:10, 24-41` |
| GET | `/api/v1/grinder/state` | Latest snapshot `{timestamp,state,setting?,rpm?}`; 503 if none | S | `:11, 43-51` |
| PUT | `/api/v1/grinder/state/grinding`, `/state/idle` | Start / stop | S | `:12-16` |
| PUT | `/api/v1/grinder/setting` `{setting:"…"}`, `/api/v1/grinder/rpm` `{rpm:int}` | Set. Descriptor validation failure → **500** `{error, code:"invalid_argument"}` | S | `:17-18, 53-100` |
| GET / POST / PUT / DELETE | `/api/v1/grinders[/{id}]` | Persisted grinder records (`burrs`, setting type…); ETag on the list | S | `grinders_handler.dart:18-22` |
| GET / POST / PUT / DELETE | `/api/v1/beans[/{id}]`, `/beans/{beanId}/batches`, `/bean-batches[/{id}]` | Bean and batch records | S | `beans_handler.dart:17-28` |

### 1.7 Sensors

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/sensors`, `/api/v1/sensors/{id}` | List / manifest | S | `sensors_handler.dart:11-26` |
| POST | `/api/v1/sensors/{id}/execute` | Run a sensor command | S | `:29` |

### 1.8 Display, presence and sleep

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/display` | `{wakeLockEnabled, wakeLockOverride, brightness, requestedBrightness, lowBatteryBrightnessActive, platformSupported{brightness,wakeLock}}` | S | `display_handler.dart:11`, `display_controller.dart:63-…` |
| PUT | `/api/v1/display/brightness` `{brightness:0-100}` | 100 = OS-managed | S (Api.md wrongly says POST) | `:12` |
| POST / DELETE | `/api/v1/display/wakelock` | Wake-lock override on / off | S | `:13-14` |
| GET / POST | `/api/v1/presence/settings` | `{userPresenceEnabled, sleepTimeoutMinutes, keepAwakeUntil, schedules}`. POST validates atomically. | S | `presence_handler.dart:16-17, 33-…` |
| GET / POST / PUT / DELETE | `/api/v1/presence/schedules[/{id}]` | Wake schedules | S | `:18-21` |

### 1.9 App settings

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/settings` | `gatewayMode, webUiPath, logLevel, weightFlowMultiplier, volumeFlowMultiplier, hotWaterFlowMultiplier, scalePowerMode, blockOnNoScale, blockTareDuringShot, stopHotWaterAtWeight, preferred{Machine,Scale,GrinderDevice}Id, defaultSkinId, automaticUpdateCheck, chargingMode, nightMode*, lowBatteryBrightnessLimit, keepAwake, simulatedDevices[], themeMode, chargingState?` | S | `settings_handler.dart:20-69` |
| POST | `/api/v1/settings` | Partial update, applied **field by field and not atomically**: a 400 on a later field leaves earlier fields applied. `webUiPath` starts serving **any folder** as the skin; `defaultSkinId` must be installed; `simulatedDevices` takes effect at runtime. | S | `:70-315` |

### 1.10 KV store

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/store/{ns}` | Key list; with `?full=1` the whole namespace `{k:v}` with ETag (null values dropped) | S | `kv_store_handler.dart:7-16`, `hive_store_service.dart:63-71` |
| GET | `/api/v1/store/{ns}/{key}` | Value; **missing → `200 null`** | S (spec says 404) | `:18-25` |
| POST | `/api/v1/store/{ns}/{key}` | Store a JSON body → `200 {}`. Invalid JSON → unhandled 500. | S (spec says 204) | `:37-55` |
| DELETE | `/api/v1/store/{ns}/{key}` | → `200 {}` always | S (spec says `{deleted}`/404) | `:27-35` |

Hive-backed (`HiveStoreService(defaultNamespace:"kvStore")`). Survives skin origin changes. Included in backups (`webserver_service.dart:306`).

### 1.11 Plugins

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/plugins` | Manifests plus `loaded`, `autoLoad`, `source`, `pendingUpdate` | S | `plugins_handler.dart:21-33` |
| GET / POST | `/api/v1/plugins/{id}/settings` | Plugin settings (patch; secure fields `{isSet}`) | S | `:64-65` |
| POST | `/api/v1/plugins/{id}/enable`, `/disable`; DELETE `/api/v1/plugins/{id}`; PUT `/{id}/source` | Lifecycle | S | `:67-132` |
| POST | `/api/v1/plugins/install` (501), `/install/github-release`, `/install/github-branch`, `/update`, `/{id}/update/approve` | Install / update | S | `:35-120` |
| ANY | `/api/v1/plugins/{id}/{endpoint}` | Plugin HTTP endpoint (needs the `api` permission). Request object `{requestId, endpoint, method, headers, body, query}`. | S documents GET only; Api.md says ANY | `:134`, `doc/Plugins.md:967-1094` |

Bundled plugin endpoints a skin can call (`assets/plugins/*/manifest.json`):
- `settings.reaplugin`: `http:ui`, the web settings dashboard at `/api/v1/plugins/settings.reaplugin/ui?backName=…` (`doc/Api.md:845-854`).
- `visualizer.reaplugin` 1.5.11: `http:` `status`, `upload`, `verifyCredentials`, `lastUpload`, `import`, `backSyncNow`, `backSyncStatus`, `forwardSyncStatus`, `forwardSyncNow`.
- `decent-profile.reaplugin`: `http:ui`, `websocket:profileGenerated`.
- `time-to-ready.reaplugin`: `websocket:timeToReady`.
- `dye2`, `shot-upload` and `dcamp` are fetched at build time from pinned releases (`pubspec.yaml:190-193`, `doc/AI_REPO_MAP.md:61-63`).

### 1.12 Skins / WebUI

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/webui/skins`, `/webui/skins/{id}` | `WebUISkin {id, name, path (absolute FS path), description, version, isBundled, reaMetadata}` | S | `webui_handler.dart:12-18, 43-64`, `webui_storage.dart:127-137` |
| GET / PUT | `/api/v1/webui/skins/default` | Get / set the default (`{skinId}`). Does **not** restart serving. | S | `:14-16, 66-113` |
| POST | `/api/v1/webui/skins/install/github-release` `{repo, asset?, prerelease?}`, `/install/github-branch` `{repo, branch?}`, `/install/url` `{url}` | Install | S | `:20-30, 115-225` |
| DELETE | `/api/v1/webui/skins/{id}` | Remove (403 for bundled skins) | S | `:32, 227-245` |
| POST | `/api/v1/webui/skins/update` | Check all skin sources now | S | `:34, 247-254` |
| GET | `/api/v1/webui/server/status` | `{serving, path, port, ip}` (`ip` is `0.0.0.0` on Android) | S | `:36, 256-263` |
| POST | `/api/v1/webui/server/start`, `/stop` | Serve the default skin / stop | S | `:37-38, 265-296` |
| GET | `/api/v1/webui/skin-assets/{id}/{path…}` | Read a file from any installed skin (traversal-guarded, MIME sniffed) | S | `:40, 298-335` |

### 1.13 Info, update, logs, diagnostics, misc

| Method | Path | Purpose | Status | Code |
|---|---|---|---|---|
| GET | `/api/v1/info` | `{commit, commitShort, branch, buildTime, version, buildNumber, appStore, fullVersion, localIp}` | S | `info_handler.dart:11-28`, `build_info.dart:1-30` |
| GET | `/api/v1/update` | App-update state (pure read) | S | `update_handler.dart:10` |
| GET | `/api/v1/logs?kb=&order=` | App log tail, `text/plain` | S | `logs_handler.dart:21, 47-55` |
| GET | `/api/v1/webview/logs?order=` | Skin console log, **`text/plain`** lines `[ts] [skinId] [level] msg` | S (spec says JSON) | `webview_logs_handler.dart:10, 14-24`, `webview_log_service.dart:44-53` |
| POST | `/api/v1/feedback` | Create a GitHub feedback issue (needs a Decent account) | S | `feedback_handler.dart:19` |
| POST | `/api/v1/derek/answers/stream` | SSE relay to Derek RAG (CORS workaround) | S | `derek_handler.dart:14` |
| GET | `/api/v1/account/decent` | `{loggedIn}` | S | `account_handler.dart:10` |
| GET / POST / PUT | `/api/v1/account/proxy/<rest…>` | Auth-enriching proxy to `decentespresso.com`, restricted to `support/api/`. GET needs `account:proxy` (the skin token); POST/PUT need `account:proxy:write`. Native consent prompt on first use. | S (`/support/api/{endpoint}` form) + D (catch-all) | `account_proxy_handler.dart:13-16`, `doc/Api.md:644-655` |
| GET | `/api/v1/data/export`; POST `/api/v1/data/import`, `/api/v1/data/sync` | Backup ZIP / restore / instance sync | S | `data_export_handler.dart:94-95`, `data_sync_handler.dart:50` |

### 1.14 Debug (only when built with a non-empty `simulate` define)

| Method | Path | Status | Code |
|---|---|---|---|
| POST | `/api/v1/debug/update/force` | **D only** (Api.md:706; not in spec) | `debug_handler.dart:34` |
| GET / POST | `/api/v1/debug/flow-smoothing` | S | `:46-50` |
| POST | `/api/v1/debug/scale/{stall\|resume\|disconnect}`, `/api/v1/debug/machine/disconnect` | S | `:78, 110` |
| GET / POST / DELETE | `/api/v1/debug/replay/shots`, `/replay/shot/{id}`, `/replay/shot` (`simulate=replay`) | S | `:124-154` |

Registration gate: `webserver_service.dart:353-361`. These routes return 404 in release builds.

### 1.15 WebSocket channels (`ws://<host>:8080/ws/v1/...`, all **S**)

| Path | Dir | Payload summary | Code |
|---|---|---|---|
| `/ws/v1/machine/snapshot` | S→C | `MachineSnapshot {timestamp, state{state,substate}, flow, pressure, targetFlow, targetPressure, mixTemperature, groupTemperature, targetMixTemperature, targetGroupTemperature, profileFrame, steamTemperature}`. Stays open and silent with no machine; re-binds after a power cycle; never sends status frames. | `de1handler.dart:190-193, 919-934, 733-805`, `machine.dart:97-111` |
| `/ws/v1/machine/shotSettings` | S→C | `{steamSetting, targetSteamTemp, targetSteamDuration, targetHotWaterTemp, targetHotWaterVolume, targetHotWaterDuration, targetShotVolume, groupTemp}` | `:194-197, 936-951`, `de1_interface.dart:147-158` |
| `/ws/v1/machine/waterLevels` | S→C | `{currentLevel, refillLevel}` (mm) | `:198-201, 953-968`, `de1_interface.dart:228-230` |
| `/ws/v1/machine/raw` | ↔ | `De1RawMessage {type, operation, characteristicUUID, payload(hex)}`. Sending while detached → `{"error":"No machine connected"}`. | `:202, 970-992` |
| `/ws/v1/machine/shotState` | S→C | `{event: state\|decision\|terminal, timestamp, shotId, state: idle\|preheating\|pouring\|stopping\|finished, machineState, machineSubstate, profileFrame, scaleConnected, scaleLost, machineHasAutonomousSAW, decision{kind, reason(open set), details, data}}`. Replays the latest frame on connect. | `:203-206, 900-917`, `websocket_v1.yml:638-725` |
| `/ws/v1/scale/snapshot` | S→C | `{status: connected\|disconnected}` on open and on every transition, plus `WeightSnapshot {timestamp, weight, weightFlow, battery, timerValue(ms)}` | `scale_handler.dart:91, 236-290`, `scale_controller.dart:316-323` |
| `/ws/v1/scales/{id}/snapshot` | S→C | `{status}` frames plus raw `{timestamp, weight, batteryLevel, timerValue, flow}`. Unknown id → `{"error":"Scale not found: …"}`, then close. | `:93, 143-234` |
| `/ws/v1/grinder/snapshot` | S→C | `{timestamp, state: idle\|grinding\|error\|unknown, setting?, rpm?}`. New subscribers get the current snapshot; silent while disconnected. | `grinder_handler.dart:19-22, 104-114` |
| `/ws/v1/sensors/{id}/snapshot` | S→C | `{timestamp, id, values{…}}`. Unknown id → `{"error":"not found"}`, then close. | `sensors_handler.dart:27, 54-…` |
| `/ws/v1/devices` | ↔ | `{timestamp, devices[], scanning, charging?, connectionStatus{phase, foundMachines, foundScales, pendingAmbiguity, error{kind, severity, timestamp, deviceId, deviceName, message, suggestion, details}}}` (debounced 100 ms). Commands: `scan`, `connect` (→ `DeviceConnectResult`), `disconnect`. | `devices_handler.dart:117-185, 289, 473-…` |
| `/ws/v1/display` | ↔ | `DisplayState`. Commands: `setBrightness`, `requestWakeLock`, `releaseWakeLock`. The wake lock is released automatically when the socket closes. | `display_handler.dart:15, 95-112` |
| `/ws/v1/plugins/{id}/{endpoint}` | S→C | Plugin-defined JSON | `plugins_handler.dart:133, 290-…` |
| `/ws/v1/logs` | S→C | `{level, timestamp, name, message}` | `settings_handler.dart:317-346` |
| `/ws/v1/webview/logs` | S→C | **Plain strings** `[ts] [skinId] [level] msg` (the spec types them as a LogMessage object) | `webview_logs_handler.dart:11, 26-45` |
| `/ws/v1/update` | ↔ | `AppUpdateState`. Commands: `{command:"check"\|"install"}`. | `update_handler.dart:11` |

### 1.16 Non-`:8080` HTTP surfaces

| Port | Path | Behaviour | Status | Code |
|---|---|---|---|---|
| 3000 | any | `307` to the same URL on the active skin port with `Cache-Control: no-store`. Only for device hosts (loopback, a local interface IP, or a hostname that resolves to one); otherwise 404. | D | `webui_service.dart:497-519` |
| skin port (24800+) | `/…` | Static files from the skin folder; `index.html` served for directories; **directory listing on**; no SPA fallback | D | `webui_service.dart:245-250` |
| skin port | `/__decent/skin-api.js` | Injected bridge script (no-store, CORP same-origin, nosniff) | D | `webui_service.dart:252-267` |
| skin port | `/__decent/exit-dashboard` | Navigation sentinel intercepted by the embedded WebView (not a real resource) | C | `webui_service.dart:38-39`, `skin_view.dart:46-52, 713-725` |
| 4001 | `/`, `/rest_v1.yml`, `/websocket_v1.yml` | API docs: the **exact spec files bundled in the running build** (listing on) | D | `webserver_service.dart:657-697` |

### 1.17 Code vs spec (mechanical diff, `route_diff_af4e995.txt`)

159 code REST registrations against 159 spec operations: 150 match exactly. All 15 WS routes match the 15 AsyncAPI channels. The 9 non-matches are 4 kinds of shape difference, not missing endpoints:
- `/scale/{command}`, `/scale/timer/{command}` in code vs the concrete `/scale/info|tare|timer/start|stop|reset` in the spec.
- The account-proxy catch-all `<rest|.*>` in code vs `support/api/{endpoint}` in the spec.
- `ALL /plugins/{id}/{endpoint}` in code vs GET only in the spec.
- Two code-only routes: `OPTIONS /api/v1/machine/profile` (CORS helper, `de1handler.dart:25-35`) and `POST /api/v1/debug/update/force` (simulate-only, documented in Api.md:706).

The spec has **no** operation without a code route. Spec-only *parameters* do exist: `orderBy` on `GET /shots` (`rest_v1.yml:1771-1777`) is ignored by the code.

---

## 2. Skin hosting and native bridges

### 2.1 Manifest and install rules

- Metadata comes from `skin-manifest.json` (preferred) or `manifest.json`. Only `id`, `name`, `description` and `version` are read (`webui_storage.dart:998-1031, 1107-1120`). `author`/`repository` from the Skins.md example (`Skins.md:3096-3111`) are ignored.
- With no `id`, the folder or ZIP root name becomes the id. The id must be a single safe path component, otherwise install fails or the skin is skipped (`webui_storage.dart:1033-1038, 1122-1126`; `Skins.md:3070`).
  - **Gotcha:** a PWA `manifest.json` (web app manifest) is read as skin metadata. Its `id`/`name` would become the skin id/name, and a PWA `id` such as `"/"` is unsafe, so install is rejected. Ship `skin-manifest.json` to avoid this.
- ZIPs: if the archive holds a single top-level folder, that folder becomes the root (`webui_storage.dart:1081-1089`). The install code does not check for `index.html`; only live-edit validates it (`Skins.md:3422`). Reinstalling or updating **deletes and replaces** the whole skin folder (`webui_storage.dart:1137-1144`).
- Default skin id is `streamline.js` (`settings_controller.dart:47`, `settings_service.dart:274-277`, `webui_storage.dart:218-247`). Skins.md:3530 says `streamline-project`, which is wrong.
- Remote-bundled skins come from `skin_sources.json`: streamline_project, passione, OverDose, Beanie, NSX, WorkFlow-Skin, insight-js. Release builds bundle them as ZIPs (`bundle_skins.sh`, `webui_storage.dart:922-950`). Bundled skins cannot be deleted (`webui_storage.dart:799-800`).

### 2.2 Serving, origins and caching

- **Stable per-skin origin.**
  - Each served skin gets its own `http://localhost:<port>` (and the LAN IP).
  - The port is FNV-1a-seeded inside `[24800, 24800+4096)`, skipping 3000/4001/8080 and ports already taken, and is persisted in SharedPreferences `webUISkinPorts` (`webui_service.dart:139-147, 360-367, 429-463`; `main.dart:214-243, 502-505`).
  - If the assigned port is busy: 3 tries 150 ms apart, then a **temporary random port** for that run. The origin then differs, so `localStorage`/IndexedDB written under the stable origin is not visible (`webui_service.dart:418-427, 465-485`; `Skins.md:140-168`).
- **Identity = absolute folder path in production.** `skinIdentityProvider` exists but is never set outside tests (`webui_service.dart:177, 337-338`; only `test/webui_support/webui_stable_origin_test.dart:138,249` sets it). On iOS/Android the skin folder lives under the app Documents dir (`app_directories.dart:14-16, 30`). *Inference, unverified:* if iOS relocates the app container path (for example after a reinstall), the skin would get a new port and therefore a new origin, so browser storage would look empty. This is one more reason to keep authoritative state in the KV store, as CafAI already does.
- **Entry point :3000** (bookmark this, per `c45f2db`): a `307` to the same path and query on the skin port, `no-store`, device hosts only (`webui_service.dart:497-519`; `Skins.md:151-157`).
- **Caching:**
  - Every skin-server response except `/ws*` gets `Cache-Control: no-cache, no-store, must-revalidate`, `Expires: 0` (`webui_service.dart:269-288`).
  - HTML responses also lose `ETag`/`Last-Modified`/`Content-Length` after script injection (`:309-325`).
  - The embedded WebView sets `cacheEnabled:false` and calls `clearAllCache()` each time SkinView opens, except on Windows (`skin_view.dart:250-257, 287`).
  - Net effect: no HTTP caching at all. A Service Worker cache would be the only cache; its interaction with `clearAllCache()` was not verified.
- **No SPA fallback** (unknown paths → 404) and **directory listing is enabled** (`webui_service.dart:245-250`). The embedded view opens `http://localhost:<port>/?_=<epoch ms>` (`skin_view.dart:149-150`), so `location.search` is never empty.
- **Script injection:** every `200 text/html` response gets `<meta name="reaprime-proxy-token" content="…">` (token only for loopback or literal device IPs) followed by `<script src="http://<host>:<port>/__decent/skin-api.js">`. The tag goes before `</head>`, else before `</body>`, else after the doctype (`webui_service.dart:43-70, 223-235, 290-327`). The script also works under `script-src 'self'` (`Skins.md:3453`).
- **Account-proxy token:** rotated per serve and bound to the skin's consent key; revoked on switch or stop (`webui_service.dart:241-242, 336, 355-358`; `main.dart:580-591`).

### 2.3 Injected JS globals

| Global | Content | When | Source |
|---|---|---|---|
| `window.__DECENT_HOST__` | Frozen, non-enumerable, non-writable `{app:"decent.app", platform: Platform.operatingSystem, version: BuildInfo.version, build: BuildInfo.buildNumber, commit: BuildInfo.commitShort}` | Embedded WebView only, document start, page world | `skin_view.dart:794-828` |
| `window.decentApp.exitToDashboard()` | Navigates to `http://localhost:<skinPort>/__decent/exit-dashboard` **only if** `__DECENT_HOST__` exists; otherwise a no-op | Any page served from the skin origin to a device host (also in external browsers) | `webui_service.dart:96-105` |
| `window.__REA_PROXY_TOKEN__` | Read from the `reaprime-proxy-token` meta | Loopback or literal device-IP hosts only | `webui_service.dart:97-99, 302-306` |
| Simulated-device overrides | `devicePixelRatio`, `innerWidth/Height`, `screen.*`, `maxTouchPoints`, `navigator.platform`, touch `matchMedia` | Desktop only, when the `enableSimulatedWebViews` setting is on and a device is chosen | `skin_view.dart:830-931` |

There are no JS↔Dart message channels.

### 2.4 Embedded WebView behaviour (`flutter_inappwebview`)

- **Settings:**
  - JS on; `javaScriptCanOpenWindowsAutomatically:false`, so `window.open`/`target=_blank` popups are blocked.
  - `mediaPlaybackRequiresUserGesture:false`, so autoplay works.
  - Zoom off; scrollbars hidden.
  - **`userAgent: "Decent"` replaces the entire UA string**, so UA-based engine sniffing sees no browser version.
  - Renderer priority bound (`skin_view.dart:273-304`).
- **Navigation policy** (`classifySkinNavigation`, `skin_view.dart:46-64, 710-737`):
  - Load in place: the skin port, `localhost:3000`, and `localhost:8080/api/v1/plugins/*`.
  - Any other `http`/`https` URL is **cancelled and opened in the system browser**. That includes `127.0.0.1`, the LAN IP and, by code reading, iframe navigations to external sites, because the check ignores `isForMainFrame` except for the exit sentinel.
  - Everything else is blocked.
- **Exit to dashboard:**
  - From JS: `decentApp.exitToDashboard()`. Accepted only from the main frame at a top-level `http://localhost:<skinPort>` URL (`skin_view.dart:68-92, 713-725`).
  - Natively: Android back / edge swipe (PopScope), iOS edge swipe, macOS ⌘D or View menu, Windows system menu (`skin_view.dart:28-44, 344-351`).
  - A one-time instruction snackbar can be disabled in Settings (`skin_view.dart:306-325, 684-689`).
- **Open settings:** no native bridge. Skins link to the settings plugin page `http://<host>:8080/api/v1/plugins/settings.reaplugin/ui?backName=<Skin>`, which loads in place. Its back button returns to `http://<host>:3000/?_=<ts>` (`Skins.md:3439-3449`).
- **Lifecycle (Android/iOS only):**
  - Backgrounded: `pause()` + `pauseTimers()`.
  - After 10 minutes in the background: load `about:blank`.
  - On resume: `resume()` + `resumeTimers()`, and if the page was blanked, a reload of `http://localhost:<port>/?_=<ts>` (`skin_view.dart:183-241`). `sessionStorage` does not survive this (`Skins.md:60-65, 147-149`).
  - Renderer crash: automatic rebuild after 500 ms (`skin_view.dart:752-770`).
  - Leaving the skin resets brightness to 100 (OS-managed) (`skin_view.dart:166`; `Skins.md:1579-1580`).
- **Console capture:** every `console.*` message goes to the WebView log (`/api/v1/webview/logs`, `/ws/v1/webview/logs`), tagged with **`defaultSkinId`** (`skin_view.dart:738-748`). That tag can be wrong under `--skin-path` or live-edit.

### 2.5 Camera access and consent (57dfb88, b9df5ed, f53dfae, fb7039d, 9ed5d61, 2e5a5c6)

- **Platforms:** `supportsSkinCamera` is Android, iOS and macOS only. Windows and Linux are unchanged and have no handler (`skin_camera_platform.dart:5-11`; `Skins.md:138`).
- **Live camera:**
  - A WebView `onPermissionRequest` is granted only when the request is **exactly `[CAMERA]`**. Microphone or camera+microphone requests → DENY (`skin_camera_permission.dart:67-87`).
  - The origin must be the currently served **installed** skin's `http://localhost:<port>`, and the port must not be 3000/8080/4001 (`skin_camera_permission.dart:16-24`; target built in `app.dart:519-535`). Live-edit, `--skin-path` and `webUiPath` folders that do not match an installed skin get no target, so access is denied.
  - Trust is re-checked before and after each await: navigation, page loads, renderer death and app backgrounding all invalidate pending requests (`skin_camera_permission.dart:92-139`; `skin_camera_webview_access.dart:37-75`; `skin_view.dart:661-668, 749-753`).
- **Consent:**
  - SharedPreferences `skinCameraConsent.<skinId>` holds true/false/absent (`skin_camera_permission.dart:27-45`).
  - The prompt reads 'Allow "<skin name>" to receive images from your camera?' and auto-dismisses after 30 s, which counts as no answer (`skin_camera_controls.dart:6-30`).
  - Users change the decision under Ask/Allow/Deny in the native skin selector (`skin_camera_controls.dart:32-123`; `skin_selector_page.dart:113-118`).
  - The system camera permission is requested only after consent. On macOS this goes through MethodChannel `com.reaprime/skin_camera` / `requestCamera` and AVFoundation (`skin_camera_platform.dart:13-23`; `macos/Runner/MainFlutterWindow.swift`).
  - Manifest and entitlement changes: Android `CAMERA` permission plus a file provider; iOS `NSCameraUsageDescription` text and a new `NSMicrophoneUsageDescription` (for the system recorder only); macOS camera entitlement.
- **Reference skin for testing:** `test_assets/skin_camera_audit/` (6482a17).

### 2.6 File selection and capture (Android only; fb7039d, f53dfae)

- Decaid now implements `onShowFileChooser` itself (`skin_view.dart:660`; `skin_camera_webview_access.dart:77-132`).
  - **`capture` present:** allowed only when every accept type is an image MIME or image extension. Each capture then needs a native confirmation (`confirmEveryRequest`), regardless of the stored live-camera decision. Video or mixed `capture` → denied.
  - **No `capture`:** the system picker (`FilePicker.pickFiles`). The type is mapped to custom extensions, image, video, audio or any, and `multiple` is honoured. There is no camera or video shortcut any more.
- iOS/macOS file inputs are untouched; the iOS picker can still record video with audio (`Skins.md:114-136`).
- **Downloads:** no download handler is configured, so `<a download>` or blob downloads probably do nothing in the embedded WebView (inferred from the absence of `onDownloadStartRequest`). CafAI already skips file downloads when inside Decaid (`cafai.md:21`).
- **Share sheet:** none for skins. `share_plus` is used only by native backup/import/support screens (`archive_export.dart:66`, `import_result_view.dart:254`). The 2 share-anchor commits (ff686b8, aab5f93) are native-only.

### 2.7 Skin updates

- **Automatic:** every 12 h (1 h when `simulate=1`) while `automaticUpdateCheck` is on: `updateAllSkins()` re-resolves GitHub release, branch and URL sources (`update_check_service.dart:30-33, 147-190`; `webui_storage.dart:484-557`).
- **Manual:** `POST /api/v1/webui/skins/update`, the settings plugin, or the native "Check for updates" button (`Skins.md:3564-3575`).
- An update rewrites the folder in place while the skin may be running. There is no reload signal; new files are picked up at the next navigation (everything is no-store).

### 2.8 What a skin can do in Decaid that a plain browser page cannot

1. Detect the host and read its version (`__DECENT_HOST__`).
2. Exit to the native dashboard (`decentApp.exitToDashboard`).
3. Use the Decent account through the proxy token without ever seeing credentials.
4. Use live camera from a trusted `localhost` origin with per-skin consent (a LAN `http://` origin is not a secure context).
5. Native capture confirmation and system file picker on Android.
6. External links open in the system browser while the skin stays loaded.
7. The background lifecycle (pause, unload after 10 min, reload).
8. Console logs retrievable over the API.
9. Simulated-device viewport emulation on desktop.

All machine, display, wake-lock and storage control goes through REST/WS, which also works from any LAN browser.

---

## 3. Versioning and compatibility

### 3.1 Version signals

- **`GET /api/v1/info`:**
  - Returns `{commit, commitShort, branch, buildTime, version, buildNumber, appStore, fullVersion, localIp}`, matching the spec exactly (`info_handler.dart:16-26`; `rest_v1.yml:5061-5102`).
  - Values are compile-time defines from `flutter_with_commit.sh`. VERSION is the latest git tag without `v`; BUILD_NUMBER is `git rev-list --count origin/main` (`flutter_with_commit.sh:10-27`).
  - Defaults outside a tagged build: `version "0.0.0-dev"`, `buildNumber "0"`, git fields `"unknown"` (`build_info.dart:1-30`). Skins.md:1760 claims "unknown" for git fields only.
  - **No API version, capability or feature list** (except `GET /api/v1/machine/capabilities` for Bengle hardware features).
- **`window.__DECENT_HOST__.{version, build, commit}`:** the same build info without a round trip, embedded WebView only.
- **The running build's own specs:** `http://<host>:4001/rest_v1.yml` and `/websocket_v1.yml` (`webserver_service.dart:664-668`). This is the best runtime fingerprint of the API contract.

### 3.2 Policy and changelog

- No stated compatibility or deprecation policy for `/api/v1`. Both specs say `info.version: 1.0.0`, unchanged in the visible history (`rest_v1.yml:4`, `websocket_v1.yml:4`).
- App releases follow SemVer: MAJOR = breaking or major feature (`doc/RELEASE.md:87-92`). No document ties this to API changes.
- There is no CHANGELOG file. GitHub release notes are generated from merged PRs (`doc/RELEASE.md:11, 215-217`; `release.yml:808-833`).
- Signals of compatibility intent that do exist:
  - `deprecated: true` on shot `shotNotes`/`metadata` (`rest_v1.yml:7476-7556`).
  - "OPEN SET — tolerate unknown values" on `shotState.decision.reason` and `stopReason` (`websocket_v1.yml:707-713`; `rest_v1.yml:7465, 7501, 7544`).
  - "New kinds may be added without a version bump" on `ConnectionError.kind` (`websocket_v1.yml:528-535`).
  - Explicit "no status frames on machine sockets, would break the wire contract" reasoning (`AI_API_NOTES.md:229`; `Api.md:756-759`).
  - The legacy workflow-field removal is described as "As of v0.5.2" (`rest_v1.yml:1537-1539`).

### 3.3 How the specs are maintained

- **Hand-written YAML.** The rules are "update the spec in the same commit", "the spec is authoritative" and the endpoint checklist (`AGENTS.md:33, 138`; `AI_API_NOTES.md:13-18, 193-200`). The PR template only asks contributors to note "API/spec impact" (`.github/pull_request_template.md:23-27`).
- **No generation, no linting, no conformance check in CI.** `pr-checks.yml` runs format, analyze, `flutter test`, a Linux build smoke test and the Apple camera privacy check, with no OpenAPI or AsyncAPI validator (`pr-checks.yml:165-283`).
- **8 unit tests read the specs to pin specific fragments:**
  - `test/connect_result_schema_test.dart`
  - `test/data_export/settings_plugin_sections_test.dart`
  - `test/plugins/plugin_grinder_spec_test.dart`
  - `test/plugins/plugin_settings_schema_spec_test.dart`
  - `test/rest_simulated_bengle_schema_test.dart`
  - `test/unit/models/device/impl/de1/steam_substate_mapping_test.dart` (asserts both specs publish `pausedSteam`/`puffing`)
  - `test/unit/models/device/refill_kit_settings_test.dart`
  - `test/webserver/workflow_patch_schema_test.dart`
- No test checks that all routes are in the spec, or that responses validate against the spec.
- Handler unit tests exist (`test/webserver/*`, `test/services/webserver/*`). End-to-end checks are manual curl/websocat recipes in `.agents/skills/decent-app/scenarios/` (`AI_TESTING_NOTES.md:16-22`).
  - One recipe still parses the token as an inline `__REA_PROXY_TOKEN__="…"` assignment (`account-proxy-write.md:26,57`), but the token now ships in a meta tag. A small sign that these recipes are not executed.

### 3.4 Drift between Dart code and spec/docs (sample of endpoints a skin uses)

| # | Endpoint / channel | Code does | Spec / docs say | Risk for skins |
|---|---|---|---|---|
| 1 | Machine state enums (`GET /machine/state`, WS snapshot, `PUT /machine/state/{s}`) | `MachineState` has 21 values: `booting, busy, idle, schedIdle, sleeping, heating, preheating, espresso, hotWater, flush, steam, steamRinse, skipStep, cleaning, descaling, calibration, selfTest, airPurge, needsWater, error, fwUpgrade` (`machine.dart:139-161`). `schedIdle` is emitted for DE1 scheduled idle (`de1.utils.dart:14-15`) and requested by wake schedules (`presence_controller.dart:516`). | REST spec lacks `schedIdle` (`rest_v1.yml:6414-6439`). WS spec lacks busy/schedIdle/steamRinse/calibration/selfTest/airPurge/fwUpgrade and lists a nonexistent `transportMode` (`websocket_v1.yml:762-780`). Skins.md lists 14 states (`Skins.md:356-370`). | **High** for strict enum parsing or a typegen client. Treat unknown states as non-fatal; map `schedIdle` to idle. |
| 2 | Machine substate | Emits `cleaningGroup` plus 18 `error*` substates (`machine.dart:163-197`) | `cleaingGroup` typo in REST (`rest_v1.yml:6450`), WS (`websocket_v1.yml:790`) and Skins.md:379. WS spec lacks the `error*` values. | Medium: matching on the documented spelling never fires. |
| 3 | `PUT /api/v1/machine/state/{newState}` | Unknown name → `byName` throws → **500 `{error, st}`** (stack trace) (`de1handler.dart:825, 715-716`) | Spec: 400 `MachineStateError` (`rest_v1.yml:403-413`). Api.md:82 lists `sleep` (invalid; `sleeping` is correct). | Low (CafAI sends valid names). |
| 4 | Machine routes with no machine | 500 `{"error":"DeviceNotConnectedException: machine not connected"}` (`de1handler.dart:682-687, 713-714`; `errors.dart:22-24`) | GET `/machine/state` spec documents only 200 (`rest_v1.yml:380-391`) | Medium: clients depend on undocumented text (CafAI matches `/not connected/`, `cafai.md:28`). |
| 5 | `PUT /api/v1/scale/tare` without a scale | **500** `{"error":"DeviceNotConnectedException: scale not connected"}` (`scale_handler.dart:46-58`; `scale_controller.dart:167-171, 209-210`) | Spec 404 (`rest_v1.yml:1154-1155`). Skins.md:506 says 404, and its minimal skin branches on 404 (`Skins.md:2963`). | Medium (a future "fix" to 404 would change the error text too). |
| 6 | `POST /api/v1/machine/shotSettings` | `De1ShotSettings.fromJson` → `parseInt(null)` throws on any missing field → 500 (`de1_interface.dart:160-170`; `utils.dart:14-18`) | Spec schema has no `required` (`rest_v1.yml:6615-6641`); Skins.md:420-435 does not say all fields are needed | Medium for partial writes (CafAI does not write it). |
| 7 | `POST /api/v1/machine/waterLevels` | Reads only `refillLevel`, returns 202 with an empty body (`de1handler.dart:366-374`) | Spec agrees ("Only the refillLevel field is used"). **Skins.md:487-492 documents `warningThresholdPercentage`**, which is silently ignored. | Medium (doc). |
| 8 | `POST /api/v1/machine/settings` `usb` | `usb = json['usb'] == 'enable'` (`de1handler.dart:396`), response 202 | Spec correct (`enable`/`disable`). **Skins.md:461-465 example `"usb": true` disables the charger.** | Medium (doc). |
| 9 | Workflow legacy fields | `Workflow._parse` still accepts `doseData`/`grinderData`/`coffeeData`, but existing `context` values win, so legacy writes are silently ignored when the context is set (`workflow.dart:36-71`). Responses never contain legacy fields (`workflow.dart:95-107`). | Spec: "no longer accepted" (`rest_v1.yml:1537-1539, 7214-7216`). Skins.md:576: responses include them; Skins.md:698 and the 2483-2495 example still write them; AI_API_NOTES.md:191: "API clients can write to either". | Medium if anything still reads `doseData`. |
| 10 | KV store | `GET` missing key → 200 `null`; `POST` → 200 `{}`; `DELETE` → 200 `{}` always; invalid JSON POST → unhandled 500; ns/key not percent-decoded (`kv_store_handler.dart:7-55`) | Spec: 404 / 204 / `{deleted}`+404 (`rest_v1.yml:2998-3057`). Skins.md:1427, 1449-1451 same. | Low (CafAI tolerates 404 on DELETE and treats an empty body as `null`), but a spec-aligning fix would change behaviour. |
| 11 | `GET /api/v1/shots` | Ignores `orderBy`; `limit` echo is not clamped; `ids=` returns a plain array with measurements (`shots_handler.dart:36-145`) | `orderBy` documented (`rest_v1.yml:1771-1777`). Skins.md:774 shows `/shots/ids?order=desc`, but the handler ignores the query (`:158-166`; spec `:1807-1809` says unordered). | Low. |
| 12 | `/ws/v1/scale/snapshot` | `{timestamp, weight, weightFlow, battery, timerValue}` (`scale_controller.dart:316-323`) | AsyncAPI matches (`websocket_v1.yml:565-588`). **Skins.md:1838-1843 shows `batteryLevel`**, the addressed-stream name. | Low (doc). |
| 13 | `/api/v1/webview/logs`, `/ws/v1/webview/logs` | `text/plain` lines and raw strings `[ts] [skinId] [level] msg` (`webview_logs_handler.dart:14-45`; `webview_log_service.dart:44-53`) | REST spec: JSON array of `{timestamp, level, message}` (`rest_v1.yml:5185-5201`); AsyncAPI binds `logMessage` | Low. |
| 14 | `/api/v1/info` | Includes `localIp`; non-release default `version` is `0.0.0-dev` (`info_handler.dart:16-26`; `build_info.dart:18-25`) | Spec matches. Skins.md:1733-1760 omits `localIp`. | None. |
| 15 | `/api/v1/devices`, `/ws/v1/devices` | `type` ∈ machine/scale/sensor/**grinder** (already so at a45961b: `git show a45961b:lib/src/models/device/device.dart:6`) | REST spec had grinder (`rest_v1.yml:6011`); WS spec only since a34615f (`websocket_v1.yml:971`); Skins.md:276-289 example lacks `available` | Low. |
| 16 | `POST /api/v1/machine/heartbeat` | `{timeout}`; error body `{error}` (`presence_handler.dart:24-31`) | Spec `{timeout}` and error schema `{e, st}` (`rest_v1.yml:4349-4374`) | None. |
| 17 | `PUT /api/v1/display/brightness` | PUT (`display_handler.dart:12`) | Spec PUT; **Api.md:464 says POST** | Low (doc). |
| 18 | Response envelope | Bare JSON (`json_response.dart:7-8`) | `AI_API_NOTES.md:22` claims `{data, error, status}` | Doc only. |
| 19 | `GET /webui/server/status` `port` | Stable per skin (section 2.2) | Spec: "Active per-generation skin origin port" (`rest_v1.yml:4246`) | Doc only. |
| 20 | `PUT /api/v1/grinder/setting` / `rpm` with descriptors | Rejection → **HTTP 500** `{error, code:"invalid_argument"}` (`grinder_handler.dart:95-96`) | Api.md:361-366 names the code, not the status | Low. |
| 21 | Default skin id | `streamline.js` (`settings_controller.dart:47`) | Skins.md:3530: `streamline-project` | Doc only. |

---

## 4. What changed between `a45961b` and `af4e995`

`git log --oneline a45961b..af4e995` has 40 commits. `git diff --stat` across the range is 108 files, +9029/−230. Spec diffs: `rest_v1.yml` +142/−2, `websocket_v1.yml` +5/−1. Note that author dates of some merged commits (c45f2db, 57dfb88: 2026-09-22) predate a45961b; they entered via later merges.

### 4.1 Commits grouped

| Group | Commits | Skin-visible? |
|---|---|---|
| Grinder controls and device surfaces | 071dc7c, 9a1f342, ebba852 | Yes (additive, `GET /grinder/info`) |
| Plugin route decoding | 945f31f | Yes (behaviour, low) |
| Plugin manifest and settings-surface plumbing | cf4bce5, cc74f50, 5efc99a | No (native device-management page, manifest validation) |
| Plugin Scale session info | 9a88d46 | Yes (additive, `GET /scale/info` for plugin scales) |
| Plugin payload hardening | ce88f83, 2818ee1, af4e995 | No (plugin-side validation) |
| Visualizer grinder burrs | 05e1dac, 42f88c0, 2b8b492, 0104132, 9d8dc2d | Yes (new `grinderBurrs` context field; Visualizer upload and back-sync behaviour) |
| Inventory spec | a34615f | Spec only (`grinder` in the WS device `type` enum) |
| Skin docs | c45f2db | Docs only (bookmark `:3000`; stable origins) |
| Skin camera / files | 57dfb88, fb7039d, b9df5ed, f53dfae, 2e5a5c6, 9ed5d61 (+ 6482a17 audit skin, 49561b4 / 73f1918 CI) | Yes (new capability; Android file-input behaviour change) |
| Native share anchors | ff686b8, aab5f93 | No |
| Feedback / support text | d66eb42, 207e369, b8eac0c (+94501c4 test) | No (support-message body text only, `feedback_service.dart:378-386`, `decent_account_service.dart:726-731`) |
| Dev tooling | 1c6061b (`sb-dev.sh`) | No |
| Test-only | 939cf4f, 8828a4b, 74cd26f, 4fd9517, cd0cbf6, 5bfd9e1 | No |

### 4.2 Skin-observable changes and breaking risk

| Change | Surface | Detail (citations at af4e995) | Breaking risk |
|---|---|---|---|
| `grinderBurrs` added to `WorkflowContext` | REST `GET/PUT /workflow`, `GET/PUT /shots/{id}`, `WorkflowContext`/`WorkflowContextPatch` in the spec | New nullable string (`workflow_context.dart:10, 30, 53, 72, 125-146`; `rest_v1.yml` WorkflowContext and Patch). Legacy `grinderData.burrs` maps to it (`workflow.dart:52, 66`). **On every shot store** Decaid resolves it from the linked grinder record's `burrs` when `grinderId` is set (replacing any inherited value; empty or missing becomes null). Without `grinderId` the value is kept as is (`persistence_controller.dart:35-73`). A shot PUT with `grinderBurrs:null` clears it (`test/webserver/shots_handler_test.dart`, new test). Docs: Skins.md:686-688, 933. | None (additive); output omits it when null. |
| Visualizer plugin 1.5.10 → 1.5.11 | Data written to visualizer.coffee; shot records changed by back-sync | Uploads send `grinder_model = "<model> (<burrs>)"` built from the shot's own context. Back-sync ignores its own echo. A real remote model edit is written into the Decaid shot with `grinderBurrs:null` (`doc/AI_PLUGINS_NOTES.md:6-46`; `assets/plugins/visualizer.reaplugin/manifest.json`). So `workflow.context.grinderModel` of a shot can now read e.g. "EG1 (Lab Sweet)" after a Visualizer edit. | Low (a skin displaying `grinderModel` may show combined text). |
| `GET /api/v1/grinder/info` adds `controls` and `surfaces` | REST, spec `GrinderInfo`, `GrinderSettingDescriptor`, `GrinderRpmDescriptor`, `PluginDeviceSurface` | Only with plugin grinders that declare them (`grinder_handler.dart:26-38`). `surfaces[].href` is a **relative** `/api/v1/plugins/<pluginId>/<endpoint>?ui=1&deviceId=…[&deviceName=…]` (`plugin_device_surface_authority.dart:12-41`): resolve it against `:8080`, and it loads in place in the WebView. Grinder setting/rpm writes now validated against descriptors → 500 `invalid_argument` (`Api.md:360-375`). | None for v1 grinders; low otherwise. |
| `GET /api/v1/plugins` items | REST | `manifest.toJson()` now also emits device `controls`/`surfaces` when declared (`plugin_manifest.dart:241-243`) | None (additive). |
| Plugin `id`/`endpoint` decoded once | REST `/api/v1/plugins/{id}/{endpoint}`, WS `/ws/v1/plugins/{id}/{endpoint}` | `decodeOpaquePathComponent` added (`plugins_handler.dart:292-293, 356-357`). Clients must percent-encode once. A path holding a literal `%xx` that previously matched raw now decodes. Bundled IDs (`settings.reaplugin/ui`, etc.) are unaffected. | Low. |
| Plugin-backed scales can fill `GET /api/v1/scale/info` | REST | `context.publishInfo({firmwareVersion, batteryLevel})` (`doc/Plugins.md:472-494`). Previously such scales returned `{}`. No inventory or WS change. | None. |
| `grinder` in WS device `type` enum | AsyncAPI only (a34615f) | The code emitted `grinder` before a45961b (`device.dart:6` at both commits). | None at runtime; spec-generated strict clients would previously have rejected those frames. |
| Live camera via `getUserMedia` | WebView (Android/iOS/macOS) | Section 2.5. | None (new capability; previously Android denied it by default). |
| Android `<input type=file>` handling | WebView | Section 2.6: the system picker replaces the plugin chooser (no camera shortcut); `capture` = per-capture confirmation, images only; video capture denied. | **Medium only for skins using file inputs on Android.** |
| Bookmark guidance | Docs (c45f2db) | "Bookmark `:3000`, not the redirected port" (`Skins.md:151-157`; Api.md:655). | None. |

Nothing was removed or renamed in REST, WS, enums or the injected globals in this range.

### 4.3 Impact on CafAI specifically (from `cafai.md` section 1)

- **`grinderBurrs`.** CafAI clears foreign context fields (`coffeeName`, `coffeeRoaster`, `beanBatchId`, grinder fields) with explicit `null`s on every activation (`cafai.md:72`), but `grinderBurrs` did not exist when that list was written. When CafAI leaves `grinderId` null, a stale `grinderBurrs` already in the live workflow (from Decaid's Repeat, DYE2 or another skin) survives `persistShot` unchanged (`persistence_controller.dart:46-49`). The Visualizer plugin would then upload it folded into `grinder_model`. **Suggested:** add `grinderBurrs: null` to the cleared fields, or set `grinderId` so Decaid resolves the burrs itself.
- **Machine state enum.** CafAI's control model and alerts read `state.state` (`cafai.md:59`). Make sure `schedIdle` (and `busy`, `steamRinse`, `airPurge`, `calibration`, `selfTest`, `fwUpgrade`) is handled. None of these is in Skins.md or the REST spec; `schedIdle` appears after a wake schedule fires. Not new in this range, but undocumented.
- **Error mapping relies on undocumented behaviour.** "No machine/scale" currently arrives as HTTP 500 with text `"... not connected"` (section 3.4 rows 4-5), which CafAI maps through a regex (`cafai.md:28`). The spec says 404 for tare. Pin this in a contract test.
- **KV.** CafAI uses `?full=1`, POST and DELETE (`cafai.md:49-51`) and avoids characters that would need decoding (`cafai.md:68`, matching `kv_store_handler.dart:8, 19-20`). Unchanged in this range.
- **User agent.** The WebView UA is the bare string `Decent` (`skin_view.dart:296`). If CafAI's "older engine" check (`cafai.md:24`, Chromium < 91) reads `navigator.userAgent`, it gets no version inside Decaid. Check how `index.html` detects it.
- **No impact:** camera, plugin decoding (CafAI only links `settings.reaplugin/ui`), grinder `controls`/`surfaces` (CafAI reads `/grinders` records, not `/grinder/info`), inventory `grinder` type (CafAI picks `type==='machine'`/scale entries, `cafai.md:61`). If CafAI ever uses `<input type=file>` on Android, re-test it.

---

## 5. Running Decaid headless for automated tests

### 5.1 Linux desktop build

- Linux is a first-class target. CI builds it with `flutter build linux --release`; the binary is `build/linux/x64/release/bundle/decaid` (`pr-checks.yml:317-329`; `release.yml:357-365`).
- **Dependencies:**
  - apt: `libgtk-3-dev libsecret-1-dev xvfb` (`pr-checks.yml:296`).
  - The Docker image adds `clang cmake ninja-build pkg-config liblzma-dev libserialport-dev libjsoncpp-dev libglu1-mesa` (`Dockerfile:7-12`).
  - Flutter is pinned to 3.44.2 for release and develop builds (`release.yml:339-342`; `develop-builds.yml:47, 267`). PR checks use unpinned `stable`. Dart SDK `^3.10.0` (`pubspec.yaml:13-14`).
- **Before the build:**
  - `./scripts/fetch_{dye2,shot_upload,dcamp}_plugin.sh` (needs `GH_TOKEN`) (`pr-checks.yml:308-315`).
  - Bundled skins: `flutter_with_commit.sh` runs `bundle_skins.sh`, which calls the GitHub API. Skip it with `--skip-skins` (`flutter_with_commit.sh:31-58`), or stub it as PR CI does (`pr-checks.yml:235-240`).
- **Version defines:** `flutter_with_commit.sh` injects `COMMIT`/`VERSION`/`BUILD_NUMBER` (`:10-29`). A plain `flutter build` reports `0.0.0-dev`.
- **Docker/Podman alternative:** `make build-amd` runs the build in `Dockerfile` (ubuntu:22.04 + Flutter stable) (`Makefile:26-43`). It is written for Podman on Apple Silicon; there is no Linux CI usage of it.

### 5.2 Simulated devices

- **Compile-time:** `--dart-define=simulate=<v>`.
  - `1` = machine + scale + sensor + **bengle** (`main.dart:144-160`). Bengle makes the preferred-device choice nondeterministic, so prefer an explicit `machine,scale` (`doc/DeviceManagement.md:1605-1631`).
  - Also `replay` (MockReplayDe1, recorded shots), `bengle`, `sensor` (`doc/AI_TESTING_NOTES.md:104-115`; enum at `settings_service.dart:584`).
  - The define also unlocks `/api/v1/debug/*`: stall/resume/disconnect scale, disconnect machine, force a replay shot, fake an update (`webserver_service.dart:353-361`; `doc/Api.md:700-717`).
  - Exactly `simulate=1` also shortens the update-check interval to 1 h (`update_check_service.dart:30-33`).
- **Runtime (works in release builds):** `POST /api/v1/settings {"simulatedDevices":["machine","scale"]}` or the Settings UI toggle. A settings listener merges the setting into `SimulatedDeviceService.enabledDevices` (`main.dart:367-373, 702-711`; `settings_handler.dart:278-299`; `doc/DeviceManagement.md:174-178`). Then `GET /api/v1/devices/scan?connect=true`.
- **Other defines:** `preferredMachineId`, `preferredScaleId` (`main.dart:745-754`); `diagnostics` (diagnostics skin, `webui_storage.dart:153-166`).
- **Simulation fidelity:** profiles execute in a simplified simulated shot loop with random puck resistance (`doc/Profiles.md:571-573`).

### 5.3 Display, startup sequence and unattended start

- **The Flutter UI must run.** The REST server starts in `main()` before `runApp` (`main.dart:~620-700`, `webserver_up` mark).
  - Device initialization, plugin loading and **skin serving** happen in the onboarding *initialization step*. That step always runs (`app.dart:148-197`; `initialization_step.dart:72-120`).
  - So on Linux CI the app needs an X server: `xvfb-run -a`. Decaid's PR CI already does exactly this: `timeout 30 xvfb-run -a "$APP" --no-account` on a fresh XDG profile (`pr-checks.yml:319-342`). It only checks that `log.txt` appears; it does not probe the API.
- **CLI flags for unattended runs** (`cli_args.dart:27-73`; wiring `main.dart:730-743`):
  - `--no-account`: skips the keyring/libsecret account service ("headless Linux with no keyring").
  - `--bypass-onboarding`: marks onboarding done; skips welcome/login/import.
  - `--skin-path=<dir>`: serve a skin folder directly, falling back to the default skin if it is unreadable.
  - `--skin=<id>`.
  - `--direct`: auto-connect the first discovered devices.
  - `--serial`: no BLE services.
  - `--trust-consent=<key>` / `--trust-all-consent`: for account-proxy consent.
  - `--print-storage-paths`.
- **Nothing blocks the API on Linux:** the permissions step shows only on Android/iOS (`permissions_step.dart:29-46`). A port clash on 8080 replaces the app with a conflict screen (`AI_API_NOTES.md:247-301`).
- **Ports:** 8080 (API), 4001 (docs, best effort), 3000 (entry), 24800+ (skin origin). Use isolated `XDG_DATA_HOME`/`XDG_CONFIG_HOME` per run (`pr-checks.yml:320-327`); SharedPreferences persists skin port assignments.
- **Readiness probe:** poll `GET /api/v1/devices` until it answers, as `scripts/sb-dev.sh` does (`sb-dev.sh:76-93`).

### 5.4 Published artifacts

- **Tagged releases (`v*`)** on GitHub Releases (`release.yml:3-6, 755-835`):
  - Android APK, macOS app/DMG, Windows zip, unsigned iOS IPA;
  - **Linux x64 `decaid-linux-x64-<ver>.tar.gz` and `decaid-linux-x86_64-<ver>.AppImage`** (ubuntu-22.04, glibc baseline, `:322-385`);
  - Linux arm64 tarball and AppImage (`:387-452`);
  - `SHA256SUMS`;
  - `-latest` copies of every asset (`scripts/create_release_aliases.sh:14-39`), e.g. `releases/latest/download/decaid-linux-x64-latest.tar.gz` (prereleases excluded by GitHub's "latest").
  - Release builds are **not** built with `simulate`, so `/debug/*` is absent; the runtime setting still works.
- **Every push to `main`:** a Linux x64 tarball as a 90-day workflow artifact `decaid-linux-x64-develop` (`develop-builds.yml:3-7, 283-298`). Downloading it needs a GitHub token (`gh run download -R decentespresso/decaid …`).

### 5.5 Build time

- No timings are recorded. The PR "Linux build smoke" job (deps, `pub get`, plugin fetch, release build, smoke launch, AppImage packaging) has `timeout-minutes: 30` (`pr-checks.yml:284-288`).
- *Estimate:* about 6-12 min for a cold Linux release build on a GitHub runner, 3-6 min with Flutter/pub caches. Downloading the release tarball takes seconds.

### 5.6 Existing harnesses

- **`scripts/sb-dev.sh`:** `flutter run` (debug, hot reload) via `flutter_with_commit.sh run -d <platform>` with `--dart-define=simulate=1` unless `--real`. Waits up to 120 s for `/api/v1/devices`, then loops `GET /devices/scan?connect=true` until the named machine/scale is connected. Needs `jq`, a Flutter SDK and a display (`sb-dev.sh:24-60, 76-112, 187-222`). Usable in CI with `--platform linux` under xvfb, but it is a dev-loop tool.
- **`.agents/skills/decent-app/verification.md`** and `scenarios/*.md`: curl/websocat smoke recipes (`AGENTS.md:45`; `AI_API_NOTES.md:202-213`).
- There is no dedicated headless or server-only mode.

### 5.7 Verdict and recipe

**Feasible today.** The cheapest path downloads the release, needs no Flutter SDK, and tests against the latest release:

1. `curl -L` `decaid-linux-x64-latest.tar.gz` from the latest GitHub release and extract the `bundle/` folder.
2. `apt-get install -y xvfb libgtk-3-0 libsecret-1-0`. These are runtime libraries; the CI uses the `-dev` packages and the exact runtime list is unverified.
3. `XDG_DATA_HOME=$RUNNER_TEMP/x XDG_CONFIG_HOME=$RUNNER_TEMP/c xvfb-run -a ./bundle/decaid --no-account --bypass-onboarding --skin-path=$PWD/dist &`
4. Wait for `GET :8080/api/v1/devices`.
5. Enable simulation and connect:
   - `POST /api/v1/settings {"simulatedDevices":["machine","scale"],"automaticUpdateCheck":false}`
   - `GET /api/v1/devices/scan?connect=true`
6. Run contract tests against `:8080`. Run UI tests in a browser at `http://localhost:3000`. Inject `window.__DECENT_HOST__` with an init script if the embedded-WebView path matters; the real WebView bridges cannot be exercised on Linux.

For debug routes or a specific commit, build from source instead: Flutter 3.44.2, fetch the plugins, `flutter build linux --release --dart-define=simulate=machine,scale` (+ VERSION defines via `flutter_with_commit.sh --skip-skins`).

**Risks:**
- BLE/BlueZ is absent on runners. Errors should be harmless; `--serial` avoids BLE entirely, though `--serial` is untested together with simulated devices.
- Remote skin/plugin fetches hit GitHub. Set `automaticUpdateCheck:false`; `downloadRemote` is false during initialization.
- An 8080 clash produces the conflict screen.
- Release builds lack `/debug/*`, so scale-stall/disconnect fault injection needs a source build.
- First-run defaults (gateway mode etc.) differ from a user's tablet.
- Camera and WebView behaviour cannot be tested on Linux at all.

---

## 6. Tripwires for noticing a breaking Decaid update

1. **Spec fingerprint.** Fetch `http://<decaid>:4001/rest_v1.yml` and `/websocket_v1.yml` from the running build (`webserver_service.dart:664-668`), or from the repo at a tag. Hash them, diff against the pinned copy and fail on change. Re-run `route_diff.js` from this folder on each new Decaid checkout.
2. **Contract tests against a real (simulated) Decaid in CI.** Pin exactly what CafAI relies on:
   - `MachineSnapshot` keys, and the state/substate value sets including `schedIdle`;
   - shotState fields;
   - devices entry keys and `connectionRole`;
   - `PUT /workflow` echo;
   - KV semantics (`200 null`, `{}`);
   - the 500 + `"not connected"` text on no-machine/no-scale;
   - `POST /machine/profile` → 200;
   - shot PUT deep-merge and the `enjoyment` 0-10 range.
3. **Runtime version logging:** record `__DECENT_HOST__.version`/`commit` and `/api/v1/info.fullVersion`/`commit` in CafAI diagnostics; flag Decaid versions newer than the last verified one.
4. **Watch these Decaid paths between pinned and latest commits:**
   - `assets/api/*.yml`
   - `lib/src/services/webserver/**`, `lib/src/services/webserver_service.dart`
   - `lib/src/webui_support/**`, `lib/src/skin_feature/**`
   - `lib/src/models/device/machine.dart`, `lib/src/models/device/de1_interface.dart`
   - `lib/src/models/data/workflow*.dart`, `lib/src/models/data/shot_record.dart`
   - `lib/src/controllers/scale_controller.dart` (`WeightSnapshot`)
   - `lib/src/controllers/persistence_controller.dart`
   - `assets/plugins/visualizer.reaplugin/**`
   - `doc/Skins.md`, `doc/Api.md`

   Use `git diff --stat <pinned>..origin/main -- <paths>`.
5. **Release notes:** these are generated from PR titles (no CHANGELOG). Each PR's "Impact" section is the only place API/spec impact is declared (`pull_request_template.md:23-27`).

---

## 7. Not verified / open

- Nothing was executed. Runtime claims (iframe-to-external behaviour, `<a download>` no-op, `clearAllCache()` versus Service Worker caches, the exact Linux runtime libraries, iOS container-path changes re-keying the skin port, `--serial` combined with simulation) come from reading code and should be confirmed on a device or runner.
- History before `a45961b` is unavailable in this shallow clone, so the "already in the code before a45961b" claims rest on `git show a45961b:<file>` only.
- The plugin/device and headless-CI sub-reports were not delivered (usage limits). Their scope was covered directly, at lower depth for plugin-internal validation (cf4bce5, ce88f83, 2818ee1, af4e995) and device-management UI commits (cc74f50, 5efc99a), which have no API surface.

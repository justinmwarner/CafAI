# streamline-js audit (v0.2.12, 57e8b44, 2026-10-09)

Audit of Decent's official Decaid skin, done to align CafAI with Decent's own patterns and to make sure CafAI uses every native Decaid capability it should. Research only, nothing was modified.

## Conventions

- **Repo:** `.ref\streamline-js` at `57e8b44` (v0.2.12).
- **Previous study point:** `cb058ca` (v0.2.7).
- **Shallow clone:** the clone stops at `cb058ca` (`.git/shallow`). Nothing earlier is available, and the only local tag is `v0.2.7`. Releases v0.2.8 to v0.2.12 exist only as `chore(release)` commits.
- **Citation formats:**
  - `path:line` is relative to the streamline-js repo root.
  - `decaid:path:line` is the Decaid checkout at `.ref\decaid` (`af4e995`). I read it only to confirm host-side behaviour.
  - `spec` means streamline's own copies `rest_v1.yml` and `websocket_v1.yml` at the repo root.
- **Working notes:** in `cafai-audit\streamline-work\`:
  - `streamline_spec_listing.txt` lists every operation and channel in streamline's spec copies.
  - `ops_*.txt` and `ch_*.txt` diff that listing against the Decaid af4e995 listing in `cafai-audit\spec_listing_af4e995.txt`, which came from the sibling Decaid audit.

---

## 0. The picture in one paragraph

Streamline is a **vanilla JavaScript SPA** built from native ES modules:

- **Stack:** no framework, no TypeScript, no app bundler. Tailwind/daisyUI CSS and one esbuild-built ECharts bundle are the only build steps.
- **Hosting:** Decaid serves it on `:3000`, which is really a redirector to an ephemeral port. The skin talks to Decaid's REST and WebSocket API on `:8080`.
- **Transport:** almost all Decaid transport is wrapped in `src/modules/api.js` (3073 lines, about 180 exports).

Over time it has accumulated a large body of hard-won knowledge about Decaid and WebView behaviour. Most of it lives in long code comments rather than docs, and §6 lists it.

On the API surface:

- **Used:** about 75 REST operations, 10 WebSocket channels and 8 KV namespaces.
- **Wrapped but unused:** a number of endpoints (beans, grinders, heartbeat, machine profile, profileGenerated, among others).
- **Missing from its spec copy:** the newest Decaid surfaces (connected grinder, multi-scale, `/scale/info`, BLE diagnostics). Its committed spec copy is 10 REST operations and 2 channels behind Decaid af4e995.

---

## 1. Decaid integration points

### 1.1 Host, port and origin resolution

| Item | Behaviour | Where |
|---|---|---|
| Host | `reaHostname = localStorage.getItem('reaHostname') \|\| window.location.hostname` | `src/modules/api.js:13` |
| REST base | `API_BASE_URL = http://${reaHostname}:8080/api/v1`. Always `http:`, even on an https page | `api.js:14-15` |
| WS scheme | `WS_PROTOCOL = 'wss:'` if the page is https, else `'ws:'`. This is inconsistent with the always-http REST base | `api.js:16` |
| Port | `REA_PORT = 8080`, a constant | `api.js:14` |
| Exception | The water-level socket uses `window.location.hostname`, not `reaHostname`, so it ignores the override | `src/modules/waterTank.js:70` |
| Setting the override | No UI sets `reaHostname`; it is a dev or LAN override typed into localStorage. It is deliberately not mirrored to KV | `docs/API.md:352-358`; `src/modules/settingsSync.js:32-33` |
| Ports | 3000 serves the skin, 8080 the REST and WS API, 4001 the API docs | `docs/API.md:40-46` |
| Skin port reality | Decaid serves the skin folder on a fresh ephemeral port on every web-server start; `:3000` is a permanent 307 redirector to it | `docs/skin-switching.md:3-7,37-46`; `api.js:3028-3029` |
| Gateway mode | On every main-page init the skin forces Decaid `gatewayMode` to `tracking` if it is anything else. `tracking` means Decaid controls the shot (stop at weight etc.) but does not draw graphs | `api.js:2108-2128`; `src/modules/app.js:2145`; `rest_v1.yml` `gatewayMode` description at about line 6195 |

### 1.2 WebSocket transport: connect, reconnect, backoff, liveness

**Library.** Streamline vendors Joe Walnes' ReconnectingWebSocket (MIT):

- It loads as a classic `<script defer>` that defines a global (`index.html:34`; `src/modules/reconnecting-websocket.js:95-103`).
- `api.js` uses the global; it does not import it (`docs/AI_RUNTIME_NOTES.md:20`).

**Backoff:**

- Library defaults are `reconnectInterval 1000`, `maxReconnectInterval 30000`, `reconnectDecay 1.5`, `timeoutInterval 2000` (connect timeout) and unlimited attempts (`reconnecting-websocket.js:112-135`).
- Every Streamline socket passes `reconnectInterval: 3000`. The resulting delay is 3 s × 1.5^n, capped at 30 s (`reconnecting-websocket.js:286-290`).
- The `reconnectInterval: 3000` option appears at:
  - `api.js:453-455, 527-529, 592-594, 621-623, 652-654, 678-680, 708-711, 781-783, 925-927, 1014-1016`
  - `waterTank.js:70-72`
- `docs/API.md:189-192` tells skin authors to "wrap every socket in a reconnecting wrapper with exponential backoff".

**Local patch to the library.** A `close()` is now final. Without the patch, a pending reconnect timer resurrected discarded sockets (`reconnecting-websocket.js:208-224, 343-350`).

**Ownership rules:**

- **Single-owner slots, close-before-open:** handlers are silenced first so the old socket cannot paint "Disconnected" (`src/modules/socket-slot.js:1-75`). The slots exist for:
  - machine snapshot and shot settings (`api.js:277-282`);
  - water levels (`waterTank.js:56-60`).
- **Shared subscriber sockets with replay of the last frame to late subscribers:**
  - devices (`api.js:761-829`, replay at `768-771`);
  - display (`api.js:909-970`, replay at `915-918`).
- **Singletons replaced on every call:**
  - scale (`api.js:520-525`);
  - sensor snapshot, keyed by sensor id (`api.js:582-590`);
  - the update socket is reused while it is open (`api.js:1004-1012`).

**Liveness:**

- **Data timeout.** No snapshot frame for 5 s triggers a rate-limited (10 s) `GET /devices` probe before declaring a disconnect. Silence may mean a stale socket rather than a dead machine (`app.js:523-569`).
- **Link authority.** The `ws/v1/devices` aggregator survives machine power-cycles. An edge-triggered watcher (`src/modules/machine-link.js:60-127`) drives `onLinkUp`, which calls `resyncMachineSockets()` and `loadInitialData()` (`app.js:408-439`).
- **Socket rebind.** `resyncMachineSockets` re-opens the snapshot, shot-settings and water-level sockets (`app.js:414-420`).
- **Reasoning.** Decaid used to leave machine-bound sockets open but silent after a power-cycle (`app.js:386-406`; `machine-link.js:1-24`). The newer spec says they re-bind (`websocket_v1.yml:26,40,48`). Streamline keeps both fixes as "belt and braces" (`app.js:402-405`).
- **Error state.** An `error` machine state in the snapshot is treated as "DE1 fell off BLE", meaning disconnected (`app.js:841-851`).
- **No auto-reload.** The snapshot `onclose` paints "Disconnected"; the old automatic `location.reload()` is commented out (`api.js:502-510`).
- **Sub-page boot.** Booting straight into a sub-page skips main-page init. `ensureMachineSnapshotSocket()` opens a no-op-handled snapshot socket for pages that need cached frames (`api.js:437-450`), used by sensor calibration and maintenance (`src/settings/settings.js:5363`; `src/settings/categories/maintenance.js:359`).

### 1.3 Heartbeat (`POST /api/v1/machine/heartbeat`): never called

- **Wrapper exists but is dead.** `signalHeartbeat()` exists (`api.js:2726-2739`) and is imported by `settings.js:2`, but nothing calls it.
- **What heartbeat does.** It resets Decaid's app-side idle sleep timer and forwards "user present" to the DE1. It returns `{timeout: seconds}`, or -1 when presence is off (`rest_v1.yml:3987-4011`; `decaid:lib/src/controllers/presence_controller.dart:104-115`).
- **Decaid's own sources of heartbeats.** Decaid heartbeats from its own Flutter navigator only (`decaid:lib/src/controllers/presence_navigator_observer.dart:10-23`). Otherwise its sleep timer restarts only on machine activity followed by idle (`presence_controller.dart:148-195`).
- **The gap.** Streamline exposes the Presence settings: enable flag, sleep timeout and wake schedules (`settings.js:10107-10209`). But with presence enabled, user taps inside the skin never extend the timeout.
- **Implication for CafAI.** If CafAI wants presence-aware sleep, it must call heartbeat on user interaction, throttled. Decaid throttles its own forwarding to the DE1 at 5 s (`presence_controller.dart:29`).

### 1.4 REST endpoints used, with shapes, call sites and features

`api.js` holds the wrapper unless noted. "Call sites" lists the main callers.

#### Devices and scale

| Method + path | Request / response relied on | Wrapper | Call sites | Feature |
|---|---|---|---|---|
| GET `/devices` | Bare array of `{id, name, type: 'machine'\|'scale'…, state: 'connected'\|…, available?}` | `147-153` | `app.js:545` (silent-socket probe), `app.js:1157` (scale connect poll), `app.js:2040` (DE1 discovery at boot) | Link status, scale connect |
| GET `/devices/scan` | Same array. `connect` defaults true and `quick` defaults false, so the call can block 15 to 41 s. Aborted at 20 s, then answered from GET `/devices` | `178-212` | `app.js:2046` (boot fallback) | Discovery |
| PUT `/devices/forget` | `{deviceId}` in the body (serial and WiFi ids are not path-safe) | `2792-2808` | `settings.js:10560-10577` | Forget a remembered device |
| GET, POST, DELETE `/devices/wifi` | `{host}` → `{endpoints: []}` | `2741-2790` | `settings.js:9957-10028` | Manual WiFi scale entry when mDNS is blocked |
| PUT `/scale/tare` | No body | `261-275` | `app.js:1080-1089` (tap the weight readout), `settings.js:8928-8936` | Tare |
| GET `/devices/scan?connect=true`, PUT `/devices/connect?deviceId=` | n/a | `238-255`, `214-232` | None (dead) | n/a |

Scanning, connecting and disconnecting go over the devices WebSocket (§1.5), not REST.

#### Machine

| Method + path | Shape | Wrapper | Call sites | Feature |
|---|---|---|---|---|
| GET `/machine/info` | `{model, GHC, version, serialNumber, extra: {refillKit}}`; `extra.refillKit` is undocumented | `1781-1787` | `app.js:1666-1680, 1727-1739`; `settings.js:7783` | Bengle gate by model string (`src/modules/machine.js:17-37`); shows the GHC button column when `GHC === false`; steam-flow presets by model; refill-kit flag (`machine.js:39-73`); Machine Info page; support-mail attachments (`settings.js:8495-8503`) |
| GET `/machine/state` | MachineSnapshot | `1789-1797` | `src/modules/calibrated-steam-ui.js:32` | Auto-steam context |
| PUT `/machine/state/{newState}` | No body | `1455-1463` | See the row-by-row breakdown below this table | Machine control |
| POST `/machine/shotSettings` | The **whole** cached ShotSettings: `{steamSetting, targetSteamTemp, targetSteamDuration, targetHotWaterTemp, targetHotWaterVolume, targetHotWaterDuration, targetShotVolume, groupTemp}`. Integers rounded; groupTemp to 0.1 | `1465-1492` | `setMachineSteamTemp` (`1494-1509`) from `src/modules/eco-steam.js:94,120` | Eco steam: changes the DE1 without touching the stored workflow. Refuses to post before the first shotSettings WS frame (`api.js:134-145, 1507`) |
| GET, PUT `/machine/cupWarmer` | GET → `{temperature (setpoint, 0 = off), currentTemperature?, prewarmEnabled?, prewarmLeadMinutes?, prewarmActive?}`. PUT `{temperature 0-80}` or `{prewarmEnabled, prewarmLeadMinutes 0-120}`; the second form echoes the values back, and null means unsupported | `1799-1850` | `app.js:1858-1972` (header toggle, 60 s poll); `settings.js:3274-3600` | Bengle cup warmer |
| GET, PUT `/machine/ledStrip`, POST `/machine/ledStrip/commit` | `{frontStrip, backStrip, frontSwitch}`, each `{awake, sleeping}` as a 12-hex string. PUT is immediate and persistent; commit is a no-op | `1852-1888` | `src/modules/led-strip-runner.js:91-153`; `settings.js:3713-4360` | Bengle lighting and sequences. `/reset` is wrapped (`1890-1894`) but unused |
| GET, PUT `/machine/scaleCalibration` | PUT `{command: zero\|latch\|abort, grams}` → 202, or 409 with `{reason, state}`. Then poll GET every 500 ms for up to 60 s | `284-378`; `src/modules/loadcell-cal.js` | `settings.js:8848-8930` | Bengle load-cell wizard |
| GET, PUT `/machine/calibration/{target}` | GET with `?source=current\|factory` → `{target, source, de1ReportedValue, measuredValue}`. PUT `{de1ReportedValue, measuredValue}` is a *correction*, not an absolute set; 202 means acknowledged, 504 means no acknowledgement | `380-426` | `settings.js:5318-5360, 8762-8830`; `docs/calibration-endpoints.md` | DE1 sensor calibration |
| GET, POST `/machine/settings` | DE1 settings. Cache 60 s, request coalescing, generation counter. Keys written: `fan, usb, flushTemp, flushFlow, tankTemp, steamPurgeMode` | `1905-1973` | `settings.js:263-310, 724-781, 1293-1536, 3193, 4622, 5036`; `app.js:2177` | Settings |
| GET, POST `/machine/settings/advanced` | Cache 40 s, 20 s timeout. Keys written: `heaterIdleTemp, heaterPh1Flow, heaterPh2Flow, heaterPh2Timeout, heaterVoltage, refillKitSetting` | `1983-2063` | `settings.js:1637-1748, 5095, 8211` | Settings |
| DELETE `/machine/settings/reset` | No body | `2065-2083` | `settings.js:8214-8226` | Reset to defaults |
| POST `/machine/waterLevels` | `{refillLevel: int mm}`; the only field that is used | `2342-2350` | `settings.js:9492-9510` (snapped, 400 ms debounce) | Refill alert level |
| GET `/machine/firmware` | Catalog plus eligibility; returns null on failure | `2352-2365` | `settings.js:7249-7262` | Firmware check |
| POST `/machine/firmware` | Raw file body → **NDJSON stream** `erasing → uploading* → done\|error`. A truncated stream counts as failure. 400, 409, 413 and 503 are mapped to messages | `2367-2415`; `src/modules/firmware-progress.js` | `settings.js:9183-9201` | Manual firmware upload |
| POST `/machine/firmware/apply` | `{artifactId, force}` → NDJSON stream | `2417-2437` | `settings.js:9205-9215` | Catalog update |
| DELETE `/machine/firmware` | Idempotent cancel; the stream's `error` event is what ends the request | `2439-2447` | `settings.js:9169-9181` | Cancel |
| POST `/machine/heartbeat` | → `{timeout}` | `2726-2739` | **Never called** (§1.3) | n/a |
| POST `/machine/profile` | n/a | `2332-2340` | Unused. `docs/API.md:224-228` says to use the workflow API instead | n/a |

Call sites of PUT `/machine/state/{newState}`:

| Command | Trigger | Where |
|---|---|---|
| `espresso`, `hotWater`, `steam`, `flush`, `idle` | GHC column buttons, shown only on non-GHC machines | `app.js:1974-1994` |
| Same states | Hardware keyboard shortcuts | `app.js:1996-2033` |
| `sleeping` / `idle` | Sleep button | `src/modules/ui.js:2230-2277` |
| `idle` (wake) | Tap on the screensaver | `ui.js:1714-1726` |
| `skipStep` | Skip-step control | `ui.js:2597-2607` |
| `cleaning`, `descaling`, `airPurge`, `idle` | Maintenance pages | `maintenance.js:196-345` |

#### Sensors

| Method + path | Shape | Wrapper | Call sites | Feature |
|---|---|---|---|---|
| GET `/sensors` | `[{id, info: {name, vendor, data: [...]}}]`. The wire key is `info.data`; the spec says `dataChannels`. Returns `[]` on any failure | `155-176` | `app.js:718-741` (poll every 3 s) | Bengle milk probe discovery |

#### Decaid app settings (`/api/v1/settings`)

| Method + path | Shape | Wrapper | Call sites |
|---|---|---|---|
| GET `/settings` | Cache 40 s, coalesced, generation-guarded. Returns null on failure | `1746-1779` | `src/settings/settings-data.js:50-72`; `app.js:310` (scalePowerMode), `870` and `1849` (blockOnNoScale), `2176`; `src/modules/flow-calibration.js:152-178` |
| POST `/settings` | Partial body | `2085-2106` | `settings.js:263-266` (pending-change flush); `settings-data.js:114-140`; `flow-calibration.js:157-159` |

Keys read or written, with where they are set:

| Key | Where |
|---|---|
| `gatewayMode` | `settings.js:1137-1149` |
| `logLevel` | `settings.js:1172` |
| `automaticUpdateCheck` | `settings.js:1200` |
| `weightFlowMultiplier`, `volumeFlowMultiplier` | `settings.js:1007-1039`, plus per-profile pushes from `flow-calibration.js` |
| `lowBatteryBrightnessLimit` | `settings.js:1584` |
| `stopHotWaterAtWeight`, `hotWaterFlowMultiplier` | `settings.js:4538-4562` |
| `scalePowerMode` | `settings.js:10310-10322` |
| `blockOnNoScale` | `settings.js:10339` |
| `chargingMode` | `settings.js:10637` |
| `nightModeEnabled`, `nightModeSleepTime`, `nightModeMorningTime` | `settings.js:10856-10864` |
| `preferredMachineId`, `preferredScaleId` | `settings.js:10595-10606` |

#### Workflow: the main configuration channel

| Method + path | Shape | Wrapper | Call sites |
|---|---|---|---|
| GET `/workflow` | `{profile, context: {targetDoseWeight, targetYield, grinderSetting, grinderId, grinderModel, beanBatchId, coffeeName, coffeeRoaster, baristaName, drinkerName, extras}, steamSettings: {targetTemperature, duration, flow, stopAtTemperature}, hotWaterData: {volume, targetTemperature, duration}, rinseData: {duration}}`. Legacy `doseData` and `grinderData` are still read as fallbacks | `1370-1379` | `app.js:1486, 1810, 2174`; `ui.js:286`; `src/modules/profileManager.js:874`; `src/modules/dyeStrip.js:180, 203, 397, 959`; `calibrated-steam-ui.js:32`; `api.js:1666, 1715` |
| PUT `/workflow` | **Partial body, deep-merged** by Decaid; returns the merged workflow. Before sending, the wrapper (a) converts `grinderData.setting`; (b) strips legacy Tcl fields; (c) per step deletes the inactive pump field, nulls a zero limiter and nulls non-pressure/flow exits; (d) after success notifies `onWorkflowUpdated` listeners | `1381-1453` | See the list below this table |

PUT `/workflow` call sites:

- Profile switch: `profileManager.js:954-957, 729, 782`; `src/modules/profile_selector.js:328-331, 479`.
- Tiles: `ui.js:205-346`:
  - dose and yield (yield folded into `profile.target_weight`, `ui.js:218-223`);
  - brew temperature, which rewrites every step's temperature (`ui.js:285-305`);
  - grind;
  - flush.
- Steam, hot water and milk stop setters: `api.js:1612-1744`.
- DYE2 apply: `dyeStrip.js:186, 212`. DYE2 context hygiene: `dyeStrip.js:957-971`.
- Settings page: `settings.js:271-292`.
- Auto-steam writes: `api.js:1692-1694`.

#### Profiles

| Method + path | Shape | Wrapper | Call sites |
|---|---|---|---|
| GET `/profiles?includeHidden=true` | `ProfileRecord[] {id, profile, metadata, visibility: visible\|hidden\|deleted, isDefault, parentId}`. Soft-deleted records are dropped client-side | `1090-1096` | `profileManager.js:173-240, 337, 694`; `dyeStrip.js:251` |
| POST `/profiles` | `{profile, parentId?}` → record. **Content-addressed**: duplicate content dedups onto the existing record. The profile is sanitised first (`1205-1237`) | `1098-1113`, `1239-1254` | `profileManager.js:149, 1131`; `src/modules/profile_editor.js:2950, 3259-3281` |
| PUT `/profiles/{id}` | `{profile}` or `{metadata}` | `1288-1311` | `profileManager.js:32, 151, 558`; `profile_editor.js:3255` |
| DELETE `/profiles/{id}` | Soft delete (sets `visibility = 'deleted'`) | `1265-1272` | `profileManager.js:1232`; `profile_editor.js:3403`; `profile_selector.js:1837` |
| PUT `/profiles/{id}/visibility` | `{visibility}` | `1274-1286` | `profileManager.js:342, 1218, 1254`; `profile_editor.js:3291-3293`; `profile_selector.js:1842` |
| GET `/profiles/{id}/lineage` | `ProfileRecord[]` | `1256-1263` | `profile_editor.js:3519-3520`; `profile_selector.js:1777` |

#### Shots: read-only

| Method + path | Shape | Wrapper / site | Use |
|---|---|---|---|
| GET `/shots?limit&offset&order&ids&…` | `{items: ShotRecordSummary[], total, limit, offset}` | `api.js:2173-2194`; direct fetch in `src/modules/history.js:80` | History pager (`history.js:77-110`); stop-time `actualYield` fetch (`app.js:1395-1401`); numpad "previous values" (`src/modules/numpad-modal.js:45-60`, which reads `.shots` instead of `.items`, a bug); favourites auto-populate (`profileManager.js:1298`, which uses `limit: 200` against a spec max of 100, `rest_v1.yml:1379`) |
| GET `/shots/latest` | Summary without measurements | `history.js:52` | Fast first paint (`history.js:43-75`) |
| GET `/shots/{id}` | `{id, timestamp, measurements: [{machine: MachineSnapshot, scale: {weight, weightFlow, timestamp}}], workflow, annotations: {actualDoseWeight, actualYield, drinkTds, drinkEy, enjoyment, espressoNotes, extras}, stopReason}` | `history.js:61, 116` | Charting, summary and Derek |
| GET `/shots/ids` | `string[]`, **in no guaranteed order** (`rest_v1.yml:1484-1490`) | `api.js:2165-2171` | `app.js:887-890` takes the **last element as the newest** (contract violation, gateway-full fallback path) |
| PUT, DELETE `/shots/{id}` | n/a | `api.js:2196-2216`; `history.js:451-481` | **No callers.** Streamline never writes notes, enjoyment, TDS or other annotations; that is delegated to the DYE2 plugin |

#### Beans, batches and grinders

`api.js:2218-2330` wraps every CRUD call; **none is called.** The DYE2 plugin owns this data.

#### KV store (`/api/v1/store/...`)

| Method + path | Shape | Wrapper |
|---|---|---|
| GET `/store/{ns}` | Array of keys | `1117-1121` |
| GET `/store/{ns}?full=1` | `{key: value}`. An older Decaid ignores `full` and returns the key array, so the wrapper then fetches each key | `1123-1134` |
| GET `/store/{ns}/{key}` | JSON value. `getValueFromStore` maps 404 to null (`2130-2145`); `getKVValue` throws (`1136-1140`) | Two wrappers |
| POST `/store/{ns}/{key}` | JSON body → 204. `keepalive: true` in `setKVValue` | `1142-1159`, `2147-2163` |
| DELETE `/store/{ns}/{key}` | `keepalive: true` | `1161-1168` |

Two wrapper families coexist. `setKVValue` and `getKVValue` URL-encode the namespace and key; `getValueFromStore` and `setValueInStore` do not.

#### Plugins

| Method + path | Shape | Wrapper | Call sites |
|---|---|---|---|
| GET `/plugins` | `PluginManifest[] {id, name, description, version, loaded, api: [{id, type: http\|websocket}], settings: {key: {type, description, default, label, secure}}, source: {lastChecked}, pendingUpdate: {version, addedPermissions}}`. Returns **null on failure**, distinct from `[]` | `2449-2460` | `dyeStrip.js:553, 643`; `src/modules/auto-steam-lifecycle.js:27`; `settings.js:5922-5951, 6288-6310, 8284-8320` |
| GET, POST `/plugins/{id}/settings` | Secure fields come back as `{isSet}`; POST is a patch (Decaid #588). The `strict` option distinguishes a failure from `{}`. A write dispatches `streamline:plugins-changed` | `2462-2506` | `src/modules/visualizer.js:43-46`; `settings.js:6221, 6343, 6892, 6980-7054`; `profile_editor.js:2192` |
| POST `/plugins/{id}/enable`, POST `/plugins/{id}/disable` | Both dispatch `streamline:plugins-changed` | `2949-2963` | `settings.js:8370-8399`; `dyeStrip.js:660` |
| ANY `/plugins/{id}/{endpoint}` | JSON in, JSON or text out. Errors carry `status`, `code` and `message` | `2508-2545` | Visualizer `upload` and `import`; shot-upload `upload`; calibrated-steam `status` and `calculate` |
| POST `/plugins/visualizer.reaplugin/verifyCredentials` | `{username, password}` → `{valid}` | `2547-2563` | `app.js:2076-2108`; `settings.js:6997-6999` |
| POST `/plugins/install/github-release` | `{repo, assetName?, includePrerelease?}` | `2980-2989` | `dyeStrip.js:658-663` |
| POST `/plugins/update` | Installs non-escalating updates during the call | `2994-2999` | `dyeStrip.js:683-702`; `settings.js:8228-8280` |
| POST `/plugins/{id}/update/approve` | 409 means the candidate moved; re-read the list | `3005-3014` | `dyeStrip.js:754`; `settings.js:6733` |
| GET `/plugins/{id}/ui`, `/plugins/dye2.reaplugin/{page}` | Navigated to (iframe or same-frame), never fetched | n/a | `settings.js:6482-6490`; `dyeStrip.js:33, 413-519` |

#### Display, presence, skins, system and account

| Method + path | Shape | Wrapper | Call sites / feature |
|---|---|---|---|
| POST, DELETE `/display/wakelock` | → JSON | `2681-2724` | `settings.js:10076-10091` (toggle; defaults ON per `api.js:2681-2685`), `settings.js:9089-9090, 9159` (firmware flash); re-armed on every display-WS open (`api.js:932-937`) |
| GET `/display` | n/a | `2565-2576` | Unused; the WS replay is used instead |
| GET, POST `/presence/settings` | `{userPresenceEnabled, sleepTimeoutMinutes 1-120 in UI}` | `2810-2847` | `settings.js:2304-2496, 10107-10130` |
| GET, POST `/presence/schedules`; PUT, DELETE `/presence/schedules/{id}` | `{time: 'HH:MM', daysOfWeek: int[], enabled, keepAwakeFor?: 1-720}` | `2849-2925` | `settings.js:3277, 10132-10209` |
| GET `/webui/skins` | `[{id, version, reaMetadata: {sourceUrl: 'github_release:owner/repo@…'}}]` | `2927-2931` | `settings.js:5644-5710, 7785, 9297-9314` |
| GET, PUT `/webui/skins/default` | `{skinId}` | `2933-2947` | `settings.js:9242-9295` |
| POST `/webui/skins/update` | n/a | `3036-3040` | `settings.js:9297-9314` (then reload if the on-disk version differs from `APP_VERSION`) |
| POST `/webui/server/stop`, POST `/webui/server/start`, GET `/webui/server/status` | Status returns `{serving, path, port, ip}` | `3016-3034` | `settings.js:9230-9295` (skin switch) |
| GET `/info` | `{version, buildNumber, fullVersion, buildTime}` | `1896-1902` | `settings.js:1096-1104, 7533, 7782`; `app.js:2179`. Display only, with no feature gating |
| POST `/feedback` | `{description, type, includeLogs, includeSystemInfo}` → `{issueUrl}` | `3042-3050` | `settings.js:8665-8708` |
| GET `/account/decent` | `{loggedIn}` | `2969-2978`; also a direct fetch at `settings.js:8406` | Shot Uploader gate; Talk to Decent |
| GET `/account/proxy/support/api/{sn\|email\|emails}` | `Authorization: Bearer ${window.__REA_PROXY_TOKEN__}`. `email?subject&body` sends a message; `emails?since=` returns the thread; `sn` returns the serial. The upstream body is relayed verbatim | Direct fetches | `settings.js:8401-8631` (Talk to Decent) |
| POST `/derek/answers/stream` | See §3 | `3052-3073` | `src/modules/derek-modal.js:110` |

#### Non-Decaid network calls

| Call | Purpose | Where |
|---|---|---|
| `https://api.github.com/repos/{slug}/releases/latest` | Skin and Decaid update badges | `settings.js:5686-5715, 7527` |
| `https://qrshare.c48.cal.decentespresso.com/api/s` (POST) | QR short links | `src/modules/qrShare.js:38, 111-124` |
| `decentespresso.com/img/cartoon_*` | Support-agent avatars | `settings.js:8596` |
| `fast.decentespresso.com` | Favicon | `index.html:30` |

Visualizer is reached **only** through the plugin.

### 1.5 WebSocket channels used

| Channel | Direction and payload relied on | Where | Feature |
|---|---|---|---|
| `ws/v1/machine/snapshot` | Receive MachineSnapshot: `{timestamp, state: {state, substate}, pressure, flow, targetPressure, targetFlow, mixTemperature, groupTemperature, targetMixTemperature, targetGroupTemperature, steamTemperature, profileFrame, weightFlow}`. `weightFlow` is the Bengle GFlow. `state` may be a string or an object, and both are tolerated (`api.js:471-472`). About 10 Hz | `api.js:452-518` | `app.js:750-1008`: status line, screensaver, display dim and restore (`api.js:483-494`), reconnect and wake reloads, shot start and stop, live chart (`src/modules/chart.js`), LED triggers, temperatures. Also sensor-cal capture (`settings.js:5453`) and maintenance progress (`maintenance.js:157, 247`) |
| `ws/v1/machine/shotSettings` | Receive ShotSettings (the 8 fields listed for POST `/machine/shotSettings`) | `api.js:620-646` | `app.js:1468-1477`: fills the cache, paints tiles, runs the KV drift resync (`app.js:1412-1466`) |
| `ws/v1/machine/shotState` | Receive ShotStateEvent: `{event, state: idle\|preheating\|pouring\|stopping\|finished, shotId, scaleLost, machineHasAutonomousSAW, decision: {kind: advance\|stop\|abort\|terminal\|finalize, reason (open set), details, data.projectedWeight}}`. The server replays the latest frame on connect | `api.js:648-675` | `app.js:1183-1410`: stop toasts, scale-lost warning, history refresh, upload confirmation, `actualYield` correction |
| `ws/v1/machine/waterLevels` | Receive `{currentLevel (mm), refillLevel}` | `waterTank.js:56-105` | Tank readout (mm or mL via a Tcl lookup table); `refillLevel` mirrored to localStorage |
| `ws/v1/scale/snapshot` | Receive `{weight, weightFlow, batteryLevel\|battery, timestamp}` plus `{status: 'connected'\|'disconnected'}` frames. Held open across scale cycles | `api.js:520-572` | `app.js:1026-1078`. The load-cell wizard temporarily steals this singleton (`settings.js:4836-4858`) |
| `ws/v1/devices` | Bidirectional. Receive `{devices[], scanning, connectionStatus: {error: {kind, message, suggestion, timestamp}}}` and DeviceConnectResult `{deviceId, operation: 'connect', outcome: connected\|alreadyConnected\|conflict\|timedOut\|…}`. Send `{command: 'scan', connect?, quick?}` and `{command: 'connect'\|'disconnect', deviceId}` | `api.js:738-883, 1067-1086` | `app.js:441-513, 1100-1115`; `settings.js:9817-9851, 10513-10627` |
| `ws/v1/display` | Bidirectional. Receive `{brightness, requestedBrightness, wakeLockOverride, wakeLockEnabled}`. Send `{command: 'setBrightness', brightness: 0-100}` only; a single pending-command slot queues one command while the socket is closed | `api.js:905-996, 2578-2679` | `app.js:2138-2144`; `settings.js:9853-9895, 10030-10053` |
| `ws/v1/update` | Bidirectional. Receive AppUpdateState `{phase, currentVersion, installable, progress}` or `{error, url}`. Send `{command: 'check'\|'install'}` | `api.js:998-1065` | `settings.js:7569-7605` (Android in-app install) |
| `ws/v1/sensors/{id}/snapshot` | Receive `{timestamp, temperature}` for the milk probe. This shape is not the spec's `{id, values}` | `api.js:574-618` | `app.js:698-748` |
| `ws/v1/plugins/time-to-ready.reaplugin/timeToReady` | Receive `{status: heating\|reached\|not_heating\|insufficient_data, remainingTimeMs, heatingRate}` | `api.js:677-702` | Heating countdown (`app.js:616-619`; `src/modules/heating-countdown.js`) |
| `ws/v1/plugins/decent-profile.reaplugin/profileGenerated` | n/a | `api.js:704-736` | **No caller**, although `docs/API.md:294-297` says it is consumed |

Not used at all: `ws/v1/machine/raw`, `ws/v1/logs` and `ws/v1/webview/logs`.

### 1.6 KV namespaces and keys

| Namespace | Keys | Owner and semantics |
|---|---|---|
| `streamlineSettings` | 39 UI preferences (`SYNCED_KEYS`, `settingsSync.js:38-82`): language, theme, uiZoom, maxStretch, chartLineWidth, help flags, screensaver flags, wakeLock and wakeProfile, water-tank unit and refill level, keyboardBindings, last grind and dose, steam-stop modes, cup-warmer target, DYE2 flags, ecoSteam, ledSequences, settings location, tempUnit, Visualizer switches, and **10 main-page preset keys (new in b0aa1ce)** | localStorage is the working copy; `Storage.prototype` is wrapped to mirror writes (`settingsSync.js:117-145`); boot hydrate with "KV wins" (`152-167`); writes gated until the first successful read (`86-115`); retry ladder 1, 2, 4, 8, 15 s (`169-255`) |
| `streamline-app` | `favorite-profiles` (slot → profile id, 5 slots), `favorite-profiles-initialized`, `profile-drafts` (local-only profile copies) | `profileManager.js:51-68, 242-465`, with an IndexedDB backup |
| `streamline-app` | `last-steam-duration`, `last-steam-flow`, `last-steam-temp`, `last-milk-stop`, `last-flush-duration`, `last-hot-water-volume`, `last-hot-water-temp` | The "record of intent" for workflow tile values, written before the workflow PUT (`api.js:1511-1570, 1612-1744`) and replayed by `resyncIfDrifted` (`1572-1610`). `last-brightness` is kept in IndexedDB only (`api.js:2647-2679`) |
| `streamlineProfileOverrides` | Per profile id: `targetDoseWeight, targetYield, grinderSetting, brewTemperature, targetSteamDuration, targetSteamFlow, weightFlowMultiplier, volumeFlowMultiplier` | `src/modules/profile-overrides.js:1-161`. Moved out of profile metadata because Decaid re-seeds bundled-profile metadata |
| `streamlineFlowCalibration` | `state` = `{baseline, applied}` | `flow-calibration.js:25-27, 105-130` |
| `numpad` | `previous-values-{fieldType}` (up to 8) | `numpad-modal.js:28-43` |
| `streamline` (legacy) | Old user profiles | Read, uploaded to `/profiles`, then deleted (one-time migration, `profileManager.js:120-161`). Do not reuse |
| `visualizer.reaplugin` | `lastUploadedShot` | Read-only poll every 3 s for up to 30 s to confirm an auto-upload (`app.js:575-614`); the plugin writes it via `host.storage` |
| `dye2.reaplugin` | `autoFavourites`, `recipes` (whole arrays) | Read-mostly; whole-array read-modify-write for recipe and favourite auto-save (`api.js:1170-1201`; `dyeStrip.js:973-1143`) |

### 1.7 Plugins (`.reaplugin`)

| Plugin id | How streamline uses it | Where |
|---|---|---|
| `visualizer.reaplugin` | Settings `Username`, `Password` (secure, returned as `{isSet}`), `AutoUpload`, `LengthThreshold`. Endpoints `upload {shotId}`, `verifyCredentials`, `import {shareCode}`. The skin's two switches are ANDed into the plugin's single `AutoUpload` flag. Manual upload from the history long-press menu. Credentials are also kept in localStorage (base64) and re-verified at boot | `visualizer.js:1-70`; `history.js:318-347`; `app.js:2076-2108`; `profile_editor.js:2176-2228`; `settings.js:6975-7116`. Bug: the loader reads `savedSettings.Length` (`settings.js:7103`) while it writes `LengthThreshold` (`:7035`) |
| `shot-upload.reaplugin` | Uploads shots to the user's Decent account through the account proxy. The page is gated on GET `/account/decent`; controls are rendered from the plugin's manifest settings schema; "Upload latest shot" button | `settings.js:5991-6050, 6052-6080, 6246-6400` |
| `calibrated-steam.reaplugin` | "Auto" steam mode. Available only when the plugin is `loaded` and declares http endpoints `status` and `calculate`. Calls time out at 2 s; scale samples are buffered from the scale WS; results are written as workflow `steamSettings` | `src/modules/auto-steam-capability.js:1-15`; `calibrated-steam-ui.js:1-121`; `src/modules/calibrated-steam.js:1-31`; `api.js:46-58, 1688-1694` |
| `time-to-ready.reaplugin` | WebSocket `timeToReady` | §1.5 |
| `dye2.reaplugin` ("Describe Your Espresso") | Owns beans, grinders, notes, ratings, auto-favourites and recipes. Streamline adds: a P/F/R header strip; plugin pages in an iframe or by same-frame navigation with `?return=`; install, enable and update-approval prompts with a minimum version of 0.1.4; recipe and favourite auto-save; clearing stale DYE context from the workflow after each shot and at boot | `dyeStrip.js:1-1169`; `settings.js:6503-6620, 8352-8399` |
| `decent-profile.reaplugin` | WebSocket wrapper only | `api.js:704-736` |
| Any plugin | Generic card: name and description, an Open link if the manifest declares an http `ui` endpoint, enable toggle, version and source, Approve update with the added permissions listed verbatim, settings form from the manifest schema | `settings.js:6482-6535, 6783+, 8228-8320`; `src/settings/plugin-view.js` |

**About `visulizer_REAPLUGIN/`.** It holds reference and dev copies and is **not shipped**: the release whitelist is `index.html`, `skin-manifest.json` and `src/` (`RELEASE.md:49-60`; `.github/workflows/release.yml:38-48`). It was untouched in v0.2.7..v0.2.12. Contents:

- `visualizer.reaplugin` 1.1.0 (`manifest.json:1-89`). It pulls shots from `http://localhost:8080` and uploads to visualizer.coffee. Its `import` posts the profile to `/api/v1/profiles` (`plugin.js:14-16, 391, 517`).
- `time-to-ready.reaplugin` 1.0.0 (`manifest.json:1-46`).
- `settings.reaplugin` "Streamline Settings Viewer", id `Streamline-settings.reaplugin`. It is a Vite-built `ui` endpoint plugin (`settings.reaplugin/manifest.json:1-31`, `package.json:1-16`).

The plugin model these copies show:

- `createPlugin(host)` with `host.log`, `host.emit` and `host.storage`.
- `onEvent` with `storageRead` and `storageWrite`.
- An HTTP request handler keyed on `request.endpoint`.

The plugin model is at `visulizer_REAPLUGIN/visualizer.reaplugin/plugin.js:1-33, 444-485, 624-660`.

### 1.8 Feature walk-throughs

**Boot order:**

1. An inline script applies the theme before first paint (`index.html:14-28`).
2. The classic ReconnectingWebSocket script loads (`:34`), then the `settingsSync.js` module, then `app.js` (`:37-38`).
3. `app.js` awaits `settingsReady` (`app.js:2264`).
4. It initialises scaling, lazy-loads ECharts, starts i18n and units, and sets up the chart and UI.
5. The router runs (`app.js:2266-2296`).
6. `initMainPageOnce` (`app.js:2119-2159`) does the main-page work:
   - history and profiles in parallel;
   - `loadInitialData` (`1479-1752`): GET `/workflow`, paint tiles, KV drift resyncs, GET `/machine/info`, model gates, workflow watch;
   - `initializeDe1Connection` (`2035-2074`);
   - the snapshot, scale, devices, water, time-to-ready, shot-state and display sockets;
   - brightness restore at +1.5 s;
   - forcing gateway mode to tracking;
   - the 5 s data timeout;
   - the milk-probe poll;
   - the shot-settings socket;
   - Visualizer credential verification.
7. Settings data is then prefetched into IndexedDB (`app.js:2171-2198, 2303`).

**Workflow polling.** Decaid has no workflow push channel. The skin re-reads GET `/workflow`:

- every 60 s;
- on `visibilitychange` and `focus`;
- skipping the poll when a tile was touched in the last 5 s, and on sub-pages.

It repaints only the fields that changed; a profile change triggers a full reload (`app.js:1754-1844`; `src/modules/workflow-watch.js`).

**Shot lifecycle:**

- **Start:** substate `preinfusion` or `pouring` while state is `espresso`, with a 5 s restart cooldown (`app.js:957-986, 211`).
- **Stop toast:** owned by the shotState feed. There is a 2 s backstop if the decision frame is lost (`app.js:1208-1230`), and a gateway-full fallback heuristic (`app.js:853-910`; `src/modules/stop-reason.js`).
- **Blocked shots:** `blockOnNoScale` detection (`app.js:866-876, 1846-1856`).
- **History refresh:** poll `/shots` up to 6 × 2 s until the new id appears (`history.js:407-424`).
- **Finalize:** GET `/shots?ids=` for `annotations.actualYield` (`app.js:1385-1403`).
- **DYE context:** cleared after the shot (`app.js:908, 1406`).

**Profile selection.** Profiles are applied as `PUT /workflow {profile (with target_weight = yield, brew temp folded in), context: {targetDoseWeight, targetYield, grinderSetting}}`. Then:

- the tiles are painted from the workflow Decaid echoes back, not from what was sent;
- saved steam settings are applied;
- per-profile flow calibration is pushed to `/settings`.

This happens at `profileManager.js:887-1000, 467-498, 578-605`; `profile_selector.js:260-360`; `flow-calibration.js:132-171`.

**Profile import and share:**

- Import from a local file (`.json`, or Tcl converted by `src/modules/tcl-profile.js`) at `profile_editor.js:2098-2134`.
- Import a Visualizer share code through the plugin's `import` endpoint at `profile_editor.js:2176-2228`.
- After an import, a content-dedup hit on a hidden or deleted record is restored to visible (`profileManager.js:326-348`).
- Share produces a QR code and short link (`qrShare.js`; `profile_selector.js:506-509`).

**Scale:**

- Tapping the weight readout tares if a scale is connected; otherwise it sends a devices-WS `scan` with `connect: true` and polls GET `/devices` for up to 15 to 40 s (`app.js:1080-1181`).
- Auto-retry after a disconnect is limited to 3 retries and 6 waits. It never retries while the machine is asleep or while Decaid is scanning (`app.js:250-338`).
- Scale battery comes from the scale snapshot (`app.js:1036-1043`).

**Grinder.** Only `context.grinderSetting`, a string, which is sent as `toFixed(2)` (`ui.js:308-320`). Grinder entities come from DYE2. **No connected-grinder API is used**; it is not even in the spec copy (§4.3).

**Units.** The temperature unit is skin-local (`src/modules/units.js:1-56`; `tempUnit` is mirrored to KV). The wire is always Celsius. No Decaid-level units or language setting is read.

---

## 2. Skin-host bridges and native features

### 2.1 Injected globals and bridges

| Bridge | Who injects it | How streamline uses it |
|---|---|---|
| `window.__DECENT_HOST__` | Decaid WebView user script at document start: frozen `{app: 'decent.app', platform, version, build, commit}` (`decaid:lib/src/skin_feature/skin_view.dart:806-828`) | **Boolean only**: hides the fullscreen button via `html.is-webview` (`app.js:2313-2339`), WebView detection for help placement (`src/modules/help-launcher.js:7-15`), gate for the dashboard exit (`settings.js:1066-1077`). The version and platform fields are never read |
| `window.decentApp.exitToDashboard()` | `/__decent/skin-api.js`, whose script tag Decaid injects into every served HTML page (`decaid:lib/src/webui_support/webui_service.dart:36-39, 41-68, 96-105, 250-262`). It navigates to `http://localhost:<port>/__decent/exit-dashboard`, and the host only allows it from the currently served port (`decaid:skin_view.dart:46-62`) | A "Go" button on the Decaid Settings page (`settings.js:1058-1077, 1239, 8111`), resolved at click time because the host may inject late |
| `window.__REA_PROXY_TOKEN__` | The same `skin-api.js`, read from an injected `<meta name="reaprime-proxy-token">` (`webui_service.dart:38, 96-100`) | Bearer token for `/account/proxy/support/api/*`; the read-only `account:proxy` scope (`settings.js:8411, 8473, 8531`; `rest_v1.yml:5109-5136`) |
| postMessage, JavaScript channels, `callHandler` | n/a | **None.** A grep for `postMessage`, `flutter_inappwebview`, `callHandler`, `messageHandlers` and `JavascriptChannel` in `src/` finds nothing |

### 2.2 Navigation, exit and Decaid settings

**External links.** Any cross-origin http(s) anchor tap is converted into `window.location.assign(href)`, a same-frame top-level navigation. The host's `shouldOverrideUrlLoading` then opens the OS browser. `target="_blank"` dies in the WebView (`app.js:2200-2223`; also `src/modules/derek-modal.js:69-72`; `dyeStrip.js:618-620`; `settings.js:7547-7552`). The host allows these inside the WebView (`decaid:skin_view.dart:46-62`):

- `http://localhost:{skinPort|3000}`;
- `http://localhost:8080/api/v1/plugins/*`.

Everything else opens externally.

**Exit to the dashboard:**

- The `decentApp.exitToDashboard()` button.
- On Android the system back gesture is captured by Decaid (`PopScope canPop: false`) and **exits to the dashboard** (`decaid:skin_view.dart:339-352`).
- So streamline never relies on OS back. Every in-page back calls `loadPage('index.html')` (`src/modules/router.js:146-149`; `src/settings/settings-shell.js:261, 270`; `profile_selector.js:350, 363`; `profile_editor.js:3408`; `settings.js:8017, 8048`).

**Opening Decaid's own settings.** There is no bridge for it. Account linking is "in the Decent app" (`settings.js:6299-6304`), and the exit button goes to the dashboard.

**Skin switching.** The sequence (`settings.js:9230-9295`; `docs/skin-switching.md:1-60`) is:

1. `PUT /webui/skins/default`, then verify with a GET.
2. Stop and start the web server.
3. Poll `/webui/server/status` until it reports serving (up to 20 s).
4. Wait 1.2 s.
5. `location.assign(http://host:3000/?_=…)`, with one retry at 3 s.

**Routing.** Routes are query-string based (`?page=index|settings|profile_selector|profile_editor`) with `pushState` and `popstate` (`router.js:4-44, 85-88`). Sub-page HTML is fetched and injected into `#subpage-host` with cleanup (`router.js:76-83, 146-218`). Direct boot onto a sub-page is supported (`router.js:29-36`; `app.js:2298-2300`).

### 2.3 Reload, background and foreground

**Reload:**

- Only after a skin update (`settings.js:9297-9314`).
- Never automatically on disconnect; the reload is commented out (`api.js:505-509`).
- Returning from a plugin page can restore a bfcache snapshot, so DYE2 data is re-polled on `pageshow`, plus once at +500 ms (`dyeStrip.js:876-884`).

**Visibility and focus:**

- Workflow tile refresh (`app.js:1836-1844`).
- DYE2 KV re-poll (`dyeStrip.js:868-875`).
- Deferred chart flush (`chart.js:1511-1528`).

**Wake lock.** Only through Decaid: REST POST and DELETE `/display/wakelock`, re-armed whenever the display socket opens because the override is scoped to that connection (`api.js:932-937, 2681-2724`). `navigator.wakeLock` is not used.

**Brightness.** Brightness goes over the display WS. Decaid does not persist it, so the skin remembers it in IndexedDB and replays it at boot. The behaviour is spread across:

- `api.js:2578-2679`: dim on sleep to 10, or 0 with the "black screen saver"; restore to `requestedBrightness`, not to 100;
- `settings.js:10030-10053`;
- `app.js:2139-2144`.

**Screensaver.** It is a pure function of the machine's confirmed state, and only an explicit tap may wake the machine (`src/modules/screensaver-policy.js:1-161`; `app.js:621-666`; `ui.js:1647-1726, 2230-2277`).

### 2.4 Display geometry, safe areas and keyboard

**Viewport.** `<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=overlays-content">` (`index.html:5`). There is no `viewport-fit=cover`.

**Fixed design canvas.** The layout is a 1920×1200 canvas transformed with `translate` plus `scale(sx, sy)` (`src/modules/scaling.js:3-8, 104-238`):

- taller screens grow the canvas;
- shorter screens squash it up to `maxStretch`;
- there is a `uiZoom` user zoom;
- the UI is revealed only after the size holds for 3 frames, or after 600 ms (`scaling.js:240-257`, commit ec6fd6a).

**Safe areas.** Only some overlays use `env(safe-area-inset-*)`: `src/css/context-menu.css:125-128`, `help-overlay.css:6-7, 39-40`, `notes-modal.css:27`. Decaid disables `SafeArea` on all sides (`decaid:skin_view.dart:334-341`).

**Soft keyboard.** The canvas keeps its pre-keyboard height and is *lifted* by the focused field's overlap with the keyboard. It reads `visualViewport` because some WebViews only shrink that, and recomputes on `focusin` and `focusout`. Geometry writes are deduplicated (`scaling.js:104-138, 213-227, 272-284`, commit b10fabe).

**Touch numpad.** A custom numpad replaces the soft keyboard on touch devices (`src/modules/numpad-policy.js:1-7`; `app.js:69-184`; `numpad-modal.js`).

**Hardware keyboard.** Shortcuts map keys to machine states on non-GHC machines and are rebindable (`app.js:1996-2033`; `src/modules/machine-shortcut.js:1-21`; `settings.js:10651-10780`).

**Fullscreen and rotation.** Fullscreen and Add-to-Home prompts appear in browsers only (`app.js:2341-2440`). The rotation prompt uses `screen.orientation.lock` (`scaling.js:31-102`).

### 2.5 Files, share, clipboard, camera, bookmarks

**File pickers:**

- profile import, `.json` or `.tcl` (`profile_editor.js:2098-2134`);
- firmware (`settings.js:7512, 9183-9201`);
- screensaver images, stored as data URLs in IndexedDB, so they are lost on an app update (`settings.js:2165, 8177-8197`);
- a legacy upload dialog (`index.html:407-421`; `profileManager.js:1457-1458`).

**Share.** QR code plus short link through an external Decent service, with clipboard copy. **No Web Share API.**

**Clipboard.** `navigator.clipboard` is missing in the insecure `http://` context, so the `document.execCommand('copy')` fallback is what runs on tablets (`qrShare.js:216-236`; `history.js:261-277`; `settings.js:10831-10843`).

**Camera and bookmarks.** None.

---

## 3. The in-app "Derek" chat (6132f8a)

### 3.1 What it is

- **Entry point.** Long-press the shot-history panel, then choose **"Discuss with Derek"** (`history.js:293-330`).
- **What happens.** The skin builds a Markdown summary of the shot on screen (loading its measurements if needed, `history.js:247-286`). It then lazy-loads `src/modules/derek-modal.js` and calls `openDerekModal(md, {onOpenExternal: copy summary})` (`history.js:316`).
- **The modal.** It is full-screen inside `#scaled-content`, with Derek's avatar bundled at `src/ui/derek.webp` (`derek-modal.js:45-76`; `src/css/derek-modal.css`).
- **First message.** It sends the summary immediately, labelled for the user as "Shot summary sent to Derek" (`derek-modal.js:141`), and streams the answer.
- **Follow-ups.** The user can type follow-up questions (`:133-139`).
- **Open in browser.** A same-frame anchor to `https://derek.decentespresso.com/`, which also copies the summary to paste there (`:56, 69-72`).
- **Closing.** Close aborts the stream and removes every node, so the modal can be reopened safely (`:38-43`).

**Before this commit** (v0.2.7 to v0.2.9), "Discuss with Derek" was an anchor to `https://derek.decentespresso.com/` that opened the OS browser and copied the summary to the clipboard (`git show 6132f8a -- src/modules/history.js`). **README §11 still describes that old behaviour** (`README.md:509-528`).

### 3.2 Transport: through Decaid, not a plugin

- **Wrapper.** `streamDerekAnswer(query, onEvent, signal)` sends `POST ${API_BASE_URL}/derek/answers/stream` with JSON `{query, include_documents: true, include_videos: true}`. It reads `res.body.getReader()` incrementally and parses SSE with `parseSse` (`api.js:3052-3073`; `src/modules/derek-stream.js:3-20`).
- **What Decaid does.** It is a dumb relay. It forwards the body verbatim to `https://derek.decentespresso.com/api/answers/stream` and pipes back the SSE response unbuffered, with `Cache-Control: no-cache` and `X-Accel-Buffering: no` (`decaid:lib/src/services/webserver/derek_handler.dart:1-40`; `rest_v1.yml:5252-5301`).
- **No authentication.** There is no Decent account or token: "Derek is public knowledge-base data". Validation and rate limits (for example a 429) are Derek's, relayed verbatim.
- **Why it exists.** Derek's server does not answer CORS preflight, so a browser skin cannot call it directly (`rest_v1.yml:5258-5266`; `decaid:doc/plans/archive/derek-relay/derek-relay.md:5-30`).
- **Not a plugin.** `docs/API.md:299-308` says so explicitly.
- **Which LLM.** Derek is described only as "the Derek RAG assistant" over Decent's documents and videos. **Neither repo names the model or provider.**
- **SSE events.** Derek emits `queue`, `phase`, `delta` (draft text), `result` (final answer or snippet fallback) and `error` (`rest_v1.yml:5287-5293`).
  - Streamline renders `delta.text` (accumulated) and `result.answer_text`. It ignores `queue`, `phase` and `error`.
  - So an `error` event shows "No answer received", and a transport failure shows "Could not reach Derek" (`derek-modal.js:102-131`).

### 3.3 What shot data is sent, and in what format

**Query text.** All prefixes are English:

- **First message:** `"Here is the summary of my latest espresso shot. Please review it and suggest what to adjust.\n\n" + summaryMd` (`derek-stream.js:22-26`). The text says "latest" even when the user has paged back to an older shot.
- **Follow-ups:** `"Context: my espresso shot summary.\n\n" + summaryMd + "\n\nQuestion: " + question` (`derek-stream.js:28-31`).
- **Statelessness:** "Derek's endpoint is stateless, so follow-ups re-send the shot as context." **Previous Derek answers and earlier user questions are not sent**, so every turn is independent apart from the summary.

**Summary format.** `generateShotSummary(shot)` in `src/modules/shotSummary.js:1-91` takes the GET `/shots/{id}` record and builds a Markdown document. It existed before v0.2.7 and is also used for "Copy Shot Summary".

- **Extraction window:** samples from the first one whose substate is not `preparingForShot`. Times are in whole seconds from that point (`shotSummary.js:20-25`).
- **Header (`## Shot Summary`):**
  - `Dose` = `annotations.actualDoseWeight ?? context.targetDoseWeight`;
  - `Yield` = `annotations.actualYield ??` the last scale weight;
  - the target yield and its deviation;
  - the ratio 1:x;
  - the duration;
  - overall peak pressure and flow with their times (`:27-51`).
- **Phase data (`## Phase Data`):** samples are grouped by consecutive `machine.profileFrame`. Each phase prints:
  - the step `name` (or `Frame n`) and its duration;
  - `PRESSURE-CONTROLLED`, `FLOW-CONTROLLED` or `UNKNOWN`, from `step.pump`;
  - peaks within the phase;
  - Start and End rows formatted `pressure(targetPressure)bar flow(targetFlow)ml/s mixTemperature(step.temperature)°C weight g` (`:52-88`).

**Not sent:**

- profile title or notes;
- grind setting, grinder, beans, roast date;
- `stopReason`;
- `enjoyment`, `drinkTds`, `drinkEy`, `espressoNotes`;
- group or puck temperature, weight flow, water volume;
- the raw time series.

**Rendering.** Answers render as minimal Markdown: bullets, `**bold**`, and headings stripped. Everything goes through `textContent`, never `innerHTML` (`derek-modal.js:15-36`; `derek-stream.js:33-37`).

**Tests.** `test/derek-stream.test.mjs:1-26` covers the SSE parser (partial tail, CRLF, malformed frames), follow-up query shape and bold splitting.

**i18n gap.** None of the new UI strings is in the committed translation CSV: "Discuss with Derek", "Open in browser", "Ask a follow-up question", "Derek is thinking…", "No answer received", "Could not reach Derek", "Shot summary sent to Derek", "Send". English is the fallback key; the release workflow may still add them from Google Sheets.

### 3.4 Relevance to CafAI

- **What Decent ships natively.** A generic RAG chat with a stateless, text-only shot summary. There is no dial-in loop, no history across shots, no bean or grind context, and no structured output.
- **What CafAI can reuse.** Decaid's Derek relay is open to any skin with no auth: POST `/api/v1/derek/answers/stream` with `{query}`. CafAI could offer Derek as a secondary "ask Decent's knowledge base" source while keeping its own coach.
- **SSE event set.** `queue`, `phase`, `delta`, `result`, `error`.
- **Practical rules.** Read with `fetch` plus `ReadableStream` (no `EventSource` for POST), and abort the stream when the modal closes.

---

## 4. Engineering practices

### 4.1 Stated conventions a third-party skin should follow

Sources: `AGENTS.md:1-49`, `CONTRIBUTING.md:1-236`, `docs/AI_*.md`, `RELEASE.md`, `Skins.md`, `DESIGN_SYSTEM.md`.

**Architecture and transport:**

- **One connection stack.** All Decaid REST and WS goes behind `api.js` and its socket helpers, with never a second stack (`AGENTS.md:18`; `CONTRIBUTING.md:81-83`). They violate this themselves: `history.js:52-116, 451-470` and `settings.js:8406-8568` fetch directly.
- **Boot order.** Hydrate durable preferences before any read; `settingsSync.js` first, then await `settingsReady` (`AGENTS.md:17`; `docs/AI_STORAGE_NOTES.md:47-71`).
- **Idempotent mounts.** Every listener, timer, socket and chart has cleanup, and late async results must not render into a newer route (`AGENTS.md:19`; `docs/AI_RUNTIME_NOTES.md:44-56`).
- **Errors at the boundary.** Check `response.ok` before parsing; distinguish abort, timeout, disconnect, validation and server errors; keep retries bounded; never turn a safety-critical failure into success (`docs/AI_API_NOTES.md:77-84`).

**Machine safety:**

- **Machine control is a review gate.** Validate and clamp at the skin boundary; never forward an unvalidated number from a plugin, scale or user input into a machine write; fail safe to manual behaviour with visible state (`CONTRIBUTING.md:104-116`; `docs/AI_API_NOTES.md:43-56`).
- **Shot settings.** Never post the zero-initialised cache (`docs/AI_API_NOTES.md:54`).
- **Display writes.** Go through the single queue (`:56`).

**Data and storage:**

- **Profiles.** Always use the workflow API to change the active profile, never `POST /machine/profile` (`docs/API.md:224-228`; `docs/AI_API_NOTES.md:58-69`).
- **KV.** Pick your own namespace and never write into someone else's (`docs/API.md:278-279`). Never put secrets in the synced KV namespace (`AGENTS.md:26`; `docs/AI_STORAGE_NOTES.md:63-71`). Document any new namespace (`docs/AI_STORAGE_NOTES.md:73-84`).

**Plugins:**

- Optional features with their own logic or storage belong in a Decaid plugin, not the skin.
- The skin discovers plugins generically, capability-driven, and does nothing when the plugin is absent (`CONTRIBUTING.md:156-170`).

**WebView:**

- The in-app WebView is a primary runtime.
- Use same-frame navigation for external links.
- Lead with feature detection; user-agent checks are a fallback (`docs/AI_RUNTIME_NOTES.md:69-76`; `docs/AI_UI_NOTES.md:66-74`).

**Naming.** Use "Decaid" in prose; keep `reaHostname`, REA-named functions and legacy namespaces as compatibility identifiers (`AGENTS.md:11`).

**Process:**

- Conventional Commits.
- An issue first for external PRs.
- No version bumps or skin-identity changes in contributions.
- AI-assisted work is allowed but the human owns it (`CONTRIBUTING.md:25-39, 146-154, 172-216`).

**Not useful as guidance:** `SKILL.md` is just a generic "clean-code-reviewer" agent prompt, and `DESIGN_SYSTEM.md`, `rewrite_roadmap.md` and `settings_ui.md` are historical. The repo's own map says not to treat these as authority (`docs/AI_REPO_MAP.md:39-49`; `docs/AI_LEGACY_NOTES.md:5-18`).

### 4.2 Language, types, validation and tolerance

**Language.** Plain JavaScript (ES modules; `src/package.json` sets `"type": "module"`). There is **no TypeScript**, no `tsconfig`, no `checkJs` and no type generation. JSDoc appears sporadically (for example `api.js:296-300, 335-347, 380-411`).

**API types.** All shapes are **hand-written** in wrapper functions and prose comments, frequently citing Decaid Dart files. The spec copies are references for humans and agents, not inputs to code.

**Runtime validation.** Ad hoc, with no schema library:

- `isValidProfile` checks required keys and uses `alert()` (`api.js:1322-1368`);
- profile sanitisation before writes (`api.js:1205-1237, 1395-1421`);
- clamps at choke points: milk stop 0..80 (`api.js:1732-1744`), brightness 0..100 (`api.js:2649-2654`), auto-steam (`src/modules/auto-steam-safety.js`), sensor calibration within Q16.16;
- pure parsers that return a "know nothing" result on malformed input (`machine-link.js:26-58`; `heating-countdown.js`);
- per-frame `JSON.parse` wrapped in try/catch everywhere.

**Tolerance of unknown values and missing fields:**

- Open-set stop reasons fall through to a generic message (`app.js:1285-1288`). The spec demands this (`websocket_v1.yml:593-600`; `rest_v1.yml` `ShotRecord.stopReason`).
- Unknown machine states are rendered by splitting camelCase (`app.js:186-199`).
- Unknown device-connect outcomes have a default branch (`settings.js:10535-10538`).
- `?? null`, optional chaining and `?? fallback` are pervasive.
- `getDye2KvArray` coerces non-arrays to `[]` (`api.js:1182-1194`).
- `getPlugins` returns null versus `[]` for failure versus none (`api.js:2449-2460`).

**Feature detection.** By response shape, never by Decaid version:

- `?full=1` key-array fallback (`api.js:1123-1134`);
- `currentTemperature` absent on older cup-warmer builds (`api.js:1800-1811`);
- pre-warm fields come back null when unsupported (`api.js:1828-1850`);
- device `available` absent on older builds (`settings.js:10424-10429`);
- DeviceConnectResult awaited with a 20 s timeout fallback (`api.js:854-879`);
- secure plugin settings `{isSet}` versus legacy cleartext (`profile_editor.js:2192-2198`);
- plugin capability from manifest `api` endpoints (`auto-steam-capability.js:5-15`; `settings.js:6486-6490`);
- the manifest settings schema rendered at runtime because "Decaid updates underneath us" (`settings.js:5993-6012`);
- Bengle by model string (`machine.js:3-37`);
- `GHC === false` (`app.js:1730`).

**No version gating.** `GET /api/v1/info` is display-only, and `__DECENT_HOST__.version` is unused.

**Offline and errors:**

- `settingsReady` always resolves.
- KV write gate and retry ladder.
- IndexedDB caches for profiles (`profileManager.js:211-239`), settings (`settings.js:646-697, 7762-7840`) and shots (`src/modules/idb.js`: DB `shot_history` v9 with shots, summaries, settings and emails stores).
- Settings shows "Unable to reach De1, retrying every 3 seconds" (`settings.js:7834-7852`).
- Cache-first chart paint (`history.js:25-75`).
- Toasts for user-facing errors.
- The logger is silent for debug and info by default (`src/modules/logger.js:1-18`), partly because the host captures WebView console output (`app.js:842-848, 1072-1076`).

### 4.3 How the spec copies are maintained

| Check | Finding |
|---|---|
| Formats | `rest_v1.yml` (OpenAPI 3.0.3) and `websocket_v1.yml` (AsyncAPI 3.0.0) at the repo root |
| Sync mechanism | **Manual copies.** No script, workflow or test refreshes them (repo-wide grep). They were **not changed** in v0.2.7..v0.2.12 (`git diff --stat cb058ca..57e8b44`) |
| Staleness | Versus Decaid af4e995 the copy lacks 10 operations: `GET /bean-batches`, `GET /diagnostics/ble`, `GET /grinder/info`, `GET /grinder/state`, `PUT /grinder/state/grinding`, `PUT /grinder/state/idle`, `PUT /grinder/setting`, `PUT /grinder/rpm`, `GET /scale/info`, `PUT /scales/{id}/tare`. It also lacks 2 channels, `ws/v1/grinder/snapshot` and `ws/v1/scales/{id}/snapshot`. The copy has 149 operations against Decaid's 159. Evidence: `cafai-audit\streamline-work\ops_*.txt` |
| Machine-usability | The copy has a `null` request-body media type on `POST /machine/firmware`, which makes `openapi-typescript` crash on it (my listing script flags it; the sibling run's `typegen/gen/otsgen.streamline.log` shows the crash) |
| Known drift | Code comments document where the copy is wrong: sensors `info.data` versus `dataChannels` (`api.js:155-163`); sensor snapshot shape (`api.js:574-581`); `cleaingGroup` typo (`test/maintenance-progress.test.mjs:171`) |
| Contract tests | Only one test reads the spec: `test/led-sequence.test.mjs:207-224` regex-parses the `MachineState` enum from `rest_v1.yml` |

### 4.4 Tests, build, CI and release

**Tests.** `node --test`, with 86 files under `test/` and no dependencies, DOM or jsdom (`test/README.md:1-36`; `docs/AI_BUILD_NOTES.md:56-79`). Two styles:

- (a) **Pure-module unit tests** of extracted DOM-free helpers. Examples: socket-slot, machine-link, screensaver-policy, stop-reason, steam-mode, flow-calibration, profile-overrides, firmware-progress, derek-stream, and settingsSync hydrate and write-gate (`test/settings-persistence.test.mjs`).
- (b) **Source-invariant tests** that `readFileSync` production files and regex-assert patterns. Examples:
  - `test/settings-sync.test.mjs:421-462` asserts every preset key is in `SYNCED_KEYS`;
  - `test/tablet-touch.test.mjs` checks the hover config;
  - `test/startup-resources.test.mjs` covers the boot asset list;
  - `test/webview-compat.test.mjs:1-45` **bans post-Chromium-92 APIs** (`Array.at`, `structuredClone`, `Object.hasOwn`, `findLast`, `toSorted`, `Object.groupBy`) across `src/` and `index.html`.

**No CI runs the tests.** `release.yml` only stages, validates and zips; `static.yml` deploys Pages (`docs/AI_RELEASE_NOTES.md:44-62`).

**Build:**

- Tailwind 3 plus daisyUI 4 build `src/css/app.css`;
- esbuild produces a tree-shaken ECharts bundle;
- both outputs are committed and never hand-edited (`package.json:6-12`; `docs/AI_BUILD_NOTES.md:20-44`);
- vendored libraries (EasyMDE, iro, qrcodegen) are lazy-loaded as classic-script globals (`src/modules/vendor-loader.js:1-56`);
- there is no app bundler.

**CI** (`.github/workflows/release.yml:1-115`):

- every push to `main` force-pushes a whitelisted orphan `dist` branch, with the manifest id rewritten to `streamline.js-dist` so it can install alongside the release (`:65-73, 93-101`);
- a `v*` tag stages the whitelist, rewrites the manifest `version` from the tag, validates the id and version, rejects Win32-reserved filename characters, zips `streamline.js-vX.Y.Z.zip` with the whitelist at the archive root, and publishes a GitHub Release with generated notes;
- translations are pulled from a secret Google Sheets URL first (`:17-28`);
- `static.yml` publishes the **whole repo** to GitHub Pages (`.github/workflows/static.yml:1-43`).

**Packaging and versioning:**

- `skin-manifest.json` is `{id: "streamline.js", name, description, version}` (`skin-manifest.json:1-6`).
- Each release commit bumps `README.md`, `package.json`, `package-lock.json`, `skin-manifest.json` and `src/version.js` together (`git show --stat 57e8b44`).
- `APP_VERSION` keys the i18n cache (`src/modules/i18n.js:40`) and is compared with the on-disk skin version to offer "reload to apply" (`src/version.js:1-9`; `settings.js:9297-9314`).
- `test/version.test.mjs:11-22` pins the id and the version format.

**i18n:**

- One CSV with 32 language columns (`src/ui/de1 gui translation - Sheet1.csv`), synced from Google Sheets at release.
- `data-i18n-key` plus `translatePage()`; English falls back to the key; there is a per-version IndexedDB parse cache.
- Text is fitted to its box (`i18n.js:1-80`; `src/modules/i18n-parser.js:1-58`; `docs/AI_UI_NOTES.md:46-64`).

**Settings model:**

- `src/settings/settings-tree.js:1-107` is the single navigation source (11 categories, with `bengleOnly` gating).
- A lightweight shell renders first and lazy-loads the 10.8K-line legacy `settings.js` for categories not yet extracted (`docs/AI_SETTINGS_NOTES.md:5-62`).
- `settings-data.js` handles staged and committed state with a race-safe save loop (`src/settings/settings-data.js:1-148`).
- Edits are staged and flushed on save (`settings.js:240-310`).
- An IndexedDB "user machine settings" record **silently re-applies DE1 settings that drifted** away from what the user set in this skin, once per settings visit (`settings.js:684-781`).
- `settings_ui.md` is a component catalogue plus an old plugin-UI plan. `settings_descriptions.txt` lists description strings not yet translated (both unchanged since at least v0.2.7).

**Accessibility:**

- Semantic buttons, `aria-label`, `aria-pressed` on toggles (for example `app.js:1941-1944`; `settings.js:1133-1137`), an `aria-live="polite"` region (`index.html:327`) and translated labels.
- Hover styles are guarded for touch (bd4f254).
- Gaps:
  - the Derek modal has no dialog role or focus management (`derek-modal.js:49-65`);
  - BLE device names are injected unescaped into `innerHTML` (`settings.js:10475`), contrary to `docs/AI_UI_NOTES.md:39`.

---

## 5. Changes from v0.2.7 to v0.2.12 (`cb058ca..57e8b44`)

**Size of the range.** 37 files changed, +2647 / −486 lines.

**API footprint changes:**

- **The only new Decaid API:** `POST /api/v1/derek/answers/stream`.
- **The only `api.js` change:** `+24` lines, adding `streamDerekAnswer`.
- **No spec-copy changes.**

| Commit | Release | What and why | New Decaid API / native feature / pattern |
|---|---|---|---|
| 37f5ad8 (+54de38f merge #94) | 0.2.8 | Hide zero "Maximum" limits on collapsed profile-editor step cards | UI only |
| 0c98ee3 | 0.2.8 | All-caps button text in the profile editor | UI only |
| 32872ca | 0.2.8 | Fix the descaling-instructions URL (`maintenance.js:111`) | n/a |
| 433af0d | 0.2.8 | **Harden scale "Retry" scan.** A fixed 15 s budget toasted about 1 s before an explicit scan's connect landed. It now waits out `scanning`, allows a 4 s grace, and caps at 40 s (`app.js:1117-1153`) | **Pattern:** follow the devices-WS `scanning` flag rather than fixed timers |
| bd4f254 (#96) | 0.2.8 | **Touch sticky-hover** produced fake selections. Fixed with Tailwind `hoverOnlyWhenSupported`, which wraps every `hover:` in `@media (hover: hover) and (pointer: fine)`; tests guard the config and the bundle | **WebView pattern:** guard hover styles on touch tablets |
| 609c236, 340024c | 0.2.8 | Profile-editor fixes; merge with `app.css` rebuilt from source | UI |
| b471ce3 | 0.2.8 | Dark-theme style-guide pass on the selector and editor. Also a **heating countdown fix**: frames without an estimate are ignored, the deadline holds at 1 s, with a 10 s overrun grace (`heating-countdown.js`; `app.js:617-619`) | Pattern: time-to-ready frames are noisy, so keep the last estimate |
| bec9ece | 0.2.8 | Selector search follows the hidden toggle, stays open, uses a fixed scrollbar thumb; listener cleanup | UI |
| 1b4feaf | 0.2.8 | Selector chart, notes and plot margins aligned to Figma | UI |
| 97f3711 | 0.2.8 | chore(release) v0.2.8 | n/a |
| 7aa2ddb | 0.2.9 | **`html, body { overscroll-behavior: none }`** because the Android WebView stretches the page on overscroll (decaid#963) (`src/input.css:4-6`). Temperature labels renamed Group/Mix to Coffee/Water | **WebView rule** |
| ae91929 | 0.2.9 | **Profile share via QR.** The profile is gzipped with `CompressionStream` and base64url'd, POSTed to Decent's short-link store, and the short `…/s/<id>` URL is QR-coded with vendored qrcodegen. If the store is unreachable it falls back to a long fragment URL, dropping notes if needed. Copy uses an `execCommand` fallback. Also draggable editor scroll thumbs with scale-correct drag | **Native features:** external share service (not Decaid), clipboard fallback, `CompressionStream` feature-detected |
| 638e15e | 0.2.9 | chore(release) v0.2.9 | n/a |
| 043a513 | 0.2.10 | Profile-list scrollbar gutter (Figma) | UI |
| ec6fd6a | 0.2.10 | **Hide the UI until the viewport size is stable at startup.** Native WebViews report a stale `innerWidth`/`innerHeight` at boot, so the reveal waits for 3 unchanged frames or 600 ms (`scaling.js:240-257`) | **WebView rule** |
| d8c489b | 0.2.10 | Per-card Maximum height in the editor; chart colours bound to style-guide tokens with transparent backgrounds | UI |
| 6132f8a | 0.2.10 | **In-app Derek chat** (§3), plus a selector text-colour fix | **New Decaid API** `/derek/answers/stream`; SSE streaming via fetch reader |
| cc4bcdc | 0.2.10 | Rebuild generated CSS; the startup reveal test now asserts behaviour instead of exact text | Practice: assert behaviour |
| 845d47e | 0.2.10 | chore(release) v0.2.10 | n/a |
| b10fabe | 0.2.11 | **Soft keyboard.** Lift the canvas by the focused field's overlap (`scrollIntoView` cannot work in an `overflow: hidden`, transform-scaled container); read `visualViewport`; recompute on `focusin`/`focusout`; skip identical geometry writes to stop per-frame resize storms (`scaling.js`); per-frame coalescing of the editor scroll handlers; tests in `test/scaling-fit.test.mjs:96-127` | **WebView rule** |
| b0aa1ce | 0.2.11 | **Main-page quick presets survive app updates.** Presets moved from IndexedDB (origin-bound, wiped by every Decaid app update) to localStorage keys mirrored into the KV namespace `streamlineSettings`. A one-time read promotes old IndexedDB values. Milk-stop presets are now persisted. `SETTINGS_RESTORED_EVENT` re-runs loaders when a late KV hydrate lands (`settingsSync.js:21-26, 68-81, 212-215`; `ui.js:1116-1215`; tests in `test/settings-sync.test.mjs:421-462`) | **Pattern:** anything that must survive an app update goes to Decaid KV, not WebView storage, and late hydrates must repaint |
| 316242c | 0.2.11 | chore(release) v0.2.11 | n/a |
| 9901761 | 0.2.12 | Profile-editor and selector fixes: Figma disabled states for the stepper ends, two-line chip labels, row-padding budget | UI |
| 57e8b44 | 0.2.12 | chore(release) v0.2.12 | n/a |

---

## 6. Platform rules (Decaid and WebView quirks, required orders, timings)

1. **The WebView starts before Decaid's web service.** The first KV read can fail.
   - Never write the durable store until one read has succeeded.
   - Retry in the background at 1, 2, 4, 8 and 15 s.
   - Never block first paint on it.
   - Repaint when a late hydrate lands.
   - (`settingsSync.js:86-115, 169-255`; `ui.js` preset restore listener added in b0aa1ce.)
2. **A Decaid app update or reinstall wipes WebView localStorage and IndexedDB.** So does serving the skin from a different port. Persist user intent in Decaid KV, which lives in Decaid's Hive box and is included in backups (`settingsSync.js:1-13`; `profile-overrides.js:4-15`; b0aa1ce).
3. **KV writes fired just before navigation need `fetch(…, {keepalive: true})`.** Otherwise they are cancelled on unload, and "KV wins" then restores stale data (`api.js:1143-1153, 1161-1166`).
4. **Decaid re-seeds bundled-profile metadata on boot.** Never store user values in profile `metadata`; key them by profile id in your own KV namespace. KV keys come back percent-encoded from `?full=1` (`profile-overrides.js:4-15, 71-75`).
5. **`POST /profiles` is content-addressed.**
   - An unedited duplicate dedups onto its source.
   - An import can resolve to a hidden or deleted record, which must be restored to visible.
   - DELETE is soft, so filter `visibility === 'deleted'`.
   - `workflow.profile` carries no `id`, so fingerprint it to detect a profile switch.
   - (`profileManager.js:62-68, 184-195, 326-348`; `dyeStrip.js:1083-1104`; `docs/API.md:214-217`.)
6. **`PUT /workflow` deep-merges.** A `profile` sent as only `{id, title}` relabels the running profile without changing its steps; always send the full profile (`dyeStrip.js:231-259`).
7. **`PUT /workflow` uses a strict Dart deserializer.** Unsupported fields can stall it, so before sending:
   - strip the legacy Tcl fields (`type`, `legacy_profile_type`, `lang`, `hidden`, `reference_file`, `changes_since_last_espresso`);
   - per step, keep only the active pump field;
   - null a limiter whose value is 0;
   - keep only `pressure` or `flow` exits; fold weight exits into `step.weight`.
   - (`api.js:1205-1237, 1395-1421`.)
8. **`PUT /workflow` can sit in Decaid's queue for 30 s and return 503 (decaid#634).** Write the KV "record of intent" **before** the PUT, and resync only on real drift (`api.js:1572-1610, 1612-1686`).
9. **Rate-limit drift corrections.** Allow one push per field per 30 s. A lagging DE1 echo alternated old and new values and produced 190 `PUT /workflow` calls in 27 s (decaid gh-678) (`app.js:1420-1466`).
10. **Non-autonomous machines stop on `profile.target_weight`, not `context.targetYield`.** Fold the yield into the sent profile (`ui.js:217-223`; `profileManager.js:940-949`). Brew temperature means rewriting every step's `temperature` (`ui.js:285-305`).
11. **Steam heater rules.**
    - Steam `duration` alone does not control the heater; `targetTemperature: 0` turns it off.
    - Remember the last enabled temperature and restore it on re-arm.
    - Enabled range is 135-160 °C (DE1) or 135-165 °C (Bengle).
    - `stopAtTemperature` is clamped to 0..80.
    - (`api.js:1644-1686, 1730-1744`.)
12. **`POST /machine/shotSettings` writes the whole object.** Never send it before the first `ws/v1/machine/shotSettings` frame has filled the cache (`api.js:134-145, 1503-1509`).
13. **Flow multipliers are Decaid-wide settings read when a shot arms.** Per-profile values must be pushed to `/settings` on every profile switch, then restored to a baseline afterwards (`flow-calibration.js:1-20, 132-171`).
14. **Force `gatewayMode = 'tracking'` at boot.** Decaid then sequences the shot (stop at weight, shotState decisions) while the skin draws the chart (`api.js:2108-2128`; `app.js:2145`).
15. **Machine-bound sockets can go open-but-silent after a power-cycle.** Treat `ws/v1/devices` as the link authority (edge-triggered), and re-open sockets close-before-open. A 5 s silent snapshot leads to a `GET /devices` probe, rate-limited to 10 s (`app.js:386-439, 523-569`; `machine-link.js`; `socket-slot.js`).
16. **`ReconnectingWebSocket.close()` must be final.** Patch the library (`reconnecting-websocket.js:208-224`).
17. **The display wake-lock override is scoped to the display socket.** Re-request it on every reconnect. Brightness is not persisted by Decaid, so restore it at boot after about 1.5 s. Restore `requestedBrightness`, because 100 means "hand back to the OS". A machine `error` (BLE drop) must release a sleep dim (`api.js:932-937, 2603-2679`; `screensaver-policy.js:141-161`; `app.js:2139-2144`).
18. **Never derive a machine command from a snapshot.**
    - Only explicit user taps may wake the machine.
    - Raise the screensaver only on a confirmed `sleeping` state.
    - Hold a 3 s wake grace to avoid flicker.
    - Guard the sleep button against double taps.
    - (`screensaver-policy.js:1-139`; `ui.js:2230-2277`.)
19. **A sleeping DE1 drops cleaning and descaling requests.** First `PUT /state/idle`, wait for confirmation, then start. Descaling needs the steam heater off and the boiler cooled first (`maintenance.js:196-238, 292-327`).
20. **Device scanning:**
    - `GET /devices/scan` can block 15 to 41 s; abort at 20 s and use `/devices` (`api.js:178-212`).
    - Connect results arrive asynchronously on the devices WS; match on `deviceId` and `operation` (`api.js:854-879`).
    - USB and integrated scales never reach `state: 'connected'`, so a weight frame is the proof (`app.js:1128-1141`).
    - Do not scan for a scale while the machine sleeps or in the 4 s after wake: Decaid's ScaleWatch reacquires passively, and scans cause GATT 133 errors (`app.js:265-305, 828-838`).
    - Ignore `adapterOff` and permission banners while the machine is connected over USB (`app.js:505-510`).
21. **Shot data timing and ordering:**
    - The shot record persists seconds after the stop, so poll for it (`history.js:407-424`).
    - `annotations.actualYield` exists only after the `finalize` decision (`app.js:1322-1403`).
    - The shotState feed replays only its latest frame on reconnect, so a stop frame can be lost; keep a 2 s backstop (`app.js:1208-1246`).
    - `/shots/ids` is unordered (`rest_v1.yml:1484-1490`).
    - `/shots` `limit` is at most 100 (`rest_v1.yml:1379`).
22. **No workflow push channel exists.** Poll `GET /workflow` every 60 s and on `visibilitychange`/`focus`, and hold off for 5 s after a local edit (`app.js:1754-1844`).
23. **During a firmware flash:**
    - Do not issue MMR-backed reads (`/machine/settings*`); serve the cache.
    - Turn the wake lock on.
    - Suppress the screensaver and dimming.
    - Block `beforeunload`.
    - The NDJSON stream must end with `done`.
    - A cancel resolves through the stream's `error` event.
    - (`api.js:90-106, 1905-1907, 2367-2447`; `settings.js:9002-9160`.)
24. **Skin switching.** The skin is served on a fresh ephemeral port per server start. After a restart the `exitToDashboard` URL is dead. Navigate to the `:3000` redirector after `/webui/server/status` reports `serving`, wait 1.2 s, and retry once (`docs/skin-switching.md`; `settings.js:9230-9295`).
25. **External URLs must be top-level same-frame navigations.** `_blank` dies, and Decaid hands the URL to the OS browser. A navigation sent before the WebView picks up a new port is treated as external (`app.js:2200-2223`; `docs/skin-switching.md:50-56`).
26. **Android back exits the skin.** Provide in-page back navigation and never rely on `history.back()` from the OS (`decaid:skin_view.dart:339-352`; `router.js`).
27. **Old Android System WebView (before Chromium 92) on DE1 tablets.**
    - Banned: `Array.at`, `structuredClone`, `Object.hasOwn`, `findLast`, `toSorted`/`toReversed`/`toSpliced` and `Object.groupBy`.
    - Use JSON round-trip cloning.
    - (`test/webview-compat.test.mjs:1-45`; `app.js:45-49`; `api.js:1214-1216`.)
28. **The skin is served over plain `http://`, which is an insecure context.**
    - No `navigator.clipboard`, so use `execCommand('copy')`.
    - No `crypto.randomUUID`, so generate ids with timestamp plus `Math.random`.
    - Feature-detect `CompressionStream`.
    - (`qrShare.js:93-109, 216-236`; `profileManager.js:244-249`; `settings.js:10831-10843`.)
29. **WebView viewport quirks:**
    - The size is stale at boot, so wait for stable frames.
    - Some WebViews shrink only `visualViewport` for the keyboard.
    - A transform-scaled `overflow: hidden` root defeats `scrollIntoView`.
    - Use `interactive-widget=overlays-content`.
    - Use `overscroll-behavior: none`.
    - Guard hover styles on touch.
    - Re-measure after `display: none` (`docs/AI_RUNTIME_NOTES.md:53`).
    - (`scaling.js`; `index.html:5`; `src/input.css`; `tailwind.config.js`.)
30. **Plugin rules:**
    - Secure plugin settings read back as `{isSet}` and POST is a patch: send `{isSet: true}` to keep a stored secret (`settings.js:6990-7015`).
    - Installed plugins load with auto-load off, so enable them after install (`dyeStrip.js:655-663`).
    - Decaid's GitHub checks share 60 unauthenticated requests per hour; throttle plugin update checks to 15 min (`dyeStrip.js:665-690`).
    - A 409 on approve means the candidate moved; re-read (`api.js:3001-3014`).
31. **Plugin pages:**
    - Open plugin `ui` endpoints only if the manifest declares an http `ui` endpoint (`settings.js:6482-6490`).
    - Returning from a plugin page can come back from bfcache (`pageshow`, not `focus`), so re-poll (`dyeStrip.js:876-884`).
    - Decaid explicitly allows in-WebView navigation to `localhost:8080/api/v1/plugins/*` (`decaid:skin_view.dart:56-59`).
32. **Keep production logs quiet.** The host captures the WebView console (about 1 MB every 2 min at 10 Hz error spam), so log state edges, not frames (`app.js:842-848, 1072-1076`).
33. **Presence.** Decaid's app-side idle sleep only resets on machine activity or `POST /machine/heartbeat`; a skin that wants interaction to count must send heartbeats (§1.3).

---

## 7. Inconsistencies and bugs in streamline (do not copy)

**Contract violations:**

- `app.js:887-890` treats the last element of `/shots/ids` as the newest shot; the spec says the order is not guaranteed.
- `profileManager.js:1298` requests `/shots?limit=200` against a spec maximum of 100.
- `numpad-modal.js:45-60` reads `response.shots`, but `/shots` returns `items`, so "values from previous shots" is always empty from this source.

**Settings and plugin mismatches:**

- The Visualizer settings page saves `LengthThreshold` (`settings.js:7035`) but reloads `Length` (`settings.js:7103`).
- `updateSkin` looks up `SKIN_ID = 'streamline.js'` (`settings.js:9302`), so it cannot find the `dist` channel install, whose id is `streamline.js-dist` (`release.yml:65-73`).

**Host and connection handling:**

- The water-level socket uses `window.location.hostname` instead of `reaHostname` (`waterTank.js:70`).
- REST is always `http://` while WS switches to `wss:` on https (`api.js:15-16`).
- Two KV wrapper families with different encoding and 404 handling (`api.js:1117-1168` versus `2130-2163`).

**Dead and stale code:**

- Dead exports in `api.js`: `signalHeartbeat`, `connectProfileGeneratedWebSocket`, `reconnectDevice`, `connectScaleDevice`, `getProfile` (which uses `targetAddressSpace: 'local'`, line 1314), `sendProfile` (whose `isValidProfile` calls `alert()`), `setTargetHotWaterDuration`, `setTargetSteamTemp`, `getDisplayState`, `resetLedStrip`, `uploadMachineProfile`, every bean, batch and grinder wrapper, `updateShot`, `deleteShot`, plus `history.updateShot` and `deleteCurrentShot`.
- Stale docs:
  - README §11 describes the old Derek flow.
  - `docs/API.md:135-136` says the skin calls `/machine/capabilities`; it does not.
  - `docs/API.md:278` says the `streamline` namespace holds profile copies; it is now a legacy migration source.
  - `docs/API.md:294-297` says the skin consumes `profileGenerated`; it does not.

**Self-rule violations:**

- Direct fetches outside `api.js` (`history.js`; `settings.js` account proxy), against `AGENTS.md:18`.
- Unescaped device names in `innerHTML` (`settings.js:10475`).
- The Derek strings are missing from the committed translation CSV.

**Gaps:**

- Heartbeat is never sent.
- None of the newer Decaid surfaces is used or even present in the spec copy: connected grinder (`/grinder/*`, `ws/v1/grinder/snapshot`), multi-scale (`/scales/{id}/tare`, `ws/v1/scales/{id}/snapshot`), `/scale/info` and `/diagnostics/ble`.

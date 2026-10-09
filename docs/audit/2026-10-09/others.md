# Community skins and plugins for Decaid: what CafAI can learn (MSL, decaid-zen, DYE2, decaid-mcp)

Survey date 2026-10-09. Read-only research; the only file written is this report.

## 0. Scope, sources and conventions

| Repo | Path | Commit read | Kind |
|---|---|---|---|
| MSL (allofmeng/MSL) | `.ref\MSL` | `965af5c` | skin, vanilla JS, fork of streamline-js |
| decaid-zen (pudabassman/decaid-zen) | `.ref\decaid-zen` | `67f4040` (previously read `ba6282f`) | skin, TypeScript/React/Vite, ships a companion plugin |
| DYE2 (decentespresso/dye2) | `.ref\dye2` | `2684b67` | Decaid plugin (bundled with Decaid) |
| decaid-mcp (The-Walker443/decaid-mcp) | `.ref\decaid-mcp` | `aecef96` | Decaid plugin that serves MCP |
| Decaid (reference) | `.ref\decaid` | `af4e995` (2026-10-09) | host app; CafAI's `docs/verified/*` used `a45961b`, 40 commits older |

Citations are `repo/path:line`. `decaid/` means the Decaid reference checkout. Nothing in any repo was edited, built or run.

## 1. Decaid reference points this survey relies on

### 1.1 What a plugin can do that a skin cannot (Decaid docs, checked against DYE2 and decaid-mcp)

| Capability | Plugin | Skin | Evidence |
|---|---|---|---|
| Run with no skin open; react to `shotStored`/`shotUpdated` (`events.shots`), `stateUpdate` (`events.machine`), `workflowUpdated` (`events.workflow`) | yes | no (only while its page is loaded) | decaid/doc/Plugins.md:114-123, 230-303; dye2/dye2-plugin/src/plugin.ts:49-53 |
| Serve HTML or JSON at `/api/v1/plugins/<id>/<endpoint>`; these pages open in place inside the skin WebView | yes | no | Plugins.md:967-1003; CafAI `docs/verified/01-platform.md` §10 (only `localhost:8080/api/v1/plugins/*` loads in place) |
| Push events to clients at `/ws/v1/plugins/<id>/<event>` via `host.emit` | yes | no | Plugins.md:311-335 |
| Settings schema rendered by any skin; `secure` settings kept in platform credential storage and never returned over REST | yes | no | Plugins.md:128-132, 1452-1457 |
| Decent account calls without seeing credentials (`host.decentProxy`) | yes | read-only proxy token only | Plugins.md:205-226; decaid/doc/Api.md:655 |
| Outbound WebSocket/TCP/TLS (`host.transport`); register sensors, scales, grinders | yes | no | Plugins.md:124-127, 587-786 |
| DOM, `localStorage`, `XMLHttpRequest`, `FormData`, `Blob` | no | yes | Plugins.md:1249-1254 |
| Private storage | `host.storage`, but still readable by anyone at `/api/v1/store/<pluginId>/...` | KV + browser storage | Plugins.md:184-203; CafAI `docs/verified/01-platform.md` §4.1 |

Costs of being a plugin, measured by decaid-mcp on a real tablet (Decaid 0.8.6+2801): plugin JS runs on Decaid's main thread, so a 5 s synchronous loop stopped REST, other plugins **and machine telemetry** for 5 s (decaid-mcp/docs/plugin-spike/REPORT.md:20-28, 36); `onLoad` has a 1 s timeout and three failed loads disable auto-load (REPORT.md:40; Plugins.md:1103-1107); a newly installed plugin starts `loaded:false` and needs `POST /api/v1/plugins/:id/enable` (REPORT.md:68); an update that asks for new permissions waits for user approval (Plugins.md:1369-1393). `PUT /api/v1/plugins/:id/source` installs arbitrary code with no authentication (Plugins.md:1447-1450).

### 1.2 Bundled plugins that already publish data a skin can use

| Plugin | What a skin can call | Evidence |
|---|---|---|
| `visualizer.reaplugin` 1.5.11 | HTTP `status`, `upload`, `verifyCredentials`, `lastUpload`, `import`, `backSyncNow`, `backSyncStatus`, `forwardSyncStatus`, `forwardSyncNow`; settings via `/api/v1/plugins/visualizer.reaplugin/settings` | decaid/assets/plugins/visualizer.reaplugin/manifest.json:55-127; dye2/dye2-plugin/src/utils/dev-api.ts:422-459 |
| `time-to-ready.reaplugin` | WS `/ws/v1/plugins/time-to-ready.reaplugin/timeToReady` → `{remainingTimeMs, heatingRate, status: heating\|reached\|insufficient_data\|not_heating, message}` | decaid/assets/plugins/time-to-ready.reaplugin/manifest.json:23; plugin.js:76-77, 118-153; Plugins.md:316-335 |
| `decent-profile.reaplugin` 1.1.2 ("Decent Profile Generator") | Rule-based profile generator: inputs roast degree, roast quality, origin, flavours to highlight/avoid, target strength (TDS band), basket, dose, puck prep; result on WS `profileGenerated`; UI at `/api/v1/plugins/decent-profile.reaplugin/ui` | decaid/assets/plugins/decent-profile.reaplugin/manifest.json:5-80; plugin.js:431, 447 |
| `settings.reaplugin` | `/api/v1/plugins/settings.reaplugin/ui?backName=<label>` | Api.md:845-854 |
| `shot-upload` (external) | Marks shots `annotations.extras.uploaded_to_decent` / `decent_upload_rejected` | Plugins.md:1461-1480 |

Privacy note for CafAI: the Visualizer plugin uploads and forward-syncs `annotations.enjoyment` (as `espresso_enjoyment`) and `annotations.espressoNotes` (as `espresso_notes`), plus `tags` from `annotations.extras` and `context.extras`, whenever the user has Visualizer upload on (visualizer.reaplugin/plugin.js:282-283, 743-752, 791-800; Plugins.md:292, 305-307). A note CafAI writes into `espressoNotes` can therefore leave the tablet; `annotations.extras.cafai` is not forwarded (only `tags` is read from extras). decaid-mcp records that its test edit of a real shot "may have" been forwarded this way (decaid-mcp/docs/plugin/TASK3-REPORT.md:142).

### 1.3 Decaid changes since CafAI's verified commit `a45961b` (40 commits, 2026-10-01 to 10-09)

- **Live camera for skins (new, 2026-10-07).** An installed skin in the embedded Android, iOS or macOS WebView may call `navigator.mediaDevices.getUserMedia({video: true, audio: false})`. Consent is per skin id (Ask/Allow/Deny in the skin selector) and only the served skin's exact `http://localhost:<port>` origin qualifies; microphone is denied (decaid/doc/Skins.md:67-94). `<input type="file" accept="image/*" capture="environment">` gets a native per-capture confirmation on Android (Skins.md:96-138). Commits `57dfb88`..`9ed5d61`. This **supersedes** CafAI `docs/verified/01-platform.md` §10 ("getUserMedia unavailable"), §15 rule 28 and open question 16.4.
- `grinderBurrs` is snapshotted on the workflow/shot context (decaid/assets/api/rest_v1.yml:8319, 8418) and folded into Visualizer's `grinder_model` (Plugins.md:309).
- Plugin and endpoint ids in `/api/v1/plugins/:id/:endpoint` are opaque path components, percent-encoded once (Api.md:448-451).
- Plugin-registered runtime grinders gain `controls` descriptors (`grindSetting`, `rpmControl`) and `surfaces` on `/api/v1/grinder/info` (Api.md:345-386).

## 2. MSL (allofmeng/MSL @ 965af5c): a vanilla-JS fork of streamline-js

Skin id `msl`, version `0.0.18` (MSL/skin-manifest.json:1-6; MSL/src/version.js:13-19). It uses plain ES modules with an import map, with no bundler and no npm dependencies (MSL/index.html:7-13; MSL/CLAUDE.md:7). It is a fork of `allofmeng/streamline_project` (MSL/CLAUDE.md:9, 66). The clone is shallow (one commit), so upstream tracking shows only in comments and tests. About fifteen of the citations below were re-read during the audit to verify them.

### 2.1 Decaid integration points

**Host and origin.** The REST base is `http://${reaHostname}:8080/api/v1` with `reaHostname = localStorage.reaHostname || location.hostname`. The WebSocket protocol follows the page (`wss:` on https), but REST is hard-coded to `http://` (MSL/src/modules/api.js:9-12). Nothing in the tree writes `reaHostname`, although CLAUDE.md and the README say Settings does (MSL/CLAUDE.md:60; MSL/README.md:32-33). The water-level socket ignores it and uses `location.hostname` (MSL/src/modules/waterTank.js:77). Plugin links are built from `API_BASE_URL`, not `localhost`, so a plugin page opened from a LAN browser saves to the same Decaid (MSL/src/modules/profile_selector.js:1707-1712; shot_overview.js:200-206).

**REST endpoints actually called** (wrappers live in `api.js`):

| Method + path | Purpose | Citation |
|---|---|---|
| GET `/devices`, GET `/devices/scan` (capped at 20 s, then returns the current list), GET `/devices/scan?connect=true` | Device list, link probe, scale connect | api.js:147-188, 214-231; app.js:432, 1030, 1794 |
| PUT `/scale/tare` | Tare, only on a user tap | api.js:237-251; app.js:973-982 |
| GET/PUT `/machine/scaleCalibration` (202, then poll) | Bengle load-cell calibration | api.js:260-354 |
| GET/POST/DELETE `/devices/wifi`, PUT `/devices/forget` | Wi-Fi scales, forget a device | api.js:2466-2533 |
| GET `/profiles?includeHidden=true` (hidden/deleted filtered on the client), POST `/profiles {profile, parentId?}`, GET `/profiles/{id}/lineage`, PUT `/profiles/{id}`, PUT `/profiles/{id}/visibility`, DELETE `/profiles/{id}` | Library, fork with lineage, revert, rename, hide | api.js:984-1007, 1112-1184; MSL/src/modules/profileManager.js:171-182; profile_editor.js:1773-1817, 1954-1955 |
| GET/PUT `/workflow` | Main write path (profile, dose, yield, grind, steam, hot water, flush); the body is sanitised first | api.js:1186-1193, 1243-1310 |
| PUT `/machine/state/{state}` | espresso, steam, hotWater, flush, idle, sleeping, skipStep, cleaning, descaling | api.js:1312-1320; ui.js:2363; app.js:1722-1739 |
| GET `/machine/info` | Model gating (`model`, `GHC`) | api.js:1563-1569; app.js:1543-1549, 1588-1594 |
| GET/PUT `/machine/cupWarmer`, `/machine/ledStrip` (+ commit/reset/preview) | Bengle-only hardware | api.js:1581-1682 |
| GET `/info` | Display and support e-mails only | api.js:1684-1690; settings.js:5818-5831 |
| GET/POST `/machine/settings`, `/machine/settings/advanced`, DELETE `/machine/settings/reset` | DE1 settings, cached with a TTL, 20 s timeout for advanced | api.js:1693-1865 |
| GET/POST `/settings` | `gatewayMode`, `blockOnNoScale`, `scalePowerMode`, `lowBatteryBrightnessLimit` | api.js:1539-1561, 1867-1909 |
| GET/POST/DELETE `/store/{ns}[/{key}]`, `?full=1` | KV (below) | api.js:1009-1054, 1911-1944 |
| GET `/shots/ids`, `/shots?limit&offset&ids`, `/shots/{id}`, `/shots/latest` | History, overview, `actualYield` after finalize | api.js:1946-1986; MSL/src/modules/history.js:52-116 |
| POST `/machine/waterLevels {refillLevel}` | Refill threshold | api.js:2134-2142 |
| POST `/machine/firmware` (NDJSON stream), DELETE `/machine/firmware` | Firmware flash and cancel | api.js:2144-2200; settings.js:7238-7360 |
| GET `/plugins`, GET/POST `/plugins/{id}/settings`, POST `/plugins/{id}/{endpoint}`, enable/disable | Plugin management, Visualizer `import` and `verifyCredentials` | api.js:2202-2297, 2674-2684 |
| POST/DELETE `/display/wakelock` | Wake-lock | api.js:2415-2449 |
| GET/POST `/presence/settings`, CRUD `/presence/schedules` | Auto-sleep and wake schedules | api.js:2535-2650; settings.js:2125-2199, 8413-8509 |
| GET `/webui/skins`, GET/PUT `/webui/skins/default`, POST `/webui/server/stop`/`start`, POST `/webui/skins/update` | Skin switching and update | api.js:2652-2702; settings.js:7362-7406 |
| POST `/feedback`; GET `/account/decent`; GET `/account/proxy/support/api/{sn,email,emails}` with `Authorization: Bearer ${window.__REA_PROXY_TOKEN__}` | Feedback and "Talk to Decent" support messaging | api.js:2704-2712; settings.js:6744-6911 |
| GET `/sensors`, WS `/sensors/{id}/snapshot` | Bengle milk probe (the wire key is `info.data`, not the spec's `info.dataChannels`) | api.js:124-145, 479-522; app.js:630-655 |

Wrappers with no callers: PUT `/devices/connect`, GET `/machine/state`, POST `/machine/shotSettings`, POST `/machine/profile`, GET `/display`, POST `/machine/heartbeat`, PUT/DELETE `/shots/{id}`, and the whole `/beans`, `/bean-batches` and `/grinders` CRUD (api.js:190-208, 1322-1348, 1571-1579, 1988-2132, 2299-2310, 2451-2464). MSL **never writes shot annotations and never touches the bean or grinder entities**. Its only non-Decaid calls are GitHub releases for its own update badge (settings.js:5206) and its short-link store (MSL/src/modules/qrShare.js:38, 116). CLAUDE.md says `api.js` is the only network layer (MSL/CLAUDE.md:89), but `history.js`, `settings.js`, `profile_selector.js`, `qrShare.js`, `router.js` and `i18n.js` also call `fetch` directly.

**WebSocket channels.** All of them use a vendored `ReconnectingWebSocket` with a 3 s base interval, and every frame is parsed inside try/catch.

| Path | Use | Citation |
|---|---|---|
| `/ws/v1/machine/snapshot` | Telemetry. `state` is accepted as a string or `{state,substate}`; frames without `state` are dropped. Also drives display dimming | api.js:356-419; app.js:664-906 |
| `/ws/v1/machine/shotSettings` | Steam/hot-water targets; triggers the drift re-push (§2.3) | api.js:524-550; app.js:1272-1341 |
| `/ws/v1/machine/shotState` | Sequencer `event`, `state`, `decision{kind,reason,details,data.projectedWeight}`, `scaleLost`, `shotId`, `machineHasAutonomousSAW` | api.js:552-579; app.js:1201-1270 |
| `/ws/v1/machine/waterLevels` | `currentLevel`/`refillLevel` (mm) | waterTank.js:69-112 |
| `/ws/v1/scale/snapshot` | `{status}` frames carry status; other frames carry `weight`, `weightFlow`, `batteryLevel`/`battery` | api.js:431-477; app.js:924-971 |
| `/ws/v1/devices` | Link authority. Commands `scan`/`connect`/`disconnect`. Shared by several subscribers, with the last frame replayed to late ones | api.js:642-768; app.js:344-364 |
| `/ws/v1/display` | `brightness`, `requestedBrightness`, `wakeLockOverride`. Commands `setBrightness`, `requestWakeLock`, `releaseWakeLock`; the latest unsent command is queued until the socket opens | api.js:794-889 |
| `/ws/v1/update` | Decaid app update (`check`, `install`) | api.js:891-959; settings.js:6002-6030 |
| `/ws/v1/plugins/time-to-ready.reaplugin/timeToReady` | Heating ETA text | api.js:581-606; app.js:503-533 |
| `/ws/v1/plugins/decent-profile.reaplugin/profileGenerated` | Defined but deliberately unused: the retained last frame re-imported a profile on every page open | api.js:608-640; profile_selector.js:1702-1705 |

**KV namespaces.**
- `streamline-settings`: 22 synced UI preferences, read and write (MSL/src/modules/settingsSync.js:24-65).
- `streamline-app`: favourites and the last tile values (profileManager.js:51-53, 225-320; api.js:1350-1409).
- `streamlineProfileOverrides`: `{profileId: {targetDoseWeight, targetYield, grinderSetting}}` (MSL/src/modules/profile-overrides.js:1-28).
- Legacy `streamline`: migrated into `/profiles` and deleted only after the POST succeeds (profileManager.js:112-153).
- `numpad` (numpad-modal.js:30, 42).
- `dye2.reaplugin`: `autoFavourites` and `recipes`, read only (api.js:1056-1074; dyeStrip.js:22-23).
- `visualizer.reaplugin`: `lastUploadedShot`. This is the Visualizer plugin's private storage, read over REST to confirm an upload (app.js:478-490).

**Settings backup through KV** (`settingsSync.js`).
- localStorage stays the working copy. `Storage.prototype.setItem`, `removeItem` and `clear` are wrapped, so a synced key is pushed to KV only when its value changes (settingsSync.js:102-132).
- Boot pulls KV first, and KV wins. Keys that KV lacks are seeded from local storage (settingsSync.js:134-154).
- **A write gate.** Nothing is pushed or deleted until one hydrate read has succeeded. Otherwise defaults written at boot would overwrite the only surviving copy after a Decaid update wiped localStorage, which the code says is "exactly what wiped users' settings on a Decaid update in the upstream skin" (settingsSync.js:66-100).
- Retries at 1, 2, 4, 8 and 15 s never block boot (settingsSync.js:156-160, 220-245). Hydration runs before i18n (app.js:2045-2050).
- The hostname and Visualizer credentials are never mirrored (settingsSync.js:30-41).
- KV quirks it handles: DYE2 keys that were never written come back non-array and become `[]` (api.js:1062-1074); `?full=1` falls back to per-key reads on older Decaid (api.js:1017-1028); keys come back percent-encoded (profile-overrides.js:69-72).

**Reconnect and link detection.**
- The vendored socket library carries two local patches so that a discarded socket cannot resurrect itself (MSL/src/modules/reconnecting-websocket.js:208-224, 343-350).
- `socket-slot.js` holds one socket per slot. Before closing a socket it replaces the handlers with no-ops (not `null`). This prevents leaked sockets, doubled frames and a false "Disconnected" flash (MSL/src/modules/socket-slot.js:1-75).
- Only the snapshot socket has a 5 s data timeout. When it fires, MSL asks `GET /devices` (at most every 10 s) before believing the machine is gone (app.js:410-456).
- `machine-link.js` derives link state, edge-triggered, from `/ws/v1/devices`: the first payload is a baseline, malformed payloads are ignored, and a different machine id also counts as link-up. `onLinkUp` re-opens the three machine-bound sockets (MSL/src/modules/machine-link.js:1-128; app.js:311-342).
- The code comments assume Decaid "never re-binds" these sockets. That premise is stale: current Decaid re-binds them (CafAI `docs/verified/01-platform.md` §13). The code is written to be correct either way (app.js:300-308).

**Heartbeat.** `signalHeartbeat` is defined (api.js:2451-2464) but never called. Presence is only configured in Settings (settings.js:2125-2199).

**Exit and globals.**
- A floating exit button appears when the UA looks like a WebView or `window.__DECENT_HOST__` exists (MSL/index.html:441-564).
  - `window.decentApp.exitToDashboard` is looked up at tap time, because it may be injected after load. If it is missing, a toast appears instead of a dead button.
  - The button can be dragged to move it; a 600 ms long-press hides it for the session.
- UA sniffing exists in four slightly different copies (index.html:470-475; app.js:2094-2108; ui.js:1218-1230; helpOverlay.js:24-34).
- A document-level click handler turns cross-origin `a[href]` links into `location.assign`, because the host only hands top-level navigations to the OS browser (app.js:1952-2012; MSL/CLAUDE.md:48).

**Visualizer, sharing and Derek.**
- **Visualizer credentials** are the plugin's settings (`Username`, `Password`, `AutoUpload`, `LengthThreshold`). The password reads back as `{isSet}`, and an empty field keeps it (settings.js:5622-5707).
- **Share codes** import through `POST /plugins/visualizer.reaplugin/import {shareCode}` (profile_selector.js:180-235).
- **Upload confirmation** polls the Visualizer plugin's `lastUploadedShot` KV key every 3 s for 30 s (app.js:462-501). This is gated on `localStorage.visualizerEnabled`, which nothing writes (app.js:464; settingsSync.js:58).
- **QR sharing** gzips the profile (when `CompressionStream` exists) and base64url-encodes it. It posts the result to a short-link store, and falls back to a long fragment URL within the 2953-byte QR budget (qrShare.js:1-151).
  - The receiving page can POST the profile into the Decaid on the same device over loopback. Its CSP is limited to loopback and self (MSL/docs/share.html:7-18, 1491-1525).
- **"Discuss with Derek"** copies a markdown shot summary and opens `https://derek.decentespresso.com/` in the OS browser (history.js:12, 310-347).

**Beans, grinders and notes.** Bean and grinder data come only from the shot's `workflow.context` and from DYE2 favourites and recipes applied into `context` (shot-stats.js:51-65; dyeStrip.js:180-229). MSL reads `annotations.{actualDoseWeight, actualYield, enjoyment, drinkTds, drinkEy, espressoNotes}` (shot-stats.js:26-49). "All shots" links to DYE2's dashboard for editing (shot_overview.js:200-206).

**Profiles and workflow.**
- **Active profile.** It is resolved by **title** (case-insensitive, translated titles accepted, a fork preferred on ties), because the workflow profile carries no id (MSL/src/modules/active-profile.js:1-24).
- **Activation** is one `PUT /workflow {profile, context:{targetDoseWeight, targetYield, grinderSetting}}`, confirmed by the response title (profileManager.js:715-814).
- **`target_weight` folding.** MSL also copies the yield into `profile.target_weight` "because on non-autonomous machines Rea's stop-at-weight reads profile.target_weight" (profileManager.js:752-760). **CafAI's code-verified finding contradicts this.** Decaid stops on `context.targetYield` and never reads `profile.target_weight` at run time (CafAI `docs/verified/02-api.md` §13 row 3). Changing `target_weight` also changes the profile id.
- **Editor saves:**
  - default profile plus an execution change → POST a fork with `parentId`;
  - user profile plus an execution change → POST the new version, make it visible, then hide the old one;
  - presentation-only change → PUT in place;
  - if the returned id or title differs from what was sent, the server deduplicated, and the code stops before touching visibility (profile_editor.js:1773-1837).
- **Sanitising.** Every write is sanitised first:
  - legacy TCL fields are stripped;
  - the unused pump axis is removed;
  - `limiter.value == 0` becomes `null`;
  - exits other than pressure/flow are folded into `step.weight` or nulled.

  The reason, from the comment: "mixed pump fields or weight/time/off exits trip ArgumentError inside a Timer callback in WorkflowHandler → completer never resolves → hang" (api.js:1076-1110, 1270-1294).
- **Generated profiles** from the decent-profile plugin are picked up by re-reading `/profiles` and `/workflow` on `visibilitychange`/`pageshow` (profile_selector.js:1687-1753).

**Scale.**
- Tapping the weight while disconnected sends `scan{connect:true}` over the devices socket, polls `/devices` 15 × 1 s and re-creates the scale socket (app.js:973-1061).
- An unexpected disconnect is retried 3 × 5 s, unless `scalePowerMode` is `disconnect` (app.js:225-250).
- Auto-tare and stop-at-weight are left to Decaid (MSL/CLAUDE.md:42).
- A Decaid-side `blockOnNoScale` block is inferred from a shot under 3 s with no scale (app.js:786-796).

**Display, screensaver and sleep.**
- The screensaver is a pure function of the confirmed machine state. Only a tap on the screensaver, or the sleep button while asleep, may send `idle`. A wake sent by the skin suppresses the overlay for 3 s (MSL/src/modules/screensaver-policy.js:1-139).
- Dimming happens only on state transitions, and an `error` transition releases it (screensaver-policy.js:141-161).
- On wake, MSL restores `requestedBrightness` (100 means OS-managed). It remembers brightness in IndexedDB and re-applies it 1.5 s after boot (api.js:2337-2413; app.js:1892-1897).
- The wake-lock is on by default. It is re-requested on every display-socket reconnect, because Decaid ties the override to that connection (api.js:2415-2419, 821-826).

**Other machine features.**
- **Firmware flash** (MSL/src/modules/firmware-progress.js:1-104; settings.js:7238-7341):
  - NDJSON framing is handled separately from the transport;
  - only a `done` event counts as success;
  - `beforeunload` is blocked during a flash;
  - MMR reads are served from cache during the flash.
- **Cleaning and descaling** (MSL/src/modules/maintenance-progress.js:1-189; machine.js:39-55; settings.js:4464-4640):
  - the machine is woken first and the wake confirmed;
  - the machine must enter the state within 20 s;
  - completion is inferred from "the state was seen, then went away";
  - descaling is refused while steam is above 60 °C, and the heater is restored on every exit path.
- **Bengle cup warmer:** null means "unavailable", not "off", and writes are confirmed by the machine's echo (cup-warmer.js:1-246).
- **Water tank:** an mm→mL table and an early low-water warning (waterTank.js:6-39).

**Plugins.**
- **Applying DYE2 items.** Favourites and recipes are applied as GET workflow → merge the item's `workflow{context,profile?}` → PUT. Legacy items fall back to `copyMask`/`dashboardVariables`, and recipe steam/hot-water/flush values are merged into the live workflow (dyeStrip.js:142-250).
- **Refresh.** DYE2 keys are re-polled on `focus`, `visibilitychange` and `pageshow`, with a 500 ms retry after a back-forward-cache restore (dyeStrip.js:392-408).
- **Gating.** The DYE2 UI sits behind a skin-local flag that defaults to off. The skin does not check whether DYE2 is installed (dyeStrip.js:22-28, 376-378).
- **Opening DYE2 pages.** They open in a same-origin `<iframe>` overlay with `?return=` set to a sentinel skin URL; otherwise MSL does a full-page navigation with `?return=<location.href>` (dyeStrip.js:265-342). The iframe premise ("in production reaprime serves the skin and the plugin from the same origin", dyeStrip.js:267-270) is stale: skins have their own port, so on current Decaid the full-page path runs.
- **decent-profile.** The button appears only when `GET /plugins` reports the plugin as `loaded`, and MSL sets `profileFormat: 'json-v2'` (profile_selector.js:1691-1718).

**Capabilities.**
- Bengle detection is `model.toLowerCase().includes('bengle')` (MSL/src/modules/machine.js:1-37; MSL/CLAUDE.md:115).
- `GHC === false` reveals the on-screen group controls (app.js:1588-1594).
- Bengle-only endpoints return 404 on other machines (api.js:272-273, 1587-1588).
- Machine GFlow counts as present only if at least one sample is non-zero (historical-gflow.js:14-23).
- MSL's claim that no capability endpoint exists is stale: `GET /api/v1/machine/capabilities` exists. Nothing is gated on the Decaid version.

### 2.2 Engineering practices

- **Types.** Hand-written, documented in comments that cite `rest_v1.yml` and the Dart sources. There is no schema validation and there are no generated types. Spec errors are recorded at the call site: sensor `info.data`, the sensor snapshot shape, the `cleaingGroup` typo, and `ready` missing from the API (api.js:35, 128-131, 480-486; maintenance-progress.js:20-22).
- **Tolerance of unknown or missing values.**
  - Unknown machine states are rendered generically (app.js:179-186).
  - Stop reasons are treated as an open set (MSL/src/modules/stop-reason.js:112-114).
  - Unknown firmware events are ignored, and progress never goes backwards (firmware-progress.js:83-101).
  - Device error kinds are mapped to friendly text, falling back to `message`/`suggestion` (app.js:379-400).
  - Missing means "unavailable", never "off" (cup-warmer.js:69-75, 124-141).
- **Protection against Decaid updates.**
  - Preferences are mirrored to KV behind the write gate (above).
  - Per-profile dial-in values live in KV, not in profile `metadata`, because Decaid re-seeds bundled profiles (profile-overrides.js:4-10).
  - The `streamline*` storage names were kept through the rename (MSL/CLAUDE.md:9-20).
  - Fallbacks for older builds: `?full=1`, a non-streaming firmware response, a missing `currentTemperature`, `{isSet}` versus cleartext passwords, and a 20 s timeout when waiting for `DeviceConnectResult` (api.js:1017-1028, 2165-2167, 1585-1587, 743-768; profile_selector.js:28-32).
  - Version checks are only against itself: the update badge against GitHub tags, and the on-disk version against `APP_VERSION` (settings.js:5148-5221, 7389-7406).
- **Tests.** There are 21 `node:test` files. Pure modules are imported directly. Other code is "sliced" out of the source with a regex and run through `new Function`, because `api.js` opens sockets on import (MSL/test/api-cache-and-queue.test.mjs:1-6).
  - `upstream-v0.1.110-port.test.mjs` pins logic ported from streamline-js v0.1.106–0.1.110 (MSL/test/upstream-v0.1.110-port.test.mjs:1-3). It bans `.at()`, `structuredClone`, `Object.hasOwn`, `findLast`, `toSorted`, `toReversed` and `groupBy` in core files, for old WebViews (:95-111). It also checks that every fork path detects a deduplicated save (:125-139).
  - There are no tests for `machine-link`, `socket-slot` or `screensaver-policy`, and no contract tests against the spec or a live Decaid.
- **CI** (`.github/workflows/release.yml`) does **not** run the tests (MSL/.github/workflows/release.yml:20-133). It:
  - whitelists `index.html`, `skin-manifest.json` and `src/`;
  - on tags, rewrites the version in the manifest and in `version.js`;
  - on `main`, suffixes the id to `msl-dist` so dev builds install side by side with releases;
  - validates the id and a numeric version, and checks that `APP_VERSION` equals the manifest version;
  - rejects filenames Windows forbids;
  - force-pushes an orphan `dist` branch;
  - on tags, zips with the manifest at the root and publishes a release.
- **Documentation rules** (MSL/CLAUDE.md:26-46, 113-121; MSL/src/modules/logger.js:3-11; vendor-loader.js:1-18):
  - "Comments here carry *why*… don't strip them."
  - `ponytail:` marks a deliberate simplification and states its ceiling.
  - Decaid's `doc/Skins.md` is "the single most useful file"; read Decaid's Dart when behaviour looks wrong.
  - Only Celsius goes on the wire.
  - The 10-minute background unload is why vendor libraries load lazily.
  - `logger.info` is a permanent no-op, for tablet performance.
  - The README's "Ideas worth stealing" maps the hard-won modules (MSL/README.md:136-166).
  - The docs have drifted in places: they claim there is no test directory, a single network layer and three router fragments (MSL/CLAUDE.md:73, 79, 89).
- **Anti-pattern to avoid.** `ensureGatewayModeTracking()` POSTs `gatewayMode:'tracking'` on every main-page init whenever the setting differs (api.js:1889-1909; app.js:1898). That silently reverts a choice the user made in MSL's own Settings (settings.js:972-986).

### 2.3 Platform rules and workarounds MSL encodes

| Rule | Why | Citation |
|---|---|---|
| A silent snapshot socket is not a dead machine: confirm with `GET /devices` | Open-but-silent after a power cycle | app.js:410-456 |
| Close and silence a socket before replacing it | Leaked sockets double every frame | socket-slot.js:1-75 |
| Write the user's intent to KV **before** `PUT /workflow` | The PUT can wait in Decaid's queue and return 503 | api.js:1488-1499 |
| Re-push remembered tile values only when they drift, with a 30 s cooldown per field | decaid gh-678: a DE1 echoing alternating values caused 190 `PUT /workflow` in 27 s | api.js:1411-1436; app.js:1283-1327 |
| Long timeouts and caching for MMR-backed settings; no MMR reads during a flash | MMR reads queue on Bluetooth | api.js:82-114, 1776-1779 |
| Bound the scan wait at 20 s | `connect` defaults to true and holds the response for the whole scan | api.js:155-188 |
| Refresh history by matching `shotState.shotId`, else poll 6 × 2 s | Decaid takes seconds to persist a shot | history.js:407-424 |
| Accept whichever of `stop`, `terminal`, `finalize` arrives first; read `actualYield` only after `finalize` | A reconnect replays only the latest frame; `projectedWeight` is an estimate | app.js:1088-1126, 1189-1265 |
| Stop reason: trust `decision.reason`, but test **time first** (≥95% of the profile's nominal seconds means the profile ended the shot); targets count as hit at 93%; unknown reasons pass through | Checking weight first misattributed ordinary shots | stop-reason.js:1-136 |
| No `.at()`, `structuredClone` or newer APIs | Pre-Chromium-92 tablet WebViews | app.js:39-43; api.js:1087-1088; upstream port test :95-111 |
| Never `preventDefault` a `touchstart` inside a scroller; cancel the press after 10 px | It kills panning | ui.js:500-596 |
| Pointer events for drag-reorder | HTML5 `dragstart` never fires on the touchscreen | profile_editor.js:510-536 |
| External links via same-frame `location.assign` | `target="_blank"` and popups are blocked | app.js:1952-2012 |
| Clipboard via an `execCommand('copy')` fallback | `navigator.clipboard` needs a secure context | qrShare.js:216-236; history.js:282-298 |
| Ignore viewport shrink from the soft keyboard; `interactive-widget=overlays-content` | The keyboard re-scales the canvas | scaling.js:98-106, 217-220; index.html:5 |
| Re-poll on `pageshow` | Back-forward-cache restores a frozen page | dyeStrip.js:400-408 |
| Lazy-load heavy vendor libraries; resolve IndexedDB writes on transaction commit | Every 10-minute unload pays for boot again; the WebView may unload before commit | vendor-loader.js:1-48; idb.js:96-111 |
| Boot order: hydrate KV → i18n → units → UI. `setMachineModel` before the first steam paint. Wake (`idle`) and confirm before cleaning or descaling. Upload a new profile version before hiding the old one | | app.js:2045-2054, 1539-1549; settings.js:4451-4462; profile_editor.js:1810-1823 |
| Log edges, not every frame | 10 Hz error frames flooded the host's WebView log | app.js:761-771 |

### 2.4 Features relevant to an AI coach

- **A markdown shot summary for an LLM**, built for Derek (MSL/src/modules/shotSummary.js:1-91). It contains:
  - dose and yield with fallbacks, and the ratio;
  - duration measured from leaving `preparingForShot`;
  - pressure and flow peaks;
  - per-phase blocks grouped by `machine.profileFrame` → `profile.steps[frame]`, with values shown as actual(target).
- **Shot statistics** (shot-stats.js:1-545, esp. 57-65, 85-104):
  - averages of dose, yield, ratio, enjoyment, TDS, EY and duration (duration over preinfusion and pouring samples only);
  - the usual grind per bean (the mode);
  - per-grinder ranges and a histogram; non-numeric grinds become null;
  - bucketing by local day.
- **Live phase metrics** (shotData.js:73-297):
  - the preinfusion/extraction split at the first pouring sample;
  - temperature from `groupTemperature`, not `mixTemperature` (2-5 °C off);
  - a settled final weight through drip-down.
- **A per-profile dial-in memory** of dose, yield and grind, kept in KV (profile-overrides.js:1-118).

## 3. decaid-zen (pudabassman/decaid-zen @ 67f4040): a React skin that ships its own plugin

decaid-zen is a React 19 / Vite 7 / TypeScript 5.9 skin. Its only runtime dependencies are React and two font packages (decaid-zen/package.json:13-18). The skin manifest is `public/manifest.json` (`{id, name, description, version, author}`), copied to the zip root (decaid-zen/public/manifest.json:1-7).

### 3.1 Decaid integration points

**Host.** The base URL is chosen in this order: the build-time `__GATEWAY__` (from `VITE_GATEWAY`), then `localStorage.reaGateway`, then `${http|https}://${location.hostname}:8080`. `wsBase` swaps `http` for `ws` (decaid-zen/src/lib/gateway.ts:1-17; decaid-zen/vite.config.ts:6-13). Nothing in the UI sets `reaGateway` (decaid-zen/TODO.md:71).

**REST** (three near-identical wrappers, each with a 12 s `AbortSignal.timeout`; only `client.ts` keeps the error body, as `ApiError(status, body)`; decaid-zen/src/api/client.ts:13-25; settings.ts:164-170; profiles.ts:19-25):

| Method + path | Purpose | Citation |
|---|---|---|
| PUT `/machine/state/{sleeping\|idle}` | Sleep and wake only. The skin **never starts a drink**; shots start on the machine | src/api/client.ts:29; src/screens/Idle.tsx:418-425; Sleep.tsx:53 |
| GET/PUT `/workflow` (whole object, current workflow spread then `context` patched) | Profile, bean, grind, yield, steam | src/api/client.ts:31-32; Idle.tsx:125-147; DialIn.tsx:130 |
| PUT `/scale/tare` | Auto-tare before the pour (§3.3) | src/api/client.ts:33; src/lib/useShotTare.ts:28 |
| GET `/devices/scan?connect=true&quick=true` | Non-blocking scan to fill empty machine/scale slots | src/api/client.ts:34-40; src/lib/useScaleRevive.ts:27 |
| GET `/devices`, PUT `/devices/forget` | Device settings | src/api/settings.ts:227-229 |
| GET `/grinders`, POST `/grinders {model}` | Grinder suggestions; a new grinder is created only when the workflow is saved | src/api/client.ts:43-45; DialIn.tsx:76-85, 124-129 |
| GET `/shots?limit&offset[&coffeeName&coffeeRoaster&profileTitle&beanId]`, `/shots/latest`, `/shots/{id}` | Journal, history filters, time-consistency band, coffee ranking | src/api/client.ts:46-54; Journal.tsx:68; useShotSpread.ts:38; coffeeMenu.ts:9 |
| PUT `/shots/{id} {annotations:{espressoNotes}}` | Tasting notes; `enjoyment` is never written | src/api/client.ts:55-59; Journal.tsx:43-53 |
| GET `/shots?limit=1`, GET `/steams/ids` | Recorded shot and steam counts | src/api/settings.ts:245-252 |
| GET/POST `/settings`, `/machine/settings`, `/machine/settings/advanced`, DELETE `/machine/settings/reset` | App and DE1 settings (USB is read as a boolean but written as `'enable'/'disable'`) | src/api/settings.ts:176-187, 218 |
| POST `/machine/shotSettings` (full object) | Steam, hot water, group temperature | src/api/settings.ts:201; src/lib/useShotSettings.ts:13-18 |
| GET/PUT `/machine/cupWarmer`, `/machine/cupWarmer/preheat`, `/machine/ledStrip`; GET/POST `/machine/calibration {flowMultiplier}`; GET `/machine/info` | Hardware settings | src/api/settings.ts:203-216, 244 |
| GET `/display`, PUT `/display/brightness`, POST/DELETE `/display/wakelock` | Sleep screen dimming | src/api/settings.ts:189-194; Sleep.tsx:34-57 |
| GET/POST `/presence/settings`, GET `/presence/schedules`, PUT `/presence/schedules/{id}` | Presence timeout, wake schedules (toggle only) | src/api/settings.ts:196-197, 220-225 |
| GET/POST `/machine/waterLevels` | Tank and refill threshold. GET is used in Settings even though a comment says the levels are socket-only | src/api/client.ts:30; settings.ts:199; useMachine.ts:174; Settings.tsx:101 |
| GET `/webui/skins`, GET/PUT `/webui/skins/default`, POST `/webui/skins/update` | Skins | src/api/settings.ts:231-235 |
| GET `/plugins`, POST `/plugins/{id}/enable`/`disable`, POST `/plugins/update`, **PUT `/plugins/{id}/source`** | Plugin list, and **self-installing its bundled plugin** | src/api/settings.ts:237-240; src/api/bundledPlugin.ts:43-51 |
| GET `/update`, GET `/info` | Display only | src/api/settings.ts:242-243; SoftwareSections.tsx:159-191 |
| GET `/profiles?visibility=visible` | Profile library | src/api/profiles.ts:61 |
| GET/POST `/store/decaid-zen/{key}` | KV (below) | src/api/profiles.ts:62-71; waterBudget.ts:28, 45; demoMode.ts:7, 16 |
| GET `/plugins/coffee-catalog.reaplugin/{coffees,resolve}` | Roaster catalog from its own plugin | src/api/catalog.ts:32-41 |

(All `src/...` paths in this section are under `decaid-zen/`.) No heartbeat, no `/beans` API, and no Visualizer or DYE2 integration: these appear only in design notes and TODO (decaid-zen/canvas/canvas.json:463-479, 519; TODO.md:19-20, 57-59).

**WebSockets.** Four channels, each with one socket per hook instance. Duplicates are avoided only by instantiating `useMachine` once in `App` (decaid-zen/src/App.tsx:24).
- `/machine/snapshot`: frames are cast without validation. They drive a 3000-sample ring buffer that is painted with `requestAnimationFrame` (decaid-zen/src/api/useMachine.ts:116-172; README.md:44-47).
- `/scale/snapshot`: `'status' in frame` tells a status frame from a weight frame (useMachine.ts:180-189; types.ts:21-27).
- `/machine/waterLevels`: accepted only if `currentLevel` is a number (useMachine.ts:175-178).
- `/machine/shotSettings`: open only while Settings is mounted (decaid-zen/src/lib/useShotSettings.ts:9-11).

Reconnect happens on close, with backoff `min(500·2^retry, 10 000)` ms. A malformed frame is swallowed, and the retry count resets on open (decaid-zen/src/api/useSocket.ts:15-47). Liveness is a 5 s "stale" flag checked every 1 s. It shows "Reconnecting · readings paused" but does **not** force a reconnect (useMachine.ts:31-32, 271-275; MachineStatus.tsx:7-8). A 1.5 s first-frame grace precedes the "Connecting…" screen (App.tsx:18, 35-38, 61).

**KV namespace `decaid-zen`** (decaid-zen/src/api/profiles.ts:11-15, 62-78; src/lib/waterBudget.ts:5-49; src/lib/demoMode.ts:4-22):
- `grindByProfile` maps `"<profileId>::<bean lowercased>"` to a grind string. The comment: "an unknown pairing has no grind, not an old one".
- `preferredProfiles` holds up to 10 profile ids.
- `waterUse` stores learned water use per shot and per steam.
- `demoMode` stores `{on}`.

Reads treat an empty body or `null` as the default. Palettes and `reaGateway` stay in `localStorage` (decaid-zen/src/lib/paletteState.ts:3; README.md:71-75).

**Exit, globals, sleep.**
- Holding the Sleep button for 1 s sends `sleeping`, then calls `window.decentApp?.exitToDashboard?.()`. A tap toggles sleep and wake (decaid-zen/src/screens/Idle.tsx:401-431).
- There is no use of `__DECENT_HOST__` or `__REA_PROXY_TOKEN__`.
- The sleep screen dims to 8 and releases the wake-lock. It never restores a dimmed value read after a reload while asleep. Tap to wake awaits `idle` before switching screens, and shows a retryable error on failure (decaid-zen/src/screens/Sleep.tsx:6, 29-62).

**Profiles and recipe.**
- Picking a profile does one whole-workflow PUT that sets:
  - `profile = record.profile`;
  - `context.profileId`;
  - the remembered grind for that profile and bean;
  - `targetYield` from the profile's `target_weight ?? target_volume`, because "the machine stops on the workflow's yield, so a new profile has to bring its own target along" (decaid-zen/src/api/profiles.ts:47-51; Idle.tsx:132-147).
- The active profile is found from `context.profileId`, falling back to title plus a step-shape hash (profiles.ts:27-58).
- Bean identity is free text in `context.coffeeRoaster`/`coffeeName` (Idle.tsx:125-130, 157-162).

**The bundled plugin `coffee-catalog.reaplugin` v1.3.0** (decaid-zen/public/plugin/manifest.json, decaid-zen/public/plugin/plugin.js):
- **Manifest.** Permissions are `log`, `api` and `pluginStorage`. Settings are `CacheHours` and **`SearchApiKey` with `"secure": true`**. There are three HTTP endpoints: `roasters`, `coffees` and `resolve` (manifest.json:8-72).
- **What it does.** It finds a roaster's site from its learned cache, then guessed domains, then DuckDuckGo/Mojeek/Brave (with an Israel-specific query and a Hebrew/English denylist), then a site the user supplies. It reads Shopify `/products.json` or WooCommerce `/wp-json/wc/store/products`. Catalogs are cached for 24 h in memory and in `host.storage`; failed lookups are cached for 1 h (plugin.js:6-58, 90-292, 327-363, 407-450).
- **Runtime contract.**
  - `createPlugin(host)` with `__httpRequestHandler` keyed on `request.endpoint`.
  - Replies are `{requestId, status, headers, body}` and carry `Access-Control-Allow-Origin: *`, because the skin calls it cross-origin.
  - Storage reads are asynchronous: results arrive as `onEvent({name:'storageRead'})`.
  - The secure key arrives in `onLoad(settings)` (plugin.js:365-398).
- **Install and update** (decaid-zen/src/api/bundledPlugin.ts:12-60; src/App.tsx:40-42; src/screens/Settings.tsx:187-191, 527-533):
  - The skin reads its own static `plugin/manifest.json` and `plugin/plugin.js`, which Vite copies into the skin zip.
  - At startup it installs the plugin **only if no copy exists**: `PUT /api/v1/plugins/{id}/source {manifest, plugin}`, then `POST .../enable`.
  - Settings shows an "update" row when the bundled version is newer, and the user taps it.
  - The plugin version is hard-coded twice (manifest.json:6; plugin.js:379).
- **Why it exists.** "Skins cannot fetch roaster sites — no CORS" (decaid-zen/TODO.md:88-89). Also, "the app was rebuilt (v0.8.5) … and `coffee-catalog.reaplugin` went with it", which motivates the auto-reinstall (TODO.md:31-39).

**Coach-like features.**
- A **shot-time consistency band**: the median of the last N shots on the same bean and profile, ±2 s, giving a steady/long/fast verdict, with a profile-only fallback. It costs one `/shots/{id}` per item, mitigated by a module cache (decaid-zen/src/lib/shotSpread.ts:1-30; useShotSpread.ts:6-72).
- A **learned water budget**: mm of tank drop per shot and per steam, ml per mm from integrated flow, giving "next drink: both/shot/none" (decaid-zen/src/lib/waterBudget.ts:8-162).
- A **coffee menu** ranked by how often each coffee was brewed in the last 100 shots. That history fetch races a 1 s timeout so it never blocks the catalog (decaid-zen/src/lib/coffeeMenu.ts:5-27).
- An unimplemented **puck-resistance grind-advice spec**:
  - R = pressure/flow on the plateau frame;
  - the target is the median R of past shots on this bean and profile that hit the yield window or were rated well;
  - "never suggest inside the noise";
  - show the evidence and never write automatically (decaid-zen/canvas/canvas.json:544).

### 3.2 Engineering practices

- **TypeScript and build.** Strict TypeScript (`noUnused*`, `verbatimModuleSyntax`, `target ES2022`). Tests are outside `include`, so they are not type-checked (decaid-zen/tsconfig.json:2-18). The Vite config sets `base: './'` and build-time defines (decaid-zen/vite.config.ts:5-16).
- **Types and validation.** API types are hand-written (decaid-zen/src/api/types.ts:1-132; settings.ts:3-162). There is no OpenAPI/AsyncAPI use and no schema validation. `validation.ts` covers only input parsing, the frame clamp and the axis ceiling (decaid-zen/src/lib/validation.ts:1-15).
- **Tolerance.**
  - Fields are optional, with `??` fallbacks.
  - Unknown states render as words (MachineStatus.tsx:2-5).
  - Weak spot: fixed option lists for `gatewayMode`, `scalePowerMode`, `chargingMode` and others would mislabel a new enum value (Settings.tsx:269-278, 385-393, 481-504).
- **Feature detection by failure.**
  - Each Settings section loads independently. Optional sections become `null` and hide themselves; core sections show a Retry (Settings.tsx:87-113, 205).
  - A missing plugin collapses to `{available:false}` (catalog.ts:27, 39).
  - Nothing is gated on the Decaid version.
- **UX discipline.**
  - `useAction` gives a single-flight lock and maps `block_no_scale`, `block_tare_during_shot` and `{details}` to plain language (decaid-zen/src/lib/useAction.ts:4-42).
  - Saves became pessimistic in 67f4040: state changes only after the server succeeds.
  - An `ErrorBoundary` wraps the app.
- **Mocks.**
  - `installMockServer` monkey-patches `fetch` for `/api/v1/` URLs. A hand-written stateful router adds 140 ms of latency, and failure injection is available through `?failSave=`, `coffeeDelay` and `coffeeError` (decaid-zen/src/lib/mockServer.ts:133-319; README.md:60-67).
  - The fixtures are not spec-derived. The last commit fixed three contract bugs in the mock: POST vs PUT for the default skin, `days` vs `daysOfWeek`, and route order (mockServer.ts:75-78, 268-281).
  - The demo replay feeds a recorded shot through the live buffers (useMachine.ts:215-264).
- **Tests.** `node --test tests/*.test.mjs` imports `.ts` directly, which needs Node 22.18+ type stripping. The four files cover UI logic, the coffee-menu cache, palettes and carousel motion (decaid-zen/package.json:11; README.md:57-58).
- **CI.** CI does **not** run the tests. On `v*` tags it fails unless the tag, `public/manifest.json` and `package.json` versions match. It then zips the *contents* of `dist` flat and publishes the zip with no prerelease flag, so `-preview` tags ship as normal releases (decaid-zen/.github/workflows/release.yml:3-41).
- **Plugin publishing rules** (decaid-zen/TODO.md:40-56):
  - the tag must equal the manifest version;
  - each release carries one zip;
  - use a separate repo or a `plugin-dist` branch;
  - never publish a plugin release in the skin repo, or the skin installer grabs the wrong zip.
- **Docs.** A README and a TODO (Now / Next / Someday / Known limits / How this is wired / Dev loop), with one-line "why" comments at call sites. There is no CLAUDE.md or AGENTS.md (decaid-zen/TODO.md:3-110).

### 3.3 Platform rules and workarounds decaid-zen encodes

| Rule | Citation | Note for CafAI |
|---|---|---|
| Skins cannot reach third-party sites (CORS); a plugin can, and plugin responses must send `Access-Control-Allow-Origin: *` | decaid-zen/TODO.md:88-89; public/plugin/plugin.js:365-375 | |
| USB setting: read as a boolean, written as `'enable'/'disable'` | src/api/settings.ts:180-184 | |
| `POST /machine/shotSettings` needs the whole object; steam changes must also go into `workflow.steamSettings`, because Decaid re-applies the workflow on connect | src/lib/useShotSettings.ts:13-18; src/screens/Settings.tsx:134-151 | Matches CafAI rule 11 (prefer the workflow) |
| A profile switch must carry `targetYield` | src/api/profiles.ts:47-51 | Matches CafAI's verified finding |
| `/shots/latest` has no measurements; follow it with `/shots/{id}` | src/App.tsx:49-50 | |
| `profileFrame` is zero-based and flickers at step boundaries: clamp it, and count a frame only once two samples agree | src/lib/validation.ts:8-11; src/components/ShotGraph.tsx:138-147 | |
| Adaptive profiles' step seconds are ceilings: trust the plan for 20 s, then predict the end from the weight rate after 25% of the target | src/components/ShotGraph.tsx:11-53 | |
| The espresso clock starts at `preinfusion`/`pouring`, the trace resets on `preparingForShot`, and both freeze on `pouringDone` | src/api/useMachine.ts:26-27, 127-156; src/lib/shotClock.ts:3-10 | |
| Tare once while `state==='espresso'` and the substate is `preparingForShot`/`idle`, because "a scale that joined late keeps the cup's weight" | src/lib/useShotTare.ts:6-29 | **Conflicts** with CafAI's verified rule "do not tare before espresso; Decaid tares twice by itself" and with `blockTareDuringShot` (400 during any app-tracked shot state); do not copy without checking on hardware |
| The scale often stays asleep after the machine wakes: do a quick scan on wake or when visible, with a 30 s cooldown, never while pouring | src/lib/useScaleRevive.ts:4-39 | |
| A reload while asleep reads the dimmed brightness, so never restore to it; release the wake-lock while asleep | src/screens/Sleep.tsx:37-41 | |
| Leave the app by sleeping the machine first, then `exitToDashboard` | src/screens/Idle.tsx:416-421 | |
| A WebView can drop animation-end events, so overlays use a timer fallback; use `inert` on the root while a modal is open | src/components/Overlay.tsx:25-33, 52-55 | |
| `AbortSignal.timeout(12000)` on every call, with no polyfill | src/api/client.ts:21 | Chromium 103+; CafAI targets Chromium 91 and already avoids it (CafAI `src/llm/anthropic.ts:17`) |
| A Decaid rebuild removed the installed plugin, so reinstall it when missing | TODO.md:31-39; src/api/bundledPlugin.ts:53-60 | |
| Bundle fonts locally (Google Fonts removed in 67f4040) | package.json:14-15; src/main.tsx:3-4 | |

(Paths without a repo prefix are under `decaid-zen/`.)

### 3.4 Changes ba6282f..67f4040

There is one commit, `67f4040` "Polish skin UI, add palette settings and smooth profile carousel" (2026-10-03, tag `v0.3.16-preview.12`): 65 files, +2940/−1207. `ba6282f` is the root import.

**Unchanged:** `public/plugin/*`, packaging, CI, `vite.config.ts`, `TODO.md`, and `src/api/{types,useSocket,bundledPlugin,catalog}.ts`. So there are **no new or removed endpoints and no plugin changes**.

**Integration hardening:**
- a 12 s timeout on every REST call (src/api/client.ts:21; profiles.ts:21; settings.ts:166);
- an `Array.isArray` guard on `/steams/ids` (settings.ts:251);
- zero-based frame handling everywhere, with a regression test (src/lib/validation.ts:8-11; tests/ui-logic.test.mjs:10-13);
- stale-stream detection and the `MachineStatus` indicator (useMachine.ts:31-32, 271-275);
- replay fidelity: the replayed shot's own workflow, scale presence, and auto-tare suppressed during replay (useMachine.ts:51-53, 222-283; App.tsx:33);
- `refreshWorkflow` failures no longer blank the workflow (useMachine.ts:192);
- a "Connecting…" screen, and `booting` no longer counts as asleep (App.tsx:29, 61);
- an `ErrorBoundary`.

**Optimistic → pessimistic writes:**
- Settings patches, `useShotSettings` and `demoMode`;
- grind memory saved after the workflow PUT, with a partial-failure message;
- grinder creation moved to Save (Settings.tsx:115-195; useShotSettings.ts:14-19; demoMode.ts:15-34; Idle.tsx:149-154; DialIn.tsx:76-132).

**Flows:**
- Sleep wake awaits `idle` (Sleep.tsx:49-62);
- the Journal gets offset paging, an unsaved-note guard and persist-then-navigate (Journal.tsx:43-125);
- a confirmation before "Allow no scale" (Idle.tsx:303-310, 435);
- Settings categories, a load-error banner with Retry, and a reset confirmation.

**Catalog consumption:** a new `coffeeMenu`/`coffeeMenuCache` with history ranking, and the picker loads after its open animation (coffeeMenu.ts:5-27; coffeeMenuCache.ts:8-37; CoffeePicker.tsx:55-64).

**Mock server:** new routes, failure and latency injection, and fixes for three contract bugs (mockServer.ts:75-78, 137-138, 207-209, 268-281, 305-315).

**README contract fix:** `PUT` (not `POST`) `/webui/skins/default` (README.md:31).

**UI only:**
- a palette editor whose defaults live only in CSS, saved per device;
- a continuous carousel;
- bundled Jost/Newsreader fonts with licences;
- viewport `overlays-content` → `resizes-content` (index.html:5);
- a test script and four test files;
- version 0.3.15 → 0.3.16-preview.12 (package.json:4; public/manifest.json:5).

## 4. DYE2 (decentespresso/dye2 @ 2684b67): Decent's "Describe Your Espresso" plugin

### 4.1 How the plugin is built

- **Two runtimes in one file tree.** `dye2-plugin/src/*.ts` runs in Decaid's `flutter_js` (no DOM) and renders HTML strings in `__httpRequestHandler`; browser JavaScript lives in the same files as exported template-literal strings that get no type checking (dye2/CLAUDE.md:8-20; dye2/docs/AI_RUNTIME_NOTES.md:6-50). `${...}` inside a browser string is evaluated by the plugin at render time (AI_RUNTIME_NOTES.md:26-27).
- **Entry point** `createPlugin(host)` returns `{id, version, onLoad, onUnload, onEvent, __httpRequestHandler}` (dye2/dye2-plugin/src/plugin.ts:21-148; host typings dye2/dye2-plugin/src/host.d.ts:1-43). The whole HTTP surface is one `switch` over `request.endpoint`: 15 page routes, a JSON route `recent-favs` and an asset route `plotly` (plugin.ts:55-145). Unknown endpoints return a text 404 (plugin.ts:138-144).
- **Manifest** `dye2.reaplugin` v0.1.19, `apiVersion: 1`, permissions `log, api, emit, pluginStorage, events.shots`, no settings, 17 `api` entries all `type: "http"` (dye2/dye2-plugin/manifest.src.json:1-103). `author` and `description` are required in practice: Decaid reads them into non-nullable fields (dye2/README.md:130).
- **Plugin-side `fetch`.** The plugin gets a `fetch` bound to its own bridge token only when it declares `api`; DYE2 guards with `typeof fetch === 'function'` because the dev server's VM has none (plugin.ts:26-34; AI_RUNTIME_NOTES.md:28-38). Its base URL is `http://localhost:8080/api/v1` (dye2/dye2-plugin/src/utils/recent-favs.ts:275-278); decaid-mcp measured that `localhost`, `127.0.0.1` and the LAN IP all work (decaid-mcp/docs/plugin-spike/REPORT.md:35).
- **Build.** Vite library mode, single IIFE named `createPlugin`, `minify: false`, output straight into the committed `dye2.reaplugin/` folder; a `closeBundle` hook copies `manifest.src.json` to `manifest.json` (dye2/dye2-plugin/vite.config.ts:5-40). The source manifest is deliberately not called `manifest.json`, because a branch install refuses an archive with more than one `manifest.json` (vite.config.ts:30-33; dye2/docs/AI_BUILD_NOTES.md:22-27). Tailwind is generated, then inlined into every page because the tablet is offline (AI_BUILD_NOTES.md:32-46; AI_RUNTIME_NOTES.md:80-82). Plotly is served by the plugin itself at a page-relative `src="plotly"` (AI_RUNTIME_NOTES.md:85-87).
- **Pages are authored at 1920×1200** and scaled with an independent x/y transform clamped at 1.15; keyboard avoidance keys off viewport geometry, never `document.activeElement` (AI_RUNTIME_NOTES.md:102-136).
- **Host theme variables are injected in production** (`--mimoja-blue`, `--box-color`, `--text-primary`, ...); the dev server only has fallbacks (AI_RUNTIME_NOTES.md:93-100).
- **Local dev**: `dev-server.mjs` loads the built `plugin.js` into a Node `vm` with only `console`/`setTimeout`/`clearTimeout`, serves the routes on `:4444` and proxies `/api/v1/*` to a real Decaid (`BRIDGE_URL`) (AI_RUNTIME_NOTES.md:138-150; dye2/README.md:100-105). The dev server never dispatches `shotStored`/`shotUpdated`, which is why `recent-favs` is also an HTTP route (plugin.ts:104-106; AI_RUNTIME_NOTES.md:39-41).
- **Routes are three hand-maintained lists** (`plugin.ts` switch, `dev-server.mjs` `PLUGIN_ROUTES`, `manifest.src.json` `api[]`); a missing manifest entry works in dev and 404s on the tablet; the doc gives a one-line diff check (AI_RUNTIME_NOTES.md:52-70, 188-195).

### 4.2 What DYE2 does that a skin could not

- **Background recomputation on shot events.** On `onLoad`, `shotStored` and `shotUpdated` it recomputes "recent" auto-favourites from shot history and rewrites the `autoFavourites` KV key, even with no DYE2 page open (plugin.ts:40-53; recent-favs.ts:231-291). The refresh is single-flight with a rerun flag so a shot stored mid-refresh is not missed (recent-favs.ts:266-291).
- **Pages that open inside any skin's WebView** at `http://localhost:8080/api/v1/plugins/dye2.reaplugin/<page>`: `dashboard`, `grinders`, `baskets`, `equipment`, `bean-picker`, `grinder-picker`, `basket-picker`, `profile-picker`, `roasters`, `add-bean`, `edit-shot`, `auto-favs`, `auto-fav-edit`, `recipe-edit`, `bc-import` (manifest.src.json:16-101).
- **A JSON endpoint**: `GET /api/v1/plugins/dye2.reaplugin/recent-favs` recomputes and returns the recent auto-favourites (200), 503 when `fetch` is missing, 502 on failure (plugin.ts:104-132).
- **Cross-plugin calls** to the Visualizer plugin (`settings`, `verifyCredentials`, `upload`) that fail soft because Visualizer may be absent (dev-api.ts:422-459; dye2/docs/AI_DATA_NOTES.md:154-159).

### 4.3 The plugin↔skin contract (what DYE2 publishes)

Authoritative source: dye2/docs/KV_CONTRACT.md.

- **KV namespace `dye2.reaplugin`, keys `autoFavourites`, `recipes`, `baskets`, `equipment`**, each a JSON array; a never-written key returns `200 null`, so treat any non-array as `[]` (KV_CONTRACT.md:13-19). DYE2's bean-import page also writes an undocumented `bcEquipment` key (dye2/dye2-plugin/src/pages/bc-import.ts:268).
- **Single-writer rule.** DYE2 rewrites whole arrays; consumers are read-only and must not merge, dedupe or write back (KV_CONTRACT.md:43-47). The store is unscoped, so this is convention only (KV_CONTRACT.md:29-41; README.md:166). DYE2 itself is two writers (plugin runtime and pages) on `autoFavourites`, last write wins (KV_CONTRACT.md:218-221).
- **No push channel**: re-`GET` on focus and `visibilitychange`, or on a light interval (KV_CONTRACT.md:49-53).
- **Ready-to-apply payloads.** Favourites and recipes written by current DYE2 carry `workflow: {context, profile?}`, a body for `PUT /api/v1/workflow` as is (KV_CONTRACT.md:117-129). Recipes keep steam/hot-water/flush intent in `dashboardVariables`; apply them by merging onto the live workflow's `steamSettings`/`hotWaterData`/`rinseData` (KV_CONTRACT.md:131-156). Baskets are applied by writing `context.extras.basketId`/`basketName` only (KV_CONTRACT.md:173-178, 324-338).
- **Optional fields MUST fall back**: `workflow`, `subtitle`, recipe `title`/`capturedAt` exist only on items written by current DYE2 (KV_CONTRACT.md:158-171).
- **Schemas**: `autoFavourites[]` with `copyMask`, `snapshot` (profile id/title, optional full `profileSnapshot`, batch, coffee, roaster, roast date, grinder id/model, basket, grind setting, rpm, dose, drink, barista, drinker, note, equipment ids/names/custom), `capturedAt`, `subtitle`, `workflow` (KV_CONTRACT.md:182-208); `recipes[]` ids `'1'..'5'` with `dashboardVariables` (KV_CONTRACT.md:223-248); `equipment[]` `{id, name, custom[{key,value}], createdAt}` (KV_CONTRACT.md:250-275); `baskets[]` `{id, name, size, diameterMm, notes, createdAt}` (KV_CONTRACT.md:324-335).
- **Auto ("recent") entries** (`auto: true`, up to 5) group shots by bean batch (else roaster+name) + profile title + grinder (id, else model), skip `beverage_type` `cleaning`/`calibrate`, and are rewritten after every stored or edited shot; never key UI state on their `id` (recent-favs.ts:27-30, 54-76; KV_CONTRACT.md:210-221). Their `workflow.profile` is attached only when the recorded profile is executable (`title`, non-empty `steps`, `tank_temperature`, `target_volume_count_start`), because `PUT /workflow` rejects the whole request otherwise (recent-favs.ts:36-52, 182-184).
- **What DYE2 writes into Decaid's own records** (visible to every skin):
  - Before a shot, in the live workflow: `context.extras.rpm`, `basketId`, `basketName`, `note` (dye2/docs/AI_DATA_NOTES.md:95-97, 131-139).
  - After a shot, in `PUT /shots/{id}`: `annotations.extras.rpm`/`basketId`/`basketName`, and equipment as parallel arrays `annotations.extras.equipmentIds`/`equipmentNames` plus an `equipmentCustom` map; the legacy singular `equipmentId`/`equipmentName` is migrated on the next save (KV_CONTRACT.md:277-315; AI_DATA_NOTES.md:52-77).
  - `annotations.enjoyment` on Decaid's 0-10 scale, shown as 5 stars by halving/doubling; never ×20 (AI_DATA_NOTES.md:115-129; dye2/dye2-plugin/src/utils/shared-components.ts:302-325).
  - A cleared drinker note is saved as `''`, never `null`, because DYE2 falls back from `annotations.espressoNotes` to the pre-shot `workflow.context.extras.note` when the annotation is missing or null (dye2/dye2-plugin/src/utils/recorded-shot.ts:43-56; AI_DATA_NOTES.md:141-152).
- **Precedence rules a reader should copy**: basket and RPM come from `annotations.extras`, else `workflow.context.extras`, else legacy `workflow.grinderData.rpm`, with basket id and name taken as a pair (recorded-shot.ts:15-27); dose is `annotations.actualDoseWeight`, else `context.targetDoseWeight`, else legacy `doseData.doseIn`; yield is `annotations.actualYield`, else the last scale sample, which reads several grams low (dye2/dye2-plugin/src/utils/shot-weights.ts:1-25).
- **Pages a skin can open, and how it gets back.** `dashboard`, `bean-picker`, `edit-shot`, `profile-picker`, `recipe-edit` and `roasters` honour `?return=` by assigning it verbatim to `location.href`; without it they go to `http://<host>:3000/?_=<ms>` (dye2/dye2-plugin/src/pages/dashboard.ts:1529-1542; edit-shot.ts:627-629; bean-picker.ts:306-324; profile-picker.ts:226-273; recipe-edit.ts:775-776; roasters.ts:182-184). Because the page runs on the API origin, a skin must pass an **absolute** URL; Decaid's own guidance asks plugins to accept only skin-local paths and to rebuild the origin from `/api/v1/webui/server/status` (Plugins.md:1039-1093), which DYE2 does not do. `edit-shot` takes no shot id parameter: it opens the newest of the last 50 shots unless DYE2's own `sessionStorage` (`dye_editShotId`) says otherwise, so a skin cannot deep-link it to a particular shot (edit-shot.ts:964-1000).

### 4.4 Decaid integration points

| Method + path | Purpose | Citation |
|---|---|---|
| GET `/api/v1/beans?includeArchived=`; GET/POST/PUT/DELETE `/beans/{id}` | Bean library | dev-api.ts:9-57 |
| GET/POST `/beans/{id}/batches`; GET/PUT/DELETE `/bean-batches/{id}` | Roast batches (delete batches before the bean: no cascade) | dev-api.ts:16-77, 406-410; AI_DATA_NOTES.md:105-106 |
| GET/POST/PUT `/grinders` | Grinder records | dev-api.ts:79-104 |
| GET/PUT `/workflow` | Apply favourites/recipes/baskets; deep merge, explicit `null` clears | dev-api.ts:106-120; AI_DATA_NOTES.md:79-103 |
| GET `/shots?limit&offset&order&grinderId&beanId&beanBatchId&coffeeName&coffeeRoaster&search`, `/shots/latest`, `/shots/{id}`; PUT/DELETE `/shots/{id}` | History, server-side "same beans" filter, edit shot | dev-api.ts:122-164; dye2/dye2-plugin/src/utils/shot-paging.ts:1-28 |
| GET `/profiles?visibility&includeHidden` | Resolve a stored profile id to the full profile | dev-api.ts:266-277, 412-420 |
| GET/POST `/store/dye2.reaplugin/{key}` | KV collections (404 also treated as empty) | dev-api.ts:172-200 |
| GET/POST `/plugins/visualizer.reaplugin/settings`, POST `verifyCredentials`, POST `upload {shotId}` | Visualizer, fail-soft | dev-api.ts:422-459 |

No WebSocket is used by the plugin pages surveyed here; there is no version check or feature detection against Decaid in the code read.

### 4.5 Engineering practices

- TypeScript plugin, hand-written host typings (`host.d.ts`), browser code as untyped strings; API shapes are not generated from the copies of Decaid's specs kept at the repo root (`rea_restapi.yml`, `websocket_v1.yml`), which are cited only in comments and rank second in the stated source-of-truth order (dye2/docs/AI_REPO_MAP.md:75-78; dye2/dye2-plugin/src/utils/grinder-form.ts:9; AI_DATA_NOTES.md:170-171).
- No fetch wrapper, retry, cache or dedupe; every helper is `fetch` then `if (!res.ok) throw` (AI_DATA_NOTES.md:19-22).
- Tests: 11 `node --experimental-strip-types` suites (Beanconqueror mapping, paging, equipment, enjoyment scale, grinder field clearing, recent favourites, favourite dates, card taps, bean deletion, recorded shot, shot weights) (dye2/dye2-plugin/package.json:12). Browser-code strings are tested by `eval`-ing the exported string (recorded-shot.ts:1-5; shot-weights.ts:1-4). **CI does not run the tests**; it only builds and validates (AI_BUILD_NOTES.md:95-112; dye2/.github/workflows/release.yml:40-53).
- Release: the git tag is the version; CI rewrites `manifest.src.json` and `package.json` from the tag, builds, validates (`id`, `apiVersion`, `version`, `createPlugin` present), zips with `dye2.reaplugin/` as the top folder and publishes `dye2.reaplugin-vX.Y.Z.zip` (release.yml:24-82; AI_BUILD_NOTES.md:60-90). Because Decaid installs from `main` and rejects downgrades, the committed manifest must never sit below the latest tag (AI_BUILD_NOTES.md:86-90; README.md:189-192). The built plugin is committed and CI warns when it is stale (release.yml:55-63).
- Bundling into Decaid pins version and SHA-256 in a fetch script and asserts the manifest contract at Decaid build time (README.md:196-273).
- Agent documentation: `CLAUDE.md` plus a routing map and topic notes (`AI_RUNTIME_NOTES`, `AI_DATA_NOTES`, `AI_BUILD_NOTES`, ...), a stated source-of-truth order (repo code, then machine-readable contracts, then tests, then Decaid's Dart source) and the rule "name the schema a claim applies to" (dye2/CLAUDE.md:7-52; dye2/docs/AI_REPO_MAP.md:1-92, esp. 75-92).

### 4.6 Platform rules DYE2 encodes

| Rule | Why | Citation |
|---|---|---|
| Send the **full** profile on `PUT /workflow`; `{id, title}` alone relabels the loaded profile and keeps its old steps | deep merge onto the loaded profile | dev-api.ts:255-277 |
| Always send `grinderModel` with `grinderId` | deep merge keeps the previous grinder's name | dev-api.ts:334 |
| Omit `targetYield` rather than send `null` | host rejects explicit null | recent-favs.ts:139-142 |
| On a grinder edit, send an emptied field as `null` (omitting it keeps the old value) | `PUT /grinders/{id}` merges by key presence | dye2/dye2-plugin/src/utils/grinder-form.ts:9-15 |
| Check a recorded profile is executable before re-applying it | invalid profile rejects the whole PUT, context included | recent-favs.ts:36-52 |
| `roastDate` is a `BeanBatch` field; the workflow context drops it | schema confusion | AI_DATA_NOTES.md:99-103 |
| Write KV with POST, read with GET; coerce non-arrays to `[]` | KV semantics | AI_DATA_NOTES.md:31-33 |
| Plugin `fetch` exists only with `api`; `shotStored`/`shotUpdated` only with `events.shots` | permissions | AI_RUNTIME_NOTES.md:28-41 |
| Plugin pages: never make the Plotly `src` absolute; style against host-injected CSS variables; geometry-only keyboard guard | page served at two paths; theming; WebView resize timing | AI_RUNTIME_NOTES.md:85-136 |
| Exit to the Web UI via `http://<host>:3000/?_=<ms>`, never `history.back()` | sub-pages leave duplicate history entries | dashboard.ts:1529-1542 |

## 5. decaid-mcp (The-Walker443/decaid-mcp @ aecef96): an MCP server inside Decaid

### 5.1 Architecture

- **A Decaid plugin that speaks MCP.** `decaid-mcp.reaplugin` v0.1.0, permissions only `log` and `api`, one HTTP endpoint `mcp` (decaid-mcp/manifest.json:1-13). Clients connect to `http://<tablet>:8080/api/v1/plugins/decaid-mcp.reaplugin/mcp`: Streamable HTTP, plain JSON, no sessions (decaid-mcp/README.md:76-96). `plugin.js` is one hand-written, unbuilt file in 14 sections: rounding, rows, metrics, diagnostics, curve, shots, stats, freezing, rules, slicer, decaid, tools, mcp, createPlugin (decaid-mcp/plugin.js:15, 71, 185, 453, 714, 880, 979, 1150, 1290, 1547, 1610, 1678, 2238, 2318; README.md:180-181).
- **Installed from a branch** (`stable`) with `POST /api/v1/plugins/install/github-branch`, then `POST .../enable`, because installing does not start a plugin (README.md:55-74; decaid-mcp/docs/plugin-spike/REPORT.md:68). The plugin files must sit at the branch root (REPORT.md:69).
- **Security stance stated plainly**: port 8080 is Decaid's whole, unauthenticated API (including `PUT /api/v1/plugins/:id/source`), so publish only the one path behind your own access control (README.md:98-125).
- **Tools** (`status`, `list_shots`, `get_shot`, `compare_shots`, `stats`, `list_beans`, `get_batch`, `get_workflow`, `update_shot`, `set_workflow`, `create_bean`, `update_bean`, `create_batch`, `update_batch`) are declared at plugin.js:1682-1805; the JSON-RPC layer handles `initialize` (protocol version negotiation), `tools/list`, `tools/call` (plugin.js:2288-2303). Not included by design: profile selection/editing, recipes, de1app-imported shots (`de1app-...` ids) (README.md:45-53; plugin.js:882-884).

### 5.2 Shot-analysis definitions and the fields they read

These are a JavaScript port of decentespresso-mcp's `metrics.py`, with thresholds unchanged and parity-tested (decaid-mcp/README.md:41-43; decaid-mcp/docs/plugin/TASK3-REPORT.md:38-55). **CafAI already ports sections 2-4** (rows, core metrics, diagnostics) with parity against these golden files (CafAI `src/coach/summary/analysis.ts:5-14`; `src/coach/__fixtures__/SOURCES.md`). The sections it has not ported are marked "not in CafAI".

**Rows** (decaid-mcp/plugin.js:120-183). Each measurement becomes one row:
- `elapsed`: seconds since the first `machine.timestamp`, parsed to whole microseconds and treated as UTC, because only differences matter (plugin.js:73-76, 140-159).
- `pressure` ← `machine.pressure`; `flow_in` ← `machine.flow` (pump); `temp_mix` ← `mixTemperature`; `temp_basket` ← `groupTemperature`; `target_pressure`, `target_flow`, `target_temp_mix`, `target_temp_basket`; `profile_frame` ← `profileFrame`.
- `weight` ← `scale.weight`; `flow_out` ← `scale.weightFlow`.
- `state`, `substate` ← `machine.state.{state,substate}`; `volume` ← the measurement's `volume`.
- A row whose elapsed time, rounded to 3 decimals, repeats an earlier one is dropped.

Rows are built in chunks of 150 points to keep each main-thread slice short (plugin.js:133-138).

**Core metrics** (decaid-mcp/plugin.js:187-197, 286-451):
- **Phase boundaries.** Substate changes come first. Profile-frame changes are the fallback, and the first 0.5 s is ignored because the first sample still carries the previous shot's frame (plugin.js:286-317).
- **`pi_end`** (end of preinfusion), best source first (plugin.js:319-337):
  1. the first `pouring` substate;
  2. else the last frame boundary before the first sample at ≥60% of peak pressure;
  3. else that 60% anchor itself.
- **Peak infusion pressure** is the maximum from 0 to `pi_end + 2 s`. **`pressure_dip_after_peak`** is that peak minus the minimum in the next 4 s (plugin.js:372-383).
- **Pour flow.** Over `[pi_end, end]` of the scale flow: `avg_flow_pour`, and `flow_stability` (the coefficient of variation, dropped with a warning when the mean is ≤ 0) (plugin.js:385-397).
- **Other pour metrics:** `pressure_trend_pour` (least-squares slope), `temp_basket_mean`/`std` (group temperature during the pour), and `end_pressure` (the mean of the last 2 s) (plugin.js:398-404).
- **`t_first_drops`.** The first weight above 0.3 g. It is voided with a warning if the scale already reads more than 0.3 g in the first 0.5 s (not tared). Negative weights trigger a "scale knocked" warning (plugin.js:406-426).
- **`ratio`** = `annotations.actualYield / annotations.actualDoseWeight` (plugin.js:428).
- **Warnings** are collected, never thrown (plugin.js:339-348).

**Diagnostics** (decaid-mcp/plugin.js:453-712). The thresholds are percentiles of the author's own shot archive (plugin.js:455-486).
- **Control mode** per row: pressure if the target pressure is above 0.5 and the target flow is not above 0.1; flow in the reverse case (plugin.js:493-503).
- **Settled window.** It starts 4 s after the pressure first comes within 0.6 bar of a target above 1 bar, and needs at least 8 points (plugin.js:460-465, 505-518).
- **Puck resistance** = pressure / pump-flow² over the settled window. Points with flow below 0.4 ml/s are excluded. The result is the median, in bands `<1 very_low`, `<2.5 low`, `<5 moderate`, `<9 high`, else `very_high` (archive p50 3.9, p90 8.5). The trend is a Theil-Sen slope, banded `steep_decline` (≤ −0.45/s), `declining`, `steady` (|·| ≤ 0.15) or `rising` (plugin.js:466-472, 520-566).
- **Five channeling indicators.** Risk is `high` with 2 or more fired, `elevated` with 1, otherwise `low` (plugin.js:473-477, 596-638):
  - pressure dip ≥ 0.5 bar;
  - flow jitter (population SD of neighbour flow differences while one target is held) ≥ 0.10 ml/s;
  - pump-minus-scale flow divergence (median) ≥ 0.30 ml/s;
  - early drops (`pi_end − t_first_drops`) ≥ 5 s;
  - resistance trend ≤ −0.45/s.

  The two scale-based indicators are skipped when a metric warning mentions the scale.
- **Profile compliance.** The mean absolute deviation from target over the settled window, per control mode. Pressure is close below 0.25 bar and loose below 0.50; flow is close below 0.30 ml/s and loose below 0.70. Temperature (group vs target group) is `on_target` within 1 °C and notable from 2 °C, with a direction. Per-frame phase blocks give means, deviations and substates (plugin.js:478-485, 640-712).

**Curve** (not in CafAI; decaid-mcp/plugin.js:714-878):
- `curveShape` describes pressure and scale flow for each machine phase as `{from, to, dir: steady|rising|falling, linear}`. "Steady" means a change below 0.2 bar or 0.15 ml/s; "linear" means a maximum deviation from the chord of at most 15% of the range. Markers `t_first_drops`, `pi_end` and `t_peak` are attached (plugin.js:716-724, 811-878).
- `downsampleCurve` thins to at most 400 points (60 in previews) while always keeping the first point, the last point and the marker times (plugin.js:718-806).
- This is a compact, LLM-friendly description of the curve's shape.

**Shots, stats, freezing** (not in CafAI; decaid-mcp/plugin.js:880-1290):
- **`shotSummary` row:** `ann.actualDoseWeight`, `ann.actualYield`, ratio, `ctx.targetDoseWeight`/`targetYield`, `grinderModel`, `grinderSetting`, `enjoyment` with the detected scale, `espressoNotes` (else `shotNotes`) truncated to 120 characters, and `stopReason` (plugin.js:891-917).
- **`profileSummary`:** steps with `pump`, target, `temperature`, `seconds`, `transition`, `exit`, `limiter`, `weight`, `volume` (plugin.js:919-945).
- **`profileNotice`:** warns when compared shots ran different profiles, or same-named profiles with different brewing content, using a canonical content key that excludes title, notes, author and version (plugin.js:953-977).
- **Stats** exclude maintenance profiles (by name patterns and by `beverage_type` `cleaning`/`calibrate`) and yields under 5 g. They cap at 500 shots. They report grind per bean, top beans and profiles, batch usage, and comparison with the previous period (plugin.js:979-1129).
- **Bean freshness.** Roast age and "active age" (freezer time subtracted, clipped to [roast, now]). Freeze periods are read from Beanie's `extras.storageEvents` first, then DYE2's `freezeDate`/`unfreezeDate`/`frozen` (plugin.js:1150-1236).

### 5.3 How it models Decaid's API

- **Types.** Hand-written plain JavaScript with defensive coercion: `toNumber` rejects booleans and non-finite values and accepts numeric strings; `toText` trims to `null` (decaid-mcp/plugin.js:107-118). There is no generated client and no schema validation.
- **One `request()` helper** (plugin.js:1618-1652):
  - JSON body;
  - `slicer.suspend()` while waiting on the network, so waiting does not count as main-thread time;
  - a tolerant JSON parse (`null` on failure);
  - error text from `body.error || body.message || text`;
  - `ok()` maps 404 to "not found" and any non-2xx to "Decaid refused …".
- **Data-access choices** (decaid-mcp/docs/plugin/ARCHITECTURE.md:146-178):
  - base `http://localhost:8080`;
  - list pages of **20** (one page of 20 is ~70 kB, and its `JSON.parse` is one ~5 ms slice);
  - `orderBy=timestamp&order=desc`;
  - no cache;
  - native shots only (ids not starting with `de1app-`);
  - timestamps shown as stored, in tablet local time.
- **No metadata-only read of one shot.** `GET /shots?ids=a,b` returns full records *with* measurements, and any other filter makes Decaid ignore `ids` (ARCHITECTURE.md:152).
- **Write rules** (plugin.js:1290-1548; ARCHITECTURE.md:314-336):
  - **Whitelists per resource.** For a shot, only `enjoyment` and `espressoNotes`. `extras`, `workflow`, measurements and timestamps are blocked with an explanation for each.
  - **Bounds:** dose 5-30 g, yield 5-150 g, notes ≤ 5000 characters, roast age ≤ 3 years, and a scale-aware enjoyment check. On a 0-100 tablet, values 1-10 are refused because they would read ten times too high later.
  - **Procedure for every write:** validate (listing every problem at once) → busy guard → read before → one PUT/POST with only the validated fields → read back → report `changed`/`unchanged`/`not_taken` per field.
  - **Special cases:** setting `beanBatchId` also writes `coffeeName`/`coffeeRoaster` from the batch's bean in the same PUT; a 404 batch is refused; `update_batch` always sends `extras` read-then-merged.
- **Fixtures captured from a live Decaid.** `tools/capture-fixtures.mjs` does only GETs plus the harmless rating-scale probe. It anonymises ids to stable fake UUIDs (SHA-256), replaces bean/roaster/coffee names with generic ones, clears free text, and drops the machine serial and Visualizer links. Numbers, states and timestamps are kept because the metrics depend on them (decaid-mcp/tools/capture-fixtures.mjs:1-40). The fixtures come from Decaid 0.8.6+2801 (decaid-mcp/docs/plugin-spike/REPORT.md:8).
- **Version handling.** No version gate: `/info` is for `status` only. The one behavioural fork, the rating scale, is decided by a probe rather than by version, because `/info` cannot tell (REPORT.md:42).

### 5.4 Engineering practices

- **One shipped file.** `plugin.js` is hand-written, with sections listed at the top (decaid-mcp/README.md:180-181). The tests load **the shipped file exactly as Decaid gets it** with `new Function(source)` and use `createPlugin.internals`, plus a fake Decaid over the fixtures (decaid-mcp/test/load.mjs:1-30).
- **Tests** (94 in total; decaid-mcp/docs/plugin/TASK3-REPORT.md:10):
  - `parity` compares rows, metrics, diagnostics, curve shape and the 60- and 400-point curves field by field with golden files from the Python reference (`tools/python-reference.py`). It reproduces Python's `round()` (ties to even) exactly, pinned by fixed cases and a 200,000-value property test against an independent exact reference (decaid-mcp/test/parity.test.mjs:1-87).
  - `tools` runs every tool through the MCP layer against the fake Decaid, including the busy guard.
  - `writes` covers validation, the guard, read-before, one write, read-back, `extras` merge, both frost formats and the rating scale.
  - `mcp` covers the protocol layer and the entry point.
  - `budget` measures stage cost ratios under `node --jitless`, anchored on tablet timings (test file headers; TASK3-REPORT.md:25-27).
- **CI** runs `node --check plugin.js` and then all tests serially on every push and PR. The `stable` branch, which users install from, is protected by the CI check (decaid-mcp/.github/workflows/test.yml:1-19; TASK3-REPORT.md:11).
- **Acceptance and live-change logs.** Each report lists every live change it made to the operator's tablet, how it was restored, and its status. It also keeps a table of where Decaid's docs disagreed with the tablet (decaid-mcp/docs/plugin-spike/REPORT.md:58-118; TASK3-REPORT.md:103-148). `tools/load-probe.mjs` re-measures Decaid's responsiveness while heavy tools run (README.md:187-188).

### 5.5 Platform rules decaid-mcp measured on a real tablet (Decaid 0.8.6+2801)

| Rule | Measurement / reason | Citation |
|---|---|---|
| Plugin JS runs on Decaid's main thread; any synchronous slice stalls REST, other plugins and telemetry | 2/5/10 s burns stalled `/machine/state` 2.1/5.1/10.2 s and left a 5 s gap in snapshot timestamps | decaid-mcp/docs/plugin-spike/REPORT.md:20-28, 36; plugin.js:1556-1563 (5 ms target, 10 ms ceiling, `setTimeout` yields) |
| **Decaid spends about 8 ms of main-thread time per shot on every shot-list page it serves**, for any client | page of 20: 235 ms, stalls `/machine/state` up to 223 ms; page of 50: 510 ms / 409 ms | decaid-mcp/docs/plugin/TASK3-REPORT.md:78-88, 98 |
| Refuse heavy reads and all writes while the machine is busy | `BUSY_STATES` = espresso, steam, hotWater, flush, steamRinse, skipStep, cleaning, descaling, calibration, airPurge, selfTest, fwUpgrade, busy; checked via `GET /machine/state` | plugin.js:1612-1615, 1654-1662; README.md:129-134; TASK3-REPORT.md:28 |
| **Rating scale differs by Decaid version** (0.8.6: 0-100; later: 0-10); detect with a harmless probe | `PUT /api/v1/shots/decaid-mcp-scale-probe {annotations:{enjoyment:11}}`: 404 means 0-100 (lookup before range check), 400 mentioning enjoyment means 0-10; nothing is written; `/api/v1/info` cannot tell | plugin.js:1664-1673; REPORT.md:42; README.md:142-145 |
| Mixed ratings exist on 0.8.6 tablets (DYE2 0.1.15 already wrote 0-10) | two native shots at 4.0/5.0 among 40-100 | REPORT.md:82-85 |
| Plugin HTTP response deadline 30 s (stop at 25 s); fetch connect timeout 10 s; fetch response cap 10 MiB; request body cap 1 MiB (413) | measured | REPORT.md:37, 39, 65; README.md:155-159 |
| A non-JSON request body is answered 500 by Decaid before reaching the plugin; handler must return an object with a string `body` and integer `status`, and must catch everything; returning `null` hangs the client for 30 s | measured | REPORT.md:34, 40, 64-66 |
| Request header names arrive lower-cased | measured | REPORT.md:67 |
| Shot list has no duration and no date filter; `createdAt - timestamp` is duration + 1.8..4.6 s and mixes UTC with local time | measured | REPORT.md:38 |
| A real shot is ~76-95 kB with ~184 points; 30 days ≈ 146 shots ≈ 11 MB | measured | REPORT.md:38-39 |
| `PUT /shots/:id` with `annotations.espressoNotes: null` clears the note and moves `updatedAt`; Visualizer link and upload markers survive | measured | TASK3-REPORT.md:100, 142 |
| Freezer data has two writers: Beanie keeps `extras.storageEvents` (+ `frozen`), DYE2 keeps `freezeDate`/`unfreezeDate`; read events first, write both | measured with Beanie and DYE2 | REPORT.md:41; plugin.js:1150-1290; README.md:146-150 |
| Batch `extras` is replaced on PUT, so read-merge-write to keep other apps' keys | | README.md:151-152 |
| Decaid does not check that a batch id exists when set on the workflow; also write coffee name and roaster | | README.md:153-154 |
| Day-level dates are stored as midnight UTC (`...T00:00:00.000Z`) by Decaid and DYE2 | | TASK3-REPORT.md:30 |
| Plugin clock equals the tablet's local clock; native timestamps carry no zone | | TASK3-REPORT.md:90-92; plugin.js:1144 |

## 6. Side by side, and where these repos disagree with CafAI's verified docs

### 6.1 Comparison

| Concern | MSL | decaid-zen | DYE2 (plugin) | decaid-mcp (plugin) | CafAI today |
|---|---|---|---|---|---|
| Language, build | Vanilla ES modules, no bundler | Strict TS, React 19, Vite 7 | TS → Vite IIFE, committed build | One hand-written JS file | TS, React, Vite |
| API types | Hand-written, spec cited in comments | Hand-written TS | Hand-written; spec copies as reference | Hand-written plus `toNumber`/`toText` coercion | Hand-written (`src/api/types.ts`) |
| Generated from spec / contract tests | No / no | No / no | No / no | No; captured, anonymised live fixtures plus golden parity | No spec use in `src/` |
| Host | `localStorage.reaHostname` or `location.hostname`, `:8080` | `__GATEWAY__` → `localStorage.reaGateway` → `hostname:8080` | Relative `/api/v1` (pages run on the API origin); plugin uses `localhost:8080` | `localhost:8080` | `reaHostname` convention (`src/api/host.ts`) |
| Reconnect | 3 s ×1.5 to 30 s; socket slots; link from `/ws/v1/devices`; 5 s liveness then a `/devices` probe | 0.5 s → 10 s; 5 s stale flag only | n/a | n/a | 1 s → 30 s (`src/api/telemetry.ts:47-48`) |
| Heartbeat | Defined, never called | None | n/a | n/a | On interaction (`src/ui/platform/useHeartbeatOnInteraction.ts`) |
| Exit | Floating button; `decentApp` looked up at tap time | Long-press: sleep, then `exitToDashboard` | `?return=` or `:3000` | n/a | `src/api/host.ts` |
| KV | `streamline-settings` (with write gate), `streamline-app`, `streamlineProfileOverrides`, reads `dye2.reaplugin`, `visualizer.reaplugin` | `decaid-zen` (grind memory, deck, water use, demo) | Owns `dye2.reaplugin` | None | `cafai` |
| Shot writes | None | `espressoNotes` only | `annotations.extras` (rpm, basket, equipment), enjoyment 0-10, notes cleared with `''` | `enjoyment` (scale probed), `espressoNotes` | `enjoyment`, `espressoNotes`, `extras.cafai` |
| Beans / grinders | Only via shot context and DYE2 | Grinder list + create; beans as free text | Full CRUD | Beans/batches CRUD, frost data | Grinders, `beanBatchId` |
| Plugins used | DYE2 (KV, pages), Visualizer, time-to-ready, decent-profile | Its own `coffee-catalog` | Visualizer | none | settings.reaplugin link only |
| Decaid version handling | None; fallbacks; 404 means Bengle-only | Detect by failure | None | Rating-scale probe | `/info`, `/machine/capabilities` |
| Tests in CI | No (21 tests exist) | No (4 exist) | No (11 suites exist) | Yes (94; syntax check + tests on every push) | Yes (unit, e2e, Chrome 91 smoke; `.github/workflows/ci.yml:23-59`) |
| Release | Tag → manifest + `version.js`; `msl-dist` dev id; orphan `dist` branch; Windows-safe name check | Tag = manifest = package check; flat zip | Tag is the version; zip with the plugin folder; never below latest tag | Branch install from protected `stable` | `release.yml`, `skin.config.json` |

### 6.2 Points that contradict or update CafAI's verified docs

| # | Finding | Source | CafAI doc affected |
|---|---|---|---|
| 1 | **Ratings are 0-100 on Decaid 0.8.6** (the field build behind decaid-mcp's fixtures) and 0-10 later; detect with a write probe to a nonexistent shot id; values 1-10 are ambiguous on 0-100 tablets, and mixed data already exists | decaid-mcp/plugin.js:1664-1673, 1414-1431; docs/plugin-spike/REPORT.md:42, 82-85; README.md:142-145 | `docs/verified/02-api.md` §9 "Enjoyment 0-10" and rule 16 assume 0-10 everywhere |
| 2 | **Listing shots costs Decaid ~8 ms of main-thread time per shot** (page of 50 stalls `/machine/state` ~409 ms), affecting any client | decaid-mcp/docs/plugin/TASK3-REPORT.md:78-88 | `02-api.md` rule 15 suggests `limit≤100`; a 100-shot page could stall telemetry ~0.8 s, so never during a shot |
| 3 | Clearing `espressoNotes` with `null` makes DYE2 resurrect the pre-shot `workflow.context.extras.note`; DYE2 and Decaid's own editor clear with `''` | dye2/dye2-plugin/src/utils/recorded-shot.ts:43-56; dye2/docs/AI_DATA_NOTES.md:141-152 | `02-api.md` rule 16 ("Clear a field with `null`") conflicts with `01-platform.md` rule 18 (`''`) |
| 4 | Live camera and capture inputs now work in installed skins (Android, iOS, macOS) | decaid/doc/Skins.md:67-138 | `01-platform.md` §10, rule 28, open question 16.4 |
| 5 | MSL folds the yield into `profile.target_weight`, claiming stop-at-weight reads it | MSL/src/modules/profileManager.js:752-760 | CafAI's code-verified finding says the opposite (`02-api.md` §13 row 3); keep CafAI's rule |
| 6 | decaid-zen tares before every espresso, at `preparingForShot` | decaid-zen/src/lib/useShotTare.ts:6-29 | Conflicts with `02-api.md` rule 13 ("Decaid tares twice by itself") and with `blockTareDuringShot`; do not copy |
| 7 | `GET /shots?ids=` returns full records with measurements and is ignored when combined with other filters | decaid-mcp/docs/plugin/ARCHITECTURE.md:152 | Not in CafAI docs |
| 8 | Shot list has no duration and no date filter; `createdAt − timestamp` is duration + 1.8-4.6 s and mixes UTC and local | decaid-mcp/docs/plugin-spike/REPORT.md:38 | Extends `02-api.md` §9 timestamp rules |
| 9 | Visualizer forward-syncs `enjoyment` and `espressoNotes` edits to visualizer.coffee | decaid/assets/plugins/visualizer.reaplugin/plugin.js:282-283, 791-800 | Privacy rule 17 covers KV and logs, not shot notes |
| 10 | Older Decaid could hang `PUT /workflow` on mixed pump fields or non-pressure/flow exits | MSL/src/modules/api.js:1280-1283 | `03-profiles.md` already requires clean steps; the hang is extra motivation |

## 7. Ideas for CafAI

Ordered by value to a chat-first dial-in coach. Each idea names where it appears; "new" marks capabilities CafAI does not use today.

### 7.1 Correctness and compatibility (do first)

1. **Detect the tablet's rating scale before reading or writing `enjoyment`.** Send one harmless `PUT /api/v1/shots/<nonexistent-id> {annotations:{enjoyment:11}}` per session: 404 means 0-100, a 400 mentioning enjoyment means 0-10. On 0-100 tablets refuse 1-10 and scale on the way in and out. Sources: decaid-mcp/plugin.js:1664-1673, 1414-1431; REPORT.md:42. DYE2 shows the 0-10 ↔ 5-star mapping (dye2/dye2-plugin/src/utils/shared-components.ts:302-325).
2. **Treat shot listing as expensive for Decaid.**
   - Page shot history in small pages (decaid-mcp uses 20; decaid-mcp/docs/plugin/ARCHITECTURE.md:151).
   - Defer history reads and heavy coach work until the machine leaves `espresso`, `steam`, `hotWater`, `flush`, `steamRinse`, cleaning and similar states (decaid-mcp/plugin.js:1612-1615, 1654-1662; TASK3-REPORT.md:78-88).
   - This matters for CafAI's post-shot summary, which fires right after a pour.
3. **Clear notes with `''`, never `null`,** and keep DYE2's `context.extras` keys (`rpm`, `basketId`, `basketName`, `note`) intact. Then fix the contradiction between CafAI's `02-api.md` rule 16 and `01-platform.md` rule 18 (dye2/dye2-plugin/src/utils/recorded-shot.ts:43-56; dye2/docs/AI_DATA_NOTES.md:131-152).
4. **Exclude non-shots from coaching and statistics:**
   - `beverage_type` `cleaning`/`calibrate`;
   - maintenance profile names (`clean`, `flush`, `rinse`, `descal`, `calibrat`, `purge`);
   - yields under 5 g;
   - `de1app-` imported ids.

   Sources: decaid-mcp/plugin.js:882-884, 981-1011; dye2/dye2-plugin/src/utils/recent-favs.ts:30, 64.
5. **Before re-applying a past shot's profile, check that it is executable** (non-empty `title` and `steps`, plus `tank_temperature` and `target_volume_count_start`). An invalid profile makes `PUT /workflow` reject the whole request (dye2/dye2-plugin/src/utils/recent-favs.ts:36-52). This applies to "go back to Tuesday's shot".
6. **Resolve dose, yield, basket, RPM and notes with DYE2's precedence:**
   - dose: `annotations.actualDoseWeight` → `context.targetDoseWeight`;
   - yield: `annotations.actualYield` → the last scale sample, which reads low;
   - basket and RPM: `annotations.extras` → `workflow.context.extras`;
   - note: `espressoNotes` → `context.extras.note`.

   Sources: dye2/dye2-plugin/src/utils/shot-weights.ts:9-25; recorded-shot.ts:15-56.
7. **Tell users that shot notes and ratings can leave the tablet.** The Visualizer plugin forward-syncs `enjoyment` and `espressoNotes`. Keep coach-only text in `annotations.extras.cafai`, which Visualizer does not forward (decaid/assets/plugins/visualizer.reaplugin/plugin.js:282-283, 791-800).

### 7.2 Data that grounds the coach (new)

8. **Read DYE2's published data**, read-only, refreshed on focus, `visibilitychange` and `pageshow`:
   - `autoFavourites`: recent bean batch + profile + grinder combinations with grind, dose, yield and rpm, as ready-to-PUT workflows;
   - `recipes`;
   - `equipment`: WDT, RDT, dosing ring and other kit, with custom fields;
   - `baskets`.

   Coerce non-arrays to `[]` and treat `workflow`, `subtitle` and `title` as optional (dye2/docs/KV_CONTRACT.md:13-19, 43-53, 117-248; MSL/src/modules/dyeStrip.js:142-250, 392-408). For an up-to-date list, call `GET /api/v1/plugins/dye2.reaplugin/recent-favs` (dye2/dye2-plugin/src/plugin.ts:104-132). The coach could then say "last time with this bag you ground 3.3 on D-Flow".
9. **Use bean batches for freshness.** Compute roast age, and "active age" with freezer time subtracted. Read Beanie's `extras.storageEvents` first, then DYE2's `freezeDate`/`unfreezeDate` (decaid-mcp/plugin.js:1150-1236; REPORT.md:41). Neither MSL nor decaid-zen uses `/beans` at all.
10. **Keep a grind memory per profile and bean** (`"<profileId>::<bean>"`, where an unknown pairing gives no grind rather than an old one) and a **shot-time consistency band** (the median of the last N shots on bean and profile, ±2 s) as cheap, explainable context (decaid-zen/src/api/profiles.ts:74-87; decaid-zen/src/lib/shotSpread.ts:1-30).
11. **Grind advice from puck resistance.** decaid-zen's spec says:
    - compare plateau-frame resistance with the median of past shots on this bean and profile that hit the yield window or were rated well;
    - never suggest a change inside the noise;
    - always show the evidence.

    decaid-mcp already computes resistance and its trend (decaid-zen/canvas/canvas.json:544; decaid-mcp/plugin.js:543-566). CafAI ports the metric; the target-from-good-shots rule is the missing piece.
12. **Describe the curve, not just the numbers.** Add decaid-mcp's per-phase `curveShape` (`from`/`to`/`dir`/`linear` for pressure and flow) and its `profileNotice`, which flags shots that ran same-named profiles with different content. Both are cheap, LLM-friendly additions beyond the ported sections 2-4 (decaid-mcp/plugin.js:811-878, 953-977). MSL's per-phase actual(target) markdown is a proven prompt format (MSL/src/modules/shotSummary.js:1-91).
13. **Attribute the stop correctly.** Trust `decision.reason`, but test time first: at ≥95% of the profile's nominal seconds, the profile ended the shot. Count targets as hit at 93%, treat reasons as an open set, and read `actualYield` only after `finalize` (MSL/src/modules/stop-reason.js:1-136; app.js:1088-1265).

### 7.3 Native capabilities worth using (new)

14. **Heat-up ETA in chat.** Subscribe to `/ws/v1/plugins/time-to-ready.reaplugin/timeToReady` (`remainingTimeMs`, `status`) and say "ready in about 2 min" (MSL/src/modules/api.js:581-606; app.js:503-533; decaid/assets/plugins/time-to-ready.reaplugin/plugin.js:76-153).
15. **Decent's Profile Generator as a second opinion.** `decent-profile.reaplugin` turns roast degree, origin, flavour goals, TDS band, basket, dose and puck prep into a profile.
    - Gate on `GET /api/v1/plugins` showing it `loaded`, and set `profileFormat: 'json-v2'`.
    - Do not subscribe to its retained `profileGenerated` frame, which re-imports on every open.

    Sources: decaid/assets/plugins/decent-profile.reaplugin/manifest.json:5-80; MSL/src/modules/profile_selector.js:1691-1718, 1702-1705.
16. **Open DYE2 pages for bean, grinder and equipment chores** with `?return=<absolute CafAI URL>`. They run on the API origin, so the return must be absolute. Edit Shot cannot be pointed at a given shot. Gate the links on DYE2 being loaded (dye2/dye2-plugin/src/pages/dashboard.ts:1529-1542; edit-shot.ts:964-1000; MSL/src/modules/dyeStrip.js:265-342).
17. **Bag photo to bean record.** Decaid now grants installed skins live camera access and native capture inputs, with per-skin consent (decaid/doc/Skins.md:67-138). Not seen in these repos, but it reopens a feature CafAI's docs marked impossible.
18. **Derek as a cited second opinion.** MSL hands Derek a markdown shot summary through the website (MSL/src/modules/history.js:310-347). Decaid also relays Derek's SSE API at `POST /api/v1/derek/answers/stream` without auth or CORS problems (decaid/doc/Api.md:667).
19. **Scale revive on wake.** Run a quick `scan?connect=true&quick=true` when the machine wakes or the page becomes visible, with a 30 s cooldown, never while pouring (decaid-zen/src/lib/useScaleRevive.ts:4-39). It suits a coach that needs weights.

### 7.4 Architecture option: a CafAI companion plugin

20. **What it would give.** decaid-zen ships its plugin inside the skin zip and installs it with `PUT /api/v1/plugins/{id}/source` + `POST .../enable` when missing, offering an update when newer (decaid-zen/src/api/bundledPlugin.ts:12-60; src/App.tsx:40-42). A CafAI plugin could:
    - hold the LLM key as a `"secure": true` setting, never returned over REST (decaid-zen/public/plugin/manifest.json:19-23; decaid/doc/Plugins.md:128);
    - call third-party APIs without CORS;
    - react to `shotStored` with no skin open, as DYE2 does (dye2/dye2-plugin/src/plugin.ts:49-53).

    **Costs and limits:**
    - it runs on Decaid's main thread, where slices must stay at a few milliseconds or telemetry stalls (decaid-mcp/docs/plugin-spike/REPORT.md:20-28, 36);
    - replies must be one string body within 30 s, so streaming chat would need `host.emit` over `/ws/v1/plugins/<id>/<event>` (REPORT.md:64-66; Plugins.md:311-335);
    - plugin storage is readable by anyone over KV;
    - `PUT /source` is unauthenticated (Plugins.md:1447-1450);
    - new permissions block auto-updates until the user approves (Plugins.md:1369-1393);
    - a Decaid rebuild removed decaid-zen's plugin (decaid-zen/TODO.md:31-39).

    Copy DYE2's build and release discipline if this is pursued (§4.1, §4.5).

### 7.5 Engineering practices to adopt

21. **Never write the KV mirror before one hydrate read has succeeded** (MSL/src/modules/settingsSync.js:66-100). Check that CafAI's `src/storage/mirror.ts` gate enforces exactly this invariant.
22. **Write intent first, resync only on drift.** Record the user's or coach's intended change before `PUT /workflow`, and re-push only on drift with a per-field cooldown. A DE1 echoing alternating values once caused 190 PUTs in 27 s (MSL/src/modules/api.js:1411-1436, 1488-1499).
23. **One write procedure for the "confirm one change at a time" flow:** validate everything and list all problems, check busy, read before, make one write, read back, and report `changed`/`unchanged`/`not_taken` per field (decaid-mcp/plugin.js:1503-1548; decaid-mcp/docs/plugin/ARCHITECTURE.md:314-336).
24. **Capture anonymised fixtures from real tablets** with a read-only script (ids hashed, names and free text scrubbed, numbers and timestamps kept) and keep golden outputs (decaid-mcp/tools/capture-fixtures.mjs:1-40). Load the shipped artefact in tests, not the source (decaid-mcp/test/load.mjs:1-30). No surveyed repo contract-tests against `rest_v1.yml`/`websocket_v1.yml`; CafAI could be first, generating mock shapes from the spec plus CafAI's verified deviations. decaid-zen's mock had three contract bugs fixed in one commit (decaid-zen/src/lib/mockServer.ts:75-78, 268-281).
25. **Pin each port and regression to the bug it prevents**, including a source-level ban-list of newer JS APIs for old WebViews (MSL/test/upstream-v0.1.110-port.test.mjs:95-139). CafAI's Chrome 91 smoke covers runtime; a static ban-list catches it earlier.
26. **Release guards:**
    - fail when the tag, manifest and package versions differ (decaid-zen/.github/workflows/release.yml:23-31);
    - reject Windows-forbidden filenames (MSL/.github/workflows/release.yml:100-108);
    - give dev builds a separate id (`msl-dist`, release.yml:57-65);
    - mark `-preview` tags as GitHub prereleases (decaid-zen gap, release.yml:38-41).
27. **Keep a live-change log for any hardware test.** decaid-mcp records every change it made to a real tablet, how it was restored, and the docs-vs-device deviations it found (decaid-mcp/docs/plugin-spike/REPORT.md:58-118). This fits CafAI's `docs/HARDWARE_TEST_PLAN.md`.

### 7.6 Do not copy

- Forcing `gatewayMode` on every boot (MSL/src/modules/api.js:1889-1909; app.js:1898).
- Folding the yield into `profile.target_weight` (MSL/src/modules/profileManager.js:752-760); see §6.2 #5.
- Tare before every espresso (decaid-zen/src/lib/useShotTare.ts:6-29); see §6.2 #6.
- `AbortSignal.timeout` without a polyfill (decaid-zen/src/api/client.ts:21; Chromium 103+).
- Subscribing to decent-profile's retained `profileGenerated` frame (MSL/src/modules/profile_selector.js:1702-1705).
- DYE2's unvalidated `?return=` handling, if CafAI ever serves plugin pages (dye2/dye2-plugin/src/pages/dashboard.ts:1539-1541 vs decaid/doc/Plugins.md:1039-1093).

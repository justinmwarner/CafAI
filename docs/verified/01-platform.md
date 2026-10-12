# 01 — Decaid skin platform: verified facts

**Source commits:** decaid `a45961b323831d2170b3e7f3fef7c72fdd341642` (2026-10-01, shallow clone, no tags) · dye2 `2684b67494954028b98e6725ed28f18328015ae0` · streamline-js `cb058cad8a08904889b817de944566dfe1dd8a9a` (v0.2.7) · MSL `965af5cb3f42fcc29e6f4aeb74defc0dd07f099f` · decaid-zen `ba6282fcc3fc3a160bbd1942b066f49b73afd380`. Secondary: `docs/RESEARCH.md` (R:line).

Rule applied: Dart code > Decaid docs > sibling-skin code > sibling READMEs > RESEARCH.md. Every doc-vs-code conflict is listed in §13.

**Path aliases** (all under `.ref\`, the folder of local reference clones at the repository's root, which is not committed):

| Alias | Path |
|---|---|
| STORE | `decaid/lib/src/webui_support/webui_storage.dart` |
| SERVE | `decaid/lib/src/webui_support/webui_service.dart` |
| VIEW | `decaid/lib/src/skin_feature/skin_view.dart` |
| WUH | `decaid/lib/src/services/webserver/webui_handler.dart` |
| KVH | `decaid/lib/src/services/webserver/kv_store_handler.dart` |
| PRES | `decaid/lib/src/controllers/presence_controller.dart` |
| WSRV | `decaid/lib/src/services/webserver_service.dart` |
| SKINS | `decaid/doc/Skins.md` |
| API | `decaid/doc/Api.md` |
| SPEC | `decaid/assets/api/rest_v1.yml` |
| KVC | `dye2/docs/KV_CONTRACT.md` |

---

## 1. Skin manifest, zip layout, install

### 1.1 Filename and precedence (VERIFIED, code)
- Decaid reads **`skin-manifest.json` first, then `manifest.json`**, both at install time and at every rescan:
  - install: `STORE:1107-1120` — `final skinManifestFile = File('${sourceDir.path}/skin-manifest.json'); final manifestFile = File('${sourceDir.path}/manifest.json'); if (skinManifestFile.existsSync()) {…} else if (manifestFile.existsSync()) {…} else { skinId = p.basename(sourceDir.path); }`
  - scan: `STORE:998-1011` (same order).
- Rationale for `skin-manifest.json`: "`index.html` may reference a PWA `manifest.json` with a different schema. `WebUIStorage._installFromDirectory` and `_scanInstalledSkins` both prefer `skin-manifest.json` over `manifest.json`." (`decaid/doc/plans/archive/streamline-skin-release/2026-04-13-streamline-skin-release-design.md:86`).
- All three reference skins ship `skin-manifest.json` at the root: streamline-js `skin-manifest.json:1-6` (`"id": "streamline.js"`), MSL `skin-manifest.json` (`"id": "msl"`), decaid-zen `public/manifest.json` (the only one using `manifest.json`; Vite copies `public/` to `dist/` root).

### 1.2 Fields actually read (VERIFIED, code)
- Only four keys are read: `id`, `name`, `description`, `version` (`STORE:1013-1022`): `id: skinMeta['id'] as String? ?? skinId, name: skinMeta['name'] as String? ?? skinId, description: skinMeta['description'] as String?, version: skinMeta['version'] as String?`.
- **Required:** none strictly; `id` falls back to the directory basename, `name` falls back to the id. Everything else (`author`, `repository`, CREMA's `entry`, …) is ignored — the docs' example includes `author`/`repository` (`SKINS:3021-3030`) but no code reads them.
- **"entry":** no such concept. The skin server always uses `index.html` as the default document: `createStaticHandler(path, defaultDocument: 'index.html', serveFilesOutsidePath: false, listDirectories: true)` (`SERVE:245-250`).
- REST shape of an installed skin (`GET /api/v1/webui/skins[/<id>]`): `{id, name, path, description, version, isBundled, reaMetadata}` (`STORE:127-137`).

### 1.3 `id` rules (VERIFIED)
- id = manifest `id` → install directory `<web-ui>/<id>` (`STORE:1128`). Must pass `isSafePathComponent` (`decaid/lib/src/util/safe_path.dart:5-22`): non-empty; not `.`/`..`; no `/` `\`; no NUL; no leading drive letter (`X:`); none of `<>:"|?*`; must not end in `.` or space. Unsafe → install throws `FormatException('Unsafe skin id …')` (`STORE:1122-1126`); at scan → skin skipped (`STORE:1033-1038`). Doc: `SKINS:2991`.
- The id also determines the stable port/origin (see §2), the account-proxy consent key `skin:<id>` (`decaid/lib/src/services/account/account_consent_gate.dart:18-23`), and default-skin selection (`PUT /api/v1/webui/skins/default {skinId}`).

### 1.4 `version` rules (VERIFIED)
- Opaque **JSON string**; Decaid never parses or compares it (only `as String?` at `STORE:1019`). Update detection uses release tags / HTTP validators, not `version` (§1.7).
- Type trap: `version` (or `id`/`name`/`description`) as a non-string (e.g. `"version": 1.2`) throws a cast error inside the scan loop; the `catch (e)` at `STORE:1042-1044` logs "Failed to load skin" and **the installed skin disappears from the list**. At install time a non-string `id` throws and the install fails.
- "Numeric dot-segments" (MSL `README.md:217-220`) is an MSL-internal rule (its settings page compares `APP_VERSION` to the manifest), not a Decaid rule.

### 1.5 Missing / invalid manifest (VERIFIED, code)
| Case | Install (`STORE:1102-1149`) | Rescan (`STORE:983-1046`) |
|---|---|---|
| No manifest, zip with single top-level folder | id = folder name | id = dir name |
| No manifest, files at zip root | id = basename of a random temp dir (`createTemp('webui_extract')`, `STORE:1065-1067`) → random id, new id/origin on every reinstall | — |
| Invalid JSON | `jsonDecode` throws → install fails (REST 500) | skin skipped (logged) |
| Non-string id/name/description/version | install fails if `id`; others pass install | skin skipped (cast error caught) |
| Unsafe id | `FormatException` | skipped |
- `index.html` is **not validated** for zip/URL/GitHub installs; only "Live-edit from folder" checks it (`decaid/lib/src/skin_selector/skin_selector_page.dart:667-695`). A zip without it installs and serves a directory listing/404 (`listDirectories: true`, `SERVE:249`).

### 1.6 Zip layout (VERIFIED, code)
- Root layout **or** exactly one top-level folder: `if (extractedContents.length == 1 && extractedContents.first is Directory) { contentDir = extractedContents.first } else { contentDir = tempDir }` (`STORE:1081-1089`). Any second root entry (e.g. `__MACOSX/`, a stray file) disables the single-folder rule.
- Whole archive rejected if any entry is absolute, has a drive letter, or a `..` segment (`decaid/lib/src/webui_support/webui_zip_support.dart:32-49, 57-70`). On Windows, `<>:"|?*` are replaced by `_` and trailing dots/spaces stripped (`webui_zip_support.dart:9-22`, `STORE:1074-1079`).
- Same-id install **overwrites**: existing dir deleted then copied (`STORE:1137-1144`); bundled-asset installs use `overwriteIfExists: false` (`STORE:945`).

### 1.7 GitHub release selection and updates (VERIFIED, code)
- Release: `includePrerelease ? GET api.github.com/repos/<repo>/releases (… as List).first : GET …/releases/latest` (`STORE:368-388`). `repo` must be exactly `owner/repo` (`STORE:360-363`).
- Asset: if `asset` given → exact name match; else **first asset whose name ends with `.zip`** in API order: `assets.firstWhere((asset) => (asset['name'] as String).endsWith('.zip'), orElse: () => throw Exception('No .zip asset found in release'))` (`STORE:396-407`; same in `bundle_skins.sh:65-69`).
- Source recorded as `github_release:<repo>@<tag>` (`STORE:413-418`). Update checks (`updateAllSkins`, `STORE:484-557`) re-resolve the latest release and **skip if that tag is already installed** (`STORE:619-633`). URL / branch installs compare `ETag`/`Last-Modified` from a HEAD request (`STORE:690-719`). Manifest `version` plays no role.
- Update triggers: periodic every 12 h (1 h in simulate) when automatic checks are on (`decaid/lib/src/services/update_check_service.dart:30-33, 186-190`), `POST /api/v1/webui/skins/update`, settings plugin, native "Check for updates" (`SKINS:3485-3496`). Files are replaced in place; **no code reloads a running skin page** after an update.
- `skin_sources.json` (7 `github_release` repos, e.g. `allofmeng/streamline_project`, `decentespresso/insight-js`) is the remote-bundled registry: bundled into the app at build (`bundle_skins.sh:46-89`) and re-downloaded/refreshed at startup (`STORE:170-181, 429-477`); such skins are marked bundled and `DELETE` returns 403 (`STORE:799-801`, `WUH:240-242`).

### 1.8 Install / management endpoints (VERIFIED, `WUH:11-41`)
All JSON bodies limited to 64 KiB (`smallRequestBodyBytes`, `decaid/lib/src/services/webserver/bounded_request_body.dart:9`). Errors: 400 `{"error":"Missing required field: …"}`, else 500 `{"error": e.toString()}`.

| Method + path | Body | Success |
|---|---|---|
| `POST /api/v1/webui/skins/install/github-release` | `{"repo":"owner/repo","asset"?:string,"prerelease"?:bool}` (no `tag`) | `{"success":true,"message":"Skin installed successfully from GitHub release","repo":…}` (`WUH:115-154`) |
| `POST /api/v1/webui/skins/install/github-branch` | `{"repo":"owner/repo","branch"?:"main"}` → downloads `github.com/<repo>/archive/refs/heads/<branch>.zip` (single top folder `<repo>-<branch>`) | `{success,message,repo,branch}` (`WUH:156-191`, `STORE:334-353`) |
| `POST /api/v1/webui/skins/install/url` | `{"url":"https://…/skin.zip"}` | `{success,message,url}` (`WUH:193-225`) |
| `PUT /api/v1/webui/skins/default` | `{"skinId":"…"}` (**PUT only**) | `{success,message,skinId}`; 404 if not installed (`WUH:16, 79-113`). Sets the preference only; does not re-serve. |
| `GET /api/v1/webui/skins`, `GET …/skins/<id>`, `GET …/skins/default` | — | skin JSON (§1.2) |
| `DELETE /api/v1/webui/skins/<id>` | — | 403 for bundled (`WUH:227-245`) |
| `POST /api/v1/webui/skins/update` | — | `{"message":"Skin update check completed"}` |
| `GET /api/v1/webui/server/status` | — | `{serving, path, port, ip}` (`WUH:256-263`); `ip` is `0.0.0.0` on Android (`decaid/doc/Plugins.md:944-947`) |
| `POST /api/v1/webui/server/start` / `stop` | — | start returns `{"message":"Already serving"}` without restarting if already serving (`WUH:265-268`) |
| `GET /api/v1/webui/skin-assets/<id>/<path>` | — | raw file from any installed skin (`WUH:298-335`, `SKINS:2993-3015`) |

---

## 2. Skin origins and browser storage

- **Stable per-skin port** (VERIFIED, code): range starts at 24800, size 4096 (24800–28895), reserved `{3000, 4001, 8080}` (`SERVE:139-147`). Port = FNV-1a(identity) mod 4096, linear probe, persisted in SharedPreferences key `webUISkinPorts` (`decaid/lib/main.dart:214-243`; `SERVE:429-463`).
- **Identity = the absolute skin directory path.** `skinIdentityProvider` is never assigned in `lib/` (only declared at `SERVE:177`, used at `SERVE:337-339`: `identity = identityProvider == null ? path : identityProvider(path)`); the test saves `{skinA.path: assignedPort}` (`decaid/test/webui_support/webui_stable_origin_test.dart:67-98`). Live-edit folders get their own identity (their path).
- **Docs:** "Each installed skin is served from its own stable origin — a port derived from the skin's identity and remembered across restarts. Persistent browser storage is keyed by origin, so `localStorage` and IndexedDB written by a skin are still there the next time the app starts." (`SKINS:69-72`). "`sessionStorage` is not covered by that guarantee … cleared when the page is unloaded — including the background unload … and it never survives an app restart." (`SKINS:74-76`).
- **`:3000` entry point:** binds `0.0.0.0:3000`, answers `307` with `Location: uri.replace(port: <skin port>)` and `Cache-Control: no-store`; 404 for non-device hosts (`SERVE:497-519`). Path and query are preserved. If :3000 cannot be bound, `serveFolderAtPath` rethrows and **no skin is served** (`SERVE:335-352`).
- The embedded WebView loads the skin port directly: `'http://localhost:${widget.port}/?_=${DateTime.now().millisecondsSinceEpoch}'` (`VIEW:137-138`). LAN browsers use `http://<device-ip>:3000` → `http://<device-ip>:<port>` (different origin from `localhost:<port>`).
- **Fallback temporary origin:** assigned port retried 3× at 150 ms (`SERVE:145-147, 418-427`), then an ephemeral port for that run (`SERVE:436-444, 465-485`). "persistent browser storage written under the stable origin is not visible … Nothing is deleted" (`SKINS:83-88`). "The KV endpoints are unaffected by origin" (`SKINS:90-92`).
- **What changes the origin / hides storage** (VERIFIED unless marked):
  - Skin update with the same `id`: same dir → same port → storage kept (`STORE:1128-1144` + identity rule).
  - Remove + reinstall with the same `id`: same path; no code deletes port assignments (only `SERVE:456` adds) → same origin; Decaid never deletes WebView storage (no `WebStorageManager`/`deleteAllData` in `lib/`).
  - Changing the manifest `id` → new dir → new port → old storage orphaned.
  - Port bind failure → temporary origin for that run.
  - Inference (not in sources): a changed absolute app-data path (e.g. iOS container path after an app update, desktop data-dir move per `decaid/doc/AI_STORAGE_NOTES.md:23-33`) changes the identity → new origin.
  - Decaid calls `InAppWebViewController.clearAllCache()` on every SkinView init except Windows (`VIEW:237-244`); what that clears is defined by flutter_inappwebview 6.2.0-beta.3 (not in sources).

## 3. Heartbeat / user presence

- **Endpoint:** `POST /api/v1/machine/heartbeat`, no body (`decaid/lib/src/services/webserver/presence_handler.dart:15, 24-32`). Response `{"timeout": <int>}` = `sleepTimeoutMinutes*60` after reset, or `-1` if presence disabled, no DE1, timer inactive, or timeout ≤ 0 (`PRES:104-115, 462-469`; `SKINS:1515-1529`; `SPEC:4347-4372`).
- **Effect:** resets the sleep timer (`PRES:112`) and writes MMR `userPresent=1` to the DE1 (`decaid/lib/src/models/device/impl/de1/unified_de1/unified_de1.dart:539-540`), **throttled to one write per 5 s** (`PRES:29, 229-237`; the doc's "minimum 30-second interval" at `SKINS:1532` is wrong). While the machine sleeps the write is deferred until it wakes (60 s expiry); heartbeat never wakes the machine (`PRES:239-247`).
- **Cadence (docs):** "Call this endpoint periodically (e.g., on user interaction)" (`SKINS:1520`); the IdleManager example posts on every `pointerdown`/`keydown` (`SKINS:2566-2581`).
- **Without heartbeats:** auto-sleep still runs. The timer is (re)armed on every transition into `idle`/`schedIdle` and on settings changes (`PRES:177-188, 198-208`) and fires after `sleepTimeoutMinutes` (default 30; presence enabled by default: `decaid/lib/src/settings/settings_service.dart:418-430`), skipping active states and keep-awake windows (`PRES:276-301`). So the machine sleeps N minutes after it last went idle **even while the user is using the skin**. None of the reference skins actually call it: streamline-js/MSL define `signalHeartbeat` (`streamline-js/src/modules/api.js:2725-2739`, `MSL/src/modules/api.js:2451-2464`) but never invoke it; decaid-zen has no heartbeat code.
- Related endpoints: `GET/POST /api/v1/presence/settings` (`{userPresenceEnabled, sleepTimeoutMinutes, keepAwakeUntil, schedules}`), `GET/POST /api/v1/presence/schedules`, `PUT/DELETE /api/v1/presence/schedules/<id>` (`presence_handler.dart:16-21`).

## 4. Key-value store

### 4.1 Endpoints (VERIFIED, `KVH:3-55`)
| Method + path | Behaviour (code) |
|---|---|
| `GET /api/v1/store/<namespace>` | `200` JSON array of key strings (`KVH:7-16`) |
| `GET /api/v1/store/<namespace>?full=1` | `200` `{key: value}` (null values omitted) with `ETag` = first 16 hex of SHA-256 of body; `If-None-Match` match (or `*`) → `304` (`KVH:12-13`; `decaid/lib/src/services/webserver/json_response.dart:10-21`; `API:534`) |
| `GET /api/v1/store/<namespace>/<key>` | `200` stored JSON; **missing key → `200` body `null`** (`KVH:18-25`) |
| `POST /api/v1/store/<namespace>/<key>` | body must be valid JSON (any type); `200 {}` (`KVH:37-55`) |
| `DELETE /api/v1/store/<namespace>/<key>` | `200 {}` even if absent (`KVH:27-35`) |
- **Body/content-type:** body read as text (request charset or UTF-8) and `jsonDecode`d; Content-Type is not checked. A JSON `null` body is stored as the string `"null"` (`maybeJson ?? value`, `KVH:45-52`). Empty or non-JSON body → uncaught `FormatException` → 500 (shelf default). Raw strings must be sent JSON-encoded.
- **Size/time limits:** 1 MiB per body (`largeRequestBodyBytes`) → `413 {"error":"Request body is too large"}`; 30 s body timeout → `408` (`bounded_request_body.dart:9-12, 19-25`).
- **Backing store:** each namespace is a Hive (hive_ce 2.19.3) box named after the namespace (`decaid/lib/src/services/storage/hive_store_service.dart:75-81`). Plugin `host.storage` uses a box named after the plugin id (`decaid/lib/src/plugins/plugin_manager.dart:2905-2920`), so `/api/v1/store/<pluginId>/…` reads/writes that plugin's private storage. No auth or ownership check anywhere (KVC:29-41). Default namespace boxes: `kvStore` (REST), `plugins` (`KVH:4`; `decaid/lib/main.dart:593`).
- **Backups:** KV is exported as `store.json` (`WSRV:280-306`; `decaid/lib/src/services/webserver/data_export/kv_store_export_section.dart:19-53`), but only namespaces opened since app start are enumerated (`hive_store_service.dart:52-60`). Export enforces nesting depth ≤ 256 and record ≤ 64 MiB (`data_transfer_limits.dart:42-47`).
- Error cases summary: 413/408 (with CORS, inside the pipeline), 500 for invalid JSON, 429/503 from admission control (§9), no 404s.

### 4.2 DYE2 contract (VERIFIED, KVC + dye2 code)
- DYE2 owns namespace **`dye2.reaplugin`**, keys **`autoFavourites`, `recipes`, `baskets`, `equipment`** (KVC:13-15); code also writes undocumented `bcEquipment` (`dye2/dye2-plugin/src/pages/bc-import.ts:268`). Each value is a JSON array (KVC:19).
- "**DYE2 is the sole writer.** … A consumer (skin/dashboard) is **read-only**: `GET` these keys, never `POST` them. Do not merge, dedupe, or write back" (KVC:43-47). "don't `POST`/`DELETE` keys you don't own" (`dye2/README.md:166`).
- Treat any non-array (including `null`) as `[]` (KVC:16-18; reference reader `dye2/dye2-plugin/src/utils/dev-api.ts:174-180`).
- No push channel: "re-`GET` the key on page focus and on `visibilitychange` (and/or a light interval)" (KVC:49-53).
- Optional fields (`workflow`, `subtitle`, recipe `title`/`capturedAt`) MUST fall back (KVC:158-171). Auto entries (`auto: true`) are rewritten after every stored/edited shot; "never edit or write them, and don't key UI state on their `id`" (KVC:210-221).
- Baskets are transitional pending decaid#727 `/api/v1/equipment` (KVC:21-27); that route does not exist in this Decaid commit (no match in `lib/` or SPEC).
- Shot/workflow conventions DYE2 relies on: `context.extras` carries `rpm`, `basketId`, `basketName`, `note`; shot equipment lives in `annotations.extras.equipmentIds/equipmentNames/equipmentCustom`; `enjoyment` is 0–10; clear notes with `''` not `null` (`dye2/docs/AI_DATA_NOTES.md:52-74, 95-97, 115-152`).
- **Namespaces already in use elsewhere** (avoid): `dye2.reaplugin`, `streamline-app`, `streamlineSettings`, `streamlineProfileOverrides`, `streamlineFlowCalibration`, legacy `streamline` (streamline-js `docs/AI_STORAGE_NOTES.md:73-82`, `src/modules/flow-calibration.js:25`), `streamline-settings` (MSL `src/modules/settingsSync.js:24`), `decaid-zen` (`decaid-zen/src/api/profiles.ts:11`), plus `kvStore`, `plugins`, any `*.reaplugin`. `cafai` is unused in all five repos.
- Convention for a new skin: namespace = skin id (decaid-zen), document owner/lifetime/sensitivity before use, never secrets (streamline-js `docs/AI_STORAGE_NOTES.md:63-84`).

## 5. Returning to the dashboard / switching skins

- **Supported exit = `window.decentApp.exitToDashboard()`** from the injected `/__decent/skin-api.js` (`SERVE:96-105`): `window.decentApp.exitToDashboard=function(){if(window.__DECENT_HOST__)window.location.assign("http://localhost:<skinPort>/__decent/exit-dashboard");};`. The native view intercepts that exact URL string (`classifySkinNavigation`, `VIEW:43-61`), additionally requiring a main-frame navigation from top-level `http://localhost:<widget.port>` (`SkinExitCoordinator`, `VIEW:65-89`), cancels it and calls `pushNamedAndRemoveUntil(LauncherView.routeName)` (`VIEW:314-318, 688-703`). The dashboard (`/home`) shows cards Settings, Devices, Data, **Skins**, Account, Plugins, Advanced (`decaid/lib/src/launcher/launcher_view.dart:44, 166-198`). External browser: no-op (`SKINS:3374`).
- **Native gestures** (`VIEW:25-41`): Android — swipe inward from either edge / Back (`PopScope(canPop:false)` → dashboard, `VIEW:331-338`); iOS — swipe right from the left edge; macOS ⌘D / View → Back to Dashboard; Windows — system menu "Back to Dashboard" (`decaid/lib/main.dart:1093-1104`). A 10 s snackbar with these instructions floats over the skin on each open unless disabled (`VIEW:293-312, 662-667`).
- **`http://host:3000/`** does not open a picker; it 307-redirects to whatever skin is currently served (`SERVE:497-519`).
- **REST switch:** `PUT /api/v1/webui/skins/default {"skinId"}` then `POST …/server/stop` + `POST …/server/start` ("To switch skins: set the default … then restart the server", `SKINS:3387`). The old port closes (`decaid/test/webui_support/webui_token_injection_test.dart:219-240`), so the calling page is stranded; `exitToDashboard` then fails both checks (streamline-js `docs/skin-switching.md:9-33`).
- **streamline-js** (official): exit button `src/settings/settings.js:1066-1077`:
  ```js
  const app = window.decentApp;
  if (window.__DECENT_HOST__ && typeof app?.exitToDashboard === 'function') { app.exitToDashboard(); return; }
  ```
  Skin switch `settings.js:9242-9294`: `setDefaultSkin` → verify `getDefaultSkin` → `stopWebuiServer` → `startWebuiServer` → poll `GET /webui/server/status` every 500 ms (≤20 s) → wait 1200 ms → `window.location.assign(\`${location.protocol}//${location.hostname}:3000/?_=${Date.now()}\`)` → retry once at 3 s → error toast at 6 s ("too early and the navigation is treated as an external link and opens in the system browser").
- **MSL:** floating exit button `index.html:446-490` (`const app = window.decentApp; if (app && typeof app.exitToDashboard === 'function') { app.exitToDashboard(); return; }`, shown when UA/`__DECENT_HOST__` indicates a webview). Skin switch `src/settings/settings.js:7362-7387`: PUT default + stop + start, then a "Refresh Now" banner calling `location.reload()` — reloads the closed old port (broken under current Decaid, per the test above).
- **decaid-zen:** long-press "Sleep and leave": `await client.requestState('sleeping'); window.decentApp?.exitToDashboard?.()` (`src/screens/Idle.tsx:418-422`); `setDefaultSkin` uses PUT (`src/api/settings.ts:233-234`) with no restart.

## 6. Injected script and metadata

- Decaid rewrites every `200 text/html` (non-HEAD, not content-encoded) response from the skin server, inserting before `</head>` (else `</body>`, else after doctype): `<meta name="reaprime-proxy-token" content="…">` (token only for loopback/literal device-IP hosts) + `<script src="http://<host>:<skinPort>/__decent/skin-api.js"></script>` (`SERVE:43-70, 290-327`). Script injected only when request scheme is http, port = skin port, host is a device host (`SERVE:223-235`).
- `/__decent/skin-api.js` (`SERVE:252-264`, headers `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`) defines exactly: `window.__REA_PROXY_TOKEN__` (from the meta) and `window.decentApp.exitToDashboard()`.
- `window.__DECENT_HOST__` is **not** from skin-api.js: the embedded WebView injects it at document start, frozen and non-enumerable: `{app:'decent.app', platform, version, build, commit}` (`VIEW:777-802`). Undocumented in SKINS; used by streamline-js (`src/modules/app.js:2310-2318`). Absent in external browsers.
- Token scope for skins is read-only `account:proxy` (`decaid/lib/main.dart:578-589`; `decaid/lib/src/services/account/proxy_token_service.dart:12-14`), required only for `/api/v1/account/proxy/*` (Bearer; `decaid/lib/src/services/webserver/proxy_auth_middleware.dart:12-43`). Rotated on serve, revoked on switch/stop (`SKINS:3374`).
- CSP compatibility: "works with `script-src 'self'`" (`SKINS:3374`).
- **CafAI needs:** `exitToDashboard` and `__DECENT_HOST__` (both automatic; nothing to bundle). It does not need the proxy token unless it calls Decent-account proxy endpoints.

## 7. Decaid settings UI link

- URL: `http://<host>:8080/api/v1/plugins/settings.reaplugin/ui?backName=<Label>` (`SKINS:3362-3370`; `API:827-834`). Its back link runs `window.location.href='http://'+window.location.hostname+':3000/?_='+Date.now()` (`decaid/assets/plugins/settings.reaplugin/plugin.js:383`; `backName` read at `:1627`). Sections include Web Interface (skin select/install/start/stop) and Presence & Sleep (`API:834`).
- In the embedded WebView only `http://localhost:8080/api/v1/plugins/…` loads in place; any other http(s) URL (including `http://<ip>:8080/…`) opens in the OS browser (`VIEW:50-58`). So build it from `location.hostname` (= `localhost` in-app).
- None of streamline-js / MSL / decaid-zen links to settings.reaplugin (grep). They open plugin pages by full-page navigation to `${API_BASE_URL}/plugins/<id>/<page>`: streamline-js adds `?return=<encoded location.href>` (`src/modules/dyeStrip.js:437-445`); MSL links `…/dye2.reaplugin/dashboard` (`src/modules/shot_overview.js:206`). DYE2's dashboard honours `?return=` verbatim, else goes to `:3000` (`dye2/dye2-plugin/src/pages/dashboard.ts:1538-1542`). Plugins.md defines `return` as a skin-local path validated against the live skin port (`decaid/doc/Plugins.md:917-986`).

## 8. Host discovery convention

- API fixed at `0.0.0.0:8080` (`WSRV:399-400`); docs on `4001` (`WSRV:686`).
- streamline-js `src/modules/api.js:12-15` and MSL `src/modules/api.js:9-12`: `reaHostname = localStorage.getItem('reaHostname') || window.location.hostname`; `API_BASE_URL = \`http://${reaHostname}:8080/api/v1\``; `WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:'`; sockets `\`${WS_PROTOCOL}//${reaHostname}:8080/ws/v1/…\``.
- decaid-zen `src/lib/gateway.ts:5-17`: build-time `__GATEWAY__` → `localStorage.reaGateway` (full base URL) → `\`${http|https}://${location.hostname}:8080\``; `wsBase = httpBase.replace(/^http/, 'ws')`.
- Decaid docs: "Why localhost in production? When served by Decaid, the skin runs on the same device as the gateway" (`SKINS:3502-3516`). `reaHostname` must not be mirrored to KV (streamline-js `docs/AI_STORAGE_NOTES.md:71`).
- The skin origin (`:24800+`) ≠ API origin (`:8080`): every API call is cross-origin. CORS: global `corsHeaders(...)` with `Access-Control-Allow-Headers: Accept, Accept-Encoding, Authorization, Content-Type, DNT, Origin, User-Agent, If-None-Match` and exposed `ETag, Location, Content-Disposition, Retry-After, X-Request-Id` (`WSRV:134-140, 500-527`); non-proxy paths stay permissive, proxy paths pinned to skin origins (`decaid/.agents/skills/decent-app/scenarios/account-proxy-cors.md:3-12`; `WSRV:590-630`).

## 9. Telemetry sockets, connection state

- **Machine sockets** (`/ws/v1/machine/snapshot|shotSettings|waterLevels|raw`): "Sockets stay open across machine power cycles and reconnects … While no machine is connected the socket stops emitting frames but stays open." "Frames resume automatically." "No connection-status frames are emitted … Use `/ws/v1/devices` for machine connection state." "A telemetry gap alone does not prove the WebSocket connection is dead." (`SKINS:1770-1793`; `API:724-750`). Code: `_withDe1Ws` detaches on `null` and re-binds to each new machine instance (`decaid/lib/src/services/webserver/de1handler.dart:733-779`). Raw socket replies `{"error":"No machine connected"}` while detached (`SKINS:1795-1801`).
- Snapshot ~10 Hz (`SKINS:1693`). Registered WS routes: machine snapshot/shotSettings/waterLevels/raw/shotState (`de1handler.dart:190-206`), `/ws/v1/devices`, `/ws/v1/display`, `/ws/v1/scale/snapshot`, `/ws/v1/scales/{id}/snapshot`, `/ws/v1/sensors/{id}/snapshot`, `/ws/v1/plugins/{id}/{endpoint}`, `/ws/v1/logs`, `/ws/v1/webview/logs`, `/ws/v1/update`, `/ws/v1/grinder/snapshot` (`decaid/assets/api/websocket_v1.yml:42-225`). `shotState` "Replays the latest frame on connect … not gated on a connected machine" (`API:715`).
- **Scale socket** stays open across scale connect/disconnect and emits `{"status":"connected"|"disconnected"}` on open and on each transition; snapshots only while connected; "branch on the presence of a `status` field vs. a `weight` field" (`SKINS:1745-1768`).
- **Devices socket:** full `ConnectionManager` status + device list; payload requires `devices`, `scanning`, plus `connectionStatus` (`websocket_v1.yml:884-907`); `connectionStatus.error` `{kind, severity, timestamp, deviceId, deviceName, message, suggestion, details}`; kinds `scaleConnectFailed`, `machineConnectFailed`, `scaleDisconnected`, `machineDisconnected`, `adapterOff`, `bluetoothPermissionDenied`, `scanFailed`, `profileUploadFailed`; "Latest event wins"; de-dupe toasts by `timestamp`; "**Do not reconnect the WebSocket on an error.**" (`SKINS:1969-2057`). Machine link = `devices[]` entry with `type === 'machine' && state === 'connected'`, edge-triggered (MSL `src/modules/machine-link.js:48-57`).
- **Reconnect strategy** (docs): reconnect only on actual close/error, exponential backoff 1 s → 30 s, reset on open (`SKINS:2063-2105`); "clients may still retain normal WebSocket reconnect logic … (e.g. a liveness timeout is a valid defensive fallback)" (`SKINS:1790-1793`). Avoid parallel duplicate sockets (streamline-js `docs/AI_RUNTIME_NOTES.md:87`).
- **Admission control:** REST per client IP 32 concurrent / 256 per s, global 128 / 1024 per s; WS upgrades per client 32 per s, global 128 per s; rejection `429 {"error":"client_admission_limit"}` or `503 global_admission_limit`, `retry-after: 1` (`decaid/lib/src/services/webserver/admission_control.dart:107-121, 216-225`).

## 10. WebView / platform constraints

- **Chromium floor:** Decaid enforces none. Android SDK < 29 → "Android version too old for stable WebView" screen with "Ignore and load anyway" (`decaid/lib/src/services/webview_compatibility_checker.dart:147-153`; `VIEW:478-485`); app `minSdk = 28` (`decaid/android/app/build.gradle.kts:34`). Teclast/Allwinner/Rockchip get a runtime render test, not a block (`webview_compatibility_checker.dart:71-87, 330-341`). In-repo evidence of old engines: "older Android WebViews some DE1 tablets ship with (pre-Chromium 92)" (`MSL/src/modules/app.js:39-40`); "Not structuredClone: unsupported in the tablet's embedded webview (old Chromium)" (`streamline-js/src/modules/api.js:1213`, `MSL/src/modules/api.js:1087`). Decaid README: Teclast WebView issues → update Android System WebView (`decaid/README.md:90-97`).
- **Device viewports** (Decaid's simulated devices, `decaid/lib/src/skin_feature/simulated_webview_device.dart:39-73`): Teclast M50/T50 Mini CSS 1007×602 @DPR 1.33, 5 touch points; P80X 962×602 @1.33, 2 touch points; P85 Pro 1140×712 @1.125.
- **WebView settings** (`VIEW:260-291`): `userAgent: "Decent"` (whole UA string), `cacheEnabled: false`, `javaScriptCanOpenWindowsAutomatically: false`, `mediaPlaybackRequiresUserGesture: false`, `supportZoom: false`, scrollbars off, renderer priority bound; renderer death → rebuild after 500 ms (`VIEW:727-744`).
- **Safe areas:** `SafeArea(top:false,bottom:false,left:false,right:false)` and Android/iOS `SystemUiMode.immersiveSticky` (`VIEW:144-146, 322-330`) → edge-to-edge; the skin owns insets (streamline-js uses `max(12px, env(safe-area-inset-*))`, `src/css/context-menu.css:125-128`; decaid-zen sets `viewport-fit=cover` `index.html:5`). Android WebView is positioned 1 px past right/bottom (`VIEW:620-626`).
- **Navigation:** in-place only for skin port, `localhost:3000`, `localhost:8080/api/v1/plugins/*`; other http(s) → OS browser, other schemes blocked (`VIEW:43-61`; `SKINS:3372`). Android Back/edge swipes and iOS left-edge swipe leave the skin (§5).
- **Background:** Android/iOS pause WebView + timers on `paused`; after **10 minutes** load `about:blank`; on resume reload `/?_=<ts>` (`VIEW:170-228`; `SKINS:60-65`). Brightness reset to 100 when the skin view is disposed (`VIEW:153`; `SKINS:1500-1501`). Possible nightly app-root restart when the hourly timer fires during hour 1 (`decaid/lib/src/app.dart:293-298`; timer re-created on every build).
- **Camera / mic:** no `onPermissionRequest` handler in `lib/`; AndroidManifest has no `CAMERA`/`RECORD_AUDIO` (`decaid/android/app/src/main/AndroidManifest.xml:9-40`); iOS only `NSCameraUsageDescription` "for shot notes and feedback when picking images via the file picker" (`decaid/ios/Runner/Info.plist:43-44`), no microphone key → `getUserMedia` unavailable.
- **Console logs** are captured to `webview_console.log` (1 MiB cap), served at `GET /api/v1/webview/logs` and `/ws/v1/webview/logs`, included in support packages/feedback (`VIEW:716-726`; `decaid/lib/src/services/webview_log_service.dart:9, 26`; `decaid/lib/src/services/webserver/webview_logs_handler.dart:10-11`; `decaid/lib/src/services/export/support_package.dart:105`).
- **Display / presence endpoints:** `GET /api/v1/display`; `PUT /api/v1/display/brightness {"brightness":0-100 int}` (100 = OS-managed); `POST` / `DELETE /api/v1/display/wakelock` (REST override persists until DELETE); `WS /ws/v1/display` commands `setBrightness|requestWakeLock|releaseWakeLock`, override auto-released on socket close (`decaid/lib/src/services/webserver/display_handler.dart:10-16, 74-134`; `SKINS:1430-1508, 1907-1967`). Auto wake-lock = machine connected and not sleeping (`decaid/lib/src/controllers/display_controller.dart:292-305`); brightness auto-restored if left at 0 when the machine wakes (`display_controller.dart:276-285`). Heartbeat/presence: §3.
- **Screensaver ownership:** "The screen saver belongs to the skin, not to Decaid … It appears only while the machine is **confirmed asleep**, and tapping it wakes the machine." (`streamline-js/README.md:635-645`). Decaid has no screensaver.
- **MSL README "Ideas worth stealing" (verbatim, `MSL/README.md:142-166`):**
  > - **`socket-slot.js` — close-and-silence before re-open.** The middleware binds sockets to a machine *instance* and never re-binds them, so a naive reconnect leaves you listening to a dead object.
  > - **`machine-link.js` — edge-triggered state from a surviving feed.** After a machine power-cycle the snapshot socket goes open-but-silent, and device ids are byte-identical across the cycle, so id-diffing never fires. Connection state is derived from the aggregator feed instead.
  > - **`screensaver-policy.js` — a pure function of confirmed machine state.** Nothing but an explicit user wake may send `idle`. Sleep bugs on a coffee machine are the kind users notice at 6am.
  > - **`firmware-progress.js` — NDJSON framing split from transport.** Chunk boundaries are not line boundaries, so framing is its own tested function. 100% means "bytes sent", not "update applied": only the `done` event is success, and a truncated stream is a failure.
  > - **Touch gestures for a WebView** (`setupPressAndHold` in `ui.js`). Never `preventDefault()` a `touchstart` on anything inside a scroller — it cancels the platform's panning for the whole gesture. Cancel the press on movement instead and suppress the synthetic click at the `click` listener. HTML5 drag-and-drop is unusable here (`dragstart` never fires); the step reorder in `profile_editor.js` uses pointer events with live DOM reflow.
  > - **A header that yields instead of overlapping.** Two absolutely-positioned clusters cannot see each other; making the header a flex row lets the favourites strip give up width as optional buttons appear, and it scrolls for the rest.
  > - **`i18n.js` — the CSV header row *is* the language list.** … Adding a language is adding a column.
  > - **Units are display-only.** The machine and the middleware always speak Celsius on the wire; Fahrenheit exists in the render layer and is never persisted or transmitted.
  > - **Capability gating off a model string.** There is no capability endpoint, so Bengle-only features key off the model string from `GET /machine/info`. It's ugly, it's documented, and it's honest.

  Note: the first and last bullets are stale vs current Decaid (re-bind exists, `de1handler.dart:756-779`; `GET /api/v1/machine/capabilities` exists, `de1handler.dart:37-52`, `API:100`).

## 11. Offline operation and embedded lifecycle

- "Decaid serves installed skins from `localhost`, so Wi-Fi and internet access are not required for machine control or the embedded skin itself … any external resources requested by a skin remain unavailable until internet access returns." (`SKINS:94-100`). decaid-zen loads Google Fonts from a CDN (`decaid-zen/index.html:8-12`) — a counter-example.
- "After ten minutes in the background, it unloads the page and reloads the selected skin … Skin state that must survive this reload should be persisted through the Decaid API or browser storage." (`SKINS:60-65`).
- Serving constraints (code): static handler with no SPA fallback (`SERVE:245-266`) → deep paths 404; every non-`/ws` response gets `Cache-Control: no-cache, no-store, must-revalidate` + `Expires: 0` (`SERVE:269-288`); WebView cache disabled and cleared (§10, §2); load URL carries `?_=<ms>` (`VIEW:137-138`).
- Docs recommend relative assets: Vite `base: './'` (`SKINS:3530-3539, 3664-3669`; decaid-zen `vite.config.ts:9`). No source mentions service workers.

## 12. Versioning and build info

- `pubspec.yaml:11` → `version: 1.0.0+1` (placeholder). Real version is injected from the latest git tag at build: `VERSION="${TAG#v}"`, default `0.0.0-dev`; `BUILD_NUMBER=$(git rev-list --count origin/main)` (`decaid/flutter_with_commit.sh:20-29`; `decaid/lib/build_info.dart:18-29`). The checkout is shallow with no tags, so its release version cannot be determined from the sources. `decaid/doc/AI_API_NOTES.md:173` mentions "before 0.8.2" (so ≥ 0.8.2). API spec `info.version: 1.0.0` (`SPEC:4`).
- `GET /api/v1/info` → `{commit, commitShort, branch, buildTime, version, buildNumber, appStore, fullVersion, localIp}` (`decaid/lib/src/services/webserver/info_handler.dart:11, 16-26`; `SKINS:1651-1681` omits `localIp`; `API:643` lists it). Debug builds report `unknown` git fields (`SKINS:1681`). In-app alternative: `window.__DECENT_HOST__.version/.build/.commit` (`VIEW:778-784`).

---

## 13. Source-internal disagreements (code wins)

| Doc claim | Code truth | Citations |
|---|---|---|
| KV GET missing key → 404 | 200 `null` | `SKINS:1348`, `SPEC:3004-3005` vs `KVH:18-25` |
| KV POST → 204 | 200 `{}` | `SPEC:3028-3029` vs `KVH:54` |
| KV DELETE → `{"deleted":true}` / 404 | 200 `{}` always | `SKINS:1368-1372`, `SPEC:3047-3058` vs `KVH:27-35` |
| Heartbeat DE1 throttle 30 s | 5 s | `SKINS:1532` vs `PRES:29` |
| `POST /api/v1/display/brightness` | `PUT` | `API:446` vs `display_handler.dart:12` |
| ":3000 … redirects to a fresh browser origin each time Decaid serves a skin" | stable port per skin path | `SKINS:3374` vs `SERVE:429-463`, `SKINS:69-72` |
| Default skin `streamline-project` | `streamline.js` | `SKINS:3451` vs `settings_service.dart:274-281` |
| "Releases have stable ETags (won't auto-update)" | release updates keyed on tag | `SKINS:3690` vs `STORE:619-633` |
| `_remoteWebUISources` const in webui_storage.dart | `skin_sources.json` asset | `SKINS:3283-3317, 3861` vs `STORE:170-181` |
| "If manifest.json is missing, the skin ID will be the directory name" | `skin-manifest.json` read first; root-layout zip without manifest → random temp-dir id | `SKINS:3032, 3546-3562` vs `STORE:1065-1067, 1084-1089, 1107-1120` |
| ZIP "must include `index.html` at root" | not validated; single top folder also accepted | `SKINS:3334` vs `STORE:1081-1089`, `skin_selector_page.dart:667` |
| `/ws/v1/machine/state` example | no such route | `decaid/doc/AI_API_NOTES.md:140, 206` vs `de1handler.dart:190-206` |
| `lib/src/services/webserver/webui/` | file is `webserver/webui_handler.dart` | `decaid/doc/AI_REPO_MAP.md:17, 38` |
| MSL: sockets "never re-bind" | re-bind on new machine instance | `MSL/src/modules/machine-link.js:4-8` vs `de1handler.dart:756-779` |
| MSL: "no capability endpoint" | `GET /api/v1/machine/capabilities` → `{"capabilities":[…]}` (Bengle full list, DE1 empty) | `MSL/README.md:165-166` vs `de1handler.dart:37-52` |
| MSL/streamline-js/Decaid READMEs: "3000 serves skins" | 3000 only redirects | `MSL/README.md:192`, `streamline-js/README.md:200`, `decaid/README.md:87` vs `SERVE:497-519` |
| MSL: live-edit "runs on `:3000` same-origin with the gateway" | own port; API on 8080 | `MSL/README.md:35-36` vs `SERVE:336-341` |
| MSL: "backup export walks every KV namespace" | only namespaces opened since app start | `MSL/src/modules/settingsSync.js:6-8` vs `hive_store_service.dart:52-60` |
| streamline-js: "fresh ephemeral port every time (`_serveFresh`)" | `_serveStable` | `streamline-js/docs/skin-switching.md:3-7` vs `SERVE:429-463` |
| decaid-zen: skin "served from the gateway itself … calls go to the page's own origin" | own port; code calls `hostname:8080` | `decaid-zen/README.md:18-19` vs `decaid-zen/src/lib/gateway.ts:8-13` |
| decaid-zen: `curl -X POST …/webui/skins/default` | PUT only | `decaid-zen/README.md:31-32` vs `WUH:16` |

## 14. Disagreements with RESEARCH.md

- R:20 "`3000`: installed skins" → `:3000` is only a 307 redirector; skins live on per-skin ports 24800–28895 → `SERVE:139-147, 497-519`, `SKINS:78-81`.
- R:22 "REST handlers send `Access-Control-Allow-Origin: *`" (from decaid-zen README) → CORS is permissive via `shelf_cors_headers` `corsHeaders()`; the literal ACAO value is package-defined (not in sources); only listed request headers are allowed; `/api/v1/account/proxy/*` is pinned to skin origins → `WSRV:500-527, 590-630`.
- R:23 "Decaid's README also mentions … `:8443`" → no `8443` anywhere in `decaid/README.md`.
- R:30-33 Crema "updating the skin lost its settings because storage is scoped to the port" → current code keys the port to the skin directory path, which a same-id update reuses, so updates keep the origin; loss requires an id change, path change or bind failure → `SERVE:336-339`, `STORE:1128-1144`, `webui_stable_origin_test.dart:67-98`.
- R:39 "Derek (`POST /api/v1/derek/answers/stream`) need[s] native consent" → `DerekHandler` relays to `derek.decentespresso.com` with no token/consent check; the gate applies only to `/api/v1/account/proxy/*` → `decaid/lib/src/services/webserver/derek_handler.dart:13-38`, `proxy_auth_middleware.dart:20-22`.
- R:43 versions "must be numeric dot-segments" → MSL-internal rule; Decaid stores `version` as an opaque string (must be a JSON string) → `STORE:1019, 1042-1044`.
- R:47-48 CREMA `entry` field; "emit both files with identical content" → only `id/name/description/version` are read; `skin-manifest.json` overrides `manifest.json`; entry is always `index.html` → `STORE:998-1022`, `SERVE:245-250`.
- R:51 github-release body `{"repo","tag"}` → no `tag`; body is `{repo, asset?, prerelease?}`, always latest (or newest incl. prereleases) → `WUH:126-141`, `STORE:368-407`.
- R:53 `POST /api/v1/webui/skins/default` → `PUT` → `WUH:16`.
- R:62 decaid-zen "calls go to the page's own host" → same hostname but port 8080, i.e. cross-origin → `decaid-zen/src/lib/gateway.ts:8-13`.
- R:63 Live-edit "serves the folder on `:3000` same-origin" → own stable port (identity = folder path) behind the 3000 redirect; API on 8080 → `skin_selector_page.dart:671`, `SERVE:336-341`.
- R:67 host override `localStorage.reaHostname` → true for streamline-js/MSL only; decaid-zen uses `localStorage.reaGateway` (full URL); not a platform contract → §8 citations.
- R:70 "Decaid runs on Android 9+" → app installs on SDK 28, but the skin WebView is flagged incompatible below SDK 29 → `build.gradle.kts:34`, `webview_compatibility_checker.dart:147-153`.
- R:71 / R:320 Teclast "1280×800" and Playwright at 1280×800 / 1920×1200 → real CSS viewports are 962×602, 1007×602 (DPR 1.33) and 1140×712 (DPR 1.125) → `simulated_webview_device.dart:39-73`.
- R:80 "Without [heartbeat], auto-sleep breaks" → auto-sleep still fires N minutes after each idle entry; heartbeat only restarts the timer and writes `userPresent` (5 s throttle); no reference skin calls it → `PRES:29, 104-115, 177-188`.
- R:94 port-specific origins make "absolute paths … risky" → each skin is served at its own origin root, so absolute paths resolve; `base: './'` remains the documented choice → `SERVE:245-250`, `SKINS:3530-3539`.
- R:107 "There is no capability endpoint" → `GET /api/v1/machine/capabilities` exists → `de1handler.dart:37-52`, `API:100`.
- R:111 telemetry channel `ws/v1/machine/state` → does not exist → `de1handler.dart:190-206`, `websocket_v1.yml:42-225`.
- R:115 "After a power cycle the snapshot socket goes 'open-but-silent'. Close and re-open sockets" → server re-attaches open machine sockets to the new instance; reopening is unnecessary; derive link state from `/ws/v1/devices` → `de1handler.dart:733-779`, `API:724-750`.
- R:12 "generate … a mock from `assets/api/rest_v1.yml`" → the spec is wrong for KV (404/204/`{deleted}`); mocks must follow code → §13.
- R:152 "Field reports cite 0.8.6+2801" → not confirmable from the Decaid checkout (no tags; pubspec `1.0.0+1` placeholder; version comes from the build tag) → §12.
- R:220 "always include a way back to Streamline" via skin switcher → the platform path is `exitToDashboard()` → native Skins page; in-skin REST switching strands the page unless it navigates through `:3000` after the restart → §5.
- Resolved unknowns (not contradictions): manifest filename (R:12, R:326) → §1; KV path/limits (R:148, R:327) → §4; display paths (R:147) → §10; storage across skin update (R:328) → §2; bundled-skin registry (R:58) → §1.7.

---

## 15. Implications for CafAI (do / don't)

**Packaging**
1. DO emit `skin-manifest.json` at the zip root next to `index.html`: `{"id":"cafai","name":"CafAI","description":"…","version":"<semver string>"}`. All values JSON strings. `author`/`repository` optional and ignored.
2. DON'T ever change `id` after first release (it fixes install dir → port → origin → localStorage/IndexedDB). Use a separate id (e.g. `cafai-dev`) for dev/dist-branch builds, as MSL does (`MSL/README.md:208-209`).
3. DON'T rely on `manifest.json` for identity; if a PWA manifest exists it is ignored when `skin-manifest.json` is present.
4. DO zip the contents of `dist/` at the root (decaid-zen `scripts/package.sh:9-12`). DON'T add any other root entry if using a top-level folder (`__MACOSX/`, stray files).
5. DO publish exactly one `.zip` asset per GitHub release; bump the release tag for every update (tag drives update detection; manifest version is display-only).
6. DON'T use `:`, `<>"|?*`, or trailing dots/spaces in any filename.

**Serving and routing**
7. DO set Vite `base: './'`; DO use hash or in-memory routing (no history-API deep links: no SPA fallback). DO tolerate `?_=<ms>` on the URL.
8. DO restore route, active conversation and unsent draft from storage on every boot (background reloads load `/?_=…`, losing the hash).
9. DON'T rely on lazy-loaded chunks without a fallback: skin files are replaced in place by updates while the page keeps running (no-store caching → a missing hashed chunk 404s). Prefer one bundle, or catch chunk-load errors and `location.reload()`.
10. DO bundle all fonts/icons/assets locally (offline operation). DON'T register a service worker (inference: no-store serving, origin can change on bind fallback; no source supports SWs).
11. DO target `chrome91`-level output and polyfill/avoid `structuredClone`, `Array.prototype.at` and newer APIs; feature-detect (UA is literally `"Decent"`).

**Network**
12. DO build `apiBase = http://${localStorage.reaHostname || location.hostname}:8080/api/v1` and `wsBase = ${location.protocol==='https:'?'wss':'ws'}://<same host>:8080/ws/v1` (streamline-js/MSL convention). DON'T mirror `reaHostname` to KV.
13. DON'T add custom request headers to Decaid calls (CORS allow-list); `Content-Type: application/json` and `If-None-Match` are fine. Respect 429/503 + `retry-after: 1`.
14. DON'T run a dev server on port 3000 on a desktop that also runs Decaid (Decaid's entry server needs it; use Vite 5173).

**Storage**
15. DO keep working state in IndexedDB/localStorage (persist across restarts and same-id updates); DON'T use sessionStorage for anything durable.
16. DO mirror durable non-secret state to KV namespace `cafai` (lowercase, short ASCII keys `[a-z0-9._-]`), JSON-encode every value (including strings), keep each value < 1 MiB and nesting shallow, treat `null` as absent, poll with `GET /api/v1/store/cafai?full=1` + `If-None-Match`.
17. DON'T write the API key, prompts with personal data, or tokens to KV (unauthenticated LAN access, included in `store.json` backups) or to `console.*` (persisted to `webview_console.log`, exposed via `/api/v1/webview/logs`, shipped in support packages). DON'T log per-frame telemetry.
18. DO read DYE2 data (`/api/v1/store/dye2.reaplugin/{autoFavourites,recipes,baskets,equipment}`) read-only; coerce non-arrays to `[]`; refresh on focus/`visibilitychange`; NEVER POST/DELETE those keys; tolerate missing optional fields. When writing shots/workflow, preserve DYE2's `extras` keys and use `''` (not `null`) to clear notes.

**Presence, display, exit**
19. DO `POST /api/v1/machine/heartbeat` (no body) on real user input (pointerdown, keydown, composer typing), client-throttled to about one call per 5–30 s; DON'T send it on timers when nobody is interacting.
20. DON'T take a REST wake-lock override; if needed use `/ws/v1/display` `requestWakeLock` (auto-released when the socket closes). If CafAI dims, re-request brightness after re-entry (reset to 100 on exit).
21. DO provide an "Exit to Decent dashboard" control: `if (window.__DECENT_HOST__ && typeof window.decentApp?.exitToDashboard === 'function') window.decentApp.exitToDashboard();`, resolved at click time; hide it when `__DECENT_HOST__` is absent.
22. DON'T implement in-skin skin switching (PUT default + stop/start strands the page); send users to the dashboard's Skins page instead.
23. DO link settings as `http://${location.hostname}:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI` (full-page navigation; return comes back through `:3000`, i.e. a fresh load of CafAI).
24. DON'T rely on Android Back or edge swipes for in-app navigation (they exit the skin); DON'T put gestures on screen edges; provide on-screen back buttons.
25. DO open external links via top-level navigation (handed to the OS browser); DON'T use `target="_blank"`/popups.

**Lifecycle and telemetry**
26. DO persist streaming LLM output incrementally (backgrounding pauses timers; 10 min → unload; renderer crash → reload).
27. DO keep exactly one socket per channel, reconnect only on close/error with 1→30 s backoff, never on machine disconnect or devices errors; derive machine link from `/ws/v1/devices` (`type==='machine' && state==='connected'`); branch scale frames on `status` vs `weight`.
28. DO treat `getUserMedia` (camera/mic) as unavailable; hide voice/camera features unless feature detection proves otherwise.
29. DO lay out for 962×602, 1007×602 and 1140×712 CSS px (plus iPad/desktop), handle `env(safe-area-inset-*)` yourself, and keep the first 10 s bottom area clear of must-tap controls (exit-instructions snackbar).
30. DO read host version from `window.__DECENT_HOST__` in-app, else `GET /api/v1/info`; show it in About/diagnostics.

## 16. Open questions (ranked by cost of a wrong guess)

1. **Actual WebView engine floor on shipping tablets.** Sources prove pre-Chromium-92 engines exist but give no floor (RESEARCH's "Chromium 91" comes from decaid#901, outside these repos). Wrong guess = blank screen on old tablets. Verify on a real Teclast via `navigator.userAgentData`/feature probes.
2. **Storage survival across iOS app updates / data-dir moves.** Port identity is the absolute skin path; if the container path changes, the origin changes. Wrong guess = silent loss of local history and the stored API key. Mitigate with the KV mirror and an easy key re-entry flow.
3. **`env(safe-area-inset-*)` values in the embedded WebView** on iPad and Android with `immersiveSticky` + `viewport-fit=cover`. Wrong guess = controls under the home indicator or cutout.
4. **`<input type="file">` (gallery / camera capture) in the embedded WebView** (flutter_inappwebview chooser; iOS has a camera usage string, Android has no CAMERA permission). Wrong guess = bag-photo feature dead on device.
5. **CORS on uncaught server exceptions.** KV POST with non-JSON throws outside any catch; whether that 500 carries CORS headers is not settled (likely surfaces as `Failed to fetch`). Affects error reporting only.
6. **Hive constraints on namespaces/keys** (hive_ce 2.19.3 not in sources: key length/charset, box-name case folding). Low cost if keys stay short lowercase ASCII.
7. **Decaid release version of commit a45961b** (no tags in clone). Needed for compatibility claims; read `GET /api/v1/info` on target devices.
8. **What `InAppWebViewController.clearAllCache()` clears per platform** (HTTP cache only, or also Cache Storage). Matters only if CafAI used the Cache API.
9. **GitHub asset order with multiple `.zip` assets.** Avoided entirely by publishing one zip.
10. **Whether the nightly hour-1 app-root restart fires in practice** (timer re-created on every build). Low cost: CafAI persists state anyway.
11. **`file://` URLs for `install/url`** (shown at `SKINS:3099`, Decaid downloads via `package:http`). Dev convenience only.
12. **Server-side key custody via a CafAI plugin** (`PUT /api/v1/plugins/<id>/source`, precedent `decaid-zen/src/api/bundledPlugin.ts:44-51`; plugin storage is readable at `/api/v1/store/<pluginId>/…`, so it is not secret either). Design decision, not settled by sources.

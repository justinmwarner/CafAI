# Decaid AI Dial-in Coach Skin: Research Brief for the Build Prompt

The plan holds up: a React + TypeScript + Vite static skin, served by Decaid and calling Claude directly from the WebView with a user-supplied key, fits how Decaid works today. Three platform facts should shape the build prompt more than anything else. First, profiles are content-hashed and the workflow endpoint deep-merges, so "upload and activate" must send a complete profile object.\[1\]\[2\] Second, the oldest supported tablets run a non-updatable Chromium 91 WebView.\[3\] Third, skins currently cannot use the camera or microphone through getUserMedia.\[4\] MUI does ship an official chat library (`@mui/x-chat`, MIT), but it is a pre-1.0 alpha.\[5\]

## TL;DR

- **Platform fit is good, with three traps.** Decaid serves skins as static zips on a stable per-skin origin that sits behind the `:3000` entry point. Its REST/WS API on `:8080` has open CORS. Anthropic has allowed browser calls since August 2024, when it quietly added the `anthropic-dangerous-direct-browser-access: true` request header through anthropic-sdk-typescript PR #504 (written up by Simon Willison on 23 Aug 2024). The traps:
  - `PUT /api/v1/workflow` deep-merges. The workflow profile has no `id`, so activating a profile means PUTting the whole profile object.
  - A new profile must include `tank_temperature`, `target_volume`, `target_volume_count_start` and `version`, or the request fails with a bare "Invalid request".
  - A step supports only one exit condition (pressure or flow, over or under).
- **Build in browser storage, with a mirror and no camera/mic dependency.** Keep all coach data in IndexedDB. Mirror non-secret state to Decaid's KV store, because origin changes have wiped skin storage in the past. Never store the API key anywhere except locally. Treat camera and microphone as unavailable: photo upload through `<input type="file">` might work, and voice input should come from the Android keyboard's dictation. Compile to a Chromium 91 target.
- **Verify against a mock, not hardware.** The overnight agent cannot rely on hardware or on running Decaid headlessly. It should generate types and a mock from `assets/api/rest_v1.yml` / `websocket_v1.yml`, add hand-written fixtures for the behaviours the spec gets wrong, and ship a GitHub Release zip with `index.html` and the manifest at the root. The highest-risk unknowns are the exact manifest filename and fields, the KV-store endpoint, and profile id/version semantics. The agent must read these from the Decaid repo first.

## Key Findings

### 1. Decaid skin development

**Ports and serving (verified)**
- `8080`: REST at `/api/v1/…` and WebSockets at `/ws/v1/…`.\[6\]\[7\]
- `3000`: installed skins.\[7\]
- `4001`: interactive API docs (MSL README; Decaid README).\[6\]\[7\]
- CORS is open: "the gateway's REST handlers send `Access-Control-Allow-Origin: *`" (decaid-zen README), and "CORS is open by default, so a skin served from any origin can talk to the gateway" (MSL README).\[7\]\[8\]
- Decaid's README also mentions a parallel HTTPS listener on `:8443`. This is only a proposal in issue #925 and does not exist yet.\[9\]

**Origins and storage (verified, but changing fast)**
- `:3000` is the stable entry point. It answers with a no-store 307 redirect to the active skin's own assigned port (e.g. `:3000 → 307 → :27306`). Each skin has its own origin; this was introduced for token isolation in #641 (issues #950 and #940).\[10\]\[11\]
- PR #790 made each skin's origin stable across restarts. Its stated reason: "A skin's browser storage was wiped at every app start, because its origin changed every time."\[12\]
- doc/Skins.md now has a section "Skin Origins and Browser Storage". It guarantees persistence for localStorage and IndexedDB only. sessionStorage does not survive a background page unload or an app restart. If the assigned port cannot be bound, the skin falls back to a temporary origin, which has empty storage.\[12\]
- **Conflict to flag:**
  - The Liquid Aqua README still says "every update lands the browser on a new origin and localStorage starts empty".\[13\]
  - Crema v1.1.1 (15 Sep 2026) reported that updating the skin lost its settings because storage is "scoped to the port Decaid serves the skin from".\[14\]
  - PR #940 calls the "every serve creates a new origin" claim stale.\[11\]
  - Conclusion: storage persistence is better now but not guaranteed. Design for loss.
- The WebView is unloaded after 10 minutes in the background and reloads the skin from scratch (MSL README).\[7\] Persist anything important immediately, not on unload.

**Token injection (partially verified)**
- Decaid injects a script `/__decent/skin-api.js` and "injected proxy-token metadata" (an account-proxy token) into the active skin.\[10\]
- Tokens rotate and are revoked when the user switches skins or the server stops (#940, #950).\[11\]
- Proxy callers such as Derek (`POST /api/v1/derek/answers/stream`) need native consent (#641).\[10\]\[15\]
- The coach does not need any of this for core REST calls. The `:8080` API has no authentication; decaid-mcp warns "Port 8080 is Decaid's whole API, and it has no authentication".\[16\]

**Manifest and package (partially verified — highest-priority thing to confirm)**
- MSL: `skin-manifest.json` ("id / name / version — how Decaid identifies the skin") "must sit at the **zip root**". Versions must be "numeric dot-segments".\[7\]
- Liquid Aqua: `skin-manifest.json` with "id, name, description, version".\[13\]
- Insight: "index.html + manifest.json at the archive root", and the repo also contains `skin-manifest.json`.\[17\]
- Crema for Decaid: the zip "has `index.html` and `manifest.json` at its root".\[18\]
- CREMA v2: `manifest.json` with `id/name/version/author/repository/entry`.\[19\]
- Recommendation: emit both files with identical content until doc/Skins.md is read.

**Install, switch and serve endpoints (verified from community READMEs)**
- `POST /api/v1/webui/skins/install/github-release` with body `{"repo":"owner/name","tag":"v1.2.35"}`.\[13\]
- `POST /api/v1/webui/skins/install/url` with body `{"url":"http://…/skin.zip"}`. \[8\]\[20\]
- `POST /api/v1/webui/skins/default` with body `{"skinId":"decaid-zen"}`.\[8\]
- `GET /api/v1/webui/server/status`.\[21\]
- `GET /api/v1/webui/skin-assets/{skinId}/{path}` serves raw files out of any installed skin, so skins can share assets.\[7\]
- Native "Install from GitHub branch" arrived in #633.\[22\]
- In the app UI: Launcher → Skins → + → GitHub Release / ZIP file.\[18\] Install is also available from the settings plugin UI at `http://localhost:8080/api/v1/plugins/settings.reaplugin/ui`. \[7\]
- Decaid's repo has `skin_sources.json` and `bundle_skins.sh`; these are presumably the bundled skin registry.\[6\]
- Issue #919 plans a `decentespresso.com/github.com/...` mirror fallback for GitHub-backed installs.\[23\]

**Development workflow (verified)**
- decaid-zen: `VITE_GATEWAY=http://<tablet>:8080`, then `npm run dev -- --host`, then open `http://<laptop-ip>:5173` in the tablet browser. Hot reload against real hardware works because CORS is open. In production `VITE_GATEWAY` is unset, so calls go to the page's own host.\[8\]
- Desktop Decaid has "Live-edit from folder…", which serves the folder on `:3000` same-origin (MSL).\[7\]
- MSL's release workflow publishes `main` to a `dist` branch with the manifest id suffixed (`msl-dist`), so dev builds install alongside the released skin.\[7\]

**Host discovery convention**
- The backend host defaults to `window.location.hostname:8080`, with an override in `localStorage.reaHostname` (MSL; Streamline manual).\[7\]

**WebView constraints (verified)**
- Decaid runs on Android 9+, iPad, macOS, Windows and Linux (Crema README).\[6\]\[18\]
- Teclast P85Pro runs Android 12 with an "immutable AOSP Chromium 91 WebView" at 1280×800 and DPR 1.125. Skin swipes are janky even after skin-side optimisation (#901).\[3\]
- Android tablets need hybrid composition. #901 proposes a diagnostic switch for it.\[3\]
- MSL designs on a fixed 1920×1200 canvas scaled with a CSS transform. CREMA v2 uses 1320×800.\[7\]\[19\]
- Decaid's WebView "runs edge to edge and reports no safe-area insets at all" (Crema v1.1.0).\[18\]
- Touch gotchas (MSL):
  - never `preventDefault()` a `touchstart` inside a scroller;\[7\]
  - HTML5 drag-and-drop does not work (`dragstart` never fires), so use pointer events;\[7\]
  - re-rendering on every WebSocket tick "ate presses and wiped half-typed forms" (Crema).\[18\]
- Brightness: when the skin view closes, Decaid restores OS brightness, so skins must request fixed brightness again after re-entry (#643).\[24\]
- Skins should `POST /api/v1/machine/heartbeat` on user interaction. Doc/Skins.md has a section on this ("Signal User Presence (Heartbeat)"). Without it, auto-sleep breaks (bestpresso #98).\[25\]

**Camera, microphone and files (verified negative)**
- Issue #897: "Skins cannot use the camera: permission not declared, never requested, no WebView handler". With no `onPermissionRequest`, Android denies `getUserMedia`.\[4\]
- `<input type=file>` "goes through flutter_inappwebview's own file chooser … so it may still work".\[4\]
- A fork PR (ODevStudio/decaid #7) adds per-skin camera consent but explicitly rejects microphone requests. It is not merged upstream.\[26\]
- Conclusion: no live camera and no Web Speech or getUserMedia microphone. Use file input for bag photos and the soft keyboard's dictation for voice.

**Existing bundled TypeScript skins (verified)**
- decaid-zen: Vite + TS, `vite.config.ts`, `npm run package`.\[8\]
- Bestpresso: TS (`src/api/decaid/readiness.ts`).\[19\]
- Crema web: `npm run release:zip`.\[18\]
- DYE2: a Vite-built plugin.\[27\]
- Decal: Lit, with a mock server and headless-Chrome render tests in `tools/`.\[20\]
- For SPA bundling, use `base: './'` (relative asset paths), hash or query routing (MSL uses `?page=`), and no service worker. These are inferences: the port-specific origins make absolute paths and service workers risky.

### 2. REST and WebSocket API

**Specs**
- `assets/api/rest_v1.yml` (OpenAPI) and `assets/api/websocket_v1.yml` (AsyncAPI 3.1.0, repaired in #892 after failing to parse).\[28\]
- AGENTS.md and CONTRIBUTING.md make same-PR spec updates a hard rule, so the specs are authoritative.\[29\] Issues still show drift:
  - #913: `timestamp` is mutable even though `ShotUpdateRequest` excludes it.\[30\]
  - #912: empty bean names are accepted.\[31\]
  - #911: bean delete returns a foreign-key 500.\[32\]
- Generating a typed client with openapi-typescript is feasible. Expect to hand-patch.

**Machine**
- `GET /api/v1/machine/info` returns the model string.\[33\] "There is no capability endpoint", so features have to be gated on the model string.\[7\]
- `PUT /api/v1/machine/state/espresso` starts a shot.\[17\] Requesting the `idle` state stops it.\[34\]
- `POST /api/v1/machine/heartbeat`.\[25\]
- `GET /api/v1/info`.\[9\]
- Telemetry channels: `ws/v1/machine/state`, `ws/v1/machine/shotState` (sequencer decisions, latest event only, not replayable per #899), and a machine snapshot socket.\[35\]
- Snapshot fields include `mixTemperature`, `groupTemperature`, `targetMixTemperature` and `targetGroupTemperature`.\[19\] During hot water, `mixTemperature` is not the outlet temperature (#943).\[36\]
- Readiness: Bestpresso and CREMA v2 derive READY / HEATING / SLEEPING / NO WATER / DISCONNECTED from the snapshot plus an 8 °C slack.\[19\]
- Connection state comes from `ws/v1/devices`, not from silence on the telemetry sockets: "the sockets stay open even with the machine off" (doc/Skins.md § Machine Telemetry Socket Lifecycle).\[19\]
- After a power cycle the snapshot socket goes "open-but-silent". Close and re-open sockets rather than reconnecting naively (MSL `socket-slot.js`, `machine-link.js`).\[7\]

**Scale and devices**
- `GET /api/v1/scale/info`.\[37\]
- `GET /api/v1/devices/scan`.\[29\]
- `PUT /api/v1/devices/connect?deviceId=…` (`MockScale` exists in the simulator).\[17\]
- Dosing scale: `ws/v1/scale/dosing/snapshot` and `PUT /api/v1/scale/dosing/tare` (#834).\[38\]
- The brewing-scale tare and snapshot paths were not verified.

**Shots**
- Endpoints: `GET /api/v1/shots`, `GET /api/v1/shots/latest`, `GET /api/v1/shots/{id}`, `PUT /api/v1/shots/{id}`.\[30\]\[34\]\[39\]
- `ShotRecord` requires `id`, `timestamp`, `measurements` and `workflow` (#916),\[40\] and has `createdAt`, `updatedAt` and `stopReason`.\[22\]\[30\]\[35\]
- Sampling is "about four times a second" and records `targetPressure` / `targetFlow` per point plus the machine's `state.substate` phase markers (decentespresso-mcp).\[41\]
- Measurements stop when the shot stops. The settled yield is in `annotations.actualYield` (since v0.7.8); the dose is in `annotations.actualDoseWeight`.\[42\]
- Annotations:
  - `enjoyment` is 0–10 after #887 and 0–100 in 0.8.6, and Decaid converts at the Visualizer and de1app boundaries;\[16\]\[43\]
  - `espressoNotes`;\[44\]
  - `extras`, e.g. `annotations.extras.uploaded_to_decent`.\[22\]
- `ShotAnnotations.toJson()` omits nulls, so clear a field with `''` rather than `null`.\[44\]
- The shot list has no duration.\[16\]
- The pre-shot workflow context is in `workflow.context.extras`, alongside `context.drinkerName` and `context.baristaName`.\[33\]\[44\]

**Beans and batches**
- `/api/v1/beans` requires `name` and `roaster`.\[31\] Batches can be listed across beans (#646).\[22\]
- `extras` is replaced as a whole, so read-merge-write ("Decaid replaces extras as a whole, so the plugin merges first" — decaid-mcp).\[16\]
- A real `/api/v1/equipment` resource is coming (#727).\[45\]

**Workflow**
- Profile keys returned by `GET /api/v1/workflow`: `author, beverage_type, notes, steps, tank_temperature, target_volume, target_volume_count_start, target_weight, title, version`.\[2\]
- `PUT` deep-merges (`deepMergeJson`) and drops any profile `id` (DYE2 #10; streamline-js #90).\[1\]\[2\]

**Other**
- Display brightness and wake-lock control exist (README); paths not verified.\[6\]
- A KV store exists ("Decaid KV store … Follows the machine, not the browser" — MSL; DYE2 has `KV_CONTRACT.md`).\[7\]\[27\] The exact path is unverified.
- Derek proxy: `POST /api/v1/derek/answers/stream`.\[15\]

**Version and pace**
- Field reports cite 0.8.6+2801.\[25\]\[30\] Upstream PR numbers passed 940 by October 2026,\[36\] and ratings changed scale between minor versions.\[16\]
- Treat the API as volatile. Pin a tested Decaid version and expose it in the skin's About and status views.

### 3. Profile v2 JSON

**Verified structure (de1app-compatible v2; community-posted example)**
```json
{
  "title": "JW ASL 2", "author": "JW", "notes": "…", "beverage_type": "espresso",
  "steps": [
    { "name": "infuse", "temperature": "90.0", "sensor": "coffee", "pump": "flow",
      "transition": "fast", "pressure": "0", "flow": "8.0", "seconds": "10",
      "volume": "0", "weight": "0.0",
      "exit": { "type": "pressure", "condition": "over", "value": "…" },
      "limiter": { "value": "0", "range": "0.6" } },
    { "name": "decline", "temperature": "90.0", "sensor": "coffee", "pump": "pressure",
      "transition": "smooth", "pressure": "6.0", "flow": "8.0", "seconds": "30" }
  ],
  "tank_temperature": "0", "target_weight": "36", "target_volume": "0",
  "target_volume_count_start": "0", "version": "2"
}
```
- The step skeleton above is from a Home-Barista post.\[46\] The `exit` value and the top-level target values are illustrative.
- Allowed values (inferred from usage and #914):
  - `pump`: `pressure | flow`
  - `transition`: `fast | smooth`
  - `sensor`: `coffee | water`
  - `exit.type`: `pressure | flow`
  - `exit.condition`: `over | under`
- One exit condition per step (#914).\[47\]
- A weight-based stop is the profile-level `target_weight`; a time-based stop is the step's `seconds`. Streamline's `profile-field-limits.js` maps "off" to `exit = null`.\[47\]
- de1app serialises numbers as strings. Whether Decaid accepts numbers is unverified, so mirror whatever `GET` returns.
- The profile maker has a hard maximum of 20 steps per profile. Robert McKeon's Coffee Data Science post "Developing a Decent Profile for Espresso" says: "I was also limited by the maximum for 20 steps in the profile maker."

**Identity and versioning**
- Profiles are content-addressed ("content-based hashing and automatic deduplication"), with ids like `profile:198546fc983546de03b7`.\[2\]\[6\]
- Edits change the id ("make ID-changing updates atomic", #624). Parent links exist ("bundle Adaptive v3 profile linked to v2 parent", #718).\[22\]
- Duplicate titles are allowed ("two profiles can share a title").\[2\]
- Implication: keep the coach's own per-bean version history in IndexedDB and treat Decaid's id as an opaque pointer to the latest version.

**Canonical files**
- de1app's built-in profiles are `de1plus/profiles/*.tcl`. `profiles_v2/*.json` is gitignored and generated at runtime, so JSON templates must come from Decaid's bundled profiles (`tools/ingest_profiles.py` converts TCL to v2), from Visualizer, or from Decaid's `GET /api/v1/profiles`.\[48\]\[49\]\[50\]
- **Recommendation:** the agent should snapshot the bundled profiles from a running Decaid or from the Decaid repo assets into `src/templates/*.json`. It should not hand-write Blooming, Allongé, Adaptive v2/v3, Londinium, Extractamundo Dos or D-Flow.

**Safe adjustment knobs (proposed bounds — inferred; verify against Streamline's `profile-field-limits.js`)**

| Lever | Where it lives | Step size | Suggested bounds |
|---|---|---|---|
| Temperature | every step `temperature` | ±1 °C (max ±2 per iteration) | 80–100 °C |
| Target yield / ratio | `target_weight` | ±2–4 g (≈0.1–0.2 ratio) | 1:1.5 to 1:5 (Allongé up to ~1:5) |
| Preinfusion time | preinfusion step `seconds` | ±2–5 s | 0–30 s |
| Preinfusion pressure limit/exit | `exit.value`/`pressure` | ±0.5–1 bar | 1–6 bar |
| Bloom/soak length | bloom step `seconds` | ±5 s | 0–40 s |
| Peak pressure | pressure step `pressure` | ±0.5–1 bar | 3–10 bar |
| Flow target | flow step `flow` | ±0.25–0.5 ml/s | 0.5–6 ml/s |
| Decline end pressure | final step `pressure` | ±0.5–1 bar | 2–8 bar |

Never let the model change pump type, step order, step count, sensor, or exit type. Templates should declare which fields are adjustable.

### 4. Full-skin scope, settings delegation, plugins

**Baseline feature set (from Streamline, MSL and Bestpresso)**
- espresso start/stop with a live graph, steam, flush, hot water, and sleep/wake
- scale connection and tare
- profile picker
- shot history
- settings
- a screensaver ("The screen saver belongs to the skin, not to Decaid")\[51\]
- a skin switcher. Users get stranded without one (#788), so always include a way back to Streamline.\[52\]

**Delegation**
- A settings plugin UI exists at `/api/v1/plugins/settings.reaplugin/ui`.\[7\] Linking to it reduces scope.
- Bundling a standalone "streamline-setting" module was not verified.

**Plugins**
- A plugin is a `.reaplugin` folder containing `manifest.json` (required `id`, `version`, `apiVersion`, `author`, `description`, permissions) and `plugin.js` exporting `createPlugin`.\[27\]\[45\]
- Endpoints are served at `/api/v1/plugins/<id>/<api-id>` (HTTP) and `/ws/v1/plugins/<id>/<api-id>`.\[45\]
- Plugins run on Decaid's main thread under flutter_js.\[16\]
- Limits: 1 MiB requests and 30 s per call; a plugin is disabled after three failed loads.\[16\]
- Network access is permission-gated through `host.transport` (#759).\[22\]
- Install with `POST /api/v1/plugins/install/github-branch`, then `POST …/enable`.\[16\]
- **Verdict:** do not put LLM calls in a plugin. The main-thread execution, 30 s cap and lack of streaming make it unsuitable. A plugin only becomes worthwhile in V3, for background shot post-processing or cross-skin data.

### 5. Simulate mode
- Decaid "ships a **device simulator**" (MSL), including MockDe1 and MockScale,\[36\] and Decent's forum notes "there's an espresso simulator in that too".\[7\]\[17\]\[53\]
- A Linux GTK build and a Dockerfile exist, but headless operation is unverified.\[6\]
- **Recommendation:** the agent relies on a spec-derived mock plus recorded fixtures. Running the real simulator on a desktop is a human acceptance step.

### 6. LLM calls from the WebView
- **Anthropic:**
  - Required headers for a direct `fetch` to `https://api.anthropic.com/v1/messages`: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`.\[54\]\[55\]
  - Without the last header the API returns "CORS requests must set 'anthropic-dangerous-direct-browser-access' header".\[55\]\[56\]
  - The official SDK added browser support in PR #504 (`dangerouslyAllowBrowser: true`).\[57\]\[58\] Ferhat Atagun's 2026 DEV Community post "Building a streaming Claude client in the browser — without the SDK" reports that importing the SDK broke a Next.js browser bundle: "The error pointed at node:fs/promises… an agent-toolset module… pulled in by the SDK's main client entry." A thin fetch + SSE client is therefore the safer default.
  - Use tool use / JSON-schema output for the adjustment object, image content blocks for the bag photo, and SSE streaming.
- **Models and pricing:** Anthropic's Claude Platform Docs ("What's new in Claude Opus 5.5") list the current flagship as Claude Opus 5.5, API ID `claude-opus-5-5`, "priced at $4 / $20 USD per million input / output tokens". The model pages list Sonnet 5.5 at $2/$10 and Haiku 4.5 at $1/$5, and Opus 5 is now legacy ($5/$25). The same page warns that "Claude Opus 5.5 doesn't support forced tool use", and that setting `tool_choice` to `{"type": "any"}` or `{"type": "tool", …}` returns a 400. So keep `tool_choice: "auto"` and use strict tool use or structured outputs for the adjustment object. Keep the model list in config. Crema reports about 1–2¢ per shot and found that "a top-tier model like Claude Opus … gives noticeably sharper … advice than a smaller or cheaper model".\[18\]
- **Security:**
  - The key lives in localStorage or IndexedDB on a LAN origin with an unauthenticated API next door, so any LAN client could install a plugin (`PUT /api/v1/plugins/:id/source`).\[16\] Treat the device as trusted, but never write the key to Decaid's KV store, never put it in logs or shot extras, and offer "forget key".
  - Crema follows the same rule ("Your API key is still never written there").\[14\]
- **OpenAI:** not researched. Put Claude and OpenAI behind a `LlmProvider` interface (`stream(messages, tools, images) → AsyncIterable<Chunk>`). MUI X Chat ships an AI SDK adapter, which makes the Vercel AI SDK a viable later option.\[59\]
- **Outbound HTTPS from the WebView:** works in practice; Crema calls providers directly from the Decaid WebView.\[18\]

### 7. MUI chat
- `@mui/x-chat` 9.0.0-alpha.18, MIT. "Every MUI X Chat feature ships in the Community plan — there is no Pro or Premium tier." It is labelled "Preview" / "in early development".\[5\]\[59\]
- Features: `ChatBox`, and a headless `@mui/x-chat/headless` with an adapter whose only required method is `sendMessage()`, returning a `ReadableStream` of typed chunks (text, reasoning, tool, source, file, data, step, metadata).\[60\]
- Also: suggestions, attachments, tool calling with an approval flow, multi-conversation (which maps to bags), theming through MUI tokens, and an AI SDK adapter.\[59\]\[61\]
- **Verdict:** use it, but behind your own `ChatSurface` wrapper. Pin the exact version, because alpha APIs will break. Render quick-reply chips and diff-confirmation cards as custom message parts.
- The fallback is assistant-ui (not evaluated here).

### 8. Coffee domain logic (heuristics — not source-verified in this pass)
- **Bean to profile family:**
  - Light, washed, high-grown beans → Allongé / Blooming / Extractamundo Dos, at 93–96 °C and ratio 1:2.5–1:4.
  - Medium → Adaptive / D-Flow / Blooming, at 90–93 °C and 1:2–1:2.5.
  - Dark → Londinium / lever-style / Default, at 85–90 °C and 1:1.8–1:2.2.
  - Naturals and anaerobics run 1–2 °C cooler than washed beans at the same roast.
  - John Buckman informally polled owners during a European tour (Decent blog, "Not everyone is making Decent coffee: thoughts on how to improve that"): "I asked people (over a casual drink at night) which group they felt they were part of… About 1/3rd of people fit into each category." Owners who made good coffee consistently "all used these profiles: Londonium, D-Flow, Adaptive, Extramundo Dos, Allongé". Owners who struggled tended to use "E61 and 'classic Italian espresso'".
  - Decent previously had a Profile Generator (Stéphane Ribes) keyed on roast level and origin. That is prior art for the mapping.\[62\]
- **Symptom → levers (priority order):**

| Symptom | First lever | Second | Third |
|---|---|---|---|
| Sour, thin | grind finer 1 step | +1–2 °C | longer ratio |
| Bitter, harsh | shorter ratio | −1–2 °C | grind coarser |
| Sour + bitter / astringent | check channeling → puck prep, longer preinfusion | lower peak pressure | — |
| Too strong | longer ratio | — | — |
| Watery | shorter ratio / finer | — | — |
| Muted/flat | +1 °C or bloom | — | — |
| Lacks sweetness | adjust ratio toward middle | temp | — |

- **Telemetry:**
  - Resistance = pressure / flow², and a falling resistance means channeling.\[41\]
  - The five channeling indicators: pressure dip after peak, flow instability, pump vs scale flow divergence, early first drops, resistance trend (decentespresso-mcp / decaid-mcp).\[16\]\[41\]
  - Read the end of preinfusion from `state.substate`.\[41\]
  - Compliance: compare `targetPressure`/`targetFlow` against actual readings, and only during the phase each one controls. A flow-phase `targetPressure` is a limit, not a target.\[63\]
- **Process rules:** change one variable per shot (grind counts as one variable). Expect 3–5 shots to dial in. Treat grind numbers as relative to the grinder's own dial range.
- **Feedback UX:** Crema uses "four taps: taste, body, flow look, finish, and a 1–5 score", then "one clear move", "Undo after Apply", and a dial-in trail "keyed on the bag rather than the bean name".\[18\]

### 9. Prior art
- **yarneo/crema** (GPL-3) is the closest prior art and a near-direct competitor. It is an AI dial-in coach for Decaid and de1app with BYO keys (Anthropic, OpenAI, OpenAI-compatible, or a local Mac server), AI-authored profiles, and a grinder name and dial range.\[18\] Study it and differentiate on the chat-first flow, bounded templates and teaching mode.
- **decaid-mcp** (a plugin) and **decentespresso-mcp** have well-tested diagnostic thresholds.\[16\]\[41\] Reuse their definitions in the shot summary.
- **DYE2** is the official bean/grinder plugin and owns certain KV keys ("don't POST/DELETE keys you don't own").\[45\]
- **Derek** is Decent's assistant\[51\] and is reachable through the proxy.\[51\]
- **Visualizer** uses 0–100 enjoyment at its boundary.\[43\]

## Recommendations

1. **Repo layout:**
   - `src/api/` for the generated types and a handwritten client with WS slot management;
   - `src/coach/` for pure logic: templates, adjustment validator, shot summariser, diff text;
   - `src/llm/` for the provider interface plus the Anthropic fetch client;
   - `src/storage/` for an IndexedDB layer (Dexie) plus a KV mirror;
   - `src/ui/`;
   - `mock/` for MSW handlers generated from the spec plus fixtures;
   - `public/skin-manifest.json` and `public/manifest.json`.
2. **Build:** set `base: './'`, `build.target: 'chrome91'`, hash routing, no service worker, and self-hosted fonts.
3. **Shot summary for the LLM:**
   - aggregates: dose, yield, ratio, time, time to first drop, preinfusion end, peak pressure, mean flow, temperature deviation, resistance trend, channeling flags;
   - plus 4 Hz data resampled to 0.5–1 s;
   - plus a sandboxed query tool that offers named functions over the series, not `eval`.
4. **Profile update flow:**
   - fetch the template;
   - apply the validated deltas;
   - set the title to `"<Bean> v<n>"` and include all four required fields;
   - POST it;
   - `PUT /api/v1/workflow` with the full profile;
   - re-GET to confirm.
5. **Testing:**
   - Vitest for the coach logic and validator;
   - MSW contract tests against `rest_v1.yml`;
   - Playwright at 1280×800 and 1920×1200 against the mock, with a scripted fake shot over a mocked WS and a mocked Anthropic SSE.
6. **CI and release:** a tag `v*` builds the zip with `index.html` and the manifests at the root and attaches it to a GitHub Release.\[17\] Use the GPL-3.0 licence to match the ecosystem.\[41\]

## Caveats and open questions (ranked by cost of a wrong assumption)

1. Exact profile create/update/delete endpoints, the id/version/parent fields, and whether the API accepts numbers or strings. These are unverified and core to the product.
2. The skin manifest filename and its required fields.
3. The KV-store endpoint path and its limits.
4. Whether storage survives a skin update on current Decaid. Sources conflict.
5. The brewing-scale tare and snapshot paths, plus the snapshot WS message schema.
6. Whether the file-input camera or gallery works in Decaid's WebView.
7. MUI v9 / `@mui/x-chat` compatibility with Chromium 91.
8. Whether the Claude model ids and prices listed in Anthropic's docs (Opus 5.5 `claude-opus-5-5` at $4/$20, Sonnet 5.5 at $2/$10, Haiku 4.5 at $1/$5 per million tokens) are still current at build time, and how the lack of forced tool use on Opus 5.5 affects the adjustment-object design.
9. Whether the bundled skin registry requires open source, and how it is admitted.
10. Whether the Decaid simulator can run headless in CI.

## Sources

1. [Applying a favourite, recipe or profile pick may only rename the current profile · Issue #10 · decentespresso/dye2](https://github.com/decentespresso/dye2/issues/10)
2. [The auto-save's profile-drift guard never fires: the workflow's profile carries no id · Issue #90 · decentespresso/streamline-js](https://github.com/decentespresso/streamline-js/issues/90)
3. [Add an Android skin composition diagnostic switch and report effective rendering settings · Issue #901 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/901)
4. [Skins cannot use the camera: permission not declared, never requested, no WebView handler · Issue #897 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/897)
5. [@mui/x-chat - npm](https://www.npmjs.com/package/@mui/x-chat)
6. [GitHub - decentespresso/decaid: Companion to your Decent Espresso machine · GitHub](https://github.com/decentespresso/decaid)
7. [GitHub - allofmeng/MSL: This is a streamline.js inspired skin , it is modified by allofmeng , requires the latest decaid app from decent espresso in order to run smoothly. · GitHub](https://github.com/allofmeng/MSL)
8. [GitHub - pudabassman/decaid-zen](https://github.com/pudabassman/decaid-zen)
9. [Add Advanced Settings TLS certificate import and HTTPS API listener · Issue #925 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/925)
10. [fix(webui): keep bookmarked skin ports working after skin switches · Issue #950 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/950)
11. [docs: clarify stable skin bookmark addresses by ODevStudio · Pull Request #940 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/940)
12. [fix(webui): give each skin a stable origin, so its browser storage survives by ChampionDesigns · Pull Request #790 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/790)
13. [GitHub - SongPaul/liquid-aqua-skin: Liquid Aqua - a liquid-glass WebUI skin for the Decaid espresso gateway · GitHub](https://github.com/SongPaul/liquid-aqua-skin)
14. [Release v1.1.1 · yarneo/crema](https://github.com/yarneo/crema/releases/tag/v1.1.1)
15. [GitHub - pponce/streamline-js · GitHub](https://github.com/pponce/streamline-js)
16. [GitHub - The-Walker443/decaid-mcp: MCP server as a Decaid plugin for the Decent Espresso DE1 - shot analysis and write-back directly inside Decaid](https://github.com/The-Walker443/decaid-mcp)
17. [GitHub - decentespresso/insight-js: Browser-native Insight skin for Decent.app / reaprime — a vanilla-JS port of the de1app Insight skin (GPL-3).](https://github.com/decentespresso/insight-js)
18. [GitHub - yarneo/crema: AI espresso dial-in coach for the Decent DE1 — a de1app skin that reads your shot curves and recommends grind, dose, yield, temp, or a new profile in one tap](https://github.com/yarneo/crema)
19. [GitHub - thiraraujo/decaid-skin-crema · GitHub](https://github.com/thiraraujo/decaid-skin-crema)
20. [GitHub - ChampionDesigns/decal: An open-source ReaPrime skin for Decent Espresso and Bengle machines · GitHub](https://github.com/ChampionDesigns/decal)
21. [GitHub - MaxRink/streamline-js · GitHub](https://github.com/MaxRink/streamline-js)
22. [Releases · decentespresso/decaid](https://github.com/decentespresso/decaid/releases)
23. [Add decentespresso.com fallback for GitHub-backed updates and resources · Issue #919 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/919)
24. [fix(skins): restore brightness when skin view closes by ODevStudio · Pull Request #643 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/643)
25. [No /machine/heartbeat on user interaction, so Decaid's auto-sleep timer is never armed by the skin · Issue #98 · xinghendri/bestpresso](https://github.com/xinghendri/bestpresso/issues/98)
26. [fix: gate Android skin camera access on native consent by ODevStudio · Pull Request #7 · ODevStudio/decaid](https://github.com/ODevStudio/decaid/pull/7)
27. [GitHub - loganfuller/dye2 · GitHub](https://github.com/loganfuller/dye2)
28. [fix: repair AsyncAPI 3.1 spec and API docs viewer by tadelv · Pull Request #892 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/892)
29. [fix(scan): protect post-wake preferred-scale reacquisition from client scan churn by tadelv · Pull Request #930 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/930)
30. [PUT /api/v1/shots/{id} accepts arbitrary timestamp mutation · Issue #913 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/913)
31. [POST /api/v1/beans accepts an empty name and roaster, and a missing one fails with a type-cast error · Issue #912 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/912)
32. [DELETE /api/v1/beans/{id} fails with a foreign-key 500 when the bean has batches · Issue #911 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/911)
33. [GitHub - levylabpitt/espressolab · GitHub](https://github.com/levylabpitt/espressolab)
34. [GitHub - TobiasGregorius/bestpresso: Best: skin for Decent Espresso · GitHub](https://github.com/TobiasGregorius/bestpresso)
35. [Persist shot transition events and expose consistent live/history data · Issue #899 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/899)
36. [fix: preserve profile telemetry during simulated hot water by tadelv · Pull Request #943 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/943)
37. [fix(scale): make Skale battery reporting nullable and refresh it by MaxRink · Pull Request #743 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/743)
38. [feat(scale): reserve a second scale for weighing the dose by SongPaul · Pull Request #834 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/834)
39. [GitHub - mp0x6/decaid-hass · GitHub](https://github.com/mp0x6/decaid-hass)
40. [fix(import): clear error when Import Shots (JSON) is fed a De1App shot by allofmeng · Pull Request #916 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/916)
41. [GitHub - The-Walker443/decentespresso-mcp: Decent MCP Server: Your espresso archive, and someone to talk to about it (based on Decaid) · GitHub](https://github.com/The-Walker443/decentespresso-mcp)
42. [fix(dashboard): show the saved actual yield on Last Shot, not the last graph sample by loganfuller · Pull Request #11 · decentespresso/dye2](https://github.com/decentespresso/dye2/pull/11)
43. [fix(shots): read and write enjoyment on Decaid's 0-10 scale by allofmeng · Pull Request #8 · decentespresso/dye2](https://github.com/decentespresso/dye2/pull/8)
44. [Clearing a shot note with null restores its pre-shot note · Issue #16 · decentespresso/dye2](https://github.com/decentespresso/dye2/issues/16)
45. [GitHub - decentespresso/dye2 · GitHub](https://github.com/decentespresso/dye2)
46. [Life Giving Springs - Crema Bar - Page 2](https://www.home-barista.com/coffees/life-giving-springs-crema-bar-t104371-10.html)
47. [Profile steps: allow more than one exit condition (AND / OR) · Issue #914 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/914)
48. [de1app/de1plus at main · decentespresso/de1app](https://github.com/decentespresso/de1app/tree/main/de1plus)
49. [de1app/.gitignore at main · decentespresso/de1app](https://github.com/decentespresso/de1app/blob/main/.gitignore)
50. [fix(import): merge legacy and v2 de1app shots/profiles instead of picking one by allofmeng · Pull Request #905 · decentespresso/decaid](https://github.com/decentespresso/decaid/pull/905)
51. [GitHub - decentespresso/streamline-js · GitHub](https://github.com/decentespresso/streamline-js)
52. [\[Bug Report\] \*\*Changing skins Decaid problematic\*\* · Issue #788 · decentespresso/decaid](https://github.com/decentespresso/decaid/issues/788)
53. [Decent Espresso news - Marketplace - Page 290](https://www.home-barista.com/marketplace/decent-espresso-news-t66649-2890.html)
54. [Building a streaming Claude client in the browser — without the SDK - DEV Community](https://dev.to/ferhatatagun/building-a-streaming-claude-client-in-the-browser-without-the-sdk-5f80)
55. [Connection test to Anthropic API fails — missing \`anthropic-dangerous-direct-browser-access · Issue #1 · kenzo47/ThunderClaude](https://github.com/kenzo47/ThunderClaude/issues/1)
56. [Claude Response Error · Issue #788 · ChatGPTBox-dev/chatGPTBox](https://github.com/ChatGPTBox-dev/chatGPTBox/issues/788)
57. [Rohan Paul (@rohanpaul): "Claude’s API now supports CORS requests for their JSON APIs, enabling client-side applications. 🧠 📌 So it’s now possible to call the Claude LLMs directly from a user’s browser. ✨ Anthropic was wary of this feature due to a potential security risk: embedding API keys in clien…"](https://substack.com/@rohanpaul/note/c-66749298)
58. [Claude’s API Now Supports CORS Requests - CO/AI](https://getcoai.com/news/claudes-api-now-supports-cors-requests/)
59. [Chat React components - MUI X](https://mui.com/x/react-chat/)
60. [Chat - Core - MUI X](https://mui.com/x/react-chat/core/)
61. [Chat — Material UI examples - MUI X](https://mui.com/x/react-chat/material/examples/)
62. [Decent Espresso blog](https://decentespresso.com/blog/)
63. [fix(server): measure pressureDeviationBar only where the profile drives pressure · Issue #263 · ljcl/gaggiuino-mcp](https://github.com/ljcl/gaggiuino-mcp/issues/263)

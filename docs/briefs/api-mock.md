# Brief: api + mock

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/api/**` except `src/api/types.ts` (read-only contract), and
`mock/**` except `mock/anthropic/**` (the LLM agent owns that).

**Verified facts you must honor:** `docs/verified/02-api.md` (all of it),
`docs/verified/01-platform.md` sections 3, 4, 5, 8, 9, and the example
payloads in `docs/verified/examples/` (with provenance in `_README.md`).

**Crema to port** (`docs/CREMA_PORT_PLAN.md` section 10 "[2] api + mock"):
`gateway/client.ts`, `gateway/types.ts` (fold into our verified types),
`gateway/workflow.ts`, `gateway/devices.ts`, `live.ts`, the KV half of
`store.ts`, with their tests (`gateway.test.ts` split, the error-body tests in
`profile.test.ts`, `live-connections.test.ts`) and the fixtures the plan lists.

## Build (src/api)

1. `host.ts`
   - `resolveGatewayOrigin(location, override)` (port Crema). The override
     comes from `localStorage.reaHostname`: a bare host name (streamline/MSL
     convention) or a full origin (contains `://`). Default
     `http(s)://${location.hostname}:8080` (mirror the page scheme).
   - `toWebSocketOrigin(httpOrigin)`.
   - `detectHost(win: Window): HostEnvironment` (contract in types.ts):
     `insideDecaid = Boolean(win.__DECENT_HOST__)`; `hostVersion` from
     `__DECENT_HOST__.version`; `settingsUrl` =
     `http://<gateway host>:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI`
     (gateway host = the override host if set, else `location.hostname`);
     `exitToSkinSwitcher()` calls `win.decentApp.exitToDashboard()` when
     inside Decaid and the function exists (resolve at call time), else
     `win.location.assign(settingsUrl)`.
2. `time.ts`: `parseDecaidTimestamp(s): number` (epoch ms). Accepts 0-6
   fraction digits and an optional `Z` or `+hh:mm`; zone-less = local time.
   Tests with real values from the examples.
3. `client.ts`: `createDecaidClient({ origin, fetch?, timeoutMs? }): DecaidClient`.
   - Port Crema's deadlines (AbortController + setTimeout), error
     unwrapping, single-device connect logic if useful.
   - `GatewayError` (from types.ts) with a plain sentence: use `message`,
     `details`, `error` in that order; strip `...Exception:` prefixes; map
     `block_no_scale` -> "Connect a scale before pulling a shot (Decaid is set
     to require one).", `block_tare_during_shot` -> "The scale can't be tared
     during a shot.", not-connected -> "The machine is not connected. Wake
     the DE1 and check it is paired with Decaid." Codes: `block_no_scale`,
     `block_tare_during_shot`, `not_connected`, `timeout`, `network`, `http`.
   - Tolerate `null` and empty 200 bodies, and plain-text 404/500 bodies.
   - No custom headers; `Content-Type: application/json` only with a body.
     Percent-encode ids in paths.
   - Retry GETs once on 429/503 after `Retry-After` (default 1 s). Never
     retry state changes.
   - `createProfile`: keep Crema's wire-level fill of missing required fields
     (`version "2"`, `target_volume`, `target_volume_count_start`,
     `tank_temperature`) as a safety net, with a test.
   - `kv`: see 4.
4. `kv.ts`: `createKvClient(origin, fetch)` implementing `KvClient`: a
   missing key is 200 `null` (also tolerate 404); writes accept any 2xx;
   `getAll` sends `If-None-Match` and handles 304. Use `keepalive: true` only
   when the body is under 60 KiB (Chromium rejects larger keepalive bodies).
   Namespaces and keys are used raw (Decaid does not decode them).
5. `telemetry.ts`: `createTelemetryStore({ client, wsOrigin, WebSocketImpl?, now?, timers? }): TelemetryStore`.
   - One socket each: `machine/snapshot`, `scale/snapshot`, `devices`,
     `machine/shotState`, `machine/waterLevels`, `machine/shotSettings`.
   - Reconnect only on `close`/`error`, exponential backoff 1 s -> 30 s,
     reset on open; reconnect closed sockets at once on
     `visibilitychange` to visible. Never two sockets on one channel.
   - Link state ONLY from `devices` (`type === 'machine' && state ===
     'connected'`), plus a REST seed at `start()` (`GET /devices`, then
     `GET /machine/state` when connected). Scale frames: branch on `status`
     vs `weight`. `connectionError` = devices `connectionStatus.error`,
     de-duplicated by timestamp.
   - Silence is not death: a defensive watchdog may reopen the machine socket
     only if devices says the machine is connected and no frame arrived for
     20 s.
   - State is replaced immutably and listeners notified on each change.
   - Shot lifecycle (`onShot`): prefer `shotState` frames (`preheating` or
     `pouring` -> `started` once; `finished` -> `finished` once, with
     `shotId` and `stopReason` from the last `decision` of kind `stop`);
     fall back to machine state transitions into and out of `espresso`.
   - Live samples (`onSample`): every machine frame from the shot start to
     the finish, with `tS` from machine timestamps (`parseDecaidTimestamp`)
     and the latest scale frame.
   - Tolerant frame parsing: ignore malformed frames, never throw.
   - Tests with a deterministic fake WebSocket class and fake timers.
6. `heartbeat.ts`: `createHeartbeat(client, { minIntervalMs = 15000, now? }): Heartbeat`.
   Throttled `notify()`; errors swallowed; at most one request in flight.
7. `workflow.ts` (adapt Crema):
   - `activateProfile(client, profile, context, { shotRunning }): Promise<Workflow>`:
     refuse with a clear GatewayError (code `shot_running`) when a shot is
     running; one `PUT /workflow` with the complete profile and the context
     (`targetYield` must be a number, never null); then check the response
     profile matches what was sent (title and execution fields: steps,
     target_weight, target_volume, target_volume_count_start,
     tank_temperature, version, beverage_type); mismatch -> GatewayError
     code `activation_mismatch`.
   - `createProfileVersion(client, { profile, parentId?, metadata? }): Promise<{ record: ProfileRecord; deduped: boolean }>`:
     `deduped` when the returned title or parentId differs from what was sent
     (Decaid returned an existing record with the same content).
8. `devices.ts`: port Crema `gateway/devices.ts` as-is (plus tests).
9. `index.ts`: barrel exports.

## Build (mock/)

Stateful MSW mock of Decaid, used by Vitest (node), dev mock mode and
Playwright. Fixtures from `docs/verified/examples/` go in `mock/fixtures/`.

1. `mock/decaid/state.ts`: `createMockDecaid(options?)` holds machine state,
   devices (machine and scale connected by default; options to start
   disconnected), the workflow (seed: `examples/workflow-get.json`),
   profiles (seed: the three templates as bundled default records, read from
   `src/coach/templates/source/*.json` and normalized to numbers, with their
   real ids `profile:7438cb7266f60558b48f`, `profile:59036f8846b1ed3b4255`,
   `profile:729d284747718d27c93a`, plus `examples/profiles-list.json`),
   shots (seed: `examples/shot-record.json`), and a KV map. Profile ids for
   new content: any deterministic hash of the execution fields (exactness not
   required), so identical content returns the existing record with 201
   exactly like Decaid. `PUT /workflow` deep-merges like Decaid (objects
   merge, arrays replace) and enforces `targetYield` numeric/non-null.
2. `mock/decaid/shotPlayer.ts`: `PUT /machine/state/espresso` plays a
   deterministic, plausible shot following the ACTIVE workflow profile:
   `preparingForShot` (~2 s) -> `preinfusion` -> `pouring`, machine frames at
   5 Hz with local zone-less timestamps, pressure/flow shaped by the step
   targets (flow steps hold flow, pressure steps hold pressure), `profileFrame`
   advancing, scale weight 0 until pouring and then rising to
   `context.targetYield` (stop-at-weight; 45 s cap), `shotState` frames
   (`preheating` -> `pouring` -> `stopping` -> `finished` with the shotId and
   decision `{kind:"stop", reason:"targetWeight"}`). At the end persist a
   `ShotRecord` (measurements from the emitted frames, the workflow snapshot,
   `annotations.actualYield` = last weight + 0.4,
   `annotations.actualDoseWeight` = `context.targetDoseWeight ?? 18`,
   `stopReason: "targetWeight"`) so `/shots/latest` and `/shots/{id}` return
   it. `idle` during a shot stops it (`apiStop`). Speed: a `speed` option
   (also read from `?mockSpeed=N` in the browser) compresses wall-clock time
   while data timestamps stay realistic. Steam / flush / hot water run for a
   few seconds and return to idle; `sleeping` and `idle` toggle sleep; tare
   zeroes the scale.
3. `mock/decaid/handlers.ts`: MSW `http` handlers for every endpoint in
   `DecaidClient` plus heartbeat, settings, info, capabilities and devices,
   with Decaid's real status codes and bodies (200 `null` for state change
   and tare, 500 `{error:"DeviceNotConnectedException: machine not
   connected"}` when disconnected, 400 bodies with `message`, KV semantics:
   missing key 200 null, set/delete 200 `{}`). Match any host on port 8080
   (e.g. `*/api/v1/workflow` patterns that require `:8080`, so they never
   catch Anthropic or the app's own origin).
4. `mock/decaid/ws.ts`: MSW `ws.link()` handlers for the six channels, wired
   to the state's emitters, replaying the latest frame on connect (devices
   state, scale status, last snapshot, idle shotState).
5. `mock/browser.ts`: `startMockWorker({ extraHandlers = [], speed? })` ->
   `setupWorker(...decaid, ...extraHandlers).start({ serviceWorker: { url: './mockServiceWorker.js' }, onUnhandledRequest: 'bypass', quiet: true })`
   and returns the mock state handle (also exposed as
   `window.__CAFAI_MOCK__` for Playwright: `{ state, player, setSpeed }`).
6. `mock/node.ts`: `createMockServer(extraHandlers = [])` -> `setupServer`
   plus the state handle, for Vitest.

## Tests

Client against the MSW node server (every endpoint, error mapping, retries,
dedupe detection, activation mismatch); telemetry with a fake WebSocket; the
mock itself (shot player yields a valid record: monotonic timestamps,
substate order, stop at target yield, profileFrame advances; deep-merge
semantics; dedupe; KV semantics); host detection and exit behaviour; ported
Crema tests.

## Report extras

List the exact MSW URL patterns, and how Playwright can drive the mock
(`window.__CAFAI_MOCK__`).

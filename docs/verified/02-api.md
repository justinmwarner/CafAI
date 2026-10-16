# 02 — Decaid REST and WebSocket contracts for CafAI

**Verified on 2026-10-03.** Every claim cites the primary source as `file:line`. Where the spec, the docs and the Dart code disagree, the code wins. This document lists each disagreement.

## Source commits

| Repo | Commit |
|---|---|
| Decaid `.ref\decaid` | `a45961b323831d2170b3e7f3fef7c72fdd341642` (HEAD verified with `git rev-parse`) |
| streamline-js | `cb058cad8a08904889b817de944566dfe1dd8a9a` |
| MSL | `965af5cb3f42fcc29e6f4aeb74defc0dd07f099f` |
| decaid-zen | `ba6282fcc3fc3a160bbd1942b066f49b73afd380` |
| decaid-mcp | `aecef96b870e4f3567ed5f08c876f77adf25f5a7` |
| crema | `628cd714fa1a3a5194ea0e4c579d54ae1e38353c` |

The decaid-mcp fixtures in `test\fixtures\*.json` are real anonymised responses from Decaid **0.8.6+2801**, an older release than the commit above. They were used only to cross-check wire format.

### Citation legend

Paths without a prefix are relative to `.ref\decaid\`. `.ref\` and `crema\` are local reference clones at the repository's root, not committed.

| Prefix | Expands to |
|---|---|
| `rest:` | `assets/api/rest_v1.yml` |
| `ws:` | `assets/api/websocket_v1.yml` |
| `web/` | `lib/src/services/webserver/` |
| `data/` | `lib/src/models/data/` |
| `ctl/` | `lib/src/controllers/` |
| `dev/` | `lib/src/models/device/` |
| `mcp:` | `.ref\decaid-mcp\` |
| `zen:` | `.ref\decaid-zen\` |
| `sjs:` | `.ref\streamline-js\` |
| `msl:` | `.ref\MSL\` |
| `crema:` | `crema\web\src\` |

Example payloads are in `examples/`; see `examples/_README.md`.

---

## 1. Endpoint table (what CafAI needs)

Unless stated, every body is JSON and every route sits under `http://<host>:8080`.

| Method | Path | Request | Response (200 unless noted) | Notes | Citation |
|---|---|---|---|---|---|
| GET | `/api/v1/info` | – | `BuildInfo` | Works with no machine. `localIp` is absent on 0.8.6. | rest:5059-5100; web/info_handler.dart:14-28 |
| GET | `/api/v1/machine/info` | – | `MachineInfo` | 500 `{error}` when no DE1. | rest:368-378; web/de1handler.dart:21,807-811; dev/machine.dart:26-34 |
| GET | `/api/v1/machine/state` | – | `MachineSnapshot`, the latest cached frame | 500 when no DE1. | rest:380-391; web/de1handler.dart:22,813-818 |
| PUT | `/api/v1/machine/state/{newState}` | no body; `newState` is a `MachineState` name | 200, body is literally `null` | <ul><li>400 `{details,type:"block_no_scale"}`</li><li>An unknown name gives **500** `{error,st}`</li><li>No DE1 gives 500</li><li>503 when the write queue is full (non-idle requests only)</li></ul> | rest:392-413; web/de1handler.dart:820-857 |
| GET | `/api/v1/machine/capabilities` | – | `{capabilities: string[]}` | `[]` on a DE1. Bengle returns the full set. | rest:454-470, 6059-6093; web/de1handler.dart:38-54 |
| POST | `/api/v1/machine/heartbeat` | none | `{timeout: int}` | Seconds left before auto-sleep, or `-1`. | rest:4347-4372; web/presence_handler.dart:15,24-32 |
| GET | `/api/v1/presence/settings` | – | `{userPresenceEnabled, sleepTimeoutMinutes, keepAwakeUntil, schedules: WakeSchedule[]}`, in that order | Decaid's own settings: no machine needed. Defaults on, 30, `[]`. `keepAwakeUntil` is the end of the keep-awake window running now, a local time without a zone (`"2026-10-15T07:30:00.000"`), `null` without one or without a machine. See §3. | rest:4376-4412; web/presence_handler.dart:16,34-54; lib/src/settings/settings_controller.dart:64-66 (at aab5f93) |
| POST | `/api/v1/presence/settings` | partial `{userPresenceEnabled?, sleepTimeoutMinutes?}` | `{userPresenceEnabled, sleepTimeoutMinutes}` as saved, nothing more | <ul><li>Both are checked before either changes: 400 `{error}` for malformed JSON, a body that is not an object, a non-boolean or a non-integer.</li><li>The minutes are clamped into 0-240; 0 turns the idle sleep off.</li></ul> | rest:4413-4481; web/presence_handler.dart:17,56-110; lib/src/settings/sleep_timeout_preference.dart:1-7 (at aab5f93) |
| GET | `/api/v1/presence/schedules` | – | `WakeSchedule[]` | The list the settings carry; CafAI does not call it. | rest:4483-4502; web/presence_handler.dart:18,112-125 (at aab5f93) |
| POST | `/api/v1/presence/schedules` | `{time:"HH:MM", daysOfWeek?, enabled?, keepAwakeFor?}`, or `hour` and `minute`, which win over `time` | **201** `WakeSchedule`: `{id, time, daysOfWeek, enabled}`, plus `keepAwakeFor` only when there is one | <ul><li>`id` is a new UUID v4. `daysOfWeek` absent or `[]` means every day; it comes back sorted. `enabled` defaults to true. `keepAwakeFor` 0 or `null` is none.</li><li>400 `{error}` for a time, a weekday (1-7) or a `keepAwakeFor` (0-720) out of range; the spec has no 400.</li><li>A body that is not an object, or a field of the wrong type, is **500** `{error}`.</li></ul> | rest:4503-4573, 8090-8125; web/presence_handler.dart:19,127-189; lib/src/models/wake_schedule.dart:23-41,58-70 (at aab5f93) |
| PUT | `/api/v1/presence/schedules/{id}` | partial; `time`, then `hour` and `minute` over it; `keepAwakeFor: null` or 0 clears it | `WakeSchedule` | <ul><li>404 `{error:"Schedule not found", id}`, looked up before the body is read.</li><li>The same 400s and 500 as POST.</li><li>The id is used as the path carries it, never decoded.</li></ul> | rest:4575-4662; web/presence_handler.dart:20,191-274; lib/src/models/wake_schedule.dart:81-100 (at aab5f93) |
| DELETE | `/api/v1/presence/schedules/{id}` | – | `{deleted: id}` | 404 as PUT. | rest:4663-4701; web/presence_handler.dart:21,276-299 (at aab5f93) |
| POST | `/api/v1/machine/shotSettings` | `ShotSettings`, **all 8 fields** | 200 `null` | A partial body gives 500. There is **no GET**; read the WebSocket instead. Prefer the workflow. | rest:434-453; web/de1handler.dart:879-898; dev/de1_interface.dart:160-171 |
| GET / POST | `/api/v1/machine/settings` | POST: partial `De1SettingsRequest` | GET: `De1SettingsResponse`; POST: 202 | `usb` reads back as a bool, but POST takes `"enable"` / `"disable"`. | rest:764-795; web/de1handler.dart:377-450 |
| POST | `/api/v1/machine/waterLevels` | `{refillLevel}` (mm) | 202 | Only `refillLevel` is read. There is no GET route. | rest:961-980; web/de1handler.dart:348-375 |
| GET | `/api/v1/scale/info` | – | `{firmwareVersion?, batteryLevel?}` or `{}` | 503 `{error:"No scale connected"}`. | rest:1104-1117; web/scale_handler.dart:22-40 |
| PUT | `/api/v1/scale/tare` | none | 200 `null` | <ul><li>400 `{details,type:"block_tare_during_shot"}`</li><li>No scale gives **500** `{error}`; the spec and docs say 404</li></ul> | rest:1119-1161; web/scale_handler.dart:41-61,127-138 |
| PUT | `/api/v1/scales/{id}/tare` | none; `id` is percent-encoded once | 200 `null` | Primary **or auxiliary** (dosing) scale. 404 if not connected. | rest:1163-1204; web/scale_handler.dart:92,95-125 |
| GET | `/api/v1/devices` | – | `DeviceEntry[]` | Inventory, including remembered devices. | rest:40-59, 5912-5938 |
| GET | `/api/v1/devices/scan?connect=&quick=` | – | `DeviceEntry[]` | Slow by default. `quick=true` returns `[]` at once. | rest:95-142 |
| PUT | `/api/v1/devices/connect` | `{deviceId, connectionRole?:"primary"\|"auxiliary"}` | `DeviceConnectResult` | 400 / 404 / 409 / 503 / 504. | rest:144-220 |
| GET | `/api/v1/workflow` | – | `Workflow` | Works with no machine. | rest:1486-1501; web/workflow_handler.dart:45,49-52 |
| PUT | `/api/v1/workflow` | `WorkflowPatch` (partial, **deep-merged**) | `Workflow` after the merge | 400 / 408 / 409 / 413 / 429 / 500 / 503. See §6. | rest:1502-1677; web/workflow_handler.dart:54-221 |
| GET | `/api/v1/profiles?visibility=&includeHidden=&parentId=` | – | `ProfileRecord[]`, newest `updatedAt` first, with an ETag | `includeHidden=true` returns **everything, including deleted**. | rest:3549-3596; web/profile_handler.dart:34-73; ctl/profile_controller.dart:204-212 |
| GET | `/api/v1/profiles/{id}` | – | `ProfileRecord` | 404 `{error:"Profile not found", id}`. | rest:3634-3655; web/profile_handler.dart:85-99 |
| POST | `/api/v1/profiles` | `{profile, parentId?, metadata?}` | **201** `ProfileRecord`, new **or an existing one** (see §7) | 400 `{error:"Invalid request"\|"Missing required field", message}`. A missing step field gives **500**. | rest:3598-3631; web/profile_handler.dart:101-138; ctl/profile_controller.dart:218-249 |
| PUT | `/api/v1/profiles/{id}` | `{profile?, metadata?}` | `ProfileRecord`; the **id may change** | 400 for a default's content, an unknown id, a target id that already exists, or `profile:null`. | rest:3657-3698; web/profile_handler.dart:140-181; ctl/profile_controller.dart:251-285 |
| DELETE | `/api/v1/profiles/{id}` | – | `{success, message, id}` | Soft delete; a default is hidden. 404 `{error:"Not found"}`. | rest:3700-3728; ctl/profile_controller.dart:287-304 |
| PUT | `/api/v1/profiles/{id}/visibility` | `{visibility}` | `ProfileRecord` | 400 when deleting a default. | rest:3730-3767; web/profile_handler.dart:197-228 |
| GET | `/api/v1/profiles/{id}/lineage` | – | `ProfileRecord[]` | Order: root → … → self, then descendants depth-first. | rest:3769-3793; ctl/profile_controller.dart:339-367 |
| GET / POST | `/api/v1/profiles/defaults`, `/api/v1/profiles/restore/{filename}` | – | `DefaultProfileDescriptor[]` / `ProfileRecord` | Restoring a bundled profile. | rest:3903-3949; web/profile_handler.dart:75-83,298-312 |
| GET | `/api/v1/shots?limit=&offset=&…filters&order=` | – | `PaginatedShots`, with an ETag | `limit` is clamped to 1-100, but the **request value is echoed back**. | rest:1680-1803; web/shots_handler.dart:36-145 |
| GET | `/api/v1/shots/latest` | – | `ShotRecordSummary`, or `null` if there are no shots | | rest:1820-1833; web/shots_handler.dart:168-176 |
| GET | `/api/v1/shots/ids` | – | `string[]`, unordered | | rest:1804-1818; web/shots_handler.dart:158-166 |
| GET | `/api/v1/shots/{id}` | – | `ShotRecord` with `measurements` | 404 `{error:"Shot not found"}`. | rest:1835-1870; web/shots_handler.dart:178-190 |
| PUT | `/api/v1/shots/{id}` | partial record, normally `{annotations}` | `ShotRecord` | Deep merge. 400 for forbidden fields or for `enjoyment` outside 0-10. | rest:1872-1947; web/shots_handler.dart:192-266 |
| DELETE | `/api/v1/shots/{id}` | – | `{success, id}` | | rest:1949-1989; web/shots_handler.dart:268-280 |
| GET | `/api/v1/steams/ids` | – | `string[]`, unordered | Every steam record's id: what the care reminders count. See §8, Steam records. | rest:2011-2024; web/steams_handler.dart:19, 37-45 (at aab5f93) |
| GET | `/api/v1/steams/latest` | – | `SteamRecord` without `measurements`, or `null` if there are none | `{id, timestamp, workflow}`, `annotations` only when set. | rest:2025-2036; web/steams_handler.dart:20, 47-55; data/steam_record.dart:30-37 (at aab5f93) |
| GET | `/api/v1/store/{ns}` (`?full=1`) | – | `string[]` (or `{k: v}` with an ETag) | | rest:2935-2980; web/kv_store_handler.dart:7-16 |
| GET | `/api/v1/store/{ns}/{key}` | – | The stored JSON value. **A missing key gives 200 `null`.** | The spec says 404. | rest:2982-3005; web/kv_store_handler.dart:18-25 |
| POST | `/api/v1/store/{ns}/{key}` | any JSON, up to 1 MiB | 200 `{}` | The spec says 204. Invalid JSON gives a plain-text 500. | rest:3007-3029; web/kv_store_handler.dart:37-54 |
| DELETE | `/api/v1/store/{ns}/{key}` | – | 200 `{}` | The spec says `{deleted}` / 404. | rest:3031-3057; web/kv_store_handler.dart:27-35 |
| GET | `/api/v1/settings` | – | `ReaSettings` | Read `gatewayMode`, `blockOnNoScale`, `blockTareDuringShot`. | rest:1461-1483, 6905-7005 |
| GET / PUT / POST / DELETE | `/api/v1/display`, `/display/brightness`, `/display/wakelock` | PUT `{brightness: 0..100}` | `DisplayState` | 100 means the OS manages brightness. | rest:4705-4774; web/display_handler.dart:11-15 |
| GET / POST / PUT / DELETE | `/api/v1/beans`, `/beans/{id}`, `/beans/{beanId}/batches`, `/bean-batches[/{id}]`, `/grinders[/{id}]` | see §10 | | | rest:2104-2934 |

**WebSocket channels** (`ws://<host>:8080/ws/v1/...`): `machine/snapshot`, `machine/shotSettings`, `machine/waterLevels`, `machine/shotState`, `scale/snapshot`, `scales/{id}/snapshot`, `devices` and `display`. The full list is at web/de1handler.dart:190-206, web/scale_handler.dart:91-93, web/devices_handler.dart:289 and web/display_handler.dart:15.

**`/ws/v1/machine/state` does not exist.**

---

## 2. Transport and cross-cutting rules

**Host.** REST and WS share port 8080 (rest:33-38; ws:29-39). Every client derives the host the same way, `${location.protocol}//${location.hostname}:8080`, with an override (zen:src\lib\gateway.ts:3-17; sjs:src\modules\api.js:12-15; crema:gateway\client.ts:71-84).

**CORS.** CORS is open: `corsHeaders()` (web/../webserver_service.dart:506-527). `If-None-Match` is an allowed request header. `ETag`, `Location`, `Content-Disposition`, `Retry-After` and `X-Request-Id` are exposed (webserver_service.dart:134-140, 515-517). There is no authentication.

**Body limits.**
- Machine control and "small" routes: 64 KiB / 10 s.
- Profiles, shots, KV and workflow: 1 MiB / 30 s. Over the limit gives 413 `{error:"Request body is too large"}`; a timeout gives 408 `{error:"Request body timed out"}` (web/bounded_request_body.dart:9-26; rest:23-32).

**Admission control.**
- REST: 32 concurrent and 256/s per client; 128 concurrent and 1024/s globally. Rejection is 429 (per client) or 503 (global) with `Retry-After: 1` and body `{error:"client_admission_limit"|"global_admission_limit"}` (rest:7-22; web/admission_control.dart:218-224).
- WebSockets: 32 open sockets per client (ws:18-28).

**Conditional GET.** A strong ETag is sent on `GET /profiles`, `GET /shots`, `GET /beans`, `GET /bean-batches`, `GET /grinders` and `GET /store/{ns}?full=1`. A matching `If-None-Match` (or `*`) returns 304 (web/json_response.dart:10-21).

**Opaque ids in paths.**
- Profile and shot ids are `Uri.decodeComponent`'d once by the handler (web/profile_handler.dart:86; web/shots_handler.dart:179). `profile:abc…` works raw or encoded.
- Scale ids use `decodeOpaquePathComponent` (web/scale_handler.dart:96-100).
- **KV namespace and key are not decoded.** They are stored exactly as they appear in the path (web/kv_store_handler.dart:8-9,19-20,38-39). streamline-js observed percent-encoded keys coming back (sjs:src\modules\profile-overrides.js:72-73, per the cross-check report).

**There is no response envelope.** AI_API_NOTES.md:22 claims `{data, error, status}`, but every handler returns the bare object (web/json_response.dart:7-72). Error shapes are in §12.

---

## 3. Machine

```ts
// dev/machine.dart:11-35 ; values from dev/impl/de1/unified_de1/unified_de1.dart:307-316
interface MachineInfo {
  version: string;        // firmware BUILD number as a string, e.g. "1358" (MMR cpuFirmwareBuild) - not semver
  model: string;          // enum NAME: "DE1"|"DE1Plus"|"DE1Pro"|"DE1XL"|"DE1Cafe"|"DE1XXL"|"DE1XXXL"|"Bengle"|"Unknown"
                          //   (dev/impl/de1/de1.models.dart:388-397; "DE1+" is only a UI displayName)
  serialNumber: string;   // integer serial as a string
  GHC: boolean;           // group-head controller present
  extra: { refillKit: boolean; voltage: number; [k: string]: unknown }; // rest:6029-6057
}

// dev/machine.dart:139-161 (code). The REST spec omits schedIdle (rest:6327-6352). The WS spec lists a
// non-existent transportMode and omits busy|schedIdle|steamRinse|calibration|selfTest|airPurge|fwUpgrade (ws:759-777).
type MachineState =
  | 'booting' | 'busy' | 'idle' | 'schedIdle' | 'sleeping' | 'heating' | 'preheating'
  | 'espresso' | 'hotWater' | 'flush' | 'steam' | 'steamRinse' | 'skipStep' | 'cleaning'
  | 'descaling' | 'calibration' | 'selfTest' | 'airPurge' | 'needsWater' | 'error' | 'fwUpgrade';

// dev/machine.dart:163-198. Code spells 'cleaningGroup'; both specs and Skins.md:303 have the typo 'cleaingGroup'.
type MachineSubstate =
  | 'idle' | 'preparingForShot' | 'preinfusion' | 'pouring' | 'pouringDone'
  | 'cleaningStart' | 'cleaningGroup' | 'cleanSoaking' | 'cleaningSteam' | 'pausedSteam' | 'puffing'
  | 'errorNaN' | 'errorInf' | 'errorGeneric' | 'errorAcc' | 'errorTSensor' | 'errorPSensor' | 'errorWLevel'
  | 'errorDip' | 'errorAssertion' | 'errorUnsafe' | 'errorInvalidParam' | 'errorFlash' | 'errorOOM'
  | 'errorDeadline' | 'errorHiCurrent' | 'errorLoCurrent' | 'errorBootFill' | 'errorNoAC';

// dev/machine.dart:37-112 (toJson 97-112); scaling from unified_de1.parsing.dart:8-21
interface MachineSnapshot {
  timestamp: string;              // DateTime.now().toIso8601String(): LOCAL time, NO zone, microseconds
                                  //   e.g. "2026-09-29T12:53:54.216425" (real 0.8.6: mcp:test\fixtures\machine-state.json:2)
  state: { state: MachineState; substate: MachineSubstate };
  flow: number;                   // ml/s, measured group flow (n/4096)
  pressure: number;               // bar (n/4096)
  targetFlow: number;             // ml/s (n/16); 0 during pressure-pump frames
  targetPressure: number;         // bar (n/16); 0 during flow-pump frames (e.g. 8.6 bar -> 8.625)
  mixTemperature: number;         // °C (n/256); not the outlet temperature during hotWater (rest:6313-6314)
  groupTemperature: number;       // °C (n/65536)
  targetMixTemperature: number;   // °C; meaningless (~18 °C) during preparingForShot (real capture mcp:test\fixtures\shots\shot-01.json)
  targetGroupTemperature: number; // °C
  profileFrame: number;           // int, 0-based step index; STALE (previous shot's frame) until the first step starts
  steamTemperature: number;       // INT °C (spec says number; Skins.md shows 135.5 - code is int)
}
```

### How DE1 states map to `MachineState` and `MachineSubstate`

These mappings are in dev/impl/de1/de1.utils.dart:4-160.

| `MachineSubstate` | Raw DE1 substates |
|---|---|
| `preparingForShot` | heatWaterTank, heatWaterHeater, stabilizeMixTemp |
| `preinfusion` | preInfuse |
| `pouring` | pour, steaming (so steaming also reports `pouring`) |
| `pouringDone` | end |
| `idle` | noState, userNotPresent, refill |

- **`heating` and `preheating` are never produced by a DE1.**
- A DE1 state `unknown` maps to `error`.
- DE1 "goingToSleep" maps to `sleeping`.

### State change

Send `PUT /api/v1/machine/state/{newState}` with no body (web/de1handler.dart:23,820-857).

- **How the name is parsed.** It goes through `MachineState.values.byName`: names are case-sensitive, and an unknown name throws an ArgumentError, which surfaces as 500.
- **What it writes.** It writes `De1StateEnum.fromMachineState` (dev/impl/de1/de1.models.dart:82-126).

Use only these values:

| Intent | `newState` | Note |
|---|---|---|
| Start a shot | `espresso` | Blocked with 400 `block_no_scale` if `blockOnNoScale` is on, no scale is connected, and the profile is not `cleaning` (de1handler.dart:836-847). |
| Steam / hot water / flush | `steam` / `hotWater` / `flush` | `flush` is the DE1 `hotWaterRinse` (de1.models.dart:98-99). |
| **Stop** anything (shot, steam, water, flush) and **wake** | `idle` | `idle` bypasses the write queue (ctl/de1_controller.dart:708-713). Stopping an active shot records `stopReason: "apiStop"` (de1handler.dart:848-854). |
| Sleep | `sleeping` | Not `sleep`: Api.md:82 is wrong, and `sleep` gives 500. |
| Advance to the next step | `skipStep` | |
| Maintenance | `cleaning`, `descaling`, `airPurge`, `steamRinse` | Out of scope for CafAI. |

Skins.md:314 lists the valid user states as idle, sleeping, espresso, steam, hotWater and flush.

### Heartbeat

`POST /api/v1/machine/heartbeat` returns `{timeout}`.

- `timeout` is the seconds left before auto-sleep. It is `-1` when presence is disabled or no machine is connected.
- Decaid throttles the forward to the DE1 to once every 30 s.
- Call it on user interaction (Skins.md:1515-1533; rest:4347-4372).
- No reference skin actually calls it: it is wrapped but unused in streamline-js and MSL.

### Sleep and wake (presence)

Cited at aab5f93. `/api/v1/presence/*` (§1) holds Decaid's own settings, kept on the device it runs on.

- **Idle sleep.** With `userPresenceEnabled` on and `sleepTimeoutMinutes` above 0, Decaid puts an idle machine to sleep after that many minutes without use. A heartbeat or the machine's own activity restarts the timer, and the heartbeat then answers the minutes in seconds; otherwise it answers `-1` (ctl/presence_controller.dart:104-115, 177-208, 263-302, 462-469).
- **Wake schedules fire whatever `userPresenceEnabled` says.** Every 30 s, while a machine is connected and asleep, Decaid wakes it to `schedIdle` at an enabled schedule's minute on its days (ctl/presence_controller.dart:478-511). Decaid's own Sleep & Wake page hides the timeout and the schedules while its "Auto sleep & wake" switch is off (lib/src/settings/presence_settings_page.dart:126-129), so schedules set before the switch went off still wake the machine.
- **Keep-awake.** A schedule's `keepAwakeFor` holds off the idle sleep for that many minutes from its time. `keepAwakeUntil` is the end of the window running now, today's or one that began yesterday, while a machine is connected. A machine that goes to sleep during a window ends that window (ctl/presence_controller.dart:58-69, 167-175, 275-285; lib/src/models/keep_awake_occurrence.dart:24-93).

### Shot settings (steam, hot water, shot volume)

```ts
// dev/de1_interface.dart:126-171 ; ws:793-811 ; rest:6528-6554 (ints in REST spec, "number" in WS spec)
interface ShotSettings {
  steamSetting: number;          // int, raw DE1 steam flag bits
  targetSteamTemp: number;       // int °C
  targetSteamDuration: number;   // int s
  targetHotWaterTemp: number;    // int °C
  targetHotWaterVolume: number;  // int ml
  targetHotWaterDuration: number;// int s
  targetShotVolume: number;      // int ml
  groupTemp: number;             // double °C
}
```

- **Reading.** There is no REST GET. Read the frames from `ws/v1/machine/shotSettings`, which replays the current value on connect because it is backed by a BehaviorSubject (dev/impl/de1/unified_de1/unified_de1_transport.dart:53,63).
- **Writing directly.** `POST` requires every field, because `parseInt(null)` throws and the result is a 500. zen documents this at zen:src\lib\useShotSettings.ts:13-19.
- **Preferred route.** Change steam, hot water and flush through the **workflow** (`steamSettings`, `hotWaterData`, `rinseData`). Decaid writes those to the machine when they change (ctl/de1_controller.dart:561-596) and re-applies the workflow on every connect. A direct `shotSettings` POST is therefore temporary.

### Other machine endpoints (probably not needed)

- **Machine settings.** `GET/POST /api/v1/machine/settings` reads and writes `{usb, fan, flushTemp, flushFlow, flushTimeout, hotWaterFlow, steamFlow, tankTemp, steamPurgeMode}` (web/de1handler.dart:377-450).
- **Water levels.** `ws/v1/machine/waterLevels` sends `{currentLevel, refillLevel}` in mm (dev/de1_interface.dart:222-231; unified_de1.parsing.dart:75-89).
- **Refill kit.** `extra.refillKit` tells a plumbed machine apart (rest:6037-6051).

---

## 4. WebSockets

Every frame is a JSON text message. The server pushes; no subscription message is needed.

| Channel | Frames | On connect | When the device is absent | Citation |
|---|---|---|---|---|
| `ws/v1/machine/snapshot` | `MachineSnapshot` | Latest frame (`shareReplay(1)`) | Open and **silent**. **Re-binds** when the machine reconnects. No status frames. | ws:41-55; web/de1handler.dart:733-805,919-934; unified_de1.dart:94-118 |
| `ws/v1/machine/shotSettings` | `ShotSettings` | Current value | Same as snapshot | ws:56-63; web/de1handler.dart:936-951 |
| `ws/v1/machine/waterLevels` | `WaterLevels` | Current value | Same as snapshot | ws:64-71; web/de1handler.dart:953-968 |
| `ws/v1/machine/shotState` | `ShotStateEvent` | Latest frame replayed (an idle frame between shots) | Not gated on the machine | ws:136-151, 635-722; web/de1handler.dart:900-917; ctl/de1_controller.dart:60-63 |
| `ws/v1/scale/snapshot` (primary scale) | `{status:"connected"\|"disconnected"}` or `WeightSnapshot` | A status frame | Stays open. Weight frames only while connected. Any non-connected state sends `disconnected`. | ws:72-85, 562-614; web/scale_handler.dart:236-289 |
| `ws/v1/scales/{id}/snapshot` (primary or auxiliary) | status frames or `AddressedScaleSnapshot` | `{status:"connected"}`, or `{error:"Scale not found: …"}` and then close | Re-binds | ws:99-115, 586-604; web/scale_handler.dart:140-234 |
| `ws/v1/devices` | `DevicesState`; `DeviceConnectResult`; `{error}` | Current state, replayed (BehaviorSubject) | Authoritative link state. Accepts `{command:"scan"\|"connect"\|"disconnect", …}`. | ws:189-209, 882-1057; web/devices_handler.dart:16-21,136-185,468-505 |
| `ws/v1/display` | `DisplayState` | – | Accepts `setBrightness`, `requestWakeLock` and `releaseWakeLock`. The wake lock is released when the socket closes. | ws:210-223, 1059-1107 |

### Sample rate

The machine snapshot emits **one frame per DE1 ShotSample notification**: the shot sample is `withLatestFrom` the state characteristic (unified_de1.dart:94-118). The rate is not fixed by Decaid.

| Source | Rate |
|---|---|
| Docs (Skins.md:1693; Api.md:709) | "~10 Hz" |
| Real 0.8.6 shot on a DE1Pro (183 samples / 45.5 s) | Median spacing **0.268 s (≈3.7 Hz)**, min 0.125 s, max 0.36 s (mcp:test\fixtures\shots\shot-01.json) |
| Sleeping machine | About 2 Hz (mcp:docs\plugin-spike\REPORT.md:11) |

Always use the timestamps; never assume a rate.

### Weight and shot-state frames

```ts
// ctl/scale_controller.dart:298-337 (toJson 316-324). Used on ws/v1/scale/snapshot AND inside shot measurements.
interface WeightSnapshot {
  timestamp: string;          // local, no zone, µs
  weight: number;             // g
  weightFlow: number;         // g/s (device flow if provided, else Decaid estimator)
  battery: number | null;     // 0-100 - field is "battery" (Skins.md:1758-1765 wrongly shows "batteryLevel")
  timerValue: number | null;  // ms since the scale timer started (Decaid starts it at pour start); null if unsupported
}
type ScaleWsFrame = { status: 'connected' | 'disconnected' } | WeightSnapshot; // branch on 'status' in frame

// dev/scale.dart:54-61 ; ws:586-604 - only on ws/v1/scales/{id}/snapshot
interface AddressedScaleSnapshot { timestamp: string; weight: number; batteryLevel: number | null; timerValue: number | null; flow: number | null; }

// data/shot_state_event.dart:4-29, 89-101 ; ws:635-722
interface ShotStateEvent {
  event: 'state' | 'decision' | 'terminal';
  timestamp: string;               // the driving snapshot's timestamp (local, no zone)
  shotId: string | null;           // == persisted ShotRecord.id
  state: 'idle' | 'preheating' | 'pouring' | 'stopping' | 'finished';
  machineState: MachineState | null;
  machineSubstate: MachineSubstate | null;
  profileFrame: number | null;
  scaleConnected: boolean;
  scaleLost: boolean;              // sticky for the rest of the shot
  machineHasAutonomousSAW: boolean;// Bengle
  decision: null | {
    kind: 'advance' | 'stop' | 'abort' | 'terminal' | 'finalize';
    reason: string;                // OPEN SET: targetWeight, targetVolume, apiStop, appStop, machineEnded,
                                   //   profileAdvance, profileSkip, noScale, error, disconnected, stoppingBackstop
    details: string | null;
    data: Record<string, unknown> | null; // e.g. {targetYield, projectedWeight}
  };
}

// web/devices_handler.dart:136-185, 824-864 ; ws:882-1012 ; dev/device.dart:6,43-49 ; ctl/connection_manager.dart:44-52
interface DeviceEntry {
  name: string; id: string;                       // id = BLE MAC / UUID / serial path
  state: 'discovered' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  type: 'machine' | 'scale' | 'sensor' | 'grinder'; // WS spec omits 'grinder'
  available: boolean;                             // false = remembered but not present
  connectionRole?: 'primary' | 'auxiliary';       // connected scales only
}
interface DevicesState {
  timestamp: string;                              // UTC with 'Z'
  devices: DeviceEntry[];                         // preferred devices first, then by type, then by id (devices_handler.dart:885-898)
  scanning: boolean;
  charging?: { mode: string; nightModeEnabled: boolean; currentPhase: string; batteryPercent: number; usbChargerOn: boolean; isEmergency: boolean }; // not in WS spec
  connectionStatus: {
    phase: 'idle' | 'scanning' | 'connectingMachine' | 'connectingScale' | 'ready';
    foundMachines: Omit<DeviceEntry, 'available' | 'connectionRole'>[]; // state always 'discovered'
    foundScales: Omit<DeviceEntry, 'available' | 'connectionRole'>[];
    pendingAmbiguity: 'machinePicker' | 'scalePicker' | null;
    error: ConnectionError | null;                // kinds incl. profileUploadFailed (see §6)
  };
}
interface ConnectionError { kind: string; severity: 'warning' | 'error'; timestamp: string; deviceId: string | null;
  deviceName: string | null; message: string; suggestion: string | null; details: Record<string, unknown> | null; }
```

### How a skin learns that the machine is connected or disconnected

1. **Authoritative source: `ws/v1/devices`.** The machine is connected when `devices.some(d => d.type === 'machine' && d.state === 'connected')`. The current state is replayed on connect. `connectionStatus.error.kind` (for example `machineDisconnected`) explains failures (Skins.md:1969-2057; ws:189-209).
2. **REST bootstrap.** Call `GET /api/v1/devices`. Alternatively, `GET /api/v1/machine/state` returns 500 `{error:"DeviceNotConnectedException: machine not connected"}` (web/de1handler.dart:682-687,713-714; dev/../errors.dart:13-25).
3. **Machine sockets never send status frames.**
   - A gap in frames proves nothing (Skins.md:1770-1793; Api.md:724-751).
   - The server re-binds open sockets to the new machine object (web/de1handler.dart:756-772), so a reconnect is not required.
   - Keep ordinary reconnect logic for a real socket `close`, and use a liveness timeout only as a fallback.

---

## 5. Scale

| Topic | Contract |
|---|---|
| Tare the primary scale | `PUT /api/v1/scale/tare`, no body; 200 `null`. <ul><li>400 `{details:"Tare blocked: a shot is in progress", type:"block_tare_during_shot"}` when `blockTareDuringShot` is on and an app-tracked shot is brewing. Not in `full` gateway mode.</li><li>No scale connected gives **500** `{error:"DeviceNotConnectedException: scale not connected"}`. Skins.md:430 and rest:1154 say 404 — that is wrong.</li></ul> (web/scale_handler.dart:41-61,127-138) |
| Tare by id | `PUT /api/v1/scales/{id}/tare`, for the primary or an auxiliary scale. 404 `{error:"Scale not found: id"}` when it is not connected (web/scale_handler.dart:95-125). |
| Scale info | `GET /api/v1/scale/info` returns `{firmwareVersion?, batteryLevel?}`. Missing keys are omitted. A scale without device information returns `{}`; no scale returns 503 (web/scale_handler.dart:22-40). |
| Timer | `PUT /api/v1/scale/timer/{start\|stop\|reset}` (web/scale_handler.dart:64-89). |
| Brewing vs dosing scale | There is **no "dosing" route**. A second scale is connected with `PUT /api/v1/devices/connect {deviceId, connectionRole:"auxiliary"}` (rest:144-220). Address it with `PUT /api/v1/scales/{id}/tare` and `ws/v1/scales/{id}/snapshot`.<br>Auxiliary sessions are runtime-only. They never enter shot sequencing or stop-at-weight, and they are not persisted (Api.md:182-189; AI_API_NOTES.md:142-151).<br>The singular `/scale/*` and `ws/v1/scale/snapshot` routes are the **primary** (brewing) scale only. |
| Automatic tare | Unless `gatewayMode == "full"`, Decaid tares the primary scale and resets its timer at `espresso/preparingForShot`. It **tares again and starts the timer** at the first `preinfusion`/`pouring` sample (ctl/shot_sequencer.dart:382-391, 409-422). Until then, recorded shot weights are forced to 0 (shot_sequencer.dart:273-285). **CafAI must not tare for espresso.** |

---

## 6. Workflow

```ts
// data/workflow.dart:6-131 (toJson 93-105) ; data/workflow_context.dart:3-78 ; rest:7115-7297, 8154-8331
interface Workflow {
  id: string;                 // UUID of the WORKFLOW (kept across REST PUTs; not in the spec's WorkflowRequest)
  name: string;               // default "Workflow"
  description: string;        // default "Description" (ctl/workflow_controller.dart:10-19)
  profile: Profile;           // §7 - carries NO id
  context?: WorkflowContext;  // key omitted when null
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  machine?: WorkflowMachine;  // only present on shot records; "ignored on apply" (rest:7136-7140)
}
interface WorkflowContext {   // every key OMITTED when null (workflow_context.dart:62-78)
  targetDoseWeight?: number;  // g dry dose
  targetYield?: number;       // g beverage - THE stop-at-weight target (0/absent = off)
  targetWaterVolume?: number; // ml; overrides profile.target_volume for the volumetric fallback only
  grinderId?: string; grinderModel?: string;
  grinderSetting?: string;    // STRING on the wire (numbers are coerced to strings by parseOptionalString)
  beanBatchId?: string; coffeeName?: string; coffeeRoaster?: string;
  finalBeverageType?: string; baristaName?: string; drinkerName?: string;
  extras?: Record<string, unknown>;
}
interface SteamSettings { targetTemperature: number /*int °C; 0 = heater off; DE1 135-160, Bengle 135-165*/;
  duration: number /*int s*/; flow: number /*ml/s*/; stopAtTemperature: number /*°C, 0 = off; scaffolding only*/; }
interface HotWaterData { targetTemperature: number /*int °C*/; duration: number /*int s*/; volume: number /*int ml*/; flow: number /*ml/s*/; }
interface RinseData { targetTemperature: number /*int °C*/; duration: number /*int s*/; flow: number /*ml/s*/; } // used by `flush`
interface WorkflowMachine { provenanceStatus?: 'captured' | 'unavailable' | string; flowCalibration?: number;
  serialNumber?: string; model?: string; firmwareVersion?: string; }
```

**Defaults** (workflow.dart:261-268,335-342,391-393): steam 150 °C / 50 s / 0.8, hot water 75 °C / 30 s / 50 ml / 10.0, rinse 90 °C / 10 s / 6.0.

**Legacy fields.** The legacy fields `doseData`, `grinderData` and `coffeeData` are still **accepted** on input and folded into `context` (workflow.dart:42-68). They are **never emitted**.
- rest:1537-1539 says they are rejected, and Skins.md:500 says they are returned. Both statements are wrong.

### `PUT /api/v1/workflow`: exact pipeline

The handler is web/workflow_handler.dart:54-221.

1. **Admission.** At most 8 requests can be active or queued; the next gets 429. The body is read with a 1 MiB / 30 s limit, giving 413 or 408. A request waiting more than 30 s for its turn is skipped with 503 (`workflow_handler.dart:55-105`).
2. **Patch validation.** These get 400 `{error:"Invalid request", message}` (`workflow_handler.dart:160-176`; web/json_patch.dart:1-32):
   - `steamSettings` or `context` set explicitly to `null`, or set to a non-object.
   - Any `steamSettings.*` field set to `null`.
   - `context.targetYield` set to `null` or not a JSON **number**; the numeric string `"36"` is rejected.
3. **Merge.** `resultJson = deepMergeJson(currentWorkflow.toJson(), body)` (`workflow_handler.dart:179-182`).
4. **Parse.** `Workflow.fromJson(resultJson)` re-validates everything. This includes `Profile.fromJson`, and unknown keys are **dropped** (`workflow_handler.dart:183`).
5. **Settings write.** If rinse, steam or hot water changed, Decaid writes them to the DE1. The request waits for that write (ctl/de1_controller.dart:561-596).
6. **Commit.** The workflow is committed with a revision check, and the merge is retried on a race (`workflow_handler.dart:189-191`). The response is 200 with the full merged `Workflow`. **Read this response:** it is the truth.
7. **Profile upload.** This is **asynchronous, after the response.** `WorkflowDeviceSync` listens to the controller and pushes the profile when `profile != lastPushed`, compared with Equatable over all ten fields, title included (ctl/workflow_device_sync.dart:25-27,56-66,75-138).
   - No machine: the upload is skipped (`:97-99`) and done on the next connect (`:68-74`).
   - Failure: it retries at 3 s, 10 s and 30 s. A `ConnectionError{kind:"profileUploadFailed"}` appears on `ws/v1/devices` `connectionStatus.error`. It is retracted when a retry succeeds (`:100-127`; Skins.md:2014-2019).
   - **No positive "uploaded" signal exists.**

The workflow is persisted across restarts (lib/main.dart:400,456; ctl/persistence_controller.dart:95-99).

### Merge semantics

This is the whole algorithm, data/json_utils.dart:3-30:

```dart
if (!result.containsKey(key)) { result[key] = updateValue; continue; }
if (baseValue is Map<String, dynamic> && updateValue is Map<String, dynamic>) {
  result[key] = deepMergeJson(baseValue, updateValue);   // objects: recursive merge
} else {
  result[key] = updateValue;                              // lists, scalars, null: REPLACED wholesale
}
```

**Arrays (`profile.steps`) are replaced as a whole, never merged by index.**
- A PUT with a full `steps` array replaces the steps completely.
- Each step must be a complete object. Nothing inside a step survives from the old step: steps are list elements.

**The profile *object* is merged key by key.** Any top-level profile key you omit **keeps the previous profile's value**: `notes`, `author`, `target_weight`, `target_volume`, `version` and the rest.
- Example: the previous profile had `target_volume: 36.0` and you omit it. The new profile silently inherits 36.0, and that also changes its content-hash id.
- So when activating a profile, **send all ten profile keys**. Use `null` where a value should be absent (`target_weight`, `target_volume`), and use `""` for `notes`.

**`profile.id` is dropped.**
- `Profile.toJson` has no `id` (data/profile.dart:93-106). An `id` you send is ignored, and the next GET has none (also observed on 0.8.6: sjs:src\modules\dyeStrip.js:1083-1086).
- The workflow's own `id` is a workflow UUID, not a profile id.
- The profile's id can be **recomputed client-side** from the workflow profile; see §7.

**A partial profile patch can mislabel the machine.** For example, `{profile:{title:"X"}}` merges into the old steps: the machine keeps brewing the old steps under the new title (sjs:src\modules\dyeStrip.js:231-238). Always send the full profile.

**`context` merges per field.** An explicit `null` clears that field, except `targetYield` (`0` means off). There is **no whole-context clear** (rest:1508-1516, 8154-8163). `context.extras` is a map, so it is **deep-merged per key**; set `extras: null` to drop it entirely.

**Stop-at-weight uses `context.targetYield`, not `profile.target_weight`.**
- The shot sequencer is built with `targetYield: currentWorkflow.context?.targetYield ?? 0` (ctl/de1_state_manager.dart:815-822). The Bengle bridge reads the same field (ctl/bengle_saw_bridge.dart:40).
- `profile.target_weight` is stored and hashed but **never read at run time**. The only reader is the de1app importer.
- The volumetric fallback uses `context.targetWaterVolume ?? profile.target_volume` (ctl/shot_sequencer.dart:72).

**Shot records copy the workflow as it stands at the end of the shot**, not at its start (ctl/de1_state_manager.dart:911-944). Do not PUT the workflow while `shotState.state` is not idle.

### Status codes

| Code | Meaning | Citation |
|---|---|---|
| 200 | Committed | |
| 400 | Invalid JSON, a null/type violation, or an ArgumentError (for example a bad enum value, a missing title, empty steps, a missing `tank_temperature` / `target_volume_count_start`) | |
| 408 | Body read timed out | |
| 409 | A pending steam, hot-water or rinse write was superseded | |
| 413 | Body larger than 1 MiB | |
| 429 | Eight requests already active or queued | |
| **500** | A machine write failed, **or a TypeError while parsing**: a step missing `name`, `volume`, `seconds`, `temperature`, `sensor`, `transition` or its pump value, or a top-level `name: null` | workflow_handler.dart:217-219 |
| 503 | Queue wait over 30 s, the DE1 queue is full, or the machine is unavailable | |

Sources: workflow_handler.dart:193-220; AI_API_NOTES.md:465-476.

---

## 7. Profiles

```ts
// data/profile.dart:6-106, 144-182, 209-219, 265-280, 352-367, 400-425 ; rest:6389-6527
interface Profile {
  version: string | null;        // string ("2"); optional on write (coerced to string); null if absent
  title: string;                 // REQUIRED, non-empty
  notes: string;                 // default ""
  author: string;                // default ""
  beverage_type: 'espresso' | 'calibrate' | 'cleaning' | 'manual' | 'pourover'; // missing/unknown -> 'espresso' (silently)
  steps: ProfileStep[];          // REQUIRED, >= 1 (no maximum enforced anywhere in Decaid)
  target_volume: number | null;  // ml (volumetric fallback)
  target_weight: number | null;  // g (stored/hashed; NOT used for stop-at-weight - see §6)
  target_volume_count_start: number; // REQUIRED int: frame index from which volume is counted
  tank_temperature: number;      // REQUIRED °C (0 = off)
}
// Emitted key order: name, pump, transition, exit, volume, seconds, weight, temperature, sensor, flow|pressure, limiter
interface ProfileStepBase {
  name: string;                  // required (part of the content hash!)
  transition: 'fast' | 'smooth'; // required
  exit: StepExit | null;         // firmware exit; at most ONE per step
  volume: number;                // required, ml (0 = no volume limit)
  seconds: number;               // required, s (step max duration)
  weight: number | null;         // g; > 0 = APP-side weight exit (can coexist with `exit`) - doc/Profiles.md:17-31
  temperature: number;           // required, °C
  sensor: 'coffee' | 'water';    // required
  limiter: StepLimiter | null;   // caps the non-controlled variable
}
interface ProfileStepFlow extends ProfileStepBase { pump: 'flow'; flow: number /* ml/s */ }        // NO 'pressure' key emitted
interface ProfileStepPressure extends ProfileStepBase { pump: 'pressure'; pressure: number /* bar */ } // NO 'flow' key emitted
type ProfileStep = ProfileStepFlow | ProfileStepPressure;
interface StepExit { type: 'pressure' | 'flow'; condition: 'over' | 'under'; value: number }
interface StepLimiter { value: number; range: number }

// data/profile_record.dart:35-148 ; rest:7816-7871
interface ProfileRecord {
  id: string;                    // "profile:" + 20 lowercase hex chars (content hash)
  profile: Profile;
  metadataHash: string;          // 64 hex
  compoundHash: string;          // 64 hex
  parentId: string | null;
  visibility: 'visible' | 'hidden' | 'deleted';
  isDefault: boolean;            // bundled profile
  createdAt: string;             // LOCAL ISO, no zone, µs (e.g. "2026-01-12T12:54:26.018766")
  updatedAt: string;
  metadata: Record<string, unknown> | null; // defaults: {source:"bundled", filename}
}
```

### Id format and hashing

The code is data/profile_hash.dart:6-77. It was validated by replica: bundled `best_practice.json` (Adaptive v2) hashes to `profile:b73ce54592d667d00b31`. That equals the `parent_id` in assets/defaultProfiles/best_practice_v3.json:5, which test/profiles/default_profiles_migration_test.dart:200-216 asserts.

```ts
// 1. n = normalize(profile)  -- exactly Profile.fromJson -> toJson (strings parsed to numbers, only the
//    active pump axis kept, exit/limiter/weight null if absent, unknown keys dropped)
// 2. data = { version: n.version, beverage_type: n.beverage_type, steps: n.steps,
//             tank_temperature: n.tank_temperature, target_weight: n.target_weight,
//             target_volume: n.target_volume, target_volume_count_start: n.target_volume_count_start }
// 3. id = "profile:" + sha256hex(dartJsonEncode(sortKeysDeep(data))).slice(0, 20)
//    metadataHash = sha256hex(dartJsonEncode(sortKeysDeep({title, author, notes})))
//    compoundHash = sha256hex(`${id}:${metadataHash}`)
```

**JavaScript gotcha.** `dartJsonEncode` writes Dart `double`s with a trailing `.0` (`90.0`, `0.0`) and uses no whitespace. **Every** profile number is a double except `target_volume_count_start`, which is an int. `JSON.stringify` writes `90`, so a JS port must format doubles itself, for example with `Number.isInteger(x) ? x.toFixed(1) : String(x)`.

Test vectors:

| Profile | Id |
|---|---|
| Default1.json | `profile:a582ef47a76f99f56912` |
| Blooming_espresso.json | `profile:7438cb7266f60558b48f` |
| best_practice.json | `profile:b73ce54592d667d00b31` |
| `examples/profile-create-request.json` profile | `profile:fbff9b37ed390c6a8110` |

**Consequences of content hashing.**
- The title, author and notes are **not** in the id. Step **names**, `version` and `target_weight` **are**.
- Identical execution content means the same id on every device.

### Create

`POST /api/v1/profiles` takes `{ "profile": {...}, "parentId"?: "profile:…", "metadata"?: {...} }` (web/profile_handler.dart:101-138; Skins.md:1082-1106).

- **Bare profile.** A body without a `profile` key gets 400 `{error:"Missing required field", message:"Request must contain \"profile\" field"}`.
- **Required fields.** Only `title` (non-empty), `steps` (non-empty), `tank_temperature` and `target_volume_count_start` are required (data/profile.dart:59-72; rest:6391-6395; Profiles.md:112-126). `version` and `target_volume` are optional.
- **"Invalid request".** This comes from an `ArgumentError` or `FormatException`: a missing required field, an unknown enum value (`pump`, `transition`, `sensor`, `exit.type` or `exit.condition`), or an unknown `parentId`. The body is `{"error":"Invalid request","message":"Invalid argument(s): Profile must have \"tank_temperature\""}`. The message names one field per attempt; there is nothing "bare" about it.
- **TypeErrors give 500.** On create, a TypeError is **not** caught, so a step missing `name`, `volume`, `seconds`, `temperature` or `sensor`, or a null `transition`, gives **500 `{error:"Internal server error", message}`** (profile_handler.dart:134-137).
- **Dedupe.** If a record with the same content-hash id already exists, the server returns **that existing record unchanged with 201** (ctl/profile_controller.dart:236-242). It keeps its old title, metadata, parentId and visibility; even `hidden` or `deleted` is not restored. Detect this by comparing the returned `profile.title` and `parentId` with what you sent (sjs:src\modules\profile_editor.js:2940-2955).

### Update

`PUT /api/v1/profiles/{id}` takes `{profile?, metadata?}` (ctl/profile_controller.dart:251-285).

| Body | Result |
|---|---|
| `profile` with execution changes | The id **changes**. The old record is **deleted** and the new one inserted atomically (services/storage/drift_profile_storage.dart:41-56). `parentId` and `createdAt` are preserved; it does **not** become the old id. |
| `profile` that collides with an existing id | 400 `Profile already exists`. |
| Title, author or notes only | Same id; new `metadataHash` and `compoundHash`. |
| `metadata: null` | Clears the metadata. An object replaces it. |
| Omitted `metadata` | Keeps the metadata. |
| `profile` on a default profile | 400 "Cannot modify default profile content". |
| `profile: null` | 400. |

For versioning, POST with `parentId` instead of PUT.

### Delete, visibility, lineage, defaults

- **Delete.** A user profile is set to `deleted`; a default is set to `hidden`. `/purge` deletes permanently, but not defaults.
- **Visibility.** Setting a default to `deleted` gives 400.
- **Lineage.** Returns the ancestors, then self, then descendants (ctl/profile_controller.dart:287-367).
- **Defaults.** Bundled defaults are seeded with `metadata {source:"bundled", filename}` and re-seeded on update (profile_controller.dart:60-69). `GET /profiles/defaults` returns `[{filename,title,author,notes,beverageType}]`, and `POST /profiles/restore/{filename}` re-adds one (rest:3903-3949).

### Number vs string verdict

| Direction | Behaviour | Citation |
|---|---|---|
| **Output** | <ul><li>All numeric profile fields are **JSON numbers**: Dart doubles, written `90.0`.</li><li>`target_volume_count_start` is an integer.</li><li>`version` is a **string** (`"2"`) or `null`.</li><li>This holds for `GET /api/v1/workflow`, `GET /api/v1/profiles[/{id}]` and `shot.workflow.profile`. Stored profiles are re-serialized through `toJson`, so even the bundled de1app-style assets that use strings (`"temperature": "90.0"` in assets/defaultProfiles/Default1.json) come back as numbers.</li></ul> | lib/src/services/database/mappers/profile_mapper.dart:10,35; real 0.8.6 capture mcp:test\fixtures\workflow.json; spec rest:6389-6527 |
| **Input** | <ul><li>Numbers **or** numeric strings are accepted (`parseDouble` / `parseOptionalDouble`).</li><li>`target_volume_count_start` accepts an int, a double (truncated) or an integer string; `"2.0"` fails.</li><li>Unknown keys (`type`, `hidden`, `lang`, …) are ignored and dropped.</li><li>A step carrying both `flow` and `pressure` is accepted; the inactive one is dropped.</li></ul> | data/utils.dart:1-25; data/profile.dart:209-219 |
| **Rule for CafAI** | Mirror GET: send JSON numbers, `version` as `"2"`, `target_volume_count_start` as an int, and `context.grinderSetting` as a string. Do not send numeric strings: `context.targetYield` rejects them with 400. | |

---

## 8. Shots

```ts
// web/shots_handler.dart:133-140 ; rest:8631-8655
interface PaginatedShots { items: ShotRecordSummary[]; total: number; limit: number /* echoes the REQUEST, not the clamp */; offset: number; }

// data/shot_record.dart:50-76 ; rest:7339-7470. Keys annotations/stopReason/shotNotes/metadata are OMITTED when null.
interface ShotRecordSummary {
  id: string;                 // UUID v4 for native shots (== shotState.shotId); imported shots may differ (e.g. "de1app-...")
  timestamp: string;          // shot start, LOCAL, no zone, µs (e.g. "2026-09-29T12:47:13.372646")
  createdAt: string;          // UTC with 'Z' (shot_record.dart:53-54)
  updatedAt: string;          // UTC with 'Z'; advances only on content change
  workflow: Workflow;         // FULL workflow incl. profile.steps and `machine` provenance block
  annotations?: ShotAnnotations;
  stopReason?: string;        // OPEN SET: targetWeight | targetVolume | apiStop | appStop | machineEnded | error
  shotNotes?: string;         // deprecated mirror of annotations.espressoNotes
  metadata?: Record<string, unknown>; // deprecated mirror of annotations.extras
}
interface ShotRecord extends ShotRecordSummary { measurements: ShotSnapshot[] }

// data/shot_snapshot.dart:23-29
interface ShotSnapshot {
  machine: MachineSnapshot;        // §3
  scale: WeightSnapshot | null;    // §4; null when no scale
  volume: number | null;           // ml pumped since frame >= target_volume_count_start (0.0 before); null on legacy/imports
}

// data/shot_annotations.dart:4-57 ; rest:7299-7337
interface ShotAnnotations {
  actualDoseWeight?: number;  // g - at shot end this is just workflow.context.targetDoseWeight (not measured)
  actualYield?: number;       // g - settled post-shot weight, 0.1 g resolution (shot_annotations.dart:84-108)
  drinkTds?: number; drinkEy?: number;
  enjoyment?: number;         // 0-10 (Decaid scale; de1app/Visualizer use 0-100)
  espressoNotes?: string;
  extras?: Record<string, unknown>; // reserved bookkeeping keys: uploaded_to_decent, decent_upload_rejected, visualizerId
}
```

### List

`GET /api/v1/shots` takes these parameters (rest:1690-1785; shots_handler.dart:41-66):

| Parameter | Behaviour |
|---|---|
| `limit` | Default 20, clamped to 1-100. |
| `offset` | Default 0. |
| `order` | `asc` or `desc`; default `desc`. |
| Filters | `grinderId`, `grinderModel`, `beanBatchId`, `beanId` (all of the bean's batches), `coffeeName`, `coffeeRoaster`, `profileTitle`, `search` (case-insensitive substring). |
| `orderBy` | **Ignored.** |

- **Legacy `ids=a,b`.** It is honoured only when no filter is present, and then returns a **bare array of full records with measurements** (shots_handler.dart:68-88).
- **Items.** The items are `toJsonWithoutMeasurements` (`:133`). There is no duration field.

### Latest, ids, by id

- `/latest` returns the summary, or `null`. It reads one row without its
  measurements (`getLatestShotMeta` selects `'[]' AS measurements_json`:
  lib/src/services/database/daos/shot_dao.dart:192-204 at af4e995, Decaid's
  `main` read on 2026-10-15; the pin's spec says the same, rest:1820-1833),
  so it is the cheap way to the newest shot: the care counts ask it first
  and read the total only when the newest changed (D185).
- `/ids` returns an unordered `string[]`.
- `/{id}` returns the full record.

### What a measurement series contains

These rules come from ctl/shot_sequencer.dart:270-293, 354-396, 648-655 and ctl/de1_state_manager.dart:831-841, and were confirmed by the real capture.

- **Start.** The first sample is the first `espresso`/`preparingForShot` frame (preheat).
  - Its `profileFrame` is stale.
  - `timestamp` (shot start) is about 6 ms after the first machine timestamp.
- **Middle.** Then `preinfusion` and `pouring` samples follow.
- **End.** Collection stops at the stop decision (`_enterStopping` sets `dataCollectionEnabled = false`). The sample that triggers the stop, and any `pouringDone`/`idle` tail, are **not recorded**. The real capture has only `preparingForShot` (26), `preinfusion` (14) and `pouring` (143) samples.
- **Final yield.** The last recorded weight is lower than `annotations.actualYield`, which is refined during the post-stop settling window (data/shot_annotations.dart:84-108).
- **Not persisted.** Shots that are aborted before the pour, and cleaning or calibrate profiles, are not persisted (de1_state_manager.dart:912-918; rest:7376-7384).

**Time base.**

```ts
elapsed = Date.parse(m.machine.timestamp) - Date.parse(measurements[0].machine.timestamp)
```

- Both values are local and zone-less with microseconds, so parse them with a tolerant ISO parser.
- Scale timestamps are separate, typically 0-150 ms before the machine timestamp. Use the machine timestamp as the time base.
- Pour start is the first sample whose substate is `preinfusion` or `pouring`.

### What a list costs Decaid

Cited at aab5f93. Every page of `GET /api/v1/shots` reads each shot's row whole and parses its measurements before dropping them (`ShotMapper.fromRows`, `fromRow`: lib/src/services/database/mappers/shot_mapper.dart:14-49), so a page of 100 parses 100 measurement series; `total` is a separate `COUNT` (lib/src/services/database/daos/shot_dao.dart:111-159). `limit=1` is the cheap way to the total, and it parses the newest shot's series; `/latest` parses none (above). The care counts read a page of more only when the total jumps by more than one shot a minute could have, 20 at most (D185).

### Steam records

Cited at aab5f93 (web/steams_handler.dart; ctl/steam_sequencer.dart; data/steam_record.dart).

- **One per steaming.** A record opens on the first frame in `steam` (the heater's warm-up included) with a UUID v4, the time then and the workflow as it stands, collects a `SteamSnapshot` `{machine, milkTemperature}` per frame, and is saved on the first frame in neither `steam` nor the `pouring` substate. A machine that changes mid-steam discards it (ctl/steam_sequencer.dart:72-122, 178-198).
- **The routes.** `GET /api/v1/steams` lists every record, newest first, without measurements; `/ids` and `/latest` as in §1; `/{id}` the whole record, 404 `{error:"Steam record not found"}`; `PUT /{id}` changes its annotations only; `DELETE /{id}` answers `{success, id}` (web/steams_handler.dart:17-120).
- **What a list costs.** `GET /api/v1/steams` reads and parses every record's measurements before dropping them (`getAllSteams`, `SteamMapper.fromRow`: lib/src/services/database/daos/steam_dao.dart:23-27, lib/src/services/database/mappers/steam_mapper.dart:11-30) and sends each record's workflow; `/ids` reads only the ids (steam_dao.dart:11-15), but sends every one (a busy café's year of steams is over a megabyte); `/latest` reads one row without its measurements (`getLatestSteamMeta`, steam_dao.dart:58-70 at af4e995). The care counts ask `/latest` first and `/ids` only when the newest changed (D185).

### Update

`PUT /api/v1/shots/{id}` is not PATCH; there is no PATCH route anywhere (web/shots_handler.dart:192-266).

| Body content | Result |
|---|---|
| `id` that differs from the path | 400 |
| `measurements` | 400 |
| `createdAt` or `updatedAt` | 400 |
| `annotations.enjoyment` that is not a number in 0-10 | 400 |
| Anything else | `_deepMerge(existing.toJson(), patch)`: maps merge recursively, so **`annotations.extras` merges per key**; lists and scalars replace. |

- **Clearing.** `null` on a canonical field clears it. `annotations: null` clears all annotations. Legacy `shotNotes`/`metadata` map onto `espressoNotes`/`extras`; canonical fields win (`:298-351`; Skins.md:793-795).
- **TDS and EY.** `annotations.drinkTds` and `drinkEy` are percentages, `double?` (data/shot_annotations.dart:8-9), read with `parseOptionalDouble` (`:30-31`; it takes a numeric string too, data/utils.dart:7-12) and left out of `toJson` when null (`:49-50`), so `null` in a PUT clears each. Decaid never fills them itself; Visualizer's plugin uploads them as `drink_tds` and `drink_ey`. CafAI writes numbers, the TDS to 0.01 and the EY to 0.1, and clears both with `null` (D165). Read at af4e995 (2026-10-15); the pinned spec (aab5f93) has both as nullable numbers.
- **Not validated.** Top-level `timestamp`, `workflow` and `stopReason` are mutable; this is issue #913, and the spec's `ShotUpdateRequest` lists only annotations, stopReason, shotNotes and metadata.
- **`updatedAt`.** It changes only when the content changes, ignoring the bookkeeping extras keys (`:239-248`).
- **Response.** The full updated `ShotRecord`.

---

## 9. Value conventions summary

| Topic | Rule |
|---|---|
| Timestamps | <ul><li>**Local, no zone:** machine, scale and shotState timestamps, `ShotRecord.timestamp`, and profile `createdAt`/`updatedAt`.</li><li>**UTC `Z`:** shot `createdAt`/`updatedAt` and `devices.timestamp`.</li><li>The real 0.8.6 capture shows `timestamp "2026-09-29T12:47:13.372646"` next to `createdAt "2026-09-29T10:48:02.048495Z"`, a +2 h zone (mcp:plugin.js:73-75).</li></ul> |
| Units | Pressure in bar, flow in ml/s, weight in g, weight flow in g/s, temperature in °C, volume in ml, duration in s, `timerValue` in ms, water level in mm. |
| Enjoyment | 0-10 (lib/src/import/parsers/enjoyment_scale.dart:1-2). |

---

## 10. Beans, batches and grinders (CafAI reads and links them)

| Entity | Contract | Citation |
|---|---|---|
| Beans | <ul><li>`GET /api/v1/beans?includeArchived=` returns `Bean[]`.</li><li>`POST` requires `roaster` and `name`, both strings. A missing one is a type-cast error, returned as 400 `{error}`; empty strings are accepted (issue #912).</li><li>`GET/PUT/DELETE /beans/{id}`. PUT is a **shallow merge** (`{...existing, ...body}`), so `extras` is **replaced wholesale**. An explicit `null` on `roaster`, `name`, `decaf` or `archived` gives 400.</li></ul> | web/beans_handler.dart:17-28,60-130; rest:2104-2350, 8332-8421 |
| Batches | <ul><li>`GET/POST /api/v1/beans/{beanId}/batches`. Every field is optional; `weightRemaining` starts at `weight`.</li><li>`GET /api/v1/bean-batches?includeArchived=` lists batches across all beans.</li><li>`GET/PUT/DELETE /bean-batches/{id}`. `extras` is replaced on PUT (mcp:docs\plugin\ARCHITECTURE.md:646).</li></ul> | rest:2351-2677, 8423-8536 |
| Grinders | <ul><li>`GET/POST /api/v1/grinders`; `model` is required.</li><li>`settingType` is `numeric` or `preset`, plus `settingValues`, `settingSmallStep` and `settingBigStep`.</li><li>`GET/PUT/DELETE /grinders/{id}`.</li></ul> | web/grinders_handler.dart:18-22; rest:2678-2934, 8538-8629 |
| Linking | Set `context.beanBatchId` / `grinderId` (plus the display strings `coffeeName`, `coffeeRoaster`, `grinderModel`) through `PUT /workflow`. Decaid does not check that the ids exist (mcp:plugin.js:2137) and does not auto-fill the display strings. | |

---

## 11. Key-value store

The handler is web/kv_store_handler.dart:6-56, backed by Hive in lib/src/services/storage/hive_store_service.dart. Docs: Skins.md:1329-1373 and Api.md:525-534.

| Operation | Contract |
|---|---|
| List keys | `GET /api/v1/store/{namespace}` returns `string[]`. |
| Whole namespace | `GET /api/v1/store/{namespace}?full=1` returns `{key: value}`, without null values (hive_store_service.dart:63-72), and sends an ETag; `If-None-Match` gives 304. |
| Get | `GET /api/v1/store/{namespace}/{key}` returns the stored JSON value verbatim. **A missing key gives 200 with body `null`**; rest:3004-3005, Skins.md:1348 and Crema all assume 404. |
| Set | `POST /api/v1/store/{namespace}/{key}` with any JSON value as the body, up to 1 MiB and read within 30 s. The response is **200 `{}`**; the spec says 204. Content-Type is not checked. A non-JSON body is an uncaught `jsonDecode` failure: a plain-text 500. A literal `null` body stores the string `"null"`. |
| Delete | `DELETE /api/v1/store/{namespace}/{key}` returns **200 `{}`**, whether or not the key existed. The spec says `{deleted:true}` / 404. |

**Namespaces and keys.**
- Namespaces are Hive boxes, created on first use. The name `default` maps to the box `kvStore` (hive_store_service.dart:32,75-81).
- Neither namespace nor key is URL-decoded, so use only `[a-z0-9._-]`. Prior art uses `crema/<key>` (crema:store.ts:19-21,94-121), `decaid-zen/<key>` and `streamline-app/<key>`.
- The KV store is included in Decaid data export and backup (web/data_export/kv_store_export_section.dart).
- Do not write keys you do not own. DYE2 owns `dye2.reaplugin`.

---

## 12. Errors and build info

### Error bodies

| Shape | Where | Citation |
|---|---|---|
| `{error: string, message?: string}` | Most handlers: profiles, workflow, shots (`{error}` only), beans | web/profile_handler.dart; web/workflow_handler.dart |
| `{error: string, st: string}` | Unexpected exceptions on `/machine/*`, for example an unknown state name | web/de1handler.dart:715-716 |
| `{error: "DeviceNotConnectedException: machine not connected"}` (500) | Any `/machine/*` call with no DE1 | de1handler.dart:713-714 |
| `{details: string, type: "block_no_scale"\|"block_tare_during_shot"}` (400) | Policy blocks | de1handler.dart:843-846; scale_handler.dart:46-51 |
| `{error: string, code?: "unsupported_operation"}` | Scale command failures | rest:5725-5733; scale_handler.dart:52-58,84-89,122-127 |
| `{error: "client_admission_limit"\|"global_admission_limit"}` + `Retry-After: 1` | 429 / 503 | admission_control.dart:218-224 |
| **Plain text** "Route not found" (404) or "Internal Server Error" (500) | Unmatched routes, uncaught exceptions | shelf defaults |

The spec's `Error {e, st}` schema (rest:5867-5873) is **not** what any handler sends.

### Build info

`GET /api/v1/info` returns:

```ts
{ commit: string; commitShort: string; branch: string; buildTime: string; version: string; buildNumber: string; appStore: boolean; fullVersion: string; localIp: string }
```

- Values are compile-time `--dart-define`s (lib/build_info.dart:2-29). The repo's pubspec placeholder is `1.0.0+1`.
- Field builds report, for example, `"version":"0.8.6","fullVersion":"0.8.6+2801"` (mcp:test\fixtures\info.json).
- Debug builds report `"unknown"` for the git fields (Skins.md:1681).

---

## 13. Disagreements with RESEARCH.md (the repo wins)

| # | RESEARCH.md claim | Verified fact (citation) |
|---|---|---|
| 1 | "A new profile must include `tank_temperature`, `target_volume`, `target_volume_count_start` and `version`, or the request fails with a bare 'Invalid request'" (lines 9, 313) | <ul><li>Required are `title` (non-empty), `steps` (non-empty), `tank_temperature` and `target_volume_count_start`. `version` and `target_volume` are optional (data/profile.dart:59-72; rest:6391-6395).</li><li>The error is not bare: `{"error":"Invalid request","message":"Invalid argument(s): Profile must have \"…\""}` (web/profile_handler.dart:130-133).</li><li>Missing *step* fields give **500**, not 400.</li></ul> |
| 2 | "A step supports only one exit condition" (line 10, §3) | Only one *firmware* `exit` (pressure or flow). A step can also carry `weight` > 0, an app-side weight exit that coexists with `exit` (doc/Profiles.md:17-31; ctl/shot_sequencer.dart:443). |
| 3 | "A weight-based stop is the profile-level `target_weight`" (§3 line 182) | Decaid stops on **`workflow.context.targetYield`**. `profile.target_weight` is never read at run time (ctl/de1_state_manager.dart:820-821; ctl/bengle_saw_bridge.dart:40). streamline-js's comment "Non-autonomous machines stop on profile.target_weight" (sjs:src\modules\ui.js:205-206) is also contradicted. |
| 4 | "Whether Decaid accepts numbers is unverified" (line 183); the example profile is all strings (lines 158-172) | Decaid accepts numbers or numeric strings and **always returns numbers**. `version` is a string. A pressure step has no `flow` key, a flow step has no `pressure` key, and `exit`/`limiter`/`weight` are explicit `null` (data/profile.dart:93-106,265-280,352-367; data/utils.dart:1-25). |
| 5 | "Treat Decaid's id as an opaque pointer" (line 190); the workflow profile has no id (lines 8, 144) | The workflow profile has no id; confirmed (data/profile.dart:93-106). But the id is a **deterministic** hash that CafAI can compute (data/profile_hash.dart:6-23), so the active profile's id *is* recoverable from `GET /workflow`. |
| 6 | "Edits change the id … duplicate titles allowed" (lines 188-189) | Both are true, with two important additions: <ul><li>`POST` with content identical to an existing record returns **the existing record with 201**. The new title is not applied, and it may even be hidden or deleted (ctl/profile_controller.dart:236-242).</li><li>A content-changing `PUT` **deletes the old id**; it does not create a child (drift_profile_storage.dart:41-56).</li></ul> |
| 7 | "There is no capability endpoint" (line 107) | `GET /api/v1/machine/capabilities` exists (web/de1handler.dart:38-54; rest:454-470). |
| 8 | Telemetry channel `ws/v1/machine/state` (line 111) | No such route. The channels are `snapshot`, `shotSettings`, `waterLevels`, `raw` and `shotState` (web/de1handler.dart:190-206). The idea comes from stale prose in AI_API_NOTES.md:140. |
| 9 | "After a power cycle the snapshot socket goes 'open-but-silent'. Close and re-open sockets" (line 115) | The repo **re-binds** open machine sockets to the new machine (web/de1handler.dart:733-805; ws:44-52; Api.md:724-751). Reconnect only on a real socket close; a liveness timeout is a defensive fallback only (Skins.md:1790-1793). The MSL/streamline workaround predates or ignores this. |
| 10 | "Dosing scale: `ws/v1/scale/dosing/snapshot` and `PUT /api/v1/scale/dosing/tare` (#834)" (line 121) | Neither exists. The second scale is `connectionRole:"auxiliary"` through `PUT /api/v1/devices/connect`, addressed by `PUT /api/v1/scales/{id}/tare` and `ws/v1/scales/{id}/snapshot` (web/scale_handler.dart:92-93; rest:144-220,1163-1204). |
| 11 | "The brewing-scale tare and snapshot paths were not verified" (line 122) | `PUT /api/v1/scale/tare` and `ws/v1/scale/snapshot` (web/scale_handler.dart:41-61,91). With no scale, tare returns **500**, not 404. |
| 12 | "`ShotAnnotations.toJson()` omits nulls, so clear a field with `''` rather than `null`" (line 133) | In the repo, `PUT {annotations:{espressoNotes:null}}` **clears** the field: the deep merge writes null, and `toJson` then omits it (web/shots_handler.dart:232-250; Skins.md:793; also observed live, mcp:docs\plugin\TASK3-REPORT.md:100). `''` would store an empty string. |
| 13 | "Measurements stop when the shot stops" (line 128) | Correct (ctl/shot_sequencer.dart:648-655). Add that they **start at preheat** (`preparingForShot`, with a stale `profileFrame`) and that the stop-triggering sample is not recorded. |
| 14 | "`extras` is replaced as a whole, so read-merge-write" (line 139) | True for **beans and batches** (web/beans_handler.dart:111-117). For **shots and workflow context**, `extras` is deep-merged per key (web/shots_handler.dart:353-369; data/json_utils.dart:3-30). |
| 15 | KV store "exact path is unverified" (lines 12, 148, 327) | `/api/v1/store/{namespace}[/{key}]`. A missing key is 200 `null`, not 404 (§11). |
| 16 | Display brightness and wake-lock "paths not verified" (line 147) | `GET /api/v1/display`, `PUT /api/v1/display/brightness`, `POST`/`DELETE /api/v1/display/wakelock`, and `ws/v1/display` (web/display_handler.dart:11-15). |
| 17 | "`GET /api/v1/machine/info` returns the model string" (line 107) | It returns `{version (firmware build), model (an enum name such as "DE1Pro"), serialNumber, GHC, extra{refillKit, voltage}}` (dev/machine.dart:26-34; unified_de1.dart:307-316). |
| 18 | Profile update flow (Recommendation 4, lines 310-316): include "all four required fields", then POST, then `PUT /workflow` with the full profile | Changes needed: <ul><li>The required set is different (row 1).</li><li>The POST can dedupe to an existing record.</li><li>Send **all ten** profile keys on `PUT /workflow`, because omitted keys are inherited from the old profile.</li><li>Set **`context.targetYield`**.</li><li>The machine upload is asynchronous: watch for `profileUploadFailed`.</li></ul> |
| 19 | "profile maker has a hard maximum of 20 steps" (line 184) | Decaid enforces no maximum (no check in data/profile.dart; rest:6413-6418 has only `minItems: 1`). The bundled adaptive_espresso.json has exactly 20 steps. The firmware frame limit is unverified (see §15). |
| 20 | Sampling "about four times a second" (line 127) | Matches the real 0.8.6 capture (≈3.7 Hz median). Decaid's **own docs** say ~10 Hz (Skins.md:1693; Api.md:709). The code emits one frame per DE1 shot sample (unified_de1.dart:94-118). Not a RESEARCH error, but the docs disagree. |

---

## 14. Implications for CafAI (client rules)

### Connection and transport

1. **Base URLs.** Use `http://${location.hostname}:8080/api/v1` and `ws://${location.hostname}:8080/ws/v1`, with an override for development. Parse every response with a tolerant parser:
   - A `null` body is valid for 200 responses (state change, tare, KV miss).
   - Accept a plain-text 404 or 500.
2. **Link state comes only from `ws/v1/devices`.** Also do a `GET /api/v1/devices` at boot.
   - Never infer disconnection from telemetry silence.
   - Open the machine, scale and shotState sockets once and keep them. Reconnect with backoff only on a socket `close`.
   - At most 32 sockets per client; close stale sockets.
3. **Timestamps.**
   - Use a custom ISO parser that accepts 0-6 fraction digits and an optional `Z` or offset. Treat zone-less values as gateway-local.
   - Never subtract a zone-less timestamp from a `Z` timestamp.
   - Compute shot time from `measurements[i].machine.timestamp`.
4. **Sample rate is variable** (about 3-5 Hz during a shot). Resample by timestamp, not by index.
   - Drop or label leading `preparingForShot` samples.
   - Ignore `profileFrame` until the first `preinfusion`/`pouring` sample.
   - Ignore `targetMixTemperature` during preheat.

### Profiles

5. **Profile JSON going out** must look exactly like what GET returns:
   - Numbers, `version: "2"`, an integer `target_volume_count_start`.
   - All ten top-level keys present. Use `null` for an absent `target_weight` / `target_volume`, and `""` for empty notes.
   - Each step complete, with only the active axis (`flow` **or** `pressure`), and `exit` / `limiter` / `weight` set explicitly (`null` allowed).
   - `exit.type` only `pressure` or `flow`. Never a "weight" exit object; use `step.weight`.
6. **Implement `profileId()`** client-side (§7), including Dart double formatting. Test it with the four vectors.
   - Use it to dedupe before POST, to find the active profile from `GET /workflow`, and to make MSW ids realistic.
   - Store CafAI's own version history (bean → versions) in IndexedDB, keyed by these ids. Decaid's `parentId` is advisory.
7. **Create a version** with `POST /api/v1/profiles {profile, parentId, metadata:{source:"cafai", …}}`.
   - Treat 201 as "a record with this content exists". Then check `response.profile.title === sent.title && response.parentId === sent.parentId`.
   - On a mismatch the content already existed. Either reuse it, or fix its presentation with `PUT /profiles/{id}` sending `{profile: <same content, new title>}`; the id stays the same. Restore visibility if `visibility !== "visible"`.
   - **Never use a content-changing `PUT /profiles/{id}` for versioning**: it deletes the old id.
   - Every title change needs a version bump so ids stay distinct per version. Step names are part of the hash, so never rename steps casually.

### Workflow and brewing

8. **Activate a profile** with one `PUT /api/v1/workflow {profile: <full profile>, context: {targetYield: <number>, targetDoseWeight, grinderSetting: "<string>", …}}`.
   - Take the 200 body as the new state, and check that `profileId(response.profile) === expected`.
   - Then watch `ws/v1/devices` for `connectionStatus.error?.kind === "profileUploadFailed"`. There is no success acknowledgement (§15 #1).
   - Never send partial profile objects.
9. **Yield and stop-at-weight** go through `context.targetYield`, a number. Never send `null`; send `0` for "off".
   - Optionally keep `profile.target_weight` equal to the recipe yield for export fidelity. Note that it changes the profile id.
10. **Do not PUT the workflow while a shot runs** (`shotState.state` not in `idle`/`finished`). The shot record snapshots the workflow at shot end.
    - Throttle PUTs; there is no server debounce.
    - Retry 409/503 with backoff. On 429 wait for `Retry-After`.
11. **Steam, hot water and flush parameters** go through workflow `steamSettings`, `hotWaterData` and `rinseData`. Send whole sub-objects of integers and doubles.
    - Do not use `POST /machine/shotSettings`: it needs all eight fields and is overwritten when the workflow is re-applied on connect.
12. **Machine commands** are `PUT /api/v1/machine/state/{espresso|steam|hotWater|flush|idle|sleeping|skipStep}`.
    - Stop and wake are both `idle`.
    - Handle 400 `block_no_scale` (show "connect a scale") and 500 "machine not connected".
    - Check `gatewayMode` from `GET /api/v1/settings`. In `full` mode Decaid neither tares nor stops at weight (de1_state_manager.dart:824; scale_handler.dart:127-138); warn the user and do not change it silently.
    - Use `GET /api/v1/machine/capabilities` to detect Bengle (autonomous stop-at-weight; `stopReason` is then `machineEnded`).
13. **Do not tare before espresso**; Decaid tares twice by itself.
    - Tare only for standalone weighing, and handle 400 `block_tare_during_shot`.
    - If CafAI ever uses a dosing scale, it is an auxiliary connection with id-addressed routes.
14. **Heartbeat.** `POST /api/v1/machine/heartbeat` on user interaction, throttled client-side to at most one every 10-30 s.

### Shots

15. **Shot list.** Page `GET /api/v1/shots?limit≤100&offset=…`, using `total` and an `If-None-Match` ETag.
    - Fetch `GET /api/v1/shots/{id}` for measurements.
    - Correlate a live shot through `ws/v1/machine/shotState.shotId` == `ShotRecord.id`. The record can take seconds to appear.
    - Final yield is `annotations.actualYield`; dose is `workflow.context.targetDoseWeight`, mirrored into `annotations.actualDoseWeight`.
16. **Shot feedback.** Use `PUT /api/v1/shots/{id} {annotations:{enjoyment (0-10), espressoNotes, extras:{cafai:{…}}}}`.
    - Never send `measurements`, `createdAt` or `updatedAt`. Never touch the bookkeeping extras keys or other plugins' extras keys.
    - Clear a field with `null`.

### Storage and errors

17. **KV mirror.** Use namespace `cafai` and URL-safe keys.
    - Read a whole namespace with `?full=1` plus an ETag.
    - Treat both 404 and a `null` body as "missing". Accept any 2xx on write.
    - Use `fetch(..., {keepalive:true})` for writes near unload; streamline found writes dropped without it (sjs:src\modules\api.js:1142-1146).
    - Never store the LLM API key there.
18. **Errors.** Show `error` plus `message`, or `details`, when present. For `type` values, map `block_no_scale` and `block_tare_during_shot` to friendly copy.

---

## 15. Open questions and spec/code drift, ranked by the cost of a wrong guess

1. **(High) No positive confirmation that the machine holds the selected profile.**
   - `PUT /workflow` returns before the upload. Only a failure (`profileUploadFailed`) is signalled.
   - There is no GET for the profile on the machine (ctl/workflow_device_sync.dart:75-138; Skins.md:2014-2019).
   - Before an "apply and pull" flow, verify with a real DE1 or the simulator how long uploads take. A shot started immediately after a PUT may run the old profile.
2. **(High) POST dedupe returns the existing record with 201, possibly hidden or deleted and with another title.** This is verified in code (ctl/profile_controller.dart:236-242). The spec (rest:3598-3631) and Skins.md never mention it. Mishandling it leads to wrong titles and versions in CafAI's history.
3. **(High) Version drift between this commit and field gateways (0.8.6+2801).**
   - Crema reported, against a live 0.8.6, that a profile without `version` or `target_volume` was refused one field at a time. In this commit only `tank_temperature` and `target_volume_count_start` are required.
   - **Always send all ten keys.**
   - Other version-dependent behaviour:
     - The 0.8.6 enjoyment range check ran after the shot lookup (mcp:docs\plugin-spike\REPORT.md:42).
     - `localIp` is absent on 0.8.6.
   - Pin and display the tested Decaid version through `/api/v1/info`.
4. **(Medium-high) Profile hash portability.** Any future change to `Profile.toJson` or `ProfileHash` (a new field, a different number format) changes every id. Keep CafAI's lineage keyed by its own ids and re-resolve Decaid ids by hashing.
5. **(Medium) Timestamp zones.**
   - The code writes local zone-less timestamps for telemetry and profile records, but Z for shot `createdAt`/`updatedAt`.
   - The docs' examples all show `Z` (Skins.md:153, 731, 1068).
   - Imported or legacy shots may differ. Parse defensively.
6. **(Medium) KV semantics drift.** A missing key is 200 `null` in code and 404 in the spec and docs. Set is 200 `{}` in code and 204 in the spec. Delete is 200 `{}` in code and `{deleted}`/404 in the spec. Raw, undecoded path keys. Handle all forms.
7. **(Medium) Status codes the specs do not show.**
   - An unknown state name gives 500.
   - A missing step field gives 500 on `POST /profiles` and `PUT /workflow` (400 on `PUT /profiles/{id}`).
   - Tare with no scale gives 500 (the docs say 404).
   - Any `/machine/*` call with no machine gives 500.
   - `shotSettings` with a partial body gives 500.
8. **(Medium) Sample rate.** Docs say ~10 Hz; the real data shows ~3.7 Hz. LLM summaries and resampling must not assume either.
9. **(Low-medium) Enum lists differ between the REST spec, the WS spec and the code** (`schedIdle`, `busy`, `transportMode`, the `cleaingGroup` typo, error substates, device type `grinder`). Generate client enums from the Dart code (dev/machine.dart:139-198), not the specs, and tolerate unknown strings.
10. **(Low-medium) Profile step limit.** No API limit exists. The DE1 frame limit (de1app's profile editor caps at 20) is unverified here. Cap CafAI templates at 20 steps.
11. **(Low) Spec drift that affects generated types only.**
    - `Error {e,st}` is never sent.
    - `WorkflowRequest` lacks `id`.
    - The WS `DevicesState` lacks `charging`.
    - `steamTemperature` is typed `number` but is an int.
    - The WS `ShotSettings` uses `number` where the code uses ints.
    - The spec says legacy `doseData` etc. are rejected, but they are accepted.
    - Skins.md wrongly says the GET returns legacy fields.
    - Skins.md's `batteryLevel` should be `battery` on `ws/v1/scale/snapshot`.
    - Skins.md:409-417's `warningThresholdPercentage` should be `refillLevel`.
    - Skins.md:244's `"version":"1.5.0","model":"DE1+"` is really a firmware build string and an enum name.
    - Api.md:82's `sleep` should be `sleeping`.
    - AI_API_NOTES.md:22's response envelope does not exist.
12. **(Low) Unverified field reports from streamline-js**, not checked in code:
    - USB and integrated scales stay `discovered` in `/devices`.
    - A spurious `machineDisconnected` appears during quick-connect (decaid#634).
    - `scan?connect=true` is slow, with 41.6 s observed.
    - Treat each as possible.

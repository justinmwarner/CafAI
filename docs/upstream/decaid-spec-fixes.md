# Decaid spec fixes: a draft for Decent

Status: draft (spec 4.8). CafAI does not send it; the owner decides whether
to open it on [decentespresso/decaid](https://github.com/decentespresso/decaid).

Every location is at Decaid **v0.8.8** (`aab5f93`), the release CafAI pins
(D93): spec lines in `assets/api/rest_v1.yml` (REST) and
`assets/api/websocket_v1.yml` (WS), Dart lines under `lib/src/`. The findings
come from CafAI's contract checks (`contract/decaid/`, which record each one
as an exception in `contract/decaid/drift.ts`) and the 2026-10-09 audit
(`docs/audit/2026-10-09/typegen.md` section 3, `decaid.md` section 3.4).
Fixing them upstream would remove most of `drift.ts`.

---

## Issue text

**Title:** The REST and WebSocket specs disagree with the Dart code: missing `required` lists, nullable values, state lists, KV and error responses

**Body:**

We build a skin (CafAI) that checks itself against the published specs at
typecheck time: types generated from `rest_v1.yml` and `websocket_v1.yml`
with openapi-typescript, compared with the types the skin codes against, and
an ajv run over example payloads and a mock. At v0.8.8 the specs and the Dart
serializers disagree in the places below. In each case we followed the Dart
code, which is what a skin receives. Line numbers are at `aab5f93`.

### 1. Response schemas have no `required` lists

Most response schemas declare no `required` array, so generated clients see
every field as optional, although the `toJson` methods always send them.

| Schema | Spec | Dart (always sends) | Add to `required` |
|---|---|---|---|
| `MachineSnapshot` and its `state` | REST 6378, WS 726 | `models/device/machine.dart:97-112` | all twelve keys; `state.state`, `state.substate` |
| `MachineInfo` | REST 6101 | `models/device/machine.dart:26-34` | `version`, `model`, `serialNumber`, `GHC` |
| `WeightSnapshot` / WS `ScaleSnapshot` | REST 7610, WS 565 | `controllers/scale_controller.dart:316-324` | all five (`battery`, `timerValue` stay nullable) |
| WS `ShotSettings` | WS 796 | `models/device/de1_interface.dart:147-158` | all eight |
| WS `WaterLevels` | WS 815 | `models/device/de1_interface.dart:228-229` | `currentLevel`, `refillLevel` |
| WS `ScaleStatus` | WS 608 | `services/webserver/scale_handler.dart:244-246` | `status` |
| WS `ShotStateEvent` and its decision | WS 638 | `models/data/shot_state_event.dart:45-50, 89-101` | `shotId`, `machineState`, `machineSubstate`, `profileFrame`, `decision` (all nullable); `decision.kind`, `reason`, `details`, `data` |
| WS `DevicesState.connectionStatus`, `DeviceInfo.available` | WS 885, 940 | `services/webserver/devices_handler.dart:139-184, 858-864` | `connectionStatus` and its five keys; `available` |
| `DeviceInventory` (`GET /devices`, `/devices/scan`) | REST 5999 | `services/webserver/devices_handler.dart:858-864` | `name`, `id`, `state`, `type`, `available` |
| `WorkflowRequest` | REST 7202 | `models/data/workflow.dart:93-105` | `id` (see 3), `name`, `description`, `profile`, `steamSettings`, `hotWaterData`, `rinseData` |
| `Profile` as a reply | REST 6476 | `models/data/profile.dart:93-106` | `version`, `notes`, `author`, `beverage_type`, `target_volume`, `target_weight` |
| `ProfileStep` | REST 6519 | `models/data/profile.dart:265-280, 352-367` | `exit`, `limiter`, `weight` (null when absent, see 2) |
| `ProfileRecord` | REST 7932 | `models/data/profile_record.dart:136-148` | `parentId`, `metadata` (both nullable) |
| `ShotRecord`, `ShotRecordSummary` | REST 7426, 7514 | `models/data/shot_record.dart:50-76` | `id`, `timestamp`, `createdAt`, `updatedAt`, `workflow`; `measurements` on `ShotRecord` |
| `ShotSnapshot` | REST 7559 | `models/data/shot_snapshot.dart:23-28` | `machine`, `scale`, `volume` |
| `POST /machine/heartbeat` reply | REST 4349 | `services/webserver/presence_handler.dart:27` | `timeout` |
| `PluginManifest` (`GET /plugins`) | REST 7630 | `plugins/plugin_manifest.dart:314-327`, `services/webserver/plugins_handler.dart:24-29` | `id`, `name`, `author`, `description`, `version`, `apiVersion`, `permissions`, `drivers`, `settings`, `api` (nullable), `loaded`, `autoLoad` |

`Profile` is also the request schema. If the request should stay lenient
(only `title`, `steps`, `target_volume_count_start`, `tank_temperature`), a
separate reply schema, or `required` on the reply-side wrappers, keeps both
right.

### 2. Values that may be null are not nullable

| Where | Spec | Dart | Fix |
|---|---|---|---|
| `ProfileStep.exit`, `ProfileStep.limiter` | REST 6519 (`$ref` to 6579, 6600) | sent as `null` for a step without one and read back from `null` (`models/data/profile.dart:249-259, 270, 277, 336-346, 357, 364`) | `allOf: [$ref] + nullable: true` |
| `Profile.version` | REST 6476 | kept as `null` when missing, sent, read with `parseOptionalString` (`models/data/profile.dart:74, 95`) | `nullable: true` |
| `ShotSnapshot.scale` | REST 7559 | `"scale": null` for a measurement without a scale (`models/data/shot_snapshot.dart:26`) | `nullable: true` |
| `GET /shots/latest` | REST 1820 | 200 `null` when there is no shot (`services/webserver/shots_handler.dart:171`) | a nullable reply, or document the `null` |

### 3. The workflow's `id` is missing

`WorkflowRequest` (REST 7202) has no `id`, but `Workflow.toJson` always
sends it (`models/data/workflow.dart:95`), in the workflow and in every shot
record's `workflow`. Add `id: {type: string}` and make it required.

### 4. The machine state lists

- REST `MachineState` (6414) lacks `schedIdle`, which Dart has and sends for
  a DE1 in scheduled idle (`models/device/machine.dart:143`;
  `models/device/impl/de1/de1.utils.dart:14-15`).
- WS `MachineState` (762) lacks `busy`, `schedIdle`, `steamRinse`,
  `calibration`, `selfTest`, `airPurge` and `fwUpgrade`, and lists a
  `transportMode` (777) that Dart does not have
  (`models/device/machine.dart:139-161`). The two specs could share one list.
- Both `MachineSubstate` lists spell `cleaingGroup` (REST 6450, WS 790; also
  `doc/Skins.md:303`); Dart sends `cleaningGroup`
  (`models/device/machine.dart:170`).
- WS `MachineSubstate` (781) lacks the 18 `error*` substates the REST spec
  lists (`models/device/machine.dart:180-197`).

### 5. The KV store's statuses and bodies

`kv_store_handler.dart` answers differently from the spec (REST 2935-3058):

| Call | Spec | Dart |
|---|---|---|
| `GET /store/{ns}/{key}`, missing key | 404 | 200 `null` (`services/webserver/kv_store_handler.dart:24`) |
| `POST /store/{ns}/{key}` | 204 | 200 `{}` (`:54`); a body that is not JSON is an unhandled 500 (`:45`) |
| `DELETE /store/{ns}/{key}` | 200 `{deleted}`, 404 | 200 `{}` always (`:34`) |

Namespace and key are used as sent, not percent-decoded. Either the code or
the spec could move; skins tolerate both today, so documenting the code is
the safe fix.

### 6. The error schema

`Error` (REST 5954) is `{e, st}`, which no handler sends. They send
`{error}`, `{error, message}`, `{error, st}`, `{message}` or the policy
form `{details, type}`, for example `services/webserver/de1handler.dart:694-716`,
`scale_handler.dart:48-57`, `settings_handler.dart:81-83`. Suggested:
`Error: {error: string, message?: string, st?: string, code?: string}` and a
`PolicyError: {type: string, details: string}` (which `MachineStateError`
already half is).

### 7. Local timestamps are marked `format: date-time`

`date-time` means RFC 3339, with a zone. Many timestamps are local and
zone-less, `DateTime.toIso8601String()` on a local time, for example
`2026-09-29T12:53:54.216425`: `MachineSnapshot.timestamp`
(`models/device/machine.dart:99`), `WeightSnapshot.timestamp`
(`controllers/scale_controller.dart:318`), `ProfileRecord.createdAt` and
`updatedAt` (`models/data/profile_record.dart:145-146`), `ShotRecord.timestamp`
(`models/data/shot_record.dart:53`), bean and batch dates
(`models/data/bean.dart:117-118, 296-314`), grinder dates
(`models/data/grinder.dart:128-129`). A validator with formats on rejects
every one. Either send UTC (a change for skins that read local time) or
drop `format: date-time` from these and say "local time, no zone" (a
`pattern` keeps them checkable). Shot `createdAt`/`updatedAt` and the
devices timestamps are UTC with `Z` and can keep the format.

### 8. Statuses the handlers answer that the spec lacks

- `PUT /scale/tare` without a scale answers 500
  `{"error": "DeviceNotConnectedException: scale not connected"}`
  (`services/webserver/scale_handler.dart:52-57`); the spec (REST 1119) and
  `doc/Skins.md:430` say 404.
- `GET /machine/info`, `GET /machine/state` and `PUT /machine/state/{newState}`
  (REST 368, 380, 392) document success only; without a machine they answer
  500 `{"error": "DeviceNotConnectedException: machine not connected"}`
  (`services/webserver/de1handler.dart:682-687, 713-714`).
- `POST /machine/profile` (REST 414) also answers 409 (a superseded write)
  and 504 (Bluetooth timed out) (`services/webserver/de1handler.dart:699-712`).
- `PUT /machine/state/{newState}` with an unknown name answers 500
  `{error, st}` (`MachineState.values.byName`, `de1handler.dart:825`), not the
  documented 400; `doc/Api.md:82` lists `sleep`, which is not a state
  (`sleeping` is).
- `POST /settings` (REST 1461) answers 400 `{message}` for an unknown
  `gatewayMode` or `themeMode` (`services/webserver/settings_handler.dart:76-84, 300-311`)
  and 200 `null` otherwise (`:314`).

### 9. `WorkflowPatch` needs patch schemas

`WorkflowPatch.hotWaterData` and `rinseData` (REST 7229) reuse
`HotWaterData` (7339) and `RinseData` (7365), where every field is required,
but the PUT deep-merges before parsing (`models/data/json_utils.dart:3-29`,
`services/webserver/workflow_handler.dart:182`), so a partial object is
valid. `SteamSettingsPatch` already shows the shape: add `HotWaterDataPatch`
and `RinseDataPatch`.

### 10. Smaller ones

- `GET /webview/logs` (REST 5172) is documented as a JSON array; it answers
  `text/plain` lines (`services/webserver/webview_logs_handler.dart:20-22`).
- WS `DevicesState` (885) does not list `charging`, which battery platforms
  send (`services/webserver/devices_handler.dart:156`).
- `POST /machine/shotSettings` (REST 434, schema 6615) needs every field:
  `De1ShotSettings.fromJson` throws on a missing one
  (`models/device/de1_interface.dart:160-170`), so the schema wants a
  `required` list.
- The steam and hot water values reach the DE1 as single bytes, unchecked:
  `UnifiedDe1.updateShotSettings` packs `targetSteamTemp`,
  `targetSteamDuration`, `targetHotWaterTemp`, `targetHotWaterVolume` and
  `targetHotWaterDuration` into a `Uint8List`
  (`models/device/impl/de1/unified_de1/unified_de1.dart:611-630`), so a
  hot water volume of 300 ml becomes 44 ml. Neither the workflow handler nor
  the spec bounds them. A `maximum: 255` in `SteamSettings` and
  `HotWaterData` (and a range check in the handler) would stop it; Decent's
  streamline already caps the volume at 255.

### 11. The docs

- `doc/Skins.md:382-390`: the `POST /machine/settings` example sends
  `"usb": true`, which turns the charger **off**: the handler reads
  `json['usb'] == 'enable'` (`services/webserver/de1handler.dart:396`). The
  spec and `Skins.md:394-405` are right.
- `doc/Skins.md:410-416` documents `warningThresholdPercentage` for
  `POST /machine/waterLevels`; only `refillLevel` is read
  (`services/webserver/de1handler.dart:366-373`), as the spec says.
- `doc/Skins.md:741, 1763` show `batteryLevel` in scale snapshots;
  `WeightSnapshot` sends `battery` (`controllers/scale_controller.dart:321`).
- `doc/Skins.md:303` spells `cleaingGroup`; `Skins.md:430` says a tare
  without a scale is 404 (see 8).
- `doc/Api.md:464` lists `POST /display/brightness`; the route is `PUT`
  (`services/webserver/display_handler.dart:12`), as the spec says.

### Already fixed after v0.8.8

- WS `DeviceInfo.type` lacked `grinder` (`models/device/device.dart:6` has
  had it); `a34615f` added it to the spec.

---

## Patch outline

1. `assets/api/rest_v1.yml`
   - `required` lists for the schemas in section 1 (and a reply-side
     `Profile`, or `required` on its wrappers).
   - `nullable: true` on `ProfileStep.exit`/`limiter` (as `allOf` + `nullable`),
     `Profile.version`, `ShotSnapshot.scale`; a nullable `GET /shots/latest`
     reply.
   - `id` on `WorkflowRequest`.
   - `schedIdle` in `MachineState`; `cleaningGroup` in `MachineSubstate`.
   - KV: 200 `null` for a missing key, 200 `{}` for a write and a delete.
   - `Error` as the handlers send it, and a `PolicyError`.
   - Local timestamps: drop `format: date-time` (or a `pattern`), with a
     sentence on local time.
   - Statuses: 500 on the machine routes and on tare, 409 and 504 on
     `POST /machine/profile`, the 500 for an unknown state name, the 400 on
     `POST /settings`.
   - `HotWaterDataPatch`, `RinseDataPatch` in `WorkflowPatch`.
   - `text/plain` for `GET /webview/logs`; `required` for `ShotSettings` as a request.
2. `assets/api/websocket_v1.yml`
   - `required` lists for `MachineSnapshot`, `ShotSettings`, `WaterLevels`,
     `ScaleSnapshot`, `ScaleStatus`, `ShotStateEvent`, `DevicesState`.
   - The REST state lists (or a shared list): the seven states, no
     `transportMode`, `cleaningGroup`, the `error*` substates.
   - `charging` in `DevicesState`; the zone-less `timestamp`s as in REST.
3. `doc/Skins.md`, `doc/Api.md`: the five doc fixes in section 11.
4. A guard so it stays fixed: a Dart test that encodes each model's
   `toJson()` output and validates it against the spec schema it answers
   with (the repo already has spec-reading tests such as
   `test/connect_result_schema_test.dart`).

# Example payloads for the CafAI mock server (MSW)

These files are fixtures for an MSW mock of the Decaid gateway. They are the
companion to `../02-api.md`. Use them for contract tests and fixtures. None of
them is a live capture of this exact source commit.

Sources:

- **Decaid:** `E:\source\cafai\.ref\decaid` at commit
  `a45961b323831d2170b3e7f3fef7c72fdd341642`.
- **Real wire captures from Decaid 0.8.6+2801:**
  `E:\source\cafai\.ref\decaid-mcp\test\fixtures\` (`machine-state.json`,
  `workflow.json`, `shots\shot-01.json`, `list-page-newest.json`,
  `info.json`, `errors\*.json`). These were used to sanity-check the field
  names, value types, timestamp formats and sample spacing.

## How the files were produced

A single throwaway script built every file from the Dart serializers. It
reproduces Decaid's code path exactly:

- `Profile.fromJson` followed by `toJson` (`lib/src/models/data/profile.dart:53-106`)
- `ProfileHash` (`lib/src/models/data/profile_hash.dart:6-77`)
- `MachineSnapshot.toJson` (`lib/src/models/device/machine.dart:97-112`)
- `WeightSnapshot.toJson` (`lib/src/controllers/scale_controller.dart:316-324`)
- `ShotRecord.toJson` (`lib/src/models/data/shot_record.dart:50-76`)
- `Workflow.toJson` (`lib/src/models/data/workflow.dart:93-105`)

**Hash replica check.** The script's hash replica was checked against the
repo. Hashing the bundled `assets/defaultProfiles/best_practice.json`
(Adaptive v2) gives `profile:b73ce54592d667d00b31`. That is the same id the
repo records as `parent_id` in `assets/defaultProfiles/best_practice_v3.json:5`
and asserts in `test/profiles/default_profiles_migration_test.dart:200-216`.
The ids, `metadataHash` and `compoundHash` values below are therefore what
Decaid itself would compute.

**Formatting.** Number formatting follows Dart's `jsonEncode`:

- Fields Dart types as `double` are written with a trailing `.0`, for example
  `90.0`. `JSON.parse` reads both forms the same way.
- Fields Dart types as `int` are bare, for example `profileFrame`,
  `steamTemperature`, `target_volume_count_start`, `timerValue` and the
  integer fields of the steam, hot water and rinse settings.
- The JSON is pretty-printed. Decaid sends it compact.

**Fixed-point values.** Machine telemetry values sit on the DE1's fixed-point
grid (`lib/src/models/device/impl/de1/unified_de1/unified_de1.parsing.dart:8-21`):

| Field | Grid |
|---|---|
| `pressure`, `flow` | n/4096 |
| `mixTemperature`, `targetMixTemperature`, `targetGroupTemperature` | n/256 |
| `groupTemperature` | n/65536 |
| `targetPressure`, `targetFlow` | n/16 |

**Timestamps.** The examples assume the tablet's local zone is UTC+02:00:

- **Local time, no zone suffix, microseconds**, as Dart writes a local
  `DateTime`: all machine and scale timestamps, `ShotRecord.timestamp`,
  `ShotStateEvent.timestamp`, and `ProfileRecord.createdAt` / `updatedAt`.
- **UTC with a `Z`:** `ShotRecord.createdAt` / `updatedAt` and
  `DevicesState.timestamp`. The real 0.8.6 capture mixes the two forms the
  same way.

## Files

| File | Endpoint / channel | Provenance and notes |
|---|---|---|
| `machine-info.json` | `GET /api/v1/machine/info` | **Constructed** from `MachineInfo.toJson` (machine.dart:26-34) and `unified_de1.dart:307-316`. `version` is the firmware build number as a string, not semver. `model` is the enum name (`DE1`, `DE1Plus`, `DE1Pro`, `DE1XL`, `DE1Cafe`, `DE1XXL`, `DE1XXXL`, `Bengle`, `Unknown`), not "DE1+". `extra.voltage` follows the spec example (rest_v1.yml:6055-6057). |
| `machine-state.json` | `GET /api/v1/machine/state` | **Constructed** in the shape of the real 0.8.6 capture (`decaid-mcp\test\fixtures\machine-state.json`). Idle and idle. `targetFlow` and `targetPressure` while idle are leftovers from the last frame. |
| `machine-snapshot-ws.json` | `ws/v1/machine/snapshot`, one frame | **Constructed.** Mid-shot: `espresso`/`pouring`, frame 5 ("decline"). Identical to `measurements[5].machine` in `shot-record.json`. |
| `scale-snapshot-ws.json` | `ws/v1/scale/snapshot`, weight frame | **Constructed** from `WeightSnapshot.toJson`. The field is `battery`, not `batteryLevel` as Skins.md shows. `timerValue` is in ms and may be `null`; the real 0.8.6 capture has `null` throughout. |
| `scale-status-ws.json` | `ws/v1/scale/snapshot`, status frame | From the spec (websocket_v1.yml:605-614) and code (scale_handler.dart:244-249, 266-276). It can also be `{"status":"disconnected"}`. |
| `devices-ws.json` | `ws/v1/devices` frame; `GET /api/v1/devices` returns just the `devices` array | **Constructed** from `devices_handler.dart:136-185`, entries per `devices_handler.dart:858-864`. `charging` is sent only on platforms with a battery controller, and the AsyncAPI spec omits it. Entries are sorted with preferred devices first, then by type, then by id (devices_handler.dart:885-898). |
| `shot-settings.json` | `ws/v1/machine/shotSettings` frame; also the full body `POST /api/v1/machine/shotSettings` requires | **Constructed** from `De1ShotSettings.toJson` (de1_interface.dart:147-158). Every field is an integer except `groupTemp`. |
| `water-levels-ws.json` | `ws/v1/machine/waterLevels` frame | **Constructed.** Values are in mm (de1_interface.dart:222-231). |
| `shot-state-ws.json` | `ws/v1/machine/shotState` frame | **Adapted** from the Api.md example (Api.md:770-789) and the code (shot_sequencer.dart:440-461, shot_state_event.dart:89-101). The decision timestamp is about 0.27 s after the last recorded measurement, because the sample that triggers the stop is not recorded (shot_sequencer.dart:648-655). |
| `workflow-get.json` | `GET /api/v1/workflow`; also the 200 body of `PUT /api/v1/workflow` | **Constructed** from `Workflow.toJson`. Values, field by field: <ul><li>The profile is the CafAI-derived "Guji Hambela v1" (see below).</li><li>`name` and `description` are Decaid's defaults (workflow_controller.dart:10-19).</li><li>`steamSettings`, `hotWaterData` and `rinseData` hold Decaid's defaults (workflow.dart:261-268, 335-342, 391-393).</li><li>There is no profile id inside the workflow. Hashing `profile` gives `profile:fbff9b37ed390c6a8110`, the id in `profile-record.json`.</li></ul> |
| `workflow-put-request.json` | `PUT /api/v1/workflow` body | **Constructed.** Activates a profile and sets dose, yield and grind. The profile carries all 10 top-level keys, because omitted keys would be kept from the previous profile by the deep merge. |
| `profile-create-request.json` | `POST /api/v1/profiles` body | **Constructed.** It is a wrapper `{profile, parentId, metadata}`; a bare profile is rejected with 400. <ul><li>`profile` is the bundled "Default" profile (`Default1.json`, id `profile:a582ef47a76f99f56912`) with +1.0 °C on every step and a new title, author and notes.</li><li>`parentId` is the Default profile's id.</li><li>`metadata` is free-form; CafAI chooses its content.</li></ul> |
| `profile-record.json` | 201 body of the create above; also one element of `GET /api/v1/profiles` | **Constructed** from `ProfileRecord.toJson` (profile_record.dart:135-148). It has the real computed `id`, `metadataHash` and `compoundHash`. |
| `profiles-list.json` | `GET /api/v1/profiles` | **Constructed.** <ul><li>Two records: the CafAI record, and the bundled Default record (`isDefault: true`, `metadata: {source: "bundled", filename}` per profile_controller.dart:60-69 and 441).</li><li>Sorted by `updatedAt` descending (`lib/src/services/database/daos/profile_dao.dart:16`).</li><li>Real hashes for both.</li></ul> |
| `shot-record.json` | `GET /api/v1/shots/{id}`; also the 200 body of `PUT /api/v1/shots/{id}` | **Constructed** with 7 measurements. Two of them are preinfusion samples. <ul><li>Measurements run from `preparingForShot` through `preinfusion` (frames 0-1) and `pouring` (frames 2 and 5). Spacing is uneven, about 4-5 s here; a real stream runs at about 3.7 Hz (0.27 s).</li><li>The first sample shows a stale `profileFrame` (5, left over from the previous shot) and a meaningless preheat `targetMixTemperature` of about 18 °C. Both quirks appear in the real 0.8.6 capture.</li><li>`volume` stays 0.0 until frame 2 (`target_volume_count_start`).</li><li>`workflow.machine` is the capture-time provenance block.</li><li>`annotations` holds the values after a CafAI update; `shotNotes` and `metadata` are the deprecated mirrors that Decaid adds.</li></ul> |
| `shots-list.json` | `GET /api/v1/shots?limit=20&offset=0` | **Constructed** `PaginatedShots`. Its items are `ShotRecordSummary`, which is a full record minus `measurements`, including the full `workflow` with profile steps. The second item is an un-annotated shot on the Default profile. |
| `shot-update-request.json` | `PUT /api/v1/shots/{id}` body | **Constructed.** `enjoyment` is on the 0-10 scale. Keep CafAI data under `extras.cafai`, because `extras` is deep-merged per key. |
| `kv-get.json` | `GET /api/v1/store/cafai/coach-state` | **Constructed.** The KV store returns the stored JSON value verbatim, and the value's shape is CafAI's choice. A missing key returns 200 with the body `null` in code (kv_store_handler.dart:24), not the 404 the spec states. |
| `error.json` | `POST /api/v1/profiles` → 400 | **From code:** profile_handler.dart:130-133 and profile.dart:66-71. This is the source of "Invalid request". |
| `error-machine-not-connected.json` | Any `/api/v1/machine/*` call without a DE1 → 500 | **From code:** de1handler.dart:713-714 and errors.dart:23-24. The text matches Crema's live observation. |
| `error-block-no-scale.json` | `PUT /api/v1/machine/state/espresso` → 400 | **From code:** de1handler.dart:836-847. The tare equivalent is `{"details":"Tare blocked: a shot is in progress","type":"block_tare_during_shot"}` (scale_handler.dart:46-51). |
| `build-info.json` | `GET /api/v1/info` | **Real 0.8.6 capture** (`decaid-mcp\test\fixtures\info.json`) plus `localIp`. The current code always sends `localIp` (info_handler.dart:16-27); 0.8.6 did not. |
| `heartbeat.json` | `POST /api/v1/machine/heartbeat` | **From** the spec example (rest_v1.yml:4356-4366). It is `-1` when presence tracking is disabled or no machine is connected. |

## Mock behaviours the fixtures alone cannot express

Implement these in the MSW handlers.

**Workflow**

- `PUT /api/v1/workflow` applies `deepMergeJson(currentWorkflow, body)` (`lib/src/models/data/json_utils.dart:3-30`):
  - Maps merge recursively.
  - Arrays (`profile.steps`) and scalars are replaced wholesale.
  - An explicit `null` sets the value to null.
- It then rejects the request with 400 `{error:"Invalid request", message}` in these cases:
  - `steamSettings` or `context` is null.
  - `context.targetYield` is null or not a number.
  - `title` is missing or empty, `steps` is empty, or `tank_temperature` / `target_volume_count_start` is missing.
- It echoes the full merged workflow with 200.

**Profiles**

- `POST /api/v1/profiles` computes the content-hash id.
- If a record with that id exists, it returns the **existing** record unchanged with **201**, ignoring the new title, metadata and parentId.
- A body without `profile` returns 400 `{error:"Missing required field", message}`.

**Shots**

- `PUT /api/v1/shots/{id}` deep-merges into the stored record.
- It returns 400 `{error}` for:
  - `measurements`, `createdAt` or `updatedAt` in the body.
  - An `id` in the body that does not match the path.
  - `annotations.enjoyment` outside 0-10.
- `updatedAt` advances only when the content changes.

**Machine**

- `PUT /api/v1/machine/state/{s}` accepts any `MachineState` enum name and returns 200 with the body `null`.
- An unknown name returns 500 `{error, st}`.

**KV store**

- `GET` of a missing key returns 200 `null`.
- `POST` and `DELETE` return 200 `{}`.

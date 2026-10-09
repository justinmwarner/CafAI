# CafAI: generating Decaid API types from the published specs

**Date:** 2026-10-09.
**Inputs:** Decaid clone `.ref\decaid` (shallow; history starts at `a45961b`, HEAD is `af4e995`).
**Specs:** `assets/api/rest_v1.yml` (OpenAPI 3.0.3) and `assets/api/websocket_v1.yml` (AsyncAPI 3.1.0). The copies in `.ref/streamline-js` were also checked.
**CafAI files:** `src/api/types.ts`, `src/coach/types.ts`, `src/api/grinders.ts`, `docs/verified/examples/`, `mock/decaid/`.
**Scope:** an experiment only. Nothing in CafAI or any other repo was edited, staged or committed (`git status` shows only the untracked `nimbalyst-local/`, which was there before). No dependency was added to CafAI.
**Scratch folder:** `.ref/cafai-audit-typegen/`. Every script below is in it and can be reused.

**Tools used:** Node 24.13.1 and TypeScript 5.9.3 from CafAI's `node_modules`, and openapi-typescript 7.13.0, which bundles `@redocly/openapi-core` 1.34.20.

Throwaway tools, installed in the scratch folder only:
- `@asyncapi/parser` 3.6.3
- `json-schema-to-typescript` 15.0.4
- `ajv` 8.20.0
- `ajv-formats` 3.0.1
- `yaml` 2.9.1
- `@apidevtools/json-schema-ref-parser` 11.9.3 (installed, not needed)

---

## Verdicts in one screen

| # | Question | Verdict |
|---|---|---|
| 1 | Does openapi-typescript 7.13 handle `rest_v1.yml`? | **Yes, cleanly, for both Decaid commits.** <ul><li>Exit 0, no warnings, about 0.37 s each.</li><li>The output has 107 named `components["schemas"]`, 117 paths and 159 operations.</li><li>It type-checks under CafAI's strict settings.</li><li>`operations` is empty because the spec has **no `operationId`s**. Use path-based access.</li><li>Don't use `--enum`: it breaks `erasableSyntaxOnly` (99 × TS1294).</li><li>**streamline-js's copy crashes the generator.**</li></ul> |
| 2 | Best way to get WebSocket types? | **Wrap the AsyncAPI `components.schemas` in a synthetic OpenAPI 3.0 document and run openapi-typescript on it.** Add a generated channel map (`WsReceive` / `WsSend`, keyed by address). <ul><li>Decaid's AsyncAPI schemas use the OpenAPI-3.0 `nullable` keyword, which only this route handles natively.</li><li>The AsyncAPI parser plus json-schema-to-typescript also works, but it silently drops `nullable` (for example `shotId?: string` with no `null`) unless you pre-convert it. It also costs 183 packages.</li></ul> |
| 3 | Conformance check | **Works, and catches real changes at type-check time.** <ul><li>A type-level `Diff<From, To>` lists every mismatch as a string literal. `Exactly<Diff, KnownDrift>` fails on **new** drift (`{unexpected}`) and on **fixed** drift (`{stale}`).</li><li>It passes on af4e995 with the recorded exceptions.</li><li>On a45961b it fails exactly on the one real WS spec change (`grinder`).</li><li>On a mutated spec it catches a renamed field, a newly nullable field and a removed field. A spec fix shows up as stale.</li><li>**No real CafAI bug was found.** Every mismatch is a spec gap or spec drift, or a deliberate CafAI choice that matches the Dart code.</li></ul> |
| 4 | Spec changes a45961b → af4e995 | Only two touch CafAI, and both are additive. <ul><li>`WorkflowContext` and `WorkflowContextPatch` gained `grinderBurrs` (optional, nullable).</li><li>The WS `DeviceInfo.type` gained `grinder`. CafAI already had it, so this *removes* drift.</li><li>No operation changed.</li><li>**streamline-js's copies are stale** (older than a45961b), and its REST copy crashes openapi-typescript.</li></ul> |
| 5 | Validate examples with ajv? | **Yes**, after a roughly 40-line converter from OpenAPI 3.0 to draft-07 (`nullable`, boolean `exclusiveMinimum`). <ul><li>As written: 11 of 21 examples pass.</li><li>All 10 failures come from two pieces of spec drift: `format: date-time` on zone-less local timestamps, and non-nullable `exit`/`limiter`.</li><li>A strict pass that rejects undocumented keys also flags `workflow.id`, devices `charging` and the error body.</li><li>The MSW mock serves byte copies of these examples, typed by CafAI's own types, so it inherits exactly these results. It can't detect drift on its own.</li></ul> |
| 6 | Design | Section 6. <ul><li>Vendor the pinned specs and generate two `.ts` files.</li><li>Keep a separate `tsconfig.contract.json` with the Diff/Exactly assertions and a drift file that gives a reason for every exception.</li><li>Run it blocking against the pin and non-blocking (scheduled) against Decaid `main`.</li><li>Add ajv fixture validation.</li><li>New devDependencies: only `yaml`, plus `ajv` + `ajv-formats` if fixture validation is adopted.</li></ul> |

---

## 1. openapi-typescript 7.13 on `rest_v1.yml`

**Commands** (in the scratch folder):

```sh
git -C .ref/decaid show a45961b:assets/api/rest_v1.yml > specs/rest_v1.a45961b.yml
cp .ref/decaid/assets/api/rest_v1.yml specs/rest_v1.af4e995.yml
cp .ref/streamline-js/rest_v1.yml specs/rest_v1.streamline.yml
for v in a45961b af4e995 streamline; do
  node node_modules/openapi-typescript/bin/cli.js specs/rest_v1.$v.yml -o gen/rest_v1.$v.d.ts > gen/otsgen.$v.log 2>&1; echo "$v exit=$?"
done
```

### Generation results

| Spec | Exit | Output | Notes |
|---|---|---|---|
| Decaid a45961b | 0 | 11,215 lines, 417,547 B | No warnings (`gen/otsgen.a45961b.log`), 0.37 s. |
| Decaid af4e995 | 0 | 11,288 lines, 421,620 B | No warnings, 0.39 s. |
| streamline-js copy | **1** | – | `TypeError: Cannot use 'in' operator to search for '$ref' in null` at `transform/request-body-object.mjs:11`. See below. |

**The streamline crash.** The requestBody media type for `POST /api/v1/machine/firmware` is `application/octet-stream:` with no schema (streamline `rest_v1.yml:931`). `find-null-media.mjs` locates it. Decaid has since fixed this: af4e995 has `schema: {type: string, format: binary}` at `rest_v1.yml:1017-1024`.

### Spec shape

`summarize-paths.mjs` gives these counts:

| Spec | Paths | Operations | With `operationId` | Schemas |
|---|---|---|---|---|
| a45961b | 117 | 159 | 0 | 104 |
| af4e995 | 117 | 159 | 0 | 107 |
| streamline | 107 | 149 | 0 | 91 |

### Quality of the output

**Named schemas are good.** Examples: `components["schemas"]["MachineSnapshot"]`, `["WorkflowRequest"]`, `["ShotRecord"]`, `["ProfileRecord"]`.

**Operations are inline under `paths`.** For example:

```ts
paths["/api/v1/shots/{id}"]["get"]["responses"][200]["content"]["application/json"]
```

Because there are no `operationId`s, `export type operations = Record<string, never>`. Path-based helpers (`conformance/spec.ts`: `Res<Path, Method, Status>`, `Body<Path, Method>`, `PathParams`, `Statuses`) make this convenient, and they keep working when Decaid renames a schema.

**The big quality problem is missing `required` lists.** Most response schemas declare no `required` array, so every property comes out optional (`flow?: number`). This affects `MachineSnapshot`, `ShotSettings`, `WaterLevels`, `WeightSnapshot`, `WorkflowRequest`, `ShotRecord`, `ShotRecordSummary`, `ShotSnapshot`, `MachineInfo` and `DeviceInventory`. The Dart `toJson` methods always emit these keys (Section 3).

**`nullable` is handled correctly.** So are `type: "null"` and `allOf + nullable`.

**Request bodies** with `default` stay optional. Response properties with a `default` become required (`defaultNonNullable`). For example, `SteamSettings.stopAtTemperature` is generated required.

**Small spec oddities** that did not trouble the generator:
- The KV parameters carry a non-standard `value: default` key.
- `exclusiveMinimum: true` is draft-04 style. That is legal in OAS 3.0 but breaks a draft-07 validator (Section 5).

### Does the output type-check under CafAI's settings?

The scratch config `tsconfig.cafai.json` copies CafAI's `tsconfig.json` with two changes: `skipLibCheck: false` and `types: []`.

```sh
node node_modules/typescript/bin/tsc -p tsconfig.gencheck.json --extendedDiagnostics
# exit=0 ; Check time 0.84 s ; 4 generated .ts copies + 2 .d.ts
```

- **Plain generation** passes under `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules` and `erasableSyntaxOnly`. The output contains only `export interface` / `export type`.
- **`--enum`** emits TS `enum`s. Under `erasableSyntaxOnly` that gives **99 × `TS1294`** (`gen/tsc-enumcheck.log`). Don't use it. `--enum-values` emits `const` arrays and is allowed.
- **`--root-types --root-types-no-schema-prefix`** works (107 aliases such as `export type ScaleCommandError = ...`). Note that it exports a type named `Error`.
- **File extension.** CafAI's real config has `skipLibCheck: true`, so **name the generated files `.ts`, not `.d.ts`**. A `.d.ts` would never be checked.

---

## 2. WebSocket types from the AsyncAPI 3 spec

### Facts about `websocket_v1.yml`

- It is **self-contained**. There are no `$ref`s into `rest_v1.yml`, so these schemas are duplicated: `MachineSnapshot`, `ShotSettings`, `WaterLevels`, `ConnectionError`, `DeviceConnectResult`, and `ScaleSnapshot` (which is `WeightSnapshot` under another name).
- **The duplicates disagree with the REST spec:**
  - WS `MachineState` lists a non-existent `transportMode` and lacks 7 real states.
  - WS `ShotSettings` uses `number` where REST uses `integer`.
  - WS `DeviceInfo` requires name/id/state/type; REST `DeviceInventory` requires nothing.
- The schemas use the OpenAPI-3.0 **`nullable: true`** keyword throughout. `DeviceConnectResult.connectionError` is the one place that uses the JSON-Schema form `type: "null"`.
- `@asyncapi/parser` 3.6.3 validates both Decaid versions with **0 diagnostics** (`asyncapi-validate.mjs`, `gen/asyncapi-validate.*.log`). streamline's copy gets 1 info: it is AsyncAPI 3.0.0.
- **Operations are written from the client's point of view.** Server pushes are `action: receive` and commands are `send`. Under AsyncAPI 3 semantics, a document that describes the server has these inverted. That only matters for AsyncAPI code generators (Modelina, templates); my channel map is labelled to match.

### Approach B (recommended): `ws-gen-openapi.mjs`

The script does four things:
1. Parses the YAML.
2. Wraps `components.schemas` as `{openapi: 3.0.3, paths: {}, components: {schemas}}`.
3. Calls `openapiTS()` and `astToString()` from CafAI's openapi-typescript.
4. Appends a channel map built from `channels` → `messages` → `payload.$ref` and from `operations[].action`.

```sh
node ws-gen-openapi.mjs specs/websocket_v1.af4e995.yml gen/ws_v1.af4e995.d.ts
# wrote gen/ws_v1.af4e995.d.ts: 27 schemas, 15 channels   (385 lines, 20.6 KB; a45961b identical size class; streamline 25/13)
```

The output keeps the REST file's naming (`components["schemas"]["ShotStateEvent"]`) and adds:

```ts
export interface WsReceive {
  "ws/v1/machine/snapshot": components["schemas"]["MachineSnapshot"];
  "ws/v1/scale/snapshot": components["schemas"]["ScaleSnapshot"] | components["schemas"]["ScaleStatus"];
  "ws/v1/machine/shotState": components["schemas"]["ShotStateEvent"];
  "ws/v1/devices": components["schemas"]["DevicesState"] | components["schemas"]["DeviceConnectResult"];
  // ... 15 channels
}
export interface WsSend { "ws/v1/devices": components["schemas"]["DevicesCommand"]; /* raw, display, update */ }
```

How the special cases come out:
- `nullable` → `| null`.
- `type: "null"` → `null`.
- `allOf: [ConnectionError] + nullable` → `ConnectionError | null`.

The output type-checks under CafAI's settings (Section 1 run).

### Approach A (works, not recommended): `ws-gen-jsts.mjs`

The route is `@asyncapi/parser` (validates and resolves `$ref`s; named schemas are kept through `x-parser-schema-id` → `title`), then `json-schema-to-typescript` `compile()`.

- **As is** (`gen/ws_v1.jsts.af4e995.d.ts`), the output is **wrong on nullability**. json-schema-to-typescript ignores `nullable`, which gives:
  - `shotId?: string`
  - `machineState?: string`
  - `battery?: number`
  - `batteryLevel: number` (required and non-null, but Dart sends null)
  - `decision?: {...}` with no `| null`
- **With `--nullable`** (my pre-pass converts `nullable: true` → `anyOf [X, {type: null}]`; `gen/ws_v1.jsts-nullable.af4e995.d.ts`), the result matches Approach B.

Remaining downsides of Approach A:
- Top-level names collide with the REST types and with globals: it emits `export interface Error`.
- The parser adds 183 packages and logs a `punycode` deprecation warning on Node 24.
- It needs a second generator besides the one CafAI already has.

**Conclusion:** use Approach B. Run `@asyncapi/parser` once, out of band, only if you want to lint the AsyncAPI file. Validating the file is Decaid's job.

---

## 3. Conformance check: spec types vs CafAI types

### How it is built (`conformance/`)

| File | Contents |
|---|---|
| `diff.ts` | <ul><li>`Diff<From, To>`: a recursive, type-level diff. It emits messages of the form `path: optional in source, required in target`, `path: absent in source`, `path: null not accepted` and `path: 'x' not accepted`, recursing through objects, arrays and nullable unions.</li><li>`Extra<From, To>`: keys `From` has that `To` does not declare.</li><li>`EnumDrift<Spec, Ours>`: uses `Known<>` to strip CafAI's `(string & {})`.</li><li>`Exactly<Actual, Known>` and `Assert<T extends true>`.</li></ul> |
| `spec.ts` | Path-based accessors into `generated/rest_v1.ts` and `generated/ws_v1.ts`. |
| `diffs.ts` | <ul><li>45 raw checks.</li><li>CafAI is imported by absolute path (`import type * as C from 'src/api/types.ts'`, plus `coach/types.ts` and `api/grinders.ts`). This resolves fine under `moduleResolution: bundler`.</li><li>**Reads** are `Diff<SpecResponse, CafaiType>` and **writes** are `Diff<CafaiRequest, SpecBody>`.</li></ul> |
| `checks.ts` | <ul><li>Each raw diff is asserted equal to its **known drift**, for example `Assert<Exactly<D.Diff_GET_shot, K_Shot<''>>>`.</li><li>Every exception sits next to its reason and its Dart `file:line`.</li><li>Reusable fragments with path prefixes keep it compact: `K_Workflow<'items[].workflow.'>`.</li></ul> |
| `print-diffs.mjs` | Uses the TS compiler API to print every `Diff_*` alias as a list (`gen/diffs.raw.af4e995.txt`, 447 lines of findings). |
| `run-conformance.sh` | Takes a REST + WS spec pair, regenerates `conformance/generated/`, then runs `tsc -p tsconfig.checks.json`. |

### What it covers

- **REST reads:**
  - `GET` info, machine/info, machine/state, capabilities, settings, devices, devices/scan, workflow, profiles, profiles/{id}, shots, shots/latest, shots/{id}, grinders.
  - `POST` heartbeat; profiles (201).
  - `PUT` workflow (200), profiles/{id} (200), shots/{id} (200).
  - KV list and get, the KV status codes, and the error body.
- **WS reads:** machine/snapshot, shotSettings, waterLevels, scale/snapshot (weight and status frames), shotState, devices.
- **REST writes:**
  - `PUT` workflow, profiles/{id}, shots/{id}, machine/state/{newState}, devices/connect.
  - `POST` profiles, machine/profile.
- **Enum drift:** MachineState (REST and WS), MachineSubstate (REST and WS), device state and type, shot state and event, decision kind, connection phase, visibility.

### Results

```sh
./run-conformance.sh specs/rest_v1.af4e995.yml specs/websocket_v1.af4e995.yml   # exit=0  (gen/conformance.af4e995.log)
./run-conformance.sh specs/rest_v1.a45961b.yml specs/websocket_v1.a45961b.yml   # exit=2
  checks.ts(141,40): error TS2344: Type '{ unexpected: "CafAI only: grinder"; }' does not satisfy the constraint 'true'.
node mutate-spec.mjs && ./run-conformance.sh specs/rest_v1.mutated.yml specs/websocket_v1.mutated.yml   # exit=2
  checks.ts(62,37): ... '{ unexpected: "pressure: null not accepted"; }'                         <- MachineSnapshot.pressure made nullable
  checks.ts(75,29): ... '{ unexpected: "items[].createdAt: absent in source"; }'                 <- ShotRecordSummary.createdAt removed
  checks.ts(76,36): ... '{ unexpected: "v.createdAt: absent in source"; }'
  checks.ts(77,28)/(78,32): '{ unexpected: "measurements[].machine.pressure: null not accepted"; }'
  checks.ts(95,32): ... '{ stale: "currentLevel: optional in source, required in target" | "refillLevel: ..." }'  <- spec FIX detected
  checks.ts(96,32): ... '{ unexpected: "weightFlow: absent in source"; }'                       <- WS weightFlow renamed flowRate
```

**Cost:** `tsc` on the checks takes 9.1 s in total (7.2 s of checking, 332 k instantiations, 304 MB, 169 files). Most of that comes from the deep `Diff` over shot records and from pulling in CafAI's modules.

### Mismatch table (af4e995; raw output in `gen/diffs.raw.af4e995.txt`)

Classes:
- **SPEC GAP:** the spec omits `required`; Dart always sends the key.
- **SPEC DRIFT:** the spec contradicts Dart.
- **CAFAI NARROWER / LOOSER:** a deliberate CafAI choice, consistent with Dart.
- **CAFAI BUG:** none found.

| # | Where (CafAI type ← spec) | Mismatch | Dart truth (af4e995) | Class |
|---|---|---|---|---|
| 1 | `MachineSnapshot` (REST and WS; also `measurements[].machine`) | All 12 keys plus `state.state`/`state.substate` are optional in the spec. | `toJson` always emits them (`models/device/machine.dart:97-112`). | SPEC GAP |
| 2 | `MachineInfo` | version/model/serialNumber/GHC are optional in the spec. | Always emitted (`machine.dart:26-34`). | SPEC GAP |
| 3 | `ShotSettings` (WS) | All 8 keys optional. | Always emitted (`models/device/de1_interface.dart:147-158`). | SPEC GAP |
| 4 | `WaterLevels` (WS) | Both keys optional. | `de1_interface.dart:228-229` | SPEC GAP |
| 5 | `WeightSnapshot` (WS `ScaleSnapshot`; `measurements[].scale`) | All 5 keys optional. | Always emitted; battery and timerValue may be null (`controllers/scale_controller.dart:316-324`). | SPEC GAP |
| 6 | `ScaleWsFrame` status frame | `status` optional. | `sendStatus()` (`services/webserver/scale_handler.dart:244-275`). | SPEC GAP |
| 7 | `ShotStateEvent` | shotId, machineState, machineSubstate, profileFrame and decision optional, plus decision.kind/reason/details/data. | Every key emitted, null when absent (`models/data/shot_state_event.dart:45-50, 89-101`). | SPEC GAP |
| 8 | `DevicesState` | `connectionStatus` and its 5 keys optional; `devices[].available` optional. | Always emitted (`services/webserver/devices_handler.dart:139-184, 858-864`). | SPEC GAP |
| 9 | `DevicesState.connectionStatus.error` | deviceId/deviceName/suggestion/details: spec has `?: string \| null`; CafAI has them required and `\| null`. | `ConnectionError.toJson` **omits** them when null (`controllers/connection_error.dart:53-63`). `frames.ts` normalises absent → null. | CAFAI NARROWER (CafAI's type is the *parsed* shape; the header claims "wire types") |
| 10 | `DeviceEntry` (REST `GET /devices`, `/devices/scan`) | All 5 keys optional (`DeviceInventory` has no `required`). | `devices_handler.dart:858-864` | SPEC GAP |
| 11 | `Workflow.id` | **Absent** in the spec's `WorkflowRequest`. | `Workflow.toJson` always sends `id` (`models/data/workflow.dart:95-107`). | **SPEC DRIFT** |
| 12 | `Workflow` name/description/profile/steamSettings/hotWaterData/rinseData | Optional in the spec. | Always emitted (`workflow.dart:95-107`). | SPEC GAP |
| 13 | `WorkflowContext` targetDoseWeight, targetYield, targetWaterVolume, finalBeverageType, baristaName, drinkerName, extras | The spec allows `null`; CafAI does not. | Every key is **omitted** when null (`models/data/workflow_context.dart:65-81`). | CAFAI NARROWER (correct) |
| 14 | `WireProfile` author, notes, beverage_type, version, target_volume, target_weight; `steps[].exit/limiter/weight` | Optional in the spec. | All emitted; exit, limiter and weight as explicit `null` (`models/data/profile.dart:93-106, 265-281, 352-367`). | SPEC GAP |
| 15 | `ProfileRecord.parentId`, `metadata` | Optional in the spec. | Always emitted, possibly null (`models/data/profile_record.dart:136-148`). | SPEC GAP |
| 16 | `ShotRecord(Summary)` id, timestamp, createdAt, updatedAt, workflow, measurements; `ShotSnapshot` machine/scale/volume | Optional in the spec. | Always emitted (`models/data/shot_record.dart:50-76`; `shot_snapshot.dart:23-28`). | SPEC GAP |
| 17 | `ShotRecord.annotations` (and its 7 fields), `stopReason` | The spec allows `null`. | Omitted when null (`shot_record.dart:58-63`; `shot_annotations.dart:45-55`). | CAFAI NARROWER (correct) |
| 18 | `Grinder` (`src/api/grinders.ts`): burrs, burrSize, burrType, notes, settingValues, the 4 steps, extras | The spec allows `null`. | Omitted when null (`models/data/grinder.dart:113-132`). | CAFAI NARROWER (correct) |
| 19 | `DecaidErrorBody` vs spec `Error {e, st}` | error/message/details/type are absent in the spec, and `e` is never sent. | Handlers send `{error, message?}`, `{details, type}` or `{error, st}` (02-api.md §12; for example `kv_store_handler.dart`, `de1handler.dart`). | **SPEC DRIFT** |
| 20 | KV status codes | The spec says: missing key → 404, POST → 204, DELETE → `{deleted}`. | 200 `null`, 200 `{}`, 200 `{}` (`services/webserver/kv_store_handler.dart:18-54`). | **SPEC DRIFT** |
| 21 | **Write:** `ProfileStep.exit/limiter = null` (`PUT /workflow`, `POST /profiles`, `PUT /profiles/{id}`, `POST /machine/profile`) | The spec's `exit`/`limiter` are non-nullable `$ref`s. | Emitted as null, and `fromJson` accepts null (`profile.dart:249, 257, 336, 344`). | **SPEC DRIFT** |
| 22 | **Write:** `POST /machine/profile` with `version: null` (CafAI posts the profile exactly as Decaid returned it) | The spec's `Profile.version` is a non-null string. | `parseOptionalString(json['version'])` (`profile.dart:74`). | **SPEC DRIFT** |
| 23 | **Write:** `WorkflowPatch.hotWaterData` / `rinseData` declared `Partial<>` | The spec's patch reuses the full schemas, where all fields are required. | The PUT deep-merges before parsing (`data/json_utils.dart:3-30`), so partial objects are valid. | SPEC DRIFT (needs patch schemas); CAFAI LOOSER (deliberate) |
| 24 | Enum: REST `MachineState` | The spec lacks `schedIdle`. | Present (`machine.dart:139-161`). | SPEC DRIFT |
| 25 | Enum: WS `MachineState` | The spec has `transportMode`, which does not exist, and lacks busy, schedIdle, steamRinse, calibration, selfTest, airPurge and fwUpgrade. | `machine.dart:139-161` | SPEC DRIFT |
| 26 | Enum: `MachineSubstate` (both specs) | `cleaingGroup` typo; CafAI uses `cleaningGroup`. | `machine.dart:170` | SPEC DRIFT |
| 27 | Enum: REST `MachineSubstate` | 18 `error*` substates that CafAI does not list. | `machine.dart:180-197` | CAFAI NARROWER (its union is open, so this is harmless) |

### Read and write checks with zero mismatches

- **Reads:** `/info`, `/machine/capabilities`, `/settings`, KV list and get.
- **Writes:** `PUT /shots/{id}`, `PUT /machine/state/{newState}` (`CommandableState` ⊂ the REST `MachineState`), `PUT /devices/connect`.
- **Enums:** device state and type, shot state and event, decision kind, phase, visibility.

### Not visible to a type-level diff

These were found only by the ajv run in Section 5:

- **The spec is stricter than Dart, and CafAI is already loose.** `ShotSnapshot.scale` is a non-nullable `WeightSnapshot` in the spec, but Dart sends `"scale": null` when there is no scale (`shot_snapshot.dart:23-28`). CafAI's `scale: WeightSnapshot | null` is correct, and the diff stays silent because spec → CafAI assigns.
- **Format and range constraints**, such as `format: date-time` and the 0..10 range of `enjoyment`.

---

## 4. Spec diffs

`spec-diff.mjs` is a structural diff of schemas and operations; `--nodesc` ignores description and example text.

### a45961b → af4e995 (Decaid)

| Spec | Schemas | Operations | Changes that matter to CafAI |
|---|---|---|---|
| REST | +3: GrinderSettingDescriptor, GrinderRpmDescriptor, PluginDeviceSurface | +0 / −0 / ~0 | <ul><li>`+ WorkflowContext.properties.grinderBurrs = {"type":"string","nullable":true}`</li><li>`+ WorkflowContextPatch.properties.grinderBurrs = {"type":"string","nullable":true}`</li></ul> |
| WS | – | – | `~ DeviceInfo.properties.type.enum: ["machine","scale","sensor"] -> [...,"grinder"]` |

Other REST changes, which do not matter to CafAI:
- GrinderInfo gained `controls`.
- PluginManifest gained grinder `controls` and `surfaces`.
- Descriptions changed.

**Impact on CafAI's types:**
- `grinderBurrs` is additive and optional. Dart added it to `WorkflowContext` (`workflow_context.dart` diff) and also folds legacy `grinder.burrs` into it (`workflow.dart:53,66`). CafAI doesn't model it. That is harmless: PUT `context` is merged per key, so the value survives. The mock does not resolve it from `grinderId`, which is a small mock gap.
- `grinder` was already in CafAI's `DeviceEntry.type`. The a45961b run shows it as the one expected `{unexpected: "CafAI only: grinder"}`.
- Dart changes in the same window that touch CafAI's models: only `workflow.dart` and `workflow_context.dart` (`git diff --stat a45961b af4e995 -- lib/src/models lib/src/services/webserver lib/src/controllers`).

### streamline-js copies vs Decaid

`gen/specdiff.rest.streamline-a45961b.txt` has the details.

**They match no Decaid commit in the shallow history** (blob `6c9fc57…` for REST, `8287164…` for WS), and **they are older than a45961b**:

- **REST:**
  - It lacks 10 operations: `GET /scale/info`, `PUT /scales/{id}/tare`, all of `/grinder/*`, `GET /bean-batches`, `GET /diagnostics/ble`.
  - It lacks 13 schemas, including `DeviceInventory`, `ShotUpdateRequest` and `WorkflowContextPatch`.
  - `PUT /shots/{id}` takes a full `ShotRecord`.
  - `GET /devices` state is only `connected|disconnected`.
  - Shots have no `createdAt`/`updatedAt`.
  - `MachineSubstate` lacks `pausedSteam` and `puffing`.
  - `WorkflowContext` lacks `targetWaterVolume`.
  - `MachineInfo.extra` is untyped.
  - `WorkflowPatch.context` points at `WorkflowContext`.
  - **It crashes openapi-typescript 7.13.**
- **WS:**
  - AsyncAPI 3.0.0.
  - No `GrinderSnapshot` or `ScaleSnapshotById` channels.
  - No `connectionRole`.

Verdict: **stale; don't use them as a source.**

---

## 5. Validating payloads against the spec schemas

**Dialect.** Decaid's REST spec is **OpenAPI 3.0.3**, not 3.1, so its schemas are not plain JSON Schema:
- `nullable` is used.
- `exclusiveMinimum: true` is draft-04 style.
- `example`, `deprecated` and `x-*` keys appear.

**Converter.** `validate-examples.mjs` turns these into draft-07 for ajv 8:
- `$ref` `#/components/schemas/X` → `#/definitions/X`.
- `nullable` → `type: [t, "null"]`, or `anyOf [.., {type: null}]`.
- Boolean `exclusive*` → numeric.

The first ajv attempt without that fix failed with `schema is invalid: .../GrinderSettingDescriptor/oneOf/1/properties/step/exclusiveMinimum must be number`.

**Two passes:**
1. The spec as written, with `ajv-formats` on.
2. **Strict:** `additionalProperties: false` on every object that declares properties, to surface undocumented keys.

```sh
node validate-examples.mjs specs/rest_v1.af4e995.yml specs/websocket_v1.af4e995.yml   # gen/validate-examples.af4e995.txt
```

**Results on af4e995, as written:**

- **11 of 21 PASS:** machine-info, shot-settings, water-levels-ws, scale-status-ws, shot-state-ws, devices-ws, shot-update-request, heartbeat, build-info, error, error-block-no-scale.
- **10 FAIL**, all from two pieces of SPEC DRIFT:
  1. **`format: date-time`** on zone-less local timestamps such as `2026-09-29T12:53:54.216425`. These are not RFC 3339. Affected: `MachineSnapshot.timestamp`, `WeightSnapshot.timestamp`, `ProfileRecord.createdAt/updatedAt`.
     - Files: machine-state, machine-snapshot-ws, scale-snapshot-ws, profile-record, profiles-list, shot-record.
     - Dart: `DateTime.toIso8601String()` on local times (`machine.dart:99`, `scale_controller.dart:318`, `profile_record.dart:145-146`).
  2. **`steps[].exit` / `limiter: null` → "must be object".**
     - Files: workflow-get, workflow-put-request, profile-create-request, profile-record, profiles-list, shot-record, shots-list.

**The strict pass adds:**
- `devices-ws`: `charging` (sent only on battery platforms, `devices_handler.dart:155-157`).
- `workflow.id` in workflow-get, shot-record and shots-list.
- `error.json`: `error`, `message`.

**Not validated:**
- `kv-get.json`: the value is CafAI-shaped, and the spec schema is `{}`.
- `error-machine-not-connected.json`: no schema fits it.

**The MSW mock.** I reasoned from the code and did not run it.
- `mock/fixtures/*.json` are **byte-identical** to `docs/verified/examples/*.json` (23 of 23, checked with `cmp`). They are typed through `mock/fixtures/index.ts` as CafAI's own types.
- The stateful mock (`mock/decaid/state.ts`, `workflow.ts`, `profiles.ts`, `machine.ts`) is also typed with `src/api/types.ts`. Handlers send `json(body: unknown)` (`handlers.ts:66-67`).
- So fixture-backed responses validate exactly as above. Generated responses use `formatLocalTimestamp`, step `exit: null` and so on, so they should fail in the same Dart-faithful ways.
- **The mock cannot reveal CafAI-vs-Decaid drift on its own**, because its types *are* CafAI's.
- The useful addition is a vitest contract test that runs mock responses and WS frames through the same ajv validators, with the same allow-list (date-time on local timestamps, null exit/limiter, `workflow.id`, `charging`, error body). That catches runtime-only drift the type diff can't see (Section 3).

---

## 6. Recommended design for CafAI

### What to generate, and where

```
contract/decaid/                          (outside src/: type-only, never bundled)
  PIN                                     decaid commit sha + git blob shas of both specs + openapi-typescript version
  specs/rest_v1.yml, specs/websocket_v1.yml    vendored copies of the pinned specs (reproducible offline)
  generated/rest.ts                       openapi-typescript 7.13, default flags, NO --enum, .ts (not .d.ts: skipLibCheck)
  generated/ws.ts                         ws-gen-openapi approach: wrapped components.schemas + WsReceive/WsSend map
  diff.ts                                 Diff / Extra / EnumDrift / Known / Exactly / Assert   (this experiment's file)
  spec.ts                                 Res / Body / PathParams / Statuses accessors (path-based, rename-proof)
  drift.ts                                known-drift fragments; each = class tag + reason + Dart file:line + upstream issue
  checks/rest-read.ts, rest-write.ts, ws-read.ts, enums.ts, status.ts
  fixtures.contract.test.ts               ajv: docs/verified/examples + mock responses vs spec (same allow-list)
scripts/decaid-contract.mjs               --update <sha|path>  fetch specs, regenerate, rewrite PIN
                                          --check              regenerate to memory, fail if generated/ differs
tsconfig.contract.json                    extends tsconfig.json; include ["contract"]
```

**How generated code is used:**
- Generated types are used **only** by the checks.
- CafAI keeps its hand-written `types.ts` as the API it codes against. It is narrower, Dart-faithful and uses open enums.
- The spec stays an input to verify, not the source of truth, because the Dart code wins.

### Pinning

- `PIN` records the Decaid sha. Both generated files carry a header with that sha.
- `npm run contract:update -- <sha>` takes the specs from `git show <sha>:assets/api/*.yml` (local `.ref` clone) or the GitHub raw URL. It then regenerates and rewrites `PIN`, and the change is reviewed as an ordinary diff.
- `npm run contract:check` regenerates and diffs (openapi-typescript `--check` covers the REST file; the script covers WS). This catches hand-edits or a generator version bump.

### Assertions

- One `Assert<Exactly<Diff<…>, Known>>` per endpoint or channel. Use the `Diff<Spec, CafAI>` direction for reads and `Diff<CafAI, SpecBody>` for writes. For writes, filter out "absent in source (optional in target)".
- Path-based accessors mean a spec schema rename does not break the checks; a shape change does.
- Add `tsc -p tsconfig.contract.json` to `npm run typecheck`, which adds about 9 s. Then any edit to `src/api/types.ts` is checked against the pinned spec on every `verify`.

### Recording known drift

These are explicit exceptions in `drift.ts`, built from small template-literal fragments such as `Opt<P, K>`, `NullIn<P, K>` and `Absent<P, K>`, composed with path prefixes. Each one carries a tag:

| Tag | Meaning |
|---|---|
| `SPEC GAP` | Missing `required`. |
| `SPEC DRIFT` | The spec contradicts Dart; link an upstream issue. |
| `CAFAI NARROWER` / `CAFAI LOOSER` | Deliberate. |
| `CAFAI PARSED TYPE` | CafAI's type is the normalised shape. |

`Exactly` fails on **unexpected** members, which means new drift and needs a review. It also fails on **stale** members, which means Decaid fixed something, so the exception has to be deleted. The exception list therefore cannot rot.

**Upstream.** One Decaid PR would remove about 90% of the exceptions. It would:
- Add `required` arrays (rows 1-8, 10, 12, 14-16).
- Add `id` to `WorkflowRequest`.
- Make `ProfileStep.exit`/`limiter` and `Profile.version` nullable.
- Fix the `MachineState` lists and the `cleaingGroup` typo.
- Document the KV statuses and the real error bodies.
- Add `charging` to `DevicesState`.
- Use a plain `string` (or a pattern) instead of `format: date-time` for local timestamps.
- Add `HotWaterDataPatch` / `RinseDataPatch`.

### CI

**1. Blocking, on every PR.** Run `npm run typecheck` (main tsconfig plus `tsconfig.contract.json`), `npm run contract:check` and the vitest fixture contract test. These all use the pinned spec.

**2. Non-blocking, scheduled daily against Decaid `main`:**

```sh
git clone --depth 1 https://github.com/<org>/decaid.git /tmp/decaid      # or fetch the two raw files
node scripts/decaid-contract.mjs --update /tmp/decaid/assets/api --no-pin   # generation must succeed (fail = spec broke the generator)
npx tsc -p tsconfig.contract.json                                            # prints {unexpected}/{stale} per endpoint
npx vitest run contract/decaid/fixtures.contract.test.ts                    # ajv vs latest schemas
node scripts/spec-diff.mjs contract/decaid/specs/rest_v1.yml /tmp/decaid/assets/api/rest_v1.yml --nodesc   # human summary
```

On failure it opens or updates an issue with the `tsc` output and the structural diff. A human then bumps the pin and adjusts `types.ts` or `drift.ts`.

### Tool versions

| Tool | Status | Works with TS 5.9.3 / Node 24? |
|---|---|---|
| openapi-typescript 7.13.0 | Already a devDependency. | Yes: verified here on Node 24.13.1 and TS 5.9.3. Its peer `typescript` (^5.x) is satisfied. Don't use `--enum` under `erasableSyntaxOnly`. |
| `yaml` ^2.9 | **Add** (zero dependencies). | Yes. Needed only for the WS wrapper and spec-diff scripts. |
| `ajv` ^8.20 + `ajv-formats` ^3.0 | **Add** only if the fixture/mock validation is adopted. | Yes. |
| `@asyncapi/parser`, `json-schema-to-typescript` | Do **not** add. Not needed. | – |

**Node version note.** This machine runs Node 24.13.1. CafAI's `engines` field asks for `^24.15.0`; the tools did not mind.

---

## Artifact index (all in `.ref/cafai-audit-typegen/`)

### Scripts

| Script | Purpose |
|---|---|
| `summarize-paths.mjs` | Lists operations with their request and response schemas. |
| `find-null-media.mjs` | Finds the null media type that crashes the generator. |
| `spec-diff.mjs` | Structural spec diff. |
| `asyncapi-validate.mjs` | Validates the AsyncAPI files. |
| `ws-gen-openapi.mjs` | Recommended WS generator. |
| `ws-gen-jsts.mjs` | Alternative WS generator (AsyncAPI parser + json-schema-to-typescript). |
| `print-diffs.mjs` | Prints the raw conformance diffs. |
| `run-conformance.sh` | Regenerates the types and runs the assertions. |
| `mutate-spec.mjs` | Builds the synthetic breaking spec. |
| `validate-examples.mjs` | ajv validation of the examples. |

### Other files

| Path | Contents |
|---|---|
| `conformance/` | `diff.ts`, `spec.ts`, `diffs.ts`, `checks.ts`, `generated/`. `generated/` currently holds af4e995. |
| `tsconfig.cafai.json` | CafAI's compiler options with `skipLibCheck: false`. |
| `tsconfig.gencheck.json` | Type-checks the generated files. |
| `tsconfig.enumcheck.json` | Type-checks the `--enum` variant. |
| `tsconfig.rootcheck.json` | Type-checks the `--root-types` variant. |
| `tsconfig.conformance.json` | Config used by `print-diffs.mjs`. |
| `tsconfig.checks.json` | Config used by `run-conformance.sh`. |
| `specs/` | a45961b, af4e995, streamline and mutated copies of both specs. |
| `gen/` | Generated `.d.ts` files and every log cited above. |

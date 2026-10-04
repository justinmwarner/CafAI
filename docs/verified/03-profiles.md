# 03 - Profile v2 JSON: verified field reference, limits, identity, and coach templates

**Source commits:** Decaid `a45961b323831d2170b3e7f3fef7c72fdd341642` (2026-10-01) · streamline-js `cb058cad8a08904889b817de944566dfe1dd8a9a` (v0.2.7) · decaid-mcp `aecef96b870e4f3567ed5f08c876f77adf25f5a7` · Crema (prior art, GPL-3) `628cd714fa1a3a5194ea0e4c579d54ae1e38353c`. Secondary source: `docs/RESEARCH.md` §3. Paths are relative to each repo root (`.ref/decaid`, `.ref/streamline-js`, `.ref/decaid-mcp`, `crema`). Where a repo and RESEARCH.md disagree, the repo wins (see §10).

## 0. Verdicts

- **Numbers.** Decaid accepts every numeric profile field as a JSON number *or* a numeric string (`lib/src/models/data/utils.dart:1-18`). It stores and returns JSON numbers: records are persisted as `profile.toJson()` (`lib/src/services/database/mappers/profile_mapper.dart:35`), and `toJson` emits Dart `double`/`int` values (`lib/src/models/data/profile.dart:93-106`, `265-280`, `352-367`). Only the bundled asset files use strings, a de1app holdover. **CafAI sends JSON numbers.** `context.targetYield` *must* be a number, because a string gets a 400 (`doc/AI_API_NOTES.md:66-70`).
- **Required on create:** non-empty `title`, non-empty `steps`, `tank_temperature`, `target_volume_count_start` (`profile.dart:59-72`). Every step also needs `name, pump, transition, sensor, temperature, seconds, volume` plus `pressure` or `flow` for its pump type.
- **Stop-at-weight reads the workflow's `context.targetYield`, not the profile's `target_weight`** (`lib/src/controllers/de1_state_manager.dart:820-821`; `doc/Api.md:300-301`, which says "`targetYield` is the single source of truth for stop-at-weight").
- **Identity:** `id = "profile:" + sha256(sortedKeyJson({version, beverage_type, steps, tank_temperature, target_weight, target_volume, target_volume_count_start}))[0:20]` (`lib/src/models/data/profile_hash.dart:6-23`). Title, notes and author never change the id. Step **names** do.
- **No range validation.** Decaid does not range-check any profile number. The DE1 encoder silently wraps values it cannot represent. For example, a 16 bar target becomes byte 0, which is 0 bar (`lib/src/models/device/impl/de1/unified_de1/unified_de1.profile.dart:47`). CafAI must enforce the limits in §5 itself.
- **Templates copied:** `Blooming_espresso.json` (blooming), `D-Flow____default.json` (D-Flow), `Londonium.json` (lever), `rao_allonge.json` (allongé) and `Gentle_and_sweet1.json` (low pressure). They are in `src/coach/templates/source/` and are byte-identical to the commit's git blobs.

## 1. Where the truth lives (Decaid)

| Concern | File |
|---|---|
| Profile and step model, JSON parse/serialize | `lib/src/models/data/profile.dart` |
| Lenient number/string parsing | `lib/src/models/data/utils.dart` |
| Content hash, metadata hash, compound hash | `lib/src/models/data/profile_hash.dart` |
| Record envelope (id, parentId, visibility, isDefault, metadata) | `lib/src/models/data/profile_record.dart` |
| REST create/update/list/lineage | `lib/src/services/webserver/profile_handler.dart` |
| Dedupe, default protection, seeding, lineage | `lib/src/controllers/profile_controller.dart` |
| BLE wire encoding (the hard numeric limits) | `lib/src/models/device/impl/de1/unified_de1/unified_de1.profile.dart` |
| Shot-time semantics (SAW, step weight exits, volume fallback) | `lib/src/controllers/shot_sequencer.dart`, `step_exit_arbiter.dart` |
| Workflow PUT deep-merge | `lib/src/services/webserver/workflow_handler.dart:182-183`, `lib/src/models/data/json_utils.dart:3-29` |
| OpenAPI schema | `assets/api/rest_v1.yml:6389-6530` (Profile, ProfileStep, StepExitCondition, StepLimiter), `:7816` (ProfileRecord) |
| Bundled profiles | `assets/defaultProfiles/` (73 profiles + `manifest.json` = 74 files; manifest and disk agree) |
| TCL/JSON → bundled-format converter | `tools/ingest_profiles.py` |

`lib/src/import/parsers/profile_v2_parser.dart:5-8` is a thin wrapper that calls `Profile.fromJson` and then `ProfileRecord.create`. `tcl_profile_parser.dart:63-75` builds a string-valued v2 map from legacy TCL and runs it through the same `Profile.fromJson`.

## 2. Profile-level fields

The "Bundled type" column is a census of all 73 bundled files. The "GET type" column is what `Profile.toJson` emits, which is what every REST GET and the workflow return.

| Field | Bundled type | Dart model → GET type | Create | Default if absent | Values / meaning | In id hash |
|---|---|---|---|---|---|---|
| `version` | string `"2"` (71), `null` (2) | `String?` → string/null | optional | `null` | Free-form format tag. Bundled files use `"2"`, the Decent Profile Generator plugin uses `"2.1"` (`assets/plugins/decent-profile.reaplugin/plugin.js:354`), and Decaid's built-in default uses `"1.0"` (`lib/src/controllers/workflow_controller.dart:77`). A number is coerced with `toString()` (`utils.dart:20-25`), so `2.0` becomes `"2.0"`, which is a different hash. It is not a revision counter. | yes |
| `title` | string | `String` → string | **required, non-empty** (`profile.dart:60-61`) | only `fromRecordedJson` falls back to `"Unknown profile"` | display name; not unique | no (metadata hash) |
| `notes` | string | `String` → string | optional | `''` (`profile.dart:76`) | prose | no (metadata hash) |
| `author` | string | `String` → string | optional | `''` (`profile.dart:77`) | attribution | no (metadata hash) |
| `beverage_type` | string | enum → string | optional | `espresso` | `espresso, calibrate, cleaning, manual, pourover` (`profile.dart:144`). Matching is case-insensitive, and an unknown value **silently** becomes `espresso` (`profile.dart:146-153`). Bundled: espresso 47, pourover 22, cleaning 2, manual 2. | yes |
| `steps` | array | `List<ProfileStep>` → array | **required, non-empty** (`profile.dart:63-64`) | — | see §3 | yes (each step's full `toJson`, including `name`) |
| `tank_temperature` | string (71), number (2) | `double` → number | **required, non-null** (`profile.dart:66-67`) | — | °C threshold to pre-heat the water tank, 0 = off. Written as `.round()` to MMR `0x0080380C` "Tank water temp threshold." on every profile upload (`unified_de1.profile.dart:8`; `de1.models.dart:245`). Bundled: 0 for all espresso profiles, 30/35 for some pour-overs. **Not a brew temperature.** | yes |
| `target_weight` | string (71), number (2) | `double?` → number/null | optional | `null` | Recipe yield in grams. **No stop logic reads it** (§6.4). | yes |
| `target_volume` | string (71), number (2) | `double?` → number/null | optional | `null` | ml. App-side volumetric fallback only (§8.2). | yes |
| `target_volume_count_start` | integer string (71), number `2.0` (2) | `int` → integer | **required, non-null** (`profile.dart:69-70`) | — | Number of leading "preinfusion" frames (§8.2). `parseInt` accepts an int, a double (truncated) or an *integer* string. The string `"2.0"` throws a FormatException and returns 400 (`utils.dart:14-18`). | yes |

**Extra keys in bundled files.** All of these are ignored by `Profile.fromJson` and dropped on GET:

- `type`: 73 files. Values are `advanced` (61), `pressure` (8) and `flow` (4).
- `hidden`: 73 files. The value is `"0"` in 71 and `null` in 2.
- `legacy_profile_type`: 20 files. Values are `settings_2c` (13), `settings_2a` (4) and `settings_2b` (3).
- `lang`: 20 files. Values are `en` (19) and `kr` (1).
- `reference_file`: 20 files.
- `changes_since_last_espresso`: 20 files.
- `parent_id`: 1 file. `best_practice_v3.json:5` sets it to `"profile:b73ce54592d667d00b31"`. It is read **only** by default seeding (`profile_controller.dart:116`), never by `POST /api/v1/profiles`.

Two files (`advanced_spring_lever.json`, `baseline_ulc.json`) mix numeric top-level fields with string step fields, which shows that Decaid tolerates mixed types.

## 3. Step-level fields

The census covers 481 bundled steps. Every value of `name, pump, transition, temperature, sensor, seconds, volume, weight` is a string, and every step has all of them. `flow` appears in 478 steps, `pressure` in 476, `limiter` in 235 and `exit` in 176. There are no other step keys.

| Field | Dart type | Create | Meaning | Wire (DE1 frame) |
|---|---|---|---|---|
| `name` | `String` (`profile.dart:247`) | required. If missing: TypeError | step label; **hashed** | not sent |
| `pump` | discriminator (`profile.dart:209-219`) | required, `pressure` or `flow`. Anything else throws plain `Exception` | selects which target is parsed | flag `ctrlF 0x01` for flow (`unified_de1.profile.dart:179`) |
| `transition` | enum `fast, smooth` (`profile.dart:155`), parsed with `byName` (case-sensitive) | required | `fast` jumps to the target. `smooth` interpolates from the previous step's target over `seconds`. | flag `interpolate 0x20` (`:181`) |
| `sensor` | enum `coffee, water` (`profile.dart:157`) | required | which temperature the step controls; `water` targets mix temperature | flag `tMixTemp 0x10` (`:180`) |
| `temperature` | `double` | required | °C target for this step | `U8P1`: `(0.5 + T*2).toInt()` (`:49`) |
| `seconds` | `double` | required | maximum step duration | `F8_1_7` (`:51`, `:111-126`) |
| `volume` | `double` | required | maximum volume per frame, in ml. Bundled extraction steps use 0 for "no limit". The app never reads it. | `U10P0`: `x.toInt() \| 1024` (`:55`, `:152-160`) |
| `weight` | `double?` | optional | **app-side per-step weight exit.** If `> 0` and the projected scale weight is at or above it, the app sends `skipStep` (`shot_sequencer.dart:577-646`). 0 or null = off. | not sent |
| `pressure` | `double` | required iff `pump=pressure` | bar target | `U8P4` = `(0.5 + v*16).toInt()` (`:47`) |
| `flow` | `double` | required iff `pump=flow` | ml/s target | same byte as `pressure` |
| *(inactive target)* | ignored | — | Bundled files usually carry both `pressure` and `flow`. Only the active one is parsed or emitted (`profile.dart:265-280`, `352-367`). | — |
| `exit` | `StepExitCondition?` | optional. If present, `type`, `condition` and `value` are all required. | `{type: pressure\|flow, condition: over\|under, value}` (`profile.dart:159-161`, `400-425`) | flags `doCompare 0x02`, `dcGT 0x04` (over), `dcCompF 0x08` (flow) (`:183-188`). Trigger byte is `U8P4` (`:53`). |
| `limiter` | `StepLimiter?` | optional. If present, `value` and `range` are required. | On a **pressure** step, `value` = max **flow** in ml/s. On a **flow** step, `value` = max **pressure** in bar. `range` is the softness band (0 = hard clamp). Sources: `.ref/streamline-js/src/modules/profile-field-limits.js:23-24, 47-49`; simulator `mock_de1.dart:34-43, 362-390`. | Extension frame `32+i`: value and range in `U8P4`. **Skipped entirely when `value == 0`** (`:60-83`). |

**Step semantics (confirmed):**

- **Exit cardinality.** A step has at most **one firmware exit object** (a single `exit` field, one trigger byte and one set of compare flags). It can also end on `seconds`, on its per-frame `volume`, or on the app-owned `weight`, whichever comes first. If a step defines both `weight` and `exit`, either can trigger (`doc/Profiles.md:15-30`).
- **Absent exit.** An omitted exit and `"exit": null` mean the same thing (`profile.dart:249-251`). GET emits an explicit `"exit": null`, `"limiter": null` and `"weight": null` (`profile.dart:270-277`). Live evidence is `.ref/decaid-mcp/test/fixtures/workflow.json`, captured from Decaid 0.8.6.
- **Non-positive exit value.** An exit value of 0 or less is treated by the step-exit arbiter as weight-only (`step_exit_arbiter.dart:26-31`). TurboBloom uses `flow under 0.0` as a never-firing exit.
- **Weight exits need a scale.** They also need Decaid not to be in gateway mode `full` (`bypassSAW`, `de1_state_manager.dart:824`). The default mode is `disabled` (`lib/src/settings/settings_controller.dart:21`).
- **Header and tail.** The header always sends min pressure 0 and max flow 12 ml/s (`:24-26`), and every frame sets `ignoreLimit 0x40` (`:177`). The tail's total-volume bytes are left at 0 (`:86-97`; test `test/models/device/unified_de1_bengle_profile_v2_test.dart:106-109`).

## 4. Parsing and error behaviour (POST/PUT `/api/v1/profiles`)

**Request shapes.**

- Create: `POST /api/v1/profiles` with body `{"profile": {...}, "parentId"?: "profile:…", "metadata"?: {...}}` (`profile_handler.dart:101-127`; `assets/api/rest_v1.yml:3598-3632`).
- Update: `PUT /api/v1/profiles/{id}` with body `{"profile"?, "metadata"?}`. `parentId` cannot be set on update.
- The body limit is 1 MiB (`lib/src/services/webserver/bounded_request_body.dart:10`).

**Where "Invalid request" comes from.** `ArgumentError` and `FormatException` both become a 400 with this body (`profile_handler.dart:130-133`):

```json
{"error": "Invalid request", "message": "Invalid argument(s): Profile must have \"tank_temperature\""}
```

The `message` is never bare. Crema showed a bare "Invalid request" because its `describeGatewayError` keeps only `.error` (`crema/web/src/gateway/client.ts:95-115`).

**How each failure maps to a status code:**

| Cause | Thrown by | POST status | PUT status |
|---|---|---|---|
| Missing or empty title or steps; missing `tank_temperature` or `target_volume_count_start` | ArgumentError | 400 | 400 |
| Invalid enum string (for example `"transition": "linear"`) | `byName`, ArgumentError | 400 | 400 |
| Unparseable number (`"hot"`, `""`, `"2.0"` for the int field) | FormatException | 400 | 400 |
| Unknown `parentId` | ArgumentError `Parent profile not found` (`profile_controller.dart:223-228`) | 400 | — |
| Missing required step field (`name`, `sensor`, `volume`, …) or `exit: {}` | TypeError | **500** (`_handleCreate` has no TypeError catch, `:128-137`) | 400 (`:175-176`) |
| Missing or unknown `pump` | plain `Exception` (`profile.dart:215-217`) | 500 | 500 |

Tests: `test/services/webserver/profile_handler_create_test.dart:85-171`. A profile using **JSON numbers** and no `target_volume`, `target_weight`, `notes` or `author` returns 201. Missing title, steps, `tank_temperature` or `target_volume_count_start`, or an unparseable number, returns 400.

## 5. Consolidated limits

### 5.1 Encodings

Machine-representable ranges are derived from `unified_de1.profile.dart`. DE1 uses `scale = 16` and Bengle uses `scale = 10` (`:13`, `:33`). Every byte is `(0.5 + v*scale).toInt()` stored into a `Uint8List`, so an out-of-range value wraps modulo 256 instead of clamping.

- **U8P4 (DE1):** 0 to 15.9375 in steps of 1/16 (0.0625).
  - `v >= 15.96875` wraps: 16.0 becomes byte 0, which is 0 bar.
  - A negative `v` wraps high: −1 becomes byte 241, which is 15.06.
  - Example: 2.2 ml/s is sent as 35/16 = 2.1875.
- **U8D1 (Bengle):** 0 to 25.5 in steps of 0.1 (`doc/Profiles.md:575-589`).
- **U8P1 temperature:** 0 to 127.5 °C in steps of 0.5 °C. 127.75 or above wraps.
- **F8_1_7 seconds** (`:111-126`):
  - 0 → 0.
  - Below 12.75 → 0.1 s resolution, up to 12.7.
  - From 12.75 to 127 → whole seconds (13–127).
  - Above 127 → clamped to 127.
  - Negative values wrap.
- **U10P0 volume** (`:152-160`):
  - The value is truncated (not rounded) to an integer from 0 to 1023, and bit `0x400` is always set.
  - Unlike `_for_tail`, there is no 1023 clamp, so 1024 or more corrupts the value.
  - The meaning of bit `0x400` is not documented in the repo.
- **Header:** `steps.length` and `target_volume_count_start` are single bytes (`:20-22`). Limiter extension frames are addressed as `32+i` and the tail as `N` (`:62`, `:89`), so 32 or more steps would collide in frame address space.

### 5.2 Table

| Field | Machine-representable | Decaid validation | streamline-js UI (`src/modules/profile-field-limits.js`, `profile_editor.js`) | **CafAI hard bound** (lever bounds in §9 are narrower) |
|---|---|---|---|---|
| step `temperature` | 0–127.5 °C, 0.5 resolution; wraps above 127.5 | none | 0–105, step 0.5 (`:18`) | 80.0–100.0 per step for these templates; multiples of 0.5 |
| step `pressure` (target) | DE1 0–15.94 (1/16); Bengle 0–25.5 | none | 0–12, step 0.1 (`:22`) | 0–11 bar; levers ≤ 10 |
| step `flow` (target) | same as pressure | none | 0–15, step 0.1 (`:19`) | 0–8 ml/s; levers ≤ 3.5, except the Rao Allongé flow (≤ 5.5) |
| `exit.value` (pressure) | U8P4 0–15.94. App treats ≤ 0 as "weight-only" (`step_exit_arbiter.dart:26`). | none | 0–12, step 0.1 (`:45`) | 0–10 bar; levers 2–6 |
| `exit.value` (flow) | U8P4 0–15.94 | none | 0–8, step 0.1 (`:45`) | 0–6 ml/s; fixed in templates |
| `limiter.value` on pressure step (max flow) | U8P4. 0 = limiter not sent. | none | 0–8, step 0.1 (`:23`) | 0–8; fixed in templates |
| `limiter.value` on flow step (max pressure) | U8P4 | none | 0–12, step 0.1 (`:24`) | 0–11; levers 6–10 (D-Flow, Rao Allongé) |
| `limiter.range` | U8P4 | none | 0–5, step 0.1 (`profile_editor.js:1693`); default 0.6 (`:50`) | fixed (template value) |
| step `seconds` | 0–12.7 @0.1 s, 13–127 @1 s, above 127 clamps | none | 0–127, step 1 (`:31`) | 0–127; levers whole seconds |
| step `volume` | 0–1023 ml integer (truncated); 1024+ corrupts | none | 0–500, step 1 (`:32`) | fixed (template value); never > 1023 |
| step `weight` | not sent (app-side) | none (> 0 enables) | 0–500, step 1 (`:25`) | 0 or 1–20 g; lever 2–8 g (D-Flow) |
| `target_weight` | not sent; hashed | none (nullable) | 0–1000, step 0.1 (`profile_editor.js:1707`) | 15–120 g, or up to the template's own `target_weight` if that is higher (Rao Allongé: 15–135 g); levers ratio-bounded; always mirrored to `context.targetYield` |
| workflow `context.targetYield` | Bengle: firmware SAW register; DE1: app SAW | must be a JSON number; explicit null → 400; 0 = off (`doc/Api.md:298-306`) | tile | = `target_weight` |
| `target_volume` | not sent (tail bytes 0) | none (nullable) | 0–500, step 1 (`profile_editor.js:1710`) | fixed (template value) |
| `target_volume_count_start` | header byte | required; integer (`utils.dart:14-18`) | step picker 0..N (`profile_editor.js:1669-1672`) | fixed (template value); ≤ step count |
| `tank_temperature` | MMR int32, `.round()` | required; no range check | 0–110, step 1 (`profile_editor.js:1667-1668`) | fixed (template value; 0 for espresso) |
| step count | header byte; frame-address collision at 32 or more; de1app convention ≤ 20 | ≥ 1, no maximum | no cap | fixed (template); never above 20 |

**The one template-specific bound.** Rao Allongé ships `target_weight` 135 g (`rao_allonge.json:41`), above the generic 120 g, and an all-levers-at-template-values version must pass validation because it *is* the bundled default. The validator therefore raises the `target_weight` ceiling to the template's own `target_weight` when that is higher (`maxTargetWeight` in `src/coach/validator.ts`). This is safe because `target_weight` never reaches the machine: it is hashed, and stop-at-weight reads `context.targetYield` (§0). The other four templates ship 36–60 g, so their ceiling stays 120 g (tested). Every per-step bound is unchanged and applies to all five templates.

## 6. Identity, hashing and lineage

### 6.1 The three hashes

From `profile_hash.dart`:

- **Profile hash, which is the record id** (`:6-23`). SHA-256 over `jsonEncode` of a map containing `version, beverage_type, steps (each step.toJson()), tank_temperature, target_weight, target_volume, target_volume_count_start`. Keys are sorted recursively (`:59-75`), and the parsed (normalized) values are hashed. The id is `'profile:${hash.substring(0, 20)}'` (`:22`).
- **Metadata hash.** SHA-256 over `{title, author, notes}`; the full 64 hex characters (`:25-37`).
- **Compound hash.** SHA-256 of `"<profileHash>:<metadataHash>"` (`:39-45`).

### 6.2 Verification of the algorithm

I wrote a Python port of the algorithm, using Dart semantics: parse to double/int, keep only the active pump target, emit `exit`/`limiter`/`weight` as null when absent, sort keys, and use compact separators.

Its output for `best_practice.json` is `profile:b73ce54592d667d00b31`. That matches exactly the `parent_id` that Decaid's own `best_practice_v3.json:5` hard-codes as that file's content id.

### 6.3 What changes the id

These results come from the port, applied to edits of `D-Flow____default.json`:

| Edit | Id |
|---|---|
| change title, notes or author | **same** |
| drop extra keys (`type`, `hidden`, `lang`, …) | same |
| numeric strings → JSON numbers; `"0"` → `0.0` | same |
| drop the inactive pump key | same |
| `exit` absent ↔ `"exit": null` | same |
| rename a step | **different** |
| remove `version` | different |
| remove `target_volume` (null vs `0`) | different |
| remove a step's `"weight": "0.0"` (null vs `0.0`) | different |
| remove a `limiter {value: 0, range: 0.6}` (machine-identical) | different |
| `target_weight` 50 → 51 | different |

**Expected ids of the copied templates**, computed with the verified port:

- Blooming Espresso `profile:7438cb7266f60558b48f`
- D-Flow / default `profile:59036f8846b1ed3b4255`
- Londonium `profile:729d284747718d27c93a`
- Rao Allongé `profile:372f1be4c5e3641bbfe2`
- Gentle and sweet `profile:1baa29bd9d9dc6d47f2a`

The last two were computed by three separate ports (`src/coach/profileId.ts`, the mock gateway's `mock/decaid/profiles.ts`, and a Python script), which agree. Confirm these against a live Decaid with `GET /api/v1/profiles?includeHidden=true`. Defaults carry `metadata: {"source":"bundled","filename":…}` (`profile_controller.dart:51-55`).

**Porting gotcha.** Dart encodes an integral double as `93.0`. JavaScript `JSON.stringify(93)` gives `93`. A TypeScript port must format every double field Dart-style. `target_volume_count_start` is an int, so it encodes as `2`.

### 6.4 Create, update and lineage behaviour

**Create dedupes.** If the computed id already exists, `create` returns the **existing** record and stores nothing (`profile_controller.dart:236-242`). The response is still 201. The returned record keeps its own title, parentId, metadata, `isDefault` and visibility. That record may be a bundled default or a hidden or deleted record.

**Update (`PUT /api/v1/profiles/{id}`):**

- Defaults cannot take a `profile` at all, not even a title-only change. The request returns 400 "Cannot modify default profile content" (`:262-264`).
- An execution change to a user profile gives it a new id, and the old record is atomically **replaced**, so the old id disappears (`:272-279`).
- If the new id already exists, the update is rejected (`doc/Profiles.md:278-280`).
- `parentId` is kept and cannot be set or cleared on update (`profile_record.dart:113`; handler reads only `profile` and `metadata`).

**Lineage:**

- **`parentId`** is set only at create time (from the POST envelope), and the parent must exist (`profile_handler.dart:118`; `profile_controller.dart:223-228`).
- **Children:** `GET /api/v1/profiles?parentId=X` lists direct children (`profile_handler.dart:55-57`).
- **Whole tree:** `GET /api/v1/profiles/{id}/lineage` returns ancestors plus recursive descendants (`profile_controller.dart:339-367`).
- **Bundled files only** may declare `"parent_id"` inside the profile JSON (`profile_controller.dart:104-137`; `doc/Profiles.md:89`).

**The workflow profile has no id.** `Profile` has no id field. `PUT /api/v1/workflow` deep-merges maps and replaces arrays wholesale (`json_utils.dart:20-24`), then strictly re-parses the result (`workflow.dart:74-76`). Any profile key the PUT omits is therefore inherited from the previously loaded profile. Steps are replaced as a whole.

**Re-seeding of defaults.** Decaid re-seeds defaults on every launch:

- When the bundled `metadataHash` changes, it refreshes title, author and notes, and overwrites the record's `metadata` (`profile_controller.dart:58-79`).
- When the bundled content changes, it hides the old id (`:139-163`).

## 7. Required fields on create

| Field | Decaid requires? | Crema's "four" | Send anyway? |
|---|---|---|---|
| `title` (non-empty) | **yes** (`profile.dart:60-61`) | — | yes |
| `steps` (non-empty) | **yes** (`:63-64`) | — | yes |
| `tank_temperature` | **yes** (`:66-67`) | yes | yes |
| `target_volume_count_start` | **yes** (`:69-70`) | yes | yes |
| `target_volume` | no (`parseOptionalDouble`, `:86`) | yes | **yes**. Null and 0 hash differently, and a PUT /workflow that omits it inherits it. |
| `version` | no (`parseOptionalString`, `:74`) | yes | **yes**, as the string `"2"`, because it is hashed |
| `target_weight`, `notes`, `author`, `beverage_type` | no | — | yes (complete object; see deep-merge in §6.4) |

Crema's fix (`crema/web/src/gateway/client.ts:211-225`) fills `version ??= '2'`, `target_volume ??= 0`, `target_volume_count_start ??= 0` and `tank_temperature ??= 0`. Two of those four are not actually required at this commit, and the fix does not cover `title` or `steps`.

## 8. Subtleties

### 8.1 Per-step temperature

Temperatures are per step and often differ on purpose. These are heater-management tricks:

- Blooming Espresso: 97.5 (preinfusion), 90 (no-flow pause), 92 (extraction), then a 1-s 98 "reset temperature" step.
- Londonium: 89 → 88.5 → 88.
- TurboBloom: 86/70/80/77.
- Extractamundo Dos: 83.5/**67.5**/74.5.

Decaid's own helper shifts **every** step by the same offset (`Profile.adjustTemperature`, `profile.dart:135-141`), and so does Crema (`crema/web/src/domain/profile.ts:173-184`). Streamline's saved "brew temperature" instead **flattens** every step to one value (`.ref/streamline-js/src/modules/profileManager.js:572-576`), which destroys these shapes. CafAI uses uniform deltas.

Other temperature notes:

- **Resolution:** the wire resolution is 0.5 °C.
- **`sensor: water`:** 42 of the 481 bundled steps target mix-water temperature. None of the chosen templates do.
- **`tank_temperature`:** this is the tank pre-heat threshold, not a brew temperature (§2).
- **Simulator display:** the simulator idles at `steps[0].temperature` (`mock_de1.dart:633`). In simulate mode, Blooming therefore shows 97.5 °C as its pre-shot target.

### 8.2 `target_volume` and `target_volume_count_start`

**`target_volume`** (ml) is an app-side volumetric stop:

- **When it is used:** only with no usable scale (scale null or lost), with `bypassSAW` false, on non-Bengle machines, and when the target is above 0 (`shot_sequencer.dart:464-485`).
- **Override:** the workflow `context.targetWaterVolume` overrides it. Null inherits the profile value; 0 disables the stop (`shot_sequencer.dart:72`; `doc/Profiles.md:13`).
- **Measurement:** volume is accumulated as machine flow × dt, starting at frame index ≥ `target_volume_count_start` (`shot_sequencer.dart:297-318`).
- **Machine:** it is never sent to the machine.

**`target_volume_count_start`** is the number of leading preinfusion frames:

- **Header:** it is sent in header byte 2 (`unified_de1.profile.dart:22`).
- **Substate:** the simulator reports substate `preinfusion` while the frame is below this value and `pouring` afterwards (`mock_de1.dart:410-411`).
- **Streamline label:** Streamline's editor labels it "Pre-infusion ends at", where a 1-based step N means preinfusion ends after step N and 0 means none (`profile_editor.js:192-247`, `2069-2073`).
- **Structural:** it is structural, and CafAI keeps it fixed.

## 9. Templates

### 9.1 Selection

- **Blooming (a): `Blooming_espresso.json`.** Rao's well-known technique, with 6 flow steps and a clear story: fill, bloom, ramp, flat flow.
- **D-Flow (b): `D-Flow____default.json`** was chosen over `adaptive_espresso.json`.
  - D-Flow has 3 steps (fill, infuse, pour).
  - Adaptive has 20 steps, which is the de1app maximum. 18 of them are near-identical "Scan x mL.s" flow steps, each with a `flow under` exit, forming a flow search. Its `target_weight` is 0, and any flow lever would have to move 18 coupled values.
- **Lever (c): `Londonium.json`.** Damian Brakel's Londinium-R emulation. Its notes say it is "identical to the LRv2 profile, but renamed", and it is named in Decent's "good coffee" list of Londonium, D-Flow, Adaptive, Extractamundo, Allongé (RESEARCH §8).
  - Rejected: `advanced_spring_lever.json`, because of anomalous serialization (`version: null`, mixed types).
  - Rejected: `Traditional_lever_machine.json`, a basic `settings_2a` conversion that went through the lever-trio corruption and re-port (`doc/plans/archive/default-profiles-curation/audit.md:35-56`).
- **Allongé (d): `rao_allonge.json`.** Very light roasts at a long ratio and a high flow, which none of the first three cover. Details and the rejected alternatives are in §9.6.
- **Low pressure (e): `Gentle_and_sweet1.json`.** Beginners, milk drinks, and medium to dark roasts that turn harsh at 9 bar. Details and the rejected alternatives are in §9.7.

Decent's own Streamline skin offers exactly these two as default favourites, next to Default, Best practice and 80's Espresso (streamline-js `skin.tcl:2123` and `src/modules/profileManager.js:1278-1286`).

All five files are listed in `manifest.json`. Each has `version "2"`, `beverage_type espresso` and `tank_temperature 0`.

**How the lever tables read.**

- **Linked paths:** paths joined with `=` are one lever that writes the same value to every listed path.
- **Temperature levers:** these apply one uniform Δ to *all* steps. Min and max refer to the named anchor step, and every step must also stay within 80–100.
- **Columns:** "Gran." is the value granularity and "MaxΔ" is the maximum change per iteration.
- **Yield levers:** these write `target_weight` **and** workflow `context.targetYield` (§11). Every yield lever **needs a scale** (`requiresScale`): stop-at-weight is measured by the scale, so without one the validator refuses a yield change.
- **Where v1 starts (updated 2026-10-04, D57).** The "template value" column is the bundled file's value. v1's yield no longer starts there: it is the profile author's ratio times the dose Decaid has (12-25 g, else the 18 g reference), snapped to 1 g and kept in the dose window (`src/coach/start.ts`): Blooming and D-Flow 2.8x, Londonium and Gentle and Sweet 2x, Rao Allongé 5x. A dose outside 12-25 g also leaves the yield's dose window out (plain gram bounds). The Allongé's window is now 4.0-6.0x and Gentle and Sweet's tops out at 3.0x (rows below updated).

### 9.2 Template A: `Blooming_espresso.json`, "Blooming Espresso"

`target_weight 60.0`, `target_volume 0.0`, `target_volume_count_start 2`, expected id `profile:7438cb7266f60558b48f`.

| # | name | pump | sensor | trans. | target | °C | sec (max) | vol | weight | exit | limiter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | preinfusion start | flow | coffee | fast | 4.0 ml/s | 97.5 | 2.0 | 500 | 0.0 | — | {0.0, 0.6} (off) |
| 1 | preinfusion | flow | coffee | fast | 4.0 ml/s | 97.5 | 23.0 | 500 | 0.0 | pressure over 4.0 | — |
| 2 | pause | flow | coffee | fast | 0.0 ml/s | 90.0 | 30.0 | 500 | 0.0 | — | — |
| 3 | ramp | flow | coffee | smooth | 2.2 ml/s | 92.0 | 5.0 | 500 | 0.0 | — | — |
| 4 | flat flow | flow | coffee | fast | 2.2 ml/s | 92.0 | 20.0 | 500 | 0.0 | — | {8.6, 0.6} = max 8.6 bar |
| 5 | reset temperature | flow | coffee | fast | 0.0 ml/s | 98.0 | 1.0 | 500 | 0.0 | — | — |

Each step also carries an inactive `pressure` key (1/1/6/4/4/4), which is ignored.

What each step does:

- **Step 0.** Starts wetting the puck at 4 ml/s with very hot water. It has no exit, so the start-up pressure spike cannot end preinfusion early.
- **Step 1.** Keeps filling until the puck resists and pressure passes 4 bar (at most 23 s).
- **Step 2, the bloom.** The pump is off for 30 s and the heater target drops to 90 so it does not overshoot. The puck soaks and drips; the notes target about 8 g in the cup.
- **Step 3.** Ramps the flow from 0 to 2.2 ml/s over 5 s.
- **Step 4.** Holds 2.2 ml/s for up to 20 s, with pressure capped at 8.6 bar. Stop-at-weight normally ends the shot here.
- **Step 5.** A 1-s, pump-off tail that sets the heater target to 98 for the next shot.

Steps 0 and 1 are the preinfusion (`target_volume_count_start` 2).

| Lever | Path | Label | Unit | Template | Min | Max | Gran. | MaxΔ | Why |
|---|---|---|---|---|---|---|---|---|---|
| temp | `steps[*].temperature` (uniform Δ; anchor `steps[4]`) | Brew temperature | °C | 92.0 | 86.0 | 94.0 | 0.5 | 2.0 | Main sour/bitter lever. It keeps the 97.5/90/92/98 shape. At the bounds, every step stays within 84–100. |
| yield | `target_weight` (+ `context.targetYield`) | Yield | g | 60.0 | max(30, 2.0×dose) | min(80, 3.5×dose) | 1 | 4 | **Needs a scale.** Strength and ratio; the RESEARCH ±2–4 g step. |
| bloom | `steps[2].seconds` | Bloom time | s | 30 | 10 | 40 | 1 | 5 | RESEARCH bloom bound 0–40 s; the minimum keeps the bloom meaningful. |
| piExit | `steps[1].exit.value` | Bloom starts at pressure | bar | 4.0 | 2.0 | 6.0 | 0.5 | 1.0 | How saturated the puck is before the bloom (RESEARCH 1–6 bar). |
| flow | `steps[3].flow` = `steps[4].flow` | Extraction flow | ml/s | 2.2 | 1.5 | 3.5 | 0.1 | 0.4 | Contact time and body (RESEARCH 0.5–6). It is linked so the ramp still lands on the hold value. |

**Fixed:**

- preinfusion flow 4.0
- step 0 seconds; steps 3, 4 and 5 seconds; step 1's 23-s cap
- the limiter on step 4 (8.6/0.6) and the off limiter on step 0
- all `volume` 500, all `weight` 0.0, every exit's type and condition
- `target_volume`, `target_volume_count_start`, `tank_temperature`
- all names, pumps, sensors and transitions

### 9.3 Template B: `D-Flow____default.json`, "D-Flow / default"

`target_weight 50`, `target_volume 0`, `target_volume_count_start 2`, expected id `profile:59036f8846b1ed3b4255`.

| # | name | pump | sensor | trans. | target | °C | sec (max) | vol | weight (app exit) | exit | limiter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Filling | pressure | coffee | fast | 3.0 bar | 88 | 25 | 100 | **5 g** | pressure over 1.5 | {0, 0.2} (off) |
| 1 | Infusing | pressure | coffee | fast | 3.0 bar | 88 | 60 | 100 | **4 g** | — | {0, 0.2} (off) |
| 2 | Pouring | flow | coffee | fast | 1.7 ml/s | 88 | 127 | 0 | 0 | — | {8.5, 0.2} = max 8.5 bar |

Steps also carry inactive keys: `flow 8` on steps 0–1 and `pressure 4.8` on step 2.

What each step does:

- **Step 0.** Fills at up to 3 bar until the puck is full and pressure passes 1.5 bar. As a safety, it also moves on if 5 g are already in the cup (app-side weight exit). The cap is 25 s.
- **Step 1.** Soaks the puck at 3 bar until 4 g have dripped into the cup, or for 60 s. The weight exit is app-side and needs a connected scale.
- **Step 2.** Extracts at a constant 1.7 ml/s, with pressure capped at 8.5 bar by a tight 0.2 band. Stop-at-weight ends it, with a 127-s cap.

Filling and Infusing are the preinfusion. Volume counting starts at Pouring.

| Lever | Path | Label | Unit | Template | Min | Max | Gran. | MaxΔ | Why |
|---|---|---|---|---|---|---|---|---|---|
| temp | `steps[*].temperature` (uniform Δ; anchor `steps[2]`) | Brew temperature | °C | 88 | 84.0 | 94.0 | 0.5 | 2.0 | Primary taste lever. All steps are equal in this template. |
| yield | `target_weight` (+ `context.targetYield`) | Yield | g | 50 | max(30, 1.8×dose) | min(70, 3.0×dose) | 1 | 4 | **Needs a scale.** Ratio. |
| soak | `steps[0].pressure` = `steps[1].pressure` | Fill & soak pressure | bar | 3.0 | 2.0 | 6.0 | 0.5 | 1.0 | Puck saturation (RESEARCH 1–6). The minimum stays above the Filling exit of 1.5, so the exit can still fire. |
| soakWeight | `steps[1].weight` | Soak until (drips in cup) | g | 4 | 2 | 8 | 1 | 2 | D-Flow's signature knob: longer soak, more extraction. **Needs a scale.** Without one, the 60-s time limit governs. |
| pourFlow | `steps[2].flow` | Pour flow | ml/s | 1.7 | 1.0 | 3.0 | 0.1 | 0.3 | Contact time and strength. |
| pourPmax | `steps[2].limiter.value` | Max pressure while pouring | bar | 8.5 | 6.0 | 10.0 | 0.5 | 1.0 | Acts as peak pressure on a flow profile (RESEARCH 3–10). |

**Fixed:**

- the Filling exit (pressure over 1.5) and the Filling weight of 5 g
- all `seconds` (25/60/127) and `volume` (100/100/0)
- limiter ranges of 0.2, and the off limiters on steps 0–1
- `target_volume`, `target_volume_count_start`, `tank_temperature`
- names, pumps, sensors and transitions

### 9.4 Template C: `Londonium.json`, "Londonium"

`target_weight 42.0`, `target_volume 0.0`, `target_volume_count_start 2`, expected id `profile:729d284747718d27c93a`.

| # | name | pump | sensor | trans. | target | °C | sec (max) | vol | weight | exit | limiter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Fill start | pressure | coffee | fast | 2.0 bar | 89.0 | 2.0 | 100 | 0.0 | — | {0.0, 0.6} (off) |
| 1 | Fill | pressure | coffee | fast | 2.0 bar | 89.0 | 25.0 | 100 | 0.0 | pressure over 1.5 | — |
| 2 | Infuse | pressure | coffee | fast | 3.0 bar | 88.5 | 12.0 | 100 | 0.0 | — | — |
| 3 | Pressure Up | pressure | coffee | fast | 9.0 bar | 88.5 | 8.0 | 100 | 0.0 | — | — |
| 4 | Pressure Decline | pressure | coffee | smooth | 3.0 bar | 88.0 | 55.0 | 100 | 0.0 | flow over 2.8 | — |
| 5 | Pressure Hold | pressure | coffee | fast | 3.0 bar | 88.0 | 127.0 | 100 | 0.0 | flow over 2.8 | — |
| 6 | Flow Limit | flow | coffee | fast | 2.5 ml/s | 88.0 | 127.0 | 100 | 0.0 | — | — |

Inactive keys are present and ignored.

What each step does:

- **Steps 0–1.** Fill at 2 bar, like a line-pressure fill, until the puck resists and pressure passes 1.5 bar. Step 0 has no exit, so the start-up spike cannot skip the fill.
- **Step 2.** Soaks at 3 bar for 12 s. This is the Londinium-style preinfusion.
- **Step 3.** Jumps to 9 bar and holds it for 8 s. This is the lever's peak.
- **Step 4.** Declines smoothly from 9 to 3 bar over 55 s, imitating the falling spring. If flow passes 2.8 ml/s because the puck is eroding, it moves on.
- **Step 5.** Holds 3 bar, with the same flow exit.
- **Step 6.** A salvage step that runs a constant 2.5 ml/s so an eroded puck cannot gush.

Steps 5–6 rarely run on a well-prepared puck; the notes say they "assist with less than ideal puck prep".

| Lever | Path | Label | Unit | Template | Min | Max | Gran. | MaxΔ | Why |
|---|---|---|---|---|---|---|---|---|---|
| temp | `steps[*].temperature` (uniform Δ; anchor `steps[4]`) | Brew temperature | °C | 88.0 | 84.0 | 92.0 | 0.5 | 2.0 | Keeps the 89/88.5/88 shape. At the bounds, every step stays within 84–93. |
| yield | `target_weight` (+ `context.targetYield`) | Yield | g | 42.0 | max(25, 1.5×dose) | min(60, 2.8×dose) | 1 | 4 | **Needs a scale.** Ratio. Lever-style shots run shorter ratios. |
| soak | `steps[2].seconds` | Soak time | s | 12 | 4 | 24 | 1 | 4 | Preinfusion time (RESEARCH 0–30, ±2–5). |
| peak | `steps[3].pressure` | Peak pressure | bar | 9.0 | 6.0 | 10.0 | 0.5 | 1.0 | Body and intensity (RESEARCH 3–10). The "Trendy 6 bar" family sits at the low end. |
| declineEnd | `steps[4].pressure` = `steps[5].pressure` | Decline end pressure | bar | 3.0 | 2.0 | 6.0 | 0.5 | 1.0 | Tail of the shot: lower is gentler and less bitter (RESEARCH 2–8). Linked so the hold matches where the decline ends. Constraint: `peak − declineEnd ≥ 1.0`. |

**Fixed:**

- the fill pressure of 2.0 and the Fill exit of 1.5
- the Infuse pressure of 3.0
- the Pressure Up time of 8 s and the decline time of 55 s
- the flow-over-2.8 exits and the 2.5 ml/s Flow Limit (this must stay below 2.8)
- the 127-s caps, all `volume` and `weight` values, and the off limiter on step 0
- `target_volume`, `target_volume_count_start`, `tank_temperature`
- names, pumps, sensors and transitions

### 9.5 Rules for all templates

**Never change:**

- step count, order, `name`, `pump`, `sensor`, `transition`
- whether an `exit` exists, and its `type` and `condition`
- whether a `limiter` exists, and its `range`
- `volume`
- `target_volume`, `target_volume_count_start`, `tank_temperature`, `beverage_type`, `version`

**Validate after every patch:**

- the structural invariants above
- every number against §5.2
- each lever against its min, max, granularity and MaxΔ
- each cross-field constraint

**Hash test.** A patch that leaves every lever at its template value must hash to the template's expected id (unit test).

### 9.6 Template D: `rao_allonge.json`, "Rao Allongé"

CafAI id `allonge`. `target_weight 135`, `target_volume 180`, `target_volume_count_start 0`, expected id `profile:372f1be4c5e3641bbfe2` (`rao_allonge.json:40-43`).

Selection:

- **Why.** Allongé is on Decent's "good coffee" list (RESEARCH §8), and it covers what the first three do not: very light roasts brewed long, at a high flow. Its notes: "An amazing long espresso for light roasts … 5:1 ratio, 35-40 seconds, coarse espresso grind. If close to the right pressure, make 0.5g dose adjustments to get to an 8-9 bar peak. The very high flow rate means small grind adjustments cause big pressure changes. An advanced technique, allongé averages 24% extraction." (`rao_allonge.json:4`). Decaid's curation kept this 2-step file as the canonical Rao Allongé (`doc/plans/archive/default-profiles-curation/curation.md:190-191`).
- **Rejected: `Blooming_allonge.json`.** It has 6 steps (two fills with exits, a ramp-down, a 30 s bloom, a ramp and a hold), so it repeats Blooming Espresso's bloom. Its notes call it "a very advanced technique" with a "very fine grind". It also ships 135 g.
- **Rejected: `adaptive_allonge.json`.** It has 20 steps, like `adaptive_espresso.json` (§9.1).

| # | name | pump | sensor | trans. | target | °C | sec (max) | vol | weight | exit | limiter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | hold at 4.5 ml/s | flow | coffee | fast | 4.5 ml/s | 92.0 | 2 | 500 | 0.0 | — | {8.6, 0.6} = max 8.6 bar |
| 1 | hold at 4.5 ml/s | flow | coffee | fast | 4.5 ml/s | 92.0 | 60 | 500 | 0 (parses to 0.0) | — | {8.6, 0.6} = max 8.6 bar |

Steps: `rao_allonge.json:7-38`. Each step also carries an inactive `pressure` key ("0"), which is ignored. Both steps have the same name, and both names are hashed.

What each step does:

- **Step 0.** A 2 s start at 4.5 ml/s with pressure capped at 8.6 bar. It has no exit. An archived Decaid plan treats frame 0 as this profile's preinfusion and suggests `target_volume_count_start` 1 (`doc/plans/archive/imported-shot-fixes/fix-262-263-imported-shots.md:107`), but the shipped file keeps 0, so volume counts from the first frame.
- **Step 1.** The rest of the shot: a steady 4.5 ml/s for up to 60 s, with pressure capped at 8.6 bar (soft band 0.6). Pressure builds as the coarse puck resists; the notes aim for an 8–9 bar peak in 35–40 s. Stop-at-weight normally ends it at 135 g. Without a scale, the app-side volumetric stop at 180 ml does (§8.2), which is 40 s at 4.5 ml/s.

There is no preinfusion (`target_volume_count_start 0`).

**The 135 g default and the "5:1" notes disagree.** 135 g is 5:1 only for a 27 g dose; it is 1:7.5 for 18 g and 1:5.4 for 25 g, CafAI's largest dose. 180 ml at 4.5 ml/s is the notes' 40 s, so 135 g matches the time rather than the ratio. Decent's Profile Generator plugin puts an "Allongé" at 4.5–5.5 % TDS (`assets/plugins/decent-profile.reaplugin/plugin.js:5`), which at the notes' 24 % extraction is about 1:4.4–1:5.3. CafAI keeps 135 g as v1 (hash identity), makes it the lever's ceiling, and lets the ratio window run from 1:4 up to the 1:7.5 that the default is at 18 g. The template description tells the model that the style aims for about 1:5. *Superseded by D57 (2026-10-04): v1 now starts at 5×dose (90 g at 18 g) and the window is 1:4–1:6; 135 g stays the lever's ceiling.*

**Why the levers act on step 1 only.** Both steps are named "hold at 4.5 ml/s". The confirm card appends step names to a linked lever with several paths (`describeLeverChange` in `src/coach/diff.ts`), so a lever on both steps would read "Flow rate: 4.5 ml/s -> 4.0 ml/s (hold at 4.5 ml/s)". The levers write step 1, and step 0 stays a fixed 2 s start. The names keep saying 4.5 ml/s after a flow change, and the flow lever's description says so.

| Lever | Path | Label | Unit | Template | Min | Max | Gran. | MaxΔ | Why |
|---|---|---|---|---|---|---|---|---|---|
| temp | `steps[*].temperature` (uniform Δ; anchor `steps[1]`) | Brew temperature | °C | 92.0 | 88.0 | 96.0 | 0.5 | 2.0 | Light roasts run hot (RESEARCH §8: 93–96 °C). Both steps are equal, so every step stays within 88–96. |
| yield | `target_weight` (+ `context.targetYield`) | Yield | g | 135 | max(50, 4.0×dose) | min(135, 6.0×dose) | 1 | 10 | **Needs a scale.** The ceiling is Decent's own default (above the generic 120 g bound, see §5.2). Since D57 v1 starts at 5×dose (90 g at 18 g), so the window is 4.0–6.0×dose (Decent: "5:1 or 6:1", beginners about 4:1); it was 7.5×dose so the 135 g default passed at 18 g. 10 g is 7 % of 135 g, about the same relative step as 4 g on the 42–60 g espresso yields (7–10 %). |
| flow | `steps[1].flow` | Flow rate | ml/s | 4.5 | 3.5 | 5.5 | 0.1 | 0.5 | The allongé's defining knob: contact time and pressure (RESEARCH 0.5–6, ±0.25–0.5). Below 3.5 it is no longer an allongé. Step 0 keeps 4.5 for its 2 s. |
| maxPressure | `steps[1].limiter.value` | Max pressure | bar | 8.6 | 6.0 | 10.0 | 0.1 | 1.0 | The peak cap (RESEARCH 3–10; the same range as D-Flow's `pourPmax`). Granularity 0.1 because 8.6 is not on a 0.5 grid, and the template value must be representable. |

There are no cross-lever constraints.

**Fixed:**

- step 0 entirely: its 2 s, 4.5 ml/s and {8.6, 0.6} limiter
- step 1's 60 s cap, and both limiter ranges of 0.6
- all `volume` 500, both `weight` values (0.0), and no exits
- `target_volume` 180, `target_volume_count_start` 0, `tank_temperature` 0
- all names (both "hold at 4.5 ml/s"), pumps, sensors and transitions

### 9.7 Template E: `Gentle_and_sweet1.json`, "Gentle and sweet"

CafAI id `gentle-and-sweet`, card name "Gentle and Sweet". `target_weight 36.0`, `target_volume 36.0`, `target_volume_count_start 2`, expected id `profile:1baa29bd9d9dc6d47f2a` (`Gentle_and_sweet1.json:87-90`).

Selection:

- **Why.** It covers beginners, milk drinks, and dark roasts that turn harsh at 9 bar; with Londonium, the darker end gets two templates. Its notes: "This is a very easy espresso to successfully make and is suggested if you are having difficulty making good drinks. The pressure rises to only 6 bar and then slowly descends to 4 bar. The resulting espresso should be free of channeling, have low acidity and quite pleasant to drink straight or with milk." (`Gentle_and_sweet1.json:5`). Every value is inside CafAI's generic bounds.
- **Rejected: `Extractamundo_Dos.json`,** although it is on the "good coffee" list. It is a third light-roast profile (for high-extraction grinders at high flow). Its 67.5 and 74.5 °C steps fall below the 80 °C per-step bound and would need anchor-based temperature bounds (§10.11). Its 6 bar step is stored as `6.0000000000000036`, which is off any lever grid, so a pressure lever could not write the template value back and keep the id.
- **Rejected: `Classic_Italian_espresso.json`.** It is a flat 9 bar at 94 °C, which RESEARCH §8 associates with owners who struggled.
- **Provenance.** Decaid's curation audit found that an earlier import of this file had taken stale de1app frames; so had Classic Italian espresso, Default, 7g basket and Preinfuse then 45ml (`doc/plans/archive/default-profiles-curation/audit.md:45-48`). Three of those (7g basket, Classic Italian, Preinfuse then 45ml) now ship a different step layout from the one the audit recorded (`audit.md:160, 168, 187`), so the set was regenerated after the audit. Default and this file kept their layouts (`audit.md:175, 183`), so the layout alone cannot prove this file was regenerated. It does have the regenerated format that Classic Italian and Default share (`type: pressure`, no `legacy_profile_type`, de1app's generated step names), and its values match its notes (6 bar, then 4 bar).

| # | name | pump | sensor | trans. | target | °C | sec (max) | vol | weight | exit | limiter |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | preinfusion temp boost | flow | coffee | fast | 8.0 ml/s | 88.0 | 2.0 | 0.0 | 0.0 | pressure over 4.0 | — |
| 1 | preinfusion | flow | coffee | fast | 8.0 ml/s | 88.0 | 18.0 | 0.0 | 0.0 | pressure over 4.0 | — |
| 2 | forced rise without limit | pressure | coffee | fast | 6.0 bar | 88.0 | 3.0 | 0.0 | 0.0 | — | — |
| 3 | rise and hold | pressure | coffee | fast | 6.0 bar | 88.0 | 13.0 | 0.0 | 0.0 | — | {4.0, 1.0} = max 4.0 ml/s |
| 4 | decline | pressure | coffee | smooth | 4.0 bar | 88.0 | 30.0 | 0.0 | 0.0 | — | {4.0, 1.0} = max 4.0 ml/s |

Steps: `Gentle_and_sweet1.json:8-85` (names at lines 9, 26, 43, 55, 71). Inactive keys: `pressure 1.0` on steps 0–1 and `flow 0.0` on steps 2–4.

What each step does:

- **Steps 0–1.** Fill at 8 ml/s, as fast as the pump goes, until pressure passes 4 bar (at most 2 + 18 s). Despite its name, step 0 has no temperature boost here, because every step is 88 °C. The name comes from de1app's generator; Default (`Default1.json`) does boost that step, to 90 °C.
- **Step 2.** Raises the pressure to 6 bar for 3 s with no flow limit, so the puck pressurises quickly.
- **Step 3.** Holds 6 bar for up to 13 s. Flow is capped at 4 ml/s (soft band 1.0), so a channel cannot gush.
- **Step 4.** Lowers the pressure smoothly from 6 to 4 bar over 30 s, with the same flow cap. Stop-at-weight normally ends the shot here, at 36 g.

Steps 0 and 1 are the preinfusion (`target_volume_count_start` 2). Without a scale, the volumetric stop counts 36 ml from step 2 (§8.2).

| Lever | Path | Label | Unit | Template | Min | Max | Gran. | MaxΔ | Why |
|---|---|---|---|---|---|---|---|---|---|
| temp | `steps[*].temperature` (uniform Δ; anchor `steps[3]`) | Brew temperature | °C | 88.0 | 84.0 | 92.0 | 0.5 | 2.0 | Primary taste lever. All steps are equal in this template. Medium to dark roasts (RESEARCH §8: 85–93 °C). |
| yield | `target_weight` (+ `context.targetYield`) | Yield | g | 36 | max(25, 1.5×dose) | min(60, 3.0×dose) | 1 | 4 | **Needs a scale.** RESEARCH §8: dark 1:1.8–2.2 and medium 1:2–2.5; the 1.5 floor allows a short shot for milk. The ceiling is 3.0×dose since D57 (Decent's guide: "1:2 or 1:3"; it was 2.5). |
| peak | `steps[2].pressure` = `steps[3].pressure` | Peak pressure | bar | 6.0 | 4.0 | 8.0 | 0.5 | 1.0 | Body and intensity (RESEARCH 3–10, ±0.5–1). The cap of 8 keeps it a low-pressure profile. Linked so the 3 s rise and the hold share the target. Constraint: `peak − declineEnd ≥ 1.0`. |
| declineEnd | `steps[4].pressure` | Decline end pressure | bar | 4.0 | 2.0 | 6.0 | 0.5 | 1.0 | The finish: lower is softer and less bitter (RESEARCH 2–8). The same range and constraint as Londonium. |
| hold | `steps[3].seconds` | Peak hold time | s | 13 | 5 | 25 | 1 | 4 | How long the peak holds before the decline, after the fixed 3 s rise. Longer gives more body; shorter reaches the gentle decline sooner. Whole seconds encode exactly (§5.1). |

**Fixed:**

- the 8.0 ml/s fill, its 4.0 bar exits, and its 2 s and 18 s caps
- the 3 s forced rise and the 30 s decline time
- the 4.0 ml/s flow limits and their 1.0 range, and no limiter on steps 0–2
- all `volume` 0.0 and all `weight` 0.0
- `target_volume` 36, `target_volume_count_start` 2, `tank_temperature` 0
- names, pumps, sensors and transitions

## 10. Disagreements with RESEARCH.md (repo wins)

1. **Required fields.** RESEARCH says a new profile must include `tank_temperature`, `target_volume`, `target_volume_count_start` and `version` (TL;DR, Rec. 4). The repo requires non-empty `title`, non-empty `steps`, `tank_temperature` and `target_volume_count_start`. `target_volume` and `version` are optional (`profile.dart:59-74, 86`; `rest_v1.yml:6391-6395`; `profile_handler_create_test.dart:85-116`).
2. **"Bare 'Invalid request'".** The 400 body always carries a `message` with the exact cause (`profile_handler.dart:130-133`). The bareness came from Crema's client discarding `message`. Separately, missing step fields return **500** on POST, not 400.
3. **Numbers vs strings.** RESEARCH says it is "unverified, mirror GET". Decaid accepts both, and GET returns **JSON numbers** (`profile.dart:93-106`; `profile_mapper.dart:35`). The caller's hint "serialize numbers as strings like GET returns" is also wrong on this point.
4. **"A weight-based stop is the profile-level `target_weight`"** (RESEARCH, echoing `profile-field-limits.js:37-38`). Stop-at-weight reads `context.targetYield` (`de1_state_manager.dart:820-821`; `shot_sequencer.dart:444-446`; `bengle_saw_bridge.dart:39-40`; `doc/Api.md:300`). Per-step `weight` is a real, app-side step exit. Streamline's comments claiming the opposite (`ui.js:205`, `profileManager.js:940-944`) are stale relative to this commit.
5. **"One exit condition per step."** This is true for the firmware `exit` object only. A step can also end on `seconds`, `volume` or app-side `weight` (`doc/Profiles.md:15-30`).
6. **"Hard maximum of 20 steps."** Decaid enforces no step maximum. The encoder's frame addressing breaks at 32 or more steps. 20 is a de1app convention; two bundled profiles have exactly 20.
7. **RESEARCH's v2 example.** Its second step omits `volume`, which Decaid requires (`profile.dart:252`). Posted as-is, it would return HTTP 500.
8. **"Duplicate titles are allowed".** True, but it misses the converse: identical execution content cannot be stored twice, whatever the title. POST returns the existing record (`profile_controller.dart:236-242`). Crema's `duplicateProfile` comment (`crema/web/src/domain/profile-edit.ts:71-77`) wrongly assumes a rename creates a separate profile.
9. **"Edits change the id".** Only execution edits change it. Title, notes and author edits keep the id. Renaming a step *does* change it.
10. **Rec. 4 activation flow** omits `context.targetYield`. Without it, the shot stops at the old yield.
11. **Temperature bound "80–100 °C" per step.** This cannot be universal: bundled profiles deliberately use 67.5 °C (Extractamundo Dos) and 70 °C (TurboBloom). Bounds must be delta/anchor-based. 80–100 holds for the five chosen templates across each template's whole temperature range (tested).
12. **Smaller nuances:**
    - `tools/ingest_profiles.py` converts only `settings_2c`. It rejects basic `settings_2a`/`2b` profiles (`:66-73`).
    - The bundled names are "Londonium" and "Extractamundo Dos!" (RESEARCH writes "Londinium" and "Extramundo Dos").
    - `PUT /workflow` deep-merges maps but replaces arrays wholesale (`json_utils.dart:20-24`), so `steps` never partially merge.

## 11. Implications for CafAI

1. **Serialize every number as a JSON number.** Only `version` (the string `"2"`) and the enum fields are strings. Parse template strings with Dart-equivalent rules once, at load time.
2. **Always send the complete 10-key profile:** `version`, `title`, `notes`, `author`, `beverage_type`, `steps`, `target_volume`, `target_weight`, `target_volume_count_start`, `tank_temperature`. This covers the required fields, avoids inheriting keys through the deep-merge, and keeps the hash stable. Sending the template's extra keys is harmless, but omit them.
3. **Build every version by patching the parsed template at the declared lever paths only.** Keep the representation of `exit`, `limiter` and `weight` exactly as in the template, because null and 0 hash differently.
4. **Shift temperature with a uniform Δ in 0.5 °C steps.** Never flatten.
5. **Yield writes both places.** Set `profile.target_weight` and, in the **same** `PUT /api/v1/workflow`, `context.targetYield` as a JSON number. The workflow value is what stops the shot.
6. **Create a version** with `POST /api/v1/profiles {profile, parentId: <previous version id, or the template's default id>, metadata: {cafai…}}`. Never edit execution fields with PUT: it replaces the record, so history ids vanish, and defaults are immutable.
7. **Expect dedupe.** Compare the returned `id`, `profile.title` and `isDefault` with what was sent.
   - The returned record may belong to another bean, be the bundled default, or be a hidden or deleted record.
   - Keep the bean → version → Decaid id mapping in IndexedDB.
   - Treat a returned id equal to an earlier version's id as a revert.
   - An all-levers-at-template-values "v1" *is* the default. Activate it rather than POST it.
8. **Compute ids client-side** with a byte-exact TypeScript port of `ProfileHash`, using Dart double formatting. Unit-test it with `best_practice.json` → `profile:b73ce54592d667d00b31` and the three template ids. This identifies what the workflow is running, since the workflow profile has no id.
9. **Validate before upload.** Check every number against §5.2, because Decaid will not. Out-of-range values can silently wrap on the wire, for example 16 bar becomes 0 bar.
10. **On errors, show `message`, not just `error`.** Handle 500 on a structurally broken profile as a CafAI bug.
11. **Percent-encode ids in paths** (`encodeURIComponent("profile:…")`). The handler decodes once.
12. **Activate** with `PUT /api/v1/workflow {profile: <full>, context: {targetYield, targetDoseWeight}}`. Confirm by hashing the profile in the PUT response or in a re-GET.
13. **D-Flow soak weight needs a scale.** The template's weight exits only work with a scale connected and the gateway mode not `full`. Warn the user when no scale is connected. The same holds for stop-at-weight, so every template's yield lever is marked `requiresScale` too.
14. **Store CafAI state locally.** Record `metadata` is free-form and persists for user records. It is unreliable for deduped or default records, because re-seeding overwrites default metadata. Keep authoritative coach state in IndexedDB.

## 12. Open questions (ranked by cost of a wrong guess)

1. **Other clients rewriting the yield.**
   - Streamline re-applies per-profile yields from its own KV overrides (`profileManager.js:938-956`; `docs/AI_PROFILES_NOTES.md:24`) and writes `target_weight` on the belief that it drives SAW.
   - If another skin or plugin rewrites `context.targetYield` after CafAI sets it, shots stop at the wrong weight.
   - Mitigation: set both fields on every activation and re-read before a shot.
2. **Real firmware behaviour inside the representable ranges** (for example high flows with `ignoreLimit`, or limiter softness) cannot be verified from the repo. Lever bounds stay inside values already used by bundled profiles.
3. **Whether `target_weight` regains SAW authority in a later Decaid.** Writing both fields covers either outcome. Re-check on each Decaid upgrade.
4. **Per-step `volume`.** Its frame semantics (per-frame vs cumulative, and the always-set `0x400` bit) are undocumented in the repo. CafAI keeps `volume` fixed, so the impact is limited.
5. **Hash-port fidelity at extremes.** Exponent formatting, `-0.0`, NaN and control characters in names are unverified. The levers' granularities avoid them, and the port is verified on one ground truth plus the three template ids.
6. **Future content changes to the bundled templates** would give the defaults new ids and hide the old ones. CafAI's copies stay valid profiles, and parent pointers remain resolvable because hidden records persist.
7. **Step count above 20.** Not applicable while templates stay fixed.

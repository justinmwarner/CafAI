# Decaid alignment and update safety: design

Date: 2026-10-09. Status: approved (the owner's choices in section 1).
Audit reports, with file:line citations into each repo, are in
[docs/audit/2026-10-09/](../../audit/2026-10-09/):

| Report | What it covers |
|---|---|
| [streamline.md](../../audit/2026-10-09/streamline.md) | Decent's own skin, streamline-js v0.2.12 (`57e8b44`): every Decaid call, bridges, practices, 33 platform rules, changes since v0.2.7 |
| [decaid.md](../../audit/2026-10-09/decaid.md) | Decaid at `af4e995`: the whole skin-facing surface, bridges, versioning, spec drift, changes since `a45961b`, running it headless |
| [cafai.md](../../audit/2026-10-09/cafai.md) | CafAI at `cf5cce1`: every Decaid call, what is checked and what is trusted, the mock, the assumptions a Decaid update could break |
| [others.md](../../audit/2026-10-09/others.md) | MSL, decaid-zen, DYE2, decaid-mcp: integration points, practices, ideas |
| [typegen.md](../../audit/2026-10-09/typegen.md) | The experiment: types generated from Decaid's specs and checked against CafAI's |

The experiment's scripts are kept beside the reference clones in
`.ref/cafai-audit-typegen/` (not in git): `conformance/checks.ts`,
`ws-gen-openapi.mjs`, `run-conformance.sh`, `validate-examples.mjs`,
`spec-diff.mjs`, `mutate-spec.mjs`.

## 1. The owner's ask

"I want to audit the whole project and where it is to make sure we're
following patterns/practices other 'skins' for Decaid. I want to make sure
we're hooked up to all the native things. I'd like to lean on the streamline
one as that's built by Decent themselves. Additionally I want to make sure
that updates to Decent do not break us, can we make sure w/e is possible for
that is in place, ie: type checking, etc."

Choices, after the audit summary:

- **Update safety: all eight layers.** Typecheck against Decaid's spec, mock
  contract test, drift watch, tests against a real Decaid, a fail-safe
  runtime, the version in About, a release gate, and a draft of the spec
  fixes for Decent (the owner decides whether to send it).
- **Decaid features this round:** link bags to Decaid's bean library;
  connect from the "not connected" alert; "ready in about 2 min" from the
  time-to-ready plugin; Visualizer link on shot cards; the coach reads
  DYE2's history; steam, hot water and flush settings; skip step during a
  shot; bag photo to bean details. Not this round: Derek, Decent's Profile
  Generator.
- **Gateway mode Full:** an alert with a one-tap switch to Tracking.
- **The API key:** the user may opt in to keeping it in Decaid, so it
  survives a Decaid update.

## 2. What the audit found

**Where CafAI stands among skins.** On engineering CafAI is ahead of every
skin surveyed, Decent's included. streamline-js is plain JavaScript with
hand-written wrappers, no schema validation and no tests in CI, and its copy
of Decaid's spec predates `a45961b`. No skin or plugin checks itself against
Decaid's spec or a running Decaid. So streamline is the reference for
platform rules and native integration, and update safety has no precedent
to copy.

**Decaid gives skins no compatibility contract.** `GET /api/v1/info` reports
the build, not an API version; both specs say `1.0.0` and are hand-written;
there is no changelog or deprecation policy. The code and the specs differ
in 21 places (decaid.md section 3.5). The 40 commits from `a45961b` to
`af4e995` only add things; the one that touches CafAI is the new
`grinderBurrs` context field. The latest release is **v0.8.8** (published
2026-10-06, commit `aab5f93`), with Linux x64 and arm64 builds.

**CafAI's view of Decaid is one reading, never re-checked.** It was read
from `a45961b` on 2026-10-01. `src/api/types.ts` is hand-written;
`requestValue<T>` casts `JSON.parse`, so workflow, profile-record and
shot-record replies are trusted blindly; the mock is typed with CafAI's own
types, so mock and client check each other, not Decaid.

**What a Decaid change would break without anyone noticing** (cafai.md
section 2.5):

| If Decaid changed... | CafAI today |
|---|---|
| The `?full=1` reply of the KV store | Coerced to `{}`: "no backup", and on a fresh device the first push overwrites the backup with empty lists |
| The `shotState` state names | No shot is ever detected: the machine-state fallback switches off after the first `shotState` frame |
| The shot record's `workflow` | The "machine ran another profile" guard is skipped: every shot is credited to the active version |
| A machine reading's name | It reads as 0 and is shown as 0 |
| `POST /machine/profile` | Loads are "assumed" for the session, with no notice |
| Validation of notes or `enjoyment` | The write is retried forever, silently |
| A running state's name | No Stop button |

**Where CafAI differs from Decent's patterns.**

- Gateway mode is never read. In `full`, Decaid leaves stop-at-weight to the
  skin, and CafAI never stops a shot. streamline forces `tracking` at boot.
- `grinderBurrs` (new) is not cleared with the other grinder fields, so a
  stale value reaches shot records and Visualizer.
- Decent's b0aa1ce ("keep main-page quick presets across app updates") says
  every Decaid app update wipes the skin's IndexedDB; streamline keeps what
  matters in Decaid's KV store. CafAI mirrors too, but restores once at
  boot: if Decaid is not answering yet, it starts empty and only merges the
  backup on the next write, without refreshing the screen. The API key
  lives only in browser storage.
- Ratings: Decaid 0.8.6 stores `enjoyment` 0-100, later builds 0-10
  (others.md 6.2 #1). CafAI writes stars x 2 everywhere.
- `PUT /workflow` can take about 30 s and then answer 503 (streamline rule);
  CafAI gives up at 15 s and reports a failure Decaid may still apply.

**Already right:** the heartbeat on interaction (streamline never sends one),
the insecure-context fallbacks (ids, SHA-256, clipboard), Exit through
`decentApp.exitToDashboard()`, no new-tab links, and the screen kept awake
(Decaid holds its own wake lock while a machine is connected and awake,
`display_controller.dart:293-315`).

## 3. Decisions

Recorded in DECISIONS.md as D93 onward, in a new section "Decaid alignment
and update safety (2026-10-09)".

| # | Decision |
|---|---|
| D93 | **The pin is Decaid v0.8.8 (`aab5f93`).** The specs of the release users run are vendored in the repo; CafAI is "verified with" that release. The drift watch checks the latest release and `main` against it, and `decaid-contract --update <ref>` moves it. |
| D94 | **Typecheck checks CafAI's wire types against the pinned spec.** Every mismatch is either fixed or recorded as an exception with a kind (spec gap, spec drift, CafAI narrower, CafAI looser, parsed shape), a reason and the Dart file:line that proves it. A new mismatch fails as `unexpected`; an exception Decaid has fixed fails as `stale`. |
| D95 | **Tolerant reader, fail safe, never silent.** Every Decaid reply is checked where it enters CafAI. Extra fields pass through; unknown enum strings are kept. A missing or mistyped field CafAI needs is reported as drift and handled by the rules in section 5, never by a crash, a silent 0 or a silent retry loop. |
| D96 | **Drift is visible.** Settings > About lists what Decaid sent that CafAI did not expect, with the running and the verified Decaid versions and a report to copy. |
| D97 | **Stop for unknown states.** Stop shows for the known running states and for any state CafAI does not recognise, never for the states at rest or the ones not to interrupt (section 5.7). |
| D98 | **Gateway mode Full gets an alert with a one-tap fix.** CafAI never changes Decaid's settings by itself. |
| D99 | **The API key may live in Decaid, by choice.** Off by default; when on, the key is kept in its own KV namespace, `cafai-key`, outside the backup the mirror writes. |
| D100 | **Restore waits for Decaid.** A boot that finds no local data keeps trying Decaid's backup in the background and refreshes the screen when it lands. |
| D101 | **The rating scale is probed, not assumed.** |
| D102 | **Bags link to Decaid's bean library.** Pick a batch or let CafAI add one; CafAI only adds beans and batches, it never edits or deletes them. Every load writes the bag's batch, name and roaster into the workflow context. |
| D103 | **Decaid's plugins are optional.** Time-to-ready, Visualizer and DYE2 are used when `GET /api/v1/plugins` lists them loaded, and CafAI works the same without them. |
| D104 | **Real-Decaid tests are read-only on a tablet.** Writes run only against a simulator (`DECAID_WRITE=1`). |

## 4. Update safety

### 4.1 Typecheck against the pinned spec

```
contract/decaid/
  PIN.json             release tag, commit, sha256 of both specs, generator version
  spec/rest_v1.yml     verbatim from the pinned commit
  spec/websocket_v1.yml
  generated/rest.ts    openapi-typescript 7.13 output (never edited)
  generated/ws.ts      AsyncAPI schemas wrapped as OpenAPI 3.0, same generator, plus a channel map
  helpers.ts           Diff<From, To>, path accessors (response of a GET, body of a PUT, ...)
  checks/*.ts          the assertions: REST reads, REST writes, WebSocket frames, enums, status codes
  drift.ts             the exception registry (D94)
  schema.ts            OpenAPI 3.0 to JSON Schema (nullable, boolean exclusiveMinimum) for ajv
tsconfig.contract.json
scripts/decaid-contract.mjs   --update <tag|sha> | --check
```

- **Generation.** `openapi-typescript` (already a devDependency, 7.13.0;
  never `--enum`, which breaks `erasableSyntaxOnly`) on `rest_v1.yml`. The
  WebSocket file is self-contained and uses `nullable`, so its
  `components.schemas` are wrapped in a stub OpenAPI 3.0 document and run
  through the same generator; a hand-kept map ties each channel address to
  its receive and send types. Output files are `.ts`, not `.d.ts`, because
  `skipLibCheck` would skip a `.d.ts`.
- **Checks.** Reads compare spec to CafAI (`Diff<SpecResponse, CafaiType>`);
  writes compare CafAI to spec (`Diff<CafaiBody, SpecBody>`). Each diff must
  equal the exceptions recorded for that payload in `drift.ts`. Coverage:
  every payload in cafai.md section 1 (the experiment had 45 checks), plus
  the payloads the new features read (beans, batches, settings, plugins,
  display, time-to-ready frame).
- **Imports.** The checks import generated types through the aliases
  `#decaid/rest` and `#decaid/ws` (`paths` in `tsconfig.contract.json`), so
  the drift watch can point them at freshly generated files.
- **Scripts.** `npm run typecheck` runs `tsc -p tsconfig.json`, then
  `tsc -p tsconfig.contract.json`, then `node scripts/decaid-contract.mjs
  --check` (spec hashes match `PIN.json`; regenerating gives the committed
  files byte for byte). `npm run decaid:update -- <ref>` fetches both specs
  at a tag or sha from GitHub, writes them, regenerates, updates `PIN.json`
  and `src/api/decaidVersion.ts`, and prints what changed.
- **Lint.** `contract/decaid/generated/` is ignored by ESLint.

### 4.2 Mock contract test

`mock/decaid/contract.test.ts` (vitest) loads the pinned spec through
`contract/decaid/schema.ts` and validates with ajv (and `ajv-formats`):

- every fixture in `mock/fixtures/` against the schema of the reply it
  stands for;
- the replies and frames the mock produces for every route and channel
  CafAI uses, driven through the mock's own state (a scripted shot included);
- the request bodies CafAI sends (workflow PUT, profile POST, shot PUT,
  settings POST, bean and batch POST) against the request schemas.

Known spec errors are skipped by name through the same `drift.ts` registry
(for example `format: date-time` on Decaid's zone-less local timestamps,
and step `exit`/`limiter` that may be null). The test also fails when a
fixture differs from its copy in `docs/verified/examples/`, and lists
fixtures nothing uses.

### 4.3 Drift watch

`npm run decaid:watch` (`scripts/decaid-watch.mjs`) answers "would the
newest Decaid break CafAI?":

1. Resolve the latest release tag and `main` to commit shas (GitHub API;
   uses `GH_TOKEN` or `GITHUB_TOKEN` when set).
2. For each, fetch both specs. Same hashes as the pin: "no spec change".
3. Otherwise generate types into a temporary folder, run the contract
   typecheck with the aliases pointed there, run the ajv test against the new
   spec, and diff the specs structurally: operations added or removed (and
   whether CafAI calls them), and properties added, removed or retyped in
   the schemas CafAI reads or writes.
4. List the Decaid source files changed since the pin that CafAI depends on
   (GitHub compare API, filtered by a watch list: the webserver handlers
   and models CafAI reads, `doc/Skins.md`, `doc/Api.md`, the
   `visualizer`, `time-to-ready`, `settings` and `dye2` plugins), as "read
   these".
5. Print a markdown report (and write it with `--report <file>`). Exit 0
   when nothing changed or the changes are additive and pass; 1 when a check
   fails; 2 when GitHub could not be reached.

`.github/workflows/decaid-watch.yml` runs it daily and on demand; on exit 1
it opens an issue labelled `decaid-drift` with the report, or comments on
the open one. It runs once the repository is on GitHub; until then
`npm run decaid:watch` is the same check by hand.

### 4.4 Tests against a real Decaid

`npm run test:decaid` (`vitest.decaid.config.ts`, files in
`src/api/live/*.decaid.test.ts`, node environment) runs against
`DECAID_URL` (for example `http://192.168.1.42:8080` or the simulator's
`http://localhost:8080`) and is skipped without it. Everything goes through
CafAI's own client and parsers, and every reply is also validated against
the pinned spec, with the drift registry.

- **Always (read-only):** `GET` info, machine info, machine state, devices,
  workflow, settings, capabilities, grinders, beans and batches, plugins,
  display, shots/latest and that shot, the `cafai` KV namespace; every
  WebSocket channel CafAI opens yields frames its parsers accept (devices
  and shotState are replayed on connect; machine, scale and water frames
  arrive within 5 s when connected).
- **`DECAID_WRITE=1` (a simulator, never a tablet):** heartbeat; KV set, get
  and delete in `cafai-contract-test`; the rating-scale probe; a workflow
  round trip with a bundled template (PUT, read-back check, the machine
  profile barrier, then the original workflow restored); a profile created
  and hidden; a bean and batch created and archived; gateway mode read,
  set and restored.
- **`DECAID_SIM=1` (with writes):** a simulated shot: espresso, the shotState
  sequence, the shot record fetched and summarised by CafAI's summariser
  (non-empty measurements), annotations written and read back, then idle.

`scripts/decaid-ci.sh` downloads `decaid-linux-x64-<tag>.tar.gz` from
Decaid's GitHub release (default: the latest), starts it under
`xvfb-run -a` with temporary XDG folders and `--no-account
--bypass-onboarding --skin-path=dist`, waits for `GET /api/v1/devices`,
then `POST /api/v1/settings {"simulatedDevices":["machine","scale"],
"automaticUpdateCheck":false}` and `GET /api/v1/devices/scan?connect=true`
until both are connected. `.github/workflows/decaid-live.yml` (daily, on
demand, and callable by the release) builds CafAI, starts Decaid, runs
`test:decaid` with writes and the simulated shot, and runs one Playwright
spec, `e2e-real/real-decaid.spec.ts` (its own config, not part of
`npm run e2e`), that opens CafAI from Decaid's `:3000` and checks the app
is ready, connected and showing live readings. The same script and tests
run on the owner's Windows simulator (docs/SIMULATOR.md gains the steps).

### 4.5 Fail-safe runtime

- **Drift recorder** (`src/api/drift.ts`): `reportDrift({source, problem})`,
  where `source` is the route or channel and `problem` names a field path
  and what was wrong (types and enum values only, never free text or the
  key). Deduplicated, at most 50 kept, `console.warn` once per kind (Decaid
  serves WebView logs at `/api/v1/webview/logs`), subscribable.
- **Readers.** The replies now cast blindly get zod readers in
  `src/api/readers.ts` (`z.looseObject`, optional where Decaid omits,
  open enums): build info, machine info, workflow, profile record, shot
  summary and record, settings, plugins, beans, batches, display.
  `requestValue` takes the reader. A field CafAI cannot do without (the
  workflow's profile, a record's id) fails the call with
  `GatewayError('unexpected_reply')` and a drift report; anything else
  falls back to its default and reports drift.
- The rules for each silent failure are in section 5.

### 4.6 The version in About

`src/api/decaidVersion.ts` (written by `decaid:update`, checked by
`--check`) exports `{ release: '0.8.8', commit: 'aab5f93' }`. About shows
"Decaid 0.9.0 (CafAI was verified with 0.8.8)". A running Decaid older than
the pin adds "Older than the Decaid CafAI was checked against; update
Decaid if something does not work." Recorded drift adds "Decaid sent N
things CafAI did not expect" and Copy report. Versions are compared on
their numeric part (`0.8.8+2850` is 0.8.8); anything unparseable is shown
without a comparison.

### 4.7 Release gate

`release.yml` runs, before it publishes: typecheck (with the contract),
lint, unit tests, `npm run e2e`, and the `decaid-live` job against the
latest Decaid release. `ci.yml` already runs typecheck, so the contract
check runs on every push.

### 4.8 The draft for Decent

`docs/upstream/decaid-spec-fixes.md`: an issue text (and a patch outline)
listing each spec error with its Dart evidence: missing `required` lists,
`exit`/`limiter`/`version` that may be null, the workflow `id`, the machine
state lists (`schedIdle`, the seven states missing from the WebSocket
spec, `transportMode`, the `cleaingGroup` typo), KV status codes and
bodies, the error schema, zone-less timestamps marked `date-time`, tare
without a scale (500, not 404), `webview/logs` as text, Skins.md's
`{"usb": true}` example, `warningThresholdPercentage`, and Api.md's
brightness method. Fixing them upstream would remove most of `drift.ts`.
CafAI does not send it; the owner decides.

## 5. Fixes: Decent's patterns and the silent failures

| # | Thing | Rule |
|---|---|---|
| 5.1 | Gateway mode | Read `GET /api/v1/settings` at start, on each machine connect and when the page becomes visible. While `gatewayMode` is `full`, the machine alert says "Decaid is set to leave stopping shots to the skin, and CafAI does not stop them, so shots will not stop at the target weight." with **Let Decaid stop shots**, which sends `POST /api/v1/settings {"gatewayMode":"tracking"}` and reads it back. |
| 5.2 | `grinderBurrs` | Cleared with `grinderId`, `grinderModel` and `grinderSetting` when a load clears another skin's grinder, and modelled as optional in `WorkflowContext`. |
| 5.3 | KV backup read | `?full=1` answering anything but an object is "unreadable", not "empty": the restore does nothing, the push gate stays shut and retries, drift is reported. A 404 for the namespace is "empty" (the spec's reading), like `200 null`. |
| 5.4 | Late restore | A boot with no local bags that cannot reach Decaid keeps trying the backup (2 s doubling to 30 s, for 10 min, and again on reconnect or when the page becomes visible). When records land: `coach.refresh()`, the look re-read, and the note "Your bags are back from Decaid's backup." |
| 5.5 | Key re-entry | When a boot restored bags but has no key, the key prompt says "Decaid was updated or this browser's storage was cleared. Your bags are back; paste your API key again." |
| 5.6 | Key in Decaid (D99) | Settings > Coach: **Keep my API key in Decaid**, off by default, with "So you do not have to paste it again after a Decaid update. Any device on your network can read Decaid's store, and Decaid's backups include it." On: the key goes to `POST /api/v1/store/cafai-key/anthropic` now and on every change; off: `DELETE`. A boot with no local key reads it back when present. The `cafai` mirror, export and import never carry the key (the redaction stays), and README's Privacy section says so. |
| 5.7 | Stop (D97) | At rest (no Stop): `idle`, `schedIdle`, `sleeping`, `heating`, `preheating`, `booting`, `busy`, `needsWater`, `error`. Not to interrupt (no Stop): `fwUpgrade`, `calibration`, `selfTest`. Known running (Stop): today's nine. Anything else: Stop, the state shown humanised, and drift reported. |
| 5.8 | Readings | A machine reading missing from a frame is `null`, shown as a dash, left out of the graph, and reported as drift; never 0. |
| 5.9 | Shot detection | The machine-state fallback stays armed: when the machine is in `espresso` and no `shotState` frame with a known state has arrived for 3 s, the shot starts from the machine state and ends when it leaves `espresso`. An unknown `shotState` state is reported as drift. |
| 5.10 | Shot credit | A shot record without `workflow.profile` is credited as today, with drift reported and the chat note "Decaid's record did not say which profile ran; CafAI counted it for vN." |
| 5.11 | Writes that cannot succeed | The outbox retries network failures, timeouts, 408, 409, 425, 429 and 5xx. Any other 4xx drops the write, reports drift and shows once "Decaid would not save <the taste / the stars / the grinder> for this shot: <reason>." A non-string `espressoNotes` is treated as empty, with drift. |
| 5.12 | Barrier | When `POST /machine/profile` answers 404 or 405, the chat says once per session "This Decaid cannot confirm that the machine took a profile, so CafAI will assume it did." |
| 5.13 | Workflow PUT | Deadline 35 s. On a timeout or a 503, CafAI reads the workflow back: if it holds what was sent (the read-back check passes and the tag matches), the load counts; otherwise it fails as today. |
| 5.14 | Rating scale (D101) | Before the first `enjoyment` write in a session: `PUT /api/v1/shots/<a random id that does not exist> {"annotations":{"enjoyment":11}}`. A 400 that mentions enjoyment means 0-10 (stars x 2); a 404 means 0-100 (stars x 20); anything else leaves the stars in the outbox until the probe can run. Reads of `enjoyment` use the same scale. |
| 5.15 | Backup health | Settings > About shows "Backed up to Decaid N min ago" or "Backup paused: <reason>" from the mirror's `lastPushAt` and `lastError`. |
| 5.16 | Overscroll | Already in place: `body` has `overscroll-behavior: none` (`src/ui/theme.ts:133`), which streamline added in 7aa2ddb. |
| 5.17 | Soft keyboard | Not changed blind: docs/HARDWARE_TEST_PLAN.md gains a check that the composer stays visible with the keyboard open on a Decent tablet (streamline lifts its canvas by the keyboard overlap, b10fabe). |

## 6. Decaid features

### 6.1 Bean library (D102)

- **Data.** `Bag` gains `decaidBeanId`, `decaidBatchId` and `roastDate`
  (ISO date), all `string | null`, default `null`; the storage schema, the
  mirror and export/import accept bags without them.
- **Picking.** When a new bag starts, the chat shows a card, "Which coffee
  is it?", before the coach's first question: one row per unarchived batch
  in Decaid's library (`GET /api/v1/beans` and each bean's batches; newest
  roast date first, batches without one by creation date; at most 8),
  showing name, roaster and roast date, then **Photo of the bag** (6.8) and
  **Something else**. With no library, or Decaid out of reach, the card
  has only those two. Picking a batch
  fills the bag (name from the bean's name, at most 40 characters;
  roaster; origin from country and region; process from `processing`;
  notes; roast level when it matches one of CafAI's five; roast date) and
  links both ids; the coach's intake turn is told "The user picked <name>
  by <roaster> from Decaid's bean library", with the details. Something
  else: today's intake.
- **Adding.** When `save_bag_details` runs for a bag with no link, CafAI
  looks for a bean with the same roaster and name (case-insensitive) and
  reuses it, or creates one (`POST /api/v1/beans`: roaster, name, country,
  processing, notes); then creates a batch (`POST /api/v1/beans/{id}/batches`:
  roast date and roast level when known), links both, and adds the chat
  line "Added to Decaid's beans." A failure is reported as drift or a
  network problem and tried again at the next save. CafAI never edits or
  deletes a bean or batch; a detail corrected in the chat changes the bag
  only.
- **Loads.** Every load writes `beanBatchId` (the bag's batch or `null`),
  `coffeeName` (the bag's name) and `coffeeRoaster` into the workflow
  context, instead of clearing them.
- **Coach.** `save_bag_details` gains `roastDate` (`YYYY-MM-DD` or null);
  the prompt gives the roast date and the age in days, less the days the
  batch spent frozen when `freezeDate`/`unfreezeDate` say so.

### 6.2 Connect

The "not connected" alert gets **Connect** for whatever is missing (machine,
scale): `connectKind()` (scan, then connect the preferred or first found),
with "Looking for your DE1..." while it runs and `describeFailedConnect()`
when it fails; one scan at a time. Scale revive (decaid-zen's rule): when
the machine wakes or the page becomes visible, no scale is connected and
one was this session, one quick scan-and-connect for scales, at most every
30 s, never during a shot, steam, hot water or flush.

### 6.3 Ready in about N min (D103)

When `time-to-ready.reaplugin` is loaded, CafAI subscribes to
`/ws/v1/plugins/time-to-ready.reaplugin/timeToReady`. While its `status` is
`heating` with an estimate, the stats card shows "Ready in about N min"
(under a minute: "Ready in under a minute"). A frame without an estimate
keeps the last one (streamline b471ce3); `reached`, `not_heating` and
`insufficient_data` hide it.

### 6.4 Visualizer link (D103)

When `visualizer.reaplugin` is loaded, after a shot's card reaches the chat
CafAI reads `GET /api/v1/store/visualizer.reaplugin/lastUploadedShot` every
3 s for up to 30 s (streamline's rule). When it names this shot, the shot
card gets **On Visualizer**, a plain link to the shot's Visualizer page
(Decaid opens it in the system browser). The link is kept with the
iteration so History shows it too.

### 6.5 The coach reads DYE2 (D103)

A new auto tool, `get_recent_setups`: DYE2's recent setups for this bag's
batch (or, unlinked, its name and roaster), each with profile title, grind
setting, dose, yield, rpm, basket and date, plus the equipment and basket
names DYE2 knows. Source: `GET /api/v1/plugins/dye2.reaplugin/recent-favs`
when DYE2 is loaded, else its KV keys (`autoFavourites`, `recipes`,
`equipment`, `baskets`, read-only, non-arrays read as empty). Without DYE2:
`{"available": false}`. The tool description tells the coach to look at
intake for a known bean. CafAI never writes DYE2's data.

### 6.6 Steam, hot water and flush

Settings gains **Steam, hot water and flush**: steam temperature, time and
flow; hot water temperature, volume, time and flow; flush time, temperature
and flow. Values come from `GET /api/v1/workflow` (`steamSettings`,
`hotWaterData`, `rinseData`) and are written as `PUT /api/v1/workflow`
partials, clamped to the ranges in Decaid's spec, never while a shot,
steam, hot water or flush runs (the controls say why). The machine row's
buttons keep starting with whatever is set.

### 6.7 Skip step

In the Shot view during an espresso, **Next step** (a tonal button beside
the step name, never in the top bar) sends `PUT /api/v1/machine/state/skipStep`.
It shows only while the machine is in `espresso` and the profile has a step
after the current one.

### 6.8 Bag photo

**Photo of the bag** (on the "Which coffee is it?" card) opens
`<input type="file" accept="image/*"
capture="environment">`: inside Decaid that asks for camera consent once
per skin; on a phone it opens the browser's picker. The image is scaled to
at most 1568 px on its longest side as JPEG and sent once, not streamed, to
the coach's model, asking for the bag's details as JSON (name, roaster,
origin, process, roast level, roast date, tasting notes, each null when not
on the bag). The answer fills a confirm card the user can edit; Confirm
saves it like `save_bag_details` and links or adds the bean (6.1). The photo
is never stored or mirrored. Without an API key the action says "Add your
API key in Settings first."

## 7. Testing

- Unit tests beside each change (vitest), as everywhere in CafAI.
- The mock Decaid gains: settings with `gatewayMode` (and the POST);
  `enjoyment` validated 0-10, with a switch for the 0-100 behaviour; a
  plugin list; beans and batches; the time-to-ready channel; the Visualizer
  plugin's `lastUploadedShot`; DYE2's recent-favs and KV keys; `skipStep`;
  `steamSettings`, `hotWaterData` and `rinseData` in the workflow; a delay
  switch on the workflow PUT. The demo seed gets two beans.
- The scripted coach (docs/briefs/ENGINE_PROTOCOL.md) answers the bag-photo
  request with a canned bag, and sends `roastDate` in `save_bag_details`.
- e2e: the bean card (pick, something else), the gateway alert and its
  switch, Connect, the steam and hot water settings, Next step, the photo
  flow with a fixture image, the key opt-in, About's versions and drift
  report. The Chromium 91 loop runs unchanged and adds the bean card.
- The contract typecheck, the mock contract test, `decaid:watch` against
  `af4e995`, and `test:decaid` against the owner's simulator before the
  work is called done.

## 8. Out of scope

Derek and Decent's Profile Generator (not chosen). Device pairing screens
beyond Connect, firmware, Wi-Fi, calibration, presence and skin management,
which stay in Decaid's own settings. A companion Decaid plugin. Sending
anything upstream.

## 9. Order of work

| Wave | Work (one agent each, disjoint files) |
|---|---|
| 0 | Branch `feat/decaid-alignment`; dependencies (`yaml`, `ajv`, `ajv-formats`), scripts and ids; interfaces the waves share (drift recorder, readers' signatures, the new `Bag` fields, the settings and plugin client calls) |
| 1 | **contract** (4.1, 4.2, 4.3, 4.8) / **live** (4.4, 4.7) / **api** (4.5 readers and recorder, 5.3, 5.7, 5.8, 5.9, 5.13, 5.14's probe, the new client calls) / **mock** (section 7's mock and seed changes) |
| 2 | **engine** (5.2, 5.4, 5.5, 5.6's storage, 5.10, 5.11, 5.12, 5.14's use, 6.1's data, loads and creation) / **machine** (5.1, 6.2, 6.3, 6.7) / **settings** (4.6, 5.6's switch, 5.15, 6.6) |
| 3 | **intake** (6.1's card, 6.8, the coach's `roastDate`, 6.5, 6.4) |
| 4 | e2e and the Chromium 91 loop; docs (DECISIONS D93-D104, README, DESIGN, SIMULATOR, HARDWARE_TEST_PLAN, MORNING); `test:decaid` on the simulator; a fresh-eyes review |

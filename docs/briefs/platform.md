# Workstream: platform (Decaid grinders, the mock machine's own profile, Settings grinder picker)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Read `docs/verified/02-api.md` sections 6, 8 and 10,
DECISIONS.md (D14, D16, D36, D45, D54, D55, D62) and `docs/briefs/engine-loop.md`
(another workstream codes against the mock contract you implement).
Reference clones (`.ref/`, `crema/`) are git-ignored, so they are not in
your worktree: read Decaid's source at `E:\source\cafai\.ref\decaid\...`
(the source wins over any doc).

Three parts. The engine is NOT yours: another workstream is changing
`src/app/**` right now, and a later workstream wires your grinder pieces into
the engine. Build the pieces, their tests, and the UI; leave the wiring.

## Part 1: Decaid's grinder library (QUESTIONS #8, D62)

The owner: "use what Decaid has available. But in the text sent to the user
just let them know." Decaid keeps grinders at `GET/POST /api/v1/grinders`,
`GET/PUT/DELETE /api/v1/grinders/{id}` (`includeArchived`, sorted by
`updatedAt` desc, archived hidden by default). Fields: `id`, `model`
(required), `burrs`, `burrSize`, `burrType`, `notes`, `archived`,
`settingType` (`numeric` | `preset`; `values` is accepted as `preset`,
anything unknown becomes `numeric`), `settingValues` (string[]),
`settingSmallStep`, `settingBigStep`, `rpmSmallStep`, `rpmBigStep`, `extras`.
No min/max, no units, no current setting, no "which way is finer". Source:
`.ref\decaid\lib\src\services\webserver\grinders_handler.dart`,
`...\models\data\grinder.dart`.

1. `src/api/grinders.ts` (+ test, new): the `Grinder` wire type and
   `listGrinders(...)`, `getGrinder(...)`, built on `request`/`requestJson`
   from `src/api/http.ts` with a transport for the client's `httpOrigin`.
   Do NOT add them to the `DecaidClient` interface in `src/api/types.ts`
   (other workstreams' fakes implement it). Export them from
   `src/api/index.ts`. Tolerate unknown fields and missing optional ones.
2. `Settings` gets an OPTIONAL `grinderId?: string | null` (the Decaid
   grinder the user linked; optional so existing `Settings` literals in other
   workstreams' files still compile): `src/storage/types.ts`, defaults and
   normalization and merge in `src/storage/settings.ts` (normalize to
   `null`), the import schema `src/storage/schema.ts` and the KV mirror
   (backups and exports without it still load). Tests.
3. Settings screen (`src/ui/settings/SettingsScreen.tsx`): a grinder picker.
   - Read Decaid's grinders (non-archived) when the screen opens. Show a
     select labelled "Grinder from Decaid" with each grinder's `model` (and
     burrs when present), plus "Not in Decaid's list" which keeps today's
     free-text grinder name field.
   - Under the picker, tell the user plainly what CafAI will use: "Decaid
     lists steps of 0.5 for this grinder (big steps 2)." for numeric with a
     step; "Decaid lists 40 settings for this grinder." for preset; "Decaid has
     no step size for this grinder, so the coach gives directions only." when
     neither exists. When Decaid is unreachable or has no grinders, keep
     today's two text fields and add one line: "Add your grinder to Decaid's
     grinder library (for example with the DYE2 plugin) and CafAI will use
     its step size."
   - The current-setting field stays free text; for a preset grinder it is a
     select over `settingValues` (keep the existing value even when it is not
     in the list).
   - Save writes `grinderId`, `grinderName` (the model when one is picked)
     and `grinderSetting`, then calls `coach.refresh()` exactly as today. Do
     not write to Decaid's workflow from the Settings screen (the engine
     does that; linking `context.grinderId` is the later workstream's job).
   - Keep the existing `TID.grinderName` / `TID.grinderSetting` on the text
     fields. Do not edit `src/ui/testIds.ts`: locate the new select by its
     label. Full 48 px controls; fits 962x602.

## Part 2: the mock machine holds its own profile (QUESTIONS #1, D55)

Implement exactly this contract in `mock/` (the engine workstream's e2e spec
relies on it; see `docs/briefs/engine-loop.md` Feature 1):

- The mock DE1 holds its own profile, separate from `workflow.profile`. A
  workflow PUT with a profile that differs from the held one (all ten profile
  keys compared, like Decaid's equality) starts an upload while the machine
  is connected; it completes after `uploadMs` (option `uploadMs`, URL switch
  `?mockUploadMs=N`, default 800 ms of wall clock, NOT scaled by mockSpeed).
  Uploads run one at a time, first in first out. With no machine the upload
  waits for the next connect.
- `POST /api/v1/machine/profile` with a full profile: waits for any upload in
  flight, then answers 200 `null` (uploading first, `uploadMs` again, when
  the held profile differs from the posted one). No machine: 500 with the
  exact body Decaid sends (find it in `.ref\decaid\lib\src\services\webserver\de1handler.dart`
  ~689-718 and ~859-877). Bad JSON: 400. Honour `state.failNext` faults on
  the route (e.g. 504). `?mockNoMachineProfile=1` (option
  `machineProfileRoute: false`) makes the route answer the plain-text 404
  "Route not found", like an older Decaid.
- `state.getMachineProfile()` returns the held profile (a clone).
- The shot player runs the HELD profile, not the workflow's (today
  `shotPlayer.ts` ~690-708 reads the workflow). The shot record still copies
  the workflow at shot end, like Decaid, so a shot started during an upload
  window reproduces QUESTIONS #1: it runs the old profile while its record
  names the new one.
- A REST espresso start (`PUT /api/v1/machine/state/espresso`) that arrives
  while an upload is in flight waits for the upload to finish (Decaid sends
  both through one write queue). `player.start()` called directly (a
  group-head press) does not wait.
- Also, from the Gentle and Sweet audit: Decaid stops a shot at the profile's
  `target_volume` (ml counted from `target_volume_count_start`) when
  stop-at-weight does not apply; the mock only stops at weight. Read
  `.ref\decaid\lib\src\controllers\shot_sequencer.dart` (~464-486) for the
  exact rule and implement it in the shot simulation, with tests (Gentle and
  Sweet without a scale stops near 36 ml; the Allongé near 180 ml).

## Part 3: grinders in the mock

`GET/POST /api/v1/grinders`, `GET/PUT/DELETE /api/v1/grinders/{id}` with
Decaid's rules (POST 201, `model` required else 400; PUT shallow merge with
the null and type rules in `grinders_handler.dart`; DELETE is a hard delete
and answers 200 even for an unknown id; archived hidden unless
`includeArchived=true`; sorted by `updatedAt` desc). Seed two or three
plausible grinders (one numeric with `settingSmallStep` 0.5, one numeric with
step 1, one preset with a short `settingValues` list) unless
`?mockGrinders=0` (option `seedGrinders: false`). Mark them as mock data.

## You own (create or modify only these)

- `src/api/**` EXCEPT `src/api/machineProfile.ts` (the engine workstream
  creates it). Do not change the `DecaidClient` interface.
- `src/storage/**`.
- `src/ui/settings/**`.
- `mock/decaid/**`, `mock/browser.ts` (new URL switches; document them in its
  header), `mock/fixtures/**`, `mock/node.ts` if needed. NOT `mock/persist.ts`
  (another workstream creates it) and not `mock/anthropic/**`.
- New e2e spec (you may not run it): `e2e/settings-grinder.spec.ts`: pick a
  seeded grinder, see its step line, save, reload, still linked; with
  `?mockGrinders=0` the free-text fields and the library hint show.

Read-only for you: `src/app/**`, `src/coach/**`, `src/ui/chat/**`,
`src/ui/machine/**`, `src/ui/shell/**`, `src/ui/testing/fakeServices.ts`
(override what you need inside your own tests), `src/ui/testIds.ts`,
`src/main.tsx`, `index.html`, `e2e/helpers.ts`, `package.json`, configs,
docs.

## Interfaces to keep

`DecaidClient` and `TelemetryStore` unchanged; `MockDecaid` grows
(`getMachineProfile`, grinder accessors) but keeps every existing member; the
mock's existing URL switches and defaults (a spec that sets none of the new
switches behaves as today, except that a shot now runs the held profile,
which equals the workflow's once its upload finished); `Settings` keeps its
fields.

## Tests you must add and how to verify

- `src/api/grinders.test.ts` (MSW node server or a fake fetch).
- Storage: `grinderId` defaults, normalization, merge, import of an old
  export without it, mirror round trip.
- Settings screen (jsdom): picker lists grinders; step line per kind; "not in
  the list" keeps free text; preset setting select; unreachable Decaid shows
  the hint; save writes all three fields and calls `coach.refresh()`.
- Mock: held profile vs workflow; upload timing with fake timers; POST
  barrier waits for an upload in flight; no machine -> 500 body; faults;
  `?mockNoMachineProfile`; espresso start waits for an upload; a shot started
  during an upload runs the old profile and its record names the new one;
  volume stop; grinder routes (CRUD, validation, archive filter, sort,
  seed switch).
- Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
  never through `| tail`): `npm ci` (first, in your worktree),
  `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run`
  (whole unit suite). Do not run Playwright.

## Report back (your last message, at most 60 lines)

Files changed (grouped); tests added (counts, all passing?); every command
with its exit code; the exact no-machine body; the `target_volume` rule you
implemented with its source lines; the public signatures of
`src/api/grinders.ts` and the new `MockDecaid` members; known gaps.

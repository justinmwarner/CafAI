# Workstream: engine-loop (machine-load wait, feedback to Decaid, retries, lost-shot progress)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then read `docs/briefs/ENGINE_PROTOCOL.md`, DECISIONS.md
(especially D41-D47, D51-D55, D61, D64-D65) and `src/app/engine/engine.ts`
end to end. Reference clones (`.ref/`, `crema/`) are git-ignored, so they are
not in your worktree: read them at `E:\source\cafai\.ref\...`.

Four features, all in the coach engine. Work through them in this order and
keep each one green before the next: they share the engine and its tests.

## Feature 1: wait until the machine holds a new profile (QUESTIONS #1, D55)

Today "Loaded vN on the machine" is said as soon as `PUT /api/v1/workflow`
returns, but Decaid uploads the profile to the DE1 after it answers, so a shot
pulled in that window can run the old profile while its record names the new
one. Decaid has no endpoint that reads the loaded profile back. It does have
a barrier: **`POST /api/v1/machine/profile`** with the full profile runs the
upload through the same first-in-first-out BLE write queue as the workflow
sync, and answers 200 `null` only after every write was acknowledged and a
500 ms guard elapsed; when the machine already holds an equal profile it
answers at once. Errors: 400 bad JSON; 500 no machine, profile parse error or
failed write; 503 write queue full; 504 BLE timeout. Sources (read them):
`E:\source\cafai\.ref\decaid\lib\src\services\webserver\de1handler.dart`
(lines ~24, 689-718, 859-877), `...\controllers\workflow_device_sync.dart`,
`...\models\device\impl\de1\unified_de1\unified_de1.dart` (~452-473),
`E:\source\cafai\.ref\decaid\doc\Profiles.md` (~595-598). Find the exact
error body Decaid sends when no machine is connected, so you can tell
"offline" from "failed".

1. New `src/api/machineProfile.ts` (+ test): `loadProfileOnMachine(...)`,
   built on `request`/`requestJson` from `src/api/http.ts` with a transport
   for the client's `httpOrigin` (do NOT add it to the `DecaidClient`
   interface: other workstreams' fakes implement that interface). It posts the
   profile exactly as Decaid returned it from the workflow PUT, with a 20 s
   deadline, and resolves to `'loaded' | 'offline' | 'unsupported'`
   (404/405: an older Decaid without the route) or throws a `GatewayError`
   with a sentence a barista can act on.
2. Every activation (template pick, confirmed change, undo, Retry, bag
   switch: everything that goes through `activate()`) becomes: workflow PUT,
   then the barrier. While it runs, show a transient progress notice
   ("Loading Kiambu AA v2 on the machine…", see Feature 4 for "transient")
   and keep `busy` true. Then:
   - **loaded**: today's success notice ("Loaded … on the machine."), clear
     the standing load problem;
   - **offline** (or the machine was not connected when the PUT returned):
     "Saved …. Decaid loads it when the machine connects." When the machine
     connects later (telemetry `machineConnected` false -> true) and the
     active version is still unconfirmed, run the barrier again and say
     "Loaded … on the machine." once it answers (this only waits for
     Decaid's own upload; it never changes what the machine gets: D42);
   - **failed** (500 write failure, 503, 504, timeout): the version stays
     the bag's active version (the workflow carries it and Decaid keeps
     retrying its own upload at 3 s, 10 s, 30 s...), with a warning notice,
     the standing load problem and Retry (D51/D52), and no shot is credited
     to it until a barrier succeeds;
   - **unsupported**: today's behaviour (say loaded when connected),
     remembered for the session so the route is not retried every time.
3. **A shot that STARTED while the active version was still loading or
   failed is not credited to it** (use telemetry `onShot` `started`): "That
   shot started before the machine finished loading vN, so it is not part of
   this dial-in." All D41 checks stay as they are.
4. Model payloads keep their exact shapes (ENGINE_PROTOCOL rules 2 and 5).
   `onMachine` is true only when the barrier said loaded (or unsupported and
   connected). A confirmed change whose PUT succeeded but whose barrier
   failed IS applied (the version exists and is active): `applied: true,
   onMachine: false`, with CafAI's own warning and banner. A PUT that fails
   keeps D43 (the card stays pending with Retry).

The mock is being extended in parallel by the `platform` workstream, not by
you. Code against this contract (your e2e spec relies on it):
- the mock DE1 holds its own profile, separate from the workflow; a workflow
  PUT with a different profile (all ten keys compared) uploads it after
  `?mockUploadMs=N` ms (default 800, wall clock, not scaled by mockSpeed)
  while the machine is connected, and on connect otherwise;
- `POST /api/v1/machine/profile` waits for any upload in flight, then answers
  200 `null` (uploading first when the held profile differs); with no machine
  it answers 500 with Decaid's body; `?mockNoMachineProfile=1` makes the route
  answer 404 "Route not found" like an older Decaid;
- `window.__CAFAI_MOCK__.state.getMachineProfile()` returns the held profile;
  the shot player runs the held profile; a REST espresso start waits for an
  upload in flight.

## Feature 2: retry Decaid writes that failed (MORNING gap, D64)

Today a grind setting confirmed (or saved in Settings) while Decaid is
unreachable is dropped (`.catch(() => undefined)`) until the next profile
load. Add `src/app/engine/outbox.ts` (+ test): keyed, latest-wins pending
writes to Decaid. Each task is idempotent. It runs at once; on failure it
stays pending and is retried when Decaid is reachable again (telemetry
`sockets.devices` back to `open`, or the machine connects), every 30 s while
anything is pending, and before a finished shot is handled; a successful
activation, whose context carries the grinder, satisfies a pending grinder
write. Keys: `grinder` (context `grinderModel`/`grinderSetting`, from a
confirmed grind move and from `refresh()` after a Settings save) and
`shot:<id>` (Feature 3). When a grinder write fails, say so once in the chat
(e.g. "Decaid can't be reached right now. CafAI will send grinder setting 14
as soon as it can."); no notice on the later success. In memory only: a
reload drops pending writes (the next activation writes the grinder anyway);
say so in your report. `dispose()` stops its timer.

## Feature 3: write taste feedback to Decaid's shot record (QUESTIONS #7, D61)

The owner said yes to writing feedback back to Decaid (visible in Decaid and
Visualizer). Facts (`docs/verified/02-api.md` section 8 "Update"): `PUT
/api/v1/shots/{id}` deep-merges; `annotations.extras` merges per key;
`annotations.espressoNotes` is a string and is REPLACED; `enjoyment` is a
number 0-10 (Visualizer shows it x10). `DecaidClient.updateShot` exists.

1. When the taste question is answered (chips, or typed while it is open,
   D44), write through the outbox to the iteration's shot:
   `annotations.espressoNotes` and `annotations.extras.cafai` (bag id, version
   id and number, the selected options, the typed text, and the notes line
   CafAI wrote). Notes are short, e.g. "Taste: Sour / sharp. Kiambu AA v2
   (CafAI)", passed through `redactKeyLike` (D37). Never clobber notes a
   person wrote in Decaid: when the record's notes are empty or exactly what
   CafAI wrote last time (`extras.cafai.notes`), replace them; otherwise
   append CafAI's line on a new line. Use the shot record CafAI already
   fetched (`shotCache`) or read it again.
2. **Enjoyment comes only from the user.** Taste options are free text from
   the model, so mapping them to a number would invent data. The shot card
   gets an optional five-star rating ("How much did you enjoy it?"); a tap
   writes `annotations.enjoyment = stars * 2` (and `extras.cafai.stars`)
   through the outbox. A re-tap changes it. The rating lives on the shot UI
   part, so it survives a reload with the transcript. Add
   `rateShot(shotId: string, stars: number): Promise<void>` to
   `CoachController`. Each star is a 48 px touch target with an accessible
   name ("Rate 4 out of 5") or the set is a labelled radio group; the card
   must still fit 962x602 without pushing the taste chips below the fold
   (D48: the chat follows the newest prompt).
3. The model protocol does not change: the rating is not sent to the coach.

## Feature 4: show progress while CafAI looks for a lost shot (MORNING gap, D65)

After a shot, `fetchShot` asks Decaid for the record for about 15 s (6
tries, doubling delay). Nothing is shown meanwhile. Once the first try
misses, show a progress notice in the chat ("Looking for that shot in
Decaid…" with a progress indicator; determinate by elapsed time or "try 3 of
6"), updated in place on each try and removed when the search ends (replaced
by the shot card or the existing warning). Same when Retry on the "Decaid has
not saved that shot yet." banner searches again. Keep `busy` true while
searching.

**Transient notices** (this one and Feature 1's) are never stored: the
conversation that `persistConversation` saves must not contain them, and a
stored conversation that somehow has one drops it on load. Extend the notice
part in `src/app/types.ts` (for example an optional `progress` field, or a
new part kind) and render it in the chat (`Notice.tsx`/`ChatSurface.tsx`)
with an MUI `LinearProgress` or `CircularProgress`, role `status`.

## You own (create or modify only these)

- `src/app/**` (engine, engine tests, `protocol.ts`, `uiMessages.ts`,
  `ports.ts`, new `outbox.ts`, `adapters.ts`, `createServices.ts`,
  `types.ts`).
- `src/api/machineProfile.ts` and its test (new). Nothing else in `src/api/`.
- `src/ui/chat/**` (ChatSurface, CoachScreen, parts such as `ShotCard.tsx`
  and `Notice.tsx`, their tests and test helpers, previews).
- `src/ui/testing/fakeServices.ts` (e.g. `FakeCoach.rateShot`).
- New e2e specs (you may NOT run them; the coordinator does):
  `e2e/machine-load.spec.ts`, `e2e/decaid-writes.spec.ts`,
  `e2e/shot-search.spec.ts`.

Read-only for you: everything else. In particular `src/coach/**` (another
workstream), `src/storage/**`, `src/ui/settings/**`, `src/ui/machine/**`,
`src/ui/shell/**`, `src/ui/history/**`, `src/ui/testIds.ts` (locate new
elements by role and accessible name), every other file in `src/api/`,
`mock/**`, `e2e/helpers.ts`, `src/main.tsx`, `index.html`, `package.json`,
configs and docs. If you need a change there, describe it in your report.

## Interfaces to keep

- `CoachController`'s existing methods and `CoachState`'s existing fields
  (you add `rateShot` and may add optional fields/parts).
- ENGINE_PROTOCOL turns, byte for byte in shape (no new fields to the model).
- D41-D47, D51-D54 behaviour; one engine action at a time (`enqueue`).
- `ApiPort` grows (`loadProfileOnMachine`, `updateShot`); keep the rest.

## Tests you must add and how to verify

- Unit (fake clock, fake ports, as in `engine.test.ts`): every barrier
  outcome (loaded, offline then reconnect, failed then Retry, unsupported),
  the transient notice never persisted, a shot started while loading not
  credited, a shot started after loading credited; the outbox (latest wins,
  each retry trigger, timer, dispose); grind confirm and Settings refresh
  while unreachable, then delivered; taste answer -> notes merged (empty,
  CafAI's own, a person's), typed feedback path, redaction, `rateShot` ->
  enjoyment, failures retried; lost-shot notice appears only after a miss,
  updates, disappears; ShotCard rating UI; `machineProfile.ts` status mapping.
- E2E specs (written carefully, run by the coordinator; wait for the newest
  card or chip before tapping it: older ones stay in the DOM):
  - `machine-load.spec.ts`: `?mockUploadMs=3000`: pick a template -> the
    "Loading … v1 on the machine…" notice is visible -> then "Loaded … v1 on
    the machine." and `getMachineProfile().title` is "… v1"; with
    `?mockNoMachineProfile=1` the loop still reaches v2.
  - `decaid-writes.spec.ts`: tap a taste chip -> the shot record's
    `annotations.espressoNotes` names it and `extras.cafai` is set; tap four
    stars -> `enjoyment` 8, still shown after a reload; a grind move confirmed
    while `PUT /api/v1/workflow` fails (`state.failNext({ method: 'PUT',
    path: '/api/v1/workflow', status: 503, times: N })`) reaches the
    workflow context after `state.dropSockets('devices')`. (The scripted
    coach proposes a grind move for a taste it does not recognise; it names
    the new setting when Settings holds a plain number, ENGINE_PROTOCOL rule
    2.)
  - `shot-search.spec.ts`: `state.failNext({ method: 'GET', path:
    /^\/api\/v1\/shots\/[^/]+$/, status: 404, body: { error: 'Shot not
    found' }, times: 3 })` before the shot -> the progress notice is visible,
    then the shot card appears and the notice is gone; a machine dropped
    mid-shot (`state.setMachineConnected(false)` while pouring) -> notice,
    then the warning with Retry; Retry shows the notice again.
- Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
  never through `| tail`): `npm ci` (first, in your worktree),
  `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run`
  (whole unit suite). Do not run Playwright or `npm run e2e`.

## Report back (your last message, at most 60 lines)

Files changed (grouped); tests added (counts, all passing?); every command
with its exit code; the exact strings Decaid sends for "no machine"; any
change you needed outside your files; known gaps.

# Workstream: engine-wiring (v1 from the dose, Decaid's grinder in the engine)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D41-D47, D54-D57, D59, D61, D62, D64,
`docs/briefs/ENGINE_PROTOCOL.md`, and `src/app/engine/engine.ts` end to end.
Reference clones (`.ref/`, `crema/`) are git-ignored, so they are not in
your worktree: read them at `E:\source\cafai\.ref\...` if you need them.

The coach logic and the platform pieces are merged and tested; this
workstream wires them into the engine and the coach protocol.

What already exists (read the code; do not change it):

- `src/coach/start.ts`: `startingYield(template, doseG)`,
  `buildStartingProfile(template, doseG)` (the bundled profile with only
  `target_weight` set from the author's ratio x the dose; a dose outside
  12-25 g counts as unknown and the 18 g reference is used, D57).
  `src/coach/dose.ts`: `knownDose`, `REFERENCE_DOSE_G`.
- `src/coach/grinder.ts` and the validator: `ValidationContext.grinder?:
  GrinderInfo | null`; with it, a relative grind move becomes the new
  setting (`plan.contextPatch.grinderSetting`) and a named setting is checked
  against the grinder's grid; `plan.grindSettingFrom` says where it came
  from; the change card text already says so (`describeManualSteps`).
- `src/api/grinders.ts` (platform workstream): `getGrinder(source:
  Pick<DecaidClient, 'httpOrigin'>, id: string, options?): Promise<Grinder |
  null>` (null on 404; throws `GatewayError` otherwise), `listGrinders(...)`,
  `parseGrinder`, and `grinderSteps(grinder)` -> `{ kind: 'numeric',
  smallStep, bigStep } | { kind: 'preset', values } | { kind: 'none' }`.
  The `Grinder` wire type has `model`, `settingType`, `settingSmallStep`,
  `settingBigStep`, `settingValues` (nullable).
- `Settings.grinderId?: string | null` (platform workstream; storage always
  normalizes it to `null` when absent). The Settings screen saves `grinderId`,
  `grinderName` (the model when linked) and `grinderSetting`, then calls
  `coach.refresh()`.
- The mock seeds three grinders with fixed ids (`MOCK_GRINDER_IDS` in
  `mock/decaid/grinders.ts`): Niche Zero (numeric, step 0.5), Comandante C40
  MK4 (numeric, step 1), Baratza Encore ESP (preset "1"-"12"); `?mockGrinders=0`
  seeds none.
- The engine-loop workstream's changes (merged): the Decaid write outbox
  (`src/app/engine/outbox.ts`); `sendGrinder()` in `engine.ts` writes
  `{grinderModel, grinderSetting}` under the outbox key `grinder` and is called
  from a confirmed grind move and from `refresh()` when the grinder changed
  (`grinderChanged`); every activation is a workflow PUT followed by the
  machine-load barrier (`confirmOnMachine`, "Loading … on the machine…" then
  "Loaded … on the machine."); shot cards carry an optional star rating; the
  taste answer is written to the shot record.

## Part 1: v1 starts from the dose (QUESTIONS #3, D57)

1. At a template pick, read `GET /api/v1/workflow` first (the dose may have
   changed since the bag opened; a failed read keeps the session's dose) and
   build v1 with `coach.buildStartingProfile(template, doseG)` instead of the
   bundled profile. Add `buildStartingProfile` (and anything else you need)
   to `CoachPort` (`ports.ts`) and `createCoachPort` (`adapters.ts`), and to
   the engine tests' fake coach.
2. Tell the user where v1 stops and why, in CafAI's own notice after the
   pick, e.g. "Kiambu AA v1 stops at 50 g: 2.8 x the 18.0 g dose in Decaid."
   When Decaid's dose is unknown or outside 12-25 g, say v1 assumes 18 g and
   that setting the real dose in Decaid lets CafAI use it.
3. The model learns it too (protocol change, document it in
   `docs/briefs/ENGINE_PROTOCOL.md`): the template-picked result (rule 2) gets
   `"yieldG": number` and `"doseG": number | null` (the dose used when it is
   known, else null), and the intake `[context]` (rule 1) gets
   `"doseG": number | null`. Update `src/coach/prompt.ts` (rules 1-2 of the
   turn description) to match, and its test.
4. v1's `POST /api/v1/profiles` names the template's bundled default
   (`template.decaidDefaultId`) as `parentId`, so Decaid's library shows v1
   under the profile it came from (D59). If Decaid answers 400 for the parent,
   post again without it. Keep the existing `deduped` note.

## Part 2: Decaid's grinder in the engine (QUESTIONS #8, D62)

1. Load the linked grinder (`settings.grinderId`) with `src/api/grinders.ts`
   at start and after every `refresh()`, map it to `GrinderInfo`
   (`model`, `settingType`, `settingSmallStep` -> `smallStep`,
   `settingBigStep` -> `bigStep`, `settingValues` -> `values`) and keep it in
   the engine. A failed read keeps the last one (or none) and never blocks
   anything. Expose a port for it (`ApiPort.getGrinder` or similar) so the
   engine tests stay on fakes.
2. Pass it as `grinder` in `proposalContext()` (add the optional field to the
   engine's `ProposalContext` in `ports.ts`).
3. Protocol (document it in ENGINE_PROTOCOL.md; update `prompt.ts`): the
   `grinder` object in the intake `[context]` and in `[event:shot_completed]`
   gets `"settingType": "numeric" | "preset" | null`, `"step": number | null`
   and `"values": string[] | null` (null when no Decaid grinder is linked or
   Decaid has no data). The prompt tells the model: when `step` or `values`
   is known, move in those steps and give the new setting; CafAI works it out
   or checks it against Decaid's grinder library.
4. `workflowContext()`: `grinderId: settings.grinderId ?? null` and
   `grinderModel` as today (D62 supersedes D45's null). `sendGrinder()`
   writes `grinderId` too, and `refresh()` counts a changed `grinderId` as a
   grinder change (then reloads the grinder's steps).
5. A confirmed grind move already saves `plan.contextPatch.grinderSetting`;
   check that the computed setting reaches Settings, Decaid's context (through
   the outbox) and the next shot event.

## Part 3: the scripted coach

`mock/anthropic/scenario.ts` (and ENGINE_PROTOCOL's "Scripted fake model"
rule 2): when the latest grinder object carries a numeric `step`, the grind
move's setting is the current dial minus that step (printed like the
validator prints it); with `values`, the previous entry of the list; else as
today (current minus 1 when it is a plain number). Accept the new payload
fields everywhere; keep every existing reply.

## You own (create or modify only these)

- `src/app/**`.
- `src/coach/prompt.ts` and `src/coach/prompt.test.ts` only (the rest of
  `src/coach` is read-only).
- `mock/anthropic/**`.
- `docs/briefs/ENGINE_PROTOCOL.md`.
- `src/ui/testing/fakeServices.ts` if a port change needs it.
- New e2e specs (you may NOT run them; the coordinator does):
  `e2e/starting-yield.spec.ts`, `e2e/grinder-flow.spec.ts`.

Read-only: everything else (`src/api/**`, `src/storage/**`, `src/ui/**`
except `fakeServices.ts`, `mock/decaid/**`, `mock/browser.ts`,
`mock/persist.ts`, `e2e/helpers.ts`, configs, the other docs).

## Tests you must add and how to verify

- Unit: v1 at 16 g, 18 g, unknown and 7 g doses (profile `target_weight`,
  workflow `targetYield`, the notice, the picked payload); a dose changed in
  Decaid after the bag opened is the one used; parentId sent, and the retry
  without it on a 400; grinder loaded at start and after refresh, a failed
  read tolerated; the grinder in the proposal context (a relative move gets
  the computed setting); `grinderId` in the workflow context and in the
  refresh write; the new payload fields in intake and shot events; the
  scripted coach's step-aware grind move.
- E2E (written, not run; before pulling a shot, wait for "Loaded … on the
  machine.", and before tapping the newest chip or card wait for it to
  exist): `starting-yield.spec.ts`: set the mock's dose to
  16 g (`window.__CAFAI_MOCK__.state.updateWorkflow({ context: {
  targetDoseWeight: 16 } })`) before the pick -> Blooming v1 stops at 45 g
  (workflow `targetYield` 45; the notice says so); `grinder-flow.spec.ts`:
  Settings -> pick the seeded 0.5-step grinder, current setting 15 -> bag,
  template, shot -> a taste the coach does not recognise ("Other") -> the
  card says "Set the grinder to 14.5 …(Decaid lists 0.5 steps …)" -> Confirm
  -> the workflow context has `grinderSetting` "14.5" and the grinder's id
  (use the seeded Niche Zero; its id is in `MOCK_GRINDER_IDS`).
- Run and report exit codes (capture with `cmd > "$TEMP/x.log" 2>&1; echo
  exit=$?`, never through `| tail`): `npm ci` (first), `npx tsc -p
  tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run` (whole suite).
  No Playwright.

## Report back (your last message, at most 60 lines)

Files changed; tests added (counts, passing?); every command with its exit
code; the protocol changes exactly as documented; known gaps.

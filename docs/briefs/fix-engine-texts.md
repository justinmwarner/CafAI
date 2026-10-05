# Fix workstream: fix-engine-texts (verifier defects 2, 3, 4a, 5, 7, 8)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D41, D42, D52, D55, D61, D62, D66,
`docs/briefs/ENGINE_PROTOCOL.md`, and `src/app/engine/engine.ts` end to end.

The fresh-eyes verifier ran the built app (main 5098ef5) end to end and
found these. Its repro specs live outside the repo, in
`E:\source\cafai\.verify\e2e-qa\52-defects.spec.ts` (one test per defect:
DEFECT-2, -3, -4a, -5, -6, -7), plus `41*-`, `44c-`, `46b-` specs; read them
for the exact steps (read-only; never edit `.verify`). The coordinator will
re-run 52-defects against your fix: each of those tests must pass.

## Defect 3 (minor): after a failed barrier the coach contradicts the banner

With the machine connected, a barrier that fails (e.g. `POST
/api/v1/machine/profile` answers 504) sends the model `{"uploaded":true,
"onMachine":false,"note":"…"}`, which ENGINE_PROTOCOL defines as "the
machine is not connected", so the coach says "Decaid loads it when the
machine connects" while the banner says "The machine has not confirmed …
Tap Retry". Following the coach wastes a shot. Add `"loadError": string |
null` to the template-picked payload (rule 2) and to the applied
`propose_adjustment` result (rule 5): the reason when the machine did not
confirm the version although it is connected, else null. Document it in
ENGINE_PROTOCOL.md and the prompt (`src/coach/prompt.ts`), and teach the
scripted coach (`mock/anthropic/scenario.ts`): with a `loadError` it says
"I saved {title}, but the machine has not confirmed it. Tap Retry above, then
pull a shot." (rule 5) and "Saved v{version}, but the machine has not
confirmed it. Tap Retry above, then pull another shot." (rule 1).

## Defect 2 (minor): another profile loaded behind CafAI's back goes unnoticed until a shot is wasted

Steps: load v1, then another profile arrives in Decaid's workflow
(`state.updateWorkflow({ profile: <Default> })`), wait 36 s. The Profile
line follows (D66), but no banner or Retry appears until the next shot,
which is then not credited. Make the engine run its start-up check
(`checkMachineProfile`, report only, D42: it never changes the machine) every
30 s while the page is visible and nothing else is going on (not busy, no
shot running, no load in flight), and when the page becomes visible again.
Raise the standing load problem only when the mismatch is new: once the user
dismissed it (D52), the same mismatching profile must not bring it back every
30 s; a different one may.

## Defect 4a (minor): a linked grinder removed from Decaid while CafAI runs still gets step text

The engine reads the linked grinder only at start and after `refresh()`, so
a grinder deleted from Decaid's library while CafAI runs keeps its old step
(the card says "Decaid lists 0.5 steps for your Niche Zero" while Settings
says Decaid no longer lists it). Read it again in the background after each
finished shot and when the page becomes visible; a 404 already means
"directions only".

## Defect 5 (minor): a grind setting nobody could check carries no caveat

With a typed grinder (no Decaid link, or no step data) and a numeric current
setting, the card says "Set the grinder to 23 (1 step finer) before the next
shot." with no caveat, although D62 and the owner's answer to QUESTIONS #8
("in the text sent to the user just let them know") ask CafAI to say when it
does not know the step. When the plan's `grindSettingFrom` is `model`, the
manual step must say the setting is the coach's estimate, e.g. "Set the
grinder to 23 (1 step finer) before the next shot. That is the coach's
estimate: CafAI doesn't know your grinder's step size, so note where the
dial really lands in Settings." Keep it short; fix it in `src/coach/diff.ts`
(and the validator only if the text needs a field it lacks).

## Defect 7 (polish): "This bag" before the machine has confirmed the version

With `?mockUploadMs=3000` the machine panel shows "✓ This bag" about 0.7 s
into "Loading…", and after a 504 barrier it shows "This bag" next to "The
machine has not confirmed …". Expose the active version's load state in
`CoachState` (e.g. `activeLoad: 'loading' | 'loaded' | 'waiting' | 'failed' |
'assumed' | null`, optional so other fakes still compile) and have the
Profile line (`src/ui/machine/LoadedProfile.tsx`, `useLoadedProfile.ts`)
mark it as this bag's only when the load is confirmed (or assumed on an
older Decaid while connected); while loading say so ("loading…"), and after a
failure show "not confirmed" in the warning colour.

## Defect 8 (polish): the not-credited notice names the same title twice

When another bag's same-named version ran (D41), the notice reads 'That shot
ran "Kiambu AA v1", not Kiambu AA v1, so it is not part of this dial-in.'
When the titles are equal, say it was another version with the same name,
e.g. 'That shot ran a different "Kiambu AA v1" (another bag or version), so
it is not part of this dial-in.'

## Also: the live API harness

`src/app/engine/protocol.ts` keeps `yieldG`, `doseG`, the grinder's
`settingType`/`step`/`values` and `IntakeContext.doseG` optional only because
`src/llm/live/harness.ts` builds those payloads with the old shape. Update
the harness (and its test) to send the full shapes (and `loadError: null`),
then make those fields required in `protocol.ts`.

## You own (create or modify only these)

- `src/app/**`.
- `src/coach/diff.ts`, `src/coach/prompt.ts` and their tests (and
  `src/coach/validator.ts` only if defect 5 truly needs it).
- `mock/anthropic/**`, `docs/briefs/ENGINE_PROTOCOL.md`.
- `src/ui/machine/**`, `src/ui/testing/fakeServices.ts`.
- `src/llm/live/harness.ts` and `src/llm/live/harness.test.ts`.
- New e2e spec (you may not run it; the coordinator does):
  `e2e/verifier-fixes.spec.ts` covering defects 2, 3, 7 and 8 in the built
  app (wait for "Loaded … on the machine." before pulling a shot, and for the
  newest card or chip before tapping it).

Read-only: everything else. Another fix workstream is changing
`src/storage/settings.ts` and `src/ui/settings/**` right now.

## Verify and report

Run and report exit codes (capture with `cmd > "$TEMP/x.log" 2>&1; echo
exit=$?`, never through `| tail`): `npm ci` (first, in your worktree), `npx
tsc -p tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run` (whole
suite), and `LIVE_DRY_RUN=1 npm run test:live` (the dry run must still pass).
No Playwright. Final message (at most 60 lines): your worktree path and
branch, files changed, tests added (passing?), the protocol change as
documented, commands with exit codes, anything you left open.

# Fix workstream: fix-profile-beat (the Profile line and the banner change together)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D66, D70, D72, `src/app/engine/engine.ts`
(`machineBeat`, `checkMachineProfile`, `raiseMismatch`, `quiet`),
`src/ui/machine/useLoadedProfile.ts`, and `e2e/verifier-fixes.spec.ts`.

## The defect

`npm run verify` fails 3 of 93 e2e tests: `e2e/verifier-fixes.spec.ts`
"a profile loaded behind CafAI reaches the banner with the Profile line,
once per profile (defect 2)", in all three viewports. The test loads another
profile into the mock's workflow right after "Loaded Kiambu AA v1 on the
machine.", while the scripted coach's reply is still arriving. The Profile
line then shows "Default" within about a second, but the banner ("The
machine is running "Default", not Kiambu AA v1.") does not follow within
3 s. D70 says the two change together.

Why: the Profile line re-reads Decaid's workflow on every new chat message
(debounced), so the coach's reply made it read early; and the engine's 30 s
beat skips its look entirely when it fires while CafAI is busy
(`if (checkQueued || !quiet()) return;`), so the banner waits for the next
beat, up to 30 s later.

## The fix

1. `useLoadedProfile`: stop re-reading on every chat message. Read on mount,
   on the engine's beat (`machineTick`), when the active bag or version
   changes, when the active version's load state changes (`activeLoad`:
   that covers Retry, which reloads the same version), when a shot finishes,
   when the machine connects, and when the page comes back into view. A
   change CafAI makes itself still shows at once; a change made behind
   CafAI's back shows on the beat, together with the banner.
2. `machineBeat`: when the beat fires while CafAI is busy, queue the look
   (at most one waiting) instead of dropping it: it runs on the engine's
   queue right after the current action, and still only when nothing else is
   going on then (no shot running, no load in flight). Keep D52's
   once-per-profile rule.
3. Keep the test's meaning. It should pass as written; if a timing detail
   in it was wrong, fix the test, not the rule, and say why.

## Also: finish the live harness shapes

`src/llm/live/anthropic.live.ts` line ~64 still builds the old intake
context, which is why `GrinderPayload`'s `settingType`, `step`, `values`,
`linked` and `IntakeContext.doseG` stay optional in
`src/app/engine/protocol.ts`. Build the intake with `grinderPayload(...)`
and `doseG: null`, then make those fields required.

## You own (create or modify only these)

- `src/app/engine/engine.ts`, `src/app/engine/engine.test.ts`,
  `src/app/engine/protocol.ts`, `src/app/engine/protocol.test.ts`.
- `src/ui/machine/useLoadedProfile.ts` and the tests under `src/ui/machine/`.
- `src/llm/live/anthropic.live.ts`.
- `e2e/verifier-fixes.spec.ts` (only if the test itself was wrong).

Everything else is read-only.

## Verify and report

Unit tests that pin the new triggers (no read on a chat message; a read on
`activeLoad` and on the beat) and the queued look (a beat during a busy
action leads to a look right after it). Run and report exit codes (capture
with `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`, never through `| tail`):
`npm ci` (first, in your worktree), `npx tsc -p tsconfig.json --noEmit`,
`npx eslint .`, `npx vitest run`, `LIVE_DRY_RUN=1 npm run test:live`. No
Playwright (the coordinator runs the spec). Final message (at most 40
lines): worktree path and branch, files changed, tests added, commands with
exit codes.

# Workstream: coach-tuning (starting yields and bounds, Gentle and Sweet checks, grinder steps)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D17-D22, D35, D57, D59, D62, D63,
`docs/verified/03-profiles.md` section 9, and all of `src/coach/`. Reference
clones (`.ref/`, `crema/`) are git-ignored, so they are not in your worktree:
read them at `E:\source\cafai\.ref\...` if you need them.

Everything here is pure coach logic in `src/coach/`. The engine is NOT
yours: a later workstream calls your new functions from it. Build them with
their tests and leave the wiring.

## Part 1: starting yields and bounds (QUESTIONS #3, D57)

The owner: "This is more of an AI / web question, do what is best." The
research (summarised in D57) found that v1's yield should come from the dose,
using each profile author's own brew ratio at Decent's 18 g reference dose,
because today v1 often starts outside the dose window every later change must
respect, and the Allongé starts at 1:7.5.

1. Each `Template` gets `startRatio` (number) with a source comment:
   Blooming Espresso 2.8 (Rao's bloom post: 24% EY at 8.5% TDS; Decent's
   best-practice light profile "18g in, 50g out"), D-Flow 2.8 (Damian's
   plugin default 50 g at 18 g), Londonium 2.0 (identical to Damian's LRv2,
   which stops at 36 g; Decent pulls Londinium 18 g -> 36 g), Rao Allongé
   5.0 (its own notes: "5:1 ratio"), Gentle and Sweet 2.0 (Decent's guide:
   "a 1:2 ratio"; the shipped 36 g).
2. A dose counts as known only between `DOSE_RULES.min` and `DOSE_RULES.max`
   (12-25 g). Apply that in `effectiveBounds` (`levers.ts`): an unknown or
   out-of-range dose means the plain gram bounds, as today for an unknown one
   (a 7 g dose today turns Blooming's window upside down: min 30 > max 28).
3. New `startingYield(template, doseG)`: d = the known dose, else the 18 g
   reference; yield = R x d snapped to the yield lever's 1 g step (ties round
   up, `snapToGranularity`), then clamped into `effectiveBounds(yield, d)`.
   Expected values (put the whole table in a test):

   | Template | 12 g | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 25 g | unknown |
   |---|---|---|---|---|---|---|---|---|---|---|---|---|
   | blooming-espresso | 34 | 39 | 42 | 45 | 48 | 50 | 53 | 56 | 59 | 62 | 70 | 50 |
   | d-flow | 34 | 39 | 42 | 45 | 48 | 50 | 53 | 56 | 59 | 62 | 70 | 50 |
   | londonium | 25 | 28 | 30 | 32 | 34 | 36 | 38 | 40 | 42 | 44 | 50 | 36 |
   | allonge | 60 | 70 | 75 | 80 | 85 | 90 | 95 | 100 | 105 | 110 | 125 | 90 |
   | gentle-and-sweet | 25 | 28 | 30 | 32 | 34 | 36 | 38 | 40 | 42 | 44 | 50 | 36 |

   (Londonium and Gentle and Sweet at 12 g clamp to the lever minimum 25 g.)
   If your implementation disagrees with a cell, re-derive it and say which
   and why in your report; do not silently change the rule.
4. New `buildStartingProfile(template, doseG)`: the template's profile with
   the yield lever set to `startingYield` through the existing lever code
   (so `target_weight` changes and nothing else), ready for
   `buildVersionProfile(template, base, title, bagName)`. Export both from
   `src/coach/index.ts`.
5. Rao Allongé: `doseRatio` 4.0-6.0 (was 4.0-7.5; 7.5 existed only so the
   135 g stop passed at 18 g; Decent: "5:1 or 6:1", beginners about 4:1).
   Rewrite its `shape` and `description` so they no longer promise a 135 g
   stop: it stops at about 5x the dose (90 g for 18 g). Keep the lever's
   gram max of 135 and D35's hard bound (max(120 g, template target_weight)).
6. Gentle and Sweet: `doseRatio.max` 3.0 (was 2.5; Decent: "1:2 or 1:3").
7. Blooming Espresso: add to its `description` (text only) that its pour
   stops 26 s after the bloom, so the cup tops out near the drip plus about
   22.5 s x flow (about 57 g at 2.2 ml/s): above that, more yield needs more
   flow. This stops the coach proposing yield increases that do nothing.
8. The prompt catalog (`prompt.ts` `leverLine`): for the yield lever, replace
   "template value N g" with where v1 starts, e.g. "v1 starts at 2.8 x dose
   (50 g for 18 g)". Keep the prompt deterministic (it is cached).
9. `heuristics.ts` (still marked placeholder): align the medium-roast ratio
   line with D-Flow's start (about 1:2.5-1:3) so the coach does not shorten
   v1 by reflex.

Every other bound stays as it is (the research checked them: temperature
ranges and steps, bloom, piExit, flow, soak, soakWeight, pourFlow, pourPmax,
peak, declineEnd, maxPressure, hold, and every max change per iteration).

## Part 2: pin the regenerated Gentle and Sweet (QUESTIONS #9, D63)

Our `Gentle_and_sweet1.json` is byte-identical to Decaid a45961b's bundled
file and is the regenerated profile; an older Decaid record carried stale
de1app frames (78.5 / 78.5 / 67 °C on steps 2-4 and `target_volume` 0). Add
`src/coach/templates/gentleAndSweet.test.ts` asserting, with the values
embedded (the reference clones are not in the repo):

1. 5 steps named exactly: preinfusion temp boost, preinfusion, forced rise
   without limit, rise and hold, decline; pumps flow, flow, pressure,
   pressure, pressure; transitions fast, fast, fast, fast, smooth; every
   sensor `coffee`.
2. Flow 8 on steps 0-1; pressures 6, 6, 4 on steps 2-4; seconds 2, 18, 3, 13,
   30 (sum 66).
3. Steps 0-1 exit on pressure over 4; steps 2-4 have no exit.
4. No limiter on steps 0-2; steps 3-4 limiter value 4, range 1.
5. No stale fingerprint: every temperature is 88 (one distinct value; none is
   78.5 or 67); `target_volume` 36, not 0; title "Gentle and sweet", not
   "Gentle and sweet1".
6. `target_weight` 36, `target_volume_count_start` 2, `tank_temperature` 0,
   `beverage_type` espresso, `version` "2", author Decent.
7. Raw file keys: exactly the 12 top-level keys of the file with `type`
   "pressure" and `hidden` "0"; no `legacy_profile_type`, `lang`,
   `reference_file` or `changes_since_last_espresso`; step keys a subset of
   name, pump, transition, temperature, sensor, seconds, volume, weight, flow,
   pressure, exit, limiter; none of de1app's TCL frame keys (exit_if,
   exit_type, exit_pressure_over/under, exit_flow_over/under,
   max_flow_or_pressure(_range), popup); every step volume and weight 0.
8. The notes' "rises to only 6 bar and then slowly descends to 4 bar" match
   `readLeverValues` peak (6) and declineEnd (4).
9. The existing id test stays; a copy with the stale values (78.5 / 78.5 / 67
   and `target_volume` 0) hashes to a different id.

## Part 3: grinder steps from Decaid (QUESTIONS #8, D62)

The owner: "use what Decaid has available. But in the text sent to the user
just let them know." Decaid's grinder library gives `settingType` (`numeric`
or `preset`), `settingSmallStep`, `settingBigStep` and `settingValues`; it
has no min/max and no direction.

1. `GrinderInfo` in `src/coach/types.ts`: `{ model: string; settingType:
   'numeric' | 'preset'; smallStep: number | null; bigStep: number | null;
   values: readonly string[] | null }`.
2. The validator's context gets an OPTIONAL `grinder?: GrinderInfo | null`
   (optional so the engine compiles unchanged until it is wired). With it, and
   a current setting CafAI can read:
   - numeric with `smallStep`: a relative move (`amount`, no `setting`)
     becomes an absolute setting: current minus `amount x smallStep` for
     finer, plus for coarser (assumption: lower numbers are finer, the common
     convention; say so in a comment), printed with the step's decimals
     ("14.5", "14"). A setting the model gives must sit a whole number of
     small steps from the current one, in the stated direction, at most
     `GRIND_MAX_STEPS` steps away; otherwise answer the model with an error
     sentence that names the step ("Your grinder moves in steps of 0.5 ...").
     A result below 0 is an error too.
   - preset with `values` containing the current setting: a relative move
     moves `amount` places in the list (assumption: the list runs finest
     first); a given setting must be in the list, in the stated direction;
     falling off either end is an error.
   - otherwise (no grinder info, no step, an unreadable current setting):
     exactly today's behaviour.
   The plan records whether the setting came from Decaid's step (for the
   diff text), e.g. a field or a `notes` entry.
3. Text for the user (`diff.ts`), short and plain:
   - with Decaid's step: "Grind 1 step finer: 15 -> 14.5" and the manual step
     "Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for
     your Niche Zero).";
   - without step information and without a setting: "Turn the grinder 1
     step finer before the next shot. CafAI doesn't know your grinder's step
     size, so note the new setting in Settings."
4. Do not change `prompt.ts` for grinders (the later workstream changes the
   prompt together with the engine protocol).

## You own (create or modify only these)

`src/coach/**` (templates, levers, validator, diff, prompt, heuristics,
types, index and their tests).

Read-only for you: everything else, in particular `src/app/**`, `mock/**`
(including `mock/anthropic`), `src/storage/**`, `src/ui/**`, `package.json`,
configs and docs. If something outside `src/coach` must change (for example
an engine or mock test that pinned v1's yield), describe it in your report.

## Interfaces to keep

Every existing export of `src/coach/index.ts` and its signature; the lever
ids and template ids (ENGINE_PROTOCOL); `buildVersionProfile`;
`validateProposal`'s result shape (new fields optional).

## Tests you must add and how to verify

The starting-yield table; the 12-25 g dose rule in `effectiveBounds` (7 g and
30 g act as unknown); `buildStartingProfile` changes only `target_weight`;
Allongé and Gentle and Sweet windows; prompt lines; the Gentle and Sweet
file; grinder steps (numeric and preset, relative and absolute, off-grid,
wrong direction, out of the list, below 0, no info, unreadable current) and
the diff wording. Update the tests the changes break (e.g.
`templates/index.test.ts`, `levers.test.ts`, `prompt.test.ts`,
`validator.test.ts`).

Run and report exit codes (capture with `cmd > log 2>&1; echo exit=$?`,
never through `| tail`): `npm ci` (first, in your worktree),
`npx tsc -p tsconfig.json --noEmit`, `npx eslint src/coach`, `npx vitest run`
(the WHOLE unit suite: the engine and mock tests use the coach too). Do not
run Playwright.

## Report back (your last message, at most 60 lines)

Files changed; tests added (counts, all passing?); every command with its
exit code; the public signatures of `startingYield`, `buildStartingProfile`,
`GrinderInfo` and the validator's new context field; anything outside
`src/coach` that will need a change when the engine is wired; known gaps.

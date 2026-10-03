# Brief: coach logic (pure)

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/coach/**` except `src/coach/types.ts`,
`src/coach/contract.ts` and `src/coach/templates/source/*.json` (read-only),
plus `src/util/last.ts` if you port it. Pure TypeScript: no React, no fetch,
no IndexedDB, no timers. Do not import from `src/api`, `src/llm` or
`src/storage` implementations (types only), because those are being written
in parallel.

**Verified facts:** `docs/verified/03-profiles.md` (all of it: field types,
limits, identity hash, and section 9's templates and lever tables, which are
your spec), `docs/verified/02-api.md` sections 7-9 (profiles, shots,
measurements, time base), `docs/briefs/ENGINE_PROTOCOL.md` (template and
lever ids are fixed there).

**Crema to port** (`docs/CREMA_PORT_PLAN.md` section 10 "[3] Coach logic"):
as-is `domain/profile.ts`, `advice/curves.ts`, `advice/phases.ts`,
`domain/last.ts` (to `src/util/last.ts`), `domain/recipe.ts` and
`domain/trail.ts` only if they serve this brief; adapt
`advice/proposal.ts` into the validator, `advice/prompt.ts` into the prompt,
`views.ts` `leadChange` into the diff text. Port the matching tests
(`profile.test.ts`, `profile-plan.test.ts`, `curves.test.ts`,
`phases.test.ts`, the proposal part of `parse.test.ts`, `prompt.test.ts`
where it still applies, `views.test.ts` leadChange cases).

**Shot analysis thresholds:** read `.ref/decaid-mcp` (the shot analysis code
and docs) and port its definitions of first drop, preinfusion end,
resistance (pressure / flow^2) and the five channeling indicators (pressure
dip after peak, flow instability, pump vs scale flow divergence, early first
drops, resistance trend), with its thresholds. Record the source file and
licence in a comment; if its licence is incompatible with GPL-3.0-only,
re-derive the logic from its documentation instead and say so.

## Build

1. `profile.ts`
   - `normalizeProfile(raw: unknown): ProfileJson`, matching Decaid's
     `Profile.fromJson -> toJson`: numbers or numeric strings -> numbers;
     `version` -> string; `target_volume_count_start` -> integer; only the
     active target (`pressure` for pressure steps, `flow` for flow steps);
     `exit`, `limiter`, `weight` explicit `null` when absent; unknown keys
     dropped; invalid enums throw with a clear message. Keep the template's
     representation of `weight` (0 vs null) because it is hashed.
   - Crema's `profilePlan` / `describePlan` for the template cards' one-line
     shape.
2. `profileId.ts`: byte-exact TypeScript port of Decaid's `ProfileHash`
   (`docs/verified/03-profiles.md` section 6, `02-api.md` section 7),
   including Dart double formatting (`90.0`) and sorted keys, with a pure-JS
   SHA-256 (no `crypto.subtle`: it does not exist on the tablet's insecure
   http origin). Test vectors: Default1 -> `profile:a582ef47a76f99f56912`,
   Blooming -> `profile:7438cb7266f60558b48f`, best_practice ->
   `profile:b73ce54592d667d00b31`, D-Flow -> `profile:59036f8846b1ed3b4255`,
   Londonium -> `profile:729d284747718d27c93a`. Copy the extra fixture files
   you need (e.g. `Default1.json`, `best_practice.json` from
   `.ref/decaid/assets/defaultProfiles/`) into `src/coach/__fixtures__/`
   with a `SOURCES.md` (origin, commit, GPL-3.0-or-later).
3. `templates/index.ts`: `TEMPLATES: readonly Template[]`, `getTemplate(id)`.
   Build each from its source JSON (`import x from './source/X.json'`,
   normalized with `normalizeProfile`) plus the exact lever declarations of
   `03-profiles.md` section 9 (ids per ENGINE_PROTOCOL.md; paths, anchor,
   min, max, `doseRatio`, granularity, `maxDelta`, `workflowContextKey:
   'targetYield'` on every yield lever, `requiresScale` on D-Flow
   `soakWeight`, the Londonium `peak - declineEnd >= 1` constraint), name,
   style, shape line, description, roast fit (blooming: light,
   medium-light; d-flow: medium-light, medium; londonium: medium,
   medium-dark, dark), `decaidDefaultId`, and `source`. Test: with every lever
   at its template value, `profileId(template.profile)` equals
   `decaidDefaultId`.
4. `levers.ts`: path parser for `target_weight`, `steps[2].seconds`,
   `steps[*].temperature`, `steps[1].exit.value`, `steps[2].limiter.value`;
   `readLeverValues(template, profile): LeverValues`;
   `applyLever(template, profile, leverId, value): ProfileJson` (linked: same
   value to every path; uniformShift: the delta from the anchor added to
   every path; snapped to granularity; returns a new object and touches
   nothing else).
5. `validator.ts`
   - `checkStructure(template, before, after): string[]`: same step
     count, order, names, pumps, sensors, transitions; same exit presence,
     type and condition; same limiter presence and range; same volumes,
     `target_volume`, `target_volume_count_start`, `tank_temperature`,
     `beverage_type`, `version`; every number inside CafAI's hard bounds
     (03-profiles section 5.2 "CafAI hard bound" column).
   - `validateProposal(input: ProposeAdjustment, ctx): Validation`, with
     `ctx = { template, profile, doseG: number | null, scaleConnected: boolean, grinderSetting: string | null }`.
     Rules: the fields match the variable (profile needs `lever` and `value`;
     grind needs `grind`; dose needs `value`; none needs neither); the lever
     exists; value finite; snap to granularity (report the snapped value);
     inside effective bounds (with `doseRatio` when the dose is known);
     `|to - from| <= maxDelta`; `to !== from`; cross-lever constraints;
     `requiresScale` levers rejected without a scale; dose sanity 12-25 g and
     at most 1 g per iteration; grind `amount`, when given, in (0, 5] dial
     steps (never clamp to a user-typed range: Crema's lesson); `none` is a
     valid "lock it in". Errors are sentences addressed to the model, e.g.
     "temp: 96.0 °C is above this template's maximum of 94.0 °C. Allowed
     range now: 90.0-94.0 °C (at most 2.0 °C per step)."
   - On success return a `ChangePlan`: `{ variable, leverId, label, unit, from, to, newProfile: ProfileJson | null, contextPatch: { targetYield?: number; targetDoseWeight?: number }, diffLines: string[], manualSteps: string[], summary, createsVersion: boolean }`.
     A yield change sets `contextPatch.targetYield` too. Never clamp silently:
     anything out of bounds is an error, not a quiet fix.
6. `diff.ts`: plain-language lines. `describeLeverChange(template, leverId, from, to)`,
   e.g. "Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)", "Yield:
   36 g -> 38 g (the shot stops at 38 g)", "Bloom time: 30 s -> 35 s";
   `describeManualChange(input)` ("Grind 1 step finer", "Dose 18.0 g -> 18.5 g");
   `diffProfiles(before, after)` generic fallback for history and undo.
7. `summary/`: port `curves.ts` and `phases.ts` with tests, then
   `summarize.ts`: `summarizeShot(record: ShotRecord): ShotSummary` (types in
   `src/coach/types.ts`). Time base = machine timestamps relative to the
   first sample (write a small local zone-less ISO parser here; the api
   agent writes its own). Measurements start at `preparingForShot`;
   `profileFrame` is stale until the first preinfusion/pouring sample.
   Dose = `annotations.actualDoseWeight ?? workflow.context.targetDoseWeight`;
   yield = `annotations.actualYield ?? last scale weight`; target yield =
   `workflow.context.targetYield`. Series resampled to ~1 Hz by timestamp
   (never by index; real sampling is ~3.7 Hz and irregular). Round numbers
   sensibly (0.1). Fixtures: `docs/verified/examples/shot-record.json` plus
   synthetic shots you build in tests.
8. `queries.ts`: the named query functions behind the auto tools, over a
   `ShotSource` you define (`resolve(ref) -> { record, summary } | null` where
   ref is `latest`, `previous` or an id) and a bag history input:
   `getShotSummary`, `getShotSeries(ref, metric, fromS, toS)` (resistance
   computed from pressure/flow^2), `getPhaseStats(ref)`, `compareShots(a, b)`,
   `getBagHistory(versions, iterations)`. Compact JSON results. No eval, no
   free-form code.
9. `tools.ts`: `COACH_TOOL_SPECS: Record<ToolName, { description: string; kind: 'ui' | 'auto' }>`.
   Model-facing descriptions, concise and exact (e.g. ask_user: "2-5 short
   options; never include Other, the app adds it"; propose_adjustment: "ONE
   variable; lever ids and bounds from the template catalog").
10. `prompt.ts`: `buildSystemPrompt(templates): string`, deterministic (no
    dates, ids or randomness). Content: role and tone (concise, plain
    language, read on a tablet, at most ~120 words per reply, no tables); the
    loop (intake -> save_bag_details + propose_templates; after
    `[event:shot_completed]` -> ask_user for taste, then query tools as
    needed, then propose_adjustment with ONE variable, or `none` to lock in a
    good shot); the template catalog with every lever (id, label, unit,
    bounds, max change, what it does in the cup) rendered from `templates`;
    grind and dose as manual variables; event markers and payloads per
    ENGINE_PROTOCOL.md; rules: never invent levers or fields, stay in bounds,
    explain when a request is outside the levers, claim only the attached
    tools. Coffee heuristics (RESEARCH.md section 8 symptom -> lever table)
    live in `heuristics.ts` as a clearly marked placeholder block the
    prompt includes (the final heuristics are NOT tonight's scope; keep the
    seam clean).
11. `feedback.ts`: `withOther(options): string[]` (drops any "other"-like
    option the model sent, appends `OTHER_OPTION` last) and
    `DEFAULT_TASTE_OPTIONS`.
12. `version.ts`: `versionTitle(bagName, n)` ("Kiambu AA v2", trimmed to 40
    chars) and `buildVersionProfile(template, base, title, bagName)` (sets
    title; notes "CafAI dial-in for <bag>, from <template>"; author "CafAI";
    execution content unchanged).
13. `index.ts`: barrel of the public API above.

## Tests

TDD. Cover every lever of every template (apply, bounds, max delta,
granularity snapping, cross constraint), structure invariants (try to change
pump, sensor, exit type, step count: all rejected), hash vectors, the
summarizer on the example shot and synthetic shots (first drop, preinfusion
end, channeling flags), queries, prompt determinism and catalog content, and
the ported Crema tests.

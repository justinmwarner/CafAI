# Fix workstream: fix-shot-numbers (the panel and the shot card disagree)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Background: DECISIONS.md D75 (the panel's timer stops when
the pour ends), D61, D74; docs/SIMULATOR.md.

## 1. Time and weight disagree on one screen after a shot

A fresh-eyes verifier pulled a shot in the demo (mock Decaid, Blooming
Espresso based, real time). When it ended, the machine panel said "Last shot
60.6 s" and "Weight 44.5 g", while the new shot card and the coach said
62.4 s and 41.5 g. Against Decaid 0.8.7's simulator the card said 63 s for a
pour Decaid logged as 61.6 s (D75 then fixed the panel, which said 66.6 s).

Find out exactly how each number is made: the panel's timer and weight
(`src/ui/machine/**`, `src/api/telemetry.ts`) and the card's time and yield
(the ShotSummary built from Decaid's shot record in `src/coach/**`; the coach
reads the same summary). Read what Decaid itself means by a shot's duration
and its yield (`.ref/decaid`: the shot record, `shot_sequencer.dart`;
`docs/verified/`).

Then make the two agree, with this rule unless Decaid's own definitions say
otherwise (say so if they do):

- **Time** is the pour: from the start of the shot to the end of the pour,
  as D75 defines it for the panel. The card's time and the coach's
  `durationS` use the same end.
- **Yield** is what is in the cup once Decaid has finished the shot (the
  weight after the drips, the record's final weight), and the panel shows
  that same number as the last shot's weight once the shot is finished.

If one of these needs a change to the shot summary that would move coach
heuristics (thresholds that read `durationS` or `yieldG`) or rewrite many
test fixtures, make the smallest change that keeps both screens and the
coach consistent, and list every heuristic and fixture you touched, with
why. If you conclude the summary should not change at all, do not change
it: make the panel's labels say exactly what each number is, and explain in
your report.

## 2. The panel says "pouring" during the bloom

During Blooming Espresso's bloom (about 30 s, pump off, 0 bar), the panel
says "Pulling a shot: pouring" with 0.0 bar and 0.0 ml/s, which looks
stalled. If Decaid's shot telemetry says which profile step is running and
the panel can know the loaded profile's step names, show the step's name
("Pulling a shot: Bloom"); otherwise leave it and say why in your report.

## You own (create or modify only these)

`src/ui/machine/**`, `src/api/telemetry.ts`, the shot summary code in
`src/coach/**` (only for item 1's definitions) and the tests and fixtures
next to them, and existing `e2e/*.spec.ts` only where they assert a number
or string you changed (say which; you cannot run them). Not `mock/**`: if a
test under `mock/` fails because of your change, leave it, and list it with
the reason in your report. Nothing else; in particular not `src/ui/chat/**`,
`src/app/engine/**` or `src/ui/history/**` (another workstream is editing
them now).

## Tests (TDD)

Failing tests first: for a recorded shot with a stopping tail (use a real
Decaid fixture if one has it, else a synthetic one), the panel's last-shot
time and weight equal the summary's `durationS` and `yieldG`; the summary's
time ends at the pour's end; the step name shows during a named step, if you
build item 2.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run` (report any `mock/` failures separately). No Playwright.
Windows: edit with the Edit/Write tools.

Final message (at most 40 lines): worktree path and branch, what each number
meant before and means now, Decaid's own definitions as you found them,
files changed, heuristics and fixtures touched, tests added, e2e assertions
changed, failing `mock/` tests with reasons, commands with exit codes.

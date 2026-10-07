# Fix workstream: fix-demo-round2 (one clock on the shot card, typed tastes, the guard note)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D76-D79, `docs/DEMO.md` and
`docs/briefs/ENGINE_PROTOCOL.md`. The demo's fresh-eyes verifier re-checked
the last round of fixes on main and found these.

## 1. The shot card mixes two clocks (minor)

Since D78 a shot's time (`ShotSummary.durationS`) is the pour, but the card's
other times are still on the record's clock, where t = 0 is the start of
preheat (about 2 s in the mock, 1-6.5 s on a real DE1). So the card says
"Shot 60.0 s" next to "6.0 bar at 61 s": the peak after the end of the shot.
The demo voice repeats it ("peaked at 5.4 bar, 62 s in" about a 60.6 s
shot), and Santos's card says "7.2 bar at 4 s", 2.2 s into its pour.

Fix: everything the user sees counts from the start of the pour.

- The summary says where the pour starts on its clock: add
  `pourStartS: number` to `ShotSummary` (src/coach/types.ts), set by the
  summarizer (src/coach/summary/summarize.ts) from the same first non-preheat
  sample `pourSeconds` uses. The summary's other times and the series stay
  on the record's clock (the coach's heuristics and the query tools use it).
- The shot card (src/ui/chat/parts/ShotCard.tsx) shows its times (first
  drop, the peak's time, anything else timed) minus `pourStartS`, never below
  0. Anything else that shows a summary time to the user (History, if it
  does) does the same. A stored summary without `pourStartS` shows as today.
- The coach is told the same: in src/coach/prompt.ts's "Reading a shot"
  section, one sentence: when telling the user a time, count it from the
  start of the pour (time minus `pourStartS`), as the shot card does.
  `summaryForModel` (or whatever builds the summary the model sees) includes
  `pourStartS`.
- The scripted coach's demo voice (mock/anthropic/demoVoice.ts) quotes the
  peak's time as the card shows it (minus `pourStartS` when the summary has
  it).

## 2. A typed taste without a taste word (partly fixed)

Typed "It tasted a bit sour, sharp at the end" now gets the sour reply, but
typed "Flat and a bit dull, the fruit is hiding" still gets "Noted. Pull a
shot when you're ready…", while the same words under Other get a one step
finer card. The app itself treats text typed while the taste question is
open as the shot's taste (src/app/engine/engine.ts `sendText`, D79), so the
scripted coach should too: when the taste question was set aside for the
typed text, that text is the taste answer, read exactly as the same words
under Other are (taste words pick the move; none means one step finer).
Text typed when no taste question was open keeps today's replies. Both
voices; update ENGINE_PROTOCOL's scripted-model rules and DEMO.md.

## 3. The guard note shrinks the app (polish)

When the demo refuses to load, its note (mock/demo/guard.ts) sits above the
app and pushes it down about 76 px, so at 962x602 the machine panel's graph
shrinks and its legend's "target" entry is cut off until Dismiss. Make the
note one slim line (about 32-36 px high at 962x602, text and a Dismiss
button; the text may be shortened, keeping "The demo did not load" and "npm
run demo"), so the app keeps nearly its full height and nothing is cut off.

## You own (create or modify only these)

`src/coach/types.ts` (only the new field and its doc),
`src/coach/summary/**`, `src/coach/prompt.ts` (only the one sentence),
wherever the model's summary is built, `src/ui/chat/parts/ShotCard.tsx`, any
other view that shows a summary time (say which), `mock/anthropic/**`,
`mock/demo/guard.ts`, the tests and fixtures next to these files,
`docs/DEMO.md`, `docs/briefs/ENGINE_PROTOCOL.md` (scripted-model section),
and existing `e2e/*.spec.ts` only where they assert a time or string you
changed (say which; you cannot run them). Nothing else.

## Tests (TDD)

Failing tests first: the summarizer sets `pourStartS` (a real Decaid fixture
and a mock shot with preheat); the card shows the peak and first drop on the
pour clock and an old summary as before; the prompt sentence; the demo
voice's peak time equals the card's; a typed text with no taste word, after
the taste question was set aside for it, gets the Other path (a grind card),
and text typed with no open taste question gets today's reply; the guard
note's height.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run`. No Playwright. Windows: edit with the Edit/Write tools.

Final message (at most 30 lines): worktree path and branch, files changed,
what the card shows now for the demo's shots (time, first drop, peak and its
time), tests added, e2e assertions changed, commands with exit codes.

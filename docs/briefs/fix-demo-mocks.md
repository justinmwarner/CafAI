# Fix workstream: fix-demo-mocks (the scripted coach and the demo's story)

Read `docs/briefs/COMMON.md` first; its code, test and licensing rules hold
here, except where this brief overrides them (you may edit the files listed
under "You own"). Then DECISIONS.md D74, D76 and D77, `docs/DEMO.md`, and
`docs/briefs/ENGINE_PROTOCOL.md` (the scripted fake model's rules).

A fresh-eyes verifier drove the demo (`/?demo=1`) and found these in the
mocks. Two other workstreams are fixing app defects in `src/` right now
(fix-demo-chat: the keep card's wording, set-aside notes, only taste answers
count as taste; fix-shot-numbers: panel and card numbers). Do not touch
`src/`.

## The scripted coach (mock/anthropic)

1. **The peak time contradicts the card.** The demo voice said "The pressure
   peaked at 5.7 bar, 58 s in" next to a card saying "5.7 bar at 61 s" (the
   rounded series ties along a plateau). Use the latest shot's summary (the
   `[event:shot_completed]` payload, the numbers the card shows) for the
   peak and its time when the request has it; otherwise the series' peak,
   without a time.
2. **Yield changes that cannot work.** Weak gives "stop at 48 g" and strong
   "52 g" (from 50 g), but the demo's shot four ended at 41.5 g when the
   profile ran out of steps, so neither stop is ever reached. A yield move
   only when the latest shot reached its target yield (its yield within 1 g
   of the target lever, or it stopped on weight); otherwise: weak -> one
   step finer on the grinder, strong -> one step coarser, sour at the
   temperature limit -> one step finer (as now). Add the coarser move and
   its texts in both voices.
3. **A typed taste is not read.** The composer invites "Tap an answer, or
   say how it tasted", but typing "It tasted a bit sour, sharp at the end"
   gets the fallback "Noted. Pull a shot when you're ready…". Typed text
   after a shot, when the taste question was set aside for it, is read like
   an answer: the same taste words as "Other" (sour, bitter, weak/watery,
   strong, balanced/sweet) take the taste path (look at the curve, then
   propose); text with none of them keeps today's reply.

Keep every other decision as it is, in both voices; update
ENGINE_PROTOCOL.md's scripted-model rules to match (rules 2 and 3, and the
typed-taste case).

## The demo's story (mock/demo) and the mock Decaid

4. **Santos says "No decision yet".** Its chat says the coach keeps v1, but
   History says "Taste: Balanced, sweet / No decision yet" because no keep
   card was confirmed. Make the coach propose keeping the recipe (a keep
   card, `variable: "none"`) and the barista confirm it, so History says it
   was kept.
5. **Repeated shot numbers.** Shots 1, 3, 4 and a freshly pulled shot all
   ran 62.4 s with the first drop at 7.4 s, and shots 1 and 3 both gave
   45.8 g. Give the demo's shots realistic variety (for example each its own
   puck resistance, within about ±10 %, and a slower shot after the finer
   grind), so times, first drops and yields differ. Leave the live mock's
   shots as they are if e2e tests rely on their numbers; otherwise varying
   them is fine.
6. **The guard note covers the composer.** When the demo refuses to load,
   its note covers the left half of the chat box (on Settings, the grinder
   field) until dismissed. Put it where it covers nothing the user needs
   (for example the top of the page, under the app bar), still dismissible.
7. **The group temperature does not follow the profile.** In the mock Decaid
   the panel shows "target 89.0" idle with v4 (93 °C) loaded, "target 92.0"
   during a 94 °C shot, and "99.2 °C target 100.0" after it. Make the mock's
   group target follow the loaded profile (its first step's temperature when
   idle, the running step's during a shot) and settle back to the idle target
   after a shot. Only in `mock/decaid/`; keep any number an e2e test relies
   on, or update the test.

## Docs

`docs/DEMO.md`: a pulled shot takes about a minute (Blooming soaks the puck
for about 30 s with the pump off, and the panel shows 0 bar then); the
answers table after item 2 (weak and strong when the shot stopped short of
its target); typed tastes are read; Santos is kept; the new shot numbers.

## You own (create or modify only these)

`mock/**` (source and tests), `docs/DEMO.md`, `docs/briefs/ENGINE_PROTOCOL.md`
(the scripted fake model section only), `e2e/demo.spec.ts`, and other
`e2e/*.spec.ts` only where they assert a mock number or reply you changed
(say which; you cannot run them). Nothing in `src/`.

## Tests (TDD)

Failing tests first: the peak sentence matches the summary's peak and time,
and leaves the time out without a summary; weak and strong after a shot that
stopped short give the grind moves (finer, coarser), and after a shot that
reached its target the yield moves as before; a typed sour text takes the
taste path, a typed text without a taste word does not; Santos's iteration
is kept; no two Kiambu AA shots share time, first drop and yield; the guard
note's placement; the mock group target before, during and after a shot.

## Verify and report

Run in your worktree, capturing exit codes with
`cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (never through `| tail`):
`npm ci` (first), `npx tsc -p tsconfig.json --noEmit`, `npx eslint .`,
`npx vitest run`. No Playwright, no dev server. Windows: edit with the
Edit/Write tools.

Final message (at most 40 lines): worktree path and branch, files changed,
the story's shots as built (time, first drop, yield), tests added, e2e
assertions changed, commands with exit codes, deviations.

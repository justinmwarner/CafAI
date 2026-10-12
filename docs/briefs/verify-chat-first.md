# Fresh-eyes check: chat first, the machine on demand

You are a verifier who has not seen CafAI's code, and you should not read
it: look at the app the way its owner will. You never fix code. You report
defects with steps to reproduce and evidence; the integrator fixes them.

CafAI is a chat-first espresso coach that runs as a web skin inside Decaid,
the Decent Espresso app, on tablets mounted on the machine (962x602 CSS px
and up) and in phone browsers. The owner asked for this change:

> When I load the page, I expect the graph and the whole machine stats to
> not show up. The chat window could have a "stats" message it sends when
> you first open it that live updates, but then as you chat, it goes away.
> Then in the "pre filled" prompts, one can always be stats to output it
> again. Then the graph you have to click into, it can be in the header.
> We can still have a row of these really commonly used buttons, even the
> stop button can live up here and it replaces whatever the active thing is.

What was built (read for the expected behaviour, not the code):
`docs/superpowers/specs/2026-10-08-chat-first-machine-design.md` (its rules
table in section 3), the renders in `docs/superpowers/specs/assets/chat-first-*.png`,
`DESIGN.md`, and DECISIONS.md D90-D92. The earlier rework it builds on is
`docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md` (D80-D89).

## Setup

- Work in the scratch clone `E:\source\cafai\.verify` (never in
  `E:\source\cafai` itself). Bring it to the branch under test:
  `git -C /e/source/cafai/.verify fetch origin` then
  `git -C /e/source/cafai/.verify checkout -B feat/ux-modes-theme origin/feat/ux-modes-theme`
  (if the clone has tracked local changes you did not make, stash them first
  and say so; its untracked `e2e-qa/` and `playwright.qa.config.ts` are
  yours to reuse), then `npm ci` and `npm run build:mock` there.
- Drive the app with Playwright using `.verify/playwright.qa.config.ts`
  (port 4174, the mock build). Viewports: 962x602, 1280x800, 390x844 and
  360x640 (phones with `isMobile` and touch), and 844x390 (a phone on its
  side). Put your specs in `.verify/e2e-qa/` numbered from 80
  (`80-chat-*.spec.ts`); keep screenshots as evidence. One Playwright run at
  a time, nothing else on port 4174.
- The demo (`/?demo=1`, add `&mockSpeed=3` to slow a shot enough to watch)
  shows the app in use: a bag dialled in over four shots and an open taste
  question. Elsewhere use `/?mockSpeed=25#/` and set up a bag as the e2e
  helpers do (`e2e/helpers.ts` in the clone: you may read the e2e helpers
  and specs, not `src/`). `docs/SIMULATOR.md` and `docs/DEMO.md` say what
  the mocks can do.
- Capture exit codes with `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`, never
  through `| tail`.

## What to check

1. **On load, every size.** No machine column and no graph. The chat ends
   with the live stats card (state, the machine's and scale's links, Group,
   Steam, Water, Scale, the profile, Tare, Sleep), and its readings move as
   the mock moves. The Stats chip sits above the composer. The machine row
   (Espresso, Steam, Flush, Hot water) is in the top bar, labelled on a
   tablet, icons on a phone. Nothing clipped, overlapping, cut off or
   scrolling sideways; Exit and Decaid settings reachable on every screen.
2. **The card's life.** It goes away as soon as anything new lands in the
   chat: a message you send, a taste chip you tap, a shot card, a notice;
   and when you switch bags. Stats brings it back at the end of the chat,
   in view. History and back keeps it if nothing new landed; a reload shows
   it again. It never appears in History or the export, and the coach never
   mentions it.
3. **The row and Stop.** Tap Espresso: the same box turns into Stop, the
   other starts wait. Stop works at once, including in the first moments
   after the screen switched to the graph by itself, on a tablet and a
   phone. The same for Steam, Flush and Hot water in their own boxes. After
   a run ends, a quick second tap where Stop was starts nothing. A sleeping
   machine shows Wake alone. Anything the row cannot do says why (a screen
   reader name or the alert).
4. **The graph.** The Shot item (tablet) or tab (phone) opens it: the last
   shot between shots, a dash before any shot. A starting shot takes the
   screen by itself, then the coach comes back with the shot card (going to
   the coach yourself during a shot keeps you there). On a phone, the live
   strip on the Coach tab during a shot opens it.
5. **Problems.** Make the mock lose the machine, run low on water, or fail
   a command where it can: one slim alert under the top bar says what is
   wrong and goes when the problem does, without flicker.
6. **Typing and resizing.** Typing a message is never interrupted by a
   shot; drafts survive rotation and resizing across 800 px wide and 500 px
   tall, with the card and the row in sensible places.
7. **Looks.** Light Matcha, light Tamper and dark Cherry: the row, the card,
   the chip and the alert legible and in the look.
8. **Old behaviour still right.** The full loop (new bag, template, v1,
   shot, taste, confirm v2, Undo) on a tablet and a phone; History and
   export; Settings key and grinder.
9. **Console.** No errors or warnings in the browser console.

## Report

At most 80 lines: each defect with a severity (blocker / major / minor /
polish), steps, expected vs seen, and the screenshot path. Then what you
checked and found right, in a few lines. Do not edit anything outside
`.verify/e2e-qa/`. Leave port 4174 free.

# Fresh-eyes check: the UX rework (layouts, shot focus, appearance)

You are a verifier who has not seen CafAI's code, and you should not read
it: look at the app the way its owner will. You never fix code. You report
defects with steps to reproduce and evidence; the integrator fixes them.

CafAI is a chat-first espresso coach that runs as a web skin inside Decaid,
the Decent Espresso app, on tablets mounted on the machine (962x602 CSS px
and up) and, new in this rework, in phone browsers. The owner asked for:

- a **tablet and a phone layout**;
- **when a shot is active, the screen goes to the graph by itself**, and
  from the chat it is easy to get back to the chart;
- **nicer typography**;
- a **theme bound to a palette**: light and dark, plus a tint (the brown
  "Crema" is the default; the owner would pick a green), so people can
  match the look to their space.

What was built (read for the expected behaviour, not the code):
`docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md` (sections
1-5) and its mockups in `docs/superpowers/specs/assets/`, `PRODUCT.md`,
`DESIGN.md`, and DECISIONS.md D80-D86.

## Setup

- Work in the scratch clone `E:\source\cafai\.verify` (never in
  `E:\source\cafai` itself). Bring it to the branch under test:
  `git -C /e/source/cafai/.verify fetch origin` then
  `git -C /e/source/cafai/.verify checkout -B feat/ux-modes-theme origin/feat/ux-modes-theme`
  (if the clone has local changes you did not make, stash them first and
  say so), then `npm ci` and `npm run build:mock` there.
- Drive the app with Playwright using `.verify/playwright.qa.config.ts`
  (port 4174, the mock build). Add your own projects or `test.use` viewports
  for 962x602, 1280x800, 390x844 (phone, `isMobile`, touch) and 844x390
  (phone on its side). Put your specs in `.verify/e2e-qa/` numbered from 70
  (`70-ux-*.spec.ts`); keep screenshots as evidence. One Playwright run at a
  time, nothing else on port 4174.
- The demo (`/?demo=1`, add `&mockSpeed=3` to slow a shot enough to watch)
  shows the app in use: a bag dialled in over four shots and an open taste
  question. Elsewhere use `/?mockSpeed=25#/` and set up a bag as the e2e
  helpers do (`e2e/helpers.ts` in the clone: you may read the e2e helpers
  and specs, not `src/`).
- Capture exit codes with `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`, never
  through `| tail`.

## What to check

1. **First look, every size.** Coach, History and Settings at 962x602,
   1280x800, 390x844 and 844x390, in the default dark Crema. Typography:
   one typeface (Figtree), sentence-case labels, numbers that do not jitter
   while they count, arrows in "18.0 g → 40.4 g" rendering (not boxes).
   Nothing clipped, overlapping, cut off, or scrolling sideways. Exit and
   Decaid settings visible on every screen in both layouts.
2. **The shot takes the screen.** In the demo on a tablet: tap Espresso.
   Within about a second the right side shows the big graph (timer,
   pressure, flow, weight, weight flow, the running step) and a small coach
   note ("I'm watching this shot..."); the machine column and Stop do not
   move. After the pour: "Done. Reading the shot"; then the coach comes back
   by itself with the new shot card. Repeat on a phone: the Machine tab
   opens by itself. Tap Stop mid-shot right after the switch: it must work.
3. **Back to the chart.** During a shot, go back to the coach yourself: on a
   tablet, the preview chart in the machine column and the "Shot" nav item
   (with the running time) open the graph; on a phone, the live strip at the
   top of the Coach tab and the Machine tab (with the running time) do. The
   newest shot card's "Graph" opens the last shot's graph. Going to the coach
   yourself during a shot must stop the app from switching back by itself.
4. **Typing is never interrupted.** Start typing a message to the coach (do
   not send), then start a shot: the coach stays, your draft is intact; on a
   phone the tabs hide while the keyboard field has focus and come back when
   it loses it.
5. **Appearance.** Settings > Appearance: Dark, Light, Auto; each named
   tint; the custom hue slider (drag and keyboard). Every screen follows at
   once, including the shot graph's grid and axes (its pressure and flow
   colours stay green and blue in every tint). Check legibility in light
   Matcha, light Steel, dark Cherry and a custom hue near yellow: any text
   hard to read, any control that disappears, anything still brown in a
   green look? Reload: the look stays, and the "Starting CafAI..." screen
   uses it too. Auto: emulate `prefers-color-scheme` dark and light.
6. **Rotation and resize.** Resize across 800 px wide and 500 px tall
   during a shot and while typing: no lost draft, no lost shot graph, no
   control jumping under the finger.
7. **Old behaviour still right.** The full loop (new bag, template, v1,
   shot, taste, confirm v2, Undo) on a tablet and a phone; History and
   export; Settings key and grinder.
8. **Console.** No errors or warnings in the browser console during any of
   this.

## Report

At most 80 lines: each defect with a severity (blocker / major / minor /
polish), steps, expected vs seen, and the screenshot path. Then what you
checked and found right, in a few lines. Do not edit anything outside
`.verify/e2e-qa/`.

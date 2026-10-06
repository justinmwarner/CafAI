# Fresh-eyes check: the demo (`npm run demo`)

You are a verifier who has not seen CafAI's code, and you should not read
it: look at the app the way its owner will. You never fix code. You report
defects with steps to reproduce and evidence; the integrator fixes them.

CafAI is a chat-first espresso coach that runs as a web skin inside Decaid,
the Decent Espresso app. Its owner asked for a demo to run on their own
computer: the app opens with a chat already filled in (one bag, "Kiambu AA",
dialled in over four shots, showing every kind of card and notice the coach
can show, plus a second bag), and the last shot's "How did it taste?" is
left open. Tapping an answer should look like the real coach working: a
"Thinking…" row for about 1.5 s, text streaming in at reading pace with
small pauses, fuller coaching sentences, then a change card. It is all
scripted: a built-in mock Decaid and a scripted coach, no API key, no tokens.
Background, if you need it: DECISIONS.md D76 and docs/DEMO.md.

## Setup

- Work in the scratch clone `E:\source\cafai\.verify` (never in
  `E:\source\cafai` itself). Bring it to the repo's current `main`
  (`git -C /e/source/cafai/.verify pull --ff-only`, or fetch and check out
  `origin/main` if it has local changes you did not make), then `npm ci` and
  `npm run build:mock` there.
- Drive the app with Playwright using `.verify/playwright.qa.config.ts`
  (port 4174, the mock build, 962x602 tablet). Put your specs in
  `.verify/e2e-qa/` numbered from 60 (`60-demo-*.spec.ts`); keep screenshots
  as evidence. Run one Playwright run at a time, and nothing else on port
  4174.
- The demo page is `/?demo=1` (add `&mockSpeed=25` only where you need
  speed; check the realistic timing without it). Also check once that the
  dev server path works: `npx vite --mode mock --port 5175 --strictPort
  --host 127.0.0.1` (in the background, stopped afterwards) serves
  `/?demo=1` the same way. Do not run `npm run demo` itself: it opens a
  browser window on the owner's desktop.
- Capture exit codes with `cmd > "$TEMP/x.log" 2>&1; echo exit=$?`, never
  through `| tail`.

## What to check

1. **First look (962x602 and 1280x800).** It opens on the Coach screen with
   no error, banner or warning. The chat ends at the open question, scrolled
   to it. Read the whole conversation as a new user would: does it tell a
   believable story? Check that you can find each of these: your own
   messages; coach text with formatting (paragraphs, **bold**, a list);
   template cards (one "In use"); notices (info, success, warning); shot
   cards with a graph, with and without stars, one with a channeling
   warning; answered taste chips (one multi-select, one "Other" answer);
   change cards applied, by hand (grinder), declined, undone (with "Back on
   Kiambu AA v2."), and the latest one with Undo. Nothing clipped,
   overlapping or cut off.
2. **Consistency.** The numbers agree everywhere: the shot cards, the
   coach's sentences, the change cards, the header's version, the machine
   panel's profile line, History, Settings (grinder and its setting), and
   the dates (recent, in order). Flag any typo, contradiction, invented
   number, or text that reads like a test string.
3. **The open question.** In separate fresh loads, tap each answer (Sour /
   sharp, Bitter / harsh, Balanced, sweet, Weak / watery, and Other with your
   own words). Each time: the "Thinking…" row shows for about 1.5 s; the
   reply streams in at a natural pace; it reads like a real coach and
   matches the data; a change card follows (or a sensible reply where no
   change is proposed). Confirm one: "Loading … on the machine…" with a bar,
   then "Loaded …". Try Not now on another. Time the thinking and the
   streaming roughly and report the numbers.
4. **Keep going.** After a confirmed change, pull a shot from the machine
   panel (it runs in real time, about 35 s): the live graph, then a shot
   card and the taste question again; answer it. Rate a shot with stars.
   Undo the latest change.
5. **Start over.** A reload starts the same demo again (same chat, the
   question open).
6. **The second bag.** Switch to it with the bag picker: its version loads
   on the machine; its short chat shows. Switch back.
7. **History and Settings.** History lists both bags' shots and opens them.
   Settings shows a placeholder key (masked) and the linked grinder.
8. **The guard.** In a fresh browser context: open the app without
   `?demo=1`, add a key in Settings and start a bag of your own; then open
   `/?demo=1`. The demo must not load: a note explains why, your bag is
   still there, and the note can be dismissed. Also `/?demo=1&mockDecaid=0`:
   no demo.
9. **Console.** No errors or warnings in the browser console during any of
   the above, apart from ones the steps provoke on purpose.

## Report (your final message, at most 60 lines)

Defects first, ranked major / minor / polish, each with: steps to
reproduce, expected, actual, evidence (screenshot path or console line).
Then the timings you measured, then a short list of what looked right. Say
which spec files you added.

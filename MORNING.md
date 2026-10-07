# Good morning: CafAI after your answers (2026-10-04)

Your nine answers in QUESTIONS.md are all done. Each is an owner decision
(D55-D63), and each that changed behaviour went through its own brief,
tests and review. The overnight gaps that need no hardware are closed, there
is an opt-in test against the real Anthropic API, and
`docs/HARDWARE_TEST_PLAN.md` is the checklist for the first session on a
real DE1. Everything is committed in small steps on `main`; nothing was
pushed.

## Done means: status

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | pass |
| Lint (`npm run lint`) | pass |
| Unit tests (`npm test`) | **2047/2047** in 125 files on 2026-10-06 (this morning: 1836 in 115; overnight: 1254 in 91) |
| Playwright (`npm run e2e`) | **114/114** at 962x602, 1280x800 and 1920x1200 on 2026-10-06 (this morning: 93; overnight: 27) |
| `npm run verify` (all of the above, build and release zip) | pass |
| Real Chromium 91 (`npm run build:mock && npm run smoke:chrome91 && npm run smoke:chrome91:loop`) | pass: the app loads with no console or page errors, and the whole coach loop runs, now waiting for the machine to confirm each load |
| Live API test (`npm run test:live`) | skipped here (no key on this machine); its dry run against the scripted coach passes |
| Fresh-eyes verifier | found 1 major, 5 minor and 3 polish defects; all fixed, and its own repro spec passes against the fixes (8/8) |

## Since then: Decaid's simulator and a demo (2026-10-05 and 06)

- **A demo you can open (D76).** `npm run demo` opens
  <http://localhost:5175/?demo=1>. CafAI is already in use there, on the
  built-in mocks: no Decaid, no API key, no tokens.
  - **What's on screen:** Kiambu AA, dialled in over four shots, showing
    every kind of card and notice the coach can show:
    - template cards;
    - "Loading…" and "Loaded" notices;
    - shot cards with graphs and stars;
    - answered taste chips;
    - change cards: applied, made by hand, declined and undone.

    A second bag, Santos, is in the bag picker.
  - **The open question:** the last shot's "How did it taste?" is waiting.
    Tap an answer and the coach thinks for about 1.5 s, streams its reply,
    looks at the pressure curve, then proposes a change. Confirm loads it
    ("Loading Kiambu AA v5 on the machine…", then "Loaded"). Each answer
    leads somewhere different, and a typed taste works too.
  - **Starting over:** a reload starts the demo again from the beginning.
  - **Your own data:** the demo never writes over CafAI data that is
    already at that address; it says so instead.

  What's on screen and what each answer does:
  [docs/DEMO.md](docs/DEMO.md).
- **How it was built and checked:** each load makes the demo's data by
  playing a written story through CafAI's real engine, so the demo shows
  exactly what the app writes. A fresh-eyes verifier drove it at 962x602:
  its 15 findings are fixed, and its re-check confirmed 14 of them. The rest
  are fixed too, checked by tests rather than driven again: the typed taste
  it found half done, plus 2 new findings from the re-check (a card timed
  its peak on another clock, and the guard note squeezed the app).
- **App fixes found on the way.** These would show with the real coach too:
  - Undo marked the wrong shot's change as undone in History (D77).
  - The panel and the shot card gave different times and yields (60.6 s and
    44.5 g against 62.4 s and 41.5 g). Now there is one time, the pour, and
    one yield, the settled cup, everywhere. The card counts its times from
    the start of the pour, and the panel names the running step ("Pulling a
    shot: pause" during Blooming's bloom) (D78).
  - The answer to any coach question was saved as the shot's taste, in
    Decaid's shot notes too. Now only the taste question's answer is (D79).
  - Cards set aside after Undo or a new shot said "you answered in the chat
    instead".
  - The keep card read like a change made by hand.
  - The coach's paragraphs ran together.
  - Raw `**` flashed while a reply streamed.
- **Seen on both simulators:** Blooming v1 runs out of profile at 42-48 g
  from 18 g, short of its 50 g stop. If a real DE1 does the same, the yield
  comes from the length of the pour, not the stop (QUESTIONS #3, hardware
  plan 3.5).

## Your answers, one by one

1. **Can CafAI GET the profile and wait until the machine has it?** No
   endpoint reads the profile back. But `POST /api/v1/machine/profile` with
   the same profile answers only once the machine has acknowledged the
   upload, so CafAI now waits on it after every load. The chat says "Loading
   <Bean> vN on the machine…", then "Loaded …". A shot that started while
   the version was still loading is not credited. The four options and why
   the others lost are in D55. Measuring the real timing needs a DE1: hardware
   plan sections 3-5.
2. **Default model.** Unchanged (`claude-opus-5-5`); you pick another in
   Settings. Running the coach from your own computer, like Crema's Mac
   server, is on the roadmap with what to check first (`docs/ROADMAP.md`).
   `ANTHROPIC_API_KEY=<key> npm run test:live` proves the default and, with
   `LIVE_ALL_MODELS=1`, every picker id against the real API (D56).
3. **Lever bounds and starting yields.** v1 now stops at the profile
   author's own ratio times the dose in Decaid: Blooming and D-Flow 1:2.8,
   Londonium and Gentle and Sweet 1:2, the Allongé 1:5. A dose outside
   12-25 g, or none, counts as 18 g. The chat says where v1 stops and why.
   The Allongé's window is 4-6x (it promised 135 g before), Gentle and
   Sweet's tops out at 3x; every other bound was checked and stays (D57).
4. **Chromium 91.** The target stays. An older engine gets a dismissible
   warning, and a start that fails shows a page with Exit to Decaid and
   Decaid settings. Decaid's WebView calls itself "Decent", so the check
   tests for Chromium 91 syntax; in the real Chromium 91 it reports
   supported (D58).
5. **v1 in Decaid's library.** Following from #3, v1 usually differs from
   the bundled profile, so it gets its own entry, filed under the bundled
   profile as its parent (D59).
6. **Storage across iOS updates.** Unchanged, and now proved end to end: a
   new test empties CafAI's browser storage and checks that everything but
   the key comes back from Decaid's backup (D60).
7. **Feedback to Decaid's shot record.** The taste answer goes into the
   shot's notes (your own notes are kept; CafAI only swaps its own line) and
   `extras.cafai`. An optional five-star rating on the shot card goes into
   `enjoyment`. Failed writes are retried (D61). *My reading:* enjoyment
   only when you rate the shot, never derived from the taste (question 4
   below).
8. **Grind and Decaid's grinders.** Settings links a grinder from Decaid's
   grinder library. Its step, or its list of settings, turns "1 step finer"
   into the new setting and checks the coach's numbers. The card says where
   the step came from, or that the setting is the coach's estimate when
   CafAI doesn't know the step (D62, D73). *My reading:* lower numbers are
   finer (question 2 below).
9. **Gentle and Sweet.** It is byte-identical to Decaid's current file, and
   tests pin the regenerated values. A pressure curve cannot tell it from
   the stale import; the 88 °C target in every frame and the profile id can.
   That is the check in hardware plan section 6 (D63).

Every answer is in QUESTIONS.md under "Answered", with its decision and
commits.

## The other gaps from last night

- **Lost-shot search:** the chat shows "Looking for that shot in Decaid…"
  with a progress bar and "Try n of 6" (D65).
- **A grind setting Decaid missed:** failed writes to Decaid (grinder,
  shot notes) wait and go out again when Decaid is back, within 30 s, or
  before the next shot (D64).
- **Which profile is loaded:** the machine panel has a Profile line. It is
  marked as the bag's version only once the machine has it, and it changes
  together with the banner when something else loads a profile (D66, D70,
  D72).
- **Restoring from the Decaid backup:** now an end-to-end test; the mock
  keeps its store across a reload on request (D67).
- **The live API test:** opt-in, skipped without `ANTHROPIC_API_KEY`, and
  never part of `npm test` (D68).
- **Decaid's own simulator on your computer (asked after the session):**
  it works. Decaid 0.8.7's Windows build was run here with its simulated
  machine and scale, and CafAI did the whole loop against it: coach-only
  (`npm run dev:sim`, no API tokens), normal (`npm run dev`), and inside
  Decaid's own window. Decaid is left at
  `%LOCALAPPDATA%\cafai-sim\decaid-0.8.7\Decaid.exe` with the simulator on.
  Close other CafAI tabs first: an open one joins the simulator too. The run
  found that the panel's "Last shot" time counted Decaid's 4-5 s save after
  the pour; fixed (D75). Steps and limits:
  [docs/SIMULATOR.md](docs/SIMULATOR.md) (D74).

## Fresh-eyes verification

A separate agent that had not seen the code drove the built app at 962x602
with 26 new exploratory spec files (in the scratch clone, `.verify/e2e-qa/`,
numbered 40-56), and re-ran the earlier verifiers' 89 QA tests (84 still
pass; the 5 that fail do so because of today's intended changes). It found:

- **Major:** an API key pasted into Settings' grinder fields went to
  Decaid's workflow, every later shot record and the coach. Settings now
  takes key-shaped text out of every field and says so (D69).
- **Minor:**
  - A profile loaded behind CafAI's back went unnoticed until a shot was
    wasted; CafAI now looks every 30 s (D70).
  - After a failed load the coach said to wait for the machine to connect
    while the banner said Retry; the coach now hears `loadError` (D71).
  - A deleted grinder kept its step text, and a setting nobody checked had
    no caveat (D73).
- **Polish:**
  - "This bag" showed before the machine had the version (D72).
  - A notice named the same title twice.
  - Settings put Save below the fold after a pick.

All are fixed with tests, and the verifier's own repro spec passes against
the fixes. The chat missed following the newest message once in 21 runs,
and did not do it again in 18 more, one batch with the CPU slowed 4x. It is
recorded, not chased.

## Still open

- **Nothing has touched a real DE1 or the real API.** The hardware plan
  covers the first session; `npm run test:live` covers the API.
- **Coffee knowledge is still the placeholder** heuristics block (now
  aligned with D-Flow's start ratio).
- Not built: teaching mode, personas, bag photos, voice, other providers in
  the UI, steam and hot-water editors, device-connect screens, a
  screensaver, and the local coach (roadmap).
- Writes waiting for Decaid live in memory only (D64).

## Top 5 questions for you

1. **Does Decaid's barrier behave on a real DE1 as its source says?**
   Crediting shots now depends on it (D55); the hardware plan measures it.
2. **Which way is finer on your grinder?** Decaid's library has no
   direction; CafAI assumes lower numbers are finer and preset lists run
   finest first (D62).
3. **Are the new starting yields what you want?** At 18 g: Blooming 50 g
   (Decent ships 60), Londonium 36 (42), the Allongé 90 (135). One number per
   template if not (D57).
4. **Enjoyment only from your stars?** Every answered shot gets notes;
   `enjoyment` only when you rate it (D61).
5. **Should CafAI also check each shot's targets against the version?**
   Decide after the hardware session's saved shots (D55 option 2).

More, ranked: [QUESTIONS.md](QUESTIONS.md). Decisions:
[DECISIONS.md](DECISIONS.md). The first machine session:
[docs/HARDWARE_TEST_PLAN.md](docs/HARDWARE_TEST_PLAN.md). Last night's
report (what works, what came from Crema) is `git show c878e4b:MORNING.md`;
README has the current overview.

## How the morning ran

I coordinated and did not edit product code or tests. Three research agents
read Decaid's source and the coffee sources. Then six workstream agents
(engine, platform, coach, shell, restore e2e, live API) worked in parallel,
in separate git worktrees with non-overlapping files, followed by a seventh
that wired the dose and the grinder into the engine. All six first stopped
at the usage limit within minutes; their worktrees were re-created and each
was resumed with SendMessage. Every diff was reviewed before it was merged.
Only I ran Playwright, one run at a time. The verifier ran last, and two
fix agents, then a third, closed what it found.

## Try it in two minutes

```bash
npm ci
npm run demo
# opens http://localhost:5175/?demo=1: CafAI in use, one open question to tap
```

Or start from an empty CafAI:

```bash
npm run dev:mock
# open http://localhost:5173/?mockSpeed=20
```

Settings -> any key (for example `sk-ant-demo`) -> pick "Niche Zero" under
Grinder from Decaid, setting 15 -> Coach -> New bag -> "Kiambu AA, light
roast, washed" -> tap a template (watch "Loading … on the machine…") ->
Espresso -> rate it and tap "Sour / sharp" -> Confirm -> History.
`?mockUploadMs=3000` makes the machine load slow enough to watch.

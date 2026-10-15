# Good morning: CafAI after your answers (2026-10-04)

**Newest (2026-10-15):** the cleaning guide, the first machine care item of
the gap review (D151-D156, branch `feat/machine-care`, merged into `main`).
Settings > Machine care > **Cleaning guide** opens Decent's routine one
routine at a time (Daily, Weekly, Monthly, As needed: your two answers),
each step with what to do, when, and its moment in Decent's video "How
often/to clean DE1". Where the 2022 video and Decent's current pages
differ, the step follows the pages and says so; a review checked every step
against the quick start and the Forward Flush x5 profile's own notes and
put four right. YouTube accepts Decaid's user agent, even in Chromium 91,
but Decaid 0.8.8 for Windows refused to frame the player and opened YouTube
in the browser instead, so the video plays in place in a browser and on
Android, and inside Decaid elsewhere each moment is a link to YouTube at
that time. Nothing loads from YouTube until a tap. One call of mine to
check (D156): while the video is open, a drink started from the top bar
leaves the guide on screen rather than closing the video the barista is
following. On the final code: typecheck, lint, 3831 unit tests, both
builds and the release zip pass; Playwright passed all 356 tests (8 skipped
by design); Chromium 91 plays the video in place. Not yet seen on a Decent
tablet: `docs/HARDWARE_TEST_PLAN.md` section 14.

**Before that (2026-10-13):** steam, hot water and flush take the screen while
they run (D146-D150, branch `feat/drink-views`, merged into `main`): a dial
fills toward the time or volume set, with steam rising from milk, water
filling or the shower screen pouring while the machine works; the machine's
readings and a trace of the run; and the drink's own settings, held while
it runs and live once it stops, with **Go back** rather than a return (your
two answers). The mock now runs each drink for its real time or volume.
On the final code: typecheck, lint, 3767 unit tests, both builds and the
release zip pass; Playwright passed 305 of 307 in the full run, and the two
that crashed as this machine's session ended (a crashed page and a worker
exit, not assertions) pass on all five sizes when run again, with the new
spec. Chromium 91 runs the views with no page errors. What a real DE1 sends
while it steams is still unverified: `docs/HARDWARE_TEST_PLAN.md` section 13.

**Before that (2026-10-11):** your list after the alignment, on branch
`feat/decaid-alignment` (D123-D128): tints named for coffee, the drink
settings laid out by drink, grinders added from Settings or the chat,
ratings in words instead of stars, a coach that leaves the taste to you,
and a repository ready for the public. Its section comes right after the
status table. The repository is public on GitHub since you pushed `main`
and the tag `v0.1.0` on 2026-10-11; this branch is not pushed.

**Before that (2026-10-09 and 10):** Decaid alignment and update safety, on
the same branch. CafAI now checks itself against Decaid's own API specs at
the release you run (v0.8.8), watches Decaid's newest release
and `main` for changes that would break it, reads every Decaid reply instead
of trusting it, and fails safe, out loud, when Decaid sends something
unexpected. It also uses more of Decaid: a new bag starts from Decaid's bean
library or a photo of the bag, the coach reads DYE2's setups, shot cards
link to Visualizer, and there are Connect, a heating countdown, Next step,
steam, hot water and flush settings, and a switch to keep the API key in
Decaid. A fresh-eyes review found 25 defects, all fixed, and everything
passes, against Decaid 0.8.8 on your simulator too. All of it but the
review's fixes (and the last e2e specs) reached `main`, and so v0.1.0;
those are on this branch only. Its section follows this round's. Before
it, merged into `main`: the machine on demand (2026-10-08 and 09) and the
UX rework (2026-10-07 and 08), in the two sections after it.

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
| Unit tests (`npm test`) | **3576 passed, 1 skipped** in 192 files on 2026-10-11, after your list and `main`'s Decaid skill (earlier on 2026-10-11: 3014 in 169; 2026-10-09: 2330 in 144; 2026-10-08: 2275 in 141; 2026-10-06: 2047 in 125; 2026-10-04: 1836 in 115; overnight: 1254 in 91) |
| Playwright (`npm run e2e`) | **271 passed, 2 skipped** on 2026-10-11 after your list, on all five sizes (each phone skips a tablet-only check), with 5 workers (`npx playwright test --workers=5`) in 7.4 minutes. One more failed in that run, the restore after lost storage on the 962x602 tablet, a timeout while `npm run screenshots` ran beside it; alone it passed on all three tablets. Earlier on 2026-10-11: 258 (2026-10-09: 188; 2026-10-08: 140; 2026-10-06: 114 on the three tablets) |
| `npm run verify` (all of the above, build and release zip) | every part passes on 2026-10-11, run side by side rather than as the one command (which runs e2e on one worker) |
| Real Chromium 91 (`npm run build:mock && npm run smoke:chrome91 && npm run smoke:chrome91:loop`) | pass on 2026-10-11, again after your list (the loop now rates the shot Better): the app loads with no console or page errors, and the whole coach loop runs, now through "Which coffee is it?" (Something else), waiting for the machine to confirm each load; the chat opens with the stats card, Stats brings it back, Espresso in the top bar turns into Stop and the Shot view takes the screen, and the coach comes back with the card |
| Real Decaid (`npm run test:decaid` with writes and a simulated shot) | **36/36** on 2026-10-11 against Decaid 0.8.8+2900 (`aab5f938`, the pin) on your Windows simulator, including the new checks: Connect and a reconnect after a disconnect, Next step during the shot, the time-to-ready channel, DYE2's and Visualizer's data (2026-10-10: 31, then 32) |
| CafAI served by Decaid (`npm run e2e:real`) | pass on 2026-10-11, the production build from Decaid's port 3000 |
| Drift watch (`npm run decaid:watch`) | exit 4 on 2026-10-11: every check passes for v0.8.8 and Decaid's `main` (`af4e995`), whose spec changes are additions; files CafAI depends on changed on `main` (camera access for skins, the Visualizer plugin), so on GitHub it would open a `decaid-read` issue (D105) |
| Live API test (`npm run test:live`) | skipped here (no key on this machine); its dry run against the scripted coach passes |
| Fresh-eyes verifier | 2026-10-11, your list (D123-D128): one reviewer, no critical or high findings; 2 medium (an unknown verdict in a stored chat stopped the coach for that bag; the taste-wording guard missed common promises and read only `expectedEffect`) and 8 low, with nits; all fixed in `8720050` but the screenshot script's fake clock, which only its own pictures meet (they are made deterministic another way). 2026-10-10, Decaid alignment: three reviewers (update safety; engine and storage; UI) found 25 defects, 7 of them important, each verified with a test or Decaid's source; all fixed (`197520d`, brief `docs/briefs/verify-decaid-alignment.md`). 2026-10-08, the UX rework: 2 major, 5 minor and 8 polish; 13 fixed, 1 kept by design, 1 open (below). Chat first: not run yet (its brief is `docs/briefs/verify-chat-first.md`). Earlier rounds: all fixed |

## New: your list after the alignment (2026-10-11)

Your notes of 2026-10-11, one agent each, merged on
`feat/decaid-alignment` and written up together (D123-D128). The
repository is public at <https://github.com/justinmwarner/CafAI>: you
pushed `main` and the tag `v0.1.0` on 2026-10-11. This branch, with the
review's 25 fixes and this round, is not pushed.

- **Tints named for coffee (D123).** Lagoon, Ocean and Steel are now Cold
  Brew, Blueberry (a little bluer-violet) and Tamper; a look saved under an
  old name keeps its tint.
- **Steam, hot water and flush, cleaned up (D124).** Grouped by drink as
  the machine row draws them, one outlined stepper per setting with its
  unit beside the value, Up and Down on a keyboard, "Saving…" and any
  failure under the setting itself, and nothing moves when the machine
  starts. Before and after: `.verify/settings-ui/`.
- **Grinders (D125).** Settings > Add a grinder adds one to Decaid's
  library and picks it; the coach offers the same on a card when you name a
  grinder it doesn't know; Edit grinders in DYE2 opens DYE2's page.
  Decaid's own app has no grinder screen, and no skin can open one of
  Decaid's screens. Screens: `.verify/grinder/`.
- **Ratings in words (D126).** The shot card asks how the shot compared
  with your previous one (Much worse to Much better; a bag's first shot
  against your last shot of another coffee). The words stay on the card and
  reach the coach, which is told your verdict outranks the numbers; Decaid
  gets a running score in `enjoyment` (a bag's first rated shot 5 of 10, a
  step per word after that). Old stars stay as they were. Screens:
  `.verify/ratings/`.
- **The coach leaves the taste to you (D127).** It never says what a shot
  should taste like or predicts a flavour: it explains a change by what it
  does at the machine, with your own words as the reason, and a proposal
  whose last line (now "What it changes", no longer "Expect") names a taste
  goes back to it to rewrite. While it asks how a shot tasted, **Taste
  words** above the composer offers neutral words for acidity, sweetness,
  bitterness, body and the finish, and **Need help?** says how to taste.
  Screens: `.verify/taste/`.
- **Ready for the public (D128).** A README for people who install CafAI
  (an honest status, screenshots, setup, troubleshooting, and credits for
  what CafAI took from others), NOTICE crediting decaid-mcp and Decaid's
  ports, CONTRIBUTING, SECURITY (GitHub's private reporting, no email
  address), a changelog, issue forms, and `npm run screenshots` to retake
  the README's pictures, retaken after this round's merges (the new tint
  names, "What it changes:").

**Look at first:** `npm run demo`: the shot cards rated in words, and on
the open question **Taste words** and **Need help?** above the composer;
tap an answer and the change card ends with "What it changes:". Then
Settings: the tints by their new names, and Steam, hot water and flush by
drink.

**Calls you may want to change:** a bag's first rated shot scores 5 of 10
whatever the word, and a changed word moves only its own shot's number
(QUESTIONS #17).

## New: Decaid alignment and update safety (2026-10-09 and 10)

Your ask: check CafAI against the patterns of the other skins for Decaid,
leaning on Decent's own streamline; hook up what Decaid offers natively; and
make sure Decaid updates do not break CafAI. The audit
(`docs/audit/2026-10-09/`, five reports) found CafAI ahead of every skin it
surveyed on engineering, but working from a view of Decaid read once and
never checked again, with seven ways a Decaid change would break it without
anyone noticing. You chose all eight update-safety layers and the features
below. Spec: `docs/superpowers/specs/2026-10-09-decaid-alignment-design.md`;
decisions D93-D122. Built on branch `feat/decaid-alignment`, which is not
pushed (`main` went on GitHub on 2026-10-11).

**Update safety**

- **Types from Decaid's own specs (D93, D94).** Decaid's REST and WebSocket
  specs from v0.8.8 (`aab5f93`), the release you run, are in
  `contract/decaid/` with TypeScript generated from them. `npm run
  typecheck` checks CafAI's wire types against them (78 checks); where the
  spec is wrong and CafAI follows Decaid's code, the exception is recorded
  with the Dart line that proves it. A new mismatch fails, and so does an
  exception Decaid has since fixed. `npm run decaid:update -- <tag>` moves
  the pin.
- **A drift watch (D105).** `npm run decaid:watch` asks whether Decaid's
  latest release or its `main` would break CafAI: it runs the same checks
  against their specs and lists the Decaid files CafAI depends on that
  changed. On GitHub a daily workflow runs it and opens an issue when a
  check fails (this branch's version once the branch is merged).
- **The mock checked against the spec (D94).** The mock Decaid's fixtures,
  replies and frames, and the bodies CafAI sends, are validated against the
  pinned spec, so the mock and the client no longer only agree with each
  other.
- **Checks against a real Decaid (D104).** `npm run test:decaid` runs
  CafAI's own client and parsers against a running Decaid and checks every
  reply and frame against the spec. It only reads unless told otherwise, so
  it is safe on your tablet; the writes and a simulated shot run only
  against a simulator. `npm run e2e:real` opens CafAI from Decaid itself.
- **Tolerant readers and the drift log (D95, D97, D107-D110).** Every Decaid
  reply goes through a reader: extra fields pass, and a missing or mistyped
  one is reported and handled, never turned into a silent 0, a crash or an
  endless retry. A renamed reading shows a dash, a machine state CafAI does
  not know gets Stop, a shot is found whatever Decaid calls its shot states,
  an unreadable backup is never taken for an empty one, and a write Decaid
  refuses is dropped with one notice.
- **Version and plugin awareness (D96, D103).** CafAI knows the Decaid it
  runs against and the one it was checked against, and uses time-to-ready,
  Visualizer and DYE2 only while Decaid has them loaded.
- **A fail-safe engine (D100, D101, D106).** After a Decaid update CafAI
  keeps trying Decaid's backup while Decaid starts (for up to 10 minutes,
  and again when the machine connects), then brings the bags back into the
  chat. Ratings go out on the rating scale your Decaid keeps (CafAI asks it:
  0-10, or 0-100 on 0.8.6 builds). A slow load waits 35 s and counts only
  what Decaid holds, and when Decaid cannot confirm a load or name the
  profile that ran, the chat says what CafAI assumed.

**Decaid features**

- **The gateway alert (D98).** In gateway mode Full, Decaid leaves stopping
  at the target weight to the skin, and CafAI does not stop shots. The
  machine alert says so, with **Let Decaid stop shots**, which sets
  Tracking.
- **Connect (D111).** "Not connected" has **Connect DE1** and **Connect
  scale**: one device at a time, the one Decaid prefers, or the only one
  found when none is preferred; otherwise the alert says why it connected
  none. A scale that dropped is looked for once by itself after a wake.
- **Ready in about N min (D112).** While the machine heats, the stats card
  says Heating (it used to say Ready while the group was cold) and, with the
  time-to-ready plugin, "Ready in about 3 min".
- **Next step (D113).** During a shot, one tap moves the profile on one
  step.
- **Steam, hot water and flush (D114).** In Settings, within what the DE1
  can hold: the hot water volume stops at 255 ml, because 300 would run as
  44 in the DE1's one byte.
- **About (D96).** Settings > About shows the Decaid you run next to the one
  CafAI was checked against, anything Decaid sent that CafAI did not expect
  (with Copy report), and when CafAI last backed up to Decaid.
- **The key switch (D99).** **Keep my API key in Decaid**, off by default,
  so the key survives a Decaid update, which wipes the skin's browser
  storage. The note under it says the cost: any device on your network can
  read Decaid's store.
- **The intake (D115-D122).** A new bag opens on "Which coffee is it?",
  shown from its top: the coffees in Decaid's bean library, newest roast
  first (one tap fills in and links the bag), **Photo of the bag** (the
  coach's model reads the label once, into a card you correct and confirm;
  CafAI keeps no copy), or **Something else** (describe it as before). The
  coach hears the roast date and the coffee's age, frozen days left out,
  and can read DYE2's setups for the coffee and its earlier roasts without
  changing them. A shot Decaid's Visualizer plugin uploaded gets **On
  Visualizer** on its card and in History.

**Verified**

- `npm run test:decaid` against Decaid 0.8.8+2900 (`aab5f938`, the pinned
  release) on your Windows simulator, 2026-10-10: 31 of 31 checks passed,
  with the writes and a simulated shot, in about a minute
  (docs/SIMULATOR.md section 6). A 32nd, the bean card's read of every
  batch (`GET /api/v1/bean-batches`), was added that evening and passes
  too, with the bean and batch write check extended to it.
- `npm run decaid:watch`: exit 0. Decaid's latest release is still v0.8.8,
  the pin, and its `main` (`af4e995`) has only additive changes since:
  `grinderBurrs` in the workflow (CafAI already clears it with the other
  grinder fields) and `grinder` as a device type; a Visualizer plugin that
  still writes the two keys CafAI reads; and camera access for skins,
  per-skin consent for live camera and, on Android, a confirmation before
  every photo taken through a file input like CafAI's (D122). The recorded
  spec exceptions for `grinderBurrs` and the grinder type can go when the
  pin moves.
- `npm run e2e:real` against the simulator, with Decaid serving the
  production build (`--skin-path`): passes. By hand, the same build from
  Decaid's port 3000: it restored the bags of the 0.8.7 trial from Decaid's
  backup and asked for the key again with the reason, and on a new bag
  "Which coffee is it?" listed a batch added to the simulator's library
  as "Roasted 1 Oct 2026", the day Decaid stored (zone-less) read as
  written here at UTC-5. That bean was archived afterwards.

**Not verified**

- The Linux CI path: `scripts/decaid-ci.sh` (Decaid's Linux release,
  headless) has never run, and neither has any of the four GitHub workflows
  (`ci`, `decaid-watch`, `decaid-live`, `release`); they wait for the
  repository to be on GitHub (QUESTIONS #9).
- The bag photo on a real tablet: what Decaid 0.8.8's WebView offers when
  CafAI asks for a photo, and the next Decaid's confirmation before every
  photo (hardware plan section 12, step 8). No photo has gone to the real
  Anthropic API either: `npm run test:live` does not send one, and the
  tests use the scripted coach.
- The Visualizer link with a real upload: only the mock's stand-in for the
  plugin has written the keys CafAI reads (hardware plan section 12, step
  9).
- Everything else in hardware plan section 12 needs the DE1: the rating
  scale, Connect, gateway mode, the drink settings, Next step, the
  countdown, the keyboard, and a coffee DYE2 has seen.

**Look at first:**

1. `npm run dev:mock`, open `http://localhost:5173/?mockSpeed=20`, save any
   key (`sk-ant-demo`), then Coach -> **New bag**: "Which coffee is it?"
   with the mock's two coffees. Pick Red Brick and the coach goes straight
   to the starting profiles; tap one, then Espresso, and a few seconds after
   the shot's card lands, **On Visualizer** appears on it. On the next new
   bag, tap **Photo of the bag** and pick any photo: the scripted coach
   reads it as Kiambu AA from Square Mile, for you to correct and confirm.
2. Settings > About: the Decaid lines and the backup's health. Open
   `http://localhost:5173/?mockGateway=full` for the gateway alert and its
   button.
3. The five new questions in QUESTIONS.md (9-13): putting the repository on
   GitHub, the rating scale on your tablet, the key in every browser, the
   ranges for steam, hot water and flush, and whether the spec fixes go to
   Decent.

**Calls you may want to change:**

1. Heating follows the machine's own state, and time-to-ready only adds the
   minutes (D112); the spec let the plugin's status decide, which would have
   shown Heating on a warm machine.
2. Next step sits at the end of the coach's note under the graph, not
   beside the step's name as the spec said (D113).
3. The photo comes through a file input, never a live camera (D122). The
   spec expected Decaid to ask for camera consent once per skin; on Android
   the next Decaid asks before every photo taken that way. A live camera
   would be asked about once per skin, but it needs a viewfinder in CafAI,
   and a phone on the network cannot use one (its page is not a secure
   context).
4. The bean card shows at most 8 coffees, the newest roasts; an older one
   needs a photo or a description (spec 6.1).

## New: chat first, the machine on demand (2026-10-08 and 09)

Your follow-up is built and merged into `main`, with the UX rework below it.
Nothing is pushed (this repository has no remote).

- **On load, the chat (D90).** No machine column and no graph: the screen is
  the coach, across the whole width.
- **The machine row (D90).** Espresso, Steam, Flush and Hot water sit in the
  top bar on every screen (icons only on a phone). The one that runs turns
  into Stop in its own box, so your finger finds it where it tapped; the
  others wait. A group-head machine's row is empty until something runs,
  then shows Stop alone; a sleeping machine shows Wake. For 1 s after a run
  ends the starts stay held, so a second tap on Stop starts nothing.
- **The stats card (D91).** The chat opens with a live card at its end:
  state, DE1 and scale, Group, Steam, Water, Scale, the loaded profile, Tare
  and Sleep. It goes as soon as anything new lands in the chat (your
  message, the coach's, a shot card) or you switch bags, and **Stats**, the
  one pre-filled prompt above the composer, brings it back. It is
  screen-only: never saved, exported or sent to the coach. Before there is a
  chat (no key or no bag yet) it sits under the setup card, so the machine's
  readings never wait for the coach.
- **The graph from Shot (D92).** Shot (in the tablet's top bar, and the
  phone's tab that replaces Machine) opens the graph. A starting shot still
  takes the screen by itself and hands back to the coach. The tap guard
  never covers the top bar, so Stop works the moment it appears, on a phone
  too (the phone's old guard over Stop is gone).
- **Problems** (not connected, Decaid out of reach, water to refill, a
  failed command) show in one slim alert under the top bar while they last.

**Look at first:** `npm run demo`. The card is the newest thing in the chat;
tap a taste answer and it goes; tap Stats and it comes back; tap Espresso in
the top bar and it turns into Stop as the graph takes the screen.

**Calls you may want to change:**

1. The phone's row buttons are 44 px, under the 48 px touch floor used
   elsewhere: four 48 px buttons with Exit and Decaid settings do not fit a
   360 px phone's bar.
2. The tablet row's labels are 11.5 px, under the 13 px text floor, so the
   bar fits 962 px with the Shot timer running.
3. Stop lives only in the top bar, as you chose: there is no big Stop in the
   graph view.
4. Below 960 px wide (an iPad upright) the tablet's places show their icons
   alone.

**Not done yet:** the fresh-eyes check of this change. Its brief is ready
(`docs/briefs/verify-chat-first.md`); say if you want it run.

**How it ran:** a spec and a mockup you approved; three agents in parallel
(the machine's pieces, the card in the chat, the shell), then one for the
e2e suite and the Chromium 91 loop beside a docs agent. The e2e agent was
stopped before its last runs (the permission system halted its Chromium 91
loop, then the usage limit), so I ran the full suite and both Chromium 91
checks myself when you asked to merge.

## New: tablet and phone, the shot on screen, a look of your own (2026-10-07 and 08)

Merged into `main` on 2026-10-09 together with the change above, which
replaced this rework's machine column, its preview chart and the phone's
Machine tab; the rest stands as described here.

- **Tablet and phone layouts (D84).** At 800x500 CSS px and up (every Decent
  tablet): Coach, Shot, History and Settings in the top bar, the machine
  column on the left with a preview of the last shot's graph (tap it for the
  full one), and the coach on the right. Anything smaller gets the phone
  layout: one screen at a time, with Coach, Machine, History and Settings
  tabs at the bottom (a rail at the side when the phone lies down). A phone
  opens CafAI at `http://<tablet-ip>:3000`; it asks for the API key again
  (each browser keeps its own), and the bags and the look come from Decaid.
- **The shot takes the screen (D85, D86).** When a shot starts, the right
  side becomes the Shot view: a big timer, pressure, flow, weight and weight
  flow, the running step, the graph, and the coach's note: "I'm watching
  this shot. I'll read the curves once it's done." After the pour it says
  "Done. Reading the shot", then the coach comes back by itself with the
  shot card. The machine column and Stop never move. On a phone the Machine
  tab opens by itself. Back to the chart at any time: the preview, the Shot
  item (it shows the running time), the phone's live strip on the Coach tab,
  or the newest shot card's Graph button. Go to the coach yourself during a
  shot and it stays there; if you are typing when a shot starts, the coach
  stays and your draft is safe.
- **Typography (D81).** Figtree everywhere, a tighter type scale, numbers
  that keep their width while they count, and calmer tonal buttons.
- **A look of your own (D80, D82).** Settings > Appearance: Dark, Light or
  Auto (follows the device), and a tint: Crema (the brown, still the
  default), Matcha (your green), Cold Brew, Blueberry, Plum, Cherry, Tamper
  (renamed for coffee, D123), or any hue from the slider. Every colour
  comes from one palette, and every pair the screens draw from it is tested
  for WCAG AA contrast at every hue in both modes. The shot graph keeps Decent's colours (pressure green, flow
  blue). The look is saved with your settings (Decaid's copy and the export
  too), and the start screens use it from the first frame.
- **Docs:** [DESIGN.md](DESIGN.md) (the visual system),
  [PRODUCT.md](PRODUCT.md), the spec and mockups in
  `docs/superpowers/specs/`, D80-D89, and section 11 of the hardware plan.

**Fresh-eyes check.** A verifier that had not seen the code drove the built
app at 962x602, 1280x800, 390x844 and 844x390, and on smaller phones. Of its
15 findings, 13 are fixed (D87-D89), each measured in a browser before and
after. The fixes were not driven again by the verifier; they pass the whole
suite above. The ones you would have noticed:

- At 962x602, Stop and the machine column dropped 27 px twice a shot (a
  long step name wrapping). They now hold still at every size, and the
  column fits without scrolling.
- On phones shorter than about 800 px the big graph was half hidden. Under
  660 px the shot now covers the status and start buttons until its
  outcome, so the whole plot and the note show, and Stop does not move.
- The layout froze at any size while you typed, and a closing tablet
  keyboard flashed the phone layout for 100 ms. Now only the height is
  held.
- In light mode, dimmed text (an undone version, the profiles you did not
  pick) and the composer's placeholder fell to 2.3-3.7:1 contrast. Now they
  are 6.4:1 and up.
- Smaller fixes: a white flash before the app started, "this tablet" on a
  phone, a dash instead of "0.0 s" before any shot, and "Hot water" fits on
  one line.

One finding is kept by design and one is left open:

- **Kept:** on a phone, the screen that opens itself ignores taps for 350
  ms, Stop included. Stop was not on screen when the finger started
  moving, so a tap there was aimed at the coach; a tap at 280 ms works. On
  a tablet Stop always works at once. Say if you want Stop exempt on the
  phone too (D88).
- **Open:** stop a shot while it is still preheating and CafAI looks for it
  in Decaid 6 times, with a 404 in the console each time. This is older
  than the rework; section 9 of the hardware plan checks whether Decaid
  saves such a shot.

**Calls I made that you may want to change:**

1. The phone's tap guard covers Stop (above).
2. The phone's Machine tab counts in tenths ("42.0 s") like everything
   else; the spec said whole seconds (D88).
3. On a short phone the shot covers the status and start buttons until its
   outcome (D87).
4. A step name too long for the machine column ends in an ellipsis; the
   Shot view shows it whole (D87).
5. The key notes and errors say "this device" instead of "this tablet", so
   a phone reads right (D89).

**Try it:** `npm run demo`, then Settings > Appearance > Matcha, then back
to Coach and tap Espresso in the top bar: the shot takes the screen, then
the coach comes back with the card. Narrow the browser below 800 px for the
phone layout.

**How it ran:** three stages (palette and theme, appearance, layouts and
shot focus), each task by a subagent and committed after its checks; then
an end-to-end agent added the phone projects (and found two phone bugs);
then the verifier; then three fix agents in parallel on separate files and
a docs agent. The usage limit stopped agents twice; each was resumed where
it stopped.

## Since then: Decaid's simulator and a demo (2026-10-05 and 06)

- **A demo you can open (D76).** `npm run demo` opens
  <http://localhost:5175/?demo=1>. CafAI is already in use there, on the
  built-in mocks: no Decaid, no API key, no tokens.
  - **What's on screen:** Kiambu AA, dialled in over four shots, showing
    every kind of card and notice the coach can show:
    - template cards;
    - "Loading…" and "Loaded" notices;
    - shot cards with graphs, rated in words against the shot before;
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
   `extras.cafai`. An optional rating in words on the shot card (how the
   shot compared with the one before, D126) goes into `enjoyment` as a
   running score. Failed writes are retried (D61). *My reading:* enjoyment
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
- Not built: teaching mode, personas, voice, other providers in the UI,
  device pairing screens beyond Connect, and a screensaver (roadmap). Bag
  photos, Connect, and the steam, hot water and flush settings came with
  the Decaid alignment (above), and the local coach with CafAI Bridge
  (D130-D137).
- Writes waiting for Decaid live in memory only (D64).
- The fresh-eyes check of chat first (its brief is ready). The two layout
  corners the UX check left open went with the machine column.

## Top 5 questions for you

1. **Does Decaid's barrier behave on a real DE1 as its source says?**
   Crediting shots now depends on it (D55); the hardware plan measures it.
2. **Which way is finer on your grinder?** Decaid's library has no
   direction; CafAI assumes lower numbers are finer and preset lists run
   finest first (D62).
3. **Are the new starting yields what you want?** At 18 g: Blooming 50 g
   (Decent ships 60), Londonium 36 (42), the Allongé 90 (135). One number per
   template if not (D57).
4. **Enjoyment only from your rating?** Every answered shot gets notes;
   `enjoyment` only when you say how it compared with the shot before (D61,
   D126).
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
Espresso -> tap a word under "Compared with ...?" and "Sour / sharp" ->
Confirm -> History. `?mockUploadMs=3000` makes the machine load slow
enough to watch.

# Open questions

Ranked by the cost of a wrong guess (most expensive first). Each says what
CafAI assumes now and what would change if the guess is wrong. Question 34,
out of usage analytics of 2026-10-22, comes first: it is your next step.
Questions 1 and 3-8 came out of the morning session of 2026-10-04, 9-13 out
of the Decaid alignment of 2026-10-09, 14-16 out of Claude on your computer
of 2026-10-11, 17 out of your list of 2026-10-11, 18-20 out of the gap
review's four items of 2026-10-15, 22-23 out of the simulator pre-run of
2026-10-16, 24-27 out of fun facts of 2026-10-16, 28-29 out of the drink
scenes of 2026-10-22, 32 out of the screensavers of 2026-10-22, 35 out of
where the coach runs after a Decaid update of 2026-10-23, 36-39 out of the
screensavers' second round of 2026-10-24 and 40-43 out of Settings
regrouped of 2026-10-24 (each ranked the same way, in its own section); the
questions you answered, 33, which round 2 made moot, and 2, 21, 30 and 31,
which Settings regrouped turned into settings, are in "Answered" at the end.

## Your next step: usage analytics (2026-10-22)

34. **Does Microsoft Clarity work inside Decaid and on your tablet, and keep
    to what CafAI promises (D216)?** Nobody has run it there yet: the
    masking and the consent calls CafAI relies on were read in clarity-js,
    never seen on the wire, and whether Clarity counts Decaid's "Decent"
    user agent as a person is unknown. Releases carry no Clarity project
    until the repository variable `CLARITY_PROJECT_ID` is set, so until then
    none shares anything. What it needs, in order: a Clarity project of your
    own (clarity.microsoft.com, a Microsoft account; any site URL will do),
    made as a Website project (Clarity's web tag collects nothing for a
    Mobile app one), with Strict masking set in its settings; a local build
    with its ID, `VITE_CLARITY_PROJECT_ID=<id> npm run release:zip`; that
    zip in the Decaid simulator on Windows and in Chrome on `localhost`,
    checking the items of section 10 of
    `docs/superpowers/specs/2026-10-22-usage-analytics-design.md` (sessions
    and coach events in Clarity's live view, a replay that looks like CafAI,
    one heatmap per `?screen=`, a shot's CPU and upload with Clarity and
    without, nothing about the key or code fields in the uploads, and the
    consent calls); the same zip on the tablet (Skins > + > ZIP file) for a
    day of ordinary use, watching for crashes (an open Clarity issue reports
    Android WebView crashes) and lag on the shot screen; and only then the
    repository variable (Settings > Secrets and variables > Actions >
    Variables), so the next release carries the ID.
    What a wrong guess costs: the variable set without the run puts Clarity
    on every install that updates, where a WebView crash or a lagging shot
    screen would reach every tablet, a hash of the key or of the barista's
    words in an upload would break what the card, the README and SECURITY.md
    promise, and a "Decent" user agent dropped as a bot would leave the
    project empty. If no data arrives, or the tablet suffers, Clarity is
    dropped and sending moves to PostHog or a small counter of CafAI's own,
    in a new decision; if a shot costs too much, Clarity stops while a shot
    runs.
    *So far (2026-10-24):* 0.1.3 carried Clarity, but Clarity collected
    nothing from it. Its project had been made as a Mobile app one, and the
    iPad's WebView log said "Data from this session is not being collected
    by Microsoft Clarity because the provided project id is not a Clarity
    Web project". `CLARITY_PROJECT_ID` now names a Website project, so 0.1.4
    is the first release that can report, and the checks above are still
    to do, on it.

## From the morning session (2026-10-04)

1. **Does Decaid's barrier behave on a real DE1 the way its source says?**
   CafAI now waits for `POST /api/v1/machine/profile` after every load and
   only then says "Loaded" and credits shots (D55). A shot that starts while
   the load is still running is not credited, except within Decaid's 500 ms
   post-upload guard. All of this is read from Decaid's source and tested
   against the mock; nobody has timed it on a machine. If the barrier is
   slow, or answers before the machine really holds the profile, shots are
   refused or mis-credited. The first hardware session measures it
   (docs/HARDWARE_TEST_PLAN.md sections 3 and 4).
3. **v1 now starts at the author's ratio times your dose (D57).** At 18 g
   that is Blooming 50 g (Decent ships 60), D-Flow 50, Londonium 36 (Decent
   ships 42), Rao Allongé 90 (Decent ships 135) and Gentle and Sweet 36. If
   you prefer Decent's shipped stops, it is one number per template
   (`startRatio`). Known edge: Blooming's pour tops out near 57 g at its
   default flow, so at doses of 21 g and up v1 ends on the profile's own
   timer a little short of its target. *Seen since (2026-10-06):* both
   CafAI's mock and Decaid 0.8.7's own simulator end Blooming v1 at 42-48 g
   from 18 g, on the profile's timer, so the 50 g stop never fires there. If
   a real DE1 does the same, the cup's yield is set by the pour's length,
   not the stop, and a yield change does nothing (the scripted coach now
   moves the grinder instead). Hardware plan: note the yield of the first
   Blooming v1 shot.
4. **Enjoyment only from your rating (D61, D126).** CafAI writes the taste
   to Decaid's notes for every answered shot, but `enjoyment` only when you
   say how the shot compared with the one before (Much worse to Much
   better), as a running score: a bag's first rated shot is 5 of 10 and each
   later one moves a step per word from the shot it was compared with. It
   never derives a number from the taste options. If you would rather have
   every shot scored, the choices are a required rating or a mapping from
   the taste (which would invent data).
5. **Should CafAI also check each shot's targets against the version?**
   Decaid's records keep per-step targets (pressure, flow, temperature).
   Comparing them with the version would catch a shot that ran something
   else even when the workflow looked right, but it cannot see exits, step
   times, weights or the yield (D55 option 2). Decide after the hardware
   session's saved shots.
6. **Is 15 s right for the start-up fallback (D58)?** If the bundle has not
   rendered after 15 s, CafAI shows "could not start" with a way back to
   Decaid (it removes itself if the app renders after all). A tablet whose
   cold start takes longer would flash that page.
7. **Writes waiting for Decaid live in memory only (D64).** A reload drops a
   grinder setting or shot notes Decaid has not taken yet. The next profile
   load writes the grinder anyway; a shot's notes and rating stay in CafAI's
   own records but would be missing in Decaid.
8. **A dose changed in Decaid in the middle of a bag** is read again only
   when a bag opens and at a template pick; until then a yield change is
   checked against the dose CafAI read last.

## From the Decaid alignment (2026-10-09)

9. **Can this repository go on GitHub?** It has no remote, so nothing that
   watches Decaid has ever run. Four workflows wait for it (D105):
   `ci.yml` (every push: typecheck with the Decaid contract, lint, tests,
   build, zip, e2e); `decaid-watch.yml` (daily: an issue labelled
   `decaid-drift` when Decaid's newest release or `main` fails one of
   CafAI's checks or removes or retypes something CafAI uses,
   `decaid-watch-blind` when it could not look at every version or its
   changed files, and `decaid-read` when files CafAI depends on changed
   but every check passes); `decaid-live.yml` (daily and before each
   release: Decaid's Linux release headless with a simulated machine and
   scale, CafAI's checks against it, and a browser check); and
   `release.yml` (publishes only after that job, its own checks and e2e
   pass). Until then the same checks run only by hand:
   `npm run decaid:watch`, and `npm run test:decaid` against your Windows
   simulator (docs/SIMULATOR.md section 6); `scripts/decaid-ci.sh` runs
   only on Linux. If it stays local, a Decaid release that breaks
   CafAI is found on a tablet, by a user. What it needs: a repository (a
   private one spends Actions minutes on two daily jobs, each limited to 30
   minutes), the branches pushed, and Actions allowed to open issues and
   publish releases (the watch's issue job and the release job ask for
   that). README's GitHub Release install needs it too.
   *Answered (2026-10-11):* yes. It is public at
   github.com/justinmwarner/CafAI, with `main` and the tag `v0.1.0`
   pushed; CI runs on pull requests, and every version tag on main is a
   release (D138). Scheduled workflows run from `main`, so this branch's
   watch, exit codes and labels start once it is merged.
10. **Which rating scale does your tablet's Decaid use?** CafAI no longer
    assumes 0-10. Once per session, before the first rating goes out, it
    asks Decaid with a made-up shot id (D101): a 400 that mentions
    enjoyment means 0-10 (a running score of 7 goes out as 7), a 404 means
    0-100 (as 70, as Decaid 0.8.6 field builds keep it; D126). That reading
    comes from Decaid's source and decaid-mcp's probe and is tested against
    the mock both ways; no real Decaid has answered it yet. If your tablet
    answers differently, a 7 goes out as 70 to a 0-10 Decaid (refused; the
    chat says so once) or as 7 to a 0-100 one (ten times too low, in Decaid
    and Visualizer). An answer that tells neither leaves the rating waiting
    in memory, so a reload drops it (as in #7). The hardware session checks
    it (docs/HARDWARE_TEST_PLAN.md section 12, step 1).
11. **With the key kept in Decaid, should every browser take it?** When
    Keep my API key in Decaid is on, a browser that opens CafAI without a
    key of its own takes Decaid's copy at start (D99). That is what brings
    the key back after a Decaid update; it also means a phone on your
    network gets the key without pasting it, and so does anyone else who
    opens CafAI from your tablet's address. The note under the switch says
    any device on the network can read Decaid's store, so this exposes
    nothing new, but it makes using your key effortless for anyone on your
    Wi-Fi. If you would rather other browsers ask for the key, that is a
    small change.
12. **Are CafAI's ranges for steam, hot water and flush right?** Decaid's
    spec gives a range only for steam temperature, and Decaid writes these
    values to the DE1 unchecked, so CafAI's clamp is the only one (D114).
    What CafAI chose: every range takes in what Decaid's own screens set
    (its steam, hot water and flush forms at v0.8.8), so nothing you set
    there is refused here, but for a time or the volume at 0, which CafAI
    never writes, and steam above 160 °C (165 on a Bengle). So steam flow
    now goes to 2.5 ml/s and the flush's time to 60 s:

    | Setting | CafAI's range | Step | Decaid's screen | Where CafAI's comes from |
    |---|---|---|---|---|
    | Steam temperature | 135-160 °C (165 on a Bengle) | 1 °C | 135-170 °C | Decaid's spec |
    | Steam time | 1-120 s | 5 s | 0-120 s | CafAI, the same top as Decaid's screen; the DE1 holds up to 255 |
    | Steam flow | 0.1-2.5 ml/s | 0.1 ml/s | 0.4-2.5 ml/s | Its top from Decaid's screen; Decaid's default is 0.8 |
    | Hot water temperature | 1-100 °C | 1 °C | 50-95 °C | CafAI; water boils at 100 |
    | Hot water volume | 1-255 ml | 10 ml | 0-250 ml | The DE1's one byte; streamline stops at 255 too |
    | Hot water time | 1-120 s | 5 s | 0-60 s | CafAI; the DE1 holds up to 255 |
    | Hot water flow | 0.1-15 ml/s | 0.5 ml/s | 1-8 ml/s | CafAI; Decaid's default is 10 |
    | Flush time | 1-60 s | 1 s | 0-60 s | Decaid's screen |
    | Flush temperature | 1-100 °C | 1 °C | 5-95 °C | CafAI |
    | Flush flow | 0.1-15 ml/s | 0.5 ml/s | 1-8 ml/s | CafAI; Decaid's default is 6 |

    Still open: where CafAI's range is wider than Decaid's screen (the hot
    water and flush temperatures, the hot water time and volume, every
    flow), a typo within it reaches the machine; narrowing those to
    Decaid's screens would refuse nothing Decaid lets you set. And steam
    temperature: Decaid's screen goes to 170 °C, its spec to 160 (165 on a
    Bengle). CafAI follows the spec, so a 170 set on Decaid's screen shows
    here and is left alone unless you change it in CafAI. If a DE1 takes
    up to 170 °C, as Decaid's screen suggests, CafAI's ceiling could match
    it. Each range is one line in `src/ui/settings/drinkSettings.ts`.
13. **Should the spec fixes go to Decent?** `docs/upstream/decaid-spec-fixes.md`
    is a draft issue, with a patch outline, listing where Decaid's specs
    disagree with its Dart code at v0.8.8, each with the Dart line. CafAI
    does not send it (spec 4.8). If Decent fixed them, most of
    `contract/decaid/drift.ts` would go, and other skins that generate
    types from the specs would get them right; nothing in CafAI depends on
    it either way. One finding is not in the draft yet: Decaid writes the
    steam and hot water temperatures and times and the hot water volume to
    the DE1 as single bytes, unchecked (`unified_de1.dart:611-630` at
    `aab5f93`), so a skin that sends 300 ml gets 44 ml. Say if you want it
    added.

## From Claude on your computer (2026-10-11)

14. **Which Claude Code should the bridge use on your PC?** It uses the
    newest it finds (D134): today the Claude desktop app's own copy, 2.1.295.
    Your `claude` on PATH is WinGet's 2.1.126, which hangs on every request,
    and the native install in `~/.local/bin` is 2.1.251, which refuses Opus
    5.5 (it needs 2.1.280). If you would rather the bridge used your own
    install, run `claude update` (and `winget uninstall Anthropic.ClaudeCode`
    for the stale one), or start the bridge with `--claude <path>`. Nothing
    was updated or removed for you.
15. **Is this for you only, or will CafAI ship with it?** The bridge is built
    and documented for one person's own use with their own plan (D130):
    Claude Code's terms do not restrict that, but they do bar offering a
    plan's sign-in to other people. If CafAI goes public with the bridge,
    the README's note stays as it is; anything hosted for others would need
    API keys.
16. **Is a Node program on the computer all right, or do you want an app?**
    Today the bridge runs from CafAI's folder (`npm run bridge`, Node 18+),
    with `install` to start it at login. Someone who installs CafAI from a
    release zip has no such folder; a single download or a small app with a
    tray icon is on the roadmap.

## From the owner's list (2026-10-11)

17. **D126's running score.** A bag's first rated shot is 5 of 10 whatever
    the word, and a changed word moves only its own shot's number. If you
    would rather the first shot's word counted (Much worse than Red Brick =
    3), or later shots followed a changed one, each is a small change.

## From the gap review's four items (2026-10-15)

18. **Are the care reminders' intervals right for your machine and
    habits (D184)?** CafAI takes the earlier end of Decent's ranges but
    one: the weekly clean and Rinza after 7 days (once a shot or a steam
    happened since); the intake filter after 14 days for V1 or not sure, 30
    for V2; the group head soak after 28 days, the later end of Decent's
    "every two to four weeks"; the descale by your water (never under 30 ppm,
    a year or 1,500 shots at 30 to 120 ppm or not sure, six months or 800
    shots above 120 ppm). Too early and the stats card's line nags; too
    late and a descale is missed. Each is one number in
    `src/app/care/careRules.ts`.
19. **Should a cleaning cycle CafAI sees count as done (D186)?** When CafAI
    is open while the machine runs its own Clean or Descale (from streamline,
    since CafAI starts none: D161) for at least 60 s, it marks that step
    done, "CafAI saw the machine's Clean". So a Clean stopped after a
    minute counts too. Nobody has timed a real cycle yet
    (`docs/HARDWARE_TEST_PLAN.md` section 19, steps 4 and 5). If you would
    rather always tick it yourself, or want another threshold, say so.
20. **Which shot belongs under a shot's curves (D178)?** The roadmap said
    the bag's previous version's shot; CafAI draws the shot the card's
    question names, your previous shot (on a bag's first, your last shot of
    another coffee), so the card never asks about one shot and draws
    another. After a grind move, which makes no new version, the two
    differ: the previous version's shot can be several shots back.

## From the simulator pre-run (2026-10-16)

22. **Where does a shot begin (D204)?** A run with less than 2 s of pour
    is no shot: no card, no "How did it taste?", and the next shot is
    compared with the one before it. The chat says "That shot stopped before
    it poured: nothing to taste." In the first 2 s of pour the puck is still
    being wetted, so nothing in it says anything about the grind; a shot
    that gushes or chokes shows later than that. If you stop shots early on
    purpose to learn from them, say where the line should be.
23. **Should Retry go after a shot cut off by a disconnect (D205)?** When
    the machine disconnects during a shot, Decaid 0.8.8 saves nothing, so
    the warning's Retry can never find that shot. It stays because a newer
    Decaid may save such a shot; without it the warning would stand alone.

## From fun facts (2026-10-16)

24. **Is "ran like the last one" the right test (D197)?** A kept recipe's
    shot gets a fact when its pour time is within 3 s of the last shot on
    it, its yield within 1.5 g, its peak pressure within 1 bar and its first
    drop within 3 s, with the same stop and no new channeling flag. Too
    tight and a fact rarely comes; too loose and it lands on a shot the
    coach should have talked about. Each is one number in
    `src/coach/facts/likeLast.ts`.
25. **Is "CafAI's and the coach's" the right default (D198)?** It adds the
    coach's facts about your bag, a fraction of a cent each, where it is
    sure of one. "CafAI's facts" alone is free and never wrong, but never
    about your roaster unless it is on the list.
26. **Grow the list further?** The research aimed at about 500 facts; you
    stopped it at 340 checked ones to save usage (D199). 45 more are drafted
    and wait only for their check (34 about Africa, 11 about history and
    milk; milk and cleaning have few facts yet). The brief, the checking
    pass, the drafts and the merge script are kept outside the repo
    (`E:\source\cafai-facts-research`), so another round adds more the same
    way, and the coach covers the rest meanwhile.
27. **Region words that catch a neighbour.** Facts match whole words in the
    bag's origin, so a fact for Cauca also shows for Valle del Cauca, and one
    for Santander for Norte de Santander; the writers left out region names
    that would catch more (bare "San Marcos", "Volcán", "Origin" as a
    roaster). If one shows where it should not, the fix is that fact's
    match words in `src/coach/facts/facts.json`.

## From the drink scenes (2026-10-22)

28. **Rosetta in dark mode (D217, D219).** Its leaves grow behind
    the figures, so in dark mode the figures carry a halo of the crema
    colour to read on the white milk, and the small "of 50 s" line under the
    number still reads worst of any scene. It is offered in both modes, as
    you asked for every scene. If it bothers you on the tablet, either leave
    it out in dark mode (steam then draws Wand and spray there) or lift the
    figures above the leaves in that scene alone.
29. **How warm is warm (D218)?** The scenes and the ring run from cold
    to warm: steam with its time (the milk warming), hot water by the
    temperature set, from 40 °C (cold) to 95 °C (warm), the flush by the
    group from 20 °C under its target (cold) to the target (warm). Each
    range is a number or two in `src/ui/drinks/scenes/sceneInput.ts`; tea
    water at 80 °C draws about three quarters warm.

## From the screensavers (2026-10-22)

32. **"A different one each day" as the default (D225)?** Anyone who
    never opens Settings gets a new one each day, Nightstand among them. If
    one stays your favourite, or a quieter default suits more people,
    Nightstand could be the default instead; a choice made in Settings is
    kept either way.

## From where the coach runs after a Decaid update (2026-10-23)

35. **Keep the bridge's code in Decaid by default (D230)?** CafAI now
    copies where the coach runs (Claude on my computer, the address and the
    code) to Decaid's store, so an iPad's Decaid update no longer clears it
    (D229). The cost: any device on your network can read Decaid's store,
    and with the code it could use your plan through the bridge while the
    bridge runs. That costs the plan's limits, not money, and
    `npm run bridge -- code --new` ends it. The copy is on unless turned off
    (Settings > Where the coach runs > Keep the address and code in Decaid).
    Off until chosen, like the API key's copy, is one word in two places
    (`?? true` in `src/app/createServices.ts` and `CoachSourceSection.tsx`).
    The API key's copy stays off by default (D99), so on an iPad someone on
    an API key pastes it again after every Decaid update unless they turn
    it on; making that one on by default too is your call as well. The real
    fix is Decaid's: `docs/upstream/decaid-skin-origin-ios.md` is a draft
    issue for Decent (D231), to open if you want it.

## From the screensavers, round 2 (2026-10-24)

36. **Do Latte Art's four pours look right on the tablet (D228,
    D250, D271)?** The heart, the tulip, the rosetta and the swan
    were tuned from screenshots on a computer, and all four come round.
    D228 leaves the last word to you, the heart and the tulip first. A pour
    that does not look right comes out in one line (`IN_ROTATION` in
    `src/ui/saver/savers/latteModel.ts`); if the heart and the tulip fail,
    Latte Art does not ship. Section 20 of docs/HARDWARE_TEST_PLAN.md, step
    8, watches a whole round.
37. **Are Espresso Pipes and Beanfield smooth on a Decent tablet (D261,
    D264)?** Both are fine on a computer and the iPad is fast, but a
    Decent tablet's GPU and memory are small. Espresso Pipes holds about
    255,000 triangles at its fullest (60% of the grid, about 40 s in) and
    fills and starts again about 35 times in a half hour, lively like the
    classic. Beanfield keeps up to 22 MB of lit bean sprites and does its
    heaviest work in its first seconds. Rising Steam and Lava Latte render
    their cup and glass pixel by pixel as they start (about 0.5 to 0.7 s in
    the smoke test's Chromium 91 on this PC at 1280x800, so perhaps 1 to 3 s
    on a weak tablet), showing only the page until then. If one stutters or
    starts too slowly, the cheap fixes: Pipes fades at a lower fill or grows
    slower; Beanfield's size caps come down; Rising Steam and Lava Latte
    keep their render across showings.
38. **The new looks, dimmed: anything to change?** Small calls made without
    you, each one line to change: the portafilter logo at a fifth of the
    screen's width; Brew Rain's density, its words (the classics, not your
    own drinks) and its cup that fills over the half hour; Lava Latte's
    band of foam at the top (it may read as a lid); Rising Steam's saucer,
    the second-brightest thing on screen; the pipes' anodised one a neutral
    gunmetal, and espresso cups that do not steam.
39. **Nightstand's date in the tablet's language (D260)?** It follows
    the device's language, as clocks do ("Saturday, October 24"), while the
    rest of CafAI is English; a German tablet would show "Samstag, 24.
    Oktober". Always English is one line.

## From Settings regrouped (2026-10-24)

40. **Every device's spend added together (D238)?** In the form you left
    "every device on this Decaid added together" unticked, but CafAI counts
    the coach's spend that way: each device keeps its own records, copies
    them to Decaid's store, and the card and the budget add every device's.
    Two reasons: the bill is your API key's, whichever tablet or phone spent
    it, so a $5 budget should mean $5 on the bill; and an iPad's Decaid update
    empties CafAI's storage (D231), so a count kept on the device alone would
    start the month at zero after every update. With one device it is the
    same number. If you would rather each device show only its own spend,
    that is a filter in `src/spend/summary.ts` and the card's footnote, and
    the budget would then be per device.
41. **Is Haiku 5.5 good enough to coach (D242)?** It is in the model list at
    $0.10 / $0.50 per million tokens, a fortieth of Opus 5.5's price, but
    nobody has dialled in a bag with it. If its advice is poor, its note in
    the list can say so, or it leaves the list.
42. **Should only the API key count toward the budget (D240)?** Replies
    through CafAI Bridge cost your Claude plan, not money, so they never
    count, warn or pause; the card shows their tokens and what they would
    cost on the API. If you would rather the budget cover what the bridge
    uses too (at API prices), that is one condition in `src/spend/budget.ts`.
43. **Report a problem: a blank issue, or the repository's bug form
    (D248)?** It opens a blank GitHub issue with CafAI's and Decaid's
    versions and where it runs filled in, and a reminder to attach the log.
    The repository's bug form (`bug_report.yml`) could be used instead, its
    fields filled in through the address.

## Answered

1. **Does a shot pulled right after "Confirm" run the new profile?**
   `PUT /api/v1/workflow` returns before Decaid uploads the profile to the
   machine, and there is no success signal (only `profileUploadFailed` on
   `ws/v1/devices`). CafAI shows "Loaded vN on the machine" when the PUT
   succeeds, and credits a shot to a version only when the shot record's
   workflow carries that version's profile (D41). That catches shots run from
   any other profile, but not a shot pulled while the upload is still in
   flight: the record already names the new profile while the DE1 may still
   run the old one. Needs a timing check on a real DE1 or the simulator; the
   fix would be a short "loading" hold or watching for the error.

   A: Is there any way to GET the profile so we can poll and wait until it returns the proper profile? What options do we have here?

   Done (D55): there is no read-back, but `POST /api/v1/machine/profile`
   only answers once the machine has acknowledged the upload, so CafAI waits
   on it after every load ("Loading … on the machine…", then "Loaded"),
   reports a failed or offline load, and does not credit a shot that started
   while loading. The other options and why they lost are in D55. The timing
   on a real DE1 is in docs/HARDWARE_TEST_PLAN.md (sections 3-5).
   Commits: 8ac8860, 947b3e0 (CafAI), 4f0488e (the mock machine).

2. **Is `claude-opus-5-5` the right default model?** The research brief names
   it as the flagship and the build rules (tool_choice auto only) are written
   for it, so it is the default; Opus 5, Sonnet 5, Haiku 4.5 and Fable 5.1 are
   in the picker. If your account lacks Opus 5.5 access, or you would rather
   trade quality for cost, the default changes in one line
   (`src/llm/models.ts`). Not verified against the live API tonight (no key).

   A: The user can select it. I'd also like to have on the roadmap a way to run it from the user's computer too, like the Local Mac verison so that you don't have to use API tokens.

   Done (D56): the default stays and the picker is unchanged. A local coach
   on your own computer is on the roadmap (docs/ROADMAP.md), with what has to
   be checked first. `ANTHROPIC_API_KEY=... npm run test:live` checks the
   default (and, with `LIVE_ALL_MODELS=1`, every picker id) against the real
   API. Commits: 6904582 (roadmap), 60cb646 (live test).
   *Built since (2026-10-11):* the coach can run on your own Claude Code and
   plan, on a Mac or a Windows PC, through CafAI Bridge (D130-D137; README,
   "Claude on your computer").

3. **Are the lever bounds and the starting yields right for your coffee?**
   Bounds come from Decaid's bundled profiles and the research table (e.g.
   brew temperature +/-2 °C per step within 84-94 °C for D-Flow). v1 starts at
   each template's own `target_weight` (Blooming 60 g, D-Flow 50 g, Londonium
   42 g, Rao Allongé 135 g, Gentle and Sweet 36 g), regardless of dose. The
   Allongé is the outlier: Decent ships a 135 g stop while its own notes aim
   for about 1:5 (90 g at an 18 g dose); CafAI keeps Decent's number so v1 is
   the bundled profile. The coffee heuristics in the prompt are an explicitly
   marked placeholder. A barista's review would change numbers, not code.

   A: This is more of an AI / web question, do what is best.

   Done (D57): v1's yield is now each profile author's ratio times the dose
   in Decaid (18 g when there is none), and the chat says where v1 stops and
   why. The Allongé's window is 4-6x the dose and Gentle and Sweet's tops out
   at 3x; every other bound was checked and stays. Open follow-up: question 3
   above. Commits: 2ed3018 (coach), 5098ef5 (engine), fce4821 (docs).

4. **Is the real WebView floor really Chromium 91?** CafAI is verified in a
   real Chromium 91, and Decaid's sources prove older engines exist on some
   tablets but give no floor. If a supported tablet runs something older, the
   build target and polyfills move down.

   A: This is fine, we do not need to worry about browser support. We can add a warning if that is possible.

   Done (D58): the target stays Chromium 91. An older engine gets a
   dismissible warning, and a start that fails shows a page with Exit to
   Decaid and Decaid settings. Decaid's WebView calls itself "Decent", so the
   check probes for Chromium 91 syntax. Checking it on the tablet is
   docs/HARDWARE_TEST_PLAN.md section 1. Commit: 7570b9c.

5. **Should "<Bean> v1" exist as its own entry in Decaid's profile library?**
   Decaid ids hash only the execution content, so an unchanged template *is*
   the bundled default: Decaid keeps its library entry (with the bundled
   title), while the machine shows "<Bean> v1" because the workflow carries
   CafAI's title. Making v1 distinct would mean changing its brewing content,
   which CafAI deliberately does not do.

   A: No preference, do what seems best

   Done (D59): with D57's yields v1 usually differs from the bundled stop, so
   it gets its own entry, recorded under the template's bundled profile as
   its parent. Commits: 2ed3018, 5098ef5.

6. **Storage survival across iOS app updates.** The skin's origin follows its
   install path; if an iOS update moves the container, local storage is gone.
   The KV backup restores bags, versions and iterations, but the API key must
   be re-entered (it is never backed up, by design).

   A: This is fine

   Done (D60): unchanged by design, and now proved end to end:
   `e2e/restore.spec.ts` empties CafAI's browser storage and checks that
   everything but the key comes back from Decaid. Commits: c488772, 6d01656.

7. **Should CafAI write feedback back to Decaid's shot record?** Tonight the
   taste feedback lives in CafAI's iteration log only. Writing
   `annotations.enjoyment` (0-10) and notes to `/shots/{id}` would make it
   visible in Decaid and Visualizer.

   A: Yes, let's do that!

   Done (D61): the taste goes into the shot's notes (your own notes are
   kept) and `extras.cafai`, and an optional rating on the shot card (stars
   until D126, words since) goes into `enjoyment`; failed writes are
   retried. Open follow-up: question 4 above. Commit: 947b3e0.

8. **Grind as a variable.** Grind moves are suggested in dial steps on the
   grinder's own scale, never clamped to a typed range (Crema's lesson). Should
   CafAI learn each grinder's step size (Decaid has a grinders API) instead of
   trusting the model's "1 step finer"? Today a move that names the new
   setting updates Settings and Decaid's context; a relative one does not.

   A: I think we should use what Decaid has available. But in the text sent to the user just let them know.

   Done (D62): Settings links a grinder from Decaid's grinder library; its
   step or list of settings turns a relative move into the new setting and
   checks a named one, and the card says the new setting and that the step
   came from Decaid (or that CafAI does not know it). Open follow-up:
   question 2 above. Commits: 2ed3018, 9605218, 4f0488e, 5098ef5.

9. **Is the bundled Gentle and Sweet the regenerated profile?** Decaid's own
   curation audit once flagged an import of it for stale de1app frames. The
   file CafAI copied has the new format and matches its notes, but nothing
   proves it was regenerated (`docs/verified/03-profiles.md` 9.7). Cheap to
   check on a machine: pull it once and compare the pressure curve with its
   description.

   A: Yes, do this.

   Done (D63): it is byte-identical to Decaid's current file, and unit tests
   pin the regenerated values. The pressure curve cannot tell old from new;
   the 88 °C target in every frame and the profile id can, which is what the
   machine check looks at (docs/HARDWARE_TEST_PLAN.md section 6).
   Commits: 0f1f041, 725940b.

10. **Do Brew Rain's katakana show on the tablet (D227)?** The rain's
    glyphs (コーヒー, エスプレッソ) came from the device's own fonts.

    Moot since round 2 (2026-10-24, D252): the owner found Brew Rain
    "just matrix, nothing coffee related", so it falls as coffee's own
    symbols, drawn as paths, and Latin letters in Figtree; no font of the
    device's is needed.

11. **Which way is finer on your grinder?** Decaid's grinder library has no
    direction, so CafAI assumes lower numbers are finer and that a preset
    list runs finest first (D62). If your grinder is the other way round, the
    change card names a setting on the wrong side (it still says "finer"). The
    fix would be a per-grinder "higher is finer" switch in Settings.

    Answered by a setting (2026-10-24, D241): Settings > Grinder > Finer
    is, Lower numbers (the default) or Higher numbers, kept per grinder; the
    coach's arithmetic, the change card's words and its prompt follow it.

12. **TDS on every card, or behind a setting (D162)?** Every shot card has
    a quiet "TDS · Add" cell, even for a barista with no refractometer. A
    setting would hide it from those who have one until they find it; on a
    tablet it fills an empty column, on a phone it takes a short row.

    Answered by a setting (2026-10-24, D246): Settings > Display > Shot
    cards > Show TDS and extraction, on by default; off hides the cell on
    shot cards and in History, and a TDS already given is kept and read.

13. **Is 30 the right brightness (D224)?** The screensaver dims the
    tablet to 30 on Decaid's 0-100 (or leaves a lower brightness of yours
    alone). Too dim and it reads as off from across the kitchen; too bright
    and it lights the room at night. On Android's automatic brightness,
    which Decaid reads as 100, CafAI cannot see how dim the room has set the
    screen, so at night 30 may even be brighter than it was. The tablet
    session (section 20 of docs/HARDWARE_TEST_PLAN.md) shows it; it is one
    number, `SAVER_BRIGHTNESS` in `src/ui/saver/policy.ts`.

    Now a choice (2026-10-24, D247): Settings > Display > Screensaver >
    Dims the screen to, 10 to 60 %, 30 by default. Whether 30 suits most
    kitchens is still worth a look on the tablet.

14. **Is a minute untouched the right wait (D223)?** With the machine
    asleep, the screensaver comes up after 60 s without a touch, so a tap
    on Sleep does not cover what you were reading. Shorter and it comes up
    while you read; longer and an unattended screen stays bright longer.
    One number too, `SAVER_IDLE_MS`.

    Now a choice (2026-10-24, D247): Settings > Display > Screensaver >
    Starts after, 1 to 15 minutes, a minute by default.

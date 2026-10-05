# Open questions

Ranked by the cost of a wrong guess (most expensive first). Each says what
CafAI assumes now and what would change if the guess is wrong. These came
out of the morning session of 2026-10-04; the questions you answered are in
"Answered" at the end.

1. **Does Decaid's barrier behave on a real DE1 the way its source says?**
   CafAI now waits for `POST /api/v1/machine/profile` after every load and
   only then says "Loaded" and credits shots (D55). A shot that starts while
   the load is still running is not credited, except within Decaid's 500 ms
   post-upload guard. All of this is read from Decaid's source and tested
   against the mock; nobody has timed it on a machine. If the barrier is
   slow, or answers before the machine really holds the profile, shots are
   refused or mis-credited. The first hardware session measures it
   (docs/HARDWARE_TEST_PLAN.md sections 3 and 4).
2. **Which way is finer on your grinder?** Decaid's grinder library has no
   direction, so CafAI assumes lower numbers are finer and that a preset
   list runs finest first (D62). If your grinder is the other way round, the
   change card names a setting on the wrong side (it still says "finer"). The
   fix would be a per-grinder "higher is finer" switch in Settings.
3. **v1 now starts at the author's ratio times your dose (D57).** At 18 g
   that is Blooming 50 g (Decent ships 60), D-Flow 50, Londonium 36 (Decent
   ships 42), Rao Allongé 90 (Decent ships 135) and Gentle and Sweet 36. If
   you prefer Decent's shipped stops, it is one number per template
   (`startRatio`). Known edge: Blooming's pour tops out near 57 g at its
   default flow, so at doses of 21 g and up v1 ends on the profile's own
   timer a little short of its target.
4. **Enjoyment only from your stars (D61).** CafAI writes the taste to
   Decaid's notes for every answered shot, but `enjoyment` only when you tap
   stars on the shot card; it never derives a number from the taste options.
   If you would rather have every shot scored, the choices are a required
   rating or a mapping from the taste (which would invent data).
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
   load writes the grinder anyway; a shot's notes and stars stay in CafAI's
   own records but would be missing in Decaid.
8. **A dose changed in Decaid in the middle of a bag** is read again only
   when a bag opens and at a template pick; until then a yield change is
   checked against the dose CafAI read last.

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
   kept) and `extras.cafai`, and an optional star rating on the shot card
   goes into `enjoyment`; failed writes are retried. Open follow-up: question
   4 above. Commit: 947b3e0.

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

# Open questions

Ranked by the cost of a wrong guess (most expensive first). Each says what
CafAI assumed tonight and what would change if the guess is wrong.

1. **Does a shot pulled right after "Confirm" run the new profile?**
   `PUT /api/v1/workflow` returns before Decaid uploads the profile to the
   machine, and there is no success signal (only `profileUploadFailed` on
   `ws/v1/devices`). CafAI shows "Loaded vN on the machine" when the PUT
   succeeds. If uploads take seconds, a quick shot could run the previous
   version and its data would be credited to the new one. Needs a timing check
   on a real DE1 or the simulator; the fix would be a short "loading" hold or
   watching for the error.

2. **Is `claude-opus-5-5` the right default model?** The research brief names
   it as the flagship and the build rules (tool_choice auto only) are written
   for it, so it is the default; Opus 5, Sonnet 5, Haiku 4.5 and Fable 5.1 are
   in the picker. If your account lacks Opus 5.5 access, or you would rather
   trade quality for cost, the default changes in one line
   (`src/llm/models.ts`). Not verified against the live API tonight (no key).

3. **Are the lever bounds and the starting yields right for your coffee?**
   Bounds come from Decaid's bundled profiles and the research table (e.g.
   brew temperature +/-2 °C per step within 84-94 °C for D-Flow). v1 starts at
   each template's own `target_weight` (Blooming 60 g, D-Flow 50 g, Londonium
   42 g), regardless of dose. The coffee heuristics in the prompt are an
   explicitly marked placeholder. A barista's review would change numbers,
   not code.

4. **Is the real WebView floor really Chromium 91?** CafAI is verified in a
   real Chromium 91, and Decaid's sources prove older engines exist on some
   tablets but give no floor. If a supported tablet runs something older, the
   build target and polyfills move down.

5. **Should "<Bean> v1" exist as its own entry in Decaid's profile library?**
   Decaid ids hash only the execution content, so an unchanged template *is*
   the bundled default: Decaid keeps its library entry (with the bundled
   title), while the machine shows "<Bean> v1" because the workflow carries
   CafAI's title. Making v1 distinct would mean changing its brewing content,
   which CafAI deliberately does not do.

6. **Storage survival across iOS app updates.** The skin's origin follows its
   install path; if an iOS update moves the container, local storage is gone.
   The KV backup restores bags, versions and iterations, but the API key must
   be re-entered (it is never backed up, by design).

7. **Should CafAI write feedback back to Decaid's shot record?** Tonight the
   taste feedback lives in CafAI's iteration log only. Writing
   `annotations.enjoyment` (0-10) and notes to `/shots/{id}` would make it
   visible in Decaid and Visualizer.

8. **Grind as a variable.** Grind moves are suggested in dial steps on the
   grinder's own scale, never clamped to a typed range (Crema's lesson). Should
   CafAI learn each grinder's step size (Decaid has a grinders API) instead of
   trusting the model's "1 step finer"?

# CafAI decisions log

Assumptions and decisions made during the unattended overnight build, newest
last within each section. Each entry says what was decided, why, and where the
evidence lives. "Repo wins" means a cloned source contradicted
`docs/RESEARCH.md` and the source was followed (see `docs/VERIFIED.md`).

## Process

- **D1. Commits use command-line git, not the interactive commit widget.** The
  editor's commit-proposal tool needs a human to approve each commit. The run
  is unattended and the brief says "never stop to ask" and "small commits", so
  commits are made with `git commit` on a fresh local repo that no other
  session touches. Nothing is pushed anywhere.
- **D2. Reference clones live outside the repo.** `crema/` and `.ref/*` are
  read-only research inputs and are git-ignored. Commit hashes are recorded in
  `docs/VERIFIED.md`.

## Stack and tooling

- **D3. MUI 9.4.0 + `@mui/x-chat` 9.0.0-alpha.18, pinned exactly.** MUI
  officially supports Chrome 117+, below which Decaid's oldest tablets sit
  (Chromium 91). Verified empirically instead of assumed: a probe app (MUI
  components, ChatBox with streaming send/reply, uPlot, idb, zod) was built
  with `target: chrome91` and loaded in a real Chromium 91.0.4469.0 (puppeteer
  9) with zero errors and a correct layout. So x-chat is used, behind our own
  `ChatSurface` wrapper; the core-MUI fallback was not needed. The smoke test
  lives in `tools/chrome91/` and runs in CI (informational job).
- **D4. Polyfills are usage-based.** `@vitejs/plugin-legacy` with
  `modernPolyfills: true` and `renderLegacyChunks: false` adds only the core-js
  polyfills the final bundle needs (e.g. `Array.prototype.at`). APIs core-js
  cannot polyfill (`crypto.randomUUID`, `AbortSignal.timeout/any`,
  `throwIfAborted`, static `Response.json`, async-iterating a `ReadableStream`)
  are banned by ESLint rules in `eslint.config.js`.
- **D5. TypeScript 5.9.3, not 6.x/7.x.** typescript-eslint 8.71 supports
  `<6.1.0` and openapi-typescript 7 needs `^5`. TS 5.9 is the newest version
  every tool accepts.
- **D6. MSW 2.15.0, not 3.x.** The v2 API (`http`, `HttpResponse`, `ws`,
  `setupWorker`, `setupServer`) is well known and stable; v3 was released
  recently and would add risk to an unattended run for no gain.
- **D7. `idb` instead of Dexie.** A 1 KB promise wrapper is enough for a
  handful of object stores behind repository interfaces, and keeps the bundle
  small on slow tablets.
- **D8. Vitest runs logic tests in Node; UI tests opt into jsdom** with a
  `// @vitest-environment jsdom` docblock (jsdom start-up is slow).
- **D9. Playwright viewports: 962x602 (DPR 1.33), 1280x800, 1920x1200.** The
  brief says "1280x800 minimum", but Decaid's own simulated devices show the
  real CSS viewports of Decent tablets are 962x602, 1007x602 and 1140x712
  (repo wins; `docs/verified/01-platform.md` section 10). A 1280x800 panel at
  DPR 1.33 *is* 962x602 CSS px, so CafAI is laid out for 962x602 and up.
- **D10. One production bundle, no lazy chunks.** Decaid replaces skin files
  in place on update while the page runs, so a lazily loaded hashed chunk can
  404. `scripts/release-zip.mjs` fails the release if any chunk other than the
  entry and the polyfills appears.

## Platform

- **D11. Manifest: `skin-manifest.json` (and an identical `manifest.json`).**
  Decaid reads `skin-manifest.json` first and falls back to `manifest.json`; it
  reads only `id`, `name`, `description`, `version`, all JSON strings (a
  numeric version silently hides the skin). The identical `manifest.json` is
  for older Decaid builds; it is ignored when `skin-manifest.json` exists. The
  id is `cafai` forever (it fixes the install folder, port, origin and so the
  saved data). Source of truth: `skin.config.json`.
- **D12. Exit control.** "Always a way back to the skin switcher": a
  persistent Exit button calls `window.decentApp.exitToDashboard()` when
  `window.__DECENT_HOST__` exists (the dashboard has the Skins page). In a
  plain browser it opens Decaid's settings UI, whose Web Interface section
  switches skins. In-skin skin switching is not implemented: it strands the
  page on a dead port.
- **D13. Settings link** is
  `http://${location.hostname}:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI`
  as a full-page navigation (only `localhost:8080/api/v1/plugins/*` opens in
  place inside the app).
- **D14. API host:** `localStorage.reaHostname || location.hostname`, port
  8080, `ws://` for sockets (the streamline-js / MSL convention). No custom
  request headers on Decaid calls (CORS allow-list).
- **D15. Heartbeat:** `POST /api/v1/machine/heartbeat` on real input
  (pointerdown/keydown), throttled client-side to one call per 15 s (Decaid
  throttles at 5 s in code, the docs say 30 s).
- **D16. KV mirror namespace is `cafai`.** Never write DYE2's
  `dye2.reaplugin` keys; never write the API key, prompts or tokens to KV or
  to `console.*` (both are readable over the LAN).

## Profiles and coaching

- **D17. Profiles are sent with JSON numbers** (repo wins: GET returns numbers;
  only `version` "2" and enums are strings). Template JSON (strings, a de1app
  holdover) is parsed to numbers once at load.
- **D18. Always send the complete ten-key profile** (`version, title, notes,
  author, beverage_type, steps, target_volume, target_weight,
  target_volume_count_start, tank_temperature`). This covers Crema's "four
  required fields" fix (repo: only `tank_temperature` and
  `target_volume_count_start` are actually required, plus title and steps) and
  stops `PUT /workflow`'s deep merge from inheriting stale keys.
- **D19. Yield writes two places.** Stop-at-weight reads the workflow's
  `context.targetYield`, not the profile's `target_weight` (repo wins). The
  yield lever sets both, in the same `PUT /api/v1/workflow`.
- **D20. Templates: Blooming Espresso, D-Flow / default, Londonium, Rao
  Allongé, Gentle and Sweet** (copied byte-for-byte from Decaid's bundled
  profiles; Decent's Streamline skin offers the last two as default
  favourites). Five, so the coach can show the brief's "2 to 5". Adaptive was
  rejected (20 steps, 18 coupled scan steps, `target_weight` 0), as were
  Blooming Allongé (repeats Blooming's bloom), Extractamundo Dos (a third
  light-roast template whose stored 6.0000000000000036 bar a lever could never
  write back) and Classic Italian (flat 9 bar). Lever bounds come from
  `docs/verified/03-profiles.md` section 9; every yield lever needs a
  connected scale, since stop-at-weight does.
- **D21. v1 deduplicates to Decaid's bundled default.** Decaid's profile id is
  a hash of execution content only (title excluded), so "<Bean> v1" with every
  lever at its template value *is* the bundled default: `POST /profiles`
  returns the existing record. CafAI keeps its own per-bag version history in
  IndexedDB, treats Decaid ids as opaque pointers, and activates by PUTting
  the full profile (with the "<Bean> v1" title) to the workflow.
  *Superseded by D59 for most v1s: with D57's yields, v1's content usually
  differs from the bundled default and gets its own library entry.*
- **D22. The template tap is v1's confirmation.** Picking a template card is
  an explicit tap that creates and uploads v1; every later change (v2+) shows
  a plain-language diff and needs a separate Confirm tap.

## LLM

- **D23. A thin fetch + SSE client, not the Anthropic SDK.** The research
  found the SDK's entry pulls Node modules into browser bundles, and the
  client must run on Chromium 91 (no async-iterable streams). The client
  sends `x-api-key`, `anthropic-version: 2023-06-01` and
  `anthropic-dangerous-direct-browser-access: true`.
- **D24. Default model `claude-opus-5-5`** (named in the research brief as the
  current flagship), with Opus 5, Sonnet 5, Haiku 4.5 and Fable 5.1 in the
  picker. RESEARCH lists "Sonnet 5.5"; the current model list has
  `claude-sonnet-5` and no 5.5 (verified against the API reference, repo
  wins). Opus 5.5 rejects forced tool use, so every request uses
  `tool_choice: auto` with `strict: true` tools, and every tool input is
  validated with zod before use.
- **D25. Conversations are append-only.** Assistant turns are stored exactly
  as returned (thinking blocks and signatures included) and replayed
  unchanged; current Claude models reject edited history.

- **D27. Tool inputs that are not valid JSON are stored as `{}`.** The API
  requires an object when an assistant turn is replayed, so storing the raw
  string would poison every later request of an append-only conversation. The
  raw text travels beside the block and the model gets an `INVALID_JSON` error
  result instead.
- **D28. After a refusal fallback** (Opus 5 / Fable 5.1 only), blocks before
  the last `fallback` block are dropped except text, as the API requires when
  such a turn is echoed back; every other turn is replayed byte-for-byte.
- **D29. No OpenAI provider tonight.** Crema's OpenAI path is a single
  non-streaming call without tools; a streaming tool-calling port would be new,
  unverifiable code. The `LlmProvider` interface leaves the seam.
- **D30. Effort `medium` by default.** Opus 5.5's own default; a chat coach
  values latency, and the levers are bounded anyway.

## Coach engine

- **D31. One conversation per bag, append-only.** The engine never edits or
  drops earlier turns; pending choices are rebuilt from the stored transcript
  after a reload (auto tools re-run, UI tools re-shown).
- **D32. Invalid proposals go back to the model, never to the user.** Schema
  and bounds failures are answered as `is_error` tool results inside the same
  run so the model can correct itself; nothing out of bounds is ever clamped
  or shown.
- **D33. Shots come from Decaid's record, not the WebSocket.** When
  `shotState` says a shot finished, the engine fetches `/shots/{id}` (retrying
  while Decaid saves it) and summarizes that; WebSocket frames only drive the
  live graph.
- **D34. "Lock it in" is a change too.** `variable: "none"` shows a card and
  is confirmed like any other proposal; its iteration outcome is `kept`.
- **D35. v1's yield is the template's `target_weight`.** Blooming 60 g,
  D-Flow 50 g, Londonium 42 g, Rao Allongé 135 g, Gentle and Sweet 36 g,
  written to `context.targetYield` so the shot stops there. Changing it is a
  lever like any other. The yield hard bound is 120 g or the template's own
  `target_weight`, whichever is larger, so the Allongé's own default passes.
  *v1's yield: superseded by D57 (the dose decides it). The hard bound stands.*
- **D41. A shot counts only for the version the machine ran.** Every
  activation tags the workflow context with
  `extras.cafai = {versionId, bagId}` (Decaid merges `extras` key by key and
  shot records keep the workflow). A finished shot counts for the active
  version only if its record's tag, when present, names that version and its
  profile has the same brewing content (Decaid's content id) or, with a
  matching tag, the same title. A title alone never counts: two bags can
  share a name, and two bags' v1 from one template share content. Otherwise
  the chat says the shot ran something else, no feedback is asked, and
  nothing is logged against the version. Another skin, a profile picked on
  the machine, or a failed load would otherwise put the wrong shot into the
  bag's history.
- **D42. Switching bags loads that bag's version.** Selecting a bag reads
  `GET /workflow` and, unless the workflow carries that version with the
  same title and the same content, PUTs the bag's active version. (Content
  alone is not enough: two bags' v1 from one template are identical, and the
  other bag's title and coffee details would stay on the machine.) A failed load stays on the error banner with Retry until a
  later upload succeeds. "Loaded on the machine" is said only while the
  machine is connected; otherwise the chat says Decaid loads it on connect.
  At start-up CafAI only reports a mismatch (the same banner, with Retry):
  opening the skin never changes the machine by itself.
- **D43. A failed confirm is not a decline.** When the upload or activation
  of a confirmed change fails, the change card stays pending with the error
  and Retry repeats the same activation. The model hears only the outcome
  the user finally gets.
- **D44. Typing past a card closes it.** Pending UI calls are answered
  `{"answered":false}` (ENGINE_PROTOCOL rule 7) and their cards show as set
  aside, so a stale tap cannot fire later. A typed reply while a taste
  question is open is logged as that iteration's feedback.
- **D45. Each activation rewrites the workflow context.** Decaid merges
  `context` per field and clears a field on explicit `null` (all but
  `targetYield`; `docs/verified/02-api.md` section on PUT /workflow). CafAI
  sends the bag's coffee and grinder fields and `null` for the ones it does
  not know (`grinderId`, `beanBatchId`, a missing roaster or setting), so the
  previous bag's grinder or batch never lands on this bag's shots.
  *`grinderId`: superseded in part by D62 (a grinder linked from Decaid's
  library is sent; `null` only when none is linked).*
- **D46. "New bag" reuses an untouched bag.** While the current bag has no
  saved details and no versions, New bag reopens it instead of leaving a
  trail of empty bags.
- **D47. An iteration nobody answered is `superseded`.** When the next shot
  lands before the taste feedback, the older iteration is closed as
  superseded (not kept or declined), and history says so.
- **D51. Decaid's "profile upload failed" counts.** A `profileUploadFailed`
  device report that arrives while CafAI runs marks the active version as
  not loaded: a warning in the chat, the banner with Retry, and no shot
  credited to that version until a load succeeds. A report from before CafAI
  started is ignored. (A slow upload that never fails stays QUESTIONS #1.)
  *The slow upload is handled by D55.*
- **D52. Some problems stand until they are solved.** The machine running
  something other than the bag's version, and a finished shot Decaid has not
  saved, come back on the banner after other errors and chat turns, each
  with its own Retry. Dismissing, switching bags or the fix itself clears
  them. *Since 2026-10-04 the banner follows the standing problem at once:
  when one is solved or replaced, the banner clears or changes immediately
  instead of at the next coach reply.*
- **D53. No bag switching while a shot is pulled.** The bag picker and New
  bag are disabled during a shot (the engine refuses too): the shot belongs
  to the bag on screen, and a refused load mid-shot used to lose it.
- **D54. The grinder travels with every shot.** Each shot event carries the
  grinder as last saved (Settings or a confirmed grind move), which
  supersedes the intake one; saving a changed grinder writes it to Decaid's
  context (best effort). A grind "move" to the setting already on the dial
  goes back to the model as an error.

## Storage

- **D36. The KV backup is paged and guarded.** Lists over 256 KiB split into
  `bags.1`, `versions.1`... so no value nears Decaid's 1 MiB limit; a store
  that started empty merges the backup before its first push and never pushes
  while Decaid cannot be read, so one failed read cannot wipe the backup.
  Restored summaries come back with an empty series (the 1 Hz curves are not
  mirrored; the coach re-reads them from Decaid when needed).
- **D37. A pasted key is redacted.** Anything shaped like an Anthropic key
  (`sk-ant-` and key characters, whole or in part) is taken out of a chat
  message before the coach, the transcript or Decaid see it (with a notice),
  never becomes a bag name, roaster or note, and is replaced with
  `[redacted]` in mirrored or exported text, as is the stored key itself.
  *Since 2026-10-04 the typed "Other" answer to a question is redacted the
  same way: it reaches the coach and, under D61, Decaid's shot notes.*

## Build and verification

- **D38. x-chat's lazy `remend` import is aliased to its own stub.** x-chat
  repairs half-streamed markdown with a lazily imported package; CafAI renders
  model text with its own safe renderer, so `#remend` points at x-chat's
  "unavailable" stub and rolldown's `codeSplitting: false` keeps the bundle to
  one entry chunk (Decaid updates skin files in place under a running page).
- **D39. Mock builds polyfill `crypto.randomUUID`.** MSW's service worker
  names requests with it and Chromium 91 lacks it, so without the polyfill
  every mocked call fell through to the network in the old engine. Only the
  mock worker and mock page runtime get it; shipped code never calls it
  (ESLint bans it).
- **D40. Chromium 91 is verified by running, not by reading.** The full coach
  loop runs in a real HeadlessChrome 91.0.4469.0 (`tools/chrome91/loop.mjs`)
  with zero page or console errors, and CI repeats it.
- **D48. The chat follows the newest message itself** (`src/ui/chat/followNewest.ts`).
  x-chat's auto-scroll follows new messages but not a card that grows after
  streaming, which left confirm buttons below the fold. CafAI turns it off
  and keeps the newest message in view: its end, or its start when it is
  taller than the view (template cards are listed best first; at 962x602
  three of them do not fit). Only the reader scrolling up stops following;
  CafAI's own scrolls are recognized by position, because their scroll event
  can arrive after more content rendered (which once left the taste chips
  below the fold after a shot). Sending or tapping a card resumes following,
  and the view re-follows when it shrinks (a banner appears above the chat).
  A change card shows what changes, then Confirm / Not now, then Why /
  Expect, so even a card at the coach's length limits keeps Confirm in view.
  `e2e/chat-scroll.spec.ts` checks each prompt is inside the chat viewport at
  all three sizes.
  *Amended by D127: the card's last line reads "What it changes:", no
  longer "Expect:".*
- **D49. The skin zip carries LICENSE, NOTICE and the font licence.** The
  zip is the distributed object code, so the GPL text and the credits travel
  with it, and the bundled Roboto files bring their SIL OFL 1.1 text
  (`LICENSE-ROBOTO.txt`); the release script refuses a zip without them.
- **D50. The resolved build target is asserted.** plugin-legacy re-derives
  `build.target` from `modernTargets` (and warns that it overrode it); a build
  plugin fails the build unless the result is `chrome91`.

## Licensing

- **D26. CafAI is GPL-3.0-only.** Crema says "GPLv3" without an "or later"
  grant, so code derived from it can only be distributed under GPL-3.0.
  Ported files carry `SPDX-License-Identifier: GPL-3.0-only`, a line naming the
  Crema origin and copyright holder, and a "Modified for CafAI" line. Crema
  and its MimojaCafe lineage are credited in README and NOTICE.

## Crema conflicts

Where Crema's approach conflicts with the build rules, the rules win. The full
list with code pointers is `docs/CREMA_PORT_PLAN.md` section 9 (C1-C31); the
resolutions adopted:

- C1 licence: GPL-3.0-only (D26).
- C2-C5 free-form AI profiles, silent clamping, plausibility-only bounds,
  switching to any profile by title: replaced by template levers with hard
  bounds and per-iteration max deltas; invalid proposals are rejected back to
  the model as `is_error` tool results, never clamped silently.
- C6-C11 free-text JSON, no streaming, five providers, no retries/timeouts,
  no system prompt, hard-coded haiku default: strict tools + zod, streaming
  SSE, Anthropic only in the UI behind `LlmProvider`, retries with backoff,
  a stable cached system prompt, models in `src/llm/models.ts`.
- C12-C15 KV as primary store, mirror never written, key stored with
  settings, `crema` namespace: IndexedDB primary, mirror on every committed
  change, the key in a separate local-only secret store, `cafai` namespace.
- C16-C18 chrome78 target, no routing, normalised profile values: chrome91,
  hash routing, profiles built by patching the parsed template only at lever
  paths.
- C19 undo with explicit nulls (Decaid now rejects null `targetYield`): undo
  re-activates the previous version's full profile and its yield.
- C20-C21 four required fields, title-in-hash assumption: D18, D21.
- C22-C25 no heartbeat, exit hidden on focus screens, full re-render per
  sample, no silent-socket watchdog: D15, D12, an external telemetry store
  with selector subscriptions plus imperative uPlot updates, per-socket
  liveness handling.
- C26 shots captured on the client clock: canonical shot data comes from
  Decaid's `/api/v1/shots`; WebSocket frames are only for the live graph.
- C27-C28 prompt claiming web search, "seconds from first drop" mislabel: the
  prompt claims only attached tools; t = 0 is shot start and first drop is
  computed separately.
- C29-C31 fonts/layout, gateway override, tooling: Roboto via Fontsource,
  D9, D14, Vitest + Playwright + fflate release script.

## The owner's answers (QUESTIONS.md, 2026-10-04)

Each answer is an owner decision; it overrides the overnight goal and any
earlier entry. Where an answer was open to more than one reading, the entry
says which reading was taken and MORNING.md lists it among the top questions.

- **D55. A version is "on the machine" only once Decaid confirms the upload
  (QUESTIONS #1).** The owner asked whether CafAI can GET the loaded profile
  and poll until it is right, and what the options are. There is no
  read-back: no REST route returns the profile the DE1 holds, Decaid treats
  the DE1's profile header and frame characteristics as write-only, and its
  upload cache is internal (`.ref/decaid`: `de1handler.dart`,
  `unified_de1_transport.dart:609-611`, `unified_de1.dart:452-473`). The
  options, best first:
  1. **`POST /api/v1/machine/profile` with the same full profile (chosen).**
     Decaid runs it through the DE1 write queue the workflow sync uses and
     answers 200 only after every write is acknowledged plus a 500 ms guard;
     when the machine already holds an equal profile it answers at once
     (`de1handler.dart:859-877`). CafAI calls it right after every workflow
     PUT, as a barrier.
  2. Fingerprint the shot afterwards: the recorded per-frame targets
     (pressure, flow, temperature) can be compared with the version's
     steps. It cannot see exits, step times, weights, the yield, or changes
     under 0.5 °C, so it is a check to try on a real machine first
     (docs/HARDWARE_TEST_PLAN.md), not a rule.
  3. A fixed "loading" pause: a guess about Bluetooth timing. Rejected.
  4. Watching `ws/v1/logs` for upload lines: not a contract. Rejected.

  Behaviour: "Loading vN on the machine…" while the barrier runs, "Loaded"
  only after it answers. With no machine CafAI says Decaid loads it on
  connect, and runs the barrier again when the machine connects (it only
  waits for Decaid's own upload; D42 holds). A failed barrier keeps the
  version active with the load banner and Retry, as D51. A shot that started
  while the version was still loading, or after its load failed, is not
  credited, with one allowance: Decaid answers the barrier only after its own
  500 ms post-upload guard, and queues CafAI's espresso start behind the
  upload, so a shot seen starting within 500 ms before the answer counts. An
  older Decaid without the route (404/405) keeps the overnight wording, and
  CafAI stops asking for that session. The upload's real duration and the
  group-head latch are measured on a real DE1 (docs/HARDWARE_TEST_PLAN.md).
- **D56. The default model stays `claude-opus-5-5`; the user picks another
  in Settings (QUESTIONS #2).** Nothing changes in the picker. A coach that
  runs on the user's own computer, like Crema's Mac server, so it uses a
  Claude subscription instead of API tokens, is on the roadmap with what has
  to be checked first (docs/ROADMAP.md). `npm run test:live` now checks the
  default and the picker ids against the real API when a key is set (D68).
- **D57. v1's yield follows the dose (QUESTIONS #3).** The owner left it to
  "what is best". v1 starts at each profile author's own ratio times the
  dose Decaid has: Blooming Espresso and D-Flow 1:2.8, Londonium and Gentle
  and Sweet 1:2, Rao Allongé 1:5 (at 18 g: 50, 50, 36, 36 and 90 g). A dose
  outside 12-25 g counts as unknown and the 18 g reference is used (Decent's
  stock basket and Decaid's default); the yield lever's dose window ignores
  such a dose too. The Allongé's ratio window is 4.0-6.0 (was 4.0-7.5) and
  its text no longer promises a 135 g stop; Gentle and Sweet's ratio maximum
  is 3.0 (was 2.5); Blooming's description says where its pour tops out.
  Every other bound was checked against the authors' notes and Decent's
  guides and stays. The table and sources: docs/briefs/coach-tuning.md.
  Supersedes D35 for v1's yield.
- **D58. The browser floor stays; CafAI warns on an older engine
  (QUESTIONS #4).** The build target stays chrome91 (D50). An inline ES5
  script in `index.html` checks the engine: below Chromium 91 the app shows
  a dismissible warning, and if the app never starts it shows a plain page
  with Exit to Decaid and Decaid settings. Decaid sets the WebView's user
  agent to the literal "Decent", so the check cannot read a version there:
  it probes for private brand checks (`#x in obj`), syntax that shipped in
  Chromium 91, and uses a version from the user agent only where one exists
  (a desktop browser) and only for the message. An engine it cannot judge
  gets no warning. The start-up fallback appears at once when the bundle
  fails to parse or to load, and otherwise after 15 s without a first render
  (generous on purpose: nobody has timed a cold start on a Decent tablet); it
  removes itself if the app renders after all. One `console.info` line
  records the verdict for Decaid's saved WebView log. In the desktop
  Chromium 91.0.4469.0 the check reports supported, also with the "Decent"
  user agent.
- **D59. v1 gets its own Decaid library entry whenever its content differs
  (QUESTIONS #5).** The owner has no preference. Under D57, v1's
  `target_weight` usually differs from the bundled stop, so Decaid keeps
  "<Bean> v1" as a profile of its own (always for Blooming, Londonium and the
  Allongé; D-Flow and Gentle and Sweet at exactly 18 g still equal the
  bundled default and reuse its entry). CafAI still treats Decaid ids as
  opaque pointers and keeps its own history. Supersedes D21 for those v1s.
- **D60. Storage across iOS app updates stays as designed (QUESTIONS #6).**
  The KV backup restores bags, versions, iterations and conversations; the
  API key is entered again. An end-to-end test now proves the restore in the
  built app (D67).
- **D61. Taste feedback goes to Decaid's shot record (QUESTIONS #7).** When
  the taste question is answered, CafAI writes `annotations.espressoNotes`
  (one short line: the taste, the version, "CafAI") and
  `annotations.extras.cafai` (bag, version, the options and any typed text)
  with `PUT /api/v1/shots/{id}`. Decaid merges `extras` per key but replaces
  the notes string, so CafAI never overwrites notes a person wrote: it
  appends its line instead. Interpretation: `enjoyment` (0-10) is written
  only when the user rates the shot (an optional five-star row on the shot
  card; stars x 2). It is never derived from the taste options, which are
  free text from the model: a derived number would put invented data into
  Decaid and Visualizer. Failed writes are retried (D64).
  *Amended by D126: the rating is a word against the shot before (Much
  worse to Much better), not stars; `enjoyment` gets a running score from
  it, no longer stars x 2, and the verdict and what it was compared with go
  to `extras.cafai` too.*
- **D62. Grind moves use Decaid's grinder library (QUESTIONS #8).** Settings
  lists Decaid's grinders and links the one the user picks (`grinderId`,
  sent in the workflow context). With its small step (numeric) or its list
  of settings (preset), CafAI turns a relative move into the new setting and
  checks that a setting the coach names is on the grinder's own grid. The
  change card says the new setting and that the step came from Decaid;
  without step data it says CafAI does not know the step and asks the user to
  note the new setting. Interpretation: Decaid has no "which way is finer",
  so CafAI assumes lower numbers are finer and preset lists run finest first.
  Supersedes D45's `grinderId: null` for a linked grinder. A linked grinder
  that Decaid no longer lists stays linked and says so (directions only). A
  backup or import brings a grinder link back only when this device names no
  grinder, so a typed name is never paired with another grinder's link.
- **D63. The bundled Gentle and Sweet is the regenerated profile
  (QUESTIONS #9).** It is byte-identical to Decaid a45961b's file. The stale
  de1app import differed in exactly three step temperatures (78.5, 78.5 and
  67 °C instead of 88) and `target_volume` 0; its pressure and flow frames
  were the same, so comparing pressure curves cannot tell them apart. Unit
  tests pin the regenerated values. On a machine the check is the 88 °C
  target in every frame and the default's id `profile:1baa29bd9d9dc6d47f2a`
  (docs/HARDWARE_TEST_PLAN.md).

## Morning session (2026-10-04)

- **D64. Failed Decaid writes are retried.** A grinder setting (from a
  confirmed grind move or Settings) or a shot annotation that Decaid did not
  take is kept, latest first, and sent again when Decaid is reachable again,
  every 30 s while anything waits, and before the next shot is handled; a
  profile load that carries the grinder satisfies it too. Kept in memory
  only: a reload drops what waits (the next profile load writes the grinder
  anyway).
- **D65. Looking for a lost shot shows progress.** After a miss, the chat
  shows "Looking for that shot in Decaid…" with a progress bar until the
  shot card or the warning replaces it; the same on Retry. Progress notices
  are never stored in the conversation.
- **D66. The machine panel names the loaded profile.** It shows the title of
  the profile in Decaid's workflow, read on start, after CafAI changes it,
  after each shot, on connect and every 30 s (Decaid has no workflow
  stream), marked as this bag's only when CafAI's tag and title match.
- **D67. The mock keeps its store across a reload, on request.** With
  `?mockPersist=1` the mock Decaid saves its key-value store, shots,
  workflow and CafAI's profiles and restores them on the next load, so an
  end-to-end test can empty CafAI's IndexedDB and prove the restore from
  Decaid's backup.
- **D68. The live API test is opt-in.** `npm run test:live` runs CafAI's own
  client, prompt and tools against the real API with the key from
  `ANTHROPIC_API_KEY`, and is skipped when the variable is unset. `npm test`
  never runs it, even with the variable set. The key is never logged or
  written anywhere.

## Fixes from the morning's fresh-eyes pass (2026-10-04)

- **D69. A key never becomes a setting.** The verifier pasted the API key
  into Settings' grinder fields, and it travelled to Decaid's workflow, every
  later shot record (shared with Visualizer) and the coach. Settings
  normalization now takes key-shaped text out of the grinder name, the
  grinder setting, the model and the grinder link, on every read and write
  (so an older record is cleaned when read), and the screen says when it did,
  as the chat does (D37).
- **D70. CafAI notices another profile within 30 s.** Every 30 s while the
  page is visible and nothing else is going on, and when it comes back into
  view, the engine repeats its start-up look at Decaid's workflow: report
  only, it never loads anything (D42). A mismatch goes on the banner with
  Retry once per profile: a dismissed one stays dismissed (D52), a different
  profile is raised again. The Profile line reads the workflow on the same
  beat, so the two change together.
- **D71. The coach hears whether the machine confirmed a load.** In the
  template-picked and applied-change results, `onMachine` is true once the
  machine holds the version, false only while the machine is not connected,
  and null when the load failed or a connected machine has not confirmed it;
  `loadError` carries the reason (ENGINE_PROTOCOL rules 2 and 5). Before,
  a failed confirmation read as "the machine is not connected" and the coach
  told the user to wait instead of tapping Retry.
- **D72. "This bag" only once the machine has the version.** The Profile line
  says "loading…" while CafAI waits for the machine, "not confirmed" (warning
  colour) after a failed load, and marks the bag's version only when the load
  is confirmed (or assumed on an older Decaid, or after a reload, while the
  machine is connected).
- **D73. A grind setting nobody could check says so.** A setting the coach
  gave without Decaid's step data ends with "That is the coach's estimate:
  CafAI doesn't know your grinder's step size, so note where the dial really
  lands in Settings." A linked grinder that Decaid no longer describes counts
  as having no step data (the grinder payload carries `linked`), so the coach
  gives directions only, and the engine re-reads the linked grinder with each
  shot and when the page comes back into view. A shot that ran another bag's
  same-named version is described without repeating the title.

## After the morning session (2026-10-05)

- **D74. Testing against Decaid's own simulator.** The owner asked to test
  CafAI on their computer against a simulator. Decaid's ready-made Windows
  build has a simulated machine and scale (Try Demo Mode, or Settings >
  Advanced > Simulated Devices), with its real API on localhost:8080, so
  `npm run dev` works against it unchanged. `npm run dev:sim` (mock mode with
  `?mockDecaid=0`) pairs that real Decaid with the scripted coach, so testing
  spends no API tokens. In that mode no MSW service worker starts: MSW wraps
  `WebSocket` and reports sockets open before they connect, which would
  defeat CafAI's reconnect backoff, so the scripted coach answers from inside
  the page's `fetch` and every Decaid call is untouched. Mock mode keeps its
  own Vite cache so the two dev servers can run side by side. The steps, and
  what the simulator cannot test, are in docs/SIMULATOR.md. On 2026-10-05
  Decaid 0.8.7+2847 was run here with the simulator, and CafAI did the whole
  loop against it in coach-only mode, in normal mode and inside Decaid's
  window.
- **D75. The shot timer stops when the pour ends.** Against the real Decaid
  the panel's "Last shot" read 66.6 s next to a 63 s shot card: Decaid stays
  in "stopping" for 4-5 s while the weight settles and it stores the shot,
  and the timer waited for "finished". It now stops at the first `pouringDone`
  frame or at the frame Decaid stopped on, whichever comes first; the graph
  keeps plotting the drips. The mock's stopping phase now lasts 4 s, as
  Decaid's does. *Amended by D78:* the timer stops on the last frame Decaid
  records, one frame before the one it stopped on, so the panel and the
  shot card give the same time.

## Demo mode (2026-10-06)

- **D76. A demo with a pre-populated chat (owner, 2026-10-06).** The owner
  asked to see the chat working on a mock: filled in with everything the
  coach can show, plus one question to tap that gets a realistic but scripted
  reply. `npm run demo` starts mock mode on its own address (localhost:5175,
  `/?demo=1`); the built-in mock Decaid and the scripted coach answer, so
  there is no Decaid and no API spend. Each load starts the same demo: CafAI's
  storage at that address is replaced with one dial-in (Kiambu AA over four
  shots, every card and notice kind, a second bag), and the mock Decaid gets
  the matching shots, profiles and loaded version. The last shot's "How did
  it taste?" stays open. Its answers go to the scripted coach, which in the
  demo thinks for about 1.5 s (the owner's pick of three), streams at about
  30 words a second with its pauses, and writes fuller sentences than the
  test script; its decisions do not change. The demo writes only to an
  address with no CafAI data, or with data it wrote itself; anywhere else it
  changes nothing and says why, so it can never replace the bags or key used
  with a real Decaid on localhost:5173. Rejected: the dev preview page with
  fake services (its buttons do nothing real) and an import file (manual
  steps, and its open question would not answer). The demo's data is built
  at each load by playing a hand-written story through CafAI's own engine on
  in-memory storage, a scratch mock Decaid and a fast-forwarded clock, so
  every card, notice and record is the one the app writes and the demo
  follows the app when it changes.
- **D77. Undo marks only the shot whose change made the version.** Building
  the demo showed that Undo marked "the latest applied change on the parent
  version" as undone: after a change confirmed from a typed request (which no
  shot records), Undo marked an earlier shot's by-hand grind change as
  undone, and History and the coach's bag history said so. Undo now marks
  the shot whose applied profile change matches the undone version's change,
  and none when no shot made it. A by-hand grind or dose change, or a kept
  recipe, is never marked undone: they make no version.
- **D78. One shot time and one yield on every screen.** The demo's verifier
  saw the panel say 60.6 s and 44.5 g next to a card saying 62.4 s and
  41.5 g. A shot's time is now the pour, from the first frame after preheat
  to the last frame Decaid recorded (it stops recording at its stop decision,
  before its 4-5 s stopping phase), on the card, for the coach (`durationS`)
  and on the panel's timer, which therefore stops one frame earlier than D75
  said. The yield is Decaid's `actualYield` (the cup's weight once the drips
  settle), else the last weight; once the shot's card is in the chat, the
  panel shows the card's time and yield. Decaid's Visualizer upload times a
  shot the same way; its own History and shot screen count from the start of
  preheat, in whole seconds. Summaries saved earlier keep their old times
  (preheat included). While a shot runs, the panel names the profile's step
  ("Pulling a shot: pause" during Blooming's bloom, Decent's own step name).
- **D79. Only an answer to a taste question is the shot's taste.** The coach
  may ask other questions with `ask_user` (the puck, a preference); their
  answers stayed in the chat but were also saved as the shot's taste, shown
  as "Taste:" in History and written to Decaid's shot notes, where a
  follow-up would replace the real taste. A question is a taste question
  when it mentions taste (taste, tastes, tasted, tasting); the prompt and the
  tool description ask the coach to word the taste question so and to keep
  the word out of others. Cards set aside now say why (typed, Undo, a new
  shot), and a keep card says "Nothing to change: keep this recipe."

## UX: modes and theme (2026-10-07)

The owner's brief: a tablet and a phone mode, the shot taking the screen,
nicer typography, and colours bound to a palette (light or dark plus a
tint, the owner's own pick a green). Design and mockups:
docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md; plans in
docs/superpowers/plans/. Built on branch feat/ux-modes-theme by parallel
subagents, each task committed after its checks.

- **D80. One palette from a tint and a mode.** `src/ui/palette.ts` builds
  every colour from a tint (hue, accent chroma, neutral chroma) in OKLCH and
  writes plain hex (`src/ui/color.ts`), because Chromium 91 understands
  neither oklch() nor color-mix(); out-of-gamut colours keep lightness and
  hue and lose chroma, so contrast tuning holds. Success, warning, error,
  info and the shot graph's series never follow the tint (pressure green,
  flow blue, as on Decent's charts). `palette.test.ts` sweeps every named
  tint and every hue 0-359 in both modes against WCAG AA for each pair the
  UI draws; the spec's starting lightness for light-mode success (0.55) and
  warning (0.60) failed it and became 0.50 and 0.52. Components read colours
  only through the MUI theme (`theme.palette.cafai` for raised, accentSoft,
  live and the graph); secondary actions use a theme-level `tonal` Button
  variant.
- **D81. Figtree, with Roboto's arrows as a fallback family.** Figtree
  (variable, latin, upright and italic, about 20 KB each) replaces Roboto's
  three latin weights. Its latin subset lacks the arrows CafAI prints, so
  Roboto's symbols faces stay as the `CafAI Symbols` family, listed right
  after Figtree. LICENSE-FIGTREE.txt joins the zip (amends D49). Labels are
  sentence case; live numbers use tabular figures with smaller, muted units.
- **D82. The appearance is a setting, with a boot cache.**
  `Settings.appearance` (`{ mode: dark | light | auto, tint: <id> | { hue } }`,
  default dark Crema) is read leniently, mirrored to Decaid and exported like
  the other settings (the export schema carries it, so a JSON import keeps
  it); an import adopts it only while this device still has the default,
  like the model. Storage keeps any well-formed tint id and the UI reads an
  unknown one as Crema, so a newer CafAI's tint survives an older one. An
  `AppearanceStore` in Services applies a change at once and saves it; the
  hue slider previews while dragged and saves on release; of two quick
  changes the later wins. The last resolved colours are kept in localStorage
  (`cafai.appearance.boot`) for main.tsx's boot screen and index.html's
  watchdog page. Auto follows prefers-color-scheme; whether Decaid's WebView
  reports it is on the hardware plan, and Auto shows light where it never
  matches.
- **D83. One shot recording for the app (ShotTrace), a stage early.** The
  buffer moved out of LiveShotGraph into one trace per telemetry store,
  started with the shell, so a graph rebuilt for a new palette keeps the
  shot, and the Shot view, the preview chart and the phone's strip all have
  the shot from its first frame. The trace outlives any graph; its
  listeners are called safely, like the telemetry store's.
- **D84. Layout modes.** A tablet is any viewport at least 800 px wide and
  500 px tall (every Decent tablet, iPads); anything smaller is a phone, with
  bottom tabs, or a side rail when the phone lies on its side (under 500 px
  tall). A new route `#/shot` is the Shot view on a tablet and the Machine
  tab on a phone, so crossing the breakpoint keeps the screen. The machine
  column is 340, 400 or 480 px by width.
  *Superseded in part by D90 and D92: there is no machine column, so no
  widths, and `#/shot` is the Shot view in both layouts (the phone's tab is
  Shot).*
- **D85. Shot focus.** A shot start shows the shot route by itself unless a
  text field has focus or the barista is already there; moving during the
  shot cancels the automatic return; the coach comes back once the chat gets
  the shot's card or notice (not the "Looking for that shot" progress
  notice), or 8 s after the pour finished, and only if the app made the
  switch. Automatic switches use `location.replace`, so Back goes where the
  barista went. For 350 ms after an automatic switch the new pane ignores
  taps; on a tablet only the main pane, so Stop in the machine column always
  works. The coach stays mounted (hidden) under the Shot view, so its scroll
  and draft survive.
  *Amended by D92: on a phone too the guard covers the main pane only, so
  Stop, now in the top bar, always works.*
- **D86. The coach's note and one loaded-profile reading.** Under the big
  graph a small note says the coach is watching, why this shot will not
  count (another profile, a version not confirmed, no bag, no key), or
  "Done. Reading the shot" until the outcome arrives. The Profile line's
  workflow reading is shared through a provider, so the note and the Shot
  view's step ("Pour · step 3 of 3") and yield target add no second poll.
  *Superseded in part by D91: the Profile line is the stats card's now. The
  shell still makes the one reading, so the note, the step and the target
  need no card on screen.*

## The fresh-eyes check of the UX rework (2026-10-08)

A verifier who had not seen the code drove the rework on tablets and phones
(docs/briefs/verify-ux.md), and three fix agents took what it found: the
machine panel, the shell, and the look and the copy. Left open: at 962x602
the machine column still scrolls while "Not connected" shows with Decaid's
alert; at 667x375 (a small phone on its side) the left column scrolls and
Stop shows 44 of its 60 px; and after a shot stopped while still
preheating, CafAI looks for the shot in Decaid up to 6 times and the
browser logs a 404 for each. That last one is older than the rework; the
hardware plan's section 9 now checks whether Decaid saves such a shot.

- **D87. The machine column and the shot views hold still.** The machine
  column's state line ("Pulling a shot: preinfusion start") is always one
  line: too long for the column, it ends in an ellipsis, its whole text is
  its title and what a screen reader hears, and the Shot view names the
  step in full. At 962x602 it wrapped, and moved the readouts, the buttons
  and Stop 27 px for up to a second, twice a shot. The Shot view's step is
  in sentence case ("Pause · step 3 of 6"), keeping words in capitals or
  mixed case ("PI", "LRv3"). On a phone, beside the rail too, the step has
  a full-width line of its own, which keeps its place, empty when there is
  no name, for the whole shot. On an upright phone whose Machine tab is
  under 660 px tall (too short for the status, the buttons, the big graph
  and a three-line note at once) and scrolled to its top, from the shot's
  start until the chat has its outcome, the big graph is drawn over the
  status and the start row. Those stay in their places, hidden and
  untappable, and the coach's note goes under Stop; nothing above Stop
  changes height, so Stop never moves. A tab the barista has scrolled keeps
  the usual arrangement, which the shorter one would scroll back. The
  phone's big graph keeps at least 120 px of plot (was 160; the tablet's
  Shot view keeps 160). The start buttons' labels are 14 px with 2 px
  sides, aligned from the top, so "Hot water" fits on one line at 962x602
  and beside a phone's rail, and the icons line up. The preview card's plot
  may shrink to 64 px (was 90), so the 962x602 column fits without
  scrolling in every state but "Not connected" with Decaid's alert. Before
  any shot, the preview's and the Shot view's timers show the dash (`DASH`
  in format.ts), not "0.0 s".
  *Superseded in part by D90 and D92: the column, its start buttons and the
  preview card are gone, and with them the short phone's cover. The state
  line keeps its one line in the stats card; the step's line of its own is
  the narrow Shot view's (under 600 px wide; a phone on its side keeps the
  step beside the caption), and every Shot view keeps 120 px of plot.*
- **D88. The keyboard holds the height only; the navigation counts in
  tenths.** While a field has focus the layout uses the live width and the
  tallest height since typing began; a new width (a rotation, a narrowed
  window) or a taller window starts the hold again from the window as it
  is. After blur the held height stays until the layout would be the same
  without it, or 500 ms pass. Taking the height again on a new width keeps
  a 390x844 phone turned while typing from reading as 844x844, a tablet.
  The phone's Machine tab shows the running time in tenths ("42.0 s"), like
  the tablet's Shot item and the live strip, in a box that does not grow
  past 10 s; its accessible name, "Machine, shot running, 42 seconds", is
  updated once a second and removed when the shot ends. The spec said
  "42 s"; one clock format everywhere won. The phone tab bar's and rail's
  divider is the line colour: the `borderTop` and `borderRight` shorthands
  had set it back to the text colour. Kept by design: on a phone the screen
  that opens by itself ignores taps for 350 ms, Stop included (D85, the
  spec's "Any automatic switch" row). Stop was not on screen when the
  finger started moving, so a tap there in that window was aimed at the
  coach. On a tablet Stop is never guarded. The check's brief said Stop
  must work at once on both; it now says on a tablet.
  *Superseded in part by D92: the tab is Shot, named "Shot, running, 42
  seconds" mid-shot, and Stop is in the top bar, which the guard never
  covers, so on a phone too Stop works at once.*
- **D89. Set aside by colour, never by opacity; the look from the first
  frame.** What is set aside is drawn in the muted ink: the undone version
  card in History (its "Undone" chip stays in warning), the starting
  profiles not picked (muted name and reason; the chip goes muted with a
  line-colour outline) and a closed question's other answers (the same
  look, still disabled for screen readers). Only an open question waiting
  on the coach keeps MUI's faded disabled chip, because its answers come
  back. Opacity escaped the contrast sweep, and in light mode those cards
  and chips fell to 2.3 to 3.7:1; in the muted ink they measure 6.4:1 and
  up in light Crema, and the sweep holds that ink to 4.5:1 at every hue.
  Chips outlined in a status colour or the accent draw the outline opaque
  (MUI's is 70%), and the sweep gained "chip outlines: status colours and
  the accent on background and surface, 3:1". Every input placeholder, the
  composer's too, is the muted ink at full opacity. Buttons, inputs,
  selects and textareas take the page's typeface (x-chat's unread count was
  in Arial). The first paint is in the look: index.html's head paints the
  default look (dark Crema, #140e09) and an ES5 script swaps in the cached
  boot colours (`cafai.appearance.boot`, D82) before the bundle runs, so a
  dark CafAI never opens on white; the theme then sets the page's own
  background. User-facing copy says "this device" where it said "this
  tablet" (the API key's notes, the storage and network errors, the engine
  warning, the start-failure page): the same text runs in a phone's
  browser.

## Chat first, the machine on demand (2026-10-08)

The owner's ask: on load, no graph and no machine stats; a live stats
message in the chat when it opens, gone as the chat moves on; Stats always
among the pre-filled prompts to show it again; the graph opened from the
header; and a row of the most used buttons, with Stop in place of whatever
runs. Answers given: the card goes once the chat moves on, the phone follows
(its Machine tab becomes Shot), Stats is the only pre-filled prompt, and Stop
lives only in the row. Design and mockup:
docs/superpowers/specs/2026-10-08-chat-first-machine-design.md; plan in
docs/superpowers/plans/2026-10-08-chat-first-machine.md. Built on branch
feat/ux-modes-theme by three agents in parallel (the machine's pieces, the
card in the chat, the shell), each committed after its checks. Two corners
the fresh-eyes check left open go with the machine column: its scrolling at
962x602 with "Not connected" and Decaid's alert, and the left column of a
small phone on its side.

- **D90. No machine column; the machine row, Stop in the running start's
  place.** The routed screen takes the whole width under the top bar; the
  column, its preview chart and `MachinePanel` are gone, and with them the
  column's own starts and Stop. The machine row (`MachineRow.tsx`) is in the
  top bar on every screen: Espresso, Steam, Flush and Hot water, each its
  icon over a short label in a 54x48 box on a tablet, the icon alone in
  44x44 on a phone (named for screen readers). While the machine runs
  anything, the start that runs turns into Stop in its own box, filled in
  the error colour, and the other starts are held. Stop takes Espresso's
  place for espresso and skipStep, Steam's for steam and steamRinse,
  Flush's for flush and airPurge, Hot water's for hotWater, and the first
  place for anything else (cleaning, descaling). It is the same button,
  changed, so the finger that started the run finds Stop under it. A
  group-head machine's row is empty until something runs, then holds Stop
  alone; a sleeping machine's holds Wake alone. After a run ends or the
  machine wakes, the starts stay held for 1 s, so a second tap meant for
  Stop or Wake starts nothing in the same spot; Stop itself is never held.
  One command is in flight for the whole app (`useMachineCommands.ts`),
  shared by the row and the stats card: while one is in flight a tap on a
  start, Tare or Sleep sends nothing (the command counts as sent before the
  request goes, so a fast double tap sends once), and Stop is never
  blocked. Nothing is retried on its own. The machine's problems show in
  one slim alert under the top bar (`MachineAlerts.tsx`, about 40 px, in
  the flow, so it pushes the screen down), only while they last, the most
  important first: a failed command from the row or the card (closable,
  cleared by the next command); Decaid's device error (closable); Decaid
  out of reach (after 2.5 s); not connected (after 1 s, once Decaid has
  answered); the machine's own error; water to refill (held 3 s before it
  shows and before it clears, as the level wobbles while water moves).
  Supersedes D84's column widths and D87's rules for the column's start
  buttons and preview card.
- **D91. The stats card, and Stats to bring it back.** The machine's
  readings are a card in the chat (`StatsCard.tsx`): "Machine" with "DE1"
  and "Scale" beside their dots ("No machine" and "No scale" when not
  connected), the state line, Group (with its target), Steam, Water
  (Refill when low) and Scale, the loaded profile ("Profile", its title and
  the "This bag" mark), and Tare and Sleep or Wake. It updates live and
  keeps the column's rules: one component per number, the state line on one
  line. Laid out for its own width (`useOwnLayout.ts`: Chromium 91 has no
  container queries), it puts the four readouts in a row from 520 px and
  two by two under that, where Sleep shows its icon alone. It is a row of
  the thread on screen only (`statsCard.ts`), never one of the coach's
  messages: never stored (so never in the export or Decaid's copy) and
  never sent to the coach. It reads as CafAI's (role system), joined to the
  run of messages above it, so no "Coach" label sits over the machine's
  numbers. The first time the chat shows in a session the card follows its
  newest message (in an empty chat too). It goes as soon as anything new
  lands (a message from either side, a notice, a shot card), even if that
  goes again as a progress notice does, and when another bag opens; it
  stays while the newest message only changes inside (a rating, a reply
  still streaming). Its place is kept per services instance, like the shot
  recording, so a visit to History and back keeps it, and a reload starts
  with it shown. The only pre-filled prompt is **Stats**: one chip, 40 px
  tall with an invisible band that makes it a 48 px touch target, above the
  composer in x-chat's suggestions slot, aligned with the composer, on every
  chat, an empty one too. A tap posts the card after the newest message, or
  leaves it where it already is, and brings it into view; it sends nothing,
  calls no coach and keeps the draft. The chat needs an API key and a bag,
  so the prompt waits for both; until then the coach screen's setup card
  (the key, or New bag) has the stats card under it, because CafAI is an
  everyday skin too and the machine's readings, Tare and Sleep must not
  wait for the coach.
  *Amended by D127: Stats is no longer the only prompt: while the taste
  question is open, Taste words and Need help? join it in that row, and
  neither sends anything either.*
- **D92. The graph from Shot, the phone's Shot tab, and a top bar the guard
  never covers.** The big graph is the Shot view (`#/shot`), opened from
  Shot: the tablet's top bar, or the phone's tab, renamed from Machine and
  now the same Shot view. Between shots it shows the last shot; before any
  shot its timer shows the dash. A starting shot still takes the screen by
  itself and hands back to the coach (D85), with the coach's note under the
  graph (D86), and the live strip on the phone's Coach tab still opens it.
  The tablet's top bar: the brand, Coach, Shot, History, Settings, a gap,
  the machine row, a hairline, Decaid settings (an icon button) and Exit.
  It fits at 962 px mid-shot inside Decaid, with 18 px to spare, as the
  places take 8 px sides and 2 px gaps below 1200 px; between 800 and
  960 px they show their icons alone, still named for screen readers. The
  phone's top bar: the brand (its word gives way first, the cup stays), a
  gap, the row as icons, then Decaid settings and Exit as icon buttons. One
  top bar element serves both layouts, so the row stays mounted across a
  layout change and a command in flight keeps its spinner. The machine
  alert sits first under the bar, then the old-engine warning. The tap
  guard after an automatic switch (350 ms, D85) covers the main pane only,
  on a tablet and on a phone, never the top bar (nor the phone's tabs), so
  Stop takes a tap the moment it appears. That supersedes D88's guard over
  the phone's Stop, kept then because Stop sat in the pane that switched.
  Mid-shot the Shot tab shows "42.0 s" and is named "Shot, running, 42
  seconds" (D88's wording, moved). The Shot view lays itself out for its own
  box: on a tablet across the pane, at most 960 px wide and centred; under
  600 px wide (an upright phone) the step takes a line of its own and the
  readouts go two by two; under 440 px tall (a phone on its side) four
  readouts stay in a row, in the smaller timer and readout sizes. The plot
  keeps at least 120 px in all three, and where even that does not fit the
  view scrolls rather than cut off the note. The phone's readouts are 24 px
  (were 18), and its weight shows the target ("of 36") too. With the column
  go D87's cover on a short upright phone and the split panel of a phone on
  its side.

## Decaid alignment and update safety (2026-10-09)

The owner's ask: audit CafAI against the patterns and practices of the other
skins for Decaid, leaning on streamline-js because Decent builds it; use what
Decaid offers natively; and make sure Decaid updates do not break CafAI, with
type checking and whatever else is possible. The audit (docs/audit/2026-10-09/:
streamline.md, decaid.md, cafai.md, others.md, typegen.md) found CafAI ahead
of every skin surveyed on engineering, Decent's included, but with a view of
Decaid read once from `a45961b` and never checked again, and seven ways a
Decaid change would break it without anyone noticing (cafai.md section 2.5).
Answers given: all eight update-safety layers; the Decaid features in the
spec's section 1; an alert with a one-tap fix for gateway mode Full; the API
key in Decaid only by the user's choice. Design:
docs/superpowers/specs/2026-10-09-decaid-alignment-design.md; plan:
docs/superpowers/plans/2026-10-09-decaid-alignment.md. Built on branch
feat/decaid-alignment in waves, one agent per area: wave 0 (292615e), wave 1
(the readers 487f115, the mock bd4f0fd, the contract f9862f3, the real-Decaid
tests 120ae40), wave 2 (the machine 1358c82, the engine 7c4e2eb, Settings
fc21cd1) and wave 3, the intake (the bean card, the bag photo, the coach's
DYE2 tool and the Visualizer link: D115 to D122, with D102 and D103 brought
up to date). D93 to D104 are the spec's decisions; D105 onward were settled
while building. The repository has no git remote, so none of the new GitHub
workflows has run.

- **D93. The pin is Decaid v0.8.8 (`aab5f93`).** CafAI is checked against
  the specs of the release people run, not Decaid's `main`, which moves
  daily. `contract/decaid/spec/` holds `rest_v1.yml` and `websocket_v1.yml`
  verbatim from `aab5f93`; `contract/decaid/PIN.json` holds the tag, the
  commit, both specs' sha256 and the generator (openapi-typescript 7.13.0);
  `src/api/decaidVersion.ts` tells the app, so About can say which Decaid
  CafAI was verified with (D96). Decaid gives skins no compatibility
  contract to lean on instead: `GET /api/v1/info` reports the build, not an
  API version, both specs say `1.0.0` and are written by hand, and there is
  no changelog or deprecation policy (decaid.md sections 3.1 to 3.3).
  `npm run decaid:update -- <tag>` (`scripts/decaid-contract.mjs`) moves the
  pin: it fetches both specs at a tag, branch or sha, regenerates the types
  and rewrites `PIN.json` and `decaidVersion.ts`; `contract/decaid/README.md`
  says what to do with what then fails. v0.8.8 was the newest release
  (2026-10-06) and ships the Linux builds the CI job runs (D105).
- **D94. Typecheck checks CafAI's wire types against the pinned spec.**
  `npm run typecheck` runs CafAI's own typecheck, then
  `tsc -p tsconfig.contract.json` over the 78 checks in
  `contract/decaid/checks/` (29 REST replies, 17 REST bodies and query and
  path parameters, 8 WebSocket checks, 16 enums, 8 status codes), then
  `scripts/decaid-contract.mjs --check` (the specs match `PIN.json`, and
  regenerating gives the committed `generated/` files byte for byte).
  Replies are diffed spec to CafAI (what Decaid may send must fit what
  CafAI expects), bodies and parameters CafAI to spec. Each
  diff must equal the exceptions recorded for it in
  `contract/decaid/drift.ts`, each with its kind (spec gap, spec drift,
  CafAI narrower, CafAI looser, parsed shape), a reason and the Dart
  file:line at the pin that proves it. A new mismatch fails as `unexpected`
  and an exception Decaid has fixed as `stale`, so the list cannot rot.
  `mock/decaid/contract.test.ts` holds the mock to the same spec with ajv
  (`contract/decaid/schema.ts`): every fixture, the mock's replies and
  frames for every route and channel CafAI uses, and the bodies CafAI
  sends, with the runtime exceptions (`SPEC_EXCEPTIONS`) in the same
  registry. Why: CafAI's types were written by hand from Dart, and the mock
  was typed with CafAI's own types, so the two checked each other, never
  Decaid (cafai.md section 3.3). The experiment (typegen.md) showed the
  checks catch real changes: run on `a45961b` they failed on exactly the one
  real spec change, and on a mutated spec they caught a renamed, a newly
  nullable and a removed field. No other skin or plugin checks itself
  against Decaid's spec. `ci.yml` already runs typecheck, so the contract
  runs on every push.
- **D95. Tolerant reader, fail safe, never silent.** Every Decaid reply is
  checked where it enters CafAI: zod readers in `src/api/readers.ts`
  (`z.looseObject`, optional where Decaid leaves a key out, open enums) for
  build and machine info, settings, plugins, devices (`getDevices` and
  `scanDevices`), the workflow, profile records, shot summaries and
  records, beans and batches, and the frame parsers in `src/api/frames.ts`.
  Extra fields pass through, and an enum value CafAI does not know is kept.
  A field CafAI cannot do without (the workflow's profile, a record's id, a
  device's id, type and state) fails the call with
  `GatewayError('unexpected_reply')`; in a list, only that item is left
  out. Any other field CafAI cannot read is unknown, never Decaid's
  default: left out, null where CafAI's type says so, or empty text a
  screen shows as unknown (About's "Decaid version unknown"). A steam
  temperature it cannot read shows a dash in Settings, not 150 °C, and a
  profile record's `parentId` it cannot read never makes the profile count
  as deduplicated (`createProfileVersion` in `src/api/workflow.ts`).
  The client's routes that answer a list (plugins, devices and the scan,
  profiles, beans and batches) go through `requestList`
  (`src/api/http.ts`): `null` or an empty body fails the call with drift,
  and only `[]` means none, so `linkBag` writes nothing and tries again at
  the next save, and the bean card shows no rows. A machine frame whose
  timestamp is not a usable time keeps its state and readings, stamped
  with the time it arrived (`formatDecaidTimestamp` in `src/api/time.ts`),
  so Stop stays during a shot. Each of these goes to the drift log
  (`src/api/drift.ts`): a route or channel and a field path, with types
  and enum values only, never free text, a note or the key. A kind is kept
  once, with a count, at most 50 kinds, and each new kind is written once
  to the console, which Decaid serves at `/api/v1/webview/logs`. Why:
  `requestValue` cast `JSON.parse`, so workflows, profile records and shot
  records were trusted blindly, and the audit found seven ways a renamed
  or retyped field would fail silently: a backup read as empty, shots
  never detected, every shot credited to the active version, readings
  shown as 0, loads assumed, writes retried forever, no Stop (cafai.md
  section 2.5). D97 and D106 to D110 are the rules for each. The first
  build still filled in Decaid's default for a field it could not read,
  took a list reply of `null` for none, and dropped a frame without a
  usable timestamp; the fresh-eyes review of 2026-10-10 found all three. A
  default reads as Decaid's own value: steam at 150 °C that may be off, a
  renamed flow at 0.8 ml/s, and a parent CafAI could not read as no
  parent, unlike the one sent, so the chat said Decaid had deduplicated a
  profile it had not. A library read as empty had `linkBag` add a second
  bean for a coffee already in it. A dropped frame took the machine's state
  with it, and Stop with the state.
- **D96. Drift is visible.** Settings > About
  (`src/ui/settings/AboutDecaid.tsx`) shows "Decaid 0.9.0 (CafAI was
  verified with 0.8.8)". A running Decaid older than the pin adds "Older
  than the Decaid CafAI was checked against; update Decaid if something
  does not work." Versions compare on their numeric part ("0.8.8+2850" is
  0.8.8); one that does not parse is shown without a comparison. When the
  drift log holds anything, "Decaid sent N things CafAI did not expect"
  lists the entries, and **Copy report** copies them with CafAI's version
  and both of Decaid's (`formatDriftReport`). The last line is the backup's
  health (spec 5.15), from the mirror's last push and last error: "Backed
  up to Decaid N min ago" (hours, then days, when older), "Backup paused:
  <reason>" or "Not backed up yet". A fresh page reads the time of the last
  backup from Decaid's own record of it (the backup's `meta.updatedAt`, one
  read when About first opens), and the line is left out until it knows:
  a time kept in the browser would be lost with browser storage, exactly
  when the backup matters, and "Not backed up yet" would then be false.
  Why: drift that only reaches a console is drift nobody sees. On a tablet
  the owner reads it where CafAI runs and can send the report, and a newer
  Decaid that changed something shows as a list, not a mystery. The report
  holds routes, field paths, types and counts, never the user's words or
  the key (D95).
- **D97. Stop for unknown states.** `src/api/machineStates.ts` sorts
  Decaid's machine states (`MachineState` in `machine.dart` at `aab5f93`)
  by what CafAI may do. The nine running ones (espresso, steam, hotWater,
  flush, steamRinse, skipStep, cleaning, descaling, airPurge) get Stop. The
  nine at rest (idle, schedIdle, sleeping, heating, preheating, booting,
  busy, needsWater, error) do not. fwUpgrade, calibration and selfTest,
  which nothing may interrupt, get neither Stop nor Sleep. Any other state
  gets Stop, shows humanised in the state line ("someFutureState" reads
  "Some future state") and is reported as drift; Sleep is disabled there
  too (`src/ui/machine/commands.ts`). Why: Stop showed only for the running
  states CafAI knew, so a running state Decaid renamed or added would have
  shown no Stop while water ran (cafai.md section 2.5). An unneeded Stop only puts the machine to idle; a
  missing one leaves the pump running. The frame parser and the controls
  read the one list, so they cannot disagree.
- **D98. Gateway mode Full gets an alert with a one-tap fix.** In Full,
  Decaid leaves stopping at the target weight to the skin, and CafAI does
  not stop shots, so they would run past the target. CafAI reads
  `GET /api/v1/settings` at start, each time the machine connects and when
  the page comes back into view (`src/ui/machine/useGatewayMode.ts`). While
  `gatewayMode` is `full`, the machine alert says "Decaid is set to leave
  stopping shots to the skin, and CafAI does not stop them, so shots will
  not stop at the target weight." with **Let Decaid stop shots**, which
  posts `{"gatewayMode":"tracking"}` and follows what Decaid reads back: if
  Decaid kept Full, "Decaid kept its setting. Set Gateway Mode to Tracking
  in Decaid's settings."; if the post failed, "Couldn't change Decaid's
  setting." with Decaid's reason. A read that fails keeps the last answer,
  and a reply without a mode is no mode, so the alert never says what CafAI
  is not sure of. It comes after the water alert and before the scale's
  (`MachineAlerts.tsx`). CafAI never changes Decaid's settings by itself.
  Why: streamline forces `tracking` at every start (streamline.md section
  6, rule 14), but gateway mode is Decaid's, for every skin and for
  Decaid's own screens; the owner chose a visible fix one tap away over a
  silent change (spec section 1).
- **D99. The API key may live in Decaid, by choice.** **Keep my API key in
  Decaid**, under the key in Settings > Anthropic API key, is off by
  default. The choice is stored as `keepKeyInDecaid` in the settings record
  (`src/storage/settings.ts`), only once someone chooses on the device: an
  import or restore keeps a choice made there, off as much as on, and fills
  it only on a device that never chose. The copy lives in its own KV
  namespace, `cafai-key` (key `anthropic`, `src/storage/keyBackup.ts`),
  never in `cafai`, an export or a log, so the backup the mirror writes
  never carries it and D37's redaction stays. The switch cannot be turned
  on until a key is saved; once on, it can be turned off with or without a
  key. Turning it on copies the key, turning it off deletes the copy, and a
  key saved while it is on is copied; a switch that cannot reach Decaid
  goes back and says why. Forget key deletes the copy too and leaves the
  choice on for the next key. A copy or delete Decaid does not take is owed:
  CafAI notes it beside the key, in the key's own database (never mirrored,
  exported or imported), and sends it at the next start, at each try of
  D100's late restore, and whenever Decaid's sockets open, the machine
  connects or the page comes back into view, before anything is restored
  from the copy. Settings says "Key saved on this device. Decaid can't be
  reached right now, so CafAI will copy it there as soon as it can." or "The
  key is gone from this device. Decaid can't be reached right now, so CafAI
  will delete its copy there as soon as it can." At those same moments a
  device with no key takes Decaid's copy (`src/app/createServices.ts`), in
  any browser, a phone's too, unless the key was forgotten on that device:
  it stays forgotten until a key is saved there or the switch is turned on
  again, whatever copy Decaid still holds. The note under the switch
  says the cost: "So you do not have to paste it again after a Decaid
  update. Any device on your network can read Decaid's store, and Decaid's
  backups include it." The setup card says "The key stays on this device
  unless you choose in Settings to keep a copy in Decaid." Why: a Decaid
  update wipes a skin's browser storage (Decent's b0aa1ce; streamline.md
  section 6, rule 2), so the key had to be pasted again after every update,
  and anyone on the network can read Decaid's store, so keeping it there is
  the user's call. The plan read the switch from whether a copy existed;
  the build stores the choice, because a copy's presence let the switch
  show on while nothing was backed up, and let a Forget that could not
  reach Decaid say the key was gone. The first build asked the user to turn
  the switch off once Decaid was back, but with no key the switch could not
  be turned off, and the next start took the forgotten key back from the
  copy; a key saved while Decaid was away left the old one there for good.
- **D100. Restore waits for Decaid.** A start-up restore has four outcomes
  (`RestoreResult` in `src/storage/index.ts`): `restored`; `nothing` (the
  device already has bags, or Decaid holds no backup, or one this version
  cannot import); `unreachable` (no answer, a timeout, 408, 429 or 5xx);
  and `unreadable` (an answer CafAI cannot read, reported as drift and
  never taken for an empty backup, D107). After `unreachable` CafAI keeps
  trying Decaid's backup: 2 s after start, doubling to every 30 s, for 10
  minutes, and at once when the machine connects, Decaid's sockets open or
  the page comes back into view (`startLateRestore`). Each try also brings
  the key back when the user keeps a copy in Decaid (D99). When records
  land, the chat and the look are read again and the open bag's chat says
  "Your bags are back from Decaid's backup." A start that restored bags but
  has no key shows on the key card "Your bags came from Decaid's backup.
  Paste your API key to go on.", true both after a Decaid update and on a
  phone's first visit (an earlier wording blamed an update or a cleared
  storage, false on a new device). Why:
  Decent's b0aa1ce says every Decaid update wipes the skin's IndexedDB, and
  after an update the WebView can start before Decaid's web service answers
  (streamline.md section 6, rules 1 and 2). CafAI restored once at start: a
  Decaid not answering yet meant an empty CafAI, and the backup was merged
  only at the next write, without the screen refreshing.
- **D101. The rating scale is probed, not assumed.** Decaid 0.8.6 field
  builds keep `enjoyment` 0-100 and later builds 0-10 (others.md section
  6.2, finding 1), and CafAI wrote stars x 2 everywhere. Now, before the
  first stars of a session go out, CafAI sends
  `PUT /api/v1/shots/<a made-up id> {"annotations":{"enjoyment":11}}`
  (`probeEnjoymentScale` in `src/api/client.ts`, decaid-mcp's probe).
  Current builds check `enjoyment` before they look the shot up, so a 400
  that mentions enjoyment means 0-10 (stars x 2); 0.8.6 looks the shot up
  first, so a 404 means 0-100 (stars x 20). No answer, a timeout, 408, 425,
  429 or 503 asks again at the next write. An answer that tells neither is
  reported as drift and asked again only after the next shot. The answer
  holds for the session, and until it is known the stars wait in the
  outbox while the taste goes on without them. Why: a guess writes a wrong
  number into every rated shot in Decaid and Visualizer, refused (80 on a
  0-10 build) or ten times too low (8 on 0-100); a made-up id changes
  nothing on either.
  *Amended by D126: what goes out is the running score of the barista's
  words, not stars: the score as it is on 0-10, ten times it on 0-100.*
- **D102. Bags link to Decaid's bean library.** `Bag` has `decaidBeanId`,
  `decaidBatchId` and `roastDate`, all `null` until set (the storage
  schema, the mirror, export and import accept bags without them). A bag
  picked on the card "Which coffee is it?" is linked to its batch at once
  (D115). Any other bag is linked once its details are saved, by the coach
  or from a bag photo's confirm card (D120): CafAI looks in
  `GET /api/v1/beans` for a bean with the same roaster and name, ignoring
  case, and reuses it or adds one. On a bean it reused, it takes the
  unarchived batch with the bag's roast date when there is one, else it
  adds a batch for the bag; a bag without a roast date always gets a batch
  of its own, as an undated batch may be an earlier bag of the same coffee.
  It keeps both ids on the bag and says "Added to Decaid's beans.", or
  "Already in Decaid's beans." when it reused both and added nothing
  (`linkBag` in `src/app/engine/engine.ts`). A bag without a roaster or a
  name of its own is not added, and a failure leaves it unlinked for the
  next save to try. CafAI only adds beans and batches: it never edits or
  deletes one, so a detail corrected later changes the bag only. Every load
  writes the bag's batch (`beanBatchId`, null when unlinked), name
  (`coffeeName`) and roaster (`coffeeRoaster`) into the workflow context,
  where it used to clear them, and clears `grinderBurrs` with the other
  grinder fields (spec 5.2). Why: Decaid keeps the workflow with each shot,
  and its shot filters and DYE2's history find the coffee there (decaid.md
  section 1.3, others.md section 4.4). Decaid merges the context field by
  field, so another skin's batch, the last coffee's roaster or a stale
  `grinderBurrs` (new since `a45961b`) would stick to this coffee's shots
  (decaid.md section 4.3). Never editing keeps CafAI off beans the user
  keeps in Decaid or DYE2. Taking the batch with the same roast date keeps
  one bag one batch when the barista photographs or describes a coffee that
  is already in the library instead of picking it. Without a date nothing
  tells a second bag of a coffee from the first, and two bags on one batch
  would share their shots in Decaid's filters, DYE2's history and
  `get_recent_setups`.
- **D103. Decaid's plugins are optional.** `src/api/plugins.ts` reads
  `GET /api/v1/plugins` at start, then every 30 s for 10 minutes
  (`watchPlugins`), and starts the 10 minutes again whenever Decaid's
  devices socket opens again or the machine connects; it stops early once
  the three plugins CafAI uses are all loaded. It also reads when the page
  comes back into view (`src/app/createServices.ts`). A plugin counts only
  while Decaid lists it `loaded`; a failed read keeps the last answer, and
  before the first answer every plugin counts as absent. Three features
  use one each. The stats card's countdown follows
  `time-to-ready.reaplugin`'s channel only while it is loaded (D112);
  without it Heating shows with no minutes. The shot card's **On
  Visualizer** looks for `visualizer.reaplugin`'s upload only while it is
  loaded (D121). The coach's `get_recent_setups` asks DYE2's own endpoint
  while `dye2.reaplugin` is loaded, otherwise reads the copy DYE2 keeps in
  Decaid's store, and answers `{"available": false}` when neither has
  anything (D119). What a plugin leaves is its own payload, not Decaid's
  API, so CafAI reads it leniently (`src/api/pluginData.ts`): a shape it
  does not expect is reported as drift and read as nothing. CafAI never
  writes a plugin's data. Why: plugins are the user's to install, load and
  unload in Decaid's settings, and a tablet may not have a given one
  loaded; CafAI must work the same without them. DYE2's keys have one
  writer, DYE2 (its KV_CONTRACT.md). The reads go on because Decaid 0.8.8
  serves the skin before it starts its plugins (`initialization_step.dart`
  at `aab5f93` calls `plugins.initialize()` after `advance()`, in the
  background), so a tablet's first read after a boot or an update can find
  none loaded, and a page on a tablet mounted on the machine never leaves
  view, so it never comes back into view to read again.
- **D104. Real-Decaid tests are read-only on a tablet.**
  `npm run test:decaid` (`vitest.decaid.config.ts`,
  `src/api/live/*.decaid.ts`) runs CafAI's own client and parsers against
  the Decaid at `DECAID_URL` and checks every reply and frame against the
  pinned spec, with D94's exceptions; without `DECAID_URL` every check is
  reported as skipped, and `npm test` never runs them. `DECAID_URL` alone
  only reads: the routes CafAI relies on, five seconds of each socket it
  opens (time-to-ready's only while Decaid has the plugin loaded), and
  DYE2's and Visualizer's data as CafAI reads them. `DECAID_WRITE=1` adds
  CafAI's writes, each put back (a key in the `cafai-contract-test`
  namespace, the rating-scale probe, a workflow round trip with the
  machine-profile barrier, a test profile then hidden, a bean and a batch
  then archived, gateway mode set and restored, a scan that connects
  nothing, a connect of the machine already connected, Connect leaving
  connected devices alone, and last the simulated machine disconnected,
  read as "not connected", and connected again), and `DECAID_SIM=1` a
  simulated shot with Next step once, notes and a rating; both refuse to
  run unless Decaid simulates the machine and no real machine is connected
  (`src/api/live/harness.ts`). `DECAID_REQUIRE=1`, the release gate, fails a
  check that cannot run instead of skipping it (`src/api/live/env.ts`).
  `npm run e2e:real` (`playwright.real.config.ts`) opens CafAI from
  Decaid's port 3000 and checks it is ready, connected and showing a live
  group temperature. docs/SIMULATOR.md section 6 has the steps for the
  owner's Windows simulator; there, on 2026-10-10, every check passed
  against Decaid 0.8.8+2900 (`aab5f938`, the pin) with the writes and the
  simulated shot (31, then 32 with the read of every batch), and so did
  `npm run e2e:real`; on 2026-10-11, all 36 (22 reads, 9 writes, 5 shot)
  after the checks for Connect, Next step, time-to-ready and the plugins'
  data were added. Why: a write against a tablet changes a real
  machine's workflow, profile library and bean library, while the reads
  alone show whether a Decaid sends what CafAI expects.
- **D105. A daily watch, a real Decaid in CI, and a release gate.**
  `npm run decaid:watch` (`scripts/decaid-watch.mjs`) asks whether the
  newest Decaid would break CafAI, for the latest release and for `main`.
  When their specs differ from the pin's, it generates their types in a
  temporary folder, runs the contract typecheck and the mock contract test
  against them, and diffs the specs: operations added or removed (and
  whether CafAI calls them), and fields added, removed or retyped in the
  schemas CafAI reads or writes. It also lists the Decaid files changed
  since the pin that CafAI depends on (the specs, `doc/Skins.md`,
  `doc/Api.md`, the webserver handlers and models, the Visualizer,
  time-to-ready and settings plugins, DYE2's fetch script) as "read these".
  Exit 1: a check failed, or the spec diff removes or retypes something
  CafAI calls, opens or reads (a property, a schema, an operation, a
  channel, or a parameter removed, renamed, retyped or newly required),
  even when the checks pass; 2: the watch could not look at every version
  or its changed files (GitHub unreachable, or one target only); 4: the
  checks pass but files CafAI depends on changed (a spec that only gained
  fields or operations among them); 0: nothing CafAI depends on changed;
  3: the watch itself broke. An exception Decaid has fixed is reported for
  when the pin moves, not failed. Only the 7 channels CafAI opens are checked, the
  frame types come from the spec's own channel map, and CafAI's types hold
  only the fields it reads, so a change elsewhere is no alarm.
  `.github/workflows/decaid-watch.yml` runs it daily and on demand: on 1 it
  opens an issue labelled `decaid-drift` (or comments on the open one), on
  2 one labelled `decaid-watch-blind` (or a comment), on 4 one labelled
  `decaid-read` (or the open one's body replaced, which notifies no one);
  the run fails on 1 and 3 only. The job that installs dependencies holds
  no write token. A first version passed changes it could see itself
  (renamed settings fields CafAI read but did not declare, a renamed query
  parameter, a channel's new schema) as additive, went silent when it could
  look at one version only, and left Dart-only changes in an artifact; the
  fresh-eyes review of 2026-10-10 showed each. `.github/workflows/decaid-live.yml`
  (daily, on demand, and called by the release) starts Decaid's Linux
  release headless with a simulated machine and scale
  (`scripts/decaid-ci.sh`: xvfb, a fresh profile, this build as the skin),
  runs `test:decaid` with the writes, the simulated shot and
  `DECAID_REQUIRE=1`, then `npm run e2e:real`. `release.yml` publishes only
  after that job passes against the latest Decaid and its own typecheck,
  lint, unit tests and `npm run e2e` pass. Why: Decaid has no compatibility
  policy (D93), so the warning has to be CafAI's own: a release that breaks
  a check should be an issue the next morning, not a surprise on a user's
  tablet. The repository has been on GitHub since 2026-10-11 (QUESTIONS
  #9); scheduled runs use `main`'s copy of these workflows and of the
  watch, so this branch's exit codes and labels start once it is merged.
  `npm run decaid:watch` by hand is the same check as the daily one.
- **D106. A workflow PUT waits 35 s and counts only what Decaid holds.** A
  load's `PUT /api/v1/workflow` now has 35 s (it had 15): Decaid can hold it
  in its queue for 30 s before it answers 503 and skips it, and then waits
  for the steam and water settings to reach the DE1 (streamline.md section
  6, rule 8; `src/api/client.ts`). After a 503 CafAI reads the workflow
  back once; after its own timeout, three times, 2 s apart. The load counts
  only if Decaid already holds everything that was sent: the profile, and
  every context key with its value (a key sent as null must be gone, and
  the extras are compared key by key, as Decaid merges them; `landedAnyway`
  in `src/api/workflow.ts`). Otherwise the PUT's own error stands. Why: at
  15 s CafAI reported a failure Decaid might still apply. Decaid v0.8.8
  never applies a change it answered 503 (`workflow_handler.dart`), so that
  one read only finds a workflow that already held it, but a PUT the client
  gave up on may still be on its way to the DE1, so a timeout gets time to
  land. Counting a load whose context did not land would leave the last
  coffee and version on the shots. The mock plays both cases
  (`?mockSlowWorkflow=<ms|503>`).
- **D107. A missing reading is a dash; an unreadable backup is not an empty
  one.** A machine reading missing from a frame is `null`: a dash on
  screen, a gap in the graph, and drift reported, never 0
  (`src/api/frames.ts`, `src/ui/machine/MachineStatus.tsx`). A reply to the
  read of the whole backup (`GET /api/v1/store/cafai?full=1`) that is not an
  object (an array, `null`, a string, a number) is unreadable: the restore
  does nothing, the mirror pushes nothing until a read succeeds (About says
  "Backup paused"), and drift is reported (`src/api/kv.ts`). A 404 (the
  spec's answer for a namespace that holds nothing) or `{}` is an empty
  namespace. Why: a renamed reading showed 0, which reads as a real
  measurement, and a backup read as empty let a fresh device's first push
  overwrite it with empty lists (cafai.md section 2.5). The spec counted
  `200 null` as empty too; the build does not, since Decaid answers `null`
  only for a single missing key, never for a namespace (decaid.md section
  1.10).
- **D108. Shots are found under any shot-state names.** The machine-state
  fallback now stays armed: when the machine is in a shot (espresso, or
  skipStep as it moves on) and no `shotState` frame with a state CafAI
  knows has come for 3 s, the machine state starts the shot, and the shot
  ends when the machine leaves it (`src/api/telemetry.ts`). A `shotState`
  state CafAI does not know is reported as drift. Skip step's moment belongs
  to the same shot, so a shot still gives one start and one finish. Why:
  the fallback switched off after the first `shotState` frame, so had
  Decaid renamed its shot states, CafAI would never have seen another shot
  (cafai.md section 2.5).
- **D109. A write Decaid refuses is dropped, once, out loud.** The outbox
  (`src/app/engine/outbox.ts`, D64) retries only what may still go
  through: no answer, a timeout, 408, 409, 425, 429 and 5xx. Any other 4xx,
  or a failure inside CafAI, would fail the same way every time, so the
  write is dropped and the chat says so once: "Decaid would not save the
  taste for this shot: <reason>." (or the stars, the taste and the stars,
  or the grinder for the next shots), with the refusal reported as drift
  under the request; a failure inside CafAI says "CafAI could not save the
  taste for this shot." and so on, and logs its detail to the console
  Decaid keeps (`writeDropped` in `src/app/engine/engine.ts`). A 2xx whose
  reply CafAI cannot read counts as landed: Decaid took it, and the reader
  reported the reply. Shot notes that are not text read as empty, with
  drift (`src/app/engine/shotNotes.ts`). Why: a Decaid that validated notes
  or `enjoyment` differently had CafAI retry the write forever, silently
  (cafai.md section 2.5); one notice tells the user what is missing in
  Decaid, and repeating a write that landed would only send it again.
  *Amended by D126: the notices say "the rating" where they said "the
  stars".*
- **D110. When Decaid cannot say, CafAI says what it assumed.** When
  `POST /api/v1/machine/profile`, the barrier after each load (D55),
  answers 404 or 405, this Decaid has no barrier: CafAI assumes the machine
  took the profile and says once per session "This Decaid cannot confirm
  that the machine took a profile, so CafAI will assume it did." When a
  shot record does not name the profile that ran (no `workflow.profile`),
  the shot is credited to the active version as before, drift is reported,
  and the chat says "Decaid's record did not say which profile ran; CafAI
  counted it for v<N>." Why: both used to happen silently: loads were
  assumed for the whole session, and the guard against a shot run from
  another profile was skipped (cafai.md section 2.5). Going on keeps the
  coach working with an older or changed Decaid; saying so lets the user
  weigh the shot.
- **D111. Connect looks without connecting, then connects only the device
  Decaid would.** The "not connected" alert says "Not connected. Wake the
  DE1 and tap Connect DE1, or pair it in Decaid's settings." with
  **Connect DE1**, and **Connect scale** too when the scale is missing. A
  Connect always scans with `connect=false`, because Decaid's scan
  otherwise connects everything it finds, then connects one device by id,
  chosen as Decaid's own connection policy chooses (`resolveMachinePolicy`
  and `resolveScalePolicy` in `policy_resolver.dart` at `aab5f93`;
  `connectKind` in `src/api/client.ts`): the preferred device
  (`preferredMachineId`, `preferredScaleId`) when the scan found it, or the
  only one found when none is preferred. Otherwise it connects nothing and
  says why, after "Couldn't connect the scale." (or the DE1): "The scale
  Decaid uses is not in range. Switch it on, or choose another on Decaid's
  scan screen." when the preferred one is away but another is there,
  "Decaid sees more than one scale. Choose yours on Decaid's scan screen."
  when several are there and none is preferred, and "Decaid did not say
  which scale it uses. Choose yours on Decaid's scan screen." when its
  settings cannot be read or lack the preferred ids (the same with
  "machine" for the DE1). A device of the kind already connected or
  connecting is left as it is. A scale connected as auxiliary (a dosing
  scale) is never the one a Connect is for: `connectKind` ignores it,
  Connect's success check does not count it
  (`src/ui/machine/deviceConnect.ts`), and `describeFailedConnect`
  (`src/api/devices.ts`) does not name it. The connect waits up to 70 s:
  Decaid gives it 30 s, 60 s on Linux, before it answers 504
  (`connection_manager.dart:587-591`), so Decaid's own answer always comes
  first. While it runs the alert says "Looking for your DE1…" (or scale)
  and the button spins; one Connect runs at a time in the whole app, as
  Decaid has one radio to scan with (`src/ui/machine/deviceConnect.ts`). A
  Connect that fails says why in its own device's alert, until the next try
  or until the device is back. A scale missing while the machine is awake
  (none connected though one was this session, or Decaid lists one not
  connected) gets its own alert after 3 s, below the machine's other
  problems: "The scale is not connected. Switch it on and tap Connect
  scale, or pair it in Decaid's settings.", with Connect scale held while
  the machine runs something. The scale is also looked for once by itself,
  quietly, 5 s after the machine wakes or the page comes back into view,
  when none is connected though one was this session: at most every 30 s,
  only while the machine is awake and at rest, and only for Decaid's
  preferred scale (`useScaleRevive.ts`, decaid-zen's rule). Why: the alert
  used to send the user to Decaid's settings, a skin switch away.
  Connecting only the one device never disturbs the other. Decaid makes
  whatever it connects its preferred device (`connection_manager.dart:2249`
  and `:2492`), so the first build, which fell back to the first device
  found, could make another scale in range Decaid's preferred one, by the
  quiet look with no tap at all: a change to Decaid's settings that CafAI
  never makes by itself (D98). When the choice is Decaid's, its scan screen
  makes it. The first build waited 35 s, so on Linux it could give up on a
  connect Decaid was still making. The 5 s wait lets Decaid get its
  preferred scale back by itself, and keeps a scan out of the seconds after
  a wake, when scans upset Bluetooth (streamline.md section 6, rule 20).
- **D112. Heating is the machine's word; time-to-ready only gives the
  minutes.** The stats card says Heating while the machine says heating or
  preheating, or says idle with the substate `preparingForShot`, which is
  what a warming DE1 reports (`isHeatingUp` in `src/ui/machine/format.ts`;
  `de1.utils.dart` at `aab5f93`); it used to say Ready for minutes while
  the group was cold. When Decaid has `time-to-ready.reaplugin` loaded
  (D103), CafAI follows its channel and, while the machine heats, shows
  "Ready in about N min" (whole minutes, rounded up) or "Ready in under a
  minute" at the end of the state line's row. A heating frame with an
  estimate sets a deadline and every frame keeps it alive; it goes 6 s
  after the plugin's last frame, holds at zero for 10 s past its deadline,
  and never shows more than 5 minutes (streamline's timings,
  `src/api/telemetry.ts`). Why: the plugin works its status out from a 2 s
  temperature slope on every snapshot, so a machine at rest moves between
  `reached`, `not_heating` and `heating`; taken for the machine's state,
  it would show Heating on a ready machine. The spec had the plugin's
  status decide; the build lets the machine decide and keeps only the
  plugin's number.
- **D113. Next step moves one step per tap.** While the machine pulls a
  shot (espresso, or skipStep as it moves on) in preinfusion or pouring,
  and the profile in Decaid's workflow has a step after the current one,
  the Shot view shows **Next step**, which sends
  `PUT /api/v1/machine/state/skipStep` (`src/ui/machine/ShotView.tsx`). It
  goes through the app's one command sender, like the machine row: held
  while another command is in flight, sent once per tap, a failure shown in
  the machine alert ("Couldn't move to the next step."). After a tap it
  stays disabled until the machine shows another step, or 1.5 s if it
  never does, so a double tap cannot skip two steps. Never in the top bar.
  Why: Decaid answers the skip before a snapshot shows the new step, and
  unlike Stop a second skip is not the same as one: it takes the step
  after. The spec put it beside the step's name; as built it sits at the
  end of the coach note's row under the plot, its icon alone on a phone
  (DESIGN.md, the Shot view).
- **D114. Steam, hot water and flush stay within what the DE1 can hold.**
  Settings > Steam, hot water and flush
  (`src/ui/settings/DrinkSettingsSection.tsx`) reads `steamSettings`,
  `hotWaterData` and `rinseData` from `GET /api/v1/workflow` and writes
  only the field that changed, as a partial `PUT /api/v1/workflow` that
  never carries the profile. Only steam temperature has a range in Decaid's
  spec: 135-160 °C on a DE1, 165 on a Bengle (the model from
  `GET /api/v1/machine/info`; the DE1's range until it is known). Decaid
  writes the steam temperature and time and the hot water temperature,
  volume and time to the DE1 as single bytes, unchecked
  (`unified_de1.dart:611-630` at `aab5f93`), so 300 ml would run as 44: hot
  water volume stops at 255 ml, as streamline's does, and both times at
  120 s. The flows, and the flush's time and temperature, go through a
  scaled register far from its limits, so their ranges are CafAI's own
  practical ceilings (`src/ui/settings/drinkSettings.ts`; QUESTIONS #12
  lists them all). Every range takes in what Decaid's own screens set
  (`steam_form.dart`, `hot_water_form.dart`, `rinse_form.dart` at
  `aab5f93`), so steam flow goes up to 2.5 ml/s and the flush's time to
  60 s, but for two things: a time or the volume starts at 1, as CafAI
  never writes 0, and steam temperature keeps the spec's range where
  Decaid's screen goes to 170 °C. A value is written only when the user
  changed it: a field left alone never re-sends or clamps what Decaid
  holds, even outside CafAI's range, and a stepper tap at or past the end
  it points to sends nothing (More at or above the top, Less at or below
  the floor). Any steam temperature below 135 °C shows "Off", as Decaid
  treats it as off (`de1_controller.dart:575`), and is never written;
  turning steam on or off stays in Decaid. Until Decaid answers, every
  field is a dash, under "Reading Decaid's drink settings…"; a failed read
  says why, with **Retry**, and the fields stay dashes; a field Decaid sent
  that CafAI cannot read is a dash with "CafAI could not read Decaid's
  value" under it (D95). Nothing is written while the machine runs ("Not
  while the machine is running") or while no DE1 is connected, when every
  field is disabled under "Connect the DE1 to change these.", and a failed
  write puts the old value back and says why. Why: Decaid writes these
  unchecked, so CafAI's clamp is the only one between a typo and the
  machine (streamline.md section 4.1: validate and clamp at the skin
  boundary), and writing only what changed keeps CafAI from undoing values
  another skin set. A range that stops short of Decaid's own screens
  refuses what the barista can set there: the first build stopped steam
  flow at 2 ml/s and the flush at 30 s. Decaid refuses these writes without
  a DE1, as it puts them on the machine at once. The first build also
  showed each range's floor until Decaid answered, which reads as Decaid's
  value; showed a steam temperature of 120 °C, off in Decaid, as a number
  whose Less wrote 135 and turned the heater on; and clamped every step,
  so Less on steam time 0 wrote 1 s and More above the range wrote its
  top, both the wrong way.
  *Amended by D124: steam off reads "Off in Decaid" in the field, an
  unknown value has no buttons, and a failed write says why under its
  field.*
- **D115. "Which coffee is it?" comes first.** A new bag's chat opens with
  this card above the coach's question about the bag
  (`src/ui/chat/parts/BeanCard.tsx`, the `beanPicker` part in
  `src/app/types.ts`). It offers the coffees in Decaid's bean library: the
  unarchived batches of unarchived beans, newest roast date first (batches
  without one after them, the newest added first), at most 8, each row the
  bean's name, its roaster and the roast date, with **Use this**. CafAI
  reads them in two requests whatever the size of the library:
  `GET /api/v1/beans`, and `GET /api/v1/bean-batches`, which answers every
  bean's batches at once (the spec read each bean's batches, one request
  per bean). The card is up at once and says "Looking in Decaid's beans…"
  while they are read; the rows fill in after. **Photo of the bag** (D120)
  and **Something else** work from the start: while the rows load, and
  when Decaid is away or its library is empty (no rows then). A pick fills
  the bag from the batch and its bean (the name, cut to 40 characters; the
  roaster; the country and region as the origin; the process; the notes;
  the roast level when it is one of CafAI's five, whatever its case; the
  roast date) and links both ids before anything else, so a later save adds
  no second batch (D102). Then the coach's intake starts with "The user
  picked <name> by <roaster> from Decaid's bean library: <details>." and
  the same details in the context block's `bag`, so the coach goes to the
  starting profiles without saving them again. Something else closes the
  card, and the coach's question under it waits for the bag described in
  words, as before. A message typed in the chat closes an open card too
  ("Set aside: you described the bag in the chat."): the barista answered
  in words. The stored chat keeps the card's rows with everything a pick
  fills in, so the card works after a reload and while Decaid is away; one
  still loading when the page reloads reads its rows again when the bag
  opens. Why: the coffee is often in the library already (Decaid's screens
  and DYE2 add it), and one tap gives the coach the bean, the roaster, the
  roast date and the days it spent frozen, which a barista rarely types.
  One request per bean would hold the card up on a large library. And the
  card never waits for Decaid: a bag can always be photographed or
  described.
- **D116. A new bag's chat opens at the card's top.** The chat follows its
  newest row, which on a new bag is the coach's question under "Which
  coffee is it?", or the stats card under both the first time the chat
  shows in a session (D91). Followed to its end, the thread would open with
  the card's title and its newest roasts above the view on a 962x602
  tablet, where eight rows do not fit. So a new bag's chat opens at the
  card's top and stays there while the rows under it grow (the card's own
  rows arriving, the stats card's numbers), until something newer lands,
  the barista acts (taps a card or sends a message) or scrolls to the end;
  then it follows as before (`showStart` in `src/ui/chat/followNewest.ts`,
  `ChatSurface.tsx`). "Newer" is told by the thread's newest row as CafAI
  hands it to x-chat, not by the rows on screen: x-chat draws a new thread
  a moment after it gets it, so at first the rows on screen are the old
  bag's. A barista who scrolls the card while it is held is reading it, so
  the thread stops following until they act or reach the end. D91 stands:
  when the stats card shows, it is still the newest row, below the card.
  Why: the card is the question to answer first, so its title and the
  newest roasts are what the barista should see, and nothing should pull
  the card away from under a reading finger.
- **D117. Roast dates are days, read as written; frozen days do not
  count.** A batch's roast date, and its freeze and thaw dates, are read as
  the day they are written with (`YYYY-MM-DD`), whatever zone their
  timestamp carries (`writtenDate` in `src/coach/roastAge.ts`). Only a
  moment, such as when DYE2 captured a setup, moves to the device's
  calendar (`localDay`). The coffee's age is the days from its roast to
  today, less the days its batch spent in a freezer: from `freezeDate` to
  `unfreezeDate`, or to today while it has not been thawed, never before
  the roast or after today. The coach reads it as `roast` at intake and
  with every shot, counted to that day: "Roasted 2026-10-01 (9 days ago)",
  "Roasted 2026-09-10 (18 days ago; 12 days in the freezer not counted)",
  "(today)" on the roast day, and the date alone when it is after today.
  The freezer dates come from the bag's batch, read again from Decaid's
  bean library (archived batches included) for each turn that carries
  `roast`, so a batch frozen or thawed in Decaid after the pick counts;
  while Decaid cannot be read, from the card's row of the batch picked. A
  bag with no batch has its roast date only. Why: the same day
  reaches CafAI in three forms. Decaid keeps a plain date as a local
  timestamp without a zone and gives back one it was sent in UTC as UTC,
  and DYE2 writes roast dates with `toISOString()`. Read on the local
  calendar, a UTC midnight is the day before anywhere west of Greenwich, so
  every coffee would be a day older there. A roast date names a day, not a
  moment. Frozen coffee barely ages, so a bag roasted 30 days ago that
  spent 12 in the freezer drinks like an 18-day-old one, and the coach
  should hear it that way.
- **D118. Today goes in the intake turn; a correction resends every
  detail.** `save_bag_details` takes `roastDate` (`YYYY-MM-DD` or null)
  with the other details, so a roast date said in the chat is saved and
  goes into the batch CafAI adds for the bag (D102). To turn "roasted 28
  September" or "3 days ago" into a date the coach needs today's date, and
  it gets it in the intake turn's context block (`today`, on the device's
  calendar), with `roast` and, for a picked or confirmed bag, `bag`, and
  again in every shot's event block, so a date said days later, after a
  shot, counts from that shot's day. The system prompt holds no dates. Each `save_bag_details` call replaces every
  detail, so the tool's description tells the coach, when it corrects one,
  to send all the others as saved (its earlier call, or the intake's
  `bag`). A call stored before `roastDate` existed reads as a roast date
  nobody knows. Why: a date said in words counts from the day it was said,
  and the intake turn keeps that day beside the words however long the bag
  takes to dial in. In the system prompt it would be the day of each
  request, and it would change the prompt with the date: the system prompt
  opens every request's cached prefix and stays byte-identical across turns
  and bags (docs/briefs/ENGINE_PROTOCOL.md), so the cache would miss for
  the whole prefix, the transcript included, each time the day turned. A
  correction that sent only the corrected detail would blank the rest: the
  roaster, the origin and the notes would go from the bag and from the
  coach's later turns.
- **D119. The coach reads DYE2's setups and never writes them.**
  `get_recent_setups` is an auto tool with no input
  (`src/coach/queries.ts`, `src/api/pluginData.ts`): the setups DYE2
  recorded for this bag's coffee, at most 10, each with its `kind`
  (`recent`, one DYE2 saw used lately; `favourite` or `recipe`, one the
  user saved), `sameBatch` (true for the bag's batch, false for an earlier
  batch of the same bean, null when unknown), the profile title, grind
  setting, dose, yield, rpm, basket and the day DYE2 captured it, plus the
  equipment and basket names DYE2 knows. A linked bag matches its batch and
  its bean's earlier batches, archived ones too
  (`GET /api/v1/bean-batches?includeArchived=true`); an unlinked one
  matches on its name and roaster, a roaster missing on either side not
  counting against it. While DYE2 is loaded, the recent setups come fresh
  from its `recent-favs` endpoint, which works them out from the shot
  history; otherwise, or when that fails, from the copy DYE2 keeps in
  Decaid's store (`autoFavourites`), where the saved favourites, the
  recipes, the equipment and the baskets always are. A key that does not
  hold a list reads as empty, with drift. Without DYE2 (not loaded, and
  none of its keys holding anything) the answer is `{"available": false}`;
  a Decaid that cannot be read is a tool error in plain words. The
  description tells the coach to call it at intake for a coffee from the
  library or one brewed before, and, for a bag described in words, after
  `save_bag_details`, as there is no name to match before. Why: what the
  barista already did with this coffee, or with an earlier roast of it (the
  profile, the grind, the dose), is the best start the coach can have. A
  recent setup is only one DYE2 saw used, which says nothing about how it
  tasted, so the coach is told which kind each is. DYE2 is the only writer
  of its keys (D103).
- **D120. A bag photo is sent once, and CafAI keeps no copy.** **Photo of
  the bag** opens the camera or the picker through a file input (D122).
  CafAI draws the photo at most 1568 px on its longest side, as JPEG at 0.85
  (`src/ui/chat/bagPhoto.ts`), and sends it once, in a request of its own,
  to the coach's model chosen in Settings, asking for the bag's details as
  JSON, each null when the bag does not show it (`src/llm/extractBag.ts`):
  no tools, no system prompt, low effort, no retry by the client, and no
  `cache_control`, so nothing is written to the prompt cache. The answer is
  read leniently (text cut to what a bag detail holds, the roast level
  matched to CafAI's five, the roast date read as written, D117) and fills
  **Check the bag's details** (`BagConfirmCard.tsx`), where every field can
  be changed and the name is required. Confirm saves the details as
  `save_bag_details` would and starts the coach's intake with "The user
  confirmed these details read from a photo of the bag: …"; a bag already
  in the library reuses its bean, and the batch with the same roast date
  (D102). A message typed in the chat instead sets the card aside, with
  nothing saved. The photo is never stored, mirrored, logged or kept in the
  transcript: no field of the bag, the iteration or the chat holds it.
  Without an API key the chat says "Add your API key in Settings first.",
  and a photo that cannot be read leaves the card open and says why. Why: a
  label is quicker to photograph than to type on a tablet. At 1568 px the
  print stays legible and the request small: current Claude models read
  images up to 2576 px, at up to three times the image tokens, which a
  label does not need, and older ones scale anything over 1568 px down
  themselves. A cache write is billed at 1.25 times the input, and this
  request never repeats. A photo has no reason to outlive the details read
  from it, and the confirm card is there because a model can misread a
  label.
- **D121. A shot the Visualizer plugin uploaded links to its page.** While
  `visualizer.reaplugin` is loaded (D103), after a shot's card reaches the
  chat CafAI reads the plugin's `lastUploadedShot` from Decaid's store
  every 3 s for 30 s (`watchVisualizer` in `src/app/engine/engine.ts`).
  When it names this shot, CafAI reads `lastVisualizerId`, which the plugin
  writes with it, and the card gets **On Visualizer**, a plain link to
  `https://visualizer.coffee/shots/<id>` that Decaid opens in the system
  browser. The link is kept on the iteration (`visualizerUrl`, optional, so
  older records and exports still import), so History's shot row has it
  too, and it reaches the bag's stored chat even when another bag is open
  by then. Only a Visualizer shot page is ever linked, whatever an imported
  record holds. A look Decaid does not answer is a look missed, and after
  30 s without a match there is no link. Why: the plugin uploads the shot
  by itself, about 5 s after Decaid saves it, and the taste and stars CafAI
  writes reach it there (D61), so the shot's page belongs one tap from its
  card. The plugin keeps only its last upload, so the look must come soon
  after the shot; every 3 s for 30 s is streamline's rule.
- **D122. The camera is a file input, never getUserMedia.** The photo comes
  through `<input type="file" accept="image/*" capture="environment">`,
  and ESLint bans `navigator.mediaDevices` and `getUserMedia` ("Camera
  access needs Decaid's per-skin consent; CafAI uses <input type=file
  capture>."). What Decaid does with the input depends on its version.
  Decaid 0.8.8, the pin, has no handler of its own: the WebView plugin's
  own file chooser takes the input, and whether it offers the camera on a
  tablet is not verified (docs/HARDWARE_TEST_PLAN.md section 12, step 8).
  Decaid's `main` (`af4e995`, after 0.8.8: `npm run decaid:watch` listed
  its camera files on 2026-10-10, and docs/audit/2026-10-09/decaid.md
  sections 2.5 and 2.6 read them) brings, for its next release, per-skin
  consent for the live camera through `getUserMedia` (Android, iOS and
  macOS: Ask, Allow or Deny, kept per skin) and, on Android, a file
  chooser of its own that asks for a native confirmation before every
  capture from an input of exactly CafAI's shape (images only, with
  `capture`), whatever the stored camera answer; its dialog reads 'Allow
  "CafAI" to receive images from your camera?', and a video capture is
  refused. Both need the skin installed and served from its own port, so a
  skin served with `--skin-path` gets no camera. Why: one still photo is
  all the intake needs, and a file input takes it the same way in a phone's
  browser, in Decaid 0.8.8 (if its chooser offers the camera) and in the
  next Decaid. A live stream would ask for more than CafAI needs, and needs
  a secure context, which a phone on the network
  (`http://<tablet-ip>:3000`) is not.

## The owner's list after the alignment (2026-10-11)

The owner's notes of 2026-10-11 (D123-D128, D139, D140): tint names, the
drink settings, grinders, ratings in words, a coach that does not lead the
barista's taste, a repository ready for the public, a log of what CafAI
sends and gets, and the coach's credentials following its choice. Released
as 0.1.1.

- **D123. The tints are named for coffee.** Settings > Appearance offers
  Crema, Matcha, Cold Brew, Blueberry, Plum, Cherry and Tamper
  (`src/ui/palette.ts`). Crema and Matcha stay, as do Plum, a common
  tasting note, and Cherry, the fruit coffee grows in. Lagoon became Cold
  Brew (the same cyan, hue 200: iced coffee's cold), Ocean became Blueberry
  (the tasting note of natural Ethiopians; its hue moved from 250 to 265,
  nearer the fruit and off the flow line's blue at 245-250), and Steel
  became Tamper (the same steel grey). The ids follow the names
  (`cold-brew`, `blueberry`, `tamper`); `normalizeTint` in
  `src/storage/settings.ts` reads the old ids (`lagoon`, `ocean`, `steel`)
  as the new ones wherever settings are read (the store, a backup in
  Decaid, an import), so a look saved before keeps its tint and is written
  back under the new id at the next save; an older CafAI reads a new id as
  Crema (D82). The contrast sweep passes for all seven in both modes, its
  worst cases unchanged. A name that wraps on a 320 px phone ("Cold Brew")
  grows down from the top of its cell, so the swatches of a row stay
  level. Why: the owner asked for tints named for coffee and cafés, with
  name and colour agreeing; old ids read as aliases keep every saved look
  without leaving the code with ids that name other colours.
- **D124. Steam, hot water and flush are laid out as the machine row's
  three drinks.** Settings > Steam, hot water and flush
  (`src/ui/settings/DrinkSettingsSection.tsx`) groups its ten settings by
  drink, each under the drink's name and the machine row's icon: the three
  side by side from 600 px wide (a tablet, a phone on its side), stacked on
  a phone, where each setting is one row, its label and then a stepper
  184 px wide (narrower on the narrowest phones, the same for every row of
  a drink). Labels lose the drink and the unit ("Temperature" under
  Steam), and flush lists temperature first, as steam and hot water do. A
  stepper is one outlined field: Less and More fill 30% of it at each end,
  at least 48 px, so a thumb that misses the icon still lands on its button
  rather than in the value, which would open the keyboard, and the icons
  line up from row to row; between them the value in tabular figures with
  its unit beside it, smaller and muted (D81). The value is a spin button
  named for its drink ("Steam time"), its unit in words in the value text;
  Up and Down step it from what is typed, and the two buttons are out of
  the tab order (WAI-ARIA's spin button pattern). One line under the title
  holds the help ("The Steam, Hot water and Flush buttons use these.
  Changes go to Decaid at once.") or, as a status, why the settings cannot
  be changed now ("Reading Decaid's drink settings…", "Connect the DE1 to
  change these.", "Not while the machine is running."), in a space that
  keeps its height. An unknown value is a dash with no buttons; steam off
  in Decaid reads "Off in Decaid" in the field, with no note. Disabled
  values stay in ink-muted; only the buttons fade. A write still on its
  way after 0.4 s says "Saving…" under its field; a failed one says why
  there, as an alert, the field outlined in the error colour and only that
  field put back, so a write of another field that landed meanwhile stays;
  each field numbers its writes, and a failure puts back what Decaid last
  held only when it was that field's newest write, so a slow first tap
  failing after a second one landed changes nothing. The spin buttons say
  their range (`aria-valuemin`, `aria-valuemax`) as they say their value.
  A field disabled while it has focus (the machine started) shows Decaid's
  value again instead of what was typed. What each control writes, and its
  range, are D114's, unchanged. Why: the old section was ten equal fields
  in a two-column grid whose 3/4/3 rows left orphans, so the drinks ran
  together and every label repeated the drink and the unit; the reason
  line came and went above the fields, moving them under a thumb that had
  just started steam; disabled values at MUI's 38% could not be read from
  a step back; a failed write's alert sat at the section's end, off screen
  on a phone; and a dash between a minus and a plus read as a third minus.
- **D125. A grinder Decaid's library lacks is added from Settings or the
  coach's card, only on a tap.** Decaid's own app has no screen for its
  grinder library (no route for one in `lib/src/app.dart` at `af4e995`;
  the README of the DYE2 plugin in Decaid's tree says the core app
  "provides no management UI for these entities"). A fresh Decaid's
  library is empty; grinders come from DYE2's Grinders page (DYE2 is
  bundled and loaded by default), a de1app import, a backup, or another
  skin. Settings > Coach has **Add a grinder** under the grinder fields
  once Decaid answered with its library (not while Decaid cannot be read,
  nor on a Decaid without one, which answers 404). A dialog takes the
  grinder, its burrs and its dial: a numbered dial with its smallest and
  big step, or a list of settings, finest first
  (`src/ui/settings/AddGrinder.tsx`, `addGrinder.ts`). It adds it with
  `POST /api/v1/grinders` (`createGrinder` in `src/api/grinders.ts`; its
  body, 201 and 400 checked against the pinned spec), puts it first in the
  picker and picks it, and Save links it as any pick (D62).
  `addOrFindGrinder` reads the list afresh and takes a grinder with the
  same model, and the same burrs when both say, instead of adding one,
  because Decaid itself takes duplicates. A key in any field is refused,
  never sent (D69). The coach has `offer_grinder`, a UI tool: when the
  barista names a grinder that is not linked, the chat shows what the
  coach heard with **Add to Decaid** and **Not now**
  (`src/ui/chat/parts/GrinderOfferCard.tsx`). Only Add writes: CafAI then
  links the grinder as Settings does (its id, its model as the name, and
  the setting only if it belonged to this grinder: the same id, or the
  same model when none was linked; otherwise the setting is cleared, so
  the coach never turns a new grinder from another's number), writes it to
  the workflow for the next shots (D54), and gives the coach its dial
  (`addGrinder` in `src/app/engine/engine.ts`,
  `docs/briefs/ENGINE_PROTOCOL.md` rule 5b). The card comes alone: an
  `offer_grinder` in the same reply as another card is not shown, and the
  coach is told to offer it again once that card is answered (two offers
  in one reply show the first). While Add runs, the card's "Adding…" is the
  only progress shown. A failed Add says why on the card and waits for
  another tap; typing instead sets the card aside, and nothing is added. **Edit grinders in DYE2**, shown while Decaid runs
  DYE2 (D103), opens DYE2's Grinders page: inside Decaid the WebView keeps
  `localhost:8080/api/v1/plugins/*` in place, as for the Decaid settings
  button, and the page's Done goes back. CafAI never edits or deletes a
  grinder. Grinder replies pass a zod rule (`readGrinderRecord(s)` in
  `src/api/readers.ts`), and `listGrinders` goes through `requestList`, so
  `null` or an empty body fails the read with drift instead of reading as
  no grinders (D95); `getGrinder` reports an unreadable record and still
  reads it as gone. Why: the owner asked where "Grinder from Decaid" comes
  from and how to add a grinder. The step size is what lets the coach say
  how far to turn (D62), and on a fresh Decaid the picker was empty and
  CafAI could only point at DYE2. No skin can open a screen of Decaid's
  (no deep link, route or bridge beyond `exitToDashboard()`), so CafAI
  adds the grinder through the API every skin shares and links the one
  page that edits them. Every skin that lists grinders reads that library,
  so the barista's tap, never the model, decides what goes in, and an
  existing entry is reused rather than duplicated.
- **D126. A shot is rated in words against the shot before it, not with
  stars.** The shot card asks "Compared with your previous shot?" and
  offers five words in one row: **Much worse**, **Worse**, **About the
  same**, **Better** and **Much better** (`ComparisonRating` in
  `src/ui/chat/parts/ShotCard.tsx`). It is a radio group as the stars
  were: one Tab stop (About the same until there is an answer), the arrow
  keys move the answer as in any radio group (right and down to the next
  word, towards Much better; left and up back), every word at least
  48 px tall on the Mode control's raised track, wrapping inside its
  segment on a phone; a later tap changes the answer. The question names
  what the shot is compared with (`baselineFor` in
  `src/app/engine/shotRating.ts`): the shot before it in the bag's chat;
  for a bag's first shot, the last shot CafAI credited to another bag
  ("Compared with your last shot of Red Brick?"); before any shot at all,
  "the coffee you usually enjoy". A card keeps that from the moment it is
  posted (`baseline` on the shot part), and cards made before get one when
  their chat opens. The answer is CafAI's own record, kept where the stars
  were: `rating` (the word and its score) beside `baseline` on the shot
  card in the stored chat, so the export and Decaid's backup carry it, and
  `extras.cafai.verdict` and `extras.cafai.comparedWith` on Decaid's shot
  record. Stars already given stay as they were: such a card says "You
  rated it 4 of 5 stars." and asks nothing, even when an older CafAI
  starred a card this build had rated (the stars win, as a tap there does
  nothing). Decaid's `enjoyment` still gets
  a number, for Decaid and Visualizer, as a running score out of 10: a
  bag's first rated shot is 5, and each later one is the score of the shot
  it was compared with (past shots nobody rated, of the latest rated one)
  plus one step per word, -2 to +2, kept within 1-10 (de1app and Decaid's
  Visualizer plugin read an enjoyment of 0 as a shot nobody rated); old
  stars count as twice their number, as they were written. A verdict this
  build does not know (a newer build's, an edited import) is never told to
  the coach, so one unknown word cannot stop it. A Decaid that rates out of
  100 gets ten times the score (a step of 10), so Visualizer shows the same
  number from either build. A changed answer rewrites its own shot's
  number only, as a changed star did. The score waits in the outbox until
  the scale is known and is dropped out loud when Decaid refuses it, as
  the stars were ("Decaid would not save the rating for this shot: …").
  The coach now hears the verdict: the shot's own event goes before the
  barista can answer, so a block `[event:shot_rated]` (the word in lower
  case and what the shot was compared with) rides in the next user turn
  the engine sends; `untoldRatings` reads what the transcript already
  told, so a verdict is sent once, a changed one again, and a reload loses
  neither (`docs/briefs/ENGINE_PROTOCOL.md` rule 9). The prompt says the
  barista's verdict outranks the numbers and the coach never contradicts
  or explains their taste. Amends D61, D101 and D109, and ends the
  engine-loop brief's "the rating is not sent to the coach", which only
  kept the model protocol unchanged for that feature. Why: the owner wants
  vaguer, relational words instead of a score ("Better, Much better …
  Everything is relational"), and whether this cup beat the last one is a
  judgment a barista makes reliably; Decaid's number is derived from the
  words rather than asked for, and a bag's first shot starts in the middle
  because another coffee's score is not on this bag's scale.
- **D127. The coach leaves the taste to the barista: generic about taste,
  specific about the machine.** The owner asked that the coach never guide
  the barista's taste ("don't tell them 'It should taste…'") and that
  tasting become a learning experience, with descriptors and a Need help?
  option. A prompt section, "Taste is the barista's"
  (`src/coach/prompt.ts`, after the heuristics, before the rules), says the
  coach never says what a shot should, will or ought to taste like, never
  predicts a flavour from a change, never tells the barista their taste is
  wrong and never names a flavour they did not (the taste question's
  options aside). Their own words can be the reason for a change ("You
  found it sharp, so…"), explained by its mechanics (a finer grind slows
  the flow, so the water stays longer and extracts more), and it invites
  them to notice the difference against this shot. The heuristics stay as
  knowledge for choosing a change, never a promise, and the template and
  lever descriptions the model reads say what each profile does at the
  machine (soak, pressure, flow, extraction) and which coffees it suits,
  with no cup to aim for; the barista decides when a shot is good (the
  prompt's "lock it in" waits for them to say they like it, no longer for
  a "balanced, sweet" shot); the taste question offers neutral options,
  never a guess from the numbers; when words and numbers disagree it asks;
  asked for help tasting, it asks one question at a time and never answers
  for them. The tool descriptions (`src/coach/tools.ts`) and schema
  comments (`src/coach/contract.ts`) follow: `expectedEffect` and a
  template's `reason` say what the profile does, never how the cup will
  taste. `proposalWordingError` (`src/coach/validator.ts`) reads everything
  a fresh proposal shows as CafAI's own words: a change's `expectedEffect`,
  `summary` and `tips` (never the `rationale`, which may quote the
  barista), and every template `reason`. It sends back a word that only
  describes a cup (sweeter, acidity, body, tastier, mellower, depth…), a
  described or judged cup or finish ("a lighter cup", "better-tasting",
  "less bite", "notes of…") or a taste foretold ("should taste", "the taste
  should…", "it'll taste"); words with a sense at the machine pass ("a
  smoother pressure curve", "a shorter, stronger shot"), as does a taste
  word right before a machine noun ("the sweet spot", "a balanced
  extraction", "a harsh pressure spike") and a profile's name ("Gentle and
  Sweet"). The engine asks it of what the model just wrote, beside the
  bounds and id errors, as an is_error result that tells the model to call
  the tool again; a proposal recovered after a reload keeps the words its
  card already shows. The change card's last line reads "What it
  changes:", no longer "Expect:" (amends D48). While the taste question is
  open, **Taste words** and **Need help?** join Stats above the composer
  (amends D91). Taste words opens neutral descriptors one group at a time
  (acidity, sweetness, bitterness, body, finish), each with what to notice
  as a question ("Does it make your mouth water?"); a tapped word goes into
  the composer's draft and a second tap takes it out, so nothing is sent
  until Send, and what is sent is the shot's taste (D44, D79). Need help?
  opens "How to taste": what to notice, that there are no wrong answers,
  and that the last shot is the best guide (`src/ui/chat/TasteWords.tsx`,
  `src/ui/chat/tasteWords.ts`). On a phone on its side the prompt row
  scrolls so the composer stays whole. The scripted coach's two voices,
  the demo story and the fixtures follow the rules, and every proposal and
  template reason they write passes the same check. Not built: a button
  asking the coach to walk the barista through tasting, because text sent
  while the taste question is open is kept as the shot's taste (D44), so
  the request would become the taste. Why: a coach that says what a cup
  should taste like teaches its palate, not the barista's, and a promise
  the next cup breaks makes them doubt their own; the check sits on
  `expectedEffect`, the field made for an effect and the one place a word
  list is reliable, while the rationale may quote the barista's own words
  and is left to the prompt.
- **D128. The repository is ready for the public: a README for people who
  install CafAI, the files a public repository needs, and screenshots a
  script retakes.** `README.md` is rewritten for a reader who has never
  seen CafAI: what it is, a status note (every check passed against Decaid
  0.8.8's simulator; never yet on a real machine), screenshots, what you
  need (Decaid 0.8.8 or newer, a scale, an Anthropic API key or CafAI
  Bridge), install from a GitHub release (`justinmwarner/CafAI`) or a zip,
  first run, the phone, privacy, troubleshooting that quotes the app's own
  messages, development, the GitHub settings the workflows need (no
  secrets; the drift watch's labels `decaid-drift`, `decaid-watch-blind`
  and `decaid-read`, which it creates itself; private vulnerability
  reporting), and "Influences and thanks". That section says of each
  project whether CafAI includes its code (Crema, decaid-mcp, Decaid's
  profiles and `ProfileHash`), talks to it (Decaid, DYE2, Visualizer,
  Claude) or learned from it (streamline.js, MSL, decaid-zen), with the
  author, licence and address the project itself states. `NOTICE` now
  credits decaid-mcp (`src/coach/summary/analysis.ts` and four test shots)
  and the Decaid ports (`src/coach/profileId.ts`, `src/coach/profile.ts`,
  `mock/decaid/profiles.ts`), and drops the MimojaCafe licence and "Tcl
  lineage" it could not back (`docs/CREMA_PORT_PLAN.md` section 1.3). New:
  `CONTRIBUTING.md`, `SECURITY.md` (GitHub's private vulnerability
  reporting, no email address), `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/`
  (a bug form that asks for the CafAI and Decaid versions from Settings >
  About, the device and screen size, and the drift report; a feature
  request) and `.github/pull_request_template.md`. `package.json` gains
  `homepage`, `repository` and `bugs`, and `.gitignore` keeps
  `.claude/settings.local.json`, `.claude/worktrees/` and
  `nimbalyst-local/` out. `npm run screenshots`
  (`playwright.screenshots.config.ts`, `e2e/screenshots/readme.shots.ts`,
  port 4176 or `SCREENSHOTS_PORT`, its own build in `dist-screenshots/` so
  it never empties the `dist-mock/` an e2e run serves) plays the demo with
  the page's clock,
  time zone, locale and colour scheme pinned, on a 1280x800 tablet and a
  390x844 phone, and writes six PNGs under 300 KB to `docs/images/`;
  Chromium raster flags, the pointer parked on the top bar and the coach
  scene ending at the thread's end make three runs in a row
  byte-identical. Why: the owner asked for the repository to be ready for
  consumption, with what influenced CafAI credited and setup written down.
  A public reader needs the honest status, the attribution GPL code
  carries, and a way to report problems that never puts a key in a public
  issue, and the pictures must follow the UI without anyone retaking them
  by hand.
- **D139. Settings > Log shows what CafAI sends to and gets from Decaid
  and the coach, raw, and shares it; the key is never in it.** One ring
  buffer in memory (`src/traffic/recorder.ts`), always on, never stored
  or sent: the last 1000 entries and about 4 MB of text, the oldest
  dropped first, one body at most 256 KB. An entry has its time, direction
  (sent or received), channel (Decaid REST, Decaid WebSocket, the coach),
  what (method and path with its query, the channel, or the coach's URL),
  status or outcome, duration, size on the wire, and the raw headers and
  body. It is recorded where the traffic passes, never at call sites:
  `src/api/http.ts` keeps every REST exchange (a retry is another one),
  `src/api/telemetry.ts` every socket CafAI opens (CafAI connecting and
  closing it; it opening, closing with its code, failing; its frames;
  CafAI sends nothing on them), `src/llm/anthropic.ts` each try of a coach
  turn (the request; for a stream the turn as assembled, with its stop
  reason and usage, and the events as they came, up to 32 KB; else the
  error body, "network error", "timeout" or "cancelled") and
  `src/llm/bridgeClient.ts` CafAI Bridge's Test and Find. The mock Decaid
  and the scripted coach answer through the same code, so the log works
  in mock mode and in e2e. Live frames: the machine's, the scale's and
  time-to-ready's channels send several a second, so each keeps at most
  one frame a second and counts the rest on it ("frame +4"); another
  channel keeps every frame that says something new and counts a repeat
  within the second; frames fill at most half the entries, so a busy
  machine never pushes the REST calls and the coach out. Listeners hear of
  changes at most twice a second; the view renders nothing while closed,
  and Settings reads the summary every 2 seconds, never on each entry. A
  recording that fails is dropped, never thrown into the call it watches.
  A body is redacted only up to its cut and a 4 KB margin, so a reply of
  megabytes is never scanned whole, and a cut body keeps nothing of the
  reply it came from alive (a plain slice holds its parent). Redaction
  (`src/traffic/redact.ts`) runs on the way in, whoever records: a header
  with a key, token, secret, password, auth, cookie or session part in its
  name keeps its name and loses its value (a rate limit's "tokens" header
  is a count, not a secret), and that value is taken out of the rest of
  the exchange, headers included, in any case and with any dashes (an echo
  of the key, or of the pairing code as ABCD-EFGH); the key and the code
  CafAI last used (read at start-up, and at each coach request and bridge
  Test) are looked for everywhere, a chat that quotes the code and its
  backup to Decaid included; anything shaped like `sk-ant-…` becomes
  `[key redacted]`; a stream whose events, put together, hold a secret
  keeps none of its events, since the pieces sit in several; a body of a
  call to the key's copy in Decaid (`cafai-key`, D99) becomes "[not kept:
  the API key's copy in Decaid]" unless it has no room for a key (Decaid's
  `null` for no copy); image data and other base64 runs of 1000
  characters or more become their size ("[image, 412 KB]"). Settings >
  Log, after About, says "214 entries since 21:04, 1.2 MB", what the log
  is and that it holds the barista's words, with **Open log**, **Share**,
  **Email**, **Copy** and **Clear**. Open log is a full-screen dialog
  beside the app's screens (`src/ui/settings/LogView.tsx`), so a shot
  that takes the screen under it to the Shot view leaves it open: newest
  first, one line per entry (time, ↑ or ↓, channel, what, status, size),
  200 at a time; filters All, Decaid, Live frames and Coach, a radio group
  the arrow keys move through; a tap opens the raw headers and body in
  monospace, JSON pretty-printed (as it came when that would change a
  long number) and cut at 4,000 characters until **Show all**; **Pause**
  holds the view while the log keeps recording ("Resume (12 new)").
  Share is the Web Share API, a `.txt` file where the browser shares
  files, else the text, shown only where `navigator.share` exists (a
  secure page; never Android's WebView). Email is a `mailto:` link built
  at the tap, subject "CafAI log, <date time>", with the newest entries
  that fit in 8,000 characters, bodies shortened to 600 and never inside
  an emoji, and a line saying what was cut and that Share or Copy has all
  of it; inside Decaid, whose WebView opens only http and https links, it
  is left out and a line says to copy the log instead. Copy is About's
  `copyText`, which works over plain http on the network; in the view its
  text area sits inside the dialog. All three take every entry (as the
  view was paused), whatever the filter shows, under a header: CafAI's
  and Decaid's versions and Decaid's address, the browser, the screen,
  the time range, the count, and that the key and the pairing code are
  never in it. Why: the owner wants to see the raw traffic to debug and
  to confirm things work, and to send it on at once. Recording at the
  choke points means no call can slip past and the mocks are logged too;
  redacting on the way in means no call site can leak the key (D69, D99).
  Coalesced frames keep a Chromium 91 tablet fast and the buffer useful;
  a button that cannot work (Share without the API, Email inside Decaid)
  is left out rather than shown dead, and Copy is the way off a tablet.
  The review before merging found the first build's Email link, built in
  every render, threw on half an emoji and blanked the app; its Copy in
  the view copied nothing over plain http, because the dialog's focus
  trap took focus from a text area outside it, and still said "Copied";
  header values and a secret split across stream events went unredacted;
  and a rate limit's "tokens" header took its count out of the body.
  History's export dialog had the same Copy fault; its fallback text area
  now sits inside that dialog too.
- **D140. The API key and the bridge's address and code take turns with
  where the coach runs.** Settings shows the **Anthropic API key** section
  only while **Where the coach runs** is on Anthropic; with **Claude on my
  computer** it is gone, and the bridge's Address and Code show under the
  choice instead, as they did before (`useShowsApiKey` in
  `src/ui/settings/coachSourceView.ts`, `src/ui/settings/SettingsScreen.tsx`).
  Neither shows until the saved choice has been read, so the wrong fields
  never flash up while Settings opens; without the store (the fakes and
  previews) the coach runs on Anthropic and the key shows. Switching keeps
  what was saved for the other one: a key saved before is there again,
  saved, when the choice goes back. The note "Not used while the coach runs
  on your computer." is gone with the section it sat in. Why: the owner
  asked that the extra field, the `sk-` key or the address and code, flip
  with the radio; two sets of credentials on one screen made it unclear
  which one the coach was using.

### Claude on your computer (2026-10-11)

D123-D129 are left to the work running beside this one; these start at
D130. Design and experiments:
docs/superpowers/specs/2026-10-11-local-claude-design.md.

- **D130. The coach can answer through the owner's own Claude Code and
  Claude plan, via CafAI Bridge (D56, QUESTIONS #2).** `bridge/` is a
  zero-dependency Node program for a Mac, a Windows PC or Linux that speaks
  the Anthropic Messages API on the network and answers it with the `claude`
  command the owner installed and signed in to (Claude Code's headless `-p`
  mode). CafAI talks to it with its own Anthropic provider and a different
  base URL, so streaming, the runner, retries and timeouts are the ones the
  API path uses. The bridge never reads, stores or forwards Claude
  credentials and never calls Anthropic's API itself: Claude Code does,
  unmodified, signed in through Anthropic's own flow. Why: Crema's server
  was Mac only (it looked for `claude` in three Mac folders and started from
  a LaunchAgent) and text only (one flattened prompt, no streaming, tools or
  images), which CafAI's coach cannot use. Claude Code's legal page (read
  2026-10-11) bars developers from collecting or intermediating Claude.ai
  credentials, and does not restrict a user signing in to the unmodified
  Claude Code with their own plan; running that binary, and nothing else,
  keeps the bridge on the right side of it. It is for the owner's own use
  with their own plan, as the bridge's README says; the plan's usage limits
  apply.
- **D131. One live Claude Code process per conversation; tool calls are
  held; anything else is replayed.** The bridge keeps each conversation in
  one `claude -p` process in stream-json mode (stdin open). CafAI's tools
  reach it as an MCP server the bridge serves on 127.0.0.1 (a secret per
  run). When the model calls one, the HTTP reply ends with `stop_reason:
  tool_use` and the MCP call is held until CafAI's next request brings the
  `tool_result`, matched by the tool-use id Claude Code puts in the call;
  the same process then carries on. A request continues a process only
  when its history equals, message by message (fingerprints of text, tool
  ids and results, image hashes), what that process holds. Any other
  request starts a process whose first message replays the earlier turns as
  a transcript. Text that comes with tool results (typed while a card was
  open, a shot that finished) rides along in the last result. At most three
  processes live; an idle or held one closes after 30 minutes, and one for a
  request without tools (the bag photo) as soon as it has answered. A reply
  that breaks off and starts again, a message that never streamed, or 180 s
  without a stream event ends the process with an error, so CafAI never
  shows a reply twice or waits forever; its next request replays. Why: Claude
  Code takes earlier turns only from its own sessions (an `assistant` line
  on stdin is ignored), so a live process is the only way the model keeps
  its own tool calls, thinking and prompt cache across CafAI's stateless
  requests, and a transcript is the only way back after the bridge
  restarts. A held call answered as a plain JSON reply died after about six
  minutes; an SSE answer with a comment every 10 s held for seven and
  delivered, which covers a barista pulling a shot before tapping.
- **D132. The bridge drops thinking blocks and the tool prefix.** Thinking
  blocks never reach CafAI (the remaining blocks are renumbered), tool names
  lose Claude Code's `mcp__cafai__`, and the `caller` field goes. Why: their
  signatures belong to the plan's organisation, so a transcript replayed
  later to the API under a Console key could be refused, and CafAI never
  shows them. CafAI's transcript stays in the API's own shapes either way.
- **D133. A pairing code guards the bridge.** The bridge makes an 8-character
  code at first start (40 bits; `ABCD-EFGH`), and every route but `/health`
  wants it (CafAI sends it where an API key goes). Five wrong codes from one
  address in ten minutes lock that address out for a minute, doubling up to
  fifteen. CORS is open (`*`, Chrome's private-network preflight answered),
  the MCP endpoint answers only 127.0.0.1, and stopping the bridge over HTTP
  is allowed only from its own computer. The code is shown in a terminal and
  by `code`, never written to the log (a log gets attached to bug reports).
  Why: the bridge spends the owner's
  plan and listens on the network; Crema's server took any request, and with
  CORS open any web page could have used it. A code CafAI types once costs
  little; guessing 40 bits at five tries a minute is hopeless.
- **D134. The newest Claude Code wins, and coach runs see nothing of the
  owner's setup.** The bridge looks on PATH and in every usual install folder
  on Windows, macOS and Linux, including the copy the Claude desktop app
  keeps up to date, asks each its version and uses the newest; `--claude`
  overrides. It never runs the desktop app's own executable (also called
  `claude.exe` on Windows), which `--version` would open. Coach runs use
  `--setting-sources ""`, `--tools ""`, `--strict-mcp-config`,
  `--disable-slash-commands`, `--no-session-persistence`, `--permission-mode
  dontAsk` and the coach's prompt from a file, in an empty working folder;
  inherited Claude Code session variables and `ANTHROPIC_API_KEY` are taken
  out of their environment. Why: on this PC WinGet's Claude Code 2.1.126 comes
  first on PATH and hangs on every request, the native install (2.1.251)
  refuses CafAI's default model (Opus 5.5 needs 2.1.280), and the desktop
  app's copy (2.1.295) coaches fine. The owner's hooks, plugins, CLAUDE.md
  and skills would otherwise ride into every coaching turn, and an API key
  in the environment would make Claude Code bill it instead of the plan.
- **D135. Where the coach runs is a setting of this device.** Settings has
  **Where the coach runs**, above the API key: **Anthropic API key** (the
  default, unchanged) or **Claude on my computer**, with the computer's
  address (`http://` and port 8877 added, an IPv4 address stored without
  leading zeros) and the bridge's code (a password field, like the key).
  Both live in their own IndexedDB database, `cafai-coach-source`: never in
  Decaid's backup, never in an export. **Find** tries `127.0.0.1` (Decaid on
  the same computer). **Test** asks the bridge's `/v1/status` with a probe
  turn on the model chosen in Settings and shows one line ("Connected.
  Claude Code 2.1.295, signed in with Claude Max. 26% of the 5-hour limit
  used.") or the bridge's own sentences. While the coach runs on the
  computer, the API key section says it is not used, the model picker says
  its prices do not apply, and the chat's key card asks for the bridge's
  code. The coach and the bag photo go to the bridge through the same
  Anthropic client with its own wording: the bridge's sentences are shown
  as sent, with no "Anthropic rejected" in front. On that path CafAI asks
  again only when the bridge cannot be reached or is busy (503), before
  anything streamed, and waits 30 s for the first byte (the bridge pings at
  once). The engine is untouched: its "has a key" check now asks for what
  the chosen source needs. Mock mode answers `http://127.0.0.1:8877` with
  the scripted coach, so `npm run dev:sim` reaches a real bridge on this
  computer by its network address. Why: the tablet decides where its coach
  runs; the address and code are worth nothing on another device, and the
  code is the only thing between the network and the plan. A plan limit,
  a lockout or a Claude Code that did not answer will not change in two
  seconds, and each retry would start Claude Code again (a 90 s no-answer
  became about four and a half minutes with the API's retries).
- **D136. The bridge is run with `npm run bridge`, and starts at login on
  Windows and macOS.** `serve` (the default) shows the addresses to type
  into CafAI and the code; `start` runs it hidden in the background with a
  log (rolled over at 5 MB), `stop` asks it to shut down over loopback
  (`/v1/shutdown`, a kill only when that fails and the pid file names a
  live bridge on that port), `status` and `doctor` (every Claude Code found,
  the sign-in, one real turn, the port, firewall hints) say what is wrong;
  `code --new` renews the code. `install` starts it at sign-in without admin
  rights: on Windows a shortcut in the Startup folder that runs `start`
  minimized (PowerShell makes it, every path passed in environment
  variables; a Run registry value if that fails), on macOS a LaunchAgent
  (`KeepAlive` only after a crash, so `stop` sticks); on Linux it prints a
  systemd user unit. The flags given to `install` go into what it starts.
  Why: a coach on the computer is only useful if the computer answers
  without anyone opening a terminal each morning; the Startup folder needs
  no admin and no deprecated VBScript, and the window flash at sign-in is
  the price of a plain console program. Tried on this PC: start, status,
  stop and doctor against the real Claude Code, and install and uninstall
  into a scratch Startup folder; not tried: macOS.
- **D137. `npm run bridge` sets itself up, and can run every morning in a
  window.** The first `npm run bridge` in a terminal runs `setup`: Claude
  Code (found, signed in with a plan, one test turn), where CafAI runs (the
  network, or this computer only), when the bridge runs (every morning in a
  window, 05:00-10:00 unless changed, every day or weekdays; always from
  sign-in; or only by hand), whether to keep the computer awake while it
  runs, and on Windows the firewall (an inbound rule for Node.js only with
  the user's UAC approval; a Public network offered as Private, default
  No) with a note when a VPN is up. `setup --yes ...` does the same from a
  script; after setup, no command means serve again. A schedule is a
  Windows Task Scheduler task made without admin (05:00 daily and at
  sign-in, waking the PC, a missed start run late), a macOS LaunchAgent
  with StartCalendarInterval, or printed systemd units. Whatever starts it,
  the bridge runs only inside its `--window` and stops itself at the end;
  `--keep-awake` holds off idle sleep meanwhile (SetThreadExecutionState,
  caffeinate, systemd-inhibit; no admin). Why: the owner wants it ready for
  the morning coffee without a terminal, and checking the window at every
  start, rather than a second task to stop it, makes a missed 05:00, a
  sign-in at 07:00 and a 10:00 slept through all come out right. The task
  runs only while the user is signed in (no stored password, no admin), so
  after an overnight update restart Windows must sign back in by itself
  ("Use my sign-in info to automatically finish setting up after an
  update") or the user signs in once. Tried on this PC (2026-10-11): the
  real task, run by Task Scheduler with a five-minute window, started the
  bridge, which outlived the task's own action (Ready, result 0), answered
  throughout, and stopped itself at the window's end with its keep-awake
  helper; not tried: a real 05:00 wake, a Mac.

### On GitHub (2026-10-11)

- **D138. CI runs on pull requests; every version tag on main is a
  release.** The repository is public at github.com/justinmwarner/CafAI
  (QUESTIONS #9). `ci.yml` runs on pull requests (and by hand), no longer
  on every push to main; that supersedes "runs on every push" in D94. A
  `v*` tag pushed on a commit of main runs `release.yml`: a first job
  checks the tag is on main and names package.json's version, then
  decaid-live (CafAI against the latest Decaid release), the whole check
  and the e2e suite, then the zip is published as a GitHub Release.
  `npm version patch && git push --follow-tags` makes one. Why: the owner
  wants CI on pull requests and a release for every tagged push to main,
  so the tablet's Decaid, which polls GitHub every 12 hours and keys
  updates on the tag, always has the newest tagged build; a tag elsewhere
  publishes nothing.

### Decaid's agent skill (2026-10-11)

D139-D144 are left to the work running beside this one; this starts at D145.

- **D145. Decaid's agent skill comes in verbatim at the pin, behind a CafAI
  skill.** `contract/decaid/skill/` is Decaid's `.agents/skills/decent-app/`
  (33 files: REST and WebSocket recipes, simulated devices, 25 regression
  scenarios) and `contract/decaid/doc/AI_API_NOTES.md` its API notes, byte for
  byte at the pinned commit, outside `.claude/skills/` and `.agents/skills/` so
  that no agent loads Decaid's skill as its own. CafAI's agents load
  `.claude/skills/decaid-runtime/` instead: it maps Decaid's paths and
  commands to CafAI's (the Windows simulator of docs/SIMULATOR.md for
  `sb-dev.sh`, `contract/decaid/spec/` for `assets/api/`, PowerShell and
  Node's own WebSocket for `jq` and `websocat`, `npm run test:decaid` for
  Decaid's completion steps, `drift.ts` for "update the spec"), keeps a
  Decaid that someone else runs read-only, and routes to the files that help
  a client. `npm run decaid:update` brings the docs with the specs (and
  deletes those Decaid dropped), `--check` holds them to `PIN.json`'s hashes,
  and the drift watch lists their changes since the pin in its `decaid-read`
  issue, under their own heading after the code's (`AGENT_DOCS` in
  `scripts/decaid-contract.mjs`, added to `WATCH`). A folder that turned into
  something else, a symlink or a file that is not UTF-8 text stops the update
  as Decaid's change; nothing is written then.
  Why: the skill's facts help a client (gotchas the spec leaves out, mock
  device ids and names, how features behave), but it is written for changing
  Decaid's Flutter code: its description matches most CafAI work, its dev
  loop needs a Flutter checkout and POSIX pipes, and its rule to update the
  spec with the handler would break CafAI's pin. Moving with the pin keeps
  the docs describing the Decaid CafAI is checked against, and nothing a
  third party writes reaches an agent's instructions unread (Decaid changed
  the skill about twice a week from April to October 2026). Not chosen: a
  submodule or subtree (the whole Flutter repository for about 140 KB of
  markdown), links to GitHub (a fetch per lookup), following Decaid's `main`
  (it documents what the pinned release lacks), a pull request opened by a
  bot for every change. Tried (2026-10-11): `npm run decaid:update -- v0.8.8`
  fetched the 34 files byte for byte as Decaid's git blobs at `aab5f93` and
  left the specs and the generated files as they were; an agent given
  Decaid's skill without `decaid-runtime` worked around `sb-dev.sh` and
  `websocat` by itself, but planned to close the Decaid another run was
  using. With it, two agents went straight to the simulator, Node's
  WebSocket, `test:decaid` and `drift.ts`; the first read PowerShell's blank
  rows as no Decaid running, so the skill's check now prints True or False,
  and the second found the running Decaid and kept to reads.

### Steam, hot water and flush views (2026-10-13)

D141-D144 are still left to the work running beside this one; this starts at D146.

- **D146. Steam, hot water and flush take the screen while they run.** When
  the machine starts one, from CafAI's top bar, the group head or Decaid, the
  main pane switches to that drink's view (`#/steam`, `#/hot-water`,
  `#/flush`) with `location.replace` and the 350 ms tap guard, as a shot does
  (D85): not while a field that takes typed text has focus, nor when the view
  is already up; a run already under way when CafAI starts takes it too.
  There is no return of its own: the view stays after the run, and **Go
  back** (shown only once nothing runs, so a wet thumb aiming for Stop in the
  top bar cannot land on it) returns, with `location.replace`, to the screen
  the view took over (the last one that was not a drink's view), or the
  coach. The views are not places in the navigation, and a drink's route is
  never remembered across a reload (`isRemembered`). Stop stays in the top
  bar (D90). Why: the owner's ask ("have the screen go to a different page
  that shows it happening") and answer, offered an 8 s hold and a return
  ("Stay on the view, you can have a Go back button").
- **D147. The view's settings are Settings' steppers, held while anything
  runs.** The stepper and its reads and writes moved out of
  `DrinkSettingsSection.tsx` into `DrinkFields.tsx` and `useDrinkPresets.ts`;
  the stepper takes its arrangement from its parent (one row per setting, or
  side by side with the label over the stepper), because the view's card is
  laid out for its own width, not the window's. Decaid's own steam screen
  changes the steam time (+10 s) and flow while steaming; offered that, the
  owner kept D114's rule, so the steppers show, held, with the reason, and
  come alive the moment the run ends.
- **D148. What the views show, and from where.** One recording of drinks for
  the app (`drinkTrace.ts`, as `shotTrace.ts` for shots): a run is the frames
  in a drink's states (steam with steamRinse, hot water, flush), outside
  React. Its time counts on the machine's timestamps from the first frame
  past heating (`preparingForShot`) and stops while steam is paused or the
  wand purges or rinses; its water is the flow summed over that time. The
  targets come from the machine's live settings (`ws/v1/machine/shotSettings`)
  before Decaid's workflow; the flush has none there. Steam shows the heater
  against its setting, pressure and flow; hot water its flow, the scale and
  the time against its limit, and no live temperature, because during hot
  water `mixTemperature` is not the water's (Decaid's spec); flush its water,
  flow and the group against its target. Done, the readouts become the run's:
  averages over the working frames, and values at the end.
- **D149. The dial, and its motion.** A ring that fills toward the target
  with a tip at its end, ink for steam and the flow's blue for water, over a
  scene that moves only while the machine runs (steam rising from milk, water
  filling under a stream, a shower screen pouring), masked out behind the
  number. The loops stop under reduced motion and when the run ends; the arc,
  the tip and the level ease 250 ms between frames and keep moving under
  reduced motion (at once), because they are readings. Two palette roles,
  `waterWash` and `milkWash`, with ink (7:1) and ink-muted (4.5:1) on both in
  the contrast sweep (worst 4.95:1, light mode, hue 152).
- **D150. The mock runs drinks for their real time or volume.** Steam warms,
  steams for the time set and purges the wand (`puffing`); hot water pours
  until the volume or the time limit, its scale tared at the start and
  weighing it; a flush runs for its time at its flow, the group closing on its
  target; all re-read the workflow every frame, and a workflow PUT that
  changes steam or hot water reaches the mock machine's shot settings and
  their channel, as Decaid's DE1 write does. Before this every drink lasted
  20 frames, about 4 s, whatever was set, which no view of a run could be
  tested against.

### The gap review (2026-10-13)

- **D151. Machine care, overlaid curves, TDS, °F and a wake schedule go on
  the roadmap.** The owner asked what CafAI lacks next to other skins and
  apps, and to add a cleaning guide built on Decent's video. Four passes
  looked: CafAI's own code; the skins and plugins in `.ref/` (streamline,
  MSL, decaid-zen, DYE2, decaid-mcp, Decaid's own screens, Crema); the web
  (de1app's skins and plugins, other skins for Decaid, Visualizer,
  Beanconqueror, other machines' apps); and the video with Decent's docs.
  The largest gap was care: CafAI cannot start the DE1's cleaning,
  descaling or transport cycles, Decaid's own screens cannot either (only
  streamline and MSL can), and no skin for Decaid keeps reminders or shows
  how to clean. From twelve gaps the owner chose the guide, the cycles,
  reminders set by the water, overlaid shot curves, TDS and EY, °F and a
  wake schedule (docs/ROADMAP.md). Not chosen for now: favourites from
  Decaid's profile library (every other skin has a profile picker), steam
  stopped by the milk's weight, statistics, a chime when a shot ends,
  languages, and more detail on the screensaver already listed. Left to
  Decaid, whose screens do them: pairing, calibration, firmware, backups,
  plugins and charging; Home Assistant has its own integrations for
  Decaid. Why: the owner's ask ("break it down to what you do every day,
  week, month, etc. so it's easy to clean without having to find
  everything") and picks.

### The cleaning guide (2026-10-15)

The first machine care item of D151, designed and built on branch
`feat/machine-care` (`docs/superpowers/specs/2026-10-15-machine-care-design.md`).

- **D152. The cleaning guide sits under Settings.** Settings > Machine care
  (`src/ui/settings/CareSection.tsx`, after Steam, hot water and flush)
  links to the Care screen, `#/care` (`src/ui/care/CareScreen.tsx`), while
  the Settings place in the top bar and the Settings tab stay current
  (`placeOf` in `src/ui/router.ts`); a back arrow returns to Settings, and a
  drink's view that takes the screen goes back to "Machine care". The top
  bar keeps its four places. Why: the owner's choice, after the mockup; at
  962 px the bar has 18 px to spare, no room for a fifth place without
  taking every place's label away, and the stats card's due line (the
  reminders item) will be a second way in.
- **D153. One routine at a time, in the address.** Daily, Weekly, Monthly
  and As needed are segments in a tab list (`src/ui/care/CareSegments.tsx`,
  drawn as the Mode control), the chosen one part of the route
  (`#/care/weekly`; `#/care` is Daily; an unknown one is Daily) and
  replaced, not pushed, so Back leaves Care instead of walking through the
  segments. Why: the owner's choice; a routine fits a tablet with little
  scrolling, and the reminders can open the one that is due.
- **D154. Decent's video plays in place only where Decaid lets it.**
  Nothing loads from YouTube until a tap: CafAI draws its own poster, with
  no thumbnail. A tap puts YouTube's player from `youtube-nocookie.com` on
  the page at the moment tapped, playing, made again on every tap. That
  happens outside Decaid and inside it on Android (`videoPlaysInPlace` in
  `src/ui/care/videoPlace.ts`, from Decaid's own `__DECENT_HOST__.platform`,
  now `HostEnvironment.platform`); anywhere else inside Decaid there is no
  poster and every moment is a link to `youtube.com/watch?v=…&t=<s>s`, which
  Decaid opens in the system browser. Outside Decaid links open a new tab.
  Why, tried on 2026-10-15: the player plays from a `localhost` page with
  Decaid's user agent (just `Decent`) in Chromium 153 and in Chromium 91;
  Decaid 0.8.8 for Windows cancelled it and opened YouTube in the browser
  (its log: "Opening external link in system browser:
  https://www.youtube-nocookie.com/embed/…"), because its navigation guard
  (`classifySkinNavigation`) treats a frame as it treats a page; iOS and
  macOS ask the app about frames the same way, while Android's WebView never
  asks about a frame's http(s) loads. Not yet seen on a Decent tablet:
  `docs/HARDWARE_TEST_PLAN.md` section 14.
- **D155. The guide's words follow Decent's pages where the 2022 video
  differs, and say so.** `src/ui/care/careGuide.ts` holds the guide as data,
  each step's sources in a comment beside it, read on 2026-10-15: the video
  and its captions, the quick start, the water, descaling, flow rate and
  steam tip pages, the gasket page and video, the v1.44 blog, the group head
  upgrade video and Decent's app tour. The calls: the daily flush uses
  Flush, which the quick start allows ("Use the Forward Flush x5 preset or
  the Flush button"), so Daily needs nothing but CafAI; the weekly detergent
  is 3 g, as the Forward Flush x5 profile's own notes and the video say,
  with the quick start's tablespoon in a note; Rinza is steamed weekly (the
  quick start's weekly step and the video agree) and soaked, not steamed,
  only after a lot of milk; the tank and the drip tray are weekly, with
  soap, the video's daily wash a note; the group head's parts come off with
  the machine off (the video switches it off at the back too; only its
  description says sleep); three moments come from the captions rather than
  the description: 6:52, 15:04 (the time Decent's own flow rate page links)
  and 21:36. A step that needs a cycle or the cleaning profile says "From
  streamline for now", until the second machine care item. The same reading
  corrected the roadmap: the video is spoken in English, the quick start's
  weekly Rinza is steamed, and the water page's LSI table, keyed to LSI
  rather than ppm, runs from every 100 to every 2,250 shots. The branch's
  review then checked each step against the quick start and the profile's
  notes and put four right: the purge points the wand at the drip tray
  before the burst, the weekly clean runs as the profile's notes run it
  (once with detergent, a Flush until the water runs clear, once without, a
  last Flush of 20 s), the soaked parts are rinsed before they go back, and
  the intake filter step links Decent's page, which shows which of the two
  filters a machine has. Why: the owner's ask, and D151's rule that
  Decent's current docs win.
- **D156. A drink leaves the Care screen where it is while Decent's video
  is open.** While the player is open on Care (after a tap on the poster or
  a moment), a drink starting does not switch to its view:
  `useDrinkFocus.ts` reads `isCareVideoOpen` (`src/ui/care/videoHold.ts`,
  set by `CareScreen.tsx` while its player is open) as it reads the
  barista's typing, and Stop takes the drink's place in the top bar as
  always. With the video closed, a drink takes the screen as anywhere and
  Go back returns to Machine care; a shot still takes the screen (D85).
  Why: the review found that Daily's own steps, a Flush or the wand's rinse
  started from the top bar, closed the video at the moment the barista was
  following it, and Go back reopened Care at the poster, the video's place
  lost, for a view nobody asked for. This changes D146's rule for this one
  case, as typing already did.

### The wake schedule (2026-10-15)

The wake schedule item of D151, built on branch `feat/wake-schedule`.

- **D157. Settings > Sleep and wake edits Decaid's own idle sleep and wake
  schedules.** A section after Steam, hot water and flush
  (`src/ui/settings/SleepWakeSection.tsx`, its reads and writes in
  `usePresence.ts`) reads `GET /api/v1/presence/settings` once each time
  Settings opens and writes Decaid's presence routes at once, with no Save
  (`src/api/client.ts`). CafAI keeps no copy: Decaid stores them and acts on
  them (presence_controller.dart at aab5f93), as for its own Sleep & Wake
  page and streamline's Presence page. No machine is needed to change them,
  as they are Decaid's settings, kept on its device; while none is connected
  the section says Decaid can wake the machine only while it is. Why: the
  owner's pick (D151), so "warm at 06:30 on weekdays" is set without
  leaving CafAI; Decaid wakes the machine while it runs whether CafAI is
  open or not, and a copy in CafAI would drift from what Decaid's own page
  shows.
- **D158. Sleep when idle is the minutes, with Decaid's own switch left
  on.** One switch, Sleep when idle: on while Decaid's `userPresenceEnabled`
  is on and `sleepTimeoutMinutes` above 0, with the minutes under it (1 to
  240, the drink settings' stepper, 5 a step). Off writes 0 minutes,
  Decaid's own "0 = disabled", and leaves `userPresenceEnabled` on; on
  writes the minutes the section last saw above 0 (Decaid's 30 when it saw
  none). A wake time added or turned on while `userPresenceEnabled` is off
  first turns it on at 0 minutes, so the machine still does not sleep by
  itself. The heartbeat's -1, the roadmap's question, is left unused: the
  settings say what is on. Why: Decaid 0.8.8 wakes the machine on its
  schedules whatever `userPresenceEnabled` says (presence_controller.dart:
  478-511), its own page hides the schedules while that switch is off
  (presence_settings_page.dart:126-129), and a Bengle's firmware gets the
  wake windows only while it is on (presence_controller.dart:391-405). On
  at 0 minutes is the one state in which the machine does not sleep by
  itself, the wake times work on a DE1 and a Bengle alike, and Decaid's own
  page shows what CafAI shows; two switches for one idea would ask the
  barista to learn Decaid's model.
- **D159. A new wake time keeps the machine awake for an hour.** The wake
  times are rows, earliest first: the time in 24-hour figures, as CafAI
  writes every time, its days ("Weekdays", "Mon, Wed, Fri") and how long it
  keeps the machine awake, with its own switch at the end; a tap opens a
  dialog with the time as an hour and a minute, two selects (the browser's
  time field shows the device's own clock, "06:00 AM" in US English), the
  seven days (all seven stored as Decaid's every day, as its own page
  stores them) and After waking: Sleep when idle, as usual, or awake for
  30 minutes to 12 hours. A new one starts at Decaid's
  06:00, every day, awake for an hour. Over the rows, when the next one
  wakes the machine ("Next wake: tomorrow at 06:30."). Why the hour: with
  only the idle sleep, Decaid's default 30 minutes, a machine woken at 06:30
  is asleep again at 07:00 when nobody has come to it; Decaid's page and
  streamline start with none, which is how a wake time quietly fails.
- **D160. Waking early enough to be ready is not done.** The roadmap's
  "perhaps" (wake early enough to be ready at the time, from the
  time-to-ready plugin) waits: the dialog says the machine takes a while to
  heat, so set the time a little before coffee. Not yet seen on a real DE1:
  a schedule waking it from Decaid's sleep, and the keep-awake window
  holding the idle sleep off (`docs/HARDWARE_TEST_PLAN.md` section 15). Why:
  time-to-ready's estimate only exists while the machine heats, so the
  wake's time would have to be learned from past mornings, which is its own
  item.

### Putting the cycles off (2026-10-15)

- **D161. Clean, Descale and Transport from CafAI wait.** The owner put the
  machine care item that starts the DE1's cycles off for later, and asked
  that nothing of it be reachable meanwhile. Nothing was: CafAI's commands
  stop at espresso, steam, hot water, flush, sleep and the next step
  (`CommandableState` in `src/api/types.ts`). Two things stay as they were.
  Stop still shows while a cleaning, descale or air purge started on the
  machine or in streamline runs (D97), since a run nobody can stop is worse
  than one CafAI did not start. The cleaning guide's steps that need a
  cycle still send the barista to streamline, now as "From streamline:"
  rather than "From streamline for now:", which promised the item. The
  roadmap keeps the item's research for when it comes back, and the care
  reminders go ahead without it. Why: the owner's call ("I'm not super
  interested in number 1... we can consider it in the future").

### Care reminders (2026-10-15)

The third machine care item of D151, built on 2026-10-15 without the
cycles D161 put off (`docs/superpowers/specs/2026-10-15-care-reminders-design.md`).

- **D-CARE-1. Every step beyond Daily keeps its last time; five of them
  remind.** The Care screen gives each step of Weekly, Monthly and As needed
  its last time and **Mark done** (`src/ui/care/StepCare.tsx`,
  `TRACKED_STEPS` in `src/app/care/careRules.ts`); Daily's four steps have
  neither. Five have a reminder, the dirt and scale nobody sees: the weekly
  clean with detergent, Rinza through the wand, the intake filter, the group
  head's parts and the descale. The tank and drip tray are in plain sight,
  the gasket is looked at while the parts are off, the steam tip waits for a
  clog and the transport for a move: they keep a last time only. Why: the
  owner asked for each step's last time and a quiet line, and the brief for
  "no daily nags"; a tick for a daily habit would be a chore of its own, and
  a reminder for what the barista sees anyway would make the line nag.
- **D-CARE-2. Days decide; shots and steams gate and count; litres are not
  counted.** The weekly clean is due a week after the last, once a shot was
  pulled since, and its line counts the shots; Rinza a week after, once the
  wand steamed since, counting the steams; the intake filter after 14 days
  (V1, or a filter not said) or 30 (V2); the group head's parts after 28 days
  once a shot was pulled (Monthly's "two to four weeks", the quieter end);
  the descale by the water: under 30 ppm never; 30 to 120 ppm, or not said,
  a year or 1,500 shots, whichever comes first; over 120 ppm six months or
  800 shots (`reminderFor`, `descaleReminder`). Decent's water page gives its
  bands in TDS; its LSI table, keyed to the water's LSI, pairs a year with
  1,500 to 2,250 shots and six months with 800 to 1,200, and CafAI takes the
  earlier end of each. The guide's descale line, after the descaling page,
  says every year or two for 30 to 120 ppm; the reminder takes the water
  page's year, the earlier of the two. Counts CafAI does not know let the
  days decide. Why, the roadmap's first check: Decent's own intervals are in
  weeks, months and shots; oils come with shots and milk with steam, so a
  week of neither needs nothing; and litres cannot be counted: Decaid keeps
  no record of a flush or of hot water, and CafAI sees only what runs while
  it is open.
- **D-CARE-3. Counts come from Decaid's totals, one request each, never by
  paging back.** Each step's record (D-CARE-7) keeps Decaid's shot total and
  steam total from when its count began, and the count since is the total
  now less that (`countSince`, `rebaseline`): `GET /api/v1/shots?limit=1`
  answers the total with the newest shot, `GET /api/v1/steams/ids` the
  steams and `GET /api/v1/steams/latest` the newest steam (`listSteamIds` and
  `getLatestSteam` in `src/api/client.ts`, new to CafAI, with their readers,
  the mock and the contract checks). A total that fell (shots deleted,
  another Decaid) starts that step's count again from now, and so does a
  newest record older than the step's start (old ones imported); a Decaid
  without steam records (404) counts Rinza by days alone. The care service
  (`src/app/care/careService.ts`) counts at start, 5 s after a shot or a
  steam ends, when Decaid answers again, when the page comes back into view
  and when the Care screen opens, at most once every 10 s and never during a
  shot, and keeps the last totals on the device (`cafai.care.counts` in
  localStorage) for the stats card's first paint. Why: the roadmap's paging
  back to the last clean has nothing to stop at, since Decaid never saves a
  run of a cleaning profile as a shot (`_persistShotIfNeeded`,
  de1_state_manager.dart:911-917 at aab5f93, skips beverage types cleaning
  and calibrate); and each page of the shot list makes Decaid parse every
  shot's measurements (shot_mapper.dart:14-49), as `GET /api/v1/steams` does
  every steam's (steam_mapper.dart:11-30), where a total is one COUNT and the
  ids one column. On a slow tablet one small request beats pages of curves.
- **D-CARE-4. A step starts over when it is marked done, or when CafAI saw
  the machine's own Clean or Descale run for a minute; Forward Flush x5
  never counts.** **Mark done** sets the step's last time to now, with
  Decaid's totals then (the last ones known after 3 s without an answer),
  and **Undo** puts back the record it replaced, until the page reloads. A
  `cleaning` or `descaling` state seen for at least a minute and then any
  other state, started in streamline or on the machine while CafAI is open,
  marks the weekly clean or the descale done at the last frame seen running
  (`src/app/care/cycleWatch.ts`): the firmware sends no end, a shorter run
  was stopped, and a frame CafAI could not see ends nothing; Undo works for
  it too. A run of Decent's Cleaning/Forward Flush x5 counts for nothing, in
  Decaid's shot list or live. Why: D161 put the cycles off, so CafAI starts
  none, but a Clean or a Descale seen running is the machine saying so, at no
  cost to the barista, and a minute keeps one stopped at once from counting.
  The profile cannot say: Decaid never saves its run as a shot, and Decent's
  quick start uses the same profile for the daily flush with water only, so
  its run says nothing about detergent. Undo, because a mistaken tap on the
  descale would silence it for a year. Nobody has watched a cycle on a real
  DE1 yet: the hardware test plan.
- **D-CARE-5. The water and the intake filter are asked in Settings >
  Machine care, in Decent's words.** Under Cleaning guide
  (`src/ui/settings/CareSection.tsx`): **Your water** (Not sure, Under 30 ppm
  (distilled, RO, very soft), 30 to 120 ppm, Over 120 ppm: the water page's
  TDS bands), **Intake filter** (Not sure, V1 (citric acid), V2 (baking soda))
  and **Remind me on the stats card** (on), each applied at once and kept in
  one `care` block of the settings, left out while it holds the defaults, as
  the key-copy choice is. Not sure reminds as 30 to 120 ppm, and as V1, the
  more often of the two filters. The Care screen's descale and intake filter
  steps say what reminds them and link to Settings ("Set it in Settings",
  "Change it in Settings"), which brings the section into view. Why:
  settings live in Settings, and D152 made the section for this; the Care
  screen stays a reference card to read at the machine; and a not-sure answer
  still reminds, since a missed descale can cost a heater and an extra
  reminder costs a tap.
- **D-CARE-6. The stats card's line names the most overdue step until it is
  marked done; a step never earns the alert under the top bar.** One line at
  the stats card's foot, only while a step is due and the switch is on
  (`src/ui/care/CareDueLine.tsx`): "Weekly clean due: 41 shots since the
  last", or since the day CafAI began counting for a step never marked done.
  The most overdue is the step with most of its interval past, ties in the
  guide's order. It links to the step's routine on the Care screen and brings
  the step into view. No snooze: it stays until the step is marked done or the
  switch is off. Why, the roadmap's second check: the alert under the top bar
  is for what stops the machine working now, or what one tap fixes; a clean
  that can wait days is neither, and on every screen, the Shot view's too, it
  would teach the barista to look past the alert. The stats card is where the
  machine is read, and it shows when a session starts.
- **D-CARE-7. Care's records are an IndexedDB store of their own, in
  Decaid's backup and the export, merged by their last time.**
  `CAFAI_DB_VERSION` 2 adds the `care` store, one record per step (`id`,
  `doneAt`, `by`, `countFrom`, `shotTotal`, `steamTotal`, `updatedAt`); the
  upgrade only adds it. The mirror writes the records as one more key,
  `care`, in namespace `cafai`; the export carries an optional `care` list,
  schema version 1 still, which an older CafAI drops. A merge (an import, a
  restore) keeps the later last done, a step marked done over one never
  marked, and of two never marked the earlier start (`careRecordWins` in
  `src/storage/porter.ts`). Like the bags, they are the device's own: a phone
  and the tablet each keep theirs, and Decaid's copy is the backup, not a
  meeting place. Why: a step's last time is the barista's data, like a bag,
  and must survive what a bag survives; updatedAt cannot decide, since a
  device that lost its storage begins counting afresh, and its new records
  must not outrank the ones the backup brings back.
- **D-CARE-8. Counting starts the first time CafAI looks.** A step never
  marked done gets its record the first time CafAI counts it, with Decaid's
  totals then, so a new install is never due at once; the Care screen says
  "Not marked done yet" with the day counting began ("23 shots since 1
  Oct"). Why: asking when each step was last done would be nine questions
  before the first coffee; counting from the first look is true, and a step
  left alone comes due after one interval.
- **D-CARE-9. The mock Decaid keeps steam records, and saves no shot for a
  cleaning profile, as Decaid does.** Each steaming leaves a record, opened
  on the first frame in steam with the workflow then and kept when the
  machine leaves it (`mock/decaid/steams.ts`, the shot player); the routes
  answer as steams_handler.dart does; `?mockPersist=1` keeps the records
  without their measurements; and a shot of a profile whose beverage type is
  cleaning or calibrate is not saved. Why: the care reminders count steams
  and must not count a cleaning run, and the mock answers as Decaid's Dart
  does.

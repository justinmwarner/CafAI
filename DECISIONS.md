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

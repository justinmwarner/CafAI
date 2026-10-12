# Fresh-eyes review: Decaid alignment and update safety

You are a reviewer who did not write this code. You never fix it: you
report defects, each with evidence, and the integrator fixes them.

CafAI is a chat-first espresso coach that runs as a web skin inside Decaid,
the Decent Espresso app, on tablets mounted on the machine and in phone
browsers. The owner asked for this work:

> I want to audit the whole project and where it is to make sure we're
> following patterns/practices other "skins" for Decaid. I want to make sure
> we're hooked up to all the native things. I'd like to lean on the
> streamline one as that's built by Decent themselves. Additionally I want
> to make sure that updates to Decent do not break us, can we make sure
> w/e is possible for that is in place, ie: type checking, etc.

What was built, and why:
- The spec: `docs/superpowers/specs/2026-10-09-decaid-alignment-design.md`.
- The audit it came from: `docs/audit/2026-10-09/` (streamline, decaid, cafai,
  others, typegen).
- The decisions: DECISIONS.md D93-D122.
- The code: branch `feat/decaid-alignment`; `git diff main...HEAD` and
  `git log main..HEAD`. Skip `contract/decaid/generated/` and
  `contract/decaid/spec/` (generated from, and copied from, Decaid).

References, read-only (never write under `.ref/`):
- Decaid's source: `.ref/decaid`, checked out at its `main` (`af4e995`).
  CafAI is pinned to v0.8.8 (`aab5f93`): read the pinned code with
  `git -C .ref/decaid show aab5f93:<path>`, and compare with `main` where an
  update could matter.
- streamline, Decent's own skin: `.ref/streamline-js`. DYE2: `.ref/dye2`.

What has already been checked, so you need not repeat it: typecheck (with
the contract check), lint, 2916 unit tests, the e2e suite (192 passed, and
one infrastructure failure that passes alone), and against Decaid 0.8.8 on
the Windows simulator all 32 real-Decaid checks with writes and a simulated
shot, `npm run e2e:real`, and the bean card by hand.

## What to report

Defects only: wrong behaviour, a race, data loss, a write that should not
happen, a Decaid change that would break CafAI silently, a key that could
leak, a check that cannot fail, a sentence on screen that says something
false. Not style, naming or taste. For each:

- **Where:** file and line.
- **What is wrong**, in one or two sentences.
- **How it fails:** the concrete inputs, Decaid reply or sequence of taps,
  and what happens. Show the evidence: the code path, Decaid's source at the
  pin, a test you ran.
- **Severity:** critical (breaks the coach, loses data, leaks the key or
  writes to the machine wrongly), important (wrong in a case a barista will
  meet), minor.
- **Fix:** a suggested change, in a sentence.

Verify each finding before you report it: read the code around it, check
Decaid's pinned source, and where you can, write a small test or run an
existing one (`npx vitest run <file>`). Drop what you cannot support. Ten
real findings beat thirty guesses. Say also what you checked and found
sound, in a few lines.

Rules: Windows, Git Bash and PowerShell. Do not edit tracked files. Scratch
tests go under `.verify/` (git-ignored) and are deleted when you are done.
No e2e runs and nothing on ports 4174, 4175, 8080 or 3000 (other runs use
them). Never write or log an API key.

## Areas

Each reviewer takes one area, and may follow a thread into another.

**A. Update safety and the Decaid contract.** `contract/decaid/`,
`tsconfig.contract.json`, `scripts/decaid-contract.mjs`,
`scripts/decaid-watch.mjs`, `scripts/decaid-ci.sh`, `.github/workflows/`,
`src/api/` (client, readers, drift, machineStates, frames, plugins,
pluginData, decaidVersion, live/), `mock/decaid/contract.test.ts`. Does
typecheck fail when Decaid changes a shape CafAI uses, and only then? Does
the watch see a breaking change on `main` or a new release, and does it
fail loudly when it cannot look? Can an exception in `drift.ts` hide a real
change? Are the readers tolerant without turning a change into silent
wrong data (a zero, a false, an empty list that means "none")? Do unknown
machine states fail safe? Is every new call CafAI makes covered by the
contract, the mock's test and the real-Decaid checks?

**B. The engine, the coach and storage.** `src/app/engine/`,
`src/app/adapters.ts`, `src/app/createServices.ts`, `src/coach/`,
`src/llm/`, `src/storage/`. The outbox (refused writes, WriteLater, drops),
the restore's four outcomes, the rating scale probe and its use, the bean
library link (`linkBag`), the bean card and photo flows (`pickBean`,
`skipBeanPick`, `readBagPhoto`, `confirmBag`), the Visualizer watch,
`get_recent_setups`, roast age, the intake's `today`, the key's copy in
Decaid. Look for races between queued and unqueued work, writes that land
on the wrong bag or shot, state lost across a reload, a photo or key that
reaches storage, a tool result the coach could misread.

**C. The UI.** `src/ui/` (machine row, gateway alert, Connect, the
ready-in line, Next step, Settings: About, the key switch, steam, hot
water and flush; chat: the bean card, the confirm card, the shot card's
Visualizer link, `followNewest.ts`, ChatSurface, CoachScreen; History).
Check against DESIGN.md and the spec's sections 5 and 6: states that are
wrong or stuck (loading forever, a button live when it must not be), a
control that writes something nobody typed, the machine's limits (D114),
touch targets and accessible names, layouts at 962x602 and 390x844. You may
build the mock app into `.verify/` (`npx vite build --mode mock --outDir
.verify/dist-mock`) and serve it on port 4180 to look, with Playwright from
the repository's `node_modules`.

# Contributing to CafAI

Thank you for helping. Bug reports, fixes, profile and coaching ideas, and
reports from real machines are all welcome. Please open an issue first for
anything large, so the change and its design can be agreed before you spend
time on it.

## Set up

You need Node 22 (22.22.2 or newer), 24 (24.15 or newer, recommended; CI
runs 24) or 26, and npm. No Decent machine, tablet or API key is needed for
most work: mock mode runs CafAI against a built-in mock of Decaid and a
scripted coach.

```bash
npm ci
npm run dev:mock      # http://localhost:5173 on the mocks; ?mockSpeed=20 hurries the shot
npm run demo          # a dial-in already under way, on its own port (docs/DEMO.md)
```

The README's [Develop](README.md#develop) section lists every script, the
mock's URL switches, and how to work against Decaid's simulator or a real
tablet.

## The checks

Run these before you open a pull request; CI runs the same (`ci.yml`):

```bash
npm run typecheck     # TypeScript, plus the Decaid contract (contract/decaid/)
npm run lint
npm test              # unit and UI tests (Vitest); never calls Anthropic or Decaid
npm run build
npm run release:zip   # builds and validates the skin zip
npm run e2e           # Playwright against the mocks, three tablets and a phone
```

`npm run verify` runs them all in that order. The e2e suite builds the mock
app and serves it on port 4174; `E2E_PORT=4175 npm run e2e` runs beside
another checkout's run.

When you change what the screens look like, run `npm run screenshots` and
commit the pictures it writes to `docs/images/` (the README shows them).

Optional, when your change touches them:

- **Chromium 91**, the WebView of Decent's oldest tablets:
  `npm ci --prefix tools/chrome91` once, then `npm run build:mock`,
  `npm run smoke:chrome91` and `npm run smoke:chrome91:loop`. CI runs them as
  an informational job.
- **A real Decaid:** `npm run test:decaid` against Decaid's simulator, as
  [docs/SIMULATOR.md](docs/SIMULATOR.md) section 6 describes. Against a
  tablet with a real machine, only the read-only checks: never set
  `DECAID_WRITE` or `DECAID_SIM` there.
- **The real Anthropic API:** `npm run test:live` with `ANTHROPIC_API_KEY` in
  the environment (2-3 small calls).

## Rules the code keeps

- **Chromium 91.** The bundle must load in the Chromium 91 WebView of
  Decent's oldest tablets. ESLint bans the browser APIs that engine lacks and
  core-js cannot polyfill (`eslint.config.js`), and the build fails unless its
  target is `chrome91`.
- **One bundle.** Decaid replaces a skin's files in place while it runs, so
  there are no lazily loaded chunks, and the production build has no mocks
  and no service worker.
- **Decaid's replies are read, not trusted.** Every reply goes through a
  reader in `src/api/readers.ts` or `src/api/frames.ts`; anything unexpected
  falls back safely and lands in the drift log (Settings > About).
- **Nobody else's data.** CafAI writes Decaid's key-value store only in its
  own namespaces (`cafai`, and `cafai-key` when the user chooses), never a
  plugin's keys (DYE2, Visualizer), and never the API key, prompts or tokens
  to the console or Decaid's store.
- **The skin id is `cafai`, forever** (`skin.config.json`): it keys the
  skin's saved data in Decaid.
- **Test ids** live in `src/ui/testIds.ts`, shared by the UI and the
  Playwright specs; never inline them.
- **Plain words on screen.** The UI talks like a barista, not like an API;
  [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) describe the voice and
  the visual system.

## The decisions log

[DECISIONS.md](DECISIONS.md) records every design and platform decision, with
its reason and where the evidence lives. A change that settles a question
(how CafAI talks to Decaid, what the coach may change, a new rule for the
UI) gets an entry in the section it belongs to, numbered after the last one:

```markdown
- **D140. A one-sentence title.** What was decided, in plain sentences, with
  the files in backticks. Why: the reason.
```

Facts read from Decaid's code are in [docs/VERIFIED.md](docs/VERIFIED.md)
and `docs/verified/`, with the commits they were read at. Read the entries
near your change before you change it; a decision can be changed, but in a
new entry that says why.

## The Decaid pin and the drift watch

CafAI is checked against one Decaid release, the pin in
`contract/decaid/PIN.json` (v0.8.8 now). `npm run typecheck` compares CafAI's
wire types with that release's REST and WebSocket specs, and every known
mismatch is a recorded exception with the Dart line that proves it.

- If you change a type in `src/api/types.ts`, or a reader, the contract
  checks tell you whether it still fits Decaid's spec.
  [contract/decaid/README.md](contract/decaid/README.md) explains a failing
  check and when an exception is allowed.
- `npm run decaid:watch` runs the same checks against Decaid's latest
  release and its `main`. On GitHub it runs daily and files an issue
  (`decaid-drift`, `decaid-watch-blind` or `decaid-read`); see the README.
- `npm run decaid:update -- <tag>` moves the pin. Do it in a pull request of
  its own, and work through what fails as the contract README says.

## No secrets, no personal data

- Never commit a real API key, token, the bridge's pairing code, a Decaid
  backup, shot data from your own machine, or anything that names a person or
  a home network. Use placeholders: `sk-ant-test`, `192.168.1.42`.
- Environment files (`.env`, `.env.*`) are ignored by git; keep them that
  way. The live test reads `ANTHROPIC_API_KEY` from the environment only.
- Screenshots come from `npm run screenshots` (mock data only), not from your
  own tablet.
- Found a security problem? Do not open an issue: see
  [SECURITY.md](SECURITY.md).

## Pull requests

- One change per pull request, with tests that cover it. Fill in the
  template.
- Commit messages start with what kind of change it is, as in the history:
  `feat:`, `fix:`, `test:`, `docs:`, `chore:`, followed by what changed in
  plain words.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under "Unreleased" for anything
  a user would notice.

## Licence

CafAI is GPL-3.0-only (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). By
contributing you agree that your contribution is licensed the same way. Code
you bring from another project must have a compatible licence; give each
such file a header with `SPDX-License-Identifier: GPL-3.0-only`, a line
naming its origin and copyright holder, and a "Modified for CafAI" line, and
credit the project in NOTICE and the README's "Influences and thanks".

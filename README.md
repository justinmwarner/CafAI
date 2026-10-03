# CafAI

A chat-first AI dial-in coach skin for [Decaid](https://github.com/decentespresso/decaid),
the Decent Espresso app. Tell it about the bag, pick one of the suggested
starting profiles, pull a shot, tap how it tasted, and confirm one change at a
time. Every version of your profile for that bag is kept, with the shot data,
your feedback and the change that led to it.

CafAI is also a complete everyday skin: machine status, espresso, steam,
flush, hot water, sleep/wake, scale tare and a live shot graph, with a way
back to Decaid's dashboard and settings on every screen.

- Skin id: `cafai` (never changes; it keys the skin's saved data in Decaid)
- Runs in Decaid's WebView, down to the Chromium 91 engine of older Decent
  tablets, at 962x602 CSS px and up
- Bring your own Anthropic API key; it stays on the tablet

## How the coach works

1. **New bag.** CafAI asks for origin, roast, process and tasting notes.
2. **Templates.** The coach suggests 2-5 starting profiles with a rough
   confidence. Templates are real Decent profiles (Blooming Espresso,
   D-Flow, Londonium) that declare which fields may change and how far.
3. **v1.** Tap one: CafAI creates "<Bean> v1" and loads it on the machine.
4. **Shot.** Pull a shot. CafAI reads the shot from Decaid, summarizes it
   (aggregates plus a 1-per-second series) and gives the coach named query
   tools to look closer (no code execution).
5. **Feedback.** Tap how it tasted (the last option is always "Other").
6. **One change.** The coach proposes the next version or a manual step such
   as grind, changing one variable at a time. You see a plain-language diff
   and confirm it before anything is uploaded. Undo returns to the previous
   version.

The model can only move declared template levers within their bounds; it can
never change pump type, step order or count, sensors, or exit types.

## Install on a Decent tablet

From a GitHub release:

1. On the tablet, open Decaid's dashboard -> **Skins** -> **+** -> **GitHub
   Release**, and enter this repository (`owner/name`). Decaid picks the
   release's `.zip` asset.
2. Select **CafAI** as the skin.
3. In CafAI, open **Settings** and paste your Anthropic API key.

From a zip you built yourself: run `npm run release:zip`, then use **Skins ->
+ -> ZIP file**, or `POST /api/v1/webui/skins/install/url` with
`{"url": "http://<your-computer>:<port>/cafai-<version>.zip"}`.

To leave CafAI, tap **Exit** (top right). Inside Decaid it returns to the
dashboard, where the Skins page switches skins; in a browser it opens Decaid's
settings page.

## Develop

Requirements: Node 22.12+ (24 recommended), npm.

```bash
npm ci
npm run dev:mock      # the app against the built-in Decaid + Claude mocks
npm run dev           # the app against a real Decaid (see below)
npm run typecheck && npm run lint && npm test
npm run e2e           # Playwright, full loop against the mocks
npm run release:zip   # release/cafai-<version>.zip
```

**Against a real tablet or the Decaid simulator.** CafAI talks to
`http://<page host>:8080`. When the dev server runs on your laptop, point it
at the tablet once in the browser console:

```js
localStorage.reaHostname = '192.168.1.42' // the tablet's IP
```

Decaid's API has open CORS, so `npm run dev -- --host` on a laptop works
against a real machine. Do not run anything on port 3000 on a computer that
also runs Decaid.

**Mock mode** (`npm run dev:mock`, `npm run build:mock`) starts MSW before
the app: a stateful Decaid (REST + WebSockets, a scripted shot that follows
the active profile and stops at the target yield) and a scripted Claude that
follows `docs/briefs/ENGINE_PROTOCOL.md`. `?mockSpeed=20` speeds the shot up.
The production build never contains the mocks or a service worker.

**Tablet viewports.** `dev/tablet.html` frames the app at real Decent tablet
sizes (962x602, 1007x602, 1140x712, 1280x800, 1920x1200, iPad) and injects
safe-area insets.

**Chromium 91.** `npm ci --prefix tools/chrome91` once (it downloads a real
Chromium 91 through puppeteer 9), then `npm run build:mock`, and:

- `npm run smoke:chrome91` loads the app and fails on any page or console
  error;
- `npm run smoke:chrome91:loop` drives the whole coach loop (settings, new
  bag, templates, v1, scripted shot, taste chip, confirmed v2) in that
  engine.

Screenshots land in `tools/chrome91/out/`.

### Layout

| Path | What |
|---|---|
| `src/api` | Decaid REST client, WebSocket telemetry, KV, heartbeat, host/exit |
| `src/coach` | Pure logic: templates and levers, bounded validator, profile hashing, shot summarizer and query tools, prompt |
| `src/llm` | `LlmProvider` interface, streaming Anthropic client (fetch + SSE), tool-loop runner |
| `src/storage` | IndexedDB repositories, local-only key store, export/import, mirror to Decaid's KV store |
| `src/app` | The coach engine, services, app composition |
| `src/ui` | Shell, machine panel, live graph, chat surface, history and settings |
| `mock` | MSW mocks of Decaid and Claude, plus fixtures |
| `e2e` | Playwright specs |
| `docs` | Research, verified platform facts, Crema port plan, workstream briefs |

Design and platform decisions are in [DECISIONS.md](DECISIONS.md); open
questions in [QUESTIONS.md](QUESTIONS.md); verified platform facts, with the
source commits they were read from, in [docs/VERIFIED.md](docs/VERIFIED.md).

## Privacy

- Your Anthropic API key is stored only in this skin's local browser storage
  on the tablet. It is never sent to Decaid, never written to Decaid's
  key-value store, never included in exports, and never logged.
- Coach data (bags, versions, shot summaries, feedback) is stored in the
  skin's IndexedDB and mirrored to Decaid's key-value store (namespace
  `cafai`) so it survives a browser-storage reset. Export it any time as JSON
  from History.
- Calls go straight from the tablet to `api.anthropic.com`.

## Credits and license

CafAI is licensed under the GNU General Public License v3.0 only
(GPL-3.0-only); see [LICENSE](LICENSE) and [NOTICE](NOTICE).

- **[Crema](https://github.com/yarneo/crema)** by Yarden (yarneo), GPL-3.0.
  CafAI ports Crema's non-UI logic (Decaid client and WebSocket handling,
  profile handling and its required-field fixes, shot curve analysis, provider
  calls, settings mirroring, safe-area handling, the tablet harness, release
  tooling) together with the tests that cover it. Ported files say so in
  their headers. Thank you for the hard-won fixes.
- **MimojaCafe** (de1app skin), GPL-3.0: Crema began as a fork of it, and part
  of that lineage lives on in the ported logic.
- **Decent Espresso**: the coach templates are bundled Decaid profiles
  (Blooming Espresso, D-Flow / default, Londonium), GPL-3.0; Decaid's API
  documentation made the client possible.
- The community skins **streamline-js**, **MSL**, **decaid-zen**, the **DYE2**
  plugin and **decaid-mcp** (shot-analysis definitions) informed the
  platform rules.

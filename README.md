# CafAI

A chat-first AI dial-in coach skin for [Decaid](https://github.com/decentespresso/decaid),
the Decent Espresso app. Tell it about the bag, pick one of the suggested
starting profiles, pull a shot, tap how it tasted, and confirm one change at a
time. Every version of your profile for that bag is kept, with the shot data,
your feedback and the change that led to it.

CafAI is also a complete everyday skin: espresso, steam, flush and hot water
from a row in the top bar (the one running turns into Stop), a live card in
the chat with the machine's state, temperatures, water, scale (with tare),
the loaded profile and sleep/wake, and a live shot graph, with a way back to
Decaid's dashboard and settings on every screen. It opens on the chat, with
no graph and no machine panel: the card is the chat's newest entry until the
chat moves on, and the Stats prompt brings it back. When a shot starts, the
screen turns into a big live graph by itself, and the coach comes back once
it has read the shot. It has a tablet and a phone layout, and a look of your
own: dark, light or following the device, in one of seven tints or any hue.

- Skin id: `cafai` (never changes; it keys the skin's saved data in Decaid)
- Runs in Decaid's WebView, down to the Chromium 91 engine of older Decent
  tablets, at 962x602 CSS px and up (an older engine gets a warning, and a
  page with a way back to Decaid if CafAI cannot start at all), and in a
  phone's browser on the same network (the phone layout)
- Bring your own Anthropic API key; it stays on the device you enter it on

## How the coach works

1. **New bag.** CafAI asks for origin, roast, process and tasting notes.
2. **Templates.** The coach suggests 2-5 starting profiles with a rough
   confidence. Templates are real Decent profiles (Blooming Espresso,
   D-Flow, Londonium, Rao Allongé, Gentle and Sweet) that declare which
   fields may change and how far.
3. **v1.** Tap one: CafAI creates "<Bean> v1" and loads it on the machine.
   v1 stops at the profile author's ratio times the dose set in Decaid (18 g
   when there is none), and the chat says so. CafAI says "Loaded" only once
   Decaid confirms the machine holds the profile.
4. **Shot.** Pull a shot. CafAI reads the shot from Decaid, summarizes it
   (aggregates plus a 1-per-second series) and gives the coach named query
   tools to look closer (no code execution).
5. **Feedback.** Tap how it tasted (the last option is always "Other"), and
   rate the shot with stars if you like. Both go to the shot's record in
   Decaid, so they show there and in Visualizer.
6. **One change.** The coach proposes the next version or a manual step such
   as grind, changing one variable at a time. You see a plain-language diff
   and confirm it before anything is uploaded. Undo returns to the previous
   version. Link your grinder from Decaid's grinder library in Settings and
   grind moves come with the new setting worked out on its own steps.

The model can only move declared template levers within their bounds; it can
never change pump type, step order or count, sensors, or exit types.

## Screens and looks

- **Tablet** (800 x 500 CSS px and up, every Decent tablet): a top bar with
  Coach, Shot, History and Settings, the machine row (Espresso, Steam, Flush
  and Hot water; the one running turns into Stop in its place), Decaid
  settings and Exit, and the coach across the whole width under it. The chat
  opens with the live stats card (state, temperatures, water, scale with
  Tare, the loaded profile, Sleep); it goes once the chat moves on, and
  **Stats** above the composer brings it back. Shot opens the graph. When a
  shot starts, the screen becomes the Shot view by itself: a big timer,
  pressure, flow, weight and weight flow, the graph, and a note from the
  coach saying it is watching. When the shot's card reaches the chat, the
  coach comes back by itself; the top bar and Stop never move. Problems
  (not connected, Decaid out of reach, water to refill, a failed command)
  show in one slim alert under the top bar while they last.
- **Phone** (anything smaller): one screen at a time, with Coach, Shot,
  History and Settings tabs at the bottom (a rail at the side when the phone
  lies down) and the machine row as icons in the top bar. The chat has the
  same stats card and Stats prompt. A shot opens the Shot tab with the big
  graph; on the Coach tab a live strip shows the time, weight and pressure
  and opens it. A phone opens CafAI at `http://<tablet-ip>:3000`; its
  browser storage is its own, so the API key is entered again there (bags
  and the look come back from Decaid's key-value store).
- **Settings > Appearance**: Dark, Light or Auto (follows the device), and a
  tint: Crema, Matcha, Lagoon, Ocean, Plum, Cherry, Steel, or any hue from the
  slider. Every colour comes from the tint (in OKLCH, written out as plain
  hex for Chromium 91) and every pair of palette colours the screens use is
  tested for WCAG AA contrast at every hue; the shot graph keeps Decent's colours
  (pressure green, flow blue). The look is saved with the other settings.
  [DESIGN.md](DESIGN.md) describes the visual system.

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

Requirements: Node 22.22.2+ or 24.15+ (24 recommended; jsdom 30, used by the UI tests,
needs one of these), npm. Older Node 24 releases run the suite with an engine warning.

```bash
npm ci
npm run dev:mock      # the app against the built-in Decaid + Claude mocks
npm run dev           # the app against a real Decaid (see below)
npm run dev:sim       # a real Decaid with the scripted Claude, no API key (docs/SIMULATOR.md)
npm run typecheck && npm run lint && npm test
npm run e2e           # Playwright against the mocks, on three tablets and a phone
                      # (962x602, 1280x800, 1920x1200; a 390x844 phone upright and on its side)
npm run release:zip   # release/cafai-<version>.zip (with LICENSE, NOTICE and the font licences)
```

**Against the real Anthropic API (opt-in).** `npm test` never calls the API.
To check CafAI's own client, prompt and tools against it (2-3 calls on the
default model), run `ANTHROPIC_API_KEY=<your key> npm run test:live`. Add
`LIVE_ALL_MODELS=1` to also try every model in Settings (one tiny call each),
or use `LIVE_DRY_RUN=1` to run the same checks against the scripted fake with
no key. Without a key the suite is skipped. The key is read from the
environment only and never logged or written anywhere.

**Against Decaid's simulator.** Decaid can simulate a machine and scale on
your computer. [docs/SIMULATOR.md](docs/SIMULATOR.md) walks through it on
Windows, with the real coach (`npm run dev`) or the scripted one
(`npm run dev:sim`), and says what the simulator cannot test.

**Against a real tablet.** CafAI talks to `http://<page host>:8080`. When the
dev server runs on your laptop, point it at the tablet once in the browser
console:

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
`?mockDecaid=0` starts only the scripted Claude, so every Decaid call goes to
a real Decaid (`npm run dev:sim` opens it). The production build never
contains the mocks or a service worker.

**The demo.** `npm run demo` opens CafAI as it looks in use, on the mocks and
on its own address (localhost:5175): two bags, every kind of card the coach
shows, and one open "How did it taste?" to answer, with no Decaid and no API
key. Each load starts it over. [docs/DEMO.md](docs/DEMO.md) says what is on
screen and what each answer does.

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
| `src/ui` | Shell, machine row, stats card and alert, live graph, chat surface, history and settings |
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
- Your taste answer and star rating for a shot are also written to that
  shot's record in Decaid (notes and enjoyment), which Decaid may upload to
  Visualizer if you set that up. Notes you wrote yourself are never
  overwritten.
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
  (Blooming Espresso, D-Flow / default, Londonium, Rao Allongé, Gentle and
  Sweet), GPL-3.0; Decaid's API documentation made the client possible.
- **[Figtree](https://github.com/erikdkennedy/figtree)** by Erik Kennedy,
  SIL Open Font License 1.1 (LICENSE-FIGTREE.txt), is CafAI's typeface;
  Roboto's arrows (LICENSE-ROBOTO.txt) fill in the few glyphs it lacks.
- The community skins **streamline-js**, **MSL**, **decaid-zen**, the **DYE2**
  plugin and **decaid-mcp** (shot-analysis definitions) informed the
  platform rules.

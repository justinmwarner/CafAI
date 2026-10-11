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
- Bring your own Anthropic API key; it stays on the device you enter it on,
  unless you choose to keep a copy in Decaid (see Privacy)

## How the coach works

1. **New bag.** The chat opens on "Which coffee is it?": the coffees in
   Decaid's bean library, newest roast first, then **Photo of the bag** and
   **Something else**. Pick one and CafAI fills in the bag (name, roaster,
   origin, process, notes, roast level and roast date) and links it to that
   batch. Take a photo and the coach's model reads the label into a card
   you correct and confirm. Or tap Something else, or just type, and
   describe the coffee: origin, roast, process, tasting notes, the roast
   date if the bag has one. A bag the coach saved or a photo you confirmed
   is added to Decaid's bean library (reusing a bean with the same roaster
   and name, and its batch with the same roast date), and every load names
   the bag's batch, name and roaster in Decaid, so its shots carry them.
   The coach knows how old the coffee is; for a coffee picked from the
   library, days its batch spent in a freezer do not count. When Decaid's
   DYE2 plugin recorded setups for this
   coffee, or an earlier roast of it, the coach can read them (it never
   changes them) and start from what you did before.
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
   Decaid, so they show there and in Visualizer. The stars go out on the
   rating scale your Decaid keeps (0-10, or 0-100 on older builds): CafAI
   asks it. When Decaid's Visualizer plugin has uploaded the shot, its card
   links to the shot's page (**On Visualizer**), and History keeps the
   link.
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
  (not connected, Decaid out of reach, water to refill, a failed command,
  Decaid set to leave stopping shots to the skin, a scale that dropped)
  show in one slim alert under the top bar while they last, with a button
  where one tap fixes them.
- **Phone** (anything smaller): one screen at a time, with Coach, Shot,
  History and Settings tabs at the bottom (a rail at the side when the phone
  lies down) and the machine row as icons in the top bar. The chat has the
  same stats card and Stats prompt. A shot opens the Shot tab with the big
  graph; on the Coach tab a live strip shows the time, weight and pressure
  and opens it. A phone opens CafAI at `http://<tablet-ip>:3000`; its
  browser storage is its own, so the API key is entered again there, unless
  you keep a copy in Decaid (bags and the look come back from Decaid's
  key-value store).
- **Fixes in the alert.** When the machine is not connected, the alert has
  **Connect DE1** (and **Connect scale** when the scale is missing too);
  when only the scale dropped while the machine is awake, **Connect scale**.
  A Connect looks for devices without connecting them, then connects only
  the one you asked for, Decaid's preferred one first, so the other is never
  disturbed. After the machine wakes, CafAI also looks for a missing scale
  once by itself. When Decaid's gateway mode is Full, Decaid leaves stopping
  at the target weight to the skin, and CafAI does not stop shots, so they
  would run past it: the alert says so, and **Let Decaid stop shots** sets
  Decaid to Tracking. CafAI never changes Decaid's settings without that
  tap.
- **Heating.** While the machine warms up, the stats card says Heating, not
  Ready, and when Decaid's time-to-ready plugin is loaded it adds "Ready in
  about 3 min" at the end of that line.
- **Next step.** During a shot whose profile has another step, the Shot view
  has **Next step** under the graph: one tap moves the shot on one step.
- **Which coffee is it?** A new bag's chat opens on this card, shown from
  its top: up to 8 coffees from Decaid's bean library (newest roast first,
  each with its roaster, its roast date and **Use this**), then **Photo of
  the bag** and **Something else**. The card is there at once ("Looking in
  Decaid's beans…") and the coffees fill in; the photo and Something else
  work meanwhile, and without Decaid. Typing in the chat instead closes it.
  The photo opens the camera or the device's picker (what a Decent tablet
  offers depends on the Decaid version: docs/HARDWARE_TEST_PLAN.md section
  12), and what the coach's model reads on the label lands in **Check the
  bag's details**, every field editable, with **Confirm**.
- **On Visualizer.** With Decaid's Visualizer plugin loaded and set up, a
  shot's card links to the shot's page on visualizer.coffee once the plugin
  has uploaded it (CafAI looks for 30 s after the card lands), and
  History's shot rows keep the link. Decaid opens it in the system browser.
- **Settings > Appearance**: Dark, Light or Auto (follows the device), and a
  tint: Crema, Matcha, Lagoon, Ocean, Plum, Cherry, Steel, or any hue from the
  slider. Every colour comes from the tint (in OKLCH, written out as plain
  hex for Chromium 91) and every pair of palette colours the screens use is
  tested for WCAG AA contrast at every hue; the shot graph keeps Decent's colours
  (pressure green, flow blue). The look is saved with the other settings.
  [DESIGN.md](DESIGN.md) describes the visual system.
- **Settings > Anthropic API key**: the key, and **Keep my API key in
  Decaid** (off by default; see Privacy for what it means).
- **Settings > Steam, hot water and flush**: the presets Decaid keeps for
  the machine row's Steam, Hot water and Flush (steam temperature, time and
  flow; hot water temperature, volume, time and flow; flush time,
  temperature and flow), with steppers, within what the DE1 can hold (hot
  water at most 255 ml; steam 135-160 °C, 165 on a Bengle). A value goes to
  Decaid only when you change it, and never while the machine runs. Steam
  that is off in Decaid shows Off; turning it on or off stays in Decaid.
- **Settings > About**: CafAI's version, and the Decaid you run next to the
  one CafAI was checked against ("Decaid 0.9.0 (CafAI was verified with
  0.8.8)", with a note when yours is older); anything Decaid sent that
  CafAI did not expect, with **Copy report** (routes and field names only,
  never your notes or the key); and when CafAI last backed up to Decaid.

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
                      # typecheck includes the Decaid contract (contract/decaid/)
npm run e2e           # Playwright against the mocks, on three tablets and a phone
                      # (962x602, 1280x800, 1920x1200; a 390x844 phone upright and on its side)
npm run release:zip   # release/cafai-<version>.zip (with LICENSE, NOTICE and the font licences)
npm run decaid:watch  # would Decaid's latest release or main break CafAI?
npm run decaid:update -- v0.9.0   # move the pin to another Decaid release
npm run test:decaid   # CafAI against a running Decaid (needs DECAID_URL; see below)
npm run e2e:real      # CafAI opened from a running Decaid's port 3000
```

**Against Decaid's API.** CafAI is checked against Decaid **v0.8.8**
(`aab5f93`), the pin in `contract/decaid/PIN.json`. `npm run typecheck`
compares CafAI's wire types with Decaid's own specs at that release (73
checks), and every place where the spec is wrong and CafAI follows Decaid's
code is a recorded exception with the Dart line that proves it.
[contract/decaid/README.md](contract/decaid/README.md) says how to read a
failing check and how to move the pin (`npm run decaid:update -- <tag>`).
`npm run decaid:watch` runs the same checks against Decaid's latest release
and its `main`, and lists the Decaid files CafAI depends on that changed
since the pin (exit 0: nothing breaks; 1: a check fails; 2: GitHub could not
be reached; 3: the watch broke; `--report <file>` saves the report;
`GH_TOKEN` raises GitHub's rate limit). On GitHub,
`.github/workflows/decaid-watch.yml` runs it daily and opens a
`decaid-drift` issue when a check fails, and
`.github/workflows/decaid-live.yml` starts Decaid's Linux release headless
with a simulated machine and scale (`scripts/decaid-ci.sh`) and runs
`test:decaid` and `e2e:real` against it, daily and before every release; a
release also needs `npm run e2e`. This repository is not on GitHub yet, so
those workflows have not run.

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
(`npm run dev:sim`), and says what the simulator cannot test. Its section 6
runs CafAI's checks against it: `DECAID_URL=http://localhost:8080 npm run
test:decaid` reads, `DECAID_WRITE=1` adds CafAI's writes (each put back),
`DECAID_SIM=1` a simulated shot, and `DECAID_REQUIRE=1` makes a check that
cannot run fail instead of skip. The writes refuse to run when a real
machine is connected. `npm run e2e:real` opens CafAI from Decaid's port 3000
and checks it is ready, connected and live.

**Against a real tablet.** CafAI talks to `http://<page host>:8080`. When the
dev server runs on your laptop, point it at the tablet once in the browser
console:

```js
localStorage.reaHostname = '192.168.1.42' // the tablet's IP
```

Decaid's API has open CORS, so `npm run dev -- --host` on a laptop works
against a real machine. Do not run anything on port 3000 on a computer that
also runs Decaid.

To check what the tablet's Decaid sends against what CafAI expects, run
`DECAID_URL=http://192.168.1.42:8080 npm run test:decaid` with nothing else
set: it only reads, so it is safe on a tablet. Never add `DECAID_WRITE` or
`DECAID_SIM` against a real machine.

**Mock mode** (`npm run dev:mock`, `npm run build:mock`) starts MSW before
the app: a stateful Decaid (REST + WebSockets, a scripted shot that follows
the active profile and stops at the target yield) and a scripted Claude that
follows `docs/briefs/ENGINE_PROTOCOL.md`. The mock's bean library holds two
coffees, Red Brick (roasted 9 days ago) and Ethiopia Chelchele (30 days ago,
12 of them in the freezer); DYE2 has setups for the first; every plugin is
loaded; and the Visualizer plugin "uploads" each shot a few seconds after it
is saved. The scripted Claude reads any bag photo as Kiambu AA from Square
Mile. `?mockSpeed=20` speeds the shot up.
`?mockDecaid=0` starts only the scripted Claude, so every Decaid call goes to
a real Decaid (`npm run dev:sim` opens it). `?mockGateway=full` starts
Decaid in gateway mode Full, `?mockEnjoyment=100` keeps ratings 0-100 like
Decaid 0.8.6, `?mockSlowWorkflow=<ms>` delays the workflow PUT and
`?mockSlowWorkflow=503` answers it 503 after 30 s without applying it, as
Decaid v0.8.8 does, and `?mockPlugins=none` loads no plugin. The production
build never contains the mocks or a service worker.

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
| `src/api` | Decaid REST client, WebSocket telemetry, KV, heartbeat, host/exit; the readers that check each reply, and the drift log; what Decaid's plugins leave (DYE2's setups, Visualizer's last upload) |
| `src/coach` | Pure logic: templates and levers, bounded validator, profile hashing, shot summarizer and query tools, roast age, prompt |
| `src/llm` | `LlmProvider` interface, streaming Anthropic client (fetch + SSE), tool-loop runner, the one request that reads a bag photo |
| `src/storage` | IndexedDB repositories, local-only key store, export/import, mirror to Decaid's KV store |
| `src/app` | The coach engine, services, app composition |
| `src/ui` | Shell, machine row, stats card and alert, live graph, chat surface, history and settings |
| `mock` | MSW mocks of Decaid and Claude, plus fixtures |
| `contract/decaid` | Decaid's specs at the pinned release, the types generated from them, and the checks `npm run typecheck` runs, with the recorded spec errors |
| `e2e` | Playwright specs |
| `e2e-real` | The Playwright check against a running Decaid (`npm run e2e:real`) |
| `scripts` | The release zip, the Decaid contract and drift watch, and the headless Decaid for CI |
| `docs` | Research, verified platform facts, audits, Crema port plan, workstream briefs |

Design and platform decisions are in [DECISIONS.md](DECISIONS.md); open
questions in [QUESTIONS.md](QUESTIONS.md); verified platform facts, with the
source commits they were read from, in [docs/VERIFIED.md](docs/VERIFIED.md);
Decaid's API as CafAI is checked against it, in
[contract/decaid/](contract/decaid/README.md).

## Privacy

- Your Anthropic API key is stored in this skin's local browser storage on
  the device you enter it on. It is never included in exports or in CafAI's
  backup in Decaid (namespace `cafai`), and never logged.
- **Keep my API key in Decaid** (Settings, under the key; off by default)
  also keeps a copy in Decaid's key-value store, in a namespace of its own
  (`cafai-key`), so the key survives a Decaid update or a cleared browser.
  What that means: any device on your network can read Decaid's store,
  Decaid's backups include it, and any browser that opens CafAI without a
  key of its own (a phone, say) takes the copy. Turning the switch off
  deletes the copy, and so does **Forget key** (a key you save later is
  copied again while the switch is on). If Decaid cannot be reached then,
  Settings says Decaid still has its copy: turn the switch off once Decaid
  is back.
- Coach data (bags, versions, shot summaries, feedback) is stored in the
  skin's IndexedDB and mirrored to Decaid's key-value store (namespace
  `cafai`) so it survives a browser-storage reset. Export it any time as JSON
  from History.
- A photo of a bag goes to Anthropic once, in a request of its own, to read
  the bag's details. CafAI keeps no copy (not on the device, not in Decaid,
  not in the chat or an export), the request is not written to Anthropic's
  prompt cache, and the details read from it are saved only once you
  confirm them.
- When the coach saves a bag's details, or you confirm a photo's, CafAI
  adds the coffee to Decaid's bean library (a bean and a batch, or the ones
  already there; it never edits or deletes one); a coffee you pick from the
  library is linked as it is. Every profile load writes the bag's name,
  roaster and batch into Decaid's workflow, so Decaid keeps them in each
  shot's record, which is what Visualizer gets if you upload there.
- The coach may read the setups Decaid's DYE2 plugin recorded for the
  coffee (grind, dose, profile), which then go to Anthropic with the rest
  of the conversation. CafAI never writes DYE2's data.
- Your taste answer and star rating for a shot are also written to that
  shot's record in Decaid (notes and enjoyment), which Decaid may upload to
  Visualizer if you set that up. Notes you wrote yourself are never
  overwritten.
- Calls go straight from the tablet to `api.anthropic.com`.
- The report in Settings > About names Decaid's routes and fields and what
  was wrong with them, never your notes, your coffee or the key.

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

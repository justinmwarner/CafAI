# CafAI

[![CI](https://github.com/justinmwarner/CafAI/actions/workflows/ci.yml/badge.svg)](https://github.com/justinmwarner/CafAI/actions/workflows/ci.yml)

A chat-first AI dial-in coach skin for [Decaid](https://github.com/decentespresso/decaid),
the app for Decent Espresso machines. Tell it about the bag, pick one of the
suggested starting profiles, pull a shot, tap how it tasted, and confirm one
change at a time. Every version of your profile for that bag is kept, with
the shot data, your feedback and the change that led to it.

CafAI is also a complete everyday skin: espresso, steam, flush and hot water
from the top bar, a live card with the machine's state, a big live shot
graph, a tablet and a phone layout, and a look of your own. It follows the
patterns of Decent's own skin, streamline.js, and began as a port of Crema's
logic; see [Influences and thanks](#influences-and-thanks).

![The coach on a 1280x800 tablet: the barista tapped "Sour / sharp", the coach read the pressure curve and proposes one change, 1 °C hotter, to confirm](docs/images/tablet-coach.png)

- Skin id: `cafai` (never changes; it keys the skin's saved data in Decaid)
- Runs in Decaid's WebView, down to the Chromium 91 engine of older Decent
  tablets, at 962x602 CSS px and up (an older engine gets a warning, and a
  page with a way back to Decaid if CafAI cannot start at all), and in a
  phone's browser on the same network (the phone layout)
- Bring your own Anthropic API key; it stays on the device you enter it on,
  unless you choose to keep a copy in Decaid (see [Privacy](#privacy)). Or
  let the coach answer through your own Claude Pro or Max plan, with CafAI
  Bridge on your Mac or Windows PC: no API key, nothing billed per call (see
  [Claude on your computer](#claude-on-your-computer-no-api-key))

**Status.** CafAI 0.1.0 is new. It is checked against Decaid's own API specs
and has passed every check against Decaid 0.8.8 running its simulated
machine and scale (2026-10-10), but it has not yet been used on a real
Decent machine: [docs/HARDWARE_TEST_PLAN.md](docs/HARDWARE_TEST_PLAN.md) is
the plan for that first session. Keep an eye on the machine when you try
it, and please [report](https://github.com/justinmwarner/CafAI/issues) what
you see.

## Contents

- [Screenshots](#screenshots)
- [What you need](#what-you-need)
- [Install](#install)
- [First run](#first-run)
- [How the coach works](#how-the-coach-works)
- [Screens and looks](#screens-and-looks)
- [On a phone](#on-a-phone)
- [Claude on your computer (no API key)](#claude-on-your-computer-no-api-key)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [Develop](#develop)
- [Project layout](#project-layout)
- [Decisions and docs](#decisions-and-docs)
- [Influences and thanks](#influences-and-thanks)
- [License](#license)

## Screenshots

From the built-in demo (`npm run demo`, no machine needed); `npm run
screenshots` takes them again.

| The big shot graph, from a shot's card | History: every version, its change and its shots |
|---|---|
| ![The shot view on a tablet: pressure, flow, weight and weight flow over a 60 s Blooming Espresso shot](docs/images/tablet-shot.png) | ![History on a tablet: Kiambu AA's versions v4 (active), v3 (undone) and v2, each with its change and shots](docs/images/tablet-history.png) |
| **Settings > Appearance: Light, in Matcha** | **On a phone: the coach and the shot** |
| ![Settings on a tablet in the Light mode with the Matcha tint: the mode, seven tints and a custom hue](docs/images/tablet-settings.png) | <img src="docs/images/phone-coach.png" width="49%" alt="The coach on a phone, proposing one change"> <img src="docs/images/phone-shot.png" width="49%" alt="The shot graph on a phone"> |

## What you need

- **A Decent espresso machine with Decaid.** Decaid is Decent's app for the
  machine; it runs on Decent's tablets (Android) and on macOS, Windows, Linux
  and the iPad. CafAI is checked against **Decaid v0.8.8**, the pin in
  [`contract/decaid/PIN.json`](contract/decaid/PIN.json): use 0.8.8 or newer.
  On an older Decaid, CafAI handles the differences it knows (0.8.6's 0-100
  ratings, a Decaid that cannot confirm a profile load) and Settings > About
  says yours is older; a newer Decaid is checked every day by the drift
  watch ([Develop](#develop)).
- **A scale Decaid connects to** (recommended): Decaid stops a shot at its
  target weight only with a scale.
- **For the coach, one of:**
  - an **Anthropic API key**, from Anthropic's Console. You pay Anthropic
    directly for what the coach uses; Settings has the model picker with
    each model's price.
  - **Claude on your computer**: Claude Code signed in with a Claude Pro or
    Max plan on a Mac or Windows PC (Linux works too), Node 18 or newer, and
    this repository on that computer. See
    [Claude on your computer](#claude-on-your-computer-no-api-key).
- **Your grinder in Decaid's grinder library** (optional): grind moves then
  come with the new setting worked out on its own steps.

## Install

**From a GitHub release:**

1. On the tablet, open Decaid's dashboard -> **Skins** (Decaid's docs call
   it **Launcher -> Skins**), tap **+** (Install skin) and choose **GitHub
   Release**.
2. Enter `justinmwarner/CafAI`. Decaid takes the release's `.zip` asset,
   installs it and lists **CafAI**.
3. Select **CafAI** as the skin.

**Check for updates** on the same page fetches a newer release from the same
place.

**From a zip you built yourself** (or when there is no release yet): on a
computer, `npm ci` and `npm run release:zip` write
`release/cafai-<version>.zip`. Copy it to the tablet and use **Skins -> + ->
ZIP file**, or serve it over HTTP from the computer and tell Decaid to fetch
it:

```bash
curl -X POST http://<tablet-ip>:8080/api/v1/webui/skins/install/url \
  -H "Content-Type: application/json" \
  -d '{"url": "http://<your-computer>:<port>/cafai-<version>.zip"}'
```

To leave CafAI, tap **Exit** (top right). Inside Decaid it returns to the
dashboard, where the Skins page switches skins; in a browser it opens Decaid's
settings page.

## First run

1. **The coach's key.** The chat opens on "Add your Anthropic API key to
   start coaching". Open **Settings** and paste the key under **Anthropic
   API key**, or choose **Claude on my computer** under **Where the coach
   runs** ([below](#claude-on-your-computer-no-api-key)). The machine row,
   the stats card and the shot graph work without a key.
2. **The machine and the scale.** Decaid connects them, as for any skin. The
   stats card in the chat shows **DE1** and **Scale** with a green dot when
   they are connected. When one is missing, the slim alert under the top bar
   offers **Connect DE1** or **Connect scale** (details in
   [Screens and looks](#screens-and-looks)).
3. **Gateway mode.** When Decaid is set to leave stopping shots to the skin
   (gateway mode Full), the alert says so, and **Let Decaid stop shots** sets
   it to Tracking. CafAI never changes Decaid's settings without that tap.
4. **Your grinder** (optional): link it in Settings, from Decaid's grinder
   library.
5. **A bag.** On the coach, "Which coffee is it?" lists the coffees in
   Decaid's bean library. Pick one, photograph the bag, or describe it; pick
   one of the starting profiles; pull a shot.

To see it first without a machine, run `npm run demo` on a computer: CafAI
with a dial-in already under way, on the built-in mocks, with no Decaid and
no API key ([docs/DEMO.md](docs/DEMO.md)).

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
   DYE2 plugin recorded setups for this coffee, or an earlier roast of it,
   the coach can read them (it never changes them) and start from what you
   did before.
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
  and opens it. See [On a phone](#on-a-phone).
- **Fixes in the alert.** When the machine is not connected, the alert has
  **Connect DE1** (and **Connect scale** when the scale is missing too);
  when only the scale dropped while the machine is awake, **Connect scale**.
  A Connect looks for devices without connecting them, then connects only
  the one Decaid itself would: its preferred one, or the only one in range
  when it has none. So the other device is never disturbed, and when the
  choice is Decaid's to make (its preferred one is away but another is
  there, it sees several, or it did not say which it uses), the alert says
  so and sends you to Decaid's scan screen instead. After the machine
  wakes, CafAI also looks once by itself for Decaid's preferred scale when
  it is missing. When Decaid's gateway mode is Full, Decaid leaves stopping
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
  Decaid only when you change it, never while the machine runs, and never
  without a DE1 connected; until Decaid answers, the fields show a dash.
  Steam that is off in Decaid (below 135 °C) shows Off; turning it on or off
  stays in Decaid.
- **Settings > About**: CafAI's version, and the Decaid you run next to the
  one CafAI was checked against ("Decaid 0.9.0 (CafAI was verified with
  0.8.8)", with a note when yours is older); anything Decaid sent that
  CafAI did not expect, with **Copy report** (routes and field names only,
  never your notes or the key); and when CafAI last backed up to Decaid.

## On a phone

A phone on the same network opens CafAI at `http://<tablet-ip>:3000`
(Decaid's entry for its skin) and gets the phone layout. Its browser storage
is its own, so the API key is entered again there, unless you keep a copy in
Decaid; bags and the look come back from Decaid's key-value store.

## Claude on your computer (no API key)

The coach can answer through your own Claude plan instead of an API key:
CafAI Bridge, a small program in [`bridge/`](bridge/README.md), runs on
your Mac or Windows PC and passes the coach's turns to the Claude Code
you have signed in there. Nothing is billed per call; the turns count
against your plan's usage limits.

You need Claude Code signed in with a Claude Pro or Max plan (install it
and run `claude` once, then `/login`; the copy the Claude desktop app keeps
works too) and Node 18 or newer.

1. On the computer, in CafAI's folder: `npm run bridge`. The first time it
   asks a few questions: is Claude Code there and signed in, does CafAI run
   on a tablet or on this computer, when should the bridge run (every
   morning on a schedule, 05:00-10:00 unless you say otherwise; always; or
   only when you start it), and, on Windows, may the firewall let the
   tablet in. Then it prints the address to use and a pairing code, for
   example `192.168.1.20` and `K7QM-2XWD`.
2. In CafAI, **Settings > Where the coach runs > Claude on my computer**:
   type the address (`127.0.0.1` when Decaid runs on that same computer) and
   the code, **Save**, then **Test**.
3. `npm run bridge -- setup` changes the answers later; `status` says
   whether it runs and when it starts next; `doctor` checks Claude Code, its
   sign-in and a real turn.

On a schedule the computer must be on (or asleep: the Windows task wakes
it), and on Windows you must be signed in (a locked screen is fine); the
bridge keeps the computer awake while it runs and stops itself at the end
of the window. The first time it listens, Windows Defender Firewall (or
macOS's firewall) asks whether Node.js may accept connections: allow it on
private networks, or the tablet cannot reach it (setup checks this). A VPN
must allow LAN connections. Claude Code must be new enough for the
model picked in Settings (Opus 5.5 needs 2.1.280): **Test** says so, and
`claude update` fixes it. The bridge is for your own use with your own
plan; [bridge/README.md](bridge/README.md) has the details and
troubleshooting.

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
  copied again while the switch is on). If Decaid cannot be reached when you
  forget the key or save a new one, CafAI deletes the copy (or copies the new
  key) as soon as Decaid is back, and a forgotten key never comes back from a
  copy.
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
- With an API key, calls go straight from the tablet to `api.anthropic.com`.
- With Claude on my computer, calls go from the tablet to CafAI Bridge on
  your computer, over your network in plain HTTP with the pairing code
  (kept on the device like the API key, never in Decaid or an export), and
  from there to Anthropic through your own Claude Code. The bridge keeps
  nothing you or the coach said: its log has times, sizes and model names
  only. It never reads or stores your Claude sign-in, and it turns off
  Claude Code's tools, hooks, plugins and your CLAUDE.md for coach turns.
- The report in Settings > About names Decaid's routes and fields and what
  was wrong with them, never your notes, your coffee or the key.

[SECURITY.md](SECURITY.md) says how to report a security problem privately.

## Troubleshooting

- **"Can't reach Decaid"** in the alert under the top bar: CafAI gets no
  answer from Decaid on port 8080 of the page's host. Inside Decaid, restart
  Decaid. In a browser, open CafAI from the tablet's address
  (`http://<tablet-ip>:3000`); on a development computer, see
  [Against a real tablet](#develop) for `localStorage.reaHostname`.
- **The machine or the scale is not connected.** Use the alert's **Connect
  DE1** or **Connect scale**. When the alert sends you to Decaid's scan
  screen, Decaid has to choose the device: connect it there.
- **Shots run past the target weight.** Decaid stops a shot at its target
  weight only with a scale connected and with gateway mode Disabled or
  Tracking; in Full, the alert's **Let Decaid stop shots** sets Tracking.
- **The key is gone after a Decaid update.** Decaid clears a skin's browser
  storage when it updates. Your bags come back from Decaid's backup by
  themselves, and the key does too if **Keep my API key in Decaid** is on;
  otherwise paste it again.
- **The coach does not answer.** The banner says why ("Anthropic did not
  accept your API key. Check it in Settings.", "Anthropic is overloaded
  right now. Try again in a minute.") and has **Retry**. Check the key in
  Settings and that the tablet reaches the internet.
- **CafAI warns about the engine, or does not start, on an old tablet.**
  Decaid shows skins in the tablet's Android System WebView; CafAI needs
  Chromium 91 or newer. Updating Android System WebView fixes it (Decaid's
  README says the same for older Teclast tablets).
- **Settings > About lists things Decaid sent that CafAI did not expect.**
  A Decaid newer than 0.8.8 changed something CafAI reads. Tap **Copy
  report** and paste it into a [bug report](https://github.com/justinmwarner/CafAI/issues/new/choose):
  it holds routes and field names only.
- **Claude on my computer: Test fails.** Run `npm run bridge -- doctor` on
  the computer: it checks Node, Claude Code, its sign-in, one real turn, the
  port, the network, the firewall and the schedule, and says what to do
  about each. [bridge/README.md](bridge/README.md#troubleshooting) has the
  rest.

Still stuck? [Open an issue](https://github.com/justinmwarner/CafAI/issues/new/choose)
with the CafAI and Decaid versions from Settings > About and the tablet or
phone you use.

## Develop

Requirements: Node 22.22.2+, 24.15+ or 26 (`engines` in `package.json`; 24
is recommended and is what CI runs; jsdom 30, used by the UI tests, needs
one of these), and npm. Older Node 24 releases run the suite with an engine
warning. No machine, tablet or API key is needed: mock mode runs CafAI
against a built-in Decaid and a scripted coach.

```bash
npm ci
npm run dev:mock      # the app against the built-in Decaid + Claude mocks (localhost:5173)
npm run demo          # a dial-in already under way, on the mocks (localhost:5175, docs/DEMO.md)
npm run dev           # the app against a real Decaid (see below)
npm run dev:sim       # a real Decaid with the scripted Claude, no API key (docs/SIMULATOR.md)
npm run typecheck && npm run lint && npm test
                      # typecheck includes the Decaid contract (contract/decaid/)
npm run e2e           # Playwright against the mocks, on three tablets and a phone
                      # (962x602, 1280x800, 1920x1200; a 390x844 phone upright and on its side)
                      # on port 4174; E2E_PORT=4175 npm run e2e runs beside another checkout's run
npm run verify        # typecheck, lint, unit tests, build, release zip and e2e, in that order
npm run release:zip   # release/cafai-<version>.zip (with LICENSE, NOTICE and the font licences)
npm run screenshots   # the README's pictures in docs/images/, from the demo
npm run decaid:watch  # would Decaid's latest release or main break CafAI?
npm run decaid:update -- v0.9.0   # move the pin to another Decaid release
npm run test:decaid   # CafAI against a running Decaid (needs DECAID_URL; see below)
npm run e2e:real      # CafAI opened from a running Decaid's port 3000
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rules the code keeps, the
decisions log and how a pull request is checked.

**Against Decaid's API.** CafAI is checked against Decaid **v0.8.8**
(`aab5f93`), the pin in `contract/decaid/PIN.json`. `npm run typecheck`
compares CafAI's wire types with Decaid's own specs at that release (78
checks), and every place where the spec is wrong and CafAI follows Decaid's
code is a recorded exception with the Dart line that proves it.
[contract/decaid/README.md](contract/decaid/README.md) says how to read a
failing check and how to move the pin (`npm run decaid:update -- <tag>`).
`npm run decaid:watch` runs the same checks against Decaid's latest release
and its `main`, diffs their specs against the pin's, and lists the Decaid
files CafAI depends on that changed since the pin. Its exit code: 0,
nothing CafAI depends on changed; 1, a check failed, or the spec diff
removes or retypes something CafAI uses; 2, it could not look at every
version or its changed files; 3, the watch itself broke; 4, every check
passes but files CafAI depends on changed (a spec with only additions
among them). `--report <file>` saves the report, and `GH_TOKEN` raises
GitHub's rate limit. On GitHub, `.github/workflows/decaid-watch.yml` runs
it daily and files each outcome as an issue (or updates the open one):
labelled `decaid-drift` on 1, `decaid-watch-blind` on 2 and `decaid-read`
on 4; the run fails on 1 and 3. `.github/workflows/decaid-live.yml` starts
Decaid's Linux release headless with a simulated machine and scale
(`scripts/decaid-ci.sh`) and runs `test:decaid` and `e2e:real` against it,
daily and before every release; a release also needs `npm run e2e`.

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
Mile. URL switches, read once at start (the full list is in
`mock/browser.ts`):

| Switch | What it does |
|---|---|
| `?mockSpeed=20` | plays shots, activities and the scripted coach 20 times faster (a shot's data keeps real time) |
| `?mockMachine=0`, `?mockScale=0` | start with the machine or the scale disconnected |
| `?mockGhc=1` | shots start on the machine itself (group-head controller) |
| `?mockExamples=0` | no example shot or example CafAI profile |
| `?mockUploadMs=3000` | the machine takes a new profile 3 s after a load (default 800 ms) |
| `?mockNoMachineProfile=1` | Decaid cannot confirm a load, like an older Decaid |
| `?mockGrinders=0` | Decaid's grinder library starts empty |
| `?mockGateway=full` | Decaid's gateway mode starts at Full (or `disabled`, `tracking`) |
| `?mockEnjoyment=100` | ratings on Decaid 0.8.6's 0-100 scale |
| `?mockSlowWorkflow=<ms>` | the workflow PUT answers after that long; `=503` answers 503 after 30 s without applying it, as Decaid v0.8.8 does |
| `?mockPlugins=none` | no Decaid plugin is loaded |
| `?mockDrift=1` | the machine's group temperature arrives as `groupTemp`, as from a Decaid that renamed it, so Settings > About lists what CafAI did not expect |
| `?mockDecaid=0` | no mock Decaid: only the scripted Claude, and every Decaid call goes to a real Decaid (`npm run dev:sim` opens it) |
| `?mockPersist=1` | keep the mock's store across page loads |
| `?demo=1` | the demo (`npm run demo`) |

The production build never contains the mocks or a service worker.

**The demo.** `npm run demo` opens CafAI as it looks in use, on the mocks and
on its own address (localhost:5175): two bags, every kind of card the coach
shows, and one open "How did it taste?" to answer, with no Decaid and no API
key. Each load starts it over. [docs/DEMO.md](docs/DEMO.md) says what is on
screen and what each answer does.

**Screenshots.** `npm run screenshots` (`playwright.screenshots.config.ts`,
`e2e/screenshots/`) builds the mock app (`dist-mock/`, as e2e does), opens
the demo at a fixed time, time zone and locale on a 1280x800 tablet and a
390x844 phone, and writes the README's pictures to `docs/images/` (each
under 300 KB). `SCREENSHOTS_PORT` moves its server from port 4176. Run it
after a change to the screens, and commit the pictures.

**Tablet viewports.** `dev/tablet.html` frames the app at real Decent tablet
sizes (962x602, 1007x602, 1140x712, 1280x800, 1920x1200, iPad) and injects
safe-area insets.

**Chromium 91.** `npm ci --prefix tools/chrome91` once (it downloads a real
Chromium 91 through puppeteer 9), then `npm run build:mock`, and:

- `npm run smoke:chrome91` loads the app and fails on any page or console
  error;
- `npm run smoke:chrome91:loop` drives the whole coach loop (settings, new
  bag with "Which coffee is it?" and Something else, templates, v1, scripted
  shot, taste chip, confirmed v2) in that engine.

Screenshots land in `tools/chrome91/out/`.

### Setting up the GitHub repository

The workflows need no secrets: they use the token GitHub gives each run, and
each asks in its own `permissions:` for what it needs (the drift watch's
`issue` job `issues: write`, the release `contents: write`; everything else
reads only). So the default workflow permissions (Settings > Actions >
General, "Read repository contents and packages permissions") can stay.

- **CI** (`ci.yml`) runs on every push to `main` and every pull request:
  typecheck, lint, unit tests, the build, the release zip and e2e, and the
  Chromium 91 smoke as an informational job.
- **The drift watch** (`decaid-watch.yml`, daily at 07:17 UTC and on demand)
  files its issues under three labels. It creates each label the first time
  it needs it; to have them ready for filters and notifications, create
  them yourself (Issues > Labels):

  | Label | Colour | Description |
  |---|---|---|
  | `decaid-drift` | `#B60205` | A newer Decaid fails CafAI's contract checks |
  | `decaid-watch-blind` | `#FBCA04` | The Decaid drift watch could not look at every Decaid version |
  | `decaid-read` | `#E4E9F2` | Decaid changed files CafAI depends on; every check passes |

- **Decaid live** (`decaid-live.yml`, daily at 07:43 UTC, on demand and
  before every release) runs CafAI against Decaid's latest Linux release.
- **A release** (`release.yml`): push a tag that matches `package.json`'s
  version (`v0.1.0`). It runs Decaid live, the checks and e2e, then publishes
  `cafai-<version>.zip` as a GitHub Release, the asset Decaid installs, with
  the tag's message as the notes.
- **Scheduled runs stop after 60 days without activity** in a public
  repository; re-enable them on the Actions tab.
- **Private vulnerability reporting**, in the repository's security
  settings: turn it on, so the **Report a vulnerability** button that
  [SECURITY.md](SECURITY.md) points to exists.
- **Issue forms** are in `.github/ISSUE_TEMPLATE/` (bug report, feature
  request), with a pull request template beside them.

## Project layout

| Path | What |
|---|---|
| `src/api` | Decaid REST client, WebSocket telemetry, KV, heartbeat, host/exit; the readers that check each reply, and the drift log; what Decaid's plugins leave (DYE2's setups, Visualizer's last upload) |
| `src/coach` | Pure logic: templates and levers, bounded validator, profile hashing, shot summarizer and query tools, roast age, prompt |
| `src/llm` | `LlmProvider` interface, streaming Anthropic client (fetch + SSE), tool-loop runner, the one request that reads a bag photo |
| `src/storage` | IndexedDB repositories, local-only key store, export/import, mirror to Decaid's KV store |
| `src/app` | The coach engine, services, app composition |
| `src/ui` | Shell, machine row, stats card and alert, live graph, chat surface, history and settings |
| `mock` | MSW mocks of Decaid and Claude, the demo, and fixtures |
| `bridge` | CafAI Bridge: the coach on your own Claude Code ([bridge/README.md](bridge/README.md)) |
| `contract/decaid` | Decaid's specs at the pinned release, the types generated from them, and the checks `npm run typecheck` runs, with the recorded spec errors |
| `e2e` | Playwright specs; `e2e/screenshots/` takes the README's pictures |
| `e2e-real` | The Playwright check against a running Decaid (`npm run e2e:real`) |
| `scripts` | The release zip, the Decaid contract and drift watch, and the headless Decaid for CI |
| `tools/chrome91` | The Chromium 91 smoke test and coach loop (puppeteer 9) |
| `dev` | `tablet.html` (the app at Decent tablet sizes) and preview pages |
| `docs` | Research, verified platform facts, audits, the Crema port plan, the simulator and hardware plans, workstream briefs, and `images/` |
| `.github` | CI, the drift watch, Decaid live and the release; issue forms |

## Decisions and docs

Design and platform decisions, each with its reason, are in
[DECISIONS.md](DECISIONS.md); the visual system in [DESIGN.md](DESIGN.md);
who CafAI is for in [PRODUCT.md](PRODUCT.md); open questions in
[QUESTIONS.md](QUESTIONS.md); what is planned next in
[docs/ROADMAP.md](docs/ROADMAP.md); verified platform facts, with the
source commits they were read from, in [docs/VERIFIED.md](docs/VERIFIED.md);
Decaid's API as CafAI is checked against it, in
[contract/decaid/](contract/decaid/README.md); what changed in each release
in [CHANGELOG.md](CHANGELOG.md).

## Influences and thanks

CafAI stands on other people's work. Each project below is named with its
author, licence and address as it states them, and with what CafAI took
from it: code, a running conversation, or lessons.

**Code CafAI includes**

- **[Crema](https://github.com/yarneo/crema)** by yarneo (Yarden), GPL-3.0:
  "a skin for the Decent DE1 espresso machine that turns every shot into a
  coaching session", and the project CafAI grew from. CafAI ports Crema's
  non-UI logic from its Decaid edition (`web/`, v1.1.2): the Decaid client
  and WebSocket handling, profile handling and its required-field fixes, the
  coach's prompt, proposal validation and change wording, shot curve
  analysis, the Anthropic client, settings mirroring and the key store,
  safe-area handling, the tablet harness and release tooling, with the tests
  that cover them. Each ported file says so in its header, and Crema's GPLv3
  without "or later" is why CafAI is GPL-3.0-only. Thank you for the
  hard-won fixes.
- **MimojaCafe**, the skin for Decent's
  [de1app](https://github.com/decentespresso/de1app) that Crema is a fork
  of. None of its code is in CafAI (only Crema's `web/` was ported), but the
  lineage is credited.
- **[decaid-mcp](https://github.com/The-Walker443/decaid-mcp)** by
  The-Walker443, GPL-3.0-or-later: an MCP server that runs inside Decaid as
  a plugin. CafAI's shot diagnostics (`src/coach/summary/analysis.ts`: first
  drops, preinfusion end, pressure peaks, puck resistance and five
  channeling indicators) are ported from it with its thresholds, which come
  from [decentespresso-mcp](https://github.com/The-Walker443/decentespresso-mcp);
  four of its real shots are CafAI's test fixtures, and CafAI asks Decaid
  for its rating scale the way decaid-mcp does (D101).
- **Decent Espresso's profiles**: the coach's five templates are Decaid's
  bundled profiles, unchanged, with their author and notes fields (D-Flow
  and Londonium credit Damian Brakel; Blooming Espresso and Rao Allongé are
  named for Scott Rao's techniques); see
  [`src/coach/templates/source/SOURCES.md`](src/coach/templates/source/SOURCES.md).
  CafAI's profile ids are a byte-exact port of Decaid's `ProfileHash`.

**What CafAI talks to**

- **[Decaid](https://github.com/decentespresso/decaid)** by Decent
  Espresso, GPL-3.0-or-later: "Decaid connects your Decent Espresso machine
  to beautiful, modern user interfaces (called 'skins')". CafAI is one of
  those skins. Everything it does goes through Decaid's REST and WebSocket
  API, and Decaid's skin guide (`doc/Skins.md`) and API specs, which CafAI
  checks itself against, made it possible. CafAI also uses Decaid's bundled
  plugins when they are loaded: Visualizer upload, time-to-ready and the
  settings page.
- **[DYE2](https://github.com/decentespresso/dye2)** ("Describe Your
  Espresso"), a plugin for Decaid published by Decent Espresso: beans, roast
  batches, grinders and equipment, a shot dashboard, auto-favourites and
  recipes. The coach reads the setups DYE2 recorded (D119); CafAI never
  writes DYE2's data.
- **[Visualizer](https://visualizer.coffee)** by Miha Rekar: a shot
  Decaid's Visualizer plugin uploaded gets an **On Visualizer** link, and
  CafAI's taste notes and stars travel there with the shot.
- **Claude**, by Anthropic: the coach, through the Anthropic API or, with
  CafAI Bridge, the Claude Code you signed in to.

**Skins CafAI learned from** (no code copied)

- **[streamline.js](https://github.com/decentespresso/streamline-js)**,
  Decent's own browser skin for Decaid, GPL-3.0-or-later. It is the
  reference CafAI follows: the 2026-10-09 audit
  (`docs/audit/2026-10-09/streamline.md`) measured CafAI against it, and its
  rules shaped how CafAI restores after a Decaid update, keeps the key across
  one, waits for a slow profile load, looks for a scale, times the heating
  countdown, caps hot water at 255 ml and looks for a Visualizer upload (D99,
  D100, D106, D111, D112, D114, D121).
- **[MSL](https://github.com/allofmeng/MSL)**, a skin for Decaid by
  allofmeng, "a fork of allofmeng/streamline_project (called
  Streamline.js)", GPL-3.0-or-later. CafAI finds Decaid the way MSL and
  streamline.js do (`localStorage.reaHostname`, D14), and the audit
  (`docs/audit/2026-10-09/others.md`) studied its release guards and its
  prompt.
- **[decaid-zen](https://github.com/pudabassman/decaid-zen)** by Ami, "a
  calm, graph-first WebUI skin for Decaid". CafAI's rule for bringing a
  dropped scale back is decaid-zen's (D111, written anew), as is naming
  Decaid's key-value namespace after the skin id.

The research brief, [docs/RESEARCH.md](docs/RESEARCH.md), also surveyed
other skins and projects for Decaid (Liquid Aqua, Insight, decal,
Bestpresso, forks of streamline.js and more) and links each.

**Fonts and libraries**

- **Figtree** (The Figtree Project Authors,
  [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree)) is
  CafAI's typeface, and **Roboto** (The Roboto Project Authors,
  [googlefonts/roboto-classic](https://github.com/googlefonts/roboto-classic))
  fills in the few arrows it lacks; both SIL Open Font License 1.1
  ([LICENSE-FIGTREE.txt](LICENSE-FIGTREE.txt),
  [LICENSE-ROBOTO.txt](LICENSE-ROBOTO.txt)), through Fontsource.
- **React**, **MUI** (Material UI, MUI X Chat and Material Icons), **Emotion**,
  **Zod**, **uPlot** (the shot graphs), **idb** and **core-js** in the app;
  **Vite**, **Vitest**, **MSW**, **Playwright**, **TypeScript**, **ESLint**
  and **openapi-typescript** to build and test it. Each keeps its own
  licence (see [NOTICE](NOTICE)).

## License

CafAI is licensed under the GNU General Public License v3.0 only
(GPL-3.0-only); see [LICENSE](LICENSE) and [NOTICE](NOTICE), which lists
the code it incorporates and its origins. CafAI is an independent project,
not made or endorsed by Decent Espresso or Anthropic.

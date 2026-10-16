# Changelog

What changed in each CafAI release, newest first. The version is
`package.json`'s; a release is the tag `v<version>`, which the release
workflow checks against it. Settings > About shows the version you run.

## Unreleased

- A shot's card takes a TDS from your refractometer: tap **TDS · Add**
  among its numbers and type the reading (a comma works too). CafAI works
  out the extraction yield (EY) from the card's own dose and yield, shows
  both on the card and in History, and writes them to the shot's record in
  Decaid, so Visualizer gets them. The coach hears the reading with your
  next tap or message, even one typed after it suggested a change, and is
  told what TDS and EY are and how far to trust them: a number about
  extraction, never a taste. Change or remove a reading the same way.
- °F: with Settings > Appearance > Temperatures on °F, every temperature
  reads in °F (the stats card, the drinks' views and settings, the change
  card, History and the cleaning guide) and the coach speaks °F (1 °C
  hotter is 1.8 °F hotter), while Decaid and your profiles keep °C. A
  steam, hot water or flush temperature set in °F is kept as the nearest
  whole °C, so it reads back as you set it.

## 0.1.2 (2026-10-15)

### The everyday skin

- Steam, hot water and flush take the screen while they run, as a shot
  does, whether they started from CafAI, the group head or Decaid: a dial
  fills toward the time or volume set, with steam rising from milk, water
  filling or the shower screen pouring while the machine works (still under
  reduced motion); the machine's readings (steam temperature, pressure and
  flow; hot water's flow, the scale and the time; the flush's water, flow
  and group temperature) and a trace of the run; and the drink's settings,
  held while it runs and yours to change the moment it stops. The view stays
  with its result, and **Go back** returns to where you were.
- Settings > Machine care: Decent's cleaning routine, one at a time (Daily,
  Weekly, Monthly, As needed), each step with what to do, when, and its
  moment in Decent's video "How often/to clean DE1". The video plays in
  place in a browser and on Decent's tablets; elsewhere in Decaid each
  moment opens YouTube at that time. Nothing loads from YouTube until you
  tap, and the steps themselves work offline. While the video is open, a
  drink you start leaves the guide on screen.
- Settings > Sleep and wake: Decaid's idle sleep (on or off, and after how
  many minutes) and its wake times, each a time, its days and how long the
  machine stays on after, with when the next one wakes the machine. Decaid
  keeps them and wakes the machine while it runs, CafAI open or not.

## 0.1.1 (2026-10-12)

### The coach

- A shot is rated in words against the shot before it, no longer with
  stars: Much worse, Worse, About the same, Better or Much better (a bag's
  first shot against your last shot of another coffee). The coach hears
  your verdict and is told it outranks the numbers; Decaid's `enjoyment`
  gets a running score from it. Stars given before stay as they were.
- The coach leaves the taste to you: it never says what a shot should taste
  like and explains a change by what it does at the machine. The change
  card's last line reads "What it changes" (it was "Expect"), and a
  proposal that promises a taste there goes back to the coach. While it
  asks how a shot tasted, **Taste words** above the composer offers neutral
  words for acidity, sweetness, bitterness, body and the finish, and **Need
  help?** explains how to taste.
- A grinder Decaid's grinder library lacks can be added, only on your tap:
  in Settings > Coach (**Add a grinder**), or on the coach's card when you
  name it in the chat. CafAI links it, so grind moves come in its own
  steps, and takes the one Decaid already has rather than add it twice.
  **Edit grinders in DYE2** opens DYE2's Grinders page.

### The everyday skin

- The tints are named for coffee: Lagoon, Ocean and Steel are now Cold
  Brew, Blueberry and Tamper, and a look saved under an old name keeps its
  tint.
- Settings > Steam, hot water and flush is laid out by drink, as the
  machine row draws them: one stepper per setting with its unit beside the
  value, Up and Down from a keyboard, and "Saving…" or a failure under the
  setting itself.
- Settings > Log shows what CafAI sends to and gets from Decaid (REST calls
  and WebSocket frames) and the coach, raw: **Open log** lists it newest
  first, full screen, with filters, **Pause** and each entry's headers and
  body, and **Share**, **Email** and **Copy** send it with CafAI's and
  Decaid's versions. The API key and the bridge's pairing code are never in
  it.
- Settings shows the API key only while the coach runs on Anthropic; with
  Claude on your computer, only the bridge's address and code. What you
  saved for the other one stays saved.
- History's export: **Copy** works over plain http (a phone on the
  network), where it used to copy nothing.

### Decaid

- 25 fixes from the fresh-eyes review of the Decaid alignment (`197520d`):
  Decaid's plugins are read again until Decaid has loaded them; a field
  CafAI cannot read is unknown, never Decaid's default, and a list Decaid
  answers with null fails out loud; Connect follows Decaid's own choice of
  device; the drink settings show dashes until Decaid answers and need a
  DE1; a bag without a roast date never reuses an undated batch; a
  forgotten API key stays forgotten, and Decaid's copy catches up once
  Decaid is back.
- The drift watch also fails when a newer spec removes or retypes something
  CafAI uses, and files an issue when it could not look at every version or
  when files CafAI depends on changed.

### The repository

- A README for people who install CafAI: the status, screenshots, what you
  need, install, first run, privacy, troubleshooting, development, and
  "Influences and thanks".
- NOTICE now credits decaid-mcp (CafAI's shot diagnostics and four test
  shots) and the code ported from Decaid (its profile hash, its profile
  reading and writing, and the mock's profiles); the 0.1.0 zip's NOTICE
  lacked them.
- New: CONTRIBUTING.md, SECURITY.md (GitHub's private vulnerability
  reporting), this changelog, issue forms for bugs and features, and a pull
  request template; `npm run screenshots` retakes the README's pictures.
  The bug form asks for the log from Settings > Log.

## 0.1.0 (first release)

The first public version: a complete skin for Decaid with an AI dial-in
coach. It has passed every check against Decaid 0.8.8's simulated machine
and scale, but has not yet been used on a real Decent machine (see the
README's Status).

### The coach

- A chat per bag: pick the coffee from Decaid's bean library, photograph the
  bag, or describe it, and the coach suggests two to five starting profiles
  from Decent's own (Blooming Espresso, D-Flow / default, Londonium, Rao
  Allongé, Gentle and Sweet).
- After each shot it reads the shot from Decaid, asks how it tasted, and
  proposes one change at a time within the profile's declared bounds, as a
  plain-language diff you confirm; every version is kept, with Undo.
- Grind moves from Decaid's grinder library; recorded setups from Decaid's
  DYE2 plugin; taste notes and stars written to the shot in Decaid (and so to
  Visualizer), with an **On Visualizer** link once the plugin has uploaded it.
- The coach runs on your Anthropic API key, or on your own Claude Pro or Max
  plan through CafAI Bridge (`npm run bridge`) on a Mac or Windows PC.

### The everyday skin

- Espresso, Steam, Flush and Hot water from the top bar, Stop in place of the
  one running; a live stats card in the chat; a big live shot graph that takes
  the screen while a shot runs.
- Tablet and phone layouts, down to the Chromium 91 WebView of older Decent
  tablets; Dark, Light or Auto in seven tints or any hue.
- Steam, hot water and flush presets in Settings; alerts with one-tap fixes
  (connect the machine or scale, let Decaid stop shots at the target weight).

### Decaid

- Checked against Decaid v0.8.8: a contract typecheck against Decaid's own
  REST and WebSocket specs, tests against a running Decaid (`npm run
  test:decaid`), and a daily drift watch for newer Decaid releases.
- CafAI's data is backed up to Decaid's key-value store and restored after a
  Decaid update; the API key is copied there only if you choose to.
- Settings > About shows your Decaid next to the one CafAI was verified with,
  and anything Decaid sent that CafAI did not expect, with a report to copy.

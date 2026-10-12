# Changelog

What changed in each CafAI release, newest first. The version is
`package.json`'s; a release is the tag `v<version>`, which the release
workflow checks against it. Settings > About shows the version you run.

## Unreleased

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

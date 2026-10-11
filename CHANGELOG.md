# Changelog

What changed in each CafAI release, newest first. The version is
`package.json`'s; a release is the tag `v<version>`, which the release
workflow checks against it. Settings > About shows the version you run.

## Unreleased

## 0.1.0 (first release)

The first public version: a complete skin for Decaid with an AI dial-in
coach.

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

# CafAI UX: tablet and phone modes, shot focus, palette theme, Figtree

Date: 2026-10-07. Status: approved design, awaiting spec review.
Strategic context: [PRODUCT.md](../../../PRODUCT.md).

## Why

Three problems the owner raised, all visible in the current build:

- **The shot is hard to watch.** At 962x602, mid-shot, the live graph is a
  strip about 120 px tall in the bottom-left corner while the chat fills the
  screen.
- **There is no phone layout.** At 390 px wide the top bar overlaps itself
  and the chat is squeezed into a sliver beside a full-width machine column.
- **The look is fixed and a little plain.** One brown palette, Roboto, and
  outlined boxes everywhere. Owners want the colors of their own space (the
  owner's own pick would be a green), in light or dark.

## The owner's answers (2026-10-07)

| Question | Answer |
|---|---|
| Tablet approach | The main pane swaps between chat and a big graph (approach 1 of 3) |
| After a shot | Back to the coach when done. Keep the preview chart the machine column has today. On the chart view, a small "clippy"-style coach message says it is watching the shot, even though it only answers once the shot is done |
| Tints | Named tints plus a hue slider |
| Typeface | Figtree |
| Brand feel | Calm, precise, warm (PRODUCT.md) |
| Every section of this design | Approved as presented, no changes |

Rejected approaches: **focus layout** (the graph takes about two-thirds of the
width and the machine column shrinks to a rail; Stop moves as the shot
starts, the tap hazard the machine controls were written to avoid) and
**wider column** (the column widens during a shot; the chat gets cramped,
controls reflow, and the graph still ends up smaller than in approach 1).

## Mockups

[CafAI layout and theme mockups](2026-10-07-ux-modes-and-theme.mockup.html "width=1000 height=650")

Static copies: [tablet](assets/2026-10-07-mockup-tablet.png),
[phone](assets/2026-10-07-mockup-phone.png),
[palette prototype](assets/2026-10-07-palette-prototype.png) (seven tints,
dark and light, with measured contrast),
[type specimen](assets/2026-10-07-type-specimen.png).

The mockups are directional: sizes in them are approximate, and where they
disagree with this spec (for example 44 px nav items there, 48 px touch
targets here), the spec wins.

## 1. Layout modes

### Choosing the mode

A pure function of the viewport, re-evaluated on resize and rotation:

```
layoutMode(width, height) = 'tablet'  when width >= 800 and height >= 500
                            'phone'   otherwise
phoneNav(width, height)   = 'rail'    when height < 500 (phone in landscape)
                            'bar'     otherwise
```

Every Decent tablet (962x602, 1007x602, 1140x712) and every iPad in either
orientation (except an iPad mini in portrait, 744 wide, which gets the phone
layout) is a tablet. A phone in portrait gets the bottom bar; a phone in
landscape gets a side rail so the content keeps its height.

### Tablet

- **Top bar, 56 px** (64 today): brand, then the navigation **Coach · Shot ·
  History · Settings** (48 px tall buttons), a spacer, **Decaid settings**
  (with an "opens elsewhere" icon, not the coffee-maker icon) and **Exit**.
- **Machine column** on the left: 340 px below 1200 px wide, 400 px below
  1600, 480 px from 1600. It holds the machine status, the controls and the
  preview chart (section 2).
- **Main pane** on the right: the routed screen (Coach, Shot, History,
  Settings).
- The old-engine warning stays where it is today, between the top bar and
  the columns.

### Phone

- **Top bar, 52 px**: brand, a spacer, **Decaid** (text plus the same
  "opens elsewhere" icon) and **Exit**. Both stay on every screen (D12, D13).
- **Content**: one screen at a time.
- **Bottom tabs** (portrait): **Coach · Machine · History · Settings**, 64 px
  plus the bottom safe-area inset, icon and label, the current tab in the
  accent. **Side rail** (landscape): the same four, stacked, 80 px wide plus
  the left inset.
- The tabs hide while a text field has focus, so the on-screen keyboard does
  not leave the chat a few lines tall; they come back on blur.
- The **Machine** tab is the machine column at full width (status, controls,
  then the graph filling the rest).
- Decaid's exit-hint snackbar covers the bottom of the screen for 10 s after
  the skin opens (docs/verified/01-platform.md section 15, item 29). The
  bottom tabs are navigation only; Stop is never at the bottom.

### Routes

One new route, `{ name: 'shot' }` at `#/shot`. On a tablet it is the Shot view
in the main pane; on a phone it is the Machine tab. The same address works in
both modes, so crossing the breakpoint (a rotation, a resized window) keeps
the screen. The route restore after a background reload (`restoreRoute` in
`src/app/App.tsx`, key `cafai.route`) covers it like any other route. The labels differ on purpose: on a tablet the
machine column is always visible, so the main-pane view is just the shot;
on a phone the tab also holds steam, flush and hot water.

### Unchanged

The page never scrolls (each region scrolls inside itself), there are no edge
gestures, every control is at least 48 px, safe-area insets come through the
`--safe-*` variables, and Exit is on every screen.

## 2. Shot focus

### The rules

| When | What happens |
|---|---|
| A shot starts | The app goes to the Shot route by itself, unless a text field has focus (the barista is typing to the coach, or a setting): then it stays, and the live strip or preview chart shows the shot |
| The barista moves during the shot | Their choice wins: no automatic return for this shot |
| The shot is done | Once the chat gets the shot's outcome, or 8 s after Decaid reports the shot finished, whichever comes first, the app goes back to the Coach, if it was the automatic switch that put the barista on the Shot route and they are still there. The outcome is the first shot card or notice the engine adds after that report; the transient "Looking for that shot in Decaid…" progress notice does not count |
| Any automatic switch | The screen that just appeared ignores taps for 350 ms, so a tap meant for the old screen cannot land on the new one. On a tablet only the main pane is guarded; the machine column, Stop included, never stops taking taps |

Automatic switches use `location.replace`, so they do not pile up browser
history entries (Back in a phone browser goes where the barista went, not
where the app went).

On a machine with a group-head controller the start buttons are hidden and
shots start from the machine (useHasGhc), so the automatic switch is the
only way the screen learns of the shot without a tap: the rules above hold
unchanged.

### The shot focus controller

A pure reducer, `shotFocus(state, event) -> { state, command? }`, with a thin
hook that wires it to telemetry, the coach store and the router.

- Events: `shotStarted { typing }`, `userNavigated`, `shotFinished { at }`,
  `outcomeAdded` (the hook decides what counts: a shot card or a notice
  without progress), `tick { now }`.
- Commands: `goShot`, `goCoach`.
- States: `idle`, `live { auto }`, `over { auto, finishedAt }`.

It never sends anything to the machine and holds no coaching state. Tests
cover every row of the table above, a shot that ends with no message at all
(the 8 s timeout), a shot that starts while typing, a second shot that starts
before the first one's outcome arrives, and a page loaded mid-shot (telemetry
replays the shot state on connect; the controller follows whatever lifecycle
events telemetry emits).

### One shared shot recording

Today every LiveShotGraph keeps its own buffer, created when it mounts, so a
graph that opens mid-shot misses the start. The buffer moves into a
**ShotTrace** provider mounted once above the shell. It subscribes to
telemetry (samples, shot lifecycle, the pour-over state), owns the existing
`shotBuffer` logic, and exposes the arrays, the pour time, the latest values,
`phase` (`empty`, `live`, `done`) and `shotId`, plus a subscription.

The preview chart, the Shot view, the live strip and the focus controller all
read from it. Samples still never touch React state: painting stays
requestAnimationFrame-driven through uPlot's `setData`, and the timer and
readouts are still written straight into their DOM nodes. The existing rule
that the card's numbers (pour time, Decaid's settled yield) replace the live
ones once the chat has the shot's card stays, now in one place.

### The Shot view

Top to bottom:

1. **Header**: a live dot (pulsing, still under reduced motion), "Live shot"
   or "Last shot", the running step when the profile names it ("Pour · step 3
   of 3", from the same step names the state line uses), and the pour timer
   in display size on the right.
2. **Four readouts**, each with its series swatch: Pressure (bar), Flow
   (ml/s), Weight (g, plus "of 50" when a stop-at-weight target is known),
   Weight flow (g/s). These replace the small legend.
3. **The plot**, filling the rest: today's axes, scales, dashed targets and
   series order (pressure on top).
4. **The coach's note** (below).

With no shot yet: today's "Pull a shot to see it here.", no note.

### The coach's note

A small coach avatar and a speech bubble under the plot, never over the
curves. It fades and slides in over 200 ms when the shot starts (instant
under reduced motion), and has `role="status"`.

| Situation | Note |
|---|---|
| Shot running; the machine has the active bag's version ("This bag") | I'm watching this shot. I'll read the curves once it's done. |
| Shot running; the machine runs another profile | This shot runs "{profile}", not {version}, so it won't be part of this dial-in. |
| Shot running; the version is still loading or was not confirmed | I'm watching, but {version} isn't confirmed on the machine yet, so this shot may not count. |
| Shot running; no bag, no starting profile, or no API key | I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots. (No key: "Add your API key in Settings, and I'll read your shots.") |
| Pour over, outcome not in the chat yet | Done. Reading the shot... (with three dots that pulse; static under reduced motion) |
| A finished shot whose outcome is already in the chat (opened from the preview, the strip or the card link) | No note |

The wording follows the engine's own notices ("not part of this dial-in")
and has no em dashes. The profile title and mark come from the same
`useLoadedProfile` reading the Profile line uses; it is lifted into a shared
provider so the note adds no second 30 s poll.

### Getting back to the chart

- **Tablet: the preview chart.** Today's graph stays in the machine column,
  restyled. The whole card is a button ("Open the shot graph") that goes to
  the Shot route. While the main pane shows the Shot view the preview is
  hidden; the controls above it keep their places.
- **Tablet: the Shot nav item** shows the live dot and the running pour time
  ("Shot 42.0 s") while a shot runs.
- **Phone: the live strip.** At the top of the Coach tab while a shot is live
  or its outcome is pending: dot, "Live shot", time · weight · pressure, a
  mini chart (pressure and flow) and a chevron; the whole 64 px strip is one
  button to the Machine tab. Gone once the outcome is in the chat.
- **Phone: the Machine tab** shows the dot and the time ("42 s") in place of
  its label while a shot runs (accessible name: "Machine, shot running, 42
  seconds").
- **Both: the newest shot card.** The card whose `shotId` matches the trace's
  shot gets a "Graph" link beside its sparkline, to the Shot route. Older
  cards have no link (the trace holds one shot).

## 3. Theme

### The appearance setting

```
appearance = { mode: 'dark' | 'light' | 'auto', tint: TintId | { hue: 0..359 } }
default    = { mode: 'dark', tint: 'crema' }
```

- **Where it lives.** A new `appearance` field on Settings (the shared
  contract in `src/storage/types.ts`), read leniently by `normalizeSettings`
  like every other field: an unknown mode is `dark`, an unknown tint is
  `crema`, a hue is rounded and wrapped into 0-359. Settings are mirrored to
  Decaid's KV store and exported, so a phone opening CafAI for the first time
  (a fresh origin restored from the mirror) starts with the tablet's look.
  When an import merges settings (`fillBlankSettings`), a local appearance
  that is not the default wins.
- **Boot cache.** Settings arrive only after IndexedDB opens, so the resolved
  background and text colors are also cached in `localStorage`
  (`cafai.appearance.boot`). `src/main.tsx`'s "Starting CafAI…" and "could
  not start" screens use it, and so does the ES5 watchdog page in
  `index.html` (falling back to today's colors). Nothing secret is in it.
- **Auto** follows `prefers-color-scheme` through `matchMedia`, with a change
  listener. Whether Decaid's WebView reports the device's dark mode is not
  verified: it goes on the hardware test plan, and Auto resolves to light
  wherever the query never matches.

### One palette function

`buildPalette(mode, tint)` returns every color the app uses, as hex strings.
It works in OKLCH and converts to sRGB in TypeScript, reducing chroma until
the color fits the sRGB gamut, because Chromium 91 understands neither
`oklch()` nor `color-mix()` (the reason today's theme avoids MUI's CSS
variables). A tint is `{ hue, chroma, neutral }`: the accent's chroma and how
far the neutrals lean toward the hue.

Starting values (OKLCH lightness L, chroma C; `n` = the tint's neutral chroma,
`c` = its accent chroma, `h` = its hue). The contrast table below wins over
these numbers: tune L until it passes.

| Role | Dark | Light |
|---|---|---|
| background | L 0.17, C n | L 0.975, C 0.5n |
| surface (cards, bars) | L 0.205, C 1.15n | L 0.995, C 0.25n |
| raised (tonal buttons, bubbles) | L 0.25, C 1.3n | L 0.945, C 0.8n |
| ink (text) | L 0.95, C 0.9n | L 0.24, C 1.5n |
| inkMuted | L 0.76, C 1.2n | L 0.47, C 2n |
| line (dividers, borders) | ink at 12% over background | ink at 14% over background |
| accent | L 0.76, C c | L 0.50, C c |
| accentSoft (selected nav, strip) | accent at 16% over surface | accent at 12% over surface |
| onAccent | L 0.20, C 2n | L 0.99, C 0.005 |

Fixed-hue colors, the same in every tint:

| Role | Dark (L, C, hue) | Light (L, C, hue) |
|---|---|---|
| success | 0.80, 0.14, 155 | 0.55, 0.14, 155 |
| warning | 0.83, 0.13, 85 | 0.60, 0.13, 75 |
| error | 0.72, 0.15, 25 | 0.55, 0.18, 25 |
| info | 0.74, 0.12, 245 | 0.52, 0.15, 250 |
| live dot | 0.68, 0.19, 25 | 0.58, 0.20, 25 |
| graph: pressure | 0.80, 0.14, 160 | 0.55, 0.14, 160 |
| graph: flow | 0.74, 0.12, 245 | 0.52, 0.15, 250 |
| graph: weight flow | 0.78, 0.13, 55 | 0.62, 0.15, 55 |
| graph: weight | 0.82, 0.05, 70 | 0.55, 0.06, 65 |
| graph: grid | ink at 8% over background | ink at 8% over background |
| graph: axis labels | inkMuted | inkMuted |

The graph keeps Decent's convention (pressure green, flow blue) whatever the
tint, so an Ocean accent and the flow line can share a hue; the accent is
never used on the plot.

### Tints

| Id | Name | Hue | Accent chroma | Neutral chroma | Note |
|---|---|---|---|---|---|
| crema | Crema | 68 | 0.085 | 0.014 | Default; today's brown, refined |
| matcha | Matcha | 138 | 0.11 | 0.014 | |
| lagoon | Lagoon | 200 | 0.09 | 0.014 | |
| ocean | Ocean | 250 | 0.12 | 0.016 | |
| plum | Plum | 320 | 0.11 | 0.014 | |
| cherry | Cherry | 22 | 0.13 | 0.014 | |
| steel | Steel | 250 | 0.025 | 0.006 | Accent L 0.88 dark / 0.36 light, so it reads apart from muted text |
| (custom) | Custom | 0-359 | 0.11 | 0.014 | From the hue slider |

### Contrast, enforced by tests

A unit test sweeps every named tint and every custom hue 0-359, in both
modes, and fails on any pair below:

| Pair | Minimum |
|---|---|
| ink on background, surface, raised | 7:1 |
| inkMuted on background, surface, raised | 4.5:1 |
| accent on background and surface (nav labels, links) | 4.5:1 |
| accent on accentSoft (the selected nav label) | 4.5:1 |
| onAccent on accent (filled buttons, chosen chips) | 4.5:1 |
| success, warning, error, info on background and surface | 4.5:1 |
| text on a filled error button (Stop) | 4.5:1 |
| each graph series on background and surface | 3:1 |

The palette prototype already measured ink 15:1 or more, muted 6.3:1, accent
5.3:1 and text on accent 5.6:1 for the seven tints.

### From palette to MUI

`createCafaiTheme(palette)` maps the palette onto MUI (primary = accent,
background, text, divider, success, warning, error, info) and keeps today's
component overrides (touch targets, no elevation tint, no text transform).
Plain palette colors only, no `cssVariables`, as today. Themes are memoized
per (resolved mode, tint), so the ThemeProvider value changes only when the
appearance does. `graphColors` and `tokens` stop being module constants; the
few places that draw outside MUI (the uPlot canvas, the sparklines) read the
palette from the theme. On a theme change the uPlot instance is rebuilt from
the shared trace, so a change mid-shot loses nothing.

### Settings: Appearance

A new first section on the Settings screen:

- **Mode**: a three-part segmented control, Dark · Light · Auto, with the
  helper "Auto follows this device's light or dark setting."
- **Tint**: a radio group of swatches, each a circle of the tint's accent
  around its background, with its name under it; the eighth is Custom.
- **Custom hue**: a slider (48 px thumb target) whose track shows the hues at
  the accent's lightness; moving it selects Custom.
- Helper text: "The tint colors the buttons and tints the backgrounds. Shot
  graph colors never change: pressure green, flow blue."

Changes apply at once to every screen and are saved through the settings
repository. They are not part of the D37 key-scrubbing problem (no free
text).

## 4. Typography

- **Figtree** (`@fontsource-variable/figtree`, OFL 1.1), latin subset, the
  variable normal face (about 20 KB, less than today's three Roboto weights)
  and the variable italic face (the chat renders `*emphasis*`), bundled and
  offline like today. The Roboto latin weights go.
- **Arrows.** Figtree's latin subset has no → or ← (it has ↑ and ↓). Today's
  Roboto symbols faces (unicode-range U+2190, U+2192, U+2194-2199, fetched
  only when such a glyph is on screen) stay, renamed to a family of their
  own, `CafAI Symbols`. Stack: `"Figtree", "CafAI Symbols", system-ui,
  "Helvetica", "Arial", sans-serif`. The "━" legend glyph on the shot card
  becomes a drawn swatch, like the live graph's legend.
- **Licenses.** `LICENSE-FIGTREE.txt` (the package's OFL text) joins
  `skin.config.json`'s `licenseFiles` and the zip; `LICENSE-ROBOTO.txt` stays
  for the symbols faces; NOTICE names both (D49).
- **Scale** (product register: fixed rem, about 1.125 to 1.2 between steps):

| Variant | Use | Size | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| display | Shot view timer | 2.875rem (46 px) | 650 | 1 | -0.02em |
| readoutLarge | Shot view readouts | 1.875rem (30 px) | 650 | 1.1 | -0.01em |
| h4 | rare | 1.75rem | 650 | 1.2 | -0.015em |
| h5 | the machine's state line | 1.4375rem (23 px) | 650 | 1.2 | -0.01em |
| h6 | screen titles, the bag title | 1.1875rem (19 px) | 700 | 1.3 | -0.005em |
| subtitle1 | card titles, questions | 1.0625rem (17 px) | 650 | 1.35 | 0 |
| body1 | chat and body text | 1rem | 400 | 1.55 | 0 |
| body2 | secondary text | 0.9375rem | 400 | 1.5 | 0 |
| readout | machine readouts | 1.1875rem | 650 | 1.2 | 0 |
| label | readout and field labels | 0.8125rem | 550 | 1.3 | 0 |
| caption | small print | 0.8125rem | 400 | 1.35 | 0 |
| button | buttons | 1rem | 600 | 1.25 | 0.005em |

- **Labels** are sentence case ("Group", not "GROUP"); the uppercase overline
  goes.
- **Numbers that change live** (readouts, timers, metrics) use tabular
  figures; units follow in the muted color at about 0.6em ("97.7 °C").
- **Line length**: the chat lane is capped at 680 px (about 70 characters)
  and the composer at 760 px, centered in a wide pane.
- Headings get `text-wrap: balance` (ignored by Chromium 91, harmless).

## 5. Visual cleanup

- **Tonal buttons.** Secondary actions (Steam, Flush, Hot water, Sleep, Tare,
  Undo, New bag, Exit) become filled `raised` buttons instead of outlines; the
  primary action of a screen (Espresso, Confirm, Use this, Send) stays filled
  with the accent; Stop is a tonal button with error-colored text when idle
  and a filled error button while a shot runs (today's prominent state).
  Added as a theme-level `tonal` Button variant.
- **Cards** keep a 1px line border on `surface`, radius 16. The pending
  change card keeps its 2px accent border (emphasis, not a side stripe).
- **Bag header**: the bag picker reads as a title ("Kiambu AA ▾", still the
  native select), the version as quiet text ("v4 · Blooming Espresso")
  instead of a filled chip that looks like a button.
- **Machine status**: connection as two small dots with words, sentence-case
  labels, larger values with muted units.
- **Top bar** loses 8 px; nav buttons stay 48 px.
- Motion: 150 to 250 ms ease-out for state changes (the note, the strip, tab
  changes), no bounce, all with reduced-motion alternatives.

## 6. What does not change

The coach engine, the protocol, the storage design (apart from the
`appearance` field), the Decaid client, the chat's behaviour and its
follow-newest scrolling, the machine controls' rules (a tap sends once, never
retried; controls keep their place), and every test id an existing spec uses.
The build target stays Chromium 91, in one bundle (D10), with no service
worker and nothing from a CDN.

## 7. Testing and verification

- **Unit (Node):** OKLCH conversion against known values and gamut mapping;
  the contrast sweep (section 3); appearance parsing and settings
  normalization, mirror and export round trips; `layoutMode` and `phoneNav`;
  the shot focus reducer (every rule and edge case in section 2); the
  ShotTrace store (a reset on a new shot, the pour end, the card override).
- **Component (jsdom):** AppShell in both modes (tabs vs top nav, Exit and
  Decaid settings present in each); the Shot view and its empty state; every
  row of the coach note table; the preview chart and live strip open the Shot
  route; the Appearance section changes the theme and saves.
- **E2E (Playwright):** two new projects, `phone-390x844` and
  `phone-landscape-844x390`, run a new `phone-baseline.spec.ts` (every tab
  renders, Exit and Decaid settings are on each, nothing overflows sideways)
  plus the new specs below; the three tablet projects run everything, as
  today, with the phone baseline skipped. New specs:
  `shot-focus.spec.ts` (a scripted shot switches to the graph, the card
  brings the coach back, the strip or preview reopens the graph, typing at
  the start stops the switch) and `appearance.spec.ts` (Light + Matcha
  changes the computed background and survives a reload).
- **Chromium 91:** `npm run smoke:chrome91` and the loop must pass, with zero
  console errors and no `oklch(`, `color-mix(` or other post-91 CSS in the
  bundle.
- **Visual pass:** screenshots at 962x602, 1280x800, 1920x1200, 390x844 and
  844x390, in dark and light, in Crema, Matcha and Steel, reviewed before
  each stage is called done, then the project's fresh-eyes verifier.

## 8. Docs and decisions

- DECISIONS.md, from D80: layout modes and breakpoints; the shot focus rules;
  the shared ShotTrace; the palette function and OKLCH-in-TypeScript; the
  appearance setting in Settings plus the boot cache; Figtree and the symbols
  fallback.
- README: the layout modes and the Appearance settings.
- DESIGN.md (new): the visual system as built (tokens, type scale,
  components), written once stage 1 lands.
- docs/HARDWARE_TEST_PLAN.md: Auto mode in Decaid's WebView; the phone
  layout inside Decaid on a phone, if anyone runs it there.

## 9. Order of work

Each stage leaves the app working and can be committed on its own.

1. **Palette, theme and Figtree.** The palette function and its contrast
   tests, the theme built from it (still Dark + Crema), Figtree and the
   symbols fallback, the type scale, tonal buttons and the other visual
   cleanup. The app looks refined but behaves as today.
2. **Appearance.** The settings field, the boot cache, the Appearance
   section, Auto, live re-theming including the graph.
3. **Layout modes and shot focus.** The ShotTrace provider, the `shot`
   route, the tablet Shot view and preview chart, the phone shell with tabs
   and rail, the live strip, the coach note, the focus controller and the tap
   guard.

## 10. Risks and open questions

- **Auto in Decaid's WebView** may never report dark mode (hardware plan).
- **A phone in a browser on the LAN** opens CafAI on a different origin than
  the tablet (`http://<tablet-ip>:<port>`): the mirror brings the bags and the
  appearance, but the API key is per origin, so the coach on that phone needs
  the key entered again. That is today's behaviour, now more visible; the
  Settings copy should say so.
- **@mui/x-chat in light mode**: its bubbles and composer read the MUI theme,
  but this alpha has only ever been seen in dark; stage 2 checks it at every
  size.
- **Performance on old tablets**: a theme change re-renders the whole tree
  once (rare, on a tap); building a palette is a few hundred arithmetic
  operations.

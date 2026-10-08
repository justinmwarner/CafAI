---
name: CafAI
description: "The visual system of CafAI, a chat-first espresso dial-in coach skin for Decent machines: calm, precise and warm, one tint in light or dark, Figtree throughout, tonal layers instead of shadows, and Decent's own shot-graph colours."
colors:
  # The default look: dark mode, Crema tint, from buildPalette('dark', namedTint('crema'))
  # in src/ui/palette.ts. Every tint-driven role is rebuilt for the barista's tint and mode
  # (section 2 has light mode and the other tints). The fixed colours never follow the tint.
  crema-accent: "#d5a776"      # accent: the primary action and the current selection
  on-accent: "#1e1408"         # text and icons on the accent
  accent-wash: "#3a2d1f"       # accentSoft: accent at 16% over surface
  bar-background: "#140e09"    # background: the page, the machine column, the main pane
  bar-surface: "#1c160f"       # surface: top bar, tab bar, cards, composer, preview chart
  bar-raised: "#282018"        # raised: tonal buttons, user bubbles, the coach note
  bar-raised-hover: "#383028"  # ink at 8% over raised: tonal hover, pointer devices only
  ink: "#f4ede6"               # text
  ink-muted: "#b8afa6"         # secondary text, labels, units
  ink-disabled: "#766e66"      # ink at 38% over raised: a disabled tonal button's label
  line: "#2f2924"              # ink at 12% over background: dividers, card borders
  graph-grid: "#26201b"        # ink at 8% over background
  graph-axis: "#b8afa6"        # the plot's axis labels (ink-muted)
  # Fixed: the same hex in every tint (dark-mode values here)
  success: "#6ad895"
  warning: "#eec05b"
  error: "#f47b74"
  on-error: "#1e1311"          # text on a filled error button (Stop while the machine runs)
  info: "#65b2f1"
  live: "#f75d59"              # the pulsing live-shot dot
  graph-pressure: "#5ed99e"
  graph-flow: "#65b2f1"
  graph-weight-flow: "#f7a062"
  graph-weight: "#dabfa2"
typography:
  display:          # the Shot view's pour timer
    fontFamily: Figtree
    fontSize: 2.875rem
    fontWeight: 650
    lineHeight: 1
    letterSpacing: -0.02em
    fontFeature: tabular-nums
  readout-large:    # the Shot view's four readouts
    fontFamily: Figtree
    fontSize: 1.875rem
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: -0.01em
    fontFeature: tabular-nums
  headline:         # MUI h5: the machine's state line
    fontFamily: Figtree
    fontSize: 1.4375rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: -0.01em
  title:            # MUI h6: screen titles, empty-state titles, the bag picker
    fontFamily: Figtree
    fontSize: 1.1875rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.005em
  subtitle:         # MUI subtitle1: card titles, questions, graph captions, the profile name
    fontFamily: Figtree
    fontSize: 1.0625rem
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: 0em
  body:             # MUI body1: chat and body text
    fontFamily: Figtree
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  body-small:       # MUI body2: secondary text, notices, helper text, the coach note
    fontFamily: Figtree
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  readout:          # the machine column's readouts
    fontFamily: Figtree
    fontSize: 1.1875rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0em
    fontFeature: tabular-nums
  metric:           # the numbers on a shot card
    fontFamily: Figtree
    fontSize: 1rem
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: 0em
    fontFeature: tabular-nums
  label:            # readout and field labels, swatch names; sentence case
    fontFamily: Figtree
    fontSize: 0.8125rem
    fontWeight: 550
    lineHeight: 1.3
    letterSpacing: 0em
  caption:          # small print: legend, "target 98.5", the Exit button's second line
    fontFamily: Figtree
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0em
  button:
    fontFamily: Figtree
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.005em
  button-small:     # the Mode control's segments
    fontFamily: Figtree
    fontSize: 0.9375rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.005em
  button-start:     # Espresso, Steam, Flush, Hot water: icon over label
    fontFamily: Figtree
    fontSize: 0.9375rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 0.005em
  button-stop:
    fontFamily: Figtree
    fontSize: 1.0625rem
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0.005em
  tab-label:        # the phone's tabs (in flux)
    fontFamily: Figtree
    fontSize: 0.78125rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0em
  wordmark:         # "CafAI" in the top bar, in the accent
    fontFamily: Figtree
    fontSize: 1.1875rem
    fontWeight: 750
    lineHeight: 1.55
    letterSpacing: 0.005em
rounded:
  none: 0px                         # the old-engine warning strip, full bleed
  segment: 10px                     # a segment of the Mode control
  button: 12px                      # theme.shape.borderRadius: buttons, fields, composer, Send, user bubbles, alerts
  panel: 14px                       # the preview chart card, the Mode control's track, a phone tab
  card: 16px                        # outlined cards, settings sections, the live strip
  note-bubble: 16px 16px 16px 6px   # the coach note; the corner nearest the avatar stays tight
  chip: 24px                        # option chips, half their 48 px height
  full: 9999px                      # dots, swatches, the coach avatar, the hue rail and thumb, the phone tab pill
spacing:
  base: 8px            # MUI theme.spacing(1): an sx spacing number n is n x 8 px
  3xs: 2px             # 0.25
  2xs: 4px             # 0.5: nav items apart, the composer's padding
  xs: 6px              # 0.75
  sm: 8px              # 1: between buttons, chips and readout columns
  sm-md: 10px          # 1.25: between the blocks of the machine column and of the Shot view
  md: 12px             # 1.5: card padding, the side padding of the bars and the machine column
  md-lg: 14px          # 1.75: the Shot view's top and bottom, the note bubble's sides
  lg: 16px             # 2: screen padding, settings sections, gaps between sections
  xl: 20px             # 2.5: the Shot view's sides
  2xl: 24px            # 3: the sides of Confirm, Send and Save; empty-state padding
  3xl: 32px            # 4: the sides of the large New bag button
  touch-target: 48px   # the floor for anything tappable
components:
  button-primary:          # contained: the one main action (Espresso, Confirm, Use this, Send, Save)
    backgroundColor: "{colors.crema-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 24px
    height: 48px
  button-tonal:            # every secondary action (Undo, New bag, Export, Exit, Steam, Sleep, Tare)
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  button-tonal-hover:      # only under @media (hover: hover)
    backgroundColor: "{colors.bar-raised-hover}"
    textColor: "{colors.ink}"
  button-tonal-disabled:
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink-disabled}"
  button-text:             # tertiary, in the accent (Not now, Graph, Keep it)
    textColor: "{colors.crema-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  button-text-muted:       # the way out to Decaid's settings
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 12px
    height: 48px
  button-espresso:         # the start row's primary
    backgroundColor: "{colors.crema-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button-start}"
    rounded: "{rounded.button}"
    padding: 6px 4px
    height: 60px
  button-start:            # Steam, Flush, Hot water
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button-start}"
    rounded: "{rounded.button}"
    padding: 6px 4px
    height: 60px
  button-machine-row:      # Sleep or Wake, Tare
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 8px
    height: 52px
  button-stop-idle:        # nothing running: a disabled tonal button in its fixed cell
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink-disabled}"
    typography: "{typography.button-stop}"
    rounded: "{rounded.button}"
    height: 52px
  button-stop-live:        # the machine runs anything: a shot, steam, flush, hot water
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.button-stop}"
    rounded: "{rounded.button}"
    height: 60px
  top-bar:                 # tablet
    backgroundColor: "{colors.bar-surface}"
    padding: 0 12px
    height: 56px
  nav-item:
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  nav-item-active:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.crema-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  top-bar-phone:           # in flux
    backgroundColor: "{colors.bar-surface}"
    padding: 0 10px 0 16px
    height: 52px
  tab-bar:                 # phone upright, plus the bottom safe-area inset (in flux)
    backgroundColor: "{colors.bar-surface}"
    padding: 6px
    height: 64px
  side-rail:               # phone on its side, plus the left safe-area inset (in flux)
    backgroundColor: "{colors.bar-surface}"
    padding: 8px 6px
    width: 80px
  tab:                     # 60 px tall in the rail
    textColor: "{colors.ink-muted}"
    typography: "{typography.tab-label}"
    rounded: "{rounded.panel}"
    height: 48px
  tab-active:
    textColor: "{colors.crema-accent}"
    typography: "{typography.tab-label}"
    rounded: "{rounded.panel}"
    height: 48px
  tab-active-pill:         # behind the current tab's icon
    backgroundColor: "{colors.accent-wash}"
    rounded: "{rounded.full}"
    width: 58px
    height: 30px
  machine-column:          # 340 px below 1200 px wide, 400 px below 1600 px, 480 px from 1600 px
    backgroundColor: "{colors.bar-background}"
    padding: 10px 12px
    width: 340px
  shot-view:               # the tablet's main pane during a shot
    backgroundColor: "{colors.bar-background}"
    padding: 14px 20px
  bag-header:
    backgroundColor: "{colors.bar-background}"
    padding: 4px 12px
    height: 64px
  card:                    # outlined, with a 1 px line border
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 12px
  settings-section:
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 16px
  empty-state-card:
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 24px
    width: 460px
  preview-chart:           # the machine column's graph, one button to the Shot view
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: 10px 12px 8px
  readout:
    textColor: "{colors.ink}"
    typography: "{typography.readout}"
  readout-label:
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
  readout-large:
    textColor: "{colors.ink}"
    typography: "{typography.readout-large}"
  shot-timer:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  live-dot:
    backgroundColor: "{colors.live}"
    rounded: "{rounded.full}"
    size: 9px
  connection-dot:          # filled when connected; a hollow 2 px ring when not
    backgroundColor: "{colors.success}"
    rounded: "{rounded.full}"
    size: 10px
  coach-note-bubble:
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.note-bubble}"
    padding: 8.8px 14px
    width: 520px
  coach-note-avatar:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.crema-accent}"
    rounded: "{rounded.full}"
    size: 34px
  live-strip:              # phone, top of the Coach tab while a shot is live (in flux)
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 0 10px 0 14px
    height: 64px
  chat-lane:
    width: 680px
  user-bubble:
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: 8px 12px
  composer:
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: 4px
    width: 760px
  composer-send:
    backgroundColor: "{colors.crema-accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.button}"
    size: 48px
  chip-option:             # outlined at rest
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.chip}"
    padding: 0 18px
    height: 48px
  chip-option-chosen:
    backgroundColor: "{colors.crema-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.chip}"
    padding: 0 18px
    height: 48px
  text-field:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: 48px
  mode-control:
    backgroundColor: "{colors.bar-raised}"
    rounded: "{rounded.panel}"
    padding: 4px
  mode-segment:
    textColor: "{colors.ink-muted}"
    typography: "{typography.button-small}"
    rounded: "{rounded.segment}"
    height: 48px
  mode-segment-selected:
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button-small}"
    rounded: "{rounded.segment}"
    height: 48px
  tint-swatch:             # a 9 px ring of the tint's accent around its background
    rounded: "{rounded.full}"
    size: 48px
  hue-rail:
    rounded: "{rounded.full}"
    height: 30px
  hue-thumb:               # the accent inside a 4 px white ring
    backgroundColor: "{colors.crema-accent}"
    rounded: "{rounded.full}"
    size: 36px
---

## 1. Overview: The Barista's Instrument

> **As built** on branch `feat/ux-modes-theme`, 7 October 2026. UX stage 1 (palette, theme, Figtree) and stage 2 (Appearance) are in; stage 3 (layouts and shot focus) is landing now. The sources of truth are `src/ui/palette.ts`, `src/ui/color.ts`, `src/ui/theme.ts` and the components under `src/ui/`; the why is in the spec (`docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md`) and DECISIONS.md D80 to D86. Where the spec and the code differ, this file follows the code and says so. Anything marked *(in flux)* (the tablet's Shot nav item, the phone's top bar, tabs, rail, live strip and on-its-side Machine tab) comes from the stage 3 shell code, which was written but not yet committed when this was: it matches the spec, the stage 3 plan and the mockups, and if it changes before it lands, the code wins.

**Creative North Star: The Barista's Instrument.** CafAI is a chat-first AI espresso dial-in coach that runs as a web skin inside Decaid, the Decent Espresso app: on the tablet mounted on a DE1 (962x602 CSS px and up, in a WebView as old as Chromium 91) and in phone browsers. The barista reads it from a step back, often with wet hands and a cup in the other, in morning daylight or evening lamplight. It should feel like a good espresso scale or a well-made grinder: calm, precise, warm, and quiet until it matters.

An instrument earns trust by being legible and by holding still. CafAI draws with tone instead of outlines and shadows (three layers of one tinted neutral), keeps its one accent for the thing to press, prints big tabular numbers, and plots a shot the way Decent's own charts do (pressure green, flow blue). When a shot starts, the shot comes first: the main pane becomes the graph, Stop stays under the thumb it was under, nothing moves, and the coach says only that it is watching. Every change to the machine is written in plain words and waits for the barista's tap, and there is always a way out to Decaid.

It rejects the SaaS dashboard (metric tiles, sidebars full of charts, enterprise chrome), glassy gradients, glassmorphism and glow used as decoration, and the cartoon coffee shop (mascots, latte-art clip art, novelty fonts). It also rejects anything that needs a squint or a fingertip: small type, thin tap targets, hover-only controls.

### Two layouts

The layout is a pure function of the viewport (`src/ui/shell/layout.ts`), read again on every resize and rotation.

- **Tablet**, at least 800 px wide and 500 px tall (every Decent tablet: 962x602, 1007x602, 1140x712; iPads either way up, except an iPad mini upright). A 56 px top bar carries the navigation (Coach · Shot · History · Settings) and the ways out. Under it, a **machine column** on the left (status, controls, a preview chart) and a **main pane** on the right with the routed screen. When a shot starts, the main pane becomes the big graph (the Shot view) by itself, and the machine column stays exactly where it was.
- **Phone**, anything smaller. One screen at a time under a 52 px top bar, with tabs **Coach · Machine · History · Settings** along the bottom, or as a side rail when the phone lies on its side (under 500 px tall). The Machine tab is the machine column at full width, with the big graph under the buttons.

In both, the page never scrolls (each region scrolls inside itself), there are no edge gestures (an Android edge swipe leaves the skin), safe-area insets reach the layout only through the `--safe-top`, `--safe-right`, `--safe-bottom` and `--safe-left` CSS variables, and Exit and Decaid settings are on every screen. The route `#/shot` is the Shot view on a tablet and the Machine tab on a phone, so crossing the breakpoint keeps the screen.

### Key Characteristics

- One tint, in light or dark, drives every neutral and the accent: seven named tints plus a hue slider. The colours that carry meaning (success, warning, error, info, the live dot, the graph series) never follow it.
- Colours are designed in OKLCH and shipped as plain hex, because the Chromium 91 WebView understands neither `oklch()` nor `color-mix()`.
- Contrast is enforced by a unit test across every named tint and every hue 0-359, in both modes.
- Tonal layering (background, surface, raised) with 1 px tinted lines; no shadows at rest.
- Figtree everywhere, sentence case, tabular figures for anything that changes live.
- 48 px minimum touch targets, 60 px start buttons; controls disable instead of disappearing.
- The accent marks the primary action and the current selection.
- The shot graph is Decent's: bar and ml/s on one 0-12 axis, pressure on top, the tint never on the plot.
- Motion is short (150 to 250 ms), eased out, never bouncy, and still under reduced motion.

## 2. Colors: The Tinted Bar

One tint colours the whole bar. A tint is three numbers: an OKLCH hue, the accent's chroma, and the neutral chroma (how far the backgrounds, text and lines lean toward that hue). `buildPalette(mode, tint)` in `src/ui/palette.ts` turns a tint and a mode into every colour the app draws. `src/ui/color.ts` converts OKLCH to sRGB hex in TypeScript; a colour outside sRGB keeps its lightness and hue and loses chroma until it fits, so a strong accent at an awkward hue gets duller, never lighter or darker, and the contrast tuning holds. `createCafaiTheme(palette)` in `src/ui/theme.ts` maps the palette onto MUI, and components read colours only through the theme.

The default look is **dark Crema**: the frontmatter tokens are its values. The tables below add light mode and the other tints.

### Roles

| Token | palette.ts | Read it as (MUI sx) | Dark Crema | Light Crema | Used for |
|---|---|---|---|---|---|
| bar-background | background | `background.default` | #140e09 | #faf6f2 | the page, the machine column, the main pane |
| bar-surface | surface | `background.paper` | #1c160f | #fffdfb | top bar, tab bar, cards, composer, preview chart, the chosen Mode segment |
| bar-raised | raised | `cafai.raised` | #282018 | #f2ece5 | tonal buttons, user bubbles, the coach note, the Mode track |
| bar-raised-hover | (theme.ts) | tonal variant only | #383028 | #e6e0d8 | a tonal button under a pointer (ink at 8% over raised dark, 6% light) |
| ink | ink | `text.primary` | #f4ede6 | #261d14 | text, values |
| ink-muted | inkMuted | `text.secondary` | #b8afa6 | #66584a | labels, units, helper text, inactive nav, axis labels |
| ink-disabled | (theme.ts) | tonal variant only | #766e66 | #a49d96 | a disabled tonal button's label (ink at 38% over raised) |
| line | line | `divider` | #2f2924 | #dcd8d3 | dividers, card borders, bar edges |
| crema-accent | accent | `primary.main` | #d5a776 | #835928 | primary actions and the current selection |
| accent-wash | accentSoft | `cafai.accentSoft` | #3a2d1f | #f0e9e2 | behind the current nav item and tab icon, the live strip, the coach's avatar |
| on-accent | onAccent | `primary.contrastText` | #1e1408 | #fefbf8 | text and icons on the accent |
| graph-grid | graph.grid | `cafai.graph.grid` | #26201b | #e9e5e0 | the plot's grid lines |
| graph-axis | graph.axis | `cafai.graph.axis` | #b8afa6 | #66584a | the plot's axis labels (ink-muted) |

`crema-accent` is simply "the accent" in the default tint; in Matcha it is Matcha's accent. MUI's `secondary` is set to ink-muted only so that nothing falls back to MUI's purple: CafAI has no secondary colour.

### Fixed colours

The same in every tint (`palette.test.ts` asserts it). OKLCH lightness, chroma and hue, then the hex.

| Token | Read it as | Dark (L, C, h) | Dark | Light (L, C, h) | Light | Used for |
|---|---|---|---|---|---|---|
| success | `success.main` | 0.80, 0.14, 155 | #6ad895 | 0.50, 0.13, 155 | #007742 | connection dots, "This bag", a saved change, the active version |
| warning | `warning.main` | 0.83, 0.13, 85 | #eec05b | 0.52, 0.12, 75 | #8d5e00 | low water, "not confirmed", possible channeling, the rating stars |
| error | `error.main` | 0.72, 0.15, 25 | #f47b74 | 0.53, 0.18, 25 | #be2e31 | Stop while running, failures, Forget key |
| on-error | `error.contrastText` | 0.20, 0.02, 25 | #1e1311 | 0.99, 0.005, 25 | #fffbfa | text on a filled error button |
| info | `info.main` | 0.74, 0.12, 245 | #65b2f1 | 0.52, 0.15, 250 | #006bb9 | MUI info alerts (an info notice in the chat is drawn in ink-muted) |
| live | `cafai.live` | 0.68, 0.19, 25 | #f75d59 | 0.58, 0.20, 25 | #d73337 | the pulsing live-shot dot |
| graph-pressure | `cafai.graph.pressure` | 0.80, 0.14, 160 | #5ed99e | 0.55, 0.14, 160 | #008758 | pressure (bar) and its target |
| graph-flow | `cafai.graph.flow` | 0.74, 0.12, 245 | #65b2f1 | 0.52, 0.15, 250 | #006bb9 | flow (ml/s) and its target |
| graph-weight-flow | `cafai.graph.weightFlow` | 0.78, 0.13, 55 | #f7a062 | 0.62, 0.15, 55 | #c9690c | weight flow (g/s) |
| graph-weight | `cafai.graph.weight` | 0.82, 0.05, 70 | #dabfa2 | 0.55, 0.06, 65 | #8a6a4c | cup weight (g) and its right-hand axis |

The spec started light-mode success at 0.55, 0.14 and warning at 0.60, 0.13; both failed the contrast sweep and became 0.50, 0.13 and 0.52, 0.12 (D80). The mockups still show the older, brighter light-mode success and warning.

### How the tinted roles are built

`n` is the tint's neutral chroma, `c` its accent chroma; every role takes the tint's hue. "X at p% over Y" is computed to an opaque hex by `blend()`: nothing in the palette is translucent.

| Role | Dark (L, C) | Light (L, C) |
|---|---|---|
| background | 0.17, n | 0.975, 0.5n |
| surface | 0.205, 1.15n | 0.995, 0.25n |
| raised | 0.25, 1.3n | 0.945, 0.8n |
| ink | 0.95, 0.9n | 0.24, 1.5n |
| inkMuted | 0.76, 1.2n | 0.47, 2n |
| line | ink at 12% over background | ink at 14% over background |
| accent | 0.76, c (Steel 0.88) | 0.50, c (Steel 0.36) |
| accentSoft | accent at 16% over surface | accent at 12% over surface |
| onAccent | 0.20, 2n | 0.99, 0.005 |
| graph grid | ink at 8% over background | ink at 8% over background |

### The tints

The order is the order of the Appearance settings.

| Id | Name | Hue | Accent chroma | Neutral chroma | Accent, dark | Accent, light | Background, dark | Background, light |
|---|---|---|---|---|---|---|---|---|
| crema | Crema (default) | 68 | 0.085 | 0.014 | #d5a776 | #835928 | #140e09 | #faf6f2 |
| matcha | Matcha | 138 | 0.11 | 0.014 | #8ec27d | #417230 | #0c110b | #f4f8f3 |
| lagoon | Lagoon | 200 | 0.09 | 0.014 | #64c3c8 | #007176 | #081112 | #f2f8f9 |
| ocean | Ocean | 250 | 0.12 | 0.016 | #73b6fa | #2266a4 | #0a1016 | #f3f7fc |
| plum | Plum | 320 | 0.11 | 0.014 | #d09add | #7e4d8a | #120d13 | #f9f5fa |
| cherry | Cherry | 22 | 0.13 | 0.014 | #f98e8b | #a03f40 | #150d0d | #fbf5f5 |
| steel | Steel | 250 | 0.025 | 0.006 | #ccd9e8 | #333e4a | #0d1012 | #f5f7f9 |
| (custom) | Custom | 0-359 | 0.11 | 0.014 | from the slider | | | |

**Steel** is nearly grey, so at the usual accent lightness its accent would read like muted text. It takes its own accent lightness, 0.88 in dark and 0.36 in light (`accentLightness` in palette.ts), so its buttons and selection still stand apart. **Custom** is any whole degree from the hue slider (rounded and wrapped into 0-359), with accent chroma 0.11 and neutral chroma 0.014.

The appearance is a setting, `{ mode: 'dark' | 'light' | 'auto', tint: <id> | { hue } }`, default dark Crema (D82). It is saved, mirrored to Decaid and exported with the other settings. Auto follows `prefers-color-scheme` and shows light wherever the WebView never reports dark. Themes are built once per mode and tint, so switching back costs nothing, and the last resolved background, surface, ink, muted, line and accent are kept in localStorage (`cafai.appearance.boot`) so the "Starting CafAI…" screen and the watchdog page in `index.html` open in the barista's colours.

### The One Tint Rule

Every neutral and the accent come from the tint; nothing is picked by eye. A component never writes a hex: it reads the theme (`primary.main`, `background.default`, `background.paper`, `text.primary`, `text.secondary`, `divider`, `cafai.raised`, `cafai.accentSoft`, `cafai.live`, `cafai.graph.*`). The neutrals are never plain grey: they carry the tint's neutral chroma, so a Matcha CafAI has green-black backgrounds and green-white text. A new colour is a new role in `buildPalette`, with its pairs added to the contrast sweep. Apart from the boot pages' fallbacks in `index.html`, the only literal colours are the hue slider thumb's white ring and two small black shadows (section 4).

### The Accent Is For Action Rule

The accent marks the primary action of a screen or region (a contained button: Espresso, Confirm, Use this, Send, Save) and the current selection (the current nav item and tab, a chosen chip, the chosen starting profile's border, the pending change's border, the hue thumb, the focus ring). Text buttons that act take it too (Not now, Graph). Beyond that it appears only as a few small marks of CafAI itself: the wordmark, the coach's avatar, the cup on a shot card, the hand on a by-hand step, the chevron of the preview chart, the medium-confidence chip on a starting profile, and the one large icon of an empty state. It is never a heading colour, never a background for decoration, never on the plot, and there is no second accent.

### The Graph Keeps Its Colours Rule

The shot graph follows Decent's convention whatever the tint: pressure green, flow blue, weight flow orange, cup weight tan. The accent never draws a series, even when Ocean's accent and the flow line share a hue. The same fixed-hue idea holds for success, warning, error, info and the live dot: meaning never changes colour with the tint.

### The Contrast Is Tested Rule

`src/ui/palette.test.ts` builds the palette for every named tint and every custom hue 0-359, in both modes (734 palettes), and fails on any pair the UI draws that falls below its minimum. The worst cases measured across the sweep:

| Pair | Minimum | Worst, dark | Worst, light |
|---|---|---|---|
| ink on background, surface, raised | 7:1 | 13.69 | 13.86 |
| ink-muted on background, surface, raised | 4.5:1 | 7.38 | 5.72 |
| accent on background and surface (nav labels, links, text buttons) | 4.5:1 | 7.94 | 5.26 |
| accent on accent-wash (the current nav item's label) | 4.5:1 | 5.95 | 4.70 |
| on-accent on accent (filled buttons, chosen chips) | 4.5:1 | 8.02 | 5.50 |
| success, warning, error, info on background and surface | 4.5:1 | 6.71 | 4.91 |
| on-error on error (Stop while running) | 4.5:1 | 6.86 | 5.16 |
| each graph series on background and surface | 3:1 | 7.77 | 3.53 |

Some pairs the UI draws are not in the sweep. Ink and ink-muted on the accent wash (the live strip's title and numbers) measure 10.54 and 5.49:1 at worst and pass. Status colours on raised (the tonal "Forget key" button in Settings, `variant="tonal" color="error"`) are in the sweep: light-mode error was darkened from lightness 0.55 to 0.53 so it passes there too (4.90:1 at worst; 5.97:1 in dark). Colours MUI derives itself (the text of its Alerts, disabled controls) are outside the sweep.

### The Hex Only Rule

Chromium 91 has no `oklch()`, no `color-mix()`, no relative colour syntax and no container queries. Every colour reaches CSS as `#rrggbb`, MUI runs without `cssVariables` (its CSS-variable mode can emit `color-mix()`), and the one place that needs many hues, the hue slider's rail, is 13 hex stops computed by `oklch()` in TypeScript. Translucency, where MUI adds it (hover and disabled states, ripples), arrives as `rgba()`.

### The Words Beside The Colour Rule

Colour is never the only signal. Connection dots sit beside "Machine connected" or "No machine", the profile mark says "This bag" or "not confirmed", every graph series has a label and a value, and states are written in words ("Ready", "Pulling a shot: pour", "Can't reach Decaid").

## 3. Typography: Read From a Step Back

**Figtree** sets every word: the variable font (weights 300 to 900) from `@fontsource-variable/figtree`, latin subset only, upright and italic (the chat renders `*emphasis*` in the true italic), about 20 KB per face, bundled and offline with `font-display: swap` (`src/ui/fonts.css`). Figtree's latin subset has ↑ and ↓ but not → or ←, so **CafAI Symbols**, Roboto's symbols subset at 400, 500 and 700 under a family name of its own (`src/ui/fonts-symbols.css`, unicode-range U+2190, U+2192, U+2194-2199), comes next in the stack and is fetched only when such a glyph is on screen ("18.0 g → 40.4 g", "Dose → yield"). The stack is `FONT_FAMILY` in `theme.ts`:

```
"Figtree", "CafAI Symbols", system-ui, "Helvetica", "Arial", sans-serif
```

Use the theme's variants rather than setting sizes by hand. Because Figtree is variable, CafAI uses the in-between weights: 400 for reading, 550 for labels and quiet emphasis, 600 for buttons and strong words, 650 for numbers and headings, 700 for titles and Stop, 750 for the wordmark.

### The scale

Fixed rem sizes (product register), about 1.125 to 1.2 between steps. "Tabular" means `font-variant-numeric: tabular-nums`.

| Token | MUI variant | Size | Weight | Line height | Tracking | Figures | Use |
|---|---|---|---|---|---|---|---|
| display | `display` | 2.875rem (46 px) | 650 | 1 | -0.02em | tabular | the Shot view's pour timer (2.125rem, 34 px, below 600 px wide) |
| readout-large | `readoutLarge` | 1.875rem (30 px) | 650 | 1.1 | -0.01em | tabular | the Shot view's readouts (1.5rem below 900 px wide, 1.125rem below 600 px) |
| (unused) | `h4` | 1.75rem | 650 | 1.2 | -0.015em | | defined, not used |
| headline | `h5` | 1.4375rem (23 px) | 650 | 1.2 | -0.01em | | the machine's state line ("Ready", "Pulling a shot: pour") |
| title | `h6` | 1.1875rem (19 px) | 700 | 1.3 | -0.005em | | screen titles, empty-state titles; the bag picker is set to match |
| subtitle | `subtitle1` | 1.0625rem (17 px) | 650 | 1.35 | 0 | | card titles (set to 700), names and questions (set to 600), graph captions, the profile name |
| (live strip) | `subtitle2` | 0.9375rem (15 px) | 600 | 1.4 | 0 | | the live strip's "Live shot" (set to 700) |
| body | `body1` | 1rem (16 px) | 400 | 1.55 | 0 | | chat text (1.5 in the chat), change lines, body copy |
| body-small | `body2` | 0.9375rem (15 px) | 400 | 1.5 | 0 | | secondary text, notices, helper text, the coach's note |
| readout | `readout` | 1.1875rem (19 px) | 650 | 1.2 | 0 | tabular | the machine column's readouts |
| metric | `body1` at 650 | 1rem | 650 | 1.55 | 0 | tabular | the numbers on a shot card |
| label | `label` | 0.8125rem (13 px) | 550 | 1.3 | 0 | | readout and field labels, swatch names, the profile line's label |
| caption | `caption` | 0.8125rem (13 px) | 400 | 1.35 | 0 | | legend, "target 98.5", the Exit button's "to Decaid" |
| button | `button` | 1rem (16 px) | 600 | 1.25 | 0.005em | | every button (start buttons 0.9375rem at line height 1.15; Stop 1.0625rem at 700) |
| wordmark | (sx) | 1.1875rem (19 px) | 750 | 1.55 | 0.005em | | "CafAI" in the top bar, in the accent |

`overline` is kept for any stray use but set like `label`, in sentence case. Headings `h1` to `h3` get `text-wrap: balance` (Chromium 91 ignores it, harmlessly).

### Case and words

- **Sentence case everywhere**: "Group", not "GROUP"; "Hot water", "New bag", "Decaid settings". Buttons, tabs and toggles have `textTransform: none`; there is no uppercase overline or eyebrow.
- **The middle dot joins facts**: "v4 · Blooming Espresso", "Pour · step 3 of 3", "60.6 s · 18.0 g → 40.4 g · 1:2.2 · peak 5.4 bar", the nav's "Coach · Shot · History · Settings".
- **The arrow shows a change**: "18.0 g → 40.4 g" (the glyph, from CafAI Symbols); the change card draws an arrow icon instead.
- **Work in progress ends in an ellipsis**: "Thinking…", "Loading v5 onto the machine…", "loading…".
- **No em dashes in copy**, and plain words for states: "Ready", "Not connected", "Can't reach Decaid", "Not applied. Nothing changed on the machine."

### Numbers

- Anything that changes live is set in tabular figures: the timer, the readouts, the legend values, the shot card's metrics, the live strip, the pour time in the navigation.
- One decimal for live readings ("5.0 bar", "42.0 s", "97.7 °C"), whole numbers where a decimal is noise ("148 °C" steam, "31 mm" water, "42 s" in the phone's Machine tab).
- A space always separates the number and its unit. In the machine column the unit is set smaller and quieter: 0.68em, weight 550, ink-muted. In the Shot view's readouts, the graph legend and the timer, the number and the unit are one string at one size, because the paint loop rewrites it every frame; the mockups and the spec's "units at about 0.6em" show them smaller there, and the code does not (yet). The Shot view's weight target, "of 50", is 0.5em, weight 550, ink-muted.
- A reading the machine has not given shows a dash, never a 0 and never a unit alone; legend values stay blank until there is a shot.

### Line length and small print

The chat lane is capped at 680 px (about 70 characters at 16 px) and the composer at 760 px, both centred in a wide pane. Other measures: the Settings column 760 px, the coach's note 520 px, a notice with a progress bar 480 px, an empty-state card 460 px. The floor for text is 13 px (`label`, `caption`); only the plot's axis numbers (12 px), the phone's tab labels (12.5 px) and the phone Shot view's readout labels (11.5 px) go below it.

## 4. Elevation: Tone, Not Shadow

CafAI is flat and tonal. Depth comes from three layers of the tinted neutral and from 1 px lines, never from shadows.

| Layer | Dark L | Light L | Holds |
|---|---|---|---|
| background | 0.17 | 0.975 | the page, the machine column, the main pane, the Shot view, the bag header |
| surface | 0.205 | 0.995 | the bars, cards, settings sections, the composer, the preview chart |
| raised | 0.25 | 0.945 | tonal buttons, user bubbles, the coach's note, the Mode track |

In dark mode each layer is a step lighter than the one under it. In light mode the surface is the lightest (cards read as paper on the page) and raised is a step darker than the page, so a tonal fill reads as pressed in, not lifted.

- **Lines**: a 1 px `line` border on every card and along the edges of regions (under the top bar, right of the machine column and of the phone's rail, under the bag header and the History header, above the phone's tab bar). Emphasis is a full border, never a stripe: 2 px in the accent for the pending change and the chosen starting profile, 1 px in success for the active version in History.
- **No shadows at rest.** Buttons have `disableElevation`; outlined Paper is the card; `MuiPaper` sets `backgroundImage: none`, so MUI's dark-mode elevation overlays never grey the tinted surfaces. The few shadows that exist are small and functional: the chosen Mode segment (`0 1px 2px` black at 35% in dark, 14% in light), the hue slider's thumb (`0 1px 4px` black at 50%, so it reads over any hue, plus a 10 px accent halo at 24% while dragged), x-chat's scroll-to-newest button (surface, 1 px line, MUI shadow 2) when the barista has scrolled up, and MUI's own shadow on the app's two dialogs.
- **The one ring**: the chosen tint swatch gets a 3 px gap in the surface colour and then a 2.5 px ring in ink (not the accent, so it reads around every swatch colour). Nothing else wears a ring at rest.
- **Focus rings for the keyboard only**: the theme's `focusVisible` draws a 2 px solid accent outline 2 px outside the control, on `:focus-visible` only, so touch users never see it. The composer is the one exception: x-chat gives it an accent border and a 1 px accent ring on `:focus-within`, which shows on touch too and marks the typing state. Tap highlights are transparent, and a long press on a button neither selects its label nor opens a callout.
- **Layering in the main pane**: on the shot route the Shot view sits over the coach, which stays mounted (hidden) underneath. The 350 ms tap guard after an automatic switch is a transparent sheet, never a visible scrim.

## 5. Components: Controls That Keep Their Place

Everything here is MUI 9 with CafAI's theme, plus x-chat for the thread and uPlot for the graph. Icons are Material Icons, the Rounded set in the shell and the machine column.

### Buttons

| Kind | MUI | Fill and text | Height | Used for |
|---|---|---|---|---|
| Primary | `variant="contained"` | accent, on-accent | 48 px | the one main action of a region or card: Espresso (60 px), Confirm, Use this, Send, Save key, Save settings, Open Settings; the empty state's New bag (`size="large"`, 56 px) |
| Tonal | `variant="tonal"` | raised, ink; hover ink at 8% over raised | 48 px | every secondary action: Steam, Flush, Hot water, Sleep or Wake, Tare, Undo, New bag in the bag header, Export, Import, Exit |
| Tonal, coloured | `variant="tonal" color="error"` (also `warning`, `success`) | raised, the status colour | 48 px | Forget key |
| Text | `variant="text"` | none, accent | 48 px | the quiet choice beside a primary (Not now, Keep it), the shot card's Graph link, the dialogs' Download file and Copy; Decaid settings is a text button in ink-muted |
| Destructive | `variant="contained" color="error"` | error, on-error | 48 to 60 px | Stop while the machine runs, the dialog's Forget key |

- **Touch targets**: the theme makes Button, IconButton, ToggleButton, Tab, ListItemButton, MenuItem and every clickable or deletable Chip at least 48 px (`TOUCH_TARGET`); text fields and native selects are 48 px too. The start buttons are 60 px and the Stop, Sleep and Tare row 52 px. Only status chips, which are not tappable, stay compact.
- **Shape**: radius 12, 16 px sides (24 px on the screen's main action), `disableElevation`, sentence case, a Rounded icon before the label where it helps recognition.
- **Hover** exists only under `@media (hover: hover)`; nothing depends on it.
- **Disabled, never removed**: a control that cannot act right now is disabled in place. A disabled tonal button keeps its raised fill and dims its label to `ink-disabled`; a disabled contained button takes MUI's default disabled fill and text.
- **Pending**: a tapped machine button shows MUI's loading spinner in its own place; a command is sent once per tap and never retried on its own, and a failure is shown under the buttons in plain words.
- **Stop, as built**: whenever nothing is running, Stop is a disabled tonal button (raised fill, dimmed label, a square stop icon) in the wide first cell of the second row. Whenever the machine runs anything (a shot, steam, flush, hot water, cleaning, descaling), it is enabled and becomes the filled error button, 60 px tall, weight 700, with on-error text. The row grows from 52 to 60 px downward, so nothing above it moves. The spec describes an idle Stop with error-coloured text; in the code Stop is never enabled without being filled, so that look does not appear.

### The shell

`src/ui/shell/AppShell.tsx` draws both shells. Its stage 3 rewrite (with `LiveStrip.tsx`, `ShotTime.tsx` and `TapGuard.tsx`) was on disk but not yet committed when this was written, so the parts marked *(in flux)* describe that working code and may still move.

**Tablet**

- **Top bar**: 56 px, surface, a 1 px line below, 12 px sides, 8 px gaps. Left to right: the wordmark (a cup icon and "CafAI" in the accent, 19 px, weight 750); the navigation **Coach · Shot · History · Settings**, 4 px apart, each a 48 px text button with a Rounded icon and 16 px sides, the current one in the accent on the accent wash (`aria-current="page"`), the others ink-muted; a spacer; **Decaid settings**, an ink-muted text button with an "opens elsewhere" icon; and **Exit**, tonal, with a logout icon and two lines: "Exit" over a muted caption "to Decaid" ("Skins" outside Decaid). While a shot runs, the Shot item swaps its chart icon for the 9 px live dot and adds the pour time in ink, "Shot 42.0 s", in tabular figures inside a box 3.3em wide so the label never grows *(in flux)*.
- **Old-engine warning**: a full-width warning strip right under the top bar (square corners, 14 px text, a line below, a dismiss button) that pushes the columns down instead of covering a control.
- **Machine column**: 340 px wide below 1200 px, 400 px below 1600 px, 480 px from 1600 px (`machineColumnWidth` in `layout.ts`, D84; the shell committed before stage 3 used 360, 420 and 520 px on MUI breakpoints). It sits on the page background with a 1 px line on its right, 12 px sides, 10 px above, below and between blocks, and scrolls inside itself: status, then the controls, then the preview chart filling what is left.
- **Main pane**: the routed screen, scrolling inside itself. On the shot route the Shot view (20 px sides, 14 px top and bottom, 10 px gaps) covers the coach, which stays mounted so its scroll and draft survive; the preview chart hides meanwhile, and the controls above it keep their places. For 350 ms after an automatic switch the main pane ignores taps; the machine column, Stop included, never does.

**Phone** *(in flux)*

- **Top bar**: 52 px, surface, a line below, 16 px left and 10 px right, 6 px gaps: the wordmark, a spacer, **Decaid** (an ink-muted text button with the same "opens elsewhere" icon) and **Exit** (tonal, one line). Both on every screen.
- **Tabs**: **Coach · Machine · History · Settings** (speech, coffee maker, history and gear icons), on surface. Upright, a bottom bar 64 px tall plus the bottom safe-area inset, a line on top, the four tabs in equal columns inside 6 px of padding. On its side (under 500 px tall), a side rail 80 px wide plus the left inset, a line on its right, the same four stacked 4 px apart and centred, the content to its right. Each tab is a button at least 48 px square (60 px tall in the rail), radius 14: its icon in a 58x30 pill above a 12.5 px label at 650. The current tab's label is in the accent and its pill fills with the accent wash; the others are ink-muted on no fill. The tabs hide while a text field has focus, so the keyboard does not leave the chat a few lines tall, and come back on blur; they are navigation only. While the barista types, the layout also holds still: a keyboard that shortens the window never turns a tablet into a phone mid-sentence and takes Stop away.
- **Machine tab**: the machine column at full width, with the full graph and the coach's note under the buttons. On a phone on its side the panel splits in two: status and buttons in a left column (45%, scrolling if it must), the graph and the note at full height on the right (`MachinePanel columns={2}`). While a shot runs, the tab shows a 7 px live dot and the whole seconds ("42 s", in ink) in place of its label, and is named "Machine, shot running" for screen readers.
- **Live strip**: at the top of the Coach tab while a shot is live or its outcome is still on its way to the chat. One 64 px button to the Machine tab on the accent wash, radius 16, 10 px from the top and 12 px from the sides, padded 14 px left and 10 px right, with 10 px gaps: the 9 px live dot and "Live shot" ("Last shot" once the pour is over) in 15 px at 700; under it the time (ink, 650) and " · 11.5 g · 5.0 bar" (13.5 px, 550, ink-muted, tabular); a 104x38 chart of pressure and flow (2 px lines, round caps, pressure on top); an ink-muted chevron. It goes once the outcome is in the chat.

**Decaid's exit hint**: for 10 s after the skin opens, Decaid floats an exit-hint snackbar over the bottom of the screen. Nothing that must be tapped lives there: the machine column puts the graph lowest, the phone's bottom tabs are navigation only, and Stop is never at the bottom.

### Machine status

`src/ui/machine/MachineStatus.tsx`. Each readout is its own small component, so a telemetry tick re-renders only the number that changed.

- **Connection row**: "Machine connected" or "No machine", "Scale connected" or "No scale", in body-small, 16 px apart, each after a 10 px dot: filled success when connected, a hollow 2 px ring in MUI's disabled text colour when not. "Can't reach Decaid" joins in warning once an outage has lasted 2.5 s.
- **State line**: headline (h5), polite live region: "Ready", "Heating", "Sleeping", "Pulling a shot: pour" (the running step's name from the profile, when it has one).
- **Readouts**: Group, Steam, Water, Scale in a four-column grid with 8 px between columns. Each is a label (13 px, 550, ink-muted), the value in `readout` with its unit at 0.68em, weight 550, ink-muted, and a caption line under it ("target 98.5", "No scale", or "Refill" in warning, when the value turns warning too). A missing value is a dash.
- **Profile line**: the label "Profile", then the profile's title on one line (subtitle, cut with an ellipsis, the full title in its tooltip) and a mark that keeps its place: "This bag" (success, with a check), "loading…" (ink-muted), "not confirmed" (warning, with an outlined alert icon). Offline, a muted caption says "Decaid loads it when the machine connects".
- **Device error**: an outlined MUI Alert in error or warning, 14 px text, dismissible.

### Machine controls

`src/ui/machine/MachineControls.tsx`. Water moves when these run, so their rules are strict: a tap sends once, a failure is shown and never retried, and every control keeps its place whatever the machine is doing.

- **Start row**: four equal columns, 8 px apart: **Espresso** (contained, accent), **Steam**, **Flush**, **Hot water** (tonal). Each is 60 px tall with its icon above a 15 px label at line height 1.15 and 4 px sides.
- **Second row**: a `2fr 1fr 1fr` grid, 8 px apart: **Stop**, **Sleep** (Wake while asleep, with a sun icon), **Tare**, 52 px (Stop 60 px while running, above).
- **Group-head controller**: on a machine that starts shots itself, the start row is replaced by a 60 px dashed-outline note (1 px dashed line, radius 12, ink-muted subtitle and a touch icon): "Start on the machine". Stop and the rest stay.
- **Reasons**: when starts are off, a 14 px ink-muted status line under the buttons says why ("The machine is asleep. Tap Wake first."). A failure is an outlined error Alert there ("Couldn't start the shot." plus Decaid's own sentence).

### The live shot graph

`src/ui/machine/LiveShotGraph.tsx`, drawn by uPlot from the app-wide shot recording (`shotTrace.ts`). Samples never touch React state: the canvas is repainted at most once per animation frame, and the timer and readouts are written straight into their nodes.

**The plot, in every variant**

- Pressure (bar), flow (ml/s) and weight flow (g/s) share one 0-12 left axis, as on the DE1's own chart, with grid lines every 3 (0, 6, 12 when the plot is under 72 px tall). Cup weight has its own right axis from 0 to at least 50 g, its labels in the weight colour. Time runs from 0 to at least 30 s, so a fresh shot is not stretched across the width. Axis labels are 12 px Figtree in `graph-axis` ("10s", "25g"); grid lines are 1 px `graph-grid`; no ticks.
- Series, bottom to top: the pressure and flow targets (dashed 6/5, 1.5 px, in their series colours), weight (1.5 px), weight flow (2 px), flow (2.5 px), pressure (2.5 px, on top).
- Touch first: no cursor, no hover readout, no drag to zoom, no legend inside the canvas.
- Before any shot the plot shows "Pull a shot to see it here." (body-small, ink-muted) centred in the plotting area, on a patch of the colour beneath so no grid line strikes through it.
- Captions: "Shot graph" before any shot, "Live shot" with the live dot while pouring, "Last shot" after. Once the chat has the shot's card, the timer and the weight switch to the card's numbers (the pour time and Decaid's settled yield), so the panel never says one number while the card says another.

**Panel variant: the preview chart** (tablet machine column)

- One button, "Open the shot graph", to the Shot view: surface, a 1 px line, radius 14, padded 10 px top, 12 px sides, 8 px bottom, filling the column's remaining height (the plot at least 90 px).
- Header: the caption (subtitle) after an 8 px live dot while live; the timer (`readout` at 1.25rem, tabular) at the right; an accent chevron.
- Legend under the plot, items 12 px apart: a 12x3 px rounded swatch of the series colour, its name in an ink-muted caption and its live value in a tabular ink caption, for Pressure, Flow, Weight flow and Weight, then "target" after a 16 px dashed 2 px ink-muted line.

**Full variant: the Shot view and the Machine tab**

- Header: a 9 px live dot, "Live shot" (subtitle at 700), the running step ("Pour · step 3 of 3", body-small at 550, ink-muted), and the pour timer in `display` at the right.
- Four readouts in a four-column grid with 10 px gaps (4 px between columns on phones): **Pressure**, **Flow**, **Weight**, **Weight flow**. Each is a label with its 12x3 series swatch (10x3 on phones) over a `readout-large` value such as "5.0 bar"; Weight adds " of 50" at half size, ink-muted, when a stop-at-weight target is known (hidden on phones). These replace the legend. The sizes step down by viewport width (Chromium 91 has no container queries): below 900 px wide the readouts drop to 24 px; below 600 px they drop to 18 px, the timer to 34 px and the labels to 11.5 px.
- The plot fills the rest, at least 160 px tall; the coach's note sits under it.

### The coach's note

`src/ui/machine/CoachNote.tsx`. While a shot runs, a small note under the plot, never over the curves, says whether the coach is watching. `role="status"`.

- A 34 px round avatar (the accent wash, a speech icon at 18 px in the accent) and, 10 px beside it, aligned to its bottom, a bubble: raised fill, ink, body-small, 14 px sides and about 9 px top and bottom, radius 16 with the corner nearest the avatar at 6 px, at most 520 px wide.
- It enters with a fade and a 6 px rise over 200 ms ease-out, instantly under reduced motion.
- It says, first match wins: "Add your API key in Settings, and I'll read your shots." / "I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots." / "This shot runs "{profile}", not {version}, so it won't be part of this dial-in." / "I'm watching, but {version} isn't confirmed on the machine yet, so this shot may not count." / "I'm watching this shot. I'll read the curves once it's done." After the pour: "Done. Reading the shot" with three 5 px ink-muted dots that pulse in turn (screen readers hear the full sentence). It is gone once the shot's card or notice is in the chat.

### Chat

`src/ui/chat/ChatSurface.tsx` (the only module that imports x-chat) and `CoachScreen.tsx`.

- **Bag header**: at least 64 px, 12 px sides, 10 px gaps, a line below. The bag picker reads as the screen's title (a native select, 19 px at 700, 48 px tall, no underline); the version is quiet text beside it ("v4 · Blooming Espresso": the version in ink at 650, the rest ink-muted body-small); then a spacer and **Undo** and **New bag** (tonal, 48 px). The phone mockup's icon-only Undo and New bag are not built: the header is the same in both layouts.
- **Lane**: the thread is capped at 680 px and the composer at 760 px, centred in a wide pane.
- **Messages**: the coach's (and the app's) messages sit on the page with no bubble, across the full lane, so their cards read as cards, under x-chat's small author label "Coach" (caption size, 550, ink-muted). The barista's own words sit in a right-aligned bubble: raised fill, ink, radius 12, 8 px by 12 px. The accent is kept for actions, never for bubbles.
- **Text**: 16 px at line height 1.5; paragraphs and lists 12 px apart, lists indented 20 px, list items 2 px apart, code in monospace at 0.9em. The coach's text supports bold, italic, code and lists, never links or images; what the barista typed is shown verbatim.
- **Thinking**: while the coach works with nothing streaming yet, a row with a 16 px spinner and "Thinking…" in ink-muted body-small, adding the seconds after 3 s ("Thinking… 12 s"), so a slow reply never looks frozen.
- **Composer**: x-chat's compact composer on surface, a 1 px line, radius 12, 4 px padding, 8 px from the pane's sides and bottom, up to four rows of 16 px text. Its placeholder says what the coach is waiting for ("Tap an answer, or say how it tasted", "Pull a shot, or ask the coach"). **Send** is a 48 px square, radius 12, accent with an on-accent arrow, faded to 38% while sending is blocked (typing never is).
- **Following**: the thread keeps the newest message in view as content arrives, unless the barista scrolls up; then x-chat's scroll-to-newest button appears at the bottom of the thread.

### Cards

All cards are outlined Paper: surface, a 1 px line, radius 16, 12 px padding (16 px for settings sections, 24 px for empty states), 4 px above and below in the chat. Titles are `subtitle` at 700; names in lists and questions at 600. Emphasis is a full border; a card that is done or set aside dims (0.55 for the unpicked starting profiles once one is picked, 0.75 for an undone version) and never vanishes.

- **Shot card**: a header (an accent cup icon, "Shot 60.6 s" in subtitle at 700, " · Kiambu AA v4" in ink-muted body-small); four metrics in a grid of columns at least 104 px wide (16 px between columns, 8 px between rows): **Dose → yield**, **Ratio**, **Peak pressure** ("5.4 bar at 60 s"), **First drop**, each a `label` over a `metric`; a sparkline of pressure and flow (48 px tall, up to 360 px wide, the same 0-12 scale, 2 px lines with round joins, pressure on top, a 1 px line as its baseline) with its two legend keys stacked beside it, and on the newest shot's card only a **Graph** text button (accent, chevron, 48 px) to the full graph; possible channeling in warning with a warning icon; and "How much did you enjoy it?" (ink-muted) with five 48 px stars, lit ones filled in warning amber, unlit ones outlined in ink-muted, behaving as a radio group (the arrow keys move the rating).
- **Change card** (the coach's proposed change): the summary as its title; each change line in `body` as "Grind: 12 → 11" with the label and the old value ink-muted (the old value struck through), an ink-muted arrow icon read as "changes to", and the new value in ink at 600; by-hand steps after an accent hand icon at 600. While pending it has a **2 px accent border**, a muted line saying what Confirm will do ("Confirm saves this as v5 and loads it onto the machine."), then **Confirm** (contained, 24 px sides) and **Not now** (text). Afterwards the status replaces the buttons: a progress bar while loading, a success check with "Saved as v5" and a tonal **Undo** on the latest one, or a muted "Not applied. Nothing changed on the machine.", "Undone. Back on the previous version.", or an error line. The reasoning ("Why:", "Expect:", their labels ink-muted) comes last, under a 1 px line, so even the longest card keeps Confirm in view when it lands at 962x602.
- **Starting profiles** (template cards): a list of cards 8 px apart; each has the name (subtitle at 600) and a small confidence chip (outlined: success for high, accent for medium, default for low), "style · shape" in ink-muted, the reason, and at the right **Use this** (contained, 48 px; a text button once a choice is made) or "In use" in the accent with a check. The chosen card gets a 2 px accent border.
- **Empty states** (no API key, no bag): one card centred in the pane, at most 460 px wide, 24 px padding, centred text: a 40 px accent icon, a `title`, a muted body-small sentence, then a single contained button ("Open Settings", 48 px; "New bag", 56 px with 32 px sides).
- **Settings**: a column at most 760 px wide, 16 px padding, a `title` "Settings", then sections 16 px apart, each a card with 16 px padding and its title in subtitle at 700 with 8 px under it. Fields are outlined text fields and native selects, 48 px tall, radius 12; a section that saves has one contained Save, and its secondary actions are tonal. Appearance is the first section and needs no Save: it applies at once.
- **History**: a header ("History" in `title`, tonal **Export** and **Import**; 16 px sides, 12 px above, 8 px below, a line under it), then a column with 16 px padding in which the bags sit 8 px apart. A bag is a card holding one 64 px row button: its name (subtitle at 600) and details (ink-muted body-small) on the left, the shot count and the date on the right, an ink-muted chevron. A version card carries a small status chip (Active filled in success, Superseded outlined, Undone outlined in warning) and dated shot rows separated by 1 px lines, their facts joined by middle dots; the active version's card has a 1 px success border.

### Chips

- **Option chips** (answers to the coach's questions, `parts/OptionChips.tsx`): 48 px tall, radius 24, 16 px labels, wrapping 8 px apart under the question (subtitle at 600, 8 px above the chips). At rest a chip is outlined with an ink label; chosen, it fills with the accent, its label on-accent, with a check icon. **Other** is always last, with a pencil icon, and opens a 48 px text field ("Describe it in your words"); a multi-select question, or Other, adds a contained **Send**. A single-select answer is sent on the tap. Once answered or set aside, the chosen chips stay filled and the rest disable. As built, the resting chip's outline is MUI's default outlined-chip grey (#616161 in dark, #bdbdbd in light), not the tinted `line` the mockup draws: prefer `line` for anything new.
- **Status chips**: small (24 px tall, 15 px text), not tappable, outlined or filled in a status colour, for confidence and version status. Never a button in disguise.

### Notices, alerts and dialogs

- **Notice** (a line from the app itself in the chat, `parts/Notice.tsx`): a small icon and body-small text. Info is ink-muted, icon and text; success, warning and error put the icon in their colour and keep the text in ink. With progress, a rounded bar sits under the line, indented 28 px to align with the text, with an optional caption at the right ("Try 2 of 3"), at most 480 px wide.
- **Alerts**: MUI Alerts with plain-word messages that name the next step. Outlined in the machine column (device errors, command failures); standard, with MUI's tinted fill, for the coach's error banner (with Retry and a 48 px dismiss) and the old-engine warning; standard in Settings for saved and failed messages.
- **Dialogs**: only for confirming a destructive step (Forget the API key) and for an export's result. A short title, one sentence, then the actions at the right: the quiet choice as a text button, the decisive one contained ("Forget key" in error, "Done" in the accent).

### Appearance controls

`src/ui/settings/AppearanceSection.tsx`, the first section of Settings. Changes show on every screen at once and are saved with the other settings.

- **Mode**: a three-part segmented control, **Dark · Light · Auto**, each with its icon, on a raised track (radius 14, 4 px padding and gaps). Segments are 48 px, radius 10, 15 px labels in ink-muted; the chosen segment is surface with an ink label and a hairline shadow. Helper text: "Auto follows this device's light or dark setting."
- **Tint**: a radio group of eight cells in four columns (10 px between rows, 6 px between columns). Each cell is one button: a 48 px circle, the tint's accent as a 9 px ring around its background (both as the current mode draws them), over its name in `label`. Custom's ring is a conic wheel of the slider's hues. The chosen cell gets the one ring (section 4) and an ink name; the others are ink-muted. A press scales the circle to 0.94. Arrow keys, Home and End move between the tints.
- **Custom hue**: a slider, 0 to 359, on a 30 px fully round rail whose gradient is 13 hex stops at OKLCH L 0.76, C 0.11 (every 30°, in both modes), with the thumb travelling between the centres of the rail's round ends. The thumb is 36 px: the current accent inside a 4 px white ring, with a soft shadow, a 48 px touch area, and an accent halo while dragged. Dragging previews every hue live and saves where it stops; it selects Custom.
- Helper text: "The tint colours the buttons and tints the backgrounds. Shot graph colours never change: pressure green, flow blue."

### Motion

- **State changes take 150 to 250 ms and ease out.** The coach's note and the live strip enter over 200 ms ease-out (a fade with a 6 px rise for the note, a 4 px drop for the strip). The Mode segments and the tint swatches change in 200 ms (MUI's `shorter`, its standard curve); the composer's focus border in 250 ms.
- **The live dot** pulses while a shot runs: opacity 1 to 0.35 and back over 1.6 s, ease-in-out, looping; it holds still at full opacity under reduced motion. It is 7 px in the phone's Machine tab, 8 px in the preview chart's header and 9 px elsewhere.
- **"Reading the shot"**: three 5 px dots, opacity 0.3 to 1 over 1.2 s, each 0.2 s after the last; still under reduced motion.
- **Press feedback**: MUI's ripple on buttons, which animates only when the device has no reduced-motion preference; the tint swatches scale to 0.94 instead.
- **No bounce, spring, parallax or route transitions.** Screens swap in one frame. An automatic swap (a shot starting, the coach coming back) uses `location.replace`, so Back goes where the barista went, and is followed by the 350 ms tap guard on the pane that changed.
- **Every animation has a still alternative** under `prefers-reduced-motion: reduce`: CafAI's own animations switch off (`animation: none`), and a global CssBaseline rule settles everything else at once, MUI's spinners and indeterminate progress bars included. Their meaning is always in the words beside them ("Thinking… 12 s", "Loading v5 onto the machine…").

## 6. Do's and Don'ts

### Do

- **Do keep every control where it is while a shot starts.** Disable instead of removing; let only the main pane change; keep Stop in its cell, enabled whenever the machine runs.
- **Do let the shot own the screen while it runs**: the big graph, the timer and Stop; the coach's note under the plot, never over the curves.
- **Do read every colour from the theme** and add a new role to `buildPalette` (and its pairs to `palette.test.ts`) when nothing fits.
- **Do give each region or card one contained button** for its main action (Espresso in the machine column, Send in the chat, Confirm on a change card) and make every other action tonal (or a text button for the quiet choice beside a primary).
- **Do make anything tappable at least 48 px**, start buttons 60 px, and space them 8 px apart.
- **Do set live numbers in tabular figures** with a space before the unit, one decimal for live readings, and a dash for a value the machine has not given.
- **Do write states in words beside their colour**, in sentence case, in plain language, with the next step in an error.
- **Do show a change in plain words and wait for a tap** before anything reaches the machine; put the decision before the reasoning.
- **Do keep Exit and Decaid settings on every screen**, in every layout, during a shot too.
- **Do give every animation a still alternative** under reduced motion, and keep motion between 150 and 250 ms.
- **Do check new screens at 962x602** (the smallest Decent tablet) and at 390x844 and 844x390, in dark and light, in Crema, Matcha and Steel.

### Don't

- **Don't put must-tap controls at the bottom of the screen in the first 10 s** after the skin opens: Decaid's exit hint covers it. The phone's bottom tabs are navigation only, and Stop is never down there.
- **Don't use `oklch()`, `color-mix()`, MUI's `cssVariables`, container queries or other post-Chromium-91 CSS.** Compute colours to hex in TypeScript.
- **Don't colour graph series with the tint**, and don't change Decent's convention (pressure green, flow blue, bar and ml/s on one 0-12 axis).
- **Don't add a second accent**, and don't use the accent for headings, decoration or anything on the plot.
- **Don't use side-stripe borders** (a coloured left edge) for emphasis: use the full 2 px accent border, as the pending change card does.
- **Don't use uppercase eyebrows**, overlines in capitals, or letter-spaced labels.
- **Don't use shadows or elevation for cards**, and don't let MUI's dark-mode elevation overlays grey a surface.
- **Don't use glassy gradients, glassmorphism or glow**; the only gradients are the hue rail and the Custom swatch, and they show hues.
- **Don't build metric tiles or a dashboard of charts**; one graph, drawn like Decent's, with the numbers beside it.
- **Don't use mascots, latte-art clip art, novelty fonts** or emoji in the interface.
- **Don't let the page scroll or add edge gestures**; a region scrolls inside itself.
- **Don't send a machine command without a tap, or retry one on its own.**
- **Don't rely on hover**, a cursor, or drag on the graph: hover styles live only under `@media (hover: hover)`.
- **Don't draw a colour pair the contrast sweep does not check**: in light mode, error text on raised already falls a hair under 4.5:1 at some hues.
- **Don't use em dashes in interface copy.**

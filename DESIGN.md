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
  bar-background: "#140e09"    # background: the page, the main pane
  bar-surface: "#1c160f"       # surface: top bar, tab bar, cards (the stats card too), composer, the prompt chips and the open taste words
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
  on-error: "#1e1311"          # text on a filled error button (Stop in the machine row)
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
  headline:         # MUI h5: the stats card's state line
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
  readout:          # the stats card's readouts
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
  caption:          # small print: "target 98.5", the profile's mark, the Exit button's second line
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
  button-small:     # the Mode control's segments, and the words of a shot's rating (at line height 1.2)
    fontFamily: Figtree
    fontSize: 0.9375rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.005em
  button-start:     # the machine row on a tablet (Espresso, Steam, Flush, Hot water, Wake): icon over label
    fontFamily: Figtree
    fontSize: 0.71875rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 0em
  button-stop:      # Stop in the machine row: the starts' size, at 700
    fontFamily: Figtree
    fontSize: 0.71875rem
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: 0em
  tab-label:        # the phone's tabs
    fontFamily: Figtree
    fontSize: 0.78125rem
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: 0em
  wordmark:         # "CafAI" in the top bar, in the accent; one 24 px line, the cup's height
    fontFamily: Figtree
    fontSize: 1.1875rem
    fontWeight: 750
    lineHeight: 24px
    letterSpacing: 0.005em
rounded:
  none: 0px                         # the machine alert and the old-engine warning, full bleed
  segment: 10px                     # a segment of the Mode control
  button: 12px                      # theme.shape.borderRadius: buttons, the machine row, fields, composer, Send, user bubbles, alerts
  panel: 14px                       # the Mode control's track, a phone tab
  card: 16px                        # outlined cards (the stats card too), settings sections, the live strip
  note-bubble: 16px 16px 16px 6px   # the coach note; the corner nearest the avatar stays tight
  prompt: 20px                      # the prompt chips above the composer (Stats, Taste words, Need help?), half their 40 px height
  chip: 24px                        # option chips, half their 48 px height
  full: 9999px                      # dots, swatches, the coach avatar, the hue rail and thumb, the phone tab pill
spacing:
  base: 8px            # MUI theme.spacing(1): an sx spacing number n is n x 8 px
  3xs: 2px             # 0.25: the machine row's buttons apart, the places apart below 1200 px
  2xs: 4px             # 0.5: the tablet bar's gaps below 1200 px, the places apart from 1200 px, the composer's padding
  xs: 6px              # 0.75
  sm: 8px              # 1: between buttons, chips and readout columns; the places' sides below 1200 px
  sm-md: 10px          # 1.25: between the blocks of the Shot view
  md: 12px             # 1.5: card padding (the stats card's too), the tablet bar's sides, a narrow or short Shot view's sides
  md-lg: 14px          # 1.75: the Shot view's top and bottom, the note bubble's sides
  lg: 16px             # 2: screen padding, settings sections, gaps between sections
  xl: 20px             # 2.5: the wide Shot view's sides
  2xl: 24px            # 3: the sides of Confirm, Send and Save; empty-state padding
  3xl: 32px            # 4: the sides of the large New bag button
  touch-target: 48px   # the floor for anything tappable (the phone's machine row, 44 px, falls short of it)
components:
  button-primary:          # contained: the one main action (Confirm, Use this, Send, Save)
    backgroundColor: "{colors.crema-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 24px
    height: 48px
  button-tonal:            # every secondary action (Undo, New bag, Export, Exit, Sleep, Tare, Photo of the bag)
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
  button-text:             # tertiary, in the accent (Not now, Graph, Keep it, Something else; On Visualizer, a link drawn as one)
    textColor: "{colors.crema-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  icon-button-bar:         # Decaid settings in both bars, Exit on a phone: the icon alone, named for screen readers
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.button}"
    size: 48px
  machine-row-button:      # Espresso, Steam, Flush, Hot water (and Wake) on a tablet: a text button, icon over label
    textColor: "{colors.ink}"
    typography: "{typography.button-start}"
    rounded: "{rounded.button}"
    padding: 0px
    width: 54px
    height: 48px
  machine-row-icon:        # the same in a phone's bar: the icon alone, named for screen readers
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    size: 44px
  button-stop:             # the running start's own box in the machine row (44x44, the icon alone, on a phone)
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.button-stop}"
    rounded: "{rounded.button}"
    width: 54px
    height: 48px
  top-bar:                 # tablet; gaps 4 px below 1200 px, 8 px from 1200 px
    backgroundColor: "{colors.bar-surface}"
    padding: 0 12px
    height: 56px
  nav-item:                # a place; 16 px sides from 1200 px; below 960 px the icon alone, 48 px wide with 12 px sides
    textColor: "{colors.ink-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 8px
    height: 48px
  nav-item-active:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.crema-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 8px
    height: 48px
  top-bar-phone:           # 16 px left plus the left inset beside the rail
    backgroundColor: "{colors.bar-surface}"
    padding: 0 4px 0 16px
    height: 52px
  machine-alert:           # one slim MUI Alert under the top bar, a line below; 14 px text; 48 px tall with buttons
    rounded: "{rounded.none}"
    padding: 0 12px
    height: 40px
  machine-alert-button:    # Connect DE1, Connect scale, Let Decaid stop shots: text buttons in the alert's own text colour, at the strip's end
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 8px
    height: 48px
  tab-bar:                 # phone upright, plus the bottom safe-area inset
    backgroundColor: "{colors.bar-surface}"
    padding: 6px
    height: 64px
  side-rail:               # phone on its side, plus the left safe-area inset
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
  shot-view:               # the Shot route on a tablet, and the phone's Shot tab: at most 960 px wide, centred; 12 px sides when narrow or short
    backgroundColor: "{colors.bar-background}"
    padding: 14px 20px
    width: 960px
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
  bean-card:               # "Which coffee is it?": the library's coffees as plain rows divided by 1 px lines, each with a contained Use this; then Photo of the bag and Something else
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 12px
  bag-confirm-card:        # "Check the bag's details": a 2 px accent border while open, 1 px line once confirmed
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 12px
  stats-card:              # the machine at a glance: a live row at the end of the chat, outlined in line
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 12px
  stats-prompt:            # the Stats chip above the composer: outlined in line, an accent gauge icon, a band to 48 px (Taste words and Need help? share it, their icons ink-muted)
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.prompt}"
    height: 40px
  taste-words:             # the open Taste words: a line of its own above the composer, surface in a line, tabs and 48 px word chips
    backgroundColor: "{colors.bar-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: 8px
  ready-in:                # "Ready in about 3 min" at the end of the stats card's state line row
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
  next-step:               # the Shot view's Next step, at the end of the coach note's row; on a phone a 48 px square, the icon alone
    backgroundColor: "{colors.bar-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: 6px 16px
    height: 48px
  drink-stepper:           # Settings > Steam, hot water and flush: one outlined field 48 px tall, Less and More filling 30% each at its ends, the value and its unit centred between
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: 48px
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
    size: 8px
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
  live-strip:              # phone, top of the Coach tab while a shot is live
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
  mode-control:            # the Mode control's track; a shot card's rating in words draws the same track and segments (D126)
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

> **As built** on branch `feat/ux-modes-theme`, 8 October 2026: all three UX stages (palette, theme and Figtree; Appearance; layouts and shot focus), the fixes from their fresh-eyes check, and "chat first, the machine on demand" (no machine column; the machine row in the top bar; the stats card in the chat; the phone's Shot tab). The sources of truth are `src/ui/palette.ts`, `src/ui/color.ts`, `src/ui/theme.ts` and the components under `src/ui/`; the why is in the specs (`docs/superpowers/specs/2026-10-07-ux-modes-and-theme-design.md` and `docs/superpowers/specs/2026-10-08-chat-first-machine-design.md`) and DECISIONS.md D80 to D92. Where a spec and the code differ, this file follows the code and says so. Since then, on branch `feat/decaid-alignment` (9 and 10 October 2026): the machine alert's buttons (Connect DE1, Connect scale, Let Decaid stop shots), Heating and the countdown on the stats card, Next step in the Shot view, Settings' key switch, drink settings and About lines, and the intake: the bean card that opens a new bag ("Which coffee is it?") and the chat's start on it, the bag photo's confirm card, and On Visualizer on shot cards and in History (`docs/superpowers/specs/2026-10-09-decaid-alignment-design.md`, DECISIONS.md D93 onward). Then, on 11 October 2026, the owner's list (DECISIONS.md D123 to D127): the tints named for coffee, the drink settings laid out by drink, Add a grinder and the coach's grinder card, the shot card's rating in words, and Taste words and Need help? above the composer.

**Creative North Star: The Barista's Instrument.** CafAI is a chat-first AI espresso dial-in coach that runs as a web skin inside Decaid, the Decent Espresso app: on the tablet mounted on a DE1 (962x602 CSS px and up, in a WebView as old as Chromium 91) and in phone browsers. The barista reads it from a step back, often with wet hands and a cup in the other, in morning daylight or evening lamplight. It should feel like a good espresso scale or a well-made grinder: calm, precise, warm, and quiet until it matters.

An instrument earns trust by being legible and by holding still. CafAI draws with tone instead of outlines and shadows (three layers of one tinted neutral), keeps its one accent for the thing to press, prints big tabular numbers, and plots a shot the way Decent's own charts do (pressure green, flow blue). Between shots the chat comes first: no graph and no dashboard on load, only a live card of the machine at the end of the chat, there until the chat moves on, and back with one tap on Stats. When a shot starts, the shot comes first: the screen under the top bar becomes the graph, the start that runs turns into Stop in its place, under the thumb that tapped it, nothing moves, and the coach says only that it is watching. Every change to the machine is written in plain words and waits for the barista's tap, and there is always a way out to Decaid.

It rejects the SaaS dashboard (metric tiles, sidebars full of charts, enterprise chrome), glassy gradients, glassmorphism and glow used as decoration, and the cartoon coffee shop (mascots, latte-art clip art, novelty fonts). It also rejects anything that needs a squint or a fingertip: small type, thin tap targets, hover-only controls.

### Two layouts

The layout is a pure function of the viewport (`src/ui/shell/layout.ts`), read again on every resize and rotation.

- **Tablet**, at least 800 px wide and 500 px tall (every Decent tablet: 962x602, 1007x602, 1140x712; iPads either way up, except an iPad mini upright). A 56 px top bar carries the navigation (Coach · Shot · History · Settings), the **machine row** (Espresso, Steam, Flush, Hot water; the one that runs turns into Stop) and the ways out. Under it the **main pane** holds the routed screen at the window's full width: there is no machine column. When a shot starts, the main pane becomes the big graph (the Shot view) by itself, and the top bar, Stop included, stays exactly where it was.
- **Phone**, anything smaller. One screen at a time under a 52 px top bar that carries the machine row as icons and the ways out, with tabs **Coach · Shot · History · Settings** along the bottom, or as a side rail when the phone lies on its side (under 500 px tall). The Shot tab is the tablet's Shot view, laid out for the phone's width or height.

In both, the machine's readings are a live **stats card** at the end of the chat (Stats above the composer brings it back; before there is a chat, with no key or no bag yet, it sits under the coach screen's setup card), and its problems show in one slim alert under the top bar. The page never scrolls (each region scrolls inside itself), there are no edge gestures (an Android edge swipe leaves the skin), safe-area insets reach the layout only through the `--safe-top`, `--safe-right`, `--safe-bottom` and `--safe-left` CSS variables, and Exit and Decaid settings are on every screen. The route `#/shot` is the Shot view in both layouts, so crossing the breakpoint keeps the screen.

### Key Characteristics

- One tint, in light or dark, drives every neutral and the accent: seven named tints plus a hue slider. The colours that carry meaning (success, warning, error, info, the live dot, the graph series) never follow it.
- Colours are designed in OKLCH and shipped as plain hex, because the Chromium 91 WebView understands neither `oklch()` nor `color-mix()`.
- Contrast is enforced by a unit test across every named tint and every hue 0-359, in both modes.
- Tonal layering (background, surface, raised) with 1 px tinted lines; no shadows at rest.
- Figtree everywhere, sentence case, tabular figures for anything that changes live.
- Chat first: no graph and no machine panel on load. The machine's numbers are a live card in the chat, the four starts are a row in the top bar, and the graph is one tap away under Shot.
- 48 px minimum touch targets (the phone's 44 px machine row falls short); controls disable in place instead of disappearing, except where the machine row trades its starts for Stop or Wake.
- The accent marks the primary action and the current selection.
- The shot graph is Decent's: bar and ml/s on one 0-12 axis, pressure on top, the tint never on the plot.
- Motion is short (150 to 250 ms), eased out, never bouncy, and still under reduced motion.

## 2. Colors: The Tinted Bar

One tint colours the whole bar. A tint is three numbers: an OKLCH hue, the accent's chroma, and the neutral chroma (how far the backgrounds, text and lines lean toward that hue). `buildPalette(mode, tint)` in `src/ui/palette.ts` turns a tint and a mode into every colour the app draws. `src/ui/color.ts` converts OKLCH to sRGB hex in TypeScript; a colour outside sRGB keeps its lightness and hue and loses chroma until it fits, so a strong accent at an awkward hue gets duller, never lighter or darker, and the contrast tuning holds. `createCafaiTheme(palette)` in `src/ui/theme.ts` maps the palette onto MUI, and components read colours only through the theme.

The default look is **dark Crema**: the frontmatter tokens are its values. The tables below add light mode and the other tints.

### Roles

| Token | palette.ts | Read it as (MUI sx) | Dark Crema | Light Crema | Used for |
|---|---|---|---|---|---|
| bar-background | background | `background.default` | #140e09 | #faf6f2 | the page, the main pane |
| bar-surface | surface | `background.paper` | #1c160f | #fffdfb | top bar, tab bar, cards (the stats card too), composer, the prompt chips and the open taste words, the chosen Mode segment and the chosen word of a shot's rating |
| bar-raised | raised | `cafai.raised` | #282018 | #f2ece5 | tonal buttons, user bubbles, the coach note, the Mode track and the rating's track |
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
| warning | `warning.main` | 0.83, 0.13, 85 | #eec05b | 0.52, 0.12, 75 | #8d5e00 | low water, "not confirmed", possible channeling |
| error | `error.main` | 0.72, 0.15, 25 | #f47b74 | 0.53, 0.18, 25 | #be2e31 | Stop in the machine row, failures, Forget key |
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
| accent | 0.76, c (Tamper 0.88) | 0.50, c (Tamper 0.36) |
| accentSoft | accent at 16% over surface | accent at 12% over surface |
| onAccent | 0.20, 2n | 0.99, 0.005 |
| graph grid | ink at 8% over background | ink at 8% over background |

### The tints

The order is the order of the Appearance settings.

| Id | Name | Hue | Accent chroma | Neutral chroma | Accent, dark | Accent, light | Background, dark | Background, light |
|---|---|---|---|---|---|---|---|---|
| crema | Crema (default) | 68 | 0.085 | 0.014 | #d5a776 | #835928 | #140e09 | #faf6f2 |
| matcha | Matcha | 138 | 0.11 | 0.014 | #8ec27d | #417230 | #0c110b | #f4f8f3 |
| cold-brew | Cold Brew | 200 | 0.09 | 0.014 | #64c3c8 | #007176 | #081112 | #f2f8f9 |
| blueberry | Blueberry | 265 | 0.12 | 0.016 | #8caffe | #4160a7 | #0c0f17 | #f4f7fc |
| plum | Plum | 320 | 0.11 | 0.014 | #d09add | #7e4d8a | #120d13 | #f9f5fa |
| cherry | Cherry | 22 | 0.13 | 0.014 | #f98e8b | #a03f40 | #150d0d | #fbf5f5 |
| tamper | Tamper | 250 | 0.025 | 0.006 | #ccd9e8 | #333e4a | #0d1012 | #f5f7f9 |
| (custom) | Custom | 0-359 | 0.11 | 0.014 | from the slider | | | |

**Tamper** is nearly grey, so at the usual accent lightness its accent would read like muted text. It takes its own accent lightness, 0.88 in dark and 0.36 in light (`accentLightness` in palette.ts), so its buttons and selection still stand apart. **Custom** is any whole degree from the hue slider (rounded and wrapped into 0-359), with accent chroma 0.11 and neutral chroma 0.014.

The appearance is a setting, `{ mode: 'dark' | 'light' | 'auto', tint: <id> | { hue } }`, default dark Crema (D82). It is saved, mirrored to Decaid and exported with the other settings. Auto follows `prefers-color-scheme` and shows light wherever the WebView never reports dark. Themes are built once per mode and tint, so switching back costs nothing, and the last resolved background, surface, ink, muted, line and accent are kept in localStorage (`cafai.appearance.boot`) so the "Starting CafAI…" screen and the watchdog page in `index.html` open in the barista's colours. The page is in the look from its first frame: `index.html`'s head paints the default look (dark Crema, background #140e09, ink #f4ede6) and an ES5 script swaps in the cached background and ink, with a colour scheme to match, before the bundle runs, so a dark CafAI never opens on white. Once the app renders, the theme's CssBaseline sets the page's own background, so the boot colours never outlive a change of look.

### The One Tint Rule

Every neutral and the accent come from the tint; nothing is picked by eye. A component never writes a hex: it reads the theme (`primary.main`, `background.default`, `background.paper`, `text.primary`, `text.secondary`, `divider`, `cafai.raised`, `cafai.accentSoft`, `cafai.live`, `cafai.graph.*`). The neutrals are never plain grey: they carry the tint's neutral chroma, so a Matcha CafAI has green-black backgrounds and green-white text. A new colour is a new role in `buildPalette`, with its pairs added to the contrast sweep. Apart from the default look and the boot pages' fallbacks in `index.html`, the only literal colours are the hue slider thumb's white ring and two small black shadows (section 4).

### The Accent Is For Action Rule

The accent marks the primary action of a screen or region (a contained button: Confirm, Use this, Send, Save) and the current selection (the current nav item and tab, a chosen chip, the chosen starting profile's border, the pending change's border, the hue thumb, the focus ring). Text buttons that act take it too (Not now, Graph). Beyond that it appears only as a few small marks of CafAI itself: the wordmark, the coach's avatar, the cup on a shot card, the hand on a by-hand step, the gauge on the Stats chip, the medium-confidence chip on a starting profile, and the one large icon of an empty state. The machine row has no accent: its starts are ink, and the one coloured button there is Stop, in the error colour. It is never a heading colour, never a background for decoration, never on the plot, and there is no second accent.

### The Graph Keeps Its Colours Rule

The shot graph follows Decent's convention whatever the tint: pressure green, flow blue, weight flow orange, cup weight tan. The accent never draws a series, even when a custom hue's accent and the flow line share a hue. The same fixed-hue idea holds for success, warning, error, info and the live dot: meaning never changes colour with the tint.

### The Contrast Is Tested Rule

`src/ui/palette.test.ts` builds the palette for every named tint and every custom hue 0-359, in both modes (734 palettes), and fails on any pair the UI draws that falls below its minimum. The worst cases measured across the sweep:

| Pair | Minimum | Worst, dark | Worst, light |
|---|---|---|---|
| ink on background, surface, raised | 7:1 | 13.69 | 13.86 |
| ink-muted on background, surface, raised | 4.5:1 | 7.38 | 5.72 |
| accent on background and surface (nav labels, links, text buttons) | 4.5:1 | 7.94 | 5.26 |
| accent on accent-wash (the current nav item's label) | 4.5:1 | 5.95 | 4.70 |
| on-accent on accent (filled buttons, chosen chips) | 4.5:1 | 8.02 | 5.50 |
| success, warning, error, info on background and surface | 4.5:1 | 6.71 | 5.11 |
| on-error on error (Stop while running) | 4.5:1 | 6.86 | 5.64 |
| chip outlines: status colours and the accent on background and surface | 3:1 | 6.71 | 5.11 |
| each graph series on background and surface | 3:1 | 7.77 | 3.53 |

Some pairs the UI draws are not in the sweep. Ink and ink-muted on the accent wash (the live strip's title and numbers) measure 10.54 and 5.49:1 at worst and pass. Status colours on raised (the tonal "Forget key" button in Settings, `variant="tonal" color="error"`) are in the sweep: light-mode error was darkened from lightness 0.55 to 0.53 so it passes there too (4.90:1 at worst; 5.97:1 in dark). Colours MUI derives itself (the text of its Alerts, disabled controls) are outside the sweep. Opacity hides a colour from the sweep too, so CafAI never dims content with it: what is set aside (the starting profiles not picked, an undone version, a closed question's other answers) and every placeholder is drawn in ink-muted at full opacity, which its row covers; only a control disabled for the moment keeps MUI's faded look. Faded with opacity, the set-aside cards and chips measured 2.3 to 3.7:1 in light mode; in ink-muted they measure 6.4:1 and up in light Crema.

### The Hex Only Rule

Chromium 91 has no `oklch()`, no `color-mix()`, no relative colour syntax and no container queries. Every colour reaches CSS as `#rrggbb`, MUI runs without `cssVariables` (its CSS-variable mode can emit `color-mix()`), and the one place that needs many hues, the hue slider's rail, is 13 hex stops computed by `oklch()` in TypeScript. Translucency, where MUI adds it (hover and disabled states, ripples), arrives as `rgba()`.

### The Words Beside The Colour Rule

Colour is never the only signal. Connection dots sit beside "DE1" or "No machine" (a screen reader hears "DE1 connected"), the profile mark says "This bag" or "not confirmed", Stop says "Stop" (by name on a phone), every graph series has a label and a value, and states are written in words ("Ready", "Pulling a shot: pour", "Can't reach Decaid. Trying again…").

## 3. Typography: Read From a Step Back

**Figtree** sets every word: the variable font (weights 300 to 900) from `@fontsource-variable/figtree`, latin subset only, upright and italic (the chat renders `*emphasis*` in the true italic), about 20 KB per face, bundled and offline with `font-display: swap` (`src/ui/fonts.css`). Figtree's latin subset has ↑ and ↓ but not → or ←, so **CafAI Symbols**, Roboto's symbols subset at 400, 500 and 700 under a family name of its own (`src/ui/fonts-symbols.css`, unicode-range U+2190, U+2192, U+2194-2199), comes next in the stack and is fetched only when such a glyph is on screen ("18.0 g → 40.4 g", "Dose → yield"). The stack is `FONT_FAMILY` in `theme.ts`:

```
"Figtree", "CafAI Symbols", system-ui, "Helvetica", "Arial", sans-serif
```

Buttons, inputs, selects and textareas inherit it (`font-family: inherit` in CssBaseline): a browser gives form controls a typeface of their own, and x-chat's unread count on its scroll-to-newest button came out in Arial.

Use the theme's variants rather than setting sizes by hand. Because Figtree is variable, CafAI uses the in-between weights: 400 for reading, 550 for labels and quiet emphasis, 600 for buttons and strong words, 650 for numbers and headings, 700 for titles and Stop, 750 for the wordmark.

### The scale

Fixed rem sizes (product register), about 1.125 to 1.2 between steps. "Tabular" means `font-variant-numeric: tabular-nums`.

| Token | MUI variant | Size | Weight | Line height | Tracking | Figures | Use |
|---|---|---|---|---|---|---|---|
| display | `display` | 2.875rem (46 px) | 650 | 1 | -0.02em | tabular | the Shot view's pour timer (2.125rem, 34 px, on a phone: a Shot view under 600 px wide or 440 px tall) |
| readout-large | `readoutLarge` | 1.875rem (30 px) | 650 | 1.1 | -0.01em | tabular | the Shot view's readouts (1.5rem, 24 px, on a phone, and on a tablet window under 900 px wide) |
| (unused) | `h4` | 1.75rem | 650 | 1.2 | -0.015em | | defined, not used |
| headline | `h5` | 1.4375rem (23 px) | 650 | 1.2 | -0.01em | | the stats card's state line ("Ready", "Pulling a shot: pour") |
| title | `h6` | 1.1875rem (19 px) | 700 | 1.3 | -0.005em | | screen titles, empty-state titles; the bag picker is set to match |
| subtitle | `subtitle1` | 1.0625rem (17 px) | 650 | 1.35 | 0 | | card titles (set to 700; the stats card's "Machine" too), names and questions (set to 600), graph captions, the profile name |
| (live strip) | `subtitle2` | 0.9375rem (15 px) | 600 | 1.4 | 0 | | the live strip's "Live shot" (set to 700), a drink's name in Settings > Steam, hot water and flush |
| body | `body1` | 1rem (16 px) | 400 | 1.55 | 0 | | chat text (1.5 in the chat), change lines, body copy |
| body-small | `body2` | 0.9375rem (15 px) | 400 | 1.5 | 0 | | secondary text, notices, helper text, the coach's note |
| readout | `readout` | 1.1875rem (19 px) | 650 | 1.2 | 0 | tabular | the stats card's readouts |
| metric | `body1` at 650 | 1rem | 650 | 1.55 | 0 | tabular | the numbers on a shot card |
| label | `label` | 0.8125rem (13 px) | 550 | 1.3 | 0 | | readout and field labels, swatch names, the profile line's label, the stats card's "DE1" and "Scale" and its "Ready in about 3 min" |
| caption | `caption` | 0.8125rem (13 px) | 400 | 1.35 | 0 | | "target 98.5", the profile's mark, the Exit button's "to Decaid" |
| button | `button` | 1rem (16 px) | 600 | 1.25 | 0.005em | | every button (the machine row's labels 0.71875rem, 11.5 px, at line height 1.15 with no tracking, Stop's at 700) |
| wordmark | (sx) | 1.1875rem (19 px) | 750 | 24 px | 0.005em | | "CafAI" in the top bar, in the accent |

`overline` is kept for any stray use but set like `label`, in sentence case. Headings `h1` to `h3` get `text-wrap: balance` (Chromium 91 ignores it, harmlessly).

### Case and words

- **Sentence case everywhere**: "Group", not "GROUP"; "Hot water", "New bag", "Decaid settings". Buttons, tabs and toggles have `textTransform: none`; there is no uppercase overline or eyebrow.
- **The middle dot joins facts**: "v4 · Blooming Espresso", "Pour · step 3 of 3", "60.6 s · 18.0 g → 40.4 g · 1:2.2 · peak 5.4 bar", the nav's "Coach · Shot · History · Settings".
- **Short names where room is short**: the stats card's links say "DE1" and "Scale" (a screen reader hears "connected" after them), and the machine row's labels are one or two words ("Hot water").
- **The arrow shows a change**: "18.0 g → 40.4 g" (the glyph, from CafAI Symbols); the change card draws an arrow icon instead.
- **Work in progress ends in an ellipsis**: "Thinking…", "Loading v5 onto the machine…", "loading…".
- **No em dashes in copy**, and plain words for states: "Ready", "Not connected", "Can't reach Decaid. Trying again…", "Not applied. Nothing changed on the machine."

### Numbers

- Anything that changes live is set in tabular figures: the timer, the readouts, the legend values, the shot card's metrics, the live strip, the pour time in the navigation.
- One decimal for live readings ("5.0 bar", "42.0 s", "97.7 °C"), whole numbers where a decimal is noise ("148 °C" steam, "31 mm" water). The running pour time is in tenths wherever it shows, the phone's Shot tab included.
- A space always separates the number and its unit. In the stats card the unit is set smaller and quieter: 0.68em, weight 550, ink-muted. In the Shot view's readouts and the timer, the number and the unit are one string at one size, because the paint loop rewrites it every frame; the mockups and the spec's "units at about 0.6em" show them smaller there, and the code does not (yet). The Shot view's weight target, "of 50", is 0.5em, weight 550, ink-muted, on a phone too.
- A reading the machine has not given shows a dash, never a 0 and never a unit alone; legend values stay blank until there is a shot, and before any shot the timers show the dash (`DASH` in `format.ts`), not "0.0 s".

### Line length and small print

The chat lane is capped at 680 px (about 70 characters at 16 px) and the composer at 760 px, both centred in a wide pane; the prompt row (Stats, and while the taste question is open Taste words and Need help?) shares the composer's lane. Other measures: the Shot view 960 px, the Settings column 760 px, the coach's note 520 px, a notice with a progress bar 480 px, an empty-state card 460 px. The floor for text is 13 px (`label`, `caption`); only the plot's axis numbers (12 px), the phone's tab labels (12.5 px) and the tablet machine row's labels (11.5 px) go below it.

## 4. Elevation: Tone, Not Shadow

CafAI is flat and tonal. Depth comes from three layers of the tinted neutral and from 1 px lines, never from shadows.

| Layer | Dark L | Light L | Holds |
|---|---|---|---|
| background | 0.17 | 0.975 | the page, the main pane, the Shot view, the bag header |
| surface | 0.205 | 0.995 | the bars, cards (the stats card too), settings sections, the composer, the prompt chips and the open taste words |
| raised | 0.25 | 0.945 | tonal buttons, user bubbles, the coach's note, the Mode track and the rating's track |

In dark mode each layer is a step lighter than the one under it. In light mode the surface is the lightest (cards read as paper on the page) and raised is a step darker than the page, so a tonal fill reads as pressed in, not lifted.

- **Lines**: a 1 px `line` border on every card and along the edges of regions (under the top bar and under the machine alert, right of the phone's rail, under the bag header and the History header, above the phone's tab bar). In the tablet's top bar a 1x30 px hairline in `line` parts the machine row from Decaid settings and Exit. Emphasis is a full border, never a stripe: 2 px in the accent for the pending change and the chosen starting profile, 1 px in success for the active version in History.
- **No shadows at rest.** Buttons have `disableElevation`; outlined Paper is the card; `MuiPaper` sets `backgroundImage: none`, so MUI's dark-mode elevation overlays never grey the tinted surfaces. The few shadows that exist are small and functional: the chosen Mode segment and the chosen word of a shot's rating (`0 1px 2px` black at 35% in dark, 14% in light), the hue slider's thumb (`0 1px 4px` black at 50%, so it reads over any hue, plus a 10 px accent halo at 24% while dragged), x-chat's scroll-to-newest button (surface, 1 px line, MUI shadow 2) when the barista has scrolled up, and MUI's own shadow on the app's dialogs.
- **The one ring**: the chosen tint swatch gets a 3 px gap in the surface colour and then a 2.5 px ring in ink (not the accent, so it reads around every swatch colour). Nothing else wears a ring at rest.
- **Focus rings for the keyboard only**: the theme's `focusVisible` draws a 2 px solid accent outline 2 px outside the control, on `:focus-visible` only, so touch users never see it. The composer is the one exception: x-chat gives it an accent border and a 1 px accent ring on `:focus-within`, which shows on touch too and marks the typing state. Tap highlights are transparent, and a long press on a button neither selects its label nor opens a callout.
- **Layering in the main pane**: on the shot route (a tablet's Shot, a phone's Shot tab) the Shot view sits over the coach, which stays mounted (hidden) underneath. The 350 ms tap guard after an automatic switch is a transparent sheet over the main pane only, never a visible scrim; the main pane is its own stacking context, so neither the guard nor the Shot view ever reaches the top bar (or a phone's tabs).

## 5. Components: Controls That Keep Their Place

Everything here is MUI 9 with CafAI's theme, plus x-chat for the thread and uPlot for the graph. Icons are Material Icons, the Rounded set in the shell, the machine row and the stats card.

### Buttons

| Kind | MUI | Fill and text | Height | Used for |
|---|---|---|---|---|
| Primary | `variant="contained"` | accent, on-accent | 48 px | the one main action of a region or card: Confirm (a change, a bag photo's details), Use this (a starting profile, a coffee on the bean card), Send, Save key, Save settings, Open Settings, Add to Decaid (the coach's grinder card, the Add a grinder dialog), Got it (How to taste); the empty state's New bag (`size="large"`, 56 px) |
| Tonal | `variant="tonal"` | raised, ink; hover ink at 8% over raised | 48 px | every secondary action: the stats card's Tare and Sleep or Wake, Undo, New bag in the bag header, Export, Import, Exit on a tablet, the Shot view's Next step, the bean card's Photo of the bag |
| Tonal, coloured | `variant="tonal" color="error"` (also `warning`, `success`) | raised, the status colour | 48 px | Forget key |
| Text | `variant="text"` | none, accent | 48 px | the quiet choice beside a primary (Not now, Keep it, the bean card's Something else), the shot card's Graph link, On Visualizer (a link drawn as a text button, the "opens elsewhere" icon after its label), Settings' Add a grinder and Edit grinders in DYE2 (a link drawn as one), the dialogs' Download file, Copy and Cancel, About's Copy report |
| Alert action | `variant="text" color="inherit"` | none, the alert's own text colour | 48 px | the fixes in the machine alert: Connect DE1, Connect scale, Let Decaid stop shots |
| Machine row | `variant="text" color="inherit"` | none, ink | 54x48 px (44x44 on a phone) | Espresso, Steam, Flush, Hot water, and Wake while the machine sleeps |
| Bar icon | `IconButton` | none, ink-muted | 48 px | Decaid settings in both bars, Exit on a phone |
| Destructive | `variant="contained" color="error"` | error, on-error | 48 px (Stop: 54x48, 44x44 on a phone) | Stop in the machine row, the dialog's Forget key |

- **Touch targets**: the theme makes Button, IconButton, ToggleButton, Tab, ListItemButton, MenuItem and every clickable or deletable Chip at least 48 px (`TOUCH_TARGET`); text fields and native selects are 48 px too. The prompt chips above the composer (Stats, Taste words, Need help?) draw 40 px and take taps on a 48 px band. A switch (Keep my API key in Decaid) keeps MUI's own size, 38 px tall, in a row 48 px tall whose label toggles it too, so the row is the touch target. The machine row is 54x48 on a tablet, and 44x44 on a phone, where it falls short of the floor. Only status chips, which are not tappable, stay compact.
- **Shape**: radius 12, 16 px sides (24 px on the screen's main action), `disableElevation`, sentence case, a Rounded icon before the label where it helps recognition.
- **Hover** exists only under `@media (hover: hover)`; nothing depends on it.
- **Disabled, never removed**: a control that cannot act right now is disabled in place. A disabled tonal button keeps its raised fill and dims its label to `ink-disabled`; a disabled contained or text button takes MUI's default disabled colours. The machine row is the exception, by design: Stop takes the running start's place, a sleeping machine shows Wake alone, and a group-head machine's row is empty between runs.
- **Pending**: a tapped start, Wake, Tare or Sleep shows MUI's loading spinner in its own place (Stop has none). One command is in flight for the whole app, shared by the machine row and the stats card: while it is, a tap on a start, Tare or Sleep sends nothing, and Stop always goes. A command is sent once per tap and never retried on its own; a failure shows in the machine alert under the top bar, in plain words, until it is closed or the next command goes.
- **Stop, as built**: there is no Stop while nothing runs. Whenever the machine runs anything (a shot, steam, flush, hot water, cleaning, descaling) or is in a state CafAI does not know (D97), the start that runs turns into Stop in its own box: filled in the error colour, on-error text at 700, the square stop icon over "Stop" (the icon alone on a phone, named "Stop"). Box and place never change, so the finger that started the run finds Stop under it.

### The shell

`src/ui/shell/AppShell.tsx` draws both shells, with `LiveStrip.tsx`, `ShotTime.tsx` and `TapGuard.tsx`. One top bar element serves both layouts, and the routed screen and the machine row keep their places in the tree in every layout, so a rotation or a crossed breakpoint remounts neither: a command in flight keeps its spinner.

**Tablet**

- **Top bar**: 56 px, surface, a 1 px line below, 12 px sides, 4 px gaps (8 px from 1200 px wide). Left to right: the wordmark (a cup icon and "CafAI" in the accent, 19 px, weight 750); the places **Coach · Shot · History · Settings**, 2 px apart (4 px from 1200 px), each a 48 px text button with a Rounded icon and 8 px sides (16 px from 1200 px), the current one in the accent on the accent wash (`aria-current="page"`), the others ink-muted; a spacer; the **machine row** (below); a 1x30 px hairline in `line`; **Decaid settings**, a 48 px ink-muted icon button with the "opens elsewhere" icon, named for screen readers; and **Exit**, tonal, with a logout icon and two lines: "Exit" over a muted caption "to Decaid" ("Skins" outside Decaid). While a shot runs, the Shot item swaps its chart icon for the 9 px live dot and adds the pour time in ink, "Shot 42.0 s", in tabular figures inside a box 3.3em wide so the label never grows. Measured at 962 px inside Decaid mid-shot, the whole bar fits with 18 px to spare. Between 800 and 960 px wide (an iPad upright, a narrowed window) the places show their icons alone, 48 px wide with 12 px sides, their names kept for screen readers; the Shot item then shows the dot and the time.
- **Machine alert, then the old-engine warning**: right under the top bar, across the whole width, in the flow, so they push the screen down instead of covering a control (both below).
- **Main pane**: the routed screen at the window's full width, scrolling inside itself; there is no machine column. On the shot route the Shot view covers the coach, which stays mounted so its scroll and draft survive. For 350 ms after an automatic switch the main pane ignores taps; the top bar, Stop included, never does.

**Phone**

- **Top bar**: 52 px, surface, a line below, 16 px left (plus the left inset beside the rail, over which the bar reaches) and 4 px right: the wordmark, a spacer, the machine row as 44 px icons, then **Decaid settings** and **Exit** as 48 px ink-muted icon buttons, named for screen readers ("Exit to Decaid"). All on every screen. When the room runs out (a narrow phone beside four starts) the word "CafAI" wraps onto a second line its 24 px box clips, so the cup stays and nothing else moves; the word is back as soon as it fits (a group-head machine's empty row leaves it room).
- **Under the top bar**: the machine alert, then the old-engine warning, as on a tablet.
- **Tabs**: **Coach · Shot · History · Settings** (speech, chart, history and gear icons), on surface. Upright, a bottom bar 64 px tall plus the bottom safe-area inset, a line on top, the four tabs in equal columns inside 6 px of padding. On its side (under 500 px tall), a side rail 80 px wide plus the left inset, a line on its right, the same four stacked 4 px apart and centred, the content to its right. Each tab is a button at least 48 px square (60 px tall in the rail), radius 14: its icon in a 58x30 pill above a 12.5 px label at 650. The current tab's label is in the accent and its pill fills with the accent wash; the others are ink-muted on no fill. The tabs hide while a text field has focus, so the keyboard does not leave the chat a few lines tall, and come back on blur; when a tap (on Send, say) ends the typing, they wait for the press's release, so the tap lands where it was aimed. They are navigation only.
- **Shot tab**: the tablet's Shot view, over the coach kept mounted and hidden, laid out for the phone (narrow upright, short on its side: see the Shot view below).
- **Shot tab during a shot**: the tab shows a 7 px live dot and the running time in tenths ("42.0 s", in ink, tabular) in place of its label, counting like the tablet's Shot item and the live strip, in a box 3.3em wide so it does not grow as the seconds pass 10. Its accessible name is "Shot, running, 42 seconds", rewritten once a second (not with every frame) and removed when the shot ends. After the automatic switch the content ignores taps for 350 ms; the top bar, with Stop, and the tabs never do.
- **Live strip**: at the top of the Coach tab while a shot is live or its outcome is still on its way to the chat. One 64 px button to the Shot tab on the accent wash, radius 16, 10 px from the top and 12 px from the sides, padded 14 px left and 10 px right, with 10 px gaps: the 9 px live dot and "Live shot" ("Last shot" once the pour is over) in 15 px at 700; under it the time (ink, 650) and " · 11.5 g · 5.0 bar" (13.5 px, 550, ink-muted, tabular); a 104x38 chart of pressure and flow (2 px lines, round caps, pressure on top); an ink-muted chevron. It goes once the outcome is in the chat.

**While the barista types** the layout holds its height, never its width. With a text field focused it uses the window's own width and the tallest height since typing began, so a keyboard that shortens the window never turns a tablet into a phone mid-sentence (trading the tablet's top bar for the phone's and bringing the tabs up), nor an upright phone into one on its side. A new width (a rotation, a narrowed window) takes the window as it is: a phone turned while typing is a phone on its side, never an 844x844 tablet. After blur the held height stays until the layout would be the same without it, or 500 ms at most, so a closing keyboard never flashes the other layout.

**Decaid's exit hint**: for 10 s after the skin opens, Decaid floats an exit-hint snackbar over the bottom of the screen. Nothing that must be tapped at once lives there: the machine row and Stop are in the top bar, and the phone's bottom tabs are navigation only. The composer and the prompt row sit at the bottom of the chat, as the composer always has; both can wait.

### The machine row

`src/ui/machine/MachineRow.tsx`, with `useMachineCommands.ts` (sending) and `commands.ts` (which controls are live). In the top bar on every screen, as a group named "Machine". Water moves when these run, so their rules are strict: a tap sends once, a failure is shown and never retried, and a button never moves.

- **Starts**: **Espresso**, **Steam**, **Flush** and **Hot water**, 2 px apart. On a tablet each is a 54x48 text button in ink with no fill: its icon (21 px) over an 11.5 px label at 600 (line height 1.15, no tracking, never wrapped, so "Hot water" stays on one line). On a phone each is its icon alone (22 px) in 44x44, named for screen readers. They are enabled while the machine is connected and idle or heating and no command is in flight; otherwise they are disabled in place, in MUI's disabled text colour, and a visually hidden line tells a screen reader why ("The machine is asleep. Tap Wake first.", "Not connected. Wake the DE1 and pair it in Decaid."). The machine alert says it on screen.
- **Stop**: while the machine runs anything, the start that runs becomes Stop in its own box (see Buttons): Espresso's place for a shot (espresso, skipStep), Steam's for steam and steamRinse, Flush's for flush and airPurge, Hot water's for hot water, and the first place for anything else (cleaning, descaling, and a state CafAI does not know, which the state line shows humanised and CafAI reports as drift, D97). The other starts are held. Stop puts the machine to idle and is never held behind another command. There is no Stop at rest (idle, schedIdle, sleeping, heating, preheating, booting, busy, needsWater, error), and none during a firmware upgrade, calibration or self test, when the stats card's Sleep is held too.
- **After a run, and after a wake**: the starts stay held for 1 s (`STARTS_HOLD_MS`), so a second tap meant for Stop or Wake lands on a disabled start instead of starting something. Stop itself is never delayed.
- **Asleep**: the row is **Wake** alone (a sun icon over "Wake", a text button in ink), with its spinner while the wake is in flight.
- **Group-head controller**: a machine that starts its own runs has an empty row until something runs, then Stop alone; between runs a screen reader hears "Start on the machine". The answer is remembered across loads, so four starts never flash before the machine has said.
- **Failures** have no room here: a failed start or Stop ("Couldn't start the shot." plus Decaid's own sentence) shows in the machine alert.

### The stats card

`src/ui/machine/StatsCard.tsx`, with its pieces in `MachineStatus.tsx` and `LoadedProfile.tsx`; the chat decides when it shows (see Chat). Everything in it updates live, and each readout is its own small component, so a telemetry tick re-renders only the number that changed.

- **Card**: outlined Paper, surface, a 1 px line, radius 16, 12 px padding, 4 px above and below in the chat, a section named by its title. It lays itself out for its own width (`useOwnLayout.ts`, measured before the first paint, as Chromium 91 has no container queries): from 520 px the readouts sit four in a row; under 520 px (a phone) two by two, and Sleep shows its icon alone.
- **Header**: "Machine" (subtitle at 700) and, at the right, the links: "DE1" and "Scale" in `label`, ink-muted, 12 px apart, each after an 8 px dot, filled success when connected (a screen reader hears "DE1 connected"); "No machine" and "No scale" after a hollow 2 px ring in MUI's disabled text colour when not. Decaid out of reach is the alert's to say.
- **State line**: headline (h5), polite live region: "Ready", "Heating", "Sleeping", "Not connected", "Pulling a shot: pour" (the running step's name from the profile, when it has one). "Heating" follows the machine's own state: heating, preheating, or idle with the substate preparingForShot, which is what a warming DE1 reports (D112), so a cold machine never reads "Ready". Always one line: too long for the card ("Pulling a shot: reset temperature" on a phone), it ends in an ellipsis rather than wrapping, the whole text is its title and what a screen reader hears, and the Shot view names the step in full.
- **Countdown**: while the machine heats and Decaid's time-to-ready plugin has a fresh estimate, "Ready in about 3 min" (whole minutes, rounded up) or "Ready in under a minute" sits at the end of the state line's row: `label`, ink-muted, on one line, 12 px from the state line, on its baseline. The state line gives way to it (its ellipsis comes first), never the other way round, and nothing under the row moves when it comes or goes. Its text changes with the minute, not with every frame the plugin sends, and it goes 6 s after the plugin's last frame. Without the plugin, "Heating" stands alone.
- **Readouts**: Group, Steam, Water and Scale in a grid with 8 px gaps. Each is a label (13 px, 550, ink-muted), the value in `readout` with its unit at 0.68em, weight 550, ink-muted, and a caption line under it ("target 98.5", "No scale", or "Refill" in warning, when the value turns warning too). Every readout keeps its caption line, empty or not, so the rows line up and nothing moves when one appears. A missing value is a dash.
- **Foot**: under a 1 px line, the Profile line on the left and **Tare** and **Sleep** at the right (tonal, 48 px, 8 px apart). The Profile line: the label "Profile", then the profile's title on one line (subtitle, cut with an ellipsis, the full title in its tooltip) and a mark that keeps its place: "This bag" (success, with a check), "loading…" (ink-muted), "not confirmed" (warning, with an outlined alert icon). Offline, a muted caption beside the label says "Decaid loads it when the machine connects". Tare needs a scale (a screen reader hears "Connect a scale to tare." otherwise). Sleep (a moon icon) is Wake (a sun) while the machine sleeps, and is held while something runs or no machine is connected. On a narrow card Tare has 12 px sides and Sleep is a 48 px square with its icon alone, named. A failed Tare or Sleep shows in the machine alert, not on the card: the card comes and goes with the chat, and a failure must not go with it.

### The machine alert

`src/ui/machine/MachineAlerts.tsx`. One slim strip right under the top bar, across the whole width, only while a problem lasts, one problem at a time, the most important first. Nothing shows while the machine is fine, or before Decaid has said anything about its devices.

- **Look**: a standard MUI Alert (its tinted fill, in warning or error), at least 40 px tall, square corners, a 1 px line below, 12 px sides, 14 px text at line height 1.35. A closable alert sets its 48 px close button into the strip, so it stays as slim as the rest. It is in the flow, so it pushes the screen down rather than covering a control.
- **Buttons**: where one tap fixes the problem, the alert carries the fix at its end: 48 px text buttons in the alert's own text colour (never the accent), 4 px apart, so the strip is 48 px tall. The words keep at least 16em; where they would get less (a phone), the buttons drop to a line of their own under the words, at the right, rather than squeeze them. One Connect runs at a time in the whole app: the one looking shows its spinner and the other is disabled, and the words say "Looking for your DE1…" (or "Looking for your scale…") until it is done. A Connect that fails puts its reason in place of its own alert's words until the next try, or until the device is back: "No machine found. Check it is switched on and in Bluetooth range.", "Couldn't connect the DE1." and Decaid's reason, or, when the choice of device is Decaid's to make, "Couldn't connect the scale." and why: "The scale Decaid uses is not in range. Switch it on, or choose another on Decaid's scan screen.", "Decaid sees more than one scale. Choose yours on Decaid's scan screen." or "Decaid did not say which scale it uses. Choose yours on Decaid's scan screen." (for the DE1, "Couldn't connect the DE1." and the same sentences with "machine"). A Connect scale tapped in the not-connected alert that fails leaves the DE1's words in place; its reason shows in the scale's alert once the DE1 is back. A fix never acts by itself, and it does only what its label says.
- **Order**: a failed command from the machine row, the stats card or Next step ("Couldn't start the shot." plus Decaid's own sentence; error, closable, cleared by the next command); Decaid's latest device error, in its own words with its suggestion (closable); "Can't reach Decaid. Trying again…" (warning, once that has lasted 2.5 s); "Not connected. Wake the DE1 and tap Connect DE1, or pair it in Decaid's settings." with **Connect DE1**, and **Connect scale** when the scale is missing too (warning, once the machine has been away for 1 s); "The machine reports an error. Check it first." (error); "Refill the water tank to continue." (warning, once the water has been low for 3 s, and gone 3 s after it recovers, so a level wobbling at the line never flickers); "Decaid is set to leave stopping shots to the skin, and CafAI does not stop them, so shots will not stop at the target weight." with **Let Decaid stop shots** (warning, while Decaid's gateway mode is Full; if Decaid keeps its setting the words become "Decaid kept its setting. Set Gateway Mode to Tracking in Decaid's settings."); "The scale is not connected. Switch it on and tap Connect scale, or pair it in Decaid's settings." with **Connect scale** (warning, once the scale has been away for 3 s while the machine is awake; the button is held while the machine runs something).
- **Old-engine warning** (D58): under the machine alert, a full-width strip in warning drawn the same way, with a 48 px dismiss button; dismissed once per engine version.

### The live shot graph

`src/ui/machine/LiveShotGraph.tsx`, drawn by uPlot from the app-wide shot recording (`shotTrace.ts`). Samples never touch React state: the canvas is repainted at most once per animation frame, and the timer and readouts are written straight into their nodes.

**The plot**

- Pressure (bar), flow (ml/s) and weight flow (g/s) share one 0-12 left axis, as on the DE1's own chart, with grid lines every 3 (0, 6, 12 when the plot is under 72 px tall). Cup weight has its own right axis from 0 to at least 50 g, its labels in the weight colour. Time runs from 0 to at least 30 s, so a fresh shot is not stretched across the width. Axis labels are 12 px Figtree in `graph-axis` ("10s", "25g"); grid lines are 1 px `graph-grid`; no ticks.
- Series, bottom to top: the pressure and flow targets (dashed 6/5, 1.5 px, in their series colours), weight (1.5 px), weight flow (2 px), flow (2.5 px), pressure (2.5 px, on top).
- Touch first: no cursor, no hover readout, no drag to zoom, no legend inside the canvas.
- Before any shot the plot shows "Pull a shot to see it here." (body-small, ink-muted) centred in the plotting area, on a patch of the colour beneath so no grid line strikes through it, and the timer shows the dash.
- Captions: "Shot graph" before any shot, "Live shot" with the live dot while pouring, "Last shot" after. Once the chat has the shot's card, the timer and the weight switch to the card's numbers (the pour time and Decaid's settled yield), so the Shot view never says one number while the card says another.

**The Shot view** (`ShotView.tsx`: a tablet's Shot, the phone's Shot tab)

- **Layout**: it lays itself out for its own box (`useOwnLayout.ts`), as the main pane loses height to the alert and to a phone's tabs or rail. **Wide** (a tablet): across the main pane, at most 960 px wide and centred, 20 px sides, 14 px top and bottom, 10 px gaps. **Narrow** (under 600 px wide: an upright phone): 12 px sides, the step on a line of its own, the readouts two by two. **Short** (under 440 px tall: a phone on its side; short wins over narrow): 12 px sides, 8 px top, bottom and gaps, four readouts in a row. Should even the plot's minimum not fit (an alert on the smallest phone on its side), the view scrolls rather than cut off the note.
- **Header**: a 9 px live dot, "Live shot" (subtitle at 700), the running step ("Pour · step 3 of 3", body-small at 550, ink-muted, on one line with its full text as its title), and the pour timer in `display` at the right (34 px when narrow or short). The step is in sentence case, as CafAI writes its own labels ("pause" shows as "Pause", "Pressure Up" as "Pressure up"); a word in capitals or mixed case ("PI", "LRv3") stays as its author wrote it. When narrow, the step has a full-width line of its own under the caption and the timer; once a shot has started that line keeps its place, empty when there is no name to show (none read yet, a step the profile does not name, the pour over), so nothing under it moves as the steps change. Wide or short, the step sits between the caption and the timer, cut with an ellipsis when it is too long.
- **Readouts**: **Pressure**, **Flow**, **Weight**, **Weight flow**, each a label (13 px) with its 12x3 series swatch over a `readout-large` value such as "5.0 bar"; Weight adds " of 50" at half size, ink-muted, when a stop-at-weight target is known and there is a shot, on a phone too. These replace the legend. Four in a row with 10 px between columns (wide, short), or two by two with 16 px between columns (narrow); 8 px between rows. The values are 30 px on a tablet, 24 px on a tablet window under 900 px wide, and 24 px on a phone (narrow or short; they were 18 px).
- **Plot**: it fills the rest, at least 120 px tall in every layout. The coach's note sits under it.
- **Next step** (D113): a tonal button at the end of the coach note's row under the plot. The row is a grid: the note takes the rest, Next step its own width, 10 px from the note, both aligned to the bottom; with neither showing, the row is gone. Wide, it is a skip icon and "Next step" with 16 px sides; narrow or short (a phone), the icon alone in a 48 px square, named "Next step", so the note keeps its width. It shows only while the machine pulls a shot in preinfusion or pouring and the profile has a step after the current one: never in the preheat, never on the last step, never in the top bar. It shares the app's one command in flight with the machine row (held while another command is in flight, its own spinner while it goes), and after a tap it stays disabled until the machine shows the next step, or 1.5 s, so a double tap moves one step. The spec put it beside the step's name in the header; the code puts it here.

### The coach's note

`src/ui/machine/CoachNote.tsx`. While a shot runs, a small note under the plot, never over the curves, says whether the coach is watching. `role="status"`.

- A 34 px round avatar (the accent wash, a speech icon at 18 px in the accent) and, 10 px beside it, aligned to its bottom, a bubble: raised fill, ink, body-small, 14 px sides and about 9 px top and bottom, radius 16 with the corner nearest the avatar at 6 px, at most 520 px wide.
- It enters with a fade and a 6 px rise over 200 ms ease-out, instantly under reduced motion.
- It says, first match wins: "Add your API key in Settings, and I'll read your shots." / "I'm not coaching this one. Pick a bag and a starting profile, and I'll read your shots." / "This shot runs "{profile}", not {version}, so it won't be part of this dial-in." / "I'm watching, but {version} isn't confirmed on the machine yet, so this shot may not count." / "I'm watching this shot. I'll read the curves once it's done." After the pour: "Done. Reading the shot" with three 5 px ink-muted dots that pulse in turn (screen readers hear the full sentence). It is gone once the shot's card or notice is in the chat.

### Chat

`src/ui/chat/ChatSurface.tsx` (the only module that imports x-chat), `CoachScreen.tsx`, and `statsCard.ts` for the stats card's place. The chat shows once there is an API key and a bag; before that the pane holds an empty-state card, and there is no stats card and no Stats prompt.

- **Bag header**: at least 64 px, 12 px sides, 10 px gaps, a line below. The bag picker reads as the screen's title (a native select, 19 px at 700, 48 px tall, no underline); the version is quiet text beside it ("v4 · Blooming Espresso": the version in ink at 650, the rest ink-muted body-small); then a spacer and **Undo** and **New bag** (tonal, 48 px). On a phone they are 48 px icon buttons with the tonal fill, named "Undo" and "New bag" for screen readers, and the header keeps to one row: the picker and the version give way (the version with an ellipsis), the icons never do.
- **Lane**: the thread is capped at 680 px and the composer at 760 px, centred in a wide pane; the prompt row (Stats, and while the taste question is open Taste words and Need help?) shares the composer's lane.
- **Messages**: the coach's (and the app's) messages sit on the page with no bubble, across the full lane, so their cards read as cards, under x-chat's small author label, "Coach" ("CafAI" for the app's own lines; caption size, 550, ink-muted). The barista's own words sit in a right-aligned bubble: raised fill, ink, radius 12, 8 px by 12 px. The accent is kept for actions, never for bubbles.
- **Text**: 16 px at line height 1.5; paragraphs and lists 12 px apart, lists indented 20 px, list items 2 px apart, code in monospace at 0.9em. The coach's text supports bold, italic, code and lists, never links or images; what the barista typed is shown verbatim.
- **Thinking**: while the coach works with nothing streaming yet, a row with a 16 px spinner and "Thinking…" in ink-muted body-small, adding the seconds after 3 s ("Thinking… 12 s"), so a slow reply never looks frozen.
- **Stats card** (D91): the machine's live card (see The stats card) as one more row at the end of the thread, on screen only, before the thinking row when there is one. The first time the chat shows in a session it follows the newest message (an empty chat too). It goes as soon as anything new lands (a message from either side, a notice, a shot card) or another bag opens, and stays gone even if what landed goes again (a progress notice does); it stays while the newest message only changes inside (a rating, a reply still streaming). It is never one of the conversation's messages, so it is never stored, exported or sent to the coach. It is CafAI's (role system) and joins the run of messages above it, so no author label of its own sits over it ("Coach" over the machine's numbers would read as advice). A visit to History and back finds it where it was; a reload starts with it shown.
- **Composer**: x-chat's compact composer on surface, a 1 px line, radius 12, 4 px padding, 8 px from the pane's sides and bottom, up to four rows of 16 px text. Its placeholder says what the coach is waiting for ("Tap an answer, or say how it tasted", "Pull a shot, or ask the coach"), in ink-muted at full opacity, as every input's placeholder is (x-chat and MUI would fade the text colour, a pair the sweep cannot check). **Send** is a 48 px square, radius 12, accent with an on-accent arrow, faded to 38% while sending is blocked (typing never is).
- **Prompts above the composer**: one row in x-chat's suggestions slot, on every chat, tablet and phone, an empty one too (an empty thread shows nothing of x-chat's own, so the row stays above the composer). It shares the composer's lane (at most 760 px, centred, never closer than 8 px to the pane's sides), with 2 px above it and 8 px between it and the composer; it wraps, and on a phone on its side it scrolls rather than push the composer off the screen. Each prompt is a chip 40 px tall, radius 20: surface inside a 1 px line, an 18 px icon and its label at 15 px, weight 600; an invisible band 5 px above and below makes its touch area 48 px, and a touch leaves no hover colour behind. **Stats** (its gauge icon in the accent) is always there: a tap posts the card after the newest message, or leaves it where it already is, and brings it into view (from its top when it is taller than the view, however far the reader had scrolled); nothing is sent, the coach is not called, and the draft stays, even while the coach works. While the taste question is open (D127), **Taste words** (a chevron after its label, up while open) and **Need help?** (an ink-muted help icon) follow it. Taste words opens a panel on a line of its own right above the composer: surface inside a 1 px line, radius 12, 8 px sides; tabs for Acidity, Sweetness, Bitterness, Body and Finish (48 px, 15 px at 600, the current one in the accent with its indicator, scrolling on a phone), the group's question in ink-muted body-small ("Does it make your mouth water?"), and its words as chips drawn like option chips (48 px, radius 24, 16 px, outlined in line; a word in the draft fills with the accent and a check). A tap puts the word into the composer's draft after a comma ("short" goes in as "short finish") and a second tap takes it out; the composer does not take the focus, so a phone's keyboard stays down, and nothing is sent until Send. Need help? opens a dialog, "How to taste": a sip, then what to notice (acidity, sweetness, bitterness, astringency, body, the finish, each as a question), "There are no wrong answers. Say what you notice, in any words." and "Your last shot is the best guide: compare the two, and say what changed.", then **Got it** (contained).
- **Following**: the thread keeps the newest message in view as content arrives, unless the barista scrolls up; then x-chat's scroll-to-newest button appears at the bottom of the thread.
- **A new bag** (D116): its chat opens on "Which coffee is it?" still to answer, so the thread shows from that card's top, not its end, and stays there while the rows under it grow (the card's own rows arriving, the stats card's numbers), until something newer lands, the barista acts (taps a card, sends a message) or scrolls to the end; then it follows as above. "Newer" is the thread's newest row as CafAI hands it to x-chat, which draws a new thread a moment later. A barista who scrolls the held card is reading it: the thread stops following until they act or reach the end. When the stats card shows (the first time the chat shows in a session), it is still the newest row, below the card.

### Cards

All cards are outlined Paper: surface, a 1 px line, radius 16, 12 px padding (16 px for settings sections, 24 px for empty states), 4 px above and below in the chat. Titles are `subtitle` at 700; names in lists and questions at 600. Emphasis is a full border. A card that is set aside (a starting profile not picked, an undone version) never vanishes and is never faded with opacity: it takes ink-muted, which the contrast sweep checks.

- **Shot card**: a header (an accent cup icon, "Shot 60.6 s" in subtitle at 700, " · Kiambu AA v4" in ink-muted body-small); four metrics in a grid of columns at least 104 px wide (16 px between columns, 8 px between rows): **Dose → yield**, **Ratio**, **Peak pressure** ("5.4 bar at 60 s"), **First drop**, each a `label` over a `metric`; a sparkline of pressure and flow (48 px tall, up to 360 px wide, the same 0-12 scale, 2 px lines with round joins, pressure on top, a 1 px line as its baseline) with its two legend keys stacked beside it, and on the newest shot's card only a **Graph** text button (accent, chevron, 48 px) to the full graph; possible channeling in warning with a warning icon; once Decaid's Visualizer plugin has uploaded the shot, **On Visualizer** (D121): a text button in the accent, 48 px, 4 px down, with the "opens elsewhere" icon after its label, that is a plain link to the shot's page on visualizer.coffee, which Decaid opens in the system browser (only a Visualizer shot page is ever linked); and "Compared with your previous shot?" (ink-muted body-small; a bag's first shot asks "Compared with your last shot of <coffee>?" and the very first "Compared with the coffee you usually enjoy?", D126) over five words in one row the card's width, **Much worse**, **Worse**, **About the same**, **Better**, **Much better**, on the Mode control's raised track (radius 14, 4 px padding and gaps): segments at least 48 px tall, radius 10, 15 px labels at 600 in ink-muted that wrap inside their segment on a phone (About the same in three lines at 390 px); the chosen one is surface with an ink label and the hairline shadow; it behaves as a radio group (one Tab stop, About the same until there is an answer; the arrow keys move it, right and up towards better). A card rated with stars before D126 says "You rated it 4 of 5 stars." (ink-muted body-small) instead and asks nothing.
- **Change card** (the coach's proposed change): the summary as its title; each change line in `body` as "Grind: 12 → 11" with the label and the old value ink-muted (the old value struck through), an ink-muted arrow icon read as "changes to", and the new value in ink at 600; by-hand steps after an accent hand icon at 600. While pending it has a **2 px accent border**, a muted line saying what Confirm will do ("Confirm saves this as v5 and loads it onto the machine."), then **Confirm** (contained, 24 px sides) and **Not now** (text). Afterwards the status replaces the buttons: a progress bar while loading, a success check with "Saved as v5" and a tonal **Undo** on the latest one, or a muted "Not applied. Nothing changed on the machine.", "Undone. Back on the previous version.", or an error line. The reasoning ("Why:", "What it changes:", their labels ink-muted) comes last, under a 1 px line, so even the longest card keeps Confirm in view when it lands at 962x602.
- **Starting profiles** (template cards): a list of cards 8 px apart; each has the name (subtitle at 600) and a small confidence chip (outlined: success for high, accent for medium, default for low), "style · shape" in ink-muted, the reason, and at the right **Use this** (contained, 48 px; a text button once a choice is made) or "In use" in the accent with a check. The chosen card gets a 2 px accent border. The others, once one is picked or the suggestions are set aside, keep their place in ink-muted: the name and the reason muted, the confidence chip muted with a line-colour outline, and Use this a disabled text button.
- **Which coffee is it?** (the bean card, `parts/BeanCard.tsx`, D115): the first row of a new bag's chat, a section named by its title, "Which coffee is it?". The coffees of Decaid's bean library are plain rows inside the one card, not cards of their own, so more of them fit on a small screen: a list named "Coffees in Decaid's bean library", rows divided by 1 px lines (none above the first), 6 px above and below each. A row is the coffee's name (subtitle at 600, line height 1.3) and under it, in ink-muted body-small, its roaster and "Roasted 3 Sep 2026" joined by a middle dot; at the right, 12 px away, **Use this** (contained, 48 px, 16 px sides). Every row's button shows "Use this" and is named "Use this: <coffee name>, roasted <date>" (without the date for a batch that has none), so a screen reader that lists the buttons alone hears which coffee, and which roast when two batches of one bean are listed. Each row keeps its contained button, as each starting profile's card does: the rows are equal choices, drawn as one card only to fit more. While Decaid's coffees are read, a line 8 px under the title says "Looking in Decaid's beans…" in ink-muted body-small after a 16 px spinner, 10 px apart, as a status region (`role="status"`), and the rows come in under it. Then, 12 px down, **Photo of the bag** (tonal, a camera icon before the label, its own spinner while the photo is made ready) and **Something else** (text), 8 px apart, wrapping; both work while the rows load and when Decaid is away (no rows then). The photo goes through a hidden file input. Answered, the card stays where it was, closed: where the answer's button was, the answer in the accent with a check ("Picked" on its row, "Photo of the bag", "Something else"); the picked row is marked current (`aria-current`), and the other rows keep their place in ink-muted, their Use this a disabled text button. A message typed in the chat sets the card aside, and it says "Set aside: you described the bag in the chat." under its title. A file that is not a photo, or one CafAI cannot open, puts a warning notice under the buttons ("That file is not a photo. Take or pick a photo of the bag."); a photo the coach's model cannot read leaves the card open, with the reason in the chat.
- **Check the bag's details** (the confirm card, `parts/BagConfirmCard.tsx`, D120): the coach's next row once a photo is read (the chat shows "Reading the bag…" with an indeterminate bar meanwhile). While open it has the **2 px accent border**, "Read from your photo. Fix anything that is wrong, then confirm." in ink-muted body-small, then the fields in a grid of columns at least 220 px wide, 12 px apart: Name, Roaster, Origin and Process (outlined text fields, labels always raised, 48 px, each taking at most what CafAI keeps of that detail, 40 characters for the name), Roast level (a native select: "Not on the bag" and the five levels), Roast date (a date field) and Tasting notes across the whole width (up to four rows). A blank name shows "Needed: it names the profiles." in the error colour and holds **Confirm** (contained, 24 px sides) disabled. Confirmed, the fields give way to the details as text: the name (subtitle at 600), then roaster, origin, process, "light roast" and "Roasted 28 Sep 2026" joined by middle dots in ink-muted, then "Tasting notes: …", and "Confirmed" in the accent with a check; the border goes back to the 1 px line. Set aside by a typed message, the card turns ink-muted and says "Set aside: you described the bag in the chat. These details were not saved."
- **The grinder card** (`parts/GrinderOfferCard.tsx`, D125): the coach's offer to add a grinder the barista named, which is not linked, to Decaid's grinder library; a section named "Add your grinder to Decaid". While open it has the **2 px accent border**: the title "Add Niche Zero to Decaid's grinders?" (subtitle at 700), what the coach heard in ink-muted body-small ("Burrs: 63 mm conical. A numbered dial, in steps of 0.5."), a body-small line saying what Add does ("Decaid and your other skins will list it, and CafAI uses it from then on.", or that without its step size the coach gives directions only), then, 12 px down, **Add to Decaid** (contained, 24 px sides; a spinner and "Adding…" while it works) and **Not now** (text), 8 px apart. A failed Add says why under that line in the error colour, as an alert ("Couldn't add it: … Try again, or tap Not now."), and the card stays open. Answered, the buttons give way to "Added to Decaid's grinders: CafAI uses Niche Zero now." or "Decaid already had Niche Zero: CafAI uses it now." in the accent with a check, or "Not added." in ink-muted, and the border goes back to the 1 px line. Set aside by a typed message, the card turns ink-muted and says "Set aside: you typed in the chat instead. Nothing was added."
- **Empty states** (no API key, no bag): one card centred in the pane, at most 460 px wide, 24 px padding, centred text: a 40 px accent icon, a `title`, a muted body-small sentence, then a single contained button ("Open Settings", 48 px; "New bag", 56 px with 32 px sides).
- **Settings**: a column at most 760 px wide, 16 px padding, a `title` "Settings", then sections 16 px apart, each a card with 16 px padding and its title in subtitle at 700 with 8 px under it: Appearance, Where the coach runs, Anthropic API key, Coach, Steam, hot water and flush, About. Fields are outlined text fields and native selects, 48 px tall, radius 12; a section that saves has one contained Save, and its secondary actions are tonal. Appearance is the first section and needs no Save: it applies at once, as do the key switch and the drink settings (below). Under Coach's grinder fields (D125), **Add a grinder** (text, a plus icon; there once Decaid has answered with its grinder library) and, while Decaid runs DYE2, **Edit grinders in DYE2** (text, an edit icon, a link to DYE2's Grinders page) sit 8 px apart, with a success Alert under them after an add ("Added Niche Zero to Decaid's grinders. Save settings to use it."). Add a grinder opens a dialog, "Add a grinder to Decaid": a line saying Decaid and the other skins will see it too; Grinder, Burrs (optional) and Dial (a native select: Numbered dial or List of settings), 48 px fields; then Smallest step and Big step (optional), side by side from 600 px, over "CafAI turns the dial in these steps. Not sure? Leave them empty and the coach gives directions only.", or Settings, finest first ("With commas between them, as the grinder shows them."); a field to fix says why under it; then **Cancel** (text) and **Add to Decaid** (contained; "Adding…" while it works).
- **History**: a header ("History" in `title`, tonal **Export** and **Import**; 16 px sides, 12 px above, 8 px below, a line under it), then a column with 16 px padding in which the bags sit 8 px apart. A bag is a card holding one 64 px row button: its name (subtitle at 600) and details (ink-muted body-small) on the left, the shot count and the date on the right, an ink-muted chevron. A version card carries a small status chip (Active filled in success, Superseded outlined, Undone outlined in warning) and dated shot rows separated by 1 px lines, their facts joined by middle dots; a shot that has a Visualizer link ends its row with **On Visualizer**, as on the shot card, at its own width. The active version's card has a 1 px success border. An undone version's card is in ink-muted throughout, its Undone chip still in warning.

### Chips

- **Option chips** (answers to the coach's questions, `parts/OptionChips.tsx`): 48 px tall, radius 24, 16 px labels, wrapping 8 px apart under the question (subtitle at 600, 8 px above the chips). At rest a chip is outlined with an ink label; chosen, it fills with the accent, its label on-accent, with a check icon. **Other** is always last, with a pencil icon, and opens a 48 px text field ("Describe it in your words"); a multi-select question, or Other, adds a contained **Send**. A single-select answer is sent on the tap. Once answered or set aside, the chosen chips stay filled and the rest turn to ink-muted with a line-colour outline: still disabled for screen readers, never faded. Only an open question waiting on the coach keeps MUI's faded disabled chips, because its answers come back. As built, the resting chip's outline is MUI's default outlined-chip grey (#616161 in dark, #bdbdbd in light), not the tinted `line` the mockup draws: prefer `line` for anything new.
- **Status chips**: small (24 px tall, 15 px text), not tappable, outlined or filled in a status colour, for confidence and version status. Never a button in disguise. A chip outlined in a status colour or the accent draws the outline in that colour, opaque (MUI's is 70%), so the sweep's 3:1 for chip outlines holds.

### Notices, alerts and dialogs

- **Notice** (a line from the app itself in the chat, `parts/Notice.tsx`): a small icon and body-small text. Info is ink-muted, icon and text; success, warning and error put the icon in their colour and keep the text in ink. With progress, a rounded bar sits under the line, indented 28 px to align with the text, with an optional caption at the right ("Try 2 of 3"), at most 480 px wide.
- **Alerts**: MUI Alerts with plain-word messages that name the next step, all standard, with MUI's tinted fill: the machine alert under the top bar (a failed command, a device error, the connection, the machine's error, water, gateway mode, the scale; see The machine alert) and the old-engine warning under it, the coach's error banner (with Retry and a 48 px dismiss), and the saved and failed messages in Settings.
- **Dialogs**: only for confirming a destructive step (Forget the API key), an export's result, adding a grinder to Decaid (D125) and How to taste (D127). A short title, a sentence or a short form, then the actions at the right: the quiet choice as a text button, the decisive one contained ("Forget key" in error; "Done", "Add to Decaid" and "Got it" in the accent).

### Appearance controls

`src/ui/settings/AppearanceSection.tsx`, the first section of Settings. Changes show on every screen at once and are saved with the other settings.

- **Mode**: a three-part segmented control, **Dark · Light · Auto**, each with its icon, on a raised track (radius 14, 4 px padding and gaps). Segments are 48 px, radius 10, 15 px labels in ink-muted; the chosen segment is surface with an ink label and a hairline shadow. Helper text: "Auto follows this device's light or dark setting."
- **Tint**: a radio group of eight cells in four columns (10 px between rows, 6 px between columns). Each cell is one button: a 48 px circle, the tint's accent as a 9 px ring around its background (both as the current mode draws them), over its name in `label`. Custom's ring is a conic wheel of the slider's hues. The chosen cell gets the one ring (section 4) and an ink name; the others are ink-muted. A press scales the circle to 0.94. Arrow keys, Home and End move between the tints. A name that wraps on a narrow phone ("Cold Brew" at 320 px) grows down from the top of its cell, so the circles of a row stay level.
- **Custom hue**: a slider, 0 to 359, on a 30 px fully round rail whose gradient is 13 hex stops at OKLCH L 0.76, C 0.11 (every 30°, in both modes), with the thumb travelling between the centres of the rail's round ends. The thumb is 36 px: the current accent inside a 4 px white ring, with a soft shadow, a 48 px touch area, and an accent halo while dragged. Dragging previews every hue live and saves where it stops; it selects Custom.
- Helper text: "The tint colours the buttons and tints the backgrounds. Shot graph colours never change: pressure green, flow blue."

### Steam, hot water and flush

`src/ui/settings/DrinkSettingsSection.tsx`, with the ranges, steps and labels in `drinkSettings.ts` (D114, D124). The section after Coach. Changes apply at once: there is no Save.

- **Help and status**: one line in body-small and ink-muted, 8 px under the title: "The Steam, Hot water and Flush buttons use these. Changes go to Decaid at once." When the settings cannot be changed it gives way to the reason, one at a time, as a status region: "Reading Decaid's drink settings…" until Decaid answers, "Connect the DE1 to change these." while no DE1 is connected, otherwise "Not while the machine is running.". The line keeps its height (one line from 600 px, two on a phone), so the groups never move when the machine starts.
- **Groups**: one per drink, in the title's order, each a group named by its heading: the machine row's icon (20 px, ink-muted) and the drink's name in `subtitle2` (15 px, 600), 12 px above its settings. From 600 px wide (a tablet, a phone on its side) the three sit side by side in equal columns 24 px apart, each setting a `label` in ink-muted over its stepper (6 px), settings 12 px apart. On a phone they stack 24 px apart and each setting is one row: the label in body-small and ink, the stepper at the end, 184 px wide (on the narrowest phones what the longest label leaves, the same for every row of the drink), rows 8 px apart. Labels name only the setting ("Temperature", "Volume", "Time", "Flow"); every drink lists temperature first.
- **Stepper**: one outlined field, 48 px tall, radius 12. Less and More each fill 30% of it at its ends (at least 48 px), ink icons, a pressed button filling its end of the outline; between them the value in 17 px at 600 in tabular figures, its unit beside it on the same baseline in `label` and ink-muted ("150 °C"). The value is a spin button named for its drink ("Steam time"), its value text saying the unit in words ("50 seconds"); it opens the numeric keyboard (with a decimal point for flows), Up and Down step it from what is typed, and the two buttons are out of the tab order. Focus draws the 2 px accent outline.
- **Values**: a tap moves by the field's step (1 °C; 5 s for the steam and hot water times, 1 s for the flush; 10 ml; 0.1 ml/s for steam, 0.5 ml/s for hot water and flush), as do Up and Down, and leaving the field commits what was typed. Either is clamped into the field's range and rounded (whole numbers, flows to one decimal), and the field shows the result. Only a value that changed is written; a field left alone never re-sends or clamps what Decaid holds. A step at or past the end it points to does nothing, so a value Decaid holds outside the range never moves the wrong way.
- **Unknown values**: until Decaid answers, every field shows a dash (—), disabled and without buttons, and the line says "Reading Decaid's drink settings…". A field Decaid sent that CafAI cannot read stays a dash with "CafAI could not read Decaid's value." under it in body-small and ink-muted. A dash is never replaced by a made-up value.
- **Steam off**: any steam temperature below 135 °C (steam off in Decaid) reads "Off in Decaid" across the field in body-small and ink-muted, with no buttons and no note, so the drinks stay in line. Turning steam on or off is Decaid's.
- **No DE1, or the machine running**: every field and button is disabled in place, the values still showing in ink-muted (only the buttons fade), and the line says why.
- **Saving and failures**: a write still on its way after 0.4 s says "Saving…" under its field; a quicker one never shows it. A failed write puts that field's old value back, outlines it in the error colour and says why under it in body-small in the error colour, as an alert ("Could not save the hot water volume: …"), until the field is written again; a write of another field is kept. A failed read shows "Could not read Decaid's drink settings: …" in an error Alert under the line, with **Retry** (a 48 px text button in the Alert's colour) at its end, and the fields stay dashes.

### The key switch

In Settings > Anthropic API key, under the key's field and buttons (`KeyInDecaidSwitch` in `src/ui/settings/SettingsScreen.tsx`, D99): a switch labelled "Keep my API key in Decaid", off by default, on in the accent, at MUI's own size in a row 48 px tall; a tap on the label toggles it too. Under it, in body-small and ink-muted, what it costs: "So you do not have to paste it again after a Decaid update. Any device on your network can read Decaid's store, and Decaid's backups include it." With no key saved and the switch off, it is disabled and the line says "Add a key above before turning this on."; once on, it can be turned off with or without a key. It is disabled too while the choice is read or sent. It applies at once. A toggle that cannot reach Decaid goes back and says "Could not reach Decaid: …" in the error colour under the note, so the switch never shows a state that is not real. Forget key's dialog is unchanged; when Decaid cannot delete its copy, the section's message says so in plain words.

### About

The last section of Settings: "CafAI <version>", then the Decaid lines (`src/ui/settings/AboutDecaid.tsx`, D96), all in body-small.

- **Versions**: "Decaid 0.9.0 (CafAI was verified with 0.8.8)" in ink, or "Decaid version unknown (not connected)" in ink-muted. A running Decaid older than the verified one adds, in ink-muted, "Older than the Decaid CafAI was checked against; update Decaid if something does not work."
- **Drift**: only when Decaid has sent something CafAI did not expect: 8 px down, "Decaid sent 3 things CafAI did not expect", then a bulleted list indented 24 px, one entry per line as "route or channel: field and what was wrong" (each kind once, at most 50), then **Copy report**, a 48 px text button in the accent. After a copy a status line says "Copied." in success or "Copying failed. Tap the text, select all, then copy." in error. The list is in ink, not a warning colour: it is a report to send, not an alarm.
- **Backup**: last, 8 px down, in ink-muted: "Backed up to Decaid 4 min ago" (then "5 h ago", "3 days ago"; it counts on while About is open), "Backup paused: <reason>" or "Not backed up yet". Left out while CafAI does not yet know how the backup stands (a fresh page, until Decaid's record of the last backup is read).

### Motion

- **State changes take 150 to 250 ms and ease out.** The coach's note and the live strip enter over 200 ms ease-out (a fade with a 6 px rise for the note, a 4 px drop for the strip). The Mode segments, the words of a shot's rating and the tint swatches change in 200 ms (MUI's `shorter`, its standard curve); the composer's focus border in 250 ms.
- **The live dot** pulses while a shot runs: opacity 1 to 0.35 and back over 1.6 s, ease-in-out, looping; it holds still at full opacity under reduced motion. It is 7 px in the phone's Shot tab and 9 px elsewhere.
- **"Reading the shot"**: three 5 px dots, opacity 0.3 to 1 over 1.2 s, each 0.2 s after the last; still under reduced motion.
- **Press feedback**: MUI's ripple on buttons, which animates only when the device has no reduced-motion preference; the tint swatches scale to 0.94 instead.
- **No bounce, spring, parallax or route transitions.** Screens swap in one frame. An automatic swap (a shot starting, the coach coming back) uses `location.replace`, so Back goes where the barista went, and is followed by the 350 ms tap guard on the main pane, never the top bar.
- **Every animation has a still alternative** under `prefers-reduced-motion: reduce`: CafAI's own animations switch off (`animation: none`), and a global CssBaseline rule settles everything else at once, MUI's spinners and indeterminate progress bars included. Their meaning is always in the words beside them ("Thinking… 12 s", "Loading v5 onto the machine…").

## 6. Do's and Don'ts

### Do

- **Do keep every control where it is while a shot starts.** Disable instead of removing; let only the main pane change; put Stop in the place of the start that runs, enabled whenever the machine runs, and never under the tap guard.
- **Do let the shot own the screen while it runs**: the big graph, the timer and Stop; the coach's note under the plot, never over the curves.
- **Do keep text that changes during a shot to one line** (the state line, the Shot view's step), and keep a line that comes and goes in its place, empty: a wrap or a new line moves everything under it, Stop included.
- **Do read every colour from the theme** and add a new role to `buildPalette` (and its pairs to `palette.test.ts`) when nothing fits.
- **Do give each region or card one contained button** for its main action (Send in the chat, Confirm on a change card, Use this on a starting profile) and make every other action tonal (or a text button for the quiet choice beside a primary). The machine row is the exception: four equal text buttons, and Stop, filled in the error colour, while something runs. So is the bean card: each coffee's row keeps its contained Use this, as each starting profile's card does, because the rows are equal choices drawn in one card only to fit more.
- **Do make anything tappable at least 48 px** and space them 8 px apart. The machine row is the exception: 54x48 boxes 2 px apart in the tablet's top bar, 44x44 in the phone's.
- **Do set live numbers in tabular figures** with a space before the unit, one decimal for live readings, and a dash for a value the machine has not given.
- **Do write states in words beside their colour**, in sentence case, in plain language, with the next step in an error.
- **Do put the fix in the alert when one tap can fix the problem** (Connect DE1, Let Decaid stop shots), and let the tap do only what its label says.
- **Do hold a button after a tap until the machine shows the result** when a second tap would do more than the first (Next step). Stop needs no hold: a second Stop does no more than the first.
- **Do follow the machine's own state for what it is doing** (Heating, Ready); a plugin may add a number, never the state.
- **Do show a change in plain words and wait for a tap** before anything reaches the machine; put the decision before the reasoning.
- **Do keep Exit and Decaid settings on every screen**, in every layout, during a shot too.
- **Do give every animation a still alternative** under reduced motion, and keep motion between 150 and 250 ms.
- **Do check new screens at 962x602** (the smallest Decent tablet) and at 390x844 and 844x390, in dark and light, in Crema, Matcha and Tamper.

### Don't

- **Don't put must-tap controls at the bottom of the screen in the first 10 s** after the skin opens: Decaid's exit hint covers it. The phone's bottom tabs are navigation only, and Stop is never down there.
- **Don't use `oklch()`, `color-mix()`, MUI's `cssVariables`, container queries or other post-Chromium-91 CSS.** Compute colours to hex in TypeScript.
- **Don't colour graph series with the tint**, and don't change Decent's convention (pressure green, flow blue, bar and ml/s on one 0-12 axis).
- **Don't add a second accent**, and don't use the accent for headings, decoration or anything on the plot.
- **Don't use side-stripe borders** (a coloured left edge) for emphasis: use the full 2 px accent border, as the pending change card does.
- **Don't use uppercase eyebrows**, overlines in capitals, or letter-spaced labels.
- **Don't use shadows or elevation for cards**, and don't let MUI's dark-mode elevation overlays grey a surface.
- **Don't use glassy gradients, glassmorphism or glow**; the only gradients are the hue rail and the Custom swatch, and they show hues.
- **Don't build metric tiles or a dashboard of charts**; one graph, drawn like Decent's, with the numbers beside it, and the machine's numbers in one card in the chat that goes when the chat moves on.
- **Don't use mascots, latte-art clip art, novelty fonts** or emoji in the interface.
- **Don't let the page scroll or add edge gestures**; a region scrolls inside itself.
- **Don't send a machine command or change one of Decaid's settings without a tap, or retry one on its own.**
- **Don't show a 0 for a reading Decaid did not send**, and don't write back a setting the barista did not change.
- **Don't rely on hover**, a cursor, or drag on the graph: hover styles live only under `@media (hover: hover)`.
- **Don't draw a colour pair the contrast sweep does not check, and don't dim content with opacity**: a faded colour is a pair the sweep never sees (set-aside cards and chips fell to 2.3 to 3.7:1 in light mode that way). Set content aside in ink-muted instead; only a control disabled for the moment keeps MUI's faded look.
- **Don't use em dashes in interface copy.**

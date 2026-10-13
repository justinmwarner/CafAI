# Steam, hot water and flush, live: design

Date: 2026-10-13. Status: approved (the owner chose "Build it as drawn", with
the two answers in section 1).
Mockup: [2026-10-13-drink-views.mockup.html](2026-10-13-drink-views.mockup.html)
(open it in a browser for the motion), rendered in `assets/drink-views-*.png`.
Builds on the chat-first shell
([2026-10-08-chat-first-machine-design.md](2026-10-08-chat-first-machine-design.md))
and the drink settings of the Decaid alignment
([2026-10-09-decaid-alignment-design.md](2026-10-09-decaid-alignment-design.md), 6.6;
DECISIONS.md D114, D124).

## 1. The owner's ask

"When using non-espresso settings, ie: pouring, steaming, rinsing. I'd like
to have the screen go to a different page that shows it happening, any
properties / stats that can show, and also include the settings to change
those settings, ie: I know a lot of these support the amount to do, some the
temp, etc. Just don't make it so static, some small animation/details could
be good here."

Answers given, after the mockup:

- **Settings while it runs: hold every setting until the run ends.** Decaid's
  own steam screen changes the steam time (+10 s) and flow while steaming;
  the owner kept CafAI's rule instead (D114: never write a drink setting
  while anything runs). The steppers show on the view, held, and come alive
  the moment the run ends.
- **When it is done: stay on the view, with a Go back button.** No automatic
  return.

## 2. What changes

- **Three new views**, one per drink: Steam (`#/steam`), Hot water
  (`#/hot-water`) and Flush (`#/flush`). Each takes the main pane, over the
  coach kept mounted, as the Shot view does.
- **The switch**: when the machine starts steaming, pouring hot water or
  flushing, from CafAI's top bar, the group head or Decaid, the main pane
  switches to that drink's view by itself, as a starting shot switches to the
  Shot view.
- **The dial**: a ring that fills toward what stops the drink (the steam
  time, the hot water volume, the flush time), the number inside it, and a
  small scene that moves only while the machine runs.
- **Readouts and a trace** of what the machine reports for that drink.
- **The drink's settings**: the very steppers of Settings > Steam, hot water
  and flush, for that one drink.
- **Go back** once nothing runs, to the screen the view took over.
- **The mock** runs each drink for its real time or volume, with readings
  shaped like a DE1's, so the views can be seen and tested.

Stop does not move: it stays in the top bar, in the place of the start that
runs (D90). Nothing else in the shell changes place.

## 3. The rules

| Thing | Rule |
|---|---|
| Which states | Steam's view: machine states `steam` and `steamRinse` (Stop already sits in Steam's place for both). Hot water's: `hotWater`. Flush's: `flush`. `airPurge`, cleaning and descaling have no view. |
| A run | Starts at the first machine frame in one of a drink's states, from any source; ends at the first frame in any other state, or when the machine disconnects. A run of another drink, or of the same drink again, starts a new run. |
| The switch | On a run's start the main pane switches to its view with `location.replace` (Back goes where the barista went), followed by the 350 ms tap guard on the main pane (never the top bar), as for a shot (D85). Not while a field that takes typed text has focus (the shot focus's "typing" test), and not when the view is already on screen. |
| No return | The view stays after the run ends. Nothing switches back by itself. |
| Go back | A tonal button with a back arrow and "Go back", at the end of the view's header, shown whenever nothing runs (the run is over, or the view was opened with no run). Hidden while the drink runs, so a wet thumb aiming for Stop in the top bar cannot land on it. It returns, with `location.replace`, to the screen the view took over: the last route that was not a drink view when the switch happened (Coach, Shot, History or Settings, with History's bag). With none (a reload on `#/steam`, a hand-typed link), the coach. Its accessible name says where ("Go back to the coach", "Go back to Settings"). |
| Navigation | The views are not places: no nav item and no tab is current on them. The barista can leave by the nav at any time; a run keeps running. |
| Shots | A shot starting while a drink view is up switches to the Shot view, as today. Each focus takes the other's switch for the barista's own move: the shot focus does not go back to the coach after a drink view took over, and nothing here reacts to the Shot view's switch. |
| Phases | Said in words in the header, after the drink's name: Steam "Heating" (`preparingForShot`), "Steaming" (anything else while `steam`, `pouring` on a real DE1, `idle` from Decaid's simulator), "Paused" (`pausedSteam`), "Purging" (`puffing`), "Rinsing the wand" (`steamRinse`); Hot water "Heating", "Pouring"; Flush "Heating", "Flushing"; every drink "Done" once the run ends (success colour, with a check); "Not connected" when the machine went away mid-run. A polite live region. The 9 px live dot pulses before the icon while the drink runs. |
| Stop | Unchanged: in the top bar, in the running start's place. The view has no Stop of its own. |
| Settings | The drink's fields, as Settings > Steam, hot water and flush has them (`drinkSettings.ts` specs, D124 order), with the same reading, writing, clamping, "Saving…", failure and "Off in Decaid" rules. Held while anything runs or no machine is connected, with the reason on the card's line: "Change these once it stops: the machine is using them now." / "Connect the DE1 to change these." / "Reading Decaid's drink settings…"; otherwise "Changes go to Decaid at once." Changing a field is the barista's own choice, and the next start in the top bar uses it. |
| Visiting with no run | The view shows the last run of that drink in this session (the app's memory only), or none: the dial's track with a dash, the readouts live, the settings working, Go back. |

## 4. What each view shows

Targets come from the machine's own live settings when Decaid has sent them
(`ws/v1/machine/shotSettings`: `targetSteamDuration`, `targetSteamTemp`,
`targetHotWaterVolume`, `targetHotWaterDuration`), and from Decaid's workflow
otherwise (`steamSettings`, `hotWaterData`, `rinseData`; the flush has no
live setting). A target nobody gave is not drawn: the dial shows its number
without "of" and no arc, never a made-up target.

The **time** of a run starts at its first frame that is not `preparingForShot`
(the heater still warming), counted in the machine's own frame timestamps, as
the shot timer is; it stops at the run's last frame. The **water** of a hot
water or a flush is the machine's flow summed over the frames (each step
`(flow₁ + flow₂) / 2 × Δt`, only while not heating).

| | Dial: number, "of" | Readouts while it runs | When it is done |
|---|---|---|---|
| Steam | time in tenths, "of 50 s" (steam time) | **Steam** (°C, whole degrees, the heater; "set 150" under it), **Pressure** (bar), **Flow** (ml/s; "set 0.8") | time, "of 50 s"; Steam at the end, Pressure and Flow averaged over the steaming ("average") |
| Hot water | water in whole ml, "of 200 ml" (volume) | **Flow** (ml/s; "set 10.0"), **Scale** (g, the scale as it reads; "in the cup", or a dash and "No scale"), **Time** (s; "stops by 30 s", the time limit) | water, "in 38.6 s"; Flow averaged, Scale at the end, Time |
| Flush | time in tenths, "of 10 s" (flush time) | **Water** (whole ml, "so far"), **Flow** (ml/s; "set 6.0"), **Group** (°C; "target 93.0") | time, "of 10 s"; Water ("through the group"), Flow averaged, Group at the end |

- **No live temperature for hot water**: during hot water the snapshot's
  `mixTemperature` is not the water's (Decaid's spec says so), and CafAI does
  not show a number it knows to be wrong. The temperature set is on the
  settings card.
- **The scale during hot water** reads what is on it. Decaid tares it when
  the water starts if its stop at weight is on; CafAI does not tare it.
- A reading the machine has not given is a dash; one decimal for live
  readings, whole numbers for steam temperature and water (DESIGN.md, Numbers).

**The trace** under the readouts is the run so far, drawn from the same
frames: Steam's pressure (green) and flow (blue); Hot water's flow (blue)
and, with a scale, the weight (the weight colour) scaled to the volume set;
Flush's flow (blue). Three grid lines, no y labels (the readouts carry the
values), "0 s" and the right edge's time under it. Time runs from 0 to the
larger of the time set (steam, flush), the time limit (hot water) and the
run's own time. Flow and pressure share one axis from 0 to the larger of 3
(steam) or 10 (water) and the run's highest reading. A small hollow tip marks
each series' newest point while it runs.

## 5. The dial

An SVG in a 272 box (212 on an upright phone, 184 on a phone on its side),
scaled from one drawing:

- **Ticks**: 60 around the outside like a watch's bezel, every fifth longer;
  `graph.grid`, the longer ones `line`.
- **Track**: a 10 px ring in `raised`.
- **Arc**: the same ring filled to the run's share of its target, from the
  top, clockwise, with round caps, and a round tip (8 px, ringed in the
  background colour) at its end. Ink for steam (steam is white), `graph.flow`
  for the two water drinks. Between frames the arc eases over 250 ms linear,
  so it travels rather than jumps; at once under reduced motion.
- **The number** in the middle: `display` (46 px; 34 px and 32 px on the
  phones), tabular, the unit at half size in ink-muted; under it the "of"
  line in `label`, ink-muted. Done: a 28 px check in the success colour above
  the number, entering with a 6 px rise over 200 ms.
- **The scene**, clipped to the inside of the ring, drawn behind the number
  and faded out across the number's band (a mask), so no line ever crosses
  the figures:
  - Steam: a pool of milk at the bottom (`milkWash`, its surface a gentle
    wave in ink-muted), rising from 15% to 100% of its room with the time,
    and three wisps of steam (3 px, ink-muted) rising from it, 3.6 s each, 1.2 s
    apart.
  - Hot water: the water itself (`waterWash`, its surface a wave in
    `graph.flow`), its level the share of the volume, and a stream
    (`graph.flow`, 4 px, dashed) falling from the top to the surface.
  - Flush: the shower screen (a 5 px bar, ink-muted) and five thin streams
    (`graph.flow`, 2 px, dashed) falling from it.
  - The waves slide one wavelength in 4.2 s (2.2 s for the milk); the
    streams fall 24 px in 0.6 to 0.8 s. All linear and looping.
- **Still**: under `prefers-reduced-motion: reduce` every loop stops (the
  wisps are hidden), and the arc, the level and the numbers still change,
  because they are the readings. The loops also stop the moment the run
  ends, so a finished view holds still.

Palette: two new tinted roles, built like the others in `buildPalette` and
checked by `palette.test.ts` in every tint, at every hue, in both modes:
`waterWash` (`graph.flow` at 22% over the background in dark, 16% in light)
and `milkWash` (ink at 9% over the background). Pairs: ink on both at 7:1,
ink-muted on both at 4.5:1 (the number and its "of" line sit over them).

## 6. Layout

The view lays itself out for its own box (`useOwnLayout`), as the Shot view
does, with the Shot view's thresholds:

- **Wide** (a tablet): at most 960 px wide, centred, 20 px sides, 14 px top
  and bottom, 10 px gaps. The header (40 px); then the dial at the left and,
  32 px beside it, the readouts in a row of three over the trace (104 px);
  then the settings card across the whole width, its fields side by side
  (label over stepper, three or four columns).
- **Narrow** (under 600 px wide: an upright phone): 16 px sides, one column:
  the header, the dial centred, the readouts in a row of three (24 px
  values), the trace (64 px), the settings card with one row per setting
  (label, stepper 184 px at the end), scrolling inside the view.
- **Short** (under 440 px tall: a phone on its side; short wins): the dial
  at the left, and beside it the header, the readouts and the settings card
  (rows), scrolling inside that column; no trace.

Should the wide layout not fit (an alert under the top bar on the smallest
tablet), the view scrolls rather than squeeze the dial under 200 px.

The header: the live dot while it runs, the drink's icon (the machine row's,
24 px, ink-muted), its name (`subtitle` at 700), " · " and the phase
(body-small at 550, ink-muted; "Done" in the success colour after a check);
Go back at the end. The readouts are the Shot view's: a `label` with the
series swatch (12x3) where the series is traced, the value in
`readout-large` (30 px; 24 px on the phones), the caption line under it,
kept even when empty.

## 7. Under the hood

- **`src/ui/drinks/drinkTrace.ts`**, the app's one recording of drinks, as
  `shotTrace.ts` is for shots (created by the shell, found by every view):
  it follows `telemetry.subscribe`, keeps every new machine frame of a run
  in column arrays (time, flow, pressure, steam temperature, group
  temperature, scale weight) with the run's time and water, and tells its
  listeners per frame (`onData`) and on a phase change (`subscribe`:
  `empty`, `live`, `done`, with the drink and the run's id). Samples never
  touch React state; the dial and the trace write their nodes directly. The
  last run of each drink is kept for the session.
- **`src/ui/drinks/drinkFocus.ts`** (pure reducer) and
  **`useDrinkFocus.ts`** (its wiring), as `shotFocus.ts` and
  `useShotFocus.ts`: a run's start switches unless typing or already there,
  and remembers the screen it took over; Go back carries it out.
- **`src/ui/drinks/DrinkView.tsx`**, **`DrinkDial.tsx`** (the ring and its
  scenes), **`DrinkTrace.tsx`** and **`drinkModel.ts`** (pure: phases in
  words, targets, readouts and their captions, done summaries).
- **The settings card** shares its code with Settings > Steam, hot water and
  flush: the stepper and a drink's group move out of
  `DrinkSettingsSection.tsx` into `src/ui/settings/DrinkFields.tsx`, and its
  reading and writing into `useDrinkPresets.ts`. The stepper takes its
  arrangement from its parent (rows or columns) rather than the window,
  because the view's card is laid out for its own width. Settings looks and
  behaves as it does today.
- **Routes**: `{ name: 'drink', drink: 'steam' | 'hotWater' | 'flush' }`,
  `#/steam`, `#/hot-water`, `#/flush`.
- **The shell** draws the drink view over the coach for those routes, as it
  draws the Shot view for `#/shot`, and guards the main pane for whichever
  focus switched last.

## 8. The mock

`mock/decaid/shotPlayer.ts` runs steam, hot water and flush as a DE1 would,
at the player's speed (frames 200 ms of data time apart):

- **Steam**: two `preparingForShot` frames, then `pouring` until the steam
  time set, then three `puffing` frames (the purge), then idle. Flow at the
  flow set with a small wobble, pressure about 1.6 to 2.2 bar, the steam
  temperature sagging a few degrees from the temperature set and recovering.
- **Hot water**: two `preparingForShot` frames, then `pouring`: the flow
  rises to the flow set (at most 8 ml/s, as now) over about a second, until
  the water summed reaches the volume set or the time limit passes. With a
  scale, the scale is tared at the start and weighs the water poured.
- **Flush**: one `preparingForShot` frame, then `pouring` at the flow set for
  the flush time, the group temperature closing on its target.
- Stop (`idle`) ends any of them on the next frame, as now. The other
  activities (steam rinse, cleaning, descaling, air purge) keep their short
  generic run.

## 9. Testing

- Unit: the reducer (switch, typing, already there, the screen taken over,
  Go back, a shot's switch), the recording (runs, phases, time from the first
  non-heating frame, water summed, disconnects, a new run, the last run per
  drink), the model (phases, targets from shotSettings or the workflow,
  captions, summaries, dashes), the router, the palette's new pairs.
- Components: the view per drink and per arrangement (wide, narrow, short),
  the settings held while running and live after, Go back's name and
  target, the dial's still state under reduced motion.
- The mock: each drink lasts its set time or volume and ends in idle; Stop
  ends it.
- End to end (`e2e/drink-views.spec.ts`, tablet and phone): Steam from the
  row switches to the steam view with Stop in Steam's place, the steppers
  held, then live and writing after the run, Go back to where it was; a run
  started on the machine switches too; no switch while typing in the chat;
  hot water's water count and flush's time. Existing specs that start a
  drink follow the new view where they need to.

## 10. Out of scope

- Changing a run while it runs (Decaid's +10 s and live steam flow): the
  owner chose to hold the settings (section 1).
- A way back to a drink's view from elsewhere while it runs (a strip like
  the phone's live shot strip).
- Reading Decaid's stop-at-weight setting to count hot water by the scale.
- Decaid's steam records (`/api/v1/steams`) and a history of drinks.

# Drink scenes, and going back by itself: design

Date: 2026-10-22. Status: approved (the owner's answers in section 1).
Mockup: [2026-10-22-drink-scenes.mockup.html](2026-10-22-drink-scenes.mockup.html)
(open it in a browser: one made-up run per drink plays in every dial, with
Play, a scrubber, Machine: Weak / As set / Strong and Reduced motion).
Builds on the drink views
([2026-10-13-drink-views-design.md](2026-10-13-drink-views-design.md),
DECISIONS.md D146-D150, D156).

## 1. The owner's ask

"I want to update our steaming animation. Can we make it look better than it
is now? Maybe have the colors change based on the numbers we get back too?
maybe look at latte art kinda thing, or more of a nozzle->spray. Also, for
these settings (pour, rinse, steam), have a setting to have it auto-go-back
after some time and let the user turn it off/on and specify time."

Shown the first draft of the mockup (three steam scenes: Wand and spray,
Whirlpool, Rosetta; one shared switch), the owner answered:

- **Scenes**: "Let's have options and let the user change it in the
  settings. Same with the other animations." Every scene is a choice, per
  drink, in Settings; hot water and flush get new scenes of their own.
- **What the numbers drive**: all three offered: the steam time warms the
  milk and the ring; flow and pressure set how hard it sprays and how fast
  the milk moves; the heater against its set sets how much steam rises.
- **Hot water and flush**: "Give all three the new treatment."
- **Going back by itself**: per drink, its own switch and time; **on, after
  10 s**, out of the box.

This changes D146 ("There is no return of its own"), at the owner's ask: the
view still stays when the drink's switch is off.

## 2. What changes

- **The dial's scene** is drawn on a canvas inside the ring by one of several
  scenes per drink, the barista's choice:
  - Steam: **Wand and spray** (the default), **Whirlpool**, **Rosetta**,
    **Simple**.
  - Hot water: **Pour** (the default), **From above**, **Simple**.
  - Flush: **Shower** (the default), **Screen**, **Simple**.
  Simple is today's scene for that drink (D149), redrawn on the canvas.
- **Colour follows the numbers.** Each drink has a warmth, cold (0) to warm
  (1), which colours its scene and the ring's arc and tip (no longer ink for
  steam and the flow's blue for water, D149).
- **Settings > Drink screens**, a new section after Steam, hot water and
  flush: per drink its Animation, Go back by itself and After.
- **Going back by itself**: once a drink is done, its view counts down on Go
  back and returns, unless the barista keeps it.
- **The done check** sits above the figures without moving them (it pushed
  them down 17 px; with the milk now drawn under the figures' line, they
  would have met).

Nothing else on the view moves: the header, readouts, trace and settings card
keep their places and rules (D146-D148).

## 3. The numbers

Each frame the dial reads one `SceneInput` from the run (`drinkTrace.ts`), its
newest machine frame, the target and the drink's settings. A pure function
(`scenes/sceneInput.ts`), tested on its own:

| | Steam | Hot water | Flush |
|---|---|---|---|
| **phase** | heating (`preparingForShot`), working, paused (`pausedSteam`), purging (`puffing`), rinsing (`steamRinse`); done; lost | heating, working; done; lost | heating, working; done; lost |
| **progress**, 0-1 | the dial's share (time over the steam time) | the dial's share (water over the volume) | the dial's share (time over the flush time) |
| **strength**, 0-2.2 | (flow / flow set) × (pressure / 1.8), while working | flow / flow set, while working | flow / flow set, while working |
| **heat**, 0-1.15 | heater (`steamTemperature`) against its set: (T − (set − 30)) / 30, at least 0.2 | the temperature set: (set − 40) / 55, 0-1 | the group against its target: (T − (target − 20)) / 20, 0-1 |
| **warmth**, 0-1 | progress (the milk warms with its time) | heat (the temperature set) | heat (the group against its target) |

- Without a target the dial has no share (D148); progress is then the run's
  time over a typical one (steam 45 s, hot water 30 s, flush 10 s), capped at
  1, so the milk still warms and the water still rises.
- A flow set nobody gave counts as Decaid's defaults (steam 0.8, hot water
  10, flush 6 ml/s); a temperature set nobody gave as steam 150 °C, hot water
  85 °C, the group 93 °C. A reading the machine did not send (null) counts as
  the set one, so a missing number never jolts a scene.
- Hot water has no live temperature (D148): its warmth is the temperature
  set, constant through a run. That is still the drink's number: tea water at
  70 °C draws bluer than an americano's at 92 °C.
- Strength and heat are smoothed in each scene (about 0.2 to 0.6 s), so the
  steam's sawtooth (the trace shows it) moves the scene without flicker.

## 4. The scenes

Every scene is drawn in the dial's 272 box, clipped to the inside of the ring
(radius 99), and follows these rules:

- **The figures never have a line through them.** Anything that moves, and
  any line, is cut out behind the figures with a soft edge: an ellipse round
  the number and its "of" line (centre 136, 138; radii 84 by 50, fading out
  over the next 40%), and once done a circle round the check (centre 136, 75,
  radius 20, fading over 70%). Fills that sit under the figures keep the
  contrast the figures need (ink 7:1, ink-muted 4.5:1), tested in
  `palette.test.ts`. Steam and vapour may pass behind the figures at no more
  than 10% of their strength.
- **Moving only while the machine works.** The loop runs while the drink runs
  and while a scene settles after it (a whirlpool coasting to a stop, a
  rosetta's pull-through, drops still falling: at most 3 s), then stops.
- **Reduced motion**: no loop. The scene is drawn still, once per new reading,
  so the level, the leaves and the colours still follow the run, because they
  are readings (D149).

Steam:

- **Wand and spray** (the default; side view). The pitcher from the side: the
  wand dips in from the right, its tip just under the milk at first (the
  stretch) and deeper as the milk grows. Steam jets from the tip, its spray
  and the milk's roll as strong as the strength; microfoam bubbles circle with
  the roll, big early and finer as it textures; pops at the surface while it
  stretches. Steam rises round the wand (with strength × heat) and, as the
  milk gets hot, off the whole surface (with progress). The milk warms from a
  cold blue-white to cream and grows 13 units, fastest early. Purging: a puff
  from the tip. Done: the milk settles, glossy.
- **Whirlpool** (from above). Looking into the pitcher: the milk turns, foam
  spiralling in from the rim, as fast as the strength; the tip off centre,
  where a barista holds it, churning while it steams; specks big early, finer
  later. The milk (under the figures) warms within the contrast the figures
  need. Done: it coasts to a stop and goes glossy.
- **Rosetta** (latte art; the cup from above). Crema, and a rosetta pouring
  in: twelve leaves, one per twelfth of the progress, the newest wiggling in
  as the pitcher does; done, the pull-through draws its stem. The milk's
  white warms with progress. Flow and pressure do not show (nothing in a cup
  follows them). In dark mode the figures carry a halo of the crema colour
  (a text shadow), so they read on the white leaves.
- **Simple**: today's milk and three wisps (D149), as they were; the ring
  takes the warmth.

Hot water:

- **Pour** (the default; side view). A steel spout at the top; a stream falls
  from it (behind the figures, cut out there) into water rising toward the
  volume. The stream's width and speed follow the strength; so do the splash
  and the rings it sends across the surface, and the bubbles it carries down.
  Vapour rises off the water with heat, and keeps rising a while after it is
  done. The water's colour follows warmth: bluer when set cool, warmer when
  set hot.
- **From above.** The cup from above: rings spread from where the stream
  lands (off centre, above and right of the figures), as often as the
  strength; the water deepens with progress (within the figures' contrast);
  vapour drifts over it with heat.
- **Simple**: today's stream and filling water.

Flush:

- **Shower** (the default; side view). The group head and its shower screen
  at the top, thirteen streams falling to the drip tray's grate (cut out
  behind the figures) and splashing there; their speed and the splash follow
  the strength. Their colour, and the ring's, follow the group against its
  target: blue while it is cool, warm as it reaches the target, which is what
  a flush before a shot is for.
- **Screen** (from below). The shower screen from below, its holes in seven
  rings; drops swell out of them and fall toward the barista, as many as the
  strength, coloured as in Shower. The steel under the figures keeps their
  contrast; the holes and drops are cut out there.
- **Simple**: today's screen and streaks.

## 5. Colour

New palette roles, `palette.scene` (built in `buildPalette`, exposed on the
theme as `palette.cafai.scene`), per mode and the same in every tint, as the
graph's colours are (DESIGN.md, The Graph Keeps Its Colours Rule): the values
are the mockup's.

- **The warmth ramp**: `warmCold` and `warmHot`, the arc's and its tip's two
  ends, mixed in OKLab. Dark: a pale blue-white to a pale amber; light: a
  slate blue to an orange (not Crema's brown accent). Both ends and the middle
  at least 3:1 on the background in every tint (the arc is a reading's
  graphic, WCAG 1.4.11).
- **The scenes' own**: milk (cold and warm), foam, steam, steel (body, light,
  dark, hole), the whirlpool's milk and trough, crema (body, rim, light), the
  rosetta's milk (cold and warm), water (cold, warm, and their lines), the
  cup from above (shallow, deep, rings), the flush's water (cold, warm), the
  shower screen (steel, bevel, hole).
- **Pairs the contrast sweep checks** (all tints, both modes): ink 7:1 and
  ink-muted 4.5:1 on every fill that sits under the figures (the whirlpool's
  milk cold, warm and between; the cup from above shallow, deep and between;
  the screen's steel; in light mode the rosetta's milk and crema; in dark mode
  the crema, which the halo puts behind the figures); the warmth ramp 3:1 on
  the background.

DESIGN.md's rule "the only gradients are the hue rail and the Custom swatch"
gains one: inside a drink's dial, soft fades draw steam, vapour, a surface's
gloss and a pitcher's rim, because those have no edge.

## 6. Settings > Drink screens

`src/ui/settings/DrinkScreensSection.tsx`, after Steam, hot water and flush:
those are Decaid's (held while the machine runs, written to Decaid), these
are CafAI's (kept on this device, live whatever the machine does).

- **Title** "Drink screens"; under it, body-small ink-muted: "What each
  drink's screen shows while it runs, and whether it goes back by itself once
  it's done. Kept on this device."
- **Groups**: one per drink, as the section above draws them (the machine
  row's icon and the name, a group named by its heading; side by side from
  600 px, stacked on a phone, where each setting is one row with its control
  at the end).
- **Animation**: a native select, 48 px, the drink's scenes by name, the
  default first.
- **Go back by itself**: a switch in a 48 px row (the label toggles it too),
  as Sleep when idle's.
- **After**, while it is on: the drinks' stepper (`DrinkField`), 5 to 60 s, 5
  a tap, any whole second typed, spoken "seconds". Off, in its place:
  "The screen stays until you tap Go back." (body-small, ink-muted).
- Each change applies at once and is saved with CafAI's settings, as the
  temperature unit is (D172); a failed save says "Could not save the drink
  screens: …" in an error Alert, the change kept on screen for the session.

Stored as `Settings.drinkScreens`: per drink, `scene`, `goBack` and
`goBackSeconds`, each absent until chosen on this device and read as the
default (the default scene, on, 10 s). A scene this build does not know reads
as the default; seconds are whole and kept within 5-60. An edit changes one
field of one drink (as care's block, D187); an import or a restore fills the
block only on a device that never chose (as care's, whole). Exported with the
other settings.

## 7. Going back by itself

`src/ui/drinks/drinkReturn.ts` (a pure reducer, tested) and
`useDrinkReturn.ts`, used by `DrinkView.tsx`.

- **When**: a drink's run ends with the machine's word (Done, not Connection
  lost) while its view is on screen and saw the run live, and that drink's Go
  back by itself is on. A view opened later on a finished run never counts.
- **The countdown**: Go back shows the seconds left after its label ("8 s",
  tabular, ink-muted, 2.6em wide so the button keeps its width) and a fill in
  the accent's wash behind it draining from right to left, linear, over the
  time set. **Stay** (a text button in the accent, "Stay on this screen" to a
  screen reader) sits before it while it counts.
- **It stops for this run**, Go back staying as today, on: Stay; any pointer
  down or key press inside the view (a stepper, a scroll); the run's drink
  starting again; another drink or a shot taking the screen (the view goes);
  the barista leaving by the nav. At zero, with a field that takes text
  focused, it stops too, rather than pull the screen from under a keyboard.
- **At zero**: what Go back does (D146): `location.replace` to the screen the
  view took over, or the coach, then the 350 ms tap guard over the main pane,
  as every automatic swap (DESIGN.md, Motion).
- **Words**: as the countdown starts, the phase's status says once "Done.
  Going back to the coach in 10 seconds." (named for where Go back goes,
  `goBackLabel`); never a second-by-second announcement. Go back's name stays
  "Go back to the coach".
- **Reduced motion**: the fill does not drain; the seconds still count.
- Off: today's behaviour, the view stays with Go back.

## 8. The dial, built

- `DrinkDial.tsx` keeps the ticks, track, arc and tip in SVG and the figures
  in HTML; the scene is `SceneCanvas.tsx`, a canvas under the SVG, the whole
  dial's size, its backing store at up to twice the device's pixel ratio.
- Frames never re-render React (as D148/D149): the canvas reads the newest
  input from the run each frame; React hears of a new run, its end, the scene
  or the size changing.
- The arc's and tip's colour is set with the arc each frame, from warmth.
- One scene instance per run (a new run starts a fresh scene); a change of
  scene in Settings shows on the next frame.
- The loop pauses while the document is hidden; a frame's time step is
  clamped to 0-50 ms (a frame stamped before the loop began must not run the
  scene backwards).
- No canvas API newer than Chromium 91 (no `roundRect`, no `filter` per
  frame); the cut-out masks are drawn once per size with radial gradients.
- Without a 2D context (jsdom), nothing is drawn and no loop runs.
- `data-scene` on the dial names the scene, for tests.

## 9. Testing

- Unit: `sceneInput` (each drink's numbers, nulls, no target, phases);
  the catalog (ids, names, defaults, unknown ids); each scene against a stub
  context (updates and draws through a whole run without throwing, particles
  bounded, still frames); the palette pairs; storage (normalise, patch,
  merge, export and import); the drink screens store; `drinkReturn` (start,
  each way it stops, expiry, lost runs); `DrinkView` (the countdown, Stay, a
  tap, expiry calling Go back once); the section (select, switch, stepper,
  a failed save).
- e2e (`drink-views.spec.ts`): a steam ends, counts down and returns to the
  coach, the tap guard after; Stay keeps the view; Settings > Drink screens
  picks Whirlpool and the next steam's dial says so; a drink with its switch
  off stays.
- The existing drink e2e still pass: each acts within a few seconds of the
  end, and a tap on the view keeps it.

## 10. Out of scope

- A milk thermometer or a milk-volume setting (the milk's warmth is its time,
  not a temperature).
- Choosing a scene from the drink's own view.
- Sound.

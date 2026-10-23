# CafAI roadmap

Things the owner wants next that are not built yet. Each item says why, the
shape of the work, and what has to be checked first. Decisions that put an
item here are in [DECISIONS.md](../DECISIONS.md).

## Machine care (D151)

CafAI cannot start the DE1's cleaning, descaling or transport cycles: its
commands stop at espresso, steam, hot water, flush, sleep and the next step
(`src/api/types.ts`), though D97 gives the three cycles Stop when something
else starts them. Decaid's own screens have none of them, so today an owner
switches to streamline to descale. No skin for Decaid keeps reminders, and
until CafAI's guide none showed how to clean; Decent's video and docs do.
Three items: the guide and the reminders are built, and the cycles, the
second, wait (D161):

- **A cleaning guide, with Decent's video: built on 2026-10-15** (D152-D155,
  `docs/superpowers/specs/2026-10-15-machine-care-design.md`). Settings >
  Machine care opens the Care screen: Daily, Weekly, Monthly and As needed,
  one at a time, each step with a line on how and its moment in Decent's
  "How often/to clean DE1"; where the 2022 video and Decent's current pages
  differ, the step follows the pages and says so. YouTube accepts Decaid's
  user agent (`Decent`), even in Chromium 91, but Decaid for Windows sent
  the player to the system browser instead of framing it, so the player
  plays in place only in a browser and on Android, and is a link to the
  moment elsewhere in Decaid. Left: the check on a Decent tablet and an
  iPad (`docs/HARDWARE_TEST_PLAN.md` section 14).
- **Clean, Descale and Transport from CafAI: put off on 2026-10-15**
  (D161). Not built, and nothing in CafAI starts a cycle; the guide's
  steps send the barista to streamline. What follows is kept for when it
  comes back. Decaid takes
  `PUT /api/v1/machine/state/cleaning`, `descaling` and `airPurge`, and
  streamline's pages are the model
  (`.ref/streamline-js/src/settings/categories/maintenance.js`,
  `src/modules/maintenance-progress.js`): wake a sleeping machine first;
  Clean asks for a blind basket and shows Starting, Filling, Soak and
  Flush; Descale turns the steam heater off, waits for the steam boiler to
  cool to 60 °C (up to an hour, Decent says), shows Starting, Descaling and
  Steam, and turns the heater back on however it ends; Transport drains the
  machine into the tank. A cycle started on the machine shows too, and
  done is only "seen, then gone": the firmware sends no end. The guide's
  weekly clean with detergent is a profile, not a cycle (its daily flush is
  Flush, which the quick start allows): Decent's
  "Cleaning/Forward Flush x5", which Decaid ships
  (`assets/defaultProfiles/Cleaning__Forward_Flush_x5_2.json`). CafAI
  would load it, run it over the blind basket and put the bag's version
  back, as DSx's Backflush plugin does, without counting it as a shot of
  the bag or calling it the wrong profile (README, How the coach works).
  Check first, on a real DE1: what the substates do (Decaid folds the
  fill, the flush and most of a descale into one, `cleaningGroup`), how
  long each cycle runs, and whether Decaid saves the flush as a shot, which
  would put it in its shot list and on Visualizer.
- **Care reminders, set by the water: built on 2026-10-15** (D183-D191,
  `docs/superpowers/specs/2026-10-15-care-reminders-design.md`).
  Every step beyond Daily has its last time and **Mark done** on the Care
  screen, with Undo; five of them remind (the weekly clean, Rinza, the
  intake filter, the group head's soak, the descale), and the stats card
  carries one quiet line for the most overdue: "Weekly clean due: 41 shots
  since the last". Days decide; shots and steams gate and count; litres are
  not counted, as Decaid keeps no record of a flush or of hot water
  (D184). The counts are Decaid's totals, one request each, since
  Decaid never saves a cleaning profile's run as a shot and the list has
  nothing to page back to (D185). A step starts over when it is marked
  done, or when CafAI sees the machine's own Clean or Descale run for a
  minute; Forward Flush x5 never counts, being the daily water flush's
  profile too (D186). Settings > Machine care asks the water in
  Decent's TDS bands and the filter, V1 or V2 (D187). A step long
  overdue stays on the stats card: the alert under the top bar is for
  problems of the moment (D188). Left: a cycle seen on a real DE1 and
  Forward Flush x5 left out of Decaid's shot list there
  (`docs/HARDWARE_TEST_PLAN.md`), snoozing the line, the water's LSI, and
  marks shared between devices, which each keep their own as they keep
  their bags (D189).

## More from the gap review (D151)

- **Overlaid shot curves: built on 2026-10-15** (D178-D182,
  `docs/superpowers/specs/2026-10-15-shot-overlay-design.md`). A shot's card
  draws the shot its question asks about faintly under its own curves: the
  previous shot, or for a bag's first shot the last shot of another coffee,
  rather than the previous version's shot, which a grind move (no new
  version) would skip. The Shot view draws the bag's previous shot under a
  shot while it pulls, and the card's once it is done. The shot under is a
  pale band in each line's own hue, wider than the line and under it, with
  a key that names it, checked in every tint and both modes. The curves
  were kept after all: each card in the chat holds its ~1 Hz series, so
  only a shot not in the chat is read from Decaid, once. Left: choosing
  another shot to compare with, the shot under in History, its weight and
  weight flow, and the band seen on a Decent tablet in daylight.
- **TDS and EY on the shot card: built on 2026-10-15** (D162-D170,
  `docs/superpowers/specs/2026-10-15-tds-ey-design.md`). Every
  shot card's numbers have a quiet TDS cell, "+ Add", that opens a field with
  the decimal keyboard (0.01-25 %, a comma read as a point); the reading
  shows as TDS and EY, the EY worked out from the card's own dose and yield
  (Decaid's `actualDoseWeight` or the workflow's dose, and its settled
  `actualYield` or the scale's last weight), so EY = TDS × ratio. Both go to
  the shot's record (`drinkTds`, `drinkEy`) through the queue the taste and
  the rating use, the card and the shot's iteration keep them, and the
  coach hears each reading with its next turn, as a verdict, so one typed
  after it proposed a change comes with Confirm or the next message; the
  prompt says what TDS and EY are and how far to trust them. A shot with no
  yield keeps its TDS without an EY. Left: a TDS from a refractometer Decaid
  connects (it lists a DiFluid R2 on main), a reading added in Visualizer
  coming back to the card, and a later reading reaching visualizer.coffee
  on a real upload (`docs/HARDWARE_TEST_PLAN.md`).
- **°F: built on 2026-10-15** (D171-D177,
  `docs/superpowers/specs/2026-10-15-fahrenheit-design.md`). Settings >
  Appearance > Temperatures turns every temperature a barista reads or sets
  into °F, the coach's words too, with Decaid, the profiles and the coach's
  tools still in °C, as streamline does. The steppers show whole °F and move
  one whole °C a tap, the step Decaid keeps, since a 1 °F step would get
  stuck and an unrounded °C comes back truncated; every value reads back as
  set (D173). The coach is told in its prompt, its temperature levers and
  their bounds worked out in °F (D175), and a °C it still writes reads in
  °F where it shows, a change without the 32 (D176). Left: a real coach
  in °F over a real dial-in, the drink temperatures on a real DE1, and
  Decaid's own words (a device error naming a temperature), which stay in
  Decaid's unit (`docs/HARDWARE_TEST_PLAN.md`).
- **Wake schedule: built on 2026-10-15** (D157-D160). Settings > Sleep and
  wake edits what Decaid keeps and acts on: Sleep when idle with its
  minutes, and the wake times, each a time, its days and how long it keeps
  the machine awake (a new one an hour), with the next wake over them, so
  "warm at 06:30 on weekdays" is set without leaving CafAI. Presence
  tracking off reads as Sleep when idle off; CafAI writes off as 0 minutes
  with Decaid's own switch left on, since Decaid wakes on its schedules
  either way but hides them on its own page while that switch is off
  (D158). Left: waking early enough to be ready at the time, from the
  time-to-ready plugin (D160), and a schedule waking a real DE1 from
  Decaid's sleep (`docs/HARDWARE_TEST_PLAN.md` section 15).

## Claude on your computer: what is left (D130-D137)

Built on 2026-10-11 (D56's item): CafAI Bridge (`bridge/`, its README)
answers the coach through the owner's own Claude Code and plan, on a Mac or
a Windows PC, and CafAI's Settings chooses where the coach runs. It runs
the `claude` command itself rather than the Agent SDK: Claude Code's legal
page sends products built on the SDK to API keys, while signing in to the
unmodified Claude Code with one's own plan is ordinary use; and the command
needs nothing installed beside Claude Code (D130). Left:

- **Re-find a computer whose address changed**, the way Crema sweeps the
  saved address's /24 (`crema/web/src/advice/discover.ts`). Today Settings
  says the bridge cannot be reached and the bridge prints its new address.
- **One file to download** for people who install CafAI from a release zip
  rather than the repository (the bridge is plain Node modules today), and
  perhaps a packaged app with a tray icon instead of a console.
- **The address in Decaid's backup**, so a reinstalled skin keeps it (the
  code would stay on the device, like the API key).
- **Installing the systemd units on Linux by itself** (setup prints the
  service and timer today; the bridge itself runs there), and waking a Mac
  for the schedule without the printed `sudo pmset` line.
- **Tried on a Mac**: the LaunchAgent, its calendar start, `caffeinate`
  and the sign-in under launchd are written from the documentation and
  unit-tested, never run.
- **A morning of dial-in on the plan**: how much of the 5-hour window a
  session of Opus 5.5 turns uses, measured on a real machine.

## Smaller items carried from MORNING.md

- Teaching mode, personas, cross-user learning, voice. (Bag photos came
  with the Decaid alignment, 2026-10-10: D120.)
- Two more screensavers: Espresso Pipes, after Windows' 3D Pipes, in
  WebGL; and Latte Art, poured by a simulation, behind a gate of its own
  (docs/superpowers/specs/2026-10-22-screensavers-design.md, D-SAVER-6).
  (The screensaver came on 2026-10-22 with six to choose from: D-SAVER-1
  to D-SAVER-5. Steam, hot water and flush settings, Connect for a dropped
  machine or scale, and the link to Decaid's bean and batch entities came
  with the Decaid alignment: D114, D111, D102.)

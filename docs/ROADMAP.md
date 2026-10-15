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
Three items, each building on the one before:

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
- **Clean, Descale and Transport from CafAI.** Decaid takes
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
- **Care reminders, set by the water.** A quiet line on the stats card
  when a step is due ("Weekly clean due: 41 shots since the last"), and
  each step's last time on the Care screen. Counts come from Decaid's shots
  (newest first; the list has no date filter, so CafAI pages back to the
  last clean) and its steam records (`/api/v1/steams`); a step starts over
  when CafAI sees its cycle end or the barista ticks it done, kept with
  CafAI's data in IndexedDB and Decaid's store. One question, the water's
  hardness, sets the descale interval from Decent's water page: below
  30 ppm never; 30-120 ppm yearly; above 120 ppm at least twice a year
  (its LSI table, keyed to the water's LSI rather than its ppm, runs from
  every 100 to every 2,250 shots); the intake filter weekly
  or fortnightly (V1, citric acid) or monthly (V2, baking soda). Models:
  de1app's Maintenance Tracker plugin (days, shots or ml, in green, amber
  and red, reset when the app's Clean or Descale runs) and GaggiMate's
  every-so-many-shots interval. Check first: whether shots and days are
  enough or litres matter too, and whether a step long overdue ever earns
  the alert under the top bar, which today is for problems only.

## More from the gap review (D151)

- **Overlaid shot curves.** A shot's card and the Shot view draw one shot,
  and "Compared with your previous shot?" is words only
  (`src/ui/chat/parts/ShotCard.tsx`). Draw the bag's previous version's
  shot faintly under this one, so the change the coach made shows on the
  curve, as Visualizer, Liquid Aqua, Crema and DSx do. CafAI keeps shot
  summaries without their curves, so both shots come from Decaid
  (`GET /api/v1/shots/{id}`). Check first: how the graph tells the two
  shots apart in every tint and both modes, by more than colour.
- **TDS and EY on the shot card.** An optional TDS field for a barista
  with a refractometer: CafAI works out EY from the TDS, the yield and the
  dose, writes both to the shot's record (`drinkTds` and `drinkEy`, already
  in Decaid's annotations, so Visualizer gets them), and gives them to the
  coach, the one measure of extraction it cannot read off the curves.
  Check first: which yield (`actualYield`) and dose (`actualDoseWeight` or
  the workflow's) the EY uses, and that a reading typed after the taste
  answer still reaches the coach.
- **°F.** CafAI writes °C everywhere (`src/ui/machine/format.ts`,
  `src/ui/settings/drinkSettings.ts`). A setting shows °F on the readouts,
  the steppers and in the coach's words ("2 °F hotter"), with Decaid and
  the profiles still in °C, as streamline does. Check first: the steppers'
  step in °F, rounding so a value read back shows what was set, and the
  coach's levers and their bounds said in °F.
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
- A screensaver. (Steam, hot water and flush settings, Connect for a
  dropped machine or scale, and the link to Decaid's bean and batch
  entities came with the Decaid alignment: D114, D111, D102.)

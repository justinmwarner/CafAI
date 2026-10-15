# CafAI roadmap

Things the owner wants next that are not built yet. Each item says why, the
shape of the work, and what has to be checked first. Decisions that put an
item here are in [DECISIONS.md](../DECISIONS.md).

## Machine care (D151)

CafAI cannot start the DE1's cleaning, descaling or transport cycles: its
commands stop at espresso, steam, hot water, flush, sleep and the next step
(`src/api/types.ts`), though D97 gives the three cycles Stop when something
else starts them. Decaid's own screens have none of them, so today an owner
switches to streamline to descale. No skin for Decaid keeps reminders or
shows how to clean; Decent's video and docs do. Three items, each building
on the one before:

- **A cleaning guide, with Decent's video** (the owner's item). A Care
  screen (where it sits in the shell is a design call) lists what to do
  daily, weekly and every two to four weeks, each step with a line on how
  and a jump to its moment in Decent's "How often/to clean DE1" (Decent
  Espresso Tech, 2022-03-07, 22:33,
  <https://www.youtube.com/watch?v=0cm1JxB_6bI>). Decent's quick start
  sends owners to it, and it may be embedded. Its moments, from its
  description (YouTube shows them as key moments, not chapters, so the
  first starts at 0:20):

  | When | Moment | Starts |
  |---|---|---|
  | Daily | Daily | 0:20 (20 s) |
  | Daily | Group head without detergent: a blind basket, Forward Flush x5 twice after the day's last shot | 1:48 (108 s) |
  | Daily | Steam tip, and washing the tank and the drip tray | 5:10 (310 s) |
  | Weekly | Weekly | 7:40 (460 s) |
  | Weekly | Group head with detergent | 7:53 (473 s) |
  | Weekly | Steam wand with Rinza | 11:11 (671 s) |
  | Weekly | Water tank and thimble (the intake filter) | 14:23 (863 s) |
  | Every 2-4 weeks | Fortnightly / Monthly | 16:36 (996 s) |
  | Every 2-4 weeks | Group head parts: the screen and two diffusers, soaked overnight | 16:56 (1016 s) |

  Where the 2022 video and Decent's current docs differ, the steps follow
  the docs and say so: descaling with 60-120 ppm water (the video: hardly
  needed; the docs: every year or two), the steam tip (the video takes it
  off every night; Decent only for a clog, holding the inner tube), Rinza
  (the video steams it; the quick start soaks it: "Do not steam!"), and the
  group head's parts (the video: every two weeks, the machine asleep; the
  quick start: monthly, the machine off; Torx screws since v1.44). What the
  video leaves out comes from the docs: the steam purge after steaming,
  wiping the shower screen, the gasket, the machine's own Clean cycle and
  Transport. The player loads only on a tap, from `youtube-nocookie.com`,
  and README's Privacy says Google is then reached; each moment is also a
  link to `watch?v=0cm1JxB_6bI&t=<s>s`, which Decaid opens in the system
  browser, and the list works offline. Check first: the player on a Decent
  tablet (Android's WebView does not ask Decaid about an iframe's http(s)
  loads, so it should play in place, but Decaid's WebView calls itself
  just `Decent`, which YouTube may refuse), on Decaid for Windows with the
  simulator, and on an iPad, where Decaid's navigation guard
  (`classifySkinNavigation` in `lib/src/skin_feature/skin_view.dart`,
  Decaid `af4e995`) would cancel the player and open YouTube outside, so
  the links are the way there.
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
  daily and weekly group flush is a profile, not a cycle: Decent's
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
  (by its LSI table, every 300 to 2,250 shots); the intake filter weekly
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
- **Wake schedule.** Decaid keeps wake schedules (a time, weekdays and a
  keep-awake window: `/api/v1/presence/schedules`) and the sleep timeout
  (`/api/v1/presence/settings`), and its own settings edit them; CafAI only
  sends the heartbeat (`src/api/heartbeat.ts`). A Settings section shows
  and edits them, so "warm at 6:30 on weekdays" is set without leaving
  CafAI (later, perhaps: waking early enough to be ready at that time, from
  the time-to-ready plugin). Check first: that a schedule wakes a real DE1
  from Decaid's sleep, and what to show when presence tracking is off (the
  heartbeat answers -1).

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

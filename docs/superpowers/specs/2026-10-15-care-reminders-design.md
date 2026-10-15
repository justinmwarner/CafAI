# Machine care, reminders set by the water: design

Date: 2026-10-15. Status: built from the roadmap item as the owner chose it
([ROADMAP.md](../../ROADMAP.md), "Machine care (D151)", the third item); no
mockup. Builds on the cleaning guide
([2026-10-15-machine-care-design.md](2026-10-15-machine-care-design.md),
D152-D156) and takes D161 as given: CafAI starts no cycle, so a step starts
over when the barista marks it done, not when CafAI runs it. The calls
below are recorded in DECISIONS.md as D-CARE-1 to D-CARE-9.

## 1. The ask

From the roadmap: "A quiet line on the stats card when a step is due
('Weekly clean due: 41 shots since the last'), and each step's last time on
the Care screen." Counts come from Decaid's shots and steam records; a step
starts over when the barista ticks it done; one question, the water's
hardness, sets the descale interval from Decent's water page; the intake
filter is weekly or fortnightly (V1) or monthly (V2). Two checks first:
whether shots and days are enough or litres matter too, and whether a step
long overdue ever earns the alert under the top bar.

## 2. What changes

- **The Care screen**: every step of Weekly, Monthly and As needed shows
  its last time and has **Mark done**; a step that is due says so, in the
  warning colour, with the shots, steams or time since. The descale and the
  intake filter say what CafAI reminds them by (the water, the filter) and
  link to Settings to change it.
- **Settings > Machine care**: under Cleaning guide, **Your water** and
  **Intake filter** (two native selects, in Decent's own words) and
  **Remind me on the stats card** (a switch, on).
- **The stats card**: one line at its foot while a step is due, the most
  overdue one: "Weekly clean due: 41 shots since the last". A tap opens its
  routine on the Care screen with the step in view.
- **Decaid's steam records**, new to CafAI: `GET /api/v1/steams/ids` and
  `GET /api/v1/steams/latest`, in the client, the readers, the mock and the
  contract checks.
- **Storage**: a `care` store in IndexedDB (version 2), mirrored to
  Decaid's store, in the export and the import; the water, the filter and
  the switch are one `care` block in Settings.

## 3. The steps

Daily's four steps are habits, done on the day: no last time, no tick, no
reminder. The other nine keep their last time and **Mark done**. Five of
them have a reminder: the dirt and scale nobody sees.

| Step | Routine | Reminder | Counts | Line on the stats card |
|---|---|---|---|---|
| Clean the group head with detergent | Weekly | 7 days, once a shot was pulled since | shots | Weekly clean due: 41 shots since the last |
| Steam Rinza through the wand | Weekly | 7 days, once the wand steamed since | steams | Rinza due: 12 steams since the last |
| Wash the water tank and drip tray | Weekly | none: in plain sight | | |
| Clean the intake filter | Weekly | V1 or not said: 14 days; V2: 30 days | time | Intake filter due: 2 weeks since the last |
| Soak the group head's parts | Monthly | 28 days, once a shot was pulled since | time | Group head soak due: 5 weeks since the last |
| Look at the group gasket | Monthly | none: looked at with the parts | | |
| Descale | As needed | by the water (below) | time or shots | Descale due: 13 months since the last |
| Unclog the steam tip | As needed | none: when it clogs | | |
| Empty the machine to move it | As needed | none: before a move | | |

**The descale, by the water.** Decent's water page gives bands of total
dissolved solids (TDS) and an LSI table keyed to the water's LSI; CafAI asks
the bands and pairs each with the shots the LSI table gives for the same
time, taking the earlier end.

| Your water | Decent's water page | CafAI reminds |
|---|---|---|
| Under 30 ppm (distilled, RO, very soft) | never descale | never |
| 30 to 120 ppm | once a year (LSI 0-0.5: a year, or 1,500 to 2,250 shots) | after a year or 1,500 shots |
| Over 120 ppm | at least twice a year (LSI 0.5: six months, or 800 to 1,200 shots) | after six months or 800 shots |
| Not sure (the default) | look up a water report, or test it | as 30 to 120 ppm, and says so |

**The intake filter**: Decent's page says V1 weekly or fortnightly with
citric acid, V2 at least monthly with baking soda, and shows which is
which. Not sure (the default) is reminded as V1, the more often of the two.

**Litres** (the roadmap's first check): not counted. Decaid keeps no record
of a flush or of hot water, CafAI sees only what runs while it is open, and
Decent's own intervals are in weeks, months and shots. Days decide; shots
and steams say whether there is anything to clean (a week without a shot
needs no detergent) and give the line its number.

## 4. Counting

- **From Decaid's totals, one request each.** Decaid never saves a run of a
  cleaning profile as a shot (`_persistShotIfNeeded`,
  de1_state_manager.dart:911-917 at aab5f93: beverage types cleaning and
  calibrate are skipped), so its shot list holds no clean to page back to.
  Each step's record keeps Decaid's shot total and steam total from its
  start; the count since is the total now less that.
  `GET /api/v1/shots?limit=1` answers the total with the newest shot (Decaid
  parses one shot's measurements; a page of 100 parses a hundred,
  shot_mapper.dart), and `GET /api/v1/steams/ids` the steams, as ids:
  `GET /api/v1/steams` would make Decaid parse every steam's measurements
  (steam_mapper.dart) and send each one's workflow. `GET /api/v1/steams/latest`
  gives the newest steam's time.
- **When the totals do not add up.** A total that fell (shots deleted,
  another Decaid) starts that step's count again from now; so does a
  newest shot (or steam) older than the step's start (old ones imported). A
  Decaid without steam records (404: older than the pin) counts Rinza by
  days alone.
- **When it counts**: at start, 5 s after a shot or a steam ends, when the
  page comes back into view and when the Care screen opens; at most once
  every 10 s, never while a shot runs. The last totals are kept on the
  device (`localStorage`, `cafai.care.counts`), so the stats card has them
  at its first paint and while Decaid is away.
- **From the first look.** A step never marked done counts from the first
  time CafAI counted it, with Decaid's totals then: a new install is never
  due at once, and the Care screen says "Not marked done yet" with that
  date.

## 5. Starting over

- **Mark done**, on the Care screen: the step's last time is now, with
  Decaid's totals read then (the last known ones when Decaid does not
  answer in 3 s). **Undo** puts the record before it back, until the page
  reloads: a mistaken tap on the descale would otherwise silence it for a
  year.
- **Seen, then gone.** A `cleaning` or `descaling` state CafAI sees for at
  least a minute (streamline's Clean or Descale, or one started on the
  machine, while CafAI is open), then any other state, marks the weekly
  clean or the descale done at the last frame seen running: the firmware
  sends no end (streamline's maintenance-progress.js says the same). A
  shorter run (stopped at once) does not count; a socket gone quiet ends
  nothing. Undo works for these too.
- **Forward Flush x5 does not count**, in the list or live: Decaid never
  saves it as a shot, and Decent's quick start uses the same profile for the
  daily flush with water only, so its run says nothing about detergent.

## 6. Due, and the line

- A step is due once its days (or the descale's shots) have passed and its
  gate holds (a shot, or a steam, since; unknown counts let the days decide).
  How overdue: the share of its interval that has passed, the larger of days
  and shots; the line names the most overdue, ties in the guide's order.
- **The line**: at the stats card's foot, under a line, only while a step is
  due and the switch is on: a 20 px cleaning icon in ink-muted, the words in
  body-small ink ("Weekly clean due: 41 shots since the last"; "since 3 Oct"
  while it was never marked; "13 months" or "2 weeks" for time), a chevron.
  One link, 48 px tall, to the step's routine (`#/care/weekly`), which
  brings the step into view.
- **Not the alert** (the roadmap's second check). The alert under the top
  bar is for what stops the machine working now or one tap fixes; a clean
  that waits days is neither, and on every screen, the Shot view's too, it
  would teach the barista to look past the alert. A step long overdue stays
  on the stats card's line and the Care screen.

## 7. Settings > Machine care

| Field | Choices | Helper |
|---|---|---|
| Your water | Not sure, Under 30 ppm (distilled, RO, very soft), 30 to 120 ppm, Over 120 ppm | Its total dissolved solids (TDS), from a TDS meter or your water report. Decent: under 30 ppm, never descale; up to 120 ppm, once a year; over 120 ppm, at least twice a year. |
| Intake filter | Not sure, V1 (citric acid), V2 (baking soda) | The filter at the tank's intake; Decent's page shows which one you have. V1 every week or two, V2 at least once a month. |
| Remind me on the stats card | on, off | A line on the stats card when the weekly clean, Rinza, the intake filter, the group head's soak or a descale is due. |

Each applies at once, as Appearance does. The Care screen's links to it
("Set your water", "Change it in Settings") open Settings with Machine care
brought into view.

## 8. Storage

- **IndexedDB**: `CAFAI_DB_VERSION` 2 adds the `care` store (key `id`, the
  step's id); the upgrade only adds it. A record: `id`, `doneAt` (null while
  never marked), `by` (`tick`, `seen` or null), `countFrom` (the done time,
  or the first look), `shotTotal` and `steamTotal` (Decaid's then, or null),
  `updatedAt`.
- **Decaid's store**: one more key, `care`, in namespace `cafai`.
- **Export and import**: an optional `care` list in the file, schema version
  1 still (an older CafAI drops it). A merge keeps the later `doneAt`; of two
  never marked, the earlier `countFrom`. Replace takes the file's.
- **Settings**: one `care` block, `{ water, filter, reminders }`, read
  leniently; a merge fills a blank water or filter and takes the incoming
  switch while this device's is still the default, as the look.

## 9. Under the hood

- `src/app/care/careRules.ts`: the tracked steps, their reminders by the
  settings, the counts since, the status of a step, the most overdue.
- `src/app/care/cycleWatch.ts`: seen, then gone.
- `src/app/care/careService.ts`: records, counts and marks, live; created in
  `createServices`, `Services.care` (optional, so fakes and previews leave it
  out and nothing shows).
- `src/ui/care/careWords.ts` (every sentence), `useCare.ts`,
  `CareDueLine.tsx` (the stats card's line), `StepCare.tsx` (the Care
  screen's row), `careReveal.ts` (bringing a step or Settings' section into
  view); `CareSection.tsx` gains the fields.
- API: `listSteamIds`, `getLatestSteam` (`src/api/client.ts`, readers in
  `readers.ts`); the mock records a steam as Decaid's SteamSequencer does
  (opened on entering `steam`, kept when it leaves) and, as Decaid, never
  saves a cleaning profile's run as a shot.

## 10. Testing

- Unit: the rules (every step, both gates, the water and the filter, the
  most overdue, counts that fell or were imported), the words, the cycle
  watch, the service against fake Decaid and storage (start, counts, marks,
  undo, seen cycles, an older Decaid), storage (the upgrade from version 1
  with data kept, the repository, the mirror, the export and the merge
  rule), settings normalisation and merge, the readers, the mock's steam
  routes and cleaning shots, the contract test, and the UI pieces.
- End to end (`e2e/care-reminders.spec.ts`, all five projects): a step
  marked done keeps its last time across a reload, with Undo before it; a
  week later (the page's clock moved on) with shots since, the Care screen
  says Due and the stats card's line opens the step; the water and the
  filter change what the descale and the filter steps say; the switch takes
  the line away; a step's last time comes back from Decaid's backup after
  the browser storage is lost.

## 11. Left

- Snoozing a reminder: the line stays until the step is marked done or the
  switch is off.
- The LSI itself: CafAI asks Decent's TDS bands, not the water's LSI.
- Litres, and the time-to-ready of a cycle.
- The cycles from CafAI (D161).

## Hardware test plan

A real DE1 with Decaid, CafAI open on the tablet (and a phone or a laptop
on the same network for steps 4 and 5). Put any setting back after.

1. **Counting from the first look.** A fresh CafAI (or Settings > Machine
   care untouched): open Machine care > Cleaning guide > Weekly. Expected:
   each step says "Not marked done yet", counting from today; nothing on
   the stats card.
2. **A shot counts.** Pull a shot, wait 10 s, open Weekly again. Expected:
   the detergent clean counts 1 shot since today. Record how long after the
   shot ended the count changed.
3. **A steam counts.** Steam (water in a jug is fine), wait 10 s, open
   Weekly. Expected: Rinza counts 1 steam. Record whether Decaid's
   `GET /api/v1/steams/ids` lists it (Decaid settings, or the log in
   Settings > Log).
4. **Streamline's Clean, seen.** With CafAI open on a phone, run Clean from
   streamline on the tablet (blind basket in, detergent). Expected: on the
   phone, within a minute of the cycle's end, Weekly's detergent clean says
   "Done today" with "CafAI saw the machine's Clean". Record how long the
   cycle ran and what CafAI's top bar showed meanwhile.
5. **Streamline's Descale, seen** (only when the machine is due one; it
   takes most of an hour). As 4, with Descale. Expected: the descale step
   "Done today". Record each state and substate the log shows.
6. **Forward Flush x5.** Run Decent's Cleaning/Forward Flush x5 from
   streamline with a blind basket and water only. Expected: no new shot in
   Decaid's shot list, and the detergent clean not marked done.
7. **The line.** After a week with shots and no clean (or with the tablet's
   date moved on a week), open the coach. Expected: the stats card's line
   "Weekly clean due: … shots since …", and a tap opens Weekly on that step.

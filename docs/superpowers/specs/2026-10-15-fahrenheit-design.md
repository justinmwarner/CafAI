# °F: design

Date: 2026-10-15. Status: approved as the roadmap describes it ("°F" in
[ROADMAP.md](../../ROADMAP.md), "More from the gap review (D151)"); the
calls below are recorded in DECISIONS.md as D171-D177.

## 1. The ask

From the gap review (D151): CafAI writes °C everywhere. A setting shows °F
on the readouts, the steppers and in the coach's words ("2 °F hotter"),
with Decaid and the profiles still in °C, as streamline does. Check first:
the steppers' step in °F, rounding so a value read back shows what was set,
and the coach's levers and their bounds said in °F.

streamline is the model (`.ref/streamline-js/src/modules/units.js`): a
`tempUnit` of C or F kept with its settings, "Celsius on the wire, a pure
display-layer conversion", a stepper that moves a whole degree in the unit
on show (`displayStepToCelsius`), bounds rounded to whole degrees in the
unit (`boundToDisplay`), and the steam and hot water temperatures sent as
`Math.round` of the Celsius.

## 2. What changes

- **Settings > Appearance > Temperatures**: a row after the custom hue, the
  Mode control's track with two segments, **°C Celsius** and **°F
  Fahrenheit**, and a line under it: "Readouts, settings and the coach use
  it. Decaid and your profiles keep °C." It applies at once, as the rest of
  Appearance does.
- **The readouts**: the stats card's Group ("190.5 °F", "target 192.2") and
  Steam ("298 °F"); the steam view's Steam ("306 °F", "set 302") and the
  flush view's Group ("197.2 °F", "target 199.4").
- **The steppers**: Settings > Steam, hot water and flush, and each drink's
  view, show and take the three temperatures in °F (section 4).
- **The coach**: its words, the change card ("Brew temperature: 197.6 °F →
  199.4 °F (every step +1.8 °F)"), its questions and the starting profiles'
  reasons, and History (section 5).
- **The care guide**: the descale step's "down to 60 °C" reads "down to
  140 °F".

Nothing changes for a barista who stays on °C: the default is °C, the
coach's prompt in °C is byte for byte today's, and every converter is the
identity there.

What has no temperature, and so no change: the Shot view and its graph
(pressure, flow, weight and weight flow, Decent's convention), the live
strip, the shot card, the steam view's dial (the steam's time), the Log
(raw traffic), Decaid's own words in the machine alert, and what the
barista typed.

## 3. The rules

| Thing | Rule |
|---|---|
| Where °C stays | Decaid's workflow and the DE1, the profiles and their versions, the coach's tools and proposals (lever values, the shot summary, the query tools), CafAI's records: diff lines, the chat, exports and Decaid's backup keep what was written. |
| Where °F shows | Wherever a person reads or types a temperature: the readouts, the steppers, the change card, the chat, History, the care guide, the stepper's spoken value ("302 degrees Fahrenheit"). |
| The setting | `Settings.temperatureUnit`: `'celsius'` or `'fahrenheit'`, absent until chosen on this device and read as °C (as `keepKeyInDecaid`, D99), so an import or a restore fills it only where nobody chose. Mirrored to Decaid and exported with the other settings. |
| The default | °C for everyone, existing and new. No guess from the locale (D172). |
| A temperature | °F = °C × 1.8 + 32. A readout keeps its °C precision: one decimal for the group and its target, whole degrees for steam and its setting. |
| A change | × 1.8, never the 32: 1 °C hotter is 1.8 °F hotter, 0.5 °C is 0.9 °F, 2 °C is 3.6 °F. |

## 4. The steppers

Decaid keeps the steam, hot water and flush temperatures as whole °C: each
is an `int` in Decaid's `workflow.dart`, read with `parseInt`
(`models/data/utils.dart`), which truncates a fraction (`value.toInt()`);
the pinned spec says `type: integer` for all three; and the DE1 packs steam
and hot water into a byte (drinkSettings.ts). The mock Decaid truncates the
same way (`requiredInt`, `Math.trunc`).

So in °F:

- **What shows**: the °C value in whole °F, `round(°C × 1.8 + 32)`: 150 °C
  is 302 °F.
- **A tap** (More, Less, Up, Down): one whole °C, the smallest step Decaid
  keeps. On screen that is 2 °F, or 1 °F one time in five: 275, 277, 279,
  280, 282, 284… for steam.
- **A typed °F**: the nearest whole °C, clamped into the range, and the
  field shows what Decaid keeps: 276 shows 277, 300 stays 300. A typed value
  is never more than 1 °F from what shows after.
- **The bounds**: the °C range in whole °F, which is also what a screen
  reader hears as the minimum and maximum: steam 275-320 °F (329 on a
  Bengle), hot water and flush 34-212 °F.
- **Up and Down from a typed value** step from the °C it stands for, so 300
  then Up writes 150 °C (302 °F).

Why not a step of 1 °F, or of 2 °F, as the roadmap asked to check: a step
in °F rounds back to whole °C, and the grid of whole °C is 1.8 °F apart. A
1 °F step gets stuck: from 280 °F (138 °C), 281 °F is 138.3 °C, which
rounds back to 138 °C, so More would do nothing there, every time. A 2 °F
step always moves one °C, so it is the same as stepping one °C, but it
would promise a 2 °F change and show 1 °F one time in five. Sending the
unrounded °C would not help either: Decaid truncates it (300 °F is 148.9 °C,
kept as 148 °C, read back as 298 °F).

The round trip is tested for every value of every range: each whole °C
shows a whole °F that, typed, writes the same °C; each whole °F between the
bounds writes a whole °C in range that shows within 1 °F of it; a tap from
each value moves exactly one °C; the ends hold.

## 5. The coach

**How it is told.** In °F the system prompt adds a section, "# Temperatures
in °F", after "How you talk", and that section's "Use °C" line points to
it:

- what it is given and what it sends stays in °C (the catalog, the
  heuristics, the shot summary, the tools, propose_adjustment's value);
- everything it writes for the barista is in °F, never °C and never both:
  replies, questions and their options, and propose_adjustment's summary,
  rationale, expectedEffect and tips;
- a temperature converts × 1.8 + 32, a change × 1.8 with no 32, with worked
  examples ("1 °C hotter is 1.8 °F hotter, never 33.8 °F");
- a change to one decimal, as the change card shows it;
- a temperature the barista gives in °F goes to the tools in °C, on the
  lever's own steps (200 °F is 93.3 °C: a lever in steps of 0.5 °C takes
  93.5 °C, which is 200.3 °F);
- each template's temperature lever with its bounds, step, largest change
  and starting value in °F, worked out by CafAI, so the model has no
  arithmetic to do for them ("the coach's levers and their bounds said in
  °F").

The prompt stays the same for every request while the unit stays, so it
still caches: one prompt per unit, and a switch costs one request without
the cache. In °C the prompt is byte for byte today's (a unit test pins it).

**If it writes °C anyway.** CafAI converts on display, everywhere the
coach's words show (the chat, the change card, the starting profiles'
reasons, a question and its answers, History), and CafAI's own diff lines
and the care guide go through the same converter. A temperature written in
the other unit is written in the barista's, rounded as it was written (93 °C
reads 199 °F, 92.5 °C reads 198.5 °F). It reads as a change, converted
without the 32, when it has a sign ("+1.0 °C") or is small (under 30 °C or
50 °F, which no brew, steam or hot water temperature is), unless the words
right before it name a temperature ("at 25 °C", "cool to", "room
temperature", a fridge or a freezer); otherwise, and beside an arrow, as a
temperature. The words after a number never make it a change ("from 92 °C
up to 94 °C" is two temperatures). A range or a list converts every number
("88-94 °C", "1-2 °C", "92 → 93 °C", "89 / 88.5 / 88 °C"), but a number
further than 20 °C from the rest stays as written ("Step 3 to 90 °C").
"93 °C (199 °F)" keeps the barista's half, and a conversion the barista
asked for ("200 °F is 93.3 °C") stays as written. Nothing is rewritten
until a unit is chosen in Settings, so a barista who never chose sees
today's words exactly; once one is chosen it works both ways, so words the
coach wrote in °F read in °C after a switch back. (The review of
2026-10-15 found the first rules read "up", "over" and "behind" as a
change, converted only an arrow range's last number, read a cooled
sample's 25 °C as a change, and rewrote a °F the coach gave a °C barista
who asked for it; D176 records the rules as they are now.)

Unlike a taste promise (D127), a unit is arithmetic CafAI does exactly: a
second turn of the model, at the moment the barista waits for a change,
would buy nothing, and the coach's text streams to the screen, where
nothing can be sent back. What the barista typed stays as typed.

**The scripted coach** (mock mode, the demo) reads the prompt's °F section
and words its temperature changes in °F ("Raise brew temperature by 1.8
°F", "Brew 1.8 °F hotter"), its tool calls still in °C, as a coach that
follows the prompt would.

## 6. Where it lives

- `src/coach/temperature.ts`: the unit, the conversions, the formats, and
  the converter for text (`inTemperatureUnit`).
- `src/coach/fahrenheitPrompt.ts`: the prompt's °F section, with the levers
  in °F; `prompt.ts` takes `temperatureUnit` and mounts it.
- `src/app/temperatureUnit.ts`: the setting as live state (as
  `appearance.ts`), `Services.temperatureUnit`; `useTemperatureUnit()` in
  `src/app/services.tsx` reads °C outside a provider (a component's own
  test). `createCoachPort` reads it for each request's prompt.
- `src/ui/settings/drinkUnits.ts`: a stepper's view of its field in the
  barista's unit; `DrinkFields.tsx` shows, takes and announces through it.
- `src/ui/settings/TemperatureUnitRow.tsx`: the row in Appearance.
- Readouts: `formatTemperature` in `src/ui/machine/format.ts` takes the
  unit; `MachineStatus.tsx` and `drinkModel.ts` pass it.
- The coach's words on display: `RichText.tsx`, `DiffCard.tsx`,
  `TemplateCards.tsx`, `OptionChips.tsx`, `HistoryScreen.tsx`, and the care
  guide through `src/ui/care/careUnits.ts` in `RoutineCard.tsx` (`keepUnits`
  keeps "140 °F" together too).
- The scripted coach: `mock/anthropic/scenario.ts` reads the unit from the
  request's system prompt; `voice.ts` and `demoVoice.ts` word it.

## 7. Calls made (DECISIONS.md)

- D171: °F is a display unit; everything kept and sent stays °C.
- D172: Settings > Appearance > Temperatures; °C for everyone until
  changed, no locale guess (Decent's tablets come set to US English
  wherever they are sold; Decaid, streamline and de1app start in °C).
- D173: a stepper in °F moves one whole °C and shows whole °F.
- D174: the readouts keep their °C precision in °F.
- D175: the coach is told in its system prompt, one prompt per unit,
  its temperature levers worked out in °F.
- D176: a temperature in the other unit is converted where it shows,
  not sent back to the coach.
- D177: the scripted coach follows the °F prompt.

## 8. What is left

- Decaid's own words (a device error that names a temperature) stay in
  Decaid's unit.
- Other units (ounces, millilitres per second) are not part of this.
- A real coach in °F, over a real dial-in: the prompt is tested for its
  text, not yet for how well a model follows it (below).

## 9. Hardware test plan

On a Decent tablet with a DE1, in Settings > Appearance > Temperatures set
to °F:

1. The stats card's Group and Steam read °F and follow the machine live;
   Group's target is the profile's in °F (93 °C reads "target 199.4").
2. Settings > Steam, hot water and flush: set the steam temperature to
   300 °F. Decaid's own steam screen shows 149 °C, and the DE1 steams at
   it. A reload of CafAI still reads 300 °F. Tap More once: 302 °F, 150 °C
   in Decaid. The same for hot water (167 °F is 75 °C) and the flush
   (194 °F is 90 °C).
3. Steam, then pour hot water, then flush from the top bar: each view's
   temperature readout reads °F.
4. With the real coach (an API key or CafAI Bridge): a "Sour / sharp"
   answer gets a change card in °F ("+1.8 °F"), and the coach's words are in
   °F, never "33.8 °F hotter". Type "try 200 °F": the proposal is 93.5 °C,
   shown as 200.3 °F.
5. Switch back to °C: every screen, the chat and History read °C again.
6. On the oldest tablet (Chromium 91): the row, the steppers and the
   readouts work as above.

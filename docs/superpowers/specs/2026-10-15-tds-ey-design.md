# TDS and EY on the shot card: design

Date: 2026-10-15. Status: approved as the roadmap describes it (the owner's
pick from the gap review, D151); the calls below were made while building,
with no check-in, and each is recorded as a decision (DECISIONS.md, "TDS and
EY on the shot card", D162-D170). As built: two rules changed from
this spec's first draft once the card was looked at, the cell's height (it
no longer grows the card) and typing while the coach works (allowed, as in
the composer); section 3 has both.
The item on the roadmap ([ROADMAP.md](../../ROADMAP.md), "More from the gap
review (D151)").

## 1. The ask

From the roadmap: "An optional TDS field for a barista with a refractometer:
CafAI works out EY from the TDS, the yield and the dose, writes both to the
shot's record (`drinkTds` and `drinkEy`, already in Decaid's annotations, so
Visualizer gets them), and gives them to the coach, the one measure of
extraction it cannot read off the curves." Two things to check first: which
yield and which dose the EY uses, and that a reading typed after the taste
answer still reaches the coach.

## 2. What changes

- **The shot card** gets a fifth number, **TDS**. Without a reading its cell
  is one quiet button, "TDS" over "Add" (D162); a tap opens a field under
  the card's numbers. With a reading the card shows **TDS** "9.25 %" and
  **EY** "20.8 %" among its numbers; a tap on the TDS opens the field again
  to change or remove it.
- **Decaid's shot record** gets `drinkTds` and `drinkEy` (D165), through
  the queue that already carries the taste and the rating (D64), so
  Visualizer gets them with the rest.
- **CafAI's own records**: the shot's summary carries the reading, on the
  card in the chat and on the shot's iteration (D166), so History, the
  export and the backup in Decaid keep it.
- **The coach** hears each reading with its next turn, as it hears a verdict
  (D167), and the system prompt says what TDS and EY are and how far to
  trust them (D168).
- **The scripted coach** says what it heard (D170), so mock mode, the
  demo and the e2e can see a reading reach it.

## 3. The rules

| Thing | Rule |
|---|---|
| Where | Every shot card in the chat. In the card's grid of numbers, after First drop: on a tablet the grid has room for five columns, so the cell fills the empty one and the card does not grow; on a phone it takes a row of its own. |
| No reading | The cell is one button, 48 px tall: "TDS" (label, ink-muted) over "+ Add" (accent, 600), named "Add TDS". Its box reaches 3 px into the gaps above and below, so its row stays as tall as the other numbers' (42 px). |
| A reading | Two numbers: **TDS** "9.25 %" (two decimals) and **EY** "20.8 %" (one decimal), as the card's other numbers. The TDS cell is a button named "TDS 9.25 %, change it", with a small edit icon after the value; EY is a plain number. No EY (no dose or no yield): its value is a dash and a line under the numbers says why. |
| The field | Under the numbers, across the card: an outlined text field labelled "TDS", "%" at its end, 48 px; then **Save** (contained), **Remove** (text, only when changing a reading) and **Cancel** (text). Under it, in body-small and ink-muted: what TDS is, where the EY comes from with this shot's dose and yield, and "The coach gets it with your next tap or message." |
| Typing | CafAI's number field (D164): text with `inputmode="decimal"` (the numeric keyboard with a decimal point), `enterkeyhint="done"`, at most 8 characters; "9,25" reads as 9.25, a trailing "%" is allowed. Enter (the keyboard's Done) or Save keeps it; Cancel, or Escape, closes it and keeps nothing. Leaving the field keeps the draft and does nothing else: a tap on Save leaves the field first. |
| Range | More than 0 and at most 25 %, the range of the refractometers baristas use; rounded to 0.01 %, what they read. "abc", 0 or 30 says why under the field, in the error colour, and saves nothing. Empty and Save removes a reading (or closes the field when there is none). |
| EY | TDS (%) × yield (g) ÷ dose (g), the card's own Dose → yield, to 0.1 % (D163). Over 30 %, more than coffee gives up: kept and sent as typed, with a line in the warning colour under the numbers (D169). |
| While the coach works | Save and Remove are held, as the rating is, and Enter waits; typing is not, as in the composer, and the cell still opens the field. A draft stays in the field. |
| Focus | Opened from a keyboard (Enter or Space on the cell), closing the field gives the cell the focus back; opened by a tap, the focus leaves with the field, so the on-screen keyboard goes and no focus ring lands on the cell. |
| Saving | The card shows the reading at once. The write to Decaid waits and goes again when Decaid cannot take it, as the taste does; one Decaid refuses says so once in the chat. |
| Changing, removing | A new TDS replaces the old on the card, the iteration and Decaid (both numbers again); Remove takes both off the card and the iteration and sends `null` for both. The coach hears the new reading, or that it was removed, with its next turn. |
| History | A shot row ends "· TDS 9.25 % · EY 20.8 %". |

## 4. The dose and the yield (the first check)

`summarizeShot` (src/coach/summary/summarize.ts) already settles both, and
the card's ratio is `yieldG / doseG` from them:

- **Dose**: `annotations.actualDoseWeight`, else the workflow's
  `context.targetDoseWeight`. Decaid writes `actualDoseWeight` itself when it
  saves the shot, from the workflow's dose at the end of the shot
  (`ShotAnnotations.deriveForFinishedShot`, called from
  `de1_state_manager.dart` `_persistShotIfNeeded`), so in practice both are
  the dose set in Decaid, not a weighed one.
- **Yield**: `annotations.actualYield`, Decaid's weight once the cup has
  settled after the stop (`trustedFinalYield`, to 0.1 g), else the scale's
  last weight in the record when CafAI trusts the scale (it was tared and
  not knocked: `scaleUnreliable` in analysis.ts).

EY uses those two, as rounded on the card (0.1 g), so the barista can check
it by hand and EY and the ratio always agree: EY = TDS × ratio. Visualizer's
plugin picks its `bean_weight` and `drink_weight` in the same order
(`plugin.js` `convertReaToVisualizerFormat`). A shot with no yield (no scale,
or one CafAI does not trust) or no dose keeps its TDS alone: `drinkTds` goes
to Decaid, `drinkEy` is left as it is, and the card says "No EY: this shot
has no yield from the scale." (or "...: Decaid had no dose for this shot.").

## 5. Reaching the coach (the second check)

A reading is an event the coach hears with its next turn, the way a verdict
is (D126, ENGINE_PROTOCOL rule 9):

```
[event:shot_measured]
{"shotId":"…","tdsPct":9.25,"eyPct":20.8,"doseG":18,"yieldG":40.4}
```

`eyPct` is null without a dose or a yield; `tdsPct` null says the barista
removed the reading. The engine compares each card's reading with the last
one the transcript told for its shot (`untoldReadings`, src/app/engine/shotReading.ts),
so a reading is told once, a changed one again, a removed one as null (only
when the coach had heard one), and a reload before the next turn loses
nothing. It rides after the tool results and the verdicts, before anything
else.

So a reading typed before the taste answer comes with the answer, and the
coach has it when it picks the change. A reading typed after the coach has
proposed a change comes with Confirm or Not now, a message, or the next
shot. The other two ways were weighed:

- **A re-ask** (a turn of its own as soon as a reading is saved) would call
  the model for every reading and every correction, and with a change card
  open it would have to set the card aside, as a typed message does: the
  barista would lose the change they were about to confirm.
- **A note in the chat** ("TDS saved; the coach hears it next") would add a
  line per reading and per correction, push the chat on, and take the stats
  card away. The field's own line says it instead, while it is open.

A summary carries the reading too (section 6), so the coach sees it again in
`get_shot_summary`, `compare_shots` (with the difference between two shots)
and `get_bag_history`.

## 6. Under the hood

- `src/coach/extraction.ts`: the rules as plain functions: reading what was
  typed, the range, rounding, EY, and a summary with a reading or without.
- `ShotSummary.tdsPct` and `eyPct` (src/coach/types.ts): absent without a
  reading. `summarizeShot` reads Decaid's `drinkTds` too, and works the EY
  out itself, so a record that already has a TDS (an import, another app)
  shows it, and a summary rebuilt from Decaid's record after a restore keeps
  it.
- The card and the iteration hold the same summary with the reading; the
  engine's `setShotTds(shotId, tdsPct | null)` (CoachController) changes
  both, then queues the Decaid write. The storage schema checks the two
  numbers in a summary.
- `ShotUpdateRequest`'s annotations take `null` for `drinkTds` and `drinkEy`
  (the pinned spec says nullable; Decaid's deep merge writes the null and
  `ShotAnnotations.toJson` then leaves the key out). The mock Decaid already
  answers that way; its contract test now writes and clears a reading.
- `EVENT.shotMeasured`, `shotMeasuredBlock` (protocol.ts), and the prompt's
  loop item 10 and its section "A refractometer reading".
- The UI: `src/ui/chat/parts/ShotTds.tsx` (the cells, the field and the
  lines), mounted in `ShotCard.tsx` with one line inside the grid of
  numbers; `ChatSurface` and `CoachScreen` pass `setShotTds`.

## 7. What the coach is told

In the loop (item 10): the event and its fields, as above. A section of its
own, "A refractometer reading":

- TDS is the share of the drink that is dissolved coffee, measured by the
  barista; EY is the share of the dose that ended up in the cup, worked out
  by CafAI from the card's dose and yield. EY is the one measure of
  extraction the curves cannot give.
- It is a number about extraction, not a taste: never say what a shot at a
  given EY tastes like, and never hold one up as the number to aim for. The
  barista decides what is good; their verdict and their words outrank it,
  as they outrank the curves (D127).
- Trust it as a measurement with an error of its own: a reading moves by a
  few tenths with how the sample is stirred, cooled and read, and the EY
  carries the dose's and the yield's (Decaid's dose is the one set, not
  always the one in the basket). Compare readings of the same bag; a change
  of under about 0.5 EY points is noise.
- Outside about 14-26 % is unusual for espresso, and over 30 % no coffee
  gives up: say the reading may be off and ask them to check it before
  acting on it.
- A reading that arrives after a proposal does not reopen it: one line on
  what it adds, then use it for the next decision.

## 8. Testing

- Unit: `extraction.test.ts` (reading the field, range, rounding, EY, null
  cases); `summarize.test.ts` (a record with `drinkTds`); the engine (the
  card, the iteration and Decaid written; a change and a removal; told with
  the next turn, again when changed, as removed; after a reload; behind a
  write that waits; a refusal named in the chat); `shotReading.test.ts`;
  the queries (`get_bag_history`, `compare_shots`); the prompt; the storage
  schema; the scripted coach (terse and demo voices); `ShotTds.test.tsx`,
  `ShotCard.test.tsx`, `ChatSurface.test.tsx`, `HistoryScreen.test.tsx`; the
  mock Decaid's contract test.
- e2e (`e2e/tds-ey.spec.ts`, every project): a reading before the taste
  answer reaches the coach with it, and Decaid's record has both numbers
  worked out from the card's dose and yield; a reading after the coach
  proposed a change reaches it with Confirm; changing, removing, the
  range, a reload and History.
- Live (`src/api/live/shot.decaid.ts`): on the simulated shot, a TDS and its
  EY written, read back and cleared.

## 9. Out of scope, left

- A TDS from a refractometer Decaid connects (Decaid lists a DiFluid R2 as a
  sensor on main): typed only, for now.
- A reading added elsewhere after the shot (Visualizer's back-sync, another
  skin) does not come back to the card.
- Whether Decaid's Visualizer plugin at the pin (0.8.8) sends a later TDS to
  visualizer.coffee as it sends later notes and ratings: read in its code on
  Decaid's main (af4e995), not seen on a real upload.
- No setting: the cell is on every card.

## Hardware test plan

On a Decent tablet (Chromium 91 WebView), with a scale, and Decaid's
Visualizer plugin set up if you can:

1. Pull a shot. On its card, tap **TDS · Add**: the keyboard opens with
   digits and a decimal point (a comma on some locales), and the field stays
   in view above it.
2. Type a reading the way the keyboard offers it ("9,25" or "9.25") and tap
   the keyboard's Done: the card shows TDS 9.25 % and an EY that is TDS ×
   the card's yield ÷ its dose.
3. Answer the taste: the coach's reply uses the reading.
4. In Decaid's shot history (or `GET /api/v1/shots/{id}`), the shot has
   `drinkTds` 9.25 and `drinkEy` as on the card.
5. On visualizer.coffee, the shot shows the TDS and EY: once uploaded before
   the reading (type it a minute after the shot), and once with the reading
   typed before the upload.
6. Change the reading, then remove it: Decaid's record follows (both gone
   after Remove), and so does Visualizer.
7. With Decaid out of reach (Wi-Fi off on a phone), save a reading: it goes
   to Decaid once it is back.

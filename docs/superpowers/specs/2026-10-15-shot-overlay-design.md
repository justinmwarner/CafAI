# Overlaid shot curves: design

Date: 2026-10-15. Status: built on the owner's approval of the roadmap item
as written (docs/ROADMAP.md, "More from the gap review (D151)"); the calls
below are the builder's, recorded as D-CURVE-1 to D-CURVE-5 in
DECISIONS.md, for the review.

## 1. The ask

From the roadmap: "A shot's card and the Shot view draw one shot, and
'Compared with your previous shot?' is words only. Draw the bag's previous
version's shot faintly under this one, so the change the coach made shows on
the curve, as Visualizer, Liquid Aqua, Crema and DSx do. CafAI keeps shot
summaries without their curves, so both shots come from Decaid
(`GET /api/v1/shots/{id}`). Check first: how the graph tells the two shots
apart in every tint and both modes, by more than colour."

## 2. What the barista gets

- **On a shot's card**, under its pressure and flow, the shot its question
  asks about, as a faint wide band in the same two colours: "Compared with
  your previous shot?" draws the previous shot; a bag's first shot,
  "Compared with your last shot of Red Brick?", draws that one. The legend
  beside the curves gains a third key, a pale band, "Previous shot" (or
  "Last shot of Red Brick").
- **In the Shot view, while the shot pulls**, the bag's previous shot under
  the live curves, so a grind change shows as it happens: the flow rising
  later, the pressure building higher. A line over the plot names it with
  its time and yield: "Previous shot · 28.1 s · 36.2 g".
- **In the Shot view once the shot is done**, the same, now the shot its
  card asks about.
- Nothing new to tap, nothing to set. A shot with nothing to compare with
  (the very first, "Compared with the coffee you usually enjoy?"; a card
  rated with stars before D126) draws alone, as before.

## 3. The calls

**Which shot goes under this one (D-CURVE-1).** The shot the card's
question names: its `baseline` (D126). For most shots that is the shot
before it in the bag's chat; for a bag's first shot, the last shot of
another coffee; for the very first, none. Not "the bag's previous
version's shot", as the roadmap put it:

- the card asks about the previous shot, so drawing another would ask
  about one shot and draw another;
- a grind move, the commonest change, makes no new version (a change by
  hand), so the previous version's shot would be the one before the last
  profile change, often several shots back, and the change the coach made
  would not be on the curve at all;
- two shots of one version (a re-pull, a "keep it") are compared with each
  other, which is what the barista is asked to do.

While a shot pulls it has no card yet; the guide is the bag's newest card,
which becomes the new card's "previous shot" when it lands. A bag's first
shot has no guide while it pulls (the bag has no shot yet); once its card
is in, the Shot view draws the other coffee's shot its card names.

**Where it shows (D-CURVE-2).** Every shot card whose question names a
shot; the Shot view during the shot (a guide, as DSx and Crema draw one)
and after it; not before any shot ("Pull a shot to see it here." stays
alone), and not in History, which draws no curves.

**How the two shots are told apart (D-CURVE-3).** By form first, then
lightness; never by colour alone:

| | This shot | The shot under it | The profile's targets (Shot view) |
|---|---|---|---|
| Form | a solid line, 2.5 px (2 px on the card) | a band, 7 px (5 px on the card), round ends and joins | a dashed line, 6/5, 1.5 px |
| Colour | pressure green, flow blue | the same hues, washed toward the page | the series colours |
| Order | on top | under everything, the grid only below it | between |
| Key | the readouts' swatches; the card's Pressure and Flow keys | a pale band swatch, "Previous shot" | none (as before) |

The band's colours are two palette roles, `graph.pressureGuide` and
`graph.flowGuide`: the series colour at 45% over the page in dark mode and
50% in light (opaque hex, never opacity, which the contrast sweep could not
check), and the key's neutral swatch, `graph.guide`, ink-muted the same
way. The contrast sweep checks them in every tint, at every hue, in both
modes: the band at least 1.9:1 against the page and the card, this shot's
pressure and flow at least 2:1 against their own bands, so a line stays
readable where it runs along its band, and every line of this shot at least
1.6:1 where it crosses the other band (weight flow runs along the flow band
for most of a pour; a crossing line differs from the band in hue too). That
is below the 3:1 a series keeps, on purpose: the band is the faint one, its
words are in the key, and in light mode a series' own 4.5:1 or so against
the page leaves room for no more than about 2:1 on each side of a band
between them (weight flow, about 3.5:1, less). Auto is light or dark, so it
is covered by both. As built, the worst across the sweep, all in light
mode: the band 1.97:1 on the page, pressure and flow 2.13:1 on their bands,
weight flow 1.65:1 along the flow band; in dark, 2.38:1 (the band on the
card), 3.22:1 and 2.74:1. Seen in PNGs at 1280x800,
962x602, 390x844 and 844x390, dark, light and Auto, in Crema, Matcha,
Tamper, Plum and Cherry, and in a real Chromium 91.

The words: the card's curves are named "Pressure and flow during the shot,
with the pressure and flow of your previous shot under them", and
described "Previous shot: 28.1 s, peak pressure 9.0 bar."; the Shot view's
plot is named the same way, and its key line is ordinary text.

**Where the curves come from (D-CURVE-4).** The roadmap's premise was that
CafAI keeps shot summaries without their curves. Read in the code, it keeps
them: each shot's card in the chat holds its summary with the ~1 Hz series
(the series the card's sparkline has always drawn and the coach reads),
stored in IndexedDB and in the chat's copy in Decaid's store
(`conv.<bagId>`); only the iteration records' copy in Decaid leaves the
series out (`src/storage/mirror.ts`). So:

- the shot under this one is read from its card in the chat on screen,
  with no request, when it is there with a curve (the previous shot,
  almost always);
- otherwise (another coffee's last shot; the bag the barista has since left,
  in the Shot view) it is read once from Decaid, `GET /api/v1/shots/{id}`,
  summarised as any shot is, and kept for the session (at most 24 shots);
  two cards that want the same shot share the one request;
- Decaid answering 404 (the shot was deleted there) means none for the
  session; any other failure draws this shot alone, quietly, and is tried
  again at most once a minute, and only when something wants it again.

Both shots are drawn from the same ~1 Hz series, on the card and in the
Shot view: a guide does not need Decaid's 4-5 Hz frames, and a request when
the shot starts would land on the tablet's Decaid at its busiest.

**One clock for both (D-CURVE-5).** Both curves count from the pour's start
(the first frame after preheat, `pourStartS`), as the Shot view's clock and
the card's times already do, so two shots with different preheats line up.
The card's sparkline therefore starts at the pour too, without the flat
stub of preheat it drew before (a summary saved before CafAI recorded
`pourStartS` is drawn from its first sample, as before). The time axis runs
to the longer of the two shots (in the Shot view, at least 30 s as before),
so neither is cut off and a live shot's axis does not move as it passes the
previous one. Only pressure and flow are drawn for the shot under: they are
what the card draws and what a change moves; its weight and weight flow
would double the lines on a graph read from a step back.

## 4. Under the hood

- `src/ui/compare/comparison.ts` (pure): `comparisonTarget(baseline)` (the
  shot and its name), `pourCurve(summary)` (times from the pour's start,
  memoised per summary), `chatShotSummary(messages, shotId)` (memoised per
  messages array), `newestShotId`, and the words (`underThem`,
  `describeShot`, `keyFacts`).
- `src/ui/compare/comparisonShots.ts`: the per-client cache of shots read
  from Decaid: one request per shot, shared while in flight, 404 kept as
  none, a failure tried again after 60 s, at most 24 shots.
- `src/ui/compare/useComparison.ts`: `useComparisonSummary(target, holder)`,
  from the chat first, then the cache, Decaid asked only while the chat on
  screen still holds the card that wants it (the old bag's cards render once
  more against a new bag's messages before they go); nothing outside a
  `ServicesProvider` (a card drawn on its own in a test or a preview). And
  `useShotViewComparison()`, which the shell (`AppShell.tsx`) calls when the
  app starts.
- `src/ui/compare/shotViewComparison.ts`: the Shot view's comparison for the
  app's one shot trace: the newest card while the shot pulls, the finished
  shot's card's comparison once it is in (kept for that shot, even after a
  switch of bag), and the guide it pulled with while its card is not in.
  Created with the shell, so it has followed every shot and card.
- `src/ui/compare/guide.ts`: drawing the band on uPlot's canvas, in its
  `drawAxes` hook (after the grid, before the series), clipped to the plot.
- `src/ui/compare/GuideKey.tsx`: the band's swatch for the keys.
- `src/ui/chat/parts/ShotSparkline.tsx`: the card's curves, moved out of
  `ShotCard.tsx`, which now only mounts it, with the baseline only where the
  card asks its question (not on a card rated with stars).
- `src/ui/machine/LiveShotGraph.tsx`: the guide hook, the time axis, the key
  line and the plot's name.
- `src/ui/palette.ts`: `graph.pressureGuide`, `graph.flowGuide`,
  `graph.guide`; their pairs in `palette.test.ts`.
- `src/app/services.tsx`: `useOptionalServices()`.
- No new Decaid route: `GET /api/v1/shots/{id}` is already read (the coach's
  query tools) and the mock Decaid already answers it as Decaid does, 404
  "Shot not found" included. The live read suite gains a check of that 404
  (`src/api/live/read.decaid.ts`).

## 5. Testing

- Unit: the target for each kind of baseline; the pour curve (shifted,
  trimmed, one lead-in point at 0, gaps kept); the chat lookup; the cache
  (one request, shared, 404 kept, a failure retried after the wait, the
  bound); the Shot view's comparison (live, done, a card that lands, a bag
  switch, a new shot); the band's drawing on a fake canvas; the card (band
  drawn, legend key, names and description, alone without a comparison,
  another coffee's shot read once, quiet on a failure); the Shot view (key
  line, plot name, the axis to the longer shot, the hook drawn under the
  series); the contrast sweep's new pairs.
- End to end (`e2e/shot-overlay.spec.ts`, all five projects): two shots on
  one bag: the second card draws the first under it and the first draws
  alone; the Shot view names the previous shot while the second shot pulls
  and after; the demo's first Kiambu AA card draws Santos's shot, read from
  Decaid once; a shot Decaid no longer has leaves the card alone, with no
  error.
- Seen in PNGs (`.verify/`): the card and the Shot view, phone and tablet,
  dark and light, Crema and Matcha (Tamper too).

## 6. Left

- Choosing another shot to compare with (Crema cycles through them; the
  card's question fixes the one here).
- The shot under in History or a shot's full graph from History.
- Weight and weight flow for the shot under.
- A setting to hide it; nothing asks for one yet.

## Hardware test plan

On a Decent tablet (Chromium 91) with a real DE1 and scale, in dark and
light:

1. Pull two shots of one bag, the second a step finer. The second card
   shows the first as a pale band under its lines; at arm's length, in
   daylight, the band is seen and the line on it stays readable.
2. Pull a third shot and watch the Shot view: the second shot's band is
   under the live curves from the start, the key line names it with its
   time and yield, and the live graph does not stutter (the timer keeps
   time, the curves keep up).
3. Start a new bag and pull its first shot: once its card is in, the card
   and the Shot view draw the last shot of the other bag, named by its
   coffee.
4. Delete a shot in Decaid's own shot history that a card compares with,
   reload CafAI: the card draws its own shot alone, with no message.

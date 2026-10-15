# Machine care, the cleaning guide: design

Date: 2026-10-15. Status: approved (the owner chose "Build it with these",
with the two answers in section 1).
Mockup: [2026-10-15-machine-care.mockup.html](2026-10-15-machine-care.mockup.html),
rendered in `assets/machine-care-*.png`.
The first of the three machine care items on the roadmap
([ROADMAP.md](../../ROADMAP.md), "Machine care (D151)"); the cycles and the
reminders come after it and build on this screen.

## 1. The owner's ask

From the gap review (D151): "break it down to what you do every day, week,
month, etc. so it's easy to clean without having to find everything", built
on Decent's video "How often/to clean DE1" (Decent Espresso Tech,
2022-03-07, 22:33, <https://www.youtube.com/watch?v=0cm1JxB_6bI>).

Answers given, after the mockup:

- **Where it sits: Settings > Machine care.** A Settings section opens the
  Care screen; the top bar keeps its four places (at 962 px it has 18 px to
  spare, DESIGN.md). Not a fifth place, not a link on the stats card. The
  stats card's "clean due" line (the third item) will open the same screen.
- **The routines: one at a time.** Daily, Weekly, Monthly and As needed, as
  segments; not one long page.

## 2. What changes

- **Settings > Machine care**, a section after Steam, hot water and flush:
  one line and a tonal **Cleaning guide** button.
- **The Care screen**, `#/care` (and `#/care/weekly`, `#/care/monthly`,
  `#/care/as-needed`): a header with a back arrow, the four routines as
  segments, the chosen routine's steps, and Decent's video.
- **Decent's video**: CafAI's own poster until a tap; then YouTube's player
  in place where it can play there, or a link to YouTube at the moment where
  it cannot (section 5).
- **The guide's words** are CafAI's own (section 4): they need no network.

## 3. The rules

| Thing | Rule |
|---|---|
| The route | `{ name: 'care', routine: 'daily' \| 'weekly' \| 'monthly' \| 'asNeeded' }`. `#/care` is Daily; `#/care/weekly`, `#/care/monthly`, `#/care/as-needed` the others; an unknown routine is Daily. A reload keeps it (remembered like any screen). |
| Its place | Under Settings: the Settings item in the top bar and the Settings tab are current (`aria-current="page"`) while Care is on screen. Nothing else in the shell changes. |
| Opening it | Settings > Machine care > **Cleaning guide** goes to `#/care` (a normal navigation, so Back returns to Settings). |
| The back arrow | At the start of the header, named "Back to Settings": goes to Settings. |
| The routines | Segments in a tab list named "How often": **Daily**, **Weekly**, **Monthly**, **As needed**. A tap shows that routine and replaces the address (`location.replace`), so Back does not walk through the segments. The arrow keys, Home and End move between them, as in any tab list; one Tab stop. |
| A shot or a drink meanwhile | As anywhere: a shot takes the screen to the Shot view and comes back to the coach (D85); a drink takes it to its view, and Go back returns to Care ("Go back to Machine care"). The player stops when Care leaves the screen. |
| Nothing loads from YouTube | until the barista taps the poster, a moment or Watch on YouTube. The poster is CafAI's own drawing (no thumbnail from YouTube). |
| In place or a link | YouTube's player is put on the page only where it plays there: in a browser (outside Decaid), and inside Decaid on Android. Inside Decaid on any other platform (Windows, macOS, iOS, Linux, or one CafAI cannot read) every moment is a link to YouTube at that moment, and there is no poster. Section 5 says why. |
| A moment | A text button in the accent at the end of its step (or its routine's header): a play icon and the time, "1:48", in tabular figures. In place: named "Play from 1:48: Flush the group head"; a tap loads the player at that moment, playing, and marks that button (the accent wash, `aria-pressed`) until another plays. A second tap restarts it there. As a link: named "Watch from 1:48 on YouTube: Flush the group head", the "opens elsewhere" icon after the time. |
| Links | Inside Decaid a plain link, which Decaid opens in the system browser (as On Visualizer does, D121). In a browser, a new tab (`target="_blank"`, `rel="noopener noreferrer"`), so CafAI stays open. |
| Offline | The guide shows in full. A tapped player shows YouTube's own error inside its frame; the links say nothing until tapped. |

As built, after the branch's review: while the video is open, a drink
starting leaves Care on screen (D156: Daily's own steps, a Flush or the
wand's rinse from the top bar, would otherwise close the video the barista
is following); with it closed, the row above holds. A tap on the poster
gives the focus to the player it opens. Four steps' words were put right
against the quick start and the profile's notes (DECISIONS.md D155).

## 4. The guide

From the video and Decent's own pages, read on 2026-10-15 (sources at the end
of this section). Where the 2022 video and Decent's current pages differ, the
step follows the pages and says so in a note. Moments are the video's key
moments (its description) and three more from its captions: 6:52 (the tank and
drip tray), 15:04 (the intake filter, the time Decent's own flow-rate page
links) and 21:36 (descaling). The video is spoken in English (YouTube:
"English (US) original").

The machine's cycles and the cleaning profile are not CafAI's to run yet (the
second item adds them): where a step needs one, a line says "From streamline
for now: …", streamline being the skin Decaid comes with, whose Settings >
Maintenance has Clean, Machine Descaling and Transport Mode.

**Daily**: "On days you pull shots." The routine's moment: 0:20.

| Step | When | How | Note, where, link | Moment |
|---|---|---|---|---|
| Purge and wipe the steam wand | Each time you steam | Take the jug away as steam stops and point the wand at the drip tray: the DE1 clears it a moment later. Then wipe it with a damp cloth. | | |
| Flush the group head | After the day's last shot | Blind basket in, then Flush at least twice. Water only. | Note: "Decent's Forward Flush x5 profile does the same in pulses, as in the video; streamline can run it." | 1:48 |
| Wipe the shower screen | After the flush | Wipe the screen under the group head with a damp cloth. Then a coffee basket in, one more Flush, and rinse the portafilter. | | |
| Rinse the steam wand | When you're done for the day | Wipe it, and steam a jug of clean water through. After a lot of milk, first soak the tip in a little Rinza for about 10 minutes, without steaming it. | | |

**Weekly**: "Once a week." The routine's moment: 7:40.

| Step | When | How | Note, where, link | Moment |
|---|---|---|---|---|
| Clean the group head with detergent | | 3 g (half a teaspoon) of espresso machine detergent in the blind basket, then the Forward Flush x5 profile. Portafilter off, Flush until the water runs clear; rinse the basket and run the profile again without detergent. Last, Flush for 20 seconds. Never put detergent in the tank. | Where: "From streamline for now: the profile, or its Clean (Settings > Maintenance)." Note: "Decent's quick start says a tablespoon; the profile's notes and the video, half a teaspoon." | 7:53 |
| Steam Rinza through the wand | | 30 ml of Rinza in 500 ml of water (or one tablet): steam the jug with it, then steam clean water through, twice. | Note: "Decent's quick start gives steaming this diluted mix as the other way to the soak; Rinza any stronger is only soaked." | 11:11 |
| Wash the water tank and drip tray | | The tank, the drip tray and its cover, with soap and water. With a refill kit, turn it off before you take the tank out. | Note: "The video washes them every day, in a dishwasher; Decent's pages say weekly, with soap and water." | 6:52 |
| Clean the intake filter | | The filter at the tank's intake (the thimble); Decent's page shows which one you have. V1: soak it in citric acid for about 30 minutes, every week or two. V2: in baking soda for 30 minutes to an hour, at least monthly, then scrub it gently (a pipe cleaner if it's clogged). | Link: "Decent's intake filter page". | 15:04 |

**Monthly**: "Every two to four weeks." The routine's moment: 16:36.

| Step | When | How | Note, where, link | Moment |
|---|---|---|---|---|
| Soak the group head's parts | | Machine off and cool. The centre screw frees the shower screen and a diffuser, three more the inner one (mind the temperature probe). Soak them overnight in 15 g of detergent in 500 ml of hot water, rinse them in fresh water, and refit the inner diffuser first. | Note: "The video does this every two weeks. Since v1.44 (2023) the screws are Torx: T20 in the centre, T10 for the three." | 16:56 |
| Look at the group gasket | | While the parts are off, wipe the gasket. Hard, cracked, or water beading round the portafilter in a shot: time for a new one. Between sessions, leave the portafilter out. | | |

**As needed**: "When your water, the steam or a move calls for it." No
routine moment.

| Step | When | How | Note, where, link | Moment |
|---|---|---|---|---|
| Descale | Water under 30 ppm: never. 30 to 120 ppm: every year or two. Over 120 ppm: twice a year or more. Sooner if the steam starts to pulse. | Citric acid only. Steam heater off until it's down to 60 °C (up to an hour), steam tip off, then the DE1's Descale with 80 g of citric acid in 1.5 litres of water. Rinse well: plan on 7 to 8 litres. | Where: "From streamline for now: Settings > Maintenance > Machine Descaling." Note: "The video says water of 60 to 120 ppm hardly needs it; Decent's pages say every year or two." Link: "Decent's descaling steps". | 21:36 |
| Unclog the steam tip | When it clogs | Machine off and cool. Unscrew the tip, pressing a spoon on the tube inside so it stays put; soak the tip in hot water, push a needle through, check both O-rings, refit. | Note: "The video takes the tip off every night; Decent's pages, only for a stubborn clog." Link: "Decent's steam tip page". | 5:10 |
| Empty the machine to move it | Before a move, or a long time unused | The DE1's Transport: with the water tank pulled forward, it empties its water into the tank in a minute or two. Then turn it off. | Where: "From streamline for now: Settings > Maintenance > Transport Mode." | |

At the end of every routine, in caption, ink-muted: "From Decent's video
(March 2022) and Decent's own pages. Where they differ, the steps follow the
pages and say so."

Judgment calls, recorded in DECISIONS.md:

- **The detergent for the weekly clean** follows the Forward Flush x5
  profile's own notes (Decent's text, shipped in Decaid as
  `assets/defaultProfiles/Cleaning__Forward_Flush_x5_2.json`) and the video,
  3 g, over the quick start's tablespoon, and the note says so.
- **Rinza is steamed weekly**: the quick start's weekly step (p.39) steams it,
  as the video does; its soak with "Do not steam!" (p.37) is the daily option
  after a lot of milk, which the daily rinse carries.
- **The group head's parts**: the video switches the machine off at the back
  for them (17:08), as the quick start does; only the video's description says
  sleep is enough. The steps say off.
- **The tank and drip tray** are weekly (the quick start), the video's daily
  wash a note.
- **The daily flush** uses Flush, which the quick start allows ("Use the
  Forward Flush x5 preset or the Flush button"), so the daily routine is
  CafAI's own top bar from start to end.

Sources: the video and its captions; Decent's quick start
(<https://decentespresso.com/doc/quickstart/quickstart.pdf>, pp. 25, 34-48);
the water page
(<https://decentespresso.com/docs/water_recommendations_for_the_de1_and_bengle>);
the descaling page
(<https://decentespresso.com/docs/de1_descaling_instructions>); the flow rate
page for the intake filter
(<https://decentespresso.com/docs/the_actual_flow_rate_has_become_lower_than_the_machines_reading>);
the steam tip page (<https://decentespresso.com/docs/how_to_replace_your_steam_tip>);
the group head controller page; the v1.44 blog and the group head upgrade
video (Torx T10 and T20); the gasket page and Decent's gasket video; Decent's
app tour (the purge, Clean, Descale, Transport). Each step's sources are in a
comment beside it in `careGuide.ts`.

## 5. The video

**Where it plays in place.** Tried on 2026-10-15:

- YouTube's embedded player, from `youtube-nocookie.com`, loads and plays in
  a page served from `localhost` with Decaid's user agent (just `Decent`) and
  with an ordinary one, in Chromium 153 and in Chromium 91 (the oldest Decent
  tablets' engine), the start time and autoplay working.
- Decaid 0.8.8 for Windows did not let it load: its navigation guard
  (`classifySkinNavigation`, `lib/src/skin_feature/skin_view.dart`) sends
  every http(s) page outside the skin's own to the system browser, frames
  included, and its log said "Opening external link in system browser:
  https://www.youtube-nocookie.com/embed/…". The frame stayed empty and
  YouTube opened in the browser.
- Android's WebView never asks the app about a frame's http(s) loads (only
  the top page's), so on Decent's tablets the player should play in place.
  Not yet seen on a tablet: the hardware test plan gets the check.
- iOS and macOS (WKWebView) ask the app about frames too, so Decaid there
  behaves as on Windows.

CafAI reads the platform from Decaid's own `__DECENT_HOST__.platform`
(`android`, `ios`, `macos`, `windows`, `linux`), which Decaid injects at
document start. In place: outside Decaid, or inside it on `android`.
Otherwise links.

**The player.** An iframe, 16:9, radius 12, titled "Decent's video: How
often/to clean DE1", `src`
`https://www.youtube-nocookie.com/embed/0cm1JxB_6bI?start=<s>&autoplay=1&rel=0&playsinline=1`,
`allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`,
`allowfullscreen`, `referrerpolicy="strict-origin-when-cross-origin"` (YouTube
asks embedders for a referrer). It is created by the tap, and created again
on every tap (a new key), so a moment always starts where it says. YouTube's
own controls, captions and full screen are YouTube's.

**The links.** `https://www.youtube.com/watch?v=0cm1JxB_6bI&t=<s>s` (no `t`
for 0), and **Watch on YouTube** without one.

**Privacy (README).** Until a tap nothing reaches Google. A tap on the poster
or a moment loads YouTube's player from `youtube-nocookie.com` (YouTube's
privacy-enhanced mode, which sets no cookies until the video plays), and from
then YouTube sees the device's address and that the video played; a link
opens YouTube itself.

## 6. Layout

The screen lays itself out for its own box (`useOwnLayout`):

- **Wide** (own width 840 px and up: every Decent tablet, a landscape iPad):
  the header across the top (as History's: 57 px, a line under it, the back
  arrow 48 px, "Machine care" in title). Under it two columns, 16 px from the
  sides, 12 px down, 20 px apart: at the left the segments then the routine's
  card (scrolling inside the column); at the right, 360 px wide, the video
  card, which does not scroll with the steps.
- **Narrow** (under 840 px: phones, an upright iPad): one column under the
  header, scrolling as one: the segments, the video card, the routine's card.
  The video card starts as one short row (a 48 px round play button in the
  accent, "Decent's video · 22 min", "Loads from YouTube when you tap play.")
  and becomes the player, at the column's width, on a tap, scrolled into
  view. Without the player (links), the row is the title, the line that
  Decaid opens it in the browser, and Watch on YouTube. Steps lose their
  numbers.

As built, after seeing it at every size: the steps' column is at most
680 px wide (the chat's lane) and the narrow column at most 760 px (as
Settings), both from the left, so a line stays readable on a big tablet;
on a narrow screen a step's moment sits beside its title only and the
words under the title take the whole width; and a number never parts from
its unit at a line's end ("60 °C").

**The segments**: the Mode control's look (DESIGN.md, Appearance controls):
a raised track, radius 14, 4 px padding and gaps; segments at least 48 px,
radius 10, 15 px labels at 600 in ink-muted that wrap inside their segment
on a phone; the chosen one surface with an ink label and the hairline shadow.

**The routine's card**: outlined Paper (surface, a 1 px line, radius 16, 16
px sides). Its header: the routine's name (subtitle at 700) over its
cadence (body-small, ink-muted), the routine's moment at the right, a line
under. Then the steps, each above a 1 px line but the first, 12 px above and
below: on a wide screen a 28 px number (a raised circle, label at 650,
ink-muted); the title (subtitle at 600); when (label, ink-muted); how
(body-small, ink); where (label, ink-muted); the note (an outlined info icon,
16 px, and label, ink-muted); the link (a text button in the accent with the
"opens elsewhere" icon); the moment at the end of the row, 48 px tall,
nudged up to line up with the title. Last, the sources line (caption,
ink-muted), 10 px above.

**The video card**: outlined Paper, 12 px padding. Before a tap: the poster
(16:9, raised, radius 12; a 64 px accent circle with an on-accent play
triangle over "Play Decent's video" at 600; the whole poster one button named
"Play Decent's video: How often/to clean DE1", from the start), then the
title (subtitle at 600), "Decent Espresso Tech · 22 min · 2022" (body-small,
ink-muted), "Loads from YouTube when you tap play." (caption, ink-muted) and
**Watch on YouTube** (a text-button link with the "opens elsewhere" icon).
Playing: the player in the poster's place, then "Playing from 11:11: Steam
Rinza through the wand" (body-small, the time at 600 in tabular figures),
"How often/to clean DE1 · Decent Espresso Tech" (body-small, ink-muted) and
Watch on YouTube. Links: no poster; the title, the details, "Decaid opens the
video in your browser: each time starts it at that step." (body-small) and
Watch on YouTube.

**Settings > Machine care**: a section (DESIGN.md, Cards: Settings) after
Steam, hot water and flush, before About: "What to clean every day, week and
month, with Decent's video." (body-small, ink-muted), 12 px above **Cleaning
guide** (tonal, the cleaning icon, `CleaningServicesRounded`).

## 7. Under the hood

- **`src/ui/care/careGuide.ts`**: the guide as data (the video, the four
  routines, their steps with when, how, note, where, link and moment), each
  step's sources in a comment, and pure helpers: `formatMoment(seconds)`
  ("1:48", "16:56"), `embedUrl(seconds)`, `watchUrl(seconds?)`.
- **`src/ui/care/videoPlace.ts`**: `videoPlaysInPlace(host)`.
- **`src/ui/care/CareScreen.tsx`** (the screen: header, layout, the player's
  state), **`CareSegments.tsx`** (the tab list), **`RoutineCard.tsx`** (a
  routine's card and its steps), **`CareVideo.tsx`** (the poster, the player,
  the links; the narrow row), **`MomentButton.tsx`**, and **`routines.ts`**
  (the routines' ids, shared with the router).
- **`src/ui/settings/CareSection.tsx`**: the Settings section.
- **Routes** (`router.ts`): the care route, its paths, `sameRoute`, and
  `placeOf(route)`, the place a route belongs to (`care` is Settings', a
  drink's view none), which the top bar and the tabs use for
  `aria-current`. `goBackLabel` names Care "Machine care".
- **Host** (`src/api/host.ts`, `types.ts`): `HostEnvironment.platform`, the
  lowercased `__DECENT_HOST__.platform` when it is a string, else null.
- **Test ids** (`testIds.ts`): `careSection`, `careOpen`, `careScreen`,
  `careBack`, `careSegment(routine)`, `careRoutine`, `careStep(id)`,
  `careMoment(id)` (a step's, or a routine's by its id), `careLink(id)`,
  `careVideo`, `carePoster`, `carePlayer`, `careWatch`.

## 8. Testing

- Unit: the guide's data (every routine has steps; ids unique; every moment
  inside the video's 22:33; no step without a how; links only to
  decentespresso.com), `formatMoment`, the two URL builders, the router (the
  care paths both ways, unknown routines, `placeOf`), the host's platform
  reading, `videoPlaysInPlace` for every platform.
- Components: the screen per layout (wide, narrow): the segments switch the
  routine and replace the address; the keyboard moves between them; no
  iframe before a tap; a moment loads the player at its start with autoplay
  and marks itself; another moment moves it; links mode has no poster and
  links with `&t=`; links open a new tab outside Decaid and in place inside
  it; the back arrow goes to Settings. Settings: the section and its button.
  The shell: Settings current on Care, on the tablet and the phone.
- End to end (`e2e/care.spec.ts`, tablet and phone): Settings > Cleaning
  guide opens Care on Daily with Settings current; Weekly from the segments
  (the address follows, a reload keeps it); a moment puts the player in
  place at its time (YouTube answered by a stub page: tests never reach
  Google); inside Decaid on Windows (a faked `__DECENT_HOST__`) the moments
  are links and nothing is framed; Back to Settings. Screenshots for the
  README (`npm run screenshots`) get the Care screen.
- Hardware test plan: on a Decent tablet the player plays in place, its
  sound and full screen; on an iPad with Decaid, a moment opens YouTube at
  its time.

## 9. Out of scope

- Running the cycles and the cleaning profile from CafAI (the second item).
- Reminders, last-done times and ticks (the third item), and the water's
  hardness.
- Other videos (the descaling and the group head upgrade videos are linked
  from Decent's pages, not here), translations, a transcript.
- The YouTube IFrame API (seeking without reloading): a reload per tap is
  enough and needs no messages across frames.

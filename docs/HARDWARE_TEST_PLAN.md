# First session on a real DE1: test plan

Everything in CafAI so far was verified against mocks built from Decaid's
source; nothing has touched a real machine. This checklist is for the first
session on a DE1 with Decaid. It covers what the owner's answers leave open
(QUESTIONS #1, #4 and #9), every check an answer deferred to the machine
(#3, #7, #8), and what the Decaid alignment of 2026-10-09 and 10 added, the
bag photo, the Visualizer link and DYE2 included (section 12, QUESTIONS #10).
Allow 2 to 2.5 hours and about 14 shots. Sections 13 to 19, added since
(the drinks' views, machine care, sleep and wake, and the gap review's four
items of 2026-10-15), add about an hour and a few shots; a Descale from
streamline (section 19, step 5) takes most of an hour of its own, so run it
only when the machine is due one. Section 20 (the screensavers) adds about
an hour, most of it leaving the tablet alone.

For each step, write what you saw in the results table at the end (pass,
fail, or a note). The saved JSON files and log excerpts matter as much as the
ticks: they decide the next changes.

## 0. Before you start

- **Machine and tablet.** The DE1 with Decaid on its tablet, a Bluetooth
  scale paired in Decaid, your grinder, coffee for about 10 shots.
- **A computer on the same Wi-Fi** with a desktop browser. Below,
  `<tablet>` is the tablet's IP address (Decaid's settings show it).
- **CafAI.** On the computer, from this repo's `main`: `npm ci` and
  `npm run release:zip`, then install `release/cafai-<version>.zip` as the
  README says (Skins -> + -> ZIP file, or
  `POST http://<tablet>:8080/api/v1/webui/skins/install/url`).
- **The Anthropic key, checked first (5 minutes, no machine needed).** On the
  computer: `ANTHROPIC_API_KEY=<your key> npm run test:live`. It runs
  CafAI's own client, prompt and tools against the real API on the default
  model (`claude-opus-5-5`); `LIVE_ALL_MODELS=1` also checks every model in
  the Settings picker. A failure here is an API problem, not a machine one.
- **CafAI against the tablet's Decaid, before anything else touches the
  tablet (5 minutes, read-only; D104).** On the computer, from this repo:
  `DECAID_URL=http://<tablet>:8080 npm run test:decaid` (in PowerShell:
  `$env:DECAID_URL = 'http://<tablet>:8080'; npm run test:decaid`). Through
  CafAI's own client and parsers it reads the routes CafAI relies on and
  five seconds of every socket it opens, and checks each reply against the
  Decaid CafAI was verified with (v0.8.8). It writes nothing. Never add
  `DECAID_WRITE` or `DECAID_SIM` here: they are for Decaid's simulator, and
  they refuse to run with a real machine connected. Expected: every check
  passes (the write and shot suites show as skipped). A failure names the
  route or channel and the field: save the whole output, it says what this
  Decaid sends that CafAI did not expect.
- **Record the versions:** Decaid (`http://<tablet>:8080/api/v1/info`),
  DE1 model and firmware (`/api/v1/machine/info`), the tablet model, and
  CafAI's Settings > About line ("Decaid ... (CafAI was verified with
  0.8.8)").
- **Useful URLs** (open them in the computer's browser):
  `/api/v1/workflow`, `/api/v1/shots?limit=1`, `/api/v1/shots/<id>`,
  `/api/v1/profiles?includeHidden=true`, `/api/v1/webview/logs`, all on
  `http://<tablet>:8080`.
- **A log watcher for profile uploads.** In the computer's browser, open a
  blank tab (`about:blank`), open DevTools, and paste:

  ```js
  const ws = new WebSocket('ws://<tablet>:8080/ws/v1/logs');
  ws.onmessage = (e) => {
    if (/encoding step|headerWrite|frameWrite|mmr write|profile/i.test(e.data)) {
      console.log(new Date().toISOString().slice(11, 23), e.data);
    }
  };
  ```

  Each profile upload shows "encoding step ..." lines, header and frame
  writes, and ends with "mmr write: tankTemp". Keep it open for sections 3
  and 4.

## 1. Start-up and the browser engine (QUESTIONS #4, D58)

1. Select CafAI in Decaid. Expected: the app within a few seconds, no
   warning bar under the top bar.
2. Open `http://<tablet>:8080/api/v1/webview/logs` and find the line
   `[CafAI] engine check: {...}`. Record it. Expected:
   `{"chromium":null,"supported":true,"reason":"probe"}`. Decaid reports the
   WebView's user agent as "Decent", so CafAI cannot read a version; it
   probes for syntax that arrived in Chromium 91 (the desktop Chromium
   91.0.4469.0 with the "Decent" user agent gives exactly this line).
   `"supported":false` means an engine older than 91 (a warning bar shows);
   `null` means the probe could not run.
3. Record the WebView's own version: on the tablet, Android Settings -> Apps
   -> show system apps -> Android System WebView (or Chrome) -> version.
   Expected: 91 or newer.
4. If the warning bar shows: record its text, dismiss it, and carry on; note
   anything below that fails.
5. If CafAI shows "could not start": record the text, tap **Exit to Decaid**
   (it must return to the dashboard) and send the webview log. Stop here.
6. **Exit** (top right) returns to Decaid's dashboard; **Decaid settings**
   opens Decaid's settings page. The page itself never scrolls; each region
   scrolls inside itself.

## 2. Settings: key, grinder, dose (QUESTIONS #3 and #8, D57, D62)

1. CafAI Settings -> paste the API key -> Save.
2. If your grinder is not in Decaid's grinder library, add it there (for
   example on the DYE2 plugin's grinder page) with its real step
   (`settingSmallStep`) or its list of settings (preset).
3. CafAI Settings -> **Grinder from Decaid** -> pick it. Expected: a line
   telling you what CafAI will use ("Decaid lists steps of ..."). Enter the
   grinder's current setting. Save.
4. Set your real dose in Decaid (the workflow's dose, for example in Decaid's
   own dose field) before you create the bag. `/api/v1/workflow` ->
   `context.targetDoseWeight` shows it.

## 3. The first version, and the wait for the machine (QUESTIONS #1, D55, D57)

1. Coach -> **New bag**. The chat opens on "Which coffee is it?": tap
   **Something else** and describe the coffee (picking it from Decaid's
   bean library is section 12, step 10) -> tap a template.
2. Expected: "Loading <Bean> v1 on the machine…", then "Loaded <Bean> v1 on
   the machine.". Record the time between the two (a stopwatch is fine) and,
   in the log watcher, the time from the first "encoding step" line to
   "mmr write: tankTemp". The research estimate is about 1 s; nothing in
   Decaid's source measures it.
3. The stats card's **Profile** line shows "<Bean> v1", marked as this
   bag's. (The card leaves the chat once the chat moves on: tap **Stats**
   above the composer to bring it back.)
4. v1's yield (D57): the chat says where v1 stops, e.g. "Kiambu AA v1 stops
   at 50 g: 2.8 x the 18.0 g dose in Decaid." (with no dose in Decaid, or one
   outside 12-25 g, it says v1 assumes 18 g and asks you to set the real
   dose). `/api/v1/workflow` -> `profile.target_weight` and
   `context.targetYield` equal the template's ratio times your dose
   (Blooming Espresso and D-Flow 2.8x, Londonium and Gentle and Sweet 2x, Rao
   Allongé 5x; at 18 g: 50, 50, 36, 36 and 90 g). In Decaid's profile
   library, "<Bean> v1" sits under the template's bundled profile as its
   parent (D59).
5. Pull the shot with CafAI's **Espresso** button. Expected: it stops at that
   weight (plus the scale's usual overshoot). Write down the yield and why
   the shot ended (`stopReason` in `/api/v1/shots/<id>`): on CafAI's mock and
   on Decaid 0.8.7's simulator, Blooming Espresso v1 ran out of profile at
   42-48 g from 18 g and never reached its 50 g stop (QUESTIONS #3).

## 4. A shot pulled right after Confirm (the QUESTIONS #1 race)

1. Tap a taste option that makes the coach propose a profile change; a
   temperature change is easiest to see ("Sour / sharp" usually does it).
2. Tap **Confirm** and at once tap **Espresso** in CafAI. Expected: the shot
   starts only after the upload (Decaid queues the start behind it), and
   CafAI counts it for the new version. Save `/api/v1/shots?limit=1`, then
   `/api/v1/shots/<id>`: `measurements[*].machine.targetGroupTemperature`
   shows the new temperature from the first pouring sample.
3. With a group-head controller: confirm the next change and press the
   group-head button while "Loading…" still shows. Record what the machine
   did. Expected: the DE1 ignores the press until the upload is complete
   (Decaid documents a firmware latch), or the shot runs the new profile.
   If a shot starts while "Loading…" is still shown, CafAI must say "That
   shot started before the machine finished loading <Bean> vN, so it is not
   part of this dial-in."
4. If the barrier ever fails (no answer within 20 s, or a Bluetooth error),
   the chat says "<Bean> vN is saved, but the machine has not confirmed it."
   with the reason, and the banner offers Retry. Record when and how it
   happened.
5. Offline: disconnect the machine (switch it off, or disconnect it in
   Decaid) and confirm a change. Expected: "Saved … Decaid loads it when the
   machine connects." Reconnect. Expected: "Loaded … on the machine." once
   Decaid's own upload is done.

## 5. Shot fingerprints (optional, 10 minutes; D55 option 2)

For three shots on different versions, save `/api/v1/shots/<id>`. These
files decide whether CafAI can also check, after every shot, that the
recorded per-step targets (pressure, flow, temperature) match the version it
credits. Nothing to judge on the spot: send the files.

## 6. Gentle and Sweet (QUESTIONS #9, D63)

1. `/api/v1/profiles?includeHidden=true`: the visible default whose
   `metadata.filename` is `Gentle_and_sweet1.json` has the id
   `profile:1baa29bd9d9dc6d47f2a`. Record any hidden
   `profile:8641f24a939ba6df163f` (an older, stale import).
2. New bag (a medium or dark coffee) -> pick **Gentle and Sweet** -> pull one
   shot with the scale (at an 18 g dose v1 stops at 36 g).
3. Expected, from Decaid's own reference shot of this profile:

   | Time | Step | What happens |
   |---|---|---|
   | 0 to about 4.5 s | 0-1, fill | about 7.5-7.9 ml/s; pressure 2-2.6 bar, then climbing; the step ends past 4 bar |
   | about 4.5 to 7.5 s | 2, rise | about 5.8 bar by 6 s, 6.0 by 6.5 s; flow drops from about 7.9 to 2 ml/s; first drips near 6 s |
   | 7.5 to about 20.5 s | 3, hold | flat 6.0 bar (within 0.2); flow about 0.9-2 ml/s (reaching the 4 ml/s cap would mean channeling or a coarse grind) |
   | from about 20.5 s | 4, decline | the target falls slowly from 6 bar; stop at weight around 24 s, about 36 g in the cup |

   The curve will not reach 4 bar: that takes the whole 30 s decline.
4. **The check that matters:** in the saved shot, every
   `measurements[*].machine.targetGroupTemperature` is 88. The stale frames
   would drop to 78.5 °C after about 4.5 s and to 67 °C in the decline. The
   pressure and flow curves of the two versions are the same, so the curve
   alone proves nothing.

## 7. Feedback in Decaid and Visualizer (QUESTIONS #7, D61)

1. After a bag's first shot, tap a taste option, then a word under
   "Compared with ...?" on the shot card (D126).
2. `/api/v1/shots/<id>`: `annotations.espressoNotes` has CafAI's line,
   `annotations.enjoyment` is 5, the middle for a bag's first rated shot
   (50 on a Decaid that keeps 0-100: section 12, step 1), and
   `annotations.extras.cafai` is there, with the word (`verdict`) and what
   the shot was compared with (`comparedWith`).
3. Write a note of your own on a shot in Decaid, then answer the taste
   question for that shot in CafAI. Expected: your note stays and CafAI's
   line is added below it.
4. If Visualizer is set up in Decaid: the shot there shows the notes and an
   enjoyment of 50 (Decaid uploads about 5 s after the shot and pushes later
   edits).

## 8. Grind moves (QUESTIONS #8, D62)

1. Answer so the coach proposes a grind move (a taste it does not
   recognise, e.g. "Other: runs too fast and thin").
2. The change card names the new setting and that the step came from
   Decaid, e.g. "Grind 1 step finer: 15 -> 14.5" and "Set the grinder to 14.5
   before the next shot (Decaid lists 0.5 steps for your Niche Zero)."
   **Check the direction on your grinder:** is the new setting finer? CafAI
   assumes lower numbers are finer and that a preset list runs finest first.
   Record yes or no.
3. Confirm. Settings shows the new setting; `/api/v1/workflow` ->
   `context.grinderSetting` has it, and the next shot's record carries it.

## 9. A lost shot, and retries (D64, D65, D204-D207)

1. During a shot, switch the machine off (or take it out of range).
   Expected: "Looking for that shot in Decaid…" with a progress bar for up to
   about 15 s, then a warning that the machine disconnected during that
   shot, with Retry. Switch the machine on and tap Retry: the progress shows
   again, and the warning after it still says the machine disconnected
   (D205). Note whether Decaid saved the shot (the newest entry in
   `/api/v1/shots`): the simulator's Decaid saves none for a shot cut off by
   a disconnect.
2. Optional: restart Decaid while CafAI is open and confirm a grind move
   meanwhile. Expected: within about 3 s "Can't reach Decaid. Trying
   again…", with the starts, Sleep or Wake and Tare greyed until Decaid is
   back, and Stop still live while a drink runs (D206, D207). Once
   Decaid is back the alert goes, and `/api/v1/workflow` ->
   `context.grinderSetting` has the new setting within about 30 s.
3. Tap Espresso, then Stop (it takes Espresso's place in the top bar)
   within half a second (still preheating). Expected (D204): no
   "Looking for that shot in Decaid…" and no warning; one line in the chat,
   "That shot stopped before it poured: nothing to taste.", and the coach
   back at once; no card and no "How did it taste?", and the next shot's
   card compares with the shot before this one. Note whether Decaid saves a
   shot for it (the newest entry in `/api/v1/shots`): the simulator's Decaid
   saves none for a stop in preheat, and one for a stop later on. A stop in
   the pour's first 2 s gets the same line; once the pump has run, record how
   many seconds into the pour you stopped and what CafAI showed.

## 10. The stats card's profile line (D66)

Load another profile from Decaid's own screens or another skin, then return
to CafAI. Expected: within 30 s the stats card's Profile line (tap **Stats**
if the card is not at the end of the chat) shows that title, not marked as
this bag's, and the banner offers Retry to load the bag's version.

## 11. The shot takes the screen, the machine row, the stats card, and the look (D82, D84-D86, D90-D92)

1. **Shot focus.** On the coach, tap **Espresso** in the top bar (or start
   the shot from the group head on a GHC machine). Expected: Espresso turns
   into a red **Stop** in the same place and the other buttons grey out (on
   a GHC machine the row, empty before, shows Stop alone); within a
   second the screen under the top bar becomes the big graph with "I'm
   watching this shot..." under it, and the top bar stays exactly where it
   was. After the pour, "Done. Reading the shot" shows, and the coach comes
   back by itself when the shot's card arrives (or about 8 s after the
   pour).
2. **Stop from the top bar.** Pull a shot from the coach and tap **Stop**
   the moment the screen has switched to the graph by itself: the pump must
   stop on that first tap (the tap guard covers only the screen under the
   bar, never Stop). Pull another and tap Stop mid-pour, about 10 s in: the
   same, at once. Once the machine is idle again, the four buttons come
   back after about a second.
3. **Typing keeps the coach.** Start typing to the coach, then start a shot
   from the group head. Expected: the coach stays on screen; the top bar's
   Shot item shows the live dot and the running time, and the row shows
   Stop; tapping Shot opens the graph.
4. **The stats card, live.** Reload CafAI (Exit, then select CafAI in
   Decaid again). Expected: the chat ends with the **Machine** card: "DE1"
   and "Scale" beside green dots, the state ("Ready"), and Group (with its
   target), Steam, Water and Scale. Wake the machine from sleep, or run a
   flush, and watch the card for a minute without touching anything: Group
   and Steam move as the machine heats. Put a cup on the scale: Scale
   follows it, and **Tare** zeroes it. **Sleep** puts the machine to sleep
   and the top bar's row shows Wake alone; wake it from there. Then send the
   coach a message: the card goes. Tap **Stats** above the composer: the
   card comes back at the end of the chat, still live, and the coach does
   not answer.
5. **The machine switched off.** With CafAI open on the coach, switch the
   machine off (or disconnect it in Decaid). Expected: a slim alert under
   the top bar says "Not connected. Wake the DE1 and tap Connect DE1, or
   pair it in Decaid's settings." with **Connect DE1** (record how long
   after switching off it appeared: CafAI waits 1 s once Decaid reports the
   machine gone; section 12, step 2 tries the button). If Decaid reports
   the disconnect as an error of its own, its words show there first, with
   a close button: record them, close them, and the "Not connected" line
   follows. The row's buttons grey out, and the card (tap Stats) says "No
   machine" and "Not connected", with dashes for the readings. Switch the
   machine on: the alert goes once it reconnects, and the buttons come
   back.
6. **Appearance.** Settings > Appearance: choose Light, then Matcha. Every
   screen changes at once and stays changed after Exit and back. Note
   whether the tablet's own dark mode reaches CafAI: set the tablet to dark
   mode, choose Auto, and note whether CafAI turns dark (it shows light if
   Decaid's WebView never reports the preference).
7. **Native controls.** In Light, open the bag picker: its list should be
   light too.
8. **A phone on the network (optional).** Open `http://<tablet-ip>:3000` on
   a phone. Expected: the phone layout (tabs at the bottom, the machine row
   as icons in the top bar), the bags there after a moment, and the API key
   asked for again (each browser keeps its own). Pull a shot from the
   tablet: the phone's Coach tab shows the live strip, and its Shot tab the
   running time.

## 12. Decaid alignment: the rating scale, Connect, gateway mode, drink settings, Next step, Heating, the keyboard, the bag photo, Visualizer, DYE2 (D98, D101, D111-D122)

1. **The rating scale (QUESTIONS #10, D101).** Before the first rating of
   a session, CafAI asks the tablet's Decaid which rating scale it keeps.
   Rate two shots of one bag (D126): the first with any word (a bag's first
   rated shot is the middle, 5), the second **Much better**, then open
   `/api/v1/shots/<the second id>`:
   `annotations.enjoyment` is 7 on a Decaid that keeps 0-10, and 70 on one
   that keeps 0-100 (Decaid 0.8.6 field builds). Record which, with the
   Decaid version. Expected: no notice in the chat that starts "Decaid
   would not save the rating" (that would mean the scale was read wrong), and
   no "enjoyment probe" line in Settings > About (that would mean this
   Decaid answered in a way CafAI cannot read; copy the report).
2. **Connect and the scale (D111).**
   1. With CafAI on the coach, switch the DE1 off. Expected: about a second
      later the alert "Not connected. Wake the DE1 and tap Connect DE1, or
      pair it in Decaid's settings." with **Connect DE1** (and **Connect
      scale** if the scale went too).
   2. Switch the DE1 on and tap **Connect DE1** at once, before Decaid
      reconnects it by itself (if Decaid is quicker, note it and try again).
      Expected: "Looking for your DE1…" with a spinner, then the alert goes
      and the stats card shows "DE1" with a filled dot. Record how long it
      took, and that the scale's link did not change. If it fails, record
      the sentence that replaces the words.
   3. With the machine awake, switch the scale off. Expected: about 3 s
      later, "The scale is not connected. Switch it on and tap Connect
      scale, or pair it in Decaid's settings." with **Connect scale**.
      Switch the scale on and tap it: the scale connects, the DE1 stays
      connected, and the alert goes.
   4. The scale coming back by itself: put the machine to sleep, switch the
      scale off, wake the machine from CafAI, and switch the scale on right
      away. About 5 s after the wake CafAI looks for the scale once, without
      a word (the scale's alert may show before that). Record whether the
      scale came back without a tap, after how long, and whether Decaid got
      it back first.
3. **Gateway mode (D98).** Note the Gateway Mode Decaid's settings show now.
   Set it to **Full**, then come back to CafAI (CafAI reads the setting when
   its page comes back into view and when the machine connects). Expected:
   the alert "Decaid is set to leave stopping shots to the skin, and CafAI
   does not stop them, so shots will not stop at the target weight." with
   **Let Decaid stop shots**. Do not pull a shot in Full: it would run past
   the target. Tap the button. Expected: the alert goes, Decaid's settings
   show Tracking, and `/api/v1/settings` has `"gatewayMode":"tracking"`.
   Pull one shot: it stops at the target weight as before. If Gateway Mode
   was Disabled before, put it back.
4. **Steam, hot water and flush (D114, D124).**
   1. Settings > Steam, hot water and flush: each value matches
      `/api/v1/workflow` (`steamSettings`, `hotWaterData`, `rinseData`). If
      steam is off in Decaid, the steam temperature reads "Off in Decaid",
      without buttons, and cannot be changed.
   2. Flush time: tap the buttons to 5 s. `/api/v1/workflow` ->
      `rinseData.duration` is 5. Tap **Flush** in the top bar: it runs about
      5 s, and while it runs every field in the section is disabled, the
      line under the title saying "Not while the machine is running.", and
      nothing in the section moves.
   3. Steam: raise the temperature by 1 °C and the time by one step (5 s).
      `/api/v1/workflow` has both. Steam once: it stops after that time.
   4. Hot water near the limit: with a jug that holds at least 300 ml on
      the scale, type 250 into the hot water volume and tap elsewhere.
      `hotWaterData.volume` is 250. Tap **Hot water** and record what lands
      in the jug. Then type 300: the field shows 255 and the workflow has
      255. Run it again and record the volume: it must be near 255 ml, never
      about 44 ml, which is what 300 becomes in the DE1's one byte.
   5. Tap into a field and out again without typing: nothing in
      `/api/v1/workflow` changes.
   6. Throughout, the stats card's Profile line still marks the bag's
      version: these writes never touch the profile. Put every value back as
      it was.
5. **Next step on a real shot (D113).** Load a version of **Blooming
   Espresso** (its steps: preinfusion start, preinfusion, pause, ramp, flat
   flow, reset temperature) and pull a shot from CafAI. Expected: once the
   shot is past the preheat, **Next step** at the end of the coach's note
   row under the graph. During "Preinfusion", tap it once: within about a
   second the step in the Shot view's header moves to "Pause", and the pump
   stops for the bloom. During "Pause", tap it twice quickly: the header
   moves one step only, to "Ramp". On the last step ("Reset temperature")
   Next step is gone. Record how long each step took to change after the
   tap. This shot is not a fair one: answer its taste question with Other,
   "test shot, steps skipped".
6. **Heating and the countdown after a wake (D112).** Check
   `/api/v1/plugins`: record whether `time-to-ready.reaplugin` is there with
   `"loaded": true`. Let the machine sleep at least 20 minutes, so the group
   cools. Wake it from CafAI and watch the stats card (tap **Stats** if it
   is not at the end of the chat). Expected: the state line says "Heating",
   never "Ready", until the machine is warm. With the plugin loaded, once it
   has an estimate, "Ready in about N min" at the end of that line, going
   down by the minute, then "Ready in under a minute", then gone when the
   state line says "Ready". Record the first estimate, the time from the
   wake to "Ready", and whether Group had reached its target then. Without
   the plugin, "Heating" shows with no minutes.
7. **The soft keyboard over the composer (spec 5.17).** On the tablet, tap
   the composer at the bottom of the chat. Expected: the keyboard opens and
   the composer, with what you type, stays in view above it; the top bar
   keeps its place; the chat above can still be scrolled. Close the
   keyboard: the layout is back as it was. Repeat in Settings with the API
   key field and a drink settings field near the bottom of the screen. If
   the keyboard covers the field you type in, photograph it and note it:
   CafAI does not lift its layout for the keyboard, and streamline does (it
   lifts its whole canvas by the focused field's overlap with the keyboard,
   read from `visualViewport`, b10fabe); that would be the fix.
8. **The bag photo (D120, D122).** Record the Decaid version first: what
   the camera does depends on it.
   1. **On Decaid 0.8.8** (the release CafAI is pinned to): Coach -> **New
      bag** -> **Photo of the bag** on "Which coffee is it?". Decaid 0.8.8
      leaves the file input to its WebView's own file chooser, and nobody
      has seen what that offers on a tablet. Record what opens: the camera
      at once, a chooser that offers the camera and files, or files only
      (then pick a photo of a bag taken earlier with the tablet's camera
      app, if it has one).
   2. Cancel it (Back, or the chooser's cancel). Expected: back on the
      card, nothing new in the chat, and the card still answers: Photo of
      the bag, Something else and the coffees' **Use this** all work.
   3. Take or pick a photo of a real bag, label up, in good light.
      Expected: "Reading the bag…" with a moving bar, then **Check the
      bag's details** with what the label says, and the card shows "Photo
      of the bag" as its answer. Record what it got right and wrong (the
      roast date above all: a best-before date there would be wrong) and
      how long it took. Fix a field and tap **Confirm**. Expected: the
      coach goes on to the starting profiles; if the bag has a roaster,
      "Added to Decaid's beans." follows ("Already in Decaid's beans." for
      a bag the library had with that roast date), and
      `http://<tablet>:8080/api/v1/bean-batches` has the batch with the
      roast date as printed.
   4. Nothing of the photo stays: neither History -> **Export** -> Copy nor
      `http://<tablet>:8080/api/v1/store/cafai?full=1` holds image data
      (no long run of base64 letters, no `/9j/`, which is how a JPEG starts
      in base64).
   5. **On the first Decaid release after 0.8.8 with camera access for
      skins** (Decaid's `main` has it at `af4e995`): install CafAI from its
      zip, as section 0 says (Decaid gives no camera to a skin served with
      `--skin-path`). Tap **Photo of the bag**. Expected: before the camera
      opens, Decaid's own dialog, "Camera access", 'Allow "CafAI" to receive
      images from your camera?', with Deny and Allow; after the first Allow,
      Android may ask for the camera permission once. Tap **Allow**: the
      camera opens, and the photo goes on as in step 3. On the next new bag,
      tap Photo of the bag again: Decaid asks again (it confirms every photo
      taken through a file input, whatever was answered before). Tap
      **Deny**: no camera, and the card stays as it was, with nothing in the
      chat (CafAI receives no file). Leaving the dialog alone for 30 s counts
      as Deny. Record the dialog's words and both outcomes. (The Ask, Allow
      or Deny choice in Decaid's skin selector is for live camera, which
      CafAI never asks for.)
9. **On Visualizer after a real upload (D121).** Needs Decaid's Visualizer
   plugin loaded (`/api/v1/plugins`: `visualizer.reaplugin` with
   `"loaded": true`) and set up with your Visualizer account to upload
   shots. Pull a shot from CafAI. Expected: a few seconds after the shot's
   card reaches the chat, **On Visualizer** under its curves, above
   "Compared with ...?" (CafAI looks every 3 s for 30 s). Tap it: Decaid
   opens the page in the system browser, and it is this shot (the same time
   and weight).
   History -> the bag -> that shot's row has the same link. Record how long
   after the card the link came, or that it never did, and then save
   `/api/v1/store/visualizer.reaplugin/lastUploadedShot` and
   `/api/v1/store/visualizer.reaplugin/lastVisualizerId`, which say what
   the plugin last uploaded.
10. **A coffee DYE2 has seen (D115-D119).** Needs DYE2 loaded and a coffee
    in Decaid's bean library that DYE2 has recorded shots for (a bean with
    a batch whose roast date is set; DYE2's own pages add both). Coach ->
    **New bag**. Expected: "Which coffee is it?" shows from its top,
    "Looking in Decaid's beans…" for a moment, then the library's newest
    roasts (at most 8), each with its roaster and "Roasted <date>"; each
    date is the one DYE2 shows, not a day earlier. Tap **Use this** on the
    coffee DYE2 has seen. Expected: no question about the bag; the coach
    says how old the coffee is (less the days frozen, if the batch records
    them), goes to the starting profiles, and may mention what DYE2
    recorded (the profile, grind or dose you used). If it does not, ask it
    "What did I use for this coffee before?": it should answer from DYE2's
    setups and say whether they were for this roast or an earlier one.
    Record whether what it says matches DYE2's own record. After v1 loads,
    `/api/v1/workflow` -> `context.beanBatchId` is that batch, and
    `coffeeName` and `coffeeRoaster` are the bean's.

## 13. Steam, hot water and flush views (D146-D150, D217-D219, D221)

Only the mock and Decaid's source say what a DE1 sends while it steams,
pours hot water or flushes; these checks say what a real one does. Keep the
traffic log on (Settings > Log) and share it after the section.

1. **Steam from the top bar.** Pitcher under the wand, Steam. Expected: the
   screen becomes the steam view by itself, Steam's place in the top bar is
   Stop, the header says "Heating" (if the heater warms first) then
   "Steaming", the dial counts toward the steam time set ("of 50 s") and its
   scene moves; Steam (°C), Pressure and Flow move. Let it time out. Expected:
   "Purging" while the wand purges, then "Done", the loops still, the
   settings live, **Go back**. Record: the substates the log shows in order
   (`steam/…`), whether Pressure and Flow read anything while steaming, the
   dial's time at the end against the time set, and how long the purge took.
2. **Steam stopped early.** Steam, then Stop in the top bar after about 10 s.
   Expected: Stop works on the first tap; the dial stops near 10 s; Done.
3. **Steam from the group head** (a machine with a GHC). Start steam on the
   machine. Expected: the view takes the screen as in 1.
4. **Hot water, with the scale and a cup on it.** Hot water. Expected: the
   hot water view; the water fills the dial toward the volume set; Scale
   counts up from about 0 (if Decaid's stop at weight is on, it tares the
   scale first); it stops by itself. Record the dial's millilitres, the
   scale's grams and the cup's real weight of water, which say how close the
   machine's flow measure is.
5. **Flush.** Flush. Expected: the flush view; the dial counts toward the
   flush time; Water, Flow and Group move; Done. Record the dial's time
   against the flush time set.
6. **Typing keeps the screen.** Settings, tap in the API key field, start a
   flush on the machine. Expected: Settings stays.
7. **Go back.** Start hot water from Settings (not typing), then Go back once
   it is done, before its countdown ends. Expected: Settings again; after 1,
   Go back returns to the coach.
8. **Going back by itself.** Start hot water from Settings and leave it.
   Expected: once it is done, Go back counts down from 10 s, its fill
   draining, and Settings comes back by itself. Again, and tap **Stay**:
   the view stays, with Go back. Then turn Hot water's **Go back by itself**
   off in Settings > Drink screens, run it again: the view stays.
9. **The scenes on the tablet.** For each drink, pick each of its scenes in
   Settings > Drink screens and run the drink once (a blind basket for the
   flush, a pitcher for steam). Expected: the scene moves smoothly the whole
   run, nothing crosses the number, steam's milk warms as it steams, the
   flush's water warms as the group heats; under Android's Remove
   animations, the scene holds still and still fills. Record any scene
   that stutters, and how the tablet felt (warm, laggy) after a long
   steam.

## 14. Machine care: the cleaning guide's video (D152-D155)

The guide's words need nothing but CafAI; its video is the part only a
device can settle. Decaid 0.8.8 for Windows would not frame YouTube's
player (D154): on Android it should play in place, because Android's
WebView never asks Decaid about a frame's loads. These checks say whether
it does.

1. **Open it.** Settings > Machine care > **Cleaning guide**. Expected: the
   Care screen on Daily, the Settings place lit, a poster with a play button
   beside the steps, and nothing from YouTube yet.
2. **A moment, on a Decent tablet in Decaid.** Tap **1:48** beside Flush the
   group head. Expected: YouTube's player plays in place from 1:48, with
   sound, and Decaid opens no browser. Record what happens if the frame
   stays empty, shows an error, or a browser opens.
3. **Another moment.** Tap **0:20** at the top of Daily. Expected: the
   player starts again there, and 0:20 is marked instead of 1:48.
4. **Full screen.** The player's own full screen button. Record: does it
   fill the screen, and does Back (or the button again) return to CafAI?
5. **Offline.** Turn the tablet's Wi-Fi off and open Care. Expected: every
   routine's steps show in full; a tap on a moment shows YouTube's own error
   inside the frame.
6. **An iPad or a Mac with Decaid** (if you have one). Open Care. Expected:
   no poster; tapping **16:56** under Monthly opens YouTube at 16:56 in
   Safari or the YouTube app, and CafAI stays where it was.
7. **Flush while the video plays** (D156). On Daily, tap **1:48**, then
   Flush in the top bar with a blind basket in. Expected: Care and the video
   stay on screen, Flush's place is Stop while it runs, and the flush ends
   by itself. Then leave Care, come back, and Flush again without opening
   the video. Expected: the flush view takes the screen, and **Go back**
   returns to Machine care.

## 15. Sleep and wake: Decaid's idle sleep and wake times (D157-D160, D209)

Settings > Sleep and wake only edits what Decaid keeps; Decaid does the
sleeping and the waking. The mock and the simulator show the settings
travel; only a real DE1 shows Decaid acting on them. Have a few quiet
minutes, and put every setting back after.

1. **Open it.** Settings > Sleep and wake. Expected: what Decaid's own
   Sleep & Wake page shows (Decaid settings, the "opens elsewhere" button):
   Sleep when idle on with Decaid's minutes, or off where Decaid's minutes
   are 0 or its switch is off; Decaid's wake times, earliest first.
2. **The idle sleep.** Set Sleep after to 5 min, then leave the machine and
   CafAI alone. Expected: the DE1 sleeps about 5 minutes after the last tap
   or drink. Record how long it took.
3. **A wake time.** With the DE1 asleep, add a wake time 3 minutes ahead,
   every day, After waking: Stay awake for 30 min. Expected: within 30
   seconds of that minute the DE1 wakes and heats. Record what CafAI's top
   bar and the stats card show while it does, and how long it takes to be
   ready. Also save `/api/v1/machine/state` every few seconds while it
   warms: Decaid's simulator wakes a machine as `schedIdle`, and CafAI shows
   Heating only for `idle` and `preparingForShot`, so a DE1 that warms in
   `schedIdle` would read "Ready" with a cold group (the simulator pre-run
   of 2026-10-16).
4. **The window.** Still at 5 minutes, leave it alone after that wake.
   Expected: Settings says "A wake time keeps the machine awake until …",
   the DE1 stays awake past 5 minutes, and sleeps within 5 minutes of the
   window's end.
5. **Decaid's own page.** Turn Sleep when idle off in CafAI, then open
   Decaid's Sleep & Wake page. Expected: its switch on, Sleep 0, and the
   wake time listed; the DE1 no longer sleeps by itself.
6. **The tablet's screen off.** Add a wake time 3 minutes ahead, then turn
   the tablet's screen off (Decaid left open). Record: does the DE1 wake?
   (Decaid acts on the schedule only while it runs.)
7. **Delete.** Delete the test wake times and set the minutes back.
   Expected: Decaid's page shows them gone, and if a window was still
   running, CafAI's "keeps the machine awake until" line goes at once
   (D209).

## 16. TDS and EY on the shot card (D162-D170)

A refractometer reading typed on a shot's card goes to Decaid's record and
to the coach. The mock shows the field and the coach; only the tablet shows
its keyboard, and only a real upload shows Visualizer taking the numbers.
Without a refractometer, type a made-up reading (9.25).

1. **The field.** Pull a shot. On its card, tap **TDS · Add**. Expected:
   the keyboard opens with digits and a decimal point (a comma on some
   locales), and the field stays in view above it.
2. **A reading.** Type it the way the keyboard offers ("9,25" or "9.25")
   and tap the keyboard's Done. Expected: the card shows TDS 9.25 % and an
   EY of TDS × the card's yield ÷ its dose. Record both.
3. **The coach.** Answer the taste. Expected: the coach's reply uses the
   reading as a measurement, and names no taste for it.
4. **Decaid's record.** In Decaid's shot history, or
   `GET /api/v1/shots/{id}`: `drinkTds` 9.25 and `drinkEy` as on the card.
5. **Visualizer.** With Decaid's Visualizer plugin set up, once with the
   reading typed a minute after the shot (after the upload) and once before
   the upload. Expected: visualizer.coffee shows the TDS and EY both times.
   Record which went through.
6. **Change and remove.** Change the reading, then Remove it. Expected:
   Decaid's record follows, both fields gone after Remove, and so does
   Visualizer.
7. **Offline.** With Decaid out of reach (on a phone, Wi-Fi off), save a
   reading. Expected: it reaches Decaid once Decaid is back.

## 17. °F (D171-D177)

Settings > Appearance > Temperatures shows °F; Decaid and the profiles keep
°C. Set it to °F for this section, and back to °C at its end.

1. **Readouts.** Expected: the stats card's Group and Steam read °F and
   follow the machine live; Group's target is the profile's in °F (93 °C
   reads "target 199.4").
2. **Steppers.** Settings > Steam, hot water and flush: set the steam
   temperature to 300 °F. Expected: Decaid's own steam screen shows 149 °C
   and the DE1 steams at it; a reload of CafAI still reads 300 °F. Tap More
   once: 302 °F, and 150 °C in Decaid. The same for hot water (167 °F is
   75 °C) and the flush (194 °F is 90 °C). Put the three back after.
3. **The drinks' views.** Steam, pour hot water, then flush from the top
   bar. Expected: each view's temperature reads °F.
4. **The coach.** With the real coach (an API key or CafAI Bridge), answer
   "Sour / sharp". Expected: a change card in °F ("+1.8 °F") and the
   coach's words in °F, never "33.8 °F hotter". Then type "try 200 °F":
   the proposal is 93.5 °C, shown as 200.3 °F.
5. **Back to °C.** Expected: every screen, the chat and History read °C
   again.

## 18. Overlaid shot curves (D178-D182, D208)

A shot's card and the Shot view draw the shot the card asks about faintly
under this one. The mock shows where and what; only the tablet shows
whether the band reads in daylight and whether a slow tablet keeps up. Look
in dark and in light.

1. **The card.** Pull two shots of one bag, the second a step finer.
   Expected: the second card shows the first as a pale band under its
   lines; at arm's length, in daylight, the band is seen and the line on it
   stays readable.
2. **While it pulls.** Pull a third shot and watch the Shot view. Expected:
   the second shot's band is under the live curves from the start, the line
   over the plot names it with its time and yield, and the live graph does
   not stutter (the timer keeps time, the curves keep up).
3. **Another coffee.** Start a new bag and pull its first shot. Expected:
   once its card is in, the card and the Shot view draw the last shot of
   the other bag, named by its coffee. On the tablet a name longer than
   "Last shot of Santos" takes its own line under the curves and reads
   whole (D208).
4. **A deleted shot.** In Decaid's own shot history, delete a shot a card
   compares with, then reload CafAI. Expected: the card draws its own shot
   alone, with no message.

## 19. Care reminders (D183-D191)

Each care step beyond Daily keeps its last time, counted from Decaid's shot
and steam totals, and the stats card says when one is due. The mock counts
its own records; only a real Decaid shows which of its records a steam, a
cleaning cycle or a flush leaves. CafAI open on the tablet, and a phone or a
laptop on the same network for steps 4 and 5. Put any setting back after.

1. **Counting from the first look.** A fresh CafAI, or Settings > Machine
   care untouched: open Machine care > Cleaning guide > Weekly. Expected:
   each step says "Not marked done yet", counting from today; nothing on
   the stats card.
2. **A shot counts.** Pull a shot, wait 10 s, open Weekly again. Expected:
   the detergent clean counts 1 shot since today. Record how long after the
   shot ended the count changed.
3. **A steam counts.** Steam (water in a jug is fine), wait 10 s, open
   Weekly. Expected: Rinza counts 1 steam. Record whether Decaid's
   `GET /api/v1/steams/ids` lists it.
4. **Streamline's Clean, seen.** With CafAI open on the phone, run Clean
   from streamline on the tablet (blind basket in, detergent). Expected: on
   the phone, within a minute of the cycle's end, Weekly's detergent clean
   says "Done today" with "CafAI saw the machine's Clean". Record how long
   the cycle ran and what CafAI's top bar showed meanwhile.
5. **Streamline's Descale, seen** (only when the machine is due one; it
   takes most of an hour). As in step 4, with Descale. Expected: the
   descale step says "Done today". Record each state and substate the log
   shows.
6. **Forward Flush x5.** Run Decent's Cleaning/Forward Flush x5 from
   streamline with a blind basket and water only, CafAI open on the phone.
   Expected: no new shot in Decaid's shot list; nothing in CafAI's chat (no
   "Looking for that shot in Decaid…", D193); and the detergent clean not
   marked done. The banner "The machine is running "Cleaning/Forward Flush
   x5", not <Bean> vN. Tap Retry to load it." shows before and after the run
   (D70): that is expected, so tap its Retry once the cleaning is done.
   Record what the Shot view shows during the run and after it.
7. **The line.** After a week with shots and no clean (or with the
   tablet's date moved on a week), open the coach. Expected: the stats
   card's line "Weekly clean due: … shots since …", and a tap opens Weekly
   on that step.

## 20. Screensavers (D223-D228, D249-D251)

Once Decaid says the DE1 is asleep and nobody has touched the tablet for a
minute, a screensaver covers CafAI; it dims the screen to 30 and holds it on
through Decaid's display socket for 30 minutes, then turns black and lets
Android's own timeout turn the screen off. The mock and the simulator show
the commands go out; only the tablet shows the dim, the hold, the frame
rate and how each one looks dimmed. Allow about an hour, most of it waiting. For steps 2 to
7, a computer on the same network can read the display:
`curl http://<tablet>:8080/api/v1/display` (`requestedBrightness`,
`wakeLockOverride`). Put the setting back after.

1. **Settings, and each one.** Settings > Screensaver. Expected: on, "A
   different one each day" with today's named under it, the line without
   "Only on the Decent tablet". Pick each of the eight in turn and tap
   **Preview** (a tap closes it). Record for each whether it moves smoothly,
   a little unevenly, or in jerks; with Chrome's remote debugging
   (`chrome://inspect` on the computer, Rendering > Frame rendering stats)
   record its frames a second. Preview must not dim the screen or wake the
   DE1.
2. **Up.** Back on "A different one each day", tap Sleep in the top bar
   and leave the tablet alone. Expected: a minute later the screensaver
   covers everything, the top bar included, and the screen dims;
   `requestedBrightness` 30 and `wakeLockOverride` true. If the tablet is
   on Android's automatic brightness, repeat this in a dark room and record
   whether the "dim" made the screen brighter than it was (QUESTIONS 30).
3. **Held on.** Leave it 10 minutes, past Android's own screen timeout.
   Expected: the screen stays on, dimmed, the screensaver moving.
4. **A tap.** Tap the screensaver where Espresso is in the top bar.
   Expected: the screensaver goes, the DE1 wakes (Wake's spinner, then
   Heating), no shot starts, and the screen is as bright as before:
   `requestedBrightness` back to what it was (100 is Android's own),
   `wakeLockOverride` false.
5. **The 30 minutes.** Sleep the DE1 again and leave the tablet 35 minutes.
   Expected: 30 minutes after it came up the screensaver turns black, then
   the screen goes off by Android's own timeout; record how long after.
   `requestedBrightness` still 30, `wakeLockOverride` false.
6. **The screen on again.** With the DE1 still asleep, turn the screen on
   (the power button). Expected: the screensaver moving again, dimmed and
   held on (`wakeLockOverride` true) for another 30 minutes. Tap: the DE1
   wakes and the brightness comes back.
7. **A reload while dimmed.** Sleep the DE1, wait for the screensaver,
   then turn the screen off with the power button and leave it 11 minutes
   (Android unloads a page after 10 minutes in the background). Turn it on.
   Expected: CafAI starts again at the brightness from before the dim (it
   puts the dim back at start), and a minute later the screensaver is up
   again, dimmed.
8. **The looks, dimmed** (round 2, D249). Let each come up dimmed
   (or Preview each with the brightness turned down to about a third) and
   look from a step back. Expected, and record what is not so:
   - **Bouncing Portafilter**: the portafilter logo glowing in its roast,
     "CafAI" heavy (extra bold, as in Settings' own bold text, not light),
     the colour crossing over at each wall; at a corner, a ring of light and
     a burst of beans.
   - **Espresso Pipes**: offered (not greyed out); gauges and espresso cups
     readable; smooth up to just before the fade, about 40 s in (record the
     frame rate near the fullest), and whether its pace feels busy.
   - **Beanfield**: roasted beans, the dark ones by their rim and glint;
     no stutter in its first seconds.
   - **Rising Steam**: the first picture within about a second, the cup
     crisp as it drifts, the steam readable.
   - **Lava Latte**: the glass, the cream and the glowing bottom read; say
     whether the foam band at the top reads as a lid.
   - **Brew Rain**: the steel screen along the top, coffee symbols falling
     in two layers, a lit word every few seconds, splashes and rings on the
     crema, no empty boxes.
   - **Latte Art**: watch a whole round, about 2 min 40 s: each pour reads
     at a glance as its name under the cup says, edges crisp, no stutter at
     the rosetta's wiggle and pull-through (about 90 and 99 s in; record the
     frames a second there). Name any pour that looks wrong (QUESTIONS 36).
   - **Nightstand**: the date in the tablet's language; the minute's fade
     smooth.
9. **Machine off.** With the screensaver up, switch the DE1 off. Expected:
   the screensaver goes within a few seconds and the brightness comes back;
   the screen then goes off by Android's own timeout, as before CafAI had
   screensavers.

## 21. Where the coach runs, across a Decaid update (D229-D231)

On an iPad each update of Decaid moves the app's data folder, so CafAI comes
up on a new origin with empty browser storage (D231). CafAI keeps where the
coach runs in Decaid's store and puts it back. Do this at the next Decaid
update, on whichever device runs CafAI with Claude on my computer; it costs
nothing until then.

1. **Before.** Settings > Where the coach runs shows Claude on my
   computer, the address and the code, and **Keep the address and code in
   Decaid** on. From the computer:
   `curl http://<tablet>:8080/api/v1/store/cafai-coach-source/current`.
   Expected: the choice, the address and the code. Note CafAI's port:
   the last `Page started loading: http://localhost:<port>/` in
   `curl "http://<tablet>:8080/api/v1/logs?kb=256"`.
2. **The update.** Update Decaid (the App Store or Google Play), open it and
   CafAI. Expected: the coach answers through the bridge without asking for
   a key or a code; Settings shows the address and the code. Record the port
   now (as in step 1): a new one means the update moved CafAI to a new
   origin, which this step was for.
3. **Off.** Turn **Keep the address and code in Decaid** off. Expected:
   the curl in step 1 answers `null`. Turn it on again: the copy is back.

## Results

| Section | Step | Expected | Observed | Pass? |
|---|---|---|---|---|
| 0 | Versions | Decaid, firmware, tablet recorded | | |
| 0 | `test:decaid` | Read-only checks pass against the tablet | | |
| 1 | 2 | `supported: true` | | |
| 1 | 3 | WebView 91+ | | |
| 3 | 2 | Loading -> Loaded, about 1 s; log timing | | |
| 3 | 4 | v1 yield = ratio x dose | | |
| 4 | 2 | Espresso right after Confirm runs the new version | | |
| 4 | 3 | Group-head press during "Loading…" | | |
| 4 | 4 | Offline wording, then Loaded on reconnect | | |
| 6 | 1 | Gentle and Sweet default id `1baa29…` | | |
| 6 | 4 | 88 °C target in every sample | | |
| 7 | 2-3 | Notes, enjoyment 5, your own note kept | | |
| 8 | 2 | Grind direction right for your grinder | | |
| 9 | 1 | Progress, the disconnect warning, Retry, the same warning after it; the shot saved? | | |
| 9 | 2 | Optional: "Can't reach Decaid" within 3 s, every button but Stop held; the grind setting after | | |
| 9 | 3 | A stop in preheat: one line, the coach back, no card, question or search; a shot saved? | | |
| 10 | - | Profile line follows another skin | | |
| 11 | 1 | Shot view by itself, Espresso turns into Stop in place, coach returns | | |
| 11 | 2 | Stop in the top bar works on the first tap, right after the switch and mid-pour | | |
| 11 | 3 | Typing keeps the coach | | |
| 11 | 4 | Stats card live (temperatures move), gone after a message, back on Stats | | |
| 11 | 5 | Machine off: the alert's words; buttons greyed; back on reconnect | | |
| 11 | 6 | Appearance applies; Auto follows the tablet's dark mode? | | |
| 11 | 7 | Bag picker list matches Light | | |
| 11 | 8 | Phone layout over the network (optional) | | |
| 12 | 1 | Much better after a 5 is 7 (0-10) or 70 (0-100); which one | | |
| 12 | 2 | Connect DE1, Connect scale; the scale back after a wake without a tap? | | |
| 12 | 3 | Gateway alert in Full; the button sets Tracking | | |
| 12 | 4 | Drink settings reach Decaid and the machine; 300 ml becomes 255 | | |
| 12 | 5 | Next step moves one step per tap, gone on the last step | | |
| 12 | 6 | Heating after a wake, the countdown, then Ready | | |
| 12 | 7 | Composer in view with the keyboard open | | |
| 12 | 8.1-8.4 | Decaid 0.8.8: what Photo of the bag opens; cancel keeps the card; the label read into the confirm card; nothing of the photo stored | | |
| 12 | 8.5 | Next Decaid: its dialog before every photo; Allow opens the camera, Deny leaves the card as it was | | |
| 12 | 9 | On Visualizer after a real upload; this shot's page; the same link in History | | |
| 12 | 10 | A coffee DYE2 has seen: picked on the card, linked, its age and DYE2's setups used | | |
| 13 | 1 | Steam view by itself; Heating, Steaming, Purging, Done; substates and the purge's length recorded | | |
| 13 | 2 | Stop early: first tap, the dial stops with it | | |
| 13 | 3 | Steam from the group head takes the screen | | |
| 13 | 4 | Hot water: the dial's ml against the scale and the real water | | |
| 13 | 5 | Flush: the dial's time against the flush time | | |
| 13 | 6 | Typing keeps Settings | | |
| 13 | 7 | Go back to Settings, and to the coach | | |
| 13 | 8 | Back to Settings by itself after 10 s; Stay keeps the view; off, it stays | | |
| 13 | 9 | Each scene smooth on the tablet; nothing over the number; the colours warm; still under Remove animations | | |
| 14 | 1 | Care on Daily, Settings lit, the poster, nothing from YouTube | | |
| 14 | 2 | 1:48 plays in place with sound; no browser opens | | |
| 14 | 3 | 0:20 starts it again and takes the mark | | |
| 14 | 4 | Full screen fills the screen; the way back to CafAI | | |
| 14 | 5 | Offline: the steps in full | | |
| 14 | 6 | iPad or Mac: no poster; 16:56 opens YouTube at 16:56 | | |
| 14 | 7 | Flush with the video open keeps Care; without it, the flush view and Go back to Machine care | | |
| 15 | 1 | Sleep when idle and the wake times as Decaid's own page has them | | |
| 15 | 2 | Asleep about 5 min after the last use; how long it took | | |
| 15 | 3 | Woken within 30 s of the minute; what the top bar and stats card show; time to ready; the state and substate while it warms (`schedIdle`?) | | |
| 15 | 4 | Kept awake through the window, asleep within 5 min of its end | | |
| 15 | 5 | Off in CafAI: Decaid's switch on, Sleep 0, the wake time listed | | |
| 15 | 6 | Screen off: does the DE1 still wake? | | |
| 15 | 7 | Deleted from Decaid too; a running window's line gone at once | | |
| 16 | 1 | TDS · Add: the decimal keyboard, the field above it | | |
| 16 | 2 | TDS and EY on the card; EY = TDS × yield ÷ dose | | |
| 16 | 3 | The coach's reply uses the reading, with no taste for it | | |
| 16 | 4 | `drinkTds` and `drinkEy` in Decaid's record | | |
| 16 | 5 | On visualizer.coffee, typed after and before the upload | | |
| 16 | 6 | Changed, then removed: Decaid and Visualizer follow | | |
| 16 | 7 | Saved offline, in Decaid once it is back | | |
| 17 | 1 | Group and Steam in °F, live; the target in °F | | |
| 17 | 2 | 300 °F kept as 149 °C, read back as 300; More gives 302 (150 °C); hot water and flush the same | | |
| 17 | 3 | Each drink's view in °F | | |
| 17 | 4 | Change card "+1.8 °F", the coach in °F; 200 °F proposed as 93.5 °C (200.3 °F) | | |
| 17 | 5 | °C everywhere again | | |
| 18 | 1 | The first shot's band under the second's lines, readable in daylight | | |
| 18 | 2 | The band under the live curves from the start, named; no stutter | | |
| 18 | 3 | A bag's first shot draws the other coffee's last shot, named in full | | |
| 18 | 4 | A shot deleted in Decaid: the card's own shot alone, no message | | |
| 19 | 1 | Weekly: "Not marked done yet" from today; no line on the stats card | | |
| 19 | 2 | A shot counted; how long it took | | |
| 19 | 3 | A steam counted; in `/api/v1/steams/ids`? | | |
| 19 | 4 | Streamline's Clean seen: "Done today"; how long it ran | | |
| 19 | 5 | Streamline's Descale seen; its states and substates | | |
| 19 | 6 | Forward Flush x5: no shot in Decaid, nothing in the chat, the clean not marked, the profile banner's Retry after; what the Shot view showed | | |
| 19 | 7 | The stats card's line when due; a tap opens the step | | |
| 20 | 1 | Settings > Screensaver as described; each of the eight in Preview: smooth? frames a second; no dim, no wake | | |
| 20 | 2 | Up a minute after Sleep, over the top bar; dimmed (`requestedBrightness` 30, `wakeLockOverride` true) | | |
| 20 | 3 | Held on, dimmed, past Android's own timeout | | |
| 20 | 4 | A tap over Espresso wakes the DE1 and starts nothing; the brightness back | | |
| 20 | 5 | Black at 30 minutes, then the screen off; how long after; the dim kept, the lock gone | | |
| 20 | 6 | Screen on again: moving, dimmed and held; a tap wakes the DE1 | | |
| 20 | 7 | After 11 minutes off: CafAI starts at the old brightness; the screensaver back a minute later | | |
| 20 | 8 | Each look reads dimmed; Espresso Pipes and Beanfield smooth; Latte Art's pours read as their names | | |
| 20 | 9 | DE1 switched off: the screensaver goes, the brightness back | | |
| 21 | 1 | The copy in Decaid holds the choice, the address and the code; CafAI's port | | |
| 21 | 2 | After a Decaid update: the coach on the computer, nothing asked; the port before and after | | |
| 21 | 3 | Off: the copy gone; on: back | | |

Send back this table, the saved shot and profile JSON files, the `[CafAI]`
lines from `/api/v1/webview/logs`, the output of `npm run test:decaid`, and,
if Settings > About lists anything Decaid sent that CafAI did not expect,
its report (**Copy report**).

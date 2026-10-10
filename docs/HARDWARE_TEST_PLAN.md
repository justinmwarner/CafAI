# First session on a real DE1: test plan

Everything in CafAI so far was verified against mocks built from Decaid's
source; nothing has touched a real machine. This checklist is for the first
session on a DE1 with Decaid. It covers what the owner's answers leave open
(QUESTIONS #1, #4 and #9), every check an answer deferred to the machine
(#3, #7, #8), and what the Decaid alignment of 2026-10-09 added (section 12,
QUESTIONS #10). Allow 90-120 minutes and about 12 shots.

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

1. Coach -> **New bag** -> describe the coffee -> tap a template.
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

1. After a shot, tap a taste option, then four stars on the shot card.
2. `/api/v1/shots/<id>`: `annotations.espressoNotes` has CafAI's line,
   `annotations.enjoyment` is 8 (80 on a Decaid that keeps 0-100: section
   12, step 1), and `annotations.extras.cafai` is there.
3. Write a note of your own on a shot in Decaid, then answer the taste
   question for that shot in CafAI. Expected: your note stays and CafAI's
   line is added below it.
4. If Visualizer is set up in Decaid: the shot there shows the notes and an
   enjoyment of 80 (Decaid uploads about 5 s after the shot and pushes later
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

## 9. A lost shot, and retries (D64, D65)

1. During a shot, switch the machine off (or take it out of range).
   Expected: "Looking for that shot in Decaid…" with a progress bar for up to
   about 15 s, then a warning with Retry. Switch the machine on and tap Retry:
   the progress shows again.
2. Optional: restart Decaid while CafAI is open and confirm a grind move
   meanwhile. Expected: a notice that Decaid can't be reached; once Decaid is
   back, `/api/v1/workflow` -> `context.grinderSetting` has the new setting
   within about 30 s.
3. Tap Espresso, then Stop (it takes Espresso's place in the top bar)
   within half a second (still preheating). Note whether Decaid saves a
   shot for it (the newest entry in `/api/v1/shots`). CafAI looks for one
   up to 6 times ("Try 6 of 6"), and the browser console logs a 404 for
   each try. If Decaid never saves a shot that never poured, CafAI should
   stop looking for those.

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

## 12. Decaid alignment: the rating scale, Connect, gateway mode, drink settings, Next step, Heating, the keyboard, the camera (D98, D101, D111-D114)

1. **The rating scale (QUESTIONS #10, D101).** Before the first stars of a
   session, CafAI asks the tablet's Decaid which rating scale it keeps.
   After a shot, tap four stars on its card, then open `/api/v1/shots/<id>`:
   `annotations.enjoyment` is 8 on a Decaid that keeps 0-10, and 80 on one
   that keeps 0-100 (Decaid 0.8.6 field builds). Record which, with the
   Decaid version. Expected: no notice in the chat that starts "Decaid
   would not save the stars" (that would mean the scale was read wrong), and
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
4. **Steam, hot water and flush (D114).**
   1. Settings > Steam, hot water and flush: each value matches
      `/api/v1/workflow` (`steamSettings`, `hotWaterData`, `rinseData`). If
      steam is off in Decaid, the steam temperature shows "Off" with "Steam
      is off in Decaid", and cannot be changed.
   2. Flush time: tap the buttons to 5 s. `/api/v1/workflow` ->
      `rinseData.duration` is 5. Tap **Flush** in the top bar: it runs about
      5 s, and while it runs every field in the section is disabled, with
      "Not while the machine is running".
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
8. **Camera consent for the bag photo.** This needs the bag photo, which
   comes with the next build; until then, skip it. Install CafAI from its
   zip, as section 0 says: Decaid ties camera consent to an installed skin,
   and gives none to one served from `--skin-path`. Start a new bag and
   take a photo of the bag. Expected: Decaid asks for your consent before
   the camera opens. Record the prompt's words, and whether Decaid asks
   again for the next photo (its source says each photo taken through a
   file input needs its own confirmation, whatever the stored camera answer
   is). Answer Deny once and record what CafAI shows. Decaid gives up on its
   live-camera prompt after 30 s, which counts as no answer; that answer can
   be changed later in Decaid's skin selector (Ask, Allow or Deny).

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
| 7 | 2-3 | Notes, enjoyment 8, your own note kept | | |
| 8 | 2 | Grind direction right for your grinder | | |
| 9 | 1 | Progress, warning, Retry | | |
| 10 | - | Profile line follows another skin | | |
| 11 | 1 | Shot view by itself, Espresso turns into Stop in place, coach returns | | |
| 11 | 2 | Stop in the top bar works on the first tap, right after the switch and mid-pour | | |
| 11 | 3 | Typing keeps the coach | | |
| 11 | 4 | Stats card live (temperatures move), gone after a message, back on Stats | | |
| 11 | 5 | Machine off: the alert's words; buttons greyed; back on reconnect | | |
| 11 | 6 | Appearance applies; Auto follows the tablet's dark mode? | | |
| 11 | 7 | Bag picker list matches Light | | |
| 11 | 8 | Phone layout over the network (optional) | | |
| 12 | 1 | Four stars are 8 (0-10) or 80 (0-100); which one | | |
| 12 | 2 | Connect DE1, Connect scale; the scale back after a wake without a tap? | | |
| 12 | 3 | Gateway alert in Full; the button sets Tracking | | |
| 12 | 4 | Drink settings reach Decaid and the machine; 300 ml becomes 255 | | |
| 12 | 5 | Next step moves one step per tap, gone on the last step | | |
| 12 | 6 | Heating after a wake, the countdown, then Ready | | |
| 12 | 7 | Composer in view with the keyboard open | | |
| 12 | 8 | Camera consent for the bag photo (next build) | | |

Send back this table, the saved shot and profile JSON files, the `[CafAI]`
lines from `/api/v1/webview/logs`, the output of `npm run test:decaid`, and,
if Settings > About lists anything Decaid sent that CafAI did not expect,
its report (**Copy report**).

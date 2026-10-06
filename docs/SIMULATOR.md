# Test CafAI against Decaid's simulator (Windows)

Decaid can simulate a Decent machine and scale on a computer. CafAI in a
desktop browser then talks to it the way it talks to a tablet: Decaid's real
REST and WebSocket API on port 8080. No machine, no tablet.

**How sure each step is.** Marked at the end of each part:

- *Source*: read in Decaid's code (`decentespresso/decaid` at `a45961b`,
  2026-10-01; paths below are in that repository). Decaid 0.8.7+2847
  (Windows release, commit b6e1d3f0) was run here on 2026-10-05; parts
  marked *Tried* were checked against it.
- *Tried*: run on this computer on 2026-10-05.
- *Not tried*: neither.

## 1. Get Decaid and start it

1. Download `decaid-windows-x64-latest.zip` from
   <https://github.com/decentespresso/decaid/releases/latest> and unzip it
   anywhere, for example `C:\Tools\Decaid`. There is no installer, and the
   zip has no top-level folder: unzip it into its own folder.
2. Start `Decaid.exe`. The Windows build is unsigned, so the first start may
   show an unknown-publisher warning: choose **More info**, then **Run
   anyway**.
3. To skip the first-run screens for good (welcome, account, import), start
   it once from PowerShell with these flags:

   ```powershell
   cd C:\Tools\Decaid
   .\Decaid.exe --bypass-onboarding --no-account
   ```

   `--no-account` also skips the account screen and Decent's credential
   store. Without the flags, skip the account screen ("Link Your Decent
   Account") with **Skip for now** (**Continue offline** when offline), and
   the import screen with **Skip for now**.
4. If Windows asks whether Decaid may use the network, allow private
   networks.

Decaid needs ports 8080 (its API), 3000 (its skin entry, a redirect to the
skin's own port) and 4001 (its API docs) free. With 8080 taken it shows
"Another Decaid app is running" and does not start; with 3000 taken it serves
no skin ("WebUI is not running"). Vite's 5173 is fine.

Closing the window ends Decaid within seconds. 0.8.7 exits with code
0xC000041D but keeps settings, shots and CafAI's backup.

*Source: zip name, `Decaid.exe`, unsigned build (`.github/workflows/release.yml`,
`scripts/create_release_aliases.sh`, `doc/RELEASE.md`); flag
(`lib/src/cli/cli_args.dart`, `lib/main.dart`); screens and ports
(`lib/src/onboarding_feature/`, `lib/src/ui/webserver_port_conflict_app.dart`,
`lib/src/webui_support/webui_service.dart`). Tried (0.8.7): the download
(its sha256 matches the release's SHA256SUMS), the flags, the start and
closing the window. Not seen: Windows' unknown-publisher warning and network
prompt (Decaid was started from a shell).*

## 2. Turn on the simulated machine and scale

Pick one:

- **For this run only:** when Decaid's scan finds no machine (or Bluetooth is
  unavailable), choose **Try Demo Mode**. It connects a simulated machine and
  scale and saves nothing.
- **Kept across restarts:** Settings > Advanced > **Simulated Devices**: turn
  on **Machine** and **Scale** only (**Bengle** adds a second machine, and
  Decaid then asks which one to use). Then scan from the Dashboard (**Scan
  for devices**). Decaid applies the switches at its next scan, but its web
  settings page says to restart, so restart Decaid if the devices do not
  appear.
- **The same from PowerShell** (kept, like the switches; scan or restart
  after it):

  ```powershell
  Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/v1/settings -ContentType 'application/json' -Body '{"simulatedDevices":["machine","scale"]}'
  ```

  Decaid answers `null`, and the devices show as "discovered" until a scan:
  `Invoke-RestMethod http://localhost:8080/api/v1/devices/scan` (about 15 s)
  connects both. After a restart they connect by themselves within about
  20 s.

**Check:** open <http://localhost:8080/api/v1/devices> in a browser. It lists
the simulated machine and scale as connected (the order may differ):

```json
[
  {"name":"MockDe1","id":"MockDe1","state":"connected","type":"machine","available":true},
  {"name":"Mock Scale","id":"MockScale","state":"connected","type":"scale","available":true,"connectionRole":"primary"}
]
```

`"state":"discovered"` means they are found but not connected yet: scan again.

*Source (`lib/src/device_discovery_feature/scan_flow_view.dart`,
`lib/src/settings/advanced_page.dart`, `lib/src/settings/settings_controller.dart`,
`lib/src/services/webserver/settings_handler.dart`,
`lib/src/services/webserver/devices_handler.dart`). Tried (0.8.7): the POST,
the scan and the JSON above.*

## 3. Run CafAI against it

From this repository (after `npm ci`), with Decaid running, pick a coach:

- **The real coach** (spends Anthropic tokens):

  ```powershell
  npm run dev
  ```

  Open <http://localhost:5173> and paste your Anthropic API key in Settings.
  CafAI calls the page's host on port 8080, so it finds the simulator by
  itself.
- **The scripted coach** (no tokens, no real key):

  ```powershell
  npm run dev:sim
  ```

  It opens `/?mockDecaid=0` on a mock-mode server: port 5173, or the next
  free one when `npm run dev` already runs (use the address Vite prints).
  Paste any placeholder key in Settings, such as `sk-ant-sim-placeholder`
  (`sk-ant-invalid` and `sk-ant-overloaded` get a key error and an overload
  on purpose). Only the coach is scripted (it follows
  `docs/briefs/ENGINE_PROTOCOL.md`): Decaid's REST calls and WebSockets are
  the browser's own and reach the real Decaid, so there is no
  `window.__CAFAI_MOCK__` and `?mockPersist` does nothing. Keep `?mockDecaid=0`
  in the address: without it the same server runs the built-in mock Decaid
  instead. `&mockSpeed=20` speeds up only the coach's typing; the
  simulator's shots run in real time.

Close other CafAI tabs first (such as `npm run dev` on localhost:5173). An
open CafAI page joins the simulator as soon as Decaid starts, copies its bags
into the simulator's backup (fresh pages then restore them), and notes every
simulator shot in its own active bag.

Both servers can run at once: mock mode keeps its own Vite cache.

**A leftover `reaHostname`.** If this browser was ever pointed at a tablet,
CafAI still goes there. On the CafAI page, open DevTools (F12) > Console, run
this, then reload:

```js
localStorage.removeItem('reaHostname')
```

Each address (`localhost:5173`, `localhost:5174`) keeps its own storage, so do
it on each one you use.

**Check which Decaid CafAI reached.** The machine panel says "Machine
connected" and "Scale connected", and CafAI's Settings > About shows the
simulator's Decaid version (`Decaid 0.8.7+2847`), not `0.8.6+2801` (the
built-in mock's). Without a Decaid the panel says "Can't reach Decaid".

*Tried: `npm run dev:sim` starts mock mode and asks to open `/?mockDecaid=0`.
A mock-mode page at `/?mockDecaid=0` started with no `window.__CAFAI_MOCK__`,
no service worker and the browser's own WebSocket; its calls to port 8080 went
to the network, and the scripted coach answered a new bag with three template
cards. Decaid was not running for this (the panel said "Can't reach Decaid").
Tried: the full loop against Decaid 0.8.7 (new bag, v1 loaded, a simulator
shot, a taste chip, v2 loaded, notes on the shot), in coach-only and normal
mode.*

## 4. Run CafAI inside Decaid's window

This is the production build: no mocks and no `?mockDecaid`, so the coach is
the real API and needs a real key.

```powershell
npm run release:zip     # builds dist\ and release\cafai-<version>.zip
```

- **Install it:** Dashboard > **Skins** > **+** > **ZIP file**, and pick
  `release\cafai-<version>.zip`. It becomes the default skin; choose **Open**.
- **Or serve the build folder** for one run, without installing it:

  ```powershell
  .\Decaid.exe --skin-path E:\source\cafai\dist
  ```

  Decaid serves the folder as it is, so after `npm run build` a reload shows
  the change. A path that is not a folder falls back to the default skin.

  *Tried: no clicks needed. CafAI's console goes to Decaid's
  `logs\webview_console.log`, labelled with the default skin's id.*

**Tablet size:** Settings > Advanced > turn on **Simulated WebViews**, then
**Simulated Device** > **Teclast P80X** (962×602 @ 1.33x). Decaid resizes its
window and makes the page report the tablet's size, pixel ratio and touch.

**Leaving CafAI:** CafAI's **Exit**, or **Back to Dashboard** in the window's
system menu (the window icon, or right-click the title bar).

**During a shot:** Settings > Advanced > **Gateway Mode** decides what Decaid
does. **Disabled** (the default) opens Decaid's own shot screen in its window,
over CafAI when CafAI runs inside it. (Not seen with the default skin: a shot
started over the API left streamline.js on screen. Not tried with CafAI.)
**Tracking** leaves the skin on screen. Both stop the shot at the target
weight. **Full** does not, and CafAI never stops a shot itself, so do not use
Full.

Decaid shows skins in Microsoft WebView2. If it is missing, Decaid says
"WebView2 Runtime Missing" and offers **Install WebView2**.

*Source (`lib/src/skin_selector/skin_selector_page.dart`,
`lib/src/onboarding_feature/steps/initialization_step.dart`,
`lib/src/skin_feature/simulated_webview_device.dart`,
`lib/src/controllers/de1_state_manager.dart`,
`windows/runner/flutter_window.cpp`, `lib/src/skin_feature/skin_view.dart`).
Tried (0.8.7): `--skin-path` with a production build showed CafAI connected
in Decaid's window (WebView2 is Chromium 154). Not tried: the ZIP install,
the simulated tablet sizes, gateway modes with CafAI.*

## 5. What the simulator can and cannot test

It exercises:

- Decaid's real REST and WebSocket API.
- CafAI's wait for the machine to confirm a profile (the simulator confirms
  at once).
- Espresso that follows the profile on the simulated scale; it stops at the
  target weight only if the cup gets there first (Blooming Espresso v1 ran
  out of steps at 47 g of 50 g, stopReason "machineEnded").
- Saved shots, with CafAI's taste notes and star rating written to them.
- Decaid's grinder library and key-value store: real storage, empty at first.
  CafAI's backup lands in its `cafai` namespace and stays across Decaid
  restarts (`.\Decaid.exe --print-storage-paths` shows where).

It cannot (use instead):

- Grind effects: each shot's puck resistance is a random 0.85 to 1.15 times
  (the same sequence each launch), whatever the grind.
- Shots started on the group head: the simulated machine has no group-head
  controller. Use the built-in mock's `?mockGhc=1`.
- Slow or failed profile uploads: `npm run dev:mock` with `?mockUploadMs=3000`
  or `?mockNoMachineProfile=1`.
- Chromium 91: `npm run smoke:chrome91`.
- A machine or scale that drops: the built-in mock,
  `window.__CAFAI_MOCK__.state.setMachineConnected(false)`.

*Source (`lib/src/models/device/impl/mock_de1/mock_de1.dart`,
`lib/src/models/device/impl/mock_scale/mock_scale.dart`,
`lib/src/controllers/shot_sequencer.dart`,
`lib/src/services/webserver/de1handler.dart`,
`lib/src/services/webserver/shots_handler.dart`,
`lib/src/services/webserver/kv_store_handler.dart`). Not tried.*

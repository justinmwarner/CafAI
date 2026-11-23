# Overhead: discovery (Wave 0)

Everything below was checked on 2026-11-23 with a real request, a live run of
Decaid, or a read of the source at a named commit. Raw responses are in
`fixtures/overhead/`. Where this contradicts the brief, the evidence wins and
[DECISIONS.md](DECISIONS.md) says what changed.

## 1. The host is Decaid, formerly Streamline Bridge

| Check | Evidence |
|---|---|
| Same repository | `git ls-remote https://github.com/tadelv/reaprime HEAD` and `git ls-remote https://github.com/decentespresso/decaid HEAD` both answer `1d74fbf7a5eb3a5ba5208b4147aea136726a4909`. |
| Same product | Decaid `README.md:297`: "**Decaid** (formerly REA → ReaPrime → Streamline Bridge)". Plugins are still `*.reaplugin` directories (`README.md:305`). |
| Version CafAI is pinned to | `contract/decaid/PIN.json`: v0.9.2, commit `875b7a6`. |
| Live run | The v0.9.2 Linux x64 release (`decaid-linux-x64-0.9.2.tar.gz` from the GitHub release) ran headless in this container under Xvfb with `--bypass-onboarding --no-account`, with the simulated machine and scale turned on through `POST /api/v1/settings {"simulatedDevices":["machine","scale"]}`. Its plugin runtime is QuickJS (`bundle/lib/libquickjs_c_bridge_plugin.so`). |

Neither BLOCKED condition holds: the host is Streamline Bridge under its new
name, and plugins can serve HTTP endpoints that a skin can call (section 2).

## 2. How a plugin serves HTTP, and how a skin calls it

Read in Decaid `doc/Plugins.md` ("Serving HTTP Endpoints") and
`lib/src/services/webserver/plugins_handler.dart` at `1d74fbf`, then proven on
the live v0.9.2 with a throwaway probe plugin.

- A manifest `api` entry `{ "id": "<endpoint>", "type": "http" }` exposes
  `ANY /api/v1/plugins/<plugin id>/<endpoint>` (`plugins_handler.dart:144`).
  The plugin needs the `api` permission, or Decaid answers 403.
- Decaid calls the plugin object's `__httpRequestHandler(request)` (or
  `handleHttpRequest`, aliased at load). `request` is
  `{ requestId, endpoint, method, headers, body, query }`; `query` is always an
  object, percent-decoded (live: `?y=a%20b` arrived as `"a b"`).
- The handler returns `{ status, headers, body }` or a promise of one. `body`
  goes straight into shelf's `Response(status, body: ...)`
  (`plugins_handler.dart:425-432`), so it must be a **string**:
  `JSON.stringify` it. A thrown error or rejected promise becomes a 500 with
  `{"error": "..."}` (`plugin_manager.dart` `__sendApiError`). Decaid gives
  the plugin **30 s** to answer (`pluginHttpTimeout`).
- Decaid's own routes win over plugin endpoints with the same name
  (`/api/v1/plugins/:id/settings`, `source`, `enable`, `disable`, `update`), so
  the plugin's endpoints are named `overhead` and `config`.
- **CORS:** every API response, plugin endpoints included, reflects the
  request's `Origin` with `access-control-allow-credentials: true`
  (`shelf_cors_headers`, `webserver_service.dart:832`). Live, from
  `Origin: http://127.0.0.1:3000` (a skin port): `GET` 200 with
  `access-control-allow-origin: http://127.0.0.1:3000`, and the `OPTIONS`
  preflight 200 with `access-control-allow-methods: DELETE,GET,OPTIONS,PATCH,POST,PUT`
  and `content-type` among the allowed headers. So the skin, on port 3000 or
  wherever Decaid serves it, can `fetch` its plugin's endpoint on port 8080
  like any other Decaid route.
- **Events:** `host.emit(name, payload)` reaches
  `ws://<host>:8080/ws/v1/plugins/<plugin id>/<name>` when the manifest
  declares `{ "id": "<name>", "type": "websocket" }`
  (`plugins_handler.dart:143, 299-353`). Each frame is the JSON payload.

### The plugin runtime, measured (live, v0.9.2, QuickJS)

| Fact | Value |
|---|---|
| How the source runs | `plugin.js` is pasted inside a function in Decaid's loader; afterwards `typeof createPlugin` must be `'function'` and `createPlugin(host).id` must equal the manifest id (`plugin_manager.dart` at v0.9.2, lines 2449-2465). |
| One runtime | All plugins share one JS runtime (`doc/Plugins.md`, Security). Nothing may be put on `globalThis`. |
| Settings at load | `onLoad(settings)` received `{}` for a manifest setting with `"default": "abc"` that was never saved: **defaults are not applied**. The plugin applies its own. |
| `fetch` | Present (needs `api`). The response has `status`, `ok`, `headers.get(name)` (case-insensitive), `text()`, `json()`. 30 s timeout, 10 MiB limit (`plugin_manager.dart:175-176`). Live: adsb.fi, hexdb, raw.githubusercontent.com and Decaid's own `http://localhost:8080` all answered through it. |
| Timers | `setTimeout`, `clearTimeout` and `setInterval` exist. |
| Missing | `Intl`, `TextDecoder`, `performance` are `undefined`. ES2020 syntax works (optional chaining, `??`, `Object.fromEntries`, `Array.prototype.flat`, `Promise.allSettled`, `BigInt`). |
| Storage | `host.storage({type:'read'|'write', key, namespace, data})`; the read answer arrives as an `onEvent` `storageRead` with `{key, value}`. A 900,002-character string and a small object both round-tripped; a key never written reads `null`. Storage is not private: `/api/v1/store/<plugin id>/<key>` reads it with no token. |
| Machine events | With `events.machine`, `stateUpdate` arrives with `payload.state.state` (`"idle"` on the simulator). |

### Plugin management needs a token on v0.9.2

At the pinned v0.9.2 (`git show v0.9.2:doc/Plugins.md`, "Plugin Lifecycle
Management"), every management route always needs an `extensions:manage`
bearer token, including `POST /api/v1/plugins/:id/settings`,
`PUT /api/v1/plugins/:id/source` and `POST /api/v1/plugins/:id/enable`. Live,
without a token, `PUT .../source` answered
`401 {"error":"Missing or malformed bearer token"}`. Decaid's `main` has
since added a compatibility mode that is off by default, but CafAI is checked
against v0.9.2. So the skin cannot save the plugin's settings through Decaid's
settings route; it saves them through the plugin's own `config` endpoint
(DECISIONS O3). Installing the plugin is done once from Decaid's Plugins
screen (ZIP file), which needs no token because it runs in-process.

## 3. The rest of what the skin needs from Decaid

| Need | Where | Status |
|---|---|---|
| Machine state, to never show mid-shot | `ws/v1/machine/snapshot`, `state.state`, read by CafAI's telemetry store already (`src/api/telemetry.ts`). The enum (`contract/decaid/spec/rest_v1.yml:7040`): booting, busy, idle, sleeping, heating, preheating, espresso, hotWater, flush, steam, steamRinse, skipStep, cleaning, descaling, calibration, selfTest, airPurge, needsWater, error, fwUpgrade. | Verified in the pinned spec and the live simulator (`/api/v1/machine/state` answered `"state":"idle"`). |
| Screen brightness and wake lock | `ws/v1/display` (`setBrightness`, `requestWakeLock`, `releaseWakeLock`), already used by the existing screensaver through `src/app/saverScreen.ts` (D224, verified on the 0.8.8 simulator). REST `/api/v1/display/brightness` also exists (`rest_v1.yml:5290`) but CafAI's rule 20 keeps it on the socket. | Reused as is. |
| Plugin list and load state | `GET /api/v1/plugins` (no token), already read by `src/api/plugins.ts`. | Reused. |

## 4. Position providers

All three were asked for 25 nm around O'Hare (41.9786, -87.9048) within a
few seconds of each other, from this container, with
`Origin: http://192.168.1.42:3000`.

| Provider | Request | Status | Latency | CORS | Rate-limit headers | Body |
|---|---|---|---|---|---|---|
| airplanes.live | `https://api.airplanes.live/v2/point/41.9786/-87.9048/25` (and `http://`) | **403** | 0.22 s | none | none | `{"error": "Please contact us at contact@airplanes.live. ..."}` from Cloudflare. Same answer through Decaid's plugin `fetch`. `fixtures/overhead/airplaneslive-point-ord-403.json` |
| adsb.fi | `https://opendata.adsb.fi/api/v2/lat/41.9786/lon/-87.9048/dist/25` | 200 | 0.50 s | **none** | none | 57 aircraft, `fixtures/overhead/adsbfi-point-ord.json` |
| adsb.lol | `https://api.adsb.lol/v2/lat/41.9786/lon/-87.9048/dist/25` | 200 | 0.60 s | **none** | `x-ratelimit-limit: 500, 500;w=86400`, `x-ratelimit-remaining: 267`, `x-ratelimit-reset: 38250` | 60 aircraft, `fixtures/overhead/adsblol-point-ord.json` |

- **airplanes.live** could not be verified from here. Its API guide page is
  behind a Cloudflare challenge (403 to curl and to a fetcher). Search results
  quoting that page give the path `/v2/point/[lat]/[lon]/[radius]`, base
  `http://api.airplanes.live/v2/`, radius up to 250 nm, "rate limited to 1
  request per second", "Non-Commercial Use", "Access does not currently
  require a feeder". The 403 is most likely aimed at this container's data
  centre address; a home connection may be served. Its response shape is
  **unverified**, so the plugin does not assume it: it reads a body only if it
  has the shape the two verified providers share (section 5), and anything
  else fails over (DECISIONS O2).
- **adsb.lol's limit is 500 requests a day per IP without a key**, not
  "changes with load": its OpenAPI document (`https://api.adsb.lol/api/openapi.json`,
  `info.description`) says "No key: **500 requests/day per IP**", "Over quota
  returns `429` with a `Retry-After` header", and the daily window is "a fixed
  24h bucket". The headers above match. At one request every 5 s that is gone
  in 42 minutes, so adsb.lol is a last resort that honours
  `x-ratelimit-remaining` (DECISIONS O2). Its data is ODbL.
- No provider sent `Access-Control-Allow-Origin`: the brief's "a browser
  can't call it" holds for all three.
- The radius is an integer for adsb.lol (`minimum 0, maximum 250`, OpenAPI);
  the plugin rounds it.

## 5. The aircraft shape, from the fixtures

Both verified providers send readsb's JSON, with different envelopes:

| Field | adsb.fi | adsb.lol |
|---|---|---|
| Aircraft array | `aircraft` | `ac` |
| `now` | seconds, `1795440148.000` | **milliseconds**, `1795440150002` |
| Count | `resultCount` | `total` |
| Other | `ptime` | `msg: "No error"`, `ctime`, `ptime` |

Fields seen on aircraft (types as found): `hex` (string, lower case),
`type`, `flight` (string, **padded with spaces**, `"UAL2428 "`; absent on 9
of the 57 adsb.fi aircraft), `r` (registration), `t` (ICAO type code),
`desc` (adsb.fi only: `"BOEING 737 MAX 9"`; absent on some), `ownOp` and
`year` (adsb.fi only), `alt_baro` (**number or the string `"ground"`**),
`alt_geom`, `gs` (knots), `track` (degrees; **absent for aircraft on the
ground**), `baro_rate`, `geom_rate`, `squawk`, `emergency`, `category`,
`lat`, `lon`, `seen`, `seen_pos` (seconds since the position; up to 56 s in
the fixture), `dst` and `dir` (distance in nm and bearing from the query
point), `nav_*`, `mag_heading`, `true_heading`, `nic`, `rc`, `version`,
`nac_p`, `nac_v`, `sil`, `sil_type`, `gva`, `sda`, `alert`, `spi`, `mlat`
and `tisb` (arrays), `messages`, `rssi`. The TypeScript type
(`src/overhead/shared/readsb.ts`) declares only what Overhead reads and
treats every field as optional; a test parses every fixture with it.

The fixtures had one `ownOp` that named a private person; it was replaced by
`PRIVATE OWNER (redacted)` before committing (CONTRIBUTING: nothing that names
a person).

## 6. hexdb.io

| Request | Status | Latency | CORS | Body |
|---|---|---|---|---|
| `GET /api/v1/aircraft/8965f4` | 200 | 0.39 s | `*` | `{"ModeS": "8965F4", "Registration": "A6-BNF", "Manufacturer": "Boeing", "ICAOTypeCode": "B789", "Type": "787 9", "RegisteredOwners": "Etihad Airways", "OperatorFlagCode": "ETD"}` |
| `GET /api/v1/aircraft/a12ac7` | **404** | 0.70 s | none | `{"status":"404","error":"Aircraft not found."}` (a United 737 MAX 9 that adsb.fi knows) |
| `GET /api/v1/route/icao/ETD93C` | 200 | 0.53 s | `*` | `{"flight": "ETD93C", "route": "OMAA-KORD", "updatetime": 1747593022}` |
| `GET /api/v1/route/icao/UAL2428` | 200 | 0.46 s | `*` | `{"flight": "UAL2428", "route": "MMSD-KIAH", "updatetime": 1545595432}`: **from December 2018**, and wrong for a flight leaving Chicago westbound |
| `GET /api/v1/route/icao/N442PP` | 404 | 0.67 s | none | `{"status":"404","error":"Route not found."}` |
| `GET /api/v1/airport/icao/KORD` | 200 | 0.28 s | `*` | `{"country_code": "US", "region_name": "Illinois", "iata": "ORD", "icao": "KORD", "airport": "Chicago O'Hare International Airport", "latitude": 41.9786, "longitude": -87.9047}` |
| `GET /api/v1/airport/icao/ZZZZ` | 404 | 0.27 s | none | `{"status":"404","error":"Airport not found."}` |

- A second pass, one request a second, over every airline callsign and a
  dozen addresses in the adsb.fi fixture (`fixtures/overhead/hexdb-batch-ord.json`):
  27 of 40 routes found, and **26 of the 27 last updated between 2017 and
  2021** (only ETD93C's, May 2025, is recent). Several are multi-leg
  round trips: `AAL1002` is `KORD-KDCA-KORD`, `AAL421` `KPHL-KBDL-KPHL`.
  10 of 12 aircraft found; `RegisteredOwners` is often the brand flown for
  ("United Express", "American Eagle") and `Type` a variant ("A320 232",
  "EMB-175 LR"). More airports (`hexdb-airport-*.json`): KPWK (Chicago
  Executive) is not in hexdb (404); names are the airport's
  ("George Bush Intercontinental Airport"), with no city field.
- No rate-limit headers; `cache-control: max-age=14400`. The plugin keeps to
  one request a second as the brief asks.
- Routes carry `updatetime` (Unix seconds). It is kept, so a route older than
  a year can be shown as such, and none is ever treated as authoritative.
- `route` is ICAO codes joined by dashes, two or more. For a multi-leg route
  the plugin picks the leg that touches the home airport, by whether the
  aircraft is heading for it (DECISIONS O5).
- hexdb sends `Access-Control-Allow-Origin: *` on its 200s (not its 404s),
  unlike the brief's assumption; the skin still never calls it.

### adsb.lol's route lookup, evaluated against hexdb

`POST https://api.adsb.lol/api/0/routeset` (free, unmetered, takes
`{planes: [{callsign, lat, lng}]}` per its OpenAPI) answered **201 with an
empty body after 9.0 s** for six callsigns and **201, empty, after 5.5 s** for
one; a first try timed out at 12 s. It is not usable today, so routes come
from hexdb (DECISIONS O5).

## 7. plane-alert-db

`https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/<file>`:

| File | Status | Latency | Size | Rows | CORS | Cache |
|---|---|---|---|---|---|---|
| `plane-alert-civ.csv` | 200 | 0.45 s | 670,194 B | 4,652 | `*` | `max-age=300`, strong `etag` |
| `plane-alert-gov.csv` | 200 | 0.39 s | 266,087 B | 1,768 | `*` | same |
| `plane-alert-db.csv` (all) | 200 | 0.27 s | 2,456,002 B | 17,300 | `*` | same |

The header row of both files, read from the files:

```
$ICAO,$Registration,$Operator,$Type,$ICAO Type,#CMPG,$Tag 1,$#Tag 2,$#Tag 3,Category,$#Link
```

The `$` and `#` are part of the column names (plane-alert's own display
markers), so the plugin maps columns by these exact names. `$ICAO` is upper
case hex (no lower-case rows today; matching is case-insensitive anyway).
`#CMPG` is `Civ` or `Gov` in these two files. `Category` holds plane-alert's
own names ("As Seen on TV", "Flying Doctors", "Dictator Alert", "Oxcart",
...). No row has a quoted field today, but the files are CSV and the plugin
parses them with papaparse. The two files fit the plugin's 10 MiB fetch limit
together (0.9 MB) and its storage (section 2).

A real match in the fixture: `A046E7` (N117HD, "US Helicopters (ABC7
Chicago)", AS-350 Ecureuil, "As Seen on TV") was 5.9 nm from O'Hare in
`adsbfi-point-ord.json`. `fixtures/overhead/plane-alert-{civ,gov}.sample.csv`
keep the header and 14 + 12 real rows, all organisations, that one included.

## 8. Map tiles

| Provider | Facts |
|---|---|
| OpenFreeMap (default, no key) | Styles `liberty`, `bright`, `positron`, `dark`, `fiord` at `https://tiles.openfreemap.org/styles/<name>` (all 200, `access-control-allow-origin: *`). Tiles, glyphs and sprites are on the same host. The vector TileJSON (`/planet`) carries the attribution `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`, which MapLibre's attribution control shows. Terms (`https://openfreemap.org/tos/`, updated 2026-10-14): free, as-is, no key; forbidden: "Collect data from the service in automated ways, except for offline downloads". Overhead only displays tiles. |
| MapTiler (optional key) | Style URL `https://api.maptiler.com/maps/{mapId}/style.json?key=KEY` (MapTiler's API reference, which marks it deprecated). Terms: free plan "limited to non-commercial use"; attribution "© MapTiler" and "© OpenStreetMap contributors", linked, in a corner, and "with Free Account the MapTiler logo" (General Terms 6.1); requests go straight to MapTiler; only a temporary browser cache. Map ids could not be verified without a key (every id, real or not, answers 403 "Invalid key"), so the map id is a setting, defaulting to `dataviz-dark`. |

MapLibre GL JS 6 (checked in `maplibre-gl@6.17.0`'s `dist/` and its 6.0.0
changelog): ESM only, **WebGL 2 required** (`getContext('webgl2')` or an
error event), and its worker is a separate ES2022 file
(`maplibre-gl-worker.mjs`, 520 KB) that uses `static {}` blocks,
`Array.prototype.at` and `Object.hasOwn` (Chromium 94, 92 and 93). CafAI must
load in Chromium 91 and ship one bundle, so the build compiles the worker to
Chromium 91 with core-js polyfills and inlines it, and the map gives way to a
plain backdrop when WebGL 2 is missing (DECISIONS O7).

`react-map-gl@8.1.3` (`@vis.gl/react-maplibre`) supports MapLibre 6: its
`getTransformLike` reads the camera through the getters v6 kept, and it calls
`setTransformCameraUpdate` when present.

## 9. Libraries

Each checked for an existing equivalent in CafAI or Decaid first (none:
CafAI draws its own canvases and has no map, geo or CSV code), and pinned
exactly to a version at least two weeks old, as the repository pins.

| Library | Version | Published | For |
|---|---|---|---|
| `maplibre-gl` | 6.17.0 | 2026-11-07 | The map |
| `react-map-gl` | 8.1.3 | 2026-09-02 | React wrapper (`react-map-gl/maplibre`) |
| `@turf/distance`, `@turf/bearing`, `@turf/destination`, `@turf/great-circle`, `@turf/helpers` | 7.4.0 | 2026-08-03 | Geo math |
| `papaparse` | 5.7.0 | 2026-08-24 | plane-alert-db CSV (5.7.1 is 12 days old) |
| `@types/papaparse` | 5.5.2 | 2026-10-04 | Its types |

## 10. The live run (Wave 5)

CafAI's production build, served by the real Decaid 0.9.2 of section 1
(`--skin-path dist`, skin on its own port), its simulated DE1 idle, the
plugin installed through `PUT /api/v1/plugins/overhead.reaplugin/source`
with a launch token (section 2), home under the approach to O'Hare's 27R,
`IdleMinutes` 1 and night hours set to cover the run. Chromium at 1280x800,
with `window.__DECENT_HOST__` set before the page loads, as Decaid's WebView
sets it (`src/api/host.ts`). No input for 10 minutes, then a tap.
2026-11-23, 14:21 to 14:31 UTC.

| Check | Result |
|---|---|
| Comes up by itself | after 60 s untouched, the machine idle |
| What it showed | live for the whole run but the first sample (below): 41 to 64 aircraft from adsb.fi, a Now overhead about every two minutes (American 2332, SkyWest 4794, SkyWest 4982, EVA Air 662 from Anchorage, United 1733), routes and types from hexdb, ABC7's helicopter as a notable aircraft from the live plane-alert-db lists |
| Every host the page asked (Playwright's request log) | `127.0.0.1:<skin port>` 7, `127.0.0.1:8080` 166 (REST) and 8 sockets, one `blob:` (the map's worker), `tiles.openfreemap.org` 328. **No other host.** |
| Every host the plugin asked (its `requests` stats) | `opendata.adsb.fi` 103, shortest gap 5,255 ms; `hexdb.io` 115, shortest gap 1,003 ms; `api.airplanes.live` 2, 603 s apart (403, rested 10 minutes, O2); plane-alert-db not at all (its copy from earlier that day was kept, O16). **Every host under one request a second.** |
| Display socket, night hours (a second run, frames recorded) | on coming up: `requestWakeLock`, then `setBrightness 10`; on the tap: `setBrightness 100`, `releaseWakeLock`, socket closed |
| The tap | Overhead gone; nothing under it pressed (the page did not move) |

On this Linux build Decaid reports `platformSupported.brightness: false` and
cannot take a wake lock (no D-Bus): `setBrightness` returns before it updates
the state it reports (`display_controller.dart` at v0.9.2, `_applyBrightness`),
so the frames CafAI sent are the evidence here; on an Android tablet the
same commands dim the screen (D224, verified on 0.8.8's simulator).

The first sample, 1 s after Overhead came up, read "Live data paused": the
plugin answered at once with its last once-a-minute check, 35 s old. Fixed
after the run (DECISIONS O22); in the second run the board was live 8 s after
it came up.

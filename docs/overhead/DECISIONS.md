# Overhead: decisions

Where Overhead departs from its brief, or settles something the brief left
open, with the reason. Evidence is in [DISCOVERY.md](DISCOVERY.md). The root
[DECISIONS.md](../../DECISIONS.md) has one entry (D286) that points here.

- **O1. The branch is `claude/overhead-screensaver-62pibj`.** The brief names
  `feat/overhead-screensaver` in its own worktree; this session may push only
  to `claude/overhead-screensaver-62pibj`, in a checkout of its own that
  nothing else uses. Nothing is merged or pushed to `main`, and nothing is
  force-pushed.

- **O2. The provider chain keeps the brief's order and learns from answers.**
  airplanes.live, then adsb.fi, then adsb.lol, each at most one request a
  second (one request per poll, polls 2 s apart at least). What the evidence
  changed:
  - airplanes.live answers 403 "Please contact us" to this container, and its
    shape could not be seen. A body is read only if it has the readsb envelope
    both verified providers share (an `ac` or `aircraft` array); anything else
    counts as a failure. A 401 or 403 rests that provider for 10 minutes
    instead of the usual backoff, so a refused address does not cost a
    request a poll.
  - adsb.lol allows 500 requests a day per IP without a key, not "changes
    with load". It is the last resort, and it is skipped while its
    `x-ratelimit-remaining` is below 50 until `x-ratelimit-reset` passes, and
    for `Retry-After` after a 429.
  - Failures back off exponentially per provider (5 s doubling to 5 min),
    and the provider that served each answer is logged and sent as
    `provider`.

- **O3. The skin saves the plugin's settings through the plugin, not through
  Decaid's settings route.** On the pinned Decaid v0.9.2,
  `POST /api/v1/plugins/:id/settings` always needs an `extensions:manage`
  token, which a skin does not hold. The plugin serves its own
  `GET`/`POST /api/v1/plugins/overhead.reaplugin/config`, keeps what is posted
  in its storage, and applies it over its manifest settings. The manifest
  still declares every setting, so Decaid's own Plugins screen can edit them;
  a change made there (seen as a changed value at load) wins over the stored
  copy for that setting, so the last change made anywhere holds. Like every
  plugin endpoint, `config` is open to the local network, as Decaid's own API
  is.

- **O5. Routes come from hexdb.** adsb.lol's route lookup (`/api/0/routeset`)
  answered 201 with an empty body after 5-9 s. hexdb answers in half a
  second; its routes can be years old (UAL2428's is from 2018), so each route
  carries its `updatetime`, the board shows a route older than a year as "Route
  may be out of date", and nothing treats a route as authoritative.

- **O6. Airports come from hexdb, cached for good.** An airports dataset
  package would put thousands of airports into the plugin for the handful a
  kitchen sees in a day. hexdb's airport answer has the name, IATA code and
  position Overhead shows, each code is asked once and kept in plugin
  storage, and a miss is kept for a day.

- **O7. MapLibre 6, its worker compiled and inlined.** MapLibre 6 is ESM only,
  needs WebGL 2, and loads its worker from a second ES2022 file. CafAI ships
  one bundle (Decaid replaces skin files in place) that must run on Chromium
  91. So the build compiles the worker for Chromium 91 with the core-js
  polyfills it needs (`Array.prototype.at`, `Object.hasOwn`), embeds it in
  the bundle, and hands MapLibre a `blob:` URL. Without WebGL 2 the map's
  half says so in a quiet line on the dark page, and the board works as
  ever. Chromium 91 itself draws the map (DISCOVERY section 11).

- **O9. Fixtures name no private person.** One `ownOp` in the captured
  responses named a private owner; it reads `PRIVATE OWNER (redacted)`. The
  plane-alert-db samples keep only rows whose operator is an organisation.

- **O10. The closest approach is worked out once, in the plugin; the board
  re-buckets it every second in the skin.** Holding a straight line, the
  closest point does not move; only the time to it runs down. So each
  aircraft carries its CPA from the plugin (`cpa`, at `positionAt`), and the
  shared `bucketFor(cpa, rules, elapsedSeconds)` places it on the board from
  the time since, with no new request. The math is in
  `src/overhead/domain/` and is the same code in both.

- **O11. What the brief left open about the buckets.**
  - "Just passed" counts only an aircraft that passed within the "soon"
    distance (1.5 mi): one that passed 20 miles away was never on the board.
  - "Now" wins at its edge: a plane 30 s past its closest point, within
    0.5 mi, is still Now (the brief's ±30 s); "Just passed" follows it.
  - "In N min" rounds to the nearest minute, at least 1.
  - Aircraft on the ground (`alt_baro: "ground"`) or with no altitude are
    never listed; the map still shows them.
  - Under 0.15 mi the side is meaningless: the board says "directly over".
  - The known-answer case 2 gives 1.149 mi, not 1.151: a westbound great
    circle bends slightly south of the parallel. The label reads
    "1.1 mi north"; the test allows for it.

- **O12. Place names come from airport names.** hexdb gives the airport's
  name and IATA code, not its city, so "From Denver (DEN)" is "Denver
  International Airport" with "International Airport" taken off. For some
  airports that is not the city ("George Bush Intercontinental (IAH)"); it is
  still what the airport is called.

- **O13. A multi-leg route is read for the leg that touches the home
  airport.** hexdb lists round trips such as `KORD-KDCA-KORD`; the leg is the
  inbound one when the aircraft's track points within 90° of the home
  airport, the outbound one otherwise.

- **O14. hexdb is asked for what the board shows first.** At one request a
  second, a cold start cannot look up fifty aircraft at once. Each time the
  skin asks, the plugin queues, newest need first: the airports of known
  routes and the home airport, then routes for the board's aircraft and the
  15 nearest others with an airline callsign, then aircraft details for the
  board's aircraft only (the provider's `desc` already names most types).
  N-number callsigns are never looked up as routes. Nothing is looked up
  while the screensaver is away.

- **O15. The notable event.** `ws/v1/plugins/overhead.reaplugin/notable`
  carries `{hex, operator, category, registration, type, distanceNm, at}`
  the first time a notable aircraft is seen inside the notable area, from
  the plugin's own polls (the once-a-minute check included). It is not sent
  again until that aircraft has been away for 10 minutes. Mock mode lists
  notable aircraft but sends no event, so a demo never reaches another
  surface.

- **O16. plane-alert-db is downloaded with If-None-Match.** GitHub answers
  with an ETag; the daily refresh sends it back, so an unchanged list costs a
  304 and no parsing. A download that fails, or a file that no longer has
  `$ICAO` and `$Operator` columns, keeps the last good copy and is tried
  again an hour later.

- **O17. Overhead takes the classic screensaver's place while it is on.**
  CafAI already has a screensaver (D223-D227) that shows only while the
  machine sleeps and wakes the machine on a tap. Overhead follows the brief
  instead: it comes after 3 idle minutes (its own setting) whenever the
  machine is idle, asleep or not connected, and a tap only closes it. Two
  screensavers that could both want the screen would fight over it, so while
  Overhead is on (its plugin answers and its `ScreensaverOn` setting is on)
  the classic one stands down: one line in `SaverOverlay.tsx`
  (`useOverheadTakesOver`). Without the plugin, CafAI behaves exactly as
  before. Like the classic one, with the machine asleep it holds the screen
  on for 30 minutes and then lets it go (black), after which the plugin stops
  asking anyone; awake, Decaid keeps the screen on and so does Overhead.
  "Busy" is an allow-list: only `idle` and `sleeping` let it come.

- **O18. The bundle grows by 1.7 MB.** MapLibre (1.1 MB) and its inlined
  worker (0.5 MB) take the production bundle from 2.12 MB to 3.82 MB (gzip
  691 kB to 1,167 kB). It is served to the tablet from the tablet itself.
  Vite's "chunks larger than 2000 kB" warning was already printed before this
  branch (2,119.83 kB on `main`); there is no new warning, and the limit was
  left as it is.

- **O19. The skin reaches the plugin through a service, so tests never do.**
  `createServices` gives the app `services.overhead`, a client for the
  plugin's endpoints on Decaid's origin; fakes and previews have none, and
  Overhead is then off. Unit tests never call Decaid (CONTRIBUTING).

- **O20. Mock builds run the real plugin.** `?mockOverhead=<scenario>`
  (`mock/overhead.ts`) runs `src/overhead/plugin` in the page, in its own mock
  mode, with a stand-in host: the screenshots and the UI are built on the
  same code that runs in Decaid. Off by default, so the existing mock and e2e
  runs see no Overhead at all. The stale, empty and loading scenarios shape
  the plugin's answer in the mock handler; the rest are the plugin's own.

- **O21. The providers never learn where home is to better than a kilometre.**
  The position query only needs a centre: the closest approach, the buckets
  and the distances are all worked out in the plugin from the exact home. So
  home goes out rounded to 2 decimals (within about 1.1 km) and the radius 1 nm
  wider to make up for the rounding. hexdb and plane-alert-db never see a
  position at all. Home itself is kept in the plugin's settings in Decaid,
  which, like everything in Decaid's store, any device on the home network
  can read.

- **O22. The first answer waits for fresh positions.** As the screensaver
  comes up, the plugin may hold only the last once-a-minute check, up to a
  minute old, which would open on "Live data paused". The first request of a
  showing waits up to 6 s for a new poll before it answers; later ones answer
  at once.

- **O23. One e2e helper waits for the chat to settle.** Three e2e tests
  (`chat-first` "the card's numbers move with the machine…",
  `verifier-fixes` "a profile loaded behind CafAI…", `machine-profile` "the
  Profile line follows…") failed on this branch and passed on `main` in the
  same container. A timeline taken in both builds was the same: after the
  "Loaded … on the machine." notice the chat is idle for about 20 ms before
  the coach's reply starts. `showStats` (e2e/helpers.ts) tapped Stats when it
  saw the chat idle, and in that gap the reply then pushed the card off, as
  D91 says it should. The bigger bundle moved the test's timing into the gap;
  the app behaves the same. `showStats` now requires the chat to be idle
  still 400 ms later. Nothing in the app changed for it.

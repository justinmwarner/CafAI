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
  the bundle, and hands MapLibre a `blob:` URL. Without WebGL 2 the map gives
  way to a dark backdrop with the home marker drawn by the board, and the
  board still works.

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

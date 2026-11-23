/**
 * The Overhead plugin for Decaid (docs/overhead/README.md): it asks the
 * position providers for aircraft around home, keeps them with their
 * trails, and serves them to the skin at
 * `GET /api/v1/plugins/overhead.reaplugin/overhead`. All third-party requests
 * are here; the skin only ever talks to Decaid.
 *
 * When it asks (the brief):
 * - every `pollIntervalSeconds` (2 s at least) while the screensaver shows:
 *   each GET of `overhead` from the skin holds that for ACTIVE_LEASE_MS;
 * - otherwise once a minute, for the notable check, unless the machine
 *   sleeps (the screen is off then, or about to be);
 * - never without a home, and never in mock mode.
 *
 * Settings: the manifest's, as Decaid passes them to onLoad, under what the
 * skin posted to `config` (DECISIONS O3), except a value changed in Decaid's
 * own Plugins screen since, which wins.
 */
import { board } from '../domain/buckets.ts';
import { closestApproach } from '../domain/cpa.ts';
import { bearingDeg, distanceNm, type LatLon } from '../domain/geo.ts';
import { airlineFor, splitCallsign, typeNameFor } from '../domain/words.ts';
import { PAYLOAD_VERSION, STALE_AFTER_MS, type NotableSighting, type OverheadAircraft, type OverheadPayload, type PayloadSource } from '../shared/payload.ts';
import { finite, text } from '../shared/readsb.ts';
import { CONFIG_ENDPOINT, NOTABLE_EVENT, OVERHEAD_ENDPOINT, OVERHEAD_PLUGIN_ID, readSettings, settingsValues, validValues, type OverheadSettings } from '../shared/settings.ts';
import { createEnricher, type Enricher } from './enrich.ts';
import type { PluginDeps, PluginEvent, PluginHost, PluginReply, PluginRequest } from './host.ts';
import { createPluginKv } from './kv.ts';
import { MOCK_PLANE_ALERT, mockEnrichmentSeed, mockSnapshot } from './mock.ts';
import { createPlaneAlert, type PlaneAlert } from './planeAlert.ts';
import { createProviderChain, type ProviderSpec } from './providers.ts';
import { createTracker, type TrackedAircraft } from './tracker.ts';

/** A GET of `overhead` from the skin keeps the screensaver counted as showing this long. */
export const ACTIVE_LEASE_MS = 20_000;
/** Between notable checks while the screensaver is away. */
export const NOTABLE_CHECK_MS = 60_000;
/** How often the plugin looks at whether to poll, when it is not polling faster. */
export const IDLE_TICK_MS = 5_000;

/** A notable aircraft gone from the notable area this long can raise the event again when it comes back. */
export const NOTABLE_FORGET_MS = 10 * 60_000;
/** Routes are asked for the board's aircraft and this many more, nearest first. */
export const ROUTES_BEYOND_BOARD = 15;

/** Storage keys. */
const KEY_CONFIG = 'config';
const KEY_NATIVE_SEEN = 'nativeSeen';

export interface OverheadPluginOptions {
  providers?: readonly ProviderSpec[];
}

export interface OverheadPlugin {
  id: string;
  version: string;
  onLoad(settings: unknown): void;
  onUnload(): void;
  onEvent(event: PluginEvent): void;
  __httpRequestHandler(request: PluginRequest): Promise<PluginReply> | PluginReply;
  /** For tests: resolves once the settings saved in storage have been read. */
  ready(): Promise<void>;
}

type Values = Record<string, unknown>;

const isRecord = (value: unknown): value is Values => typeof value === 'object' && value !== null && !Array.isArray(value);

function reply(status: number, body: unknown): PluginReply {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

export function homeOf(settings: OverheadSettings): LatLon | null {
  return settings.homeLat === null || settings.homeLon === null ? null : { lat: settings.homeLat, lon: settings.homeLon };
}

/** The tracked aircraft as the payload has it, with its closest approach; route and notable come after. */
export function baseAircraft(tracked: TrackedAircraft, home: LatLon): OverheadAircraft {
  const last = tracked.last;
  const position = { lat: tracked.lat, lon: tracked.lon };
  const callsign = text(last.flight);
  const operator = text(last.ownOp);
  const onGround = last.alt_baro === 'ground';
  const groundSpeedKt = finite(last.gs);
  const trackDeg = finite(last.track);
  return {
    hex: tracked.hex,
    callsign,
    registration: text(last.r),
    typeCode: text(last.t),
    typeName: typeNameFor({ desc: text(last.desc), manufacturer: null, model: null }),
    operator,
    airline: airlineFor(callsign, operator),
    lat: tracked.lat,
    lon: tracked.lon,
    positionAt: tracked.positionAt,
    altitudeFt: typeof last.alt_baro === 'number' && Number.isFinite(last.alt_baro) ? last.alt_baro : null,
    onGround,
    groundSpeedKt,
    trackDeg,
    verticalRateFpm: finite(last.baro_rate),
    distanceNm: distanceNm(home, position),
    bearingDeg: bearingDeg(home, position),
    cpa: onGround ? null : closestApproach(home, { position, groundSpeedKt, trackDeg }),
    route: null,
    notable: null,
    trail: tracked.trail,
  };
}

/** What hexdb and plane-alert-db add to an aircraft: its route, the type and owner hexdb knows, whether it is notable. */
export function decorate(plane: OverheadAircraft, enricher: Pick<Enricher, 'aircraft' | 'route'>, planeAlert: Pick<PlaneAlert, 'match'>, homeAirport: string): OverheadAircraft {
  const details = enricher.aircraft(plane.hex);
  const operator = plane.operator ?? details?.owner ?? null;
  return {
    ...plane,
    registration: plane.registration ?? details?.registration ?? null,
    typeCode: plane.typeCode ?? details?.icaoType ?? null,
    typeName: plane.typeName ?? typeNameFor({ desc: null, manufacturer: details?.manufacturer ?? null, model: details?.model ?? null }),
    operator,
    airline: airlineFor(plane.callsign, operator),
    route: enricher.route(plane.callsign, { lat: plane.lat, lon: plane.lon }, plane.trackDeg, homeAirport),
    notable: planeAlert.match(plane.hex),
  };
}

export function createOverheadPlugin(host: PluginHost, deps: PluginDeps, version: string, options: OverheadPluginOptions = {}): OverheadPlugin {
  const log = (message: string) => {
    try {
      host.log(message);
    } catch {
      // Logging is never worth a failure.
    }
  };
  const kv = createPluginKv(host, deps);
  const chain = createProviderChain(deps, log, options.providers);
  const tracker = createTracker();
  const mockTracker = createTracker();
  const enricher = createEnricher(deps, kv, { log });
  const planeAlert = createPlaneAlert(deps, kv, { log });
  // Mock mode's own: the recorded answers, asking nobody (a lookup the recording lacks reads as not found).
  const mockDeps = { ...deps, fetch: async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null }) };
  const mockEnricher = createEnricher(mockDeps, null, { seed: mockEnrichmentSeed() });
  const mockPlaneAlert = createPlaneAlert(mockDeps, null, { seed: MOCK_PLANE_ALERT });
  /** Notable aircraft within the notable area: when each came in, and when it was last seen there. */
  const notableSeen = new Map<string, { since: number; lastInside: number }>();
  const mockNotableSeen = new Map<string, { since: number; lastInside: number }>();

  let native: Values = {};
  let stored: Values = {};
  let settings: OverheadSettings = readSettings({});
  let timer: unknown = null;
  let unloaded = false;
  let activeUntil = 0;
  let lastPollAt = Number.NEGATIVE_INFINITY;
  let polling = false;
  let dataAt: number | null = null;
  let source: PayloadSource = null;
  let machineAsleep = false;
  const mockStartedAt = deps.now();
  let resolveReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function apply(): void {
    const before = homeOf(settings);
    settings = readSettings({ ...native, ...stored });
    const after = homeOf(settings);
    if (before?.lat !== after?.lat || before?.lon !== after?.lon) {
      // A new home: what was seen around the old one is no news here.
      tracker.clear();
      notableSeen.clear();
      dataAt = null;
      source = null;
    }
  }

  /** Reads the copy the skin saved, and lets any value changed in Decaid's own screen since win. */
  async function reconcile(): Promise<void> {
    const [savedConfig, nativeSeen] = await Promise.all([kv.read(KEY_CONFIG), kv.read(KEY_NATIVE_SEEN)]);
    if (unloaded) return;
    stored = isRecord(savedConfig) ? { ...savedConfig } : {};
    const seen = isRecord(nativeSeen) ? nativeSeen : {};
    let changed = false;
    for (const key of Object.keys(native)) {
      if (key in stored && JSON.stringify(native[key]) !== JSON.stringify(seen[key])) {
        delete stored[key];
        changed = true;
      }
    }
    if (changed) kv.write(KEY_CONFIG, stored);
    kv.write(KEY_NATIVE_SEEN, native);
    apply();
  }

  function schedule(ms: number): void {
    if (unloaded) return;
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => {
      timer = null;
      void tick();
    }, ms);
  }

  function pollEveryMs(): number {
    return Math.max(2, settings.pollIntervalSeconds) * 1000;
  }

  function wantsPoll(now: number): boolean {
    if (settings.mockMode || homeOf(settings) === null || polling) return false;
    if (now < activeUntil) return now - lastPollAt >= pollEveryMs() - 50;
    if (machineAsleep) return false;
    return now - lastPollAt >= NOTABLE_CHECK_MS;
  }

  async function poll(): Promise<void> {
    const home = homeOf(settings);
    if (home === null) return;
    polling = true;
    lastPollAt = deps.now();
    try {
      const radius = Math.max(settings.radiusNm, settings.notableRadiusNm);
      const result = await chain.fetchPositions(home.lat, home.lon, radius);
      if (unloaded || result === null) return;
      const current = homeOf(settings);
      // The home changed while the request was out: its answer is for somewhere else.
      if (current?.lat !== home.lat || current?.lon !== home.lon) return;
      tracker.ingest(result.snapshot, result.at);
      dataAt = result.at;
      source = result.provider;
      const planes = tracker.current(result.at).map((plane) => baseAircraft(plane, home));
      noteNotable(planes.map((plane) => ({ ...plane, notable: planeAlert.match(plane.hex) })), result.at, notableSeen, true);
    } catch (error) {
      log(`[overhead] poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      polling = false;
    }
  }

  async function tick(): Promise<void> {
    if (unloaded) return;
    if (!settings.mockMode && homeOf(settings) !== null) void planeAlert.refreshIfDue();
    if (wantsPoll(deps.now())) await poll();
    const active = deps.now() < activeUntil;
    schedule(active ? Math.min(pollEveryMs(), IDLE_TICK_MS) : IDLE_TICK_MS);
  }

  /**
   * Notes which notable aircraft are within the notable area, and raises the
   * event for one that has just come in (once, until it has been away for
   * NOTABLE_FORGET_MS).
   */
  function noteNotable(planes: readonly OverheadAircraft[], now: number, seen: Map<string, { since: number; lastInside: number }>, announce: boolean): void {
    for (const plane of planes) {
      if (plane.notable === null || plane.distanceNm > settings.notableRadiusNm) continue;
      const known = seen.get(plane.hex);
      if (known) {
        known.lastInside = now;
        continue;
      }
      seen.set(plane.hex, { since: now, lastInside: now });
      if (!announce) continue;
      try {
        host.emit(NOTABLE_EVENT, {
          hex: plane.hex,
          operator: plane.notable.operator,
          category: plane.notable.category,
          registration: plane.notable.registration ?? plane.registration,
          type: plane.notable.type ?? plane.typeName,
          distanceNm: Math.round(plane.distanceNm * 10) / 10,
          at: now,
        });
      } catch (error) {
        log(`[overhead] could not announce ${plane.hex}: ${String(error)}`);
      }
      log(`[overhead] notable: ${plane.notable.operator} (${plane.hex}) ${plane.distanceNm.toFixed(1)} nm away`);
    }
    for (const [hex, entry] of seen) if (now - entry.lastInside > NOTABLE_FORGET_MS) seen.delete(hex);
  }

  /** Asks hexdb for what the board needs first: its aircraft's routes, then their airports, then the nearest others' routes. */
  function wantEnrichment(planes: readonly OverheadAircraft[], now: number, into: Enricher): void {
    const flying = planes.filter((plane) => !plane.onGround);
    const onBoard = board(flying, settings, now).map((entry) => entry.aircraft);
    const boardHexes = new Set(onBoard.map((plane) => plane.hex));
    const others = flying.filter((plane) => !boardHexes.has(plane.hex)).sort((a, b) => a.distanceNm - b.distanceNm).slice(0, ROUTES_BEYOND_BOARD);
    const routeKeys = [...onBoard, ...others].map((plane) => (splitCallsign(plane.callsign) ? (plane.callsign as string) : '')).filter((key) => key !== '');
    into.want('aircraft', onBoard.map((plane) => plane.hex));
    into.want('route', routeKeys);
    const airports = new Set<string>([settings.homeAirport]);
    for (const plane of planes) {
      if (plane.route) {
        airports.add(plane.route.origin.icao);
        airports.add(plane.route.destination.icao);
      }
    }
    into.want('airport', [...airports]);
  }

  function build(now: number, mock: boolean, active: boolean): OverheadPayload {
    const home = homeOf(settings);
    let tracked: TrackedAircraft[] = [];
    let payloadSource = source;
    let payloadDataAt = dataAt;
    if (home !== null && mock) {
      mockTracker.ingest(mockSnapshot(home, now - mockStartedAt), now);
      tracked = mockTracker.current(now);
      payloadSource = 'mock';
      payloadDataAt = now;
    } else if (home !== null) {
      tracked = tracker.current(now);
    }
    const lookups = mock ? mockEnricher : enricher;
    const lists = mock ? mockPlaneAlert : planeAlert;
    const seen = mock ? mockNotableSeen : notableSeen;
    const all = home === null ? [] : tracked.map((plane) => decorate(baseAircraft(plane, home), lookups, lists, settings.homeAirport));
    if (mock) noteNotable(all, now, seen, false);
    const aircraft = all.filter((plane) => plane.distanceNm <= settings.radiusNm || (plane.notable !== null && plane.distanceNm <= settings.notableRadiusNm));
    if (active && home !== null) wantEnrichment(aircraft, now, lookups);
    const byHex = new Map(aircraft.map((plane) => [plane.hex, plane]));
    const notable: NotableSighting[] = [];
    for (const [hex, entry] of seen) {
      const plane = byHex.get(hex);
      if (plane?.notable && plane.distanceNm <= settings.notableRadiusNm) notable.push({ hex, info: plane.notable, since: entry.since });
    }
    notable.sort((a, b) => (byHex.get(a.hex)?.distanceNm ?? 0) - (byHex.get(b.hex)?.distanceNm ?? 0));
    return {
      version: PAYLOAD_VERSION,
      generatedAt: now,
      provider: payloadSource,
      dataAt: payloadDataAt,
      stale: payloadDataAt === null || now - payloadDataAt > STALE_AFTER_MS,
      home,
      settings,
      aircraft,
      notable,
      providers: chain.status(),
    };
  }

  function handleOverhead(request: PluginRequest): PluginReply {
    const now = deps.now();
    const mock = settings.mockMode || request.query['mock'] === '1';
    const active = request.query['active'] !== '0';
    if (active) {
      const wasActive = now < activeUntil;
      activeUntil = now + ACTIVE_LEASE_MS;
      // The screensaver just came up: ask now rather than at the next tick.
      if (!wasActive && !mock) {
        void tick();
      }
    }
    return reply(200, build(now, mock, active));
  }

  function handleConfig(request: PluginRequest): PluginReply {
    if (request.method === 'GET') return reply(200, { version: PAYLOAD_VERSION, values: settingsValues(settings) });
    if (request.method !== 'POST') return reply(405, { error: 'GET or POST' });
    const body = isRecord(request.body) && isRecord(request.body['values']) ? request.body['values'] : request.body;
    if (!isRecord(body)) return reply(400, { error: 'Send {"values": {...}} keyed as the manifest keys its settings.' });
    const valid = validValues(body);
    for (const [key, value] of Object.entries(valid)) {
      if (value === null) delete stored[key];
      else stored[key] = value;
    }
    kv.write(KEY_CONFIG, stored);
    apply();
    log(`[overhead] settings saved: ${Object.keys(valid).join(', ') || 'none'}`);
    void tick();
    return reply(200, { version: PAYLOAD_VERSION, values: settingsValues(settings), ignored: Object.keys(body).filter((key) => !(key in valid)) });
  }

  return {
    id: OVERHEAD_PLUGIN_ID,
    version,
    onLoad(values) {
      native = isRecord(values) ? { ...values } : {};
      apply();
      Promise.all([reconcile(), enricher.load(), planeAlert.load()])
        .catch((error: unknown) => log(`[overhead] reading what was saved failed: ${String(error)}`))
        .finally(() => {
          resolveReady();
          schedule(0);
        });
      log(`[overhead] loaded ${version}`);
    },
    onUnload() {
      unloaded = true;
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
      enricher.close();
      mockEnricher.close();
      kv.close();
    },
    onEvent(event) {
      if (!event || typeof event.name !== 'string') return;
      if (event.name === 'storageRead') kv.answered(event.payload);
      else if (event.name === 'stateUpdate') {
        const state = isRecord(event.payload) && isRecord(event.payload['state']) ? event.payload['state']['state'] : undefined;
        if (typeof state === 'string') machineAsleep = state === 'sleeping';
      } else if (event.name === 'settingsUpdated' && isRecord(event.payload)) {
        native = { ...native, ...event.payload };
        void reconcile();
      } else if (event.name === 'shutdown') {
        unloaded = true;
        if (timer !== null) deps.clearTimeout(timer);
      }
    },
    __httpRequestHandler(request) {
      try {
        if (request.endpoint === OVERHEAD_ENDPOINT) return handleOverhead(request);
        if (request.endpoint === CONFIG_ENDPOINT) return handleConfig(request);
        return reply(404, { error: `no endpoint ${request.endpoint}` });
      } catch (error) {
        log(`[overhead] ${request.endpoint} failed: ${error instanceof Error ? error.message : String(error)}`);
        return reply(500, { error: 'Overhead could not answer.' });
      }
    },
    ready: () => readyPromise,
  };
}

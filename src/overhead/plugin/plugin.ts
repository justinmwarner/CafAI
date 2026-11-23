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
import { bearingDeg, distanceNm, type LatLon } from '../domain/geo.ts';
import { PAYLOAD_VERSION, STALE_AFTER_MS, type OverheadAircraft, type OverheadPayload, type PayloadSource } from '../shared/payload.ts';
import { finite, text } from '../shared/readsb.ts';
import { CONFIG_ENDPOINT, OVERHEAD_ENDPOINT, OVERHEAD_PLUGIN_ID, readSettings, settingsValues, validValues, type OverheadSettings } from '../shared/settings.ts';
import type { PluginDeps, PluginEvent, PluginHost, PluginReply, PluginRequest } from './host.ts';
import { createPluginKv } from './kv.ts';
import { mockSnapshot } from './mock.ts';
import { createProviderChain, type ProviderSpec } from './providers.ts';
import { createTracker, type TrackedAircraft } from './tracker.ts';

/** A GET of `overhead` from the skin keeps the screensaver counted as showing this long. */
export const ACTIVE_LEASE_MS = 20_000;
/** Between notable checks while the screensaver is away. */
export const NOTABLE_CHECK_MS = 60_000;
/** How often the plugin looks at whether to poll, when it is not polling faster. */
export const IDLE_TICK_MS = 5_000;

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

/** The tracked aircraft as the payload has it, before CPA, route and notable are added. */
export function baseAircraft(tracked: TrackedAircraft, home: LatLon): OverheadAircraft {
  const last = tracked.last;
  const position = { lat: tracked.lat, lon: tracked.lon };
  return {
    hex: tracked.hex,
    callsign: text(last.flight),
    registration: text(last.r),
    typeCode: text(last.t),
    typeName: text(last.desc),
    operator: text(last.ownOp),
    airline: null,
    lat: tracked.lat,
    lon: tracked.lon,
    positionAt: tracked.positionAt,
    altitudeFt: typeof last.alt_baro === 'number' && Number.isFinite(last.alt_baro) ? last.alt_baro : null,
    onGround: last.alt_baro === 'ground',
    groundSpeedKt: finite(last.gs),
    trackDeg: finite(last.track),
    verticalRateFpm: finite(last.baro_rate),
    distanceNm: distanceNm(home, position),
    bearingDeg: bearingDeg(home, position),
    cpa: null,
    route: null,
    notable: null,
    trail: tracked.trail,
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
    } catch (error) {
      log(`[overhead] poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      polling = false;
    }
  }

  async function tick(): Promise<void> {
    if (unloaded) return;
    if (wantsPoll(deps.now())) await poll();
    const active = deps.now() < activeUntil;
    schedule(active ? Math.min(pollEveryMs(), IDLE_TICK_MS) : IDLE_TICK_MS);
  }

  function build(now: number, mock: boolean): OverheadPayload {
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
    const aircraft = home === null ? [] : tracked.map((plane) => baseAircraft(plane, home)).filter((plane) => plane.distanceNm <= settings.radiusNm);
    return {
      version: PAYLOAD_VERSION,
      generatedAt: now,
      provider: payloadSource,
      dataAt: payloadDataAt,
      stale: payloadDataAt === null || now - payloadDataAt > STALE_AFTER_MS,
      home,
      settings,
      aircraft,
      notable: [],
      providers: chain.status(),
    };
  }

  function handleOverhead(request: PluginRequest): PluginReply {
    const now = deps.now();
    const mock = settings.mockMode || request.query['mock'] === '1';
    if (request.query['active'] !== '0') {
      const wasActive = now < activeUntil;
      activeUntil = now + ACTIVE_LEASE_MS;
      // The screensaver just came up: ask now rather than at the next tick.
      if (!wasActive && !mock) {
        void tick();
      }
    }
    return reply(200, build(now, mock));
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
      reconcile()
        .catch((error: unknown) => log(`[overhead] reading saved settings failed: ${String(error)}`))
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

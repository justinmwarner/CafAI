/**
 * hexdb.io lookups (docs/overhead/DISCOVERY.md, section 6), at most one
 * request a second, cached:
 *
 * | Lookup | Key | Kept |
 * |---|---|---|
 * | Route | callsign | 6 h |
 * | Aircraft details | hex | 30 days |
 * | Airport | ICAO code | for good (a miss: a day, DECISIONS O6) |
 *
 * A 404 is an answer and is kept as long as a hit; anything else that fails
 * is asked again later. Caches live in memory and in plugin storage, written
 * at most every PERSIST_EVERY_MS. What waits is asked for in order of need:
 * whatever the board shows first.
 */
import { chooseLeg, parseRoute } from '../domain/direction.ts';
import { bearingDeg, type LatLon } from '../domain/geo.ts';
import type { RouteEnd, RouteInfo } from '../shared/payload.ts';
import { finite, text } from '../shared/readsb.ts';
import type { PluginDeps } from './host.ts';
import type { PluginKv } from './kv.ts';

export const HEXDB = 'https://hexdb.io/api/v1';
export const ROUTE_TTL_MS = 6 * 3600_000;
export const AIRCRAFT_TTL_MS = 30 * 24 * 3600_000;
export const AIRPORT_MISS_TTL_MS = 24 * 3600_000;
/** One hexdb request a second at most (the brief). */
export const HEXDB_EVERY_MS = 1000;
export const PERSIST_EVERY_MS = 30_000;
/** Kept entries per cache; the oldest go first. */
export const CACHE_LIMIT = 3000;
/** A failed lookup (not a 404) is not asked again for this long. */
export const RETRY_AFTER_MS = 5 * 60_000;

interface Entry<T> {
  value: T | null;
  at: number;
}

export interface RouteRecord {
  raw: string;
  updatedAt: number | null;
}

export interface AircraftRecord {
  registration: string | null;
  manufacturer: string | null;
  model: string | null;
  icaoType: string | null;
  owner: string | null;
}

export type AirportRecord = Omit<RouteEnd, 'icao'>;

type Kind = 'route' | 'aircraft' | 'airport';

export interface Enricher {
  /** Reads the caches kept in storage. */
  load(): Promise<void>;
  /** Asks for what these keys need and the caches lack, most wanted first. */
  want(kind: Kind, keys: readonly string[]): void;
  route(callsign: string | null, position: LatLon, trackDeg: number | null, homeAirport: string): RouteInfo | null;
  aircraft(hex: string): AircraftRecord | null;
  airport(icao: string): RouteEnd | null;
  /** Stops the queue and writes the caches once more. */
  close(): void;
}

const STORAGE_KEYS: Record<Kind, string> = { route: 'cache.routes', aircraft: 'cache.aircraft', airport: 'cache.airports' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readRoute(body: unknown): RouteRecord | null {
  if (!isRecord(body)) return null;
  const raw = text(body['route']);
  if (raw === null || parseRoute(raw) === null) return null;
  const updated = finite(body['updatetime']);
  return { raw, updatedAt: updated === null ? null : updated * 1000 };
}

function readAircraft(body: unknown): AircraftRecord | null {
  if (!isRecord(body)) return null;
  return {
    registration: text(body['Registration']),
    manufacturer: text(body['Manufacturer']),
    model: text(body['Type']),
    icaoType: text(body['ICAOTypeCode']),
    owner: text(body['RegisteredOwners']),
  };
}

function readAirport(body: unknown): AirportRecord | null {
  if (!isRecord(body)) return null;
  const name = text(body['airport']);
  if (name === null) return null;
  return { iata: text(body['iata']), name, lat: finite(body['latitude']), lon: finite(body['longitude']) };
}

const URLS: Record<Kind, (key: string) => string> = {
  route: (callsign) => `${HEXDB}/route/icao/${encodeURIComponent(callsign)}`,
  aircraft: (hex) => `${HEXDB}/aircraft/${encodeURIComponent(hex)}`,
  airport: (icao) => `${HEXDB}/airport/icao/${encodeURIComponent(icao)}`,
};

const READERS: Record<Kind, (body: unknown) => unknown> = { route: readRoute, aircraft: readAircraft, airport: readAirport };

/** hexdb's answers read as the caches keep them (for seeding from recorded answers). */
export const readHexdb = { route: readRoute, aircraft: readAircraft, airport: readAirport };

export interface EnricherSeed {
  route?: Record<string, RouteRecord | null>;
  aircraft?: Record<string, AircraftRecord | null>;
  airport?: Record<string, AirportRecord | null>;
}

export interface EnricherOptions {
  /** Between two requests. */
  everyMs?: number;
  log?: (message: string) => void;
  /** Answers known beforehand (mock mode's recorded ones), kept as if just asked. */
  seed?: EnricherSeed;
}

export function createEnricher(deps: Pick<PluginDeps, 'fetch' | 'now' | 'setTimeout' | 'clearTimeout'>, kv: Pick<PluginKv, 'read' | 'write'> | null, options: EnricherOptions = {}): Enricher {
  const everyMs = options.everyMs ?? HEXDB_EVERY_MS;
  const caches: Record<Kind, Map<string, Entry<unknown>>> = { route: new Map(), aircraft: new Map(), airport: new Map() };
  const failedAt: Record<Kind, Map<string, number>> = { route: new Map(), aircraft: new Map(), airport: new Map() };
  let queue: Array<{ kind: Kind; key: string }> = [];
  let timer: unknown = null;
  let running = false;
  let closed = false;
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let dirty = false;
  let persistTimer: unknown = null;
  for (const kind of Object.keys(caches) as Kind[]) {
    for (const [key, value] of Object.entries(options.seed?.[kind] ?? {})) caches[kind].set(key, { value, at: deps.now() });
  }

  function fresh(kind: Kind, entry: Entry<unknown>, now: number): boolean {
    if (kind === 'route') return now - entry.at < ROUTE_TTL_MS;
    if (kind === 'aircraft') return now - entry.at < AIRCRAFT_TTL_MS;
    return entry.value !== null || now - entry.at < AIRPORT_MISS_TTL_MS;
  }

  function known(kind: Kind, key: string, now: number): boolean {
    const entry = caches[kind].get(key);
    if (entry && fresh(kind, entry, now)) return true;
    const failed = failedAt[kind].get(key);
    return failed !== undefined && now - failed < RETRY_AFTER_MS;
  }

  function persistSoon(): void {
    dirty = true;
    if (persistTimer !== null || kv === null) return;
    persistTimer = deps.setTimeout(() => {
      persistTimer = null;
      persist();
    }, PERSIST_EVERY_MS);
  }

  function persist(): void {
    if (!dirty || kv === null) return;
    dirty = false;
    for (const kind of Object.keys(caches) as Kind[]) {
      const entries = [...caches[kind].entries()].sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT);
      caches[kind] = new Map(entries);
      kv.write(STORAGE_KEYS[kind], Object.fromEntries(entries));
    }
  }

  async function fetchOne(kind: Kind, key: string): Promise<void> {
    lastRequestAt = deps.now();
    try {
      const response = await deps.fetch(URLS[kind](key), { headers: { Accept: 'application/json' } });
      const now = deps.now();
      if (response.status === 404) {
        caches[kind].set(key, { value: null, at: now });
        persistSoon();
        return;
      }
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const value = READERS[kind](await response.json());
      caches[kind].set(key, { value, at: now });
      persistSoon();
    } catch (error) {
      failedAt[kind].set(key, deps.now());
      options.log?.(`[overhead] hexdb ${kind} ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function pump(): void {
    if (closed || running || timer !== null) return;
    const wait = Math.max(0, lastRequestAt + everyMs - deps.now());
    timer = deps.setTimeout(() => {
      timer = null;
      void next();
    }, wait);
  }

  async function next(): Promise<void> {
    if (closed) return;
    const now = deps.now();
    let job = queue.shift();
    while (job && known(job.kind, job.key, now)) job = queue.shift();
    if (!job) return;
    running = true;
    try {
      await fetchOne(job.kind, job.key);
    } finally {
      running = false;
    }
    if (queue.length > 0) pump();
  }

  function cached<T>(kind: Kind, key: string): T | null {
    return (caches[kind].get(key)?.value as T | null | undefined) ?? null;
  }

  function end(icao: string): RouteEnd {
    const airport = cached<AirportRecord>('airport', icao);
    return airport ? { icao, ...airport } : { icao, iata: null, name: null, lat: null, lon: null };
  }

  return {
    async load() {
      if (kv === null) return;
      const stored = await Promise.all((Object.keys(caches) as Kind[]).map(async (kind) => [kind, await kv.read(STORAGE_KEYS[kind])] as const));
      for (const [kind, value] of stored) {
        if (!isRecord(value)) continue;
        for (const [key, entry] of Object.entries(value)) {
          if (isRecord(entry) && typeof entry['at'] === 'number' && !caches[kind].has(key)) caches[kind].set(key, { value: entry['value'] ?? null, at: entry['at'] });
        }
      }
    },
    want(kind, keys) {
      const now = deps.now();
      const wanted = keys.filter((key) => key !== '' && !known(kind, key, now));
      if (wanted.length === 0) return;
      const wantedNow = new Set(wanted.map((key) => `${kind}:${key}`));
      // Newly wanted first, in the order given; what was queued before keeps its place after them.
      queue = [...wanted.map((key) => ({ kind, key })), ...queue.filter((job) => !wantedNow.has(`${job.kind}:${job.key}`))];
      pump();
    },
    route(callsign, position, trackDeg, homeAirport) {
      if (callsign === null) return null;
      const record = cached<RouteRecord>('route', callsign);
      const codes = record ? parseRoute(record.raw) : null;
      if (record === null || codes === null) return null;
      const home = end(homeAirport);
      let headingHome: boolean | null = null;
      if (trackDeg !== null && home.lat !== null && home.lon !== null) {
        const off = Math.abs(((bearingDeg(position, { lat: home.lat, lon: home.lon }) - trackDeg + 540) % 360) - 180);
        headingHome = off < 90;
      }
      const [from, to] = chooseLeg(codes, homeAirport, headingHome);
      return { raw: record.raw, origin: end(from), destination: end(to), updatedAt: record.updatedAt };
    },
    aircraft: (hex) => cached<AircraftRecord>('aircraft', hex),
    airport: (icao) => {
      const airport = cached<AirportRecord>('airport', icao);
      return airport ? { icao, ...airport } : null;
    },
    close() {
      closed = true;
      if (timer !== null) deps.clearTimeout(timer);
      if (persistTimer !== null) deps.clearTimeout(persistTimer);
      persist();
    },
  };
}

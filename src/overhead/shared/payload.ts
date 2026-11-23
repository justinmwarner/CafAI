/**
 * What `GET /api/v1/plugins/overhead.reaplugin/overhead` answers: the one
 * definition the plugin builds and the skin reads (docs/overhead/README.md,
 * "The payload"). Versioned: a change a reader of version 1 cannot take
 * raises `version`.
 *
 * The skin reads it with readPayload, which keeps what it can and drops what
 * it cannot (CafAI reads what it is sent, never trusts it).
 */
import type { CompassPoint, LatLon } from '../domain/geo.ts';
import { DEFAULT_SETTINGS, readSettings, SETTING_SPECS, type OverheadSettings } from './settings.ts';

export const PAYLOAD_VERSION = 1;

export type ProviderId = 'airplanes.live' | 'adsb.fi' | 'adsb.lol';

/** Where the positions came from: a provider, the recorded fixtures, or nobody yet. */
export type PayloadSource = ProviderId | 'mock' | null;

/** The closest point of approach to home, if the aircraft holds its track and speed (src/overhead/domain/cpa.ts). */
export interface Cpa {
  /** Seconds from `positionAt` to the closest point; negative once it has passed. */
  timeToCpaSeconds: number;
  /** How close it passes, statute miles. */
  distanceMiles: number;
  /** The compass point from home to the closest point; null when it passes overhead. */
  side: CompassPoint | null;
}

/** One end of a route. */
export interface RouteEnd {
  icao: string;
  iata: string | null;
  /** The airport's name ("Denver International Airport"); null until looked up, or unknown. */
  name: string | null;
  lat: number | null;
  lon: number | null;
}

/** A route from hexdb: plausible at best, never authoritative (DECISIONS O5). */
export interface RouteInfo {
  /** As hexdb wrote it ("KORD-KDCA-KORD"). */
  raw: string;
  /** The leg Overhead believes this flight is on. */
  origin: RouteEnd;
  destination: RouteEnd;
  /** When hexdb last updated it, ms since the epoch; null when it did not say. */
  updatedAt: number | null;
}

/** A plane-alert-db row (DISCOVERY section 7). */
export interface NotableInfo {
  /** `$Operator` ("US Helicopters (ABC7 Chicago)"). */
  operator: string;
  registration: string | null;
  /** `$Type` ("AS-350 Ecureuil"). */
  type: string | null;
  icaoType: string | null;
  /** `Category` ("As Seen on TV"). */
  category: string | null;
  /** `#CMPG`: "Civ", "Gov", "Mil"... */
  group: string | null;
  /** `$Tag 1` to `$#Tag 3`, the empty ones left out. */
  tags: string[];
  /** `$#Link`. */
  link: string | null;
}

export interface OverheadAircraft {
  /** ICAO address, lower case. */
  hex: string;
  callsign: string | null;
  registration: string | null;
  /** ICAO type designator ("B39M"). */
  typeCode: string | null;
  /** The type in plain words ("Boeing 737 MAX 9"), when the data has it. */
  typeName: string | null;
  /** Owner or operator, from the provider or hexdb. */
  operator: string | null;
  /** The airline, from the callsign's prefix or the operator. */
  airline: string | null;
  lat: number;
  lon: number;
  /** When it was at lat/lon, ms since the epoch (the tablet's clock). */
  positionAt: number;
  /** Barometric altitude, feet; null on the ground or unknown. */
  altitudeFt: number | null;
  onGround: boolean;
  groundSpeedKt: number | null;
  trackDeg: number | null;
  verticalRateFpm: number | null;
  /** From home at positionAt. */
  distanceNm: number;
  bearingDeg: number;
  /** Null when it cannot be told (no speed, no track). */
  cpa: Cpa | null;
  route: RouteInfo | null;
  notable: NotableInfo | null;
  /** Where it has been, [lon, lat], oldest first, ending at lat/lon. */
  trail: Array<[number, number]>;
}

/** A notable aircraft within the notable area. */
export interface NotableSighting {
  hex: string;
  info: NotableInfo;
  /** When it first came within the notable area this time, ms since the epoch. */
  since: number;
}

export interface ProviderStatus {
  id: ProviderId;
  /** ok: answering; resting: backing off or over its quota until `until`. */
  state: 'ok' | 'resting' | 'unused';
  until: number | null;
  lastStatus: number | null;
  lastError: string | null;
}

export interface OverheadPayload {
  version: typeof PAYLOAD_VERSION;
  /** When the plugin built this answer, ms since the epoch. */
  generatedAt: number;
  /** Who served the latest positions. */
  provider: PayloadSource;
  /** When the latest positions arrived, ms since the epoch; null before any. */
  dataAt: number | null;
  /** No positions, or none for longer than STALE_AFTER_MS. */
  stale: boolean;
  /** Null until set: the screensaver asks for it. */
  home: LatLon | null;
  settings: OverheadSettings;
  /** Within the area, plus notable aircraft within the notable area. */
  aircraft: OverheadAircraft[];
  notable: NotableSighting[];
  providers: ProviderStatus[];
  /** Every host the plugin has asked since it loaded: how often, and the shortest gap between two requests (the brief: under one a second). */
  requests?: RequestStat[];
}

export interface RequestStat {
  host: string;
  count: number;
  /** Null until a second request. */
  minGapMs: number | null;
}

/** Positions older than this are "paused" (the brief: 30 s). */
export const STALE_AFTER_MS = 30_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function readCpa(value: unknown): Cpa | null {
  if (!isRecord(value)) return null;
  const time = num(value['timeToCpaSeconds']);
  const distance = num(value['distanceMiles']);
  if (time === null || distance === null) return null;
  const side = str(value['side']);
  return { timeToCpaSeconds: time, distanceMiles: distance, side: side as CompassPoint | null };
}

function readEnd(value: unknown): RouteEnd | null {
  if (!isRecord(value)) return null;
  const icao = str(value['icao']);
  if (icao === null) return null;
  return { icao, iata: str(value['iata']), name: str(value['name']), lat: num(value['lat']), lon: num(value['lon']) };
}

function readRoute(value: unknown): RouteInfo | null {
  if (!isRecord(value)) return null;
  const origin = readEnd(value['origin']);
  const destination = readEnd(value['destination']);
  if (origin === null || destination === null) return null;
  return { raw: str(value['raw']) ?? `${origin.icao}-${destination.icao}`, origin, destination, updatedAt: num(value['updatedAt']) };
}

function readNotable(value: unknown): NotableInfo | null {
  if (!isRecord(value)) return null;
  const operator = str(value['operator']);
  if (operator === null) return null;
  return {
    operator,
    registration: str(value['registration']),
    type: str(value['type']),
    icaoType: str(value['icaoType']),
    category: str(value['category']),
    group: str(value['group']),
    tags: Array.isArray(value['tags']) ? value['tags'].filter((tag): tag is string => typeof tag === 'string' && tag !== '') : [],
    link: str(value['link']),
  };
}

function readTrail(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && num(pair[0]) !== null && num(pair[1]) !== null,
  );
}

/** One aircraft, or null when it lacks what the map needs (an address and a position). */
export function readAircraft(value: unknown): OverheadAircraft | null {
  if (!isRecord(value)) return null;
  const hex = str(value['hex']);
  const lat = num(value['lat']);
  const lon = num(value['lon']);
  const positionAt = num(value['positionAt']);
  if (hex === null || lat === null || lon === null || positionAt === null) return null;
  return {
    hex,
    callsign: str(value['callsign']),
    registration: str(value['registration']),
    typeCode: str(value['typeCode']),
    typeName: str(value['typeName']),
    operator: str(value['operator']),
    airline: str(value['airline']),
    lat,
    lon,
    positionAt,
    altitudeFt: num(value['altitudeFt']),
    onGround: value['onGround'] === true,
    groundSpeedKt: num(value['groundSpeedKt']),
    trackDeg: num(value['trackDeg']),
    verticalRateFpm: num(value['verticalRateFpm']),
    distanceNm: num(value['distanceNm']) ?? 0,
    bearingDeg: num(value['bearingDeg']) ?? 0,
    cpa: readCpa(value['cpa']),
    route: readRoute(value['route']),
    notable: readNotable(value['notable']),
    trail: readTrail(value['trail']),
  };
}

function readProviders(value: unknown): ProviderStatus[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((item) => {
    const id = item['id'];
    if (id !== 'airplanes.live' && id !== 'adsb.fi' && id !== 'adsb.lol') return [];
    const state = item['state'] === 'ok' || item['state'] === 'resting' ? item['state'] : 'unused';
    return [{ id, state, until: num(item['until']), lastStatus: num(item['lastStatus']), lastError: str(item['lastError']) }];
  });
}

/** The plugin's answer, or null when it is not a version-1 payload. */
export function readPayload(value: unknown): OverheadPayload | null {
  if (!isRecord(value) || value['version'] !== PAYLOAD_VERSION) return null;
  const generatedAt = num(value['generatedAt']);
  if (generatedAt === null) return null;
  const homeValue = value['home'];
  const home = isRecord(homeValue) && num(homeValue['lat']) !== null && num(homeValue['lon']) !== null ? { lat: homeValue['lat'] as number, lon: homeValue['lon'] as number } : null;
  const provider = value['provider'];
  const aircraft = Array.isArray(value['aircraft']) ? value['aircraft'].map(readAircraft).filter((item): item is OverheadAircraft => item !== null) : [];
  const notable = Array.isArray(value['notable'])
    ? value['notable'].filter(isRecord).flatMap((item) => {
        const hex = str(item['hex']);
        const info = readNotable(item['info']);
        const since = num(item['since']);
        return hex !== null && info !== null && since !== null ? [{ hex, info, since }] : [];
      })
    : [];
  // The settings come back keyed as the plugin's fields; read them the way the manifest's keys are read.
  const settings = isRecord(value['settings']) ? readSettingsFields(value['settings']) : DEFAULT_SETTINGS;
  return {
    version: PAYLOAD_VERSION,
    generatedAt,
    provider: provider === 'airplanes.live' || provider === 'adsb.fi' || provider === 'adsb.lol' || provider === 'mock' ? provider : null,
    dataAt: num(value['dataAt']),
    stale: value['stale'] !== false,
    home,
    settings,
    aircraft,
    notable,
    providers: readProviders(value['providers']),
    requests: Array.isArray(value['requests'])
      ? value['requests'].filter(isRecord).flatMap((item) => {
          const host = str(item['host']);
          const count = num(item['count']);
          return host !== null && count !== null ? [{ host, count, minGapMs: num(item['minGapMs']) }] : [];
        })
      : [],
  };
}

/** Settings sent by field name (the payload), read through the same checks as the manifest keys. */
function readSettingsFields(fields: Record<string, unknown>): OverheadSettings {
  const byKey: Record<string, unknown> = {};
  for (const spec of SETTING_SPECS) byKey[spec.key] = fields[spec.field];
  return readSettings(byKey);
}

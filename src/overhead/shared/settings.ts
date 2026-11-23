/**
 * The Overhead plugin's settings: one table that makes the manifest's
 * `settings` (src/overhead/plugin/manifest.ts), reads what Decaid passes to
 * onLoad and what the skin posts to the plugin's `config` endpoint
 * (docs/overhead/DECISIONS.md, O3), and gives the skin its form.
 *
 * Decaid passes onLoad only the values someone saved, never the manifest's
 * defaults (DISCOVERY.md, section 2), so every reader here applies them.
 * Keys are the manifest's (PascalCase, as Decaid's bundled plugins name
 * theirs); a value out of range or of the wrong type reads as the default.
 */

/** The plugin's id, which is also the directory Decaid keeps it in. */
export const OVERHEAD_PLUGIN_ID = 'overhead.reaplugin';

/** The plugin's endpoints, under /api/v1/plugins/overhead.reaplugin/. */
export const OVERHEAD_ENDPOINT = 'overhead';
export const CONFIG_ENDPOINT = 'config';
/** The WebSocket event a notable aircraft raises as it first comes within range. */
export const NOTABLE_EVENT = 'notable';

/** Never poll faster than this, whatever is asked (the brief; and the providers' one request a second). */
export const MIN_POLL_SECONDS = 2;

export interface OverheadSettings {
  /** Home, where the list and the map centre on. Both null until set: the screensaver then asks for it. */
  homeLat: number | null;
  homeLon: number | null;
  /** The airport arrivals and departures are told from ("From Denver (DEN)"). */
  homeAirport: string;
  /** Aircraft within this many nautical miles are asked for and drawn. */
  radiusNm: number;
  /** The board lists aircraft at or below this altitude, feet. */
  listCeilingFt: number;
  pollIntervalSeconds: number;
  /** A notable aircraft this close, nm, gets its card, wherever it is going. */
  notableRadiusNm: number;
  /** Night dimming from and to, "HH:MM" local time; null (either) for none. */
  nightDimStart: string | null;
  nightDimEnd: string | null;
  /** The brightness at night, Decaid's 0-100. */
  nightBrightness: number;
  /** "Now": passing this close, statute miles, within ± nowWindowSeconds of the closest point. */
  nowCpaMiles: number;
  nowWindowSeconds: number;
  /** "In N min": passing this close, statute miles, within soonWithinMinutes. */
  soonCpaMiles: number;
  soonWithinMinutes: number;
  /** "Just passed" lasts this many seconds after the closest point. */
  passedForSeconds: number;
  /** An optional MapTiler key and map; without a key the map is OpenFreeMap's. */
  mapTilerKey: string | null;
  mapTilerMapId: string;
  /** Replay the recorded fixtures instead of asking anyone (fixtures/overhead/). */
  mockMode: boolean;
}

type Kind = 'number' | 'string' | 'boolean';

interface SettingSpec<K extends keyof OverheadSettings> {
  field: K;
  /** The manifest key. */
  key: string;
  kind: Kind;
  label: string;
  description: string;
  /** The default; null means none (and the field reads null). */
  fallback: OverheadSettings[K];
  min?: number;
  max?: number;
  /** For text: what it must look like. */
  pattern?: RegExp;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Every setting, in the order a form lists them. */
export const SETTING_SPECS: readonly SettingSpec<keyof OverheadSettings>[] = [
  { field: 'homeLat', key: 'HomeLat', kind: 'number', label: 'Home latitude', description: 'Your home, in decimal degrees (41.97, for example). Overhead asks for it before it shows anything.', fallback: null, min: -90, max: 90 },
  { field: 'homeLon', key: 'HomeLon', kind: 'number', label: 'Home longitude', description: 'Your home, in decimal degrees (-87.90, for example; west is negative).', fallback: null, min: -180, max: 180 },
  { field: 'homeAirport', key: 'HomeAirport', kind: 'string', label: 'Home airport', description: 'The ICAO code of the airport arrivals and departures are told from.', fallback: 'KORD', pattern: /^[A-Z0-9]{3,4}$/ },
  { field: 'radiusNm', key: 'RadiusNm', kind: 'number', label: 'Area', description: 'Aircraft within this many nautical miles are shown on the map.', fallback: 25, min: 2, max: 100 },
  { field: 'listCeilingFt', key: 'ListCeilingFt', kind: 'number', label: 'List ceiling', description: 'The board lists aircraft at or below this altitude, in feet.', fallback: 10000, min: 500, max: 60000 },
  { field: 'pollIntervalSeconds', key: 'PollIntervalSeconds', kind: 'number', label: 'Update every', description: 'Seconds between position updates while the screensaver shows (2 at least).', fallback: 5, min: MIN_POLL_SECONDS, max: 60 },
  { field: 'notableRadiusNm', key: 'NotableRadiusNm', kind: 'number', label: 'Notable aircraft area', description: 'A notable aircraft within this many nautical miles gets a card, wherever it is going.', fallback: 25, min: 1, max: 100 },
  { field: 'nightDimStart', key: 'NightDimStart', kind: 'string', label: 'Dim from', description: 'Dim the screen from this time (HH:MM, 24-hour). Empty: never dim.', fallback: null, pattern: HHMM },
  { field: 'nightDimEnd', key: 'NightDimEnd', kind: 'string', label: 'Dim until', description: 'Until this time (HH:MM, 24-hour).', fallback: null, pattern: HHMM },
  { field: 'nightBrightness', key: 'NightBrightness', kind: 'number', label: 'Night brightness', description: 'How bright the screen is while dimmed, 0 to 100.', fallback: 10, min: 0, max: 100 },
  { field: 'nowCpaMiles', key: 'NowCpaMiles', kind: 'number', label: '"Now" within', description: 'An aircraft passing this close, in miles, shows as Now.', fallback: 0.5, min: 0.1, max: 5 },
  { field: 'nowWindowSeconds', key: 'NowWindowSeconds', kind: 'number', label: '"Now" lasts', description: 'Seconds either side of its closest point that an aircraft shows as Now.', fallback: 30, min: 5, max: 120 },
  { field: 'soonCpaMiles', key: 'SoonCpaMiles', kind: 'number', label: '"Soon" within', description: 'An approaching aircraft that will pass this close, in miles, is listed.', fallback: 1.5, min: 0.1, max: 10 },
  { field: 'soonWithinMinutes', key: 'SoonWithinMinutes', kind: 'number', label: '"Soon" from', description: 'Listed this many minutes before it passes.', fallback: 10, min: 1, max: 30 },
  { field: 'passedForSeconds', key: 'PassedForSeconds', kind: 'number', label: '"Just passed" lasts', description: 'Seconds an aircraft stays listed after it passed.', fallback: 60, min: 0, max: 300 },
  { field: 'mapTilerKey', key: 'MapTilerKey', kind: 'string', label: 'MapTiler key', description: 'Optional. With your own MapTiler key the map is MapTiler\'s; without one it is OpenFreeMap\'s, which needs no key.', fallback: null, pattern: /^[A-Za-z0-9_-]{8,128}$/ },
  { field: 'mapTilerMapId', key: 'MapTilerMapId', kind: 'string', label: 'MapTiler map', description: 'The MapTiler map to use with a key.', fallback: 'dataviz-dark', pattern: /^[a-z0-9-]{2,64}$/ },
  { field: 'mockMode', key: 'MockMode', kind: 'boolean', label: 'Replay recorded data', description: 'Show recorded aircraft instead of live ones (for trying Overhead out).', fallback: false },
];

export const DEFAULT_SETTINGS: OverheadSettings = Object.fromEntries(
  SETTING_SPECS.map((spec) => [spec.field, spec.fallback]),
) as unknown as OverheadSettings;

type Read = { ok: true; value: OverheadSettings[keyof OverheadSettings] } | { ok: false };

/** One value as its setting reads it; not ok when it is missing, of the wrong type or out of range. */
function readOne(spec: SettingSpec<keyof OverheadSettings>, value: unknown): Read {
  if (spec.kind === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value };
    if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
    return { ok: false };
  }
  if (spec.kind === 'number') {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(number)) return { ok: false };
    // Polling faster than the floor is asked for often enough to clamp rather than ignore.
    if (spec.min !== undefined && number < spec.min) return spec.field === 'pollIntervalSeconds' ? { ok: true, value: spec.min } : { ok: false };
    if (spec.max !== undefined && number > spec.max) return { ok: false };
    return { ok: true, value: number };
  }
  if (typeof value !== 'string') return { ok: false };
  const trimmed = spec.field === 'homeAirport' ? value.trim().toUpperCase() : value.trim();
  if (trimmed === '' || (spec.pattern && !spec.pattern.test(trimmed))) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * Settings from values keyed as the manifest keys them (Decaid's onLoad, the
 * plugin's storage, a `config` body). Missing or unreadable values read as
 * defaults; home counts only with both halves.
 */
export function readSettings(values: unknown): OverheadSettings {
  const source = typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const settings = { ...DEFAULT_SETTINGS } as Record<keyof OverheadSettings, unknown>;
  for (const spec of SETTING_SPECS) {
    const read = readOne(spec, source[spec.key]);
    settings[spec.field] = read.ok ? read.value : spec.fallback;
  }
  const read = settings as unknown as OverheadSettings;
  if (read.homeLat === null || read.homeLon === null) {
    read.homeLat = null;
    read.homeLon = null;
  }
  return read;
}

/** Only the values in `values` that read as valid, keyed as the manifest keys them (what `config` keeps). */
export function validValues(values: unknown): Record<string, string | number | boolean | null> {
  const source = typeof values === 'object' && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const spec of SETTING_SPECS) {
    if (!(spec.key in source)) continue;
    const raw = source[spec.key];
    // An explicit null or empty text clears a value back to its default.
    if (raw === null || raw === '') {
      out[spec.key] = null;
      continue;
    }
    const read = readOne(spec, raw);
    if (read.ok) out[spec.key] = read.value as string | number | boolean | null;
  }
  return out;
}

/** The settings keyed as the manifest keys them, defaults included (what `config` answers). */
export function settingsValues(settings: OverheadSettings): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const spec of SETTING_SPECS) out[spec.key] = settings[spec.field] as string | number | boolean | null;
  return out;
}

/** Whether a "HH:MM" local time falls inside the night window [start, end), which may cross midnight. */
export function inNightWindow(start: string | null, end: string | null, minutesOfDay: number): boolean {
  if (start === null || end === null || !HHMM.test(start) || !HHMM.test(end)) return false;
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  return from < to ? minutesOfDay >= from && minutesOfDay < to : minutesOfDay >= from || minutesOfDay < to;
}

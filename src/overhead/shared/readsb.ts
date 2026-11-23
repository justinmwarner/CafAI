/**
 * The position providers' answers (docs/overhead/DISCOVERY.md, section 5),
 * as the fixtures in fixtures/overhead/ show them: readsb's aircraft JSON in
 * one of two envelopes, `{ now (s), aircraft: [...] }` from adsb.fi and
 * `{ now (ms), ac: [...] }` from adsb.lol. airplanes.live's could not be
 * seen (it refuses this address), so it is read only if it is one of these.
 *
 * Only the fields Overhead reads are declared, all optional: a provider
 * leaves out `flight` for some aircraft, `track` for aircraft on the ground,
 * `desc` and `ownOp` entirely (adsb.lol), and sends `alt_baro` as a number or
 * the string "ground". Shared by the plugin and the skin, so nothing here may
 * use what Decaid's QuickJS lacks (Intl, TextDecoder, performance).
 */

/** One aircraft as readsb writes it. */
export interface ReadsbAircraft {
  /** ICAO 24-bit address, lower-case hex; a leading "~" marks a non-ICAO (TIS-B) address. */
  hex?: string;
  /** Callsign, right-padded with spaces ("UAL2428 "). */
  flight?: string;
  /** Registration ("N17427"). */
  r?: string;
  /** ICAO type designator ("B39M"). */
  t?: string;
  /** The type in words, adsb.fi only ("BOEING 737 MAX 9"). */
  desc?: string;
  /** Registered owner or operator, adsb.fi only. */
  ownOp?: string;
  /** Barometric altitude in feet, or "ground". */
  alt_baro?: number | 'ground' | string;
  /** Ground speed, knots. */
  gs?: number;
  /** Track over ground, degrees true. Absent on the ground. */
  track?: number;
  /** Climb or descent, feet a minute. */
  baro_rate?: number;
  lat?: number;
  lon?: number;
  /** Seconds since the position was received. */
  seen_pos?: number;
  /** Seconds since anything was received. */
  seen?: number;
  /** Emitter category ("A3"). */
  category?: string;
  squawk?: string;
}

/** A provider's answer, as Overhead reads it. */
export interface ReadsbSnapshot {
  /** When the provider says the data is from, ms since the epoch; null when it did not say. */
  nowMs: number | null;
  aircraft: ReadsbAircraft[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * readsb's `now`: adsb.fi sends seconds (1795440148.0), adsb.lol milliseconds
 * (1795440150002). Anything below 1e11 is seconds (1e11 s is the year 5138).
 */
export function readsbNowMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
}

/**
 * A provider's body as a snapshot, or null when it is not readsb's JSON (an
 * error object such as airplanes.live's `{"error": ...}`, HTML, anything
 * else). Aircraft that are not objects are dropped.
 */
export function readReadsbBody(body: unknown): ReadsbSnapshot | null {
  if (!isRecord(body)) return null;
  const list = Array.isArray(body['ac']) ? body['ac'] : Array.isArray(body['aircraft']) ? body['aircraft'] : null;
  if (list === null) return null;
  return {
    nowMs: readsbNowMs(body['now']),
    aircraft: list.filter(isRecord) as ReadsbAircraft[],
  };
}

/** A finite number, or null. */
export function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trimmed text, or null when empty or not text. */
export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

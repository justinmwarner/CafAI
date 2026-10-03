/**
 * Decaid's profile identity, computed client-side.
 *
 * A byte-exact port of `ProfileHash` (lib/src/models/data/profile_hash.dart at
 * Decaid a45961b, GPL-3.0-or-later, Copyright (C) 2025-2026 Decent Espresso):
 *
 *   id       = "profile:" + sha256(jsonEncode(sortKeys({version, beverage_type,
 *              steps, tank_temperature, target_weight, target_volume,
 *              target_volume_count_start})))[0:20]
 *   metadata = sha256(jsonEncode(sortKeys({title, author, notes})))
 *   compound = sha256(id + ":" + metadata)
 *
 * The values hashed are the parsed ones (Profile.fromJson), so string-valued
 * bundled files and number-valued GET results give the same id. Dart writes
 * every double with a fractional part ("90.0") and the one int field
 * (`target_volume_count_start`) bare; JSON.stringify would write "90", which
 * hashes differently, hence the hand-written encoder.
 */
import { parseDecaidProfile, ProfileError, type DecaidProfile } from './profile.ts';
import { sha256Hex, utf8Bytes } from './sha256.ts';

/** The only int field Decaid hashes; every other number is a double. */
const INT_KEYS: ReadonlySet<string> = new Set(['target_volume_count_start']);

/** Dart `double.toString()` as jsonEncode writes it. */
export function dartDouble(value: number): string {
  if (!Number.isFinite(value)) throw new ProfileError(`Cannot encode ${String(value)}: Dart's jsonEncode refuses it.`);
  if (Object.is(value, -0)) return '-0.0';
  // Both runtimes print the shortest round-trip digits and switch to
  // exponents outside [1e-6, 1e21); Dart only adds ".0" to integral values.
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

function dartInt(value: number): string {
  if (!Number.isInteger(value)) throw new ProfileError(`Cannot encode ${String(value)} as a Dart int.`);
  return String(value);
}

/** jsonEncode(_sortMapKeys(value)): keys sorted recursively, no whitespace. */
function encodeSorted(value: unknown, key: string | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // JSON.stringify escapes strings exactly like Dart: \" \\ \b \t \n \f \r,
  // other control characters as lowercase \u00xx, lone surrogates as \udxxx,
  // and everything else (including non-ASCII) raw.
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return key !== null && INT_KEYS.has(key) ? dartInt(value) : dartDouble(value);
  if (Array.isArray(value)) return `[${value.map((item) => encodeSorted(item, key)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Dart's String.compareTo and JS's default sort both compare UTF-16 code units.
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${encodeSorted(record[k], k)}`).join(',')}}`;
  }
  throw new ProfileError(`Cannot encode a ${typeof value} value${key ? ` at "${key}"` : ''}.`);
}

/** The exact string Decaid hashes for a parsed profile's execution content. */
export function encodeProfileContent(profile: DecaidProfile): string {
  return encodeSorted(
    {
      version: profile.version,
      beverage_type: profile.beverage_type,
      steps: profile.steps,
      tank_temperature: profile.tank_temperature,
      target_weight: profile.target_weight,
      target_volume: profile.target_volume,
      target_volume_count_start: profile.target_volume_count_start,
    },
    null,
  );
}

function contentId(parsed: DecaidProfile): string {
  return `profile:${sha256Hex(utf8Bytes(encodeProfileContent(parsed))).slice(0, 20)}`;
}

function metadataHash(parsed: DecaidProfile): string {
  return sha256Hex(utf8Bytes(encodeSorted({ title: parsed.title, author: parsed.author, notes: parsed.notes }, null)));
}

/**
 * Decaid's record id for a profile: "profile:" + 20 lowercase hex characters.
 * Accepts anything Decaid accepts (numbers or numeric strings, a null
 * version); throws ProfileError where Decaid would refuse the profile.
 */
export function profileId(profile: unknown): string {
  return contentId(parseDecaidProfile(profile));
}

/** Decaid's `metadataHash`: 64 hex characters over title, author and notes. */
export function profileMetadataHash(profile: unknown): string {
  return metadataHash(parseDecaidProfile(profile));
}

/** Decaid's `compoundHash` of a record id and its metadata hash. */
export function profileCompoundHash(profileHash: string, metadataHashHex: string): string {
  return sha256Hex(utf8Bytes(`${profileHash}:${metadataHashHex}`));
}

export interface ProfileHashes {
  profileHash: string;
  metadataHash: string;
  compoundHash: string;
}

/** All three hashes, as on a ProfileRecord. */
export function profileHashes(profile: unknown): ProfileHashes {
  const parsed = parseDecaidProfile(profile);
  const profileHash = contentId(parsed);
  const meta = metadataHash(parsed);
  return { profileHash, metadataHash: meta, compoundHash: profileCompoundHash(profileHash, meta) };
}

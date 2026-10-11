/**
 * Decaid's profile model for the mock: parse like `Profile.fromJson`, emit
 * like `toJson`, and hash like `ProfileHash` (data/profile.dart,
 * data/utils.dart, data/profile_hash.dart at a45961b).
 *
 * The ids are byte-exact, so a profile CafAI creates in the mock gets the
 * same id it would get on a real gateway (verified against the bundled
 * templates and the example record).
 */
import type { WireProfile } from '../../src/api/types.ts';
import type { ProfileStep } from '../../src/coach/types.ts';
import { argumentError, enumNameError, formatException, plainException, typeError } from './errors.ts';
import { isPlainObject, stableDartJson, type JsonObject } from './json.ts';
import { sha256Hex } from './sha256.ts';

const BEVERAGE_TYPES = ['espresso', 'calibrate', 'cleaning', 'manual', 'pourover'] as const;

const DOUBLE_TEXT = /^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|NaN|Infinity)$/;
const INT_TEXT = /^[+-]?\d+$/;

function doubleTryParse(text: string): number | null {
  const trimmed = text.trim();
  if (!DOUBLE_TEXT.test(trimmed)) return null;
  if (trimmed.endsWith('Infinity')) return trimmed.startsWith('-') ? -Infinity : Infinity;
  return Number(trimmed);
}

function intTryParse(text: string): number | null {
  const trimmed = text.trim();
  return INT_TEXT.test(trimmed) ? Number(trimmed) : null;
}

function intParse(text: string): number {
  const value = intTryParse(text);
  if (value === null) throw formatException(`Invalid radix-10 number (at character 1)`);
  return value;
}

/** utils.dart parseDouble. */
function parseDouble(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return doubleTryParse(value) ?? intParse(value);
  throw typeError(value, 'String');
}

/** utils.dart parseOptionalDouble. */
function parseOptionalDouble(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return doubleTryParse(value) ?? intTryParse(value);
  throw typeError(value, 'String');
}

/** utils.dart parseInt: ints stay, doubles truncate, strings must be integers. */
function parseInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') return intParse(value);
  throw typeError(value, 'String');
}

/** utils.dart parseOptionalString. */
function parseOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function byName<T extends string>(values: readonly T[], value: unknown): T {
  if (typeof value !== 'string') throw typeError(value, 'String');
  const found = values.find((candidate) => candidate === value);
  if (!found) throw enumNameError(value);
  return found;
}

function asMap(value: unknown): JsonObject {
  if (!isPlainObject(value)) throw typeError(value, 'Map<String, dynamic>');
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw typeError(value, 'String');
  return value;
}

function parseStep(raw: unknown): ProfileStep {
  const json = asMap(raw);
  const pump = json.pump;
  if (pump !== 'pressure' && pump !== 'flow') {
    throw plainException('Invalid step type. Must include either "pressure" or "flow".');
  }
  // Evaluated in the Dart constructor's argument order, so the first missing
  // field reported matches Decaid's.
  const name = asString(json.name);
  const transition = byName(['fast', 'smooth'] as const, json.transition);
  let exit: ProfileStep['exit'] = null;
  if (json.exit !== null && json.exit !== undefined) {
    const rawExit = asMap(json.exit);
    exit = {
      type: byName(['pressure', 'flow'] as const, rawExit.type),
      condition: byName(['over', 'under'] as const, rawExit.condition),
      value: parseDouble(rawExit.value),
    };
  }
  const volume = parseDouble(json.volume);
  const seconds = parseDouble(json.seconds);
  const weight = parseOptionalDouble(json.weight);
  const temperature = parseDouble(json.temperature);
  const sensor = byName(['coffee', 'water'] as const, json.sensor);
  let limiter: ProfileStep['limiter'] = null;
  if (json.limiter !== null && json.limiter !== undefined) {
    const rawLimiter = asMap(json.limiter);
    limiter = { value: parseDouble(rawLimiter.value), range: parseDouble(rawLimiter.range) };
  }
  const target = parseDouble(pump === 'pressure' ? json.pressure : json.flow);

  // toJson key order: name, pump, transition, exit, volume, seconds, weight,
  // temperature, sensor, pressure|flow, limiter.
  const step: Record<string, unknown> = { name, pump, transition, exit, volume, seconds, weight, temperature, sensor };
  step[pump] = target;
  step.limiter = limiter;
  return step as unknown as ProfileStep;
}

/**
 * Profile.fromJson(json).toJson(): numbers or numeric strings in, numbers
 * out; only the active pump target; explicit null exit/limiter/weight;
 * unknown keys dropped. Throws DartError like Decaid does.
 */
export function normalizeProfile(raw: unknown): WireProfile {
  const json = asMap(raw);
  const title = parseOptionalString(json.title);
  const rawSteps = json.steps;
  if (title === null || title === '') throw argumentError('Profile must have a non-empty "title"');
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw argumentError('Profile must have a non-empty "steps" array');
  if (json.tank_temperature === null || json.tank_temperature === undefined) {
    throw argumentError('Profile must have "tank_temperature"');
  }
  if (json.target_volume_count_start === null || json.target_volume_count_start === undefined) {
    throw argumentError('Profile must have "target_volume_count_start"');
  }

  const version = parseOptionalString(json.version);
  const notes = parseOptionalString(json.notes) ?? '';
  const author = parseOptionalString(json.author) ?? '';
  const beverageName = json.beverage_type === null || json.beverage_type === undefined ? '' : String(json.beverage_type).toLowerCase();
  const beverage_type = BEVERAGE_TYPES.find((type) => type === beverageName) ?? 'espresso';
  const steps = rawSteps.map(parseStep);
  const target_volume = parseOptionalDouble(json.target_volume);
  const target_weight = parseOptionalDouble(json.target_weight);
  const target_volume_count_start = parseInt(json.target_volume_count_start);
  const tank_temperature = parseDouble(json.tank_temperature);

  return {
    version,
    title,
    notes,
    author,
    beverage_type,
    steps,
    target_volume,
    target_weight,
    target_volume_count_start,
    tank_temperature,
  };
}

/** The record id: "profile:" + the first 20 hex chars of the content hash. */
export function profileHash(profile: WireProfile): string {
  const data = {
    version: profile.version,
    beverage_type: profile.beverage_type,
    steps: profile.steps,
    tank_temperature: profile.tank_temperature,
    target_weight: profile.target_weight,
    target_volume: profile.target_volume,
    target_volume_count_start: profile.target_volume_count_start,
  };
  return `profile:${sha256Hex(stableDartJson(data, ['target_volume_count_start'])).slice(0, 20)}`;
}

export function metadataHash(profile: Pick<WireProfile, 'title' | 'author' | 'notes'>): string {
  return sha256Hex(stableDartJson({ title: profile.title, author: profile.author, notes: profile.notes }));
}

export function compoundHash(id: string, metadata: string): string {
  return sha256Hex(`${id}:${metadata}`);
}

/**
 * A profile record as Decaid keeps and sends it, every field
 * (profile_record.dart): CafAI's own ProfileRecord type is only what CafAI
 * reads. A type, not an interface, so it is assignable to that one.
 */
export type DecaidProfileRecord = {
  id: string;
  profile: WireProfile;
  metadataHash: string;
  compoundHash: string;
  parentId: string | null;
  visibility: 'visible' | 'hidden' | 'deleted' | (string & {});
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
};

/** ProfileRecord.create / copyWith: hashes recomputed from the profile. */
export function buildProfileRecord(
  profile: WireProfile,
  fields: {
    parentId?: string | null;
    visibility?: DecaidProfileRecord['visibility'];
    isDefault?: boolean;
    createdAt: string;
    updatedAt?: string;
    metadata?: Record<string, unknown> | null;
  },
): DecaidProfileRecord {
  const id = profileHash(profile);
  const meta = metadataHash(profile);
  return {
    id,
    profile,
    metadataHash: meta,
    compoundHash: compoundHash(id, meta),
    parentId: fields.parentId ?? null,
    visibility: fields.visibility ?? 'visible',
    isDefault: fields.isDefault ?? false,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt ?? fields.createdAt,
    metadata: fields.metadata ?? null,
  };
}

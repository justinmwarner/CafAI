/**
 * Decaid's bean library for the mock: BeansHandler's create and update rules
 * and Bean.fromJson/toJson, BeanBatch.fromJson/toJson (af4e995:
 * lib/src/services/webserver/beans_handler.dart,
 * lib/src/models/data/bean.dart), plus the two seeded beans (D4).
 *
 * Decaid reads a body with Dart casts (`json['roaster'] as String`), so a
 * field of the wrong type is a TypeError; a PUT first refuses explicit nulls
 * for the non-nullable fields and checks a few field types (FormatException).
 * Both land as 400 `{error: e.toString()}` in beans_handler.dart (create's
 * catch-all and update's FormatException/TypeError catches share the same
 * body shape), and a missing id is 404 `{error: '... not found'}`. toJson
 * leaves null fields out. PUT is a shallow merge over the existing record.
 */
import type { Bean, BeanBatch } from '../../src/api/types.ts';
import { clone } from '../../src/util/clone.ts';
import { formatLocalTimestamp, formatUtcTimestamp } from './clock.ts';
import { dartTypeName, MockHttpError } from './errors.ts';
import { isPlainObject, type JsonObject } from './json.ts';

const MOCK_NOTE = "Mock data: seeded by CafAI's test Decaid.";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed ids, so a bean or batch linked in CafAI's Settings is still there after a reload. */
export const MOCK_BEAN_IDS = {
  squareMile: '9b7e3f1a-4c2d-4e8b-9a6f-1d0c5e7b3a82',
  heartCoffee: 'c4a1d8f6-2e9b-4f3a-8c5d-7b0e9a2f6d14',
} as const;

export const MOCK_BATCH_IDS = {
  squareMileBatch: '3e8d2a7c-5f1b-4a9e-b6c3-8d4f0a2e9c51',
  heartCoffeeBatch: '7a2c9e4f-1d6b-4c8a-9e3f-5b7d0c1a8f36',
} as const;

function castError(value: unknown, type: string): MockHttpError {
  return new MockHttpError(400, { error: `type '${dartTypeName(value)}' is not a subtype of type '${type}' in type cast` });
}

function formatError(message: string): MockHttpError {
  return new MockHttpError(400, { error: `FormatException: ${message}` });
}

/**
 * BeanBatches.beanId references Beans(id) (bean_tables.dart:32, enforced by
 * Drift/sqlite3). beans_handler.dart's _createBatch never checks the parent
 * exists itself, but insertBatch still fails the real database's foreign
 * key constraint for an unknown bean, landing in the same generic
 * `catch (e) { return jsonBadRequest({'error': e.toString()}); }` as any
 * other create failure.
 */
export function foreignKeyError(): MockHttpError {
  return new MockHttpError(400, { error: 'SqliteException(787): FOREIGN KEY constraint failed, FOREIGN KEY constraint failed (code 787)' });
}

const isNull = (value: unknown) => value === null || value === undefined;

function asString(value: unknown): string {
  if (typeof value !== 'string') throw castError(value ?? null, 'String');
  return value;
}

function asOptionalString(value: unknown): string | null {
  if (isNull(value)) return null;
  if (typeof value !== 'string') throw castError(value, 'String?');
  return value;
}

function asOptionalBool(value: unknown): boolean | null {
  if (isNull(value)) return null;
  if (typeof value !== 'boolean') throw castError(value, 'bool?');
  return value;
}

function asOptionalNumber(value: unknown): number | null {
  if (isNull(value)) return null;
  if (typeof value !== 'number') throw castError(value, 'num?');
  return value;
}

function asOptionalMap(value: unknown): JsonObject | null {
  if (isNull(value)) return null;
  if (!isPlainObject(value)) throw castError(value, 'Map<String, dynamic>?');
  return value;
}

function asOptionalStringList(value: unknown): string[] | null {
  if (isNull(value)) return null;
  if (!Array.isArray(value)) throw castError(value, 'List<dynamic>?');
  for (const item of value) if (typeof item !== 'string') throw castError(item, 'String');
  return value as string[];
}

function asOptionalIntList(value: unknown): number[] | null {
  if (isNull(value)) return null;
  if (!Array.isArray(value)) throw castError(value, 'List<dynamic>?');
  return value.map((item) => {
    if (typeof item === 'number' && Number.isFinite(item)) return Math.trunc(item);
    throw castError(item, 'int');
  });
}

/** A string carrying 'Z' or an explicit +/-HH:MM offset: DateTime.parse reads it as UTC. */
const DATE_HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** A bare date or date-time, no zone: DateTime.parse reads it as local (Dart's documented rule). */
const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?$/;

/**
 * `DateTime.parse(value as String)`, then `.toIso8601String()`: a non-string
 * throws a cast error, an unparseable one a FormatException. A zone-less
 * string (what a plain "YYYY-MM-DD" or client-sent local timestamp looks
 * like) parses as a local DateTime, whose toIso8601String carries no 'Z' -
 * unlike a date with an explicit zone, which stays UTC. JS's own Date
 * parses a bare date as UTC and a bare date-time as local, inconsistently,
 * so the zone-less case is built from the string's own digits instead of
 * going through Date for the "what zone did Dart use" decision.
 */
function asOptionalDate(value: unknown): string | null {
  if (isNull(value)) return null;
  if (typeof value !== 'string') throw castError(value, 'String?');
  if (DATE_HAS_ZONE.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw formatError(`Invalid date format "${value}"`);
    return formatUtcTimestamp(parsed.getTime());
  }
  const match = DATE_PARTS.exec(value);
  if (!match) throw formatError(`Invalid date format "${value}"`);
  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
  const millis = Number(`0.${fraction}`) * 1000;
  const local = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis);
  if (Number.isNaN(local.getTime())) throw formatError(`Invalid date format "${value}"`);
  return formatLocalTimestamp(local.getTime());
}

// ---- Bean -------------------------------------------------------------------------------

function beanToJson(fields: {
  id: string;
  roaster: string;
  name: string;
  species: string | null;
  decaf: boolean;
  decafProcess: string | null;
  country: string | null;
  region: string | null;
  producer: string | null;
  variety: string[] | null;
  altitude: number[] | null;
  processing: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  extras: JsonObject | null;
}): Bean {
  const json: Record<string, unknown> = { id: fields.id, roaster: fields.roaster, name: fields.name };
  if (fields.species !== null) json.species = fields.species;
  json.decaf = fields.decaf;
  if (fields.decafProcess !== null) json.decafProcess = fields.decafProcess;
  if (fields.country !== null) json.country = fields.country;
  if (fields.region !== null) json.region = fields.region;
  if (fields.producer !== null) json.producer = fields.producer;
  if (fields.variety !== null) json.variety = fields.variety;
  if (fields.altitude !== null) json.altitude = fields.altitude;
  if (fields.processing !== null) json.processing = fields.processing;
  if (fields.notes !== null) json.notes = fields.notes;
  json.archived = fields.archived;
  json.createdAt = fields.createdAt;
  json.updatedAt = fields.updatedAt;
  if (fields.extras !== null) json.extras = fields.extras;
  return clone(json) as unknown as Bean;
}

/** POST /api/v1/beans: Bean.create from the body (archived always starts false). */
export function createBeanRecord(body: unknown, id: string, now: string): Bean {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  const roaster = asString(body.roaster);
  const name = asString(body.name);
  const species = asOptionalString(body.species);
  const decaf = asOptionalBool(body.decaf) ?? false;
  const decafProcess = asOptionalString(body.decafProcess);
  const country = asOptionalString(body.country);
  const region = asOptionalString(body.region);
  const producer = asOptionalString(body.producer);
  const variety = asOptionalStringList(body.variety);
  const altitude = asOptionalIntList(body.altitude);
  const processing = asOptionalString(body.processing);
  const notes = asOptionalString(body.notes);
  const extras = asOptionalMap(body.extras);
  return beanToJson({
    id,
    roaster,
    name,
    species,
    decaf,
    decafProcess,
    country,
    region,
    producer,
    variety,
    altitude,
    processing,
    notes,
    archived: false,
    createdAt: now,
    updatedAt: now,
    extras,
  });
}

const BEAN_NON_NULL_FIELDS = ['roaster', 'name', 'decaf', 'archived'] as const;
const BEAN_INT_LIST_FIELDS = ['altitude'] as const;
const BEAN_STRING_LIST_FIELDS = ['variety'] as const;

/** PUT /api/v1/beans/{id}: Bean.fromJson({...existing, ...body, id, createdAt, updatedAt: now}). */
export function updateBeanRecord(existing: Bean, body: unknown, now: string): Bean {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  for (const field of BEAN_NON_NULL_FIELDS) {
    if (field in body && body[field] === null) throw formatError(`Field "${field}" cannot be null`);
  }
  for (const field of BEAN_INT_LIST_FIELDS) {
    const value = body[field];
    if (!isNull(value) && !(Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isInteger(item)))) {
      throw formatError(`Field "${field}" must be an array of integers or null`);
    }
  }
  for (const field of BEAN_STRING_LIST_FIELDS) {
    const value = body[field];
    if (!isNull(value) && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
      throw formatError(`Field "${field}" must be an array of strings or null`);
    }
  }
  const json: JsonObject = { ...clone(existing), ...clone(body), id: existing.id, createdAt: existing.createdAt, updatedAt: now };
  return beanToJson({
    id: asString(json.id),
    roaster: asString(json.roaster),
    name: asString(json.name),
    species: asOptionalString(json.species),
    decaf: asOptionalBool(json.decaf) ?? false,
    decafProcess: asOptionalString(json.decafProcess),
    country: asOptionalString(json.country),
    region: asOptionalString(json.region),
    producer: asOptionalString(json.producer),
    variety: asOptionalStringList(json.variety),
    altitude: asOptionalIntList(json.altitude),
    processing: asOptionalString(json.processing),
    notes: asOptionalString(json.notes),
    archived: asOptionalBool(json.archived) ?? false,
    // Bean.createdAt is typed optional (external data may omit it); the mock always sets it.
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
    extras: asOptionalMap(json.extras),
  });
}

// ---- BeanBatch --------------------------------------------------------------------------

function batchToJson(fields: {
  id: string;
  beanId: string;
  roastDate: string | null;
  roastLevel: string | null;
  harvestDate: string | null;
  qualityScore: number | null;
  price: number | null;
  currency: string | null;
  weight: number | null;
  weightRemaining: number | null;
  buyDate: string | null;
  openDate: string | null;
  bestBeforeDate: string | null;
  freezeDate: string | null;
  unfreezeDate: string | null;
  frozen: boolean;
  archived: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  extras: JsonObject | null;
}): BeanBatch {
  const json: Record<string, unknown> = { id: fields.id, beanId: fields.beanId };
  if (fields.roastDate !== null) json.roastDate = fields.roastDate;
  if (fields.roastLevel !== null) json.roastLevel = fields.roastLevel;
  if (fields.harvestDate !== null) json.harvestDate = fields.harvestDate;
  if (fields.qualityScore !== null) json.qualityScore = fields.qualityScore;
  if (fields.price !== null) json.price = fields.price;
  if (fields.currency !== null) json.currency = fields.currency;
  if (fields.weight !== null) json.weight = fields.weight;
  if (fields.weightRemaining !== null) json.weightRemaining = fields.weightRemaining;
  if (fields.buyDate !== null) json.buyDate = fields.buyDate;
  if (fields.openDate !== null) json.openDate = fields.openDate;
  if (fields.bestBeforeDate !== null) json.bestBeforeDate = fields.bestBeforeDate;
  if (fields.freezeDate !== null) json.freezeDate = fields.freezeDate;
  if (fields.unfreezeDate !== null) json.unfreezeDate = fields.unfreezeDate;
  json.frozen = fields.frozen;
  json.archived = fields.archived;
  if (fields.notes !== null) json.notes = fields.notes;
  json.createdAt = fields.createdAt;
  json.updatedAt = fields.updatedAt;
  if (fields.extras !== null) json.extras = fields.extras;
  return clone(json) as unknown as BeanBatch;
}

/** POST /api/v1/beans/{beanId}/batches: BeanBatch.create (weightRemaining starts at weight). */
export function createBatchRecord(beanId: string, body: unknown, id: string, now: string): BeanBatch {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  const roastDate = asOptionalDate(body.roastDate);
  const roastLevel = asOptionalString(body.roastLevel);
  const harvestDate = asOptionalString(body.harvestDate);
  const qualityScore = asOptionalNumber(body.qualityScore);
  const price = asOptionalNumber(body.price);
  const currency = asOptionalString(body.currency);
  const weight = asOptionalNumber(body.weight);
  const buyDate = asOptionalDate(body.buyDate);
  const openDate = asOptionalDate(body.openDate);
  const bestBeforeDate = asOptionalDate(body.bestBeforeDate);
  const freezeDate = asOptionalDate(body.freezeDate);
  const unfreezeDate = asOptionalDate(body.unfreezeDate);
  const frozen = asOptionalBool(body.frozen) ?? false;
  const notes = asOptionalString(body.notes);
  const extras = asOptionalMap(body.extras);
  return batchToJson({
    id,
    beanId,
    roastDate,
    roastLevel,
    harvestDate,
    qualityScore,
    price,
    currency,
    weight,
    weightRemaining: weight,
    buyDate,
    openDate,
    bestBeforeDate,
    freezeDate,
    unfreezeDate,
    frozen,
    archived: false,
    notes,
    createdAt: now,
    updatedAt: now,
    extras,
  });
}

const BATCH_NON_NULL_FIELDS = ['frozen', 'archived'] as const;
const BATCH_NUMBER_FIELDS = ['qualityScore', 'price', 'weight', 'weightRemaining'] as const;

/** PUT /api/v1/bean-batches/{id}: BeanBatch.fromJson({...existing, ...body, id, beanId, createdAt, updatedAt: now}). */
export function updateBatchRecord(existing: BeanBatch, body: unknown, now: string): BeanBatch {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  for (const field of BATCH_NON_NULL_FIELDS) {
    if (field in body && body[field] === null) throw formatError(`Field "${field}" cannot be null`);
  }
  for (const field of BATCH_NUMBER_FIELDS) {
    if (!isNull(body[field]) && typeof body[field] !== 'number') throw formatError(`Field "${field}" must be a number or null`);
  }
  const json: JsonObject = { ...clone(existing), ...clone(body), id: existing.id, beanId: existing.beanId, createdAt: existing.createdAt, updatedAt: now };
  return batchToJson({
    id: asString(json.id),
    beanId: asString(json.beanId),
    roastDate: asOptionalDate(json.roastDate),
    roastLevel: asOptionalString(json.roastLevel),
    harvestDate: asOptionalString(json.harvestDate),
    qualityScore: asOptionalNumber(json.qualityScore),
    price: asOptionalNumber(json.price),
    currency: asOptionalString(json.currency),
    weight: asOptionalNumber(json.weight),
    weightRemaining: asOptionalNumber(json.weightRemaining),
    buyDate: asOptionalDate(json.buyDate),
    openDate: asOptionalDate(json.openDate),
    bestBeforeDate: asOptionalDate(json.bestBeforeDate),
    freezeDate: asOptionalDate(json.freezeDate),
    unfreezeDate: asOptionalDate(json.unfreezeDate),
    frozen: asOptionalBool(json.frozen) ?? false,
    archived: asOptionalBool(json.archived) ?? false,
    notes: asOptionalString(json.notes),
    // BeanBatch.createdAt is typed optional too; the mock always sets it.
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
    extras: asOptionalMap(json.extras),
  });
}

// ---- seed ---------------------------------------------------------------------------------

export interface SeededBeans {
  beans: Bean[];
  batches: BeanBatch[];
}

/**
 * Two plausible beans with a batch each, for the demo and for tests that need
 * a non-empty library (D4). `nowMs` is the mock's data clock at creation.
 * The first bean's batch was roasted 9 days ago; the second's 30 days ago,
 * frozen for 12 of those (so its effective age is the usual 18 days).
 */
export function seedBeans(nowMs: number): SeededBeans {
  // Local, no zone: the same convention a freshly created Bean/BeanBatch gets (asOptionalDate).
  const iso = formatLocalTimestamp;
  const roastedAt9 = nowMs - 9 * DAY_MS;
  const roastedAt30 = nowMs - 30 * DAY_MS;
  const frozenAt = roastedAt30 + 1 * DAY_MS;
  const unfrozenAt = frozenAt + 12 * DAY_MS;

  const squareMile: Bean = {
    id: MOCK_BEAN_IDS.squareMile,
    roaster: 'Square Mile Coffee Roasters',
    name: 'Red Brick',
    decaf: false,
    country: 'Brazil',
    region: 'Mogiana',
    processing: 'washed',
    notes: MOCK_NOTE,
    archived: false,
    createdAt: iso(roastedAt9),
    updatedAt: iso(roastedAt9),
    extras: { mockData: true },
  };
  const squareMileBatch: BeanBatch = {
    id: MOCK_BATCH_IDS.squareMileBatch,
    beanId: squareMile.id,
    roastDate: iso(roastedAt9),
    roastLevel: 'medium',
    frozen: false,
    archived: false,
    createdAt: iso(roastedAt9),
    updatedAt: iso(roastedAt9),
    extras: { mockData: true },
  };

  const heartCoffee: Bean = {
    id: MOCK_BEAN_IDS.heartCoffee,
    roaster: 'Heart Coffee Roasters',
    name: 'Ethiopia Chelchele',
    decaf: false,
    country: 'Ethiopia',
    region: 'Guji',
    processing: 'natural',
    notes: MOCK_NOTE,
    archived: false,
    createdAt: iso(roastedAt30),
    updatedAt: iso(roastedAt30),
    extras: { mockData: true },
  };
  const heartCoffeeBatch: BeanBatch = {
    id: MOCK_BATCH_IDS.heartCoffeeBatch,
    beanId: heartCoffee.id,
    roastDate: iso(roastedAt30),
    roastLevel: 'light',
    freezeDate: iso(frozenAt),
    unfreezeDate: iso(unfrozenAt),
    frozen: false,
    archived: false,
    createdAt: iso(roastedAt30),
    updatedAt: iso(unfrozenAt),
    extras: { mockData: true },
  };

  return { beans: [squareMile, heartCoffee], batches: [squareMileBatch, heartCoffeeBatch] };
}

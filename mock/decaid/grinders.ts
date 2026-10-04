/**
 * Decaid's grinder library for the mock: GrindersHandler's create and update
 * rules and Grinder.fromJson/toJson (a45961b: lib/src/services/webserver/
 * grinders_handler.dart, lib/src/models/data/grinder.dart), plus the seeded
 * test grinders.
 *
 * Decaid reads a body with Dart casts (`json['model'] as String`), so a field
 * of the wrong type is a TypeError, answered 400 `{error: e.toString()}`; a
 * PUT first refuses explicit nulls for model/archived/settingType and checks
 * the number and string-list fields (FormatException, also 400). toJson
 * leaves null fields out. PUT is a shallow merge, so `extras` is replaced.
 */
import type { Grinder, GrinderSettingType } from '../../src/api/grinders.ts';
import { clone } from '../../src/util/clone.ts';
import { dartTypeName, MockHttpError } from './errors.ts';
import { isPlainObject, type JsonObject } from './json.ts';

/** A grinder as the mock stores it: Decaid always has both timestamps. */
export type GrinderRecord = Grinder & { createdAt: string; updatedAt: string };

/**
 * Fixed ids, so a grinder linked in CafAI's Settings is still there after a
 * page reload. The Niche Zero is the grinder the example workflow and shots
 * already name (mock/fixtures, docs/verified/examples).
 */
export const MOCK_GRINDER_IDS = {
  nicheZero: '2c9e7a41-5b3d-4e8f-a6c2-91d0f4b8e735',
  comandante: '7f3b2d18-6c4e-4a95-b1d7-3e8c0a5f9b62',
  encore: 'e41a9c07-2d6b-4f38-9e5c-b0d3a7f61c84',
} as const;

const MOCK_NOTE = "Mock data: seeded by CafAI's test Decaid.";

/** Newest edit first, like `getAllGrinders`. */
export function seedGrinders(): GrinderRecord[] {
  return [
    {
      id: MOCK_GRINDER_IDS.nicheZero,
      model: 'Niche Zero',
      burrs: '63 mm conical',
      burrSize: 63,
      burrType: 'conical',
      notes: MOCK_NOTE,
      archived: false,
      settingType: 'numeric',
      settingSmallStep: 0.5,
      settingBigStep: 2,
      createdAt: '2026-09-20T09:12:41.508113',
      updatedAt: '2026-09-28T07:30:05.114862',
      extras: { mockData: true },
    },
    {
      id: MOCK_GRINDER_IDS.comandante,
      model: 'Comandante C40 MK4',
      burrs: 'Nitro Blade',
      burrSize: 39,
      burrType: 'conical',
      notes: MOCK_NOTE,
      archived: false,
      settingType: 'numeric',
      settingSmallStep: 1,
      settingBigStep: 5,
      createdAt: '2026-09-19T18:40:02.771020',
      updatedAt: '2026-09-27T16:02:44.390417',
      extras: { mockData: true },
    },
    {
      id: MOCK_GRINDER_IDS.encore,
      model: 'Baratza Encore ESP',
      burrs: '40 mm conical (M2)',
      burrSize: 40,
      burrType: 'conical',
      notes: MOCK_NOTE,
      archived: false,
      settingType: 'preset',
      settingValues: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      createdAt: '2026-09-18T08:05:19.003311',
      updatedAt: '2026-09-26T11:47:30.652009',
      extras: { mockData: true },
    },
  ];
}

export function sortGrinders(grinders: GrinderRecord[]): GrinderRecord[] {
  return [...grinders].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

// ---- Dart casts --------------------------------------------------------------------

/** What `value as T` throws, as GrindersHandler reports it. */
function castError(value: unknown, type: string): MockHttpError {
  return new MockHttpError(400, { error: `type '${dartTypeName(value)}' is not a subtype of type '${type}' in type cast` });
}

function formatError(message: string): MockHttpError {
  return new MockHttpError(400, { error: `FormatException: ${message}` });
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

function asOptionalNumber(value: unknown): number | null {
  if (isNull(value)) return null;
  if (typeof value !== 'number') throw castError(value, 'num?');
  return value;
}

function asOptionalBool(value: unknown): boolean | null {
  if (isNull(value)) return null;
  if (typeof value !== 'boolean') throw castError(value, 'bool?');
  return value;
}

function asOptionalList(value: unknown): unknown[] | null {
  if (isNull(value)) return null;
  if (!Array.isArray(value)) throw castError(value, 'List<dynamic>?');
  return value;
}

function asOptionalMap(value: unknown): JsonObject | null {
  if (isNull(value)) return null;
  if (!isPlainObject(value)) throw castError(value, 'Map<String, dynamic>?');
  return value;
}

/** `.cast<String>()` is lazy in Dart: a bad element fails once the list is used, after every other field. */
function stringList(list: unknown[] | null): string[] | null {
  if (list === null) return null;
  for (const item of list) if (typeof item !== 'string') throw castError(item, 'String');
  return list as string[];
}

function settingTypeFrom(value: unknown): GrinderSettingType {
  if (isNull(value)) return 'numeric';
  const name = asString(value);
  return name === 'values' || name === 'preset' ? 'preset' : 'numeric';
}

// ---- the model --------------------------------------------------------------------------

interface GrinderFields {
  id: string;
  model: string;
  burrs: string | null;
  burrSize: number | null;
  burrType: string | null;
  notes: string | null;
  archived: boolean;
  settingType: GrinderSettingType;
  settingValues: string[] | null;
  settingSmallStep: number | null;
  settingBigStep: number | null;
  rpmSmallStep: number | null;
  rpmBigStep: number | null;
  createdAt: string;
  updatedAt: string;
  extras: JsonObject | null;
}

/** Grinder.toJson(): null fields are left out, keys in Decaid's order. */
function toJson(fields: GrinderFields): GrinderRecord {
  const json: Record<string, unknown> = { id: fields.id, model: fields.model };
  if (fields.burrs !== null) json.burrs = fields.burrs;
  if (fields.burrSize !== null) json.burrSize = fields.burrSize;
  if (fields.burrType !== null) json.burrType = fields.burrType;
  if (fields.notes !== null) json.notes = fields.notes;
  json.archived = fields.archived;
  json.settingType = fields.settingType;
  if (fields.settingValues !== null) json.settingValues = fields.settingValues;
  if (fields.settingSmallStep !== null) json.settingSmallStep = fields.settingSmallStep;
  if (fields.settingBigStep !== null) json.settingBigStep = fields.settingBigStep;
  if (fields.rpmSmallStep !== null) json.rpmSmallStep = fields.rpmSmallStep;
  if (fields.rpmBigStep !== null) json.rpmBigStep = fields.rpmBigStep;
  json.createdAt = fields.createdAt;
  json.updatedAt = fields.updatedAt;
  if (fields.extras !== null) json.extras = fields.extras;
  return clone(json) as unknown as GrinderRecord;
}

/** POST /api/v1/grinders: Grinder.create from the body (archived always starts false). */
export function createGrinderRecord(body: unknown, id: string, now: string): GrinderRecord {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  // Named arguments are evaluated in this order, so the first bad field reported matches Decaid's.
  const model = asString(body.model);
  const burrs = asOptionalString(body.burrs);
  const burrSize = asOptionalNumber(body.burrSize);
  const burrType = asOptionalString(body.burrType);
  const notes = asOptionalString(body.notes);
  const settingType = settingTypeFrom(body.settingType);
  const settingValues = asOptionalList(body.settingValues);
  const settingSmallStep = asOptionalNumber(body.settingSmallStep);
  const settingBigStep = asOptionalNumber(body.settingBigStep);
  const rpmSmallStep = asOptionalNumber(body.rpmSmallStep);
  const rpmBigStep = asOptionalNumber(body.rpmBigStep);
  const extras = asOptionalMap(body.extras);
  return toJson({
    id,
    model,
    burrs,
    burrSize,
    burrType,
    notes,
    archived: false,
    settingType,
    settingValues: stringList(settingValues),
    settingSmallStep,
    settingBigStep,
    rpmSmallStep,
    rpmBigStep,
    createdAt: now,
    updatedAt: now,
    extras,
  });
}

const NON_NULL_FIELDS = ['model', 'archived', 'settingType'] as const;
const NUMBER_FIELDS = ['burrSize', 'settingSmallStep', 'settingBigStep', 'rpmSmallStep', 'rpmBigStep'] as const;

/** PUT /api/v1/grinders/{id}: Grinder.fromJson({...existing, ...body, id, createdAt, updatedAt: now}). */
export function updateGrinderRecord(existing: GrinderRecord, body: unknown, now: string): GrinderRecord {
  if (!isPlainObject(body)) throw castError(body ?? null, 'Map<String, dynamic>');
  for (const field of NON_NULL_FIELDS) {
    if (field in body && body[field] === null) throw formatError(`Field "${field}" cannot be null`);
  }
  for (const field of NUMBER_FIELDS) {
    if (!isNull(body[field]) && typeof body[field] !== 'number') throw formatError(`Field "${field}" must be a number or null`);
  }
  const values = body.settingValues;
  if (!isNull(values) && !(Array.isArray(values) && values.every((item) => typeof item === 'string'))) {
    throw formatError('Field "settingValues" must be an array of strings or null');
  }
  const json: JsonObject = { ...clone(existing), ...clone(body), id: existing.id, createdAt: existing.createdAt, updatedAt: now };
  return toJson({
    id: asString(json.id),
    model: asString(json.model),
    burrs: asOptionalString(json.burrs),
    burrSize: asOptionalNumber(json.burrSize),
    burrType: asOptionalString(json.burrType),
    notes: asOptionalString(json.notes),
    archived: asOptionalBool(json.archived) ?? false,
    settingType: settingTypeFrom(json.settingType),
    settingValues: stringList(asOptionalList(json.settingValues)),
    settingSmallStep: asOptionalNumber(json.settingSmallStep),
    settingBigStep: asOptionalNumber(json.settingBigStep),
    rpmSmallStep: asOptionalNumber(json.rpmSmallStep),
    rpmBigStep: asOptionalNumber(json.rpmBigStep),
    createdAt: existing.createdAt,
    updatedAt: now,
    extras: asOptionalMap(json.extras),
  });
}

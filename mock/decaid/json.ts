/**
 * JSON helpers that reproduce Decaid's own behaviour.
 */

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decaid's deepMergeJson (lib/src/models/data/json_utils.dart): objects merge
 * key by key, everything else (arrays, scalars, an explicit null) replaces
 * the old value wholesale. Inputs are not mutated.
 */
export function deepMergeJson(base: JsonObject, updates: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const key of Object.keys(updates)) {
    const updateValue = updates[key];
    const baseValue = result[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(updateValue) ? deepMergeJson(baseValue, updateValue) : updateValue;
  }
  return result;
}

/** Dart's double.toString(): integral values keep a ".0". */
export function dartDouble(value: number): string {
  if (!Number.isFinite(value)) return 'null';
  return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value);
}

/**
 * `jsonEncode(_sortMapKeys(value))` as ProfileHash computes it: keys sorted
 * recursively, no whitespace, every number a Dart double except the keys in
 * `intKeys` (target_volume_count_start is the only int a profile hashes).
 */
export function stableDartJson(value: unknown, intKeys: readonly string[] = [], key = ''): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return intKeys.includes(key) ? String(Math.trunc(value)) : dartDouble(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableDartJson(item, intKeys, key)).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((name) => value[name] !== undefined)
      .sort();
    return `{${keys.map((name) => `${JSON.stringify(name)}:${stableDartJson(value[name], intKeys, name)}`).join(',')}}`;
  }
  return 'null';
}

/**
 * Deep copy for plain JSON data (profiles, records, messages).
 *
 * structuredClone() is Chromium 98+. Everything CafAI clones is JSON on the
 * wire anyway, so a JSON round trip is exact for it and works everywhere.
 */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

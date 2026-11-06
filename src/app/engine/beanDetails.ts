/**
 * The bag's later details (D278) as Decaid's bean library holds them: the
 * varieties as a list of names, the altitude as a range of whole metres
 * ([min, max]). CafAI keeps both as text, the way the bag writes them, and
 * turns them into Decaid's shapes and back here. Nothing here guesses: a
 * text CafAI cannot read as metres is left out of what Decaid gets.
 */

/** Feet to metres. */
const FOOT_M = 0.3048;
/** Coffee grows from sea level to about 2,800 m; a number outside this is not an altitude in metres. */
const MIN_M = 0;
const MAX_M = 3500;

/** Decaid's varieties as one line ("Castillo, Caturra"); null for none or anything that is not a list of names. */
export function varietyText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const names = value.filter((name): name is string => typeof name === 'string').map((name) => name.trim()).filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

/** The varieties as Decaid takes them: the names apart, by commas, slashes, "and" or "&". */
export function varietyList(text: string | null | undefined): string[] | null {
  if (!text) return null;
  const names = text
    .split(/\s*(?:,|\/|;|&|\band\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

/** Decaid's altitude ([min, max] in metres) as text: "1,950 m", "1,800-2,200 m"; null for anything else. */
export function altitudeText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const metres = value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).map((n) => Math.round(n));
  if (metres.length === 0) return null;
  const low = Math.min(...metres);
  const high = Math.max(...metres);
  const written = (n: number) => n.toLocaleString('en-US');
  return low === high ? `${written(low)} m` : `${written(low)}-${written(high)} m`;
}

/**
 * The altitude as Decaid takes it, [min, max] in whole metres, read from
 * the bag's words: "1,950 masl", "1800 - 2000m", "1.900 msnm", "6,000 ft".
 * Null when the words hold no number, more than two, or one that is no
 * altitude in metres.
 */
export function altitudeRange(text: string | null | undefined): number[] | null {
  if (!text) return null;
  // Thousands written with a comma, a dot or a thin space ("1,950", "1.950", "1 950") are one number.
  const joined = text.replace(/(\d)[,.\u202f\u00a0 ](?=\d{3}(?!\d))/g, '$1');
  const numbers = (joined.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length === 0 || numbers.length > 2) return null;
  const feet = /\b(?:ft|feet|foot)\b|['′]/i.test(joined);
  const metres = numbers.map((n) => Math.round(feet ? n * FOOT_M : n));
  if (metres.some((m) => m < MIN_M || m > MAX_M)) return null;
  return [Math.min(...metres), Math.max(...metres)];
}

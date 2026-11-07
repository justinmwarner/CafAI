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
/** No farm's highest altitude is ten times its lowest: "lot 7, 1,900 m" is no range. */
const MAX_SPAN = 10;

/**
 * Decaid's varieties as one line ("Castillo, Caturra"), whole names only, up
 * to `max` characters: a name that does not fit is left out with the ones
 * after it, never cut in two ("…, Catim"). Null for none or anything that is
 * not a list of names.
 */
export function varietyText(value: unknown, max = Infinity): string | null {
  const listed: unknown = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(listed)) return null;
  const names = listed.filter((name): name is string => typeof name === 'string').map((name) => name.trim()).filter(Boolean);
  let line = '';
  for (const name of names) {
    const longer = line === '' ? name : `${line}, ${name}`;
    if (longer.length > max) break;
    line = longer;
  }
  // A first name longer than the whole line is cut, as any detail too long is.
  const first = names[0];
  if (line === '' && first !== undefined) line = first.slice(0, max).trim();
  return line || null;
}

/**
 * The varieties as Decaid takes them: the names apart where the text lists
 * them, by commas or semicolons (the bag's details write them comma
 * separated), never inside brackets: "Catuaí (Red, Yellow)" is one name.
 * "&", "and" and "/" stay inside a name, as in "Red & Yellow Catuaí" and
 * "SL28/34".
 */
export function varietyList(text: string | null | undefined): string[] | null {
  if (!text) return null;
  const names: string[] = [];
  let name = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(' || char === '[') depth++;
    else if ((char === ')' || char === ']') && depth > 0) depth--;
    if (depth === 0 && (char === ',' || char === ';' || char === '\n')) {
      names.push(name);
      name = '';
    } else {
      name += char;
    }
  }
  names.push(name);
  const kept = names.map((each) => each.trim()).filter(Boolean);
  return kept.length > 0 ? kept : null;
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

type AltitudeUnit = 'm' | 'ft' | null;

/** The unit written right after a number, if any: "1,950 masl", "2,500ft", "3,000’". */
function unitAfter(rest: string): AltitudeUnit {
  if (/^\s*(?:ft\b|feet\b|foot\b|['’′])/i.test(rest)) return 'ft';
  if (/^\s*m(?:asl|snm|eters?|etres?|ts?)?(?![a-z])/i.test(rest)) return 'm';
  return null;
}

/** Between two numbers of one range or list, nothing but a dash, a comma or a joining word: "1,800 - 2,000 m", "1,700, 1,800 or 1,900 m". */
const JOINS = /^[\s,/&~\-–—]*(?:(?:to|a|y|or|and|bis)[\s,/&~\-–—]*)?$/i;

/**
 * The altitude as Decaid takes it, [min, max] in whole metres, read from
 * the bag's words: "1,950 masl", "1800 - 2000m", "1.900 msnm", "6,000 ft",
 * "2,500ft". Each number takes the unit written after it, or after the last
 * number of its range or list; metres win over feet ("1,950 m (6,400 ft)"),
 * and a number with no unit is read as metres only when no number has one
 * ("1,900 m (lot 7)" is 1,900 m). Null when the words hold no number, more
 * than two, a range no farm spans, or one that is no altitude in metres.
 */
export function altitudeRange(text: string | null | undefined): number[] | null {
  if (!text) return null;
  // Thousands written with a comma, a dot or a space, thin or not ("1,950", "1.950", "1 950"), are one number.
  const joined = text.replace(/(\d)[,.\u2009\u202f\u00a0 ](?=\d{3}(?!\d))/g, '$1');
  const found = [...joined.matchAll(/\d+(?:\.\d+)?/g)].map((match) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    return { value: Number(match[0]), start, end, unit: unitAfter(joined.slice(end)) };
  });
  // A number with no unit of its own takes the unit of the next number in its range or list.
  for (let i = found.length - 2; i >= 0; i--) {
    const number = found[i];
    const next = found[i + 1];
    if (number && next && number.unit === null && JOINS.test(joined.slice(number.end, next.start))) number.unit = next.unit;
  }
  const unit: AltitudeUnit = found.some((n) => n.unit === 'm') ? 'm' : found.some((n) => n.unit === 'ft') ? 'ft' : null;
  const numbers = found.filter((n) => n.unit === unit).map((n) => n.value);
  if (numbers.length === 0 || numbers.length > 2) return null;
  const metres = numbers.map((n) => Math.round(unit === 'ft' ? n * FOOT_M : n));
  if (metres.some((m) => m < MIN_M || m > MAX_M)) return null;
  const low = Math.min(...metres);
  const high = Math.max(...metres);
  if (high > Math.max(low, 1) * MAX_SPAN) return null;
  return [low, high];
}

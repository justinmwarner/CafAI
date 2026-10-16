/**
 * Temperatures in the barista's unit (D-TEMP-1): °C or °F wherever a person
 * reads or types one, while Decaid, the profiles, the coach's tools and
 * CafAI's own records keep °C, as streamline does (its units.js: "Celsius on
 * the wire, a pure display-layer conversion"). Pure, so the screens, the
 * coach's prompt and the scripted coach share it.
 *
 * Two conversions, never mixed up: a temperature is °C × 1.8 + 32 (92 °C is
 * 197.6 °F); a change of temperature is × 1.8, without the 32 (1 °C hotter is
 * 1.8 °F hotter).
 *
 * inTemperatureUnit rewrites the temperatures in a sentence into the
 * barista's unit (D-TEMP-6): the coach's words when it slips, CafAI's own
 * change lines, which are kept in °C, and the care guide. A number reads as a
 * change when its words say so (a sign, "by", a comparative after it) or when
 * it is too small to be an espresso temperature; otherwise as a temperature.
 */

export type TemperatureUnit = 'celsius' | 'fahrenheit';

export const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = 'celsius';

export function isTemperatureUnit(value: unknown): value is TemperatureUnit {
  return value === 'celsius' || value === 'fahrenheit';
}

/** A temperature in °C as °F. */
export function toFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

/** A temperature in °F as °C. */
export function toCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) / 1.8;
}

/** A temperature in °C, in `unit`. */
export function temperatureIn(celsius: number, unit: TemperatureUnit): number {
  return unit === 'fahrenheit' ? toFahrenheit(celsius) : celsius;
}

/** A change of temperature in °C, in `unit`: × 1.8 in °F, never the 32. */
export function changeIn(celsius: number, unit: TemperatureUnit): number {
  return unit === 'fahrenheit' ? celsius * 1.8 : celsius;
}

/** "°C" or "°F", as it follows a number. */
export function temperatureSymbol(unit: TemperatureUnit): '°C' | '°F' {
  return unit === 'fahrenheit' ? '°F' : '°C';
}

/** The unit as a screen reader says it. */
export function spokenTemperatureUnit(unit: TemperatureUnit): string {
  return unit === 'fahrenheit' ? 'degrees Fahrenheit' : 'degrees Celsius';
}

/** A temperature in °C as the barista reads it: "92.4 °C", "198.3 °F". */
export function formatTemperatureIn(celsius: number, unit: TemperatureUnit, digits = 1): string {
  return `${temperatureIn(celsius, unit).toFixed(digits)} ${temperatureSymbol(unit)}`;
}

// ---------------------------------------------------------------------------
// Temperatures in a sentence
// ---------------------------------------------------------------------------

const NUMBER = String.raw`\d+(?:\.\d+)?`;
/** A sign makes a number a change: "+1.0 °C", "-0.5 °C", "−1 °C", "±1 °C". */
const SIGN = '[+\\-−±]';
/** Between the two ends of a range: "88-94", "88–94", "1 to 2", "88 and 94", "1 or 2". */
const SEPARATOR = String.raw`(?:\s*[-–]\s*|\s+(?:to|and|or)\s+)`;

/** Each unit as a sentence may write it after a number: "°C", "ºC", "℃", "degrees C", "degrees Celsius". */
const UNIT_WORDS: Record<TemperatureUnit, { letter: string; name: string; sign: string }> = {
  celsius: { letter: 'C', name: 'Celsius', sign: '℃' },
  fahrenheit: { letter: 'F', name: 'Fahrenheit', sign: '℉' },
};

function unitPattern(unit: TemperatureUnit): string {
  const { letter, name, sign } = UNIT_WORDS[unit];
  return String.raw`(?:\s?[°º]\s?[${letter}${letter.toLowerCase()}](?![A-Za-z])|\s?${sign}|\s+degrees?\s+(?:${name}|${letter})(?![A-Za-z]))`;
}

/** A temperature or a range of them, with its unit: sign, first number, separator, second sign, second number, unit. */
function temperaturePattern(unit: TemperatureUnit): string {
  return String.raw`(?<![\w.,])(${SIGN})?(${NUMBER})(?:(${SEPARATOR})(${SIGN})?(${NUMBER}))?(${unitPattern(unit)})`;
}

/** The same, without its groups, to find a temperature beside another one. */
function plainPattern(unit: TemperatureUnit): string {
  return String.raw`(?<![\w.,])${SIGN}?${NUMBER}(?:${SEPARATOR}${SIGN}?${NUMBER})?${unitPattern(unit)}`;
}

const APPROXIMATELY = String.raw`(?:about\s+|around\s+|roughly\s+|approximately\s+|~\s?|≈\s?)?`;

/** Words after a temperature that make it a change: "1 °C hotter", "1-3 °C under its target", "2 °C per change". */
const CHANGE_AFTER =
  /^\s+(?:hotter|cooler|warmer|colder|higher|lower|more|less|under|over|above|below|per|up|down|apart|behind|lag|lags|change|changes|difference|drop|rise|increase|decrease|shift)\b/i;
/** Words before it: "by 1 °C". */
const CHANGE_BEFORE = /\bby\s*$/i;
/** Beside an arrow it is a setting before or after a change: "Tank temperature: 0.0 °C -> 1.0 °C". */
const ARROW_AFTER = /^\s*(?:->|→)/;
const ARROW_BEFORE = /(?:->|→)\s*$/;
/**
 * Under this, a number with no other sign of what it is reads as a change: no
 * brew, steam or hot water temperature is under 30 °C (86 °F), and no change
 * the coach makes comes near it.
 */
const CHANGE_BELOW: Record<TemperatureUnit, number> = { celsius: 30, fahrenheit: 50 };

function decimalsOf(text: string): number {
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
}

/** "199", "198.5", "1.8", "9": as precise as it was written, one decimal at most; a change gets its decimal unless it is whole. */
function numberText(value: number, written: string, change: boolean): string {
  const rounded = Math.round(value * 10) / 10;
  const decimal = decimalsOf(written) > 0 || (change && !Number.isInteger(rounded));
  // Never "-0" for a value that rounds to nothing.
  const shown = Math.abs(rounded) < 0.05 ? 0 : rounded;
  return decimal ? shown.toFixed(1) : Math.round(value).toFixed(0).replace(/^-0$/, '0');
}

/** The unit in the barista's words: "°F", or "degrees Fahrenheit" where the sentence spelt it out. */
function unitText(written: string, to: TemperatureUnit): string {
  const { letter, name } = UNIT_WORDS[to];
  if (/degrees?\s+(?:Celsius|Fahrenheit)/i.test(written)) return ` degrees ${name}`;
  if (/degrees?\s+[CF]/i.test(written)) return ` degrees ${letter}`;
  return ` ${temperatureSymbol(to)}`;
}

function convert(value: number, from: TemperatureUnit, to: TemperatureUnit, change: boolean): number {
  if (from === to) return value;
  if (change) return from === 'celsius' ? value * 1.8 : value / 1.8;
  return from === 'celsius' ? toFahrenheit(value) : toCelsius(value);
}

/** The other unit: the one a sentence written for someone else may use. */
function otherUnit(unit: TemperatureUnit): TemperatureUnit {
  return unit === 'fahrenheit' ? 'celsius' : 'fahrenheit';
}

/**
 * "93 °C (199 °F)", "93 °C / 199 °F", "199 °F (93 °C)" and "199 °F / 93 °C",
 * written for a barista who reads `to`: each keeps the barista's half, the
 * first group of each pattern.
 */
function doublesFor(to: TemperatureUnit): readonly RegExp[] {
  const theirs = plainPattern(otherUnit(to));
  const ours = plainPattern(to);
  return [
    String.raw`${theirs}\s*\(\s*(${APPROXIMATELY}${ours})\s*\)`,
    String.raw`(${ours})\s*\(\s*${APPROXIMATELY}${theirs}\s*\)`,
    String.raw`${theirs}\s*/\s*(${ours})`,
    String.raw`(${ours})\s*/\s*${theirs}`,
  ].map((source) => new RegExp(source, 'g'));
}

/** Built once: the chat rewrites a coach's reply on every streamed piece of it. */
const DOUBLES: Record<TemperatureUnit, readonly RegExp[]> = { celsius: doublesFor('celsius'), fahrenheit: doublesFor('fahrenheit') };

/**
 * A temperature said to be one in the barista's unit, "200 °F is 93.3 °C",
 * "93 °C = 199.4 °F": a conversion asked for, left as written. Keyed by the
 * barista's unit; `after` and `before` are the text either side of the other
 * unit's temperature.
 */
function pairedFor(to: TemperatureUnit): { after: RegExp; before: RegExp } {
  const ours = plainPattern(to);
  const is = String.raw`(?:is|equals|makes)\b|=`;
  return {
    after: new RegExp(String.raw`^\s*(?:${is})\s*${APPROXIMATELY}${ours}`, 'i'),
    before: new RegExp(String.raw`${ours}\s*(?:${is})\s*${APPROXIMATELY}$`, 'i'),
  };
}
const PAIRED: Record<TemperatureUnit, { after: RegExp; before: RegExp }> = { celsius: pairedFor('celsius'), fahrenheit: pairedFor('fahrenheit') };
const PATTERNS: Record<TemperatureUnit, RegExp> = {
  celsius: new RegExp(temperaturePattern('celsius'), 'g'),
  fahrenheit: new RegExp(temperaturePattern('fahrenheit'), 'g'),
};

function dropDoubles(text: string, to: TemperatureUnit): string {
  return DOUBLES[to].reduce((sentence, pattern) => sentence.replace(pattern, '$1'), text);
}

/** Any unit at all: a degree sign, ℃ or ℉, or "degrees". */
const ANY_UNIT = /[°º℃℉]|degree/i;

/**
 * `text` with every temperature written in the other unit written in `unit`
 * instead (D-TEMP-6), rounded as precisely as it was written: "93 °C" reads
 * "199 °F", "92.0 °C -> 93.0 °C (every step +1.0 °C)" reads "197.6 °F ->
 * 199.4 °F (every step +1.8 °F)", "1 °C hotter" reads "1.8 °F hotter". What
 * is already in `unit` stays as it is. Never throws.
 */
export function inTemperatureUnit(text: string, unit: TemperatureUnit): string {
  // Most sentences name no temperature at all.
  if (!ANY_UNIT.test(text)) return text;
  const from = otherUnit(unit);
  const source = dropDoubles(text, unit);
  return source.replace(
    PATTERNS[from],
    (match: string, sign: string | undefined, first: string, separator: string | undefined, secondSign: string | undefined, second: string | undefined, written: string, offset: number) => {
      const before = source.slice(0, offset);
      const after = source.slice(offset + match.length);
      if (PAIRED[unit].after.test(after) || PAIRED[unit].before.test(before)) return match;
      const small = (value: string) => Number(value) < CHANGE_BELOW[from];
      // "Step 3 to 90 °C": a small number before a temperature is not one end of its range.
      const mixed = second !== undefined && sign === undefined && small(first) !== small(second);
      const top = second === undefined ? first : mixed ? second : String(Math.max(Number(first), Number(second)));
      const arrow = ARROW_AFTER.test(after) || ARROW_BEFORE.test(before);
      const change = sign !== undefined || (!arrow && (CHANGE_AFTER.test(after) || CHANGE_BEFORE.test(before) || small(top)));
      const one = (value: string) => numberText(convert(Number(value), from, unit, change), value, change);
      const head = mixed ? first : `${sign ?? ''}${one(first)}`;
      const range = separator !== undefined && second !== undefined ? `${separator}${secondSign ?? ''}${one(second)}` : '';
      return `${head}${range}${unitText(written, unit)}`;
    },
  );
}

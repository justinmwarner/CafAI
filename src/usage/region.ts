/**
 * Where CafAI asks before sharing usage (D211). Clarity enforces a
 * consent signal for visitors in the EEA, the UK and Switzerland; CafAI
 * decides on the device, from its time zone and languages, and asks whenever
 * it is unsure: asking someone who did not need asking costs one tap. A
 * tablet left on another zone is still covered, because outside the
 * ask-first case CafAI claims no consent, and Clarity's own check of the
 * upload's address keeps cookies off for a European household.
 */

export type ConsentRule = 'ask' | 'notice';

export interface RegionSignals {
  /** The device's IANA time zone, or undefined when it cannot be read. */
  timeZone: string | undefined;
  /** The device's languages, most preferred first. */
  languages: readonly string[];
}

/** European zones outside the Europe/ prefix: Cyprus, the Atlantic islands, Ceuta, Svalbard and France's overseas regions. */
const EUROPEAN_ZONES: ReadonlySet<string> = new Set([
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Atlantic/Canary',
  'Atlantic/Madeira',
  'Atlantic/Azores',
  'Atlantic/Reykjavik',
  'Atlantic/Faroe',
  'Africa/Ceuta',
  'Arctic/Longyearbyen',
  'America/Cayenne',
  'America/Guadeloupe',
  'America/Martinique',
  'America/Marigot',
  'Indian/Reunion',
  'Indian/Mayotte',
]);

/** Zones that say nothing about where the device is. */
const SAYS_NOTHING: ReadonlySet<string> = new Set(['UTC', 'UCT', 'GMT', 'UNIVERSAL', 'ZULU', 'GREENWICH']);

/**
 * Language regions that ask first: the EU, Iceland, Liechtenstein and Norway
 * (the EEA), the UK and Switzerland, the Crown dependencies and Gibraltar,
 * the EU's own regions with codes of their own (Åland, the Canaries, Ceuta
 * and Melilla, France's overseas regions), the Faroes and Svalbard, and
 * Europe as a whole (150).
 */
const ASK_REGIONS: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'UK', 'CH',
  'GI', 'IM', 'JE', 'GG',
  'AX', 'IC', 'EA', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  'FO', 'SJ',
  'EU', '150',
]);

function saysNothing(zone: string): boolean {
  const upper = zone.toUpperCase();
  return upper === '' || SAYS_NOTHING.has(upper) || upper.startsWith('ETC/');
}

/** A language tag's region (de-DE -> DE, zh-Hant-TW -> TW, es-419 -> 419), or null when it names none. */
export function regionOf(tag: string): string | null {
  const parts = tag.split(/[-_]/);
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]!;
    // A singleton (u, t, x...) starts the extensions: nothing after it is a region.
    if (part.length === 1) return null;
    if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase();
  }
  return null;
}

export function consentRule({ timeZone, languages }: RegionSignals): ConsentRule {
  if (timeZone === undefined || saysNothing(timeZone)) return 'ask';
  if (timeZone.startsWith('Europe/') || EUROPEAN_ZONES.has(timeZone)) return 'ask';
  for (const tag of languages) {
    const region = regionOf(tag);
    if (region !== null && ASK_REGIONS.has(region)) return 'ask';
  }
  return 'notice';
}

/** What this device says, read defensively: an Intl or a navigator that throws says nothing. */
export function readRegionSignals(win: Pick<Window, 'navigator'>): RegionSignals {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timeZone = undefined;
  }
  let languages: readonly string[] = [];
  try {
    const { navigator } = win;
    if (navigator.languages && navigator.languages.length > 0) languages = [...navigator.languages];
    else if (navigator.language) languages = [navigator.language];
  } catch {
    languages = [];
  }
  return { timeZone, languages };
}

/**
 * Plain words for the board (the brief): the airline from the callsign's
 * prefix or the operator, and the aircraft type as words ("Boeing 737 MAX 9",
 * not "B39M") whenever the data has it.
 */

/**
 * ICAO airline designators a Chicago kitchen sees, and the name people know
 * the airline by. Data, not logic: one missing here falls back to the
 * operator hexdb or the provider names.
 */
export const AIRLINES: Readonly<Record<string, string>> = {
  AAL: 'American',
  UAL: 'United',
  DAL: 'Delta',
  SWA: 'Southwest',
  SKW: 'SkyWest',
  ENY: 'Envoy',
  RPA: 'Republic',
  JBU: 'JetBlue',
  ASA: 'Alaska',
  NKS: 'Spirit',
  FFT: 'Frontier',
  GJS: 'GoJet',
  ASH: 'Mesa',
  EDV: 'Endeavor',
  JIA: 'PSA',
  PDT: 'Piedmont',
  AAY: 'Allegiant',
  SCX: 'Sun Country',
  MXY: 'Breeze',
  VXP: 'Avelo',
  HAL: 'Hawaiian',
  QXE: 'Horizon',
  AWI: 'Air Wisconsin',
  FDX: 'FedEx',
  UPS: 'UPS',
  GTI: 'Atlas Air',
  ABX: 'ABX Air',
  ATN: 'ATI',
  ACA: 'Air Canada',
  JZA: 'Air Canada Jazz',
  ROU: 'Air Canada Rouge',
  WJA: 'WestJet',
  TSC: 'Air Transat',
  AMX: 'Aeroméxico',
  VOI: 'Volaris',
  VIV: 'Viva Aerobus',
  CMP: 'Copa',
  AVA: 'Avianca',
  BAW: 'British Airways',
  VIR: 'Virgin Atlantic',
  DLH: 'Lufthansa',
  AFR: 'Air France',
  KLM: 'KLM',
  IBE: 'Iberia',
  EIN: 'Aer Lingus',
  SWR: 'Swiss',
  AUA: 'Austrian',
  SAS: 'SAS',
  FIN: 'Finnair',
  LOT: 'LOT',
  TAP: 'TAP Air Portugal',
  ICE: 'Icelandair',
  THY: 'Turkish Airlines',
  ETD: 'Etihad',
  UAE: 'Emirates',
  QTR: 'Qatar Airways',
  RJA: 'Royal Jordanian',
  ELY: 'El Al',
  AIC: 'Air India',
  ANA: 'ANA',
  JAL: 'Japan Airlines',
  KAL: 'Korean Air',
  AAR: 'Asiana',
  CPA: 'Cathay Pacific',
  CCA: 'Air China',
  CES: 'China Eastern',
  CSN: 'China Southern',
  EVA: 'EVA Air',
  CAL: 'China Airlines',
  SIA: 'Singapore Airlines',
  QFA: 'Qantas',
  ANZ: 'Air New Zealand',
  LXJ: 'Flexjet',
  EJA: 'NetJets',
  VJT: 'VistaJet',
};

/** An airline-style callsign: three letters, then a flight number ("UAL2428", "SKW553U"). */
const AIRLINE_CALLSIGN = /^([A-Z]{3})(\d[0-9A-Z]{0,3})$/;

export interface CallsignParts {
  prefix: string;
  /** The flight number, as the callsign has it ("2428", "553U"). */
  number: string;
}

export function splitCallsign(callsign: string | null): CallsignParts | null {
  if (callsign === null) return null;
  const match = AIRLINE_CALLSIGN.exec(callsign.trim().toUpperCase());
  return match ? { prefix: match[1] as string, number: match[2] as string } : null;
}

/** The airline: the callsign's prefix if known, else the operator in plain words, else null. */
export function airlineFor(callsign: string | null, operator: string | null): string | null {
  const parts = splitCallsign(callsign);
  const known = parts ? AIRLINES[parts.prefix] : undefined;
  if (known) return known;
  return operator ? operatorName(operator) : null;
}

/** A registered owner that is only a bank or a trust holding the title for a lessor, not who flies it. */
const TITLE_HOLDER = /\b(TRUSTEE|TRUST CO|BANK)\b/i;
const CORPORATE_SUFFIX = /[\s,]+(INC|LLC|L\.L\.C|CORP|CORPORATION|CO|LTD|LP|NA)\.?$/i;

/**
 * An operator as people would say it: "WILCO HELICOPTERS INC" is "Wilco
 * Helicopters"; a bank holding the title in trust ("UMB BANK NA TRUSTEE") is
 * nobody worth naming, so null.
 */
export function operatorName(operator: string): string | null {
  if (TITLE_HOLDER.test(operator)) return null;
  let name = operator.trim();
  while (CORPORATE_SUFFIX.test(name)) name = name.replace(CORPORATE_SUFFIX, '').trim();
  return name === '' ? null : titleWords(name);
}

/**
 * Upper-case words of four letters or more in title case, the rest left as
 * they are: "BOEING 737 MAX 9" to "Boeing 737 MAX 9", "EMBRAER ERJ-170-200
 * (long wing)" to "Embraer ERJ-170-200 (long wing)", "UNITED AIRLINES INC"
 * to "United Airlines INC".
 */
export function titleWords(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => (/^[A-Z]{4,}$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word))
    .join(' ');
}

export interface TypeSources {
  /** The provider's `desc` (adsb.fi). */
  desc: string | null;
  /** hexdb's Manufacturer and Type. */
  manufacturer: string | null;
  model: string | null;
}

/** The type in words, from the provider first, then hexdb; null when neither has it. */
export function typeNameFor(sources: TypeSources): string | null {
  if (sources.desc) return titleWords(sources.desc);
  if (sources.manufacturer && sources.model) return `${sources.manufacturer} ${sources.model}`;
  return sources.model ?? null;
}

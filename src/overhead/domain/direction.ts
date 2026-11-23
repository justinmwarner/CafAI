/**
 * Which way a flight is going, told from the home airport (the brief):
 *
 * | Route | Treat as | Show |
 * |---|---|---|
 * | Destination is the home airport | arrival | "From Denver (DEN)" |
 * | Origin is the home airport | departure | "To Denver (DEN)" |
 * | Neither | through | both ends |
 * | No route | | "Route not published" |
 *
 * hexdb's routes can be multi-leg round trips ("KORD-KDCA-KORD",
 * DISCOVERY section 6): the leg that touches the home airport is chosen by
 * whether the aircraft is heading for it.
 */
import type { RouteEnd, RouteInfo } from '../shared/payload.ts';

const CODE = /^[A-Z0-9]{3,4}$/;

/** hexdb's route as ICAO codes, or null when it is not one. */
export function parseRoute(raw: string): string[] | null {
  const codes = raw
    .split('-')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '');
  return codes.length >= 2 && codes.every((code) => CODE.test(code)) ? codes : null;
}

/**
 * The leg this flight is on: the only leg, else the one touching the home
 * airport (inbound when `headingHome`, outbound when not, the first when
 * unknown), else the whole route's ends.
 */
export function chooseLeg(codes: readonly string[], homeAirport: string, headingHome: boolean | null): [string, string] {
  const first = codes[0] as string;
  const last = codes[codes.length - 1] as string;
  if (codes.length === 2) return [first, last];
  const legs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < codes.length; i += 1) legs.push([codes[i] as string, codes[i + 1] as string]);
  const touching = legs.filter(([from, to]) => from === homeAirport || to === homeAirport);
  if (touching.length === 0) return [first, last];
  if (headingHome !== null) {
    const match = touching.find(([from, to]) => (headingHome ? to === homeAirport : from === homeAirport));
    if (match) return match;
  }
  return touching[0] as [string, string];
}

/** The place an airport's name stands for: "Denver" for "Denver International Airport". */
export function placeName(airportName: string): string {
  const stripped = airportName
    // "Minneapolis-Saint Paul International Airport (Wold-Chamberlain Field)": the field's own name goes first.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+(international\s+|regional\s+|municipal\s+|county\s+)*(airport|airfield|aerodrome|air\s+base|airpark|airstrip)$/i, '')
    .trim();
  return stripped === '' ? airportName : stripped;
}

/** "Denver (DEN)", or the ICAO code when the airport could not be looked up. */
export function endLabel(end: RouteEnd): string {
  if (end.name === null) return end.icao;
  const place = placeName(end.name);
  return end.iata ? `${place} (${end.iata})` : place;
}

export type DirectionKind = 'arrival' | 'departure' | 'through' | 'unknown';

export interface Direction {
  kind: DirectionKind;
  text: string;
  /** The airport the map draws a great circle to or from (the origin of an arrival, the destination of a departure). */
  far: RouteEnd | null;
}

export const NO_ROUTE = 'Route not published';

export function directionFor(route: RouteInfo | null, homeAirport: string): Direction {
  if (route === null) return { kind: 'unknown', text: NO_ROUTE, far: null };
  const home = homeAirport.toUpperCase();
  if (route.destination.icao === home && route.origin.icao !== home) return { kind: 'arrival', text: `From ${endLabel(route.origin)}`, far: route.origin };
  if (route.origin.icao === home && route.destination.icao !== home) return { kind: 'departure', text: `To ${endLabel(route.destination)}`, far: route.destination };
  return { kind: 'through', text: `${endLabel(route.origin)} → ${endLabel(route.destination)}`, far: route.origin };
}

/** A route last updated longer ago than this is shown as possibly out of date. */
export const ROUTE_OLD_MS = 365 * 24 * 3600 * 1000;

export function routeIsOld(route: Pick<RouteInfo, 'updatedAt'>, now: number): boolean {
  return route.updatedAt !== null && now - route.updatedAt > ROUTE_OLD_MS;
}

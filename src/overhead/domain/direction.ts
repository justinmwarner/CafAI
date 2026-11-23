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
 * The leg this flight is on. The only leg; else the one touching the home
 * airport (inbound when `headingHome`, outbound when not, the first when
 * unknown); else, for a multi-leg route elsewhere ("KCLT-KMDT-KCLT"), the
 * leg whose destination the aircraft points at most nearly (`offTrack`
 * answers how many degrees off its track an airport lies, or null when it
 * cannot tell); else the first leg. Never an airport to itself.
 */
export function chooseLeg(codes: readonly string[], homeAirport: string, headingHome: boolean | null, offTrack: (icao: string) => number | null = () => null): [string, string] {
  const legs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < codes.length; i += 1) legs.push([codes[i] as string, codes[i + 1] as string]);
  if (legs.length === 1) return legs[0] as [string, string];
  const touching = legs.filter(([from, to]) => from === homeAirport || to === homeAirport);
  if (touching.length > 0) {
    if (headingHome !== null) {
      const match = touching.find(([from, to]) => (headingHome ? to === homeAirport : from === homeAirport));
      if (match) return match;
    }
    return touching[0] as [string, string];
  }
  let best: [string, string] | null = null;
  let bestOff = Number.POSITIVE_INFINITY;
  for (const leg of legs) {
    const off = offTrack(leg[1]);
    if (off !== null && off < bestOff) {
      best = leg;
      bestOff = off;
    }
  }
  return best ?? (legs[0] as [string, string]);
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

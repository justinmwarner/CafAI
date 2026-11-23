/**
 * The geodesy Overhead needs, all through Turf (the brief: no hand-written
 * haversine or projection math). Positions are { lat, lon } in degrees;
 * distances are nautical miles unless a name says otherwise. Shared by the
 * plugin (QuickJS) and the skin.
 */
import { bearing } from '@turf/bearing';
import { destination } from '@turf/destination';
import { distance } from '@turf/distance';
import { greatCircle } from '@turf/great-circle';
import { point } from '@turf/helpers';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Statute miles in a nautical mile (1852 m / 1609.344 m). */
export const MILES_PER_NM = 1852 / 1609.344;

const at = (p: LatLon) => point([p.lon, p.lat]);

/** Great-circle distance, nautical miles. */
export function distanceNm(from: LatLon, to: LatLon): number {
  return distance(at(from), at(to), { units: 'nauticalmiles' });
}

/** Initial bearing from `from` to `to`, degrees true, 0 up to 360. */
export function bearingDeg(from: LatLon, to: LatLon): number {
  return normalizeDeg(bearing(at(from), at(to)));
}

/** The point `distance` nm from `from` along `bearingDeg`. */
export function destinationPoint(from: LatLon, distance: number, bearing: number): LatLon {
  const [lon, lat] = destination(at(from), distance, bearing, { units: 'nauticalmiles' }).geometry.coordinates as [number, number];
  return { lat, lon };
}

/**
 * The great-circle line from `from` to `to` as [lon, lat] pairs, `points`
 * of them. A line that crosses the antimeridian comes back in pieces; they
 * are joined, as Overhead only ever draws the part near home.
 */
export function greatCircleLine(from: LatLon, to: LatLon, points = 64): Array<[number, number]> {
  if (distanceNm(from, to) < 0.01) return [[from.lon, from.lat], [to.lon, to.lat]];
  const line = greatCircle(at(from), at(to), { npoints: points });
  const geometry = line.geometry;
  if (geometry.type === 'LineString') return geometry.coordinates as Array<[number, number]>;
  return (geometry.coordinates as Array<Array<[number, number]>>).flat();
}

/** Degrees folded into 0 up to 360. */
export function normalizeDeg(deg: number): number {
  const folded = deg % 360;
  return folded < 0 ? folded + 360 : folded;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;
export type CompassPoint = (typeof COMPASS)[number];

/** The nearest of eight compass points to a bearing. */
export function compassPoint(bearing: number): CompassPoint {
  return COMPASS[Math.round(normalizeDeg(bearing) / 45) % 8] as CompassPoint;
}

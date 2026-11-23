/**
 * The closest point of approach to home (the brief, section 2): where an
 * aircraft holding its track and ground speed in a straight line comes
 * nearest, how close, how soon, and on which side.
 *
 * Within the plugin's 25 nm the ground is flat enough for straight-line
 * motion in a local frame around home: the aircraft's offset from home comes
 * from Turf's distance and bearing, the time to the closest point is the
 * textbook -(p·v)/|v|², and the closest point itself is found again with
 * Turf (destination, then distance and bearing from home), so no map
 * projection is written here.
 */
import type { Cpa } from '../shared/payload.ts';
import { bearingDeg, compassPoint, destinationPoint, distanceNm, MILES_PER_NM, type LatLon } from './geo.ts';

/** Closer than this, statute miles, and it passes overhead: no side. */
export const OVERHEAD_MILES = 0.15;

export interface Motion {
  position: LatLon;
  /** Knots; null, 0 or less cannot be told. */
  groundSpeedKt: number | null;
  /** Degrees true; null cannot be told. */
  trackDeg: number | null;
}

/** Null when it cannot be told: no speed, standing still, or no track. */
export function closestApproach(home: LatLon, motion: Motion): Cpa | null {
  const speed = motion.groundSpeedKt;
  const track = motion.trackDeg;
  if (speed === null || track === null || !Number.isFinite(speed) || !Number.isFinite(track) || speed <= 0) return null;
  const range = distanceNm(home, motion.position);
  const toPlane = (bearingDeg(home, motion.position) * Math.PI) / 180;
  const heading = (track * Math.PI) / 180;
  // East and north, nm from home, and nm an hour.
  const px = range * Math.sin(toPlane);
  const py = range * Math.cos(toPlane);
  const vx = speed * Math.sin(heading);
  const vy = speed * Math.cos(heading);
  const hours = -(px * vx + py * vy) / (speed * speed);
  const travelled = speed * hours;
  const point = destinationPoint(motion.position, Math.abs(travelled), travelled >= 0 ? track : track + 180);
  const distanceMiles = distanceNm(home, point) * MILES_PER_NM;
  return {
    timeToCpaSeconds: hours * 3600,
    distanceMiles,
    side: distanceMiles < OVERHEAD_MILES ? null : compassPoint(bearingDeg(home, point)),
  };
}

/** "directly over" or "0.6 mi north". */
export function cpaLabel(cpa: Pick<Cpa, 'distanceMiles' | 'side'>): string {
  if (cpa.side === null || cpa.distanceMiles < OVERHEAD_MILES) return 'directly over';
  return `${cpa.distanceMiles.toFixed(1)} mi ${cpa.side}`;
}

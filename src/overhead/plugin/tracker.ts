/**
 * The aircraft the plugin has seen, kept in memory by ICAO address: the
 * latest state and the last TRAIL_POINTS positions for its trail. One not
 * heard of for DROP_AFTER_MS is dropped (the brief). Nothing is written to
 * storage; a log of what flew over would start here (out of scope).
 *
 * Times are the tablet's: a position is `seen_pos` seconds older than the
 * moment its answer arrived, so a provider's clock never matters.
 */
import { finite, text, type ReadsbAircraft, type ReadsbSnapshot } from '../shared/readsb.ts';

export const TRAIL_POINTS = 20;
export const DROP_AFTER_MS = 60_000;

export interface TrackedAircraft {
  hex: string;
  last: ReadsbAircraft;
  lat: number;
  lon: number;
  /** When it was at lat/lon. */
  positionAt: number;
  /** When it was last heard of at all. */
  heardAt: number;
  /** [lon, lat], oldest first, ending at lat/lon. */
  trail: Array<[number, number]>;
}

export interface Tracker {
  /** Takes one answer, which arrived at `at`. */
  ingest(snapshot: ReadsbSnapshot, at: number): void;
  /** Drops what has not been heard of for DROP_AFTER_MS, then lists the rest. */
  current(now: number): TrackedAircraft[];
  clear(): void;
}

/** "a5535e" for "A5535E"; null for no address. TIS-B's "~" addresses are kept as they are. */
export function normalizeHex(value: unknown): string | null {
  const hex = text(value);
  return hex === null ? null : hex.toLowerCase();
}

export function createTracker(): Tracker {
  const byHex = new Map<string, TrackedAircraft>();
  return {
    ingest(snapshot, at) {
      for (const aircraft of snapshot.aircraft) {
        const hex = normalizeHex(aircraft.hex);
        const lat = finite(aircraft.lat);
        const lon = finite(aircraft.lon);
        if (hex === null || lat === null || lon === null) continue;
        const positionAt = at - Math.max(0, finite(aircraft.seen_pos) ?? 0) * 1000;
        const heardAt = at - Math.max(0, finite(aircraft.seen) ?? 0) * 1000;
        const known = byHex.get(hex);
        if (known && positionAt < known.positionAt) {
          // An older position than the one held (another provider lagging): only that it was heard counts.
          known.heardAt = Math.max(known.heardAt, heardAt);
          continue;
        }
        const trail = known ? known.trail.slice() : [];
        const lastPoint = trail[trail.length - 1];
        if (!lastPoint || lastPoint[0] !== lon || lastPoint[1] !== lat) trail.push([lon, lat]);
        while (trail.length > TRAIL_POINTS) trail.shift();
        byHex.set(hex, { hex, last: aircraft, lat, lon, positionAt, heardAt: Math.max(heardAt, known?.heardAt ?? 0), trail });
      }
    },
    current(now) {
      for (const [hex, aircraft] of byHex) if (now - aircraft.heardAt > DROP_AFTER_MS) byHex.delete(hex);
      return [...byHex.values()];
    },
    clear() {
      byHex.clear();
    },
  };
}

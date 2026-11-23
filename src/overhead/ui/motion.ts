/**
 * Between two answers (2 to 60 s apart) the screen moves each aircraft on
 * along its track at its speed, as the CPA assumes, so the map glides rather
 * than jumps, and the board counts down. Positions are never carried forward
 * more than MAX_GLIDE_MS: past that, the data is old and the screen says so.
 */
import { board, type BoardEntry, type BucketRules } from '../domain/buckets.ts';
import { destinationPoint } from '../domain/geo.ts';
import type { OverheadAircraft } from '../shared/payload.ts';

export const MAX_GLIDE_MS = 60_000;

/** Where the aircraft is at `now`, if it held its track and speed since its position. */
export function positionAt(aircraft: OverheadAircraft, now: number): { lat: number; lon: number } {
  const elapsed = Math.min(MAX_GLIDE_MS, Math.max(0, now - aircraft.positionAt));
  const speed = aircraft.groundSpeedKt;
  const track = aircraft.trackDeg;
  if (aircraft.onGround || speed === null || track === null || speed <= 0 || elapsed === 0) return { lat: aircraft.lat, lon: aircraft.lon };
  return destinationPoint(aircraft, (speed * elapsed) / 3_600_000, track);
}

/** The board at `now`. */
export function boardAt(aircraft: readonly OverheadAircraft[], rules: BucketRules & { listCeilingFt: number }, now: number): Array<BoardEntry<OverheadAircraft>> {
  return board(aircraft, rules, now);
}

/** Seconds between highlights on the map. */
export const HIGHLIGHT_EVERY_MS = 10_000;

/**
 * The aircraft the map highlights: a Now holds it until it passes; otherwise
 * the highlight moves down the board every HIGHLIGHT_EVERY_MS. Null with an
 * empty board.
 */
export function highlighted(entries: ReadonlyArray<BoardEntry<OverheadAircraft>>, now: number): OverheadAircraft | null {
  if (entries.length === 0) return null;
  const overhead = entries.find((entry) => entry.bucket.kind === 'now');
  if (overhead) return overhead.aircraft;
  const index = Math.floor(now / HIGHLIGHT_EVERY_MS) % entries.length;
  return entries[index]?.aircraft ?? null;
}

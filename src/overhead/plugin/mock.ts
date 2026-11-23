/**
 * Mock mode (the brief): the recorded adsb.fi answer
 * (fixtures/overhead/adsbfi-point-ord.json), replayed instead of asking
 * anyone. Each aircraft keeps its distance and bearing from MOCK_FIXTURE_HOME
 * but is placed around the barista's own home, and flies on along its track
 * at its speed; every MOCK_LOOP_MS the recording starts over.
 *
 * MOCK_FIXTURE_HOME is a point under the approach to O'Hare's runway 27R,
 * chosen so the recording has one aircraft passing overhead within seconds,
 * a few more within minutes, and one just gone. It is nobody's address.
 */
import recorded from '../../../fixtures/overhead/adsbfi-point-ord.json';
import { bearingDeg, destinationPoint, distanceNm, type LatLon } from '../domain/geo.ts';
import { finite, readReadsbBody, type ReadsbAircraft, type ReadsbSnapshot } from '../shared/readsb.ts';

export const MOCK_FIXTURE_HOME: LatLon = { lat: 41.988, lon: -87.73 };
export const MOCK_LOOP_MS = 4 * 60_000;

const RECORDING: ReadsbAircraft[] = readReadsbBody(recorded)?.aircraft ?? [];

/** The recording as it would be `elapsedMs` after it started, around `home`. */
export function mockSnapshot(home: LatLon, elapsedMs: number): ReadsbSnapshot {
  const hours = (((elapsedMs % MOCK_LOOP_MS) + MOCK_LOOP_MS) % MOCK_LOOP_MS) / 3_600_000;
  const aircraft = RECORDING.flatMap((plane): ReadsbAircraft[] => {
    const lat = finite(plane.lat);
    const lon = finite(plane.lon);
    if (lat === null || lon === null) return [];
    const recordedAt = { lat, lon };
    const placed = destinationPoint(home, distanceNm(MOCK_FIXTURE_HOME, recordedAt), bearingDeg(MOCK_FIXTURE_HOME, recordedAt));
    const speed = finite(plane.gs);
    const track = finite(plane.track);
    const flying = typeof plane.alt_baro === 'number' && speed !== null && speed > 0 && track !== null;
    const now = flying ? destinationPoint(placed, speed * hours, track) : placed;
    return [{ ...plane, lat: now.lat, lon: now.lon, seen: 0, seen_pos: 0 }];
  });
  return { nowMs: null, aircraft };
}

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
import batch from '../../../fixtures/overhead/hexdb-batch-ord.json';
import etihad from '../../../fixtures/overhead/hexdb-aircraft-8965f4.json';
import civCsv from '../../../fixtures/overhead/plane-alert-civ.sample.csv?raw';
import govCsv from '../../../fixtures/overhead/plane-alert-gov.sample.csv?raw';
import type { EnricherSeed } from './enrich.ts';
import { readHexdb } from './enrich.ts';

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


/** Every recorded airport answer (fixtures/overhead/hexdb-airport-*.json), by file. */
const AIRPORT_FILES = import.meta.glob<{ default: unknown }>('../../../fixtures/overhead/hexdb-airport-*.json', { eager: true });

interface Recorded {
  status: number;
  body: unknown;
}

function seeded<T>(records: Record<string, Recorded>, read: (body: unknown) => T | null): Record<string, T | null> {
  return Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.status === 200 ? read(record.body) : null]));
}

/** hexdb's recorded answers (fixtures/overhead/hexdb-*.json), as the enricher keeps them: mock mode asks nobody. */
export function mockEnrichmentSeed(): EnricherSeed {
  const airports: Record<string, Recorded> = { ...(batch.airports as Record<string, Recorded>) };
  for (const [file, module] of Object.entries(AIRPORT_FILES)) {
    const icao = /hexdb-airport-([A-Z0-9]+)/.exec(file)?.[1];
    if (icao) airports[icao] = { status: file.endsWith('-404.json') ? 404 : 200, body: module.default };
  }
  return {
    route: seeded(batch.routes as Record<string, Recorded>, readHexdb.route),
    aircraft: seeded({ ...(batch.aircraft as Record<string, Recorded>), '8965f4': { status: 200, body: etihad } }, readHexdb.aircraft),
    airport: seeded(airports, readHexdb.airport),
  };
}

/** plane-alert-db's recorded rows (fixtures/overhead/plane-alert-*.sample.csv). */
export const MOCK_PLANE_ALERT = { 'plane-alert-civ.csv': civCsv, 'plane-alert-gov.csv': govCsv } as const;

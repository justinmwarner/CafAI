import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRCRAFT_TTL_MS, AIRPORT_MISS_TTL_MS, createEnricher, HEXDB, HEXDB_EVERY_MS, PERSIST_EVERY_MS, ROUTE_TTL_MS } from './enrich.ts';
import { createFakeHost, fakeResponse } from './fakeHost.ts';
import type { PluginFetch } from './host.ts';
import { createPluginKv } from './kv.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/overhead/${name}`, import.meta.url), 'utf8');

/** hexdb as recorded on 2026-11-23. */
const RECORDED: Record<string, string | null> = {
  [`${HEXDB}/route/icao/ETD93C`]: fixture('hexdb-route-ETD93C.json'),
  [`${HEXDB}/route/icao/UAL2428`]: fixture('hexdb-route-UAL2428.json'),
  [`${HEXDB}/route/icao/AAL1002`]: '{"flight": "AAL1002", "route": "KORD-KDCA-KORD", "updatetime": 1575763200}',
  [`${HEXDB}/aircraft/8965f4`]: fixture('hexdb-aircraft-8965f4.json'),
  [`${HEXDB}/airport/icao/KORD`]: fixture('hexdb-airport-KORD.json'),
  [`${HEXDB}/airport/icao/OMAA`]: fixture('hexdb-airport-OMAA.json'),
  [`${HEXDB}/airport/icao/KDCA`]: '{"country_code": "US", "region_name": "Virginia", "iata": "DCA", "icao": "KDCA", "airport": "Ronald Reagan Washington National Airport", "latitude": 38.8521, "longitude": -77.0377}',
};

const timers = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function setup() {
  const asked: Array<{ url: string; at: number }> = [];
  const fetch: PluginFetch = async (url) => {
    asked.push({ url, at: Date.now() });
    const body = RECORDED[url];
    return body ? fakeResponse(200, body) : fakeResponse(404, '{"status":"404","error":"Route not found."}');
  };
  const fake = createFakeHost();
  const kv = createPluginKv(fake.host, timers);
  fake.attach({ onEvent: (event) => event.name === 'storageRead' && kv.answered(event.payload) });
  return { asked, fake, kv, enricher: createEnricher({ ...timers, fetch }, kv) };
}

const ORD = { lat: 41.9786, lon: -87.9047 };

describe('hexdb lookups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T13:22:28Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('asks at most once a second', async () => {
    const { enricher, asked } = setup();
    enricher.want('route', ['ETD93C', 'UAL2428', 'AAL1002', 'N442PP']);
    enricher.want('airport', ['KORD', 'OMAA']);
    await vi.advanceTimersByTimeAsync(10 * HEXDB_EVERY_MS);
    expect(asked).toHaveLength(6);
    for (let i = 1; i < asked.length; i += 1) expect((asked[i]?.at ?? 0) - (asked[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(HEXDB_EVERY_MS);
    // What was wanted last is asked first.
    expect(asked.slice(0, 2).map((request) => request.url)).toEqual([`${HEXDB}/airport/icao/KORD`, `${HEXDB}/airport/icao/OMAA`]);
  });

  it('builds an arrival from the route and its airports', async () => {
    const { enricher } = setup();
    enricher.want('route', ['ETD93C']);
    enricher.want('airport', ['KORD', 'OMAA']);
    await vi.advanceTimersByTimeAsync(5 * HEXDB_EVERY_MS);
    const route = enricher.route('ETD93C', { lat: 41.9657, lon: -87.4278 }, 270, 'KORD');
    expect(route).toEqual({
      raw: 'OMAA-KORD',
      origin: { icao: 'OMAA', iata: 'AUH', name: 'Abu Dhabi International Airport', lat: 24.433, lon: 54.6511 },
      destination: { icao: 'KORD', iata: 'ORD', name: "Chicago O'Hare International Airport", lat: 41.9786, lon: -87.9047 },
      updatedAt: 1747593022000,
    });
  });

  it('chooses the leg of a round trip by the aircraft’s heading', async () => {
    const { enricher } = setup();
    enricher.want('route', ['AAL1002']);
    enricher.want('airport', ['KORD', 'KDCA']);
    await vi.advanceTimersByTimeAsync(5 * HEXDB_EVERY_MS);
    // 20 nm east of O'Hare heading west: inbound.
    const east = { lat: 41.98, lon: -87.46 };
    expect(enricher.route('AAL1002', east, 270, 'KORD')).toMatchObject({ origin: { icao: 'KDCA' }, destination: { icao: 'KORD' } });
    expect(enricher.route('AAL1002', east, 90, 'KORD')).toMatchObject({ origin: { icao: 'KORD' }, destination: { icao: 'KDCA' } });
  });

  it('reads aircraft details', async () => {
    const { enricher } = setup();
    enricher.want('aircraft', ['8965f4', 'a12ac7']);
    await vi.advanceTimersByTimeAsync(3 * HEXDB_EVERY_MS);
    expect(enricher.aircraft('8965f4')).toEqual({ registration: 'A6-BNF', manufacturer: 'Boeing', model: '787 9', icaoType: 'B789', owner: 'Etihad Airways' });
    expect(enricher.aircraft('a12ac7')).toBeNull();
  });

  it('keeps each answer, a 404 included, for as long as the brief says', async () => {
    const { enricher, asked } = setup();
    const ask = async (kind: 'route' | 'aircraft' | 'airport', key: string) => {
      enricher.want(kind, [key]);
      await vi.advanceTimersByTimeAsync(2 * HEXDB_EVERY_MS);
    };
    await ask('route', 'N442PP');
    await ask('aircraft', '8965f4');
    await ask('airport', 'KORD');
    await ask('airport', 'ZZZZ');
    expect(asked).toHaveLength(4);
    await ask('route', 'N442PP');
    expect(asked).toHaveLength(4);

    vi.advanceTimersByTime(ROUTE_TTL_MS);
    await ask('route', 'N442PP');
    await ask('aircraft', '8965f4');
    expect(asked).toHaveLength(5);

    vi.advanceTimersByTime(AIRPORT_MISS_TTL_MS);
    await ask('airport', 'KORD');
    await ask('airport', 'ZZZZ');
    expect(asked.map((request) => request.url).slice(5)).toEqual([`${HEXDB}/airport/icao/ZZZZ`]);

    vi.advanceTimersByTime(AIRCRAFT_TTL_MS);
    await ask('aircraft', '8965f4');
    await ask('airport', 'KORD');
    expect(asked.map((request) => request.url).slice(6)).toEqual([`${HEXDB}/aircraft/8965f4`]);
  });

  it('keeps its caches in storage, and a fresh start asks for nothing already known', async () => {
    const first = setup();
    first.enricher.want('airport', ['KORD']);
    await vi.advanceTimersByTimeAsync(HEXDB_EVERY_MS + PERSIST_EVERY_MS);
    expect(first.fake.store.get('cache.airports')).toMatchObject({ KORD: { value: { iata: 'ORD' } } });

    const fetch = vi.fn<PluginFetch>();
    const second = createEnricher({ ...timers, fetch }, first.kv);
    const loading = second.load();
    await vi.advanceTimersByTimeAsync(0);
    await loading;
    second.want('airport', ['KORD']);
    await vi.advanceTimersByTimeAsync(5 * HEXDB_EVERY_MS);
    expect(fetch).not.toHaveBeenCalled();
    expect(second.airport('KORD')?.name).toBe("Chicago O'Hare International Airport");
  });

  it('asks again later after a failure that is not a 404', async () => {
    let up = false;
    const fetch: PluginFetch = async () => (up ? fakeResponse(200, fixture('hexdb-airport-KORD.json')) : fakeResponse(503, ''));
    const enricher = createEnricher({ ...timers, fetch }, null);
    enricher.want('airport', ['KORD']);
    await vi.advanceTimersByTimeAsync(HEXDB_EVERY_MS);
    expect(enricher.airport('KORD')).toBeNull();
    up = true;
    enricher.want('airport', ['KORD']);
    await vi.advanceTimersByTimeAsync(HEXDB_EVERY_MS);
    expect(enricher.airport('KORD')).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
    enricher.want('airport', ['KORD']);
    await vi.advanceTimersByTimeAsync(HEXDB_EVERY_MS);
    expect(enricher.airport('KORD')?.iata).toBe('ORD');
    expect(ORD.lat).toBeCloseTo(41.9786);
  });
});

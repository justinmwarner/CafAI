import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board, bucketLabel } from '../domain/buckets.ts';
import { cpaLabel } from '../domain/cpa.ts';
import { directionFor } from '../domain/direction.ts';
import { readPayload, type OverheadPayload } from '../shared/payload.ts';
import { createFakeHost, fakeResponse } from './fakeHost.ts';
import type { PluginDeps, PluginFetch } from './host.ts';
import { mockSnapshot } from './mock.ts';
import { ACTIVE_LEASE_MS, createOverheadPlugin, NOTABLE_CHECK_MS } from './plugin.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/overhead/${name}`, import.meta.url), 'utf8');

const HOME = { HomeLat: 41.9786, HomeLon: -87.9048 };

/** The recording around the mock home, as adsb.fi would send it. */
const placedMock = () => ({ now: Date.now() / 1000, aircraft: mockSnapshot({ lat: 41.988, lon: -87.73 }, 0).aircraft });

const BATCH = JSON.parse(fixture('hexdb-batch-ord.json')) as Record<'routes' | 'aircraft' | 'airports', Record<string, { status: number; body: unknown }>>;

/** hexdb and plane-alert-db as recorded (fixtures/overhead/). */
function recordedLookup(url: string) {
  const { pathname, host } = new URL(url);
  if (host === 'raw.githubusercontent.com') {
    const file = pathname.endsWith('plane-alert-gov.csv') ? 'plane-alert-gov.sample.csv' : 'plane-alert-civ.sample.csv';
    return fakeResponse(200, fixture(file), { etag: `"${file}"` });
  }
  const [, , , kind, ...rest] = pathname.split('/');
  const key = rest[rest.length - 1] ?? '';
  const table = kind === 'route' ? BATCH.routes : kind === 'aircraft' ? BATCH.aircraft : BATCH.airports;
  const file = new URL(`../../../fixtures/overhead/hexdb-airport-${key}.json`, import.meta.url);
  const recorded = table[key] ?? (kind === 'airport' && existsSync(file) ? { status: 200, body: JSON.parse(readFileSync(file, 'utf8')) } : undefined);
  return recorded && recorded.status === 200 ? fakeResponse(200, JSON.stringify(recorded.body)) : fakeResponse(404, '{"status":"404","error":"Not found."}');
}

function setup(store: Record<string, unknown> = {}, answer?: PluginFetch) {
  const fake = createFakeHost(store);
  /** Position requests only; lookups go to `looked`. */
  const asked: string[] = [];
  const looked: string[] = [];
  const fetch: PluginFetch = async (url, init) => {
    if (url.includes('hexdb.io') || url.includes('raw.githubusercontent.com')) {
      looked.push(url);
      return recordedLookup(url);
    }
    if (answer) return answer(url, init);
    asked.push(url);
    if (url.includes('airplanes.live')) return fakeResponse(403, fixture('airplaneslive-point-ord-403.json'));
    if (url.includes('adsb.fi')) return fakeResponse(200, fixture('adsbfi-point-ord.json'));
    throw new Error(`unexpected ${url}`);
  };
  const deps: PluginDeps = {
    fetch,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const plugin = createOverheadPlugin(fake.host, deps, '9.9.9');
  fake.attach(plugin);
  const get = async (query: Record<string, string> = {}): Promise<OverheadPayload> => {
    const reply = await plugin.__httpRequestHandler({ endpoint: 'overhead', method: 'GET', body: null, query });
    expect(reply.status).toBe(200);
    expect(typeof reply.body).toBe('string');
    const payload = readPayload(JSON.parse(reply.body));
    expect(payload).not.toBeNull();
    return payload as OverheadPayload;
  };
  const post = async (values: Record<string, unknown>) => plugin.__httpRequestHandler({ endpoint: 'config', method: 'POST', body: { values }, query: {} });
  return { fake, plugin, asked, looked, get, post };
}

const hosts = (urls: string[]) => urls.map((url) => new URL(url).host);

describe('the Overhead plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T13:22:28Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('asks nobody, and answers no home, until home is set', async () => {
    const { plugin, asked, get } = setup();
    plugin.onLoad({});
    await plugin.ready();
    const payload = await get();
    expect(payload).toMatchObject({ version: 1, home: null, aircraft: [], stale: true, provider: null });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(asked).toEqual([]);
  });

  it('keeps the home the skin posts, and uses it after a reload', async () => {
    const first = setup();
    first.plugin.onLoad({});
    await first.plugin.ready();
    const saved = await first.post({ ...HOME, PollIntervalSeconds: 3, RadiusNm: 'far' });
    expect(JSON.parse(saved.body)).toMatchObject({ values: { HomeLat: 41.9786, HomeLon: -87.9048, PollIntervalSeconds: 3, RadiusNm: 25 }, ignored: ['RadiusNm'] });
    expect(first.fake.store.get('config')).toEqual({ ...HOME, PollIntervalSeconds: 3 });
    first.plugin.onUnload();

    const second = setup(Object.fromEntries(first.fake.store));
    second.plugin.onLoad({});
    await second.plugin.ready();
    expect((await second.get({ active: '0' })).home).toEqual({ lat: 41.9786, lon: -87.9048 });
  });

  it('lets a change made in Decaid’s own Plugins screen win over the skin’s copy', async () => {
    const store = { config: { RadiusNm: 30, ListCeilingFt: 8000 }, nativeSeen: { RadiusNm: 25, ListCeilingFt: 9000 } };
    const { plugin, fake, get } = setup(store);
    // RadiusNm changed natively since (25 to 40); ListCeilingFt did not.
    plugin.onLoad({ RadiusNm: 40, ListCeilingFt: 9000 });
    await plugin.ready();
    const { settings } = await get({ active: '0' });
    expect(settings.radiusNm).toBe(40);
    expect(settings.listCeilingFt).toBe(8000);
    expect(fake.store.get('config')).toEqual({ ListCeilingFt: 8000 });
    expect(fake.store.get('nativeSeen')).toEqual({ RadiusNm: 40, ListCeilingFt: 9000 });
  });

  it('polls every interval while the screensaver shows, through the chain, and serves what it found', async () => {
    const { plugin, asked, get } = setup({ config: { ...HOME, PollIntervalSeconds: 5 } });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    // The first tick is the notable check: one request.
    expect(hosts(asked)).toEqual(['api.airplanes.live', 'opendata.adsb.fi']);
    asked.length = 0;

    const first = await get();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.stale).toBe(false);
    expect(first.provider).toBe('adsb.fi');
    expect(first.aircraft.length).toBeGreaterThan(40);
    expect(first.aircraft.every((plane) => plane.distanceNm <= 25)).toBe(true);
    const ground = first.aircraft.find((plane) => plane.hex === 'aba30b');
    expect(ground).toMatchObject({ onGround: true, altitudeFt: null, trackDeg: null, callsign: null, registration: 'N849UA' });
    const ual = first.aircraft.find((plane) => plane.hex === 'a12ac7');
    expect(ual).toMatchObject({ callsign: 'UAL2428', typeCode: 'B39M', altitudeFt: 12925, groundSpeedKt: 306.9, trackDeg: 258.73 });

    // airplanes.live rests 10 minutes after its 403; adsb.fi serves every 5 s while the skin keeps asking.
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
      await get();
    }
    expect(hosts(asked)).toEqual(Array(6).fill('opendata.adsb.fi'));
  });

  it('falls back to one check a minute once the skin stops asking, and to none while the machine sleeps', async () => {
    const { plugin, asked, get } = setup({ config: { ...HOME, PollIntervalSeconds: 2 } });
    plugin.onLoad({});
    await plugin.ready();
    await get();
    await vi.advanceTimersByTimeAsync(ACTIVE_LEASE_MS);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(3 * NOTABLE_CHECK_MS);
    expect(hosts(asked)).toEqual(Array(3).fill('opendata.adsb.fi'));

    plugin.onEvent({ name: 'stateUpdate', payload: { state: { state: 'sleeping', substate: 'idle' } } });
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * NOTABLE_CHECK_MS);
    expect(asked).toEqual([]);

    // Asleep, but the screensaver shows (the skin asks): it polls. airplanes.live's 10-minute rest is over, so it is asked again first.
    await get();
    await vi.advanceTimersByTimeAsync(0);
    expect(hosts(asked)).toEqual(['api.airplanes.live', 'opendata.adsb.fi']);
  });

  it('never polls faster than every 2 s, however often the skin asks', async () => {
    const { plugin, asked, get } = setup({ config: { ...HOME, PollIntervalSeconds: 2 } });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    asked.length = 0;
    for (let i = 0; i < 20; i += 1) {
      await get();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(asked.length).toBeLessThanOrEqual(5);
    expect(asked.length).toBeGreaterThanOrEqual(4);
  });

  it('says the data is stale once nothing new has come for 30 s', async () => {
    let up = true;
    const { plugin, get } = setup({ config: HOME }, async (url) => {
      if (!up) throw new Error('offline');
      return url.includes('adsb.fi') ? fakeResponse(200, fixture('adsbfi-point-ord.json')) : fakeResponse(403, '{}');
    });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect((await get()).stale).toBe(false);
    up = false;
    await vi.advanceTimersByTimeAsync(31_000);
    const payload = await get();
    expect(payload.stale).toBe(true);
    expect(payload.dataAt).toBe(Date.parse('2026-11-23T13:22:28Z'));
  });

  it('replays the recorded fixtures in mock mode, asking nobody', async () => {
    const { plugin, asked, get } = setup({ config: { HomeLat: 41.988, HomeLon: -87.73, MockMode: true } });
    plugin.onLoad({});
    await plugin.ready();
    const first = await get();
    expect(first.provider).toBe('mock');
    expect(first.stale).toBe(false);
    expect(first.aircraft.length).toBeGreaterThan(30);
    await vi.advanceTimersByTimeAsync(10_000);
    const later = await get();
    const moved = (hex: string) => [first, later].map((payload) => payload.aircraft.find((plane) => plane.hex === hex)?.lon);
    // SKW5591 on final for 27R flies west; a United jet on the ground stays.
    const [before, after] = moved('a0baa1');
    expect(after).toBeLessThan(before as number);
    expect(moved('aba30b')[0]).toBe(moved('aba30b')[1]);
    expect(later.aircraft.find((plane) => plane.hex === 'a0baa1')?.trail.length).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(asked).toEqual([]);
  });

  it('gives the mock home a full board: one overhead now, several within minutes, one just gone', async () => {
    const { plugin, get } = setup({ config: { HomeLat: 41.988, HomeLon: -87.73, MockMode: true } });
    plugin.onLoad({});
    await plugin.ready();
    const payload = await get();
    const list = board(payload.aircraft, payload.settings, payload.generatedAt);
    expect(list.map((entry) => `${entry.aircraft.callsign} ${bucketLabel(entry.bucket)}`)).toEqual([
      'SKW5591 Now',
      'AAL874 2 min',
      'SKW4803 2 min',
      'SKW4646 4 min',
      'ETD93C 4 min',
      'SKW5699 5 min',
      'UAL426 Just passed',
    ]);
    expect(list[0]?.aircraft).toMatchObject({ airline: 'SkyWest', typeName: 'Embraer ERJ-170-200 (long wing)', altitudeFt: 2950 });
    expect(cpaLabel(list[0]?.aircraft.cpa as NonNullable<OverheadPayload['aircraft'][number]['cpa']>)).toBe('directly over');
  });

  it('announces a notable aircraft once as it comes within the notable area, and lists it', async () => {
    const { plugin, fake, looked, get } = setup({ config: HOME });
    const loadedAt = Date.now();
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(2000);
    // The lists were fetched on the first tick, a second apart; A046E7 (ABC7's helicopter) is 5.9 nm from O'Hare in the recording.
    expect(looked.filter((url) => url.includes('raw.githubusercontent.com'))).toHaveLength(2);
    expect(fake.emits).toEqual([
      { event: 'notable', payload: { hex: 'a046e7', operator: 'US Helicopters (ABC7 Chicago)', category: 'As Seen on TV', registration: 'N117HD', type: 'AS-350 Ecureuil', distanceNm: 5.9, at: loadedAt } },
    ]);
    const payload = await get();
    expect(payload.notable).toEqual([{ hex: 'a046e7', info: expect.objectContaining({ operator: 'US Helicopters (ABC7 Chicago)', tags: ['As Seen on TV', 'News', 'Chicago'] }), since: loadedAt }]);
    expect(payload.aircraft.find((plane) => plane.hex === 'a046e7')?.notable?.category).toBe('As Seen on TV');
    // Still there a minute later: no second announcement.
    await vi.advanceTimersByTimeAsync(2 * NOTABLE_CHECK_MS);
    expect(fake.emits).toHaveLength(1);
  });

  it('lists a notable aircraft beyond the map’s area but inside the notable area', async () => {
    const { plugin, get } = setup({ config: { ...HOME, RadiusNm: 3, NotableRadiusNm: 10 } });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    const payload = await get();
    expect(payload.aircraft.every((plane) => plane.distanceNm <= 3 || plane.hex === 'a046e7')).toBe(true);
    expect(payload.aircraft.some((plane) => plane.hex === 'a046e7')).toBe(true);
  });

  it('looks up the board’s routes on hexdb, one a second, and tells arrivals from the home airport', async () => {
    const { plugin, looked, get } = setup({ config: { HomeLat: 41.988, HomeLon: -87.73, PollIntervalSeconds: 2 } }, async (url) =>
      url.includes('adsb.fi') ? fakeResponse(200, JSON.stringify(placedMock())) : fakeResponse(403, '{}'),
    );
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 30; i += 1) {
      await get();
      await vi.advanceTimersByTimeAsync(1000);
    }
    const hexdb = looked.filter((url) => url.includes('hexdb.io'));
    expect(hexdb.length).toBeGreaterThan(10);
    expect(hexdb.length).toBeLessThanOrEqual(31);
    expect(hexdb).toContain('https://hexdb.io/api/v1/route/icao/ETD93C');
    const etihad = (await get()).aircraft.find((plane) => plane.callsign === 'ETD93C');
    expect(etihad?.route).toMatchObject({ raw: 'OMAA-KORD', origin: { iata: 'AUH', name: 'Abu Dhabi International Airport' }, destination: { iata: 'ORD' } });
    expect(directionFor(etihad?.route ?? null, 'KORD').text).toBe('From Abu Dhabi (AUH)');
  });

  it('enriches mock mode from the recordings, announcing nothing', async () => {
    const { plugin, fake, looked, get } = setup({ config: { HomeLat: 41.988, HomeLon: -87.73, MockMode: true } });
    plugin.onLoad({});
    await plugin.ready();
    const payload = await get();
    const etihad = payload.aircraft.find((plane) => plane.callsign === 'ETD93C');
    expect(etihad).toMatchObject({ airline: 'Etihad', typeName: 'Boeing 787-9 Dreamliner', route: { origin: { iata: 'AUH' }, destination: { iata: 'ORD' } } });
    expect(payload.notable.map((sighting) => sighting.info.operator)).toEqual(['US Helicopters (ABC7 Chicago)']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.emits).toEqual([]);
    expect(looked).toEqual([]);
  });

  it('keeps every host it asks under one request a second, and says so', async () => {
    const { plugin, get } = setup({ config: { HomeLat: 41.988, HomeLon: -87.73, PollIntervalSeconds: 2 } }, async (url) =>
      url.includes('adsb.fi') ? fakeResponse(200, JSON.stringify(placedMock())) : fakeResponse(403, '{}'),
    );
    plugin.onLoad({});
    await plugin.ready();
    for (let i = 0; i < 300; i += 1) {
      await get();
      await vi.advanceTimersByTimeAsync(700);
    }
    const { requests } = await get({ active: '0' });
    const byHost = Object.fromEntries((requests ?? []).map((stat) => [stat.host, stat]));
    expect(Object.keys(byHost).sort()).toEqual(['api.airplanes.live', 'hexdb.io', 'opendata.adsb.fi', 'raw.githubusercontent.com']);
    expect(byHost['opendata.adsb.fi']?.count).toBeGreaterThan(90);
    for (const stat of requests ?? []) if (stat.minGapMs !== null) expect(stat.minGapMs).toBeGreaterThanOrEqual(1000);
  });

  it('opens the screensaver on fresh positions, not on the minute-old check', async () => {
    const { plugin, asked, get } = setup({ config: HOME });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked.length).toBeGreaterThan(0);
    // Away for a while: the last check is 50 s old.
    await vi.advanceTimersByTimeAsync(50_000);
    asked.length = 0;
    const first = await get();
    expect(asked.length).toBeGreaterThan(0);
    expect(first.stale).toBe(false);
    expect(first.dataAt).toBe(Date.now());
  });

  it('replays on ?mock=1 without turning mock mode on', async () => {
    const { plugin, get } = setup({ config: HOME });
    plugin.onLoad({});
    await plugin.ready();
    expect((await get({ mock: '1', active: '0' })).provider).toBe('mock');
    expect((await get({ active: '0' })).settings.mockMode).toBe(false);
  });

  it('answers 404 for another endpoint and 400 for a config it cannot read', async () => {
    const { plugin } = setup();
    plugin.onLoad({});
    expect((await plugin.__httpRequestHandler({ endpoint: 'other', method: 'GET', body: null, query: {} })).status).toBe(404);
    expect((await plugin.__httpRequestHandler({ endpoint: 'config', method: 'POST', body: 'x', query: {} })).status).toBe(400);
    expect((await plugin.__httpRequestHandler({ endpoint: 'config', method: 'DELETE', body: null, query: {} })).status).toBe(405);
  });

  it('stops asking once unloaded', async () => {
    const { plugin, asked } = setup({ config: HOME });
    plugin.onLoad({});
    await plugin.ready();
    await vi.advanceTimersByTimeAsync(0);
    plugin.onUnload();
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * NOTABLE_CHECK_MS);
    expect(asked).toEqual([]);
  });
});

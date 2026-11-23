import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPayload, type OverheadPayload } from '../shared/payload.ts';
import { createFakeHost, fakeResponse } from './fakeHost.ts';
import type { PluginDeps, PluginFetch } from './host.ts';
import { ACTIVE_LEASE_MS, createOverheadPlugin, NOTABLE_CHECK_MS } from './plugin.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/overhead/${name}`, import.meta.url), 'utf8');

const HOME = { HomeLat: 41.9786, HomeLon: -87.9048 };

function setup(store: Record<string, unknown> = {}, answer?: PluginFetch) {
  const fake = createFakeHost(store);
  const asked: string[] = [];
  const fetch: PluginFetch =
    answer ??
    (async (url) => {
      asked.push(url);
      if (url.includes('airplanes.live')) return fakeResponse(403, fixture('airplaneslive-point-ord-403.json'));
      if (url.includes('adsb.fi')) return fakeResponse(200, fixture('adsbfi-point-ord.json'));
      throw new Error(`unexpected ${url}`);
    });
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
  return { fake, plugin, asked, get, post };
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

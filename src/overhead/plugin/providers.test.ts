import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeResponse as response } from './fakeHost.ts';
import type { PluginFetch, PluginResponse } from './host.ts';
import { BACKOFF_FIRST_MS, createProviderChain, QUOTA_FLOOR, REFUSED_REST_MS, REQUEST_TIMEOUT_MS, retryAfterMs } from './providers.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/overhead/${name}`, import.meta.url), 'utf8');

/** A fetch that answers by host, and records every URL asked. */
function fakeFetch(answers: Record<string, () => PluginResponse | Promise<PluginResponse>>) {
  const asked: string[] = [];
  const fetch: PluginFetch = async (url) => {
    asked.push(url);
    const host = new URL(url).host;
    const answer = answers[host];
    if (!answer) throw new Error(`no route to ${host}`);
    return answer();
  };
  return { fetch, asked };
}

const deps = (fetch: PluginFetch) => ({
  fetch,
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

const REFUSED = () => response(403, fixture('airplaneslive-point-ord-403.json'));
const FI = () => response(200, fixture('adsbfi-point-ord.json'));
const LOL = (remaining = '267') => () => response(200, fixture('adsblol-point-ord.json'), { 'x-ratelimit-remaining': remaining, 'x-ratelimit-reset': '38250' });

describe('the provider chain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T13:22:28Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('asks airplanes.live first, with home rounded to about a kilometre and the radius widened to match', async () => {
    const { fetch, asked } = fakeFetch({ 'api.airplanes.live': FI });
    const chain = createProviderChain(deps(fetch), () => undefined);
    const result = await chain.fetchPositions(41.978612345, -87.904812345, 24.2);
    expect(result?.provider).toBe('airplanes.live');
    expect(asked).toEqual(['https://api.airplanes.live/v2/point/41.98/-87.90/26']);
  });

  it('fails over past a refusal, and rests the refuser for 10 minutes', async () => {
    const { fetch, asked } = fakeFetch({ 'api.airplanes.live': REFUSED, 'opendata.adsb.fi': FI });
    const logs: string[] = [];
    const chain = createProviderChain(deps(fetch), (line) => logs.push(line));
    const first = await chain.fetchPositions(41.9786, -87.9048, 25);
    expect(first?.provider).toBe('adsb.fi');
    expect(first?.snapshot.aircraft).toHaveLength(57);
    expect(asked).toEqual(['https://api.airplanes.live/v2/point/41.98/-87.90/26', 'https://opendata.adsb.fi/api/v2/lat/41.98/lon/-87.90/dist/26']);
    expect(logs).toContain('[overhead] 57 aircraft from adsb.fi');
    expect(chain.status()[0]).toMatchObject({ id: 'airplanes.live', state: 'resting', lastStatus: 403, lastError: 'refused (403)' });

    asked.length = 0;
    await chain.fetchPositions(41.9786, -87.9048, 25);
    expect(asked.map((url) => new URL(url).host)).toEqual(['opendata.adsb.fi']);

    vi.advanceTimersByTime(REFUSED_REST_MS);
    asked.length = 0;
    await chain.fetchPositions(41.9786, -87.9048, 25);
    expect(asked.map((url) => new URL(url).host)).toEqual(['api.airplanes.live', 'opendata.adsb.fi']);
  });

  it('backs off a failing provider exponentially', async () => {
    let fiFails = true;
    const { fetch, asked } = fakeFetch({
      'api.airplanes.live': REFUSED,
      'opendata.adsb.fi': () => (fiFails ? response(502, 'bad gateway') : FI()),
      'api.adsb.lol': LOL(),
    });
    const chain = createProviderChain(deps(fetch), () => undefined);
    expect((await chain.fetchPositions(42, -88, 25))?.provider).toBe('adsb.lol');
    asked.length = 0;
    vi.advanceTimersByTime(BACKOFF_FIRST_MS - 1);
    await chain.fetchPositions(42, -88, 25);
    expect(asked.map((url) => new URL(url).host)).toEqual(['api.adsb.lol']);
    vi.advanceTimersByTime(1);
    asked.length = 0;
    await chain.fetchPositions(42, -88, 25);
    // Asked again, failed again: now it rests twice as long.
    expect(asked.map((url) => new URL(url).host)).toEqual(['opendata.adsb.fi', 'api.adsb.lol']);
    expect((chain.status()[1]?.until ?? 0) - Date.now()).toBe(2 * BACKOFF_FIRST_MS);
    fiFails = false;
    vi.advanceTimersByTime(2 * BACKOFF_FIRST_MS);
    expect((await chain.fetchPositions(42, -88, 25))?.provider).toBe('adsb.fi');
    expect(chain.status()[1]).toMatchObject({ state: 'ok', lastError: null });
  });

  it('honours Retry-After on a 429', async () => {
    const { fetch } = fakeFetch({ 'api.airplanes.live': () => response(429, '', { 'Retry-After': '120' }), 'opendata.adsb.fi': FI });
    const chain = createProviderChain(deps(fetch), () => undefined);
    await chain.fetchPositions(42, -88, 25);
    expect(chain.status()[0]).toMatchObject({ state: 'resting', until: Date.now() + 120_000 });
  });

  it('rests adsb.lol once its day’s quota runs low, until its reset', async () => {
    const { fetch } = fakeFetch({ 'api.airplanes.live': REFUSED, 'opendata.adsb.fi': () => response(500, ''), 'api.adsb.lol': LOL(String(QUOTA_FLOOR - 1)) });
    const chain = createProviderChain(deps(fetch), () => undefined);
    const result = await chain.fetchPositions(42, -88, 25);
    // The answer still counts; only the next ones wait.
    expect(result?.provider).toBe('adsb.lol');
    expect(chain.status()[2]).toMatchObject({ state: 'resting', until: Date.now() + 38250 * 1000, lastError: `${QUOTA_FLOOR - 1} requests left today` });
  });

  it('treats an answer that is not aircraft, or none in time, as a failure', async () => {
    const { fetch } = fakeFetch({
      'api.airplanes.live': () => response(200, '{"error":"maintenance"}'),
      'opendata.adsb.fi': () => new Promise<PluginResponse>(() => undefined),
      'api.adsb.lol': () => response(200, '<html>'),
    });
    const chain = createProviderChain(deps(fetch), () => undefined);
    const pending = chain.fetchPositions(42, -88, 25);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await pending).toBeNull();
    expect(chain.status().map((status) => status.lastError)).toEqual(['answered something other than aircraft', 'no answer in time', 'answered something other than aircraft']);
  });

  it('reads Retry-After as seconds or a date', () => {
    const now = Date.parse('2026-11-23T13:00:00Z');
    expect(retryAfterMs('30', now)).toBe(30_000);
    expect(retryAfterMs('Mon, 23 Nov 2026 13:01:00 GMT', now)).toBe(60_000);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });
});

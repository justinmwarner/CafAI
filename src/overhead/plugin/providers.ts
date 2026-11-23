/**
 * The position providers, tried in order (docs/overhead/DECISIONS.md, O2):
 * airplanes.live, then adsb.fi, then adsb.lol. One request to one provider
 * per poll, and polls at least 2 s apart, so no host sees more than one
 * request a second.
 *
 * A provider that fails rests before it is asked again: 5 s doubling to
 * 5 min for errors and unreadable answers; 10 min after a 401 or 403 (a
 * refused address, as airplanes.live refuses some); after a 429 as long as
 * its Retry-After says. adsb.lol allows 500 requests a day per IP: it rests
 * until its x-ratelimit-reset once x-ratelimit-remaining drops below
 * QUOTA_FLOOR. The provider that served each answer is logged.
 */
import { readReadsbBody, type ReadsbSnapshot } from '../shared/readsb.ts';
import type { ProviderId, ProviderStatus } from '../shared/payload.ts';
import type { PluginDeps } from './host.ts';

export interface ProviderSpec {
  id: ProviderId;
  url(lat: number, lon: number, radiusNm: number): string;
}

/** Coordinates go out to 4 decimals (about 11 m): enough, and no more of home than that. */
const coord = (value: number) => value.toFixed(4);

export const PROVIDERS: readonly ProviderSpec[] = [
  { id: 'airplanes.live', url: (lat, lon, r) => `https://api.airplanes.live/v2/point/${coord(lat)}/${coord(lon)}/${r}` },
  { id: 'adsb.fi', url: (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${coord(lat)}/lon/${coord(lon)}/dist/${r}` },
  // adsb.lol's radius is an integer, 0-250 (its OpenAPI).
  { id: 'adsb.lol', url: (lat, lon, r) => `https://api.adsb.lol/v2/lat/${coord(lat)}/lon/${coord(lon)}/dist/${r}` },
];

export const BACKOFF_FIRST_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const REFUSED_REST_MS = 10 * 60_000;
/** adsb.lol rests once fewer than this many requests are left of its day. */
export const QUOTA_FLOOR = 50;
/** A provider that has not answered in this long is given up on for this poll. */
export const REQUEST_TIMEOUT_MS = 8_000;

interface ProviderState {
  failures: number;
  restUntil: number;
  lastStatus: number | null;
  lastError: string | null;
  used: boolean;
}

export interface PositionsResult {
  provider: ProviderId;
  snapshot: ReadsbSnapshot;
  /** When the answer arrived, ms since the epoch. */
  at: number;
}

export interface ProviderChain {
  /** Asks the first provider that is not resting; null when none answered. */
  fetchPositions(lat: number, lon: number, radiusNm: number): Promise<PositionsResult | null>;
  status(): ProviderStatus[];
}

/** Retry-After as seconds or an HTTP date, in ms from now; null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function createProviderChain(deps: Pick<PluginDeps, 'fetch' | 'now' | 'setTimeout' | 'clearTimeout'>, log: (message: string) => void, providers: readonly ProviderSpec[] = PROVIDERS): ProviderChain {
  const states = new Map<ProviderId, ProviderState>(
    providers.map((provider) => [provider.id, { failures: 0, restUntil: 0, lastStatus: null, lastError: null, used: false }]),
  );

  function rest(state: ProviderState, ms: number, why: string) {
    state.restUntil = deps.now() + ms;
    state.lastError = why;
  }

  function fail(state: ProviderState, why: string) {
    state.failures += 1;
    rest(state, Math.min(BACKOFF_FIRST_MS * 2 ** (state.failures - 1), BACKOFF_MAX_MS), why);
  }

  /** The fetch, or a rejection once REQUEST_TIMEOUT_MS has passed. */
  function fetchWithin(url: string) {
    return new Promise<Awaited<ReturnType<PluginDeps['fetch']>>>((resolve, reject) => {
      const timer = deps.setTimeout(() => reject(new Error('no answer in time')), REQUEST_TIMEOUT_MS);
      deps.fetch(url, { headers: { Accept: 'application/json' } }).then(
        (response) => {
          deps.clearTimeout(timer);
          resolve(response);
        },
        (error: unknown) => {
          deps.clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  async function ask(provider: ProviderSpec, state: ProviderState, lat: number, lon: number, radiusNm: number): Promise<PositionsResult | null> {
    state.used = true;
    let response;
    try {
      response = await fetchWithin(provider.url(lat, lon, Math.max(1, Math.ceil(radiusNm))));
    } catch (error) {
      state.lastStatus = null;
      fail(state, error instanceof Error ? error.message : String(error));
      return null;
    }
    state.lastStatus = response.status;
    const now = deps.now();
    // adsb.lol's daily quota, from its own headers.
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
    const lowQuota = response.headers.get('x-ratelimit-remaining') !== null && Number.isFinite(remaining) && remaining < QUOTA_FLOOR;
    if (response.status === 429) {
      fail(state, 'over its rate limit');
      const after = retryAfterMs(response.headers.get('retry-after'), now);
      if (after !== null) state.restUntil = Math.max(state.restUntil, now + after);
      return null;
    }
    if (response.status === 401 || response.status === 403) {
      rest(state, REFUSED_REST_MS, `refused (${response.status})`);
      return null;
    }
    if (!response.ok) {
      fail(state, `answered ${response.status}`);
      return null;
    }
    let snapshot: ReadsbSnapshot | null;
    try {
      snapshot = readReadsbBody(await response.json());
    } catch {
      snapshot = null;
    }
    if (snapshot === null) {
      fail(state, 'answered something other than aircraft');
      return null;
    }
    state.failures = 0;
    state.lastError = null;
    state.restUntil = 0;
    if (lowQuota) rest(state, Number.isFinite(resetSeconds) && resetSeconds > 0 ? resetSeconds * 1000 : BACKOFF_MAX_MS, `${remaining} requests left today`);
    return { provider: provider.id, snapshot, at: now };
  }

  return {
    async fetchPositions(lat, lon, radiusNm) {
      for (const provider of providers) {
        const state = states.get(provider.id) as ProviderState;
        if (deps.now() < state.restUntil) continue;
        const result = await ask(provider, state, lat, lon, radiusNm);
        if (result) {
          log(`[overhead] ${result.snapshot.aircraft.length} aircraft from ${provider.id}`);
          return result;
        }
        log(`[overhead] ${provider.id}: ${state.lastError ?? 'failed'}`);
      }
      return null;
    },
    status() {
      const now = deps.now();
      return providers.map((provider) => {
        const state = states.get(provider.id) as ProviderState;
        return {
          id: provider.id,
          state: !state.used ? 'unused' : now < state.restUntil ? 'resting' : 'ok',
          until: now < state.restUntil ? state.restUntil : null,
          lastStatus: state.lastStatus,
          lastError: state.lastError,
        };
      });
    },
  };
}

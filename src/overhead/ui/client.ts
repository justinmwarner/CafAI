/**
 * The skin's only door to Overhead's data: the plugin's endpoints on Decaid
 * (docs/overhead/README.md). Never a third-party host: those are the
 * plugin's to call (the brief's rule). A read that fails or answers
 * something unreadable rejects; the caller keeps what it had.
 */
import { readPayload, type OverheadPayload } from '../shared/payload.ts';
import { CONFIG_ENDPOINT, OVERHEAD_ENDPOINT, OVERHEAD_PLUGIN_ID } from '../shared/settings.ts';

export const OVERHEAD_TIMEOUT_MS = 6_000;

export interface OverheadClient {
  /** The aircraft. `active`: the screensaver shows (the plugin polls for it); `mock`: the recorded replay. */
  overhead(options: { active: boolean; mock?: boolean }): Promise<OverheadPayload>;
  /** The settings in effect, keyed as the manifest keys them. */
  config(): Promise<Record<string, unknown>>;
  /** Saves settings (null clears one); answers the settings in effect after. */
  saveConfig(values: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class OverheadUnavailable extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'OverheadUnavailable';
  }
}

export function createOverheadClient(origin: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): OverheadClient {
  const base = `${origin.replace(/\/+$/, '')}/api/v1/plugins/${OVERHEAD_PLUGIN_ID}`;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERHEAD_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${base}/${path}`, { ...init, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new OverheadUnavailable(response.status, response.status === 404 ? 'The Overhead plugin is not running in Decaid.' : `Overhead answered ${response.status}.`);
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof OverheadUnavailable) throw error;
      throw new OverheadUnavailable(0, controller.signal.aborted ? 'Overhead did not answer in time.' : 'Decaid could not be reached.');
    } finally {
      clearTimeout(timer);
    }
  }

  const values = (body: unknown): Record<string, unknown> => {
    if (typeof body === 'object' && body !== null && 'values' in body && typeof body.values === 'object' && body.values !== null) return body.values as Record<string, unknown>;
    throw new OverheadUnavailable(0, 'Overhead answered something CafAI cannot read.');
  };

  return {
    async overhead({ active, mock = false }) {
      const query = [active ? '' : 'active=0', mock ? 'mock=1' : ''].filter(Boolean).join('&');
      const payload = readPayload(await call(query ? `${OVERHEAD_ENDPOINT}?${query}` : OVERHEAD_ENDPOINT));
      if (payload === null) throw new OverheadUnavailable(0, 'Overhead answered something CafAI cannot read.');
      return payload;
    },
    async config() {
      return values(await call(CONFIG_ENDPOINT));
    },
    async saveConfig(changes) {
      return values(await call(CONFIG_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: changes }) }));
    },
  };
}

/** No plugin to ask (fakes, previews): every read fails as a missing plugin does, so Overhead stays off. */
export const NO_OVERHEAD: OverheadClient = {
  overhead: () => Promise.reject(new OverheadUnavailable(404, 'The Overhead plugin is not running in Decaid.')),
  config: () => Promise.reject(new OverheadUnavailable(404, 'The Overhead plugin is not running in Decaid.')),
  saveConfig: () => Promise.reject(new OverheadUnavailable(404, 'The Overhead plugin is not running in Decaid.')),
};

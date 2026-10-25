// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocket } from '../api/testing/fakeWebSocket.ts';
import type { IdbStorage } from '../storage/index.ts';
import { buildMirrorEntries } from '../storage/mirror.ts';
import { MODEL, makeBag, makeSettings } from '../storage/testing/fixtures.ts';
import { createServices, type AppServices } from './createServices.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

/**
 * Decaid as far as start-up needs it: the key-value store, holding CafAI's
 * backup once `backUp` is called, empty lists for plugins and devices, and
 * "Route not found" for the rest. While `down`, nothing answers.
 */
function fakeDecaid() {
  const state = { down: false, store: new Map<string, Map<string, unknown>>() };
  const space = (namespace: string) => {
    let found = state.store.get(namespace);
    if (!found) state.store.set(namespace, (found = new Map()));
    return found;
  };
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (state.down) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const kv = /^\/api\/v1\/store\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (kv) {
      const [, namespace = '', key] = kv;
      if (key === undefined) return json(Object.fromEntries(space(namespace)));
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json(space(namespace).get(key) ?? null);
      if (method === 'POST') space(namespace).set(key, JSON.parse(String(init?.body)));
      else space(namespace).delete(key);
      return json({});
    }
    if (url.pathname === '/api/v1/plugins' || url.pathname === '/api/v1/devices') return json([]);
    return new Response('Route not found', { status: 404 });
  });
  return {
    state,
    fetch,
    /** A backup from a device that chose the 12-hour clock and hid the TDS cell. */
    backUp() {
      const snapshot = {
        settings: makeSettings({ activeBagId: 'bag_kiambu', clock: '12h', showTds: false }),
        bags: [makeBag()],
        versions: [],
        iterations: [],
        conversations: [],
      };
      for (const [key, text] of buildMirrorEntries(snapshot, null, MODEL).entries) space('cafai').set(key, JSON.parse(text));
    },
  };
}

describe('createServices: the clock and the TDS cell (D245, D246)', () => {
  let decaid: ReturnType<typeof fakeDecaid>;
  let services: AppServices | null = null;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    decaid = fakeDecaid();
    vi.stubGlobal('fetch', decaid.fetch);
    vi.stubGlobal('WebSocket', createFakeWebSocket().WebSocketImpl);
  });

  afterEach(() => {
    services?.dispose();
    (services?.storage as IdbStorage | undefined)?.close();
    services?.coachSource?.close();
    services = null;
    vi.unstubAllGlobals();
  });

  it('starts 24-hour with the TDS cell shown, and keeps a choice for the next start', async () => {
    services = await createServices(window);
    const prefs = services.displayPrefs!;
    expect([prefs.clock(), prefs.showTds()]).toEqual(['24h', true]);
    await prefs.setClock('12h');
    await prefs.setShowTds(false);
    expect(await services.storage.settings.get()).toMatchObject({ clock: '12h', showTds: false });

    services.dispose();
    (services.storage as IdbStorage).close();
    services.coachSource?.close();
    services = await createServices(window);
    expect([services.displayPrefs!.clock(), services.displayPrefs!.showTds()]).toEqual(['12h', false]);
  });

  it("takes them from Decaid's backup at start", async () => {
    decaid.backUp();
    services = await createServices(window);
    expect([services.displayPrefs!.clock(), services.displayPrefs!.showTds()]).toEqual(['12h', false]);
  });

  it('takes them once Decaid answers, when the backup comes back after start', async () => {
    decaid.backUp();
    decaid.state.down = true;
    services = await createServices(window);
    expect([services.displayPrefs!.clock(), services.displayPrefs!.showTds()]).toEqual(['24h', true]);

    decaid.state.down = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect([services!.displayPrefs!.clock(), services!.displayPrefs!.showTds()]).toEqual(['12h', false]));
  });
});

// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocket, type FakeWebSocketFactory } from '../api/testing/fakeWebSocket.ts';
import { buildMirrorEntries } from '../storage/mirror.ts';
import { KEY_NAME, KEY_NAMESPACE } from '../storage/keyBackup.ts';
import { API_KEY, MODEL, makeBag, makeConversation, makeSettings, makeVersion } from '../storage/testing/fixtures.ts';
import type { IdbStorage } from '../storage/index.ts';
import { createServices, type AppServices } from './createServices.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

/**
 * Decaid over fetch, as far as start-up needs it: the key-value store (the
 * backup in `cafai`, the key's copy in `cafai-key`), empty lists for plugins
 * and devices, and "Route not found" for the rest. While `down`, nothing answers.
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
    const method = init?.method ?? 'GET';
    const kv = /^\/api\/v1\/store\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (kv) {
      const [, namespace = '', key] = kv;
      if (key === undefined) return json(Object.fromEntries(space(namespace)));
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
    /** A backup as CafAI's mirror writes it. */
    backUp() {
      const snapshot = {
        settings: makeSettings({ activeBagId: 'bag_kiambu', appearance: { mode: 'light', tint: { hue: 200 } } }),
        bags: [makeBag()],
        versions: [makeVersion()],
        iterations: [],
        conversations: [makeConversation({ apiMessages: [] })],
      };
      for (const [key, text] of buildMirrorEntries(snapshot, null, MODEL).entries) space('cafai').set(key, JSON.parse(text));
    },
    keepKey(key: string) {
      space(KEY_NAMESPACE).set(KEY_NAME, key);
    },
  };
}

describe('createServices: bags and the key back from Decaid (D99, D100)', () => {
  let decaid: ReturnType<typeof fakeDecaid>;
  let sockets: FakeWebSocketFactory;
  let services: AppServices | null = null;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    decaid = fakeDecaid();
    vi.stubGlobal('fetch', decaid.fetch);
    sockets = createFakeWebSocket();
    vi.stubGlobal('WebSocket', sockets.WebSocketImpl);
  });

  afterEach(() => {
    services?.dispose();
    (services?.storage as IdbStorage | undefined)?.close();
    services = null;
    vi.unstubAllGlobals();
  });

  const notices = () =>
    services!.coach
      .getState()
      .messages.flatMap((m) => m.parts)
      .flatMap((part) => (part.kind === 'notice' ? [part.text] : []));

  it('restores the bags at start when Decaid answers, and knows it did', async () => {
    decaid.backUp();
    services = await createServices(window);
    expect(services.coach.getState()).toMatchObject({ restoredFromBackup: true, activeBag: { id: 'bag_kiambu' } });
    expect(services.appearance.get()).toEqual({ mode: 'light', tint: { hue: 200 } });
  });

  it('keeps trying when Decaid does not answer at start, and shows the bags, the look and a note once it does (5.4)', async () => {
    decaid.backUp();
    decaid.state.down = true;
    services = await createServices(window);
    expect(services.coach.getState()).toMatchObject({ ready: true, bags: [], restoredFromBackup: false });

    decaid.state.down = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(services!.coach.getState().bags.map((bag) => bag.id)).toEqual(['bag_kiambu']));
    await vi.waitFor(() => expect(notices()).toContain("Your bags are back from Decaid's backup."));
    expect(services.coach.getState()).toMatchObject({ restoredFromBackup: true, activeBag: { id: 'bag_kiambu' } });
    await vi.waitFor(() => expect(services!.appearance.get()).toEqual({ mode: 'light', tint: { hue: 200 } }));
  });

  it("tries again at once when Decaid's devices socket opens", async () => {
    decaid.backUp();
    decaid.state.down = true;
    services = await createServices(window);
    decaid.state.down = false;
    sockets.latest('/ws/v1/devices').open();
    await vi.waitFor(() => expect(services!.coach.getState().bags.map((bag) => bag.id)).toEqual(['bag_kiambu']));
  });

  it('brings back a key kept in Decaid at start, so the coach does not ask for it', async () => {
    decaid.backUp();
    decaid.keepKey(API_KEY);
    services = await createServices(window);
    expect(services.coach.getState()).toMatchObject({ hasApiKey: true, restoredFromBackup: true });
    expect(await services.storage.secrets.getApiKey()).toBe(API_KEY);
  });

  it('brings back a key kept in Decaid once Decaid answers, and then has it', async () => {
    decaid.keepKey(API_KEY);
    decaid.state.down = true;
    services = await createServices(window);
    expect(services.coach.getState().hasApiKey).toBe(false);
    decaid.state.down = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(services!.coach.getState().hasApiKey).toBe(true));
    expect(services.coach.getState().restoredFromBackup).toBe(false);
  });
});

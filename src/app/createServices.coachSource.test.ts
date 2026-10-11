// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWebSocket } from '../api/testing/fakeWebSocket.ts';
import type { IdbStorage } from '../storage/index.ts';
import { API_KEY } from '../storage/testing/fixtures.ts';
import { createServices, type AppServices } from './createServices.ts';

const COMPUTER = { kind: 'computer', address: '192.168.1.20:8877', code: 'ABCDEFGH' } as const;
const SIGNED_OUT = 'Claude Code on your computer is not signed in. Open a terminal there, run claude and sign in with /login.';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

/**
 * Decaid as far as start-up needs it (an empty key-value store, no plugins,
 * no devices, "Route not found" for the rest), and CafAI Bridge at
 * 192.168.1.20:8877, whose Claude Code is signed out.
 */
function network() {
  const posts: Array<{ url: string; key: string | null }> = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin === 'http://192.168.1.20:8877') {
      posts.push({ url: url.href, key: new Headers(init?.headers).get('x-api-key') });
      return json({ type: 'error', error: { type: 'authentication_error', message: SIGNED_OUT } }, 401);
    }
    const kv = /^\/api\/v1\/store\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (kv) return json(kv[2] === undefined ? {} : null);
    if (url.pathname === '/api/v1/plugins' || url.pathname === '/api/v1/devices') return json([]);
    return new Response('Route not found', { status: 404 });
  });
  return { fetch, posts };
}

describe('createServices: where the coach runs', () => {
  let services: AppServices | null = null;
  let net: ReturnType<typeof network>;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    net = network();
    vi.stubGlobal('fetch', net.fetch);
    vi.stubGlobal('WebSocket', createFakeWebSocket().WebSocketImpl);
  });

  afterEach(() => {
    services?.dispose();
    (services?.storage as IdbStorage | undefined)?.close();
    services?.coachSource?.close();
    services = null;
    vi.unstubAllGlobals();
  });

  it('starts on Anthropic, and needs only the address and code, no API key, on the computer', async () => {
    services = await createServices(window);
    const coachSource = services.coachSource!;
    expect(await coachSource.get()).toEqual({ kind: 'anthropic', address: '', code: '' });
    expect(services.coach.getState().hasApiKey).toBe(false);

    await coachSource.set(COMPUTER);
    await services.coach.refresh();
    expect(services.coach.getState().hasApiKey).toBe(true);
    // The key store itself is untouched: nothing was saved as a key.
    expect(await services.storage.secrets.getApiKey()).toBeNull();

    await coachSource.set({ ...COMPUTER, code: '' });
    await services.coach.refresh();
    expect(services.coach.getState().hasApiKey).toBe(false);
  });

  it('needs the API key again back on Anthropic', async () => {
    services = await createServices(window);
    await services.storage.secrets.setApiKey(API_KEY);
    await services.coach.refresh();
    expect(services.coach.getState().hasApiKey).toBe(true);

    await services.coachSource!.set({ kind: 'computer', address: '', code: '' });
    await services.coach.refresh();
    expect(services.coach.getState().hasApiKey).toBe(false);
  });

  it('waits for the code on the computer, then sends the waiting turn once it is saved', async () => {
    services = await createServices(window);
    await services.coachSource!.set({ ...COMPUTER, code: '' });
    await services.coach.refresh();
    await services.coach.newBag();
    await services.coach.sendText('Kiambu AA, light roast, washed');
    // The engine's own sentence (src/app/engine/engine.ts), worded for the API key.
    await vi.waitFor(() => expect(services!.coach.getState().error).toBe('Add your Anthropic API key in Settings to start coaching.'));
    expect(net.posts).toEqual([]);

    await services.coachSource!.set(COMPUTER);
    await services.coach.refresh();
    await vi.waitFor(() => expect(net.posts).toEqual([{ url: 'http://192.168.1.20:8877/v1/messages', key: 'ABCDEFGH' }]));
    await vi.waitFor(() => expect(services!.coach.getState().error).toBe(SIGNED_OUT));
  });

  it('still starts, on Anthropic, when this device refuses the new database', async () => {
    const factory = new IDBFactory();
    const open = factory.open.bind(factory);
    factory.open = (name: string, version?: number) => {
      if (name === 'cafai-coach-source') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return open(name, version);
    };
    vi.stubGlobal('indexedDB', factory);
    services = await createServices(window);
    expect(services.coachSource).toBeUndefined();
    expect(services.coach.getState().hasApiKey).toBe(false);
    await services.storage.secrets.setApiKey(API_KEY);
    await services.coach.refresh();
    expect(services.coach.getState().hasApiKey).toBe(true);
  });

  it("sends the coach's turns to the bridge with its code, and shows the bridge's own sentence", async () => {
    services = await createServices(window);
    await services.coachSource!.set(COMPUTER);
    await services.coach.refresh();
    await services.coach.newBag();
    await services.coach.sendText('Kiambu AA, light roast, washed');

    await vi.waitFor(() => expect(services!.coach.getState().error).toBe(SIGNED_OUT));
    expect(net.posts).toEqual([{ url: 'http://192.168.1.20:8877/v1/messages', key: 'ABCDEFGH' }]);
  });
});

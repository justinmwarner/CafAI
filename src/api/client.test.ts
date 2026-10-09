// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/gateway.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, the DecaidClient API, and endpoint tests against the MSW mock.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../../mock/node.ts';
import { fixtures } from '../../mock/fixtures/index.ts';
import { createDecaidClient } from './client.ts';
import { GatewayError, type ProfileCreateRequest } from './types.ts';

// ---- transport, ported (stubbed fetch) ----------------------------------------------

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as unknown as typeof fetch;
}

const workflow = fixtures.workflowGet();

describe('transport (ported)', () => {
  it('a workflow read hits the documented path', async () => {
    let seen = '';
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url) => {
        seen = url;
        return new Response(JSON.stringify(workflow), { status: 200 });
      }),
    });
    expect((await client.getWorkflow()).id).toBe(workflow.id);
    expect(seen).toBe('http://localhost:8080/api/v1/workflow');
  });

  it('machine info exposes whether physical GHC controls are fitted', async () => {
    let seen = '';
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url) => {
        seen = url;
        return new Response(JSON.stringify({ model: 'DE1XL', GHC: true }), { status: 200 });
      }),
    });
    expect((await client.getMachineInfo()).GHC).toBe(true);
    expect(seen).toBe('http://localhost:8080/api/v1/machine/info');
  });

  it("device controls use Decaid's documented connect and tare routes", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        return new Response(url.includes('/tare') ? null : '[]', { status: url.includes('/tare') ? 204 : 200 });
      }),
    });
    await client.connectDevice('MockScale');
    await client.tareScale();
    expect(calls).toEqual([
      { url: 'http://localhost:8080/api/v1/devices/connect', method: 'PUT', body: '{"deviceId":"MockScale"}' },
      { url: 'http://localhost:8080/api/v1/scale/tare', method: 'PUT' },
    ]);
  });

  it('an update PUTs JSON and returns the gateway answer, not an optimistic guess', async () => {
    let body = '';
    let method = '';
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((_url, init) => {
        method = String(init?.method);
        body = String(init?.body);
        return new Response(JSON.stringify({ ...workflow, id: 'wf-2' }), { status: 200 });
      }),
    });
    const result = await client.updateWorkflow({ context: { targetYield: 36 } });
    expect(method).toBe('PUT');
    expect(JSON.parse(body)).toEqual({ context: { targetYield: 36 } });
    expect(result.id).toBe('wf-2');
  });

  it('trims a trailing slash from the origin and derives the websocket origin', () => {
    const client = createDecaidClient({ origin: 'https://box:8080/' });
    expect(client.httpOrigin).toBe('https://box:8080');
    expect(client.wsOrigin).toBe('wss://box:8080');
  });
});

// ---- settings, plugins and the enjoyment probe (0.3) ------------------------------------

describe('updateSettings and listPlugins', () => {
  it('POSTs the patch (Decaid answers null) and reads the settings back', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url, init) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        if (method === 'POST') return new Response(null, { status: 200 });
        return new Response(JSON.stringify({ gatewayMode: 'tracking' }), { status: 200 });
      }),
    });
    const settings = await client.updateSettings({ gatewayMode: 'tracking' });
    expect(calls).toEqual([
      { url: 'http://localhost:8080/api/v1/settings', method: 'POST', body: '{"gatewayMode":"tracking"}' },
      { url: 'http://localhost:8080/api/v1/settings', method: 'GET' },
    ]);
    expect(settings).toEqual({ gatewayMode: 'tracking' });
  });

  it('turns a null plugins body into an empty list', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(() => new Response('null', { status: 200 })),
    });
    expect(await client.listPlugins()).toEqual([]);
  });
});

describe('probeEnjoymentScale (D101)', () => {
  it('a 400 that mentions enjoyment means the 0-10 scale', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(
        () =>
          new Response(JSON.stringify({ error: 'Invalid request', message: 'enjoyment must be between 0 and 10' }), {
            status: 400,
          }),
      ),
    });
    expect(await client.probeEnjoymentScale()).toBe(10);
  });

  it('a 404 (the probe id does not exist) means the 0-100 scale', async () => {
    const client = createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(() => new Response(null, { status: 404 })) });
    expect(await client.probeEnjoymentScale()).toBe(100);
  });

  it('a 200 (the write went through) cannot tell the scale', async () => {
    const client = createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(() => new Response(null, { status: 200 })) });
    expect(await client.probeEnjoymentScale()).toBeNull();
  });

  it('a network failure cannot tell the scale either', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(() => Promise.reject(new TypeError('Failed to fetch'))),
    });
    expect(await client.probeEnjoymentScale()).toBeNull();
  });

  it('probes a made-up shot id under /api/v1/shots/cafai-probe', async () => {
    let seen = '';
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url) => {
        seen = url;
        return new Response(null, { status: 404 });
      }),
    });
    await client.probeEnjoymentScale();
    expect(seen).toMatch(/^http:\/\/localhost:8080\/api\/v1\/shots\/cafai-probe/);
  });
});

describe('the bean library', () => {
  it('percent-encodes the bean id when listing its batches', async () => {
    let seen = '';
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url) => {
        seen = url;
        return new Response('[]', { status: 200 });
      }),
    });
    await client.listBatches('bean:1');
    expect(seen).toBe('http://localhost:8080/api/v1/beans/bean%3A1/batches');
  });
});

// ---- connecting one device without disturbing the others (ported) ------------------------

async function connectCalls(kind: 'machine' | 'scale', scanResult: (url: string) => unknown[]): Promise<Array<{ url: string; body?: string }>> {
  const calls: Array<{ url: string; body?: string }> = [];
  const client = createDecaidClient({
    origin: 'http://localhost:8080',
    fetch: stubFetch((url, init) => {
      calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      const body = url.includes('/devices/connect') ? '{}' : JSON.stringify(scanResult(url));
      return new Response(body, { status: 200 });
    }),
  });
  await client.connectKind(kind);
  return calls;
}

const de1 = { name: 'DE1', id: 'm-1', state: 'disconnected', type: 'machine', available: true };
const scale = { name: 'Decent Scale', id: 's-1', state: 'connected', type: 'scale', available: true };

describe('connectKind (ported)', () => {
  it('connecting never asks the gateway to connect everything it can see', async () => {
    // scan?connect=true connects whatever it finds. Asking for the scale then
    // churned Bluetooth for the machine too, and a DE1 mid-handshake drops.
    const calls = await connectCalls('machine', () => [de1, scale]);
    expect(calls.some((c) => c.url.includes('connect=true')), 'no shotgun scan').toBe(false);
    expect(calls.some((c) => c.url.includes('/devices/scan')), 'it still discovers').toBe(true);
  });

  it('only the device that was asked for is connected', async () => {
    const calls = await connectCalls('machine', () => [de1, scale]);
    const connects = calls.filter((c) => c.url.includes('/devices/connect'));
    expect(connects).toHaveLength(1);
    expect(connects[0]!.body, 'the machine, by id').toBe('{"deviceId":"m-1"}');
  });

  it('a device already connected is left alone', async () => {
    const calls = await connectCalls('scale', () => [de1, scale]);
    expect(calls.filter((c) => c.url.includes('/devices/connect'))).toHaveLength(0);
  });

  it('an unavailable device is not connected to', async () => {
    const asleep = { ...de1, available: false };
    const calls = await connectCalls('machine', () => [asleep]);
    expect(calls.filter((c) => c.url.includes('/devices/connect')), 'connecting to hardware that is not advertising just errors').toHaveLength(0);
  });

  it('an empty quick scan falls through to the full one', async () => {
    const calls = await connectCalls('machine', (url) => (url.includes('quick=true') ? [] : [de1]));
    expect(calls[0]!.url).toMatch(/quick=true/);
    expect(calls[1]!.url).toBe('http://localhost:8080/api/v1/devices/scan');
    expect(calls[2]!.body).toBe('{"deviceId":"m-1"}');
  });

  it('a quick scan that finds the device is the end of the scanning', async () => {
    const calls = await connectCalls('machine', () => [de1]);
    expect(calls.filter((c) => c.url.includes('/devices/scan'))).toHaveLength(1);
  });
});

// ---- the required-field fill (ported) ------------------------------------------------------

describe('createProfile wire fill (ported)', () => {
  function capture() {
    const sent: { body: Record<string, unknown> | null } = { body: null };
    const client = createDecaidClient({
      origin: 'http://gw:8080',
      fetch: stubFetch((_url, init) => {
        sent.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'p1', profile: sent.body.profile }), { status: 201 });
      }),
    });
    return { client, sent };
  }

  it('AI-authored profiles are created through the profile record endpoint', async () => {
    const { client, sent } = capture();
    const created = await client.createProfile({ profile: { title: 'AI · Kenya', steps: [] } } as unknown as ProfileCreateRequest);
    expect(created.id).toBe('p1');
    // The defaults are Decaid's requirement, not ours: see createProfile.
    expect(sent.body).toEqual({
      profile: { title: 'AI · Kenya', steps: [], version: '2', target_volume: 0, target_volume_count_start: 0, tank_temperature: 0 },
    });
  });

  it('a created profile carries the fields Decaid requires', async () => {
    const { client, sent } = capture();
    await client.createProfile({ profile: { title: 'Authored', steps: [], target_weight: 36 } } as unknown as ProfileCreateRequest);
    const profile = sent.body!.profile as Record<string, unknown>;
    expect(profile.tank_temperature).toBe(0);
    expect(profile.target_volume).toBe(0);
    expect(profile.target_volume_count_start).toBe(0);
    expect(profile.version).toBe('2');
    expect(profile.title, 'what the caller did set survives').toBe('Authored');
    expect(profile.target_weight).toBe(36);
  });

  it('a duplicated profile keeps its own values rather than the defaults', async () => {
    const { client, sent } = capture();
    await client.createProfile({
      profile: { version: '2', title: 'Copy of Adaptive', steps: [], target_volume: 36, target_volume_count_start: 3, tank_temperature: 92 },
    } as unknown as ProfileCreateRequest);
    const profile = sent.body!.profile as Record<string, unknown>;
    expect(profile.target_volume).toBe(36);
    expect(profile.target_volume_count_start).toBe(3);
    expect(profile.tank_temperature).toBe(92);
  });

  it('an explicit null version or target_volume is content, not a gap, so it is kept', async () => {
    const { client, sent } = capture();
    await client.createProfile({
      profile: { version: null, title: 'Odd', steps: [], target_volume: null, target_volume_count_start: null, tank_temperature: null },
    } as unknown as ProfileCreateRequest);
    expect(sent.body!.profile).toMatchObject({ version: null, target_volume: null, target_volume_count_start: 0, tank_temperature: 0 });
  });

  it('sends parentId and metadata only when given', async () => {
    const { client, sent } = capture();
    await client.createProfile({ profile: fixtures.profileCreateRequest().profile });
    expect(Object.keys(sent.body!)).toEqual(['profile']);
    await client.createProfile(fixtures.profileCreateRequest());
    expect(Object.keys(sent.body!).sort()).toEqual(['metadata', 'parentId', 'profile']);
  });
});

// ---- every endpoint against the MSW mock ----------------------------------------------------

describe('against the mock Decaid', () => {
  const mock = createMockServer();
  const client = createDecaidClient({ origin: 'http://localhost:8080' });

  beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => mock.server.resetHandlers());
  afterAll(() => mock.close());

  it('reads build info, settings, machine info, state and capabilities', async () => {
    expect(await client.getInfo()).toEqual(fixtures.buildInfo());
    expect(await client.getSettings()).toMatchObject({ gatewayMode: 'disabled', blockOnNoScale: false });
    expect(await client.getMachineInfo()).toMatchObject({ model: 'DE1Pro', version: '1358' });
    expect((await client.getMachineState()).state).toEqual({ state: 'idle', substate: 'idle' });
    expect(await client.getCapabilities()).toEqual([]);
  });

  it('commands the machine (200 null) and maps the policy and connection errors', async () => {
    await expect(client.setMachineState('sleeping')).resolves.toBeUndefined();
    await client.setMachineState('idle');
    expect(mock.state.machineCommands.slice(-2)).toEqual(['sleeping', 'idle']);

    mock.state.setSettings({ blockOnNoScale: true });
    mock.state.setScaleConnected(false);
    const blocked = await client.setMachineState('espresso').catch((e: unknown) => e);
    mock.state.setSettings({ blockOnNoScale: false });
    mock.state.setScaleConnected(true);
    expect(blocked).toBeInstanceOf(GatewayError);
    expect(blocked).toMatchObject({
      status: 400,
      code: 'block_no_scale',
      message: 'Connect a scale before pulling a shot (Decaid is set to require one).',
    });

    mock.state.setMachineConnected(false);
    const away = await client.getMachineState().catch((e: unknown) => e);
    mock.state.setMachineConnected(true);
    expect(away).toMatchObject({
      status: 500,
      code: 'not_connected',
      message: 'The machine is not connected. Wake the DE1 and check it is paired with Decaid.',
    });
  });

  it('sends a heartbeat and reads the devices', async () => {
    expect(await client.heartbeat()).toEqual({ timeout: 1800 });
    const devices = await client.getDevices();
    expect(devices.map((d) => [d.type, d.state])).toEqual([
      ['scale', 'connected'],
      ['machine', 'connected'],
    ]);
  });

  it('tares, and explains a blocked or missing scale', async () => {
    await expect(client.tareScale()).resolves.toBeUndefined();
    mock.state.setScaleConnected(false);
    const missing = await client.tareScale().catch((e: unknown) => e);
    mock.state.setScaleConnected(true);
    expect(missing).toMatchObject({ status: 500, code: 'not_connected', message: expect.stringMatching(/^The scale is not connected/) });
  });

  it('reads and deep-merges the workflow, and surfaces Decaid validation', async () => {
    const before = await client.getWorkflow();
    const after = await client.updateWorkflow({ context: { targetYield: 40 } });
    expect(after.profile).toEqual(before.profile);
    expect(after.context?.targetYield).toBe(40);
    const rejected = await client.updateWorkflow({ context: { targetYield: null as unknown as number } }).catch((e: unknown) => e);
    expect(rejected).toMatchObject({ status: 400, code: 'http', message: 'Field "targetYield" cannot be null' });
    await client.updateWorkflow({ context: { targetYield: before.context!.targetYield! } });
  });

  it('lists, reads, creates (with dedupe) and updates profiles', async () => {
    const visible = await client.listProfiles();
    expect(visible.some((r) => r.id === 'profile:7438cb7266f60558b48f')).toBe(true);

    // Ids are percent-encoded; Decaid decodes them once.
    expect((await client.getProfile('profile:7438cb7266f60558b48f')).profile.title).toBe('Blooming Espresso');
    const missing = await client.getProfile('profile:nope').catch((e: unknown) => e);
    expect(missing).toMatchObject({ status: 404, message: 'Profile not found' });

    const request = fixtures.profileCreateRequest();
    const created = await client.createProfile({ ...request, profile: { ...request.profile, target_weight: 37 } });
    expect(created.id).toMatch(/^profile:[0-9a-f]{20}$/);
    expect(created.parentId).toBe('profile:a582ef47a76f99f56912');
    const again = await client.createProfile({ ...request, profile: { ...request.profile, target_weight: 37, title: 'Renamed' } });
    expect(again).toEqual(created);

    const children = await client.listProfiles({ parentId: 'profile:a582ef47a76f99f56912' });
    expect(children.map((r) => r.id)).toContain(created.id);
    const renamed = await client.updateProfile(created.id, { profile: { ...request.profile, target_weight: 37, title: 'Guji v2' } });
    expect(renamed).toMatchObject({ id: created.id, profile: { title: 'Guji v2' } });
    const hidden = await client.listProfiles({ includeHidden: true });
    expect(hidden.length).toBeGreaterThanOrEqual(visible.length);
  });

  it('pages shots, reads the latest and one by id, and updates annotations', async () => {
    const page = await client.listShots({ limit: 5, offset: 0 });
    expect(page).toMatchObject({ total: 1, limit: 5, offset: 0 });
    const latest = await client.getLatestShot();
    expect(latest?.id).toBe('3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17');
    const shot = await client.getShot(latest!.id);
    expect(shot.measurements).toHaveLength(7);
    const updated = await client.updateShot(shot.id, { annotations: { enjoyment: 9 } });
    expect(updated.annotations?.enjoyment).toBe(9);
    expect(updated.annotations?.extras).toEqual(shot.annotations?.extras);
    const bad = await client.updateShot(shot.id, { annotations: { enjoyment: 12 } }).catch((e: unknown) => e);
    expect(bad).toMatchObject({ status: 400, message: 'annotations.enjoyment must be between 0 and 10, got 12' });
  });

  it('getLatestShot is null when there are no shots', async () => {
    const seeded = mock.state.getShot('3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17');
    mock.state.deleteShot(seeded.id);
    try {
      expect(await client.getLatestShot()).toBeNull();
    } finally {
      mock.state.addShot(seeded);
    }
  });

  it('retries a GET once on 503, never a state change', async () => {
    mock.state.failNext({ method: 'GET', path: '/api/v1/workflow', status: 503, body: { error: 'global_admission_limit' }, headers: { 'Retry-After': '0' } });
    expect((await client.getWorkflow()).id).toBe(workflow.id);

    mock.state.failNext({ method: 'PUT', path: '/api/v1/machine/state/espresso', status: 503, body: { error: 'Machine write queue is full' } });
    const error = await client.setMachineState('espresso').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(mock.player.activity).toBeNull();
  });

  it('reads and writes the key-value store through client.kv', async () => {
    await client.kv.set('cafai', 'meta', { schemaVersion: 1 });
    expect(await client.kv.get('cafai', 'meta')).toEqual({ schemaVersion: 1 });
    expect(await client.kv.list('cafai')).toContain('meta');
    await client.kv.delete('cafai', 'meta');
    expect(await client.kv.get('cafai', 'meta')).toBeNull();
  });

  it('percent-encodes ids so an odd id stays one path segment', async () => {
    const error = await client.getShot('a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 404, message: 'Shot not found' });
    expect(mock.state.requests.at(-1)!.path).toBe('/api/v1/shots/a%2Fb');
  });
});

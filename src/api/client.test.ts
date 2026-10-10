// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/gateway.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, the DecaidClient API, and endpoint tests against the MSW mock.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '../../mock/node.ts';
import { fixtures } from '../../mock/fixtures/index.ts';
import { createDecaidClient } from './client.ts';
import { driftLog } from './drift.ts';
import { GatewayError, type ProfileCreateRequest } from './types.ts';

const drift = () => driftLog.list().map(({ source, problem }) => ({ source, problem }));

beforeEach(() => {
  driftLog.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

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

// ---- replies are read, not trusted (D95) ---------------------------------------------

/** A client whose every call is answered with `body`. */
function answering(body: unknown, status = 200) {
  return createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(() => new Response(JSON.stringify(body), { status })) });
}

describe('replies are read, not trusted', () => {
  it('a workflow without its profile fails the call, and the drift log says why', async () => {
    const { profile: _profile, ...broken } = workflow;
    const error = await answering(broken).getWorkflow().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code: 'unexpected_reply', message: "Decaid sent a reply CafAI doesn't recognise." });
    expect(drift()).toEqual([{ source: 'GET /api/v1/workflow', problem: 'profile: missing' }]);
    await expect(answering(broken).updateWorkflow({ context: { targetYield: 36 } })).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(drift()).toContainEqual({ source: 'PUT /api/v1/workflow', problem: 'profile: missing' });
  });

  it('names a route with an id by its template, so every shot shares one entry', async () => {
    const { workflow: _workflow, ...shot } = fixtures.shotRecord();
    for (const id of ['shot-1', 'shot-2']) expect((await answering({ ...shot, id }).getShot(id)).workflow).toEqual({});
    await answering(shot).updateShot('shot-1', { annotations: { enjoyment: 8 } });
    await answering([{ id: 'batch-1', beanId: 'bean-1' }]).listBatches('bean-1');
    expect(drift()).toEqual([
      { source: 'GET /api/v1/shots/{id}', problem: 'workflow: missing' },
      { source: 'PUT /api/v1/shots/{id}', problem: 'workflow: missing' },
      { source: 'GET /api/v1/beans/{id}/batches', problem: '[].frozen: missing' },
      { source: 'GET /api/v1/beans/{id}/batches', problem: '[].archived: missing' },
    ]);
  });

  it('a list keeps what it can use, and an empty reply is still an empty list', async () => {
    const bean = { id: 'bean-1', roaster: 'Square Mile', name: 'Guji', archived: false };
    expect(await answering([bean, { name: 'no id' }]).listBeans()).toEqual([bean]);
    expect(await answering(null).listBeans()).toEqual([]);
    expect(await answering([{ id: 'p', loaded: true }, { loaded: true }]).listPlugins()).toEqual([{ id: 'p', loaded: true }]);
    await expect(answering({ plugins: [] }).listPlugins()).rejects.toMatchObject({ code: 'unexpected_reply' });
  });

  it('reads the machine state like a snapshot frame: a missing reading is null, never 0 (5.8)', async () => {
    const { groupTemperature: _group, ...state } = fixtures.machineState();
    expect((await answering(state).getMachineState()).groupTemperature).toBeNull();
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'groupTemperature: missing' }]);
    await expect(answering({ state: 'idle' }).getMachineState()).rejects.toMatchObject({ code: 'unexpected_reply' });
  });

  it('reads every other reply it used to cast', async () => {
    expect((await answering({ ...fixtures.machineInfo(), GHC: undefined }).getMachineInfo()).GHC).toBe(false);
    expect(await answering({ gatewayMode: 7 }).getSettings()).toEqual({});
    expect((await answering({ ...fixtures.buildInfo(), fullVersion: null }).getInfo()).fullVersion).toBe('');
    await expect(answering({ ...fixtures.profileRecord(), id: undefined }).createProfile(fixtures.profileCreateRequest())).rejects.toMatchObject({
      code: 'unexpected_reply',
    });
    await expect(answering({ id: 'batch-1' }).createBatch('bean-1', {})).rejects.toMatchObject({ code: 'unexpected_reply' });
    await expect(answering({ name: 'Guji' }).createBean({ roaster: 'Square Mile', name: 'Guji' })).rejects.toMatchObject({
      code: 'unexpected_reply',
    });
    expect(await answering(null).getLatestShot()).toBeNull();
    await expect(answering({ ...fixtures.shotRecord(), id: 5 }).getLatestShot()).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect((await answering({ ...fixtures.shotsList(), total: '2' }).listShots()).total).toBe(0);
    expect(await answering([{ ...fixtures.profileRecord(), id: null }]).listProfiles()).toEqual([]);
    expect(drift().map((entry) => entry.source)).toEqual([
      'GET /api/v1/machine/info',
      'GET /api/v1/settings',
      'GET /api/v1/info',
      'POST /api/v1/profiles',
      'POST /api/v1/beans/{id}/batches',
      'POST /api/v1/beans',
      'GET /api/v1/shots/latest',
      'GET /api/v1/shots',
      'GET /api/v1/profiles',
    ]);
  });
});

describe('the workflow PUT deadline (5.13)', () => {
  afterEach(() => vi.useRealTimers());

  it('waits 35 s for Decaid, which can take about 30 s to answer', async () => {
    vi.useFakeTimers();
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as unknown as typeof fetch,
    });
    let settled: unknown = null;
    const pending = client.updateWorkflow({ context: { targetYield: 36 } }).catch((e: unknown) => (settled = e));
    await vi.advanceTimersByTimeAsync(34_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toMatchObject({ code: 'timeout', path: '/api/v1/workflow' });
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

  it('a 400 about anything but enjoyment cannot tell the scale', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(() => new Response(JSON.stringify({ error: 'ID in path does not match ID in body' }), { status: 400 })),
    });
    expect(await client.probeEnjoymentScale()).toBeNull();
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
    // The mock starts in Tracking, like a fresh Decaid (plan D1).
    expect(await client.getSettings()).toMatchObject({ gatewayMode: 'tracking', blockOnNoScale: false });
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

  it('nothing the mock sends needs a reader to repair it', async () => {
    await client.getInfo();
    await client.getSettings();
    await client.getMachineInfo();
    await client.getMachineState();
    await client.getWorkflow();
    await client.listProfiles({ includeHidden: true });
    await client.listShots({ limit: 5 });
    const latest = await client.getLatestShot();
    await client.getShot(latest!.id);
    await client.listPlugins();
    for (const bean of await client.listBeans()) await client.listBatches(bean.id);
    expect(drift()).toEqual([]);
  });

  it('percent-encodes ids so an odd id stays one path segment', async () => {
    const error = await client.getShot('a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 404, message: 'Shot not found' });
    expect(mock.state.requests.at(-1)!.path).toBe('/api/v1/shots/a%2Fb');
  });
});

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

  it("the sleep and wake settings: a schedule CafAI cannot read is left out, and a schedule's own reply is named by its route's template", async () => {
    const schedule = { id: 'wake-1', time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true };
    const settings = { userPresenceEnabled: true, sleepTimeoutMinutes: 30, keepAwakeUntil: null, schedules: [schedule, { ...schedule, id: 'wake-2', time: 630 }] };
    expect((await answering(settings).getPresenceSettings()).schedules).toEqual([schedule]);
    await expect(answering({ ...schedule, time: undefined }).updateWakeSchedule('wake-1', { enabled: false })).rejects.toMatchObject({ code: 'unexpected_reply' });
    await expect(answering({ userPresenceEnabled: true }).updatePresenceSettings({ userPresenceEnabled: true })).rejects.toMatchObject({
      code: 'unexpected_reply',
    });
    expect(drift()).toEqual([
      { source: 'GET /api/v1/presence/settings', problem: 'schedules[].time: expected string, got number' },
      { source: 'PUT /api/v1/presence/schedules/{id}', problem: 'time: missing' },
      { source: 'POST /api/v1/presence/settings', problem: 'sleepTimeoutMinutes: missing' },
    ]);
  });

  it('a list keeps what it can use, and an empty list is an empty list', async () => {
    const bean = { id: 'bean-1', roaster: 'Square Mile', name: 'Guji', archived: false };
    expect(await answering([bean, { name: 'no id' }]).listBeans()).toEqual([bean]);
    expect(await answering([]).listBeans()).toEqual([]);
    expect(await answering([{ id: 'p', loaded: true }, { loaded: true }]).listPlugins()).toEqual([{ id: 'p', loaded: true }]);
    await expect(answering({ plugins: [] }).listPlugins()).rejects.toMatchObject({ code: 'unexpected_reply' });
  });

  it('a list route that answers null fails the call and says so: never "Decaid has none", which could lead to a write', async () => {
    const lists = [
      (client: ReturnType<typeof answering>) => client.listBeans(),
      (client: ReturnType<typeof answering>) => client.listBatches('bean-1'),
      (client: ReturnType<typeof answering>) => client.listAllBatches(),
      (client: ReturnType<typeof answering>) => client.listProfiles(),
      (client: ReturnType<typeof answering>) => client.listPlugins(),
      (client: ReturnType<typeof answering>) => client.getDevices(),
      (client: ReturnType<typeof answering>) => client.scanDevices(),
    ];
    for (const list of lists) await expect(list(answering(null))).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(drift()).toEqual(
      [
        'GET /api/v1/beans',
        'GET /api/v1/beans/{id}/batches',
        'GET /api/v1/bean-batches',
        'GET /api/v1/profiles',
        'GET /api/v1/plugins',
        'GET /api/v1/devices',
        'GET /api/v1/devices/scan',
      ].map((source) => ({ source, problem: 'reply: expected array, got null' })),
    );
  });

  it('reads the steam records the care reminders count (D-CARE-3): ids kept when they are ids, the newest by its id', async () => {
    expect(await answering(['a', 'b']).listSteamIds()).toEqual(['a', 'b']);
    expect(await answering(['a', 7, '']).listSteamIds()).toEqual(['a']);
    await expect(answering(null).listSteamIds()).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(await answering(null).getLatestSteam()).toBeNull();
    expect(await answering({ id: 'steam-1', timestamp: '2026-10-03T08:15:02.725000', workflow: {} }).getLatestSteam()).toMatchObject({
      id: 'steam-1',
      timestamp: '2026-10-03T08:15:02.725000',
    });
    // A time CafAI cannot read is unknown, never a made-up one.
    expect((await answering({ id: 'steam-1', timestamp: 3 }).getLatestSteam())?.timestamp).toBe('');
    await expect(answering({ timestamp: '2026-10-03T08:15:02.725000' }).getLatestSteam()).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(drift()).toEqual([
      { source: 'GET /api/v1/steams/ids', problem: '[]: expected string, got number' },
      { source: 'GET /api/v1/steams/ids', problem: '[]: empty' },
      { source: 'GET /api/v1/steams/ids', problem: 'reply: expected array, got null' },
      { source: 'GET /api/v1/steams/latest', problem: 'timestamp: expected string, got number' },
      { source: 'GET /api/v1/steams/latest', problem: 'id: missing' },
    ]);
  });

  it('reads the machine state like a snapshot frame: a missing reading is null, never 0 (5.8)', async () => {
    const { groupTemperature: _group, ...state } = fixtures.machineState();
    expect((await answering(state).getMachineState()).groupTemperature).toBeNull();
    expect(drift()).toEqual([{ source: 'GET /api/v1/machine/state', problem: 'groupTemperature: missing' }]);
    await expect(answering({ state: 'idle' }).getMachineState()).rejects.toMatchObject({ code: 'unexpected_reply' });
  });

  it('reads every other reply it used to cast', async () => {
    expect((await answering({ ...fixtures.machineInfo(), GHC: undefined }).getMachineInfo()).GHC).toBe(false);
    expect(await answering({ gatewayMode: 7, preferredMachineId: null, preferredScaleId: null }).getSettings()).toEqual({
      preferredMachineId: null,
      preferredScaleId: null,
    });
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

  it('a null plugins body fails the call: it is not "no plugins", and the directory keeps its last answer', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(() => new Response('null', { status: 200 })),
    });
    await expect(client.listPlugins()).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(drift()).toEqual([{ source: 'GET /api/v1/plugins', problem: 'reply: expected array, got null' }]);
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

  it('a 400 about anything but enjoyment cannot tell the scale: reported, and never guessed from (D95)', async () => {
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch(() => new Response(JSON.stringify({ error: 'ID in path does not match ID in body' }), { status: 400 })),
    });
    await expect(client.probeEnjoymentScale()).rejects.toMatchObject({ name: 'GatewayError', code: 'unexpected_reply' });
    expect(drift()).toEqual([{ source: 'PUT /api/v1/shots/{id}', problem: 'enjoyment probe: unexpected 400' }]);
  });

  it('a 404 (the probe id does not exist) means the 0-100 scale', async () => {
    const client = createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(() => new Response(null, { status: 404 })) });
    expect(await client.probeEnjoymentScale()).toBe(100);
  });

  it('a 2xx for the made-up id cannot tell the scale: reported once however often it is asked (D95)', async () => {
    const client = createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(() => new Response(null, { status: 200 })) });
    await expect(client.probeEnjoymentScale()).rejects.toMatchObject({ name: 'GatewayError', code: 'unexpected_reply' });
    await expect(client.probeEnjoymentScale()).rejects.toMatchObject({ code: 'unexpected_reply' });
    expect(drift()).toEqual([{ source: 'PUT /api/v1/shots/{id}', problem: 'enjoyment probe: unexpected 200' }]);
    expect(driftLog.list()[0]!.count).toBe(2);
  });

  it('no answer, or a busy Decaid, can be asked again later: null, nothing reported', async () => {
    for (const answer of [() => Promise.reject(new TypeError('Failed to fetch')), () => new Response(null, { status: 503 }), () => new Response(null, { status: 429 })]) {
      const client = createDecaidClient({ origin: 'http://localhost:8080', fetch: stubFetch(answer) });
      expect(await client.probeEnjoymentScale()).toBeNull();
    }
    expect(drift()).toEqual([]);
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

  it('lists every batch in one request, the archived ones only when asked', async () => {
    const seen: string[] = [];
    const client = createDecaidClient({
      origin: 'http://localhost:8080',
      fetch: stubFetch((url) => {
        seen.push(url);
        return new Response(JSON.stringify([{ id: 'batch-1', beanId: 'bean-1', frozen: false, archived: false }]), { status: 200 });
      }),
    });
    expect(await client.listAllBatches()).toEqual([{ id: 'batch-1', beanId: 'bean-1', frozen: false, archived: false }]);
    await client.listAllBatches({ includeArchived: true });
    expect(seen).toEqual(['http://localhost:8080/api/v1/bean-batches', 'http://localhost:8080/api/v1/bean-batches?includeArchived=true']);
  });
});

// ---- connecting one device without disturbing the others ---------------------------------

interface DeviceCall {
  method: string;
  url: string;
  body?: string;
}

interface DecaidAnswers {
  /** The scan's reply (default: `found`). */
  scan?: () => Response;
  /** GET /api/v1/settings (default: no preferred devices). */
  settings?: () => Response;
  /** PUT /api/v1/devices/connect (default: connected). */
  connect?: () => Response;
  /** GET /api/v1/devices: the list after (default: `found`). */
  devices?: unknown[];
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A client on a stub Decaid whose scan finds `found`, and every call it made. */
function deviceClient(found: unknown[], answers: DecaidAnswers = {}) {
  const calls: DeviceCall[] = [];
  const client = createDecaidClient({
    origin: 'http://localhost:8080',
    fetch: stubFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      const path = new URL(url).pathname;
      if (path === '/api/v1/settings') return answers.settings?.() ?? reply({ gatewayMode: 'tracking', preferredMachineId: null, preferredScaleId: null });
      if (path === '/api/v1/devices/connect') return answers.connect?.() ?? reply({ outcome: 'connected', state: 'connected' });
      if (path === '/api/v1/devices') return reply(answers.devices ?? found);
      return answers.scan?.() ?? reply(found);
    }),
  });
  const scans = () => calls.filter((call) => call.url.includes('/devices/scan'));
  const connects = () => calls.filter((call) => call.url.endsWith('/devices/connect'));
  return { client, calls, scans, connects };
}

const de1 = { name: 'DE1', id: 'm-1', state: 'discovered', type: 'machine', available: true };
const otherDe1 = { name: 'DE1 by the window', id: 'm-2', state: 'discovered', type: 'machine', available: true };
const scale = { name: 'Decent Scale', id: 's-1', state: 'connected', type: 'scale', available: true };
const lunar = { name: 'Lunar', id: 's-2', state: 'discovered', type: 'scale', available: true };

describe('scanDevices', () => {
  it('only ever discovers: Decaid connects whatever a scan finds unless told connect=false', async () => {
    const { client, scans } = deviceClient([de1]);
    expect(await client.scanDevices()).toEqual([de1]);
    await client.scanDevices({ quick: true });
    expect(scans().map((call) => call.url)).toEqual([
      'http://localhost:8080/api/v1/devices/scan?connect=false',
      'http://localhost:8080/api/v1/devices/scan?connect=false&quick=true',
    ]);
  });
});

describe('connectKind', () => {
  it('scans once, connecting nothing, and waits for the whole scan: a quick one answers [] at once', async () => {
    const { client, scans } = deviceClient([de1, scale]);
    await client.connectKind('machine');
    expect(scans().map((call) => call.url)).toEqual(['http://localhost:8080/api/v1/devices/scan?connect=false']);
  });

  it('connects the one device that was asked for, by id, and answers the device list after', async () => {
    const after = [{ ...de1, state: 'connected' }, scale];
    const { client, connects } = deviceClient([de1, scale], { devices: after });
    expect(await client.connectKind('machine')).toEqual(after);
    expect(connects()).toEqual([{ method: 'PUT', url: 'http://localhost:8080/api/v1/devices/connect', body: '{"deviceId":"m-1"}' }]);
  });

  const preferring = (settings: Record<string, unknown>) => ({
    settings: () => reply({ gatewayMode: 'tracking', preferredMachineId: null, preferredScaleId: null, ...settings }),
  });

  it("connects the device Decaid's settings prefer, when the scan found it", async () => {
    const machine = deviceClient([de1, otherDe1], preferring({ preferredMachineId: 'm-2' }));
    await machine.client.connectKind('machine');
    expect(machine.connects().map((call) => call.body)).toEqual(['{"deviceId":"m-2"}']);

    const scales = deviceClient([de1, { ...scale, state: 'discovered' }, lunar], preferring({ preferredScaleId: 's-2' }));
    await scales.client.connectKind('scale');
    expect(scales.connects().map((call) => call.body)).toEqual(['{"deviceId":"s-2"}']);
  });

  it("never connects another when Decaid's preferred device is away: Decaid would make it its preferred one (D98)", async () => {
    const away = deviceClient([de1, { ...scale, state: 'discovered' }, { ...lunar, available: false }], preferring({ preferredScaleId: 's-2' }));
    await expect(away.client.connectKind('scale')).rejects.toMatchObject({
      code: 'device_choice',
      message: "The scale Decaid uses is not in range. Switch it on, or choose another on Decaid's scan screen.",
    });
    expect(away.connects()).toHaveLength(0);
    const machine = deviceClient([de1, otherDe1], preferring({ preferredMachineId: 'm-9' }));
    await expect(machine.client.connectKind('machine')).rejects.toMatchObject({
      code: 'device_choice',
      message: expect.stringMatching(/^The machine Decaid uses is not in range/),
    });
    expect(machine.connects()).toHaveLength(0);
  });

  it('with none preferred, connects the only one there, and leaves a choice between several to Decaid', async () => {
    const one = deviceClient([de1, scale]);
    await one.client.connectKind('machine');
    expect(one.connects().map((call) => call.body)).toEqual(['{"deviceId":"m-1"}']);
    const several = deviceClient([de1, otherDe1]);
    await expect(several.client.connectKind('machine')).rejects.toMatchObject({
      code: 'device_choice',
      message: "Decaid sees more than one machine. Choose yours on Decaid's scan screen.",
    });
    expect(several.connects()).toHaveLength(0);
  });

  it('connects nothing when Decaid did not say which device it prefers', async () => {
    const unread = deviceClient([de1], { settings: () => reply({ error: 'boom' }, 500) });
    await expect(unread.client.connectKind('machine')).rejects.toMatchObject({
      code: 'device_choice',
      message: "Decaid did not say which machine it uses. Choose yours on Decaid's scan screen.",
    });
    const renamed = deviceClient([de1], { settings: () => reply({ gatewayMode: 'tracking', preferredMachineDeviceId: 'm-1' }) });
    await expect(renamed.client.connectKind('machine')).rejects.toMatchObject({ code: 'device_choice' });
    expect([...unread.connects(), ...renamed.connects()]).toHaveLength(0);
  });

  it('preferredOnly (the revive no one tapped) connects the preferred device or nothing, and never says why', async () => {
    const found = deviceClient([de1, { ...scale, state: 'discovered' }, lunar], preferring({ preferredScaleId: 's-1' }));
    await found.client.connectKind('scale', { preferredOnly: true });
    expect(found.connects().map((call) => call.body)).toEqual(['{"deviceId":"s-1"}']);
    for (const settings of [{ preferredScaleId: 's-9' }, { preferredScaleId: null }]) {
      const away = deviceClient([de1, lunar], preferring(settings));
      await expect(away.client.connectKind('scale', { preferredOnly: true })).resolves.toEqual([de1, lunar]);
      expect(away.connects()).toHaveLength(0);
    }
  });

  it('an auxiliary (dosing) scale is never the brewing scale: neither connected nor taken for it', async () => {
    const dosing = { ...lunar, state: 'connected', connectionRole: 'auxiliary' };
    const brewingOff = { ...scale, state: 'disconnected', available: false };
    const off = deviceClient([de1, dosing, brewingOff], preferring({ preferredScaleId: 's-1' }));
    await off.client.connectKind('scale');
    expect(off.connects(), 'the dosing scale is not the connected brewing scale').toHaveLength(0);
    const on = deviceClient([de1, dosing, { ...brewingOff, state: 'discovered', available: true }], preferring({ preferredScaleId: 's-1' }));
    await on.client.connectKind('scale');
    expect(on.connects().map((call) => call.body)).toEqual(['{"deviceId":"s-1"}']);
  });

  it('leaves a device of that kind that is connected by now as it is', async () => {
    const { client, connects } = deviceClient([de1, scale, lunar]);
    await client.connectKind('scale');
    expect(connects()).toHaveLength(0);
  });

  it("waits for a connect longer than Decaid's own 60 s on Linux, so Decaid's answer comes first", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const client = createDecaidClient({
        origin: 'http://localhost:8080',
        fetch: ((_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            });
          })) as unknown as typeof fetch,
      });
      const connect = client.connectDevice('m-1').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(65_000);
      expect(aborted, 'still waiting after 65 s').toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await connect).toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never connects to a device Decaid remembers but cannot see, nor one it is connecting already', async () => {
    const asleep = deviceClient([{ ...de1, available: false }]);
    await asleep.client.connectKind('machine');
    expect(asleep.connects(), 'connecting to hardware that is not advertising just errors').toHaveLength(0);
    const busy = deviceClient([{ ...de1, state: 'connecting' }]);
    await busy.client.connectKind('machine');
    expect(busy.connects()).toHaveLength(0);
  });

  it("picks from Decaid's device list when the scan itself fails", async () => {
    const { client, connects, calls } = deviceClient([], { scan: () => reply({ error: 'Scan failed' }, 500), devices: [de1] });
    await client.connectKind('machine');
    expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith('/api/v1/devices')).length).toBeGreaterThan(0);
    expect(connects().map((call) => call.body)).toEqual(['{"deviceId":"m-1"}']);
  });

  it('answers the list after a connect Decaid refused, for the caller to say why, and never connects twice', async () => {
    const refused = reply({ deviceId: 'm-1', operation: 'connect', outcome: 'failed', state: 'disconnected', connectionError: null }, 503);
    const { client, connects } = deviceClient([de1, scale], { connect: () => refused });
    expect(await client.connectKind('machine')).toEqual([de1, scale]);
    expect(connects()).toHaveLength(1);
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

  it('connects the one device asked for, and leaves the other where it was', async () => {
    mock.state.setMachineConnected(false);
    mock.state.setScaleConnected(false);
    try {
      const after = await client.connectKind('machine');
      expect(after.find((device) => device.type === 'machine')?.state).toBe('connected');
      // The mock's scan connects everything it finds unless told not to, as Decaid's does.
      expect(mock.state.isScaleConnected(), 'the scale was not asked for').toBe(false);
    } finally {
      mock.state.setMachineConnected(true);
      mock.state.setScaleConnected(true);
    }
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

  it('counts shots in one request, and reads the steam records, null before the first (D-CARE-3)', async () => {
    const page = await client.listShots({ limit: 1 });
    expect(page).toMatchObject({ total: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(await client.listSteamIds()).toEqual([]);
    expect(await client.getLatestSteam()).toBeNull();
    const workflow = mock.state.getWorkflow();
    mock.state.addSteam({ id: 'steam-1', timestamp: '2026-10-03T08:15:02.725000', measurements: [], workflow });
    expect(await client.listSteamIds()).toEqual(['steam-1']);
    expect(await client.getLatestSteam()).toMatchObject({ id: 'steam-1', timestamp: '2026-10-03T08:15:02.725000' });
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

  it("reads and changes Decaid's sleep and wake settings: the minutes clamped, the two answered as saved", async () => {
    expect(await client.getPresenceSettings()).toEqual({ userPresenceEnabled: true, sleepTimeoutMinutes: 30, keepAwakeUntil: null, schedules: [] });
    expect(mock.state.requests.at(-1)).toMatchObject({ method: 'GET', path: '/api/v1/presence/settings' });
    expect(await client.updatePresenceSettings({ sleepTimeoutMinutes: 999 })).toEqual({ userPresenceEnabled: true, sleepTimeoutMinutes: 240 });
    expect(mock.state.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/presence/settings', body: { sleepTimeoutMinutes: 999 } });
    expect(await client.updatePresenceSettings({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 })).toEqual({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 });
    const refused = await client.updatePresenceSettings({ sleepTimeoutMinutes: 2.5 }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 400, message: 'sleepTimeoutMinutes must be an integer' });
    await client.updatePresenceSettings({ sleepTimeoutMinutes: 30 });
  });

  it('adds, changes and deletes a wake schedule: its path and body, and the schedule as Decaid stored it', async () => {
    const added = await client.addWakeSchedule({ time: '06:30', daysOfWeek: [5, 1], enabled: true, keepAwakeFor: 45 });
    expect(added).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), time: '06:30', daysOfWeek: [1, 5], enabled: true, keepAwakeFor: 45 });
    expect(mock.state.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/v1/presence/schedules',
      body: { time: '06:30', daysOfWeek: [5, 1], enabled: true, keepAwakeFor: 45 },
    });

    const changed = await client.updateWakeSchedule(added.id, { enabled: false, keepAwakeFor: null });
    expect(changed).toEqual({ id: added.id, time: '06:30', daysOfWeek: [1, 5], enabled: false });
    expect(mock.state.requests.at(-1)).toMatchObject({
      method: 'PUT',
      path: `/api/v1/presence/schedules/${added.id}`,
      body: { enabled: false, keepAwakeFor: null },
    });
    expect((await client.getPresenceSettings()).schedules).toEqual([changed]);

    await expect(client.deleteWakeSchedule(added.id)).resolves.toBeUndefined();
    expect(mock.state.requests.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/v1/presence/schedules/${added.id}` });
    expect((await client.getPresenceSettings()).schedules).toEqual([]);
  });

  it('a wake schedule deleted elsewhere, or already gone, is a 404 GatewayError', async () => {
    for (const call of [() => client.updateWakeSchedule('gone', { enabled: false }), () => client.deleteWakeSchedule('gone')]) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GatewayError);
      expect(error).toMatchObject({ status: 404, code: 'http', message: 'Schedule not found' });
    }
    const refused = await client.addWakeSchedule({ time: '25:00', daysOfWeek: [], enabled: true }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 400, message: 'time must be hour 0-23 and minute 0-59' });
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
    await client.getPresenceSettings();
    for (const bean of await client.listBeans()) await client.listBatches(bean.id);
    expect((await client.listAllBatches({ includeArchived: true })).length).toBeGreaterThan(0);
    expect(drift()).toEqual([]);
  });

  it('percent-encodes ids so an odd id stays one path segment', async () => {
    const error = await client.getShot('a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 404, message: 'Shot not found' });
    expect(mock.state.requests.at(-1)!.path).toBe('/api/v1/shots/a%2Fb');
  });
});

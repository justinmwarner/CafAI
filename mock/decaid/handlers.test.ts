import { getResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '../node.ts';
import { decaidFallbackHandlers, decaidHttpHandlers } from './handlers.ts';
import { createShotPlayer } from './shotPlayer.ts';
import { createMockDecaid } from './state.ts';

const mock = createMockServer();
const BASE = 'http://tablet.local:8080/api/v1';

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mock.server.resetHandlers());
afterAll(() => mock.close());

async function call(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text
  }
  return { status: response.status, headers: response.headers, text, body };
}

describe('URL patterns', () => {
  it('match any host on port 8080', async () => {
    expect((await fetch('http://127.0.0.1:8080/api/v1/info')).status).toBe(200);
    expect((await fetch('http://localhost:8080/api/v1/info')).status).toBe(200);
  });

  it('answer unknown Decaid routes with shelf plain text', async () => {
    const reply = await call('/no/such/route');
    expect(reply).toMatchObject({ status: 404, text: 'Route not found' });
  });
});

describe('machine routes', () => {
  it('state changes answer 200 with a literal null body', async () => {
    const reply = await call('/machine/state/sleeping', { method: 'PUT' });
    expect(reply).toMatchObject({ status: 200, text: 'null' });
    expect(mock.state.machineCommands).toContain('sleeping');
    await call('/machine/state/idle', { method: 'PUT' });
  });

  it('an unknown state name is a 500 with {error, st}', async () => {
    const reply = await call('/machine/state/sleep', { method: 'PUT' });
    expect(reply.status).toBe(500);
    expect(reply.body).toMatchObject({ error: 'Invalid argument (name): No enum value with that name: "sleep"' });
    expect((reply.body as { st: string }).st).toBeTruthy();
  });

  it('blocks espresso without a scale when Decaid is set to', async () => {
    mock.state.setSettings({ blockOnNoScale: true });
    mock.state.setScaleConnected(false);
    try {
      const reply = await call('/machine/state/espresso', { method: 'PUT' });
      expect(reply).toMatchObject({ status: 400, body: { details: 'No scale detected, blocking espresso request', type: 'block_no_scale' } });
      expect(mock.player.activity).toBeNull();
    } finally {
      mock.state.setSettings({ blockOnNoScale: false });
      mock.state.setScaleConnected(true);
    }
  });

  it('every /machine route is a 500 without a machine, but heartbeat answers -1', async () => {
    mock.state.setMachineConnected(false);
    try {
      for (const [path, method] of [
        ['/machine/state', 'GET'],
        ['/machine/info', 'GET'],
        ['/machine/capabilities', 'GET'],
        ['/machine/state/idle', 'PUT'],
      ] as const) {
        const reply = await call(path, { method });
        expect(reply.status, path).toBe(500);
        expect(reply.body, path).toEqual({ error: 'DeviceNotConnectedException: machine not connected' });
      }
      expect((await call('/machine/heartbeat', { method: 'POST' })).body).toEqual({ timeout: -1 });
    } finally {
      mock.state.setMachineConnected(true);
    }
  });

  it('tare is 200 null, a 500 without a scale, and 400 while a shot runs when blocked', async () => {
    expect(await call('/scale/tare', { method: 'PUT' })).toMatchObject({ status: 200, text: 'null' });
    mock.state.setScaleConnected(false);
    expect(await call('/scale/tare', { method: 'PUT' })).toMatchObject({
      status: 500,
      body: { error: 'DeviceNotConnectedException: scale not connected' },
    });
    mock.state.setScaleConnected(true);
    mock.state.setSettings({ blockTareDuringShot: true });
    mock.state.publishShotState({ ...mock.state.getShotState(), state: 'pouring', shotId: 'x' });
    try {
      expect(await call('/scale/tare', { method: 'PUT' })).toMatchObject({ status: 400, body: { type: 'block_tare_during_shot' } });
    } finally {
      mock.state.publishShotState({ ...mock.state.getShotState(), state: 'idle', shotId: null });
      mock.state.setSettings({ blockTareDuringShot: false });
    }
  });
});

describe('conditional GETs', () => {
  it('profiles and shots carry a strong ETag and honour If-None-Match', async () => {
    for (const path of ['/profiles', '/shots?limit=20&offset=0']) {
      const first = await call(path);
      const etag = first.headers.get('ETag');
      expect(etag, path).toMatch(/^"[0-9a-f]{16}"$/);
      const again = await fetch(`${BASE}${path}`, { headers: { 'If-None-Match': etag! } });
      expect(again.status, path).toBe(304);
      expect((await fetch(`${BASE}${path}`, { headers: { 'If-None-Match': '*' } })).status).toBe(304);
    }
  });
});

describe('key-value store over HTTP', () => {
  it('keeps keys raw, answers misses with null and writes with {}', async () => {
    expect(await call('/store/cafai/missing')).toMatchObject({ status: 200, text: 'null' });
    expect(await call('/store/cafai/a%2Fb', { method: 'POST', body: '{"x":1}' })).toMatchObject({ status: 200, body: {} });
    expect(mock.state.kvKeys('cafai')).toContain('a%2Fb');
    expect((await call('/store/cafai')).body).toContain('a%2Fb');
    expect((await call('/store/cafai/a%2Fb')).body).toEqual({ x: 1 });
    expect(await call('/store/cafai/a%2Fb', { method: 'DELETE' })).toMatchObject({ status: 200, body: {} });
  });

  it('a non-JSON body is a plain-text 500', async () => {
    expect(await call('/store/cafai/k', { method: 'POST', body: 'not json' })).toMatchObject({
      status: 500,
      text: 'Internal Server Error',
    });
  });

  it('?full=1 returns the whole namespace with an ETag', async () => {
    await call('/store/cafai-full/one', { method: 'POST', body: '1' });
    const reply = await call('/store/cafai-full?full=1');
    expect(reply.body).toEqual({ one: 1 });
    const etag = reply.headers.get('ETag')!;
    expect((await fetch(`${BASE}/store/cafai-full?full=1`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
  });
});

describe('grinder library over HTTP', () => {
  const ids = (body: unknown) => (body as Array<{ id: string }>).map((grinder) => grinder.id);

  it('lists the seeded grinders with a strong ETag and honours If-None-Match', async () => {
    const first = await call('/grinders');
    expect(first.status).toBe(200);
    expect((first.body as Array<{ model: string }>).map((grinder) => grinder.model)).toEqual(['Niche Zero', 'Comandante C40 MK4', 'Baratza Encore ESP']);
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect((await fetch(`${BASE}/grinders`, { headers: { 'If-None-Match': etag! } })).status).toBe(304);
  });

  it('creates with 201, reads by id, archives with a PUT, and deletes for good', async () => {
    const created = await call('/grinders', { method: 'POST', body: JSON.stringify({ model: 'Lagom P64', settingSmallStep: 0.25 }) });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(await call(`/grinders/${id}`)).toMatchObject({ status: 200, body: created.body });
    expect(await call(`/grinders/${id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) })).toMatchObject({
      status: 200,
      body: { id, archived: true, settingSmallStep: 0.25 },
    });
    expect(ids((await call('/grinders')).body)).not.toContain(id);
    expect(ids((await call('/grinders?includeArchived=true')).body)).toContain(id);
    expect(await call(`/grinders/${id}`, { method: 'DELETE' })).toMatchObject({ status: 200, body: { success: true, id } });
    expect(await call(`/grinders/${id}`)).toMatchObject({ status: 404, body: { error: 'Grinder not found' } });
  });

  it('answers 400 to a missing model or unreadable JSON, 404 to an unknown id before reading the body, 200 to any delete', async () => {
    expect(await call('/grinders', { method: 'POST', body: '{}' })).toMatchObject({
      status: 400,
      body: { error: "type 'Null' is not a subtype of type 'String' in type cast" },
    });
    for (const body of ['not json', undefined]) {
      const reply = await call('/grinders', { method: 'POST', body });
      expect(reply.status, String(body)).toBe(400);
      expect((reply.body as { error: string }).error).toMatch(/^FormatException: /);
    }
    expect(await call('/grinders/unknown', { method: 'PUT', body: 'not json' })).toMatchObject({ status: 404, body: { error: 'Grinder not found' } });
    expect(await call('/grinders/unknown', { method: 'DELETE' })).toMatchObject({ status: 200, body: { success: true, id: 'unknown' } });
  });
});

describe('device routes (devices_handler.dart at aab5f93)', () => {
  /** Both away, as after a sleep that dropped them; put back afterwards. */
  function bothAway() {
    mock.state.setMachineConnected(false);
    mock.state.setScaleConnected(false);
    mock.state.setConnectionError(null);
  }
  function bothBack() {
    mock.state.setMachineConnected(true);
    mock.state.setScaleConnected(true);
    mock.state.setConnectionError(null);
  }
  const states = (body: unknown) => (body as Array<{ type: string; state: string }>).map((device) => `${device.type}:${device.state}`);

  it('a scan connects every slot it can fill unless told connect=false, and answers the list after', async () => {
    bothAway();
    try {
      const reply = await call('/devices/scan');
      expect(reply.status).toBe(200);
      expect(states(reply.body)).toEqual(['machine:connected', 'scale:connected']);
      expect(mock.state.isMachineConnected() && mock.state.isScaleConnected()).toBe(true);
    } finally {
      bothBack();
    }
  });

  it('connect=false only discovers: what it found is ready to connect by id, and nothing connects', async () => {
    bothAway();
    try {
      const reply = await call('/devices/scan?connect=false');
      expect(reply.body).toEqual([
        { name: expect.any(String), id: expect.any(String), state: 'discovered', type: 'machine', available: true },
        { name: expect.any(String), id: expect.any(String), state: 'discovered', type: 'scale', available: true },
      ]);
      expect(mock.state.isMachineConnected() || mock.state.isScaleConnected()).toBe(false);

      // Connecting one by id leaves the other as it was.
      const [machine] = reply.body as Array<{ id: string }>;
      const connected = await call('/devices/connect', { method: 'PUT', body: JSON.stringify({ deviceId: machine!.id }) });
      expect(connected).toMatchObject({ status: 200, body: { deviceId: machine!.id, operation: 'connect', outcome: 'connected', state: 'connected' } });
      expect(mock.state.isMachineConnected()).toBe(true);
      expect(mock.state.isScaleConnected()).toBe(false);
    } finally {
      bothBack();
    }
  });

  it('quick=true answers [] at once; it still connects behind its answer unless told connect=false', async () => {
    bothAway();
    try {
      expect(await call('/devices/scan?connect=false&quick=true')).toMatchObject({ status: 200, body: [] });
      expect(mock.state.isMachineConnected() || mock.state.isScaleConnected()).toBe(false);
      expect(await call('/devices/scan?quick=true')).toMatchObject({ status: 200, body: [] });
      expect(mock.state.isMachineConnected() && mock.state.isScaleConnected()).toBe(true);
    } finally {
      bothBack();
    }
  });

  it('connect is any value but "false", as Decaid reads it', async () => {
    bothAway();
    try {
      await call('/devices/scan?connect=0');
      expect(mock.state.isMachineConnected()).toBe(true);
    } finally {
      bothBack();
    }
  });
});

describe('settings over HTTP (D1)', () => {
  it('GET starts with gatewayMode "tracking"; POST merges known keys and answers 200 null', async () => {
    expect((await call('/settings')).body).toMatchObject({ gatewayMode: 'tracking' });
    const reply = await call('/settings', { method: 'POST', body: JSON.stringify({ gatewayMode: 'full' }) });
    expect(reply).toMatchObject({ status: 200, text: 'null' });
    expect((await call('/settings')).body).toMatchObject({ gatewayMode: 'full' });
    await call('/settings', { method: 'POST', body: JSON.stringify({ gatewayMode: 'tracking' }) });
  });

  it('rejects an unknown gatewayMode with 400 {message}', async () => {
    expect(await call('/settings', { method: 'POST', body: JSON.stringify({ gatewayMode: 'bogus' }) })).toMatchObject({
      status: 400,
      body: { message: 'bogus is not a gateway mode' },
    });
  });

  it('a body that is not JSON is a plain-text 500', async () => {
    expect(await call('/settings', { method: 'POST', body: 'not json' })).toMatchObject({ status: 500, text: 'Internal Server Error' });
  });
});

describe('sleep and wake over HTTP (presence_handler.dart at aab5f93)', () => {
  const post = (path: string, body?: string) => call(path, { method: 'POST', body });

  it("GET /presence/settings answers Decaid's defaults, as a real Decaid 0.8.8 does", async () => {
    expect(await call('/presence/settings')).toMatchObject({
      status: 200,
      text: '{"userPresenceEnabled":true,"sleepTimeoutMinutes":30,"keepAwakeUntil":null,"schedules":[]}',
    });
  });

  it('POST /presence/settings answers the two as saved, and 400 for malformed JSON, no body or a body that is not an object', async () => {
    expect(await post('/presence/settings', JSON.stringify({ sleepTimeoutMinutes: 999 }))).toMatchObject({
      status: 200,
      body: { userPresenceEnabled: true, sleepTimeoutMinutes: 240 },
    });
    for (const body of ['not json', undefined]) {
      expect(await post('/presence/settings', body), String(body)).toMatchObject({ status: 400, body: { error: 'Malformed JSON' } });
    }
    for (const body of ['[1,2]', 'null', '"on"']) {
      expect(await post('/presence/settings', body), body).toMatchObject({ status: 400, body: { error: 'Request body must be a JSON object' } });
    }
    expect(await post('/presence/settings', JSON.stringify({ sleepTimeoutMinutes: 30 }))).toMatchObject({ status: 200 });
  });

  it('a schedule: 201 to add it, in the list, 200 to change it and to delete it, then 404 {error, id}', async () => {
    const added = await post('/presence/schedules', JSON.stringify({ time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: true, keepAwakeFor: 45 }));
    expect(added.status).toBe(201);
    const id = (added.body as { id: string }).id;
    expect(await call('/presence/schedules')).toMatchObject({ status: 200, body: [added.body] });
    expect(await call(`/presence/schedules/${id}`, { method: 'PUT', body: JSON.stringify({ enabled: false, keepAwakeFor: null }) })).toMatchObject({
      status: 200,
      body: { id, time: '06:30', daysOfWeek: [1, 2, 3, 4, 5], enabled: false },
    });
    expect((await call('/presence/settings')).body).toMatchObject({ schedules: [{ id, enabled: false }] });
    expect(await call(`/presence/schedules/${id}`, { method: 'DELETE' })).toMatchObject({ status: 200, body: { deleted: id } });
    const gone = { status: 404, body: { error: 'Schedule not found', id } };
    expect(await call(`/presence/schedules/${id}`, { method: 'PUT', body: '{"enabled":true}' })).toMatchObject(gone);
    expect(await call(`/presence/schedules/${id}`, { method: 'DELETE' })).toMatchObject(gone);
    expect((await call('/presence/schedules')).body).toEqual([]);
  });

  it('a body Decaid cannot read is a 500 on the schedule routes, an unknown id a 404 before the body is read, a value out of range a 400', async () => {
    const unreadable = await post('/presence/schedules', 'not json');
    expect(unreadable.status).toBe(500);
    expect((unreadable.body as { error: string }).error).toMatch(/^FormatException: /);
    expect(await post('/presence/schedules')).toMatchObject({ status: 500, body: { error: 'FormatException: Unexpected end of input (at character 1)' } });
    expect(await post('/presence/schedules', '[]')).toMatchObject({
      status: 500,
      body: { error: "type 'List<dynamic>' is not a subtype of type 'Map<String, dynamic>' in type cast" },
    });
    expect(await post('/presence/schedules', '{"time":"25:00"}')).toMatchObject({ status: 400, body: { error: 'time must be hour 0-23 and minute 0-59' } });
    expect(await call('/presence/schedules/unknown', { method: 'PUT', body: 'not json' })).toMatchObject({
      status: 404,
      body: { error: 'Schedule not found', id: 'unknown' },
    });
    const { id } = mock.state.addWakeSchedule({ time: '06:30' });
    try {
      expect((await call(`/presence/schedules/${id}`, { method: 'PUT', body: 'not json' })).status).toBe(500);
      expect((await call(`/presence/schedules/${id}`, { method: 'PUT', body: '{"daysOfWeek":[0]}' })).status).toBe(400);
    } finally {
      mock.state.deleteWakeSchedule(id);
    }
  });

  it('answers with the id as the path carries it: Decaid never decodes it', async () => {
    expect(await call('/presence/schedules/a%2Fb', { method: 'DELETE' })).toMatchObject({ status: 404, body: { error: 'Schedule not found', id: 'a%2Fb' } });
  });
});

describe('plugins over HTTP (D3, D7)', () => {
  it('lists the four plugins loaded, with manifest fields', async () => {
    const reply = await call('/plugins');
    expect(reply.status).toBe(200);
    const plugins = reply.body as Array<{ id: string; loaded: boolean; version: string }>;
    expect(plugins.map((p) => p.id)).toEqual(['time-to-ready.reaplugin', 'visualizer.reaplugin', 'dye2.reaplugin', 'settings.reaplugin']);
    expect(plugins.every((p) => p.loaded === true)).toBe(true);
  });

  it("GET recent-favs answers DYE2's two seeded setups", async () => {
    const reply = await call('/plugins/dye2.reaplugin/recent-favs');
    expect(reply.status).toBe(200);
    const entries = reply.body as Array<{ auto: boolean }>;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.auto === true)).toBe(true);
  });

  it('404s an unloaded plugin, and an unknown endpoint on a loaded one', async () => {
    expect(await call('/plugins/no-such.reaplugin/recent-favs')).toMatchObject({
      status: 404,
      body: { error: 'plugin with no-such.reaplugin not loaded' },
    });
    expect(await call('/plugins/dye2.reaplugin/no-such-endpoint')).toMatchObject({
      status: 404,
      body: { error: 'endpoint no-such-endpoint not available' },
    });
  });
});

describe('beans library over HTTP (D4)', () => {
  it('lists the two seeded beans, unarchived, with a strong ETag', async () => {
    const reply = await call('/beans');
    expect(reply.status).toBe(200);
    expect(reply.body).toHaveLength(2);
    expect(reply.headers.get('ETag')).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it('creates a bean and a batch, lists both ways, and archives each with a PUT', async () => {
    const created = await call('/beans', { method: 'POST', body: JSON.stringify({ roaster: 'Heart', name: 'Ethiopia' }) });
    expect(created.status).toBe(201);
    const bean = created.body as { id: string };
    expect(await call(`/beans/${bean.id}`)).toMatchObject({ status: 200, body: bean });

    const batch = await call(`/beans/${bean.id}/batches`, { method: 'POST', body: JSON.stringify({ roastLevel: 'light' }) });
    expect(batch.status).toBe(201);
    const batchId = (batch.body as { id: string }).id;
    expect((await call(`/beans/${bean.id}/batches`)).body).toHaveLength(1);
    expect((await call('/bean-batches')).body as Array<{ id: string }>).toEqual(expect.arrayContaining([expect.objectContaining({ id: batchId })]));
    expect(await call(`/bean-batches/${batchId}`)).toMatchObject({ status: 200, body: { id: batchId, beanId: bean.id } });

    expect(await call(`/beans/${bean.id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) })).toMatchObject({
      status: 200,
      body: { archived: true },
    });
    expect((await call('/beans')).body as Array<{ id: string }>).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: bean.id })]));
    expect(await call(`/bean-batches/${batchId}`, { method: 'PUT', body: JSON.stringify({ archived: true }) })).toMatchObject({
      status: 200,
      body: { archived: true },
    });
    // Archived, the batch leaves every batch's list, and is back in it with includeArchived (a bean's earlier batches, 6.5).
    const listed = async (path: string) => ((await call(path)).body as Array<{ id: string }>).map((item) => item.id);
    expect(await listed('/bean-batches')).not.toContain(batchId);
    expect(await listed('/bean-batches?includeArchived=true')).toContain(batchId);
  });

  it('404s an unknown bean or batch id before reading the body, 400 for a missing roaster/name', async () => {
    expect(await call('/beans/no-such-bean')).toMatchObject({ status: 404, body: { error: 'Bean not found' } });
    expect(await call('/bean-batches/no-such-batch')).toMatchObject({ status: 404, body: { error: 'Batch not found' } });
    expect(await call('/beans', { method: 'POST', body: JSON.stringify({ name: 'Only a name' }) })).toMatchObject({ status: 400 });
    expect(await call('/beans/no-such-bean', { method: 'PUT', body: 'not json' })).toMatchObject({ status: 404, body: { error: 'Bean not found' } });
  });
});

describe('skip step over HTTP (D8)', () => {
  it('answers 200 null whether or not a shot is running', async () => {
    expect(mock.player.activity).toBeNull();
    expect(await call('/machine/state/skipStep', { method: 'PUT' })).toMatchObject({ status: 200, text: 'null' });
    expect(mock.player.activity).toBeNull();
  });
});

describe('a slow or hanging workflow PUT (D9)', () => {
  /** Its own state/player/handlers (fake timers), isolated from the shared real server above. */
  function setup(options: Parameters<typeof createMockDecaid>[0] = {}) {
    vi.useFakeTimers();
    const state = createMockDecaid({ seedExamples: false, ...options });
    const player = createShotPlayer(state);
    const handlers = [...decaidHttpHandlers(state, player), ...decaidFallbackHandlers()];
    async function put(body: unknown) {
      const response = await getResponse(handlers, new Request('http://tablet.local:8080/api/v1/workflow', { method: 'PUT', body: JSON.stringify(body) }));
      if (!response) throw new Error('no handler for PUT /workflow');
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    }
    return { state, put };
  }

  /** Tracks whether `promise` has settled yet, without disturbing its own rejection handling. */
  function pendingFlag(promise: Promise<unknown>): () => boolean {
    let settled = false;
    promise.then(
      () => void (settled = true),
      () => void (settled = true),
    );
    return () => settled;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('?mockSlowWorkflow=<ms> applies the change and answers only after the delay', async () => {
    const { state, put } = setup({ slowWorkflowMs: 5000 });
    const promise = put({ context: { targetYield: 39 } });
    const isSettled = pendingFlag(promise);
    await vi.advanceTimersByTimeAsync(4999);
    expect(isSettled(), 'still waiting just before the delay ends').toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isSettled()).toBe(true);
    const reply = await promise;
    expect(reply).toMatchObject({ status: 200, body: { context: { targetYield: 39 } } });
    expect(state.getWorkflow().context?.targetYield).toBe(39);
  });

  it("?mockSlowWorkflow=503 never applies the change, and answers Decaid's own timeout body after 30 s (aab5f93)", async () => {
    const { state, put } = setup({ slowWorkflowTimeout: true });
    const before = state.getWorkflow();
    const promise = put({ context: { targetYield: 39 } });
    const isSettled = pendingFlag(promise);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(isSettled(), 'still waiting just before the 30 s mark').toBe(false);
    expect(state.getWorkflow()).toEqual(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(isSettled()).toBe(true);
    const reply = await promise;
    expect(reply).toEqual({ status: 503, body: { error: 'Workflow request queue timed out' } });
    expect(state.getWorkflow()).toEqual(before);
  });

  it('?mockSlowWorkflow=503 never even reads the body: an otherwise-invalid request just times out too', async () => {
    const { state, put } = setup({ slowWorkflowTimeout: true });
    const before = state.getWorkflow();
    const promise = put({ context: { targetYield: null } }); // a 400 without the switch
    await vi.advanceTimersByTimeAsync(30_000);
    const reply = await promise;
    expect(reply).toEqual({ status: 503, body: { error: 'Workflow request queue timed out' } });
    expect(state.getWorkflow()).toEqual(before);
  });
});

describe('faults and the request log', () => {
  it('serves an injected failure once and logs every request', async () => {
    mock.state.failNext({ method: 'GET', path: '/api/v1/workflow', status: 503, body: { error: 'global_admission_limit' }, headers: { 'Retry-After': '1' } });
    const failed = await call('/workflow');
    expect(failed).toMatchObject({ status: 503, body: { error: 'global_admission_limit' } });
    expect(failed.headers.get('Retry-After')).toBe('1');
    expect((await call('/workflow')).status).toBe(200);
    await call('/workflow', { method: 'PUT', body: JSON.stringify({ context: { targetYield: 38 } }) });
    expect(mock.state.requests.at(-1)).toMatchObject({ method: 'PUT', path: '/api/v1/workflow', body: { context: { targetYield: 38 } } });
  });
});

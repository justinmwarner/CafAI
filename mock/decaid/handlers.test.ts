import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../node.ts';

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

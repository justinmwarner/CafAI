/**
 * The mock against Decaid's pinned spec (spec 4.2).
 *
 * Validates with ajv, through contract/decaid/schema.ts, the fixtures, the
 * replies and frames the mock produces, and the bodies CafAI sends. Known
 * spec errors are skipped by name (contract/decaid/drift.ts). The drift
 * watch runs this file against a newer Decaid's spec with DECAID_SPEC_DIR.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSpecValidator } from '../../contract/decaid/schema.ts';
import { createDecaidClient } from '../../src/api/client.ts';
import { createGrinder, getGrinder, grinderRequest, listGrinders } from '../../src/api/grinders.ts';
import { loadProfileOnMachine } from '../../src/api/machineProfile.ts';
import { activateProfile, createProfileVersion } from '../../src/api/workflow.ts';
import type { WorkflowContext } from '../../src/api/types.ts';
import { EXTRAS_KEY, cafaiNotesLine, mergeNotes } from '../../src/app/engine/shotNotes.ts';
import { KEY_NAME, KEY_NAMESPACE } from '../../src/storage/keyBackup.ts';
import { getTemplate } from '../../src/coach/templates/index.ts';
import { createMockServer } from '../node.ts';
import machineState from '../fixtures/machine-state.json';
import devicesWs from '../fixtures/devices-ws.json';
import workflowGet from '../fixtures/workflow-get.json';

const spec = loadSpecValidator(process.env.DECAID_SPEC_DIR || undefined);

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

describe('the spec validator', () => {
  it('matches literal paths before templates and ignores the query', () => {
    // /api/v1/shots/{id} would want a shot record here.
    expect(spec.response('GET', '/api/v1/shots/ids', 200, ['a', 'b'])).toEqual([]);
    expect(spec.response('GET', '/api/v1/store/cafai?full=1', 200, { meta: { schemaVersion: 1 } })).toEqual([]);
    expect(spec.response('GET', '/api/v1/beans/bean%3A1/batches', 200, [])).toEqual([]);
    expect(spec.response('GET', 'http://localhost:8080/api/v1/machine/state', 200, machineState)).toEqual([]);
  });

  it('names a route, a method or a status the spec does not have', () => {
    expect(spec.response('GET', '/api/v1/nothing', 200, null)).toEqual(['route: GET /api/v1/nothing is not in the spec']);
    expect(spec.request('POST', '/api/v1/machine/state', {})).toEqual(['route: POST /api/v1/machine/state is not in the spec']);
    expect(spec.response('GET', '/api/v1/machine/info', 418, null)).toEqual([
      'status: 418 is not in the spec for GET /api/v1/machine/info (it has 200)',
    ]);
  });

  it('reports problems as "path: message"', () => {
    expect(spec.response('GET', '/api/v1/machine/state', 200, { ...machineState, flow: 'fast' })).toEqual(['flow: must be number']);
    const brewing = spec.response('GET', '/api/v1/machine/state', 200, { ...machineState, state: { state: 'brewing', substate: 'idle' } });
    expect(brewing).toHaveLength(1);
    expect(brewing[0]).toMatch(/^state\.state: "brewing" is not one of booting, busy, idle, /);
    expect(spec.request('POST', '/api/v1/beans', { name: 'Gesha' })).toEqual(['roaster: missing']);
    expect(spec.response('GET', '/api/v1/machine/state', 200, 'idle')).toEqual(['(root): must be object']);
  });

  it('reads nullable fields, allOf with nullable and boolean exclusiveMinimum', () => {
    const errorFrame = {
      ...devicesWs,
      connectionStatus: {
        ...devicesWs.connectionStatus,
        error: { kind: 'scaleConnectFailed', severity: 'warning', timestamp: '2026-10-03T06:15:20.044319Z', message: 'x', details: null },
      },
    };
    expect(spec.frame('ws/v1/devices', devicesWs)).toEqual([]);
    expect(spec.frame('ws/v1/devices', errorFrame)).toEqual([]);
    // An object where the spec allows null or an object reports its own problem, not "must be null".
    const badError = { ...errorFrame, connectionStatus: { ...errorFrame.connectionStatus, error: { severity: 'warning' } } };
    expect(spec.frame('ws/v1/devices', badError)).toEqual([
      'connectionStatus.error.kind: missing',
      'connectionStatus.error.timestamp: missing',
      'connectionStatus.error.message: missing',
    ]);
    // PluginManifest reaches GrinderSettingDescriptor, whose step has a boolean exclusiveMinimum.
    expect(spec.response('GET', '/api/v1/plugins', 200, [{ id: 'time-to-ready.reaplugin', loaded: true }])).toEqual([]);
  });

  it('skips the recorded exceptions and nothing else', () => {
    // Zone-less local timestamps (SPEC DRIFT), but not any string.
    expect(spec.frame('ws/v1/machine/snapshot', machineState)).toEqual([]);
    expect(spec.frame('ws/v1/machine/snapshot', { ...machineState, timestamp: 'yesterday' })).toEqual([
      'timestamp: "yesterday" is not a date-time',
    ]);
    // Step exit and limiter may be null (SPEC DRIFT), but not a string.
    expect(spec.response('GET', '/api/v1/workflow', 200, workflowGet)).toEqual([]);
    const badStep = { ...workflowGet.profile.steps[0], exit: 'over' };
    const badWorkflow = { ...workflowGet, profile: { ...workflowGet.profile, steps: [badStep] } };
    expect(spec.response('GET', '/api/v1/workflow', 200, badWorkflow)).toEqual(['profile.steps[0].exit: must be object']);
    // States Dart has and the WebSocket spec lacks (SPEC DRIFT).
    expect(spec.frame('ws/v1/machine/snapshot', { ...machineState, state: { state: 'schedIdle', substate: 'idle' } })).toEqual([]);
    // KV writes answer 200 {}, not 204 (SPEC DRIFT).
    expect(spec.response('POST', '/api/v1/store/cafai/meta', 200, {})).toEqual([]);
    // No shot yet: 200 null (SPEC DRIFT), on that route only; and no steam yet, on its own.
    expect(spec.response('GET', '/api/v1/shots/latest', 200, null)).toEqual([]);
    expect(spec.response('GET', '/api/v1/steams/latest', 200, null)).toEqual([]);
    expect(spec.response('GET', '/api/v1/machine/state', 200, null)).toEqual(['(root): must be object']);
  });

  it('checks request bodies and frames on templated channels', () => {
    expect(spec.request('PUT', '/api/v1/shots/abc', { annotations: { enjoyment: 8 } })).toEqual([]);
    expect(spec.request('PUT', '/api/v1/shots/abc', { annotations: { enjoyment: 'great' } })).toEqual([
      'annotations.enjoyment: must be number or null',
    ]);
    expect(spec.frame('/ws/v1/plugins/time-to-ready.reaplugin/timeToReady', { status: 'heating', remainingTimeMs: 1000 })).toEqual([]);
    expect(spec.frame('ws/v1/nothing', {})).toEqual(['channel: ws/v1/nothing is not in the spec']);
  });

  it('repeats a problem in a list once, with a count', () => {
    const measurement = { machine: { ...machineState, flow: 'fast' }, scale: null, volume: null };
    const shot = { measurements: [measurement, measurement, measurement] };
    expect(spec.response('GET', '/api/v1/shots/s1', 200, shot)).toEqual(['measurements[0].machine.flow: must be number (3 times)']);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = new URL('../fixtures/', import.meta.url);
const EXAMPLES_DIR = new URL('../../docs/verified/examples/', import.meta.url);

type StandsFor = { reply: [Method, string, number] } | { body: ['POST' | 'PUT', string] } | { frame: string };

/** What each fixture stands for: the reply, the request body or the frame it is a copy of. */
const FIXTURES: Record<string, StandsFor> = {
  'build-info.json': { reply: ['GET', '/api/v1/info', 200] },
  'devices-ws.json': { frame: 'ws/v1/devices' },
  'error-block-no-scale.json': { reply: ['PUT', '/api/v1/machine/state/espresso', 400] },
  'error-machine-not-connected.json': { reply: ['GET', '/api/v1/machine/state', 500] },
  'error.json': { reply: ['POST', '/api/v1/profiles', 400] },
  'heartbeat.json': { reply: ['POST', '/api/v1/machine/heartbeat', 200] },
  'kv-get.json': { reply: ['GET', '/api/v1/store/cafai/state', 200] },
  'machine-info.json': { reply: ['GET', '/api/v1/machine/info', 200] },
  'machine-snapshot-ws.json': { frame: 'ws/v1/machine/snapshot' },
  'machine-state.json': { reply: ['GET', '/api/v1/machine/state', 200] },
  'profile-create-request.json': { body: ['POST', '/api/v1/profiles'] },
  'profile-record.json': { reply: ['POST', '/api/v1/profiles', 201] },
  'profiles-list.json': { reply: ['GET', '/api/v1/profiles', 200] },
  'scale-snapshot-ws.json': { frame: 'ws/v1/scale/snapshot' },
  'scale-status-ws.json': { frame: 'ws/v1/scale/snapshot' },
  'shot-record.json': { reply: ['GET', '/api/v1/shots/3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17', 200] },
  'shot-settings.json': { frame: 'ws/v1/machine/shotSettings' },
  'shot-state-ws.json': { frame: 'ws/v1/machine/shotState' },
  'shot-update-request.json': { body: ['PUT', '/api/v1/shots/3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17'] },
  'shots-list.json': { reply: ['GET', '/api/v1/shots', 200] },
  'water-levels-ws.json': { frame: 'ws/v1/machine/waterLevels' },
  'workflow-get.json': { reply: ['GET', '/api/v1/workflow', 200] },
  'workflow-put-request.json': { body: ['PUT', '/api/v1/workflow'] },
};

const jsonFiles = (dir: URL) => readdirSync(dir).filter((name) => name.endsWith('.json')).sort();

function check(stands: StandsFor, value: unknown): string[] {
  if ('reply' in stands) return spec.response(...stands.reply, value);
  if ('body' in stands) return spec.request(...stands.body, value);
  return spec.frame(stands.frame, value);
}

/** Source files that could use a fixture, without the fixtures' own index and this file. */
function sourceTexts(): string[] {
  const texts: string[] = [];
  for (const dir of ['src', 'mock', 'e2e']) {
    const base = new URL(`../../${dir}/`, import.meta.url);
    for (const entry of readdirSync(base, { recursive: true, encoding: 'utf8' })) {
      const file = entry.split('\\').join('/');
      if (!/\.(ts|tsx)$/.test(file) || file.includes('node_modules/')) continue;
      if (`${dir}/${file}` === 'mock/fixtures/index.ts' || `${dir}/${file}` === 'mock/decaid/contract.test.ts') continue;
      texts.push(readFileSync(new URL(file, base), 'utf8'));
    }
  }
  return texts;
}

describe('the fixtures', () => {
  it('each validates as the reply, body or frame it stands for', () => {
    const files = jsonFiles(FIXTURES_DIR);
    expect(files.filter((file) => !(file in FIXTURES)), 'fixtures missing from the FIXTURES table').toEqual([]);
    const problems = files.flatMap((file) => {
      const stands = FIXTURES[file];
      if (!stands) return [];
      return check(stands, JSON.parse(readFileSync(new URL(file, FIXTURES_DIR), 'utf8'))).map((problem) => `${file}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });

  it('each equals its copy in docs/verified/examples byte for byte', () => {
    const examples = jsonFiles(EXAMPLES_DIR);
    expect(jsonFiles(FIXTURES_DIR).filter((file) => examples.includes(file))).toEqual(examples);
    const different = examples.filter(
      (file) => !readFileSync(new URL(file, FIXTURES_DIR)).equals(readFileSync(new URL(file, EXAMPLES_DIR))),
    );
    expect(different).toEqual([]);
  });

  it('prints the fixtures nothing uses', () => {
    const index = readFileSync(new URL('index.ts', FIXTURES_DIR), 'utf8');
    const keys = [...index.matchAll(/^import (\w+) from '\.\/([\w-]+\.json)';$/gm)].map(([, key, file]) => ({ key: key ?? '', file: file ?? '' }));
    expect(keys.length).toBe(jsonFiles(FIXTURES_DIR).length);
    const texts = sourceTexts();
    const unused = keys.filter(({ key, file }) => !texts.some((text) => text.includes(`fixtures.${key}`) || text.includes(file)));
    if (unused.length > 0) console.info(`Fixtures nothing uses: ${unused.map(({ file }) => file).join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// The mock
// ---------------------------------------------------------------------------

const ORIGIN = 'http://tablet.local:8080';
const SCALE_ID = 'CF:3A:91:0B:7E:12';
/** The rating-scale probe sends an enjoyment out of range on purpose (D101): its reply is checked, its body is not. */
const PROBE = /^\/api\/v1\/shots\/cafai-probe/;

interface Exchange {
  method: Method;
  path: string;
  sent: unknown;
  status: number;
  received: unknown;
  text: string;
}

function parse(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A fetch that records each request and its reply, for CafAI's own client to use. */
function recorder(exchanges: Exchange[]): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const sentText = await request.clone().text();
    const response = await fetch(request);
    const text = await response.clone().text();
    const url = new URL(request.url);
    exchanges.push({
      method: request.method as Method,
      path: `${url.pathname}${url.search}`,
      sent: parse(sentText),
      status: response.status,
      received: parse(text),
      text,
    });
    return response;
  };
}

/** Run a call for what it sends and receives; a refusal is recorded like any reply. */
async function attempt<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

function problemsOf(exchange: Exchange): string[] {
  const at = `${exchange.method} ${exchange.path}`;
  if (exchange.status === 404 && exchange.text === 'Route not found') return [`${at}: the mock has no such route`];
  const problems: string[] = [];
  if ((exchange.method === 'POST' || exchange.method === 'PUT') && exchange.sent !== undefined && !PROBE.test(exchange.path)) {
    problems.push(...spec.request(exchange.method, exchange.path, exchange.sent).map((problem) => `body of ${at}: ${problem}`));
  }
  problems.push(...spec.response(exchange.method, exchange.path, exchange.status, exchange.received).map((problem) => `${exchange.status} to ${at}: ${problem}`));
  return problems;
}

/** The routes CafAI calls (docs/audit/2026-10-09/cafai.md sections 1.2 and 1.6) and the new ones, each of which must be exercised. */
const ROUTES: ReadonlyArray<[Method, RegExp]> = [
  ['GET', /^\/api\/v1\/info$/],
  ['GET', /^\/api\/v1\/settings$/],
  ['POST', /^\/api\/v1\/settings$/],
  ['GET', /^\/api\/v1\/plugins$/],
  ['GET', /^\/api\/v1\/plugins\/dye2\.reaplugin\/recent-favs$/],
  ['GET', /^\/api\/v1\/machine\/info$/],
  ['GET', /^\/api\/v1\/machine\/state$/],
  ['GET', /^\/api\/v1\/machine\/capabilities$/],
  ['PUT', /^\/api\/v1\/machine\/state\/(sleeping|idle|espresso|skipStep)$/],
  ['POST', /^\/api\/v1\/machine\/heartbeat$/],
  ['POST', /^\/api\/v1\/machine\/profile$/],
  ['PUT', /^\/api\/v1\/scale\/tare$/],
  ['GET', /^\/api\/v1\/devices$/],
  ['GET', /^\/api\/v1\/devices\/scan\?connect=false&quick=true$/],
  ['PUT', /^\/api\/v1\/devices\/connect$/],
  ['GET', /^\/api\/v1\/workflow$/],
  ['PUT', /^\/api\/v1\/workflow$/],
  ['GET', /^\/api\/v1\/profiles(\?|$)/],
  ['POST', /^\/api\/v1\/profiles$/],
  ['GET', /^\/api\/v1\/profiles\/profile%3A/],
  ['PUT', /^\/api\/v1\/profiles\/profile%3A/],
  ['GET', /^\/api\/v1\/shots\?/],
  ['GET', /^\/api\/v1\/shots\/latest$/],
  ['GET', /^\/api\/v1\/shots\/(?!latest)[^/?]+$/],
  ['PUT', /^\/api\/v1\/shots\/(?!cafai-probe)[^/?]+$/],
  ['PUT', PROBE],
  ['GET', /^\/api\/v1\/steams\/ids$/],
  ['GET', /^\/api\/v1\/steams\/latest$/],
  ['GET', /^\/api\/v1\/grinders$/],
  ['GET', /^\/api\/v1\/grinders\?includeArchived=true$/],
  ['GET', /^\/api\/v1\/grinders\/[^/?]+$/],
  ['POST', /^\/api\/v1\/grinders$/],
  ['DELETE', /^\/api\/v1\/grinders\/[^/?]+$/],
  ['GET', /^\/api\/v1\/beans$/],
  ['POST', /^\/api\/v1\/beans$/],
  ['PUT', /^\/api\/v1\/beans\/[^/]+$/],
  ['GET', /^\/api\/v1\/beans\/[^/]+\/batches$/],
  ['POST', /^\/api\/v1\/beans\/[^/]+\/batches$/],
  ['GET', /^\/api\/v1\/bean-batches$/],
  ['GET', /^\/api\/v1\/bean-batches\?includeArchived=true$/],
  ['PUT', /^\/api\/v1\/bean-batches\/[^/]+$/],
  ['GET', /^\/api\/v1\/presence\/settings$/],
  ['POST', /^\/api\/v1\/presence\/settings$/],
  ['POST', /^\/api\/v1\/presence\/schedules$/],
  ['PUT', /^\/api\/v1\/presence\/schedules\/[^/?]+$/],
  ['DELETE', /^\/api\/v1\/presence\/schedules\/[^/?]+$/],
  ['GET', /^\/api\/v1\/store\/cafai$/],
  ['GET', /^\/api\/v1\/store\/cafai\?full=1$/],
  ['GET', /^\/api\/v1\/store\/cafai\/meta$/],
  ['POST', /^\/api\/v1\/store\/cafai\/meta$/],
  ['DELETE', /^\/api\/v1\/store\/cafai\/meta$/],
  ['POST', /^\/api\/v1\/store\/cafai-key\/anthropic$/],
  ['GET', /^\/api\/v1\/store\/cafai-key\/anthropic$/],
  ['DELETE', /^\/api\/v1\/store\/cafai-key\/anthropic$/],
];

/** The channels CafAI opens (src/api/telemetry.ts) and time-to-ready's (spec 6.3). */
const CHANNELS = [
  'ws/v1/machine/snapshot',
  'ws/v1/scale/snapshot',
  'ws/v1/devices',
  'ws/v1/machine/shotState',
  'ws/v1/machine/waterLevels',
  'ws/v1/machine/shotSettings',
  'ws/v1/plugins/time-to-ready.reaplugin/timeToReady',
] as const;

function open(channel: string) {
  const socket = new WebSocket(`${ORIGIN.replace(/^http/, 'ws')}/${channel}`);
  const frames: unknown[] = [];
  socket.addEventListener('message', (event) => frames.push(parse(String(event.data))));
  // Settled either way: a channel the mock cannot serve shows up as one without frames.
  const opened = new Promise<void>((resolve) => {
    for (const event of ['open', 'error', 'close'] as const) socket.addEventListener(event, () => resolve());
    setTimeout(resolve, 3000);
  });
  return { channel, socket, frames, opened };
}

async function until(condition: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the mock against the spec', () => {
  const mock = createMockServer([], { uploadMs: 0 });
  const exchanges: Exchange[] = [];
  const recording = recorder(exchanges);
  const client = createDecaidClient({ origin: ORIGIN, fetch: recording });
  const sockets = CHANNELS.map((channel) => ({ channel, handle: null as ReturnType<typeof open> | null }));

  beforeAll(async () => {
    mock.server.listen({ onUnhandledRequest: 'error' });
    for (const entry of sockets) entry.handle = open(entry.channel);
    await Promise.all(sockets.map((entry) => entry.handle?.opened));
  });
  afterAll(() => {
    for (const entry of sockets) entry.handle?.socket.close();
    mock.close();
  });

  it('answers what the spec says, and takes the bodies CafAI sends, on every route CafAI calls', async () => {
    const blooming = getTemplate('blooming-espresso');
    if (!blooming) throw new Error('the Blooming template is missing');

    await attempt(() => client.getInfo());
    await attempt(() => client.getSettings());
    await attempt(() => client.updateSettings({ gatewayMode: 'tracking' }));
    await attempt(() => client.listPlugins());
    await attempt(() => client.getPluginEndpoint('dye2.reaplugin', 'recent-favs'));

    await attempt(() => client.getMachineInfo());
    await attempt(() => client.getMachineState());
    await attempt(() => client.getCapabilities());
    await attempt(() => client.heartbeat());
    await attempt(() => client.getDevices());
    await attempt(() => client.scanDevices({ quick: true }));
    await attempt(() => client.connectDevice(SCALE_ID));
    await attempt(() => client.tareScale());

    // A load as the engine makes it: the whole profile and a context that clears another skin's fields (engine.ts).
    const context: WorkflowContext = {
      targetDoseWeight: 18,
      targetYield: 36,
      coffeeName: 'Kiambu AA',
      coffeeRoaster: 'Square Mile',
      beanBatchId: null,
      grinderId: null,
      grinderModel: null,
      grinderSetting: null,
      grinderBurrs: null,
      extras: { [EXTRAS_KEY]: { versionId: 'version-1', bagId: 'bag-1' } },
    };
    await attempt(() => client.getWorkflow());
    const loaded = await attempt(() => activateProfile(client, blooming.profile, context, { shotRunning: false }));
    if (loaded) await attempt(() => loadProfileOnMachine(client, loaded.profile, { fetch: recording }));
    await attempt(() => client.updateWorkflow({ context: { grinderModel: 'Niche Zero', grinderSetting: '12' } }));

    const created = await attempt(() =>
      createProfileVersion(client, { profile: blooming.profile, parentId: blooming.decaidDefaultId, metadata: { cafai: { versionId: 'version-1' } } }),
    );
    await attempt(() => client.listProfiles());
    if (created) {
      await attempt(() => client.getProfile(created.record.id));
      await attempt(() => client.updateProfile(created.record.id, { metadata: { cafai: { versionId: 'version-1', note: 'kept' } } }));
    }

    const grinders = (await attempt(() => listGrinders(client, { includeArchived: true, fetch: recording }))) ?? [];
    if (grinders[0]) await attempt(() => getGrinder(client, grinders[0]!.id, { fetch: recording }));
    // A grinder as Settings' Add a grinder and the coach's offer add it, with each kind of dial.
    for (const draft of [
      { model: 'Mazzer Philos', burrs: '64 mm flat', settingType: 'numeric' as const, smallStep: 0.5, bigStep: 2, values: null },
      { model: 'Baratza Encore', burrs: null, settingType: 'preset' as const, smallStep: null, bigStep: null, values: ['1', '2', '3'] },
      { model: 'Kinu M47', burrs: null, settingType: null, smallStep: null, bigStep: null, values: null },
    ]) {
      const request = grinderRequest(draft);
      const added = request ? await attempt(() => createGrinder(client, request, { fetch: recording })) : null;
      // Deleting is not CafAI's, but the tests against a real Decaid undo with it.
      if (added) await attempt(() => recording(`${ORIGIN}/api/v1/grinders/${encodeURIComponent(added.id)}`, { method: 'DELETE' }));
    }
    await attempt(() => listGrinders(client, { fetch: recording }));

    // A bag's bean and batch as the engine adds them (spec 6.1): roast date as the bag keeps it, YYYY-MM-DD.
    await attempt(() => client.listBeans());
    const bean = await attempt(() => client.createBean({ roaster: 'Square Mile', name: 'Kiambu AA', country: 'Kenya', processing: 'washed', notes: 'blackcurrant' }));
    if (bean) {
      await attempt(() => client.listBatches(bean.id));
      const batch = await attempt(() => client.createBatch(bean.id, { roastDate: '2026-09-30', roastLevel: 'light' }));
      // Every batch in one read, as the bean card makes it (spec 6.1).
      await attempt(() => client.listAllBatches());
      await attempt(() => client.listAllBatches({ includeArchived: true }));
      // Archiving is not CafAI's (D102), but the tests against a real Decaid undo with it.
      await attempt(() => recording(`${ORIGIN}/api/v1/beans/${encodeURIComponent(bean.id)}`, { method: 'PUT', body: JSON.stringify({ archived: true }) }));
      if (batch) {
        await attempt(() => recording(`${ORIGIN}/api/v1/bean-batches/${encodeURIComponent(batch.id)}`, { method: 'PUT', body: JSON.stringify({ archived: true }) }));
      }
    }

    // Settings > Sleep and wake: the settings, the minutes changed, the idle sleep on with no timeout, and a schedule
    // whose keep-awake window began five minutes ago, so the settings carry its end (a local time), changed and deleted.
    await attempt(() => client.getPresenceSettings());
    await attempt(() => client.updatePresenceSettings({ sleepTimeoutMinutes: 45 }));
    await attempt(() => client.updatePresenceSettings({ userPresenceEnabled: true, sleepTimeoutMinutes: 0 }));
    const began = new Date(Date.now() - 5 * 60_000);
    const time = [began.getHours(), began.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':');
    const schedule = await attempt(() => client.addWakeSchedule({ time, daysOfWeek: [], enabled: true, keepAwakeFor: 45 }));
    if (schedule) {
      const awake = await attempt(() => client.getPresenceSettings());
      expect(awake?.keepAwakeUntil, 'the end of the keep-awake window running now').toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000$/);
      await attempt(() => client.updateWakeSchedule(schedule.id, { enabled: false }));
      await attempt(() => client.updateWakeSchedule(schedule.id, { keepAwakeFor: null }));
      await attempt(() => client.deleteWakeSchedule(schedule.id));
    }

    await attempt(() => client.kv.getAll('cafai'));
    await attempt(() => client.kv.set('cafai', 'meta', { schemaVersion: 1, appVersion: '0.1.0', updatedAt: '2026-10-09T10:00:00.000Z', pages: {}, skipped: [] }));
    await attempt(() => client.kv.get('cafai', 'meta'));
    await attempt(() => client.kv.list('cafai'));
    await attempt(() => client.kv.delete('cafai', 'meta'));
    // The key's own namespace (D99), with a stand-in value.
    await attempt(() => client.kv.set(KEY_NAMESPACE, KEY_NAME, 'not-a-real-key'));
    await attempt(() => client.kv.get(KEY_NAMESPACE, KEY_NAME));
    await attempt(() => client.kv.delete(KEY_NAMESPACE, KEY_NAME));

    // A wake from sleep starts time-to-ready (spec 6.3), then a whole shot with a skipped step.
    await attempt(() => client.setMachineState('sleeping'));
    await attempt(() => client.setMachineState('idle'));
    mock.setSpeed(500);
    await attempt(() => client.setMachineState('espresso'));
    await attempt(() => client.setMachineState('skipStep'));
    await mock.player.whenIdle();
    mock.setSpeed(1);

    // The care reminders count shots and steams (D-CARE-3): the total, the newest steam before there is one
    // (200 null), then a steaming, its id and itself.
    await attempt(() => client.listShots({ limit: 1 }));
    await attempt(() => client.getLatestSteam());
    mock.setSpeed(500);
    await attempt(() => client.setMachineState('steam'));
    await mock.player.whenIdle();
    mock.setSpeed(1);
    const steamIds = await attempt(() => client.listSteamIds());
    expect(steamIds, 'the steaming left a steam record').toHaveLength(1);
    await attempt(() => client.getLatestSteam());

    await attempt(() => client.listShots({ limit: 5 }));
    const latest = await attempt(() => client.getLatestShot());
    if (latest) {
      const shot = await attempt(() => client.getShot(latest.id));
      const line = cafaiNotesLine('Sweet, a little sharp', 'Kiambu AA v1');
      const espressoNotes = mergeNotes(shot?.annotations?.espressoNotes, null, line);
      // As CafAI writes a verdict (D126): the running score, and the words with what they compared.
      const rating = { verdict: 'better', comparedWith: { kind: 'previous', shotId: 'shot-0' } };
      await attempt(() =>
        client.updateShot(latest.id, { annotations: { espressoNotes, enjoyment: 7, extras: { [EXTRAS_KEY]: { notes: line, ...rating } } } }),
      );
    }
    await attempt(() => client.probeEnjoymentScale());

    const missing = ROUTES.filter(([method, path]) => !exchanges.some((exchange) => exchange.method === method && path.test(exchange.path)));
    expect(missing.map(([method, path]) => `${method} ${path.source}`), 'routes the test did not reach').toEqual([]);
    expect(exchanges.flatMap(problemsOf)).toEqual([]);
  }, 60_000);

  it('pushes frames on every channel CafAI opens: replayed on connect, or after the wake and the shot above', async () => {
    const handles = sockets.map((entry) => entry.handle!);
    const byChannel = (channel: string) => handles.find((handle) => handle.channel === channel)!.frames;
    await until(() => handles.every((handle) => handle.frames.length > 0), 'a frame on every channel').catch(() => {});
    const empty = handles.filter((handle) => handle.frames.length === 0).map((handle) => handle.channel);
    expect(empty, 'channels without a frame').toEqual([]);
    const shotStates = byChannel('ws/v1/machine/shotState').map((frame) => (frame as { state?: unknown }).state);
    expect(shotStates).toEqual(expect.arrayContaining(['preheating', 'pouring', 'finished']));
  });

  it('pushes frames the spec describes', () => {
    const handles = sockets.map((entry) => entry.handle!);
    const problems = handles.flatMap((handle) => {
      const seen = new Map<string, number>();
      for (const frame of handle.frames) for (const problem of spec.frame(handle.channel, frame)) seen.set(problem, (seen.get(problem) ?? 0) + 1);
      return [...seen].map(([problem, count]) => `${handle.channel}: ${problem}${count > 1 ? ` (${count} frames)` : ''}`);
    });
    expect(problems).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { DevicesState, PaginatedShots, ScaleWsFrame, ShotRecord } from '../../src/api/types.ts';
import { fixtures } from '../fixtures/index.ts';
import { MockHttpError } from './errors.ts';
import { createMockDecaid } from './state.ts';

function expectHttpError(run: () => unknown, status: number, body?: Record<string, unknown>) {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected a MockHttpError').toBeInstanceOf(MockHttpError);
  expect((caught as MockHttpError).status).toBe(status);
  if (body) expect((caught as MockHttpError).body).toMatchObject(body);
  return caught as MockHttpError;
}

const TEMPLATE_IDS = ['profile:7438cb7266f60558b48f', 'profile:59036f8846b1ed3b4255', 'profile:729d284747718d27c93a'];

describe('seed', () => {
  it('starts with a connected machine and scale', () => {
    const mock = createMockDecaid();
    expect(mock.isMachineConnected()).toBe(true);
    expect(mock.isScaleConnected()).toBe(true);
    const devices = mock.getDevicesState();
    expect(devices.devices.find((d) => d.type === 'machine')).toMatchObject({ state: 'connected', available: true });
    expect(devices.devices.find((d) => d.type === 'scale')).toMatchObject({ state: 'connected', connectionRole: 'primary' });
    expect(devices.connectionStatus).toMatchObject({ phase: 'ready', error: null });
    expect(devices.timestamp).toMatch(/Z$/);
  });

  it('can start with the machine or the scale disconnected', () => {
    const mock = createMockDecaid({ machineConnected: false, scaleConnected: false });
    expect(mock.isMachineConnected()).toBe(false);
    expect(mock.getDevices().find((d) => d.type === 'machine')).toMatchObject({ state: 'disconnected', available: false });
    expect(mock.getDevices().find((d) => d.type === 'scale')).toMatchObject({ state: 'disconnected' });
    expect(mock.getScaleSnapshot()).toBeNull();
  });

  it('seeds the workflow from the verified example', () => {
    expect(createMockDecaid().getWorkflow()).toEqual(fixtures.workflowGet());
  });

  it('seeds the three templates as bundled defaults with their real ids, plus the example records', () => {
    const mock = createMockDecaid();
    const ids = mock.listProfiles({}).map((r) => r.id);
    for (const id of TEMPLATE_IDS) expect(ids).toContain(id);
    expect(ids).toContain('profile:fbff9b37ed390c6a8110');
    expect(ids).toContain('profile:a582ef47a76f99f56912');
    const blooming = mock.getProfile('profile:7438cb7266f60558b48f');
    expect(blooming).toMatchObject({
      isDefault: true,
      visibility: 'visible',
      metadata: { source: 'bundled', filename: 'Blooming_espresso.json' },
    });
    expect(blooming.profile.steps[0]!.temperature).toBe(97.5);
    expect(mock.getProfile('profile:59036f8846b1ed3b4255').profile.title).toBe('D-Flow / default');
  });

  it('seeds the example shot', () => {
    const mock = createMockDecaid();
    expect(mock.getShot('3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17')).toEqual(fixtures.shotRecord());
    expect(mock.getLatestShot()?.id).toBe('3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17');
    expect('measurements' in (mock.getLatestShot() ?? {})).toBe(false);
  });
});

describe('PUT /workflow semantics', () => {
  it('a context-only patch keeps the profile, and the workflow id stays', () => {
    const mock = createMockDecaid();
    const before = mock.getWorkflow();
    const after = mock.updateWorkflow({ context: { targetYield: 40 } });
    expect(after.id).toBe(before.id);
    expect(after.profile).toEqual(before.profile);
    expect(after.context).toMatchObject({ targetYield: 40, targetDoseWeight: 18, grinderSetting: '14.5' });
  });

  it('objects merge but arrays replace: a new steps array replaces every step', () => {
    const mock = createMockDecaid();
    const londonium = mock.getProfile('profile:729d284747718d27c93a').profile;
    const after = mock.updateWorkflow({ profile: { title: 'L v1', steps: londonium.steps } });
    expect(after.profile.steps).toEqual(londonium.steps);
    expect(after.profile.title).toBe('L v1');
    // Omitted profile keys are inherited from the previous profile.
    expect(after.profile.notes).toBe(fixtures.workflowGet().profile.notes);
    expect(after.profile.target_weight).toBe(36);
  });

  it('drops a profile id and unknown keys, and normalizes numeric strings', () => {
    const mock = createMockDecaid();
    const profile = { ...fixtures.workflowGet().profile, id: 'profile:x', hidden: '0', tank_temperature: '0' } as Record<string, unknown>;
    const after = mock.updateWorkflow({ profile });
    expect('id' in after.profile).toBe(false);
    expect('hidden' in after.profile).toBe(false);
    expect(after.profile.tank_temperature).toBe(0);
  });

  it('an explicit null clears a context field, and extras merge per key', () => {
    const mock = createMockDecaid();
    mock.updateWorkflow({ context: { extras: { a: 1, b: { c: 2 } } } });
    const after = mock.updateWorkflow({ context: { grinderSetting: null, extras: { b: { d: 3 } } } });
    expect('grinderSetting' in (after.context ?? {})).toBe(false);
    expect(after.context?.extras).toEqual({ a: 1, b: { c: 2, d: 3 } });
  });

  it('rejects a null or non-numeric targetYield and null objects with 400', () => {
    const mock = createMockDecaid();
    expectHttpError(() => mock.updateWorkflow({ context: { targetYield: null } }), 400, {
      error: 'Invalid request',
      message: 'FormatException: Field "targetYield" cannot be null',
    });
    expectHttpError(() => mock.updateWorkflow({ context: { targetYield: '36' } }), 400, {
      message: 'FormatException: Field "targetYield" must be a number or null',
    });
    expectHttpError(() => mock.updateWorkflow({ context: null }), 400);
    expectHttpError(() => mock.updateWorkflow({ steamSettings: null }), 400);
    expectHttpError(() => mock.updateWorkflow({ steamSettings: { flow: null } }), 400);
    expectHttpError(() => mock.updateWorkflow([] as unknown as Record<string, unknown>), 400, { error: 'Request body must be a JSON object' });
    expect(mock.getWorkflow()).toEqual(fixtures.workflowGet());
  });

  it('a missing required profile field is 400, a missing step field is 500', () => {
    const mock = createMockDecaid();
    expectHttpError(() => mock.updateWorkflow({ profile: { title: '' } }), 400, {
      message: 'Invalid argument(s): Profile must have a non-empty "title"',
    });
    const steps = fixtures.workflowGet().profile.steps.map((step) => {
      const copy = { ...step } as Record<string, unknown>;
      delete copy.sensor;
      return copy;
    });
    expectHttpError(() => mock.updateWorkflow({ profile: { steps } }), 500, { error: 'Internal server error' });
  });

  it('writes steam settings as integers and keeps the legacy dose fields out', () => {
    const mock = createMockDecaid();
    const after = mock.updateWorkflow({ steamSettings: { targetTemperature: '155', duration: 40.7 }, doseData: { doseIn: 19, doseOut: 42 } });
    expect(after.steamSettings).toEqual({ targetTemperature: 155, duration: 40, flow: 0.8, stopAtTemperature: 0 });
    expect('doseData' in after).toBe(false);
    expect(after.context?.targetDoseWeight).toBe(18);
  });
});

describe('the shot settings follow the workflow', () => {
  it("a steam or hot water change reaches the machine's shot settings, and its channel", () => {
    const mock = createMockDecaid({ seedExamples: false });
    const heard: unknown[] = [];
    mock.on('shotSettings', (settings) => heard.push(settings));
    mock.updateWorkflow({ steamSettings: { duration: 55 }, hotWaterData: { volume: 120 } });
    expect(mock.getShotSettings()).toMatchObject({ targetSteamDuration: 55, targetHotWaterVolume: 120, targetSteamTemp: 150 });
    expect(heard).toHaveLength(1);
  });

  it('steam below 135 °C reaches the machine as 0, steam off', () => {
    const mock = createMockDecaid({ seedExamples: false });
    mock.updateWorkflow({ steamSettings: { targetTemperature: 0 } });
    expect(mock.getShotSettings().targetSteamTemp).toBe(0);
  });

  it('a change to anything else sends nothing', () => {
    const mock = createMockDecaid({ seedExamples: false });
    const heard: unknown[] = [];
    mock.on('shotSettings', (settings) => heard.push(settings));
    mock.updateWorkflow({ rinseData: { duration: 12 } });
    expect(heard).toEqual([]);
  });
});

describe('profiles', () => {
  const request = () => fixtures.profileCreateRequest();

  it('creates a record with the real content-hash id', () => {
    const mock = createMockDecaid({ seedExamples: false });
    const record = mock.createProfile(request());
    expect(record).toMatchObject({
      id: 'profile:fbff9b37ed390c6a8110',
      parentId: 'profile:a582ef47a76f99f56912',
      visibility: 'visible',
      isDefault: false,
      metadata: { source: 'cafai', beanKey: 'square-mile/guji-hambela', iteration: 1 },
      metadataHash: fixtures.profileRecord().metadataHash,
    });
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/);
    expect(mock.getProfile(record.id)).toEqual(record);
  });

  it('identical content returns the existing record unchanged (dedupe)', () => {
    const mock = createMockDecaid();
    const blooming = mock.getProfile('profile:7438cb7266f60558b48f');
    const result = mock.createProfile({
      profile: { ...blooming.profile, title: 'Kiambu v1' },
      parentId: 'profile:7438cb7266f60558b48f',
      metadata: { source: 'cafai' },
    });
    expect(result).toEqual(blooming);
  });

  it('dedupe even returns a deleted record as it is', () => {
    const mock = createMockDecaid({ seedExamples: false });
    const created = mock.createProfile(request());
    mock.deleteProfile(created.id);
    expect(mock.createProfile(request()).visibility).toBe('deleted');
  });

  it('rejects bad bodies the way Decaid does', () => {
    const mock = createMockDecaid();
    expectHttpError(() => mock.createProfile({ title: 'bare profile' }), 400, {
      error: 'Missing required field',
      message: 'Request must contain "profile" field',
    });
    expectHttpError(() => mock.createProfile({ profile: { ...request().profile, tank_temperature: undefined } }), 400, {
      error: 'Invalid request',
      message: 'Invalid argument(s): Profile must have "tank_temperature"',
    });
    expectHttpError(() => mock.createProfile({ ...request(), parentId: 'profile:nope' }), 400, {
      message: 'Invalid argument(s): Parent profile not found: profile:nope',
    });
    const brokenStep = { ...request().profile.steps[0]! } as Record<string, unknown>;
    delete brokenStep.seconds;
    expectHttpError(() => mock.createProfile({ profile: { ...request().profile, steps: [brokenStep] } }), 500, {
      error: 'Internal server error',
    });
  });

  it('lists visible records newest first; includeHidden returns everything; parentId lists children', () => {
    const mock = createMockDecaid({ now: () => new Date(2027, 0, 1).getTime() });
    const child = mock.createProfile({ ...request(), profile: { ...request().profile, target_weight: 38 } });
    const list = mock.listProfiles({});
    expect(list[0]!.id).toBe(child.id);
    const updated = list.map((r) => r.updatedAt);
    expect([...updated].sort().reverse()).toEqual(updated);
    mock.deleteProfile(child.id);
    expect(mock.listProfiles({}).map((r) => r.id)).not.toContain(child.id);
    expect(mock.listProfiles({ includeHidden: 'true' }).map((r) => r.id)).toContain(child.id);
    expect(mock.listProfiles({ visibility: 'deleted' }).map((r) => r.id)).toEqual([child.id]);
    expect(mock.listProfiles({ parentId: 'profile:a582ef47a76f99f56912' }).map((r) => r.id).sort()).toEqual(
      [child.id, 'profile:fbff9b37ed390c6a8110'].sort(),
    );
  });

  it('a presentation-only update keeps the id; an execution change replaces the record', () => {
    const mock = createMockDecaid({ seedExamples: false });
    const created = mock.createProfile(request());
    const renamed = mock.updateProfile(created.id, { profile: { ...created.profile, title: 'Renamed' } });
    expect(renamed.id).toBe(created.id);
    expect(renamed.metadataHash).not.toBe(created.metadataHash);
    expect(renamed.parentId).toBe(created.parentId);

    const changed = mock.updateProfile(created.id, { profile: { ...created.profile, target_weight: 40 } });
    expect(changed.id).not.toBe(created.id);
    expect(changed.createdAt).toBe(created.createdAt);
    expectHttpError(() => mock.getProfile(created.id), 404, { error: 'Profile not found', id: created.id });
  });

  it('protects bundled defaults', () => {
    const mock = createMockDecaid();
    const id = TEMPLATE_IDS[0]!;
    expectHttpError(() => mock.updateProfile(id, { profile: mock.getProfile(id).profile }), 400, {
      message: 'Invalid argument(s): Cannot modify default profile content',
    });
    expect(mock.deleteProfile(id)).toEqual({ success: true, message: 'Profile deleted', id });
    expect(mock.getProfile(id).visibility).toBe('hidden');
    expectHttpError(() => mock.setProfileVisibility(id, { visibility: 'deleted' }), 400);
    expect(mock.restoreDefaultProfile('Blooming_espresso.json').visibility).toBe('visible');
    expect(mock.defaultProfiles().map((d) => d.filename)).toContain('Londonium.json');
  });

  it('returns lineage root to self to descendants', () => {
    const mock = createMockDecaid();
    const v2 = mock.createProfile({
      profile: { ...request().profile, target_weight: 38 },
      parentId: 'profile:fbff9b37ed390c6a8110',
    });
    expect(mock.profileLineage('profile:fbff9b37ed390c6a8110').map((r) => r.id)).toEqual([
      'profile:a582ef47a76f99f56912',
      'profile:fbff9b37ed390c6a8110',
      v2.id,
    ]);
  });
});

describe('shots', () => {
  it('pages with the requested limit echoed back', () => {
    const mock = createMockDecaid();
    const page = mock.listShots(new URLSearchParams('limit=500&offset=0')) as PaginatedShots;
    expect(page).toMatchObject({ total: 1, limit: 500, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect('measurements' in page.items[0]!).toBe(false);
    expect(mock.getShotIds()).toEqual(['3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17']);
  });

  it('a missing shot is 404 {error:"Shot not found"}', () => {
    expectHttpError(() => createMockDecaid().getShot('nope'), 404, { error: 'Shot not found' });
  });

  it('PUT deep-merges annotations, merges extras per key, mirrors legacy fields', () => {
    const mock = createMockDecaid();
    const id = '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17';
    const before = mock.getShot(id);
    const after = mock.updateShot(id, { annotations: { enjoyment: 8, extras: { other: { x: 1 } } } });
    expect(after.annotations?.enjoyment).toBe(8);
    expect(after.annotations?.extras).toMatchObject({ cafai: before.annotations?.extras?.cafai, other: { x: 1 } });
    expect((after as ShotRecord & { metadata?: unknown }).metadata).toEqual(after.annotations?.extras);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.measurements).toEqual(before.measurements);

    const cleared = mock.updateShot(id, { annotations: { espressoNotes: null } });
    expect('espressoNotes' in (cleared.annotations ?? {})).toBe(false);
    expect('shotNotes' in cleared).toBe(false);
  });

  it('updatedAt only moves when content changes', () => {
    const mock = createMockDecaid();
    const id = '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17';
    const before = mock.getShot(id);
    const same = mock.updateShot(id, { annotations: { enjoyment: before.annotations?.enjoyment } });
    expect(same.updatedAt).toBe(before.updatedAt);
  });

  it('refuses system fields and an out-of-range enjoyment', () => {
    const mock = createMockDecaid();
    const id = '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17';
    expectHttpError(() => mock.updateShot(id, { measurements: [] }), 400, { error: 'measurements is not editable via this endpoint' });
    expectHttpError(() => mock.updateShot(id, { createdAt: 'x' }), 400);
    expectHttpError(() => mock.updateShot(id, { id: 'other' }), 400, { error: 'ID in path does not match ID in body' });
    expectHttpError(() => mock.updateShot(id, { annotations: { enjoyment: 11 } }), 400, {
      error: 'annotations.enjoyment must be between 0 and 10, got 11',
    });
    expectHttpError(() => mock.updateShot('missing', { annotations: {} }), 404);
  });
});

describe('key-value store', () => {
  it('a missing key is null; set and delete answer {}', () => {
    const mock = createMockDecaid();
    expect(mock.kvGet('cafai', 'meta')).toBeNull();
    mock.kvSet('cafai', 'meta', '{"a":1}');
    expect(mock.kvGet('cafai', 'meta')).toEqual({ a: 1 });
    expect(mock.kvKeys('cafai')).toEqual(['meta']);
    mock.kvDelete('cafai', 'meta');
    mock.kvDelete('cafai', 'never-there');
    expect(mock.kvGet('cafai', 'meta')).toBeNull();
  });

  it('a literal null body stores the string "null", which getAll still lists', () => {
    const mock = createMockDecaid();
    mock.kvSet('cafai', 'n', 'null');
    expect(mock.kvGet('cafai', 'n')).toBe('null');
    expect(mock.kvAll('cafai')).toEqual({ n: 'null' });
  });

  it('a body that is not JSON is a plain-text 500', () => {
    const error = expectHttpError(() => createMockDecaid().kvSet('cafai', 'k', 'not json'), 500);
    expect(error.plainText).toBe('Internal Server Error');
  });

  it('keeps namespaces apart and keys raw', () => {
    const mock = createMockDecaid();
    mock.kvSet('cafai', 'a%2Fb', '1');
    mock.kvSet('other', 'a%2Fb', '2');
    expect(mock.kvKeys('cafai')).toEqual(['a%2Fb']);
    expect(mock.kvGet('other', 'a%2Fb')).toBe(2);
  });

  it('the cafai-key namespace works like any other (D10)', () => {
    const mock = createMockDecaid();
    expect(mock.kvGet('cafai-key', 'anthropic')).toBeNull();
    mock.kvSet('cafai-key', 'anthropic', '"sk-ant-mock"');
    expect(mock.kvGet('cafai-key', 'anthropic')).toBe('sk-ant-mock');
    expect(mock.kvKeys('cafai-key')).toEqual(['anthropic']);
    expect(mock.kvAll('cafai-key')).toEqual({ anthropic: 'sk-ant-mock' });
    mock.kvDelete('cafai-key', 'anthropic');
    expect(mock.kvGet('cafai-key', 'anthropic')).toBeNull();
  });
});

describe('settings (D1)', () => {
  it('starts with gatewayMode "tracking"', () => {
    expect(createMockDecaid().getSettings().gatewayMode).toBe('tracking');
  });

  it('can start in "full" (the ?mockGateway=full switch sets the same settings option)', () => {
    const mock = createMockDecaid({ settings: { gatewayMode: 'full' } });
    expect(mock.getSettings().gatewayMode).toBe('full');
  });

  it('POST merges only the keys it recognises, leaving the rest untouched', () => {
    const mock = createMockDecaid();
    mock.applySettingsPatch({ gatewayMode: 'full', blockOnNoScale: true, somethingUnknown: 'ignored' });
    const settings = mock.getSettings();
    expect(settings.gatewayMode).toBe('full');
    expect(settings.blockOnNoScale).toBe(true);
    expect('somethingUnknown' in settings).toBe(false);
    expect(settings.weightFlowMultiplier).toBe(1.0);
  });

  it('rejects an unknown gatewayMode with {message}, no "error" field (SettingsHandler\'s own shape)', () => {
    const error = expectHttpError(() => createMockDecaid().applySettingsPatch({ gatewayMode: 'bogus' }), 400, { message: 'bogus is not a gateway mode' });
    expect('error' in (error.body ?? {})).toBe(false);
  });

  it('rejects a non-boolean and a non-number setting', () => {
    const mock = createMockDecaid();
    expectHttpError(() => mock.applySettingsPatch({ blockOnNoScale: 'yes' }), 400, { message: 'blockOnNoScale must be a boolean' });
    expectHttpError(() => mock.applySettingsPatch({ weightFlowMultiplier: 'fast' }), 400, { message: 'weightFlowMultiplier must be a number' });
  });

  it('a non-object body is a plain 500, like an uncaught jsonDecode cast', () => {
    const error = expectHttpError(() => createMockDecaid().applySettingsPatch([1, 2]), 500);
    expect(error.plainText).toBe('Internal Server Error');
  });
});

describe('enjoyment scale (D2)', () => {
  it('validates 0-10 before the id lookup by default', () => {
    const mock = createMockDecaid();
    expectHttpError(() => mock.updateShot('no-such-shot', { annotations: { enjoyment: 11 } }), 400, {
      error: 'annotations.enjoyment must be between 0 and 10, got 11',
    });
  });

  it('?mockEnjoyment=100 skips validation and looks the id up first, like 0.8.6', () => {
    const mock = createMockDecaid({ enjoymentScale: 100 });
    expectHttpError(() => mock.updateShot('no-such-shot', { annotations: { enjoyment: 11 } }), 404, { error: 'Shot not found' });
    const id = '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17';
    const updated = mock.updateShot(id, { annotations: { enjoyment: 80 } });
    expect(updated.annotations?.enjoyment).toBe(80);
  });
});

describe('plugins (D3)', () => {
  it('lists the four plugins loaded by default, with manifest fields', () => {
    const mock = createMockDecaid();
    const plugins = mock.listPlugins();
    expect(plugins.map((p) => p.id)).toEqual(['time-to-ready.reaplugin', 'visualizer.reaplugin', 'dye2.reaplugin', 'settings.reaplugin']);
    expect(plugins.every((p) => p.loaded === true)).toBe(true);
    const ttr = plugins.find((p) => p.id === 'time-to-ready.reaplugin');
    expect(ttr).toMatchObject({ name: 'Time To Ready', version: '1.0.4', apiVersion: 1 });
    expect(mock.isPluginLoaded('time-to-ready.reaplugin')).toBe(true);
  });

  it('?mockPlugins=none lists every plugin with loaded false', () => {
    const mock = createMockDecaid({ loadedPlugins: [] });
    const plugins = mock.listPlugins();
    expect(plugins).toHaveLength(4);
    expect(plugins.every((p) => p.loaded === false)).toBe(true);
    expect(mock.isPluginLoaded('dye2.reaplugin')).toBe(false);
  });
});

describe('dye2 (D7)', () => {
  it('seeds two recent setups for the first seeded bean, in autoFavourites', () => {
    const mock = createMockDecaid();
    const [firstBean] = mock.listBeans({});
    const firstBatch = mock.listBatches({ beanId: firstBean!.id })[0]!;
    const recents = mock.kvGet('dye2.reaplugin', 'autoFavourites') as Array<Record<string, unknown>>;
    expect(Array.isArray(recents)).toBe(true);
    expect(recents).toHaveLength(2);
    for (const entry of recents) {
      expect(entry.auto).toBe(true);
      expect((entry.snapshot as Record<string, unknown>).beanBatchId).toBe(firstBatch.id);
      expect((entry.workflow as Record<string, unknown>).context).toBeTruthy();
    }
  });

  it('also seeds equipment, baskets and recipes, in their KV_CONTRACT.md shapes', () => {
    const mock = createMockDecaid();
    const [firstBean] = mock.listBeans({});

    const equipment = mock.kvGet('dye2.reaplugin', 'equipment') as Array<Record<string, unknown>>;
    expect(Array.isArray(equipment)).toBe(true);
    expect(equipment.length).toBeGreaterThan(0);
    for (const item of equipment) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(Array.isArray(item.custom)).toBe(true);
      expect(typeof item.createdAt).toBe('string');
    }

    const baskets = mock.kvGet('dye2.reaplugin', 'baskets') as Array<Record<string, unknown>>;
    expect(Array.isArray(baskets)).toBe(true);
    expect(baskets.length).toBeGreaterThan(0);
    expect(['single', 'double', 'triple', 'bottomless', 'other']).toContain(baskets[0]!.size);

    const recipes = mock.kvGet('dye2.reaplugin', 'recipes') as Array<Record<string, unknown>>;
    expect(Array.isArray(recipes)).toBe(true);
    expect(recipes.length).toBeGreaterThan(0);
    expect(recipes[0]).toMatchObject({ beanName: firstBean!.name, showOnStreamlineDashboard: true });
    expect(recipes[0]!.dashboardVariables).toBeTruthy();
  });

  it('seedBeans: false seeds none of DYE2\'s KV keys', () => {
    const mock = createMockDecaid({ seedBeans: false });
    for (const key of ['autoFavourites', 'equipment', 'baskets', 'recipes']) {
      expect(mock.kvGet('dye2.reaplugin', key), key).toBeNull();
    }
  });
});

describe('frames', () => {
  it('connection changes push devices frames, and the scale socket hears status frames', () => {
    const mock = createMockDecaid();
    const devices: DevicesState[] = [];
    const scale: ScaleWsFrame[] = [];
    mock.on('devices', (frame) => devices.push(frame));
    mock.on('scale', (frame) => scale.push(frame));

    mock.setMachineConnected(false);
    expect(devices.at(-1)!.devices.find((d) => d.type === 'machine')!.state).toBe('disconnected');
    expect(devices.at(-1)!.connectionStatus.error).toMatchObject({ kind: 'machineDisconnected', severity: 'warning' });

    mock.setScaleConnected(false);
    expect(scale.at(-1)).toEqual({ status: 'disconnected' });
    mock.setScaleConnected(true);
    expect(scale.at(-2)).toEqual({ status: 'connected' });
    expect(scale.at(-1)).toMatchObject({ weight: 0, weightFlow: 0 });
  });

  it('machine frames are silent while the machine is away', () => {
    const mock = createMockDecaid();
    const frames: unknown[] = [];
    mock.on('machine', (frame) => frames.push(frame));
    mock.setMachineSnapshot({ ...mock.getMachineSnapshot(), pressure: 1 });
    mock.setMachineConnected(false);
    mock.setMachineSnapshot({ ...mock.getMachineSnapshot(), pressure: 2 });
    expect(frames).toHaveLength(1);
  });

  it('raises and clears connection errors for the UI to show', () => {
    const mock = createMockDecaid();
    const error = mock.raiseConnectionError('profileUploadFailed', 'Profile upload failed. Retrying.');
    expect(mock.getDevicesState().connectionStatus.error).toEqual(error);
    expect(error.timestamp).toMatch(/Z$/);
    mock.setConnectionError(null);
    expect(mock.getDevicesState().connectionStatus.error).toBeNull();
  });

  it('counts heartbeats and answers -1 without a machine', () => {
    const mock = createMockDecaid();
    expect(mock.heartbeat()).toEqual({ timeout: 1800 });
    mock.setMachineConnected(false);
    expect(mock.heartbeat()).toEqual({ timeout: -1 });
    expect(mock.heartbeatCount).toBe(2);
  });
});

describe('faults', () => {
  it('serves an injected failure once, matching method and path', () => {
    const mock = createMockDecaid();
    mock.failNext({ method: 'PUT', path: '/api/v1/workflow', status: 503, body: { error: 'Machine unavailable' } });
    expect(mock.takeFault('GET', '/api/v1/workflow')).toBeNull();
    expect(mock.takeFault('PUT', '/api/v1/workflow')).toMatchObject({ status: 503 });
    expect(mock.takeFault('PUT', '/api/v1/workflow')).toBeNull();
  });
});

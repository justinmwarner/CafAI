import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecaidClient } from '../api/client.ts';
import type { Grinder } from '../api/grinders.ts';
import type { ShotUpdateRequest, WireProfile } from '../api/types.ts';
import { TOOL } from '../coach/contract.ts';
import { FAHRENHEIT_HEADING } from '../coach/fahrenheitPrompt.ts';
import { buildSystemPrompt, getTemplate, TEMPLATES } from '../coach/index.ts';
import type { TemperatureUnit } from '../coach/temperature.ts';
import { createFakeDecaid } from '../ui/testing/fakeServices.ts';
import { createApiPort, createCoachPort, createLlmPort, grinderInfo } from './adapters.ts';

const profile = {
  version: '2',
  title: 'Kiambu AA v1',
  notes: '',
  author: 'Decent',
  beverage_type: 'espresso',
  steps: [],
  target_volume: 0,
  target_weight: 50,
  target_volume_count_start: 2,
  tank_temperature: 0,
} as WireProfile;

describe('createApiPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the machine barrier to the client's own origin", async () => {
    const fetch = vi.fn(async () => new Response('null', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const port = createApiPort(createFakeDecaid());
    await expect(port.loadProfileOnMachine(profile)).resolves.toBe('loaded');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/machine/profile',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(profile) }),
    );
  });

  it("writes shot annotations through the client's shot update", async () => {
    const decaid = createFakeDecaid();
    const seen: Array<[string, ShotUpdateRequest]> = [];
    decaid.updateShot = async (id, patch) => {
      seen.push([id, patch]);
      return { id } as Awaited<ReturnType<typeof decaid.updateShot>>;
    };
    const patch: ShotUpdateRequest = {
      annotations: { enjoyment: 6, extras: { cafai: { verdict: 'better', comparedWith: { kind: 'previous', shotId: 'shot-0' } } } },
    };
    await createApiPort(decaid).updateShot('shot-1', patch);
    expect(seen).toEqual([['shot-1', patch]]);
  });

  it("reads the linked grinder from Decaid's grinder library, reduced to its dial (D62)", async () => {
    const niche = {
      id: 'g-niche',
      model: 'Niche Zero',
      burrs: '63 mm conical',
      archived: false,
      settingType: 'numeric',
      settingSmallStep: 0.5,
      settingBigStep: 2,
      createdAt: '2026-09-20T09:12:41.508113',
      updatedAt: '2026-09-28T07:30:05.114862',
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(niche), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(createApiPort(createFakeDecaid()).getGrinder('g-niche')).resolves.toEqual({
      model: 'Niche Zero',
      settingType: 'numeric',
      smallStep: 0.5,
      bigStep: 2,
      values: null,
    });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/api/v1/grinders/g-niche', expect.objectContaining({ method: 'GET' }));
  });

  it('answers null for a grinder Decaid no longer has', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Grinder not found"}', { status: 404 })));
    await expect(createApiPort(createFakeDecaid()).getGrinder('g-gone')).resolves.toBeNull();
  });

  it('throws when Decaid cannot be read, so the engine keeps what it had', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"boom"}', { status: 500 })));
    await expect(createApiPort(createFakeDecaid()).getGrinder('g-niche')).rejects.toThrow();
  });

  it("adds a grinder to Decaid's library, or takes the one Decaid has, reduced to its dial: GET and POST only (D125)", async () => {
    const seen: string[] = [];
    const library: unknown[] = [{ id: 'g-niche', model: 'Niche Zero', archived: false, settingType: 'numeric', settingSmallStep: 0.5 }];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push(`${method} ${new URL(url).pathname}`);
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'g-new', archived: false, ...body }), { status: 201 });
      }
      return new Response(JSON.stringify(library), { status: 200 });
    });
    // The grinder calls sit beside the client and use the global fetch, as getGrinder does.
    vi.stubGlobal('fetch', fetch);
    const port = createApiPort(createFakeDecaid());
    await expect(port.addGrinder({ model: 'niche zero' })).resolves.toEqual({
      id: 'g-niche',
      model: 'Niche Zero',
      burrs: null,
      info: { model: 'Niche Zero', settingType: 'numeric', smallStep: 0.5, bigStep: null, values: null },
      added: false,
    });
    await expect(port.addGrinder({ model: 'Baratza Encore', settingType: 'preset', settingValues: ['1', '2'] })).resolves.toEqual({
      id: 'g-new',
      model: 'Baratza Encore',
      burrs: null,
      info: { model: 'Baratza Encore', settingType: 'preset', smallStep: null, bigStep: null, values: ['1', '2'] },
      added: true,
    });
    expect(seen).toEqual(['GET /api/v1/grinders', 'GET /api/v1/grinders', 'POST /api/v1/grinders']);
  });

  it("only reads Decaid's bean library and adds to it: GET and POST, never PUT or DELETE (D102)", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push(`${method} ${new URL(url).pathname}`);
      if (method === 'POST' && url.endsWith('/batches')) {
        return new Response(JSON.stringify({ id: 'batch-1', beanId: 'bean-1', roastLevel: 'light', frozen: false, archived: false }), { status: 201 });
      }
      if (method === 'POST') {
        return new Response(JSON.stringify({ id: 'bean-1', roaster: 'Square Mile', name: 'Kiambu AA', archived: false }), { status: 201 });
      }
      return new Response('[]', { status: 200 });
    });
    const port = createApiPort(createDecaidClient({ origin: 'http://localhost:8080', fetch: fetch as unknown as typeof globalThis.fetch }));
    await expect(port.listBeans()).resolves.toEqual([]);
    await expect(port.listBatches('bean-1')).resolves.toEqual([]);
    await expect(port.listAllBatches({ includeArchived: true })).resolves.toEqual([]);
    await expect(port.createBean({ roaster: 'Square Mile', name: 'Kiambu AA' })).resolves.toMatchObject({ id: 'bean-1' });
    await expect(port.createBatch('bean-1', { roastLevel: 'light' })).resolves.toMatchObject({ id: 'batch-1', beanId: 'bean-1' });
    expect(seen).toEqual([
      'GET /api/v1/beans',
      'GET /api/v1/beans/bean-1/batches',
      'GET /api/v1/bean-batches',
      'POST /api/v1/beans',
      'POST /api/v1/beans/bean-1/batches',
    ]);
    expect(Object.keys(port).filter((name) => /bean|batch/i.test(name)).sort()).toEqual(['createBatch', 'createBean', 'listAllBatches', 'listBatches', 'listBeans']);
  });

  it("only reads what Decaid's plugins leave: a key of the store and a loaded plugin's endpoint (D103)", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      return new Response(url.includes('/store/') ? '"shot-7"' : '[]', { status: 200 });
    });
    const port = createApiPort(createDecaidClient({ origin: 'http://localhost:8080', fetch: fetch as unknown as typeof globalThis.fetch }));
    await expect(port.readStore('visualizer.reaplugin', 'lastUploadedShot')).resolves.toBe('shot-7');
    await expect(port.getPluginEndpoint('dye2.reaplugin', 'recent-favs')).resolves.toEqual([]);
    expect(seen).toEqual(['GET /api/v1/store/visualizer.reaplugin/lastUploadedShot', 'GET /api/v1/plugins/dye2.reaplugin/recent-favs']);
    expect(Object.keys(port).filter((name) => /store|plugin/i.test(name)).sort()).toEqual(['getPluginEndpoint', 'readStore']);
  });

  it("asks Decaid's rating scale through the client (D101)", async () => {
    const decaid = createFakeDecaid();
    await expect(createApiPort(decaid).probeEnjoymentScale()).resolves.toBe(10);
    expect(decaid.calls.map((call) => call.method)).toEqual(['probeEnjoymentScale']);
  });
});

describe('grinderInfo', () => {
  const base: Grinder = { id: 'g-1', model: 'Grinder', archived: false, settingType: 'numeric' };

  it("keeps a numeric dial's steps and a preset grinder's settings", () => {
    expect(grinderInfo({ ...base, settingSmallStep: 1, settingBigStep: 5 })).toEqual({
      model: 'Grinder',
      settingType: 'numeric',
      smallStep: 1,
      bigStep: 5,
      values: null,
    });
    expect(grinderInfo({ ...base, settingType: 'preset', settingValues: ['1', '2', '3'] })).toEqual({
      model: 'Grinder',
      settingType: 'preset',
      smallStep: null,
      bigStep: null,
      values: ['1', '2', '3'],
    });
  });

  it('drops what cannot move a dial: blank settings, a step of 0, a big step without a small one', () => {
    expect(grinderInfo({ ...base, settingType: 'preset', settingValues: ['1', ' ', '', '2'] }).values).toEqual(['1', '2']);
    expect(grinderInfo({ ...base, settingType: 'preset', settingValues: [' '] })).toMatchObject({ settingType: 'preset', values: null });
    expect(grinderInfo({ ...base, settingSmallStep: 0, settingBigStep: 2 })).toMatchObject({ smallStep: null, bigStep: null });
    expect(grinderInfo({ ...base, settingSmallStep: 0.5, settingBigStep: 0 })).toMatchObject({ smallStep: 0.5, bigStep: null });
    expect(grinderInfo(base)).toEqual({ model: 'Grinder', settingType: 'numeric', smallStep: null, bigStep: null, values: null });
  });
});

describe('createCoachPort', () => {
  const coach = createCoachPort();
  const blooming = getTemplate('blooming-espresso')!;

  it('builds one prompt per temperature unit, and reads the unit for every request (D175)', () => {
    let unit: TemperatureUnit = 'celsius';
    const port = createCoachPort({ temperatureUnit: () => unit });
    const celsius = port.systemPrompt();
    expect(celsius).toBe(buildSystemPrompt(TEMPLATES));
    expect(coach.systemPrompt()).toBe(celsius);
    unit = 'fahrenheit';
    const fahrenheit = port.systemPrompt();
    expect(fahrenheit).toContain(FAHRENHEIT_HEADING);
    expect(port.systemPrompt()).toBe(fahrenheit);
    unit = 'celsius';
    expect(port.systemPrompt()).toBe(celsius);
  });

  it("builds v1 from the dose with the coach's own rules (D57)", () => {
    expect(coach.buildStartingProfile(blooming, 16).target_weight).toBe(45);
    expect(coach.buildStartingProfile(blooming, 18).target_weight).toBe(50);
    // Unknown, or outside 12-25 g: the 18 g reference dose.
    expect(coach.buildStartingProfile(blooming, null).target_weight).toBe(50);
    expect(coach.buildStartingProfile(blooming, 7).target_weight).toBe(50);
  });

  it('says which doses CafAI coaches from', () => {
    expect(coach.knownDose(16)).toBe(16);
    expect(coach.knownDose(7)).toBeNull();
    expect(coach.knownDose(null)).toBeNull();
    expect(coach.referenceDoseG).toBe(18);
    expect(coach.doseRange).toEqual({ min: 12, max: 25 });
  });

  it("gives the roast as the coach reads it (6.1)", () => {
    const today = new Date(2026, 9, 10, 9, 0);
    expect(coach.roastLine('2026-10-01', today, null)).toBe('Roasted 2026-10-01 (9 days ago)');
    expect(coach.roastLine(null, today, null)).toBeNull();
  });

  it("answers get_recent_setups from DYE2's data the engine read, for the bag on screen (6.5)", async () => {
    const setup = {
      kind: 'recent' as const,
      beanBatchId: 'batch-1',
      beanId: null,
      coffeeName: 'Red Brick',
      coffeeRoaster: 'Square Mile',
      profileTitle: 'D-Flow / default',
      grindSetting: '4.2',
      doseG: 18,
      yieldG: 36,
      rpm: null,
      basket: null,
      capturedAt: '2026-10-08',
    };
    // Another coffee's setup, which DYE2 lists too.
    const other = { ...setup, beanBatchId: 'batch-9', coffeeName: 'Kiambu AA', grindSetting: '3.0' };
    const source = { resolve: async () => null };
    const bag = { name: 'Red Brick', roaster: 'Square Mile', decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' };
    const dye2 = { setups: [other, setup], equipment: ['Niche Zero'], baskets: [] };
    const answer = await coach.runQuery(TOOL.getRecentSetups, {}, { source, versions: [], iterations: [], dye2, bag });
    expect(answer.isError).toBe(false);
    expect(JSON.parse(answer.content)).toEqual({
      available: true,
      setups: [
        {
          kind: 'recent',
          sameBatch: true,
          profileTitle: 'D-Flow / default',
          grindSetting: '4.2',
          doseG: 18,
          yieldG: 36,
          rpm: null,
          basket: null,
          date: '2026-10-08',
        },
      ],
      equipment: ['Niche Zero'],
      baskets: [],
    });
  });
});

describe('createLlmPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a bag photo with the coach's model in one request, never retried, so the photo goes once (6.8)", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529 });
      }),
    );
    const port = createLlmPort({ getApiKey: async () => 'sk-ant-test', setApiKey: async () => {}, forgetApiKey: async () => {} });
    const photo = { mediaType: 'image/jpeg' as const, data: '/9j/4AAQ' };
    await expect(port.readBag!({ model: ' ', photo })).rejects.toThrow('Anthropic is overloaded right now.');
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]!);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } });
    expect(body.tools).toBeUndefined();
  });
});

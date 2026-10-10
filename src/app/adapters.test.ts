import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDecaidClient } from '../api/client.ts';
import type { Grinder } from '../api/grinders.ts';
import type { ShotUpdateRequest, WireProfile } from '../api/types.ts';
import { getTemplate } from '../coach/index.ts';
import { createFakeDecaid } from '../ui/testing/fakeServices.ts';
import { createApiPort, createCoachPort, grinderInfo } from './adapters.ts';

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
    const patch: ShotUpdateRequest = { annotations: { enjoyment: 8, extras: { cafai: { stars: 4 } } } };
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
    await expect(port.createBean({ roaster: 'Square Mile', name: 'Kiambu AA' })).resolves.toMatchObject({ id: 'bean-1' });
    await expect(port.createBatch('bean-1', { roastLevel: 'light' })).resolves.toMatchObject({ id: 'batch-1', beanId: 'bean-1' });
    expect(seen).toEqual(['GET /api/v1/beans', 'POST /api/v1/beans', 'POST /api/v1/beans/bean-1/batches']);
    expect(Object.keys(port).filter((name) => /bean|batch/i.test(name)).sort()).toEqual(['createBatch', 'createBean', 'listBeans']);
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
});

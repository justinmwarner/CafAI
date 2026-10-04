import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../../mock/node.ts';
import { createDecaidClient } from './client.ts';
import { getGrinder, grinderSteps, listGrinders, parseGrinder, type Grinder } from './grinders.ts';
import { GatewayError } from './types.ts';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { client: { httpOrigin: 'http://gw:8080' }, fetch: fetchImpl, seen };
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Grinder.toJson() as Decaid sends it: null fields are left out. */
const NICHE = {
  id: '6a1f0c52-3b8e-4d7a-9f21-0c4e8b5d2a17',
  model: 'Niche Zero',
  burrs: '63 mm conical',
  burrSize: 63.0,
  burrType: 'conical',
  archived: false,
  settingType: 'numeric',
  settingSmallStep: 0.5,
  settingBigStep: 2.0,
  createdAt: '2026-09-20T09:00:00.000000',
  updatedAt: '2026-09-28T07:30:00.000000',
};

const ENCORE = {
  id: '0b9d7e3c-5f2a-4c81-a6d4-7e3f1b2c9d08',
  model: 'Baratza Encore ESP',
  archived: false,
  settingType: 'preset',
  settingValues: ['1', '2', '3', '4'],
  createdAt: '2026-09-18T08:00:00.000000',
  updatedAt: '2026-09-18T08:00:00.000000',
};

describe('listGrinders', () => {
  it("reads Decaid's grinder library on the client's origin, with no custom headers", async () => {
    const { client, fetch, seen } = stub(() => reply([NICHE, ENCORE]));
    const grinders = await listGrinders(client, { fetch });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://gw:8080/api/v1/grinders');
    expect(seen[0]!.init?.method).toBe('GET');
    expect(seen[0]!.init?.headers).toBeUndefined();
    expect(grinders.map((g) => g.model)).toEqual(['Niche Zero', 'Baratza Encore ESP']);
    expect(grinders[0]).toEqual(NICHE);
  });

  it('asks for archived grinders only when told to', async () => {
    const { client, fetch, seen } = stub(() => reply([{ ...NICHE, archived: true }]));
    expect(await listGrinders(client, { fetch, includeArchived: true })).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://gw:8080/api/v1/grinders?includeArchived=true');
  });

  it("keeps Decaid's order and leaves out an archived grinder it should not have sent", async () => {
    const { client, fetch } = stub(() => reply([ENCORE, { ...NICHE, archived: true }, NICHE]));
    expect((await listGrinders(client, { fetch })).map((g) => g.id)).toEqual([ENCORE.id, NICHE.id]);
  });

  it('tolerates unknown fields and missing optional ones', async () => {
    const minimal = { id: 'g-2', model: 'Lagom P64' };
    const { client, fetch } = stub(() => reply([{ ...minimal, manufacturer: 'Option-O', rpm: 900, settingRange: [0, 50] }]));
    expect(await listGrinders(client, { fetch })).toEqual([{ id: 'g-2', model: 'Lagom P64', archived: false, settingType: 'numeric' }]);
  });

  it('skips a record without an id or a model, so one odd grinder never hides the rest', async () => {
    const { client, fetch } = stub(() => reply([{ model: 'No id' }, { id: 'g-3' }, { id: '', model: 'Blank id' }, null, 'text', NICHE]));
    expect((await listGrinders(client, { fetch })).map((g) => g.id)).toEqual([NICHE.id]);
  });

  it('reads a body that is not a list as no grinders', async () => {
    const { client, fetch } = stub(() => reply({ grinders: [NICHE] }));
    expect(await listGrinders(client, { fetch })).toEqual([]);
  });

  it("turns a failure into a GatewayError with Decaid's words, and an older Decaid's plain 404 too", async () => {
    const broken = stub(() => reply({ error: 'Exception: database is locked' }, 500));
    const error = await listGrinders(broken.client, { fetch: broken.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 500, message: 'database is locked' });

    const older = stub(() => new Response('Route not found', { status: 404 }));
    await expect(listGrinders(older.client, { fetch: older.fetch })).rejects.toMatchObject({ status: 404 });

    const away = stub(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(listGrinders(away.client, { fetch: away.fetch })).rejects.toMatchObject({ code: 'network' });
  });

  it('trims a trailing slash from the origin', async () => {
    const { fetch, seen } = stub(() => reply([]));
    await listGrinders({ httpOrigin: 'http://gw:8080/' }, { fetch });
    expect(seen[0]!.url).toBe('http://gw:8080/api/v1/grinders');
  });
});

describe('getGrinder', () => {
  it('reads one grinder, its id percent-encoded once', async () => {
    const { client, fetch, seen } = stub(() => reply(NICHE));
    expect(await getGrinder(client, NICHE.id, { fetch })).toEqual(NICHE);
    await getGrinder(client, 'a/b c', { fetch });
    expect(seen.map((s) => s.url)).toEqual([`http://gw:8080/api/v1/grinders/${NICHE.id}`, 'http://gw:8080/api/v1/grinders/a%2Fb%20c']);
  });

  it('is null when Decaid has no grinder with that id (it was deleted)', async () => {
    const { client, fetch } = stub(() => reply({ error: 'Grinder not found' }, 404));
    expect(await getGrinder(client, 'gone', { fetch })).toBeNull();
  });

  it('is null for a record it cannot read, and throws on other failures', async () => {
    const odd = stub(() => reply({ id: 'g-1' }));
    expect(await getGrinder(odd.client, 'g-1', { fetch: odd.fetch })).toBeNull();
    const broken = stub(() => reply({ error: 'boom' }, 500));
    await expect(getGrinder(broken.client, 'g-1', { fetch: broken.fetch })).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('parseGrinder', () => {
  it("reads settingType as Decaid does: 'values' and 'preset' are preset, anything else numeric", () => {
    const parse = (settingType: unknown) => parseGrinder({ id: 'g', model: 'm', settingType })?.settingType;
    expect(parse('preset')).toBe('preset');
    expect(parse('values')).toBe('preset');
    expect(parse('numeric')).toBe('numeric');
    expect(parse('stepless')).toBe('numeric');
    expect(parse(undefined)).toBe('numeric');
    expect(parse(3)).toBe('numeric');
  });

  it('drops optional fields of the wrong type and keeps only text settings', () => {
    const parsed = parseGrinder({
      id: 'g',
      model: 'm',
      burrs: 64,
      burrSize: '64',
      notes: null,
      archived: 'yes',
      settingSmallStep: Number.NaN,
      settingBigStep: 'big',
      settingValues: ['1', 2, '3', null],
      extras: ['not', 'a', 'map'],
    });
    expect(parsed).toEqual({ id: 'g', model: 'm', archived: false, settingType: 'numeric', settingValues: ['1', '3'] });
  });

  it('keeps extras as Decaid sent them', () => {
    expect(parseGrinder({ id: 'g', model: 'm', extras: { dye2: { color: 'red' } } })?.extras).toEqual({ dye2: { color: 'red' } });
  });
});

describe('grinderSteps', () => {
  const grinder = (fields: Partial<Grinder>): Grinder => ({ id: 'g', model: 'm', archived: false, settingType: 'numeric', ...fields });

  it('a numeric grinder with a small step moves in that step, with its big step when Decaid has one', () => {
    expect(grinderSteps(grinder({ settingSmallStep: 0.5, settingBigStep: 2 }))).toEqual({ kind: 'numeric', smallStep: 0.5, bigStep: 2 });
    expect(grinderSteps(grinder({ settingSmallStep: 1 }))).toEqual({ kind: 'numeric', smallStep: 1, bigStep: null });
    expect(grinderSteps(grinder({ settingSmallStep: 1, settingBigStep: 0 }))).toEqual({ kind: 'numeric', smallStep: 1, bigStep: null });
  });

  it('a preset grinder moves along its list of settings', () => {
    expect(grinderSteps(grinder({ settingType: 'preset', settingValues: ['1', ' ', '2'] }))).toEqual({ kind: 'preset', values: ['1', '2'] });
  });

  it('without step data CafAI can only give directions', () => {
    expect(grinderSteps(grinder({}))).toEqual({ kind: 'none' });
    expect(grinderSteps(grinder({ settingSmallStep: 0, settingBigStep: 2 }))).toEqual({ kind: 'none' });
    expect(grinderSteps(grinder({ settingSmallStep: -1 }))).toEqual({ kind: 'none' });
    expect(grinderSteps(grinder({ settingType: 'preset', settingValues: [] }))).toEqual({ kind: 'none' });
    expect(grinderSteps(grinder({ settingType: 'preset', settingSmallStep: 0.5 }))).toEqual({ kind: 'none' });
  });
});

describe('against the mock Decaid', () => {
  const mock = createMockServer();
  const client = createDecaidClient({ origin: 'http://localhost:8080' });

  beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => mock.server.resetHandlers());
  afterAll(() => mock.close());

  it('lists the seeded grinders and reads one by id', async () => {
    const grinders = await listGrinders(client);
    expect(grinders.length).toBeGreaterThanOrEqual(3);
    const kinds = grinders.map((g) => grinderSteps(g).kind);
    expect(kinds).toEqual(expect.arrayContaining(['numeric', 'preset']));
    const first = grinders[0]!;
    expect(await getGrinder(client, first.id)).toEqual(first);
    expect(await getGrinder(client, 'no-such-grinder')).toBeNull();
  });

  it('hides an archived grinder unless asked', async () => {
    const created = mock.state.createGrinder({ model: 'Old grinder' });
    mock.state.updateGrinder(created.id, { archived: true });
    try {
      expect((await listGrinders(client)).map((g) => g.id)).not.toContain(created.id);
      expect((await listGrinders(client, { includeArchived: true })).map((g) => g.id)).toContain(created.id);
    } finally {
      mock.state.deleteGrinder(created.id);
    }
  });
});

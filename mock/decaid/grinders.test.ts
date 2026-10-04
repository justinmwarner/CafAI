import { describe, expect, it } from 'vitest';
import { MockHttpError } from './errors.ts';
import { MOCK_GRINDER_IDS } from './grinders.ts';
import { createMockDecaid } from './state.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

function expectHttpError(run: () => unknown, status: number, body?: Record<string, unknown>) {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected a MockHttpError').toBeInstanceOf(MockHttpError);
  expect((caught as MockHttpError).status).toBe(status);
  if (body) expect((caught as MockHttpError).body).toEqual(body);
}

/** A mock whose data clock moves only when the test says so. */
function steppedMock(options: { seedGrinders?: boolean } = {}) {
  let now = new Date(2026, 9, 4, 8, 0, 0).getTime();
  const mock = createMockDecaid({ seedGrinders: false, ...options, now: () => now });
  return {
    mock,
    tick(ms = 1000) {
      now += ms;
    },
  };
}

describe('seeded grinders', () => {
  it('are three plausible grinders marked as mock data: steps of 0.5, steps of 1 and a short preset list', () => {
    const grinders = createMockDecaid().listGrinders({});
    expect(grinders.map((g) => g.model)).toEqual(['Niche Zero', 'Comandante C40 MK4', 'Baratza Encore ESP']);
    expect(grinders[0]).toMatchObject({ id: MOCK_GRINDER_IDS.nicheZero, settingType: 'numeric', settingSmallStep: 0.5, settingBigStep: 2 });
    expect(grinders[1]).toMatchObject({ id: MOCK_GRINDER_IDS.comandante, settingType: 'numeric', settingSmallStep: 1 });
    expect(grinders[2]).toMatchObject({ id: MOCK_GRINDER_IDS.encore, settingType: 'preset' });
    expect(grinders[2]!.settingValues!.length).toBeGreaterThanOrEqual(5);
    expect(grinders[2]!.settingValues!.length).toBeLessThanOrEqual(20);
    for (const grinder of grinders) {
      expect(grinder.notes).toMatch(/^Mock data/);
      expect(grinder.extras).toEqual({ mockData: true });
      expect(grinder.archived).toBe(false);
      expect(grinder.id).toMatch(UUID);
    }
  });

  it('keep their ids on every start, so a grinder linked in Settings is still there after a reload', () => {
    expect(createMockDecaid().listGrinders({}).map((g) => g.id)).toEqual(createMockDecaid().listGrinders({}).map((g) => g.id));
  });

  it('can be left out (seedGrinders: false)', () => {
    expect(createMockDecaid({ seedGrinders: false }).listGrinders({})).toEqual([]);
  });
});

describe('creating a grinder (POST /api/v1/grinders)', () => {
  it('gets a new UUID, numeric by default, local timestamps, and no null fields', () => {
    const { mock } = steppedMock();
    const created = mock.createGrinder({ model: 'Niche Zero' });
    expect(created).toEqual({
      id: expect.stringMatching(UUID),
      model: 'Niche Zero',
      archived: false,
      settingType: 'numeric',
      createdAt: expect.stringMatching(LOCAL_TIME),
      updatedAt: created.createdAt,
    });
    expect(mock.getGrinder(created.id)).toEqual(created);
  });

  it('keeps every field Decaid knows, in its order, and drops the rest', () => {
    const { mock } = steppedMock();
    const created = mock.createGrinder({
      model: 'Lagom P64',
      manufacturer: 'Option-O',
      burrs: 'SSP High Uniformity',
      burrSize: 64,
      burrType: 'flat',
      notes: 'Upgraded burrs',
      settingType: 'numeric',
      settingSmallStep: 0.25,
      settingBigStep: 1,
      rpmSmallStep: 50,
      rpmBigStep: 200,
      extras: { dye2: { color: 'red' } },
      archived: true,
    });
    expect(Object.keys(created)).toEqual([
      'id',
      'model',
      'burrs',
      'burrSize',
      'burrType',
      'notes',
      'archived',
      'settingType',
      'settingSmallStep',
      'settingBigStep',
      'rpmSmallStep',
      'rpmBigStep',
      'createdAt',
      'updatedAt',
      'extras',
    ]);
    // Grinder.create always starts unarchived.
    expect(created.archived).toBe(false);
  });

  it("reads settingType like Decaid: 'values' is preset, anything unknown is numeric", () => {
    const { mock } = steppedMock();
    expect(mock.createGrinder({ model: 'a', settingType: 'values', settingValues: ['fine', 'coarse'] })).toMatchObject({
      settingType: 'preset',
      settingValues: ['fine', 'coarse'],
    });
    expect(mock.createGrinder({ model: 'b', settingType: 'preset' }).settingType).toBe('preset');
    expect(mock.createGrinder({ model: 'c', settingType: 'stepless' }).settingType).toBe('numeric');
  });

  it('needs a text model and fields of the right type, else 400 with the type error', () => {
    const { mock } = steppedMock();
    expectHttpError(() => mock.createGrinder({}), 400, { error: "type 'Null' is not a subtype of type 'String' in type cast" });
    expectHttpError(() => mock.createGrinder({ model: 5 }), 400, { error: "type 'int' is not a subtype of type 'String' in type cast" });
    expectHttpError(() => mock.createGrinder({ model: 'a', burrSize: '63' }), 400, {
      error: "type 'String' is not a subtype of type 'num?' in type cast",
    });
    expectHttpError(() => mock.createGrinder({ model: 'a', settingType: 2 }), 400, {
      error: "type 'int' is not a subtype of type 'String' in type cast",
    });
    expectHttpError(() => mock.createGrinder({ model: 'a', settingValues: 'fine' }), 400, {
      error: "type 'String' is not a subtype of type 'List<dynamic>?' in type cast",
    });
    expectHttpError(() => mock.createGrinder({ model: 'a', settingValues: ['fine', 2] }), 400, {
      error: "type 'int' is not a subtype of type 'String' in type cast",
    });
    expectHttpError(() => mock.createGrinder({ model: 'a', extras: [] }), 400, {
      error: "type 'List<dynamic>' is not a subtype of type 'Map<String, dynamic>?' in type cast",
    });
    expectHttpError(() => mock.createGrinder([{ model: 'a' }]), 400, {
      error: "type 'List<dynamic>' is not a subtype of type 'Map<String, dynamic>' in type cast",
    });
    expect(mock.listGrinders({})).toEqual([]);
  });
});

describe('updating a grinder (PUT /api/v1/grinders/{id})', () => {
  it('merges shallowly: an omitted field stays, an explicit null clears it, a value replaces it', () => {
    const { mock, tick } = steppedMock();
    const created = mock.createGrinder({ model: 'Niche Zero', notes: 'Original burrs', extras: { a: 1, b: 2 } });
    tick();
    const preserved = mock.updateGrinder(created.id, { burrType: 'conical' });
    expect(preserved).toMatchObject({ notes: 'Original burrs', burrType: 'conical' });
    const cleared = mock.updateGrinder(created.id, { notes: null });
    expect('notes' in cleared).toBe(false);
    const replaced = mock.updateGrinder(created.id, { notes: 'Upgraded burrs', extras: { b: 3 } });
    expect(replaced.notes).toBe('Upgraded burrs');
    expect(replaced.extras, 'extras is replaced, not merged').toEqual({ b: 3 });
  });

  it('keeps the id and createdAt, moves updatedAt, and drops unknown fields', () => {
    const { mock, tick } = steppedMock();
    const created = mock.createGrinder({ model: 'Niche Zero' });
    tick(60_000);
    const updated = mock.updateGrinder(created.id, { id: 'other', createdAt: '2020-01-01T00:00:00.000000', manufacturer: 'Niche', archived: true });
    expect(updated).toMatchObject({ id: created.id, createdAt: created.createdAt, archived: true });
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect('manufacturer' in updated).toBe(false);
  });

  it('rejects nulls for model, archived and settingType and wrong types, and changes nothing', () => {
    const { mock } = steppedMock();
    const created = mock.createGrinder({
      model: 'Niche Zero',
      burrSize: 63,
      settingValues: ['Fine', 'Coarse'],
      settingSmallStep: 0.1,
      settingBigStep: 1,
      rpmSmallStep: 10,
      rpmBigStep: 100,
    });
    for (const field of ['model', 'archived', 'settingType']) {
      expectHttpError(() => mock.updateGrinder(created.id, { [field]: null }), 400, { error: `FormatException: Field "${field}" cannot be null` });
    }
    for (const field of ['burrSize', 'settingSmallStep', 'settingBigStep', 'rpmSmallStep', 'rpmBigStep']) {
      expectHttpError(() => mock.updateGrinder(created.id, { [field]: 'oops' }), 400, {
        error: `FormatException: Field "${field}" must be a number or null`,
      });
    }
    expectHttpError(() => mock.updateGrinder(created.id, { settingValues: [1] }), 400, {
      error: 'FormatException: Field "settingValues" must be an array of strings or null',
    });
    expectHttpError(() => mock.updateGrinder(created.id, { model: 7 }), 400, { error: "type 'int' is not a subtype of type 'String' in type cast" });
    expectHttpError(() => mock.updateGrinder(created.id, { archived: 'yes' }), 400, {
      error: "type 'String' is not a subtype of type 'bool?' in type cast",
    });
    expectHttpError(() => mock.updateGrinder(created.id, []), 400);
    expect(mock.getGrinder(created.id)).toEqual(created);
  });

  it('is a 404 for an unknown grinder', () => {
    const { mock } = steppedMock();
    expectHttpError(() => mock.updateGrinder('nope', { model: 'x' }), 404, { error: 'Grinder not found' });
    expectHttpError(() => mock.getGrinder('nope'), 404, { error: 'Grinder not found' });
  });
});

describe('listing and deleting', () => {
  it('hides archived grinders unless includeArchived is "true", newest edit first', () => {
    const { mock, tick } = steppedMock();
    const a = mock.createGrinder({ model: 'A' });
    tick();
    const b = mock.createGrinder({ model: 'B' });
    tick();
    expect(mock.listGrinders({}).map((g) => g.model)).toEqual(['B', 'A']);
    mock.updateGrinder(a.id, { notes: 'edited' });
    expect(mock.listGrinders({}).map((g) => g.model)).toEqual(['A', 'B']);
    tick();
    mock.updateGrinder(b.id, { archived: true });
    expect(mock.listGrinders({}).map((g) => g.model)).toEqual(['A']);
    expect(mock.listGrinders({ includeArchived: 'false' }).map((g) => g.model)).toEqual(['A']);
    expect(mock.listGrinders({ includeArchived: 'true' }).map((g) => g.model)).toEqual(['B', 'A']);
    expect(mock.listGrinders({ includeArchived: true }).map((g) => g.model)).toEqual(['B', 'A']);
  });

  it('deletes for good, and answers success even for an unknown id', () => {
    const { mock } = steppedMock();
    const created = mock.createGrinder({ model: 'Niche Zero' });
    expect(mock.deleteGrinder(created.id)).toEqual({ success: true, id: created.id });
    expect(mock.listGrinders({ includeArchived: true })).toEqual([]);
    expectHttpError(() => mock.getGrinder(created.id), 404);
    expect(mock.deleteGrinder('never-was')).toEqual({ success: true, id: 'never-was' });
  });

  it('returns copies, so a caller cannot change the stored grinder', () => {
    const { mock } = steppedMock();
    const created = mock.createGrinder({ model: 'Niche Zero', settingValues: ['1'] });
    mock.getGrinder(created.id).settingValues!.push('2');
    mock.listGrinders({})[0]!.model = 'changed';
    expect(mock.getGrinder(created.id)).toEqual(created);
  });
});

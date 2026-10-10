import { describe, expect, it } from 'vitest';
import { MockHttpError } from './errors.ts';
import { MOCK_BATCH_IDS, MOCK_BEAN_IDS, seedBeans } from './beans.ts';
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
  return caught as MockHttpError;
}

/** A mock whose data clock moves only when the test says so. */
function steppedMock(options: Parameters<typeof createMockDecaid>[0] = {}) {
  let now = new Date(2026, 9, 9, 8, 0, 0).getTime();
  const mock = createMockDecaid({ ...options, now: () => now });
  return {
    mock,
    tick(ms = 1000) {
      now += ms;
    },
  };
}

describe('seedBeans', () => {
  it('seeds two beans with real UUIDs, one batch each', () => {
    const { beans, batches } = seedBeans(Date.now());
    expect(beans).toHaveLength(2);
    expect(batches).toHaveLength(2);
    for (const bean of beans) expect(bean.id).toMatch(UUID);
    for (const batch of batches) expect(batch.id).toMatch(UUID);
    expect(batches[0]!.beanId).toBe(beans[0]!.id);
    expect(batches[1]!.beanId).toBe(beans[1]!.id);
  });

  it('roasts the first batch 9 days before the clock, unfrozen', () => {
    const now = Date.UTC(2026, 9, 9, 8, 0, 0);
    const { batches } = seedBeans(now);
    const batch = batches[0]!;
    const roastedMs = new Date(batch.roastDate!).getTime();
    expect(Math.round((now - roastedMs) / (24 * 60 * 60 * 1000))).toBe(9);
    expect(batch.frozen).toBe(false);
    expect(batch.freezeDate).toBeUndefined();
  });

  it('roasts the second batch 30 days before the clock, frozen for 12 of those days', () => {
    const now = Date.UTC(2026, 9, 9, 8, 0, 0);
    const { batches } = seedBeans(now);
    const batch = batches[1]!;
    const roastedMs = new Date(batch.roastDate!).getTime();
    expect(Math.round((now - roastedMs) / (24 * 60 * 60 * 1000))).toBe(30);
    expect(batch.frozen).toBe(false);
    const frozenMs = new Date(batch.freezeDate!).getTime();
    const unfrozenMs = new Date(batch.unfreezeDate!).getTime();
    expect(Math.round((unfrozenMs - frozenMs) / (24 * 60 * 60 * 1000))).toBe(12);
  });

  it('has fixed ids, so a link in CafAI survives a reload', () => {
    const { beans, batches } = seedBeans(Date.now());
    expect(beans.map((b) => b.id)).toEqual([MOCK_BEAN_IDS.squareMile, MOCK_BEAN_IDS.heartCoffee]);
    expect(batches.map((b) => b.id)).toEqual([MOCK_BATCH_IDS.squareMileBatch, MOCK_BATCH_IDS.heartCoffeeBatch]);
  });
});

describe('the mock bean library (D4)', () => {
  it('seeds the two beans by default, unarchived', () => {
    const mock = createMockDecaid();
    const beans = mock.listBeans({});
    expect(beans).toHaveLength(2);
    expect(beans.every((bean) => bean.archived === false)).toBe(true);
  });

  it('seedBeans: false starts with an empty library', () => {
    const mock = createMockDecaid({ seedBeans: false });
    expect(mock.listBeans({})).toEqual([]);
    expect(mock.listBatches({})).toEqual([]);
  });

  it('getBean/getBatch 404 for an unknown id', () => {
    const mock = createMockDecaid({ seedBeans: false });
    expectHttpError(() => mock.getBean('nope'), 404, { error: 'Bean not found' });
    expectHttpError(() => mock.getBatch('nope'), 404, { error: 'Batch not found' });
  });

  it('creates a bean with a real UUID and the given fields, archived false', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick', country: 'Brazil', processing: 'natural' });
    expect(bean.id).toMatch(UUID);
    expect(bean).toMatchObject({ roaster: 'Square Mile', name: 'Red Brick', country: 'Brazil', processing: 'natural', decaf: false, archived: false });
    expect(bean.createdAt).toBe(bean.updatedAt);
    expect(mock.getBean(bean.id)).toEqual(bean);
  });

  it('POST a bean missing roaster or name is a 400 cast error, like Decaid', () => {
    const { mock } = steppedMock({ seedBeans: false });
    expectHttpError(() => mock.createBean({ name: 'Red Brick' }), 400, {
      error: "type 'Null' is not a subtype of type 'String' in type cast",
    });
    expectHttpError(() => mock.createBean({ roaster: 'Square Mile' }), 400, {
      error: "type 'Null' is not a subtype of type 'String' in type cast",
    });
  });

  it('PUT merges over the existing bean and bumps updatedAt', () => {
    const { mock, tick } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    tick();
    const updated = mock.updateBean(bean.id, { notes: 'Nice and fruity', country: 'Brazil' });
    expect(updated).toMatchObject({ roaster: 'Square Mile', name: 'Red Brick', notes: 'Nice and fruity', country: 'Brazil' });
    expect(updated.createdAt).toBe(bean.createdAt);
    expect(updated.updatedAt).not.toBe(bean.updatedAt);
  });

  it('PUT with an explicit null on roaster is a 400 FormatException', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    expectHttpError(() => mock.updateBean(bean.id, { roaster: null }), 400, { error: 'FormatException: Field "roaster" cannot be null' });
  });

  it('PUT can archive a bean', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    const archived = mock.updateBean(bean.id, { archived: true });
    expect(archived.archived).toBe(true);
    expect(mock.listBeans({})).toEqual([]);
    expect(mock.listBeans({ includeArchived: 'true' })).toHaveLength(1);
  });

  it('creates a batch under a bean, weightRemaining defaulting to weight', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    const batch = mock.createBatch(bean.id, { roastDate: '2026-09-30', roastLevel: 'medium', weight: 250 });
    expect(batch.id).toMatch(UUID);
    expect(batch.beanId).toBe(bean.id);
    expect(batch.roastLevel).toBe('medium');
    expect(batch.weight).toBe(250);
    expect(batch.weightRemaining).toBe(250);
    expect(batch.frozen).toBe(false);
    expect(batch.archived).toBe(false);
    // Local, no zone, like Dart's toIso8601String of a local DateTime (a zone-less input).
    expect(batch.roastDate).toMatch(LOCAL_TIME);
    expect(batch.roastDate).toMatch(/^2026-09-30T00:00:00/);
  });

  it('keeps an explicit zone (e.g. "Z") when the client sends one, instead of reinterpreting it as local', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    const batch = mock.createBatch(bean.id, { roastDate: '2026-02-28T00:00:00Z' });
    expect(batch.roastDate).toBe('2026-02-28T00:00:00.000000Z');
  });

  it('rejects a batch for an unknown bean id with 400 (BeanBatches.beanId is a foreign key)', () => {
    const { mock } = steppedMock({ seedBeans: false });
    expectHttpError(() => mock.createBatch('no-such-bean', { roastLevel: 'light' }), 400, {
      error: 'SqliteException(787): FOREIGN KEY constraint failed, FOREIGN KEY constraint failed (code 787)',
    });
  });

  it('PUT a batch can archive it, and rejects an explicit null frozen', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    const batch = mock.createBatch(bean.id, {});
    const archived = mock.updateBatch(batch.id, { archived: true });
    expect(archived.archived).toBe(true);
    expectHttpError(() => mock.updateBatch(batch.id, { frozen: null }), 400, { error: 'FormatException: Field "frozen" cannot be null' });
  });

  it('PUT a batch rejects a non-number qualityScore/price/weight', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const bean = mock.createBean({ roaster: 'Square Mile', name: 'Red Brick' });
    const batch = mock.createBatch(bean.id, {});
    expectHttpError(() => mock.updateBatch(batch.id, { price: 'free' }), 400, { error: 'FormatException: Field "price" must be a number or null' });
  });

  it('listBatches filters by beanId, and omitting it lists every batch', () => {
    const { mock } = steppedMock({ seedBeans: false });
    const beanA = mock.createBean({ roaster: 'A', name: 'A' });
    const beanB = mock.createBean({ roaster: 'B', name: 'B' });
    mock.createBatch(beanA.id, {});
    mock.createBatch(beanB.id, {});
    expect(mock.listBatches({ beanId: beanA.id })).toHaveLength(1);
    expect(mock.listBatches({})).toHaveLength(2);
  });
});

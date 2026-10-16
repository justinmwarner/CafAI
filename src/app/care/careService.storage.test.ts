/**
 * The care count against CafAI's real storage (fake-indexeddb): its writes
 * are compare-and-set, so whatever lands while a count is on its way to
 * write (a mark, a cycle seen, a restore's merge, an import, another tab)
 * is never written over by what the count saw (D185, D189). Each test holds
 * the count's write back, as a slow tablet's durable write would.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GatewayError, type MachineFrame, type PaginatedShots, type ShotRecordSummary } from '../../api/types.ts';
import { createIdbStorage, type IdbStorage } from '../../storage/index.ts';
import { createMemoryKv, type MemoryKv } from '../../storage/testing/memoryKv.ts';
import { MODEL, uniqueDbName } from '../../storage/testing/fixtures.ts';
import type { CareChange, CareRecord, CareRepository } from '../../storage/types.ts';
import { createFakeTelemetry, IDLE_TELEMETRY } from '../../ui/testing/fakeServices.ts';
import { TRACKED_STEPS } from './careRules.ts';
import { createCareService, MIN_COUNT_GAP_MS, type CareService, type CareTimers } from './careService.ts';
import { CYCLE_MIN_MS } from './cycleWatch.ts';

const opened: IdbStorage[] = [];
const services: CareService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  for (const storage of opened.splice(0)) storage.close();
});

async function open(kv: MemoryKv): Promise<IdbStorage> {
  const storage = await createIdbStorage({ kv, appVersion: '9.9.9', defaultModel: MODEL, dbName: uniqueDbName(), careDbName: uniqueDbName('care'), secretsDbName: uniqueDbName('secrets') });
  opened.push(storage);
  return storage;
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Decaid's local time, no zone, as it writes a record's start. */
function local(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}000`;
}

/** A Decaid with `shots` shots and one steam, the newest an hour before START, or none that answers while `away`. */
function decaidOf(state: { away: boolean; shots: number }) {
  const network = (path: string) => new GatewayError(0, path, 'Could not reach Decaid.', 'network');
  const newest = (): ShotRecordSummary => ({ id: `shot-${state.shots}`, timestamp: local(START - 3_600_000), createdAt: '', updatedAt: '', workflow: {} as ShotRecordSummary['workflow'] });
  return {
    async listShots(): Promise<PaginatedShots> {
      if (state.away) throw network('/api/v1/shots');
      return { items: state.shots > 0 ? [newest()] : [], total: state.shots, limit: 1, offset: 0 };
    },
    async getLatestShot(): Promise<ShotRecordSummary | null> {
      if (state.away) throw network('/api/v1/shots/latest');
      return state.shots > 0 ? newest() : null;
    },
    async listSteamIds(): Promise<string[]> {
      if (state.away) throw network('/api/v1/steams/ids');
      return ['steam-1'];
    },
    async getLatestSteam() {
      if (state.away) throw network('/api/v1/steams/latest');
      return { id: 'steam-1', timestamp: local(START - 7_200_000) };
    },
  };
}

/** The repository with its next update held back until released. */
function holding(care: CareRepository) {
  let hold: { reached: () => void; released: Promise<void> } | null = null;
  let release: () => void = () => undefined;
  const held: CareRepository = {
    list: () => care.list(),
    put: (record) => care.put(record),
    async update(changes: ReadonlyMap<string, CareChange>) {
      const current = hold;
      hold = null;
      if (current) {
        current.reached();
        await current.released;
      }
      return care.update(changes);
    },
  };
  return {
    care: held,
    /** Hold the next update; resolves once it is reached. */
    holdNext: () =>
      new Promise<void>((reached) => {
        const released = new Promise<void>((resolve) => (release = resolve));
        hold = { reached, released };
      }),
    release: () => release(),
  };
}

const START = Date.parse('2026-10-15T08:00:00.000Z');
const never: CareTimers = { setTimeout: () => 0, clearTimeout: () => undefined };
const DESCALE_IN_MAY: CareRecord = {
  id: 'descale',
  doneAt: '2026-05-01T08:00:00.000Z',
  by: 'tick',
  countFrom: '2026-05-01T08:00:00.000Z',
  shotTotal: 50,
  steamTotal: 1,
  updatedAt: '2026-05-01T08:00:00.000Z',
};

/** A fresh device whose first look came while Decaid did not answer: every step's record, with no totals. */
async function firstLookWithDecaidAway(kv = createMemoryKv(), storage?: IdbStorage) {
  const store = storage ?? (await open(kv));
  const clock = { t: START };
  const decaid = { away: true, shots: 200 };
  const held = holding(store.care);
  const telemetry = createFakeTelemetry();
  const service = createCareService({ storage: { care: held.care, settings: store.settings }, decaid: decaidOf(decaid), telemetry, now: () => clock.t, timers: never });
  services.push(service);
  await service.start();
  await waitFor(async () => (await store.care.list()).length === TRACKED_STEPS.length, 'the first look');
  return { storage: store, clock, decaid, held, service, telemetry };
}

/** Decaid answers again: the next count fills every step's totals, and is held on its way to write them. */
async function countHeldAtItsWrite(setup: Awaited<ReturnType<typeof firstLookWithDecaidAway>>): Promise<void> {
  setup.decaid.away = false;
  const reached = setup.held.holdNext();
  setup.clock.t += MIN_COUNT_GAP_MS;
  setup.service.refresh();
  await reached;
}

const stored = async (storage: IdbStorage, id: string) => (await storage.care.list()).find((record) => record.id === id);

describe('a count on its way to write', () => {
  it("keeps what a restore's merge brought meanwhile: in storage, on screen and in Decaid's backup", async () => {
    const kv = createMemoryKv();
    const setup = await firstLookWithDecaidAway(kv);
    await countHeldAtItsWrite(setup);

    // Decaid's backup comes back, as the late restore would bring it: the descale was done in May.
    const file = await setup.storage.porter.exportAll();
    expect(await setup.storage.porter.importAll({ ...file, care: [DESCALE_IN_MAY] }, 'merge')).toMatchObject({ imported: 1 });
    setup.held.release();
    await waitFor(() => setup.service.getState().records.get('transport')?.shotTotal === 200, 'the count');

    expect(await stored(setup.storage, 'descale')).toEqual(DESCALE_IN_MAY);
    // On screen too, before any reload: the step takes the record the store holds.
    expect(setup.service.getState().records.get('descale')).toEqual(DESCALE_IN_MAY);
    // The other steps took their totals.
    expect((await stored(setup.storage, 'rinza'))?.shotTotal).toBe(200);
    await setup.storage.mirror.pushNow();
    expect((kv.values()['care'] as CareRecord[]).find((record) => record.id === 'descale')).toEqual(DESCALE_IN_MAY);
  });

  it('keeps a step marked done meanwhile, in storage and on screen', async () => {
    const setup = await firstLookWithDecaidAway();
    await countHeldAtItsWrite(setup);
    await setup.service.markDone('descale');
    expect((await stored(setup.storage, 'descale'))?.by).toBe('tick');
    setup.held.release();
    await waitFor(() => setup.service.getState().records.get('transport')?.shotTotal === 200, 'the count');
    expect(await stored(setup.storage, 'descale')).toMatchObject({ by: 'tick', doneAt: new Date(START + MIN_COUNT_GAP_MS).toISOString() });
    expect(setup.service.getState().records.get('descale')).toMatchObject({ by: 'tick' });
    expect(setup.service.getState().undoable.has('descale')).toBe(true);
  });

  it("keeps another tab's mark, and this tab shows it at once", async () => {
    const setup = await firstLookWithDecaidAway();
    // A second tab on the same device, over the same storage.
    const other = createCareService({ storage: setup.storage, decaid: decaidOf({ away: false, shots: 200 }), telemetry: createFakeTelemetry(), now: () => setup.clock.t, timers: never });
    services.push(other);
    await other.start();
    await countHeldAtItsWrite(setup);
    await other.markDone('gasket');
    setup.held.release();
    await waitFor(() => setup.service.getState().records.get('transport')?.shotTotal === 200, 'the count');
    expect(await stored(setup.storage, 'gasket')).toMatchObject({ by: 'tick' });
    expect(setup.service.getState().records.get('gasket')).toMatchObject({ by: 'tick' });
  });

  it("keeps the machine's Clean seen while the first count was on its way to write its first look", async () => {
    const storage = await open(createMemoryKv());
    const clock = { t: START };
    const held = holding(storage.care);
    const telemetry = createFakeTelemetry({ machineConnected: true });
    const reached = held.holdNext();
    const service = createCareService({ storage: { care: held.care, settings: storage.settings }, decaid: decaidOf({ away: false, shots: 5 }), telemetry, now: () => clock.t, timers: never });
    services.push(service);
    await service.start();
    await reached;

    const frame = (state: string): MachineFrame => ({ ...IDLE_TELEMETRY.machine!, timestamp: local(clock.t), state: { state, substate: 'idle' } as MachineFrame['state'] });
    telemetry.setState({ machine: frame('cleaning') });
    clock.t += CYCLE_MIN_MS + 10_000;
    telemetry.setState({ machine: frame('cleaning') });
    clock.t += 1000;
    telemetry.setState({ machine: frame('idle') });
    await waitFor(async () => (await stored(storage, 'detergent-clean'))?.by === 'seen', 'the seen mark');
    held.release();
    await waitFor(async () => (await storage.care.list()).length === TRACKED_STEPS.length, 'the first look');

    expect(await stored(storage, 'detergent-clean')).toMatchObject({ by: 'seen' });
    await waitFor(() => service.getState().records.size === TRACKED_STEPS.length, 'the screen');
    expect(service.getState().records.get('detergent-clean')).toMatchObject({ by: 'seen' });
  });
});

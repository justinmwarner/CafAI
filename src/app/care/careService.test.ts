import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, type MachineFrame, type ShotRecordSummary } from '../../api/types.ts';
import { createFakeDecaid, createFakeStorage, createFakeTelemetry, IDLE_TELEMETRY, type FakeDecaid } from '../../ui/testing/fakeServices.ts';
import type { CareRecord } from '../../storage/types.ts';
import { TRACKED_STEPS, type Totals } from './careRules.ts';
import { AFTER_RUN_MS, createCareService, localTotalsCache, MARK_WAIT_MS, MIN_COUNT_GAP_MS, TOTALS_CACHE_KEY, type TotalsCache } from './careService.ts';
import { CYCLE_MIN_MS } from './cycleWatch.ts';

const START = new Date('2026-10-01T08:00:00.000Z').getTime();

/** A shot in Decaid's list, started at a local time (Decaid writes local times without a zone). */
function shotAt(ms: number): ShotRecordSummary {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000000`;
  return { id: `shot-${ms}`, timestamp, createdAt: '', updatedAt: '', workflow: {} as ShotRecordSummary['workflow'] };
}

function decaidWith(shots: number, steams: number): FakeDecaid {
  const decaid = createFakeDecaid();
  setTotals(decaid, shots, steams, START - 60_000);
  return decaid;
}

function setTotals(decaid: FakeDecaid, shots: number, steams: number, newestMs: number): void {
  decaid.shotPage = { items: shots > 0 ? [shotAt(newestMs)] : [], total: shots, limit: 1, offset: 0 };
  decaid.steams = { ids: Array.from({ length: steams }, (_, i) => `steam-${i}`), latest: steams > 0 ? { id: 'steam-0', timestamp: shotAt(newestMs).timestamp } : null };
}

function memoryCache(initial: Totals | null = null): TotalsCache & { saved: Totals | null } {
  const cache = {
    saved: initial,
    load: () => cache.saved,
    save(totals: Totals) {
      cache.saved = totals;
    },
  };
  return cache;
}

function setup(options: { shots?: number; steams?: number; seed?: CareRecord[]; cache?: Totals | null } = {}) {
  const decaid = decaidWith(options.shots ?? 100, options.steams ?? 30);
  const storage = createFakeStorage({ care: options.seed ?? [] });
  const telemetry = createFakeTelemetry();
  const cache = memoryCache(options.cache ?? null);
  const care = createCareService({ storage, decaid, telemetry, cache });
  return { decaid, storage, telemetry, cache, care };
}

const machine = (state: string): MachineFrame => ({ ...IDLE_TELEMETRY.machine!, state: { state, substate: 'idle' } });
const counts = (decaid: FakeDecaid) => decaid.calls.filter((call) => call.method === 'listShots').length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe('start and counting (D185, D190)', () => {
  it('reads the records and settings, then counts: each step is counted from now, with Decaid’s totals then', async () => {
    const { care, storage, cache, decaid } = setup();
    expect(care.getState().ready).toBe(false);
    await care.start();
    expect(care.getState().ready).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const records = await storage.care.list();
    expect(records.map((record) => record.id).sort()).toEqual([...TRACKED_STEPS].sort());
    expect(records.every((record) => record.doneAt === null && record.countFrom === '2026-10-01T08:00:00.000Z')).toBe(true);
    expect(records.every((record) => record.shotTotal === 100 && record.steamTotal === 30)).toBe(true);
    expect(care.getState().totals).toMatchObject({ shots: 100, steams: 30 });
    expect(cache.saved).toMatchObject({ shots: 100, steams: 30 });
    // One request for each total, the shots' page of one.
    expect(decaid.calls.filter((call) => call.method === 'listShots').map((call) => call.args[0])).toEqual([{ limit: 1 }]);
    care.dispose();
  });

  it('has the totals kept on this device from its first moment, before Decaid answers', () => {
    const { care } = setup({ cache: { shots: 90, steams: 20, newestShotMs: null, newestSteamMs: null } });
    expect(care.getState().totals).toMatchObject({ shots: 90, steams: 20 });
    care.dispose();
  });

  it('counts again 5 s after a shot ends, and after a steam', async () => {
    const { care, decaid, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    setTotals(decaid, 101, 30, START + 1000);
    telemetry.emitShot({ type: 'finished', shotId: 's', stopReason: null });
    await vi.advanceTimersByTimeAsync(AFTER_RUN_MS - 1);
    expect(counts(decaid)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(counts(decaid)).toBe(2);
    expect(care.getState().totals.shots).toBe(101);

    telemetry.setState({ machine: machine('steam') });
    telemetry.setState({ machine: machine('idle') });
    await vi.advanceTimersByTimeAsync(AFTER_RUN_MS);
    expect(counts(decaid)).toBe(3);
    care.dispose();
  });

  it('counts at most once every 10 s when asked, and never while a shot runs', async () => {
    const { care, decaid, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    care.refresh();
    care.refresh();
    expect(counts(decaid)).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(counts(decaid)).toBe(2);

    telemetry.setState({ machine: machine('espresso') });
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    care.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(counts(decaid)).toBe(2);
    care.dispose();
  });

  it('a total that fell starts the count again, and is written', async () => {
    const seed = TRACKED_STEPS.map((id) => ({ id, doneAt: null, by: null, countFrom: '2026-09-01T08:00:00.000Z', shotTotal: 120, steamTotal: 30, updatedAt: '2026-09-01T08:00:00.000Z' }));
    const { care, storage } = setup({ seed, shots: 80 });
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect((await storage.care.list()).every((record) => record.shotTotal === 80 && record.countFrom === '2026-09-01T08:00:00.000Z')).toBe(true);
    care.dispose();
  });

  it('a Decaid without steam records (404) counts the shots, leaves the steams unknown and asks no more', async () => {
    const { care, decaid } = setup();
    decaid.failNext('listSteamIds', new GatewayError(404, '/api/v1/steams/ids', 'Decaid answered HTTP 404 for /api/v1/steams/ids.'));
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().totals).toMatchObject({ shots: 100, steams: null });
    expect(care.getState().records.get('rinza')?.steamTotal).toBeNull();
    care.refresh();
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(decaid.calls.filter((call) => call.method === 'listSteamIds')).toHaveLength(1);
    care.dispose();
  });

  it('records it could not read are left alone: no first record is written over them', async () => {
    const { care, storage } = setup();
    vi.spyOn(storage.care, 'list').mockRejectedValueOnce(new Error('superseded'));
    const put = vi.spyOn(storage.care, 'put');
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState()).toMatchObject({ ready: true });
    expect(care.getState().totals.shots).toBe(100);
    expect(put).not.toHaveBeenCalled();
    // Read again (an import, a restore): counted as usual.
    await care.reload();
    care.refresh();
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(put).toHaveBeenCalledTimes(TRACKED_STEPS.length);
    care.dispose();
  });

  it('a Decaid that does not answer leaves the last totals, and records counted from now with none', async () => {
    const { care, decaid, storage } = setup({ cache: { shots: 90, steams: 20, newestShotMs: null, newestSteamMs: null } });
    decaid.failNext('listShots', new GatewayError(0, '/api/v1/shots', 'Could not reach Decaid.', 'network'));
    decaid.failNext('listSteamIds', new GatewayError(0, '/api/v1/steams/ids', 'Could not reach Decaid.', 'network'));
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().totals).toMatchObject({ shots: 90, steams: 20 });
    expect((await storage.care.list()).every((record) => record.shotTotal === null && record.steamTotal === null)).toBe(true);
    // Decaid back: the baselines are filled from its totals then.
    care.refresh();
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect((await storage.care.list()).every((record) => record.shotTotal === 100 && record.steamTotal === 30)).toBe(true);
    care.dispose();
  });
});

describe('Mark done and Undo (D186)', () => {
  it('a mark is now, with Decaid’s totals now; Undo puts back the record it replaced', async () => {
    const { care, decaid, storage } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = care.getState().records.get('detergent-clean');
    vi.setSystemTime(START + 9 * 86_400_000);
    setTotals(decaid, 141, 30, START + 8 * 86_400_000);
    const marking = care.markDone('detergent-clean');
    expect(care.getState().marking).toBe('detergent-clean');
    await marking;
    const marked = care.getState().records.get('detergent-clean');
    expect(marked).toMatchObject({ doneAt: '2026-10-10T08:00:00.000Z', by: 'tick', countFrom: '2026-10-10T08:00:00.000Z', shotTotal: 141, steamTotal: 30 });
    expect((await storage.care.list()).find((record) => record.id === 'detergent-clean')).toEqual(marked);
    expect(care.getState()).toMatchObject({ marking: null });
    expect(care.getState().undoable.has('detergent-clean')).toBe(true);

    await care.undo('detergent-clean');
    expect(care.getState().records.get('detergent-clean')).toMatchObject({ ...first, updatedAt: '2026-10-10T08:00:00.000Z' });
    expect(care.getState().undoable.size).toBe(0);
    care.dispose();
  });

  it('a mark Decaid does not answer within 3 s takes the last totals known', async () => {
    const { care, decaid } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    decaid.listShots = () => new Promise(() => undefined);
    const marking = care.markDone('rinza');
    await vi.advanceTimersByTimeAsync(MARK_WAIT_MS);
    await marking;
    expect(care.getState().records.get('rinza')).toMatchObject({ by: 'tick', shotTotal: 100, steamTotal: 30 });
    care.dispose();
  });

  it('a mark made while a count runs is kept, not what the count saw', async () => {
    const { care, decaid } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    // Shots deleted in Decaid: the count would start every step's count again.
    setTotals(decaid, 80, 30, START);
    let answer: (() => void) | null = null;
    const page = decaid.shotPage;
    decaid.listShots = () => new Promise((resolve) => (answer = () => resolve(page)));
    vi.setSystemTime(START + MIN_COUNT_GAP_MS);
    care.refresh();
    decaid.listShots = async () => page;
    await care.markDone('descale');
    answer!();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().records.get('descale')).toMatchObject({ by: 'tick', shotTotal: 80 });
    expect(care.getState().records.get('rinza')).toMatchObject({ doneAt: null, shotTotal: 80 });
    care.dispose();
  });
});

describe('the machine’s own cycles, seen (D186)', () => {
  it('a Clean seen for a minute, then idle, marks the weekly clean at its last frame, with Undo', async () => {
    const { care, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    telemetry.setState({ machine: machine('cleaning') });
    await vi.advanceTimersByTimeAsync(CYCLE_MIN_MS);
    telemetry.setState({ machine: machine('cleaning') });
    const lastSeen = Date.now();
    await vi.advanceTimersByTimeAsync(1000);
    telemetry.setState({ machine: machine('idle') });
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().records.get('detergent-clean')).toMatchObject({ by: 'seen', doneAt: new Date(lastSeen).toISOString() });
    expect(care.getState().undoable.has('detergent-clean')).toBe(true);
    care.dispose();
  });

  it('one stopped at once, or one the machine left without CafAI seeing it end, marks nothing', async () => {
    const { care, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    telemetry.setState({ machine: machine('descaling') });
    await vi.advanceTimersByTimeAsync(5000);
    telemetry.setState({ machine: machine('idle') });
    telemetry.setState({ machine: machine('descaling') });
    await vi.advanceTimersByTimeAsync(CYCLE_MIN_MS * 2);
    telemetry.setState({ machineConnected: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().records.get('descale')?.doneAt).toBeNull();
    care.dispose();
  });
});

describe('settings and reload (D187)', () => {
  it('a change is kept with the settings, field by field, and read back on start', async () => {
    const { care, storage, decaid, telemetry, cache } = setup();
    await care.start();
    await care.setSettings({ water: 'over120' });
    await care.setSettings({ filter: 'v2' });
    expect(care.getState().settings).toEqual({ water: 'over120', filter: 'v2', reminders: true });
    expect((await storage.settings.get()).care).toEqual({ water: 'over120', filter: 'v2', reminders: true });
    care.dispose();
    const again = createCareService({ storage, decaid, telemetry, cache });
    await again.start();
    expect(again.getState().settings).toEqual({ water: 'over120', filter: 'v2', reminders: true });
    again.dispose();
  });

  it('a reload takes the records an import brought, and forgets what Undo would have put back', async () => {
    const { care, storage } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    await care.markDone('gasket');
    await storage.care.put({ id: 'gasket', doneAt: '2026-09-20T08:00:00.000Z', by: 'tick', countFrom: '2026-09-20T08:00:00.000Z', shotTotal: 50, steamTotal: 10, updatedAt: '2026-09-20T08:00:00.000Z' });
    await care.reload();
    expect(care.getState().records.get('gasket')?.doneAt).toBe('2026-09-20T08:00:00.000Z');
    expect(care.getState().undoable.size).toBe(0);
    care.dispose();
  });
});

describe('localTotalsCache', () => {
  it('keeps the totals under its own key, and reads anything else as none', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
    const cache = localTotalsCache(storage);
    expect(cache.load()).toBeNull();
    cache.save({ shots: 12, steams: null, newestShotMs: 5, newestSteamMs: null });
    expect(JSON.parse(items.get(TOTALS_CACHE_KEY)!)).toEqual({ shots: 12, steams: null, newestShotMs: 5, newestSteamMs: null });
    expect(cache.load()).toEqual({ shots: 12, steams: null, newestShotMs: 5, newestSteamMs: null });
    items.set(TOTALS_CACHE_KEY, '{"shots":-1,"steams":"many"');
    expect(cache.load()).toBeNull();
    items.set(TOTALS_CACHE_KEY, '{"shots":-1,"steams":"many"}');
    expect(cache.load()).toEqual({ shots: null, steams: null, newestShotMs: null, newestSteamMs: null });
    expect(localTotalsCache(null).load()).toBeNull();
  });
});

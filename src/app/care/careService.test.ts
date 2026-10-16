import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, type MachineFrame, type ShotRecordSummary } from '../../api/types.ts';
import { createFakeDecaid, createFakeStorage, createFakeTelemetry, IDLE_TELEMETRY, type FakeDecaid } from '../../ui/testing/fakeServices.ts';
import { DEFAULT_CARE } from '../../storage/settings.ts';
import type { CareRecord } from '../../storage/types.ts';
import { stepStatus, TRACKED_STEPS, type Totals } from './careRules.ts';
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

/** A machine frame, stamped by the machine at `atMs` (now by default), as Decaid writes it: local, no zone. */
const machine = (state: string, atMs = Date.now()): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  timestamp: shotAt(atMs).timestamp,
  state: { state, substate: 'idle' } as MachineFrame['state'],
});
const calls = (decaid: FakeDecaid, method: string) => decaid.calls.filter((call) => call.method === method);
/** Every count asks for Decaid's newest shot first. */
const counts = (decaid: FakeDecaid) => calls(decaid, 'getLatestShot').length;

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
    expect(cache.saved).toMatchObject({ shots: 100, steams: 30, newestShot: { id: `shot-${START - 60_000}` }, newestSteam: { id: 'steam-0' } });
    // Every step keeps Decaid's newest times from then, as Decaid wrote them.
    expect(records.every((record) => record.newestShotAt === shotAt(START - 60_000).timestamp && record.newestSteamAt === shotAt(START - 60_000).timestamp)).toBe(true);
    // The newest of each first; a total only for a newest CafAI has not counted with: the shots' page of one, the steams' ids.
    expect(counts(decaid)).toBe(1);
    expect(calls(decaid, 'getLatestSteam')).toHaveLength(1);
    expect(calls(decaid, 'listShots').map((call) => call.args[0])).toEqual([{ limit: 1 }]);
    expect(calls(decaid, 'listSteamIds')).toHaveLength(1);
    care.dispose();
  });

  it('asks only for the newest shot and steam while neither is new, and for a total once one is (D185)', async () => {
    const { care, decaid } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(START + MIN_COUNT_GAP_MS);
    care.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(counts(decaid)).toBe(2);
    expect(calls(decaid, 'getLatestSteam')).toHaveLength(2);
    expect(calls(decaid, 'listShots')).toHaveLength(1);
    expect(calls(decaid, 'listSteamIds')).toHaveLength(1);

    // A shot pulled: its page of one for the total; the steams' ids are not asked again.
    setTotals(decaid, 101, 30, START + 5000);
    decaid.steams.latest = { id: 'steam-0', timestamp: shotAt(START - 60_000).timestamp };
    vi.setSystemTime(START + 2 * MIN_COUNT_GAP_MS);
    care.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().totals).toMatchObject({ shots: 101, steams: 30 });
    expect(calls(decaid, 'listShots')).toHaveLength(2);
    expect(calls(decaid, 'listSteamIds')).toHaveLength(1);
    care.dispose();
  });

  it('a page that comes back with the newest is the total too, kept across a reload of the page', async () => {
    const first = setup();
    await first.care.start();
    await vi.advanceTimersByTimeAsync(0);
    first.care.dispose();
    // The next page: the same Decaid, nothing new; the totals kept on the device are Decaid's.
    const again = createCareService({ storage: first.storage, decaid: first.decaid, telemetry: first.telemetry, cache: first.cache });
    await again.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(again.getState().totals).toMatchObject({ shots: 100, steams: 30 });
    expect(calls(first.decaid, 'listShots')).toHaveLength(1);
    again.dispose();
  });

  it("counts once at start, not again when Decaid's socket opens just after; again when that count went unanswered", async () => {
    const closed = { ...IDLE_TELEMETRY.sockets, devices: 'closed' as const };
    const open = { ...IDLE_TELEMETRY.sockets, devices: 'open' as const };
    for (const opensWhile of ['counting', 'after'] as const) {
      const decaid = decaidWith(100, 30);
      const telemetry = createFakeTelemetry({ sockets: closed });
      const care = createCareService({ storage: createFakeStorage(), decaid, telemetry, cache: memoryCache() });
      await care.start();
      if (opensWhile === 'after') await vi.advanceTimersByTimeAsync(1000);
      // telemetry.start() opens Decaid's devices socket, with the start's count running or just done.
      telemetry.setState({ sockets: open });
      await vi.advanceTimersByTimeAsync(3 * MIN_COUNT_GAP_MS);
      expect(counts(decaid), opensWhile).toBe(1);
      care.dispose();
    }

    const decaid = decaidWith(100, 30);
    decaid.failNext('getLatestShot', new GatewayError(0, '/api/v1/shots/latest', 'Could not reach Decaid.', 'network'));
    decaid.failNext('getLatestSteam', new GatewayError(0, '/api/v1/steams/latest', 'Could not reach Decaid.', 'network'));
    const telemetry = createFakeTelemetry({ sockets: closed });
    const care = createCareService({ storage: createFakeStorage(), decaid, telemetry, cache: memoryCache() });
    await care.start();
    telemetry.setState({ sockets: open });
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(counts(decaid)).toBe(2);
    expect(care.getState().totals).toMatchObject({ shots: 100, steams: 30 });
    care.dispose();
  });

  it("finds old shots imported among new ones by a page of the newest, and leaves them out of every step's count (D185)", async () => {
    const { care, decaid } = setup({ shots: 150 });
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    // De1app's 2,000 shots imported into Decaid, and one pulled 90 s after the newest CafAI counted with: more than one a minute.
    const pulled = shotAt(START + 30_000);
    const before = Array.from({ length: 19 }, (_, i) => shotAt(START - 60_000 - i * 3_600_000));
    decaid.shotPage = { items: [pulled, ...before], total: 2151, limit: 1, offset: 0 };
    vi.setSystemTime(START + MIN_COUNT_GAP_MS);
    care.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(decaid, 'listShots').map((call) => call.args[0])).toEqual([{ limit: 1 }, { limit: 1 }, { limit: 20 }]);
    const descale = care.getState().records.get('descale')!;
    expect(descale.shotTotal).toBe(2150);
    expect(stepStatus('descale', descale, DEFAULT_CARE, care.getState().totals, Date.now())).toMatchObject({ shots: 1, due: false });
    care.dispose();
  });

  it('a jump one a minute could have pulled is counted with no page; one a page cannot tell stands', async () => {
    for (const [total, newestMs, pages] of [
      // 30 in two hours: pulled.
      [180, START + 2 * 3_600_000, 0],
      // 25 in two minutes, every one of the page's 20 newer than the newest then: it cannot tell.
      [175, START + 60_000, 1],
    ] as const) {
      vi.setSystemTime(START);
      const { care, decaid } = setup({ shots: 150 });
      await care.start();
      await vi.advanceTimersByTimeAsync(0);
      decaid.shotPage = { items: Array.from({ length: 20 }, (_, i) => shotAt(newestMs - i * 1000)), total, limit: 1, offset: 0 };
      vi.setSystemTime(START + MIN_COUNT_GAP_MS);
      care.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(counts(decaid)).toBe(2);
      expect(calls(decaid, 'listShots').filter((call) => (call.args[0] as { limit: number }).limit === 20)).toHaveLength(pages);
      expect(care.getState().totals.shots).toBe(total);
      expect(care.getState().records.get('descale')?.shotTotal).toBe(150);
      care.dispose();
    }
  });

  it('has the totals kept on this device from its first moment, before Decaid answers', () => {
    const { care } = setup({ cache: { shots: 90, steams: 20, newestShot: null, newestSteam: null } });
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
    const seed = TRACKED_STEPS.map((id) => ({
      id,
      doneAt: null,
      by: null,
      countFrom: '2026-09-01T08:00:00.000Z',
      shotTotal: 120,
      steamTotal: 30,
      newestShotAt: null,
      newestSteamAt: null,
      updatedAt: '2026-09-01T08:00:00.000Z',
    }));
    const { care, storage } = setup({ seed, shots: 80 });
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect((await storage.care.list()).every((record) => record.shotTotal === 80 && record.countFrom === '2026-09-01T08:00:00.000Z')).toBe(true);
    care.dispose();
  });

  it('a Decaid without steam records (404) counts the shots, leaves the steams unknown and asks no more', async () => {
    const { care, decaid } = setup();
    decaid.failNext('getLatestSteam', new GatewayError(404, '/api/v1/steams/latest', 'Decaid answered HTTP 404 for /api/v1/steams/latest.'));
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().totals).toMatchObject({ shots: 100, steams: null, newestSteam: null });
    expect(care.getState().records.get('rinza')?.steamTotal).toBeNull();
    care.refresh();
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(calls(decaid, 'getLatestSteam')).toHaveLength(1);
    expect(calls(decaid, 'listSteamIds')).toHaveLength(0);
    care.dispose();
  });

  it('records it could not read are left alone: no first record is written over them', async () => {
    const { care, storage } = setup();
    vi.spyOn(storage.care, 'list').mockRejectedValueOnce(new Error('superseded'));
    const put = vi.spyOn(storage.care, 'put');
    const update = vi.spyOn(storage.care, 'update');
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState()).toMatchObject({ ready: true });
    expect(care.getState().totals.shots).toBe(100);
    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Read again (an import, a restore): counted as usual, every step in one write.
    await care.reload();
    care.refresh();
    await vi.advanceTimersByTimeAsync(MIN_COUNT_GAP_MS);
    expect(update).toHaveBeenCalledTimes(1);
    expect([...update.mock.calls[0]![0].keys()]).toEqual([...TRACKED_STEPS]);
    expect(await storage.care.list()).toHaveLength(TRACKED_STEPS.length);
    care.dispose();
  });

  it('a store that refuses the first look leaves it on screen, counted from now, until the next count', async () => {
    const { care, storage } = setup();
    vi.spyOn(storage.care, 'update').mockRejectedValueOnce(new Error('quota'));
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(await storage.care.list()).toEqual([]);
    expect(care.getState().records.get('descale')).toMatchObject({ doneAt: null, shotTotal: 100, countFrom: '2026-10-01T08:00:00.000Z' });
    care.dispose();
  });

  it('a Decaid that does not answer leaves the last totals, and records counted from now with none', async () => {
    const { care, decaid, storage } = setup({ cache: { shots: 90, steams: 20, newestShot: null, newestSteam: null } });
    decaid.failNext('getLatestShot', new GatewayError(0, '/api/v1/shots/latest', 'Could not reach Decaid.', 'network'));
    decaid.failNext('getLatestSteam', new GatewayError(0, '/api/v1/steams/latest', 'Could not reach Decaid.', 'network'));
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
    decaid.getLatestShot = () => new Promise(() => undefined);
    const marking = care.markDone('rinza');
    await vi.advanceTimersByTimeAsync(MARK_WAIT_MS);
    await marking;
    expect(care.getState().records.get('rinza')).toMatchObject({ by: 'tick', shotTotal: 100, steamTotal: 30 });
    care.dispose();
  });

  it('a mark takes the totals of the count running, rather than asking Decaid again', async () => {
    const { care, decaid } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    setTotals(decaid, 120, 30, START + 5000);
    vi.setSystemTime(START + MIN_COUNT_GAP_MS);
    care.refresh();
    await care.markDone('gasket');
    expect(counts(decaid)).toBe(2);
    expect(care.getState().records.get('gasket')).toMatchObject({ by: 'tick', shotTotal: 120 });
    // And a mark with no count running starts one, at once: the barista asked.
    await vi.advanceTimersByTimeAsync(0);
    await care.markDone('transport');
    expect(counts(decaid)).toBe(3);
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
    // The count is slow: the mark waits 3 s for it, then takes the last totals known.
    const marking = care.markDone('descale');
    await vi.advanceTimersByTimeAsync(MARK_WAIT_MS);
    await marking;
    answer!();
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().records.get('descale')).toMatchObject({ by: 'tick', shotTotal: 100 });
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

  it("is timed by the machine's frames: a Clean stopped after 10 s, its socket dropped and the scale still sending, is no Clean", async () => {
    const { care, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    const started = Date.now();
    telemetry.setState({ machine: machine('cleaning', started) });
    await vi.advanceTimersByTimeAsync(10_000);
    const last = machine('cleaning', started + 10_000);
    telemetry.setState({ machine: last });
    // The machine's socket drops; its last frame stays in the store, and the scale's keep coming for a minute and more.
    telemetry.setState({ sockets: { ...telemetry.getState().sockets, machine: 'closed' } });
    for (let i = 0; i < 70; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      telemetry.setState({ scale: { ...telemetry.getState().scale!, weight: i } });
      // The same stale frame again is no frame.
      telemetry.setState({ machine: last });
    }
    // A frame while the socket is closed (read from REST, say) is not the socket's either.
    telemetry.setState({ machine: machine('cleaning') });
    telemetry.setState({ sockets: { ...telemetry.getState().sockets, machine: 'open' }, machine: machine('idle') });
    await vi.advanceTimersByTimeAsync(0);
    expect(care.getState().records.get('detergent-clean')?.by).toBeNull();
    care.dispose();
  });

  it("counts the minute by the frames' own times, not by when they reached CafAI", async () => {
    const { care, telemetry } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    // A Clean the machine ran for two minutes; CafAI got the frames bunched within 20 s.
    const started = Date.now() - 100_000;
    for (let s = 0; s <= 120; s += 10) {
      telemetry.setState({ machine: machine('cleaning', started + s * 1000) });
      await vi.advanceTimersByTimeAsync(1500);
    }
    const lastSeen = Date.now() - 1500;
    telemetry.setState({ machine: machine('idle', started + 121_000) });
    await vi.advanceTimersByTimeAsync(0);
    // Done when CafAI saw it last running, by its own clock.
    expect(care.getState().records.get('detergent-clean')).toMatchObject({ by: 'seen', doneAt: new Date(lastSeen).toISOString() });
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

  it("sends only what changed, so another tab's answer to another question stays", async () => {
    const { care, storage } = setup();
    await care.start();
    // Another tab answers the filter after this one read the settings.
    await storage.settings.update({ care: { filter: 'v2' } });
    const update = vi.spyOn(storage.settings, 'update');
    await care.setSettings({ water: 'over120' });
    expect(update).toHaveBeenCalledWith({ care: { water: 'over120' } });
    expect((await storage.settings.get()).care).toEqual({ water: 'over120', filter: 'v2', reminders: true });
    care.dispose();
  });

  it('a save that fails late puts back only its own field, to what is saved; a later change stands', async () => {
    const { care, storage } = setup();
    await care.start();
    const update = storage.settings.update.bind(storage.settings);
    let refuse: ((error: Error) => void) | null = null;
    vi.spyOn(storage.settings, 'update').mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)));
    // The water first, its save slow; then the filter, saved at once.
    const water = care.setSettings({ water: 'over120' }).catch((error: unknown) => error);
    await care.setSettings({ filter: 'v2' });
    refuse!(new Error('The disk is full.'));
    expect(await water).toBeInstanceOf(Error);
    expect(care.getState().settings).toEqual({ water: null, filter: 'v2', reminders: true });
    expect((await storage.settings.get()).care).toEqual({ water: null, filter: 'v2', reminders: true });

    // The water changed again while its first save was still on its way: the later answer stands.
    vi.spyOn(storage.settings, 'update').mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)));
    const first = care.setSettings({ water: 'to120' }).catch((error: unknown) => error);
    await care.setSettings({ water: 'under30' });
    refuse!(new Error('The disk is full.'));
    await first;
    expect(care.getState().settings.water).toBe('under30');
    expect((await update({})).care?.water).toBe('under30');
    care.dispose();
  });

  it('a reload takes the records an import brought, and forgets what Undo would have put back', async () => {
    const { care, storage } = setup();
    await care.start();
    await vi.advanceTimersByTimeAsync(0);
    await care.markDone('gasket');
    await storage.care.put({
      id: 'gasket',
      doneAt: '2026-09-20T08:00:00.000Z',
      by: 'tick',
      countFrom: '2026-09-20T08:00:00.000Z',
      shotTotal: 50,
      steamTotal: 10,
      newestShotAt: null,
      newestSteamAt: null,
      updatedAt: '2026-09-20T08:00:00.000Z',
    });
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
    const totals: Totals = { shots: 12, steams: null, newestShot: { id: 'shot-12', at: '2026-10-01T09:00:00.000000' }, newestSteam: null };
    cache.save(totals);
    expect(JSON.parse(items.get(TOTALS_CACHE_KEY)!)).toEqual(totals);
    expect(cache.load()).toEqual(totals);
    items.set(TOTALS_CACHE_KEY, '{"shots":-1,"steams":"many"');
    expect(cache.load()).toBeNull();
    items.set(TOTALS_CACHE_KEY, '{"shots":-1,"steams":"many","newestShot":{"id":"x","at":"y"},"newestSteam":"z"}');
    expect(cache.load()).toEqual({ shots: null, steams: null, newestShot: null, newestSteam: null });
    // As the page before this one kept them: a newest it cannot read is none.
    items.set(TOTALS_CACHE_KEY, '{"shots":5,"steams":2,"newestShotMs":17,"newestSteamMs":null}');
    expect(cache.load()).toEqual({ shots: 5, steams: 2, newestShot: null, newestSteam: null });
    expect(localTotalsCache(null).load()).toBeNull();
  });
});

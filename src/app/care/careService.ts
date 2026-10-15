/**
 * Machine care, live (D-CARE-1 to D-CARE-8): each step's record, Decaid's
 * totals, the water and the filter, and the marks. One per app
 * (createServices.ts); the Care screen, the stats card's line and Settings >
 * Machine care read it (src/ui/care/useCare.ts).
 *
 * - Counting (D-CARE-3): Decaid's shot total and steam total, one request
 *   each, never by paging; at start, 5 s after a shot or a steam ends, when
 *   Decaid answers again, when the page comes back into view and when the
 *   Care screen asks; at most once every 10 s unless a run just ended, never
 *   while a shot runs. A step never counted gets its record, from now
 *   (D-CARE-8); a record's baselines follow the totals (careRules.ts).
 * - Marks (D-CARE-4): Mark done, with Undo until the page reloads, and the
 *   machine's own Clean or Descale seen for a minute, then gone (cycleWatch.ts).
 * - The last totals are kept on this device (TotalsCache), so the stats card
 *   has them at its first paint and while Decaid is away.
 */
import { isShotMachineState } from '../../api/machineStates.ts';
import { parseDecaidTimestamp } from '../../api/time.ts';
import { GatewayError, type DecaidClient, type TelemetryStore } from '../../api/types.ts';
import { DEFAULT_CARE } from '../../storage/settings.ts';
import type { CareMark, CareRecord, CareSettings, Storage } from '../../storage/types.ts';
import { rebaseline, TRACKED_STEPS, UNKNOWN_TOTALS, type Totals, type TrackedStepId } from './careRules.ts';
import { NO_CYCLE, watchCycle, type CycleWatch } from './cycleWatch.ts';

export interface CareState {
  /** The records and the settings are read. */
  ready: boolean;
  /** By the step's id. */
  records: ReadonlyMap<string, CareRecord>;
  settings: CareSettings;
  /** The last totals CafAI read (or kept from an earlier page). */
  totals: Totals;
  /** The steps whose last mark Undo can take back. */
  undoable: ReadonlySet<string>;
  /** The step being marked done, while its totals are read. */
  marking: string | null;
}

export interface CareService {
  getState(): CareState;
  subscribe(listener: () => void): () => void;
  /** Read the records and the settings, then count. */
  start(): Promise<void>;
  /** Count again soon (the Care screen opened). */
  refresh(): void;
  /** Read the records and the settings again: an import or a restore brought new ones. */
  reload(): Promise<void>;
  /** Mark done on the Care screen: its last time is now. */
  markDone(step: TrackedStepId): Promise<void>;
  /** Put back the record a mark replaced, this session. */
  undo(step: TrackedStepId): Promise<void>;
  /** Settings > Machine care: the water, the filter, the stats card's line. */
  setSettings(patch: Partial<CareSettings>): Promise<void>;
  dispose(): void;
}

/** Where the last totals are kept on this device. */
export interface TotalsCache {
  load(): Totals | null;
  save(totals: Totals): void;
}

export interface CareTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CareServiceDeps {
  storage: Pick<Storage, 'care' | 'settings'>;
  decaid: Pick<DecaidClient, 'listShots' | 'listSteamIds' | 'getLatestSteam'>;
  telemetry: TelemetryStore;
  now?: () => number;
  cache?: TotalsCache;
  timers?: CareTimers;
  visibility?: { visible(): boolean; subscribe(listener: () => void): () => void };
}

/** A shot or a steam just ended: Decaid stores it a moment later, then CafAI counts. */
export const AFTER_RUN_MS = 5000;
/** CafAI counts at most this often, unless a run just ended. */
export const MIN_COUNT_GAP_MS = 10_000;
/** How long Mark done waits for Decaid's totals before it takes the last ones known. */
export const MARK_WAIT_MS = 3000;

const browserTimers: CareTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Decaid answered: the newest record's start, or null when there is none or it cannot be read. */
function startMs(timestamp: string | undefined): number | null {
  if (timestamp === undefined) return null;
  const ms = parseDecaidTimestamp(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/** Totals read now, and which of them are fresh (Decaid answered them this time). */
interface Reading {
  totals: Totals;
  fresh: { shots: boolean; steams: boolean };
}

function withDeadline<T>(work: Promise<T>, ms: number, timers: CareTimers): Promise<T | null> {
  return new Promise((resolve) => {
    const handle = timers.setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        timers.clearTimeout(handle);
        resolve(value);
      },
      () => {
        timers.clearTimeout(handle);
        resolve(null);
      },
    );
  });
}

export function createCareService(deps: CareServiceDeps): CareService {
  const now = deps.now ?? (() => Date.now());
  const timers = deps.timers ?? browserTimers;
  const iso = (ms: number) => new Date(ms).toISOString();
  let state: CareState = {
    ready: false,
    records: new Map(),
    settings: DEFAULT_CARE,
    totals: deps.cache?.load() ?? UNKNOWN_TOTALS,
    undoable: new Set(),
    marking: null,
  };
  const listeners = new Set<() => void>();
  /** The record each mark replaced (null: none), by step: what Undo puts back. */
  const before = new Map<string, CareRecord | null>();
  let disposed = false;
  let counting: Promise<void> | null = null;
  let again = false;
  let lastCountMs = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  /** A Decaid without steam records (404, older than the pin): asked no more this session. */
  let noSteams = false;
  let cycle: CycleWatch = NO_CYCLE;
  let steaming = false;
  let reachable = deps.telemetry.getState().sockets.devices === 'open';

  function set(patch: Partial<CareState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  async function readTotals(): Promise<Reading> {
    const previous = state.totals;
    const [page, ids, latest] = await Promise.allSettled([
      deps.decaid.listShots({ limit: 1 }),
      noSteams ? Promise.resolve(null) : deps.decaid.listSteamIds(),
      noSteams ? Promise.resolve(null) : deps.decaid.getLatestSteam(),
    ]);
    const totals: Totals = { ...previous };
    const fresh = { shots: false, steams: false };
    if (page.status === 'fulfilled') {
      // A total smaller than the page it came with is not one CafAI can count from.
      totals.shots = page.value.total >= page.value.items.length ? page.value.total : null;
      totals.newestShotMs = startMs(page.value.items[0]?.timestamp);
      fresh.shots = true;
    }
    if (ids.status === 'rejected' && ids.reason instanceof GatewayError && ids.reason.status === 404) noSteams = true;
    if (noSteams) {
      totals.steams = null;
      totals.newestSteamMs = null;
      fresh.steams = true;
    } else if (ids.status === 'fulfilled' && ids.value !== null) {
      totals.steams = ids.value.length;
      totals.newestSteamMs = latest.status === 'fulfilled' ? startMs(latest.value?.timestamp) : null;
      fresh.steams = true;
    }
    return { totals, fresh };
  }

  function shotRunning(): boolean {
    const telemetry = deps.telemetry.getState();
    return telemetry.machineConnected && isShotMachineState(telemetry.machine?.state.state);
  }

  async function countOnce(): Promise<void> {
    if (!state.ready || disposed) return;
    // A shot's own count comes 5 s after it ends.
    if (shotRunning()) return;
    const seen = state.records;
    const { totals, fresh } = await readTotals();
    if (disposed) return;
    const freshTotals: Totals = {
      shots: fresh.shots ? totals.shots : null,
      steams: fresh.steams ? totals.steams : null,
      newestShotMs: fresh.shots ? totals.newestShotMs : null,
      newestSteamMs: fresh.steams ? totals.newestSteamMs : null,
    };
    const at = iso(now());
    const writes: CareRecord[] = [];
    for (const step of TRACKED_STEPS) {
      const record = seen.get(step);
      if (!record) {
        // Counted from the first look (D-CARE-8).
        writes.push({ id: step, doneAt: null, by: null, countFrom: at, shotTotal: freshTotals.shots, steamTotal: freshTotals.steams, updatedAt: at });
        continue;
      }
      const change = rebaseline(record, freshTotals);
      if (change) writes.push({ ...record, ...change, updatedAt: at });
    }
    // A mark made meanwhile wins over what this count saw.
    const kept = writes.filter((record) => state.records.get(record.id) === seen.get(record.id));
    for (const record of kept) await deps.storage.care.put(record).catch(() => undefined);
    if (disposed) return;
    const records = new Map(state.records);
    for (const record of kept) records.set(record.id, record);
    if (fresh.shots || fresh.steams) deps.cache?.save(totals);
    set({ records, totals });
  }

  function schedule(ms: number): void {
    if (disposed) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      count(true);
    }, ms);
  }

  function count(force = false): void {
    if (disposed) return;
    if (counting) {
      again = true;
      return;
    }
    const wait = force ? 0 : lastCountMs + MIN_COUNT_GAP_MS - now();
    if (wait > 0) {
      if (timer === null) schedule(wait);
      return;
    }
    lastCountMs = now();
    counting = countOnce()
      .catch(() => undefined)
      .finally(() => {
        counting = null;
        if (again) {
          again = false;
          count();
        }
      });
  }

  async function mark(step: TrackedStepId, by: CareMark, atMs: number, totals: Totals): Promise<void> {
    const replaced = state.records.get(step) ?? null;
    const at = iso(atMs);
    const record: CareRecord = { id: step, doneAt: at, by, countFrom: at, shotTotal: totals.shots, steamTotal: totals.steams, updatedAt: iso(now()) };
    await deps.storage.care.put(record);
    before.set(step, replaced);
    const records = new Map(state.records);
    records.set(step, record);
    set({ records, undoable: new Set(before.keys()) });
  }

  async function freshTotalsOrKnown(): Promise<Totals> {
    const reading = await withDeadline(readTotals(), MARK_WAIT_MS, timers);
    if (reading === null) return state.totals;
    if (reading.fresh.shots || reading.fresh.steams) {
      deps.cache?.save(reading.totals);
      set({ totals: reading.totals });
    }
    return reading.totals;
  }

  const stopTelemetry = deps.telemetry.subscribe(() => {
    const telemetry = deps.telemetry.getState();
    // Only a machine CafAI can see says anything: a frame from a machine gone away is stale.
    const machineState = telemetry.machineConnected ? (telemetry.machine?.state.state ?? null) : null;
    const step = watchCycle(cycle, machineState, now());
    cycle = step.watch;
    if (step.seen && state.ready) {
      const seen = step.seen;
      void freshTotalsOrKnown()
        .then((totals) => mark(seen.step, 'seen', seen.atMs, totals))
        .catch(() => undefined);
    }
    if (machineState === 'steam') steaming = true;
    else if (machineState !== null && steaming) {
      steaming = false;
      schedule(AFTER_RUN_MS);
    }
    const open = telemetry.sockets.devices === 'open';
    if (open && !reachable) count();
    reachable = open;
  });
  const stopShots = deps.telemetry.onShot((event) => {
    if (event.type === 'finished') schedule(AFTER_RUN_MS);
  });
  const stopVisibility = deps.visibility?.subscribe(() => {
    if (deps.visibility?.visible()) count();
  });

  async function read(): Promise<Pick<CareState, 'records' | 'settings'>> {
    const [records, settings] = await Promise.all([
      deps.storage.care.list().catch(() => [] as CareRecord[]),
      deps.storage.settings.get().then(
        (stored) => stored.care ?? DEFAULT_CARE,
        () => DEFAULT_CARE,
      ),
    ]);
    return { records: new Map(records.map((record) => [record.id, record])), settings };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async start() {
      set({ ...(await read()), ready: true });
      count(true);
    },
    refresh: () => count(),
    async reload() {
      const fresh = await read();
      // What Undo would put back belongs to the records the reload replaced.
      before.clear();
      set({ ...fresh, undoable: new Set() });
    },
    async markDone(step) {
      if (!state.ready || state.marking !== null) return;
      set({ marking: step });
      try {
        await mark(step, 'tick', now(), await freshTotalsOrKnown());
      } finally {
        set({ marking: null });
      }
    },
    async undo(step) {
      if (!before.has(step)) return;
      const replaced = before.get(step) ?? null;
      const at = iso(now());
      const record: CareRecord = replaced
        ? { ...replaced, updatedAt: at }
        : { id: step, doneAt: null, by: null, countFrom: at, shotTotal: state.totals.shots, steamTotal: state.totals.steams, updatedAt: at };
      await deps.storage.care.put(record);
      before.delete(step);
      const records = new Map(state.records);
      records.set(step, record);
      set({ records, undoable: new Set(before.keys()) });
    },
    async setSettings(patch) {
      const previous = state.settings;
      const next = { ...previous, ...patch };
      set({ settings: next });
      try {
        await deps.storage.settings.update({ care: next });
      } catch (error) {
        set({ settings: previous });
        throw error;
      }
    },
    dispose() {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      stopTelemetry();
      stopShots();
      stopVisibility?.();
      listeners.clear();
    },
  };
}

/** The last totals in this device's localStorage (`cafai.care.counts`): a cache, never mirrored. */
export const TOTALS_CACHE_KEY = 'cafai.care.counts';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function localTotalsCache(storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null): TotalsCache {
  return {
    load() {
      try {
        const raw = JSON.parse(storage?.getItem(TOTALS_CACHE_KEY) ?? 'null') as Record<string, unknown> | null;
        if (typeof raw !== 'object' || raw === null) return null;
        return {
          shots: numberOrNull(raw['shots']),
          steams: numberOrNull(raw['steams']),
          newestShotMs: numberOrNull(raw['newestShotMs']),
          newestSteamMs: numberOrNull(raw['newestSteamMs']),
        };
      } catch {
        return null;
      }
    },
    save(totals) {
      try {
        storage?.setItem(TOTALS_CACHE_KEY, JSON.stringify(totals));
      } catch {
        // Storage blocked or full: the next page counts afresh.
      }
    },
  };
}

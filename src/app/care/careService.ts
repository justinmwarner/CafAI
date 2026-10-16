/**
 * Machine care, live (D183-D190): each step's record, Decaid's
 * totals, the water and the filter, and the marks. One per app
 * (createServices.ts); the Care screen, the stats card's line and Settings >
 * Machine care read it (src/ui/care/useCare.ts).
 *
 * - Counting (D185): Decaid's newest shot and newest steam first, two small
 *   requests that read no measurements, and a total only when the newest is
 *   new; never by paging, but for one bounded page when a shot total jumps
 *   by more than could have been pulled. At start, 5 s after a shot or a
 *   steam ends, when Decaid answers again (unless a count it answered ran in
 *   the last 10 s), when the page comes back into view and when the Care
 *   screen asks; at most once every 10 s unless a run just ended, never while
 *   a shot runs. A step never counted gets its record, from now (D190); a
 *   record's baselines follow the totals (careRules.ts), written compare and
 *   set, so nothing that lands meanwhile is written over.
 * - Marks (D186): Mark done, with Undo until the page reloads, and the
 *   machine's own Clean or Descale seen for a minute, then gone (cycleWatch.ts);
 *   each takes the totals of the count running, or of one started then.
 * - The last totals are kept on this device (TotalsCache), so the stats card
 *   has them at its first paint and while Decaid is away.
 */
import { isShotMachineState } from '../../api/machineStates.ts';
import { parseDecaidTimestamp } from '../../api/time.ts';
import { GatewayError, type DecaidClient, type MachineFrame, type PaginatedShots, type TelemetryStore } from '../../api/types.ts';
import { DEFAULT_CARE } from '../../storage/settings.ts';
import type { CareChange, CareMark, CareRecord, CareSettings, Storage } from '../../storage/types.ts';
import {
  baselinesOf,
  rebaseline,
  TRACKED_STEPS,
  UNKNOWN_TOTALS,
  type ImportedShots,
  type NewestRecord,
  type Totals,
  type TrackedStepId,
} from './careRules.ts';
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
  decaid: Pick<DecaidClient, 'getLatestShot' | 'listShots' | 'getLatestSteam' | 'listSteamIds'>;
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
/**
 * A DE1 pulls one shot at a time: more than one a minute between the newest
 * shot of one reading and the next is taken for old ones imported, and a page
 * of the newest is read to tell them apart (D185).
 */
export const SHOT_SPACING_MS = 60_000;
/** The most shots that page reads: Decaid parses each one's measurements to list it. */
export const JUMP_PAGE = 20;

const browserTimers: CareTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One kind as Decaid answered it this time; `fresh` false: it did not, and these are the last known. */
interface KindReading {
  total: number | null;
  newest: NewestRecord | null;
  fresh: boolean;
}

/** Totals read now, which of them are fresh, and the old shots Decaid took in since the reading before. */
interface Reading {
  totals: Totals;
  fresh: { shots: boolean; steams: boolean };
  imported: ImportedShots | null;
}

/** One count: Decaid's totals as it read them (null: Decaid answered nothing), then its records written. */
interface Count {
  totals: Promise<Totals | null>;
  done: Promise<void>;
}

/** The same record, field by field (undefined: none); a record read back from storage is a new object. */
function sameRecord(a: CareRecord | undefined, b: CareRecord | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.id === b.id &&
    a.doneAt === b.doneAt &&
    a.by === b.by &&
    a.countFrom === b.countFrom &&
    a.shotTotal === b.shotTotal &&
    a.steamTotal === b.steamTotal &&
    a.newestShotAt === b.newestShotAt &&
    a.newestSteamAt === b.newestSteamAt &&
    a.updatedAt === b.updatedAt
  );
}

function newestOf(record: { id: string; timestamp: string } | null | undefined): NewestRecord | null {
  return record ? { id: record.id, at: record.timestamp } : null;
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
  let current: Count | null = null;
  let again = false;
  /** Decaid's socket opened while a count ran: count again after it, unless Decaid answered that one. */
  let againUnlessAnswered = false;
  let lastCountMs = Number.NEGATIVE_INFINITY;
  /** When a count last had both totals from Decaid. */
  let lastAnsweredMs = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  /** A Decaid without steam records (404, older than the pin): asked no more this session. */
  let noSteams = false;
  let cycle: CycleWatch = NO_CYCLE;
  let steaming = false;
  /** The machine frame last taken: a change that brings no new one (a scale frame, a socket) is no frame. */
  let lastFrame: MachineFrame | null = deps.telemetry.getState().machine;
  let reachable = deps.telemetry.getState().sockets.devices === 'open';
  /** The stored records were read: only then may a count write a step's first record. */
  let recordsRead = false;

  function set(patch: Partial<CareState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  /**
   * Old shots Decaid took in between the last reading and this one (D185):
   * only when the total grew by more than one a minute could have pulled
   * between the two newest shots, and then by a page of the newest, which
   * tells the ones that began after the newest then from the old. Null when
   * nothing says so, or the page cannot tell (it ends before the newest then).
   */
  async function importedSince(previous: Totals, total: number, newest: NewestRecord | null): Promise<ImportedShots | null> {
    if (previous.shots === null || previous.newestShot === null || newest === null) return null;
    const added = total - previous.shots;
    const thenMs = parseDecaidTimestamp(previous.newestShot.at);
    const nowMs = parseDecaidTimestamp(newest.at);
    if (added < 2 || !Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return null;
    const couldHaveBeen = nowMs > thenMs ? 1 + Math.floor((nowMs - thenMs) / SHOT_SPACING_MS) : 0;
    if (added <= couldHaveBeen) return null;
    let starts: number[];
    try {
      starts = (await deps.decaid.listShots({ limit: Math.min(added, JUMP_PAGE) })).items.map((item) => parseDecaidTimestamp(item.timestamp));
    } catch {
      return null;
    }
    if (!starts.some((ms) => ms <= thenMs)) return null;
    const pulled = starts.filter((ms) => ms > thenMs).length;
    return { count: added - pulled, upTo: previous.shots };
  }

  /** The shots: the newest first, and the total only when it is a shot CafAI has not counted with (D185). */
  async function readShots(previous: Totals): Promise<KindReading & { imported: ImportedShots | null }> {
    const unchanged = { total: previous.shots, newest: previous.newestShot, fresh: false, imported: null };
    let newest: NewestRecord | null;
    try {
      newest = newestOf(await deps.decaid.getLatestShot());
    } catch {
      return unchanged;
    }
    if (previous.shots !== null && newest?.id === previous.newestShot?.id) return { ...unchanged, fresh: true };
    let page: PaginatedShots;
    try {
      page = await deps.decaid.listShots({ limit: 1 });
    } catch {
      return unchanged;
    }
    // A total smaller than the page it came with is not one CafAI can count from.
    if (page.total < page.items.length) return { total: null, newest: null, fresh: true, imported: null };
    // The page's newest goes with its total, should a shot have been saved between the two requests.
    const pageNewest = newestOf(page.items[0]);
    return { total: page.total, newest: pageNewest, fresh: true, imported: await importedSince(previous, page.total, pageNewest) };
  }

  /** The steams: the newest first, and the ids (their count) only when it is a steam CafAI has not counted with. */
  async function readSteams(previous: Totals): Promise<KindReading> {
    const none = { total: null, newest: null, fresh: true };
    const unchanged = { total: previous.steams, newest: previous.newestSteam, fresh: false };
    if (noSteams) return none;
    const missing = (error: unknown) => error instanceof GatewayError && error.status === 404;
    let newest: NewestRecord | null;
    try {
      newest = newestOf(await deps.decaid.getLatestSteam());
    } catch (error) {
      if (!missing(error)) return unchanged;
      noSteams = true;
      return none;
    }
    if (previous.steams !== null && newest?.id === previous.newestSteam?.id) return { ...unchanged, fresh: true };
    try {
      return { total: (await deps.decaid.listSteamIds()).length, newest, fresh: true };
    } catch (error) {
      if (!missing(error)) return unchanged;
      noSteams = true;
      return none;
    }
  }

  async function readTotals(): Promise<Reading> {
    const previous = state.totals;
    const [shots, steams] = await Promise.all([readShots(previous), readSteams(previous)]);
    return {
      totals: { shots: shots.total, steams: steams.total, newestShot: shots.newest, newestSteam: steams.newest },
      fresh: { shots: shots.fresh, steams: steams.fresh },
      imported: shots.imported,
    };
  }

  function shotRunning(): boolean {
    const telemetry = deps.telemetry.getState();
    return telemetry.machineConnected && isShotMachineState(telemetry.machine?.state.state);
  }

  /** What a count read, into the records (compare and set) and the totals. */
  async function absorb(reading: Reading, seen: ReadonlyMap<string, CareRecord>): Promise<void> {
    if (disposed) return;
    const { totals, fresh, imported } = reading;
    const freshTotals: Totals = {
      shots: fresh.shots ? totals.shots : null,
      steams: fresh.steams ? totals.steams : null,
      newestShot: fresh.shots ? totals.newestShot : null,
      newestSteam: fresh.steams ? totals.newestSteam : null,
    };
    const at = iso(now());
    const changes = new Map<string, CareChange>();
    // Records that could not be read are left alone: a record written now could cover a real one.
    for (const step of recordsRead ? TRACKED_STEPS : []) {
      const record = seen.get(step);
      if (!record) {
        // Counted from the first look (D190), unless a record landed meanwhile (a mark, a restore, another tab).
        const first: CareRecord = { id: step, doneAt: null, by: null, countFrom: at, ...baselinesOf(freshTotals), updatedAt: at };
        changes.set(step, (stored) => (stored === undefined ? first : undefined));
        continue;
      }
      const change = rebaseline(record, freshTotals, imported);
      // Only the totals, and only on the record this count saw: a step marked done, merged or restored since keeps its own.
      if (change) changes.set(step, (stored) => (stored && stored.doneAt === record.doneAt && stored.countFrom === record.countFrom ? { ...stored, ...change, updatedAt: at } : undefined));
    }
    // A store that refused leaves the records as this count would have them, here only, until the next count.
    const unsaved = () => new Map([...changes].map(([id, change]): [string, CareRecord | undefined] => [id, change(seen.get(id))]));
    const stored = changes.size === 0 ? new Map<string, CareRecord | undefined>() : await deps.storage.care.update(changes).catch(unsaved);
    if (disposed) return;
    const records = new Map(state.records);
    // A step on screen takes what its record is now, unless it changed here while the count ran (a mark, an undo, a reload).
    for (const [id, record] of stored) {
      if (record !== undefined && sameRecord(state.records.get(id), seen.get(id))) records.set(id, record);
    }
    if (fresh.shots && fresh.steams) lastAnsweredMs = now();
    if (fresh.shots || fresh.steams) deps.cache?.save(totals);
    set({ records, totals });
  }

  /** A count now, or none while the records are unread or a shot runs (its own count comes 5 s after it ends). */
  function begin(): Count | null {
    if (!state.ready || disposed || shotRunning()) return null;
    lastCountMs = now();
    const seen = state.records;
    const reading = readTotals();
    const count: Count = {
      totals: reading.then(
        (read) => (read.fresh.shots || read.fresh.steams ? read.totals : null),
        () => null,
      ),
      done: reading.then((read) => absorb(read, seen)).catch(() => undefined),
    };
    current = count;
    void count.done.then(() => {
      if (current === count) current = null;
      const retry = again || (againUnlessAnswered && now() - lastAnsweredMs >= MIN_COUNT_GAP_MS);
      again = false;
      againUnlessAnswered = false;
      if (retry) request();
    });
    return count;
  }

  function schedule(ms: number): void {
    if (disposed) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      request(true);
    }, ms);
  }

  /** Count, at most once every 10 s unless forced, and after the one running. */
  function request(force = false): void {
    if (disposed) return;
    if (current) {
      again = true;
      return;
    }
    const wait = force ? 0 : lastCountMs + MIN_COUNT_GAP_MS - now();
    if (wait > 0) {
      if (timer === null) schedule(wait);
      return;
    }
    begin();
  }

  /** Decaid's totals for a mark: the count running's, or one's started now, after 3 s the last ones known. */
  async function totalsForMark(): Promise<Totals> {
    const count = current ?? begin();
    const totals = count ? await withDeadline(count.totals, MARK_WAIT_MS, timers) : null;
    return totals ?? state.totals;
  }

  async function mark(step: TrackedStepId, by: CareMark, atMs: number, totals: Totals): Promise<void> {
    const replaced = state.records.get(step) ?? null;
    const at = iso(atMs);
    const record: CareRecord = { id: step, doneAt: at, by, countFrom: at, ...baselinesOf(totals), updatedAt: iso(now()) };
    await deps.storage.care.put(record);
    before.set(step, replaced);
    const records = new Map(state.records);
    records.set(step, record);
    set({ records, undoable: new Set(before.keys()) });
  }

  /** A new frame from the machine, on its open socket (D186): the cycle watch, timed by the frame's own time, and a steam's end. */
  function onMachineFrame(frame: MachineFrame): void {
    const machineState = frame.state.state;
    const atMs = parseDecaidTimestamp(frame.timestamp);
    if (Number.isFinite(atMs)) {
      const step = watchCycle(cycle, { state: machineState, atMs, seenMs: now() });
      cycle = step.watch;
      if (step.seen && state.ready) {
        const seen = step.seen;
        void totalsForMark()
          .then((totals) => mark(seen.step, 'seen', seen.atMs, totals))
          .catch(() => undefined);
      }
    }
    if (machineState === 'steam') steaming = true;
    else if (steaming) {
      steaming = false;
      schedule(AFTER_RUN_MS);
    }
  }

  const stopTelemetry = deps.telemetry.subscribe(() => {
    const telemetry = deps.telemetry.getState();
    const frame = telemetry.machine;
    if (frame !== null && frame !== lastFrame) {
      lastFrame = frame;
      // Only a machine CafAI can see, on a socket that is open, says anything: a frame kept from before is stale.
      if (telemetry.machineConnected && telemetry.sockets.machine === 'open') onMachineFrame(frame);
    }
    const open = telemetry.sockets.devices === 'open';
    // Decaid may be back; a count it answered in the last 10 s (start-up's own, say) needs no other.
    if (open && !reachable && now() - lastAnsweredMs >= MIN_COUNT_GAP_MS) {
      if (current) againUnlessAnswered = true;
      else request();
    }
    reachable = open;
  });
  const stopShots = deps.telemetry.onShot((event) => {
    if (event.type === 'finished') schedule(AFTER_RUN_MS);
  });
  const stopVisibility = deps.visibility?.subscribe(() => {
    if (deps.visibility?.visible()) request();
  });

  /** The stored records and settings; storage that cannot be read leaves the records as they were, and says so in recordsRead. */
  async function read(): Promise<Pick<CareState, 'records' | 'settings'>> {
    const [records, settings] = await Promise.all([
      deps.storage.care.list().then(
        (listed) => listed,
        () => null,
      ),
      deps.storage.settings.get().then(
        (stored) => stored.care ?? DEFAULT_CARE,
        () => state.settings,
      ),
    ]);
    if (records === null) return { records: state.records, settings };
    recordsRead = true;
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
      request(true);
    },
    refresh: () => request(),
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
        await mark(step, 'tick', now(), await totalsForMark());
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
        : { id: step, doneAt: null, by: null, countFrom: at, ...baselinesOf(state.totals), updatedAt: at };
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

function newestOrNull(value: unknown): NewestRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, at } = value as Record<string, unknown>;
  return typeof id === 'string' && id !== '' && typeof at === 'string' && at !== '' ? { id, at } : null;
}

export function localTotalsCache(storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null): TotalsCache {
  return {
    load() {
      try {
        const raw = JSON.parse(storage?.getItem(TOTALS_CACHE_KEY) ?? 'null') as Record<string, unknown> | null;
        if (typeof raw !== 'object' || raw === null) return null;
        const shots = numberOrNull(raw['shots']);
        const steams = numberOrNull(raw['steams']);
        // A newest goes with its total: without the total it says nothing.
        return {
          shots,
          steams,
          newestShot: shots === null ? null : newestOrNull(raw['newestShot']),
          newestSteam: steams === null ? null : newestOrNull(raw['newestSteam']),
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

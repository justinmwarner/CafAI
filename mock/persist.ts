/**
 * Keeps the mock Decaid's store across page loads, on request (D67).
 *
 * URL switch, read once at start: ?mockPersist=1. Without it nothing here
 * runs and every page load gets a fresh mock, as the other e2e specs expect.
 *
 * With it, the mock keeps what a real Decaid keeps on disk: the `cafai`
 * key-value namespace (CafAI's backup) and the `cafai-key` one (D99's
 * optional copy of the API key), the shot records, the steam records
 * (without their measurements, which nothing reads; D-CARE-9), the workflow
 * (profile and context), the profiles CafAI created, and the bean library (D4/D10):
 * the two seeded beans and batches, and any CafAI added. Live state starts
 * fresh, as after a Decaid restart: machine and scale links, frames, the shot
 * player, faults and the request log. So a test can empty CafAI's own browser
 * storage, reload, and watch CafAI restore itself from the backup
 * (e2e/restore.spec.ts). Decaid's own settings are not kept either (GET
 * /api/v1/settings, and the sleep and wake settings with their schedules), nor
 * the grinder library: each load starts from the mock's defaults and seeds.
 *
 * The snapshot lives in localStorage under one key, `cafai-mock:store`:
 * - it survives reloads, navigation and other pages of the same browser
 *   context (sessionStorage is per tab, so emptying storage from a second
 *   page would lose it), and Playwright gives each test a fresh context, so
 *   specs never see each other's store;
 * - it is synchronous, so the restore is done before createServices() makes
 *   the app's first request (src/main.tsx) and a save inside `pagehide`
 *   completes;
 * - the `cafai-mock:` prefix keeps it apart from CafAI's own `cafai.*` keys,
 *   so a test can wipe CafAI's storage and keep Decaid's.
 *
 * It saves after every request that may have changed the store (anything but
 * GET, HEAD or OPTIONS in the mock's request log, checked every 250 ms), after
 * the shot player recorded a shot or a steam, and on `pagehide`. A change made directly
 * on `window.__CAFAI_MOCK__.state` is saved with the next such request or on
 * `pagehide`.
 *
 * Size: Chromium gives an origin about 5.2 million UTF-16 code units of
 * localStorage (10 MiB, keys plus values). The snapshot stays under
 * MAX_SNAPSHOT_CHARS (4 Mi) by leaving out the oldest shots first. A scripted
 * shot is about 57k characters and the rest of a dial-in session a few dozen
 * kilobytes, so some 70 shots fit.
 *
 * The restore goes through MockDecaid's public API only, so CafAI's profiles
 * come back with the restore time as createdAt/updatedAt (Decaid sets them),
 * and profiles are added or updated, never removed (the API has no hard delete).
 */
import type { Bean, BeanBatch, ShotRecord, Workflow, WorkflowContext } from '../src/api/types.ts';
import type { DecaidProfileRecord } from './decaid/profiles.ts';
import { isPlainObject } from './decaid/json.ts';
import type { MockDecaid, MockRequestLog } from './decaid/state.ts';
import type { MockSteamRecord } from './decaid/steams.ts';

export const MOCK_PERSIST_PARAM = 'mockPersist';
/** Every localStorage key of the mock starts with this; CafAI's own keys start with `cafai.`. */
export const MOCK_STORE_PREFIX = 'cafai-mock:';
export const MOCK_STORE_KEY = `${MOCK_STORE_PREFIX}store`;
/** CafAI's backup namespace (D16) and its optional copy of the API key (D99, D10); nothing else in the key-value store is CafAI's to keep. */
export const PERSISTED_KV_NAMESPACES: readonly string[] = ['cafai', 'cafai-key'];
/** UTF-16 code units a saved snapshot may take: well under Chromium's ~5.2 million per origin. */
export const MAX_SNAPSHOT_CHARS = 4 * 1024 * 1024;

const SNAPSHOT_FORMAT = 'cafai-mock-store';
const SNAPSHOT_VERSION = 1;
const DEFAULT_POLL_MS = 250;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const VISIBILITIES = new Set(['visible', 'hidden', 'deleted']);

export interface MockStoreSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  /** The mock's data clock at the save (epoch ms), so data time never runs backwards after a reload. */
  clockMs: number;
  /** Namespace -> key -> value. */
  kv: Record<string, Record<string, unknown>>;
  /** Full records, measurements included, in the mock's order. */
  shots: ShotRecord[];
  /** The steam records, measurements left out; absent from a store saved before the mock kept them. */
  steams?: MockSteamRecord[];
  workflow: Workflow;
  /** Every profile record that is not a bundled default: visible, hidden or deleted. */
  profiles: DecaidProfileRecord[];
  /** Every bean and batch, archived included (D4/D10): the seeded two and any CafAI created. */
  beans: Bean[];
  batches: BeanBatch[];
}

export interface RestoreReport {
  /** What could not be put back, as labels (never values). */
  skipped: string[];
}

export interface SerializedSnapshot {
  text: string;
  /** How many of the oldest shots were left out to stay under the limit. */
  droppedShots: number;
}

export function snapshotStore(state: MockDecaid): MockStoreSnapshot {
  const kv: Record<string, Record<string, unknown>> = {};
  for (const namespace of PERSISTED_KV_NAMESPACES) kv[namespace] = state.kvAll(namespace);
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    clockMs: state.clock.now(),
    kv,
    shots: state.getShotIds().map((id) => state.getShot(id)),
    steams: state.getSteamIds().map((id) => ({ ...state.getSteam(id), measurements: [] })),
    workflow: state.getWorkflow(),
    profiles: state.listProfiles({ includeHidden: true }).filter((record) => !record.isDefault),
    beans: state.listBeans({ includeArchived: true }),
    batches: state.listBatches({ includeArchived: true }),
  };
}

/**
 * Put a snapshot into a mock (normally a fresh one). Each item is restored on
 * its own, so one that the mock refuses is skipped and reported, not fatal.
 */
export function restoreStore(state: MockDecaid, snapshot: MockStoreSnapshot): RestoreReport {
  const skipped: string[] = [];
  const attempt = (label: string, run: () => void) => {
    try {
      run();
    } catch {
      skipped.push(label);
    }
  };

  // Data time first: nothing created below may predate what was saved.
  state.clock.advanceTo(snapshot.clockMs);

  for (const [namespace, entries] of Object.entries(snapshot.kv)) {
    const saved = new Set(Object.keys(entries));
    for (const key of state.kvKeys(namespace)) if (!saved.has(key)) state.kvDelete(namespace, key);
    for (const [key, value] of Object.entries(entries)) {
      attempt(`kv ${namespace}/${key}`, () => state.kvSet(namespace, key, JSON.stringify(value)));
    }
  }

  // The saved set exactly, in its order: a shot deleted before the save stays deleted.
  for (const id of state.getShotIds()) attempt(`shot ${id}`, () => void state.deleteShot(id));
  for (const shot of snapshot.shots) attempt(`shot ${shot.id}`, () => state.addShot(shot));
  for (const steam of snapshot.steams ?? []) attempt(`steam ${steam.id}`, () => state.addSteam(steam));

  // Beans and batches are a straight upsert by id (D4/D10): the fresh mock's two seeded ones
  // are already in the saved set under the same fixed ids, so this never duplicates them, and
  // any bean or batch CafAI created is added back exactly as it was.
  for (const bean of snapshot.beans) attempt(`bean ${bean.id}`, () => state.addBean(bean));
  for (const batch of snapshot.batches) attempt(`batch ${batch.id}`, () => state.addBatch(batch));

  for (const record of parentsFirst(snapshot.profiles)) attempt(`profile ${record.id}`, () => restoreProfile(state, record));

  attempt('workflow', () => restoreWorkflow(state, snapshot.workflow));
  return { skipped };
}

/** Parents before their children, so every parentId exists when its child is created. */
function parentsFirst(records: readonly DecaidProfileRecord[]): DecaidProfileRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered: DecaidProfileRecord[] = [];
  const placed = new Set<string>();
  const place = (record: DecaidProfileRecord, path: Set<string>) => {
    if (placed.has(record.id) || path.has(record.id)) return;
    path.add(record.id);
    const parent = record.parentId ? byId.get(record.parentId) : undefined;
    if (parent) place(parent, path);
    placed.add(record.id);
    ordered.push(record);
  };
  for (const record of records) place(record, new Set());
  return ordered;
}

function restoreProfile(state: MockDecaid, record: DecaidProfileRecord): void {
  const metadata = record.metadata ?? null;
  let restored: DecaidProfileRecord;
  try {
    restored = state.createProfile({ profile: record.profile, metadata, ...(record.parentId ? { parentId: record.parentId } : {}) });
  } catch (error) {
    if (!record.parentId) throw error;
    // The parent is not in this store (it was never CafAI's to keep): keep the
    // profile without its lineage rather than lose it.
    restored = state.createProfile({ profile: record.profile, metadata });
  }
  // Content equal to a bundled default is Decaid's record, not CafAI's.
  if (restored.isDefault) return;
  // Decaid answers a create with existing content with the existing record,
  // untouched: put back the saved title, notes, author and metadata.
  if (restored.metadataHash !== record.metadataHash || JSON.stringify(restored.metadata) !== JSON.stringify(metadata)) {
    restored = state.updateProfile(restored.id, { profile: record.profile, metadata });
  }
  if (restored.visibility !== record.visibility) state.setProfileVisibility(restored.id, { visibility: record.visibility });
}

/**
 * PUT /workflow deep-merges, so a plain PUT of the saved workflow would keep
 * fields the fresh mock has and the saved one lacks. Context fields go back to
 * unset with explicit nulls (Decaid drops them), and extras, which merge key
 * by key, are cleared first. targetYield cannot be null (Decaid rejects it);
 * a saved workflow always carries one anyway.
 */
function restoreWorkflow(state: MockDecaid, saved: Workflow): void {
  const current = state.getWorkflow();
  const currentContext: WorkflowContext = current.context ?? {};
  const savedContext: WorkflowContext = saved.context ?? {};
  if (currentContext.extras !== undefined) state.updateWorkflow({ context: { extras: null } });
  const context: Record<string, unknown> = { ...savedContext };
  for (const key of Object.keys(currentContext)) {
    if (key !== 'targetYield' && key !== 'extras' && !Object.prototype.hasOwnProperty.call(savedContext, key)) context[key] = null;
  }
  const patch: Record<string, unknown> = { ...saved, context };
  if ('machine' in current && !('machine' in saved)) patch.machine = null;
  state.updateWorkflow(patch);
}

/**
 * The snapshot as JSON, under `maxChars`: when it is too large, the oldest
 * shots are left out first. Null when even the store without shots is too large.
 */
export function serializeSnapshot(snapshot: MockStoreSnapshot, maxChars: number = MAX_SNAPSHOT_CHARS): SerializedSnapshot | null {
  let text = JSON.stringify(snapshot);
  if (text.length <= maxChars) return { text, droppedShots: 0 };

  const oldestFirst = snapshot.shots
    .map((shot, index) => ({ index, timestamp: shot.timestamp, size: JSON.stringify(shot).length + 1 }))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index));
  const dropped = new Set<number>();
  let estimate = text.length;
  for (const shot of oldestFirst) {
    if (estimate <= maxChars) break;
    dropped.add(shot.index);
    estimate -= shot.size;
  }
  // The estimate counts a comma per shot; the real text decides.
  for (;;) {
    text = JSON.stringify({ ...snapshot, shots: snapshot.shots.filter((_, index) => !dropped.has(index)) });
    if (text.length <= maxChars) return { text, droppedShots: dropped.size };
    const next = oldestFirst.find((shot) => !dropped.has(shot.index));
    if (!next) return null;
    dropped.add(next.index);
  }
}

/** A saved snapshot, or null when there is none or it is not one this version can restore whole. */
export function parseSnapshot(text: string | null | undefined): MockStoreSnapshot | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(raw) || raw.format !== SNAPSHOT_FORMAT || raw.version !== SNAPSHOT_VERSION) return null;
  if (typeof raw.clockMs !== 'number' || !Number.isFinite(raw.clockMs)) return null;
  const kv = raw.kv;
  if (!isPlainObject(kv) || !Object.values(kv).every(isPlainObject)) return null;
  if (!Array.isArray(raw.shots) || !raw.shots.every(isShotRecord)) return null;
  if (raw.steams !== undefined && (!Array.isArray(raw.steams) || !raw.steams.every(isSteamRecord))) return null;
  if (!isWorkflow(raw.workflow)) return null;
  if (!Array.isArray(raw.profiles) || !raw.profiles.every(isProfileRecord)) return null;
  if (!Array.isArray(raw.beans) || !raw.beans.every(isBeanRecord)) return null;
  if (!Array.isArray(raw.batches) || !raw.batches.every(isBatchRecord)) return null;
  return raw as unknown as MockStoreSnapshot;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isWorkflow(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    isPlainObject(value.profile)
  );
}

function isShotRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const workflow = value.workflow;
  return (
    isText(value.id) &&
    typeof value.timestamp === 'string' &&
    Array.isArray(value.measurements) &&
    isPlainObject(workflow) &&
    isPlainObject(workflow.profile)
  );
}

function isSteamRecord(value: unknown): boolean {
  return isPlainObject(value) && isText(value.id) && typeof value.timestamp === 'string' && Array.isArray(value.measurements) && isPlainObject(value.workflow);
}

function isProfileRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const { parentId, metadata, visibility } = value;
  return (
    isText(value.id) &&
    isPlainObject(value.profile) &&
    typeof visibility === 'string' &&
    VISIBILITIES.has(visibility) &&
    (parentId === null || parentId === undefined || typeof parentId === 'string') &&
    (metadata === null || metadata === undefined || isPlainObject(metadata))
  );
}

function isBeanRecord(value: unknown): boolean {
  return isPlainObject(value) && isText(value.id) && typeof value.roaster === 'string' && typeof value.name === 'string';
}

function isBatchRecord(value: unknown): boolean {
  return isPlainObject(value) && isText(value.id) && isText(value.beanId);
}

// ---------------------------------------------------------------------------
// Browser glue
// ---------------------------------------------------------------------------

/** Where `pagehide` is heard: the window. */
export interface PageHideSource {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

export interface MockPersistenceEnv {
  /** The page's location.search, where ?mockPersist=1 is read. */
  search: string;
  /** Where the snapshot is kept: the page's localStorage. */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  events: PageHideSource;
  /** How often the request log is checked, in ms (default 250). */
  pollMs?: number;
  /** Default console.warn. Only ever told what went wrong, never any data. */
  warn?: (message: string) => void;
}

export interface MockPersistence {
  /** True when a saved store was found and put back at start. */
  readonly restored: boolean;
  /** Save now (it also runs after store-changing requests and on pagehide). */
  save(): void;
  stop(): void;
}

function browserEnv(): MockPersistenceEnv {
  return {
    search: window.location.search,
    // A getter: localStorage throws where storage is blocked, and is only read with the switch on.
    get storage() {
      return window.localStorage;
    },
    events: window,
  };
}

function errorName(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  return name || 'unknown error';
}

/** The log entries after `seen`: all of them when it is gone (the log keeps only its last 500). */
function entriesAfter(log: readonly MockRequestLog[], seen: MockRequestLog | undefined): readonly MockRequestLog[] {
  const index = seen ? log.lastIndexOf(seen) : -1;
  return index < 0 ? log : log.slice(index + 1);
}

/**
 * With ?mockPersist=1: put the saved store into this fresh mock now, then
 * keep saving it. Returns null (and does nothing) without the switch. Never
 * throws: a mock that cannot keep its store still serves the app.
 */
export function startMockPersistence(state: MockDecaid, env: MockPersistenceEnv = browserEnv()): MockPersistence | null {
  if (new URLSearchParams(env.search).get(MOCK_PERSIST_PARAM) !== '1') return null;
  const warned = new Set<string>();
  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    (env.warn ?? ((text: string) => console.warn(`Mock Decaid: ${text}`)))(message);
  };

  let storage: MockPersistenceEnv['storage'];
  let savedText: string | null;
  try {
    storage = env.storage;
    savedText = storage.getItem(MOCK_STORE_KEY);
  } catch (error) {
    warn(`browser storage is unavailable (${errorName(error)}), so the store is not kept.`);
    return null;
  }

  let restored = false;
  const snapshot = parseSnapshot(savedText);
  if (savedText && !snapshot) warn('the saved store could not be read; starting with a fresh one.');
  if (snapshot) {
    try {
      const { skipped } = restoreStore(state, snapshot);
      restored = true;
      if (skipped.length > 0) warn(`restored the saved store without ${skipped.length} item(s) it refused.`);
    } catch (error) {
      warn(`could not restore the saved store (${errorName(error)}).`);
    }
  }

  let written: string | null = null;
  const save = () => {
    try {
      const serialized = serializeSnapshot(snapshotStore(state));
      if (!serialized) {
        warn('the store is too large to keep in browser storage; the last saved copy stays.');
        return;
      }
      if (serialized.droppedShots > 0) warn('the oldest shots are left out of the saved store (browser storage limit).');
      if (serialized.text === written) return;
      storage.setItem(MOCK_STORE_KEY, serialized.text);
      written = serialized.text;
    } catch (error) {
      warn(`could not save the store (${errorName(error)}).`);
    }
  };

  let lastSeen = state.requests[state.requests.length - 1];
  // The shot player records shots and steams with no request: a change in either is a change to keep.
  const recordIds = () => [...state.getShotIds(), ...state.getSteamIds()].join('\n');
  let shotIds = recordIds();
  const check = () => {
    const log = state.requests;
    const fresh = entriesAfter(log, lastSeen);
    lastSeen = log[log.length - 1] ?? lastSeen;
    const ids = recordIds();
    const shotsChanged = ids !== shotIds;
    shotIds = ids;
    if (shotsChanged || fresh.some((entry) => !READ_METHODS.has(entry.method.toUpperCase()))) save();
  };
  const timer = setInterval(check, env.pollMs ?? DEFAULT_POLL_MS);
  const onPageHide = () => save();
  env.events.addEventListener('pagehide', onPageHide);

  return {
    restored,
    save,
    stop() {
      clearInterval(timer);
      env.events.removeEventListener('pagehide', onPageHide);
    },
  };
}

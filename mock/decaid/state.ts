/**
 * A stateful in-memory Decaid for the MSW mock, Vitest and Playwright.
 *
 * Behaviour follows the gateway source at a45961b (docs/verified/02-api.md),
 * not the OpenAPI spec where they differ: a KV miss is 200 null, PUT
 * /workflow deep-merges (objects merge, arrays replace), POST /profiles
 * dedupes to an existing record with 201, profile ids are the real content
 * hashes, and so on. Every read returns a deep copy, so callers (including
 * Playwright through window.__CAFAI_MOCK__) can never corrupt the state.
 */
import type {
  ConnectionError,
  DecaidSettings,
  DeviceEntry,
  DevicesState,
  HeartbeatResponse,
  MachineInfo,
  MachineSnapshot,
  PaginatedShots,
  ProfileRecord,
  ScaleWsFrame,
  ShotRecord,
  ShotRecordSummary,
  ShotSettings,
  ShotStateEvent,
  WaterLevels,
  WeightSnapshot,
  Workflow,
} from '../../src/api/types.ts';
import { clone } from '../../src/util/clone.ts';
import blooming from '../../src/coach/templates/source/Blooming_espresso.json';
import dflow from '../../src/coach/templates/source/D-Flow____default.json';
import londonium from '../../src/coach/templates/source/Londonium.json';
import allonge from '../../src/coach/templates/source/rao_allonge.json';
import gentle from '../../src/coach/templates/source/Gentle_and_sweet1.json';
import { fixtures } from '../fixtures/index.ts';
import { createDataClock, formatLocalTimestamp, formatUtcTimestamp, type DataClock } from './clock.ts';
import { DartError, MockHttpError } from './errors.ts';
import { deepMergeJson, isPlainObject, type JsonObject } from './json.ts';
import { buildProfileRecord, normalizeProfile, profileHash } from './profiles.ts';
import { normalizeWorkflow, validateWorkflowPatch } from './workflow.ts';

export type MockChannel = 'machine' | 'scale' | 'devices' | 'shotState' | 'waterLevels' | 'shotSettings';

export interface MockFrames {
  machine: MachineSnapshot;
  scale: ScaleWsFrame;
  devices: DevicesState;
  shotState: ShotStateEvent;
  waterLevels: WaterLevels;
  shotSettings: ShotSettings;
}

export interface MockDecaidOptions {
  /** Default true. */
  machineConnected?: boolean;
  /** Default true. */
  scaleConnected?: boolean;
  /** Group-head controller fitted. Default false, so a UI can start shots itself. */
  ghc?: boolean;
  /** Overrides for GET /api/v1/settings (blockOnNoScale, blockTareDuringShot, gatewayMode, ...). */
  settings?: Partial<DecaidSettings>;
  /** Seed the example CafAI profile record and the example shot (default true). Bundled defaults are always seeded. */
  seedExamples?: boolean;
  /** Wall clock in epoch ms (default Date.now). */
  now?: () => number;
}

export interface MockFault {
  /** Any method when omitted. */
  method?: string;
  /** Exact pathname (e.g. "/api/v1/workflow") or a pattern. */
  path: string | RegExp;
  status: number;
  /** JSON body; use plainText for shelf-style text bodies. */
  body?: unknown;
  plainText?: string;
  headers?: Record<string, string>;
  /** How many requests to fail (default 1). */
  times?: number;
}

export interface MockRequestLog {
  method: string;
  path: string;
  query: string;
  /** Parsed JSON body, the raw text when it is not JSON, or null. */
  body: unknown;
  at: number;
}

export interface DefaultProfileDescriptor {
  filename: string;
  title: string;
  author: string;
  notes: string;
  beverageType: string;
}

export interface DeviceConnectResult {
  deviceId: string;
  operation: 'connect';
  outcome: 'connected' | 'alreadyConnected';
  state: 'connected';
  connectionError: null;
  error: null;
  connectionRole?: 'primary' | 'auxiliary';
}

export interface MockDecaid {
  readonly clock: DataClock;

  // Machine
  isMachineConnected(): boolean;
  /** Simulate the DE1 dropping off (or coming back). Machine sockets go silent; devices reports it. */
  setMachineConnected(connected: boolean): void;
  getMachineSnapshot(): MachineSnapshot;
  /** Store and broadcast a machine frame (silent while the machine is away). */
  setMachineSnapshot(snapshot: MachineSnapshot): void;
  getMachineInfo(): MachineInfo;
  getShotSettings(): ShotSettings;
  setShotSettings(settings: ShotSettings): void;
  getWaterLevels(): WaterLevels;
  setWaterLevels(levels: Partial<WaterLevels>): void;
  getCapabilities(): string[];
  heartbeat(): HeartbeatResponse;
  readonly heartbeatCount: number;
  /** Every PUT /machine/state/{state} name received, in order. */
  readonly machineCommands: string[];
  /** Profile frame the machine reports before a shot's first step (stale from the last shot). */
  lastProfileFrame: number;

  // Scale
  isScaleConnected(): boolean;
  setScaleConnected(connected: boolean): void;
  getScaleSnapshot(): WeightSnapshot | null;
  /** Store and broadcast a weight frame (ignored while the scale is away). */
  setScaleWeight(snapshot: WeightSnapshot): void;

  // Devices
  getDevices(): DeviceEntry[];
  getDevicesState(): DevicesState;
  setConnectionError(error: ConnectionError | null): void;
  /** e.g. raiseConnectionError('profileUploadFailed') to exercise the UI notice. */
  raiseConnectionError(kind: string, message?: string): ConnectionError;
  scanDevices(quick: boolean): DeviceEntry[];
  connectDevice(body: unknown): DeviceConnectResult;

  // Settings
  getSettings(): DecaidSettings;
  setSettings(patch: Partial<DecaidSettings>): void;

  // Workflow
  getWorkflow(): Workflow;
  updateWorkflow(body: unknown): Workflow;

  // Profiles
  listProfiles(query: { visibility?: string | null; includeHidden?: string | boolean | null; parentId?: string | null }): ProfileRecord[];
  getProfile(id: string): ProfileRecord;
  createProfile(body: unknown): ProfileRecord;
  updateProfile(id: string, body: unknown): ProfileRecord;
  deleteProfile(id: string): { success: true; message: string; id: string };
  setProfileVisibility(id: string, body: unknown): ProfileRecord;
  profileLineage(id: string): ProfileRecord[];
  defaultProfiles(): DefaultProfileDescriptor[];
  restoreDefaultProfile(filename: string): ProfileRecord;

  // Shots
  listShots(params: URLSearchParams): PaginatedShots | ShotRecord[];
  getLatestShot(): ShotRecordSummary | null;
  getShotIds(): string[];
  getShot(id: string): ShotRecord;
  updateShot(id: string, body: unknown): ShotRecord;
  deleteShot(id: string): { success: true; id: string };
  addShot(record: ShotRecord): void;

  // Key-value store (namespaces and keys are raw, never decoded)
  kvKeys(namespace: string): string[];
  kvAll(namespace: string): Record<string, unknown>;
  kvGet(namespace: string, key: string): unknown;
  kvSet(namespace: string, key: string, bodyText: string): void;
  kvDelete(namespace: string, key: string): void;

  // Shot state
  getShotState(): ShotStateEvent;
  publishShotState(event: ShotStateEvent): void;

  // Faults and logs (for tests and Playwright)
  failNext(fault: MockFault): void;
  takeFault(method: string, path: string): MockFault | null;
  logRequest(entry: Omit<MockRequestLog, 'at'>): void;
  readonly requests: MockRequestLog[];

  // Frames
  on<C extends MockChannel>(channel: C, listener: (frame: MockFrames[C]) => void): () => void;
  /** Close every open mock socket (or one channel's), as if the network dropped. */
  dropSockets(channel?: MockChannel): void;
  onDropSockets(listener: (channel: MockChannel | null) => void): () => void;
  socketCount(channel: MockChannel): number;
  noteSocket(channel: MockChannel, delta: 1 | -1): void;
}

const MAX_KV_BODY_BYTES = 1024 * 1024;
const MAX_LOGGED_REQUESTS = 500;
const BUNDLED_AT = '2026-09-16T09:02:11.204518';
const BOOKKEEPING_EXTRAS = ['uploaded_to_decent', 'decent_upload_rejected', 'visualizerId'];

const TEMPLATE_SOURCES: Array<{ filename: string; json: unknown }> = [
  { filename: 'Blooming_espresso.json', json: blooming },
  { filename: 'D-Flow____default.json', json: dflow },
  { filename: 'Londonium.json', json: londonium },
  { filename: 'rao_allonge.json', json: allonge },
  { filename: 'Gentle_and_sweet1.json', json: gentle },
];

const DEFAULT_SETTINGS: DecaidSettings = {
  gatewayMode: 'disabled',
  logLevel: 'INFO',
  weightFlowMultiplier: 1.0,
  volumeFlowMultiplier: 0.3,
  scalePowerMode: 'disabled',
  blockOnNoScale: false,
  blockTareDuringShot: false,
  stopHotWaterAtWeight: false,
  defaultSkinId: 'cafai',
  automaticUpdateCheck: true,
  simulatedDevices: [],
  themeMode: 'system',
};

function badRequest(body: Record<string, unknown>): MockHttpError {
  return new MockHttpError(400, body);
}

function toProfileError(error: unknown, typeErrorStatus: 400 | 500): MockHttpError {
  if (error instanceof MockHttpError) return error;
  if (error instanceof DartError) {
    if (error.kind === 'ArgumentError' || error.kind === 'FormatException') {
      return badRequest({ error: 'Invalid request', message: error.message });
    }
    if (error.kind === 'TypeError' && typeErrorStatus === 400) return badRequest({ error: 'Invalid request', message: error.message });
    return new MockHttpError(500, { error: 'Internal server error', message: error.message });
  }
  return new MockHttpError(500, { error: 'Internal server error', message: String(error) });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function withoutMeasurements(record: ShotRecord): ShotRecordSummary {
  const summary = clone(record) as ShotRecordSummary & { measurements?: unknown };
  delete summary.measurements;
  return summary;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function createMockDecaid(options: MockDecaidOptions = {}): MockDecaid {
  const clock = createDataClock(options.now ?? Date.now);
  const localNow = () => formatLocalTimestamp(clock.now());
  const utcNow = () => formatUtcTimestamp(clock.now());

  const listeners: { [C in MockChannel]: Set<(frame: MockFrames[C]) => void> } = {
    machine: new Set(),
    scale: new Set(),
    devices: new Set(),
    shotState: new Set(),
    waterLevels: new Set(),
    shotSettings: new Set(),
  };
  const dropListeners = new Set<(channel: MockChannel | null) => void>();
  const sockets: Record<MockChannel, number> = { machine: 0, scale: 0, devices: 0, shotState: 0, waterLevels: 0, shotSettings: 0 };

  function emit<C extends MockChannel>(channel: C, frame: MockFrames[C]): void {
    for (const listener of [...listeners[channel]]) listener(clone(frame));
  }

  // ---- machine ------------------------------------------------------------------
  const devicesFixture = fixtures.devicesWs();
  const machineDevice = devicesFixture.devices.find((d) => d.type === 'machine')!;
  const scaleDevice = devicesFixture.devices.find((d) => d.type === 'scale')!;
  let machineConnected = options.machineConnected ?? true;
  let scaleConnected = options.scaleConnected ?? true;
  let snapshot: MachineSnapshot = { ...fixtures.machineState(), timestamp: localNow() };
  const machineInfo: MachineInfo = { ...fixtures.machineInfo(), GHC: options.ghc ?? false };
  let shotSettings = fixtures.shotSettings();
  let waterLevels = fixtures.waterLevelsWs();
  let heartbeatCount = 0;
  const machineCommands: string[] = [];
  let scaleSnapshot: WeightSnapshot | null = scaleConnected
    ? { timestamp: localNow(), weight: 0, weightFlow: 0, battery: 87, timerValue: null }
    : null;
  let connectionError: ConnectionError | null = null;
  let settings: DecaidSettings = { ...DEFAULT_SETTINGS, ...options.settings };

  // ---- workflow, profiles, shots, kv ------------------------------------------------
  let workflow: Workflow = fixtures.workflowGet();
  const profiles = new Map<string, ProfileRecord>();
  for (const source of TEMPLATE_SOURCES) {
    const record = buildProfileRecord(normalizeProfile(source.json), {
      isDefault: true,
      createdAt: BUNDLED_AT,
      metadata: { source: 'bundled', filename: source.filename },
    });
    profiles.set(record.id, record);
  }
  for (const record of fixtures.profilesList()) {
    if (record.isDefault || options.seedExamples !== false) profiles.set(record.id, record);
  }
  let shots: ShotRecord[] = options.seedExamples === false ? [] : [fixtures.shotRecord()];
  const kv = new Map<string, Map<string, unknown>>();
  let shotState: ShotStateEvent = {
    event: 'state',
    timestamp: localNow(),
    shotId: null,
    state: 'idle',
    machineState: null,
    machineSubstate: null,
    profileFrame: null,
    scaleConnected: false,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
  };
  const faults: Array<MockFault & { remaining: number }> = [];
  const requests: MockRequestLog[] = [];

  function machineEntry(): DeviceEntry {
    return { name: machineDevice.name, id: machineDevice.id, state: machineConnected ? 'connected' : 'disconnected', type: 'machine', available: machineConnected };
  }

  function scaleEntry(): DeviceEntry {
    return scaleConnected
      ? { name: scaleDevice.name, id: scaleDevice.id, state: 'connected', type: 'scale', available: true, connectionRole: 'primary' }
      : { name: scaleDevice.name, id: scaleDevice.id, state: 'disconnected', type: 'scale', available: false };
  }

  function devicesState(): DevicesState {
    const state = {
      timestamp: utcNow(),
      devices: [scaleEntry(), machineEntry()],
      scanning: false,
      // Not in the CafAI contract (nor the AsyncAPI spec), but Decaid sends it on battery tablets.
      charging: (devicesFixture as DevicesState & { charging?: unknown }).charging,
      connectionStatus: {
        phase: machineConnected && scaleConnected ? 'ready' : 'idle',
        foundMachines: [{ name: machineDevice.name, id: machineDevice.id, state: 'discovered', type: 'machine' }],
        foundScales: [{ name: scaleDevice.name, id: scaleDevice.id, state: 'discovered', type: 'scale' }],
        pendingAmbiguity: null,
        error: connectionError,
      },
    };
    return clone(state) as DevicesState;
  }

  function emitDevices(): void {
    emit('devices', devicesState());
  }

  function makeConnectionError(kind: string, message: string, device: DeviceEntry | null, suggestion: string | null): ConnectionError {
    return {
      kind,
      severity: kind === 'profileUploadFailed' || kind.endsWith('Disconnected') ? 'warning' : 'error',
      timestamp: utcNow(),
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? null,
      message,
      suggestion,
      details: null,
    };
  }

  function requireMachine(): void {
    if (!machineConnected) throw new MockHttpError(500, fixtures.errorMachineNotConnected() as Record<string, unknown>);
  }

  function requireProfile(id: string): ProfileRecord {
    const record = profiles.get(id);
    if (!record) throw new MockHttpError(404, { error: 'Profile not found', id });
    return record;
  }

  function sortedProfiles(records: Iterable<ProfileRecord>): ProfileRecord[] {
    return [...records].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  function requireShot(id: string): ShotRecord {
    const record = shots.find((shot) => shot.id === id);
    if (!record) throw new MockHttpError(404, { error: 'Shot not found' });
    return record;
  }

  function kvNamespace(namespace: string): Map<string, unknown> {
    let box = kv.get(namespace);
    if (!box) {
      box = new Map();
      kv.set(namespace, box);
    }
    return box;
  }

  const mock: MockDecaid = {
    clock,

    // ---- machine ----------------------------------------------------------------
    isMachineConnected: () => machineConnected,
    setMachineConnected(connected) {
      if (connected === machineConnected) return;
      machineConnected = connected;
      if (!connected) {
        connectionError = makeConnectionError(
          'machineDisconnected',
          'The machine disconnected.',
          machineEntry(),
          'Check that the DE1 is on and in Bluetooth range.',
        );
      } else if (connectionError?.kind === 'machineDisconnected') {
        connectionError = null;
      }
      emitDevices();
      if (connected) {
        snapshot = { ...snapshot, timestamp: localNow() };
        emit('machine', snapshot);
      }
    },
    getMachineSnapshot: () => clone(snapshot),
    setMachineSnapshot(next) {
      snapshot = clone(next);
      if (machineConnected) emit('machine', snapshot);
    },
    getMachineInfo() {
      requireMachine();
      return clone(machineInfo);
    },
    getShotSettings: () => clone(shotSettings),
    setShotSettings(next) {
      shotSettings = clone(next);
      if (machineConnected) emit('shotSettings', shotSettings);
    },
    getWaterLevels: () => clone(waterLevels),
    setWaterLevels(levels) {
      waterLevels = { ...waterLevels, ...levels };
      if (machineConnected) emit('waterLevels', waterLevels);
    },
    getCapabilities() {
      requireMachine();
      return [];
    },
    heartbeat() {
      heartbeatCount += 1;
      return { timeout: machineConnected ? 1800 : -1 };
    },
    get heartbeatCount() {
      return heartbeatCount;
    },
    machineCommands,
    lastProfileFrame: fixtures.machineState().profileFrame,

    // ---- scale ----------------------------------------------------------------------
    isScaleConnected: () => scaleConnected,
    setScaleConnected(connected) {
      if (connected === scaleConnected) return;
      scaleConnected = connected;
      emit('scale', { status: connected ? 'connected' : 'disconnected' });
      if (connected) {
        scaleSnapshot = { timestamp: localNow(), weight: 0, weightFlow: 0, battery: 87, timerValue: null };
        emit('scale', scaleSnapshot);
      } else {
        scaleSnapshot = null;
      }
      emitDevices();
    },
    getScaleSnapshot: () => clone(scaleSnapshot),
    setScaleWeight(next) {
      if (!scaleConnected) return;
      scaleSnapshot = clone(next);
      emit('scale', scaleSnapshot);
    },

    // ---- devices --------------------------------------------------------------------
    getDevices: () => devicesState().devices,
    getDevicesState: devicesState,
    setConnectionError(error) {
      connectionError = clone(error);
      emitDevices();
    },
    raiseConnectionError(kind, message) {
      const device = kind.startsWith('scale') ? scaleEntry() : machineEntry();
      const error = makeConnectionError(kind, message ?? `Decaid reported ${kind}.`, device, null);
      mock.setConnectionError(error);
      return clone(error);
    },
    scanDevices(quick) {
      if (quick) return [];
      // A full scan finds both devices, so a connect-by-id can follow.
      return [machineEntry(), scaleEntry()].map((entry) =>
        entry.state === 'connected' ? entry : { name: entry.name, id: entry.id, state: 'discovered', type: entry.type, available: true },
      );
    },
    connectDevice(body) {
      const json = isPlainObject(body) ? body : {};
      const deviceId = json.deviceId;
      if (typeof deviceId !== 'string' || !deviceId) throw badRequest({ error: 'Missing deviceId' });
      if (deviceId === machineDevice.id) {
        const outcome = machineConnected ? 'alreadyConnected' : 'connected';
        mock.setMachineConnected(true);
        return { deviceId, operation: 'connect', outcome, state: 'connected', connectionError: null, error: null };
      }
      if (deviceId === scaleDevice.id) {
        const outcome = scaleConnected ? 'alreadyConnected' : 'connected';
        mock.setScaleConnected(true);
        return { deviceId, operation: 'connect', outcome, state: 'connected', connectionError: null, error: null, connectionRole: 'primary' };
      }
      throw new MockHttpError(404, { error: 'Device not found' });
    },

    // ---- settings -------------------------------------------------------------------
    getSettings: () => clone(settings),
    setSettings(patch) {
      settings = { ...settings, ...patch };
    },

    // ---- workflow ---------------------------------------------------------------------
    getWorkflow: () => clone(workflow),
    updateWorkflow(body) {
      if (!isPlainObject(body)) throw badRequest({ error: 'Request body must be a JSON object' });
      try {
        validateWorkflowPatch(body);
        const merged = deepMergeJson(clone(workflow) as unknown as JsonObject, clone(body));
        workflow = normalizeWorkflow(merged);
      } catch (error) {
        throw toProfileError(error, 500);
      }
      return clone(workflow);
    },

    // ---- profiles ---------------------------------------------------------------------
    listProfiles(query) {
      const visibility = query.visibility ?? null;
      if (visibility !== null && !['visible', 'hidden', 'deleted'].includes(visibility)) {
        throw badRequest({ error: 'Invalid visibility value', message: 'Valid values: visible, hidden, deleted' });
      }
      const all = [...profiles.values()];
      let selected: ProfileRecord[];
      if (query.parentId) selected = all.filter((record) => record.parentId === query.parentId);
      else if (query.includeHidden === true || query.includeHidden === 'true') selected = all;
      else selected = all.filter((record) => record.visibility === (visibility ?? 'visible'));
      return clone(sortedProfiles(selected));
    },
    getProfile: (id) => clone(requireProfile(id)),
    createProfile(body) {
      if (!isPlainObject(body)) {
        throw new MockHttpError(500, { error: 'Internal server error', message: "type 'List<dynamic>' is not a subtype of type 'Map<String, dynamic>' in type cast" });
      }
      if (!('profile' in body)) {
        throw badRequest({ error: 'Missing required field', message: 'Request must contain "profile" field' });
      }
      try {
        const profile = normalizeProfile(body.profile);
        const parentId = typeof body.parentId === 'string' ? body.parentId : null;
        const metadata = isPlainObject(body.metadata) ? clone(body.metadata) : null;
        if (parentId !== null && !profiles.has(parentId)) {
          throw badRequest({ error: 'Invalid request', message: `Invalid argument(s): Parent profile not found: ${parentId}` });
        }
        const existing = profiles.get(profileHash(profile));
        // Decaid returns the existing record untouched: old title, metadata,
        // parentId and visibility (even hidden or deleted).
        if (existing) return clone(existing);
        const record = buildProfileRecord(profile, { parentId, metadata, createdAt: localNow() });
        profiles.set(record.id, record);
        return clone(record);
      } catch (error) {
        throw toProfileError(error, 500);
      }
    },
    updateProfile(id, body) {
      try {
        if (!isPlainObject(body)) throw new MockHttpError(400, { error: 'Invalid request', message: 'Body must be a JSON object' });
        let profile: Workflow['profile'] | null = null;
        if ('profile' in body) {
          if (body.profile === null) throw badRequest({ error: 'Invalid request', message: 'FormatException: Field "profile" cannot be null' });
          profile = normalizeProfile(body.profile);
        }
        const existing = profiles.get(id);
        if (!existing) throw badRequest({ error: 'Invalid request', message: `Invalid argument(s): Profile not found: ${id}` });
        if (existing.isDefault && profile) {
          throw badRequest({ error: 'Invalid request', message: 'Invalid argument(s): Cannot modify default profile content' });
        }
        const metadataPresent = 'metadata' in body;
        const metadata = metadataPresent ? (isPlainObject(body.metadata) ? clone(body.metadata) : null) : existing.metadata;
        const updated = buildProfileRecord(profile ?? existing.profile, {
          parentId: existing.parentId,
          visibility: existing.visibility,
          isDefault: existing.isDefault,
          createdAt: existing.createdAt,
          updatedAt: localNow(),
          metadata,
        });
        if (updated.id !== existing.id) {
          if (profiles.has(updated.id)) {
            throw badRequest({ error: 'Invalid request', message: `Invalid argument(s): Profile already exists: ${updated.id}` });
          }
          profiles.delete(existing.id);
        }
        profiles.set(updated.id, updated);
        return clone(updated);
      } catch (error) {
        throw toProfileError(error, 400);
      }
    },
    deleteProfile(id) {
      const existing = profiles.get(id);
      if (!existing) throw new MockHttpError(404, { error: 'Not found', message: `Invalid argument(s): Profile not found: ${id}` });
      profiles.set(id, { ...existing, visibility: existing.isDefault ? 'hidden' : 'deleted', updatedAt: localNow() });
      return { success: true, message: 'Profile deleted', id };
    },
    setProfileVisibility(id, body) {
      if (!isPlainObject(body) || !('visibility' in body)) {
        throw badRequest({ error: 'Missing required field', message: 'Request must contain "visibility" field' });
      }
      const visibility = body.visibility;
      if (visibility !== 'visible' && visibility !== 'hidden' && visibility !== 'deleted') {
        throw badRequest({ error: 'Invalid request', message: `Invalid argument(s): Invalid visibility value: ${String(visibility)}` });
      }
      const existing = profiles.get(id);
      if (!existing) throw badRequest({ error: 'Invalid request', message: `Invalid argument(s): Profile not found: ${id}` });
      if (existing.isDefault && visibility === 'deleted') {
        throw badRequest({ error: 'Invalid request', message: 'Invalid argument(s): Cannot delete default profiles, only hide them' });
      }
      const updated = { ...existing, visibility, updatedAt: localNow() };
      profiles.set(id, updated);
      return clone(updated);
    },
    profileLineage(id) {
      const self = profiles.get(id);
      if (!self) {
        throw new MockHttpError(500, { error: 'Internal server error', message: `Invalid argument(s): Profile not found: ${id}` });
      }
      const lineage: ProfileRecord[] = [self];
      let current = self;
      while (current.parentId) {
        const parent = profiles.get(current.parentId);
        if (!parent) break;
        lineage.unshift(parent);
        current = parent;
      }
      const addChildren = (parentId: string) => {
        for (const child of [...profiles.values()].filter((record) => record.parentId === parentId)) {
          lineage.push(child);
          addChildren(child.id);
        }
      };
      addChildren(id);
      return clone(lineage);
    },
    defaultProfiles() {
      return [...profiles.values()]
        .filter((record) => record.isDefault)
        .map((record) => ({
          filename: String(record.metadata?.filename ?? ''),
          title: record.profile.title,
          author: record.profile.author,
          notes: record.profile.notes,
          beverageType: record.profile.beverage_type,
        }));
    },
    restoreDefaultProfile(filename) {
      const record = [...profiles.values()].find((candidate) => candidate.isDefault && candidate.metadata?.filename === filename);
      if (!record) throw new MockHttpError(404, { error: 'Not found', message: `Invalid argument(s): Unknown default profile: ${filename}` });
      const restored = { ...record, visibility: 'visible', updatedAt: localNow() };
      profiles.set(record.id, restored);
      return clone(restored);
    },

    // ---- shots ------------------------------------------------------------------------
    listShots(params) {
      const limit = Number.parseInt(params.get('limit') ?? '', 10);
      const offset = Number.parseInt(params.get('offset') ?? '', 10);
      const requestedLimit = Number.isFinite(limit) ? limit : 20;
      const requestedOffset = Number.isFinite(offset) ? offset : 0;
      const ascending = params.get('order') === 'asc';
      const filters: Array<[string, (shot: ShotRecord) => string | null | undefined]> = [
        ['grinderId', (shot) => shot.workflow.context?.grinderId],
        ['grinderModel', (shot) => shot.workflow.context?.grinderModel],
        ['beanBatchId', (shot) => shot.workflow.context?.beanBatchId],
        ['coffeeName', (shot) => shot.workflow.context?.coffeeName],
        ['coffeeRoaster', (shot) => shot.workflow.context?.coffeeRoaster],
        ['profileTitle', (shot) => shot.workflow.profile.title],
      ];
      const search = params.get('search')?.toLowerCase() ?? null;
      const hasFilters = search !== null || filters.some(([name]) => params.has(name));
      const ids = params.getAll('ids').flatMap((value) => value.split(',')).filter(Boolean);
      const order = (a: ShotRecord, b: ShotRecord) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0) * (ascending ? 1 : -1);
      if (ids.length > 0 && !hasFilters) {
        // Legacy form: a bare array of full records, measurements included.
        return clone(shots.filter((shot) => ids.includes(shot.id)).sort(order));
      }
      const matching = shots
        .filter((shot) =>
          filters.every(([name, read]) => {
            const wanted = params.get(name);
            return wanted === null || read(shot) === wanted;
          }),
        )
        .filter((shot) => {
          if (search === null) return true;
          const context = shot.workflow.context ?? {};
          const haystack = [shot.workflow.profile.title, context.coffeeName, context.coffeeRoaster, context.grinderModel, shot.annotations?.espressoNotes];
          return haystack.some((value) => typeof value === 'string' && value.toLowerCase().includes(search));
        })
        .sort(order);
      const clamped = Math.min(Math.max(requestedLimit, 1), 100);
      const start = Math.max(requestedOffset, 0);
      return {
        items: matching.slice(start, start + clamped).map(withoutMeasurements),
        total: matching.length,
        limit: requestedLimit,
        offset: requestedOffset,
      };
    },
    getLatestShot() {
      const latest = [...shots].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
      return latest ? withoutMeasurements(latest) : null;
    },
    getShotIds: () => shots.map((shot) => shot.id),
    getShot: (id) => clone(requireShot(id)),
    updateShot(id, body) {
      if (!isPlainObject(body)) {
        throw new MockHttpError(500, { error: "type 'List<dynamic>' is not a subtype of type 'Map<String, dynamic>' in type cast" });
      }
      if (body.id !== null && body.id !== undefined && body.id !== id) throw badRequest({ error: 'ID in path does not match ID in body' });
      if ('measurements' in body) throw badRequest({ error: 'measurements is not editable via this endpoint' });
      if ('createdAt' in body || 'updatedAt' in body) {
        throw badRequest({ error: 'createdAt and updatedAt are system-managed and cannot be modified via this endpoint' });
      }
      const annotationsPatch = body.annotations;
      if (isPlainObject(annotationsPatch) && 'enjoyment' in annotationsPatch && annotationsPatch.enjoyment !== null) {
        const enjoyment = annotationsPatch.enjoyment;
        if (typeof enjoyment !== 'number' || Number.isNaN(enjoyment)) {
          throw badRequest({ error: 'annotations.enjoyment must be a number between 0 and 10' });
        }
        if (enjoyment < 0 || enjoyment > 10) throw badRequest({ error: `annotations.enjoyment must be between 0 and 10, got ${enjoyment}` });
      }
      const existing = requireShot(id);

      // Legacy shotNotes/metadata map onto espressoNotes/extras; canonical fields win.
      const patch: JsonObject = clone(body);
      if (isPlainObject(patch.annotations)) {
        if (!('espressoNotes' in patch.annotations) && 'shotNotes' in patch) patch.annotations.espressoNotes = patch.shotNotes;
        if (!('extras' in patch.annotations) && 'metadata' in patch) patch.annotations.extras = patch.metadata;
      } else if (!('annotations' in patch) && ('shotNotes' in patch || 'metadata' in patch)) {
        patch.annotations = {
          ...('shotNotes' in patch ? { espressoNotes: patch.shotNotes } : {}),
          ...('metadata' in patch ? { extras: patch.metadata } : {}),
        };
      }
      delete patch.shotNotes;
      delete patch.metadata;

      const merged = deepMergeJson(clone(existing) as unknown as JsonObject, patch);
      merged.id = id;
      if (isPlainObject(merged.annotations)) {
        for (const key of Object.keys(merged.annotations)) {
          if (merged.annotations[key] === null) delete merged.annotations[key];
        }
        const notes = merged.annotations.espressoNotes;
        const extras = merged.annotations.extras;
        if (notes !== undefined) merged.shotNotes = notes;
        else delete merged.shotNotes;
        if (extras !== undefined) merged.metadata = extras;
        else delete merged.metadata;
      } else {
        delete merged.annotations;
        delete merged.shotNotes;
        delete merged.metadata;
      }
      for (const key of ['stopReason', 'shotNotes', 'metadata']) {
        if (merged[key] === null) delete merged[key];
      }

      const contentOf = (record: JsonObject) => {
        const copy = clone(record);
        delete copy.updatedAt;
        const annotations = copy.annotations;
        if (isPlainObject(annotations) && isPlainObject(annotations.extras)) {
          for (const key of BOOKKEEPING_EXTRAS) delete annotations.extras[key];
        }
        delete copy.metadata;
        return stableStringify(copy);
      };
      const changed = contentOf(merged) !== contentOf(existing as unknown as JsonObject);
      merged.updatedAt = changed ? utcNow() : existing.updatedAt;
      const updated = merged as unknown as ShotRecord;
      shots = shots.map((shot) => (shot.id === id ? updated : shot));
      return clone(updated);
    },
    deleteShot(id) {
      requireShot(id);
      shots = shots.filter((shot) => shot.id !== id);
      return { success: true, id };
    },
    addShot(record) {
      shots = [...shots.filter((shot) => shot.id !== record.id), clone(record)];
    },

    // ---- kv -----------------------------------------------------------------------------
    kvKeys: (namespace) => [...kvNamespace(namespace).keys()],
    kvAll(namespace) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of kvNamespace(namespace)) if (value !== null && value !== undefined) result[key] = clone(value);
      return result;
    },
    kvGet: (namespace, key) => clone(kvNamespace(namespace).get(key) ?? null),
    kvSet(namespace, key, bodyText) {
      if (byteLength(bodyText) > MAX_KV_BODY_BYTES) throw new MockHttpError(413, { error: 'Request body is too large' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        // jsonDecode throws outside any handler try/catch: shelf's plain 500.
        throw new MockHttpError(500, null, { plainText: 'Internal Server Error' });
      }
      kvNamespace(namespace).set(key, parsed ?? bodyText);
    },
    kvDelete(namespace, key) {
      kvNamespace(namespace).delete(key);
    },

    // ---- shot state -------------------------------------------------------------------
    getShotState: () => clone(shotState),
    publishShotState(event) {
      shotState = clone(event);
      emit('shotState', shotState);
    },

    // ---- faults and logs ------------------------------------------------------------------
    failNext(fault) {
      faults.push({ ...fault, body: clone(fault.body), remaining: fault.times ?? 1 });
    },
    takeFault(method, path) {
      const index = faults.findIndex(
        (fault) =>
          (!fault.method || fault.method.toUpperCase() === method.toUpperCase()) &&
          (typeof fault.path === 'string' ? fault.path === path : fault.path.test(path)),
      );
      if (index < 0) return null;
      const fault = faults[index]!;
      fault.remaining -= 1;
      if (fault.remaining <= 0) faults.splice(index, 1);
      return fault;
    },
    logRequest(entry) {
      requests.push({ ...entry, at: clock.now() });
      if (requests.length > MAX_LOGGED_REQUESTS) requests.splice(0, requests.length - MAX_LOGGED_REQUESTS);
    },
    requests,

    // ---- frames ---------------------------------------------------------------------------
    on(channel, listener) {
      const set = listeners[channel] as Set<typeof listener>;
      set.add(listener);
      return () => void set.delete(listener);
    },
    dropSockets(channel) {
      for (const listener of [...dropListeners]) listener(channel ?? null);
    },
    onDropSockets(listener) {
      dropListeners.add(listener);
      return () => void dropListeners.delete(listener);
    },
    socketCount: (channel) => sockets[channel],
    noteSocket(channel, delta) {
      sockets[channel] = Math.max(0, sockets[channel] + delta);
    },
  };

  return mock;
}

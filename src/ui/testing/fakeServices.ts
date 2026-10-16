/**
 * In-memory fakes of every service, for UI tests and preview pages.
 * Not shipped: only tests and dev previews import this file. No vitest
 * imports here, so previews can use it in the browser.
 */
import type {
  Bean,
  BeanBatch,
  CommandableState,
  DecaidClient,
  DecaidSettings,
  DeviceEntry,
  EnjoymentScale,
  Heartbeat,
  HostEnvironment,
  LiveSample,
  PaginatedShots,
  PluginInfo,
  PresenceSettings,
  ShotLifecycleEvent,
  SteamRecordSummary,
  TelemetryState,
  TelemetryStore,
  WakeSchedule,
  Workflow,
} from '../../api/types.ts';
import { createAppearanceStore, type AppearanceStore } from '../../app/appearance.ts';
import { createTemperatureUnitStore, type TemperatureUnitStore } from '../../app/temperatureUnit.ts';
import { clone } from '../../util/clone.ts';
import type { CoachController, CoachState, Services } from '../../app/types.ts';
import type { PluginDirectory } from '../../api/plugins.ts';
import type { ModelInfo } from '../../llm/types.ts';
import type {
  Bag,
  CafaiExport,
  CareRecord,
  ConversationRecord,
  IterationRecord,
  ProfileVersion,
  Settings,
  Storage,
} from '../../storage/types.ts';

export interface Call {
  method: string;
  args: unknown[];
}

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    on(listener: (value: T) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(value: T) {
      for (const listener of [...listeners]) listener(value);
    },
    get size() {
      return listeners.size;
    },
  };
}

export const IDLE_TELEMETRY: TelemetryState = {
  sockets: {
    machine: 'open',
    scale: 'open',
    devices: 'open',
    shotState: 'open',
    waterLevels: 'open',
    shotSettings: 'open',
  },
  machineConnected: true,
  scaleConnected: true,
  machine: {
    timestamp: '2026-10-03T08:00:00.000000',
    state: { state: 'idle', substate: 'idle' },
    flow: 0,
    pressure: 0,
    targetFlow: 0,
    targetPressure: 0,
    mixTemperature: 92.1,
    groupTemperature: 92.4,
    targetMixTemperature: 92,
    targetGroupTemperature: 92.5,
    profileFrame: 0,
    steamTemperature: 140,
  },
  scale: { timestamp: '2026-10-03T08:00:00.000000', weight: 0, weightFlow: 0, battery: 80, timerValue: null },
  waterLevels: { currentLevel: 40, refillLevel: 5 },
  shotSettings: null,
  shotState: null,
  devices: null,
  connectionError: null,
  timeToReady: null,
};

export interface FakeTelemetry extends TelemetryStore {
  setState(patch: Partial<TelemetryState>): void;
  emitSample(sample: LiveSample): void;
  emitShot(event: ShotLifecycleEvent): void;
  readonly sampleListenerCount: number;
}

export function createFakeTelemetry(initial: Partial<TelemetryState> = {}): FakeTelemetry {
  let state: TelemetryState = { ...IDLE_TELEMETRY, ...initial };
  const changes = emitter<void>();
  const samples = emitter<LiveSample>();
  const shots = emitter<ShotLifecycleEvent>();
  return {
    getState: () => state,
    subscribe: (listener) => changes.on(listener),
    onSample: (listener) => samples.on(listener),
    onShot: (listener) => shots.on(listener),
    start() {},
    stop() {},
    watchTimeToReady() {},
    setState(patch) {
      state = { ...state, ...patch };
      changes.emit();
    },
    emitSample: (sample) => samples.emit(sample),
    emitShot: (event) => shots.emit(event),
    get sampleListenerCount() {
      return samples.size;
    },
  };
}

export const SAMPLE_WORKFLOW: Workflow = {
  id: 'workflow-1',
  name: 'Workflow',
  description: 'Description',
  profile: {
    version: '2',
    title: 'Blooming Espresso',
    notes: '',
    author: 'Decent',
    beverage_type: 'espresso',
    steps: [],
    target_volume: 0,
    target_weight: 36,
    target_volume_count_start: 2,
    tank_temperature: 0,
  },
  context: { targetDoseWeight: 18, targetYield: 36 },
  steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 },
  hotWaterData: { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
  rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
};

export interface FakeDecaid extends DecaidClient {
  calls: Call[];
  /** Make the next call to `method` reject with `error`. */
  failNext(method: string, error: Error): void;
  /** Decaid's sleep and wake settings as this fake holds them; tests may set them before rendering. */
  presence: PresenceSettings;
  /** What listShots answers, whatever it is asked (the care reminders read its total). */
  shotPage: PaginatedShots;
  /** Decaid's steam records as the care reminders count them: their ids and the newest. */
  steams: { ids: string[]; latest: SteamRecordSummary | null };
}

export function createFakeDecaid(): FakeDecaid {
  const calls: Call[] = [];
  const failures = new Map<string, Error>();
  const call = async <T>(method: string, args: unknown[], value: T): Promise<T> => {
    calls.push({ method, args });
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
    return value;
  };
  const kvData = new Map<string, unknown>();
  const settingsState: DecaidSettings = { gatewayMode: 'tracking' };
  const plugins: PluginInfo[] = [];
  const beans: Bean[] = [];
  const batchesByBean = new Map<string, BeanBatch[]>();
  let beanSeq = 0;
  let batchSeq = 0;
  let scheduleSeq = 0;
  /** Like `call`, but changes the fake's state only when the call does not fail. */
  const act = async <T>(method: string, args: unknown[], apply: () => T): Promise<T> => {
    await call(method, args, undefined);
    return apply();
  };
  const fake: FakeDecaid = {
    calls,
    failNext: (method, error) => void failures.set(method, error),
    // Decaid's own defaults (settings_controller.dart:64-66 at aab5f93).
    presence: { userPresenceEnabled: true, sleepTimeoutMinutes: 30, schedules: [], keepAwakeUntil: null },
    shotPage: { items: [], total: 0, limit: 20, offset: 0 },
    steams: { ids: [], latest: null },
    getPresenceSettings: () => act('getPresenceSettings', [], () => clone(fake.presence)),
    updatePresenceSettings: (patch) =>
      act('updatePresenceSettings', [patch], () => {
        const minutes = patch.sleepTimeoutMinutes;
        fake.presence = {
          ...fake.presence,
          ...(patch.userPresenceEnabled === undefined ? {} : { userPresenceEnabled: patch.userPresenceEnabled }),
          ...(minutes === undefined ? {} : { sleepTimeoutMinutes: Math.min(240, Math.max(0, minutes)) }),
        };
        return { userPresenceEnabled: fake.presence.userPresenceEnabled, sleepTimeoutMinutes: fake.presence.sleepTimeoutMinutes };
      }),
    addWakeSchedule: (request) =>
      act('addWakeSchedule', [request], () => {
        scheduleSeq += 1;
        const schedule: WakeSchedule = {
          id: `schedule_${scheduleSeq}`,
          time: request.time,
          daysOfWeek: [...request.daysOfWeek].sort((a, b) => a - b),
          enabled: request.enabled,
          ...(request.keepAwakeFor ? { keepAwakeFor: request.keepAwakeFor } : {}),
        };
        fake.presence = { ...fake.presence, schedules: [...fake.presence.schedules, schedule] };
        return clone(schedule);
      }),
    updateWakeSchedule: (id, patch) =>
      act('updateWakeSchedule', [id, patch], () => {
        const existing = fake.presence.schedules.find((schedule) => schedule.id === id);
        if (!existing) throw new Error('Schedule not found');
        const { keepAwakeFor: _old, ...rest } = existing;
        const keepAwakeFor = patch.keepAwakeFor === undefined ? existing.keepAwakeFor : (patch.keepAwakeFor ?? undefined);
        const updated: WakeSchedule = {
          ...rest,
          ...(patch.time === undefined ? {} : { time: patch.time }),
          ...(patch.daysOfWeek === undefined ? {} : { daysOfWeek: [...patch.daysOfWeek].sort((a, b) => a - b) }),
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(keepAwakeFor ? { keepAwakeFor } : {}),
        };
        fake.presence = { ...fake.presence, schedules: fake.presence.schedules.map((schedule) => (schedule.id === id ? updated : schedule)) };
        return clone(updated);
      }),
    deleteWakeSchedule: (id) =>
      act('deleteWakeSchedule', [id], () => {
        if (!fake.presence.schedules.some((schedule) => schedule.id === id)) throw new Error('Schedule not found');
        fake.presence = { ...fake.presence, schedules: fake.presence.schedules.filter((schedule) => schedule.id !== id) };
      }),
    httpOrigin: 'http://localhost:8080',
    wsOrigin: 'ws://localhost:8080',
    getInfo: () =>
      call('getInfo', [], {
        commit: 'a45961b',
        commitShort: 'a45961b',
        branch: 'main',
        buildTime: '',
        version: '0.9.0',
        buildNumber: '1',
        appStore: false,
        fullVersion: '0.9.0+1',
      }),
    getSettings: () => call('getSettings', [], settingsState),
    updateSettings: (patch) => call('updateSettings', [patch], Object.assign(settingsState, patch)),
    listPlugins: () => call('listPlugins', [], plugins),
    getPluginEndpoint: <T>(pluginId: string, endpoint: string) => call<T | null>('getPluginEndpoint', [pluginId, endpoint], null),
    getMachineInfo: () =>
      call('getMachineInfo', [], { version: '1358', model: 'DE1Pro', serialNumber: '1', GHC: false }),
    getMachineState: () => call('getMachineState', [], IDLE_TELEMETRY.machine!),
    getCapabilities: () => call('getCapabilities', [], []),
    setMachineState: (state: CommandableState) => call('setMachineState', [state], undefined),
    heartbeat: () => call('heartbeat', [], { timeout: 1800 }),
    getDevices: () => call('getDevices', [], []),
    tareScale: () => call('tareScale', [], undefined),
    scanDevices: (options) => call('scanDevices', [options], [] as DeviceEntry[]),
    connectDevice: (deviceId, connectionRole) => call('connectDevice', [deviceId, connectionRole], undefined),
    connectKind: (kind) => call('connectKind', [kind], [] as DeviceEntry[]),
    getWorkflow: () => call('getWorkflow', [], SAMPLE_WORKFLOW),
    updateWorkflow: (patch) => call('updateWorkflow', [patch], SAMPLE_WORKFLOW),
    listProfiles: (options) => call('listProfiles', [options], []),
    getProfile: (id) => call('getProfile', [id], Promise.reject(new Error('not found')) as never),
    createProfile: (request) =>
      call('createProfile', [request], {
        id: 'profile:00000000000000000000',
        profile: request.profile,
        metadataHash: '',
        compoundHash: '',
        parentId: request.parentId ?? null,
        visibility: 'visible',
        isDefault: false,
        createdAt: '',
        updatedAt: '',
        metadata: request.metadata ?? null,
      }),
    updateProfile: (id, body) => call('updateProfile', [id, body], Promise.reject(new Error('unsupported')) as never),
    listShots: (options) => call('listShots', [options], clone(fake.shotPage)),
    listSteamIds: () => call('listSteamIds', [], [...fake.steams.ids]),
    getLatestSteam: () => call('getLatestSteam', [], fake.steams.latest === null ? null : clone(fake.steams.latest)),
    getLatestShot: () => call('getLatestShot', [], null),
    getShot: (id) => call('getShot', [id], Promise.reject(new Error('not found')) as never),
    updateShot: (id, patch) => call('updateShot', [id, patch], Promise.reject(new Error('unsupported')) as never),
    probeEnjoymentScale: () => call<EnjoymentScale | null>('probeEnjoymentScale', [], 10),
    listBeans: () => call('listBeans', [], beans),
    listBatches: (beanId) => call('listBatches', [beanId], batchesByBean.get(beanId) ?? []),
    listAllBatches: (options) => call('listAllBatches', [options], [...batchesByBean.values()].flat()),
    createBean: (request) => {
      beanSeq += 1;
      const bean: Bean = { id: `bean_${beanSeq}`, roaster: request.roaster, name: request.name, country: request.country, processing: request.processing, notes: request.notes };
      beans.push(bean);
      return call('createBean', [request], bean);
    },
    createBatch: (beanId, request) => {
      batchSeq += 1;
      const batch: BeanBatch = { id: `batch_${batchSeq}`, beanId, roastDate: request.roastDate ?? null, roastLevel: request.roastLevel ?? null };
      batchesByBean.set(beanId, [...(batchesByBean.get(beanId) ?? []), batch]);
      return call('createBatch', [beanId, request], batch);
    },
    kv: {
      list: async (ns) => [...kvData.keys()].filter((k) => k.startsWith(`${ns}/`)).map((k) => k.slice(ns.length + 1)),
      getAll: async (ns) => ({
        notModified: false,
        etag: null,
        data: Object.fromEntries([...kvData].filter(([k]) => k.startsWith(`${ns}/`)).map(([k, v]) => [k.slice(ns.length + 1), v])),
      }),
      get: async <T>(ns: string, key: string) => (kvData.get(`${ns}/${key}`) as T | undefined) ?? null,
      set: async (ns, key, value) => void kvData.set(`${ns}/${key}`, value),
      delete: async (ns, key) => void kvData.delete(`${ns}/${key}`),
    },
  };
  return fake;
}

export interface FakeStorage extends Storage {
  apiKey: string | null;
}

export function createFakeStorage(seed: Partial<CafaiExport> = {}): FakeStorage {
  const bags = new Map<string, Bag>((seed.bags ?? []).map((b) => [b.id, b]));
  const versions = new Map<string, ProfileVersion>((seed.versions ?? []).map((v) => [v.id, v]));
  const iterations = new Map<string, IterationRecord>((seed.iterations ?? []).map((i) => [i.id, i]));
  const conversations = new Map<string, ConversationRecord>((seed.conversations ?? []).map((c) => [c.id, c]));
  const care = new Map<string, CareRecord>((seed.care ?? []).map((record) => [record.id, record]));
  let settings: Settings = seed.settings ?? {
    model: 'claude-opus-5-5',
    grinderName: null,
    grinderSetting: null,
    activeBagId: null,
  };
  const storage: FakeStorage = {
    apiKey: null,
    bags: {
      list: async () => [...bags.values()],
      get: async (id) => bags.get(id),
      put: async (bag) => void bags.set(bag.id, bag),
    },
    versions: {
      listByBag: async (bagId) =>
        [...versions.values()].filter((v) => v.bagId === bagId).sort((a, b) => a.version - b.version),
      get: async (id) => versions.get(id),
      put: async (version) => void versions.set(version.id, version),
    },
    iterations: {
      listByBag: async (bagId) =>
        [...iterations.values()].filter((i) => i.bagId === bagId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      listAll: async () => [...iterations.values()],
      get: async (id) => iterations.get(id),
      put: async (record) => void iterations.set(record.id, record),
    },
    conversations: {
      get: async (id) => conversations.get(id),
      put: async (conversation) => void conversations.set(conversation.id, conversation),
    },
    settings: {
      get: async () => settings,
      update: async (patch) => (settings = { ...settings, ...patch }),
    },
    care: {
      list: async () => [...care.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((record) => clone(record)),
      put: async (record) => void care.set(record.id, clone(record)),
    },
    secrets: {
      getApiKey: async () => storage.apiKey,
      setApiKey: async (key) => void (storage.apiKey = key),
      forgetApiKey: async () => void (storage.apiKey = null),
    },
    porter: {
      exportAll: async () => ({
        format: 'cafai-export',
        schemaVersion: 1,
        exportedAt: new Date(0).toISOString(),
        appVersion: '0.0.0',
        settings,
        bags: [...bags.values()],
        versions: [...versions.values()],
        iterations: [...iterations.values()],
        conversations: [...conversations.values()],
        care: [...care.values()],
      }),
      importAll: async () => ({ imported: 0 }),
    },
    mirror: {
      schedulePush() {},
      pushNow: async () => {},
      pull: async () => null,
      lastPushAt: null,
      lastError: null,
      // Knows it holds no backup: About says "Not backed up yet".
      backupKnown: true,
      subscribe: () => () => undefined,
    },
    // The choice (Settings.keepKeyInDecaid) is what drives the switch; this fake's mechanics
    // are a no-op by default (saving or forgetting changes the key here only, and Decaid always
    // takes it) so tests spy on setOn, saveKey and forgetKey to see what SettingsScreen asked for.
    keyBackup: {
      setOn: async () => {},
      saveKey: async (key) => {
        await storage.secrets.setApiKey(key);
        return true;
      },
      forgetKey: async () => {
        await storage.secrets.forgetApiKey();
        return true;
      },
      restoreIfMissing: async () => false,
    },
  };
  return storage;
}

export const EMPTY_COACH_STATE: CoachState = {
  ready: true,
  bags: [],
  activeBag: null,
  activeVersion: null,
  versions: [],
  phase: 'no_bag',
  messages: [],
  busy: false,
  hasApiKey: true,
  error: null,
  canUndo: false,
};

export interface FakeCoach extends CoachController {
  calls: Call[];
  setState(patch: Partial<CoachState>): void;
}

export function createFakeCoach(initial: Partial<CoachState> = {}): FakeCoach {
  let state: CoachState = { ...EMPTY_COACH_STATE, ...initial };
  const changes = emitter<void>();
  const calls: Call[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
    };
  return {
    calls,
    getState: () => state,
    subscribe: (listener) => changes.on(listener),
    setState(patch) {
      state = { ...state, ...patch };
      changes.emit();
    },
    newBag: record('newBag'),
    selectBag: record('selectBag'),
    sendText: record('sendText'),
    pickTemplate: record('pickTemplate'),
    answerOptions: record('answerOptions'),
    confirmChange: record('confirmChange'),
    declineChange: record('declineChange'),
    undo: record('undo'),
    rateShot: record('rateShot'),
    setShotTds: record('setShotTds'),
    pickBean: record('pickBean'),
    skipBeanPick: record('skipBeanPick'),
    readBagPhoto: record('readBagPhoto'),
    confirmBag: record('confirmBag'),
    addGrinder: record('addGrinder'),
    declineGrinder: record('declineGrinder'),
    retry: record('retry'),
    dismissError: () => void calls.push({ method: 'dismissError', args: [] }),
    refresh: record('refresh'),
  };
}

export interface FakePluginDirectory extends PluginDirectory {
  /** Replace the loaded set directly, notifying subscribers (refresh() is a no-op on this fake). */
  setLoaded(ids: Iterable<string>): void;
}

export function createFakePluginDirectory(initial: Iterable<string> = []): FakePluginDirectory {
  let loaded = new Set(initial);
  const changes = emitter<void>();
  return {
    isLoaded: (id) => loaded.has(id),
    refresh: async () => {},
    subscribe: (listener) => changes.on(listener),
    setLoaded(ids) {
      loaded = new Set(ids);
      changes.emit();
    },
  };
}

export const FAKE_MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    note: 'Sharpest advice.',
    inputPerMTok: 4,
    outputPerMTok: 20,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    note: 'Cheapest and quickest.',
    inputPerMTok: 1,
    outputPerMTok: 5,
    supportsEffort: false,
  },
];

export interface FakeServices extends Services {
  decaid: FakeDecaid;
  telemetry: FakeTelemetry;
  storage: FakeStorage;
  coach: FakeCoach;
  heartbeat: Heartbeat & { count: number };
  host: HostEnvironment & { exits: number };
  /** The real store, over the fake settings repository above. */
  appearance: AppearanceStore;
  /** The real store too: `storage.settings.temperatureUnit` starts it (D-TEMP-2). */
  temperatureUnit: TemperatureUnitStore;
  plugins: FakePluginDirectory;
}

export function createFakeServices(options: {
  telemetry?: Partial<TelemetryState>;
  coach?: Partial<CoachState>;
  storage?: Partial<CafaiExport>;
  insideDecaid?: boolean;
  /** Decaid's platform (HostEnvironment.platform); inside Decaid a Decent tablet's, 'android', unless given. */
  platform?: string | null;
} = {}): FakeServices {
  const heartbeat = {
    count: 0,
    notify() {
      heartbeat.count += 1;
    },
  };
  const host = {
    insideDecaid: options.insideDecaid ?? false,
    hostVersion: options.insideDecaid ? '0.9.0' : null,
    platform: options.platform !== undefined ? options.platform : options.insideDecaid ? 'android' : null,
    settingsUrl: 'http://localhost:8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI',
    exits: 0,
    exitToSkinSwitcher() {
      host.exits += 1;
    },
  };
  const storage = createFakeStorage(options.storage);
  return {
    decaid: createFakeDecaid(),
    telemetry: createFakeTelemetry(options.telemetry),
    heartbeat,
    host,
    storage,
    coach: createFakeCoach(options.coach),
    models: FAKE_MODELS,
    appVersion: '0.1.0-test',
    appearance: createAppearanceStore(storage.settings, options.storage?.settings?.appearance),
    temperatureUnit: createTemperatureUnitStore(storage.settings, options.storage?.settings?.temperatureUnit),
    plugins: createFakePluginDirectory(),
  };
}

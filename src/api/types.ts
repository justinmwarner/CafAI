/**
 * Decaid wire types and the client interfaces CafAI codes against.
 *
 * Verified against Decaid a45961b (docs/verified/02-api.md) and real 0.8.6
 * captures; the Dart code wins where the OpenAPI/AsyncAPI specs drift. Enums
 * are open: unknown strings must be tolerated, never crash a screen.
 *
 * Rules every implementation follows:
 *   - API origin: `http://${localStorage.reaHostname || location.hostname}:8080`.
 *   - No custom request headers (CORS allow-list); Content-Type and
 *     If-None-Match are fine.
 *   - A `null` 200 body is valid (state change, tare, KV miss); 404/500 may
 *     be plain text.
 *   - Machine link state comes only from ws/v1/devices, never from silence.
 *   - Telemetry timestamps are local and zone-less; shot createdAt/updatedAt
 *     and devices timestamps are UTC with Z. Never subtract one from the other.
 */
import type { ProfileJson } from '../coach/types.ts';

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export type MachineStateName =
  | 'booting'
  | 'busy'
  | 'idle'
  | 'schedIdle'
  | 'sleeping'
  | 'heating'
  | 'preheating'
  | 'espresso'
  | 'hotWater'
  | 'flush'
  | 'steam'
  | 'steamRinse'
  | 'skipStep'
  | 'cleaning'
  | 'descaling'
  | 'calibration'
  | 'selfTest'
  | 'airPurge'
  | 'needsWater'
  | 'error'
  | 'fwUpgrade'
  | (string & {});

export type MachineSubstate =
  | 'idle'
  | 'preparingForShot'
  | 'preinfusion'
  | 'pouring'
  | 'pouringDone'
  | 'cleaningStart'
  | 'cleaningGroup'
  | 'cleanSoaking'
  | 'cleaningSteam'
  | 'pausedSteam'
  | 'puffing'
  | (string & {});

/** States a skin may command with PUT /api/v1/machine/state/{state}. `idle` stops anything and wakes. */
export type CommandableState = 'espresso' | 'steam' | 'hotWater' | 'flush' | 'idle' | 'sleeping' | 'skipStep';

export interface MachineInfo {
  /** Firmware build number as a string, e.g. "1358" (not semver). */
  version: string;
  /** Enum name: "DE1" | "DE1Plus" | "DE1Pro" | "DE1XL" | "DE1Cafe" | "Bengle" | ... */
  model: string;
  serialNumber: string;
  /** Group-head controller fitted: the machine has physical start buttons. */
  GHC: boolean;
  extra?: { refillKit?: boolean; voltage?: number; [key: string]: unknown };
}

/** One machine telemetry frame (ws/v1/machine/snapshot and GET /machine/state). */
export interface MachineSnapshot {
  /** Local time, no zone, microseconds: "2026-09-29T12:53:54.216425". */
  timestamp: string;
  state: { state: MachineStateName; substate: MachineSubstate };
  /** ml/s */
  flow: number;
  /** bar */
  pressure: number;
  /** 0 during pressure-pump frames. */
  targetFlow: number;
  /** 0 during flow-pump frames. */
  targetPressure: number;
  /** °C; not the outlet temperature during hot water. */
  mixTemperature: number;
  /** °C */
  groupTemperature: number;
  /** °C; meaningless during preparingForShot. */
  targetMixTemperature: number;
  targetGroupTemperature: number;
  /** 0-based profile step index; stale until the first step starts. */
  profileFrame: number;
  /** Integer °C. */
  steamTemperature: number;
}

/** The machine readings a snapshot carries as numbers. */
export type MachineReading =
  | 'flow'
  | 'pressure'
  | 'targetFlow'
  | 'targetPressure'
  | 'mixTemperature'
  | 'groupTemperature'
  | 'targetMixTemperature'
  | 'targetGroupTemperature'
  | 'profileFrame'
  | 'steamTemperature';

/** A parsed telemetry frame: a reading Decaid did not send is null, never 0 (5.8). */
export type MachineFrame = Omit<MachineSnapshot, MachineReading> & { [K in MachineReading]: number | null };

export interface WaterLevels {
  /** mm */
  currentLevel: number;
  refillLevel: number;
}

/** Read from ws/v1/machine/shotSettings (there is no REST GET). */
export interface ShotSettings {
  steamSetting: number;
  targetSteamTemp: number;
  targetSteamDuration: number;
  targetHotWaterTemp: number;
  targetHotWaterVolume: number;
  targetHotWaterDuration: number;
  targetShotVolume: number;
  groupTemp: number;
}

export interface HeartbeatResponse {
  /** Seconds left before auto-sleep, or -1 (presence disabled / no machine). */
  timeout: number;
}

// ---------------------------------------------------------------------------
// Scale, shot state, devices
// ---------------------------------------------------------------------------

export interface WeightSnapshot {
  timestamp: string;
  /** g */
  weight: number;
  /** g/s */
  weightFlow: number;
  battery: number | null;
  /** ms since the scale timer started (Decaid starts it at pour start). */
  timerValue: number | null;
}

/** ws/v1/scale/snapshot frames: branch on `status` in frame. */
export type ScaleWsFrame = { status: 'connected' | 'disconnected' } | WeightSnapshot;

export interface ShotDecision {
  kind: 'advance' | 'stop' | 'abort' | 'terminal' | 'finalize' | (string & {});
  /** Open set: targetWeight, targetVolume, apiStop, appStop, machineEnded, profileAdvance, ... */
  reason: string;
  details: string | null;
  data: Record<string, unknown> | null;
}

/** ws/v1/machine/shotState frames. `shotId` equals the persisted ShotRecord.id. */
export interface ShotStateEvent {
  event: 'state' | 'decision' | 'terminal' | (string & {});
  timestamp: string;
  shotId: string | null;
  state: 'idle' | 'preheating' | 'pouring' | 'stopping' | 'finished' | (string & {});
  machineState: MachineStateName | null;
  machineSubstate: MachineSubstate | null;
  profileFrame: number | null;
  scaleConnected: boolean;
  scaleLost: boolean;
  machineHasAutonomousSAW: boolean;
  decision: ShotDecision | null;
}

export interface DeviceEntry {
  /** Empty when Decaid's reply gave none CafAI could read. */
  name: string;
  id: string;
  state: 'discovered' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | (string & {});
  type: 'machine' | 'scale' | 'sensor' | 'grinder' | (string & {});
  /** false = remembered but not present; absent when Decaid's reply could not be read. */
  available?: boolean;
  /** A connected scale's role: an auxiliary (dosing) scale is never the brewing scale. */
  connectionRole?: 'primary' | 'auxiliary' | (string & {});
}

export interface ConnectionError {
  /** e.g. machineDisconnected, scaleConnectFailed, profileUploadFailed, adapterOff ... */
  kind: string;
  severity: 'warning' | 'error' | (string & {});
  timestamp: string;
  deviceId: string | null;
  deviceName: string | null;
  message: string;
  suggestion: string | null;
  details: Record<string, unknown> | null;
}

/** ws/v1/devices frames: the authoritative link state. */
export interface DevicesState {
  /** UTC with Z. */
  timestamp: string;
  devices: DeviceEntry[];
  scanning: boolean;
  connectionStatus: {
    phase: 'idle' | 'scanning' | 'connectingMachine' | 'connectingScale' | 'ready' | (string & {});
    foundMachines: Array<Pick<DeviceEntry, 'name' | 'id' | 'state' | 'type'>>;
    foundScales: Array<Pick<DeviceEntry, 'name' | 'id' | 'state' | 'type'>>;
    pendingAmbiguity: 'machinePicker' | 'scalePicker' | null;
    error: ConnectionError | null;
  };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Every key is omitted by Decaid when null. On PUT, an explicit null clears a
 * field (except targetYield, which must stay a number; 0 = off).
 */
export interface WorkflowContext {
  targetDoseWeight?: number;
  /** THE stop-at-weight target in grams. A JSON number; 0 = off; never null. */
  targetYield?: number;
  targetWaterVolume?: number;
  grinderId?: string | null;
  grinderModel?: string | null;
  /** A string on the wire. */
  grinderSetting?: string | null;
  /** The linked grinder's burrs; Decaid fills it when a shot is stored (on main after v0.8.8). */
  grinderBurrs?: string | null;
  beanBatchId?: string | null;
  coffeeName?: string | null;
  coffeeRoaster?: string | null;
  finalBeverageType?: string;
  baristaName?: string;
  drinkerName?: string;
  extras?: Record<string, unknown>;
}

/**
 * The drink presets Decaid keeps on the workflow, as read: a field Decaid
 * sent that CafAI could not read is null, never a default (D95), so a screen
 * can say it does not know. Steam temperature 0, or anything below 135, is
 * steam off (de1_controller.dart:575 at aab5f93).
 */
export interface SteamSettings {
  targetTemperature: number | null;
  duration: number | null;
  flow: number | null;
  /** The rest (stopAtTemperature) CafAI does not read. */
  [key: string]: unknown;
}

export interface HotWaterData {
  targetTemperature: number | null;
  duration: number | null;
  volume: number | null;
  flow: number | null;
}

export interface RinseData {
  targetTemperature: number | null;
  duration: number | null;
  flow: number | null;
}

/** The profile as Decaid returns it (numbers; version may be null on odd records). */
export type WireProfile = Omit<ProfileJson, 'version'> & { version: string | null };

/** The workflow: only what CafAI reads (its id, name and description it does not). */
export interface Workflow {
  profile: WireProfile;
  context?: WorkflowContext;
  steamSettings: SteamSettings;
  hotWaterData: HotWaterData;
  rinseData: RinseData;
  [key: string]: unknown;
}

/**
 * PUT /api/v1/workflow body. Deep-merged: objects merge key by key, arrays are
 * replaced wholesale. So a profile must ALWAYS be complete (all ten keys);
 * omitted profile keys would be inherited from the previous profile. A drink
 * field goes out as a number or not at all: Decaid refuses null.
 */
export interface WorkflowPatch {
  profile?: ProfileJson;
  context?: WorkflowContext;
  steamSettings?: { targetTemperature?: number; duration?: number; flow?: number };
  hotWaterData?: { targetTemperature?: number; duration?: number; volume?: number; flow?: number };
  rinseData?: { targetTemperature?: number; duration?: number; flow?: number };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** A profile record: only what CafAI reads. */
export interface ProfileRecord {
  /** "profile:" + 20 lowercase hex chars: a hash of execution content (not title/notes/author). */
  id: string;
  profile: WireProfile;
  /** Null for a record without a parent; absent when Decaid's reply could not be read (D95). */
  parentId?: string | null;
  [key: string]: unknown;
}

/**
 * POST /api/v1/profiles body. If a record with the same content already
 * exists, Decaid returns THAT record (201) with its old title/visibility.
 */
export interface ProfileCreateRequest {
  profile: ProfileJson;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export interface ShotAnnotations {
  /** g; at shot end this is just workflow.context.targetDoseWeight. */
  actualDoseWeight?: number;
  /** g; settled post-shot weight. */
  actualYield?: number;
  drinkTds?: number;
  drinkEy?: number;
  /** 0-10 on Decaid. */
  enjoyment?: number;
  espressoNotes?: string;
  extras?: Record<string, unknown>;
}

export interface ShotRecordSummary {
  id: string;
  /** Shot start, local, no zone. */
  timestamp: string;
  /** UTC with Z. */
  createdAt: string;
  updatedAt: string;
  /** The workflow as it stood at the END of the shot, including the full profile. */
  workflow: Workflow;
  annotations?: ShotAnnotations;
  /** Open set: targetWeight | targetVolume | apiStop | appStop | machineEnded | error */
  stopReason?: string;
}

export interface ShotSnapshot {
  machine: MachineSnapshot;
  scale: WeightSnapshot | null;
  /** ml pumped since frame >= target_volume_count_start; null on imports. */
  volume: number | null;
}

/**
 * A full shot. Measurements start at preheat (preparingForShot, stale
 * profileFrame) and stop at the stop decision; sampling is ~3-5 Hz and
 * irregular, so always resample by timestamp.
 */
export interface ShotRecord extends ShotRecordSummary {
  measurements: ShotSnapshot[];
}

export interface PaginatedShots {
  items: ShotRecordSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ShotUpdateRequest {
  annotations?: ShotAnnotations | null;
}

/**
 * A steam record without its measurements (GET /api/v1/steams/latest): one
 * per steaming, opened when the machine enters steam and kept when it leaves
 * (steam_sequencer.dart at aab5f93). Only what CafAI reads: the care
 * reminders count steams (D-CARE-3).
 */
export interface SteamRecordSummary {
  id: string;
  /** When the steaming began: local, no zone. */
  timestamp: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** GET /api/v1/info: only what CafAI reads (About shows the version). Empty when Decaid's reply could not be read. */
export interface BuildInfo {
  version: string;
  fullVersion: string;
  [key: string]: unknown;
}

/** The parts of GET /api/v1/settings CafAI reads. A key Decaid's reply did not give in a form CafAI reads is left out. */
export interface DecaidSettings {
  /** "full": Decaid leaves stop-at-weight (and tare) to the skin. "tracking", "disabled": Decaid stops the shot. */
  gatewayMode?: 'disabled' | 'full' | 'tracking' | (string & {});
  /** The machine Decaid connects by itself; null when none is set. Connect never picks another (connectKind). */
  preferredMachineId?: string | null;
  /** The scale Decaid connects by itself; null when none is set. */
  preferredScaleId?: string | null;
  [key: string]: unknown;
}

/** One installed plugin (GET /api/v1/plugins): only what CafAI reads. */
export interface PluginInfo {
  id: string;
  /** Running now. */
  loaded?: boolean;
  [key: string]: unknown;
}

/** A coffee in Decaid's bean library (GET /api/v1/beans). */
export interface Bean {
  id: string;
  roaster?: string;
  name?: string;
  country?: string;
  region?: string;
  processing?: string;
  notes?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One roast of a bean (GET /api/v1/beans/{id}/batches). Dates are ISO strings. */
export interface BeanBatch {
  id: string;
  beanId: string;
  roastDate?: string | null;
  roastLevel?: string | null;
  freezeDate?: string | null;
  unfreezeDate?: string | null;
  /** In the freezer now. */
  frozen?: boolean;
  archived?: boolean;
  createdAt?: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BeanCreateRequest {
  roaster: string;
  name: string;
  country?: string;
  processing?: string;
  notes?: string;
}

export interface BatchCreateRequest {
  roastDate?: string;
  roastLevel?: string;
}

/** ws/v1/plugins/time-to-ready.reaplugin/timeToReady frames. */
export interface TimeToReadyFrame {
  status: 'heating' | 'reached' | 'not_heating' | 'insufficient_data' | (string & {});
  /** ms until ready, when the plugin has an estimate. */
  remainingTimeMs: number | null;
}

/** Decaid's enjoyment scale: 0-10 on current builds, 0-100 on 0.8.6 field builds (D101). */
export type EnjoymentScale = 10 | 100;

/** Any error body Decaid sends, parsed leniently. */
export interface DecaidErrorBody {
  error?: string;
  message?: string;
  details?: string;
  type?: string;
  st?: string;
}

// ---------------------------------------------------------------------------
// Sleep and wake (Decaid's presence settings)
// ---------------------------------------------------------------------------

/**
 * One of Decaid's wake schedules (lib/src/models/wake_schedule.dart at
 * aab5f93). While Decaid runs and the machine is connected and asleep,
 * Decaid wakes it at the time on the days, whether or not its idle sleep is
 * on (presence_controller.dart:478-511).
 */
export interface WakeSchedule {
  id: string;
  /** "HH:MM", 24-hour, in the local time of the device Decaid runs on. */
  time: string;
  /** ISO weekdays, 1 = Monday to 7 = Sunday; empty means every day. */
  daysOfWeek: number[];
  enabled: boolean;
  /** Minutes (1-720) Decaid keeps the machine awake after the wake; left out when there is none. */
  keepAwakeFor?: number;
}

/** GET /api/v1/presence/settings: Decaid's idle sleep and its wake schedules. */
export interface PresenceSettings {
  /** Decaid's "Auto sleep & wake": off, Decaid never puts the machine to sleep by itself. */
  userPresenceEnabled: boolean;
  /** Minutes without use before Decaid puts the machine to sleep, 0-240; 0 = never. */
  sleepTimeoutMinutes: number;
  schedules: WakeSchedule[];
  /**
   * When the keep-awake window of a wake now running ends: a local time
   * without a zone. Null when none runs; left out when CafAI could not read it.
   */
  keepAwakeUntil?: string | null;
}

/** POST /api/v1/presence/settings: only the keys given change. */
export interface PresencePatch {
  userPresenceEnabled?: boolean;
  /** A whole number; Decaid clamps it into 0-240. */
  sleepTimeoutMinutes?: number;
}

/** POST /api/v1/presence/schedules body. */
export interface WakeScheduleRequest {
  /** "HH:MM", 24-hour. */
  time: string;
  /** ISO weekdays; empty means every day. */
  daysOfWeek: number[];
  enabled: boolean;
  /** 1-720 minutes; null or left out for no keep-awake window. */
  keepAwakeFor?: number | null;
}

/** PUT /api/v1/presence/schedules/{id}: only the keys given change; keepAwakeFor null clears it. */
export type WakeSchedulePatch = Partial<WakeScheduleRequest>;

/** A failed Decaid call, with a sentence a barista can act on in `message`. */
export class GatewayError extends Error {
  readonly status: number;
  readonly path: string;
  /** e.g. "block_no_scale", "block_tare_during_shot", "not_connected", "timeout", "network". */
  readonly code: string | null;
  readonly body: DecaidErrorBody | null;

  constructor(status: number, path: string, message: string, code: string | null = null, body: DecaidErrorBody | null = null) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.path = path;
    this.code = code;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client interfaces
// ---------------------------------------------------------------------------

export interface KvClient {
  /** Keys in a namespace. */
  list(namespace: string): Promise<string[]>;
  /** Whole namespace; `notModified` when the ETag still matches. */
  getAll(
    namespace: string,
    etag?: string | null,
  ): Promise<{ notModified: true } | { notModified: false; data: Record<string, unknown>; etag: string | null }>;
  /** The stored value, or null when missing (Decaid answers 200 null; 404 is tolerated too). */
  get<T = unknown>(namespace: string, key: string): Promise<T | null>;
  /** Any JSON value, < 1 MiB. Uses keepalive so writes survive unload. */
  set(namespace: string, key: string, value: unknown): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
}

export interface DecaidClient {
  readonly httpOrigin: string;
  readonly wsOrigin: string;

  getInfo(): Promise<BuildInfo>;
  getSettings(): Promise<DecaidSettings>;
  /** POST /api/v1/settings (answers null): only the keys given change. Answers the settings read after. */
  updateSettings(patch: Pick<DecaidSettings, 'gatewayMode'>): Promise<DecaidSettings>;
  listPlugins(): Promise<PluginInfo[]>;
  /** GET a loaded plugin's HTTP endpoint, e.g. ("dye2.reaplugin", "recent-favs"). */
  getPluginEndpoint<T = unknown>(pluginId: string, endpoint: string): Promise<T | null>;

  getMachineInfo(): Promise<MachineInfo>;
  /** Read like a snapshot frame: a reading Decaid did not send is null. */
  getMachineState(): Promise<MachineFrame>;
  getCapabilities(): Promise<string[]>;
  /** Actuates hardware: only ever call from an explicit tap. */
  setMachineState(state: CommandableState): Promise<void>;
  heartbeat(): Promise<HeartbeatResponse>;

  /** Decaid's idle sleep and wake schedules (Settings > Sleep and wake). */
  getPresenceSettings(): Promise<PresenceSettings>;
  /** Answers the two settings as Decaid saved them (it clamps the minutes into 0-240). */
  updatePresenceSettings(patch: PresencePatch): Promise<Pick<PresenceSettings, 'userPresenceEnabled' | 'sleepTimeoutMinutes'>>;
  /** Answers the schedule as Decaid stored it, with the id Decaid gave it. */
  addWakeSchedule(request: WakeScheduleRequest): Promise<WakeSchedule>;
  /** A 404 GatewayError when the schedule is gone (deleted elsewhere). */
  updateWakeSchedule(id: string, patch: WakeSchedulePatch): Promise<WakeSchedule>;
  /** A 404 GatewayError when the schedule is already gone. */
  deleteWakeSchedule(id: string): Promise<void>;

  getDevices(): Promise<DeviceEntry[]>;
  /** Primary scale. Never before espresso: Decaid tares twice by itself. */
  tareScale(): Promise<void>;
  /** Discovery only (connect=false): otherwise Decaid connects whatever it sees. A quick scan answers [] at once. */
  scanDevices(options?: { quick?: boolean }): Promise<DeviceEntry[]>;
  connectDevice(deviceId: string, connectionRole?: 'primary' | 'auxiliary'): Promise<unknown>;
  /**
   * Find and connect ONE device of a kind, leaving the others alone, as
   * Decaid itself would choose it: its preferred device when that is there,
   * or the only one there when none is preferred; `preferredOnly`, the
   * preferred device or nothing. Returns the device list after. Throws a
   * `device_choice` GatewayError, connecting nothing, when the choice is
   * Decaid's to make: its preferred device is away but another is there,
   * several are there and none is preferred, or its settings did not say.
   */
  connectKind(kind: 'machine' | 'scale', options?: { preferredOnly?: boolean }): Promise<DeviceEntry[]>;

  getWorkflow(): Promise<Workflow>;
  /** Returns the merged workflow; treat the response as the truth. */
  updateWorkflow(patch: WorkflowPatch): Promise<Workflow>;

  listProfiles(options?: { includeHidden?: boolean; parentId?: string }): Promise<ProfileRecord[]>;
  getProfile(id: string): Promise<ProfileRecord>;
  /** May return an existing record with the same content (dedupe). */
  createProfile(request: ProfileCreateRequest): Promise<ProfileRecord>;
  /** Presentation-only updates (title/notes/metadata). Never change execution content with it. */
  updateProfile(id: string, body: { profile?: ProfileJson; metadata?: Record<string, unknown> | null }): Promise<ProfileRecord>;

  listShots(options?: { limit?: number; offset?: number }): Promise<PaginatedShots>;
  getLatestShot(): Promise<ShotRecordSummary | null>;
  getShot(id: string): Promise<ShotRecord>;
  updateShot(id: string, patch: ShotUpdateRequest): Promise<ShotRecord>;
  /**
   * D101: 10 or 100; null when Decaid could not be asked (no answer, or busy).
   * An answer that tells neither scale is reported as drift and thrown as an
   * `unexpected_reply` GatewayError.
   */
  probeEnjoymentScale(): Promise<EnjoymentScale | null>;

  /**
   * GET /api/v1/steams/ids: every steam record's id, to count them (the care
   * reminders, D-CARE-3). A Decaid older than the pin, without steam
   * records, answers 404.
   */
  listSteamIds(): Promise<string[]>;
  /** The newest steam record, without its measurements; null when there is none. */
  getLatestSteam(): Promise<SteamRecordSummary | null>;

  listBeans(): Promise<Bean[]>;
  listBatches(beanId: string): Promise<BeanBatch[]>;
  /** GET /api/v1/bean-batches: every bean's batches in one request; archived ones only when asked. */
  listAllBatches(options?: { includeArchived?: boolean }): Promise<BeanBatch[]>;
  createBean(request: BeanCreateRequest): Promise<Bean>;
  createBatch(beanId: string, request: BatchCreateRequest): Promise<BeanBatch>;

  readonly kv: KvClient;
}

export type SocketStatus = 'connecting' | 'open' | 'closed';

/** Live state from the WebSockets, for UI. Replaced (not mutated) on change. */
export interface TelemetryState {
  sockets: Record<'machine' | 'scale' | 'devices' | 'shotState' | 'waterLevels' | 'shotSettings', SocketStatus>;
  /** From ws/v1/devices only: a machine entry with state "connected". */
  machineConnected: boolean;
  /** From ws/v1/scale/snapshot status frames (or devices). */
  scaleConnected: boolean;
  machine: MachineFrame | null;
  scale: WeightSnapshot | null;
  waterLevels: WaterLevels | null;
  shotSettings: ShotSettings | null;
  shotState: ShotStateEvent | null;
  devices: DevicesState | null;
  /** Latest devices connectionStatus.error, de-duplicated by timestamp. */
  connectionError: ConnectionError | null;
  /**
   * ms until ready by time-to-ready.reaplugin's estimate while the store
   * follows it (watchTimeToReady, spec 6.3): set by a heating frame with a
   * number, counted down from then and kept by every frame, gone 6 s after
   * the last frame or 10 s past its deadline (streamline's rules); null
   * otherwise. Only the number: the plugin's status moves with every
   * snapshot, so whether the machine is heating is the machine's to say.
   */
  timeToReady: number | null;
}

/** One live sample for the shot graph, delivered imperatively (not via React state). */
export interface LiveSample {
  /** Seconds since the current shot started (pour start excluded: t=0 is the first espresso frame). */
  tS: number;
  machine: MachineFrame;
  scale: WeightSnapshot | null;
}

export type ShotLifecycleEvent =
  | { type: 'started'; shotId: string | null }
  | { type: 'finished'; shotId: string | null; stopReason: string | null };

export interface TelemetryStore {
  getState(): TelemetryState;
  /** Notified on every state change; use with useSyncExternalStore and a selector. */
  subscribe(listener: () => void): () => void;
  /** Every machine frame during a shot, for the live graph. */
  onSample(listener: (sample: LiveSample) => void): () => void;
  onShot(listener: (event: ShotLifecycleEvent) => void): () => void;
  start(): void;
  stop(): void;
  /**
   * Follows time-to-ready.reaplugin's channel (true) or stops (false), as
   * Decaid loads or unloads the plugin (D103).
   */
  watchTimeToReady(on: boolean): void;
}

export interface Heartbeat {
  /** Call on real user input; sends at most one heartbeat per interval. */
  notify(): void;
}

/** Where CafAI is running, and how to leave it. */
export interface HostEnvironment {
  /** True inside Decaid's WebView (window.__DECENT_HOST__ present). */
  insideDecaid: boolean;
  /** Decaid version from __DECENT_HOST__, when inside Decaid. */
  hostVersion: string | null;
  /**
   * Decaid's platform from __DECENT_HOST__ ('android', 'ios', 'macos',
   * 'windows', 'linux'), lowercased; null outside Decaid or when it does not
   * say. The cleaning guide's video plays in place only on Android (D154).
   */
  platform: string | null;
  /** Decaid's settings UI (includes the Web Interface / skin switcher section). */
  settingsUrl: string;
  /** Exit to Decaid's dashboard (Skins page); falls back to settingsUrl in a browser. */
  exitToSkinSwitcher(): void;
}

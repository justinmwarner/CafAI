/**
 * The exception registry (D94): every known disagreement between Decaid's
 * pinned spec, Decaid's Dart code and CafAI's types, each with its kind, the
 * reason and the Dart file:line at the pin (aab5f93) that proves it.
 *
 *   SPEC GAP        the spec omits `required` (or a value); Dart always sends it
 *   SPEC DRIFT      the spec contradicts Dart
 *   CAFAI NARROWER  CafAI's type is stricter than the spec, as Dart is
 *   CAFAI LOOSER    CafAI's type accepts or sends more than the spec, on purpose
 *   PARSED SHAPE    CafAI's type is what its parser returns, not the raw frame
 *
 * Two halves. The type fragments below are what checks/*.ts expect each
 * Diff to equal exactly: a new mismatch fails as `unexpected`, a fixed one as
 * `stale`, so the list cannot rot. SPEC_EXCEPTIONS are what the ajv
 * validators in schema.ts skip at runtime (the mock contract test, the tests
 * against a real Decaid, the drift watch).
 *
 * This file must not import the generated types: schema.ts uses it under
 * CafAI's own tsconfig, which has no #decaid/* aliases.
 */

// ---------------------------------------------------------------------------
// Type fragments (checks/*.ts)
// ---------------------------------------------------------------------------

/** The messages helpers.ts's Diff, Extra and EnumDrift produce, by path prefix and key. */
export type Opt<P extends string, K extends string> = `${P}${K}: optional in source, required in target`;
export type NullIn<P extends string, K extends string> = `${P}${K}: null not accepted`;
export type Absent<P extends string, K extends string> = `${P}${K}: absent in source`;
export type AbsentOpt<P extends string, K extends string> = `${P}${K}: absent in source (optional in target)`;
export type Undeclared<P extends string, K extends string> = `${P}${K}: not declared by target`;
export type SpecOnly<V extends string> = `spec only: ${V}`;
export type CafaiOnly<V extends string> = `CafAI only: ${V}`;

// ---- Fragments shared by several payloads ----------------------------------------------------

/** SPEC GAP: MachineSnapshot has no `required`; its toJson always sends every key (lib/src/models/device/machine.dart:97-112). */
export type MachineSnapshotGap<P extends string = ''> =
  | Opt<P, 'timestamp' | 'state' | 'flow' | 'pressure' | 'targetFlow' | 'targetPressure' | 'mixTemperature' | 'groupTemperature'>
  | Opt<P, 'targetMixTemperature' | 'targetGroupTemperature' | 'profileFrame' | 'steamTemperature'>
  | Opt<`${P}state.`, 'state' | 'substate'>;

/** SPEC GAP: WeightSnapshot has no `required`; its toJson always sends the five, battery and timerValue maybe null (lib/src/controllers/scale_controller.dart:316-324). */
export type WeightSnapshotGap<P extends string = ''> = Opt<P, 'timestamp' | 'weight' | 'weightFlow' | 'battery' | 'timerValue'>;

/**
 * SPEC GAP: Profile requires only title, steps and the two numbers, but its
 * toJson sends all ten keys, and each step sends exit, limiter and weight,
 * null when absent (lib/src/models/data/profile.dart:93-106, 265-280, 352-367).
 */
export type ProfileGap<P extends string = ''> =
  | Opt<P, 'author' | 'beverage_type' | 'notes' | 'target_volume' | 'target_weight' | 'version'>
  | Opt<`${P}steps[].`, 'exit' | 'limiter' | 'weight'>;

/**
 * CAFAI NARROWER: the spec allows null; WorkflowContext.toJson leaves a null
 * key out (lib/src/models/data/workflow_context.dart:62-77), so CafAI's
 * optional non-null fields are what Decaid sends.
 * CAFAI LOOSER: CafAI reads grinderBurrs, which Decaid sends from after v0.8.8
 * (absent from workflow_context.dart at the pin; added by 2b8b492).
 */
export type ContextRead<P extends string = ''> =
  | NullIn<`${P}context.`, 'baristaName' | 'drinkerName' | 'extras' | 'finalBeverageType' | 'targetDoseWeight' | 'targetWaterVolume' | 'targetYield'>
  | AbsentOpt<`${P}context.`, 'grinderBurrs'>;

/**
 * SPEC DRIFT: WorkflowRequest has no `id`, which Workflow.toJson always sends
 * (lib/src/models/data/workflow.dart:95).
 * SPEC GAP: and no `required`; toJson always sends the rest (workflow.dart:93-105).
 */
export type WorkflowRead<P extends string = ''> =
  | Absent<P, 'id'>
  | Opt<P, 'name' | 'description' | 'profile' | 'steamSettings' | 'hotWaterData' | 'rinseData'>
  | ProfileGap<`${P}profile.`>
  | ContextRead<P>;

/**
 * CAFAI NARROWER: the spec allows null; ShotRecord.toJson leaves out null
 * annotations and stopReason, and ShotAnnotations.toJson its null fields
 * (lib/src/models/data/shot_record.dart:58-59, 72-73; shot_annotations.dart:45-55).
 */
export type AnnotationsRead<P extends string = ''> =
  | NullIn<P, 'annotations' | 'stopReason'>
  | NullIn<`${P}annotations.`, 'actualDoseWeight' | 'actualYield' | 'drinkEy' | 'drinkTds' | 'enjoyment' | 'espressoNotes' | 'extras'>;

/** SPEC GAP: ShotRecordSummary has no `required`; toJsonWithoutMeasurements always sends these (lib/src/models/data/shot_record.dart:65-76). */
export type ShotSummaryRead<P extends string = ''> =
  | Opt<P, 'id' | 'timestamp' | 'createdAt' | 'updatedAt' | 'workflow'>
  | AnnotationsRead<P>
  | WorkflowRead<`${P}workflow.`>;

/** SPEC GAP: ShotRecord and ShotSnapshot have no `required`; their toJson always send these (shot_record.dart:50-63; shot_snapshot.dart:23-28). */
export type ShotRead<P extends string = ''> =
  | ShotSummaryRead<P>
  | Opt<P, 'measurements'>
  | Opt<`${P}measurements[].`, 'machine' | 'scale' | 'volume'>
  | MachineSnapshotGap<`${P}measurements[].machine.`>
  | WeightSnapshotGap<`${P}measurements[].scale.`>;

/** SPEC GAP: ProfileRecord.toJson always sends parentId and metadata, maybe null (lib/src/models/data/profile_record.dart:136-148). */
export type ProfileRecordRead<P extends string = ''> = Opt<P, 'parentId' | 'metadata'> | ProfileGap<`${P}profile.`>;

/** SPEC DRIFT: ProfileStep.exit and limiter are non-nullable $refs, but Dart sends and reads null (lib/src/models/data/profile.dart:249-259, 336-346). */
export type StepsWrite<P extends string = ''> = NullIn<`${P}steps[].`, 'exit' | 'limiter'>;

// ---- REST reads -------------------------------------------------------------------------------

/** SPEC GAP: MachineInfo has no `required`; its toJson always sends the four (lib/src/models/device/machine.dart:26-34). */
export type MachineInfoRead = Opt<'', 'GHC' | 'model' | 'serialNumber' | 'version'>;

/** SPEC GAP: the heartbeat reply has no `required`; Decaid always sends timeout (lib/src/services/webserver/presence_handler.dart:24-32). */
export type HeartbeatRead = Opt<'', 'timeout'>;

/** SPEC GAP: DeviceInventory has no `required`; the device list always sends the five (lib/src/services/webserver/devices_handler.dart:858-864). */
export type DeviceListRead = Opt<'list[].', 'available' | 'id' | 'name' | 'state' | 'type'>;

/** SPEC GAP: PluginManifest has no `required`; its toJson always sends id (lib/src/plugins/plugin_manifest.dart:314-327). */
export type PluginListRead = Opt<'list[].', 'id'>;

/** CAFAI NARROWER: the spec allows null; Grinder.toJson leaves a null field out (lib/src/models/data/grinder.dart:113-131). */
export type GrinderRead<P extends string = ''> = NullIn<
  P,
  'burrSize' | 'burrType' | 'burrs' | 'extras' | 'notes' | 'rpmBigStep' | 'rpmSmallStep' | 'settingBigStep' | 'settingSmallStep' | 'settingValues'
>;

/** CAFAI NARROWER: the spec allows null; Bean.toJson leaves a null field out (lib/src/models/data/bean.dart:101-121). */
export type BeanRead<P extends string = ''> = NullIn<P, 'country' | 'region' | 'processing' | 'notes' | 'extras'>;

/** CAFAI NARROWER: the spec allows null; BeanBatch.toJson leaves a null field out (lib/src/models/data/bean.dart:292-317). */
export type BatchRead<P extends string = ''> = NullIn<P, 'extras'>;

/**
 * SPEC DRIFT: no handler sends the spec's Error {e, st}; they send {error},
 * {error, message}, {error, st} or {details, type}
 * (e.g. lib/src/services/webserver/de1handler.dart:694-716, scale_handler.dart:48-57).
 */
export type ErrorBodyRead = AbsentOpt<'', 'details' | 'error' | 'message' | 'type'>;

// ---- WebSocket frames -------------------------------------------------------------------------

/** SPEC GAP: De1ShotSettings.toJson always sends the eight (lib/src/models/device/de1_interface.dart:147-158). */
export type ShotSettingsRead = Opt<
  '',
  'groupTemp' | 'steamSetting' | 'targetHotWaterDuration' | 'targetHotWaterTemp' | 'targetHotWaterVolume' | 'targetShotVolume' | 'targetSteamDuration' | 'targetSteamTemp'
>;

/** SPEC GAP: De1WaterLevels.toJson always sends both (lib/src/models/device/de1_interface.dart:228-229). */
export type WaterLevelsRead = Opt<'', 'currentLevel' | 'refillLevel'>;

/** SPEC GAP: a status frame always carries status (lib/src/services/webserver/scale_handler.dart:244-275). */
export type ScaleStatusRead = Opt<'', 'status'>;

/** SPEC GAP: ShotStateEvent and ShotDecision send every key, null when absent (lib/src/models/data/shot_state_event.dart:45-50, 89-101). */
export type ShotStateRead =
  | Opt<'', 'decision' | 'machineState' | 'machineSubstate' | 'profileFrame' | 'shotId'>
  | Opt<'decision.', 'data' | 'details' | 'kind' | 'reason'>;

/**
 * SPEC GAP: the devices frame always sends connectionStatus and its five keys,
 * and every device's available (lib/src/services/webserver/devices_handler.dart:139-184, 858-864).
 * PARSED SHAPE: ConnectionError.toJson leaves out a null deviceId, deviceName,
 * suggestion and details (lib/src/controllers/connection_error.dart:53-63);
 * src/api/frames.ts reads absent as null, so CafAI's type is the parsed shape.
 */
export type DevicesRead =
  | Opt<'', 'connectionStatus'>
  | Opt<'connectionStatus.', 'error' | 'foundMachines' | 'foundScales' | 'pendingAmbiguity' | 'phase'>
  | Opt<'connectionStatus.error.', 'details' | 'deviceId' | 'deviceName' | 'suggestion'>
  | Opt<'devices[].', 'available'>;

// ---- REST writes ------------------------------------------------------------------------------

/**
 * SPEC DRIFT: WorkflowPatch's hotWaterData and rinseData reuse the full
 * schemas, all required, but the PUT deep-merges before parsing
 * (lib/src/models/data/json_utils.dart:3-29), so a partial object is valid;
 * CafAI's Partial<> is deliberate (CAFAI LOOSER).
 * CAFAI LOOSER: CafAI clears grinderBurrs (spec 5.2), which v0.8.8 does not
 * know and ignores (WorkflowContext.fromJson reads named keys only,
 * workflow_context.dart:44-60).
 */
export type WorkflowWrite =
  | StepsWrite<'profile.'>
  | Opt<'hotWaterData.', 'duration' | 'flow' | 'targetTemperature' | 'volume'>
  | Opt<'rinseData.', 'duration' | 'flow' | 'targetTemperature'>
  | Undeclared<'context.', 'grinderBurrs'>;

/** SPEC DRIFT: Profile.version is a non-nullable string, but Dart sends null and reads it with parseOptionalString (lib/src/models/data/profile.dart:74, 95). */
export type MachineProfileWrite = StepsWrite<'v.'> | NullIn<'v.', 'version'>;

/**
 * CAFAI LOOSER: DecaidSettings.gatewayMode is an open union because CafAI
 * reads whatever Decaid sends; it only ever writes 'tracking' (spec 5.1), and
 * Decaid answers 400 to a mode it does not know (lib/src/services/webserver/settings_handler.dart:76-84).
 */
export type SettingsWrite = 'gatewayMode: string not accepted';

// ---- Enums ------------------------------------------------------------------------------------

/** SPEC DRIFT: the REST MachineState lacks schedIdle (lib/src/models/device/machine.dart:143). */
export type MachineStateRestEnum = CafaiOnly<'schedIdle'>;

/** SPEC DRIFT: the WebSocket MachineState lists transportMode, which Dart does not have, and lacks seven states (lib/src/models/device/machine.dart:139-161). */
export type MachineStateWsEnum =
  | SpecOnly<'transportMode'>
  | CafaiOnly<'airPurge' | 'busy' | 'calibration' | 'fwUpgrade' | 'schedIdle' | 'selfTest' | 'steamRinse'>;

/**
 * SPEC DRIFT: both specs spell cleaingGroup; Dart sends cleaningGroup (lib/src/models/device/machine.dart:170).
 * CAFAI NARROWER: CafAI's open union leaves out the 18 error substates (machine.dart:180-197).
 */
export type SubstateRestEnum =
  | CafaiOnly<'cleaningGroup'>
  | SpecOnly<'cleaingGroup'>
  | SpecOnly<
      | 'errorAcc' | 'errorAssertion' | 'errorBootFill' | 'errorDeadline' | 'errorDip' | 'errorFlash' | 'errorGeneric' | 'errorHiCurrent' | 'errorInf'
      | 'errorInvalidParam' | 'errorLoCurrent' | 'errorNaN' | 'errorNoAC' | 'errorOOM' | 'errorPSensor' | 'errorTSensor' | 'errorUnsafe' | 'errorWLevel'
    >;

/** SPEC DRIFT: as in REST, cleaingGroup for cleaningGroup (lib/src/models/device/machine.dart:170). */
export type SubstateWsEnum = CafaiOnly<'cleaningGroup'> | SpecOnly<'cleaingGroup'>;

/** SPEC GAP: the WebSocket DeviceInfo.type lacks grinder, a DeviceType since before the pin (lib/src/models/device/device.dart:6); added to the spec after v0.8.8 (a34615f). */
export type DeviceTypeWsEnum = CafaiOnly<'grinder'>;

// ---- Status codes -----------------------------------------------------------------------------

/** SPEC DRIFT: the KV store answers a missing key 200 null, a write and a delete 200 {} (lib/src/services/webserver/kv_store_handler.dart:24, 34, 54). */
export type KvStatus =
  | 'GET /api/v1/store/{namespace}/{key}: the spec documents 404 (Dart: 200 null for a missing key)'
  | 'POST /api/v1/store/{namespace}/{key}: no 200 in the spec (a stored value)'
  | 'DELETE /api/v1/store/{namespace}/{key}: the spec answers {deleted} (Dart: {})';

/** SPEC DRIFT: tare without a scale answers 500 {error: "DeviceNotConnectedException: ..."}, not 404 (lib/src/services/webserver/scale_handler.dart:52-57). */
export type TareStatus = 'PUT /api/v1/scale/tare: the spec documents 404 (Dart: 500 {error} without a scale)';

/** SPEC GAP: the barrier also answers 409 (a superseded write) and 504 (Bluetooth timed out) (lib/src/services/webserver/de1handler.dart:699-712). */
export type MachineProfileStatus =
  | 'POST /api/v1/machine/profile: no 409 in the spec (another write came first)'
  | 'POST /api/v1/machine/profile: no 504 in the spec (Bluetooth timed out)';

// ---------------------------------------------------------------------------
// Runtime exceptions (ajv)
// ---------------------------------------------------------------------------

export interface SpecException {
  /** "any", an operation as the spec writes it ("PUT /api/v1/workflow") or a channel ("ws/v1/devices"). */
  where: string;
  /** The ajv keyword that fails ("format", "type", "enum", "required"), or "status" for an undocumented status. */
  keyword: string;
  /** Tested against the spec location of the failing schema, e.g. "rest_v1.yml#/components/schemas/StepLimiter/type". */
  schemaPath?: RegExp;
  /** Tested against the failing value's JSON pointer in the payload, e.g. "/measurements/3/scale". */
  instancePath?: RegExp;
  /** ajv's error params must include these, e.g. { format: 'date-time' }. */
  params?: Readonly<Record<string, unknown>>;
  /** The failing value is one of these. */
  values?: readonly unknown[];
  /** The failing value is a string matching this. */
  valueMatches?: RegExp;
  /** keyword "status": the status Decaid answers that the spec does not document. */
  status?: number;
  /** "KIND: why (Decaid file:line)". */
  why: string;
}

/** What Dart's DateTime.toIso8601String gives for a local time, and the date-only form DateTime.parse takes. */
const ZONELESS_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?$/;

const MACHINE_STATE = (spec: 'rest' | 'websocket') =>
  new RegExp(`^${spec}_v1\\.yml#/components/schemas/MachineState/enum$`);
const MACHINE_SUBSTATE = /^(rest|websocket)_v1\.yml#\/components\/schemas\/MachineSubstate\/enum$/;

export const SPEC_EXCEPTIONS: readonly SpecException[] = [
  {
    where: 'any',
    keyword: 'format',
    params: { format: 'date-time' },
    valueMatches: ZONELESS_TIME,
    why:
      'SPEC DRIFT: Decaid writes local times without a zone (DateTime.toIso8601String on a local time: ' +
      'lib/src/models/device/machine.dart:99, lib/src/controllers/scale_controller.dart:318, ' +
      'lib/src/models/data/profile_record.dart:145-146, lib/src/models/data/shot_record.dart:53, ' +
      'lib/src/models/data/bean.dart:117-118, 296, 313-314, lib/src/models/data/grinder.dart:128-129) and reads ' +
      'dates with DateTime.parse, which takes them and date-only strings (lib/src/services/webserver/beans_handler.dart:184-186); ' +
      '`format: date-time` wants RFC 3339 with a zone.',
  },
  {
    where: 'any',
    keyword: 'type',
    schemaPath: /^rest_v1\.yml#\/components\/schemas\/(StepExitCondition|StepLimiter)\/type$/,
    values: [null],
    why:
      'SPEC DRIFT: ProfileStep.exit and limiter are non-nullable $refs, but Dart sends null for a step without one ' +
      'and reads null back (lib/src/models/data/profile.dart:249-259, 270, 277, 336-346, 357, 364).',
  },
  {
    where: 'any',
    keyword: 'type',
    schemaPath: /^rest_v1\.yml#\/components\/schemas\/Profile\/properties\/version\/type$/,
    values: [null],
    why:
      'SPEC DRIFT: Profile.version is a non-nullable string, but Dart keeps a missing version as null, sends it ' +
      'and reads it back with parseOptionalString (lib/src/models/data/profile.dart:74, 95); CafAI posts the ' +
      'profile to /machine/profile exactly as Decaid returned it.',
  },
  {
    where: 'any',
    keyword: 'type',
    schemaPath: /^rest_v1\.yml#\/components\/schemas\/WeightSnapshot\/type$/,
    instancePath: /\/scale$/,
    values: [null],
    why:
      'SPEC DRIFT: ShotSnapshot.scale is a non-nullable WeightSnapshot, but Dart sends "scale": null for a ' +
      'measurement without a scale (lib/src/models/data/shot_snapshot.dart:26).',
  },
  {
    where: 'GET /api/v1/shots/latest',
    keyword: 'type',
    instancePath: /^$/,
    values: [null],
    why:
      'SPEC DRIFT: the reply is a ShotRecordSummary, but Dart answers 200 null when there is no shot ' +
      '(lib/src/services/webserver/shots_handler.dart:171).',
  },
  {
    where: 'any',
    keyword: 'enum',
    schemaPath: MACHINE_STATE('rest'),
    values: ['schedIdle'],
    why:
      'SPEC DRIFT: the REST MachineState lacks schedIdle, which Dart has and sends for a DE1 in scheduled idle ' +
      '(lib/src/models/device/machine.dart:143; lib/src/models/device/impl/de1/de1.utils.dart:14-15).',
  },
  {
    where: 'any',
    keyword: 'enum',
    schemaPath: MACHINE_STATE('websocket'),
    values: ['busy', 'schedIdle', 'steamRinse', 'calibration', 'selfTest', 'airPurge', 'fwUpgrade'],
    why:
      'SPEC DRIFT: the WebSocket MachineState lacks seven states Dart has (lib/src/models/device/machine.dart:139-161) ' +
      'and lists a transportMode Dart never sends.',
  },
  {
    where: 'any',
    keyword: 'enum',
    schemaPath: MACHINE_SUBSTATE,
    values: ['cleaningGroup'],
    why: 'SPEC DRIFT: both specs spell cleaingGroup; Dart sends cleaningGroup (lib/src/models/device/machine.dart:170).',
  },
  {
    where: 'any',
    keyword: 'enum',
    schemaPath: /^websocket_v1\.yml#\/components\/schemas\/MachineSubstate\/enum$/,
    valueMatches: /^error[A-Z][A-Za-z]*$/,
    why:
      'SPEC GAP: the WebSocket MachineSubstate lacks the 18 error substates Dart sends and the REST spec lists ' +
      '(lib/src/models/device/machine.dart:180-197).',
  },
  {
    where: 'any',
    keyword: 'enum',
    schemaPath: /^websocket_v1\.yml#\/components\/schemas\/DeviceInfo\/properties\/type\/enum$/,
    values: ['grinder'],
    why:
      'SPEC GAP: the WebSocket DeviceInfo.type lacks grinder, a DeviceType since before the pin ' +
      '(lib/src/models/device/device.dart:6); Decaid added it to the spec after v0.8.8 (a34615f).',
  },
  {
    where: 'POST /api/v1/store/{namespace}/{key}',
    keyword: 'status',
    status: 200,
    why: 'SPEC DRIFT: a KV write answers 200 {} (lib/src/services/webserver/kv_store_handler.dart:54); the spec says 204.',
  },
  ...['GET /api/v1/machine/info', 'GET /api/v1/machine/state', 'GET /api/v1/machine/capabilities', 'PUT /api/v1/machine/state/{newState}'].map(
    (where): SpecException => ({
      where,
      keyword: 'status',
      status: 500,
      why:
        'SPEC GAP: without a machine these routes answer 500 {"error": "DeviceNotConnectedException: machine not connected"} ' +
        '(lib/src/services/webserver/de1handler.dart:682-687, 713-714); the spec documents their success only. ' +
        'CafAI reads it as "not connected" (src/api/http.ts).',
    }),
  ),
];

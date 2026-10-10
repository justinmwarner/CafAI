/**
 * WebSocket frames CafAI reads: Diff<the spec's frame, CafAI's type>, which
 * must equal the exceptions recorded in drift.ts. Covers the six channels
 * src/api/telemetry.ts opens (CHANNEL_PATHS) and the time-to-ready plugin's.
 */
import type { Assert, Diff, EnumDrift, Exactly, Ws, WsReceive } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';

/** A spec address with its {params} as wildcards: "ws/v1/plugins/{id}/{endpoint}" to `ws/v1/plugins/${string}/${string}`. */
type Pattern<A extends string> = A extends `${infer Head}{${string}}${infer Tail}` ? `${Head}${string}${Pattern<Tail>}` : A;
/** The channels CafAI opens that the spec's channel map does not have. */
type Unknown<Opened extends string> = Opened extends Pattern<keyof WsReceive & string> ? never : `not in the spec: ${Opened}`;

/** telemetry.ts CHANNEL_PATHS, and the time-to-ready channel (spec 6.3). */
type Opened =
  | 'ws/v1/machine/snapshot'
  | 'ws/v1/scale/snapshot'
  | 'ws/v1/devices'
  | 'ws/v1/machine/shotState'
  | 'ws/v1/machine/waterLevels'
  | 'ws/v1/machine/shotSettings'
  | 'ws/v1/plugins/time-to-ready.reaplugin/timeToReady';
export type _channels = Assert<Exactly<Unknown<Opened>, never>>;

export type _machine = Assert<Exactly<Diff<WsReceive['ws/v1/machine/snapshot'], C.MachineSnapshot>, X.MachineSnapshotGap>>;
export type _shot_settings = Assert<Exactly<Diff<WsReceive['ws/v1/machine/shotSettings'], C.ShotSettings>, X.ShotSettingsRead>>;
export type _water = Assert<Exactly<Diff<WsReceive['ws/v1/machine/waterLevels'], C.WaterLevels>, X.WaterLevelsRead>>;
export type _scale_weight = Assert<Exactly<Diff<Ws['ScaleSnapshot'], C.WeightSnapshot>, X.WeightSnapshotGap>>;
export type _scale_status = Assert<Exactly<Diff<Ws['ScaleStatus'], Extract<C.ScaleWsFrame, { status: unknown }>>, X.ScaleStatusRead>>;
export type _shot_state = Assert<Exactly<Diff<WsReceive['ws/v1/machine/shotState'], C.ShotStateEvent>, X.ShotStateRead>>;
export type _devices = Assert<Exactly<Diff<Ws['DevicesState'], C.DevicesState>, X.DevicesRead>>;

/**
 * The time-to-ready frame has no spec schema (PluginMessage is any object), so
 * CafAI's type is checked against what the plugin emits: its estimate spread
 * with currentTemp, targetTemp and timestamp
 * (assets/plugins/time-to-ready.reaplugin/plugin.js:76-84), the estimate being
 * one of four shapes (plugin.js:115-156).
 */
type TimeToReadyEmit = { currentTemp: number; targetTemp: number; timestamp: number } & (
  | { remainingTimeMs: 0; heatingRate: 0; status: 'reached'; message: string }
  | { remainingTimeMs: null; heatingRate: null; status: 'insufficient_data'; message: string }
  | { remainingTimeMs: null; heatingRate: number; status: 'not_heating'; message: string }
  | { remainingTimeMs: number; heatingRate: number; status: 'heating'; message: string; formattedTime: string }
);
export type _time_to_ready = Assert<Exactly<Diff<TimeToReadyEmit, C.TimeToReadyFrame>, never>>;
export type _time_to_ready_status = Assert<Exactly<EnumDrift<TimeToReadyEmit['status'], C.TimeToReadyFrame['status']>, never>>;

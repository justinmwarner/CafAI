/**
 * WebSocket frames CafAI reads: Diff<the spec's frame, CafAI's type>, which
 * must equal the exceptions recorded in drift.ts. Covers the channels CafAI
 * opens: the six src/api/telemetry.ts opens (CHANNEL_PATHS) and the
 * time-to-ready plugin's. The time-to-ready channel's address is checked; its
 * payload is the plugin's own (the spec's PluginMessage is any object), so the
 * contract does not check it.
 */
import type { Assert, Diff, Exactly, Ws, WsReceive } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';

/** A spec address with its {params} as wildcards: "ws/v1/plugins/{id}/{endpoint}" to `ws/v1/plugins/${string}/${string}`. */
type Pattern<A extends string> = A extends `${infer Head}{${string}}${infer Tail}` ? `${Head}${string}${Pattern<Tail>}` : A;
/** The channels CafAI opens that the spec's channel map does not have. */
type Unknown<Opened extends string> = Opened extends Pattern<keyof WsReceive & string> ? never : `not in the spec: ${Opened}`;

/**
 * telemetry.ts CHANNEL_PATHS, and the time-to-ready channel (spec 6.3).
 * CHANNELS in scripts/decaid-contract.mjs lists the same channels, with the
 * frames CafAI expects on each (scripts/decaid-contract.test.mjs checks).
 */
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

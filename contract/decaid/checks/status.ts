/**
 * The status codes CafAI relies on, against the ones the spec documents. Each
 * operation lists what CafAI does with an answer; a status the spec lacks, or
 * one it documents where Decaid answers otherwise, is a message, and the
 * messages must equal the exceptions recorded in drift.ts.
 */
import type { Assert, Exactly, Res, Statuses, paths } from '../helpers.ts';
import type * as X from '../drift.ts';

/** A message unless the spec documents status S for the operation. */
type Lacks<P extends keyof paths, M extends string, S extends number, Use extends string> =
  S extends Statuses<P, M> ? never : `${Uppercase<M>} ${P}: no ${S} in the spec (${Use})`;
/** A message when the spec documents status S where Decaid answers otherwise. */
type Documents<P extends keyof paths, M extends string, S extends number, Dart extends string> =
  S extends Statuses<P, M> ? `${Uppercase<M>} ${P}: the spec documents ${S} (${Dart})` : never;

/** kv.ts: a key's value or null when missing; writes and deletes answer 200; If-None-Match may answer 304. */
export type _kv = Assert<
  Exactly<
    | Lacks<'/api/v1/store/{namespace}/{key}', 'get', 200, 'the value, null when missing'>
    | Documents<'/api/v1/store/{namespace}/{key}', 'get', 404, 'Dart: 200 null for a missing key'>
    | Lacks<'/api/v1/store/{namespace}/{key}', 'post', 200, 'a stored value'>
    | Lacks<'/api/v1/store/{namespace}/{key}', 'delete', 200, 'a deleted key'>
    | Lacks<'/api/v1/store/{namespace}', 'get', 304, 'the backup is unchanged'>
    | (Res<'/api/v1/store/{namespace}/{key}', 'delete'> extends Record<string, never>
        ? never
        : 'DELETE /api/v1/store/{namespace}/{key}: the spec answers {deleted} (Dart: {})'),
    X.KvStatus
  >
>;

/** client.ts tareScale: interpretGatewayError maps block_tare_during_shot and the "not connected" text. */
export type _tare = Assert<
  Exactly<
    | Lacks<'/api/v1/scale/tare', 'put', 200, 'tared'>
    | Lacks<'/api/v1/scale/tare', 'put', 400, 'block_tare_during_shot'>
    | Lacks<'/api/v1/scale/tare', 'put', 500, 'no scale: DeviceNotConnectedException'>
    | Documents<'/api/v1/scale/tare', 'put', 404, 'Dart: 500 {error} without a scale'>,
    X.TareStatus
  >
>;

/** workflow.ts activateProfile: a refusal fails at once; a 503 (or a timeout) is read back before it counts as failed (5.13). */
export type _workflow = Assert<
  Exactly<
    | Lacks<'/api/v1/workflow', 'put', 200, 'the merged workflow'>
    | Lacks<'/api/v1/workflow', 'put', 400, 'a refused workflow'>
    | Lacks<'/api/v1/workflow', 'put', 503, 'read the workflow back'>,
    never
  >
>;

/** machineProfile.ts: the barrier's answers (D55). */
export type _machine_profile = Assert<
  Exactly<
    | Lacks<'/api/v1/machine/profile', 'post', 200, 'the machine holds the profile'>
    | Lacks<'/api/v1/machine/profile', 'post', 500, 'no machine: DeviceNotConnectedException'>
    | Lacks<'/api/v1/machine/profile', 'post', 503, 'the write queue is full'>
    | Lacks<'/api/v1/machine/profile', 'post', 504, 'Bluetooth timed out'>
    | Lacks<'/api/v1/machine/profile', 'post', 409, 'another write came first'>,
    X.MachineProfileStatus
  >
>;

/** client.ts setMachineState: block_no_scale is a sentence. */
export type _machine_state = Assert<
  Exactly<
    | Lacks<'/api/v1/machine/state/{newState}', 'put', 200, 'commanded'>
    | Lacks<'/api/v1/machine/state/{newState}', 'put', 400, 'block_no_scale'>,
    never
  >
>;

/** The rating-scale probe (D101) and the shot writes: 400 for an enjoyment out of range, 404 for an unknown shot. */
export type _shot = Assert<
  Exactly<
    | Lacks<'/api/v1/shots/{id}', 'put', 200, 'the updated shot'>
    | Lacks<'/api/v1/shots/{id}', 'put', 400, 'enjoyment out of range: a 0-10 build'>
    | Lacks<'/api/v1/shots/{id}', 'put', 404, 'unknown shot: a 0-100 build'>
    | Lacks<'/api/v1/shots/{id}', 'get', 404, 'no such shot'>,
    never
  >
>;

/**
 * client.ts listSteamIds and getLatestSteam, for the care reminders (D-CARE-3): 200 is the answer. A Decaid older
 * than the pin, without the routes, answers shelf's plain 404, and Rinza counts by days alone.
 */
export type _steams = Assert<
  Exactly<Lacks<'/api/v1/steams/ids', 'get', 200, 'the ids'> | Lacks<'/api/v1/steams/latest', 'get', 200, 'the newest, or null'>, never>
>;

/** grinders.ts getGrinder: 404 is "no longer in Decaid's library". */
export type _grinder = Assert<Exactly<Lacks<'/api/v1/grinders/{id}', 'get', 404, 'a deleted grinder'>, never>>;

/** grinders.ts createGrinder: 201 is the grinder as Decaid stored it; a 400 (no model, a wrong type) is Decaid's sentence. */
export type _grinder_create = Assert<
  Exactly<Lacks<'/api/v1/grinders', 'post', 201, 'the added grinder'> | Lacks<'/api/v1/grinders', 'post', 400, 'refused'>, never>
>;

/** client.ts updateSettings reads the settings back after a 200. */
export type _settings = Assert<Exactly<Lacks<'/api/v1/settings', 'post', 200, 'saved'>, never>>;

/** client.ts updatePresenceSettings: 200 is the two settings as saved. */
export type _presence = Assert<Exactly<Lacks<'/api/v1/presence/settings', 'post', 200, 'saved'>, never>>;

/** client.ts addWakeSchedule: 201 is the schedule as Decaid stored it, with the id Decaid gave it. */
export type _wake_schedule_create = Assert<Exactly<Lacks<'/api/v1/presence/schedules', 'post', 201, 'the added schedule'>, never>>;

/** client.ts updateWakeSchedule and deleteWakeSchedule: a 404 is a schedule deleted elsewhere, or already gone. */
export type _wake_schedule = Assert<
  Exactly<
    | Lacks<'/api/v1/presence/schedules/{id}', 'put', 200, 'the changed schedule'>
    | Lacks<'/api/v1/presence/schedules/{id}', 'put', 404, 'deleted elsewhere'>
    | Lacks<'/api/v1/presence/schedules/{id}', 'delete', 200, 'deleted'>
    | Lacks<'/api/v1/presence/schedules/{id}', 'delete', 404, 'already gone'>,
    never
  >
>;

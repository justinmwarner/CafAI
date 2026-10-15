/**
 * REST bodies, and query and path parameters, CafAI sends: Diff<CafAI's,
 * the spec's> (leaving out an optional one is fine) and Extra<CafAI's, the
 * spec's> (one the spec does not declare: renamed, say), which must equal the
 * exceptions recorded in drift.ts.
 */
import type { Assert, Body, Diff, Exactly, Extra, PathParams, Query, W } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';
import type { GrinderCreateRequest } from '../../../src/api/grinders.ts';
import type { ProfileJson } from '../../../src/coach/types.ts';

/** Everything wrong with sending From as To. */
type Sent<From, To> = W<Diff<From, To>> | Extra<From, To>;

export type _workflow = Assert<Exactly<Sent<C.WorkflowPatch, Body<'/api/v1/workflow', 'put'>>, X.WorkflowWrite>>;
export type _profile_create = Assert<Exactly<Sent<C.ProfileCreateRequest, Body<'/api/v1/profiles', 'post'>>, X.StepsWrite<'profile.'>>>;
export type _profile_update = Assert<
  Exactly<Sent<Parameters<C.DecaidClient['updateProfile']>[1], Body<'/api/v1/profiles/{id}', 'put'>>, X.StepsWrite<'profile.'>>
>;
export type _shot = Assert<Exactly<Sent<C.ShotUpdateRequest, Body<'/api/v1/shots/{id}', 'put'>>, never>>;
/** The barrier posts the profile exactly as Decaid returned it from the workflow PUT, or as CafAI built it. */
export type _machine_profile = Assert<
  Exactly<Sent<{ v: C.WireProfile | ProfileJson }, { v: Body<'/api/v1/machine/profile', 'post'> }>, X.MachineProfileWrite>
>;
export type _machine_state = Assert<Exactly<Sent<{ newState: C.CommandableState }, PathParams<'/api/v1/machine/state/{newState}', 'put'>>, never>>;
/** client.ts updateWakeSchedule and deleteWakeSchedule: the schedule's id in the path. */
export type _wake_schedule_id = Assert<Exactly<Sent<{ id: string }, PathParams<'/api/v1/presence/schedules/{id}', 'put'>>, never>>;
export type _wake_schedule_delete_id = Assert<Exactly<Sent<{ id: string }, PathParams<'/api/v1/presence/schedules/{id}', 'delete'>>, never>>;
/** client.ts connectDevice. */
export type _connect = Assert<
  Exactly<Sent<{ deviceId: string; connectionRole?: 'primary' | 'auxiliary' }, Body<'/api/v1/devices/connect', 'put'>>, never>
>;
export type _settings = Assert<
  Exactly<Sent<Parameters<C.DecaidClient['updateSettings']>[0], Body<'/api/v1/settings', 'post'>>, X.SettingsWrite>
>;
export type _bean = Assert<Exactly<Sent<C.BeanCreateRequest, Body<'/api/v1/beans', 'post'>>, never>>;
export type _batch = Assert<Exactly<Sent<C.BatchCreateRequest, Body<'/api/v1/beans/{beanId}/batches', 'post'>>, never>>;
/** grinders.ts createGrinder: Settings' Add a grinder, and the coach's offer the barista confirms. */
export type _grinder_create = Assert<Exactly<Sent<GrinderCreateRequest, Body<'/api/v1/grinders', 'post'>>, never>>;
/** client.ts updatePresenceSettings: Settings > Sleep and wake changes one setting or both. */
export type _presence = Assert<Exactly<Sent<C.PresencePatch, Body<'/api/v1/presence/settings', 'post'>>, never>>;
/** client.ts addWakeSchedule: always the time as "HH:MM", never hour and minute. */
export type _wake_schedule_create = Assert<Exactly<Sent<C.WakeScheduleRequest, Body<'/api/v1/presence/schedules', 'post'>>, never>>;
/** client.ts updateWakeSchedule: only the keys that change; keepAwakeFor null clears it. */
export type _wake_schedule_update = Assert<Exactly<Sent<C.WakeSchedulePatch, Body<'/api/v1/presence/schedules/{id}', 'put'>>, never>>;

// ---- Query parameters: a renamed one would be ignored, as Decaid ignores what it does not know ----------
/** client.ts scanDevices: connect=false keeps the scan from connecting every device it finds (D111). */
export type _scan_query = Assert<Exactly<Sent<{ connect?: boolean; quick?: boolean }, Query<'/api/v1/devices/scan', 'get'>>, never>>;
/** client.ts listProfiles. */
export type _profiles_query = Assert<Exactly<Sent<{ includeHidden?: boolean; parentId?: string }, Query<'/api/v1/profiles', 'get'>>, never>>;
/** client.ts listShots. */
export type _shots_query = Assert<Exactly<Sent<{ limit?: number; offset?: number }, Query<'/api/v1/shots', 'get'>>, never>>;
/** client.ts listAllBatches (the bean card, 6.1). */
export type _all_batches_query = Assert<Exactly<Sent<{ includeArchived?: boolean }, Query<'/api/v1/bean-batches', 'get'>>, never>>;
/** grinders.ts listGrinders. */
export type _grinders_query = Assert<Exactly<Sent<{ includeArchived?: boolean }, Query<'/api/v1/grinders', 'get'>>, never>>;
/** kv.ts getAll: the whole namespace with its ETag (the backup, D100). */
export type _kv_query = Assert<Exactly<Sent<{ full?: '1' }, Query<'/api/v1/store/{namespace}', 'get'>>, never>>;

/**
 * pluginData.ts reads a loaded plugin's HTTP endpoint (DYE2's recent-favs): the route must stay. What the
 * plugin answers is its own payload, which the contract does not check (README, "What is not checked").
 */
export type _plugin_endpoint = Assert<Exactly<Sent<{ id: string; endpoint: string }, PathParams<'/api/v1/plugins/{id}/{endpoint}', 'get'>>, never>>;

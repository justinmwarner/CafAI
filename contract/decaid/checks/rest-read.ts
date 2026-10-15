/**
 * REST replies CafAI reads: Diff<the spec's reply, CafAI's type>, which must
 * equal the exceptions recorded in drift.ts. Covers every reply in
 * docs/audit/2026-10-09/cafai.md section 1.2 and section 1.6, and the ones
 * the Decaid features read (settings, plugins, beans, batches, and the sleep
 * and wake settings with their schedules).
 */
import type { Assert, Diff, Exactly, Res, Rest } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';
import type { Grinder } from '../../../src/api/grinders.ts';

// ---- Machine, settings, devices ---------------------------------------------------------------
export type _info = Assert<Exactly<Diff<Res<'/api/v1/info', 'get'>, C.BuildInfo>, never>>;
export type _machine_info = Assert<Exactly<Diff<Res<'/api/v1/machine/info', 'get'>, C.MachineInfo>, X.MachineInfoRead>>;
export type _machine_state = Assert<Exactly<Diff<Res<'/api/v1/machine/state', 'get'>, C.MachineSnapshot>, X.MachineSnapshotGap>>;
export type _heartbeat = Assert<Exactly<Diff<Res<'/api/v1/machine/heartbeat', 'post'>, C.HeartbeatResponse>, X.HeartbeatRead>>;
/** client.ts getCapabilities reads `capabilities` and keeps its strings. */
export type _capabilities = Assert<Exactly<Diff<Res<'/api/v1/machine/capabilities', 'get'>, { capabilities?: unknown }>, never>>;
export type _settings = Assert<Exactly<Diff<Res<'/api/v1/settings', 'get'>, C.DecaidSettings>, never>>;
export type _devices = Assert<Exactly<Diff<{ list: Res<'/api/v1/devices', 'get'> }, { list: C.DeviceEntry[] }>, X.DeviceListRead>>;
export type _devices_scan = Assert<Exactly<Diff<{ list: Res<'/api/v1/devices/scan', 'get'> }, { list: C.DeviceEntry[] }>, X.DeviceListRead>>;
export type _plugins = Assert<Exactly<Diff<{ list: Res<'/api/v1/plugins', 'get'> }, { list: C.PluginInfo[] }>, X.PluginListRead>>;

// ---- Workflow and profiles ----------------------------------------------------------------------
export type _workflow = Assert<Exactly<Diff<Res<'/api/v1/workflow', 'get'>, C.Workflow>, X.WorkflowRead>>;
export type _workflow_put = Assert<Exactly<Diff<Res<'/api/v1/workflow', 'put'>, C.Workflow>, X.WorkflowRead>>;
export type _profiles = Assert<Exactly<Diff<{ list: Res<'/api/v1/profiles', 'get'> }, { list: C.ProfileRecord[] }>, X.ProfileRecordRead<'list[].'>>>;
export type _profile = Assert<Exactly<Diff<Res<'/api/v1/profiles/{id}', 'get'>, C.ProfileRecord>, X.ProfileRecordRead>>;
export type _profile_create = Assert<Exactly<Diff<Res<'/api/v1/profiles', 'post', 201>, C.ProfileRecord>, X.ProfileRecordRead>>;
export type _profile_update = Assert<Exactly<Diff<Res<'/api/v1/profiles/{id}', 'put'>, C.ProfileRecord>, X.ProfileRecordRead>>;

// ---- Shots ---------------------------------------------------------------------------------------
export type _shots = Assert<Exactly<Diff<Res<'/api/v1/shots', 'get'>, C.PaginatedShots>, X.ShotSummaryRead<'items[].'>>>;
/** CafAI reads `null` as "no shot yet" (Decaid's 200 null; schema.ts records it for the runtime check). */
export type _shots_latest = Assert<Exactly<Diff<{ v: Res<'/api/v1/shots/latest', 'get'> }, { v: C.ShotRecordSummary | null }>, X.ShotSummaryRead<'v.'>>>;
export type _shot = Assert<Exactly<Diff<Res<'/api/v1/shots/{id}', 'get'>, C.ShotRecord>, X.ShotRead>>;
export type _shot_put = Assert<Exactly<Diff<Res<'/api/v1/shots/{id}', 'put'>, C.ShotRecord>, X.ShotRead>>;

// ---- Grinders, beans, batches -----------------------------------------------------------------------
export type _grinders = Assert<Exactly<Diff<{ list: Res<'/api/v1/grinders', 'get'> }, { list: Grinder[] }>, X.GrinderRead<'list[].'>>>;
export type _grinder = Assert<Exactly<Diff<Res<'/api/v1/grinders/{id}', 'get'>, Grinder>, X.GrinderRead>>;
export type _grinder_create = Assert<Exactly<Diff<Res<'/api/v1/grinders', 'post', 201>, Grinder>, X.GrinderRead>>;
export type _beans = Assert<Exactly<Diff<{ list: Res<'/api/v1/beans', 'get'> }, { list: C.Bean[] }>, X.BeanRead<'list[].'>>>;
export type _bean_create = Assert<Exactly<Diff<Res<'/api/v1/beans', 'post', 201>, C.Bean>, X.BeanRead>>;
export type _batches = Assert<Exactly<Diff<{ list: Res<'/api/v1/beans/{beanId}/batches', 'get'> }, { list: C.BeanBatch[] }>, X.BatchRead<'list[].'>>>;
/** client.ts listAllBatches: every batch in one read, for the bean card (6.1). */
export type _all_batches = Assert<Exactly<Diff<{ list: Res<'/api/v1/bean-batches', 'get'> }, { list: C.BeanBatch[] }>, X.BatchRead<'list[].'>>>;
export type _batch_create = Assert<Exactly<Diff<Res<'/api/v1/beans/{beanId}/batches', 'post', 201>, C.BeanBatch>, X.BatchRead>>;

// ---- Sleep and wake (presence) ----------------------------------------------------------------------
/** client.ts getPresenceSettings: the schedules come with the settings, so CafAI never reads GET /presence/schedules. */
export type _presence = Assert<Exactly<Diff<Res<'/api/v1/presence/settings', 'get'>, C.PresenceSettings>, X.PresenceRead>>;
/** client.ts updatePresenceSettings: the two settings as Decaid saved them. */
export type _presence_update = Assert<
  Exactly<Diff<Res<'/api/v1/presence/settings', 'post'>, Awaited<ReturnType<C.DecaidClient['updatePresenceSettings']>>>, X.PresenceSavedRead>
>;
export type _wake_schedule_create = Assert<Exactly<Diff<Res<'/api/v1/presence/schedules', 'post', 201>, C.WakeSchedule>, X.WakeScheduleRead>>;
export type _wake_schedule_update = Assert<Exactly<Diff<Res<'/api/v1/presence/schedules/{id}', 'put'>, C.WakeSchedule>, X.WakeScheduleRead>>;

// ---- KV store and errors --------------------------------------------------------------------------
/** kv.ts reads the namespace as keys (string[]) or, with ?full=1, as a map of any JSON. */
export type _kv_namespace = Assert<Exactly<Diff<{ v: Res<'/api/v1/store/{namespace}', 'get'> }, { v: string[] | Record<string, unknown> }>, never>>;
export type _kv_key = Assert<Exactly<Diff<{ v: Res<'/api/v1/store/{namespace}/{key}', 'get'> }, { v: unknown }>, never>>;
/** http.ts reads any error body as DecaidErrorBody. */
export type _error = Assert<Exactly<Diff<Rest['Error'], C.DecaidErrorBody>, X.ErrorBodyRead>>;

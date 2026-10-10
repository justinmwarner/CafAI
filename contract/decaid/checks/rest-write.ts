/**
 * REST bodies CafAI sends: Diff<CafAI's body, the spec's body> (leaving out an
 * optional field is fine) and Extra<CafAI's body, the spec's body> (a key the
 * spec does not declare), which must equal the exceptions recorded in drift.ts.
 */
import type { Assert, Body, Diff, Exactly, Extra, PathParams, W } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';
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
/** client.ts connectDevice. */
export type _connect = Assert<
  Exactly<Sent<{ deviceId: string; connectionRole?: 'primary' | 'auxiliary' }, Body<'/api/v1/devices/connect', 'put'>>, never>
>;
export type _settings = Assert<
  Exactly<Sent<Parameters<C.DecaidClient['updateSettings']>[0], Body<'/api/v1/settings', 'post'>>, X.SettingsWrite>
>;
export type _bean = Assert<Exactly<Sent<C.BeanCreateRequest, Body<'/api/v1/beans', 'post'>>, never>>;
export type _batch = Assert<Exactly<Sent<C.BatchCreateRequest, Body<'/api/v1/beans/{beanId}/batches', 'post'>>, never>>;

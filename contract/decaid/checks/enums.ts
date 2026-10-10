/**
 * The enums CafAI branches on: the values each side lists that the other does
 * not ("spec only: x", "CafAI only: y"). CafAI's unions are open, so an extra
 * value never crashes it; these show where its allow-lists (Stop, shot
 * detection, the link state) and the spec part ways. CafAI's side drops
 * undefined with Exclude: NonNullable would fold an open union into `string`.
 */
import type { Assert, EnumDrift, Exactly, Rest, Ws } from '../helpers.ts';
import type * as X from '../drift.ts';
import type * as C from '../../../src/api/types.ts';

export type _machine_state_rest = Assert<Exactly<EnumDrift<Rest['MachineState'], C.MachineStateName>, X.MachineStateRestEnum>>;
export type _machine_state_ws = Assert<Exactly<EnumDrift<Ws['MachineState'], C.MachineStateName>, X.MachineStateWsEnum>>;
export type _substate_rest = Assert<Exactly<EnumDrift<Rest['MachineSubstate'], C.MachineSubstate>, X.SubstateRestEnum>>;
export type _substate_ws = Assert<Exactly<EnumDrift<Ws['MachineSubstate'], C.MachineSubstate>, X.SubstateWsEnum>>;
/** Every state CafAI commands is one the REST spec takes. */
export type _commandable = Assert<Exactly<Exclude<C.CommandableState, Rest['MachineState']>, never>>;

export type _device_state_ws = Assert<Exactly<EnumDrift<Ws['DeviceInfo']['state'], C.DeviceEntry['state']>, never>>;
export type _device_state_rest = Assert<Exactly<EnumDrift<NonNullable<Rest['DeviceInventory']['state']>, C.DeviceEntry['state']>, never>>;
export type _device_type_ws = Assert<Exactly<EnumDrift<Ws['DeviceInfo']['type'], C.DeviceEntry['type']>, X.DeviceTypeWsEnum>>;
export type _device_type_rest = Assert<Exactly<EnumDrift<NonNullable<Rest['DeviceInventory']['type']>, C.DeviceEntry['type']>, never>>;
export type _connection_role = Assert<
  Exactly<EnumDrift<NonNullable<Ws['DeviceInfo']['connectionRole']>, Exclude<C.DeviceEntry['connectionRole'], undefined>>, never>
>;
export type _phase = Assert<
  Exactly<EnumDrift<NonNullable<NonNullable<Ws['DevicesState']['connectionStatus']>['phase']>, C.DevicesState['connectionStatus']['phase']>, never>
>;
export type _severity = Assert<Exactly<EnumDrift<Ws['ConnectionError']['severity'], C.ConnectionError['severity']>, never>>;

export type _shot_state = Assert<Exactly<EnumDrift<Ws['ShotStateEvent']['state'], C.ShotStateEvent['state']>, never>>;
export type _shot_event = Assert<Exactly<EnumDrift<Ws['ShotStateEvent']['event'], C.ShotStateEvent['event']>, never>>;
export type _decision = Assert<
  Exactly<EnumDrift<NonNullable<NonNullable<Ws['ShotStateEvent']['decision']>['kind']>, C.ShotDecision['kind']>, never>
>;

export type _visibility = Assert<Exactly<EnumDrift<Rest['Visibility'], C.ProfileRecord['visibility']>, never>>;
export type _gateway_mode = Assert<
  Exactly<EnumDrift<NonNullable<Rest['ReaSettings']['gatewayMode']>, Exclude<C.DecaidSettings['gatewayMode'], undefined>>, never>
>;

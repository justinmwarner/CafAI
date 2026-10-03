// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/live.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: verified frame types, a parser per channel, auxiliary scales excluded.
/**
 * Tolerant parsers for Decaid's WebSocket frames.
 *
 * Anything that is not the expected shape comes back as null, never an
 * exception: a malformed frame must not take the live view down. Enums are
 * open (Decaid adds states and kinds without a version bump), so unknown
 * strings are kept.
 */
import type {
  ConnectionError,
  DeviceEntry,
  DevicesState,
  MachineSnapshot,
  ShotDecision,
  ShotSettings,
  ShotStateEvent,
  WaterLevels,
  WeightSnapshot,
} from './types.ts';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const number = (value: unknown, fallback = 0): number => (finite(value) ? value : fallback);
const numberOrNull = (value: unknown): number | null => (finite(value) ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export type ParsedScaleFrame = { kind: 'status'; connected: boolean } | { kind: 'snapshot'; snapshot: WeightSnapshot } | null;

/** ws/v1/scale/snapshot mixes status and weight frames: branch on `status` vs `weight`. */
export function parseScaleFrame(value: unknown): ParsedScaleFrame {
  if (!isObject(value)) return null;
  if (value.status === 'connected' || value.status === 'disconnected') {
    return { kind: 'status', connected: value.status === 'connected' };
  }
  if (!finite(value.weight)) return null;
  return {
    kind: 'snapshot',
    snapshot: {
      timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
      weight: value.weight,
      weightFlow: number(value.weightFlow),
      battery: numberOrNull(value.battery),
      timerValue: numberOrNull(value.timerValue),
    },
  };
}

/** ws/v1/machine/snapshot: needs a timestamp and a state; missing numbers read as 0. */
export function parseMachineFrame(value: unknown): MachineSnapshot | null {
  if (!isObject(value) || typeof value.timestamp !== 'string' || !isObject(value.state)) return null;
  const state = value.state;
  if (typeof state.state !== 'string') return null;
  return {
    timestamp: value.timestamp,
    state: { state: state.state, substate: typeof state.substate === 'string' ? state.substate : '' },
    flow: number(value.flow),
    pressure: number(value.pressure),
    targetFlow: number(value.targetFlow),
    targetPressure: number(value.targetPressure),
    mixTemperature: number(value.mixTemperature),
    groupTemperature: number(value.groupTemperature),
    targetMixTemperature: number(value.targetMixTemperature),
    targetGroupTemperature: number(value.targetGroupTemperature),
    profileFrame: number(value.profileFrame),
    steamTemperature: number(value.steamTemperature),
  };
}

function parseDevice(value: unknown): DeviceEntry | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.state !== 'string') return null;
  const device: DeviceEntry = {
    name: typeof value.name === 'string' ? value.name : value.id,
    id: value.id,
    state: value.state,
    type: value.type,
    available: value.available !== false,
  };
  if (value.connectionRole === 'primary' || value.connectionRole === 'auxiliary') device.connectionRole = value.connectionRole;
  return device;
}

function parseConnectionError(value: unknown): ConnectionError | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null;
  return {
    kind: value.kind,
    severity: typeof value.severity === 'string' ? value.severity : 'error',
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
    deviceId: stringOrNull(value.deviceId),
    deviceName: stringOrNull(value.deviceName),
    message: typeof value.message === 'string' ? value.message : '',
    suggestion: stringOrNull(value.suggestion),
    details: isObject(value.details) ? value.details : null,
  };
}

function parseFound(value: unknown): DevicesState['connectionStatus']['foundMachines'] {
  if (!Array.isArray(value)) return [];
  return value.map(parseDevice).filter((device): device is DeviceEntry => device !== null).map(({ name, id, state, type }) => ({ name, id, state, type }));
}

/** ws/v1/devices: the authoritative link state. Needs a devices array. */
export function parseDevicesFrame(value: unknown): DevicesState | null {
  if (!isObject(value) || !Array.isArray(value.devices)) return null;
  const status = isObject(value.connectionStatus) ? value.connectionStatus : {};
  const ambiguity = status.pendingAmbiguity;
  return {
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
    devices: value.devices.map(parseDevice).filter((device): device is DeviceEntry => device !== null),
    scanning: value.scanning === true,
    connectionStatus: {
      phase: typeof status.phase === 'string' ? status.phase : 'idle',
      foundMachines: parseFound(status.foundMachines),
      foundScales: parseFound(status.foundScales),
      pendingAmbiguity: ambiguity === 'machinePicker' || ambiguity === 'scalePicker' ? ambiguity : null,
      error: parseConnectionError(status.error),
    },
  };
}

export interface DeviceConnections {
  machine: boolean;
  scale: boolean;
}

/**
 * Hardware state comes from ws/v1/devices, never from socket liveness: the
 * machine and scale sockets stay open while their device is away. The
 * brewing scale is the primary one; an auxiliary (dosing) scale never stops
 * a shot.
 */
export function deviceConnections(value: unknown): DeviceConnections | null {
  if (!isObject(value) || !Array.isArray(value.devices)) return null;
  const devices = value.devices.filter(isObject);
  return {
    machine: devices.some((device) => device.type === 'machine' && device.state === 'connected'),
    scale: devices.some((device) => device.type === 'scale' && device.state === 'connected' && device.connectionRole !== 'auxiliary'),
  };
}

function parseDecision(value: unknown): ShotDecision | null {
  if (!isObject(value) || typeof value.kind !== 'string' || typeof value.reason !== 'string') return null;
  return {
    kind: value.kind,
    reason: value.reason,
    details: stringOrNull(value.details),
    data: isObject(value.data) ? value.data : null,
  };
}

/** ws/v1/machine/shotState. */
export function parseShotStateFrame(value: unknown): ShotStateEvent | null {
  if (!isObject(value) || typeof value.state !== 'string' || typeof value.event !== 'string') return null;
  return {
    event: value.event,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : '',
    shotId: stringOrNull(value.shotId),
    state: value.state,
    machineState: stringOrNull(value.machineState),
    machineSubstate: stringOrNull(value.machineSubstate),
    profileFrame: numberOrNull(value.profileFrame),
    scaleConnected: value.scaleConnected === true,
    scaleLost: value.scaleLost === true,
    machineHasAutonomousSAW: value.machineHasAutonomousSAW === true,
    decision: parseDecision(value.decision),
  };
}

/** ws/v1/machine/waterLevels (mm). */
export function parseWaterLevelsFrame(value: unknown): WaterLevels | null {
  if (!isObject(value) || !finite(value.currentLevel)) return null;
  return { currentLevel: value.currentLevel, refillLevel: number(value.refillLevel) };
}

const SHOT_SETTINGS_KEYS = [
  'steamSetting',
  'targetSteamTemp',
  'targetSteamDuration',
  'targetHotWaterTemp',
  'targetHotWaterVolume',
  'targetHotWaterDuration',
  'targetShotVolume',
  'groupTemp',
] as const;

/** ws/v1/machine/shotSettings: all eight numbers or nothing. */
export function parseShotSettingsFrame(value: unknown): ShotSettings | null {
  if (!isObject(value)) return null;
  const settings: Partial<ShotSettings> = {};
  for (const key of SHOT_SETTINGS_KEYS) {
    const field = value[key];
    if (!finite(field)) return null;
    settings[key] = field;
  }
  return settings as ShotSettings;
}

/**
 * Clamps and field layout for Settings > Steam, hot water and flush (6.6).
 * A range comes from Decaid's spec (contract/decaid/spec/rest_v1.yml,
 * schemas SteamSettings, HotWaterData, RinseData) where it gives one; where
 * it does not, streamline's clamps (docs/audit/2026-10-09/streamline.md) and
 * the DE1's own wire limits (.ref/decaid, checked against aab5f93) fill the
 * gap; failing both, the range here is a practical ceiling so a mistyped
 * value is never sent as is. Integers match the spec's `type: integer`;
 * everything else is rounded to one decimal.
 *
 * Wire limits checked in .ref/decaid: a workflow PUT that changes
 * steamSettings or hotWaterData reaches the DE1 through
 * De1Controller._writeSteamSettings / _writeHotWaterSettings
 * (de1_controller.dart:472-531), both of which call
 * UnifiedDe1.updateShotSettings (unified_de1.dart:611-630). That packs
 * targetSteamTemp, targetSteamDuration, targetHotWaterTemp,
 * targetHotWaterVolume and targetHotWaterDuration into single bytes of a
 * Uint8List, unchecked: a value over 255 wraps (300 writes as 300 % 256 =
 * 44). rinseData and every flow (steam, hot water, flush) instead go
 * through MMR registers (_writeMMRScaled, unified_de1.mmr.dart:143), a
 * signed 32-bit int scaled by 10, which our ranges are nowhere near.
 */
import { AT_REST_STATES, isRunningMachineState } from '../../api/machineStates.ts';

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** One field: its label (already named for its drink, e.g. "Steam temperature"), unit, range and step. */
export interface DrinkFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly integer: boolean;
  readonly step: number;
  readonly range: Range;
  /**
   * The value Decaid uses to mean this drink is off (steam temperature 0).
   * Shown read-only with offNote under it, and never written by a blur or a
   * stepper tap: turning steam on or off is not offered by this screen.
   */
  readonly offValue?: number;
  readonly offNote?: string;
}

function clamp(value: number, range: Range, integer: boolean): number {
  const bounded = Math.min(range.max, Math.max(range.min, value));
  return integer ? Math.round(bounded) : Math.round(bounded * 10) / 10;
}

/** Clamps a value into a field's range, rounding to an integer or one decimal as the field needs. A non-finite value becomes the range's minimum. */
export function clampDrinkField(spec: DrinkFieldSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.range.min;
  return clamp(value, spec.range, spec.integer);
}

/**
 * Steam temperature's enabled range is 135-160 C on a DE1 and 135-165 C on a
 * Bengle (rest_v1.yml SteamSettings.targetTemperature; confirmed by
 * streamline's steam heater rule); below it Decaid treats the heater as
 * disabled. CafAI reads the connected machine's model
 * (services.decaid.getMachineInfo()) to pick the right ceiling, and uses
 * the narrower DE1 range until the model is known (fails safe: it would
 * rather refuse a Bengle-only value than risk writing one to a DE1, where
 * it wraps a single byte above 255 anyway, let alone matters below it).
 */
export function steamTemperatureField(model: string | null): DrinkFieldSpec {
  return {
    key: 'targetTemperature',
    label: 'Steam temperature',
    unit: '°C',
    integer: true,
    step: 1,
    range: { min: 135, max: model === 'Bengle' ? 165 : 160 },
    offValue: 0,
    offNote: 'Steam is off in Decaid',
  };
}

/**
 * No range in the spec or in streamline for steam duration. The DE1 write
 * packs it into one byte (0-255); this is a practical ceiling on a steam
 * session, well inside that.
 */
export const STEAM_DURATION: DrinkFieldSpec = {
  key: 'duration',
  label: 'Steam time',
  unit: 's',
  integer: true,
  step: 5,
  range: { min: 1, max: 120 },
};
/** No range in the spec or in streamline for steam flow; it goes to an MMR register (unified_de1.mmr.dart), not the byte-packed write. Decaid's own default is 0.8. */
export const STEAM_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Steam flow',
  unit: 'ml/s',
  integer: false,
  step: 0.1,
  range: { min: 0.1, max: 2 },
};

export function steamFields(model: string | null): readonly DrinkFieldSpec[] {
  return [steamTemperatureField(model), STEAM_DURATION, STEAM_FLOW];
}

/**
 * No range in the spec or in streamline for hot water temperature. The DE1
 * write packs it into one byte (0-255); bounded here by water's own
 * boiling point, well inside that.
 */
export const HOT_WATER_TEMPERATURE: DrinkFieldSpec = {
  key: 'targetTemperature',
  label: 'Hot water temperature',
  unit: '°C',
  integer: true,
  step: 1,
  range: { min: 1, max: 100 },
};
/**
 * The DE1 write packs hot water volume into one byte of a Uint8List,
 * unchecked (unified_de1.dart:611-630): 255 is the most it can hold, and
 * 300 would wrap to 44 ml. streamline caps its own hot water volume
 * stepper at 255 for the same reason (.ref/streamline-js/src/modules/ui.js,
 * incrementHotWater).
 */
export const HOT_WATER_VOLUME: DrinkFieldSpec = {
  key: 'volume',
  label: 'Hot water volume',
  unit: 'ml',
  integer: true,
  step: 10,
  range: { min: 1, max: 255 },
};
/**
 * No range in the spec or in streamline for hot water duration. The DE1
 * write packs it into one byte (0-255); this is a practical ceiling on a
 * dispense, well inside that.
 */
export const HOT_WATER_DURATION: DrinkFieldSpec = {
  key: 'duration',
  label: 'Hot water time',
  unit: 's',
  integer: true,
  step: 5,
  range: { min: 1, max: 120 },
};
/** No range in the spec or in streamline for hot water flow; it goes to an MMR register, not the byte-packed write. Decaid's own default is 10. */
export const HOT_WATER_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Hot water flow',
  unit: 'ml/s',
  integer: false,
  step: 0.5,
  range: { min: 0.1, max: 15 },
};

export const HOT_WATER_FIELDS: readonly DrinkFieldSpec[] = [HOT_WATER_TEMPERATURE, HOT_WATER_VOLUME, HOT_WATER_DURATION, HOT_WATER_FLOW];

/** No range in the spec or in streamline for flush duration; an MMR register (unified_de1.mmr.dart), not the byte-packed write. A flush runs a few seconds. */
export const RINSE_DURATION: DrinkFieldSpec = {
  key: 'duration',
  label: 'Flush time',
  unit: 's',
  integer: true,
  step: 1,
  range: { min: 1, max: 30 },
};
/** No range in the spec or in streamline for flush temperature; an MMR register, not the byte-packed write. Bounded by water's own boiling point. */
export const RINSE_TEMPERATURE: DrinkFieldSpec = {
  key: 'targetTemperature',
  label: 'Flush temperature',
  unit: '°C',
  integer: true,
  step: 1,
  range: { min: 1, max: 100 },
};
/** No range in the spec or in streamline for flush flow; an MMR register, not the byte-packed write. Decaid's own default is 6. */
export const RINSE_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Flush flow',
  unit: 'ml/s',
  integer: false,
  step: 0.5,
  range: { min: 0.1, max: 15 },
};

export const RINSE_FIELDS: readonly DrinkFieldSpec[] = [RINSE_DURATION, RINSE_TEMPERATURE, RINSE_FLOW];

/**
 * Spec 6.6: never write a drink setting while a shot, steam, hot water or
 * flush runs. Decaid's own machine-state list has more running states than
 * those four (steamRinse follows steam off, skipStep is mid-espresso), so
 * this reuses the lists the Stop button and the frame parser use
 * (src/api/machineStates.ts) instead of a shorter, separately maintained one.
 * It fails safe like Stop does (D97): only a state known to be at rest takes
 * a write, so a firmware upgrade, a calibration or a state CafAI has never
 * heard of blocks it too.
 */
export function blocksDrinkSettings(state: string | null | undefined): boolean {
  if (typeof state !== 'string' || state === '') return false;
  return isRunningMachineState(state) || !AT_REST_STATES.has(state);
}

/**
 * Clamps and field layout for Settings > Steam, hot water and flush (6.6).
 * A range comes from Decaid's spec (contract/decaid/spec/rest_v1.yml,
 * schemas SteamSettings, HotWaterData, RinseData) where it gives one; where
 * it does not, streamline's clamps (docs/audit/2026-10-09/streamline.md) and
 * the DE1's own wire limits (.ref/decaid, checked against aab5f93) fill the
 * gap; failing both, the range here is a practical ceiling so a mistyped
 * value is never sent as is. Each range takes in what Decaid's own screens
 * set (steam_form.dart, hot_water_form.dart, rinse_form.dart at aab5f93:
 * steam 135-170 °C, 0-120 s, 0.4-2.5 ml/s; hot water 50-95 °C, 0-250 ml,
 * 0-60 s, 1-8 ml/s; flush 5-95 °C, 0-60 s, 1-8 ml/s), but for a time or a
 * volume of 0, which this screen never writes (steam time 0 is streamline's
 * steam off), and steam temperature, which keeps the spec's narrower range.
 * Integers match the spec's `type: integer`; everything else is rounded to
 * one decimal. A stepper only ever moves a value the way it points: at or
 * past the end of the range it sends nothing (nudgeDrinkField).
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

/**
 * One field: its label (already named for its drink, e.g. "Steam temperature",
 * the name a screen reader hears and a failed save says), the short label shown
 * under the drink's own heading ("Temperature"), its unit as shown and as
 * spoken, range and step.
 */
export interface DrinkFieldSpec {
  readonly key: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly unit: string;
  readonly spokenUnit: string;
  readonly integer: boolean;
  readonly step: number;
  readonly range: Range;
  /**
   * Values below this mean the drink is off in Decaid (steam temperature
   * under 135 °C: Decaid writes 0, heater off, de1_controller.dart:575 at
   * aab5f93). Shown read-only as offText in place of the value, without
   * buttons, and never written by a blur, a stepper tap or an arrow key:
   * turning steam on or off is not offered by this screen.
   */
  readonly offBelow?: number;
  readonly offText?: string;
}

/** Each unit as the stepper shows it after the value, and as a screen reader says it. */
const CELSIUS = { unit: '°C', spokenUnit: 'degrees Celsius' } as const;
const SECONDS = { unit: 's', spokenUnit: 'seconds' } as const;
const MILLILITRES = { unit: 'ml', spokenUnit: 'millilitres' } as const;
const MILLILITRES_PER_SECOND = { unit: 'ml/s', spokenUnit: 'millilitres per second' } as const;

function clamp(value: number, range: Range, integer: boolean): number {
  const bounded = Math.min(range.max, Math.max(range.min, value));
  return integer ? Math.round(bounded) : Math.round(bounded * 10) / 10;
}

/** Clamps a value into a field's range, rounding to an integer or one decimal as the field needs. A non-finite value becomes the range's minimum. */
export function clampDrinkField(spec: DrinkFieldSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.range.min;
  return clamp(value, spec.range, spec.integer);
}

/** The drink is off in Decaid at this value (steam below 135 °C). */
export function isDrinkOff(spec: DrinkFieldSpec, value: number): boolean {
  return spec.offBelow !== undefined && value < spec.offBelow;
}

/**
 * What a stepper tap writes: one step the way it points, clamped into the
 * range, or null to send nothing. More at or above the range's top, or Less
 * at or below its floor, sends nothing, so a value Decaid holds outside
 * CafAI's range (another skin's, or steam time 0) never moves the wrong
 * way; one beyond the far end comes back into the range.
 */
export function nudgeDrinkField(spec: DrinkFieldSpec, value: number, direction: 1 | -1): number | null {
  if (!Number.isFinite(value)) return null;
  if (direction === 1 ? value >= spec.range.max : value <= spec.range.min) return null;
  const next = clamp(value + direction * spec.step, spec.range, spec.integer);
  return next === value ? null : next;
}

/**
 * Steam temperature's enabled range is 135-160 C on a DE1 and 135-165 C on a
 * Bengle (rest_v1.yml SteamSettings.targetTemperature; confirmed by
 * streamline's steam heater rule); below it Decaid treats the heater as
 * disabled, so anything below 135 shows as Off. Decaid's own screen goes to
 * 170; CafAI keeps the spec's supported range. CafAI reads the connected
 * machine's model (services.decaid.getMachineInfo()) to pick the right
 * ceiling, and uses the narrower DE1 range until the model is known (fails
 * safe: it would rather refuse a Bengle-only value than risk writing one to
 * a DE1, where it wraps a single byte above 255 anyway, let alone matters
 * below it).
 */
export function steamTemperatureField(model: string | null): DrinkFieldSpec {
  return {
    key: 'targetTemperature',
    label: 'Steam temperature',
    shortLabel: 'Temperature',
    ...CELSIUS,
    integer: true,
    step: 1,
    range: { min: 135, max: model === 'Bengle' ? 165 : 160 },
    offBelow: 135,
    offText: 'Off in Decaid',
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
  shortLabel: 'Time',
  ...SECONDS,
  integer: true,
  step: 5,
  range: { min: 1, max: 120 },
};
/**
 * No range in the spec or in streamline for steam flow; it goes to an MMR
 * register (unified_de1.mmr.dart), not the byte-packed write. Decaid's own
 * screen goes to 2.5 (steam_form.dart:114-115); its default is 0.8.
 */
export const STEAM_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Steam flow',
  shortLabel: 'Flow',
  ...MILLILITRES_PER_SECOND,
  integer: false,
  step: 0.1,
  range: { min: 0.1, max: 2.5 },
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
  shortLabel: 'Temperature',
  ...CELSIUS,
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
  shortLabel: 'Volume',
  ...MILLILITRES,
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
  shortLabel: 'Time',
  ...SECONDS,
  integer: true,
  step: 5,
  range: { min: 1, max: 120 },
};
/** No range in the spec or in streamline for hot water flow; it goes to an MMR register, not the byte-packed write. Decaid's own default is 10. */
export const HOT_WATER_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Hot water flow',
  shortLabel: 'Flow',
  ...MILLILITRES_PER_SECOND,
  integer: false,
  step: 0.5,
  range: { min: 0.1, max: 15 },
};

export const HOT_WATER_FIELDS: readonly DrinkFieldSpec[] = [HOT_WATER_TEMPERATURE, HOT_WATER_VOLUME, HOT_WATER_DURATION, HOT_WATER_FLOW];

/**
 * No range in the spec or in streamline for flush duration; an MMR register
 * (unified_de1.mmr.dart), not the byte-packed write. A flush runs a few
 * seconds; Decaid's own screen goes to 60 (rinse_form.dart:66-67).
 */
export const RINSE_DURATION: DrinkFieldSpec = {
  key: 'duration',
  label: 'Flush time',
  shortLabel: 'Time',
  ...SECONDS,
  integer: true,
  step: 1,
  range: { min: 1, max: 60 },
};
/** No range in the spec or in streamline for flush temperature; an MMR register, not the byte-packed write. Bounded by water's own boiling point. */
export const RINSE_TEMPERATURE: DrinkFieldSpec = {
  key: 'targetTemperature',
  label: 'Flush temperature',
  shortLabel: 'Temperature',
  ...CELSIUS,
  integer: true,
  step: 1,
  range: { min: 1, max: 100 },
};
/** No range in the spec or in streamline for flush flow; an MMR register, not the byte-packed write. Decaid's own default is 6. */
export const RINSE_FLOW: DrinkFieldSpec = {
  key: 'flow',
  label: 'Flush flow',
  shortLabel: 'Flow',
  ...MILLILITRES_PER_SECOND,
  integer: false,
  step: 0.5,
  range: { min: 0.1, max: 15 },
};

/** Temperature first, as steam and hot water have it (D124); Decaid's own flush screen leads with the time. */
export const RINSE_FIELDS: readonly DrinkFieldSpec[] = [RINSE_TEMPERATURE, RINSE_DURATION, RINSE_FLOW];

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

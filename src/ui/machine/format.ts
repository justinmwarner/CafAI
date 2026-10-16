/**
 * Machine readouts in words and units a barista reads at arm's length.
 *
 * Decaid's enums are open (a newer firmware or a Bengle can send a state this
 * build has never seen), so every function here accepts any string and falls
 * back to something readable instead of throwing.
 */
import { isShotMachineState } from '../../api/machineStates.ts';
import type { WaterLevels } from '../../api/types.ts';
import { formatTemperatureIn, type TemperatureUnit } from '../../coach/temperature.ts';

/** What a readout shows for a value the machine has not given: never a 0, never a unit alone. */
export const DASH = '—';

const STATE_WORDS: Record<string, string> = {
  idle: 'Ready',
  schedIdle: 'Ready',
  sleeping: 'Sleeping',
  heating: 'Heating',
  preheating: 'Heating',
  steam: 'Steaming',
  steamRinse: 'Steam rinse',
  flush: 'Flushing',
  hotWater: 'Hot water',
  needsWater: 'Needs water',
  error: 'Error',
  booting: 'Starting up',
  busy: 'Busy',
  cleaning: 'Cleaning',
  descaling: 'Descaling',
  calibration: 'Calibrating',
  selfTest: 'Self test',
  airPurge: 'Air purge',
  fwUpgrade: 'Updating firmware',
};

const SHOT_PHASES: Record<string, string> = {
  preparingForShot: 'preheating',
  preinfusion: 'preinfusion',
  pouring: 'pouring',
  pouringDone: 'ending',
};

/**
 * Substates during which the machine runs a profile step. A step can hold the
 * pump off (Blooming's 30 s bloom still reports `pouring`), so its name says
 * more than the substate.
 */
const STEP_SUBSTATES: ReadonlySet<string> = new Set(['preinfusion', 'pouring']);

/** "someFutureState" -> "Some future state". */
function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The machine is heating up, by its own state: Decaid says heating or
 * preheating, or a DE1 says idle while it prepares its water
 * (preparingForShot, what a warming DE1 reports: de1.utils.dart at aab5f93).
 * Never by time-to-ready's status, which the plugin works out from a 2 s
 * temperature slope on every snapshot, so a machine at rest moves between
 * reached, not_heating and heating (streamline's rule, app.js).
 */
export function isHeatingUp(state: string | null | undefined, substate: string | null | undefined): boolean {
  return state === 'heating' || state === 'preheating' || (state === 'idle' && substate === 'preparingForShot');
}

/**
 * The machine state as a short phrase: "Ready", "Heating", "Pulling a shot:
 * preinfusion", "Not connected". `stepName` is the running profile step's
 * name, when the profile is known; it replaces the phase while a step runs.
 */
export function describeMachineState(
  state: string | null | undefined,
  substate: string | null | undefined,
  connected: boolean,
  stepName?: string | null,
): string {
  if (!connected) return 'Not connected';
  if (!state) return 'Connected';
  // A DE1 warming up says it is idle: "Ready" would be wrong for minutes.
  if (isHeatingUp(state, substate)) return 'Heating';
  // A shot, skipStep included: the moment it moves to its next step.
  if (isShotMachineState(state)) {
    const step = substate && STEP_SUBSTATES.has(substate) ? stepName?.trim() : undefined;
    const phase = step || (substate ? SHOT_PHASES[substate] : undefined);
    return phase ? `Pulling a shot: ${phase}` : 'Pulling a shot';
  }
  return STATE_WORDS[state] ?? humanize(state);
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A reading in °C as the barista reads it: "97.7 °C", or in °F "207.9 °F" (D-TEMP-4); a dash for none. */
export function formatTemperature(celsius: number | null | undefined, digits = 1, unit: TemperatureUnit = 'celsius'): string {
  return finite(celsius) ? formatTemperatureIn(celsius, unit, digits) : DASH;
}

export function formatWeight(grams: number | null | undefined): string {
  if (!finite(grams)) return DASH;
  // A resting scale wobbles around zero; "-0.0 g" reads as a fault.
  const shown = Math.abs(grams) < 0.05 ? 0 : grams;
  return `${shown.toFixed(1)} g`;
}

export function formatWaterLevel(levels: WaterLevels | null | undefined): string {
  return levels && finite(levels.currentLevel) ? `${Math.round(levels.currentLevel)} mm` : DASH;
}

/** At or below the level where the DE1 asks for a refill. */
export function isWaterLow(levels: WaterLevels | null | undefined): boolean {
  return Boolean(levels && finite(levels.currentLevel) && finite(levels.refillLevel) && levels.currentLevel <= levels.refillLevel);
}

export function formatSeconds(seconds: number | null | undefined): string {
  return `${(finite(seconds) && seconds > 0 ? seconds : 0).toFixed(1)} s`;
}

/**
 * "97.7 °C" as its number and unit, so a readout can set the unit smaller
 * and quieter than the number. A dash or a word comes back whole.
 */
export function splitUnit(text: string): { value: string; unit: string | null } {
  const match = /^(-?\d+(?:\.\d+)?)\s+(\S+)$/.exec(text);
  return match ? { value: match[1]!, unit: match[2]! } : { value: text, unit: null };
}

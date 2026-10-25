/**
 * Grind moves on the user's own grinder, sized with Decaid's grinder library
 * (D62).
 *
 * Decaid lists a numeric grinder's small step (`settingSmallStep`) or a
 * preset grinder's settings (`settingValues`), but no range and no "which
 * way is finer". The barista says which way in Settings > Grinder > Finer is
 * (D241, `GrinderInfo.finerIsHigher`); until they do, CafAI assumes the
 * common conventions: lower numbers are finer, and a preset list runs finest
 * first. With that, a relative move ("1 step finer") becomes the new
 * setting, and a setting the model names is checked against the grinder's
 * own grid. Without step data, or with a current setting CafAI cannot read,
 * the move stays exactly as the model gave it.
 */
import type { ProposeAdjustment } from './contract.ts';
import { decimalsOf } from './levers.ts';
import type { GrinderInfo } from './types.ts';

/** Largest grind move per iteration, in steps of the grinder's own dial. */
export const GRIND_MAX_STEPS = 5;

type GrindInput = NonNullable<ProposeAdjustment['grind']>;
type Direction = GrindInput['direction'];

/** How close to a whole step a numeric move must land (in steps). */
const GRID_SLACK = 1e-6;

/** A non-negative plain decimal, the way a numeric dial reads ("15", "14.5"). */
const DIAL_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
/** A decimal the model may name, negative included so it can be told why it is wrong. */
const SIGNED_NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Decaid's small step of a numeric grinder, without float noise; null when there is none to use. */
export function grinderStep(grinder: GrinderInfo | null | undefined): number | null {
  if (!grinder || grinder.settingType !== 'numeric') return null;
  const step = grinder.smallStep;
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) return null;
  return Number(step.toPrecision(12));
}

/**
 * A preset grinder's list, finest first (D241). A list of numbers in order
 * is read by the barista's answer, whichever way Decaid keeps it: from its
 * lowest where lower numbers are finer (D62), from its highest where higher
 * ones are, so Finer is always decides. Any other list (words, numbers out
 * of order) is read in Decaid's order, finest first, and backwards on a
 * grinder whose higher numbers are finer.
 */
export function finestFirst(values: readonly string[], finerIsHigher: boolean): string[] {
  const numbers = values.map((value) => (SIGNED_NUMBER.test(value.trim()) ? Number(value) : Number.NaN));
  const runsDown = numbers.every((n, i) => Number.isFinite(n) && (i === 0 || n < numbers[i - 1]!));
  const backwards = finerIsHigher ? !runsDown : runsDown;
  return backwards ? [...values].reverse() : [...values];
}

/** Decaid's settings of a preset grinder, trimmed, finest first whichever way its numbers go (finestFirst); null when there are none. */
export function grinderSettings(grinder: GrinderInfo | null | undefined): string[] | null {
  if (!grinder || grinder.settingType !== 'preset' || !grinder.values || grinder.values.length === 0) return null;
  return finestFirst(grinder.values.map((value) => String(value).trim()), grinder.finerIsHigher === true);
}

function modelName(grinder: GrinderInfo): string {
  const model = grinder.model.trim();
  return model === '' ? 'grinder' : model;
}

/**
 * Where the step came from, for the user: "Decaid lists 0.5 steps for your
 * Niche Zero", "Decaid lists 40 settings for your Ditting 807". Null when
 * Decaid has no step data for the grinder.
 */
export function decaidStepNote(grinder: GrinderInfo | null | undefined): string | null {
  if (!grinder) return null;
  const step = grinderStep(grinder);
  if (step !== null) {
    const steps = step === 1 ? 'steps of 1' : `${String(step)} steps`;
    return `Decaid lists ${steps} for your ${modelName(grinder)}`;
  }
  const settings = grinderSettings(grinder);
  return settings ? `Decaid lists ${settings.length} settings for your ${modelName(grinder)}` : null;
}

/** The refusal for a "new" setting that is the one on the dial now (shared with the plain path). */
export function sameSettingError(setting: string, direction: Direction): string {
  return `grind.setting "${setting}" is the setting the grinder is on now. Give the new setting after the move (${direction}), or null if you do not know it.`;
}

/** A grind move worked out or checked on the grinder's dial. */
export interface DialMove {
  /** The new setting; null when the move is unsized ("a little finer"). */
  setting: string | null;
  /** Small steps (numeric) or places in the list (preset) from the current setting; null when unsized. */
  steps: number | null;
  /** Adjustments worth telling the user, e.g. a step count that differs from the model's. */
  notes: string[];
}

export type DialResult = { ok: true; move: DialMove } | { ok: false; error: string };

const done = (move: DialMove): DialResult => ({ ok: true, move });
const refuse = (error: string): DialResult => ({ ok: false, error });

const stepWord = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;
const quote = (text: string) => `"${text}"`;

/** A note for the card when the model's amount disagrees with the steps its own setting is away. */
function amountNote(grinder: GrinderInfo, from: string, to: string, steps: number, amount: number | null): string[] {
  if (amount === null || Math.abs(amount - steps) <= GRID_SLACK) return [];
  return [`${decaidStepNote(grinder) ?? 'Decaid'}, so ${from} to ${to} is ${stepWord(steps)}, not ${String(amount)}.`];
}

// ---------------------------------------------------------------------------
// Numeric dial
// ---------------------------------------------------------------------------

interface NumericDial {
  grinder: GrinderInfo;
  step: number;
  /** Decimals a setting on this dial is printed with. */
  decimals: number;
  current: number;
  /** The reading as the user wrote it, for messages. */
  currentText: string;
  /** Which way a finer move goes on the dial: 1, up, where higher numbers are finer (D241); -1, down (D62). */
  finer: 1 | -1;
}

/** Which way a move goes on the dial: 1 up, -1 down. */
function towards(dial: NumericDial, direction: Direction): number {
  return direction === 'finer' ? dial.finer : -dial.finer;
}

/** A value on the dial's grid, without float noise or "-0" ("14.5" and "14.0" on a 0.5 dial; "14" on a 1 dial). */
function onGrid(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return (rounded === 0 ? 0 : rounded).toFixed(decimals);
}

function numericHint(dial: NumericDial, direction: Direction): string {
  const next = dial.current + towards(dial, direction) * dial.step;
  // Only the move down the dial can pass 0: finer where lower numbers are finer, coarser where higher ones are (D241).
  const where =
    next < -GRID_SLACK * dial.step
      ? `it cannot go ${direction} than ${dial.currentText}`
      : `1 step ${direction} from ${dial.currentText} is ${onGrid(next, dial.decimals)}`;
  return `Your grinder moves in steps of ${String(dial.step)} (Decaid's grinder library): ${where}.`;
}

function moveNumeric(dial: NumericDial, grind: GrindInput, setting: string | null): DialResult {
  const { direction } = grind;
  const hint = numericHint(dial, direction);
  const sign = towards(dial, direction);

  if (setting === null) {
    if (grind.amount === null) return done({ setting: null, steps: null, notes: [] });
    if (!Number.isInteger(grind.amount)) {
      return refuse(`grind.amount ${String(grind.amount)} is not a whole number of steps. ${hint}`);
    }
    const value = dial.current + sign * grind.amount * dial.step;
    if (value < -GRID_SLACK * dial.step) {
      return refuse(
        `grind: ${stepWord(grind.amount)} ${direction} from ${dial.currentText} would be ${onGrid(value, dial.decimals)}, below 0. ${hint}`,
      );
    }
    return done({ setting: onGrid(value, dial.decimals), steps: grind.amount, notes: [] });
  }

  const named = `grind.setting ${quote(setting)}`;
  if (!SIGNED_NUMBER.test(setting)) return refuse(`${named} is not a number. ${hint}`);
  const value = Number(setting);
  if (value < 0) return refuse(`${named} is below 0. ${hint}`);
  const exact = (value - dial.current) / dial.step;
  const steps = Math.round(exact);
  if (Math.abs(exact - steps) > GRID_SLACK) return refuse(`${named} is not a whole number of steps from ${dial.currentText}. ${hint}`);
  if (steps === 0) return refuse(sameSettingError(setting, direction));
  const actual: Direction = Math.sign(steps) === dial.finer ? 'finer' : 'coarser';
  if (actual !== direction) {
    const way = dial.finer === 1 ? 'higher' : 'lower';
    return refuse(`${named} is ${actual} than ${dial.currentText} (${way} numbers are finer), but grind.direction is "${direction}". ${hint}`);
  }
  const distance = Math.abs(steps);
  if (distance > GRIND_MAX_STEPS) {
    return refuse(`${named} is ${stepWord(distance)} from ${dial.currentText}; move at most ${GRIND_MAX_STEPS} steps per shot. ${hint}`);
  }
  return done({ setting, steps: distance, notes: amountNote(dial.grinder, dial.currentText, setting, distance, grind.amount) });
}

// ---------------------------------------------------------------------------
// Preset list
// ---------------------------------------------------------------------------

interface PresetDial {
  grinder: GrinderInfo;
  settings: string[];
  index: number;
}

/** The list around the current setting (GRIND_MAX_STEPS each way), so a long list stays short. */
function listHint(dial: PresetDial): string {
  const lo = Math.max(0, dial.index - GRIND_MAX_STEPS);
  const hi = Math.min(dial.settings.length - 1, dial.index + GRIND_MAX_STEPS);
  const around = lo === 0 && hi === dial.settings.length - 1 ? '' : ` around ${quote(dial.settings[dial.index]!)}`;
  const shown = dial.settings.slice(lo, hi + 1).map(quote).join(', ');
  return `Your grinder's settings in Decaid's grinder library${around}, finest first: ${shown}.`;
}

function movePreset(dial: PresetDial, grind: GrindInput, setting: string | null): DialResult {
  const { direction } = grind;
  const { settings, index } = dial;
  const current = settings[index]!;
  const hint = listHint(dial);
  const sign = direction === 'finer' ? -1 : 1;

  if (setting === null) {
    if (grind.amount === null) return done({ setting: null, steps: null, notes: [] });
    if (!Number.isInteger(grind.amount)) {
      return refuse(`grind.amount ${String(grind.amount)} is not a whole number of steps (one step is one place in the list). ${hint}`);
    }
    const target = index + sign * grind.amount;
    if (target < 0 || target >= settings.length) {
      const endIndex = target < 0 ? 0 : settings.length - 1;
      const end = settings[endIndex]!;
      const extreme = direction === 'finer' ? 'finest' : 'coarsest';
      const room = Math.abs(endIndex - index);
      const where =
        room === 0
          ? `${quote(end)} is already the ${extreme} setting`
          : `the ${extreme} setting, ${quote(end)}, is ${stepWord(room)} ${direction}`;
      return refuse(
        `grind: ${stepWord(grind.amount)} ${direction} from ${quote(current)} goes past the end of the list: ${where}. ${hint}`,
      );
    }
    return done({ setting: settings[target]!, steps: grind.amount, notes: [] });
  }

  const named = `grind.setting ${quote(setting)}`;
  const target = settings.indexOf(setting);
  if (target < 0) return refuse(`${named} is not one of your grinder's settings. ${hint}`);
  if (target === index) return refuse(sameSettingError(setting, direction));
  const actual: Direction = target < index ? 'finer' : 'coarser';
  if (actual !== direction) {
    return refuse(`${named} is ${actual} than ${quote(current)} in the list, but grind.direction is "${direction}". ${hint}`);
  }
  const distance = Math.abs(target - index);
  if (distance > GRIND_MAX_STEPS) {
    return refuse(`${named} is ${distance} places from ${quote(current)}; move at most ${GRIND_MAX_STEPS} places per shot. ${hint}`);
  }
  return done({ setting, steps: distance, notes: amountNote(dial.grinder, current, setting, distance, grind.amount) });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Work out or check a grind move with Decaid's grinder library. A relative
 * move (amount, no setting) becomes the new setting; a setting the model
 * names must sit on the grinder's grid (a whole number of small steps, or an
 * entry of its list), in the stated direction, at most GRIND_MAX_STEPS away.
 * `grind.amount` is already checked by the caller (more than 0, at most
 * GRIND_MAX_STEPS).
 *
 * Returns null when CafAI cannot use the dial: no grinder, no step or list,
 * or a current setting it cannot read (empty, not a plain non-negative
 * number on a numeric dial, not in the list of a preset one). The caller
 * then keeps the move as the model gave it.
 */
export function resolveGrindMove(
  grinder: GrinderInfo | null | undefined,
  currentSetting: string | null,
  grind: GrindInput,
): DialResult | null {
  if (!grinder) return null;
  const currentText = currentSetting?.trim() ?? '';
  if (currentText === '') return null;
  const setting = grind.setting?.trim() ? grind.setting.trim() : null;

  const step = grinderStep(grinder);
  if (step !== null) {
    // A negative reading means the dial does not start at 0, so "below 0" and
    // which way is finer on its far side may not hold: keep the move as given.
    if (!DIAL_NUMBER.test(currentText)) return null;
    // The step's decimals, or the reading's when it is written finer (14.25 on
    // a 0.5 dial): 14.25 - 0.5 must print 13.75, not 13.8, to stay on its grid.
    const dot = currentText.indexOf('.');
    const decimals = Math.max(decimalsOf(step), dot < 0 ? 0 : currentText.length - dot - 1);
    const finer = grinder.finerIsHigher === true ? 1 : -1;
    const dial: NumericDial = { grinder, step, decimals, current: Number(currentText), currentText, finer };
    return moveNumeric(dial, grind, setting);
  }

  const settings = grinderSettings(grinder);
  const index = settings ? settings.indexOf(currentText) : -1;
  if (!settings || index < 0) return null;
  return movePreset({ grinder, settings, index }, grind, setting);
}

// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/ui/views.ts leadChange (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: plain-language lines for one lever, grind or dose change.

/**
 * Plain-language change lines for the confirm card, history and undo.
 *
 * Crema's lesson from `leadChange`: phrase a change the way the barista will
 * act on it. A grind move leads with its direction ("finer" says more than
 * "12.4 -> 12.0"), and "no change" is said out loud rather than shown as an
 * empty card.
 */
import type { ProposeAdjustment } from './contract.ts';
import { decaidStepNote } from './grinder.ts';
import { decimalsOf, findLever } from './levers.ts';
import type { GrinderInfo, Lever, ProfileJson, ProfileStep, StepExit, Template } from './types.ts';

const ARROW = '->';

/** A lever value with the lever's precision and unit: "92.0 °C", "36 g", "2.2 ml/s". */
export function formatLeverValue(lever: Lever, value: number): string {
  return `${value.toFixed(decimalsOf(lever.granularity))} ${lever.unit}`;
}

function signed(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 ? `-${text}` : `+${text}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** Names of the steps a lever's paths point at, in order, without repeats. */
function stepNames(template: Template, lever: Lever): string[] {
  const names: string[] = [];
  for (const path of lever.paths) {
    const match = /^steps\[(\d+)\]/.exec(path);
    const name = match ? template.profile.steps[Number(match[1])]?.name : undefined;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * One line for a lever change, e.g.
 * "Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)",
 * "Yield: 36 g -> 38 g (the shot stops at 38 g)", "Bloom time: 30 s -> 35 s".
 */
export function describeLeverChange(template: Template, leverId: string, from: number, to: number): string {
  const lever = findLever(template, leverId);
  const head = `${lever.label}: ${formatLeverValue(lever, from)} ${ARROW} ${formatLeverValue(lever, to)}`;
  if (lever.mode === 'uniformShift') {
    return `${head} (every step ${signed(to - from, decimalsOf(lever.granularity))} ${lever.unit})`;
  }
  if (lever.workflowContextKey === 'targetYield') return `${head} (the shot stops at ${formatLeverValue(lever, to)})`;
  if (lever.paths.length > 1) return `${head} (${joinNames(stepNames(template, lever))})`;
  return head;
}

/** What the coach knows about the manual settings right now. */
export interface ManualSettings {
  doseG: number | null;
  grinderSetting: string | null;
}

type ManualInput = Pick<ProposeAdjustment, 'variable' | 'value' | 'grind'>;

const NO_SETTINGS: ManualSettings = { doseG: null, grinderSetting: null };

function steps(amount: number): string {
  return `${amount} ${amount === 1 ? 'step' : 'steps'}`;
}

/** "1 step finer", "finer", or "a little finer". */
function grindMove(grind: NonNullable<ProposeAdjustment['grind']>, whenUnsized = ''): string {
  return grind.amount !== null ? `${steps(grind.amount)} ${grind.direction}` : `${whenUnsized}${grind.direction}`;
}

function cleanSetting(setting: string | null): string | null {
  const text = setting?.trim() ?? '';
  return text === '' ? null : text;
}

/**
 * The diff line for a grind, dose or "none" proposal: "Grind 1 step finer
 * (now 14.5)", "Grind 2 steps coarser: 14.5 -> 16", "Dose 18.0 g -> 18.5 g",
 * "Keep everything as it is".
 */
export function describeManualChange(input: ManualInput, current: ManualSettings = NO_SETTINGS): string {
  if (input.variable === 'none') return 'Keep everything as it is';

  if (input.variable === 'dose') {
    if (input.value === null) throw new Error('A dose change needs a value.');
    const to = `${input.value.toFixed(1)} g`;
    return current.doseG === null ? `Dose ${to}` : `Dose ${current.doseG.toFixed(1)} g ${ARROW} ${to}`;
  }

  if (input.variable === 'grind') {
    const grind = input.grind;
    if (!grind) throw new Error('A grind change needs grind details.');
    const setting = cleanSetting(grind.setting);
    const now = cleanSetting(current.grinderSetting);
    if (grind.amount === null && setting === null) {
      return `Grind a little ${grind.direction}${now !== null ? ` (now ${now})` : ''}`;
    }
    const move = `Grind ${grindMove(grind)}`;
    if (setting !== null) return now !== null ? `${move}: ${now} ${ARROW} ${setting}` : `${move}, to ${setting}`;
    return now !== null ? `${move} (now ${now})` : move;
  }

  throw new Error('describeManualChange is for grind, dose and "none"; use describeLeverChange for profile levers.');
}

/** What the grind text knows about the user's grinder. */
export interface GrindTextOptions {
  /** The grinder linked from Decaid's library, when there is one. */
  grinder?: GrinderInfo | null;
  /** The new setting was worked out from, or checked against, Decaid's step or list; otherwise it is the coach's estimate. */
  fromDecaid?: boolean;
}

/**
 * What the user's hands must do before the next shot (empty for profile
 * changes and "none"). A grind step says where its numbers come from, as the
 * owner asked (D62): "Set the grinder to 14.5 before the next shot (Decaid
 * lists 0.5 steps for your Niche Zero)." A setting nobody checked is the
 * coach's estimate and says so. Without a new setting the user turns the
 * grinder and notes where it landed, since the next shot is read against it.
 */
export function describeManualSteps(input: ManualInput, options: GrindTextOptions = {}): string[] {
  if (input.variable === 'dose' && input.value !== null) {
    return [`Weigh ${input.value.toFixed(1)} g of coffee for the next shot.`];
  }
  if (input.variable === 'grind' && input.grind) {
    const setting = cleanSetting(input.grind.setting);
    const decaid = decaidStepNote(options.grinder);
    if (setting !== null) {
      const plain = `Set the grinder to ${setting} (${grindMove(input.grind)}) before the next shot.`;
      if (options.fromDecaid) return [decaid !== null ? `Set the grinder to ${setting} before the next shot (${decaid}).` : plain];
      // The model's own number: the dial may land elsewhere, and the next shot is read against where it does.
      const why = decaid === null ? "CafAI doesn't know your grinder's step size" : "CafAI couldn't check it against your grinder's steps";
      return [`${plain} That is the coach's estimate: ${why}, so note where the dial really lands in Settings.`];
    }
    const move = grindMove(input.grind, 'a little ');
    if (decaid !== null) return [`Turn the grinder ${move} before the next shot (${decaid}), then note the new setting in Settings > Grinder.`];
    return [
      `Turn the grinder ${move} before the next shot. CafAI doesn't know your grinder's step size, so note the new setting in Settings > Grinder.`,
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Generic profile diff (history, undo)
// ---------------------------------------------------------------------------

const one = (value: number) => value.toFixed(1);
const whole = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9;
  return a === b;
}

function describeExit(exit: StepExit | null): string {
  if (!exit) return 'none';
  return `${exit.type} ${exit.condition} ${one(exit.value)} ${exit.type === 'pressure' ? 'bar' : 'ml/s'}`;
}

function stepLines(index: number, before: ProfileStep, after: ProfileStep, skipTemperature: boolean): string[] {
  const at = `Step ${index + 1} (${before.name})`;
  const lines: string[] = [];
  const change = (what: string, from: string, to: string) => lines.push(`${at} ${what}: ${from} ${ARROW} ${to}`);

  if (before.name !== after.name) change('name', `"${before.name}"`, `"${after.name}"`);
  for (const key of ['pump', 'transition', 'sensor'] as const) {
    if (before[key] !== after[key]) change(key, before[key], after[key]);
  }
  if (!skipTemperature && !same(before.temperature, after.temperature)) {
    change('temperature', `${one(before.temperature)} °C`, `${one(after.temperature)} °C`);
  }
  for (const key of ['pressure', 'flow'] as const) {
    const a = before[key];
    const b = after[key];
    if (a === undefined && b === undefined) continue;
    if (!same(a, b)) {
      const unit = key === 'pressure' ? 'bar' : 'ml/s';
      change(key, a === undefined ? 'none' : `${one(a)} ${unit}`, b === undefined ? 'none' : `${one(b)} ${unit}`);
    }
  }
  if (!same(before.seconds, after.seconds)) change('time limit', `${whole(before.seconds)} s`, `${whole(after.seconds)} s`);
  if (!same(before.volume, after.volume)) change('volume limit', `${whole(before.volume)} ml`, `${whole(after.volume)} ml`);
  if (!same(before.weight, after.weight)) {
    const show = (w: number | null) => (w === null ? 'off' : `${whole(w)} g`);
    change('weight exit', show(before.weight), show(after.weight));
  }

  const ea = before.exit;
  const eb = after.exit;
  if (ea && eb && ea.type === eb.type && ea.condition === eb.condition) {
    if (!same(ea.value, eb.value)) {
      const unit = ea.type === 'pressure' ? 'bar' : 'ml/s';
      change(`exit when ${ea.type} ${ea.condition}`, `${one(ea.value)} ${unit}`, `${one(eb.value)} ${unit}`);
    }
  } else if (describeExit(ea) !== describeExit(eb)) {
    change('exit', describeExit(ea), describeExit(eb));
  }

  const la = before.limiter;
  const lb = after.limiter;
  // On a flow step the limiter caps pressure; on a pressure step it caps flow.
  const limitName = after.pump === 'flow' ? 'pressure limit' : 'flow limit';
  const limitUnit = after.pump === 'flow' ? 'bar' : 'ml/s';
  if (la && lb) {
    if (!same(la.value, lb.value)) change(limitName, `${one(la.value)} ${limitUnit}`, `${one(lb.value)} ${limitUnit}`);
    if (!same(la.range, lb.range)) change('limiter range', one(la.range), one(lb.range));
  } else if (la || lb) {
    const show = (l: typeof la) => (l ? `${one(l.value)} ${limitUnit}` : 'none');
    change(limitName, show(la), show(lb));
  }
  return lines;
}

/**
 * Every execution difference between two profiles, one plain line each.
 * Title, notes and author are not execution content and are ignored. A
 * temperature shift shared by every step collapses into one line.
 */
export function diffProfiles(before: ProfileJson, after: ProfileJson): string[] {
  const lines: string[] = [];
  const top = (label: string, from: string, to: string) => lines.push(`${label}: ${from} ${ARROW} ${to}`);
  const grams = (v: number | null) => (v === null ? 'none' : `${whole(v)} g`);
  const ml = (v: number | null) => (v === null ? 'none' : `${whole(v)} ml`);

  if (before.version !== after.version) top('Version', before.version, after.version);
  if (before.beverage_type !== after.beverage_type) top('Beverage type', before.beverage_type, after.beverage_type);
  if (!same(before.target_weight, after.target_weight)) {
    top('Yield (target weight)', grams(before.target_weight), grams(after.target_weight));
  }
  if (!same(before.target_volume, after.target_volume)) top('Target volume', ml(before.target_volume), ml(after.target_volume));
  if (before.target_volume_count_start !== after.target_volume_count_start) {
    top('Preinfusion steps', String(before.target_volume_count_start), String(after.target_volume_count_start));
  }
  if (!same(before.tank_temperature, after.tank_temperature)) {
    top('Tank temperature', `${one(before.tank_temperature)} °C`, `${one(after.tank_temperature)} °C`);
  }
  if (before.steps.length !== after.steps.length) top('Steps', String(before.steps.length), String(after.steps.length));

  const shared = Math.min(before.steps.length, after.steps.length);
  const deltas = before.steps.slice(0, shared).map((step, i) => after.steps[i]!.temperature - step.temperature);
  const first = deltas[0] ?? 0;
  const uniform = shared > 1 && Math.abs(first) > 1e-9 && deltas.every((d) => Math.abs(d - first) <= 1e-9);
  if (uniform) lines.push(`All step temperatures ${signed(first, 1)} °C`);

  for (let i = 0; i < shared; i++) lines.push(...stepLines(i, before.steps[i]!, after.steps[i]!, uniform));
  return lines;
}

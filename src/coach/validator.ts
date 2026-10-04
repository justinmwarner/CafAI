// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/proposal.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: plausibility filter replaced by a bounded one-variable validator.

/**
 * The bridge from what the model proposed to what the Confirm button applies.
 *
 * Crema dropped implausible values quietly. CafAI never does: anything out of
 * bounds is an error sentence addressed to the model (returned as an is_error
 * tool result so it can retry), never a quiet fix. The one adjustment made is
 * snapping to a lever's granularity, which is reported in `notes` and in the
 * plan's `to` value.
 *
 * One variable per iteration: a template lever (a new profile version), the
 * grind or the dose (manual steps, no new version), or `none` to lock in a
 * good shot.
 */
import type { AdjustmentVariable, ProposeAdjustment, ProposeTemplates } from './contract.ts';
import { describeLeverChange, describeManualChange, describeManualSteps, formatLeverValue } from './diff.ts';
import {
  applyLever,
  ceilToGrid,
  decimalsOf,
  effectiveBounds,
  findLever,
  floorToGrid,
  LeverError,
  leverSlots,
  readLeverValue,
  readPath,
  snapToGranularity,
} from './levers.ts';
import { TEMPLATES } from './templates/index.ts';
import type { Lever, ProfileJson, ProfileStep, Template } from './types.ts';

export interface ValidationContext {
  template: Template;
  /** The profile on the machine now (the active version). */
  profile: ProfileJson;
  /** Current dose in grams, when known. */
  doseG: number | null;
  scaleConnected: boolean;
  /** Current grinder setting as written on the grinder, when known. */
  grinderSetting: string | null;
}

/** Workflow context fields to write together with the change. */
export interface ContextPatch {
  targetYield?: number;
  targetDoseWeight?: number;
  /** Set when the model gave an absolute grinder setting. */
  grinderSetting?: string;
}

/** A validated change, ready for the confirm card and for applying. */
export interface ChangePlan {
  variable: AdjustmentVariable;
  leverId: string | null;
  /** "Brew temperature", "Grind", "Dose", "No change". */
  label: string;
  /** Lever unit, "g" for dose, "" for grind and none. */
  unit: string;
  from: number | null;
  to: number | null;
  /** The complete next profile (profile changes only). */
  newProfile: ProfileJson | null;
  contextPatch: ContextPatch;
  /** Plain-language before -> after lines for the confirm card. */
  diffLines: string[];
  /** Instructions for the user's hands (grind, dose). */
  manualSteps: string[];
  /** The model's one-line summary. */
  summary: string;
  /** True when confirming uploads a new profile version. */
  createsVersion: boolean;
  /** Adjustments the validator made, e.g. rounding to the lever's step. */
  notes: string[];
}

export type Validation = { ok: true; plan: ChangePlan } | { ok: false; errors: string[] };

/** Manual dose rules: sane grams, and small steps so the shot stays comparable. */
export const DOSE_RULES = { min: 12, max: 25, maxDelta: 1, granularity: 0.1 } as const;

/** Largest grind move per iteration, in steps of the grinder's own dial. */
export const GRIND_MAX_STEPS = 5;

const SLACK = 1e-9;

const fail = (errors: string[]): Validation => ({ ok: false, errors });

function trimNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** "a 16.0 g dose", "an 18.0 g dose". */
function doseWords(doseG: number): string {
  const whole = Math.floor(doseG);
  const an = String(whole).startsWith('8') || whole === 11 || whole === 18;
  return `${an ? 'an' : 'a'} ${doseG.toFixed(1)} g dose`;
}

// ---------------------------------------------------------------------------
// Allowed range
// ---------------------------------------------------------------------------

function otherLeverValue(template: Template, profile: ProfileJson, leverId: string): { lever: Lever; value: number } {
  return { lever: findLever(template, leverId), value: readLeverValue(template, profile, leverId) };
}

/**
 * Where the lever may go from `from` in one step: inside the dose-aware
 * bounds, within maxDelta, and respecting cross-lever gaps. When a dose change
 * left the current value outside the dose bounds, any step back toward them is
 * allowed, so the lever is never stuck.
 */
function allowedRange(
  template: Template,
  lever: Lever,
  profile: ProfileJson,
  from: number,
  bounds: { min: number; max: number },
): { lo: number; hi: number } {
  let lo = Math.max(bounds.min, from - lever.maxDelta);
  let hi = Math.min(bounds.max, from + lever.maxDelta);
  if (from > bounds.max) hi = from - lever.granularity;
  if (from < bounds.min) lo = from + lever.granularity;

  for (const constraint of template.constraints) {
    if (constraint.higher === lever.id) {
      lo = Math.max(lo, otherLeverValue(template, profile, constraint.lower).value + constraint.minGap);
    }
    if (constraint.lower === lever.id) {
      hi = Math.min(hi, otherLeverValue(template, profile, constraint.higher).value - constraint.minGap);
    }
  }
  lo = Math.max(lo, lever.min);
  hi = Math.min(hi, lever.max);
  return { lo: ceilToGrid(lo, lever.granularity), hi: floorToGrid(hi, lever.granularity) };
}

function rangeSentence(lever: Lever, range: { lo: number; hi: number }): string {
  const decimals = decimalsOf(lever.granularity);
  if (range.lo > range.hi + SLACK) return ' This lever cannot move right now; choose another variable.';
  return ` Allowed range now: ${range.lo.toFixed(decimals)}-${range.hi.toFixed(decimals)} ${lever.unit} (at most ${formatLeverValue(lever, lever.maxDelta)} per step).`;
}

// ---------------------------------------------------------------------------
// One variable at a time
// ---------------------------------------------------------------------------

function validateProfileChange(input: ProposeAdjustment, ctx: ValidationContext): Validation {
  const { template } = ctx;
  const leverIds = template.levers.map((lever) => lever.id).join(', ');
  const errors: string[] = [];
  if (input.lever === null || input.lever.trim() === '') {
    errors.push(`variable "profile" needs "lever" (one of: ${leverIds}) and "value", the new absolute value.`);
  } else if (input.value === null) {
    errors.push(`variable "profile" needs "value", the new absolute value for lever "${input.lever}".`);
  }
  if (input.grind !== null) errors.push('"grind" must be null when variable is "profile": change one variable at a time.');
  if (errors.length > 0) return fail(errors);

  let lever: Lever;
  let from: number;
  try {
    lever = findLever(template, input.lever!.trim());
    from = readLeverValue(template, ctx.profile, lever.id);
  } catch (error) {
    if (error instanceof LeverError) return fail([error.message]);
    throw error;
  }
  const value = input.value!;
  if (!Number.isFinite(value)) return fail([`${lever.id}: the value must be a finite number.`]);

  if (lever.requiresScale && !ctx.scaleConnected) {
    return fail([
      `${lever.id}: needs a connected scale. ${lever.label} is counted in grams in the cup, which only a scale can measure; without one the shot stops on time instead, so the change would do nothing. Choose another lever, or ask the user to connect a scale.`,
    ]);
  }

  const notes: string[] = [];
  const to = snapToGranularity(value, lever.granularity);
  if (Math.abs(to - value) > SLACK) {
    notes.push(
      `Rounded ${trimNumber(value)} to ${formatLeverValue(lever, to)}: ${lever.label.toLowerCase()} moves in steps of ${formatLeverValue(lever, lever.granularity)}.`,
    );
  }

  const bounds = effectiveBounds(lever, ctx.doseG);
  const tail = rangeSentence(lever, allowedRange(template, lever, ctx.profile, from, bounds));
  const v = (n: number) => formatLeverValue(lever, n);
  const id = lever.id;

  if (to > lever.max + SLACK) return fail([`${id}: ${v(to)} is above this template's maximum of ${v(lever.max)}.${tail}`]);
  if (to < lever.min - SLACK) return fail([`${id}: ${v(to)} is below this template's minimum of ${v(lever.min)}.${tail}`]);
  if (lever.doseRatio && ctx.doseG !== null) {
    const ratio = lever.doseRatio;
    if (to > bounds.max + SLACK && !(from > bounds.max && to < from)) {
      return fail([
        `${id}: ${v(to)} is above the maximum for ${doseWords(ctx.doseG)} (${v(bounds.max)}, 1:${ratio.max.toFixed(1)}).${tail}`,
      ]);
    }
    if (to < bounds.min - SLACK && !(from < bounds.min && to > from)) {
      return fail([
        `${id}: ${v(to)} is below the minimum for ${doseWords(ctx.doseG)} (${v(bounds.min)}, 1:${ratio.min.toFixed(1)}).${tail}`,
      ]);
    }
  }
  const change = Math.abs(to - from);
  if (change > lever.maxDelta + SLACK) {
    return fail([`${id}: ${v(to)} is a change of ${v(change)} from ${v(from)}; at most ${v(lever.maxDelta)} per step.${tail}`]);
  }
  if (change <= SLACK) {
    return fail([
      `${id}: ${v(to)} is already the current value. Propose a different value, or use variable "none" to keep everything as it is.`,
    ]);
  }

  for (const constraint of template.constraints) {
    if (constraint.higher === id) {
      const other = otherLeverValue(template, ctx.profile, constraint.lower);
      if (to - other.value < constraint.minGap - SLACK) {
        return fail([
          `${id}: ${v(to)} leaves only ${v(Math.max(0, to - other.value))} above ${other.lever.label} (${v(other.value)}). ${constraint.message}${tail}`,
        ]);
      }
    }
    if (constraint.lower === id) {
      const other = otherLeverValue(template, ctx.profile, constraint.higher);
      if (other.value - to < constraint.minGap - SLACK) {
        return fail([
          `${id}: ${v(to)} leaves ${other.lever.label} (${v(other.value)}) only ${v(Math.max(0, other.value - to))} above it. ${constraint.message}${tail}`,
        ]);
      }
    }
  }

  const newProfile = applyLever(template, ctx.profile, id, to);
  const structure = checkStructure(template, ctx.profile, newProfile);
  if (structure.length > 0) return fail(structure);

  return {
    ok: true,
    plan: {
      variable: 'profile',
      leverId: id,
      label: lever.label,
      unit: lever.unit,
      from,
      to,
      newProfile,
      contextPatch: lever.workflowContextKey === 'targetYield' ? { targetYield: to } : {},
      diffLines: [describeLeverChange(template, id, from, to)],
      manualSteps: [],
      summary: input.summary.trim(),
      createsVersion: true,
      notes,
    },
  };
}

function validateGrind(input: ProposeAdjustment, ctx: ValidationContext): Validation {
  const errors: string[] = [];
  if (input.grind === null) errors.push('variable "grind" needs "grind": {direction, amount, setting}.');
  if (input.lever !== null) errors.push('"lever" must be null when variable is "grind": change one variable at a time.');
  if (input.value !== null) {
    errors.push('"value" must be null when variable is "grind"; put the move in grind.amount (dial steps) or grind.setting.');
  }
  const grind = input.grind;
  if (grind && grind.direction !== 'finer' && grind.direction !== 'coarser') {
    errors.push('grind.direction must be "finer" or "coarser".');
  }
  if (grind && grind.amount !== null && !(Number.isFinite(grind.amount) && grind.amount > 0 && grind.amount <= GRIND_MAX_STEPS)) {
    errors.push(
      `grind.amount must be more than 0 and at most ${GRIND_MAX_STEPS} dial steps (got ${String(grind.amount)}). For a bigger move, split it over two shots.`,
    );
  }
  if (errors.length > 0 || !grind) return fail(errors);

  // The setting is passed through exactly as written: it is the grinder's own
  // dial, which no typed range can second-guess. Only a "new" setting equal
  // to the current one is refused: it would be a move that changes nothing.
  const setting = grind.setting?.trim() ? grind.setting.trim() : null;
  const current = ctx.grinderSetting?.trim() ? ctx.grinderSetting.trim() : null;
  if (setting !== null && current !== null && setting === current) {
    return fail([
      `grind.setting "${setting}" is the setting the grinder is on now. Give the new setting after the move (${grind.direction}), or null if you do not know it.`,
    ]);
  }
  const normalized: ProposeAdjustment = { ...input, grind: { ...grind, setting } };
  return {
    ok: true,
    plan: {
      variable: 'grind',
      leverId: null,
      label: 'Grind',
      unit: '',
      from: null,
      to: null,
      newProfile: null,
      contextPatch: setting !== null ? { grinderSetting: setting } : {},
      diffLines: [describeManualChange(normalized, { doseG: ctx.doseG, grinderSetting: ctx.grinderSetting })],
      manualSteps: describeManualSteps(normalized),
      summary: input.summary.trim(),
      createsVersion: false,
      notes: [],
    },
  };
}

function validateDose(input: ProposeAdjustment, ctx: ValidationContext): Validation {
  const errors: string[] = [];
  if (input.value === null) errors.push('variable "dose" needs "value", the new dose in grams.');
  if (input.lever !== null) errors.push('"lever" must be null when variable is "dose": change one variable at a time.');
  if (input.grind !== null) errors.push('"grind" must be null when variable is "dose": change one variable at a time.');
  if (errors.length > 0) return fail(errors);
  const value = input.value!;
  if (!Number.isFinite(value)) return fail(['dose: the value must be a finite number of grams.']);

  const notes: string[] = [];
  const to = snapToGranularity(value, DOSE_RULES.granularity);
  if (Math.abs(to - value) > SLACK) notes.push(`Rounded ${trimNumber(value)} to ${to.toFixed(1)} g: doses move in 0.1 g steps.`);

  const from = ctx.doseG;
  const lo = from === null ? DOSE_RULES.min : Math.max(DOSE_RULES.min, from - DOSE_RULES.maxDelta);
  const hi = from === null ? DOSE_RULES.max : Math.min(DOSE_RULES.max, from + DOSE_RULES.maxDelta);
  const g = (n: number) => `${n.toFixed(1)} g`;
  const tail = ` Allowed range now: ${lo.toFixed(1)}-${hi.toFixed(1)} g (at most ${g(DOSE_RULES.maxDelta)} per step).`;

  if (to > DOSE_RULES.max + SLACK) return fail([`dose: ${g(to)} is above the ${g(DOSE_RULES.max)} maximum.${tail}`]);
  if (to < DOSE_RULES.min - SLACK) return fail([`dose: ${g(to)} is below the ${g(DOSE_RULES.min)} minimum.${tail}`]);
  if (from !== null) {
    const change = Math.abs(to - from);
    if (change > DOSE_RULES.maxDelta + SLACK) {
      return fail([`dose: ${g(to)} is a change of ${g(change)} from ${g(from)}; at most ${g(DOSE_RULES.maxDelta)} per step.${tail}`]);
    }
    if (change <= SLACK) {
      return fail([
        `dose: ${g(to)} is already the current dose. Propose a different value, or use variable "none" to keep everything as it is.`,
      ]);
    }
  }

  const normalized: ProposeAdjustment = { ...input, value: to };
  return {
    ok: true,
    plan: {
      variable: 'dose',
      leverId: null,
      label: 'Dose',
      unit: 'g',
      from,
      to,
      newProfile: null,
      contextPatch: { targetDoseWeight: to },
      diffLines: [describeManualChange(normalized, { doseG: from, grinderSetting: ctx.grinderSetting })],
      manualSteps: describeManualSteps(normalized),
      summary: input.summary.trim(),
      createsVersion: false,
      notes,
    },
  };
}

function validateNone(input: ProposeAdjustment): Validation {
  if (input.lever !== null || input.value !== null || input.grind !== null) {
    return fail(['variable "none" keeps everything as it is, so "lever", "value" and "grind" must be null.']);
  }
  return {
    ok: true,
    plan: {
      variable: 'none',
      leverId: null,
      label: 'No change',
      unit: '',
      from: null,
      to: null,
      newProfile: null,
      contextPatch: {},
      diffLines: [],
      manualSteps: [],
      summary: input.summary.trim(),
      createsVersion: false,
      notes: [],
    },
  };
}

/**
 * Check a propose_adjustment input (already schema-valid) against the active
 * template, the profile on the machine and the current dose. Returns the plan
 * to show and apply, or error sentences for the model.
 */
export function validateProposal(input: ProposeAdjustment, ctx: ValidationContext): Validation {
  switch (input.variable) {
    case 'profile':
      return validateProfileChange(input, ctx);
    case 'grind':
      return validateGrind(input, ctx);
    case 'dose':
      return validateDose(input, ctx);
    case 'none':
      return validateNone(input);
    default:
      return fail([`Unknown variable "${String(input.variable)}". Use "profile", "grind", "dose" or "none".`]);
  }
}

/** Check propose_templates suggestions: known template ids, each at most once. */
export function validateTemplateSuggestions(input: ProposeTemplates): { ok: boolean; errors: string[] } {
  const known = TEMPLATES.map((template) => template.id);
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const suggestion of input.suggestions) {
    if (!known.includes(suggestion.templateId)) {
      errors.push(`Unknown template id "${suggestion.templateId}". Use one of: ${known.join(', ')}.`);
    } else if (seen.has(suggestion.templateId)) {
      errors.push(`Template "${suggestion.templateId}" appears more than once; suggest each template at most once.`);
    }
    seen.add(suggestion.templateId);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Structural invariants and CafAI's hard bounds
// ---------------------------------------------------------------------------

const plain = (n: number | null) => (n === null ? 'null' : String(n));

function describeExit(step: ProfileStep): string {
  return step.exit ? `${step.exit.type} ${step.exit.condition} ${step.exit.value}` : 'none';
}

/** Differences from the template that no lever can make. */
function structureIssues(template: Template, profile: ProfileJson): string[] {
  const reference = template.profile;
  const issues: string[] = [];

  if (profile.version !== reference.version) issues.push(`version must stay "${reference.version}" (got "${profile.version}").`);
  if (profile.beverage_type !== reference.beverage_type) {
    issues.push(`beverage_type must stay "${reference.beverage_type}" (got "${profile.beverage_type}").`);
  }
  if (profile.steps.length !== reference.steps.length) {
    issues.push(`The profile must keep the template's ${reference.steps.length} steps (it has ${profile.steps.length}).`);
  }

  const leverOwned = new Set(template.levers.flatMap((lever) => leverSlots(reference, lever)));
  const fixedNumber = (where: string, expected: number | null, actual: number | null | undefined) => {
    if (leverOwned.has(where)) return;
    const a = actual ?? null;
    const same = expected === null || a === null ? expected === a : Math.abs(expected - a) <= SLACK;
    if (!same) issues.push(`${where} changed from ${plain(expected)} to ${plain(a)}, but it is fixed in this template.`);
  };

  fixedNumber('target_weight', reference.target_weight, profile.target_weight);
  fixedNumber('target_volume', reference.target_volume, profile.target_volume);
  fixedNumber('target_volume_count_start', reference.target_volume_count_start, profile.target_volume_count_start);
  fixedNumber('tank_temperature', reference.tank_temperature, profile.tank_temperature);

  const shared = Math.min(profile.steps.length, reference.steps.length);
  for (let i = 0; i < shared; i++) {
    const want = reference.steps[i]!;
    const got = profile.steps[i]!;
    const at = `steps[${i}]`;
    if (got.name !== want.name) issues.push(`${at}.name must stay "${want.name}" (got "${got.name}"); step names are part of the profile id.`);
    for (const key of ['pump', 'transition', 'sensor'] as const) {
      if (got[key] !== want[key]) issues.push(`${at}.${key} must stay "${want[key]}" (got "${got[key]}").`);
    }

    if (want.exit && !got.exit) issues.push(`${at} must keep its exit (${describeExit(want)}).`);
    if (!want.exit && got.exit) issues.push(`${at} must not gain an exit (got ${describeExit(got)}).`);
    if (want.exit && got.exit) {
      if (got.exit.type !== want.exit.type) issues.push(`${at} exit type must stay "${want.exit.type}" (got "${got.exit.type}").`);
      if (got.exit.condition !== want.exit.condition) {
        issues.push(`${at} exit condition must stay "${want.exit.condition}" (got "${got.exit.condition}").`);
      }
      fixedNumber(`${at}.exit.value`, want.exit.value, got.exit.value);
    }

    if (want.limiter && !got.limiter) issues.push(`${at} must keep its limiter.`);
    if (!want.limiter && got.limiter) issues.push(`${at} must not gain a limiter.`);
    if (want.limiter && got.limiter) {
      if (Math.abs(got.limiter.range - want.limiter.range) > SLACK) {
        issues.push(`${at} limiter range must stay ${want.limiter.range} (got ${got.limiter.range}).`);
      }
      fixedNumber(`${at}.limiter.value`, want.limiter.value, got.limiter.value);
    }

    if ((want.weight === null) !== (got.weight === null)) {
      issues.push(`${at}.weight must stay ${want.weight === null ? 'null' : 'a number'} (0 and null are different profiles).`);
    } else {
      fixedNumber(`${at}.weight`, want.weight, got.weight);
    }
    fixedNumber(`${at}.temperature`, want.temperature, got.temperature);
    fixedNumber(`${at}.seconds`, want.seconds, got.seconds);
    fixedNumber(`${at}.volume`, want.volume, got.volume);
    if (got.pump === want.pump) fixedNumber(`${at}.${want.pump}`, want[want.pump] ?? null, got[want.pump]);
  }

  // A uniform shift keeps the template's shape: every slot moved by one delta.
  for (const lever of template.levers) {
    if (lever.mode !== 'uniformShift' || issues.length > 0) continue;
    const deltas = lever.paths.flatMap((path) => {
      const after = readPath(profile, path);
      return readPath(reference, path).map((value, k) => (after[k] ?? Number.NaN) - value);
    });
    const first = deltas[0] ?? 0;
    if (deltas.some((d) => !(Math.abs(d - first) <= SLACK))) {
      issues.push(`${lever.label} must move every step by the same amount, keeping the template's shape.`);
    }
  }
  return issues;
}

interface Bound {
  min: number;
  max: number;
  unit: string;
}

const one = (n: number) => n.toFixed(1);
const whole = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function outside(where: string, value: number, bound: Bound, digits: (n: number) => string): string | null {
  if (value >= bound.min - SLACK && value <= bound.max + SLACK) return null;
  return `${where}: ${digits(value)} ${bound.unit} is outside CafAI's hard bounds (${digits(bound.min)}-${digits(bound.max)} ${bound.unit}).`;
}

/**
 * The yield ceiling: 120 g, or the template's own target_weight when Decent
 * ships more (Rao Allongé stops at 135 g, and its own default must pass).
 * target_weight never reaches the machine (it is hashed; stop-at-weight reads
 * context.targetYield), so this cannot wrap a wire value, and the other
 * templates ship 36-60 g, so their ceiling stays 120 g.
 */
function maxTargetWeight(reference: ProfileJson): number {
  return Math.max(120, reference.target_weight ?? 0);
}

/**
 * CafAI's hard bounds (docs/verified/03-profiles.md section 5.2); lever bounds
 * are narrower. `reference` is the template's bundled profile.
 */
function hardBoundIssues(reference: ProfileJson, profile: ProfileJson): string[] {
  const issues: string[] = [];
  const push = (issue: string | null) => {
    if (issue) issues.push(issue);
  };
  if (profile.steps.length < 1 || profile.steps.length > 20) issues.push('A profile needs 1 to 20 steps.');
  if (profile.target_volume_count_start < 0 || profile.target_volume_count_start > profile.steps.length) {
    issues.push('target_volume_count_start must be between 0 and the number of steps.');
  }
  if (profile.target_weight !== null) {
    const bound: Bound = { min: 15, max: maxTargetWeight(reference), unit: 'g' };
    push(outside('target_weight', profile.target_weight, bound, whole));
  }

  profile.steps.forEach((step, i) => {
    const at = `steps[${i}]`;
    push(outside(`${at}.temperature`, step.temperature, { min: 80, max: 100, unit: '°C' }, one));
    if (Math.abs(step.temperature * 2 - Math.round(step.temperature * 2)) > 1e-6) {
      issues.push(`${at}.temperature: ${step.temperature} °C is not a multiple of 0.5 °C.`);
    }
    if (step.pump === 'pressure' && step.pressure !== undefined) {
      push(outside(`${at}.pressure`, step.pressure, { min: 0, max: 11, unit: 'bar' }, one));
    }
    if (step.pump === 'flow' && step.flow !== undefined) push(outside(`${at}.flow`, step.flow, { min: 0, max: 8, unit: 'ml/s' }, one));
    if (step.exit) {
      const bound: Bound = step.exit.type === 'pressure' ? { min: 0, max: 10, unit: 'bar' } : { min: 0, max: 6, unit: 'ml/s' };
      push(outside(`${at}.exit.value`, step.exit.value, bound, one));
    }
    if (step.limiter) {
      // A pressure step's limiter caps flow; a flow step's limiter caps pressure.
      const bound: Bound = step.pump === 'pressure' ? { min: 0, max: 8, unit: 'ml/s' } : { min: 0, max: 11, unit: 'bar' };
      push(outside(`${at}.limiter.value`, step.limiter.value, bound, one));
    }
    push(outside(`${at}.seconds`, step.seconds, { min: 0, max: 127, unit: 's' }, whole));
    push(outside(`${at}.volume`, step.volume, { min: 0, max: 1023, unit: 'ml' }, whole));
    if (step.weight !== null && step.weight !== 0 && !(step.weight >= 1 - SLACK && step.weight <= 20 + SLACK)) {
      issues.push(`${at}.weight: ${whole(step.weight)} g is outside CafAI's hard bounds (0, or 1-20 g).`);
    }
  });
  return issues;
}

/**
 * Structural invariants of a change: same steps (count, order, names, pumps,
 * sensors, transitions), same exits (presence, type, condition), same
 * limiters (presence, range), every number no lever owns unchanged (volumes,
 * target_volume, target_volume_count_start, tank_temperature, fixed times and
 * exits), same beverage_type and version, and every number inside CafAI's hard
 * bounds. Returns error sentences; empty means the change is structurally sound.
 */
export function checkStructure(template: Template, before: ProfileJson, after: ProfileJson): string[] {
  const errors: string[] = [];
  const current = structureIssues(template, before);
  if (current.length > 0) {
    errors.push(`The current profile does not match the ${template.name} template: ${current.join(' ')}`);
  }
  errors.push(...structureIssues(template, after), ...hardBoundIssues(template.profile, after));
  return errors;
}

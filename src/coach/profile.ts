// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/domain/profile.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: added Decaid-exact normalizeProfile; Crema's types renamed Loose*.

/**
 * Profiles: Decaid's exact parse, plus Crema's lenient reader and plan helpers.
 *
 * `normalizeProfile` / `parseDecaidProfile` reproduce Decaid's
 * `Profile.fromJson` followed by `toJson` (lib/src/models/data/profile.dart and
 * utils.dart at a45961b, GPL-3.0-or-later, Copyright (C) 2025-2026 Decent
 * Espresso). The result is what Decaid stores and hashes, so the profile id
 * computed from it is the id Decaid assigns. Any input Decaid would refuse
 * throws a ProfileError naming the field.
 *
 * Crema's `readProfileStep` / `readExit` are the opposite: they never throw and
 * fall back on defaults. They are for showing or analysing a profile from
 * anywhere, never for building one to upload.
 */
import type {
  BeverageType,
  ExitCondition,
  ExitType,
  ProfileJson,
  ProfileStep,
  PumpMode,
  StepExit,
  StepLimiter,
  StepSensor,
  Transition,
} from './types.ts';

/** A profile Decaid refuses (or CafAI cannot represent). The message names the field. */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

/** A profile exactly as Decaid's toJson emits it. `version` may be null on odd records. */
export type DecaidProfile = Omit<ProfileJson, 'version'> & { version: string | null };

// ---------------------------------------------------------------------------
// Decaid's lenient number and string parsing (utils.dart)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Dart double.parse: optional sign, then Infinity, NaN or a decimal literal
// with an optional exponent; surrounding whitespace is ignored.
const DART_DOUBLE = /^[+-]?(?:NaN|Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
// Dart int.parse without a radix: decimal digits or a 0x hex literal.
const DART_INT = /^[+-]?(?:\d+|0[xX][0-9a-fA-F]+)$/;

function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'a list';
  if (value !== null && typeof value === 'object') return 'an object';
  return String(value);
}

function parseIntString(text: string): number | null {
  const s = text.trim();
  if (!DART_INT.test(s)) return null;
  const negative = s.startsWith('-');
  const magnitude = Number(s.replace(/^[+-]/, ''));
  return negative ? -magnitude : magnitude;
}

/** double.tryParse(s) ?? int.tryParse(s), as Decaid reads a numeric string. */
function parseNumberString(text: string): number | null {
  const s = text.trim();
  if (DART_DOUBLE.test(s)) return Number(s);
  return parseIntString(s);
}

function finite(value: number, field: string): number {
  // Dart would store NaN or Infinity, but jsonEncode (and so the id hash and
  // every GET) fails on them, so they are refused here.
  if (!Number.isFinite(value)) throw new ProfileError(`${field} must be a finite number (got ${describeValue(value)}).`);
  return value;
}

/** parseDouble: required. */
function parseDouble(value: unknown, field: string): number {
  if (typeof value === 'number') return finite(value, field);
  if (typeof value === 'string') {
    const parsed = parseNumberString(value);
    if (parsed === null) throw new ProfileError(`${field} must be a number (got ${describeValue(value)}).`);
    return finite(parsed, field);
  }
  if (value === null || value === undefined) throw new ProfileError(`${field} is missing.`);
  throw new ProfileError(`${field} must be a number (got ${describeValue(value)}).`);
}

/** parseOptionalDouble: null stays null, and so does a string Dart cannot read. */
function parseOptionalDouble(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return finite(value, field);
  if (typeof value === 'string') {
    const parsed = parseNumberString(value);
    return parsed === null ? null : finite(parsed, field);
  }
  throw new ProfileError(`${field} must be a number or null (got ${describeValue(value)}).`);
}

/** parseInt: an int, a double (truncated), or an integer string ("2.0" fails). */
function parseIntValue(value: unknown, field: string): number {
  if (typeof value === 'number') return Math.trunc(finite(value, field));
  if (typeof value === 'string') {
    const parsed = parseIntString(value);
    if (parsed === null) throw new ProfileError(`${field} must be a whole number (got ${describeValue(value)}).`);
    return parsed;
  }
  if (value === null || value === undefined) throw new ProfileError(`${field} is missing.`);
  throw new ProfileError(`${field} must be a whole number (got ${describeValue(value)}).`);
}

/**
 * parseOptionalString: strings pass, numbers and booleans are converted, other
 * values are null. JavaScript cannot tell the JSON number 2 from 2.0, which
 * Dart would print as "2" and "2.0"; integral numbers are printed like ints.
 */
function parseOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Enum `byName`: an exact, case-sensitive name or an error. */
function byName<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  const options = allowed.map((a) => `"${a}"`).join(' or ');
  throw new ProfileError(`${field} must be ${options} (got ${describeValue(value)}).`);
}

const BEVERAGE_TYPES: readonly BeverageType[] = ['espresso', 'calibrate', 'cleaning', 'manual', 'pourover'];

/** Decaid matches case-insensitively and silently falls back to espresso. */
function parseBeverageType(value: unknown): BeverageType {
  if (value === null || value === undefined) return 'espresso';
  const name = String(value).toLowerCase();
  return (BEVERAGE_TYPES as readonly string[]).includes(name) ? (name as BeverageType) : 'espresso';
}

// ---------------------------------------------------------------------------
// Profile.fromJson -> toJson
// ---------------------------------------------------------------------------

function parseExit(raw: unknown, field: string): StepExit | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) throw new ProfileError(`${field} must be an object or null (got ${describeValue(raw)}).`);
  return {
    type: byName<ExitType>(raw['type'], ['pressure', 'flow'], `${field}.type`),
    condition: byName<ExitCondition>(raw['condition'], ['over', 'under'], `${field}.condition`),
    value: parseDouble(raw['value'], `${field}.value`),
  };
}

function parseLimiter(raw: unknown, field: string): StepLimiter | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) throw new ProfileError(`${field} must be an object or null (got ${describeValue(raw)}).`);
  return {
    value: parseDouble(raw['value'], `${field}.value`),
    range: parseDouble(raw['range'], `${field}.range`),
  };
}

function parseStep(raw: unknown, index: number): ProfileStep {
  const at = `steps[${index}]`;
  if (!isRecord(raw)) throw new ProfileError(`${at} must be an object (got ${describeValue(raw)}).`);

  const pump = raw['pump'];
  if (pump !== 'pressure' && pump !== 'flow') {
    throw new ProfileError(`${at}.pump must be "pressure" or "flow" (got ${describeValue(pump)}).`);
  }
  const name = raw['name'];
  if (typeof name !== 'string') throw new ProfileError(`${at}.name must be a string (got ${describeValue(name)}).`);

  // Field order follows Dart's constructor, so the first error is the one Decaid reports.
  const transition = byName<Transition>(raw['transition'], ['fast', 'smooth'], `${at}.transition`);
  const exit = parseExit(raw['exit'], `${at}.exit`);
  const volume = parseDouble(raw['volume'], `${at}.volume`);
  const seconds = parseDouble(raw['seconds'], `${at}.seconds`);
  const weight = parseOptionalDouble(raw['weight'], `${at}.weight`);
  const temperature = parseDouble(raw['temperature'], `${at}.temperature`);
  const sensor = byName<StepSensor>(raw['sensor'], ['coffee', 'water'], `${at}.sensor`);
  const limiter = parseLimiter(raw['limiter'], `${at}.limiter`);
  const target = parseDouble(raw[pump], `${at}.${pump}`);

  // toJson key order; only the active target is emitted.
  return pump === 'pressure'
    ? { name, pump, transition, exit, volume, seconds, weight, temperature, sensor, pressure: target, limiter }
    : { name, pump, transition, exit, volume, seconds, weight, temperature, sensor, flow: target, limiter };
}

/**
 * Parse any profile JSON exactly as Decaid's `Profile.fromJson` does and
 * return what its `toJson` would emit. Throws ProfileError where Decaid would
 * answer 400 or 500.
 */
export function parseDecaidProfile(raw: unknown): DecaidProfile {
  if (!isRecord(raw)) throw new ProfileError(`A profile must be a JSON object (got ${describeValue(raw)}).`);

  const title = parseOptionalString(raw['title']);
  const rawSteps = raw['steps'];
  if (title === null || title === '') throw new ProfileError('Profile must have a non-empty "title".');
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new ProfileError('Profile must have a non-empty "steps" array.');
  }
  if (raw['tank_temperature'] === null || raw['tank_temperature'] === undefined) {
    throw new ProfileError('Profile must have "tank_temperature".');
  }
  if (raw['target_volume_count_start'] === null || raw['target_volume_count_start'] === undefined) {
    throw new ProfileError('Profile must have "target_volume_count_start".');
  }

  return {
    version: parseOptionalString(raw['version']),
    title,
    notes: parseOptionalString(raw['notes']) ?? '',
    author: parseOptionalString(raw['author']) ?? '',
    beverage_type: parseBeverageType(raw['beverage_type']),
    steps: rawSteps.map((step, index) => parseStep(step, index)),
    target_volume: parseOptionalDouble(raw['target_volume'], 'target_volume'),
    target_weight: parseOptionalDouble(raw['target_weight'], 'target_weight'),
    target_volume_count_start: parseIntValue(raw['target_volume_count_start'], 'target_volume_count_start'),
    tank_temperature: parseDouble(raw['tank_temperature'], 'tank_temperature'),
  };
}

/**
 * The complete ten-key profile CafAI uploads, normalized the way Decaid would
 * store it: JSON numbers, `version` as a string, only the active pump target,
 * explicit null for absent exit/limiter/weight, unknown keys dropped. The
 * representation of `weight` (0 or null) is kept, because it is hashed.
 *
 * Decaid accepts a profile without `version`, but CafAI always sends one (it
 * is part of the id), so its absence is an error here.
 */
export function normalizeProfile(raw: unknown): ProfileJson {
  const parsed = parseDecaidProfile(raw);
  if (parsed.version === null) {
    throw new ProfileError('Profile has no "version". CafAI profiles carry version "2", which is part of the id.');
  }
  return { ...parsed, version: parsed.version };
}

// ---------------------------------------------------------------------------
// Crema: lenient reading, temperature, and the profile's plan
// ---------------------------------------------------------------------------

/** A step read leniently: numbers may be missing, enums fall back. */
export interface LooseProfileStep {
  name: string;
  pump: PumpMode;
  transition: Transition;
  exit: StepExit | null;
  volume: number | null;
  seconds: number | null;
  weight: number | null;
  temperature: number | null;
  sensor: StepSensor;
  /** Present when pump is "pressure". */
  pressure?: number | null;
  /** Present when pump is "flow". */
  flow?: number | null;
  limiter: StepLimiter | null;
}

/** A profile read leniently. A normalized ProfileJson is one too. */
export interface LooseProfile {
  version?: string | null;
  title?: string;
  author?: string;
  notes?: string;
  beverage_type?: string;
  steps?: LooseProfileStep[];
  target_volume?: number | null;
  target_weight?: number | null;
  target_volume_count_start?: number;
  tank_temperature?: number | null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(/[−–—]/g, '-'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

/**
 * Read an exit condition.
 *
 * Also accepts the Tcl skin's flat form, because a model that has seen a lot
 * of de1app profiles will sometimes emit it, and translating is cheaper than
 * throwing away an otherwise good profile.
 */
export function readExit(raw: unknown, flat?: Record<string, unknown>): StepExit | null {
  if (isRecord(raw)) {
    const value = num(raw['value']);
    if (value === null) return null;
    return {
      type: oneOf(raw['type'], ['pressure', 'flow'] as const, 'pressure'),
      condition: oneOf(raw['condition'], ['over', 'under'] as const, 'over'),
      value,
    };
  }

  if (flat) {
    const legacy: [string, ExitType, ExitCondition][] = [
      ['exit_pressure_over', 'pressure', 'over'],
      ['exit_pressure_under', 'pressure', 'under'],
      ['exit_flow_over', 'flow', 'over'],
      ['exit_flow_under', 'flow', 'under'],
    ];
    for (const [key, type, condition] of legacy) {
      const value = num(flat[key]);
      if (value !== null && value !== 0) return { type, condition, value };
    }
  }

  return null;
}

function readLimiter(raw: unknown): StepLimiter | null {
  if (!isRecord(raw)) return null;
  const value = num(raw['value']);
  const range = num(raw['range']);
  if (value === null || range === null) return null;
  return { value, range };
}

/**
 * Normalise a step from the gateway or from a model into the canonical shape.
 * Returns null for anything unusable, since a nameless step cannot be shown or
 * installed.
 */
export function readProfileStep(raw: unknown): LooseProfileStep | null {
  if (!isRecord(raw)) return null;

  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (name === '') return null;

  const pump = oneOf(raw['pump'], ['pressure', 'flow'] as const, 'pressure');

  const step: LooseProfileStep = {
    name,
    pump,
    transition: oneOf(raw['transition'], ['fast', 'smooth'] as const, 'fast'),
    exit: readExit(raw['exit'], raw),
    volume: num(raw['volume']),
    seconds: num(raw['seconds']),
    weight: num(raw['weight']),
    temperature: num(raw['temperature']),
    sensor: oneOf(raw['sensor'], ['coffee', 'water'] as const, 'coffee'),
    limiter: readLimiter(raw['limiter']),
  };

  // Only the driven variable is carried, so a flow step cannot smuggle in a
  // pressure target the machine would ignore.
  if (pump === 'pressure') step.pressure = num(raw['pressure']);
  else step.flow = num(raw['flow']);

  return step;
}

/** The hottest step, which is what a barista means by "brew temperature". */
export function profileTemperature(profile: LooseProfile | undefined): number | null {
  const temps = (profile?.steps ?? [])
    .map((step) => step.temperature)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));

  return temps.length === 0 ? null : Math.max(...temps);
}

/**
 * Shift every step by `deltaC`, preserving the profile's internal shape: a
 * bloom running 3° under extraction still runs 3° under. Returns a new
 * profile; the input is not mutated.
 */
export function shiftProfileTemperature(profile: LooseProfile, deltaC: number): LooseProfile {
  if (!Number.isFinite(deltaC) || deltaC === 0) return profile;

  return {
    ...profile,
    steps: (profile.steps ?? []).map((step) =>
      typeof step.temperature === 'number' && Number.isFinite(step.temperature)
        ? { ...step, temperature: Number((step.temperature + deltaC).toFixed(1)) }
        : step,
    ),
  };
}

/** One moment in a profile's plan. A step targets pressure or flow, never both. */
export interface PlanPoint {
  t: number;
  pressure: number | null;
  flow: number | null;
}

/** The target a step holds, and which axis it belongs on. */
function stepTarget(step: LooseProfileStep): { pressure: number | null; flow: number | null } {
  if (step.pump === 'flow') {
    return { pressure: null, flow: typeof step.flow === 'number' ? step.flow : 0 };
  }
  return { pressure: typeof step.pressure === 'number' ? step.pressure : 0, flow: null };
}

/**
 * The shape a profile intends to draw, before any coffee is involved.
 *
 * This is the profile's own plan — what the machine is told to do — not a
 * recording of what happened. A `fast` transition jumps to the step's target
 * at the step's start; a `smooth` one ramps to it from wherever the previous
 * step left off, which is exactly how the machine reads them. Each step is
 * drawn at its maximum duration; exits usually end it sooner.
 */
export function profilePlan(profile: LooseProfile): { points: PlanPoint[]; totalS: number } {
  const points: PlanPoint[] = [];
  let t = 0;
  let lastPressure = 0;
  let lastFlow = 0;

  for (const step of profile.steps ?? []) {
    const seconds = typeof step.seconds === 'number' && step.seconds > 0 ? step.seconds : 0;
    const target = stepTarget(step);

    const entryPressure = step.transition === 'smooth' ? lastPressure : (target.pressure ?? lastPressure);
    const entryFlow = step.transition === 'smooth' ? lastFlow : (target.flow ?? lastFlow);

    points.push({ t, pressure: entryPressure, flow: entryFlow });

    lastPressure = target.pressure ?? lastPressure;
    lastFlow = target.flow ?? lastFlow;
    t += seconds;
    points.push({ t, pressure: lastPressure, flow: lastFlow });
  }

  return { points, totalS: t };
}

/** A one-line description of the plan, for a row that has no room for a chart. */
export function describePlan(profile: LooseProfile): string {
  const steps = profile.steps ?? [];
  if (steps.length === 0) return 'no steps';

  const modes = new Set(steps.map((step) => step.pump));
  const shape = modes.size > 1 ? 'pressure and flow' : modes.has('flow') ? 'flow' : 'pressure';
  const { totalS } = profilePlan(profile);
  const seconds = totalS > 0 ? `${Math.round(totalS)}s` : 'open-ended';
  return `${steps.length} steps · ${shape} · ${seconds}`;
}

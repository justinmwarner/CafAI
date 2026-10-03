/**
 * Reading and writing template levers on a profile.
 *
 * A lever names one or more numeric paths in the profile ("target_weight",
 * "steps[2].seconds", "steps[*].temperature", "steps[1].exit.value"). Writes
 * go only to existing numeric fields, on a copy, so nothing outside the
 * lever's paths can change. Bounds are not checked here; the validator does
 * that before anything is applied.
 */
import { clone } from '../util/clone.ts';
import type { Lever, LeverValues, ProfileJson, Template } from './types.ts';

/** A lever or path that does not fit the profile or template. */
export class LeverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeverError';
  }
}

export interface PathSegment {
  key: string;
  /** Array index, '*' for every element, or null for a plain key. */
  index: number | '*' | null;
}

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+|\*)\])?$/;

/** Parse "steps[2].exit.value" into segments. */
export function parsePath(path: string): PathSegment[] {
  if (path === '') throw new LeverError('An empty lever path is not valid.');
  return path.split('.').map((part) => {
    const match = SEGMENT.exec(part);
    if (!match) throw new LeverError(`"${path}" is not a lever path (bad segment "${part}").`);
    const index = match[2];
    return { key: match[1]!, index: index === undefined ? null : index === '*' ? '*' : Number(index) };
  });
}

interface Slot {
  /** The object holding the number, and its key. */
  holder: Record<string, unknown>;
  key: string;
  /** Concrete path, e.g. "steps[3].flow", for messages. */
  where: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every numeric slot a path points at. Throws if any part is missing. */
function resolveSlots(root: unknown, path: string): Slot[] {
  const segments = parsePath(path);
  let frontier: Array<{ value: unknown; where: string }> = [{ value: root, where: '' }];
  const slots: Slot[] = [];

  segments.forEach((segment, i) => {
    const lastSegment = i === segments.length - 1;
    const next: Array<{ value: unknown; where: string }> = [];
    for (const { value, where } of frontier) {
      const here = where === '' ? segment.key : `${where}.${segment.key}`;
      if (!isRecord(value) || !(segment.key in value)) throw new LeverError(`The profile has no "${here}".`);
      const child = value[segment.key];

      if (segment.index === null) {
        if (lastSegment) slots.push({ holder: value, key: segment.key, where: here });
        else next.push({ value: child, where: here });
        continue;
      }
      if (!Array.isArray(child)) throw new LeverError(`"${here}" is not a list.`);
      const indices = segment.index === '*' ? child.map((_, k) => k) : [segment.index];
      for (const k of indices) {
        const at = `${here}[${k}]`;
        if (k >= child.length) throw new LeverError(`The profile has no "${at}".`);
        if (lastSegment) throw new LeverError(`"${path}" must end at a number, not at a list element.`);
        next.push({ value: child[k], where: at });
      }
    }
    frontier = next;
  });

  for (const slot of slots) {
    const value = slot.holder[slot.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new LeverError(`"${slot.where}" is not a number (it is ${value === null ? 'null' : typeof value}).`);
    }
  }
  return slots;
}

/** The numbers a path points at, in profile order. */
export function readPath(profile: ProfileJson, path: string): number[] {
  return resolveSlots(profile, path).map((slot) => slot.holder[slot.key] as number);
}

/** The lever with this id, or a LeverError listing the template's levers. */
export function findLever(template: Template, leverId: string): Lever {
  const lever = template.levers.find((candidate) => candidate.id === leverId);
  if (!lever) {
    const ids = template.levers.map((candidate) => candidate.id).join(', ');
    throw new LeverError(`The ${template.name} template has no lever "${leverId}". Its levers: ${ids}.`);
  }
  return lever;
}

const FLOAT_SLACK = 1e-9;

/** Number of decimals in a granularity such as 0.5 or 0.1. */
export function decimalsOf(step: number): number {
  const text = String(step);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Number(exponent[1]);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Round away binary noise (92.30000000000001 -> 92.3). */
function clean(value: number, decimals = 10): number {
  return Number(value.toFixed(decimals));
}

/** The nearest grid value, ties rounding up (92.25 on a 0.5 grid -> 92.5). */
export function snapToGranularity(value: number, granularity: number): number {
  if (!(granularity > 0)) return value;
  const steps = Math.round(clean(value / granularity, 9));
  return clean(steps * granularity, decimalsOf(granularity));
}

/** The smallest grid value at or above `value`. */
export function ceilToGrid(value: number, granularity: number): number {
  return clean(Math.ceil(clean(value / granularity, 9)) * granularity, decimalsOf(granularity));
}

/** The largest grid value at or below `value`. */
export function floorToGrid(value: number, granularity: number): number {
  return clean(Math.floor(clean(value / granularity, 9)) * granularity, decimalsOf(granularity));
}

/** The concrete paths a lever writes in this profile, e.g. ["steps[3].flow", "steps[4].flow"]. */
export function leverSlots(profile: ProfileJson, lever: Lever): string[] {
  return lever.paths.flatMap((path) => resolveSlots(profile, path).map((slot) => slot.where));
}

/** The lever's value in this profile: the anchor for a shift, the shared value for linked paths. */
export function readLeverValue(template: Template, profile: ProfileJson, leverId: string): number {
  const lever = findLever(template, leverId);
  if (lever.mode === 'uniformShift') {
    if (!lever.anchor) throw new LeverError(`Lever "${lever.id}" shifts uniformly but has no anchor.`);
    const values = readPath(profile, lever.anchor);
    if (values.length !== 1) throw new LeverError(`The anchor "${lever.anchor}" must point at one number.`);
    return values[0]!;
  }
  const values = lever.paths.flatMap((path) => readPath(profile, path));
  const first = values[0];
  if (first === undefined) throw new LeverError(`Lever "${lever.id}" has no paths.`);
  if (values.some((value) => Math.abs(value - first) > FLOAT_SLACK)) {
    throw new LeverError(
      `Lever "${lever.id}" reads ${values.join(' and ')} at its linked paths, which must be equal. This profile was not built from the ${template.name} template.`,
    );
  }
  return first;
}

/** The current value of every lever, keyed by lever id. */
export function readLeverValues(template: Template, profile: ProfileJson): LeverValues {
  const values: LeverValues = {};
  for (const lever of template.levers) values[lever.id] = readLeverValue(template, profile, lever.id);
  return values;
}

/**
 * A copy of `profile` with one lever set to `value` (snapped to the lever's
 * granularity). Linked levers write the value to every path; uniform shifts
 * add the anchor's delta to every path, so a shaped temperature profile keeps
 * its shape. Nothing else changes.
 */
export function applyLever(template: Template, profile: ProfileJson, leverId: string, value: number): ProfileJson {
  const lever = findLever(template, leverId);
  if (!Number.isFinite(value)) throw new LeverError(`Lever "${lever.id}" needs a finite number (got ${String(value)}).`);
  const target = snapToGranularity(value, lever.granularity);
  const next = clone(profile);

  if (lever.mode === 'linked') {
    for (const path of lever.paths) {
      for (const slot of resolveSlots(next, path)) slot.holder[slot.key] = target;
    }
    return next;
  }

  const delta = target - readLeverValue(template, profile, lever.id);
  for (const path of lever.paths) {
    for (const slot of resolveSlots(next, path)) slot.holder[slot.key] = clean((slot.holder[slot.key] as number) + delta);
  }
  return next;
}

/**
 * The lever's bounds for this dose. A dose-relative lever (yield) narrows to
 * [max(min, ratio.min x dose), min(max, ratio.max x dose)], rounded inward to
 * its granularity. Without a known dose the plain bounds apply.
 */
export function effectiveBounds(lever: Lever, doseG: number | null): { min: number; max: number } {
  if (!lever.doseRatio || doseG === null || !(doseG > 0)) return { min: lever.min, max: lever.max };
  return {
    min: Math.max(lever.min, ceilToGrid(lever.doseRatio.min * doseG, lever.granularity)),
    max: Math.min(lever.max, floorToGrid(lever.doseRatio.max * doseG, lever.granularity)),
  };
}

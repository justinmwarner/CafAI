/**
 * The grinder part of the Settings screen as plain functions: what the
 * picker offers, the line that tells the user what CafAI will use, and what
 * Save writes. SettingsScreen.tsx only renders these.
 *
 * Decaid's grinder library knows how a dial moves (a step size, or a list of
 * settings) but nothing else, so the line says only that, in Decaid's terms.
 */
import { grinderSteps, type Grinder } from '../../api/grinders.ts';
import type { Settings } from '../../storage/types.ts';

/** The picker's value for "Not in Decaid's list" (a grinder id is never empty). */
export const NOT_LISTED = '';

export const LIBRARY_HINT = "Add your grinder to Decaid's grinder library (for example with the DYE2 plugin) and CafAI will use its step size.";
export const NO_STEP_LINE = 'Decaid has no step size for this grinder, so the coach gives directions only.';
export const MISSING_LINE = 'Decaid no longer lists this grinder, so the coach gives directions only.';

/** Decaid's grinders, or that there are none to offer (Decaid unreachable, or an empty library). */
export type GrinderLibrary = { status: 'loading' } | { status: 'ready'; grinders: Grinder[] } | { status: 'unavailable' };

export interface GrinderForm {
  /** NOT_LISTED, or a grinder id (possibly one Decaid no longer lists). */
  pick: string;
  /** The grinder name typed by the user, when it is not picked from Decaid's list. */
  name: string;
  setting: string;
}

export function grinderLabel(grinder: Grinder): string {
  const model = grinder.model.trim() || 'Unnamed grinder';
  const burrs = grinder.burrs?.trim();
  return burrs ? `${model} (${burrs})` : model;
}

/** The option that keeps a link to a grinder Decaid no longer lists. */
export function missingGrinderLabel(name: string | null): string {
  return `${name?.trim() || 'Linked grinder'} (no longer in Decaid's list)`;
}

/** A step as people write it: 0.5, 2, 0.25 (never 0.30000000000000004). */
function formatStep(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** One plain line: what CafAI will use to move this grinder's dial. */
export function stepLine(grinder: Grinder): string {
  const steps = grinderSteps(grinder);
  if (steps.kind === 'numeric') {
    const big = steps.bigStep !== null ? ` (big steps ${formatStep(steps.bigStep)})` : '';
    return `Decaid lists steps of ${formatStep(steps.smallStep)} for this grinder${big}.`;
  }
  if (steps.kind === 'preset') {
    const count = steps.values.length;
    return `Decaid lists ${count} ${count === 1 ? 'setting' : 'settings'} for this grinder.`;
  }
  return NO_STEP_LINE;
}

/** The current setting is picked from Decaid's list (a preset grinder with settings). */
export function usesPresetSetting(grinder: Grinder | null): boolean {
  return grinder !== null && grinderSteps(grinder).kind === 'preset';
}

/**
 * The choices for a preset grinder's current setting. A value Decaid does not
 * list (typed before the grinder was linked, or an older list) stays on top,
 * so saving never changes it behind the user's back.
 */
export function presetOptions(grinder: Grinder, current: string): Array<{ value: string; label: string }> {
  const steps = grinderSteps(grinder);
  const values = steps.kind === 'preset' ? [...new Set(steps.values)] : [];
  const options = values.map((value) => ({ value, label: value }));
  if (current.trim() === '') return [{ value: '', label: 'Not set' }, ...options];
  if (!values.includes(current)) return [{ value: current, label: `${current} (not in Decaid's list)` }, ...options];
  return options;
}

/**
 * The grinder fields Save writes. With Decaid's list, the pick decides: a
 * listed grinder links its id and names it by its model, "Not in Decaid's
 * list" keeps the typed name unlinked, and a link Decaid lost is kept until
 * the user picks something else. Without the list (unreachable, empty, or
 * still loading) the name is free text, and a link survives only while that
 * name is unchanged: a renamed grinder is another grinder.
 */
export function grinderPatch(
  form: GrinderForm,
  library: GrinderLibrary,
  stored: Pick<Settings, 'grinderId' | 'grinderName'>,
): Required<Pick<Settings, 'grinderId' | 'grinderName' | 'grinderSetting'>> {
  const grinderSetting = form.setting.trim() || null;
  const typedName = form.name.trim() || null;
  if (library.status === 'ready') {
    if (form.pick === NOT_LISTED) return { grinderId: null, grinderName: typedName, grinderSetting };
    const picked = library.grinders.find((grinder) => grinder.id === form.pick);
    const grinderName = picked ? picked.model.trim() || null : (stored.grinderName ?? null);
    return { grinderId: form.pick, grinderName, grinderSetting };
  }
  const storedId = stored.grinderId ?? null;
  const sameName = typedName === (stored.grinderName?.trim() || null);
  return { grinderId: storedId !== null && sameName ? storedId : null, grinderName: typedName, grinderSetting };
}

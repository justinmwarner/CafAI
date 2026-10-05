/**
 * The grinder part of the Settings screen as plain functions: which fields
 * show, what the picker offers, the line that tells the user what CafAI will
 * use, and what Save writes. SettingsScreen.tsx and GrinderFields.tsx only
 * render these.
 *
 * Decaid's grinder library knows how a dial moves (a step size, or a list of
 * settings) but nothing else, so the line says only that, in Decaid's terms.
 */
import { grinderSteps, type Grinder } from '../../api/grinders.ts';
import { GatewayError } from '../../api/types.ts';
import type { Settings } from '../../storage/types.ts';

/** The picker's value for "Not in Decaid's list" (a grinder id is never empty). */
export const NOT_LISTED = '';

export const LIBRARY_HINT = "Add your grinder to Decaid's grinder library (for example with the DYE2 plugin) and CafAI will use its step size.";
export const NO_STEP_LINE = 'Decaid has no step size for this grinder, so the coach gives directions only.';
export const MISSING_LINE = 'Decaid no longer lists this grinder, so the coach gives directions only.';
export const UNREACHABLE_LINE = "Decaid can't be reached right now, so CafAI can't show this grinder's steps.";

/**
 * Decaid's grinders as far as Settings knows them. `ready` means Decaid
 * answered, and its list may be empty (no grinders yet, or a Decaid without
 * the library); `unavailable` means the list cannot be read right now.
 */
export type GrinderLibrary = { status: 'loading' } | { status: 'ready'; grinders: Grinder[] } | { status: 'unavailable' };

/**
 * What a failed read of Decaid's list means. A Decaid without the grinder
 * library answers 404: it lists nothing, as the engine reads it too (a link
 * then gives directions only). Anything else may pass, so a link is not
 * called lost on its account.
 */
export function libraryAfterError(error: unknown): GrinderLibrary {
  return error instanceof GatewayError && error.status === 404 ? { status: 'ready', grinders: [] } : { status: 'unavailable' };
}

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
 * How the current setting is entered. `pending` until its kind is known:
 * the settings are read and, for a linked grinder, Decaid's list too (a
 * preset grinder's setting is a list, never free text, not even for a moment).
 */
export type SettingControl = 'pending' | 'text' | 'preset';

export interface GrinderView {
  /** The "Grinder from Decaid" picker is shown (while Decaid's list loads too). */
  picker: boolean;
  /** The linked grinder, when Decaid lists it. */
  picked: Grinder | null;
  /** The form links a grinder Decaid answered without; the link is kept (directions only). */
  lostLink: boolean;
  /** The free-text grinder name is shown. */
  name: boolean;
  setting: SettingControl;
  /** The line that says what CafAI will use; null while Decaid's list loads. */
  line: string | null;
}

/**
 * What the grinder fields show. With no grinder linked and none in Decaid,
 * there is nothing to pick, so only the free-text fields and the hint show.
 * A link Decaid answered without, an empty list included, stays picked and
 * says so (D62); while Decaid cannot be reached, the line says that instead.
 */
export function grinderView(form: GrinderForm | null, library: GrinderLibrary): GrinderView {
  const pick = form?.pick ?? NOT_LISTED;
  const linked = pick !== NOT_LISTED;
  const grinders = library.status === 'ready' ? library.grinders : [];
  const picked = grinders.find((grinder) => grinder.id === pick) ?? null;
  const lostLink = library.status === 'ready' && linked && picked === null;
  const setting: SettingControl =
    form === null || (linked && library.status === 'loading') ? 'pending' : usesPresetSetting(picked) ? 'preset' : 'text';
  let line: string | null;
  if (library.status === 'loading') line = null;
  else if (picked) line = stepLine(picked);
  else if (lostLink) line = MISSING_LINE;
  else if (linked) line = UNREACHABLE_LINE;
  else line = LIBRARY_HINT;
  return {
    picker: library.status === 'loading' || grinders.length > 0 || lostLink,
    picked,
    lostLink,
    name: !linked || library.status === 'unavailable',
    setting,
    line,
  };
}

/**
 * The grinder fields Save writes. With Decaid's answer, the pick decides: a
 * listed grinder links its id and names it by its model, "Not in Decaid's
 * list" keeps the typed name unlinked, and a link Decaid lost (from a list
 * that may be empty) is kept until the user picks something else. Without
 * the list (unreachable, or still loading) the name is free text, and a link
 * survives only while that name is unchanged: a renamed grinder is another
 * grinder.
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

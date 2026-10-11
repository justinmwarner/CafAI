/**
 * Settings' Add a grinder as plain functions: what the dialog's fields make
 * of what was typed, what CafAI sends to Decaid (grinderRequest), what it
 * says afterwards, and where DYE2 keeps Decaid's grinders for editing.
 * AddGrinder.tsx only renders these.
 *
 * Decaid's own app has no screen for its grinder library: the DYE2 plugin,
 * bundled with Decaid and loaded by default, is where grinders are edited
 * and deleted (its Grinders page). CafAI only adds one.
 */
import { GRINDER_LIMITS, grinderRequest, type Grinder, type GrinderCreateRequest, type GrinderSettingType } from '../../api/grinders.ts';
import { PLUGIN } from '../../api/plugins.ts';
import { GatewayError } from '../../api/types.ts';
import { containsKeyLike } from '../../storage/redact.ts';
import { grinderLabel } from './grinderPicker.ts';

export interface AddGrinderForm {
  model: string;
  burrs: string;
  /** How the dial moves: a numbered dial, or a list of settings. */
  dial: GrinderSettingType;
  smallStep: string;
  bigStep: string;
  /** A preset grinder's settings, finest first, with commas between them. */
  settings: string;
}

export type AddGrinderField = 'model' | 'burrs' | 'smallStep' | 'bigStep' | 'settings';

export type AddGrinderCheck =
  | { ok: true; request: GrinderCreateRequest }
  | { ok: false; field: AddGrinderField; message: string };

export const NEEDS_MODEL = 'Name the grinder, like Niche Zero.';
export const KEY_REFUSED = "That looked like an API key, so CafAI won't send it to Decaid. Keys go in the API key field above.";
export const STEP_HELP = 'A step is a number more than 0, like 0.5.';
export const NEEDS_SETTINGS = "List the grinder's settings, finest first, with commas between them.";
export const SETTING_TOO_LONG = `Each setting is at most ${GRINDER_LIMITS.setting} characters.`;
export const TOO_MANY_SETTINGS = `At most ${GRINDER_LIMITS.settings} settings.`;

/** The form as it opens: the name typed in Settings' grinder field, when there is one. */
export function emptyAddGrinderForm(model = ''): AddGrinderForm {
  return { model: model.trim(), burrs: '', dial: 'numeric', smallStep: '', bigStep: '', settings: '' };
}

/** A step as typed ("0.5", "0,5", " 2 "): null when blank, NaN when it is not a number more than 0. */
export function parseStep(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

/** The settings as typed, split at commas or new lines, blanks left out. */
export function parseSettings(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((setting) => setting.trim())
    .filter((setting) => setting !== '');
}

const FIELDS: readonly AddGrinderField[] = ['model', 'burrs', 'smallStep', 'bigStep', 'settings'];

/**
 * What the dialog sends, or the first field to fix and what to say there.
 * A key never goes to Decaid, where every skin and Visualizer would read it
 * (D69): the field that holds one is refused rather than quietly cleaned.
 * A step left empty is allowed (the coach then gives directions only); a
 * list of settings must name at least one.
 */
export function checkAddGrinder(form: AddGrinderForm): AddGrinderCheck {
  if (form.model.trim() === '') return { ok: false, field: 'model', message: NEEDS_MODEL };
  const keyed = FIELDS.find((field) => containsKeyLike(form[field]));
  if (keyed) return { ok: false, field: keyed, message: KEY_REFUSED };
  const numeric = form.dial === 'numeric';
  const smallStep = numeric ? parseStep(form.smallStep) : null;
  if (Number.isNaN(smallStep)) return { ok: false, field: 'smallStep', message: STEP_HELP };
  const bigStep = numeric ? parseStep(form.bigStep) : null;
  if (Number.isNaN(bigStep)) return { ok: false, field: 'bigStep', message: STEP_HELP };
  const values = numeric ? null : parseSettings(form.settings);
  if (values !== null) {
    if (values.length === 0) return { ok: false, field: 'settings', message: NEEDS_SETTINGS };
    if (values.some((value) => value.length > GRINDER_LIMITS.setting)) return { ok: false, field: 'settings', message: SETTING_TOO_LONG };
    if (values.length > GRINDER_LIMITS.settings) return { ok: false, field: 'settings', message: TOO_MANY_SETTINGS };
  }
  const request = grinderRequest({ model: form.model, burrs: form.burrs, settingType: form.dial, smallStep, bigStep, values });
  return request ? { ok: true, request } : { ok: false, field: 'model', message: NEEDS_MODEL };
}

export const NO_LIBRARY = 'This Decaid has no grinder library to add to. Update Decaid, then try again.';

/** Why the grinder was not added, in a sentence: Decaid's own words when it refused it. */
export function addGrinderError(error: unknown): string {
  if (error instanceof GatewayError && error.status === 404) return NO_LIBRARY;
  const why = error instanceof Error && error.message ? error.message : String(error);
  return `Couldn't add the grinder: ${why}`;
}

/** What Settings says once the grinder is in Decaid's list and picked. */
export function addedNote(grinder: Grinder, added: boolean): string {
  const label = grinderLabel(grinder);
  return added
    ? `Added ${label} to Decaid's grinders. Save settings to use it.`
    : `Decaid already has ${label}, so CafAI picked it. Save settings to use it.`;
}

/**
 * DYE2's Grinders page, where Decaid's grinders are edited and deleted. It
 * opens in CafAI's place (inside Decaid the WebView keeps a page on
 * localhost:8080/api/v1/plugins in the app), and its Done goes back.
 */
export function dye2GrindersUrl(httpOrigin: string): string {
  return `${httpOrigin.trim().replace(/\/+$/, '')}/api/v1/plugins/${PLUGIN.dye2}/grinders`;
}

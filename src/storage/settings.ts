// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/settings.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: settings without the API key (pasted keys taken out of every field), null blanks, default model injected, plus the fill-blanks rule of web/src/main.ts hydrateSettings.
/**
 * CafAI's non-secret settings: normalising what was stored, applying edits,
 * and merging in a restored copy.
 *
 * Whatever comes back out of storage is data from a past version of ourselves
 * (or an import file), so it is read leniently: a field with the wrong type
 * falls back to its default instead of breaking start-up. Only the known
 * fields survive, so the record can never carry an API key into the mirror or
 * an export, whatever a caller passed in.
 *
 * Nor can a field: an API key pasted into the grinder fields would travel on
 * from here to Decaid's workflow, every later shot record (which Decaid shares
 * with Visualizer) and the coach, so anything key-shaped is taken out (D37).
 * Every read and write passes through here, so a record saved before that
 * rule is cleaned when it is read.
 */
import { containsKeyLike, redactKeyLike } from './redact.ts';
import type { Appearance, AppearanceMode, CareSettings, IntakeFilter, Settings, WaterBand } from './types.ts';

/** Today's look. */
export const DEFAULT_APPEARANCE: Appearance = { mode: 'dark', tint: 'crema' };

/**
 * Machine care before anyone answers (D-CARE-5): the water and the filter not
 * said, the stats card's line on. Settings hold the block only once it
 * differs from this, as the key-copy choice: read `settings.care ?? DEFAULT_CARE`.
 */
export const DEFAULT_CARE: CareSettings = { water: null, filter: null, reminders: true };

/** Without keepKeyInDecaid: nobody has chosen on this device yet, which reads as off (D99). */
export function defaultSettings(defaultModel: string): Settings {
  return {
    model: defaultModel,
    grinderName: null,
    grinderSetting: null,
    grinderId: null,
    activeBagId: null,
    appearance: DEFAULT_APPEARANCE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The text with anything key-shaped (a whole key or its first characters)
 * taken out, or null when nothing else is left. Text without a key comes back
 * exactly as it was.
 */
function withoutKeyLike(value: string | null): string | null {
  if (value === null || !containsKeyLike(value)) return value;
  const rest = redactKeyLike(value, ' ').replace(/\s+/g, ' ').trim();
  return rest === '' ? null : rest;
}

/** An id is opaque, but an empty one points at nothing, and a key-shaped one is no grinder's. */
function idOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && !containsKeyLike(value) ? value : null;
}

const MODES: readonly AppearanceMode[] = ['dark', 'light', 'auto'];
/** A tint id is a short lowercase word; nothing else (a pasted key included) is ever kept. */
const TINT_ID = /^[a-z][a-z0-9-]{0,31}$/;
/**
 * The tints renamed for coffee (D123, src/ui/palette.ts), by their old ids: a
 * look saved, backed up or exported before the rename keeps its tint, and is
 * written back under the new id at the next save. A Map, so an id such as
 * "constructor" never finds anything on Object's prototype.
 */
const RENAMED_TINTS: ReadonlyMap<string, string> = new Map([
  ['lagoon', 'cold-brew'],
  ['ocean', 'blueberry'],
  ['steel', 'tamper'],
]);

function normalizeTint(raw: unknown): Appearance['tint'] {
  if (typeof raw === 'string' && TINT_ID.test(raw)) return RENAMED_TINTS.get(raw) ?? raw;
  if (isRecord(raw) && typeof raw['hue'] === 'number' && Number.isFinite(raw['hue'])) {
    return { hue: ((Math.round(raw['hue']) % 360) + 360) % 360 };
  }
  return DEFAULT_APPEARANCE.tint;
}

/** A stored appearance, read leniently: anything unusable falls back to the default, field by field. */
export function normalizeAppearance(raw: unknown): Appearance {
  if (!isRecord(raw)) return DEFAULT_APPEARANCE;
  const mode = MODES.find((m) => m === raw['mode']) ?? DEFAULT_APPEARANCE.mode;
  return { mode, tint: normalizeTint(raw['tint']) };
}

const WATER_BANDS: readonly WaterBand[] = ['under30', 'to120', 'over120'];
const INTAKE_FILTERS: readonly IntakeFilter[] = ['v1', 'v2'];

/** A stored care block, read leniently: an answer this build does not know is not said; the switch defaults on. */
export function normalizeCareSettings(raw: unknown): CareSettings {
  if (!isRecord(raw)) return DEFAULT_CARE;
  return {
    water: WATER_BANDS.find((band) => band === raw['water']) ?? null,
    filter: INTAKE_FILTERS.find((filter) => filter === raw['filter']) ?? null,
    reminders: typeof raw['reminders'] === 'boolean' ? raw['reminders'] : DEFAULT_CARE.reminders,
  };
}

export function sameCareSettings(a: CareSettings, b: CareSettings): boolean {
  return a.water === b.water && a.filter === b.filter && a.reminders === b.reminders;
}

/** The block as settings keep it: left out at its defaults. */
function careField(care: CareSettings): Pick<Settings, 'care'> {
  return sameCareSettings(care, DEFAULT_CARE) ? {} : { care };
}

/** Like the look: an answer given here wins; a blank, or a switch still at its default, takes the incoming one. */
function fillBlankCare(local: CareSettings, incoming: CareSettings): CareSettings {
  return {
    water: local.water ?? incoming.water,
    filter: local.filter ?? incoming.filter,
    reminders: local.reminders === DEFAULT_CARE.reminders ? incoming.reminders : local.reminders,
  };
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  if (a.mode !== b.mode) return false;
  if (typeof a.tint === 'string' || typeof b.tint === 'string') return a.tint === b.tint;
  return a.tint.hue === b.tint.hue;
}

export function normalizeSettings(raw: unknown, defaultModel: string): Settings {
  if (!isRecord(raw)) return defaultSettings(defaultModel);
  // A key is never a model id: with it taken out, an empty model is the default.
  const model = withoutKeyLike(textOrNull(raw['model']));
  const settings: Settings = {
    model: model !== null && model.trim() !== '' ? model : defaultModel,
    grinderName: withoutKeyLike(textOrNull(raw['grinderName'])),
    grinderSetting: withoutKeyLike(textOrNull(raw['grinderSetting'])),
    // Settings saved before grinders could be linked have no id: not linked.
    grinderId: idOrNull(raw['grinderId']),
    activeBagId: textOrNull(raw['activeBagId']),
    appearance: normalizeAppearance(raw['appearance']),
  };
  // Only a choice someone made: never written as a default, so a merge can tell "off" from "not chosen here".
  if (typeof raw['keepKeyInDecaid'] === 'boolean') settings.keepKeyInDecaid = raw['keepKeyInDecaid'];
  return { ...settings, ...careField(normalizeCareSettings(raw['care'])) };
}

const FIELDS: ReadonlyArray<keyof Settings> = [
  'model',
  'grinderName',
  'grinderSetting',
  'grinderId',
  'activeBagId',
  'appearance',
  'keepKeyInDecaid',
  'care',
];

/** `undefined` means "not part of this edit", never "clear it"; clearing takes an explicit null. */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>, defaultModel: string): Settings {
  const next: Record<string, unknown> = { ...current };
  for (const field of FIELDS) {
    const value = (patch as Record<string, unknown>)[field];
    if (value !== undefined) next[field] = value;
  }
  // The care block changes field by field: an edit of the water never resets the filter (D-CARE-5).
  if (isRecord(patch.care)) next['care'] = { ...(current.care ?? DEFAULT_CARE), ...patch.care };
  return normalizeSettings(next, defaultModel);
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/**
 * Merge a restored or imported copy into this device's settings.
 *
 * Only ever fills blanks: anything already set here wins, so a restore can
 * never overwrite a choice made on this device. The model has no blank state,
 * so (like Crema's provider) it is adopted only while it is still the default.
 * The grinder's name and its Decaid link describe one grinder, so the link
 * comes along only when this device names no grinder at all: a name typed
 * here is never paired with another grinder's link.
 * The appearance, like the model, is adopted only while it is still the default.
 * The key's copy in Decaid (D99) is the user's choice wherever this device
 * holds one, off as much as on; only a device that never chose takes it.
 */
export function fillBlankSettings(local: Settings, incoming: Settings, defaultModel: string): Settings {
  const pick = (mine: string | null, theirs: string | null) => (isBlank(mine) && !isBlank(theirs) ? theirs : mine);
  const linkedHere = !isBlank(local.grinderId);
  const noGrinderHere = isBlank(local.grinderName) && !linkedHere;
  const merged: Settings = {
    model: local.model === defaultModel && incoming.model.trim() !== '' ? incoming.model : local.model,
    grinderName: linkedHere ? local.grinderName : pick(local.grinderName, incoming.grinderName),
    grinderSetting: pick(local.grinderSetting, incoming.grinderSetting),
    grinderId: noGrinderHere ? (incoming.grinderId ?? null) : (local.grinderId ?? null),
    activeBagId: pick(local.activeBagId, incoming.activeBagId),
    // Like the model: a look chosen on this device wins; the default takes the imported one.
    appearance: sameAppearance(local.appearance ?? DEFAULT_APPEARANCE, DEFAULT_APPEARANCE)
      ? (incoming.appearance ?? DEFAULT_APPEARANCE)
      : (local.appearance ?? DEFAULT_APPEARANCE),
  };
  // A device whose storage was lost has no choice of its own, and a copy in Decaid means it was on somewhere.
  const keep = local.keepKeyInDecaid ?? incoming.keepKeyInDecaid;
  if (keep !== undefined) merged.keepKeyInDecaid = keep;
  return { ...merged, ...careField(fillBlankCare(local.care ?? DEFAULT_CARE, incoming.care ?? DEFAULT_CARE)) };
}

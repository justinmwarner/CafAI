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
import { isFunFactsSource } from '../coach/facts/types.ts';
import { isTemperatureUnit } from '../coach/temperature.ts';
import { containsKeyLike, redactKeyLike } from './redact.ts';
import type {
  Appearance,
  AppearanceMode,
  CareSettings,
  ClockFormat,
  CoachBudget,
  CoachEffort,
  DrinkScreen,
  DrinkScreenKind,
  DrinkScreensSettings,
  IntakeFilter,
  ScreensaverSetting,
  Settings,
  SettingsPatch,
  WaterBand,
} from './types.ts';

/** Today's look. */
export const DEFAULT_APPEARANCE: Appearance = { mode: 'dark', tint: 'crema' };

/**
 * The screensaver before anyone changes it on this device (D225): on,
 * a different one each day. Read `settings.screensaver ?? DEFAULT_SCREENSAVER`.
 */
export const DEFAULT_SCREENSAVER: ScreensaverSetting = { on: true, pick: 'daily' };

/** The longest pick storage keeps: a screensaver's id is a word or two. */
const MAX_PICK_CHARS = 40;

/**
 * Machine care before anyone answers (D187): the water and the filter not
 * said, the stats card's line on. Settings hold the block once someone
 * answered on this device, kept from then on, these values too, as the
 * key-copy choice is: read `settings.care ?? DEFAULT_CARE`.
 */
export const DEFAULT_CARE: CareSettings = { water: null, filter: null, reminders: true };

/** How hard the coach thinks while nobody chose on this device (D243): medium, as it always has (D30). */
export const DEFAULT_COACH_EFFORT: CoachEffort = 'medium';
const COACH_EFFORTS: readonly CoachEffort[] = ['low', 'medium', 'high'];

export function isCoachEffort(value: unknown): value is CoachEffort {
  return COACH_EFFORTS.some((effort) => effort === value);
}

/** The clock while nobody chose on this device (D245): 24-hour, as every time has read so far. */
export const DEFAULT_CLOCK: ClockFormat = '24h';

export function isClockFormat(value: unknown): value is ClockFormat {
  return value === '24h' || value === '12h';
}

/** No budget and no pause (D240): read `settings.coachBudget ?? DEFAULT_BUDGET`. */
export const DEFAULT_BUDGET: CoachBudget = { monthlyUsd: null, pauseAtBudget: false };

/** A budget is whole dollars a month (D240). */
export const BUDGET_USD = { min: 1, max: 1000 } as const;

/** The screensaver's waits on offer, in minutes (D247); absent reads as the policy's minute (D223). */
export const SAVER_START_AFTER_MINUTES: readonly number[] = [1, 2, 5, 10, 15];

/** The brightness the screensaver dims to, on Decaid's 0-100 (D247); absent reads as the policy's 30 (D224). */
export const SAVER_DIM_TO = { min: 10, max: 60, step: 10 } as const;

/** The longest grinder key storage keeps (grinderDirectionKey): an id or a typed name of up to 60 characters, with its prefix. */
const MAX_GRINDER_KEY_CHARS = 80;
/** More grinders than anyone owns; a longer list is cut, so a bad import cannot grow the record without end. */
const MAX_GRINDER_KEYS = 50;

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

export const DRINK_SCREEN_KINDS: readonly DrinkScreenKind[] = ['steam', 'hotWater', 'flush'];

/** Go back by itself's time (D221): whole seconds, 5-60. */
export const GO_BACK_SECONDS = { min: 5, max: 60 } as const;

/**
 * A stored drink screens block, read leniently: each drink's fields that
 * read are kept and the rest left out, so they read as the defaults. A scene
 * is kept whatever it names (a newer build's scene survives the round trip;
 * the dial reads one it does not know as the drink's default); seconds are
 * rounded and kept within 5-60.
 */
export function normalizeDrinkScreens(raw: unknown): DrinkScreensSettings {
  const screens: DrinkScreensSettings = {};
  if (!isRecord(raw)) return screens;
  for (const kind of DRINK_SCREEN_KINDS) {
    const stored = raw[kind];
    if (!isRecord(stored)) continue;
    const screen: Partial<DrinkScreen> = {};
    const scene = stored['scene'];
    if (typeof scene === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(scene)) screen.scene = scene;
    if (typeof stored['goBack'] === 'boolean') screen.goBack = stored['goBack'];
    const seconds = stored['goBackSeconds'];
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      screen.goBackSeconds = Math.min(GO_BACK_SECONDS.max, Math.max(GO_BACK_SECONDS.min, Math.round(seconds)));
    }
    if (Object.keys(screen).length > 0) screens[kind] = screen;
  }
  return screens;
}

/**
 * A stored screensaver setting, read leniently, field by field: on unless it
 * says off, and a pick of 1 to 40 characters kept whatever it names (one this
 * build does not know shows as "A different one each day"), else 'daily'.
 */
export function normalizeScreensaver(raw: unknown): ScreensaverSetting {
  if (!isRecord(raw)) return DEFAULT_SCREENSAVER;
  const pick = raw['pick'];
  const setting: ScreensaverSetting = {
    on: typeof raw['on'] === 'boolean' ? raw['on'] : DEFAULT_SCREENSAVER.on,
    pick: typeof pick === 'string' && pick.length >= 1 && pick.length <= MAX_PICK_CHARS ? pick : DEFAULT_SCREENSAVER.pick,
  };
  // The wait and the brightness (D247): only a value on offer, else left out, so it reads as the policy's own.
  const wait = raw['startAfterMinutes'];
  if (typeof wait === 'number' && SAVER_START_AFTER_MINUTES.includes(wait)) setting.startAfterMinutes = wait;
  const dim = raw['dimTo'];
  if (typeof dim === 'number' && Number.isInteger(dim) && dim >= SAVER_DIM_TO.min && dim <= SAVER_DIM_TO.max && dim % SAVER_DIM_TO.step === 0) {
    setting.dimTo = dim;
  }
  return setting;
}

/**
 * A stored budget, read leniently (D240): whole dollars within 1 to 1,000,
 * rounded and kept within them, or null for none; the pause off unless it
 * says on.
 */
export function normalizeCoachBudget(raw: unknown): CoachBudget {
  if (!isRecord(raw)) return DEFAULT_BUDGET;
  const usd = raw['monthlyUsd'];
  return {
    monthlyUsd:
      typeof usd === 'number' && Number.isFinite(usd) ? Math.min(BUDGET_USD.max, Math.max(BUDGET_USD.min, Math.round(usd))) : null,
    pauseAtBudget: raw['pauseAtBudget'] === true,
  };
}

/**
 * The grinders whose higher numbers are finer, read leniently (D241): keys of
 * 1 to 80 characters, nothing key-shaped (a typed name can hold a pasted
 * key), each once, at most 50: the newest, which withGrinderDirection puts
 * last, so a new answer is never the one dropped.
 */
export function normalizeGrinderFinerHigher(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (let i = raw.length - 1; i >= 0 && keys.length < MAX_GRINDER_KEYS; i -= 1) {
    const value: unknown = raw[i];
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_GRINDER_KEY_CHARS || containsKeyLike(value)) continue;
    if (!keys.includes(value)) keys.unshift(value);
  }
  return keys;
}

/**
 * The key a grinder's direction is kept under (D241): Decaid's grinder id
 * while linked ("id:<id>"), else the typed name, trimmed, its spaces joined
 * and lowercased ("name:niche zero"); null with no grinder at all.
 */
export function grinderDirectionKey(settings: Pick<Settings, 'grinderId' | 'grinderName'>): string | null {
  const id = settings.grinderId?.trim();
  if (id) return `id:${id}`;
  const name = settings.grinderName?.trim().replace(/\s+/g, ' ').toLowerCase();
  return name ? `name:${name}` : null;
}

/** Whether higher numbers are finer on the grinder these settings name (D241); lower is finer otherwise (D62). */
export function finerIsHigher(settings: Pick<Settings, 'grinderId' | 'grinderName' | 'grinderFinerHigher'>): boolean {
  const key = grinderDirectionKey(settings);
  return key !== null && (settings.grinderFinerHigher ?? []).includes(key);
}

/** The direction list with this grinder's set (D241): `higher` true lists it, false takes it off. */
export function withGrinderDirection(list: readonly string[] | undefined, key: string, higher: boolean): string[] {
  const rest = (list ?? []).filter((entry) => entry !== key);
  return higher ? [...rest, key] : rest;
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
  // The temperature unit (D172), the same way: one this build does not know reads as none chosen, so °C.
  if (isTemperatureUnit(raw['temperatureUnit'])) settings.temperatureUnit = raw['temperatureUnit'];
  // Machine care's answers (D187), the same way: the block once someone answered, an answer put back to Not sure included.
  if (isRecord(raw['care'])) settings.care = normalizeCareSettings(raw['care']);
  // Where fun facts come from (D198), as the unit: one this build does not know reads as none chosen.
  if (isFunFactsSource(raw['funFacts'])) settings.funFacts = raw['funFacts'];
  // Each drink's screen (D222), as care: the block once someone chose, and only the fields that read.
  if (isRecord(raw['drinkScreens'])) settings.drinkScreens = normalizeDrinkScreens(raw['drinkScreens']);
  // The screensaver (D225), as care: the block once someone changed it here, the default's values included.
  if (isRecord(raw['screensaver'])) settings.screensaver = normalizeScreensaver(raw['screensaver']);
  // Where the coach runs, kept in Decaid too (D229), as the key's copy: only a choice someone made, read as on without one.
  if (typeof raw['keepCoachSourceInDecaid'] === 'boolean') settings.keepCoachSourceInDecaid = raw['keepCoachSourceInDecaid'];
  // How hard the coach thinks (D243), as the unit: one this build does not know reads as none chosen, so medium.
  if (isCoachEffort(raw['coachEffort'])) settings.coachEffort = raw['coachEffort'];
  // The budget (D240), as care: the block once someone set it here, no budget and the pause off included.
  if (isRecord(raw['coachBudget'])) settings.coachBudget = normalizeCoachBudget(raw['coachBudget']);
  // Which grinders are finer at higher numbers (D241): the list once someone chose, an emptied one included.
  if (Array.isArray(raw['grinderFinerHigher'])) settings.grinderFinerHigher = normalizeGrinderFinerHigher(raw['grinderFinerHigher']);
  // The clock (D245) and the TDS cell (D246), as the unit: only a choice someone made.
  if (isClockFormat(raw['clock'])) settings.clock = raw['clock'];
  if (typeof raw['showTds'] === 'boolean') settings.showTds = raw['showTds'];
  return settings;
}

const FIELDS: ReadonlyArray<keyof Settings> = [
  'model',
  'grinderName',
  'grinderSetting',
  'grinderId',
  'activeBagId',
  'appearance',
  'keepKeyInDecaid',
  'temperatureUnit',
  'care',
  'funFacts',
  'drinkScreens',
  'screensaver',
  'keepCoachSourceInDecaid',
  'coachEffort',
  'coachBudget',
  'grinderFinerHigher',
  'clock',
  'showTds',
];

/** `undefined` means "not part of this edit", never "clear it"; clearing takes an explicit null. */
export function applySettingsPatch(current: Settings, patch: SettingsPatch, defaultModel: string): Settings {
  const next: Record<string, unknown> = { ...current };
  for (const field of FIELDS) {
    const value = (patch as Record<string, unknown>)[field];
    if (value !== undefined) next[field] = value;
  }
  // The care block changes field by field: an edit of the water never resets the filter (D187).
  if (isRecord(patch.care)) {
    const edits = Object.entries(patch.care).filter(([, value]) => value !== undefined);
    next['care'] = { ...(current.care ?? DEFAULT_CARE), ...Object.fromEntries(edits) };
  }
  // Each drink's screen changes field by field too: picking a scene never resets going back by itself (D222).
  if (isRecord(patch.drinkScreens)) {
    const screens: Record<string, unknown> = { ...(current.drinkScreens ?? {}) };
    for (const kind of DRINK_SCREEN_KINDS) {
      const edit = patch.drinkScreens[kind];
      if (!isRecord(edit)) continue;
      const edits = Object.entries(edit).filter(([, value]) => value !== undefined);
      screens[kind] = { ...(current.drinkScreens?.[kind] ?? {}), ...Object.fromEntries(edits) };
    }
    next['drinkScreens'] = screens;
  }
  // The budget changes field by field too: setting the dollars never turns the pause off (D240).
  if (isRecord(patch.coachBudget)) {
    const edits = Object.entries(patch.coachBudget).filter(([, value]) => value !== undefined);
    next['coachBudget'] = { ...(current.coachBudget ?? DEFAULT_BUDGET), ...Object.fromEntries(edits) };
  }
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
 * The temperature unit (D172), machine care's answers (D187), the source of
 * fun facts (D198), the drinks' screens (D222), the screensaver (D225), the
 * choice to keep where the coach runs in Decaid (D229), how hard the coach
 * thinks (D243), its budget (D240), the grinders' directions (D241), the
 * clock (D245) and the TDS cell (D246) follow the same rule, the care, drink
 * screens, screensaver and budget blocks and the directions' list whole.
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
  // The temperature unit (D172): a choice made here wins, °C as much as °F; a device that never chose takes the incoming one.
  const unit = local.temperatureUnit ?? incoming.temperatureUnit;
  if (unit !== undefined) merged.temperatureUnit = unit;
  // Machine care (D187): answers given here win whole, Not sure and the switch's default too; a device that never answered takes the incoming ones.
  const care = local.care ?? incoming.care;
  if (care !== undefined) merged.care = care;
  // Fun facts (D198), as the unit: a choice made here wins, Off as much as any other.
  const facts = local.funFacts ?? incoming.funFacts;
  if (facts !== undefined) merged.funFacts = facts;
  // The drinks' screens (D222), as care: choices made here win whole; a device that never chose takes the incoming ones.
  const screens = local.drinkScreens ?? incoming.drinkScreens;
  if (screens !== undefined) merged.drinkScreens = screens;
  // The screensaver (D225), as care: a choice made here wins whole, turned off as much as on.
  const saver = local.screensaver ?? incoming.screensaver;
  if (saver !== undefined) merged.screensaver = saver;
  // Where the coach runs, kept in Decaid (D229), as the key's copy: a choice made here wins, off as much as on.
  const keepSource = local.keepCoachSourceInDecaid ?? incoming.keepCoachSourceInDecaid;
  if (keepSource !== undefined) merged.keepCoachSourceInDecaid = keepSource;
  // How hard the coach thinks (D243), the budget (D240, the block whole), the grinders' directions (D241, the list whole),
  // the clock (D245) and the TDS cell (D246), as the unit: a choice made here wins; a device that never chose takes the incoming one.
  const effort = local.coachEffort ?? incoming.coachEffort;
  if (effort !== undefined) merged.coachEffort = effort;
  const budget = local.coachBudget ?? incoming.coachBudget;
  if (budget !== undefined) merged.coachBudget = budget;
  const directions = local.grinderFinerHigher ?? incoming.grinderFinerHigher;
  if (directions !== undefined) merged.grinderFinerHigher = directions;
  const clock = local.clock ?? incoming.clock;
  if (clock !== undefined) merged.clock = clock;
  const tds = local.showTds ?? incoming.showTds;
  if (tds !== undefined) merged.showTds = tds;
  return merged;
}

// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/settings.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: settings without the API key, null blanks, default model injected, plus the fill-blanks rule of web/src/main.ts hydrateSettings.
/**
 * CafAI's non-secret settings: normalising what was stored, applying edits,
 * and merging in a restored copy.
 *
 * Whatever comes back out of storage is data from a past version of ourselves
 * (or an import file), so it is read leniently: a field with the wrong type
 * falls back to its default instead of breaking start-up. Only the four known
 * fields survive, so the record can never carry an API key into the mirror or
 * an export, whatever a caller passed in.
 */
import type { Settings } from './types.ts';

export function defaultSettings(defaultModel: string): Settings {
  return { model: defaultModel, grinderName: null, grinderSetting: null, activeBagId: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function normalizeSettings(raw: unknown, defaultModel: string): Settings {
  if (!isRecord(raw)) return defaultSettings(defaultModel);
  const model = raw['model'];
  return {
    model: typeof model === 'string' && model.trim() !== '' ? model : defaultModel,
    grinderName: textOrNull(raw['grinderName']),
    grinderSetting: textOrNull(raw['grinderSetting']),
    activeBagId: textOrNull(raw['activeBagId']),
  };
}

const FIELDS: ReadonlyArray<keyof Settings> = ['model', 'grinderName', 'grinderSetting', 'activeBagId'];

/** `undefined` means "not part of this edit", never "clear it"; clearing takes an explicit null. */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>, defaultModel: string): Settings {
  const next: Record<string, unknown> = { ...current };
  for (const field of FIELDS) {
    const value = (patch as Record<string, unknown>)[field];
    if (value !== undefined) next[field] = value;
  }
  return normalizeSettings(next, defaultModel);
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * Merge a restored or imported copy into this device's settings.
 *
 * Only ever fills blanks: anything already set here wins, so a restore can
 * never overwrite a choice made on this device. The model has no blank state,
 * so (like Crema's provider) it is adopted only while it is still the default.
 */
export function fillBlankSettings(local: Settings, incoming: Settings, defaultModel: string): Settings {
  const pick = (mine: string | null, theirs: string | null) => (isBlank(mine) && !isBlank(theirs) ? theirs : mine);
  return {
    model: local.model === defaultModel && incoming.model.trim() !== '' ? incoming.model : local.model,
    grinderName: pick(local.grinderName, incoming.grinderName),
    grinderSetting: pick(local.grinderSetting, incoming.grinderSetting),
    activeBagId: pick(local.activeBagId, incoming.activeBagId),
  };
}

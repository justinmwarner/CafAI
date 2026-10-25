/**
 * Settings' seven groups (D233), in the list's order, each at its own
 * address: `#/settings/coach` and so on. Ids and paths are the same words.
 * Kept apart from the groups' components so the router can read them.
 */
export const SETTINGS_GROUP_IDS = ['coach', 'grinder', 'drinks', 'machine', 'display', 'data', 'about'] as const;

export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number];

export function isSettingsGroupId(value: unknown): value is SettingsGroupId {
  return SETTINGS_GROUP_IDS.some((id) => id === value);
}

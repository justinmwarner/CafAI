/**
 * Usage sharing's vocabulary (D213): the coach steps CafAI counts, each
 * a Clarity custom event a funnel can use (Clarity takes up to 20), and the
 * tags a session carries for Clarity's filters.
 */
export const USAGE_EVENTS = [
  'coach_setup',
  'coach_message',
  'bag_started',
  'profile_loaded',
  'shot_read',
  'taste_given',
  'change_confirmed',
  'change_undone',
  'recipe_kept',
  'fun_fact_shown',
  'coach_error',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

export type UsageTag = 'cafai_version' | 'coach_source' | 'host' | 'layout' | 'rule';

/** What the engine and the screens call; a no-op where the build shares nothing. */
export interface UsageTracker {
  track(event: UsageEvent): void;
}

export const NO_USAGE: UsageTracker = { track: () => undefined };

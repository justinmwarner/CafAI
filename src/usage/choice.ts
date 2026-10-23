/**
 * The device's answer about usage sharing (D-USAGE-3), in the device's own
 * storage under cafai.usage.choice, as the told fun facts are (D200): never
 * mirrored to Decaid or exported, so each device decides for itself.
 * Storage that is blocked or holds something else reads as no answer, and an
 * answer it cannot keep holds for the page.
 */
import type { ConsentRule } from './region.ts';

export const CHOICE_KEY = 'cafai.usage.choice';

/** The card's and the notice's wording, kept with each answer as the record of what was answered. */
export const WORDING = 1;

export interface UsageChoice {
  choice: 'yes' | 'no';
  /** When it was given, ISO. */
  at: string;
  /** The wording answered (WORDING). */
  wording: number;
  /** The rule the device was under when it answered. */
  rule: ConsentRule;
}

type DeviceStorage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function readChoice(storage: DeviceStorage | null): UsageChoice | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(CHOICE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const { choice, at, wording, rule } = raw as Record<string, unknown>;
    if (choice !== 'yes' && choice !== 'no') return null;
    if (typeof at !== 'string' || typeof wording !== 'number') return null;
    if (rule !== 'ask' && rule !== 'notice') return null;
    return { choice, at, wording, rule };
  } catch {
    return null;
  }
}

export function writeChoice(storage: DeviceStorage | null, choice: UsageChoice): void {
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Blocked or full: the answer holds for this page only.
  }
}

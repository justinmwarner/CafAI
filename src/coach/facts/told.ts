/**
 * The fun facts told on this device (D200): every fact shown, CafAI's or the
 * coach's, with the bag and the time, so a fact is not told again before the
 * others that fit. The newest 1,000 stay in the device's own storage under
 * cafai.facts.told, as the care counts' cache does (D185): never mirrored to
 * Decaid or exported. Storage that is blocked, full or holds something else
 * leaves the list in memory for the page: losing it only means a fact can
 * come back.
 */

/** One fact told: its id in CafAI's list, or "coach:" and the coach's label (coachKey). */
export interface ToldEntry {
  key: string;
  bagId: string;
  /** When it was shown, ISO. */
  at: string;
}

export interface ToldList {
  /** Every fact told, oldest first. */
  entries(): readonly ToldEntry[];
  add(entry: ToldEntry): void;
}

export const TOLD_KEY = 'cafai.facts.told';
export const TOLD_CAP = 1000;

function isEntry(value: unknown): value is ToldEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { key, bagId, at } = value as Record<string, unknown>;
  return typeof key === 'string' && typeof bagId === 'string' && typeof at === 'string';
}

function readTold(storage: Pick<globalThis.Storage, 'getItem'> | null): ToldEntry[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(TOLD_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isEntry).slice(-TOLD_CAP) : [];
  } catch {
    return [];
  }
}

/** `storage`: the device's own (localStorage), or null where there is none. */
export function createToldList(storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null): ToldList {
  let told = readTold(storage);
  return {
    entries: () => told,
    add(entry) {
      told = [...told, entry].slice(-TOLD_CAP);
      try {
        storage?.setItem(TOLD_KEY, JSON.stringify(told));
      } catch {
        // Storage blocked or full: kept for this page.
      }
    },
  };
}

const COACH = 'coach:';

/** The told list's key for a fact the coach shared: its label, trimmed, in lower case, its spaces collapsed. */
export function coachKey(label: string): string {
  return `${COACH}${label.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/** The label a key of the coach's was told under; null for the id of a fact in CafAI's list. */
export function coachLabel(key: string): string | null {
  return key.startsWith(COACH) ? key.slice(COACH.length) : null;
}

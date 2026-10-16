/**
 * Machine care in the demo (D-CARE-1, D-CARE-6): as a barista who keeps up
 * with it would have it a day into the dial-in, the weekly clean due and the
 * rest on time. Times count back from the demo's moment; the totals are
 * Decaid's before the story's shots, so every shot of the dial-in counts
 * since, and there was no steaming.
 */
import type { CareRecord } from '../../src/storage/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each step marked done, by how many days before the demo's moment. The steam tip and the transport never were. */
const LAST_DONE: ReadonlyArray<readonly [string, number]> = [
  ['detergent-clean', 8],
  ['rinza', 3],
  ['tank-tray', 2],
  ['intake-filter', 11],
  ['group-parts', 16],
  ['gasket', 16],
  ['descale', 140],
];

export function demoCare(nowMs: number): CareRecord[] {
  return LAST_DONE.map(([id, daysAgo]) => {
    const at = new Date(nowMs - daysAgo * DAY_MS).toISOString();
    return { id, doneAt: at, by: 'tick', countFrom: at, shotTotal: 0, steamTotal: 0, updatedAt: at };
  });
}

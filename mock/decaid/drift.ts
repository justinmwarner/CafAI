/**
 * ?mockDrift=1: a Decaid that renamed one machine reading, so CafAI's drift
 * log and Settings > About can be seen at work (D95, D96).
 *
 * Only what goes out changes: the machine socket's frames (its replay
 * included) and GET /api/v1/machine/state carry the reading under its new
 * name, as a newer Decaid that renamed it would send them. The mock's own
 * snapshot, its player and its shot records keep the real name, so shots run
 * and are stored as before.
 */
import type { MachineReading, MachineSnapshot } from '../../src/api/types.ts';

export interface RenamedReading {
  /** The reading's name in CafAI's contract. */
  from: MachineReading;
  /** The name it goes out under. */
  to: string;
}

/** What ?mockDrift=1 renames: the group temperature, the first readout on the stats card. */
export const DRIFT_RENAMED_READING: RenamedReading = { from: 'groupTemperature', to: 'groupTemp' };

/** A machine frame as it goes out: as it is, or with the renamed reading under its new name, in its place. */
export function sentMachineFrame(frame: MachineSnapshot, renamed: RenamedReading | null): Record<string, unknown> {
  const fields = Object.entries(frame);
  if (renamed === null || !(renamed.from in frame)) return Object.fromEntries(fields);
  return Object.fromEntries(fields.map(([key, value]) => [key === renamed.from ? renamed.to : key, value]));
}

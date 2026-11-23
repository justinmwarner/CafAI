/**
 * When Overhead covers CafAI (the brief): N minutes untouched (3 unless set)
 * with the machine not busy, inside Decaid's WebView, with the plugin
 * running and Overhead turned on. "Not busy" is an allow-list, so anything
 * Decaid reports as active (espresso, steam, hot water, flush, cleaning,
 * descaling, heating...) keeps it away: only `idle` and `sleeping` let it
 * come, or no machine connected at all. It goes at once when the machine
 * turns busy: never over a shot.
 *
 * Unlike the classic screensaver (D223), it may show while the machine is
 * awake and idle; while it is on, the classic one stands down
 * (SaverOverlay, DECISIONS O17).
 */
import type { MachineStateName, TelemetryState } from '../../api/types.ts';

export const OVERHEAD_IDLE_MINUTES = 3;

/** The machine states Overhead may cover. */
export const RESTING_STATES: ReadonlySet<MachineStateName | string> = new Set(['idle', 'sleeping']);

/** Whether the machine is doing anything at all; unknown while Decaid is out of reach. */
export function machineBusy(telemetry: Pick<TelemetryState, 'machineConnected' | 'unreachable' | 'machine'>): boolean {
  if (telemetry.unreachable) return true;
  if (!telemetry.machineConnected) return false;
  const state = telemetry.machine?.state?.state;
  return state === undefined || !RESTING_STATES.has(state);
}

export interface OverheadInputs {
  /** Overhead turned on in its settings, and its plugin answering. */
  available: boolean;
  insideDecaid: boolean;
  busy: boolean;
  untouchedMs: number;
  idleMinutes: number;
}

/** How long until it comes up if nothing else changes: 0 now, null while time alone cannot bring it. */
export function overheadMsUntilWanted(inputs: OverheadInputs): number | null {
  if (!inputs.available || !inputs.insideDecaid || inputs.busy) return null;
  const minutes = Number.isFinite(inputs.idleMinutes) && inputs.idleMinutes > 0 ? inputs.idleMinutes : OVERHEAD_IDLE_MINUTES;
  const untouched = Number.isFinite(inputs.untouchedMs) ? inputs.untouchedMs : 0;
  return Math.max(0, minutes * 60_000 - untouched);
}

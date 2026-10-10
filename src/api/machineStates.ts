/**
 * Decaid's machine states (MachineState in machine.dart at aab5f93), sorted
 * by what CafAI may do in each. The one list both the frame parser, which
 * reports any other state as drift (frames.ts), and the machine controls,
 * which offer Stop for it (D97, src/ui/machine/commands.ts), read.
 */

/** A drink or a cycle runs: Stop (PUT state `idle`) ends it. */
export const RUNNING_STATES: ReadonlySet<string> = new Set([
  'espresso',
  'steam',
  'hotWater',
  'flush',
  'steamRinse',
  'skipStep',
  'cleaning',
  'descaling',
  'airPurge',
]);

/** At rest: nothing to stop. */
export const AT_REST_STATES: ReadonlySet<string> = new Set([
  'idle',
  'schedIdle',
  'sleeping',
  'heating',
  'preheating',
  'booting',
  'busy',
  'needsWater',
  'error',
]);

/** Nothing may interrupt these: no Stop, no Sleep. */
export const DO_NOT_INTERRUPT_STATES: ReadonlySet<string> = new Set(['fwUpgrade', 'calibration', 'selfTest']);

/** A shot: espresso, and skipStep for the moment it moves to its next step. */
const SHOT_STATES: ReadonlySet<string> = new Set(['espresso', 'skipStep']);

/** A known drink or cycle is running. */
export function isRunningMachineState(state: string | null | undefined): boolean {
  return typeof state === 'string' && RUNNING_STATES.has(state);
}

/** D97: Stop for the known running states and for any state CafAI does not know. */
export function isStoppableMachineState(state: string | null | undefined): boolean {
  if (typeof state !== 'string' || state === '') return false;
  if (RUNNING_STATES.has(state)) return true;
  return !AT_REST_STATES.has(state) && !DO_NOT_INTERRUPT_STATES.has(state);
}

/** One of Decaid's states; any other is reported as drift. */
export function isKnownMachineState(state: string): boolean {
  return RUNNING_STATES.has(state) || AT_REST_STATES.has(state) || DO_NOT_INTERRUPT_STATES.has(state);
}

/** The machine is pulling a shot. */
export function isShotMachineState(state: string | null | undefined): boolean {
  return typeof state === 'string' && SHOT_STATES.has(state);
}

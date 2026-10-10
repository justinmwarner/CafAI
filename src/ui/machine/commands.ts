/**
 * Which machine controls are live, as a pure function of what telemetry says.
 *
 * The rules come from Crema's brew rail (re-expressed, not ported): nothing is
 * commandable without a connected machine; while something runs, Stop is the
 * control that matters and no other start is offered (a row of live start
 * buttons mid-shot is how you end up steaming during an extraction); a
 * sleeping machine does not brew until woken; a machine with a group-head
 * controller starts from its own buttons; and a command in flight disables
 * the controls instead of queueing presses. Stop is the exception to that
 * last rule: it is never blocked.
 *
 * Stop also shows for a state this build does not know (D97): a newer Decaid
 * may run something under a new name, and a missing Stop is the worse
 * mistake. But never while the machine updates its firmware, calibrates or
 * tests itself, which nothing may interrupt. Which state is which is
 * src/api/machineStates.ts.
 */
import { DO_NOT_INTERRUPT_STATES, isRunningMachineState, isStoppableMachineState } from '../../api/machineStates.ts';
import type { CommandableState } from '../../api/types.ts';

export type StartCommand = 'espresso' | 'steam' | 'flush' | 'hotWater';

/** A command the panel can have in flight. */
export type PendingCommand = CommandableState | 'tare';

/** States a start command may be sent from. Anything else is refused with a reason. */
const STARTABLE_STATES = new Set(['idle', 'schedIdle', 'heating', 'preheating']);

export interface MachineControlInput {
  /** From ws/v1/devices only. */
  connected: boolean;
  state: string | null;
  scaleConnected: boolean;
  /** Null until GET /machine/info has answered once. */
  hasGhc: boolean | null;
  pending: PendingCommand | null;
}

export interface MachineControlModel {
  /** Something runs that Stop ends: a known drink or cycle, or a state CafAI does not know (D97). */
  running: boolean;
  /** False on a GHC machine: its start buttons are physical. */
  startsVisible: boolean;
  startsEnabled: boolean;
  /** Why the starts are unavailable (or the GHC hint), as a sentence. */
  startReason: string | null;
  stopEnabled: boolean;
  stopProminent: boolean;
  sleepWake: { command: 'sleeping' | 'idle'; label: 'Sleep' | 'Wake'; enabled: boolean };
  tareEnabled: boolean;
  tareReason: string | null;
}

function blockedStartReason(state: string | null): string {
  if (state === null || state === '') return 'Waiting for the machine to report its state.';
  if (state === 'sleeping') return 'The machine is asleep. Tap Wake first.';
  if (state === 'needsWater') return 'Refill the water tank to continue.';
  if (state === 'error') return 'The machine reports an error. Check it first.';
  return 'The machine is busy. Wait for it to finish.';
}

export function machineControls(input: MachineControlInput): MachineControlModel {
  const { connected, scaleConnected, pending } = input;
  // A frame left over from before a disconnect describes nothing real.
  const state = connected ? input.state : null;
  const running = connected && isStoppableMachineState(state);
  const ghc = input.hasGhc === true;
  const startable = connected && state !== null && STARTABLE_STATES.has(state);
  // Sleep would interrupt these just as Stop would.
  const untouchable = state !== null && DO_NOT_INTERRUPT_STATES.has(state);

  let startReason: string | null = null;
  if (ghc) startReason = 'Start on the machine';
  else if (!connected) startReason = 'Not connected. Wake the DE1 and pair it in Decaid.';
  // While a known drink runs, Stop in its place says it all; an unknown state still gets the reason.
  else if (!isRunningMachineState(state) && !startable) startReason = blockedStartReason(state);

  const asleep = state === 'sleeping';
  return {
    running,
    startsVisible: !ghc,
    startsEnabled: !ghc && startable && !running && pending === null,
    startReason,
    stopEnabled: running,
    stopProminent: running,
    sleepWake: {
      command: asleep ? 'idle' : 'sleeping',
      label: asleep ? 'Wake' : 'Sleep',
      enabled: connected && state !== null && !running && !untouchable && pending === null,
    },
    tareEnabled: scaleConnected && pending === null,
    tareReason: scaleConnected ? null : 'Connect a scale to tare.',
  };
}

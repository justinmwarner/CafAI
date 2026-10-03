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
 */
import type { CommandableState } from '../../api/types.ts';

export type StartCommand = 'espresso' | 'steam' | 'flush' | 'hotWater';

/** A command the panel can have in flight. */
export type PendingCommand = CommandableState | 'tare';

/** States that Stop (PUT state `idle`) ends. */
const RUNNING_STATES = new Set([
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

/** States a start command may be sent from. Anything else is refused with a reason. */
const STARTABLE_STATES = new Set(['idle', 'schedIdle', 'heating', 'preheating']);

export function isRunningMachineState(state: string | null | undefined): boolean {
  return typeof state === 'string' && RUNNING_STATES.has(state);
}

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
  const running = connected && isRunningMachineState(state);
  const ghc = input.hasGhc === true;
  const startable = connected && state !== null && STARTABLE_STATES.has(state);

  let startReason: string | null = null;
  if (ghc) startReason = 'Start on the machine';
  else if (!connected) startReason = 'Not connected. Wake the DE1 and pair it in Decaid.';
  else if (!running && !startable) startReason = blockedStartReason(state);

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
      enabled: connected && state !== null && !running && pending === null,
    },
    tareEnabled: scaleConnected && pending === null,
    tareReason: scaleConnected ? null : 'Connect a scale to tare.',
  };
}

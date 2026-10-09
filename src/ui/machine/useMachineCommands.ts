/**
 * Sending the machine's commands, for every button that sends one: the top
 * bar's machine row and the stats card. Water moves when these run, so a
 * command is only ever sent from a tap, never retried on its own, and a
 * failure is kept as a sentence (MachineAlerts shows it) until the next
 * command or a dismissal, never swallowed.
 *
 * One command in flight for the whole app, not one per group of buttons: a
 * start in flight from the row holds the card's Sleep and Tare too, instead
 * of queueing presses. Stop is the exception: it is never blocked.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { DecaidClient } from '../../api/types.ts';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { machineControls, type MachineControlModel, type PendingCommand, type StartCommand } from './commands.ts';
import { useHasGhc } from './useHasGhc.ts';

export interface MachineCommandsState {
  /** The command in flight, if any. */
  pending: PendingCommand | null;
  /** The last command's failure, as a sentence a barista can act on. */
  error: string | null;
}

export interface MachineCommands {
  /** The same object until something in it changes, as useSyncExternalStore needs. */
  getState(): MachineCommandsState;
  subscribe(listener: () => void): () => void;
  /** Sends `command` unless another is in flight (Stop always goes); a failure reads `failure` and then Decaid's reason. */
  send(command: PendingCommand, failure: string): Promise<void>;
  /** The barista closed the failure. */
  dismiss(): void;
}

const START_FAILURES: Record<StartCommand, string> = {
  espresso: "Couldn't start the shot.",
  steam: "Couldn't start steam.",
  flush: "Couldn't start the flush.",
  hotWater: "Couldn't start hot water.",
};

function errorText(cause: unknown, failure: string): string {
  // GatewayError.message is already a sentence a barista can act on.
  const detail = cause instanceof Error && cause.message.trim() ? cause.message.trim() : 'Try again.';
  return `${failure} ${detail}`;
}

export function createMachineCommands(decaid: DecaidClient): MachineCommands {
  let state: MachineCommandsState = { pending: null, error: null };
  let latest = 0;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<MachineCommandsState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async send(command, failure) {
      // Stop is never queued behind another command. The state is set before
      // the request goes, so a fast double tap that lands before React
      // re-renders still sends once.
      if (state.pending !== null && command !== 'idle') return;
      const id = ++latest;
      set({ pending: command, error: null });
      let error: string | null = null;
      try {
        if (command === 'tare') await decaid.tareScale();
        else await decaid.setMachineState(command);
      } catch (cause) {
        error = errorText(cause, failure);
      }
      // A Stop sent meanwhile owns the state now.
      if (id === latest) set({ pending: null, error });
    },
    dismiss() {
      if (state.error !== null) set({ error: null });
    },
  };
}

const stores = new WeakMap<DecaidClient, MachineCommands>();

/** The app's one command sender for a Decaid client, for as long as the client lives. */
export function machineCommandsFor(decaid: DecaidClient): MachineCommands {
  let store = stores.get(decaid);
  if (!store) {
    store = createMachineCommands(decaid);
    stores.set(decaid, store);
  }
  return store;
}

function useCommandsStore(): MachineCommands {
  const { decaid } = useServices();
  return useMemo(() => machineCommandsFor(decaid), [decaid]);
}

/** The last command's failure and the way to close it, for the alert that shows it. */
export function useCommandError(): { error: string | null; dismiss: () => void } {
  const store = useCommandsStore();
  const error = useSyncExternalStore(store.subscribe, () => store.getState().error);
  return { error, dismiss: store.dismiss };
}

export interface MachineCommandsView {
  /** Which controls are live (commands.ts). */
  model: MachineControlModel;
  /** The machine's state while it is connected; null otherwise. */
  state: string | null;
  pending: PendingCommand | null;
  error: string | null;
  start(command: StartCommand): void;
  stop(): void;
  /** Puts an awake machine to sleep, wakes a sleeping one (the model's sleepWake). */
  sleepWake(): void;
  tare(): void;
  dismiss(): void;
}

export function useMachineCommands(): MachineCommandsView {
  const store = useCommandsStore();
  const { pending, error } = useSyncExternalStore(store.subscribe, store.getState);
  const connected = useTelemetry((s) => s.machineConnected);
  const state = useTelemetry((s) => s.machine?.state?.state ?? null);
  const scaleConnected = useTelemetry((s) => s.scaleConnected);
  const hasGhc = useHasGhc();
  const model = machineControls({ connected, state, scaleConnected, hasGhc, pending });
  const wake = model.sleepWake.label === 'Wake';
  return {
    model,
    // A frame left over from before a disconnect describes nothing real.
    state: connected ? state : null,
    pending,
    error,
    start: (command) => void store.send(command, START_FAILURES[command]),
    stop: () => void store.send('idle', "Couldn't stop the machine."),
    sleepWake: () =>
      void store.send(model.sleepWake.command, wake ? "Couldn't wake the machine." : "Couldn't put the machine to sleep."),
    tare: () => void store.send('tare', "Couldn't tare the scale."),
    dismiss: store.dismiss,
  };
}

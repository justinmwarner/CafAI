/**
 * Connecting the machine or the scale from CafAI (spec 6.2): the machine
 * alert's Connect buttons, and the scale's revive when the machine wakes
 * (useScaleRevive.ts). One at a time for the whole app: Decaid has one
 * Bluetooth radio to scan with, and a second scan would only queue.
 *
 * connectKind (client.ts) looks with a scan that connects nothing, then
 * connects the one device, so the other is never disturbed. A tapped Connect
 * says how it went, in describeFailedConnect's words (src/api/devices.ts),
 * until the next try or the end of the problem; the revive, a try in the
 * background, says nothing.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { describeFailedConnect } from '../../api/devices.ts';
import type { DecaidClient, DeviceEntry } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';

export type DeviceKind = 'machine' | 'scale';

export interface DeviceConnectFailure {
  /** The device the Connect was for. */
  kind: DeviceKind;
  /** Why it did not connect, as a sentence. */
  text: string;
}

export interface DeviceConnectState {
  /** The device being looked for and connected, if any. */
  pending: DeviceKind | null;
  /** Why the last tapped Connect did not connect; null once another starts, or its device is back. */
  failure: DeviceConnectFailure | null;
}

export interface DeviceConnect {
  /** The same object until something in it changes, as useSyncExternalStore needs. */
  getState(): DeviceConnectState;
  subscribe(listener: () => void): () => void;
  /**
   * Looks for one device of `kind` and connects it, unless a connect is in
   * flight. True when Decaid lists it connected after. `quiet`: a try in the
   * background, which leaves `failure` as it was.
   */
  connect(kind: DeviceKind, options?: { quiet?: boolean }): Promise<boolean>;
  /** The device a failure was about is back: the failure is over. */
  clearFailure(kind: DeviceKind): void;
}

const NAMES: Record<DeviceKind, string> = { machine: 'the DE1', scale: 'the scale' };

function errorText(kind: DeviceKind, cause: unknown): string {
  // GatewayError.message is already a sentence a barista can act on.
  const detail = cause instanceof Error && cause.message.trim() ? cause.message.trim() : 'Try again.';
  return `Couldn't connect ${NAMES[kind]}. ${detail}`;
}

export function createDeviceConnect(decaid: Pick<DecaidClient, 'connectKind'>): DeviceConnect {
  let state: DeviceConnectState = { pending: null, failure: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DeviceConnectState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async connect(kind, options = {}) {
      if (state.pending !== null) return false;
      const quiet = options.quiet === true;
      // Set before the request goes, so a double tap that lands before React re-renders sends once.
      set(quiet ? { pending: kind } : { pending: kind, failure: null });
      let text: string;
      try {
        const after = await decaid.connectKind(kind);
        const devices: readonly DeviceEntry[] = Array.isArray(after) ? after : [];
        if (devices.some((device) => device.type === kind && device.state === 'connected')) {
          set({ pending: null });
          return true;
        }
        text = describeFailedConnect(kind, devices);
      } catch (cause) {
        text = errorText(kind, cause);
      }
      set(quiet ? { pending: null } : { pending: null, failure: { kind, text } });
      return false;
    },
    clearFailure(kind) {
      if (state.failure?.kind === kind) set({ failure: null });
    },
  };
}

const stores = new WeakMap<DecaidClient, DeviceConnect>();

/** The app's one connect store for a Decaid client, for as long as the client lives. */
export function deviceConnectFor(decaid: DecaidClient): DeviceConnect {
  let store = stores.get(decaid);
  if (!store) {
    store = createDeviceConnect(decaid);
    stores.set(decaid, store);
  }
  return store;
}

export interface DeviceConnectView extends DeviceConnectState {
  /** A tapped Connect: says how it went. */
  connect(kind: DeviceKind): void;
  clearFailure(kind: DeviceKind): void;
}

export function useDeviceConnect(): DeviceConnectView {
  const { decaid } = useServices();
  const store = useMemo(() => deviceConnectFor(decaid), [decaid]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, connect: (kind) => void store.connect(kind), clearFailure: store.clearFailure };
}

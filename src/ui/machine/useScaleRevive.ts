/**
 * Bringing the scale back when the machine wakes (spec 6.2, decaid-zen's
 * rule). A scale often stays asleep, or out of Decaid's reach, after the DE1
 * wakes, and the coach needs the weights. So when the machine leaves sleep
 * or the page comes back into view, and no scale is connected though one was
 * this session, CafAI looks for it once (deviceConnect.ts, quietly: a scale
 * it cannot find says nothing). Only Decaid's preferred scale: no one tapped
 * anything, and connecting another would make it Decaid's preferred one
 * (D98). At most every 30 s, and only while the machine is awake and at
 * rest: never during a shot, steam, hot water or flush.
 *
 * It waits a few seconds first. Decaid watches for its preferred scale after
 * a wake and may well have it back by then, and a scan in the first seconds
 * after a wake upsets Bluetooth (streamline's notes); after the page comes
 * back, the sockets get the same moment to say how things are.
 */
import { useEffect, useMemo } from 'react';
import { AT_REST_STATES } from '../../api/machineStates.ts';
import type { TelemetryState } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import { deviceConnectFor } from './deviceConnect.ts';

/** Between two looks for the scale. */
export const REVIVE_EVERY_MS = 30_000;
/** From the wake, or the page coming back, to the look. */
export const REVIVE_DELAY_MS = 5_000;

/** The machine's state while it is connected; null otherwise. */
const machineState = (s: TelemetryState) => (s.machineConnected ? (s.machine?.state?.state ?? null) : null);

/** Awake and at rest: nothing running that a scan could upset. */
const awakeAtRest = (state: string | null) => state !== null && state !== 'sleeping' && AT_REST_STATES.has(state);

export function useScaleRevive(): void {
  const { decaid, telemetry } = useServices();
  const connector = useMemo(() => deviceConnectFor(decaid), [decaid]);

  useEffect(() => {
    let scaleSeen = telemetry.getState().scaleConnected;
    // The last state the machine reported while connected: one that dropped off asleep and comes back awake has woken.
    let lastState = machineState(telemetry.getState());
    let lastLook = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const look = () => {
      timer = null;
      const s = telemetry.getState();
      if (!scaleSeen || s.scaleConnected || !awakeAtRest(machineState(s))) return;
      if (Date.now() - lastLook < REVIVE_EVERY_MS || connector.getState().pending !== null) return;
      lastLook = Date.now();
      void connector.connect('scale', { quiet: true, preferredOnly: true });
    };
    const soon = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(look, REVIVE_DELAY_MS);
    };
    const onChange = () => {
      const s = telemetry.getState();
      if (s.scaleConnected) scaleSeen = true;
      const state = machineState(s);
      if (state === null) return;
      if (lastState === 'sleeping' && state !== 'sleeping') soon();
      lastState = state;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') soon();
    };

    const unsubscribe = telemetry.subscribe(onChange);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) clearTimeout(timer);
    };
  }, [telemetry, connector]);
}

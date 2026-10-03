import { useEffect, useState } from 'react';
import { useServices, useTelemetry } from '../../app/services.tsx';
import { loadKnownGhc, saveKnownGhc } from './ghcCache.ts';

/**
 * Whether the connected machine has a group-head controller: the cached
 * answer at once, then GET /machine/info each time the machine connects.
 * Null until either is known.
 */
export function useHasGhc(): boolean | null {
  const { decaid } = useServices();
  const connected = useTelemetry((state) => state.machineConnected);
  const [hasGhc, setHasGhc] = useState<boolean | null>(() => loadKnownGhc());

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    decaid.getMachineInfo().then(
      (info) => {
        if (cancelled) return;
        const next = info.GHC === true;
        saveKnownGhc(next);
        setHasGhc(next);
      },
      () => {
        // An older Decaid or a machine that dropped mid-request: keep what we knew.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connected, decaid]);

  return hasGhc;
}

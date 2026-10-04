import { useEffect, useRef, useState } from 'react';
import { useCoach, useServices, useTelemetry } from '../../app/services.tsx';
import { createRefresher, isActiveBagVersion, readLoadedProfile, type LoadedProfileReading, type Refresher } from './loadedProfileModel.ts';

/** How long the coach must be quiet before the workflow is read again. */
export const LOADED_PROFILE_DEBOUNCE_MS = 500;
/** Another skin or the machine's own screen can change the profile at any time. */
export const LOADED_PROFILE_POLL_MS = 30_000;

export interface LoadedProfileState {
  /** The title of the profile in Decaid's workflow; null until a read succeeds. */
  title: string | null;
  /** The workflow carries the active bag's version: CafAI's tag names it and the titles match. */
  thisBag: boolean;
}

/**
 * The profile Decaid's workflow carries (D66). Decaid has no workflow stream,
 * so it is read on mount, after the coach acts (a new active version, bag or
 * chat message, debounced), when a shot finishes, when the machine connects,
 * and every 30 s while the page is visible. One request at a time; a failed
 * read keeps what was there and says nothing.
 */
export function useLoadedProfile(): LoadedProfileState {
  const { decaid, telemetry } = useServices();
  const connected = useTelemetry((s) => s.machineConnected);
  const versionId = useCoach((s) => s.activeVersion?.id ?? null);
  const versionTitle = useCoach((s) => s.activeVersion?.title ?? null);
  const bagId = useCoach((s) => s.activeBag?.id ?? null);
  // Changes when a message arrives or the last one is replaced, not while it streams.
  const chat = useCoach((s) => `${s.messages.length}:${s.messages[s.messages.length - 1]?.id ?? ''}`);
  const [reading, setReading] = useState<LoadedProfileReading | null>(null);
  const refresher = useRef<Refresher | null>(null);

  useEffect(() => {
    let mounted = true;
    const reads = createRefresher(
      () =>
        decaid.getWorkflow().then((workflow) => {
          if (mounted) setReading(readLoadedProfile(workflow));
        }),
      LOADED_PROFILE_DEBOUNCE_MS,
    );
    refresher.current = reads;
    reads.now();

    const stopShots = telemetry.onShot((event) => {
      if (event.type === 'finished') reads.now();
    });
    const poll = setInterval(() => {
      if (document.visibilityState !== 'hidden') reads.now();
    }, LOADED_PROFILE_POLL_MS);
    // Back from the background: catch up now rather than at the next tick.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reads.now();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      reads.dispose();
      refresher.current = null;
      stopShots();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [decaid, telemetry]);

  const coachKey = `${versionId ?? ''}|${bagId ?? ''}|${chat}`;
  const lastCoachKey = useRef(coachKey);
  useEffect(() => {
    if (coachKey === lastCoachKey.current) return;
    lastCoachKey.current = coachKey;
    refresher.current?.soon();
  }, [coachKey]);

  // Decaid loads the workflow's profile when the machine connects.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresher.current?.now();
    wasConnected.current = connected;
  }, [connected]);

  return {
    title: reading?.title ?? null,
    thisBag: reading !== null && isActiveBagVersion(reading, { bagId, versionId, title: versionTitle }),
  };
}

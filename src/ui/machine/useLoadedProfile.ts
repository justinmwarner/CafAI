import { useEffect, useRef, useState } from 'react';
import { useCoach, useServices, useTelemetry } from '../../app/services.tsx';
import {
  createRefresher,
  isActiveBagVersion,
  profileMark,
  profileStepNames,
  readLoadedProfile,
  sameStepNames,
  type LoadedProfileReading,
  type ProfileMark,
  type Refresher,
} from './loadedProfileModel.ts';

/** Another skin or the machine's own screen can change the profile at any time. */
export const LOADED_PROFILE_POLL_MS = 30_000;

export interface LoadedProfileState {
  /** The title of the profile in Decaid's workflow; null until a read succeeds. */
  title: string | null;
  /** Beside the title: the bag's version on the machine, on its way there, or not confirmed. */
  mark: ProfileMark;
  /** The same profile's step names, in order; null until a read finds steps. Kept while the content is the same. */
  stepNames: readonly string[] | null;
}

/**
 * The profile Decaid's workflow carries (D66). Decaid has no workflow stream,
 * so it is read on mount, at once when CafAI changes it (another bag or
 * version, or a load: Retry loads the same version again), when a shot
 * finishes, when the machine connects, and on the engine's beat (machineTick:
 * every 30 s while the page is visible, and when it comes back into view).
 * A profile loaded behind CafAI's back shows on that beat, when the engine
 * looks for it too, so this line and the Retry banner change together (D70);
 * a chat message is no reason to read, or the line would run ahead of the
 * banner. A coach that keeps no beat gets a 30 s clock of the line's own. One
 * request at a time; a failed read keeps what was there and says nothing.
 * The same read gives the profile's step names, so the state line can name
 * the running step without a read of its own.
 */
export function useLoadedProfile(): LoadedProfileState {
  const { decaid, telemetry } = useServices();
  const connected = useTelemetry((s) => s.machineConnected);
  const versionId = useCoach((s) => s.activeVersion?.id ?? null);
  const versionTitle = useCoach((s) => s.activeVersion?.title ?? null);
  const bagId = useCoach((s) => s.activeBag?.id ?? null);
  const load = useCoach((s) => s.activeLoad);
  const beat = useCoach((s) => s.machineTick);
  const ownClock = beat === undefined;
  const [reading, setReading] = useState<LoadedProfileReading | null>(null);
  const [stepNames, setStepNames] = useState<readonly string[] | null>(null);
  const refresher = useRef<Refresher | null>(null);
  const isBagVersion = reading !== null && isActiveBagVersion(reading, { bagId, versionId, title: versionTitle });

  useEffect(() => {
    let mounted = true;
    const reads = createRefresher(
      () =>
        decaid.getWorkflow().then((workflow) => {
          if (!mounted) return;
          setReading(readLoadedProfile(workflow));
          const names = profileStepNames(workflow);
          setStepNames((current) => (sameStepNames(current, names) ? current : names));
        }),
      // Every read here is wanted at once; nothing asks for a debounced one.
      0,
    );
    refresher.current = reads;
    reads.now();

    const stopShots = telemetry.onShot((event) => {
      if (event.type === 'finished') reads.now();
    });

    return () => {
      mounted = false;
      reads.dispose();
      refresher.current = null;
      stopShots();
    };
  }, [decaid, telemetry]);

  // A coach that keeps no beat (a fake in tests and previews): a clock of our own.
  useEffect(() => {
    if (!ownClock) return;
    const poll = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresher.current?.now();
    }, LOADED_PROFILE_POLL_MS);
    // Back from the background: catch up now rather than at the next tick.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresher.current?.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ownClock]);

  const lastBeat = useRef(beat);
  useEffect(() => {
    if (beat === lastBeat.current) return;
    lastBeat.current = beat;
    refresher.current?.now();
  }, [beat]);

  // CafAI's own change shows at once. A load of the version the line already
  // shows (the machine confirming it, Retry after it was not confirmed) cannot
  // change the title, so that is not read again: anything else that changed
  // meanwhile came from behind CafAI's back and shows on the beat, with the banner.
  const coachKey = `${bagId ?? ''}|${versionId ?? ''}|${load ?? ''}`;
  const lastCoachKey = useRef(coachKey);
  useEffect(() => {
    if (coachKey === lastCoachKey.current) return;
    lastCoachKey.current = coachKey;
    if (!isBagVersion) refresher.current?.now();
  }, [coachKey, isBagVersion]);

  // Decaid loads the workflow's profile when the machine connects.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresher.current?.now();
    wasConnected.current = connected;
  }, [connected]);

  return {
    title: reading?.title ?? null,
    mark: profileMark(isBagVersion, load, connected),
    stepNames,
  };
}

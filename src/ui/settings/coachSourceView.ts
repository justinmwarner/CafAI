/**
 * Where the coach runs, as the screens show it (Settings > Where the coach
 * runs, src/storage/coachSource.ts). While it runs on the user's computer the
 * API key is not used and the model's prices do not apply, and the engine's
 * hasApiKey means "has CafAI Bridge's code" (src/app/coachAccess.ts), so
 * whether a key is saved is read from the key store itself.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import type { CoachSource, CoachSourceKind } from '../../storage/coachSource.ts';

interface SourceView {
  kind: CoachSourceKind;
  /** An API key is saved on this device. */
  keySaved: boolean;
}

/**
 * The saved choice and whether a key is saved, read together and again with
 * every choice saved from now on. Null without the store, and until read.
 */
function useSourceView(): SourceView | null {
  const { coachSource, storage } = useServices();
  const [view, setView] = useState<SourceView | null>(null);
  useEffect(() => {
    if (!coachSource) return undefined;
    let live = true;
    let latest = 0;
    const read = (saved?: CoachSource) => {
      const ticket = ++latest;
      const key = storage.secrets.getApiKey().catch(() => null);
      Promise.all([saved ?? coachSource.get(), key]).then(
        ([source, apiKey]) => {
          if (live && ticket === latest) setView({ kind: source.kind, keySaved: apiKey !== null && apiKey.trim() !== '' });
        },
        () => undefined,
      );
    };
    read();
    const stop = coachSource.subscribe(read);
    return () => {
      live = false;
      stop();
    };
  }, [coachSource, storage]);
  return view;
}

/** What the engine says when no key is there (src/app/engine/engine.ts runModel), worded for an API key. */
const ENGINE_NEEDS_KEY = 'Add your Anthropic API key';
export const BRIDGE_NEEDS_CODE = 'Add the code CafAI Bridge shows on your computer in Settings > Coach to start coaching.';

/**
 * The coach's error as the banner shows it: while the coach runs on the
 * computer, what is missing is CafAI Bridge's code, not an API key (the
 * engine's own sentence stays as it is, so it still clears itself once the
 * code is saved).
 */
export function coachErrorFor(error: string, onComputer: boolean): string {
  return onComputer && error.startsWith(ENGINE_NEEDS_KEY) ? BRIDGE_NEEDS_CODE : error;
}

/** True while the coach runs on the user's computer; false without the store, and until it has been read. */
export function useCoachRunsOnComputer(): boolean {
  return useSourceView()?.kind === 'computer';
}

/**
 * Whether Settings shows the API key (D140): only while the coach runs on
 * Anthropic, so the key's field and the bridge's address and code take turns
 * with the choice. Not until the choice has been read, so the wrong fields
 * never flash up; always without the store (fakes, previews), where the coach
 * runs on Anthropic.
 */
export function useShowsApiKey(): boolean {
  const { coachSource } = useServices();
  const view = useSourceView();
  if (!coachSource) return true;
  return view !== null && view.kind !== 'computer';
}

/**
 * For the API key section: whether the coach runs on the computer, and
 * whether a key is saved here. `engineHasKey` is the engine's hasApiKey,
 * which means just that while the coach runs on Anthropic.
 */
export function useApiKeyView(engineHasKey: boolean): { onComputer: boolean; keySaved: boolean } {
  const view = useSourceView();
  if (view === null || view.kind !== 'computer') return { onComputer: false, keySaved: engineHasKey };
  return { onComputer: true, keySaved: view.keySaved };
}

/**
 * What Settings' status lines (groupStatus.ts, D236) read that no store
 * shares already. The lines never ask Decaid for anything themselves, and
 * never poll.
 *
 * - The settings, as Settings' own cards last read or saved them.
 *   SettingsScreen.tsx hands its cards a repository that passes every read and
 *   save through and tells the list what each one returned (watchSettings), so
 *   the Coach and Grinder lines follow a model or a grinder the moment it is
 *   saved beside them, with one read of their own as Settings opens.
 * - What the Drinks and Machine groups read from Decaid: the drinks' presets
 *   (useDrinkPresets.ts, Settings > Drinks and each drink's view) and the
 *   sleep and wake settings (usePresence.ts, Settings > Machine), kept per
 *   Decaid client for this page's life, as Decaid's version is
 *   (decaidVersion.ts). The Drinks and Machine lines say them once a group or
 *   a view has read them, and the groups' plain contents until then.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { DecaidClient, PresenceSettings } from '../../api/types.ts';
import { useServices } from '../../app/services.tsx';
import type { Settings, SettingsRepository } from '../../storage/types.ts';
import type { Presets } from './DrinkFields.tsx';

export interface SettingsWatch {
  /** The repository Settings' cards read and save through: the screen's own, with the list told of each answer. */
  repository: SettingsRepository;
  /** The settings as the newest read or save returned them; null before any came back. */
  current(): Settings | null;
  subscribe(listener: () => void): () => void;
}

/**
 * Watch the reads and saves made through a repository. Each call keeps its
 * place in line, so a read that was sent before a save and answers after it
 * never puts back what the save replaced. The repository underneath is
 * called as it is at the time, never as it was when the watch began.
 */
export function watchSettings(repository: SettingsRepository): SettingsWatch {
  let current: Settings | null = null;
  let sent = 0;
  let shown = 0;
  const listeners = new Set<() => void>();
  const keep = (ticket: number) => (settings: Settings) => {
    if (ticket > shown) {
      shown = ticket;
      current = settings;
      for (const listener of [...listeners]) listener();
    }
    return settings;
  };
  return {
    repository: {
      get: () => repository.get().then(keep(++sent)),
      update: (patch) => repository.update(patch).then(keep(++sent)),
    },
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The screen's watch, for the list's status lines; none outside SettingsScreen (a list alone, in a test). */
export const SettingsWatchContext = createContext<SettingsWatch | null>(null);

const unchanging = () => () => undefined;
const nothing = () => null;

/**
 * The settings for the status lines: the screen's watch, read once as the
 * list mounts, then whatever its cards read and save; without a watch, one
 * read of its own. Null until read, and when they cannot be.
 */
export function useWatchedSettings(): Settings | null {
  const watch = useContext(SettingsWatchContext);
  const { storage } = useServices();
  const watched = useSyncExternalStore(watch?.subscribe ?? unchanging, watch?.current ?? nothing);
  const [own, setOwn] = useState<Settings | null>(null);
  useEffect(() => {
    let live = true;
    (watch ? watch.repository : storage.settings).get().then(
      (settings) => {
        if (live && !watch) setOwn(settings);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [watch, storage]);
  return watch ? watched : own;
}

const presetsSeen = new WeakMap<DecaidClient, Presets>();
const presenceSeen = new WeakMap<DecaidClient, PresenceSettings>();
const listeners = new Set<() => void>();

function told(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The drinks' presets as a screen last read or wrote them (useDrinkPresets.ts). */
export function keepDrinkPresets(decaid: DecaidClient, presets: Presets): void {
  if (presetsSeen.get(decaid) === presets) return;
  presetsSeen.set(decaid, presets);
  told();
}

/** Decaid's sleep and wake settings as Settings > Machine last read or wrote them (usePresence.ts). */
export function keepPresence(decaid: DecaidClient, presence: PresenceSettings): void {
  if (presenceSeen.get(decaid) === presence) return;
  presenceSeen.set(decaid, presence);
  told();
}

/** The drinks' presets kept in this page's life, or null while no screen has read them. */
export function useKeptDrinkPresets(): Presets | null {
  const { decaid } = useServices();
  return useSyncExternalStore(subscribe, () => presetsSeen.get(decaid) ?? null);
}

/** The sleep and wake settings kept in this page's life, or null while Settings > Machine has not read them. */
export function useKeptPresence(): PresenceSettings | null {
  const { decaid } = useServices();
  return useSyncExternalStore(subscribe, () => presenceSeen.get(decaid) ?? null);
}

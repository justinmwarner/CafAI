/**
 * Whether Overhead is on (DECISIONS O17): its plugin answers in Decaid, and
 * its own setting says to show it when idle. Read from the plugin's
 * `config` at start, every READ_EVERY_MS after and when the page comes back
 * into view; a failed read keeps the last answer, and before any answer it is
 * off, so a CafAI without the plugin behaves exactly as before.
 *
 * One store for the page: the classic screensaver asks it whether to stand
 * down (useOverheadTakesOver), the Overhead overlay and its settings section
 * share it.
 */
import { useSyncExternalStore } from 'react';
import { readSettings, type OverheadSettings } from '../shared/settings.ts';
import type { OverheadClient } from './client.ts';

export const READ_EVERY_MS = 2 * 60_000;

export interface Availability {
  /** The plugin answered its config, this many ms since the epoch; null before it ever did. */
  readAt: number | null;
  /** The settings it answered; null before it did. */
  settings: OverheadSettings | null;
  /** The last read failed: why. */
  error: string | null;
}

export interface AvailabilityStore {
  get(): Availability;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Shows settings just saved, without waiting for the next read. */
  set(settings: OverheadSettings): void;
  /** Keeps reading; answers the function that stops. */
  start(): () => void;
}

const NONE: Availability = { readAt: null, settings: null, error: null };

export function createAvailabilityStore(client: Pick<OverheadClient, 'config'>): AvailabilityStore {
  let state = NONE;
  const listeners = new Set<() => void>();
  let latest = 0;
  const publish = (next: Availability) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const store: AvailabilityStore = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async refresh() {
      const read = ++latest;
      try {
        const values = await client.config();
        if (read === latest) publish({ readAt: Date.now(), settings: readSettings(values), error: null });
      } catch (error) {
        if (read === latest) publish({ ...state, error: error instanceof Error ? error.message : String(error) });
      }
    },
    set(settings) {
      latest += 1;
      publish({ readAt: Date.now(), settings, error: null });
    },
    start() {
      void store.refresh();
      const timer = setInterval(() => void store.refresh(), READ_EVERY_MS);
      const onVisible = () => {
        if (document.visibilityState === 'visible') void store.refresh();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
  return store;
}

/** Overhead covers CafAI when idle: its plugin answered and its setting is on. */
export function overheadOn(availability: Availability): boolean {
  return availability.settings !== null && availability.settings.screensaverOn && availability.error === null;
}

let pageStore: AvailabilityStore | null = null;
const pageListeners = new Set<() => void>();
let unsubscribePage: (() => void) | null = null;

const notifyPage = () => {
  for (const listener of [...pageListeners]) listener();
};

/** Makes `store` the page's (the Overhead overlay, in an effect); answers the function that takes it back. */
export function registerPageAvailability(store: AvailabilityStore): () => void {
  unsubscribePage?.();
  pageStore = store;
  unsubscribePage = store.subscribe(notifyPage);
  notifyPage();
  return () => {
    if (pageStore !== store) return;
    unsubscribePage?.();
    unsubscribePage = null;
    pageStore = null;
    notifyPage();
  };
}

const subscribePage = (listener: () => void) => {
  pageListeners.add(listener);
  return () => void pageListeners.delete(listener);
};

/** For the classic screensaver (D223): Overhead is on, so it stands down. False without Overhead's overlay on the page. */
export function useOverheadTakesOver(): boolean {
  return useSyncExternalStore(subscribePage, () => (pageStore ? overheadOn(pageStore.get()) : false));
}

/** For tests: forgets the page's store. */
export function resetPageAvailabilityForTests(): void {
  unsubscribePage?.();
  unsubscribePage = null;
  pageStore = null;
}

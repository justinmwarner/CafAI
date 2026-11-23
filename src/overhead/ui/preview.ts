/**
 * Overhead's Preview (Settings › Display › Overhead), and in mock builds the
 * `?overheadPreview=1` switch the screenshots use: it shows the screensaver
 * anywhere, never dims or holds the screen, and a tap closes it.
 */
import { useSyncExternalStore } from 'react';

export interface OverheadPreviewRequest {
  /** Ask the plugin for its recorded replay (?mock=1) rather than live data. */
  mock: boolean;
}

export interface OverheadPreviewStore {
  get(): OverheadPreviewRequest | null;
  show(request: OverheadPreviewRequest): void;
  hide(): void;
  subscribe(listener: () => void): () => void;
}

export function createOverheadPreview(): OverheadPreviewStore {
  let current: OverheadPreviewRequest | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: OverheadPreviewRequest | null) => {
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => current,
    show: (request) => publish({ ...request }),
    hide: () => {
      if (current !== null) publish(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const overheadPreview: OverheadPreviewStore = createOverheadPreview();

export function useOverheadPreview(store: OverheadPreviewStore = overheadPreview): OverheadPreviewRequest | null {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** `?overheadPreview=1` (live) or `?overheadPreview=mock`, read in mock builds only. */
export function overheadPreviewFromUrl(search: string): OverheadPreviewRequest | null {
  const value = new URLSearchParams(search).get('overheadPreview');
  if (value === '1') return { mock: false };
  if (value === 'mock') return { mock: true };
  return null;
}

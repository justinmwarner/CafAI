/**
 * Settings > Screensaver's Preview (D225): the screensaver to show now,
 * full screen, anywhere (a phone and a computer too). The overlay
 * (SaverOverlay.tsx) shows it until a tap closes it; a preview never dims
 * the screen, never holds it on and never wakes the machine.
 *
 * In mock builds only, `?saverPreview=<id>&saverAt=<ms>` opens one at start,
 * stepped to that moment and held, for the screenshot scene and the
 * Chromium 91 smoke test (previewFromUrl; SaverOverlay reads it).
 */
import { useSyncExternalStore } from 'react';
import { isSaverId } from './registry.ts';
import type { SaverId } from './types.ts';

export interface SaverPreviewRequest {
  id: SaverId;
  /** The seed: the day's number when it was asked for, as the day's screensaver has. */
  seed: number;
  /** Stepped to this moment (ms) and held; null runs it. */
  at: number | null;
}

export interface SaverPreviewStore {
  show(id: SaverId, options?: { seed?: number; at?: number | null }): void;
  hide(): void;
  /** The screensaver previewed, or null. */
  current(): SaverId | null;
  /** The whole request, the same object until another show or a hide. */
  request(): SaverPreviewRequest | null;
  subscribe(listener: () => void): () => void;
}

export function createSaverPreview(): SaverPreviewStore {
  let current: SaverPreviewRequest | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    show(id, options = {}) {
      const at = options.at;
      current = {
        id,
        seed: options.seed ?? 1,
        at: typeof at === 'number' && Number.isFinite(at) && at >= 0 ? at : null,
      };
      tell();
    },
    hide() {
      if (current === null) return;
      current = null;
      tell();
    },
    current: () => current?.id ?? null,
    request: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The app's one Preview. */
export const saverPreview: SaverPreviewStore = createSaverPreview();

/** The preview asked for, or null. */
export function usePreviewedSaver(store: SaverPreviewStore = saverPreview): SaverPreviewRequest | null {
  return useSyncExternalStore(store.subscribe, store.request);
}

/** `?saverPreview=<id>&saverAt=<ms>`: the preview a mock build opens at start, or null. */
export function previewFromUrl(search: string): { id: SaverId; at: number | null } | null {
  const params = new URLSearchParams(search);
  const id = params.get('saverPreview');
  if (!isSaverId(id)) return null;
  const atText = params.get('saverAt')?.trim() ?? '';
  const at = Number(atText);
  return { id, at: atText !== '' && Number.isFinite(at) && at >= 0 ? at : null };
}

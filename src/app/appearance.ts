/**
 * The appearance setting as live state. A change shows at once (the theme
 * re-renders) and is saved with the other settings, so it is mirrored to
 * Decaid and exported like them.
 */
import { DEFAULT_APPEARANCE, normalizeAppearance, sameAppearance } from '../storage/index.ts';
import type { Appearance, SettingsRepository } from '../storage/types.ts';

export interface AppearanceStore {
  get(): Appearance;
  subscribe(listener: () => void): () => void;
  /** Shows an appearance without saving it (the hue slider while it is dragged). */
  preview(next: Appearance): void;
  /** Shows and saves an appearance. A failed save rejects; the change stays on screen for this session. */
  set(next: Appearance): Promise<void>;
  /** Re-reads the saved appearance (after an import). */
  reload(): Promise<void>;
}

export function createAppearanceStore(settings: SettingsRepository, initial: Appearance = DEFAULT_APPEARANCE): AppearanceStore {
  let current = initial;
  let latest = 0;
  const listeners = new Set<() => void>();
  const show = (next: Appearance) => {
    if (sameAppearance(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    preview(next) {
      // A preview is a newer change too: a save landing mid-drag must not snap the look back.
      latest += 1;
      show(next);
    },
    async set(next) {
      const ticket = ++latest;
      show(next);
      const saved = await settings.update({ appearance: next });
      // A later change may have been made while this one was saving: that one wins.
      if (ticket === latest) show(normalizeAppearance(saved.appearance));
    },
    async reload() {
      show(normalizeAppearance((await settings.get()).appearance));
    },
  };
}

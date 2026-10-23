/**
 * Settings > Screensaver (D-SAVER-3) as live state, as the temperature unit
 * is (temperatureUnit.ts): a change applies at once (the overlay and the
 * section read it) and is saved with the other settings, so it is mirrored to
 * Decaid and exported like them.
 */
import { DEFAULT_SCREENSAVER, normalizeScreensaver } from '../storage/settings.ts';
import type { ScreensaverSetting, SettingsRepository } from '../storage/types.ts';

export interface ScreensaverSettingStore {
  /** The setting to act on: DEFAULT_SCREENSAVER until one was saved. The same object until it changes. */
  get(): ScreensaverSetting;
  subscribe(listener: () => void): () => void;
  /** Shows and saves a setting. A failed save rejects; the change stays on screen for this session. */
  set(next: ScreensaverSetting): Promise<void>;
  /** Re-reads the saved setting (after an import or a restore). */
  reload(): Promise<void>;
}

function same(a: ScreensaverSetting, b: ScreensaverSetting): boolean {
  return a.on === b.on && a.pick === b.pick;
}

/** `initial`: the saved setting, or none (the default). */
export function createScreensaverSettingStore(settings: SettingsRepository, initial?: ScreensaverSetting): ScreensaverSettingStore {
  let current = initial === undefined ? DEFAULT_SCREENSAVER : normalizeScreensaver(initial);
  let latest = 0;
  const listeners = new Set<() => void>();
  /** `saved`: the setting as saved, absent while none was made on this device. */
  const show = (saved: ScreensaverSetting | undefined) => {
    const next = saved === undefined ? DEFAULT_SCREENSAVER : normalizeScreensaver(saved);
    if (same(next, current)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async set(next) {
      const ticket = ++latest;
      show(next);
      const saved = await settings.update({ screensaver: { on: next.on, pick: next.pick } });
      // A later change may have been made while this one was saving: that one wins.
      if (ticket === latest) show(saved.screensaver);
    },
    async reload() {
      show((await settings.get()).screensaver);
    },
  };
}

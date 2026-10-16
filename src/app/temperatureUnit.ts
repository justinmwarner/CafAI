/**
 * The barista's temperature unit (D171, D172) as live state, as the
 * appearance is (appearance.ts): a change shows on every screen at once and
 * is saved with the other settings, so it is mirrored to Decaid and exported
 * like them. The coach's prompt reads it for every request (adapters.ts).
 */
import { DEFAULT_TEMPERATURE_UNIT, type TemperatureUnit } from '../coach/temperature.ts';
import type { SettingsRepository } from '../storage/types.ts';

export interface TemperatureUnitStore {
  get(): TemperatureUnit;
  subscribe(listener: () => void): () => void;
  /** Shows and saves a unit. A failed save rejects; the change stays on screen for this session. */
  set(next: TemperatureUnit): Promise<void>;
  /** Re-reads the saved unit (after an import or a restore). */
  reload(): Promise<void>;
}

/** `initial`: the saved choice, or none (°C). */
export function createTemperatureUnitStore(settings: SettingsRepository, initial?: TemperatureUnit): TemperatureUnitStore {
  let current = initial ?? DEFAULT_TEMPERATURE_UNIT;
  let latest = 0;
  const listeners = new Set<() => void>();
  const show = (next: TemperatureUnit) => {
    if (next === current) return;
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
      const saved = await settings.update({ temperatureUnit: next });
      // A later change may have been made while this one was saving: that one wins.
      if (ticket === latest) show(saved.temperatureUnit ?? DEFAULT_TEMPERATURE_UNIT);
    },
    async reload() {
      show((await settings.get()).temperatureUnit ?? DEFAULT_TEMPERATURE_UNIT);
    },
  };
}

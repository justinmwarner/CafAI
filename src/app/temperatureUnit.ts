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
  /** Whether a unit was chosen on this device: until then the coach's words show as written (D176). */
  chosen(): boolean;
  subscribe(listener: () => void): () => void;
  /** Shows and saves a unit. A failed save rejects; the change stays on screen for this session. */
  set(next: TemperatureUnit): Promise<void>;
  /** Re-reads the saved unit (after an import or a restore). */
  reload(): Promise<void>;
}

/** `initial`: the saved choice, or none (°C). */
export function createTemperatureUnitStore(settings: SettingsRepository, initial?: TemperatureUnit): TemperatureUnitStore {
  let current = initial ?? DEFAULT_TEMPERATURE_UNIT;
  let chosen = initial !== undefined;
  let latest = 0;
  const listeners = new Set<() => void>();
  /** `saved`: the unit as saved, absent while none was chosen. */
  const show = (saved: TemperatureUnit | undefined) => {
    const next = saved ?? DEFAULT_TEMPERATURE_UNIT;
    if (next === current && (saved !== undefined) === chosen) return;
    current = next;
    chosen = saved !== undefined;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => current,
    chosen: () => chosen,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async set(next) {
      const ticket = ++latest;
      show(next);
      const saved = await settings.update({ temperatureUnit: next });
      // A later change may have been made while this one was saving: that one wins.
      if (ticket === latest) show(saved.temperatureUnit);
    },
    async reload() {
      show((await settings.get()).temperatureUnit);
    },
  };
}

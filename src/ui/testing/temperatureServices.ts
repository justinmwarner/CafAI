/**
 * Fake services whose barista reads temperatures in `unit` (D-TEMP-2), as if
 * chosen in Settings. Tests only.
 */
import type { TemperatureUnit } from '../../coach/temperature.ts';
import { createFakeServices, type FakeServices } from './fakeServices.ts';

export function createFakeServicesIn(unit: TemperatureUnit, options: Parameters<typeof createFakeServices>[0] = {}): FakeServices {
  const settings = options.storage?.settings ?? { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null };
  return createFakeServices({ ...options, storage: { ...options.storage, settings: { ...settings, temperatureUnit: unit } } });
}

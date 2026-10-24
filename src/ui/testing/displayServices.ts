/**
 * Fake services with the clock and the TDS cell's switch (D245, D246): the
 * real store over the fake settings repository, its choices saved there as
 * if made in Settings. createFakeServices leaves the store out, and then
 * every screen reads 24-hour with the TDS cell shown. Tests only.
 */
import { createDisplayPrefsStore, type DisplayPrefsSaved, type DisplayPrefsStore } from '../../app/displayPrefs.ts';
import { createFakeServices, type FakeServices } from './fakeServices.ts';

export type FakeServicesShowing = FakeServices & { displayPrefs: DisplayPrefsStore };

export function createFakeServicesShowing(prefs: DisplayPrefsSaved = {}, options: Parameters<typeof createFakeServices>[0] = {}): FakeServicesShowing {
  const settings = options.storage?.settings ?? { model: 'claude-opus-5-5', grinderName: null, grinderSetting: null, activeBagId: null };
  const services = createFakeServices({ ...options, storage: { ...options.storage, settings: { ...settings, ...prefs } } });
  return Object.assign(services, { displayPrefs: createDisplayPrefsStore(services.storage.settings, prefs) });
}

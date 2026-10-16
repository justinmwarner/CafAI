/**
 * Fake services with a real care service over them, for the care UI's tests.
 * Not shipped: only tests import this file.
 */
import { createCareService } from '../../app/care/careService.ts';
import type { CareRecord, CareSettings } from '../../storage/types.ts';
import { createFakeServices, type FakeServices } from './fakeServices.ts';

export const DAY = 24 * 60 * 60 * 1000;

/** A step's record, marked done `daysAgo` days ago with Decaid's totals then. */
export function doneRecord(id: string, daysAgo: number, overrides: Partial<CareRecord> = {}): CareRecord {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString();
  return { id, doneAt: at, by: 'tick', countFrom: at, shotTotal: 100, steamTotal: 30, updatedAt: at, ...overrides };
}

export interface CareServices extends FakeServices {
  care: NonNullable<FakeServices['care']>;
}

/** The fake services with the care service started and its first count done. */
export async function servicesWithCare(options: { records?: CareRecord[]; shots?: number; steams?: number; settings?: Partial<CareSettings> } = {}): Promise<CareServices> {
  const services = createFakeServices();
  services.decaid.shotPage = { items: [], total: options.shots ?? 100, limit: 1, offset: 0 };
  services.decaid.steams = { ids: Array.from({ length: options.steams ?? 30 }, (_, i) => `steam-${i}`), latest: null };
  for (const record of options.records ?? []) await services.storage.care.put(record);
  if (options.settings) await services.storage.settings.update({ care: { water: null, filter: null, reminders: true, ...options.settings } });
  const care = createCareService({ storage: services.storage, decaid: services.decaid, telemetry: services.telemetry });
  await care.start();
  // The first count runs behind the start: wait for its records.
  for (let i = 0; i < 20 && care.getState().records.size < 9; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return Object.assign(services, { care });
}

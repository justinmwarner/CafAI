/**
 * Decaid's steam records, as the mock keeps them (D-CARE-9): one per
 * steaming, as SteamSequencer makes them (steam_sequencer.dart at aab5f93):
 * opened on the first frame in `steam` (the heater's warm-up included), with
 * the workflow as it stood then and a sample per frame, and kept once the
 * machine leaves `steam`; discarded when the machine goes away mid-steam.
 * The routes answer as steams_handler.dart does: the list newest first and
 * without measurements, the ids, the newest (200 null while there is none),
 * and one by id (404 {error} for an id Decaid does not have).
 */
import type { MachineSnapshot, Workflow } from '../../src/api/types.ts';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import { clone } from '../../src/util/clone.ts';
import { MockHttpError } from './errors.ts';

/** SteamSnapshot.toJson: the machine's frame and the milk probe's reading, null without a probe. */
export interface MockSteamSample {
  machine: MachineSnapshot;
  milkTemperature: number | null;
}

/** SteamRecord.toJson (steam_record.dart:20-28). */
export interface MockSteamRecord {
  id: string;
  /** When the steaming began: local, no zone. */
  timestamp: string;
  measurements: MockSteamSample[];
  workflow: Workflow;
  annotations?: Record<string, unknown>;
}

/** toJsonWithoutMeasurements (steam_record.dart:30-37). */
export type MockSteamSummary = Omit<MockSteamRecord, 'measurements'>;

export function steamWithoutMeasurements(record: MockSteamRecord): MockSteamSummary {
  const { measurements: _measurements, ...rest } = clone(record);
  return rest;
}

/** Newest first, as getAllSteams orders them (steam_dao.dart:23-27). */
export function newestSteamsFirst(records: readonly MockSteamRecord[]): MockSteamRecord[] {
  return [...records].sort((a, b) => parseDecaidTimestamp(b.timestamp) - parseDecaidTimestamp(a.timestamp));
}

export function steamNotFound(): MockHttpError {
  return new MockHttpError(404, { error: 'Steam record not found' });
}

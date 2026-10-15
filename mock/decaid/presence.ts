/**
 * Decaid's sleep and wake settings for the mock: PresenceHandler's checks and
 * replies, WakeSchedule.create, copyWith and toJson, and the keep-awake window
 * (aab5f93: lib/src/services/webserver/presence_handler.dart,
 * lib/src/models/wake_schedule.dart, lib/src/models/keep_awake_occurrence.dart,
 * lib/src/controllers/presence_controller.dart).
 *
 * POST /presence/settings checks both fields before it changes either: 400
 * for a body that is not a JSON object or a field of the wrong type, and the
 * minutes clamped into 0-240. The schedule routes read a body with Dart casts
 * (`json['enabled'] as bool?`) and catch nothing but their own range checks:
 * a body that is not an object, or a field of the wrong type, is a 500
 * `{error: e.toString()}`; a time, a weekday or a keep-awake window out of
 * range is a 400 `{error}`. A whole JSON number counts as Dart's int
 * (JSON.parse cannot tell 30 from 30.0, which Dart reads as a double).
 *
 * Left out: Decaid wakes a sleeping machine at an enabled schedule's minute
 * (it looks every 30 s, presence_controller.dart:471-511) and puts an idle one
 * to sleep after sleepTimeoutMinutes without use (:263-302). The mock does
 * neither by itself, so a test sets the machine's state; nor does it keep a
 * Bengle's own copy of the schedules (:344-426).
 */
import type { PresenceSettings, WakeSchedule } from '../../src/api/types.ts';
import { formatLocalTimestamp } from './clock.ts';
import { dartTypeName, MockHttpError } from './errors.ts';
import { isPlainObject, type JsonObject } from './json.ts';

/** Decaid's own defaults (settings_controller.dart:64-66). */
const DEFAULT_USER_PRESENCE = true;
const DEFAULT_SLEEP_TIMEOUT_MINUTES = 30;
/** normalizeSleepTimeoutPreferenceMinutes (sleep_timeout_preference.dart:1-7). */
const MAX_SLEEP_TIMEOUT_MINUTES = 240;
const MAX_KEEP_AWAKE_MINUTES = 720;
const MINUTE_MS = 60_000;

/** A wake schedule as Decaid holds it (wake_schedule.dart:5-21). */
export interface WakeScheduleRecord {
  id: string;
  hour: number;
  minute: number;
  /** ISO weekdays, each once; empty is every day. */
  daysOfWeek: number[];
  enabled: boolean;
  /** Minutes, or null for none. */
  keepAwakeFor: number | null;
}

export interface PresenceState {
  userPresenceEnabled: boolean;
  sleepTimeoutMinutes: number;
  schedules: WakeScheduleRecord[];
}

/** MockDecaidOptions.presence: Decaid's defaults for what is left out (on, 30 minutes, no schedules). */
export interface PresenceSeed {
  userPresenceEnabled?: boolean;
  /** Clamped into 0-240, as Decaid loads it. */
  sleepTimeoutMinutes?: number;
  /** As Decaid keeps them (WakeSchedule.toJson), ids included. */
  schedules?: WakeSchedule[];
}

/** One run of a schedule's keep-awake window (keep_awake_occurrence.dart:3-12). */
export interface KeepAwakeOccurrence {
  scheduleId: string;
  /** Epoch ms. */
  start: number;
  end: number;
}

/** The same schedule and start is the same run, whatever its end (keep_awake_occurrence.dart:14-21). */
export const occurrenceKey = (occurrence: KeepAwakeOccurrence) => `${occurrence.scheduleId} ${occurrence.start}`;

const clampMinutes = (minutes: number) => Math.min(MAX_SLEEP_TIMEOUT_MINUTES, Math.max(0, minutes));

/** The mock's start; a seeded schedule is read back as WakeSchedule.fromJson reads it (wake_schedule.dart:43-56). */
export function seedPresence(seed: PresenceSeed = {}): PresenceState {
  return {
    userPresenceEnabled: seed.userPresenceEnabled ?? DEFAULT_USER_PRESENCE,
    sleepTimeoutMinutes: clampMinutes(Math.trunc(seed.sleepTimeoutMinutes ?? DEFAULT_SLEEP_TIMEOUT_MINUTES)),
    schedules: (seed.schedules ?? []).map((schedule) => {
      const time = /^(\d{1,2}):(\d{1,2})$/.exec(schedule.time);
      if (!time) throw new Error(`The mock's presence seed: "${schedule.time}" is not an HH:MM time.`);
      return {
        id: schedule.id,
        hour: Number(time[1]),
        minute: Number(time[2]),
        daysOfWeek: [...new Set(schedule.daysOfWeek)],
        enabled: schedule.enabled,
        keepAwakeFor: schedule.keepAwakeFor !== undefined && schedule.keepAwakeFor > 0 ? schedule.keepAwakeFor : null,
      };
    }),
  };
}

// ---- the replies -------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, '0');

/** WakeSchedule.toJson (wake_schedule.dart:58-70): the time padded, the days sorted, keepAwakeFor only when there is one. */
export function wakeScheduleJson(schedule: WakeScheduleRecord): WakeSchedule {
  const json: WakeSchedule = {
    id: schedule.id,
    time: `${pad(schedule.hour)}:${pad(schedule.minute)}`,
    daysOfWeek: [...schedule.daysOfWeek].sort((a, b) => a - b),
    enabled: schedule.enabled,
  };
  if (schedule.keepAwakeFor !== null) json.keepAwakeFor = schedule.keepAwakeFor;
  return json;
}

/** GET /api/v1/presence/settings (presence_handler.dart:44-49), keys in Decaid's order. */
export function presenceSettingsJson(state: PresenceState, keepAwakeUntil: string | null): PresenceSettings {
  return {
    userPresenceEnabled: state.userPresenceEnabled,
    sleepTimeoutMinutes: state.sleepTimeoutMinutes,
    keepAwakeUntil,
    schedules: state.schedules.map(wakeScheduleJson),
  };
}

// ---- Dart casts --------------------------------------------------------------------------

/** What `value as T` throws, answered by the schedule handlers' catch-all (presence_handler.dart:185-188, 270-273). */
function castError(value: unknown, type: string): MockHttpError {
  return new MockHttpError(500, { error: `type '${dartTypeName(value)}' is not a subtype of type '${type}' in type cast` });
}

const badRequest = (error: string) => new MockHttpError(400, { error });
const isNull = (value: unknown) => value === null || value === undefined;
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function asMap(value: unknown): JsonObject {
  if (!isPlainObject(value)) throw castError(value ?? null, 'Map<String, dynamic>');
  return value;
}

function asInt(value: unknown): number {
  if (!isInt(value)) throw castError(value ?? null, 'int');
  return value;
}

function asOptionalInt(value: unknown): number | null {
  if (isNull(value)) return null;
  if (!isInt(value)) throw castError(value, 'int?');
  return value;
}

function asBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw castError(value ?? null, 'bool');
  return value;
}

function asOptionalBool(value: unknown): boolean | null {
  if (isNull(value)) return null;
  if (typeof value !== 'boolean') throw castError(value, 'bool?');
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw castError(value ?? null, 'String');
  return value;
}

/** `int.parse((json['time'] as String).split(':')[part])`: Dart takes a sign and white space around the digits. */
function timePart(time: unknown, part: 0 | 1): number {
  const parts = asString(time).split(':');
  const text = parts[part];
  if (text === undefined) {
    throw new MockHttpError(500, { error: `RangeError (index): Index out of range: index should be less than ${parts.length}: ${part}` });
  }
  if (!/^\s*[+-]?\d+\s*$/.test(text)) throw new MockHttpError(500, { error: `FormatException: Invalid number (at character 1)\n${text}\n^\n` });
  return Number(text.trim());
}

/** `(json['daysOfWeek'] as List).cast<int>().toSet()`, each day once; 400 for one outside 1-7. */
function weekdays(value: unknown): number[] {
  if (!Array.isArray(value)) throw castError(value ?? null, 'List<dynamic>');
  const days = [...new Set(value.map(asInt))];
  if (days.some((day) => day < 1 || day > 7)) throw badRequest('daysOfWeek must contain weekdays 1 to 7');
  return days;
}

function checkTime(hour: number, minute: number): void {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw badRequest('time must be hour 0-23 and minute 0-59');
}

function checkKeepAwake(minutes: number | null): void {
  if (minutes !== null && (minutes < 0 || minutes > MAX_KEEP_AWAKE_MINUTES)) {
    throw badRequest('keepAwakeFor must be 1-720 minutes, or 0/null to clear');
  }
}

// ---- the writes --------------------------------------------------------------------------

/**
 * POST /api/v1/presence/settings (presence_handler.dart:56-101): both fields
 * are checked before either changes, and a key Decaid does not know is
 * ignored. Decaid answers the two settings as saved.
 */
export function applyPresencePatch(state: PresenceState, body: unknown): PresenceState {
  if (!isPlainObject(body)) throw badRequest('Request body must be a JSON object');
  let { userPresenceEnabled, sleepTimeoutMinutes } = state;
  if ('userPresenceEnabled' in body) {
    if (typeof body.userPresenceEnabled !== 'boolean') throw badRequest('userPresenceEnabled must be a boolean');
    userPresenceEnabled = body.userPresenceEnabled;
  }
  if ('sleepTimeoutMinutes' in body) {
    if (!isInt(body.sleepTimeoutMinutes)) throw badRequest('sleepTimeoutMinutes must be an integer');
    sleepTimeoutMinutes = clampMinutes(body.sleepTimeoutMinutes);
  }
  return { ...state, userPresenceEnabled, sleepTimeoutMinutes };
}

/**
 * POST /api/v1/presence/schedules (presence_handler.dart:127-182), checked in
 * Decaid's order: hour and minute win over time, no daysOfWeek is every day,
 * enabled defaults to true, and a keepAwakeFor of 0 is none (wake_schedule.dart:23-41).
 */
export function createWakeScheduleRecord(body: unknown, id: string): WakeScheduleRecord {
  const json = asMap(body);
  const keepAwakeFor = asOptionalInt(json.keepAwakeFor);
  checkKeepAwake(keepAwakeFor);
  const hour = asOptionalInt(json.hour) ?? timePart(json.time, 0);
  const minute = asOptionalInt(json.minute) ?? timePart(json.time, 1);
  checkTime(hour, minute);
  const daysOfWeek = 'daysOfWeek' in json ? weekdays(json.daysOfWeek) : [];
  const enabled = asOptionalBool(json.enabled) ?? true;
  return { id, hour, minute, daysOfWeek, enabled, keepAwakeFor: keepAwakeFor !== null && keepAwakeFor > 0 ? keepAwakeFor : null };
}

/**
 * PUT /api/v1/presence/schedules/{id} once Decaid has found the schedule
 * (presence_handler.dart:204-267): only the keys given change, `time` first
 * and then `hour` and `minute` over it; keepAwakeFor null or 0 clears it.
 */
export function updateWakeScheduleRecord(existing: WakeScheduleRecord, body: unknown): WakeScheduleRecord {
  const json = asMap(body);
  let { hour, minute } = existing;
  if ('time' in json) {
    hour = timePart(json.time, 0);
    minute = timePart(json.time, 1);
  }
  if ('hour' in json) hour = asInt(json.hour);
  if ('minute' in json) minute = asInt(json.minute);
  checkTime(hour, minute);
  const daysOfWeek = 'daysOfWeek' in json ? weekdays(json.daysOfWeek) : [...existing.daysOfWeek];
  let keepAwakeFor = existing.keepAwakeFor;
  if ('keepAwakeFor' in json) {
    const minutes = asOptionalInt(json.keepAwakeFor);
    checkKeepAwake(minutes);
    keepAwakeFor = minutes === null || minutes === 0 ? null : minutes;
  }
  const enabled = 'enabled' in json ? asBool(json.enabled) : existing.enabled;
  return { ...existing, hour, minute, daysOfWeek, enabled, keepAwakeFor };
}

// ---- the keep-awake window ------------------------------------------------------------------

/** Dart's DateTime.weekday: 1 = Monday to 7 = Sunday. */
const isoWeekday = (date: Date) => date.getDay() || 7;

/** The schedule's run that `now` is in, from today's start or yesterday's, on a day it runs (keep_awake_occurrence.dart:53-93). */
function occurrenceAt(schedule: WakeScheduleRecord, now: number): KeepAwakeOccurrence | null {
  const minutes = schedule.keepAwakeFor;
  if (!schedule.enabled || minutes === null || minutes <= 0) return null;
  if (schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) return null;
  const today = new Date(now);
  for (let daysAgo = 0; daysAgo <= 1; daysAgo += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    if (schedule.daysOfWeek.length > 0 && !schedule.daysOfWeek.includes(isoWeekday(day))) continue;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), schedule.hour, schedule.minute).getTime();
    const end = start + minutes * MINUTE_MS;
    if (now >= start && now < end) return { scheduleId: schedule.id, start, end };
  }
  return null;
}

/**
 * activeKeepAwakeOccurrence (keep_awake_occurrence.dart:24-42): of the runs
 * going on now, the one that ends last (on a tie, the one that started last).
 * In local time, as Decaid's DateTime is.
 */
export function activeKeepAwakeOccurrence(schedules: readonly WakeScheduleRecord[], now: number): KeepAwakeOccurrence | null {
  let latest: KeepAwakeOccurrence | null = null;
  for (const schedule of schedules) {
    const occurrence = occurrenceAt(schedule, now);
    if (!occurrence) continue;
    if (!latest || occurrence.end > latest.end || (occurrence.end === latest.end && occurrence.start > latest.start)) latest = occurrence;
  }
  return latest;
}

/** keepAwakeUntil: Dart's toIso8601String of a local time, no zone; a run ends on a whole minute, so no microseconds ("...:00.000"). */
export function keepAwakeUntilText(occurrence: KeepAwakeOccurrence): string {
  return formatLocalTimestamp(occurrence.end).slice(0, -3);
}

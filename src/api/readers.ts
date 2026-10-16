/**
 * Readers for Decaid's REST replies (D95, spec 4.5): every reply CafAI used
 * to cast blindly is checked here, where it enters CafAI.
 *
 * Each reader checks the parts of a reply CafAI reads, with zod's
 * looseObject: keys CafAI does not know pass through, an enum value it does
 * not know is kept (enums are plain strings here), and a key Decaid leaves
 * out when it has no value is optional. A reply that fits comes back as it
 * was sent, the very object.
 *
 * A reply that does not fit is neither trusted nor allowed to crash a
 * screen. What was wrong goes to the drift log as a field path and a type
 * (never a value: notes and names are free text), and then
 *   - a field CafAI cannot do without (the workflow's profile with its title
 *     and steps, any record's id, a profile record's profile, a batch's bean,
 *     a device's id, type and state) fails the call with GatewayError
 *     `unexpected_reply`;
 *   - in a list, the item without it is left out and the rest are kept; a
 *     list route that answers anything but a list, null included, fails the
 *     call, so a reply CafAI cannot read never reads as "Decaid has none";
 *   - anything else is unknown: left out where CafAI's type lets it be
 *     absent, as Decaid leaves out what it has no value for, null where the
 *     type says so (a drink preset's field), or empty text a screen shows as
 *     unknown. Never a default that a screen would show as Decaid's value.
 * The reply itself is never changed: a repair copies what it touches.
 */
import { z } from 'zod';
import { reportDrift } from './drift.ts';
import { describeValue, parseMachineFrame, typeName } from './frames.ts';
import type { Reader } from './http.ts';
import {
  GatewayError,
  type Bean,
  type BeanBatch,
  type BuildInfo,
  type DecaidSettings,
  type DeviceEntry,
  type MachineFrame,
  type MachineInfo,
  type PaginatedShots,
  type PluginInfo,
  type PresenceSettings,
  type ProfileRecord,
  type ShotRecord,
  type ShotRecordSummary,
  type SteamRecordSummary,
  type WakeSchedule,
  type Workflow,
} from './types.ts';

export const UNEXPECTED_REPLY = "Decaid sent a reply CafAI doesn't recognise.";

/**
 * The error for a reply CafAI cannot use, once what was wrong is reported.
 * `source` is "GET /api/v1/workflow"; the path defaults to its route.
 */
export function unexpectedReply(source: string, path = source.slice(source.indexOf(' ') + 1)): GatewayError {
  return new GatewayError(200, path, UNEXPECTED_REPLY, 'unexpected_reply');
}

// ---------------------------------------------------------------------------
// Checking and repairing
// ---------------------------------------------------------------------------

interface Rule {
  shape: z.ZodType;
  /** Paths CafAI cannot do without: a problem at or under one makes the record unusable. */
  required?: readonly string[];
  /** What a bad or missing field reads as, by path ("GHC": false); a field with none is left out. */
  fallback?: Readonly<Record<string, unknown>>;
}

interface Problem {
  /** "steamSettings.flow"; "" for the record itself. */
  path: string;
  /** "missing", "expected number, got string". */
  what: string;
}

interface Inspection {
  value: unknown;
  /** Repaired: reported, and the value read on. */
  problems: Problem[];
  /** The record cannot be used. */
  fatal: Problem[];
}

function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let value = data;
  for (const part of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[part];
  }
  return value;
}

/** A copy of `data` with the value at `path` replaced, or left out when `next` is undefined. */
function withValueAt(data: unknown, path: readonly PropertyKey[], next: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined || typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const copy: Record<PropertyKey, unknown> = { ...(data as Record<PropertyKey, unknown>) };
  if (rest.length > 0) copy[key] = withValueAt(copy[key], rest, next);
  else if (next === undefined) delete copy[key];
  else copy[key] = next;
  return copy;
}

/** A fallback of its own for every reply, so changing one reply never changes the next. */
function fresh(fallback: unknown): unknown {
  if (Array.isArray(fallback)) return [...(fallback as unknown[])];
  return typeof fallback === 'object' && fallback !== null ? { ...fallback } : fallback;
}

function describeIssue(issue: z.core.$ZodIssue, value: unknown): string {
  if (issue.code === 'invalid_type') return describeValue(value, issue.expected === 'record' ? 'object' : issue.expected);
  if (issue.code === 'too_small' && value === '') return 'empty';
  return value === undefined ? 'missing' : `unexpected ${typeName(value)}`;
}

function inspect(rule: Rule, data: unknown): Inspection {
  const result = rule.shape.safeParse(data);
  if (result.success) return { value: data, problems: [], fatal: [] };
  let value = data;
  const problems: Problem[] = [];
  const fatal: Problem[] = [];
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.');
    const problem = { path, what: describeIssue(issue, valueAt(data, issue.path)) };
    if (path === '' || (rule.required ?? []).some((needed) => path === needed || path.startsWith(`${needed}.`))) {
      fatal.push(problem);
    } else {
      problems.push(problem);
      value = withValueAt(value, issue.path, fresh(rule.fallback?.[path]));
    }
  }
  return { value, problems, fatal };
}

/** "[].id: missing", "reply: expected object, got array". */
function describeProblem(problem: Problem, prefix: string): string {
  const where = [prefix, problem.path].filter((part) => part !== '').join('.') || 'reply';
  return `${where}: ${problem.what}`;
}

/** Only why a record is unusable, when it is: the rest of it no longer matters. */
function reportInspection(source: string, { problems, fatal }: Inspection, prefix = ''): void {
  for (const problem of fatal.length > 0 ? fatal : problems) reportDrift(source, describeProblem(problem, prefix));
}

function readRecord<T>(rule: Rule, data: unknown, source: string): T {
  const inspection = inspect(rule, data);
  reportInspection(source, inspection);
  if (inspection.fatal.length > 0) throw unexpectedReply(source);
  return inspection.value as T;
}

/** A list: an item CafAI cannot use is left out. `prefix` names the items in reports ("[]", "items[]"). */
function readList<T>(rule: Rule, data: unknown, source: string, prefix = '[]'): T[] {
  if (!Array.isArray(data)) {
    reportDrift(source, `${prefix === '[]' ? 'reply' : prefix.slice(0, -2)}: ${describeValue(data, 'array')}`);
    throw unexpectedReply(source);
  }
  const items: T[] = [];
  for (const item of data) {
    const inspection = inspect(rule, item);
    reportInspection(source, inspection, prefix);
    if (inspection.fatal.length === 0) items.push(inspection.value as T);
  }
  return items;
}

const recordReader =
  <T>(rule: Rule): Reader<T> =>
  (data, source) =>
    readRecord<T>(rule, data, source);

const listReader =
  <T>(rule: Rule): Reader<T[]> =>
  (data, source) =>
    readList<T>(rule, data, source);

/** Fallbacks for an object and for each of its fields: "steamSettings" and "steamSettings.flow". */
function fallbacksFor(key: string, defaults: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const fallbacks: Record<string, unknown> = { [key]: defaults };
  for (const [field, value] of Object.entries(defaults)) fallbacks[`${key}.${field}`] = value;
  return fallbacks;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const text = z.string();
const flag = z.boolean();
const num = z.number();
const id = z.string().min(1);
const anyObject = z.looseObject({});
const nullableText = z.string().nullable();

const BUILD_INFO: Rule = {
  // Only what About shows. Empty reads as "version unknown".
  shape: z.looseObject({ version: text, fullVersion: text }),
  fallback: { version: '', fullVersion: '' },
};

const MACHINE_INFO: Rule = {
  shape: z.looseObject({ version: text, model: text, serialNumber: text, GHC: flag, extra: anyObject.optional() }),
  // No GHC known: the start buttons stay on screen.
  fallback: { version: '', model: '', serialNumber: '', GHC: false },
};

const SETTINGS: Rule = {
  // A gateway mode CafAI cannot read is left out: CafAI says nothing about it (5.1).
  // Decaid always sends the preferred ids, a string or null; one it did not is left
  // out, and Connect then connects nothing rather than guess (connectKind).
  shape: z.looseObject({ gatewayMode: text, preferredMachineId: nullableText, preferredScaleId: nullableText }),
};

const PLUGIN: Rule = {
  // Without `loaded` a plugin counts as not running (D103).
  shape: z.looseObject({ id, loaded: flag }),
  required: ['id'],
};

const DEVICE: Rule = {
  // What Connect and the link state read. A device without a name in a form CafAI reads goes by
  // none; one without `available` counts as there to connect (Decaid sends false for one it only remembers).
  shape: z.looseObject({ id, name: text, state: text, type: text, available: flag, connectionRole: text.optional() }),
  required: ['id', 'state', 'type'],
  fallback: { name: '' },
};

/** Decaid omits a context key that has no value; CafAI writes null to clear one. */
const CONTEXT = z.looseObject({
  targetDoseWeight: num.optional(),
  targetYield: num.optional(),
  targetWaterVolume: num.optional(),
  grinderId: nullableText.optional(),
  grinderModel: nullableText.optional(),
  grinderSetting: nullableText.optional(),
  grinderBurrs: nullableText.optional(),
  beanBatchId: nullableText.optional(),
  coffeeName: nullableText.optional(),
  coffeeRoaster: nullableText.optional(),
  finalBeverageType: text.optional(),
  baristaName: text.optional(),
  drinkerName: text.optional(),
  extras: anyObject.optional(),
});

/**
 * A drink preset's fields CafAI could not read are null, never Decaid's
 * defaults: Settings shows them as unknown, and a renamed field never reads
 * as 0.8 ml/s, nor steam that is off as 150 °C.
 */
const UNKNOWN_STEAM = { targetTemperature: null, duration: null, flow: null };
const UNKNOWN_HOT_WATER = { targetTemperature: null, duration: null, volume: null, flow: null };
const UNKNOWN_RINSE = { targetTemperature: null, duration: null, flow: null };

const WORKFLOW: Rule = {
  shape: z.looseObject({
    // Only what CafAI reads unguarded: the rest of the profile goes back to Decaid exactly as it came (the barrier, D55).
    profile: z.looseObject({ title: text, steps: z.array(z.unknown()) }),
    context: CONTEXT.optional(),
    steamSettings: z.looseObject({ targetTemperature: num, duration: num, flow: num }),
    hotWaterData: z.looseObject({ targetTemperature: num, duration: num, volume: num, flow: num }),
    rinseData: z.looseObject({ targetTemperature: num, duration: num, flow: num }),
  }),
  required: ['profile'],
  fallback: {
    ...fallbacksFor('steamSettings', UNKNOWN_STEAM),
    ...fallbacksFor('hotWaterData', UNKNOWN_HOT_WATER),
    ...fallbacksFor('rinseData', UNKNOWN_RINSE),
  },
};

const PROFILE_RECORD: Rule = {
  shape: z.looseObject({
    id,
    // CafAI compares its title with the one sent to tell Decaid's dedupe (workflow.ts).
    profile: z.looseObject({ title: text }),
    // Left out when Decaid sent something else: unknown, which never counts as a dedupe.
    parentId: nullableText,
  }),
  required: ['id', 'profile'],
};

const ANNOTATIONS = z.looseObject({
  actualDoseWeight: num.optional(),
  actualYield: num.optional(),
  drinkTds: num.optional(),
  drinkEy: num.optional(),
  enjoyment: num.optional(),
  espressoNotes: text.optional(),
  extras: anyObject.optional(),
});

const SHOT_FIELDS = {
  id,
  timestamp: text,
  createdAt: text,
  updatedAt: text,
  // Checked as a whole only: the engine credits a shot whose workflow lacks its profile as before (5.10).
  workflow: anyObject,
  annotations: ANNOTATIONS.optional(),
  stopReason: text.optional(),
};

const SHOT_FALLBACK = { timestamp: '', createdAt: '', updatedAt: '', workflow: {} };

const SHOT_SUMMARY: Rule = { shape: z.looseObject(SHOT_FIELDS), required: ['id'], fallback: SHOT_FALLBACK };

const SHOT: Rule = {
  // The summary reads each measurement field by field (coach/summary): only the list is checked here.
  shape: z.looseObject({ ...SHOT_FIELDS, measurements: z.array(z.unknown()) }),
  required: ['id'],
  fallback: { ...SHOT_FALLBACK, measurements: [] },
};

const SHOT_PAGE: Rule = {
  shape: z.looseObject({ items: z.array(z.unknown()), total: num, limit: num, offset: num }),
  required: ['items'],
  fallback: { total: 0, limit: 0, offset: 0 },
};

const STEAM_SUMMARY: Rule = {
  // The care reminders read only when the newest steam began, to tell a count that does not add up (D-CARE-3).
  shape: z.looseObject({ id, timestamp: text }),
  required: ['id'],
  fallback: { timestamp: '' },
};

/** A record's id in a list of them: one that is not a non-empty string is left out (and reported). */
const RECORD_ID: Rule = { shape: id };

const BEAN: Rule = {
  shape: z.looseObject({
    id,
    roaster: text,
    name: text,
    country: text.optional(),
    region: text.optional(),
    processing: text.optional(),
    notes: text.optional(),
    archived: flag,
    createdAt: text.optional(),
    updatedAt: text.optional(),
    extras: anyObject.optional(),
  }),
  required: ['id'],
};

const BATCH: Rule = {
  shape: z.looseObject({
    id,
    beanId: id,
    roastDate: nullableText.optional(),
    roastLevel: nullableText.optional(),
    freezeDate: nullableText.optional(),
    unfreezeDate: nullableText.optional(),
    frozen: flag,
    archived: flag,
    createdAt: text.optional(),
    extras: anyObject.optional(),
  }),
  required: ['id', 'beanId'],
};

const GRINDER: Rule = {
  // Grinder.toJson leaves a null field out; settingType is checked as text, and parseGrinder
  // (grinders.ts) then reads it, and a missing archived, as Decaid's Grinder.fromJson does.
  shape: z.looseObject({
    id,
    model: text,
    burrs: text.optional(),
    burrSize: num.optional(),
    burrType: text.optional(),
    notes: text.optional(),
    archived: flag,
    settingType: text,
    settingValues: z.array(text).optional(),
    settingSmallStep: num.optional(),
    settingBigStep: num.optional(),
    rpmSmallStep: num.optional(),
    rpmBigStep: num.optional(),
    createdAt: text.optional(),
    updatedAt: text.optional(),
    extras: anyObject.optional(),
  }),
  required: ['id', 'model'],
};

/** "06:30", as WakeSchedule.toJson pads it (wake_schedule.dart:58-63 at aab5f93). */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekday = z.number().int().min(1).max(7);

const WAKE_SCHEDULE: Rule = {
  // A schedule CafAI cannot show as it is, or change, is left out of the list (and reported).
  // WakeSchedule.toJson leaves keepAwakeFor out when there is none (wake_schedule.dart:66-68).
  shape: z.looseObject({ id, time: clockTime, daysOfWeek: z.array(weekday), enabled: flag, keepAwakeFor: num.optional() }),
  required: ['id', 'time', 'daysOfWeek', 'enabled'],
};

const PRESENCE: Rule = {
  // Settings > Sleep and wake shows nothing it could not read: without these the read fails, and says so.
  shape: z.looseObject({ userPresenceEnabled: flag, sleepTimeoutMinutes: num, schedules: z.array(z.unknown()), keepAwakeUntil: nullableText }),
  required: ['userPresenceEnabled', 'sleepTimeoutMinutes', 'schedules'],
};

/** POST /api/v1/presence/settings answers the two settings as saved (presence_handler.dart:98-101). */
const PRESENCE_SAVED: Rule = {
  shape: z.looseObject({ userPresenceEnabled: flag, sleepTimeoutMinutes: num }),
  required: ['userPresenceEnabled', 'sleepTimeoutMinutes'],
};

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export const readBuildInfo: Reader<BuildInfo> = recordReader(BUILD_INFO);
export const readMachineInfo: Reader<MachineInfo> = recordReader(MACHINE_INFO);
export const readSettings: Reader<DecaidSettings> = recordReader(SETTINGS);
export const readPlugins: Reader<PluginInfo[]> = listReader(PLUGIN);
export const readDevices: Reader<DeviceEntry[]> = listReader(DEVICE);
export const readWorkflow: Reader<Workflow> = recordReader(WORKFLOW);
export const readProfileRecord: Reader<ProfileRecord> = recordReader(PROFILE_RECORD);
export const readProfileRecords: Reader<ProfileRecord[]> = listReader(PROFILE_RECORD);
export const readShotSummary: Reader<ShotRecordSummary> = recordReader(SHOT_SUMMARY);
export const readShot: Reader<ShotRecord> = recordReader(SHOT);
export const readSteamSummary: Reader<SteamRecordSummary> = recordReader(STEAM_SUMMARY);
export const readRecordIds: Reader<string[]> = listReader(RECORD_ID);
export const readBean: Reader<Bean> = recordReader(BEAN);
export const readBeans: Reader<Bean[]> = listReader(BEAN);
export const readBatch: Reader<BeanBatch> = recordReader(BATCH);
export const readBatches: Reader<BeanBatch[]> = listReader(BATCH);
/** Grinder records checked for what CafAI reads, as sent: parseGrinder (grinders.ts) reads each one on. */
export const readGrinderRecord: Reader<Record<string, unknown>> = recordReader(GRINDER);
export const readGrinderRecords: Reader<Record<string, unknown>[]> = listReader(GRINDER);

export const readShotPage: Reader<PaginatedShots> = (data, source) => {
  const page = readRecord<PaginatedShots>(SHOT_PAGE, data, source);
  return { ...page, items: readList<ShotRecordSummary>(SHOT_SUMMARY, page.items, source, 'items[]') };
};

export const readWakeSchedule: Reader<WakeSchedule> = recordReader(WAKE_SCHEDULE);
export const readPresenceSaved: Reader<Pick<PresenceSettings, 'userPresenceEnabled' | 'sleepTimeoutMinutes'>> = recordReader(PRESENCE_SAVED);

/** The settings, and each schedule read like a list's item: one CafAI cannot read is left out, the rest kept. */
export const readPresenceSettings: Reader<PresenceSettings> = (data, source) => {
  const settings = readRecord<PresenceSettings>(PRESENCE, data, source);
  return { ...settings, schedules: readList<WakeSchedule>(WAKE_SCHEDULE, settings.schedules, source, 'schedules[]') };
};

/** GET /api/v1/machine/state, read like a snapshot frame (frames.ts reports what it lacks). */
export const readMachineState: Reader<MachineFrame> = (data, source) => {
  const frame = parseMachineFrame(data, source);
  if (frame === null) throw unexpectedReply(source);
  return frame;
};

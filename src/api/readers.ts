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
 *     and steps, any record's id, a profile record's profile, a batch's bean)
 *     fails the call with GatewayError `unexpected_reply`;
 *   - in a list, the item without it is left out and the rest are kept;
 *   - anything else reads as its fallback, or is left out where CafAI's type
 *     lets it be absent, as Decaid leaves out what it has no value for.
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
  type MachineFrame,
  type MachineInfo,
  type PaginatedShots,
  type PluginInfo,
  type ProfileRecord,
  type ShotRecord,
  type ShotRecordSummary,
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
  shape: z.looseObject({
    commit: text,
    commitShort: text,
    branch: text,
    buildTime: text,
    version: text,
    buildNumber: text,
    appStore: flag,
    fullVersion: text,
    localIp: text.optional(),
  }),
  // Empty reads as "version unknown".
  fallback: { commit: '', commitShort: '', branch: '', buildTime: '', version: '', buildNumber: '', appStore: false, fullVersion: '' },
};

const MACHINE_INFO: Rule = {
  shape: z.looseObject({ version: text, model: text, serialNumber: text, GHC: flag, extra: anyObject.optional() }),
  // No GHC known: the start buttons stay on screen.
  fallback: { version: '', model: '', serialNumber: '', GHC: false },
};

const SETTINGS: Rule = {
  // A gateway mode CafAI cannot read is left out: CafAI says nothing about it (5.1).
  shape: z.looseObject({ gatewayMode: text, blockOnNoScale: flag.optional(), blockTareDuringShot: flag.optional() }),
};

const PLUGIN: Rule = {
  // Without `loaded` a plugin counts as not running (D103).
  shape: z.looseObject({ id, name: text.optional(), version: text.optional(), loaded: flag }),
  required: ['id'],
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

/** Decaid's own defaults for a workflow without them (SteamSettings.defaults() and the others in workflow.dart). */
const STEAM_DEFAULTS = { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 };
const HOT_WATER_DEFAULTS = { targetTemperature: 75, duration: 30, volume: 50, flow: 10 };
const RINSE_DEFAULTS = { targetTemperature: 90, duration: 10, flow: 6 };

const WORKFLOW: Rule = {
  shape: z.looseObject({
    id: text,
    name: text,
    description: text,
    // Only what CafAI reads unguarded: the rest of the profile goes back to Decaid exactly as it came (the barrier, D55).
    profile: z.looseObject({ title: text, steps: z.array(z.unknown()) }),
    context: CONTEXT.optional(),
    steamSettings: z.looseObject({ targetTemperature: num, duration: num, flow: num, stopAtTemperature: num }),
    hotWaterData: z.looseObject({ targetTemperature: num, duration: num, volume: num, flow: num }),
    rinseData: z.looseObject({ targetTemperature: num, duration: num, flow: num }),
  }),
  required: ['profile'],
  fallback: {
    id: '',
    name: '',
    description: '',
    ...fallbacksFor('steamSettings', STEAM_DEFAULTS),
    ...fallbacksFor('hotWaterData', HOT_WATER_DEFAULTS),
    ...fallbacksFor('rinseData', RINSE_DEFAULTS),
  },
};

const PROFILE_RECORD: Rule = {
  shape: z.looseObject({
    id,
    // CafAI compares its title with the one sent to tell Decaid's dedupe (workflow.ts).
    profile: z.looseObject({ title: text }),
    metadataHash: text,
    compoundHash: text,
    parentId: nullableText,
    visibility: text,
    isDefault: flag,
    createdAt: text,
    updatedAt: text,
    metadata: anyObject.nullable(),
  }),
  required: ['id', 'profile'],
  fallback: { metadataHash: '', compoundHash: '', parentId: null, visibility: '', isDefault: false, createdAt: '', updatedAt: '', metadata: null },
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

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export const readBuildInfo: Reader<BuildInfo> = recordReader(BUILD_INFO);
export const readMachineInfo: Reader<MachineInfo> = recordReader(MACHINE_INFO);
export const readSettings: Reader<DecaidSettings> = recordReader(SETTINGS);
export const readPlugins: Reader<PluginInfo[]> = listReader(PLUGIN);
export const readWorkflow: Reader<Workflow> = recordReader(WORKFLOW);
export const readProfileRecord: Reader<ProfileRecord> = recordReader(PROFILE_RECORD);
export const readProfileRecords: Reader<ProfileRecord[]> = listReader(PROFILE_RECORD);
export const readShotSummary: Reader<ShotRecordSummary> = recordReader(SHOT_SUMMARY);
export const readShot: Reader<ShotRecord> = recordReader(SHOT);
export const readBean: Reader<Bean> = recordReader(BEAN);
export const readBeans: Reader<Bean[]> = listReader(BEAN);
export const readBatch: Reader<BeanBatch> = recordReader(BATCH);
export const readBatches: Reader<BeanBatch[]> = listReader(BATCH);

export const readShotPage: Reader<PaginatedShots> = (data, source) => {
  const page = readRecord<PaginatedShots>(SHOT_PAGE, data, source);
  return { ...page, items: readList<ShotRecordSummary>(SHOT_SUMMARY, page.items, source, 'items[]') };
};

/** GET /api/v1/machine/state, read like a snapshot frame (frames.ts reports what it lacks). */
export const readMachineState: Reader<MachineFrame> = (data, source) => {
  const frame = parseMachineFrame(data, source);
  if (frame === null) throw unexpectedReply(source);
  return frame;
};

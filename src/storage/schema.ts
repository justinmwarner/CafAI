/**
 * The zod schema of a CafAI export, used before anything is written to the
 * database: by the import, and by the mirror restore record by record.
 *
 * Record fields are checked and anything unknown at that level is dropped
 * (an `apiKey` in a hand-edited settings block never gets in). Nested data -
 * profiles, shot summaries, transcripts - is checked for its shape but kept
 * exactly as it was: transcripts are replayed to the model unchanged and
 * profiles are what Decaid hashed, so not even key order may change.
 *
 * Nullable fields read a missing value as null, because JSON drops
 * `undefined`: an export must always be importable by the version that made it.
 * `summary.series` may be absent: the mirror leaves it out to stay small.
 */
import { z } from 'zod';
import { ROAST_LEVELS, VARIABLES, type ProposeAdjustment } from '../coach/contract.ts';
import type { FunFactsSource } from '../coach/facts/types.ts';
import type { ProfileJson, ShotSummary } from '../coach/types.ts';
import type { TemperatureUnit } from '../coach/temperature.ts';
import type { LlmMessage } from '../llm/types.ts';
import type { CoachUiMessage } from '../app/types.ts';
import type { Appearance, AppliedChange, CareSettings, DrinkScreensSettings, Feedback, ScreensaverSetting } from './types.ts';

/** Checked against `shape`, but the original value is kept, untouched. */
function exact<T>(shape: z.ZodType) {
  return z.custom<T>((value) => shape.safeParse(value).success);
}

const text = z.string();
const nullableText = z.string().nullable().default(null);
/**
 * Unlike nullableText, a missing value stays missing. `nullableText.optional()`
 * does not do this: the built-in default still fires on a missing key, so
 * `.optional()` on top of it has no effect (checked against zod 4 directly).
 */
const optionalNullableText = z.string().nullable().optional();
const id = z.string().min(1);
const timestamp = z.string().min(1);

const StepShape = z.looseObject({
  name: text,
  pump: text,
  transition: text,
  sensor: text,
  temperature: z.number(),
  seconds: z.number(),
  volume: z.number(),
});

const ProfileShape = z.looseObject({
  version: text,
  title: text,
  notes: text,
  author: text,
  beverage_type: text,
  steps: z.array(StepShape),
  target_volume: z.number().nullable(),
  target_weight: z.number().nullable(),
  target_volume_count_start: z.number(),
  tank_temperature: z.number(),
});

const AppliedChangeShape = z.looseObject({
  variable: text,
  lever: text.nullable(),
  from: z.number().nullable(),
  to: z.number().nullable(),
  diffLines: z.array(text),
  summary: text,
});

const SummaryShape = z.looseObject({
  shotId: text,
  timestamp: text,
  durationS: z.number(),
  channelingFlags: z.array(text),
  phases: z.array(z.unknown()),
  series: z.looseObject({ tS: z.array(z.number()) }).optional(),
  /** The barista's refractometer reading and its EY (D166); absent on a shot without one. */
  tdsPct: z.number().optional(),
  eyPct: z.number().nullable().optional(),
});

const FeedbackShape = z.looseObject({
  question: text,
  selected: z.array(text),
  otherText: text.nullable(),
});

const ProposalShape = z.looseObject({
  variable: z.enum(VARIABLES),
  lever: text.nullable(),
  value: z.number().nullable(),
  summary: text,
  rationale: text,
  expectedEffect: text,
  tips: z.array(text),
});

const LlmMessageShape = z.looseObject({
  role: z.enum(['user', 'assistant']),
  content: z.array(z.looseObject({ type: text })),
});

const UiMessageShape = z.looseObject({
  id: text,
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.looseObject({ kind: text })),
  createdAt: text,
});

export const SettingsSchema = z.object({
  model: z.string().min(1),
  grinderName: nullableText,
  grinderSetting: nullableText,
  /** Absent from exports made before grinders could be linked to Decaid: read as not linked. */
  grinderId: nullableText,
  activeBagId: nullableText,
  /**
   * Absent from exports made before appearance existed, in which case normalizeAppearance
   * reads it as the default. Not shape-checked here (any value passes) and re-validated there,
   * so a tint id this build does not know still survives the round trip instead of being
   * dropped as an unrecognised shape.
   */
  appearance: exact<Appearance>(z.unknown()).optional(),
  /** Absent from exports made before D99; read as off (settings.ts), same treatment as appearance above. */
  keepKeyInDecaid: z.boolean().optional(),
  /**
   * The temperature unit (D172); absent from exports made before it, or from a device that never chose,
   * and read as °C. Not shape-checked here, as appearance: settings.ts keeps only a unit it knows, so a file
   * from a newer CafAI with another one still imports.
   */
  temperatureUnit: exact<TemperatureUnit>(z.unknown()).optional(),
  /** Machine care's reminders (D187); absent from exports made before them. Re-validated by normalizeCareSettings, as appearance is. */
  care: exact<CareSettings>(z.unknown()).optional(),
  /** Where fun facts come from (D198); absent from exports made before them. Not shape-checked here, as temperatureUnit. */
  funFacts: exact<FunFactsSource>(z.unknown()).optional(),
  /** Each drink's screen (D222); absent from exports made before them. Re-validated by normalizeDrinkScreens, as care is. */
  drinkScreens: exact<DrinkScreensSettings>(z.unknown()).optional(),
  /** The screensaver (D-SAVER-3); absent from exports made before it. Re-validated by normalizeScreensaver, as care is. */
  screensaver: exact<ScreensaverSetting>(z.unknown()).optional(),
});

export const BagSchema = z.object({
  id,
  name: text,
  roaster: nullableText,
  origin: nullableText,
  roastLevel: z.enum(ROAST_LEVELS).nullable().default(null),
  process: nullableText,
  notes: nullableText,
  /** Decaid's bean library link (D102); absent on bags made before 2026-10-09, and left absent (not forced to null) so an old export still round-trips exactly. */
  decaidBeanId: optionalNullableText,
  decaidBatchId: optionalNullableText,
  roastDate: optionalNullableText,
  templateId: nullableText,
  activeVersionId: nullableText,
  conversationId: text,
  archived: z.boolean().default(false),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const VersionSchema = z.object({
  id,
  bagId: text,
  version: z.number(),
  title: text,
  templateId: text,
  profile: exact<ProfileJson>(ProfileShape),
  decaidProfileId: nullableText,
  parentVersionId: nullableText,
  change: exact<AppliedChange>(AppliedChangeShape).nullable().default(null),
  status: z.enum(['active', 'superseded', 'undone']),
  createdAt: timestamp,
});

export const IterationSchema = z.object({
  id,
  bagId: text,
  bagName: text,
  profileVersionId: nullableText,
  profileVersion: z.number().nullable().default(null),
  shotId: nullableText,
  summary: exact<ShotSummary>(SummaryShape).nullable().default(null),
  feedback: exact<Feedback>(FeedbackShape).nullable().default(null),
  proposal: exact<ProposeAdjustment>(ProposalShape).nullable().default(null),
  change: exact<AppliedChange>(AppliedChangeShape).nullable().default(null),
  outcome: z.enum(['pending', 'applied', 'declined', 'undone', 'kept', 'superseded']),
  /** The shot's Visualizer page (6.4); left absent on older iterations, as the bag's Decaid link is. */
  visualizerUrl: optionalNullableText,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const ConversationSchema = z.object({
  id,
  bagId: text,
  apiMessages: z.array(exact<LlmMessage>(LlmMessageShape)),
  uiMessages: z.array(exact<CoachUiMessage>(UiMessageShape)),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/**
 * A care step's record (D189). How it was marked, the totals and Decaid's
 * newest records' times, read leniently: one this build cannot read (or a
 * record from before the times) is unknown (null), so a file from a newer
 * CafAI still imports; the step and the times are needed.
 */
export const CareRecordSchema = z.object({
  id,
  doneAt: nullableText,
  by: z.enum(['tick', 'seen']).nullable().catch(null),
  countFrom: timestamp,
  shotTotal: z.number().int().min(0).nullable().catch(null),
  steamTotal: z.number().int().min(0).nullable().catch(null),
  newestShotAt: z.string().min(1).nullable().catch(null),
  newestSteamAt: z.string().min(1).nullable().catch(null),
  updatedAt: timestamp,
});

export const ExportSchema = z.object({
  format: z.literal('cafai-export'),
  schemaVersion: z.literal(1),
  exportedAt: text,
  appVersion: text,
  settings: SettingsSchema,
  bags: z.array(BagSchema),
  versions: z.array(VersionSchema),
  iterations: z.array(IterationSchema),
  conversations: z.array(ConversationSchema),
  /** Absent from files made before machine care's records (D189). */
  care: z.array(CareRecordSchema).optional(),
});

/** "bags[2].name" for a zod issue path. */
export function describePath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? 'the top level' : out;
}

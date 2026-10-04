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
import type { ProfileJson, ShotSummary } from '../coach/types.ts';
import type { LlmMessage } from '../llm/types.ts';
import type { CoachUiMessage } from '../app/types.ts';
import type { AppliedChange, Feedback } from './types.ts';

/** Checked against `shape`, but the original value is kept, untouched. */
function exact<T>(shape: z.ZodType) {
  return z.custom<T>((value) => shape.safeParse(value).success);
}

const text = z.string();
const nullableText = z.string().nullable().default(null);
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
  activeBagId: nullableText,
});

export const BagSchema = z.object({
  id,
  name: text,
  roaster: nullableText,
  origin: nullableText,
  roastLevel: z.enum(ROAST_LEVELS).nullable().default(null),
  process: nullableText,
  notes: nullableText,
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

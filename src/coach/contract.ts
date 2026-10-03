/**
 * The coach's tool contract: what the model may call, and the exact input
 * shapes CafAI accepts back. One source of truth for:
 *   - src/llm (turns these zod schemas into strict JSON tool schemas),
 *   - src/coach (validates every model output with them before use),
 *   - src/ui (renders the UI tools as cards and chips),
 *   - mock/anthropic (the scripted fake emits inputs of these shapes).
 *
 * Rules for these schemas (strict tool use):
 *   - no `.optional()`: optional means `.nullable()`, so every key is required;
 *   - min/max/length constraints are enforced client-side by zod only (they
 *     are stripped from the JSON schema sent to the API);
 *   - every tool output is parsed with `safeParse` and then checked by the
 *     coach validators (template ids exist, lever bounds, one variable...).
 */
import { z } from 'zod';

export const TOOL = {
  /** UI tool: structured facts about the bag, saved on the bag record. */
  saveBagDetails: 'save_bag_details',
  /** UI tool: 2-5 template suggestions rendered as tappable cards. */
  proposeTemplates: 'propose_templates',
  /** UI tool: a question with tappable options; CafAI appends "Other" last. */
  askUser: 'ask_user',
  /** UI tool: the next change (one variable), shown as a diff with Confirm. */
  proposeAdjustment: 'propose_adjustment',
  /** Auto tools: read-only named queries over stored shots. No eval. */
  getShotSummary: 'get_shot_summary',
  getShotSeries: 'get_shot_series',
  getPhaseStats: 'get_phase_stats',
  compareShots: 'compare_shots',
  getBagHistory: 'get_bag_history',
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/** Tools resolved by a user tap (the engine waits for the user). */
export const UI_TOOLS: readonly ToolName[] = [TOOL.proposeTemplates, TOOL.askUser, TOOL.proposeAdjustment];

/** Tools the engine resolves immediately and sends straight back. */
export const AUTO_TOOLS: readonly ToolName[] = [
  TOOL.saveBagDetails,
  TOOL.getShotSummary,
  TOOL.getShotSeries,
  TOOL.getPhaseStats,
  TOOL.compareShots,
  TOOL.getBagHistory,
];

/** The label CafAI always appends as the last option of every ask_user. */
export const OTHER_OPTION = 'Other';

export const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

export const SaveBagDetailsInput = z.object({
  /** Short name used in profile titles ("<name> v1"), e.g. "Kiambu AA". */
  name: z.string().trim().min(1).max(40),
  roaster: z.string().max(60).nullable(),
  origin: z.string().max(80).nullable(),
  roastLevel: z.enum(ROAST_LEVELS).nullable(),
  process: z.string().max(40).nullable(),
  /** Tasting notes from the bag, comma separated. */
  notes: z.string().max(300).nullable(),
});
export type SaveBagDetails = z.infer<typeof SaveBagDetailsInput>;

export const CONFIDENCE = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const ProposeTemplatesInput = z.object({
  suggestions: z
    .array(
      z.object({
        templateId: z.string().min(1),
        confidence: z.enum(CONFIDENCE),
        /** One or two sentences: why this template suits this bag. */
        reason: z.string().min(1).max(240),
      }),
    )
    .min(2)
    .max(5),
});
export type ProposeTemplates = z.infer<typeof ProposeTemplatesInput>;

export const AskUserInput = z.object({
  question: z.string().min(1).max(200),
  /** 2-5 short options. Do not include "Other"; CafAI appends it last. */
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(5),
  multiSelect: z.boolean(),
});
export type AskUser = z.infer<typeof AskUserInput>;

export const VARIABLES = ['profile', 'grind', 'dose', 'none'] as const;
export type AdjustmentVariable = (typeof VARIABLES)[number];

export const ProposeAdjustmentInput = z.object({
  /**
   * The ONE variable this iteration changes. `profile` = one template lever
   * (a new profile version); `grind` / `dose` = manual steps at the grinder
   * or scale (no new profile version); `none` = keep everything (lock it in).
   */
  variable: z.enum(VARIABLES),
  /** Template lever id. Required when variable is "profile", else null. */
  lever: z.string().nullable(),
  /** New absolute lever value (profile) or new dose in grams (dose); else null. */
  value: z.number().nullable(),
  /** Required when variable is "grind", else null. */
  grind: z
    .object({
      direction: z.enum(['finer', 'coarser']),
      /** Steps on the grinder's own dial, when known. */
      amount: z.number().nullable(),
      /** Absolute target setting as written on the grinder, when known. */
      setting: z.string().max(20).nullable(),
    })
    .nullable(),
  /** One line, imperative: "Raise brew temperature by 1 °C". */
  summary: z.string().min(1).max(120),
  /** Why, citing the shot data and the taste feedback. */
  rationale: z.string().min(1).max(400),
  /** What the next shot should taste or look like if this works. */
  expectedEffect: z.string().min(1).max(200),
  /** Non-variable reminders, e.g. "keep the same dose and puck prep". */
  tips: z.array(z.string().min(1).max(160)).max(3),
});
export type ProposeAdjustment = z.infer<typeof ProposeAdjustmentInput>;

/** `latest`, `previous`, or a shot id from get_bag_history. */
export const ShotRefSchema = z.string().min(1);

export const SERIES_METRICS = [
  'pressure',
  'flow',
  'weight',
  'weightFlow',
  'temperature',
  'targetPressure',
  'targetFlow',
  'resistance',
] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];

export const GetShotSummaryInput = z.object({ shot: ShotRefSchema });
export const GetShotSeriesInput = z.object({
  shot: ShotRefSchema,
  metric: z.enum(SERIES_METRICS),
  /** Window in seconds from shot start; null = whole shot. */
  fromS: z.number().nullable(),
  toS: z.number().nullable(),
});
export const GetPhaseStatsInput = z.object({ shot: ShotRefSchema });
export const CompareShotsInput = z.object({ shotA: ShotRefSchema, shotB: ShotRefSchema });
export const GetBagHistoryInput = z.object({});

export const TOOL_INPUTS = {
  [TOOL.saveBagDetails]: SaveBagDetailsInput,
  [TOOL.proposeTemplates]: ProposeTemplatesInput,
  [TOOL.askUser]: AskUserInput,
  [TOOL.proposeAdjustment]: ProposeAdjustmentInput,
  [TOOL.getShotSummary]: GetShotSummaryInput,
  [TOOL.getShotSeries]: GetShotSeriesInput,
  [TOOL.getPhaseStats]: GetPhaseStatsInput,
  [TOOL.compareShots]: CompareShotsInput,
  [TOOL.getBagHistory]: GetBagHistoryInput,
} as const satisfies Record<ToolName, z.ZodType>;

/**
 * Markers that open engine-authored user turns, so the model (and the scripted
 * fake in mock/anthropic) can tell an app event from something the user typed.
 * Format: `${marker}\n${JSON payload}`.
 */
export const EVENT = {
  /** App context attached to the first user turn of a bag (grinder, scale). */
  context: '[context]',
  shotCompleted: '[event:shot_completed]',
  undo: '[event:undo]',
  bagResumed: '[event:bag_resumed]',
} as const;

/** Template ids, fixed for the conversation protocol (docs/briefs/ENGINE_PROTOCOL.md). */
export const TEMPLATE_IDS = ['blooming-espresso', 'd-flow', 'londonium'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

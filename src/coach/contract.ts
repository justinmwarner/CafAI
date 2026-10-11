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
  /** UI tool: add the grinder the user named to Decaid's grinder library, on a card they confirm (D125). */
  offerGrinder: 'offer_grinder',
  /** Auto tools: read-only named queries over stored shots. No eval. */
  getShotSummary: 'get_shot_summary',
  getShotSeries: 'get_shot_series',
  getPhaseStats: 'get_phase_stats',
  compareShots: 'compare_shots',
  getBagHistory: 'get_bag_history',
  /** Auto tool: DYE2's recent setups for this bag's coffee (D103). Read-only. */
  getRecentSetups: 'get_recent_setups',
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/** Tools resolved by a user tap (the engine waits for the user). */
export const UI_TOOLS: readonly ToolName[] = [TOOL.proposeTemplates, TOOL.askUser, TOOL.proposeAdjustment, TOOL.offerGrinder];

/** Tools the engine resolves immediately and sends straight back. */
export const AUTO_TOOLS: readonly ToolName[] = [
  TOOL.saveBagDetails,
  TOOL.getShotSummary,
  TOOL.getShotSeries,
  TOOL.getPhaseStats,
  TOOL.compareShots,
  TOOL.getBagHistory,
  TOOL.getRecentSetups,
];

/** The label CafAI always appends as the last option of every ask_user. */
export const OTHER_OPTION = 'Other';

export const ROAST_LEVELS = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;
export type RoastLevel = (typeof ROAST_LEVELS)[number];

/**
 * One of CafAI's five roast levels, matched whatever the case (a space or an
 * underscore counts as the hyphen): "Medium Light" from Decaid's bean
 * library or a photo of the bag is "medium-light". Null for anything else.
 */
export function toRoastLevel(value: unknown): RoastLevel | null {
  if (typeof value !== 'string') return null;
  const words = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return (ROAST_LEVELS as readonly string[]).includes(words) ? (words as RoastLevel) : null;
}

/** The longest text each bag detail takes, in characters (the bag photo's confirm card shows the same). */
export const BAG_LIMITS = { name: 40, roaster: 60, origin: 80, process: 40, notes: 300 } as const;

export const SaveBagDetailsInput = z.object({
  /** Short name used in profile titles ("<name> v1"), e.g. "Kiambu AA". */
  name: z.string().trim().min(1).max(BAG_LIMITS.name),
  roaster: z.string().max(BAG_LIMITS.roaster).nullable(),
  origin: z.string().max(BAG_LIMITS.origin).nullable(),
  roastLevel: z.enum(ROAST_LEVELS).nullable(),
  process: z.string().max(BAG_LIMITS.process).nullable(),
  /** Tasting notes from the bag, comma separated. */
  notes: z.string().max(BAG_LIMITS.notes).nullable(),
  /** The roast date printed on the bag (6.1). */
  roastDate: z.iso.date().nullable(),
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

/** The longest grinder name, burrs and setting, and the most settings: Settings' Add a grinder takes the same (GRINDER_LIMITS, src/api/grinders.ts). */
export const GRINDER_OFFER_LIMITS = { model: 60, burrs: 60, setting: 20, settings: 100 } as const;

export const OfferGrinderInput = z.object({
  /** The grinder's make and model as the user named it, e.g. "Mazzer Philos". */
  model: z.string().trim().min(1).max(GRINDER_OFFER_LIMITS.model),
  /** The burr set, when the user said it, e.g. "64 mm flat". */
  burrs: z.string().max(GRINDER_OFFER_LIMITS.burrs).nullable(),
  /** "numeric" (a numbered dial) or "preset" (a list of settings), when the user said. */
  settingType: z.enum(['numeric', 'preset']).nullable(),
  /** A numbered dial's smallest step, and its big step, when the user said them. */
  smallStep: z.number().positive().nullable(),
  bigStep: z.number().positive().nullable(),
  /** A preset grinder's settings, finest first, when the user listed them. */
  values: z.array(z.string().trim().min(1).max(GRINDER_OFFER_LIMITS.setting)).min(1).max(GRINDER_OFFER_LIMITS.settings).nullable(),
});
export type OfferGrinder = z.infer<typeof OfferGrinderInput>;

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
export const GetRecentSetupsInput = z.object({});

export const TOOL_INPUTS = {
  [TOOL.saveBagDetails]: SaveBagDetailsInput,
  [TOOL.proposeTemplates]: ProposeTemplatesInput,
  [TOOL.askUser]: AskUserInput,
  [TOOL.proposeAdjustment]: ProposeAdjustmentInput,
  [TOOL.offerGrinder]: OfferGrinderInput,
  [TOOL.getShotSummary]: GetShotSummaryInput,
  [TOOL.getShotSeries]: GetShotSeriesInput,
  [TOOL.getPhaseStats]: GetPhaseStatsInput,
  [TOOL.compareShots]: CompareShotsInput,
  [TOOL.getBagHistory]: GetBagHistoryInput,
  [TOOL.getRecentSetups]: GetRecentSetupsInput,
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
export const TEMPLATE_IDS = ['blooming-espresso', 'd-flow', 'londonium', 'allonge', 'gentle-and-sweet'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

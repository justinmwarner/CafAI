/**
 * CafAI coach logic: templates with bounded levers, Decaid profile identity,
 * the adjustment validator, plain-language diffs, the shot summary and the
 * model's query tools and prompt. Pure TypeScript: no React, fetch, storage
 * or timers. The shared shapes live in ./types.ts and ./contract.ts.
 */

// Profiles and identity
export {
  describePlan,
  normalizeProfile,
  parseDecaidProfile,
  ProfileError,
  profilePlan,
  profileTemperature,
  type DecaidProfile,
  type LooseProfile,
  type LooseProfileStep,
  type PlanPoint,
} from './profile.ts';
export { profileCompoundHash, profileHashes, profileId, profileMetadataHash, type ProfileHashes } from './profileId.ts';

// Templates and levers
export { getTemplate, TEMPLATES } from './templates/index.ts';
export {
  applyLever,
  effectiveBounds,
  findLever,
  LeverError,
  readLeverValue,
  readLeverValues,
  snapToGranularity,
} from './levers.ts';
export { knownDose, REFERENCE_DOSE_G } from './dose.ts';
export { buildStartingProfile, startingYield, startRatioOf } from './start.ts';

// Validation and change text
export {
  checkStructure,
  DOSE_RULES,
  GRIND_MAX_STEPS,
  validateProposal,
  validateTemplateSuggestions,
  type ChangePlan,
  type ContextPatch,
  type Validation,
  type ValidationContext,
} from './validator.ts';
export {
  describeLeverChange,
  describeManualChange,
  describeManualSteps,
  diffProfiles,
  formatLeverValue,
  type GrindTextOptions,
  type ManualSettings,
} from './diff.ts';
export { decaidStepNote } from './grinder.ts';

// Shots
export { resampleSeries, shotPhases, summarizeShot, summaryForModel } from './summary/summarize.ts';
export {
  analyseShot,
  CHANNELING_THRESHOLDS,
  shotRows,
  type Channeling,
  type ChannelingIndicator,
  type ChannelingIndicatorId,
  type PuckResistance,
  type ShotAnalysis,
  type ShotMetrics,
  type ShotRow,
} from './summary/analysis.ts';
export { elapsedSeconds, parseTimestampMicros } from './summary/time.ts';
export { brewRatio } from './summary/curves.ts';

// The model: query tools, tool descriptions, system prompt, chips, versions
export {
  compareShots,
  createShotSource,
  getBagHistory,
  getPhaseStats,
  getShotSeries,
  getShotSummary,
  QUERY_TOOLS,
  runQueryTool,
  type QueryContext,
  type QueryResult,
  type ResolvedShot,
  type ShotSource,
} from './queries.ts';
export { COACH_TOOL_SPECS } from './tools.ts';
export { buildSystemPrompt, type SystemPromptOptions } from './prompt.ts';
export { COACH_HEURISTICS, type CoachHeuristics } from './heuristics.ts';
export { DEFAULT_TASTE_OPTIONS, isOtherLike, withOther } from './feedback.ts';
export { buildVersionProfile, MAX_TITLE_LENGTH, versionTitle } from './version.ts';

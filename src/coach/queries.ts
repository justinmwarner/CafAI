/**
 * The named, read-only queries behind the model's auto tools
 * (get_shot_summary, get_shot_series, get_phase_stats, compare_shots,
 * get_bag_history, get_recent_setups). Every query returns compact JSON-ready
 * data or an error sentence the model can act on. There is no eval and no
 * free-form code: the model can only pick a shot, a metric and a time window.
 */
import type { Dye2Data, Dye2Setup } from '../api/pluginData.ts';
import type { ShotRecord } from '../api/types.ts';
import type { Bag, IterationRecord, ProfileVersion } from '../storage/types.ts';
import { TOOL, TOOL_INPUTS, type SeriesMetric } from './contract.ts';
import { diffProfiles } from './diff.ts';
import { readingOf } from './extraction.ts';
import { normalizeProfile } from './profile.ts';
import { profileId } from './profileId.ts';
import { localDay } from './roastAge.ts';
import { shotRows, type ShotRow } from './summary/analysis.ts';
import { analyseFlowPhases, stallVerdict } from './summary/phases.ts';
import { pourStartIndex, resampleValues, secondsGrid, summarizeShot, summaryForModel } from './summary/summarize.ts';
import { parseTimestampMicros } from './summary/time.ts';
import type { ProfileJson, ShotSummary } from './types.ts';

/** A shot record with its summary. */
export interface ResolvedShot {
  record: ShotRecord;
  summary: ShotSummary;
}

/** Resolves "latest", "previous" or a shot id among the bag's shots. */
export interface ShotSource {
  resolve(ref: string): ResolvedShot | null;
  /** How many shots the source holds (for messages). */
  readonly size: number;
}

export type QueryResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const ok = (data: Record<string, unknown>): QueryResult => ({ ok: true, data });
const fail = (error: string): QueryResult => ({ ok: false, error });

const isResolved = (entry: ShotRecord | ResolvedShot): entry is ResolvedShot => 'record' in entry && 'summary' in entry;

/**
 * A ShotSource over the bag's shots, newest first by shot timestamp whatever
 * the input order. Records without a stored summary are summarized on first
 * use.
 */
export function createShotSource(shots: readonly (ShotRecord | ResolvedShot)[]): ShotSource {
  const entries = shots.map((entry, index) => {
    const record = isResolved(entry) ? entry.record : entry;
    return {
      record,
      summary: isResolved(entry) ? entry.summary : null,
      micros: parseTimestampMicros(record.timestamp) ?? -1,
      index,
    };
  });
  entries.sort((a, b) => b.micros - a.micros || b.index - a.index);
  const resolved = new Map<number, ResolvedShot>();

  const at = (position: number): ResolvedShot | null => {
    const entry = entries[position];
    if (!entry) return null;
    let shot = resolved.get(position);
    if (!shot) {
      shot = { record: entry.record, summary: entry.summary ?? summarizeShot(entry.record) };
      resolved.set(position, shot);
    }
    return shot;
  };

  return {
    size: entries.length,
    resolve(ref: string): ResolvedShot | null {
      const key = ref.trim();
      if (key === 'latest') return at(0);
      if (key === 'previous') return at(1);
      const position = entries.findIndex((entry) => entry.record.id === key);
      return position < 0 ? null : at(position);
    },
  };
}

function resolveShot(source: ShotSource, ref: string): ResolvedShot | string {
  const shot = source.resolve(ref);
  if (shot) return shot;
  if (source.size === 0) return 'No shots recorded for this bag yet. Ask the user to pull a shot first.';
  return `No shot "${ref}". Use "latest", "previous", or a shotId from get_bag_history.`;
}

/** get_shot_summary: aggregates and phases (the series come from get_shot_series). */
export function getShotSummary(source: ShotSource, ref: string): QueryResult {
  const shot = resolveShot(source, ref);
  return typeof shot === 'string' ? fail(shot) : ok({ ...summaryForModel(shot.summary) });
}

const SERIES_UNITS: Record<SeriesMetric, string> = {
  pressure: 'bar',
  flow: 'ml/s',
  weight: 'g',
  weightFlow: 'g/s',
  temperature: '°C',
  targetPressure: 'bar',
  targetFlow: 'ml/s',
  resistance: 'bar·s²/ml²',
};

/** Below this pump flow, pressure / flow² is noise (decaid-mcp's MIN_RESISTANCE_FLOW). */
const MIN_RESISTANCE_FLOW = 0.4;

function resistanceOf(row: ShotRow): number | null {
  if (row.pressure === null || row.flow === null || row.flow < MIN_RESISTANCE_FLOW || row.pressure <= 0) return null;
  return row.pressure / (row.flow * row.flow);
}

/**
 * get_shot_series: one metric at about 1 Hz from shot start (preheat
 * included), optionally windowed. Resistance is pressure / pump flow²,
 * computed from the raw samples.
 */
export function getShotSeries(
  source: ShotSource,
  ref: string,
  metric: SeriesMetric,
  fromS: number | null,
  toS: number | null,
): QueryResult {
  const shot = resolveShot(source, ref);
  if (typeof shot === 'string') return fail(shot);
  if ((fromS !== null && !Number.isFinite(fromS)) || (toS !== null && !Number.isFinite(toS))) {
    return fail('fromS and toS must be numbers of seconds, or null for the whole shot.');
  }
  if (fromS !== null && toS !== null && fromS > toS) return fail(`fromS (${fromS}) is after toS (${toS}); swap them.`);

  const { series } = shot.summary;
  let tS = series.tS;
  let metricValues: (number | null)[];
  if (metric === 'resistance') {
    const rows = shotRows(shot.record);
    tS = secondsGrid(rows);
    metricValues = resampleValues(rows, tS, resistanceOf);
  } else {
    metricValues = series[metric];
  }

  const lo = fromS ?? Number.NEGATIVE_INFINITY;
  const hi = toS ?? Number.POSITIVE_INFINITY;
  const keep = tS.map((t, i) => (t >= lo && t <= hi ? i : -1)).filter((i) => i >= 0);
  if (keep.length === 0) {
    // durationS is the pour, not the end of this clock: say where the samples end.
    const end = tS[tS.length - 1];
    if (end === undefined) return fail('This shot has no samples.');
    return fail(
      `No samples between ${fromS ?? 0} and ${toS ?? 'the end'} s; the samples end at ${end.toFixed(1)} s on the shot clock (t = 0 is the start of preheat).`,
    );
  }
  return ok({
    shotId: shot.summary.shotId,
    metric,
    unit: SERIES_UNITS[metric],
    tS: keep.map((i) => tS[i]!),
    values: keep.map((i) => metricValues[i] ?? null),
  });
}

const round = (value: number | null, digits: number): number | null =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

function stats(values: readonly number[]): { mean: number | null; max: number | null } {
  if (values.length === 0) return { mean: null, max: null };
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) };
}

const pickValues = (rows: readonly ShotRow[], pick: (row: ShotRow) => number | null) =>
  rows.map(pick).filter((v): v is number => v !== null);

/**
 * get_phase_stats: per phase (preheat, then each profile step) the pressure,
 * flow, weight gain and temperature, plus Crema's read of the pre-pour stall
 * (high stall pressure = the puck is choking; low = the profile holds low).
 */
export function getPhaseStats(source: ShotSource, ref: string): QueryResult {
  const shot = resolveShot(source, ref);
  if (typeof shot === 'string') return fail(shot);
  const rows = shotRows(shot.record);
  const phases = shot.summary.phases;

  const phaseStats = phases.map((phase, i) => {
    const last = i === phases.length - 1;
    const inPhase = rows.filter((r) => r.t >= phase.startS - 1e-6 && (last ? r.t <= phase.endS + 1e-6 : r.t < phase.endS - 1e-6));
    const pressure = stats(pickValues(inPhase, (r) => r.pressure));
    const flow = stats(pickValues(inPhase, (r) => r.flow));
    const weights = pickValues(inPhase, (r) => r.weight);
    const targetPressure = stats(pickValues(inPhase, (r) => (r.targetPressure !== null && r.targetPressure > 0.5 ? r.targetPressure : null)));
    const targetFlow = stats(pickValues(inPhase, (r) => (r.targetFlow !== null && r.targetFlow > 0.1 ? r.targetFlow : null)));
    const preheat = phase.name === 'preheat';
    return {
      name: phase.name,
      startS: phase.startS,
      endS: phase.endS,
      durationS: round(phase.endS - phase.startS, 1),
      pressureMeanBar: round(pressure.mean, 1),
      pressureMaxBar: round(pressure.max, 1),
      flowMeanMlS: round(flow.mean, 2),
      flowMaxMlS: round(flow.max, 2),
      weightGainG: weights.length > 1 ? round(weights[weights.length - 1]! - weights[0]!, 1) : null,
      meanWeightFlowGs: round(stats(pickValues(inPhase, (r) => r.weightFlow)).mean, 2),
      tempMeanC: round(stats(pickValues(inPhase, (r) => r.groupTemp)).mean, 1),
      // Targets during preheat are left over from the previous shot.
      targetPressureBar: preheat ? null : round(targetPressure.mean, 1),
      targetFlowMlS: preheat ? null : round(targetFlow.mean, 2),
    };
  });

  const pour = rows.slice(pourStartIndex(rows));
  const flowPhases = analyseFlowPhases({
    elapsedS: pour.map((r) => r.t),
    pressureBar: pour.map((r) => r.pressure ?? 0),
    flowMlS: pour.map((r) => r.flow ?? 0),
    weightFlow: pour.some((r) => r.weightFlow !== null) ? pour.map((r) => r.weightFlow ?? 0) : null,
  });

  return ok({
    shotId: shot.summary.shotId,
    phases: phaseStats,
    flowAnalysis: flowPhases
      ? {
          source: flowPhases.source,
          unit: flowPhases.unit,
          choked: flowPhases.choked,
          firstRealFlowS: flowPhases.preinfusionS,
          pourDurationS: flowPhases.pourDurationS,
          pourAvg: flowPhases.pourAvg,
          pourPeak: flowPhases.pourPeak,
          stallAvgBar: flowPhases.stallAvgBar,
          stallPeakBar: flowPhases.stallPeakBar,
          stallVerdict: stallVerdict(flowPhases),
        }
      : null,
  });
}

const COMPARED: ReadonlyArray<keyof ShotSummary> = [
  'durationS',
  'doseG',
  'yieldG',
  'ratio',
  'timeToFirstDropS',
  'preinfusionEndS',
  'peakPressureBar',
  'meanPourFlowMlS',
  'meanPourWeightFlowGs',
  'meanTempC',
  'tempDeviationC',
  // The barista's refractometer reading, when both shots have one (D-TDS-5).
  'tdsPct',
  'eyPct',
];

function safeId(profile: unknown): string | null {
  try {
    return profileId(profile);
  } catch {
    return null;
  }
}

function safeProfile(profile: unknown): ProfileJson | null {
  try {
    return normalizeProfile(profile);
  } catch {
    return null;
  }
}

/** compare_shots: both shots' aggregates, B minus A for each number, and any profile difference. */
export function compareShots(source: ShotSource, refA: string, refB: string): QueryResult {
  const a = resolveShot(source, refA);
  if (typeof a === 'string') return fail(a);
  const b = resolveShot(source, refB);
  if (typeof b === 'string') return fail(b);
  if (a.record.id === b.record.id) return fail(`"${refA}" and "${refB}" are the same shot. Pick two different shots to compare.`);

  const delta: Record<string, number | null> = {};
  for (const key of COMPARED) {
    const va = a.summary[key];
    const vb = b.summary[key];
    delta[key] = typeof va === 'number' && typeof vb === 'number' ? round(vb - va, 2) : null;
  }
  const idA = safeId(a.record.workflow?.profile);
  const idB = safeId(b.record.workflow?.profile);
  const profileA = safeProfile(a.record.workflow?.profile);
  const profileB = safeProfile(b.record.workflow?.profile);

  const brief = (summary: ShotSummary) => {
    const { phases: _phases, ...rest } = summaryForModel(summary);
    return rest;
  };
  return ok({
    a: brief(a.summary),
    b: brief(b.summary),
    delta,
    sameProfile: idA !== null && idA === idB,
    profileChanges: profileA && profileB ? diffProfiles(profileA, profileB) : [],
  });
}

function describeProposal(proposal: IterationRecord['proposal']): string | null {
  if (!proposal) return null;
  switch (proposal.variable) {
    case 'profile':
      return `profile ${proposal.lever ?? '?'} -> ${proposal.value ?? '?'}`;
    case 'dose':
      return `dose -> ${proposal.value ?? '?'} g`;
    case 'grind': {
      const g = proposal.grind;
      if (!g) return 'grind';
      const amount = g.amount !== null ? ` ${g.amount} step${g.amount === 1 ? '' : 's'}` : '';
      return `grind${amount} ${g.direction}${g.setting ? ` to ${g.setting}` : ''}`;
    }
    case 'none':
      return 'none (keep everything)';
  }
}

const HISTORY_ITERATIONS = 20;

/**
 * get_bag_history: the bag's profile versions and its most recent dial-in
 * iterations (shot ids, taste, what was proposed and what happened), oldest
 * first.
 */
export function getBagHistory(versions: readonly ProfileVersion[], iterations: readonly IterationRecord[]): QueryResult {
  const byTime = (a: { createdAt: string }, b: { createdAt: string }) =>
    (parseTimestampMicros(a.createdAt) ?? 0) - (parseTimestampMicros(b.createdAt) ?? 0);

  return ok({
    versions: [...versions]
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        version: v.version,
        title: v.title,
        templateId: v.templateId,
        status: v.status,
        change: v.change
          ? { variable: v.change.variable, lever: v.change.lever, from: v.change.from, to: v.change.to, summary: v.change.summary }
          : null,
      })),
    iterations: [...iterations]
      .sort(byTime)
      .slice(-HISTORY_ITERATIONS)
      .map((it) => ({
        shotId: it.shotId,
        version: it.profileVersion,
        taste: it.feedback?.selected ?? null,
        note: it.feedback?.otherText ?? null,
        proposal: describeProposal(it.proposal),
        outcome: it.outcome,
        shot: it.summary
          ? {
              durationS: it.summary.durationS,
              yieldG: it.summary.yieldG,
              ratio: it.summary.ratio,
              timeToFirstDropS: it.summary.timeToFirstDropS,
              peakPressureBar: it.summary.peakPressureBar,
              channelingFlags: it.summary.channelingFlags,
              // The barista's refractometer reading, when there is one (D-TDS-5).
              ...readingOf(it.summary),
            }
          : null,
      })),
  });
}

/**
 * What a bag's DYE2 setups are matched on: its Decaid link, and the batches
 * of its bean in Decaid's library (its earlier roasts) when the engine read
 * them; else its name and roaster.
 */
export type BagIdentity = Pick<Bag, 'name' | 'roaster' | 'decaidBeanId' | 'decaidBatchId'> & { beanBatchIds?: readonly string[] };

/** At most this many setups go to the model: DYE2 lists the newest first. */
const MAX_SETUPS = 10;

const sameText = (a: string | null, b: string | null) => a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether a DYE2 setup was made with this bag's coffee, and with its very
 * batch: true for the bag's batch, false for an earlier batch of the same
 * bean, null when DYE2 or the bag knows no batch (a recipe names the bean;
 * otherwise the coffee's name and roaster tell, a roaster either side left
 * out not counting against it). Undefined for another coffee.
 */
function sameBatchOf(setup: Dye2Setup, bag: BagIdentity): boolean | null | undefined {
  const batchId = bag.decaidBatchId ?? null;
  if (batchId !== null && setup.beanBatchId !== null) {
    if (setup.beanBatchId === batchId) return true;
    return bag.beanBatchIds?.includes(setup.beanBatchId) ? false : undefined;
  }
  const beanId = bag.decaidBeanId ?? null;
  if (beanId !== null && setup.beanId !== null) return setup.beanId === beanId ? null : undefined;
  if (!sameText(setup.coffeeName, bag.name)) return undefined;
  return bag.roaster === null || setup.coffeeRoaster === null || sameText(setup.coffeeRoaster, bag.roaster) ? null : undefined;
}

/**
 * get_recent_setups (6.5): the setups DYE2 recorded for this bag's coffee,
 * newest first, each with its kind (a recent one DYE2 saw used, or a
 * favourite or recipe the user saved) and whether it was this very batch,
 * with the equipment and basket names DYE2 knows; {"available":false}
 * without DYE2.
 */
export function getRecentSetups(dye2: Dye2Data | null, bag: BagIdentity): QueryResult {
  if (!dye2) return ok({ available: false });
  const setups = dye2.setups.flatMap((setup) => {
    const sameBatch = sameBatchOf(setup, bag);
    return sameBatch === undefined ? [] : [{ setup, sameBatch }];
  });
  return ok({
    available: true,
    setups: setups.slice(0, MAX_SETUPS).map(({ setup, sameBatch }) => ({
      kind: setup.kind,
      sameBatch,
      profileTitle: setup.profileTitle,
      grindSetting: setup.grindSetting,
      doseG: setup.doseG,
      yieldG: setup.yieldG,
      rpm: setup.rpm,
      basket: setup.basket,
      date: localDay(setup.capturedAt),
    })),
    equipment: dye2.equipment,
    baskets: dye2.baskets,
  });
}

/** What the query tools read from. */
export interface QueryContext {
  source: ShotSource;
  versions: readonly ProfileVersion[];
  iterations: readonly IterationRecord[];
  /** get_recent_setups: DYE2's data as the engine read it from Decaid, null without DYE2. */
  dye2?: Dye2Data | null;
  /** get_recent_setups: the bag on screen. */
  bag?: BagIdentity;
}

/** The auto tools answered by these queries (save_bag_details is the engine's). */
export const QUERY_TOOLS = [
  TOOL.getShotSummary,
  TOOL.getShotSeries,
  TOOL.getPhaseStats,
  TOOL.compareShots,
  TOOL.getBagHistory,
  TOOL.getRecentSetups,
] as const;

/**
 * Run one query tool on raw tool input: validate it with the contract schema,
 * run the query, and return compact JSON (or an error sentence) for the
 * tool_result, in the shape of the runner's ToolOutcome.
 */
export function runQueryTool(name: string, input: unknown, ctx: QueryContext): { content: string; isError: boolean } {
  const answer = (result: QueryResult) =>
    result.ok ? { content: JSON.stringify(result.data), isError: false } : { content: result.error, isError: true };
  const parse = <T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }) => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`);
    return { invalid: `Invalid ${name} input. ${issues.join('; ')}` };
  };
  const invalid = (value: unknown): value is { invalid: string } =>
    typeof value === 'object' && value !== null && 'invalid' in value;

  switch (name) {
    case TOOL.getShotSummary: {
      const value = parse(TOOL_INPUTS[TOOL.getShotSummary]);
      return invalid(value) ? { content: value.invalid, isError: true } : answer(getShotSummary(ctx.source, value.shot));
    }
    case TOOL.getShotSeries: {
      const value = parse(TOOL_INPUTS[TOOL.getShotSeries]);
      return invalid(value)
        ? { content: value.invalid, isError: true }
        : answer(getShotSeries(ctx.source, value.shot, value.metric, value.fromS, value.toS));
    }
    case TOOL.getPhaseStats: {
      const value = parse(TOOL_INPUTS[TOOL.getPhaseStats]);
      return invalid(value) ? { content: value.invalid, isError: true } : answer(getPhaseStats(ctx.source, value.shot));
    }
    case TOOL.compareShots: {
      const value = parse(TOOL_INPUTS[TOOL.compareShots]);
      return invalid(value) ? { content: value.invalid, isError: true } : answer(compareShots(ctx.source, value.shotA, value.shotB));
    }
    case TOOL.getBagHistory: {
      const value = parse(TOOL_INPUTS[TOOL.getBagHistory]);
      return invalid(value) ? { content: value.invalid, isError: true } : answer(getBagHistory(ctx.versions, ctx.iterations));
    }
    case TOOL.getRecentSetups: {
      const value = parse(TOOL_INPUTS[TOOL.getRecentSetups]);
      if (invalid(value)) return { content: value.invalid, isError: true };
      if (!ctx.bag) return { content: 'No bag is active.', isError: true };
      return answer(getRecentSetups(ctx.dye2 ?? null, ctx.bag));
    }
    default:
      return { content: `${name} is not a query tool.`, isError: true };
  }
}

/**
 * The compact shot summary handed to the model and the UI: aggregates plus
 * ~1 Hz series.
 *
 * Time base: machine timestamps relative to the first sample, which is the
 * start of preheat (`preparingForShot`), not pump start; the phases list says
 * where preheat ends. profileFrame is stale until the first preinfusion or
 * pouring sample, so phases before it are "preheat" whatever the frame says.
 *
 * durationS is not a time on that clock but the pour (`pourSeconds`), which
 * is what the machine panel's timer counts too. Decaid records from preheat
 * and stops recording at its stop decision, leaving out the frame it stopped
 * on and its 4-5 s stopping phase, so the pour ends on the last recorded
 * frame; Decaid's own Visualizer upload times a shot over the same frames.
 * pourStartS is where that pour starts on the clock, so the times a barista
 * sees can count from it (pourClock.ts) while the rest stays where the
 * heuristics and the query tools read it.
 *
 * Dose is annotations.actualDoseWeight ?? workflow.context.targetDoseWeight;
 * yield is annotations.actualYield (Decaid's weight once the cup has settled
 * after the stop) ?? the last scale weight; the target yield is
 * workflow.context.targetYield (0 = stop-at-weight off). A TDS is
 * annotations.drinkTds when the record has one, its EY worked out from that
 * dose and yield (extraction.ts, D166); Decaid's own drinkEy is not read.
 */
import type { ShotRecord } from '../../api/types.ts';
import { extractionYield, isTds, roundTds } from '../extraction.ts';
import type { ProfileStep, ShotPhase, ShotSeries, ShotSummary } from '../types.ts';
import { analyseShot, shotRows, type ShotRow } from './analysis.ts';

const POUR_SUBSTATES = new Set(['preinfusion', 'pouring']);
const PREHEAT_SUBSTATE = 'preparingForShot';
/** Decaid's sequencer ends the pour at the first frame the machine reports in one of these (shot_sequencer.dart). */
const POUR_OVER_SUBSTATES = new Set(['pouringDone', 'idle']);

/** A sample counts for a grid second only if it is this close to it. */
const MAX_SAMPLE_GAP_S = 0.6;

function round(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
}

const r1 = (value: number | null | undefined) => round(value, 1);
const r2 = (value: number | null | undefined) => round(value, 2);

const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** Index of the first row at or after `t` (rows sorted by time). */
function lowerBound(rows: readonly ShotRow[], t: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The value of the sample nearest to `t` that has one, if it is close enough. */
function nearestValue(rows: readonly ShotRow[], t: number, pick: (row: ShotRow) => number | null): number | null {
  const start = lowerBound(rows, t);
  let best: { gap: number; value: number } | null = null;
  for (let i = start - 1; i >= 0; i--) {
    const gap = t - rows[i]!.t;
    if (gap > MAX_SAMPLE_GAP_S) break;
    const value = pick(rows[i]!);
    if (value !== null) {
      best = { gap, value };
      break;
    }
  }
  for (let i = start; i < rows.length; i++) {
    const gap = rows[i]!.t - t;
    if (gap > MAX_SAMPLE_GAP_S || (best !== null && gap >= best.gap)) break;
    const value = pick(rows[i]!);
    if (value !== null) {
      best = { gap, value };
      break;
    }
  }
  return best?.value ?? null;
}

/** Whole seconds from 0 to the last sample, plus the last sample's time (0.1 s). */
export function secondsGrid(rows: readonly ShotRow[]): number[] {
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return [];
  const grid: number[] = [];
  for (let t = 0; t <= lastRow.t + 1e-9; t++) grid.push(t);
  const end = r1(lastRow.t)!;
  if (end - grid[grid.length - 1]! >= 0.05) grid.push(end);
  return grid;
}

/** One value per grid second: the nearest sample within 0.6 s that has one, rounded to 0.1. */
export function resampleValues(
  rows: readonly ShotRow[],
  grid: readonly number[],
  pick: (row: ShotRow) => number | null,
): (number | null)[] {
  return grid.map((t) => r1(nearestValue(rows, t, pick)));
}

/** Index of the first sample of the pour (preinfusion or pouring); 0 when no substates were recorded. */
export function pourStartIndex(rows: readonly ShotRow[]): number {
  const index = rows.findIndex((row) => row.substate !== null && POUR_SUBSTATES.has(row.substate));
  return index < 0 ? 0 : index;
}

const pourIsOver = (row: ShotRow) => row.substate !== null && POUR_OVER_SUBSTATES.has(row.substate);

/** Index of the first sample after preheat, where the pour's time starts; -1 when only preheat was recorded. */
const firstAfterPreheat = (rows: readonly ShotRow[]) => rows.findIndex((row) => row.substate !== PREHEAT_SUBSTATE);

/**
 * Where the pour starts on the shot's clock: the time of the first sample
 * after preheat, which pourSeconds counts from. 0 when nothing but preheat
 * (or nothing at all) was recorded, which leaves every time as it is.
 */
export function pourStartSeconds(rows: readonly ShotRow[]): number {
  const start = firstAfterPreheat(rows);
  return start < 0 ? 0 : rows[start]!.t;
}

/**
 * Seconds of pour: from the first sample after preheat to the last one
 * before the machine reports the pour over. In Decaid's own records that is
 * the last sample; a record that carries a stopping tail ends before it.
 * The machine panel's timer applies the same rule to the live frames
 * (src/ui/machine/shotBuffer.ts). Null when nothing was poured.
 */
export function pourSeconds(rows: readonly ShotRow[]): number | null {
  const start = firstAfterPreheat(rows);
  if (start < 0) return null;
  let end = start;
  if (!pourIsOver(rows[start]!)) {
    while (end + 1 < rows.length && !pourIsOver(rows[end + 1]!)) end += 1;
  }
  return rows[end]!.t - rows[start]!.t;
}

/**
 * Resample to whole seconds by timestamp (never by index: real sampling is
 * ~3.7 Hz and irregular), plus the final sample. Each value is the nearest
 * real sample within 0.6 s, rounded to 0.1; null when there is none. Machine
 * targets are blanked during preheat, where they are left over from the
 * previous shot.
 */
export function resampleSeries(rows: readonly ShotRow[]): ShotSeries {
  const grid = secondsGrid(rows);
  const pourStartT = rows.length > 0 ? rows[pourStartIndex(rows)]!.t : 0;
  const targetAfterPreheat = (pick: (row: ShotRow) => number | null) => (row: ShotRow) =>
    row.t < pourStartT ? null : pick(row);

  return {
    tS: grid,
    pressure: resampleValues(rows, grid, (r) => r.pressure),
    flow: resampleValues(rows, grid, (r) => r.flow),
    weight: resampleValues(rows, grid, (r) => r.weight),
    weightFlow: resampleValues(rows, grid, (r) => r.weightFlow),
    temperature: resampleValues(rows, grid, (r) => r.groupTemp),
    targetPressure: resampleValues(rows, grid, targetAfterPreheat((r) => r.targetPressure)),
    targetFlow: resampleValues(rows, grid, targetAfterPreheat((r) => r.targetFlow)),
  };
}

/**
 * Contiguous phases: "preheat" until the first preinfusion/pouring sample,
 * then one phase per profile step (named after the step when the profile is
 * known, else after the machine substate).
 */
export function shotPhases(rows: readonly ShotRow[], steps: readonly Pick<ProfileStep, 'name'>[] | null): ShotPhase[] {
  const pourStart = pourStartIndex(rows);
  const labels = rows.map((row, i) => {
    if (i < pourStart) return 'preheat';
    const step = row.frame !== null ? steps?.[row.frame] : undefined;
    return step?.name ?? row.substate ?? (row.frame !== null ? `step ${row.frame + 1}` : 'shot');
  });

  const phases: ShotPhase[] = [];
  labels.forEach((name, i) => {
    const current = phases[phases.length - 1];
    if (current && current.name === name) return;
    const t = r1(rows[i]!.t)!;
    if (current) current.endS = t;
    phases.push({ name, startS: t, endS: t });
  });
  const lastPhase = phases[phases.length - 1];
  if (lastPhase) lastPhase.endS = r1(rows[rows.length - 1]!.t)!;
  return phases;
}

const RESISTANCE_TREND: Record<string, ShotSummary['resistanceTrend']> = {
  steep_decline: 'falling',
  declining: 'falling',
  steady: 'flat',
  rising: 'rising',
};

/** Decaid's drinkTds, when the record has one CafAI takes, with its EY from the summary's dose and yield; nothing otherwise. */
function recordedReading(drinkTds: unknown, doseG: number | null, yieldG: number | null): Pick<ShotSummary, 'tdsPct' | 'eyPct'> {
  if (!isTds(drinkTds)) return {};
  const tdsPct = roundTds(drinkTds);
  return { tdsPct, eyPct: extractionYield(tdsPct, doseG, yieldG) };
}

/** The summary without its series: the `summary` of an [event:shot_completed] payload. */
export function summaryForModel(summary: ShotSummary): Omit<ShotSummary, 'series'> {
  const { series: _series, ...rest } = summary;
  return rest;
}

/** Aggregates, phases and ~1 Hz series for one Decaid shot record. */
export function summarizeShot(record: ShotRecord): ShotSummary {
  const rows = shotRows(record);
  const { metrics, resistance, channeling } = analyseShot(rows);
  const context = record.workflow?.context ?? {};
  const annotations = record.annotations ?? {};

  const lastWeight = [...rows].reverse().find((row) => row.weight !== null)?.weight ?? null;
  const doseG = positive(annotations.actualDoseWeight) ?? positive(context.targetDoseWeight);
  // A missing, untared or knocked scale makes its last reading meaningless.
  const yieldG = positive(annotations.actualYield) ?? (metrics.scaleUnreliable ? null : positive(lastWeight));
  const steps = Array.isArray(record.workflow?.profile?.steps) ? record.workflow.profile.steps : null;

  return {
    shotId: record.id,
    timestamp: record.timestamp,
    profileTitle: record.workflow?.profile?.title ?? null,
    durationS: r1(pourSeconds(rows)) ?? 0,
    pourStartS: r1(pourStartSeconds(rows)) ?? 0,
    doseG: r1(doseG),
    yieldG: r1(yieldG),
    ratio: doseG !== null && yieldG !== null ? r2(yieldG / doseG) : null,
    ...recordedReading(annotations.drinkTds, r1(doseG), r1(yieldG)),
    targetYieldG: r1(positive(context.targetYield)),
    timeToFirstDropS: r1(metrics.timeToFirstDropS),
    preinfusionEndS: r1(metrics.preinfusionEndS),
    peakPressureBar: r1(metrics.peakPressureBar),
    peakPressureAtS: r1(metrics.peakPressureAtS),
    meanPourFlowMlS: r2(metrics.meanPourFlowMlS),
    meanPourWeightFlowGs: metrics.scaleUnreliable ? null : r2(metrics.meanPourWeightFlowGs),
    meanTempC: r1(metrics.meanPourTempC),
    tempDeviationC: r1(metrics.tempDeviationC),
    resistanceTrend: resistance?.trend ? (RESISTANCE_TREND[resistance.trend] ?? null) : null,
    channelingFlags: [...channeling.fired],
    stopReason: record.stopReason ?? null,
    phases: shotPhases(rows, steps),
    series: resampleSeries(rows),
  };
}

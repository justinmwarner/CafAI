/**
 * Shot diagnostics: first drops, preinfusion end, pressure peaks, puck
 * resistance and five channeling indicators.
 *
 * Ported from decaid-mcp plugin.js sections 2-4 (rowBuilder, coreMetrics,
 * settledWindow, puckResistance, flowJitter, flowDivergence, channeling) at
 * https://github.com/The-Walker443/decaid-mcp @ aecef96b870e4f3567ed5f08c876f77adf25f5a7,
 * Copyright (C) 2026 The-Walker443, licensed GPL-3.0-or-later and used here
 * under GPL-3.0. decaid-mcp itself ports decentespresso-mcp's metrics.py; its
 * thresholds sit at percentiles of a real shot archive (~250 ms sampling) and
 * are copied unchanged, as are its definitions. Parity is tested against its
 * golden files on real Decaid shots (summary/analysis.test.ts).
 *
 * Differences from decaid-mcp: plain JavaScript rounding instead of Python's
 * ties-to-even (exact binary ties only), rows without a readable timestamp are
 * skipped instead of placed at t = 0, and two CafAI aggregates are added (mean
 * pump flow and mean absolute temperature deviation during the pour).
 */
import type { ShotRecord } from '../../api/types.ts';
import { parseTimestampMicros } from './time.ts';

/** One measurement, timed in seconds from the first sample (shot start, preheat included). */
export interface ShotRow {
  t: number;
  pressure: number | null;
  /** Pump flow into the puck, ml/s ("flow_in"). */
  flow: number | null;
  weight: number | null;
  /** Scale flow out of the puck, g/s ("flow_out"). */
  weightFlow: number | null;
  /** Group (basket) temperature, which the profiles' "coffee" sensor targets. */
  groupTemp: number | null;
  mixTemp: number | null;
  targetPressure: number | null;
  targetFlow: number | null;
  targetGroupTemp: number | null;
  targetMixTemp: number | null;
  /** 0-based profile step; stale until the first preinfusion/pouring sample. */
  frame: number | null;
  state: string | null;
  substate: string | null;
  volume: number | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Rows from a shot record, ordered by machine timestamp relative to the first
 * sample. Samples with an unreadable time, or a time already seen, are skipped.
 */
export function shotRows(record: Pick<ShotRecord, 'measurements'>): ShotRow[] {
  const measurements: unknown[] = Array.isArray(record.measurements) ? record.measurements : [];
  const stamped: Array<{ micros: number; point: Record<string, unknown> }> = [];
  for (const point of measurements) {
    if (!isRecord(point)) continue;
    const machine = isRecord(point['machine']) ? point['machine'] : {};
    const micros = parseTimestampMicros(machine['timestamp']);
    if (micros !== null) stamped.push({ micros, point });
  }
  const base = stamped[0]?.micros;
  if (base === undefined) return [];

  const seen = new Set<number>();
  const rows: ShotRow[] = [];
  for (const { micros, point } of stamped) {
    if (seen.has(micros)) continue;
    seen.add(micros);
    const machine = isRecord(point['machine']) ? point['machine'] : {};
    const scale = isRecord(point['scale']) ? point['scale'] : {};
    const state = isRecord(machine['state']) ? machine['state'] : {};
    rows.push({
      t: (micros - base) / 1e6,
      pressure: toNumber(machine['pressure']),
      flow: toNumber(machine['flow']),
      weight: toNumber(scale['weight']),
      weightFlow: toNumber(scale['weightFlow']),
      groupTemp: toNumber(machine['groupTemperature']),
      mixTemp: toNumber(machine['mixTemperature']),
      targetPressure: toNumber(machine['targetPressure']),
      targetFlow: toNumber(machine['targetFlow']),
      targetGroupTemp: toNumber(machine['targetGroupTemperature']),
      targetMixTemp: toNumber(machine['targetMixTemperature']),
      frame: toNumber(machine['profileFrame']),
      state: toText(state['state']),
      substate: toText(state['substate']),
      volume: toNumber(point['volume']),
    });
  }
  return rows.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

const round = (value: number, digits: number) => Number(value.toFixed(digits));

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stdevSample(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  let sum = 0;
  for (const v of values) sum += (v - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

function stdevPop(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values)!;
  let sum = 0;
  for (const v of values) sum += (v - m) ** 2;
  return Math.sqrt(sum / values.length);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Least-squares slope in units per second. */
function slope(points: ReadonlyArray<readonly [number, number]>): number | null {
  if (points.length < 2) return null;
  const mt = mean(points.map((p) => p[0]))!;
  const mv = mean(points.map((p) => p[1]))!;
  let den = 0;
  let num = 0;
  for (const [t, v] of points) {
    den += (t - mt) ** 2;
    num += (t - mt) * (v - mv);
  }
  return den === 0 ? null : num / den;
}

/** First maximum (ties keep the earliest, like Python's max()). */
function argmax(rows: readonly ShotRow[], pick: (r: ShotRow) => number | null): { value: number; t: number } | null {
  let best: { value: number; t: number } | null = null;
  for (const row of rows) {
    const v = pick(row);
    if (v !== null && (best === null || v > best.value)) best = { value: v, t: row.t };
  }
  return best;
}

const within = (rows: readonly ShotRow[], from: number, to: number) => rows.filter((r) => r.t >= from && r.t <= to);
const values = (rows: readonly ShotRow[], pick: (r: ShotRow) => number | null) =>
  rows.map(pick).filter((v): v is number => v !== null);

// ---------------------------------------------------------------------------
// Core metrics (decaid-mcp section 3)
// ---------------------------------------------------------------------------

const FIRST_DROPS_WEIGHT_G = 0.3;
/** Window within which a tared scale must still read 0. */
const TARE_CHECK_WINDOW_S = 0.5;
const PI_END_PRESSURE_FRACTION = 0.6;
const INFUSION_WINDOW_TAIL_S = 2.0;
const DIP_WINDOW_S = 4.0;
const END_WINDOW_S = 2.0;
/** The very first change marks the start of the shot, not a phase transition. */
const START_MARKER_MAX_S = 0.5;

export type PreinfusionEndSource = 'substate' | 'profile_frame' | 'heuristic';

export interface ShotMetrics {
  rowCount: number;
  /** First sample to last, preheat included (decaid-mcp's duration); the summary's durationS is the pour (pourSeconds). */
  durationS: number | null;
  /** First time the cup weight exceeds 0.3 g; null without a (tared) scale. */
  timeToFirstDropS: number | null;
  /** First `pouring` sample, else a frame boundary, else 60 % of peak pressure. */
  preinfusionEndS: number | null;
  preinfusionEndSource: PreinfusionEndSource | null;
  /** Highest pressure up to 2 s after preinfusion ends. */
  infusionPeakBar: number | null;
  infusionPeakAtS: number | null;
  /** Highest pressure of the whole shot. */
  peakPressureBar: number | null;
  peakPressureAtS: number | null;
  /** Infusion peak minus the lowest pressure in the 4 s after it. */
  pressureDipAfterPeakBar: number | null;
  /** Mean scale flow from preinfusion end to the end (decaid-mcp avg_flow_pour). */
  meanPourWeightFlowGs: number | null;
  /** Mean pump flow over the same window (CafAI). */
  meanPourFlowMlS: number | null;
  /** Coefficient of variation of the pour's scale flow. */
  pourFlowStability: number | null;
  endPressureBar: number | null;
  pressureTrendPourBarPerS: number | null;
  /** Mean group temperature during the pour (decaid-mcp temp_basket_mean). */
  meanPourTempC: number | null;
  /** Mean |group temperature - its target| during the pour (CafAI). */
  tempDeviationC: number | null;
  /** True when a warning makes the scale readings unusable for diagnostics. */
  scaleUnreliable: boolean;
  warnings: string[];
}

function phaseBoundaries(rows: readonly ShotRow[]): number[] {
  const marks: number[] = [];
  let previous: string | null = null;
  for (const row of rows) {
    if (row.substate === null) continue;
    if (previous !== null && row.substate !== previous) marks.push(row.t);
    previous = row.substate;
  }
  const late = marks.filter((t) => t > START_MARKER_MAX_S);
  if (late.length > 0) return late;

  // The first sample's profileFrame still holds the previous shot's value.
  const frames: number[] = [];
  rows.forEach((row, i) => {
    if (i > 0 && row.frame !== rows[i - 1]!.frame) frames.push(row.t);
  });
  return frames.filter((t) => t > START_MARKER_MAX_S);
}

function preinfusionEnd(
  rows: readonly ShotRow[],
  boundaries: readonly number[],
  maxPressure: number | null,
): { t: number | null; source: PreinfusionEndSource | null } {
  const pouring = rows.find((r) => r.substate === 'pouring');
  if (pouring && pouring.t > START_MARKER_MAX_S) return { t: pouring.t, source: 'substate' };
  const firstBoundary = boundaries.length > 0 ? { t: boundaries[0]!, source: 'profile_frame' as const } : { t: null, source: null };
  if (maxPressure === null || maxPressure <= 0) return firstBoundary;
  const threshold = PI_END_PRESSURE_FRACTION * maxPressure;
  const anchor = rows.find((r) => r.pressure !== null && r.pressure >= threshold)?.t;
  if (anchor === undefined) return firstBoundary;
  const earlier = boundaries.filter((t) => t <= anchor);
  if (earlier.length > 0) return { t: Math.max(...earlier), source: 'profile_frame' };
  return { t: anchor, source: 'heuristic' };
}

export function shotMetrics(rows: readonly ShotRow[]): ShotMetrics {
  const warnings: string[] = [];
  const empty: ShotMetrics = {
    rowCount: rows.length,
    durationS: null,
    timeToFirstDropS: null,
    preinfusionEndS: null,
    preinfusionEndSource: null,
    infusionPeakBar: null,
    infusionPeakAtS: null,
    peakPressureBar: null,
    peakPressureAtS: null,
    pressureDipAfterPeakBar: null,
    meanPourWeightFlowGs: null,
    meanPourFlowMlS: null,
    pourFlowStability: null,
    endPressureBar: null,
    pressureTrendPourBarPerS: null,
    meanPourTempC: null,
    tempDeviationC: null,
    scaleUnreliable: true,
    warnings,
  };
  const lastRow = rows[rows.length - 1];
  if (!lastRow) {
    warnings.push('No time series recorded.');
    return empty;
  }
  const durationS = lastRow.t;

  const peak = argmax(rows, (r) => r.pressure);
  if (peak === null) warnings.push('No pressure readings - pressure metrics are dropped.');
  const boundaries = phaseBoundaries(rows);
  if (boundaries.length === 0) warnings.push('No machine phase markers - preinfusion end from the heuristic.');
  const piEnd = preinfusionEnd(rows, boundaries, peak?.value ?? null);
  if (piEnd.t === null) warnings.push('Preinfusion end not determinable - the pour phase stays open.');

  let infusionPeak: { value: number; t: number } | null = null;
  if (piEnd.t !== null && peak !== null) infusionPeak = argmax(within(rows, 0, piEnd.t + INFUSION_WINDOW_TAIL_S), (r) => r.pressure);
  let dip: number | null = null;
  if (infusionPeak) {
    const lows = values(within(rows, infusionPeak.t, infusionPeak.t + DIP_WINDOW_S), (r) => r.pressure);
    if (lows.length > 0) dip = infusionPeak.value - Math.min(...lows);
  }

  const pour = piEnd.t !== null ? within(rows, piEnd.t, durationS) : [];
  const pourWeightFlow = values(pour, (r) => r.weightFlow);
  const meanPourWeightFlow = mean(pourWeightFlow);
  let flowStability: number | null = null;
  let scaleUnreliable = false;
  if (meanPourWeightFlow !== null && meanPourWeightFlow <= 0) {
    // A coefficient of variation around a mean <= 0 means nothing; the cause
    // is almost always a scale that jumped during the pour.
    scaleUnreliable = true;
    warnings.push(
      `Mean pour flow is ${meanPourWeightFlow.toFixed(2)} ml/s (<= 0) - flow_stability is dropped, check the scale readings.`,
    );
  } else if (meanPourWeightFlow !== null) {
    const sd = stdevSample(pourWeightFlow);
    flowStability = sd === null ? null : sd / meanPourWeightFlow;
  }
  const pourTemps = values(pour, (r) => r.groupTemp);
  if (pourTemps.length === 0) warnings.push('No group temperature during the pour phase.');
  const tempDeviations = pour
    .filter((r) => r.groupTemp !== null && r.targetGroupTemp !== null)
    .map((r) => Math.abs(r.groupTemp! - r.targetGroupTemp!));
  const pressureTrend = slope(pour.filter((r) => r.pressure !== null).map((r) => [r.t, r.pressure!] as const));
  const endPressure = mean(values(within(rows, durationS - END_WINDOW_S, durationS), (r) => r.pressure));

  let firstDrop = rows.find((r) => r.weight !== null && r.weight > FIRST_DROPS_WEIGHT_G)?.t ?? null;
  const early = values(
    rows.filter((r) => r.t <= TARE_CHECK_WINDOW_S),
    (r) => r.weight,
  );
  const tareOffset = early.length > 0 ? Math.max(...early) : null;
  if (firstDrop === null) {
    scaleUnreliable = true;
    warnings.push(`Weight never exceeds ${FIRST_DROPS_WEIGHT_G} g - no scale?`);
  } else if (tareOffset !== null && tareOffset > FIRST_DROPS_WEIGHT_G) {
    // Nothing can be in the cup in the first half second: the scale was not tared.
    firstDrop = null;
    scaleUnreliable = true;
    warnings.push(`Scale already reads ${tareOffset.toFixed(1)} g in the first half second (not tared) - first drops not determinable.`);
  }
  const weights = values(rows, (r) => r.weight);
  if (weights.length > 0 && Math.min(...weights) < 0) {
    scaleUnreliable = true;
    warnings.push(`Weight goes negative (min ${Math.min(...weights).toFixed(1)} g) - the scale was probably knocked; flow-based values are unreliable.`);
  }

  return {
    rowCount: rows.length,
    durationS,
    timeToFirstDropS: firstDrop,
    preinfusionEndS: piEnd.t,
    preinfusionEndSource: piEnd.source,
    infusionPeakBar: infusionPeak?.value ?? null,
    infusionPeakAtS: infusionPeak?.t ?? null,
    peakPressureBar: peak?.value ?? null,
    peakPressureAtS: peak?.t ?? null,
    pressureDipAfterPeakBar: dip,
    meanPourWeightFlowGs: meanPourWeightFlow,
    meanPourFlowMlS: mean(values(pour, (r) => r.flow)),
    pourFlowStability: flowStability,
    endPressureBar: endPressure,
    pressureTrendPourBarPerS: pressureTrend,
    meanPourTempC: mean(pourTemps),
    tempDeviationC: mean(tempDeviations),
    scaleUnreliable,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Puck resistance and channeling (decaid-mcp section 4)
// ---------------------------------------------------------------------------

/** How close the pressure must be to its target before the pour counts as settled. */
const SETTLE_TOLERANCE_BAR = 0.6;
/** And how long after that the puck is still compacting. */
const SETTLE_DELAY_S = 4.0;
/** Below this a window is too short to say anything with. */
const MIN_SETTLED_POINTS = 8;
/** Flow below this is left out of the resistance: the error is squared. */
const MIN_RESISTANCE_FLOW = 0.4;
/** Puck resistance in bar·s²/ml², the archive's quartiles (p50 3.9, p90 8.5). */
const RESISTANCE_BANDS: ReadonlyArray<readonly [number, ResistanceBand]> = [
  [1.0, 'very_low'],
  [2.5, 'low'],
  [5.0, 'moderate'],
  [9.0, 'high'],
];
/** Change of resistance per second across the settled window (-0.45 is p13). */
const TREND_STEEP_DECLINE = -0.45;
const TREND_FLAT = 0.15;

/** Channeling thresholds, each at a percentile of the archive. */
export const CHANNELING_THRESHOLDS = {
  /** p95 of the pressure dip after the infusion peak, bar. */
  pressureDipBar: 0.5,
  /** p90 of pump flow jitter while a constant target is held, ml/s. */
  flowJitterMlS: 0.1,
  /** p99 of pump flow minus scale flow, ml/s. */
  divergenceMlS: 0.3,
  /** p90 of (preinfusion end - first drops), s. */
  earlyDropsS: 5.0,
  /** Resistance change per second at or below which it counts as falling. */
  resistanceTrendPerS: TREND_STEEP_DECLINE,
} as const;

export type ResistanceBand = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
export type ResistanceTrendBand = 'steep_decline' | 'declining' | 'steady' | 'rising';

export interface PuckResistance {
  /** Median pressure / pump flow² over the settled window, bar·s²/ml². */
  median: number;
  band: ResistanceBand;
  trendPerS: number | null;
  trend: ResistanceTrendBand | null;
  fromS: number;
  toS: number;
  points: number;
}

export type ChannelingIndicatorId =
  | 'pressure_dip_after_peak'
  | 'flow_instability'
  | 'pump_scale_divergence'
  | 'early_first_drops'
  | 'resistance_falling';

export interface ChannelingIndicator {
  id: ChannelingIndicatorId;
  value: number;
  unit: string;
  threshold: number;
  fired: boolean;
}

export interface Channeling {
  /** low (none fired), elevated (one), high (two or more); null without a settled pour. */
  risk: 'low' | 'elevated' | 'high' | null;
  fired: ChannelingIndicatorId[];
  indicators: ChannelingIndicator[];
  note: string | null;
}

/** Which target the machine holds at this sample. */
function controlMode(row: ShotRow): 'pressure' | 'flow' | null {
  const holdsPressure = row.targetPressure !== null && row.targetPressure > 0.5;
  const holdsFlow = row.targetFlow !== null && row.targetFlow > 0.1;
  if (holdsPressure && !holdsFlow) return 'pressure';
  if (holdsFlow && !holdsPressure) return 'flow';
  return null;
}

/**
 * The stretch where the machine holds its pressure target, from 4 s after the
 * pressure first settles. All-flow profiles never settle on a pressure target,
 * so they get no window (and no resistance or channeling verdict).
 */
export function settledWindow(rows: readonly ShotRow[]): ShotRow[] {
  const start = rows.find(
    (r) =>
      r.pressure !== null &&
      r.targetPressure !== null &&
      r.targetPressure > 1.0 &&
      Math.abs(r.pressure - r.targetPressure) <= SETTLE_TOLERANCE_BAR,
  )?.t;
  if (start === undefined) return [];
  const window = rows.filter((r) => r.t >= start + SETTLE_DELAY_S);
  return window.length >= MIN_SETTLED_POINTS ? window : [];
}

/** Median of pairwise slopes, sampled on a grid so the cost stays near linear. */
function theilSen(points: ReadonlyArray<readonly [number, number]>): number | null {
  const n = points.length;
  if (n < 4) return null;
  const step = Math.max(1, Math.floor(n / 40));
  const slopes: number[] = [];
  for (let i = 0; i < n; i += step) {
    for (let j = i + step; j < n; j += step) {
      const dt = points[j]![0] - points[i]![0];
      if (dt > 0.5) slopes.push((points[j]![1] - points[i]![1]) / dt);
    }
  }
  return median(slopes);
}

function trendBand(trend: number | null): ResistanceTrendBand | null {
  if (trend === null) return null;
  if (trend <= TREND_STEEP_DECLINE) return 'steep_decline';
  if (trend < -TREND_FLAT) return 'declining';
  if (trend > TREND_FLAT) return 'rising';
  return 'steady';
}

/** Resistance of the bed, pressure / pump flow², over the settled window. */
export function puckResistance(rows: readonly ShotRow[]): PuckResistance | null {
  const points: Array<readonly [number, number]> = [];
  for (const r of settledWindow(rows)) {
    if (r.pressure === null || r.flow === null) continue;
    if (r.flow < MIN_RESISTANCE_FLOW || r.pressure <= 0) continue;
    points.push([r.t, r.pressure / (r.flow * r.flow)]);
  }
  if (points.length < MIN_SETTLED_POINTS) return null;
  const med = median(points.map((p) => p[1]))!;
  const trend = theilSen(points);
  const band = RESISTANCE_BANDS.find(([edge]) => med < edge)?.[1] ?? 'very_high';
  return {
    median: med,
    band,
    trendPerS: trend,
    trend: trendBand(trend),
    fromS: points[0]![0],
    toS: points[points.length - 1]![0],
    points: points.length,
  };
}

/** Spread of neighbour-to-neighbour pump flow changes while one target is held. */
function flowJitter(window: readonly ShotRow[]): number | null {
  const diffs: number[] = [];
  let previousKey: string | null = null;
  let previousFlow: number | null = null;
  for (const row of window) {
    const mode = controlMode(row);
    const target = mode === 'pressure' ? row.targetPressure : row.targetFlow;
    const key = mode === null || target === null ? null : `${mode}|${target.toFixed(2)}`;
    if (key !== null && key === previousKey && row.flow !== null && previousFlow !== null) {
      diffs.push(Math.abs(row.flow - previousFlow));
    }
    previousKey = key;
    previousFlow = row.flow;
  }
  return diffs.length >= 4 ? stdevPop(diffs) : null;
}

/** Median of pump flow minus scale flow across the settled window. */
function flowDivergence(window: readonly ShotRow[]): number | null {
  const d = window.filter((r) => r.flow !== null && r.weightFlow !== null).map((r) => r.flow! - r.weightFlow!);
  return d.length < 5 ? null : median(d);
}

/** Five independent signs that water found a path around the coffee. */
export function channeling(rows: readonly ShotRow[], metrics: ShotMetrics, resistance: PuckResistance | null): Channeling {
  const window = settledWindow(rows);
  if (window.length === 0) return { risk: null, fired: [], indicators: [], note: 'No settled pour - nothing to judge.' };

  const indicators: ChannelingIndicator[] = [];
  const add = (id: ChannelingIndicatorId, value: number, unit: string, threshold: number, fired: boolean) =>
    indicators.push({ id, value: round(value, 3), unit, threshold, fired });

  // decaid-mcp judges the dip and the early drops on its rounded metrics.
  if (metrics.pressureDipAfterPeakBar !== null) {
    const dip = round(metrics.pressureDipAfterPeakBar, 1);
    add('pressure_dip_after_peak', dip, 'bar', CHANNELING_THRESHOLDS.pressureDipBar, dip >= CHANNELING_THRESHOLDS.pressureDipBar);
  }
  const jitter = flowJitter(window);
  if (jitter !== null) add('flow_instability', jitter, 'ml/s', CHANNELING_THRESHOLDS.flowJitterMlS, jitter >= CHANNELING_THRESHOLDS.flowJitterMlS);
  if (!metrics.scaleUnreliable) {
    const divergence = flowDivergence(window);
    if (divergence !== null) {
      add('pump_scale_divergence', divergence, 'ml/s', CHANNELING_THRESHOLDS.divergenceMlS, divergence >= CHANNELING_THRESHOLDS.divergenceMlS);
    }
    if (metrics.preinfusionEndS !== null && metrics.timeToFirstDropS !== null) {
      const early = round(metrics.preinfusionEndS, 1) - round(metrics.timeToFirstDropS, 1);
      add('early_first_drops', early, 's', CHANNELING_THRESHOLDS.earlyDropsS, early >= CHANNELING_THRESHOLDS.earlyDropsS);
    }
  }
  if (resistance && resistance.trendPerS !== null) {
    const trend = round(resistance.trendPerS, 3);
    add('resistance_falling', trend, 'per s', TREND_STEEP_DECLINE, trend <= TREND_STEEP_DECLINE);
  }

  const fired = indicators.filter((i) => i.fired).map((i) => i.id);
  return {
    risk: fired.length >= 2 ? 'high' : fired.length === 1 ? 'elevated' : 'low',
    fired,
    indicators,
    note: metrics.scaleUnreliable
      ? 'The scale readings are unreliable for this shot, so the two indicators that depend on them were not computed.'
      : null,
  };
}

export interface ShotAnalysis {
  metrics: ShotMetrics;
  resistance: PuckResistance | null;
  channeling: Channeling;
}

/** Every diagnostic for one shot's rows. */
export function analyseShot(rows: readonly ShotRow[]): ShotAnalysis {
  const metrics = shotMetrics(rows);
  const resistance = puckResistance(rows);
  return { metrics, resistance, channeling: channeling(rows, metrics, resistance) };
}

/**
 * Coach domain types: profiles as CafAI sends them, templates with bounded
 * levers, and the compact shot summary handed to the model and the UI.
 *
 * Profile facts are verified against Decaid a45961b (docs/verified/03-profiles.md):
 *   - every numeric field is a JSON number on GET and is sent as a number;
 *     only `version` ("2") and the enums are strings;
 *   - required on create: non-empty title and steps, tank_temperature,
 *     target_volume_count_start (an integer); CafAI always sends all ten keys;
 *   - each step needs name, pump, transition, sensor, temperature, seconds,
 *     volume plus the active target (pressure XOR flow);
 *   - one firmware exit per step; `weight` is an app-side step exit;
 *   - stop-at-weight reads the workflow's context.targetYield, so a yield
 *     change writes target_weight AND context.targetYield.
 */
import type { RoastLevel } from './contract.ts';

export type PumpMode = 'pressure' | 'flow';
export type Transition = 'fast' | 'smooth';
export type StepSensor = 'coffee' | 'water';
export type ExitType = 'pressure' | 'flow';
export type ExitCondition = 'over' | 'under';
export type BeverageType = 'espresso' | 'calibrate' | 'cleaning' | 'manual' | 'pourover';

export interface StepExit {
  type: ExitType;
  condition: ExitCondition;
  value: number;
}

/** On a pressure step `value` caps flow (ml/s); on a flow step it caps pressure (bar). 0 = off. */
export interface StepLimiter {
  value: number;
  range: number;
}

export interface ProfileStep {
  name: string;
  pump: PumpMode;
  transition: Transition;
  sensor: StepSensor;
  temperature: number;
  seconds: number;
  volume: number;
  /** App-side weight exit in grams; keep the template's representation (0 vs null hash differently). */
  weight: number | null;
  /** Present iff pump === 'pressure'. */
  pressure?: number;
  /** Present iff pump === 'flow'. */
  flow?: number;
  exit: StepExit | null;
  limiter: StepLimiter | null;
}

/** The complete ten-key profile, exactly as uploaded. */
export interface ProfileJson {
  version: string;
  title: string;
  notes: string;
  author: string;
  beverage_type: BeverageType;
  steps: ProfileStep[];
  target_volume: number | null;
  target_weight: number | null;
  /** Integer: number of leading preinfusion frames. */
  target_volume_count_start: number;
  tank_temperature: number;
}

export type LeverUnit = '°C' | 'g' | 's' | 'bar' | 'ml/s';

/**
 * One adjustable knob of a template. The model may only move declared levers,
 * within [min, max], by at most maxDelta per iteration, snapped to granularity.
 * Everything else in the profile is fixed: step count/order, names, pumps,
 * sensors, transitions, exit existence/type/condition, limiter existence/range,
 * volumes, target_volume, target_volume_count_start, tank_temperature.
 */
export interface Lever {
  /** Unique within the template, e.g. "temp", "yield", "bloom". */
  id: string;
  label: string;
  unit: LeverUnit;
  /**
   * `linked`: write the same value to every path.
   * `uniformShift`: the value is read at `anchor`; applying a new value adds the
   * same delta to every path (e.g. all step temperatures keep their shape).
   */
  mode: 'linked' | 'uniformShift';
  /** Profile paths, e.g. "target_weight", "steps[2].seconds", "steps[*].temperature". */
  paths: string[];
  /** For uniformShift: the path whose value is the lever value, e.g. "steps[4].temperature". */
  anchor?: string;
  min: number;
  max: number;
  /** Yield bounds relative to dose: effective min = max(min, ratio.min*dose), max = min(max, ratio.max*dose). */
  doseRatio?: { min: number; max: number };
  granularity: number;
  maxDelta: number;
  /** Also written into the workflow context on activation (yield -> targetYield). */
  workflowContextKey?: 'targetYield';
  /** The lever only acts when a scale is connected (app-side weight exits). */
  requiresScale?: boolean;
  /** Plain-language effect in the cup; used in diffs and the system prompt. */
  description: string;
}

/** Cross-lever rule, e.g. Londonium: peak - declineEnd >= 1 bar. */
export interface LeverConstraint {
  kind: 'minGap';
  higher: string;
  lower: string;
  minGap: number;
  message: string;
}

export interface Template {
  /** Stable CafAI id, e.g. "blooming-espresso". */
  id: string;
  name: string;
  /** e.g. "Blooming", "D-Flow", "Lever" */
  style: string;
  /** One line describing the curve, e.g. "Fill, 30 s bloom, flat 2.2 ml/s flow". */
  shape: string;
  /** When to reach for it (roast, process), for the model and the cards. */
  description: string;
  roastFit: RoastLevel[];
  /** Decaid's content-hash id of the bundled default, e.g. "profile:7438cb7266f60558b48f". */
  decaidDefaultId: string;
  source: { repo: string; file: string; commit: string };
  /** Normalized bundled profile (numbers, active targets only), bundled title. */
  profile: ProfileJson;
  levers: Lever[];
  constraints: LeverConstraint[];
}

/** Current value of each lever of a profile built from a template. */
export type LeverValues = Record<string, number>;

export interface ShotPhase {
  /** "preinfusion", "pouring", or a profile step name when known. */
  name: string;
  startS: number;
  endS: number;
}

/** Shot series resampled to about one point per second (null = no reading). */
export interface ShotSeries {
  tS: number[];
  pressure: (number | null)[];
  flow: (number | null)[];
  weight: (number | null)[];
  weightFlow: (number | null)[];
  temperature: (number | null)[];
  targetPressure: (number | null)[];
  targetFlow: (number | null)[];
}

/**
 * Compact, model-friendly summary of one shot: aggregates plus ~1 Hz series.
 * Units: seconds, grams, bar, ml/s, °C.
 */
export interface ShotSummary {
  shotId: string;
  timestamp: string;
  profileTitle: string | null;
  durationS: number;
  doseG: number | null;
  yieldG: number | null;
  ratio: number | null;
  targetYieldG: number | null;
  timeToFirstDropS: number | null;
  preinfusionEndS: number | null;
  peakPressureBar: number | null;
  peakPressureAtS: number | null;
  meanPourFlowMlS: number | null;
  meanPourWeightFlowGs: number | null;
  meanTempC: number | null;
  /** Mean |actual - target| temperature during the pour. */
  tempDeviationC: number | null;
  resistanceTrend: 'rising' | 'flat' | 'falling' | null;
  /** Named channeling indicators that fired, e.g. "pressure_dip_after_peak". */
  channelingFlags: string[];
  stopReason: string | null;
  phases: ShotPhase[];
  series: ShotSeries;
}

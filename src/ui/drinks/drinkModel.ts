/**
 * What a drink's view says (the design's section 4), as pure functions of the
 * run (drinkTrace.ts), the machine's frame and the settings: the phase in
 * words, what stops the drink, the dial's number, each readout with its
 * caption, and the trace's lines. A value nobody gave is a dash; a target
 * nobody gave is not drawn (D148).
 *
 * Targets come from the machine's own live settings when Decaid has sent them
 * (ws/v1/machine/shotSettings), and from Decaid's workflow otherwise; the flush
 * has no live setting. Hot water shows no live temperature: during hot water
 * the snapshot's mixTemperature is not the water's (Decaid's spec).
 */
import type { MachineFrame, ShotSettings, Workflow } from '../../api/types.ts';
import { temperatureIn, type TemperatureUnit } from '../../coach/temperature.ts';
import { DASH, formatSeconds, formatTemperature, formatWeight } from '../machine/format.ts';
import type { DrinkRun } from './drinkTrace.ts';
import type { DrinkKind } from './kinds.ts';

export type DrinkPresets = Pick<Workflow, 'steamSettings' | 'hotWaterData' | 'rinseData'>;

/** Steam is off in Decaid below this (de1_controller.dart:575 at aab5f93, drinkSettings.ts). */
const STEAM_ON_FROM = 135;
/** A trace is never narrower than this, so a run that just began is not stretched across the width. */
const MIN_SPAN_S = 5;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): number | null => (finite(value) && value > 0 ? value : null);
/** A target as it reads: whole numbers whole, anything else to one decimal. */
const plain = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const oneDecimal = (value: number | null | undefined, unit: string): string => (finite(value) ? `${value.toFixed(1)} ${unit}` : DASH);

/** What the machine does now in words, "Done" after, or null with no run to speak of. */
export function phaseWords(kind: DrinkKind, run: DrinkRun | null, frame: MachineFrame | null): string | null {
  if (run === null) return null;
  if (!run.live) return run.lost ? 'Connection lost' : 'Done';
  const state = frame?.state?.state;
  const substate = frame?.state?.substate;
  if (substate === 'preparingForShot') return 'Heating';
  if (kind === 'steam') {
    if (state === 'steamRinse') return 'Rinsing the wand';
    if (substate === 'pausedSteam') return 'Paused';
    if (substate === 'puffing') return 'Purging';
    return 'Steaming';
  }
  return kind === 'hotWater' ? 'Pouring' : 'Flushing';
}

/** What stops the drink: the steam and flush time in seconds, the hot water volume in ml. */
export function drinkTarget(kind: DrinkKind, shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  switch (kind) {
    case 'steam':
      return positive(shotSettings?.targetSteamDuration) ?? positive(presets?.steamSettings?.duration);
    case 'hotWater':
      return positive(shotSettings?.targetHotWaterVolume) ?? positive(presets?.hotWaterData?.volume);
    case 'flush':
      return positive(presets?.rinseData?.duration);
  }
}

/** Hot water's time limit, which stops it if the volume has not. */
export function hotWaterTimeLimit(shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  return positive(shotSettings?.targetHotWaterDuration) ?? positive(presets?.hotWaterData?.duration);
}

/** The steam temperature set, while steam is on. */
export function steamTemperatureSet(shotSettings: ShotSettings | null, presets: DrinkPresets | null): number | null {
  const set = positive(shotSettings?.targetSteamTemp) ?? positive(presets?.steamSettings?.targetTemperature);
  return set !== null && set >= STEAM_ON_FROM ? set : null;
}

export interface DialReading {
  /** The number in the middle: the drink's time in tenths, or its water in whole ml; a dash before any run. */
  number: string;
  /** Its unit, or null beside a dash. */
  unit: string | null;
  /** The line under it: "of 50 s", or once hot water is done "in 38.6 s"; null without a target. */
  of: string | null;
  /** How far toward the target, 0 to 1; null without a run or a target. */
  share: number | null;
}

export function dialReading(kind: DrinkKind, run: DrinkRun | null, target: number | null): DialReading {
  const water = kind === 'hotWater';
  const unit = water ? 'ml' : 's';
  const value = run === null ? null : water ? run.waterMl : run.elapsedS;
  let of = target === null ? null : `of ${plain(target)} ${unit}`;
  if (water && run !== null && !run.live) of = `in ${run.elapsedS.toFixed(1)} s`;
  if (value === null) return { number: DASH, unit: null, of, share: null };
  return {
    number: water ? String(Math.round(value)) : value.toFixed(1),
    unit,
    of,
    share: target === null ? null : Math.min(1, Math.max(0, value / target)),
  };
}

/**
 * The dial in words, for a screen reader: what it counts, how far, and toward
 * what ("Steam time: 12 seconds of 50"). Whole seconds and millilitres, so it
 * changes about once a second, not with every frame.
 */
export function dialSpoken(kind: DrinkKind, run: DrinkRun | null, target: number | null): string {
  const name = kind === 'steam' ? 'Steam time' : kind === 'flush' ? 'Flush time' : 'Hot water';
  if (run === null) return `${name}: none yet`;
  const of = target === null ? '' : ` of ${plain(target)}`;
  if (kind === 'hotWater') return `${name}: ${Math.round(run.waterMl)} millilitres${of}`;
  // As the dial shows it: 4.96 s reads 5.0, so 5.
  const seconds = Math.floor(Math.round(run.elapsedS * 10) / 10);
  return `${name}: ${seconds} ${seconds === 1 ? 'second' : 'seconds'}${of}`;
}

/** A readout's series colour, as the trace draws it. */
export type Swatch = 'pressure' | 'flow' | 'weight';

export interface Readout {
  key: string;
  label: string;
  /** The number with its unit ("1.9 bar"), or a dash. */
  value: string;
  /** The line under it ("set 0.8", "average"); empty, never missing, so the rows line up. */
  caption: string;
  swatch: Swatch | null;
}

export interface ReadoutInput {
  /** The machine's frame now, or null while it is away. */
  frame: MachineFrame | null;
  /** The scale's weight now, or null without one. */
  scaleWeight: number | null;
  scaleConnected: boolean;
  shotSettings: ShotSettings | null;
  presets: DrinkPresets | null;
  run: DrinkRun | null;
  /** The barista's unit for the steam and group temperatures (D-TEMP-4); °C when absent. */
  unit?: TemperatureUnit;
}

/** The mean of a series over the frames the drink worked in; null with none. */
function average(values: readonly (number | null)[], working: readonly boolean[]): number | null {
  let sum = 0;
  let count = 0;
  values.forEach((value, i) => {
    if (working[i] && finite(value)) {
      sum += value;
      count += 1;
    }
  });
  return count === 0 ? null : sum / count;
}

/** A series' last reading, in a working frame when `working` is given. */
function lastOf(values: readonly (number | null)[], working?: readonly boolean[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if ((working === undefined || working[i]) && finite(value)) return value;
  }
  return null;
}

const setCaption = (value: number | null | undefined): string => (finite(value) ? `set ${value.toFixed(1)}` : '');

export function drinkReadouts(kind: DrinkKind, input: ReadoutInput): Readout[] {
  const { frame, run, presets } = input;
  const unit = input.unit ?? 'celsius';
  const done = run !== null && !run.live;
  if (kind === 'steam') {
    const set = steamTemperatureSet(input.shotSettings, presets);
    // Decaid keeps it in whole °C; in °F it reads whole too, as the stepper shows it (D-TEMP-3).
    const setText = set === null ? '' : `set ${unit === 'celsius' ? set : Math.round(temperatureIn(set, unit))}`;
    if (done) {
      return [
        { key: 'steam', label: 'Steam', value: formatTemperature(lastOf(run.steamTemperature, run.working), 0, unit), caption: 'at the end', swatch: null },
        { key: 'pressure', label: 'Pressure', value: oneDecimal(average(run.pressure, run.working), 'bar'), caption: 'average', swatch: 'pressure' },
        { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
      ];
    }
    return [
      { key: 'steam', label: 'Steam', value: formatTemperature(frame?.steamTemperature, 0, unit), caption: setText, swatch: null },
      { key: 'pressure', label: 'Pressure', value: oneDecimal(frame?.pressure, 'bar'), caption: '', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.steamSettings?.flow), swatch: 'flow' },
    ];
  }
  if (kind === 'hotWater') {
    const weighed = done ? run.weight.some(finite) : input.scaleConnected;
    const scale: Readout = weighed
      ? { key: 'scale', label: 'Scale', value: formatWeight(done ? lastOf(run.weight) : input.scaleWeight), caption: 'in the cup', swatch: 'weight' }
      : { key: 'scale', label: 'Scale', value: DASH, caption: 'No scale', swatch: null };
    if (done) {
      return [
        { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
        scale,
        { key: 'time', label: 'Time', value: formatSeconds(run.elapsedS), caption: '', swatch: null },
      ];
    }
    const limit = hotWaterTimeLimit(input.shotSettings, presets);
    return [
      { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.hotWaterData?.flow), swatch: 'flow' },
      scale,
      { key: 'time', label: 'Time', value: run === null ? DASH : formatSeconds(run.elapsedS), caption: limit === null ? '' : `stops by ${plain(limit)} s`, swatch: null },
    ];
  }
  const target = done ? run.latest?.targetGroupTemperature : frame?.targetGroupTemperature;
  const groupCaption = finite(target) ? `target ${temperatureIn(target, unit).toFixed(1)}` : '';
  if (done) {
    return [
      { key: 'water', label: 'Water', value: `${Math.round(run.waterMl)} ml`, caption: 'through the group', swatch: null },
      { key: 'flow', label: 'Flow', value: oneDecimal(average(run.flow, run.working), 'ml/s'), caption: 'average', swatch: 'flow' },
      { key: 'group', label: 'Group', value: formatTemperature(lastOf(run.groupTemperature), 1, unit), caption: groupCaption, swatch: null },
    ];
  }
  return [
    { key: 'water', label: 'Water', value: run === null ? DASH : `${Math.round(run.waterMl)} ml`, caption: run === null ? '' : 'so far', swatch: null },
    { key: 'flow', label: 'Flow', value: oneDecimal(frame?.flow, 'ml/s'), caption: setCaption(presets?.rinseData?.flow), swatch: 'flow' },
    { key: 'group', label: 'Group', value: formatTemperature(frame?.groupTemperature, 1, unit), caption: groupCaption, swatch: null },
  ];
}

export interface TraceLine {
  key: Swatch;
  values: readonly (number | null)[];
  /** The value at the top of the plot. */
  yMax: number;
}

/** The highest reading of a series, or 0. */
function highest(values: readonly (number | null)[]): number {
  let high = 0;
  for (const value of values) if (finite(value) && value > high) high = value;
  return high;
}

/** The trace's lines, in draw order (the last on top). */
export function traceLines(kind: DrinkKind, run: DrinkRun, volumeSet: number | null): TraceLine[] {
  if (kind === 'steam') {
    const yMax = Math.max(3, Math.ceil(Math.max(highest(run.flow), highest(run.pressure))));
    return [
      { key: 'flow', values: run.flow, yMax },
      { key: 'pressure', values: run.pressure, yMax },
    ];
  }
  const flow: TraceLine = { key: 'flow', values: run.flow, yMax: Math.max(10, Math.ceil(highest(run.flow))) };
  if (kind === 'hotWater' && run.weight.some(finite)) {
    return [{ key: 'weight', values: run.weight, yMax: Math.max(volumeSet ?? 0, Math.ceil(highest(run.weight)), 1) }, flow];
  }
  return [flow];
}

/** Seconds at the trace's right edge: the time set (or hot water's limit), or the run's own, whichever is longer. */
export function traceSpan(run: DrinkRun | null, timeSet: number | null): number {
  const ran = run === null || run.t.length === 0 ? 0 : run.t[run.t.length - 1]!;
  return Math.max(timeSet ?? 0, ran, MIN_SPAN_S);
}

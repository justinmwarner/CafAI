/**
 * The numbers a drink's scene follows (the design's section 3, D-SCENE-2), as
 * pure functions of the run (drinkTrace.ts), what the dial counts toward and
 * what the drink was set to: its phase, how far it has gone, how hard the
 * machine works, how much steam it gives off, and its colour from cold to
 * warm. Read afresh every frame by SceneCanvas.tsx, and by the dial for its
 * ring.
 *
 * A set nobody gave counts as Decaid's default, and a reading the machine did
 * not send as the set one, so a missing number never jolts a scene.
 */
import type { MachineFrame, ShotSettings } from '../../../api/types.ts';
import { steamTemperatureSet, type DrinkPresets } from '../drinkModel.ts';
import type { DrinkRun } from '../drinkTrace.ts';
import type { DrinkKind } from '../kinds.ts';
import { clamp } from './canvas.ts';
import type { SceneInput, ScenePhase, SceneSets } from './types.ts';

/** Decaid's flow when nobody set one, ml/s. */
const DEFAULT_FLOW: Readonly<Record<DrinkKind, number>> = { steam: 0.8, hotWater: 10, flush: 6 };
/** A typical run, s: how far a run has gone when the dial has no target to count toward. */
const TYPICAL_RUN_S: Readonly<Record<DrinkKind, number>> = { steam: 45, hotWater: 30, flush: 10 };
/** The steam heater's set, hot water's and the group's target when nobody gave one, °C. */
const DEFAULT_STEAM_SET = 150;
const DEFAULT_HOT_WATER_SET = 85;
const DEFAULT_GROUP_TARGET = 93;
/** The pressure a wand steams at as set, bar. */
const STEAM_PRESSURE = 1.8;
const MAX_STRENGTH = 2.2;

const LIVE_PHASES: ReadonlySet<ScenePhase> = new Set<ScenePhase>(['heating', 'working', 'paused', 'purging', 'rinsing']);

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
};

/** What the drink was set to, from the machine's live settings before Decaid's workflow (as drinkModel.ts reads targets). */
export function sceneSets(kind: DrinkKind, shotSettings: ShotSettings | null, presets: DrinkPresets | null, frame: MachineFrame | null): SceneSets {
  switch (kind) {
    case 'steam':
      return { flow: positive(presets?.steamSettings?.flow), temperature: steamTemperatureSet(shotSettings, presets) };
    case 'hotWater':
      return {
        flow: positive(presets?.hotWaterData?.flow),
        temperature: positive(shotSettings?.targetHotWaterTemp) ?? positive(presets?.hotWaterData?.targetTemperature),
      };
    case 'flush':
      return {
        flow: positive(presets?.rinseData?.flow),
        temperature: positive(frame?.targetGroupTemperature) ?? positive(presets?.rinseData?.targetTemperature),
      };
  }
}

/** What the machine does, in the words phaseWords (drinkModel.ts) uses: the pause, the purge and the rinse are steam's. */
function phaseOf(kind: DrinkKind, run: DrinkRun | null): ScenePhase {
  if (run === null) return 'idle';
  if (run.lost) return 'lost';
  if (!run.live) return 'done';
  const state = run.latest?.state?.state;
  const substate = run.latest?.state?.substate;
  if (substate === 'preparingForShot') return 'heating';
  if (kind === 'steam') {
    if (state === 'steamRinse') return 'rinsing';
    if (substate === 'pausedSteam') return 'paused';
    if (substate === 'puffing') return 'purging';
  }
  return 'working';
}

/** The dial's share, or without a target the run's time over a typical run's. */
function progressOf(kind: DrinkKind, run: DrinkRun | null, target: number | null): number {
  if (run === null) return 0;
  const goal = positive(target);
  if (goal === null) return clamp(run.elapsedS / TYPICAL_RUN_S[kind], 0, 1);
  return clamp((kind === 'hotWater' ? run.waterMl : run.elapsedS) / goal, 0, 1);
}

/** The flow against its set, and for steam the pressure against a wand's. */
function strengthOf(kind: DrinkKind, phase: ScenePhase, frame: MachineFrame | null, sets: SceneSets): number {
  if (phase !== 'working') return 0;
  const set = sets.flow ?? DEFAULT_FLOW[kind];
  let strength = (finite(frame?.flow) ?? set) / set;
  if (kind === 'steam') strength *= (finite(frame?.pressure) ?? STEAM_PRESSURE) / STEAM_PRESSURE;
  return clamp(strength, 0, MAX_STRENGTH);
}

/**
 * How much steam or vapour the drink gives off: steam's heater against its
 * set, hot water's temperature set (it has no live temperature, D148), the
 * group against its target. A flush whose group the machine did not report
 * reads cold rather than claim the group is ready.
 */
function heatOf(kind: DrinkKind, frame: MachineFrame | null, sets: SceneSets): number {
  switch (kind) {
    case 'steam': {
      const set = sets.temperature ?? DEFAULT_STEAM_SET;
      return clamp(((finite(frame?.steamTemperature) ?? set) - (set - 30)) / 30, 0.2, 1.15);
    }
    case 'hotWater':
      return clamp(((sets.temperature ?? DEFAULT_HOT_WATER_SET) - 40) / 55, 0, 1);
    case 'flush': {
      const target = sets.temperature ?? DEFAULT_GROUP_TARGET;
      return clamp(((finite(frame?.groupTemperature) ?? target - 20) - (target - 20)) / 20, 0, 1);
    }
  }
}

/** The numbers a scene follows now. `target` is what the dial counts toward (drinkTarget), or null. */
export function sceneInput(kind: DrinkKind, run: DrinkRun | null, target: number | null, sets: SceneSets): SceneInput {
  const phase = phaseOf(kind, run);
  const frame = run?.latest ?? null;
  const progress = progressOf(kind, run, target);
  const heat = heatOf(kind, frame, sets);
  return {
    kind,
    phase,
    live: LIVE_PHASES.has(phase),
    progress,
    strength: strengthOf(kind, phase, frame, sets),
    heat,
    // Steam's milk warms with its time; the water drinks take their heat.
    warmth: kind === 'steam' ? progress : heat,
  };
}

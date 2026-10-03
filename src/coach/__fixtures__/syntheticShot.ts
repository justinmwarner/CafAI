/**
 * Test-only: a deterministic, plausible Decaid ShotRecord.
 *
 * Shape: 3 s preheat (preparingForShot, stale frame 5), preinfusion at 3 bar
 * (frames 0-1, 3-10 s), then a 9 bar pour (frame 2) until `endS`. Samples are
 * ~4 Hz with irregular spacing, so anything that resamples by index instead of
 * by timestamp shows up in tests. Options inject the problems the channeling
 * indicators look for.
 */
import type { ShotRecord, ShotSnapshot } from '../../api/types.ts';

export interface SyntheticShotOptions {
  id?: string;
  /** Shot length in seconds (default 35). */
  endS?: number;
  /** When the first drops reach the cup (default 12). */
  firstDropS?: number;
  /** A pressure dip this deep right after the 9 bar peak. */
  dipBar?: number;
  /** Pump flow noise amplitude in ml/s during the pour. */
  jitter?: number;
  /** Pump flow minus scale flow during the pour (default 0.05). */
  cupLossMlS?: number;
  /** Puck resistance falling this fast during the pour (bar*s^2/ml^2 per s). */
  resistanceDropPerS?: number;
  /** The scale already reads this much at the start (not tared). */
  tareOffsetG?: number;
  /** Steady pump flow during the pour (default 1.5 ml/s, resistance 4). */
  pourFlowMlS?: number;
  /** No scale at all: scale snapshots are null. */
  noScale?: boolean;
  /** Group temperature offset from its target during the pour (default -0.5 °C). */
  tempOffsetC?: number;
}

const BASE_MICROS = Date.UTC(2026, 9, 3, 8, 0, 0) * 1000;

function stamp(seconds: number): string {
  const micros = BASE_MICROS + Math.round(seconds * 1e6);
  const date = new Date(Math.floor(micros / 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(micros % 1_000_000, 6)}`
  );
}

/** Deterministic noise in [-1, 1]. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const PROFILE_STEPS = [
  { name: 'Fill', pump: 'pressure', pressure: 3 },
  { name: 'Soak', pump: 'pressure', pressure: 3 },
  { name: 'Pour', pump: 'pressure', pressure: 9 },
].map((s) => ({
  name: s.name,
  pump: s.pump as 'pressure',
  transition: 'fast' as const,
  exit: null,
  volume: 100,
  seconds: 30,
  weight: 0,
  temperature: 88,
  sensor: 'coffee' as const,
  pressure: s.pressure,
  limiter: null,
}));

export function syntheticShotRecord(options: SyntheticShotOptions = {}): ShotRecord {
  const endS = options.endS ?? 35;
  const firstDropS = options.firstDropS ?? 12;
  const cupLoss = options.cupLossMlS ?? 0.05;
  const pourFlow = options.pourFlowMlS ?? 1.5;
  const tempOffset = options.tempOffsetC ?? -0.5;
  const measurements: ShotSnapshot[] = [];
  let weight = options.tareOffsetG ?? 0;

  let t = 0;
  for (let i = 0; t <= endS + 1e-9; i++) {
    const preheat = t < 3;
    const pouring = t >= 10;
    const frame = preheat ? 5 : t < 6 ? 0 : pouring ? 2 : 1;

    let pressure = 0;
    let flow = 0.4;
    if (!preheat && !pouring) {
      pressure = Math.min(3, (t - 3) * 1);
      flow = Math.max(0.3, 4 - 1.2 * (t - 3));
    }
    if (pouring) {
      pressure = Math.min(9, 3 + 6 * (t - 10));
      if (options.dipBar && t >= 11.5 && t < 13) pressure = 9 - options.dipBar;
      if (options.resistanceDropPerS) {
        const resistance = Math.max(0.6, 10 - options.resistanceDropPerS * (t - 10));
        flow = Math.sqrt(Math.max(pressure, 0.1) / resistance);
      } else {
        flow = pourFlow;
      }
      if (options.jitter) flow += options.jitter * noise(i);
    }

    const dripping = t >= firstDropS;
    const weightFlow = dripping ? Math.max(0, (pouring ? flow : 0.25) - (pouring ? cupLoss : 0)) : 0;
    if (dripping && weight < (options.tareOffsetG ?? 0) + 0.4) weight = (options.tareOffsetG ?? 0) + 0.4;
    else if (dripping) weight += weightFlow * 0.25;

    const targetGroup = 88;
    measurements.push({
      machine: {
        timestamp: stamp(t),
        state: { state: 'espresso', substate: preheat ? 'preparingForShot' : pouring ? 'pouring' : 'preinfusion' },
        flow,
        pressure,
        targetFlow: preheat ? 2 : 0,
        targetPressure: preheat ? 0 : pouring ? 9 : 3,
        mixTemperature: 90,
        groupTemperature: preheat ? targetGroup : targetGroup + tempOffset,
        targetMixTemperature: preheat ? 18 : 92,
        targetGroupTemperature: targetGroup,
        profileFrame: frame,
        steamTemperature: 140,
      },
      scale: options.noScale
        ? null
        : { timestamp: stamp(Math.max(0, t - 0.05)), weight: Number(weight.toFixed(2)), weightFlow, battery: 80, timerValue: null },
      volume: 0,
    });
    // Irregular spacing around 4 Hz.
    t = Number((t + 0.25 + 0.02 * noise(i + 1000)).toFixed(6));
  }

  const lastWeight = measurements[measurements.length - 1]?.scale?.weight ?? null;
  return {
    id: options.id ?? 'synthetic-shot',
    timestamp: stamp(0.006),
    createdAt: '2026-10-03T06:00:40.000000Z',
    updatedAt: '2026-10-03T06:00:40.000000Z',
    measurements,
    workflow: {
      id: 'workflow-1',
      name: 'Workflow',
      description: 'Description',
      profile: {
        version: '2',
        title: 'Synthetic v1',
        notes: '',
        author: 'CafAI',
        beverage_type: 'espresso',
        steps: PROFILE_STEPS,
        target_volume: 0,
        target_weight: 36,
        target_volume_count_start: 2,
        tank_temperature: 0,
      },
      context: { targetDoseWeight: 18, targetYield: 36, grinderSetting: '14' },
      steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8, stopAtTemperature: 0 },
      hotWaterData: { targetTemperature: 75, duration: 30, volume: 50, flow: 10 },
      rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
    },
    annotations: lastWeight === null ? { actualDoseWeight: 18 } : { actualDoseWeight: 18, actualYield: Number((lastWeight + 0.4).toFixed(1)) },
    stopReason: 'targetWeight',
  };
}

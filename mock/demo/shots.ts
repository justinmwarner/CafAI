/**
 * Shots for the demo, pulled on a mock Decaid without waiting for them.
 *
 * The frames come from the mock's own shot simulation (mock/decaid/
 * shotPlayer.ts) for the profile the machine holds, with the inputs its shot
 * player takes from the workflow (yield stop, dose, scale); the record is the
 * one its player stores: 5 Hz measurements, a copy of the workflow at the end
 * of the shot, and the dose and settled yield. Only the wall clock is
 * skipped, so a minute-long shot is ready at once and its times are wherever
 * the story puts it.
 */
import type { ShotRecord, ShotSnapshot } from '../../src/api/types.ts';
import { formatLocalTimestamp, formatUtcTimestamp } from '../decaid/clock.ts';
import { createShotSimulation, decaidNumber } from '../decaid/shotPlayer.ts';
import type { MockDecaid } from '../decaid/state.ts';

export interface ShotSpec {
  /** Decaid's id for the record: fixed, so the demo is the same on every load. */
  id: string;
  /**
   * How hard the wet puck resists, in the mock's puck model (bar per (ml/s)²):
   * 2.4 is its espresso grind; lower runs faster with less pressure, drips
   * sooner and gives more in the cup; higher, the reverse.
   */
  puckResistance: number;
  /** The simulation's jitter seed. */
  seed: number;
}

export interface PulledShot {
  record: ShotRecord;
  /** Data time (epoch ms) when the machine finished the shot and Decaid stored it. */
  endMs: number;
}

/**
 * Pull a shot starting at `startMs` (data time) and store its record in the
 * mock, as the shot player does when a shot finishes. The machine first
 * takes any profile upload still queued, as a real shot would wait for it.
 */
export async function pullShot(state: MockDecaid, spec: ShotSpec, startMs: number): Promise<PulledShot> {
  await state.runMachineWrite(() => undefined);
  const workflow = state.getWorkflow();
  const settings = state.getSettings();
  const resting = state.getMachineSnapshot();
  const simulation = createShotSimulation({
    profile: state.getMachineProfile(),
    targetYield: workflow.context?.targetYield ?? 0,
    targetVolume: workflow.context?.targetWaterVolume ?? workflow.profile.target_volume,
    volumeCountStart: workflow.profile.target_volume_count_start,
    volumeFlowMultiplier: decaidNumber(settings.volumeFlowMultiplier),
    weightFlowMultiplier: decaidNumber(settings.weightFlowMultiplier),
    puckResistance: spec.puckResistance,
    doseG: workflow.context?.targetDoseWeight ?? 18,
    scaleConnected: state.isScaleConnected(),
    bypassSaw: settings.gatewayMode === 'full',
    startMs,
    shotId: spec.id,
    staleFrame: state.lastProfileFrame,
    seed: spec.seed,
    startTemperatures: { mix: resting.mixTemperature, group: resting.groupTemperature, steam: resting.steamTemperature },
  });

  const measurements: ShotSnapshot[] = [];
  let lastAt = startMs;
  for (let frame = simulation.next(); frame; frame = simulation.next()) {
    if (frame.recorded) measurements.push({ machine: frame.machine, scale: frame.scale, volume: frame.volume });
    lastAt = frame.atMs;
  }
  state.lastProfileFrame = simulation.lastProfileFrame;
  if (simulation.aborted || measurements.length === 0) throw new Error(`The demo shot ${spec.id} did not run.`);

  // As the shot player's persist(): the end of the shot is its last frame.
  const endMs = Math.floor(lastAt) + 1;
  const info = state.getMachineInfo();
  const provenance = {
    provenanceStatus: 'captured',
    flowCalibration: 1.0,
    serialNumber: info.serialNumber,
    model: info.model,
    firmwareVersion: info.version,
  };
  // The cup once the stopping tail settled it, as the shot player records it (Decaid's actualYield).
  const settledYield = simulation.scaleWeightG;
  const record: ShotRecord = {
    id: spec.id,
    timestamp: formatLocalTimestamp(startMs + 6.342),
    createdAt: formatUtcTimestamp(endMs + 40),
    updatedAt: formatUtcTimestamp(endMs + 40),
    measurements,
    workflow: { ...workflow, machine: provenance } as ShotRecord['workflow'],
    annotations:
      settledYield === null
        ? { actualDoseWeight: simulation.doseG }
        : { actualDoseWeight: simulation.doseG, actualYield: settledYield },
    stopReason: simulation.stopReason ?? 'machineEnded',
  };
  state.addShot(record);
  return { record: state.getShot(spec.id), endMs };
}

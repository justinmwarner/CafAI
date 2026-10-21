/**
 * The mock DE1: plays shots of the profile the machine holds (machine.ts),
 * plus steam / hot water / flush, sleep and tare.
 *
 * A shot is a deterministic simulation: 5 Hz machine frames with local
 * zone-less timestamps, ~2 s of preparingForShot, then the profile's steps
 * (flow steps hold flow, pressure steps hold pressure, smooth steps ramp,
 * exits, step weight exits and limiters honoured), preinfusion for frames
 * below target_volume_count_start and pouring after, a puck model that
 * turns pumped water into cup weight, and, after a stop with weight in the
 * cup, Decaid's ~4 s stopping phase (pouringDone, then idle) before
 * finished. Decaid's shot sequencer reads the workflow, not the machine:
 * stop-at-weight uses workflow.context.targetYield (stopping once the
 * scale's weight plus its flow times weightFlowMultiplier reaches it), and
 * with no scale the volumetric stop uses context.targetWaterVolume or the
 * workflow profile's target_volume, exactly like shot_sequencer.dart. The
 * shotState frames, the
 * decision bodies and the persisted ShotRecord (a copy of the workflow at
 * shot end; none for a run stopped before its first pour frame, or for a
 * cleaning or calibration profile) follow
 * shot_sequencer.dart / de1_state_manager.dart, and each steaming leaves a
 * steam record as steam_sequencer.dart does (steams.ts). Wall-clock
 * playback can be compressed with `speed`; data timestamps stay realistic.
 */
import type {
  MachineSnapshot,
  ShotDecision,
  ShotRecord,
  ShotSnapshot,
  ShotStateEvent,
  TimeToReadyFrame,
  WeightSnapshot,
  WireProfile,
} from '../../src/api/types.ts';
import type { ProfileStep } from '../../src/coach/types.ts';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import { clone } from '../../src/util/clone.ts';
import { newId } from '../../src/util/id.ts';
import { formatLocalTimestamp, formatUtcTimestamp } from './clock.ts';
import { dartDouble } from './json.ts';
import { idleTemperature } from './machine.ts';
import { PLUGIN_IDS } from './plugins.ts';
import type { MockDecaid } from './state.ts';
import type { MockSteamRecord } from './steams.ts';

/**
 * Decaid saves no shot for a profile of these beverage types: a cleaning
 * profile (Forward Flush x5) or a calibration (_persistShotIfNeeded,
 * de1_state_manager.dart:911-917 at aab5f93).
 */
const UNSAVED_BEVERAGES: ReadonlySet<string> = new Set(['cleaning', 'calibrate']);

/** One frame every 200 ms of data time (5 Hz). */
export const FRAME_MS = 200;
const DT = FRAME_MS / 1000;
const PREHEAT_FRAMES = 10;
/**
 * Decaid keeps a stopped shot in `stopping` until the cup weight settles or
 * its 4 s backstop fires (shot_sequencer.dart), and only then says finished
 * and stores the shot: 4-5 s on Decaid 0.8.7's simulator. The mock always
 * waits the backstop out: 20 frames, 4 s.
 */
const STOPPING_FRAMES = 20;
const ACTIVITY_FRAMES = 20;

// Puck model: a headspace to fill, a puck that absorbs water (resistance
// rising as it wets and easing as it extracts), then cup weight from the
// water that passes through.
const HEADSPACE_ML = 8;
const FILL_FLOW = 6;
const MAX_FLOW = 8;
const MAX_PRESSURE = 12;
/** Puck resistance in bar per (ml/s)² once wet: a fine espresso grind, and every shot's unless one is given. */
export const DEFAULT_PUCK_RESISTANCE = 2.4;
/** Decaid's default volumeFlowMultiplier: the volume stop looks this many seconds of flow ahead. */
const VOLUME_LOOK_AHEAD_S = 0.3;
/** How wet the default puck is (a share of what it holds) when the first drops pass. */
const DRIP_START = 0.4;
/**
 * A puck's grind shows before the pour, not only in its pressure: a finer,
 * denser puck (higher resistance) soaks up more water before it lets the
 * shot through, and wets further before its first drops; a coarser one the
 * reverse. Without them a flow profile's pump hides the grind: every
 * Blooming shot ran the same time, dripped at the same moment and gave the
 * same yield. Both scale as (resistance / default) to these powers, so a
 * shot at the default resistance (every live shot) runs exactly as before.
 */
const SOAK_POWER = 3;
const DRIP_POWER = 1;
/**
 * How long the cup lags what passes the puck, rising and falling alike, so
 * the cup gets exactly what went through. After a stop the drips come to
 * about this many seconds of the flow at the stop, which Decaid's look-ahead
 * below expects: a shot stopped at weight settles within about 1 g of its
 * target. (A fall slower than the rise added weight that never passed the
 * puck; with it and a quarter-second look-ahead, shots stopped at weight
 * settled about 4 g past their target.)
 */
const CUP_LAG_S = 1.2;
/**
 * Decaid's default weightFlowMultiplier: stop-at-weight and the step weight
 * exits project the scale's weight this many seconds of weight flow ahead
 * (shot_sequencer.dart: weight + controlWeightFlow x weightFlowMultiplier).
 */
const WEIGHT_LOOK_AHEAD_S = 1.0;
/** Ends shots that would never reach the target: 45 s of cup flow (a bloom pause does not count). */
const CAP_FLOWING_S = 45;
const MAX_STEPS_S = 150;

export type MockActivity = 'espresso' | 'steam' | 'hotWater' | 'flush' | 'steamRinse' | 'cleaning' | 'descaling' | 'airPurge';

export interface ShotSimulationInput {
  /** The profile the machine runs. */
  profile: WireProfile;
  /** context.targetYield; 0 turns stop-at-weight off. */
  targetYield: number;
  /**
   * Decaid's volumetric stop in ml, used only while no scale reports:
   * context.targetWaterVolume, else the workflow profile's target_volume.
   * Defaults to `profile.target_volume`; null or 0 is off.
   */
  targetVolume?: number | null;
  /** The frame Decaid counts volume from (the workflow profile's target_volume_count_start); defaults to the profile's. */
  volumeCountStart?: number;
  /** Decaid's volumeFlowMultiplier setting (default 0.3). */
  volumeFlowMultiplier?: number;
  /** Decaid's weightFlowMultiplier setting (default 1.0): how far ahead stop-at-weight and step weight exits look. */
  weightFlowMultiplier?: number;
  /**
   * How hard the wet puck resists, in bar per (ml/s)²: 2.4 (default) is an
   * espresso grind, about 0.4 a coarse allongé grind. A finer puck also soaks
   * up more water and drips later (SOAK_POWER, DRIP_POWER).
   */
  puckResistance?: number;
  doseG: number;
  scaleConnected: boolean;
  /** gatewayMode "full": Decaid neither stops at weight nor honours step weights. */
  bypassSaw?: boolean;
  /** Data time (epoch ms) of the first frame. */
  startMs: number;
  shotId: string;
  /** profileFrame shown during preheat (left over from the previous shot). */
  staleFrame: number;
  /** Jitter seed; the same input always gives the same frames. */
  seed?: number;
  startTemperatures?: { mix: number; group: number; steam: number };
}

export interface SimFrame {
  atMs: number;
  machine: MachineSnapshot;
  scale: WeightSnapshot | null;
  /** ml pumped since the frame Decaid counts from (target_volume_count_start). */
  volume: number;
  /** shotState frames to publish after this machine frame. */
  events: ShotStateEvent[];
  /** Part of the persisted measurements (preheat up to the sample before the stop). */
  recorded: boolean;
  done: boolean;
}

export interface ShotSimulation {
  next(): SimFrame | null;
  requestStop(reason: 'apiStop'): void;
  skipStep(): void;
  readonly phase: 'preheat' | 'steps' | 'stopping' | 'done';
  readonly stopReason: string | null;
  readonly aborted: boolean;
  readonly doseG: number;
  /** The profileFrame the machine shows last (the next shot's stale preheat frame). */
  readonly lastProfileFrame: number;
  /**
   * What the scale reads now, null without one. Once the shot is done this
   * is the settled cup, drips included: Decaid's actualYield.
   */
  readonly scaleWeightG: number | null;
}

function quantize(value: number, steps: number): number {
  return Math.round(value * steps) / steps;
}

/** A Decaid setting's number when it is one, else undefined (the simulation's default). */
export function decaidNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function approach(current: number, target: number, tauS: number): number {
  return current + (target - current) * (1 - Math.exp(-DT / tauS));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** mulberry32: a tiny seeded PRNG so jitter is deterministic. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function targetOf(step: ProfileStep): number {
  return (step.pump === 'flow' ? step.flow : step.pressure) ?? 0;
}

export function createShotSimulation(input: ShotSimulationInput): ShotSimulation {
  const steps = input.profile.steps as ProfileStep[];
  const countStart = input.profile.target_volume_count_start;
  const volumeCountStart = input.volumeCountStart ?? countStart;
  const puckResistance = input.puckResistance !== undefined && input.puckResistance > 0 ? input.puckResistance : DEFAULT_PUCK_RESISTANCE;
  const grind = puckResistance / DEFAULT_PUCK_RESISTANCE;
  const saturationMl = Math.max(8, input.doseG * 0.8 * grind ** SOAK_POWER);
  const dripStart = Math.min(0.8, DRIP_START * grind ** DRIP_POWER);
  const stopAtWeight = input.scaleConnected && input.targetYield > 0 && !input.bypassSaw;
  // shot_sequencer.dart ~464-486: the volume stop applies only when no scale
  // sample is there (scale == null or lost), SAW is not bypassed and the
  // machine has no stop-at-weight of its own (a DE1 never has).
  const targetVolume = (input.targetVolume === undefined ? input.profile.target_volume : input.targetVolume) ?? 0;
  const stopAtVolume = !input.scaleConnected && !input.bypassSaw && targetVolume > 0;
  const volumeLookAheadS = input.volumeFlowMultiplier ?? VOLUME_LOOK_AHEAD_S;
  const weightLookAheadS = input.weightFlowMultiplier ?? WEIGHT_LOOK_AHEAD_S;
  const random = seededRandom(input.seed ?? 1);
  const temps = input.startTemperatures ?? { mix: 89.9, group: 88.05, steam: 148 };

  let phase: ShotSimulation['phase'] = 'preheat';
  let frameIndex = 0;
  let previousAt = Number.NEGATIVE_INFINITY;
  let stepIndex = 0;
  let stepElapsed = 0;
  let stepPumped = 0;
  let smoothFrom = 0;
  let pressure = 0.002685546875;
  let flow = 0;
  let headspace = 0;
  let absorbed = 0;
  let wetSeconds = 0;
  let stepsSeconds = 0;
  let cupFlow = 0;
  let cupWeight = 0;
  let flowingSeconds = 0;
  let volume = 0;
  let mix = temps.mix;
  let group = temps.group;
  let pourStartMs: number | null = null;
  let maxFrameSeen = -1;
  const skipped = new Set<number>();
  let stopRequest: 'apiStop' | null = null;
  let skipRequested = false;
  let stopReason: string | null = null;
  let aborted = false;
  let stoppingFrames = 0;
  let finalStateAfterStop: 'stopping' | 'finished' = 'stopping';
  let lastTargets = { pressure: 0, flow: 0 };
  let lastProfileFrame = input.staleFrame;

  function stampAt(index: number): number {
    // 200 ms spacing with a few ms of jitter, like BLE notifications.
    const at = input.startMs + index * FRAME_MS + (random() * 30 - 15);
    previousAt = Math.max(at, previousAt + 1);
    return previousAt;
  }

  function event(kind: 'state' | 'decision' | 'terminal', state: ShotStateEvent['state'], machine: MachineSnapshot, decision: ShotDecision | null = null): ShotStateEvent {
    return {
      event: kind,
      timestamp: machine.timestamp,
      shotId: input.shotId,
      state,
      machineState: machine.state.state,
      machineSubstate: machine.state.substate,
      profileFrame: machine.profileFrame,
      scaleConnected: input.scaleConnected,
      scaleLost: false,
      machineHasAutonomousSAW: false,
      decision,
    };
  }

  function snapshot(atMs: number, state: string, substate: string, targets: { pressure: number; flow: number }, profileFrame: number, targetMix: number, targetGroup: number): MachineSnapshot {
    return {
      timestamp: formatLocalTimestamp(atMs),
      state: { state, substate },
      flow: quantize(Math.max(0, flow), 4096),
      pressure: quantize(Math.max(0, pressure), 4096),
      targetFlow: quantize(targets.flow, 16),
      targetPressure: quantize(targets.pressure, 16),
      mixTemperature: quantize(mix, 256),
      groupTemperature: quantize(group, 65536),
      targetMixTemperature: quantize(targetMix, 256),
      targetGroupTemperature: quantize(targetGroup, 256),
      profileFrame,
      steamTemperature: Math.round(temps.steam),
    };
  }

  const scaleReading = () => Math.round(cupWeight * 10) / 10;

  function weight(atMs: number): WeightSnapshot | null {
    if (!input.scaleConnected) return null;
    return {
      timestamp: formatLocalTimestamp(atMs - 21),
      weight: scaleReading(),
      weightFlow: phase === 'preheat' ? 0 : cupFlow,
      battery: 87,
      timerValue: pourStartMs === null ? null : Math.max(0, Math.round(atMs - pourStartMs)),
    };
  }

  /** Decaid's projected weight: what the scale reads plus its weight flow over the look-ahead. */
  function projected(): number {
    return scaleReading() + cupFlow * weightLookAheadS;
  }

  function enterStep(index: number): void {
    const previous = steps[index - 1];
    const step = steps[index];
    stepIndex = index;
    stepElapsed = 0;
    stepPumped = 0;
    if (!step) return;
    // A smooth step ramps from the previous step's target on the same axis.
    smoothFrom = previous && previous.pump === step.pump ? targetOf(previous) : step.pump === 'flow' ? flow : pressure;
  }

  function setPoint(step: ProfileStep): number {
    const target = targetOf(step);
    if (step.transition !== 'smooth' || step.seconds <= 0) return target;
    return smoothFrom + (target - smoothFrom) * Math.min(1, stepElapsed / step.seconds);
  }

  /** One 200 ms tick of pump, puck and cup. Returns the reported targets. */
  function physics(step: ProfileStep | null): { pressure: number; flow: number } {
    const fill = Math.min(1, absorbed / saturationMl);
    const erosion = 0.55 + 0.45 * Math.exp(-wetSeconds / 30);
    const resistance = puckResistance * fill ** 3 * erosion;
    const headspaceFull = headspace >= HEADSPACE_ML - 1e-9;
    let targets = { pressure: 0, flow: 0 };

    if (!step) {
      flow = approach(flow, 0, 0.15);
      pressure = approach(pressure, 0, 0.8);
    } else if (step.pump === 'flow') {
      const set = setPoint(step);
      targets = { pressure: 0, flow: set };
      const maxPressure = step.limiter && step.limiter.value > 0 ? step.limiter.value : MAX_PRESSURE;
      let wantFlow = set;
      let wantPressure = headspaceFull ? resistance * set * set : 0.3 * Math.min(1, set / 2);
      if (wantPressure > maxPressure && resistance > 0) {
        wantPressure = maxPressure;
        wantFlow = Math.sqrt(maxPressure / resistance);
      }
      flow = approach(flow, wantFlow, 0.35);
      pressure = set <= 0.05 ? approach(pressure, 0, 2.5) : approach(pressure, wantPressure, 0.5);
    } else {
      const set = setPoint(step);
      targets = { pressure: set, flow: 0 };
      const maxFlow = step.limiter && step.limiter.value > 0 ? step.limiter.value : MAX_FLOW;
      if (!headspaceFull) {
        flow = approach(flow, Math.min(FILL_FLOW, maxFlow), 0.3);
        pressure = approach(pressure, Math.min(set, 0.3), 0.5);
      } else {
        pressure = approach(pressure, Math.min(set, resistance * maxFlow * maxFlow), 0.6);
        const wantFlow = resistance > 1e-6 ? Math.min(maxFlow, Math.sqrt(Math.max(0, pressure) / resistance)) : maxFlow;
        flow = approach(flow, wantFlow, 0.3);
      }
    }

    // Water: headspace first, then the puck, then the cup.
    let water = Math.max(0, flow) * DT;
    stepPumped += water;
    if (headspace < HEADSPACE_ML) {
      const take = Math.min(HEADSPACE_ML - headspace, water);
      headspace += take;
      water -= take;
    }
    const through = absorbed >= saturationMl ? water : water * smoothstep(dripStart, 1, fill);
    absorbed = Math.min(saturationMl, absorbed + (water - through));
    if (absorbed > 0) wetSeconds += DT;
    const throughRate = through / DT;
    cupFlow = approach(cupFlow, throughRate, CUP_LAG_S);
    cupWeight += cupFlow * DT;
    if (cupWeight > 0.05 && step && targetOf(step) > 0.05) flowingSeconds += DT;
    return targets;
  }

  function temperaturesFor(step: ProfileStep | null): { targetMix: number; targetGroup: number } {
    const stepTemperature = step?.temperature ?? steps[Math.min(stepIndex, steps.length - 1)]?.temperature ?? 90;
    const targetMix = stepTemperature + 1.5;
    mix = approach(mix, targetMix - 1, 3);
    group = approach(group, stepTemperature - 0.3, 8);
    return { targetMix, targetGroup: stepTemperature };
  }

  /** Once the machine is idle again it heads back to the profile's first step (machine.ts idleTemperature). */
  function restingTemperatures(): { targetMix: number; targetGroup: number } {
    const target = idleTemperature(input.profile) ?? 90;
    mix = approach(mix, target, 3);
    group = approach(group, target - 0.3, 8);
    return { targetMix: target, targetGroup: target };
  }

  function stopDecision(reason: string, details: string, data: Record<string, unknown> | null = null): ShotDecision {
    return { kind: 'stop', reason, details, data };
  }

  function frame(atMs: number, machine: MachineSnapshot, events: ShotStateEvent[], recorded: boolean, done: boolean): SimFrame {
    lastProfileFrame = machine.profileFrame;
    return { atMs, machine, scale: weight(atMs), volume, events, recorded, done };
  }

  /**
   * Stopped before the pour began: Decaid's sequencer, still preheating until
   * a preinfusion or pouring frame, sees the machine leave espresso and
   * aborts the run, and its state manager cleans up without saving it
   * (shot_sequencer.dart:399-408, de1_state_manager.dart:854-864 at aab5f93).
   * So also for a stop after the last preheat frame, before the first pour
   * frame (D204).
   */
  function abortBeforePour(atMs: number, reason: string): SimFrame {
    flow = 0;
    const machine = snapshot(atMs, 'idle', 'idle', lastTargets, input.staleFrame, 18.19921875, steps[0]!.temperature);
    aborted = true;
    stopReason = null;
    phase = 'done';
    const abort: ShotDecision = { kind: 'abort', reason, details: 'Shot aborted during preheat, before the pour began', data: null };
    return frame(atMs, machine, [event('decision', 'preheating', machine, abort)], false, true);
  }

  function preheatFrame(atMs: number): SimFrame {
    if (stopRequest) return abortBeforePour(atMs, stopRequest);
    flow = approach(flow, 0.27, 0.3);
    mix = approach(mix, steps[0]!.temperature - 0.4, 4);
    const machine = snapshot(atMs, 'espresso', 'preparingForShot', lastTargets, input.staleFrame, 18.19921875, steps[0]!.temperature);
    const events = frameIndex === 0 ? [event('state', 'preheating', machine)] : [];
    if (frameIndex + 1 >= PREHEAT_FRAMES) {
      phase = 'steps';
      enterStep(0);
    }
    return frame(atMs, machine, events, true, false);
  }

  function enterStopping(atMs: number, machine: MachineSnapshot, decision: ShotDecision, events: ShotStateEvent[]): SimFrame {
    stopReason = decision.reason;
    events.push(event('decision', 'pouring', machine, decision));
    // Decaid latches a trusted yield only with a live scale reading; without
    // one it finishes at once.
    finalStateAfterStop = input.scaleConnected && cupWeight > 0 ? 'stopping' : 'finished';
    events.push(event('state', finalStateAfterStop, machine));
    phase = finalStateAfterStop === 'stopping' ? 'stopping' : 'done';
    return frame(atMs, machine, events, false, phase === 'done');
  }

  function stepsFrame(atMs: number): SimFrame {
    const events: ShotStateEvent[] = [];
    // No pour frame yet: the sequencer is still preheating.
    if (stopRequest && maxFrameSeen < 0) return abortBeforePour(atMs, stopRequest);
    if (pourStartMs === null) pourStartMs = atMs;

    if (stopRequest === 'apiStop') {
      // REST idle stops the machine; the sequencer sees an idle sample. A
      // stop right after the pour's first frame keeps a record with one
      // frame of pour in it, as Decaid does (D204).
      physics(null);
      const temperatures = temperaturesFor(null);
      const machine = snapshot(atMs, 'idle', 'idle', lastTargets, Math.min(stepIndex, steps.length - 1), temperatures.targetMix, temperatures.targetGroup);
      return enterStopping(atMs, machine, stopDecision('apiStop', 'Shot stopped via REST API request'), events);
    }

    if (skipRequested) {
      skipRequested = false;
      if (stepIndex < steps.length) enterStep(stepIndex + 1);
    }

    const step = steps[stepIndex] ?? null;
    const capped = flowingSeconds >= CAP_FLOWING_S || stepsSeconds >= MAX_STEPS_S;
    if (!step || capped) {
      physics(null);
      const temperatures = temperaturesFor(null);
      const machine = snapshot(atMs, 'espresso', 'pouringDone', lastTargets, Math.min(stepIndex, steps.length - 1), temperatures.targetMix, temperatures.targetGroup);
      if (maxFrameSeen < 0) events.push(event('state', 'pouring', machine));
      return enterStopping(atMs, machine, stopDecision('machineEnded', 'Machine reported shot end (pouringDone)'), events);
    }

    const targets = physics(step);
    lastTargets = targets;
    stepElapsed += DT;
    stepsSeconds += DT;
    if (stepIndex >= volumeCountStart) volume += Math.max(0, flow) * DT;
    const temperatures = temperaturesFor(step);
    const substate = stepIndex < countStart ? 'preinfusion' : 'pouring';
    const machine = snapshot(atMs, 'espresso', substate, targets, stepIndex, temperatures.targetMix, temperatures.targetGroup);

    if (maxFrameSeen < 0) {
      events.push(event('state', 'pouring', machine));
      maxFrameSeen = stepIndex;
    } else {
      for (let advanced = maxFrameSeen; advanced < stepIndex; advanced += 1) {
        if (skipped.has(advanced)) continue;
        events.push(
          event('decision', 'pouring', machine, {
            kind: 'advance',
            reason: 'profileAdvance',
            details: `Firmware advanced from frame ${advanced} to ${advanced + 1}`,
            data: { fromFrame: advanced, toFrame: advanced + 1 },
          }),
        );
      }
      maxFrameSeen = Math.max(maxFrameSeen, stepIndex);
    }

    const projectedWeight = projected();
    if (stopAtWeight && projectedWeight >= input.targetYield) {
      return enterStopping(
        atMs,
        machine,
        stopDecision(
          'targetWeight',
          `Target weight ${dartDouble(input.targetYield)}g reached (projected: ${dartDouble(projectedWeight)}). Stopping shot.`,
          { targetYield: input.targetYield, projectedWeight },
        ),
        events,
      );
    }

    if (stopAtVolume) {
      // Strictly greater, with the reported flow as the look-ahead, as Decaid does.
      const projectedVolume = volume + machine.flow * volumeLookAheadS;
      if (projectedVolume > targetVolume) {
        return enterStopping(
          atMs,
          machine,
          stopDecision(
            'targetVolume',
            `Target volume ${dartDouble(targetVolume)}ml reached (projected: ${dartDouble(projectedVolume)}). Stopping shot.`,
            { targetVolume, projectedVolume },
          ),
          events,
        );
      }
    }

    // Step exits, decided on this sample and taking effect on the next.
    let advance = stepElapsed >= step.seconds - 1e-9 || (step.volume > 0 && stepPumped >= step.volume);
    const exit = step.exit;
    if (exit && exit.value > 0 && stepElapsed > DT + 1e-9) {
      const measured = exit.type === 'pressure' ? pressure : flow;
      if (exit.condition === 'over' ? measured > exit.value : measured < exit.value) advance = true;
    }
    if (!advance && !input.bypassSaw && input.scaleConnected && step.weight !== null && step.weight > 0 && projectedWeight >= step.weight) {
      skipped.add(stepIndex);
      events.push(
        event('decision', 'pouring', machine, {
          kind: 'advance',
          reason: 'profileSkip',
          details: `Step weight ${dartDouble(step.weight)}g reached (projected: ${dartDouble(projectedWeight)}), skipping frame ${stepIndex}`,
          data: { frame: stepIndex, stepExitWeight: step.weight, projectedWeight },
        }),
      );
      advance = true;
    }
    if (advance) enterStep(stepIndex + 1);
    return frame(atMs, machine, events, true, false);
  }

  function stoppingFrame(atMs: number): SimFrame {
    physics(null);
    // pouringDone still shows the last step; from the next frame on the DE1 is idle.
    const temperatures = stoppingFrames === 0 ? temperaturesFor(null) : restingTemperatures();
    const profileFrame = Math.min(stepIndex, steps.length - 1);
    const machineState = stoppingFrames === 0 ? 'espresso' : 'idle';
    const substate = stoppingFrames === 0 ? 'pouringDone' : 'idle';
    const machine = snapshot(atMs, machineState, substate, lastTargets, profileFrame, temperatures.targetMix, temperatures.targetGroup);
    stoppingFrames += 1;
    if (stoppingFrames >= STOPPING_FRAMES) {
      phase = 'done';
      return frame(atMs, machine, [event('state', 'finished', machine)], false, true);
    }
    return frame(atMs, machine, [], false, false);
  }

  return {
    next() {
      if (phase === 'done') return null;
      const atMs = stampAt(frameIndex);
      let result: SimFrame;
      if (phase === 'preheat') result = preheatFrame(atMs);
      else if (phase === 'steps') result = stepsFrame(atMs);
      else result = stoppingFrame(atMs);
      frameIndex += 1;
      return result;
    },
    requestStop(reason) {
      if (phase === 'preheat' || phase === 'steps') stopRequest = reason;
    },
    skipStep() {
      if (phase === 'steps') skipRequested = true;
    },
    get phase() {
      return phase;
    },
    get stopReason() {
      return stopReason;
    },
    get aborted() {
      return aborted;
    },
    get doseG() {
      return input.doseG;
    },
    get lastProfileFrame() {
      return lastProfileFrame;
    },
    get scaleWeightG() {
      return input.scaleConnected ? scaleReading() : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface ShotPlayerOptions {
  /** Wall-clock compression: 10 plays a 30 s shot in 3 s (data timestamps stay realistic). */
  speed?: number;
}

export interface ShotPlayer {
  /** What the machine is doing, or null when idle or asleep. */
  readonly activity: MockActivity | null;
  readonly speed: number;
  setSpeed(speed: number): void;
  /** Apply a PUT /machine/state/{name} that Decaid accepted. */
  command(name: string): void;
  /** Pull a shot as if the group-head button was pressed. False when the machine cannot. */
  start(): boolean;
  /** Same as PUT /machine/state/idle. */
  stop(): void;
  skipStep(): void;
  tare(): void;
  /** Emit a resting machine (and scale) frame every intervalMs of wall time. */
  startIdleFrames(intervalMs?: number): void;
  stopIdleFrames(): void;
  /** Resolves once nothing is running. */
  whenIdle(): Promise<void>;
  /** Id of the last shot started (also the ShotRecord id when it was persisted). */
  readonly lastShotId: string | null;
  dispose(): void;
}

const ACTIVITIES: readonly MockActivity[] = ['steam', 'hotWater', 'flush', 'steamRinse', 'cleaning', 'descaling', 'airPurge'];

/**
 * D5: the real time-to-ready.reaplugin plugin reacts to every machine
 * stateUpdate while the machine is not asleep (plugin.js handleStateUpdate),
 * needs two temperature samples before it can estimate a rate
 * (estimateRemainingTime), and clamps its estimate to 5 min
 * (plugin_manager.dart emit path). The mock free-runs its own ticker rather
 * than modelling real temperatures: insufficient_data for the first couple
 * of ticks, then a heating countdown from a few mock-minutes, then reached,
 * repeated for as long as the machine stays awake. Wall-clock ms per tick
 * (at speed 1), scaled by the player's speed; a late subscriber, or one
 * reconnecting after the machine already reached temperature, hears the
 * current status within one tick either way.
 */
const TTR_TICK_MS = 1000;
const TTR_INSUFFICIENT_TICKS = 2;
/** About 2.5 mock-minutes, so "Ready in about 2 min" is visible for a few ticks before it drops. */
const TTR_HEATING_START_MS = 150_000;
const TTR_HEATING_STEP_MS = 5_000;
/** One mock-second of warming per tick, for the temperature's own approach to target (not the displayed countdown, which reports a separate, larger "time left" estimate). */
const TTR_DT_S = TTR_TICK_MS / 1000;
/**
 * Time constant for that approach. TTR_INSUFFICIENT_TICKS + TTR_HEATING_START_MS /
 * TTR_HEATING_STEP_MS ticks actually elapse before reached (2 + 30 = 32 mock-seconds
 * here), so this is sized against that, not against the displayed 150 s estimate:
 * 32 / 8 ticks of tau is >98% of the way there by reached.
 */
const TTR_WARM_TAU_S = 8;

/** D6: the Visualizer plugin writes lastUploadedShot a few seconds after a shot ends (plugin.js SHOT_FETCH_DELAY_MS is 5s; the mock uses a shorter, documented delay). */
const VISUALIZER_UPLOAD_DELAY_MS = 4000;
/** Visualizer's real ids are large sequential numbers; the mock just counts up from one. */
const FIRST_VISUALIZER_ID = 1_000_000;

/**
 * Steam, hot water and flush as a DE1 runs them (D150): a heater's warm-up
 * (preparingForShot), then the drink until the time or the volume set in the
 * workflow (re-read every frame, as Decaid writes it to the machine at once),
 * with readings shaped like the machine's own; steam ends with the wand's
 * purge (puffing). The other activities keep their short generic run.
 */
type MockDrink = 'steam' | 'hotWater' | 'flush';
const MOCK_DRINKS: ReadonlySet<MockActivity> = new Set<MockActivity>(['steam', 'hotWater', 'flush']);
/** Frames of preparingForShot before the drink's work starts. */
const DRINK_WARMUP_FRAMES: Readonly<Record<MockDrink, number>> = { steam: 2, hotWater: 2, flush: 1 };
/** The steam wand's purge after the steam, in frames. */
const STEAM_PURGE_FRAMES = 3;
/**
 * Decaid turns the steam heater off for a steam temperature under this
 * (state.ts writes it to the machine as 0): its reading then neither sags
 * under the draw nor recovers to a target.
 */
const STEAM_OFF_BELOW = 135;
/** Frames hot water takes to reach its flow, and a flush its. */
const WATER_RAMP_FRAMES = 5;
const FLUSH_RAMP_FRAMES = 3;
/** The mock pours hot water at 8 ml/s at most, whatever is set (the DE1's own ceiling is near it). */
const HOT_WATER_MAX_FLOW = 8;
/** The cup on the scale lags the water by about this much while it pours. */
const SCALE_LAG_ML = 1.5;

interface DrinkRunState {
  /** Frames since the start. */
  frame: number;
  /** Seconds of the drink's work so far. */
  workS: number;
  waterMl: number;
  purge: number;
}

export function createShotPlayer(state: MockDecaid, options: ShotPlayerOptions = {}): ShotPlayer {
  let speed = options.speed && options.speed > 0 ? options.speed : 1;
  let activity: MockActivity | null = null;
  let resting: 'idle' | 'sleeping' = 'idle';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleIntervalMs = 0;
  let simulation: ShotSimulation | null = null;
  let measurements: ShotSnapshot[] = [];
  let shotId: string | null = null;
  let shotCount = 0;
  let activityFrame = 0;
  let activityStop = false;
  let drinkRun: DrinkRunState = { frame: 0, workS: 0, waterMl: 0, purge: 0 };
  /** The steam record of the steaming now, kept once it ends (D191). */
  let openSteam: MockSteamRecord | null = null;
  let idleTick = 0;
  const waiters: Array<() => void> = [];
  let ttrTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ticks since the machine was last known awake; reset on sleep. */
  let ttrTicks = 0;
  /**
   * True from an explicit wake (not a fresh, never-slept player, and not just
   * an activity returning to idle) until the countdown reaches reached. Drives
   * the machine snapshot's idle/preparingForShot vs idle/idle (see
   * emitResting), kept separate from ttrTicks/timeToReadyStatus so a fresh
   * player or one finishing steam/espresso never shows "warming" by accident.
   */
  let warmingUp = false;
  const visualizerTimers = new Set<ReturnType<typeof setTimeout>>();
  let nextVisualizerId = FIRST_VISUALIZER_ID;

  const wallDelay = () => FRAME_MS / speed;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function stopTimeToReady(): void {
    if (ttrTimer !== null) clearTimeout(ttrTimer);
    ttrTimer = null;
  }

  function resetTimeToReady(): void {
    ttrTicks = 0;
  }

  function scheduleTimeToReady(): void {
    stopTimeToReady();
    ttrTimer = setTimeout(timeToReadyTick, TTR_TICK_MS / speed);
  }

  /** What time-to-ready.reaplugin would report right now, from `ttrTicks` alone (no side effects). */
  function timeToReadyStatus(): TimeToReadyFrame {
    if (ttrTicks < TTR_INSUFFICIENT_TICKS) return { status: 'insufficient_data', remainingTimeMs: null };
    const heatingTicks = ttrTicks - TTR_INSUFFICIENT_TICKS;
    const remaining = Math.max(0, TTR_HEATING_START_MS - heatingTicks * TTR_HEATING_STEP_MS);
    return remaining > 0 ? { status: 'heating', remainingTimeMs: remaining } : { status: 'reached', remainingTimeMs: 0 };
  }

  /** One tick's worth of exponential approach toward `target`, quantized like the destination it replaces. */
  function approachWarmingTemperature(current: number, target: number, steps: number): number {
    return quantize(current + (target - current) * (1 - Math.exp(-TTR_DT_S / TTR_WARM_TAU_S)), steps);
  }

  /**
   * D5: runs for the player's whole life, not just after a wake. The real
   * plugin hears a stateUpdate whether or not the machine is asleep and
   * decides for itself whether to emit; this mirrors that by checking
   * "awake and connected" on every tick instead of starting and stopping a
   * one-shot sequence. Also carries warmingUp through to reached (D103
   * follow-up): a real DE1 reports idle/preparingForShot while it warms up
   * (de1.utils.dart mapDe1SubToMachineSubstate: heatWaterTank,
   * heatWaterHeater, stabilizeMixTemp), idle/idle once ready.
   */
  function timeToReadyTick(): void {
    ttrTimer = null;
    if (resting === 'sleeping' || !state.isMachineConnected()) {
      // The real plugin resets lastEstimation to null while asleep (plugin.js); the next
      // wake's first ticks are insufficient_data again, exactly as a real heat-up would be.
      resetTimeToReady();
      scheduleTimeToReady();
      return;
    }
    const frame = timeToReadyStatus();
    const wasWarming = warmingUp;
    if (frame.status === 'reached') warmingUp = false;
    // Only touch the machine snapshot while an actual wake's warm-up is running or ending
    // this tick: this ticker has nothing to do with the machine channel otherwise, and
    // must never step on the scripted shot's or an activity's own frames.
    if (activity === null && (wasWarming || warmingUp)) emitResting();
    if (state.isPluginLoaded(PLUGIN_IDS.timeToReady)) state.publishTimeToReady(frame);
    ttrTicks += 1;
    scheduleTimeToReady();
  }

  function settle(): void {
    activity = null;
    simulation = null;
    clearTimer();
    for (const resolve of waiters.splice(0)) resolve();
  }

  function idleEvent(): ShotStateEvent {
    const current = state.getMachineSnapshot();
    return {
      event: 'state',
      timestamp: formatLocalTimestamp(state.clock.now()),
      shotId: null,
      state: 'idle',
      machineState: current.state.state,
      machineSubstate: current.state.substate,
      profileFrame: null,
      scaleConnected: state.isScaleConnected(),
      scaleLost: false,
      machineHasAutonomousSAW: false,
      decision: null,
    };
  }

  function emitResting(): void {
    if (!state.isMachineConnected()) return;
    const current = state.getMachineSnapshot();
    idleTick += 1;
    // A heater holding temperature wobbles a little; deterministic on purpose.
    const wobble = Math.sin(idleTick / 3) * 0.06;
    // Between shots the DE1 holds the first step of the profile it holds, not the last shot's step.
    const idle = idleTemperature(state.getMachineProfile());
    const targetMix = idle === null ? current.targetMixTemperature : quantize(idle, 256);
    const targetGroup = idle === null ? current.targetGroupTemperature : quantize(idle, 256);
    const warming = resting === 'idle' && warmingUp;
    const settledMix = quantize(targetMix + wobble, 256);
    const settledGroup = quantize(targetGroup - 0.9 + wobble, 65536);
    state.setMachineSnapshot({
      ...current,
      timestamp: formatLocalTimestamp(state.clock.now()),
      state: { state: resting, substate: warming ? 'preparingForShot' : 'idle' },
      flow: 0,
      pressure: quantize(0.002 + Math.abs(wobble) / 100, 4096),
      targetMixTemperature: targetMix,
      targetGroupTemperature: targetGroup,
      mixTemperature: warming ? approachWarmingTemperature(current.mixTemperature, settledMix, 256) : settledMix,
      groupTemperature: warming ? approachWarmingTemperature(current.groupTemperature, settledGroup, 65536) : settledGroup,
    });
  }

  function scheduleIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    if (idleIntervalMs <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (activity === null) {
        emitResting();
        const scale = state.getScaleSnapshot();
        if (scale) state.setScaleWeight({ ...scale, timestamp: formatLocalTimestamp(state.clock.now()), weightFlow: 0 });
      }
      scheduleIdle();
    }, idleIntervalMs);
  }

  function persist(sim: ShotSimulation): void {
    if (sim.aborted || measurements.length === 0 || !shotId) return;
    const workflow = state.getWorkflow();
    if (UNSAVED_BEVERAGES.has(workflow.profile.beverage_type)) return;
    let provenance: Record<string, unknown> = { provenanceStatus: 'unavailable' };
    try {
      const info = state.getMachineInfo();
      provenance = { provenanceStatus: 'captured', flowCalibration: 1.0, serialNumber: info.serialNumber, model: info.model, firmwareVersion: info.version };
    } catch {
      // Machine gone at the end of the shot: Decaid records the provenance as unavailable.
    }
    const first = measurements[0]!.machine;
    // Decaid stores the cup once its stopping tail settled the weight: the drips are in.
    const settledYield = sim.scaleWeightG;
    const startMs = parseDecaidTimestamp(first.timestamp);
    const endMs = state.clock.now();
    const record: ShotRecord = {
      id: shotId,
      timestamp: formatLocalTimestamp(startMs + 6.342),
      createdAt: formatUtcTimestamp(endMs + 40),
      updatedAt: formatUtcTimestamp(endMs + 40),
      measurements,
      workflow: { ...workflow, machine: provenance } as ShotRecord['workflow'],
      annotations:
        settledYield === null ? { actualDoseWeight: sim.doseG } : { actualDoseWeight: sim.doseG, actualYield: settledYield },
      stopReason: sim.stopReason ?? 'machineEnded',
    };
    state.addShot(record);
    scheduleVisualizerUpload(record.id);
  }

  /**
   * D6: visualizer.reaplugin writes lastUploadedShot and lastVisualizerId a
   * few seconds after it uploads a finished shot, and stamps the shot's own
   * annotations.extras.visualizerId with a PUT (rememberSuccessfulUpload /
   * rememberUpload, plugin.js, aab5f93 and af4e995 alike), so the shot
   * card's Visualizer link (spec 6.4) has an id to link to.
   */
  function scheduleVisualizerUpload(uploadedShotId: string): void {
    if (!state.isPluginLoaded(PLUGIN_IDS.visualizer)) return;
    const timer = setTimeout(() => {
      visualizerTimers.delete(timer);
      const visualizerId = nextVisualizerId;
      nextVisualizerId += 1;
      state.kvSet(PLUGIN_IDS.visualizer, 'lastUploadedShot', JSON.stringify(uploadedShotId));
      state.kvSet(PLUGIN_IDS.visualizer, 'lastVisualizerId', JSON.stringify(visualizerId));
      try {
        state.updateShot(uploadedShotId, { annotations: { extras: { visualizerId: String(visualizerId) } } });
      } catch {
        // The shot could have been deleted since; the real plugin's own PUT would fail the same way.
      }
    }, VISUALIZER_UPLOAD_DELAY_MS / speed);
    visualizerTimers.add(timer);
  }

  function finishEspresso(): void {
    const sim = simulation;
    if (sim) {
      persist(sim);
      state.lastProfileFrame = sim.lastProfileFrame;
    }
    // Without a scale there is no stopping tail, so the last frame is still
    // mid-pour: Decaid asks the DE1 for idle after its own stop, and the DE1
    // goes idle by itself after pouringDone.
    if (state.getMachineSnapshot().state.state === 'espresso') {
      resting = 'idle';
      emitResting();
    }
    state.publishShotState(idleEvent());
    measurements = [];
    settle();
  }

  function tearDownMidShot(): void {
    const sim = simulation;
    if (sim) {
      const current = state.getMachineSnapshot();
      state.publishShotState({
        event: 'terminal',
        timestamp: current.timestamp,
        shotId,
        state: sim.phase === 'preheat' ? 'preheating' : sim.phase === 'stopping' ? 'stopping' : 'pouring',
        machineState: current.state.state,
        machineSubstate: current.state.substate,
        profileFrame: current.profileFrame,
        scaleConnected: state.isScaleConnected(),
        scaleLost: false,
        machineHasAutonomousSAW: false,
        decision: { kind: 'terminal', reason: 'disconnected', details: 'Shot tracking torn down mid-shot', data: null },
      });
    }
    state.publishShotState(idleEvent());
    measurements = [];
    settle();
  }

  function espressoTick(): void {
    timer = null;
    const sim = simulation;
    if (!sim) return;
    if (!state.isMachineConnected()) {
      tearDownMidShot();
      return;
    }
    const frame = sim.next();
    if (!frame) {
      finishEspresso();
      return;
    }
    if (frame.scale) state.setScaleWeight(frame.scale);
    state.setMachineSnapshot(frame.machine);
    if (frame.recorded) measurements.push({ machine: frame.machine, scale: frame.scale, volume: frame.volume });
    for (const shotEvent of frame.events) state.publishShotState(shotEvent);
    state.clock.advanceTo(frame.atMs + 1);
    if (frame.done) {
      finishEspresso();
      return;
    }
    timer = setTimeout(espressoTick, wallDelay());
  }

  function beginEspresso(): void {
    const workflow = state.getWorkflow();
    const settings = state.getSettings();
    const current = state.getMachineSnapshot();
    shotCount += 1;
    shotId = newId();
    measurements = [];
    simulation = createShotSimulation({
      // The DE1 brews what it holds, which lags the workflow while an upload
      // runs; Decaid's sequencer takes its targets from the workflow
      // (de1_state_manager.dart _startShotSequencer).
      profile: state.getMachineProfile(),
      targetYield: workflow.context?.targetYield ?? 0,
      targetVolume: workflow.context?.targetWaterVolume ?? workflow.profile.target_volume,
      volumeCountStart: workflow.profile.target_volume_count_start,
      volumeFlowMultiplier: decaidNumber(settings.volumeFlowMultiplier),
      weightFlowMultiplier: decaidNumber(settings.weightFlowMultiplier),
      doseG: workflow.context?.targetDoseWeight ?? 18,
      scaleConnected: state.isScaleConnected(),
      bypassSaw: settings.gatewayMode === 'full',
      startMs: state.clock.now(),
      shotId,
      staleFrame: state.lastProfileFrame,
      seed: shotCount,
      startTemperatures: { mix: current.mixTemperature, group: current.groupTemperature, steam: current.steamTemperature },
    });
    activity = 'espresso';
    resting = 'idle';
    espressoTick();
  }

  function activityValues(name: MockActivity): { flow: number; pressure: number; mix: number } {
    const workflow = state.getWorkflow();
    // The mock's workflow always holds numbers (normalizeWorkflow); CafAI's type allows null for a field it could not read.
    const steam = workflow.steamSettings;
    const water = workflow.hotWaterData;
    const rinse = workflow.rinseData;
    if (name === 'steam') return { flow: steam.flow ?? 0.8, pressure: 1.7, mix: 60 };
    if (name === 'hotWater') return { flow: Math.min(water.flow ?? 10, 8), pressure: 0.4, mix: water.targetTemperature ?? 75 };
    return { flow: rinse.flow ?? 6, pressure: 0.6, mix: rinse.targetTemperature ?? 90 };
  }

  /**
   * The scale weighs the hot water: tared as the water starts, the cup then
   * following the water SCALE_LAG_ML behind, and holding all of it once the
   * water stops.
   */
  function weighWater(weightG: number, flow: number, at: number): void {
    const scale = state.getScaleSnapshot();
    if (!scale) return;
    state.setScaleWeight({ ...scale, timestamp: formatLocalTimestamp(at), weight: quantize(Math.max(0, weightG), 10), weightFlow: quantize(flow, 10) });
  }

  function drinkTick(name: MockDrink): void {
    timer = null;
    if (!state.isMachineConnected()) {
      // Decaid discards a steam record the machine left mid-way (steam_sequencer.dart:72-77).
      openSteam = null;
      settle();
      return;
    }
    const current = state.getMachineSnapshot();
    const at = Math.max(state.clock.now(), parseDecaidTimestamp(current.timestamp) + FRAME_MS);
    const workflow = state.getWorkflow();
    const run = drinkRun;
    // Decaid opens a steam record on the first frame in steam, with the workflow as it stands then.
    if (name === 'steam' && run.frame === 0) openSteam = { id: newId(), timestamp: formatLocalTimestamp(at), measurements: [], workflow: clone(workflow) };
    const warming = run.frame < DRINK_WARMUP_FRAMES[name];
    const k = run.frame - DRINK_WARMUP_FRAMES[name];
    const steamSet = workflow.steamSettings.targetTemperature ?? 150;
    let finished = activityStop;
    let substate = warming ? 'preparingForShot' : 'pouring';
    let flow = 0;
    let pressure = 0.002;
    let mix = current.mixTemperature;
    let group = current.groupTemperature;
    let steamTemperature = current.steamTemperature;
    if (name === 'hotWater' && run.frame === 0) weighWater(0, 0, at);
    if (!finished && !warming) {
      if (name === 'steam') {
        const steam = workflow.steamSettings;
        if (run.workS >= (steam.duration ?? 50) - 1e-9) {
          if (run.purge >= STEAM_PURGE_FRAMES) finished = true;
          else {
            substate = 'puffing';
            pressure = 1.2 - run.purge * 0.35;
            run.purge += 1;
          }
        } else {
          flow = (steam.flow ?? 0.8) + 0.06 * Math.sin(k * 0.9);
          pressure = 1.9 + 0.25 * Math.sin(k * 0.7) + 0.08 * Math.sin(k * 2.3);
          // The heater sags a few degrees under the draw and recovers.
          if (steamSet >= STEAM_OFF_BELOW) steamTemperature = Math.round(steamSet - 3 + 2 * Math.sin(k / 6));
          run.workS += DT;
        }
      } else if (name === 'hotWater') {
        const water = workflow.hotWaterData;
        if (run.waterMl >= (water.volume ?? 50) || run.workS >= (water.duration ?? 30) - 1e-9) finished = true;
        else {
          flow = Math.min(water.flow ?? 10, HOT_WATER_MAX_FLOW) * Math.min(1, (k + 1) / WATER_RAMP_FRAMES);
          pressure = 0.4;
          mix = water.targetTemperature ?? 75;
          run.waterMl += flow * DT;
          run.workS += DT;
          weighWater(run.waterMl - SCALE_LAG_ML, flow, at);
        }
      } else {
        const rinse = workflow.rinseData;
        if (run.workS >= (rinse.duration ?? 10) - 1e-9) finished = true;
        else {
          flow = (rinse.flow ?? 6) * Math.min(1, (k + 1) / FLUSH_RAMP_FRAMES);
          pressure = 0.6;
          mix = rinse.targetTemperature ?? 90;
          // Water through the group brings it toward its target.
          group = group + (current.targetGroupTemperature - group) * 0.15;
          run.workS += DT;
        }
      }
    }
    if (finished) {
      substate = 'idle';
      if (name === 'steam' && steamSet >= STEAM_OFF_BELOW) steamTemperature = steamSet;
      // The water still on its way lands: the cup holds all that was poured.
      if (name === 'hotWater') weighWater(run.waterMl, 0, at);
    }
    const frame: MachineSnapshot = {
      ...current,
      timestamp: formatLocalTimestamp(at),
      state: { state: finished ? 'idle' : name, substate },
      flow: quantize(flow, 4096),
      pressure: quantize(pressure, 4096),
      targetFlow: quantize(substate === 'pouring' ? flow : 0, 16),
      targetPressure: 0,
      mixTemperature: quantize(mix, 256),
      groupTemperature: quantize(group, 65536),
      steamTemperature,
    };
    state.setMachineSnapshot(frame);
    if (openSteam) {
      // A sample per frame while it steams; the first frame out of steam keeps the record (steam_sequencer.dart:94-112).
      if (!finished) openSteam.measurements.push({ machine: clone(frame), milkTemperature: null });
      else {
        state.addSteam(openSteam);
        openSteam = null;
      }
    }
    state.clock.advanceTo(at + 1);
    run.frame += 1;
    if (finished) {
      settle();
      return;
    }
    timer = setTimeout(activityTick, wallDelay());
  }

  function activityTick(): void {
    timer = null;
    const name = activity;
    if (!name || name === 'espresso') return;
    if (MOCK_DRINKS.has(name)) {
      drinkTick(name as MockDrink);
      return;
    }
    if (!state.isMachineConnected()) {
      settle();
      return;
    }
    const current = state.getMachineSnapshot();
    const at = Math.max(state.clock.now(), parseDecaidTimestamp(current.timestamp) + FRAME_MS);
    const last = activityStop || activityFrame >= ACTIVITY_FRAMES;
    const values = activityValues(name);
    const substate = last ? 'idle' : activityFrame < 2 ? 'preparingForShot' : activityFrame === ACTIVITY_FRAMES - 1 ? 'pouringDone' : 'pouring';
    const pouring = substate === 'pouring';
    state.setMachineSnapshot({
      ...current,
      timestamp: formatLocalTimestamp(at),
      state: { state: last ? 'idle' : name, substate },
      flow: quantize(pouring ? values.flow : 0, 4096),
      pressure: quantize(pouring ? values.pressure : 0.002, 4096),
      targetFlow: quantize(pouring ? values.flow : 0, 16),
      targetPressure: 0,
      mixTemperature: quantize(pouring ? values.mix : current.mixTemperature, 256),
    });
    state.clock.advanceTo(at + 1);
    activityFrame += 1;
    if (last) {
      settle();
      return;
    }
    timer = setTimeout(activityTick, wallDelay());
  }

  function beginActivity(name: MockActivity): void {
    activity = name;
    resting = 'idle';
    activityFrame = 0;
    activityStop = false;
    drinkRun = { frame: 0, workS: 0, waterMl: 0, purge: 0 };
    openSteam = null;
    activityTick();
  }

  const player: ShotPlayer = {
    get activity() {
      return activity;
    },
    get speed() {
      return speed;
    },
    setSpeed(next) {
      speed = Number.isFinite(next) && next > 0 ? next : 1;
    },
    command(name) {
      if (name === 'espresso') {
        if (activity === null) beginEspresso();
        return;
      }
      if ((ACTIVITIES as readonly string[]).includes(name)) {
        if (activity === null) beginActivity(name as MockActivity);
        return;
      }
      if (name === 'idle') {
        if (activity === 'espresso') simulation?.requestStop('apiStop');
        else if (activity !== null) activityStop = true;
        else {
          const wasAsleep = resting === 'sleeping';
          resting = 'idle';
          // A real DE1 warms up after a wake, not after an activity just ending (de1.utils.dart).
          if (wasAsleep) warmingUp = true;
          emitResting();
        }
        return;
      }
      if (name === 'sleeping') {
        if (activity === null) {
          resting = 'sleeping';
          warmingUp = false;
          emitResting();
          // The real plugin discards its estimate while the machine sleeps (plugin.js
          // handleStateUpdate); reset now rather than waiting for the ticker's next
          // tick, so a sleep immediately followed by a wake still starts fresh.
          resetTimeToReady();
        }
        return;
      }
      if (name === 'skipStep' && activity === 'espresso') simulation?.skipStep();
    },
    start() {
      if (!state.isMachineConnected() || activity !== null) return false;
      beginEspresso();
      return true;
    },
    stop() {
      player.command('idle');
    },
    skipStep() {
      player.command('skipStep');
    },
    tare() {
      const scale = state.getScaleSnapshot();
      if (!scale) return;
      state.setScaleWeight({ ...scale, timestamp: formatLocalTimestamp(state.clock.now()), weight: 0, weightFlow: 0 });
    },
    startIdleFrames(intervalMs = 1000) {
      idleIntervalMs = intervalMs;
      scheduleIdle();
    },
    stopIdleFrames() {
      idleIntervalMs = 0;
      scheduleIdle();
    },
    whenIdle() {
      return activity === null ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve));
    },
    get lastShotId() {
      return shotId;
    },
    dispose() {
      idleIntervalMs = 0;
      scheduleIdle();
      settle();
      stopTimeToReady();
      for (const timer of visualizerTimers) clearTimeout(timer);
      visualizerTimers.clear();
    },
  };
  // D5: starts right away, since a fresh mock begins awake (resting 'idle'); the tick
  // itself checks connectivity and sleep state every time, so this never needs restarting.
  scheduleTimeToReady();
  return player;
}


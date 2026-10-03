/**
 * The mock DE1: plays shots that follow the active workflow profile, plus
 * steam / hot water / flush, sleep and tare.
 *
 * A shot is a deterministic simulation: 5 Hz machine frames with local
 * zone-less timestamps, ~2 s of preparingForShot, then the profile's steps
 * (flow steps hold flow, pressure steps hold pressure, smooth steps ramp,
 * exits, step weight exits and limiters honoured), preinfusion for frames
 * below target_volume_count_start and pouring after, and a puck model that
 * turns pumped water into cup weight. Stop-at-weight uses
 * workflow.context.targetYield exactly like Decaid's shot sequencer, and the
 * shotState frames, the decision bodies and the persisted ShotRecord follow
 * shot_sequencer.dart / de1_state_manager.dart. Wall-clock playback can be
 * compressed with `speed`; data timestamps stay realistic.
 */
import type {
  MachineSnapshot,
  ShotDecision,
  ShotRecord,
  ShotSnapshot,
  ShotStateEvent,
  WeightSnapshot,
  WireProfile,
} from '../../src/api/types.ts';
import type { ProfileStep } from '../../src/coach/types.ts';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import { newId } from '../../src/util/id.ts';
import { formatLocalTimestamp, formatUtcTimestamp } from './clock.ts';
import { dartDouble } from './json.ts';
import type { MockDecaid } from './state.ts';

/** One frame every 200 ms of data time (5 Hz). */
export const FRAME_MS = 200;
const DT = FRAME_MS / 1000;
const PREHEAT_FRAMES = 10;
const STOPPING_FRAMES = 8;
const ACTIVITY_FRAMES = 20;

// Puck model: a headspace to fill, a puck that absorbs water (resistance
// rising as it wets and easing as it extracts), then cup weight from the
// water that passes through.
const HEADSPACE_ML = 8;
const FILL_FLOW = 6;
const MAX_FLOW = 8;
const MAX_PRESSURE = 12;
const R0 = 2.4;
const DRIP_START = 0.4;
const RISE_TAU_S = 1.2;
const DRIP_TAU_S = 3;
/** Decaid projects weight ahead by weightFlow x multiplier; a short look-ahead lands near the target. */
const PROJECTION_S = 0.25;
/** Ends shots that would never reach the target: 45 s of cup flow (a bloom pause does not count). */
const CAP_FLOWING_S = 45;
const MAX_STEPS_S = 150;

export type MockActivity = 'espresso' | 'steam' | 'hotWater' | 'flush' | 'steamRinse' | 'cleaning' | 'descaling' | 'airPurge';

export interface ShotSimulationInput {
  profile: WireProfile;
  /** context.targetYield; 0 turns stop-at-weight off. */
  targetYield: number;
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
  /** ml pumped since profileFrame >= target_volume_count_start. */
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
}

function quantize(value: number, steps: number): number {
  return Math.round(value * steps) / steps;
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
  const saturationMl = Math.max(8, input.doseG * 0.8);
  const stopAtWeight = input.scaleConnected && input.targetYield > 0 && !input.bypassSaw;
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

  function weight(atMs: number): WeightSnapshot | null {
    if (!input.scaleConnected) return null;
    return {
      timestamp: formatLocalTimestamp(atMs - 21),
      weight: Math.round(cupWeight * 10) / 10,
      weightFlow: phase === 'preheat' ? 0 : cupFlow,
      battery: 87,
      timerValue: pourStartMs === null ? null : Math.max(0, Math.round(atMs - pourStartMs)),
    };
  }

  function projected(): number {
    return cupWeight + cupFlow * PROJECTION_S;
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
    const resistance = R0 * fill ** 3 * erosion;
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
    const through = absorbed >= saturationMl ? water : water * smoothstep(DRIP_START, 1, fill);
    absorbed = Math.min(saturationMl, absorbed + (water - through));
    if (absorbed > 0) wetSeconds += DT;
    const throughRate = through / DT;
    cupFlow = approach(cupFlow, throughRate, throughRate >= cupFlow ? RISE_TAU_S : DRIP_TAU_S);
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

  function stopDecision(reason: string, details: string, data: Record<string, unknown> | null = null): ShotDecision {
    return { kind: 'stop', reason, details, data };
  }

  function frame(atMs: number, machine: MachineSnapshot, events: ShotStateEvent[], recorded: boolean, done: boolean): SimFrame {
    lastProfileFrame = machine.profileFrame;
    return { atMs, machine, scale: weight(atMs), volume, events, recorded, done };
  }

  function preheatFrame(atMs: number): SimFrame {
    if (stopRequest) {
      // Stopped before the pour: Decaid aborts and persists nothing.
      flow = 0;
      const machine = snapshot(atMs, 'idle', 'idle', lastTargets, input.staleFrame, 18.19921875, steps[0]!.temperature);
      aborted = true;
      stopReason = null;
      phase = 'done';
      const abort: ShotDecision = { kind: 'abort', reason: stopRequest, details: 'Shot aborted during preheat, before the pour began', data: null };
      return frame(atMs, machine, [event('decision', 'preheating', machine, abort)], false, true);
    }
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
    if (pourStartMs === null) pourStartMs = atMs;

    if (stopRequest === 'apiStop') {
      // REST idle stops the machine; the sequencer sees an idle sample.
      physics(null);
      const temperatures = temperaturesFor(null);
      const machine = snapshot(atMs, 'idle', 'idle', lastTargets, Math.min(stepIndex, steps.length - 1), temperatures.targetMix, temperatures.targetGroup);
      if (maxFrameSeen < 0) events.push(event('state', 'pouring', machine));
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
    if (stepIndex >= countStart) volume += Math.max(0, flow) * DT;
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
    const temperatures = temperaturesFor(null);
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
  let idleTick = 0;
  const waiters: Array<() => void> = [];

  const wallDelay = () => FRAME_MS / speed;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
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
    state.setMachineSnapshot({
      ...current,
      timestamp: formatLocalTimestamp(state.clock.now()),
      state: { state: resting, substate: 'idle' },
      flow: 0,
      pressure: quantize(0.002 + Math.abs(wobble) / 100, 4096),
      mixTemperature: quantize(current.targetMixTemperature + wobble, 256),
      groupTemperature: quantize(current.targetGroupTemperature - 0.9 + wobble, 65536),
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
    let provenance: Record<string, unknown> = { provenanceStatus: 'unavailable' };
    try {
      const info = state.getMachineInfo();
      provenance = { provenanceStatus: 'captured', flowCalibration: 1.0, serialNumber: info.serialNumber, model: info.model, firmwareVersion: info.version };
    } catch {
      // Machine gone at the end of the shot: Decaid records the provenance as unavailable.
    }
    const first = measurements[0]!.machine;
    const lastWeight = measurements[measurements.length - 1]!.scale?.weight ?? null;
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
        lastWeight === null
          ? { actualDoseWeight: sim.doseG }
          : { actualDoseWeight: sim.doseG, actualYield: Math.round((lastWeight + 0.4) * 10) / 10 },
      stopReason: sim.stopReason ?? 'machineEnded',
    };
    state.addShot(record);
  }

  function finishEspresso(): void {
    const sim = simulation;
    if (sim) {
      persist(sim);
      state.lastProfileFrame = sim.lastProfileFrame;
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
    const current = state.getMachineSnapshot();
    shotCount += 1;
    shotId = newId();
    measurements = [];
    simulation = createShotSimulation({
      profile: workflow.profile,
      targetYield: workflow.context?.targetYield ?? 0,
      doseG: workflow.context?.targetDoseWeight ?? 18,
      scaleConnected: state.isScaleConnected(),
      bypassSaw: state.getSettings().gatewayMode === 'full',
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
    if (name === 'steam') return { flow: workflow.steamSettings.flow, pressure: 1.7, mix: 60 };
    if (name === 'hotWater') return { flow: Math.min(workflow.hotWaterData.flow, 8), pressure: 0.4, mix: workflow.hotWaterData.targetTemperature };
    return { flow: workflow.rinseData.flow, pressure: 0.6, mix: workflow.rinseData.targetTemperature };
  }

  function activityTick(): void {
    timer = null;
    const name = activity;
    if (!name || name === 'espresso') return;
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
          resting = 'idle';
          emitResting();
        }
        return;
      }
      if (name === 'sleeping') {
        if (activity === null) {
          resting = 'sleeping';
          emitResting();
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
    },
  };
  return player;
}


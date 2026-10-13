/**
 * Steam, hot water and flush, recorded once for the whole app, as
 * shotTrace.ts records a shot: every drink's view draws from the same run, so
 * a view opened mid-run has it from its first frame (D148).
 *
 * A run starts at the first machine frame in one of a drink's states
 * (kinds.ts) and ends at the first frame in any other state, or when the
 * machine goes away. The drink's time counts only while it does its work:
 * not while the heater still warms (preparingForShot), nor while steam is
 * paused or the wand purges or rinses (pausedSteam, puffing, steamRinse). It
 * runs on the machine's own frame timestamps, as the shot timer does, from the
 * first frame past heating. Its water is the flow summed over the same time.
 * A frame older than the last is left out, as the shot graph leaves it out.
 *
 * Frames never touch React state: views hear of each (onData) and draw it
 * themselves. React hears only of a run starting and ending (subscribe). The
 * last run of each drink stays for the session, so a drink's view opened
 * later shows it.
 */
import { parseDecaidTimestamp } from '../../api/time.ts';
import type { MachineFrame, TelemetryStore } from '../../api/types.ts';
import { drinkOfState, type DrinkKind } from './kinds.ts';

/** The heater is still warming: the drink has not begun. */
const HEATING = 'preparingForShot';
/** Substates in which the drink does not do its work: warming, steam paused, the wand's purge. */
const RESTING_SUBSTATES: ReadonlySet<string> = new Set([HEATING, 'pausedSteam', 'puffing']);
/** A quarter of an hour at ten frames a second; a run longer than that keeps its sums, not its frames. */
export const MAX_FRAMES = 9000;

export interface DrinkRun {
  readonly kind: DrinkKind;
  /** 1 for the app's first run, counting up, so a view can tell a new run from the one it drew. */
  readonly id: number;
  /** True until the run ends. */
  readonly live: boolean;
  /** The run ended because the machine went away. */
  readonly lost: boolean;
  /** Seconds from the drink's first working frame, one per frame recorded from then on. */
  readonly t: readonly number[];
  readonly flow: readonly (number | null)[];
  readonly pressure: readonly (number | null)[];
  readonly steamTemperature: readonly (number | null)[];
  readonly groupTemperature: readonly (number | null)[];
  /** What the scale read at each frame; null without a reading. */
  readonly weight: readonly (number | null)[];
  /** Whether the drink did its work at each frame (its time counted after it). */
  readonly working: readonly boolean[];
  /** The run's newest frame, heating included. */
  readonly latest: MachineFrame | null;
  /** Seconds the drink has done its work; fixed once the run ends. */
  readonly elapsedS: number;
  /** Millilitres the machine has measured through, its flow summed over the working time. */
  readonly waterMl: number;
}

export interface DrinkTraceState {
  /** The drink running now, or null. */
  readonly live: DrinkKind | null;
  /** The newest run's id, 0 before the first. */
  readonly runId: number;
}

export interface DrinkRunEvent {
  type: 'started' | 'ended';
  run: DrinkRun;
}

export interface DrinkTrace {
  /** The same object until a run starts or ends, as useSyncExternalStore needs. */
  getState(): DrinkTraceState;
  subscribe(listener: () => void): () => void;
  /** Told when a run starts and when it ends. */
  onRun(listener: (event: DrinkRunEvent) => void): () => void;
  /** Told on every frame recorded into the live run. */
  onData(listener: (run: DrinkRun) => void): () => void;
  /** The live run of `kind`, or its last one this session, or null. */
  runOf(kind: DrinkKind): DrinkRun | null;
}

interface Recording {
  kind: DrinkKind;
  id: number;
  live: boolean;
  lost: boolean;
  t: number[];
  flow: (number | null)[];
  pressure: (number | null)[];
  steamTemperature: (number | null)[];
  groupTemperature: (number | null)[];
  weight: (number | null)[];
  working: boolean[];
  latest: MachineFrame | null;
  elapsedS: number;
  waterMl: number;
  /** Machine time (epoch ms) of the first working frame, or null while the heater warms. */
  startAt: number | null;
  /** Machine time of the last frame recorded, whether the drink worked then, and its flow. */
  lastAt: number | null;
  lastWorking: boolean;
  lastFlow: number | null;
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One broken view must not stop the others for the rest of the run. */
function callSafely(listener: () => void): void {
  try {
    listener();
  } catch {
    // As the telemetry store's own listeners: the next frame tries again.
  }
}

function newRecording(kind: DrinkKind, id: number): Recording {
  return {
    kind,
    id,
    live: true,
    lost: false,
    t: [],
    flow: [],
    pressure: [],
    steamTemperature: [],
    groupTemperature: [],
    weight: [],
    working: [],
    latest: null,
    elapsedS: 0,
    waterMl: 0,
    startAt: null,
    lastAt: null,
    lastWorking: false,
    lastFlow: null,
  };
}

/** Adds a frame to a run; false when it changed nothing a view shows. */
function record(run: Recording, frame: MachineFrame, weight: number | null): boolean {
  run.latest = frame;
  const at = parseDecaidTimestamp(frame.timestamp);
  if (!Number.isFinite(at)) return true;
  const substate = frame.state.substate;
  if (run.startAt === null) {
    // Nothing to count while the heater warms; the first frame past it is the drink's time zero.
    if (substate === HEATING) return true;
    run.startAt = at;
  } else if (run.lastAt !== null && at <= run.lastAt) {
    // A late frame would be drawn backwards; the newest frame still says what the machine does.
    return true;
  }
  const working = frame.state.state !== 'steamRinse' && !RESTING_SUBSTATES.has(substate);
  const flow = finite(frame.flow);
  if (run.lastAt !== null && run.lastWorking) {
    const seconds = (at - run.lastAt) / 1000;
    run.elapsedS += seconds;
    if (flow !== null && run.lastFlow !== null) run.waterMl += Math.max(0, ((flow + run.lastFlow) / 2) * seconds);
  }
  run.lastAt = at;
  run.lastWorking = working;
  run.lastFlow = working ? flow : null;
  if (run.t.length < MAX_FRAMES) {
    run.t.push((at - run.startAt) / 1000);
    run.flow.push(flow);
    run.pressure.push(finite(frame.pressure));
    run.steamTemperature.push(finite(frame.steamTemperature));
    run.groupTemperature.push(finite(frame.groupTemperature));
    run.weight.push(weight);
    run.working.push(working);
  }
  return true;
}

export function createDrinkTrace(telemetry: TelemetryStore): DrinkTrace {
  let state: DrinkTraceState = { live: null, runId: 0 };
  let current: Recording | null = null;
  const lastRuns = new Map<DrinkKind, Recording>();
  let seen: MachineFrame | null = null;
  const listeners = new Set<() => void>();
  const runListeners = new Set<(event: DrinkRunEvent) => void>();
  const dataListeners = new Set<(run: DrinkRun) => void>();

  const setState = (next: DrinkTraceState) => {
    state = next;
    for (const listener of [...listeners]) callSafely(listener);
  };
  const tellRun = (event: DrinkRunEvent) => {
    for (const listener of [...runListeners]) callSafely(() => listener(event));
  };

  function begin(kind: DrinkKind): Recording {
    const run = newRecording(kind, state.runId + 1);
    current = run;
    lastRuns.set(kind, run);
    setState({ live: kind, runId: run.id });
    tellRun({ type: 'started', run });
    return run;
  }

  function end(lost: boolean): void {
    const run = current;
    if (!run) return;
    current = null;
    run.live = false;
    run.lost = lost;
    setState({ live: null, runId: state.runId });
    tellRun({ type: 'ended', run });
  }

  function take(frame: MachineFrame): void {
    const kind = drinkOfState(frame.state?.state);
    if (current && current.kind !== kind) end(false);
    if (kind === null) return;
    const run = current ?? begin(kind);
    const now = telemetry.getState();
    const weight = now.scaleConnected ? finite(now.scale?.weight) : null;
    if (record(run, frame, weight)) for (const listener of [...dataListeners]) callSafely(() => listener(run));
  }

  function check(): void {
    const now = telemetry.getState();
    if (!now.machineConnected) {
      // A frame left over from before the machine went away describes nothing real.
      end(true);
      seen = now.machine;
      return;
    }
    if (now.machine === null || now.machine === seen) return;
    seen = now.machine;
    take(now.machine);
  }

  check();
  telemetry.subscribe(check);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onRun(listener) {
      runListeners.add(listener);
      return () => void runListeners.delete(listener);
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => void dataListeners.delete(listener);
    },
    runOf: (kind) => (current?.kind === kind ? current : (lastRuns.get(kind) ?? null)),
  };
}

const traces = new WeakMap<TelemetryStore, DrinkTrace>();

/** The app's one recording for a telemetry store, recording from its first use for as long as the store lives. */
export function drinkTraceFor(telemetry: TelemetryStore): DrinkTrace {
  let trace = traces.get(telemetry);
  if (!trace) {
    trace = createDrinkTrace(telemetry);
    traces.set(telemetry, trace);
  }
  return trace;
}

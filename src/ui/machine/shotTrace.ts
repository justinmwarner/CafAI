/**
 * The live shot, recorded once for the whole app. Every graph draws from the
 * same buffer, so a graph opened mid-shot has the shot from its first frame
 * and a graph rebuilt for a new theme loses nothing.
 *
 * Samples never touch React state: they go into the buffer and the graphs
 * are told to repaint. React hears only of the phase, a few times a shot.
 */
import type { TelemetryStore } from '../../api/types.ts';
import { createShotBuffer, type ShotBuffer } from './shotBuffer.ts';

export type ShotPhase = 'empty' | 'live' | 'done';

export interface ShotTraceState {
  phase: ShotPhase;
  /**
   * The finished shot on screen, whose card's numbers replace the live ones;
   * null while live or empty, or when Decaid gave the shot no id.
   */
  finishedShotId: string | null;
}

/**
 * 'reset': a new shot emptied the arrays, so repaint now, before uPlot can
 * redraw from them with stale indexes. 'frames': frames arrived or the pour
 * ended, so repaint on the next animation frame.
 */
export type ShotDataChange = 'reset' | 'frames';

export interface ShotTrace {
  /** The shot's arrays, for drawing; only the trace writes to them. */
  readonly buffer: ShotBuffer;
  /** The same object until the phase or the finished shot changes, as useSyncExternalStore needs. */
  getState(): ShotTraceState;
  /** Told whenever getState() changes. */
  subscribe(listener: () => void): () => void;
  onData(listener: (change: ShotDataChange) => void): () => void;
}

/** Decaid's shot states once the pour is over. */
const POUR_OVER: ReadonlySet<string> = new Set(['stopping', 'finished']);

/** One broken graph must not stop the others (or the phase change) for the rest of the shot. */
function callSafely(listener: () => void): void {
  try {
    listener();
  } catch {
    // Like the telemetry store's own listeners: the next frame tries again.
  }
}

export function createShotTrace(telemetry: TelemetryStore): ShotTrace {
  const buffer = createShotBuffer();
  let state: ShotTraceState = { phase: 'empty', finishedShotId: null };
  let showingShot = false;
  const listeners = new Set<() => void>();
  const dataListeners = new Set<(change: ShotDataChange) => void>();

  const setState = (next: ShotTraceState) => {
    if (next.phase === state.phase && next.finishedShotId === state.finishedShotId) return;
    state = next;
    for (const listener of [...listeners]) callSafely(() => listener());
  };
  const changed = (change: ShotDataChange) => {
    for (const listener of [...dataListeners]) callSafely(() => listener(change));
  };

  telemetry.onSample((sample) => {
    if (!buffer.push(sample)) return;
    // Recording began mid-shot: the first plotted frame stands in for the start we missed.
    if (!showingShot) {
      showingShot = true;
      setState({ phase: 'live', finishedShotId: null });
    }
    changed('frames');
  });
  telemetry.onShot((event) => {
    if (event.type === 'started') {
      buffer.reset();
      // Before the phase, so every graph has painted the emptied arrays
      // before a re-render (a new caption, a resize) can make uPlot redraw.
      changed('reset');
      showingShot = true;
      setState({ phase: 'live', finishedShotId: null });
    } else {
      // The finished shot stays on screen until the next one starts.
      setState(buffer.length > 0 ? { phase: 'done', finishedShotId: event.shotId } : { phase: 'empty', finishedShotId: null });
    }
  });
  // Decaid's stopping (or finished) frame carries the timestamp of the machine
  // frame it stopped on. Only a change counts, so a state still showing from
  // the last shot never stops the next shot's clock.
  let shotState = telemetry.getState().shotState;
  telemetry.subscribe(() => {
    const next = telemetry.getState().shotState;
    if (next === shotState) return;
    shotState = next;
    if (next && POUR_OVER.has(next.state) && buffer.endPour(next.timestamp)) changed('frames');
  });

  return {
    buffer,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => void dataListeners.delete(listener);
    },
  };
}

const traces = new WeakMap<TelemetryStore, ShotTrace>();

/** The app's one trace for a telemetry store, recording from its first use for as long as the store lives. */
export function shotTraceFor(telemetry: TelemetryStore): ShotTrace {
  let trace = traces.get(telemetry);
  if (!trace) {
    trace = createShotTrace(telemetry);
    traces.set(telemetry, trace);
  }
  return trace;
}

/**
 * The machine's own Clean and Descale, seen while CafAI is open (D186):
 * started in streamline, or on the machine. The firmware sends no end, so
 * done is only "seen, then gone", as streamline's maintenance-progress.js
 * reads it: a cycle seen for at least a minute, then any other state, marks
 * its step done at the last frame seen running. A shorter one was stopped,
 * not run.
 *
 * Pure: the care service feeds it each new frame from the machine's socket
 * while it is open, and nothing else, so a scale frame or a socket change
 * beside a stale frame is no frame at all. The minute is measured by the
 * frames' own times (the machine's, through Decaid), never by when CafAI
 * happened to look; a stretch CafAI could not see (no machine, a socket gone
 * quiet) ends nothing, and counts only as far as the frames on either side
 * of it say.
 */
import type { TrackedStepId } from './careRules.ts';

/** The cycles that start a step over, and the step. */
export const CYCLE_STEPS = { cleaning: 'detergent-clean', descaling: 'descale' } as const satisfies Record<string, TrackedStepId>;

type Cycle = keyof typeof CYCLE_STEPS;

/** A cycle seen for less than this was stopped at once, not run. */
export const CYCLE_MIN_MS = 60_000;

export interface CycleWatch {
  cycle: Cycle | null;
  /** The first and the last frame seen in it, by the frames' own times, epoch ms: what the minute is measured by. */
  firstMs: number;
  lastMs: number;
  /** When CafAI got that last frame, by its own clock, epoch ms: the step's last time. */
  lastSeenMs: number;
}

export const NO_CYCLE: CycleWatch = { cycle: null, firstMs: 0, lastMs: 0, lastSeenMs: 0 };

/** One machine frame as the watch reads it. */
export interface CycleFrame {
  /** The machine's state. */
  state: string;
  /** The frame's own time (its timestamp), epoch ms. */
  atMs: number;
  /** When CafAI got it, by its own clock, epoch ms. */
  seenMs: number;
}

export interface CycleSeen {
  step: (typeof CYCLE_STEPS)[Cycle];
  /** When it was last seen running, by CafAI's clock, epoch ms: its step's last time. */
  atMs: number;
}

function isCycle(state: string): state is Cycle {
  return Object.prototype.hasOwnProperty.call(CYCLE_STEPS, state);
}

function ended(watch: CycleWatch): CycleSeen | null {
  if (watch.cycle === null || watch.lastMs - watch.firstMs < CYCLE_MIN_MS) return null;
  return { step: CYCLE_STEPS[watch.cycle], atMs: watch.lastSeenMs };
}

/** One new frame: the watch after it, and the cycle it saw run and end, if this frame ended one. */
export function watchCycle(watch: CycleWatch, frame: CycleFrame): { watch: CycleWatch; seen: CycleSeen | null } {
  if (isCycle(frame.state)) {
    if (watch.cycle === frame.state) return { watch: { ...watch, lastMs: frame.atMs, lastSeenMs: frame.seenMs }, seen: null };
    return { watch: { cycle: frame.state, firstMs: frame.atMs, lastMs: frame.atMs, lastSeenMs: frame.seenMs }, seen: ended(watch) };
  }
  return { watch: NO_CYCLE, seen: ended(watch) };
}

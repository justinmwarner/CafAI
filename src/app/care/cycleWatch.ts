/**
 * The machine's own Clean and Descale, seen while CafAI is open (D-CARE-4):
 * started in streamline, or on the machine. The firmware sends no end, so
 * done is only "seen, then gone", as streamline's maintenance-progress.js
 * reads it: a cycle seen for at least a minute, then any other state, marks
 * its step done at the last frame seen running. A shorter one was stopped,
 * not run; a frame CafAI could not see (no machine, a socket gone quiet) ends
 * nothing. Pure: the care service feeds it the machine's frames.
 */
import type { TrackedStepId } from './careRules.ts';

/** The cycles that start a step over, and the step. */
export const CYCLE_STEPS = { cleaning: 'detergent-clean', descaling: 'descale' } as const satisfies Record<string, TrackedStepId>;

type Cycle = keyof typeof CYCLE_STEPS;

/** A cycle seen for less than this was stopped at once, not run. */
export const CYCLE_MIN_MS = 60_000;

export interface CycleWatch {
  cycle: Cycle | null;
  /** The first and the last frame seen in it, epoch ms. */
  firstMs: number;
  lastMs: number;
}

export const NO_CYCLE: CycleWatch = { cycle: null, firstMs: 0, lastMs: 0 };

export interface CycleSeen {
  step: (typeof CYCLE_STEPS)[Cycle];
  /** When it was last seen running, epoch ms: its step's last time. */
  atMs: number;
}

function isCycle(state: string): state is Cycle {
  return Object.prototype.hasOwnProperty.call(CYCLE_STEPS, state);
}

function ended(watch: CycleWatch): CycleSeen | null {
  if (watch.cycle === null || watch.lastMs - watch.firstMs < CYCLE_MIN_MS) return null;
  return { step: CYCLE_STEPS[watch.cycle], atMs: watch.lastMs };
}

/**
 * One frame: the machine's state, or null when CafAI cannot see it. Answers
 * the watch after it, and the cycle it saw run and end, if this frame ended one.
 */
export function watchCycle(watch: CycleWatch, state: string | null, atMs: number): { watch: CycleWatch; seen: CycleSeen | null } {
  if (state === null) return { watch, seen: null };
  if (isCycle(state)) {
    if (watch.cycle === state) return { watch: { ...watch, lastMs: atMs }, seen: null };
    return { watch: { cycle: state, firstMs: atMs, lastMs: atMs }, seen: ended(watch) };
  }
  return { watch: NO_CYCLE, seen: ended(watch) };
}

/**
 * Which profile Decaid's workflow carries, for the machine panel (D66).
 *
 * Decaid has no workflow stream, so the panel reads GET /workflow at the
 * moments the profile can change; `createRefresher` keeps that to one request
 * at a time. The panel takes the profile for the bag's version only when
 * CafAI's tag names the bag's active version and the titles match (D41): a
 * title alone is not enough (two bags can share a name), and the tag alone is
 * not either (another skin can load its own profile and leave the tag behind,
 * since Decaid merges `extras` key by key). It marks it "This bag" only once
 * the machine holds it (`profileMark`, D55).
 */
import type { Workflow } from '../../api/types.ts';
import type { VersionLoad } from '../../app/types.ts';

/** CafAI's key in the workflow's context.extras (written at every activation). */
const TAG_KEY = 'cafai';

export interface LoadedProfileReading {
  /** The workflow profile's title, as Decaid has it. */
  title: string;
  /** The CafAI version the workflow was tagged with when CafAI last loaded one. */
  versionId: string | null;
  bagId: string | null;
}

export interface ActiveBagVersion {
  bagId: string | null;
  versionId: string | null;
  title: string | null;
}

export function readLoadedProfile(workflow: Workflow): LoadedProfileReading {
  const title = typeof workflow.profile?.title === 'string' ? workflow.profile.title : '';
  const tag = workflow.context?.extras?.[TAG_KEY];
  if (typeof tag !== 'object' || tag === null) return { title, versionId: null, bagId: null };
  const { versionId, bagId } = tag as Record<string, unknown>;
  return {
    title,
    versionId: typeof versionId === 'string' ? versionId : null,
    bagId: typeof bagId === 'string' ? bagId : null,
  };
}

/**
 * The workflow profile's step names in order; the machine names the running
 * step by its index (`profileFrame`). Decaid's sequencer and its own shot
 * screen take the steps from the workflow too. Null without steps; a step
 * without a usable name is ''.
 */
export function profileStepNames(workflow: Workflow): string[] | null {
  const steps: unknown = workflow.profile?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return steps.map((step: unknown) => {
    const name = typeof step === 'object' && step !== null ? (step as { name?: unknown }).name : undefined;
    return typeof name === 'string' ? name.trim() : '';
  });
}

/** Same names in the same order: a read that changed nothing keeps the old list (and re-renders nothing). */
export function sameStepNames(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** The name of step `frame` (the machine's 0-based profileFrame), when the profile has one; '' for a step without a usable name. */
export function stepNameAt(stepNames: readonly string[] | null, frame: unknown): string | null {
  return typeof frame === 'number' && Number.isInteger(frame) && frame >= 0 ? (stepNames?.[frame] ?? null) : null;
}

/** A word with a capital and nothing else in capitals: "Up" in "Pressure Up", not "PI" or "LRv3". */
const CAPITALIZED_WORD = /^\p{Lu}\p{Ll}+$/u;

/**
 * A step name in sentence case, as the app writes its own labels: "pause" is
 * "Pause", "Pressure Up" is "Pressure up". Profiles spell their steps either
 * way. A word in capitals or in mixed case ("PI", "LRv3") is kept as its
 * author wrote it.
 */
export function sentenceCase(name: string): string {
  const text = name
    .split(' ')
    .map((word, index) => (index > 0 && CAPITALIZED_WORD.test(word) ? word.toLowerCase() : word))
    .join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The running step as the Shot view names it: "Pour · step 3 of 3", or just
 * "Pour" when the profile has one step, in sentence case. Null when the step,
 * or its name, is not known: a wrong count is worse than none.
 */
export function stepProgress(stepNames: readonly string[] | null, frame: unknown): string | null {
  const name = stepNameAt(stepNames, frame);
  if (!name || stepNames === null) return null;
  const shown = sentenceCase(name);
  return stepNames.length === 1 ? shown : `${shown} · step ${(frame as number) + 1} of ${stepNames.length}`;
}

/**
 * The workflow's stop-at-weight target in grams (context.targetYield), for
 * the Shot view's "of 36". Null when the stop is off (Decaid's 0), missing,
 * or not a usable number.
 */
export function workflowTargetYield(workflow: Workflow): number | null {
  const target: unknown = workflow.context?.targetYield;
  return typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : null;
}

export function isActiveBagVersion(reading: LoadedProfileReading, active: ActiveBagVersion): boolean {
  if (reading.versionId === null || reading.versionId !== active.versionId || reading.title !== active.title) return false;
  return reading.bagId === null || reading.bagId === active.bagId;
}

/** What the line says beside the title: the bag's version on the machine, on its way there, or not confirmed. */
export type ProfileMark = 'thisBag' | 'loading' | 'notConfirmed' | null;

/**
 * The mark for a workflow profile (D66). The bag's version is "This bag" only
 * once the machine holds it (D55): Decaid's barrier confirmed it, or nothing
 * is known against it (an older Decaid without the barrier, or no load since
 * CafAI started, as after a reload) and the machine is connected (D42: never
 * on the machine while it is away). While it loads, and after a load that
 * failed, the line says so instead. `load` is undefined when the coach does
 * not track it.
 */
export function profileMark(isBagVersion: boolean, load: VersionLoad | null | undefined, connected: boolean): ProfileMark {
  if (!isBagVersion) return null;
  switch (load) {
    case 'loaded':
      return 'thisBag';
    case 'loading':
      return 'loading';
    case 'failed':
      return 'notConfirmed';
    case 'waiting':
      // Saved while the machine was away: the line already says Decaid loads it on connect.
      return null;
    default:
      return connected ? 'thisBag' : null;
  }
}

export interface Refresher {
  /** Read now; when a read is in flight, read once more as soon as it ends. */
  now(): void;
  /** Read once nothing has asked for `debounceMs`. */
  soon(): void;
  dispose(): void;
}

/** Serializes reads: at most one in flight, and a request made meanwhile is never lost. */
export function createRefresher(read: () => Promise<unknown>, debounceMs: number): Refresher {
  let inFlight = false;
  let again = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function settle(): void {
    inFlight = false;
    if (!again) return;
    again = false;
    run();
  }

  function run(): void {
    if (disposed) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    let pending: Promise<unknown>;
    try {
      pending = read();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(settle, settle);
  }

  return {
    now() {
      // A debounced read still waiting is covered by this one.
      cancelTimer();
      run();
    },
    soon() {
      if (disposed) return;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      again = false;
      cancelTimer();
    },
  };
}

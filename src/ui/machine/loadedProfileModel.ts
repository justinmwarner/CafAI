/**
 * Which profile Decaid's workflow carries, for the machine panel (D66).
 *
 * Decaid has no workflow stream, so the panel reads GET /workflow at the
 * moments the profile can change; `createRefresher` keeps that to one request
 * at a time. The panel marks the profile as the bag's own only when CafAI's
 * tag names the bag's active version and the titles match (D41): a title
 * alone is not enough (two bags can share a name), and the tag alone is not
 * either (another skin can load its own profile and leave the tag behind,
 * since Decaid merges `extras` key by key).
 */
import type { Workflow } from '../../api/types.ts';

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

export function isActiveBagVersion(reading: LoadedProfileReading, active: ActiveBagVersion): boolean {
  if (reading.versionId === null || reading.versionId !== active.versionId || reading.title !== active.title) return false;
  return reading.bagId === null || reading.bagId === active.bagId;
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

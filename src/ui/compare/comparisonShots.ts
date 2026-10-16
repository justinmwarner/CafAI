/**
 * Shots read from Decaid to be drawn under another (D-CURVE-4), kept for the
 * session.
 *
 * Most shots drawn under another come from their card in the chat, with no
 * request: each card keeps its summary with the ~1 Hz curves. Only a shot
 * that is not in the chat on screen (another coffee's last shot, the bag
 * the barista has since left) is read here, from `GET /api/v1/shots/{id}`,
 * and summarised as any shot is. One request per shot: callers that want
 * the same shot meanwhile share it, and the answer is kept, so a card that
 * re-renders, or comes back into view, never asks again. Decaid answering
 * 404 (the shot was deleted there) is kept as none for the session; any
 * other failure is none for now, and may be asked again after RETRY_AFTER_MS,
 * only when something wants the shot again. Either way the caller draws its
 * own shot alone and says nothing.
 */
import { GatewayError, type DecaidClient } from '../../api/types.ts';
import { summarizeShot } from '../../coach/summary/summarize.ts';
import type { ShotSummary } from '../../coach/types.ts';
import { hasCurve, pourCurve } from './comparison.ts';

/** How long a failed read is left before a wanting caller may try it again. */
export const RETRY_AFTER_MS = 60_000;
/** Shots kept; the oldest read goes first. A shot's ~1 Hz curves are small, but the session can be long. */
export const MAX_SHOTS = 24;

type Entry =
  | { state: 'loading'; promise: Promise<ShotSummary | null> }
  | { state: 'done'; summary: ShotSummary | null }
  | { state: 'failed'; at: number };

export interface ComparisonShots {
  /**
   * The shot as read so far: its summary, null when Decaid has none to draw
   * (or the read failed), undefined before any answer.
   */
  peek(shotId: string): ShotSummary | null | undefined;
  /** Read the shot unless it was read, is being read, or failed less than RETRY_AFTER_MS ago. */
  load(shotId: string): Promise<ShotSummary | null>;
  /** Told when a read ends. */
  subscribe(listener: () => void): () => void;
}

export interface ComparisonShotsOptions {
  now?: () => number;
}

export function createComparisonShots(decaid: Pick<DecaidClient, 'getShot'>, options: ComparisonShotsOptions = {}): ComparisonShots {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // One broken listener must not keep the others from hearing.
      }
    }
  };

  /** A Map keeps insertion order: setting an entry again moves it to the end, so the first is the oldest read. */
  const put = (shotId: string, entry: Entry) => {
    entries.delete(shotId);
    entries.set(shotId, entry);
    while (entries.size > MAX_SHOTS) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  const read = async (shotId: string): Promise<ShotSummary | null> => {
    try {
      const summary = summarizeShot(await decaid.getShot(shotId));
      const usable = hasCurve(pourCurve(summary)) ? summary : null;
      put(shotId, { state: 'done', summary: usable });
      return usable;
    } catch (error) {
      if (error instanceof GatewayError && error.status === 404) put(shotId, { state: 'done', summary: null });
      else put(shotId, { state: 'failed', at: now() });
      return null;
    } finally {
      notify();
    }
  };

  return {
    peek(shotId) {
      const entry = entries.get(shotId);
      if (!entry || entry.state === 'loading') return undefined;
      return entry.state === 'done' ? entry.summary : null;
    },
    load(shotId) {
      const entry = entries.get(shotId);
      if (entry?.state === 'loading') return entry.promise;
      if (entry?.state === 'done') return Promise.resolve(entry.summary);
      if (entry?.state === 'failed' && now() - entry.at < RETRY_AFTER_MS) return Promise.resolve(null);
      // The loading entry goes in before the read starts, so even a read that
      // ends at once replaces it, never the other way round.
      let settle: (summary: ShotSummary | null) => void = () => {};
      const promise = new Promise<ShotSummary | null>((resolve) => {
        settle = resolve;
      });
      put(shotId, { state: 'loading', promise });
      void read(shotId).then(settle);
      return promise;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const perClient = new WeakMap<object, ComparisonShots>();

/** The session's one cache for a Decaid client. */
export function comparisonShotsFor(decaid: Pick<DecaidClient, 'getShot'>): ComparisonShots {
  let shots = perClient.get(decaid);
  if (!shots) {
    shots = createComparisonShots(decaid);
    perClient.set(decaid, shots);
  }
  return shots;
}

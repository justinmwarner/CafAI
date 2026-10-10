/**
 * Writes to Decaid that must not be lost when Decaid cannot take them (D64):
 * the grinder setting in the workflow context, and CafAI's annotations on a
 * shot record.
 *
 * Writes are keyed and the latest one under a key wins: each write carries
 * everything its key needs (the grinder as last saved, a shot's annotations
 * so far), so an older one waiting under the same key is simply dropped. A
 * write runs at once; one that fails waits and runs again when the engine
 * flushes (Decaid is reachable again, the machine connects, a shot finished)
 * and every 30 s while anything waits. One write per key is in flight at a
 * time, so a slow attempt can never land after a newer one. Every write must
 * be idempotent: a retry may repeat one whose answer was lost.
 *
 * Only a write that may still go through waits (5.11): Decaid did not answer,
 * timed out, or answered 408, 409, 425, 429 or 5xx. Decaid refusing it (any
 * other 4xx), or CafAI failing on its own (a TypeError), would fail the same
 * way on every retry, so the write is dropped and `onDrop` says so. A write
 * Decaid took whose reply CafAI could not read counts as sent: the reader
 * reported the reply.
 *
 * In memory only: a reload drops what waits (the next profile load writes the
 * grinder anyway).
 */
import { GatewayError } from '../../api/types.ts';

export interface OutboxTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Thrown by a write that cannot go out yet although nothing failed (the stars
 * wait until Decaid says which rating scale it uses, D101): it waits and runs
 * again on the next flush.
 */
export class WriteLater extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriteLater';
  }
}

/** Refusals that may pass later: a timeout, a conflict, too early, too many requests. */
const RETRY_STATUSES = new Set([408, 409, 425, 429]);

/**
 * What the outbox does with a write that threw: `retry` it later, count it as
 * `landed` (Decaid took it; only the reply was unreadable), or `drop` it.
 */
export function writeFailure(error: unknown): 'retry' | 'landed' | 'drop' {
  if (error instanceof WriteLater) return 'retry';
  if (!(error instanceof GatewayError)) return 'drop';
  if (error.code === 'network' || error.code === 'timeout') return 'retry';
  if (error.status >= 200 && error.status < 300) return 'landed';
  return error.status >= 500 || RETRY_STATUSES.has(error.status) ? 'retry' : 'drop';
}

export interface OutboxOptions {
  retryMs?: number;
  timers?: OutboxTimers;
  /** A write that cannot succeed was dropped (see writeFailure); not called for one a newer write replaced. */
  onDrop?: (key: string, error: unknown) => void;
}

export interface Outbox {
  /**
   * Keep `write` under `key`, replacing a write that still waits there, and
   * send it at once (after the write in flight under the same key, if any).
   * Resolves true when nothing waits on its account any more (sent, replaced
   * or dropped before it ran, or dropped because it cannot succeed), false
   * when it failed and waits for a retry.
   */
  put(key: string, write: () => Promise<unknown>): Promise<boolean>;
  /** Send every waiting write again now. */
  flush(): Promise<void>;
  /** Forget the write under `key`: something else delivered it. */
  drop(key: string): void;
  /** The keys of the writes that wait. */
  pending(): string[];
  /** Stop the retry timer and forget what waits. */
  dispose(): void;
}

export const OUTBOX_RETRY_MS = 30_000;

export const browserTimers: OutboxTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createOutbox(options: OutboxOptions = {}): Outbox {
  const retryMs = options.retryMs ?? OUTBOX_RETRY_MS;
  const timers = options.timers ?? browserTimers;
  const waiting = new Map<string, () => Promise<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();
  let timer: unknown = null;
  let disposed = false;

  function stopTimer(): void {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  }

  /** A retry every `retryMs` while anything waits; nothing otherwise. */
  function schedule(): void {
    if (disposed || waiting.size === 0) {
      stopTimer();
      return;
    }
    if (timer !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void flush();
    }, retryMs);
  }

  async function runOnce(key: string, write: () => Promise<unknown>): Promise<boolean> {
    let failure: unknown = null;
    const run = Promise.resolve()
      .then(write)
      .then(
        () => 'sent' as const,
        (error: unknown) => {
          failure = error;
          return writeFailure(error);
        },
      );
    inFlight.set(key, run);
    const outcome = await run;
    if (inFlight.get(key) === run) inFlight.delete(key);
    // A newer write that arrived meanwhile still waits: it carries more.
    const current = waiting.get(key) === write;
    if (outcome !== 'retry' && current) waiting.delete(key);
    if (outcome === 'drop' && current) options.onDrop?.(key, failure);
    schedule();
    return outcome !== 'retry';
  }

  /** Send `write` if it is still the one waiting under `key`, after any attempt in flight. */
  async function send(key: string, write: () => Promise<unknown>): Promise<boolean> {
    for (let running = inFlight.get(key); running; running = inFlight.get(key)) await running;
    if (disposed || waiting.get(key) !== write) return true;
    const done = await runOnce(key, write);
    return done || waiting.get(key) !== write;
  }

  async function flush(): Promise<void> {
    await Promise.all(
      [...waiting].map(async ([key, write]) => {
        await send(key, write);
      }),
    );
  }

  return {
    put(key, write) {
      if (disposed) return Promise.resolve(true);
      waiting.set(key, write);
      return send(key, write);
    },
    flush,
    drop(key) {
      waiting.delete(key);
      schedule();
    },
    pending: () => [...waiting.keys()],
    dispose() {
      disposed = true;
      waiting.clear();
      stopTimer();
    },
  };
}

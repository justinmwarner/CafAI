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
 * In memory only: a reload drops what waits (the next profile load writes the
 * grinder anyway).
 */

export interface OutboxTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Outbox {
  /**
   * Keep `write` under `key`, replacing a write that still waits there, and
   * send it at once (after the write in flight under the same key, if any).
   * Resolves true when nothing waits on its account any more (sent, or
   * replaced or dropped before it ran), false when it failed and waits for a
   * retry.
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

const browserTimers: OutboxTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createOutbox(options: { retryMs?: number; timers?: OutboxTimers } = {}): Outbox {
  const retryMs = options.retryMs ?? OUTBOX_RETRY_MS;
  const timers = options.timers ?? browserTimers;
  const waiting = new Map<string, () => Promise<unknown>>();
  const inFlight = new Map<string, Promise<boolean>>();
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
    const run = Promise.resolve()
      .then(write)
      .then(
        () => true,
        () => false,
      );
    inFlight.set(key, run);
    const delivered = await run;
    if (inFlight.get(key) === run) inFlight.delete(key);
    // A newer write that arrived meanwhile still waits: it carries more.
    if (delivered && waiting.get(key) === write) waiting.delete(key);
    schedule();
    return delivered;
  }

  /** Send `write` if it is still the one waiting under `key`, after any attempt in flight. */
  async function send(key: string, write: () => Promise<unknown>): Promise<boolean> {
    for (let running = inFlight.get(key); running; running = inFlight.get(key)) await running;
    if (disposed || waiting.get(key) !== write) return true;
    const delivered = await runOnce(key, write);
    return delivered || waiting.get(key) !== write;
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

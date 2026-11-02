/**
 * The watch over the start (D274). Decaid reloads a backgrounded skin when
 * the tablet comes back from sleep, and a start that never finishes left
 * "Starting CafAI…" on the screen with no way on but Exit. The watch names
 * each stage of the start in the WebView's console (Decaid keeps those logs,
 * so a stuck stage can be read on a real tablet), says on the screen when
 * the start is slow and offers Try again, and once per page reloads the
 * page by itself. A second start that is just as slow is left to the
 * barista, so a start that never finishes cannot reload for ever.
 */

/** Where the one automatic retry is noted, per tab: sessionStorage outlives a reload, not the tab. */
export const START_RETRIED_KEY = 'cafai.start.retried';

/** After this long the screen says the start is slow and offers Try again. */
export const START_SLOW_MS = 8000;
/** After this long the page is reloaded once by itself. */
export const START_RETRY_MS = 20_000;

export interface StartWatchOptions {
  /** sessionStorage, or null where storage is blocked: then no automatic reload, only Try again. */
  storage: Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  reload(): void;
  /** The start has taken START_SLOW_MS: `stage` is what it waits on, null before the first stage. */
  onSlow(stage: string | null): void;
  slowMs?: number;
  retryMs?: number;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface StartWatch {
  /** The start moved on to a stage, as a phrase after "still": "opening this device's storage". */
  stage(name: string): void;
  /** The app rendered: the watch is off and the next slow start may retry again. */
  done(): void;
  /** The start failed and says so: the watch is off. */
  failed(): void;
  /** What the start waits on now, or null. */
  current(): string | null;
}

function flagged(storage: StartWatchOptions['storage']): boolean {
  try {
    return storage?.getItem(START_RETRIED_KEY) === '1';
  } catch {
    return false;
  }
}

function setFlag(storage: StartWatchOptions['storage'], on: boolean): boolean {
  try {
    if (on) storage?.setItem(START_RETRIED_KEY, '1');
    else storage?.removeItem(START_RETRIED_KEY);
    return true;
  } catch {
    return false;
  }
}

export function watchStart(options: StartWatchOptions): StartWatch {
  const timers = options.timers ?? globalThis;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((line: string) => console.info(line));
  const started = now();
  let stage: string | null = null;
  let stageAt = started;
  let off = false;

  const slowTimer = timers.setTimeout(() => {
    if (!off) options.onSlow(stage);
  }, options.slowMs ?? START_SLOW_MS);
  const retryTimer = timers.setTimeout(() => {
    if (off) return;
    // Only with somewhere to note it: a page that cannot remember it retried could reload for ever.
    if (options.storage === null || flagged(options.storage) || !setFlag(options.storage, true)) {
      log(`[CafAI] start: still ${stage ?? 'before the first stage'} after ${now() - started} ms; not reloading again`);
      return;
    }
    log(`[CafAI] start: still ${stage ?? 'before the first stage'} after ${now() - started} ms; reloading once`);
    options.reload();
  }, options.retryMs ?? START_RETRY_MS);

  const stop = () => {
    off = true;
    timers.clearTimeout(slowTimer);
    timers.clearTimeout(retryTimer);
  };

  return {
    stage(name) {
      if (off) return;
      const at = now();
      log(stage === null ? `[CafAI] start: ${name}` : `[CafAI] start: ${stage}, ${at - stageAt} ms; ${name}`);
      stage = name;
      stageAt = at;
    },
    done() {
      if (off) return;
      stop();
      const at = now();
      log(stage === null ? `[CafAI] started in ${at - started} ms` : `[CafAI] start: ${stage}, ${at - stageAt} ms; started in ${at - started} ms`);
      setFlag(options.storage, false);
    },
    failed() {
      stop();
    },
    current: () => stage,
  };
}

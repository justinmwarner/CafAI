/**
 * While the DEBUG flag is on: every IndexedDB transaction and every fetch the
 * page has in flight, with how long it has waited and, for a transaction, the
 * code that opened it. A start that hangs then names what it waits on (the
 * database a write queues behind, say), and a page put away says what it
 * leaves open.
 */

export interface InFlightTransaction {
  id: number;
  db: string;
  mode: IDBTransactionMode;
  stores: string[];
  /** When it was opened (the device's clock, ISO). */
  openedAt: string;
  ageMs: number;
  /** The frames that opened it, innermost first, without the watch's own. */
  stack: string[];
}

export interface InFlightFetch {
  id: number;
  method: string;
  url: string;
  startedAt: string;
  ageMs: number;
}

export interface IndexedDbWatch {
  inFlight(): InFlightTransaction[];
  /** Abort every transaction still open; how many took the abort. */
  abortAll(): number;
  stop(): void;
}

export interface FetchWatch {
  inFlight(): InFlightFetch[];
  stop(): void;
}

interface Clock {
  now(): number;
}

const MAX_FRAMES = 12;
const MAX_FRAME_LENGTH = 200;

/** The frames of an Error's stack below the watch's own `skip` frames. */
export function stackFrames(stack: string | undefined, skip: number): string[] {
  if (!stack) return [];
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== 'Error');
  return lines.slice(skip, skip + MAX_FRAMES).map((line) => (line.length > MAX_FRAME_LENGTH ? `${line.slice(0, MAX_FRAME_LENGTH)}…` : line));
}

/** One line per transaction, for the console: "cafai readwrite [settings] 8012 ms". */
export function describeTransactions(list: InFlightTransaction[]): string {
  if (list.length === 0) return 'no IndexedDB transaction open';
  return list.map((t) => `${t.db} ${t.mode} [${t.stores.join(',')}] ${t.ageMs} ms`).join('; ');
}

export function describeFetches(list: InFlightFetch[]): string {
  if (list.length === 0) return 'no request waiting';
  return list.map((f) => `${f.method} ${f.url} ${f.ageMs} ms`).join('; ');
}

/**
 * Watch IDBDatabase.prototype.transaction, which the `idb` library calls as
 * well. Transactions opened before the watch started are not seen.
 */
export function watchIndexedDb(scope: { IDBDatabase?: typeof IDBDatabase }, clock: Clock = Date): IndexedDbWatch {
  const proto = scope.IDBDatabase?.prototype;
  const open = new Map<number, { tx: IDBTransaction; info: Omit<InFlightTransaction, 'ageMs' | 'openedAt'>; at: number }>();
  if (!proto) return { inFlight: () => [], abortAll: () => 0, stop() {} };
  const original = proto.transaction;
  let next = 0;
  // A function, not an arrow: `this` is the database the page called it on.
  function transaction(this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>): IDBTransaction {
    const tx = original.apply(this, args);
    const id = ++next;
    const done = () => open.delete(id);
    open.set(id, {
      tx,
      at: clock.now(),
      info: { id, db: this.name, mode: tx.mode, stores: Array.from(tx.objectStoreNames), stack: stackFrames(new Error().stack, 1) },
    });
    tx.addEventListener('complete', done);
    tx.addEventListener('abort', done);
    return tx;
  }
  proto.transaction = transaction as IDBDatabase['transaction'];
  return {
    inFlight() {
      const now = clock.now();
      return [...open.values()].map(({ info, at }) => ({ ...info, openedAt: new Date(at).toISOString(), ageMs: now - at }));
    },
    abortAll() {
      let aborted = 0;
      for (const { tx } of [...open.values()]) {
        try {
          tx.abort();
          aborted++;
        } catch {
          // Committing or finished already: nothing left to release.
        }
      }
      return aborted;
    },
    stop() {
      if (proto.transaction === transaction) proto.transaction = original;
    },
  };
}

function requestOf(input: RequestInfo | URL, init: RequestInit | undefined): { method: string; url: string } {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request;
  const url = isRequest ? input.url : String(input);
  const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
  // A bridge report's code rides in the query (navigator.sendBeacon): never in a report.
  return { method, url: url.replace(/([?&]code=)[^&]*/i, '$1…') };
}

/** Watch `scope.fetch`. Code that took fetch before the watch started is not seen. */
export function watchFetch(scope: { fetch?: typeof globalThis.fetch }, clock: Clock = Date): FetchWatch {
  const original = scope.fetch;
  if (!original) return { inFlight: () => [], stop() {} };
  const open = new Map<number, { method: string; url: string; at: number }>();
  let next = 0;
  const watched: typeof globalThis.fetch = (input, init) => {
    const id = ++next;
    open.set(id, { ...requestOf(input, init), at: clock.now() });
    const done = () => void open.delete(id);
    const response = original.call(scope, input, init);
    response.then(done, done);
    return response;
  };
  scope.fetch = watched;
  return {
    inFlight() {
      const now = clock.now();
      return [...open.entries()].map(([id, { method, url, at }]) => ({ id, method, url, startedAt: new Date(at).toISOString(), ageMs: now - at }));
    },
    stop() {
      if (scope.fetch === watched) scope.fetch = original;
    },
  };
}

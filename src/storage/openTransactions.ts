/**
 * Every IndexedDB transaction the page has open, on every database (D284):
 * what is aborted when the page is put away (pageExit.ts) and, with the DEBUG
 * flag on, what a report names, with how long each has been open and the code
 * that opened it (src/debug/). It watches IDBDatabase.prototype.transaction,
 * which the `idb` library calls as well, from the page's first line; a
 * transaction opened before it started is not seen.
 */

export interface InFlightTransaction {
  id: number;
  db: string;
  mode: IDBTransactionMode;
  stores: string[];
  /** When it was opened (the device's clock, ISO). */
  openedAt: string;
  ageMs: number;
  /** The frames that opened it, innermost first, without the watch's own; only while stacks are on. */
  stack: string[];
}

export interface TransactionWatch {
  inFlight(): InFlightTransaction[];
  /** Abort every transaction still open: the ones that took the abort, which are no longer listed. */
  abortAll(): InFlightTransaction[];
  /** What the last abortAll() aborted. */
  lastAborted(): InFlightTransaction[];
  /** Note the stack that opens each transaction from now on (the DEBUG flag's reports), or stop. */
  setStacks(on: boolean): void;
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

/** For the console: "cafai readwrite [settings] 8012 ms; …". */
export function describeTransactions(list: InFlightTransaction[]): string {
  if (list.length === 0) return 'no IndexedDB transaction open';
  return list.map((t) => `${t.db} ${t.mode} [${t.stores.join(',')}] ${t.ageMs} ms`).join('; ');
}

export function watchTransactions(scope: { IDBDatabase?: typeof IDBDatabase }, clock: Clock = Date, options: { stacks?: boolean } = {}): TransactionWatch {
  const proto = scope.IDBDatabase?.prototype;
  const open = new Map<number, { tx: IDBTransaction; info: Omit<InFlightTransaction, 'ageMs' | 'openedAt'>; at: number }>();
  let stacks = options.stacks ?? true;
  let aborted: InFlightTransaction[] = [];
  const listed = (now: number) => (entry: { info: Omit<InFlightTransaction, 'ageMs' | 'openedAt'>; at: number }) => ({
    ...entry.info,
    openedAt: new Date(entry.at).toISOString(),
    ageMs: now - entry.at,
  });
  if (!proto) return { inFlight: () => [], abortAll: () => [], lastAborted: () => [], setStacks() {}, stop() {} };
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
      info: { id, db: this.name, mode: tx.mode, stores: Array.from(tx.objectStoreNames), stack: stacks ? stackFrames(new Error().stack, 1) : [] },
    });
    tx.addEventListener('complete', done);
    tx.addEventListener('abort', done);
    return tx;
  }
  proto.transaction = transaction as IDBDatabase['transaction'];
  return {
    inFlight() {
      return [...open.values()].map(listed(clock.now()));
    },
    abortAll() {
      const now = clock.now();
      const took: InFlightTransaction[] = [];
      for (const [id, entry] of [...open.entries()]) {
        try {
          entry.tx.abort();
          took.push(listed(now)(entry));
        } catch {
          // Committing or finished already: nothing left to release.
        }
        // Its abort event may never come (a page put away runs no more tasks): it is not open any more.
        open.delete(id);
      }
      aborted = took;
      return took;
    },
    lastAborted: () => [...aborted],
    setStacks(on) {
      stacks = on;
    },
    stop() {
      if (proto.transaction === transaction) proto.transaction = original;
    },
  };
}

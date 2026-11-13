/**
 * While the DEBUG flag is on: every request the page has waiting on an
 * answer, with how long it has waited. With the open IndexedDB transactions
 * (src/storage/openTransactions.ts), a start that hangs then names what it
 * waits on, and a page put away says what it leaves open.
 */

export interface InFlightFetch {
  id: number;
  method: string;
  url: string;
  startedAt: string;
  ageMs: number;
}

export interface FetchWatch {
  inFlight(): InFlightFetch[];
  stop(): void;
}

interface Clock {
  now(): number;
}

export function describeFetches(list: InFlightFetch[]): string {
  if (list.length === 0) return 'no request waiting';
  return list.map((f) => `${f.method} ${f.url} ${f.ageMs} ms`).join('; ');
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

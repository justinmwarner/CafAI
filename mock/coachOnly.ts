/**
 * The scripted coach without the mock Decaid: ?mockDecaid=0 (npm run dev:sim).
 *
 * Only Anthropic's API is answered, by the same handlers the mock service
 * worker uses, from inside the page's own fetch. No service worker starts and
 * WebSockets are left alone, so every Decaid call (REST and sockets) reaches
 * the real Decaid as it would without mocks: Decaid's simulator on
 * localhost:8080, or localStorage.reaHostname (docs/SIMULATOR.md). MSW's
 * worker would wrap every socket and report it open before the real one
 * connected, which resets CafAI's reconnect backoff and hides a Decaid that
 * is down or restarting. Nothing goes on window.__CAFAI_MOCK__.
 */
import { getResponse, type RequestHandler } from 'msw';
import { ANTHROPIC_API_ORIGIN } from './anthropic/handlers.ts';

/** Where the page's fetch lives: `window`. */
export interface FetchHost {
  fetch: typeof globalThis.fetch;
}

function isAnthropic(input: RequestInfo | URL): boolean {
  const url = input instanceof Request ? input.url : String(input);
  return url.startsWith(`${ANTHROPIC_API_ORIGIN}/`);
}

/**
 * Answer Anthropic's API from `handlers`; every other call goes to the fetch
 * the page had, with the caller's own arguments. Returns a function that puts
 * that fetch back.
 */
export function startCoachOnlyMock(handlers: readonly RequestHandler[], host: FetchHost = window): () => void {
  const pageFetch = host.fetch;
  const network = pageFetch.bind(host);

  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    // As fetch does: an aborted request is never sent, so the coach never hears it.
    if (request.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const scripted = await getResponse([...handlers], request.clone());
    // A route the coach does not script goes out, as the service worker lets it.
    return scripted ?? network(request);
  };
  const fetchWithCoach = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    isAnthropic(input) ? answer(input, init) : network(input, init);

  host.fetch = fetchWithCoach as typeof globalThis.fetch;
  return () => {
    if (host.fetch === fetchWithCoach) host.fetch = pageFetch;
  };
}

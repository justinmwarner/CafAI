/**
 * Microsoft Clarity in mock mode (D215): with ?mockUsage=1 usage sharing
 * reports to a stand-in project, and its tag is answered here by the mock's
 * service worker, so nothing leaves the browser. The stand-in keeps every
 * call on window.__clarityCalls, those queued before it ran first, for the
 * e2e (e2e/usage.spec.ts).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';

/** The page as the stand-in tag leaves it: each call's arguments, oldest first. */
export interface ClarityMockWindow {
  __clarityCalls?: unknown[][];
}

/** The stand-in tag: ES5, like the real one's queue handling. */
export const CLARITY_STUB = `(function () {
  var queued = (window.clarity && window.clarity.q) || [];
  window.__clarityCalls = Array.prototype.map.call(queued, function (args) { return Array.prototype.slice.call(args); });
  window.clarity = function () { window.__clarityCalls.push(Array.prototype.slice.call(arguments)); };
})();`;

export function clarityHandlers(): HttpHandler[] {
  return [
    http.get('https://www.clarity.ms/tag/:project', () => new HttpResponse(CLARITY_STUB, { headers: { 'content-type': 'application/javascript' } })),
  ];
}

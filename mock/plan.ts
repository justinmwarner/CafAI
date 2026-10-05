/**
 * Which mocks mock mode starts (npm run dev:mock, dev:sim, build:mock),
 * decided once from the page's URL before the app starts (src/main.tsx):
 *
 *   (default)      the mock Decaid (REST and WebSockets on :8080, with
 *                  window.__CAFAI_MOCK__ and ?mockPersist) and the scripted coach
 *   ?mockDecaid=0  the scripted coach only (mock/coachOnly.ts): every Decaid
 *                  call goes to a real Decaid, such as Decaid's simulator on
 *                  localhost:8080 or localStorage.reaHostname (docs/SIMULATOR.md)
 *
 * The mock Decaid's own switches are in mock/decaid/urlOptions.ts.
 */

export const MOCK_DECAID_PARAM = 'mockDecaid';

export interface MockPlan {
  /** Start the mock Decaid. False with ?mockDecaid=0: no window.__CAFAI_MOCK__, and ?mockPersist does nothing. */
  decaid: boolean;
  /** Playback speed of the scripted coach's stream (?mockSpeed). */
  coachSpeed: number;
}

export function mockPlanFromUrl(search: string): MockPlan {
  const params = new URLSearchParams(search);
  return {
    decaid: params.get(MOCK_DECAID_PARAM) !== '0',
    // Read as main.tsx always read it: unreadable or 0 is normal speed.
    coachSpeed: Number(params.get('mockSpeed')) || 1,
  };
}

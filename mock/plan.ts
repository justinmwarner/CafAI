/**
 * Which mocks mock mode starts (npm run dev:mock, dev:sim, demo, build:mock),
 * decided once from the page's URL before the app starts (src/main.tsx):
 *
 *   (default)      the mock Decaid (REST and WebSockets on :8080, with
 *                  window.__CAFAI_MOCK__ and ?mockPersist) and the scripted coach
 *   ?mockDecaid=0  the scripted coach only (mock/coachOnly.ts): every Decaid
 *                  call goes to a real Decaid, such as Decaid's simulator on
 *                  localhost:8080 or localStorage.reaHostname (docs/SIMULATOR.md)
 *   ?demo=1        the demo (npm run demo, docs/DEMO.md, D76): a pre-populated
 *                  CafAI on the mock Decaid (mock/demo/), with the scripted
 *                  coach in its demo timing and voice. It needs the mock
 *                  Decaid, so ?mockDecaid=0 turns it off.
 *
 * The mock Decaid's own switches are in mock/decaid/urlOptions.ts.
 */

export const MOCK_DECAID_PARAM = 'mockDecaid';
export const DEMO_PARAM = 'demo';

/**
 * The scripted coach's timing and voice (mock/anthropic/handlers.ts). Typed
 * here so this file needs nothing from the coach; main.tsx spreads it into
 * anthropicHandlers(), where spread members are not excess-property checked.
 */
export interface CoachMockOptions {
  firstEventDelayMs?: number;
  eventDelayMs?: number;
  jitterMs?: number;
  sentencePauseMs?: number;
  voice?: 'terse' | 'demo';
}

/**
 * The coach in the demo: about 1.5 s of "Thinking…", then about 40 words a
 * second with small pauses after sentences, in its fuller voice (D76). The
 * first text arrives as the seventh event of a reply, so 1200 ms plus six
 * 50 ms gaps puts it at about 1.5 s, the owner's pick.
 */
export const DEMO_COACH_OPTIONS: Readonly<CoachMockOptions> = Object.freeze({
  firstEventDelayMs: 1200,
  eventDelayMs: 50,
  jitterMs: 20,
  sentencePauseMs: 150,
  voice: 'demo',
});

export interface MockPlan {
  /** Start the mock Decaid. False with ?mockDecaid=0: no window.__CAFAI_MOCK__, and ?mockPersist does nothing. */
  decaid: boolean;
  /** Playback speed of the scripted coach's stream (?mockSpeed). */
  coachSpeed: number;
  /** Seed the demo before the app starts (?demo=1, only with the mock Decaid). */
  demo: boolean;
  /** The scripted coach's timing and voice: empty (its test defaults) unless this is the demo. */
  coachOptions: CoachMockOptions;
}

/** ?demo=1 on a page that runs the mock Decaid. Only exactly "1", like the other switches. */
export function demoRequested(params: URLSearchParams): boolean {
  return params.get(DEMO_PARAM) === '1' && params.get(MOCK_DECAID_PARAM) !== '0';
}

export function mockPlanFromUrl(search: string): MockPlan {
  const params = new URLSearchParams(search);
  const demo = demoRequested(params);
  return {
    decaid: params.get(MOCK_DECAID_PARAM) !== '0',
    // Read as main.tsx always read it: unreadable or 0 is normal speed.
    coachSpeed: Number(params.get('mockSpeed')) || 1,
    demo,
    coachOptions: demo ? { ...DEMO_COACH_OPTIONS } : {},
  };
}

/** The console line for a page that asked for the demo without the mock Decaid; null otherwise. */
export function demoIgnoredNote(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get(DEMO_PARAM) !== '1' || params.get(MOCK_DECAID_PARAM) !== '0') return null;
  return 'CafAI demo: ?demo=1 is ignored with ?mockDecaid=0, because the demo needs the built-in mock Decaid. Run npm run demo instead.';
}

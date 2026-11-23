/**
 * The Overhead plugin in mock builds (docs/overhead/README.md): the real
 * plugin (src/overhead/plugin), run in the page with a stand-in for Decaid's
 * host, in its own mock mode, so it replays the recorded fixtures and asks
 * nobody. Off unless `?mockOverhead=<scenario>` is set, so every other mock
 * run is the CafAI it was:
 *
 * | Scenario | The plugin | Answers |
 * |---|---|---|
 * | live | home under the approach to O'Hare's 27R | the replay, the notable area cut to 5 nm |
 * | notable | the same | the replay, ABC7's helicopter within the notable area |
 * | setup | no home | home: null |
 * | stale | as notable | positions 95 s old, `stale` |
 * | empty | as live | no aircraft |
 * | loading | as live | never (the screen's first moments) |
 */
import { delay, http, HttpResponse } from 'msw';
import { createFakeHost } from '../src/overhead/plugin/fakeHost.ts';
import { MOCK_FIXTURE_HOME } from '../src/overhead/plugin/mock.ts';
import { createOverheadPlugin } from '../src/overhead/plugin/plugin.ts';
import type { OverheadPayload } from '../src/overhead/shared/payload.ts';
import { OVERHEAD_PLUGIN_ID } from '../src/overhead/shared/settings.ts';
import { DECAID_ORIGIN_PATTERN, type MockHandler } from './decaid/index.ts';

export const OVERHEAD_SCENARIOS = ['live', 'notable', 'setup', 'stale', 'empty', 'loading'] as const;
export type OverheadScenario = (typeof OVERHEAD_SCENARIOS)[number];

export function overheadScenarioFromUrl(search: string): OverheadScenario | null {
  const value = new URLSearchParams(search).get('mockOverhead');
  return OVERHEAD_SCENARIOS.find((scenario) => scenario === value) ?? null;
}

function configFor(scenario: OverheadScenario): Record<string, unknown> {
  const home = { HomeLat: MOCK_FIXTURE_HOME.lat, HomeLon: MOCK_FIXTURE_HOME.lon };
  if (scenario === 'setup') return { MockMode: true };
  if (scenario === 'live' || scenario === 'empty' || scenario === 'loading') return { ...home, MockMode: true, NotableRadiusNm: 5 };
  return { ...home, MockMode: true };
}

export function createOverheadMockHandlers(scenario: OverheadScenario): MockHandler[] {
  const fake = createFakeHost({ config: configFor(scenario) });
  const plugin = createOverheadPlugin(
    fake.host,
    {
      // Mock mode asks nobody; anything else would be a bug, answered as a refusal.
      fetch: async () => ({ status: 403, ok: false, headers: { get: () => null }, text: async () => '', json: async () => null }),
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    'mock',
  );
  fake.attach(plugin);
  plugin.onLoad({});

  const shape = (payload: OverheadPayload): OverheadPayload => {
    if (scenario === 'empty') return { ...payload, aircraft: [], notable: [] };
    if (scenario === 'stale') return { ...payload, stale: true, dataAt: payload.generatedAt - 95_000 };
    return payload;
  };

  const answer = async (request: Request, endpoint: string) => {
    await plugin.ready();
    if (endpoint === 'overhead' && scenario === 'loading') await delay('infinite');
    const url = new URL(request.url);
    const body = request.method === 'POST' ? ((await request.json()) as unknown) : null;
    const reply = await plugin.__httpRequestHandler({ endpoint, method: request.method, body, query: Object.fromEntries(url.searchParams) });
    let text = reply.body;
    if (endpoint === 'overhead' && reply.status === 200) text = JSON.stringify(shape(JSON.parse(text) as OverheadPayload));
    return new HttpResponse(text, { status: reply.status, headers: reply.headers });
  };

  return [
    http.get(`${DECAID_ORIGIN_PATTERN}/api/v1/plugins/${OVERHEAD_PLUGIN_ID}/:endpoint`, ({ request, params }) => answer(request, String(params.endpoint))),
    http.post(`${DECAID_ORIGIN_PATTERN}/api/v1/plugins/${OVERHEAD_PLUGIN_ID}/:endpoint`, ({ request, params }) => answer(request, String(params.endpoint))),
  ];
}

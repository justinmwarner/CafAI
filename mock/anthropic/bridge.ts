/**
 * CafAI Bridge in mock mode: the scripted coach answers at
 * http://127.0.0.1:8877 as well, as the bridge on the same computer would
 * (protocol 1, docs/superpowers/specs/2026-10-11-local-claude-design.md), with
 * its health and status routes, so Settings' Find and Test and a coach turn
 * through "Claude on my computer" run without a real bridge. Any 8-character
 * code is accepted; anything else gets the bridge's 401.
 *
 *   setupServer(...anthropicHandlers({ speed: Infinity }), ...bridgeHandlers({ speed: Infinity }))
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import { anthropicHandlers, type AnthropicMockOptions } from './handlers.ts';

export const BRIDGE_MOCK_ORIGIN = 'http://127.0.0.1:8877';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'retry-after',
};

export const MOCK_BRIDGE_HEALTH = { ok: true, app: 'cafai-bridge', version: '0.1.0', protocol: 1 };

/** A bridge that is ready: Claude Code found, signed in with a Max plan, 8% of the 5-hour limit used. */
export function mockBridgeStatus(probe: { model: string } | null): Record<string, unknown> {
  return {
    ...MOCK_BRIDGE_HEALTH,
    claude: { found: true, version: '2.1.251', path: '/Users/barista/.local/bin/claude' },
    account: { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
    usage: {
      status: 'allowed',
      fiveHour: { utilization: 0.08, resetsAt: '2026-10-11T18:00:00.000Z' },
      sevenDay: { utilization: 0.3, resetsAt: '2026-10-15T08:00:00.000Z' },
    },
    runs: { live: 0, max: 3 },
    problems: [],
    ...(probe ? { probe: { ok: true, ms: 2400, model: probe.model } } : {}),
  };
}

const WRONG_CODE = {
  type: 'error',
  error: { type: 'authentication_error', message: 'CafAI Bridge did not accept that code. Check the code it shows on your computer.' },
};

/** The code as the bridge compares it: x-api-key or a bearer token, upper-cased, letters and digits only. */
function codeOf(request: Request): string {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return (request.headers.get('x-api-key') ?? bearer ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const paired = (request: Request) => codeOf(request).length === 8;
const wrongCode = () => HttpResponse.json(WRONG_CODE, { status: 401, headers: CORS_HEADERS });

export function bridgeHandlers(options: Omit<AnthropicMockOptions, 'baseUrl'> = {}): HttpHandler[] {
  return [
    http.options(`${BRIDGE_MOCK_ORIGIN}/*`, () => new HttpResponse(null, { status: 204, headers: CORS_HEADERS })),
    http.get(`${BRIDGE_MOCK_ORIGIN}/health`, () => HttpResponse.json(MOCK_BRIDGE_HEALTH, { headers: CORS_HEADERS })),
    http.get(`${BRIDGE_MOCK_ORIGIN}/v1/status`, ({ request }) => {
      if (!paired(request)) return wrongCode();
      const query = new URL(request.url).searchParams;
      const probe = query.get('probe') === '1' ? { model: query.get('model') || 'claude-haiku-4-5' } : null;
      return HttpResponse.json(mockBridgeStatus(probe), { headers: CORS_HEADERS });
    }),
    // The code first; with a good one the request goes on to the scripted coach, as Anthropic's do.
    http.post(`${BRIDGE_MOCK_ORIGIN}/v1/messages`, ({ request }) => (paired(request) ? undefined : wrongCode())),
    ...anthropicHandlers({ ...options, baseUrl: BRIDGE_MOCK_ORIGIN }),
  ];
}

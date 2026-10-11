import { describe, expect, it, vi } from 'vitest';
import {
  bridgeFailureLine,
  bridgeStatusLine,
  findBridge,
  getBridgeStatus,
  parseBridgeStatus,
  type BridgeStatus,
} from './bridgeClient.ts';

/** GET /v1/status?probe=1 as the spec shows it. */
const STATUS = {
  ok: true,
  app: 'cafai-bridge',
  version: '0.1.0',
  protocol: 1,
  claude: { found: true, version: '2.1.251', path: 'C:\\Users\\me\\.local\\bin\\claude.exe' },
  account: { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' },
  usage: {
    status: 'allowed',
    fiveHour: { utilization: 0.08, resetsAt: '2026-10-11T18:00:00.000Z' },
    sevenDay: { utilization: 0.3, resetsAt: '2026-10-15T08:00:00.000Z' },
  },
  runs: { live: 1, max: 3 },
  problems: [],
  probe: { ok: true, ms: 2400, model: 'claude-haiku-4-5' },
};

const errorBody = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });

function fakeFetch(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

const request = { baseUrl: 'http://192.168.1.20:8877', code: 'ABCDEFGH', probe: true, timeoutMs: 1000 };

describe('getBridgeStatus', () => {
  it('asks /v1/status with the probe and the code as x-api-key, and reads the answer', async () => {
    const { fetch, calls } = fakeFetch(() => json(STATUS));
    const result = await getBridgeStatus({ ...request, fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://192.168.1.20:8877/v1/status?probe=1');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers).toEqual({ 'x-api-key': 'ABCDEFGH' });
    expect(result).toEqual({ ok: true, status: STATUS });
  });

  it('runs the probe on the coach model, so a Claude Code too old for it shows up', async () => {
    const { fetch, calls } = fakeFetch(() => json(STATUS));
    await getBridgeStatus({ ...request, model: 'claude-opus-5-5', fetch });
    await getBridgeStatus({ ...request, baseUrl: 'http://192.168.1.20:8877/', model: 'my model/x', fetch });
    expect(calls.map((call) => call.url)).toEqual([
      'http://192.168.1.20:8877/v1/status?probe=1&model=claude-opus-5-5',
      'http://192.168.1.20:8877/v1/status?probe=1&model=my%20model%2Fx',
    ]);
  });

  it('leaves the probe out when not asked for it', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...STATUS, probe: undefined }));
    const result = await getBridgeStatus({ ...request, probe: false, model: 'claude-opus-5-5', fetch });
    expect(calls[0]?.url).toBe('http://192.168.1.20:8877/v1/status');
    expect(result.ok && result.status.probe).toBeUndefined();
  });

  it("reports a wrong code (401) in the bridge's own words", async () => {
    const sentence = 'CafAI Bridge did not accept that code. Check the code it shows on your computer.';
    const { fetch } = fakeFetch(() => json(errorBody('authentication_error', sentence), 401));
    expect(await getBridgeStatus({ ...request, fetch })).toEqual({ ok: false, failure: { kind: 'wrong_code', message: sentence } });
  });

  it('reports a lockout (429) with how long it lasts', async () => {
    const sentence = 'Too many wrong codes from this device. Try again in a minute.';
    const { fetch } = fakeFetch(() => json(errorBody('rate_limit_error', sentence), 429, { 'retry-after': '60' }));
    expect(await getBridgeStatus({ ...request, fetch })).toEqual({
      ok: false,
      failure: { kind: 'locked_out', message: sentence, retryAfterMs: 60_000 },
    });
  });

  it("passes on the bridge's sentence for any other failure", async () => {
    const { fetch } = fakeFetch(() => json(errorBody('api_error', 'Every run is busy. Try again shortly.'), 503));
    expect(await getBridgeStatus({ ...request, fetch })).toEqual({
      ok: false,
      failure: { kind: 'failed', status: 503, message: 'Every run is busy. Try again shortly.' },
    });
  });

  it('never passes the code on, whatever the server echoed back', async () => {
    const echo = (said: string) => `Code ${said} is wrong.`;
    const { fetch } = fakeFetch(() => json(errorBody('authentication_error', echo('abcd-efgh')), 401));
    expect(await getBridgeStatus({ ...request, fetch })).toEqual({ ok: false, failure: { kind: 'wrong_code', message: 'Code [key] is wrong.' } });

    const status = fakeFetch(() => json({ ...STATUS, problems: [echo('ABCDEFGH')], probe: { ok: false, error: echo('ABCD EFGH') } }));
    const result = await getBridgeStatus({ ...request, fetch: status.fetch });
    expect(result.ok && result.status.problems).toEqual(['Code [key] is wrong.']);
    expect(result.ok && result.status.probe).toEqual({ ok: false, error: 'Code [key] is wrong.' });
  });

  it('knows when something other than CafAI Bridge answered', async () => {
    for (const answer of [
      () => json({ ok: true, app: 'something-else' }),
      () => new Response('<html>router login</html>', { status: 200 }),
      () => new Response('<html>Unauthorized</html>', { status: 401 }),
      () => new Response('Not Found', { status: 404 }),
    ]) {
      const { fetch } = fakeFetch(answer);
      expect(await getBridgeStatus({ ...request, fetch })).toEqual({ ok: false, failure: { kind: 'not_bridge' } });
    }
  });

  it('says unreachable when nothing answers (or CORS refused it)', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await getBridgeStatus({ ...request, fetch })).toEqual({ ok: false, failure: { kind: 'unreachable' } });
  });

  it('gives up after the time limit, even when fetch ignores the abort', async () => {
    const { fetch } = fakeFetch(() => new Promise<Response>(() => undefined));
    expect(await getBridgeStatus({ ...request, timeoutMs: 20, fetch })).toEqual({ ok: false, failure: { kind: 'timeout' } });
  });

  it('gives up on a body that never ends', async () => {
    const { fetch } = fakeFetch(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    expect(await getBridgeStatus({ ...request, timeoutMs: 20, fetch })).toEqual({ ok: false, failure: { kind: 'timeout' } });
  });
});

describe('parseBridgeStatus', () => {
  it('fills in what an older or newer bridge leaves out, and drops what does not fit', () => {
    expect(parseBridgeStatus({ app: 'cafai-bridge', claude: { found: false }, account: null, usage: null, problems: ['  ', 7, 'Install Claude Code.'] })).toEqual({
      ok: false,
      app: 'cafai-bridge',
      version: '',
      protocol: 0,
      claude: { found: false },
      account: null,
      usage: null,
      runs: { live: 0, max: 0 },
      problems: ['Install Claude Code.'],
    });
    expect(parseBridgeStatus({ ...STATUS, usage: { status: 'allowed', fiveHour: { utilization: 'lots' } }, probe: { ok: false } })).toMatchObject({
      usage: { status: 'allowed' },
      probe: { ok: false, error: 'The test reply failed.' },
    });
    // Claude Code does not always say when a window resets.
    expect(parseBridgeStatus({ ...STATUS, usage: { status: 'allowed', fiveHour: { utilization: 0.5, resetsAt: null } } })?.usage).toEqual({
      status: 'allowed',
      fiveHour: { utilization: 0.5, resetsAt: null },
    });
    expect(parseBridgeStatus(null)).toBeNull();
    expect(parseBridgeStatus({ app: 'crema' })).toBeNull();
  });
});

describe('findBridge', () => {
  it('finds a bridge on this computer by its health route, without a code', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true, app: 'cafai-bridge', version: '0.1.0', protocol: 1 }));
    expect(await findBridge({ fetch })).toBe('127.0.0.1');
    expect(calls[0]?.url).toBe('http://127.0.0.1:8877/health');
    expect(calls[0]?.init?.headers).toEqual({});
  });

  it('finds nothing where nothing, or something else, answers', async () => {
    for (const answer of [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json({ ok: true, app: 'other' }),
      () => json({ app: 'cafai-bridge' }, 500),
      () => new Promise<Response>(() => undefined),
    ]) {
      const { fetch } = fakeFetch(answer);
      expect(await findBridge({ fetch, timeoutMs: 20 })).toBeNull();
    }
  });
});

const parsed = (over: Record<string, unknown> = {}) => parseBridgeStatus({ ...STATUS, ...over }) as BridgeStatus;

describe('bridgeStatusLine', () => {
  it('says connected, with Claude Code, the plan and the 5-hour usage', () => {
    expect(bridgeStatusLine(parsed())).toEqual({
      ok: true,
      text: 'Connected. Claude Code 2.1.251, signed in with Claude Max. 8% of the 5-hour limit used.',
    });
  });

  it('leaves out what the bridge does not know yet', () => {
    expect(bridgeStatusLine(parsed({ usage: null })).text).toBe('Connected. Claude Code 2.1.251, signed in with Claude Max.');
    expect(bridgeStatusLine(parsed({ usage: null, account: null, claude: { found: true } })).text).toBe('Connected. Claude Code.');
    expect(bridgeStatusLine(parsed({ account: { loggedIn: true, subscriptionType: 'pro' } })).text).toMatch(/signed in with Claude Pro\./);
    expect(bridgeStatusLine(parsed({ usage: { status: 'allowed', sevenDay: { utilization: 0.304 } } })).text).toMatch(/30% of the weekly limit used\.$/);
    expect(bridgeStatusLine(parsed({ usage: { status: 'rejected', fiveHour: { utilization: 1 } } })).text).toMatch(
      /Your Claude plan's usage limit is reached for now\.$/,
    );
  });

  it("shows the bridge's problems instead, as they are, and a failed test reply only once", () => {
    const tooOld =
      'Claude Code on your computer is too old for claude-opus-5-5 (it needs 2.1.280 or newer). Run claude update there, or update the Claude desktop app, then try again.';
    // The bridge puts a failed test reply among its problems too.
    expect(bridgeStatusLine(parsed({ problems: [tooOld], probe: { ok: false, error: tooOld } }))).toEqual({ ok: false, text: tooOld });
    const signedOut = 'Claude Code on your computer is not signed in. Open a terminal there, run claude and sign in with /login.';
    expect(bridgeStatusLine(parsed({ problems: [signedOut, tooOld] })).text).toBe(`${signedOut} ${tooOld}`);
    // An older bridge reports a failed test reply only there.
    expect(bridgeStatusLine(parsed({ probe: { ok: false, error: 'Claude Code on your computer did not answer.' } }))).toEqual({
      ok: false,
      text: 'Claude Code on your computer did not answer.',
    });
  });
});

describe('bridgeFailureLine', () => {
  it('names the address it tried, never the code', () => {
    const address = '192.168.1.20:8877';
    expect(bridgeFailureLine({ kind: 'unreachable' }, address)).toBe(
      'Could not reach CafAI Bridge at 192.168.1.20:8877. Check it is running on your computer and that this device is on the same network.',
    );
    expect(bridgeFailureLine({ kind: 'timeout' }, address)).toBe(
      'CafAI Bridge at 192.168.1.20:8877 did not answer in time. Check your computer is awake, then try again.',
    );
    expect(bridgeFailureLine({ kind: 'not_bridge' }, address)).toBe(
      'Something answered at 192.168.1.20:8877, but it is not CafAI Bridge. Check the address.',
    );
    expect(bridgeFailureLine({ kind: 'wrong_code', message: 'No.' }, address)).toBe('No.');
    expect(bridgeFailureLine({ kind: 'locked_out', message: 'Wait.', retryAfterMs: 1000 }, address)).toBe('Wait.');
    expect(bridgeFailureLine({ kind: 'failed', status: 503, message: 'Busy.' }, address)).toBe('Busy.');
  });
});

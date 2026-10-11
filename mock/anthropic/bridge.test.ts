import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOOL_INPUTS } from '../../src/coach/contract.ts';
import { createAnthropicProvider } from '../../src/llm/anthropic.ts';
import { bridgeStatusLine, findBridge, getBridgeStatus } from '../../src/llm/bridgeClient.ts';
import { computerWording } from '../../src/llm/errors.ts';
import { toToolDefinition } from '../../src/llm/schema.ts';
import { LlmError, type LlmRequest, type LlmStreamEvent } from '../../src/llm/types.ts';
import { startCoachOnlyMock, type FetchHost } from '../coachOnly.ts';
import { BRIDGE_MOCK_ORIGIN, bridgeHandlers } from './bridge.ts';
import { anthropicHandlers, resetAnthropicMock } from './handlers.ts';

const server = setupServer(...anthropicHandlers({ speed: Infinity }), ...bridgeHandlers({ speed: Infinity }));
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetAnthropicMock();
});
afterAll(() => server.close());

const INTAKE: LlmRequest = {
  model: 'claude-opus-5-5',
  system: 'You are an espresso coach.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Kiambu AA, light roast, washed' }] }],
  tools: Object.entries(TOOL_INPUTS).map(([name, schema]) => toToolDefinition(name, `The ${name} tool.`, schema)),
};

const coachOn = (code: string) =>
  createAnthropicProvider({
    baseUrl: BRIDGE_MOCK_ORIGIN,
    getApiKey: () => Promise.resolve(code),
    wording: computerWording('127.0.0.1:8877'),
    maxRetries: 0,
  });

async function collect(events: AsyncIterable<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const seen: LlmStreamEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe('bridgeHandlers', () => {
  it('answers /health without a code, saying only what it is', async () => {
    const response = await fetch(`${BRIDGE_MOCK_ORIGIN}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ ok: true, app: 'cafai-bridge', version: '0.1.0', protocol: 1 });
  });

  it('answers /v1/status for any 8-character code, with the probe on the model asked for', async () => {
    const codes: Array<Record<string, string>> = [{ 'x-api-key': 'ABCD-EFGH' }, { 'x-api-key': 'wxyz2345' }, { authorization: 'Bearer abcd-efgh' }];
    for (const headers of codes) {
      const response = await fetch(`${BRIDGE_MOCK_ORIGIN}/v1/status?probe=1&model=claude-sonnet-5`, { headers });
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, app: 'cafai-bridge', problems: [], probe: { ok: true, model: 'claude-sonnet-5' } });
    }
    const plain = await (await fetch(`${BRIDGE_MOCK_ORIGIN}/v1/status`, { headers: { 'x-api-key': 'ABCDEFGH' } })).json();
    expect(plain).not.toHaveProperty('probe');
  });

  it("refuses a missing or wrong-length code with the bridge's 401", async () => {
    const wrong: Array<Record<string, string>> = [{}, { 'x-api-key': 'ABC' }, { 'x-api-key': 'ABCD-EFGH-J' }];
    for (const headers of wrong) {
      const response = await fetch(`${BRIDGE_MOCK_ORIGIN}/v1/status`, { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        type: 'error',
        error: { type: 'authentication_error', message: 'CafAI Bridge did not accept that code. Check the code it shows on your computer.' },
      });
    }
  });

  it('streams the scripted coach from /v1/messages with a code, and refuses one without', async () => {
    const events = await collect(coachOn('ABCDEFGH').stream(INTAKE));
    const done = events.at(-1);
    expect(done?.type === 'message_done' && done.turn.stopReason).toBe('tool_use');

    const error: unknown = await collect(coachOn('ABC').stream(INTAKE)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({
      kind: 'auth',
      message: 'CafAI Bridge did not accept that code. Check the code it shows on your computer.',
    });
  });

  it("is what Settings' Find and Test meet in mock mode", async () => {
    expect(await findBridge()).toBe('127.0.0.1');
    const result = await getBridgeStatus({ baseUrl: BRIDGE_MOCK_ORIGIN, code: 'ABCDEFGH', probe: true, model: 'claude-opus-5-5', timeoutMs: 5000 });
    expect(result.ok && bridgeStatusLine(result.status).text).toBe(
      'Connected. Claude Code 2.1.251, signed in with Claude Max. 8% of the 5-hour limit used.',
    );
  });

  it('answers in the coach-only mock too (npm run dev:sim), where Decaid calls still go out', async () => {
    const network = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('{"from":"network"}')));
    const host: FetchHost = { fetch: network as unknown as typeof fetch };
    const stop = startCoachOnlyMock([...anthropicHandlers({ speed: Infinity }), ...bridgeHandlers({ speed: Infinity })], host);
    try {
      expect(await (await host.fetch(`${BRIDGE_MOCK_ORIGIN}/health`)).json()).toMatchObject({ app: 'cafai-bridge' });
      expect(network).not.toHaveBeenCalled();
      // A real bridge at another address, and Decaid, are the network's.
      await host.fetch('http://192.168.1.20:8877/health');
      await host.fetch('http://localhost:8080/api/v1/devices');
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});

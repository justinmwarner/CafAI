import { describe, expect, it, vi } from 'vitest';
import { TOOL_INPUTS } from '../src/coach/contract.ts';
import { buildAnthropicRequest, createAnthropicProvider } from '../src/llm/anthropic.ts';
import { toToolDefinition } from '../src/llm/schema.ts';
import type { LlmRequest, LlmStreamEvent } from '../src/llm/types.ts';
import { anthropicHandlers } from './anthropic/handlers.ts';
import { createScenarioMemory } from './anthropic/scenario.ts';
import { startCoachOnlyMock, type FetchHost } from './coachOnly.ts';

const KEY = 'sk-ant-sim-placeholder';

const INTAKE: LlmRequest = {
  model: 'claude-opus-5-5',
  system: 'You are an espresso coach.',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Kiambu AA, light roast, washed' },
        { type: 'text', text: '[context]\n{"grinder":{"name":null,"setting":null},"scaleConnected":true}' },
      ],
    },
  ],
  tools: Object.entries(TOOL_INPUTS).map(([name, schema]) => toToolDefinition(name, `The ${name} tool.`, schema)),
};

/** A stand-in for `window`, whose own fetch is the network: the real Decaid, or the real API. */
function page() {
  const network = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response('{"from":"network"}', { headers: { 'content-type': 'application/json' } })),
  );
  const host: FetchHost = { fetch: network as unknown as typeof fetch };
  return { host, network };
}

/** The scripted coach with its own memory, so a test can tell whether it was asked. */
function scriptedCoach() {
  const memory = createScenarioMemory({ session: 'sim' });
  return { memory, handlers: anthropicHandlers({ speed: Infinity, memory }) };
}

describe('startCoachOnlyMock', () => {
  it("answers CafAI's Anthropic calls with the scripted coach, never the network", async () => {
    const { host, network } = page();
    const coach = scriptedCoach();
    startCoachOnlyMock(coach.handlers, host);

    // As in the app, the provider looks the page's fetch up at every call.
    const provider = createAnthropicProvider({
      getApiKey: () => Promise.resolve(KEY),
      fetch: (input: RequestInfo | URL, init?: RequestInit) => host.fetch(input, init),
    });
    const events: LlmStreamEvent[] = [];
    for await (const event of provider.stream(INTAKE)) events.push(event);

    const last = events[events.length - 1];
    expect(last?.type).toBe('message_done');
    expect(last?.type === 'message_done' ? last.turn.id : '').toMatch(/^msg_mock_sim_/);
    expect(coach.memory.counter).toBe(1);
    expect(network).not.toHaveBeenCalled();
  });

  it("sends every Decaid call to the page's own fetch with the caller's arguments", () => {
    const { host, network } = page();
    const coach = scriptedCoach();
    startCoachOnlyMock(coach.handlers, host);
    const answer = Promise.resolve(new Response('{}'));
    network.mockReturnValue(answer);

    const init: RequestInit = { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"context":{"targetYield":36}}' };
    const fromReaHostname = new URL('http://192.168.1.42:8080/api/v1/devices');
    const request = new Request('http://localhost:8080/api/v1/shots/latest');

    // The very promise the page's fetch returned: nothing in between.
    expect(host.fetch('http://localhost:8080/api/v1/workflow', init)).toBe(answer);
    expect(host.fetch(fromReaHostname)).toBe(answer);
    expect(host.fetch(request)).toBe(answer);
    expect(network).toHaveBeenCalledTimes(3);
    expect(network.mock.calls[0]?.[0]).toBe('http://localhost:8080/api/v1/workflow');
    expect(network.mock.calls[0]?.[1]).toBe(init);
    expect(network.mock.calls[1]?.[0]).toBe(fromReaHostname);
    expect(network.mock.calls[2]?.[0]).toBe(request);
    expect(coach.memory.counter).toBe(0);
  });

  it('leaves look-alike hosts and Anthropic routes it does not script to the network', async () => {
    const { host, network } = page();
    const coach = scriptedCoach();
    startCoachOnlyMock(coach.handlers, host);

    const lookAlike = 'https://api.anthropic.com.example.test/v1/messages';
    await host.fetch(lookAlike, { method: 'POST', body: '{}' });
    expect(network.mock.calls[0]?.[0]).toBe(lookAlike);

    const response = await host.fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': KEY } });
    expect(await response.json()).toEqual({ from: 'network' });
    const sent = network.mock.calls[1]?.[0];
    expect(sent).toBeInstanceOf(Request);
    expect((sent as Request).url).toBe('https://api.anthropic.com/v1/models');
    expect((sent as Request).headers.get('x-api-key')).toBe(KEY);
    expect(coach.memory.counter).toBe(0);
  });

  it('rejects a request aborted before it was sent, as fetch does, without asking the coach', async () => {
    const { host, network } = page();
    const coach = scriptedCoach();
    startCoachOnlyMock(coach.handlers, host);
    const controller = new AbortController();
    controller.abort();

    const http = buildAnthropicRequest(INTAKE, KEY);
    const sending = host.fetch(http.url, { method: 'POST', headers: http.headers, body: http.body, signal: controller.signal });
    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    expect(coach.memory.counter).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("changes nothing but the page's fetch, and puts it back on stop", () => {
    const { host, network } = page();
    const webSocket = globalThis.WebSocket;
    const stop = startCoachOnlyMock(scriptedCoach().handlers, host);

    expect(host.fetch).not.toBe(network);
    expect(Object.keys(host)).toEqual(['fetch']);
    expect(globalThis.WebSocket).toBe(webSocket);
    expect('__CAFAI_MOCK__' in globalThis).toBe(false);

    stop();
    expect(host.fetch).toBe(network);
  });
});

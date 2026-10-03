import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anthropicHandlers } from './anthropic/handlers.ts';
import { createMockServer } from './node.ts';

const extra = http.get('http://localhost:5173/app-asset.json', () => HttpResponse.json({ ok: true }));
const mock = createMockServer([...anthropicHandlers(), extra]);

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mock.close());

describe('createMockServer', () => {
  it('serves Decaid on :8080 next to the extra handlers', async () => {
    expect((await fetch('http://localhost:8080/api/v1/info')).status).toBe(200);
    expect(await (await fetch('http://localhost:5173/app-asset.json')).json()).toEqual({ ok: true });
  });

  it('leaves Anthropic to the LLM mock (Decaid patterns require :8080)', async () => {
    // A bare request breaks the protocol on purpose; any Anthropic-style answer
    // proves the request reached anthropicHandlers rather than a Decaid route.
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { type?: string; error?: unknown };
    expect(body.type).toBe('error');
  });

  it('exposes the state, the player and the speed control', () => {
    expect(mock.state.isMachineConnected()).toBe(true);
    mock.setSpeed(25);
    expect(mock.player.speed).toBe(25);
  });
});

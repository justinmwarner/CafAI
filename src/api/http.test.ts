// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/profile.test.ts and gateway.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest, error codes, Decaid's real bodies, retries and deadlines.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeGatewayError, interpretGatewayError, requestJson, type Transport } from './http.ts';
import { GatewayError } from './types.ts';

// ---- gateway error bodies (ported from profile.test.ts) ------------------------

describe('describeGatewayError (ported)', () => {
  it("Decaid's JSON error body is unwrapped into a sentence", () => {
    // Verbatim from a live gateway with no machine paired.
    const body = '{"error":"DeviceNotConnectedException: machine not connected"}';
    const message = describeGatewayError('/api/v1/machine/state', 500, body);

    expect(message).toMatch(/machine is not connected/i);
    expect(message.includes('Exception'), 'an exception class name helps nobody at 6am').toBe(false);
    expect(message.includes('{'), 'and neither does raw JSON').toBe(false);
  });

  it('a non-JSON body is passed through', () => {
    expect(describeGatewayError('/x', 500, 'plain failure')).toBe('plain failure');
  });

  it('an empty body still names what failed', () => {
    const message = describeGatewayError('/api/v1/workflow', 502, '');
    expect(message).toMatch(/\/api\/v1\/workflow/);
    expect(message).toMatch(/502/);
  });
});

describe('interpretGatewayError', () => {
  it('maps the no-scale policy block to plain words and a code', () => {
    const result = interpretGatewayError(
      '/api/v1/machine/state/espresso',
      400,
      '{"details":"No scale detected, blocking espresso request","type":"block_no_scale"}',
    );
    expect(result.code).toBe('block_no_scale');
    expect(result.message).toBe('Connect a scale before pulling a shot (Decaid is set to require one).');
    expect(result.body).toEqual({ details: 'No scale detected, blocking espresso request', type: 'block_no_scale' });
  });

  it('maps the tare-during-shot block', () => {
    const result = interpretGatewayError(
      '/api/v1/scale/tare',
      400,
      '{"details":"Tare blocked: a shot is in progress","type":"block_tare_during_shot"}',
    );
    expect(result.code).toBe('block_tare_during_shot');
    expect(result.message).toBe("The scale can't be tared during a shot.");
  });

  it('maps a missing machine to not_connected', () => {
    const result = interpretGatewayError('/api/v1/machine/info', 500, '{"error":"DeviceNotConnectedException: machine not connected"}');
    expect(result.code).toBe('not_connected');
    expect(result.message).toBe('The machine is not connected. Wake the DE1 and check it is paired with Decaid.');
  });

  it('tells a missing scale apart from a missing machine', () => {
    const tare = interpretGatewayError('/api/v1/scale/tare', 500, '{"error":"DeviceNotConnectedException: scale not connected"}');
    expect(tare.code).toBe('not_connected');
    expect(tare.message).toMatch(/^The scale is not connected/);
    const info = interpretGatewayError('/api/v1/scale/info', 503, '{"error":"No scale connected"}');
    expect(info.code).toBe('not_connected');
    expect(info.message).toMatch(/^The scale is not connected/);
  });

  it('prefers message, then details, then error, without Dart exception prefixes', () => {
    expect(
      interpretGatewayError('/api/v1/workflow', 400, '{"error":"Invalid request","message":"FormatException: Field \\"targetYield\\" cannot be null"}')
        .message,
    ).toBe('Field "targetYield" cannot be null');
    expect(
      interpretGatewayError(
        '/api/v1/profiles',
        400,
        '{"error":"Invalid request","message":"Invalid argument(s): Profile must have \\"tank_temperature\\""}',
      ).message,
    ).toBe('Profile must have "tank_temperature"');
    expect(interpretGatewayError('/x', 400, '{"details":"Something specific","error":"Generic"}').message).toBe('Something specific');
    expect(interpretGatewayError('/api/v1/shots/x', 404, '{"error":"Shot not found"}')).toMatchObject({
      message: 'Shot not found',
      code: 'http',
    });
  });

  it('keeps only the first line of a long Dart message', () => {
    const body = JSON.stringify({ error: 'Internal server error', message: "TypeError: Null check operator\n#0 Profile._parse\n#1 ..." });
    expect(interpretGatewayError('/api/v1/profiles', 500, body).message).toBe('Null check operator');
  });

  it('says Decaid is busy for admission-control rejections', () => {
    expect(interpretGatewayError('/x', 429, '{"error":"client_admission_limit"}').message).toBe('Decaid is busy. Try again in a moment.');
    expect(interpretGatewayError('/x', 503, '{"error":"global_admission_limit"}').message).toBe('Decaid is busy. Try again in a moment.');
  });

  it("tolerates shelf's plain-text 404 and 500 bodies", () => {
    expect(interpretGatewayError('/api/v1/nope', 404, 'Route not found')).toMatchObject({
      message: 'Route not found',
      code: 'http',
      body: { error: 'Route not found' },
    });
    expect(interpretGatewayError('/api/v1/store/cafai/x', 500, 'Internal Server Error').message).toBe('Internal Server Error');
  });

  it('ignores an HTML error page', () => {
    const result = interpretGatewayError('/api/v1/workflow', 502, '<html><body>Bad gateway</body></html>');
    expect(result.message).toMatch(/502/);
    expect(result.message).not.toMatch(/</);
  });
});

// ---- transport -------------------------------------------------------------------

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function stubTransport(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, timeoutMs = 8000) {
  const seen: Seen[] = [];
  const transport: Transport = {
    origin: 'http://localhost:8080',
    timeoutMs,
    fetch: ((url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve(handler(url, init));
    }) as unknown as typeof fetch,
  };
  return { transport, seen };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('requestJson', () => {
  it('sends no headers on a GET and parses JSON', async () => {
    const { transport, seen } = stubTransport(() => new Response('{"a":1}'));
    expect(await requestJson(transport, '/api/v1/workflow')).toEqual({ a: 1 });
    expect(seen[0]!.url).toBe('http://localhost:8080/api/v1/workflow');
    expect(seen[0]!.init?.method).toBe('GET');
    expect(seen[0]!.init?.headers).toBeUndefined();
  });

  it('adds Content-Type only when there is a body', async () => {
    const { transport, seen } = stubTransport(() => new Response('null'));
    await requestJson(transport, '/api/v1/workflow', { method: 'PUT', body: { context: { targetYield: 36 } } });
    await requestJson(transport, '/api/v1/machine/state/idle', { method: 'PUT' });
    expect(seen[0]!.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(seen[0]!.init?.body).toBe('{"context":{"targetYield":36}}');
    expect(seen[1]!.init?.headers).toBeUndefined();
    expect(seen[1]!.init?.body).toBeUndefined();
  });

  it('reads a literal null and an empty 200 body as null', async () => {
    const nullBody = stubTransport(() => new Response('null'));
    expect(await requestJson(nullBody.transport, '/api/v1/scale/tare', { method: 'PUT' })).toBeNull();
    const empty = stubTransport(() => new Response(''));
    expect(await requestJson(empty.transport, '/api/v1/scale/tare', { method: 'PUT' })).toBeNull();
    const noContent = stubTransport(() => new Response(null, { status: 204 }));
    expect(await requestJson(noContent.transport, '/api/v1/store/cafai/x', { method: 'POST', body: 1 })).toBeNull();
  });

  it('an error body is surfaced instead of a bare status code (ported)', async () => {
    const { transport } = stubTransport(() => new Response('machine is asleep', { status: 503 }));
    const error = await requestJson(transport, '/api/v1/workflow', { method: 'PUT', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 503, path: '/api/v1/workflow', code: 'http' });
    expect((error as GatewayError).message).toMatch(/asleep/);
  });

  it('a 200 that is not JSON is an error, not a crash', async () => {
    const { transport } = stubTransport(() => new Response('<html>'));
    await expect(requestJson(transport, '/api/v1/info')).rejects.toMatchObject({ code: 'http', status: 200 });
  });

  it('a gateway that accepts and never answers times out (ported)', async () => {
    const transport: Transport = {
      origin: 'http://localhost:8080',
      timeoutMs: 20,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
    };
    const error = await requestJson(transport, '/api/v1/workflow').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 0, code: 'timeout' });
    expect((error as Error).message).toMatch(/did not answer/);
  });

  it('an unreachable gateway is a clear message, not a raw TypeError (ported)', async () => {
    const transport: Transport = {
      origin: 'http://localhost:8080',
      timeoutMs: 8000,
      fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch,
    };
    const error = await requestJson(transport, '/api/v1/workflow').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 0, code: 'network' });
    // "This device": a phone on the network reaches Decaid the same way.
    expect((error as Error).message).toBe('Could not reach Decaid. Check that it is running and that this device is on the same network.');
  });

  it('retries a GET once on 503 after Retry-After', async () => {
    let calls = 0;
    const { transport } = stubTransport(() => {
      calls += 1;
      return calls === 1
        ? new Response('{"error":"global_admission_limit"}', { status: 503, headers: { 'Retry-After': '0' } })
        : new Response('{"ok":true}');
    });
    expect(await requestJson(transport, '/api/v1/shots')).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('waits one second by default before the retry', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { transport } = stubTransport(() => {
      calls += 1;
      return calls === 1 ? new Response('{"error":"client_admission_limit"}', { status: 429 }) : new Response('[]');
    });
    const pending = requestJson(transport, '/api/v1/profiles');
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual([]);
    expect(calls).toBe(2);
  });

  it('gives up after one retry', async () => {
    let calls = 0;
    const { transport } = stubTransport(() => {
      calls += 1;
      return new Response('{"error":"client_admission_limit"}', { status: 429, headers: { 'Retry-After': '0' } });
    });
    await expect(requestJson(transport, '/api/v1/shots')).rejects.toMatchObject({ status: 429, message: 'Decaid is busy. Try again in a moment.' });
    expect(calls).toBe(2);
  });

  it('never retries a state change', async () => {
    let calls = 0;
    const { transport } = stubTransport(() => {
      calls += 1;
      return new Response('{"error":"Machine write queue is full"}', { status: 503, headers: { 'Retry-After': '0' } });
    });
    await expect(requestJson(transport, '/api/v1/machine/state/espresso', { method: 'PUT' })).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });

  it('passes If-None-Match and keepalive through when asked', async () => {
    const { transport, seen } = stubTransport((_url, init) =>
      init?.method === 'GET' ? new Response(null, { status: 304 }) : new Response('{}'),
    );
    await requestJson(transport, '/api/v1/store/cafai?full=1', { headers: { 'If-None-Match': '"abc"' }, allowStatus: [304] });
    expect(seen[0]!.init?.headers).toEqual({ 'If-None-Match': '"abc"' });
    await requestJson(transport, '/api/v1/store/cafai/k', { method: 'POST', body: 1, keepalive: true });
    expect(seen[1]!.init?.keepalive).toBe(true);
  });
});

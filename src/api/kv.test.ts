import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../../mock/node.ts';
import { createKvClient } from './kv.ts';
import { GatewayError } from './types.ts';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { kv: createKvClient('http://gw:8080', fetchImpl), seen };
}

describe('KV client wire behaviour', () => {
  it('uses namespace and key raw in the path', async () => {
    const { kv, seen } = stub(() => new Response('null'));
    await kv.get('cafai', 'conv.bag_1-a');
    expect(seen[0]!.url).toBe('http://gw:8080/api/v1/store/cafai/conv.bag_1-a');
  });

  it('refuses a key Decaid would store differently from what CafAI asked for', async () => {
    const { kv, seen } = stub(() => new Response('null'));
    for (const key of ['a/b', 'a b', 'a%2Fb', 'a?b', '']) {
      await expect(kv.get('cafai', key), key).rejects.toBeInstanceOf(GatewayError);
    }
    await expect(kv.list('ca/fai')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(seen).toHaveLength(0);
  });

  it('treats a 404 as missing too (the spec form)', async () => {
    const { kv } = stub(() => new Response('not found', { status: 404 }));
    expect(await kv.get('cafai', 'k')).toBeNull();
    await expect(kv.delete('cafai', 'k')).resolves.toBeUndefined();
  });

  it('accepts any 2xx on write and sends small bodies with keepalive', async () => {
    const { kv, seen } = stub(() => new Response(null, { status: 204 }));
    await kv.set('cafai', 'settings', { model: 'claude-opus-5-5' });
    expect(seen[0]!.init).toMatchObject({
      method: 'POST',
      body: '{"model":"claude-opus-5-5"}',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('sends a body of 60 KiB or more without keepalive (Chromium rejects it)', async () => {
    const { kv, seen } = stub(() => new Response('{}'));
    await kv.set('cafai', 'conv.big', 'x'.repeat(61 * 1024));
    expect(seen[0]!.init?.keepalive).toBeUndefined();
  });

  it('deletes instead of storing null, which Decaid would keep as the string "null"', async () => {
    const { kv, seen } = stub(() => new Response('{}'));
    await kv.set('cafai', 'gone', null);
    expect(seen[0]!.init?.method).toBe('DELETE');
  });

  it('getAll sends If-None-Match and reports 304 as not modified', async () => {
    const { kv, seen } = stub((_url, init) => {
      const tag = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
      return tag === '"abc"' ? new Response(null, { status: 304 }) : new Response('{"a":1}', { headers: { ETag: '"abc"' } });
    });
    expect(await kv.getAll('cafai')).toEqual({ notModified: false, data: { a: 1 }, etag: '"abc"' });
    expect(seen[0]!.url).toBe('http://gw:8080/api/v1/store/cafai?full=1');
    expect(seen[0]!.init?.headers).toBeUndefined();
    expect(await kv.getAll('cafai', '"abc"')).toEqual({ notModified: true });
  });

  it('a non-array list or non-object namespace reads as empty', async () => {
    const { kv } = stub(() => new Response('null'));
    expect(await kv.list('cafai')).toEqual([]);
    expect(await kv.getAll('cafai')).toEqual({ notModified: false, data: {}, etag: null });
  });

  it('a failed write throws a GatewayError', async () => {
    const { kv } = stub(() => new Response('{"error":"Request body is too large"}', { status: 413 }));
    await expect(kv.set('cafai', 'k', 1)).rejects.toMatchObject({ status: 413, message: 'Request body is too large' });
  });
});

describe('KV client against the mock Decaid', () => {
  const mock = createMockServer();
  const kv = createKvClient('http://localhost:8080');
  beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => mock.close());

  it('round-trips values of any JSON type', async () => {
    for (const [key, value] of [
      ['obj', { a: [1, 2], b: null }],
      ['arr', [1, 'two']],
      ['str', 'text'],
      ['num', 42.5],
      ['yes', true],
    ] as const) {
      await kv.set('cafai', key, value);
      expect(await kv.get('cafai', key), key).toEqual(value);
    }
    expect((await kv.list('cafai')).sort()).toEqual(['arr', 'num', 'obj', 'str', 'yes']);
  });

  it('a missing key is null, and the whole namespace comes with an ETag', async () => {
    expect(await kv.get('cafai', 'never')).toBeNull();
    const first = await kv.getAll('cafai');
    expect(first.notModified).toBe(false);
    if (first.notModified) return;
    expect(first.data).toMatchObject({ num: 42.5 });
    expect(first.etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(await kv.getAll('cafai', first.etag)).toEqual({ notModified: true });
    await kv.set('cafai', 'num', 43);
    expect((await kv.getAll('cafai', first.etag)).notModified).toBe(false);
  });

  it('delete is idempotent', async () => {
    await kv.delete('cafai', 'obj');
    await kv.delete('cafai', 'obj');
    expect(await kv.get('cafai', 'obj')).toBeNull();
  });
});

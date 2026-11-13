import { describe, expect, it } from 'vitest';
import { describeFetches, watchFetch } from './watch.ts';

describe('watchFetch', () => {
  it("lists a request while it waits, without a beacon's code, and drops it once it is answered", async () => {
    let answer: (response: Response) => void = () => {};
    const scope = { fetch: (() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch };
    let now = 5_000;
    const watch = watchFetch(scope, { now: () => now });
    const waiting = scope.fetch('http://192.168.1.90:8877/v1/debug/report?code=ABCDEFGH&x=1', { method: 'post' });
    now = 5_400;
    expect(watch.inFlight()).toEqual([
      { id: 1, method: 'POST', url: 'http://192.168.1.90:8877/v1/debug/report?code=…&x=1', startedAt: new Date(5_000).toISOString(), ageMs: 400 },
    ]);
    expect(describeFetches(watch.inFlight())).toBe('POST http://192.168.1.90:8877/v1/debug/report?code=…&x=1 400 ms');
    answer(new Response('{}'));
    await waiting;
    await Promise.resolve();
    expect(watch.inFlight()).toEqual([]);
    expect(describeFetches([])).toBe('no request waiting');
    watch.stop();
  });

  it('drops a request that failed too, and puts fetch back when it stops', async () => {
    const original = (() => Promise.reject(new TypeError('Load failed'))) as typeof fetch;
    const scope = { fetch: original };
    const watch = watchFetch(scope);
    await expect(scope.fetch('http://localhost:8080/api/v1/workflow')).rejects.toThrow('Load failed');
    await Promise.resolve();
    expect(watch.inFlight()).toEqual([]);
    watch.stop();
    expect(scope.fetch).toBe(original);
  });
});

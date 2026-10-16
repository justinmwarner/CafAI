import { describe, expect, it, vi } from 'vitest';
import { GatewayError, type ShotRecord } from '../../api/types.ts';
import { syntheticShotRecord } from '../../coach/__fixtures__/syntheticShot.ts';
import { comparisonShotsFor, createComparisonShots, MAX_SHOTS, RETRY_AFTER_MS } from './comparisonShots.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const notFound = () => new GatewayError(404, '/api/v1/shots/s-1', 'Shot not found');

describe('shots read from Decaid to draw under another (D181)', () => {
  it('reads a shot once, summarised, and keeps it', async () => {
    const getShot = vi.fn(async (id: string) => syntheticShotRecord({ id }));
    const shots = createComparisonShots({ getShot });
    expect(shots.peek('s-1')).toBeUndefined();
    const summary = await shots.load('s-1');
    expect(summary?.shotId).toBe('s-1');
    expect(summary?.series.tS.length).toBeGreaterThan(10);
    expect(shots.peek('s-1')).toBe(summary);
    await shots.load('s-1');
    expect(getShot).toHaveBeenCalledTimes(1);
  });

  it('shares one request between callers while it is on its way, and tells listeners when it lands', async () => {
    const reply = deferred<ShotRecord>();
    const getShot = vi.fn(() => reply.promise);
    const shots = createComparisonShots({ getShot });
    const listener = vi.fn();
    shots.subscribe(listener);
    const first = shots.load('s-1');
    const second = shots.load('s-1');
    expect(getShot).toHaveBeenCalledTimes(1);
    expect(shots.peek('s-1')).toBeUndefined();
    reply.resolve(syntheticShotRecord({ id: 's-1' }));
    expect((await first)?.shotId).toBe('s-1');
    expect(await second).toBe(await first);
    expect(listener).toHaveBeenCalled();
  });

  it('keeps a shot Decaid no longer has (404) as none, and never asks again', async () => {
    const getShot = vi.fn(() => Promise.reject(notFound()));
    const now = vi.fn(() => 0);
    const shots = createComparisonShots({ getShot }, { now });
    expect(await shots.load('s-1')).toBeNull();
    expect(shots.peek('s-1')).toBeNull();
    now.mockReturnValue(10 * RETRY_AFTER_MS);
    expect(await shots.load('s-1')).toBeNull();
    expect(getShot).toHaveBeenCalledTimes(1);
  });

  it('draws nothing after any other failure, and asks again only once the wait is over and something wants it', async () => {
    const getShot = vi.fn<(id: string) => Promise<ShotRecord>>(() => Promise.reject(new GatewayError(0, '/api/v1/shots/s-1', 'Could not reach Decaid.', 'network')));
    let clock = 1_000;
    const shots = createComparisonShots({ getShot }, { now: () => clock });
    expect(await shots.load('s-1')).toBeNull();
    expect(shots.peek('s-1')).toBeNull();
    clock += RETRY_AFTER_MS - 1;
    expect(await shots.load('s-1')).toBeNull();
    expect(getShot).toHaveBeenCalledTimes(1);
    clock += 1;
    getShot.mockImplementation(async (id: string) => syntheticShotRecord({ id }));
    expect((await shots.load('s-1'))?.shotId).toBe('s-1');
    expect(getShot).toHaveBeenCalledTimes(2);
  });

  it('treats a record it cannot summarise, or one with no curve, as nothing to draw', async () => {
    const broken = { ...syntheticShotRecord({ id: 's-1' }), measurements: null } as unknown as ShotRecord;
    const empty = { ...syntheticShotRecord({ id: 's-2' }), measurements: [] };
    const shots = createComparisonShots({ getShot: async (id) => (id === 's-1' ? broken : empty) });
    expect(await shots.load('s-1')).toBeNull();
    expect(await shots.load('s-2')).toBeNull();
    expect(shots.peek('s-2')).toBeNull();
  });

  it('settles even when the client throws before answering', async () => {
    const shots = createComparisonShots({
      getShot: () => {
        throw notFound();
      },
    });
    expect(await shots.load('s-1')).toBeNull();
    expect(shots.peek('s-1')).toBeNull();
  });

  it(`keeps at most ${MAX_SHOTS} shots, the oldest read going first`, async () => {
    const getShot = vi.fn(async (id: string) => syntheticShotRecord({ id }));
    const shots = createComparisonShots({ getShot });
    for (let i = 0; i <= MAX_SHOTS; i += 1) await shots.load(`s-${i}`);
    expect(shots.peek('s-0')).toBeUndefined();
    expect(shots.peek(`s-${MAX_SHOTS}`)?.shotId).toBe(`s-${MAX_SHOTS}`);
    await shots.load('s-0');
    expect(getShot).toHaveBeenCalledTimes(MAX_SHOTS + 2);
  });

  it('is one cache per Decaid client for the session', () => {
    const client = { getShot: async (id: string) => syntheticShotRecord({ id }) };
    expect(comparisonShotsFor(client)).toBe(comparisonShotsFor(client));
    expect(comparisonShotsFor(client)).not.toBe(comparisonShotsFor({ getShot: client.getShot }));
  });
});

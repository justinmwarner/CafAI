import { describe, expect, it, vi } from 'vitest';
import { createHeartbeat } from './heartbeat.ts';
import type { HeartbeatResponse } from './types.ts';

function setup(minIntervalMs?: number) {
  let time = 1_000_000;
  const pending: Array<{ resolve: (value: HeartbeatResponse) => void; reject: (error: Error) => void }> = [];
  const client = {
    heartbeat: vi.fn(
      () =>
        new Promise<HeartbeatResponse>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    ),
  };
  const heartbeat = createHeartbeat(client, { minIntervalMs, now: () => time });
  return {
    heartbeat,
    client,
    pending,
    advance: (ms: number) => (time += ms),
    settle: async () => {
      for (const request of pending.splice(0)) request.resolve({ timeout: 1800 });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('createHeartbeat', () => {
  it('sends at once, then at most once per 15 s by default', async () => {
    const t = setup();
    t.heartbeat.notify();
    expect(t.client.heartbeat).toHaveBeenCalledTimes(1);
    await t.settle();
    t.advance(14_999);
    t.heartbeat.notify();
    expect(t.client.heartbeat).toHaveBeenCalledTimes(1);
    t.advance(1);
    t.heartbeat.notify();
    expect(t.client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('keeps at most one request in flight', async () => {
    const t = setup(1000);
    t.heartbeat.notify();
    t.advance(5000);
    t.heartbeat.notify();
    expect(t.client.heartbeat, 'the first is still pending').toHaveBeenCalledTimes(1);
    await t.settle();
    t.heartbeat.notify();
    expect(t.client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('swallows errors and keeps throttling after one', async () => {
    const t = setup(1000);
    t.heartbeat.notify();
    t.pending.shift()!.reject(new Error('machine not connected'));
    await Promise.resolve();
    await Promise.resolve();
    t.heartbeat.notify();
    expect(t.client.heartbeat, 'a failure still counts toward the interval').toHaveBeenCalledTimes(1);
    t.advance(1000);
    t.heartbeat.notify();
    expect(t.client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('survives a client that throws synchronously', () => {
    const heartbeat = createHeartbeat(
      {
        heartbeat: () => {
          throw new Error('boom');
        },
      },
      { now: () => 0 },
    );
    expect(() => heartbeat.notify()).not.toThrow();
  });
});

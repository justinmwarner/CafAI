/**
 * User-presence heartbeat (POST /api/v1/machine/heartbeat).
 *
 * Decaid restarts its auto-sleep timer on every heartbeat, so CafAI sends one
 * on real user input, throttled client-side (DECISIONS D15: one per 15 s;
 * Decaid itself throttles the DE1 write to one per 5 s). Failures are
 * swallowed: presence is a nicety, never worth an error on screen.
 */
import type { DecaidClient, Heartbeat } from './types.ts';

export interface HeartbeatOptions {
  /** Minimum gap between heartbeats (default 15 000 ms). */
  minIntervalMs?: number;
  now?: () => number;
}

export function createHeartbeat(client: Pick<DecaidClient, 'heartbeat'>, options: HeartbeatOptions = {}): Heartbeat {
  const minIntervalMs = options.minIntervalMs ?? 15_000;
  const now = options.now ?? (() => Date.now());
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  return {
    notify() {
      const time = now();
      if (inFlight || time - lastSentAt < minIntervalMs) return;
      lastSentAt = time;
      inFlight = true;
      const done = () => {
        inFlight = false;
      };
      try {
        client.heartbeat().then(done, done);
      } catch {
        done();
      }
    },
  };
}

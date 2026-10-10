import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../../mock/node.ts';
import { createDecaidClient } from './client.ts';
import { createTelemetryStore } from './telemetry.ts';
import { parseDecaidTimestamp } from './time.ts';
import type { LiveSample, ShotLifecycleEvent } from './types.ts';

const mock = createMockServer([], { speed: 200 });
const client = createDecaidClient({ origin: 'http://localhost:8080' });

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mock.close());

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('telemetry against the mock Decaid', () => {
  it('connects, follows a whole shot and lines up with the persisted record', async () => {
    const store = createTelemetryStore({ client, wsOrigin: client.wsOrigin, visibility: null });
    const shots: ShotLifecycleEvent[] = [];
    const samples: LiveSample[] = [];
    store.onShot((event) => shots.push(event));
    store.onSample((sample) => samples.push(sample));
    store.start();
    try {
      await waitFor(() => {
        const state = store.getState();
        return state.machineConnected && state.shotState !== null && Object.values(state.sockets).every((s) => s === 'open');
      });
      expect(store.getState()).toMatchObject({ scaleConnected: true, machine: { state: { state: 'idle' } } });
      expect(mock.state.socketCount('machine')).toBe(1);

      await client.setMachineState('espresso');
      await waitFor(() => shots.some((event) => event.type === 'finished'));
      const shotId = mock.player.lastShotId;
      expect(shots).toEqual([
        { type: 'started', shotId },
        { type: 'finished', shotId, stopReason: 'targetWeight' },
      ]);

      const record = await client.getShot(shotId!);
      expect(samples[0]!.tS).toBe(0);
      expect(samples[0]!.machine.timestamp).toBe(record.measurements[0]!.machine.timestamp);
      for (let i = 1; i < samples.length; i += 1) expect(samples[i]!.tS).toBeGreaterThan(samples[i - 1]!.tS);
      expect(samples.length).toBeGreaterThan(record.measurements.length);
      const lastRecorded = record.measurements.at(-1)!;
      const elapsed = (parseDecaidTimestamp(lastRecorded.machine.timestamp) - parseDecaidTimestamp(record.measurements[0]!.machine.timestamp)) / 1000;
      expect(samples.find((s) => s.machine.timestamp === lastRecorded.machine.timestamp)!.tS).toBeCloseTo(elapsed, 6);
      expect(samples.some((s) => (s.scale?.weight ?? 0) > 30)).toBe(true);
      expect(store.getState().shotState).toMatchObject({ state: 'idle', shotId: null });
    } finally {
      store.stop();
    }
  });

  it('follows the machine dropping off and coming back through ws/v1/devices', async () => {
    const store = createTelemetryStore({ client, wsOrigin: client.wsOrigin, visibility: null });
    store.start();
    try {
      await waitFor(() => store.getState().machineConnected);
      mock.state.setMachineConnected(false);
      await waitFor(() => !store.getState().machineConnected);
      expect(store.getState().connectionError).toMatchObject({ kind: 'machineDisconnected' });
      expect(store.getState().sockets.machine, 'the machine socket stays open').toBe('open');
      mock.state.setMachineConnected(true);
      await waitFor(() => store.getState().machineConnected);
      expect(store.getState().connectionError).toBeNull();
    } finally {
      store.stop();
    }
  });

  it("keeps time-to-ready's estimate after a wake, while watched (6.3)", async () => {
    const store = createTelemetryStore({ client, wsOrigin: client.wsOrigin, visibility: null });
    store.start();
    store.watchTimeToReady(true);
    try {
      await waitFor(() => store.getState().machineConnected);
      await client.setMachineState('sleeping');
      await client.setMachineState('idle');
      // The mock counts down from two and a half minutes after its insufficient_data frames.
      await waitFor(() => (store.getState().timeToReady ?? 0) > 0);
      expect(store.getState().timeToReady).toBeLessThanOrEqual(150_000);
      store.watchTimeToReady(false);
      expect(store.getState().timeToReady).toBeNull();
    } finally {
      store.stop();
    }
  });

  it('reconnects after the mock drops every socket', async () => {
    const store = createTelemetryStore({ client, wsOrigin: client.wsOrigin, visibility: null });
    store.start();
    try {
      await waitFor(() => Object.values(store.getState().sockets).every((s) => s === 'open'));
      mock.state.dropSockets();
      await waitFor(() => store.getState().sockets.devices === 'closed');
      await waitFor(() => Object.values(store.getState().sockets).every((s) => s === 'open'), 4000);
      expect(mock.state.socketCount('devices')).toBe(1);
    } finally {
      store.stop();
    }
  });
});

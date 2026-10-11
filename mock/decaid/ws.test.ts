import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockServer } from '../node.ts';

const mock = createMockServer();
const WS = 'ws://tablet.local:8080/ws/v1';

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mock.close());

function open(path: string) {
  const socket = new WebSocket(`${WS}${path}`);
  const frames: unknown[] = [];
  const waiters: Array<() => void> = [];
  socket.addEventListener('message', (event) => {
    frames.push(JSON.parse(String(event.data)));
    for (const wake of waiters.splice(0)) wake();
  });
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve()));
  async function waitFor(count: number) {
    const deadline = Date.now() + 2000;
    while (frames.length < count) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} frames on ${path}, got ${frames.length}`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return frames;
  }
  return { socket, frames, waitFor, closed };
}

describe('Decaid WebSocket channels', () => {
  it('replays the latest state on connect', async () => {
    const devices = open('/devices');
    const shotState = open('/machine/shotState');
    const scale = open('/scale/snapshot');
    const machine = open('/machine/snapshot');
    const water = open('/machine/waterLevels');
    const settings = open('/machine/shotSettings');

    expect((await devices.waitFor(1))[0]).toMatchObject({ devices: expect.any(Array), connectionStatus: { phase: 'ready' } });
    expect((await shotState.waitFor(1))[0]).toMatchObject({ event: 'state', state: 'idle', shotId: null });
    expect((await scale.waitFor(1))[0]).toEqual({ status: 'connected' });
    expect((await machine.waitFor(1))[0]).toMatchObject({ state: { state: 'idle', substate: 'idle' } });
    expect((await water.waitFor(1))[0]).toMatchObject({ currentLevel: expect.any(Number), refillLevel: expect.any(Number) });
    expect((await settings.waitFor(1))[0]).toMatchObject({ targetSteamTemp: 150 });
    expect(mock.state.socketCount('devices')).toBe(1);

    for (const handle of [devices, shotState, scale, machine, water, settings]) handle.socket.close();
    await Promise.all([devices, shotState, scale, machine, water, settings].map((handle) => handle.closed));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mock.state.socketCount('devices')).toBe(0);
  });

  it('pushes state changes and keeps machine sockets silent while the machine is away', async () => {
    const devices = open('/devices');
    const machine = open('/machine/snapshot');
    await devices.waitFor(1);
    await machine.waitFor(1);

    mock.state.setMachineConnected(false);
    const frames = await devices.waitFor(2);
    expect((frames[1] as { devices: Array<{ type: string; state: string }> }).devices.find((d) => d.type === 'machine')!.state).toBe(
      'disconnected',
    );
    mock.state.setMachineSnapshot({ ...mock.state.getMachineSnapshot(), pressure: 3 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(machine.frames).toHaveLength(1);

    mock.state.setMachineConnected(true);
    await machine.waitFor(2);
    devices.socket.close();
    machine.socket.close();
  });

  it('streams a whole shot: machine frames, weights and shot states', async () => {
    const machine = open('/machine/snapshot');
    const scale = open('/scale/snapshot');
    const shotState = open('/machine/shotState');
    await Promise.all([machine.waitFor(1), scale.waitFor(1), shotState.waitFor(1)]);

    mock.setSpeed(500);
    expect(mock.player.start()).toBe(true);
    await mock.player.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const states = (shotState.frames as Array<{ event: string; state: string }>).filter((f) => f.event === 'state').map((f) => f.state);
    expect(states).toEqual(['idle', 'preheating', 'pouring', 'stopping', 'finished', 'idle']);
    expect(machine.frames.length).toBeGreaterThan(100);
    expect((scale.frames as Array<{ weight?: number }>).some((f) => (f.weight ?? 0) > 30)).toBe(true);
    expect(mock.state.getLatestShot()!.id).toBe(mock.player.lastShotId);
    for (const handle of [machine, scale, shotState]) handle.socket.close();
  });

  it('dropSockets closes the sockets, as a network blip would', async () => {
    const devices = open('/devices');
    await devices.waitFor(1);
    mock.state.dropSockets('devices');
    await devices.closed;
    expect(mock.state.socketCount('devices')).toBe(0);
  });

  it('answers devices commands', async () => {
    const devices = open('/devices');
    await devices.waitFor(1);
    devices.socket.send(JSON.stringify({ command: 'connect', deviceId: 'CF:3A:91:0B:7E:12' }));
    const frames = await devices.waitFor(2);
    expect(frames[1]).toMatchObject({ deviceId: 'CF:3A:91:0B:7E:12', operation: 'connect', outcome: 'alreadyConnected' });
    devices.socket.close();
  });

  it('time-to-ready: no replay while asleep; waking restarts from insufficient_data (D5)', async () => {
    // The ticker free-runs for the player's whole life, so put the machine to sleep first:
    // that is a deterministic "nothing to emit" state, unlike a short wait at high speed
    // (set by an earlier test and never reset), which the ticker could still race.
    mock.setSpeed(500);
    mock.player.command('sleeping');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const ttr = open('/plugins/time-to-ready.reaplugin/timeToReady');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ttr.frames).toHaveLength(0);

    mock.player.command('idle');
    const frames = (await ttr.waitFor(1)) as Array<{ status: string; remainingTimeMs: number | null }>;
    expect(frames[0]).toEqual({ status: 'insufficient_data', remainingTimeMs: null });
    ttr.socket.close();
  });

  it('a wake reports idle/preparingForShot on the machine channel too, until the countdown reaches reached (D103 follow-up)', async () => {
    mock.setSpeed(500);
    mock.player.command('sleeping');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const machine = open('/machine/snapshot');
    await machine.waitFor(1); // the replayed sleeping snapshot
    mock.player.command('idle');
    const frames = (await machine.waitFor(2)) as Array<{ state: { state: string; substate: string } }>;
    expect(frames[1]!.state).toEqual({ state: 'idle', substate: 'preparingForShot' });
    // The countdown's 32 ticks run on real timers; under a loaded test run they can
    // take far longer than their sped-up 64 ms, so wait for the outcome, not a fixed time.
    await vi.waitFor(() => expect(machine.frames.at(-1)).toMatchObject({ state: { state: 'idle', substate: 'idle' } }), {
      timeout: 5000,
      interval: 20,
    });
    machine.socket.close();
  });
});

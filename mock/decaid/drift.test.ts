import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { driftLog } from '../../src/api/drift.ts';
import { parseMachineFrame } from '../../src/api/frames.ts';
import { fixtures } from '../fixtures/index.ts';
import { createMockServer } from '../node.ts';
import { DRIFT_RENAMED_READING, sentMachineFrame } from './drift.ts';

const mock = createMockServer([], { renamedReading: DRIFT_RENAMED_READING });
const BASE = 'http://tablet.local:8080';

beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => mock.close());

/** The machine socket's frames as they arrive, parsed. */
function openMachineSocket() {
  const socket = new WebSocket(`${BASE.replace('http', 'ws')}/ws/v1/machine/snapshot`);
  const frames: Array<Record<string, unknown>> = [];
  socket.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data)) as Record<string, unknown>));
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve()));
  async function waitFor(count: number) {
    await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(count), { timeout: 2000 });
    return frames;
  }
  return { socket, frames, waitFor, closed };
}

describe('sentMachineFrame', () => {
  it('sends a frame as it is without a rename', () => {
    const frame = fixtures.machineState();
    const sent = sentMachineFrame(frame, null);
    expect(sent).toEqual(frame);
    expect(sent).not.toBe(frame);
  });

  it('sends the renamed reading under its new name, in its place, and nothing else changes', () => {
    const frame = fixtures.machineState();
    const sent = sentMachineFrame(frame, DRIFT_RENAMED_READING);
    expect(sent).not.toHaveProperty('groupTemperature');
    expect(sent.groupTemp).toBe(frame.groupTemperature);
    expect(Object.keys(sent)).toEqual(Object.keys(frame).map((key) => (key === 'groupTemperature' ? 'groupTemp' : key)));
    expect(frame).toHaveProperty('groupTemperature');
  });
});

describe('?mockDrift=1: a Decaid that renamed groupTemperature', () => {
  it('sends machine frames with groupTemp on the socket, its replay included, and from GET /machine/state', async () => {
    const machine = openMachineSocket();
    const [replayed] = await machine.waitFor(1);
    expect(replayed).toHaveProperty('groupTemp');
    expect(replayed).not.toHaveProperty('groupTemperature');

    mock.state.setMachineSnapshot({ ...mock.state.getMachineSnapshot(), groupTemperature: 91.5 });
    const frames = await machine.waitFor(2);
    expect(frames[1]).toMatchObject({ groupTemp: 91.5 });
    expect(frames[1]).not.toHaveProperty('groupTemperature');

    const reply = (await (await fetch(`${BASE}/api/v1/machine/state`)).json()) as Record<string, unknown>;
    expect(reply).toMatchObject({ groupTemp: 91.5 });
    expect(reply).not.toHaveProperty('groupTemperature');
    machine.socket.close();
    await machine.closed;
  });

  it("keeps the real name in the mock's own state and in the shots it stores", async () => {
    expect(mock.state.getMachineSnapshot()).toHaveProperty('groupTemperature');
    mock.setSpeed(500);
    expect(mock.player.start()).toBe(true);
    await mock.player.whenIdle();
    const shot = mock.state.getShot(mock.player.lastShotId!);
    expect(shot.measurements.length).toBeGreaterThan(0);
    for (const sample of shot.measurements) expect(typeof sample.machine.groupTemperature).toBe('number');
  });

  it("is a missing reading to CafAI's frame parser: null, and one entry in the drift log", () => {
    // The drift log writes each new kind to the console, for Decaid's WebView log.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    driftLog.clear();
    const frame = parseMachineFrame(sentMachineFrame(mock.state.getMachineSnapshot(), DRIFT_RENAMED_READING));
    expect(frame).not.toBeNull();
    expect(frame!.groupTemperature).toBeNull();
    expect(frame!.mixTemperature).toEqual(expect.any(Number));
    expect(driftLog.list().map(({ source, problem }) => ({ source, problem }))).toEqual([
      { source: 'ws/v1/machine/snapshot', problem: 'groupTemperature: missing' },
    ]);
  });
});

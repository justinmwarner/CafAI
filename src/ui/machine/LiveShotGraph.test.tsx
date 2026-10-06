// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import { createShotSimulation } from '../../../mock/decaid/shotPlayer.ts';
import { createTelemetryStore } from '../../api/telemetry.ts';
import { createFakeWebSocket } from '../../api/testing/fakeWebSocket.ts';
import { parseDecaidTimestamp } from '../../api/time.ts';
import type { LiveSample, ShotStateEvent } from '../../api/types.ts';
import blooming from '../../coach/templates/source/Blooming_espresso.json';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { fakePlots, resetFakePlots } from '../testing/uplotMock.ts';
import { formatSeconds } from './format.ts';
import { LiveShotGraph } from './LiveShotGraph.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

let frames: (() => void)[] = [];
const runFrames = () =>
  act(() => {
    const due = frames;
    frames = [];
    for (const callback of due) callback();
  });

// Machine timestamps agree with tS, as telemetry derives one from the other.
const T0 = new Date(2026, 9, 3, 8, 15, 0).getTime();
const stampAt = (tS: number) => formatLocalTimestamp(T0 + tS * 1000);

function sample(tS: number, substate = 'pouring', pressure = 9): LiveSample {
  const state = substate === 'idle' ? 'idle' : 'espresso';
  return {
    tS,
    machine: { ...IDLE_TELEMETRY.machine!, timestamp: stampAt(tS), state: { state, substate }, pressure, flow: 2, targetPressure: 9 },
    scale: { timestamp: '', weight: tS * 1.5, weightFlow: 1.5, battery: null, timerValue: null },
  };
}

/** A ws/v1/machine/shotState frame stamped with the machine frame it was decided on. */
function shotState(state: ShotStateEvent['state'], tS: number, extra: Partial<ShotStateEvent> = {}): ShotStateEvent {
  return {
    event: 'state',
    timestamp: stampAt(tS),
    shotId: 'shot-1',
    state,
    machineState: 'espresso',
    machineSubstate: 'pouring',
    profileFrame: 3,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision: null,
    ...extra,
  };
}

beforeEach(() => {
  resetFakePlots();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LiveShotGraph', () => {
  it('subscribes to samples on mount and lets go on unmount', () => {
    const { services, unmount } = renderWithServices(<LiveShotGraph />);
    expect(services.telemetry.sampleListenerCount).toBe(1);
    expect(fakePlots).toHaveLength(1);
    expect(screen.getByTestId(TID.liveGraph)).toBeInTheDocument();
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('0.0 s');

    unmount();
    expect(services.telemetry.sampleListenerCount).toBe(0);
    expect(fakePlots[0]!.destroyed).toBe(true);
  });

  it('hands samples to uPlot at most once per animation frame', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    const plot = fakePlots[0]!;
    const before = plot.setDataCalls.length;

    act(() => {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) services.telemetry.emitSample(sample(t));
    });
    expect(frames).toHaveLength(1);
    expect(plot.setDataCalls).toHaveLength(before);

    runFrames();
    expect(plot.setDataCalls).toHaveLength(before + 1);
    expect(plot.setDataCalls.at(-1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('1.0 s');
    expect(screen.getByRole('list', { name: /legend/i })).toHaveTextContent('9.0 bar');
  });

  it('starts the clock at the pour, not at preheat', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(0, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(2, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(3, 'preinfusion', 1));
      services.telemetry.emitSample(sample(5.5, 'preinfusion', 2));
    });
    runFrames();
    expect(fakePlots[0]!.setDataCalls.at(-1)).toEqual([0, 2.5]);
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('2.5 s');
  });

  it('resets on a new shot and keeps the last one after it finishes', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const plot = fakePlots[0]!;
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    expect(screen.getByText('Live shot')).toBeInTheDocument();
    act(() => {
      services.telemetry.emitSample(sample(0));
      services.telemetry.emitSample(sample(1));
    });
    runFrames();

    act(() => services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' }));
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(plot.setDataCalls.at(-1)).toEqual([0, 1]);
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('1.0 s');

    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-2' }));
    // Cleared at once, not on the next frame.
    expect(plot.setDataCalls.at(-1)).toEqual([]);
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('0.0 s');
    expect(screen.getByText('Live shot')).toBeInTheDocument();
  });

  it('stops the timer when Decaid starts stopping, and plots on until the shot is finished', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const plot = fakePlots[0]!;
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => {
      services.telemetry.setState({ shotState: shotState('preheating', 0) });
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    });
    act(() => {
      services.telemetry.emitSample(sample(0, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(2, 'preinfusion', 2));
      services.telemetry.emitSample(sample(16));
      // The frame Decaid stopped on (target weight), then its stopping frame.
      services.telemetry.emitSample(sample(31.6));
      services.telemetry.setState({ shotState: shotState('stopping', 31.6) });
    });
    runFrames();
    expect(timer.textContent).toBe('29.6 s');

    // Decaid settles the yield and stores the shot before it says finished.
    act(() => {
      for (const t of [32.1, 33.1, 34.1, 35.1, 36.1]) services.telemetry.emitSample(sample(t, 'idle', 0));
    });
    runFrames();
    expect(plot.setDataCalls.at(-1)!.at(-1)).toBeCloseTo(34.1, 6);
    expect(timer.textContent).toBe('29.6 s');
    expect(screen.getByText('Live shot')).toBeInTheDocument();

    act(() => {
      services.telemetry.setState({ shotState: shotState('finished', 36.1) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    });
    runFrames();
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(timer.textContent).toBe('29.6 s');
  });

  it('stops the timer at the first pouringDone frame, before the stopping frame arrives', () => {
    // Decaid 0.8.7's simulator: the pour ran 61.6 s; the panel said 66.6 s.
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(0, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(1.7, 'preinfusion', 2));
      services.telemetry.emitSample(sample(40));
      for (const t of [63.3, 63.4, 63.5]) services.telemetry.emitSample(sample(t, 'pouringDone', 0));
    });
    runFrames();
    expect(timer.textContent).toBe('61.6 s');

    act(() => {
      services.telemetry.setState({ shotState: shotState('stopping', 63.3, { machineSubstate: 'pouringDone' }) });
      for (const t of [64, 64.5, 65, 65.5, 66, 66.5, 67, 67.5, 68, 68.3]) services.telemetry.emitSample(sample(t, 'idle', 0));
      services.telemetry.setState({ shotState: shotState('finished', 68.3, { machineState: 'idle', machineSubstate: 'idle' }) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'machineEnded' });
    });
    runFrames();
    expect(timer.textContent).toBe('61.6 s');
  });

  it('runs the timer again for the next shot', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(2, 'preinfusion'));
      services.telemetry.emitSample(sample(30));
      services.telemetry.setState({ shotState: shotState('stopping', 30) });
      services.telemetry.emitSample(sample(34, 'idle', 0));
      services.telemetry.setState({ shotState: shotState('finished', 34) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    });
    runFrames();
    expect(timer.textContent).toBe('28.0 s');

    act(() => {
      services.telemetry.setState({ shotState: shotState('preheating', 100, { shotId: 'shot-2' }) });
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-2' });
    });
    expect(timer.textContent).toBe('0.0 s');
    act(() => {
      services.telemetry.emitSample(sample(102, 'preinfusion'));
      services.telemetry.emitSample(sample(107.5));
    });
    runFrames();
    expect(timer.textContent).toBe('5.5 s');
  });

  it('a finished state still showing from the last shot does not stop the next one', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.setState({ shotState: shotState('finished', 34) }));
    // No shotState frame for the new shot yet, while every machine frame changes the store.
    act(() => services.telemetry.emitShot({ type: 'started', shotId: null }));
    act(() => {
      for (const t of [102, 104, 107.5]) {
        services.telemetry.setState({ machine: sample(t).machine });
        services.telemetry.emitSample(sample(t, t === 102 ? 'preinfusion' : 'pouring'));
      }
    });
    runFrames();
    expect(timer.textContent).toBe('5.5 s');
  });

  it("times a whole mock shot through the real telemetry store: the pour, not Decaid's stopping phase", () => {
    const ws = createFakeWebSocket();
    const telemetry = createTelemetryStore({
      client: { getDevices: async () => [], getMachineState: () => Promise.reject(new Error('no machine')) },
      wsOrigin: 'ws://localhost:8080',
      WebSocketImpl: ws.WebSocketImpl as unknown as typeof WebSocket,
      visibility: null,
      // No watchdog and no reconnects here.
      timers: { setTimeout: () => null, clearTimeout: () => {} },
    });
    renderWithServices(<LiveShotGraph />, { ...createFakeServices(), telemetry });
    const timer = screen.getByTestId(TID.shotTimer);
    telemetry.start();
    for (const socket of ws.sockets) socket.open();
    const send = (path: string, frame: unknown) => act(() => void ws.latest(`/ws/v1/${path}`).message(frame));
    send('machine/shotState', shotState('idle', 0, { shotId: null, machineState: 'idle', machineSubstate: 'idle' }));

    const simulation = createShotSimulation({
      profile: normalizeProfile(blooming),
      targetYield: 36,
      doseG: 18,
      scaleConnected: true,
      startMs: T0,
      shotId: 'shot-1',
      staleFrame: 0,
    });
    let pourStart: number | null = null;
    let stoppedOn: number | null = null;
    let atStopping: string | null = null;
    for (let frame = simulation.next(); frame; frame = simulation.next()) {
      const at = parseDecaidTimestamp(frame.machine.timestamp);
      if (frame.scale) send('scale/snapshot', frame.scale);
      send('machine/snapshot', frame.machine);
      if (pourStart === null && frame.machine.state.substate !== 'preparingForShot') pourStart = at;
      for (const event of frame.events) {
        send('machine/shotState', event);
        if (event.state === 'stopping' && stoppedOn === null) {
          stoppedOn = at;
          runFrames();
          atStopping = timer.textContent;
        }
      }
    }
    runFrames();
    telemetry.stop();

    expect(stoppedOn, 'the mock shot stops at the target weight').not.toBeNull();
    const poured = formatSeconds((stoppedOn! - pourStart!) / 1000);
    expect(atStopping).toBe(poured);
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(timer.textContent).toBe(poured);
  });

  it('picks up a shot that was already running when it mounted', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    expect(screen.getByText(/pull a shot/i)).toBeInTheDocument();
    act(() => services.telemetry.emitSample(sample(12)));
    runFrames();
    expect(screen.getByText('Live shot')).toBeInTheDocument();
    expect(screen.queryByText(/pull a shot/i)).not.toBeInTheDocument();
  });

  it('does not re-render React for samples', () => {
    const services = createFakeServices();
    let commits = 0;
    renderWithServices(
      <Profiler id="graph" onRender={() => (commits += 1)}>
        <LiveShotGraph />
      </Profiler>,
      services,
    );
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    const afterStart = commits;
    for (let i = 0; i < 40; i += 1) {
      act(() => services.telemetry.emitSample(sample(i * 0.25)));
      if (i % 4 === 0) runFrames();
    }
    runFrames();
    expect(commits).toBe(afterStart);
  });

  it('follows its container size', () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    renderWithServices(<LiveShotGraph />);
    const host = screen.getByRole('img', { name: /pressure, flow and weight/i });
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 420 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 210 });
    act(() => observers[0]!([], {} as ResizeObserver));
    expect(fakePlots[0]!.sizes.at(-1)).toEqual({ width: 420, height: 210 });
  });
});

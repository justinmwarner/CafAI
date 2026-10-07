// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import { normalizeProfile } from '../../../mock/decaid/profiles.ts';
import { createShotSimulation } from '../../../mock/decaid/shotPlayer.ts';
import { createTelemetryStore } from '../../api/telemetry.ts';
import { createFakeWebSocket } from '../../api/testing/fakeWebSocket.ts';
import { parseDecaidTimestamp } from '../../api/time.ts';
import type { LiveSample, MachineSnapshot, ShotRecord, ShotSnapshot, ShotStateEvent, WeightSnapshot } from '../../api/types.ts';
import type { CoachUiMessage } from '../../app/types.ts';
import { syntheticShotRecord } from '../../coach/__fixtures__/syntheticShot.ts';
import shot07 from '../../coach/__fixtures__/decaid-mcp/shot-07.json';
import { summarizeShot } from '../../coach/summary/summarize.ts';
import blooming from '../../coach/templates/source/Blooming_espresso.json';
import type { ShotSummary } from '../../coach/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY, SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { fakePlots, resetFakePlots } from '../testing/uplotMock.ts';
import { buildPalette, namedTint } from '../palette.ts';
import { createCafaiTheme, theme } from '../theme.ts';
import { formatSeconds } from './format.ts';
import { LiveShotGraph } from './LiveShotGraph.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

/** The number beside a legend key, e.g. legendReadout('Weight') -> "36.4 g". */
function legendReadout(label: string): string {
  const item = within(screen.getByRole('list', { name: /legend/i })).getByText(label).closest('li')!;
  return item.lastElementChild?.textContent ?? '';
}

/** The chat's shot card for a shot, as the coach engine posts it. */
function shotCard(shotId: string, summary: ShotSummary): CoachUiMessage {
  return { id: `message-${shotId}`, role: 'system', parts: [{ kind: 'shot', shotId, summary }], createdAt: '2026-10-06T08:00:00.000Z' };
}

/** A summary with the numbers a test cares about. */
function summaryWith(shotId: string, durationS: number, yieldG: number | null): ShotSummary {
  return { ...summarizeShot(syntheticShotRecord({ id: shotId })), shotId, durationS, yieldG };
}

/** The graph on the real telemetry store, fed through fake sockets as Decaid would feed it. */
function mountOnRealTelemetry() {
  const ws = createFakeWebSocket();
  const telemetry = createTelemetryStore({
    client: { getDevices: async () => [], getMachineState: () => Promise.reject(new Error('no machine')) },
    wsOrigin: 'ws://localhost:8080',
    WebSocketImpl: ws.WebSocketImpl as unknown as typeof WebSocket,
    visibility: null,
    // No watchdog and no reconnects here.
    timers: { setTimeout: () => null, clearTimeout: () => {} },
  });
  const services = { ...createFakeServices(), telemetry };
  renderWithServices(<LiveShotGraph />, services);
  telemetry.start();
  for (const socket of ws.sockets) socket.open();
  const send = (path: string, frame: unknown) => act(() => void ws.latest(`/ws/v1/${path}`).message(frame));
  return { services, telemetry, send };
}

/** A ws/v1/machine/shotState frame decided on `machine`. */
function stateOn(state: ShotStateEvent['state'], machine: MachineSnapshot, shotId: string | null, decision: ShotStateEvent['decision'] = null): ShotStateEvent {
  return {
    event: decision ? 'decision' : 'state',
    timestamp: machine.timestamp,
    shotId,
    state,
    machineState: machine.state.state,
    machineSubstate: machine.state.substate,
    profileFrame: machine.profileFrame,
    scaleConnected: true,
    scaleLost: false,
    machineHasAutonomousSAW: false,
    decision,
  };
}

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
  it('draws from the app-wide recording, which outlives the graph', () => {
    const { services, unmount } = renderWithServices(<LiveShotGraph />);
    expect(services.telemetry.sampleListenerCount).toBe(1);
    expect(fakePlots).toHaveLength(1);
    expect(screen.getByTestId(TID.liveGraph)).toBeInTheDocument();
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('0.0 s');

    // The plot goes with the graph; the recording does not.
    unmount();
    expect(services.telemetry.sampleListenerCount).toBe(1);
    expect(fakePlots[0]!.destroyed).toBe(true);

    // A shot pulled with no graph on screen is there for the next graph from its first frame.
    act(() => {
      services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
      for (const t of [0, 1, 2]) services.telemetry.emitSample(sample(t));
    });
    renderWithServices(<LiveShotGraph />, services);
    expect(services.telemetry.sampleListenerCount).toBe(1);
    expect(fakePlots[1]!.setDataCalls.at(-1)).toEqual([0, 1, 2]);
    expect(screen.getByTestId(TID.shotTimer)).toHaveTextContent('2.0 s');
    expect(screen.getByText('Live shot')).toBeInTheDocument();
  });

  it('rebuilds the plot for a new palette and keeps the shot', () => {
    const dark = createCafaiTheme(buildPalette('dark', namedTint('crema')));
    const light = createCafaiTheme(buildPalette('light', namedTint('matcha')));
    const { services, rerenderWith } = renderWithServices(
      <ThemeProvider theme={dark}>
        <LiveShotGraph />
      </ThemeProvider>,
    );
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      for (const t of [0, 1, 2]) services.telemetry.emitSample(sample(t));
    });
    runFrames();
    expect(fakePlots[0]!.setDataCalls.at(-1)).toEqual([0, 1, 2]);

    rerenderWith(
      <ThemeProvider theme={light}>
        <LiveShotGraph />
      </ThemeProvider>,
    );
    expect(fakePlots).toHaveLength(2);
    expect(fakePlots[0]!.destroyed).toBe(true);
    expect(fakePlots[1]!.setDataCalls.at(-1)).toEqual(fakePlots[0]!.setDataCalls.at(-1));
    expect((fakePlots[1]!.opts as { axes: { stroke?: string }[] }).axes[0]!.stroke).toBe(light.palette.cafai.graph.axis);
    expect(timer.textContent).toBe('2.0 s');
    expect(screen.getByText('Live shot')).toBeInTheDocument();

    // The shot goes on in the new plot only.
    const oldCalls = fakePlots[0]!.setDataCalls.length;
    act(() => services.telemetry.emitSample(sample(3)));
    runFrames();
    expect(fakePlots[1]!.setDataCalls.at(-1)).toEqual([0, 1, 2, 3]);
    expect(fakePlots[0]!.setDataCalls).toHaveLength(oldCalls);
    expect(timer.textContent).toBe('3.0 s');
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

  it('stops the timer on the frame before the one Decaid stopped on, and plots on until the shot is finished', () => {
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
      services.telemetry.emitSample(sample(31.4));
      // The frame Decaid stopped on (target weight), which its record leaves out, then its stopping frame.
      services.telemetry.emitSample(sample(31.6));
      services.telemetry.setState({ shotState: shotState('stopping', 31.6) });
    });
    runFrames();
    expect(timer.textContent).toBe('29.4 s');

    // Decaid settles the yield and stores the shot before it says finished.
    act(() => {
      for (const t of [32.1, 33.1, 34.1, 35.1, 36.1]) services.telemetry.emitSample(sample(t, 'idle', 0));
    });
    runFrames();
    expect(plot.setDataCalls.at(-1)!.at(-1)).toBeCloseTo(34.1, 6);
    expect(timer.textContent).toBe('29.4 s');
    expect(screen.getByText('Live shot')).toBeInTheDocument();

    act(() => {
      services.telemetry.setState({ shotState: shotState('finished', 36.1) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    });
    runFrames();
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(timer.textContent).toBe('29.4 s');
  });

  it('stops the timer on the last pour frame when pouringDone comes before the stopping frame', () => {
    // Decaid 0.8.7's simulator: preinfusion to pouringDone took 61.6 s; the panel said 66.6 s.
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(0, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(1.7, 'preinfusion', 2));
      services.telemetry.emitSample(sample(40));
      services.telemetry.emitSample(sample(63.1));
      for (const t of [63.3, 63.4, 63.5]) services.telemetry.emitSample(sample(t, 'pouringDone', 0));
    });
    runFrames();
    expect(timer.textContent).toBe('61.4 s');

    act(() => {
      services.telemetry.setState({ shotState: shotState('stopping', 63.3, { machineSubstate: 'pouringDone' }) });
      for (const t of [64, 64.5, 65, 65.5, 66, 66.5, 67, 67.5, 68, 68.3]) services.telemetry.emitSample(sample(t, 'idle', 0));
      services.telemetry.setState({ shotState: shotState('finished', 68.3, { machineState: 'idle', machineSubstate: 'idle' }) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'machineEnded' });
    });
    runFrames();
    expect(timer.textContent).toBe('61.4 s');
  });

  it('runs the timer again for the next shot', () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(2, 'preinfusion'));
      services.telemetry.emitSample(sample(29.8));
      services.telemetry.emitSample(sample(30));
      services.telemetry.setState({ shotState: shotState('stopping', 30) });
      services.telemetry.emitSample(sample(34, 'idle', 0));
      services.telemetry.setState({ shotState: shotState('finished', 34) });
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    });
    runFrames();
    expect(timer.textContent).toBe('27.8 s');

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

  it("times a whole mock shot through the real telemetry store as its shot card does: the pour Decaid records, not its stopping phase", () => {
    const { services, telemetry, send } = mountOnRealTelemetry();
    const timer = screen.getByTestId(TID.shotTimer);
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
    // What Decaid would store: preheat up to the frame before its stop decision.
    const recorded: ShotSnapshot[] = [];
    let finalWeight: number | null = null;
    let stoppedOn: string | null = null;
    let atStopping: string | null = null;
    for (let frame = simulation.next(); frame; frame = simulation.next()) {
      if (frame.scale) send('scale/snapshot', frame.scale);
      send('machine/snapshot', frame.machine);
      if (frame.recorded) recorded.push({ machine: frame.machine, scale: frame.scale, volume: frame.volume });
      finalWeight = frame.scale?.weight ?? finalWeight;
      for (const event of frame.events) {
        send('machine/shotState', event);
        if (event.state === 'stopping' && stoppedOn === null) {
          stoppedOn = event.timestamp;
          runFrames();
          atStopping = timer.textContent;
        }
      }
    }
    runFrames();

    expect(stoppedOn, 'the mock shot stops at the target weight').not.toBeNull();
    expect(recorded.some((m) => m.machine.timestamp === stoppedOn)).toBe(false);
    // Decaid's settled yield: the cup once the drips have stopped.
    const record: ShotRecord = {
      id: 'shot-1',
      timestamp: recorded[0]!.machine.timestamp,
      createdAt: '2026-10-03T06:16:00.000000Z',
      updatedAt: '2026-10-03T06:16:00.000000Z',
      measurements: recorded,
      workflow: { ...SAMPLE_WORKFLOW, profile: normalizeProfile(blooming) },
      annotations: { actualDoseWeight: 18, actualYield: finalWeight! },
      stopReason: simulation.stopReason ?? 'targetWeight',
    };
    const summary = summarizeShot(record);
    const time = formatSeconds(summary.durationS);
    const cup = `${summary.yieldG!.toFixed(1)} g`;

    expect(atStopping).toBe(time);
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(timer.textContent).toBe(time);
    expect(legendReadout('Weight')).toBe(cup);

    // The card for the shot changes neither number.
    act(() => services.coach.setState({ messages: [shotCard('shot-1', summary)] }));
    runFrames();
    expect(timer.textContent).toBe(time);
    expect(legendReadout('Weight')).toBe(cup);
    telemetry.stop();
  });

  it("a real Decaid shot with Decaid's stopping tail: the time is the card's as it stops, the weight the card's once it is in", () => {
    // Decaid 0.8.6 Blooming Espresso, stopped at the target weight. Its record
    // ends on the frame before the stop; the stop frame and 4 s of drips
    // reach the panel live but not the record.
    const record = shot07 as unknown as ShotRecord;
    const summary = summarizeShot(record);
    expect(summary).toMatchObject({ durationS: 64.2, yieldG: 58.8 });

    const { services, telemetry, send } = mountOnRealTelemetry();
    const timer = screen.getByTestId(TID.shotTimer);
    const first = record.measurements[0]!.machine;
    send('machine/shotState', stateOn('idle', { ...first, state: { state: 'idle', substate: 'idle' } }, null));
    send('machine/shotState', stateOn('preheating', first, record.id));
    let pouring = false;
    for (const measurement of record.measurements) {
      if (measurement.scale) send('scale/snapshot', measurement.scale);
      send('machine/snapshot', measurement.machine);
      if (!pouring && measurement.machine.state.substate !== 'preparingForShot') {
        pouring = true;
        send('machine/shotState', stateOn('pouring', measurement.machine, record.id));
      }
    }

    const last = record.measurements[record.measurements.length - 1]!;
    const lastAt = parseDecaidTimestamp(last.machine.timestamp);
    const at = (ms: number) => formatLocalTimestamp(lastAt + ms);
    const weightAt = (ms: number, weight: number): WeightSnapshot => ({ ...last.scale!, timestamp: at(ms - 40), weight, weightFlow: 0.4 });
    const stop: MachineSnapshot = { ...last.machine, timestamp: at(270) };
    send('scale/snapshot', weightAt(270, 58.1));
    send('machine/snapshot', stop);
    send(
      'machine/shotState',
      stateOn('pouring', stop, record.id, { kind: 'stop', reason: 'targetWeight', details: 'Target weight 60.0g reached.', data: null }),
    );
    send('machine/shotState', stateOn('stopping', stop, record.id));
    runFrames();
    expect(timer.textContent).toBe('64.2 s');

    // The stopping phase: pouringDone, then idle while the cup drips.
    let tail: MachineSnapshot = stop;
    for (let i = 1; i <= 16; i += 1) {
      const ms = 270 + i * 250;
      const state = i === 1 ? { state: 'espresso', substate: 'pouringDone' } : { state: 'idle', substate: 'idle' };
      tail = { ...last.machine, timestamp: at(ms), state, pressure: 0, flow: 0 };
      send('scale/snapshot', weightAt(ms, Math.min(58.6, 58.1 + i * 0.05)));
      send('machine/snapshot', tail);
    }
    send('machine/shotState', stateOn('finished', tail, record.id));
    send('machine/shotState', stateOn('idle', tail, null));
    runFrames();
    expect(screen.getByText('Last shot')).toBeInTheDocument();
    expect(timer.textContent).toBe('64.2 s');
    // Until the card is in, the panel shows the cup as it last read it.
    expect(legendReadout('Weight')).toBe('58.6 g');

    act(() => services.coach.setState({ messages: [shotCard(record.id, summary)] }));
    runFrames();
    expect(timer.textContent).toBe('64.2 s');
    expect(legendReadout('Weight')).toBe('58.8 g');
    telemetry.stop();
  });

  it("shows the card's time and yield once the coach has the card for that shot, and drops them for the next shot", () => {
    const { services } = renderWithServices(<LiveShotGraph />);
    const timer = screen.getByTestId(TID.shotTimer);
    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-1' }));
    act(() => {
      services.telemetry.emitSample(sample(0, 'preparingForShot', 0));
      services.telemetry.emitSample(sample(2, 'preinfusion', 2));
      services.telemetry.emitSample(sample(30));
      services.telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    });
    runFrames();
    expect(timer.textContent).toBe('28.0 s');
    expect(legendReadout('Weight')).toBe('45.0 g');

    // Another shot's card says nothing about this one.
    act(() => services.coach.setState({ messages: [shotCard('shot-0', summaryWith('shot-0', 25, 40))] }));
    runFrames();
    expect(timer.textContent).toBe('28.0 s');
    expect(legendReadout('Weight')).toBe('45.0 g');

    act(() =>
      services.coach.setState({
        messages: [shotCard('shot-0', summaryWith('shot-0', 25, 40)), shotCard('shot-1', summaryWith('shot-1', 27.8, 46.2))],
      }),
    );
    runFrames();
    expect(timer.textContent).toBe('27.8 s');
    expect(legendReadout('Weight')).toBe('46.2 g');

    // The chat moves to another bag: the numbers stay until the next shot.
    act(() => services.coach.setState({ messages: [] }));
    runFrames();
    expect(timer.textContent).toBe('27.8 s');
    expect(legendReadout('Weight')).toBe('46.2 g');

    // A card without a yield (no usable scale) shows none, and the panel follows it.
    act(() => services.coach.setState({ messages: [shotCard('shot-1', summaryWith('shot-1', 27.8, null))] }));
    runFrames();
    expect(legendReadout('Weight')).toBe('');

    act(() => services.telemetry.emitShot({ type: 'started', shotId: 'shot-2' }));
    expect(timer.textContent).toBe('0.0 s');
    expect(legendReadout('Weight')).toBe('');
    act(() => {
      services.telemetry.emitSample(sample(102, 'preinfusion'));
      services.telemetry.emitSample(sample(104));
    });
    runFrames();
    expect(timer.textContent).toBe('2.0 s');
    expect(legendReadout('Weight')).toBe('156.0 g');
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

  it('draws in the theme\'s graph colours and font', () => {
    renderWithServices(<LiveShotGraph />, createFakeServices());
    const opts = fakePlots[0]!.opts as { series: { stroke?: string }[]; axes: { font?: string; stroke?: string }[] };
    const graph = theme.palette.cafai.graph;
    // Same order as SERIES_KEYS: targets, weight, weight flow, flow, pressure.
    expect(opts.series.slice(1).map((s) => s.stroke)).toEqual([graph.pressure, graph.flow, graph.weight, graph.weightFlow, graph.flow, graph.pressure]);
    expect(opts.axes[0]!.stroke).toBe(graph.axis);
    expect(opts.axes[0]!.font).toBe(`12px ${theme.typography.fontFamily}`);
  });
});

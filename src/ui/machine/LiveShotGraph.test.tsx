// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import type { LiveSample } from '../../api/types.ts';
import { TID } from '../testIds.ts';
import { createFakeServices, IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { renderWithServices } from '../testing/renderWithServices.tsx';
import { fakePlots, resetFakePlots } from '../testing/uplotMock.ts';
import { LiveShotGraph } from './LiveShotGraph.tsx';

vi.mock('uplot', () => import('../testing/uplotMock.ts'));

let frames: (() => void)[] = [];
const runFrames = () =>
  act(() => {
    const due = frames;
    frames = [];
    for (const callback of due) callback();
  });

function sample(tS: number, substate = 'pouring', pressure = 9): LiveSample {
  return {
    tS,
    machine: { ...IDLE_TELEMETRY.machine!, state: { state: 'espresso', substate }, pressure, flow: 2, targetPressure: 9 },
    scale: { timestamp: '', weight: tS * 1.5, weightFlow: 1.5, battery: null, timerValue: null },
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

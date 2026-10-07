import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { LiveSample, ShotStateEvent, TelemetryState } from '../../api/types.ts';
import { createFakeTelemetry, IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { createShotTrace, shotTraceFor } from './shotTrace.ts';

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
function shotState(state: ShotStateEvent['state'], tS: number): ShotStateEvent {
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
  };
}

/** A trace on a fake store, and everything it reported, in order. */
function recording(initial: Partial<TelemetryState> = {}) {
  const telemetry = createFakeTelemetry(initial);
  const trace = createShotTrace(telemetry);
  const heard: string[] = [];
  trace.onData((change) => heard.push(change));
  trace.subscribe(() => heard.push(`phase:${trace.getState().phase}`));
  return { telemetry, trace, heard };
}

describe('createShotTrace', () => {
  it('empties the buffer for a new shot and says so before the phase turns live', () => {
    const { telemetry, trace, heard } = recording();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    telemetry.emitSample(sample(0));
    telemetry.emitSample(sample(1));
    telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    heard.length = 0;

    // What a graph sees when it hears of the reset.
    let atReset: { length: number; phase: string } | null = null;
    trace.onData((change) => {
      if (change === 'reset') atReset = { length: trace.buffer.length, phase: trace.getState().phase };
    });
    telemetry.emitShot({ type: 'started', shotId: 'shot-2' });
    expect(heard).toEqual(['reset', 'phase:live']);
    expect(atReset).toEqual({ length: 0, phase: 'done' });
    expect(trace.buffer.data[0]).toEqual([]);
    expect(trace.getState()).toEqual({ phase: 'live', finishedShotId: null });
  });

  it('reports plotted frames, and nothing for the preheat frames it leaves off', () => {
    const { telemetry, trace, heard } = recording();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    heard.length = 0;
    telemetry.emitSample(sample(0, 'preparingForShot', 0));
    expect(heard).toEqual([]);
    telemetry.emitSample(sample(1, 'preinfusion', 2));
    telemetry.emitSample(sample(1.25));
    expect(heard).toEqual(['frames', 'frames']);
    expect(trace.buffer.data[0]).toEqual([0, 0.25]);
  });

  it('keeps a finished shot on screen as done, and goes back to empty for one that never plotted', () => {
    const { telemetry, trace } = recording();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    telemetry.emitSample(sample(0));
    telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    expect(trace.getState()).toEqual({ phase: 'done', finishedShotId: 'shot-1' });
    expect(trace.buffer.length).toBe(1);

    telemetry.emitShot({ type: 'started', shotId: 'shot-2' });
    telemetry.emitSample(sample(0, 'preparingForShot', 0));
    telemetry.emitShot({ type: 'finished', shotId: 'shot-2', stopReason: null });
    expect(trace.getState()).toEqual({ phase: 'empty', finishedShotId: null });
  });

  it('goes live on the first plotted frame when it starts recording mid-shot', () => {
    const { telemetry, trace, heard } = recording();
    telemetry.emitSample(sample(12));
    expect(trace.getState()).toEqual({ phase: 'live', finishedShotId: null });
    expect(heard).toEqual(['phase:live', 'frames']);
    telemetry.emitSample(sample(12.25));
    expect(heard).toEqual(['phase:live', 'frames', 'frames']);
  });

  it('ends the pour on the frame before the one Decaid stopped on, and reports it as frames', () => {
    const { telemetry, trace, heard } = recording();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    for (const t of [0, 1, 2]) telemetry.emitSample(sample(t));
    heard.length = 0;
    telemetry.setState({ shotState: shotState('stopping', 2) });
    expect(trace.buffer.pourEndS()).toBe(1);
    expect(heard).toEqual(['frames']);
  });

  it('a shot state still showing from the last shot does not stop the next one', () => {
    const { telemetry, trace, heard } = recording();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    for (const t of [0, 1, 2]) telemetry.emitSample(sample(t));
    telemetry.setState({ shotState: shotState('stopping', 2) });
    telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });

    telemetry.emitShot({ type: 'started', shotId: 'shot-2' });
    heard.length = 0;
    for (const t of [100, 101]) {
      // Every machine frame changes the store; the shot state stays the same object.
      telemetry.setState({ machine: sample(t).machine });
      telemetry.emitSample(sample(t));
    }
    expect(heard).toEqual(['frames', 'frames']);
    expect(trace.buffer.pourEndS()).toBeNull();
    expect(trace.buffer.elapsedS()).toBe(1);
  });

  it('a shot state already showing when it starts recording does not stop the clock', () => {
    const { telemetry, trace } = recording({ shotState: shotState('finished', 0) });
    telemetry.emitShot({ type: 'started', shotId: null });
    for (const t of [100, 101]) {
      telemetry.emitSample(sample(t));
      // A store change once the pour has started: the old state must count as seen.
      telemetry.setState({ machine: sample(t).machine });
    }
    expect(trace.buffer.pourEndS()).toBeNull();
    expect(trace.buffer.elapsedS()).toBe(1);
  });

  it('returns the same state object until the state changes, as useSyncExternalStore needs', () => {
    const { telemetry, trace, heard } = recording();
    const empty = trace.getState();
    expect(trace.getState()).toBe(empty);

    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    const live = trace.getState();
    expect(live).not.toBe(empty);
    telemetry.emitSample(sample(0));
    telemetry.emitSample(sample(1));
    expect(trace.getState()).toBe(live);

    // A second start while live empties the buffer but changes no state.
    heard.length = 0;
    telemetry.emitShot({ type: 'started', shotId: 'shot-2' });
    expect(heard).toEqual(['reset']);
    expect(trace.getState()).toBe(live);
  });

  it('tells an unsubscribed listener nothing', () => {
    const { telemetry, trace } = recording();
    const heard: string[] = [];
    const stopData = trace.onData((change) => heard.push(change));
    const stopState = trace.subscribe(() => heard.push('state'));
    stopData();
    stopState();
    telemetry.emitShot({ type: 'started', shotId: 'shot-1' });
    telemetry.emitSample(sample(0));
    telemetry.emitShot({ type: 'finished', shotId: 'shot-1', stopReason: 'targetWeight' });
    expect(heard).toEqual([]);
    expect(trace.getState()).toEqual({ phase: 'done', finishedShotId: 'shot-1' });
  });
});

describe('shotTraceFor', () => {
  it('keeps one trace per telemetry store', () => {
    const one = createFakeTelemetry();
    const other = createFakeTelemetry();
    const trace = shotTraceFor(one);
    expect(shotTraceFor(one)).toBe(trace);
    expect(shotTraceFor(other)).not.toBe(trace);
    // One recording per store, however many graphs ask for it.
    expect(one.sampleListenerCount).toBe(1);
    expect(other.sampleListenerCount).toBe(1);
  });
});

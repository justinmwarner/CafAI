import { describe, expect, it } from 'vitest';
import { formatLocalTimestamp } from '../../../mock/decaid/clock.ts';
import type { MachineFrame, TelemetryState } from '../../api/types.ts';
import { createFakeTelemetry, IDLE_TELEMETRY } from '../testing/fakeServices.ts';
import { createDrinkTrace, drinkTraceFor, MAX_FRAMES, type DrinkRunEvent } from './drinkTrace.ts';

const T0 = new Date(2026, 9, 13, 8, 0, 0).getTime();

/** A machine frame `s` seconds after T0, a new object every time, as telemetry makes them. */
function frame(s: number, state: string, substate = 'pouring', values: Partial<MachineFrame> = {}): MachineFrame {
  return { ...IDLE_TELEMETRY.machine!, timestamp: formatLocalTimestamp(T0 + s * 1000), state: { state, substate }, flow: 0, pressure: 0, ...values };
}

function recording(initial: Partial<TelemetryState> = {}) {
  const telemetry = createFakeTelemetry(initial);
  const trace = createDrinkTrace(telemetry);
  const heard: string[] = [];
  trace.onRun((event: DrinkRunEvent) => heard.push(`${event.type}:${event.run.kind}:${event.run.id}`));
  trace.onData((run) => heard.push(`data:${run.kind}`));
  const send = (f: MachineFrame) => telemetry.setState({ machine: f });
  return { telemetry, trace, heard, send };
}

describe('createDrinkTrace', () => {
  it('starts a run at the first frame in a drink state and ends it at the first frame outside', () => {
    const { trace, heard, send } = recording();
    send(frame(0, 'idle', 'idle'));
    expect(trace.getState()).toEqual({ live: null, runId: 0 });
    send(frame(1, 'steam', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'steam', runId: 1 });
    send(frame(1.5, 'steam', 'pouring'));
    send(frame(2, 'idle', 'idle'));
    expect(trace.getState()).toEqual({ live: null, runId: 1 });
    expect(heard).toEqual(['started:steam:1', 'data:steam', 'data:steam', 'ended:steam:1']);
    const run = trace.runOf('steam')!;
    expect(run.live).toBe(false);
    expect(run.lost).toBe(false);
  });

  it("counts the time from the first frame past heating, in the machine's own timestamps", () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'preparingForShot'));
    send(frame(1, 'steam', 'preparingForShot'));
    expect(trace.runOf('steam')!.elapsedS).toBe(0);
    expect(trace.runOf('steam')!.t).toEqual([]);
    send(frame(2, 'steam', 'pouring'));
    send(frame(2.25, 'steam', 'pouring'));
    send(frame(2.5, 'steam', 'pouring'));
    const run = trace.runOf('steam')!;
    expect(run.t).toEqual([0, 0.25, 0.5]);
    expect(run.elapsedS).toBeCloseTo(0.5, 6);
  });

  it('stops the clock while steam is paused or the wand purges or rinses, and keeps the frames', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    send(frame(1, 'steam', 'pouring'));
    send(frame(2, 'steam', 'puffing'));
    send(frame(3, 'steam', 'puffing'));
    send(frame(4, 'steamRinse', 'idle'));
    const run = trace.runOf('steam')!;
    expect(run.live).toBe(true);
    expect(run.elapsedS).toBeCloseTo(2, 6);
    expect(run.t).toEqual([0, 1, 2, 3, 4]);
    expect(run.working).toEqual([true, true, false, false, false]);
  });

  it('sums the water from the flow, only while the drink works', () => {
    const { trace, send } = recording();
    send(frame(0, 'hotWater', 'preparingForShot', { flow: 3 }));
    send(frame(1, 'hotWater', 'pouring', { flow: 4 }));
    send(frame(2, 'hotWater', 'pouring', { flow: 6 }));
    send(frame(3, 'hotWater', 'pouring', { flow: 6 }));
    // (4 + 6) / 2 * 1 + (6 + 6) / 2 * 1
    expect(trace.runOf('hotWater')!.waterMl).toBeCloseTo(11, 6);
  });

  it('counts the last stretch up to the frame that ends the run, but not one the machine went away in', () => {
    const { telemetry, trace, send } = recording();
    send(frame(0, 'flush', 'pouring', { flow: 6 }));
    send(frame(1, 'flush', 'pouring', { flow: 6 }));
    send(frame(1.5, 'idle', 'idle', { flow: 0 }));
    const flush = trace.runOf('flush')!;
    expect(flush.elapsedS).toBeCloseTo(1.5, 6);
    // 6 * 1 + (6 + 0) / 2 * 0.5
    expect(flush.waterMl).toBeCloseTo(7.5, 6);
    expect(flush.t).toEqual([0, 1]);

    send(frame(2, 'hotWater', 'pouring', { flow: 4 }));
    send(frame(3, 'hotWater', 'pouring', { flow: 4 }));
    telemetry.setState({ machineConnected: false });
    expect(trace.runOf('hotWater')!.elapsedS).toBeCloseTo(1, 6);
  });

  it('never sums a negative flow into the water', () => {
    const { trace, send } = recording();
    send(frame(0, 'flush', 'pouring', { flow: -0.4 }));
    send(frame(1, 'flush', 'pouring', { flow: -0.2 }));
    expect(trace.runOf('flush')!.waterMl).toBe(0);
  });

  it('keeps the series and the scale reading with each frame', () => {
    const { telemetry, trace, send } = recording();
    telemetry.setState({ scale: { timestamp: '', weight: 12.5, weightFlow: 2, battery: null, timerValue: null } });
    send(frame(0, 'hotWater', 'pouring', { flow: 5, pressure: 0.4, steamTemperature: 150, groupTemperature: 91 }));
    const run = trace.runOf('hotWater')!;
    expect(run.flow).toEqual([5]);
    expect(run.pressure).toEqual([0.4]);
    expect(run.steamTemperature).toEqual([150]);
    expect(run.groupTemperature).toEqual([91]);
    expect(run.weight).toEqual([12.5]);
  });

  it('records no weight without a scale', () => {
    const { trace, send } = recording({ scaleConnected: false });
    send(frame(0, 'hotWater', 'pouring', { flow: 5 }));
    expect(trace.runOf('hotWater')!.weight).toEqual([null]);
  });

  it('leaves out a frame older than the last, but still shows it as the newest frame', () => {
    const { trace, send } = recording();
    send(frame(1, 'flush', 'pouring', { flow: 6 }));
    send(frame(2, 'flush', 'pouring', { flow: 6 }));
    const late = frame(1.5, 'flush', 'pouring', { flow: 6 });
    send(late);
    const run = trace.runOf('flush')!;
    expect(run.t).toEqual([0, 1]);
    expect(run.latest).toBe(late);
  });

  it('ends a run as lost when the machine goes away, and ignores the stale frame afterwards', () => {
    const { telemetry, trace, heard, send } = recording();
    send(frame(0, 'hotWater', 'pouring'));
    telemetry.setState({ machineConnected: false });
    expect(trace.getState().live).toBeNull();
    expect(trace.runOf('hotWater')!.lost).toBe(true);
    telemetry.setState({ machineConnected: true });
    expect(trace.getState().live).toBeNull();
    expect(heard.filter((h) => h.startsWith('started'))).toEqual(['started:hotWater:1']);
  });

  it('starts a new run for another drink, or the same drink again, and keeps the last run of each', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    send(frame(1, 'flush', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'flush', runId: 2 });
    expect(trace.runOf('steam')!.live).toBe(false);
    send(frame(2, 'idle', 'idle'));
    send(frame(3, 'steam', 'pouring'));
    expect(trace.getState()).toEqual({ live: 'steam', runId: 3 });
    expect(trace.runOf('steam')!.id).toBe(3);
    expect(trace.runOf('flush')!.id).toBe(2);
    expect(trace.runOf('hotWater')).toBeNull();
  });

  it('picks up a run already under way when it starts recording', () => {
    const { trace } = recording({ machine: frame(0, 'steam', 'pouring') });
    expect(trace.getState()).toEqual({ live: 'steam', runId: 1 });
  });

  it('returns the same state object until a run starts or ends', () => {
    const { trace, send } = recording();
    send(frame(0, 'steam', 'pouring'));
    const live = trace.getState();
    send(frame(1, 'steam', 'pouring'));
    expect(trace.getState()).toBe(live);
  });

  it('keeps counting past MAX_FRAMES but stops growing its arrays', () => {
    const { trace, send } = recording();
    for (let i = 0; i <= MAX_FRAMES + 5; i += 1) send(frame(i * 0.1, 'flush', 'pouring', { flow: 1 }));
    const run = trace.runOf('flush')!;
    expect(run.t.length).toBe(MAX_FRAMES);
    expect(run.elapsedS).toBeCloseTo((MAX_FRAMES + 5) * 0.1, 3);
  });

  it('tells an unsubscribed listener nothing', () => {
    const telemetry = createFakeTelemetry();
    const trace = createDrinkTrace(telemetry);
    const heard: string[] = [];
    const a = trace.onRun(() => heard.push('run'));
    const b = trace.onData(() => heard.push('data'));
    const c = trace.subscribe(() => heard.push('state'));
    a();
    b();
    c();
    telemetry.setState({ machine: frame(0, 'steam', 'pouring') });
    expect(heard).toEqual([]);
  });
});

describe('drinkTraceFor', () => {
  it('keeps one recording per telemetry store', () => {
    const one = createFakeTelemetry();
    const trace = drinkTraceFor(one);
    expect(drinkTraceFor(one)).toBe(trace);
    expect(drinkTraceFor(createFakeTelemetry())).not.toBe(trace);
  });
});

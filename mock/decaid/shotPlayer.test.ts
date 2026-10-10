import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import type { MachineSnapshot, ShotStateEvent } from '../../src/api/types.ts';
import blooming from '../../src/coach/templates/source/Blooming_espresso.json';
import dflow from '../../src/coach/templates/source/D-Flow____default.json';
import gentle from '../../src/coach/templates/source/Gentle_and_sweet1.json';
import londonium from '../../src/coach/templates/source/Londonium.json';
import allonge from '../../src/coach/templates/source/rao_allonge.json';
import { normalizeProfile } from './profiles.ts';
import { createShotPlayer, createShotSimulation, DEFAULT_PUCK_RESISTANCE, type ShotSimulationInput, type SimFrame } from './shotPlayer.ts';
import { createMockDecaid } from './state.ts';

const START = new Date(2026, 9, 3, 8, 15, 2, 725).getTime();

function input(profile: unknown, overrides: Partial<ShotSimulationInput> = {}): ShotSimulationInput {
  return {
    profile: normalizeProfile(profile),
    targetYield: 36,
    doseG: 18,
    scaleConnected: true,
    startMs: START,
    shotId: 'shot-1',
    staleFrame: 5,
    ...overrides,
  };
}

function run(simInput: ShotSimulationInput, control?: (frame: SimFrame, index: number) => void): SimFrame[] {
  const simulation = createShotSimulation(simInput);
  const frames: SimFrame[] = [];
  for (let i = 0; i < 2000; i += 1) {
    const frame = simulation.next();
    if (!frame) break;
    frames.push(frame);
    control?.(frame, i);
    if (frame.done) break;
  }
  expect(simulation.next(), 'nothing after done').toBeNull();
  return frames;
}

const events = (frames: SimFrame[]) => frames.flatMap((frame) => frame.events);
const recorded = (frames: SimFrame[]) => frames.filter((frame) => frame.recorded);
const seconds = (frames: SimFrame[]) =>
  (parseDecaidTimestamp(frames.at(-1)!.machine.timestamp) - parseDecaidTimestamp(frames[0]!.machine.timestamp)) / 1000;

function substateRuns(frames: SimFrame[]): string[] {
  const runs: string[] = [];
  for (const frame of frames) {
    const name = `${frame.machine.state.state}/${frame.machine.state.substate}`;
    if (runs.at(-1) !== name) runs.push(name);
  }
  return runs;
}

describe('createShotSimulation', () => {
  for (const [name, profile] of [
    ['Blooming Espresso', blooming],
    ['D-Flow', dflow],
    ['Londonium', londonium],
  ] as const) {
    it(`${name}: a plausible shot that stops at the target yield`, () => {
      const frames = run(input(profile));
      const stamps = frames.map((frame) => parseDecaidTimestamp(frame.machine.timestamp));
      for (let i = 1; i < stamps.length; i += 1) {
        const gap = stamps[i]! - stamps[i - 1]!;
        expect(gap, `gap ${i}`).toBeGreaterThan(150);
        expect(gap, `gap ${i}`).toBeLessThan(250);
      }
      expect(frames[0]!.machine.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/);

      // preparingForShot (~2 s) -> preinfusion -> pouring -> stop tail, in that order.
      const runs = substateRuns(frames);
      expect(runs[0]).toBe('espresso/preparingForShot');
      expect(frames.filter((f) => f.machine.state.substate === 'preparingForShot')).toHaveLength(10);
      expect(runs.indexOf('espresso/preinfusion')).toBe(1);
      expect(runs).toContain('espresso/pouring');
      expect(runs.at(-1)).toBe('idle/idle');

      // Measurements start at preheat and end before the stop-triggering sample.
      const kept = recorded(frames);
      expect(kept[0]!.machine.state.substate).toBe('preparingForShot');
      expect(kept.every((f) => f.machine.state.state === 'espresso' && ['preparingForShot', 'preinfusion', 'pouring'].includes(f.machine.state.substate))).toBe(true);
      expect(kept.length).toBeLessThan(frames.length);

      // profileFrame is stale during preheat, then runs 0 -> n without going back.
      expect(kept.slice(0, 10).every((f) => f.machine.profileFrame === 5)).toBe(true);
      const stepFrames = kept.slice(10).map((f) => f.machine.profileFrame);
      expect(stepFrames[0]).toBe(0);
      for (let i = 1; i < stepFrames.length; i += 1) expect(stepFrames[i]!).toBeGreaterThanOrEqual(stepFrames[i - 1]!);
      expect(Math.max(...stepFrames)).toBeGreaterThanOrEqual(2);

      // Weight: 0 until the cup sees water, never falling, and the shot stops at the target.
      const weights = kept.map((f) => f.scale!.weight);
      expect(weights.slice(0, 10).every((w) => w === 0)).toBe(true);
      for (let i = 1; i < weights.length; i += 1) expect(weights[i]!).toBeGreaterThanOrEqual(weights[i - 1]!);
      expect(weights.at(-1)!).toBeLessThan(36);
      expect(weights.at(-1)!).toBeGreaterThan(30);

      const decisions = events(frames).filter((e) => e.decision?.kind === 'stop');
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        event: 'decision',
        state: 'pouring',
        shotId: 'shot-1',
        decision: { kind: 'stop', reason: 'targetWeight', data: { targetYield: 36 } },
      });
      expect(decisions[0]!.decision!.details).toMatch(/^Target weight 36\.0g reached \(projected: [\d.]+\)\. Stopping shot\.$/);
      expect((decisions[0]!.decision!.data as { projectedWeight: number }).projectedWeight).toBeGreaterThanOrEqual(36);

      const states = events(frames)
        .filter((e) => e.event === 'state')
        .map((e) => e.state);
      expect(states).toEqual(['preheating', 'pouring', 'stopping', 'finished']);
      expect(frames.at(-1)!.done).toBe(true);
      expect(seconds(frames)).toBeGreaterThan(20);
      expect(seconds(frames)).toBeLessThan(75);
    });
  }

  it('flow steps hold flow and report no pressure target; pressure steps the reverse', () => {
    const frames = recorded(run(input(blooming)));
    const flatFlow = frames.filter((f) => f.machine.profileFrame === 4);
    expect(flatFlow.length).toBeGreaterThan(5);
    for (const frame of flatFlow) {
      expect(frame.machine.targetFlow).toBeCloseTo(2.2, 1);
      expect(frame.machine.targetPressure).toBe(0);
      expect(frame.machine.pressure).toBeLessThanOrEqual(8.6 + 1e-9);
    }
    expect(flatFlow.at(-1)!.machine.flow).toBeCloseTo(2.2, 1);

    const lever = recorded(run(input(londonium)));
    const peak = Math.max(...lever.map((f) => f.machine.pressure));
    expect(peak).toBeGreaterThan(8);
    expect(peak).toBeLessThan(9.3);
    const up = lever.filter((f) => f.machine.profileFrame === 3);
    expect(up.every((f) => f.machine.targetFlow === 0 && f.machine.targetPressure === 9)).toBe(true);
  });

  it("holds Decaid's stopping phase for about 4 s: pouringDone, then idle until finished", () => {
    const frames = run(input(blooming));
    const stopping = frames.findIndex((f) => f.events.some((e) => e.event === 'state' && e.state === 'stopping'));
    const finished = frames.findIndex((f) => f.events.some((e) => e.event === 'state' && e.state === 'finished'));
    expect(stopping).toBeGreaterThan(0);
    expect(finished).toBe(frames.length - 1);
    // shot_sequencer.dart waits for the cup weight to settle, with a 4 s backstop.
    expect(seconds(frames.slice(stopping))).toBeCloseTo(4, 1);
    // The pump stops at once; only Decaid's bookkeeping takes the time.
    expect(substateRuns(frames.slice(stopping + 1))).toEqual(['espresso/pouringDone', 'idle/idle']);
    expect(frames.slice(stopping).some((f) => f.recorded)).toBe(false);
  });

  it("stops at weight as Decaid does: the scale's weight plus its weight flow times weightFlowMultiplier (1.0 s by default)", () => {
    for (const [multiplier, lookAhead] of [
      [undefined, 1.0],
      [2.5, 2.5],
    ] as const) {
      const frames = run(input(dflow, { targetYield: 36, ...(multiplier === undefined ? {} : { weightFlowMultiplier: multiplier }) }));
      const stopAt = frames.findIndex((f) => f.events.some((e) => e.decision?.kind === 'stop'));
      const decision = frames[stopAt]!.events.find((e) => e.decision?.kind === 'stop')!.decision!;
      expect(decision.reason).toBe('targetWeight');
      const projection = (frame: SimFrame) => frame.scale!.weight + frame.scale!.weightFlow * lookAhead;
      expect((decision.data as { projectedWeight: number }).projectedWeight).toBeCloseTo(projection(frames[stopAt]!), 6);
      expect(projection(frames[stopAt]!)).toBeGreaterThanOrEqual(36);
      // The sample before did not reach it yet.
      expect(projection(frames[stopAt - 1]!)).toBeLessThan(36);
    }
  });

  it('a shot stopped at weight settles within about 1 g of its target, as Decaid\'s early stop intends', () => {
    for (const [name, profile, targetYield] of [
      ['Blooming Espresso', blooming, 36],
      ['D-Flow', dflow, 36],
      ['D-Flow', dflow, 50],
      ['Londonium', londonium, 36],
      ['Gentle and Sweet', gentle, 36],
    ] as const) {
      const frames = run(input(profile, { targetYield }));
      expect(events(frames).find((e) => e.decision?.kind === 'stop')!.decision!.reason, name).toBe('targetWeight');
      const settled = frames.at(-1)!.scale!.weight;
      expect(Math.abs(settled - targetYield), `${name} at ${targetYield} g settled at ${settled} g`).toBeLessThanOrEqual(1);
      // The drips after the stop are what Decaid's look-ahead anticipates.
      expect(settled).toBeGreaterThan(recorded(frames).at(-1)!.scale!.weight + 1);
    }
  });

  it('values sit on the DE1 fixed-point grids', () => {
    for (const frame of recorded(run(input(dflow)))) {
      expect(Number.isInteger(frame.machine.pressure * 4096)).toBe(true);
      expect(Number.isInteger(frame.machine.flow * 4096)).toBe(true);
      expect(Number.isInteger(frame.machine.targetPressure * 16)).toBe(true);
      expect(Number.isInteger(frame.machine.mixTemperature * 256)).toBe(true);
      expect(Number.isInteger(frame.machine.steamTemperature)).toBe(true);
    }
  });

  it("D-Flow's 4 g weight exit ends the infusion, as Decaid's skipStep does", () => {
    const frames = run(input(dflow));
    const skips = events(frames).filter((e) => e.decision?.reason === 'profileSkip');
    expect(skips.length).toBeGreaterThanOrEqual(1);
    expect(skips[0]!.decision).toMatchObject({ kind: 'advance', data: { frame: 1, stepExitWeight: 4 } });
    expect(recorded(frames).some((f) => f.machine.profileFrame === 2 && f.machine.state.substate === 'pouring')).toBe(true);
  });

  it('volume counts only from target_volume_count_start', () => {
    const frames = recorded(run(input(blooming)));
    expect(frames.filter((f) => f.machine.profileFrame < 2 || f.machine.state.substate === 'preparingForShot').every((f) => f.volume === 0)).toBe(true);
    expect(frames.at(-1)!.volume).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    expect(run(input(londonium))).toEqual(run(input(londonium)));
  });

  /** When the cup first holds more than 0.3 g, when the profile reaches its pause (step 2), and what the cup holds at the end. */
  function blooming50(puckResistance?: number) {
    const frames = recorded(run(input(blooming, { targetYield: 50, ...(puckResistance === undefined ? {} : { puckResistance }) })));
    const at = (frame: SimFrame | undefined) => (frame ? Math.round((parseDecaidTimestamp(frame.machine.timestamp) - START) / 100) / 10 : null);
    return {
      firstDropS: at(frames.find((f) => (f.scale?.weight ?? 0) > 0.3)),
      pauseS: at(frames.find((f) => f.machine.profileFrame >= 2 && f.machine.state.substate !== 'preparingForShot')),
      endS: at(frames.at(-1)),
      weightG: frames.at(-1)!.scale!.weight,
    };
  }

  it('the resistance model leaves the default puck alone (the live mock never sets one)', () => {
    expect(blooming50()).toEqual(blooming50(DEFAULT_PUCK_RESISTANCE));
    // A live Blooming shot at 50 g; only the cup lag (one lag both ways) moved its weight, from 45.4 g.
    expect(blooming50()).toEqual({ firstDropS: 7.4, pauseS: 6.6, endS: 62.4, weightG: 44.5 });
  });

  it("a puck's resistance shows before the pour: a finer one drips later, fills longer and gives less", () => {
    const coarse = blooming50(2.2);
    const fine = blooming50(2.6);
    expect(fine.firstDropS!).toBeGreaterThan(coarse.firstDropS!);
    expect(fine.pauseS!).toBeGreaterThan(coarse.pauseS!);
    expect(fine.endS!).toBeGreaterThan(coarse.endS!);
    expect(fine.weightG).toBeLessThan(coarse.weightG - 2);
    // About ±10% around the default moves each by at least a frame or a gram.
    const middle = blooming50();
    expect(coarse.firstDropS!).toBeLessThan(middle.firstDropS!);
    expect(fine.firstDropS!).toBeGreaterThan(middle.firstDropS!);
    expect(coarse.weightG).toBeGreaterThan(middle.weightG + 1);
    expect(fine.weightG).toBeLessThan(middle.weightG - 1);
  });

  it('without a scale it runs scaleless and the machine ends the shot', () => {
    const frames = run(input(dflow, { scaleConnected: false }));
    expect(recorded(frames).every((f) => f.scale === null)).toBe(true);
    expect(events(frames).find((e) => e.decision?.kind === 'stop')!.decision!.reason).toBe('machineEnded');
    expect(seconds(frames)).toBeLessThan(100);
  });

  it('with stop-at-weight off the shot still ends within the cap', () => {
    const frames = run(input(londonium, { targetYield: 0 }));
    expect(events(frames).find((e) => e.decision?.kind === 'stop')!.decision!.reason).toBe('machineEnded');
    expect(seconds(frames)).toBeLessThan(100);
  });

  it('a stop during preheat aborts without a record', () => {
    const simulation = createShotSimulation(input(blooming));
    const frames: SimFrame[] = [];
    for (let i = 0; i < 100; i += 1) {
      if (i === 3) simulation.requestStop('apiStop');
      const frame = simulation.next();
      if (!frame) break;
      frames.push(frame);
      if (frame.done) break;
    }
    expect(simulation.aborted).toBe(true);
    const abort = events(frames).find((e) => e.decision?.kind === 'abort');
    expect(abort).toMatchObject({ state: 'preheating', decision: { reason: 'apiStop' } });
    expect(events(frames).some((e) => e.state === 'finished')).toBe(false);
  });

  it('a stop during the pour is an apiStop', () => {
    const simulation = createShotSimulation(input(londonium));
    const frames: SimFrame[] = [];
    for (let i = 0; i < 400; i += 1) {
      if (i === 60) simulation.requestStop('apiStop');
      const frame = simulation.next();
      if (!frame) break;
      frames.push(frame);
      if (frame.done) break;
    }
    expect(simulation.aborted).toBe(false);
    expect(simulation.stopReason).toBe('apiStop');
    expect(events(frames).find((e) => e.decision?.kind === 'stop')!.decision).toMatchObject({
      reason: 'apiStop',
      details: 'Shot stopped via REST API request',
    });
    expect(events(frames).filter((e) => e.event === 'state').map((e) => e.state)).toEqual(['preheating', 'pouring', 'stopping', 'finished']);
    expect(recorded(frames)).toHaveLength(60);
  });

  it('without a scale, a profile with no target_volume runs to the machine end', () => {
    // D-Flow's target_volume is 0: off.
    const frames = run(input(dflow, { scaleConnected: false }));
    expect(events(frames).find((e) => e.decision?.kind === 'stop')!.decision!.reason).toBe('machineEnded');
  });

  it('skipStep moves to the next step', () => {
    const simulation = createShotSimulation(input(londonium));
    const seen: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      if (i === 20) simulation.skipStep();
      const frame = simulation.next();
      if (!frame || frame.done) break;
      seen.push(frame.machine.profileFrame);
    }
    expect(seen[19]! + 1).toBeLessThanOrEqual(seen[21]!);
  });
});

describe('the volumetric stop (shot_sequencer.dart, pouring state)', () => {
  const stopEvent = (frames: SimFrame[]) => events(frames).find((e) => e.decision?.kind === 'stop')!;
  const lastVolume = (frames: SimFrame[]) => recorded(frames).at(-1)!.volume;

  it('Gentle and Sweet without a scale stops at its 36 ml target_volume', () => {
    const frames = run(input(gentle, { scaleConnected: false }));
    const stop = stopEvent(frames);
    expect(stop).toMatchObject({
      event: 'decision',
      state: 'pouring',
      shotId: 'shot-1',
      decision: { kind: 'stop', reason: 'targetVolume', data: { targetVolume: 36 } },
    });
    expect(stop.decision!.details).toMatch(/^Target volume 36\.0ml reached \(projected: [\d.]+\)\. Stopping shot\.$/);
    const projected = (stop.decision!.data as { projectedVolume: number }).projectedVolume;
    expect(projected).toBeGreaterThan(36);
    expect(projected).toBeLessThan(37.5);
    expect(lastVolume(frames)).toBeGreaterThan(33);
    expect(lastVolume(frames)).toBeLessThanOrEqual(36);
    // No scale, so there is no yield to settle: finished at once.
    expect(events(frames).filter((e) => e.event === 'state').map((e) => e.state)).toEqual(['preheating', 'pouring', 'finished']);
  });

  it('the Allongé, ground coarse enough to hold its 4.5 ml/s, stops near its 180 ml', () => {
    const frames = run(input(allonge, { scaleConnected: false, targetYield: 0, puckResistance: 0.4 }));
    expect(stopEvent(frames).decision).toMatchObject({ reason: 'targetVolume', data: { targetVolume: 180 } });
    expect(stopEvent(frames).decision!.details).toMatch(/^Target volume 180\.0ml reached/);
    expect(lastVolume(frames)).toBeGreaterThan(175);
    expect(lastVolume(frames)).toBeLessThanOrEqual(180);
  });

  it('at the default espresso grind the Allongé cannot pump 180 ml in its 62 s, so the machine ends it', () => {
    const frames = run(input(allonge, { scaleConnected: false, targetYield: 0 }));
    expect(stopEvent(frames).decision!.reason).toBe('machineEnded');
    expect(lastVolume(frames)).toBeLessThan(180);
  });

  it('looks ahead by flow x volumeFlowMultiplier, like Decaid', () => {
    const plain = lastVolume(run(input(gentle, { scaleConnected: false, volumeFlowMultiplier: 0 })));
    const ahead = lastVolume(run(input(gentle, { scaleConnected: false, volumeFlowMultiplier: 3 })));
    expect(plain).toBeGreaterThan(35.5);
    expect(ahead).toBeLessThan(plain - 3);
  });

  it("takes the target from the input over the profile's own (context.targetWaterVolume)", () => {
    const frames = run(input(gentle, { scaleConnected: false, targetVolume: 20 }));
    expect(stopEvent(frames).decision).toMatchObject({ reason: 'targetVolume', data: { targetVolume: 20 } });
    expect(lastVolume(frames)).toBeLessThanOrEqual(20);
    expect(lastVolume(frames)).toBeGreaterThan(17);
  });

  it('a null or 0 target is off', () => {
    for (const targetVolume of [null, 0]) {
      expect(stopEvent(run(input(gentle, { scaleConnected: false, targetVolume }))).decision!.reason, String(targetVolume)).toBe('machineEnded');
    }
  });

  it('never applies while a scale reports: that is stop-at-weight territory, even with targetYield 0', () => {
    expect(stopEvent(run(input(gentle, { targetYield: 0 }))).decision!.reason).toBe('machineEnded');
    expect(stopEvent(run(input(gentle))).decision!.reason).toBe('targetWeight');
  });

  it('never applies in gatewayMode "full"', () => {
    expect(stopEvent(run(input(gentle, { scaleConnected: false, bypassSaw: true }))).decision!.reason).toBe('machineEnded');
  });

  it('counts from volumeCountStart when the workflow profile counts from elsewhere than the running one', () => {
    const frames = run(input(gentle, { scaleConnected: false, volumeCountStart: 4 }));
    expect(recorded(frames).filter((f) => f.machine.profileFrame < 4).every((f) => f.volume === 0)).toBe(true);
    expect(stopEvent(frames).decision!.reason).toBe('targetVolume');
    // The substate still follows the running profile's own count start.
    expect(recorded(frames).some((f) => f.machine.profileFrame === 2 && f.machine.state.substate === 'pouring')).toBe(true);
  });
});

describe('createShotPlayer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(options: Parameters<typeof createMockDecaid>[0] = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const state = createMockDecaid({ seedExamples: false, ...options });
    const player = createShotPlayer(state, { speed: 10 });
    const machine: MachineSnapshot[] = [];
    const shotStates: ShotStateEvent[] = [];
    state.on('machine', (frame) => machine.push(frame));
    state.on('shotState', (frame) => shotStates.push(frame));
    return { state, player, machine, shotStates };
  }

  it('plays the active profile, compressed in wall time, and persists a ShotRecord', async () => {
    const { state, player, machine, shotStates } = setup();
    expect(player.start()).toBe(true);
    expect(player.activity).toBe('espresso');
    await vi.advanceTimersByTimeAsync(2000);
    expect(machine.length).toBeGreaterThan(50);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.activity).toBeNull();

    const shotId = player.lastShotId!;
    expect(shotStates.map((e) => e.state)).toEqual(expect.arrayContaining(['preheating', 'pouring', 'stopping', 'finished']));
    expect(shotStates.at(-1)).toMatchObject({ state: 'idle', shotId: null });
    expect(shotStates.find((e) => e.state === 'finished')!.shotId).toBe(shotId);

    const record = state.getShot(shotId);
    expect(state.getLatestShot()!.id).toBe(shotId);
    expect(record.stopReason).toBe('targetWeight');
    expect(record.workflow.profile).toEqual(state.getWorkflow().profile);
    expect((record.workflow as { machine?: unknown }).machine).toMatchObject({ provenanceStatus: 'captured', model: 'DE1Pro' });
    const last = record.measurements.at(-1)!;
    // extras is D6's visualizer stamp, which can also have landed by now; strip it to keep
    // this check about dose and yield only.
    const { extras: _extras, ...coreAnnotations } = record.annotations ?? {};
    expect(coreAnnotations).toEqual({ actualDoseWeight: 18, actualYield: state.getScaleSnapshot()!.weight });
    expect(record.measurements[0]!.machine.state.substate).toBe('preparingForShot');
    const start = parseDecaidTimestamp(record.measurements[0]!.machine.timestamp);
    expect(parseDecaidTimestamp(record.timestamp) - start).toBeGreaterThan(0);
    expect(parseDecaidTimestamp(record.timestamp) - start).toBeLessThan(20);
    expect(record.createdAt).toMatch(/Z$/);
    expect(state.getMachineSnapshot().state).toEqual({ state: 'idle', substate: 'idle' });
    expect(state.lastProfileFrame).toBe(last.machine.profileFrame);
  });

  it("records the cup's settled weight as the yield: what the scale reads once the stopping tail's drips are in", async () => {
    const { state, player } = setup();
    const weights: number[] = [];
    state.on('scale', (frame) => {
      if ('weight' in frame) weights.push(frame.weight);
    });
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(player.activity).toBeNull();

    const record = state.getShot(player.lastShotId!);
    const lastRecorded = record.measurements.at(-1)!.scale!.weight;
    const settled = weights.at(-1)!;
    // Decaid's actualYield is the cup after the drips, not the weight when the stop was decided.
    expect(settled).toBeGreaterThan(lastRecorded + 0.4);
    expect(record.annotations?.actualYield).toBe(settled);
    // The panel's last reading and the shot card agree.
    expect(state.getScaleSnapshot()!.weight).toBe(settled);
  });

  it('records no yield without a scale', async () => {
    const { state, player } = setup({ scaleConnected: false });
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    // extras is D6's visualizer stamp, which can also have landed by now; strip it so this
    // still checks that actualYield specifically is absent.
    const { extras: _extras, ...coreAnnotations } = state.getShot(player.lastShotId!).annotations ?? {};
    expect(coreAnnotations).toEqual({ actualDoseWeight: 18 });
  });

  it('stays in stopping for about 4 s (wall time divided by the speed) and stores the shot only after it', async () => {
    const { state, player } = setup();
    const seen: Array<{ state: string; wallMs: number; dataMs: number; shots: number }> = [];
    state.on('shotState', (event) => {
      if (event.event !== 'state' || (event.state !== 'stopping' && event.state !== 'finished')) return;
      seen.push({ state: event.state, wallMs: Date.now(), dataMs: parseDecaidTimestamp(event.timestamp), shots: state.getShotIds().length });
    });
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);

    expect(seen.map((entry) => entry.state)).toEqual(['stopping', 'finished']);
    const [stopping, finished] = seen as [(typeof seen)[number], (typeof seen)[number]];
    expect((finished.dataMs - stopping.dataMs) / 1000).toBeCloseTo(4, 1);
    expect(finished.wallMs - stopping.wallMs).toBe(4000 / player.speed);
    expect(stopping.shots, 'no record while Decaid is still stopping').toBe(0);
    expect(state.getShotIds()).toEqual([player.lastShotId]);
  });

  it('data timestamps stay realistic at any speed', async () => {
    const { player, machine } = setup();
    player.setSpeed(100);
    player.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.activity).toBeNull();
    const span = parseDecaidTimestamp(machine.at(-1)!.timestamp) - parseDecaidTimestamp(machine[0]!.timestamp);
    expect(span / 1000).toBeGreaterThan(20);
  });

  it('idle during a shot stops it with apiStop', async () => {
    const { state, player } = setup();
    player.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(player.activity).toBe('espresso');
    player.command('idle');
    await vi.advanceTimersByTimeAsync(2000);
    expect(player.activity).toBeNull();
    expect(state.getShot(player.lastShotId!).stopReason).toBe('apiStop');
  });

  it('idle during preheat aborts and records nothing', async () => {
    const { state, player, shotStates } = setup();
    player.start();
    await vi.advanceTimersByTimeAsync(60);
    player.command('idle');
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.getShotIds()).toEqual([]);
    expect(shotStates.some((e) => e.decision?.kind === 'abort')).toBe(true);
    expect(shotStates.at(-1)!.state).toBe('idle');
  });

  it('steam, flush and hot water run for a few seconds and return to idle', async () => {
    for (const name of ['steam', 'flush', 'hotWater'] as const) {
      const { player, machine } = setup();
      player.command(name);
      expect(player.activity).toBe(name);
      await vi.advanceTimersByTimeAsync(800);
      expect(player.activity).toBeNull();
      expect(machine.some((f) => f.state.state === name && f.state.substate === 'pouring')).toBe(true);
      expect(machine.at(-1)!.state).toEqual({ state: 'idle', substate: 'idle' });
      vi.useRealTimers();
    }
  });

  it('sleeping and idle toggle sleep', () => {
    const { state, player } = setup();
    player.command('sleeping');
    expect(state.getMachineSnapshot().state.state).toBe('sleeping');
    player.command('idle');
    expect(state.getMachineSnapshot().state.state).toBe('idle');
  });

  it('tare zeroes the scale', () => {
    const { state, player } = setup();
    state.setScaleWeight({ timestamp: '2026-10-03T08:00:00.000000', weight: 312.4, weightFlow: 0, battery: 80, timerValue: null });
    player.tare();
    expect(state.getScaleSnapshot()!.weight).toBe(0);
  });

  it('a machine that drops mid-shot ends the shot without a record', async () => {
    const { state, player, shotStates } = setup();
    player.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(player.activity).toBe('espresso');
    state.setMachineConnected(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(player.activity).toBeNull();
    expect(state.getShotIds()).toEqual([]);
    expect(shotStates.some((e) => e.event === 'terminal' && e.decision?.reason === 'disconnected')).toBe(true);
  });

  it('will not start without a machine', () => {
    const { state, player } = setup({ machineConnected: false });
    expect(player.start()).toBe(false);
    expect(state.getShotIds()).toEqual([]);
  });

  /** The workflow profile at 80 °C under a new title: easy to tell apart in the frames. */
  function cooler(state: ReturnType<typeof setup>['state']) {
    const profile = state.getWorkflow().profile;
    return { ...profile, title: 'Guji Hambela v2', steps: profile.steps.map((step) => ({ ...step, temperature: 80 })) };
  }
  const targetTemps = (record: { measurements: Array<{ machine: MachineSnapshot }> }) =>
    record.measurements.filter((m) => m.machine.state.substate !== 'preparingForShot').map((m) => m.machine.targetGroupTemperature);

  it('a shot started on the machine during an upload runs the old profile, while its record names the new one', async () => {
    const { state, player } = setup();
    const old = state.getMachineProfile();
    state.updateWorkflow({ profile: cooler(state) });
    expect(state.isUploadingProfile()).toBe(true);
    expect(player.start(), 'a group-head press does not wait for the upload').toBe(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(player.activity).toBeNull();

    const record = state.getShot(player.lastShotId!);
    expect(record.workflow.profile.title, 'the record copies the workflow at shot end').toBe('Guji Hambela v2');
    const temps = targetTemps(record);
    expect(temps.length).toBeGreaterThan(20);
    expect(temps.every((t) => t !== 80)).toBe(true);
    expect(new Set(temps)).toEqual(new Set(old.steps.map((step) => step.temperature)));
    expect(state.getMachineProfile().title, 'the upload finished meanwhile').toBe('Guji Hambela v2');
  });

  it('a shot started after the upload runs the new profile', async () => {
    const { state, player } = setup();
    state.updateWorkflow({ profile: cooler(state) });
    await vi.advanceTimersByTimeAsync(800);
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(targetTemps(state.getShot(player.lastShotId!)).every((t) => t === 80)).toBe(true);
  });

  it("without a scale it stops at the workflow profile's target_volume and the machine goes idle", async () => {
    const { state, player, machine } = setup({ scaleConnected: false });
    expect(state.getWorkflow().profile.target_volume).toBe(36);
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    const record = state.getShot(player.lastShotId!);
    expect(record.stopReason).toBe('targetVolume');
    expect(record.measurements.at(-1)!.volume).toBeGreaterThan(33);
    expect(record.measurements.at(-1)!.volume).toBeLessThanOrEqual(36);
    expect(state.getMachineSnapshot().state).toEqual({ state: 'idle', substate: 'idle' });
    expect(machine.at(-1)!.state).toEqual({ state: 'idle', substate: 'idle' });
  });

  it("context.targetWaterVolume overrides the profile's target_volume", async () => {
    const { state, player } = setup({ scaleConnected: false });
    state.updateWorkflow({ context: { targetWaterVolume: 20 } });
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    const record = state.getShot(player.lastShotId!);
    expect(record.stopReason).toBe('targetVolume');
    expect(record.measurements.at(-1)!.volume).toBeLessThanOrEqual(20);
    expect(record.measurements.at(-1)!.volume).toBeGreaterThan(16);
  });

  it("uses Decaid's volumeFlowMultiplier setting for the look-ahead", async () => {
    const first = setup({ scaleConnected: false, settings: { volumeFlowMultiplier: 0 } });
    first.player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    const plain = first.state.getShot(first.player.lastShotId!).measurements.at(-1)!.volume!;
    vi.useRealTimers();
    const second = setup({ scaleConnected: false, settings: { volumeFlowMultiplier: 3 } });
    second.player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    const ahead = second.state.getShot(second.player.lastShotId!).measurements.at(-1)!.volume!;
    expect(ahead).toBeLessThan(plain - 3);
  });

  it("the group target follows the machine's profile: its first step idle, the running step's in a shot, and back after", async () => {
    const { state, player, machine } = setup();
    // Idle with the workflow's profile on the machine: Guji Hambela v1 starts at 91 °C.
    expect(state.getMachineProfile().steps[0]!.temperature).toBe(91);
    expect(state.getMachineSnapshot().targetGroupTemperature).toBe(91);

    // A profile that starts hotter: once the machine holds it, its first step is the target.
    const profile = state.getWorkflow().profile;
    const steps = profile.steps.map((step, i) => ({ ...step, temperature: i === 0 ? 94 : 92.5 }));
    state.updateWorkflow({ profile: { ...profile, title: 'Guji Hambela v2', steps } });
    expect(state.getMachineSnapshot().targetGroupTemperature, 'not before the machine has it').toBe(91);
    await vi.advanceTimersByTimeAsync(800);
    expect(state.getMachineProfile().title).toBe('Guji Hambela v2');
    expect(state.getMachineSnapshot().targetGroupTemperature).toBe(94);
    player.startIdleFrames(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(machine.at(-1)!).toMatchObject({ state: { state: 'idle' }, targetGroupTemperature: 94 });
    expect(machine.at(-1)!.groupTemperature).toBeGreaterThan(92.5);

    // In the shot: the step that runs.
    machine.length = 0;
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(player.activity).toBeNull();
    const brewing = machine.filter((frame) => frame.state.state === 'espresso' && frame.state.substate !== 'pouringDone');
    expect(brewing.filter((frame) => frame.profileFrame === 0 && frame.state.substate !== 'preparingForShot').every((f) => f.targetGroupTemperature === 94)).toBe(true);
    expect(brewing.filter((frame) => frame.profileFrame >= 1).every((f) => f.targetGroupTemperature === 92.5)).toBe(true);
    expect(brewing.some((frame) => frame.profileFrame >= 1)).toBe(true);

    // Done: back to the idle target as soon as the machine is idle, and in every idle frame after.
    const after = machine.filter((frame) => frame.state.state === 'idle');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((frame) => frame.targetGroupTemperature === 94)).toBe(true);
    expect(state.getMachineSnapshot().targetGroupTemperature).toBe(94);
    await vi.advanceTimersByTimeAsync(1000);
    expect(machine.at(-1)!.targetGroupTemperature).toBe(94);
    player.dispose();
  });

  it('settles back to the idle target after a shot without a scale too (no stopping tail)', async () => {
    const { state, player, machine } = setup({ scaleConnected: false });
    const profile = state.getWorkflow().profile;
    // Every step after the first runs hotter, so a target left over from the shot shows.
    const steps = profile.steps.map((step, i) => ({ ...step, temperature: i === 0 ? 90 : 96 }));
    state.updateWorkflow({ profile: { ...profile, title: 'Guji Hambela v3', steps } });
    await vi.advanceTimersByTimeAsync(800);
    player.start();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(machine.at(-1)!).toMatchObject({ state: { state: 'idle' }, targetGroupTemperature: 90 });
    expect(state.getMachineSnapshot().targetGroupTemperature).toBe(90);
  });

  it('emits idle frames on request, and whenIdle resolves after a shot', async () => {
    const { player, machine } = setup();
    player.startIdleFrames(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(machine.length).toBe(3);
    player.start();
    const idle = player.whenIdle();
    await vi.advanceTimersByTimeAsync(12_000);
    await idle;
    player.dispose();
  });

  describe('time-to-ready (D5)', () => {
    it('ticks once a second (at speed 1): insufficient_data, then a heating countdown', async () => {
      const { state, player } = setup();
      const frames: Array<{ status: string; remainingTimeMs: number | null }> = [];
      state.on('timeToReady', (frame) => frames.push(frame));
      await vi.advanceTimersByTimeAsync(500); // 5 ticks at speed 10 (100 ms/tick)
      expect(frames).toHaveLength(5);
      expect(frames[0]).toEqual({ status: 'insufficient_data', remainingTimeMs: null });
      expect(frames[1]).toEqual({ status: 'insufficient_data', remainingTimeMs: null });
      expect(frames[2]).toEqual({ status: 'heating', remainingTimeMs: 150_000 });
      expect(frames[3]).toEqual({ status: 'heating', remainingTimeMs: 145_000 });
      expect(frames[4]).toEqual({ status: 'heating', remainingTimeMs: 140_000 });
      player.dispose();
    });

    it('reaches, then keeps reporting reached for as long as the machine stays awake', async () => {
      const { state, player } = setup();
      const frames: Array<{ status: string; remainingTimeMs: number | null }> = [];
      state.on('timeToReady', (frame) => frames.push(frame));
      // 2 insufficient_data ticks + 30 heating ticks (150000 / 5000) = 32 ticks to reach, at 100 ms/tick.
      await vi.advanceTimersByTimeAsync(3300);
      expect(frames.at(-1)).toEqual({ status: 'reached', remainingTimeMs: 0 });
      const countAtReach = frames.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(frames.length).toBeGreaterThan(countAtReach);
      expect(frames.every((f, i) => i < countAtReach || (f.status === 'reached' && f.remainingTimeMs === 0))).toBe(true);
      player.dispose();
    });

    it('a late subscriber hears the current status within one tick', async () => {
      const { state, player } = setup();
      await vi.advanceTimersByTimeAsync(3300); // past reached, before anyone is listening
      const frames: Array<{ status: string }> = [];
      state.on('timeToReady', (frame) => frames.push(frame));
      await vi.advanceTimersByTimeAsync(100); // one tick at speed 10
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ status: 'reached' });
      player.dispose();
    });

    it('emits nothing while sleeping, and restarts from insufficient_data on waking', async () => {
      const { state, player } = setup();
      const frames: Array<{ status: string; remainingTimeMs: number | null }> = [];
      state.on('timeToReady', (frame) => frames.push(frame));
      await vi.advanceTimersByTimeAsync(350); // past the two insufficient_data ticks, into heating
      expect(frames.some((f) => f.status === 'heating')).toBe(true);
      player.command('sleeping');
      frames.length = 0;
      await vi.advanceTimersByTimeAsync(500); // several ticks' worth, all asleep
      expect(frames).toEqual([]);
      player.command('idle');
      await vi.advanceTimersByTimeAsync(250);
      expect(frames[0]).toEqual({ status: 'insufficient_data', remainingTimeMs: null });
      player.dispose();
    });

    it('does not run when time-to-ready.reaplugin is not loaded', async () => {
      const { state, player } = setup({ loadedPlugins: [] });
      const frames: unknown[] = [];
      state.on('timeToReady', (frame) => frames.push(frame));
      await vi.advanceTimersByTimeAsync(3300);
      expect(frames).toEqual([]);
      player.dispose();
    });
  });

  describe('skip step (D8)', () => {
    it('command("skipStep") during a shot advances the profile frame', async () => {
      const { state, player } = setup();
      player.start();
      // setup() plays at speed 10, so each 200 ms frame is 20 ms of wall time: 220 ms clears
      // the 10-frame preheat and lands just inside the profile's own steps.
      await vi.advanceTimersByTimeAsync(220);
      const before = state.getMachineSnapshot().profileFrame;
      player.command('skipStep');
      await vi.advanceTimersByTimeAsync(20); // the next tick applies the skip
      expect(state.getMachineSnapshot().profileFrame).toBeGreaterThan(before);
      player.dispose();
    });

    it('is a no-op outside a shot', () => {
      const { player } = setup();
      expect(player.activity).toBeNull();
      player.command('skipStep');
      expect(player.activity).toBeNull();
    });
  });

  describe('visualizer upload (D6)', () => {
    it('writes lastUploadedShot and lastVisualizerId, and stamps the shot itself, a few seconds after it finishes', async () => {
      const { state, player } = setup();
      player.start();
      while (player.activity !== null) await vi.advanceTimersByTimeAsync(100);
      const shotId = player.lastShotId!;
      expect(state.kvGet('visualizer.reaplugin', 'lastUploadedShot')).toBeNull();
      expect(state.kvGet('visualizer.reaplugin', 'lastVisualizerId')).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.kvGet('visualizer.reaplugin', 'lastUploadedShot')).toBe(shotId);
      const visualizerId = state.kvGet('visualizer.reaplugin', 'lastVisualizerId');
      expect(typeof visualizerId).toBe('number');
      expect(state.getShot(shotId).annotations?.extras?.visualizerId).toBe(String(visualizerId));
      player.dispose();
    });

    it('gives each upload its own, increasing visualizer id', async () => {
      const { state, player } = setup();
      player.start();
      while (player.activity !== null) await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1000);
      const first = state.kvGet('visualizer.reaplugin', 'lastVisualizerId') as number;
      player.start();
      while (player.activity !== null) await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1000);
      const second = state.kvGet('visualizer.reaplugin', 'lastVisualizerId') as number;
      expect(second).toBeGreaterThan(first);
      player.dispose();
    });

    it('does not write anything when visualizer.reaplugin is not loaded', async () => {
      const { state, player } = setup({ loadedPlugins: [] });
      player.start();
      while (player.activity !== null) await vi.advanceTimersByTimeAsync(100);
      const shotId = player.lastShotId!;
      await vi.advanceTimersByTimeAsync(2000);
      expect(state.kvGet('visualizer.reaplugin', 'lastUploadedShot')).toBeNull();
      expect(state.kvGet('visualizer.reaplugin', 'lastVisualizerId')).toBeNull();
      expect(state.getShot(shotId).annotations?.extras?.visualizerId).toBeUndefined();
      player.dispose();
    });
  });
});

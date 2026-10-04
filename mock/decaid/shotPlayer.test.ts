import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDecaidTimestamp } from '../../src/api/time.ts';
import type { MachineSnapshot, ShotStateEvent } from '../../src/api/types.ts';
import blooming from '../../src/coach/templates/source/Blooming_espresso.json';
import dflow from '../../src/coach/templates/source/D-Flow____default.json';
import gentle from '../../src/coach/templates/source/Gentle_and_sweet1.json';
import londonium from '../../src/coach/templates/source/Londonium.json';
import allonge from '../../src/coach/templates/source/rao_allonge.json';
import { normalizeProfile } from './profiles.ts';
import { createShotPlayer, createShotSimulation, type ShotSimulationInput, type SimFrame } from './shotPlayer.ts';
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
    expect(record.annotations).toEqual({ actualDoseWeight: 18, actualYield: Math.round((last.scale!.weight + 0.4) * 10) / 10 });
    expect(record.measurements[0]!.machine.state.substate).toBe('preparingForShot');
    const start = parseDecaidTimestamp(record.measurements[0]!.machine.timestamp);
    expect(parseDecaidTimestamp(record.timestamp) - start).toBeGreaterThan(0);
    expect(parseDecaidTimestamp(record.timestamp) - start).toBeLessThan(20);
    expect(record.createdAt).toMatch(/Z$/);
    expect(state.getMachineSnapshot().state).toEqual({ state: 'idle', substate: 'idle' });
    expect(state.lastProfileFrame).toBe(last.machine.profileFrame);
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
});

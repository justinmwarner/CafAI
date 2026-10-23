import { describe, expect, it } from 'vitest';
import type { MachineFrame, ShotSettings } from '../../../api/types.ts';
import { IDLE_TELEMETRY, SAMPLE_WORKFLOW } from '../../testing/fakeServices.ts';
import type { DrinkPresets } from '../drinkModel.ts';
import type { DrinkRun } from '../drinkTrace.ts';
import type { DrinkKind } from '../kinds.ts';
import { sceneInput, sceneSets } from './sceneInput.ts';
import type { SceneSets } from './types.ts';

const PRESETS: DrinkPresets = { steamSettings: SAMPLE_WORKFLOW.steamSettings, hotWaterData: SAMPLE_WORKFLOW.hotWaterData, rinseData: SAMPLE_WORKFLOW.rinseData };
const SHOT_SETTINGS: ShotSettings = {
  steamSetting: 0,
  targetSteamTemp: 155,
  targetSteamDuration: 45,
  targetHotWaterTemp: 80,
  targetHotWaterVolume: 120,
  targetHotWaterDuration: 40,
  targetShotVolume: 0,
  groupTemp: 93,
};
const NO_SETS: SceneSets = { flow: null, temperature: null };

const machine = (state: string, substate: string, values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  state: { state, substate },
  ...values,
});

function run(kind: DrinkKind, overrides: Partial<DrinkRun> = {}): DrinkRun {
  return {
    kind,
    id: 1,
    live: true,
    lost: false,
    t: [],
    flow: [],
    pressure: [],
    steamTemperature: [],
    groupTemperature: [],
    weight: [],
    working: [],
    latest: null,
    elapsedS: 0,
    waterMl: 0,
    ...overrides,
  };
}

/** A run of `kind` now in `state`/`substate`, its newest frame reading `values`. */
const at = (kind: DrinkKind, state: string, substate: string, values: Partial<MachineFrame> = {}, overrides: Partial<DrinkRun> = {}) =>
  run(kind, { latest: machine(state, substate, values), ...overrides });

describe('sceneInput', () => {
  it("names each of steam's phases from the machine's state and substate", () => {
    const phase = (state: string, substate: string) => sceneInput('steam', at('steam', state, substate), 50, NO_SETS).phase;
    expect(phase('steam', 'preparingForShot')).toBe('heating');
    expect(phase('steam', 'pouring')).toBe('working');
    // Decaid's simulator steams in substate idle.
    expect(phase('steam', 'idle')).toBe('working');
    expect(phase('steam', 'pausedSteam')).toBe('paused');
    expect(phase('steam', 'puffing')).toBe('purging');
    expect(phase('steamRinse', 'idle')).toBe('rinsing');
  });

  it("names hot water's and flush's: heating, then working", () => {
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'preparingForShot'), 200, NO_SETS).phase).toBe('heating');
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring'), 200, NO_SETS).phase).toBe('working');
    expect(sceneInput('flush', at('flush', 'flush', 'preparingForShot'), 10, NO_SETS).phase).toBe('heating');
    expect(sceneInput('flush', at('flush', 'flush', 'pouring'), 10, NO_SETS).phase).toBe('working');
  });

  it('is idle without a run, done once it ends, and lost when the machine went away', () => {
    const idle = sceneInput('steam', null, 50, NO_SETS);
    expect(idle).toMatchObject({ phase: 'idle', live: false, progress: 0, strength: 0 });
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', {}, { live: false }), 50, NO_SETS)).toMatchObject({ phase: 'done', live: false });
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', {}, { live: false, lost: true }), 10, NO_SETS)).toMatchObject({ phase: 'lost', live: false });
  });

  it('is live while the machine heats, works, pauses, purges or rinses', () => {
    for (const [state, substate] of [
      ['steam', 'preparingForShot'],
      ['steam', 'pouring'],
      ['steam', 'pausedSteam'],
      ['steam', 'puffing'],
      ['steamRinse', 'idle'],
    ] as const) {
      expect(sceneInput('steam', at('steam', state, substate), 50, NO_SETS).live).toBe(true);
    }
  });

  it("goes as far as the dial's share: the drink's time, or hot water's volume, over its target", () => {
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', {}, { elapsedS: 12.5 }), 50, NO_SETS).progress).toBe(0.25);
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', {}, { elapsedS: 5 }), 10, NO_SETS).progress).toBe(0.5);
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring', {}, { elapsedS: 3, waterMl: 150 }), 200, NO_SETS).progress).toBe(0.75);
    // Past the target, as a run stopped late is, the share is whole.
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', {}, { elapsedS: 62 }), 50, NO_SETS).progress).toBe(1);
  });

  it('goes by a typical run of the drink without a target: 45 s of steam, 30 s of hot water, a 10 s flush', () => {
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', {}, { elapsedS: 9 }), null, NO_SETS).progress).toBeCloseTo(0.2, 6);
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring', {}, { elapsedS: 15, waterMl: 140 }), null, NO_SETS).progress).toBe(0.5);
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', {}, { elapsedS: 2.5 }), null, NO_SETS).progress).toBe(0.25);
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', {}, { elapsedS: 25 }), null, NO_SETS).progress).toBe(1);
  });

  it('steams as hard as set at the set flow and 1.8 bar, and at most 2.2 however hard the machine works', () => {
    const sets: SceneSets = { flow: 0.8, temperature: 150 };
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', { flow: 0.8, pressure: 1.8 }), 50, sets).strength).toBeCloseTo(1, 6);
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', { flow: 0.4, pressure: 1.8 }), 50, sets).strength).toBeCloseTo(0.5, 6);
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', { flow: 1.6, pressure: 3.6 }), 50, sets).strength).toBe(2.2);
  });

  it('does no work while the heater warms, steam pauses or the wand purges, and none once it is over', () => {
    const values = { flow: 0.8, pressure: 1.8 };
    for (const [state, substate] of [
      ['steam', 'preparingForShot'],
      ['steam', 'pausedSteam'],
      ['steam', 'puffing'],
      ['steamRinse', 'idle'],
    ] as const) {
      expect(sceneInput('steam', at('steam', state, substate, values), 50, NO_SETS).strength).toBe(0);
    }
    expect(sceneInput('steam', at('steam', 'steam', 'pouring', values, { live: false }), 50, NO_SETS).strength).toBe(0);
  });

  it("reads the water drinks' strength as their flow against the flow set", () => {
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring', { flow: 5 }), 200, { flow: 10, temperature: 85 }).strength).toBe(0.5);
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', { flow: 9 }), 10, { flow: 6, temperature: 93 }).strength).toBe(1.5);
    // A flow set nobody gave is Decaid's default: 10 ml/s for hot water, 6 for the flush.
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring', { flow: 12 }), 200, NO_SETS).strength).toBeCloseTo(1.2, 6);
    expect(sceneInput('flush', at('flush', 'flush', 'pouring', { flow: 3 }), 10, NO_SETS).strength).toBe(0.5);
  });

  it('reads a reading the machine did not send as the set one, so a missing number never jolts a scene', () => {
    const steam = sceneInput('steam', at('steam', 'steam', 'pouring', { flow: null, pressure: null, steamTemperature: null }), 50, { flow: 0.9, temperature: 160 });
    expect(steam.strength).toBe(1);
    expect(steam.heat).toBe(1);
    // Nothing set either: Decaid's defaults, 0.8 ml/s and 150 °C.
    const unset = sceneInput('steam', at('steam', 'steam', 'pouring', { flow: null, pressure: null, steamTemperature: null }), 50, NO_SETS);
    expect(unset.strength).toBe(1);
    expect(unset.heat).toBe(1);
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring', { flow: null }), 200, { flow: 8, temperature: 85 }).strength).toBe(1);
  });

  it("follows steam's heater against its set: 30 °C under it is cold, and it never steams less than a fifth or more than 1.15", () => {
    const heat = (steamTemperature: number | null) =>
      sceneInput('steam', at('steam', 'steam', 'pouring', { steamTemperature }), 50, { flow: 0.8, temperature: 150 }).heat;
    expect(heat(150)).toBe(1);
    expect(heat(135)).toBe(0.5);
    expect(heat(120)).toBe(0.2);
    expect(heat(90)).toBe(0.2);
    expect(heat(170)).toBe(1.15);
  });

  it("warms steam's milk with its time, and colours hot water by its temperature set, 40 °C cold to 95 °C warm", () => {
    const steam = sceneInput('steam', at('steam', 'steam', 'pouring', {}, { elapsedS: 20 }), 50, NO_SETS);
    expect(steam.warmth).toBe(steam.progress);
    expect(steam.warmth).toBe(0.4);
    const cool = sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring'), 200, { flow: 10, temperature: 40 });
    expect(cool.heat).toBe(0);
    expect(cool.warmth).toBe(0);
    const hot = sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring'), 200, { flow: 10, temperature: 95 });
    expect(hot.heat).toBe(1);
    expect(hot.warmth).toBe(1);
    // Nothing set: 85 °C.
    expect(sceneInput('hotWater', at('hotWater', 'hotWater', 'pouring'), 200, NO_SETS).heat).toBeCloseTo(45 / 55, 6);
  });

  it("colours the flush by the group against its target: 20 °C under it is cold, at it warm", () => {
    const flush = (groupTemperature: number | null, temperature: number | null = 93) =>
      sceneInput('flush', at('flush', 'flush', 'pouring', { groupTemperature }), 10, { flow: 6, temperature });
    expect(flush(73).heat).toBe(0);
    expect(flush(83).heat).toBe(0.5);
    expect(flush(93).heat).toBe(1);
    expect(flush(98).heat).toBe(1);
    expect(flush(93).warmth).toBe(1);
    expect(flush(60).warmth).toBe(0);
    // A target nobody gave is 93 °C; a group the machine did not report reads cold.
    expect(flush(83, null).heat).toBe(0.5);
    expect(flush(null).heat).toBe(0);
  });
});

describe('sceneSets', () => {
  it("reads steam's flow from the workflow and its temperature from the machine's live settings first", () => {
    expect(sceneSets('steam', SHOT_SETTINGS, PRESETS, null)).toEqual({ flow: 0.8, temperature: 155 });
    expect(sceneSets('steam', null, PRESETS, null)).toEqual({ flow: 0.8, temperature: 150 });
    // Steam set below 135 °C is steam turned off: no temperature to follow.
    expect(sceneSets('steam', { ...SHOT_SETTINGS, targetSteamTemp: 0 }, { ...PRESETS, steamSettings: { ...PRESETS.steamSettings, targetTemperature: 120 } }, null)).toEqual({
      flow: 0.8,
      temperature: null,
    });
  });

  it("reads hot water's from the live settings first, then the workflow", () => {
    expect(sceneSets('hotWater', SHOT_SETTINGS, PRESETS, null)).toEqual({ flow: 10, temperature: 80 });
    expect(sceneSets('hotWater', null, PRESETS, null)).toEqual({ flow: 10, temperature: 75 });
  });

  it("reads the flush's target from the machine's frame first, then the workflow's", () => {
    expect(sceneSets('flush', SHOT_SETTINGS, PRESETS, machine('flush', 'pouring', { targetGroupTemperature: 94 }))).toEqual({ flow: 6, temperature: 94 });
    expect(sceneSets('flush', SHOT_SETTINGS, PRESETS, machine('flush', 'pouring', { targetGroupTemperature: null }))).toEqual({ flow: 6, temperature: 90 });
    expect(sceneSets('flush', null, PRESETS, null)).toEqual({ flow: 6, temperature: 90 });
  });

  it('drops a set of zero, below zero or not a number, falling back to the next or to none', () => {
    const broken: DrinkPresets = {
      steamSettings: { targetTemperature: Number.NaN, duration: 50, flow: 0 },
      hotWaterData: { targetTemperature: -5, duration: 30, volume: 50, flow: Number.NaN },
      rinseData: { targetTemperature: 0, duration: 10, flow: -1 },
    };
    expect(sceneSets('steam', null, broken, null)).toEqual({ flow: null, temperature: null });
    expect(sceneSets('hotWater', { ...SHOT_SETTINGS, targetHotWaterTemp: 0 }, broken, null)).toEqual({ flow: null, temperature: null });
    expect(sceneSets('hotWater', { ...SHOT_SETTINGS, targetHotWaterTemp: Number.NaN }, PRESETS, null)).toEqual({ flow: 10, temperature: 75 });
    expect(sceneSets('flush', null, broken, machine('flush', 'pouring', { targetGroupTemperature: 0 }))).toEqual({ flow: null, temperature: null });
    expect(sceneSets('steam', null, null, null)).toEqual({ flow: null, temperature: null });
  });
});

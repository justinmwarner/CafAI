import { describe, expect, it } from 'vitest';
import type { MachineFrame, ShotSettings } from '../../api/types.ts';
import { IDLE_TELEMETRY, SAMPLE_WORKFLOW } from '../testing/fakeServices.ts';
import {
  dialReading,
  drinkReadouts,
  drinkTarget,
  hotWaterTimeLimit,
  phaseWords,
  steamTemperatureSet,
  traceLines,
  traceSpan,
  type DrinkPresets,
  type ReadoutInput,
} from './drinkModel.ts';
import type { DrinkRun } from './drinkTrace.ts';

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
const machine = (state: string, substate: string, values: Partial<MachineFrame> = {}): MachineFrame => ({
  ...IDLE_TELEMETRY.machine!,
  state: { state, substate },
  ...values,
});

function run(overrides: Partial<DrinkRun> = {}): DrinkRun {
  return {
    kind: 'steam',
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

describe('phaseWords', () => {
  it('says nothing without a run, Done after one, and Connection lost when the machine went away', () => {
    expect(phaseWords('steam', null, null)).toBeNull();
    expect(phaseWords('steam', run({ live: false }), null)).toBe('Done');
    expect(phaseWords('flush', run({ live: false, lost: true }), null)).toBe('Connection lost');
  });

  it("names steam's phases", () => {
    const live = run();
    expect(phaseWords('steam', live, machine('steam', 'preparingForShot'))).toBe('Heating');
    expect(phaseWords('steam', live, machine('steam', 'pouring'))).toBe('Steaming');
    // Decaid's simulator steams in substate idle.
    expect(phaseWords('steam', live, machine('steam', 'idle'))).toBe('Steaming');
    expect(phaseWords('steam', live, machine('steam', 'pausedSteam'))).toBe('Paused');
    expect(phaseWords('steam', live, machine('steam', 'puffing'))).toBe('Purging');
    expect(phaseWords('steam', live, machine('steamRinse', 'idle'))).toBe('Rinsing the wand');
  });

  it("names hot water's and flush's", () => {
    expect(phaseWords('hotWater', run(), machine('hotWater', 'preparingForShot'))).toBe('Heating');
    expect(phaseWords('hotWater', run(), machine('hotWater', 'pouring'))).toBe('Pouring');
    expect(phaseWords('flush', run(), machine('flush', 'pouring'))).toBe('Flushing');
  });
});

describe('targets', () => {
  it("takes the machine's live settings first, then Decaid's workflow", () => {
    expect(drinkTarget('steam', SHOT_SETTINGS, PRESETS)).toBe(45);
    expect(drinkTarget('steam', null, PRESETS)).toBe(50);
    expect(drinkTarget('hotWater', SHOT_SETTINGS, PRESETS)).toBe(120);
    expect(drinkTarget('hotWater', null, PRESETS)).toBe(50);
    expect(drinkTarget('flush', SHOT_SETTINGS, PRESETS)).toBe(10);
    expect(hotWaterTimeLimit(SHOT_SETTINGS, PRESETS)).toBe(40);
    expect(hotWaterTimeLimit(null, PRESETS)).toBe(30);
  });

  it('gives none that nobody set, and none of 0', () => {
    expect(drinkTarget('steam', null, null)).toBeNull();
    expect(drinkTarget('flush', null, { ...PRESETS, rinseData: { ...PRESETS.rinseData, duration: 0 } })).toBeNull();
    expect(drinkTarget('hotWater', { ...SHOT_SETTINGS, targetHotWaterVolume: 0 }, null)).toBeNull();
  });

  it('gives the steam temperature set only while steam is on', () => {
    expect(steamTemperatureSet(SHOT_SETTINGS, PRESETS)).toBe(155);
    expect(steamTemperatureSet(null, PRESETS)).toBe(150);
    expect(steamTemperatureSet(null, { ...PRESETS, steamSettings: { ...PRESETS.steamSettings, targetTemperature: 0 } })).toBeNull();
  });
});

describe('dialReading', () => {
  it('counts steam and flush in tenths of a second, hot water in whole millilitres', () => {
    expect(dialReading('steam', run({ elapsedS: 23.44 }), 50)).toEqual({ number: '23.4', unit: 's', of: 'of 50 s', share: 23.44 / 50 });
    expect(dialReading('hotWater', run({ kind: 'hotWater', waterMl: 111.6 }), 200)).toEqual({ number: '112', unit: 'ml', of: 'of 200 ml', share: 111.6 / 200 });
  });

  it('caps the share at 1, and draws no share without a target', () => {
    expect(dialReading('flush', run({ kind: 'flush', elapsedS: 12 }), 10).share).toBe(1);
    expect(dialReading('flush', run({ kind: 'flush', elapsedS: 3 }), null)).toEqual({ number: '3.0', unit: 's', of: null, share: null });
  });

  it('shows a dash with no unit and no share before any run', () => {
    expect(dialReading('steam', null, 50)).toEqual({ number: '—', unit: null, of: 'of 50 s', share: null });
  });

  it('says how long a finished hot water took', () => {
    expect(dialReading('hotWater', run({ kind: 'hotWater', live: false, waterMl: 198, elapsedS: 38.62 }), 200).of).toBe('in 38.6 s');
  });
});

const input = (overrides: Partial<ReadoutInput> = {}): ReadoutInput => ({
  frame: machine('steam', 'pouring', { steamTemperature: 152, pressure: 1.94, flow: 0.81, groupTemperature: 91.84, targetGroupTemperature: 93 }),
  scaleWeight: 94.83,
  scaleConnected: true,
  shotSettings: null,
  presets: PRESETS,
  run: run(),
  ...overrides,
});

describe('drinkReadouts while it runs', () => {
  it('steam: the heater against the temperature set, its pressure and flow', () => {
    expect(drinkReadouts('steam', input())).toEqual([
      { key: 'steam', label: 'Steam', value: '152 °C', caption: 'set 150', swatch: null },
      { key: 'pressure', label: 'Pressure', value: '1.9 bar', caption: '', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: '0.8 ml/s', caption: 'set 0.8', swatch: 'flow' },
    ]);
  });

  it('hot water: its flow, the scale and the time against the limit', () => {
    const hot = input({ frame: machine('hotWater', 'pouring', { flow: 7.96 }), run: run({ kind: 'hotWater', elapsedS: 18.47 }) });
    expect(drinkReadouts('hotWater', hot)).toEqual([
      { key: 'flow', label: 'Flow', value: '8.0 ml/s', caption: 'set 10.0', swatch: 'flow' },
      { key: 'scale', label: 'Scale', value: '94.8 g', caption: 'in the cup', swatch: 'weight' },
      { key: 'time', label: 'Time', value: '18.5 s', caption: 'stops by 30 s', swatch: null },
    ]);
  });

  it('hot water without a scale says so, with a dash', () => {
    const readouts = drinkReadouts('hotWater', input({ scaleConnected: false, scaleWeight: null }));
    expect(readouts[1]).toEqual({ key: 'scale', label: 'Scale', value: '—', caption: 'No scale', swatch: null });
  });

  it('flush: the water so far, its flow and the group against its target', () => {
    const flush = input({ frame: machine('flush', 'pouring', { flow: 6.02, groupTemperature: 91.84, targetGroupTemperature: 93 }), run: run({ kind: 'flush', waterMl: 16.4 }) });
    expect(drinkReadouts('flush', flush)).toEqual([
      { key: 'water', label: 'Water', value: '16 ml', caption: 'so far', swatch: null },
      { key: 'flow', label: 'Flow', value: '6.0 ml/s', caption: 'set 6.0', swatch: 'flow' },
      { key: 'group', label: 'Group', value: '91.8 °C', caption: 'target 93.0', swatch: null },
    ]);
  });

  it('shows a dash for a reading the machine has not given, and while it is away', () => {
    const away = drinkReadouts('steam', input({ frame: null }));
    expect(away.map((r) => r.value)).toEqual(['—', '—', '—']);
  });
});

describe('drinkReadouts once it is done', () => {
  const doneSteam = run({
    live: false,
    t: [0, 1, 2, 3],
    working: [true, true, true, false],
    flow: [0.7, 0.9, 0.8, 0],
    pressure: [1.8, 2.0, 1.9, 0.9],
    steamTemperature: [151, 149, 148, 150],
  });

  it('steam: the heater at the end of the steaming, pressure and flow averaged over it', () => {
    expect(drinkReadouts('steam', input({ run: doneSteam }))).toEqual([
      { key: 'steam', label: 'Steam', value: '148 °C', caption: 'at the end', swatch: null },
      { key: 'pressure', label: 'Pressure', value: '1.9 bar', caption: 'average', swatch: 'pressure' },
      { key: 'flow', label: 'Flow', value: '0.8 ml/s', caption: 'average', swatch: 'flow' },
    ]);
  });

  it('hot water: flow averaged, the scale at the end, the time it took', () => {
    const hot = run({ kind: 'hotWater', live: false, elapsedS: 38.62, t: [0, 1], working: [true, true], flow: [5, 5.2], weight: [0, 195.24] });
    expect(drinkReadouts('hotWater', input({ run: hot }))).toEqual([
      { key: 'flow', label: 'Flow', value: '5.1 ml/s', caption: 'average', swatch: 'flow' },
      { key: 'scale', label: 'Scale', value: '195.2 g', caption: 'in the cup', swatch: 'weight' },
      { key: 'time', label: 'Time', value: '38.6 s', caption: '', swatch: null },
    ]);
  });

  it('flush: the water through the group, flow averaged, the group at the end', () => {
    const flush = run({
      kind: 'flush',
      live: false,
      waterMl: 41.2,
      t: [0, 1],
      working: [true, true],
      flow: [8, 8.2],
      groupTemperature: [91, 92.4],
      latest: machine('idle', 'idle', { targetGroupTemperature: 93 }),
    });
    expect(drinkReadouts('flush', input({ run: flush }))).toEqual([
      { key: 'water', label: 'Water', value: '41 ml', caption: 'through the group', swatch: null },
      { key: 'flow', label: 'Flow', value: '8.1 ml/s', caption: 'average', swatch: 'flow' },
      { key: 'group', label: 'Group', value: '92.4 °C', caption: 'target 93.0', swatch: null },
    ]);
  });
});

describe('the trace', () => {
  it("runs to the time set, the hot water's limit, or the run's own time, whichever is longest", () => {
    expect(traceSpan(run({ t: [0, 10] }), 50)).toBe(50);
    expect(traceSpan(run({ t: [0, 62] }), 50)).toBe(62);
    expect(traceSpan(null, null)).toBe(5);
  });

  it("draws steam's flow then pressure on one axis of at least 3", () => {
    const lines = traceLines('steam', run({ flow: [0.8], pressure: [2.4] }), null);
    expect(lines.map((l) => [l.key, l.yMax])).toEqual([
      ['flow', 3],
      ['pressure', 3],
    ]);
    expect(traceLines('steam', run({ flow: [0.8], pressure: [3.6] }), null)[1]!.yMax).toBe(4);
  });

  it("draws hot water's weight up to the volume set, under its flow, only when the scale read something", () => {
    const withScale = traceLines('hotWater', run({ kind: 'hotWater', flow: [8], weight: [12] }), 200);
    expect(withScale.map((l) => [l.key, l.yMax])).toEqual([
      ['weight', 200],
      ['flow', 10],
    ]);
    expect(traceLines('hotWater', run({ kind: 'hotWater', flow: [8], weight: [null] }), 200).map((l) => l.key)).toEqual(['flow']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  blocksDrinkSettings,
  clampDrinkField,
  HOT_WATER_DURATION,
  HOT_WATER_FIELDS,
  HOT_WATER_FLOW,
  HOT_WATER_TEMPERATURE,
  HOT_WATER_VOLUME,
  RINSE_DURATION,
  RINSE_FIELDS,
  RINSE_FLOW,
  RINSE_TEMPERATURE,
  steamFields,
  steamTemperatureField,
  STEAM_DURATION,
  STEAM_FLOW,
} from './drinkSettings.ts';

describe('clampDrinkField', () => {
  it('keeps a value already inside the range', () => {
    expect(clampDrinkField(steamTemperatureField(null), 150)).toBe(150);
    expect(clampDrinkField(HOT_WATER_FLOW, 10.5)).toBe(10.5);
  });

  it('clamps steam temperature to the DE1 range (135-160) when the model is unknown or not a Bengle', () => {
    expect(clampDrinkField(steamTemperatureField(null), 10)).toBe(135);
    expect(clampDrinkField(steamTemperatureField(null), 999)).toBe(160);
    expect(clampDrinkField(steamTemperatureField('DE1'), 999)).toBe(160);
    expect(clampDrinkField(steamTemperatureField('DE1Pro'), 999)).toBe(160);
  });

  it('clamps steam temperature to the wider Bengle range (135-165) only when the model says so', () => {
    expect(clampDrinkField(steamTemperatureField('Bengle'), 999)).toBe(165);
    expect(clampDrinkField(steamTemperatureField('Bengle'), 10)).toBe(135);
  });

  it('rounds an integer field to the nearest whole number', () => {
    expect(clampDrinkField(STEAM_DURATION, 50.6)).toBe(51);
    expect(clampDrinkField(HOT_WATER_VOLUME, 49.4)).toBe(49);
  });

  it('rounds a flow field to one decimal', () => {
    expect(clampDrinkField(STEAM_FLOW, 0.849)).toBe(0.8);
    expect(clampDrinkField(RINSE_FLOW, 6.28)).toBe(6.3);
  });

  it('caps hot water volume at 255: the DE1 write packs it into one unchecked byte', () => {
    expect(clampDrinkField(HOT_WATER_VOLUME, 300)).toBe(255);
    expect(clampDrinkField(HOT_WATER_VOLUME, 2000)).toBe(255);
  });

  it('clamps every other field to its own floor and ceiling', () => {
    expect(clampDrinkField(STEAM_DURATION, -5)).toBe(1);
    expect(clampDrinkField(STEAM_DURATION, 5000)).toBe(120);
    expect(clampDrinkField(HOT_WATER_TEMPERATURE, 0)).toBe(1);
    expect(clampDrinkField(HOT_WATER_TEMPERATURE, 150)).toBe(100);
    expect(clampDrinkField(HOT_WATER_VOLUME, -1)).toBe(1);
    expect(clampDrinkField(HOT_WATER_DURATION, 0)).toBe(1);
    expect(clampDrinkField(HOT_WATER_DURATION, 500)).toBe(120);
    expect(clampDrinkField(RINSE_DURATION, 0)).toBe(1);
    expect(clampDrinkField(RINSE_DURATION, 500)).toBe(30);
    expect(clampDrinkField(RINSE_TEMPERATURE, 0)).toBe(1);
    expect(clampDrinkField(RINSE_TEMPERATURE, 150)).toBe(100);
    expect(clampDrinkField(HOT_WATER_FLOW, 0)).toBe(0.1);
    expect(clampDrinkField(HOT_WATER_FLOW, 50)).toBe(15);
  });

  it('a non-finite value becomes the range minimum', () => {
    expect(clampDrinkField(steamTemperatureField(null), Number.NaN)).toBe(135);
    expect(clampDrinkField(HOT_WATER_VOLUME, Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('steamTemperatureField', () => {
  it('marks 0 as off, with a note, regardless of model', () => {
    expect(steamTemperatureField(null).offValue).toBe(0);
    expect(steamTemperatureField('Bengle').offValue).toBe(0);
    expect(steamTemperatureField(null).offNote).toBe('Steam is off in Decaid');
  });
});

describe('field lists', () => {
  it('orders steam as temperature, time, flow', () => {
    expect(steamFields(null).map((f) => f.label)).toEqual(['Steam temperature', 'Steam time', 'Steam flow']);
  });

  it('orders hot water as temperature, volume, time, flow', () => {
    expect(HOT_WATER_FIELDS.map((f) => f.label)).toEqual(['Hot water temperature', 'Hot water volume', 'Hot water time', 'Hot water flow']);
  });

  it('orders flush as time, temperature, flow', () => {
    expect(RINSE_FIELDS.map((f) => f.label)).toEqual(['Flush time', 'Flush temperature', 'Flush flow']);
  });

  it('marks temperature, time and volume fields as integers, and flow as not', () => {
    for (const field of [...steamFields(null), ...HOT_WATER_FIELDS, ...RINSE_FIELDS]) {
      expect(field.integer).toBe(field.label.endsWith('flow') ? false : true);
    }
  });
});

describe('blocksDrinkSettings', () => {
  it('blocks while a shot, steam, hot water or flush runs', () => {
    expect(blocksDrinkSettings('espresso')).toBe(true);
    expect(blocksDrinkSettings('steam')).toBe(true);
    expect(blocksDrinkSettings('hotWater')).toBe(true);
    expect(blocksDrinkSettings('flush')).toBe(true);
  });

  it('also blocks the running states next to those four, reusing src/api/machineStates.ts', () => {
    expect(blocksDrinkSettings('steamRinse')).toBe(true);
    expect(blocksDrinkSettings('skipStep')).toBe(true);
    expect(blocksDrinkSettings('cleaning')).toBe(true);
    expect(blocksDrinkSettings('descaling')).toBe(true);
    expect(blocksDrinkSettings('airPurge')).toBe(true);
  });

  it('does not block at rest or in an unknown state', () => {
    expect(blocksDrinkSettings('idle')).toBe(false);
    expect(blocksDrinkSettings('heating')).toBe(false);
    expect(blocksDrinkSettings('somethingNew')).toBe(false);
    expect(blocksDrinkSettings(null)).toBe(false);
    expect(blocksDrinkSettings(undefined)).toBe(false);
  });
});

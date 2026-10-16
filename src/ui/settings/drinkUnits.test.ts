import { describe, expect, it } from 'vitest';
import { toFahrenheit } from '../../coach/temperature.ts';
import {
  clampDrinkField,
  HOT_WATER_FIELDS,
  HOT_WATER_TEMPERATURE,
  nudgeDrinkField,
  RINSE_FIELDS,
  RINSE_TEMPERATURE,
  steamFields,
  steamTemperatureField,
  type DrinkFieldSpec,
} from './drinkSettings.ts';
import { fieldView, isTemperatureField } from './drinkUnits.ts';

/** How Decaid keeps a drink temperature: an int, a fraction truncated (parseInt in models/data/utils.dart; the mock's requiredInt). */
const decaidKeeps = (value: number) => Math.trunc(value);

const TEMPERATURES: ReadonlyArray<[string, DrinkFieldSpec, { min: number; max: number }]> = [
  ['steam on a DE1', steamTemperatureField(null), { min: 275, max: 320 }],
  ['steam on a Bengle', steamTemperatureField('Bengle'), { min: 275, max: 329 }],
  ['hot water', HOT_WATER_TEMPERATURE, { min: 34, max: 212 }],
  ['the flush', RINSE_TEMPERATURE, { min: 34, max: 212 }],
];

/** Every whole number from `min` to `max`. */
const every = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

describe('fieldView in °F: the round trip at every value (D-TEMP-3)', () => {
  for (const [name, spec, shownRange] of TEMPERATURES) {
    const view = fieldView(spec, 'fahrenheit');

    it(`${name}: its bounds in whole °F`, () => {
      expect(view.range).toEqual(shownRange);
      expect(view.unit).toBe('°F');
      expect(view.spokenUnit).toBe('degrees Fahrenheit');
    });

    it(`${name}: each whole °C shows a whole °F that, typed, writes the same °C, and Decaid gives it back the same`, () => {
      for (const celsius of every(spec.range.min, spec.range.max)) {
        const shown = view.shown(celsius);
        expect(Number.isInteger(shown), `${celsius} °C`).toBe(true);
        const written = clampDrinkField(spec, view.fromShown(shown));
        expect(written, `${shown} °F`).toBe(celsius);
        expect(view.shown(decaidKeeps(written)), `${shown} °F read back`).toBe(shown);
      }
    });

    it(`${name}: each whole °F between the bounds writes the nearest whole °C, which shows within 1 °F of it`, () => {
      for (const typed of every(shownRange.min, shownRange.max)) {
        const written = clampDrinkField(spec, view.fromShown(typed));
        expect(Number.isInteger(written), `${typed} °F`).toBe(true);
        expect(written).toBeGreaterThanOrEqual(spec.range.min);
        expect(written).toBeLessThanOrEqual(spec.range.max);
        // The nearest: whole °C are 1.8 °F apart, so never more than 0.9 °F off.
        expect(Math.abs(toFahrenheit(written) - typed), `${typed} °F`).toBeLessThanOrEqual(0.9 + 1e-9);
        expect(Math.abs(view.shown(decaidKeeps(written)) - typed), `${typed} °F read back`).toBeLessThanOrEqual(1);
      }
    });

    it(`${name}: a value typed past either end lands on it`, () => {
      expect(clampDrinkField(spec, view.fromShown(shownRange.min - 40))).toBe(spec.range.min);
      expect(clampDrinkField(spec, view.fromShown(shownRange.max + 40))).toBe(spec.range.max);
    });

    it(`${name}: a tap moves one whole °C from every value, never stuck, and the ends hold`, () => {
      for (const celsius of every(spec.range.min, spec.range.max)) {
        const up = nudgeDrinkField(spec, celsius, 1);
        const down = nudgeDrinkField(spec, celsius, -1);
        expect(up, `More from ${celsius} °C`).toBe(celsius < spec.range.max ? celsius + 1 : null);
        expect(down, `Less from ${celsius} °C`).toBe(celsius > spec.range.min ? celsius - 1 : null);
        // On screen, 2 °F, or 1 °F one time in five.
        if (up !== null) expect([1, 2]).toContain(view.shown(up) - view.shown(celsius));
      }
    });

    it(`${name}: Up and Down from a typed °F step from the °C it stands for`, () => {
      for (const typed of every(shownRange.min, shownRange.max)) {
        const exact = view.fromShown(typed);
        const stands = clampDrinkField(spec, exact);
        const up = nudgeDrinkField(spec, exact, 1);
        const down = nudgeDrinkField(spec, exact, -1);
        // At an end, a typed value just inside it goes to the end itself, as a typed 1.5 °C does in °C:
        // 34 °F is 1.1 °C, so Down writes hot water's floor, 1 °C, which shows 34 °F.
        expect(up, `Up from ${typed} °F`).toBe(stands < spec.range.max ? stands + 1 : exact < spec.range.max ? spec.range.max : null);
        expect(down, `Down from ${typed} °F`).toBe(stands > spec.range.min ? stands - 1 : exact > spec.range.min ? spec.range.min : null);
      }
    });
  }

  it('shows the values a steam stepper passes through, from its bottom', () => {
    const view = fieldView(steamTemperatureField(null), 'fahrenheit');
    expect(every(135, 145).map(view.shown)).toEqual([275, 277, 279, 280, 282, 284, 286, 288, 289, 291, 293]);
    expect(view.shown(150)).toBe(302);
    expect(view.shown(149)).toBe(300);
    expect(fieldView(HOT_WATER_TEMPERATURE, 'fahrenheit').shown(75)).toBe(167);
    expect(fieldView(RINSE_TEMPERATURE, 'fahrenheit').shown(90)).toBe(194);
  });

  it('why the step is a whole °C: a 1 °F step would get stuck, and an unrounded °C comes back lower', () => {
    const spec = steamTemperatureField(null);
    const view = fieldView(spec, 'fahrenheit');
    // From 280 °F (138 °C), one °F more rounds back to 138 °C: More would do nothing there.
    expect(view.shown(138)).toBe(280);
    expect(Math.round(view.fromShown(281))).toBe(138);
    // 300 °F sent unrounded is 148.9 °C, which Decaid keeps as 148: 298 °F read back.
    expect(view.shown(decaidKeeps(view.fromShown(300)))).toBe(298);
    expect(view.shown(decaidKeeps(clampDrinkField(spec, view.fromShown(300))))).toBe(300);
  });
});

describe('fieldView: everything else as it was', () => {
  it('in °C a temperature is the field itself', () => {
    for (const [, spec] of TEMPERATURES) {
      const view = fieldView(spec, 'celsius');
      expect(view.unit).toBe('°C');
      expect(view.spokenUnit).toBe('degrees Celsius');
      expect(view.range).toBe(spec.range);
      expect(view.shown(150)).toBe(150);
      expect(view.fromShown(149.5)).toBe(149.5);
    }
  });

  it('in °F a time, a volume or a flow is the field itself', () => {
    const others = [...steamFields(null), ...HOT_WATER_FIELDS, ...RINSE_FIELDS].filter((spec) => !isTemperatureField(spec));
    expect(others.map((spec) => spec.label)).toEqual([
      'Steam time',
      'Steam flow',
      'Hot water volume',
      'Hot water time',
      'Hot water flow',
      'Flush time',
      'Flush flow',
    ]);
    for (const spec of others) {
      const view = fieldView(spec, 'fahrenheit');
      expect(view.unit).toBe(spec.unit);
      expect(view.range).toBe(spec.range);
      expect(view.shown(50)).toBe(50);
      expect(view.fromShown(0.8)).toBe(0.8);
    }
  });

  it('knows the three temperatures, and only them', () => {
    expect([...steamFields(null), ...HOT_WATER_FIELDS, ...RINSE_FIELDS].filter(isTemperatureField).map((spec) => spec.label)).toEqual([
      'Steam temperature',
      'Hot water temperature',
      'Flush temperature',
    ]);
  });
});

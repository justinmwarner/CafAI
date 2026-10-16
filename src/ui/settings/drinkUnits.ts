/**
 * A drink setting as the barista reads and types it (D173). Every field
 * keeps Decaid's own value and range (drinkSettings.ts); in °F a temperature
 * shows and takes whole °F, while Decaid keeps whole °C.
 *
 * Decaid keeps the steam, hot water and flush temperatures as whole °C (each
 * an `int` in its workflow.dart, read with parseInt, which truncates a
 * fraction; `type: integer` in the spec; steam and hot water a byte on the
 * DE1). So a value shows as round(°C × 1.8 + 32); a typed °F becomes the
 * nearest whole °C, which the stepper's clamp rounds to (300 °F is 148.9 °C,
 * so 149 °C, which shows 300 again); and More and Less move one whole °C,
 * which reads as 2 °F, or 1 °F one time in five (275, 277, 279, 280...).
 * Whole °C are 1.8 °F apart, so no step in °F could do better: a 1 °F step
 * would get stuck (281 °F rounds back to 138 °C, which shows 280 °F), and an
 * unrounded °C would be truncated by Decaid (148.9 kept as 148, 298 °F).
 */
import { spokenTemperatureUnit, temperatureSymbol, toCelsius, toFahrenheit, type TemperatureUnit } from '../../coach/temperature.ts';
import type { DrinkFieldSpec, Range } from './drinkSettings.ts';

export interface FieldView {
  /** The unit after the value: "°F", "s", "ml/s". */
  readonly unit: string;
  /** As a screen reader says it: "degrees Fahrenheit". */
  readonly spokenUnit: string;
  /** The field's range as shown, which a screen reader hears as its minimum and maximum. */
  readonly range: Range;
  /** Decaid's value as shown. */
  shown(value: number): number;
  /** A value typed in the shown unit, in Decaid's: not yet clamped or rounded, which clampDrinkField does. */
  fromShown(typed: number): number;
}

/** A temperature, which Decaid keeps in °C. */
export function isTemperatureField(spec: DrinkFieldSpec): boolean {
  return spec.unit === '°C';
}

/** `spec` as shown in `unit`: the field itself, unless it is a temperature and the barista reads °F. */
export function fieldView(spec: DrinkFieldSpec, unit: TemperatureUnit): FieldView {
  if (unit === 'celsius' || !isTemperatureField(spec)) {
    return { unit: spec.unit, spokenUnit: spec.spokenUnit, range: spec.range, shown: (value) => value, fromShown: (typed) => typed };
  }
  const shown = (value: number) => Math.round(toFahrenheit(value));
  return {
    unit: temperatureSymbol(unit),
    spokenUnit: spokenTemperatureUnit(unit),
    range: { min: shown(spec.range.min), max: shown(spec.range.max) },
    shown,
    fromShown: toCelsius,
  };
}

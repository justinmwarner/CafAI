import { describe, expect, it } from 'vitest';
import {
  changeIn,
  formatTemperatureIn,
  inTemperatureUnit,
  isTemperatureUnit,
  spokenTemperatureUnit,
  temperatureIn,
  temperatureSymbol,
  toCelsius,
  toFahrenheit,
} from './temperature.ts';

const inF = (text: string) => inTemperatureUnit(text, 'fahrenheit');
const inC = (text: string) => inTemperatureUnit(text, 'celsius');

describe('the conversions', () => {
  it('a temperature is °C × 1.8 + 32, and back', () => {
    expect(toFahrenheit(100)).toBeCloseTo(212, 10);
    expect(toFahrenheit(92)).toBeCloseTo(197.6, 10);
    expect(toCelsius(212)).toBeCloseTo(100, 10);
    expect(toCelsius(toFahrenheit(93.5))).toBeCloseTo(93.5, 10);
  });

  it('a change is × 1.8, never the 32', () => {
    expect(changeIn(1, 'fahrenheit')).toBeCloseTo(1.8, 10);
    expect(changeIn(2, 'fahrenheit')).toBeCloseTo(3.6, 10);
    expect(changeIn(0.5, 'fahrenheit')).toBeCloseTo(0.9, 10);
    expect(changeIn(2, 'celsius')).toBe(2);
    expect(temperatureIn(92, 'celsius')).toBe(92);
    expect(temperatureIn(92, 'fahrenheit')).toBeCloseTo(197.6, 10);
  });

  it('formats a temperature as the barista reads it, °C exactly as before', () => {
    expect(formatTemperatureIn(92.44, 'celsius')).toBe('92.4 °C');
    expect(formatTemperatureIn(140, 'celsius', 0)).toBe('140 °C');
    expect(formatTemperatureIn(92.44, 'fahrenheit')).toBe('198.4 °F');
    expect(formatTemperatureIn(140, 'fahrenheit', 0)).toBe('284 °F');
    expect(formatTemperatureIn(88.05000305175781, 'fahrenheit')).toBe('190.5 °F');
  });

  it('names the units, and knows only the two', () => {
    expect(temperatureSymbol('celsius')).toBe('°C');
    expect(temperatureSymbol('fahrenheit')).toBe('°F');
    expect(spokenTemperatureUnit('fahrenheit')).toBe('degrees Fahrenheit');
    expect(spokenTemperatureUnit('celsius')).toBe('degrees Celsius');
    expect(isTemperatureUnit('fahrenheit')).toBe(true);
    expect(isTemperatureUnit('celsius')).toBe(true);
    for (const other of ['F', 'C', 'kelvin', '', null, undefined, 1]) expect(isTemperatureUnit(other)).toBe(false);
  });
});

describe('inTemperatureUnit, into °F', () => {
  it("writes CafAI's own change lines in °F: the settings as temperatures, the step as a change", () => {
    expect(inF('Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)')).toBe(
      'Brew temperature: 197.6 °F -> 199.4 °F (every step +1.8 °F)',
    );
    expect(inF('Brew temperature: 88.0 °C -> 87.5 °C (every step -0.5 °C)')).toBe(
      'Brew temperature: 190.4 °F -> 189.5 °F (every step -0.9 °F)',
    );
    expect(inF('All step temperatures +1.0 °C')).toBe('All step temperatures +1.8 °F');
    expect(inF('Step 3 (Infuse) temperature: 88.5 °C -> 90.0 °C')).toBe('Step 3 (Infuse) temperature: 191.3 °F -> 194.0 °F');
    // Beside an arrow a small number is still a setting, not a change.
    expect(inF('Tank temperature: 0.0 °C -> 1.0 °C')).toBe('Tank temperature: 32.0 °F -> 33.8 °F');
  });

  it("writes the coach's words in °F: a change without the 32", () => {
    expect(inF('Raise brew temperature by 1 °C')).toBe('Raise brew temperature by 1.8 °F');
    expect(inF("Let's go **1 °C hotter** and keep everything else the same.")).toBe(
      "Let's go **1.8 °F hotter** and keep everything else the same.",
    );
    expect(inF('Brew 1 °C cooler')).toBe('Brew 1.8 °F cooler');
    expect(inF("I'd raise the **brew temperature** by 2 °C.")).toBe("I'd raise the **brew temperature** by 3.6 °F.");
    expect(inF('about 20 °C cooler')).toBe('about 36 °F cooler');
    expect(inF('A 5 °C change')).toBe('A 9 °F change');
  });

  it('writes a temperature as precisely as it was written', () => {
    expect(inF('It ran at 93 °C.')).toBe('It ran at 199 °F.');
    expect(inF('It ran at 92.5 °C.')).toBe('It ran at 198.5 °F.');
    expect(inF("Steam heater off until it's down to 60 °C (up to an hour), steam tip off.")).toBe(
      "Steam heater off until it's down to 140 °F (up to an hour), steam tip off.",
    );
  });

  it('converts both ends of a range, as temperatures or as changes', () => {
    expect(inF('between 88 and 94 °C')).toBe('between 190 and 201 °F');
    expect(inF('88-94 °C')).toBe('190-201 °F');
    expect(inF('88.0–94.0 °C')).toBe('190.4–201.2 °F');
    expect(inF('brew temperature +1-2 °C')).toBe('brew temperature +1.8-3.6 °F');
    expect(inF('brew temperature -1-2 °C')).toBe('brew temperature -1.8-3.6 °F');
    expect(inF('the group often reads 1-3 °C under its target')).toBe('the group often reads 1.8-5.4 °F under its target');
    expect(inF('usually want 1-2 °C less')).toBe('usually want 1.8-3.6 °F less');
    expect(inF('1 or 2 °C')).toBe('1.8 or 3.6 °F');
    // A step's number is not one end of a range of temperatures.
    expect(inF('Set step 3 to 90 °C.')).toBe('Set step 3 to 194 °F.');
  });

  it("writes the validator's words in °F", () => {
    expect(inF('Rounded 92.3 to 92.5 °C: brew temperature moves in steps of 0.5 °C.')).toBe(
      'Rounded 198.1 to 198.5 °F: brew temperature moves in steps of 0.9 °F.',
    );
    expect(
      inF("temp: 96.0 °C is above this template's maximum of 94.0 °C. Allowed range now: 90.0-94.0 °C (at most 2.0 °C per step)."),
    ).toBe("temp: 204.8 °F is above this template's maximum of 201.2 °F. Allowed range now: 194.0-201.2 °F (at most 3.6 °F per step).");
  });

  it('keeps only the barista\'s half of a temperature given in both', () => {
    expect(inF('Try 93 °C (199 °F) next.')).toBe('Try 199 °F next.');
    expect(inF('Try 93 °C (about 199.4 °F) next.')).toBe('Try about 199.4 °F next.');
    expect(inF('Try 199 °F (93 °C) next.')).toBe('Try 199 °F next.');
    expect(inF('Try 93 °C / 199 °F next.')).toBe('Try 199 °F next.');
    expect(inF('Try 199 °F / 93 °C next.')).toBe('Try 199 °F next.');
    expect(inF('1 °C (1.8 °F) hotter')).toBe('1.8 °F hotter');
  });

  it('leaves a conversion the barista asked for as written', () => {
    expect(inF('200 °F is 93.3 °C.')).toBe('200 °F is 93.3 °C.');
    expect(inF('93 °C is about 199.4 °F.')).toBe('93 °C is about 199.4 °F.');
    expect(inF('93 °C = 199.4 °F')).toBe('93 °C = 199.4 °F');
    expect(inC('200 °F is 93.3 °C.')).toBe('200 °F is 93.3 °C.');
    // A temperature beside it that is not the pair is still written in the barista's unit.
    expect(inF('200 °F is 93.3 °C, so I would go to 94 °C.')).toBe('200 °F is 93.3 °C, so I would go to 201 °F.');
  });

  it('reads the ways a sentence writes the unit', () => {
    expect(inF('93°C')).toBe('199 °F');
    expect(inF('93 ºC')).toBe('199 °F');
    expect(inF('93 °c')).toBe('199 °F');
    expect(inF('93 ℃')).toBe('199 °F');
    expect(inF('93 degrees C')).toBe('199 degrees F');
    expect(inF('93 degrees Celsius')).toBe('199 degrees Fahrenheit');
    expect(inF('a −1 °C change')).toBe('a −1.8 °F change');
  });

  it('leaves everything else as it is', () => {
    for (const text of [
      '',
      'Pull a shot when you are ready.',
      'Yield: 36 g -> 38 g (the shot stops at 38 g)',
      'Already 199 °F, and a change of 1.8 °F.',
      'Decaid keeps temperatures in °C.',
      'Kiambu AA v1.5 °Celsius-free',
      'Grind 1 step finer, to 14.5',
      'v1.5 °C',
    ]) {
      expect(inF(text)).toBe(text);
    }
  });

  it('is the identity for °C text in °C', () => {
    for (const text of ['Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)', 'Raise brew temperature by 1 °C', '93 °C']) {
      expect(inC(text)).toBe(text);
    }
  });

  it('never reads the words after a temperature as a change', () => {
    expect(inF('Move the brew temperature from 92 °C up to 94 °C.')).toBe('Move the brew temperature from 198 °F up to 201 °F.');
    expect(inF('Hold 93 °C over the whole shot.')).toBe('Hold 199 °F over the whole shot.');
    expect(inF('The pour at 92 °C lags behind the fill.')).toBe('The pour at 198 °F lags behind the fill.');
  });

  it('converts every number of an arrow range or a list', () => {
    expect(inF('Brew temperature 92 → 93 °C')).toBe('Brew temperature 198 → 199 °F');
    expect(inF('Brew temperature 92 -> 93 °C')).toBe('Brew temperature 198 -> 199 °F');
    expect(inF('the 89 / 88.5 / 88 °C shape')).toBe('the 192 / 191.3 / 190 °F shape');
    expect(inF('92, 92.5 or 93 °C')).toBe('198, 198.5 or 199 °F');
    // A number far from the rest is something else, as a step's number is.
    expect(inF('Shot 41, 92 °C')).toBe('Shot 41, 198 °F');
    expect(inF('In 2024, 92 °C was usual')).toBe('In 2024, 198 °F was usual');
    // A comma with no space is a decimal comma, never a list.
    expect(inF('92,5 °C')).toBe('92,5 °C');
  });

  it('reads a small number named as a temperature as one', () => {
    expect(inF('Let the sample cool to about 25 °C.')).toBe('Let the sample cool to about 77 °F.');
    expect(inF('room temperature (20-25 °C)')).toBe('room temperature (68-77 °F)');
    expect(inF('a fridge at 4 °C')).toBe('a fridge at 39 °F');
    // Its minus is its sign: -18 °C is -0.4 °F, whole as written.
    expect(inF('A freezer at -18 °C')).toBe('A freezer at 0 °F');
    // "At most" limits a change: still a change.
    expect(inF('at most 2 °C per change')).toBe('at most 3.6 °F per change');
  });
});

describe('inTemperatureUnit, with no unit chosen', () => {
  it('leaves every word as written, even a °F the coach gave when asked (D172)', () => {
    for (const text of ["That's 197.6 °F.", '93 °C (199.4 °F)', '92 °C, or 197.6 °F if you think in Fahrenheit', 'Raise brew temperature by 1.8 °F']) {
      expect(inTemperatureUnit(text, null)).toBe(text);
    }
  });
});

describe('inTemperatureUnit, back into °C', () => {
  it("writes the coach's °F words in °C after a switch back", () => {
    expect(inC('Raise brew temperature by 1.8 °F')).toBe('Raise brew temperature by 1.0 °C');
    expect(inC('Brew 1.8 °F hotter')).toBe('Brew 1.0 °C hotter');
    expect(inC('about 199 °F')).toBe('about 93 °C');
    expect(inC('2 °F hotter')).toBe('1.1 °C hotter');
    expect(inC('down to 140 °F')).toBe('down to 60 °C');
    expect(inC('from 197.6 °F up to 201.2 °F')).toBe('from 92.0 °C up to 94.0 °C');
    expect(inC('Hold 199.4 °F over the whole shot')).toBe('Hold 93.0 °C over the whole shot');
    expect(inC('197.6 → 199.4 °F')).toBe('92.0 → 93.0 °C');
    expect(inC('a fridge at 39 °F')).toBe('a fridge at 4 °C');
  });

  it('gives back the °C line it came from, for lines written to one decimal', () => {
    for (const line of [
      'Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)',
      'Brew temperature: 88.0 °C -> 87.5 °C (every step -0.5 °C)',
      'All step temperatures +1.0 °C',
      'Step 3 (Infuse) temperature: 88.5 °C -> 90.0 °C',
      'Tank temperature: 0.0 °C -> 1.0 °C',
    ]) {
      expect(inC(inF(line))).toBe(line);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { inTemperatureUnit } from '../../coach/temperature.ts';
import { keepUnits, ROUTINES, routineOf } from './careGuide.ts';
import { routineInUnit } from './careUnits.ts';

const NBSP = ' ';

describe("the cleaning guide in the barista's unit (D176)", () => {
  it("reads the descale's 60 °C as 140 °F, kept with its number", () => {
    const descale = routineInUnit(routineOf('asNeeded'), 'fahrenheit').steps.find((step) => step.id === 'descale')!;
    expect(descale.how).toContain("Steam heater off until it's down to 140 °F (up to an hour)");
    expect(keepUnits(descale.how)).toContain(`down to 140${NBSP}°F (up to an hour)`);
  });

  it('is the guide itself in °C', () => {
    for (const routine of ROUTINES) expect(routineInUnit(routine, 'celsius')).toBe(routine);
  });

  it('changes only the temperatures: every other word, moment and link stays', () => {
    for (const routine of ROUTINES) {
      const shown = routineInUnit(routine, 'fahrenheit');
      expect(shown.label).toBe(routine.label);
      expect(shown.cadence).toBe(routine.cadence);
      shown.steps.forEach((step, i) => {
        const kept = routine.steps[i]!;
        expect(step.id).toBe(kept.id);
        expect(step.moment).toBe(kept.moment);
        expect(step.link).toEqual(kept.link);
        for (const field of ['how', 'when', 'where', 'note'] as const) {
          const text = kept[field];
          expect(step[field], `${kept.id}.${field}`).toBe(text === undefined ? undefined : inTemperatureUnit(text, 'fahrenheit'));
        }
      });
    }
  });

  it('leaves no °C anywhere in the guide for a barista on °F', () => {
    const words = ROUTINES.flatMap((routine) => routineInUnit(routine, 'fahrenheit').steps.flatMap((s) => [s.how, s.when, s.where, s.note]));
    expect(words.join(' ')).not.toMatch(/°C/);
  });
});

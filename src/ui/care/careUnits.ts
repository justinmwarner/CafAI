/**
 * The cleaning guide in the barista's unit (D176): its words are written
 * in °C (careGuide.ts), and a barista who reads °F reads its one temperature,
 * the descale's "down to 60 °C", as "down to 140 °F".
 */
import { inTemperatureUnit, type TemperatureUnit } from '../../coach/temperature.ts';
import type { CareRoutine, CareStep } from './careGuide.ts';

function stepIn(step: CareStep, unit: TemperatureUnit): CareStep {
  const words = (text: string | undefined) => (text === undefined ? undefined : inTemperatureUnit(text, unit));
  return { ...step, how: inTemperatureUnit(step.how, unit), when: words(step.when), where: words(step.where), note: words(step.note) };
}

/** `routine` with every temperature in its steps in `unit`; the routine itself in °C. */
export function routineInUnit(routine: CareRoutine, unit: TemperatureUnit): CareRoutine {
  if (unit === 'celsius') return routine;
  return { ...routine, steps: routine.steps.map((step) => stepIn(step, unit)) };
}

/**
 * The coach's system prompt in °F (D-TEMP-5): one section, after "How you
 * talk", for a barista who reads °F. The coach is given °C and sends °C (the
 * catalog, the heuristics, the shot summary, the tools); it writes °F. CafAI
 * works out each template's temperature lever in °F itself, so the model has
 * no arithmetic to do for the bounds ("the coach's levers and their bounds
 * said in °F"), and the section spells out the one mistake a model makes with
 * a change: adding the 32.
 *
 * In °C nothing here is used: that prompt is byte for byte what it was.
 */
import { readLeverValue } from './levers.ts';
import { changeIn, temperatureIn } from './temperature.ts';
import type { Lever, Template } from './types.ts';

/** The section's heading: the scripted coach reads it to know the barista's unit (mock/anthropic). */
export const FAHRENHEIT_HEADING = '# Temperatures in °F';

const f = (celsius: number) => `${temperatureIn(celsius, 'fahrenheit').toFixed(1)} °F`;
const fChange = (celsius: number) => `${changeIn(celsius, 'fahrenheit').toFixed(1)} °F`;

/** "- blooming-espresso `temp` Brew temperature: 186.8-201.2 °F, steps of 0.9 °F, at most 3.6 °F per change; template value 197.6 °F." */
function leverInFahrenheit(template: Template, lever: Lever): string {
  const start = readLeverValue(template, template.profile, lever.id);
  return (
    `  - ${template.id} \`${lever.id}\` ${lever.label}: ${temperatureIn(lever.min, 'fahrenheit').toFixed(1)}-${f(lever.max)}, ` +
    `steps of ${fChange(lever.granularity)}, at most ${fChange(lever.maxDelta)} per change; template value ${f(start)}.`
  );
}

export function fahrenheitSection(templates: readonly Template[]): string {
  const levers = templates.flatMap((template) =>
    template.levers.filter((lever) => lever.unit === '°C').map((lever) => leverInFahrenheit(template, lever)),
  );
  return [
    FAHRENHEIT_HEADING,
    'The user reads temperatures in °F: CafAI shows its readouts, settings and change cards in °F. Decaid and the profiles keep °C.',
    '- What you are given is in °C: the catalog, the heuristics, the shot summary and every tool result. What you send stays in °C: a temperature lever\'s value in propose_adjustment is °C, inside the lever\'s °C bounds.',
    "- Write every temperature for the user in °F, never in °C and never both: your replies, ask_user's question and options, and propose_adjustment's summary, rationale, expectedEffect and tips.",
    '- A temperature converts as °F = °C × 1.8 + 32: 92 °C is 197.6 °F, 93.5 °C is 200.3 °F. A change of temperature converts as × 1.8, without the 32: 0.5 °C is 0.9 °F, 1 °C is 1.8 °F, 1.5 °C is 2.7 °F, 2 °C is 3.6 °F. So 1 °C hotter is 1.8 °F hotter, never 33.8 °F hotter.',
    '- Give a change to one decimal, as the change card shows it ("Raise brew temperature by 1.8 °F"); a temperature to one decimal or as a whole degree.',
    '- When the user gives a temperature in °F, convert it to °C for your tools, on the lever\'s own steps, and say what you chose: 200 °F is 93.3 °C, which a lever in steps of 0.5 °C takes as 93.5 °C (200.3 °F).',
    '- The temperature levers in °F (the catalog gives the same in °C):',
    ...levers,
  ].join('\n');
}

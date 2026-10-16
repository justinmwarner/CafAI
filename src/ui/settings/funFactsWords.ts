/**
 * What Settings > Coach > Fun facts says (D198): the four choices in the
 * spec's words, the line under the chosen one, and what the CafAI Bridge does
 * with a web search (D203).
 */
import type { FunFactsSource } from '../../coach/facts/types.ts';

export interface FunFactsChoice {
  value: FunFactsSource;
  label: string;
  /** What the choice does, under the field while it is chosen. */
  line: string;
}

/** In the order they add up: none, CafAI's list, the coach too, then a web search as well. */
export const FUN_FACTS_CHOICES: readonly FunFactsChoice[] = [
  { value: 'off', label: 'Off', line: 'No fun facts.' },
  {
    value: 'list',
    label: "CafAI's facts",
    line: "From CafAI's own list of about 500 checked facts, picked for the bag where one fits. Free, and works without the coach.",
  },
  {
    value: 'coach',
    label: "CafAI's and the coach's",
    line: "The coach shares a fact about this bag when it knows one for sure; the rest come from CafAI's list.",
  },
  {
    value: 'web',
    // The one before, and a search: the list shows them in turn, and the line says the rest.
    label: '…and a web search',
    line: 'The coach may also look the roaster, farm or producer up on the web: one search per fact, about one US cent each, plus a few cents for the pages it reads.',
  },
];

/** Said after the web search's line while the coach runs through the CafAI Bridge (D203). */
export const FUN_FACTS_BRIDGE_LINE = 'Through the CafAI Bridge the coach shares what it knows, without a search.';

/** The line under the field for `source`; the web search's takes the Bridge's after it while the coach runs there. */
export function funFactsLine(source: FunFactsSource, onComputer: boolean): string {
  const line = FUN_FACTS_CHOICES.find((choice) => choice.value === source)?.line ?? '';
  return source === 'web' && onComputer ? `${line} ${FUN_FACTS_BRIDGE_LINE}` : line;
}

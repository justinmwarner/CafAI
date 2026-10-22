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
    line: "From CafAI's own list of over 300 checked facts, picked for the bag where one fits. Free, and works without the coach.",
  },
  {
    value: 'coach',
    label: "CafAI's and the coach's",
    line: "The coach shares a fact about this bag when it knows one for sure; the rest come from CafAI's list.",
  },
  {
    value: 'web',
    // Whole on its own: a closed select shows one label, so it cannot lean on the one before.
    label: "CafAI's, the coach's and a web search",
    line: 'The coach may also look the roaster, farm or producer up on the web: one search per fact, about one US cent each, plus a few cents for the pages it reads.',
  },
];

/**
 * The web search's line while the coach runs through the CafAI Bridge (D203):
 * Claude Code searches there, on the owner's plan, so there is nothing to pay
 * per search, and no way to hold it to one search a fact but by asking.
 */
export const FUN_FACTS_WEB_BRIDGE_LINE =
  "The coach may also look the roaster, farm or producer up on the web, once per fact. Through the CafAI Bridge, Claude Code searches on your Claude plan: nothing to pay per search, though it counts toward the plan's limits.";

/** The line under the field for `source`; the web search's says what the Bridge does while the coach runs there. */
export function funFactsLine(source: FunFactsSource, onComputer: boolean): string {
  if (source === 'web' && onComputer) return FUN_FACTS_WEB_BRIDGE_LINE;
  return FUN_FACTS_CHOICES.find((choice) => choice.value === source)?.line ?? '';
}

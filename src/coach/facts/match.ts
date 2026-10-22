/**
 * Which of CafAI's facts fit a bag (D200). A fact's match words are read as
 * whole words, without case or accents, in the bag's details: "sidama" finds
 * "Sidama, Ethiopia" and "cafe" finds "Café", but "geisha" never finds
 * "geishas", since a fact lists the forms it fits itself. A term of several
 * words ("pink bourbon") finds those words together, in order.
 */
import type { RoastLevel } from '../contract.ts';
import type { FactMatch, FunFact } from './types.ts';

/** A bag's details as the matcher reads them. */
export interface BagFacts {
  name: string;
  roaster: string | null;
  origin: string | null;
  process: string | null;
  notes: string | null;
  roastLevel: RoastLevel | null;
}

/** A match's keys, in the order a bag's own facts are told (D200): a roaster fact first, a roast-level one last. */
export const MATCH_KEYS = ['roasters', 'varieties', 'origins', 'processes', 'notes', 'roastLevels'] as const;
export type MatchKey = (typeof MATCH_KEYS)[number];

/** The words of a text, in lower case and without accents: "Café Señorío" is ["cafe", "senorio"]. */
export function wordsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** True when `term`'s words come together, in order, among `words`. */
function hasPhrase(words: readonly string[], term: readonly string[]): boolean {
  if (term.length === 0) return false;
  for (let start = 0; start + term.length <= words.length; start += 1) {
    if (term.every((word, i) => words[start + i] === word)) return true;
  }
  return false;
}

/** Where each key is read in a bag (the roast level is compared instead). */
function fieldsOf(key: Exclude<MatchKey, 'roastLevels'>, bag: BagFacts): Array<string | null> {
  switch (key) {
    case 'roasters':
      return [bag.roaster];
    case 'origins':
      return [bag.origin, bag.name];
    case 'processes':
      return [bag.process, bag.name];
    case 'varieties':
      return [bag.name, bag.origin, bag.notes];
    case 'notes':
      return [bag.notes];
  }
}

function keyMatches(match: FactMatch, key: MatchKey, bag: BagFacts): boolean {
  if (key === 'roastLevels') return bag.roastLevel !== null && (match.roastLevels ?? []).includes(bag.roastLevel);
  const fields = fieldsOf(key, bag).map(wordsOf);
  return (match[key] ?? []).some((term) => {
    const words = wordsOf(term);
    return fields.some((field) => hasPhrase(field, words));
  });
}

/** The keys a fact's match names with at least one word, in MATCH_KEYS order. */
function namedKeys(fact: FunFact): MatchKey[] {
  const match = fact.match;
  return match ? MATCH_KEYS.filter((key) => (match[key]?.length ?? 0) > 0) : [];
}

/** A fact for some bags only: its match names at least one word. Any other fact is general. */
export function isBagFact(fact: FunFact): boolean {
  return namedKeys(fact).length > 0;
}

/** The keys of a fact's match that the bag's details say, in MATCH_KEYS order. */
export function matchedKeys(fact: FunFact, bag: BagFacts): MatchKey[] {
  const match = fact.match;
  return match ? namedKeys(fact).filter((key) => keyMatches(match, key, bag)) : [];
}

/**
 * Whether a fact fits the bag: its notes, if it names any, are in the bag's
 * tasting notes (a fact that names a flavour shows only for a bag whose notes
 * say it, D199), and at least one of its other keys, if it names any, is in
 * the bag's details. A general fact fits every bag.
 */
export function factFits(fact: FunFact, bag: BagFacts): boolean {
  const named = namedKeys(fact);
  if (named.length === 0) return true;
  const matched = matchedKeys(fact, bag);
  if (named.includes('notes') && !matched.includes('notes')) return false;
  const others = named.filter((key) => key !== 'notes');
  return others.length === 0 || others.some((key) => matched.includes(key));
}

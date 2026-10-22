/**
 * Fun facts (D197-D203): one short fact under the coach's reply to a shot
 * that ran like the last one on a recipe the barista kept, from CafAI's own
 * list (facts.json, D199) or from the coach (share_fun_fact, D201).
 */
import type { RoastLevel } from '../contract.ts';

/** What a fact is about; the coach's share_fun_fact takes the same topics. */
export const FACT_TOPICS = [
  'roaster',
  'origin',
  'process',
  'variety',
  'flavour',
  'science',
  'roasting',
  'growing',
  'history',
  'milk',
  'care',
] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];

export function isFactTopic(value: unknown): value is FactTopic {
  return typeof value === 'string' && (FACT_TOPICS as readonly string[]).includes(value);
}

/**
 * Which bags a fact fits, read as whole words in the bag's details (D200).
 * Every key is optional; a fact without `match` is general and fits any bag.
 * `notes` is a condition of its own: a fact that names a flavour lists it
 * there, and shows only for a bag whose tasting notes say it (D199).
 */
export interface FactMatch {
  roasters?: string[];
  origins?: string[];
  processes?: string[];
  varieties?: string[];
  notes?: string[];
  roastLevels?: RoastLevel[];
}

/** One of CafAI's own facts (src/coach/facts/facts.json). */
export interface FunFact {
  /** Unique and stable: what the told list keeps. */
  id: string;
  topic: FactTopic;
  /** A short label (at most 80 characters): what the coach hears of a fact already told. */
  about: string;
  /** One or two sentences, at most 280 characters, temperatures written "196 °C". */
  text: string;
  /** The https page the fact was checked against. */
  source: string;
  match?: FactMatch;
}

/**
 * Where fun facts come from (D198): none, CafAI's list only, the coach and
 * the list (the default), or both with a web search for the coach.
 */
export const FUN_FACTS_SOURCES = ['off', 'list', 'coach', 'web'] as const;
export type FunFactsSource = (typeof FUN_FACTS_SOURCES)[number];

/** What a device that never chose reads (D198). */
export const DEFAULT_FUN_FACTS: FunFactsSource = 'coach';

export function isFunFactsSource(value: unknown): value is FunFactsSource {
  return typeof value === 'string' && (FUN_FACTS_SOURCES as readonly string[]).includes(value);
}

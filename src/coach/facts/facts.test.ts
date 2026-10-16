/**
 * Every fact in CafAI's own list (D199), whatever the list holds: its shape,
 * its length, its source, the taste rule, a flavour only with the notes that
 * name it, and temperatures written so the fact block can show them in °F.
 */
import { describe, expect, it } from 'vitest';
import { ROAST_LEVELS } from '../contract.ts';
import FACTS from './facts.json';
import { MATCH_KEYS } from './match.ts';
import { isFactTopic } from './types.ts';
import { factWordingError } from './wording.ts';

const FACT_KEYS = ['id', 'topic', 'about', 'text', 'source', 'match'];
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A temperature as the block converts it (D176): a number, a space, °C. */
const CELSIUS = /(?<![\w.,])\d+(?:\.\d+)? °C(?![A-Za-z])/g;

function isHttps(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A temperature not written "<number> °C": °F anywhere, or °C written another way. */
function temperatureProblem(text: string): string | null {
  if (/[°º]\s?F(?![A-Za-z])|℉|fahrenheit|\bdegrees?\s+F\b/i.test(text)) return 'writes °F: temperatures are written in °C';
  const rest = text.replace(CELSIUS, '');
  if (/[°º]\s?C(?![A-Za-z])|℃|\bdegrees?\s+(?:C\b|celsius)/i.test(rest)) return 'writes a temperature other than "<number> °C"';
  return null;
}

function matchProblems(match: unknown): string[] {
  if (typeof match !== 'object' || match === null || Array.isArray(match)) return ['match is not an object'];
  return Object.entries(match).flatMap(([key, words]): string[] => {
    if (!(MATCH_KEYS as readonly string[]).includes(key)) return [`match.${key} is no match key`];
    if (!Array.isArray(words) || words.length === 0) return [`match.${key} is not a list of words`];
    return words.flatMap((word: unknown): string[] => {
      if (typeof word !== 'string' || word.trim() === '' || word !== word.trim()) return [`match.${key} has a blank or padded word`];
      if (word !== word.toLowerCase()) return [`match.${key} "${word}" is not lower-case`];
      if (key === 'roastLevels' && !(ROAST_LEVELS as readonly string[]).includes(word)) return [`match.roastLevels "${word}" is no roast level`];
      return [];
    });
  });
}

/** What is wrong with one fact; none for a good one. */
function problemsOf(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['not an object'];
  const fact = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(fact)) if (!FACT_KEYS.includes(key)) problems.push(`has "${key}"`);
  const { id, topic, about, text, source, match } = fact;
  if (typeof id !== 'string' || !KEBAB.test(id) || id.length > 60) problems.push('id is not kebab-case of at most 60 characters');
  if (!isFactTopic(topic)) problems.push(`topic "${String(topic)}" is unknown`);
  if (typeof about !== 'string' || about.trim() === '' || about.length > 80) problems.push('about is not 1-80 characters');
  if (typeof text !== 'string' || text.trim() === '' || text.length > 280) {
    problems.push('text is not 1-280 characters');
  } else {
    const wording = factWordingError(text);
    if (wording) problems.push(`text: ${wording}`);
    const temperature = temperatureProblem(text);
    if (temperature) problems.push(`text ${temperature}`);
  }
  if (!isHttps(source)) problems.push('source is not an https address');
  if (match !== undefined) problems.push(...matchProblems(match));
  // A flavour shows only for a bag whose notes say it (D199).
  const notes = (match as { notes?: unknown } | undefined)?.notes;
  if (topic === 'flavour' && !(Array.isArray(notes) && notes.length > 0)) problems.push('a flavour fact without match.notes');
  return problems;
}

const GOOD = {
  id: 'kenya-sl28-selection',
  topic: 'variety',
  about: "Kenya's SL28",
  text: 'SL28 was selected at Scott Laboratories in Kenya in the 1930s for its drought tolerance; it is roasted to about 205 °C in some labs.',
  source: 'https://varieties.worldcoffeeresearch.org/varieties/sl28',
  match: { varieties: ['sl28'], origins: ['kenya'] },
};

describe("the checks on CafAI's facts", () => {
  it('pass a good fact, a general one too', () => {
    expect(problemsOf(GOOD)).toEqual([]);
    const { match: _match, ...general } = GOOD;
    expect(problemsOf({ ...general, topic: 'science' })).toEqual([]);
    expect(problemsOf({ ...GOOD, topic: 'flavour', match: { notes: ['blackcurrant'] } })).toEqual([]);
  });

  it('find each kind of problem', () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ evidence: 'a quote' }, /has "evidence"/],
      [{ id: 'Kenya SL28' }, /id is not kebab-case/],
      [{ id: 'x'.repeat(61) }, /id is not kebab-case/],
      [{ topic: 'gossip' }, /topic "gossip" is unknown/],
      [{ about: 'x'.repeat(81) }, /about is not 1-80/],
      [{ text: 'x'.repeat(281) }, /text is not 1-280/],
      [{ text: 'This cup should taste of blackcurrant.' }, /foretells or describes the barista's cup/],
      [{ text: 'Roasted to 400 °F.' }, /writes °F/],
      [{ text: 'Roasted to 205°C.' }, /other than "<number> °C"/],
      [{ text: 'Roasted to 205 degrees Celsius.' }, /other than "<number> °C"/],
      [{ text: 'Roasted to 205 ℃.' }, /other than "<number> °C"/],
      [{ source: 'http://example.org/fact' }, /source is not an https address/],
      [{ source: 'example.org' }, /source is not an https address/],
      [{ match: { varieties: ['SL28'] } }, /not lower-case/],
      [{ match: { varieties: [] } }, /not a list of words/],
      [{ match: { grinders: ['niche'] } }, /no match key/],
      [{ match: { roastLevels: ['blonde'] } }, /no roast level/],
      [{ topic: 'flavour' }, /a flavour fact without match.notes/],
    ];
    for (const [change, problem] of cases) {
      expect(problemsOf({ ...GOOD, ...change }).join('; '), JSON.stringify(change)).toMatch(problem);
    }
  });

  it('leave a degree that is no temperature alone', () => {
    expect(problemsOf({ ...GOOD, text: 'The coffee belt lies between about 25° N and 30° S.' })).toEqual([]);
    expect(problemsOf({ ...GOOD, text: 'Hold the cup at about 45° while you pour, from 4 °C milk.' })).toEqual([]);
  });
});

describe("CafAI's facts (src/coach/facts/facts.json)", () => {
  const facts = FACTS as unknown[];

  it('is a list', () => {
    expect(Array.isArray(FACTS)).toBe(true);
  });

  it('has every fact in shape: its id, topic, label, text, source and match (D199)', () => {
    const problems = facts.flatMap((fact, i) => problemsOf(fact).map((problem) => `${(fact as { id?: string }).id ?? `#${i}`}: ${problem}`));
    expect(problems).toEqual([]);
  });

  it('gives every fact its own id', () => {
    const ids = facts.map((fact) => (fact as { id?: unknown }).id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

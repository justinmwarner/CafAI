import { describe, expect, it } from 'vitest';
import { factFits, isBagFact, matchedKeys, wordsOf, type BagFacts } from './match.ts';
import type { FactMatch, FunFact } from './types.ts';

const BAG: BagFacts = { name: 'Kiambu AA', roaster: 'Square Mile', origin: 'Kenya, Kiambu', process: 'washed', notes: 'blackcurrant, grapefruit', roastLevel: 'light' };

const fact = (match?: FactMatch): FunFact => ({
  id: 'a-fact',
  topic: 'origin',
  about: 'A fact',
  text: 'Something true.',
  source: 'https://example.org/fact',
  ...(match ? { match } : {}),
});

const fits = (match: FactMatch, bag: Partial<BagFacts> = {}) => factFits(fact(match), { ...BAG, ...bag });

describe('wordsOf', () => {
  it('reads the words alone, in lower case and without accents', () => {
    expect(wordsOf('Sidama, Ethiopia')).toEqual(['sidama', 'ethiopia']);
    expect(wordsOf('Café Señorío')).toEqual(['cafe', 'senorio']);
    expect(wordsOf("Kenya's SL28")).toEqual(['kenya', 's', 'sl28']);
    expect(wordsOf(null)).toEqual([]);
    expect(wordsOf('')).toEqual([]);
  });
});

describe('factFits (D200)', () => {
  it('reads a match word whole, whatever the case or the accents', () => {
    expect(fits({ origins: ['sidama'] }, { origin: 'Sidama, Ethiopia' })).toBe(true);
    expect(fits({ roasters: ['cafe imports'] }, { roaster: 'Café Imports' })).toBe(true);
    expect(fits({ origins: ['huila'] }, { origin: 'HUILA, Colombia' })).toBe(true);
    // Never a part of a word: a fact lists the plurals it fits itself.
    expect(fits({ varieties: ['geisha'] }, { name: 'Hacienda Geishas' })).toBe(false);
    expect(fits({ origins: ['kenya'] }, { origin: 'Kenyan blend', name: 'House' })).toBe(false);
  });

  it('reads a term of several words as those words together, in order', () => {
    expect(fits({ varieties: ['pink bourbon'] }, { name: 'Colombia Pink Bourbon', origin: null })).toBe(true);
    expect(fits({ varieties: ['pink bourbon'] }, { name: 'Pink Lady', origin: 'Bourbon County', notes: null })).toBe(false);
    expect(fits({ varieties: ['pink bourbon'] }, { name: 'Bourbon Pink', origin: null, notes: null })).toBe(false);
  });

  it('looks for each key in its own details of the bag', () => {
    // Roasters in the roaster only.
    expect(fits({ roasters: ['square mile'] })).toBe(true);
    expect(fits({ roasters: ['square mile'] }, { roaster: null, name: 'Square Mile Red Brick' })).toBe(false);
    // Origins in the origin and the name.
    expect(fits({ origins: ['kiambu'] }, { origin: null })).toBe(true);
    expect(fits({ origins: ['kenya'] }, { origin: null, name: 'Red Brick' })).toBe(false);
    // Processes in the process and the name.
    expect(fits({ processes: ['natural'] }, { process: null, name: 'Guji Natural' })).toBe(true);
    expect(fits({ processes: ['natural'] }, { process: 'washed' })).toBe(false);
    // Varieties in the name, the origin and the notes.
    expect(fits({ varieties: ['sl28'] }, { notes: 'SL28 and SL34; blackcurrant' })).toBe(true);
    expect(fits({ varieties: ['sl28'] }, { origin: 'Kenya, Nyeri, SL28' })).toBe(true);
    expect(fits({ varieties: ['sl28'] }, { name: 'Nyeri SL28', origin: null, notes: null })).toBe(true);
    expect(fits({ varieties: ['sl28'] }, { process: 'SL28 washed', name: 'Nyeri', origin: null, notes: null })).toBe(false);
    // Roast levels against the roast level, exactly.
    expect(fits({ roastLevels: ['light'] })).toBe(true);
    expect(fits({ roastLevels: ['light'] }, { roastLevel: 'medium-light' })).toBe(false);
    expect(fits({ roastLevels: ['light'] }, { roastLevel: null })).toBe(false);
  });

  it('fits when one of its keys other than the notes does', () => {
    expect(fits({ roasters: ['onyx coffee lab'], origins: ['kenya'] })).toBe(true);
    expect(fits({ roasters: ['onyx coffee lab'], origins: ['ethiopia'] })).toBe(false);
  });

  it('reads the notes as a condition of their own: a flavour shows only for a bag whose notes say it (D199)', () => {
    expect(fits({ origins: ['kenya'], notes: ['blackcurrant'] })).toBe(true);
    expect(fits({ origins: ['kenya'], notes: ['blackcurrant'] }, { notes: null })).toBe(false);
    expect(fits({ origins: ['kenya'], notes: ['blackcurrant'] }, { notes: 'jasmine, bergamot' })).toBe(false);
    expect(fits({ origins: ['ethiopia'], notes: ['blackcurrant'] })).toBe(false);
    // Notes alone.
    expect(fits({ notes: ['grapefruit'] })).toBe(true);
    expect(fits({ notes: ['grapefruit'] }, { notes: 'grapefruits' })).toBe(false);
  });

  it('fits every bag with a general fact, and a match without words is one', () => {
    expect(factFits(fact(), BAG)).toBe(true);
    expect(factFits(fact(), { name: 'New bag', roaster: null, origin: null, process: null, notes: null, roastLevel: null })).toBe(true);
    expect(factFits(fact({}), BAG)).toBe(true);
    expect(factFits(fact({ origins: [], notes: [] }), BAG)).toBe(true);
  });
});

describe('isBagFact', () => {
  it('is a fact whose match names at least one word', () => {
    expect(isBagFact(fact({ origins: ['kenya'] }))).toBe(true);
    expect(isBagFact(fact({ roastLevels: ['dark'] }))).toBe(true);
    expect(isBagFact(fact())).toBe(false);
    expect(isBagFact(fact({}))).toBe(false);
    expect(isBagFact(fact({ varieties: [] }))).toBe(false);
  });
});

describe('matchedKeys', () => {
  it("lists the keys the bag's details say, a roaster first and a roast level last", () => {
    const match: FactMatch = { roastLevels: ['light'], notes: ['grapefruit'], origins: ['kenya'], roasters: ['square mile'], processes: ['natural'] };
    expect(matchedKeys(fact(match), BAG)).toEqual(['roasters', 'origins', 'notes', 'roastLevels']);
    expect(matchedKeys(fact(), BAG)).toEqual([]);
  });
});

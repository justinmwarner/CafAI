import { describe, expect, it } from 'vitest';
import { isBagFact, type BagFacts } from './match.ts';
import { pickFact, toldLabels } from './pick.ts';
import { coachKey, type ToldEntry } from './told.ts';
import type { FactMatch, FactTopic, FunFact } from './types.ts';

const fact = (id: string, topic: FactTopic, match?: FactMatch): FunFact => ({
  id,
  topic,
  about: `About ${id}`,
  text: `A fact about ${id}.`,
  source: `https://example.org/${id}`,
  ...(match ? { match } : {}),
});

// The bag's own facts, one or two of each kind, listed out of the order they are told in.
const ROAST = fact('light-roast-density', 'roasting', { roastLevels: ['light'] });
const NOTES = fact('blackcurrant-source', 'flavour', { notes: ['blackcurrant'] });
const PROCESS = fact('washed-fermentation', 'process', { processes: ['washed'] });
const KENYA = fact('kenya-auction', 'origin', { origins: ['kenya'] });
const KIAMBU = fact('kiambu-altitude', 'origin', { origins: ['kiambu'] });
const SL28 = fact('sl28-selection', 'variety', { varieties: ['sl28'] });
const ONYX = fact('onyx-founding', 'roaster', { roasters: ['onyx coffee lab'] });
const OWN = [ROAST, NOTES, PROCESS, KENYA, KIAMBU, SL28, ONYX];
const GENERAL = [fact('crema-co2', 'science'), fact('rosetta-pour', 'milk'), fact('backflush-weekly', 'care')];
/** Fits another coffee only. */
const ETHIOPIA = fact('ethiopia-forest', 'origin', { origins: ['ethiopia'] });
const FACTS = [...OWN, ETHIOPIA, ...GENERAL];

const BAG: BagFacts & { id: string } = {
  id: 'bag-1',
  name: 'Kiambu AA SL28',
  roaster: 'Onyx Coffee Lab',
  origin: 'Kenya, Kiambu',
  process: 'washed',
  notes: 'blackcurrant, grapefruit',
  roastLevel: 'light',
};

const toldAs = (key: string, bagId = BAG.id, minute = 0): ToldEntry => ({ key, bagId, at: `2026-10-16T08:${String(minute).padStart(2, '0')}:00.000Z` });

/** Pick `count` facts one after the other, each told as it is picked; their ids. */
function tell(count: number, facts: readonly FunFact[] = FACTS, bag = BAG, told: ToldEntry[] = []): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const next = pickFact(facts, bag, told);
    if (!next) break;
    ids.push(next.id);
    told.push(toldAs(next.id, bag.id, told.length));
  }
  return ids;
}

describe('pickFact (D200)', () => {
  it('has nothing to tell from an empty list, or one with nothing for this bag', () => {
    expect(pickFact([], BAG, [])).toBeNull();
    expect(pickFact([ETHIOPIA], BAG, [])).toBeNull();
  });

  it("tells the bag's own facts by kind: a roaster, a variety, an origin, a process, the notes, the roast level", () => {
    const own = tell(OWN.length + GENERAL.length).filter((id) => isBagFact(FACTS.find((f) => f.id === id)!));
    expect(own[0]).toBe(ONYX.id);
    expect(own[1]).toBe(SL28.id);
    expect(own.slice(2, 4).sort()).toEqual([KENYA.id, KIAMBU.id]);
    expect(own.slice(4)).toEqual([PROCESS.id, NOTES.id, ROAST.id]);
  });

  it('alternates them with a general fact while both last, then tells what is left', () => {
    const kinds = tell(OWN.length + GENERAL.length).map((id) => (isBagFact(FACTS.find((f) => f.id === id)!) ? 'own' : 'general'));
    expect(kinds).toEqual(['own', 'general', 'own', 'general', 'own', 'general', 'own', 'own', 'own', 'own']);
    // A bag with nothing of its own gets the general facts, each once before any comes back.
    const house = tell(4, FACTS, { ...BAG, id: 'bag-x', name: 'House', roaster: null, origin: null, process: null, notes: null, roastLevel: null });
    expect(house.slice(0, 3).sort()).toEqual(GENERAL.map((f) => f.id).sort());
    expect(house[3]).toBe(house[0]);
  });

  it("shuffles each kind by the bag's id: the same order every time for a bag, another for another bag", () => {
    const many = Array.from({ length: 12 }, (_, i) => fact(`general-${i}`, 'history'));
    const firstFor = (id: string) => pickFact(many, { ...BAG, id }, [])!.id;
    expect(firstFor('bag-1')).toBe(firstFor('bag-1'));
    expect(tell(12, many)).toEqual(tell(12, many));
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => firstFor(`bag-${i}`)));
    expect(firsts.size).toBeGreaterThan(1);
    // Every fact still comes once before any comes twice.
    expect(new Set(tell(12, many)).size).toBe(12);
  });

  it('skips a fact told already, for any bag, and a fact the coach shared as its own (by its label)', () => {
    // Told for another bag: the roaster fact waits. This bag has told nothing yet, so its own facts come first.
    expect(pickFact(FACTS, BAG, [toldAs(ONYX.id, 'bag-2')])!.id).toBe(SL28.id);
    // The scripted coach shares a fact from the list as its own, and a real coach may echo one: told by its label.
    expect(pickFact(FACTS, BAG, [toldAs(coachKey(ONYX.about), 'bag-2')])!.id).toBe(SL28.id);
    expect(pickFact(FACTS, BAG, [toldAs(coachKey(`  ${ONYX.about.toUpperCase()} `), 'bag-2')])!.id).toBe(SL28.id);
  });

  it("counts the coach's own fact as the bag's: a general one comes next", () => {
    const next = pickFact(FACTS, BAG, [toldAs('coach:a farm in kiambu')]);
    expect(isBagFact(next!)).toBe(false);
  });

  it('starts again with the fact told longest ago once every fact that fits was told', () => {
    const told: ToldEntry[] = [];
    const first = tell(OWN.length + GENERAL.length, FACTS, BAG, told);
    expect(new Set(first).size).toBe(10);
    // The other bag's fact never comes in.
    expect(first).not.toContain(ETHIOPIA.id);
    expect(tell(3, FACTS, BAG, told)).toEqual(first.slice(0, 3));

    // Told again later, under the coach's label: that telling counts.
    const all = [...OWN, ...GENERAL].map((f, i) => toldAs(f.id, BAG.id, i));
    expect(pickFact(FACTS, BAG, all)!.id).toBe(OWN[0]!.id);
    expect(pickFact(FACTS, BAG, [...all, toldAs(coachKey(OWN[0]!.about), BAG.id, 30)])!.id).toBe(OWN[1]!.id);
  });
});

describe('toldLabels', () => {
  it('names the facts told most recently, newest first, each once: the coach’s by their labels', () => {
    const told = [toldAs(ONYX.id), toldAs('coach:a farm in kiambu'), toldAs(KENYA.id, 'bag-2'), toldAs(ONYX.id), toldAs('retired-fact')];
    expect(toldLabels(told, FACTS)).toEqual([ONYX.about, KENYA.about, 'a farm in kiambu']);
  });

  it('names 40 by default, or as many as asked', () => {
    const many = Array.from({ length: 50 }, (_, i) => fact(`general-${i}`, 'history'));
    const told = many.map((f, i) => toldAs(f.id, BAG.id, i));
    const labels = toldLabels(told, many);
    expect(labels).toHaveLength(40);
    expect(labels[0]).toBe('About general-49');
    expect(toldLabels(told, many, 3)).toEqual(['About general-49', 'About general-48', 'About general-47']);
    expect(toldLabels([], many)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { GRINDER_LIMITS } from '../api/grinders.ts';
import {
  AUTO_TOOLS,
  BAG_LIMITS,
  GRINDER_OFFER_LIMITS,
  OfferGrinderInput,
  SaveBagDetailsInput,
  ShareFunFactInput,
  TOOL,
  TOOL_INPUTS,
  UI_TOOLS,
  toRoastLevel,
} from './contract.ts';
import { FACT_TOPICS } from './facts/types.ts';

const KIAMBU = { name: 'Kiambu AA', roaster: 'Square Mile', origin: 'Kenya', roastLevel: 'light', process: 'washed', notes: null };

describe('save_bag_details', () => {
  it('takes the roast date as YYYY-MM-DD, or null when the bag does not say (6.1)', () => {
    expect(SaveBagDetailsInput.safeParse({ ...KIAMBU, roastDate: '2026-10-01' })).toMatchObject({ success: true, data: { roastDate: '2026-10-01' } });
    expect(SaveBagDetailsInput.safeParse({ ...KIAMBU, roastDate: null })).toMatchObject({ success: true, data: { roastDate: null } });
    for (const roastDate of ['1 Oct 2026', '2026-02-30', '2026-10-01T08:00:00Z', '']) {
      expect(SaveBagDetailsInput.safeParse({ ...KIAMBU, roastDate }).success, roastDate).toBe(false);
    }
  });

  it('asks for every key, as strict tool use does', () => {
    expect(SaveBagDetailsInput.safeParse(KIAMBU).success).toBe(false);
  });

  it('keeps the limits the confirm card shows in the schema', () => {
    const long = (n: number) => 'x'.repeat(n);
    const base = { ...KIAMBU, roastDate: null };
    for (const [field, max] of Object.entries(BAG_LIMITS)) {
      expect(SaveBagDetailsInput.safeParse({ ...base, [field]: long(max) }).success, field).toBe(true);
      expect(SaveBagDetailsInput.safeParse({ ...base, [field]: long(max + 1) }).success, field).toBe(false);
    }
  });
});

describe('get_recent_setups', () => {
  it('is an automatic tool with no input (6.5)', () => {
    expect(TOOL.getRecentSetups).toBe('get_recent_setups');
    expect(AUTO_TOOLS).toContain(TOOL.getRecentSetups);
    expect(UI_TOOLS).not.toContain(TOOL.getRecentSetups);
    expect(TOOL_INPUTS[TOOL.getRecentSetups].safeParse({}).success).toBe(true);
  });
});

describe('offer_grinder (D125)', () => {
  const PHILOS = { model: 'Mazzer Philos', burrs: '64 mm flat', settingType: 'numeric', smallStep: 0.5, bigStep: null, values: null };

  it('is a UI tool: nothing is added before the user taps Add', () => {
    expect(TOOL.offerGrinder).toBe('offer_grinder');
    expect(UI_TOOLS).toContain(TOOL.offerGrinder);
    expect(AUTO_TOOLS).not.toContain(TOOL.offerGrinder);
    expect(TOOL_INPUTS[TOOL.offerGrinder]).toBe(OfferGrinderInput);
  });

  it('asks for every key, as strict tool use does, and takes either kind of dial', () => {
    expect(OfferGrinderInput.safeParse(PHILOS).success).toBe(true);
    const { burrs: _burrs, ...withoutBurrs } = PHILOS;
    expect(OfferGrinderInput.safeParse(withoutBurrs).success).toBe(false);
    expect(OfferGrinderInput.safeParse({ ...PHILOS, settingType: 'preset', smallStep: null, values: ['1', '2'] }).success).toBe(true);
    expect(OfferGrinderInput.safeParse({ ...PHILOS, burrs: null, settingType: null, smallStep: null }).success).toBe(true);
  });

  it('refuses a step that cannot move a dial, an empty list of settings, and text longer than Settings takes', () => {
    for (const bad of [
      { smallStep: 0 },
      { bigStep: -1 },
      { values: [] },
      { values: [' '] },
      { model: ' ' },
      { model: 'x'.repeat(61) },
      { values: ['x'.repeat(21)] },
      { settingType: 'stepless' },
    ]) {
      expect(OfferGrinderInput.safeParse({ ...PHILOS, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("keeps the limits of Settings' Add a grinder", () => {
    expect(GRINDER_OFFER_LIMITS).toEqual(GRINDER_LIMITS);
  });
});

describe('share_fun_fact (D201)', () => {
  const FACT = { topic: 'variety', about: "Kenya's SL28", fact: 'SL28 was selected in Kenya in the 1930s.', source: null };

  it('is an automatic tool: CafAI shows the fact and answers at once', () => {
    expect(TOOL.shareFunFact).toBe('share_fun_fact');
    expect(AUTO_TOOLS).toContain(TOOL.shareFunFact);
    expect(UI_TOOLS).not.toContain(TOOL.shareFunFact);
    expect(TOOL_INPUTS[TOOL.shareFunFact]).toBe(ShareFunFactInput);
  });

  it('takes one of the fact topics, a label of at most 80 characters, the fact in at most 280 and its page or null', () => {
    expect(ShareFunFactInput.safeParse(FACT)).toMatchObject({ success: true, data: FACT });
    expect(ShareFunFactInput.safeParse({ ...FACT, source: 'https://varieties.worldcoffeeresearch.org/varieties/sl28' }).success).toBe(true);
    expect(ShareFunFactInput.safeParse({ ...FACT, about: '  SL28  ' })).toMatchObject({ success: true, data: { about: 'SL28' } });
    for (const topic of FACT_TOPICS) expect(ShareFunFactInput.safeParse({ ...FACT, topic }).success, topic).toBe(true);
    for (const bad of [
      { topic: 'gossip' },
      { about: ' ' },
      { about: 'x'.repeat(81) },
      { fact: '' },
      { fact: 'x'.repeat(281) },
      { source: 'x'.repeat(401) },
      { source: undefined },
    ]) {
      expect(ShareFunFactInput.safeParse({ ...FACT, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('toRoastLevel', () => {
  it("matches CafAI's five roast levels whatever the case", () => {
    expect(toRoastLevel('Light')).toBe('light');
    expect(toRoastLevel(' MEDIUM-DARK ')).toBe('medium-dark');
    expect(toRoastLevel('medium light')).toBe('medium-light');
    expect(toRoastLevel('Medium_Dark')).toBe('medium-dark');
  });

  it('gives null for anything else', () => {
    for (const value of ['City+', 'very dark', 'light roast', '', null, undefined, 3]) expect(toRoastLevel(value), String(value)).toBeNull();
  });
});

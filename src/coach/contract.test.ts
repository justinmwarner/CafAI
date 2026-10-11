import { describe, expect, it } from 'vitest';
import { GRINDER_LIMITS } from '../api/grinders.ts';
import {
  AUTO_TOOLS,
  BAG_LIMITS,
  GRINDER_OFFER_LIMITS,
  OfferGrinderInput,
  SaveBagDetailsInput,
  TOOL,
  TOOL_INPUTS,
  UI_TOOLS,
  toRoastLevel,
} from './contract.ts';

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

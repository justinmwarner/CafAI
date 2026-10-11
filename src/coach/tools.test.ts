import { describe, expect, it } from 'vitest';

import { AUTO_TOOLS, TEMPLATE_IDS, TOOL, UI_TOOLS, type ToolName } from './contract.ts';
import { COACH_TOOL_SPECS } from './tools.ts';

describe('COACH_TOOL_SPECS', () => {
  const names = Object.values(TOOL) as ToolName[];

  it('describes every contract tool, with the kind the contract gives it', () => {
    expect(Object.keys(COACH_TOOL_SPECS).sort()).toEqual([...names].sort());
    for (const name of UI_TOOLS) expect(COACH_TOOL_SPECS[name].kind, name).toBe('ui');
    for (const name of AUTO_TOOLS) expect(COACH_TOOL_SPECS[name].kind, name).toBe('auto');
  });

  it('keeps descriptions concise and free of claims about tools CafAI does not attach', () => {
    for (const name of names) {
      const { description } = COACH_TOOL_SPECS[name];
      expect(description.length, name).toBeGreaterThan(60);
      expect(description.length, name).toBeLessThan(900);
      expect(description, name).not.toMatch(/web search|browse/i);
    }
  });

  it('states the rules the validators enforce', () => {
    expect(COACH_TOOL_SPECS.ask_user.description).toMatch(/2-5 short options/);
    expect(COACH_TOOL_SPECS.ask_user.description).toMatch(/Never include "Other"; the app adds it/);
    expect(COACH_TOOL_SPECS.ask_user.description).toMatch(/with the word "taste" in the question \(e\.g\. "How did it taste\?"\)/);
    expect(COACH_TOOL_SPECS.ask_user.description).toMatch(/only the answer to a question that mentions taste is saved as the shot's taste/);
    expect(COACH_TOOL_SPECS.propose_adjustment.description).toMatch(/ONE variable/);
    expect(COACH_TOOL_SPECS.propose_adjustment.description).toMatch(/lever ids and bounds from the template catalog/);
    expect(COACH_TOOL_SPECS.propose_adjustment.description).toMatch(/12-25 g, at most 1 g/);
    expect(COACH_TOOL_SPECS.propose_adjustment.description).toMatch(/at most 5/);
    for (const id of TEMPLATE_IDS) expect(COACH_TOOL_SPECS.propose_templates.description).toContain(id);
    expect(COACH_TOOL_SPECS.get_shot_series.description).toMatch(/resistance/);
    expect(COACH_TOOL_SPECS.get_shot_summary.description).toMatch(/"latest", "previous"/);
  });

  it('offers a grinder once, on a card of its own, with what the user said and nothing guessed (D125)', () => {
    const { description } = COACH_TOOL_SPECS.offer_grinder;
    expect(description).toMatch(/Call it once, with no other card in the reply/);
    expect(description).toMatch(/only as they said them, else null; never guess/);
    expect(description).toMatch(/nothing is added without the tap/);
    expect(description).toMatch(/\{"added":true,"alreadyInDecaid":true\|false,"grinder":\{as in the context\}\}/);
    expect(description).toMatch(/\{"added":false\}/);
  });

  it('asks save_bag_details for the roast date as YYYY-MM-DD, null when the bag does not say (6.1)', () => {
    const { description } = COACH_TOOL_SPECS.save_bag_details;
    expect(description).toMatch(/roast date \(YYYY-MM-DD\)/);
    expect(description).toMatch(/Use null for anything the user has not told you; never guess/);
  });

  it('asks a correction to send every detail again as saved, since each call replaces them all', () => {
    const { description } = COACH_TOOL_SPECS.save_bag_details;
    expect(description).toMatch(/again only when the user corrects a detail: then send every detail as it was saved/);
    expect(description).toMatch(/each call replaces all of them/);
  });

  it("describes DYE2's recent setups, what each holds, when there is no DYE2, and that it is for intake (6.5)", () => {
    const { description, kind } = COACH_TOOL_SPECS.get_recent_setups;
    expect(kind).toBe('auto');
    for (const field of ['kind', 'sameBatch', 'profileTitle', 'grindSetting', 'doseG', 'yieldG', 'rpm', 'basket', 'date']) expect(description).toContain(field);
    expect(description).toMatch(/equipment and basket names/);
    expect(description).toContain('{"available":false}');
    expect(description).toMatch(/at intake/);
    expect(description).toMatch(/batch/);
    expect(description).toMatch(/name and roaster/);
  });

  it('says a recent setup was only used, not that it worked, and to look once the bag has its name', () => {
    const { description } = COACH_TOOL_SPECS.get_recent_setups;
    expect(description).toMatch(/"recent" is one DYE2 saw used lately, which says nothing about how it tasted/);
    expect(description).toMatch(/"favourite" and "recipe" are ones the user saved/);
    expect(description).toMatch(/sameBatch is false for an earlier batch of the same bean/);
    expect(description).toMatch(/after save_bag_details/);
    expect(description).not.toMatch(/worked/);
  });
});

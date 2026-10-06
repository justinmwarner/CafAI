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
});

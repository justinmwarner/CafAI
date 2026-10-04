// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/prompt.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: cases that still apply, rewritten for a fixed system prompt.
import { describe, expect, it } from 'vitest';

import { EVENT, TOOL, TEMPLATE_IDS } from './contract.ts';
import { COACH_HEURISTICS } from './heuristics.ts';
import { formatLeverValue } from './diff.ts';
import { readLeverValue } from './levers.ts';
import { buildSystemPrompt } from './prompt.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';

const prompt = buildSystemPrompt(TEMPLATES);

describe('buildSystemPrompt: determinism', () => {
  it('is byte-identical on every call, so it caches', () => {
    expect(buildSystemPrompt(TEMPLATES)).toBe(prompt);
    expect(buildSystemPrompt([...TEMPLATES])).toBe(prompt);
  });

  it('contains no dates, ids or other per-call values', () => {
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt).not.toMatch(/profile:[0-9a-f]{20}/);
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('has no runs of blank lines', () => {
    expect(prompt).not.toMatch(/\n\n\n/);
  });
});

describe('buildSystemPrompt: content', () => {
  it('sets the role and the tone for a tablet', () => {
    expect(prompt).toMatch(/espresso/i);
    expect(prompt).toMatch(/at most about 120 words/);
    expect(prompt).toMatch(/no tables/i);
  });

  it('lists every template and every lever with label, unit, bounds and maximum change', () => {
    for (const template of TEMPLATES) {
      expect(prompt).toContain(`${template.id}: ${template.name}`);
      const block = prompt.split('\n## ').find((b) => b.startsWith(`${template.id}: `))!;
      expect(block, template.id).toBeDefined();
      for (const lever of template.levers) {
        const line = block.split('\n').find((l) => l.includes(`\`${lever.id}\``) && l.includes(lever.label));
        expect(line, `${template.id}.${lever.id}`).toBeDefined();
        expect(line).toContain(`${formatLeverValue(lever, lever.min).replace(` ${lever.unit}`, '')}-${formatLeverValue(lever, lever.max)}`);
        expect(line).toContain(`at most ${formatLeverValue(lever, lever.maxDelta)} per change`);
        if (lever.id === 'yield') {
          // v1's yield follows the dose (D57), so the bundled stop is not where it starts.
          expect(line).toMatch(/; v1 starts at \d\.\d x dose \(\d+ g for 18 g\)\./);
          expect(line).not.toContain('template value');
        } else {
          expect(line).toContain(`template value ${formatLeverValue(lever, readLeverValue(template, template.profile, lever.id))}`);
        }
        expect(line).toContain(lever.description);
      }
    }
    for (const id of TEMPLATE_IDS) expect(prompt).toContain(id);
  });

  it('states dose-relative yield bounds, the scale need and the Londonium gap', () => {
    expect(prompt).toMatch(/2\.0-3\.5 x dose/);
    expect(prompt).toMatch(/`soakWeight`.*needs a connected scale/);
    expect(prompt).toMatch(/peak pressure must stay at least 1\.0 bar above the decline end pressure/i);
  });

  it('says every yield needs a scale, and gives the Allongé its long ratio and 10 g steps', () => {
    const block = (id: string) => prompt.split('\n## ').find((b) => b.startsWith(`${id}: `))!;
    for (const template of TEMPLATES) {
      const line = block(template.id)
        .split('\n')
        .find((l) => l.startsWith('- `yield`'))!;
      expect(line, template.id).toContain('It needs a connected scale.');
    }
    expect(block('allonge')).toMatch(
      /`yield` Yield: 50-135 g and 4\.0-6\.0 x dose, steps of 1 g, at most 10 g per change; v1 starts at 5\.0 x dose \(90 g for 18 g\)\. It needs a connected scale\./,
    );
    expect(block('gentle-and-sweet')).toMatch(/Constraint: Peak pressure must stay at least 1\.0 bar above the decline end pressure/);
    expect(block('allonge')).not.toMatch(/Constraint:/);
  });

  it("says where each template's v1 yield starts: the author's ratio, and its grams at 18 g", () => {
    const yieldLine = (id: string) =>
      prompt
        .split('\n## ')
        .find((b) => b.startsWith(`${id}: `))!
        .split('\n')
        .find((l) => l.startsWith('- `yield`'))!;
    expect(yieldLine('blooming-espresso')).toContain('2.0-3.5 x dose, steps of 1 g, at most 4 g per change; v1 starts at 2.8 x dose (50 g for 18 g).');
    expect(yieldLine('d-flow')).toContain('1.8-3.0 x dose, steps of 1 g, at most 4 g per change; v1 starts at 2.8 x dose (50 g for 18 g).');
    expect(yieldLine('londonium')).toContain('1.5-2.8 x dose, steps of 1 g, at most 4 g per change; v1 starts at 2.0 x dose (36 g for 18 g).');
    expect(yieldLine('allonge')).toContain('4.0-6.0 x dose, steps of 1 g, at most 10 g per change; v1 starts at 5.0 x dose (90 g for 18 g).');
    expect(yieldLine('gentle-and-sweet')).toContain('1.5-3.0 x dose, steps of 1 g, at most 4 g per change; v1 starts at 2.0 x dose (36 g for 18 g).');
    // The bundled stops (60, 42, 135 g) would mislead the model about v1.
    for (const id of ['blooming-espresso', 'londonium', 'allonge']) {
      const start = yieldLine(id).split('per change; ')[1]!;
      expect(start, id).not.toContain(`${getTemplate(id)!.profile.target_weight} g`);
    }
  });

  it("tells the model where the Blooming pour tops out and that the Allongé stops near 5x the dose", () => {
    expect(prompt).toContain('about 57 g at 2.2 ml/s');
    expect(prompt).toContain('It stops at about 5x the dose (90 g for 18 g).');
    expect(prompt).toContain('Shape: One steady 4.5 ml/s pour capped at 8.6 bar, stopping at about 5x the dose.');
  });

  it('describes grind and dose as manual variables with their limits', () => {
    expect(prompt).toMatch(/grind.*more than 0 and at most 5/);
    expect(prompt).toMatch(/12-25 g.*at most 1 g/);
    expect(prompt).toMatch(/ITS own dial/);
  });

  it('documents every event marker and payload the engine sends', () => {
    for (const marker of Object.values(EVENT)) expect(prompt).toContain(marker);
    for (const key of ['"shotRef"', '"levers"', '"targetYieldG"', '"picked"', '"uploaded"', '"selected"', '"other"', '"applied"', '"answered":false']) {
      expect(prompt).toContain(key);
    }
  });

  it('names exactly the attached tools and claims nothing else', () => {
    for (const name of Object.values(TOOL)) expect(prompt).toContain(name);
    // Crema told the model it had web search when no tool was attached.
    expect(prompt).not.toMatch(/you have web search|search the web|look (it|this) up online/i);
    expect(prompt).toMatch(/cannot browse the web/);
  });

  it('keeps the rules: one variable, bounds, no invented levers, explain what levers cannot do', () => {
    expect(prompt).toMatch(/ONE variable per shot/);
    expect(prompt).toMatch(/Never invent levers/);
    expect(prompt).toMatch(/no lever can do/);
  });

  it('locks in a good shot instead of tinkering', () => {
    expect(prompt).toMatch(/LOCK IT IN/);
    expect(prompt).toMatch(/variable "none"/);
  });

  it('names both failure modes when the user pushes back', () => {
    expect(prompt).toMatch(/never just repeat the same words/);
    expect(prompt).toMatch(/never cave reflexively/);
  });

  it('is explicit that intake has no shot data', () => {
    expect(prompt).toMatch(/There is NO shot data at intake/);
  });

  it('treats the grind on the dial as a position, not a recommendation', () => {
    expect(prompt).toMatch(/left over from whatever was brewed before/);
  });

  it('keeps uncertainty out of the rationale', () => {
    expect(prompt).toMatch(/Do not write about your own uncertainty there/);
  });

  it('reads the clock, the stall pressure and the channeling flags correctly', () => {
    expect(prompt).toMatch(/t = 0 is the first sample, the start of preheat/);
    expect(prompt).toMatch(/STALL PRESSURE/);
    for (const flag of ['pressure_dip_after_peak', 'flow_instability', 'pump_scale_divergence', 'early_first_drops', 'resistance_falling']) {
      expect(prompt).toContain(flag);
    }
  });

  it('puts the rules after the catalog and the data guide, where they still bind', () => {
    const catalog = prompt.indexOf('# Template catalog');
    const reading = prompt.indexOf('# Reading a shot');
    const rules = prompt.indexOf('# Rules');
    expect(catalog).toBeGreaterThan(0);
    expect(reading).toBeGreaterThan(catalog);
    expect(rules).toBeGreaterThan(reading);
  });
});

describe('buildSystemPrompt: the heuristics seam', () => {
  it('includes the placeholder heuristics as one clearly marked block', () => {
    expect(COACH_HEURISTICS.status).toBe('placeholder');
    expect(prompt).toContain('<heuristics status="placeholder">');
    expect(prompt).toContain('</heuristics>');
    expect(prompt).toContain(COACH_HEURISTICS.text);
  });

  it('swaps the block without touching anything else', () => {
    const swapped = buildSystemPrompt(TEMPLATES, { heuristics: { status: 'reviewed', text: 'Reviewed rules.' } });
    expect(swapped).toContain('<heuristics status="reviewed">\nReviewed rules.\n</heuristics>');
    const strip = (text: string) => text.replace(/<heuristics[\s\S]*<\/heuristics>/, '');
    expect(strip(swapped)).toBe(strip(prompt));
  });
});

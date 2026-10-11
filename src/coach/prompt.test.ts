// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/prompt.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: cases that still apply, rewritten for a fixed system prompt.
import { describe, expect, it } from 'vitest';

import { EVENT, TOOL, TEMPLATE_IDS } from './contract.ts';
import { COACH_HEURISTICS } from './heuristics.ts';
import { formatLeverValue } from './diff.ts';
import { readLeverValue } from './levers.ts';
import { buildSystemPrompt, roastLine } from './prompt.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';

const prompt = buildSystemPrompt(TEMPLATES);
const loopOf = (text: string) => text.slice(text.indexOf('# The loop'), text.indexOf('# Template catalog'));

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
    for (const key of [
      '"shotRef"',
      '"levers"',
      '"targetYieldG"',
      '"picked"',
      '"yieldG"',
      '"doseG"',
      '"uploaded"',
      '"selected"',
      '"other"',
      '"applied"',
      '"answered":false',
      '"settingType"',
      '"step"',
      '"values"',
      '"linked"',
      '"onMachine"',
      '"loadError"',
      '"bag"',
      '"roast"',
    ]) {
      expect(prompt).toContain(key);
    }
  });

  it("says details from Decaid's bean library or a confirmed bag photo are already saved, and how the roast reads (6.1, 6.8)", () => {
    const intake = loopOf(prompt)
      .split('\n')
      .find((line) => line.startsWith('1. Intake.'))!;
    expect(intake).toContain(
      '"bag":{"name":string,"roaster":string|null,"origin":string|null,"roastLevel":string|null,"process":string|null,"notes":string|null,"roastDate":string|null}|null,"roast":string|null,"today":"YYYY-MM-DD"}',
    );
    expect(intake).toMatch(/"bag" is set when the user picked the coffee from Decaid's bean library or confirmed the details read from a photo of the bag/);
    expect(intake).toMatch(/already saved, so call save_bag_details only to correct one, with every other detail as saved/);
    expect(intake).toContain('"Roasted YYYY-MM-DD (n days ago; m days in the freezer not counted)"');
    expect(intake).toMatch(/null when the roast date is unknown/);
  });

  it("gives today's date at intake, to read a roast date said in words (6.1)", () => {
    const intake = loopOf(prompt)
      .split('\n')
      .find((line) => line.startsWith('1. Intake.'))!;
    expect(intake).toMatch(/"today" is the date where the user is/);
    expect(intake).toMatch(/"roasted 28 September" is the latest 28 September that is not after today/);
    expect(intake).toMatch(/"roasted 3 days ago" counts back from today/);
  });

  it('gives the roast and the day with every shot, counted to the day of the shot (6.1)', () => {
    const shot = loopOf(prompt)
      .split('\n')
      .find((line) => line.startsWith('3. Shot completed.'))!;
    expect(shot).toContain('"grinder":{the same fields as at intake},"roast":string|null,"today":"YYYY-MM-DD","summary":{aggregates and phases}}');
    expect(shot).toMatch(/"roast" reads as at intake, counted to the day of the shot/);
    // A date said in words days after intake counts from the latest day the coach was given.
    expect(shot).toMatch(/"today" is the day of the shot: a roast date said in words after it counts from there/);
  });

  it('tells a connected machine that has not confirmed a version from one that is away (loadError)', () => {
    const loop = prompt.slice(prompt.indexOf('# The loop'), prompt.indexOf('# Template catalog'));
    const picked = loop.split('\n').find((line) => line.startsWith('2. Template picked.'))!;
    const decision = loop.split('\n').find((line) => line.startsWith('5. Decision.'))!;
    expect(picked).toContain('"uploaded":true|false,"onMachine":true|false|null,"loadError":string|null,"note":string|null}');
    expect(decision).toContain('"onMachine":true|false|null,"loadError":string|null}');
    for (const line of [picked, decision]) {
      expect(line).toMatch(/If loadError is set, the machine is connected but has not confirmed the version/);
      expect(line).toMatch(/tap Retry above/);
      expect(line).toMatch(/never say that Decaid loads it when the machine connects/);
    }
    expect(picked).toMatch(/If onMachine is false the machine is not connected/);
  });

  it('tells the model the dose at intake and where v1 stops (D57)', () => {
    const loop = prompt.slice(prompt.indexOf('# The loop'), prompt.indexOf('# Template catalog'));
    expect(loop).toContain('"scaleConnected":boolean,"doseG":number|null,"bag":');
    expect(loop).toMatch(/doseG is the dose set in Decaid when CafAI coaches from it \(12-25 g\), else null/);
    expect(loop).toContain('{"picked":"<templateId>","version":1,"title":"<Bag> v1","yieldG":number,"doseG":number|null,"uploaded":true|false,');
    expect(loop).toMatch(/yieldG is where v1 stops: the template's start ratio times doseG, or times 18 g when doseG is null/);
  });

  it('asks for the word "taste" in the taste question, since only its answer is kept as the shot\'s taste', () => {
    const loop = prompt.slice(prompt.indexOf('# The loop'), prompt.indexOf('# Template catalog'));
    const shot = loop.split('\n').find((line) => line.startsWith('3. Shot completed.'))!;
    const taste = loop.split('\n').find((line) => line.startsWith('4. Taste.'))!;
    expect(shot).toContain('call ask_user for the taste, with the word "taste" in the question (for example "How did it taste?")');
    expect(taste).toMatch(/CafAI keeps an answer as the shot's taste only when its question mentions taste/);
    expect(taste).toMatch(/keep that word out of any other question/);
  });

  it("gives the grinder object with its dial from Decaid's grinder library, at intake and with every shot (D62)", () => {
    const grinder =
      '"grinder":{"name":string|null,"setting":string|null,"settingType":"numeric"|"preset"|null,"step":number|null,"values":string[]|null,"linked":boolean}';
    const loop = prompt.slice(prompt.indexOf('# The loop'), prompt.indexOf('# Template catalog'));
    const intake = loop.split('\n').find((line) => line.startsWith('1. Intake.'))!;
    const shot = loop.split('\n').find((line) => line.startsWith('3. Shot completed.'))!;
    expect(intake).toContain(grinder);
    expect(shot).toContain('"grinder":{the same fields as at intake}');
  });

  it("asks for moves in the grinder's own steps when Decaid knows them, and says CafAI works them out or checks them", () => {
    const manual = prompt.slice(prompt.indexOf('# Manual variables'), prompt.indexOf('# Reading a shot'));
    expect(manual).toMatch(/When step or values is known, move in those steps and give the new setting/);
    expect(manual).toContain('from "15" with step 0.5, one step finer is "14.5"');
    expect(manual).toMatch(/CafAI works the setting out from the steps, or checks yours against Decaid's grinder library/);
    expect(manual).toMatch(/lower numbers are finer/);
    expect(manual).toMatch(/finest first/);
  });

  it('asks for directions only for a linked grinder Decaid has no steps for, as Settings tells the user (D62)', () => {
    const manual = prompt.slice(prompt.indexOf('# Manual variables'), prompt.indexOf('# Reading a shot'));
    expect(manual).toMatch(/"linked" is true when the grinder is linked from Decaid's grinder library/);
    expect(manual).toMatch(/linked but step and values are null.*give the direction and the amount only, with setting null/);
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
    // The shot time is the pour, as on the shot card and the machine panel, not a time on that clock.
    expect(prompt).toContain(
      'durationS is not a time on that clock but the length of the pour, from the end of preheat to the end of the pour: the shot time the user sees on the shot card and the machine panel.',
    );
    expect(prompt).toMatch(/STALL PRESSURE/);
    for (const flag of ['pressure_dip_after_peak', 'flow_instability', 'pump_scale_divergence', 'early_first_drops', 'resistance_falling']) {
      expect(prompt).toContain(flag);
    }
  });

  it('asks for a time told to the user to count from the start of the pour, as the shot card counts it', () => {
    const reading = prompt.slice(prompt.indexOf('# Reading a shot'), prompt.indexOf('# Coaching heuristics'));
    const clock = reading.split('\n').find((line) => line.startsWith('- t = 0 is the first sample'))!;
    expect(clock).toContain(
      'When you tell the user a time on that clock, count it from the start of the pour as the shot card does: the time minus pourStartS, where the pour starts.',
    );
  });

  describe("leaves the taste to the barista (D127)", () => {
    const taste = prompt.slice(prompt.indexOf("# Taste is the barista's"), prompt.indexOf('# Rules'));

    it('has its own section after the heuristics it qualifies, before the rules', () => {
      expect(prompt.indexOf("# Taste is the barista's")).toBeGreaterThan(prompt.indexOf('</heuristics>'));
      expect(prompt.indexOf('# Rules')).toBeGreaterThan(prompt.indexOf("# Taste is the barista's"));
      expect(taste).toMatch(/Be generic about taste and specific about the machine/);
    });

    it('never says what a shot should taste like, predicts a flavour, corrects the palate or names a flavour first', () => {
      expect(taste).toMatch(/Never say what a shot should, will or ought to taste like/);
      expect(taste).toMatch(/never predict a flavour from a change \("sweeter", "less sour", "more body", "more chocolate"\)/);
      expect(taste).toMatch(/Never tell the barista their taste is wrong/);
      expect(taste).toMatch(/Name no flavour they did not name; the options of the taste question are the one exception/);
      expect(taste).toMatch(/never correct their palate/);
    });

    it("explains a change by its mechanics, with the barista's own words as the reason, and asks them to notice the difference", () => {
      expect(taste).toContain('"You found it sharp, so…"');
      expect(taste).toMatch(/a finer grind slows the flow, so the water stays longer in the coffee and extracts more/);
      expect(taste).toMatch(/invite them to notice the difference for themselves/);
      // The heuristics and the lever descriptions mention flavours: knowledge for choosing, not a promise.
      expect(taste).toMatch(/use them to choose a change, never as a promise/);
    });

    it('keeps expectedEffect to mechanics, and says CafAI sends back one that names a taste', () => {
      expect(taste).toMatch(/expectedEffect is mechanics only/);
      expect(taste).toMatch(/CafAI sends back one that names a taste/);
    });

    it('asks the taste question openly, and helps the barista taste with questions, never answers', () => {
      expect(taste).toMatch(/neutral options that cover the range/);
      expect(taste).toMatch(/never a guess from the numbers \("It ran fast; was it sour\?"\)/);
      expect(taste).toMatch(/ask one short question at a time about what they notice/);
      expect(taste).toMatch(/never answer for them/);
    });
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

describe('roastLine', () => {
  const TODAY = new Date(2026, 9, 10, 9, 30);

  it('gives the roast date and the age in days (6.1)', () => {
    expect(roastLine('2026-10-01', TODAY)).toBe('Roasted 2026-10-01 (9 days ago)');
    expect(roastLine('2026-10-09', TODAY)).toBe('Roasted 2026-10-09 (1 day ago)');
    expect(roastLine('2026-10-10', TODAY)).toBe('Roasted 2026-10-10 (today)');
  });

  it('reads a roast date written in UTC as its own day, in New York too', () => {
    const before = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(roastLine('2026-10-01T00:00:00.000Z', new Date(2026, 9, 10, 9, 30))).toBe('Roasted 2026-10-01 (9 days ago)');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('leaves out the days in the freezer, and says how many', () => {
    const batch = { freezeDate: '2026-09-11T00:00:00.000', unfreezeDate: '2026-09-23T00:00:00.000' };
    expect(roastLine('2026-09-10', TODAY, batch)).toBe('Roasted 2026-09-10 (18 days ago; 12 days in the freezer not counted)');
    expect(roastLine('2026-09-10', TODAY, { freezeDate: '2026-09-11', unfreezeDate: '2026-09-12' })).toBe(
      'Roasted 2026-09-10 (29 days ago; 1 day in the freezer not counted)',
    );
  });

  it('gives the date alone when it is after today, and nothing without one', () => {
    expect(roastLine('2026-10-12', TODAY)).toBe('Roasted 2026-10-12');
    expect(roastLine(null, TODAY)).toBeNull();
    expect(roastLine('last week', TODAY)).toBeNull();
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

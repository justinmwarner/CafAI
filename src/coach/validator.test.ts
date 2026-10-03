// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/parse.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: proposal and grind cases rewritten for bounded template levers.
import { describe, expect, it } from 'vitest';

import type { ProposeAdjustment } from './contract.ts';
import { applyLever, effectiveBounds, readLeverValue, snapToGranularity } from './levers.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';
import type { ProfileJson, Template } from './types.ts';
import {
  checkStructure,
  validateProposal,
  validateTemplateSuggestions,
  type ChangePlan,
  type Validation,
  type ValidationContext,
} from './validator.ts';
import { clone } from '../util/clone.ts';

const bloomingT = getTemplate('blooming-espresso')!;
const dflowT = getTemplate('d-flow')!;
const londoniumT = getTemplate('londonium')!;

const ctxFor = (template: Template, over: Partial<ValidationContext> = {}): ValidationContext => ({
  template,
  profile: template.profile,
  doseG: 18,
  scaleConnected: true,
  grinderSetting: '14.5',
  ...over,
});

const proposal = (over: Partial<ProposeAdjustment>): ProposeAdjustment => ({
  variable: 'profile',
  lever: null,
  value: null,
  grind: null,
  summary: 'Make one change',
  rationale: 'The shot ran fast and tasted sour.',
  expectedEffect: 'Sweeter and rounder.',
  tips: [],
  ...over,
});

const lever = (id: string, value: number) => proposal({ variable: 'profile', lever: id, value });

function okPlan(result: Validation): ChangePlan {
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join(' | ')}`);
  return result.plan;
}

function errorsOf(result: Validation): string {
  if (result.ok) throw new Error(`expected errors, got a plan to ${String(result.plan.to)}`);
  return result.errors.join(' | ');
}

describe('validateProposal: every lever of every template', () => {
  for (const template of TEMPLATES) {
    for (const lv of template.levers) {
      describe(`${template.id}.${lv.id}`, () => {
        const ctx = ctxFor(template);
        const from = readLeverValue(template, template.profile, lv.id);
        const { min, max } = effectiveBounds(lv, ctx.doseG);
        const step = (n: number) => snapToGranularity(from + n * lv.granularity, lv.granularity);

        it('accepts one step within bounds and applies it', () => {
          const to = from + lv.maxDelta <= max ? snapToGranularity(from + lv.maxDelta, lv.granularity) : step(-1);
          const plan = okPlan(validateProposal(lever(lv.id, to), ctx));
          expect(plan.variable).toBe('profile');
          expect(plan.leverId).toBe(lv.id);
          expect([plan.from, plan.to]).toEqual([from, to]);
          expect(plan.createsVersion).toBe(true);
          expect(readLeverValue(template, plan.newProfile!, lv.id)).toBe(to);
          expect(checkStructure(template, template.profile, plan.newProfile!)).toEqual([]);
          expect(plan.diffLines).toHaveLength(1);
          expect(plan.diffLines[0]).toContain(lv.label);
        });

        it('rejects more than the maximum change per step', () => {
          const tooFar = snapToGranularity(from - lv.maxDelta - lv.granularity, lv.granularity);
          const message = errorsOf(validateProposal(lever(lv.id, tooFar), ctx));
          expect(message).toMatch(tooFar < min ? /below/ : /at most .* per step/);
          expect(message).toContain('Allowed range now:');
        });

        it('rejects values outside the template bounds, never clamping them', () => {
          expect(errorsOf(validateProposal(lever(lv.id, lv.max + lv.granularity), ctx))).toMatch(/above/);
          expect(errorsOf(validateProposal(lever(lv.id, lv.min - lv.granularity), ctx))).toMatch(/below/);
        });

        it('snaps to the granularity and reports it', () => {
          const raw = from + lv.granularity * 0.6;
          const plan = okPlan(validateProposal(lever(lv.id, raw), ctx));
          expect(plan.to).toBe(step(1));
          expect(plan.notes.join(' ')).toMatch(/Rounded/);
          expect(min).toBeLessThanOrEqual(from);
        });

        it('rejects a "change" to the current value', () => {
          expect(errorsOf(validateProposal(lever(lv.id, from), ctx))).toMatch(/already/);
        });
      });
    }
  }
});

describe('validateProposal: messages and special rules', () => {
  it('explains a bound to the model in one sentence plus the allowed range', () => {
    expect(validateProposal(lever('temp', 96), ctxFor(bloomingT))).toEqual({
      ok: false,
      errors: [
        "temp: 96.0 °C is above this template's maximum of 94.0 °C. Allowed range now: 90.0-94.0 °C (at most 2.0 °C per step).",
      ],
    });
  });

  it('writes a yield change to the profile and to the workflow context', () => {
    const plan = okPlan(validateProposal(lever('yield', 52), ctxFor(dflowT)));
    expect(plan.newProfile?.target_weight).toBe(52);
    expect(plan.contextPatch).toEqual({ targetYield: 52 });
    expect(plan.diffLines).toEqual(['Yield: 50 g -> 52 g (the shot stops at 52 g)']);
  });

  it('bounds yield by the dose ratio', () => {
    expect(errorsOf(validateProposal(lever('yield', 54), ctxFor(dflowT, { doseG: 16 })))).toMatch(
      /above the maximum for a 16\.0 g dose \(48 g, 1:3\.0\)/,
    );
    expect(okPlan(validateProposal(lever('yield', 54), ctxFor(dflowT, { doseG: 18 }))).to).toBe(54);
    // Unknown dose: only the template bounds apply.
    expect(okPlan(validateProposal(lever('yield', 54), ctxFor(dflowT, { doseG: null }))).to).toBe(54);
  });

  it('lets a yield that a smaller dose left out of range move back toward it', () => {
    const ctx = ctxFor(bloomingT, { doseG: 15 }); // 60 g is above 3.5 x 15 = 52 g
    expect(okPlan(validateProposal(lever('yield', 56), ctx)).to).toBe(56);
    expect(errorsOf(validateProposal(lever('yield', 61), ctx))).toMatch(/above the maximum for a 15\.0 g dose/);
    expect(errorsOf(validateProposal(lever('yield', 55), ctx))).toMatch(/at most 4 g per step/);
  });

  it('refuses the soak weight without a scale', () => {
    const message = errorsOf(validateProposal(lever('soakWeight', 5), ctxFor(dflowT, { scaleConnected: false })));
    expect(message).toMatch(/needs a connected scale/);
    expect(okPlan(validateProposal(lever('soakWeight', 5), ctxFor(dflowT))).to).toBe(5);
  });

  it('keeps the Londonium peak at least 1 bar above the decline end', () => {
    let profile = londoniumT.profile;
    for (const value of [4, 5, 6]) profile = applyLever(londoniumT, profile, 'declineEnd', value);
    for (const value of [8, 7]) profile = applyLever(londoniumT, profile, 'peak', value);
    const ctx = ctxFor(londoniumT, { profile });
    expect(errorsOf(validateProposal(lever('peak', 6.5), ctx))).toMatch(
      /peak: 6\.5 bar leaves only 0\.5 bar above Decline end pressure \(6\.0 bar\).*Allowed range now: 7\.0-8\.0 bar/,
    );
    expect(okPlan(validateProposal(lever('peak', 8), ctx)).to).toBe(8);

    const lowPeak = applyLever(londoniumT, applyLever(londoniumT, londoniumT.profile, 'peak', 8), 'peak', 7);
    expect(errorsOf(validateProposal(lever('declineEnd', 6.5), ctxFor(londoniumT, { profile: lowPeak })))).toMatch(
      /above/,
    );
    expect(errorsOf(validateProposal(lever('declineEnd', 4), ctxFor(londoniumT, { profile: applyLever(londoniumT, lowPeak, 'declineEnd', 4) })))).toMatch(/already/);
  });

  it('requires lever and value for a profile change, and nothing else', () => {
    expect(errorsOf(validateProposal(proposal({ variable: 'profile', value: 93 }), ctxFor(bloomingT)))).toMatch(
      /needs "lever".*temp, yield, bloom, piExit, flow/,
    );
    expect(errorsOf(validateProposal(proposal({ variable: 'profile', lever: 'temp' }), ctxFor(bloomingT)))).toMatch(
      /needs "value"/,
    );
    expect(
      errorsOf(
        validateProposal(
          proposal({ lever: 'temp', value: 93, grind: { direction: 'finer', amount: 1, setting: null } }),
          ctxFor(bloomingT),
        ),
      ),
    ).toMatch(/one variable/);
    expect(errorsOf(validateProposal(lever('peak', 9), ctxFor(bloomingT)))).toMatch(
      /no lever "peak".*temp, yield, bloom, piExit, flow/,
    );
  });

  it('reports a profile that the template levers cannot read', () => {
    const foreign = clone(bloomingT.profile) as ProfileJson;
    foreign.steps[4]!.flow = 2.5;
    expect(errorsOf(validateProposal(lever('flow', 2.4), ctxFor(bloomingT, { profile: foreign })))).toMatch(
      /not built from/,
    );
  });
});

describe('validateProposal: grind', () => {
  const grind = (direction: 'finer' | 'coarser', amount: number | null, setting: string | null) =>
    proposal({ variable: 'grind', grind: { direction, amount, setting } });

  it('turns a grind move into manual steps, with no new version', () => {
    const plan = okPlan(validateProposal(grind('finer', 1, null), ctxFor(dflowT)));
    expect(plan).toMatchObject({
      variable: 'grind',
      leverId: null,
      newProfile: null,
      createsVersion: false,
      contextPatch: {},
    });
    expect(plan.diffLines).toEqual(['Grind 1 step finer (now 14.5)']);
    expect(plan.manualSteps).toEqual(['Set the grinder 1 step finer before the next shot.']);
  });

  it('records an absolute setting exactly as given', () => {
    const plan = okPlan(validateProposal(grind('coarser', 2, '16'), ctxFor(dflowT)));
    expect(plan.contextPatch).toEqual({ grinderSetting: '16' });
    expect(plan.diffLines).toEqual(['Grind 2 steps coarser: 14.5 -> 16']);
  });

  it('never clamps a setting to some typed range', () => {
    // Crema's Tcl ancestor clamped to the user's grinder range and dragged a
    // correct 0.15 up to 0.4. CafAI passes the setting through as written.
    const plan = okPlan(validateProposal(grind('finer', null, '0.15'), ctxFor(dflowT, { grinderSetting: '0.4' })));
    expect(plan.contextPatch).toEqual({ grinderSetting: '0.15' });
  });

  it('rejects impossible step counts and a missing grind', () => {
    expect(errorsOf(validateProposal(grind('finer', 6, null), ctxFor(dflowT)))).toMatch(/more than 0 and at most 5/);
    expect(errorsOf(validateProposal(grind('finer', 0, null), ctxFor(dflowT)))).toMatch(/more than 0/);
    expect(errorsOf(validateProposal(grind('finer', -1, null), ctxFor(dflowT)))).toMatch(/more than 0/);
    expect(errorsOf(validateProposal(proposal({ variable: 'grind' }), ctxFor(dflowT)))).toMatch(/needs "grind"/);
    expect(
      errorsOf(
        validateProposal(
          proposal({ variable: 'grind', value: 1, grind: { direction: 'finer', amount: 1, setting: null } }),
          ctxFor(dflowT),
        ),
      ),
    ).toMatch(/"value" must be null/);
  });
});

describe('validateProposal: dose', () => {
  const dose = (value: number | null) => proposal({ variable: 'dose', value });

  it('changes the dose by up to 1 g, as a manual step', () => {
    const plan = okPlan(validateProposal(dose(18.5), ctxFor(londoniumT)));
    expect(plan).toMatchObject({
      variable: 'dose',
      label: 'Dose',
      unit: 'g',
      from: 18,
      to: 18.5,
      newProfile: null,
      createsVersion: false,
      contextPatch: { targetDoseWeight: 18.5 },
    });
    expect(plan.diffLines).toEqual(['Dose 18.0 g -> 18.5 g']);
    expect(plan.manualSteps).toEqual(['Weigh 18.5 g of coffee for the next shot.']);
  });

  it('keeps the dose sane and the step small', () => {
    expect(errorsOf(validateProposal(dose(19.5), ctxFor(londoniumT)))).toMatch(
      /dose: 19\.5 g is a change of 1\.5 g from 18\.0 g; at most 1\.0 g per step\. Allowed range now: 17\.0-19\.0 g/,
    );
    expect(errorsOf(validateProposal(dose(26), ctxFor(londoniumT, { doseG: 25 })))).toMatch(/above the 25\.0 g maximum/);
    expect(errorsOf(validateProposal(dose(11.5), ctxFor(londoniumT, { doseG: 12 })))).toMatch(/below the 12\.0 g minimum/);
    expect(errorsOf(validateProposal(dose(18), ctxFor(londoniumT)))).toMatch(/already/);
    expect(errorsOf(validateProposal(dose(null), ctxFor(londoniumT)))).toMatch(/needs "value"/);
  });

  it('accepts a sane dose when the current one is unknown', () => {
    const plan = okPlan(validateProposal(dose(18), ctxFor(londoniumT, { doseG: null })));
    expect([plan.from, plan.to]).toEqual([null, 18]);
    expect(plan.diffLines).toEqual(['Dose 18.0 g']);
  });
});

describe('validateProposal: none', () => {
  it('locks in a good shot without changing anything', () => {
    const plan = okPlan(validateProposal(proposal({ variable: 'none', summary: 'Keep it exactly like this' }), ctxFor(bloomingT)));
    expect(plan).toEqual({
      variable: 'none',
      leverId: null,
      label: 'No change',
      unit: '',
      from: null,
      to: null,
      newProfile: null,
      contextPatch: {},
      diffLines: [],
      manualSteps: [],
      summary: 'Keep it exactly like this',
      createsVersion: false,
      notes: [],
    });
  });

  it('refuses a lever, value or grind alongside none', () => {
    expect(errorsOf(validateProposal(proposal({ variable: 'none', lever: 'temp', value: 93 }), ctxFor(bloomingT)))).toMatch(
      /"none" keeps everything/,
    );
  });
});

describe('checkStructure', () => {
  const base = dflowT.profile;
  const mutate = (fn: (p: ProfileJson) => void, from: ProfileJson = base) => {
    const p = clone(from);
    fn(p);
    return checkStructure(dflowT, base, p).join(' | ');
  };

  it('accepts a profile that only moved levers', () => {
    expect(checkStructure(dflowT, base, applyLever(dflowT, base, 'temp', 90))).toEqual([]);
    expect(checkStructure(bloomingT, bloomingT.profile, applyLever(bloomingT, bloomingT.profile, 'temp', 94))).toEqual([]);
  });

  it('rejects every structural change', () => {
    expect(
      mutate((p) => {
        p.steps[0]!.pump = 'flow';
        p.steps[0]!.flow = 3;
        delete p.steps[0]!.pressure;
      }),
    ).toMatch(/pump/);
    expect(mutate((p) => (p.steps[1]!.sensor = 'water'))).toMatch(/sensor/);
    expect(mutate((p) => (p.steps[0]!.exit = { type: 'flow', condition: 'over', value: 1.5 }))).toMatch(/exit type/);
    expect(mutate((p) => (p.steps[0]!.exit = { type: 'pressure', condition: 'under', value: 1.5 }))).toMatch(/exit condition/);
    expect(mutate((p) => (p.steps[0]!.exit = null))).toMatch(/exit/);
    expect(mutate((p) => (p.steps[1]!.exit = { type: 'pressure', condition: 'over', value: 2 }))).toMatch(/exit/);
    expect(mutate((p) => (p.steps[2]!.limiter = null))).toMatch(/limiter/);
    expect(mutate((p) => (p.steps[2]!.limiter = { value: 8.5, range: 0.6 }))).toMatch(/limiter range/);
    expect(mutate((p) => p.steps.pop())).toMatch(/3 steps/);
    expect(mutate((p) => (p.steps[0]!.name = 'Fill'))).toMatch(/name/);
    expect(mutate((p) => (p.steps[2]!.transition = 'smooth'))).toMatch(/transition/);
    expect(mutate((p) => (p.steps[0]!.volume = 50))).toMatch(/volume/);
    expect(mutate((p) => (p.target_volume = 36))).toMatch(/target_volume/);
    expect(mutate((p) => (p.target_volume_count_start = 1))).toMatch(/target_volume_count_start/);
    expect(mutate((p) => (p.tank_temperature = 30))).toMatch(/tank_temperature/);
    expect(mutate((p) => (p.beverage_type = 'pourover'))).toMatch(/beverage_type/);
    expect(mutate((p) => (p.version = '2.1'))).toMatch(/version/);
  });

  it('rejects a change to a fixed number that no lever owns', () => {
    expect(mutate((p) => (p.steps[0]!.seconds = 30))).toMatch(/steps\[0\]\.seconds .*fixed/);
    expect(mutate((p) => (p.steps[0]!.weight = 6))).toMatch(/steps\[0\]\.weight/);
    expect(mutate((p) => (p.steps[0]!.exit!.value = 2))).toMatch(/steps\[0\]\.exit\.value/);
    expect(mutate((p) => (p.steps[0]!.weight = null))).toMatch(/steps\[0\]\.weight/);
  });

  it('enforces CafAI hard bounds on every number', () => {
    expect(mutate((p) => p.steps.forEach((s) => (s.temperature = 101)))).toMatch(/101\.0 °C .*80\.0-100\.0 °C/);
    expect(mutate((p) => p.steps.forEach((s) => (s.temperature = 90.3)))).toMatch(/0\.5 °C/);
    expect(mutate((p) => (p.steps[2]!.flow = 9))).toMatch(/flow.*0\.0-8\.0 ml\/s/);
    expect(mutate((p) => (p.steps[2]!.limiter!.value = 12))).toMatch(/limiter\.value.*0\.0-11\.0 bar/);
    expect(mutate((p) => (p.steps[1]!.weight = 30))).toMatch(/weight.*1-20 g/);
    expect(mutate((p) => (p.target_weight = 150))).toMatch(/target_weight.*15-120 g/);
    expect(mutate((p) => ((p.steps[0]!.pressure = 12), (p.steps[1]!.pressure = 12)))).toMatch(/pressure.*0\.0-11\.0 bar/);
  });

  it('reports a current profile that does not match the template', () => {
    const odd = clone(base);
    odd.steps[0]!.name = 'Fill';
    expect(checkStructure(dflowT, odd, odd).join(' ')).toMatch(/current profile/i);
  });
});

describe('validateTemplateSuggestions', () => {
  const suggestion = (templateId: string) => ({ templateId, confidence: 'high' as const, reason: 'Fits a light washed coffee.' });
  it('accepts known template ids', () => {
    expect(validateTemplateSuggestions({ suggestions: [suggestion('d-flow'), suggestion('londonium')] })).toEqual({ ok: true, errors: [] });
  });
  it('rejects unknown and repeated ids, naming the real ones', () => {
    const result = validateTemplateSuggestions({ suggestions: [suggestion('adaptive'), suggestion('d-flow'), suggestion('d-flow')] });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/"adaptive".*blooming-espresso, d-flow, londonium/);
    expect(result.errors.join(' ')).toMatch(/"d-flow" appears more than once/);
  });
});

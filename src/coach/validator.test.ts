// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/parse.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: proposal and grind cases rewritten for bounded template levers.
import { describe, expect, it } from 'vitest';

import type { ProposeAdjustment } from './contract.ts';
import { applyLever, effectiveBounds, readLeverValue, snapToGranularity } from './levers.ts';
import { buildStartingProfile } from './start.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';
import type { GrinderInfo, ProfileJson, Template } from './types.ts';
import {
  checkStructure,
  proposalWordingError,
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
const allongeT = getTemplate('allonge')!;
const gentleT = getTemplate('gentle-and-sweet')!;

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
  expectedEffect: 'More extraction at the same flow.',
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
        // From v1 as the engine builds it for an 18 g dose (D57): the yield
        // starts inside its dose window, unlike the Allongé's bundled 135 g.
        const ctx = ctxFor(template, { profile: buildStartingProfile(template, 18) });
        const from = readLeverValue(template, ctx.profile, lv.id);
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
          expect(checkStructure(template, ctx.profile, plan.newProfile!)).toEqual([]);
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
          // Toward the inside: a starting value may sit at its ceiling.
          const direction = step(1) <= max ? 1 : -1;
          const raw = from + direction * lv.granularity * 0.6;
          const plan = okPlan(validateProposal(lever(lv.id, raw), ctx));
          expect(plan.to).toBe(step(direction));
          expect(plan.notes.join(' ')).toMatch(/Rounded/);
          expect(min).toBeLessThanOrEqual(from);
          expect(from).toBeLessThanOrEqual(max);
        });

        it('keeps the whole lever range inside the hard bounds and the structure', () => {
          for (const value of [lv.min, lv.max]) {
            const moved = applyLever(template, template.profile, lv.id, value);
            expect(checkStructure(template, template.profile, moved), `${lv.id} = ${value}`).toEqual([]);
          }
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

  it('refuses every yield change without a scale, since stop-at-weight needs one', () => {
    for (const template of TEMPLATES) {
      const from = readLeverValue(template, template.profile, 'yield');
      const ctx = ctxFor(template, { scaleConnected: false });
      expect(errorsOf(validateProposal(lever('yield', from - 1), ctx)), template.id).toMatch(/^yield: needs a connected scale/);
      expect(okPlan(validateProposal(lever('yield', from - 1), ctxFor(template))).to, template.id).toBe(from - 1);
    }
    // Other levers still work without a scale.
    expect(okPlan(validateProposal(lever('temp', 93), ctxFor(allongeT, { scaleConnected: false }))).to).toBe(93);
  });

  it('keeps the Allongé yield between 4x and 6x the dose, stepping in up to 10 g from v1', () => {
    const v1 = buildStartingProfile(allongeT, 18); // 90 g; an 18 g dose allows 72-108 g
    const ctx = ctxFor(allongeT, { profile: v1 });
    const plan = okPlan(validateProposal(lever('yield', 100), ctx));
    expect(plan.contextPatch).toEqual({ targetYield: 100 });
    expect(plan.newProfile?.target_weight).toBe(100);
    expect(errorsOf(validateProposal(lever('yield', 101), ctx))).toMatch(
      /change of 11 g from 90 g; at most 10 g per step\. Allowed range now: 80-100 g/,
    );
    const longer = ctxFor(allongeT, { profile: applyLever(allongeT, v1, 'yield', 100) });
    expect(okPlan(validateProposal(lever('yield', 108), longer)).to).toBe(108);
    expect(errorsOf(validateProposal(lever('yield', 109), longer))).toMatch(/above the maximum for an 18\.0 g dose \(108 g, 1:6\.0\)/);
    const shorter = ctxFor(allongeT, { profile: applyLever(allongeT, v1, 'yield', 80) });
    expect(errorsOf(validateProposal(lever('yield', 71), shorter))).toMatch(/below the minimum for an 18\.0 g dose \(72 g, 1:4\.0\)/);
    expect(errorsOf(validateProposal(lever('yield', 136), ctx))).toMatch(/above this template's maximum of 135 g/);

    // The bundled 135 g stop (v1 before D57) is 1:7.5 at 18 g: only steps back toward the window pass.
    const bundled = ctxFor(allongeT);
    expect(okPlan(validateProposal(lever('yield', 125), bundled)).to).toBe(125);
    expect(errorsOf(validateProposal(lever('yield', 124), bundled))).toMatch(
      /change of 11 g from 135 g; at most 10 g per step\. Allowed range now: 125-134 g/,
    );

    // A 12 g dose allows 50-72 g; a 25 g dose reaches the 135 g ceiling (1:5.4).
    const down = applyLever(allongeT, allongeT.profile, 'yield', 95);
    expect(errorsOf(validateProposal(lever('yield', 100), ctxFor(allongeT, { doseG: 12, profile: down })))).toMatch(
      /above the maximum for a 12\.0 g dose \(72 g, 1:6\.0\)/,
    );
    const big = ctxFor(allongeT, { doseG: 25, profile: buildStartingProfile(allongeT, 25) }); // 125 g
    expect(okPlan(validateProposal(lever('yield', 135), big)).to).toBe(135);
  });

  it('lets Gentle and Sweet run to 1:3', () => {
    const ctx = ctxFor(gentleT, { doseG: 15, profile: applyLever(gentleT, gentleT.profile, 'yield', 42) });
    expect(okPlan(validateProposal(lever('yield', 45), ctx)).to).toBe(45);
    expect(errorsOf(validateProposal(lever('yield', 46), ctx))).toMatch(/above the maximum for a 15\.0 g dose \(45 g, 1:3\.0\)/);
  });

  it('treats a dose outside 12-25 g as unknown: the plain gram bounds apply', () => {
    // A 7 g dose turned Blooming's window upside down (30-24 g) and 30 g lifted its floor to 60 g.
    for (const doseG of [7, 30]) {
      const ctx = ctxFor(bloomingT, { doseG });
      expect(okPlan(validateProposal(lever('yield', 56), ctx)).to, `${doseG} g`).toBe(56);
      const message = errorsOf(validateProposal(lever('yield', 81), ctx));
      expect(message).toMatch(/above this template's maximum of 80 g/);
      expect(message).not.toMatch(/dose/);
    }
  });

  it('keeps the Gentle and Sweet peak at least 1 bar above the decline end', () => {
    let profile = gentleT.profile;
    for (const value of [5, 6]) profile = applyLever(gentleT, profile, 'declineEnd', value);
    profile = applyLever(gentleT, profile, 'peak', 7);
    const ctx = ctxFor(gentleT, { profile });
    expect(errorsOf(validateProposal(lever('peak', 6.5), ctx))).toMatch(
      /peak: 6\.5 bar leaves only 0\.5 bar above Decline end pressure \(6\.0 bar\).*Allowed range now: 7\.0-8\.0 bar/,
    );
    expect(okPlan(validateProposal(lever('peak', 8), ctx)).to).toBe(8);
    // From either side: a decline end raised into the peak, or a peak lowered onto it.
    const atFive = ctxFor(gentleT, { profile: applyLever(gentleT, gentleT.profile, 'declineEnd', 5) });
    expect(errorsOf(validateProposal(lever('declineEnd', 5.5), atFive))).toMatch(
      /declineEnd: 5\.5 bar leaves Peak pressure \(6\.0 bar\) only 0\.5 bar above it/,
    );
    expect(errorsOf(validateProposal(lever('peak', 5.5), atFive))).toMatch(/peak: 5\.5 bar leaves only 0\.5 bar above Decline end pressure/);
    expect(okPlan(validateProposal(lever('declineEnd', 5), ctxFor(gentleT))).to).toBe(5);
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
      grindSettingFrom: null,
    });
    expect(plan.diffLines).toEqual(['Grind 1 step finer (now 14.5)']);
    expect(plan.manualSteps).toEqual([
      "Turn the grinder 1 step finer before the next shot. CafAI doesn't know your grinder's step size, so note the new setting in Settings.",
    ]);
  });

  it('records an absolute setting exactly as given', () => {
    const plan = okPlan(validateProposal(grind('coarser', 2, '16'), ctxFor(dflowT)));
    expect(plan.contextPatch).toEqual({ grinderSetting: '16' });
    expect(plan.diffLines).toEqual(['Grind 2 steps coarser: 14.5 -> 16']);
    expect(plan.manualSteps).toEqual([
      "Set the grinder to 16 (2 steps coarser) before the next shot. That is the coach's estimate: CafAI doesn't know your grinder's step size, so note where the dial really lands in Settings.",
    ]);
    expect(plan.grindSettingFrom).toBe('model');
  });

  it('never clamps a setting to some typed range', () => {
    // Crema's Tcl ancestor clamped to the user's grinder range and dragged a
    // correct 0.15 up to 0.4. CafAI passes the setting through as written.
    const plan = okPlan(validateProposal(grind('finer', null, '0.15'), ctxFor(dflowT, { grinderSetting: '0.4' })));
    expect(plan.contextPatch).toEqual({ grinderSetting: '0.15' });
  });

  it('refuses a "new" grind setting that is the current one', () => {
    const ctx = ctxFor(dflowT, { grinderSetting: '13' });
    expect(errorsOf(validateProposal(grind('finer', 1, '13'), ctx))).toMatch(/"13" is the setting the grinder is on now/);
    expect(errorsOf(validateProposal(grind('finer', 1, ' 13 '), ctx))).toMatch(/is the setting the grinder is on now/);
    expect(okPlan(validateProposal(grind('finer', 1, '12'), ctx)).contextPatch).toEqual({ grinderSetting: '12' });
    expect(okPlan(validateProposal(grind('finer', 1, null), ctx)).contextPatch).toEqual({});
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

describe("validateProposal: grind with Decaid's grinder library (D62)", () => {
  const NICHE: GrinderInfo = { model: 'Niche Zero', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null };
  const DITTING: GrinderInfo = {
    model: 'Ditting 807',
    settingType: 'preset',
    smallStep: null,
    bigStep: null,
    values: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
  };
  const grind = (direction: 'finer' | 'coarser', amount: number | null, setting: string | null) =>
    proposal({ variable: 'grind', grind: { direction, amount, setting } });
  const on = (grinder: GrinderInfo | null, grinderSetting: string | null) => ctxFor(dflowT, { grinder, grinderSetting });

  it("turns a relative move into the new setting and says the step came from Decaid's library", () => {
    const plan = okPlan(validateProposal(grind('finer', 1, null), on(NICHE, '15')));
    expect(plan).toMatchObject({
      variable: 'grind',
      newProfile: null,
      createsVersion: false,
      contextPatch: { grinderSetting: '14.5' },
      diffLines: ['Grind 1 step finer: 15 -> 14.5'],
      manualSteps: ['Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).'],
      grindSettingFrom: 'decaid',
      notes: [],
    });
  });

  it("prints the new setting with the step's decimals", () => {
    const plan = okPlan(validateProposal(grind('coarser', 2, null), on(NICHE, '15')));
    expect(plan.contextPatch).toEqual({ grinderSetting: '16.0' });
    expect(plan.diffLines).toEqual(['Grind 2 steps coarser: 15 -> 16.0']);
    const whole = { ...NICHE, model: 'Eureka Mignon', smallStep: 1 };
    expect(okPlan(validateProposal(grind('finer', 1, null), on(whole, '15'))).manualSteps).toEqual([
      'Set the grinder to 14 before the next shot (Decaid lists steps of 1 for your Eureka Mignon).',
    ]);
  });

  it("checks a setting the model names and counts it in Decaid's steps", () => {
    const plan = okPlan(validateProposal(grind('finer', null, '14'), on(NICHE, '15')));
    expect(plan.contextPatch).toEqual({ grinderSetting: '14' });
    expect(plan.diffLines).toEqual(['Grind 2 steps finer: 15 -> 14']);
    expect(plan.manualSteps).toEqual(['Set the grinder to 14 before the next shot (Decaid lists 0.5 steps for your Niche Zero).']);
    expect(plan.grindSettingFrom).toBe('decaid');
    // The model's amount disagrees with its setting: the setting wins, and the card says why.
    const mismatch = okPlan(validateProposal(grind('finer', 1, '14'), on(NICHE, '15')));
    expect(mismatch.diffLines).toEqual(['Grind 2 steps finer: 15 -> 14']);
    expect(mismatch.notes).toEqual(['Decaid lists 0.5 steps for your Niche Zero, so 15 to 14 is 2 steps, not 1.']);
  });

  it('answers the model with the step for an off-grid, wrong-way, too-far or negative move', () => {
    const ctx = on(NICHE, '15');
    expect(errorsOf(validateProposal(grind('finer', null, '14.3'), ctx))).toMatch(
      /^grind\.setting "14\.3" is not a whole number of steps from 15\. Your grinder moves in steps of 0\.5/,
    );
    expect(errorsOf(validateProposal(grind('finer', null, '16'), ctx))).toMatch(
      /^grind\.setting "16" is coarser than 15 \(lower numbers are finer\), but grind\.direction is "finer"\. Your grinder moves in steps of 0\.5/,
    );
    expect(errorsOf(validateProposal(grind('finer', null, '12'), ctx))).toMatch(
      /^grind\.setting "12" is 6 steps from 15; move at most 5 steps per shot\. Your grinder moves in steps of 0\.5/,
    );
    expect(errorsOf(validateProposal(grind('finer', 2, null), on(NICHE, '0.5')))).toMatch(
      /^grind: 2 steps finer from 0\.5 would be -0\.5, below 0\. Your grinder moves in steps of 0\.5/,
    );
    expect(errorsOf(validateProposal(grind('finer', null, '-1'), ctx))).toMatch(/^grind\.setting "-1" is below 0\./);
    expect(errorsOf(validateProposal(grind('finer', 1.5, null), ctx))).toMatch(/^grind\.amount 1\.5 is not a whole number of steps\. Your grinder moves in steps of 0\.5/);
    expect(errorsOf(validateProposal(grind('finer', 1, '15.0'), ctx))).toMatch(/"15\.0" is the setting the grinder is on now/);
    // The usual limits still come first.
    expect(errorsOf(validateProposal(grind('finer', 6, null), ctx))).toMatch(/more than 0 and at most 5/);
  });

  it('moves along a preset list, finest first, and refuses settings outside it', () => {
    const plan = okPlan(validateProposal(grind('finer', 1, null), on(DITTING, 'E4')));
    expect(plan).toMatchObject({
      contextPatch: { grinderSetting: 'E3' },
      diffLines: ['Grind 1 step finer: E4 -> E3'],
      manualSteps: ['Set the grinder to E3 before the next shot (Decaid lists 8 settings for your Ditting 807).'],
      grindSettingFrom: 'decaid',
    });
    expect(okPlan(validateProposal(grind('coarser', null, 'E6'), on(DITTING, 'E4'))).diffLines).toEqual(['Grind 2 steps coarser: E4 -> E6']);
    expect(errorsOf(validateProposal(grind('finer', 3, null), on(DITTING, 'E2')))).toMatch(
      /goes past the end of the list: the finest setting, "E1", is 1 step finer/,
    );
    expect(errorsOf(validateProposal(grind('coarser', 2, null), on(DITTING, 'E7')))).toMatch(/the coarsest setting, "E8", is 1 step coarser/);
    expect(errorsOf(validateProposal(grind('finer', 1, 'E9'), on(DITTING, 'E4')))).toMatch(/^grind\.setting "E9" is not one of your grinder's settings\./);
    expect(errorsOf(validateProposal(grind('finer', 1, 'E5'), on(DITTING, 'E4')))).toMatch(/^grind\.setting "E5" is coarser than "E4" in the list/);
  });

  it("keeps an unsized move unsized, naming Decaid's step for the user", () => {
    const plan = okPlan(validateProposal(grind('finer', null, null), on(NICHE, '15')));
    expect(plan.contextPatch).toEqual({});
    expect(plan.diffLines).toEqual(['Grind a little finer (now 15)']);
    expect(plan.manualSteps).toEqual([
      'Turn the grinder a little finer before the next shot (Decaid lists 0.5 steps for your Niche Zero), then note the new setting in Settings.',
    ]);
    expect(plan.grindSettingFrom).toBeNull();
  });

  it('keeps the move as given when Decaid has no step data, as before', () => {
    const noStep: Array<GrinderInfo | null | undefined> = [undefined, null, { ...NICHE, smallStep: null }, { ...DITTING, values: null }, { ...DITTING, values: [] }];
    for (const grinder of noStep) {
      const ctx = grinder === undefined ? ctxFor(dflowT) : ctxFor(dflowT, { grinder });
      const relative = okPlan(validateProposal(grind('finer', 1, null), ctx));
      expect(relative.contextPatch).toEqual({});
      expect(relative.diffLines).toEqual(['Grind 1 step finer (now 14.5)']);
      expect(relative.manualSteps).toEqual([
        "Turn the grinder 1 step finer before the next shot. CafAI doesn't know your grinder's step size, so note the new setting in Settings.",
      ]);
      // Off any 0.5 grid, yet passed through: there is no grid to check it against.
      const given = okPlan(validateProposal(grind('coarser', 2, '15.2'), ctx));
      expect(given.contextPatch).toEqual({ grinderSetting: '15.2' });
      expect(given.manualSteps).toEqual([
        "Set the grinder to 15.2 (2 steps coarser) before the next shot. That is the coach's estimate: CafAI doesn't know your grinder's step size, so note where the dial really lands in Settings.",
      ]);
      expect(given.grindSettingFrom).toBe('model');
      expect(given.notes).toEqual([]);
    }
  });

  it("keeps the move as given when the current setting cannot be read, still naming Decaid's step", () => {
    for (const grinderSetting of [null, 'two turns', '-2']) {
      const ctx = on(NICHE, grinderSetting);
      const relative = okPlan(validateProposal(grind('finer', 1, null), ctx));
      expect(relative.contextPatch, String(grinderSetting)).toEqual({});
      expect(relative.manualSteps).toEqual([
        'Turn the grinder 1 step finer before the next shot (Decaid lists 0.5 steps for your Niche Zero), then note the new setting in Settings.',
      ]);
      const given = okPlan(validateProposal(grind('finer', 1, '13.3'), ctx));
      expect(given.contextPatch).toEqual({ grinderSetting: '13.3' });
      expect(given.manualSteps).toEqual([
        "Set the grinder to 13.3 (1 step finer) before the next shot. That is the coach's estimate: CafAI couldn't check it against your grinder's steps, so note where the dial really lands in Settings.",
      ]);
      expect(given.grindSettingFrom).toBe('model');
    }
    const preset = okPlan(validateProposal(grind('finer', 1, null), on(DITTING, 'fine')));
    expect(preset.contextPatch).toEqual({});
    expect(preset.manualSteps).toEqual([
      'Turn the grinder 1 step finer before the next shot (Decaid lists 8 settings for your Ditting 807), then note the new setting in Settings.',
    ]);
    // Same as before: a "new" setting equal to the one on the dial is refused.
    expect(errorsOf(validateProposal(grind('finer', 1, 'two turns'), on(NICHE, 'two turns')))).toMatch(/is the setting the grinder is on now/);
  });

  describe('on a grinder whose higher numbers are finer (D241)', () => {
    const UPWARD: GrinderInfo = { ...NICHE, finerIsHigher: true };
    const STEPPED: GrinderInfo = {
      model: 'Baratza Encore ESP',
      settingType: 'preset',
      smallStep: null,
      bigStep: null,
      values: ['1', '2', '3', '4', '5', '6'],
      finerIsHigher: true,
    };

    it('the change card says finer with the higher number, worked out on the dial', () => {
      expect(okPlan(validateProposal(grind('finer', 2, null), on(UPWARD, '15')))).toMatchObject({
        contextPatch: { grinderSetting: '16.0' },
        diffLines: ['Grind 2 steps finer: 15 -> 16.0'],
        manualSteps: ['Set the grinder to 16.0 before the next shot (Decaid lists 0.5 steps for your Niche Zero).'],
        grindSettingFrom: 'decaid',
      });
      expect(okPlan(validateProposal(grind('finer', null, '16'), on(UPWARD, null))).diffLines).toEqual(['Grind finer, to 16']);
      expect(okPlan(validateProposal(grind('coarser', 1, null), on(UPWARD, '15'))).diffLines).toEqual(['Grind 1 step coarser: 15 -> 14.5']);
      expect(okPlan(validateProposal(grind('finer', 1, null), on(STEPPED, '4')))).toMatchObject({
        diffLines: ['Grind 1 step finer: 4 -> 5'],
        manualSteps: ['Set the grinder to 5 before the next shot (Decaid lists 6 settings for your Baratza Encore ESP).'],
      });
    });

    it('sends a setting on the wrong side back to the model, saying which way is finer', () => {
      expect(errorsOf(validateProposal(grind('finer', null, '14'), on(UPWARD, '15')))).toMatch(
        /^grind\.setting "14" is coarser than 15 \(higher numbers are finer\), but grind\.direction is "finer"\. Your grinder moves in steps of 0\.5 \(Decaid's grinder library\): 1 step finer from 15 is 15\.5\./,
      );
      expect(errorsOf(validateProposal(grind('finer', 1, '3'), on(STEPPED, '4')))).toMatch(/^grind\.setting "3" is coarser than "4" in the list/);
    });
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

describe('checkStructure: Rao Allongé and Gentle and Sweet', () => {
  const check = (template: Template, fn: (p: ProfileJson) => void) => {
    const p = clone(template.profile);
    fn(p);
    return checkStructure(template, template.profile, p).join(' | ');
  };

  it('accepts the bundled defaults as they are', () => {
    expect(checkStructure(allongeT, allongeT.profile, allongeT.profile)).toEqual([]);
    expect(checkStructure(gentleT, gentleT.profile, gentleT.profile)).toEqual([]);
  });

  it('rejects pump, sensor, transition, name and step-count changes', () => {
    expect(
      check(allongeT, (p) => {
        p.steps[1]!.pump = 'pressure';
        p.steps[1]!.pressure = 9;
        delete p.steps[1]!.flow;
      }),
    ).toMatch(/steps\[1\]\.pump must stay "flow"/);
    expect(
      check(gentleT, (p) => {
        p.steps[3]!.pump = 'flow';
        p.steps[3]!.flow = 2;
        delete p.steps[3]!.pressure;
      }),
    ).toMatch(/steps\[3\]\.pump must stay "pressure"/);
    expect(check(allongeT, (p) => (p.steps[0]!.sensor = 'water'))).toMatch(/steps\[0\]\.sensor/);
    expect(check(gentleT, (p) => (p.steps[4]!.transition = 'fast'))).toMatch(/steps\[4\]\.transition/);
    expect(check(allongeT, (p) => (p.steps[1]!.name = 'hold at 4.0 ml/s'))).toMatch(/steps\[1\]\.name/);
    expect(check(allongeT, (p) => p.steps.pop())).toMatch(/2 steps/);
    expect(check(gentleT, (p) => p.steps.push(clone(p.steps[4]!)))).toMatch(/5 steps/);
  });

  it('rejects exit and limiter changes', () => {
    expect(check(gentleT, (p) => (p.steps[1]!.exit = { type: 'flow', condition: 'over', value: 4 }))).toMatch(/exit type/);
    expect(check(gentleT, (p) => (p.steps[0]!.exit = { type: 'pressure', condition: 'under', value: 4 }))).toMatch(/exit condition/);
    expect(check(gentleT, (p) => (p.steps[1]!.exit = null))).toMatch(/must keep its exit/);
    expect(check(allongeT, (p) => (p.steps[1]!.exit = { type: 'pressure', condition: 'over', value: 9 }))).toMatch(/must not gain an exit/);
    expect(check(allongeT, (p) => (p.steps[1]!.limiter = { value: 8.6, range: 0.2 }))).toMatch(/limiter range/);
    expect(check(allongeT, (p) => (p.steps[0]!.limiter = null))).toMatch(/must keep its limiter/);
    expect(check(gentleT, (p) => (p.steps[2]!.limiter = { value: 4, range: 1 }))).toMatch(/must not gain a limiter/);
  });

  it('rejects changes to numbers no lever owns, and a temperature that breaks the shape', () => {
    // The Allongé's 2 s start keeps its flow and cap; only step 1 has levers.
    expect(check(allongeT, (p) => (p.steps[0]!.flow = 4))).toMatch(/steps\[0\]\.flow changed from 4\.5 to 4/);
    expect(check(allongeT, (p) => (p.steps[0]!.limiter!.value = 9))).toMatch(/steps\[0\]\.limiter\.value/);
    expect(check(allongeT, (p) => (p.steps[1]!.seconds = 40))).toMatch(/steps\[1\]\.seconds/);
    expect(check(allongeT, (p) => (p.target_volume = 150))).toMatch(/target_volume changed/);
    expect(check(gentleT, (p) => (p.steps[1]!.flow = 6))).toMatch(/steps\[1\]\.flow/);
    expect(check(gentleT, (p) => (p.steps[1]!.exit!.value = 3))).toMatch(/steps\[1\]\.exit\.value/);
    expect(check(gentleT, (p) => (p.steps[3]!.limiter!.value = 3))).toMatch(/steps\[3\]\.limiter\.value/);
    expect(check(gentleT, (p) => (p.steps[4]!.seconds = 20))).toMatch(/steps\[4\]\.seconds/);
    expect(check(gentleT, (p) => (p.target_volume_count_start = 0))).toMatch(/target_volume_count_start/);
    expect(check(gentleT, (p) => (p.steps[0]!.temperature = 90))).toMatch(/same amount/);
  });

  it("allows 135 g only for the template that ships it; everyone else's ceiling stays 120 g", () => {
    expect(check(allongeT, (p) => (p.target_weight = 135))).toBe('');
    expect(check(allongeT, (p) => (p.target_weight = 136))).toMatch(/target_weight: 136 g is outside CafAI's hard bounds \(15-135 g\)/);
    expect(check(allongeT, (p) => (p.target_weight = 14))).toMatch(/\(15-135 g\)/);
    expect(checkStructure(dflowT, dflowT.profile, applyLever(dflowT, dflowT.profile, 'yield', 120))).toEqual([]);
    expect(checkStructure(dflowT, dflowT.profile, applyLever(dflowT, dflowT.profile, 'yield', 121)).join(' ')).toMatch(
      /target_weight: 121 g is outside CafAI's hard bounds \(15-120 g\)/,
    );
    for (const template of [bloomingT, londoniumT, gentleT]) {
      expect(check(template, (p) => (p.target_weight = 135)), template.id).toMatch(/\(15-120 g\)/);
    }
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

describe('proposalWordingError: expectedEffect is mechanics, never a taste (D127)', () => {
  const wording = (expectedEffect: string) => proposalWordingError({ expectedEffect });

  it('passes what a change does at the machine, words with a sense there included', () => {
    for (const text of [
      'A slower pour, a few seconds longer, extracting a little more.',
      'More extraction at the same flow and time.',
      'Hotter water extracts more in the same time; the flow stays about the same.',
      'A smoother pressure curve and a sharper rise to the peak.',
      'A less sharp pressure rise, and a flatter pour after the bloom.',
      'A drier puck and a lighter tamp.',
      'A shorter, stronger shot: less water through the same coffee.',
      'A heavier dose: more coffee for the same water, so the flow slows.',
      'Higher, steadier pressure in the pour.',
      'The shot finishes sooner, with 36 g in the cup.',
      'Nothing changes: the next shot runs the same recipe.',
      'Taste it against this shot.',
      // A taste word right before a machine noun names the machine.
      'A finer grind moves the flow toward the sweet spot.',
      'A more balanced extraction across the puck.',
      'A lower peak avoids a harsh pressure spike.',
      'A shorter finish time: the shot stops 2 g sooner.',
      'Less puck depth in the basket, so more headspace.',
      'The same complex profile with a longer soak.',
      'A forgiving all-rounder, but it suits lighter roasts better than this one.',
      // A template's name is a profile, not a cup.
      'The same pressure curve as Gentle and Sweet, held 4 s longer.',
    ]) {
      expect(wording(text), text).toBeNull();
    }
  });

  it('sends back the common taste promises a model writes (review findings)', () => {
    const cases: Array<[string, string]> = [
      ['The taste should improve.', 'taste should'],
      ['A tastier, smoother espresso.', 'tastier'],
      ['Should give a nicer cup.', 'nicer'],
      ['A better-tasting shot.', 'better-tasting'],
      ['More depth and complexity.', 'depth'],
      ['Mellower, with less bite.', 'Mellower'],
      ['Less edge, more pleasant to drink.', 'Less edge'],
      ['Notes of honey and toffee should come through.', 'Notes of'],
      ['More intensity and a silkier texture.', 'intensity'],
      ['An enjoyable, drinkable shot.', 'enjoyable'],
      ['A more complex cup.', 'complex'],
      ["You'll taste the difference.", "'ll taste"],
      ['The taste will be cleaner.', 'taste will'],
      ['A sweet, harsh-free shot with a sweet spot flow.', 'sweet'],
      ['A good taste at last.', 'good taste'],
    ];
    for (const [text, words] of cases) {
      const error = wording(text);
      expect(error, text).toContain(`expectedEffect names a taste ("${words}")`);
    }
  });

  it('reads the summary and tips too, but not the rationale (the barista may be quoted there)', () => {
    const base = {
      expectedEffect: 'A slower pour, a few seconds longer.',
      summary: 'Grind one step finer',
      tips: ['Keep the same dose, grind and puck prep.'],
    };
    expect(proposalWordingError(base)).toBeNull();
    // rationale is not part of the input it reads, so quoting the barista is fine.
    expect(proposalWordingError({ ...base, rationale: 'You found it sour and harsh.' } as typeof base)).toBeNull();

    const summary = proposalWordingError({ ...base, summary: 'Grind finer for a sweeter shot' });
    expect(summary).toContain('summary names a taste ("sweeter")');
    expect(summary).toMatch(/Call propose_adjustment again with a summary, expectedEffect and tips that say only what the change does at the machine/);

    const tip = proposalWordingError({ ...base, tips: ['Keep the same dose.', 'Expect notes of cocoa.'] });
    expect(tip).toContain('A tip names a taste ("notes of")');
    expect(tip).not.toContain('expectedEffect names');

    const both = proposalWordingError({ ...base, expectedEffect: 'Tastier.', summary: 'Make it mellower' });
    expect(both).toContain('expectedEffect names a taste ("Tastier"). summary names a taste ("mellower").');
  });

  it('sends back a propose_templates reason that promises a taste, naming the template', () => {
    const suggestions = (bloom: string, dflow: string, lever: string) => ({
      suggestions: [
        { templateId: 'blooming-espresso', confidence: 'high' as const, reason: bloom },
        { templateId: 'd-flow', confidence: 'high' as const, reason: dflow },
        { templateId: 'londonium', confidence: 'high' as const, reason: lever },
      ],
    });
    expect(
      proposalWordingError(
        suggestions(
          'A bloom pause lets light, dense beans soak evenly before the pour.',
          'A gentle soak, then a steady pour. Forgiving for most roasts.',
          'Like Gentle and Sweet, a falling pressure that is gentle on darker roasts.',
        ),
      ),
    ).toBeNull();

    const error = proposalWordingError(
      suggestions('High, sweet extraction for light roasts.', 'A forgiving all-rounder.', 'Big body and a syrupy texture.'),
    );
    expect(error).toContain('The reason for blooming-espresso names a taste ("sweet extraction").');
    expect(error).toContain('The reason for londonium names a taste ("body").');
    expect(error).not.toContain('d-flow');
    expect(error).toMatch(
      /Call propose_templates again with reasons that say only what each profile does at the machine \(soak, pressure, flow, temperature, extraction\) and which coffees it suits/,
    );
  });

  it('sends back a flavour, a feel in the mouth or a taste foretold, naming the words', () => {
    const cases: Array<[string, string]> = [
      ['Sweeter, less sharp.', 'Sweeter'],
      ['Less sharpness and more sweetness.', 'sharpness'],
      ['A rounder cup with gentler acidity.', 'rounder'],
      ['More body and intensity.', 'body'],
      ['A softer, cleaner finish with less bitterness.', 'cleaner finish'],
      ['The same balanced, sweet cup, shot after shot.', 'balanced'],
      ['A lighter, clearer cup that is easier to drink.', 'clearer cup'],
      ['The same good cup again.', 'good cup'],
      ['Higher, steadier pressure in the pour and a fuller cup.', 'fuller cup'],
      ['A full-bodied shot.', 'bodied'],
      ['Less sharp.', 'Less sharp'],
      ['It should taste brighter.', 'should taste'],
      ['It will probably taste different.', 'will probably taste'],
      ["It'll taste less sour.", "'ll taste"],
      ['Tastes more like chocolate.', 'Tastes more'],
      ['More caramel-like and syrupy.', 'caramel'],
    ];
    for (const [text, words] of cases) {
      const error = wording(text);
      expect(error, text).toContain(`expectedEffect names a taste ("${words}")`);
      // A call again, not an answer in chat.
      expect(error).toMatch(
        /Call propose_adjustment again with an expectedEffect that says only what the change does at the machine \(flow, time, pressure, temperature, extraction\)/,
      );
      expect(error).toMatch(/how the next shot tastes is for the barista to find, and their own words belong in rationale/);
    }
  });
});

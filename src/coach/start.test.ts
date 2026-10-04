import { describe, expect, it } from 'vitest';

import { clone } from '../util/clone.ts';
import { effectiveBounds, findLever, LeverError, readLeverValue } from './levers.ts';
import { profileId } from './profileId.ts';
import { buildStartingProfile, startingYield, startRatioOf } from './start.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';
import type { Template } from './types.ts';
import { checkStructure } from './validator.ts';
import { buildVersionProfile } from './version.ts';

const DOSES = [12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25] as const;

/** docs/briefs/coach-tuning.md Part 1: v1's yield for each dose, then for an unknown dose. */
const STARTING_YIELDS: Record<string, [number[], number]> = {
  'blooming-espresso': [[34, 39, 42, 45, 48, 50, 53, 56, 59, 62, 70], 50],
  'd-flow': [[34, 39, 42, 45, 48, 50, 53, 56, 59, 62, 70], 50],
  londonium: [[25, 28, 30, 32, 34, 36, 38, 40, 42, 44, 50], 36],
  allonge: [[60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 125], 90],
  'gentle-and-sweet': [[25, 28, 30, 32, 34, 36, 38, 40, 42, 44, 50], 36],
};

describe('startingYield', () => {
  it('matches the whole table: the author ratio times the dose, on the 1 g grid, inside the dose window', () => {
    for (const template of TEMPLATES) {
      const [byDose, unknown] = STARTING_YIELDS[template.id]!;
      expect(DOSES.map((dose) => startingYield(template, dose)), template.id).toEqual(byDose);
      expect(startingYield(template, null), template.id).toBe(unknown);
    }
  });

  it('uses the 18 g reference for an unknown dose or one outside 12-25 g', () => {
    for (const template of TEMPLATES) {
      const reference = startingYield(template, 18);
      for (const dose of [null, 7, 11.9, 25.5, 30, Number.NaN]) {
        expect(startingYield(template, dose), `${template.id} at ${String(dose)}`).toBe(reference);
      }
    }
  });

  it('rounds half a gram up, like every lever', () => {
    // 2.8 x 17.5 = 49 exactly; 2.0 x 17.25 = 34.5 rounds up to 35; 2.8 x 17.32 = 48.496 rounds down.
    expect(startingYield(getTemplate('d-flow')!, 17.5)).toBe(49);
    expect(startingYield(getTemplate('londonium')!, 17.25)).toBe(35);
    expect(startingYield(getTemplate('d-flow')!, 17.32)).toBe(48);
  });

  it('clamps into the lever window for the dose: Londonium and Gentle and Sweet at 12 g stop at the 25 g minimum', () => {
    expect(2.0 * 12).toBe(24);
    expect(startingYield(getTemplate('londonium')!, 12)).toBe(25);
    expect(startingYield(getTemplate('gentle-and-sweet')!, 12)).toBe(25);
  });

  it('always starts inside the yield window every later change must respect', () => {
    for (const template of TEMPLATES) {
      const lever = findLever(template, 'yield');
      for (const dose of [...DOSES, 13.3, 18.6, 24.9]) {
        const { min, max } = effectiveBounds(lever, dose);
        const value = startingYield(template, dose);
        expect(value, `${template.id} at ${dose} g`).toBeGreaterThanOrEqual(min);
        expect(value, `${template.id} at ${dose} g`).toBeLessThanOrEqual(max);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it('keeps the Allongé near 1:5 instead of its bundled 135 g stop (1:7.5 at 18 g)', () => {
    const allonge = getTemplate('allonge')!;
    expect(allonge.profile.target_weight).toBe(135);
    expect(startingYield(allonge, 18)).toBe(90);
    expect(startingYield(allonge, 25)).toBe(125);
  });

  it("falls back to the template's own stop at the 18 g reference when a template has no ratio", () => {
    const noRatio: Template = clone(getTemplate('d-flow')!);
    delete noRatio.startRatio;
    expect(startRatioOf(noRatio)).toBeCloseTo(50 / 18, 12);
    expect(startingYield(noRatio, 18)).toBe(50);
    expect(startingYield(noRatio, 20)).toBe(56);
    expect(startingYield(noRatio, null)).toBe(50);
  });

  it('needs a yield lever', () => {
    const dflow = getTemplate('d-flow')!;
    const noYield: Template = { ...clone(dflow), levers: dflow.levers.filter((lever) => lever.id !== 'yield') };
    expect(() => startingYield(noYield, 18)).toThrow(LeverError);
  });
});

describe('startRatioOf', () => {
  it("reads each template's author ratio", () => {
    expect(TEMPLATES.map((t) => [t.id, startRatioOf(t)])).toEqual([
      ['blooming-espresso', 2.8],
      ['d-flow', 2.8],
      ['londonium', 2.0],
      ['allonge', 5.0],
      ['gentle-and-sweet', 2.0],
    ]);
  });
});

describe('buildStartingProfile', () => {
  it('changes target_weight and nothing else', () => {
    for (const template of TEMPLATES) {
      for (const dose of [null, 12, 18, 25]) {
        const profile = buildStartingProfile(template, dose);
        expect(profile.target_weight, `${template.id} at ${String(dose)}`).toBe(startingYield(template, dose));
        expect({ ...profile, target_weight: null }).toEqual({ ...template.profile, target_weight: null });
        expect(readLeverValue(template, profile, 'yield')).toBe(startingYield(template, dose));
      }
    }
  });

  it('passes the structure and hard-bound checks for every dose', () => {
    for (const template of TEMPLATES) {
      for (const dose of [...DOSES, null]) {
        expect(checkStructure(template, template.profile, buildStartingProfile(template, dose)), `${template.id} at ${String(dose)}`).toEqual([]);
      }
    }
  });

  it('returns a fresh profile and leaves the frozen template alone', () => {
    const template = getTemplate('blooming-espresso')!;
    const before = clone(template.profile);
    const profile = buildStartingProfile(template, 18);
    expect(profile).not.toBe(template.profile);
    profile.title = 'changed';
    expect(template.profile).toEqual(before);
  });

  it('equals the bundled default only where the start is the bundled stop (D59)', () => {
    const sameAsBundled = TEMPLATES.filter((t) => profileId(buildStartingProfile(t, 18)) === t.decaidDefaultId).map((t) => t.id);
    expect(sameAsBundled).toEqual(['d-flow', 'gentle-and-sweet']);
    expect(buildStartingProfile(getTemplate('d-flow')!, 18)).toEqual(getTemplate('d-flow')!.profile);
  });

  it('is ready for buildVersionProfile', () => {
    const template = getTemplate('londonium')!;
    const base = buildStartingProfile(template, 20);
    const version = buildVersionProfile(template, base, 'Kiambu AA v1', 'Kiambu AA');
    expect(version.target_weight).toBe(40);
    expect(version.title).toBe('Kiambu AA v1');
    expect(profileId(version)).toBe(profileId(base));
  });
});

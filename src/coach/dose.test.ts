import { describe, expect, it } from 'vitest';

import { DOSE_RULES, knownDose, REFERENCE_DOSE_G } from './dose.ts';
import { DOSE_RULES as VALIDATOR_DOSE_RULES } from './validator.ts';

describe('knownDose', () => {
  it('keeps a dose between 12 and 25 g, both ends included', () => {
    for (const dose of [12, 14.5, 18, 21.3, 25]) expect(knownDose(dose), String(dose)).toBe(dose);
  });

  it('treats a dose outside 12-25 g as unknown', () => {
    // A 7 g basket would turn Blooming's yield window upside down (min 30 g > max 24 g).
    for (const dose of [7, 11.9, 25.1, 30, 0, -18]) expect(knownDose(dose), String(dose)).toBeNull();
  });

  it('treats a missing or non-finite dose as unknown', () => {
    for (const dose of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(knownDose(dose)).toBeNull();
  });
});

describe('dose constants', () => {
  it("uses Decent's stock 18 g basket as the reference dose", () => {
    expect(REFERENCE_DOSE_G).toBe(18);
    expect(knownDose(REFERENCE_DOSE_G)).toBe(18);
  });

  it('keeps the manual dose rules, still exported by the validator', () => {
    expect(DOSE_RULES).toEqual({ min: 12, max: 25, maxDelta: 1, granularity: 0.1 });
    expect(VALIDATOR_DOSE_RULES).toBe(DOSE_RULES);
  });
});

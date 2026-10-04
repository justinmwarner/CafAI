/**
 * Where a bag starts: v1's yield and profile (D57).
 *
 * v1 follows the dose rather than the template's bundled stop. Each profile
 * author brews at a ratio Decent ships for its 18 g reference dose
 * (Template.startRatio); v1 multiplies the dose Decaid has by it, so it
 * starts inside the dose window every later yield change must respect. The
 * bundled stops do not: the Allongé's 135 g is 1:7.5 at 18 g, and Blooming's
 * 60 g sits above its own window at a 15 g dose.
 */
import { knownDose, REFERENCE_DOSE_G } from './dose.ts';
import { applyLever, effectiveBounds, findLever, readLeverValue, snapToGranularity } from './levers.ts';
import type { ProfileJson, Template } from './types.ts';

const YIELD = 'yield';

/** v1's brew ratio: the author's, or the template's own stop at the 18 g reference dose. */
export function startRatioOf(template: Template): number {
  return template.startRatio ?? readLeverValue(template, template.profile, YIELD) / REFERENCE_DOSE_G;
}

/**
 * v1's yield in grams: the start ratio times the dose (the 18 g reference
 * when the dose is unknown or outside 12-25 g), snapped to the yield lever's
 * 1 g step (ties round up), then kept inside the lever's bounds for that dose.
 */
export function startingYield(template: Template, doseG: number | null): number {
  const lever = findLever(template, YIELD);
  const dose = knownDose(doseG) ?? REFERENCE_DOSE_G;
  const grams = snapToGranularity(startRatioOf(template) * dose, lever.granularity);
  const { min, max } = effectiveBounds(lever, dose);
  return Math.min(max, Math.max(min, grams));
}

/**
 * v1's profile for this dose: the bundled profile with the yield lever set to
 * startingYield() through the lever code, so target_weight is the only
 * change. Ready for buildVersionProfile(template, base, title, bagName).
 */
export function buildStartingProfile(template: Template, doseG: number | null): ProfileJson {
  return applyLever(template, template.profile, YIELD, startingYield(template, doseG));
}

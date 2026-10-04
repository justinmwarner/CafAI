/**
 * The dose rules shared by the yield window, v1's starting yield and the
 * manual dose variable.
 *
 * A dose outside 12-25 g is not one CafAI coaches from: a 7 g dose would
 * turn Blooming's yield window upside down (2.0-3.5 x 7 g against its 30-80 g
 * lever: min 30 g > max 24 g). Such a dose counts as unknown, so the yield
 * lever keeps its plain gram bounds and v1 starts from the reference dose
 * (D57).
 */

/** Manual dose rules: sane grams, and small steps so the shot stays comparable. */
export const DOSE_RULES = { min: 12, max: 25, maxDelta: 1, granularity: 0.1 } as const;

/** Decent's stock basket and Decaid's default dose: v1 assumes it when the dose is unknown. */
export const REFERENCE_DOSE_G = 18;

const SLACK = 1e-9;

/** The dose when CafAI can coach from it (12-25 g), else null. */
export function knownDose(doseG: number | null | undefined): number | null {
  if (typeof doseG !== 'number' || !Number.isFinite(doseG)) return null;
  return doseG >= DOSE_RULES.min - SLACK && doseG <= DOSE_RULES.max + SLACK ? doseG : null;
}

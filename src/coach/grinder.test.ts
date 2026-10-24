import { describe, expect, it } from 'vitest';

import { decaidStepNote, finestFirst, grinderSettings, grinderStep, resolveGrindMove, type DialResult } from './grinder.ts';
import type { GrinderInfo } from './types.ts';
import { GRIND_MAX_STEPS } from './validator.ts';

const NICHE: GrinderInfo = { model: 'Niche Zero', settingType: 'numeric', smallStep: 0.5, bigStep: 2, values: null };
const MIGNON: GrinderInfo = { model: 'Eureka Mignon', settingType: 'numeric', smallStep: 1, bigStep: 5, values: null };
const DITTING: GrinderInfo = {
  model: 'Ditting 807',
  settingType: 'preset',
  smallStep: null,
  bigStep: null,
  values: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
};

const NICHE_STEP = "Your grinder moves in steps of 0.5 (Decaid's grinder library)";
const DITTING_ALL =
  'Your grinder\'s settings in Decaid\'s grinder library, finest first: "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8".';

type Direction = 'finer' | 'coarser';
const move = (direction: Direction, amount: number | null, setting: string | null = null) => ({ direction, amount, setting });

function okMove(result: DialResult | null) {
  if (result === null) throw new Error('expected a dial move, got null (no usable dial)');
  if (!result.ok) throw new Error(`expected a move, got: ${result.error}`);
  return result.move;
}

function errorOf(result: DialResult | null): string {
  if (result === null) throw new Error('expected an error, got null (no usable dial)');
  if (result.ok) throw new Error(`expected an error, got setting ${String(result.move.setting)}`);
  return result.error;
}

describe('grinderStep', () => {
  it("reads Decaid's small step of a numeric grinder", () => {
    expect(grinderStep(NICHE)).toBe(0.5);
    expect(grinderStep(MIGNON)).toBe(1);
    expect(grinderStep({ ...NICHE, smallStep: 0.1 + 0.2 })).toBe(0.3);
  });

  it('has no step without a usable one, or for a preset grinder', () => {
    for (const smallStep of [null, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(grinderStep({ ...NICHE, smallStep }), String(smallStep)).toBeNull();
    }
    expect(grinderStep({ ...DITTING, smallStep: 1 })).toBeNull();
    expect(grinderStep(null)).toBeNull();
    expect(grinderStep(undefined)).toBeNull();
  });
});

describe('grinderSettings', () => {
  it("reads a preset grinder's list, trimmed, in Decaid's order", () => {
    expect(grinderSettings(DITTING)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
    expect(grinderSettings({ ...DITTING, values: [' 1 ', '2'] })).toEqual(['1', '2']);
  });

  it('has no list for an empty one or a numeric grinder', () => {
    expect(grinderSettings({ ...DITTING, values: [] })).toBeNull();
    expect(grinderSettings({ ...DITTING, values: null })).toBeNull();
    expect(grinderSettings({ ...NICHE, values: ['1', '2'] })).toBeNull();
    expect(grinderSettings(null)).toBeNull();
  });
});

describe('decaidStepNote', () => {
  it("says what Decaid lists for the user's grinder", () => {
    expect(decaidStepNote(NICHE)).toBe('Decaid lists 0.5 steps for your Niche Zero');
    expect(decaidStepNote({ ...NICHE, smallStep: 0.25 })).toBe('Decaid lists 0.25 steps for your Niche Zero');
    expect(decaidStepNote(MIGNON)).toBe('Decaid lists steps of 1 for your Eureka Mignon');
    expect(decaidStepNote(DITTING)).toBe('Decaid lists 8 settings for your Ditting 807');
    expect(decaidStepNote({ ...NICHE, model: '  ' })).toBe('Decaid lists 0.5 steps for your grinder');
  });

  it('says nothing without step data', () => {
    expect(decaidStepNote({ ...NICHE, smallStep: null })).toBeNull();
    expect(decaidStepNote({ ...DITTING, values: [] })).toBeNull();
    expect(decaidStepNote(null)).toBeNull();
  });
});

describe('resolveGrindMove: a numeric dial with a small step', () => {
  it('turns a relative move into the new setting, lower numbers being finer', () => {
    expect(okMove(resolveGrindMove(NICHE, '15', move('finer', 1)))).toEqual({ setting: '14.5', steps: 1, notes: [] });
    expect(okMove(resolveGrindMove(NICHE, '15', move('coarser', 3)))).toEqual({ setting: '16.5', steps: 3, notes: [] });
    expect(okMove(resolveGrindMove(MIGNON, '15', move('finer', 2)))).toEqual({ setting: '13', steps: 2, notes: [] });
  });

  it("prints the new setting with the step's decimals, without float noise", () => {
    expect(okMove(resolveGrindMove(NICHE, '15', move('finer', 2))).setting).toBe('14.0');
    expect(okMove(resolveGrindMove({ ...NICHE, smallStep: 0.1 }, '2.2', move('finer', 3))).setting).toBe('1.9');
    expect(okMove(resolveGrindMove({ ...NICHE, smallStep: 0.25 }, '3', move('coarser', 1))).setting).toBe('3.25');
    expect(okMove(resolveGrindMove(NICHE, '0.5', move('finer', 1))).setting).toBe('0.0');
  });

  it('keeps the precision of a current setting written finer than the step, so the result stays on its grid', () => {
    // 14.25 - 0.5 is 13.75; with the step's one decimal alone it would print 13.8, which is off the grid.
    expect(okMove(resolveGrindMove(NICHE, '14.25', move('finer', 1))).setting).toBe('13.75');
    expect(okMove(resolveGrindMove(MIGNON, '15.0', move('coarser', 1))).setting).toBe('16.0');
    expect(okMove(resolveGrindMove(NICHE, '14.25', move('finer', null, '13.75')))).toEqual({ setting: '13.75', steps: 1, notes: [] });
  });

  it('refuses a move below 0', () => {
    expect(errorOf(resolveGrindMove(NICHE, '0.5', move('finer', 2)))).toBe(
      `grind: 2 steps finer from 0.5 would be -0.5, below 0. ${NICHE_STEP}: 1 step finer from 0.5 is 0.0.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '0', move('finer', 1)))).toBe(
      `grind: 1 step finer from 0 would be -0.5, below 0. ${NICHE_STEP}: it cannot go finer than 0.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1, '-0.5')))).toBe(
      `grind.setting "-0.5" is below 0. ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
  });

  it('needs whole steps for a relative move', () => {
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1.5)))).toBe(
      `grind.amount 1.5 is not a whole number of steps. ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
  });

  it('checks a given setting: on the grid, in the stated direction, at most 5 steps away', () => {
    expect(okMove(resolveGrindMove(NICHE, '15', move('finer', null, '14.5')))).toEqual({ setting: '14.5', steps: 1, notes: [] });
    expect(okMove(resolveGrindMove(NICHE, '15', move('coarser', 5, '17.5')))).toEqual({ setting: '17.5', steps: 5, notes: [] });
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1, '14.3')))).toBe(
      `grind.setting "14.3" is not a whole number of steps from 15. ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1, '16')))).toBe(
      `grind.setting "16" is coarser than 15 (lower numbers are finer), but grind.direction is "finer". ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '15', move('coarser', 1, '14.5')))).toBe(
      `grind.setting "14.5" is finer than 15 (lower numbers are finer), but grind.direction is "coarser". ${NICHE_STEP}: 1 step coarser from 15 is 15.5.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 5, '12')))).toBe(
      `grind.setting "12" is 6 steps from 15; move at most ${GRIND_MAX_STEPS} steps per shot. ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1, '14 1/2')))).toBe(
      `grind.setting "14 1/2" is not a number. ${NICHE_STEP}: 1 step finer from 15 is 14.5.`,
    );
  });

  it('refuses the setting the grinder is on now, however it is written', () => {
    expect(errorOf(resolveGrindMove(NICHE, '15', move('finer', 1, '15.0')))).toBe(
      'grind.setting "15.0" is the setting the grinder is on now. Give the new setting after the move (finer), or null if you do not know it.',
    );
  });

  it("keeps a valid given setting as written and counts Decaid's steps, noting a different amount", () => {
    expect(okMove(resolveGrindMove(NICHE, '15', move('finer', 1, '14')))).toEqual({
      setting: '14',
      steps: 2,
      notes: ['Decaid lists 0.5 steps for your Niche Zero, so 15 to 14 is 2 steps, not 1.'],
    });
  });

  it('leaves an unsized move unsized', () => {
    expect(okMove(resolveGrindMove(NICHE, '15', move('finer', null)))).toEqual({ setting: null, steps: null, notes: [] });
  });
});

describe('resolveGrindMove: a preset list', () => {
  it('moves places in the list, finest first', () => {
    expect(okMove(resolveGrindMove(DITTING, 'E4', move('finer', 1)))).toEqual({ setting: 'E3', steps: 1, notes: [] });
    expect(okMove(resolveGrindMove(DITTING, 'E4', move('coarser', 2)))).toEqual({ setting: 'E6', steps: 2, notes: [] });
    expect(okMove(resolveGrindMove(DITTING, ' E4 ', move('finer', 3)))).toEqual({ setting: 'E1', steps: 3, notes: [] });
  });

  it('refuses to fall off either end of the list', () => {
    expect(errorOf(resolveGrindMove(DITTING, 'E2', move('finer', 3)))).toBe(
      'grind: 3 steps finer from "E2" goes past the end of the list: the finest setting, "E1", is 1 step finer. ' +
        'Your grinder\'s settings in Decaid\'s grinder library around "E2", finest first: "E1", "E2", "E3", "E4", "E5", "E6", "E7".',
    );
    expect(errorOf(resolveGrindMove(DITTING, 'E7', move('coarser', 2)))).toMatch(
      /^grind: 2 steps coarser from "E7" goes past the end of the list: the coarsest setting, "E8", is 1 step coarser\./,
    );
    expect(errorOf(resolveGrindMove(DITTING, 'E1', move('finer', 1)))).toMatch(
      /^grind: 1 step finer from "E1" goes past the end of the list: "E1" is already the finest setting\./,
    );
  });

  it('needs a whole number of places', () => {
    expect(errorOf(resolveGrindMove(DITTING, 'E4', move('finer', 0.5)))).toBe(
      `grind.amount 0.5 is not a whole number of steps (one step is one place in the list). ${DITTING_ALL}`,
    );
  });

  it('checks a given setting: in the list, in the stated direction, at most 5 places away', () => {
    expect(okMove(resolveGrindMove(DITTING, 'E4', move('finer', 2, 'E2')))).toEqual({ setting: 'E2', steps: 2, notes: [] });
    expect(errorOf(resolveGrindMove(DITTING, 'E4', move('finer', 1, 'E9')))).toBe(
      `grind.setting "E9" is not one of your grinder's settings. ${DITTING_ALL}`,
    );
    expect(errorOf(resolveGrindMove(DITTING, 'E4', move('finer', 1, 'E5')))).toBe(
      `grind.setting "E5" is coarser than "E4" in the list, but grind.direction is "finer". ${DITTING_ALL}`,
    );
    expect(errorOf(resolveGrindMove(DITTING, 'E1', move('coarser', 5, 'E8')))).toMatch(
      /^grind\.setting "E8" is 7 places from "E1"; move at most 5 places per shot\./,
    );
    expect(errorOf(resolveGrindMove(DITTING, 'E4', move('coarser', 1, 'E4')))).toMatch(/"E4" is the setting the grinder is on now/);
  });

  it('notes a different amount, counting places in the list', () => {
    expect(okMove(resolveGrindMove(DITTING, 'E4', move('finer', 1, 'E2'))).notes).toEqual([
      'Decaid lists 8 settings for your Ditting 807, so E4 to E2 is 2 steps, not 1.',
    ]);
  });

  it('lists only the settings near the current one in a long list', () => {
    const long: GrinderInfo = { ...DITTING, values: Array.from({ length: 40 }, (_, i) => String(i + 1)) };
    expect(errorOf(resolveGrindMove(long, '20', move('finer', 1, '99')))).toBe(
      'grind.setting "99" is not one of your grinder\'s settings. Your grinder\'s settings in Decaid\'s grinder library around "20", finest first: ' +
        '"15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25".',
    );
  });
});

describe('which way is finer (D241)', () => {
  /** A numbered dial whose higher numbers are finer, as the barista said in Settings. */
  const UPWARD: GrinderInfo = { ...NICHE, model: 'Upward', finerIsHigher: true };
  /** A preset list in the grinder's own order, "1" to "8", on a grinder whose higher numbers are finer. */
  const STEPPED: GrinderInfo = {
    model: 'Stepped',
    settingType: 'preset',
    smallStep: null,
    bigStep: null,
    values: ['1', '2', '3', '4', '5', '6', '7', '8'],
    finerIsHigher: true,
  };
  const UPWARD_STEP = "Your grinder moves in steps of 0.5 (Decaid's grinder library)";
  const STEPPED_ALL = 'Your grinder\'s settings in Decaid\'s grinder library, finest first: "8", "7", "6", "5", "4", "3", "2", "1".';

  it('reads a list as Decaid gives it, finest first, while lower numbers are finer (D62)', () => {
    expect(finestFirst(['1', '2', '3'], false)).toEqual(['1', '2', '3']);
    expect(finestFirst(['3', '2', '1'], false)).toEqual(['3', '2', '1']);
    expect(finestFirst(['Fine', 'Medium', 'Coarse'], false)).toEqual(['Fine', 'Medium', 'Coarse']);
  });

  it('reads a list backwards on a grinder whose higher numbers are finer', () => {
    expect(finestFirst(['1', '2', '3'], true)).toEqual(['3', '2', '1']);
    expect(finestFirst(['1', '1.5', '2'], true)).toEqual(['2', '1.5', '1']);
    expect(finestFirst(['E1', 'E2', 'E3'], true)).toEqual(['E3', 'E2', 'E1']);
    // Numbers out of order are no grinder's own order to trust: read backwards, as any other list.
    expect(finestFirst(['1', '3', '2'], true)).toEqual(['2', '3', '1']);
  });

  it('keeps a list of numbers that already runs from its highest, as Add a grinder and the coach ask lists to be typed (finest first)', () => {
    expect(finestFirst(['12', '11', '10'], true)).toEqual(['12', '11', '10']);
    expect(finestFirst([' 3 ', '2.5', '2'], true)).toEqual([' 3 ', '2.5', '2']);
    expect(finestFirst(['5'], true)).toEqual(['5']);
  });

  it('never changes the list it was given', () => {
    const values = ['1', '2', '3'];
    finestFirst(values, true);
    expect(values).toEqual(['1', '2', '3']);
  });

  it("gives a preset grinder's settings finest first, trimmed, whichever way its numbers go", () => {
    expect(grinderSettings(STEPPED)).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
    expect(grinderSettings({ ...STEPPED, values: [' 1 ', '2'] })).toEqual(['2', '1']);
    expect(grinderSettings({ ...STEPPED, finerIsHigher: false })).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(decaidStepNote(STEPPED)).toBe('Decaid lists 8 settings for your Stepped');
  });

  it('moves a numbered dial up for finer and down for coarser', () => {
    expect(okMove(resolveGrindMove(UPWARD, '15', move('finer', 1)))).toEqual({ setting: '15.5', steps: 1, notes: [] });
    expect(okMove(resolveGrindMove(UPWARD, '15', move('finer', 2)))).toEqual({ setting: '16.0', steps: 2, notes: [] });
    expect(okMove(resolveGrindMove(UPWARD, '15', move('coarser', 3)))).toEqual({ setting: '13.5', steps: 3, notes: [] });
    // Absent or false reads as lower numbers finer, as before.
    expect(okMove(resolveGrindMove({ ...UPWARD, finerIsHigher: false }, '15', move('finer', 1))).setting).toBe('14.5');
  });

  it('refuses a coarser move below 0, the end that is coarsest on such a dial', () => {
    expect(errorOf(resolveGrindMove(UPWARD, '0.5', move('coarser', 2)))).toBe(
      `grind: 2 steps coarser from 0.5 would be -0.5, below 0. ${UPWARD_STEP}: 1 step coarser from 0.5 is 0.0.`,
    );
    expect(errorOf(resolveGrindMove(UPWARD, '0', move('coarser', 1)))).toBe(
      `grind: 1 step coarser from 0 would be -0.5, below 0. ${UPWARD_STEP}: it cannot go coarser than 0.`,
    );
    expect(okMove(resolveGrindMove(UPWARD, '0', move('finer', 1))).setting).toBe('0.5');
  });

  it("checks a given setting's direction the grinder's way, and says which way that is", () => {
    expect(okMove(resolveGrindMove(UPWARD, '15', move('finer', 2, '16')))).toEqual({ setting: '16', steps: 2, notes: [] });
    expect(okMove(resolveGrindMove(UPWARD, '15', move('coarser', 1, '14.5')))).toEqual({ setting: '14.5', steps: 1, notes: [] });
    expect(errorOf(resolveGrindMove(UPWARD, '15', move('finer', 1, '14.5')))).toBe(
      `grind.setting "14.5" is coarser than 15 (higher numbers are finer), but grind.direction is "finer". ${UPWARD_STEP}: 1 step finer from 15 is 15.5.`,
    );
    expect(errorOf(resolveGrindMove(UPWARD, '15', move('coarser', 1, '16')))).toBe(
      `grind.setting "16" is finer than 15 (higher numbers are finer), but grind.direction is "coarser". ${UPWARD_STEP}: 1 step coarser from 15 is 14.5.`,
    );
  });

  it('moves along a preset list from its finest end', () => {
    expect(okMove(resolveGrindMove(STEPPED, '4', move('finer', 1)))).toEqual({ setting: '5', steps: 1, notes: [] });
    expect(okMove(resolveGrindMove(STEPPED, '4', move('coarser', 2)))).toEqual({ setting: '2', steps: 2, notes: [] });
    expect(okMove(resolveGrindMove(STEPPED, '4', move('finer', 2, '6')))).toEqual({ setting: '6', steps: 2, notes: [] });
    expect(errorOf(resolveGrindMove(STEPPED, '7', move('finer', 3)))).toBe(
      'grind: 3 steps finer from "7" goes past the end of the list: the finest setting, "8", is 1 step finer. ' +
        'Your grinder\'s settings in Decaid\'s grinder library around "7", finest first: "8", "7", "6", "5", "4", "3", "2".',
    );
    expect(errorOf(resolveGrindMove(STEPPED, '1', move('coarser', 1)))).toMatch(
      /^grind: 1 step coarser from "1" goes past the end of the list: "1" is already the coarsest setting\./,
    );
    expect(errorOf(resolveGrindMove(STEPPED, '4', move('finer', 1, '3')))).toBe(
      `grind.setting "3" is coarser than "4" in the list, but grind.direction is "finer". ${STEPPED_ALL}`,
    );
  });
});

describe('resolveGrindMove: no usable dial', () => {
  it('returns null, so the move stays as the model gave it', () => {
    expect(resolveGrindMove(null, '15', move('finer', 1))).toBeNull();
    expect(resolveGrindMove(undefined, '15', move('finer', 1))).toBeNull();
    expect(resolveGrindMove({ ...NICHE, smallStep: null }, '15', move('finer', 1))).toBeNull();
    expect(resolveGrindMove({ ...DITTING, values: null }, 'E4', move('finer', 1))).toBeNull();
  });

  it('returns null for a current setting CafAI cannot read', () => {
    for (const current of [null, '', '  ', 'two turns', '15 (Niche)', '-2', '14,5']) {
      expect(resolveGrindMove(NICHE, current, move('finer', 1)), String(current)).toBeNull();
    }
    expect(resolveGrindMove(DITTING, 'E9', move('finer', 1))).toBeNull();
  });
});

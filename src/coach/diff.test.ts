// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/views.test.ts, the leadChange cases (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: rewritten for one-variable lever and manual changes.
import { describe, expect, it } from 'vitest';

import { clone } from '../util/clone.ts';
import { describeLeverChange, describeManualChange, describeManualSteps, diffProfiles, formatLeverValue } from './diff.ts';
import { applyLever, findLever } from './levers.ts';
import { getTemplate } from './templates/index.ts';

const bloomingT = getTemplate('blooming-espresso')!;
const dflowT = getTemplate('d-flow')!;
const londoniumT = getTemplate('londonium')!;

describe('describeLeverChange', () => {
  it('says a temperature shift moves every step', () => {
    expect(describeLeverChange(bloomingT, 'temp', 92, 93)).toBe('Brew temperature: 92.0 °C -> 93.0 °C (every step +1.0 °C)');
    expect(describeLeverChange(londoniumT, 'temp', 88, 87.5)).toBe(
      'Brew temperature: 88.0 °C -> 87.5 °C (every step -0.5 °C)',
    );
  });

  it('says where a yield change stops the shot', () => {
    expect(describeLeverChange(dflowT, 'yield', 36, 38)).toBe('Yield: 36 g -> 38 g (the shot stops at 38 g)');
  });

  it('names the steps a linked lever moves together', () => {
    expect(describeLeverChange(bloomingT, 'flow', 2.2, 2.4)).toBe('Extraction flow: 2.2 ml/s -> 2.4 ml/s (ramp and flat flow)');
    expect(describeLeverChange(dflowT, 'soak', 3, 3.5)).toBe('Fill & soak pressure: 3.0 bar -> 3.5 bar (Filling and Infusing)');
  });

  it('keeps single-path levers to one plain line', () => {
    expect(describeLeverChange(bloomingT, 'bloom', 30, 35)).toBe('Bloom time: 30 s -> 35 s');
    expect(describeLeverChange(dflowT, 'pourPmax', 8.5, 9)).toBe('Max pressure while pouring: 8.5 bar -> 9.0 bar');
  });

  it('formats values with the precision of the lever', () => {
    expect(formatLeverValue(findLever(dflowT, 'pourFlow'), 2)).toBe('2.0 ml/s');
    expect(formatLeverValue(findLever(dflowT, 'soakWeight'), 5)).toBe('5 g');
  });
});

describe('describeManualChange (Crema leadChange, one variable)', () => {
  const current = { doseG: 18, grinderSetting: '14.5' };
  const grind = (direction: 'finer' | 'coarser', amount: number | null, setting: string | null) => ({
    variable: 'grind' as const,
    value: null,
    grind: { direction, amount, setting },
  });

  it('a grind change leads with the direction, not just the number', () => {
    expect(describeManualChange(grind('finer', 1, null), current)).toBe('Grind 1 step finer (now 14.5)');
    expect(describeManualChange(grind('coarser', 2, '16'), current)).toBe('Grind 2 steps coarser: 14.5 -> 16');
    expect(describeManualChange(grind('finer', null, '14'), current)).toBe('Grind finer: 14.5 -> 14');
    expect(describeManualChange(grind('finer', null, null), { doseG: null, grinderSetting: null })).toBe('Grind a little finer');
    expect(describeManualChange(grind('coarser', 0.5, '3.3'), { doseG: null, grinderSetting: null })).toBe(
      'Grind 0.5 steps coarser, to 3.3',
    );
  });

  it('shows a dose change as before and after', () => {
    expect(describeManualChange({ variable: 'dose', value: 18.5, grind: null }, current)).toBe('Dose 18.0 g -> 18.5 g');
    expect(describeManualChange({ variable: 'dose', value: 18.5, grind: null }, { doseG: null, grinderSetting: null })).toBe(
      'Dose 18.5 g',
    );
  });

  it('no change reads as keeping everything, rather than an empty headline', () => {
    expect(describeManualChange({ variable: 'none', value: null, grind: null }, current)).toBe('Keep everything as it is');
  });

  it('turns manual changes into instructions for the hands', () => {
    expect(describeManualSteps(grind('finer', 1, null))).toEqual(['Set the grinder 1 step finer before the next shot.']);
    expect(describeManualSteps(grind('coarser', 2, '16'))).toEqual([
      'Set the grinder to 16 (2 steps coarser) before the next shot.',
    ]);
    expect(describeManualSteps({ variable: 'dose', value: 18.5, grind: null })).toEqual([
      'Weigh 18.5 g of coffee for the next shot.',
    ]);
    expect(describeManualSteps({ variable: 'none', value: null, grind: null })).toEqual([]);
  });
});

describe('diffProfiles', () => {
  it('collapses a uniform temperature shift to one line', () => {
    expect(diffProfiles(bloomingT.profile, applyLever(bloomingT, bloomingT.profile, 'temp', 93))).toEqual([
      'All step temperatures +1.0 °C',
    ]);
  });

  it('lists each changed field with its step and unit', () => {
    let after = applyLever(bloomingT, bloomingT.profile, 'flow', 2.4);
    after = applyLever(bloomingT, after, 'piExit', 4.5);
    after = applyLever(bloomingT, after, 'bloom', 35);
    after = applyLever(bloomingT, after, 'yield', 62);
    expect(diffProfiles(bloomingT.profile, after)).toEqual([
      'Yield (target weight): 60 g -> 62 g',
      'Step 2 (preinfusion) exit when pressure over: 4.0 bar -> 4.5 bar',
      'Step 3 (pause) time limit: 30 s -> 35 s',
      'Step 4 (ramp) flow: 2.2 ml/s -> 2.4 ml/s',
      'Step 5 (flat flow) flow: 2.2 ml/s -> 2.4 ml/s',
    ]);
  });

  it('reads limiters and weights in their own units', () => {
    let after = applyLever(dflowT, dflowT.profile, 'pourPmax', 9);
    after = applyLever(dflowT, after, 'soakWeight', 5);
    expect(diffProfiles(dflowT.profile, after)).toEqual([
      'Step 2 (Infusing) weight exit: 4 g -> 5 g',
      'Step 3 (Pouring) pressure limit: 8.5 bar -> 9.0 bar',
    ]);
  });

  it('shows uneven temperatures step by step and structural edits plainly', () => {
    const after = clone(londoniumT.profile);
    after.steps[2]!.temperature = 90;
    after.steps[0]!.transition = 'smooth';
    after.steps.pop();
    expect(diffProfiles(londoniumT.profile, after)).toEqual([
      'Steps: 7 -> 6',
      'Step 1 (Fill start) transition: fast -> smooth',
      'Step 3 (Infuse) temperature: 88.5 °C -> 90.0 °C',
    ]);
  });

  it('is empty for identical execution content, whatever the title', () => {
    expect(diffProfiles(dflowT.profile, { ...clone(dflowT.profile), title: 'Kiambu AA v2' })).toEqual([]);
  });
});

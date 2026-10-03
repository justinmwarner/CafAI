import { describe, expect, it } from 'vitest';

import { clone } from '../util/clone.ts';
import {
  applyLever,
  effectiveBounds,
  findLever,
  LeverError,
  parsePath,
  readLeverValue,
  readLeverValues,
  readPath,
  snapToGranularity,
} from './levers.ts';
import { getTemplate, TEMPLATES } from './templates/index.ts';
import type { ProfileJson, Template } from './types.ts';

const bloomingT = getTemplate('blooming-espresso')!;
const dflowT = getTemplate('d-flow')!;
const londoniumT = getTemplate('londonium')!;

/** Everything except the listed paths must be untouched. */
function expectOnlyChanged(before: ProfileJson, after: ProfileJson, changed: Array<[number | null, string]>) {
  const strip = (p: ProfileJson) => {
    const copy = clone(p) as unknown as Record<string, unknown> & { steps: Record<string, unknown>[] };
    for (const [step, key] of changed) {
      if (step === null) delete copy[key];
      else delete copy.steps[step]![key];
    }
    return copy;
  };
  expect(strip(after)).toEqual(strip(before));
}

describe('parsePath', () => {
  it('reads the lever path forms', () => {
    expect(parsePath('target_weight')).toEqual([{ key: 'target_weight', index: null }]);
    expect(parsePath('steps[2].seconds')).toEqual([
      { key: 'steps', index: 2 },
      { key: 'seconds', index: null },
    ]);
    expect(parsePath('steps[*].temperature')).toEqual([
      { key: 'steps', index: '*' },
      { key: 'temperature', index: null },
    ]);
    expect(parsePath('steps[1].exit.value')).toEqual([
      { key: 'steps', index: 1 },
      { key: 'exit', index: null },
      { key: 'value', index: null },
    ]);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'steps[', 'steps[a].x', '.x', 'steps[1]..x', 'steps[-1].x', 'a b']) {
      expect(() => parsePath(bad), bad).toThrow(LeverError);
    }
  });
});

describe('readPath', () => {
  const blooming = bloomingT.profile;
  it('reads one value, a wildcard, and nested objects', () => {
    expect(readPath(blooming, 'target_weight')).toEqual([60]);
    expect(readPath(blooming, 'steps[*].temperature')).toEqual([97.5, 97.5, 90, 92, 92, 98]);
    expect(readPath(blooming, 'steps[1].exit.value')).toEqual([4]);
    expect(readPath(dflowT.profile, 'steps[2].limiter.value')).toEqual([8.5]);
    expect(readPath(dflowT.profile, 'steps[1].weight')).toEqual([4]);
  });

  it('throws on a path the profile does not have', () => {
    expect(() => readPath(blooming, 'steps[9].seconds')).toThrow(/steps\[9\]/);
    expect(() => readPath(blooming, 'steps[0].exit.value')).toThrow(/exit/);
    expect(() => readPath(blooming, 'steps[0].bogus')).toThrow(/bogus/);
    expect(() => readPath(blooming, 'steps[0].name')).toThrow(/not a number/);
  });
});

describe('readLeverValues', () => {
  it('reads every lever of every template at its template value', () => {
    expect(readLeverValues(bloomingT, bloomingT.profile)).toEqual({ temp: 92, yield: 60, bloom: 30, piExit: 4, flow: 2.2 });
    expect(readLeverValues(dflowT, dflowT.profile)).toEqual({
      temp: 88,
      yield: 50,
      soak: 3,
      soakWeight: 4,
      pourFlow: 1.7,
      pourPmax: 8.5,
    });
    expect(readLeverValues(londoniumT, londoniumT.profile)).toEqual({
      temp: 88,
      yield: 42,
      soak: 12,
      peak: 9,
      declineEnd: 3,
    });
  });

  it('refuses linked paths that disagree, because the profile was not built by a lever', () => {
    const broken = clone(bloomingT.profile);
    broken.steps[4]!.flow = 2.5;
    expect(() => readLeverValue(bloomingT, broken, 'flow')).toThrow(/2\.2.*2\.5/);
  });
});

describe('applyLever', () => {
  it('shifts every step temperature by the same delta, from the anchor', () => {
    const next = applyLever(bloomingT, bloomingT.profile, 'temp', 93);
    expect(next.steps.map((s) => s.temperature)).toEqual([98.5, 98.5, 91, 93, 93, 99]);
    expectOnlyChanged(bloomingT.profile, next, [0, 1, 2, 3, 4, 5].map((i) => [i, 'temperature'] as [number, string]));
  });

  it('keeps the Londonium temperature shape when lowering', () => {
    const next = applyLever(londoniumT, londoniumT.profile, 'temp', 86.5);
    expect(next.steps.map((s) => s.temperature)).toEqual([87.5, 87.5, 87, 87, 86.5, 86.5, 86.5]);
  });

  it('writes a linked value to every path and nothing else', () => {
    const flow = applyLever(bloomingT, bloomingT.profile, 'flow', 2.4);
    expect([flow.steps[3]!.flow, flow.steps[4]!.flow]).toEqual([2.4, 2.4]);
    expectOnlyChanged(bloomingT.profile, flow, [
      [3, 'flow'],
      [4, 'flow'],
    ]);

    const soak = applyLever(dflowT, dflowT.profile, 'soak', 3.5);
    expect([soak.steps[0]!.pressure, soak.steps[1]!.pressure]).toEqual([3.5, 3.5]);
    expect(soak.steps[0]!.exit).toEqual({ type: 'pressure', condition: 'over', value: 1.5 });

    const decline = applyLever(londoniumT, londoniumT.profile, 'declineEnd', 4);
    expect([decline.steps[4]!.pressure, decline.steps[5]!.pressure]).toEqual([4, 4]);
    expectOnlyChanged(londoniumT.profile, decline, [
      [4, 'pressure'],
      [5, 'pressure'],
    ]);
  });

  it('writes nested exit and limiter values in place', () => {
    const exit = applyLever(bloomingT, bloomingT.profile, 'piExit', 4.5);
    expect(exit.steps[1]!.exit).toEqual({ type: 'pressure', condition: 'over', value: 4.5 });

    const pmax = applyLever(dflowT, dflowT.profile, 'pourPmax', 9);
    expect(pmax.steps[2]!.limiter).toEqual({ value: 9, range: 0.2 });
  });

  it('moves only the soak weight, not the Filling safety weight', () => {
    const next = applyLever(dflowT, dflowT.profile, 'soakWeight', 6);
    expect(next.steps.map((s) => s.weight)).toEqual([5, 6, 0]);
  });

  it('writes the yield to target_weight', () => {
    expect(applyLever(londoniumT, londoniumT.profile, 'yield', 44).target_weight).toBe(44);
  });

  it('snaps to the lever granularity without float noise', () => {
    expect(applyLever(bloomingT, bloomingT.profile, 'temp', 92.7).steps[4]!.temperature).toBe(92.5);
    expect(applyLever(bloomingT, bloomingT.profile, 'flow', 2.26).steps[3]!.flow).toBe(2.3);
    expect(applyLever(dflowT, dflowT.profile, 'pourFlow', 1.7 + 0.3).steps[2]!.flow).toBe(2);
    const warmer = applyLever(dflowT, applyLever(dflowT, dflowT.profile, 'pourFlow', 1.9), 'pourFlow', 2.2);
    expect(warmer.steps[2]!.flow).toBe(2.2);
  });

  it('returns a new profile and leaves its input alone', () => {
    const before = clone(dflowT.profile);
    const next = applyLever(dflowT, dflowT.profile, 'temp', 90);
    expect(next).not.toBe(dflowT.profile);
    expect(dflowT.profile).toEqual(before);
  });

  it('round-trips every lever of every template', () => {
    for (const template of TEMPLATES) {
      for (const lever of template.levers) {
        const value = readLeverValue(template, template.profile, lever.id);
        const moved = applyLever(template, template.profile, lever.id, value + lever.granularity);
        expect(readLeverValue(template, moved, lever.id), `${template.id}.${lever.id}`).toBe(
          snapToGranularity(value + lever.granularity, lever.granularity),
        );
        expect(applyLever(template, moved, lever.id, value)).toEqual(template.profile);
      }
    }
  });

  it('refuses unknown levers and non-finite values', () => {
    expect(() => applyLever(bloomingT, bloomingT.profile, 'pressure', 9)).toThrow(/pressure/);
    expect(() => applyLever(bloomingT, bloomingT.profile, 'temp', Number.NaN)).toThrow(LeverError);
    expect(() => findLever(bloomingT as Template, 'peak')).toThrow(/temp, yield, bloom, piExit, flow/);
  });
});

describe('snapToGranularity', () => {
  it('rounds half up on the grid', () => {
    expect(snapToGranularity(1.75, 0.1)).toBe(1.8);
    expect(snapToGranularity(92.25, 0.5)).toBe(92.5);
    expect(snapToGranularity(92.24, 0.5)).toBe(92);
    expect(snapToGranularity(33.5, 1)).toBe(34);
    expect(snapToGranularity(0.30000000000000004, 0.1)).toBe(0.3);
  });
});

describe('effectiveBounds', () => {
  const yieldOf = (t: Template) => findLever(t, 'yield');
  it('narrows yield bounds by the dose, rounded inward to whole grams', () => {
    expect(effectiveBounds(yieldOf(bloomingT), 18)).toEqual({ min: 36, max: 63 });
    expect(effectiveBounds(yieldOf(dflowT), 18)).toEqual({ min: 33, max: 54 });
    expect(effectiveBounds(yieldOf(londoniumT), 18)).toEqual({ min: 27, max: 50 });
    expect(effectiveBounds(yieldOf(bloomingT), 25)).toEqual({ min: 50, max: 80 });
  });

  it('uses the plain bounds when the dose is unknown, and ignores the dose for other levers', () => {
    expect(effectiveBounds(yieldOf(bloomingT), null)).toEqual({ min: 30, max: 80 });
    expect(effectiveBounds(findLever(bloomingT, 'temp'), 18)).toEqual({ min: 86, max: 94 });
  });
});

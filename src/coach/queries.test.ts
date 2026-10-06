import { describe, expect, it } from 'vitest';

import type { ShotRecord } from '../api/types.ts';
import type { IterationRecord, ProfileVersion } from '../storage/types.ts';
import { syntheticShotRecord } from './__fixtures__/syntheticShot.ts';
import { TOOL } from './contract.ts';
import {
  compareShots,
  createShotSource,
  getBagHistory,
  getPhaseStats,
  getShotSeries,
  getShotSummary,
  runQueryTool,
  type QueryResult,
} from './queries.ts';
import { summarizeShot } from './summary/summarize.ts';
import { getTemplate } from './templates/index.ts';
import { applyLever } from './levers.ts';

function data(result: QueryResult): Record<string, unknown> {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function error(result: QueryResult): string {
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

/** Two shots one minute apart; the newer one dripped earlier. */
function twoShots(): { older: ShotRecord; newer: ShotRecord } {
  const older = syntheticShotRecord({ id: 'shot-a' });
  const newer = syntheticShotRecord({ id: 'shot-b', firstDropS: 9 });
  newer.timestamp = '2026-10-03T08:01:00.000000';
  return { older, newer };
}

describe('createShotSource', () => {
  it('resolves latest, previous and ids, newest first whatever the input order', () => {
    const { older, newer } = twoShots();
    const source = createShotSource([older, newer]);
    expect(source.resolve('latest')?.record.id).toBe('shot-b');
    expect(source.resolve('previous')?.record.id).toBe('shot-a');
    expect(source.resolve('shot-a')?.summary.shotId).toBe('shot-a');
    expect(source.resolve('nope')).toBeNull();
    expect(createShotSource([]).resolve('latest')).toBeNull();
  });

  it('reuses a stored summary instead of recomputing it', () => {
    const record = syntheticShotRecord({ id: 'shot-c' });
    const summary = { ...summarizeShot(record), profileTitle: 'stored' };
    expect(createShotSource([{ record, summary }]).resolve('latest')?.summary.profileTitle).toBe('stored');
  });
});

describe('getShotSummary', () => {
  it('returns the aggregates and phases without the series', () => {
    const source = createShotSource([syntheticShotRecord({ id: 'shot-a' })]);
    const result = data(getShotSummary(source, 'latest'));
    expect(result).toMatchObject({ shotId: 'shot-a', doseG: 18, preinfusionEndS: expect.any(Number) });
    expect(result).not.toHaveProperty('series');
    expect(result['phases']).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Pour' })]));
  });

  it('explains an unknown shot reference', () => {
    expect(error(getShotSummary(createShotSource([syntheticShotRecord()]), 'shot-zzz'))).toMatch(
      /No shot "shot-zzz".*"latest", "previous".*get_bag_history/,
    );
    expect(error(getShotSummary(createShotSource([]), 'latest'))).toMatch(/No shots/);
  });
});

describe('getShotSeries', () => {
  const source = createShotSource([syntheticShotRecord({ id: 'shot-a' })]);

  it('returns one metric at about 1 Hz inside the window', () => {
    const result = data(getShotSeries(source, 'latest', 'pressure', 10, 20));
    expect(result).toMatchObject({ shotId: 'shot-a', metric: 'pressure', unit: 'bar' });
    expect(result['tS']).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect((result['values'] as number[])[10]).toBe(9);
  });

  it('computes resistance as pressure / flow squared, null where flow is too low', () => {
    const result = data(getShotSeries(source, 'latest', 'resistance', null, null));
    const tS = result['tS'] as number[];
    const values = result['values'] as (number | null)[];
    expect(result['unit']).toBe('bar·s²/ml²');
    expect(values[tS.indexOf(20)]).toBe(4); // 9 bar / 1.5²
    expect(values[tS.indexOf(1)]).toBeNull(); // preheat: no pressure
  });

  it('refuses a backwards or empty window, saying where the samples end on the shot clock', () => {
    expect(error(getShotSeries(source, 'latest', 'flow', 20, 10))).toMatch(/fromS .* after toS/);
    const summary = summarizeShot(syntheticShotRecord({ id: 'shot-a' }));
    const end = summary.series.tS[summary.series.tS.length - 1]!;
    expect(error(getShotSeries(source, 'latest', 'flow', 100, 120))).toBe(
      `No samples between 100 and 120 s; the samples end at ${end.toFixed(1)} s on the shot clock (t = 0 is the start of preheat).`,
    );
    // Not the shot's time: durationS is the pour, which starts after 3 s of preheat.
    expect(end).toBeGreaterThan(summary.durationS + 2.5);
  });

  it('says when a shot has no samples at all', () => {
    const empty = createShotSource([{ ...syntheticShotRecord({ id: 'shot-e' }), measurements: [] }]);
    expect(error(getShotSeries(empty, 'latest', 'pressure', 10, 20))).toBe('This shot has no samples.');
  });
});

describe('getPhaseStats', () => {
  it('summarizes each phase and reads the pre-pour stall', () => {
    const result = data(getPhaseStats(createShotSource([syntheticShotRecord()]), 'latest'));
    const phases = result['phases'] as Array<Record<string, unknown>>;
    expect(phases.map((p) => p['name'])).toEqual(['preheat', 'Fill', 'Soak', 'Pour']);
    const pour = phases[3]!;
    expect(pour['pressureMaxBar']).toBe(9);
    expect(pour['flowMeanMlS']).toBeCloseTo(1.5, 1);
    expect(pour['targetPressureBar']).toBe(9);
    expect(pour['weightGainG']).toBeGreaterThan(25);
    expect(result['flowAnalysis']).toMatchObject({ choked: false, source: 'weight', stallVerdict: 'under-pressured' });
  });
});

describe('compareShots', () => {
  it('lists both shots and the change from A to B', () => {
    const { older, newer } = twoShots();
    const result = data(compareShots(createShotSource([older, newer]), 'previous', 'latest'));
    expect((result['a'] as Record<string, unknown>)['shotId']).toBe('shot-a');
    expect((result['b'] as Record<string, unknown>)['shotId']).toBe('shot-b');
    expect((result['delta'] as Record<string, number>)['timeToFirstDropS']).toBeLessThan(-2.5);
    expect(result['sameProfile']).toBe(true);
    expect(result['profileChanges']).toEqual([]);
  });

  it('says what changed in the profile between the two shots', () => {
    const template = getTemplate('d-flow')!;
    const a = syntheticShotRecord({ id: 'shot-a' });
    const b = syntheticShotRecord({ id: 'shot-b' });
    b.timestamp = '2026-10-03T08:05:00.000000';
    a.workflow.profile = { ...template.profile, title: 'Kiambu AA v1' };
    b.workflow.profile = { ...applyLever(template, template.profile, 'temp', 89), title: 'Kiambu AA v2' };
    const result = data(compareShots(createShotSource([a, b]), 'previous', 'latest'));
    expect(result['sameProfile']).toBe(false);
    expect(result['profileChanges']).toEqual(['All step temperatures +1.0 °C']);
  });

  it('refuses comparing a shot with itself', () => {
    expect(error(compareShots(createShotSource([syntheticShotRecord()]), 'latest', 'latest'))).toMatch(/two different shots/);
  });
});

describe('getBagHistory', () => {
  const version = (n: number, change: ProfileVersion['change']): ProfileVersion => ({
    id: `v${n}`,
    bagId: 'bag-1',
    version: n,
    title: `Kiambu AA v${n}`,
    templateId: 'd-flow',
    profile: getTemplate('d-flow')!.profile,
    decaidProfileId: null,
    parentVersionId: n > 1 ? `v${n - 1}` : null,
    change,
    status: n === 2 ? 'active' : 'superseded',
    createdAt: `2026-10-03T08:0${n}:00.000Z`,
  });
  const iteration = (n: number, shotId: string): IterationRecord => ({
    id: `it${n}`,
    bagId: 'bag-1',
    bagName: 'Kiambu AA',
    profileVersionId: 'v1',
    profileVersion: 1,
    shotId,
    summary: summarizeShot(syntheticShotRecord({ id: shotId })),
    feedback: { question: 'How did it taste?', selected: ['Sour / sharp'], otherText: null },
    proposal: {
      variable: 'profile',
      lever: 'temp',
      value: 89,
      grind: null,
      summary: 'Raise brew temperature by 1 °C',
      rationale: 'Sour.',
      expectedEffect: 'Sweeter.',
      tips: [],
    },
    change: null,
    outcome: 'applied',
    createdAt: `2026-10-03T08:0${n}:30.000Z`,
    updatedAt: `2026-10-03T08:0${n}:30.000Z`,
  });

  it('lists versions and iterations compactly, oldest first', () => {
    const history = data(
      getBagHistory(
        [
          version(2, { variable: 'profile', lever: 'temp', from: 88, to: 89, diffLines: ['x'], summary: 'Raise brew temperature by 1 °C' }),
          version(1, null),
        ],
        [iteration(1, 'shot-a')],
      ),
    );
    expect(history['versions']).toEqual([
      { version: 1, title: 'Kiambu AA v1', templateId: 'd-flow', status: 'superseded', change: null },
      {
        version: 2,
        title: 'Kiambu AA v2',
        templateId: 'd-flow',
        status: 'active',
        change: { variable: 'profile', lever: 'temp', from: 88, to: 89, summary: 'Raise brew temperature by 1 °C' },
      },
    ]);
    const iterations = history['iterations'] as Array<Record<string, unknown>>;
    expect(iterations[0]).toMatchObject({
      shotId: 'shot-a',
      version: 1,
      taste: ['Sour / sharp'],
      proposal: 'profile temp -> 89',
      outcome: 'applied',
    });
    expect(iterations[0]!['shot']).toMatchObject({ durationS: expect.any(Number), channelingFlags: [] });
    expect(JSON.stringify(history).length).toBeLessThan(1500);
  });

  it('keeps only the most recent iterations', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...iteration(1, `shot-${i}`), createdAt: `2026-10-03T09:${String(i).padStart(2, '0')}:00.000Z` }));
    const iterations = data(getBagHistory([], many))['iterations'] as Array<Record<string, unknown>>;
    expect(iterations).toHaveLength(20);
    expect(iterations[19]!['shotId']).toBe('shot-29');
  });
});

describe('runQueryTool', () => {
  const ctx = { source: createShotSource([syntheticShotRecord({ id: 'shot-a' })]), versions: [], iterations: [] };

  it('runs a query tool and returns compact JSON', () => {
    const outcome = runQueryTool(TOOL.getShotSeries, { shot: 'latest', metric: 'weight', fromS: null, toS: 5 }, ctx);
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content)).toMatchObject({ metric: 'weight', unit: 'g' });
    expect(outcome.content).not.toMatch(/\n/);
  });

  it('answers invalid input and unknown tools with an error the model can read', () => {
    expect(runQueryTool(TOOL.getShotSeries, { shot: 'latest', metric: 'bogus', fromS: null, toS: null }, ctx)).toMatchObject({
      isError: true,
    });
    expect(runQueryTool(TOOL.getShotSummary, { shot: 'nope' }, ctx)).toMatchObject({ isError: true });
    expect(runQueryTool(TOOL.askUser, {}, ctx).content).toMatch(/not a query tool/);
  });
});

import { describe, expect, it } from 'vitest';

import type { ShotRecord } from '../api/types.ts';
import type { IterationRecord, ProfileVersion } from '../storage/types.ts';
import { syntheticShotRecord } from './__fixtures__/syntheticShot.ts';
import { TOOL } from './contract.ts';
import { withTds } from './extraction.ts';
import type { Dye2Setup } from '../api/pluginData.ts';
import {
  compareShots,
  createShotSource,
  getBagHistory,
  getPhaseStats,
  getRecentSetups,
  getShotSeries,
  getShotSummary,
  QUERY_TOOLS,
  runQueryTool,
  type BagIdentity,
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

  it("carries each shot's TDS and EY, and their difference when both have a reading (D166)", () => {
    const { older, newer } = twoShots();
    const read = (record: ShotRecord, tdsPct: number) => ({ record, summary: withTds(summarizeShot(record), tdsPct) });
    const result = data(compareShots(createShotSource([read(older, 9.1), read(newer, 9.6)]), 'previous', 'latest'));
    expect(result['a']).toMatchObject({ tdsPct: 9.1, eyPct: expect.any(Number) });
    expect(result['b']).toMatchObject({ tdsPct: 9.6, eyPct: expect.any(Number) });
    const delta = result['delta'] as Record<string, number | null>;
    expect(delta['tdsPct']).toBe(0.5);
    expect(delta['eyPct']).toBe(Number((((result['b'] as { eyPct: number }).eyPct - (result['a'] as { eyPct: number }).eyPct)).toFixed(2)));
    // Without a reading on one of them: no difference, and no numbers made up.
    const half = data(compareShots(createShotSource([older, read(newer, 9.6)]), 'previous', 'latest'));
    expect(half['a']).not.toHaveProperty('tdsPct');
    expect((half['delta'] as Record<string, number | null>)['tdsPct']).toBeNull();
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
      expectedEffect: 'More extraction.',
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

  it("gives a shot's TDS and EY when the barista measured it, and nothing when not (D166)", () => {
    const measured = iteration(1, 'shot-a');
    const read = { ...measured, summary: withTds(measured.summary!, 9.25) };
    const iterations = data(getBagHistory([], [read, iteration(2, 'shot-b')]))['iterations'] as Array<Record<string, unknown>>;
    expect(iterations[0]!['shot']).toMatchObject({ tdsPct: 9.25, eyPct: read.summary.eyPct });
    expect(iterations[1]!['shot']).not.toHaveProperty('tdsPct');
    expect(iterations[1]!['shot']).not.toHaveProperty('eyPct');
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

describe('getRecentSetups (6.5)', () => {
  const setup = (fields: Partial<Dye2Setup>): Dye2Setup => ({
    kind: 'recent',
    beanBatchId: null,
    beanId: null,
    coffeeName: 'Red Brick',
    coffeeRoaster: 'Square Mile',
    profileTitle: 'D-Flow / default',
    grindSetting: '4.2',
    doseG: 18,
    yieldG: 36,
    rpm: null,
    basket: null,
    capturedAt: '2026-10-08T07:12:00.000',
    ...fields,
  });
  const linked = { name: 'Red Brick', roaster: 'Square Mile', decaidBeanId: 'bean-1', decaidBatchId: 'batch-1' };
  const unlinked = { name: 'Red Brick', roaster: 'Square Mile', decaidBeanId: null, decaidBatchId: null };
  const kit = { equipment: ['WDT tool'], baskets: ['VST 18g'] };

  it('answers {"available":false} without DYE2', () => {
    expect(data(getRecentSetups(null, linked))).toEqual({ available: false });
  });

  it("keeps the setups of the bag's batch, each in the coach's words with its kind, with DYE2's kit", () => {
    const result = data(
      getRecentSetups(
        {
          setups: [
            setup({ beanBatchId: 'batch-1', basket: 'VST 18g', rpm: 1200 }),
            setup({ beanBatchId: 'batch-2', profileTitle: 'Londonium' }),
            setup({ kind: 'favourite', beanBatchId: null, profileTitle: 'Gentle and sweet', capturedAt: '2026-10-01' }),
          ],
          ...kit,
        },
        linked,
      ),
    );
    expect(result).toEqual({
      available: true,
      setups: [
        {
          kind: 'recent',
          sameBatch: true,
          profileTitle: 'D-Flow / default',
          grindSetting: '4.2',
          doseG: 18,
          yieldG: 36,
          rpm: 1200,
          basket: 'VST 18g',
          date: '2026-10-08',
        },
        // No batch on DYE2's side: the name and roaster tell, and which batch is not known.
        {
          kind: 'favourite',
          sameBatch: null,
          profileTitle: 'Gentle and sweet',
          grindSetting: '4.2',
          doseG: 18,
          yieldG: 36,
          rpm: null,
          basket: null,
          date: '2026-10-01',
        },
      ],
      equipment: ['WDT tool'],
      baskets: ['VST 18g'],
    });
  });

  it("keeps the setups of the same bean's earlier batches too, marked as another batch", () => {
    const setups = [
      setup({ beanBatchId: 'batch-1', grindSetting: '4.2' }),
      setup({ beanBatchId: 'batch-0', grindSetting: '4.6' }),
      setup({ beanBatchId: 'batch-9', grindSetting: '9', coffeeName: 'Red Brick' }),
    ];
    const result = data(getRecentSetups({ setups, ...kit }, { ...linked, beanBatchIds: ['batch-0', 'batch-1'] }));
    expect((result.setups as Array<{ grindSetting: string; sameBatch: boolean | null }>).map((s) => [s.grindSetting, s.sameBatch])).toEqual([
      ['4.2', true],
      ['4.6', false],
    ]);
  });

  it('matches by name and roaster, whatever the case, when the bag is not linked', () => {
    const setups = [
      setup({ beanBatchId: 'batch-1', coffeeName: ' RED BRICK ', coffeeRoaster: 'square mile' }),
      setup({ coffeeName: 'Red Brick', coffeeRoaster: 'Another Roaster' }),
      setup({ coffeeName: 'Ethiopia Chelchele' }),
      setup({ coffeeRoaster: null, profileTitle: 'No roaster recorded' }),
    ];
    const result = data(getRecentSetups({ setups, ...kit }, unlinked));
    expect((result.setups as Array<{ profileTitle: string }>).map((s) => s.profileTitle)).toEqual(['D-Flow / default', 'No roaster recorded']);
  });

  it('matches a recipe by its bean when the bag is linked, else by its name', () => {
    const recipe = setup({ kind: 'recipe', beanId: 'bean-1', coffeeName: 'Red Brick', coffeeRoaster: null, profileTitle: 'Morning Espresso' });
    const other = setup({ kind: 'recipe', beanId: 'bean-9', coffeeName: 'Red Brick', coffeeRoaster: null, profileTitle: 'Other bean' });
    const titles = (bag: BagIdentity) =>
      (data(getRecentSetups({ setups: [recipe, other], ...kit }, bag)).setups as Array<{ profileTitle: string }>).map((s) => s.profileTitle);
    expect(titles(linked)).toEqual(['Morning Espresso']);
    expect(titles(unlinked)).toEqual(['Morning Espresso', 'Other bean']);
  });

  it('keeps the ten most recent at most, and a date only when DYE2 recorded one', () => {
    const many = Array.from({ length: 14 }, (_, i) => setup({ beanBatchId: 'batch-1', grindSetting: String(i), capturedAt: i === 0 ? null : '2026-10-08' }));
    const setups = data(getRecentSetups({ setups: many, ...kit }, linked)).setups as Array<{ grindSetting: string; date: string | null }>;
    expect(setups).toHaveLength(10);
    expect(setups[0]).toMatchObject({ grindSetting: '0', date: null });
  });

  it('runs through runQueryTool with what the engine read, and is a query tool', () => {
    const ctx = { source: createShotSource([]), versions: [], iterations: [], dye2: { setups: [setup({ beanBatchId: 'batch-1' })], ...kit }, bag: linked };
    const outcome = runQueryTool(TOOL.getRecentSetups, {}, ctx);
    expect(outcome.isError).toBe(false);
    expect(JSON.parse(outcome.content)).toMatchObject({ available: true, setups: [{ grindSetting: '4.2' }] });
    expect(runQueryTool(TOOL.getRecentSetups, {}, { ...ctx, dye2: null }).content).toBe('{"available":false}');
    expect(QUERY_TOOLS).toContain(TOOL.getRecentSetups);
  });
});

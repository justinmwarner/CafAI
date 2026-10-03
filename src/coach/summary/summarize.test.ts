import { describe, expect, it } from 'vitest';

import type { ShotRecord } from '../../api/types.ts';
import { syntheticShotRecord } from '../__fixtures__/syntheticShot.ts';
import shot01 from '../__fixtures__/decaid-mcp/shot-01.json';
import shot07 from '../__fixtures__/decaid-mcp/shot-07.json';
import example from '../../../docs/verified/examples/shot-record.json';
import { resampleSeries, shotPhases, summarizeShot, summaryForModel } from './summarize.ts';
import { shotRows } from './analysis.ts';

const asRecord = (value: unknown) => value as ShotRecord;

describe('summarizeShot: the verified example record', () => {
  const summary = summarizeShot(asRecord(example));

  it('reports dose, yield and ratio from the annotations and the target from the workflow', () => {
    expect(summary).toMatchObject({
      shotId: '3f6b0a9e-8c1d-4e52-9b7a-2d4f61c08e17',
      timestamp: '2026-10-03T08:15:02.731455',
      profileTitle: 'Guji Hambela v1',
      durationS: 35,
      doseG: 18,
      yieldG: 36.3,
      ratio: 2.02,
      targetYieldG: 36,
      stopReason: 'targetWeight',
    });
  });

  it('times first drops and the end of preinfusion from shot start', () => {
    expect(summary.timeToFirstDropS).toBe(12.1);
    expect(summary.preinfusionEndS).toBe(12.1);
    expect(summary.peakPressureBar).toBe(8.4);
    expect(summary.peakPressureAtS).toBe(19.6);
  });

  it('averages flow and temperature over the pour', () => {
    expect(summary.meanPourFlowMlS).toBe(2.12);
    expect(summary.meanPourWeightFlowGs).toBe(1.37);
    expect(summary.meanTempC).toBe(88.6);
    expect(summary.tempDeviationC).toBe(0.4);
    expect(summary.resistanceTrend).toBeNull();
    expect(summary.channelingFlags).toEqual([]);
  });

  it('names phases after the profile steps, starting with preheat', () => {
    expect(summary.phases).toEqual([
      { name: 'preheat', startS: 0, endS: 4.6 },
      { name: 'preinfusion temp boost', startS: 4.6, endS: 9.9 },
      { name: 'preinfusion', startS: 9.9, endS: 12.1 },
      { name: 'forced rise without limit', startS: 12.1, endS: 19.6 },
      { name: 'decline', startS: 19.6, endS: 35 },
    ]);
  });

  it('leaves seconds without a nearby sample empty instead of inventing values', () => {
    expect(summary.series.tS[0]).toBe(0);
    expect(summary.series.tS[summary.series.tS.length - 1]).toBe(35);
    expect(summary.series.pressure[0]).toBe(0);
    expect(summary.series.pressure[2]).toBeNull();
    expect(summary.series.pressure[20]).toBe(8.4);
  });
});

describe('summarizeShot: real Decaid shots', () => {
  it('Blooming: phases follow the steps through the bloom', () => {
    const summary = summarizeShot(asRecord(shot07));
    expect(summary.phases.map((p) => p.name)).toEqual([
      'preheat',
      'preinfusion start',
      'preinfusion',
      'pause',
      'ramp',
      'flat flow',
      'reset temperature',
    ]);
    expect(summary.preinfusionEndS).toBe(11);
    expect(summary).toMatchObject({ doseG: 18, yieldG: 58.8, targetYieldG: 60, ratio: 3.27 });
  });

  it('Default: a steeply falling resistance is flagged', () => {
    const summary = summarizeShot(asRecord(shot01));
    expect(summary.resistanceTrend).toBe('falling');
    expect(summary.channelingFlags).toEqual(['resistance_falling']);
    expect(summary.timeToFirstDropS).toBe(13.8);
    expect(summary.preinfusionEndS).toBe(10);
  });

  it('stays compact enough to send with every shot', () => {
    const { series: _series, ...aggregates } = summarizeShot(asRecord(shot07));
    expect(JSON.stringify(aggregates).length).toBeLessThan(1200);
    expect(JSON.stringify(summarizeShot(asRecord(shot07))).length).toBeLessThan(7000);
  });
});

describe('summarizeShot: synthetic shots', () => {
  it('resamples to one point per second, by timestamp', () => {
    const summary = summarizeShot(syntheticShotRecord());
    expect(summary.series.tS.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(summary.series.tS.every((t, i) => i === 0 || t > summary.series.tS[i - 1]!)).toBe(true);
    const at20 = summary.series.tS.indexOf(20);
    expect(summary.series.pressure[at20]).toBe(9);
    expect(summary.series.flow[at20]).toBe(1.5);
    expect(summary.series.targetPressure[at20]).toBe(9);
    expect(summary.series.temperature[at20]).toBe(87.5);
    expect(summary.series.pressure.every((v) => v !== null)).toBe(true);
  });

  it('gives the same series whatever the sampling rate', () => {
    const full = syntheticShotRecord();
    const half: ShotRecord = { ...full, measurements: full.measurements.filter((_, i) => i % 2 === 0) };
    const a = summarizeShot(full).series;
    const b = summarizeShot(half).series;
    expect(b.tS.slice(0, 30)).toEqual(a.tS.slice(0, 30));
    const pressureAt = (s: typeof a, t: number) => s.pressure[s.tS.indexOf(t)];
    for (const t of [5, 15, 25]) expect(pressureAt(b, t)).toBeCloseTo(pressureAt(a, t)!, 0);
  });

  it('blanks stale targets during preheat', () => {
    const summary = summarizeShot(syntheticShotRecord());
    expect(summary.series.targetFlow[1]).toBeNull();
    expect(summary.series.targetPressure[1]).toBeNull();
    expect(summary.phases[0]).toEqual({ name: 'preheat', startS: 0, endS: expect.any(Number) });
  });

  it('does not report scale numbers without a scale', () => {
    const summary = summarizeShot(syntheticShotRecord({ noScale: true }));
    expect(summary.yieldG).toBeNull();
    expect(summary.ratio).toBeNull();
    expect(summary.timeToFirstDropS).toBeNull();
    expect(summary.meanPourWeightFlowGs).toBeNull();
    expect(summary.series.weight.every((w) => w === null)).toBe(true);
  });

  it('turns channeling indicators into named flags', () => {
    expect(summarizeShot(syntheticShotRecord({ firstDropS: 3, cupLossMlS: 0.6 })).channelingFlags).toEqual([
      'pump_scale_divergence',
      'early_first_drops',
    ]);
  });

  it('treats a stop-at-weight of 0 as off', () => {
    const record = syntheticShotRecord();
    record.workflow.context = { ...record.workflow.context, targetYield: 0 };
    expect(summarizeShot(record).targetYieldG).toBeNull();
  });
});

describe('summaryForModel', () => {
  it('drops only the series, for the [event:shot_completed] payload', () => {
    const summary = summarizeShot(syntheticShotRecord());
    const forModel = summaryForModel(summary);
    expect(forModel).not.toHaveProperty('series');
    expect({ ...forModel, series: summary.series }).toEqual(summary);
  });
});

describe('helpers', () => {
  it('resampleSeries and shotPhases work on rows', () => {
    const rows = shotRows(syntheticShotRecord({ endS: 12 }));
    const tS = resampleSeries(rows).tS;
    expect(tS.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tS[tS.length - 1]).toBeGreaterThanOrEqual(11.5);
    expect(shotPhases(rows, null).map((p) => p.name)).toEqual(['preheat', 'preinfusion', 'pouring']);
    expect(resampleSeries([]).tS).toEqual([]);
    expect(shotPhases([], null)).toEqual([]);
  });
});

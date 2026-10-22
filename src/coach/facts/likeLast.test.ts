import { describe, expect, it } from 'vitest';
import type { ShotSummary } from '../types.ts';
import { LIKE_LAST, ranLikeLast } from './likeLast.ts';

const shot = (over: Partial<ShotSummary> = {}): ShotSummary => ({
  shotId: 'shot-1',
  timestamp: '2026-10-16T08:00:00.000000',
  profileTitle: 'Kiambu AA v2',
  durationS: 28.4,
  doseG: 18,
  yieldG: 36.2,
  ratio: 2.01,
  targetYieldG: 36,
  timeToFirstDropS: 7.5,
  preinfusionEndS: 9,
  peakPressureBar: 8.6,
  peakPressureAtS: 12,
  meanPourFlowMlS: 1.9,
  meanPourWeightFlowGs: 1.7,
  meanTempC: 92.3,
  tempDeviationC: 0.4,
  resistanceTrend: 'flat',
  channelingFlags: [],
  stopReason: 'targetWeight',
  phases: [],
  series: { tS: [], pressure: [], flow: [], weight: [], weightFlow: [], temperature: [], targetPressure: [], targetFlow: [] },
  ...over,
});

const LAST = shot();

describe('ranLikeLast (D197)', () => {
  it('is the same shot again', () => {
    expect(ranLikeLast(shot({ shotId: 'shot-2' }), LAST)).toBe(true);
  });

  it('takes each number up to its tolerance either way, and not past it', () => {
    expect(LIKE_LAST).toEqual({ durationS: 3, yieldG: 1.5, peakPressureBar: 1, firstDropS: 3 });
    const cases: Array<[string, (by: number) => Partial<ShotSummary>, number]> = [
      ['durationS', (by) => ({ durationS: 28.4 + by }), 3],
      ['yieldG', (by) => ({ yieldG: 36.2 + by }), 1.5],
      ['peakPressureBar', (by) => ({ peakPressureBar: 8.6 + by }), 1],
      ['timeToFirstDropS', (by) => ({ timeToFirstDropS: 7.5 + by }), 3],
    ];
    for (const [field, moved, tolerance] of cases) {
      for (const sign of [1, -1]) {
        expect(ranLikeLast(shot(moved(sign * tolerance)), LAST), `${field} ${sign * tolerance}`).toBe(true);
        expect(ranLikeLast(shot(moved(sign * (tolerance + 0.1))), LAST), `${field} ${sign * (tolerance + 0.1)}`).toBe(false);
      }
    }
  });

  it('times the first drop from the start of the pour, as the shot card does, so a longer preheat moves nothing', () => {
    // The same pour after 1.0 s and 6.5 s of preheat: the drop 7.2 s into the pour both times.
    const shortHeat = shot({ pourStartS: 1, timeToFirstDropS: 8.2 });
    const longHeat = shot({ pourStartS: 6.5, timeToFirstDropS: 13.7 });
    expect(ranLikeLast(longHeat, shortHeat)).toBe(true);
    // 3.5 s later into the pour is another shot, whatever the preheat.
    expect(ranLikeLast(shot({ pourStartS: 6.5, timeToFirstDropS: 17.2 }), shortHeat)).toBe(false);
    // A summary from before pourStartS keeps its clock.
    expect(ranLikeLast(shot({ timeToFirstDropS: 9 }), shot({ timeToFirstDropS: 7.5 }))).toBe(true);
  });

  it('compares a number only when both shots have it', () => {
    expect(ranLikeLast(shot({ yieldG: null, peakPressureBar: null, timeToFirstDropS: null }), LAST)).toBe(true);
    expect(ranLikeLast(shot({ yieldG: 50 }), shot({ yieldG: null }))).toBe(true);
    expect(ranLikeLast(shot({ durationS: Number.NaN }), LAST)).toBe(true);
  });

  it('wants the same stop reason when both shots have one', () => {
    expect(ranLikeLast(shot({ stopReason: 'machineEnded' }), LAST)).toBe(false);
    expect(ranLikeLast(shot({ stopReason: null }), LAST)).toBe(true);
    expect(ranLikeLast(shot({ stopReason: 'machineEnded' }), shot({ stopReason: null }))).toBe(true);
  });

  it('is not like the last one with a channeling flag the earlier shot did not raise', () => {
    expect(ranLikeLast(shot({ channelingFlags: ['pressure_dip_after_peak'] }), LAST)).toBe(false);
    expect(ranLikeLast(shot({ channelingFlags: ['pressure_dip_after_peak'] }), shot({ channelingFlags: ['pressure_dip_after_peak'] }))).toBe(true);
    // One the earlier shot raised and this one did not is no new problem.
    expect(ranLikeLast(LAST, shot({ channelingFlags: ['flow_instability'] }))).toBe(true);
  });
});

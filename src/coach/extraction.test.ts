import { describe, expect, it } from 'vitest';
import {
  EY_MAX_PCT,
  extractionYield,
  formatEy,
  formatTds,
  isTds,
  readingOf,
  readTdsInput,
  roundTds,
  TDS_NOT_A_NUMBER,
  TDS_TOO_HIGH,
  TDS_TOO_LOW,
  withTds,
} from './extraction.ts';
import type { ShotSummary } from './types.ts';

const summary = (fields: Partial<ShotSummary> = {}): ShotSummary => ({
  shotId: 'shot-1',
  timestamp: '2026-10-15T08:00:00.000000',
  profileTitle: 'Kiambu AA v1',
  durationS: 30,
  doseG: 18,
  yieldG: 40.4,
  ratio: 2.24,
  targetYieldG: 40,
  timeToFirstDropS: 8,
  preinfusionEndS: 10,
  peakPressureBar: 8.4,
  peakPressureAtS: 14,
  meanPourFlowMlS: 1.7,
  meanPourWeightFlowGs: 1.6,
  meanTempC: 92,
  tempDeviationC: 0.3,
  resistanceTrend: 'flat',
  channelingFlags: [],
  stopReason: 'targetWeight',
  phases: [],
  series: { tS: [0], pressure: [0], flow: [0], weight: [0], weightFlow: [0], temperature: [92], targetPressure: [null], targetFlow: [null] },
  ...fields,
});

describe('readTdsInput: what the field makes of what was typed (D-TDS-3)', () => {
  it('reads a TDS to 0.01 %, with a point or a comma, a % or spaces around it', () => {
    expect(readTdsInput('9.25')).toEqual({ ok: true, tdsPct: 9.25 });
    expect(readTdsInput('9,25')).toEqual({ ok: true, tdsPct: 9.25 });
    expect(readTdsInput(' 9.25 % ')).toEqual({ ok: true, tdsPct: 9.25 });
    expect(readTdsInput('9.25%')).toEqual({ ok: true, tdsPct: 9.25 });
    expect(readTdsInput('9')).toEqual({ ok: true, tdsPct: 9 });
    expect(readTdsInput('9.')).toEqual({ ok: true, tdsPct: 9 });
    expect(readTdsInput(',5')).toEqual({ ok: true, tdsPct: 0.5 });
    // A refractometer reads to 0.01: a third decimal is rounded away.
    expect(readTdsInput('9.256')).toEqual({ ok: true, tdsPct: 9.26 });
  });

  it('reads nothing typed as no reading', () => {
    expect(readTdsInput('')).toEqual({ ok: true, tdsPct: null });
    expect(readTdsInput('   ')).toEqual({ ok: true, tdsPct: null });
    expect(readTdsInput(' % ')).toEqual({ ok: true, tdsPct: null });
  });

  it('says why when it is not a TDS: not a number, 0 or less, more than a refractometer reads', () => {
    for (const typed of ['abc', '9.2.5', '1e1', '9,25,1', '9 25', '0x1']) expect(readTdsInput(typed), typed).toEqual({ ok: false, message: TDS_NOT_A_NUMBER });
    for (const typed of ['0', '0.00', '0.004', '-1']) expect(readTdsInput(typed), typed).toEqual({ ok: false, message: TDS_TOO_LOW });
    expect(readTdsInput('25')).toEqual({ ok: true, tdsPct: 25 });
    for (const typed of ['25.01', '30', '92']) expect(readTdsInput(typed), typed).toEqual({ ok: false, message: TDS_TOO_HIGH });
  });
});

describe('extractionYield: TDS x yield / dose, to 0.1 % (D-TDS-2)', () => {
  it('works the EY out from the dose and the yield', () => {
    // 9.25 x 40.4 / 18 = 20.76
    expect(extractionYield(9.25, 18, 40.4)).toBe(20.8);
    expect(extractionYield(10, 20, 40)).toBe(20);
    // An Allongé: 4.5 % at 1:5.
    expect(extractionYield(4.5, 18, 90)).toBe(22.5);
  });

  it('has none without a dose or a yield', () => {
    expect(extractionYield(9.25, null, 40.4)).toBeNull();
    expect(extractionYield(9.25, 18, null)).toBeNull();
    expect(extractionYield(9.25, 0, 40)).toBeNull();
    expect(extractionYield(9.25, 18, 0)).toBeNull();
    expect(extractionYield(Number.NaN, 18, 40)).toBeNull();
  });
});

describe('withTds: a summary with a reading, or without one (D-TDS-5)', () => {
  it('adds the TDS and its EY from the summary’s own dose and yield, leaving the summary passed in as it was', () => {
    const before = summary();
    const after = withTds(before, 9.25);
    expect(after).toMatchObject({ tdsPct: 9.25, eyPct: 20.8, doseG: 18, yieldG: 40.4 });
    expect(before).not.toHaveProperty('tdsPct');
    // The EY agrees with the card's ratio: TDS x yield / dose.
    expect(after.eyPct).toBe(extractionYield(9.25, before.doseG, before.yieldG));
  });

  it('keeps a TDS without an EY when the shot has no yield or no dose', () => {
    expect(withTds(summary({ yieldG: null, ratio: null }), 9.25)).toMatchObject({ tdsPct: 9.25, eyPct: null });
    expect(withTds(summary({ doseG: null, ratio: null }), 9.25)).toMatchObject({ tdsPct: 9.25, eyPct: null });
  });

  it('replaces a reading, and takes both numbers out for null', () => {
    const read = withTds(summary(), 9.25);
    expect(withTds(read, 10.1)).toMatchObject({ tdsPct: 10.1, eyPct: 22.7 });
    const cleared = withTds(read, null);
    expect(cleared).not.toHaveProperty('tdsPct');
    expect(cleared).not.toHaveProperty('eyPct');
    // Nothing to take out: the very same summary.
    const plain = summary();
    expect(withTds(plain, null)).toBe(plain);
  });

  it('leaves the summary as it was for a TDS CafAI does not take', () => {
    const plain = summary();
    expect(withTds(plain, 0)).toBe(plain);
    expect(withTds(plain, 30)).toBe(plain);
    expect(withTds(plain, Number.NaN)).toBe(plain);
  });
});

describe('readingOf', () => {
  it('reads a summary’s reading, and nothing from one without, or with numbers CafAI cannot read', () => {
    expect(readingOf(withTds(summary(), 9.25))).toEqual({ tdsPct: 9.25, eyPct: 20.8 });
    expect(readingOf(withTds(summary({ yieldG: null }), 9.25))).toEqual({ tdsPct: 9.25, eyPct: null });
    expect(readingOf(summary())).toBeNull();
    expect(readingOf(null)).toBeNull();
    expect(readingOf({ tdsPct: '9.25' as unknown as number })).toBeNull();
    expect(readingOf({ tdsPct: 99 })).toBeNull();
    expect(readingOf({ tdsPct: 9.25, eyPct: 'high' as unknown as number })).toEqual({ tdsPct: 9.25, eyPct: null });
  });
});

describe('the numbers as shown', () => {
  it('shows a TDS to 0.01 and an EY to 0.1, with the unit after a space', () => {
    expect(formatTds(9.25)).toBe('9.25 %');
    expect(formatTds(9)).toBe('9.00 %');
    expect(formatEy(20.76)).toBe('20.8 %');
    expect(formatEy(20)).toBe('20.0 %');
  });

  it('rounds and checks a TDS as CafAI keeps it', () => {
    expect(roundTds(9.254)).toBe(9.25);
    expect(isTds(9.25)).toBe(true);
    expect(isTds(0.004)).toBe(false);
    expect(isTds(25.01)).toBe(false);
    expect(isTds('9')).toBe(false);
    expect(EY_MAX_PCT).toBe(30);
  });
});

import { describe, expect, it } from 'vitest';
import {
  confidenceLabel,
  describeChannelingFlag,
  formatBar,
  formatDate,
  formatDateTime,
  formatGrams,
  formatRatio,
  formatSeconds,
  shotRatio,
  splitDiffLine,
} from './format.ts';

describe('number formatting', () => {
  it('formats seconds, grams and bar to one decimal', () => {
    expect(formatSeconds(28.44)).toBe('28.4 s');
    expect(formatGrams(18)).toBe('18.0 g');
    expect(formatBar(8.96)).toBe('9.0 bar');
  });

  it('shows a dash for missing values', () => {
    expect(formatSeconds(null)).toBe('–');
    expect(formatGrams(null)).toBe('–');
    expect(formatBar(null)).toBe('–');
    expect(formatRatio(null)).toBe('–');
  });

  it('formats a brew ratio as 1:x', () => {
    expect(formatRatio(2)).toBe('1:2.0');
    expect(formatRatio(2.456)).toBe('1:2.5');
  });

  it('takes the ratio from the summary, or computes it from dose and yield', () => {
    expect(shotRatio({ ratio: 2.1, doseG: 18, yieldG: 36 })).toBe(2.1);
    expect(shotRatio({ ratio: null, doseG: 18, yieldG: 36 })).toBe(2);
    expect(shotRatio({ ratio: null, doseG: null, yieldG: 36 })).toBeNull();
    expect(shotRatio({ ratio: null, doseG: 0, yieldG: 36 })).toBeNull();
  });
});

describe('describeChannelingFlag', () => {
  it('puts known indicators in plain words', () => {
    expect(describeChannelingFlag('pressure_dip_after_peak')).toBe('Pressure dipped after the peak');
    expect(describeChannelingFlag('pressure_dip')).toBe('Pressure dipped after the peak');
    expect(describeChannelingFlag('flow_instability')).toBe('Flow was unsteady');
    expect(describeChannelingFlag('flow_divergence')).toBe('Pump and scale flow disagreed');
    expect(describeChannelingFlag('early_drops')).toBe('Early drips');
    expect(describeChannelingFlag('resistance_trend')).toBe('Puck resistance fell during the pour');
  });

  it('humanizes unknown flags instead of showing snake_case', () => {
    expect(describeChannelingFlag('some_new_flag')).toBe('Some new flag');
    expect(describeChannelingFlag('weirdFlagName')).toBe('Weird flag name');
  });
});

describe('confidenceLabel', () => {
  it('names each confidence level', () => {
    expect(confidenceLabel('high')).toBe('High confidence');
    expect(confidenceLabel('medium')).toBe('Medium confidence');
    expect(confidenceLabel('low')).toBe('Low confidence');
  });
});

describe('formatDateTime', () => {
  it('shows day, short month, year and 24 h local time', () => {
    const iso = '2026-10-03T08:05:00.000Z';
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const expected = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(formatDateTime(iso)).toBe(expected);
  });

  it('accepts zone-less timestamps and passes garbage through', () => {
    expect(formatDateTime('2026-10-03T08:05:00')).toMatch(/^3 Oct 2026, 08:05$/);
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});

describe('formatDate', () => {
  it('shows a calendar day as day, short month and year, the same on every clock', () => {
    expect(formatDate('2026-09-03')).toBe('3 Sep 2026');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('passes anything else through', () => {
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('splitDiffLine', () => {
  it('splits "Label: before -> after (note)" lines', () => {
    expect(splitDiffLine('Brew temperature: 92.0 °C -> 93.0 °C (all steps)')).toEqual({
      label: 'Brew temperature',
      before: '92.0 °C',
      after: '93.0 °C (all steps)',
    });
  });

  it('accepts a unicode arrow', () => {
    expect(splitDiffLine('Yield: 36 g → 38 g')).toEqual({ label: 'Yield', before: '36 g', after: '38 g' });
  });

  it('returns null when the line is not a before/after pair', () => {
    expect(splitDiffLine('Grind 1 step finer')).toBeNull();
    expect(splitDiffLine('Note: keep the dose')).toBeNull();
  });
});

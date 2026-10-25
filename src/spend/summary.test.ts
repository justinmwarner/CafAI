import { describe, expect, it } from 'vitest';
import { summarize } from './summary.ts';
import { makeRecord } from './testing/fixtures.ts';

const NOW = new Date(2026, 9, 24, 15, 0);
const ZERO = { costMicros: 0, tokens: 0, requests: 0, replies: 0, webSearches: 0 };

describe('summarize (D237, D239)', () => {
  it('says nothing yet of a device that counted nothing', () => {
    const empty = { today: ZERO, month: { ...ZERO, days: [], byKind: { reply: 0, shot: 0, photo: 0, web: 0 } }, lastMonth: ZERO, allTime: ZERO };
    expect(summarize([], NOW)).toEqual({ month: '2026-10', anthropic: empty, computer: empty, unpricedModels: [] });
  });

  it('adds today, this month, last month and all time, every token sent and received counted', () => {
    const summary = summarize(
      [
        makeRecord(),
        makeRecord({ device: 'other999', requests: 2, replies: 1 }),
        makeRecord({ day: '2026-10-02', webSearches: 0, webSearchMicros: 0, costMicros: 7900 }),
        makeRecord({ day: '2026-09-30' }),
        makeRecord({ day: '2026-08-15' }),
      ],
      NOW,
    );
    // 900 + 40 + 4,000 + 300 tokens a record.
    expect(summary.anthropic.today).toEqual({ costMicros: 35800, tokens: 10480, requests: 3, replies: 2, webSearches: 2 });
    expect(summary.anthropic.month).toMatchObject({ costMicros: 43700, tokens: 15720, requests: 4, replies: 3, webSearches: 2 });
    expect(summary.anthropic.lastMonth).toEqual({ costMicros: 17900, tokens: 5240, requests: 1, replies: 1, webSearches: 1 });
    expect(summary.anthropic.allTime).toEqual({ costMicros: 79500, tokens: 26200, requests: 6, replies: 5, webSearches: 4 });
  });

  it("keeps the computer's apart: the API price of the same tokens, never in the key's dollars", () => {
    const summary = summarize([makeRecord(), makeRecord({ source: 'computer', costMicros: 50_000 })], NOW);
    expect(summary.anthropic.month.costMicros).toBe(17900);
    expect(summary.computer.month.costMicros).toBe(50_000);
    expect(summary.computer.today.requests).toBe(1);
  });

  it('lists each day of the month that has records, oldest first, and what the month went on, web searches apart', () => {
    const summary = summarize(
      [
        makeRecord({ day: '2026-10-24', kind: 'shot', costMicros: 30_000, webSearchMicros: 10_000 }),
        makeRecord({ day: '2026-10-03', kind: 'photo', costMicros: 5000, webSearchMicros: 0 }),
        makeRecord({ day: '2026-10-24', kind: 'reply', costMicros: 12_000, webSearchMicros: 0 }),
        makeRecord({ day: '2026-09-29', kind: 'reply', costMicros: 99_000 }),
      ],
      NOW,
    );
    expect(summary.anthropic.month.days).toEqual([
      { day: '2026-10-03', costMicros: 5000, tokens: 5240 },
      { day: '2026-10-24', costMicros: 42_000, tokens: 10480 },
    ]);
    expect(summary.anthropic.month.byKind).toEqual({ reply: 12_000, shot: 20_000, photo: 5000, web: 10_000 });
  });

  it("reads the month on the device's calendar: a reply at 23:50 on the 31st is last month's by 00:10 on the 1st", () => {
    const records = [makeRecord({ day: '2026-10-31' }), makeRecord({ day: '2026-11-01', costMicros: 1000 })];
    const summary = summarize(records, new Date(2026, 10, 1, 0, 10));
    expect(summary.month).toBe('2026-11');
    expect(summary.anthropic.month.costMicros).toBe(1000);
    expect(summary.anthropic.lastMonth.costMicros).toBe(17900);
    expect(summarize(records, new Date(2027, 0, 5)).anthropic.lastMonth.costMicros).toBe(0);
    expect(summarize([makeRecord({ day: '2026-12-31' })], new Date(2027, 0, 5)).anthropic.lastMonth.costMicros).toBe(17900);
  });

  it('names the models counted this month whose price is not known, once each', () => {
    const summary = summarize(
      [
        makeRecord({ model: 'claude-future-9', unpriced: 2 }),
        makeRecord({ model: 'claude-future-9', kind: 'shot', unpriced: 1 }),
        makeRecord({ model: 'my-own-model', source: 'computer', unpriced: 1 }),
        makeRecord({ model: 'claude-old-1', day: '2026-09-01', unpriced: 1 }),
      ],
      NOW,
    );
    expect(summary.unpricedModels).toEqual(['claude-future-9', 'my-own-model']);
  });
});

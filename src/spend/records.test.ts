import { describe, expect, it } from 'vitest';
import {
  addRecords,
  countRecord,
  dayOf,
  mergeRecords,
  monthOf,
  nextMonthStart,
  previousMonth,
  readRecord,
  recordKey,
} from './records.ts';
import { makeRecord } from './testing/fixtures.ts';
import type { SpendCount } from './types.ts';

const COUNT: SpendCount = {
  at: new Date(2026, 9, 24, 9, 30),
  source: 'anthropic',
  model: 'claude-opus-5-5',
  kind: 'reply',
  call: 0,
  usage: { inputTokens: 900, outputTokens: 40, cacheReadInputTokens: 4000, cacheCreationInputTokens: 300, webSearchRequests: 1 },
};

describe('days and months on the device (D238)', () => {
  it("reads the day and the month on this device's calendar, not UTC's", () => {
    expect(dayOf(new Date(2026, 9, 1, 0, 5))).toBe('2026-10-01');
    expect(dayOf(new Date(2026, 9, 31, 23, 55))).toBe('2026-10-31');
    expect(monthOf(new Date(2026, 9, 31, 23, 55))).toBe('2026-10');
    expect(monthOf(new Date(2026, 10, 1, 0, 0))).toBe('2026-11');
  });

  it('knows the month before and the first day of the month after, over a year too', () => {
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(nextMonthStart(new Date(2026, 9, 24))).toBe('2026-11-01');
    expect(nextMonthStart(new Date(2026, 11, 31, 23, 59))).toBe('2027-01-01');
  });
});

describe('records (D238)', () => {
  it('keys a record by day, device, source, model and kind', () => {
    expect(recordKey(makeRecord())).toBe('2026-10-24|dev12345|anthropic|claude-opus-5-5|reply');
  });

  it("makes one request a record of its own: a reply's first call is a reply, a later call or a bag photo's read is not", () => {
    const cost = { costMicros: 17900, webSearchMicros: 10000, priced: true };
    expect(countRecord(COUNT, 'dev12345', cost)).toEqual(makeRecord());
    expect(countRecord({ ...COUNT, call: 3 }, 'dev12345', cost)).toEqual(makeRecord({ replies: 0 }));
    expect(countRecord({ ...COUNT, kind: 'shot' }, 'dev12345', cost)).toEqual(makeRecord({ kind: 'shot' }));
    expect(countRecord({ ...COUNT, kind: 'photo' }, 'dev12345', cost)).toEqual(makeRecord({ kind: 'photo', replies: 0 }));
    expect(countRecord({ ...COUNT, usage: { inputTokens: 5, outputTokens: 6 } }, 'dev12345', { costMicros: 0, webSearchMicros: 0, priced: false })).toEqual(
      makeRecord({ inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, costMicros: 0, webSearchMicros: 0, unpriced: 1 }),
    );
  });

  it("adds a request to the day's record, field by field", () => {
    expect(addRecords(undefined, makeRecord())).toEqual(makeRecord());
    expect(addRecords(makeRecord(), makeRecord({ replies: 0, unpriced: 1 }))).toEqual(
      makeRecord({
        requests: 2,
        replies: 1,
        inputTokens: 1800,
        outputTokens: 80,
        cacheReadTokens: 8000,
        cacheWriteTokens: 600,
        webSearches: 2,
        costMicros: 35800,
        webSearchMicros: 20000,
        unpriced: 1,
      }),
    );
  });

  it('merges per key, the record with more requests winning, and says whether anything changed', () => {
    const mine = makeRecord({ requests: 3 });
    const other = makeRecord({ device: 'other999', requests: 1 });
    expect(mergeRecords([mine], [makeRecord({ requests: 2 })])).toEqual({ records: [mine], changed: false });
    expect(mergeRecords([mine], [makeRecord({ requests: 3, costMicros: 1 })])).toEqual({ records: [mine], changed: false });
    const grown = makeRecord({ requests: 5 });
    expect(mergeRecords([mine, other], [grown])).toEqual({ records: [grown, other], changed: true });
    expect(mergeRecords([mine], [other])).toEqual({ records: [mine, other], changed: true });
  });

  it('reads a stored or copied record, and nothing that is not one', () => {
    expect(readRecord(makeRecord())).toEqual(makeRecord());
    expect(readRecord({ ...makeRecord(), extra: 'kept out' })).toEqual(makeRecord());
    for (const broken of [
      null,
      'record',
      { ...makeRecord(), day: '24/10/2026' },
      { ...makeRecord(), source: 'openai' },
      { ...makeRecord(), kind: 'chat' },
      { ...makeRecord(), model: '' },
      { ...makeRecord(), device: '' },
      { ...makeRecord(), requests: -1 },
      { ...makeRecord(), costMicros: Number.NaN },
      { ...makeRecord(), inputTokens: '900' },
    ]) {
      expect(readRecord(broken), JSON.stringify(broken)).toBeNull();
    }
  });
});

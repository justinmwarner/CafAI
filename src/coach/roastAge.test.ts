import { describe, expect, it } from 'vitest';
import { freezerDays, localDay, roastAgeDays, todayOf, writtenDate } from './roastAge.ts';

/** 10 Oct 2026, mid-morning on this machine's own clock. */
const TODAY = new Date(2026, 9, 10, 9, 30);

/** Run `check` with this device's clock in `zone`, as a tablet set to that city would be. */
function inZone(zone: string, check: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    check();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('writtenDate', () => {
  it('reads a plain date as it is written', () => {
    expect(writtenDate('2026-10-01')).toBe('2026-10-01');
    expect(writtenDate(' 2026-10-01 ')).toBe('2026-10-01');
  });

  it('takes the day a batch date is written with, whatever its zone, in New York and in Tokyo', () => {
    for (const zone of ['America/New_York', 'Asia/Tokyo']) {
      inZone(zone, () => {
        // Decaid's own, local and without a zone.
        expect(writtenDate('2026-09-10T00:00:00.000'), zone).toBe('2026-09-10');
        expect(writtenDate('2026-09-10T23:59:59.999999'), zone).toBe('2026-09-10');
        // Echoed in UTC, and DYE2's toISOString(): still the 10th, not the 9th in New York or the 11th in Tokyo.
        expect(writtenDate('2026-09-10T00:00:00.000Z'), zone).toBe('2026-09-10');
        expect(writtenDate('2026-09-10T23:30:00.000Z'), zone).toBe('2026-09-10');
        expect(writtenDate('2026-09-10T00:00:00+09:00'), zone).toBe('2026-09-10');
      });
    }
  });

  it('refuses anything that is not a real date', () => {
    for (const value of ['', 'soon', '2026-02-30', '2026-13-01', '10/01/2026', '2026-10-01Tnoon', null, undefined, 20261001]) {
      expect(writtenDate(value), String(value)).toBeNull();
    }
  });
});

describe('localDay', () => {
  it('moves an instant to the day it was on this device: New York is behind UTC, Tokyo ahead', () => {
    inZone('America/New_York', () => {
      expect(localDay('2026-09-10T02:00:00.000Z')).toBe('2026-09-09');
      expect(localDay('2026-09-10T20:00:00.000Z')).toBe('2026-09-10');
    });
    inZone('Asia/Tokyo', () => {
      expect(localDay('2026-09-10T02:00:00.000Z')).toBe('2026-09-10');
      expect(localDay('2026-09-10T20:00:00.000Z')).toBe('2026-09-11');
    });
  });

  it('keeps a moment written without a zone, or a plain date, on its own day', () => {
    inZone('Asia/Tokyo', () => {
      expect(localDay('2026-10-08T07:12:00.000')).toBe('2026-10-08');
      expect(localDay('2026-10-08')).toBe('2026-10-08');
    });
    expect(localDay('not a moment')).toBeNull();
    expect(localDay(null)).toBeNull();
  });
});

describe('roastAgeDays', () => {
  it('counts calendar days from the roast to today', () => {
    expect(roastAgeDays('2026-10-01', TODAY)).toBe(9);
    expect(roastAgeDays('2026-10-10', TODAY)).toBe(0);
    expect(roastAgeDays('2025-10-10', TODAY)).toBe(365);
  });

  it("counts from the written roast date in every zone, to that zone's today", () => {
    for (const zone of ['America/New_York', 'Asia/Tokyo']) {
      inZone(zone, () => {
        const today = new Date(2026, 9, 10, 9, 30);
        expect(roastAgeDays('2026-10-01T00:00:00.000Z', today), zone).toBe(9);
        expect(freezerDays('2026-09-10T00:00:00.000Z', today, { freezeDate: '2026-09-11T00:00:00.000Z', unfreezeDate: '2026-09-23T00:00:00.000Z' }), zone).toBe(12);
      });
    }
  });

  it('leaves out the days the batch spent between freezing and thawing', () => {
    const batch = { freezeDate: '2026-09-11T00:00:00.000', unfreezeDate: '2026-09-23T00:00:00.000' };
    expect(roastAgeDays('2026-09-10', TODAY, batch)).toBe(30 - 12);
    expect(freezerDays('2026-09-10', TODAY, batch)).toBe(12);
  });

  it('counts a batch not yet thawed as frozen until today', () => {
    const batch = { freezeDate: '2026-09-11', unfreezeDate: null };
    expect(freezerDays('2026-09-10', TODAY, batch)).toBe(29);
    expect(roastAgeDays('2026-09-10', TODAY, batch)).toBe(1);
  });

  it('never counts freezer days before the roast or after today', () => {
    expect(freezerDays('2026-09-10', TODAY, { freezeDate: '2026-09-01', unfreezeDate: '2026-09-15' })).toBe(5);
    expect(freezerDays('2026-09-10', TODAY, { freezeDate: '2026-10-05', unfreezeDate: '2026-10-20' })).toBe(5);
    expect(freezerDays('2026-09-10', TODAY, { freezeDate: '2026-10-12', unfreezeDate: null })).toBe(0);
  });

  it('ignores freezer dates that make no sense, or none', () => {
    expect(freezerDays('2026-09-10', TODAY, { freezeDate: '2026-09-20', unfreezeDate: '2026-09-15' })).toBe(0);
    expect(freezerDays('2026-09-10', TODAY, { freezeDate: 'last week', unfreezeDate: null })).toBe(0);
    expect(freezerDays('2026-09-10', TODAY, null)).toBe(0);
    expect(freezerDays('2026-09-10', TODAY)).toBe(0);
    expect(roastAgeDays('2026-09-10', TODAY, {})).toBe(30);
  });

  it('has no age for an unknown date or one after today', () => {
    expect(roastAgeDays(null, TODAY)).toBeNull();
    expect(roastAgeDays(undefined, TODAY)).toBeNull();
    expect(roastAgeDays('fresh', TODAY)).toBeNull();
    expect(roastAgeDays('2026-10-11', TODAY)).toBeNull();
    expect(freezerDays(null, TODAY, { freezeDate: '2026-09-11', unfreezeDate: null })).toBe(0);
  });
});

describe('todayOf', () => {
  it("is today's date on this device's calendar", () => {
    expect(todayOf(TODAY)).toBe('2026-10-10');
    inZone('Asia/Tokyo', () => expect(todayOf(new Date(Date.UTC(2026, 9, 9, 20, 0)))).toBe('2026-10-10'));
    inZone('America/New_York', () => expect(todayOf(new Date(Date.UTC(2026, 9, 10, 2, 0)))).toBe('2026-10-09'));
  });
});

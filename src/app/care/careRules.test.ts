import { describe, expect, it } from 'vitest';
import { DEFAULT_CARE } from '../../storage/settings.ts';
import type { CareRecord, CareSettings } from '../../storage/types.ts';
import { ROUTINES } from '../../ui/care/careGuide.ts';
import {
  allStatuses,
  countSince,
  DAY_MS,
  descaleReminder,
  isTrackedStep,
  mostOverdue,
  rebaseline,
  reminderFor,
  stepStatus,
  TRACKED_STEPS,
  UNKNOWN_TOTALS,
  type NewestRecord,
  type Totals,
} from './careRules.ts';

const FROM = Date.parse('2026-10-01T08:00:00.000Z');
const days = (n: number) => FROM + n * DAY_MS;

/** Decaid's newest shot and steam when the step's count began, in Decaid's own words: local, no zone. */
const DECAID_THEN = '2026-10-01T07:30:00.000000';

function record(overrides: Partial<CareRecord> = {}): CareRecord {
  return {
    id: 'detergent-clean',
    doneAt: '2026-10-01T08:00:00.000Z',
    by: 'tick',
    countFrom: '2026-10-01T08:00:00.000Z',
    shotTotal: 100,
    steamTotal: 30,
    newestShotAt: DECAID_THEN,
    newestSteamAt: DECAID_THEN,
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

/** Decaid's newest record, begun at `at` by its clock. */
const newest = (at: string, id = `record-${at}`): NewestRecord => ({ id, at });

const totals = (overrides: Partial<Totals> = {}): Totals => ({ shots: 100, steams: 30, newestShot: newest(DECAID_THEN), newestSteam: newest(DECAID_THEN), ...overrides });
const settings = (overrides: Partial<CareSettings> = {}): CareSettings => ({ ...DEFAULT_CARE, ...overrides });

describe('the tracked steps (D183)', () => {
  it('are every step beyond Daily, in the guide’s order, and nothing of Daily', () => {
    const beyondDaily = ROUTINES.filter((routine) => routine.id !== 'daily').flatMap((routine) => routine.steps.map((step) => step.id));
    expect([...TRACKED_STEPS]).toEqual(beyondDaily);
    for (const step of ROUTINES.find((routine) => routine.id === 'daily')!.steps) expect(isTrackedStep(step.id)).toBe(false);
  });

  it('five have a reminder; the tank, the gasket, the steam tip and the transport keep a last time only', () => {
    const withReminder = TRACKED_STEPS.filter((step) => reminderFor(step, DEFAULT_CARE) !== null);
    expect(withReminder).toEqual(['detergent-clean', 'rinza', 'intake-filter', 'group-parts', 'descale']);
  });
});

describe('the reminders (D184)', () => {
  it('the weekly clean and Rinza after a week, once a shot or a steam since; the parts after four weeks, once a shot', () => {
    expect(reminderFor('detergent-clean', DEFAULT_CARE)).toEqual({ days: 7, needs: 'shot', counts: 'shots' });
    expect(reminderFor('rinza', DEFAULT_CARE)).toEqual({ days: 7, needs: 'steam', counts: 'steams' });
    expect(reminderFor('group-parts', DEFAULT_CARE)).toEqual({ days: 28, needs: 'shot', counts: 'time' });
  });

  it('the intake filter by the filter: V1 or not said every two weeks, V2 every month', () => {
    expect(reminderFor('intake-filter', settings({ filter: 'v1' }))?.days).toBe(14);
    expect(reminderFor('intake-filter', settings({ filter: null }))?.days).toBe(14);
    expect(reminderFor('intake-filter', settings({ filter: 'v2' }))?.days).toBe(30);
  });

  it('the descale by Decent’s water page: never under 30 ppm; a year or 1,500 shots, or not said; six months or 800 shots over 120', () => {
    expect(descaleReminder('under30')).toBeNull();
    expect(descaleReminder('to120')).toEqual({ days: 365, shots: 1500, counts: 'time' });
    expect(descaleReminder(null)).toEqual(descaleReminder('to120'));
    expect(descaleReminder('over120')).toEqual({ days: 182, shots: 800, counts: 'time' });
    expect(reminderFor('descale', settings({ water: 'under30' }))).toBeNull();
  });
});

describe('counting (D185)', () => {
  it('is the total now less the one at the start, never below 0, and unknown while either is', () => {
    expect(countSince(100, 141)).toBe(41);
    expect(countSince(100, 90)).toBe(0);
    expect(countSince(null, 141)).toBeNull();
    expect(countSince(100, null)).toBeNull();
  });

  it("fills a baseline Decaid did not give, with Decaid's newest then, and leaves a good one alone", () => {
    const unknown = record({ shotTotal: null, steamTotal: null, newestShotAt: null, newestSteamAt: null });
    expect(rebaseline(unknown, totals({ shots: 141, steams: 33, newestShot: newest('2026-10-02T09:00:00.000000'), newestSteam: null }))).toEqual({
      shotTotal: 141,
      steamTotal: 33,
      newestShotAt: '2026-10-02T09:00:00.000000',
      newestSteamAt: null,
    });
    expect(rebaseline(record(), totals({ shots: 141, newestShot: newest('2026-10-03T10:00:00.000000') }))).toBeNull();
    expect(rebaseline(record(), UNKNOWN_TOTALS)).toBeNull();
  });

  it('starts the count again from now when the total fell (shots deleted, another Decaid)', () => {
    const now = newest('2026-10-05T11:00:00.000000');
    expect(rebaseline(record(), totals({ shots: 60, newestShot: now }))).toEqual({ shotTotal: 60, steamTotal: 30, newestShotAt: now.at, newestSteamAt: DECAID_THEN });
    expect(rebaseline(record(), totals({ steams: 2, newestSteam: now }))).toEqual({ shotTotal: 100, steamTotal: 2, newestShotAt: DECAID_THEN, newestSteamAt: now.at });
  });

  it("and when records were added but none began after Decaid's newest then: old ones imported", () => {
    // De1app's history brought in, nothing pulled since: Decaid's newest is still the one it had.
    expect(rebaseline(record(), totals({ shots: 400 }))).toEqual({ shotTotal: 400, steamTotal: 30, newestShotAt: DECAID_THEN, newestSteamAt: DECAID_THEN });
    expect(rebaseline(record(), totals({ shots: 400, newestShot: newest('2026-09-01T07:00:00.000000') }))).toMatchObject({ shotTotal: 400 });
    expect(rebaseline(record(), totals({ shots: 400, newestShot: newest('2026-10-01T07:31:00.000000') }))).toBeNull();
    // A record that does not know Decaid's newest then cannot tell, and keeps its count.
    expect(rebaseline(record({ newestShotAt: null }), totals({ shots: 400 }))).toBeNull();
  });

  it("compares Decaid's times only with Decaid's: a phone's clock or zone, or a tablet's date far off, changes nothing", () => {
    // CafAI marked the step at 08:00 by its clock; Decaid's clock says 07:50 then (ten minutes behind).
    const behind = record({ newestShotAt: '2026-10-01T07:50:00.000000' });
    expect(rebaseline(behind, totals({ shots: 101, newestShot: newest('2026-10-01T07:55:00.000000') }))).toBeNull();
    // A tablet a year behind: a week of shots by its date still counts, and the weekly clean comes due.
    const yearBehind = record({ newestShotAt: '2025-10-01T07:30:00.000000' });
    let current = yearBehind;
    for (let day = 1; day <= 8; day += 1) {
      const change = rebaseline(current, totals({ shots: 100 + day * 10, newestShot: newest(`2025-10-0${day + 1}T08:00:00.000000`) }));
      if (change) current = { ...current, ...change };
    }
    expect(current.shotTotal).toBe(100);
    expect(stepStatus('detergent-clean', current, DEFAULT_CARE, totals({ shots: 180 }), days(8))).toMatchObject({ shots: 80, used: true, due: true });
  });

  it('moves a baseline up by the old shots imported among new ones, only one from before the reading that found them', () => {
    const later = newest('2026-10-04T08:00:00.000000');
    // 50 pulled since, then 2,000 of de1app's imported with one more pulled: 51 since, not 2,051.
    const moved = rebaseline(record(), totals({ shots: 2151, newestShot: later }), { count: 2000, upTo: 150 });
    expect(moved).toEqual({ shotTotal: 2100, steamTotal: 30, newestShotAt: DECAID_THEN, newestSteamAt: DECAID_THEN });
    expect(countSince(moved!.shotTotal, 2151)).toBe(51);
    // A baseline taken after the reading before already holds them.
    expect(rebaseline(record({ shotTotal: 2150 }), totals({ shots: 2151, newestShot: later }), { count: 2000, upTo: 150 })).toBeNull();
    // Never past the total.
    expect(rebaseline(record(), totals({ shots: 2151, newestShot: later }), { count: 5000, upTo: 150 })).toMatchObject({ shotTotal: 2151 });
    // The steams never move: Decaid's de1app import brings shots only.
    expect(rebaseline(record(), totals({ shots: 2151, newestShot: later, steams: 40, newestSteam: later }), { count: 2000, upTo: 150 })).toMatchObject({ steamTotal: 30 });
  });
});

describe('a step’s status', () => {
  it('the weekly clean: due once a week has passed with a shot since, as many shots as were pulled', () => {
    const early = stepStatus('detergent-clean', record(), DEFAULT_CARE, totals({ shots: 141 }), days(5));
    expect(early).toMatchObject({ due: false, shots: 41, used: true, dueAtMs: days(7) });
    expect(early.share).toBeCloseTo(5 / 7);
    const late = stepStatus('detergent-clean', record(), DEFAULT_CARE, totals({ shots: 141 }), days(9));
    expect(late).toMatchObject({ due: true, shots: 41 });
    expect(late.share).toBeCloseTo(9 / 7);
  });

  it('a week without a shot needs no detergent: not due, however long', () => {
    expect(stepStatus('detergent-clean', record(), DEFAULT_CARE, totals(), days(40))).toMatchObject({ due: false, used: false, shots: 0 });
  });

  it('counts unknown to CafAI let the days decide', () => {
    expect(stepStatus('detergent-clean', record(), DEFAULT_CARE, UNKNOWN_TOTALS, days(8))).toMatchObject({ due: true, used: true, shots: null });
    expect(stepStatus('rinza', record({ id: 'rinza', steamTotal: null }), DEFAULT_CARE, totals(), days(8))).toMatchObject({ due: true, steams: null });
  });

  it('Rinza goes by the steams, the parts by the shots, the filter by the days alone', () => {
    expect(stepStatus('rinza', record({ id: 'rinza' }), DEFAULT_CARE, totals({ steams: 30 }), days(10)).due).toBe(false);
    expect(stepStatus('rinza', record({ id: 'rinza' }), DEFAULT_CARE, totals({ steams: 42 }), days(10))).toMatchObject({ due: true, steams: 12 });
    expect(stepStatus('group-parts', record({ id: 'group-parts' }), DEFAULT_CARE, totals({ shots: 101 }), days(29)).due).toBe(true);
    expect(stepStatus('intake-filter', record({ id: 'intake-filter' }), DEFAULT_CARE, totals(), days(15)).due).toBe(true);
    expect(stepStatus('intake-filter', record({ id: 'intake-filter' }), settings({ filter: 'v2' }), totals(), days(15)).due).toBe(false);
  });

  it('the descale comes due by the shots before the days', () => {
    const many = stepStatus('descale', record({ id: 'descale' }), settings({ water: 'over120' }), totals({ shots: 900 }), days(60));
    expect(many).toMatchObject({ due: true, shots: 800 });
    expect(many.share).toBeCloseTo(1);
    expect(stepStatus('descale', record({ id: 'descale' }), settings({ water: 'under30' }), totals({ shots: 5000 }), days(900))).toMatchObject({
      due: false,
      share: null,
      reminder: null,
    });
  });

  it('a step never counted has no status of its days yet; one without a reminder is never due', () => {
    expect(stepStatus('descale', null, DEFAULT_CARE, totals(), days(900))).toMatchObject({ due: false, days: null, share: null, dueAtMs: null });
    expect(stepStatus('tank-tray', record({ id: 'tank-tray' }), DEFAULT_CARE, totals(), days(90))).toMatchObject({ due: false, share: null });
  });
});

describe('the most overdue (D188)', () => {
  it('is the due step with the most of its interval past; ties go in the guide’s order; none when nothing is due', () => {
    const records = new Map<string, CareRecord>([
      ['detergent-clean', record()],
      ['rinza', record({ id: 'rinza' })],
      ['intake-filter', record({ id: 'intake-filter' })],
      ['descale', record({ id: 'descale' })],
    ]);
    const used = totals({ shots: 141, steams: 41 });
    expect(mostOverdue(allStatuses(records, DEFAULT_CARE, used, days(3)))).toBeNull();
    expect(mostOverdue(allStatuses(records, DEFAULT_CARE, used, days(9)))?.step).toBe('detergent-clean');
    // Day 30: the weekly two at 30/7 each, the filter at 30/14: the clean comes first in the guide.
    expect(mostOverdue(allStatuses(records, DEFAULT_CARE, used, days(30)))?.step).toBe('detergent-clean');
    const noShots = totals({ shots: 100, steams: 41 });
    expect(mostOverdue(allStatuses(records, DEFAULT_CARE, noShots, days(30)))?.step).toBe('rinza');
  });
});

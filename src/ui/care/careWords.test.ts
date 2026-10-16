import { describe, expect, it } from 'vitest';
import { DAY_MS, stepStatus, type Totals } from '../../app/care/careRules.ts';
import { DEFAULT_CARE } from '../../storage/settings.ts';
import type { CareRecord } from '../../storage/types.ts';
import { ago, dueLine, filterLine, grouped, plural, shortDate, stepLine, timeSpan, waterLine } from './careWords.ts';

// Local times, as the screens show them.
const FROM = new Date(2026, 9, 1, 8, 0).getTime();
const day = (n: number) => FROM + n * DAY_MS;

function record(overrides: Partial<CareRecord> = {}): CareRecord {
  const at = new Date(FROM).toISOString();
  return { id: 'detergent-clean', doneAt: at, by: 'tick', countFrom: at, shotTotal: 100, steamTotal: 30, updatedAt: at, ...overrides };
}

const totals = (overrides: Partial<Totals> = {}): Totals => ({ shots: 100, steams: 30, newestShotMs: null, newestSteamMs: null, ...overrides });
const NEVER = { doneAt: null, by: null } as const;

describe('numbers and time', () => {
  it('counts in plain figures, a comma every three digits', () => {
    expect(grouped(1520)).toBe('1,520');
    expect(grouped(1234567)).toBe('1,234,567');
    expect(plural(1, 'shot')).toBe('1 shot');
    expect(plural(0, 'steam')).toBe('0 steams');
    expect(plural(1520, 'shot')).toBe('1,520 shots');
  });

  it('says a stretch of time in days, then weeks, months and years', () => {
    expect(timeSpan(1)).toBe('1 day');
    expect(timeSpan(9.7)).toBe('9 days');
    expect(timeSpan(14)).toBe('2 weeks');
    expect(timeSpan(40)).toBe('5 weeks');
    expect(timeSpan(400)).toBe('13 months');
    expect(timeSpan(800)).toBe('2 years');
  });

  it('dates and how long ago, by the calendar', () => {
    expect(shortDate(FROM, day(10))).toBe('1 Oct');
    expect(shortDate(FROM, new Date(2027, 1, 1).getTime())).toBe('1 Oct 2026');
    expect(ago(FROM, FROM + 3_600_000)).toBe('today');
    expect(ago(FROM, day(1))).toBe('yesterday');
    expect(ago(FROM, day(9))).toBe('9 days ago');
    expect(ago(FROM, day(21))).toBe('3 weeks ago');
  });
});

describe("the stats card's line (D188)", () => {
  it('names the step and what it counts, since the last time', () => {
    expect(dueLine(stepStatus('detergent-clean', record(), DEFAULT_CARE, totals({ shots: 141 }), day(9)), day(9))).toBe(
      'Weekly clean due: 41 shots since the last',
    );
    expect(dueLine(stepStatus('rinza', record({ id: 'rinza' }), DEFAULT_CARE, totals({ steams: 42 }), day(8)), day(8))).toBe(
      'Rinza due: 12 steams since the last',
    );
    expect(dueLine(stepStatus('intake-filter', record({ id: 'intake-filter' }), DEFAULT_CARE, totals(), day(16)), day(16))).toBe(
      'Intake filter due: 2 weeks since the last',
    );
    expect(dueLine(stepStatus('group-parts', record({ id: 'group-parts' }), DEFAULT_CARE, totals({ shots: 101 }), day(36)), day(36))).toBe(
      'Group head soak due: 5 weeks since the last',
    );
  });

  it('the descale by whichever came first, the time or the shots', () => {
    const descale = record({ id: 'descale' });
    expect(dueLine(stepStatus('descale', descale, DEFAULT_CARE, totals({ shots: 400 }), day(400)), day(400))).toBe('Descale due: 13 months since the last');
    const hard = { ...DEFAULT_CARE, water: 'over120' as const };
    expect(dueLine(stepStatus('descale', descale, hard, totals({ shots: 1000 }), day(90)), day(90))).toBe('Descale due: 900 shots since the last');
  });

  it('a step never marked done counts from the day CafAI began', () => {
    expect(dueLine(stepStatus('detergent-clean', record(NEVER), DEFAULT_CARE, totals({ shots: 141 }), day(9)), day(9))).toBe(
      'Weekly clean due: 41 shots since 1 Oct',
    );
  });
});

describe("a step's last time on the Care screen", () => {
  const line = (rec: CareRecord, now: number, t: Partial<Totals> = {}) => stepLine(stepStatus(rec.id as 'detergent-clean', rec, DEFAULT_CARE, totals(t), now), now);

  it('due: said first, with the shots since', () => {
    expect(line(record(), day(9), { shots: 141 })).toEqual({ due: true, last: 'Last done 9 days ago', doneToday: false, details: ['41 shots since'] });
  });

  it('not yet due: when it will be', () => {
    expect(line(record(), day(2), { shots: 103 })).toEqual({ due: false, last: 'Last done 2 days ago', doneToday: false, details: ['3 shots since', 'due in 5 days'] });
  });

  it('no shots since: why it is not due', () => {
    expect(line(record(), day(30))).toEqual({ due: false, last: 'Last done 4 weeks ago', doneToday: false, details: ['no shots since'] });
  });

  it('done today: in so many words, and what the machine ran when CafAI saw it', () => {
    expect(line(record({ doneAt: new Date(day(3)).toISOString(), countFrom: new Date(day(3)).toISOString() }), day(3) + 60_000)).toMatchObject({
      last: 'Done today',
      doneToday: true,
      details: [],
    });
    const seen = record({ by: 'seen', doneAt: new Date(day(3)).toISOString(), countFrom: new Date(day(3)).toISOString() });
    expect(line(seen, day(5)).details[0]).toBe("CafAI saw the machine's Clean");
  });

  it('never marked done: since when CafAI counts it, with the count where there is one', () => {
    expect(line(record(NEVER), day(2), { shots: 103 })).toMatchObject({ last: 'Not marked done yet', details: ['3 shots since 1 Oct', 'due in 5 days'] });
    expect(line(record(NEVER), day(2))).toMatchObject({ last: 'Not marked done yet', details: ['no shots since 1 Oct'] });
    const filter = record({ ...NEVER, id: 'intake-filter' });
    expect(stepLine(stepStatus('intake-filter', filter, DEFAULT_CARE, totals(), day(5)), day(5))).toMatchObject({
      last: 'Not marked done since 1 Oct',
      details: ['due in 9 days'],
    });
    expect(stepLine(stepStatus('tank-tray', record({ ...NEVER, id: 'tank-tray' }), DEFAULT_CARE, totals(), day(2)), day(2)).last).toBe(
      'Not marked done since 1 Oct',
    );
    expect(stepLine(stepStatus('tank-tray', null, DEFAULT_CARE, totals(), day(2)), day(2)).last).toBe('Not marked done yet');
  });

  it('a step without a reminder says its last time alone', () => {
    const tank = record({ id: 'tank-tray' });
    expect(stepLine(stepStatus('tank-tray', tank, DEFAULT_CARE, totals({ shots: 200 }), day(5)), day(5))).toEqual({
      due: false,
      last: 'Last done 5 days ago',
      doneToday: false,
      details: [],
    });
  });
});

describe('what the water and the filter set (D187)', () => {
  it('says the interval in Decent’s bands, and what CafAI assumes when it does not know', () => {
    expect(waterLine('under30')).toContain('needs no descaling');
    expect(waterLine('to120')).toContain('after a year, or 1,500 shots');
    expect(waterLine('over120')).toContain('after six months, or 800 shots');
    expect(waterLine(null)).toContain('does not know your water');
    expect(filterLine('v1')).toContain('every two weeks');
    expect(filterLine('v2')).toContain('every month');
    expect(filterLine(null)).toContain('as for V1');
  });
});

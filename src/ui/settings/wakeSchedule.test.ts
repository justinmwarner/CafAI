import { describe, expect, it } from 'vitest';
import type { WakeSchedule } from '../../api/types.ts';
import {
  daysPicked,
  daysToStore,
  describeDays,
  describeKeepAwake,
  describeSchedule,
  describeWhen,
  formatMinutes,
  formatWakeTime,
  keptAwakeUntil,
  nextWake,
  sortSchedules,
  speakSchedule,
} from './wakeSchedule.ts';

const wake = (id: string, time: string, daysOfWeek: number[] = [], extra: Partial<WakeSchedule> = {}): WakeSchedule => ({
  id,
  time,
  daysOfWeek,
  enabled: true,
  ...extra,
});

/** Thursday 15 October 2026, local time. */
const thursday = (hour: number, minute = 0, second = 0) => new Date(2026, 9, 15, hour, minute, second);

describe('describeDays', () => {
  it('says every day for none or all seven, as Decaid keeps them', () => {
    expect(describeDays([])).toBe('Every day');
    expect(describeDays([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });

  it('names weekdays and weekends, and lists the rest in order', () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(describeDays([7, 6])).toBe('Weekends');
    expect(describeDays([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(describeDays([7, 7, 1])).toBe('Mon, Sun');
  });

  it('leaves out a day Decaid could not mean', () => {
    expect(describeDays([0, 8, 2])).toBe('Tue');
  });
});

describe('the days picked and stored', () => {
  it('shows every day as all seven picked', () => {
    expect(daysPicked([])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(daysPicked([3, 1])).toEqual([1, 3]);
  });

  it('stores all seven as every day, and the rest in order', () => {
    expect(daysToStore([7, 6, 5, 4, 3, 2, 1])).toEqual([]);
    expect(daysToStore([5, 1])).toEqual([1, 5]);
  });
});

describe('keeping awake', () => {
  it('says minutes and hours', () => {
    expect(formatMinutes(30)).toBe('30 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(720)).toBe('12 h');
  });

  it('offers none as the idle sleep, as usual', () => {
    expect(describeKeepAwake(null)).toBe('Sleep when idle, as usual');
    expect(describeKeepAwake(90)).toBe('Stay awake for 1 h 30 min');
  });

  it('puts the days and the window under a wake time', () => {
    expect(describeSchedule(wake('a', '06:30', [1, 2, 3, 4, 5], { keepAwakeFor: 60 }))).toBe('Weekdays · stays awake for 1 h');
    expect(describeSchedule(wake('b', '08:00', [6, 7]))).toBe('Weekends');
  });

  it('says a wake time aloud, the time first and whether it is off last', () => {
    expect(speakSchedule(wake('a', '06:30', [1, 2, 3, 4, 5], { keepAwakeFor: 60 }), '24h')).toBe('06:30, Weekdays, stays awake for 1 h');
    expect(speakSchedule(wake('b', '08:00', [6, 7], { enabled: false }), '24h')).toBe('08:00, Weekends, off');
  });

  it('says it on the 12-hour clock when chosen (D245)', () => {
    expect(speakSchedule(wake('a', '06:30', [1, 2, 3, 4, 5], { keepAwakeFor: 60 }), '12h')).toBe('6:30 am, Weekdays, stays awake for 1 h');
    expect(speakSchedule(wake('b', '20:00', [6, 7], { enabled: false }), '12h')).toBe('8:00 pm, Weekends, off');
  });
});

describe('formatWakeTime (D245)', () => {
  it("shows Decaid's HH:MM in the clock chosen", () => {
    expect(formatWakeTime('06:30', '24h')).toBe('06:30');
    expect(formatWakeTime('06:30', '12h')).toBe('6:30 am');
    expect(formatWakeTime('00:05', '12h')).toBe('12:05 am');
    expect(formatWakeTime('12:00', '12h')).toBe('12:00 pm');
    expect(formatWakeTime('22:45', '12h')).toBe('10:45 pm');
  });

  it('shows a time it cannot read as Decaid gave it', () => {
    expect(formatWakeTime('6:30', '12h')).toBe('6:30');
    expect(formatWakeTime('25:00', '12h')).toBe('25:00');
  });
});

describe('sortSchedules', () => {
  it('puts the earliest first, then the one with the earliest day', () => {
    const sorted = sortSchedules([wake('late', '08:00'), wake('sat', '06:30', [6]), wake('mon', '06:30', [1, 3]), wake('early', '05:45', [7])]);
    expect(sorted.map((schedule) => schedule.id)).toEqual(['early', 'mon', 'sat', 'late']);
  });
});

describe('nextWake', () => {
  const weekdays = wake('weekdays', '06:30', [1, 2, 3, 4, 5]);

  it('finds today, tomorrow and after the weekend', () => {
    expect(nextWake([weekdays], thursday(5))?.at).toEqual(thursday(6, 30));
    expect(nextWake([weekdays], thursday(7))?.at).toEqual(new Date(2026, 9, 16, 6, 30));
    expect(nextWake([weekdays], new Date(2026, 9, 16, 7))?.at).toEqual(new Date(2026, 9, 19, 6, 30));
  });

  it('counts a wake whose minute has begun from its next day, as Decaid wakes at the start of the minute', () => {
    expect(nextWake([weekdays], thursday(6, 30, 10))?.at).toEqual(new Date(2026, 9, 16, 6, 30));
  });

  it('takes the earliest of several, and leaves out the ones that are off', () => {
    const later = wake('later', '07:15');
    const off = wake('off', '05:30', [], { enabled: false });
    expect(nextWake([later, weekdays, off], thursday(5))?.schedule.id).toBe('weekdays');
    expect(nextWake([off], thursday(5))).toBeNull();
    expect(nextWake([], thursday(5))).toBeNull();
  });

  it('comes round to the same day next week', () => {
    const thursdays = wake('thu', '06:30', [4]);
    expect(nextWake([thursdays], thursday(7))?.at).toEqual(new Date(2026, 9, 22, 6, 30));
  });

  it('passes over a time it cannot read', () => {
    expect(nextWake([wake('bad', '6:30')], thursday(5))).toBeNull();
  });
});

describe('describeWhen', () => {
  it('says today, tomorrow, the day, or next week', () => {
    const now = thursday(5);
    expect(describeWhen(thursday(6, 30), now, '24h')).toBe('today at 06:30');
    expect(describeWhen(new Date(2026, 9, 16, 6, 5), now, '24h')).toBe('tomorrow at 06:05');
    expect(describeWhen(new Date(2026, 9, 19, 6, 30), now, '24h')).toBe('Monday at 06:30');
    expect(describeWhen(new Date(2026, 9, 22, 6, 30), now, '24h')).toBe('next Thursday at 06:30');
  });

  it('says the time on the 12-hour clock when chosen (D245)', () => {
    const now = thursday(5);
    expect(describeWhen(thursday(6, 30), now, '12h')).toBe('today at 6:30 am');
    expect(describeWhen(new Date(2026, 9, 16, 18, 5), now, '12h')).toBe('tomorrow at 6:05 pm');
    expect(describeWhen(new Date(2026, 9, 22, 0, 15), now, '12h')).toBe('next Thursday at 12:15 am');
  });
});

describe('keptAwakeUntil', () => {
  it("reads Decaid's local time from its own digits while the window runs", () => {
    expect(keptAwakeUntil('2026-10-15T07:30:00.000', thursday(7), '24h')).toBe('07:30');
    expect(keptAwakeUntil('2026-10-15T13:30:00.000', thursday(7), '24h')).toBe('13:30');
  });

  it('says it on the 12-hour clock when chosen (D245)', () => {
    expect(keptAwakeUntil('2026-10-15T07:30:00.000', thursday(7), '12h')).toBe('7:30 am');
    expect(keptAwakeUntil('2026-10-15T13:30:00.000', thursday(7), '12h')).toBe('1:30 pm');
  });

  it('says nothing once it has passed, or without one', () => {
    expect(keptAwakeUntil('2026-10-15T07:30:00.000', thursday(7, 31), '24h')).toBeNull();
    expect(keptAwakeUntil(null, thursday(7), '24h')).toBeNull();
    expect(keptAwakeUntil(undefined, thursday(7), '12h')).toBeNull();
    expect(keptAwakeUntil('soon', thursday(7), '12h')).toBeNull();
  });
});

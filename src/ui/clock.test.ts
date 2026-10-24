import { describe, expect, it } from 'vitest';
import { formatClock, formatTime, fromTwelveHour, parseClockText, toTwelveHour } from './clock.ts';

describe('formatClock (D245)', () => {
  it('24-hour: two figures for the hour, as every time read before', () => {
    expect(formatClock(14, 30, '24h')).toBe('14:30');
    expect(formatClock(6, 5, '24h')).toBe('06:05');
    expect(formatClock(0, 0, '24h')).toBe('00:00');
    expect(formatClock(23, 59, '24h')).toBe('23:59');
  });

  it('12-hour: the hour as it is said, then am or pm; midnight is 12 am and noon 12 pm', () => {
    expect(formatClock(14, 30, '12h')).toBe('2:30 pm');
    expect(formatClock(6, 5, '12h')).toBe('6:05 am');
    expect(formatClock(0, 0, '12h')).toBe('12:00 am');
    expect(formatClock(0, 45, '12h')).toBe('12:45 am');
    expect(formatClock(12, 0, '12h')).toBe('12:00 pm');
    expect(formatClock(11, 59, '12h')).toBe('11:59 am');
    expect(formatClock(23, 59, '12h')).toBe('11:59 pm');
  });
});

describe('formatTime', () => {
  const at = new Date(2026, 9, 24, 21, 4, 5, 123);
  const early = new Date(2026, 9, 24, 6, 0, 9, 7);

  it('a date’s local time to the minute', () => {
    expect(formatTime(at, '24h')).toBe('21:04');
    expect(formatTime(at, '12h')).toBe('9:04 pm');
    expect(formatTime(early, '24h')).toBe('06:00');
    expect(formatTime(early, '12h')).toBe('6:00 am');
  });

  it('to the second, and to the millisecond, the half last', () => {
    expect(formatTime(at, '24h', 'second')).toBe('21:04:05');
    expect(formatTime(at, '12h', 'second')).toBe('9:04:05 pm');
    expect(formatTime(at, '24h', 'millisecond')).toBe('21:04:05.123');
    expect(formatTime(at, '12h', 'millisecond')).toBe('9:04:05.123 pm');
    expect(formatTime(early, '24h', 'millisecond')).toBe('06:00:09.007');
  });
});

describe('toTwelveHour and fromTwelveHour', () => {
  it('turn the 24-hour day’s hour into the hour said and its half, and back', () => {
    const cases: Array<[number, number, 'am' | 'pm']> = [
      [0, 12, 'am'],
      [1, 1, 'am'],
      [11, 11, 'am'],
      [12, 12, 'pm'],
      [13, 1, 'pm'],
      [23, 11, 'pm'],
    ];
    for (const [hour, said, half] of cases) {
      expect(toTwelveHour(hour), String(hour)).toEqual({ hour: said, half });
      expect(fromTwelveHour(said, half), `${said} ${half}`).toBe(hour);
    }
  });
});

describe('parseClockText', () => {
  it('reads a 24-hour time on either clock', () => {
    expect(parseClockText('14:30', '24h')).toEqual({ hour: 14, minute: 30 });
    expect(parseClockText('06:05', '24h')).toEqual({ hour: 6, minute: 5 });
    expect(parseClockText('6:05', '24h')).toEqual({ hour: 6, minute: 5 });
    expect(parseClockText(' 23.59 ', '24h')).toEqual({ hour: 23, minute: 59 });
    expect(parseClockText('14:30', '12h')).toEqual({ hour: 14, minute: 30 });
    expect(parseClockText('0:30', '12h')).toEqual({ hour: 0, minute: 30 });
  });

  it('reads am and pm on either clock, however they are written', () => {
    expect(parseClockText('2:30 pm', '12h')).toEqual({ hour: 14, minute: 30 });
    expect(parseClockText('2:30pm', '12h')).toEqual({ hour: 14, minute: 30 });
    expect(parseClockText('2 PM', '12h')).toEqual({ hour: 14, minute: 0 });
    expect(parseClockText('12:05 a.m.', '12h')).toEqual({ hour: 0, minute: 5 });
    expect(parseClockText('12:00 pm', '24h')).toEqual({ hour: 12, minute: 0 });
    expect(parseClockText('6:30 am', '24h')).toEqual({ hour: 6, minute: 30 });
  });

  it('on the 12-hour clock, leaves a bare time that could be either half unread', () => {
    expect(parseClockText('2:30', '12h')).toBeNull();
    expect(parseClockText('12:15', '12h')).toBeNull();
    expect(parseClockText('2:30', '24h')).toEqual({ hour: 2, minute: 30 });
  });

  it('is null for anything that is not a time', () => {
    for (const text of ['', 'soon', '24:00', '7:60', '13 pm', '0 am', '14', '1430', '6:3', '6:30 xm']) {
      expect(parseClockText(text, '24h'), text).toBeNull();
      expect(parseClockText(text, '12h'), text).toBeNull();
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { armWindowEnd, currentWindow, describeWhen, describeWindow, formatTime, inWindow, msUntilEnd, nextStart, parseTime, parseWindow } from './window.mjs';

// October 2026: the 11th is a Sunday, the 12th a Monday, the 16th a Friday, the 17th a Saturday.
const at = (day, hours, minutes = 0, seconds = 0, ms = 0) => new Date(2026, 9, day, hours, minutes, seconds, ms);
const morning = parseWindow('05:00-10:00');
const night = parseWindow('22:00-02:00');
const HOUR = 3_600_000;

describe('parsing a window', () => {
  it('reads times as minutes after midnight', () => {
    expect(parseTime('5:00')).toBe(300);
    expect(parseTime(' 05:30 ')).toBe(330);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7:60')).toBeNull();
    expect(parseTime('7')).toBeNull();
    expect(formatTime(300)).toBe('05:00');
    expect(formatTime(1439)).toBe('23:59');
  });

  it('reads "from-to" as two different times, normalised', () => {
    expect(parseWindow('5:00-10:00')).toEqual({ start: 300, end: 600, weekdays: false, text: '05:00-10:00' });
    expect(parseWindow('22:00-02:00', { weekdays: true })).toEqual({ start: 1320, end: 120, weekdays: true, text: '22:00-02:00' });
    expect(parseWindow('10:00-10:00')).toBeNull();
    expect(parseWindow('05:00')).toBeNull();
    expect(parseWindow('05:00-10:00-11:00')).toBeNull();
    expect(parseWindow('5-10')).toBeNull();
  });
});

describe('inWindow', () => {
  it('is inside from the start up to, not including, the end', () => {
    expect(inWindow(morning, at(11, 4, 59, 59))).toBe(false);
    expect(inWindow(morning, at(11, 5))).toBe(true);
    expect(inWindow(morning, at(11, 9, 59, 59))).toBe(true);
    expect(inWindow(morning, at(11, 10))).toBe(false);
  });

  it('crosses midnight', () => {
    expect(inWindow(night, at(11, 21, 59))).toBe(false);
    expect(inWindow(night, at(11, 23))).toBe(true);
    expect(inWindow(night, at(12, 1, 59))).toBe(true);
    expect(inWindow(night, at(12, 2))).toBe(false);
  });

  it('keeps to Monday-Friday with --weekdays', () => {
    const weekdays = parseWindow('05:00-10:00', { weekdays: true });
    expect(inWindow(weekdays, at(11, 6))).toBe(false); // Sunday
    expect(inWindow(weekdays, at(12, 6))).toBe(true); // Monday
    expect(inWindow(weekdays, at(16, 6))).toBe(true); // Friday
    expect(inWindow(weekdays, at(17, 6))).toBe(false); // Saturday
  });

  it('gives a window crossing midnight to the day it starts on', () => {
    const weekdays = parseWindow('22:00-02:00', { weekdays: true });
    expect(inWindow(weekdays, at(16, 23))).toBe(true); // Friday night
    expect(inWindow(weekdays, at(17, 1))).toBe(true); // Saturday 01:00 is still Friday's window
    expect(inWindow(weekdays, at(17, 23))).toBe(false); // Saturday night
    expect(inWindow(weekdays, at(12, 1))).toBe(false); // Monday 01:00 is Sunday's window
    expect(inWindow(weekdays, at(13, 1))).toBe(true); // Tuesday 01:00 is Monday's window
    expect(currentWindow(weekdays, at(17, 1))).toEqual({ start: at(16, 22), end: at(17, 2) });
  });
});

describe('msUntilEnd and nextStart', () => {
  it('counts down to the end inside the window, and is 0 outside', () => {
    expect(msUntilEnd(morning, at(11, 9))).toBe(HOUR);
    expect(msUntilEnd(morning, at(11, 9, 59, 59, 500))).toBe(500);
    expect(msUntilEnd(morning, at(11, 10))).toBe(0);
    expect(msUntilEnd(morning, at(11, 4))).toBe(0);
    expect(msUntilEnd(night, at(11, 23, 30))).toBe(2.5 * HOUR);
    expect(msUntilEnd(night, at(12, 1))).toBe(HOUR);
  });

  it('finds the next start, on a weekday with --weekdays', () => {
    expect(nextStart(morning, at(11, 4))).toEqual(at(11, 5));
    expect(nextStart(morning, at(11, 6))).toEqual(at(12, 5));
    expect(nextStart(morning, at(11, 5))).toEqual(at(12, 5));
    const weekdays = parseWindow('05:00-10:00', { weekdays: true });
    expect(nextStart(weekdays, at(16, 11))).toEqual(at(19, 5)); // Friday after the window: Monday
    expect(nextStart(weekdays, at(17, 3))).toEqual(at(19, 5)); // Saturday: Monday
  });

  it('says when, and which days, in words', () => {
    expect(describeWhen(at(11, 5), at(11, 4))).toBe('today at 05:00');
    expect(describeWhen(at(12, 5), at(11, 6))).toBe('tomorrow at 05:00');
    expect(describeWhen(at(19, 5), at(16, 11))).toBe('on Monday at 05:00');
    expect(describeWindow(morning)).toBe('every day, 05:00-10:00');
    expect(describeWindow(parseWindow('05:00-10:00', { weekdays: true }))).toBe('Monday to Friday, 05:00-10:00');
  });
});

describe('armWindowEnd', () => {
  function fakeClock(start) {
    const clock = { time: start, timers: [] };
    clock.now = () => clock.time;
    clock.setTimer = vi.fn((fn, ms) => {
      clock.timers.push({ fn, ms });
      return clock.timers.length;
    });
    clock.clearTimer = vi.fn();
    clock.fire = (time) => {
      clock.time = time;
      clock.timers.at(-1).fn();
    };
    return clock;
  }

  it('works out the end from the clock each time, a minute at a time, and re-arms when it fires early', () => {
    const clock = fakeClock(at(11, 9, 58));
    const onEnd = vi.fn();
    armWindowEnd(morning, clock, onEnd);
    expect(clock.timers.at(-1).ms).toBe(60_000);
    clock.fire(at(11, 9, 59));
    expect(clock.timers.at(-1).ms).toBe(60_000);
    clock.fire(at(11, 9, 59, 59, 500)); // early: half a second to go
    expect(onEnd).not.toHaveBeenCalled();
    expect(clock.timers.at(-1).ms).toBe(500);
    clock.fire(at(11, 10));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(clock.timers).toHaveLength(3);
  });

  it('ends at once after sleeping past the end', () => {
    const clock = fakeClock(at(11, 6));
    const onEnd = vi.fn();
    armWindowEnd(morning, clock, onEnd);
    clock.fire(at(11, 11));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled', () => {
    const clock = fakeClock(at(11, 6));
    const onEnd = vi.fn();
    const cancel = armWindowEnd(morning, clock, onEnd);
    cancel();
    expect(clock.clearTimer).toHaveBeenCalledWith(1);
    clock.fire(at(11, 10));
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('daylight saving', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('measures a window across the October change by the clock, not by hours', () => {
    process.env.TZ = 'Europe/Amsterdam';
    // Some platforms ignore a TZ set while running; then there is nothing to check here.
    if (new Date(2026, 6, 1).getTimezoneOffset() !== -120) return;
    // Clocks go back from 03:00 to 02:00 on Sunday 25 October 2026: 22:00-04:00 lasts seven hours that night.
    expect(msUntilEnd(parseWindow('22:00-04:00'), new Date(2026, 9, 24, 22))).toBe(7 * HOUR);
    expect(msUntilEnd(parseWindow('05:00-10:00'), new Date(2026, 9, 25, 5))).toBe(5 * HOUR);
  });
});

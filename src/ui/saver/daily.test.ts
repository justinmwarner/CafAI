import { describe, expect, it } from 'vitest';
import { canRun, DAILY, dailyOrder, dailyPick, resolvePick, runnableSavers } from './daily.ts';
import { localDayNumber } from './random.ts';
import { SAVERS } from './registry.ts';
import type { SaverId } from './types.ts';

const ALL: readonly SaverId[] = SAVERS.map((saver) => saver.id);
const DAY = localDayNumber(new Date(2026, 9, 22));

describe('dailyPick', () => {
  it('over 30 days gives each one in turn, and never the same two days running', () => {
    const picks = Array.from({ length: 30 }, (_, i) => dailyPick(ALL, DAY + i));
    for (let i = 1; i < picks.length; i += 1) expect(picks[i], `day ${i}`).not.toBe(picks[i - 1]);
    // In turn: every one once in each run of as many days as there are screensavers.
    for (let start = 0; start + ALL.length <= picks.length; start += ALL.length) {
      expect(new Set(picks.slice(start, start + ALL.length)).size).toBe(ALL.length);
    }
    // The same day gives the same one, on any device.
    expect(dailyPick(ALL, DAY)).toBe(picks[0]);
  });

  it('is a shuffle, not the registry order', () => {
    expect(dailyOrder(ALL)).not.toEqual(ALL);
    expect([...dailyOrder(ALL)].sort()).toEqual([...ALL].sort());
  });

  it('skips one this device cannot run, and keeps the rest in turn', () => {
    const without = ALL.filter((id) => id !== 'beanfield');
    const picks = Array.from({ length: 30 }, (_, i) => dailyPick(without, DAY + i));
    expect(picks).not.toContain('beanfield');
    for (let i = 1; i < picks.length; i += 1) expect(picks[i]).not.toBe(picks[i - 1]);
    expect(new Set(picks.slice(0, without.length)).size).toBe(without.length);
    // The others keep their order: the fixed shuffle less the one left out.
    expect(dailyOrder(without)).toEqual(dailyOrder(ALL).filter((id) => id !== 'beanfield'));
  });

  it('works on any day number, before 1970 included, and falls back to Nightstand with none to run', () => {
    expect(ALL).toContain(dailyPick(ALL, -3));
    expect(ALL).toContain(dailyPick(ALL, Number.NaN));
    expect(dailyPick([], DAY)).toBe('nightstand');
    expect(dailyPick(['rain'], DAY)).toBe('rain');
  });
});

describe('resolvePick', () => {
  it("resolves 'daily' to the day's pick", () => {
    expect(resolvePick(DAILY, ALL, DAY)).toBe(dailyPick(ALL, DAY));
  });

  it('keeps a pick this device can run', () => {
    for (const id of ALL) expect(resolvePick(id, ALL, DAY)).toBe(id);
  });

  it("reads one this build does not know, or this device cannot run, as the day's pick", () => {
    expect(resolvePick('pipes', ALL, DAY)).toBe(dailyPick(ALL, DAY));
    expect(resolvePick('', ALL, DAY)).toBe(dailyPick(ALL, DAY));
    const without = ALL.filter((id) => id !== 'lava');
    expect(resolvePick('lava', without, DAY)).toBe(dailyPick(without, DAY));
  });
});

describe('what a device can run', () => {
  it('leaves out one that needs WebGL only where WebGL cannot start', () => {
    expect(canRun({ context: 'webgl' }, false)).toBe(false);
    expect(canRun({ context: 'webgl' }, true)).toBe(true);
    expect(canRun({ context: '2d' }, false)).toBe(true);
    expect(canRun({ context: 'text' }, false)).toBe(true);
    // None needs it yet: every one runs either way.
    expect(runnableSavers(false)).toEqual(ALL);
    expect(runnableSavers(true)).toEqual(ALL);
  });
});

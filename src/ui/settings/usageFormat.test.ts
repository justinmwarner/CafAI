import { describe, expect, it } from 'vitest';
import { budgetState } from '../../spend/budget.ts';
import { budgetPercent, formatCost, formatPercent, formatTokens, sayDate, sayDay } from './usageFormat.ts';

const NOW = new Date(2026, 9, 24, 15, 0);
/** A number and its unit never part: the no-break space between them. */
const NBSP = '\xa0';

describe("the usage card's numbers (D239)", () => {
  it('writes tokens in k and M, one decimal under ten of either, the unit after a no-break space', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1000)).toBe(`1.0${NBSP}k`);
    expect(formatTokens(4321)).toBe(`4.3${NBSP}k`);
    // 9.95 k would read "10.0 k": from there, whole thousands.
    expect(formatTokens(9949)).toBe(`9.9${NBSP}k`);
    expect(formatTokens(9950)).toBe(`10${NBSP}k`);
    expect(formatTokens(18_000)).toBe(`18${NBSP}k`);
    expect(formatTokens(412_000)).toBe(`412${NBSP}k`);
    expect(formatTokens(999_499)).toBe(`999${NBSP}k`);
    expect(formatTokens(999_500)).toBe(`1.0${NBSP}M`);
    expect(formatTokens(1_200_000)).toBe(`1.2${NBSP}M`);
    expect(formatTokens(12_400_000)).toBe(`12${NBSP}M`);
    expect(formatTokens(1_234_000_000)).toBe(`1,234${NBSP}M`);
  });

  it('writes dollars to the cent, and a cost under a cent as under one rather than nothing', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1_840_000)).toBe('$1.84');
    expect(formatCost(1_234_560_000)).toBe('$1,234.56');
    expect(formatCost(3000)).toBe(`<${NBSP}$0.01`);
    expect(formatCost(4999)).toBe(`<${NBSP}$0.01`);
    expect(formatCost(5000)).toBe('$0.01');
  });

  it('writes a share in whole percent, the sign after a no-break space', () => {
    expect(formatPercent(0.368)).toBe(`37${NBSP}%`);
    expect(formatPercent(0)).toBe(`0${NBSP}%`);
    expect(formatPercent(1.12)).toBe(`112${NBSP}%`);
  });

  it("keeps the budget's percent on its own side of each step, so the words never say 80 % before the warning does", () => {
    const at = (spentMicros: number) => budgetPercent(budgetState({ monthlyUsd: 5, pauseAtBudget: false }, spentMicros, NOW));
    expect(at(1_840_000)).toBe(37);
    expect(at(3_990_000)).toBe(79);
    expect(at(4_000_000)).toBe(80);
    expect(at(4_990_000)).toBe(99);
    expect(at(5_000_000)).toBe(100);
    expect(at(5_600_000)).toBe(112);
    expect(budgetPercent(budgetState(undefined, 1_000_000, NOW))).toBeNull();
  });

  it('says a day as the barista does, and a date with its year, each kept on one line', () => {
    expect(sayDay('2026-10-04')).toBe(`4${NBSP}October`);
    expect(sayDate('2026-10-24')).toBe(`24${NBSP}October${NBSP}2026`);
  });
});

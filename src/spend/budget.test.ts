import { describe, expect, it } from 'vitest';
import { BUDGET_NOTES_KEY, budgetNotice, budgetState, createBudgetNotes, formatUsd, pausedLine, resumeDay } from './budget.ts';

const NOW = new Date(2026, 9, 24, 15, 0);
const dollars = (usd: number) => Math.round(usd * 1_000_000);

function memoryStorage(): globalThis.Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('budgetState (D240)', () => {
  it('has no step and never pauses without a budget, whatever was spent', () => {
    for (const budget of [undefined, { monthlyUsd: null, pauseAtBudget: true }]) {
      expect(budgetState(budget, dollars(50), NOW)).toEqual({
        budgetMicros: null,
        spentMicros: dollars(50),
        ratio: null,
        step: 'none',
        paused: false,
        resumesOn: '2026-11-01',
      });
    }
  });

  it('is under the budget below 80 %, near it from 80 %, over it from 100 %', () => {
    const budget = { monthlyUsd: 5, pauseAtBudget: false };
    expect(budgetState(budget, dollars(3.99), NOW)).toMatchObject({ budgetMicros: 5_000_000, step: 'under', paused: false });
    expect(budgetState(budget, dollars(4), NOW)).toMatchObject({ step: 'near', ratio: 0.8 });
    expect(budgetState(budget, dollars(4.99), NOW).step).toBe('near');
    expect(budgetState(budget, dollars(5), NOW)).toMatchObject({ step: 'over', ratio: 1, paused: false });
    expect(budgetState(budget, dollars(7.5), NOW)).toMatchObject({ step: 'over', ratio: 1.5 });
  });

  it('pauses only at or over the budget, and only with the switch on; the pause lifts on the 1st of next month', () => {
    const pausing = { monthlyUsd: 5, pauseAtBudget: true };
    expect(budgetState(pausing, dollars(4.99), NOW).paused).toBe(false);
    expect(budgetState(pausing, dollars(5), NOW)).toMatchObject({ paused: true, resumesOn: '2026-11-01' });
    expect(budgetState(pausing, dollars(5), new Date(2026, 11, 31, 23, 0)).resumesOn).toBe('2027-01-01');
  });
});

describe("the budget's words (D240)", () => {
  it('writes dollars with cents, or whole, with a comma past a thousand', () => {
    expect(formatUsd(dollars(4.02))).toBe('$4.02');
    expect(formatUsd(4_015_000)).toBe('$4.02');
    expect(formatUsd(dollars(5))).toBe('$5.00');
    expect(formatUsd(dollars(5), false)).toBe('$5');
    expect(formatUsd(dollars(1000), false)).toBe('$1,000');
    expect(formatUsd(dollars(1234.5))).toBe('$1,234.50');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it("names the day a pause lifts as the barista says it: '1 November'", () => {
    expect(resumeDay('2026-11-01')).toBe('1 November');
    expect(resumeDay('2027-01-01')).toBe('1 January');
  });

  it("says at 80 % what was used of the budget, and at 100 % that it was reached, the budget in whole dollars", () => {
    const budget = { monthlyUsd: 5, pauseAtBudget: false };
    expect(budgetNotice(budgetState(budget, dollars(4.02), NOW))).toEqual({
      step: 'near',
      tone: 'info',
      text: 'The coach has used $4.02 of your $5 budget this month.',
    });
    expect(budgetNotice(budgetState(budget, dollars(5.3), NOW))).toEqual({
      step: 'over',
      tone: 'warning',
      text: "This month's coach spend reached your $5 budget.",
    });
    expect(budgetNotice(budgetState(budget, dollars(1), NOW))).toBeNull();
    expect(budgetNotice(budgetState(undefined, dollars(100), NOW))).toBeNull();
  });

  it('says on the pause card what reached the budget and when the coach starts again', () => {
    expect(pausedLine(5, '2026-11-01')).toBe(
      "The coach is paused: this month's spend reached your $5.00 budget. Raise it in Settings, or it starts again on 1 November.",
    );
  });
});

describe("the budget's notices, once a month at each step (D240)", () => {
  const budget = { monthlyUsd: 5, pauseAtBudget: false };
  const near = budgetState(budget, dollars(4.02), NOW);
  const over = budgetState(budget, dollars(5.1), NOW);

  it('gives each step its notice once a month, on this device', () => {
    const storage = memoryStorage();
    const notes = createBudgetNotes(storage);
    expect(notes.take(near, '2026-10')?.step).toBe('near');
    expect(notes.take(near, '2026-10')).toBeNull();
    expect(notes.take(over, '2026-10')?.step).toBe('over');
    expect(notes.take(over, '2026-10')).toBeNull();
    // Another page of the same device has said them too.
    expect(createBudgetNotes(storage).take(over, '2026-10')).toBeNull();
    expect(JSON.parse(storage.getItem(BUDGET_NOTES_KEY)!)).toEqual({ month: '2026-10', usd: 5, said: ['near', 'over'] });
    expect(BUDGET_NOTES_KEY).toBe('cafai.spend.noticed');
  });

  it('says only that the budget was reached when one reply went from under it to over it', () => {
    const notes = createBudgetNotes(memoryStorage());
    expect(notes.take(over, '2026-10')?.step).toBe('over');
    expect(notes.take(near, '2026-10')).toBeNull();
  });

  it('says them again in a new month, and for a new budget', () => {
    const notes = createBudgetNotes(memoryStorage());
    notes.take(over, '2026-10');
    expect(notes.take(near, '2026-11')?.step).toBe('near');
    const raised = budgetState({ monthlyUsd: 6, pauseAtBudget: false }, dollars(5.1), NOW);
    expect(notes.take(raised, '2026-11')?.text).toBe('The coach has used $5.10 of your $6 budget this month.');
  });

  it('keeps them in memory for the page when the device keeps nothing, and reads past a note it cannot read', () => {
    const blocked = createBudgetNotes(null);
    expect(blocked.take(near, '2026-10')?.step).toBe('near');
    expect(blocked.take(near, '2026-10')).toBeNull();
    const storage = memoryStorage();
    storage.setItem(BUDGET_NOTES_KEY, '{not json');
    expect(createBudgetNotes(storage).take(near, '2026-10')?.step).toBe('near');
  });
});

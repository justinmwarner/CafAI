/**
 * The coach's monthly budget (D240): the month's spend on the API key
 * against Settings.coachBudget, the notices at 80 % and 100 %, and the pause.
 *
 * Only replies on the API key cost money, so only they count toward it:
 * replies through CafAI Bridge, on the Claude plan, never do and never pause.
 * The budget is checked before each reply; a reply already started finishes,
 * its tool loop included, so a month can pass the budget by one reply's worth.
 */
import type { CoachBudget } from '../storage/types.ts';
import { nextMonthStart } from './records.ts';
import type { BudgetState } from './types.ts';

/** 80 % of the budget: the notice that it is near. */
const NEAR = 0.8;

export function budgetState(budget: CoachBudget | undefined, spentMicros: number, now: Date): BudgetState {
  const usd = budget?.monthlyUsd ?? null;
  const budgetMicros = usd !== null && usd > 0 ? usd * 1_000_000 : null;
  const ratio = budgetMicros === null ? null : spentMicros / budgetMicros;
  const step = ratio === null ? 'none' : ratio >= 1 ? 'over' : ratio >= NEAR ? 'near' : 'under';
  return {
    budgetMicros,
    spentMicros,
    ratio,
    step,
    paused: step === 'over' && budget?.pauseAtBudget === true,
    resumesOn: nextMonthStart(now),
  };
}

/** Dollars as the barista reads them: "$4.02", or whole ("$5", "$1,000") for a budget in a sentence. */
export function formatUsd(micros: number, cents = true): string {
  const allCents = Math.round(micros / 10_000);
  const whole = Math.floor(allCents / 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents ? `$${grouped}.${String(allCents % 100).padStart(2, '0')}` : `$${grouped}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM-DD' as the barista says it: "1 November". */
export function resumeDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`.trim();
}

/** The pause card's words (BudgetPausedCard): what reached the budget, and when the coach starts again by itself. */
export function pausedLine(budgetUsd: number, resumesOn: string): string {
  return `The coach is paused: this month's spend reached your ${formatUsd(budgetUsd * 1_000_000)} budget. Raise it in Settings, or it starts again on ${resumeDay(resumesOn)}.`;
}

/** A quiet notice in the chat as the month's spend nears the budget, then reaches it. */
export interface BudgetNotice {
  step: 'near' | 'over';
  tone: 'info' | 'warning';
  text: string;
}

/** The notice for where the spend stands, or null below 80 % or without a budget. */
export function budgetNotice(state: BudgetState): BudgetNotice | null {
  if (state.budgetMicros === null) return null;
  const budget = formatUsd(state.budgetMicros, false);
  if (state.step === 'near') {
    // Cents rounded down: at 99.9 % it says $4.99 of your $5, never $5.00.
    const spent = formatUsd(Math.floor(state.spentMicros / 10_000) * 10_000);
    return { step: 'near', tone: 'info', text: `The coach has used ${spent} of your ${budget} budget this month.` };
  }
  if (state.step === 'over') return { step: 'over', tone: 'warning', text: `This month's coach spend reached your ${budget} budget.` };
  return null;
}

/** Where a device notes the notices it has given: its own storage, like the care counts' cache. */
export const BUDGET_NOTES_KEY = 'cafai.spend.noticed';

/** The steps said this month, for this budget. */
interface Note {
  month: string;
  usd: number;
  said: Array<'near' | 'over'>;
}

function readNote(text: string | null): Note | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Partial<Note> | null;
    if (!raw || typeof raw.month !== 'string' || typeof raw.usd !== 'number' || !Array.isArray(raw.said)) return null;
    return { month: raw.month, usd: raw.usd, said: raw.said.filter((step): step is 'near' | 'over' => step === 'near' || step === 'over') };
  } catch {
    return null;
  }
}

export interface BudgetNotes {
  /**
   * The notice due for `state` in `month` ('YYYY-MM'), noted as given; null
   * when none is due. Once a month at each step, on this device: a reply that
   * goes from under the budget to over it says only that it was reached, and
   * a new budget, raised or lowered, has its steps said again.
   */
  take(state: BudgetState, month: string): BudgetNotice | null;
}

export function createBudgetNotes(storage: globalThis.Storage | null): BudgetNotes {
  let memory: Note | null = null;
  // This page's own note first: storage that refused it would say every notice again.
  const read = (): Note | null => {
    if (memory) return memory;
    try {
      return storage ? readNote(storage.getItem(BUDGET_NOTES_KEY)) : null;
    } catch {
      return null;
    }
  };
  const write = (note: Note): void => {
    memory = note;
    try {
      storage?.setItem(BUDGET_NOTES_KEY, JSON.stringify(note));
    } catch {
      // Kept for this page.
    }
  };
  return {
    take(state, month) {
      const notice = budgetNotice(state);
      if (!notice || state.budgetMicros === null) return null;
      const usd = state.budgetMicros / 1_000_000;
      const held = read();
      const said = held && held.month === month && held.usd === usd ? held.said : [];
      if (said.includes(notice.step)) return null;
      write({ month, usd, said: notice.step === 'over' ? ['near', 'over'] : [...said, 'near'] });
      return notice;
    },
  };
}

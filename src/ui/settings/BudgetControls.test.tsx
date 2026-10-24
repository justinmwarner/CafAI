// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeRecord } from '../../spend/testing/fixtures.ts';
import type { CoachBudget, Settings } from '../../storage/types.ts';
import { previewTheme } from '../chat/testing/previewTheme.ts';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices, createFakeSpend, type FakeServices } from '../testing/fakeServices.ts';
import { BUDGET_TID, BudgetControls, NO_BUDGET_LINE, PAUSE_LINE } from './BudgetControls.tsx';

const NOW = new Date(2026, 9, 24, 15, 0);

/** This month's spend on the API key: one record of `micros`, no searches. */
function spentThisMonth(micros: number) {
  return createFakeSpend({ records: [makeRecord({ costMicros: micros, webSearches: 0, webSearchMicros: 0 })], now: () => NOW });
}

function servicesWith(budget?: CoachBudget, micros = 1_840_000, settings: Partial<Settings> = {}): FakeServices {
  return createFakeServices({
    storage: {
      settings: {
        model: 'claude-opus-5-5',
        grinderName: null,
        grinderSetting: null,
        activeBagId: null,
        ...(budget ? { coachBudget: budget } : {}),
        ...settings,
      },
    },
    spend: spentThisMonth(micros),
  });
}

const amount = () => screen.getByRole('spinbutton', { name: 'Monthly budget' });
const raise = () => screen.getByRole('button', { name: 'Raise the budget' });
const lower = () => screen.getByRole('button', { name: 'Lower the budget' });
const noBudget = () => screen.getByRole('button', { name: 'No budget' });
const pause = () => screen.getByRole('switch', { name: 'Pause the coach at the budget' });
const meterFill = () => screen.getByTestId(BUDGET_TID.meter).querySelector<HTMLElement>('.usage-meter-fill');
const refreshes = (services: FakeServices) => services.coach.calls.filter((call) => call.method === 'refresh').length;
const savedBudget = async (services: FakeServices) => (await services.storage.settings.get()).coachBudget;

/** Words as a text query matches them: Testing Library reads a no-break space as a space. */
const plain = (text: string) => text.split('\xa0').join(' ');

/** A theme colour as getComputedStyle gives it back. */
function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

async function shown(services: FakeServices, value: string) {
  renderWithServices(<BudgetControls />, services);
  await waitFor(() => expect(amount()).toHaveValue(value));
}

describe('Settings > Coach > Usage and cost > Monthly budget (D240)', () => {
  it('has no budget until one is set: the field says None, and the pause waits for a budget', async () => {
    await shown(servicesWith(), '');
    expect(amount()).toHaveAttribute('placeholder', 'None');
    expect(amount()).toHaveAttribute('aria-valuetext', 'No budget');
    expect(amount()).not.toHaveAttribute('aria-valuenow');
    expect(noBudget()).toBeDisabled();
    expect(screen.getByText(plain(NO_BUDGET_LINE))).toBeInTheDocument();
    // A number and its sign never part at a line's end: no-break spaces.
    expect(NO_BUDGET_LINE).toContain('80\xa0% and 100\xa0%');
    expect(plain(NO_BUDGET_LINE)).toBe('No budget. Set one to be told in the chat at 80 % and 100 % of it.');
    expect(screen.queryByTestId(BUDGET_TID.meter)).toBeNull();
    expect(pause()).toBeDisabled();
    expect(pause()).toHaveAccessibleDescription('Set a budget to use this.');
  });

  it("shows the saved budget and the month's spend against it, the words beside the colour", async () => {
    await shown(servicesWith({ monthlyUsd: 5, pauseAtBudget: false }), '5');
    expect(amount()).toHaveAttribute('aria-valuetext', '5 dollars a month');
    expect(amount()).toHaveAttribute('aria-valuenow', '5');
    expect(amount()).toHaveAttribute('aria-valuemin', '1');
    expect(amount()).toHaveAttribute('aria-valuemax', '1000');
    expect(screen.getByTestId(BUDGET_TID.meter)).toHaveTextContent('37 % of $5.00');
    expect(getComputedStyle(meterFill()!).backgroundColor).toBe(rgb(previewTheme.palette.success.main));
    expect(getComputedStyle(meterFill()!).width).toBe('37%');
    expect(noBudget()).toBeEnabled();
    expect(pause()).toBeEnabled();
    expect(pause()).not.toBeChecked();
    expect(pause()).toHaveAccessibleDescription(PAUSE_LINE);
    expect(PAUSE_LINE).toBe('At the budget the coach sends nothing more until you raise it or a new month begins. Shots still save.');
  });

  it('turns the meter to warning from 80 %', async () => {
    await shown(servicesWith({ monthlyUsd: 5, pauseAtBudget: false }, 4_000_000), '5');
    expect(screen.getByTestId(BUDGET_TID.meter)).toHaveTextContent('80 % of $5.00');
    expect(getComputedStyle(meterFill()!).backgroundColor).toBe(rgb(previewTheme.palette.warning.main));
    expect(getComputedStyle(meterFill()!).width).toBe('80%');
  });

  it('turns the meter to error at 100 %, the meter full and the words past it', async () => {
    await shown(servicesWith({ monthlyUsd: 5, pauseAtBudget: false }, 5_600_000), '5');
    expect(screen.getByTestId(BUDGET_TID.meter)).toHaveTextContent('112 % of $5.00');
    expect(getComputedStyle(meterFill()!).backgroundColor).toBe(rgb(previewTheme.palette.error.main));
    expect(getComputedStyle(meterFill()!).width).toBe('100%');
  });

  it("follows the month's spend as replies are counted", async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false });
    await shown(services, '5');
    expect(screen.getByTestId(BUDGET_TID.meter)).toHaveTextContent('37 % of $5.00');
    // 540,000 input tokens of Opus 5.5 at $4 per million: $2.16 more, $4.00 in all.
    act(() => {
      services.spend?.count({ at: NOW, source: 'anthropic', model: 'claude-opus-5-5', kind: 'reply', call: 0, usage: { inputTokens: 540_000, outputTokens: 0 } });
    });
    expect(screen.getByTestId(BUDGET_TID.meter)).toHaveTextContent('80 % of $5.00');
  });

  it('a tap moves it a dollar, saved at once and alone, then the coach reads its settings again', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: true });
    const update = vi.spyOn(services.storage.settings, 'update');
    await shown(services, '5');

    await userEvent.click(raise());
    expect(amount()).toHaveValue('6');
    await waitFor(async () => expect(await savedBudget(services)).toEqual({ monthlyUsd: 6, pauseAtBudget: true }));
    expect(update).toHaveBeenLastCalledWith({ coachBudget: { monthlyUsd: 6 } });
    await waitFor(() => expect(refreshes(services)).toBe(1));

    await userEvent.click(lower());
    await userEvent.click(lower());
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(4));
    expect(amount()).toHaveValue('4');
    await waitFor(() => expect(refreshes(services)).toBe(3));
  });

  it('from no budget, Raise starts at $1, and Lower has nothing to lower', async () => {
    const services = servicesWith();
    await shown(services, '');
    expect(lower()).toBeDisabled();
    await userEvent.click(raise());
    await waitFor(async () => expect(await savedBudget(services)).toEqual({ monthlyUsd: 1, pauseAtBudget: false }));
    expect(amount()).toHaveValue('1');
    expect(lower()).toBeEnabled();
  });

  it('keeps within $1 and $1,000: a step past either end saves nothing', async () => {
    const low = servicesWith({ monthlyUsd: 1, pauseAtBudget: false });
    const lowUpdate = vi.spyOn(low.storage.settings, 'update');
    await shown(low, '1');
    await userEvent.click(lower());
    expect(amount()).toHaveValue('1');
    expect(lowUpdate).not.toHaveBeenCalled();
  });

  it('keeps within $1,000 too', async () => {
    const high = servicesWith({ monthlyUsd: 1000, pauseAtBudget: false });
    const highUpdate = vi.spyOn(high.storage.settings, 'update');
    await shown(high, '1000');
    await userEvent.click(raise());
    expect(amount()).toHaveValue('1000');
    expect(highUpdate).not.toHaveBeenCalled();
  });

  it('takes any whole dollar typed, kept within its range, once the field is left', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false });
    await shown(services, '5');
    const type = async (text: string) => {
      await userEvent.clear(amount());
      await userEvent.type(amount(), text);
      await userEvent.tab();
    };

    await type('20');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(20));
    expect(amount()).toHaveValue('20');

    await type('2500');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(1000));
    expect(amount()).toHaveValue('1000');

    await type('7.6');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(8));

    await type('$12');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(12));
  });

  it('puts the budget back when what was typed is not a number, saving nothing', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false });
    const update = vi.spyOn(services.storage.settings, 'update');
    await shown(services, '5');
    await userEvent.clear(amount());
    await userEvent.type(amount(), 'lots');
    await userEvent.tab();
    expect(amount()).toHaveValue('5');
    expect(update).not.toHaveBeenCalled();
  });

  it('steps from what is typed with Up and Down', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false });
    await shown(services, '5');
    await userEvent.clear(amount());
    await userEvent.type(amount(), '57{ArrowUp}');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(58));
    expect(amount()).toHaveValue('58');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(56));
  });

  it('clearing the field leaves no budget, as No budget does', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: true });
    await shown(services, '5');
    await userEvent.clear(amount());
    await userEvent.tab();
    await waitFor(async () => expect(await savedBudget(services)).toEqual({ monthlyUsd: null, pauseAtBudget: true }));
    expect(amount()).toHaveValue('');
    expect(screen.getByText(plain(NO_BUDGET_LINE))).toBeInTheDocument();
    // The pause is kept for the next budget, held meanwhile.
    expect(pause()).toBeChecked();
    expect(pause()).toBeDisabled();
    await waitFor(() => expect(refreshes(services)).toBe(1));
  });

  it('No budget clears it in one tap', async () => {
    const services = servicesWith({ monthlyUsd: 30, pauseAtBudget: false });
    const update = vi.spyOn(services.storage.settings, 'update');
    await shown(services, '30');
    await userEvent.click(noBudget());
    expect(amount()).toHaveValue('');
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBeNull());
    expect(update).toHaveBeenLastCalledWith({ coachBudget: { monthlyUsd: null } });
    expect(noBudget()).toBeDisabled();
    expect(screen.queryByTestId(BUDGET_TID.meter)).toBeNull();
  });

  it('the pause switch saves at once and alone, then says when a paused coach starts again', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false }, 5_600_000);
    const update = vi.spyOn(services.storage.settings, 'update');
    await shown(services, '5');
    expect(pause()).toHaveAccessibleDescription(PAUSE_LINE);

    await userEvent.click(pause());
    expect(pause()).toBeChecked();
    await waitFor(async () => expect(await savedBudget(services)).toEqual({ monthlyUsd: 5, pauseAtBudget: true }));
    expect(update).toHaveBeenLastCalledWith({ coachBudget: { pauseAtBudget: true } });
    await waitFor(() => expect(refreshes(services)).toBe(1));
    expect(pause()).toHaveAccessibleDescription(
      // The date kept on one line.
      'Paused now: the coach starts again on 1\xa0November, or as soon as you raise the budget or turn this off.',
    );

    // Raised past the spend: the coach is back, and the refresh sends the reply that waited.
    await userEvent.clear(amount());
    await userEvent.type(amount(), '10');
    await userEvent.tab();
    await waitFor(() => expect(pause()).toHaveAccessibleDescription(PAUSE_LINE));
    await waitFor(() => expect(refreshes(services)).toBe(2));
  });

  it('a failed save says so under it, and the budget goes back to what the coach still uses', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: false });
    const update = services.storage.settings.update;
    services.storage.settings.update = async () => {
      throw new Error('Storage is full.');
    };
    await shown(services, '5');
    await userEvent.click(raise());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the budget: Storage is full.');
    expect(amount()).toHaveValue('5');
    expect(refreshes(services)).toBe(0);

    await userEvent.click(pause());
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the budget: Storage is full.');
    expect(pause()).not.toBeChecked();

    // A later save that works clears it.
    services.storage.settings.update = update;
    await userEvent.click(raise());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(async () => expect((await savedBudget(services))?.monthlyUsd).toBe(6));
  });

  it('is held, saying so, when the settings cannot be read', async () => {
    const services = servicesWith({ monthlyUsd: 5, pauseAtBudget: true });
    services.storage.settings.get = async () => {
      throw new Error('IndexedDB is closed.');
    };
    renderWithServices(<BudgetControls />, services);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the budget: IndexedDB is closed.');
    expect(amount()).toBeDisabled();
    expect(pause()).toBeDisabled();
    expect(noBudget()).toBeDisabled();
  });

  it('draws nothing without a spend service', () => {
    const services = createFakeServices();
    const { container } = renderWithServices(<BudgetControls />, services);
    expect(container).toBeEmptyDOMElement();
  });
});

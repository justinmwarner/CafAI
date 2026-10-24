// @vitest-environment jsdom
import '../testing/setup.ts';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import type { CoachUiMessage } from '../../../app/types.ts';
import { takeUsageReveal } from '../../../spend/reveal.ts';
import { buildPalette, namedTint } from '../../palette.ts';
import { createCafaiTheme } from '../../theme.ts';
import { ChatSurface } from '../ChatSurface.tsx';
import { conversation } from '../testing/fixtures.ts';
import { fadedElements, renderWithServices } from '../testing/render.tsx';
import { BUDGET_PAUSED_TID, BudgetPausedCard } from './BudgetPausedCard.tsx';

const LINE = "The coach is paused: this month's spend reached your $5.00 budget. Raise it in Settings, or it starts again on 1 November.";
const card = () => screen.getByTestId(BUDGET_PAUSED_TID.card);

describe('BudgetPausedCard (D240)', () => {
  it('says what reached the budget and when the coach starts again, as a region of its own', () => {
    renderWithServices(<BudgetPausedCard budgetUsd={5} resumesOn="2026-11-01" />);
    expect(screen.getByRole('region', { name: 'The coach is paused' })).toBe(card());
    expect(within(card()).getByText(LINE)).toBeVisible();
  });

  it('opens Settings on the Coach page, asking it to bring the usage card into view', async () => {
    renderWithServices(<BudgetPausedCard budgetUsd={5} resumesOn="2026-11-01" />);
    const open = screen.getByRole('link', { name: 'Open Settings' });
    expect(open).toBe(screen.getByTestId(BUDGET_PAUSED_TID.openSettings));
    expect(open).toHaveAttribute('href', '#/settings/coach');
    expect(takeUsageReveal()).toBe(false);
    await userEvent.click(open);
    expect(takeUsageReveal()).toBe(true);
    expect(takeUsageReveal()).toBe(false);
  });

  it('is a 48 px target on the surface, nothing faded, the pause mark in the warning colour, in dark and light', () => {
    for (const mode of ['dark', 'light'] as const) {
      const theme = createCafaiTheme(buildPalette(mode, namedTint('crema')));
      const { unmount } = renderWithServices(
        <ThemeProvider theme={theme}>
          <BudgetPausedCard budgetUsd={1000} resumesOn="2027-01-01" />
        </ThemeProvider>,
      );
      expect(card(), mode).toHaveStyle({ backgroundColor: theme.palette.background.paper });
      expect(within(card()).getByText(/reached your \$1,000\.00 budget.*on 1 January\.$/), mode).toBeVisible();
      expect(screen.getByRole('link', { name: 'Open Settings' }), mode).toHaveStyle({ minHeight: '48px' });
      expect(card().querySelector('svg'), mode).toHaveStyle({ color: theme.palette.warning.main });
      expect(fadedElements(card()), mode).toEqual([]);
      unmount();
    }
  });
});

describe('ChatSurface: the pause card in the chat (D240)', () => {
  const paused: CoachUiMessage = {
    id: 'm-paused',
    role: 'system',
    parts: [{ kind: 'budgetPaused', budgetUsd: 5, resumesOn: '2026-11-01' }],
    createdAt: '2026-10-24T08:08:30.000Z',
  };

  it('draws a budgetPaused part as the card, never as its data', () => {
    renderWithServices(
      <ChatSurface
        messages={[...conversation('options'), paused]}
        busy={false}
        placeholder="Say how it tasted"
        canUndo={false}
        onSend={vi.fn()}
        onPickTemplate={vi.fn()}
        onAnswerOptions={vi.fn()}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onUndo={vi.fn()}
        onRateShot={vi.fn()}
      />,
    );
    expect(within(card()).getByText(LINE)).toBeVisible();
    expect(document.body.textContent).not.toContain('budgetPaused');
  });
});

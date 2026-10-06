// @vitest-environment jsdom
import '../../src/ui/chat/testing/setup.ts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ChatSurface } from '../../src/ui/chat/ChatSurface.tsx';
import { renderThemed } from '../../src/ui/chat/testing/render.tsx';
import { TID } from '../../src/ui/testIds.ts';
import { buildDemo, conversationOf, type DemoBuild } from './build.ts';

/**
 * The built demo in CafAI's own chat surface, found the way e2e/demo.spec.ts
 * finds it (roles, names and the shared test ids), so the spec's locators
 * match what the app renders.
 */
let demo: DemoBuild;

beforeAll(async () => {
  demo = await buildDemo(Date.UTC(2026, 9, 6, 9, 30, 0));
});

function renderKiambu() {
  const noop = vi.fn();
  return renderThemed(
    <ChatSurface
      messages={conversationOf(demo, 'Kiambu AA').uiMessages}
      busy={false}
      placeholder="Tap an answer, or say how it tasted"
      canUndo
      onSend={noop}
      onPickTemplate={noop}
      onAnswerOptions={noop}
      onConfirm={noop}
      onDecline={noop}
      onUndo={noop}
      onRateShot={noop}
    />,
  );
}

describe('the demo in the chat', () => {
  it('shows the cards the e2e spec looks for', () => {
    renderKiambu();
    expect(within(screen.getByTestId(TID.templateCard('blooming-espresso'))).getByText('In use')).toBeInTheDocument();
    expect(screen.getAllByTestId(TID.shotCard)).toHaveLength(4);

    const diffs = screen.getAllByTestId(TID.diffCard);
    expect(diffs.map((card) => card.getAttribute('data-status'))).toEqual(['applied', 'applied', 'declined', 'undone', 'applied']);
    // Undo only on the latest applied version, v4.
    expect(screen.getAllByTestId(TID.diffUndo)).toHaveLength(1);
    expect(within(diffs[4]!).getByText('Saved as Kiambu AA v4')).toBeInTheDocument();
    expect(within(diffs[4]!).getByTestId(TID.diffUndo)).toBeInTheDocument();

    expect(screen.getByText('Back on Kiambu AA v2.')).toBeInTheDocument();
    expect(screen.getByText('Set the grinder to 14.5 before the next shot (Decaid lists 0.5 steps for your Niche Zero).')).toBeInTheDocument();
    expect(within(screen.getByTestId(TID.chat)).getAllByRole('article').length).toBeGreaterThan(30);
  });

  it('leaves the last "How did it taste?" open, with every chip enabled', () => {
    renderKiambu();
    const questions = screen.getAllByRole('radiogroup', { name: 'How did it taste?' });
    expect(questions).toHaveLength(3);
    const open = questions[questions.length - 1]!;
    for (const taste of ['Sour / sharp', 'Bitter / harsh', 'Balanced, sweet', 'Weak / watery', 'Other']) {
      expect(within(open).getByTestId(TID.optionChip(taste))).not.toHaveAttribute('aria-disabled');
    }
    // The answered ones stay, closed.
    expect(within(questions[0]!).getByTestId(TID.optionChip('Bitter / harsh'))).toHaveAttribute('aria-disabled', 'true');
    // The puck question was multi-select.
    expect(screen.getByRole('group', { name: 'What does the puck look like?' })).toBeInTheDocument();
  });
});
